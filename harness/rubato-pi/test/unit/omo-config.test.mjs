import test from "node:test";
import assert from "node:assert/strict";
import { DISABLED_AGENT_NAMES, DISABLED_CATEGORY_NAMES, MODEL_CATEGORIES } from "../../src/defaults.mjs";
import { loadRubatoPiOmoConfig } from "../../src/omo-config.mjs";

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
