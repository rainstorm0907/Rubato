import { existsSync as existsSyncFs, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "./defaults.mjs";
import { builtinProviderIds, foreignProviderIds, providerConfigs } from "./extensions/broker-overlay.mjs";

function ourProviderIds(catalog) {
  return providerConfigs(catalog).map((config) => config.id);
}

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
  { exists = existsSyncFs, readFile = readFileSync, writeFile = writeFileSync, catalog } = {},
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
    hideThinkingBlock: current.hideThinkingBlock ?? true,
    tips: false,
    disabledBuiltinExtensions: [...disabled],
  };
  writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  ensureModelsConfig(agentDir, { exists, readFile, writeFile, catalog });
  return next;
}

/**
 * disabledProviders 는 계산된 값이지 사용자가 쌓아 올린 목록이 아니다. 예전에는
 * 기존 항목을 그대로 합치기만 해서, 한 번 disabled 로 박힌 id 는 나중에 우리
 * 프로바이더가 되어도 파일에 영원히 남았다 — openai-codex 가 피커에서 사라진
 * 정체가 그것이다. 그래서 우리 것으로 돌아온 id(ours)는 여기서 회수한다.
 */
export function mergeDisabledProviders(current, required, ours = []) {
  const reclaimed = new Set(ours);
  const existing = Array.isArray(current?.disabledProviders) ? current.disabledProviders : [];
  return [...new Set([...existing, ...required])].filter(
    (id) => typeof id === "string" && id.length > 0 && !reclaimed.has(id),
  );
}

export function ensureModelsConfig(
  agentDir,
  { exists = existsSyncFs, readFile = readFileSync, writeFile = writeFileSync, catalog } = {},
) {
  const path = modelsPath(agentDir);
  const current = exists(path) ? JSON.parse(readFile(path, "utf8")) : {};
  const providers =
    current.providers && typeof current.providers === "object" && !Array.isArray(current.providers)
      ? current.providers
      : {};
  const ours = ourProviderIds(catalog);
  const next = {
    ...current,
    providers,
    disabledProviders: mergeDisabledProviders(
      current,
      foreignProviderIds(builtinProviderIds(), catalog),
      ours,
    ),
  };
  writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
