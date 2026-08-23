import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promptNameForRole } from "../../src/system-prompt.mjs";

// The role prompts are their own files now. These assertions used to guard a
// runtime string replacement; they guard the built pieces instead, so a stray
// fx rail cannot reach a pi session.
function rolePrompt(role) {
  return readFileSync(join(homedir(), ".agents/rubato/.build", promptNameForRole(role)), "utf8");
}

test("lead prompt names the pi rails and no fx ones", () => {
  const text = rolePrompt("lead");
  assert.match(text, /running on rubato, a Senpi engine forked from omo-native/);
  assert.match(text, /`task` tool/);
  assert.match(text, /team_create/);
  // 승인 게이트는 team_create 에만 남기고 그 절차는 Skill(agent-taskforce) 가
  // 소유한다. 일회성 자식은 허락 없이 띄운다 — 그래야 "그냥 내가 하지"로 안 간다.
  assert.match(text, /a one-off child needs no permission/);
  assert.match(text, /Skill\(agent-taskforce\) first/);
  assert.match(text, /You choose each child's model/);
  assert.match(text, /catalog short name/);
  assert.match(text, /runtimes\/pi\.md/);

  assert.doesNotMatch(text, /fork of the fx harness/);
  assert.doesNotMatch(text, /## Rails — fx/);
  assert.doesNotMatch(text, /`subagent` tool/);
  assert.doesNotMatch(text, /fx models/);
  assert.doesNotMatch(text, /rubato dispatch/);
  assert.doesNotMatch(text, /FX_MODEL/);
  assert.doesNotMatch(text, /FX_SUBAGENT_SYSTEM_PROMPT_FILE/);
  assert.doesNotMatch(text, /~\/\.fx\//);
  assert.doesNotMatch(text, /\/approve-spawn/);
});

test("teammate prompt points helpers at task, not subagent", () => {
  const text = rolePrompt("owner");
  assert.match(text, /Use the `task` tool/);
  assert.doesNotMatch(text, /`subagent` tool/);
  assert.doesNotMatch(text, /fx models/);
  assert.doesNotMatch(text, /rubato dispatch/);
  assert.doesNotMatch(text, /~\/\.fx\//);
});

test("both role prompts defer the dispatch contract to the skills", () => {
  assert.match(rolePrompt("lead"), /Skill\(dispatching\)/);
  assert.match(rolePrompt("owner"), /Skill\(dispatched\)/);
});
