const MARKER = "rubato.busyEnter.injected";
const INSTALLED = Symbol.for("rubato.busyEnter.installed");
const TRACKED = Symbol.for("rubato.busyEnter.tracked");

export const BUSY_ENTER_STATUS = "큐에 등록했어. Enter를 한 번 더 누르면 지금 작업에 바로 전달해.";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`rubato busy enter transform drift: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

export function isBusyEnterModuleUrl(url) {
  return url.includes("@code-yeongyu/senpi/dist/modes/interactive/interactive-mode.js");
}

export function busyEnterHref() {
  return import.meta.url;
}

export function injectBusyEnter(source, href = busyEnterHref()) {
  if (source.includes(MARKER)) return source;
  let next = replaceOnce(
    source,
    "            text = text.trim();\n            if (!text)\n                return;",
    "            text = text.trim();\n            if (!text) {\n                this.__rubatoPromoteBusyEnter?.();\n                return;\n            }",
    "submit trim guard",
  );
  next = replaceOnce(
    next,
    "                    await this.session.prompt(text, {\n                        streamingBehavior: \"steer\",\n                        ...(images.length > 0 ? { images } : {}),\n                        ...this.optimisticUserEchoes.promptOptions(pendingEchoId),\n                    });",
    "                    await this.session.prompt(text, {\n                        streamingBehavior: \"followUp\",\n                        ...(images.length > 0 ? { images } : {}),\n                        ...this.optimisticUserEchoes.promptOptions(pendingEchoId),\n                    });\n                    this.__rubatoRememberBusyEnter?.(text);",
    "streaming prompt option",
  );
  next = replaceOnce(
    next,
    "                    this.queueCompactionSubmission(text, \"steer\");",
    "                    this.queueCompactionSubmission(text, \"followUp\");\n                    this.__rubatoRememberBusyEnter?.(text);",
    "compaction queue",
  );
  return `${next}
// ${MARKER}
const { installBusyEnter: __rubatoInstallBusyEnter } = await import(${JSON.stringify(href)});
__rubatoInstallBusyEnter(InteractiveMode.prototype);
`;
}

function agentMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("");
}

function locateFreshFollowUp(mode, text) {
  if (mode.session?.isCompacting) {
    const queued = mode.compactionQueuedMessages;
    if (!Array.isArray(queued)) return undefined;
    for (let i = queued.length - 1; i >= 0; i -= 1) {
      const item = queued[i];
      if (item?.mode === "followUp") return { kind: "compaction", message: item, text: item.text };
    }
    return undefined;
  }
  const messages = mode.session?.agent?.followUpQueue?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { kind: "native", text };
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (agentMessageText(message) === text) return { kind: "native", message, text };
  }
  return { kind: "native", message: messages[messages.length - 1], text };
}

export function rememberBusyEnter(mode, text) {
  mode[TRACKED] = locateFreshFollowUp(mode, text) ?? { kind: "native", text };
  mode.updatePendingMessagesDisplay?.();
  mode.showStatus?.(BUSY_ENTER_STATUS);
}

export function promoteBusyEnter(mode) {
  const session = mode.session;
  if (!session?.isStreaming && !session?.isCompacting) return;
  const tracked = mode[TRACKED];
  if (!tracked) return;

  if (tracked.kind === "compaction") {
    const queued = mode.compactionQueuedMessages;
    const message = tracked.message;
    if (!Array.isArray(queued) || !message || queued.indexOf(message) === -1) {
      mode[TRACKED] = undefined;
      return;
    }
    message.mode = "steer";
    mode[TRACKED] = undefined;
    mode.updatePendingMessagesDisplay?.();
    return;
  }

  const queue = session.agent?.followUpQueue?.messages;
  const message = tracked.message;
  const index = Array.isArray(queue) && message ? queue.indexOf(message) : -1;
  if (index === -1) {
    mode[TRACKED] = undefined;
    return;
  }
  queue.splice(index, 1);

  const text = tracked.text;
  const followUps = session._followUpMessages;
  if (Array.isArray(followUps)) {
    const followUpIndex = followUps.lastIndexOf(text);
    if (followUpIndex !== -1) followUps.splice(followUpIndex, 1);
  }
  const order = session._queuedInputOrder?.find((item) => item.mode === "followUp" && item.text === text);
  session._removeQueuedInput?.(text, "followUp");
  if (Array.isArray(session._steeringMessages)) session._steeringMessages.push(text);
  session._recordQueuedInput?.(text, "steer", order?.enqueueOrder);
  session.agent.steer(message);
  session._emitQueueUpdate?.();
  mode[TRACKED] = undefined;
  mode.updatePendingMessagesDisplay?.();
}

export function installBusyEnter(proto) {
  if (proto == null || typeof proto !== "object") return false;
  if (proto[INSTALLED]) return false;
  proto.__rubatoRememberBusyEnter = function remember(text) {
    rememberBusyEnter(this, text);
  };
  proto.__rubatoPromoteBusyEnter = function promote() {
    promoteBusyEnter(this);
  };
  proto[INSTALLED] = true;
  return true;
}
