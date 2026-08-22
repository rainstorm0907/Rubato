# rubato-pi — 확정 설계서

작성·확정 2026-08-22. 대상 독자는 rubato-pi를 구현하고 검증할 다음 세션이다.

`rubato-pi`는 기존 rubato(fx 포크 + fx-v3-bridge)와 별개의, Senpi 엔진 계열 위에 올리는 두 번째 실행 하네스 후보를 가리키는 작업 이름이다. 이름의 `pi`는 Senpi가 `badlogic/pi-mono`의 포크라는 계보에서 왔다 ([code-yeongyu/senpi](https://github.com/code-yeongyu/senpi) 저장소 설명). 기존 rubato의 구조와 확인된 것/아직인 것은 `harness/README.md`와 `harness/docs/fx-team-overlay.md`에 있으며, 이 문서는 그것을 대체하지 않는다.

---

## 1. 이 문서의 목적과 현재 상태

목적은 두 가지다. 첫째, 사용자가 확정한 component 정책과 기반 구조를 구현 계약으로 고정한다. 둘째, 그 결정의 근거와 아직 실행으로 판정해야 할 gate를 분리해, 다음 세션이 설계를 다시 토론하지 않고 구현·검증부터 시작할 수 있게 한다.

### 확정된 v0 계약

- 기반은 **후보 C — exact-pinned Senpi + upstream OMO extension의 task 중심 thin overlay**로 구현을 시작한다. 이 선택은 gate 1~6을 무시한다는 뜻이 아니다. gate를 구현·실측하고, 3절의 승격 조건에 걸리면 정해진 분기대로 후보 B 또는 A로 이동한다.
- 정확 pin은 이 설계가 검증한 upstream 조합을 출발점으로 쓴다: `omo-ai@5.0.0-0.beta.15`, Senpi `2026.8.21-3`, OMO commit `024cd9fe0374a87e0d17f540d229f3e087059385`, Senpi commit `a5eed44536f3024c5740dc3dfff4ffe0bb08b717`. 범위 지정자와 자동 업데이트는 금지한다.
- 기존 rubato(fx)는 대체하지 않는다. `rubato-pi`라는 별도 launcher·alias·브랜드·설정·세션 state로 **병행**한다.
- v0 용도는 개인·내부 사용이다. 외부·상업 배포는 이번 구현 범위가 아니며, 시작되면 9절의 라이선스를 다시 판정한다.
- OMO 스킬 묶음은 적재하지 않고, `~/.agents/skills/`의 기존 스킬은 유지한다. OMO extension은 디렉토리가 아니라 `plugin/extensions/omo.js` 파일 하나를 `-e`로 적재한다.

### 확정된 component 정책

사용자가 2026-08-22에 결정 화면에서 확정한 값이다. **보류는 v0에서 OFF**이며, 해당 기능을 켜는 것은 별도 측정과 새 결정 뒤에만 가능하다.

| v0 상태 | component |
|---|---|
| **ON (6)** | `config-startup`, `ast-grep`, `lsp`, `task`, `memory`, `config-watch` |
| **OFF (10)** | `native-badge`, `onboarding`, `init-deep-advisor`, `telemetry`, `mass-ulw`, `start-work-continuation`, `ulw-loop`, `todo-fanout-reminder`, `git-master`, `fallback-architect` |
| **보류 → v0 OFF (2)** | `ultrawork`, `comment-checker` |

DAG 자식만 예외다. 재귀 task 엔진을 막기 위해 `task`는 OFF지만, 선택된 비-task component 5개는 유지한다. 현재 upstream의 OMO extension 전체 `slice(1)` 동작은 이 정책을 충족하지 않으며 gate 4에서 고친다.

### 구현으로 판정할 것

제품 선택은 끝났다. 남은 것은 사용자 선택이 아니라 실행 gate다.

- gate 4 → 5 → 3 → 6 → 1 → 2 순서로 판정한다.
- gate 실패는 막힘이 아니라 설계된 분기다. 3절의 승격 기준과 10절의 반환 계약을 따른다.
- `memory`는 사용자가 ON으로 결정했으므로 캐시·컨텍스트·배경 자식 비용을 반드시 실측한다. 비용이 크다는 이유만으로 구현 세션이 임의로 OFF로 바꿀 수 없다.
- `ultrawork`와 `comment-checker`는 보류이므로 v0 완료 조건에서 제외하고 OFF 상태와 재활성화 경로만 검증한다.

### 이 문서가 이미 검증한 것과 구현 세션이 검증할 것

여기 적힌 구조·동작 주장은 (a) 로컬 설치물 `/opt/homebrew/lib/node_modules/omo-ai`의 실제 파일, (b) upstream `dev` 브랜치의 고정 commit 소스, (c) Senpi 공식 문서, (d) 로컬 beta.7을 RPC 모드로 띄워 `get_commands`로 명령·스킬 표면을 읽은 실측 중 하나에 대응한다. 근거 링크와 실측 절차는 11절에 모았다.

**실행 실측은 (d) 범위에서만 했다.** 확장 적재 형태별 명령·스킬 표면과 disable 플래그의 CLI 반응은 실제로 프로세스를 띄워 쟀다. 반면 캐시 적중률, 컴팩션 연속성, crash/resume, 팀원 자식의 확장 상속은 **재지 않았다** — 8절에 "측정해야 할 것"으로만 있다. 실측한 것은 로컬 beta.7이므로 upstream `dev`에 그대로 옮겨 말할 수 없고, 옮길 수 없는 자리는 그때마다 밝혔다.

---

## 2. OMO Native의 계층 구조

`omo` 명령 하나가 세 개의 서로 다른 소유자를 가진 계층을 세운다. 이 분해가 이후 모든 선택의 전제다.

```text
┌─ launcher ──────────────────────────────────────────────┐
│ omo-ai 패키지의 bin/omo.js → bin/lib/launcher.js         │
│   · Senpi 엔진 경로를 해석해 spawn                        │
│   · SENPI_BRAND 로 이름·설정 디렉토리·env prefix·          │
│     update 채널을 주입 (name "omo", configDir ".omo",     │
│     envPrefix "OMO", distTag "beta")                     │
│   · SENPI_CODING_AGENT_DIR = ~/.omo/agent                │
│   · OMO_NATIVE=1 (footer 배지 마커)                       │
│   · --extension <plugin 경로> 를 앞에 붙여 확장을 적재     │
└──────────────────────┬──────────────────────────────────┘
                       │ spawn (Node)
┌──────────────────────▼──────────────────────────────────┐
│ OMO extension — Pi 패키지 @code-yeongyu/omo-senpi         │
│   · plugin/extensions/omo.js  (단일 번들 진입점)          │
│   · plugin/skills/            (실측 22개 적재)             │
│   · plugin/runtime/           (ast-grep MCP, LSP daemon,  │
│                                agent-toolkit)             │
│   · component 를 순서대로 register                        │
│     (dev 18개 / 로컬 beta.7 16개)                          │
│   · 전역 플래그 omo-senpi-disabled +                       │
│     component 마다 omo-senpi-<name>-disabled              │
│     (dev 기준. beta.7 은 7개만 존재하고 CLI 로는 안 먹었다) │
└──────────────────────┬──────────────────────────────────┘
                       │ Senpi ExtensionAPI
┌──────────────────────▼──────────────────────────────────┐
│ Senpi engine — @code-yeongyu/senpi (MIT)                 │
│   모델 라우팅 / 프로바이더 OAuth / 프롬프트 캐시 /          │
│   컴팩션 / 권한 / 도구(PTY bash 계열) / 스킬 로더 /        │
│   세션 저장·분기 / MCP 클라이언트 / TUI                    │
└─────────────────────────────────────────────────────────┘
```

계층의 실체는 다음과 같이 확인된다.

- launcher: `/opt/homebrew/lib/node_modules/omo-ai/bin/lib/launcher.js`의 `brandProfile()`, `senpiEnvironment()`, `spawnSenpi()`.
- extension: `/opt/homebrew/lib/node_modules/omo-ai/plugin/package.json`의 `pi.extensions = ["./extensions/omo.js"]`, `pi.skills = ["./skills"]`.
- 엔진 pin: `omo-ai@5.0.0-0.beta.7`의 `dependencies["@code-yeongyu/senpi"] === "2026.8.12-4"`, upstream 최신 `omo-ai@5.0.0-0.beta.15`는 `"2026.8.21-3"`. 정확 버전 pin은 OMO 쪽 설계 의도이기도 하다 — launcher가 `omo update self`류를 가로채고 "엔진이 이 패키지에 pin 되어 있으므로 self-update는 pairing을 깬다"고 답한다 (`launcher.js:112-119`).

**로컬 설치물과 upstream을 혼동하지 않는다.** 로컬은 beta.7이고, upstream `dev`(commit `024cd9f`)는 beta.15다. 두 숫자를 섞지 않기 위해, 확인된 차이 셋을 여기 모아 둔다.

- **component 개수 — 로컬 beta.7은 16개, upstream `dev`는 18개.** beta.7 번들에는 `git-master`와 `mass-ulw`가 component로 등록되지 않는다 (`git-master`는 스킬 이름 목록에만 나타나고, `mass-ulw` 문자열은 번들 전체에 0회). 4절 카탈로그는 **upstream `dev` 기준 18개**다. 이 문서에서 "18"은 언제나 dev를 가리키고, beta.7을 말할 때는 16이라고 쓴다.
- **`dag`와 팀원 프로세스 분기는 beta.7에 없다.** 로컬 번들에 `dag` 도구와 `isTeamMemberProcess` 식별자가 둘 다 0회다. 따라서 이 문서의 도구 개수(11개), 승인 gate 대상, 중첩 위임 판정은 전부 **upstream `dev` 기준**이며 beta.7에서 재확인할 수 없다.
- **component별 disable 플래그도 beta.7에는 없다.** dev의 `compose.ts`는 component 목록을 돌며 18개 전부에 대해 `omo-senpi-<name>-disabled`를 `registerFlag` 한다. 반면 beta.7 번들에 존재하는 disable 플래그 이름은 7개뿐이고(`omo-senpi-disabled`와 `fallback-architect`·`init-deep-advisor`·`memory`·`onboarding`·`todo-fanout-reminder`·`ultrawork` 여섯), 그중 `registerFlag`에 이름 그대로 실린 것은 전역 플래그 하나다. 실제로 로컬에서 `--omo-senpi-memory-disabled`, `--omo-senpi-disabled`, 그리고 `=true` 변형까지 붙여 띄워 봤지만 **어느 것도 component를 끄지 못했다** (명령 표면이 플래그 없이 띄웠을 때와 동일). 4절과 7절이 이 결과를 반영한다.

### 세 번째 계층이 만드는 결합

launcher가 하는 일은 "브랜드 주입"이라고 부르기에는 범위가 넓다. 설정 디렉토리(`~/.omo/agent`), 환경변수 prefix(`OMO`), 업데이트 채널(`omo-ai@beta`), 그리고 wire 상의 user-agent까지 바꾼다. rubato-pi가 OMO의 확장만 재사용하고 브랜드를 자기 것으로 가져가려면 이 launcher를 **쓰지 않고 직접 대체**해야 한다. 이것은 우회가 아니라 계층이 원래 그렇게 갈라져 있다는 뜻이다 — 확장은 Senpi의 표준 Pi 패키지 규약을 따르므로 launcher 없이도 적재된다.

---

## 3. 세 후보 비교

세 후보 모두 Senpi를 엔진으로 쓴다는 점은 같다. 갈리는 것은 **OMO 코드에 대한 소유권을 얼마나 가져오는가**이다.

### 후보 A — bare Senpi custom

Senpi를 그대로 쓰고, Taskforce에 필요한 것(팀 통신, 역할 계약, 완료 증거)을 우리 확장으로 새로 쓴다. OMO는 참조만 한다.

얻는 것은 표면적의 최소화다. 읽어야 할 남의 코드가 Senpi 문서 수준으로 줄고, upstream 추적 부담이 Senpi 하나로 끝난다. 라이선스도 MIT 단일이라 9절의 제약이 사라진다.

잃는 것은 OMO의 `task`/team 엔진 전부다. persistent child, 직접 peer messaging, 내구 mailbox, exactly-once 배달 원장, crash/reload/resume 재조정, 컴팩션 중 버퍼링, DAG/status — 이것들은 `packages/senpi-task/AGENTS.md`가 서술하는 분량만 봐도 재구현 비용이 작지 않다. 기존 rubato에서 fx Team Overlay를 만들 때 우리가 실제로 통과한 구간과 겹치므로, "할 수는 있다"는 것은 이미 안다. 그러나 fx Overlay에서 의도적으로 만들지 않은 것들(broadcast, 공유 task 원장, 중첩 팀 — `harness/docs/fx-team-overlay.md` "손대지 않은 것")이 여기서는 OMO가 이미 갖고 있는 것들이다.

### 후보 B — OMO monorepo 삭제식 fork

OMO 저장소를 포크하고 필요 없는 것을 지운 뒤 우리 것으로 만든다.

얻는 것은 완전한 개조 자유다. component 경계를 우리 방식으로 다시 그을 수 있고, `senpi-task` 엔진 내부의 의미(예: 완료 증거 필드 추가)를 직접 고칠 수 있다.

잃는 것은 두 가지다. 첫째, upstream 추적이 이 레포가 이미 아는 종류의 조용한 실패를 부른다 — `harness/README.md`의 "upstream 머지할 때" 절이 서술하는 `control_store.zig` 스키마 버전 충돌은 fx 포크에서 실제로 만난 것이고, OMO 쪽은 그보다 표면적이 넓다 (packages 46개). 둘째, 라이선스다. OMO 루트는 Sustainable Use License이므로 포크물의 외부·상업 배포가 막힌다 (9절).

### 후보 C — upstream OMO task-only thin overlay (첫 PoC 후보, 조건부)

Senpi와 OMO 확장을 둘 다 **정확 버전 pin으로 설치만** 하고, 코드를 포크하지 않는다. 18개 component 중 필요한 것만 켜고 나머지는 component 단위 disable 플래그로 끈다. Taskforce 의미론(역할 계약, 승인 gate, 완료 증거)은 OMO를 고치는 대신 **우리 쪽 얇은 어댑터 확장**이 얹는다.

**이 후보를 첫 시도로 두는 근거는 하나다: 개조 비용 사다리에서 가장 싼 쪽부터 시도한다** (`CLAUDE.md`의 "개선의 비용 사다리"). 그리고 가장 싼 형태가 무엇인지는 이번에 실측으로 좁혀졌다 — `plugin/extensions/omo.js` **파일 하나**를 `-e`로 지정하면 OMO의 component와 task 엔진은 그대로 들어오면서 OMO 스킬 22개는 따라오지 않는다(7절 표). 포크도, 패키지 필터 설정도 필요 없다.

그러나 같은 조사에서 **gap 넷이 소스로 확인됐다** — 팀원의 중첩 위임 불가, 역할 계약의 시스템 프롬프트 주입 경로 부재, 자식별 permission 전달 필드 부재, 팀원의 task board 직접 접근 부재. 이 중 permission은 pretrusted 역할별 전용 worktree 설정으로 해결될 가능성이 남아 있고, 나머지는 현재 설정으로 열리지 않는다. 여기에 아직 재지 않은 것 둘이 붙는다 — 팀원 자식의 확장·disable 상태 상속(gate 4), component disable 플래그를 실제로 세울 수 있는지(gate 5).

따라서 후보 C의 위치는 "추천 확정"이 아니라 **"가장 싼 첫 PoC이며, 7절의 gate 1~6을 모두 통과해야 채택 가능한 v0 실험 후보"**다. 깨지는 자리에 따라 갈 곳이 다르다.

- **gate 1~2가 해결되지 않으면 → 후보 B로 승격한다.** 둘은 OMO **task internals의 개조**를 요구하기 때문이다. gate 3은 pretrusted 전용 worktree E2E가 실패하거나 worktree 공유가 필수일 때만 같은 승격 후보가 된다. 포크 범위는 monorepo 전체가 아니라 `senpi-task` + `omo-senpi/components/task`로 좁힐 수 있다.
- **gate 4(자식 상속)가 깨지면 → 후보 A가 살아난다.** OMO 확장을 우리 launcher 아래에서 자식까지 전달할 방법이 없다는 뜻이므로, task/team을 우리가 다시 짓는 비용과 재비교해야 한다.
- **gate 5(플래그)가 깨지면 → 먼저 대안 경로를 찾고, 없으면 후보 B다.** component를 못 끄면 "필요한 것만 켠다"는 후보 C의 정의가 성립하지 않는다.

**승격 기준을 미리 못 박아 둔다.** 아래 둘 중 하나가 되면 후보 C 실험을 접고 후보 B로 올린다. 실험을 붙들고 있는 시간이 포크 비용을 넘기 전에 끊기 위해서다.

1. gate 1~2와, 전용 worktree PoC가 실패한 gate 3의 해법이 모두 "자식에 강제 적재되는 우리 확장이 OMO 내부 동작을 되돌려 놓는" 형태로 수렴할 때. 그 시점의 어댑터는 이미 thin overlay가 아니라 **바깥에서 하는 포크**이며, 같은 일을 소스에서 하는 쪽이 읽기도 고치기도 싸다.
2. 하나의 gate를 통과시키려고 넣은 우회가 다른 gate를 깨서 되돌리는 일이 반복될 때. 내부 패치가 서로 얽히기 시작하면 upstream pin을 올릴 때마다 전부 다시 검증해야 하고, 이것이 `harness/README.md`가 기록한 fx 포크의 조용한 실패와 같은 모양이다.

| | A. bare Senpi | B. monorepo fork | C. thin overlay |
|---|---|---|---|
| 추적할 upstream | Senpi 1개 | Senpi + OMO 전체 | Senpi + OMO(설치물) |
| task/team 재구현 | 필요 | 불필요 | 불필요 |
| OMO 내부 의미 개조 | 해당 없음 | 가능 | 불가 (어댑터로 감싸기만) |
| 라이선스 부담 | MIT만 | Sustainable Use | Sustainable Use (사용 범위에 한함) |
| 현재 위치 | 대안 (gate 4 실패 시 부활) | 대안 (gate 1~2·5·6 실패 또는 gate 3 PoC 실패 시 승격) | v0 실험 후보, gate 1~6 필수 |

---

## 4. OMO component 전체 카탈로그 (18개)

목록과 **등록 순서**의 정본은 `packages/omo-senpi/src/extension/component-list.ts` (commit `024cd9f`)다. 순서는 의미가 있다 — 예를 들어 `start-work-continuation`이 `ulw-loop`보다 먼저 등록되어야 boulder 작업이 우선권을 갖는다.

`packages/omo-senpi/src/extension/compose.ts`가 각 component에 대해 `omo-senpi-<name>-disabled` 불리언 플래그를 등록하고, 등록 루프에서 그 플래그가 `true`면 건너뛴다. 전역 차단은 `omo-senpi-disabled` 하나다. **소스상으로는 dev의 18개 전부가 개별적으로 꺼진다.**

다만 **"소스에 플래그가 있다"와 "우리가 그 플래그를 세울 수 있다"는 다른 문제이며, 후자는 아직 확인되지 않았다.** 로컬 beta.7에서 이 플래그들을 CLI 인자로 넘겨 봤더니 전역·개별 어느 쪽도 효과가 없었다(2절). beta.7은 애초에 플래그가 7개뿐이라 dev의 결과를 대신하지 못하지만, 실패 원인으로 짚이는 구조는 dev에도 그대로 있다 — `compose.ts`는 확장이 **활성화되는 시점에** `registerFlag`를 하고 곧바로 같은 함수 안에서 `getFlag`로 읽는데, 그 시점은 CLI가 argv를 파싱한 뒤다. 그러므로 "플래그로 끈다"는 것은 후보 C의 전제이면서 동시에 **검증되지 않은 전제**이고, 7절에서 gate 5로 다룬다.

아래 "v0 제안"은 당시 추천이고, 마지막 "결정" 열은 2026-08-22에 사용자가 확정한 값이다. 추천과 결정이 다르면 결정이 이긴다.

| # | component | 무엇을 하는가 | 컨텍스트·캐시 영향 | Taskforce 관련성 | v0 제안 | 결정 |
|---|---|---|---|---|---|---|
| 1 | `config-startup` | **기존 OMO 설정을 새 형식으로 옮기고 선택한 프로파일을 불러온다.** 레거시 설정 마이그레이션(lock+journal)을 Senpi가 설정을 읽기 전에 돌리고, 프로파일이 고른 `[senpi]` 뷰를 로드한다. 결과와 진단은 첫 `session_start`에 한 번 알림 | 없음 (모델 컨텍스트에 안 들어감) | 낮음. 단 다른 component가 이 설정 뷰에 의존한다 | 유지 — `task`가 이 로더를 통해 설정을 읽는다 | **유지** |
| 2 | `native-badge` | **화면 아래쪽에 OMO의 실행·응답 완료 상태를 표시한다.** `session_start`와 `agent_settled`에 footer 상태 배지를 게시한다 | 없음 | 없음. 오히려 rubato-pi 브랜드와 충돌한다 | 기본 OFF — 우리 이름을 쓸 것이므로 | **기본 OFF** |
| 3 | `onboarding` | **처음 실행할 때 온보딩 안내를 자동으로 시작한다.** 설치당 1회, 대화형 세션의 `startup`에서만 온보딩 스킬을 읽으라는 숨은 메시지를 보내 **사용자가 묻지 않아도 자기 턴을 하나 시작한다** | 턴 하나와 스킬 본문만큼 컨텍스트를 먹는다 | 없음 | 기본 OFF — 자동 턴 시작은 리드 세션의 승인 경계와 어긋난다 | **기본 OFF** |
| 4 | `init-deep-advisor` | **새 프로젝트의 초기 설정을 검사하고 빠진 준비 작업을 안내한다.** `startup` 세션에서 프로젝트 초기화 상태를 preflight 검사하고 조언 흐름을 돌린다 (git 저장소 여부, 온보딩 마커 시각 등을 본다) | 발동 시 컨텍스트 소비 | 없음 | 기본 OFF — 팀 런의 첫 턴을 우리가 소유해야 한다 | **기본 OFF** |
| 5 | `telemetry` | **사용 횟수와 세션 진행 같은 익명 통계를 PostHog로 보낸다.** `daily_active`, `session_started`, `prompt_submitted`, `turn_completed`를 전송하며 코드·프롬프트 본문은 보내지 않는다. opt-out: `OMO_SENPI_DISABLE_POSTHOG`, `OMO_DISABLE_POSTHOG`, `DO_NOT_TRACK` 등 | 없음 | 없음 | 기본 OFF — 프롬프트 내용은 안 보내지만 세션 형태가 나간다. component 플래그와 env 둘 다로 끈다 | **기본 OFF** |
| 6 | `ultrawork` | **`ultrawork`나 `ulw`라고 입력하면 계획·위임·완료를 더 적극적으로 밀어붙이라는 추가 지시를 넣는다.** 입력이 `/(?:ultrawork\|ulw(?!-))/i`에 걸리면 숨은 커스텀 메시지를 주입하고, 세션당 arming 원장을 유지하며 컴팩션 후 재무장한다 | **큼.** 지시문 본문이 매 arming마다 대화 컨텍스트로 들어간다 | 간접적. 우리 리드/팀원 프롬프트와 지시문이 겹치거나 충돌할 수 있다 | 보류 — 지시문 본문을 읽고 우리 계약과 충돌하는지 본 뒤 결정 | **보류 (v0 OFF)** |
| 7 | `mass-ulw` | **여러 작업을 그래프로 나눠 대량 병렬 실행하라는 추가 지시를 넣는다.** `mass ulw`/`mulw`/`meth` 등에 걸리면 `dag` 도구로 오케스트레이션하라는 숨은 스킬 포인터를 주입한다. 상태 없음(매번 재주입) | 작음(포인터 수백 바이트). 단 뒤따르는 스킬 본문은 큼 | 겹침. 팬아웃 결정 권한이 우리 리드와 이 지시문 양쪽에 생긴다 | 보류 — 6절의 역할 충돌과 같이 판단 | **기본 OFF** |
| 8 | `start-work-continuation` | **OMO 작업 계획이 남아 있으면 멈추려는 에이전트에게 계속 작업하라고 최대 8번 재촉한다.** `agent_end`에 `.omo/boulder.json`을 읽어 활성 work plan이 있으면 계속하라는 지시를 주입한다 | 매 턴 끝마다 지시문 추가 가능 | 충돌 가능. 완료 판정 권한이 boulder 상태로 넘어간다 | 기본 OFF — 완료 판정은 Taskforce 완료 증거가 소유한다 | **기본 OFF** |
| 9 | `ulw-loop` | **반복 작업 모드가 켜져 있으면 완료했다고 멈추지 못하게 계속 수행 지시를 넣는다.** `omo-agent-toolkit ulw-loop` 상태가 살아 있을 때 작동하며 boulder가 이어질 수 있으면 8번에 양보한다 | 위와 같음 | 위와 같음 | 기본 OFF — 같은 이유 | **기본 OFF** |
| 10 | `todo-fanout-reminder` | **첫 작업 목록을 만들 때 병렬로 나눌 일이 있는지 다시 판단하라는 알림을 한 번 넣는다.** ultrawork가 무장된 세션에서 todo 도구의 첫 작업 추가 결과에 세션 1회 `<system-reminder>`를 붙인다 | 작음(1회) | 겹침. 위임 결정을 사용자에게 보고하라는 요구가 우리 승인 gate와 중복된다 | 보류 — 우리 gate와 병존 가능한지 확인 후 | **기본 OFF** |
| 11 | `git-master` | **커밋 메시지에 외부 계정을 공동 작성자로 표시하는 꼬리말을 추가한다.** `git-master` 스킬 본문을 읽을 때 attribution 지시(`commit_footer`, `include_co_authored_by`, 기본 둘 다 true)를 덧붙인다 | 작음 | 낮음. 다만 우리 커밋 메시지에 제3자 trailer가 붙는다 | 기본 OFF — 커밋 메시지는 이 레포 규약이 소유한다 | **기본 OFF** |
| 12 | `fallback-architect` | **주 모델을 쓸 수 없어 대체 모델로 내려가면 별도 설계 에이전트에게 문제 분해를 상담하라고 자동 지시한다.** Senpi의 retry-fallback이 거부·정책 사유로 `claude-fable-5`를 떠날 때 1회 지시를 넣고 이후 프롬프트마다 짧은 리마인더를 태운다 | 중간. 리마인더가 fable 복귀까지 매 프롬프트에 붙는다 | 있음. 모델 강등 시의 자동 행동 변경은 우리 역할 배치와 충돌할 수 있다 | 보류 — 우리 모델 배치를 정한 뒤 판단 | **기본 OFF** |
| 13 | `comment-checker` | **파일을 수정한 뒤 코드 주석이 불필요하거나 과하지 않은지 자동 검사한다.** write 계열 도구 결과 뒤에 공유 comment-checker 흐름을 돌린다(바이너리를 찾은 경우) | 작음 | 낮음 | 보류 — 실제 출력 품질을 보고 판단 | **보류 (v0 OFF)** |
| 14 | `ast-grep` | **코드 구조를 문법 트리 기준으로 검색하고 매칭하는 도구를 추가한다.** 패키징된 ast-grep MCP 런타임을 `_ast_grep` stdio 서버로 eager 등록하며, 런타임이 없으면 조용히 건너뛴다 | **중간.** MCP 도구 정의가 매 요청 프롬프트에 실린다 | 있음. 구조적 코드 검색은 investigator 역할에 유용하다 | 보류 — 도구 정의 토큰 비용을 재고 판단 | **유지** |
| 15 | `lsp` | **오류 진단, 정의로 이동, 참조 찾기, 심볼 검색, 이름 변경 도구를 추가한다.** LSP 도구 6개를 항상 등록하고 실행은 패키징된 LSP daemon이 맡는다. 프로젝트 로컬 `.pi/lsp-client.json`의 command/env는 안전상 무시 | **중간.** 도구 6개 정의가 상시 프롬프트에 실린다 | 있음 | 보류 — 위와 같은 이유 | **유지** |
| 16 | `task` | **여러 에이전트를 띄우고 작업 배분·메시지·상태·중단 후 복구를 관리하는 팀 실행 엔진을 추가한다.** 도구 11개와 persistent child, 내구 mailbox, 세션 시작 복구 체인, DAG 실행, 리드 전용 team 도구를 얹는다. curated read-only 서브에이전트 4개도 오버레이하며 `--no-omo-task`로 차단한다 | **큼.** 도구 11개 + 에이전트 설명이 프롬프트에 실린다. `dag`는 설명문만 다섯 문장이다 | **핵심.** 후보 C가 존재하는 이유 전체 | 유지 (ON) — 단 6·7절의 구조 gate가 조건이다 | **유지** |
| 17 | `memory` | **프로젝트 지식을 세션 밖에도 저장해 다음 대화에 다시 넣는다.** 도구 2개, 슬래시 명령 13개, HTML 뷰어를 제공하고, 쉬는 동안 별도 자식 프로세스가 메모리를 정리하는 "dreaming"도 실행한다. `memory.enabled` 기본 ON | **큼.** `before_agent_start`마다 컴파일된 메모리 블록을 프롬프트에 합성한다(HEAD 기준 캐시). `compile_warn_tokens` 기본 30000 | 있음(부정적 방향). 우리가 통제하지 않는 자식 프로세스가 배경에서 뜨고, 프롬프트 접두가 커밋 HEAD에 따라 바뀌면 캐시 접두가 흔들린다 | 기본 OFF — 8절의 캐시·비용 지표를 측정할 때까지 | **유지** |
| 18 | `config-watch` | **실행 중 `.omo` 설정 파일이 바뀌면 재시작 없이 새 설정을 다시 읽는다.** dry-run 검증으로 잘못된 설정이면 reload를 거부하고, 재등록은 fingerprint당 3회로 제한한다 | 없음 | 낮음 | 보류 — hot reload가 실행 중 팀 런에 미치는 영향을 보고 판단 | **유지** |

### 카탈로그에 딸린 주의 셋

**`agent-home`과 `config-resolution`은 component가 아니다.** `src/components/` 아래에 디렉토리는 있지만 `component-list.ts`가 반환하는 배열에 없다. 헬퍼다.

**component를 끄는 것과 스킬을 끄는 것은 별개다.** OMO 확장은 스킬 묶음을 함께 배포하며 `pi.skills` 매니페스트를 통해 적재된다. 예를 들어 `git-master` component를 꺼도 `git-master` 스킬 파일 자체는 여전히 발견된다. 7절이 이 둘을 나눠 다루고, 거기서 스킬을 떼어내는 방법이 실측으로 확인된다.

개수는 `plugin/README.md`가 19라고 적지만 **실측은 22다** — 로컬 beta.7을 디렉토리 형태로 적재했을 때 늘어난 스킬이 22개였다(`ast-grep`, `coding-agent-sessions`, `data-scientist`, `debugging`, `frontend`, `git-master`, `give-me-tips`, `hyperplan`, `init-deep`, `lsp-setup`, `onboarding`, `programming`, `refactor`, `remove-ai-slops`, `review-work`, `start-work`, `ultimate-browsing`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`, `visual-qa`). README 산문이 낡은 자리가 하나 더 있는 셈이다.

**16번 행의 도구 11개는 upstream 기준이며, 동시에 리드 프로세스 기준이다.** 로컬 beta.7 번들에는 `dag`가 없다 — `omo-task.js`와 `omo.js` 어디에도 `createDagTool`이나 `dag` 문자열이 0회다. 같은 번들에 `isTeamMemberProcess`도 없다. 즉 그래프 실행과 팀원 프로세스 식별은 beta.7 이후에 들어온 것이고, 이 문서의 도구 개수·승인 gate 논의는 upstream `dev`를 대상으로 한다. 그리고 11개가 다 뜨는 것은 리드에서뿐이다 — 팀원 프로세스에는 `task_send` 하나만 있다(6절).

### 이 카탈로그를 HTML로 옮길 때

18행 × 7열 표를 그대로 HTML `<table>`로 변환하지 않는다. 열 하나가 서너 문장인 표는 좁은 화면에서 읽히지 않고, 결정 칸이 오른쪽 끝으로 밀려 정작 사용자가 해야 할 일이 안 보인다. 대신 두 층으로 나눈다.

1. **상단 요약 결정표** — `#`, component 이름, 한 줄 요약, v0 제안, 결정 컨트롤(유지/기본 OFF/보류 3지 선택) 다섯 열만. 한 화면에 18행이 다 들어와야 하고, 사용자가 여기서만 클릭해도 선택이 끝나야 한다.
2. **component별 상세 카드** — 요약표의 행을 누르면 펼쳐지는 접이식(`<details>` 또는 동등한 disclosure) 카드. 카드 안에 기능 상세, 소유 계층, 컨텍스트·캐시 영향, Taskforce 관련성, 제안 사유, 근거 링크를 문단으로 둔다. 기본 상태는 접힘이다.

두 층은 같은 데이터를 가리켜야 한다 — 요약표의 결정 컨트롤이 정본이고 카드는 그 결정을 읽기만 한다. 카드 안에 두 번째 결정 컨트롤을 두면 어느 쪽이 진짜인지 모르는 상태가 생긴다.

---

## 5. Senpi builtin — rubato-pi가 다시 만들지 않을 것

fx 포크에서 우리가 직접 깎았던 것들 중 상당수를 Senpi가 이미 갖고 있다. 여기 적힌 것은 **재구현 금지 목록**이다. 우리 코드로 옮기면 그 순간 두 번째 정본이 생긴다.

### 프롬프트 캐시

Senpi는 레인마다 유효 TTL이 다르다는 것을 인정하고, 그 값을 다른 기능이 소비할 수 있게 노출한다.

- Claude SDK OAuth(구독) 레인은 SDK가 `cache_control`을 소유하므로 Senpi가 breakpoint를 못 넣는다. 그래도 **300초로 보고**해 캐시 인지 예산이 제 크기를 잡게 한다. 재정의 불가.
- 직접 Anthropic API 레인은 기본 5분이고 `cacheRetention: "long"` 또는 `PI_CACHE_RETENTION=long`으로 1시간을 켠다. 1시간 쓰기가 base input의 2배라는 비용 구조까지 문서가 명시한다 — 이는 기존 rubato가 `harness/README.md`에서 독립적으로 실측해 도달한 결론과 같다.
- Anthropic 호환 프로바이더(kimi-coding, fireworks, gateway류)는 1시간 TTL이 native base URL에 gate 되어 있어 short로 남는다.
- 재정의 우선순위: `models.json`/카탈로그의 `cacheRetention` > `PI_CACHE_RETENTION` > 레인 기본값.

**서버 affinity**도 builtin이다. Anthropic 구독 레인은 rendezvous 해싱으로 한 세션이 한 계정에 붙어 캐시를 데운다 — 계정은 자동 failover 외에는 세션 중간에 돌지 않는다. OpenRouter는 세션 id를 `x-session-id` 헤더와 body `session_id` 양쪽으로 보내 upstream을 고정한다. Moonshot에는 `prompt_cache_key`를, Cloudflare에는 `x-session-affinity`를 자동으로 붙인다.

**캐시 인지 타임아웃**은 우리가 fx에서 만들지 않은 종류의 기능이다. `promptCache.cacheAwareTimeouts`(기본 true)가 foreground 도구 대기를 모델의 캐시 TTL에서 `promptCache.safetyBufferSeconds`(기본 30)를 뺀 값으로 상한을 건다. 즉 긴 `bash` 하나가 캐시 만료를 걸치고 전체 재읽기를 유발하지 않는다. 예산에 걸린 foreground 명령은 죽이는 대신 살아 있는 background 세션으로 넘긴다.

**parked 세션의 wake source 집계**도 있다. `wake_source_state` 이벤트를 terminal monitor, background bash, detached eval, 그리고 `senpi-task`(OMO의 background 자식과 소유 팀원)가 발행하고, goal 확장이 전부 합산해 하나라도 근무 중이면 캐시 TTL 안에서 대기한다.

### 컨텍스트와 컴팩션

- 자동 컴팩션 트리거는 `contextTokens > contextWindow - reserveTokens` (`compaction.reserveTokens` 기본 16384). 컷 포인트는 뒤에서부터 `compaction.keepRecentTokens`(기본 20000)까지 모은다.
- 컴팩션 사유는 `manual` / `threshold` / `overflow` 셋이다. overflow는 턴이 컨텍스트 초과로 중단된 뒤의 복구 경로이며 `willRetry`로 재시도 여부를 알린다.
- 컴팩션·branch 요약 요청은 **새 라우팅 세션 id를 쓰고 프로바이더가 지원하면 캐시 쓰기를 끈다** — 재사용 가능성이 없는 일회성 프롬프트이기 때문이다.
- 확장이 `session_before_compact` / `session_compact_failed` / `session_before_tree`로 요약을 가로채거나 자기 방식으로 만들 수 있다.
- 요약 실패는 무한 재시도가 아니라 유한 예산이다. 2026.8.12-4 changelog: blocking 컴팩션 경로의 일시적 요약 실패가 첫 시도에서 끝나지 않고 유한 재시도 예산을 쓰며, "speculative warm-up"은 자기 idle 재시도를 따로 갖는다.

### 컨텍스트·규칙 중복 제거

- 컨텍스트 파일은 `AGENTS.md` 또는 `CLAUDE.md`를 계층적으로 적재하고, `AGENTS.override.md`가 있으면 그 디렉토리에서 그것을 대신 쓴다. `--no-context-files`로 끈다.
- 동적 project rule은 서로 다른 도구 대상이 같은 규칙에 맞아도 본문이 다시 붙지 않는다. 매칭·대상 fingerprint는 대상별로 남되 **전달된 규칙 본문은 하나의 live-context 중복 제거 범위를 공유**하며, 승인된 컴팩션이 컨텍스트 경계를 지우거나 규칙 내용 해시가 바뀔 때까지 재주입되지 않는다.
- 스킬은 심링크 별칭을 canonical path로 중복 제거한다. `~/.agents/skills`를 가리키는 심링크가 있어도 중복 항목이 뜨지 않는다 — 이 레포의 정본 배치(`~/.agents/skills/`에 실체, 각 CLI가 심링크)가 그대로 통한다.

### 권한

프리셋(`full-access`, `workspace`, `read-only`, `ask`)을 먼저 평가하고 전역 설정 → 프로젝트 설정 → CLI 플래그 순으로 명시 규칙을 적용한다. **마지막에 맞는 규칙이 이긴다.** `read-only` 프리셋은 `read`/`list`/`grep`을 허용하고 `edit`/`bash`/`external_directory`를 묻는다.

주의: 문서가 명시한다 — 권한 규칙은 **확인 정책이지 샌드박스가 아니다**. Senpi, 확장, 패키지 설치, 자식 프로세스는 여전히 호스트 프로세스 권한으로 돈다. 7절의 verifier 쓰기 차단은 이 한계 위에 설계해야 한다.

### background terminal

`bash`는 실제 PTY 위에 있고 동반 도구 다섯이 딸린다: `bash_output`(비차단 peek, regex 필터, 렌더된 xterm 그리드 뷰), `monitor`(장기 명령 감시, 매칭 라인을 합쳐 이벤트로 주입), `bash_input`(stdin과 명명 키), `bash_resize`, `kill_bash`(트리 kill). background 세션은 `timeout`으로 죽지 않으며 `/reload`를 넘어 살아남는다.

### 모델 fallback

`retry.enabled` + `retry.modelFallback`으로 체인이 돈다. 핵심은 **전환이 현재 턴을 이어가며 기존 대화 접두를 바꾸지 않는다**는 것 — 프롬프트 캐시 입력이 보존되고, fallback 수명주기 이벤트는 모델 컨텍스트에 들어가지 않는다. 원래 모델로 복귀는 턴 경계에서만 일어난다. 쿨다운은 오류에서 유도되며 프로바이더의 retry-after 힌트가 항상 이긴다(쿼터·과금 30분, rate limit 30초, overload 45초+jitter, 5xx 20초, 타임아웃/전송 실패 60초, 그 외 5분). `/fallback` 명령이 체인을 관리하고 `--no-model-fallback` / `SENPI_NO_FALLBACK=1`이 한 번 끈다.

### 캐시 연속성 관측

Senpi는 세션 로그에 라인별 JSON을 남기며 `kind`가 `bootstrap`/`delta`/`reattach`/`fork`/`flatten`/`disabled` 중 하나다. **`flatten`이 반복되면 그 레인이 대화 전체를 재전송해 캐시 적중을 잃고 있다는 뜻**이다. 건강한 대화는 `bootstrap` 하나 뒤에 `delta`가 이어진다. `SENPI_SESSION_DEBUG=1`이 같은 라인을 stderr로 미러한다. 8절이 이것을 지표로 쓴다.

---

## 6. OMO task/team과 Agent Taskforce — 재사용점, 충돌점, 필요한 변경

### 재사용할 수 있는 것

- **persistent child와 두 실행 모드.** in-process 러너는 부모의 살아 있는 도구 클로저를 공유하고(단 `task_*`/`team_*` 계열은 뺀다), process 러너는 자식 Senpi 프로세스를 띄워 JSON-RPC로 steer/abort/prompt를 건넨다. 일반 `task`/`dag` child와 `team_create` 멤버가 같은 process-child 운반체를 쓰지만 의미는 다르다. 멤버만 team identity, member extension, mailbox, team runtime state를 받는 **resident peer**다. caller-worker subagent가 아니며, `team_create`도 작업 결과를 기다려 반환하지 않고 spawn 완료만 반환한다.
- **직접 peer messaging.** 이것이 fx Team Overlay에서 우리가 Zig 소스를 고쳐가며 얻었던 바로 그 능력이다(`harness/docs/fx-team-overlay.md`). OMO에서는 이미 있다.
- **내구 mailbox와 exactly-once 원장.** unread `<messageId>.json` → `.delivering-<messageId>.json` → 수신 세션에서 메시지가 관측된 뒤에만 `processed/<messageId>.json`으로 커밋. processed 파일이 내구 원장이다.
- **crash/reload/resume 재조정.** 모든 `session_start`가 정해진 순서의 복구 체인을 돈다: 버퍼된 완료 flush 또는 drop → reconcile(재개된 세션의 정지된 자식 부활, 내구 process 멤버 재부착) → 소유 멤버 liveness 재관측 → 오래된 예약 회수 → 미통지 완료 재배달 → await TTL 정리 → 소유 리드 poll → 상태 동기화.
- **컴팩션 중 버퍼링.** 완료 라우팅이 부모 상태에 따라 갈린다: `idle` → wake, `streaming` → 즉시 전달, `compacting`/`session_switching`/`session_shutdown` → 부모가 안정될 때까지 buffer.
- **DAG/status 저장소.** Task 스키마에 `status`(pending/claimed/in_progress/completed/deleted), `owner`, `blocks`, `blockedBy`가 있다. 다만 현재는 peer-shared board가 아니다. 6개 team board 도구는 리드에만 등록되고, 팀원 확장은 `task_send` 하나만 제공한다. 팀원은 직접 list/claim/update할 수 없다.

**"launcher만 우리 것으로 바꾸면 Taskforce 요구가 전부 OMO에 있다"는 정리는 채택하지 않는다.** 위 목록이 재사용 가능한 것의 전부이고, 그것은 **배관**이다 — persistent child, mailbox, board, 복구 체인. Taskforce가 요구하는 **의미론**은 그 위에 있고, 아래 절이 보이듯 현재 OMO에는 팀원의 중첩 위임, 역할 계약의 무조건 주입, verifier 권한 정책의 직접 전달, 팀원의 board 직접 접근이 없다. 앞의 둘과 board 접근은 소스에 경로가 없고, verifier 권한은 spawn spec/argv의 직접 전달 경로가 없지만 pretrusted project settings 우회는 아직 실측 전이다. 배관이 훌륭하다는 사실과 그 위에 우리 의미론을 얹을 자리가 있다는 사실은 다른 주장이고, 둘을 섞으면 후보 C의 비용을 실제보다 싸게 본다.

### 의미가 어긋나는 것

**사용자 roster 승인 gate가 없다.** `TeamSpecSchema`에는 사용자 승인 필드가 없다. 팀 생성은 `team_create`라는 도구 호출 한 번이고, 모델이 그것을 부를 수 있다. Taskforce는 "리드가 최소 모델·역할 배치안을 먼저 사용자에게 보고하고 승인 뒤 teammate를 띄운다"를 스킬의 정의로 갖는다.

gate를 걸어야 할 대상은 **실제로 자식을 띄우는 세 도구**다.

- `team_create` — `spawnTeamMembers`로 멤버 프로세스를 만든다.
- `task` — `manager.start`로 자식 하나(또는 `tasks:[...]` 배치)를 만든다.
- `dag` — 노드들을 병렬 wave로 실행하며 노드마다 자식을 만든다.

`task_create`는 gate 대상이 **아니다.** 이름이 비슷해 오해하기 쉽지만 `createTeamTask` → team-core `team-tasklist`의 `createTask`로 내려가는 **tasklist 레코드 생성**이다. 프로세스를 만들지 않는다. 나머지 team 도구(`team_delete`, `task_get`, `task_list`, `task_update`)도 마찬가지다.

**board는 멤버가 claim하도록 설계돼 있는데, 멤버가 그것을 부를 도구가 없다.** 이 어긋남은 두 층에서 각각 확인된다. 아래층인 team-core `team-tasklist`는 멤버 이름 단위의 claim을 제대로 구현한다 — `claimTask(teamRunId, taskId, memberName, config)`가 파일 락으로 경합을 막고 이미 claim된 것은 `AlreadyClaimedError`로, `blockedBy`가 안 풀린 것은 `BlockedByError`로 거절하며, `updateTaskStatus`는 `task.owner !== memberName`이면 `CrossOwnerUpdateError`를 던진다. 즉 **여러 peer가 하나의 board를 두고 경쟁하는 상황을 전제한 기제**다. 위층인 도구 등록은 그 전제를 따라가지 않는다 — board 도구 4개는 `buildLeadTeamTools`로 리드에만 등록되고, 그 아래 서비스 메서드는 전부 `assertOwnedTeam`으로 **호출자가 그 팀을 소유한 리드 세션인지**를 먼저 검사한다.

그 결과 **지금도 되는 것**과 **지금은 안 되는 것**이 갈린다. 리드의 `task_update`는 `owner` 파라미터를 받고 기본값만 리드다. 그러므로 리드가 멤버 이름으로 대신 claim해 주는 **리드 중개 board는 추가 코드 없이 오늘 성립한다.** 그러나 이는 팀원이 직접 접근·claim·update하는 Agent Taskforce의 shared board 요구를 충족하지 않는 축소안이다. 멤버가 스스로 board를 읽고 자기 이름으로 claim하는 경로는 도구가 없어서 막히며, gate 6에서 반드시 열어야 한다.

**역할 계약을 시스템 프롬프트로 주입할 경로가 없다.** `spawn-members.ts`의 `buildMemberPrompt`가 `member.prompt`(없으면 기본 문장)를 다른 안내 문장 넷과 이어붙여 **하나의 문자열**로 만들고, 그것이 자식의 첫 프롬프트가 된다. 시스템 프롬프트 채널이 아니다.

이 차이가 실무적으로 중요하다. `CLAUDE.md`가 복제를 정당화하는 유일한 자리로 인정한 것은 "**파일 하나가 통째로 시스템 프롬프트로 주입되는 경로**"인데, 멤버 첫 프롬프트는 그 경로가 아니다. 그리고 계약 파일 경로를 가리키는 포인터를 넣는 방식도 **보장 수단이 아니다** — 모델이 그 파일을 읽을지 여부는 모델에 달렸고, 컴팩션 뒤에 그 첫 프롬프트가 요약에 흡수되면 계약은 사라진다. 즉 현재 OMO에서 역할 계약은 "지켜지길 기대하는 텍스트"이지 "무조건 실리는 계약"이 아니다.

무조건 주입을 얻으려면 계층이 하나 더 필요하다: **역할별 멤버 확장(또는 역할별 시스템 프롬프트)** — 자식 프로세스에 확장으로 적재되어 매 턴 계약을 소유하는 형태다. 이것이 후보 C의 gate 2다.

**process 멤버는 중첩 위임을 할 수 없다.** 제약이 아니라 부재다. `createTaskComponent`의 `register`가 첫 줄에서 `if (isTeamMemberProcess()) return`으로 빠져나간다 — 즉 팀원 프로세스에서는 task component 자체가 등록되지 않고, `task`·`dag`·team 도구 11개가 전부 없다. 그 자리에 들어가는 멤버 확장(`team/member-extension/tools.ts`)은 `task_send` **하나만** 등록한다.

fx 쪽에서는 팀원이 headless로도 자기 자식을 띄우고 `inspect.wait`로 거둘 수 있음을 2026-08-21에 실측했다(`skills/agent-taskforce/runtimes/fx.md`). OMO에서는 같은 것이 설정으로 열리지 않는다 — **early return을 지나가려면 소스를 고쳐야 한다.** 이것이 후보 C의 gate 1이며, 통과 방법은 upstream 변경, fork, 또는 자식에 강제로 적재되는 우리 확장으로 도구를 되돌려 주는 것 셋뿐이다.

**persona tool policy가 멤버에서 강제되지 않는다.** curated read-only 에이전트 4개는 in-process에 고정되어 있고, `team/member-validator.ts`가 이 이름들을 팀 멤버 spec에서 **거부**한다. 거부 사유가 결정적이다 — "process-mode 스폰(멤버에 필수)은 persona 지시와 도구 allowlist를 떨어뜨린다". 즉 **읽기 전용으로 고정된 독립 검증자를 팀 멤버로 앉히는 경로가 현재 OMO에는 없다.**

**멤버별 permission을 spawn spec/argv로 전달할 경로가 없다.** 이것은 소스에서 확인된다.

- `RpcRunnerSpec`(`runners/types.ts`)의 필드는 `task_id`, `cwd`, `state_dir`, `prompt`, `resumeSessionPath`, `model`, `reasoning`, `variant`, `extensions`, `memberEnv`뿐이다. permission 관련 필드가 없다.
- `buildChildArgs`(`runners/rpc/spawn.ts`)가 만드는 argv는 `--no-extensions`, `--extension <path>`(반복), `--model`, `--thinking`뿐이다. Senpi에는 `--permission-preset`과 `--permission` 플래그가 실재하지만 OMO는 그것을 자식에 실어 보내지 않는다.
- 설정 파일 우회는 **기본값에서는** 먹지 않는다. `permissionPreset`은 전역 또는 프로젝트 범위이고, 자식은 `--mode rpc`로 뜬다. Senpi 문서는 비대화형 모드(`-p`, `--mode json`, `--mode rpc`)가 trust 프롬프트를 띄우지 않고 `defaultProjectTrust`(기본 `ask`)를 쓰며, `ask`와 `never`는 미신뢰 프로젝트 리소스를 무시한다고 명시한다. 그러나 해당 worktree의 trust 결정이 이미 저장됐거나 `defaultProjectTrust: "always"`이면 프로젝트 설정을 읽을 가능성이 있다. 전자는 멤버별 설정의 가장 싼 PoC 경로이고, 후자를 전역으로 켜는 것은 임의 저장소의 프로젝트 설정까지 신뢰하므로 기본 해법으로 삼지 않는다.

따라서 gate 3은 **pretrusted 전용 worktree 설정이 실제 RPC 멤버에서 역할별 정책으로 작동하는지 먼저 재는 문제**다. OMO가 멤버마다 다른 `worktreePath`를 `cwd`로 넘기므로, 우리가 역할별 worktree를 따로 프로비저닝하면 디렉토리별 설정이 결과적으로 역할별 정책이 될 수 있다.

이 경로에는 경계가 있다. 같은 worktree를 두 역할이 공유하면 디렉토리 단위 설정으로 역할을 구분할 수 없다. 또한 Senpi permission은 OS 샌드박스가 아니라 확인 정책이므로, verifier에는 `read-only` 프리셋의 `ask`에 기대지 않고 `edit`와 `bash`를 명시적으로 `deny`해야 한다. 이 E2E가 실패하거나 worktree 공유가 필수라면 그때 구조 변경 셋으로 올라간다 — OMO의 child argv에 Senpi `--permission-preset`/`--permission`을 전달하거나, fork하거나, 자식에 강제 적재되는 확장이 도구 호출 단계에서 거부한다.

그 PoC를 돌릴 때 정확히 해 둘 것 셋. 셋 다 Senpi 공식 문서(commit `a5eed44`)에서 나온다.

- **"디렉토리별"이 어디까지 역할별이 되는지는 우리가 정한다.** `spawnOneMember`가 멤버마다 `member.worktreePath`를 자식의 `cwd`로 넘기므로, 멤버마다 다른 worktree를 우리가 프로비저닝하면 프로젝트 설정도 멤버마다 갈린다. 남는 구멍은 **한 worktree를 두 역할이 공유하는 경우**이고, 그때는 디렉토리 단위 설정이 역할을 구분하지 못한다.
- **verifier 설정은 프리셋이 아니라 명시 규칙으로 쓴다.** `read-only` 프리셋은 `edit`/`bash`/`external_directory`를 거부가 아니라 **묻는데**, `--mode rpc` 자식에는 그 물음에 답할 사람이 없다. `"permission": {"edit": "deny", "bash": "deny"}` 형태의 플랫 규칙은 해당 권한의 모든 패턴에 적용되므로 "묻기"의 낙착을 기다리지 않아도 된다. 물론 이것도 확인 정책이지 샌드박스가 아니다.
- **trust는 permission보다 넓은 문을 연다.** 프로젝트 신뢰는 설정 파일 하나를 읽는 허가가 아니라 그 프로젝트의 리소스·패키지 설치·**프로젝트 확장 실행**까지 허용하는 것이다. 우리가 만든 멤버 worktree로 범위를 좁혀야 하는 이유이고, `defaultProjectTrust: "always"`를 전역에 켜면 임의 저장소까지 그 문이 열린다.

**구조 변경으로 갈 때의 직접 접합점은 OMO child argv다.** OMO는 `open_session`을 호출하지 않고 `senpi --mode rpc` 프로세스를 직접 띄운다. 따라서 가장 작은 upstream 변경 후보는 멤버별 permission 값을 `RpcRunnerSpec`에 넣고 Senpi의 기존 `--permission-preset`/`--permission` CLI 플래그로 전달하는 배선이다.

**`worktreePath`는 git worktree를 만들지 않는다.** 만드는 것은 평범한 디렉토리다. `spawnOneMember`가 `if (member.worktreePath !== undefined) await mkdir(member.worktreePath, { recursive: true })`를 하고, 그 경로를 자식의 `cwd`로 넘긴다. `git worktree add`는 어디에도 없다. 즉 이름이 worktree일 뿐 격리된 git 작업 트리가 아니고, 실제 worktree 생성은 호출자가 미리 해 두어야 한다.

**owner/verifier/budget/done-evidence 상태 모델이 부분적이다.** 정확히 적으면 이렇다. 예산은 **팀 런 수준으로는 있다** — 로컬 번들의 bounds 스키마가 `maxMembers` 8, `maxParallelMembers` 4, `maxMessagesPerRun` 10000, `maxWallClockMinutes` 120, `maxMemberTurns` 500을 기본값으로 갖는다. 없는 것은 (a) 위임 단위의 예산과 예산 반환 계약, (b) 완료 증거 필드, (c) owner와 verifier를 구분하는 역할 타입이다. 멤버의 `agentType`은 `leader` 아니면 `general-purpose` 둘뿐이다.

### 필요한 것 — 어댑터, 실측, 구조 변경

일부는 우리 확장만으로 되고, 일부는 OMO 쪽 구조를 건드리거나 제품 의미를 선택해야 한다. 이 구분이 후보 C의 채택 가능 여부를 가른다.

**어댑터로 되는 것**

1. **승인 gate** — 자식을 만드는 세 도구(`team_create`, `task`, `dag`)의 호출을 실행 전에 가로채, 배치안을 사용자에게 보이고 승인 전에는 통과시키지 않는다. Senpi 확장은 도구 호출을 가로채거나 막을 수 있으므로(`extensions.md`의 "Event interception — Block or modify tool calls") 접합점이 있다. `task_create` 등 tasklist 도구는 대상이 아니다.
2. **완료 증거와 예산 반환** — Task 스키마의 `metadata`가 자유 레코드이므로 여기에 실을 수 있다. 엔진이 그 값을 강제하지 않으므로 강제는 우리 어댑터가 한다.

**구조 변경 또는 선행 실측이 필요한 것 (후보 C의 gate)**

3. **gate 1 — 팀원의 중첩 위임.** `isTeamMemberProcess()` early return을 지나갈 방법이 필요하다. upstream 변경, `senpi-task`+`components/task` fork, 또는 자식에 강제 적재되는 우리 확장이 위임 도구를 다시 제공하는 것 중 하나다.
4. **gate 2 — 역할 계약의 무조건 주입.** 역할별 멤버 확장 또는 역할별 시스템 프롬프트 계층. `member.prompt`도, 계약 파일 경로 포인터도 보장 수단이 아니다.
5. **gate 3 — verifier 쓰기 차단.** 먼저 역할별 전용 worktree를 pretrust하고 프로젝트 설정에서 `edit`·`bash`를 명시적으로 `deny`한 뒤 RPC 멤버에서 E2E로 확인한다. 실패하거나 worktree 공유가 필수면 child argv 배선, fork, 또는 자식 강제 확장으로 올라간다.
6. **gate 6 — 팀원의 board 접근.** 현재 멤버는 `task_send`만 받는다. Agent Taskforce의 peer-owned shared board를 구현하려면 member extension에 최소 `task_list`/`task_get`/`task_update`와 자기 이름 기반 claim 권한을 안전하게 추가해야 한다. 리드 중개 board는 비호환 축소안일 뿐 gate 통과로 간주하지 않는다.
7. **worktree provisioning** — `worktreePath`를 채우기 전에 실제 `git worktree add`를 우리가 돌린다. OMO는 `mkdir -p`만 하므로 이것은 어댑터 쪽 추가 작업이며 gate는 아니다.

gate 1·2·6과 gate 3 PoC 실패 뒤의 해법 형태는 "자식 프로세스에 우리 확장을 강제로 적재할 수 있는가"에 크게 걸린다. 그것이 7절의 gate 4이며, **나머지 해법 형태를 결정하므로 가장 먼저 재야 한다.** 이 요구들이 모두 task internals 변경으로만 풀린다면 3절의 승격 기준에 해당한다 — 그때의 어댑터는 이름만 어댑터이고 실질은 바깥에서 하는 포크다.

---

## 7. 확정 v0 아키텍처와 구현 gate

후보 C로 구현을 시작하는 것과 component 정책은 확정됐다. 아직 확정되지 않은 것은 이 구조가 실제 런타임에서 gate 1~6을 통과하는지다. gate가 깨지면 결정을 다시 묻는 대신 3절에 미리 정한 B/A 분기를 적용한다.

```text
rubato-pi launcher (우리 것 — OMO launcher 대체)
  │  · 정확 pin: senpi@2026.8.21-3, omo-ai@5.0.0-0.beta.15
  │  · 우리 브랜드/설정 디렉토리/state 경로
  │  · exact-pinned Senpi CLI 를 직접 spawn
  │  · -e <omo-ai>/plugin/extensions/omo.js   ← 파일 단위. 디렉토리 아님
  │  · -e <우리 어댑터 확장>                   ← 반드시 OMO 다음
  │  · component disable 플래그 (gate 5 통과 시)
  ▼
Senpi engine  ◄── 우리 어댑터 확장 (승인 gate / 역할 라우팅 /
  │                                verifier 권한 / 완료 증거 / worktree)
  ▼
OMO 확장 (설치만, 포크 없음)
     ON 6: config-startup · ast-grep · lsp · task · memory · config-watch
     OFF 12: 1절의 기본 OFF 10개 + 보류 2개
     OMO 스킬은 파일 단위 적재로 자동 배제 (실측)
```

구성 요소별로.

**정확 pin.** `omo-ai`가 이미 `@code-yeongyu/senpi`를 정확 버전으로 pin 하고 launcher가 self-update를 거부한다. 우리는 그 위에 `omo-ai` 자체도 정확 버전으로 고정한다. 근거는 이 레포가 이미 아는 실패 모양이다 — 파일 diff가 깨끗하고 빌드가 통과하는데 의미만 틀어지는 조용한 실패(`harness/README.md` "머지 절차"). Senpi 릴리스 빈도가 높다(npm에 122개 버전, 최근 5일에 6개)는 점이 이 선택을 더 강하게 만든다.

**선택된 6개만 ON.** `config-startup`, `ast-grep`, `lsp`, `task`, `memory`, `config-watch`를 켠다. 기본 OFF 10개와 보류 2개는 `omo-senpi-<name>-disabled`로 끄되, 그 플래그를 실제로 세울 수 있는지가 gate 5다. `task`는 후보 C의 기반이고, 나머지 5개는 사용자가 기능 단위로 유지하기로 한 component다.

**확장 적재 형태 — 파일 단위 `-e`가 답이다 (실측).** 이 자리가 앞선 초안이 틀렸던 곳이고, 이번에 실측으로 뒤집힌 곳이다.

앞선 초안은 settings `packages`에 객체 형태 필터(`{"source": "...", "skills": [], "extensions": ["..."]}`)로 설치해 스킬을 걸러 내자고 추천했다. **그 추천을 내린다.** 소스를 보면 그 경로는 자식 상속을 깨뜨린다.

- `team-service.ts`가 멤버 확장을 조립할 때 `inheritedExtensions: parseExtensionEntries(process.argv)`를 쓴다. 이름 그대로 **부모 argv의 `-e`/`--extension` 항목만** 긁는다.
- `buildChildArgs`(`runners/rpc/spawn.ts`)는 argv를 `--no-extensions`로 시작한 뒤 그 긁어온 항목만 `--extension`으로 다시 붙인다. 소스 주석이 명시한다 — 자식은 "부모의 패키지 세트 전체를 자동 적재하지 않는다".

settings로 적재된 확장은 `process.argv`에 없다. 따라서 `parseExtensionEntries`가 빈 배열을 돌려주고 멤버 자식은 `--no-extensions`만 받은 채 뜬다.

**대신 파일 단위 `-e`가 스킬 문제와 argv 문제를 동시에 푼다.** 로컬 beta.7을 RPC 모드로 띄워 `get_commands`로 명령·스킬 표면을 읽어 셋을 비교했다.

| 적재 형태 | 확장 명령 | 스킬 |
|---|---|---|
| `-e` 없음 (기준선) | 22 | 26 (전부 `~/.agents/skills/`의 우리 것) |
| `-e <plugin>/extensions/omo.js` (**파일**) | 38 (+16 OMO) | **26 — 기준선과 동일** |
| `-e <plugin>` (**디렉토리**) | 38 (+16 OMO) | 48 (+22 OMO) |

파일 하나를 지정하면 OMO component와 그 명령(`/tasks`, `/task-kill`, memory 계열 등)은 전부 등록되면서 **매니페스트의 `pi.skills`는 따라오지 않는다.** 디렉토리를 지정하면 Pi 패키지 규약이 적용되어 스킬 22개가 함께 실린다. OMO launcher가 하는 것이 후자이므로, **우리 launcher는 반드시 전자로 대체해야 한다.**

`--no-skills`는 쓰지 않는다. 스킬 발견 자체를 끄므로 **우리 스킬 26개까지 죽인다** — Senpi는 `~/.agents/skills/`를 전역 스킬 위치로 읽으며 이 레포의 정본이 거기 있다(`CLAUDE.md`). 위 표의 두 번째 행이 보여 주듯 파일 단위 적재는 `--no-skills` 없이도 원하는 결과를 준다.

**`-e` 순서가 의미를 갖는다.** `buildChildArgs`에 이런 분기가 있다 — DAG가 소유한 자식은 상속받은 확장 목록에서 `slice(1)`로 **첫 항목을 버린다.** 주석이 이유를 밝힌다: "The OMO launcher prepends its own extension before user/provider entries" — 즉 첫 항목이 OMO 확장이라고 가정하고, DAG 자식이 또 다른 task 엔진을 부팅하지 못하게 막는 것이다. 우리 launcher도 이 가정을 지켜야 한다. **OMO 확장을 첫 `-e`로, 우리 어댑터 확장을 그 뒤로 둔다.** 순서를 뒤집으면 DAG 자식이 우리 어댑터를 잃고 OMO task 엔진은 유지하게 되어, 의도와 정확히 반대가 된다.

**자식 종류마다 확장 목록이 다르게 조립된다.** `slice(1)`이 어디에 걸리는지를 오해하지 않으려면 세 갈래를 나눠 봐야 한다. 셋 다 소스에 있다.

- **일반 `task` 자식** — 시작 spec에 `extensions`가 없으므로 process 러너가 자기 `inheritedExtensions`(= 부모 argv의 `-e` 항목)를 채워 넣는다(`engine-runners.ts`의 `new RpcProcessRunner({ inheritedExtensions: parseExtensionEntries(process.argv) })`). 이 자식은 멤버가 아니므로 `isTeamMemberProcess()`가 거짓이고, **task component가 등록되어 중첩 위임이 된다.** 막히는 것은 팀 멤버와 DAG 자식이지 모든 자식이 아니다.
- **DAG 자식** — 같은 목록을 받되 현재 `buildChildArgs`가 `slice(1)`로 첫 OMO extension 전체를 버린다. 이 동작은 중첩 task 엔진을 막지만 `ast-grep`·`lsp`·`memory` 등 사용자가 유지한 비-task component까지 함께 제거하므로 최종 정책이 아니다.
- **팀 멤버** — `assembleMemberExtensions(entryPath, inherited)`가 **멤버 확장 번들(`omo-member.js`)을 첫 항목으로** 두고 그 뒤에 상속분을 붙인다. 멤버는 DAG 소유가 아니므로 `slice(1)`이 적용되지 않고, 목록 전체가 실린다. 반대로 멤버가 아닌 자식에서는 `buildChildProfile`이 그 번들을 목록에서 걸러 내고 멤버 식별 env(`SENPI_TASK_MEMBER` 등)도 지운다 — 이것이 6절이 말한 "같은 운반체, 다른 계약"의 구현체다.

소스만 보면 우리 어댑터 확장은 세 갈래 모두에 실린다(DAG 자식에서는 OMO가 대신 빠진다). gate 1·2·6과 gate 3 PoC 실패 뒤의 해법으로 "자식에 강제 적재되는 우리 확장"을 검토할 수 있는 근거가 이것이고, **동시에 현재 DAG 배선이 확정 component 정책과 충돌한다는 증거**다.

**여전히 안 재 본 것 — gate 4.** 위 실측은 전부 **리드 프로세스 한 개**에서 잰 것이다. 팀원 자식이 부모의 명시적 `-e` 항목과 disable 플래그를 실제로 그대로 물려받는지는 **E2E로 확인하지 않았다.** 소스상 `-e` 항목은 `parseExtensionEntries`가 긁어 `buildChildArgs`가 다시 붙이므로 상속될 것으로 보이지만, disable 플래그는 argv에서 긁히는 대상이 아니다 — `parseExtensionEntries`는 `-e`/`--extension`만 본다. 즉 부모에서 `memory`를 껐어도 **자식은 그것을 모른 채 뜰 수 있다.** 이것은 추측이며, 재야 안다.

**gate 4는 다음 셋을 한 번에 만족하는 것이다.**

1. 파일 단위 `-e`로 띄운 리드에서 팀원을 스폰했을 때, 자식 argv에 같은 확장 경로가 실린다.
2. 부모의 component disable 상태가 자식에도 동일하게 적용된다 (아니라면, 자식에 그 상태를 전달하는 것이 우리 어댑터의 일이 된다).
3. 리드·일반 `task` 자식·팀 멤버는 ON 6/OFF 12를 따른다. DAG 자식은 재귀 task 엔진을 막기 위해 `task`만 OFF로 두되, 나머지 선택 component 5개(`config-startup`, `ast-grep`, `lsp`, `memory`, `config-watch`)는 유지한다. 현재의 OMO extension 전체 `slice(1)`은 이 조건을 통과하지 못하므로 child extension 조립 또는 component-filtered 배선을 고쳐야 한다.

**gate 5 — disable 플래그를 세울 수 있는가.** 4절이 적은 대로, 플래그가 소스에 있다는 것과 우리가 그것을 세울 수 있다는 것은 다르다. 로컬 beta.7에서는 CLI 인자로 세워지지 않았다. dev에서 다시 재야 하고, 만약 dev에서도 안 되면 component를 끄는 수단이 사라지므로 후보 C의 "필요한 것만 켠다"는 전제 자체가 무너진다. 그때의 대안은 셋이다 — 플래그를 세울 다른 경로를 찾거나(설정 파일, 환경변수), 원하지 않는 component가 켜진 채로 사는 비용을 받아들이거나, 후보 B로 올라간다.

### gate 요약

| gate | 무엇이 걸려 있나 | 상태 | 깨지면 |
|---|---|---|---|
| 1 | 팀원의 중첩 위임 (`isTeamMemberProcess()` early return) | 소스로 **불가 확정**. 해법을 만들어야 함 | 후보 B로 (범위: `senpi-task` + `components/task`) |
| 2 | 역할 계약의 무조건 주입 (역할별 확장/시스템 프롬프트 계층) | 소스로 **경로 부재 확정** | 후보 B로 |
| 3 | 멤버별 permission (spawn spec/argv에 경로 부재) | pretrusted 전용 worktree E2E **미측정** | 실패 또는 worktree 공유 필수 시 child argv 배선·후보 B 검토 |
| 4 | 자식의 확장·disable 정책과 DAG의 task-only 제외 | DAG가 OMO 전체를 버리는 **정책 충돌은 소스로 확정**, 나머지 자식 상속은 미측정 | 상속 자체가 안 되면 A 재검토, component-filtered child profile이 내부 변경을 요구하면 B 검토 |
| 5 | component disable 플래그를 세울 수 있는가 | beta.7에서 **실패**, dev 미측정 | 대안 경로 탐색 → 없으면 후보 B로 |
| 6 | 팀원의 board 직접 list/get/update/claim 제공 | 소스로 **현재 경로 부재 확정** | 제공할 수 없으면 후보 B로 |

스킬 차단은 더 이상 gate가 아니다 — 파일 단위 `-e`로 해결되는 것이 실측됐다.

**component allowlist와 update gate.** allowlist는 코드가 아니라 설정으로 둔다 — launcher가 조립하는 플래그 목록이며, 그것이 실제로 먹는지가 gate 5다. 그리고 **버전을 올릴 때 component 목록의 diff를 먼저 본다** — upstream이 component를 추가하면 새 것은 기본적으로 켜져서 들어오기 때문이다(`compose.ts`가 각 플래그의 default를 `false`로, 즉 "비활성화 안 함"으로 등록한다). 갱신 절차는 `component-list.ts`를 이전 pin과 대조하고, 늘어난 이름을 4절 카탈로그에 추가한 뒤 결정 칸을 비운 채로 사용자에게 올리는 것이다.

**Taskforce role/member 어댑터.** 6절 마지막의 목록 중 어댑터로 되는 둘(승인 gate, 완료 증거·예산)은 우리 코드로 우리 레포에 둔다. gate 1·2·6과 gate 3 PoC 실패 뒤의 구조 해법은 gate 4의 자식 확장 상속을 확인한 뒤에야 가장 작게 정할 수 있다.

**전용 brand/state/launcher.** OMO launcher가 주입하는 것(`SENPI_BRAND`, `SENPI_CODING_AGENT_DIR`, `OMO_NATIVE`)을 우리 값으로 바꿔 넣는 얇은 launcher를 쓴다. 상태 디렉토리를 분리하는 것이 특히 중요하다 — OMO 설치물과 상태를 공유하면 두 제품이 같은 세션·인증 파일을 만진다.

---

## 8. 업데이트·검증 전략과 관측 지표

### 업데이트 절차 (제안)

1. pin 후보 버전의 `component-list.ts`를 현재 pin과 대조한다. 늘거나 준 이름이 있으면 4절을 갱신하고 결정 칸을 비운 채 사용자에게 올린다.
2. Senpi 쪽은 `packages/coding-agent/CHANGELOG.md`에서 컴팩션·캐시·권한·확장 API 항목만 훑는다. 이 넷이 우리 어댑터가 기대는 계약이다.
3. 아래 지표를 올리기 전과 후에 각각 재고, 회귀가 있으면 pin을 되돌린다.

### 실제로 관측할 지표

| 무엇을 | 어떻게 재는가 | 무엇이 실패인가 |
|---|---|---|
| cache hit | Senpi 세션 로그의 `kind` 라인. `SENPI_SESSION_DEBUG=1`로 stderr 미러 | `flatten`이 반복되면 레인이 대화 전체를 재전송 중이다 |
| prompt tokens | component ON/OFF 조합별 첫 요청의 입력 토큰 | 도구·에이전트 정의가 접두를 부풀려 캐시 접두가 흔들린다 |
| compaction continuity | 컴팩션 전후로 팀 런이 끊기지 않는지. 완료 라우팅이 `compacting`에서 buffer 하는지 | 컴팩션 중 도착한 완료 알림이 사라진다 |
| crash/resume | 리드 프로세스를 죽인 뒤 세션 재개. 정지된 자식이 부활하고 process 멤버가 재부착되는지 | 자식이 `lost`로 떨어지거나 원 프롬프트를 재실행한다 |
| mailbox exactly-once | 주입과 커밋 사이에서 프로세스를 죽인 뒤 재시작. `processed/<messageId>.json` 원장으로 중복 판정 | 같은 메시지가 두 번 관측된다 |
| nested helper | gate 1을 통과시킨 뒤 process 멤버가 자기 자식을 띄우는지 (fx에서는 2026-08-21 실측으로 가능). **현재 upstream 상태에서는 재 볼 것도 없이 불가**이므로, 이 항목은 gate 1의 해법을 넣은 뒤의 회귀 지표다 | 해법을 넣어도 멤버가 `task_send`만 받는다 |
| verifier write deny | gate 3. pretrusted 전용 worktree의 프로젝트 설정에서 `edit`·`bash`를 명시적으로 deny하고 verifier RPC 멤버에게 쓰기를 시킨다. 실패하면 구조 해법 뒤에 반복한다 | 거부되지 않고 파일이 써진다. 권한 계층은 확인 정책일 뿐이라는 5절의 한계도 함께 본다 |
| 자식의 확장 상속 | gate 4. 파일 단위 `-e`로 띄운 리드에서 팀원을 스폰하고 자식 argv를 확인한다. 리드 쪽 표면은 RPC `get_commands`로 이미 쟀으므로(7절), 남은 것은 자식이다 | 자식이 `--no-extensions`만 받고 뜬다 |
| 자식의 disable 상태 상속 | gate 4. 부모에서 특정 component를 끈 뒤 자식의 명령 표면에 그것이 남아 있는지 | 자식이 부모가 끈 component를 켠 채로 뜬다. `parseExtensionEntries`가 `-e`만 긁으므로 이쪽이 실패할 가능성이 더 크다 |
| disable 플래그 반응 | gate 5. dev pin에서 `--omo-senpi-<name>-disabled`를 붙이고 `get_commands`의 명령 표면 차이를 본다 | 플래그를 붙여도 표면이 그대로다 (beta.7에서 실제로 이랬다) |
| team board 접근 | gate 6. 팀원이 직접 list/get/update하고 자기 이름으로 claim하는 시나리오를 실행. 리드 중개는 호환 판정에서 제외한다 | 팀원이 자기 작업 상태를 갱신할 수 없거나 권한 범위를 넘어 다른 owner의 task를 claim/update한다 |

### 팀원 모델 확인

fx 어댑터가 이미 요구하는 것이 여기서도 그대로 적용된다: **모델 id가 실제로 어디에 닿는지 실제 호출로 확인한 뒤에 그 역할을 맡긴다.** 카탈로그에 이름이 보이는 것은 그 모델이 뜬다는 증거가 아니고, 독립 검증자가 조용히 owner와 같은 모델이면 검증이 아니다(`skills/agent-taskforce/runtimes/fx.md`).

---

## 9. 라이선스와 배포 제약

두 저장소의 라이선스가 다르며, 이 차이가 후보 선택에 실제로 영향을 준다.

**Senpi (`code-yeongyu/senpi`) — MIT.** npm 패키지 메타데이터와 GitHub 저장소 메타데이터 양쪽에서 MIT. 재배포·상업 이용에 제약이 없다.

**OMO (`code-yeongyu/oh-my-openagent`) 루트 — Sustainable Use License v1.0.** 원문의 Limitations가 정하는 범위는 이렇다.

- 소프트웨어를 **자신의 내부 업무 목적, 비상업적 목적, 개인 용도로만** 사용하거나 수정할 수 있다.
- 타인에게 배포하거나 제공하려면 **무상이고 비상업적 목적**이어야 한다.
- 라이선스·저작권 고지를 변경·제거·은폐할 수 없다.
- 제3자 구성요소는 각자의 원래 라이선스를 따른다.

**OMO plugin 하위(`plugin/LICENSE`)는 MIT지만 범위가 좁다.** 그 MIT는 "Senpi LSP adapter descriptor, schema, renderer, path extraction, post-edit wiring, migration-warning helper 부분"에만 적용된다고 명시한다. plugin 디렉토리 전체가 MIT라는 뜻이 아니다.

실무적 귀결.

- **개인·내부 사용은 셋 다(A/B/C) 문제없다.** 지금 rubato-pi의 용도가 이것이라면 라이선스는 후보 선택을 좌우하지 않는다.
- **외부 배포나 상업 제공을 하려면** OMO 코드를 포함한 후보 B와 C가 막힌다. C의 경우 우리가 배포하는 것이 "설치 지시와 우리 어댑터뿐"이라면 우리 배포물에는 OMO 코드가 없다 — 그러나 **이것은 법률 판단이며 이 문서가 결론 내릴 수 없다.** 배포 계획이 생기면 별도로 확인한다.
- 후보 A만이 이 제약에서 완전히 자유롭다. 배포 계획이 전제로 깔린다면 A의 상대적 가치가 올라간다.
- 브랜드 교체는 라이선스 고지 제거와 다르다. `SENPI_BRAND`를 우리 값으로 바꾸는 것은 설정 주입이지만, LICENSE·NOTICE 파일을 지우는 것은 명시적 금지 사항이다.

---

## 10. 구현 gate와 반환 계약

### 고정된 결정

1절의 component 정책, 후보 C 우선, exact pin, 기존 rubato와 병행, 내부 사용 범위는 확정됐다. 구현 세션은 이 결정을 다시 묻거나 추천값으로 되돌리지 않는다.

정책 해석은 다음과 같다.

- **ON**은 launcher와 모든 자식에서 실제로 등록되어 동작해야 한다.
- **OFF**는 리드와 모든 자식의 명령·도구·프롬프트 표면에서 빠져야 한다.
- **보류**는 v0에서 OFF다. `ultrawork`와 `comment-checker`를 임의로 켜지 않는다.
- 새 upstream component는 결정 전까지 OFF다. update gate가 이를 강제해야 한다.

### gate 1~6 — 모두 완료해야 후보 C 구현이 끝난다

gate 3·4·5는 먼저 실측할 가장 싼 경로가 있고, 1·2·6은 해법이 필요하다. 순서는 4 → 5 → 3 → 6 → 1 → 2가 자연스럽다 — 확장 상속과 component 차단이 성립해야 나머지 해법 형태를 결정할 수 있다.

- ☐ **gate 4** — 파일 단위 `-e`로 띄운 리드에서 스폰한 팀원 자식이 (a) 같은 확장 경로를 상속받는가, (b) 부모의 component disable 상태도 물려받는가. (7절, 8절)
- ☐ **gate 5** — dev pin에서 `--omo-senpi-<name>-disabled`가 실제로 component를 끄는가. 안 되면 어떤 경로로 세울 것인가. (4절, 7절)
- ☐ **gate 3** — pretrusted 역할별 전용 worktree의 명시적 `edit`·`bash` deny가 RPC 멤버에서 작동하는가. 실패하거나 worktree 공유가 필수면 child argv 배선 / fork / 자식 강제 확장 중 어디로 올라갈 것인가. (6절)
- ☐ **gate 6** — member extension에 `task_list`/`task_get`/`task_update`와 자기 이름 기반 claim을 어떤 권한으로 제공할 것인가. 리드 중개는 비호환 축소안이다. (6절)
- ☐ **gate 1** — 팀원 프로세스의 `isTeamMemberProcess()` early return을 어떤 방법으로 지나갈 것인가. upstream 변경 / fork / 자식 강제 확장 중 무엇인가. (6절)
- ☐ **gate 2** — 역할 계약을 무조건 주입하는 계층을 어떤 형태로 만들 것인가. 역할별 멤버 확장인가, 역할별 시스템 프롬프트인가. (6절)
- ☐ **승격 판정** — 3절의 승격 기준 둘 중 하나에 걸리면 그 자리에서 후보 C를 중단하고 증거와 함께 후보 B 또는 A 분기를 적용한다. 구현 세션이 이 판정을 소유한다.

### 완료 증거

- ☐ `rubato-pi` launcher와 alias가 Node.js 24 이상에서 뜨고 기존 `rubato`·`omo`의 설정과 state를 건드리지 않는다.
- ☐ exact pin과 OMO 파일 단위 `-e` 적재가 런타임 출력에서 확인된다. OMO 스킬은 0개 추가되고 기존 Taskforce 스킬은 남는다.
- ☐ 리드·일반 `task` 자식·팀 멤버는 ON 6/OFF 12이고, DAG 자식은 `task`만 추가로 OFF이며 선택된 비-task component 5개는 유지된다.
- ☐ 사용자 승인 전에는 `team_create`·`task`·`dag`가 자식을 만들지 않는다.
- ☐ 역할 계약이 owner/verifier의 system prompt 또는 매 턴 강제 extension 계층에 무조건 실리고 컴팩션 뒤에도 잔존하며, verifier의 `edit`·`bash`가 실제로 거부된다.
- ☐ 팀원이 자기 자식을 위임하고 회수할 수 있으며, shared board를 직접 list/get/claim/update한다. 다른 owner의 작업 변경은 거부된다.
- ☐ 실제 git worktree가 멤버별로 생성·정리되고 평범한 디렉토리를 worktree로 오인하지 않는다.
- ☐ 완료 증거와 위임 단위 예산·예산 반환이 task metadata 또는 동등한 내구 상태에 남는다.
- ☐ crash/reload/resume, mailbox exactly-once, compaction 중 완료 버퍼링을 실제 프로세스 종료·재시작으로 통과한다.
- ☐ `memory` ON 상태의 첫 요청 토큰, 안정 상태 토큰, 컴팩션 전후 연속성, background dreaming 자식, 캐시 `bootstrap/delta/flatten` 로그를 기록한다.
- ☐ 보류 2개는 OFF이며 재활성화 방법과 측정 항목만 문서화된다.
- ☐ live Agent Taskforce 스킬에 Pi runtime adapter를 추가하고 `./snapshot.sh`로 이 레포에 동기화한다.
- ☐ 단위 테스트, 통합 테스트, 실제 모델을 사용한 한 번의 end-to-end 팀 lifecycle smoke test가 모두 통과한다.

### 별도 세션의 예산과 반환

- 구현 세션의 시간 예산은 **8시간**이다. 8시간에 도달하면 미완료여도 그때까지 통과한 gate, 실패 증거, 변경 파일, 재현 명령, 다음 최소 작업을 반환하는 것이 유효한 완료다.
- definitive 권한·인증·라이선스 거부는 한 번 확인한 뒤 반환한다. 우회 조사로 범위를 넓히지 않는다.
- 후보 C의 승격 조건에 걸리면 우회를 계속 쌓지 않는다. 현재 변경을 보존하고, 어떤 조건이 깨졌는지와 B/A 중 권고 분기를 반환한다.
- 코드·테스트·런타임이 이 문서의 레포 좌표나 원인 설명과 충돌하면 코드·테스트·런타임 증거가 우선한다. 단, 1절의 사용자 결정과 write boundary를 바꾸지는 않는다.

---

## 11. 근거 링크

### upstream 고정 링크 (OMO, commit `024cd9fe0374a87e0d17f540d229f3e087059385`, `dev`, 2026-08-21, release v5.0.0-beta.15)

- 저장소: https://github.com/code-yeongyu/oh-my-openagent
- component 목록과 등록 순서: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/extension/component-list.ts
- 전역·개별 disable 플래그 배선: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/extension/compose.ts
- component별 동작 서술: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/AGENTS.md — **산문이 코드보다 낡은 자리가 있다.** anatomy 표는 "Fifteen live components"라고 하지만 `component-list.ts`는 18개를 반환하고, `memory` 항목은 "ten slash commands"라고 하지만 `MEMORY_COMMAND_NAMES`는 13개다. 개수를 인용할 때는 코드를 본다
- task/team 엔진 계약(실행 모드, 배달 모델, 복구 체인, curated 에이전트): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/AGENTS.md
- curated 이름의 팀 멤버 거부: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/member-validator.ts
- 도구 11개 등록과 팀원 프로세스 early return (`isTeamMemberProcess()`, `registerTaskTools`, `registerDagTool`, `registerTeamTools`): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/task/index.ts
- `dag` 도구 이름과 설명: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/task/dag-tool.ts
- 멤버 spawn — `worktreePath`의 `mkdir -p`, `buildMemberPrompt`, 확장 조립: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/spawn-members.ts
- 멤버 확장 조립 함수: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/member-extensions.ts
- 리드 전용 team board 도구 등록 (`buildLeadTeamTools` 6개): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/tools/team/index.ts
- board 도구 4개의 파라미터 — `task_update`의 `owner`가 선택이고 기본값이 리드: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/tools/team/tasks.ts
- `team_create`가 spawn 결과(멤버 이름·status·task_id)만 반환하는 자리: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/tools/team/lifecycle.ts
- 멤버 이름 단위 claim의 실제 기제 (파일 락, `AlreadyClaimedError`, `BlockedByError`): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/team-core/src/team-tasklist/claim.ts
- cross-owner 상태 변경 거부 (`task.owner !== memberName`): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/team-core/src/team-tasklist/update.ts
- board 서비스가 소유 리드만 통과시키는 `assertOwnedTeam`: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/task/team-service.ts
- 모든 process 자식이 부모 argv 확장을 상속하는 자리 (`new RpcProcessRunner({ inheritedExtensions })`): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/task/engine-runners.ts
- 멤버 식별 env 이름과 `isTeamMemberProcess` 판정: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/member-extension/identity.ts
- 팀원 확장이 `task_send`만 등록하는 진입점: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/member-extension/index.ts
- `inheritedExtensions: parseExtensionEntries(process.argv)` 호출부: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/task/team-service.ts
- argv에서 `-e`/`--extension`만 긁는 파서: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/runners/rpc/parent-extensions.ts
- 자식 argv 구성 (`--no-extensions` + `--extension` + `--model` + `--thinking`, permission 없음): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/runners/rpc/spawn.ts
- `RpcRunnerSpec` 필드 목록: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/runners/types.ts
- 멤버 확장의 유일한 도구 `task_send`: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/member-extension/tools.ts
- `task_create`가 tasklist 레코드 생성임을 보이는 경로: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/senpi-task/src/team/tasks.ts
- memory 슬래시 명령 13개 (`MEMORY_COMMAND_NAMES`): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/memory/commands/register.ts
- TeamSpec / Member / Task 스키마: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/team-core/src/types.ts
- `native-badge` 구현: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/native-badge/index.ts
- `onboarding` 구현: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/onboarding/component.ts
- `init-deep-advisor` 구현: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/init-deep-advisor/component.ts
- `ast-grep` 구현: https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/packages/omo-senpi/src/components/ast-grep/index.ts
- 루트 라이선스 (Sustainable Use License v1.0): https://github.com/code-yeongyu/oh-my-openagent/blob/024cd9fe0374a87e0d17f540d229f3e087059385/LICENSE.md
- 텔레메트리 문서: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/senpi-telemetry.md
- 릴리스: https://github.com/code-yeongyu/oh-my-openagent/releases

### Senpi 공식 문서 (`code-yeongyu/senpi`, commit `a5eed44536f3024c5740dc3dfff4ffe0bb08b717`)

문서는 `main`이 아니라 이 commit으로 고정한다. `main`을 가리키면 다음에 읽는 사람이 보는 문장이 우리가 근거로 삼은 문장과 달라도 그 사실이 드러나지 않는다.

- 저장소 (MIT): https://github.com/code-yeongyu/senpi
- 문서 색인: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/index.md
- 설정 — 권한(프리셋 넷, 명시 규칙, "마지막에 맞는 규칙이 이긴다", 확인 정책이지 샌드박스가 아님), Project Trust와 `defaultProjectTrust`(전역 전용, 비대화형 모드의 낙착), 컴팩션, 프롬프트 캐시, Resources/packages 필터: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/settings.md
- 컴팩션 — 트리거, 컷 포인트, `manual`/`threshold`/`overflow`, 확장 훅: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/compaction.md
- 프로바이더 — 세션 affinity, 레인별 캐시 TTL, 세션 로그 `flatten` 관측: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/providers.md
- 확장 API — 도구 호출 가로채기, 모델 fallback, 세션 영속: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/extensions.md
- 영속 터미널 도구: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/terminal-tools.md
- 스킬 — 적재 위치(`~/.agents/skills/` 포함), `--no-skills`: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/skills.md
- 패키지 — 소스 종류, 객체 형태 필터링. **이 필터 방식은 7절에서 기각됐다**(settings 경로로 적재된 확장은 `process.argv`에 없어 팀원 자식이 상속하지 못한다): https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/packages.md
- RPC 모드 프로토콜 — `get_commands`, `get_loaded_surfaces`(로컬 실측이 쓴 관측 창구): https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/rpc.md
- 사용법 — 컨텍스트 파일, CLI 플래그: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/usage.md
- changelog — 요약 재시도 예산과 speculative warm-up, project rule 중복 제거, 스킬 심링크 중복 제거: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/CHANGELOG.md

### npm

- `omo-ai` (beta 채널: `5.0.0-0.beta.15` → `@code-yeongyu/senpi@2026.8.21-3`): https://www.npmjs.com/package/omo-ai — 레지스트리 원본 https://registry.npmjs.org/omo-ai
- `@code-yeongyu/senpi` (latest `2026.8.21-3`, MIT): https://www.npmjs.com/package/@code-yeongyu/senpi — 레지스트리 원본 https://registry.npmjs.org/@code-yeongyu%2Fsenpi

npmjs.com 웹 페이지는 브라우저가 아닌 요청을 403으로 막으므로, 버전·라이선스 확인은 위 레지스트리 JSON으로 한다.

### 로컬 설치물 (`omo-ai@5.0.0-0.beta.7`, embedded Senpi `2026.8.12-4`)

- `/opt/homebrew/lib/node_modules/omo-ai/package.json` — 버전과 엔진 pin
- `/opt/homebrew/lib/node_modules/omo-ai/bin/lib/launcher.js` — `brandProfile()`, `senpiEnvironment()`, `spawnSenpi()`, self-update 차단
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/package.json` — `pi.extensions`, `pi.skills`
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/README.md` — component 비활성화 안내, LSP 마이그레이션. **스킬 개수는 19라고 적지만 실측 22다** (아래 실측 참조)
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/LICENSE`, `plugin/NOTICE` — 부분 MIT의 적용 범위
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/extensions/omo.js` — 번들. 텔레메트리 이벤트 스키마와 opt-out env, ultrawork 지시문, beta.7의 component 등록 집합
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/extensions/omo-task.js` — 번들. 팀 bounds 기본값, `worktreePath`에 일반 디렉터리를 `mkdir -p`할 뿐 git worktree는 생성하지 않음

### 로컬 실측 (2026-08-22, `omo-ai@5.0.0-0.beta.7` + Senpi `2026.8.12-4`)

7절의 적재 형태 비교표와 2절의 disable 플래그 결과는 다음 절차로 얻었다. 재현하려면 같은 절차를 dev pin에 대고 다시 돌린다.

1. Senpi CLI(`<omo-ai>/node_modules/@code-yeongyu/senpi/dist/cli.js`)를 `--mode rpc --no-context-files --no-prompt-templates`로 띄운다. 적재 형태별로 `-e` 인자만 바꾼다.
2. 부수효과 격리: `SENPI_CODING_AGENT_DIR`를 빈 임시 디렉토리로, `PI_OFFLINE=1`, `DO_NOT_TRACK=1`, `OMO_DISABLE_POSTHOG=1`, cwd도 빈 임시 디렉토리로 둔다. 실제 `~/.omo`나 `~/.senpi`는 건드리지 않는다.
3. stdin으로 `{"type":"get_commands"}`를 보내고 응답의 `commands` 배열을 `source`별로 센다. `source: "skill"` 행이 적재된 스킬, 나머지가 확장 명령이다. `{"type":"get_loaded_surfaces"}`가 적재된 확장·MCP 목록을 준다. **모델 호출이 없으므로 비용이 들지 않는다.**
4. disable 플래그는 같은 절차에 `--omo-senpi-<name>-disabled` 형태의 인자를 추가하고 명령 표면의 차이를 본다. 알 수 없는 플래그는 CLI가 `Unknown option`으로 거부하므로, 거부되지 않았는데 표면이 그대로면 "인식은 되지만 반영되지 않는" 상태다 — beta.7이 이 상태였다.

RPC 명령 규약(`get_commands`, `get_loaded_surfaces`, `source: "skill"` 행)의 근거: https://github.com/code-yeongyu/senpi/blob/a5eed44536f3024c5740dc3dfff4ffe0bb08b717/packages/coding-agent/docs/rpc.md

### 이 레포

- `harness/README.md` — 기존 rubato 구조, 프로바이더별 캐시 레버 실측, upstream 머지 시 스키마 버전 대조 절차
- `harness/docs/fx-team-overlay.md` — fx Team Overlay가 무엇을 만들었고 무엇을 만들지 않았는가
- `skills/agent-taskforce/runtimes/fx.md` — 런타임 어댑터 계약, headless 위임 실측(2026-08-21), 모델 id 확인 요구
- `CLAUDE.md` — 정본과 스냅샷의 방향, 개선의 비용 사다리, 복제 금지 원칙과 그 예외, 은어 사용 규칙
