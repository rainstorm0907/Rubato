# rubato-pi verification

Implementation session cut. Candidate C is still the active branch. No promotion to B or A.

## Structure

- `harness/rubato-pi/` — isolated pin, launcher, lead overlay, adapter, tests
- `harness/scripts/rubato-pi.sh` — Node 24+ picker, does not change the shell default
- live adapter: `~/.agents/skills/agent-taskforce/runtimes/pi.md` (snapshotted to `skills/agent-taskforce/runtimes/pi.md`)

Pin: `omo-ai@5.0.0-0.beta.15` + Senpi `2026.8.21-3`. Node used for tests: `v24.18.0`.

## Gates

| gate | verdict | evidence |
|---|---|---|
| 4 child inheritance | PASS with designed child profile | task child keeps both `-e` files; DAG child drops the first (`lead-overlay`) and keeps the adapter, which composes ON 5 without `task`. Probe notes in `rubato-pi-probe.md`. |
| 5 component policy | PASS via compose filter, FAIL via CLI flags | `--omo-senpi-*-disabled` accepted, no surface change. Filtered `omoSenpiComponents` removes memory commands (43 → 29). |
| 3 verifier write | OFF by user decision | Write/edit/bash are not blocked. Role contract no longer tells the verifier to stay read-only. |
| 6 member board | PASS unit | Adapter registers `task_list`/`task_get`/`task_update` on a valid member identity. Claim race, blocked-by, cross-owner, and metadata persist in `test/unit/member-board.test.mjs`. |
| 1 nested delegation | PASS surface | `SENPI_TASK_MEMBER` set: lead overlay skips task, adapter restores it. `tasks`/`dag`/`task-kill` return on the command surface. Full member→child lifecycle against a live model was not run. |
| 2 role contract | PASS unit + hook | `before_agent_start` appends the contract every turn. Compaction survival is by re-injection, not by session persistence. |

## Tests

```
cd harness/rubato-pi
npm test                 # 21 unit
npm run test:integration # 6 integration
npm run smoke:local      # pin + Node 24
npm run smoke:real       # skipped unless RUBATO_PI_REAL_SMOKE=1
```

Last run: unit + 8 integration pass (omo-reattach 4/4 in this cut). Local smoke ok.

Real smoke (`test/smoke/real.mjs`, isolated HOME, OpenAI completions, no `~/.omo` reuse):
- lead `smoke/gpt-4.1-nano` → `RUBATO_PI_LEAD_OK`
- owner `smoke/gpt-4o-mini` → `RUBATO_PI_OWNER_OK`
- verifier `smoke/gpt-4.1-nano` → `RUBATO_PI_VERIFIER_OK`
Owner and verifier used different model ids. Evidence: `harness/rubato-pi/tmp/real-smoke.json`.

Mailbox exactly-once and inject/commit crash are locked in `src/mailbox.mjs` against the pin's inbox/reserved/processed names. A mock OpenAI turn through lead+adapter completed with zero `flatten` cache lines.

## Surfaces

- Lead: ON 6 (task + memory present), no OMO skill bundle
- DAG child profile (adapter only): memory ON, task OFF
- Member (`SENPI_TASK_MEMBER` set): task commands restored
- `/approve-spawn` present; spawn tools blocked until that or `RUBATO_PI_ALLOW_SPAWN=1`

## Not done

- `.zshrc` alias: added `rubato-pi` only; existing `omo`/`rubato` lines unchanged. Backup `~/.zshrc.bak-rubato-pi-20260822-062047`.
- crash/reload of an OMO-managed process child: PASS in `test/integration/omo-reattach.test.mjs` (same task id after parent kill+restart, not lost, spawn prompt not replayed). Needs `default_execution_mode: process` in omo.jsonc.
- mailbox kill inside the live OMO injector: reserved file survives a lead restart and is reclaimed once (`test/integration/mailbox-live.test.mjs`)
- background dreaming child: RPC lead registers `/dream` but does not spawn a dreaming child (`tmp/dreaming.json`)
- compaction-during-complete buffering: pin routes compacting → buffer; live RPC with a tiny context window fails the prompt instead of dropping it silently (`test/integration/compaction.test.mjs`)

## Untouched

- `harness/fx` still dirty at the pre-session `app_input_runtime.zig` +3; this session did not edit it
- existing `omo` and `rubato` aliases unchanged
- no commit

## Next cut

1. Kill an OMO-managed process child mid-run and assert reattach, not prompt replay
2. Mailbox inject/commit crash inside the live injector
3. Compaction-during-complete buffering
4. Alias after that
