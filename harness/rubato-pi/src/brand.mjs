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
  return env;
}
