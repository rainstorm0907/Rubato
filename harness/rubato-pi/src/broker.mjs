import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export function catalogLimits(provider, id) {
  const builtin = getBuiltinModel(provider, id);
  return {
    contextWindow: CONTEXT_WINDOW_OVERRIDES[id] ?? builtin?.contextWindow ?? 200_000,
    maxTokens: builtin?.maxTokens || 16_384,
    // 이미지 첨부는 이 배열로 판정된다. builtin 이 아는 모달리티를 그대로 쓴다.
    // 여기서 ["text"] 로 깎으면 read 도구가 이미지를 조용히 버린다.
    input: builtin?.input?.length ? [...builtin.input] : ["text"],
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

export function brokerLogPath(env = process.env) {
  return env.RUBATO_BROKER_LOG ?? join(env.TMPDIR || tmpdir(), "fx-bridge.log");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function startBroker({ env = process.env, spawn: spawnImpl = spawn } = {}) {
  const fd = openSync(brokerLogPath(env), "a");
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

export function bridgeSourceMtimeMs() {
  const bridgeDir = fileURLToPath(new URL("../../bridge/src/", import.meta.url));
  return Math.max(
    ...["server.ts", "models.ts", "direct-provider.ts", "fx-request.ts", "fx-stream.ts"]
      .map((name) => statSync(join(bridgeDir, name)).mtimeMs),
  );
}

export function restartBroker({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  return spawnSyncImpl("sh", [fileURLToPath(new URL("../../scripts/rubato-restart.sh", import.meta.url))], {
    env,
    stdio: "ignore",
  });
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
} = {}) {
  const url = brokerUrl(env);
  const check = isUp ?? (() => {
    const probe = spawnSync("curl", ["-sf", `${url}/healthz`], { encoding: "utf8" });
    if (probe.status !== 0) return { up: false, fresh: false };
    try {
      const health = JSON.parse(probe.stdout);
      return { up: true, fresh: Number(health.startedAt) >= sourceMtime() };
    } catch {
      return { up: true, fresh: false };
    }
  });
  const initial = check(url);
  const state = typeof initial === "boolean" ? { up: initial, fresh: initial } : initial;
  if (state.up && state.fresh) return { ok: true, started: false, url };
  const result = state.up
    ? (restart ?? (() => restartBroker({ env })))()
    : (start ?? (() => startBroker({ env })))();
  if (result && typeof result.status === "number" && result.status !== 0) {
    throw new Error(`rubato broker failed to start at ${url}`);
  }
  for (let attempt = 0; attempt < tries; attempt++) {
    const checked = check(url);
    const next = typeof checked === "boolean" ? { up: checked, fresh: checked } : checked;
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
