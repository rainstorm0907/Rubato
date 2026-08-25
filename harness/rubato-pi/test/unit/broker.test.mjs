import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import brokerOverlay, {
  brokerProviders,
  builtinProviderIds,
  foreignProviderIds,
} from "../../src/extensions/broker-overlay.mjs";
import { buildSenpiArgs, brokerOverlayPath, leadOverlayPath } from "../../src/launch.mjs";
import {
  brokerUrl,
  bridgeSourceMtimeMs,
  catalogId,
  ensureBroker,
  FALLBACK_CATALOG,
  groupCatalog,
  probeBridge,
  restartBroker,
  startBroker,
} from "../../src/broker.mjs";
import { contextToFxRequest, streamOptionsToFxRequest } from "../../src/broker-request.mjs";
import { senpiNested } from "../../src/engine-paths.mjs";
import { applyFxEvent, fxUsageToPi, parseSseBlock, settleBrokerOutput, streamBroker } from "../../src/broker-stream.mjs";

async function nextOrTimeout(iter, ms, label) {
  let timer;
  try {
    return await Promise.race([
      iter.next(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("broker url stays on the rubato loopback relay", () => {
  assert.equal(brokerUrl({}), "http://127.0.0.1:8788");
  assert.equal(brokerUrl({ RUBATO_BROKER_URL: "http://127.0.0.1:9999" }), "http://127.0.0.1:9999");
});

test("catalog ids keep provider prefixes the broker understands", () => {
  assert.equal(catalogId({ provider: "anthropic", id: "claude-opus-5" }), "anthropic/claude-opus-5");
  const grouped = groupCatalog(FALLBACK_CATALOG);
  assert.deepEqual(Object.keys(grouped).sort(), ["anthropic", "openai-codex", "xai"]);
  assert.ok(grouped.anthropic.some((model) => model.id === "claude-opus-5"));
  assert.ok(grouped.anthropic.every((model) => model.cacheRetention === "long"));
  assert.equal(grouped.xai[0].cacheRetention, undefined);
  assert.equal(grouped.anthropic.find((model) => model.id === "claude-opus-5").contextWindow, 1_000_000);
  assert.equal(grouped.xai[0].contextWindow, 500_000);
  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.equal(grouped["openai-codex"].find((model) => model.id === id).contextWindow, 272_000);
  }
});

test("5.6 context limits apply to both live broker routes", () => {
  const entries = ["sol", "terra", "luna"].flatMap((variant) => [
    { id: `openai/gpt-5.6-${variant}` },
    { id: `openai-codex/gpt-5.6-${variant}` },
  ]);
  const grouped = groupCatalog(entries);
  for (const provider of ["openai", "openai-codex"]) {
    assert.ok(grouped[provider].every((model) => model.contextWindow === 272_000));
  }
});

test("catalog models keep the image modality so read does not drop attachments", () => {
  // read 도구는 model.input 에 "image" 가 없으면 이미지를 조용히 버린다.
  // 예전에 groupCatalog 가 전부 ["text"] 로 깎아서 경로로 넘긴 PNG 가 모델에 안 닿았다.
  const grouped = groupCatalog(FALLBACK_CATALOG);
  for (const models of Object.values(grouped)) {
    for (const model of models) {
      assert.ok(model.input.includes("image"), `${model.id} lost the image modality`);
    }
  }
});

test("an unknown model falls back to text instead of claiming vision", () => {
  const grouped = groupCatalog([{ id: "rubato/not-a-real-model", name: "Nope" }]);
  assert.deepEqual(grouped.rubato[0].input, ["text"]);
});

// 앞 테스트는 FALLBACK_CATALOG 만 돌아서 Antigravity 를 구조적으로 비켜갔다.
// 그래서 모달리티가 깎인 채 초록으로 나갔다 — 라이브 카탈로그에만 있는 id 로 막는다.
test("antigravity gemini keeps vision even though pi-ai does not know the prefix", () => {
  const grouped = groupCatalog([
    { id: "google-antigravity/gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "google-antigravity/gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  ]);
  for (const model of grouped["google-antigravity"]) {
    assert.ok(model.input.includes("image"), `${model.id} lost the image modality`);
  }
});

test("ensureBroker starts the existing relay only when it is down", () => {
  const started = [];
  let up = false;
  const first = ensureBroker({
    env: {},
    isUp: () => up,
    start: () => {
      started.push("start");
      up = true;
      return { status: 0 };
    },
  });
  assert.equal(first.started, true);
  assert.equal(started.length, 1);
  const second = ensureBroker({ env: {}, isUp: () => true, start: () => started.push("again") });
  assert.equal(second.started, false);
  assert.equal(started.length, 1);
});

test("ensureBroker restarts a stale relay only while it is idle", () => {
  let restarted = 0;
  let fresh = false;
  const got = ensureBroker({
    env: {},
    isUp: () => ({ up: true, fresh, inflight: 0 }),
    restart: () => {
      restarted++;
      fresh = true;
      return { status: 0 };
    },
    sleep: () => {},
  });
  assert.equal(got.started, true);
  assert.equal(restarted, 1);
});

test("a stale relay with a model call in flight is left alone", () => {
  // 살아 있는 브리지를 코드가 낡았다는 이유로 죽이면, 붙어 있던 다른 세션의
  // 턴이 소켓 끊김으로 끝난다. 낡은 채로 한 턴 더 도는 쪽이 낫다.
  const warnings = [];
  let restarted = 0;
  const got = ensureBroker({
    env: {},
    isUp: () => ({ up: true, fresh: false, inflight: 2 }),
    restart: () => {
      restarted++;
      return { status: 0 };
    },
    sleep: () => {},
    warn: (message) => warnings.push(message),
  });
  assert.equal(restarted, 0);
  assert.equal(got.ok, true);
  assert.equal(got.started, false);
  assert.equal(got.stale, true);
  assert.match(warnings.join(""), /rubato restart/);
});

test("a relay that does not report in-flight calls is left alone too", () => {
  // 우리 것보다 낡은 브리지는 inflight 를 안 실어 보낸다. 그건 "0 이다" 가
  // 아니라 "모른다" 이고, 모르는 것은 죽이지 않는다.
  let restarted = 0;
  const got = ensureBroker({
    env: {},
    isUp: () => ({ up: true, fresh: false }),
    restart: () => {
      restarted++;
      return { status: 0 };
    },
    sleep: () => {},
    warn: () => {},
  });
  assert.equal(restarted, 0);
  assert.equal(got.stale, true);
});

test("one slow health probe does not count as a dead bridge", () => {
  // 브리지가 여러 세션의 SSE 로 바쁘면 한 번쯤 늦게 답한다. 그 한 번으로
  // 새 브리지를 띄우면 포트 싸움이 나고, 사람 손에서는 kill 로 이어진다.
  let probes = 0;
  let started = 0;
  const got = ensureBroker({
    env: {},
    isUp: () => (++probes === 1 ? { up: false, fresh: false } : { up: true, fresh: true, inflight: 1 }),
    start: () => {
      started++;
      return { status: 0 };
    },
    sleep: () => {},
  });
  assert.equal(started, 0);
  assert.equal(got.started, false);
  assert.ok(probes >= 2, "a single failed probe must not decide");
});

test("probeBridge bounds the health check and reads the in-flight count", () => {
  // -m 이 없으면 브리지가 답을 못 주는 동안 세션 시작이 영영 멈춘다.
  const calls = [];
  const state = probeBridge("http://127.0.0.1:8788", {
    sourceMtime: () => 1000,
    spawnSyncImpl: (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: JSON.stringify({ ok: true, startedAt: 2000, inflight: 3 }) };
    },
  });
  assert.equal(calls[0].cmd, "curl");
  assert.ok(calls[0].args.includes("-m"), `health probe has no timeout: ${calls[0].args.join(" ")}`);
  assert.deepEqual(state, { up: true, fresh: true, inflight: 3 });

  const stale = probeBridge("http://127.0.0.1:8788", {
    sourceMtime: () => 5000,
    spawnSyncImpl: () => ({ status: 0, stdout: JSON.stringify({ startedAt: 2000, inflight: 0 }) }),
  });
  assert.deepEqual(stale, { up: true, fresh: false, inflight: 0 });

  const down = probeBridge("http://127.0.0.1:8788", {
    sourceMtime: () => 0,
    spawnSyncImpl: () => ({ status: 7, stdout: "" }),
  });
  assert.deepEqual(down, { up: false, fresh: false, inflight: null });
});

test("bridge freshness watches every source file, not a hand-kept list", () => {
  // 목록을 손으로 관리하면 새 파일이 빠진다. 실제로 `upstream-dispatcher.ts` 가
  // 빠져서 브리지를 고치고도 새 세션이 낡은 프로세스에 붙었다. 어느 파일을
  // 건드려도 시각이 올라가야 한다.
  const bridgeDir = fileURLToPath(new URL("../../../bridge/src/", import.meta.url));
  const sources = readdirSync(bridgeDir).filter((name) => name.endsWith(".ts"));
  assert.ok(sources.length > 5, `expected several bridge sources, saw ${sources.length}`);

  const baseline = bridgeSourceMtimeMs();
  for (const name of sources) {
    const path = join(bridgeDir, name);
    const original = statSync(path);
    const bumped = new Date(baseline + 60_000);
    utimesSync(path, bumped, bumped);
    try {
      assert.ok(
        bridgeSourceMtimeMs() > baseline,
        `touching ${name} must make the bridge look stale`,
      );
    } finally {
      utimesSync(path, original.atime, original.mtime);
    }
  }
});

test("bridge freshness source exists and restart targets the narrow script", () => {
  assert.ok(bridgeSourceMtimeMs() > 0);
  const calls = [];
  restartBroker({
    env: {},
    spawnSyncImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    },
  });
  assert.equal(calls[0].cmd, "sh");
  assert.match(calls[0].args[0], /rubato-restart\.sh$/);
});

test("startBroker detaches the relay instead of blocking the TUI on it", () => {
  const calls = [];
  const child = {
    pid: 123,
    unrefed: false,
    unref() {
      child.unrefed = true;
    },
  };
  const result = startBroker({
    env: { TMPDIR: "/tmp", FX_CACHE_RETENTION: "long" },
    spawn: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return child;
    },
  });
  assert.equal(result, child);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "bash");
  assert.equal(calls[0].opts.detached, true);
  assert.notEqual(calls[0].opts.stdio, "inherit");
  assert.equal(child.unrefed, true);
});

test("ensureBroker treats a still-running detached relay as starting, not failed", () => {
  let checks = 0;
  const got = ensureBroker({
    env: {},
    // down 판정은 여러 번 확인한 뒤에 내려진다. 그 확인이 끝난 다음에 뜨는 경우다.
    isUp: () => ++checks > 3,
    start: () => ({ pid: 7, status: null }),
    sleep: () => {},
  });
  assert.equal(got.started, true);
  assert.ok(checks >= 3);
});

// read 로 열은 이미지는 toolResult 로 온다. 예전에는 textOf 가 다 지워서
// 모델이 "열었는데 내용을 못 읽겠다" 고 말했다 — 모든 프로바이더 공통.
test("a read image survives the toolResult hop instead of being flattened to text", () => {
  const body = contextToFxRequest({
    messages: [
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", data: "SENTINEL456", mimeType: "image/png" },
        ],
      },
    ],
  });
  const output = body.prompt[0].content[0].output;
  assert.ok(Array.isArray(output), "an image tool-result must keep its parts");
  assert.deepEqual(output[1], { type: "image", data: "SENTINEL456", mimeType: "image/png" });
});

