import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  type AntigravitySession,
  buildAntigravityRequest,
  fxPromptToGeminiContents,
  nextAntigravityEnvelope,
  peekAntigravitySession,
  resetAntigravitySessions,
  resolveAntigravityWireModel,
} from "../src/antigravity.ts";
import { isDirectModel } from "../src/direct-provider.ts";
import { startBridge } from "../src/server.ts";
import { collectFxEvents, isolatedAdminEnv } from "./helpers.ts";

test("Antigravity catalog ids take the direct route", () => {
  assert.equal(isDirectModel("google-antigravity/gemini-3.7-flash"), true);
  assert.equal(isDirectModel("google-antigravity/gemini-3.1-pro"), true);
});

test("reasoning maps to the Cloud Code Assist wire model", () => {
  assert.equal(resolveAntigravityWireModel("gemini-3.7-flash"), "gemini-3.7-flash-low");
  assert.equal(resolveAntigravityWireModel("gemini-3.7-flash", "high"), "gemini-3.7-flash-high");
  assert.equal(resolveAntigravityWireModel("gemini-3.1-pro", "high"), "gemini-pro-agent");
});

test("the next envelope echoes last_execution_id after the first turn", () => {
  const session: AntigravitySession = {
    sessionId: "111",
    agentId: "agent",
    trajectoryId: "traj",
    stepIndex: 1,
  };
  const first = nextAntigravityEnvelope(session, 1);
  assert.equal(first.labels.last_execution_id, undefined);
  assert.equal(first.labels.last_step_index, "1");
  assert.equal(first.requestId, "agent/agent/1/traj/2");
  session.lastExecutionId = "resp-1";
  const second = nextAntigravityEnvelope(session, 2);
  assert.equal(second.labels.last_execution_id, "resp-1");
  assert.equal(second.labels.last_step_index, "2");
  assert.equal(second.requestId, "agent/agent/2/traj/3");
});

test("fx history becomes Gemini contents including thinking signatures", () => {
  const converted = fxPromptToGeminiContents([
    { role: "system", content: [{ type: "text", text: "be brief" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "think", signature: "sig-1" },
        { type: "text", text: "hello" },
      ],
    },
    { role: "user", content: [{ type: "text", text: "again" }] },
  ]);
  assert.equal(converted.system, "be brief");
  assert.deepEqual(converted.contents, [
    { role: "user", parts: [{ text: "hi" }] },
    {
      role: "model",
      parts: [
        { text: "think", thought: true, thoughtSignature: "sig-1" },
        { text: "hello" },
      ],
    },
    { role: "user", parts: [{ text: "again" }] },
  ]);
});

// 이미지는 두 길로 들어온다: 붙여넣기는 user 메시지, read 도구는 tool-result.
// 예전에는 textOf 가 .text 없는 파트를 버려서 바이트가 상류에 아예 안 닿았다.
const SENTINEL = "iVBORw0KGgoAAAANSUhEUg==";

test("a pasted image survives as inline base64 instead of being dropped", () => {
  const converted = fxPromptToGeminiContents([
    {
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "image", data: SENTINEL, mimeType: "image/png" },
      ],
    },
  ]);
  assert.deepEqual(converted.contents, [
    {
      role: "user",
      parts: [
        { text: "what is this" },
        { inlineData: { mimeType: "image/png", data: SENTINEL } },
      ],
    },
  ]);
});

test("a data URL image loses only its prefix", () => {
  const converted = fxPromptToGeminiContents([
    { role: "user", content: [{ type: "image", data: `data:image/webp;base64,${SENTINEL}`, mimeType: "image/webp" }] },
  ]);
  assert.deepEqual(converted.contents[0].parts, [{ inlineData: { mimeType: "image/webp", data: SENTINEL } }]);
});

test("a read-tool image rides along as inlineData and stays out of the text output", () => {
  const converted = fxPromptToGeminiContents([
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "read",
        toolCallId: "call-1",
        output: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", data: SENTINEL, mimeType: "image/png" },
        ],
      }],
    },
  ]);
  const [response, image] = converted.contents;
  assert.equal(response.parts[0].functionResponse?.name, "read");
  // base64 가 functionResponse 본문으로 새면 컨텍스트를 통째로 먹는다.
  assert.ok(!JSON.stringify(response.parts[0].functionResponse?.response).includes(SENTINEL));
  assert.deepEqual(image.parts, [{ inlineData: { mimeType: "image/png", data: SENTINEL } }]);
});

