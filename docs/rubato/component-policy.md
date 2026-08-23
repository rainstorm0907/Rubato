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

## 지금 켜는 것 (4개)

`ast-grep`, `lsp`, `task`, `memory`.

`task`가 이 포크가 존재하는 이유다(팀 실행 엔진).

**문이 둘이라는 것을 기억해라.** 이 배열은 *번들에 넣을지*를 정하고, 오버레이의 `ON_COMPONENTS`(`harness/rubato-pi/src/policy.mjs`)가 *그중 무엇을 등록할지*를 다시 정한다. 둘 다 지나야 실제로 돈다.

**두 목록은 같아야 한다.** 한때 이 배열이 여섯이고 오버레이가 넷이어서 `config-startup`·`config-watch`가 번들에만 실리고 켜지지는 않았다. 안 켜지는 것을 배포물에 넣는 낭비이고, 나중에 읽는 사람에게는 버그로 보인다.

## 지금 끄는 것 (14개)

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

**우리가 쓰지 않는 설정 파일을 다루는 것** — `config-startup`(`~/.omo` 설정을 읽는다), `config-watch`(그 파일이 바뀌면 다시 읽는다). rubato-pi 는 그 파일을 쓰지 않는다. 설정을 코드로 만들어 런타임에 그대로 넘긴다(`harness/rubato-pi/src/omo-config.mjs`) — 그래서 읽을 것도 감시할 것도 없다. 설계 문서에는 `config-startup`을 유지로 적었지만 그것은 `~/.omo` 설정을 쓰던 시절 기준이고, 지금 구조에서는 성립하지 않는다.

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

### Senpi dependency patch

Senpi 런타임과 그것이 읽는 pi-TUI의 작고 경계가 분명한 수정은 별도 포크 대신 **append-only patch series**로 관리한다. 적용은 `postinstall.mjs`가 한다.

```
patches/@code-yeongyu%2Fsenpi@2026.8.22.patch          baseline — 동결. 재생성하지 않는다
patches/@code-yeongyu%2Fsenpi/2026.8.22/<id>.patch     series — 추가만 한다
patches/@code-yeongyu%2Fsenpi-tui@2026.8.22.patch      (pi-TUI도 같은 두 층)
patches/@code-yeongyu%2Fsenpi-tui/2026.8.22/<id>.patch
```

적용 순서는 baseline 다음에 series를 **파일명 오름차순**이다. 명시적 index 파일은 두지 않는다 — 그건 다시 모두가 함께 쓰는 파일이 되어 없애려던 경합을 되살린다. 파일명 앞의 UTC 타임스탬프가 순서를 준다.

#### 왜 `bun patch` + `patchedDependencies`로 돌아가면 안 되는가

**되돌리지 마라. 그 경로는 화면에 닿지 않는다.**

`@earendil-works/pi-tui`는 두 벌 깔린다. 워크스페이스 루트의 것과, Senpi가 자기 `node_modules` 안에 품은 것이다. **세션이 실제로 읽는 것은 후자**인데 Bun의 `patchedDependencies`는 전자만 고친다. 그래서 patch는 정확한데 화면은 원본인 상태가 오래 갔고, 검증조차 패치된 사본을 직접 열어보고 통과했다. 슬래시 자동완성 수정이 세 번 연속으로 "고쳤는데 안 되는" 상태였던 것이 그것이다.

지금은 `postinstall.mjs`의 `VENDOR_PATCHES[].resolveRoot()`가 `realpath`로 **중첩 사본을 직접 타겟한다**. 세션 시작 때 `node_modules`를 보정하는 우회로(`syncTuiPatch`)도 함께 걷어냈다 — 그건 소스 자리가 원본으로 바뀐 뒤 postinstall의 작업을 매번 되돌리고 있었다.

#### 수정하는 절차

