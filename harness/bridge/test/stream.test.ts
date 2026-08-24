import assert from "node:assert/strict";
import test from "node:test";
import { responsesSseToFxSse } from "../src/fx-stream.ts";
import { collectFxEvents, fixture, sseToStream } from "./helpers.ts";

async function convert(name: string) {
  const frames: string[] = [];
  for await (const frame of responsesSseToFxSse(sseToStream(fixture(name)))) {
    frames.push(frame);
  }
  return collectFxEvents(frames);
}

test("OpenCodex text SSE becomes fx text-delta + finish", async () => {
  const events = await convert("opencodex-text.sse");
  assert.equal(events[0].type, "response-metadata");
  assert.equal(events[0].modelId, "xai/grok-4.6");
  assert.equal(events.find((event) => event.type === "text-delta")?.delta, "pong");
  const finish = events.find((event) => event.type === "finish");
  assert.equal(finish.finishReason.unified, "stop");
  assert.equal(finish.usage.inputTokens.total, 10);
  assert.match(events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(finish.providerMetadata.gateway.generationId, /^gen_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(finish.providerMetadata.gateway.routing.canonicalSlug, "xai/grok-4.6");
  assert.equal(events.at(-1).type, "[DONE]");
});

test("OpenCodex cache usage is visible to fx", async () => {
  const source = sseToStream(`event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":13876,"input_tokens_details":{"cached_tokens":13056,"cache_write_tokens":0},"output_tokens":6}}}\n\ndata: [DONE]\n\n`);
  const frames: string[] = [];
  for await (const frame of responsesSseToFxSse(source)) frames.push(frame);
  const finish = collectFxEvents(frames).find((event) => event.type === "finish");
  assert.deepEqual(finish.usage.inputTokens, {
    total: 13876,
    noCache: 820,
    cacheRead: 13056,
    cacheWrite: 0,
  });
});

test("OpenCodex missing usage stays unavailable instead of becoming zero", async () => {
  const source = sseToStream(`event: response.completed\ndata: {"type":"response.completed","response":{"model":"xai/grok-4.6"}}\n\ndata: [DONE]\n\n`);
  const frames: string[] = [];
  for await (const frame of responsesSseToFxSse(source)) frames.push(frame);
  const finish = collectFxEvents(frames).find((event) => event.type === "finish");
  assert.equal(Object.hasOwn(finish, "usage"), false);
});

test("OpenCodex provider-reported zero usage remains measured zero", async () => {
  const source = sseToStream(`event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":0,"input_tokens_details":{"cached_tokens":0,"cache_write_tokens":0},"output_tokens":0}}}\n\ndata: [DONE]\n\n`);
  const frames: string[] = [];
  for await (const frame of responsesSseToFxSse(source)) frames.push(frame);
  const finish = collectFxEvents(frames).find((event) => event.type === "finish");
  assert.deepEqual(finish.usage, {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0 },
  });
});

test("OpenCodex reasoning SSE stays out of text", async () => {
  const events = await convert("opencodex-reasoning.sse");
  assert.equal(events.find((event) => event.type === "reasoning-delta")?.delta, "think");
  assert.equal(events.find((event) => event.type === "text-delta")?.delta, "pong");
  assert.equal(events.find((event) => event.type === "finish")?.usage.outputTokens.reasoning, 3);
});

test("OpenCodex tool-call SSE becomes fx tool-input then tool-call", async () => {
  const events = await convert("opencodex-tool.sse");
  assert.equal(events.find((event) => event.type === "tool-input-start")?.toolName, "read_file");
  assert.equal(events.filter((event) => event.type === "tool-input-delta").map((event) => event.delta).join(""), "{\"path\":\"README.md\"}");
  const toolCall = events.find((event) => event.type === "tool-call");
  assert.equal(toolCall.toolCallId, "call_1");
  assert.deepEqual(toolCall.input, { path: "README.md" });
});

test("a completion carrying tool calls finishes as tool-calls, not stop", async () => {
  const events = await convert("opencodex-tool.sse");
  const finish = events.find((event) => event.type === "finish");
  // fx drops the whole completion as invalid_tool_finish when tool calls arrive with a stop reason.
  assert.equal(finish.finishReason.unified, "tool-calls");
});

test("a text-only completion still finishes as stop", async () => {
  const events = await convert("opencodex-text.sse");
  const finish = events.find((event) => event.type === "finish");
  assert.equal(finish.finishReason.unified, "stop");
});

test("OpenCodex failure becomes fx error then finish error", async () => {
  const events = await convert("opencodex-error.sse");
  const error = events.find((event) => event.type === "error");
  assert.equal(error.code, "provider_down");
  assert.equal(error.message, "wafer route unavailable");
  assert.equal(events.find((event) => event.type === "finish")?.finishReason.unified, "error");
});

test("OpenCodex finish still bills when created metadata is missing", async () => {
  const source = sseToStream(`event: response.completed
data: {"type":"response.completed","response":{"model":"openai/gpt-5.6-sol","usage":{"input_tokens":4,"output_tokens":1}}}

data: [DONE]

`);
  const frames: string[] = [];
  for await (const frame of responsesSseToFxSse(source)) frames.push(frame);
  const events = collectFxEvents(frames);
  const meta = events.find((event) => event.type === "response-metadata");
  const finish = events.find((event) => event.type === "finish");
  assert.equal(meta.modelId, "openai/gpt-5.6-sol");
  assert.match(meta.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(finish.providerMetadata.gateway.generationId, /^gen_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(finish.providerMetadata.gateway.routing.canonicalSlug, "openai/gpt-5.6-sol");
  assert.equal(finish.usage.inputTokens.cacheRead, 0);
});
