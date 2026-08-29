import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { launchEnv } from "../../src/brand.mjs";
import {
  UPSTREAM_CHILD_EXTENSIONS_ENV,
  applyUpstreamChildExtensions,
  inheritedUpstreamNames,
  stripInheritedUpstream,
} from "../../src/upstream-compat.mjs";

// cutover manifest: upstream package 가 요구하는 `OMO_*` 값은 `upstream-compat.mjs`
// 한 파일에서만 읽거나 지운다. Rubato 제품 설정·UI·로그·child export 에는 노출하지 않는다.
//
// 목적은 보존이 아니라 걷어내는 것이다. 한곳에 모이면 무엇이 아직 필요한지 셀 수 있고,
// 필요가 사라진 이름은 지울 수 있다. 흩어져 있으면 죽은 이름이 살아 있는 것처럼 보이는데,
// 실제로 `OMO_DISABLE_POSTHOG` 계열이 그랬다 — 아무도 읽지 않았다.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

// `OMO_*` 를 적어도 되는 자리.
//
// - `src/upstream-compat.mjs` — 정의상 유일한 소유자
// - `test/unit/upstream-compat.test.mjs` — 경계 자체를 서술하는 이 파일
// - `harness/docs/` — fx/omo 시절 이력 기록. 되돌아보는 문서라 고치지 않는다
// - `test/integration/omo-reattach.test.mjs` — upstream 재접속 호환 자체가 대상인 시험
//
// probe 스크립트와 test/helpers 는 일부러 빼 뒀다. 죽은 `OMO_DISABLE_POSTHOG` 를 아직
// 넘기고 있어서, 이 시험이 그걸 잔재로 지적하게 둔다.
const ALLOWED = [
  "harness/rubato-pi/src/upstream-compat.mjs",
  "harness/rubato-pi/test/unit/upstream-compat.test.mjs",
  "harness/docs/",
  "harness/rubato-pi/test/integration/omo-reattach.test.mjs",
];

function search(pattern) {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-nI", "-e", pattern, "--", "harness/"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch (error) {
    if (error.status === 1) return []; // no match
    throw error;
  }
}

function offenders(pattern) {
  return search(pattern).filter((line) => !ALLOWED.some((ok) => line.includes(ok)));
}

test("OMO_ 이름은 upstream-compat 밖에서 읽거나 쓰지 않는다", () => {
  const hits = offenders("OMO_[A-Z0-9_]\\+");
  assert.deepEqual(
    hits,
    [],
    `upstream 이 실제로 읽는 OMO_* 만 upstream-compat.mjs 에 두고, 나머지는 지운다. 발견:\n${hits.join("\n")}`,
  );
});

test("물려받은 upstream 런처 badge 를 지운다", () => {
  const env = Object.fromEntries(inheritedUpstreamNames().map((name) => [name, "1"]));
  env.KEEP = "yes";
  stripInheritedUpstream(env);
  for (const name of inheritedUpstreamNames()) {
    assert.equal(env[name], undefined, `${name} must be stripped`);
  }
  // 우리 값은 건드리지 않는다.
  assert.equal(env.KEEP, "yes");
});

test("telemetry 는 upstream 이름이 아니라 DO_NOT_TRACK 으로 끈다", () => {
  // `OMO_DISABLE_POSTHOG` 계열을 읽는 코드가 없다. telemetry 를 실제로 끄는 값은
  // `packages/telemetry-core/src/env.ts:39` 가 읽는 `DO_NOT_TRACK` 이다. 죽은 이름을
  // 다시 들여오면 이 시험이 막는다.
  const env = launchEnv({ HOME: "/tmp/home" }, "/tmp/home/.rubato-pi/agent");
  assert.equal(env.DO_NOT_TRACK, "1");
  assert.equal(env.OMO_DISABLE_POSTHOG, undefined);
  assert.equal(env.OMO_SENPI_DISABLE_POSTHOG, undefined);
});

test("자식 extension 목록을 upstream 이 읽는 이름으로 넘긴다", () => {
  const env = {};
  applyUpstreamChildExtensions(env, ["/a.mjs", "/b.mjs"], ":");
  assert.equal(env[UPSTREAM_CHILD_EXTENSIONS_ENV], "/a.mjs:/b.mjs");
});
