import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const ADMIN_TOKEN_BYTES = 32;
const DEFAULT_ADMIN_TOKEN_HEADER = "x-rubato-admin";

/**
 * 낡은 코드로 뜬 브리지가 스스로 물러나는 자리.
 *
 * 판정은 세션이 시작될 때 `ensureBroker` 도 한다. 그런데 그 순간 다른 세션이
 * 호출 중이면 건너뛰고, 그다음 누가 새 세션을 열기 전까지는 아무도 다시 보지
 * 않는다 — 낡은 채로 계속 도는 창이 그렇게 열렸다. 바쁠 때를 피하는 것이
 * 목적이었지 영영 미루는 것이 목적이 아니었으므로, 한가해지는 순간에 여기서
 * 이어받는다.
 *
 * 기준은 `ensureBroker` 와 같아야 한다: 소스가 내 시작 시각보다 새로우면 낡은
 * 것이고, 진행 중인 호출이 0 일 때만 간다. 규칙을 고치면 broker.mjs 도 같이.
 */
const IDLE_RETIRE_DELAY_MS = 2_000;

function bridgeSourceMtimeMs(): number {
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const times = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => statSync(join(dir, name)).mtimeMs);
    return times.length > 0 ? Math.max(...times) : 0;
  } catch {
    // 소스를 못 읽는 것은 "낡았다"가 아니라 "판단 불가"다. 0 을 주면 아래
    // 비교가 항상 거짓이 되어 살아 있는 브리지를 건드리지 않는다.
    return 0;
  }
}

export function isStaleAgainstSource(
  startedAt: number,
  sourceMtime: number = bridgeSourceMtimeMs(),
): boolean {
  return sourceMtime > 0 && sourceMtime > startedAt;
}

export type AdminSecret = {
  path: string;
  token: string;
};

type BridgeState = {
  /** 진행 중인 업스트림 모델 호출 수. /healthz 가 이 수를 내보낸다. */
  inflight: number;
  /** 종료 중인가. 종료 중에는 새 요청을 받지 않는다. */
  draining: boolean;
  drain?: Promise<void>;
  admin?: AdminSecret;
};

/**
 * 런타임 관리 비밀 파일 자리. 재기동 스크립트와 같은 규칙을 써야 한다.
 * 포트마다 갈라 두는 이유는 한 머신에서 클론을 여럿 돌릴 때 비밀이 섞이지
 * 않게 하기 위해서다. 경로를 덮으려면 FX_BRIDGE_ADMIN_SECRET 을 준다.
 */
export function adminSecretPath(env: NodeJS.ProcessEnv = process.env, port = 8788): string {
  if (env.FX_BRIDGE_ADMIN_SECRET) return env.FX_BRIDGE_ADMIN_SECRET;
  const platform = env.FX_BRIDGE_PLATFORM || process.platform;
  const home = env.HOME;
  if (home && platform === "darwin") {
    return `${home}/Library/Application Support/rubato/bridge-${port}.admin`;
  }
  if (home) {
    return `${env.XDG_RUNTIME_DIR ?? env.XDG_STATE_HOME ?? `${home}/.local/state`}/rubato/bridge-${port}.admin`;
  }
  return `${env.TMPDIR ?? "/tmp"}/rubato-bridge-${port}.admin`;
}

export function writeAdminSecretFile(path: string, token = randomBytes(ADMIN_TOKEN_BYTES).toString("hex")): AdminSecret {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
  // umask 가 mode 를 가릴 수 있다. 쓴 뒤에 다시 조인다.
  chmodSync(path, 0o600);
  return { path, token };
}

