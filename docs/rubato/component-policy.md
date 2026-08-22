# Rubato — component 정책과 upstream 추적

이 포크가 upstream(`code-yeongyu/oh-my-openagent`)과 다른 점, 그리고 그 차이를 **왜 이 모양으로** 뒀는지 적는다. 목적은 하나다: upstream을 계속 받아오면서 우리가 고른 것만 돌린다.

## 이 포크의 목적

베이스라인은 OMO다. 거기서 **뺄 것은 빼고, 새로 만들 것은 우리가 만든다.** upstream은 끊지 않는다 — 신기능 중 좋은 것과 안정화 패치를 계속 받아야 하기 때문이다.

그래서 **포크에서 하는 수정은 적을수록 유리하다.** 이전 세대(`vercel-labs/fx` 포크)에서 겪은 실패가 정확히 그 반대였다: 우리가 고친 자리와 upstream이 고친 자리가 겹쳐 머지할 때마다 조용히 깨졌다(`control_store.zig` 스키마 버전 충돌).

## 규칙 — 지우지 않고 안 부른다

**component를 뺄 때 소스 파일을 삭제하지 않는다.** `packages/omo-senpi/src/extension/component-list.ts`의 배열에서 호출만 뺀다. import는 남긴다.

근거는 머지 비용이다.

| 방식 | upstream이 그 component를 고쳤을 때 |
|---|---|
| 소스 파일 삭제 | 파일마다 충돌. 우리가 지운 걸 매번 다시 판단해야 한다 |
| **배열에서 빼기 (채택)** | `component-list.ts` **한 파일**에서만 충돌 |

부수 효과가 하나 더 있고, 이게 오히려 본전이다. upstream이 component를 추가하면 이 파일에 import 한 줄 + 배열 한 줄이 늘어난다. 즉 **충돌 자체가 "새 component가 들어왔다"는 알림**이 된다. 설계 문서(`rubato-pi-design.md` 7절)가 "버전을 올릴 때 component 목록의 diff를 먼저 보라"고 요구한 것이 이 방식에서는 자동으로 강제된다.

**등록 순서는 의미가 있다.** upstream에서 `start-work-continuation`이 `ulw-loop`보다 먼저 등록되어야 boulder 작업이 우선권을 갖는 식이다. 살아남은 항목은 upstream의 상대 순서를 유지한다.

## 지금 켜는 것 (6개)

`config-startup`, `ast-grep`, `lsp`, `task`, `memory`, `config-watch`.

`task`가 이 포크가 존재하는 이유이고(팀 실행 엔진), `config-startup`은 다른 component가 그 설정 뷰에 의존한다.

## 지금 끄는 것 (12개)

결정의 정본은 `agent-taskforce` 레포의 `harness/docs/rubato-pi-design.md` 4절 카탈로그(2026-08-22 사용자 확정)다. 요약하면 이렇게 갈린다.

**우리 턴을 멋대로 시작하는 것** — `onboarding`(첫 실행에 묻지도 않고 자기 턴을 하나 시작), `init-deep-advisor`(프로젝트 preflight + 조언 흐름). 팀 런의 첫 턴은 우리가 소유해야 한다.

**완료 판정을 가져가는 것** — `start-work-continuation`(멈추려는 에이전트를 boulder 상태로 최대 8회 재촉), `ulw-loop`(같은 것을 ulw-loop 상태로). 완료는 Taskforce 완료 증거가 소유한다.

**우리 지시와 두 목소리가 되는 것** — `ultrawork`(계획·위임 지시문 주입), `skill-pointers`(mass-ulw / ulw-plan / ulw-loop / ulw-research 포인터 주입), `todo-fanout-reminder`(위임 결정을 사용자에게 보고하라는 알림 — 우리 승인 gate와 중복).

### 검토 기록: `todo-fanout-reminder`를 대신 채택하고 리드 프롬프트에서 뺀다면?

검토했고 **반대**로 결론했다(2026-08-23). 내용이 겹치는 것은 사실이다 — SIZE / fan-out 계산 / 사용자에게 결정 알리기 / todo 신선도, 네 항목 모두 리드 프롬프트에 대응물이 있다. 그럼에도 바꾸지 않는 이유는 셋이다.

1. **조건이 안 맞는다.** 이 리마인더는 `arming.isArmed(sessionId)` 가드 뒤에 있고, 그 arming은 `ultrawork` component가 소유한다. `ulw`를 쓰지 않는 우리 사용 방식에서는 **채택해도 발동하지 않는다.** 발동시키려면 `ultrawork`와 `skill-pointers`까지 되살려야 하는데, 그 둘은 지시문 본문이 리드 프롬프트와 충돌할 수 있어 뜼는 것이 목적이었다.
2. **작동 시점이 좁다.** 리마인더는 todo 첫 생성 순간 **1회**만 꿂힌다. 그러나 fan-out 판단은 일을 받은 직후·방향 전환·자식 복귀 시점에도 필요하다. 상시 프롬프트가 덤는 범위를 1회 리마인더로 대체할 수 없다.
3. **계약의 폭이 좀 더 좁다.** OMO 문구는 "병렬 서브에이전트에 위임하라"까지다. 우리 리드가 지는 **모델 선택 + 로스터 제시 + 사용자 승인 대기**는 담기지 않는다. 좁은 것으로 넓은 것을 대체하면 승인 gate가 빠진다.

