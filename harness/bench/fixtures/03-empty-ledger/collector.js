// 업스트림 SSE 를 받아 generation 사용량을 ledger.jsonl 에 기록한다.
// 이 파일은 계약(contract)이다. 고치지 않는다.
import http from "node:http";
import fs from "node:fs";

const LEDGER = new URL("./ledger.jsonl", import.meta.url).pathname;
const LOG = new URL("./collector.log", import.meta.url).pathname;
const log = (m) => fs.appendFileSync(LOG, m + "\n");

function validGenerationId(v) {
  return typeof v === "string" && /^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
}

export async function collect(sseText) {
  let usage = null, generationId = null, sawTerminal = false;
  for (const block of sseText.split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line.slice(6)); } catch { continue; }
    const gid = ev?.providerMetadata?.gateway?.generationId;
    if (validGenerationId(gid)) generationId = gid;
    if (ev.type === "finish") {
      sawTerminal = true;
      if (ev.usage && typeof ev.usage.inputTokens?.total === "number") usage = ev.usage;
    }
  }
  if (!sawTerminal) {
    log("usage dropped: reason=no_terminal_event");
    fs.appendFileSync(LEDGER, JSON.stringify({ kind: "incident", completeness: "incomplete" }) + "\n");
    return;
  }
  if (!generationId) {
    log("usage dropped: reason=generation_identity_missing");
    fs.appendFileSync(LEDGER, JSON.stringify({ kind: "incident", completeness: "incomplete" }) + "\n");
    return;
  }
  if (!usage) {
    log("usage dropped: reason=usage_missing");
    fs.appendFileSync(LEDGER, JSON.stringify({ kind: "incident", completeness: "incomplete" }) + "\n");
    return;
  }
  fs.appendFileSync(LEDGER, JSON.stringify({
    kind: "generation", id: generationId,
    input_tokens: usage.inputTokens.total,
    cache_read_tokens: usage.inputTokens.cacheRead ?? 0,
    output_tokens: usage.outputTokens?.total ?? 0,
  }) + "\n");
}
