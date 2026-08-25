import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { PLAN_GATED_AGENT_NAMES, type AgentDefinition } from "../../agents"
import { CATEGORY_CALLER_GUIDANCE } from "../../category"
import { listTaskAgents, listTaskCategories } from "./categories"
import type { TaskCategoryInfo } from "./types"

export const TASK_PROMPT_SNIPPET = "Spawn one child or fan out a batch; use task_send to continue an existing child."

export const TASK_PROMPT_GUIDELINES: readonly string[] = [
  "Spawns run in the background by default and return a task id immediately; pass run_in_background=false only when this turn genuinely cannot continue without the child's result.",
  "NEVER pass model together with category: category-routed tasks take their model from omo.json (categories.<name>.models).",
  "Continue an existing child with task_send(to=\"st_...\", message=\"...\"); task always spawns.",
  "Use task_output for one midpoint status or transcript peek; use task_cancel to end a child.",
  "Pass task_summary (one line, <=80 chars) on every spawn: the user's footer/widget UI shows it instead of the raw prompt, so it should say WHAT was delegated.",
]

type DescriptionInput = {
  readonly omoConfig: OmoConfig
  readonly agents: Readonly<Record<string, AgentDefinition>>
}

function renderCategoryList(entries: readonly TaskCategoryInfo[]): string {
  if (entries.length === 0) return "  (none configured)"
  return entries.map((entry) => {
    const categoryLine = entry.description ? `  - ${entry.name}: ${entry.description}` : `  - ${entry.name}`
    const callerGuidance = CATEGORY_CALLER_GUIDANCE[entry.name]?.replaceAll("\n", "\n    ")
    return callerGuidance ? `${categoryLine}\n    ${callerGuidance}` : categoryLine
  }).join("\n")
}

export function buildTaskToolDescription(input: DescriptionInput): string {
  const categories = listTaskCategories(input.omoConfig)
  const agents = listTaskAgents(input.agents)
  const plainAgents = agents.filter((agent) => !PLAN_GATED_AGENT_NAMES.has(agent.name))
  const gatedAgents = agents.filter((agent) => PLAN_GATED_AGENT_NAMES.has(agent.name))
  // With zero loaded agents, subagent_type is a dead rail: every spawn naming one fails at
  // validateTaskTarget. Advertising the parameter (and a momus example) in that state invites the
  // model to invent an agent name, so the whole route is omitted instead of being rendered with a
  // "none loaded" placeholder. The model-override note rides on the same branch because model is
  // only reachable alongside subagent_type (validation.ts rejects a model-only target).
  const hasAgentRoute = plainAgents.length > 0 || gatedAgents.length > 0
  const agentNames = plainAgents.map((agent) => agent.name).join(", ")
  const plainAgentLine =
    plainAgents.length === 0
      ? ""
      : `\n- subagent_type invokes a loaded agent directly. Available agents: ${agentNames}`
  const gatedLine =
    gatedAgents.length === 0
      ? ""
      : `${plainAgents.length === 0 ? "\n- subagent_type invokes a loaded agent directly." : ""}\n  Plan-gated agents (spawnable only after the user explicitly requests the ulw-plan workflow, a .omo/plans/*.md plan artifact was touched in this session, and start-work was never invoked): ${gatedAgents.map((agent) => agent.name).join(", ")}`
  const momusNotice =
    gatedAgents.length === 0
      ? ""
      : "\n  momus is one-shot: spawn it, read task_output, optionally task_cancel; task_send is always refused. The harness replaces the momus spawn prompt with the canonical plan-review contract (one .omo/plans/*.md path only) - any other prompt content is discarded, so pass the plan path and nothing else."
  const targetRule = hasAgentRoute
    ? "Each spawn MUST provide EITHER category OR subagent_type after inheritance. DO NOT provide both."
    : "Each spawn MUST provide a category after inheritance."
  const modelNote = hasAgentRoute
    ? `name is an optional stable handle. model is an explicit override for subagent_type spawns ONLY.
NEVER combine model with category: a category-routed task always takes its model from omo.json (categories.<name>.models), so passing both fails with invalid_arguments.
  CORRECT: task(subagent_type="${gatedAgents[0]?.name ?? plainAgents[0]?.name}", model="openai/gpt-5.6-sol", prompt="...")
  INCORRECT: task(category="architect", model="quotio-openai/gpt-5.6-luna-fast", prompt="...")`
    : `name is an optional stable handle. A category-routed task takes its model from omo.json (categories.<name>.models), so NEVER pass model: it fails with invalid_arguments.
  INCORRECT: task(category="architect", model="quotio-openai/gpt-5.6-luna-fast", prompt="...")`
  const batchLine = hasAgentRoute
    ? "- Batch: tasks (1-16 items); top-level target, model, and skills are inherited when an item omits them. An inherited model is rejected when the item's effective target is a category."
    : "- Batch: tasks (1-16 items); the top-level target and skills are inherited when an item omits them."
  return `Spawn one child task or fan out a batch.

Choose exactly one input form:
- Single: prompt
${batchLine}

${targetRule}

- category routes through Sisyphus-Junior. Available categories:
${renderCategoryList(categories)}${plainAgentLine}${gatedLine}${momusNotice}

Blank provider padding is normalized automatically; do not add filler values.
load_skills prepends named skills. run_in_background defaults to true: the spawn returns task ids immediately and completion arrives as a notification. Pass run_in_background=false to block this turn until the child finishes.
${modelNote}
task_send continues an existing child; task always spawns.
Prompts MUST be in English.`
}
