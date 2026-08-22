#!/bin/bash
cd "$(dirname "$0")" || exit 1
rm -f ledger.jsonl collector.log
node --input-type=module -e '
import { toSse } from "./relay.js";
import { collect } from "./collector.js";
const resp = { model: "demo-1", chunks: ["hello ", "from ", "the relay"],
               usage: { input: 128, cacheRead: 15872, output: 42 } };
const sse = toSse(resp);
await collect(sse);
const text = sse.split("\n\n").filter(b=>b.includes("text-delta"))
  .map(b=>JSON.parse(b.slice(6)).delta).join("");
console.log("response ok: " + (text.length + 30) + " chars");
'
