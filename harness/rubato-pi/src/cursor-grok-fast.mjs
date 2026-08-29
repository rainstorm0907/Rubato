// Cursor Grok 4.6 을 피커에서 Fast 정체성으로 보여 주고, effort 변경이 Fast 를 유지하게 한다.
//
// pinned catalog-grouping 은 Fast 변형을 thinkingLevelMap 으로 묶지 않는다. 베이스
// `cursor-grok-4.6` 에서 effort 를 바꾸면 suffix 가 `cursor-grok-4.6-high` 로 가서
// Fast 가 풀린다. Fast 행을 따로 고르면 thinkingLevelMap 이 없어 effort 를 못 바꾼다.
//
// 그래서 피커에는 베이스 하나만 남기고 이름을 Fast 로 두며, stream 직전에
// thinkingSelection 을 해당 `*-{level}-fast` legacy variant 로 고정한다.

export const CURSOR_GROK_46_ID = "cursor-grok-4.6";
export const CURSOR_GROK_46_FAST_NAME = "Cursor Grok 4.6 Fast";
export const CURSOR_GROK_46_DEFAULT_LEVEL = "high";

export const CURSOR_GROK_46_FAST_BY_LEVEL = Object.freeze({
  low: "cursor-grok-4.6-low-fast",
  medium: "cursor-grok-4.6-medium-fast",
  high: "cursor-grok-4.6-high-fast",
  xhigh: "cursor-grok-4.6-xhigh-fast",
});

const FAST_SUFFIX = /-fast$/;
const FAST_VARIANT = /^cursor-grok-4\.6-.+-fast$/;

export function isCursorGrok46Base(model) {
  return model?.provider === "cursor" && model?.id === CURSOR_GROK_46_ID;
}

export function isCursorGrok46FastVariant(model) {
  return model?.provider === "cursor" && FAST_VARIANT.test(model?.id ?? "");
}

export function cursorGrok46FastVariantId(level) {
  return CURSOR_GROK_46_FAST_BY_LEVEL[level] ?? CURSOR_GROK_46_FAST_BY_LEVEL[CURSOR_GROK_46_DEFAULT_LEVEL];
}

export function presentCursorGrokFast(models) {
  if (!Array.isArray(models) || models.length === 0) return models;
  const kept = [];
  let base;
  const fastVariants = [];
  for (const model of models) {
    if (isCursorGrok46FastVariant(model) || (model?.provider === "cursor" && model?.id === `${CURSOR_GROK_46_ID}-fast`)) {
      fastVariants.push(model);
      continue;
    }
    if (isCursorGrok46Base(model)) {
      base = model;
      continue;
    }
    kept.push(model);
  }
  const presented = presentBase(base, fastVariants);
  if (presented) kept.push(presented);
  return kept;
}

function presentBase(base, fastVariants) {
  if (base) {
    return base.name === CURSOR_GROK_46_FAST_NAME ? base : { ...base, name: CURSOR_GROK_46_FAST_NAME };
  }
  const template = fastVariants.find((model) => model.id === CURSOR_GROK_46_FAST_BY_LEVEL.high) ?? fastVariants[0];
  if (!template) return undefined;
  const levels = new Set(
    fastVariants
      .map((model) => model.id.match(/^cursor-grok-4\.6-(low|medium|high|xhigh)-fast$/)?.[1])
      .filter(Boolean),
  );
  return {
    ...template,
    id: CURSOR_GROK_46_ID,
    name: CURSOR_GROK_46_FAST_NAME,
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: levels.has("low") ? "low" : null,
      medium: levels.has("medium") ? "medium" : null,
      high: levels.has("high") ? "high" : null,
      xhigh: levels.has("xhigh") ? "xhigh" : null,
      max: null,
    },
    upstreamModelId: CURSOR_GROK_46_FAST_BY_LEVEL.high,
    compat: {
      ...(template.compat ?? {}),
      cursorReasoning: {
        capabilityId: CURSOR_GROK_46_ID,
        representativeVariantId: CURSOR_GROK_46_FAST_BY_LEVEL.high,
      },
    },
  };
}

export function pinCursorGrokFastSelection(model, options = {}) {
  if (!isCursorGrok46Base(model)) return { model, options };
  const selection = options.thinkingSelection;
  const alreadyFast = typeof selection?.legacyVariantId === "string" && FAST_SUFFIX.test(selection.legacyVariantId);
  const level = CURSOR_GROK_46_FAST_BY_LEVEL[selection?.level]
    ? selection.level
    : alreadyFast
      ? levelFromFastVariant(selection.legacyVariantId)
      : CURSOR_GROK_46_DEFAULT_LEVEL;
  const legacyVariantId = cursorGrok46FastVariantId(level);
  if (alreadyFast && selection.legacyVariantId === legacyVariantId && selection.level === level) {
    return { model, options };
  }
  return {
    model,
    options: {
      ...options,
      thinkingSelection: {
        level,
        source: "legacy-variant",
        legacyVariantId,
      },
    },
  };
}

function levelFromFastVariant(id) {
  const match = String(id).match(/^cursor-grok-4\.6-(low|medium|high|xhigh)-fast$/);
  return match?.[1] ?? CURSOR_GROK_46_DEFAULT_LEVEL;
}
