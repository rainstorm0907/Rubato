import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DISABLED_AGENT_NAMES, DISABLED_CATEGORY_NAMES, MODEL_CATEGORIES } from "./defaults.mjs";

function readTaskSettings(cwd) {
  if (!cwd) return undefined;
  for (const name of ["omo.jsonc", "omo.json"]) {
    const path = join(cwd, ".omo", name);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const task = raw?.["[senpi]"]?.task ?? raw?.task;
      if (task && typeof task === "object") return task;
    } catch {
      /* ignore malformed fixture / comment-bearing jsonc */
    }
  }
  return undefined;
}

const TASK_SCHEMA_DEFAULTS = {
  default_execution_mode: "in-process",
  default_concurrency: 5,
  global_concurrency: 8,
  max_depth: 1,
  residency_max_children: 8,
  ttl_ms: 86400000,
  resume_children: true,
  warnings: { unavailable_categories: true },
  wait: { min_ms: 5000, default_ms: 60000, max_ms: 600000 },
  team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
};

function withTaskDefaults(task) {
  return {
    ...TASK_SCHEMA_DEFAULTS,
    ...task,
    warnings: { ...TASK_SCHEMA_DEFAULTS.warnings, ...(task.warnings && typeof task.warnings === "object" ? task.warnings : {}) },
    wait: { ...TASK_SCHEMA_DEFAULTS.wait, ...(task.wait && typeof task.wait === "object" ? task.wait : {}) },
    team: { ...TASK_SCHEMA_DEFAULTS.team, ...(task.team && typeof task.team === "object" ? task.team : {}) },
  };
}

export function loadRubatoPiOmoConfig(options = {}) {
  const task = readTaskSettings(options.cwd);
  return {
    config: {
      agents: Object.fromEntries(DISABLED_AGENT_NAMES.map((name) => [name, { disable: true }])),
      categories: {
        ...Object.fromEntries(DISABLED_CATEGORY_NAMES.map((name) => [name, { disable: true }])),
        ...Object.fromEntries(
          Object.entries(MODEL_CATEGORIES).map(([name, model]) => [name, { model }]),
        ),
      },
      ...(task ? { task: withTaskDefaults(task) } : {}),
    },
    diagnostics: [],
  };
}

/**
 * Memory children still call loadConfig themselves. Task overlay disables `quick`,
 * but facts and `/people --ask` are hardcoded to that name, so memory reopens it
 * as grok-only and pins reflection/dream to the grok category.
 */
export function pinMemoryJobsToGrok(loaded) {
  const config = loaded?.config ?? {};
  const memory = config.memory ?? {};
  const reflection = memory.reflection ?? {};
  return {
    ...loaded,
    config: {
      ...config,
      categories: {
        ...config.categories,
        grok: { model: MODEL_CATEGORIES.grok },
        quick: { models: [MODEL_CATEGORIES.grok] },
      },
      memory: {
        ...memory,
        reflection: {
          ...reflection,
          category: "grok",
        },
      },
    },
  };
}
