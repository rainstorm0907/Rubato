// 업스트림 provider 응답을 collector 가 이해하는 SSE 로 변환해 내려보낸다.
export function toSse(providerResponse) {
  const frames = [];
  const push = (o) => frames.push("data: " + JSON.stringify(o) + "\n\n");

  push({ type: "response-metadata", modelId: providerResponse.model });
  for (const chunk of providerResponse.chunks) {
    push({ type: "text-delta", id: "x0", delta: chunk });
  }
  push({
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: providerResponse.usage.input + providerResponse.usage.cacheRead,
        noCache: providerResponse.usage.input,
        cacheRead: providerResponse.usage.cacheRead,
      },
      outputTokens: { total: providerResponse.usage.output },
    },
  });
  return frames.join("");
}
