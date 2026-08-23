import { pathToFileURL } from "node:url";
import { senpiNested } from "./engine-paths.mjs";

// broker-overlay 가 끌어오는 pi-ai index.js(createProvider) 없이
// disabledProviders 계산에 필요한 id 만 모은다. 세션 기본값을 쓸 때마다
// 프로바이더 구현을 컴파일하지 않으려고 갈라 둔 파일이다.
const { builtinProviders, getBuiltinProviders } = await import(
  pathToFileURL(senpiNested("@earendil-works/pi-ai/dist/providers/all.js")).href
);

// broker.mjs FALLBACK_CATALOG 의 프로바이더 prefix 와 맞춰 둔다.
// 이쪽이 broker 를 가져오면 시작 그래프가 다시 무거워진다.
const FALLBACK_OURS = Object.freeze(["xai", "anthropic", "openai-codex"]);

function providerPrefix(id) {
  const text = String(id);
  const slash = text.indexOf("/");
  return slash > 0 ? text.slice(0, slash) : "rubato";
}

export function ourProviderIds(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return [...FALLBACK_OURS];
  const ids = new Set();
  for (const entry of catalog) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id) continue;
    ids.add(providerPrefix(id));
  }
  return ids.size > 0 ? [...ids] : [...FALLBACK_OURS];
}

/**
 * Built-in pi-ai providers the model picker must never show. Rubato routes every model through the
 * broker, so a provider id we did not register ourselves is a direct-vendor lane with no credentials
 * behind it. Ids the broker also uses (anthropic, openai, xai) stay: our registration replaced them.
 */
export function builtinProviderIds() {
  // getBuiltinProviders() only lists ids present in the generated catalog, which misses
  // credential-only lanes like cursor/ollama/radius. Union both so nothing survives.
  return [...getBuiltinProviders(), ...builtinProviders().map((provider) => provider.id)];
}

export function foreignProviderIds(builtinIds, catalog) {
  const ours = new Set(ourProviderIds(catalog));
  return [...new Set(builtinIds)].filter((id) => typeof id === "string" && id.length > 0 && !ours.has(id));
}
