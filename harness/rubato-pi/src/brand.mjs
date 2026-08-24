import { homedir } from "node:os";
import { join } from "node:path";
import { CACHE_RETENTION } from "./defaults.mjs";

export const BRAND_NAME = "\u{1D493}\u{1D496}\u{1D483}\u{1D482}\u{1D495}\u{1D490}";
export const BRAND_ASCII = "rubato";
export const DISPLAY_VERSION = "0.0.3";
export const CONFIG_DIR_NAME = ".rubato-pi";
export const ENV_PREFIX = "RUBATO_PI";

export function brandProfile() {
  return {
    name: BRAND_NAME,
    displayVersion: DISPLAY_VERSION,
    configDir: CONFIG_DIR_NAME,
    flatLayout: false,
    envPrefix: ENV_PREFIX,
    userAgent: BRAND_ASCII,
    originator: BRAND_ASCII,
  };
}

export function defaultAgentDir(home = homedir()) {
  return join(home, CONFIG_DIR_NAME, "agent");
}

/**
 * `RUBATO_MEASUREMENT_LOG=<path>` is the low-level toggle the recorder itself checks
 * (measurement-recorder.mjs `enabled()`) and stays the way to route measurements to a
 * chosen file, e.g. from run-measurement-benchmarks.mjs. For everyday interactive use,
 * nobody wants to construct a path by hand, so `RUBATO_MEASUREMENT=1` picks one under the
 * agent profile dir when RUBATO_MEASUREMENT_LOG was not already set explicitly.
 * Recording defaults OFF: neither var set means measurementRecorder() stays a no-op, so a
 * normal session pays nothing (measured: contextSegments() on an ~870KB context costs under
 * 1ms, appendFileSync for a ~1MB event line under 0.7ms).
 */
export function defaultMeasurementLogPath(agentDir, { now = () => new Date(), pid = process.pid } = {}) {
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  return join(agentDir, "measurements", `${stamp}-${pid}.jsonl`);
}

export function launchEnv(baseEnv, agentDir) {
  const env = { ...baseEnv };
  delete env.OMO_NATIVE;
  delete env.OMO_BIN;
  env.SENPI_BRAND = JSON.stringify(brandProfile());
  env.SENPI_CODING_AGENT_DIR = agentDir;
  env.RUBATO_PI_CODING_AGENT_DIR = agentDir;
  env.OMO_DISABLE_POSTHOG = "1";
  env.OMO_SENPI_DISABLE_POSTHOG = "1";
  env.DO_NOT_TRACK = "1";
  env.FX_CACHE_RETENTION = env.FX_CACHE_RETENTION ?? CACHE_RETENTION;
  env.PI_CACHE_RETENTION = env.PI_CACHE_RETENTION ?? CACHE_RETENTION;
  if (env.RUBATO_MEASUREMENT === "1" && !env.RUBATO_MEASUREMENT_LOG) {
    env.RUBATO_MEASUREMENT_LOG = defaultMeasurementLogPath(agentDir);
  }
  return env;
}
