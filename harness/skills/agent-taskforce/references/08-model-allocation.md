# Model allocation for the lead

*Lead.* Read before proposing the roster. This guide is deliberately soft: choose by the work's dominant bottleneck, not by permanent job titles.

The human operator chooses whether framing is used and which model is lead. You choose the smallest execution roster, explain it briefly, and wait for approval before spawning.

## 1. Preserve outcome ownership

A workstream owner keeps the bounded outcome through investigation, implementation, retries, and local verification.

- The model that proves a root cause normally patches it too.
- Do not hand work from an investigator to a builder merely because the phase changed from diagnosis to implementation.
- Hand off only when the remaining work is a clean, substantial outcome that can be specified without the original investigation context, and the new model's advantage outweighs rereading and translation cost.
- For large repetitive rollout after a difficult diagnosis, prefer delegation under the original owner. Transfer full ownership only when the rollout is genuinely independent.

## 2. Choose by the dominant bottleneck

| Dominant bottleneck | Owner profile |
|---|---|
| Understanding people, product value, or what should be built | framing model or human dialogue before execution; usually not a standing teammate |
| Cross-stream architecture, contracts, and integration | lead-capable generalist; often the lead itself |
| Discovering and proving the correct technical change | reasoning-heavy owner |
| Executing a settled change across tools, files, and runtime | action-heavy builder owner |
| Falsifying a material implementation | fresh verifier with different blind spots |

Ask: **What part is hardest to get right, not what phase label comes first?** Give that bottleneck to the owner best suited to it, then let that owner finish the outcome.

## 3. Current roster — soft defaults

These names are replaceable mappings for the operator's current model set, not universal claims.

- **Fable 5** — optional framing and human-outcome review. Use before execution or at a rare alignment gate; do not create a standing Fable teammate by default.
- **Opus 5** — strong default lead for architecture, workstream boundaries, integration, and completion judgment. It may also own a highly coupled architectural outcome.
- **GPT-5.6 Sol** — owner when root-cause discovery, algorithmic reasoning, state transitions, invariants, performance diagnosis, or proof is the hard part. If Sol finds the cause, Sol normally implements the fix and regression test. Operator note (2026-08): Sol quota is the scarcer wallet, so reserve Sol ownership for workstreams where that loop is genuinely the bottleneck; Opus is the default owner otherwise.
- **Grok 4.6** — runs on the rubato lane (`rubato dispatch --model xai/grok-4.6`). No standing assignment; pick it by the same bottleneck test as anything else.

Useful verification defaults when an independent check is worth the cost:

- Opus-owned implementation → Sol verifier
- Sol-owned technical fix → fresh Opus or another strong different-model verifier
- Opus-owned architectural change → Sol verifier

These are defaults, not mandatory pairings. A clear low-risk task may use owner self-verification only.

## 4. Minimal roster patterns

- **One bounded technical outcome** → one owner.
- **One material or ambiguous outcome** → owner + verifier.
- **Two genuinely independent outcomes** → two owners; add a verifier only if integration risk warrants it.
- **Unclear root cause** → one Sol-like owner first; add competing hypotheses only when parallel evidence paths are genuinely separable.
- **Product or UX uncertainty** → optional Fable-like framing before the team, then the chosen lead and execution owners.

Do not create a Fable/Opus/Sol/Grok org chart just because all models are available.

## 5. What to show the user before spawn

Keep the proposal short.

```text
팀 배치안
- 프레이밍: 사용 / 기존 프레임 연결 / 생략
- Lead: <model> — <why this lead fits>
- Owner: <outcome> → <model> — <dominant bottleneck>
- Owner: <outcome> → <model> — <dominant bottleneck>   # only if needed
- Verifier: <model or none> — <why included or skipped>

이 배치로 띄울까?
```

Wait for explicit confirmation. After approval, spawn only the approved teammates and record the actual roster if a mission artifact is being used.
