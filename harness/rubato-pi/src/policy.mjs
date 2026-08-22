export const PIN = Object.freeze({
  omoAi: "5.0.0-beta.16",
  senpi: "2026.8.22",
});

export const ON_COMPONENTS = Object.freeze([
  "ast-grep",
  "lsp",
  "task",
  "memory",
]);

export const DAG_ON_COMPONENTS = Object.freeze(
  ON_COMPONENTS.filter((name) => name !== "task"),
);

export const KNOWN_COMPONENTS = Object.freeze([
  "config-startup",
  "native-badge",
  "onboarding",
  "init-deep-advisor",
  "telemetry",
  "ultrawork",
  "mass-ulw",
  "start-work-continuation",
  "ulw-loop",
  "todo-fanout-reminder",
  "git-master-attribution",
  "fallback-architect",
  "comment-checker",
  "ast-grep",
  "lsp",
  "task",
  "memory",
  "config-watch",
]);

export function selectComponents(components, allow) {
  const allowed = new Set(allow);
  return components.filter((component) => allowed.has(component.name));
}

export function unexpectedComponents(names) {
  const known = new Set(KNOWN_COMPONENTS);
  return names.filter((name) => !known.has(name));
}