**다만 남는 위험은 기록해 둔다.** 같은 지시가 두 곳(이 component와 리드 프롬프트)에 존재한다. 지금은 component가 져 있어 실질 충돌이 없지만, **누군가 `ultrawork`를 다시 켜면 두 목소리가 생긴다.** 그때는 둘 중 하나를 골라야 하며, 이 문서에 그 결정을 적는다.

**바깥으로 나가거나 남의 이름이 붙는 것** — `telemetry`(세션 형태를 PostHog로 전송), `git-master`(커밋 메시지에 제3자 co-author trailer), `native-badge`(OMO 상태 배지 — rubato 브랜드와 충돌).

**보류** — `fallback-architect`(모델 강등 시 자동 행동 변경; 우리 모델 배치와 충돌 가능), `comment-checker`(실제 출력 품질을 보고 판단).

### 카탈로그에 없던 것: `skill-pointers`

설계 문서의 18개 카탈로그에는 `skill-pointers`가 없다. 그 문서가 작성된 뒤 upstream에 추가된 component이며, **우리가 앞으로 매 머지마다 보게 될 diff의 첫 사례**다. `mass-ulw`/`ulw-loop`을 이미 끄기로 한 것과 같은 계열이므로 같이 껐다.

## 왜 플래그로 끄지 않았나

`compose.ts`에는 component마다 `omo-senpi-<name>-disabled` 플래그가 있다. 그런데 **우리가 그 값을 세울 수 없다.** `registerFlag`로 플래그를 만들고 **같은 함수 안에서 곧바로 `getFlag`로 읽는데**, 그 사이에 값을 넣을 지점이 없다. CLI 인자로 넘겨도 전역·개별 어느 쪽도 먹지 않았다(beta.7 실측).

이것은 "물리적으로 불가능"이 아니라 **upstream이 외부에서 세울 경로를 열어두지 않았다**는 뜻이다. 포크에서는 배열을 직접 고치는 쪽이 더 싸고 명확하므로 플래그 경로를 되살리지 않았다.

## 나중에 정공법으로 바꿀 것 (지금은 문서화만)

포크를 갖게 되면서 **바깥에서 우회하던 것들을 소스에서 직접 할 수 있게 됐다.** 다만 지금은 돌아가는 것을 깨지 않기 위해 오버레이(`agent-taskforce` 레포의 `harness/rubato-pi/`)를 그대로 둔다. 아래는 옮길 후보 목록이며, 옮길 때마다 이 문서를 갱신한다.

| 지금 (오버레이 우회) | 정공법 |
|---|---|
| `restoreMemberTaskEngine` — `SENPI_TASK_MEMBER`를 잠깐 지우고 task component를 재조립한 뒤 되돌린다. `isTeamMemberProcess()`의 early return을 피하려는 것 | 팀원 프로세스가 중첩 위임을 할 수 있는 경로를 `senpi-task`에 직접 연다 |
| `replaceSystemPrompt` — 완성된 프롬프트를 넘겨 stock 프롬프트가 서지 못하게 하고, 필요한 조각만 정규식으로 뽑아 붙인다 | 역할별 시스템 프롬프트 계층을 정식 확장점으로 만든다 |
| `member-board.mjs` — OMO 원장을 건드리지 않고 디스크에 우리 JSON 포맷과 상태 전이표를 따로 둔다 | 팀원이 공유 task 보드를 직접 list/get/update/claim 하는 경로를 `components/task`에 연다 |
| 자식별 permission이 spawn spec/argv에 없어 pretrusted 전용 worktree로 우회 | spawn spec에 멤버별 permission 필드를 연다 |

**주의.** 이것들을 소스로 옮기는 순간 머지 비용이 올라간다. `component-list.ts` 한 파일에서 끝나던 충돌이 `senpi-task`와 `components/task`로 번진다. 옮기기 전에 그 비용을 받을 값어치가 있는지 매번 다시 판단한다.

## upstream 받는 절차

1. `git fetch upstream && git merge upstream/dev`
2. **`component-list.ts` 충돌을 먼저 본다.** 늘어난 이름이 있으면 새 component다.
3. 새 component는 기본적으로 **끈 채로** 둔다(배열에 넣지 않는다). 무엇을 하는지 읽고 결정한 뒤 넣는다. upstream은 새 component를 켜진 상태로 추가하므로, 아무 판단 없이 배열에 넣으면 우리가 고르지 않은 것이 돌게 된다.
4. 결정을 이 문서의 목록에 반영한다.
