import { DISABLED_AGENT_NAMES, DISABLED_CATEGORY_NAMES, MODEL_CATEGORIES } from "./defaults.mjs";

export function loadRubatoPiOmoConfig() {
  return {
    config: {
      agents: Object.fromEntries(DISABLED_AGENT_NAMES.map((name) => [name, { disable: true }])),
      categories: {
        ...Object.fromEntries(DISABLED_CATEGORY_NAMES.map((name) => [name, { disable: true }])),
        ...Object.fromEntries(
          Object.entries(MODEL_CATEGORIES).map(([name, model]) => [name, { model }]),
        ),
      },
    },
    diagnostics: [],
  };
}
