import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../node_modules/@code-yeongyu/senpi/dist/utils/ansi.js";
import { AssistantMessageComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/assistant-message.js";
import { ToolExecutionComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/tool-execution.js";
import { ToolGroupComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/tool-group.js";
import { TurnWorkSummaryComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/turn-work-summary.js";
import { dispatchInternalAction } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/internal-actions.js";
import { initTheme } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);
const ui = { requestRender() {} } as any;
const actionUrl = (lines: string[]) => lines.join("\n").match(/\x1b\]8;;([^\x1b\x07]+)/)?.[1];

function tool(id: number) {
  const component = new ToolExecutionComponent("read", `t${id}`, { path: `f${id}` }, {}, undefined, ui, process.cwd());
  component.setArgsComplete();
  component.updateResult({ content: [{ type: "text", text: `result-${id}` }], details: {}, isError: false });
  return component;
}

describe("턴 작업 요약", () => {
  test("진행 중에도 사고와 도구를 한 줄로 접고 클릭할 때만 펼친다", () => {
    const startedAt = Date.now() - 47_000;
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "숨긴 사고", startedAt, endedAt: startedAt + 47_000 }],
      timestamp: startedAt,
      stopReason: "stop",
    } as any;
    const assistant = new AssistantMessageComponent(message, true);
    const tools = new ToolGroupComponent(ui);
    for (let i = 0; i < 15; i++) tools.addTool(tool(i));
    const summary = new TurnWorkSummaryComponent(ui);
    summary.trackAssistant(assistant, message);
    summary.trackToolGroup(tools);

    expect(assistant.render(100)).toEqual([]);
    expect(tools.render(100)).toEqual([]);
    const collapsed = summary.render(100);
    expect(stripAnsi(collapsed.join(""))).toBe("Worked 1 step · thought 47s · 15 tools");
    expect(stripAnsi(collapsed.join(""))).not.toStartWith("...");

    dispatchInternalAction(actionUrl(collapsed)!);
    expect(stripAnsi(assistant.render(100).join("\n"))).toContain("Thought: 47.0s");
    expect(stripAnsi(tools.render(100).join("\n"))).toContain("15 tools");

    dispatchInternalAction(actionUrl(collapsed)!);
    expect(assistant.render(100)).toEqual([]);
    expect(tools.render(100)).toEqual([]);
    summary.dispose();
    tools.dispose();
    assistant.dispose();
  });

  test("사용자에게 보일 답변은 요약 밖에 그대로 남는다", () => {
    const startedAt = Date.now() - 2_000;
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "숨긴 사고", startedAt, endedAt: startedAt + 2_000 },
        { type: "text", text: "사용자에게 보일 답변" },
      ],
      timestamp: startedAt,
      stopReason: "stop",
    } as any;
    const assistant = new AssistantMessageComponent(message, true);
    const summary = new TurnWorkSummaryComponent(ui);
    summary.trackAssistant(assistant, message);

    const visible = stripAnsi(assistant.render(100).join("\n"));
    expect(visible).toContain("사용자에게 보일 답변");
    expect(visible).not.toContain("Thought:");
    expect(visible).not.toContain("숨긴 사고");
    summary.dispose();
    assistant.dispose();
  });
});
