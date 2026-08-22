import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterPath, leadOverlayPath, senpiCliPath } from "../../src/launch.mjs";
import { probeRpc } from "../helpers/rpc-surface.mjs";

test("memory stays registered and records whether RPC spawned a dreaming child", async () => {
  const surface = await probeRpc({
    nodeBin: process.execPath,
    senpiCli: senpiCliPath(),
    extensionArgs: ["-e", leadOverlayPath(), "-e", adapterPath()],
  });
  assert.ok(surface.extensionCommands.includes("dream"));
  const note = {
    dreamCommand: true,
    mcpServers: surface.mcpServers,
    childHint: surface.stderr.includes("dream") || surface.stderr.includes("sleeptime"),
    mode: "rpc",
  };
  const tmp = join(dirname(fileURLToPath(import.meta.url)), "../../tmp");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "dreaming.json"), `${JSON.stringify(note, null, 2)}\n`);
});
