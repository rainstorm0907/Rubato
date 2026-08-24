import { join } from "node:path";
import { omoExtension } from "../engine-paths.mjs";
import { resolveRole } from "../role-contract.mjs";
import { replaceSystemPrompt } from "../system-prompt.mjs";
import { isTeamMemberProcess, parseMemberIdentity } from "../member-identity.mjs";
import { registerMemberBoardTools, restoreMemberTaskEngine } from "../member-tools.mjs";
import { rubatoPiTaskComponent } from "../omo-runtime.mjs";
import { DAG_ON_COMPONENTS } from "../policy.mjs";
import { provisionSpecWorktrees } from "../team-worktrees.mjs";
import { contractSkillsMessage, shouldInjectContractSkills } from "../contract-skills.mjs";
import { installStatusline } from "./statusline.mjs";
import { installSessionTitle } from "./session-title.mjs";
import { installEvalSearchGuard } from "../eval-search-guard.mjs";

const omoExt = omoExtension;
const { composeOmoSenpiExtension, omoSenpiComponents } = await import(omoExt);

const DAG_ON = new Set(DAG_ON_COMPONENTS);

function leadOverlayLoaded(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === "-e" || argv[i] === "--extension") && argv[i + 1]?.endsWith("lead-overlay.mjs")) {
      return true;
    }
  }
  return false;
}

const dagOverlay = composeOmoSenpiExtension(
  omoSenpiComponents.filter((component) => DAG_ON.has(component.name)),
);
const taskComponent = rubatoPiTaskComponent;

export default async function rubatoPiAdapter(pi) {
  installStatusline(pi);
  installEvalSearchGuard(pi);
  const member = isTeamMemberProcess();
  const role = resolveRole();
  if (!member) installSessionTitle(pi);
  if (!leadOverlayLoaded(process.argv) && !member) {
    await dagOverlay(pi);
  }
  if (member && taskComponent) {
    await restoreMemberTaskEngine(composeOmoSenpiExtension, taskComponent, pi);
    registerMemberBoardTools(pi, parseMemberIdentity() ?? {});
  }

  pi.on("session_start", (event, ctx) => {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    if (!shouldInjectContractSkills(event.reason, entries)) return;
    pi.sendMessage(contractSkillsMessage(role), { triggerTurn: false, deliverAs: "nextTurn" });
  });

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: replaceSystemPrompt(event.systemPrompt ?? "", role),
  }));

  pi.on("tool_call", async (event) => {
    if (event.toolName === "team_create") {
      const spec = event.input?.inline_spec ?? event.input?.inlineSpec;
      const repo = process.cwd();
      const destRoot = join(process.env.SENPI_CODING_AGENT_DIR ?? repo, "worktrees");
      const next = await provisionSpecWorktrees(spec, { repo, destRoot });
      if (event.input && next) {
        if (event.input.inline_spec) event.input.inline_spec = next;
        if (event.input.inlineSpec) event.input.inlineSpec = next;
      }
    }
  });
}
