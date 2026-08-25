# rubato-pi 구현 세션 브리프

이 파일은 별도 구현 세션에 그대로 전달하는 브리프다. 시작할 때
`/Users/wy/.claude/skills/dispatched/SKILL.md`를 먼저 읽는다.

## Outcome

`rubato-pi` alias로 실행되는 독립 하네스를 만든다. exact-pinned Senpi 위에 OMO
extension의 선택된 component만 적재하고, Agent Taskforce의 승인·역할·권한·위임·
shared board·완료 증거 계약을 구현한다. 기존 `rubato`와 `omo`는 그대로 병행한다.

설계 정본은 [`rubato-pi-design.md`](rubato-pi-design.md)다. 이 브리프와 충돌하면
설계서가 이긴다.

## Binding decisions

### 기반과 pin

- 후보 C(task 중심 thin overlay)부터 구현한다.
- `omo-ai@5.0.0-0.beta.15`, Senpi `2026.8.21-3`을 정확 pin한다. 범위 지정자와 자동
  업데이트를 쓰지 않는다.
- 근거 소스는 OMO commit
  `024cd9fe0374a87e0d17f540d229f3e087059385`, Senpi commit
  `a5eed44536f3024c5740dc3dfff4ffe0bb08b717`이다.
- OMO launcher는 쓰지 않는다. `plugin/extensions/omo.js` 파일 하나를 `-e`로
  적재해 OMO 스킬 묶음은 배제하고 `~/.agents/skills/`의 기존 스킬은 유지한다.
- Node.js 24 이상을 쓴다. launcher는 현재 shell의 기본 Node 버전을 영구 변경하지
  말고, 설치된 Node 24를 선택하거나 실행 가능한 오류로 중단한다.

### component 정책

- ON: `config-startup`, `ast-grep`, `lsp`, `task`, `memory`, `config-watch`
- OFF: `native-badge`, `onboarding`, `init-deep-advisor`, `telemetry`, `mass-ulw`,
  `start-work-continuation`, `ulw-loop`, `todo-fanout-reminder`, `git-master`,
  `fallback-architect`
- 보류이며 v0 OFF: `ultrawork`, `comment-checker`
- 새 upstream component는 사용자가 결정하기 전까지 OFF다.
- 리드·일반 `task` 에이전트·팀 멤버는 ON 6/OFF 12를 동일하게 따른다.
- DAG 에이전트은 재귀 task 엔진을 막기 위해 `task`만 추가로 OFF로 두되,
  `config-startup`, `ast-grep`, `lsp`, `memory`, `config-watch`는 유지한다.
  현재 upstream의 OMO extension 전체 `slice(1)`은 통과가 아니다.

### 제품 경계

- 기존 `rubato`·`omo`의 binary, alias, 설정, state를 수정하지 않는다.
- `rubato-pi`는 별도 브랜드, 설정 디렉토리, 세션 state, launcher, alias를 쓴다.
- v0는 개인·내부 사용 전용이다. 외부·상업 배포는 범위 밖이다.
- OAuth는 기존 중계기를 사용한다. 새 OAuth 흐름을 만들지 않는다.
- `memory` ON은 사용자 결정이다. 비용이 크다는 이유로 임의로 OFF하지 않는다.

## Write ownership

쓸 수 있는 범위:

- 새 구현: `harness/rubato-pi/**`
- launcher/install 연결: `harness/scripts/rubato-pi*`
- rubato-pi 문서와 검증 기록: `harness/docs/rubato-pi*`
- live Agent Taskforce Pi adapter:
  `/Users/wy/.claude/skills/agent-taskforce/**`
- live skill을 `./snapshot.sh`로 가져온 결과:
  `skills/agent-taskforce/**`
- 모든 검증을 통과한 뒤 `.zshrc`의 **새 `rubato-pi` alias 한 줄**. 수정 전 백업하고
  기존 `rubato`·`omo` 줄은 건드리지 않는다.

Off-limits:

