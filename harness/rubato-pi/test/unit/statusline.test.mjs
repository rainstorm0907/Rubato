import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBrandMark,
  cacheHitPercent,
  formatContext,
  formatLatency,
  formatLatencyMs,
  formatModelWithEffort,
  formatStatusline,
  formatWindow,
  latestAssistantTiming,
  latestAssistantUsage,
  remainingPercent,
  repoBasename,
  shortModelLabel,
  statuslineSegments,
  visibleColumns,
  formatElapsedClock,
  formatBackgroundEntry,
  formatBackgroundLine,
  backgroundEntriesFromEvent,
} from "../../src/statusline.mjs";
import { BRAND_NAME } from "../../src/brand.mjs";
import { installStatusline, extensionStatusLine } from "../../src/extensions/statusline.mjs";
import { createBackgroundTracker } from "../../src/background-tracker.mjs";

test("shortens Claude-style model ids the way the statusline does", () => {
  assert.equal(shortModelLabel("claude-opus-4.8"), "Opus 4.8");
  assert.equal(shortModelLabel("anthropic/claude-opus-5:high"), "Opus 5");
  assert.equal(shortModelLabel("claude-sonnet-4-6-20251001"), "Sonnet 4.6");
  assert.equal(shortModelLabel("xai/grok-4.6"), "Grok 4.6");
  assert.equal(shortModelLabel("gpt-5.6-sol"), "5.6 Sol");
  assert.equal(shortModelLabel("openai-codex/gpt-5.6-sol"), "5.6 Sol");
  assert.equal(shortModelLabel("gpt-5.6-luna"), "5.6 Luna");
  assert.equal(shortModelLabel("openai-codex/gpt-5.6-luna"), "5.6 Luna");
  assert.equal(shortModelLabel("gpt-5.6-terra"), "5.6 Terra");
  assert.equal(shortModelLabel("openai-codex/gpt-5.6-terra"), "5.6 Terra");
  assert.equal(shortModelLabel("quotio-openai/gpt-5.6-luna-fast"), "5.6 Luna");
  assert.equal(shortModelLabel("unknown-model:high"), "unknown-model");
});

