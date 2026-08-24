import assert from "node:assert/strict";
import test from "node:test";
import { opencodexModelsToFxCatalog, removeDirectProviderModels } from "../src/models.ts";
import { fixtureJson } from "./helpers.ts";

test("OpenCodex models keep provider prefixes and stay distinct", () => {
  const catalog = opencodexModelsToFxCatalog(fixtureJson("opencodex-models.json"));
  const ids = catalog.data.map((entry) => entry.id);
  assert.deepEqual(ids, [
    "openai/gpt-5.6-sol",
    "xai/grok-4.6",
    "cursor/grok-4.6",
    "cursor/gemini-3.7-flash",
  ]);
  assert.ok(ids.includes("xai/grok-4.6"));
  assert.ok(ids.includes("cursor/grok-4.6"));
  assert.notEqual("xai/grok-4.6", "cursor/grok-4.6");
  assert.ok(catalog.data.every((entry) => entry.type === "language"));
  assert.ok(Array.isArray(catalog.data[0].tags));
  assert.ok(catalog.data[0].tags.includes("tool-use"));
  assert.ok(catalog.data[0].tags.includes("reasoning"));
});

test("direct providers never reappear through OpenCodex", () => {
  const catalog = opencodexModelsToFxCatalog({
    data: [
      { id: "gpt-5.6-sol", owned_by: "openai" },
      { id: "gpt-5.7-pro", owned_by: "openai" },
      { id: "cursor/gpt-5.6-sol", owned_by: "cursor" },
      { id: "google-antigravity/gemini-3.7-flash", owned_by: "google" },
    ],
  });
  const filtered = removeDirectProviderModels(catalog.data);
  assert.deepEqual(filtered.map((entry) => entry.id), [
    "cursor/gpt-5.6-sol",
  ]);
});
