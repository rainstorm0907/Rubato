import test from "node:test";
import assert from "node:assert/strict";
import { adapterPath, brokerOverlayPath, buildSenpiArgs, leadOverlayPath, readPinnedVersions } from "../../src/launch.mjs";
import { PIN } from "../../src/policy.mjs";

test("launcher pins exact omo-ai and senpi versions", () => {
  assert.deepEqual(readPinnedVersions(), { omoAi: PIN.omoAi, senpi: PIN.senpi });
});

test("senpi argv replaces the system prompt and loads lead overlay first", () => {
  const args = buildSenpiArgs(["--mode", "rpc"]);
  const promptAt = args.indexOf("--system-prompt");
  const leadAt = args.indexOf(leadOverlayPath());
  const brokerAt = args.indexOf(brokerOverlayPath());
  const adapterAt = args.indexOf(adapterPath());
  assert.ok(promptAt > 0);
  assert.match(args[promptAt + 1], /Working agreement/);
  assert.match(args[promptAt + 1], /`task` tool/);
  assert.match(args[promptAt + 1], /## Tool Guidelines/);
  assert.match(args[promptAt + 1], /one eval cell/);
  assert.doesNotMatch(args[promptAt + 1], /operating inside pi/);
  assert.doesNotMatch(args[promptAt + 1], /## Rails — fx/);
  assert.doesNotMatch(args[promptAt + 1], /Run `fx models`/);
  assert.doesNotMatch(args[promptAt + 1], /# Dispatching/);
  assert.doesNotMatch(args[promptAt + 1], /# Dispatched/);
  const modelAt = args.indexOf("--model");
  assert.equal(args[modelAt + 1], "anthropic/claude-opus-5");
  assert.ok(args.includes("-e"));
  assert.ok(leadAt > 0 && args[leadAt - 1] === "-e");
  assert.ok(brokerAt > leadAt && args[brokerAt - 1] === "-e");
  assert.ok(adapterAt > brokerAt && args[adapterAt - 1] === "-e");
});

test("member argv gets teammate prompt plus the same tool guidelines", () => {
  const args = buildSenpiArgs(["--mode", "rpc"], { env: { SENPI_TASK_MEMBER: "alpha" } });
  const prompt = args[args.indexOf("--system-prompt") + 1];
  assert.match(prompt, /# Workstream owner/);
  assert.match(prompt, /## Tool Guidelines/);
  assert.match(prompt, /one eval cell/);
  assert.doesNotMatch(prompt, /# Lead\n/);
  assert.doesNotMatch(prompt, /# Dispatching/);
  assert.doesNotMatch(prompt, /# Dispatched/);
});

test("an explicit --model is not overwritten", () => {
  const args = buildSenpiArgs(["--model", "xai/grok-4.6"]);
  assert.equal(args.filter((token) => token === "--model").length, 1);
  assert.equal(args[args.indexOf("--model") + 1], "xai/grok-4.6");
});
