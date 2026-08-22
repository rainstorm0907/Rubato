# Team Overlay 진행 상태

2026-08-20. 재개할 사람이 이 문서만 읽고 이어갈 수 있도록 쓴다. 설계 결정은 `team-overlay-v1.1-decisions.md`, 착수 전 리뷰는 `team-overlay-v1-review.md`에 있다.

## 어디까지 됐나

포크: `vercel-labs/fx` → `keepitmello/rubato-harness`, 브랜치 `feat/team-overlay`. 착수는 upstream/main `a0f73b4`(v0.0.3) 기준이었고 이후 v0.0.4를 머지했다. 이 레포의 `harness/fx` submodule로 들어와 있다(`57a8e9c`). 빌드는 zig 0.16.0.

| 단계 | 커밋 | 상태 |
|---|---|---|
| A — `team` tool + `members` | `dea44f4` | 완료, 실바이너리 검증 |
| B — 메시지 authorization/execution 분리 | `650d304` | 완료, 기존 동작 무변경 |
| C — `team.message` + 잠든 리드 알림 | `86eba06` | 코드 완료, 일부 검증 남음 |
| D — 스킬 어댑터 (`runtimes/fx.md`) | `7375a70` | 완료 |

`zig build`, `zig fmt --check src/`, `zig build test` 전부 통과 (C 커밋 시점).

bridge 쪽은 이 레포에 별도 커밋: `91a37e3`(툴 호출 finish reason 수정), `13ed796`(착수 문서).

## 실제 바이너리로 확인한 것

~~`fx ask`에는 subagent host가 없어 `team`도 `subagent`도 광고되지 않는다. 반드시 대화형이어야 한다.~~
**2026-08-21 정정 — 틀렸다. `fx ask`에서도 광고된다.**

```
$ FX_MODEL=xai/grok-4.6 fx ask --yolo --json -- '제공된 도구 이름을 전부 나열해라'
{"output":"read_file\n...\nterminal\nsubagent\nteam\nteam_task\nskill\n...","exit_code":0,...}
```

소스가 처음부터 그렇게 배선돼 있다 — `src/core/cli/cli_ask.zig:825`의 `initializeSessionStores()`가
`subagent_host`를 무조건 만들고, `:1510`이 `.subagent_available = ctx.subagent_host != null`로 넘기며,
`src/core/tooling/tool_advertisement.zig:912-915`는 그 값이 거짓일 때만 셋을 뺀다.
`git log -S`로 보면 upstream **Initial commit**부터 있던 배선이고 우리 포크가 넣은 것이 아니다.

원래 관측이 왜 반대로 나왔는지는 확정하지 못했다. `--no-save`(세션 스토어 초기화 실패)였을 가능성이 있다.

**따라서 팀 런에 tmux가 필요 없다.** 아래 tmux 방식은 v1 검증 당시 쓴 것으로 기록만 남긴다 —
새로 돌릴 때는 `fx ask --yolo --json`으로 스크립트화하라. capture-pane 파싱이 통째로 사라진다.

```bash
# v1 검증 당시 방식 (지금은 불필요)
tmux new-session -d -s fxc -x 220 -y 50 "cd /Users/wy/Github-repos/agent-taskforce/harness/fx && ./zig-out/bin/fx"
tmux send-keys -t fxc "<프롬프트>" Enter
tmux capture-pane -t fxc -p -S -150
```

- `team.members`가 리드 id와 팀원 목록을 돌려준다. persistent child를 만들면 저장 없이 즉시 나타난다
- 팀원 둘(alice, bob)을 만들고 리드→alice `team.message`가 `{"ok":true,"source_id":<lead>,"target_id":<alice>}`를 반환
- alice→bob 메시지가 실제로 도착했다. bob의 `subagent/control.json`에 들어간 work item이 결정적이다:
  - `source_id`가 alice다 (리드가 아니다) — 리드를 경유하지 않는다
  - `root_user_intent_context`가 **빈 문자열**이다. 리드가 준 첫 work item은 채워져 있다 — peer 메시지가 root user 권한을 물려받지 않는다는 설계서 §13이 구조로 지켜진다
- 반대 방향도 확인했다. bob→alice로 `REPLY-FROM-BOB`을 보내자 alice의 work item에 `source_id`가 bob으로 찍혔다. 설계서 §11의 "A → B, B result → A"가 실제로 작동하며 결과가 리드로 흘러가지 않는다
- 팀원→리드도 확인했다. bob이 `to`를 예약어 `lead`로 보낸 메시지를 리드가 받았다("Yes — bob sent me URGENT-FROM-BOB"). 리드는 그 사이 스스로 깨어나지 않았고 다음 사용자 턴에 내용이 주입됐다 — 설계서 §11이 요구한 동작 그대로다

