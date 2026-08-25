import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import {
  brandProfile,
  defaultAgentDir,
  defaultMeasurementLogPath,
  launchEnv,
  providerExtensionPaths,
} from "../../src/brand.mjs";

test("brand is rubato and never uses the omo config dir", () => {
  const brand = brandProfile();
  assert.equal(brand.name, "\u{1D493}\u{1D496}\u{1D483}\u{1D482}\u{1D495}\u{1D490}");
  assert.equal(brand.userAgent, "rubato");
  assert.equal(brand.originator, "rubato");
  assert.equal(brand.displayVersion, "0.0.4");
  assert.equal(brand.configDir, ".rubato-pi");
  assert.equal(brand.envPrefix, "RUBATO_PI");
  assert.match(defaultAgentDir("/tmp/home"), /\/\.rubato-pi\/agent$/);
});

test("launch env isolates state and clears the omo native badge", () => {
  const env = launchEnv(
    { OMO_NATIVE: "1", OMO_BIN: "/opt/homebrew/bin/omo", HOME: "/tmp/home" },
    "/tmp/home/.rubato-pi/agent",
  );
  assert.equal(env.OMO_NATIVE, undefined);
  assert.equal(env.OMO_BIN, undefined);
  assert.equal(env.SENPI_CODING_AGENT_DIR, "/tmp/home/.rubato-pi/agent");
  assert.equal(env.RUBATO_PI_CODING_AGENT_DIR, "/tmp/home/.rubato-pi/agent");
  const parsed = JSON.parse(env.SENPI_BRAND);
  assert.equal(parsed.name, "\u{1D493}\u{1D496}\u{1D483}\u{1D482}\u{1D495}\u{1D490}");
  assert.equal(parsed.userAgent, "rubato");
  assert.equal(parsed.displayVersion, "0.0.4");
  assert.equal(parsed.configDir, ".rubato-pi");
  assert.equal(env.FX_CACHE_RETENTION, "long");
  assert.equal(env.PI_CACHE_RETENTION, "long");
});

// 배경 memory 자식(reflection/dream/facts)은 --no-extensions 로 뜬다. 우리 프로바이더는
// models.json 이 아니라 broker-overlay 가 런타임에 등록하므로, 이 목록이 자식에게
// 넘어가지 않으면 자식은 자격증명 없는 pi-ai 빌트인으로 벤더 API 를 때려 401 로 죽는다.
test("launch env hands background children the provider extensions to reload", () => {
  const paths = providerExtensionPaths();
  assert.equal(paths.length, 1);
  assert.match(paths[0], /broker-overlay\.mjs$/);
  assert.ok(existsSync(paths[0]), `provider extension must exist on disk: ${paths[0]}`);

  const env = launchEnv({ HOME: "/tmp/home" }, "/tmp/home/.rubato-pi/agent");
  assert.deepEqual(env.OMO_MEMORY_CHILD_EXTENSIONS.split(delimiter), paths);
});

test("measurement recording defaults off and needs an explicit opt-in", () => {
  const off = launchEnv({ HOME: "/tmp/home" }, "/tmp/home/.rubato-pi/agent");
  assert.equal(off.RUBATO_MEASUREMENT_LOG, undefined);
});

test("RUBATO_MEASUREMENT=1 derives a log path under the agent profile dir", () => {
  const env = launchEnv({ HOME: "/tmp/home", RUBATO_MEASUREMENT: "1" }, "/tmp/home/.rubato-pi/agent");
  assert.match(env.RUBATO_MEASUREMENT_LOG, /^\/tmp\/home\/\.rubato-pi\/agent\/measurements\/.+\.jsonl$/);
});

test("an explicit RUBATO_MEASUREMENT_LOG is never overridden by the convenience toggle", () => {
  const env = launchEnv(
    { HOME: "/tmp/home", RUBATO_MEASUREMENT: "1", RUBATO_MEASUREMENT_LOG: "/tmp/custom.jsonl" },
    "/tmp/home/.rubato-pi/agent",
  );
  assert.equal(env.RUBATO_MEASUREMENT_LOG, "/tmp/custom.jsonl");
});

test("the derived measurement log path is stable per process and stamped with wall time", () => {
  const now = () => new Date("2026-08-24T12:34:56.789Z");
  const path = defaultMeasurementLogPath("/tmp/home/.rubato-pi/agent", { now, pid: 4242 });
  assert.equal(path, "/tmp/home/.rubato-pi/agent/measurements/2026-08-24T12-34-56-789Z-4242.jsonl");
});
