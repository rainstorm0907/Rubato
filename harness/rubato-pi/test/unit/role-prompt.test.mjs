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
  assert.match(text, /show the user a roster/);
  assert.match(text, /You choose each teammate's model/);
  assert.match(text, /Wait for their yes in this chat/);
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
