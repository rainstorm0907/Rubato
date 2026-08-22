import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_SKILLS_INSTRUCTION,
  CONTRACT_SKILLS_TYPE,
  contractSkillsMessage,
  sessionHasContractSkills,
  shouldInjectContractSkills,
} from "../../src/contract-skills.mjs";

test("startup injects a hidden instruction to read both contract skills", () => {
  assert.equal(shouldInjectContractSkills("startup"), true);
  assert.equal(shouldInjectContractSkills("new"), true);
  assert.equal(shouldInjectContractSkills("fork"), true);
  assert.equal(shouldInjectContractSkills("resume"), true);
  assert.equal(shouldInjectContractSkills("reload"), false);

  const message = contractSkillsMessage();
  assert.equal(message.customType, CONTRACT_SKILLS_TYPE);
  assert.equal(message.display, false);
  assert.match(message.content, /Skill\(dispatching\)/);
  assert.match(message.content, /Skill\(dispatched\)/);
  assert.equal(message.content, CONTRACT_SKILLS_INSTRUCTION);
});

test("does not inject again when the session already has the instruction", () => {
  const entries = [{ type: "custom_message", customType: CONTRACT_SKILLS_TYPE }];
  assert.equal(sessionHasContractSkills(entries), true);
  assert.equal(shouldInjectContractSkills("startup", entries), false);
  assert.equal(shouldInjectContractSkills("resume", entries), false);
});
