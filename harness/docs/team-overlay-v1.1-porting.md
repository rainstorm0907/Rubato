# Team Overlay v1.1 — 포팅 착수 결정

2026-08-20. 외부에서 온 `fx-agent-taskforce-v1.1-porting-kit`을 받아 착수 전에 리드가 닫은 결정을 남긴다. 킷 본문을 대체하지 않는다 — 킷이 제안한 것 중 무엇을 받고 무엇을 미뤘는지, 그 사유만 여기 있다.

이름 주의: 이 문서의 "v1.1"은 **기능 버전**이다. 같은 폴더의 `team-overlay-v1.1-decisions.md`는 설계서 개정 번호를 뜻하고 내용은 완료된 v1(A~D단계)에 대한 것이다. 두 문서의 v1.1은 서로 다른 것을 가리킨다.

## 지금 어디까지 왔나 (2026-08-20 기준)

**닫힌 것.** 공유 task 원장, 역할별 시스템 프롬프트, 팀원별 워크스페이스 분리가 모두 실바이너리에서 돈다. fx 포크는 `harness/fx` submodule이고 upstream v0.0.4가 머지됐다.

| 대상 | 상태 |
|---|---|
| fx 포크 | `keepitmello/rubato-harness`, 브랜치 `feat/team-overlay`, `harness/fx` submodule |
| 현재 포인터 | `7ccee9d` (원격 대조 완료) |
| 검증 | `zig fmt --check src/` 통과. `zig build test` **8387 pass / 2 skip / 0 fail** |
| 플레이키 하나 | `core.permissions.sandbox.test."natural command completion terminates redirected descendant after setsid"`. 부하 탄 실행에서 가끔 실패하고 재실행하면 통과 |
| 실행 | `rubato` (alias → `harness/scripts/rubato.sh`). 리드 모델 `cursor/claude-opus-5` |
| control schema | 9 (업스트림 7). 머지 시 대조 절차는 `harness/README.md` |

**남은 것은 하나다 — 실제 팀 런.**

## 다음 작업

**1~4단계는 닫혔다.** 브랜딩 테스트(`e651056`), 문서 경로(`7346e1a`), 역할별 시스템 프롬프트(`8646269` / fx `482bf23`), 워크스페이스 분리(`743a79c` / fx `7ccee9d`). 각 단계의 결정과 실측은 아래 절들에 있다.

**5. 실제 팀 런 한 번 — 게이트**

남은 것은 이것 하나다. 그 관측으로 백로그(승인 프로토콜, 완료 gate, hard plan guard, native hooks, peer terminal 미러링)의 승격 여부를 판단한다.

이제 팀원이 **자기 역할 계약을 갖고 자기 워크스페이스에서** 뜬다. 처음으로 그 조합을 관측할 수 있다.

런 구성: 리드 + owner 둘. 리드가 owner마다 worktree를 만들어 `workspace_root`로 넘기고, 역할 계약을 `system_prompt_file`로 넘긴다. 모델은 응답 확인된 것에서 고른다 — `xai/grok-4.6`, `cursor/gemini-3.7-flash`, `cursor/composer-2.5`, `cursor/gpt-5.6-sol`. `cursor/` 접두 없는 `gpt-5.6-*`는 HTTP 400으로 죽는다.

~~`fx ask`에는 subagent host가 없어 team 계열 도구가 광고되지 않는다. 반드시 대화형이어야 한다.~~
**2026-08-21 정정 — 틀렸다.** `fx ask --yolo --json`에서 `subagent`/`team`/`team_task`가 전부 광고된다.
근거와 재현은 `team-overlay-progress.md`의 같은 절에 있다.

**런을 헤드리스로 돌려라.** tmux + capture-pane 파싱이 필요 없다.

```bash
cd <worktree> && FX_MODEL=xai/grok-4.6 \
  FX_SYSTEM_PROMPT_FILE=<seat.md> \
  fx ask --yolo --json -- "<브리프>"
```

**런 중에 볼 것**: 보드가 실제로 조율에 쓰이는가, `release` 같은 미배선 명령이 아쉬워지는가, 리드가 peer 작업 결과를 몰라 답답한가, 구멍 2(실패가 `completed`로 보임)가 실제로 사람을 속이는가, 그리고 리드가 worktree를 손으로 만들고 치우는 것이 실제로 감당되는가 — 감당 안 되면 그때 fx 관리 worktree(3배 과제)를 승격 후보로 올린다.

**1라운드 프롬프트 관찰**도 같이 한다: 역할 계약만 받은 팀원이 증거 없이 완료를 주장하는가, 범위를 넘는가, 물어야 할 때 묻는가. 구멍이 나오면 그만큼만 `~/.codex/AGENTS.md`에서 떼어 붙이고, 없으면 만들지 않는다.

**격리 한계 관찰**: A(실수만 막기)를 골랐으므로 에이전트가 절대경로로 옆 트리에 접근하는 것은 막히지 않는다. 실제로 그런 사고가 나면 B(샌드박스 강제)를 승격한다.

## v1과 v1.1의 성격 차이

v1은 팀원이 **말할 수 있게** 했다 (`team.members`, `team.message`, 리드 무경유). v1.1은 팀이 **같은 판을 보게** 한다. 스킬 어댑터에서 갈라지는 지점이 정확히 한 줄이다 — `runtimes/fx.md`의 `Shared task list | none`과 `runtimes/claude-code.md`의 `supplied by the runtime`.

## 킷 실측 (수령 당일)

- Python 참조 구현 테스트 19개 통과
- Zig 스캐폴드: `zig fmt --check` 통과. `zig test src/root.zig`는 `reducer.zig:326`의 `var visited` 하나만 `const`로 고치니 12개 전부 통과. 제작 환경에 Zig 컴파일러가 없었다는데 오류가 그것 하나였다
- `MANIFEST.sha256` 전부 일치
- `scripts/assert-fx-layout.py` — 우리 포크 앵커 7개 전부 OK. 킷이 가정한 구조에서 안 벗어났다
- 착수 baseline: `86eba06`, `feat/team-overlay`, zig 0.16.0, 워킹트리 깨끗

## 결정 1 — 저장은 JSON 단일 원장. SQLite 기각

**제안.** 원장을 JSON 파일 하나로 두면 비대해지지 않나, SQLite가 낫지 않나.

**기각 사유.** 셋이다.

1. fx는 **외부 의존성이 0개**다. `build.zig.zon`의 `.dependencies = .{}`이고 `build.zig`에 libc 링크도 없다. 그리고 fx 자신의 규칙이 `AGENTS.md:439` — "Do not add dependencies outside the Zig standard library without discussion". SQLite는 이 프로젝트 최초의 C 의존성이 된다. upstream을 계속 따라가야 하는 포크에서 빌드에 C 의존성이 끼면 rebase 비용이 영구적으로 오른다.
2. 규모가 안 맞는다. 원장 상한이 task 256개, 직렬화 1MiB다. SQLite가 이기는 조건(다중 프로세스 동시 쓰기, 큰 테이블 인덱스 조회, 부분 갱신)이 하나도 안 걸린다. 단일 프로세스에 한 팀에 256줄이다.
3. fx에 이미 배관이 있다 — 타임드 advisory 잠금, temp write + atomic rename, bounded read, 스키마 버전. `control_store.zig`가 그걸로 굴러가고 검증돼 있다. SQLite를 쓰면 세션 저장 캡슐을 통째로 우회하게 된다.