test("the sentinel image reaches the upstream request body", () => {
  const body = buildAntigravityRequest({
    projectId: "proj",
    wireModel: "gemini-3.1-pro-low",
    prompt: [{ role: "user", content: [{ type: "image", data: SENTINEL, mimeType: "image/png" }] }],
    session: { sessionId: "111", agentId: "agent", trajectoryId: "traj", stepIndex: 1 },
    now: 10,
  });
  // 브리지가 실제로 올려보내는 JSON 안에 바이트가 있어야 모델이 본다.
  assert.ok(JSON.stringify(body).includes(SENTINEL), "image bytes never reached the upstream body");
});

test("the request body carries the Antigravity agent envelope", () => {
  const session = {
    sessionId: "111",
    agentId: "agent",
    trajectoryId: "traj",
    stepIndex: 1,
    lastExecutionId: "resp-9",
  };
  const body = buildAntigravityRequest({
    projectId: "proj",
    wireModel: "gemini-3.7-flash-low",
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    session,
    now: 10,
  });
  assert.equal(body.project, "proj");
  assert.equal(body.model, "gemini-3.7-flash-low");
  assert.equal(body.requestType, "agent");
  assert.equal(body.requestId, "agent/agent/10/traj/2");
  assert.equal((body.request as { sessionId: string }).sessionId, "111");
  assert.equal((body.request as { labels: { last_execution_id: string } }).labels.last_execution_id, "resp-9");
});

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function bridgePort(bridge: ReturnType<typeof startBridge>): Promise<number> {
  return await new Promise((resolve) => {
    const check = () => {
      const address = bridge.address();
      if (address && typeof address !== "string") resolve(address.port);
      else setTimeout(check, 10);
    };
    check();
  });
}

test("the same fx session sends last_execution_id on the second turn", async () => {
  resetAntigravitySessions();
  const seen: Array<{ lastExecutionId?: string; sessionId?: string }> = [];
  const upstream = createServer(async (req, res) => {
    if (req.url?.includes("loadCodeAssist")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cloudaicompanionProject: "proj" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const body = JSON.parse(raw);
    seen.push({
      lastExecutionId: body.request?.labels?.last_execution_id,
      sessionId: body.request?.sessionId,
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({
      response: {
        responseId: `resp-${seen.length}`,
        candidates: [{ content: { parts: [{ text: `ok${seen.length}` }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
      },
    })}\n\n`);
  });
  const upstreamPort = await listen(upstream);
  const bridge = startBridge(isolatedAdminEnv({
    FX_BRIDGE_BIND: "127.0.0.1",
    FX_BRIDGE_PORT: "0",
    FX_ANTIGRAVITY_ENDPOINT: `http://127.0.0.1:${upstreamPort}`,
    FX_ANTIGRAVITY_ACCESS: "test-access",
    FX_ANTIGRAVITY_PROJECT: "proj",
  }));
  const port = await bridgePort(bridge);
  const post = async (text: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ai-language-model-id": "google-antigravity/gemini-3.7-flash",
        "x-session-id": "fx-ag-1",
      },
      body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text }] }] }),
    });
    const frames = (await response.text()).split("\n\n").filter(Boolean).map((block) => `${block}\n\n`);
    return collectFxEvents(frames);
  };
  const first = await post("one");
  const second = await post("two");
  assert.equal(first.find((event) => event.type === "text-delta")?.delta, "ok1");
  assert.equal(second.find((event) => event.type === "text-delta")?.delta, "ok2");
  assert.equal(seen[0].lastExecutionId, undefined);
  assert.equal(seen[1].lastExecutionId, "resp-1");
  assert.equal(seen[0].sessionId, seen[1].sessionId);
  assert.equal(peekAntigravitySession("fx-ag-1")?.lastExecutionId, "resp-2");
  await new Promise((resolve) => bridge.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});
