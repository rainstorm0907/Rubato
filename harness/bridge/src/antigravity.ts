import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { gatewayProviderMetadata, gatewayTimestamp, newGatewayGenerationId } from "./fx-generation.ts";
import { encodeSseData, encodeSseDone, iterateSse } from "./sse.ts";
import { upstreamFetch } from "./upstream-dispatcher.ts";

type JsonObject = Record<string, unknown>;
type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: JsonObject; id?: string };
  functionResponse?: { name: string; response: JsonObject; id?: string };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type AntigravitySession = {
  sessionId: string;
  agentId: string;
  trajectoryId: string;
  stepIndex: number;
  lastExecutionId?: string;
};

export type AntigravityEnvelope = {
  sessionId: string;
  requestId: string;
  labels: Record<string, string>;
};

const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const DEFAULT_OAUTH_FILE = join(homedir(), ".rubato-pi", "antigravity-oauth.json");
const USER_AGENT = "antigravity/hub/2.8.0 (aidev_client; os_type=darwin; arch=arm64)";

const WIRE_MODELS: Record<string, Record<string, string>> = {
  "gemini-3.7-flash": {
    default: "gemini-3.7-flash-low",
    minimal: "gemini-3.7-flash-low",
    low: "gemini-3.7-flash-low",
    medium: "gemini-3.7-flash-medium",
    high: "gemini-3.7-flash-high",
  },
  "gemini-3.1-pro": {
    default: "gemini-3.1-pro-low",
    low: "gemini-3.1-pro-low",
    high: "gemini-pro-agent",
  },
};

const sessions = new Map<string, AntigravitySession>();
let cachedAuth: { access: string; refresh: string; expires: number; projectId: string } | undefined;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function resetAntigravitySessions(): void {
  sessions.clear();
  cachedAuth = undefined;
}

export function peekAntigravitySession(fxSessionId: string): AntigravitySession | undefined {
  return sessions.get(fxSessionId);
}

export function rememberAntigravitySession(fxSessionId: string, session: AntigravitySession): void {
  sessions.set(fxSessionId, session);
}

export function resolveAntigravityWireModel(modelId: string, reasoning?: string): string {
  const table = WIRE_MODELS[modelId];
  if (!table) throw new Error(`unknown antigravity model: ${modelId}`);
  return (reasoning && table[reasoning]) || table.default;
}

export function nextAntigravityEnvelope(session: AntigravitySession, now = Date.now()): AntigravityEnvelope {
  session.stepIndex += 1;
  const labels: Record<string, string> = {
    last_step_index: String(session.stepIndex - 1),
    trajectory_id: session.trajectoryId,
    used_claude: "false",
    used_claude_conservative: "false",
  };
  if (session.lastExecutionId) labels.last_execution_id = session.lastExecutionId;
  return {
    sessionId: session.sessionId,
    requestId: `agent/${session.agentId}/${now}/${session.trajectoryId}/${session.stepIndex}`,
    labels,
  };
}

function newSession(): AntigravitySession {
  return {
    sessionId: randomBytes(8).readBigInt64BE().toString(),
    agentId: randomUUID(),
    trajectoryId: randomUUID(),
    stepIndex: 1,
  };
}

function sessionFor(fxSessionId: string | undefined): AntigravitySession {
  if (!fxSessionId) return newSession();
  const existing = sessions.get(fxSessionId);
  if (existing) return existing;
  const created = newSession();
  sessions.set(fxSessionId, created);
  return created;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (isObject(part) && typeof part.text === "string") return [part.text];
    return [];
  }).join("");
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (isObject(output) && typeof output.value === "string") return output.value;
  try {
    return JSON.stringify(output ?? "");
  } catch {
    return String(output ?? "");
  }
}

