#!/usr/bin/env node
/**
 * 브리지 지연 진단. "또 느려졌다" 를 계단과 그 밖으로 가른다.
 *
 * usage:
 *   node bridge-latency.mjs                       # 세 프로바이더, 3라운드 × 4동시
 *   node bridge-latency.mjs --port 8799           # 사이드카 브리지를 잰다
 *   node bridge-latency.mjs --model xai/grok-4.6  # 하나만
 *   node bridge-latency.mjs --rounds 6 --concurrency 4
 *   node bridge-latency.mjs --raw                 # 브리지를 빼고 xAI 를 직접
 *
 * 읽는 법 — 라운드가 반복될수록 뒤쪽 요청이 계단으로 밀리면(3/9/13/16초처럼)
 * 연결이 하나로 수렴해 요청이 직렬화된 것이다. 2026-08 에 그록이 74~155초
 * 걸렸던 병리가 그것이고, 고친 자리는 `harness/bridge/src/upstream-dispatcher.ts`.
 * 다 같이 느리거나 하나만 툭 튀는 것은 다른 문제다.
 *
 * `--raw` 는 브리지를 완전히 빼고 같은 라운드를 돈다. 여기서도 계단이 서면
 * 브리지 코드는 무죄다 — 그 대조가 원인을 두 번 갈랐다.
 *
 * 기록: agent-taskforce/case-studies/harness/bridge-http2-connection-reuse-serialization.md
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_MODELS = ["xai/grok-4.6", "anthropic/claude-haiku-4-5", "openai-codex/gpt-5.6-luna"];
const PROMPT = "Say exactly: ok";

function parseArgs(argv) {
  const args = { port: 8788, rounds: 3, concurrency: 4, models: DEFAULT_MODELS, raw: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--raw") args.raw = true;
    else if (flag === "--port") args.port = Number(argv[++i]);
    else if (flag === "--rounds") args.rounds = Number(argv[++i]);
    else if (flag === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (flag === "--model") args.models = [argv[++i]];
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

/** 브리지를 통과하는 한 번의 호출. 첫 프레임과 총 시간을 잰다. */
async function viaBridge(port, model) {
  const startedAt = Date.now();
  let firstFrame = null;
  const response = await fetch(`http://127.0.0.1:${port}/v3/ai/language-model`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-language-model-id": model },
    body: JSON.stringify({ prompt: [{ role: "user", content: [{ type: "text", text: PROMPT }] }] }),
  });
  if (!response.body) throw new Error(`no body (HTTP ${response.status})`);
  const reader = response.body.getReader();
  let sawText = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstFrame === null) firstFrame = Date.now() - startedAt;
    if (new TextDecoder().decode(value).includes('"text-delta"')) sawText = true;
  }
  return { ms: Date.now() - startedAt, firstFrame, ok: sawText };
}

/** 브리지를 빼고 xAI 를 직접. 계단이 여기서도 서는지 보는 대조군. */
async function viaRawXai(token) {
  const startedAt = Date.now();
  let firstFrame = null;
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: "grok-4.6",
      input: [{ role: "user", content: [{ type: "input_text", text: PROMPT }] }],
      stream: true,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 120)}`);
  const reader = response.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
    if (firstFrame === null) firstFrame = Date.now() - startedAt;
  }
  return { ms: Date.now() - startedAt, firstFrame, ok: true };
}

function summarize(all) {
  const good = all.filter((value) => value > 0).sort((a, b) => a - b);
  if (good.length === 0) return "n=0";
  const at = (q) => (good[Math.min(good.length - 1, Math.floor(good.length * q))] / 1000).toFixed(1);
  return `n=${good.length}  median ${at(0.5)}s  p90 ${at(0.9)}s  max ${(good.at(-1) / 1000).toFixed(1)}s`;
}

/** 라운드마다 뒤 요청이 앞 요청 뒤에 줄줄이 밀리면 계단으로 본다. */
function looksLikeStaircase(rounds) {
  const later = rounds.slice(1);
  if (later.length === 0) return false;
  return later.some((round) => {
    const sorted = [...round].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((value, index) => value - sorted[index]);
    // 최소 3개가 2초 이상 규칙적으로 벌어지면 직렬화 냄새다.
    return gaps.filter((gap) => gap > 2000).length >= Math.max(2, Math.floor(gaps.length * 0.6));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${(await readFile(new URL(import.meta.url))).toString().split("*/")[0]}*/\n`);
    return;
  }

  let call;
  let labels;
  if (args.raw) {
    const auth = JSON.parse(await readFile(join(homedir(), ".senpi", "agent", "auth.json"), "utf8"));
    if (!auth.xai?.access) throw new Error("no xai credential in ~/.senpi/agent/auth.json");
    call = () => viaRawXai(auth.xai.access);
    labels = ["xai (브리지 없이 직접)"];
  } else {
    const health = await fetch(`http://127.0.0.1:${args.port}/health`).catch(() => null);
    if (!health?.ok) throw new Error(`브리지가 :${args.port} 에 없다 (rbr 로 띄운다)`);
    call = (model) => viaBridge(args.port, model);
    labels = args.models;
  }

  for (const label of labels) {
    const rounds = [];
    for (let round = 1; round <= args.rounds; round += 1) {
      const settled = await Promise.allSettled(
        Array.from({ length: args.concurrency }, () => call(label)),
      );
      const times = settled.map((result) => (result.status === "fulfilled" ? result.value.ms : -1));
      rounds.push(times.filter((value) => value > 0));
      const rendered = settled
        .map((result) =>
          result.status === "fulfilled"
            ? `${(result.value.ms / 1000).toFixed(1)}s${result.value.ok ? "" : "?"}`
            : `ERR(${String(result.reason?.message ?? result.reason).slice(0, 24)})`,
        )
        .join(" / ");
      process.stdout.write(`${label.padEnd(28)} R${round}: ${rendered}\n`);
    }
    const flat = rounds.flat();
    const verdict = looksLikeStaircase(rounds)
      ? "계단 — 연결이 하나로 수렴했을 수 있다. upstream-dispatcher.ts 를 본다"
      : "계단 아님";
    process.stdout.write(`${label.padEnd(28)} → ${summarize(flat)}  [${verdict}]\n\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
