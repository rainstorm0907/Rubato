// 배경에서 도는 것들(서브에이전트 · 셸 · 모니터)을 한 곳에 모은다.
//
// 엔진은 이 셋의 상태가 바뀔 때마다 `wake_source_state` 이벤트를 쏜다. source 로 갈리고
// 배열이 담긴 필드 이름만 다를 뿐, 항목은 모두 `{ id, description, startedAtMs }` 다.
// 그래서 여기서는 source 별 최신 스냅샷만 들고 있으면 된다 — 우리가 따로 시계를 굴리거나
// 시작 시각을 기록할 필요가 없다.
//
// 모델 이름만 이벤트에 없다. 서브에이전트는 `<project_dir>/.omo/senpi-task/tasks/<id>.json`
// 에 레코드가 있으므로 거기서 읽어 붙인다. mtime 이 그대로면 다시 읽지 않는다.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { BACKGROUND_SOURCES } from "./statusline.mjs";

const WAKE_SOURCE_STATE_EVENT = "wake_source_state";
const TASK_SOURCE = "senpi-task";

/** 서브에이전트 레코드를 읽어 모델 이름을 준다. mtime 기반 캐시라 매초 호출해도 싸다. */
export function createTaskModelReader({ stateDir, readFile = readFileSync, stat = statSync } = {}) {
  const cache = new Map();
  return function modelFor(taskId) {
    if (!stateDir || typeof taskId !== "string" || taskId.length === 0) return undefined;
    const path = join(stateDir, "tasks", `${taskId}.json`);
    let mtimeMs;
    try {
      mtimeMs = stat(path).mtimeMs;
    } catch {
      cache.delete(path);
      return undefined;
    }
    const cached = cache.get(path);
    if (cached && cached.mtimeMs === mtimeMs) return cached.model;
    try {
      const record = JSON.parse(String(readFile(path, "utf8")));
      const model = typeof record?.model === "string" ? record.model : undefined;
      cache.set(path, { mtimeMs, model });
      return model;
    } catch {
      // 반쯤 쓰인 레코드는 이번 프레임만 건너뛴다. 다음 tick 에 다시 본다.
      cache.delete(path);
      return undefined;
    }
  };
}

/**
 * source 별 최신 스냅샷을 들고 있는 저장소. `groups()` 가 화면이 그릴 형태를 준다.
 * 서브에이전트 항목에는 레코드에서 읽은 `model` 이 붙는다.
 */
export function createBackgroundTracker({ modelFor } = {}) {
  const bySource = new Map();
  return {
    /** 이벤트를 반영하고, 화면을 다시 그려야 하면 true. */
    accept(event) {
      const parsed = parseEvent(event);
      if (parsed === null) return false;
      const previous = bySource.get(parsed.source);
      if (sameEntries(previous, parsed.entries)) return false;
      bySource.set(parsed.source, parsed.entries);
      return true;
    },
    /** 지금 도는 게 하나라도 있나 — 없으면 타이머를 세울 이유가 없다. */
    active() {
      for (const entries of bySource.values()) {
        if (entries.length > 0) return true;
      }
      return false;
    },
    groups() {
      const out = new Map();
      for (const [source, entries] of bySource) {
        out.set(
          source,
          source === TASK_SOURCE && typeof modelFor === "function"
            ? entries.map((entry) => withModel(entry, modelFor(entry.id)))
            : entries,
        );
      }
      return out;
    },
    clear() {
      bySource.clear();
    },
  };
}

function withModel(entry, model) {
  return model ? { ...entry, model } : entry;
}

function parseEvent(event) {
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

/** 같은 스냅샷이 다시 오면 다시 그리지 않는다. */
function sameEntries(previous, next) {
  if (previous === undefined) return false;
  if (previous.length !== next.length) return false;
  return previous.every((entry, index) => {
    const other = next[index];
    return entry.id === other.id
      && entry.description === other.description
      && entry.startedAtMs === other.startedAtMs;
  });
}

export { WAKE_SOURCE_STATE_EVENT, TASK_SOURCE };