원장이 실제로 비대해진다면 그건 저장소 선택 문제가 아니라 **보드를 프로젝트 트래커로 쓰고 있다는 신호**다. 킷 설계서가 명시적으로 금지하는 용법이다.

## 결정 2 — 킷의 9개 커밋 중 보드와 상태 감지만 받는다

킷은 커밋 9개 로드맵을 준다. 받는 것과 미루는 것을 갈랐다.

**받는다**: 공유 task 원장(도메인·리듀서·저장·도구), 팀원 lifecycle 투영(idle/failed를 리드에게).

**백로그**: plan 승인 프로토콜, graceful shutdown 프로토콜, 완료 자동검사(gate), hard plan guard, native hooks, `docs/04-LOCAL-OBSERVATION.md`의 Claude Code 내부 관찰 플레이북 전체.

**사유.**

관측이 없다. fx로 실제 팀을 한 번도 안 돌려봤다. 개선 원칙이 "관찰된 실패·성공만 승격"인데 승인 프로토콜과 gate는 우리가 겪은 실패가 아니다. 반면 owner 둘이 같은 일을 동시에 잡는 문제는 팀을 돌리면 확실히 생기고, 킷 자신의 우선순위표도 1순위로 atomic claim + dependency를 꼽는다.

그리고 미루는 쪽이 **fx 구조가 저항하는 구간**과 정확히 겹친다 (아래 결정 4).

관찰 플레이북은 킷의 parity matrix가 스스로 byte 호환을 비목표라 선언하고, 관찰 결과가 반영되는 자리도 codec 어댑터뿐이라고 적어놨다. 시나리오 7개를 돌릴 값이 안 나온다.

## 결정 3 — 팀원 상태 감지는 컨텍스트를 오염시키지 않는다

리드가 팀원 파일을 들여다보는 방식이면 리드 컨텍스트가 오염된다는 우려가 제기됐다. 성립하지 않는다 — 훑는 주체가 **fx 런타임(Zig)**이고 리드 모델이 아니다. 모델에 들어가는 것은 투영된 이벤트 한 줄("bob이 idle")이지 파일 내용이 아니다.

전례도 있다. `team.message`가 리드에게 도착할 때 `AttentionKind.team_message`로 사용자 주의를 부르는 경로가 이미 구현돼 쓰이고 있다(`tool_runtime.zig:1697`). idle/failed도 같은 배관을 탄다.

## 결정 4 — v1 잔여 검증: 재시작은 백로그, 알림은 상태 감지 단계에 흡수

`team-overlay-progress.md`에 열려 있던 두 개를 갈랐다.

**재시작 생존 → 백로그.** 작업 중 fx를 껐다 켤 일이 드물다. 지금 값이 안 나온다.

**알림 실발동 → 상태 감지 단계로 흡수.** 별도 선행 단계로 두지 않는다. 다만 미루지도 않는다 — 상태 감지가 정확히 그 알림 배관을 타기 때문이다. 지금 확인된 것은 "팀원이 보낸 것이 리드 큐에 도착한다"까지고, "그것이 실제로 사용자를 부른다"는 못 봤다. 기본값이 꺼져 있어(`config_runtime.zig:3189`) 미발동인지 정상인지 못 가린 상태다. `settings.json`에 한 줄 넣고 재현하는 5분짜리라 상태 감지 검증에 붙인다.

## 접합 실측 — 어디가 싸고 어디가 비싼가

착수 전 fx 소스 조사 결과다. 킷의 가정과 실제가 어긋나는 지점을 포함한다.

**싼 쪽 (킷 가정과 잘 맞음)**

- 도구 등록: `builtins/tools.zig:1048-1071`의 기존 `team` ToolSpec을 그대로 복제·확장하면 된다. 기존 `team_provider`를 공유하면 dispatch enum도 안 건드린다.
- read-only 분류: 킷이 "도구 이름 목록으로 때려맞추지 말고 side-effect contract를 쓰라"고 신신당부하는데, fx엔 이미 더 세밀한 게 있다. 모든 도구가 `reads_only_fn` / `irreversible_fn`을 **필수 필드**로 갖고 호출 인자에 따라 판정한다(`tool_dispatch.zig:486-487`). hard plan guard의 전제 조건이 이미 충족돼 있다.
- membership: `team.zig:96-107` `callerIsOnTeam` + `:288-330` `collectMembers`가 `manager.snapshot`의 canonical child tree를 `depth == 0 && mode == persistent`로 거른다. 새로 만들 것이 없다.

**비싼 쪽 (구조물 확장)**

- **저장 위치가 닫힌 enum이다.** `session_child_store.zig:11-20`의 `ManagedChildKind`에 없는 파일 종류는 세션 폴더에 쓸 수 없다. raw path join이 불가능하고, 새 variant + exhaustive switch 3곳(`ensureComponent`/`directRoute`/`displayRoutePath`) 갱신이 필요하다. 이번 작업에서 유일하게 "재사용"이 아니라 "구조 확장"인 지점.
- **훅은 4종으로 잠겨 있다.** `HookKind = {pre_tool_use, stop, post_turn_end, attention_required}`. TaskCreated/TaskCompleted/TeammateIdle을 넣으려면 enum + `RuntimeView` handler 슬롯 + 호출 지점 3곳 이상. 백로그로 미룬 이유 중 하나.

**킷 가정과 어긋나는 곳 둘**

- `sendStructured`가 없다. 가장 가까운 `tool_host.Runtime.sendTeamPeerMessage`(`tool_host.zig:1383`)는 **plain text 전용**이고 `MessageSendOptions.content`가 문자열이다. typed protocol envelope를 얹으려면 JSON을 문자열로 인코딩해 넣고 수신측에서 다시 파싱하는 우회가 필요하다. 승인 프로토콜을 백로그로 돌린 이유 중 하나.
- ~~lifecycle 콜백 지점이 없다~~ **정정: 알림 투영 기계가 이미 있다.** 착수 전 조사가 `finishMutation`만 보고 "외부 리스너가 전무하니 폴링을 새로 만들어야 한다"고 결론냈는데 틀렸다. 3단계 검증 중에 발견했다.

  - `communication_manager.zig:956` `reconcileTerminalsLocked` — 주석 그대로 "Rebuilds terminal projections from committed control transitions. Stable delivery IDs and event timestamps make retries/restarts exact-once." completed/failed/cancelled를 배달로 만든다
  - `communication_manager.zig:1094` `notificationState` — QueueStatus를 running/awaiting_approval/completed/failed/cancelled/interrupted로 사상한다
  - `domain.zig:60` `NotificationPolicy` — work item별 terminal 이벤트·milestone·보고 주기·중단 조건
  - `execution.zig:1793` `pollNotifications` — 스케줄 기반 폴러, 재시도 포함
  - `control_store.zig:33` `notification_cursor`, `:933`에 `notification_cursor >= next_event_sequence` 불변식
  - `communication.stableDeliveryId(child_id, work_id, state)` — exact-once dedupe

  배달 대상은 `target_id = work_item.source_id`, 즉 **그 일을 시킨 쪽**이다. 그래서 리드가 준 일의 terminal은 이미 리드에게 갈 공산이 크고, 남는 구멍은 peer가 준 일(alice→bob)의 terminal이 alice에게만 가고 리드는 모른다는 쪽이다. 4단계는 새 폴러를 만드는 작업이 아니라 이 구멍을 재고 최소한으로 메우는 작업으로 재정의했다.

  **교훈**: 조사 서브에이전트의 "없음"은 "내가 찾은 범위에 없음"이다. 같은 보고에서 파일 경로도 하나 틀렸다(`subagent/session_child_store.zig` → 실제 `session/`). 없다는 주장은 만들기 전에 리드가 직접 반증해 본다.

