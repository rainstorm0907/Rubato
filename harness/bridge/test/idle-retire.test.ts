import assert from "node:assert/strict";
import test from "node:test";
import { isStaleAgainstSource } from "../src/server.ts";

// 낡은 브리지를 갈아치우는 판정은 두 조각이다: "낡았나"와 "한가한가".
// 여기서는 앞의 조각만 본다 — 뒤의 조각(inflight)은 server.ts 안의 클로저라
// 프로세스를 띄우는 shutdown.test.ts 쪽 계열이 이미 덮는다.
//
// 이 규칙은 rubato-pi/src/broker.mjs 의 것과 같아야 한다. 한쪽만 고치면
// 세션 시작 때의 판정과 브리지 자신의 판정이 어긋난다.

test("소스가 시작 시각보다 새로우면 낡은 것으로 본다", () => {
  const startedAt = 1_000_000;
  assert.equal(isStaleAgainstSource(startedAt, startedAt + 1), true);
});

test("소스가 시작 시각보다 오래됐으면 낡지 않은 것이다", () => {
  const startedAt = 1_000_000;
  assert.equal(isStaleAgainstSource(startedAt, startedAt - 1), false);
});

test("같은 시각은 낡은 것이 아니다", () => {
  const startedAt = 1_000_000;
  assert.equal(isStaleAgainstSource(startedAt, startedAt), false);
});

// 소스를 못 읽는 것은 "낡았다"가 아니라 "판단 불가"다. 0 을 낡음으로 읽으면
// 소스가 안 보이는 배치에서 살아 있는 브리지가 매번 스스로 물러난다.
test("소스 mtime 을 못 구하면(0) 물러나지 않는다", () => {
  assert.equal(isStaleAgainstSource(1_000_000, 0), false);
  assert.equal(isStaleAgainstSource(0, 0), false);
});

// 실제 소스 디렉터리를 읽는 기본 경로가 살아 있는지. 값 자체는 파일시스템에
// 달렸으므로 "불리고 boolean 을 돌려준다"까지만 본다.
test("기본 인자는 실제 소스 디렉터리를 읽는다", () => {
  assert.equal(typeof isStaleAgainstSource(Date.now() + 60_000), "boolean");
  // 아주 옛날에 시작한 프로세스는 지금 소스보다 낡았다.
  assert.equal(isStaleAgainstSource(1), true);
});