- `harness/fx/**` — 시작 시점부터 사용자 변경이 있는 dirty submodule이다.
- 기존 `rubato` launcher·alias와 OMO 전역 설치물.
- rubato-pi와 무관한 skills, case studies, research, runtime 설정.
- 사용자가 요청하지 않은 commit, tag, push.

## Repository leads — provisional

아래 좌표와 구현 아이디어는 빠른 출발점이지 구속이 아니다. 코드·테스트·런타임으로
검증하고 더 작은 접합점이 있으면 바꾼다.

- OMO 파일 단위 진입점:
  `/opt/homebrew/lib/node_modules/omo-ai/plugin/extensions/omo.js`
- current source의 component 등록:
  `packages/omo-senpi/src/extension/component-list.ts`,
  `packages/omo-senpi/src/extension/compose.ts`
- task/team 접합점:
  `packages/omo-senpi/src/components/task/`,
  `packages/senpi-task/src/`
- 후보 로컬 구조:
  - `harness/rubato-pi/package.json`
  - `harness/rubato-pi/bin/rubato-pi.mjs`
  - `harness/rubato-pi/src/extension/`
  - `harness/rubato-pi/test/`
  - `harness/scripts/rubato-pi.sh`
- 새 구현은 OMO monorepo 전체 복사를 기본값으로 삼지 않는다. gate 결과가 승격
  조건을 충족할 때만 필요한 최소 범위를 fork한다.

## Execution order

### 1. Baseline and probe

1. 시작 git status와 `harness/fx` dirty 상태를 기록한다.
2. exact pin 설치를 격리된 디렉토리에서 재현한다.
3. bare Senpi, OMO 파일 단위 `-e`, OMO 디렉토리 적재의 명령·스킬 표면을 다시
   측정한다.
4. gate 4 → 5를 production scaffold보다 먼저 판정한다.

### 2. Gate 4 — child inheritance

파일 단위 `-e`로 뜬 리드가 일반 child, DAG child, 팀 멤버를 만들 때 다음을
관측한다.

- OMO extension과 rubato-pi adapter extension의 argv 순서
- component disable 상태의 상속
- OMO 스킬 0개 추가, 기존 Taskforce 스킬 유지
- DAG 에이전트에서 OMO extension 전체를 버리지 않고 `task`만 제외하며 선택된 비-task
  component 5개를 유지하는 child profile

확장 또는 disable 정책을 에이전트에 전달할 수 없고 작은 배선으로도 해결되지 않으면
후보 A 재검토 증거를 반환한다.

### 3. Gate 5 — component policy

선택된 6개만 ON이 되도록 allowlist를 구현한다. disable 플래그가 실제 CLI에서
먹지 않으면 설정/env 접합점을 확인하고, 없으면 필요한 최소 OMO 범위를 fork한다.
원치 않는 component를 켠 채 완료로 처리하지 않는다.

### 4. Agent Taskforce semantics

- 승인 gate: `team_create`, `task`, `dag`는 배치안을 사용자에게 보여주고 승인 전에는
  child를 만들지 않는다. `task_create`는 process spawn이 아니므로 대상이 아니다.
- 역할 계약: owner/verifier 계약을 첫 user prompt나 파일 포인터가 아니라
  system-prompt/강제 extension 계층에 주입한다.
- verifier 권한: `edit`와 `bash`를 실제 호출 단계에서 deny한다. permission은 OS
  sandbox가 아니므로 테스트에서 쓰기 시도를 직접 한다.
- 중첩 위임: 팀 멤버가 자기 child를 시작·steer·wait·cancel하고 결과를 회수한다.
- shared board: 팀 멤버가 직접 list/get/claim/update한다. 자기 이름 기반 claim,
  blocked task, cross-owner update 거부를 검증한다.
- worktree: `worktreePath`의 `mkdir`를 격리로 간주하지 않는다. 실제
  `git worktree add`/cleanup을 구현한다.
- 완료 증거·예산: 위임 단위 budget, done evidence, budget return을 내구 task
  metadata 또는 동등한 상태에 저장한다.