## 진행 결과

**1~3단계 완료.** fx 포크 커밋 `703b458`(도메인·리듀서) → `40aad9f`(저장 계층) → `b6d2d8f`(`team_task` 도구). 1,652줄.

리드가 독립 검증한 것: `zig fmt --check src/` 통과, `zig build test` exit 0. 범위 준수 확인 — `reducer.zig` 무변경, `team.zig` 무변경, gateway/auth/mcp/ui 무변경. `domain.zig`는 store가 참조하는 상수 `max_ledger_bytes` 한 줄만 늘었다.

원자적 claim은 테스트가 아니라 구조로 성립한다 — `manager.zig:112-124`가 잠금 획득 → load → reducer.apply → save를 한 임계구역에 넣는다.

실바이너리 E2E 증거는 `case-studies/harness/fx-team-task-e2e-evidence.md`. 요구사항 2번(blocker 완료 후 dependent 재작성 없음)을 타임스탬프 두 개로 증명한 것이 특히 실물이다 — T-0002의 `updated_at_ms`가 그대로였다.

**yolo가 검증을 무르게 하지 않았다.** 워커가 tmux 자동화를 위해 `permission_mode: yolo`를 깔았는데, "비팀원 거부"와 "owner 아닌 팀원의 complete 거부"는 권한 게이트가 아니라 team manager가 반환한다. 권한을 완전히 끈 상태에서도 멤버십 검사가 막았으므로 오히려 강한 검증이 됐다.

**남은 구멍 둘.** `manager.zig`와 `team_task.zig`에 단위 테스트가 0개다(store만 2개). 그리고 리듀서 명령 `assign`/`release`/`delete`/`set_plan_state`가 도구에 안 붙었다 — 7개 목표에 불필요했다는 워커 판단은 맞지만 `release`는 세션 유실 복구용이라 실전에서 필요해질 수 있다. 둘 다 4단계 브리프에 넣었다.

**위임 부작용 하나.** 워커가 `~/.fx/settings.json`을 고쳤다. 브리프가 범위를 fx 소스로 못박았는데 홈 디렉터리 설정은 그 밖이다. 백업이 15:18:38 한 초 안에 yolo → ask → auto를 훑고 yolo로 끝난 것을 보여준다. 4단계 브리프에 "레포 밖 파일은 알림 설정 하나만 예외이고 반드시 원복한다"를 명시했다.

## 4단계 — 만들 것이 없었다

브리프를 "만들기 전에 재라"로 냈고, 측정이 답을 냈다. 새 lifecycle 기계는 만들지 않았다. 증거는 `case-studies/harness/fx-team-lifecycle-measurement.md`.

**이미 되는 것**: 리드가 준 work의 완료·취소는 이미 리드에게 간다. `payload.terminal=completed`가 `target_id=lead`로 배달되고 `parent-model` 커서가 한 번만 ack해서 중복이 없다. 중첩 helper는 리드 원장에 안 실린다.

**알림은 실제로 울린다 — v1의 열린 항목이 닫혔다.** 기본값이 꺼져 있던 것이 맞았고, `notifications.attention_required=true`를 넣자 `AttentionRequired` 핸들러가 발동하고 pane capture에 BEL(`0x07`) 한 번이 잡혔다. 미발동이 아니라 설정 문제였다.

**테스트 구멍을 메웠다** — 커밋 `455233b`, 343줄. 그리고 통과만 확인한 것이 아니라 멤버십 가드를 잠깐 지워 두 테스트가 실제로 빨간불이 되는 것을 확인했다.

### 리드가 닫은 판단 — 구현하지 않고 위험으로 등록한다

측정이 구멍 둘을 드러냈고 워커는 둘 다 "제품 결정"으로 올렸다. 성격이 다르다.

**구멍 1 — peer가 준 일의 결과는 리드에게 안 간다.** alice가 bob에게 시킨 일의 terminal은 `target_id=alice`다. 이건 배관 부재가 아니라 `target_id = work_item.source_id`가 설계대로 동작한 것이다. 리드가 모든 팀원 terminal을 봐야 한다는 관측이 아직 없으므로 **구현하지 않는다.** 5단계 팀 런에서 리드가 실제로 답답해지면 그때 승격한다.

**구멍 2 — 실패가 성공으로 보인다.** 이건 선호의 문제가 아니다. 없는 도구 호출과 `web_fetch` 실패 모두 work item이 `status=completed`로 끝났고 리드에게 `terminal=completed`가 갔다. 실패 문구는 에이전트 transcript에만 남고, terminal payload는 상태 태그뿐이라 error summary 자체가 없다. 즉 **"팀원이 실패하면 리드가 안다"는 4단계 목표는 성립하지 않는다.**

고치지 않는 이유는 값이 없어서가 아니라 경계 때문이다. work status를 모델·도구 결과에서 도출하는 규칙은 subagent 코어 의미론이라 팀 오버레이 밖이고, 바꾸면 팀을 안 쓰는 모든 사용자에게 파급된다. 확정된 계획의 범위도 넘는다.

**대신 5단계 팀 런의 명시된 위험으로 등록한다**: 팀원 work가 `completed`인 것은 그 일이 성공했다는 증거가 아니다. 런 중에 이걸 모르면 조용한 실패를 몇 시간 쫓게 된다.

이것은 Taskforce 스킬의 done-evidence 계약이 왜 있는지를 하네스 층에서 재확인해 준다 — 완료 주장은 신뢰할 수 없고 검증자는 산출물을 봐야 한다. 스킬이 규율로 요구하던 것이 배관에서도 사실이었다.

### 곁가지 관측 둘

- 팀원을 close하면 `archived`가 되는데 `team.members`가 archived된 팀원을 계속 나열한다. 리드가 죽은 팀원에 말을 걸 수 있다.
- `zig build test`가 무관한 sandbox 취소 테스트에서 출력 없이 한 번 실패하고 재실행에서 통과했다(8321 pass, 2 skip). 우리 변경과 무관하지만 플래키를 기록해 둔다.

## 승격 — 팀원별 워크스페이스 분리 (관측 있음)