export function fxPromptToGeminiContents(prompt: unknown): { system?: string; contents: GeminiContent[] } {
  const contents: GeminiContent[] = [];
  const system: string[] = [];
  for (const message of Array.isArray(prompt) ? prompt : []) {
    if (!isObject(message)) continue;
    const role = asString(message.role);
    const content = message.content;
    if (role === "system") {
      const text = textOf(content);
      if (text) system.push(text);
      continue;
    }
    if (role === "user") {
      const text = textOf(content);
      if (text) contents.push({ role: "user", parts: [{ text }] });
      continue;
    }
    if (role === "assistant") {
      const parts: GeminiPart[] = [];
      for (const part of Array.isArray(content) ? content : []) {
        if (!isObject(part)) continue;
        if ((part.type === "text" || part.type === "output_text") && typeof part.text === "string" && part.text.trim()) {
          parts.push({ text: part.text });
        } else if ((part.type === "reasoning" || part.type === "thinking")) {
          const thinking = asString(part.text) ?? asString(part.thinking) ?? "";
          const signature = asString(part.signature) ?? asString(part.thinkingSignature);
          if (!thinking && !signature) continue;
          parts.push({
            text: thinking,
            thought: true,
            ...(signature ? { thoughtSignature: signature } : {}),
          });
        } else if (part.type === "tool-call") {
          parts.push({
            functionCall: {
              name: asString(part.toolName) ?? "unknown",
              args: isObject(part.input) ? part.input : {},
              ...(asString(part.toolCallId) ? { id: asString(part.toolCallId) } : {}),
            },
          });
        }
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    if (role === "tool") {
      for (const part of Array.isArray(content) ? content : []) {
        if (!isObject(part) || part.type !== "tool-result") continue;
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: asString(part.toolName) ?? "unknown",
              response: { output: outputText(part.output) },
              ...(asString(part.toolCallId) ? { id: asString(part.toolCallId) } : {}),
            },
          }],
        });
      }
    }
  }
  return { ...(system.length ? { system: system.join("\n\n") } : {}), contents };
}

export function buildAntigravityRequest(args: {
  projectId: string;
  wireModel: string;
  prompt: unknown;
  tools?: unknown;
  maxOutputTokens?: number;
  session: AntigravitySession;
  now?: number;
}): JsonObject {
  const envelope = nextAntigravityEnvelope(args.session, args.now);
  const converted = fxPromptToGeminiContents(args.prompt);
  const request: JsonObject = {
    contents: converted.contents,
    sessionId: envelope.sessionId,
    labels: envelope.labels,
    generationConfig: {
      maxOutputTokens: args.maxOutputTokens ?? 65536,
    },
  };
  if (converted.system) {
    request.systemInstruction = { role: "user", parts: [{ text: converted.system }] };
  }
  const tools = Array.isArray(args.tools) ? args.tools.filter(isObject).flatMap((tool) => {
    const name = asString(tool.name);
    if (!name) return [];
    const parameters = isObject(tool.inputSchema) ? tool.inputSchema : isObject(tool.parameters) ? tool.parameters : { type: "object", properties: {} };
    return [{
      name,
      description: asString(tool.description) ?? "",
      parametersJsonSchema: parameters,
    }];
  }) : [];
  if (tools.length) {
    request.tools = [{ functionDeclarations: tools }];
    request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }
  return {
    project: args.projectId,
    requestId: envelope.requestId,
    request,
    model: args.wireModel,
    userAgent: "antigravity",
    requestType: "agent",
  };
}

async function readKeychainSecret(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("security", ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(err.trim() || "Antigravity keychain item is missing"));
    });
  });
}

function decodeKeychainSecret(secret: string): { access: string; refresh: string; expiry?: string } {
  if (!secret.startsWith("go-keyring-base64:")) throw new Error("unexpected Antigravity keychain format");
  const parsed = JSON.parse(Buffer.from(secret.slice("go-keyring-base64:".length), "base64").toString("utf8"));
  const token = isObject(parsed) && isObject(parsed.token) ? parsed.token : undefined;
  const access = token ? asString(token.access_token) : undefined;
  const refresh = token ? asString(token.refresh_token) : undefined;
  if (!access || !refresh) throw new Error("Antigravity keychain secret has no tokens");
  return { access, refresh, expiry: token ? asString(token.expiry) : undefined };
}

function oauthClients(env: NodeJS.ProcessEnv = process.env): Array<{ id: string; secret: string }> {
  const path = env.FX_ANTIGRAVITY_OAUTH_FILE ?? DEFAULT_OAUTH_FILE;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonObject;
  const raw = Array.isArray(parsed.clients) ? parsed.clients : [parsed];
  const clients = raw.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const id = asString(entry.id) ?? asString(entry.client_id);
    const secret = asString(entry.secret) ?? asString(entry.client_secret);
    return id && secret ? [{ id, secret }] : [];
  });
  if (clients.length === 0) throw new Error(`Antigravity OAuth clients missing in ${path}`);
  return clients;
}

