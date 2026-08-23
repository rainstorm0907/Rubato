import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import { fxRequestToResponses } from "./fx-request.ts";
import { responsesSseToFxSse } from "./fx-stream.ts";
import { opencodexModelsToFxCatalog, removeDirectCodexDuplicates } from "./models.ts";
import { DIRECT_CATALOG, directProviderToFxSse, isDirectModel } from "./direct-provider.ts";

const SENSITIVE = /authorization|api[-_]?key|token|secret|refresh/i;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sanitizeLog(value: string): string {
  return SENSITIVE.test(value) ? "[redacted]" : value;
}

// OpenCodex 는 선택이다. Codex 를 직접 OAuth 로 붙인 뒤로는 없어도 모든 모델이
// 돌아간다. 예전에는 이 fetch 가 죽으면 카탈로그 전체가 빈 채로 나가서 — 직접
// 프로바이더까지 같이 사라졌다 — 그것이 "모델이 하나도 안 보인다"의 정체였다.
type JsonObject = Record<string, unknown>;

async function proxyModels(config: ReturnType<typeof loadConfig>, res: ServerResponse): Promise<void> {
  const catalog: { object: "list"; data: JsonObject[] } = { object: "list", data: [] };
  try {
    const upstream = await fetch(`${config.opencodexBaseUrl}/v1/models`);
    const payload = await upstream.json();
    const proxied = opencodexModelsToFxCatalog(payload);
    const foreignModels = proxied.data.filter((entry) => {
      const id = String(entry.id);
      return !id.startsWith("xai/") && !id.startsWith("anthropic/") && !id.startsWith("openai-codex/");
    });
    catalog.data = removeDirectCodexDuplicates(
      foreignModels,
      DIRECT_CATALOG.map((model) => model.id),
    );
  } catch {
    // OpenCodex 가 안 뗴 뿐이다. 직접 프로바이더만 내려준다.
  }
  catalog.data.push(...DIRECT_CATALOG.map((model) => ({ ...model })));
  sendJson(res, 200, catalog);
}

async function proxyChat(
  config: ReturnType<typeof loadConfig>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const model = header(req, "ai-language-model-id");
  const sessionId = header(req, "x-session-id") ?? header(req, "x-session-affinity");
  if (!model) {
    sendJson(res, 400, { error: { type: "invalid_request", message: "missing ai-language-model-id" } });
    return;
  }
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const controller = new AbortController();
  let finished = false;
  const abortUpstream = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  req.on("aborted", abortUpstream);
  // res.close fires on a normal end too. Only cancel the upstream while this
  // response is still live — otherwise Grok's Responses stream dies before
  // response.completed and senpi records an aborted turn.
  res.on("close", () => {
    if (!finished) abortUpstream();
  });

  if (isDirectModel(model)) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    try {
      for await (const frame of directProviderToFxSse({
        model,
        body,
        sessionId,
        signal: controller.signal,
        cacheRetention: config.cacheRetention,
      })) {
        if (controller.signal.aborted || res.writableEnded || !res.writable) break;
        res.write(frame);
      }
    } catch (error) {
      if (!controller.signal.aborted && !res.writableEnded) {
        const message = error instanceof Error ? error.message : "direct provider failed";
        res.write(`data: ${JSON.stringify({ type: "error", message, code: "direct_provider" })}\n\n`);
        res.write("data: [DONE]\n\n");
      }
    } finally {
      finished = true;
      if (!res.writableEnded) res.end();
    }
    return;
  }

  const responsesRequest = fxRequestToResponses(model, body, sessionId);
  const upstream = await fetch(`${config.opencodexBaseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(sessionId ? { "session-id": sessionId } : {}),
    },
    body: JSON.stringify(responsesRequest),
    signal: controller.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    sendJson(res, upstream.status || 502, {
      error: {
        type: "upstream_error",
        message: text.slice(0, 500) || `OpenCodex returned ${upstream.status}`,
      },
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  try {
    for await (const frame of responsesSseToFxSse(upstream.body, controller.signal)) {
      if (controller.signal.aborted || res.writableEnded || !res.writable) break;
      res.write(frame);
    }
  } catch (error) {
    if (!controller.signal.aborted && !res.writableEnded) {
      const message = error instanceof Error ? error.message : "bridge stream failed";
      res.write(`data: ${JSON.stringify({ type: "error", message, code: "bridge_error" })}\n\n`);
      res.write("data: [DONE]\n\n");
    }
  } finally {
    finished = true;
    if (!res.writableEnded) res.end();
  }
}

export function startBridge(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${config.bind}`);
      if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
        sendJson(res, 200, { ok: true, service: "fx-v3-bridge" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/coding-agent/v1/models") {
        await proxyModels(config, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/coding-agent/v1/credits") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "not_supported", message: "credits are owned by providers, not this bridge" } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v3/ai/language-model") {
        await proxyChat(config, req, res);
        return;
      }
      sendJson(res, 404, { error: { type: "not_found", message: url.pathname } });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "bridge failed";
      if (!res.headersSent) sendJson(res, 500, { error: { type: "bridge_error", message: sanitizeLog(message) } });
      else if (!res.writableEnded) res.end();
    });
  });

  server.listen(config.port, config.bind, () => {
    process.stderr.write(`fx-v3-bridge listening on http://${config.bind}:${config.port}\n`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBridge();
}