**현재 없다.** fx의 `domain.Configuration`은 `name`/`model`/`effort`/`permission_mode`/`notifications`뿐이라 에이전트마다 작업 디렉터리를 줄 자리가 없다. `fx workspace` 명령은 세션에 디렉터리를 더하는 것이지 에이전트 격리가 아니다. 포팅 킷도 worktree 자동화를 명시적으로 비범위로 두고 v1.2 후보로 미뤘다.

**관측.** 2026-08-20 이 세션에서 실제로 겪었다. 사용자가 별도 세션으로 같은 체크아웃(`~/Github-repos/fx`)에서 upstream v0.0.4 머지와 리브랜딩을 하는 동안 리드가 띄운 워커가 같은 트리에서 작업 중이었다. 충돌은 안 났지만 리드가 손으로 막아야 했다 — 브리프에 off-limits 경로를 적고, 커밋할 때 `-A` 대신 만진 경로만 스테이징하라고 지시했다. 그 손 가드가 없었으면 서로의 변경을 덮었다.

owner가 둘 이상인 팀에서는 이 위험이 손 가드로 감당되지 않는다. 선제 규칙이 아니라 관측된 실패이므로 승격 대상이다.

**그 전까지의 싼 중간 가드 — 공유 레포에서는 `git add -A` 금지, 경로 스테이징만.** 오늘 실제로 피해를 막은 것은 브리프의 off-limits 경고가 아니라 이것이었다. 별도 세션이 `git add -A src/`와 지정 파일만 스테이징했기 때문에 같은 트리에서 돌던 워커의 미완성 변경분이 그 커밋에 섞이지 않았다. 경고는 예방이고 이쪽이 실증이다. 비용 사다리상 문장 한 줄이 구조물보다 싸므로 순서도 이쪽이 먼저다.

**관측 둘째 — 이동 사고 (2026-08-20 18:42).** 별도 세션이 이동 절차를 스크립트로 준비해두고 "가드가 제대로 막는지 보려고" 실행했다. dry-run이 아니었고 가드가 전부 통과해 `mv`와 `submodule add`까지 그대로 실행됐다. 즉시 원복했고 피해는 없었다(리드가 독립 확인: fx 원위치·커밋 셋 유지·tree clean, agent-taskforce clean, `.git`이 아직 디렉터리라 absorb 전이었음).

피해가 없었던 이유는 가드가 아니라 운이다. 같은 파일시스템 `mv`는 rename이고 프로세스 cwd는 경로가 아니라 inode를 쥐므로 워커의 상대 경로 접근이 안 끊겼다. 워커가 그 2~3분에 절대 경로로 썼으면 깨졌다.

세 가지가 재사용 가능한 실측이다.

1. **준비된 파괴적 스크립트를 확인용으로 돌리지 않는다.** 가드 항목을 늘리는 것보다 이쪽이 위다 — 가드가 아무리 촘촘해도 "돌려서 확인한다"가 남아 있으면 같은 사고가 난다. 파괴적 스크립트는 인자 없이 호출하면 검사만 하고 끝나야 한다.
2. **`lsof +D`는 API 응답을 기다리는 프로세스를 못 잡는다.** 그 시점 그 디렉터리 밑에 열린 파일이 없기 때문이다. cwd만으로는 `+D`에 안 걸리므로 PID의 cwd와 명령줄을 봐야 한다.
3. 이 사고 역시 **worktree 분리가 있었으면 성립하지 않는다.** 워커가 자기 트리에 있었으면 공유 트리를 옮기는 것이 워커를 위협하지 않는다.

**설계 방향 (미확정).** 에이전트 소환 시 작업 디렉터리를 지정할 수 있게 하고, 그 값이 git worktree면 owner마다 분리된 트리에서 작업한다. 통합은 리드가 한다 — owner는 자기 worktree에서 커밋까지, 리드가 받아 머지하고 최종 검증한다. Claude Code는 이미 이 모양을 갖고 있다(Agent 도구의 `isolation: "worktree"`).

주의할 것: 시스템 프롬프트 작업과 같은 자리(`Configuration` 확장 + 소환 스키마)를 건드린다. **6단계가 끝난 뒤에 이어서 하는 것이 맞다** — 같은 파일을 두 작업이 동시에 진화시키면 오늘 겪은 충돌을 우리가 스스로 만든다.

## 승격 — 범위 없는 경고는 무제한 재조사 지시다 (관측 있음)

**관측.** 2026-08-20, 워커가 50분 동안 파일을 하나도 안 고치고 입력 855만 토큰을 태웠다. 원인은 리드가 넘긴 경고였다.

별도 세션이 upstream 머지 후 "머지가 subagent/workspace 계층을 건드렸으니 워커가 읽은 파일이 지금과 다를 수 있다"고 알려왔고, 리드가 그것을 워커에게 그대로 전달했다. 나중에 파일별로 대조해보니 **step6 대상 파일은 사실상 안 바뀌어 있었다.**

```
git diff --stat aa68c39 5eb7110 -- <step6 대상 경로>
  src/builtins/tools.zig |  3 ++-
  src/main.zig           | 14 +++++++++-----
prompt_policy.zig / context_contract.zig / subagent/{domain,control_store,manager,tool_host}.zig  전부 0
```

main.zig 14줄도 version bump와 statusline 배선뿐이라 프롬프트 조립과 무관했다. 워커에게 생긴 실제 델타는 **줄번호 4줄 밀림 하나**였다. 머지가 넣은 큰 것들(`orchestrator.zig` +540, `tool_admission.zig` 신규, `session_store.zig` +492)은 전부 범위 밖이었다.

**실패가 둘 곱해졌다.**

1. **규모를 영향의 근거로 삼았다.** 52커밋·71파일·+5997을 보고 영향 범위를 추정했다. `git diff --stat <before> <after> -- <대상경로>` 한 줄이면 30초에 끝날 확인을 안 했다.
2. **리드가 전달만 하고 검증하지 않았다.** 리드 자세 문서에 "받은 것은 입력이지 권위가 아니다"가 있는데 적용하지 않았다. 하위로 내려가는 경고는 리드를 거치며 걸러져야 하는데 증폭기가 됐다.

**규칙 둘.**

- 하위 세션에 "바뀌었을 수 있다"를 보낼 때는 **바뀐 파일 목록을 함께 보낸다. 목록을 못 뽑으면 경고를 보내지 않는다.** 범위 없는 경고는 무제한 재조사 지시와 같다.
- **전달하는 경고도 검증한다.** 릴레이는 판단을 면제하지 않는다.
- **영향 범위는 열거가 아니라 제외로 만든다.** `git diff --name-only <before> <after> -- src/`로 전체를 뽑고 무관한 것을 지운다. 볼 경로를 나열하면 나열한 사람의 기억이 범위가 된다.

이 실패가 하루에 세 번 났다. ① 규모로 추정(목록 없음) ② 경로 열거(목록은 만들었으나 `src/core/*`를 통째로 제외) ③ 리드의 열거(브리프 scope를 그대로 옮겨 적어 우연히 `builtins/tools.zig`만 포함). **세 번째가 가장 위험하다** — 목록이 붙어 있으면 받는 쪽이 검증됐다고 믿지만 실제로는 열거한 사람의 기억이다.