```bash
bun run vendor:patch open senpi          # 세션 전용 작업 공간을 만든다
#   /tmp/rubato-vendor-<session>/senpi/work  ← 여기서 편집한다
#   /tmp/rubato-vendor-<session>/senpi/base  ← 비교 기준. 건드리지 않는다
bun run vendor:patch save senpi <change-id>   # 새 patch 파일 하나를 만든다
node postinstall.mjs && bun run test:patches  # 적용과 검증
```

- **`node_modules`를 직접 고치지 않는다.** 작업 공간은 임시 디렉터리이고 언제든 버릴 수 있다.
- **파일 목록을 사람이 고르지 않는다.** `save`가 작업 공간 전체를 자동 비교한다. 손으로 고르다 신규 파일이 빠져서, 그것을 import하는 변경만 patch에 남고 런타임에서 터진 적이 있다. 기능 하나는 patch 하나에 통째로 들어가야 원자성이 산다.
- **기존 patch는 절대 고치지 않는다.** 되돌리거나 바꾸려면 그 위에 얹는 새 patch를 만든다.
- 세션마다 다른 patch 파일에 쓰므로 두 사람이 동시에 작업해도 마지막 저장자 승리가 없다. 서로 다른 파일이면 순서대로 적용되고, **같은 줄을 건드리면 `postinstall.mjs`가 어느 patch가 어디서 부딪혔는지 말하고 멈춘다.** 자동 병합은 하지 않는다.
- 작업 공간이 여럿이면 `--session <name>`으로 가른다.

`open`은 복사 전에 설치본이 정말 baseline + 현재 series와 일치하는지 확인한다. 그래서 pristine tarball(`npm pack`)을 따로 받지 않는다 — 새 patch가 얹힐 자리는 pristine이 아니라 series가 적용된 상태이고, 설치본이 이미 그 상태임을 postinstall이 매번 역적용 round-trip으로 증명하기 때문이다.

Rubato 소유 테스트는 `node_modules/` 밖(`patch-tests/`)에 두고, patch가 바꾼 동작을 직접 확인한다. `patch-tests/vendor-patch-live.test.ts`는 **실제로 도는 사본**에 patch가 살아 있는지 역적용으로 본다.

#### Senpi 버전을 올릴 때

1. 새 버전을 설치한다. patch 적용 실패는 우회할 오류가 아니라 새 소스에 맞춰 다시 얹으라는 신호다.
2. `VENDOR_PATCHES`의 `expectedVersion`을 올린다. 버전이 다르면 postinstall이 hunk 실패가 아니라 버전 불일치로 말하고 멈춘다.
3. 새 버전에서 작업 공간을 열고 의도를 재적용한다. upstream이 이미 흡수했거나 구조를 바꿨는지 먼저 보고, 옛 hunk를 기계적으로 복사하지 않는다.
4. 새 버전용 baseline은 새로 뜨고, series 디렉터리도 새 버전 이름으로 시작한다. **옛 버전의 patch들은 지우지 않고 그대로 둔다** — 무엇을 왜 고쳤는지의 기록이다.
5. patch 전용 테스트, Rubato launcher 테스트, Senpi QA smoke를 실행하고 `.omo/evidence/omo-senpi-adapter/`에 증거를 남긴다.
6. 깨끗한 설치 상태에서 `bun install --frozen-lockfile`을 실행하고 patch의 동작이 남는지 확인한다. 남아 있던 `node_modules/` 수정이 아니라 커밋된 patch가 공급원임을 증명하는 단계다.
7. 업데이트 커밋에는 각 patch가 upstream 흡수로 제거됐는지, 새 소스에 맞춰 갱신됐는지, 그대로 유지됐는지 적는다.

patch가 여러 하위 시스템에 걸치거나 빌드 산출물 재생성을 요구하거나 업데이트마다 반복 충돌하면 Senpi 포크로 올린다. 기준은 단순 줄 수가 아니라 유지보수 소유권이다.
