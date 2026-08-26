import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeCodeUserAgentFromTarget, claudeToolToFx, directProviderToFxSse, fxBodyToPiStreamOptions, fxPromptToPiContext, fxToolToClaude, isDirectModel, piUsageToFx, providerModel, readClaudeSetupToken } from "../src/direct-provider.ts";
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
  assert.equal(isDirectModel("google-antigravity/gemini-3.7-flash"), true);
  assert.equal(isDirectModel("cursor/grok-4.6"), false);
  assert.equal(isDirectModel("openai/gpt-5.6-sol"), false);
});

test("direct provider fx bodies carry reasoning and only priority service_tier into pi-ai options", () => {
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "priority", reasoning: "high" }), {
    reasoning: "high",
    serviceTier: "priority",
  });
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "auto", maxOutputTokens: 1024 }), {
    maxTokens: 1024,
  });
  assert.deepEqual(fxBodyToPiStreamOptions({ service_tier: "default" }), {});
  assert.deepEqual(fxBodyToPiStreamOptions({}), {});
});

test("Codex fast catalog ids reach pi-ai without losing their model metadata", () => {
  assert.deepEqual(providerModel("openai-codex/gpt-5.6-sol-fast"), {
    provider: "openai-codex",
    modelId: "gpt-5.6-sol-fast",
  });
  assert.deepEqual(providerModel("openai-codex/gpt-5.6-luna-fast"), {
    provider: "openai-codex",
    modelId: "gpt-5.6-luna-fast",
  });
  assert.deepEqual(providerModel("openai-codex/gpt-5.6-terra-fast"), {
    provider: "openai-codex",
    modelId: "gpt-5.6-terra-fast",
  });
});

test("Codex fast alias sends canonical model, reasoning, and priority on the upstream wire", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fx-codex-auth-"));
  const authPath = join(directory, "auth.json");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  writeFileSync(authPath, JSON.stringify({
    "openai-codex": { type: "oauth", access: `header.${payload}.signature`, refresh: "refresh", expires: Date.now() + 3_600_000 },
  }));
  let wireBody;
  const upstreamFetch = async (_url, init) => {
    const bytes = typeof init?.body === "string" ? Buffer.from(init.body) : Buffer.from(init?.body);
    const encoded = new Headers(init?.headers).get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes;
    wireBody = JSON.parse(encoded.toString("utf8"));
    const sse = [
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"output_tokens_details":{"reasoning_tokens":1}},"output":[]}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const frames = [];
  for await (const frame of directProviderToFxSse({
    model: "openai-codex/gpt-5.6-terra-fast",
    body: { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }], reasoning: "high" },
    xaiAuthPath: authPath,
    upstreamFetch,
    transport: "sse",
  })) {
    frames.push(frame);
  }
  assert.ok(wireBody, `upstream fetch was not called: ${frames.join("")}`);
  assert.equal(wireBody.model, "gpt-5.6-terra");
  assert.deepEqual(wireBody.reasoning, { effort: "high", summary: "auto" });
  assert.equal(wireBody.service_tier, "priority");
});

// 위의 fxPromptToPiContext 테스트는 우리 변환까지만 본다. 여기는 pi-ai 직렬화까지 끌고 가서
// 실제 상류 요청 바디에 base64 가 있는지를 본다 — "우리가 넘겼다" 와
// "모델에게 닿는다" 는 다른 명제다. tools 를 꼭 준다 — 없으면 pi-ai 가
// tool call 을 <unavailable-tool-result> 로 바꾸면서 이미지를 [image] 로 지운다.
test("a read image reaches the codex wire as input_image", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fx-codex-image-"));
  const authPath = join(directory, "auth.json");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  writeFileSync(authPath, JSON.stringify({
    "openai-codex": { type: "oauth", access: `header.${payload}.signature`, refresh: "refresh", expires: Date.now() + 3_600_000 },
  }));
  let wireBody;
  const upstreamFetch = async (_url, init) => {
    const bytes = typeof init?.body === "string" ? Buffer.from(init.body) : Buffer.from(init?.body);
    const encoded = new Headers(init?.headers).get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes;
    wireBody = encoded.toString("utf8");
    return new Response([
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  for await (const _frame of directProviderToFxSse({
    model: "openai-codex/gpt-5.6-sol",
    body: {
      prompt: [
        { role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: "UUFB", mimeType: "image/png" }] },
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "a.png" } }] },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read",
            output: [{ type: "text", text: "Read image file" }, { type: "image", data: "UkVBRA", mimeType: "image/png" }],
          }],
        },
      ],
      tools: [{ name: "read", description: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
    },
    xaiAuthPath: authPath,
    upstreamFetch,
    transport: "sse",
  })) { /* drain */ }
  assert.ok(wireBody, "upstream fetch was not called");
  assert.match(wireBody, /data:image\/png;base64,UUFB/);
  assert.match(wireBody, /data:image\/png;base64,UkVBRA/);
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

// kiro 는 메시지 모양만 Anthropic 이고 상대는 AWS 다. 도구 이름을 Claude Code
// 규칙으로 바꾸면 나갈 때만 `Read` 가 되고 들어올 때는 안 돌아온다 — 역변환이
// anthropic 에만 걸려 있기 때문이다. 그러면 fx 가 `Read` 를 못 찾아 tool loop 이
// 끊긴다. 실제로 그렇게 깨졌고, 이 테스트가 그 비대칭을 지킨다.
test("kiro keeps fx tool names so the tool loop can match them on the way back", () => {
  const body = fixtureJson("fx-tool-request.json");
  // kiro 는 api 는 anthropic 이지만 naming 은 passthrough 로 넘긴다.
  const context = fxPromptToPiContext(body.prompt, body.tools, "anthropic", "claude-opus-5", "passthrough");
  assert.equal(context.tools[0].name, "read_file");
  assert.equal(context.messages[1].content[0].name, "read_file");
  assert.equal(context.messages[2].toolName, "read_file");
});

// 사용자가 Opus 에서 이미지를 못 본다고 한 자리다. tool-result 안의 이미지를
// 버리면 모델은 치수만 적힌 텍스트 메모만 받고 픽셀은 못 받는다.
for (const provider of ["anthropic", "xai"] as const) {
  test(`a read image reaches ${provider} instead of being dropped at the tool hop`, () => {
    const prompt = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "c1",
        toolName: "read",
        output: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", data: "SENTINEL456", mimeType: "image/png" },
        ],
      }],
    }];
    const context = fxPromptToPiContext(prompt, [], provider, "claude-opus-5");
    const content = context.messages[0].content;
    assert.deepEqual(content[1], { type: "image", data: "SENTINEL456", mimeType: "image/png" });
    // base64 가 텍스트로도 새면 컨텍스트를 두 번 먹는다.
    assert.ok(!content[0].text.includes("SENTINEL456"));
    assert.match(content[0].text, /Read image file/);
  });
}

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