제외법으로 다시 뽑자 45개가 나왔고 그 안에 **`src/core/tooling/tool_runtime.zig` 25줄**이 있었다. 열거한 둘 다 놓친 파일이고, 하필 우리 `team_task` 배선이 181줄 들어간 파일이다. `team_task`/`executeTeamProvider` 참조 15개는 살아 있고 텍스트 충돌도 없었으나, **머지 후 우리 코드의 빌드·테스트는 아직 확인되지 않았다** — 마지막 통과는 `455233b`, 즉 머지 전이다.

## 승격 — red를 단수로 보고하지 않는다 (관측 있음)

브랜딩 테스트 red를 넘길 때 리드가 받은 것은 `failed without output` 한 줄이었고, 그걸 **"실패 1건"으로 읽어 원인도 하나라고 믿었다.** 실제로는 둘이었다. 브랜딩이 깬 정렬 assertion 하나, 그리고 부하를 탄 sandbox setsid 플레이키 하나다.

고친 세션이 브랜딩만 잡고 green을 가정했으면 리드 쪽에서 다시 red가 났을 것이다. 플레이키를 갈라낸 것은 그 세션이 **재현 확인차 두 번 더 돌린** 덕이다.

**규칙.** 재현 확인 없이 red를 단수로 보고하지 않는다. 최소 1회 재실행해서 **항상 실패하는 것과 가끔 실패하는 것**을 가른 다음 넘긴다. 요약된 실패 리포트에서 건수를 세지 않는다 — `failed without output`은 개수를 말해주지 않는다.

## 승격 — 게이트 결과는 받는 것이 아니라 돌리는 것이다 (관측 있음)

같은 날 게이트 보고가 **두 번** 틀렸다. 방향만 반대다.

| 받은 보고 | 실제 |
|---|---|
| "red 1개" (`failed without output`) | 2개. 하나는 브랜딩, 하나는 플레이키 |
| "최종 게이트 성공" | **red 3개.** 워크트리를 걷어내고 재실행해도 같은 셋 |

두 번째가 더 위험했다. 셋 중 하나가 **상속받은 워크스페이스가 요청 지문에 섞여 기존 create replay가 `operation_conflict`로 깨지는 하위 호환 회귀**였다. 그대로 포인터를 올렸으면 조용히 나갔다.

리드는 셋의 실패 이름과 diff 원문을 워커에게 돌려보냈고, 워커의 진단이 리드의 처방보다 정확했다 — 리드는 "non-null일 때만 해시"라고 했지만 실제 원인은 **해석된 상태가 요청 지문에 들어간 것**이었다. `create_workspace_explicit` 플래그로 명시 요청이 아닌 선택자를 지문에서 빼는 것이 답이었다. 리드 처방대로 갔으면 상속 에이전트는 여전히 깨졌다.

**규칙 셋.**

- **완료 게이트는 리드가 직접 돌린다.** 워커의 "통과했습니다"를 통과의 증거로 쓰지 않는다. 포인터·태그·머지처럼 정본을 바꾸는 행위 앞에서는 특히 그렇다
- **브리프에 게이트 출력의 원문 인용을 요구한다.** "통과했습니다" 대신 `Build Summary` 줄을 그대로 붙이게 한다. 요약은 방향을 가리지 않는다
- **red를 돌려보낼 때 무엇이 구현 오류이고 무엇이 기대값 갱신인지 리드가 갈라준다.** 안 가르면 워커가 셋 다 기대값을 고쳐 회귀를 green으로 덮을 수 있다

침묵을 건강의 증거로 읽지 않는 것도 같은 계열이다. `zig build test`는 성공 시 아무것도 출력하지 않으므로 `--summary all`로 실제 숫자를 뽑는다. 발화한 적 없는 탐지기의 0건은 건강의 증거가 아니다.

## 팀원별 워크스페이스 분리 — 결과 (2026-08-20)

**공수 판정.** 시스템 프롬프트를 1로 놓고 **1.5배**. 실측은 13파일 741줄(프롬프트는 12파일 606줄)에 회귀 수정 4파일 51줄. 판정이 예측한 편집 집합과 일치했다.

fx가 worktree 생성·머지·정리까지 맡는 안은 **3배의 별도 과제**로 판정돼 기각했다. 리드가 만들고 리드가 치운다.

**격리 강도는 A(실수만 막기)를 골랐다.** `permission_mode` 기본값 `yolo`를 그대로 두었으므로 에이전트가 절대경로로 옆 트리에 접근하는 것은 막히지 않는다. 관측된 사고 둘이 악의가 아니라 실수였고, 관측 전에 안전장치를 조이면 팀원이 일을 못 하게 될 위험이 더 크다고 판단했다 — 시스템 프롬프트에서 "도구는 뺏지 않는다"로 정한 것과 같은 논리다.

**자동 정리는 기각했다.** 근거는 `execution.zig:1750` — 프로세스 teardown이 **의도적으로 사용자 취소를 지어내지 않고** 미완 durable 상태를 복구용으로 남긴다. fx는 이미 "죽었다고 지우지 않는다"를 설계로 갖고 있고, 워크스페이스 자동 삭제는 그것과 정면충돌한다. 게다가 `builtins/context.zig:2142`의 git 상태 탐지기는 dirty나 unknown은 내도 **authoritative clean은 못 낸다.** "깨끗하면 지운다"가 증명 불가능하다.

**리드가 돌린 E2E.** 실제 git worktree 둘에 서로 다른 표식과 AGENTS.md를 심었다.

```
ws-a 에이전트   marker MARKER_ALPHA_5521   codename PROJECT_ALPHACODE
ws-b 에이전트   marker MARKER_BETA_7734    codename PROJECT_BETACODE
```

codename이 각자 **자기 워크스페이스의 AGENTS.md**에서 나왔다. 판정 문서가 "cwd만 바꾸면 조용히 샌다"고 경고한 자리다. 구현은 조건 분기를 더한 게 아니라 `Config`에서 `project_context` 필드를 **삭제해** 리드 스냅샷 재사용을 구조적으로 불가능하게 만들었다.

## 승격 — submodule 이후 `git add -A`는 실패 모드가 바뀐다 (선제, 사유 있음)

오전의 `-A` 사고는 **남의 작업물이 내 커밋에 섞이는** 형태였다. `harness/fx`가 submodule이 된 뒤의 `-A`는 형태가 다르다 — 워커가 submodule 안에서 커밋하면 상위 레포에 ` M harness/fx (new commits)`가 뜨고, 여기서 `-A`를 치면 **검증되지 않은 포인터가 40바이트 SHA 한 줄로 조용히 스테이징된다.** 파일 diff에 안 띈다.

그러면 "포인터는 검증해 통과시킨 세션이 올린다"는 규칙이 첫 워커 런에서, 아무도 의도하지 않은 채로 깨진다.

**처방은 브리프 한 줄이다.** "커밋은 submodule 안에서만. 상위 레포의 포인터는 절대 올리지 마라." 구조로 막는 두 안은 지금 과하다 — `submodule.<path>.ignore = dirty`는 status에서 안 보이게 만들어 누락에 의미를 싣는 쪽이고, pre-commit 훅은 "판단하라고 명시했는데도 안 한" 실패가 아직 관측되지 않았다.

