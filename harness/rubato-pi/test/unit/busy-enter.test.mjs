import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { senpiDir } from "../../src/engine-paths.mjs";
import {
  BUSY_ENTER_STATUS,
  injectBusyEnter,
  installBusyEnter,
  isBusyEnterModuleUrl,
  promoteBusyEnter,
  rememberBusyEnter,
} from "../../src/busy-enter.mjs";

const interactivePath = join(senpiDir, "dist/modes/interactive/interactive-mode.js");
const nestedPrefix = "file:///repo/node_modules/@code-yeongyu/senpi/dist/modes/interactive/";
const hoistedPrefix = "file:///repo/node_modules/@code-yeongyu/senpi/dist/modes/interactive/";
const registerHref = new URL("../../src/no-changelog-register.mjs", import.meta.url).href;
const thisFile = fileURLToPath(import.meta.url);
const runtime = process.env.RUBATO_BUSY_ENTER_RUNTIME === "1";
const TRACKED = Symbol.for("rubato.busyEnter.tracked");

function userMessage(text, images) {
  const content = [{ type: "text", text }];
  if (images) content.push(...images);
  return { role: "user", content, timestamp: 1 };
}

function makeMode({ streaming = true, compacting = false } = {}) {
  const followUpMessages = [];
  const steeringMessages = [];
  const queuedInputOrder = [];
  const followUpQueue = { messages: [] };
  const steeringQueue = { messages: [] };
  const statuses = [];
  const displays = [];
  const session = {
    isStreaming: streaming,
    isCompacting: compacting,
    _followUpMessages: followUpMessages,
    _steeringMessages: steeringMessages,
    _queuedInputOrder: queuedInputOrder,
    _recordQueuedInput(text, mode, enqueueOrder) {
      queuedInputOrder.push({ text, mode, enqueueOrder: enqueueOrder ?? queuedInputOrder.length + 1 });
    },
    _removeQueuedInput(text, mode) {
      const index = queuedInputOrder.findIndex((item) => item.mode === mode && item.text === text);
      if (index !== -1) queuedInputOrder.splice(index, 1);
    },
    _emitQueueUpdate() {
      this.lastQueueUpdate = {
        steering: [...steeringMessages],
        followUp: [...followUpMessages],
      };
    },
    agent: {
      followUpQueue,
      steeringQueue,
      steer(message) {
        steeringQueue.messages.push(message);
      },
      followUp(message) {
        followUpQueue.messages.push(message);
      },
    },
  };
  return {
    session,
    compactionQueuedMessages: [],
    compactionInFlightMessages: [],
    statuses,
    displays,
    showStatus(message) {
      statuses.push(message);
    },
    updatePendingMessagesDisplay() {
      displays.push({
        followUp: [...session._followUpMessages],
        steering: [...session._steeringMessages],
        compaction: this.compactionQueuedMessages.map((item) => ({ ...item })),
      });
    },
  };
}

function queueNativeFollowUp(mode, text, images) {
  const message = userMessage(text, images);
  mode.session._followUpMessages.push(text);
  mode.session._recordQueuedInput(text, "followUp");
  mode.session.agent.followUp(message);
  return message;
}