async function refreshAccess(refresh: string, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = process.env): Promise<{ access: string; expires: number; refresh: string }> {
  const clients = oauthClients(env);
  let last = "token refresh failed";
  for (const client of clients) {
    const body = new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      last = `token refresh ${response.status}`;
      continue;
    }
    const data = JSON.parse(text) as JsonObject;
    const access = asString(data.access_token);
    if (!access) {
      last = "token refresh missing access_token";
      continue;
    }
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    return {
      access,
      refresh: asString(data.refresh_token) ?? refresh,
      expires: Date.now() + expiresIn * 1000 - 60_000,
    };
  }
  throw new Error(last);
}

async function loadProjectId(access: string, endpoint: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${endpoint}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`loadCodeAssist ${response.status}`);
  const data = JSON.parse(text) as JsonObject;
  const project = asString(data.cloudaicompanionProject);
  if (!project) throw new Error("loadCodeAssist did not return a project");
  return project;
}

export async function resolveAntigravityAuth(args: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
} = {}): Promise<{ access: string; projectId: string }> {
  const env = args.env ?? process.env;
  const fetchImpl = args.fetch ?? upstreamFetch;
  const endpoint = env.FX_ANTIGRAVITY_ENDPOINT ?? DEFAULT_ENDPOINT;
  const envAccess = env.FX_ANTIGRAVITY_ACCESS;
  const envProject = env.FX_ANTIGRAVITY_PROJECT;
  if (envAccess && envProject) return { access: envAccess, projectId: envProject };

  if (cachedAuth && cachedAuth.expires > Date.now()) {
    return { access: cachedAuth.access, projectId: cachedAuth.projectId };
  }

  let refresh = env.FX_ANTIGRAVITY_REFRESH;
  let access = envAccess;
  let expires = 0;
  if (!refresh || !access) {
    const stored = decodeKeychainSecret(await readKeychainSecret());
    refresh = refresh ?? stored.refresh;
    access = access ?? stored.access;
    expires = stored.expiry ? Date.parse(stored.expiry) : 0;
  }
  if (!refresh) throw new Error("Antigravity refresh token is missing");
  if (!access || expires <= Date.now() + 30_000) {
    const rotated = await refreshAccess(refresh, fetchImpl, env);
    access = rotated.access;
    refresh = rotated.refresh;
    expires = rotated.expires;
  }
  const projectId = envProject ?? await loadProjectId(access, endpoint, fetchImpl);
  cachedAuth = { access, refresh, expires: expires || Date.now() + 50 * 60_000, projectId };
  return { access, projectId };
}

function usageFromChunk(meta: JsonObject | undefined): JsonObject | undefined {
  if (!meta) return undefined;
  const input = typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : 0;
  const output = typeof meta.candidatesTokenCount === "number" ? meta.candidatesTokenCount : 0;
  const cacheRead = typeof meta.cachedContentTokenCount === "number" ? meta.cachedContentTokenCount : 0;
  const reasoning = typeof meta.thoughtsTokenCount === "number" ? meta.thoughtsTokenCount : undefined;
  return {
    inputTokens: { total: input + cacheRead, noCache: input, cacheRead, cacheWrite: 0 },
    outputTokens: { total: output, ...(reasoning === undefined ? {} : { reasoning }) },
  };
}

