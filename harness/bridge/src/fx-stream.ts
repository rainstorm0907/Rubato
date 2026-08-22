import { emptyFxUsage, gatewayProviderMetadata, gatewayTimestamp, newGatewayGenerationId } from "./fx-generation.ts";
import { encodeSseData, encodeSseDone, iterateSse } from "./sse.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function eventType(event: { event?: string; data: string }, parsed: unknown): string {
  if (event.event) return event.event;
  if (isObject(parsed) && typeof parsed.type === "string") return parsed.type;
  return "";
}

function parseJson(data: string): unknown {
  if (data === "[DONE]") return { type: "[DONE]" };
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function tokenTotal(value: unknown): { total: number } | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return { total: value };
}

function usageFromResponses(response: JsonObject | undefined): JsonObject | undefined {
  const usage = response && isObject(response.usage) ? response.usage : undefined;
  if (!usage) return undefined;
  const input = tokenTotal(usage.input_tokens);
  const output = tokenTotal(usage.output_tokens);
  const inputDetails = isObject(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const cacheRead = typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens : 0;
  const cacheWrite = typeof inputDetails?.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0;
  const mapped: JsonObject = {};
  if (input) mapped.inputTokens = {
    total: input.total,
    noCache: Math.max(0, input.total - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
  };
  if (output) {
    const details = isObject(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
    mapped.outputTokens = details && typeof details.reasoning_tokens === "number"
      ? { total: output.total, reasoning: details.reasoning_tokens }
      : output;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function finishEvent(unified: string, raw: string, response: JsonObject | undefined, generation: { id: string; modelId: string }): JsonObject {
  const event: JsonObject = {
    type: "finish",
    finishReason: { unified, raw },
    usage: usageFromResponses(response) ?? emptyFxUsage(),
    providerMetadata: gatewayProviderMetadata({
      generationId: generation.id,
      modelId: generation.modelId,
      usage: isObject(response?.usage) ? response.usage : undefined,
    }),
  };
  return event;
}

function errorEvent(message: string, code = "provider_error"): JsonObject {
  return {
    type: "error",
    code,
    message,
    error: { type: code, message },
  };
}

function parseToolInput(argumentsText: string): unknown {
  if (!argumentsText) return {};
  try {
    return JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
}

function itemFromAdded(parsed: JsonObject): JsonObject | undefined {
  return isObject(parsed.item) ? parsed.item : undefined;
}

export async function* responsesSseToFxSse(
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const tools = new Map<string, { callId: string; name: string; arguments: string; started: boolean }>();
  let textId: string | undefined;
  let reasoningId: string | undefined;
  let finished = false;
  let sawToolCall = false;
  const generationId = newGatewayGenerationId();
  let modelId = "unknown";
  let metadataSent = false;
  const generation = () => ({ id: generationId, modelId });
  const providerMetadata = () => gatewayProviderMetadata({ generationId, modelId });
  const rememberModel = (response?: JsonObject) => {
    const resolved = asString(response?.model);
    if (resolved && !metadataSent) modelId = resolved;
  };
  const emitMetadata = (): string[] => {
    if (metadataSent) return [];
    metadataSent = true;
    return [encodeSseData({ type: "response-metadata", modelId, timestamp: gatewayTimestamp() })];
  };

  const startText = (id: string) => {
    if (textId) return [];
    textId = id;
    return [encodeSseData({ type: "text-start", id, providerMetadata: providerMetadata() })];
  };
  const endText = () => {
    if (!textId) return [];
    const id = textId;
    textId = undefined;
    return [encodeSseData({ type: "text-end", id })];
  };
  const startReasoning = (id: string) => {
    if (reasoningId) return [];
    reasoningId = id;
    return [encodeSseData({ type: "reasoning-start", id })];
  };
  const endReasoning = () => {
    if (!reasoningId) return [];
    const id = reasoningId;
    reasoningId = undefined;
    return [encodeSseData({ type: "reasoning-end", id })];
  };

  const closeOpenTools = (): string[] => {
    const frames: string[] = [];
    for (const [itemId, tool] of tools) {
      if (!tool.started) {
        frames.push(encodeSseData({
          type: "tool-input-start",
          id: tool.callId,
          toolName: tool.name,
        }));
        tool.started = true;
      }
      frames.push(encodeSseData({ type: "tool-input-end", id: tool.callId }));
      frames.push(encodeSseData({
        type: "tool-call",
        toolCallId: tool.callId,
        toolName: tool.name,
        input: parseToolInput(tool.arguments),
        providerMetadata: providerMetadata(),
      }));
      sawToolCall = true;
      tools.delete(itemId);
    }
    return frames;
  };

  const finish = (event: JsonObject): string[] => {
    if (finished) return [];
    finished = true;
    // closeOpenTools can emit the final tool-call, so settle the finish reason after it runs.
    const trailing = [...emitMetadata(), ...endReasoning(), ...endText(), ...closeOpenTools()];
    return [
      ...trailing,
      encodeSseData(withToolCallFinish(event)),
      encodeSseDone(),
    ];
  };

  // fx rejects a completion that carries tool calls unless the unified finish reason says so.
  const withToolCallFinish = (event: JsonObject): JsonObject => {
    if (!sawToolCall) return event;
    const reason = isObject(event.finishReason) ? event.finishReason : undefined;
    if (!reason || asString(reason.unified) !== "stop") return event;
    return { ...event, finishReason: { ...reason, unified: "tool-calls" } };
  };

  for await (const event of iterateSse(source, signal)) {
    if (finished) return;
    const parsed = parseJson(event.data);
    const type = eventType(event, parsed);
    if (type === "[DONE]" || event.data === "[DONE]") {
      if (!finished) {
        for (const frame of finish(finishEvent("stop", "stop", undefined, generation()))) yield frame;
      }
      return;
    }
    if (!isObject(parsed)) continue;

    if (type === "response.created" || type === "response.in_progress") {
      const response = isObject(parsed.response) ? parsed.response : parsed;
      rememberModel(response);
      if (asString(response.model)) {
        for (const frame of emitMetadata()) yield frame;
      }
      continue;
    }

    if (type === "response.output_item.added") {
      const item = itemFromAdded(parsed);
      if (!item) continue;
      const itemType = asString(item.type);
      const itemId = asString(item.id) ?? "";
      if (itemType === "message") {
        for (const frame of startText(itemId || "txt")) yield frame;
      } else if (itemType === "reasoning") {
        for (const frame of startReasoning(itemId || "rs")) yield frame;
      } else if (itemType === "function_call") {
        const callId = asString(item.call_id) ?? itemId;
        const name = asString(item.name) ?? "unknown";
        tools.set(itemId || callId, { callId, name, arguments: "", started: false });
        yield encodeSseData({ type: "tool-input-start", id: callId, toolName: name });
        tools.get(itemId || callId)!.started = true;
      }
      continue;
    }

    if (type === "response.output_text.delta") {
      const delta = asString(parsed.delta);
      if (!delta) continue;
      const id = asString(parsed.item_id) ?? textId ?? "txt";
      for (const frame of startText(id)) yield frame;
      yield encodeSseData({ type: "text-delta", id, delta });
      continue;
    }

    if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
      const delta = asString(parsed.delta);
      if (!delta) continue;
      const id = asString(parsed.item_id) ?? reasoningId ?? "rs";
      for (const frame of startReasoning(id)) yield frame;
      yield encodeSseData({ type: "reasoning-delta", id, delta });
      continue;
    }

    if (type === "response.function_call_arguments.delta") {
      const itemId = asString(parsed.item_id) ?? "";
      const delta = asString(parsed.delta) ?? "";
      let tool = tools.get(itemId);
      if (!tool) {
        const callId = itemId || "call";
        tool = { callId, name: "unknown", arguments: "", started: false };
        tools.set(itemId || callId, tool);
      }
      if (!tool.started) {
        yield encodeSseData({ type: "tool-input-start", id: tool.callId, toolName: tool.name });
        tool.started = true;
      }
      tool.arguments += delta;
      if (delta) yield encodeSseData({ type: "tool-input-delta", id: tool.callId, delta });
      continue;
    }

    if (type === "response.function_call_arguments.done" || type === "response.output_item.done") {
      const item = isObject(parsed.item) ? parsed.item : undefined;
      const itemId = asString(parsed.item_id) ?? asString(item?.id) ?? "";
      const tool = tools.get(itemId);
      if (tool) {
        if (item && asString(item.arguments)) tool.arguments = asString(item.arguments)!;
        if (!tool.started) {
          yield encodeSseData({ type: "tool-input-start", id: tool.callId, toolName: tool.name });
          tool.started = true;
        }
        yield encodeSseData({ type: "tool-input-end", id: tool.callId });
        const input = parseToolInput(tool.arguments);
        yield encodeSseData({
          type: "tool-call",
          toolCallId: tool.callId,
          toolName: tool.name,
          input,
          providerMetadata: providerMetadata(),
        });
        sawToolCall = true;
        tools.delete(itemId);
      } else if (item && asString(item.type) === "message") {
        for (const frame of endText()) yield frame;
      } else if (item && asString(item.type) === "reasoning") {
        for (const frame of endReasoning()) yield frame;
      }
      continue;
    }

    if (type === "response.completed") {
      const response = isObject(parsed.response) ? parsed.response : undefined;
      rememberModel(response);
      for (const frame of finish(finishEvent("stop", "completed", response, generation()))) yield frame;
      return;
    }

    if (type === "response.incomplete") {
      const response = isObject(parsed.response) ? parsed.response : undefined;
      rememberModel(response);
      const reason = isObject(response?.incomplete_details) ? asString(response.incomplete_details.reason) : undefined;
      const unified = reason === "max_output_tokens" ? "length" : "other";
      for (const frame of finish(finishEvent(unified, reason ?? "incomplete", response, generation()))) yield frame;
      return;
    }

    if (type === "response.failed") {
      const response = isObject(parsed.response) ? parsed.response : undefined;
      rememberModel(response);
      const err = isObject(response?.error) ? response.error : isObject(parsed.error) ? parsed.error : {};
      const message = asString(err.message) ?? "upstream failed";
      const code = asString(err.code) ?? asString(err.type) ?? "provider_error";
      yield encodeSseData(errorEvent(message, code));
      for (const frame of finish(finishEvent("error", "failed", response, generation()))) yield frame;
      return;
    }
  }

  if (!finished) {
    for (const frame of finish(finishEvent("other", "adapter_eof", undefined, generation()))) yield frame;
  }
}
