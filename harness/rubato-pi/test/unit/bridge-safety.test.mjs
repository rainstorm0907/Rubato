import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brokerLogPath } from "../../src/broker.mjs";

// 브리지는 세션 여러 개가 동시에 물고 있는 한 프로세스다. 여기 있는 것은
// 전부 "살아 있는 브리지를 남의 사정으로 죽이지 않는다" 한 가지 계약이다.
// 35시간 로그에서 재시작 24회 중 20회가 크래시 흔적 없이 일어났고, 그 정체가
// 우리 코드의 kill 이었다.

const script = (name) => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url));
const read = (name) => readFileSync(script(name), "utf8");

/**
 * `rubato-pi.sh` 의 브리지 점검 블록만 떼어 온다.
 *
 * 예전에는 이 파일 두 곳이 스크립트를 문자열로 잘라 정규식으로 검사했다. 끝
 * 앵커로 삼은 줄이 다른 작업(업데이트 확인을 백그라운드로 옮기는 변경) 때문에
 * 블록보다 앞으로 가자 슬라이스가 빈 문자열이 되었고, 검사는 아무것도 보지
 * 않은 채 통과·실패를 오갔다. 보호 로직은 멀쩡한데 검사만 부서진 것이다.
 *
 * 그래서 텍스트 대신 블록을 **실행한다.** 앵커는 블록을 여는 조건 하나뿐이고,
 * 그것이 사라지는 것은 곧 보호가 사라지는 것이라 실패하는 게 맞다.
 */
function bridgeCheckBlock() {
  const lines = read("rubato-pi.sh").split("\n");
  const start = lines.findIndex((line) => line.includes("RUBATO_NO_BRIDGE_CHECK"));
  assert.ok(start >= 0, "브리지 점검 블록이 통째로 사라졌다");
  const end = lines.findIndex((line, index) => index > start && line === "fi");
  assert.ok(end > start, "브리지 점검 블록의 끝을 찾지 못했다");
  return lines.slice(start, end + 1).join("\n");
}

/**
 * 블록을 가짜 curl·lsof·rubato-restart.sh 로 감싸 돌린다. 무엇이 불렸는지가
 * 그대로 관측된다 — 재기동을 불렀는가, health 를 몇 번 어떤 상한으로 물었는가.
 */