### 5. Gate 3, 6, 1, 2

설계서의 순서대로 각각 독립 테스트를 먼저 만들고 구현한다.

- gate 3: 역할별 pretrusted worktree 설정을 먼저 시험하고, 불충분하면 child argv
  permission 배선 또는 강제 extension으로 올라간다.
- gate 6: 리드 중개 board는 통과가 아니다.
- gate 1: 팀 멤버의 `isTeamMemberProcess()` early return을 우회만 쌓아 해결하지
  않는다.
- gate 2: 컴팩션 뒤에도 역할 계약이 남는지 확인한다.

### 6. Launcher, live skill, alias

- `rubato-pi` 전용 brand/config/state를 만든다.
- `harness/scripts/rubato-pi.sh`를 직접 실행해 검증한 뒤 alias를 연결한다.
- live Agent Taskforce skill에 Pi runtime adapter를 추가한다.
- live 위치에서 수정하고 `./snapshot.sh`로 이 레포에 동기화한다. `skills/`를 먼저
  직접 고치지 않는다.

## Required tests

구현 패키지는 최소한 아래 명령을 제공한다.

```bash
npm test
npm run test:integration
npm run smoke:local
npm run smoke:real
```

테스트 범위:

1. exact pin, Node 24 선택, isolated state, 기존 alias/state 불변
2. 리드·task child·팀 멤버의 ON 6 / OFF 12 표면, DAG child의 비-task ON 5 /
   task OFF 표면
3. OMO 스킬 차단과 기존 Taskforce 스킬 보존
4. 승인 전 spawn 0, 승인 후 정확한 child 수
5. owner/verifier 역할 계약 주입, 컴팩션 뒤 계약 잔존, verifier write deny
6. nested helper lifecycle
7. peer board claim 경쟁, blocked dependency, cross-owner 거부
8. 실제 git worktree 생성·정리
9. done evidence·budget return 영속화
10. crash/reload/resume와 process child 재부착
11. mailbox injection/commit 사이 kill 후 exactly-once
12. compaction 중 완료 buffering과 재전달
13. `memory` ON의 prompt tokens, background dreaming child, 캐시 로그의
    `bootstrap`/`delta`/`flatten`
14. 보류 2개가 OFF이며 재활성화 경로가 존재
15. alias에서 실제 모델을 사용한 lead → owner → verifier → 완료 한 사이클

실제 모델 smoke는 한 lifecycle로 제한하고 외부 사용료가 **미화 5달러**를 넘기기
전에 반환한다. 모델 id가 보인다는 것만으로 통과시키지 말고 실제 응답으로 역할별
모델을 확인한다.

## Done evidence

완료 시 `harness/docs/rubato-pi-verification.md`를 작성한다.

- 구현한 구조와 최종 파일 목록
- gate 1~6 각각의 PASS/FAIL, 실행 명령, 원시 증거 위치
- component별 lead/child/member 표면
- 모든 테스트 명령과 종료 코드
- real smoke의 모델, 역할, child/session id, 완료 증거
- prompt token·cache 로그와 `memory` 비용
- 기존 `rubato`·`omo`·`harness/fx`가 바뀌지 않았다는 git/런타임 증거
- 남은 위험과 다음 최소 작업

Done은 테스트 파일의 존재가 아니라 위 증거와 실제 lifecycle 통과다.

## Escalation and budget

- 시간 예산: 8시간. 도달하면 미완료여도 통과한 gate, 실패 증거, 변경 파일,
  재현 명령, 다음 최소 작업을 반환한다.
- 후보 C의 우회가 3절 승격 조건에 걸리면 더 쌓지 않는다. 후보 B 또는 A 권고와
  최소 fork 범위를 증거와 함께 반환한다.
- 인증·권한·라이선스의 definitive denial은 한 번 확인하고 반환한다.
- 레포 좌표·원인 설명은 provisional이다. 코드·테스트·런타임과 충돌하면 그 증거가
  우선한다. 단, component 정책과 write boundary는 바꾸지 않는다.
