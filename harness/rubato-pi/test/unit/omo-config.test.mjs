import test from "node:test";
import assert from "node:assert/strict";
import { DISABLED_AGENT_NAMES, DISABLED_CATEGORY_NAMES, MODEL_CATEGORIES } from "../../src/defaults.mjs";
import { loadRubatoPiOmoConfig, pinMemoryJobsToGrok } from "../../src/omo-config.mjs";

test("task config maps model names and disables omo category routing", () => {
  const { config } = loadRubatoPiOmoConfig();
  assert.equal(config.models, undefined);
  for (const [name, model] of Object.entries(MODEL_CATEGORIES)) {
    assert.deepEqual(config.categories[name], { model });
  }
  for (const name of DISABLED_CATEGORY_NAMES) {
    assert.deepEqual(config.categories[name], { disable: true });
  }
});

test("omo agents this harness does not route are disabled", () => {
  const { config } = loadRubatoPiOmoConfig();
  for (const name of DISABLED_AGENT_NAMES) {
    assert.deepEqual(config.agents[name], { disable: true });
  }
  assert.deepEqual(Object.keys(config.agents).sort(), [...DISABLED_AGENT_NAMES].sort());
});

test("memory pin reopens quick as grok-only and forces the grok category", () => {
  const pinned = pinMemoryJobsToGrok(loadRubatoPiOmoConfig());
  assert.equal(pinned.config.memory.reflection.category, "grok");
  assert.deepEqual(pinned.config.categories.grok, { model: MODEL_CATEGORIES.grok });
  assert.deepEqual(pinned.config.categories.quick, { models: [MODEL_CATEGORIES.grok] });
  assert.equal(pinned.config.categories.quick.disable, undefined);
});

test("memory pin keeps user memory keys and overwrites only the reflection category", () => {
  const pinned = pinMemoryJobsToGrok({
    config: {
      memory: { agent: "rubato", project: [], reflection: { timeout_minutes: 20 } },
      categories: { quick: { disable: true } },
    },
    diagnostics: [],
  });
  assert.equal(pinned.config.memory.agent, "rubato");
  assert.deepEqual(pinned.config.memory.project, []);
  assert.equal(pinned.config.memory.reflection.timeout_minutes, 20);
  assert.equal(pinned.config.memory.reflection.category, "grok");
  assert.deepEqual(pinned.config.categories.quick, { models: [MODEL_CATEGORIES.grok] });
});