export async function* antigravityToFxSse(args: {
  model: string;
  body: JsonObject;
  sessionId?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): AsyncGenerator<string> {
  const modelId = args.model.startsWith("google-antigravity/")
    ? args.model.slice("google-antigravity/".length)
    : args.model;
  const env = args.env ?? process.env;
  const fetchImpl = args.fetch ?? upstreamFetch;
  const endpoint = env.FX_ANTIGRAVITY_ENDPOINT ?? DEFAULT_ENDPOINT;
  const auth = await resolveAntigravityAuth({ env, fetch: fetchImpl });
  const session = sessionFor(args.sessionId);
  const wireModel = resolveAntigravityWireModel(modelId, asString(args.body.reasoning));
  const payload = buildAntigravityRequest({
    projectId: auth.projectId,
    wireModel,
    prompt: args.body.prompt,
    tools: args.body.tools,
    maxOutputTokens: typeof args.body.maxOutputTokens === "number" ? args.body.maxOutputTokens : undefined,
    session,
    now: args.now,
  });
  const response = await fetchImpl(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.access}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
    signal: args.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    yield encodeSseData({ type: "error", message: text.slice(0, 400) || `Antigravity returned ${response.status}`, code: "antigravity_direct" });
    yield encodeSseData({
      type: "finish",
      finishReason: { unified: "error", raw: String(response.status) },
      providerMetadata: gatewayProviderMetadata({ generationId: newGatewayGenerationId(), modelId: args.model }),
    });
    yield encodeSseDone();
    return;
  }

  const generationId = newGatewayGenerationId();
  const providerMetadata = gatewayProviderMetadata({ generationId, modelId: args.model });
  yield encodeSseData({ type: "response-metadata", modelId: args.model, timestamp: gatewayTimestamp() });

  let textId: string | undefined;
  let reasoningId: string | undefined;
  let usage: JsonObject | undefined;
  let lastResponseId: string | undefined;
  let finishRaw = "stop";
  let sawTool = false;
  const startText = (): string[] => {
    if (textId) return [];
    textId = "x0";
    return [encodeSseData({ type: "text-start", id: textId, providerMetadata })];
  };
  const endText = (): string[] => {
    if (!textId) return [];
    const id = textId;
    textId = undefined;
    return [encodeSseData({ type: "text-end", id })];
  };
  const startReasoning = (): string[] => {
    if (reasoningId) return [];
    reasoningId = "x1";
    return [encodeSseData({ type: "reasoning-start", id: reasoningId })];
  };
  const endReasoning = (): string[] => {
    if (!reasoningId) return [];
    const id = reasoningId;
    reasoningId = undefined;
    return [encodeSseData({ type: "reasoning-end", id })];
  };

  for await (const event of iterateSse(response.body, args.signal)) {
    if (event.data === "[DONE]") break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (!isObject(parsed)) continue;
    if (isObject(parsed.error)) {
      for (const frame of [...endReasoning(), ...endText()]) yield frame;
      yield encodeSseData({ type: "error", message: asString(parsed.error.message) ?? "Antigravity error", code: "antigravity_direct" });
      yield encodeSseData({
        type: "finish",
        finishReason: { unified: "error", raw: asString(parsed.error.status) ?? "error" },
        providerMetadata: gatewayProviderMetadata({ generationId, modelId: args.model }),
      });
      yield encodeSseDone();
      return;
    }
    const data = isObject(parsed.response) ? parsed.response : parsed;
    if (typeof data.responseId === "string") lastResponseId = data.responseId;
    if (isObject(data.usageMetadata)) usage = usageFromChunk(data.usageMetadata);
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    if (!isObject(candidate)) continue;
    const content = isObject(candidate.content) ? candidate.content : undefined;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isObject(part)) continue;
      if (isObject(part.functionCall)) {
        for (const frame of [...endReasoning(), ...endText()]) yield frame;
        const id = asString(part.functionCall.id) ?? `call_${randomUUID()}`;
        const name = asString(part.functionCall.name) ?? "unknown";
        const input = isObject(part.functionCall.args) ? part.functionCall.args : {};
        sawTool = true;
        yield encodeSseData({ type: "tool-input-start", id, toolName: name });
        yield encodeSseData({ type: "tool-input-end", id });
        yield encodeSseData({ type: "tool-call", toolCallId: id, toolName: name, input, providerMetadata });
        continue;
      }
      const text = asString(part.text);
      if (!text) continue;
      if (part.thought === true) {
        for (const frame of endText()) yield frame;
        for (const frame of startReasoning()) yield frame;
        yield encodeSseData({ type: "reasoning-delta", id: reasoningId, delta: text });
      } else {
        for (const frame of endReasoning()) yield frame;
        for (const frame of startText()) yield frame;
        yield encodeSseData({ type: "text-delta", id: textId, delta: text });
      }
    }
    const reason = asString(candidate.finishReason);
    if (reason) finishRaw = reason;
  }

  if (args.sessionId) session.lastExecutionId = lastResponseId;
  for (const frame of [...endReasoning(), ...endText()]) yield frame;
  const unified = sawTool ? "tool-calls" : finishRaw === "MAX_TOKENS" ? "length" : finishRaw === "STOP" || finishRaw === "stop" ? "stop" : "stop";
  yield encodeSseData({
    type: "finish",
    finishReason: { unified, raw: finishRaw },
    ...(usage ? { usage } : {}),
    providerMetadata: gatewayProviderMetadata({ generationId, modelId: args.model }),
  });
  yield encodeSseDone();
}
