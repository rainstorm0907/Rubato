import test from "node:test";
import assert from "node:assert/strict";
import brokerOverlay, {
  brokerProviders,
  builtinProviderIds,
  foreignProviderIds,
} from "../../src/extensions/broker-overlay.mjs";
import { buildSenpiArgs, brokerOverlayPath, leadOverlayPath } from "../../src/launch.mjs";
import {
  brokerUrl,
  catalogId,
  ensureBroker,
  FALLBACK_CATALOG,
  groupCatalog,
  startBroker,
} from "../../src/broker.mjs";
import { contextToFxRequest, streamOptionsToFxRequest } from "../../src/broker-request.mjs";
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
  assert.deepEqual(Object.keys(grouped).sort(), ["anthropic", "openai", "xai"]);
  assert.ok(grouped.anthropic.some((model) => model.id === "claude-opus-5"));
  assert.ok(grouped.anthropic.every((model) => model.cacheRetention === "long"));
  assert.equal(grouped.xai[0].cacheRetention, undefined);
  assert.equal(grouped.anthropic.find((model) => model.id === "claude-opus-5").contextWindow, 1_000_000);
  assert.equal(grouped.xai[0].contextWindow, 500_000);
  assert.equal(grouped.openai.find((model) => model.id === "gpt-5.6-sol").contextWindow, 400_000);
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
    isUp: () => ++checks >= 3,
    start: () => ({ pid: 7, status: null }),
    sleep: () => {},
  });
  assert.equal(got.started, true);
  assert.ok(checks >= 3);
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
    "../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/tool-call-middleware/recovery-stream-wrapper.js"
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
  for (const kept of ["anthropic", "openai", "xai"]) {
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

  assert.deepEqual([...registered].sort(), ["anthropic", "openai", "xai"]);
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
  assert.equal(registered.length, 3);
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