test("a text-only tool result keeps the old single-value shape", () => {
  const body = contextToFxRequest({
    messages: [{ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "done" }] }],
  });
  assert.deepEqual(body.prompt[0].content[0].output, { type: "text", value: "done" });
});

test("senpi context becomes an fx gateway body, not a Senpi OAuth payload", () => {
  const body = contextToFxRequest({
    systemPrompt: "role prompt",
    messages: [
      { role: "user", content: "hi", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file" }],
        isError: false,
        timestamp: 2,
      },
    ],
    tools: [{ name: "read", description: "read a file", parameters: { type: "object" } }],
  });
  assert.equal(body.prompt[0].role, "system");
  assert.equal(body.prompt[1].role, "user");
  assert.equal(body.prompt[2].content[1].type, "tool-call");
  assert.equal(body.prompt[3].role, "tool");
  assert.deepEqual(body.prompt[3].content[0], {
    type: "tool-result",
    toolCallId: "c1",
    toolName: "read",
    output: { type: "text", value: "file" },
    isError: false,
  });
  assert.equal(body.prompt[3].content[0].result, undefined);
  assert.equal(body.tools[0].name, "read");
  assert.doesNotMatch(JSON.stringify(body), /refresh_token|authorization_code/);
});

test("tool results use fx output so Claude does not see empty quotes", () => {
  const body = contextToFxRequest({
    messages: [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "echo hello" } }],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "hello" }],
        isError: false,
        timestamp: 1,
      },
    ],
  });
  const part = body.prompt.find((message) => message.role === "tool").content[0];
  assert.equal(part.result, undefined);
  assert.deepEqual(part.output, { type: "text", value: "hello" });
  assert.equal(part.toolName, "bash");
});

