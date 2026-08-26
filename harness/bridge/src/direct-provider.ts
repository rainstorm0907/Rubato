import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readlink, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { CacheRetention } from "./config.ts";
import { gatewayProviderMetadata, gatewayTimestamp, newGatewayGenerationId } from "./fx-generation.ts";
import { antigravityToFxSse } from "./antigravity.ts";
import { encodeSseData, encodeSseDone } from "./sse.ts";
import { upstreamFetch } from "./upstream-dispatcher.ts";

type JsonObject = Record<string, unknown>;
type Credential = { type: "oauth"; access: string; refresh: string; expires: number; [key: string]: unknown };

const DEFAULT_XAI_AUTH_PATH = join(homedir(), ".senpi", "agent", "auth.json");

export function isDirectModel(model: string): boolean {
  return model.startsWith("xai/") || model.startsWith("anthropic/") || model.startsWith("claude-")
    || model.startsWith("openai-codex/") || model.startsWith("google-antigravity/")
    || model.startsWith("kiro/");
}

type DirectProvider = "xai" | "anthropic" | "openai-codex" | "kiro";

export function providerModel(model: string): { provider: DirectProvider; modelId: string } {
  if (model.startsWith("xai/")) return { provider: "xai", modelId: model.slice(4) };
  if (model.startsWith("anthropic/")) return { provider: "anthropic", modelId: model.slice("anthropic/".length) };
  if (model.startsWith("claude-")) return { provider: "anthropic", modelId: model };
  if (model.startsWith("openai-codex/")) return { provider: "openai-codex", modelId: model.slice("openai-codex/".length) };
  if (model.startsWith("kiro/")) return { provider: "kiro", modelId: model.slice("kiro/".length) };
  throw new Error(`not a direct provider model: ${model}`);
}

// Kiro 구독은 kiro.rs 사이드카가 Anthropic Messages 로 번역해 준다. 그래서
// 새 트랜스포트를 짜지 않고 같은 anthropic-messages API 를 loopback 으로 돌린다.
//
// 인증은 Anthropic OAuth 가 아니라 kiro.rs 가 발급한 로컬 API 키다. 그 키는
// 우리 것이 아니라 사용자 파일에 있으므로 여기서 만들지 않는다.
export const DEFAULT_KIRO_BASE_URL = "http://127.0.0.1:8990";

export function kiroBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.KIRO_BASE_URL ?? DEFAULT_KIRO_BASE_URL).replace(/\/$/, "");
}

// 키를 환경변수로만 받으면 사용자가 셔하금마다 export 해야 하고, 그러면
// "내 기기에서만 도는 고침"이 된다. kiro-setup.sh 가 써 둔 config 를 직접 읽어
// 한 번 설정하면 재기동 뒤에도 그대로 붙게 한다. 환경변수가 있으면 그쪽이 이긴다.
const DEFAULT_KIRO_CONFIG_PATH = join(homedir(), ".rubato-pi", "kiro", "config.json");

let cachedKiroKey: { path: string; key: string | undefined } | undefined;

export function kiroApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KIRO_API_KEY) return env.KIRO_API_KEY;
  const path = env.KIRO_CONFIG_PATH ?? DEFAULT_KIRO_CONFIG_PATH;
  if (cachedKiroKey?.path === path) return cachedKiroKey.key;
  let key: string | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isObject(parsed)) key = asString(parsed.apiKey);
  } catch {
    // 설정이 없으면 kiro 를 안 쓰는 사용자다. 다른 프로바이더를 막지 않는다.
  }
  cachedKiroKey = { path, key };
  return key;
}