function runBridgeCheck({ healthFailures = 99, listener = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rubato-bridge-check-"));
  const stub = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  // 실패 횟수를 세다가 정해진 횟수를 넘기면 성공한다. 인자는 그대로 기록한다.
  stub("curl", [
    'printf "%s\\n" "$*" >>"$STUB_DIR/curl.log"',
    'n=$(cat "$STUB_DIR/curl.count" 2>/dev/null || echo 0)',
    "n=$((n + 1))",
    'printf "%s" "$n" >"$STUB_DIR/curl.count"',
    '[ "$n" -gt "$STUB_HEALTH_FAILURES" ] && exit 0',
    "exit 7",
  ].join("\n"));
  stub("lsof", `exit $STUB_LISTENER`);
  stub("sleep", "exit 0");
  stub("rubato-restart.sh", 'printf "%s\n" "$*" >>"$STUB_DIR/restart.log"');

  const program = ['set -eu', 'splash() { :; }', `HERE="${dir}"`, bridgeCheckBlock()].join("\n");
  const run = spawnSync("sh", ["-c", program], {
    env: {
      PATH: `${dir}:/usr/bin:/bin`,
      STUB_DIR: dir,
      STUB_HEALTH_FAILURES: String(healthFailures),
      STUB_LISTENER: listener ? "0" : "1",
      FX_BRIDGE_PORT: "59788",
    },
    encoding: "utf8",
  });
  const log = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");
  const result = {
    status: run.status,
    stderr: run.stderr,
    restarted: log("restart.log") !== "",
    healthCalls: log("curl.log").trim().split("\n").filter(Boolean),
  };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("a bridge that still holds the port is never restarted behind the user's back", () => {
  // 브리지가 여러 세션의 SSE 로 바쁘면 /health 가 늦는다. 그 늦음을 죽음으로
  // 읽고 재기동하면 남의 턴이 소켓 끊김으로 끝난다.
  const got = runBridgeCheck({ healthFailures: Infinity, listener: true });
  assert.equal(got.restarted, false, "리스너가 살아 있는데 재기동을 불렀다");
  assert.match(got.stderr, /건드리지 않는다/);
  assert.equal(got.status, 0);
});

test("a port with nobody on it still gets a bridge", () => {
  // 죽이지 않는 것과 띄우지 않는 것은 다르다. 아무도 없으면 띄워야 한다.
  const got = runBridgeCheck({ healthFailures: Infinity, listener: false });
  assert.equal(got.restarted, true, "브리지가 없는데도 띄우지 않았다");
});

test("one slow health answer is not a death sentence", () => {
  // 2초 단발 판정이 바쁜 브리지를 죽은 것으로 봤다. 여러 번 묻고, 상한도 넉넉해야 한다.
  const got = runBridgeCheck({ healthFailures: 2, listener: false });
  assert.equal(got.restarted, false, "두 번 늦었다고 재기동했다");
  assert.ok(got.healthCalls.length >= 3, `health 를 ${got.healthCalls.length}번만 물었다`);
  for (const call of got.healthCalls) {
    const timeout = Number(call.match(/-m (\d+)/)?.[1] ?? 0);
    assert.ok(timeout >= 5, `health 상한이 ${timeout}초다: ${call}`);
  }
});

test("restart prepares the replacement before draining the live bridge", () => {
  // node_modules 가 없으면 npm install 이 도는 수십 초 동안 아무 세션도 모델을
  // 못 부른다 — 옛 브리지는 이미 죽어 있기 때문이다. 준비가 먼저다.
  const source = read("rubato-restart.sh");
  const install = source.indexOf("npm install");
  const drain = source.lastIndexOf("request_drain");
  assert.ok(install > 0 && drain > 0);
  assert.ok(install < drain, "옛 브리지를 drain 한 뒤에 의존성을 깐다");
  const nodeCheck = source.indexOf("command -v node");
  assert.ok(nodeCheck > 0 && nodeCheck < drain, "새 브리지를 띄울 node 확인이 drain 뒤에 있다");
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
  const attempts = Number(source.match(/HEALTH_WAIT_ITERS="\$\{RUBATO_RESTART_HEALTH_ITERS:-(\d+)\}"/)?.[1] ?? 0);
  const interval = Number(source.match(/SLEEP_S="\$\{RUBATO_RESTART_SLEEP:-([\d.]+)\}"/)?.[1] ?? 0);
  assert.ok(attempts * interval >= 15, `replacement wait is only ${attempts * interval}s`);
});

test("the supervisor recovers every bridge exit without booting out a live job", () => {
  const source = read("install-supervisor.sh");
  assert.match(source, /<key>KeepAlive<\/key><true\/>/);
  assert.match(source, /Restart=always/);
  assert.match(source, /RUBATO_SUPERVISED/);
  assert.doesNotMatch(source, /Restart=on-failure|SuccessfulExit<\/key><false\/>/);
  const updateStart = source.indexOf("darwin_write_plist >\"$target\"");
  const bootstrap = source.indexOf("launchctl bootstrap", updateStart);
  assert.ok(updateStart > 0 && bootstrap > updateStart);
  assert.doesNotMatch(source.slice(updateStart, bootstrap), /launchctl bootout/);
  const start = read("start.sh");
  assert.doesNotMatch(start, /dev\/tcp/, "bind 전 probe는 검사와 listen 사이 경합을 남긴다");
  const server = readFileSync(fileURLToPath(new URL("../../../bridge/src/server.ts", import.meta.url)), "utf8");
  assert.match(server, /RUBATO_SUPERVISED/);
  assert.match(server, /setTimeout\(listen, SUPERVISOR_RETRY_MS\)/);
  assert.match(server, /exit\(SUPERVISOR_RECOVER_EXIT\)/);
  const launcher = read("rubato-pi.sh");
  assert.match(launcher, /<key>KeepAlive<\/key><true\/>/);
  assert.match(launcher, /Restart=always/);
  assert.match(launcher, /_sv_current/);
});

test("the bridge ignores ordinary signals and drains only through admin auth", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../bridge/src/server.ts", import.meta.url)), "utf8");
  assert.match(source, /signals = \["SIGTERM", "SIGINT"\]/);
  assert.match(source, /ignoring \$\{signal\}/);
  assert.match(source, /\/admin\/drain/);
  assert.match(source, /x-rubato-admin/);
  assert.match(source, /inflight/);
  assert.match(source, /closeIdleConnections/);
});

test("the bridge log outlives a reboot", () => {
  // $TMPDIR 에 두면 재부팅에 날아간다. 재시작 24회의 유발자를 뒤늦게 귀속하지
  // 못한 이유가 그것이었다. 두 자리(broker.mjs 와 rubato-restart.sh)가 같은
  // 규칙을 써야 재시작 기록과 브리지 출력이 한 파일에 모인다.
  const home = "/home/someone";
  const mac = brokerLogPath({ HOME: home, TMPDIR: "/tmp/volatile" });
  assert.doesNotMatch(mac, /^\/tmp|volatile/, `로그가 휘발되는 자리에 있다: ${mac}`);
  assert.ok(mac.startsWith(home), mac);
  assert.equal(brokerLogPath({ RUBATO_BROKER_LOG: "/dev/null" }), "/dev/null");

  const restart = read("rubato-restart.sh");
  assert.doesNotMatch(restart, /LOG="\$\{RUBATO_BROKER_LOG:-\$\{TMPDIR/, "재시작 로그만 옛 자리에 남았다");
  assert.match(restart, /Library\/Logs\/rubato|XDG_STATE_HOME/);
  assert.match(restart, /mkdir -p "\$\(dirname "\$LOG"\)"/, "로그 디렉터리를 만들지 않는다");
});
