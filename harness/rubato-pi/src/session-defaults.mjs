import { existsSync as existsSyncFs, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "./defaults.mjs";
import { builtinProviderIds, foreignProviderIds, ourProviderIds } from "./provider-ids.mjs";

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

function readJson(path, { exists, readFile }) {
  if (!exists(path)) return {};
  try {
    const parsed = JSON.parse(readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function settingsLookCurrent(current) {
  if (!current || typeof current !== "object") return false;
  if (current.defaultProvider !== DEFAULT_PROVIDER) return false;
  if (current.defaultModel !== DEFAULT_MODEL_ID) return false;
  if (current.tips !== false) return false;
  if (typeof current.hideThinkingBlock !== "boolean") return false;
  if (!Array.isArray(current.disabledBuiltinExtensions)) return false;
  if (!DISABLED_OAUTH_EXTENSIONS.every((id) => current.disabledBuiltinExtensions.includes(id))) return false;
  if (current.retry?.maxRetries == null) return false;
  return true;
}

export function modelsLookCurrent(current, catalog) {
  if (!current || typeof current !== "object") return false;
  if (!Array.isArray(current.disabledProviders) || current.disabledProviders.length === 0) return false;
  if (!current.disabledProviders.includes("vercel-ai-gateway")) return false;
  return !ourProviderIds(catalog).some((id) => current.disabledProviders.includes(id));
}

export function sessionDefaultsLookCurrent(
  agentDir,
  { exists = existsSyncFs, readFile = readFileSync, catalog } = {},
) {
  return (
    settingsLookCurrent(readJson(settingsPath(agentDir), { exists, readFile })) &&
    modelsLookCurrent(readJson(modelsPath(agentDir), { exists, readFile }), catalog)
  );
}

export function ensureSessionDefaults(
  agentDir,
  { exists = existsSyncFs, readFile = readFileSync, writeFile = writeFileSync, catalog } = {},
) {
  const path = settingsPath(agentDir);
  const current = readJson(path, { exists, readFile });
  const models = readJson(modelsPath(agentDir), { exists, readFile });
  if (settingsLookCurrent(current) && modelsLookCurrent(models, catalog)) {
    return current;
  }
  const disabled = new Set([
    ...(current.disabledBuiltinExtensions ?? []),
    ...DISABLED_OAUTH_EXTENSIONS,
  ]);
  const next = {
    ...current,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL_ID,
    hideThinkingBlock: current.hideThinkingBlock ?? true,
    // 기본 3회(2+4+8초)는 브리지가 npm install 을 끼고 다시 뜨는 경우를 못 덮는다.
    // 5회면 약 62초까지 버틴다. 사용자가 적어 둔 값은 건드리지 않는다.
    retry: { maxRetries: 5, ...current.retry },
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