// Kiro 가 여는 모델 중 우리가 쓰는 둘. 컨텍스트 창은 kiro.rs 가 usage 를 역산할 때
// 쓰는 값과 같아야 한다 — gpt 계열 272K, opus-5 1M (kiro.rs converter.rs:315/323).
// 두 값은 broker.mjs 의 CONTEXT_WINDOW_OVERRIDES 와 함께 고쳐라.
const KIRO_MODELS = [
  {
    id: "claude-opus-5",
    name: "Opus 5 (Kiro)",
    reasoning: true,
    input: ["text", "image"] as const,
    contextWindow: 1_000_000,
    maxTokens: 64_000,
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Kiro)",
    reasoning: true,
    input: ["text", "image"] as const,
    contextWindow: 272_000,
    maxTokens: 64_000,
  },
];

// 모델 스펙은 provider/baseUrl 을 스스로 들고 있다. anthropicProvider() 를
// spread 로 덮으면 그 안의 모델이 여전히 anthropic 을 가리켜
// "Unknown provider: anthropic" 으로 죽는다 — 프로바이더를 새로 만든다.
function kiroProvider(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = kiroBaseUrl(env);
  return createProvider({
    id: "kiro",
    name: "Kiro",
    baseUrl,
    auth: { apiKey: kiroApiKeyAuth() },
    models: KIRO_MODELS.map((model) => ({
      ...model,
      api: "anthropic-messages" as const,
      provider: "kiro",
      baseUrl,
      input: [...model.input],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsTemperature: false, supportsStrictTools: true },
    })),
    api: anthropicMessagesApi(),
  });
}

// kiro.rs 는 x-api-key 를 그대로 받는다. 로컬 루프백이라 OAuth 흐름이 없다.
function kiroApiKeyAuth() {
  return {
    name: "Kiro (kiro.rs local)",
    login: async () => {
      throw new Error("kiro 는 harness/scripts/kiro-setup.sh 로 설정한다");
    },
    resolve: async ({ ctx }: { ctx: { env: (name: string) => Promise<string | undefined> } }) => {
      const key = await ctx.env("KIRO_API_KEY");
      return key ? { auth: { apiKey: key }, source: "KIRO_API_KEY" } : undefined;
    },
  };
}

// xai 와 openai-codex 는 같은 senpi auth.json 에서 OAuth 를 읽는다(각각 "xai",
// "openai-codex" 키). anthropic 만 다르다 — 거기는 Claude Code 의 장기 setup-token 이다.
function usesSenpiCredentials(provider: DirectProvider): boolean {
  return provider === "xai" || provider === "openai-codex";
}