- **스킬 연결까지 한 줄로 이어진다.** fx는 `~/.agents/skills`를 글로벌 루트로 읽는다(`src/builtins/skills.zig`의 `global_roots`) — 우리 정본 위치 그대로다. fx 세션에서 `agent-taskforce`를 로드하자 스스로 fx 어댑터로 라우팅해 "승인된 팀원은 root의 direct persistent child이고 등록 절차가 없다, peer 메시지는 `team.message`"를 정확히 읽었다

## 남은 검증 (다음에 할 것)

1. **알림이 실제로 울리는 것은 아직 못 봤다.** 배달은 확인됐다 — bob이 `to: lead`로 보낸 메시지를 리드가 받았고, 리드가 스스로 깨어나지 않고 다음 사용자 턴에 주입되는 설계서 §11 동작 그대로였다. 다만 `attention_required`는 **기본값이 꺼져 있고**(`config_runtime.zig:3189`) 사용자 `~/.fx/settings.json`에도 설정이 없어서, 알림이 안 뜬 것이 정상 동작인지 미발동인지 가리지 못했다. 확인하려면 `settings.json`에 `{"notifications":{"attention_required":true}}`를 넣고 fx를 다시 띄운 뒤 재현한다. 알림이 terminal bell이면 `tmux capture-pane`에는 안 잡히니 `tests/e2e/notifications.test.ts`의 검증 방식을 따르는 편이 낫다
3. 설계서 §24의 Isolation·Recovery 항목 중 재시작 후 생존

## 위임 경로 주의 (실측)

- **meight는 쓸 수 있다. `meight status`를 믿지 마라** — 2026-08-20 착수일에 "dispatch가 세션 등록도 못 한다"고 적었던 것은 오판이었다. 같은 날 fx 포팅에 디스패치해 보니 워커는 정상으로 떴고(`started worker ... model=grok effort=high`) 실제로 소스를 고치고 있었는데, 그 내내 `meight status`는 `(no workers)`를, `meight status <name>`은 `no status for worker`를 반환했다. registry 쪽이 갱신되지 않는 것이지 워커가 없는 것이 아니다.
- **셸 타임아웃은 워커의 죽음이 아니다.** `dispatch`의 기본 `--timeout 1800`이 지나면 셸이 exit 1로 끝나지만 워커는 계속 돈다. 같은 `dispatch <name> --mode ...`를 다시 실행하면 재부착해 통지를 다시 만든다. 긴 작업은 `--timeout`을 미리 늘려라.
- **워커 생사 판정 순서**: ① 백그라운드 출력 파일의 `started worker` 줄과 `files:N` heartbeat ② **대상 레포의 `git status --short` / `git diff --stat` / 파일 mtime — 이게 최종 심급이다** ③ `meight status`는 참고만. heartbeat의 `files:0`도 단독으로는 실패 신호가 아니다. fx처럼 파일이 거대한 레포(`manager.zig` 11,951줄, `tool_runtime.zig` 9,590줄)에서는 오리엔테이션에만 25분 넘게 걸린다
- **fx에 위임하는 브리프에는 `file:line` 앵커 대신 코드 발췌를 넣어라.** 앵커만 주면 워커가 거대 파일을 통째로 읽는다. 그리고 앵커 자체가 틀릴 수 있다 — 조사 서브에이전트가 준 `src/core/subagent/session_child_store.zig`는 없는 경로였고 실제는 `src/core/session/session_child_store.zig`였다. 브리프에 넣기 전에 리드가 경로 존재를 검증한다
- **grok CLI는 새 세션만 쓴다.** 새로 시작하면 잘 돈다:
  ```bash
  command grok --prompt-file <brief.md> --cwd <repo> \
    --output-format streaming-json --permission-mode bypassPermissions \
    --reasoning-effort high > out.ndjson
  ```
  `--output-format json`은 끝날 때 한 번에 쓰므로 진행이 안 보인다. streaming을 써라
- **`--resume`은 headless에서 작동하지 않는다.** 붙기는 하는데 아무것도 하지 않고 멈춘다 (5시간 동안 CPU 5초, 출력 0바이트로 실측). 중단된 세션을 이어가려면 새 세션에 상태를 브리프로 인계해라
- git identity가 셸에 안 잡히면 `git config user.name/user.email`을 레포에 설정해야 커밋된다

## 검증용 모델

인증은 `AI_GATEWAY_API_KEY` 경유(127.0.0.1:8788 bridge → OpenCodex 10100). 응답 확인된 것: `xai/grok-4.6`, `cursor/gpt-5.6-sol`, `cursor/claude-opus-5`, `cursor/gemini-3.7-flash`, `cursor/composer-2.5`. `cursor/` 접두 없는 `gpt-5.6-*`는 HTTP 400으로 죽는다. child는 싼 것을 써라.
