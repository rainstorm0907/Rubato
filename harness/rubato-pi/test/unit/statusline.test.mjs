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
  formatElapsedClock,
  formatBackgroundEntry,
  formatBackgroundLine,
  backgroundEntriesFromEvent,
} from "../../src/statusline.mjs";
import { installStatusline, extensionStatusLine } from "../../src/extensions/statusline.mjs";
import { createBackgroundTracker, createTaskModelReader } from "../../src/background-tracker.mjs";

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
  assert.deepEqual(footer.render(120), ["✦ Opus 5 high · 60%(1M) · main · agent-taskforce · Cache 80%"]);
  assert.equal(colors.at(-1), "dim");
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
      source: "senpi-task",
      channels: [{ id: "st_1", description: "reviewer", startedAtMs: 5 }],
    }),
    { source: "senpi-task", entries: [{ id: "st_1", description: "reviewer", startedAtMs: 5 }] },
  );
  assert.deepEqual(
    backgroundEntriesFromEvent({
      source: "terminal-background-sessions",
      items: [{ id: "bash_1", description: "build", startedAtMs: 7 }],
    }),
    { source: "terminal-background-sessions", entries: [{ id: "bash_1", description: "build", startedAtMs: 7 }] },
  );
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
  ]);
  assert.equal(
    formatBackgroundLine(groups, 344_000, 200),
    "▸ reviewer Opus 5 05:44 · builder Grok 4.6 03:12   ⌘ build 01:30",
  );
  // Too narrow to name everyone: the count survives even when the names do not.
  assert.equal(formatBackgroundLine(groups, 344_000, 20), "▸ +2   ⌘ +1");
  assert.equal(formatBackgroundLine(new Map(), 344_000, 200), "");
});

test("the tracker redraws on change and stays quiet on a repeat", () => {
  const tracker = createBackgroundTracker();
  const event = { source: "senpi-task", channels: [{ id: "st_1", description: "reviewer", startedAtMs: 5 }] };
  assert.equal(tracker.accept(event), true);
  assert.equal(tracker.accept({ ...event }), false, "an identical snapshot must not force a render");
  assert.equal(tracker.active(), true);
  assert.equal(tracker.accept({ source: "senpi-task", channels: [] }), true);
  assert.equal(tracker.active(), false, "an empty snapshot must let the ticker stop");
  assert.equal(tracker.accept({ source: "unrelated", items: [] }), false);
});

test("the tracker attaches models to tasks only", () => {
  const tracker = createBackgroundTracker({ modelFor: (id) => (id === "st_1" ? "anthropic/claude-opus-5" : undefined) });
  tracker.accept({ source: "senpi-task", channels: [{ id: "st_1", description: "reviewer", startedAtMs: 0 }] });
  tracker.accept({ source: "terminal-background-sessions", items: [{ id: "bash_1", description: "build", startedAtMs: 0 }] });
  const groups = tracker.groups();
  assert.equal(groups.get("senpi-task")[0].model, "anthropic/claude-opus-5");
  assert.equal(groups.get("terminal-background-sessions")[0].model, undefined);
});

test("the model reader caches on mtime and survives an unreadable record", () => {
  let reads = 0;
  const reader = createTaskModelReader({
    stateDir: "/state",
    stat: (path) => (path.includes("missing") ? (() => { throw new Error("ENOENT"); })() : { mtimeMs: 42 }),
    readFile: () => {
      reads += 1;
      return JSON.stringify({ model: "anthropic/claude-opus-5" });
    },
  });
  assert.equal(reader("st_1"), "anthropic/claude-opus-5");
  assert.equal(reader("st_1"), "anthropic/claude-opus-5");
  assert.equal(reads, 1, "an unchanged mtime must not re-read the record");
  assert.equal(reader("missing"), undefined);
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
