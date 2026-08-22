export const CONTRACT_SKILLS_TYPE = "rubato-pi-contract-skills";

export const CONTRACT_SKILLS_INSTRUCTION =
  "Before you hand work to another session or start from a brief, read Skill(dispatching) and Skill(dispatched).";

const INJECT_REASONS = new Set(["startup", "new", "fork", "resume"]);

export function sessionHasContractSkills(entries = []) {
  return entries.some(
    (entry) => entry?.type === "custom_message" && entry.customType === CONTRACT_SKILLS_TYPE,
  );
}

export function shouldInjectContractSkills(reason, entries = []) {
  return INJECT_REASONS.has(reason) && !sessionHasContractSkills(entries);
}

export function contractSkillsMessage() {
  return {
    customType: CONTRACT_SKILLS_TYPE,
    content: CONTRACT_SKILLS_INSTRUCTION,
    display: false,
  };
}