test("fx SSE text and tool-call frames become senpi stream events", () => {
  assert.deepEqual(parseSseBlock("event: text-delta\ndata: {\"type\":\"text-delta\",\"delta\":\"hi\"}\n"), {
    type: "text-delta",
    delta: "hi",
  });
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  const start = applyFxEvent(output, { type: "text-start", id: "t1" });
  assert.equal(start.events[0].type, "text_start");
  const delta = applyFxEvent(output, { type: "text-delta", id: "t1", delta: "hi" });
  assert.equal(delta.events[0].type, "text_delta");
  applyFxEvent(output, { type: "tool-input-start", id: "c1", toolName: "read" });
  const call = applyFxEvent(output, {
    type: "tool-call",
    toolCallId: "c1",
    toolName: "read",
    input: { path: "a" },
  });
  assert.equal(call.events.at(-1).type, "toolcall_end");
  const done = applyFxEvent(output, { type: "finish", finishReason: { unified: "tool-calls" } });
  assert.equal(output.stopReason, "toolUse");
  assert.equal(done.events[0].type, "done");
});

test("streamBroker posts the fx v3 path with the catalog model id", async () => {
  const seen = [];
  const sse = [
    "data: {\"type\":\"text-start\",\"id\":\"t1\"}\n\n",
    "data: {\"type\":\"text-delta\",\"id\":\"t1\",\"delta\":\"ok\"}\n\n",
    "data: {\"type\":\"finish\",\"finishReason\":{\"unified\":\"stop\"}}\n\n",
    "data: [DONE]\n\n",
  ].join("");
  const stream = streamBroker(
    { provider: "anthropic", id: "claude-opus-5" },
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    {
      env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" },
      fetch: async (url, init) => {
        seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return {
          ok: true,
          body: {
            getReader() {
              const encoded = new TextEncoder().encode(sse);
              let sent = false;
              return {
                async read() {
                  if (sent) return { done: true, value: undefined };
                  sent = true;
                  return { done: false, value: encoded };
                },
              };
            },
          },
        };
      },
    },
  );
  const events = [];
  for await (const event of stream) events.push(event.type);
  assert.equal(seen[0].url, "http://127.0.0.1:8788/v3/ai/language-model");
  assert.equal(seen[0].headers["ai-language-model-id"], "anthropic/claude-opus-5");
  assert.ok(events.includes("text_delta"));
  assert.ok(events.includes("done"));
});

