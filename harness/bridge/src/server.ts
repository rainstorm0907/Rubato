import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import { fxRequestToResponses } from "./fx-request.ts";
import { responsesSseToFxSse } from "./fx-stream.ts";
import { opencodexModelsToFxCatalog, removeDirectProviderModels } from "./models.ts";
import { DIRECT_CATALOG, directProviderToFxSse, isDirectModel } from "./direct-provider.ts";
import { closeUpstreamAgent } from "./upstream-dispatcher.ts";

const SENSITIVE = /authorization|api[-_]?key|token|secret|refresh/i;
const STARTED_AT = Date.now();

// 종료할 때 진행 중인 응답을 기다리는 상한. 모델 한 턴은 길면 몇 분이지만,
// 재기동이 그만큼 멈춰 있으면 그것대로 세션이 못 뜬다. 리스닝 소켓은 즉시
// 놓기 때문에 새 브리지는 이 대기와 무관하게 곧바로 포트를 잡는다.
const DEFAULT_DRAIN_MS = 30_000;

type BridgeState = {
  /** 진행 중인 업스트림 모델 호출 수. /healthz 가 이 수를 내보낸다. */
  inflight: number;
  /** 종료 중인가. 종료 중에는 새 요청을 받지 않는다. */
  draining: boolean;
  drain?: Promise<void>;
};

const STATE = new WeakMap<Server, BridgeState>();

export function bridgeState(server: Server): BridgeState {
  let state = STATE.get(server);
  if (!state) {
    state = { inflight: 0, draining: false };
    STATE.set(server, state);
  }
  return state;
}

function drainTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.FX_BRIDGE_DRAIN_MS;
  if (raw === undefined) return DEFAULT_DRAIN_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid FX_BRIDGE_DRAIN_MS: ${raw}`);
  return parsed;
}

/**
 * 리스닝 소켓을 먼저 닫고, 진행 중인 응답이 끝날 때까지 기다린 뒤 서버를
 * 회수한다.
 *
 * 예전에는 시그널 핸들러가 아예 없어서 SIGTERM 한 번에 프로세스가 즉사했고,
 * 그 순간 흐르던 SSE 응답이 전부 소켓 끊김으로 끝났다 — 붙어 있던 세션들이
 * 턴 한가운데서 죽는 것이 그것이었고, 프로세스가 신호로 죽으니 로그에도
 * 아무것도 남지 않았다.
 */
export function drainAndClose(
  server: Server,
  { timeoutMs = DEFAULT_DRAIN_MS, log = (message: string) => process.stderr.write(message), pollMs = 100 } = {},
): Promise<void> {
  const state = bridgeState(server);
  if (state.drain) return state.drain;
  state.draining = true;
  log(`fx-v3-bridge draining: ${state.inflight} in-flight request(s), up to ${timeoutMs}ms\n`);

  state.drain = new Promise<void>((resolve) => {
    let settled = false;
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      log(`fx-v3-bridge closed (${reason}, ${state.inflight} still in flight)\n`);
      // keep-alive 로 남은 소켓까지 회수한다. 여기까지 왔으면 기다릴 응답은
      // 없거나 상한을 넘긴 것이다.
      server.closeAllConnections?.();
      resolve();
    };
    // close() 는 새 연결만 막는다. 응답을 기다리지 않는 keep-alive 소켓은
    // 따로 닫아 주지 않으면 영영 남아서 콜백이 오지 않는다.
    server.close(() => finish("all connections ended"));
    server.closeIdleConnections?.();
    const poll = setInterval(() => {
      server.closeIdleConnections?.();
      if (state.inflight === 0) finish("drained");
    }, pollMs);
    poll.unref?.();
    const deadline = setTimeout(() => finish("drain timeout"), timeoutMs);
    deadline.unref?.();
  }).finally(() => {
    void closeUpstreamAgent();
  });
  return state.drain;
}

/**
 * SIGTERM/SIGINT 를 drain 으로 연결한다. `once` 라서 두 번째 시그널은 Node
 * 기본 동작으로 되돌아간다 — 기다리기 싫으면 한 번 더 보내면 된다.
 */
export function installSignalHandlers(server: Server, { timeoutMs = DEFAULT_DRAIN_MS, exit = (code: number) => process.exit(code) } = {}): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      process.stderr.write(`fx-v3-bridge received ${signal}\n`);
      void drainAndClose(server, { timeoutMs }).then(() => exit(0));
    });
  }
}

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
    catalog.data = removeDirectProviderModels(proxied.data);
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
  // 값이 잘못됐으면 종료할 때가 아니라 지금 안다.
  drainTimeoutMs(env);
  const server: Server = createServer((req, res) => {
    void (async () => {
      const state = bridgeState(server);
      const url = new URL(req.url ?? "/", `http://${config.bind}`);
      if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
        // 진행 중인 호출 수를 같이 알린다. 낡은 브리지를 갈지 말지는 밖에서
        // 이 수를 보고 정한다 — 붙어 있는 세션이 턴 중이면 갈지 않는다.
        // 종료 중이면 살아 있다고 답하지 않는다. 곧 죽을 프로세스에 새 세션이
        // 붙는 것보다 새로 띄우는 편이 맞다.
        sendJson(res, state.draining ? 503 : 200, {
          ok: !state.draining,
          service: "fx-v3-bridge",
          startedAt: STARTED_AT,
          inflight: state.inflight,
          draining: state.draining,
        });
        return;
      }
      if (state.draining) {
        sendJson(res, 503, { error: { type: "shutting_down", message: "fx-v3-bridge is draining" } });
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
        state.inflight += 1;
        try {
          await proxyChat(config, req, res);
        } finally {
          state.inflight -= 1;
        }
        return;
      }
      sendJson(res, 404, { error: { type: "not_found", message: url.pathname } });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "bridge failed";
      if (!res.headersSent) sendJson(res, 500, { error: { type: "bridge_error", message: sanitizeLog(message) } });
      else if (!res.writableEnded) res.end();
    });
  });

  // 업스트림 Agent 는 서버보다 오래 사는 모듈 싱글턴이다. 서버를 닫는 쪽이
  // 연결까지 회수하지 않으면 테스트와 재기동에서 소켓이 남는다.
  server.on("close", () => {
    void closeUpstreamAgent();
  });

  server.listen(config.port, config.bind, () => {
    // 실제로 잡은 포트를 찍는다. 설정값을 찍으면 포트 0(자동 할당)일 때
    // 로그가 거짓말을 한다.
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : config.port;
    process.stderr.write(`fx-v3-bridge listening on http://${config.bind}:${port} (pid ${process.pid})\n`);
  });
  bridgeState(server);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = startBridge();
  installSignalHandlers(server, { timeoutMs: drainTimeoutMs(process.env) });
}
