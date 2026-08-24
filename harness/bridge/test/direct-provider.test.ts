import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeCodeUserAgentFromTarget, claudeToolToFx, fxBodyToPiStreamOptions, fxPromptToPiContext, fxToolToClaude, isDirectModel, piUsageToFx, readClaudeSetupToken } from "../src/direct-provider.ts";
import { fixtureJson } from "./helpers.ts";

test("fx history and tools become pi-ai context without executing tools", () => {
  const body = fixtureJson("fx-tool-request.json");
  const context = fxPromptToPiContext(body.prompt, body.tools);
  assert.deepEqual(context.messages[1].content[0], {
    type: "toolCall",
    id: "call_1",
    name: "read_file",
    arguments: { path: "README.md" },
  });
  assert.deepEqual(context.messages[2], {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "read_file",
    content: [{ type: "text", text: "hello" }],
    isError: false,
    timestamp: context.messages[2].timestamp,
  });
  assert.deepEqual(context.tools, [{
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  }]);
});

test("xAI and Anthropic use the direct provider route", () => {
  assert.equal(isDirectModel("xai/grok-4.6"), true);
  assert.equal(isDirectModel("anthropic/claude-opus-5"), true);
  assert.equal(isDirectModel("cursor/grok-4.6"), false);
  assert.equal(isDirectModel("openai/gpt-5.6-sol"), false);
});

test("openai-codex fx bodies carry only priority service_tier into pi-ai stream options", () => {
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "priority", reasoning: "high" }), {
    thinking: "high",
    serviceTier: "priority",
  });
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "auto", maxOutputTokens: 1024 }), {
    maxTokens: 1024,
  });
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "default" }), {});
  assert.deepEqual(fxBodyToPiStreamOptions({}), {});
});

test("Claude direct presents fx tools with Claude Code-compatible names", () => {
  assert.equal(fxToolToClaude("read_file"), "Read");
  assert.equal(claudeToolToFx("Read"), "read_file");
  assert.equal(fxToolToClaude("custom_lookup"), "mcp__fx__custom_lookup");
  assert.equal(claudeToolToFx("mcp__fx__custom_lookup"), "custom_lookup");
  const body = fixtureJson("fx-tool-request.json");
  const context = fxPromptToPiContext(body.prompt, body.tools, "anthropic", "claude-opus-5");
  assert.equal(context.tools[0].name, "Read");
  assert.equal(context.messages[1].content[0].name, "Read");
  assert.equal(context.messages[2].toolName, "Read");
});

test("Claude direct uses the installed Claude Code version in its identity header", () => {
  assert.equal(claudeCodeUserAgentFromTarget("/Users/test/.local/share/claude/versions/2.1.237"), "claude-cli/2.1.237");
  assert.throws(() => claudeCodeUserAgentFromTarget("/tmp/claude"), /cannot determine Claude Code version/);
});

test("Claude setup-token prefers the dedicated file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fx-claude-token-"));
  const tokenFile = join(directory, "setup-token-sub");
  const token = "sk-ant-oat-test-file-token";
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const previous = process.env.FX_CLAUDE_SETUP_TOKEN_FILE;
  process.env.FX_CLAUDE_SETUP_TOKEN_FILE = tokenFile;
  try {
    assert.equal(await readClaudeSetupToken("sub"), token);
  } finally {
    if (previous === undefined) delete process.env.FX_CLAUDE_SETUP_TOKEN_FILE;
    else process.env.FX_CLAUDE_SETUP_TOKEN_FILE = previous;
  }
});

test("thinking blocks and user images survive the Claude context conversion", () => {
  const context = fxPromptToPiContext([
    {
      role: "user",
      content: [
        { type: "text", text: "see" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "plan", signature: "sig-1" },
        { type: "text", text: "ok" },
      ],
    },
  ], undefined, "anthropic", "claude-opus-5");
  assert.deepEqual(context.messages[0].content, [
    { type: "text", text: "see" },
    { type: "image", data: "abc", mimeType: "image/png" },
  ]);
  assert.deepEqual(context.messages[1].content[0], {
    type: "thinking",
    thinking: "plan",
    thinkingSignature: "sig-1",
  });
  assert.equal(context.messages[1].content[1].text, "ok");
});

test("pi-ai cache usage becomes fx measured token usage", () => {
  assert.deepEqual(piUsageToFx({ input: 141, output: 1, cacheRead: 256, cacheWrite: 0, reasoning: 48 }), {
    inputTokens: { total: 397, noCache: 141, cacheRead: 256, cacheWrite: 0 },
    outputTokens: { total: 1, reasoning: 48 },
  });
});

test("pi-ai missing usage stays unavailable while reported zero remains measured", () => {
  assert.equal(piUsageToFx(undefined), undefined);
  assert.deepEqual(piUsageToFx({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0 },
  });
});