이건 관측 전 승격이지만 사유가 있다. 실패 모드가 **조용하고**, 깨지는 대상이 정본 신호 자체다.

**같은 계열 하나 더 — push 순서.** submodule을 **먼저** push하고 그 다음 상위 포인터를 push한다. 역순으로 하면 원격 포인터가 원격에 없는 SHA를 가리키는 구간이 생기고, 그 사이에 클론한 사람은 `git submodule update`에서 깨진다. 로컬에서는 아무 증상이 없어서 올린 사람은 모른다.

셋 다 **submodule이 만든 새 실패 모드**이고 단일 레포에서는 존재하지 않던 것이다. 공통점은 로컬 `git status`와 파일 diff가 전부 깨끗해 보인다는 것이다.

## 머지 후 검증 결과 (2026-08-20, submodule 이동 후)

`harness/fx`(submodule, `596627d`)에서 리드가 직접 돌렸다.

```
zig fmt --check src/     통과
zig build test           8373 pass, 2 skip, 1 fail (8376)
```

**team overlay 코드는 머지를 견뎠다.** `tool_runtime.zig`가 우리 181줄과 upstream 25줄(+10/-15)이 만난 유일한 지점이었는데 `team_task`/`executeTeamProvider` 참조 15개가 살아 있고 관련 테스트도 통과했다.

**실패 하나는 브랜딩 쪽이다.** `core.slash_commands.command_specs.test.rendered top-level help is a complete CLI navigation page`가 `failed without output`으로 죽는다. 별도 세션의 리브랜딩 커밋(`aa68c39`)이 `src/core/slash_commands/command_specs.zig`의 브랜드 문자열을 바꿨고, 그 세션이 고친 `596627d`는 `tests/e2e/`만 건드려 이 유닛 테스트를 안 잡았다. 바이너리 이름은 여전히 `fx`라서 usage의 `fx <command>`를 그대로 둘지가 그 세션의 결정이다.

**포인터는 red 상태로 올리지 않는다.** 합의한 규칙대로 green 확인 후 검증한 세션이 올린다.

### 여기서 나온 실측 하나 더

`set -euo pipefail` 아래에서 `lsof`·`pgrep`처럼 **"못 찾음"에 exit 1을 내는 명령**을 검사에 쓰면, 가드가 통과해야 할 때(아무것도 안 걸렸을 때) 스크립트가 죽는다. 이번에는 실패 방향이 안전한 쪽이라 사고가 안 났지만 반대로 짜면 조용히 통과한다. 파이프라인 끝에 `true`를 붙인다.

## 백로그 (이번 범위 밖, 별도 세션)

- ~~**스킬 정리 — 실제로 쓰는 것 위주로 솎아낸다.**~~ **완료(2026-08-20).** 74개 22.7KB에서 31개 9.2KB로 줄였다(상한 16KB, 여유 7.2KB). 해제한 48개는 `~/.skills-archive/<원래 루트>/`에 원본 그대로 있고 되돌리려면 반대로 `mv` — 실제로 `interview`(폴더명 `ouroboros-interview`)를 그렇게 되살렸다. `--context-limit skill_catalog_bytes=off`로 상한을 끄는 길도 있었지만 그러면 컨텍스트를 22KB 먹으므로 택하지 않았다.
  - 선택 도구: `python3 harness/scripts/skill-picker.py && open /tmp/skill-picker.html`. 전부를 바이트·사용 기록·수정일과 함께 놓고 체크박스로 고르면 16KB 대비 잔량이 실시간으로 나오고, 해제한 것을 옮기는 `mv` 명령까지 뽑는다. 무엇을 뺄지는 사람이 정할 일이라 도구가 고르지 않는다.
  - **한 스킬이 여러 루트에 있으면 한 경로만 옮겨서는 안 빠진다.** fx는 루트 순서(fx→opencode→codex→claude→agents→claw)로 이름 중복을 접으므로, 앞 루트에서 치우면 뒤 루트 것이 그대로 올라온다. 실제로 `find-skills`·`orca-cli`·`orchestration`·`reframing`·`humanize-korean` 다섯이 그렇게 살아남았다 — 이들의 실체는 `~/.agents/skills`(4개 CLI 공유 정본)나 `~/.claude/skills`에 있어서 완전히 빼려면 다른 CLI에서도 사라진다. 여유가 7.2KB라 그대로 뒀다. `reframing`이 여기 해당한다 — codex 심링크만 치웠고 실체는 `~/.agents/skills`에, 카탈로그에는 claude 루트를 통해 그대로 실린다.
  - **사용 근거는 세션 로그의 실제 로드로 잡는다.** 카탈로그 등재 문자열은 세션마다 전량 반복되므로 세는 의미가 없다 — `~/.codex/sessions`에서 `cat|sed|head|rg ... skills/<name>/SKILL.md` 형태의 exec 인자만 세야 실제 로드다. 이걸 안 하면 오판한다: 죽은 줄 알았던 `goal-execute`(최근 20회)·`ouroboros-interview`(15회)가 살아 있었다.
  - **남은 fx 패치 후보: fx는 `disable-model-invocation`을 모른다**(`src/` 전체 무매치). 슬래시 전용 스킬(`humanize`·`humanize-redo`·`open-frame`, 합 ~1KB)이 모델용 카탈로그를 먹는다. fx 쪽 작은 패치 후보.
- v1 재시작 생존 검증
- plan 승인 프로토콜, graceful shutdown 프로토콜
- 완료 자동검사(gate), hard plan guard, native hooks
- peer terminal의 리드 미러링
- 리듀서 명령 `assign`/`release`/`delete`/`set_plan_state` 도구 배선

## 실행 모델과 위임 레일 — 층이 다르다

`rubato`(=포크한 fx)와 `meight`는 경쟁 관계가 아니다.

- **meight는 위임 레일이다.** 있던 자리에서 브리프를 던지고 결과를 받는다. Codex 구독으로 청구되고 대화형 터미널이 없다. 헤드리스 디스패치 표면은 이것뿐이다.
- **rubato는 터미널이다.** 앉아서 일하는 대화형 터미널 에이전트다. 디스패치 대상이 아니다 — 밖에서 몰려면 tmux로 키를 넣어야 한다.

**팀을 안 꾸릴 때**: Claude Code에 앉아 있으면 위임은 그대로 meight다. rubato는 등장할 이유가 없다.

rubato가 값을 갖는 자리는 셋이다. ① Claude 구독을 아예 안 쓰고 싶을 때의 터미널 ② 우리 팀 프리미티브(`team.members`/`team.message`/`team_task`)가 있는 유일한 곳 ③ Claude 한도가 소진됐을 때.

