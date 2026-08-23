import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAgentDir, launchEnv } from "./brand.mjs";
import { ensureBroker, loadCatalog } from "./broker.mjs";
import { DEFAULT_MODEL } from "./defaults.mjs";
import { PIN } from "./policy.mjs";
import { resolveRole } from "./role-contract.mjs";
import { listNodeCandidates, pickNode } from "./select-node.mjs";
import { withNoChangelog } from "./no-changelog.mjs";
import { argvHasModel, ensureSessionDefaults } from "./session-defaults.mjs";
import { replaceSystemPrompt } from "./system-prompt.mjs";
import { enginePackageJson, senpiCli, senpiPackageJson } from "./engine-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export function packageRoot() {
  return root;
}

export function senpiCliPath() {
  return senpiCli;
}

export function leadOverlayPath() {
  return join(root, "src/extensions/lead-overlay.mjs");
}

export function adapterPath() {
  return join(root, "src/extensions/adapter.mjs");
}

export function brokerOverlayPath() {
  return join(root, "src/extensions/broker-overlay.mjs");
}

export function readPinnedVersions() {
  const omo = JSON.parse(readFileSync(enginePackageJson, "utf8"));
  const senpi = JSON.parse(
    readFileSync(senpiPackageJson, "utf8"),
  );
  return { omoAi: omo.version, senpi: senpi.version };
}

export function assertExactPin() {
  const got = readPinnedVersions();
  if (got.omoAi !== PIN.omoAi || got.senpi !== PIN.senpi) {
    throw new Error(`rubato-pi pin mismatch: want ${PIN.omoAi}+${PIN.senpi}, got ${got.omoAi}+${got.senpi}`);
  }
}

export function resolveNode24() {
  const picked = pickNode(listNodeCandidates(undefined, [process.execPath]));
  if (!picked) {
    throw new Error("rubato-pi needs Node.js 24+ already installed. Default Node was not changed.");
  }
  return picked;
}

export function buildSenpiArgs(userArgs, { env = process.env } = {}) {
  const modelArgs = argvHasModel(userArgs) ? [] : ["--model", DEFAULT_MODEL];
  return [
    senpiCliPath(),
    "--system-prompt",
    replaceSystemPrompt("", resolveRole({ env }), { env }),
    ...modelArgs,
    "-e",
    leadOverlayPath(),
    "-e",
    brokerOverlayPath(),
    "-e",
    adapterPath(),
    ...userArgs,
  ];
}

export async function spawnRubatoPi({ args = process.argv.slice(2), env = process.env, agentDir = defaultAgentDir() } = {}) {
  assertExactPin();
  ensureBroker({ env });
  const node = resolveNode24();
  mkdirSync(agentDir, { recursive: true });
  // 브로커가 지금 실제로 내려주는 카탈로그로 disabledProviders 를 계산한다.
  // 폴백으로만 계산하면 브로커가 주는 프로바이더를 남이 보고 꺼버린다.
  const catalog = await loadCatalog({ env });
  ensureSessionDefaults(agentDir, { catalog });
  if (!existsSync(senpiCliPath())) {
    throw new Error("pinned senpi CLI is missing; run npm install in harness/rubato-pi");
  }
  return spawn(node.bin, buildSenpiArgs(args), {
    env: withNoChangelog(launchEnv(env, agentDir)),
    stdio: "inherit",
  });
}
