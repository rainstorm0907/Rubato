import { Container, hyperlink, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import { registerInternalAction } from "../internal-actions.js";

/**
 * 뭉치지 않는 도구. 결과가 곧 내용이라 접으면 남는 게 없다.
 */
export const UNGROUPED_TOOLS = new Set(["task", "dag", "team_create", "todo"]);

/** 실패한 도구 이름에 쓰는 색. 회색 목록에서 눈에는 걸리되 튀지 않는 벽돌빛. */
const FAILED_TOOL_COLOR = "\x1b[38;2;196;116;110m";
/** diff 증감. 실패색과 같은 채도로 맞춰 한 줄 안에서 따로 놀지 않게 한다. */
const DIFF_ADDED_COLOR = "\x1b[38;2;122;162;122m";
const DIFF_REMOVED_COLOR = "\x1b[38;2;196;116;110m";
const RESET = "\x1b[0m";

/**
 * edit 결과의 unified diff 에서 증감을 센다.
 * `---`/`+++` 헤더는 변경이 아니므로 걸러낸다.
 */
function countDiff(patch) {
    if (typeof patch !== "string" || patch.length === 0) return undefined;
    let added = 0;
    let removed = 0;
    for (const line of patch.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) removed++;
    }
    return added === 0 && removed === 0 ? undefined : { added, removed };
}

/** 접힌 줄에 나열하는 도구 이름 최대 개수. 넘으면 …로 줄인다. */
const MAX_NAMES = 6;

function dim(text) {
    return theme.fg("dim", text);
}

/**
 * 연속된 도구 호출을 한 줄로 접는다.
 *
 * 접힘:  ⋯ 도구 7개  ls·read·grep·edit·bash  +94줄
 * 펼침:  각 도구가 자기 자신을 그린다.
 *
 * 실패한 도구는 줄을 늘리지 않고 이름만 색으로 표시한다 — 어디서
 * 깨졌는지는 보이되 성공한 턴과 높이가 같다.
 */
export class ToolGroupComponent extends Container {
    constructor(ui) {
        super();
        this.ui = ui;
        this.tools = [];
        this.expanded = false;
        this.toggleAction = registerInternalAction(() => {
            this.setExpanded(!this.expanded);
            this.ui.requestRender();
        });
    }

    /** 이 도구를 뭉침에 넣을 수 있나. */
    static canGroup(toolName) {
        return !UNGROUPED_TOOLS.has(toolName);
    }

    addTool(component) {
        this.tools.push(component);
        this.addChild(component);
        component.setExpanded(this.expanded);
        this.invalidateGroup();
        this.ui.requestRender();
    }

    /**
     * 도구가 끝날 때마다 불린다. 줄 자체는 그대로고 숫자와 색만 바뀜다.
     */
    refresh() {
        this.invalidateGroup();
        this.ui.requestRender();
    }

    get size() {
        return this.tools.length;
    }

    setExpanded(expanded) {
        if (this.expanded === expanded) return;
        this.expanded = expanded;
        for (const tool of this.tools) tool.setExpanded(expanded);
        this.invalidateGroup();
    }

    invalidateGroup() {
        this.cachedLines = undefined;
        this.invalidate();
    }

    dispose() {
        this.toggleAction.dispose();
        super.dispose();
    }

    /**
     * 접힌 줄에 적을 도구 이름들. 실패한 것만 색을 입히고,
     * edit 은 바꾼 양이 곳 판단 근거라 증감을 붙인다.
     */
    formatNames() {
        const seen = [];
        for (const tool of this.tools) {
            const name = tool.identity?.toolName ?? "?";
            const failed = tool.result?.isError === true;
            const diff = name === "edit" ? countDiff(tool.result?.details?.patch) : undefined;
            const last = seen[seen.length - 1];
            // 같은 도구가 연달아 나오면 한 번만 적는다. 단 실패나 diff 는 따로 남긴다.
            if (last && last.name === name && last.failed === failed && !diff && !last.diff) continue;
            seen.push({ name, failed, diff });
        }
        const shown = seen.slice(0, MAX_NAMES);
        const rest = seen.length - shown.length;
        const parts = shown.map(({ name, failed, diff }) => {
            const label = failed ? `${FAILED_TOOL_COLOR}${name}${RESET}` : dim(name);
            if (!diff) return label;
            const plus = `${DIFF_ADDED_COLOR}+${diff.added}${RESET}`;
            const minus = `${DIFF_REMOVED_COLOR}-${diff.removed}${RESET}`;
            return `${label} ${plus} ${minus}`;
        });
        let text = parts.join(dim("·"));
        if (rest > 0) text += dim(`·…+${rest}`);
        return text;
    }

    render(width) {
        if (this.expanded) return super.render(width);
        if (this.tools.length === 0) return [];

        const count = this.tools.length;
        const label = `${count} ${count === 1 ? "tool" : "tools"}`;
        // 숨긴 줄 수는 적지 않는다 — 펼칠지 말지를 그 숫자로 정하지는 않았다.
        // edit 의 증감만 예외로, 바뀜 양은 클릭 전에도 알아야 한다.
        const line = `${dim(`  ⋯ ${label}`)}  ${this.formatNames()}`;
        return [hyperlink(line, this.toggleAction.url)];
    }
}
