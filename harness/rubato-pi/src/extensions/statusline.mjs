import {
  cacheHitPercent,
  formatCacheHit,
  formatContext,
  formatModelWithEffort,
  latestAssistantUsage,
  remainingPercent,
  repoBasename,
  truncateToWidth,
} from "../statusline.mjs";

function remainingColor(remaining) {
  if (remaining == null) return "dim";
  if (remaining > 70) return "success";
  if (remaining > 40) return "warning";
  return "error";
}

export function installStatusline(pi) {
  pi.on("session_start", (_event, ctx) => {
    if (typeof ctx.ui?.setFooter !== "function") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange?.(() => tui.requestRender?.());
      return {
        dispose: unsub,
        invalidate() {},
        render(width) {
          const usage = ctx.getContextUsage?.();
          const remaining = remainingPercent(usage?.percent);
          const window = usage?.contextWindow ?? ctx.model?.contextWindow;
          const cache = cacheHitPercent(latestAssistantUsage(ctx.sessionManager?.getBranch?.() ?? []));
          const parts = [
            {
              text: `✦ ${formatModelWithEffort(ctx.model?.id, ctx.thinkingLevel ?? ctx.getThinkingLevel?.())}`,
              color: "accent",
            },
            { text: formatContext(remaining, window), color: remainingColor(remaining) },
          ];
          const branch = footerData.getGitBranch?.();
          if (branch) parts.push({ text: branch, color: "dim" });
          const repo = repoBasename(ctx.cwd);
          if (repo) parts.push({ text: repo, color: "text" });

          const colored = parts
            .map((part) => (theme?.fg ? theme.fg(part.color, part.text) : part.text))
            .join(" · ");
          const cacheText = formatCacheHit(cache);
          const painted = cacheText
            ? `${colored}${theme?.fg ? theme.fg("dim", cacheText) : cacheText}`
            : colored;
          const lines = [truncateToWidth(painted, width)];

          const statuses = footerData.getExtensionStatuses?.();
          if (statuses?.size > 0) {
            const statusLine = Array.from(statuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => String(text).replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim())
              .join(" ");
            lines.push(truncateToWidth(statusLine, width));
          }
          return lines;
        },
      };
    });
  });
}

export default function statuslineExtension(pi) {
  installStatusline(pi);
}
