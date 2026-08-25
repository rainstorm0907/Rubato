import { pathToFileURL } from "node:url";
import { senpiNested } from "../engine-paths.mjs";

// bare import 를 쓰지 않는 이유는 broker.mjs 와 같다 — pi-ai 는 senpi 안에만 있고
// 위쪽에 hoist 된 사본은 깨끗한 설치에 없다.
const { createProvider } = await import(
  pathToFileURL(senpiNested("@earendil-works/pi-ai/dist/index.js")).href
);
import { ensureBroker, FALLBACK_CATALOG, groupCatalog, loadCatalog } from "../broker.mjs";
import { builtinProviderIds, foreignProviderIds } from "../provider-ids.mjs";
export { builtinProviderIds, foreignProviderIds };
import { streamBroker } from "../broker-stream.mjs";

const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const API = "openai-completions";

/** Vendor maps so Shift+Tab keeps xhigh on grok-4.6. A map-less model is inferred from id, and grok is not in that list. */
export const THINKING_LEVEL_MAPS = Object.freeze({
  "grok-4.6": Object.freeze({
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  }),
  "gpt-5.6-sol": Object.freeze({
    off: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  }),
  "gpt-5.6-terra": Object.freeze({
    off: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  }),
  "gpt-5.6-luna": Object.freeze({
    off: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  }),
  "claude-opus-5": Object.freeze({ xhigh: "xhigh", max: "max" }),
  "claude-sonnet-5": Object.freeze({ xhigh: "xhigh", max: "max" }),
});

const BROKER_CREDENTIAL = {
  type: "oauth",
  refresh: "rubato-broker",
  access: "local",
  expires: 4_102_444_800_000,
};

const BROKER_AUTH = {
  apiKey: {
    name: "Rubato broker",
    async resolve() {
      return { auth: { apiKey: "local" }, source: "rubato-broker" };
    },
    async check() {
      return { type: "api_key", source: "rubato-broker" };
    },
  },
  oauth: {
    name: "Rubato broker",
    loginLabel: "Use the rubato broker",
    async login(interaction) {
      ensureBroker();
      interaction?.notify?.({
        type: "info",
        message: "Models go through the rubato broker at :8788. Existing xAI, Claude, and OpenCodex logins stay there.",
      });
      return BROKER_CREDENTIAL;
    },
    async refresh() {
      return BROKER_CREDENTIAL;
    },
    async toAuth() {
      return { apiKey: "local" };
    },
    async check() {
      return { type: "oauth", source: "rubato-broker" };
    },
  },
};

export function providerConfigs(catalog = FALLBACK_CATALOG) {
  return Object.entries(groupCatalog(catalog)).map(([id, models]) => ({
    id,
    name: `Rubato broker (${id})`,
    baseUrl: "http://127.0.0.1:8788",
    api: API,
    models: models.map((model) => ({
      ...model,
      // Senpi /fast only attaches a service tier when model.api is this Responses API.
      api: id === "openai-codex" ? "openai-codex-responses" : API,
      provider: id,
      baseUrl: "http://127.0.0.1:8788",
      cost: COST,
      ...(THINKING_LEVEL_MAPS[model.id] ?? THINKING_LEVEL_MAPS[model.upstreamModelId]
        ? { thinkingLevelMap: THINKING_LEVEL_MAPS[model.id] ?? THINKING_LEVEL_MAPS[model.upstreamModelId] }
        : {}),
    })),
  }));
}

export function brokerProviders(catalog = FALLBACK_CATALOG) {
  return providerConfigs(catalog).map((config) =>
    createProvider({
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      auth: BROKER_AUTH,
      models: config.models,
      api: { stream: streamBroker, streamSimple: streamBroker },
    }),
  );
}

export default async function brokerOverlay(pi) {
  const catalog = await loadCatalog();
  for (const provider of brokerProviders(catalog)) {
    pi.registerProvider(provider);
  }
  for (const id of foreignProviderIds(builtinProviderIds(), catalog)) {
    try {
      pi.unregisterProvider(id);
    } catch {
      // A provider the host refuses to drop stays visible; never fail the overlay over it.
    }
  }
}
