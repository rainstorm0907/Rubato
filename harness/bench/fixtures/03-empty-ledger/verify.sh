#!/bin/bash
cd "$(dirname "$0")" || exit 1
./run.sh >/dev/null 2>&1 || { echo "FAIL: run.sh 실패"; ./run.sh; exit 1; }
[ -f ledger.jsonl ] || { echo "FAIL: ledger.jsonl 없음"; exit 1; }
node --input-type=module -e '
import fs from "node:fs";
const rows = fs.readFileSync("ledger.jsonl","utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const g = rows.filter(r => r.kind === "generation");
if (g.length !== 1) { console.log("FAIL: generation 레코드가 " + g.length + "건 (기대 1건)"); process.exit(1); }
const r = g[0];
if (r.input_tokens !== 16000) { console.log("FAIL: input_tokens=" + r.input_tokens + " (기대 16000)"); process.exit(1); }
if (r.cache_read_tokens !== 15872) { console.log("FAIL: cache_read_tokens=" + r.cache_read_tokens); process.exit(1); }
if (r.output_tokens !== 42) { console.log("FAIL: output_tokens=" + r.output_tokens); process.exit(1); }
console.log("PASS");
' || exit 1
