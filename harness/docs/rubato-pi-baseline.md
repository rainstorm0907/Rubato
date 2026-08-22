# rubato-pi baseline snapshot

Recorded at start of the implementation session. Not a gate verdict.

## Git

- repo HEAD: `83564c9` (`main` ahead of `origin/main` by 1)
- untracked design artifacts: `harness/docs/rubato-pi-design.html`, `harness/docs/rubato-pi-design.md`, `harness/docs/rubato-pi-implementation-brief.md`
- `harness/fx` submodule HEAD: `c934f81`
- `harness/fx` dirty (off-limits): `src/core/app/app_input_runtime.zig` (+3). Do not touch.

## Runtime already on this machine

- default shell Node: `/opt/homebrew/bin/node` `v26.5.0` (must not be permanently changed)
- selected Node 24 for rubato-pi: `~/.nvm/versions/node/v24.18.0` (`v24.18.0`)
- global `omo-ai`: `5.0.0-0.beta.7` with Senpi `2026.8.12-4` at `/opt/homebrew/lib/node_modules/omo-ai`
- existing aliases in `~/.zshrc`: `omo` → `/opt/homebrew/bin/omo`, `rubato` → `harness/scripts/rubato.sh`
- `harness/rubato-pi` did not exist at session start

## Binding reminders

- pin: `omo-ai@5.0.0-0.beta.15` + Senpi `2026.8.21-3`
- do not use the global OMO launcher or mutate `~/.omo` / `~/.senpi`
- gate order: 4 → 5 → 3 → 6 → 1 → 2