test("appends reasoning effort next to the short model name", () => {
  assert.equal(formatModelWithEffort("anthropic/claude-opus-5", "high"), "Opus 5 high");
  assert.equal(formatModelWithEffort("xai/grok-4.6", "xhigh"), "Grok 4.6 Xhigh");
  assert.equal(formatModelWithEffort("gpt-5.6-sol", "high"), "5.6 Sol high");
  assert.equal(formatModelWithEffort("openai-codex/gpt-5.6-luna", "high"), "5.6 Luna high");
  assert.equal(formatModelWithEffort("openai-codex/gpt-5.6-terra", "medium"), "5.6 Terra medium");
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

test("latest assistant timing skips stale and malformed persisted entries", () => {
  const timing = latestAssistantTiming([
    { type: "message", message: { role: "assistant", timing: { processStartedAt: 42, ttftMs: 100, modelDurationMs: 200 } } },
    { type: "message", message: { role: "assistant", timing: { processStartedAt: 42, ttftMs: 300, modelDurationMs: 900 } } },
    { type: "message", message: { role: "assistant", timing: { processStartedAt: 42, ttftMs: NaN } } },
    { type: "message", message: { role: "assistant", timing: {} } },
  ], 42);
  assert.deepEqual(timing, { processStartedAt: 42, ttftMs: 300, modelDurationMs: 900 });
  assert.equal(latestAssistantTiming([
    { type: "message", message: { role: "assistant", timing: { processStartedAt: 41, ttftMs: 500 } } },
  ], 42), null);
  assert.equal(latestAssistantTiming([], 42), null);
});

test("latency milliseconds render as ms under a second, seconds above it", () => {
  assert.equal(formatLatencyMs(340), "340ms");
  assert.equal(formatLatencyMs(999), "999ms");
  assert.equal(formatLatencyMs(1000), "1.0s");
  assert.equal(formatLatencyMs(3420), "3.4s");
  assert.equal(formatLatencyMs(undefined), "");
  assert.equal(formatLatencyMs(null), "");
  assert.equal(formatLatencyMs(-1), "");
  assert.equal(formatLatencyMs(NaN), "");
  assert.equal(formatLatencyMs(Number.MAX_VALUE), "");
});

test("the latency footer segment shows ttft but never raw turn duration", () => {
  assert.equal(formatLatency({ ttftMs: 420, modelDurationMs: 3400 }), "ttft 420ms");
  assert.equal(formatLatency({ modelDurationMs: 1200 }), "");
  assert.equal(formatLatency({ ttftMs: 200 }), "ttft 200ms");
  assert.equal(formatLatency({}), "");
  assert.equal(formatLatency(null), "");
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
  // Cache is a `·` segment now: glued to the repo it read as a repo-owned number.
  // No timing on this branch, so no latency segment appears.
  const left = "✦ Opus 5 high · 60%(1M) · main · agent-taskforce · Cache 80%";
  assert.deepEqual(footer.render(120), [appendBrandMark(left, 120)]);
  assert.match(footer.render(120)[0], new RegExp(`${BRAND_NAME}$`));
  assert.equal(visibleColumns(footer.render(120)[0]), 120);
  assert.equal(footer.render(70)[0], left);
  assert.ok(!footer.render(70)[0].includes(BRAND_NAME));
  assert.equal(colors.at(-1), "dim");
});

test("the footer shows current-process ttft without rendering raw turn duration", () => {
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
            timing: { sentAt: 1_700_000_000_000, processStartedAt: 42, ttftMs: 420, modelDurationMs: 3400 },
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

  installStatusline(pi, { processStartedAt: 42 });
  const footer = factory(
    { requestRender() {} },
    { fg: (_color, text) => text },
    { getGitBranch: () => "main", onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() },
  );
  const left = "✦ Opus 5 high · 60%(1M) · main · agent-taskforce · Cache 80% · ttft 420ms";
  const rendered = footer.render(140)[0];
  assert.equal(rendered.startsWith(left), true);
  assert.equal(rendered.includes("turn"), false);
});

test("the brand mark sits on the right only when the terminal is wide", () => {
  const left = "✦ Opus 5 high · 60%(1M)";
  assert.equal(appendBrandMark(left, 40), left);
  const wide = appendBrandMark(left, 80);
  assert.match(wide, new RegExp(`${BRAND_NAME}$`));
  assert.equal(visibleColumns(wide), 80);
  assert.ok(wide.startsWith(left));
  assert.ok(wide.includes(" "));
});

test("elapsed time is a clock, not a relative age", () => {
  const start = 1_000_000;
  assert.equal(formatElapsedClock(start, start), "00:00");
  assert.equal(formatElapsedClock(start, start + 44_000), "00:44");
  assert.equal(formatElapsedClock(start, start + 344_000), "05:44");
  assert.equal(formatElapsedClock(start, start + 3_944_000), "1:05:44");
  // A clock that ran backwards must not print a negative time.
  assert.equal(formatElapsedClock(start, start - 5_000), "00:00");
  assert.equal(formatElapsedClock(undefined, start), "");
});

test("each background source is unpacked from its own payload field", () => {
  assert.deepEqual(
    backgroundEntriesFromEvent({
      source: "terminal-background-sessions",
      items: [{ id: "bash_1", description: "build", startedAtMs: 7 }],
    }),
    { source: "terminal-background-sessions", entries: [{ id: "bash_1", description: "build", startedAtMs: 7 }] },
  );
  assert.deepEqual(
    backgroundEntriesFromEvent({
      source: "terminal-monitors",
      monitors: [{ id: "mon_1", description: "watch", startedAtMs: 9 }],
    }),
    { source: "terminal-monitors", entries: [{ id: "mon_1", description: "watch", startedAtMs: 9 }] },
  );
  // Subagents belong to the widget, not the footer.
  assert.equal(backgroundEntriesFromEvent({
    source: "senpi-task",
    channels: [{ id: "st_1", description: "reviewer", startedAtMs: 5 }],
  }), null);
  // A source we do not render must not be mistaken for an empty snapshot of one we do.
  assert.equal(backgroundEntriesFromEvent({ source: "something-else", items: [] }), null);
});

test("a background entry shows its model only when one is known", () => {
  const now = 344_000;
  assert.equal(
    formatBackgroundEntry({ description: "reviewer", startedAtMs: 0, model: "anthropic/claude-opus-5" }, now),
    "reviewer Opus 5 05:44",
  );
  assert.equal(formatBackgroundEntry({ description: "build", startedAtMs: 0 }, now), "build 05:44");
});

test("the background line groups sources and folds overflow into a count", () => {
  const groups = new Map([
    ["senpi-task", [
      { id: "a", description: "reviewer", startedAtMs: 0, model: "anthropic/claude-opus-5" },
      { id: "b", description: "builder", startedAtMs: 152_000, model: "xai/grok-4.6" },
    ]],
    ["terminal-background-sessions", [{ id: "bash_1", description: "build", startedAtMs: 254_000 }]],
    ["terminal-monitors", [{ id: "mon_1", description: "watch", startedAtMs: 164_000 }]],
  ]);
  assert.equal(
    formatBackgroundLine(groups, 344_000, 200),
    "⌘ build 01:30   ◉ watch 03:00",
  );
  // Too narrow to name everyone: the count survives even when the names do not.
  assert.equal(formatBackgroundLine(groups, 344_000, 12), "⌘ +1   ◉ +1");
  assert.equal(formatBackgroundLine(new Map(), 344_000, 200), "");
});

test("the tracker redraws on change and stays quiet on a repeat", () => {
  const tracker = createBackgroundTracker();
  const event = { source: "terminal-background-sessions", items: [{ id: "bash_1", description: "build", startedAtMs: 5 }] };
  assert.equal(tracker.accept(event), true);
  assert.equal(tracker.accept({ ...event }), false, "an identical snapshot must not force a render");
  assert.equal(tracker.active(), true);
  assert.equal(tracker.accept({ source: "terminal-background-sessions", items: [] }), true);
  assert.equal(tracker.active(), false, "an empty snapshot must let the ticker stop");
  assert.equal(tracker.accept({ source: "senpi-task", channels: [{ id: "st_1", description: "reviewer", startedAtMs: 5 }] }), false);
  assert.equal(tracker.accept({ source: "unrelated", items: [] }), false);
});

test("the memory backlog line is dropped from the footer", () => {
  const statuses = new Map([
    ["memory", "mem:agent-taskforce-a686370c 1h ago (+26)"],
    ["monitors", "◉ watching 2: build, tests (3m)"],
    ["  omo-native", "omo-native"],
  ]);
  const line = extensionStatusLine(statuses);
  assert.ok(!line.includes("mem:"), "the reflection backlog is noise, not status");
  assert.ok(line.includes("watching 2"));
  assert.equal(line, "omo-native · ◉ watching 2: build, tests (3m)");
  assert.equal(extensionStatusLine(new Map()), "");
  assert.equal(extensionStatusLine(undefined), "");
});
