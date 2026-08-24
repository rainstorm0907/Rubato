// Nudge the agent when a turn ends on a stated intention that was never acted on.
//
// Why: the model often closes a turn with "~할게 / ~볼게 / ~찾을게" — announcing
// the next action and then simply stopping. The user then has to type "그럼 진행해"
// by hand. This extension detects that shape at agent_settled and steers the
// continuation in automatically.
//
// Why message_end drives the state: a turn may announce an action mid-flight and
// then actually perform it (tools run, a new text message closes the turn). Only
// the LAST assistant text of the turn matters, so each message_end overwrites the
// candidate. Counting tool calls is therefore unnecessary — a promise followed by
// real work is naturally overwritten by whatever text comes after it.

const NUDGE_TEXT =
  '위에서 하겠다고 말한 걸 아직 안 했어. 지금 이어서 진행해. ' +
  '이미 했거나, 사용자 입력을 기다려야 하는 상황이면 그렇다고만 짧게 answer해.'

// Promise endings: the paragraph must END on one of these.
const PROMISE =
  /(할게|볼게|올게|줄게|들게|갈게|하겠|보겠|찾을게|넣을게|읽을게|만들게|이어갈게|있을게)\s*[.!]?\s*$/

// The ball is in the user's court — a question, or an explicit request for input.
const ASK =
  /(\?|할까|볼까|갈까|어때|어느 쪽|할래|볼래|주세요|주시면|알려줘|말해줘|정해줘|골라|적어줘|던져줘|해줘)/

// Conditional clause ("원하면", "정해주면", "라우터 종류만 알면") — the promise is
// contingent on something the user has not supplied yet.
const COND = /[가-힣](면|거든)\s/

// Waiting on an external event (a background task, a deploy) rather than on itself.
const WAITING =
  /(끝나면|나오면|들어오면|완료되면|오는 대로|끝나는 대로|진행 중이|기다리는 동안|돌아가는 중)/

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') out += text
    }
  }
  return out
}

// Why: only the closing paragraph carries the turn's parting intent. Earlier
// paragraphs routinely contain promises that the turn already fulfilled.
function lastParagraph(text: string): string {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

function isUnkeptPromise(text: string): boolean {
  const p = lastParagraph(text)
  if (!p) return false
  if (!PROMISE.test(p)) return false
  if (ASK.test(p)) return false
  if (COND.test(p)) return false
  if (WAITING.test(p)) return false
  return true
}

export default function (pi: any): void {
  // Why: subagents and team members run on their own budget with no human
  // waiting on them, so a nudge only burns tokens. These two variable names
  // are the engine's own signals: the task component itself skips work when
  // SENPI_CODING_AGENT_SESSION_DIR is set ("running inside a senpi-task RPC
  // child") and refuses to register when SENPI_TASK_MEMBER is set.
  const env = (globalThis as any).process?.env ?? {}
  if (env.SENPI_CODING_AGENT_SESSION_DIR || env.SENPI_TASK_MEMBER) return
  if (env.RUBATO_NO_PROMISE_NUDGE) return

  let lastAssistantText = ''
  // Why: if the model answers a nudge with yet another bare promise, nudging
  // again would loop. One nudge per user turn is the cap; a real user message
  // clears it.
  let nudgedThisTurn = false

  pi.on('turn_start', () => {
    lastAssistantText = ''
  })

  // Why: a genuine user message means the human is back in the loop, so the
  // one-nudge budget resets. The source check is load-bearing: pi fires input
  // for extension-injected messages too, so an unguarded reset would let the
  // nudge clear its own budget and loop forever.
  pi.on('input', (event: any) => {
    if (event?.source === 'extension') return
    nudgedThisTurn = false
    lastAssistantText = ''
  })

  pi.on('message_end', (event: any) => {
    if (event?.message?.role !== 'assistant') return
    const text = extractAssistantText(event.message)
    if (text.trim()) lastAssistantText = text
  })

  // Why: sendUserMessage lives on the extension API object, not on the event
  // context. The agent_settled ctx carries session/model state only — it has no
  // message-injection methods at all.
  pi.on('agent_settled', () => {
    if (nudgedThisTurn) return
    const text = lastAssistantText
    lastAssistantText = ''
    if (!text || !isUnkeptPromise(text)) return
    if (typeof pi.sendUserMessage !== 'function') return

    nudgedThisTurn = true
    try {
      pi.sendUserMessage(NUDGE_TEXT)
    } catch {
      // Why: a failed nudge must never take the session down with it.
      nudgedThisTurn = false
    }
  })
}
