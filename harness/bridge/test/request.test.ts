import assert from "node:assert/strict";
import test from "node:test";
import { fxRequestToResponses } from "../src/fx-request.ts";
import { fixtureJson } from "./helpers.ts";

test("fx text request becomes Responses input", () => {
  const body = fixtureJson("fx-text-request.json");
  const request = fxRequestToResponses("xai/grok-4.6", body);
  assert.equal(request.model, "xai/grok-4.6");
  assert.equal(request.stream, true);
  assert.deepEqual(request.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "한 문장으로 pong이라고 답해" }],
    },
  ]);
  assert.equal(request.tool_choice, "auto");
});

test("fx session becomes the OpenCodex prompt cache key", () => {
  const body = fixtureJson("fx-text-request.json");
  const request = fxRequestToResponses("gpt-5.6-sol", body, "session-123");
  assert.equal(request.prompt_cache_key, "session-123");
});

test("fx tool history and schema survive conversion", () => {
  const body = fixtureJson("fx-tool-request.json");
  const request = fxRequestToResponses("openai/gpt-5.6-sol", body);
  assert.deepEqual(request.input[1], {
    type: "function_call",
    call_id: "call_1",
    name: "read_file",
    arguments: JSON.stringify({ path: "README.md" }),
  });
  assert.deepEqual(request.input[2], {
    type: "function_call_output",
    call_id: "call_1",
    output: "hello",
  });
  assert.deepEqual(request.tools, [
    {
      type: "function",
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ]);
  assert.deepEqual(request.reasoning, { effort: "high" });
});
