import test from "node:test";
import assert from "node:assert/strict";
import {
  cacheHitPercent,
  formatContext,
  formatModelWithEffort,
  formatStatusline,
  formatWindow,
  latestAssistantUsage,
  remainingPercent,
  repoBasename,
  shortModelLabel,
  statuslineSegments,
} from "../../src/statusline.mjs";
import { installStatusline } from "../../src/extensions/statusline.mjs";

test("shortens Claude-style model ids the way the statusline does", () => {
  assert.equal(shortModelLabel("claude-opus-4.8"), "Opus 4.8");
  assert.equal(shortModelLabel("anthropic/claude-opus-5:high"), "Opus 5");
  assert.equal(shortModelLabel("claude-sonnet-4-6-20251001"), "Sonnet 4.6");
  assert.equal(shortModelLabel("xai/grok-4.6"), "Grok 4.6");
  assert.equal(shortModelLabel("gpt-5.6-sol"), "5.6 Sol");
  assert.equal(shortModelLabel("openai-codex/gpt-5.6-sol"), "5.6 Sol");
  assert.equal(shortModelLabel("unknown-model:high"), "unknown-model");
});

test("appends reasoning effort next to the short model name", () => {
  assert.equal(formatModelWithEffort("anthropic/claude-opus-5", "high"), "Opus 5 high");
  assert.equal(formatModelWithEffort("xai/grok-4.6", "xhigh"), "Grok 4.6 Xhigh");
  assert.equal(formatModelWithEffort("gpt-5.6-sol", "high"), "5.6 Sol high");
  assert.equal(formatModelWithEffort("anthropic/claude-opus-5:high"), "Opus 5 high");
  assert.equal(formatModelWithEffort("claude-opus-5", "off"), "Opus 5");
});

test("remaining percent is unused context, Claude-style", () => {
  assert.equal(remainingPercent(0), 100);
  assert.equal(remainingPercent(0.0), 100);
  assert.equal(remainingPercent(40), 60);
  assert.equal(remainingPercent(null), null);
  assert.equal(remainingPercent(undefined), null);
});

test("context window is the active model's max, not a fixed 200K", () => {
  assert.equal(formatWindow(1_000_000), "1M");
  assert.equal(formatWindow(200_000), "200K");
  assert.equal(formatWindow(500_000), "500K");
  assert.equal(formatWindow(372_000), "372K");
  assert.equal(formatContext(60, 1_000_000), "60%(1M)");
  assert.equal(formatContext(100, 200_000), "100%(200K)");
  assert.equal(formatContext(null, 1_000_000), "?(1M)");
});

test("cache hit percent uses the last prompt, including writes", () => {
  assert.equal(cacheHitPercent({ input: 20, cacheRead: 80, cacheWrite: 0 }), 80);
  assert.equal(cacheHitPercent({ input: 10, cacheRead: 80, cacheWrite: 10 }), 80);
  assert.equal(cacheHitPercent({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
  assert.equal(cacheHitPercent(null), null);
});

test("latest assistant usage walks the branch backwards", () => {
  const usage = latestAssistantUsage([
    { type: "message", message: { role: "assistant", usage: { input: 1, cacheRead: 1, cacheWrite: 0 } } },
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant", usage: { input: 20, cacheRead: 80, cacheWrite: 0 } } },
  ]);
  assert.deepEqual(usage, { input: 20, cacheRead: 80, cacheWrite: 0 });
  assert.equal(latestAssistantUsage([]), null);
});

test("statusline order is model, remaining with window, branch, repo, cache", () => {
  assert.equal(repoBasename("/Users/wy/Github-repos/agent-taskforce"), "agent-taskforce");
  assert.equal(
    formatStatusline({
      model: "Opus 5 high",
      remaining: 60,
      window: 1_000_000,
      branch: "main",
      repo: "agent-taskforce",
      cache: 98,
    }),
    "✦ Opus 5 high · 60%(1M) · main · agent-taskforce (98%)",
  );
  assert.deepEqual(
    statuslineSegments({
      model: "5.6 Sol high",
      remaining: 100,
      window: 372_000,
      branch: "main",
      repo: "agent-taskforce",
    }),
    ["✦ 5.6 Sol high", "100%(372K)", "main", "agent-taskforce"],
  );
});

test("installStatusline paints effort and the model context window", () => {
  let factory;
  const ctx = {
    cwd: "/Users/wy/Github-repos/agent-taskforce",
    model: { id: "anthropic/claude-opus-5", contextWindow: 1_000_000 },
    thinkingLevel: "high",
    getContextUsage: () => ({ tokens: 400_000, contextWindow: 1_000_000, percent: 40 }),
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            usage: { input: 20, cacheRead: 80, cacheWrite: 0 },
          },
        },
      ],
    },
    ui: {
      setFooter(next) {
        factory = next;
      },
    },
  };
  const pi = {
    on(event, handler) {
      if (event === "session_start") handler({ type: "session_start", reason: "startup" }, ctx);
    },
  };

  installStatusline(pi);
  assert.equal(typeof factory, "function");

  const colors = [];
  const footer = factory(
    { requestRender() {} },
    {
      fg(color, text) {
        colors.push(color);
        return text;
      },
    },
    { getGitBranch: () => "main", onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() },
  );
  assert.deepEqual(footer.render(120), ["✦ Opus 5 high · 60%(1M) · main · agent-taskforce (80%)"]);
  assert.equal(colors.at(-1), "dim");
});
