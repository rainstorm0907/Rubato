import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../node_modules/@code-yeongyu/senpi/dist/utils/ansi.js";
import { ToolExecutionComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/tool-execution.js";
import { ToolGroupComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/tool-group.js";
import { dispatchInternalAction } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/internal-actions.js";
import { initTheme } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);
const ui = { requestRender() {} } as any;
const url = (l: string[]) => l.join("\n").match(/\x1b\]8;;([^\x1b\x07]+)/)?.[1];

function tool(name: string, args: any, text: string, isError = false) {
  const c = new ToolExecutionComponent(name, "t" + Math.random(), args, {}, undefined, ui, process.cwd());
  c.setArgsComplete();
  c.updateResult({ content: [{ type: "text", text }], details: {}, isError });
  return c;
}

describe("도구 뭉치기", () => {
  test("연속 도구는 한 줄로 접히고, 도구 이름이 남는다", () => {
    const g = new ToolGroupComponent(ui);
    g.addTool(tool("ls", { path: "harness" }, "a\nb\nc"));
    g.addTool(tool("read", { path: "src/a.ts" }, "x\ny"));
    g.addTool(tool("bash", { command: "npm run build" }, "ok"));

    const lines = g.render(92);
    expect(lines).toHaveLength(1);
    const text = stripAnsi(lines.join(""));
    expect(text).toContain("3 tools");
    expect(text).toContain("ls");
    expect(text).toContain("read");
    expect(text).toContain("bash");
    g.dispose();
  });

  test("클릭하면 펼쳐지고 각 도구가 자기 내용을 그린다", () => {
    const g = new ToolGroupComponent(ui);
    g.addTool(tool("ls", { path: "harness" }, "alpha\nbeta\ngamma"));
    const collapsed = g.render(92);
    expect(collapsed).toHaveLength(1);
    expect(stripAnsi(collapsed.join("\n"))).not.toContain("alpha");

    dispatchInternalAction(url(collapsed)!);
    const expanded = stripAnsi(g.render(92).join("\n"));
    expect(expanded).toContain("alpha");
    expect(expanded).toContain("gamma");
    g.dispose();
  });

  test("실패해도 줄은 늘지 않고 그 도구 이름만 색이 붙는다", () => {
    const g = new ToolGroupComponent(ui);
    g.addTool(tool("ls", { path: "." }, "a"));
    g.addTool(tool("bash", { command: "bun test" }, "FAIL\nexpected 200 got 500", true));

    const lines = g.render(92);
    expect(lines).toHaveLength(1);
    const raw = lines.join("");
    // 실패한 bash 만 벽돌빛(196,116,110)을 두른다.
    const failed = raw.match(/\x1b\[38;2;196;116;110m([^\x1b]+)/)?.[1];
    expect(failed).toBe("bash");
    // 성공한 ls 는 그 색이 아니다.
    expect(stripAnsi(raw)).toContain("ls");
    g.dispose();
  });

  test("task·dag·team_create·todo 는 뭉치지 않는다", () => {
    for (const name of ["task", "dag", "team_create", "todo"]) {
      expect(ToolGroupComponent.canGroup(name)).toBe(false);
    }
    for (const name of ["ls", "read", "grep", "bash", "edit", "write", "eval"]) {
      expect(ToolGroupComponent.canGroup(name)).toBe(true);
    }
  });

  test("숨긴 줄 수는 적지 않는다 — 노이즈를 줄이는 게 목적이다", () => {
    const g = new ToolGroupComponent(ui);
    g.addTool(tool("ls", { path: "." }, Array.from({ length: 12 }, (_, i) => `f${i}`).join("\n")));
    const text = stripAnsi(g.render(92).join(""));
    expect(text).toContain("1 tool");
    expect(text).not.toMatch(/\d+ lines/);
    g.dispose();
  });
});
