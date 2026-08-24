import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  adminSecretPath,
  bridgeState,
  drainAndClose,
  installSignalHandlers,
  startBridge,
  tokensEqual,
  writeAdminSecretFile,
} from "../src/server.ts";
import { isolatedAdminEnv, waitForAdminSecret } from "./helpers.ts";

const SERVER_PATH = fileURLToPath(new URL("../src/server.ts", import.meta.url));
const RESTART_PATH = fileURLToPath(new URL("../../scripts/rubato-restart.sh", import.meta.url));
const SUPERVISOR_PATH = fileURLToPath(new URL("../../scripts/install-supervisor.sh", import.meta.url));

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function portOf(server: Server): Promise<number> {
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

function readToken(path: string): string {
  return readFileSync(path, "utf8").replace(/\r?\n$/, "");
}

function listenerPid(port: number): number | undefined {
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const pid = Number((result.stdout || "").trim().split("\n")[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * 응답을 붙잡고 있다가 풀어 주는 가짜 OpenCodex. 진행 중인 SSE 를 실제로
 * 만들어야 종료가 그것을 끊는지 볼 수 있다.
 */
function slowUpstream() {
  let release: () => void = () => {};
  const started = { count: 0 };
  const server = createServer(async (req, res) => {
    started.count += 1;
    for await (const _chunk of req) {
      /* drain the request body */
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: response.created\ndata: {"type":"response.created"}\n\n`);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    res.write(
      `event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  return { server, started, release: () => release() };
}

async function spawnBridge(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["--experimental-strip-types", SERVER_PATH], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${stderr}`)), 20_000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`bridge exited with ${code}: ${stderr}`));
    };
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", onExit);
  });
  return { child, port, stderr: () => stderr };
}

test("healthz reports how many model calls are in flight", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  }));
  const port = await portOf(bridge);

  const idle = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(idle.inflight, 0);
  assert.equal(idle.draining, false);

  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  while (bridgeState(bridge).inflight === 0) await new Promise((r) => setTimeout(r, 10));
  const busy = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(busy.inflight, 1);

  upstream.release();
  await (await call).text();
  const after = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(after.inflight, 0);

  await new Promise((resolve) => bridge.close(resolve));
  await new Promise((resolve) => upstream.server.close(resolve));
});

test("draining releases the port first and lets the in-flight response finish", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  }));
  const port = await portOf(bridge);

  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  while (bridgeState(bridge).inflight === 0) await new Promise((r) => setTimeout(r, 10));

  const drained = drainAndClose(bridge, { timeoutMs: 10_000, log: () => {} });

  await new Promise((r) => setTimeout(r, 100));
  const replacement = createServer((_req, res) => res.end("replacement"));
  await new Promise<void>((resolve, reject) => {
    replacement.once("error", reject);
    replacement.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => replacement.close(resolve));

  upstream.release();
  const body = await (await call).text();
  assert.match(body, /\[DONE\]/);
  await drained;
  await new Promise((resolve) => upstream.server.close(resolve));
});

test("a drain that overruns its limit still ends", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  }));
  const port = await portOf(bridge);
  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  }).catch(() => undefined);
  while (bridgeState(bridge).inflight === 0) await new Promise((r) => setTimeout(r, 10));

  await drainAndClose(bridge, { timeoutMs: 200, log: () => {} });
  assert.equal(bridgeState(bridge).draining, true);
  upstream.release();
  await call;
  await new Promise((resolve) => upstream.server.close(resolve));
});

test("admin secret file is mode 600", () => {
  const path = join(mkdtempSync(join(tmpdir(), "fx-admin-mode-")), "bridge.admin");
  writeAdminSecretFile(path, "token-value");
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(readToken(path), "token-value");
  unlinkSync(path);
});

test("admin secret path follows the override and platform rules", () => {
  assert.equal(adminSecretPath({ FX_BRIDGE_ADMIN_SECRET: "/tmp/custom.admin" }, 9), "/tmp/custom.admin");
  assert.equal(
    adminSecretPath({ HOME: "/Users/wy", FX_BRIDGE_PLATFORM: "darwin" }, 8788),
    "/Users/wy/Library/Application Support/rubato/bridge-8788.admin",
  );
  assert.equal(
    adminSecretPath({ HOME: "/home/wy", FX_BRIDGE_PLATFORM: "linux", XDG_RUNTIME_DIR: "/run/user/501" }, 8799),
    "/run/user/501/rubato/bridge-8799.admin",
  );
});

test("tokensEqual is length-safe and rejects missing tokens", () => {
  assert.equal(tokensEqual("abc", "abc"), true);
  assert.equal(tokensEqual("abc", "abd"), false);
  assert.equal(tokensEqual("abc", "ab"), false);
  assert.equal(tokensEqual("abc", undefined), false);
  assert.equal(tokensEqual("", ""), false);
});

test("installSignalHandlers ignores SIGTERM and SIGINT", () => {
  const logs: string[] = [];
  const uninstall = installSignalHandlers(undefined, { log: (message) => logs.push(message) });
  process.emit("SIGTERM");
  process.emit("SIGINT");
  uninstall();
  assert.match(logs.join(""), /ignoring SIGTERM/);
  assert.match(logs.join(""), /ignoring SIGINT/);
});

test("POST /admin/drain without a matching token stays up", async () => {
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
  }));
  const port = await portOf(bridge);
  await waitForAdminSecret(bridge);

  const missing = await fetch(`http://127.0.0.1:${port}/admin/drain`, { method: "POST" });
  assert.equal(missing.status, 401);
  const wrong = await fetch(`http://127.0.0.1:${port}/admin/drain`, {
    method: "POST",
    headers: { "x-rubato-admin": "not-the-token" },
  });
  assert.equal(wrong.status, 401);
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.draining, false);
  await new Promise((resolve) => bridge.close(resolve));
});

test("authenticated POST /admin/drain is the only graceful shutdown", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const env = isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    FX_BRIDGE_DRAIN_MS: "20000",
  });
  const { child, port, stderr } = await spawnBridge(env);

  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  while (upstream.started.count === 0) await new Promise((r) => setTimeout(r, 10));

  child.kill("SIGTERM");
  child.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(child.exitCode, null, "ordinary signals must not take the shared bridge down");
  const stillUp = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(stillUp.ok, true);

  const token = readToken(env.FX_BRIDGE_ADMIN_SECRET!);
  const drain = await fetch(`http://127.0.0.1:${port}/admin/drain`, {
    method: "POST",
    headers: { "x-rubato-admin": token },
  });
  assert.equal(drain.status, 202);
  const accepted = await drain.json();
  assert.equal(accepted.draining, true);

  await new Promise((r) => setTimeout(r, 100));
  const replacement = createServer((_req, res) => res.end("replacement"));
  await new Promise<void>((resolve, reject) => {
    replacement.once("error", reject);
    replacement.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => replacement.close(resolve));

  upstream.release();
  const body = await (await call).text();
  assert.match(body, /\[DONE\]/, "in-flight response was cut by drain");

  const [code] = (await once(child, "exit")) as [number | null];
  assert.equal(code, 0);
  assert.match(stderr(), /ignoring SIGTERM/);
  await new Promise((resolve) => upstream.server.close(resolve));
});

test("Bearer token is accepted for /admin/drain", async () => {
  const exits: number[] = [];
  const env = isolatedAdminEnv({ FX_BRIDGE_BIND: "127.0.0.1", FX_BRIDGE_PORT: "0" });
  const bridge = startBridge(env, { exit: (code) => exits.push(code), log: () => {} });
  const port = await portOf(bridge);
  const admin = await waitForAdminSecret(bridge);
  const drain = await fetch(`http://127.0.0.1:${port}/admin/drain`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(drain.status, 202);
  const deadline = Date.now() + 2_000;
  while (exits.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepEqual(exits, [0]);
});

test("restart script secret path matches the server", () => {
  const script = spawnSync("sh", ["-c", '. "$1"; admin_secret_path "$2"', "sh", RESTART_PATH, "8791"], {
    encoding: "utf8",
    env: {
      ...process.env,
      RUBATO_RESTART_LIB: "1",
      FX_BRIDGE_PLATFORM: "darwin",
      HOME: "/Users/wy",
    },
  });
  if (script.error) throw script.error;
  assert.equal(script.status, 0, script.stderr);
  assert.equal(script.stdout.trim(), adminSecretPath({ HOME: "/Users/wy", FX_BRIDGE_PLATFORM: "darwin" }, 8791));
});

test("supervisor plan recovers crashes, not successful drains", () => {
  const plan = spawnSync("sh", [SUPERVISOR_PATH], { encoding: "utf8", env: { ...process.env } });
  if (plan.error) throw plan.error;
  assert.equal(plan.status, 0, plan.stderr);
  const text = `${plan.stdout}${plan.stderr}`;
  assert.match(text, /KeepAlive crashed-only|Restart=on-failure/);
  assert.doesNotMatch(text, /KeepAlive=false|Restart=no/);
});

test("rubato-restart drains and health-checks a live bridge on a non-default port", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fx-restart-"));
  const secret = join(dir, "bridge.admin");
  const log = join(dir, "bridge.log");
  const { child, port } = await spawnBridge({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    FX_BRIDGE_ADMIN_SECRET: secret,
    FX_BRIDGE_DRAIN_MS: "5000",
  });

  let restartOut = "";
  const restart = spawn("sh", [RESTART_PATH], {
    env: {
      ...process.env,
      FX_BRIDGE_PORT: String(port),
      FX_BRIDGE_ADMIN_SECRET: secret,
      RUBATO_BROKER_LOG: log,
      RUBATO_RESTART_DRAIN_ITERS: "40",
      RUBATO_RESTART_HEALTH_ITERS: "80",
      RUBATO_RESTART_SLEEP: "0.1",
      RUBATO_SUPERVISOR_LABEL: "dev.rubato.bridge.test-unused",
      RUBATO_SUPERVISOR_UNIT: "rubato-bridge-test-unused.service",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  restart.stdout.on("data", (chunk) => {
    restartOut += chunk.toString();
  });
  restart.stderr.on("data", (chunk) => {
    restartOut += chunk.toString();
  });
  const [code] = (await once(restart, "exit")) as [number | null];
  assert.equal(code, 0, `restart failed: ${restartOut}`);

  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.draining, false);
  assert.notEqual(child.exitCode, null);

  const replacementPid = listenerPid(port);
  if (replacementPid) {
    try {
      process.kill(replacementPid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
});
