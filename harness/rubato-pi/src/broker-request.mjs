function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text ?? "";
      return "";
    })
    .join("");
}

function userContent(message) {
  if (typeof message.content === "string") {
    return message.content.length > 0 ? [{ type: "text", text: message.content }] : [];
  }
  if (!Array.isArray(message.content)) return [];
  const parts = [];
  for (const part of message.content) {
    if (typeof part === "string" && part) parts.push({ type: "text", text: part });
    else if (part?.type === "text" && part.text) parts.push({ type: "text", text: part.text });
    else if (part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      parts.push({ type: "image", data: part.data, mimeType: part.mimeType });
    }
  }
  return parts;
}

function assistantContent(message) {
  const parts = [];
  if (typeof message.content === "string") {
    if (message.content.length > 0) parts.push({ type: "text", text: message.content });
    return parts;
  }
  for (const part of message.content ?? []) {
    if (part?.type === "text" && part.text) parts.push({ type: "text", text: part.text });
    if (part?.type === "thinking" && (part.thinking || part.thinkingSignature)) {
      parts.push({
        type: "reasoning",
        text: part.thinking ?? "",
        ...(part.thinkingSignature ? { signature: part.thinkingSignature } : {}),
        ...(part.redacted ? { redacted: true } : {}),
      });
    }
    if (part?.type === "toolCall") {
      parts.push({
        type: "tool-call",
        toolCallId: part.id,
        toolName: part.name,
        input: part.arguments ?? {},
      });
    }
  }
  return parts;
}

function toolContent(message) {
  return [
    {
      type: "tool-result",
      toolCallId: message.toolCallId,
      toolName: message.toolName ?? "unknown",
      output: { type: "text", value: textOf(message.content) },
      isError: Boolean(message.isError),
    },
  ];
}

const SERVICE_TIERS = new Set(["priority"]);

export function streamOptionsToFxRequest(options = {}) {
  const extra = {};
  if (typeof options.reasoning === "string" && options.reasoning) extra.reasoning = options.reasoning;
  if (typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens)) {
    extra.maxOutputTokens = options.maxTokens;
  }
  if (typeof options.serviceTier === "string" && SERVICE_TIERS.has(options.serviceTier)) {
    extra.service_tier = options.serviceTier;
  }
  return extra;
}

export function contextToFxRequest(context) {
  const prompt = [];
  if (typeof context.systemPrompt === "string" && context.systemPrompt.length > 0) {
    prompt.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages ?? []) {
    if (message.role === "user") prompt.push({ role: "user", content: userContent(message) });
    if (message.role === "assistant") prompt.push({ role: "assistant", content: assistantContent(message) });
    if (message.role === "toolResult") prompt.push({ role: "tool", content: toolContent(message) });
  }
  const tools = (context.tools ?? []).map((tool) => ({
    type: tool.type ?? "function",
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.parameters ?? { type: "object", properties: {} },
  }));
  return {
    prompt,
    ...(tools.length > 0 ? { tools, toolChoice: { type: "auto" } } : {}),
  };
}
