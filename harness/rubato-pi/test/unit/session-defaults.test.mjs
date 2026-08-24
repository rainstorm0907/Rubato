import test from "node:test";
import assert from "node:assert/strict";
import {
  argvHasModel,
  argvRestoresSession,
  ensureModelsConfig,
  ensureSessionDefaults,
  modelsLookCurrent,
  sessionDefaultsLookCurrent,
  settingsLookCurrent,
} from "../../src/session-defaults.mjs";

test("launch keeps an explicit model flag and fills Opus otherwise", () => {
  assert.equal(argvHasModel(["--mode", "rpc"]), false);
  assert.equal(argvHasModel(["--model", "xai/grok-4.6"]), true);
  assert.equal(argvHasModel(["--provider", "xai"]), true);
});

test("session restoration flags preserve the persisted model", () => {
  for (const argv of [
    ["--session", "/tmp/session.jsonl"],
    ["--continue"],
    ["-c"],
    ["--resume"],
    ["-r"],
  ]) {
    assert.equal(argvRestoresSession(argv), true, argv.join(" "));
  }
  assert.equal(argvRestoresSession(["--session=/tmp/session.jsonl"]), false);
  assert.equal(argvRestoresSession(["--session-id", "01abc"]), false);
  assert.equal(argvRestoresSession(["--fork", "/tmp/session.jsonl"]), false);
  assert.equal(argvRestoresSession(["--mode", "rpc"]), false);
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

// 회귀: Codex 를 직접 물기 전에는 openai-codex 가 정당하게 disabled 로 박혔다.
// 그 뒤 우리 프로바이더가 되었는데도 파일에 남은 옛 항목 탓에 피커에서 사라졌다.
// 이제는 우리 것으로 돌아온 id 를 파일에서 회수한다.
test("models.json reclaims a provider that became ours after it was disabled", () => {
  const next = ensureModelsConfig("/tmp/agent", {
    exists: () => true,
    readFile: () => JSON.stringify({
      providers: {},
      disabledProviders: ["openai-codex", "vercel-ai-gateway"],
    }),
    writeFile: () => {},
  });
  assert.ok(!next.disabledProviders.includes("openai-codex"), "stale openai-codex must be reclaimed");
  assert.ok(next.disabledProviders.includes("vercel-ai-gateway"), "genuinely foreign ids stay disabled");
});

test("already-current session files are left untouched", () => {
  const written = {};
  const settings = {
    defaultProvider: "anthropic",
    defaultModel: "claude-opus-5",
    hideThinkingBlock: true,
    tips: false,
    retry: { maxRetries: 5 },
    disabledBuiltinExtensions: ["claude-sdk-oauth", "cursor-cli-oauth"],
    theme: "dark",
  };
  const models = {
    providers: {},
    disabledProviders: ["vercel-ai-gateway", "alibaba-token-plan"],
  };
  const files = {
    "/tmp/agent/settings.json": JSON.stringify(settings),
    "/tmp/agent/models.json": JSON.stringify(models),
  };
  const hooks = {
    exists: (path) => path in files,
    readFile: (path) => files[path],
    writeFile: (path, text) => {
      written[path] = text;
    },
  };
  assert.equal(sessionDefaultsLookCurrent("/tmp/agent", hooks), true);
  const next = ensureSessionDefaults("/tmp/agent", hooks);
  assert.equal(next.theme, "dark");
  assert.deepEqual(written, {});
});

test("live catalog with a new broker provider is not treated as current", () => {
  const models = { disabledProviders: ["vercel-ai-gateway", "newco"] };
  assert.equal(modelsLookCurrent(models), true);
  assert.equal(
    modelsLookCurrent(models, [{ id: "anthropic/claude-opus-5" }, { id: "newco/widget" }]),
    false,
  );
});

test("stale models that still disable a broker provider are not treated as current", () => {
  assert.equal(
    modelsLookCurrent(
      { disabledProviders: ["vercel-ai-gateway", "openai-codex"] },
      [{ id: "openai-codex/gpt-5.6-sol" }],
    ),
    false,
  );
  assert.equal(
    settingsLookCurrent({
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-5",
      hideThinkingBlock: true,
      tips: false,
      disabledBuiltinExtensions: ["claude-sdk-oauth"],
      retry: { maxRetries: 5 },
    }),
    false,
  );
});

// 브로커가 내려주는 카탈로그를 넘기면 그 프로바이더도 회수 대상이다.
test("models.json reclaims providers present in the live broker catalog", () => {
  const next = ensureModelsConfig("/tmp/agent", {
    exists: () => true,
    readFile: () => JSON.stringify({ providers: {}, disabledProviders: ["openai"] }),
    writeFile: () => {},
    catalog: [{ id: "openai/gpt-5.6-sol" }, { id: "openai-codex/gpt-5.6-sol" }],
  });
  assert.ok(!next.disabledProviders.includes("openai"), "a live broker provider must not stay disabled");
});