**rubato의 리드는 Claude다.** `~/.fx/settings.json`의 `FX_MODEL=xai/grok-4.6`은 연결 시험용 기본값이지 모델 설계가 아니다 — 리드는 `harness/README.md`가 처음부터 적어둔 대로 Opus이고, 실행 모델(Sol/Grok)은 리드가 에이전트마다 따로 배치한다. fx는 에이전트별 모델을 지원하므로 이 구조가 fx를 쓰는 이유 자체다. `rubato.sh`의 기본값은 처음 `cursor/claude-opus-5`로 잡았으나 2026-08-21에 `anthropic/claude-opus-5`(bridge direct)로 바꿨다 — Cursor 경로가 접혔고(`case-studies/provider-routing/cursor-route-verdict/`), direct 경로는 1시간 prompt cache가 되는 유일한 경로다. `~/.fx/settings.json`도 같은 값으로 맞췄다. 두 값 모두 실제 콜로 도착을 확인했다.

모델 배치 기준은 새로 만들지 않는다. 정본은 스킬의 `references/08-model-allocation.md`이고, 고르는 축은 phase 라벨이 아니라 **지배적 병목**이다 — 교차 아키텍처·통합이면 리드급 제너럴리스트, 올바른 기술 변경을 발견·증명하는 것이 어려우면 추론 중심 owner(Sol), 계약이 정해지고 넓은 구현이 어려우면 실행 중심 owner(Grok), 구현을 반증해야 하면 다른 맹점을 가진 fresh verifier. 검증 기본 짝(Grok 구현 → Sol 검증, Sol 수정 → 다른 강한 모델 검증, Opus 아키텍처 변경 → Sol 검증)도 거기 있다.

## 재위임은 막혀 있지 않다 — 이미 열려 있고 실측으로 확인됐다

owner의 재위임은 설계가 이미 허용하고, 두 런타임 어댑터에 명시돼 있다.

- `runtimes/claude-code.md:13` — Owner-local delegation: an ordinary subagent under that owner; it is not a teammate
- `runtimes/fx.md:13` — an ordinary nested subagent under that owner; nesting keeps it out of the team

Claude 쪽 `workstream-owner` agent는 All tools라 Agent 도구를 갖는다. 재위임 불가인 것은 `worker` agent 하나뿐이고(도구가 Read/Edit/Write/Bash/Glob/Grep로 제한), 그것은 owner가 아니라 단순 실행기다.

fx 쪽도 실측으로 확인됐다. 3·4단계 E2E에서 팀원 밑에 nested helper를 실제로 띄웠다(`case-studies/harness/fx-team-lifecycle-measurement.md:30`). 즉 fx 팀원도 자기 밑에 에이전트를 굴린다.

**제한되는 것은 재위임이 아니라 신분이다.** nested helper는 팀원이 아니다 — 공유 보드를 못 읽고(`not_a_team_member`), peer 메시지를 못 쓰고, 리드에게 terminal이 안 간다. 팀원 판정이 "리드의 직계 persistent child"라서 depth 필터에 자연히 걸린다. 이유 둘: 팀 명부가 잔챙이로 불어나지 않고, 권한이 옆으로 새지 않는다. owner는 helper 결과를 받아 자기 이름으로 보드를 갱신한다.

## 역할별 시스템 프롬프트 — 왜 필요한가 (근거)

**문제.** fx는 시스템 프롬프트가 없다(`main.zig:3239`, `:3274`가 `.system_prompt = ""`). 그래서 rubato 리드는 맨몸이다. 그리고 에이전트 세션은 **부모의 시스템 프롬프트를 그대로 물려받는다** — `context_contract.zig:500`이 계약으로 못박고 있다: "reuses the launching surface's project-context snapshot bytes and its system and skill prompt sections".

`~/.fx/AGENTS.md`에 "root면 tech-lead.md를 읽어라" 같은 포인터를 두는 안은 기각했다. 포인터는 따라도 되고 안 따라도 되는 지시이고, 자세는 항상 켜져 있어야 한다. 급이 다르다.

**우리는 포크를 갖고 있으므로 제약이 아니다.** 빈 문자열은 upstream 기본값일 뿐이다. 두 갈래로 나뉜다.

1. **리드 시스템 프롬프트를 파일에서 읽는다.** composition root(`main.zig`)에서 `~/.fx/system-prompt.md`(또는 `FX_SYSTEM_PROMPT_FILE`)를 읽어 `prompt_policy.system_prompt`에 넣는다. 없으면 지금처럼 빈 문자열. `Policy`(`config/prompt_policy.zig`)는 이미 `system_prompt: []const u8`을 갖고 있으므로 자료형 변경은 없다.

2. **역할별 시스템 프롬프트를 연다.** `domain.Configuration`(`subagent/domain.zig`)에는 `name`/`model`/`effort`/`permission_mode`/`notifications`만 있고 **프롬프트 필드가 없다.** 그래서 지금은 에이전트가 부모 것을 물려받는 것 외에 선택지가 없다. 여기에 필드를 하나 더해 소환 시 역할 계약을 시스템 프롬프트로 주입한다.

2번은 Claude Code와의 parity이기도 하다. 거기서는 agent 정의 파일이 통째로 시스템 프롬프트로 주입되고, 그것이 CLAUDE.md가 "복제가 정당한 자리는 하나만 남는다"고 인정한 유일한 경로다. fx에 같은 경로를 여는 것이므로 팀원은 `teammate/workstream-owner.md`·`teammate/independent-verifier.md`를 자세로 갖고 뜬다.

이 둘이 붙어야 리드는 리드 자세로, 팀원은 owner 자세로 태어난다. 그 전까지 rubato는 혼자 쓰는 터미널로는 쓸 수 있고 팀 리드로는 반쪽이다.

## 역할별 시스템 프롬프트 — 무엇을 담을까 (1라운드 확정)

메커니즘(파일에서 읽기 + 역할별 주입)은 6단계에서 만든다. 무엇을 담을지는 여기서 정한다.

### 실측 — tech-lead.md는 이미 두 층이 섞여 있다

런타임 중립: `## Steering`, `## Noticing`, `## Code Discipline`, `## Always Yours`, 그리고 `## Delegation` 안의 원칙들(끝낼 수 있는 목표로 자르기, 분리 가능한 것만 병렬로, 작은 것은 인라인, 빌드와 판단은 별개 디스패치, 다른 세션이 같은 레포를 쥐고 있을 수 있다, 컨텍스트를 이미 산 에이전트를 재사용, 포그라운드 폴링 금지).

Claude Code 전용: 레일 이름들 — `meight`, `Agent tool`, `Skill(consult)`, `SendMessage`, serena, 그리고 `## Model Policy` 거의 전부(`--mode worker`, agent frontmatter 기본값 등). 줄 번호로는 27·29·31·44·46·47·52·53·57~60.

즉 마인드셋은 그대로 살릴 수 있고 레일만 갈아끼우면 된다.

### 실측 — 팀원 계약은 이미 런타임 중립이다

`teammate/workstream-owner.md`(50줄)와 `teammate/independent-verifier.md`(43줄)에 런타임 전용 표현이 **본문에는 없다.** 유일한 언급은 workstream-owner의 frontmatter `description` 한 줄("Claude Code Agent Team에서...")이고 그것은 Claude Code의 agent 선택용 메타데이터다. 그 한 줄만 중립으로 고치면 두 런타임이 같은 파일을 쓴다.

