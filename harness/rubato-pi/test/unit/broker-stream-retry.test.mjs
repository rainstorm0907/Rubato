// 브리지가 죽었을 때 엔진이 그 턴을 어떻게 읽는지 정한다.
//
// 엔진(agent-session)은 errorMessage 로 재시도 여부를 판단한다. 없으면 성공한
// 턴이고, "senpi:no-turn-retry:" 로 시작하면 재시도 금지다. 예전에는 toolCall 이
// 하나라도 있으면 전송이 끊겨도 errorMessage 를 지우고 toolUse 로 넘겨서,
// 엔진이 성공으로 읽고 잘린 인자로 도구를 실행했다.
import assert from "node:assert/strict";
import test from "node:test";
import { streamBroker } from "../../src/broker-stream.mjs";

const model = { provider: "rubato-broker", id: "test-model" };
const context = { messages: [] };

/** SSE 한 블록. */
function block(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * 주어진 블록들을 흘린 뒤 끊기는 응답.
 * 한 번에 enqueue 하고 error 를 부르면 큐에 남은 청크가 버려지므로,
 * pull 로 하나씩 건네고 다 나간 뒤에 끊는다.
 */
function brokenFetch(blocks) {
  return async () => {
    let index = 0;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({
        pull(controller) {
          if (index < blocks.length) {
            controller.enqueue(new TextEncoder().encode(blocks[index++]));
            return;
          }
          controller.error(new TypeError("terminated"));
        },
      }),
    };
  };
}

/** 스트림을 끝까지 읽어 마지막 이벤트를 돌려준다. */
async function drain(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("델타 전에 끊기면 재시도 가능한 에러로 끝난다", async () => {
  const events = await drain(streamBroker(model, context, { fetch: brokenFetch([]) }));
  const last = events.at(-1);
  assert.equal(last.type, "error");
  assert.equal(last.error.stopReason, "error");
  assert.match(last.error.errorMessage, /terminated/);
  assert.ok(!last.error.errorMessage.startsWith("senpi:no-turn-retry:"));
});

test("델타를 보낸 뒤 끊기면 재시도를 막는다", async () => {
  const stream = streamBroker(model, context, {
    fetch: brokenFetch([
      block({ type: "text-start" }),
      block({ type: "text-delta", delta: "안녕" }),
    ]),
  });
  const last = (await drain(stream)).at(-1);
  assert.equal(last.type, "error");
  assert.ok(
    last.error.errorMessage.startsWith("senpi:no-turn-retry:"),
    `재시도 금지 접두사가 없다: ${last.error.errorMessage}`,
  );
});

test("model.end is recorded before the terminal stream event", async () => {
  const order = [];
  const measurementRecorder = {
    activeTaskId: () => "session:1",
    startCall: () => ({ callId: "model-1" }),
    firstOutput: () => {},
    observeToolReinsertion: () => {},
    endCall: (_callId, fields) => order.push({ type: "model.end", fields }),
  };
  const fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(block({ type: "finish", finishReason: { unified: "stop" }, usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1 } } })));
        controller.close();
      },
    }),
  });
  for await (const event of streamBroker(model, context, { fetch, sessionId: "session", measurementRecorder })) {
    if (event.type === "done") order.push({ type: "stream.done" });
  }
  assert.deepEqual(order.map((event) => event.type), ["model.end", "stream.done"]);
  assert.equal(order[0].fields.usage.outputTokens, 1);
});

test("ttft starts at the first content delta, not an empty frame opener", async () => {
  const times = [100, 350, 600];
  const monotonic = () => times.shift();
  const fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(block({ type: "text-start" })));
        controller.enqueue(new TextEncoder().encode(block({ type: "text-delta", delta: "hi" })));
        controller.enqueue(new TextEncoder().encode(block({ type: "finish", finishReason: { unified: "stop" } })));
        controller.close();
      },
    }),
  });
  // measurementRecorder is not passed and RUBATO_MEASUREMENT_LOG is unset in this process,
  // so measurementRecorder(options.env) resolves to undefined — timing must not depend on it.
  let last;
  for await (const event of streamBroker(model, context, {
    fetch,
    env: {},
    monotonic,
    wallNow: () => 1_700_000_000_000,
    processStartedAt: 1234,
  })) last = event;
  assert.equal(last.type, "done");
  assert.deepEqual(last.message.timing, {
    sentAt: 1_700_000_000_000,
    processStartedAt: 1234,
    ttftMs: 250,
    modelDurationMs: 500,
  });
});

test("a call with no emitted delta (pure tool call) still gets a turn duration but no ttft", async () => {
  const fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(block({ type: "finish", finishReason: { unified: "stop" } })));
        controller.close();
      },
    }),
  });
  let last;
  for await (const event of streamBroker(model, context, { fetch, env: {} })) last = event;
  const timing = last.message.timing;
  assert.equal(timing.ttftMs, undefined);
  assert.equal(typeof timing.modelDurationMs, "number");
});

test("measurement recorder failures never change model stream lifecycle", async () => {
  const measurementRecorder = {
    activeTaskId: () => "session:1",
    startCall: () => { throw new Error("measurement disk failed"); },
  };
  const fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(block({ type: "finish", finishReason: { unified: "stop" } })));
        controller.close();
      },
    }),
  });
  const events = await drain(streamBroker(model, context, { fetch, sessionId: "session", measurementRecorder }));
  assert.equal(events.at(-1).type, "done");
});

test("measurement recorder construction failure degrades to recording off", async () => {
  let fetched = false;
  const fetch = async () => {
    fetched = true;
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(block({ type: "finish", finishReason: { unified: "stop" } })));
          controller.close();
        },
      }),
    };
  };
  const events = await drain(streamBroker(model, context, {
    fetch,
    env: { RUBATO_MEASUREMENT_LOG: "/dev/null/unwritable.jsonl" },
  }));
  assert.equal(fetched, true);
  assert.equal(events.at(-1).type, "done");
});

test("failed attempts do not carry display timing", async () => {
  const last = (await drain(streamBroker(model, context, { fetch: brokenFetch([]), env: {} }))).at(-1);
  assert.equal(last.type, "error");
  assert.equal(last.error.timing, undefined);
});

test("도구 호출이 있어도 전송이 끊기면 성공으로 넘기지 않는다", async () => {
  const stream = streamBroker(model, context, {
    fetch: brokenFetch([
      block({ type: "toolCall-start", toolCallId: "t1", toolName: "ls" }),
      block({ type: "toolCall-delta", toolCallId: "t1", delta: '{"path":"/tm' }),
    ]),
  });
  const last = (await drain(stream)).at(-1);
  assert.equal(last.type, "error", "toolCall 이 있다고 done 으로 넘어가면 안 된다");
  assert.ok(last.error.errorMessage, "errorMessage 가 지워지면 엔진이 성공으로 읽는다");
});
