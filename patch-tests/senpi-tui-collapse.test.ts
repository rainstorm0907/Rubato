import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../node_modules/@code-yeongyu/senpi/dist/utils/ansi.js";
import { dispatchInternalAction, registerInternalAction } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/internal-actions.js";
import { ToolExecutionComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/tool-execution.js";
import { AssistantMessageComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/assistant-message.js";
import { initTheme } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

const ui = { requestRender() {} } as any;
const osc8Url = (lines: string[]) => lines.join("\n").match(/\x1b\]8;;([^\x1b\x07]+)/)?.[1];

describe("Senpi local collapse patch", () => {
  test("internal actions dispatch without treating unknown URLs as internal", () => {
    let calls = 0;
    const action = registerInternalAction(() => calls++);
    expect(dispatchInternalAction("https://example.com")).toBe(false);
    expect(dispatchInternalAction(action.url)).toBe(true);
    expect(calls).toBe(1);
    action.dispose();
    expect(dispatchInternalAction(action.url)).toBe(true);
    expect(calls).toBe(1);
  });

  test("a tool owns its collapsed and expanded state", () => {
    const component = new ToolExecutionComponent("bash", "tool-1", { command: "printf hello" }, {}, undefined, ui, process.cwd());
    component.setArgsComplete();
    component.updateResult({ content: [{ type: "text", text: "one\ntwo" }], details: {}, isError: false });

    const collapsed = component.render(80);
    expect(collapsed).toHaveLength(1);
    expect(stripAnsi(collapsed.join("\n"))).toContain("bash");
    const url = osc8Url(collapsed);
    expect(url).toStartWith("senpi-action:");

    dispatchInternalAction(url!);
    expect(stripAnsi(component.render(80).join("\n"))).toContain("printf hello");
    dispatchInternalAction(url!);
    expect(component.render(80)).toHaveLength(1);
    component.dispose();
  });

  test("thinking is compact by default and toggles only its component", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "answer" }],
      stopReason: "stop",
      timestamp: 1,
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as any;
    const first = new AssistantMessageComponent(message, true);
    const second = new AssistantMessageComponent(message, true);

    const collapsed = first.render(80);
    expect(stripAnsi(collapsed.join("\n"))).toContain("Thinking...");
    expect(stripAnsi(collapsed.join("\n"))).not.toContain("private reasoning");
    const url = osc8Url(collapsed)!;
    dispatchInternalAction(url);
    expect(stripAnsi(first.render(80).join("\n"))).toContain("private reasoning");
    expect(stripAnsi(second.render(80).join("\n"))).not.toContain("private reasoning");
    dispatchInternalAction(url);
    expect(stripAnsi(first.render(80).join("\n"))).not.toContain("private reasoning");
    first.dispose();
    second.dispose();
  });
});
