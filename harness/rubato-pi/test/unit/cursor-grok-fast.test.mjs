import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  CURSOR_GROK_46_FAST_NAME,
  cursorGrok46FastVariantId,
  pinCursorGrokFastSelection,
  presentCursorGrokFast,
} from "../../src/cursor-grok-fast.mjs";
import { senpiNested } from "../../src/engine-paths.mjs";

const piAi = (...segments) => pathToFileURL(join(senpiNested("@earendil-works/pi-ai"), ...segments)).href;
const { resolveCursorSelectionDescriptor } = await import(piAi("dist/cursor/selection-descriptor.js"));

function grokBase() {
  return {
    id: "cursor-grok-4.6",
    name: "Cursor Grok 4.6",
    api: "cursor-agent",
    provider: "cursor",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    },
    upstreamModelId: "cursor-grok-4.6-medium",
    compat: {
      cursorReasoning: {
        capabilityId: "cursor-grok-4.6",
        representativeVariantId: "cursor-grok-4.6-medium",
      },
    },
  };
}

function grokFast(id) {
  return { id, name: id, api: "cursor-agent", provider: "cursor", reasoning: false, compat: {} };
}

test("피커에는 베이스 하나만 남고 이름이 Fast 다", () => {
  const presented = presentCursorGrokFast([
    { id: "composer-2.5", name: "Composer 2.5", provider: "cursor" },
    grokBase(),
    grokFast("cursor-grok-4.6-high-fast"),
    grokFast("cursor-grok-4.6-low-fast"),
    grokFast("cursor-grok-4.6-xhigh-fast"),
  ]);
  const grok = presented.filter((model) => String(model.id).includes("grok-4.6"));
  assert.equal(grok.length, 1);
  assert.equal(grok[0].id, "cursor-grok-4.6");
  assert.equal(grok[0].name, CURSOR_GROK_46_FAST_NAME);
  assert.deepEqual(grok[0].thinkingLevelMap.high, "high");
  assert.ok(presented.some((model) => model.id === "composer-2.5"));
});

test("베이스가 없고 Fast 변형만 있으면 묶어서 보여 준다", () => {
  const presented = presentCursorGrokFast([
    grokFast("cursor-grok-4.6-high-fast"),
    grokFast("cursor-grok-4.6-medium-fast"),
  ]);
  assert.equal(presented.length, 1);
  assert.equal(presented[0].id, "cursor-grok-4.6");
  assert.equal(presented[0].name, CURSOR_GROK_46_FAST_NAME);
  assert.equal(presented[0].thinkingLevelMap.high, "high");
  assert.equal(presented[0].thinkingLevelMap.medium, "medium");
  assert.equal(presented[0].thinkingLevelMap.xhigh, null);
});

test("effort 를 바꾸면 wire id 가 Fast suffix 를 유지한다", () => {
  const model = grokBase();
  assert.equal(
    resolveCursorSelectionDescriptor(model, { level: "high", source: "explicit" }).modelId,
    "cursor-grok-4.6-high",
    "전제: 핀 없으면 effort 가 Fast 를 푼다",
  );

  for (const level of ["low", "medium", "high", "xhigh"]) {
    const { options } = pinCursorGrokFastSelection(model, {
      thinkingSelection: { level, source: "explicit" },
    });
    const resolved = resolveCursorSelectionDescriptor(model, options.thinkingSelection);
    assert.equal(resolved.modelId, cursorGrok46FastVariantId(level), level);
    assert.deepEqual(resolved.parameters, []);
  }
});

test("effort 가 없으면 Cursor 기본 high Fast 로 고정한다", () => {
  const { options } = pinCursorGrokFastSelection(grokBase(), {});
  assert.equal(options.thinkingSelection.legacyVariantId, "cursor-grok-4.6-high-fast");
  assert.equal(
    resolveCursorSelectionDescriptor(grokBase(), options.thinkingSelection).modelId,
    "cursor-grok-4.6-high-fast",
  );
});

test("다른 모델은 손대지 않는다", () => {
  const model = { id: "composer-2.5", provider: "cursor" };
  const options = { thinkingSelection: { level: "high", source: "explicit" } };
  assert.deepEqual(pinCursorGrokFastSelection(model, options), { model, options });
});
