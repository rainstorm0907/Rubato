import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MIN_MAJOR = 24;

export function versionOf(bin) {
  if (!existsSync(bin)) return null;
  const result = spawnSync(bin, ["-v"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec((result.stdout || "").trim());
  if (!match) return null;
  return {
    bin,
    text: `v${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function listNodeCandidates(home = homedir(), extra = []) {
  const bins = [...extra, "/opt/homebrew/bin/node", "/usr/local/bin/node"];
  const nvmRoot = join(home, ".nvm/versions/node");
  if (existsSync(nvmRoot)) {
    for (const name of readdirSync(nvmRoot)) bins.unshift(join(nvmRoot, name, "bin/node"));
  }
  return bins;
}

export function pickNode(candidates) {
  const seen = new Set();
  const found = [];
  for (const bin of candidates) {
    if (seen.has(bin)) continue;
    seen.add(bin);
    const version = versionOf(bin);
    if (version && version.major >= MIN_MAJOR) found.push(version);
  }
  found.sort((a, b) => {
    if (a.major === 24 && b.major !== 24) return -1;
    if (b.major === 24 && a.major !== 24) return 1;
    return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
  });
  return found[0] ?? null;
}
