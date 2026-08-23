import test from "node:test";
import assert from "node:assert/strict";
import { argvHasModel, ensureModelsConfig, ensureSessionDefaults } from "../../src/session-defaults.mjs";

test("launch keeps an explicit model flag and fills Opus otherwise", () => {
  assert.equal(argvHasModel(["--mode", "rpc"]), false);
  assert.equal(argvHasModel(["--model", "xai/grok-4.6"]), true);
  assert.equal(argvHasModel(["--provider", "xai"]), true);
});

test("session defaults pin Opus without dropping other settings", () => {
  const written = {};
  const next = ensureSessionDefaults("/tmp/agent", {
    exists: (path) => path.endsWith("settings.json"),
    readFile: () => JSON.stringify({ theme: "dark", defaultModel: "gpt-5.6-sol" }),
    writeFile: (path, text) => {
      written[path] = text;
    },
  });
  assert.equal(next.defaultProvider, "anthropic");
  assert.equal(next.defaultModel, "claude-opus-5");
  assert.equal(next.theme, "dark");
  assert.equal(next.hideThinkingBlock, true);
  assert.equal(next.tips, false);
  assert.ok(next.disabledBuiltinExtensions.includes("claude-sdk-oauth"));
  assert.ok(next.disabledBuiltinExtensions.includes("cursor-cli-oauth"));
  assert.match(written["/tmp/agent/settings.json"], /claude-opus-5/);
});

test("session defaults preserve an explicit thinking visibility preference", () => {
  const next = ensureSessionDefaults("/tmp/agent", {
    exists: (path) => path.endsWith("settings.json"),
    readFile: () => JSON.stringify({ hideThinkingBlock: false }),
    writeFile: () => {},
  });
  assert.equal(next.hideThinkingBlock, false);
});

test("models.json disables vercel and other foreign builtins without dropping user providers", () => {
  let written = "";
  const next = ensureModelsConfig("/tmp/agent", {
    exists: () => true,
    readFile: () => JSON.stringify({
      providers: { custom: { name: "mine" } },
      disabledProviders: ["already-off"],
    }),
    writeFile: (_path, text) => {
      written = text;
    },
  });
  assert.equal(next.providers.custom.name, "mine");
  assert.ok(next.disabledProviders.includes("already-off"));
  assert.ok(next.disabledProviders.includes("vercel-ai-gateway"));
  assert.ok(next.disabledProviders.includes("alibaba-token-plan"));
  // Codex 를 직접 물면서 브로커가 서비스하는 id 가 openai -> openai-codex 로 바뀌었다.
  for (const kept of ["anthropic", "openai-codex", "xai"]) {
    assert.ok(!next.disabledProviders.includes(kept), `${kept} is served by the broker`);
  }
  assert.match(written, /vercel-ai-gateway/);
});
