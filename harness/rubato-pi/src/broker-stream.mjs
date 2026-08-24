import { pathToFileURL } from "node:url";
import { senpiNested } from "./engine-paths.mjs";

// pi-ai 는 senpi 가 자기 node_modules 에 품고 있다. bare import 로 쓰면 이 패키지
// 위쪽에 hoist 된 사본이 있어야만 풀리는데, 깨끗한 설치에는 그런 사본이 없다
// (있던 기기는 예전 npm install 의 잔재였다). senpi 옆에서 직접 찾는다.
const { createAssistantMessageEventStream } = await import(
  pathToFileURL(senpiNested("@earendil-works/pi-ai/dist/index.js")).href
);
import { brokerUrl, catalogId } from "./broker.mjs";
import { contextToFxRequest, streamOptionsToFxRequest } from "./broker-request.mjs";

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export function parseSseBlock(block) {
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  const raw = data.join("\n");
  if (raw === "[DONE]") return { type: "done" };
  return JSON.parse(raw);
}

function stopReason(finish) {
  const unified = typeof finish === "string" ? finish : finish?.unified;
  if (unified === "tool-calls") return "toolUse";
  if (unified === "length") return "length";
  if (unified === "error") return "error";
  return "stop";
}

function lastIndex(output, type) {
  for (let i = output.content.length - 1; i >= 0; i -= 1) {
    if (output.content[i].type === type) return i;
  }
  return -1;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function fxUsageToPi(usage = {}) {
  const nestedIn = usage.inputTokens && typeof usage.inputTokens === "object";
  const nestedOut = usage.outputTokens && typeof usage.outputTokens === "object";
  const input = nestedIn ? num(usage.inputTokens.noCache) : num(usage.input);
  const output = nestedOut ? num(usage.outputTokens.total) : num(usage.output);
  const cacheRead = nestedIn ? num(usage.inputTokens.cacheRead) : num(usage.cachedInputTokens ?? usage.cacheRead);
  const cacheWrite = nestedIn ? num(usage.inputTokens.cacheWrite) : num(usage.cacheWrite);
  const reasoning = nestedOut && typeof usage.outputTokens.reasoning === "number"
    ? usage.outputTokens.reasoning
    : (typeof usage.reasoning === "number" ? usage.reasoning : undefined);
  return {
    ...EMPTY_USAGE,
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { ...EMPTY_USAGE.cost },
  };
}

function toolIndex(output, id) {
  if (id) {
    const index = output.content.findIndex((part) => part.type === "toolCall" && part.id === id);
    if (index >= 0) return index;
  }
  return lastIndex(output, "toolCall");
}

export function hasToolCall(output) {
  return output.content.some((part) => part.type === "toolCall");
}

function parsePartialToolArgs(tool) {
  if (typeof tool.partialJson !== "string" || !tool.partialJson) return;
  if (tool.arguments && Object.keys(tool.arguments).length > 0) return;
  try {
    tool.arguments = JSON.parse(tool.partialJson);
  } catch {
    // Leave empty/partial args so the tool validator can reject them.
  }
}

/** Keep a tool-bearing turn alive so senpi executes the calls instead of ending on abort. */
export function settleBrokerOutput(output) {
  const tools = output.content.filter((part) => part.type === "toolCall");
  if (tools.length === 0) return false;
  for (const tool of tools) {
    parsePartialToolArgs(tool);
    delete tool.partialJson;
  }
  if (output.stopReason === "pending" || output.stopReason === "aborted" || output.stopReason === "error") {
    output.stopReason = "toolUse";
  }
  delete output.errorMessage;
  return true;
}

export function applyFxEvent(output, event) {
  if (!event?.type) return { events: [] };
  if (event.type === "text-start") {
    const contentIndex = output.content.length;
    output.content.push({ type: "text", text: "" });
    return { events: [{ type: "text_start", contentIndex, partial: output }] };
  }
  if (event.type === "text-delta") {
    const contentIndex = lastIndex(output, "text");
    if (contentIndex < 0) return { events: [] };
    output.content[contentIndex].text += event.delta ?? "";
    return { events: [{ type: "text_delta", contentIndex, delta: event.delta ?? "", partial: output }] };
  }
  if (event.type === "text-end") {
    const contentIndex = lastIndex(output, "text");
    return contentIndex < 0 ? { events: [] } : { events: [{ type: "text_end", contentIndex, content: output.content[contentIndex].text, partial: output }] };
  }
  if (event.type === "reasoning-start") {
    const contentIndex = output.content.length;
    output.content.push({ type: "thinking", thinking: "" });
    return { events: [{ type: "thinking_start", contentIndex, partial: output }] };
  }
  if (event.type === "reasoning-delta") {
    const contentIndex = lastIndex(output, "thinking");
    if (contentIndex < 0) return { events: [] };
    output.content[contentIndex].thinking += event.delta ?? "";
    return { events: [{ type: "thinking_delta", contentIndex, delta: event.delta ?? "", partial: output }] };
  }
  if (event.type === "reasoning-end") {
    const contentIndex = lastIndex(output, "thinking");
    return contentIndex < 0 ? { events: [] } : { events: [{ type: "thinking_end", contentIndex, content: output.content[contentIndex].thinking, partial: output }] };
  }
  if (event.type === "tool-input-start") {
    const contentIndex = output.content.length;
    output.content.push({
      type: "toolCall",
      id: event.id,
      name: event.toolName,
      arguments: {},
      partialJson: "",
    });
    return {
      events: [{
        type: "toolcall_start",
        contentIndex,
        partial: output,
        toolCall: output.content[contentIndex],
      }],
    };
  }
  if (event.type === "tool-input-delta") {
    const index = toolIndex(output, event.id);
    if (index < 0) return { events: [] };
    const block = output.content[index];
    if (block.type !== "toolCall") return { events: [] };
    if (typeof block.partialJson !== "string") block.partialJson = "";
    block.partialJson += event.delta ?? "";
    return { events: [{ type: "toolcall_delta", contentIndex: index, delta: event.delta ?? "", partial: output }] };
  }
  if (event.type === "tool-call") {
    let index = toolIndex(output, event.toolCallId);
    const events = [];
    if (index < 0) {
      index = output.content.length;
      output.content.push({
        type: "toolCall",
        id: event.toolCallId,
        name: event.toolName ?? "unknown",
        arguments: event.input ?? {},
      });
      events.push({
        type: "toolcall_start",
        contentIndex: index,
        partial: output,
        toolCall: output.content[index],
      });
    } else {
      delete output.content[index].partialJson;
      output.content[index].arguments = event.input ?? {};
    }
    events.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall: output.content[index],
      partial: output,
    });
    return { events };
  }
  if (event.type === "finish") {
    output.stopReason = stopReason(event.finishReason);
    if (event.usage) output.usage = fxUsageToPi(event.usage);
    if (output.stopReason === "error" || output.stopReason === "stop") settleBrokerOutput(output);
    return { events: [{ type: "done", reason: output.stopReason, message: output }] };
  }
  if (event.type === "error") {
    if (settleBrokerOutput(output)) {
      return { events: [{ type: "done", reason: output.stopReason, message: output }] };
    }
    output.stopReason = "error";
    output.errorMessage = event.message ?? "rubato broker error";
    return { events: [{ type: "error", reason: "error", error: output }] };
  }
  return { events: [] };
}

