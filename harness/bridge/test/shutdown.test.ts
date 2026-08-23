import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { bridgeState, drainAndClose, startBridge } from "../src/server.ts";

const SERVER_PATH = fileURLToPath(new URL("../src/server.ts", import.meta.url));

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

test("healthz reports how many model calls are in flight", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const bridge = startBridge({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  });
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
  const bridge = startBridge({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  });
  const port = await portOf(bridge);

  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  while (bridgeState(bridge).inflight === 0) await new Promise((r) => setTimeout(r, 10));

  const drained = drainAndClose(bridge, { timeoutMs: 10_000, log: () => {} });

  // 리스닝 소켓은 곧바로 놓는다. 새 브리지가 이 대기와 무관하게 포트를 잡을
  // 수 있어야 재기동이 세션을 굶기지 않는다.
  await new Promise((r) => setTimeout(r, 100));
  const replacement = createServer((_req, res) => res.end("replacement"));
  await new Promise<void>((resolve, reject) => {
    replacement.once("error", reject);
    replacement.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => replacement.close(resolve));

  // 그리고 흐르던 응답은 끊기지 않는다.
  upstream.release();
  const body = await (await call).text();
  assert.match(body, /\[DONE\]/);
  await drained;
  await new Promise((resolve) => upstream.server.close(resolve));
});

test("a drain that overruns its limit still ends", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);
  const bridge = startBridge({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  });
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

test("SIGTERM does not cut a response that is already streaming", async () => {
  const upstream = slowUpstream();
  const upstreamPort = await listen(upstream.server);

  const child = spawn(process.execPath, ["--experimental-strip-types", SERVER_PATH], {
    env: {
      ...process.env,
      FX_BRIDGE_BIND: "127.0.0.1",
      FX_BRIDGE_PORT: "0",
      OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      FX_BRIDGE_DRAIN_MS: "20000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${stderr}`)), 20_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => reject(new Error(`bridge exited with ${code}: ${stderr}`)));
  });

  const call = fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": "gpt-5.6-sol" },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  while (upstream.started.count === 0) await new Promise((r) => setTimeout(r, 10));

  child.kill("SIGTERM");
  // 시그널을 받고도 프로세스는 남아 있어야 한다. 즉사하면 아래 응답이 소켓
  // 끊김으로 끝난다 — 그게 세션들이 턴 한가운데서 죽던 모습이다.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(child.exitCode, null, "bridge died before draining");

  upstream.release();
  const body = await (await call).text();
  assert.match(body, /\[DONE\]/, "in-flight response was cut by SIGTERM");

  const [code] = (await once(child, "exit")) as [number | null];
  assert.equal(code, 0);
  assert.match(stderr, /received SIGTERM/);
  await new Promise((resolve) => upstream.server.close(resolve));
});