### 정정 — 공통 운영 자세는 비어 있지 않다

앞서 "fx는 `system_prompt`가 빈 문자열이라 공통 운영 자세가 없다"고 적었다. **틀렸다.** 실제 콜로 재보니 있다.

```
(1) 지시에 작업 방식 안내가 있나: Yes.
    "After code changes, verify the relevant behavior with direct checks such as
     formatting, a focused test, build, CLI run, or eval before claiming it works."
(2) 작성 주체: a coding harness.
```

`main.zig:3239`의 `system_prompt = ""`는 프롬프트 조립의 **한 조각**일 뿐이다. `orchestrator.zig:1793`이 `custom_tool_guidance`가 비어 있지 않으면 system 역할로 따로 붙이고, 그것은 `app_agent_runtime.zig:1098`에서 tool projection이 채운다. 안전 규칙 계열은 릴레이(Cursor) 쪽에서도 온다.

**그러므로 `base.md`를 지금 쓰면 안 된다.** 이미 있는 것을 모르고 재발명하는 것이고, 그 실패는 개선 원칙이 명시적으로 경고하는 형태다.

### 대신 할 것 — 재고 나서 정한다

4단계에서 통한 방식을 그대로 쓴다. 만들기 전에 잰다.

측정할 것: fx가 이미 갖는 지시의 전문과 출처(하네스/릴레이), 그중 우리 `base.md` 후보와 겹치는 항목, **그리고 실제 행동으로 드러나는 구멍** — 역할 계약만 준 팀원이 증거 없이 완료를 주장하는가, 범위를 넘는가, 물어야 할 때 묻는가.

문서 대조가 아니라 행동으로 재야 한다. 지시에 문장이 있다는 것과 그 문장이 행동을 바꾼다는 것은 다르다.

### 1라운드 구성 (결정, 적용됨)

정본을 조각으로 갈랐다. `~/.agents/lead/core.md`가 런타임 중립 자세이고 `rails-claude.md`가 Claude 전용 레일이다. `~/.claude/tech-lead.md`는 이제 둘의 **합성 산출물**이며 `~/.agents/lead/build.sh`가 만든다. 원문 72줄 중 누락 0줄로 갈렸고, 기존 소비자(`cs`, `cs-codex`, `~/.grok/rules/`, meight 바인딩)는 한 줄도 안 고치고 그대로 동작한다.

> **2026-08-21 뒤집힘.** 이 분할은 폐기했다. 두 하네스가 프롬프트 파일을 공유하는 것 자체가 연결고리였고, 한쪽 레일이 다른 쪽에 새면 없는 도구를 쓰라고 시키게 된다. `~/.agents/lead/`와 `build.sh`를 지우고 완전히 갈랐다 — Claude 쪽은 `~/.claude/tech-lead.md` 실체 파일, rubato 쪽은 rubato-harness 레포의 `seats/`다. 시스템 프롬프트는 조각으로 나뉜다: `base.md`(공통 운영 계약) + `core-lead.md`/`core-teammate.md`(역할) + `voice-lead.md`/`voice-teammate.md`(역할별 말투)를 `seats/build.sh`가 `.build/{lead,teammate}.md`로 합성하고, `rubato.sh`와 `fxd --seat` 기본값이 그것을 준다. 시스템 프롬프트를 agent-taskforce가 아니라 하네스 레포에 둔 이유는 버전 관리다 — 워킹트리에만 있으면 `~/.agents/lead/`가 그랬던 것처럼 추적 밖에 남고 남에게 줄 수도 없다. 부수 발견: `~/.grok/rules/tech-lead.md`는 심링크가 아니라 8-17자 실체 사본이었고 `build.sh`가 갱신한 적이 없다 — 분할 시점부터 이미 갈라져 있었다.

| 역할 | 1라운드에 넣는 것 |
|---|---|
| Claude 리드 | `tech-lead.md` (= core + rails-claude) — 지금과 동일 |
| Claude 팀원 | 지금대로 agent 정의 |
| fx 리드 (rubato) | `core.md` 하나 |
| fx 팀원 | `teammate/<역할>.md` 하나 |

**만들지 않는 것**: `base.md`, `rails-fx.md`.

> **2026-08-21 뒤집힘.** 둘 다 필요했다. `base.md`를 뺀 근거는 "fx가 이미 검증 지시를 준다"였는데, `FX_SYSTEM_PROMPT_FILE`이 append가 아니라 replace(`prompt_policy.zig:52`)라서 시스템 프롬프트 파일을 넣는 순간 그 fx 지시(`builtins/context.zig`의 6개 절)가 통째로 사라진다. 즉 근거로 삼은 지시를 자기가 지운 상태로 1라운드를 돌렸다. `rails-fx.md`를 뺀 근거("도구가 자기 설명을 달고 광고되므로 리드가 알아낸다")도 빗나갔다 — 도구 목록은 `subagent`가 있다는 것만 알려주지 `system_prompt_file`을 생략하면 부모 프롬프트를 상속한다는 것은 알려주지 않는다. 지금은 둘 다 `seats/`의 `base.md`와 `core-lead.md`에 들어가 있다.

`base.md`를 빼는 이유는 측정 때문이다. fx가 이미 검증·증거 지시를 준다는 것이 확인됐으므로, 공통 자세를 처음부터 넣으면 잘 돌아갔을 때 그것이 fx 기본 지시 덕인지 우리가 넣은 것 덕인지 가릴 수 없다. 한 번은 없이 돌려야 구멍이 보인다.

`rails-fx.md`를 빼는 이유도 같다. fx 도구는 자기 설명을 달고 광고되므로 리드가 도구 목록에서 `subagent`·`team.message`·`team_task`를 알아낼 공산이 크다.

**리드 자세는 재지 않고 바로 넣는다.** 하네스가 "너는 위임하고 통합하는 테크리드다"라고 말할 이유가 없기 때문이다. 그것은 작업 방식이 아니라 역할이다.

### 1라운드에서 관찰할 것

역할 계약만 받은 fx 팀원의 **행동**을 본다. 지시문 대조가 아니다.

- 증거 없이 완료를 주장하는가 (오늘 실패가 `completed`로 보이는 구멍을 찾았으므로 더 중요해졌다)
- 범위를 넘는가
- 물어야 할 때 묻는가

구멍이 나오면 그만큼만 `~/.codex/AGENTS.md`에서 떼어 붙인다. 그 파일은 도구 이름 없이 결과 지향·작업 계약·권한 경계·검증·컨텍스트 보존을 다루므로 조각을 떼기 좋다. 구멍이 없으면 만들지 않는다.

**미결**: 팀원 계약의 frontmatter `description` 한 줄이 "Claude Code Agent Team에서..."로 시작한다. fx가 그 팀원을 앉힐 때 YAML 세 줄이 프롬프트에 섞인다. 중립 표현으로 고치거나 fx 로더가 선행 YAML을 건너뛰게 한다.

## 열어두는 것

- `team-overlay-v1.1-decisions.md`의 이름 충돌. 그 문서의 v1.1은 설계서 개정 번호이고 이 문서의 v1.1은 기능 버전이다. rename 여부 미결.
