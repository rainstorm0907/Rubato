import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { skillsSection } from "./skills-section.mjs";

const SKILLS_SECTION = "The following skills provide specialized instructions";

export const TOOL_GUIDELINES = `## Tool Guidelines

- Use read to examine files instead of cat or sed.
- Use edit for precise changes (edits[].oldText must match exactly).
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls.
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Use one todo operation at a time; batch it with the real work rather than making a solo todo turn. Reference tasks and phases by their exact content/name.
- If a step needs more than one tool call, prefer one eval cell that runs independent calls together and returns distilled facts.
- Record durable facts, preferences, and decisions with the memory tool as you learn them; every change is committed with the reason you provide.
- Memory files are markdown with YAML frontmatter; keep each block's description accurate because the memory index surfaces it.
- Use memory_apply_patch for multi-file or multi-hunk memory edits; prefer the memory tool for single-block changes.
- Research defaults to Skill(consult): send one self-contained packet and get a GPT-5.6 read back as evidence. Reach for it whenever the question deserves an actual researcher — a comparison, a design question, an unfamiliar domain — not just when you are stuck.
- The alternative is Aside: read Skill(browser-cli) to pick the backend, then Skill(aside-browser) for the CLI itself. \`aside exec\` drives a real browser with the user's logged-in accounts, cookies, and history, so it covers interactive pages and sessions consult cannot.
- web_search and web_fetch are the fallback, not the default: a quick fact check or a public page a plain GET can read. Anything heavier goes to consult or Aside first.
`.trim();

export function rolePromptsRoot(env = process.env) {
  if (env.RUBATO_PROMPTS_DIR) return env.RUBATO_PROMPTS_DIR;
  return join(homedir(), ".agents", "rubato");
}

// A single file instead of assembling one from pieces (base + core + voice).
// rubato-soul sets this to ~/Documents/SOUL.md.
export function customPromptPath(env = process.env) {
  const path = env.RUBATO_SYSTEM_PROMPT_FILE;
  return path && path.length > 0 ? path : null;
}

// Three roles, two prompt files: owner and verifier share `teammate.pi.md`.
// That is deliberate, not a gap to close — verification is itself a workstream,
// so a verifier is an owner whose outcome happens to be a judgement. What
// separates the two is the brief they receive, not the prompt they boot with.
//
// The `.pi` in the filename is lineage: these are built from the pi pieces in
// harness/prompts/. The fx runtime that owned the unsuffixed build is gone.
export function promptNameForRole(role) {
  return role === "lead" ? "lead.pi.md" : "teammate.pi.md";
}

export function loadRolePrompt(role, { env = process.env, readFile = readFileSync } = {}) {
  const custom = customPromptPath(env);
  const path = custom ?? join(rolePromptsRoot(env), ".build", promptNameForRole(role));
  if (!existsSync(path)) {
    throw new Error(
      custom
        ? `rubato-pi system prompt missing: ${path}`
        : `rubato-pi role prompt missing: ${path}`,
    );
  }
  return readFile(path, "utf8");
}

export function extractHarnessExtras(existing) {
  const extras = [];
  const take = (pattern) => {
    const match = existing.match(pattern);
    if (match) extras.push(match[0].trim());
  };
  take(/<project_context>[\s\S]*?<\/project_context>/);
  take(/<memory>[\s\S]*?<\/memory>/);
  take(/<memory_metadata>[\s\S]*?<\/memory_metadata>/);
  take(new RegExp(`${SKILLS_SECTION}[\\s\\S]*?(?=\\nCurrent working directory:|$)`));
  take(/Current working directory: [^\n]+/);
  return extras;
}

export function replaceSystemPrompt(existing, role, hooks = {}) {
  const load = hooks.loadRolePrompt ?? ((nextRole) => loadRolePrompt(nextRole, hooks));
  const parts = [load(role).trim(), TOOL_GUIDELINES];
  const extras = extractHarnessExtras(existing ?? "");
  parts.push(...extras);
  // Senpi only appends its own skill listing when it builds the prompt itself,
  // and launch.mjs hands it a finished one so the stock prompt never stands up.
  // Without this the session cannot see which skills exist. Skip it when the
  // incoming prompt already carried a listing, so the two never stack.
  if (!extras.some((part) => part.startsWith(SKILLS_SECTION))) {
    const listSkills = hooks.skillsSection ?? skillsSection;
    parts.push(listSkills());
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}