if (!runtime) {
  test("URL matching targets the pinned interactive-mode module", () => {
    assert.equal(isBusyEnterModuleUrl(`${nestedPrefix}interactive-mode.js`), true);
    assert.equal(isBusyEnterModuleUrl(`${hoistedPrefix}interactive-mode.js`), true);
    assert.equal(isBusyEnterModuleUrl(`${nestedPrefix}components/settings-selector.js`), false);
    assert.equal(
      isBusyEnterModuleUrl("file:///x/@earendil-works/pi-tui/dist/terminal.js"),
      false,
    );
  });

  test("transforms are anchored, idempotent, and fail on pinned-source drift", () => {
    const source = readFileSync(interactivePath, "utf8");
    const next = injectBusyEnter(source, "file:///busy-enter.mjs");
    assert.notEqual(next, source);
    assert.match(next, /streamingBehavior: "followUp"/);
    assert.match(next, /__rubatoRememberBusyEnter\?\.\(text\)/);
    assert.match(next, /__rubatoPromoteBusyEnter\?\.\(\)/);
    assert.match(next, /queueCompactionSubmission\(text, "followUp"\)/);
    assert.match(next, /__rubatoInstallBusyEnter\(InteractiveMode\.prototype\)/);
    assert.equal(injectBusyEnter(next, "file:///busy-enter.mjs"), next);
    assert.throws(
      () => injectBusyEnter(source.replace("text = text.trim();", "text = String(text).trim();")),
      /transform drift: submit trim guard/,
    );
    assert.throws(
      () => injectBusyEnter(source.replace(
        "                    await this.session.prompt(text, {\n                        streamingBehavior: \"steer\",",
        "                    await this.session.prompt(text, {\n                        streamingBehavior: \"queued\",",
      )),
      /transform drift: streaming prompt option/,
    );
    assert.throws(
      () => injectBusyEnter(source.replace('queueCompactionSubmission(text, "steer")', 'queueCompactionSubmission(text, "queued")')),
      /transform drift: compaction queue/,
    );
    assert.match(source, /streamingBehavior: "followUp"/);
    assert.match(next, /this\.queueCompactionSubmission\(text, "followUp"\);/);
    assert.doesNotMatch(
      next.slice(next.indexOf("async handleFollowUp()")),
      /__rubatoRememberBusyEnter/,
    );
  });

  test("transformed interactive-mode runs through an explicit child import without inherited NODE_OPTIONS", () => {
    const result = spawnSync(process.execPath, ["--import", registerHref, "--test", thisFile], {
      env: { ...process.env, NODE_OPTIONS: "", RUBATO_BUSY_ENTER_RUNTIME: "1" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });

  test("busy Enter queues follow-up and shows one status line", () => {
    const mode = makeMode();
    const message = queueNativeFollowUp(mode, "later");
    rememberBusyEnter(mode, "later");
    assert.equal(mode[TRACKED].message, message);
    assert.deepEqual(mode.session.agent.followUpQueue.messages, [message]);
    assert.deepEqual(mode.session._followUpMessages, ["later"]);
    assert.deepEqual(mode.statuses, [BUSY_ENTER_STATUS]);
    assert.equal(mode.displays.length, 1);
  });

  test("empty Enter promotes the same still-pending follow-up object", () => {
    const mode = makeMode();
    const first = queueNativeFollowUp(mode, "keep");
    const second = queueNativeFollowUp(mode, "promote me");
    rememberBusyEnter(mode, "promote me");
    promoteBusyEnter(mode);
    assert.deepEqual(mode.session.agent.followUpQueue.messages, [first]);
    assert.deepEqual(mode.session.agent.steeringQueue.messages, [second]);
    assert.equal(mode.session.agent.steeringQueue.messages[0], second);
    assert.deepEqual(mode.session._followUpMessages, ["keep"]);
    assert.deepEqual(mode.session._steeringMessages, ["promote me"]);
    assert.deepEqual(mode.session._queuedInputOrder.map((item) => item.mode), ["followUp", "steer"]);
    assert.deepEqual(mode.session.lastQueueUpdate, {
      steering: ["promote me"],
      followUp: ["keep"],
    });
    assert.equal(mode[TRACKED], undefined);
    assert.equal(mode.displays.length, 2);
  });

  test("empty Enter is a no-op when the tracked follow-up already drained", () => {
    const mode = makeMode();
    const message = queueNativeFollowUp(mode, "gone");
    rememberBusyEnter(mode, "gone");
    mode.session.agent.followUpQueue.messages.splice(0, 1);
    mode.session._followUpMessages.splice(0, 1);
    promoteBusyEnter(mode);
    assert.deepEqual(mode.session.agent.steeringQueue.messages, []);
    assert.deepEqual(mode.session._steeringMessages, []);
    assert.equal(mode[TRACKED], undefined);
    assert.equal(message.role, "user");
  });

  test("multiple queued items promote only the tracked follow-up", () => {
    const mode = makeMode();
    const older = queueNativeFollowUp(mode, "older");
    const newer = queueNativeFollowUp(mode, "newer");
    rememberBusyEnter(mode, "newer");
    const extra = queueNativeFollowUp(mode, "later still");
    promoteBusyEnter(mode);
    assert.deepEqual(mode.session.agent.followUpQueue.messages, [older, extra]);
    assert.deepEqual(mode.session.agent.steeringQueue.messages, [newer]);
    assert.equal(mode.session.agent.steeringQueue.messages[0], newer);
  });

  test("images stay on the same queued message object through promote", () => {
    const mode = makeMode();
    const image = { type: "image", data: "abc", mimeType: "image/png" };
    const message = queueNativeFollowUp(mode, "with image", [image]);
    rememberBusyEnter(mode, "with image");
    promoteBusyEnter(mode);
    assert.equal(mode.session.agent.steeringQueue.messages[0], message);
    assert.equal(mode.session.agent.steeringQueue.messages[0].content[1], image);
  });

  test("compaction flips only the queued item, never an in-flight one", () => {
    const mode = makeMode({ streaming: false, compacting: true });
    const inFlight = { text: "flying", mode: "followUp" };
    const queued = { text: "waiting", mode: "followUp" };
    mode.compactionInFlightMessages.push(inFlight);
    mode.compactionQueuedMessages.push(queued);
    rememberBusyEnter(mode, "waiting");
    assert.equal(mode[TRACKED].message, queued);
    promoteBusyEnter(mode);
    assert.equal(queued.mode, "steer");
    assert.equal(inFlight.mode, "followUp");
    assert.equal(mode.compactionQueuedMessages[0], queued);
    assert.equal(mode.compactionInFlightMessages[0], inFlight);
  });

  test("idle empty Enter stays a no-op and idle non-empty is left to submit", () => {
    const idle = makeMode({ streaming: false, compacting: false });
    const message = queueNativeFollowUp(idle, "pending");
    rememberBusyEnter(idle, "pending");
    promoteBusyEnter(idle);
    assert.equal(idle[TRACKED].message, message);
    assert.deepEqual(idle.session.agent.followUpQueue.messages, [message]);
    assert.deepEqual(idle.session.agent.steeringQueue.messages, []);
  });

  test("installs the helpers at most once per prototype", () => {
    class FakeMode {}
    assert.equal(installBusyEnter(FakeMode.prototype), true);
    assert.equal(installBusyEnter(FakeMode.prototype), false);
    assert.equal(typeof FakeMode.prototype.__rubatoRememberBusyEnter, "function");
    assert.equal(typeof FakeMode.prototype.__rubatoPromoteBusyEnter, "function");
  });
} else {
  test("child import has a clean NODE_OPTIONS and a transformed InteractiveMode", async () => {
    assert.equal(process.env.NODE_OPTIONS ?? "", "");
    const { InteractiveMode } = await import(`${pathToFileURL(interactivePath).href}?busy=${Date.now()}`);
    assert.equal(typeof InteractiveMode.prototype.__rubatoRememberBusyEnter, "function");
    assert.equal(typeof InteractiveMode.prototype.__rubatoPromoteBusyEnter, "function");
    const source = InteractiveMode.prototype.setupEditorSubmitHandler.toString();
    assert.match(source, /streamingBehavior: "followUp"/);
    assert.match(source, /queueCompactionSubmission\(text, "followUp"\)/);
    assert.doesNotMatch(source, /streamingBehavior: "steer"/);
    const followUp = InteractiveMode.prototype.handleFollowUp.toString();
    assert.match(followUp, /streamingBehavior: "followUp"/);
    assert.match(followUp, /queueCompactionSubmission\(text, "followUp"\)/);
    assert.doesNotMatch(followUp, /__rubatoRememberBusyEnter/);
  });
}