test("broker abort errors carry the assistant message, not a bare string", () => {
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  const { events } = applyFxEvent(output, { type: "error", message: "boom" });
  assert.equal(events[0].type, "error");
  assert.equal(events[0].reason, "error");
  assert.equal(events[0].error, output);
  assert.ok(Array.isArray(events[0].error.content));
});

test("aborting a broker turn does not crash invoke recovery", async () => {
  const { wrapStreamWithInvokeRecovery } = await import(
    senpiNested("@earendil-works/pi-ai/dist/tool-call-middleware/recovery-stream-wrapper.js")
  );
  const rejections = [];
  const onReject = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onReject);
  const controller = new AbortController();
  const stream = wrapStreamWithInvokeRecovery(
    streamBroker(
      { provider: "anthropic", id: "claude-opus-5" },
      { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
      {
        env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" },
        signal: controller.signal,
        fetch: async (_url, init) => {
          await new Promise((_, reject) => {
            const fail = () => {
              const error = new Error("This operation was aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (init.signal?.aborted) fail();
            else init.signal.addEventListener("abort", fail, { once: true });
          });
        },
      },
    ),
    [],
  );
  try {
    const iter = stream[Symbol.asyncIterator]();
    const first = await nextOrTimeout(iter, 1000, "waiting for start");
    assert.equal(first.value?.type, "start");
    controller.abort();
    const rest = [];
    while (true) {
      const step = await nextOrTimeout(iter, 1000, "waiting for abort terminal");
      if (step.done) break;
      rest.push(step.value);
      if (step.value.type === "error" || step.value.type === "done") break;
    }
    assert.equal(rejections.length, 0, String(rejections[0]));
    const terminal = rest.at(-1);
    assert.equal(terminal?.type, "error");
    assert.equal(terminal.reason, "aborted");
    assert.ok(Array.isArray(terminal.error.content));
  } finally {
    process.off("unhandledRejection", onReject);
  }
});

test("fx usage objects become senpi numbers instead of [object Object]", () => {
  const usage = fxUsageToPi({
    inputTokens: { total: 160, noCache: 100, cacheRead: 50, cacheWrite: 10 },
    outputTokens: { total: 20, reasoning: 5 },
  });
  assert.equal(usage.input, 100);
  assert.equal(usage.output, 20);
  assert.equal(usage.cacheRead, 50);
  assert.equal(usage.cacheWrite, 10);
  assert.equal(usage.reasoning, 5);
  assert.equal(usage.totalTokens, 180);
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  applyFxEvent(output, { type: "finish", finishReason: { unified: "stop" }, usage: {
    inputTokens: { total: 160, noCache: 100, cacheRead: 50, cacheWrite: 10 },
    outputTokens: { total: 20, reasoning: 5 },
  } });
  assert.equal(typeof output.usage.input, "number");
  assert.equal(output.usage.totalTokens, 180);
});

test("tool-input-delta becomes a senpi toolcall_delta", () => {
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  applyFxEvent(output, { type: "tool-input-start", id: "c1", toolName: "bash" });
  const delta = applyFxEvent(output, { type: "tool-input-delta", id: "c1", delta: '{"command":' });
  assert.equal(delta.events[0].type, "toolcall_delta");
  assert.equal(output.content[0].partialJson, '{"command":');
  applyFxEvent(output, { type: "tool-call", toolCallId: "c1", input: { command: "echo" } });
  assert.equal(output.content[0].partialJson, undefined);
  assert.deepEqual(output.content[0].arguments, { command: "echo" });
});

test("thinking signatures and user images survive the fx request body", () => {
  const body = contextToFxRequest({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan", thinkingSignature: "sig-1", redacted: false },
          { type: "text", text: "ok" },
        ],
      },
    ],
  });
  assert.deepEqual(body.prompt[0].content, [
    { type: "text", text: "see" },
    { type: "image", data: "abc", mimeType: "image/png" },
  ]);
  assert.deepEqual(body.prompt[1].content[0], { type: "reasoning", text: "plan", signature: "sig-1" });
});

