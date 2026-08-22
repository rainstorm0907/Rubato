export function noChangelogRegisterHref() {
  return new URL("./no-changelog-register.mjs", import.meta.url).href;
}

export function withNoChangelog(env) {
  const flag = `--import=${noChangelogRegisterHref()}`;
  const prev = env.NODE_OPTIONS ?? "";
  if (prev.includes("no-changelog-register")) return env;
  return { ...env, NODE_OPTIONS: prev ? `${prev} ${flag}` : flag };
}

export function stripChangelog(source, url = "") {
  let next = source;
  if (url.includes("slash-commands.js") || url === "") {
    next = next.replace(
      '\n    { name: "changelog", description: "Show changelog entries" },',
      "",
    );
  }
  if (url.includes("interactive-mode.js") || url === "") {
    next = next.replace(
      `\n            if (text === "/changelog") {\n                this.handleChangelogCommand();\n                this.editor.setText("");\n                return;\n            }`,
      "",
    );
    next = next.replace("getChangelogForDisplay() {", "getChangelogForDisplay() { return undefined;");
    next = next.replace("handleChangelogCommand() {", "handleChangelogCommand() { return;");
  }
  if (url.includes("settings-selector.js") || url === "") {
    next = next.replace(
      `\n            {\n                id: "collapse-changelog",\n                label: "Collapse changelog",\n                description: "Show condensed changelog after updates",\n                currentValue: config.collapseChangelog ? "true" : "false",\n                values: ["true", "false"],\n            },`,
      "",
    );
    next = next.replace(
      `\n                case "collapse-changelog":\n                    callbacks.onCollapseChangelogChange(newValue === "true");\n                    break;`,
      "",
    );
  }
  return next;
}
