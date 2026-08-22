export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type FxGatewayRequest = {
  prompt?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  maxOutputTokens?: unknown;
  reasoning?: unknown;
  [key: string]: unknown;
};

export type ResponsesRequest = {
  model: string;
  stream: true;
  input: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_output_tokens?: number;
  reasoning?: { effort: string };
  prompt_cache_key?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    const type = asString(part.type);
    if (type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (type === "output_text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("");
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (isObject(output) && output.type === "text" && typeof output.value === "string") return output.value;
  if (isObject(output) && typeof output.value === "string") return output.value;
  try {
    return JSON.stringify(output ?? "");
  } catch {
    return String(output ?? "");
  }
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

function mapToolChoice(toolChoice: unknown): unknown {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (!isObject(toolChoice)) return undefined;
  const type = asString(toolChoice.type);
  if (type === "auto" || type === "none" || type === "required") return type;
  if (type === "tool" && typeof toolChoice.toolName === "string") {
    return { type: "function", name: toolChoice.toolName };
  }
  if (type === "function" && typeof toolChoice.name === "string") {
    return { type: "function", name: toolChoice.name };
  }
  return undefined;
}

function mapTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const mapped = [];
  for (const tool of tools) {
    if (!isObject(tool)) continue;
    const type = asString(tool.type) ?? "function";
    if (type !== "function") continue;
    const name = asString(tool.name);
    if (!name) continue;
    const parameters = isObject(tool.inputSchema)
      ? tool.inputSchema
      : isObject(tool.parameters)
        ? tool.parameters
        : { type: "object", properties: {} };
    mapped.push({
      type: "function",
      name,
      description: asString(tool.description) ?? "",
      parameters,
    });
  }
  return mapped;
}

function mapPrompt(prompt: unknown): unknown[] {
  const items: unknown[] = [];
  const messages = Array.isArray(prompt) ? prompt : [];
  for (const message of messages) {
    if (!isObject(message)) continue;
    const role = asString(message.role);
    const content = message.content;

    if (role === "system") {
      items.push({
        type: "message",
        role: "system",
        content: textFromContent(content),
      });
      continue;
    }

    if (role === "user") {
      const text = textFromContent(content);
      items.push({
        type: "message",
        role: "user",
        content: text ? [{ type: "input_text", text }] : [{ type: "input_text", text: "" }],
      });
      continue;
    }

    if (role === "assistant") {
      const parts = Array.isArray(content) ? content : [];
      const texts: string[] = [];
      for (const part of parts) {
        if (!isObject(part)) continue;
        const type = asString(part.type);
        if ((type === "text" || type === "output_text") && typeof part.text === "string" && part.text) {
          texts.push(part.text);
          continue;
        }
        if (type === "tool-call") {
          if (texts.length > 0) {
            items.push({
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: texts.join("") }],
            });
            texts.length = 0;
          }
          const callId = asString(part.toolCallId) ?? "";
          const name = asString(part.toolName) ?? "unknown";
          items.push({
            type: "function_call",
            call_id: callId,
            name,
            arguments: stringifyToolInput(part.input),
          });
        }
      }
      if (texts.length > 0) {
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: texts.join("") }],
        });
      } else if (parts.length === 0) {
        const fallback = textFromContent(content);
        if (fallback) {
          items.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: fallback }],
          });
        }
      }
      continue;
    }

    if (role === "tool") {
      const parts = Array.isArray(content) ? content : [];
      for (const part of parts) {
        if (!isObject(part) || asString(part.type) !== "tool-result") continue;
        items.push({
          type: "function_call_output",
          call_id: asString(part.toolCallId) ?? "",
          output: stringifyToolOutput(part.output),
        });
      }
    }
  }
  return items;
}

export function fxRequestToResponses(model: string, body: FxGatewayRequest, sessionId?: string): ResponsesRequest {
  if (!model) throw new Error("missing ai-language-model-id");
  const request: ResponsesRequest = {
    model,
    stream: true,
    input: mapPrompt(body.prompt),
  };
  const tools = mapTools(body.tools);
  if (tools && tools.length > 0) request.tools = tools;
  const toolChoice = mapToolChoice(body.toolChoice);
  if (toolChoice !== undefined) request.tool_choice = toolChoice;
  if (typeof body.maxOutputTokens === "number" && Number.isFinite(body.maxOutputTokens)) {
    request.max_output_tokens = body.maxOutputTokens;
  }
  if (typeof body.reasoning === "string" && body.reasoning) {
    request.reasoning = { effort: body.reasoning };
  }
  if (sessionId) request.prompt_cache_key = sessionId;
  return request;
}
