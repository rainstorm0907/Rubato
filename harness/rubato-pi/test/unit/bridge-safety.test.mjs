import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 브리지는 세션 여러 개가 동시에 물고 있는 한 프로세스다. 여기 있는 것은
// 전부 "살아 있는 브리지를 남의 사정으로 죽이지 않는다" 한 가지 계약이다.
// 35시간 로그에서 재시작 24회 중 20회가 크래시 흔적 없이 일어났고, 그 정체가
// 우리 코드의 kill 이었다.

const script = (name) => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url));
const read = (name) => readFileSync(script(name), "utf8");

test("the session launcher does not call a 2s health check a death sentence", () => {
  const source = read("rubato-pi.sh");
  const check = source.slice(source.indexOf("RUBATO_NO_BRIDGE_CHECK"), source.indexOf("UPDATE_NOTE=\"\""));
  assert.doesNotMatch(check, /-m 2\b/, "2초 판정은 바쁜 브리지를 죽은 것으로 본다");
  const timeouts = [...check.matchAll(/-m (\d+)/g)].map((match) => Number(match[1]));
  assert.ok(timeouts.length > 0 && timeouts.every((value) => value >= 5), `health timeouts too tight: ${timeouts}`);
  // 한 번 실패로 끝내지 않는다.
  assert.match(check, /for _ in/, "health 판정에 재시도가 없다");
});

test("a bridge that holds the port is never restarted behind the user's back", () => {
  const source = read("rubato-pi.sh");
  const check = source.slice(source.indexOf("RUBATO_NO_BRIDGE_CHECK"), source.indexOf("UPDATE_NOTE=\"\""));
  const listener = check.indexOf("lsof -ti");
  const restart = check.indexOf("rubato-restart.sh");
  assert.ok(listener > 0, "리스너 확인이 없다");
  assert.ok(restart > listener, "리스너를 확인하기 전에 재기동을 부른다");
});

test("restart prepares the replacement before killing the live bridge", () => {
  // node_modules 가 없으면 npm install 이 도는 수십 초 동안 아무 세션도 모델을
  // 못 부른다 — 옛 브리지는 이미 죽어 있기 때문이다. 준비가 먼저다.
  const source = read("rubato-restart.sh");
  const install = source.indexOf("npm install");
  const kill = source.search(/^\s*kill \$pids/m);
  assert.ok(install > 0 && kill > 0);
  assert.ok(install < kill, "옛 브리지를 죽인 뒤에 의존성을 깐다");
  const nodeCheck = source.indexOf("command -v node");
  assert.ok(nodeCheck > 0 && nodeCheck < kill, "새 브리지를 띄울 node 확인이 kill 뒤에 있다");
});

test("restart leaves a line saying who asked for it", () => {
  const source = read("rubato-restart.sh");
  assert.match(source, /rubato-restart .*date/s);
  assert.match(source, /RUBATO_RESTART_REASON/);
});

test("restart waits long enough for the replacement to answer", () => {
  // 6초는 느린 머신에서 그대로 exit 1 이 되었고, 그 실패가 ensureBroker 의
  // throw 로 이어져 세션 시작 자체를 막았다.
  const source = read("rubato-restart.sh");
  const tail = source.slice(source.indexOf("starting bridge"));
  const attempts = Number(tail.match(/\[ "\$n" -lt (\d+) \]/)?.[1] ?? 0);
  const interval = Number(tail.match(/sleep ([\d.]+)/)?.[1] ?? 0);
  assert.ok(attempts * interval >= 20, `replacement wait is only ${attempts * interval}s`);
});

test("restart refuses to kill anything when it cannot start a replacement", (t) => {
  // 실제로 돌려 본다. node 가 없는 PATH 에서는 포트를 건드리기 전에 물러나야 한다.
  const bareNode = ["/usr/bin/node", "/bin/node"].some((path) => existsSync(path));
  if (bareNode) {
    t.skip("this machine has node outside the managed PATH");
    return;
  }
  const run = spawnSync("sh", [script("rubato-restart.sh")], {
    env: {
      PATH: "/usr/bin:/bin",
      HOME: process.env.HOME,
      FX_BRIDGE_PORT: "59787",
      RUBATO_BROKER_LOG: "/dev/null",
      RUBATO_RESTART_REASON: "unit test",
    },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /leaving the live bridge alone/);
  assert.doesNotMatch(run.stderr, /stopping bridge/);
});

test("the bridge answers a signal by draining, not by dying", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../bridge/src/server.ts", import.meta.url)), "utf8");
  assert.match(source, /SIGTERM/);
  assert.match(source, /SIGINT/);
  assert.match(source, /inflight/);
  assert.match(source, /closeIdleConnections/);
});