test("stream options carry thinking level and max tokens to the broker", () => {
  assert.deepEqual(streamOptionsToFxRequest({ reasoning: "high", maxTokens: 2048 }), {
    reasoning: "high",
    maxOutputTokens: 2048,
  });
});

test("stream options copy only the priority Codex tier onto the fx body", () => {
  assert.deepEqual(streamOptionsToFxRequest({ serviceTier: "priority" }), { service_tier: "priority" });
  assert.deepEqual(streamOptionsToFxRequest({ serviceTier: "auto" }), {});
  assert.deepEqual(streamOptionsToFxRequest({ serviceTier: "flex" }), {});
  assert.deepEqual(streamOptionsToFxRequest({}), {});
});

test("streamBroker posts reasoning and maxOutputTokens", async () => {
  let body;
  const sse = [
    "data: {\"type\":\"text-start\",\"id\":\"t1\"}\n\n",
    "data: {\"type\":\"text-delta\",\"id\":\"t1\",\"delta\":\"ok\"}\n\n",
    "data: {\"type\":\"finish\",\"finishReason\":{\"unified\":\"stop\"}}\n\n",
  ].join("");
  const stream = streamBroker(
    { provider: "anthropic", id: "claude-opus-5" },
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    {
      env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" },
      reasoning: "high",
      maxTokens: 1024,
      fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          body: {
            getReader() {
              const encoded = new TextEncoder().encode(sse);
              let sent = false;
              return {
                async read() {
                  if (sent) return { done: true, value: undefined };
                  sent = true;
                  return { done: false, value: encoded };
                },
              };
            },
          },
        };
      },
    },
  );
  for await (const _event of stream) {
    /* drain */
  }
  assert.equal(body.reasoning, "high");
  assert.equal(body.maxOutputTokens, 1024);
});

