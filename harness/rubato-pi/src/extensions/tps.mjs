// 턴 끝 알림줄. senpi 기본 tps 확장을 대체한다.
//
// 기본판은 `TPS 54.4 tok/s. Cache hit 0.0%, 10.5s` 까지만 그린다. 그 10.5초 안에
// '기다린 시간'과 '생각한 시간'이 섞여 있어, 느린 턴이 왜 느렸는지 알 수 없다.
// rubato-stream 이 성공한 호출마다 `output.timing` 을 붙이므로 여기서 그 두 구간을
// 턴 평균으로 덧붙인다: `…, 10.5s, delay 1.2s, think 4.0s`.
//
// 숫자 계산은 상태줄과 같은 statusline.mjs 헬퍼(turnTiming/formatLatencyMs)를 쓴다.
// 같은 턴을 두 곳이 다르게 말하는 일이 없어야 하므로 산수는 한 벌만 둔다.
import { formatLatencyMs, turnTiming } from "../statusline.mjs";
import { PROCESS_STARTED_AT } from "../process-start.mjs";

function isAssistantMessage(message) {
  return Boolean(message) && typeof message === "object" && message.role === "assistant";
}

/** `delay 1.2s, think 4.0s`. 사고가 없던 턴은 think 를 아예 빼 `think 0ms` 거짓말을 막는다. */
export function formatNoticeLatency(timing) {
  const delay = formatLatencyMs(timing?.waitMs ?? timing?.ttftMs);
  if (!delay) return "";
  const think = timing?.thinkMs ? formatLatencyMs(timing.thinkMs) : "";
  return think ? `delay ${delay}, think ${think}` : `delay ${delay}`;
}

export function formatTpsNotice({ tokensPerSecond, cacheHitRate, elapsedSeconds, timing }) {
  const head =
    `TPS ${tokensPerSecond.toFixed(1)} tok/s. Cache hit ${cacheHitRate.toFixed(1)}%, ${elapsedSeconds.toFixed(1)}s`;
  const latency = formatNoticeLatency(timing);
  return latency ? `${head}, ${latency}` : head;
}

export function turnTokensPerSecond(timing, output, elapsedSeconds) {
  return timing?.tokensPerSecond ?? output / elapsedSeconds;
}

export function installTps(pi, { processStartedAt = PROCESS_STARTED_AT } = {}) {
  let activeAssistantStartMs = null;
  let assistantElapsedMs = 0;

  const finishActiveAssistantTiming = () => {
    if (activeAssistantStartMs === null) return;
    // 단조 시계를 쓴다. message_start 와 message_end 사이에 벽시계가 뒤로 튀어도
    // (NTP 보정 등) 유효한 턴의 알림이 사라지면 안 된다.
    const elapsedMs = performance.now() - activeAssistantStartMs;
    if (elapsedMs > 0) assistantElapsedMs += elapsedMs;
    activeAssistantStartMs = null;
  };

  pi.on("agent_start", () => {
    activeAssistantStartMs = null;
    assistantElapsedMs = 0;
  });

  pi.on("message_start", (event) => {
    if (!isAssistantMessage(event.message)) return;
    finishActiveAssistantTiming();
    activeAssistantStartMs = performance.now();
  });

  pi.on("message_end", (event) => {
    if (!isAssistantMessage(event.message)) return;
    finishActiveAssistantTiming();
  });

  pi.on("agent_end", (event, ctx) => {
    finishActiveAssistantTiming();

    const elapsedMs = assistantElapsedMs;
    activeAssistantStartMs = null;
    assistantElapsedMs = 0;

    if (!ctx.hasUI) return;
    if (elapsedMs <= 0) return;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    for (const message of event.messages) {
      if (!isAssistantMessage(message)) continue;
      input += message.usage?.input ?? 0;
      output += message.usage?.output ?? 0;
      cacheRead += message.usage?.cacheRead ?? 0;
      cacheWrite += message.usage?.cacheWrite ?? 0;
    }
    if (output <= 0) return;

    const elapsedSeconds = elapsedMs / 1000;
    const promptTokens = input + cacheRead + cacheWrite;
    // event.messages 가 곧 이번 턴의 assistant 메시지들이고 timing 도 거기 붙어 있으므로
    // 세션 브랜치를 다시 뒤질 필요가 없다.
    const timing = turnTiming(event.messages, processStartedAt);
    // Footer와 notice는 persisted timing이 있으면 같은 턴 처리량을 쓴다. timing이 없는
    // 예전/외부 메시지만 기존 message_start→message_end 단조 시계로 폴백한다.
    const tokensPerSecond = turnTokensPerSecond(timing, output, elapsedSeconds);
    ctx.ui.notify(
      formatTpsNotice({
        tokensPerSecond,
        cacheHitRate: promptTokens > 0 ? (cacheRead / promptTokens) * 100 : 0,
        elapsedSeconds,
        timing,
      }),
      "info",
    );
  });
}

export default function tpsExtension(pi) {
  installTps(pi);
}