export function tokensEqual(expected: string, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function adminTokenFromRequest(req: IncomingMessage): string | undefined {
  const presented = header(req, DEFAULT_ADMIN_TOKEN_HEADER);
  if (presented) return presented;
  const authorization = header(req, "authorization");
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(authorization);
  return match?.[1];
}

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
  {
    timeoutMs = DEFAULT_DRAIN_MS,
    log = (message: string) => {
      process.stderr.write(message);
    },
    pollMs = 100,
  }: { timeoutMs?: number; log?: (message: string) => void; pollMs?: number } = {},
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
 * SIGTERM/SIGINT 를 무시한다. 공유 브리지는 세션·자식의 종료 신호로
 * 내려가면 안 된다. 정상 종료는 인증된 POST /admin/drain 뿐이다.
 * SIGKILL 은 잡을 수 없으니 supervisor 가 크래시 되살림을 맡는다.
 */
export function installSignalHandlers(
  _server?: Server,
  {
    log = (message: string) => process.stderr.write(message),
    signals = ["SIGTERM", "SIGINT"] as const,
  }: { log?: (message: string) => void; signals?: readonly NodeJS.Signals[] } = {},
): () => void {
  const attached: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];
  for (const signal of signals) {
    const handler = () => {
      log(`fx-v3-bridge ignoring ${signal}; drain only via authenticated POST /admin/drain\n`);
    };
    process.on(signal, handler);
    attached.push({ signal, handler });
  }
  return () => {
    for (const { signal, handler } of attached) process.off(signal, handler);
  };
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
  env: NodeJS.ProcessEnv = process.env,
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
        env,
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

/**
 * `listen` 이 실패했을 때 무엇을 할지. 포트를 이미 누가 잡고 있는 것은 사고가
 * 아니라 **이미 브리지가 있다**는 뜻이다 — 세션들은 그쪽에 붙어 있고, 우리가
 * 할 일은 없다. 조용히 물러나되 exit 0 으로 나간다: supervisor 를 붙였을 때
 * 실패로 읽히면 재기동 루프가 되고, 그 루프가 `rubato-restart.sh` 가 띄운
 * 인스턴스와 포트를 두고 계속 다툰다.
 *
 * 그 밖의 listen 오류(권한, 잘못된 주소)는 진짜 실패다. 1 로 나가서 보이게 한다.
 */
export function listenErrorAction(error: NodeJS.ErrnoException, bind: string, port: number): { exitCode: number; message: string } {
  if (error.code === "EADDRINUSE") {
    return {
      exitCode: 0,
      message: `fx-v3-bridge: ${bind}:${port} is already served by another bridge; leaving it alone\n`,
    };
  }
  return { exitCode: 1, message: `fx-v3-bridge: cannot listen on ${bind}:${port}: ${error.message}\n` };
}

export function startBridge(
  env: NodeJS.ProcessEnv = process.env,
  {
    log = (message: string) => {
      process.stderr.write(message);
    },
    exit = (code: number) => {
      process.exit(code);
    },
  }: { log?: (message: string) => void; exit?: (code: number) => void } = {},
) {
  const config = loadConfig(env);
  // 값이 잘못됐으면 종료할 때가 아니라 지금 안다.
  drainTimeoutMs(env);
  let retiring = false;
  /**
   * 마지막 호출이 끝난 자리에서 한 번 본다. 낡았고 한가하면 스스로 drain 하고
   * exit 0 으로 나간다 — supervisor 는 정상 종료를 되살리지 않으므로, 다음 세션의
   * `ensureBroker` 가 리스너 없음을 보고 새 코드로 띄운다.
   *
   * 곧바로 나가지 않고 잠깐 두는 이유: 도구 루프는 호출과 호출 사이가 붙어 있어서
   * inflight 가 0 을 스치는 순간이 턴 중에도 생긴다. 그 틈에 나가면 사용자가
   * 체감하는 것은 "업데이트"가 아니라 "턴이 끊겼다"이다. 유예 뒤 다시 0 인지 본다.
   */
  const maybeRetireWhenIdle = () => {
    if (retiring || env.RUBATO_NO_IDLE_RETIRE) return;
    const state = bridgeState(server);
    if (state.draining || state.inflight > 0) return;
    if (!isStaleAgainstSource(STARTED_AT)) return;
    retiring = true;
    const timer = setTimeout(() => {
      const now = bridgeState(server);
      if (now.draining || now.inflight > 0) {
        retiring = false;
        return;
      }
      log("fx-v3-bridge: 코드가 낡았고 한가하다. 스스로 물러난다 (다음 세션이 새 코드로 띄운다)\n");
      void drainAndClose(server, { timeoutMs: drainTimeoutMs(env), log }).then(() => exit(0));
    }, IDLE_RETIRE_DELAY_MS);
    // 이 타이머 하나 때문에 프로세스가 살아 있을 이유는 없다.
    timer.unref?.();
  };
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
      if (req.method === "POST" && url.pathname === "/admin/drain") {
        // 인증된 drain 만 정상 종료다. 응답을 먼저 닫고 나서 소켓을 거둔다 —
        // closeAllConnections 가 이 요청을 중간에 끊으면 재기동 스크립트가
        // 202 를 못 읽고 실패로 오해한다.
        const secret = state.admin?.token;
        if (!tokensEqual(secret ?? "", adminTokenFromRequest(req))) {
          sendJson(res, 401, { error: { type: "unauthorized", message: "invalid admin token" } });
          return;
        }
        sendJson(res, 202, {
          ok: true,
          draining: true,
          inflight: state.inflight,
        });
        void drainAndClose(server, { timeoutMs: drainTimeoutMs(env), log }).then(() => exit(0));
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
          await proxyChat(config, req, res, env);
        } finally {
          state.inflight -= 1;
          maybeRetireWhenIdle();
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

  // 핸들러가 없으면 listen 실패가 unhandled 'error' 로 프로세스를 죽인다.
  // 포트 경합은 흔한 일이라 그 죽음이 곧 크래시 루프가 된다.
  server.on("error", (error: NodeJS.ErrnoException) => {
    const { exitCode, message } = listenErrorAction(error, config.bind, config.port);
    log(message);
    exit(exitCode);
  });

  server.listen(config.port, config.bind, () => {
    // 실제로 잡은 포트를 찍는다. 설정값을 찍으면 포트 0(자동 할당)일 때
    // 로그가 거짓말을 한다.
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : config.port;
    const state = bridgeState(server);
    try {
      state.admin = writeAdminSecretFile(adminSecretPath(env, port));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`fx-v3-bridge: cannot write admin secret: ${message}\n`);
      exit(1);
      return;
    }
    log(`fx-v3-bridge listening on http://${config.bind}:${port} (pid ${process.pid})\n`);
    log(`fx-v3-bridge admin secret: ${state.admin.path}\n`);
  });
  bridgeState(server);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBridge();
  installSignalHandlers();
}