test("broker providers have no Senpi OAuth config", () => {
  for (const provider of brokerProviders()) {
    assert.ok(provider.auth.apiKey);
    assert.equal(provider.auth.oauth.loginLabel, "Use the rubato broker");
    assert.equal(typeof provider.streamSimple, "function");
  }
});

test("openai-codex catalog models advertise the Responses API that /fast requires", () => {
  const models = brokerProviders()
    .flatMap((provider) => provider.getModels());
  const codex = models.filter((model) => model.provider === "openai-codex");
  assert.ok(codex.length > 0);
  for (const model of codex) {
    assert.equal(model.api, "openai-codex-responses", `${model.id} must expose openai-codex-responses`);
  }
  const grok = models.find((model) => model.id === "grok-4.6");
  assert.equal(grok.api, "openai-completions");
});

test("streamBroker posts a service_tier injected by onPayload", async () => {
  let body;
  const sse = [
    "data: {\"type\":\"text-start\",\"id\":\"t1\"}\n\n",
    "data: {\"type\":\"text-delta\",\"id\":\"t1\",\"delta\":\"ok\"}\n\n",
    "data: {\"type\":\"finish\",\"finishReason\":{\"unified\":\"stop\"}}\n\n",
  ].join("");
  const stream = streamBroker(
    { provider: "openai-codex", id: "gpt-5.6-luna", api: "openai-codex-responses" },
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    {
      env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" },
      onPayload: (payload) => ({ ...payload, service_tier: "priority" }),
      fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          body: {
            getReader() {
              const encoded = new TextEncoder().encode(sse);
              let sent = false;
              return {
                async read() {
                  if (sent) return { done: true, value: undefined };
                  sent = true;
                  return { done: false, value: encoded };
                },
              };
            },
          },
        };
      },
    },
  );
  for await (const _event of stream) {
    /* drain */
  }
  assert.equal(body.service_tier, "priority");
});

test("broker grok-4.6 keeps the vendor xhigh map so Shift+Tab can reach it", () => {
  const grok = brokerProviders()
    .flatMap((provider) => provider.getModels())
    .find((model) => model.id === "grok-4.6");
  assert.ok(grok);
  assert.equal(grok.thinkingLevelMap.xhigh, "xhigh");
  assert.equal(grok.thinkingLevelMap.max, null);
});

test("direct-vendor lanes the broker does not serve are dropped from the model picker", () => {
  const builtin = builtinProviderIds();
  assert.ok(builtin.includes("vercel-ai-gateway"));
  assert.ok(builtin.includes("alibaba-token-plan"));

  const foreign = foreignProviderIds(builtin);
  assert.ok(foreign.includes("vercel-ai-gateway"));
  assert.ok(foreign.includes("alibaba-token-plan"));
  for (const kept of ["anthropic", "openai-codex", "xai"]) {
    assert.ok(!foreign.includes(kept), `${kept} is served by the broker and must stay`);
  }
});

test("the overlay registers broker providers and unregisters every foreign one", async () => {
  const registered = [];
  const unregistered = [];
  await brokerOverlay({
    registerProvider: (provider) => registered.push(provider.id),
    unregisterProvider: (name) => unregistered.push(name),
  });

  // 카탈로그는 브리지에서 온다. OpenCodex 가 떠 있으면 "openai" 레인이 얹히고 아니면
  // 없다 — 그래서 정확한 개수로 잠그지 않는다. 우리가 반드시 무는 셋만 검사한다.
  // (openai-codex 는 Codex 를 OpenCodex 없이 직접 무는 자리다.)
  for (const required of ["anthropic", "openai-codex", "xai"]) {
    assert.ok(registered.includes(required), `${required} must be registered`);
  }
  assert.ok(unregistered.includes("vercel-ai-gateway"));
  for (const kept of registered) {
    assert.ok(!unregistered.includes(kept), `${kept} was registered then dropped`);
  }
});

test("a host that refuses to unregister does not break the overlay", async () => {
  const registered = [];
  await brokerOverlay({
    registerProvider: (provider) => registered.push(provider.id),
    unregisterProvider: () => {
      throw new Error("unsupported");
    },
  });
  assert.ok(registered.length >= 3, `expected at least 3 providers, got ${registered.length}`);
});

