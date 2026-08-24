import { BRAND_NAME } from "./brand.mjs";

const FAMILIES = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
  ["mythos", "Mythos"],
  ["grok", "Grok"],
  ["gemini", "Gemini"],
  ["kimi", "Kimi"],
  ["gpt", "GPT"],
];

export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

/** 모바일급 폭에선 워터마크를 빼고, 이 너비부터 오른쪽에 붙인다. */
export const BRAND_MARK_MIN_WIDTH = 80;

export function visibleColumns(text) {
  return [...stripAnsi(text)].length;
}

/**
 * 폭이 충분하면 워터마크를 오른쪽 끝에 붙인다.
 * 좁으면 빼고, 넓으면 왼쪽을 접어서라도 마크는 남긴다.
 */
export function appendBrandMark(left, width, mark = BRAND_NAME) {
  if (width < BRAND_MARK_MIN_WIDTH) return truncateToWidth(left, width);
  const markCols = visibleColumns(mark);
  const budget = width - markCols;
  if (budget <= 1) return truncateToWidth(left, width);
  const clipped = truncateToWidth(left, budget - 1);
  const pad = Math.max(1, width - visibleColumns(clipped) - markCols);
  return `${clipped}${" ".repeat(pad)}${mark}`;
}

const VARIANTS = [
  ["sol", "Sol"],
  ["luna", "Luna"],
  ["terra", "Terra"],
];

export function shortModelLabel(modelId) {
  if (!modelId) return "unknown";
  const bare = String(modelId).split("/").pop();
  const lc = bare.toLowerCase();
  const variant = variantLabel(lc);
  if (variant) return variant;
  for (const [key, label] of FAMILIES) {
    const idx = lc.indexOf(key);
    if (idx < 0) continue;
    const tail = lc.slice(idx + key.length).replace(/^[-.]/, "");
    const version = parseVersion(tail);
    return version ? `${label} ${version}` : label;
  }
  const colon = bare.indexOf(":");
  return colon >= 0 ? bare.slice(0, colon) : bare;
}

function variantLabel(lc) {
  for (const [key, label] of VARIANTS) {
    const idx = lc.lastIndexOf(key);
    if (idx < 0) continue;
    if (idx > 0 && lc[idx - 1] !== "-" && lc[idx - 1] !== ".") continue;
    const before = lc.slice(0, idx).replace(/[-.]$/, "").replace(/^gpt[-.]/, "");
    const version = parseVersion(before.replace(/^[a-z]+[-.]/, "")) || parseVersion(before);
    return version ? `${version} ${label}` : label;
  }
  return "";
}

export function formatEffort(level) {
  if (!level || level === "off") return "";
  if (level === "xhigh") return "Xhigh";
  if (level === "max") return "Max";
  return String(level);
}

export function formatModelWithEffort(modelId, level) {
  const model = shortModelLabel(modelId);
  const effort = formatEffort(level) || effortFromModelId(modelId);
  return effort ? `${model} ${effort}` : model;
}

function effortFromModelId(modelId) {
  if (!modelId) return "";
  const bare = String(modelId).split("/").pop();
  const colon = bare.lastIndexOf(":");
  if (colon < 0) return "";
  return formatEffort(bare.slice(colon + 1).toLowerCase());
}

function parseVersion(tail) {
  const parts = [];
  let part = "";
  for (const ch of tail) {
    if (ch >= "0" && ch <= "9") {
      part += ch;
    } else if ((ch === "-" || ch === ".") && part) {
      parts.push(part);
      part = "";
    } else {
      break;
    }
  }
  if (part) parts.push(part);
  while (parts.length > 0 && parts[parts.length - 1].length >= 6) parts.pop();
  if (parts.length === 0) return "";
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return parts[0];
}

export function remainingPercent(usedPercent) {
  if (usedPercent == null || Number.isNaN(Number(usedPercent))) return null;
  const remaining = Math.round(100 - Number(usedPercent));
  if (remaining < 0) return 0;
  if (remaining > 100) return 100;
  return remaining;
}

