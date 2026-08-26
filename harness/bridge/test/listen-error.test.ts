import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { listenErrorAction, startBridge } from "../src/server.ts";
import { isolatedAdminEnv } from "./helpers.ts";

const SERVER_PATH = fileURLToPath(new URL("../src/server.ts", import.meta.url));

async function occupy(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => res.end("squatter"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, port: address.port };
}

test("a taken port is not a crash — the bridge steps aside with exit 0", async () => {
  const { server: squatter, port } = await occupy();
  const logs: string[] = [];
  const exits: number[] = [];
  const bridge = startBridge(
    isolatedAdminEnv({ FX_BRIDGE_BIND: "127.0.0.1", FX_BRIDGE_PORT: String(port) }),
    { log: (message) => logs.push(message), exit: (code) => exits.push(code) },
  );
  await once(bridge, "error");
  // 이벤트 핸들러가 도는 틱을 준다.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(exits, [0], "포트 경합으로 실패 코드를 내면 supervisor 가 재기동 루프에 빠진다");
  assert.match(logs.join(""), /already served by another bridge/);
  bridge.close();
  await new Promise((resolve) => squatter.close(resolve));
});

test("a listen failure that is not a port fight stays visible", () => {
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  assert.deepEqual(listenErrorAction(denied, "127.0.0.1", 80), {
    exitCode: 1,
    message: "fx-v3-bridge: cannot listen on 127.0.0.1:80: permission denied\n",
  });
  const taken = Object.assign(new Error("address in use"), { code: "EADDRINUSE" });
  assert.equal(listenErrorAction(taken, "127.0.0.1", 8788).exitCode, 0);
});

test("a second bridge process on a busy port exits 0 instead of crashing", async () => {
  const { server: squatter, port } = await occupy();
  const child = spawn(process.execPath, ["--experimental-strip-types", SERVER_PATH], {
    env: { ...process.env, FX_BRIDGE_BIND: "127.0.0.1", FX_BRIDGE_PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = (await once(child, "exit")) as [number | null];

  assert.equal(code, 0, `bridge exited with ${code}: ${stderr}`);
  assert.match(stderr, /already served by another bridge/);
  assert.doesNotMatch(stderr, /EADDRINUSE[\s\S]*at Server/, "unhandled 'error' 로 죽었다");
  await new Promise((resolve) => squatter.close(resolve));
});

test("a supervised bridge waits in-process until a busy port is released", async () => {
  const { server: squatter, port } = await occupy();
  const exits: number[] = [];
  const logs: string[] = [];
  const bridge = startBridge(
    isolatedAdminEnv({ FX_BRIDGE_BIND: "127.0.0.1", FX_BRIDGE_PORT: String(port), RUBATO_SUPERVISED: "1" }),
    { exit: (code) => exits.push(code), log: (message) => logs.push(message) },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(exits, []);
  assert.match(logs.join(""), /supervisor will retry/);
  await new Promise((resolve) => squatter.close(resolve));
  await new Promise((resolve) => bridge.once("listening", resolve));
  assert.deepEqual(exits, []);
  await new Promise((resolve) => bridge.close(resolve));
});
