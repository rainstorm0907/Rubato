import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { startBridge } from "../src/server.ts";
import { isolatedAdminEnv } from "./helpers.ts";

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

test("OpenCodex receives the fx session as affinity header and prompt cache key", async () => {
  let receivedSession: string | null = null;
  let receivedCacheKey: string | undefined;
  const upstream = createServer(async (req, res) => {
    receivedSession = req.headers["session-id"] as string | undefined ?? null;
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    receivedCacheKey = JSON.parse(raw).prompt_cache_key;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\ndata: [DONE]\n\n`);
  });
  const upstreamPort = await listen(upstream);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  }));
  const bridgePort = await new Promise<number>((resolve) => {
    const check = () => {
      const address = bridge.address();
      if (address && typeof address !== "string") resolve(address.port);
      else setTimeout(check, 10);
    };
    check();
  });
  const response = await fetch(`http://127.0.0.1:${bridgePort}/v3/ai/language-model`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ai-language-model-id": "gpt-5.6-sol",
      "x-session-id": "fx-session-123",
    },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  await response.text();
  assert.equal(receivedSession, "fx-session-123");
  assert.equal(receivedCacheKey, "fx-session-123");
  await new Promise((resolve) => bridge.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

test("client disconnect aborts a non-direct OpenCodex request", async () => {
  let aborted = false;
  const upstream = createServer((req, res) => {
    req.on("aborted", () => {
      aborted = true;
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: response.created
data: {"type":"response.created","response":{"model":"cursor/grok-4.6"}}

`);
  });
  const upstreamPort = await listen(upstream);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    OPENCODEX_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
  }));
  const bridgePort = await new Promise<number>((resolve) => {
    const check = () => {
      const address = bridge.address();
      if (address && typeof address !== "string") resolve(address.port);
      else setTimeout(check, 10);
    };
    check();
  });

  const response = await fetch(`http://127.0.0.1:${bridgePort}/v3/ai/language-model`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ai-language-model-id": "cursor/grok-4.6",
    },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });
  await response.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(aborted, true);
  await new Promise((resolve) => bridge.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});