export const DIRECT_CATALOG = [
  { id: "xai/grok-4.6", type: "language", owned_by: "xai", tags: ["tool-use", "reasoning"] },
  { id: "anthropic/claude-sonnet-5", type: "language", owned_by: "anthropic", tags: ["tool-use", "reasoning"] },
  { id: "anthropic/claude-opus-5", type: "language", owned_by: "anthropic", tags: ["tool-use", "reasoning"] },
  { id: "anthropic/claude-fable-5", type: "language", owned_by: "anthropic", tags: ["tool-use", "reasoning"] },
  { id: "anthropic/claude-haiku-4-5", type: "language", owned_by: "anthropic", tags: ["tool-use", "reasoning"] },
  { id: "openai-codex/gpt-5.6-sol", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning"] },
  { id: "openai-codex/gpt-5.6-sol-fast", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning", "priority"] },
  { id: "openai-codex/gpt-5.6-luna", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning"] },
  { id: "openai-codex/gpt-5.6-luna-fast", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning", "priority"] },
  { id: "openai-codex/gpt-5.6-terra", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning"] },
  { id: "openai-codex/gpt-5.6-terra-fast", type: "language", owned_by: "openai", tags: ["tool-use", "reasoning", "priority"] },
  { id: "google-antigravity/gemini-3.7-flash", type: "language", owned_by: "google", tags: ["tool-use", "reasoning"] },
  { id: "google-antigravity/gemini-3.1-pro", type: "language", owned_by: "google", tags: ["tool-use", "reasoning"] },
  { id: "kiro/claude-opus-5", type: "language", owned_by: "kiro", tags: ["tool-use", "reasoning"] },
  { id: "kiro/gpt-5.6-sol", type: "language", owned_by: "kiro", tags: ["tool-use", "reasoning"] },
];

export function claudeCodeUserAgentFromTarget(target: string): string {
  const version = basename(target);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`cannot determine Claude Code version from ${target}`);
  return `claude-cli/${version}`;
}

export async function claudeCodeUserAgent(path = process.env.CLAUDE_CODE_PATH ?? join(homedir(), ".local", "bin", "claude")): Promise<string> {
  return claudeCodeUserAgentFromTarget(await readlink(path));
}

export async function readClaudeSetupToken(account = process.env.FX_CLAUDE_ACCOUNT ?? "sub"): Promise<string> {
  const tokenFile = process.env.FX_CLAUDE_SETUP_TOKEN_FILE
    ?? join(homedir(), ".claude", "auth", `setup-token-${account}`);
  try {
    const token = (await readFile(tokenFile, "utf8")).trim();
    if (token.startsWith("sk-ant-oat")) return token;
  } catch {
    // Fall back to Keychain for accounts without a dedicated token file.
  }
  return new Promise((resolve, reject) => {
    const child = spawn("security", ["find-generic-password", "-s", `Claude Code-setup-token-${account}`, "-a", process.env.USER ?? "", "-w"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      const token = out.trim();
      if (code === 0 && token.startsWith("sk-ant-oat")) resolve(token);
      else reject(new Error(`Claude Code setup-token for ${account} is missing`));
    });
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const FX_TO_CLAUDE_TOOL = new Map<string, string>([
  ["read_file", "Read"],
  ["write_file", "Write"],
  ["edit_file", "Edit"],
  ["terminal", "Bash"],
  ["grep_files", "Grep"],
  ["glob_files", "Glob"],
  ["ask_user_question", "AskUserQuestion"],
  ["skill", "Skill"],
  ["web_fetch", "WebFetch"],
]);
const CLAUDE_TO_FX_TOOL = new Map(Array.from(FX_TO_CLAUDE_TOOL, ([fx, claude]) => [claude, fx]));

export function fxToolToClaude(name: string): string {
  return FX_TO_CLAUDE_TOOL.get(name) ?? `mcp__fx__${name}`;
}

export function claudeToolToFx(name: string): string {
  return CLAUDE_TO_FX_TOOL.get(name) ?? (name.startsWith("mcp__fx__") ? name.slice("mcp__fx__".length) : name);
}

function providerToolName(name: string, provider: "xai" | "anthropic"): string {
  return provider === "anthropic" ? fxToolToClaude(name) : name;
}

type UserPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function contentParts(content: unknown): UserPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: UserPart[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    if ((part.type === "text" || part.type === "output_text") && typeof part.text === "string") {
      parts.push({ type: "text", text: String(part.text) });
    } else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      parts.push({ type: "image", data: part.data, mimeType: part.mimeType });
    }
  }
  return parts;
}

function textParts(content: unknown): Array<{ type: "text"; text: string }> {
  return contentParts(content).filter((part): part is { type: "text"; text: string } => part.type === "text");
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (isObject(output) && typeof output.value === "string") return output.value;
  // 이미지는 옆에서 별도 블록으로 간다. 여기서까지 직렬화하면 base64 가
  // 본문에 그대로 쓰여 컨텍스트를 날린다.
  if (Array.isArray(output)) {
    const texts = output.filter(isObject).filter((item) => item.type !== "image");
    const only = texts.map((item) => asString(item.text) ?? asString(item.value)).filter((text) => text);
    if (only.length) return only.join("");
    try {
      return JSON.stringify(texts);
    } catch {
      return String(texts);
    }
  }
  try {
    return JSON.stringify(output ?? "");
  } catch {
    return String(output ?? "");
  }
}

// tool-result 에 실려온 이미지를 꺼낸다. read 로 열은 그림이 여기로 온다.
function outputImages(output: unknown): UserPart[] {
  if (!Array.isArray(output)) return [];
  return output.filter(isObject).flatMap((item) =>
    item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string"
      ? [{ type: "image" as const, data: item.data, mimeType: item.mimeType }]
      : [],
  );
}

export function fxPromptToPiContext(prompt: unknown, tools: unknown, provider: "xai" | "anthropic" = "xai", model = "grok-4.6"): JsonObject {
  const messages: JsonObject[] = [];
  const system: string[] = [];
  for (const message of Array.isArray(prompt) ? prompt : []) {
    if (!isObject(message)) continue;
    const role = asString(message.role);
    const content = message.content;
    if (role === "system") {
      system.push(textParts(content).map((part) => part.text).join(""));
    } else if (role === "user") {
      messages.push({ role: "user", content: contentParts(content), timestamp: Date.now() });
    } else if (role === "assistant") {
      const blocks: JsonObject[] = [];
      for (const part of Array.isArray(content) ? content : []) {
        if (!isObject(part)) continue;
        if ((part.type === "text" || part.type === "output_text") && typeof part.text === "string") {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "reasoning" || part.type === "thinking") {
          const thinking = asString(part.text) ?? asString(part.thinking) ?? "";
          const signature = asString(part.signature) ?? asString(part.thinkingSignature);
          if (!thinking && !signature) continue;
          const block: JsonObject = { type: "thinking", thinking };
          if (signature) block.thinkingSignature = signature;
          if (part.redacted === true) block.redacted = true;
          blocks.push(block);
        } else if (part.type === "tool-call") {
          blocks.push({
            type: "toolCall",
            id: asString(part.toolCallId) ?? "",
            name: providerToolName(asString(part.toolName) ?? "unknown", provider),
            arguments: isObject(part.input) ? part.input : {},
          });
        }
      }
      messages.push({
        role: "assistant",
        content: blocks,
        api: provider === "xai" ? "openai-completions" : "anthropic-messages",
        provider,
        model,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: blocks.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
        timestamp: Date.now(),
      });
    } else if (role === "tool") {
      for (const part of Array.isArray(content) ? content : []) {
        if (!isObject(part) || part.type !== "tool-result") continue;
        const images = outputImages(part.output);
        messages.push({
          role: "toolResult",
          toolCallId: asString(part.toolCallId) ?? "",
          toolName: providerToolName(asString(part.toolName) ?? "unknown", provider),
          content: [{ type: "text", text: outputText(part.output) }, ...images],
          isError: Boolean(part.isError),
          timestamp: Date.now(),
        });
      }
    }
  }

  const mappedTools = Array.isArray(tools) ? tools.filter(isObject).flatMap((tool) => {
    const name = asString(tool.name);
    if (!name) return [];
    const parameters = isObject(tool.inputSchema) ? tool.inputSchema : isObject(tool.parameters) ? tool.parameters : { type: "object", properties: {} };
    return [{ name: providerToolName(name, provider), description: asString(tool.description) ?? "", parameters }];
  }) : [];

  return {
    ...(system.filter(Boolean).length ? { systemPrompt: system.filter(Boolean).join("\n\n") } : {}),
    messages,
    ...(mappedTools.length ? { tools: mappedTools } : {}),
  };
}

export function piUsageToFx(usage: unknown): JsonObject | undefined {
  if (!isObject(usage)) return undefined;
  const input = typeof usage.input === "number" ? usage.input : 0;
  const output = typeof usage.output === "number" ? usage.output : 0;
  const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const reasoning = typeof usage.reasoning === "number" ? usage.reasoning : undefined;
  return {
    inputTokens: { total: input + cacheRead + cacheWrite, noCache: input, cacheRead, cacheWrite },
    outputTokens: { total: output, ...(reasoning === undefined ? {} : { reasoning }) },
  };
}

class SenpiCredentialStore {
  private chain = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private async all(): Promise<Record<string, Credential>> {
    const parsed = JSON.parse(await readFile(this.path, "utf8"));
    if (!isObject(parsed)) throw new Error("invalid Senpi auth store");
    return parsed as Record<string, Credential>;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.all())[providerId];
  }

  async list(): Promise<Array<{ providerId: string; type: string }>> {
    return Object.entries(await this.all()).map(([providerId, value]) => ({ providerId, type: value.type }));
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    let result: Credential | undefined;
    this.chain = this.chain.then(async () => {
      const all = await this.all();
      result = await fn(all[providerId]);
      if (result === undefined) return;
      all[providerId] = result;
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, this.path);
    });
    await this.chain;
    return result;
  }

  async delete(): Promise<void> {
    throw new Error("bridge does not own credential logout");
  }
}

const SERVICE_TIERS = new Set(["priority"]);

export function fxBodyToPiStreamOptions(body: JsonObject): {
  reasoning?: string;
  maxTokens?: number;
  serviceTier?: string;
} {
  return {
    ...(typeof body.reasoning === "string" ? { reasoning: body.reasoning } : {}),
    ...(typeof body.maxOutputTokens === "number" ? { maxTokens: body.maxOutputTokens } : {}),
    ...(typeof body.service_tier === "string" && SERVICE_TIERS.has(body.service_tier) ? { serviceTier: body.service_tier } : {}),
  };
}

export async function* directProviderToFxSse(args: {
  model: string;
  body: JsonObject;
  sessionId?: string;
  signal?: AbortSignal;
  xaiAuthPath?: string;
  cacheRetention?: CacheRetention;
  env?: NodeJS.ProcessEnv;
  upstreamFetch?: typeof globalThis.fetch;
  transport?: "auto" | "sse" | "websocket";
}): AsyncGenerator<string> {
  if (args.model.startsWith("google-antigravity/")) {
    yield* antigravityToFxSse(args);
    return;
  }
  const selected = providerModel(args.model);
  // kiro 는 로컬 사이드카의 API 키로 붙는다. Claude setup-token 을 태우면
  // 엉뚱한 자격증명이 나가므로 분기를 anthropic 과 갈라 둔다.
  const authContext = selected.provider === "anthropic"
    ? { env: async (name: string) => name === "ANTHROPIC_OAUTH_TOKEN" ? await readClaudeSetupToken() : undefined, fileExists: async () => false }
    : selected.provider === "kiro"
    ? { env: async (name: string) => name === "KIRO_API_KEY" ? kiroApiKey(args.env) : undefined, fileExists: async () => false }
    : undefined;
  const models = createModels({
    ...(usesSenpiCredentials(selected.provider) ? { credentials: new SenpiCredentialStore(args.xaiAuthPath ?? process.env.SENPI_AUTH_PATH ?? DEFAULT_XAI_AUTH_PATH) } : {}),
    ...(authContext ? { authContext } : {}),
  });
  models.setProvider(
    selected.provider === "xai" ? xaiProvider()
    : selected.provider === "openai-codex" ? openaiCodexProvider()
    : selected.provider === "kiro" ? kiroProvider(args.env)
    : anthropicProvider(),
  );
  const model = models.getModel(selected.provider, selected.modelId);
  if (!model) throw new Error(`unknown ${selected.provider} model: ${args.model}`);
  const requestModel = model.upstreamModelId ? { ...model, id: model.upstreamModelId } : model;
  // kiro 는 Anthropic Messages 형식으로 번역되므로 프롬프트 변환도 anthropic 규칙을 따른다.
  const promptProvider = selected.provider === "kiro" ? "anthropic" : selected.provider;
  const context = fxPromptToPiContext(args.body.prompt, args.body.tools, promptProvider, selected.modelId);
  const headers = selected.provider === "anthropic" ? { "user-agent": await claudeCodeUserAgent() } : undefined;
  const stream = models.streamSimple(requestModel, context, {
    fetch: args.upstreamFetch ?? upstreamFetch,
    signal: args.signal,
    sessionId: args.sessionId,
    affinitySessionId: args.sessionId,
    streamKind: "main",
    ...(headers ? { headers } : {}),
    maxRetries: 0,
    ...(args.transport ? { transport: args.transport } : {}),
    ...(args.cacheRetention ? { cacheRetention: args.cacheRetention } : {}),
    ...fxBodyToPiStreamOptions(args.body),
    // pi-ai streamSimple currently drops serviceTier in buildBaseOptions before
    // Codex serialization. Keep the catalog metadata authoritative and inject it
    // at the provider's final payload hook instead of teaching the bridge aliases.
    ...(model.serviceTier
      ? { onPayload: (body: JsonObject) => ({ ...body, service_tier: model.serviceTier }) }
      : {}),
  });

  const generationId = newGatewayGenerationId();
  const providerMetadata = gatewayProviderMetadata({ generationId, modelId: args.model });
  yield encodeSseData({ type: "response-metadata", modelId: args.model, timestamp: gatewayTimestamp() });
  for await (const event of stream) {
    if (event.type === "text_start") yield encodeSseData({ type: "text-start", id: `x${event.contentIndex}`, providerMetadata });
    else if (event.type === "text_delta") yield encodeSseData({ type: "text-delta", id: `x${event.contentIndex}`, delta: event.delta });
    else if (event.type === "text_end") yield encodeSseData({ type: "text-end", id: `x${event.contentIndex}` });
    else if (event.type === "thinking_start") yield encodeSseData({ type: "reasoning-start", id: `x${event.contentIndex}` });
    else if (event.type === "thinking_delta") yield encodeSseData({ type: "reasoning-delta", id: `x${event.contentIndex}`, delta: event.delta });
    else if (event.type === "thinking_end") yield encodeSseData({ type: "reasoning-end", id: `x${event.contentIndex}` });
    else if (event.type === "toolcall_start") {
      const partial = event.partial.content[event.contentIndex];
      yield encodeSseData({ type: "tool-input-start", id: isObject(partial) ? asString(partial.id) ?? `x${event.contentIndex}` : `x${event.contentIndex}`, toolName: isObject(partial) ? selected.provider === "anthropic" ? claudeToolToFx(asString(partial.name) ?? "unknown") : asString(partial.name) ?? "unknown" : "unknown" });
    } else if (event.type === "toolcall_delta") {
      const partial = event.partial.content[event.contentIndex];
      yield encodeSseData({ type: "tool-input-delta", id: isObject(partial) ? asString(partial.id) ?? `x${event.contentIndex}` : `x${event.contentIndex}`, delta: event.delta });
    } else if (event.type === "toolcall_end") {
      yield encodeSseData({ type: "tool-input-end", id: event.toolCall.id });
      yield encodeSseData({ type: "tool-call", toolCallId: event.toolCall.id, toolName: selected.provider === "anthropic" ? claudeToolToFx(event.toolCall.name) : event.toolCall.name, input: event.toolCall.arguments, providerMetadata });
    } else if (event.type === "done") {
      const usage = piUsageToFx(event.message.usage);
      yield encodeSseData({
        type: "finish",
        finishReason: { unified: event.reason === "toolUse" ? "tool-calls" : event.reason === "length" ? "length" : "stop", raw: event.reason },
        ...(usage ? { usage } : {}),
        providerMetadata: gatewayProviderMetadata({ generationId, modelId: args.model, usage: event.message.usage }),
      });
      yield encodeSseDone();
      return;
    } else if (event.type === "error") {
      yield encodeSseData({ type: "error", message: event.error.errorMessage ?? event.reason, code: `${selected.provider}_direct` });
      const usage = piUsageToFx(event.error.usage);
      yield encodeSseData({
        type: "finish",
        finishReason: { unified: "error", raw: event.reason },
        ...(usage ? { usage } : {}),
        providerMetadata: gatewayProviderMetadata({ generationId, modelId: args.model, usage: event.error.usage }),
      });
      yield encodeSseDone();
      return;
    }
  }
}
