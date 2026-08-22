#!/usr/bin/env node
import { listNodeCandidates, pickNode } from "../src/select-node.mjs";

const picked = pickNode(listNodeCandidates(undefined, [process.execPath]));
if (!picked) {
  console.error("rubato-pi needs Node.js 24+ already installed. Default Node was not changed.");
  process.exit(2);
}
process.stdout.write(process.argv.includes("--print") ? `${picked.bin}\n` : `${picked.text} ${picked.bin}\n`);
