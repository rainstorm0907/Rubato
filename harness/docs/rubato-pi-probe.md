# rubato-pi pin and surface probe

Pin used: isolated `harness/rubato-pi` with Node `v24.18.0` (`~/.nvm/versions/node/v24.18.0`), `omo-ai@5.0.0-0.beta.15`, Senpi `2026.8.21-3`. Default shell Node `v26.5.0` was not changed. Global `omo-ai@5.0.0-0.beta.7` was not used.

Reproduce:

```bash
NODE="$HOME/.nvm/versions/node/v24.18.0/bin/node"
cd harness/rubato-pi
"$NODE" scripts/probe-surface.mjs bare
"$NODE" scripts/probe-surface.mjs file
"$NODE" scripts/probe-surface.mjs dir
RUBATO_PI_LINK_AGENTS=1 "$NODE" scripts/probe-surface.mjs file
"$NODE" scripts/probe-surface.mjs file --omo-senpi-memory-disabled
"$NODE" scripts/probe-surface.mjs custom tmp/astgrep-only-wrapper.mjs
```

## Surface (lead process)

| load | extension commands | skills | notes |
|---|---:|---:|---|
| bare, isolated HOME | 26 | 0 | no `~/.agents` |
| file `-e omo.js`, isolated HOME | 43 | 0 | +17 OMO commands, `_ast_grep` MCP |
| dir `-e plugin/`, isolated HOME | 43 | 24 | +24 OMO skills |
| bare + real `~/.agents` | 26 | 25 | user/Taskforce skills only |
| file + real `~/.agents` | 43 | 25 | same 25, no OMO skills added |
| dir + real `~/.agents` | 43 | 49 | 25 user + 24 OMO |

File-unit `-e` still excludes the OMO skill bundle on this pin. User skills stay if `~/.agents` is visible. Isolated HOME hid them, which is why a probe must symlink `~/.agents` rather than reuse the live `~/.omo` tree.

OMO skills on dir load (24): design catalog 22 plus `dag-library` and `mass-ulw`.

## Gate 5

CLI `--omo-senpi-memory-disabled`, `--omo-senpi-disabled`, and `--omo-senpi-native-badge-disabled` are accepted (not `Unknown option`) and leave the 43-command file surface unchanged. Memory commands stay.

Cause in Senpi `applyExtensionFlagValues`: flag values are written after the extension factory has already called `getFlag` and registered components. This is the same failure mode the design saw on beta.7, now confirmed on beta.15.

Working alternative, no OMO fork: import `composeOmoSenpiExtension` + `omoSenpiComponents` from the pinned `omo.js` and compose a filtered list.

| wrapper | extension commands | memory commands | MCP |
|---|---:|---|---|
| ON 6 including memory | 43 | present | `_ast_grep` |
| ON 5, memory omitted | 29 | gone | `_ast_grep` |
| `ast-grep` only | 26 | gone | `_ast_grep` |

Component names on this pin (18): `config-startup`, `native-badge`, `onboarding`, `init-deep-advisor`, `telemetry`, `ultrawork`, `mass-ulw`, `start-work-continuation`, `ulw-loop`, `todo-fanout-reminder`, `git-master-attribution`, `fallback-architect`, `comment-checker`, `ast-grep`, `lsp`, `task`, `memory`, `config-watch`.

`git-master` in the design table is `git-master-attribution` in the bundle.

## Gate 4

Pin `omo-task.js` still builds child argv as `--no-extensions` plus inherited `--extension` entries. DAG-owned children use `extensions.slice(1)`.

Runtime (parent `-e omo.js -e dump -e trigger`, then the same builder):

- task child argv keeps all three extensions
- DAG child argv drops `omo.js` and keeps the rest

Disable flags are not on argv, so they cannot inherit. Policy has to travel as an inherited `-e` file. That is why lead overlay is first and the adapter is second: DAG children lose the first file and keep the adapter, which composes the five non-task components.

This is not a promotion. `-e` inheritance works. Stay on candidate C.

## Launcher now

`harness/scripts/rubato-pi.sh` and `harness/rubato-pi/bin/rubato-pi.mjs` spawn pinned Senpi with lead overlay then adapter, Node 24+, state under `.rubato-pi`. Existing `omo`/`rubato` aliases are unchanged. `~/.zshrc` is not edited yet.