export function formatWindow(count) {
  const n = Math.round(Number(count) || 0);
  if (n <= 0) return "";
  if (n < 1_000) return String(n);
  if (n < 10_000) return trim1(n / 1_000) + "K";
  if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
  if (n < 10_000_000) return trim1(n / 1_000_000) + "M";
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}M`;
  return trim1(n / 1_000_000_000) + "B";
}

function trim1(n) {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatContext(remaining, window) {
  const size = formatWindow(window);
  if (remaining == null) return size ? `?(${size})` : "?";
  return size ? `${remaining}%(${size})` : `${remaining}%`;
}

export function cacheHitPercent(usage) {
  if (!usage) return null;
  const input = Number(usage.input) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const prompt = input + cacheRead + cacheWrite;
  if (prompt <= 0) return null;
  return Math.round((cacheRead / prompt) * 100);
}

export function repoBasename(cwd) {
  if (!cwd) return "";
  const normalized = String(cwd).replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function latestAssistantUsage(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "assistant" || !message.usage) continue;
    return message.usage;
  }
  return null;
}

/**
 * `output.timing` 은 broker-stream 이 성공한 모델 호출이 끝날 때 붙인다 (measurement
 * 기록기와 무관하게 항상 계산 — RUBATO_MEASUREMENT_LOG 가 꺼져 있어도 값이 있다).
 * 세션 파일에도 저장되므로 현재 프로세스 표식이 맞고 표시할 숫자가 유효한 값만 고른다.
 *
 * 한 사용자 턴은 도구 루프 때문에 모델 호출 여러 번으로 갈라진다. 마지막 호출만 보여주면
 * 숫자가 호출마다 튀므로 현재 턴에 속한 호출들의 평균을 낸다. 턴 경계는 브랜치 엔트리에서
 * 직접 뽑는다 — 마지막 user 메시지 뒤의 assistant 들이 곧 현재 턴이다. 이러면 measurement
 * 기록기(RUBATO_MEASUREMENT_LOG)가 꺼져 있어도 동작하고, 새 user 메시지가 들어오는 순간
 * 평균이 저절로 리셋된다.
 *
 * think 는 사고한 호출들만 모아 평균낸다. 사고 없는 호출을 0 으로 섞으면 실제로 4초 생각한
 * 턴이 `think 1.0s` 로 찍혀 거짓말이 된다.
 */
export function currentTurnTiming(entries, processStartedAt) {
  if (!Array.isArray(entries) || !Number.isFinite(processStartedAt)) return null;
  const waits = [];
  const thinks = [];
  let ttftMs;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role === "user") break;
    const timing = message?.timing;
    if (message?.role !== "assistant" || timing?.processStartedAt !== processStartedAt) continue;
    // 실패/중단 호출은 애초에 timing 이 없어 여기서 걸러진다.
    if (!validLatencyMs(timing.ttftMs)) continue;
    if (ttftMs === undefined) ttftMs = timing.ttftMs;
    if (validLatencyMs(timing.waitMs)) waits.push(timing.waitMs);
    if (validLatencyMs(timing.thinkMs)) thinks.push(timing.thinkMs);
  }
  if (ttftMs === undefined) return null;
  return {
    waitMs: mean(waits) ?? ttftMs,
    ...(thinks.length === 0 ? {} : { thinkMs: mean(thinks) }),
    calls: waits.length || 1,
  };
}

function mean(values) {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validLatencyMs(ms) {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= Number.MAX_VALUE / 1000;
}

/** `340ms` 이하 1초, 그 위는 `1.2s`. 소음을 줄이려 소수점 하나만 남긴다. */
export function formatLatencyMs(ms) {
  if (!validLatencyMs(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 상태줄에는 답변 길이에 독립적인 대기/사고 시간만 속도로 표시한다.
 * `delay 1.2s · think 4.0s`. 사고가 없던 턴은 `delay` 만 그린다 — `think 0ms` 는 거짓말이다.
 */
export function formatLatency(timing) {
  const delay = formatLatencyMs(timing?.waitMs ?? timing?.ttftMs);
  if (!delay) return "";
  // 0 은 사고를 안 한 것과 구분되지 않으므로 그리지 않는다.
  const think = timing?.thinkMs ? formatLatencyMs(timing.thinkMs) : "";
  return think ? `delay ${delay} · think ${think}` : `delay ${delay}`;
}

export function statuslineSegments({ model, remaining, window, branch, repo }) {
  const parts = [`✦ ${model}`, formatContext(remaining, window)];
  if (branch) parts.push(branch);
  if (repo) parts.push(repo);
  return parts;
}

export function formatCacheHit(cache) {
  if (cache == null) return "";
  return ` (${cache}%)`;
}

export function formatStatusline(input) {
  const left = `${statuslineSegments(input).join(" · ")}${formatCacheHit(input.cache)}`;
  return input.width == null ? left : appendBrandMark(left, input.width);
}

// ── 배경 작업 요약 ─────────────────────────────────────────────────
//
// 셸과 모니터는 엔진의 `wake_source_state` 이벤트로 온다.
// 둘 다 `{ id, description, startedAtMs }` 로 모양이 같아서 한 줄에 합칠 수 있다.
// 서브에이전트는 에디터 위 위젯이 그린다.

/** 이벤트의 source 값과 화면에 쓸 글리프. 순서가 곧 표시 순서다. 서브에이전트는 위젯이 그린다. */
export const BACKGROUND_SOURCES = Object.freeze([
  { source: "terminal-background-sessions", glyph: "⌘", field: "items" },
  { source: "terminal-monitors", glyph: "◉", field: "monitors" },
]);

/** `05:44`, 한 시간을 넘기면 `1:05:44`. 시계지 상대시간 표기가 아니다. */
export function formatElapsedClock(startedAtMs, nowMs) {
  const started = Number(startedAtMs);
  if (!Number.isFinite(started)) return "";
  const total = Math.max(0, Math.floor((Number(nowMs) - started) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 이벤트 페이로드를 표시용 항목으로 정규화한다.
 * source 마다 배열이 담긴 필드 이름이 달라서 BACKGROUND_SOURCES 로 맞춘다.
 */
export function backgroundEntriesFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  const spec = BACKGROUND_SOURCES.find((candidate) => candidate.source === event.source);
  if (!spec) return null;
  const raw = event[spec.field];
  if (!Array.isArray(raw)) return { source: spec.source, entries: [] };
  const entries = raw
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      description: String(entry.description ?? entry.id),
      startedAtMs: Number(entry.startedAtMs),
    }));
  return { source: spec.source, entries };
}

/** `reviewer Opus 5 05:44` — 모델은 있을 때만 낀다. */
export function formatBackgroundEntry(entry, nowMs) {
  const clock = formatElapsedClock(entry.startedAtMs, nowMs);
  const model = entry.model ? shortModelLabel(entry.model) : "";
  return [entry.description, model, clock].filter(Boolean).join(" ");
}

/**
 * 소스별 묶음을 한 줄로 조립한다. 폭을 넘기면 뒤에서부터 접어 `+N` 으로 세되,
 * 개수만은 절대 잘리지 않게 남긴다 — 몇 개가 도는지가 가장 중요한 정보다.
 */
export function formatBackgroundLine(groups, nowMs, width = 80) {
  const chunks = [];
  for (const spec of BACKGROUND_SOURCES) {
    const entries = groups?.get?.(spec.source) ?? [];
    if (entries.length === 0) continue;
    const labels = entries.map((entry) => formatBackgroundEntry(entry, nowMs));
    chunks.push({ glyph: spec.glyph, labels });
  }
  if (chunks.length === 0) return "";

  for (let keep = maxLabels(chunks); keep >= 0; keep -= 1) {
    const line = renderChunks(chunks, keep);
    if (line.length <= width) return line;
  }
  return renderChunks(chunks, 0);
}

function maxLabels(chunks) {
  return chunks.reduce((max, chunk) => Math.max(max, chunk.labels.length), 0);
}

/** keep 개까지만 이름을 쓰고 나머지는 `+N`. keep 이 0이면 개수만 남는다. */
function renderChunks(chunks, keep) {
  return chunks
    .map(({ glyph, labels }) => {
      const shown = keep > 0 ? labels.slice(0, keep) : [];
      const hidden = labels.length - shown.length;
      const parts = [...shown];
      if (hidden > 0) parts.push(`+${hidden}`);
      return `${glyph} ${parts.join(" · ")}`;
    })
    .join("   ");
}

export function truncateToWidth(text, width) {
  const plain = stripAnsi(text);
  if (width <= 0) return "";
  if (plain.length <= width) return text;
  if (width === 1) return "…";
  return `${plain.slice(0, width - 1)}…`;
}
