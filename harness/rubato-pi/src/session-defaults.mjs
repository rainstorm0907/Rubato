import { existsSync as existsSyncFs, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "./defaults.mjs";
import { builtinProviderIds, foreignProviderIds } from "./extensions/broker-overlay.mjs";

export function settingsPath(agentDir) {
  return join(agentDir, "settings.json");
}

export function modelsPath(agentDir) {
  return join(agentDir, "models.json");
}

export function argvHasModel(argv) {
  return argv.some((token) => token === "--model" || token === "--provider" || token.startsWith("--model="));
}

const DISABLED_OAUTH_EXTENSIONS = ["claude-sdk-oauth", "cursor-cli-oauth"];

export function ensureSessionDefaults(
  agentDir,
  { exists = existsSyncFs, readFile = readFileSync, writeFile = writeFileSync } = {},
) {
  const path = settingsPath(agentDir);
  const current = exists(path) ? JSON.parse(readFile(path, "utf8")) : {};
  const disabled = new Set([
    ...(current.disabledBuiltinExtensions ?? []),
    ...DISABLED_OAUTH_EXTENSIONS,
  ]);
  const next = {
    ...current,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL_ID,
    tips: false,
    disabledBuiltinExtensions: [...disabled],
  };
  writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  ensureModelsConfig(agentDir, { exists, readFile, writeFile });
  return next;
}

export function mergeDisabledProviders(current, required) {
  const existing = Array.isArray(current?.disabledProviders) ? current.disabledProviders : [];
  return [...new Set([...existing, ...required])].filter((id) => typeof id === "string" && id.length > 0);
}

export function ensureModelsConfig(
  agentDir,
  { exists = existsSyncFs, readFile = readFileSync, writeFile = writeFileSync } = {},
) {
  const path = modelsPath(agentDir);
  const current = exists(path) ? JSON.parse(readFile(path, "utf8")) : {};
  const providers =
    current.providers && typeof current.providers === "object" && !Array.isArray(current.providers)
      ? current.providers
      : {};
  const next = {
    ...current,
    providers,
    disabledProviders: mergeDisabledProviders(current, foreignProviderIds(builtinProviderIds())),
  };
  writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
