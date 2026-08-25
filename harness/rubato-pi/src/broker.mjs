import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { senpiNested } from "./engine-paths.mjs";

const { getBuiltinModel } = await import(
  pathToFileURL(senpiNested("@earendil-works/pi-ai/dist/providers/all.js")).href
);
import { CACHE_RETENTION } from "./defaults.mjs";

export const DEFAULT_BROKER_URL = "http://127.0.0.1:8788";

const CONTEXT_WINDOW_OVERRIDES = Object.freeze({
  "gpt-5.6-sol": 272_000,
  "gpt-5.6-terra": 272_000,
  "gpt-5.6-luna": 272_000,
});

export const FALLBACK_CATALOG = Object.freeze([
  { id: "xai/grok-4.6", name: "Grok 4.6" },
  { id: "anthropic/claude-opus-5", name: "Opus 5" },
  { id: "anthropic/claude-sonnet-5", name: "Sonnet 5" },
  { id: "anthropic/claude-haiku-4-5", name: "Haiku 4.5" },
  { id: "openai-codex/gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "openai-codex/gpt-5.6-terra", name: "GPT-5.6 Terra" },
  { id: "openai-codex/gpt-5.6-luna", name: "GPT-5.6 Luna" },
]);

export function brokerUrl(env = process.env) {
  return (env.RUBATO_BROKER_URL ?? DEFAULT_BROKER_URL).replace(/\/$/, "");
}

export function startScriptPath() {
  return fileURLToPath(new URL("../../scripts/start.sh", import.meta.url));
}

export function catalogId(model) {
  return `${model.provider}/${model.id}`;
}

export function splitCatalogId(id) {
  const slash = id.indexOf("/");
  if (slash <= 0) return { provider: "rubato", id };
  return { provider: id.slice(0, slash), id: id.slice(slash + 1) };
}

// pi-ai 가 모르는 prefix 는 getBuiltinModel 이 통째로 undefined 를 준다. 그러면
// 모달리티가 ["text"] 로 떨어지고 read 도구가 이미지를 조용히 버린다.
// google-antigravity 는 우리가 지어낸 prefix 라 (pi-ai 는 google/google-vertex 만
// 안다) 붙는 순간 그 구멍에 그대로 빠졌다. 실제 백엔드는 이미지를 받는다:
// "The Antigravity agent supports multimodal inputs. Currently, only text and
// image inputs are supported." — ai.google.dev/gemini-api/docs/antigravity-agent
//
// 새 프로바이더를 붙일 때 pi-ai 가 그 prefix 를 모르면 여기에 같이 적어라.
const PROVIDER_INPUT_FALLBACK = Object.freeze({
  "google-antigravity": Object.freeze(["text", "image"]),
});

export function catalogLimits(provider, id) {
  const builtin = getBuiltinModel(provider, id);
  const fallbackInput = PROVIDER_INPUT_FALLBACK[provider];
  return {
    contextWindow: CONTEXT_WINDOW_OVERRIDES[id] ?? builtin?.contextWindow ?? 200_000,
    maxTokens: builtin?.maxTokens || 16_384,
    // 이미지 첨부는 이 배열로 판정된다. builtin 이 아는 모달리티를 그대로 쓴다.
    // 여기서 ["text"] 로 깎으면 read 도구가 이미지를 조용히 버린다.
    input: builtin?.input?.length ? [...builtin.input] : [...(fallbackInput ?? ["text"])],
  };
}

export function groupCatalog(entries) {
  const grouped = {};
  for (const entry of entries) {
    const { provider, id } = splitCatalogId(entry.id);
    const limits = catalogLimits(provider, id);
    (grouped[provider] ??= []).push({
      id,
      name: entry.name ?? id,
      reasoning: true,
      input: limits.input,
      contextWindow: limits.contextWindow,
      maxTokens: limits.maxTokens,
      ...(provider === "anthropic" ? { cacheRetention: CACHE_RETENTION } : {}),
    });
  }
  return grouped;
}

export function brokerUp(url, { fetchImpl = fetch } = {}) {
  return fetchImpl(`${url}/coding-agent/v1/models`, { signal: AbortSignal.timeout(1500) })
    .then((res) => res.ok)
    .catch(() => false);
}

// 브리지 로그는 재부팅을 넘겨야 한다. $TMPDIR 에 두면 재부팅에 날아가서, 뒤늦게
// "브리지가 왜 죽었나"를 물을 때 볼 것이 남지 않는다 — 35시간 재시작 24회의
// 유발자를 개별 귀속하지 못한 이유가 그것이었다.
//
// 규칙은 rubato-restart.sh 와 같아야 한다. 거기 주석도 같이 고쳐라.
export function brokerLogPath(env = process.env) {
  if (env.RUBATO_BROKER_LOG) return env.RUBATO_BROKER_LOG;
  const home = env.HOME || homedir();
  if (!home) return join(env.TMPDIR || tmpdir(), "fx-bridge.log");
  if (process.platform === "darwin") return join(home, "Library", "Logs", "rubato", "bridge.log");
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "rubato", "bridge.log");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function startBroker({ env = process.env, spawn: spawnImpl = spawn } = {}) {
  const logPath = brokerLogPath(env);
  // 로그 디렉터리는 처음 한 번 만들어야 한다. 없으면 openSync 가 던지고 브리지가
  // 뜨지 않는다 — 로그 자리를 옮긴 대가로 세션이 안 뜨는 것은 말이 안 된다.
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    // 만들 수 없어도 아래 openSync 가 사유를 들고 실패한다.
  }
  const fd = openSync(logPath, "a");
  try {
    const child = spawnImpl("bash", [startScriptPath()], {
      env: { ...env, FX_CACHE_RETENTION: env.FX_CACHE_RETENTION ?? CACHE_RETENTION },
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child?.unref?.();
    return child;
  } finally {
    closeSync(fd);
  }
}

// 브리지 소스 중 가장 최근에 고쳐진 시각. 살아 있는 브리지가 이보다 먼저
// 떴으면 낡은 코드를 돌고 있는 것이다.
//
// 파일 이름을 나열하지 않고 디렉터리를 훑는다. 목록을 손으로 관리하면 새
// 파일이 반드시 빠진다 — 실제로 `upstream-dispatcher.ts`(트랜스포트 자체)가
// 빠져서, 고친 브리지를 두고도 새 세션이 낡은 프로세스에 그대로 붙었다.
export function bridgeSourceMtimeMs() {
  const bridgeDir = fileURLToPath(new URL("../../bridge/src/", import.meta.url));
  const times = readdirSync(bridgeDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => statSync(join(bridgeDir, name)).mtimeMs);
  // 소스를 읽을 수 없으면 재시작을 강요하지 않는다 — 판단 불가일 뿐 낡은 것은
  // 아니다. 0 을 주면 살아 있는 브리지가 항상 신선한 것으로 통과한다.
  return times.length > 0 ? Math.max(...times) : 0;
}

export function restartBroker({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  return spawnSyncImpl("sh", [fileURLToPath(new URL("../../scripts/rubato-restart.sh", import.meta.url))], {
    env,
    stdio: "ignore",
  });
}

// 브리지 상태를 한 번 읽는다. `-m` 없이 curl 을 부르면 브리지가 응답을 못
// 주는 동안 세션 시작이 영영 멈춘다 — 붙은 세션이 여럿이면 그게 곧 "rubato 가
// 안 켜진다" 이다. 판정에는 상한을 둔다.
export function probeBridge(url, { spawnSyncImpl = spawnSync, sourceMtime = bridgeSourceMtimeMs, timeoutSec = 8 } = {}) {
  const probe = spawnSyncImpl("curl", ["-sf", "-m", String(timeoutSec), `${url}/healthz`], { encoding: "utf8" });
  if (probe.status !== 0) return { up: false, fresh: false, inflight: null };
  try {
    const health = JSON.parse(probe.stdout);
    // inflight 를 안 실어 보내는 브리지(우리 것보다 낡은 것)는 "0 이다" 가
    // 아니라 "모른다" 이다. 아래에서 모르는 것은 죽이지 않는다.
    const inflight = Number.isFinite(Number(health.inflight)) ? Number(health.inflight) : null;
    return { up: true, fresh: Number(health.startedAt) >= sourceMtime(), inflight };
  } catch {
    return { up: true, fresh: false, inflight: null };
  }
}

function normalizeState(value) {
  if (typeof value === "boolean") return { up: value, fresh: value, inflight: value ? 0 : null };
  return { up: Boolean(value.up), fresh: Boolean(value.fresh), inflight: value.inflight ?? null };
}

export function ensureBroker({
  env = process.env,
  isUp,
  start,
  restart,
  sourceMtime = bridgeSourceMtimeMs,
  sleep = sleepSync,
  tries = 40,
  intervalMs = 250,
  // 죽었다는 판정은 한 번으로 하지 않는다. 브리지가 여러 세션의 SSE 로 바쁘면
  // 한 번쯤 늦게 답할 수 있고, 그 한 번이 곧바로 재기동으로 이어지면 살아 있는
  // 브리지가 남의 사정으로 죽는다.
  downTries = 3,
  downIntervalMs = 400,
  warn = (message) => process.stderr.write(message),
} = {}) {
  const url = brokerUrl(env);
  const check = isUp ?? ((target) => probeBridge(target, { sourceMtime }));
  const read = () => normalizeState(check(url));

  let state = read();
  for (let attempt = 1; !state.up && attempt < downTries; attempt++) {
    sleep(downIntervalMs);
    state = read();
  }
  if (state.up && state.fresh) return { ok: true, started: false, url };

  // 낡았지만 살아 있다. 진행 중인 모델 호출이 있으면(또는 있는지 알 수 없으면)
  // 갈아치우지 않는다 — 남의 세션의 턴이 소켓 끊김으로 끝나는 것보다 낡은
  // 코드로 한 턴 더 도는 쪽이 낫다. 다음 한가한 순간이나 `rubato restart` 가
  // 가져간다.
  if (state.up && !state.fresh) {
    const busy = state.inflight === null || state.inflight > 0;
    if (busy) {
      const detail = state.inflight === null
        ? "진행 중인 호출 수를 알리지 않는 브리지"
        : `진행 중인 호출 ${state.inflight}건`;
      warn(`rubato: 브리지 코드가 낡았지만 ${detail} 때문에 재시작하지 않는다. 한가할 때 \`rubato restart\`.\n`);
      return { ok: true, started: false, stale: true, url };
    }
  }

  const result = state.up
    ? (restart ?? (() => restartBroker({ env })))()
    : (start ?? (() => startBroker({ env })))();
  if (result && typeof result.status === "number" && result.status !== 0) {
    throw new Error(`rubato broker failed to start at ${url}`);
  }
  for (let attempt = 0; attempt < tries; attempt++) {
    const next = read();
    if (next.up && next.fresh) return { ok: true, started: true, url };
    if (attempt + 1 < tries) sleep(intervalMs);
  }
  throw new Error(`rubato broker did not come up at ${url}`);
}

export async function loadCatalog({ env = process.env, fetchImpl = fetch } = {}) {
  const url = brokerUrl(env);
  try {
    const res = await fetchImpl(`${url}/coding-agent/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return FALLBACK_CATALOG;
    const payload = await res.json();
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.length > 0 ? data : FALLBACK_CATALOG;
  } catch {
    return FALLBACK_CATALOG;
  }
}