function emptyAssistant() {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "rubato-broker",
    model: "",
    usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

export function streamBroker(model, context, options = {}) {
  const stream = createAssistantMessageEventStream();
  const output = emptyAssistant();
  output.model = catalogId(model);
  output.provider = model.provider;
  ;(async () => {
    stream.push({ type: "start", partial: output });
    let settled = false;
    // 이미 화면에 나간 것이 있으면 같은 턴을 다시 보낼 수 없다 — 업스트림은 이미
    // 토큰을 태웠고, 재시도하면 같은 텍스트가 두 번 나온다.
    let emittedDelta = false;
    const emit = (event) => {
      if ((event.type === "done" || event.type === "error") && settled) return;
      if (event.type === "done" || event.type === "error") settled = true;
      else emittedDelta = true;
      stream.push(event);
    };
    try {
      const url = `${brokerUrl(options.env ?? process.env)}/v3/ai/language-model`;
      let body = { ...contextToFxRequest(context), ...streamOptionsToFxRequest(options) };
      // Senpi injects service_tier only through onPayload (service-tier.js → sdk.js).
      // The custom broker never goes through openai-codex-responses, so call the hook here.
      if (typeof options.onPayload === "function") {
        const next = await options.onPayload(body, model);
        if (next !== undefined) body = next;
      }
      const res = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          "ai-language-model-id": catalogId(model),
          ...(options.sessionId ? { "x-session-id": options.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`rubato broker ${res.status}: ${detail.slice(0, 400)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const event = parseSseBlock(block);
          if (!event || event.type === "done") continue;
          for (const next of applyFxEvent(output, event).events) emit(next);
        }
      }
      if (!settled) {
        if (!settleBrokerOutput(output) && output.stopReason === "pending") output.stopReason = "stop";
        emit({ type: "done", reason: output.stopReason, message: output });
      }
    } catch (error) {
      if (settled) return;
      // 사용자가 멈춘 턴만 도구 호출을 살려 넘긴다. 전송이 끊긴 것을 같이 살리면
      // 엔진이 성공한 턴으로 읽어 재시도도 폴백도 걸지 않고, 잘린 인자로 도구가
      // 그대로 실행된다.
      if (options.signal?.aborted && settleBrokerOutput(output)) {
        emit({ type: "done", reason: output.stopReason, message: output });
        return;
      }
      output.stopReason = options.signal?.aborted ? "aborted" : "error";
      const reason = error instanceof Error ? error.message : String(error);
      // 엔진은 이 접두사를 재시도 금지 신호로 읽는다(agent-session 의
      // TURN_RETRY_SUPPRESSION_PREFIX). 델타 전 실패만 안전하게 다시 보낸다.
      output.errorMessage = emittedDelta ? `senpi:no-turn-retry:${reason}` : reason;
      emit({ type: "error", reason: output.stopReason, error: output });
    } finally {
      stream.end();
    }
  })();
  return stream;
}
