---
name: model-guide
description: "서브에이전트·팀원·검증자 모델을 고를 때 읽는 라우팅 가이드. 일회성 task 자식 하나를 띄울 때도, 팀 로스터를 짤 때도 — 자식 모델을 결정하는 모든 순간에 적용."
---

# Model Guide

Choose a child's model by the work's dominant bottleneck, not by phase labels or permanent job titles. This guide has two layers: cognitive profiles that are durable across model generations, and an operational note pinned to a date that you replace when the catalog changes.

Evidence base: `/Users/wy/Github-repos/agent-taskforce/research/2026-08-20-model-cognition-column.md` — read it when revising this skill, not during a run.

## 1. Preserve outcome ownership

An owner keeps a bounded outcome through investigation, implementation, retries, and local verification.

- The model that proves a root cause normally patches it too.
- Do not hand work from an investigator to a builder merely because the phase changed from diagnosis to implementation.
- Hand off only when the remaining work is a clean, substantial outcome that can be specified without the original investigation context, and the new model's advantage outweighs rereading and translation cost.
- For large repetitive rollout after a difficult diagnosis, prefer delegation under the original owner. Transfer full ownership only when the rollout is genuinely independent.

## 2. Cognitive profiles (durable)

Frontier models are not one IQ ladder; they differ in which kind of uncertainty they handle well.

| Profile | Core loop | Strongest at | Characteristic failure |
|---|---|---|---|
| **Problem framer / human modeler** | keeps ambiguity open, models the person behind the request | UX, strategy, writing, co-defining what should be built | over-expansion, grand theories |
| **Structurer / integrator** | orients in unfamiliar environments, decomposes and integrates long work | architecture, workstream boundaries, final integration | technical elegance overriding human purpose |
| **Hypothesis converger** | problem → hypothesis → evidence → refutation → narrower hypothesis | root cause, invariants, algorithms, performance, verification | premature convergence on a wrong framing, then optimizing inside it |
| **Action converger** | goal → act → observe → fix → act → done | settled changes rolled across many files, tools, prototypes | weak at discovering goals or reframing the problem |

Route by asking: **what part is hardest to get right?**

| Dominant bottleneck | Owner profile |
|---|---|
| Understanding people, product value, or what should be built | problem framer — usually a framing step or human dialogue, not a standing teammate |
| Cross-stream architecture, contracts, integration | structurer — often the lead itself |
| Discovering and proving the correct technical change | the outcome's current owner — diagnosis is judgment, not a delegable phase (see the debugging note) |
| Executing a settled change across tools, files, runtime | action converger |
| Falsifying a material implementation | fresh verifier with a *different* profile from the writer |

Two convergers are not interchangeable: a hypothesis converger compresses the answer space, an action converger compresses the action space. A patch built by an action converger is well checked by a hypothesis converger — their failure modes rarely overlap. Neither substitutes for a framer when the variables of the problem are themselves undecided.

Debugging is the case that tempts misrouting. The diagnosis is judgment, and judgment stays with the session that owns the outcome — lead and teammate alike. Default shape: a `grok` explorer maps the terrain and gathers evidence, the owner reasons to the root cause, and execution of the settled fix routes by breadth as usual. Hand a debugging workstream to a child only when it is genuinely separable and runs parallel to other work; review it with the other model family.

## 3. Current catalog mapping (operational — verify against the live catalog)

Pinned 2026-08. Names are replaceable mappings, not universal claims. Copy exact model ids from the live catalog at spawn time, never from this file or memory.

- **Fable 5** — problem framer. Optional framing and human-outcome review before execution or at a rare alignment gate; do not create a standing Fable teammate by default.
- **Opus 5** — structurer. Strong default lead and default owner; may own a highly coupled architectural outcome.
- **GPT-5.6 Sol** — hypothesis converger. The supervisor seat: adversarial review, independent verification, second opinion on a diagnosis the owner is stuck on. Give Sol ownership only when the proof itself is the deliverable. Operator note (2026-08): Sol quota is the scarcer wallet; Opus is the default owner.
- **Grok 4.6** — action converger. Owner when the contract is settled and breadth of execution is the hard part. A regular child like any other (`task` with a model, or `team_create` with category `grok`), not a separate CLI lane.

Verifier defaults when an independent check is worth the cost:

- Claude-family main session → Sol verifier
- Codex-family main session → fresh Opus verifier

Defaults, not mandatory pairings. A clear low-risk task may use owner self-verification only.

## 4. Minimal shapes

- One bounded technical outcome → one owner.
- One material or ambiguous outcome → owner + verifier.
- Two genuinely independent outcomes → two owners; verifier only if integration risk warrants.
- Unclear root cause → the owner diagnoses from a `grok` map; only a genuinely separable, parallel debugging workstream gets a child owner, and that owner is Opus.
- Product or UX uncertainty → framing before execution, then the chosen owners.

Do not build a four-model org chart just because all models are available.

## Scope

This skill owns model-to-work routing only. Team governance — roster approval, mission, contracts, completion — belongs to Skill(agent-taskforce). Brief-writing belongs to Skill(dispatching). Prompt structure and effort selection belong to claude-prompting-lab.