test("launcher loads the broker overlay after the lead overlay", () => {
  const args = buildSenpiArgs(["--mode", "rpc"]);
  const leadAt = args.indexOf(leadOverlayPath());
  const brokerAt = args.indexOf(brokerOverlayPath());
  assert.ok(leadAt > 0 && brokerAt > leadAt);
  assert.equal(args[brokerAt - 1], "-e");
});

test("a lone tool-call still becomes a senpi tool", () => {
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  const result = applyFxEvent(output, {
    type: "tool-call",
    toolCallId: "c1",
    toolName: "eval",
    input: { language: "py", summary: "x", code: "1" },
  });
  assert.equal(result.events[0].type, "toolcall_start");
  assert.equal(result.events.at(-1).type, "toolcall_end");
  assert.equal(output.content[0].name, "eval");
});

test("an error after tool calls settles as toolUse, not a dead turn", () => {
  const output = {
    role: "assistant",
    content: [],
    stopReason: "pending",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  };
  applyFxEvent(output, { type: "tool-input-start", id: "c1", toolName: "bash" });
  applyFxEvent(output, { type: "tool-call", toolCallId: "c1", toolName: "bash", input: { command: "pwd" } });
  const result = applyFxEvent(output, { type: "error", message: "Operation aborted" });
  assert.equal(result.events[0].type, "done");
  assert.equal(output.stopReason, "toolUse");
  assert.equal(output.errorMessage, undefined);
});

test("partial tool JSON is salvaged so the validator can reject it", () => {
  const output = {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "c1",
      name: "eval",
      arguments: {},
      partialJson: "{\"language\":\"py\"}",
    }],
    stopReason: "pending",
  };
  assert.equal(settleBrokerOutput(output), true);
  assert.deepEqual(output.content[0].arguments, { language: "py" });
  assert.equal(output.stopReason, "toolUse");
});

function abortAfter(sse) {
  let reads = 0;
  const controller = new AbortController();
  return {
    controller,
    fetch: async () => ({
      ok: true,
      body: {
        getReader() {
          const encoded = new TextEncoder().encode(sse);
          return {
            async read() {
              reads += 1;
              if (reads === 1) return { done: false, value: encoded };
              controller.abort();
              const error = new Error("This operation was aborted");
              error.name = "AbortError";
              throw error;
            },
          };
        },
      },
    }),
  };
}

test("a broker stream with tool calls survives a teardown abort", async () => {
  const sse = [
    "data: {\"type\":\"tool-input-start\",\"id\":\"c1\",\"toolName\":\"eval\"}\n\n",
    "data: {\"type\":\"tool-call\",\"toolCallId\":\"c1\",\"toolName\":\"eval\",\"input\":{\"language\":\"py\",\"summary\":\"x\",\"code\":\"1\"}}\n\n",
  ].join("");
  const { controller, fetch } = abortAfter(sse);
  const stream = streamBroker(
    { provider: "xai", id: "grok-4.6" },
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" }, signal: controller.signal, fetch },
  );
  const events = [];
  for await (const event of stream) events.push(event);
  const done = events.find((event) => event.type === "done");
  assert.equal(done?.reason, "toolUse");
  assert.equal(done.message.stopReason, "toolUse");
  assert.equal(done.message.errorMessage, undefined);
  assert.equal(done.message.content[0].name, "eval");
  assert.ok(!events.some((event) => event.type === "error"));
});

test("finish is not overwritten when the socket aborts afterwards", async () => {
  const sse = [
    "data: {\"type\":\"tool-input-start\",\"id\":\"c1\",\"toolName\":\"bash\"}\n\n",
    "data: {\"type\":\"tool-call\",\"toolCallId\":\"c1\",\"toolName\":\"bash\",\"input\":{\"command\":\"pwd\"}}\n\n",
    "data: {\"type\":\"finish\",\"finishReason\":{\"unified\":\"tool-calls\"}}\n\n",
  ].join("");
  const { controller, fetch } = abortAfter(sse);
  const stream = streamBroker(
    { provider: "xai", id: "grok-4.6" },
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    { env: { RUBATO_BROKER_URL: "http://127.0.0.1:8788" }, signal: controller.signal, fetch },
  );
  const events = [];
  for await (const event of stream) events.push(event);
  const done = events.find((event) => event.type === "done");
  assert.equal(done?.message.stopReason, "toolUse");
  assert.equal(done.message.errorMessage, undefined);
});
