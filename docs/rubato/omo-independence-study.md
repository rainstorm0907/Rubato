# Rubato의 OMO 독립화 검토 기준

이 문서는 OMO를 제거하자는 결론문이 아니다. 다음 세션이 현재 경계를 다시 증명하고,
대체재의 이름이 아니라 Rubato가 이미 보장하는 계약을 기준으로 독립화 여부와 순서를
판정하기 위한 작업 기준이다.

## 출발점

사용자가 확인한 핵심 사실은 다음과 같다.

- Rubato에서 켜는 기능은 `ast-grep`, `lsp`, `task`, `memory` 네 개다.
- 네 기능은 이름만 빌려 쓰는 upstream 기능이 아니라 Rubato에서 크게 고친 소유 코드다.
- 따라서 “기능을 쓰려면 OMO 전체를 유지해야 한다”는 전제는 성립하지 않는다.
- 반대로 Pi용 공개 extension이 존재한다는 이유만으로 현재 구현을 교체해도 된다는 결론도
  성립하지 않는다. 특히 Task와 memory의 현재 계약은 일반적인 예제보다 훨씬 넓다.
- 사용자는 독립화를 섣불리 설계하지 말고, 근거와 이행 비용을 신중하게 검토하라고 했다.

이번 검토가 답해야 할 질문은 하나다.

> OMO가 현재 제공하는 실제 런타임 가치를 기능 구현, Senpi 어댑터, 조립·배포 껍데기로
> 나눴을 때, Rubato가 어느 층을 그대로 소유하고 어느 층만 안전하게 걷어낼 수 있는가?

## 2026-08-27 현재 확인된 사실

### 실행 경로

```text
Rubato launcher
  -> harness/rubato-pi/src/engine-paths.mjs
  -> repo root node_modules/@code-yeongyu/senpi/dist/cli.js
  -> ~/.rubato-pi/engine/plugin/extensions/omo.js
  -> packages/omo-senpi의 빌드 산출물
  -> ast-grep / lsp / task / memory 등록
```

- Senpi 본체는 레포 루트 `node_modules`의 pinned·patched 사본을 실행한다.
- extension은 `harness/scripts/build-engine.mjs`가 레포 밖
  `~/.rubato-pi/engine/plugin`에 만든 산출물을 실행한다.
- `packages/omo-senpi/plugin/extensions/`는 실행 산출물의 정본이 아니다.
- `harness/rubato-pi/node_modules/@code-yeongyu/senpi`는 npm `omo-ai`가 끌고 온 중첩
  사본이며 현재 launcher 경로에서는 실행되지 않는다. 이전 감사에서 이 사본을 실제
  런타임으로 오인해 false negative가 한 번 발생했다.

이 경로를 바꾸는 설계는 `harness/rubato-pi/src/engine-paths.mjs`, 루트
`postinstall.mjs`, `install.sh`, `harness/scripts/rubato-update.sh`를 함께 검토해야 한다.

### 켜진 기능과 이중 gate

- `packages/omo-senpi/src/extension/component-list.ts`는 빌드에 포함할 컴포넌트를 고른다.
- `harness/rubato-pi/src/policy.mjs`의 `ON_COMPONENTS`는 실행할 컴포넌트를 다시 고른다.
- 두 gate 모두 현재 `ast-grep`, `lsp`, `task`, `memory`만 허용한다.
- lead overlay 없이 adapter만 뜨는 DAG child profile은 `task`를 제외한 세 컴포넌트를
  등록한다. 반면 team member process는 adapter가 Task 엔진과 board tool을 다시 붙인다.

분리 후에도 lead, adapter-only DAG child, team member의 차이를 잃으면 안 된다. “네 개를
직접 등록한다”는 한 줄로 현재 profile 차이를 덮어버리지 않는다.

### OMO 조립층이 실제로 하는 일

`packages/omo-senpi/src/extension/`은 이름만 바꿀 registrar가 아니다. 현재 약 565줄의
비테스트 코드가 다음 공용 계약을 제공한다.

- Senpi Extension API capability 검증
- 전체·컴포넌트별 disable flag 등록
- `omo-agent-toolkit` PATH provisioning
- DAG eval SDK root provisioning
- 등록된 live tool closure capture
- Task completion과 continuation을 한 idle edge로 합치는 `IdleInjectionCoordinator`
- 컴포넌트별 logger/config context와 실패 격리

현재 선언상 필수 Senpi API는 `on`, `registerFlag`, `getFlag`, `registerTool`,
`registerCommand`, `sendMessage`, `sendUserMessage`다. 선택 API에는 `rpc`, `events`,
`registerMcpServer`, `appendEntry`, `registerMessageRenderer` 등이 있다.

독립 registrar를 검토할 때 위 서비스를 “OMO라서 불필요한 것”으로 뭉뚱그리지 말고,
각 서비스의 소비자를 찾아 보존·대체·삭제 중 하나로 판정해야 한다.

### 소유 코드의 대략적인 크기

2026-08-27에 비테스트 TS/JS/MJS를 `rg --files`로 센 값이다. 생성물은 제외했다.

| 경로 | 파일 | 줄 | 의미 |
|---|---:|---:|---|
| `packages/omo-senpi/src/components/task` | 54 | 7,479 | Senpi Task 어댑터 |
| `packages/senpi-task/src` | 268 | 30,926 | Task·DAG·team 실행 엔진 |
| `packages/omo-senpi/src/components/memory` | 191 | 21,323 | Senpi memory 어댑터·worker wiring |
| `packages/memory-core/src` | 89 | 9,496 | harness-neutral memory core |
| `packages/omo-senpi/src/components/lsp` | 16 | 1,611 | LSP adapter/runtime |
| `packages/omo-senpi/src/components/ast-grep` | 1 | 61 | staged MCP server 등록 |
| `packages/omo-senpi/src/extension` | 11 | 565 | 공용 조립층 |

이는 전체 OMO를 지켜야 한다는 근거가 아니라, 공개 extension 하나를 설치해서 Task나
memory를 교체할 수 있다는 주장에 parity 증명이 필요하다는 근거다. 2026-08-01 이후
`omo-senpi/task + senpi-task` 경로에는 272개, memory adapter 경로에는 284개의 commit이
있었다. 단순 upstream 잔재로 취급하면 안 된다.

### npm `omo-ai`는 제거 후보지만 아직 판정하지 않았다

`harness/rubato-pi/package.json`은 `omo-ai: 5.0.0-0.beta.16`을 직접 의존한다. 현재 소스는
npm `omo-ai`를 import하지 않고 포크에서 빌드한 extension을 실행한다. 이 의존성 때문에
중첩 Senpi 사본과 큰 dependency tree가 생긴다.

그러나 “import가 없다”만으로 삭제하지 않는다. clean install에서 package lifecycle,
transitive binary, extension discovery, smoke가 모두 동일함을 증명한 뒤 제거해야 한다.
공유 dirty worktree에서 바로 `npm uninstall`하지 말고 격리 clone/worktree에서 실험한다.

## 외부 대체재는 후보일 뿐이다

공개 Pi extension은 실제로 있다.

- LSP: [`pi-lsp-extension`](https://pi.dev/packages/pi-lsp-extension)
- ast-grep: [`code-yeongyu/pi-ast-grep`](https://github.com/code-yeongyu/pi-ast-grep)
- subagent 후보군: [`pi-subagents`](https://pi.dev/packages/pi-subagents),
  [`pi-subagent-in-memory`](https://pi.dev/packages/pi-subagent-in-memory), Pi/Senpi의
  `examples/extensions/subagent/`
- memory 후보군: [`pi-memory`](https://pi.dev/packages/pi-memory),
  [`pi-agent-memory`](https://pi.dev/packages/pi-agent-memory)

이 목록은 채택 추천이 아니다. 다음 세션은 각 후보의 pinned source와 license를 읽고 아래
계약표를 채워야 한다. 다운로드 수나 README의 기능 목록으로 parity를 판정하지 않는다.

## 컴포넌트별 parity 질문

### ast-grep

- search, scan, rewrite의 현재 schema와 결과 제한을 그대로 제공하는가?
- apply 전에 preview하고 truncated preview는 적용하지 않는 안전장치가 있는가?
- hidden file, symlink, glob, timeout, language 목록이 같은가?
- 현재 staged MCP runtime과 `registerMcpServer` 경계를 단순화할 수 있는가?

가장 작은 코드이므로 첫 extraction spike 후보지만, “작다”가 곧 외부 구현 채택을 뜻하지는
않는다. 현재 61줄 registrar를 Rubato 이름으로 옮기는 편이 더 작을 수 있다.

### LSP

- diagnostics, goto definition, references, symbols, prepare rename, rename의 schema가 같은가?
- edit 뒤 diagnostics, session compact/start/shutdown lifecycle이 같은가?
- language server 설치 탐지, root 선택, process cleanup, Windows 경로가 같은가?
- 현재 프롬프트·tool 이름을 바꾸지 않고 대체할 수 있는가?

`pi-lsp-extension`은 실제 후보지만, 현재 1,611줄 구현과 위 항목을 표로 비교하기 전에는
교체 결정을 내리지 않는다.

### Task

다음 항목 하나라도 없는 일반 subagent extension은 현재 Task 대체재가 아니다.

- category/subagent type/model admission과 live catalog 해석
- foreground/background child process와 nested spawn
- resident/persisted/lost/rpc-detached 상태 모델
- parent restart 뒤 동일 task id reattach와 process reconciliation
- DAG scheduling, recovery, cancellation, dependency semantics
- team mailbox, completion delivery, idle-edge batching
- provider 첫 호출 실패·429와 routing metadata의 구분
- tool capture, child profile, cwd·env·agent-dir 격리
- Windows/process-tree 종료와 clean shutdown

외부 구현은 참고 구현이나 하부 primitive가 될 수 있지만, 지금 약 38k줄의 Task adapter/core를
한 번에 교체하는 안은 별도 제품 마이그레이션이다. registrar 독립화와 같은 PR로 묶지 않는다.

### Memory

다음 계약을 단순 “벡터 검색 memory”와 혼동하지 않는다.

- clean HOME에서 memory가 기본 ON인 schema 계약
- project-derived agent identity와 session binding
- reflection/dream/palace worker lifecycle와 supervisor
- notice/nudge/completion delivery
- RPC bridge와 background child 복구
- Markdown·Git memory repo, `msearch`, 기존 사용자 데이터 migration
- memory config sibling field와 기본값 보존

공개 memory extension은 저장·검색 방식 비교 자료가 될 수 있다. 현재 사용자 데이터와 worker
계약을 버리고 교체하는 결정은 독립 registrar보다 훨씬 큰 별도 결정이다.

## 비교할 선택지

### A. 현재 구조 유지

장점은 검증된 경계를 보존하는 것이다. 단점은 OMO 이름, 두 gate, npm dead weight와 fork
정체성 혼란이 계속된다는 점이다. 유지도 유효한 결론이며, 비용이 가장 낮다.

### B. 구현은 유지하고 Rubato 소유 registrar로 분리

가장 유력한 가설이지만 아직 결정은 아니다. 네 컴포넌트와 공용 조립 서비스를 유지하고,
generic OMO component list·명칭·bundle entry만 Rubato 경계로 좁힌다. 먼저 기존 path와 새
path가 같은 등록 결과를 만드는 shadow/parity spike가 필요하다.

### C. 낮은 위험 컴포넌트만 공개 Pi extension으로 교체

ast-grep 또는 LSP가 후보가 될 수 있다. 각 tool schema, lifecycle, 플랫폼 지원과 오류 복구가
현재 구현보다 같거나 낫다는 증거가 필요하다. Task와 memory 교체와 분리해서 판단한다.

### D. OMO 계층과 구현을 한 번에 전면 제거

현재 증거로는 승인하지 않는다. Senpi compaction·loader transform 같은 최근 주된 장애는 OMO를
제거해도 남는다. 전면 제거는 약 70k줄의 소유 계약과 데이터·복구 semantics를 동시에 흔든다.

## 다음 세션의 실행 순서

### Gate 0 — 공유 작업 보호

1. `git status --short`로 다른 세션 변경을 기록한다.
2. 현재 Task/DAG/model 파일과 생성 bundle이 dirty면 off-limits로 선언한다.
3. 설계 조사와 실험을 별도 worktree 또는 임시 clone에서 한다.
4. 최신 감사 기준점 `79cfc9752`가 원격 `rubato/base`에 있는지 확인한다.

### Gate 1 — 현재 경계 지도

코드를 고치기 전에 다음 산출물을 만든다.

- runtime entry → registrar → 네 component → core package의 import graph
- `packages/omo-senpi/src/extension` 공용 서비스별 consumer 목록
- lead / adapter-only DAG child / team member profile의 등록 tool·event·flag snapshot
- build metafile을 이용한 실제 bundle closure와 OMO-origin module 목록
- `harness/rubato-pi/node_modules/omo-ai` 제거 전후 dependency tree와 disk size

여기서 “OMO 코드”는 경로 이름으로 분류하지 말고 역할로 분류한다.

1. Rubato가 유지할 제품 구현
2. Senpi에 붙이는 adapter
3. 공용 composition service
4. 실행되지 않는 upstream/dead dependency

### Gate 2 — 대체재 조사

각 공개 후보에 대해 source commit/version을 pin하고 아래 표를 채운다.

| 항목 | 현재 Rubato | 후보 | 차이 | adapter로 메울 비용 | 판정 |
|---|---|---|---|---|---|
| tool schema | | | | | |
| lifecycle | | | | | |
| persistence/recovery | | | | | |
| platform support | | | | | |
| tests/maintenance/license | | | | | |

조사 결과는 “패키지가 있다”가 아니라 “현재 계약 중 무엇을 대체할 수 있다”로 써야 한다.

### Gate 3 — 가장 작은 spike

권장 순서는 다음과 같다.

1. 격리 환경에서 npm `omo-ai`를 제거하고 install/build/smoke를 돌려 dead dependency인지 증명한다.
2. 변경 없이 현재 registrar의 등록 결과를 snapshot하는 characterization test를 만든다.
3. ast-grep처럼 작은 컴포넌트 하나만 Rubato registrar 경로로 shadow 등록해 parity를 비교한다.
4. 공용 service를 복사하지 말고 필요한 경계를 이름과 타입으로 먼저 분리한다.
5. 기존 entry path를 즉시 삭제하지 말고 한동안 비교 가능한 fallback으로 둔다.

Task·memory 내부 구현 이동, package rename, config rename은 이 spike의 범위가 아니다.

### Gate 4 — 결정문

구현 전에 다음 중 하나를 명시적으로 고른다.

- 현 구조 유지
- Rubato registrar만 추출
- ast-grep/LSP 일부 교체 + registrar 추출
- 더 큰 migration 제안(별도 승인 필요)

결정문에는 예상 삭제 LOC보다 **보존할 계약, rollback 경로, clean install 증거**를 먼저 쓴다.

## 완료 조건

독립화 작업은 이름 변경이나 build 성공으로 끝나지 않는다. 최소한 다음이 필요하다.

- clean clone + clean HOME install/apply가 성공한다.
- 루트 patched Senpi와 out-of-repo extension 경로가 유지되거나 명시적으로 대체된다.
- lead/adapter-only DAG child/team member의 tool·event·flag surface가 의도한 차이만 보인다.
- 전체 harness unit, isolated-engine integration, package gate가 통과한다.
- Task parent restart/reattach, nested child, DAG recovery를 검증한다.
- memory clean-HOME default, identity binding, reflection/dreaming을 검증한다.
- Linux와 Windows에서 path/process 차이를 확인한다. 로컬 macOS 통과만으로 완료하지 않는다.
- 기존 경로로 되돌릴 수 있는 rollback 단위가 있다.
- 다른 모델 계열이 구현자가 세운 프레임과 독립적으로 리뷰한다.

## 금지할 지름길

- `omo-senpi`라는 이름만 보고 폴더 전체를 dead code로 판정하지 않는다.
- 공개 adapter가 있다는 이유만으로 Task·memory parity를 추정하지 않는다.
- 기존 append-only vendor patch를 고치지 않는다.
- 실행본 대신 `packages/omo-senpi/plugin/extensions/` 생성물을 검사하지 않는다.
- `harness/rubato-pi/node_modules`의 중첩 Senpi를 실제 런타임으로 오인하지 않는다.
- shared dirty worktree에서 dependency 삭제·package rename·대량 이동을 시작하지 않는다.
- registrar 추출과 제품 구현 교체를 한 PR에 묶지 않는다.

## 첫 조사 명령

```bash
git status --short
git rev-parse HEAD origin/rubato/base

rg -n 'ON_COMPONENTS|DAG_ON_COMPONENTS' \
  harness/rubato-pi/src/policy.mjs \
  packages/omo-senpi/src/extension/component-list.ts

rg -n 'getCapturedTools|idleCoordinator|registerMcpServer|appendEntry|rpc\.|events\.' \
  packages/omo-senpi/src/components/{task,memory,lsp,ast-grep} \
  packages/omo-senpi/src/extension --glob '!*.test.ts'

node -e "import('./harness/rubato-pi/src/engine-paths.mjs').then(m => console.log({forkRoot:m.forkRoot,senpiDir:m.senpiDir,senpiCli:m.senpiCli,omoExtension:m.omoExtension}))"

RUBATO_ENGINE_DIR=/tmp/rubato-independence-baseline \
  node harness/scripts/build-engine.mjs --force
RUBATO_ENGINE_DIR=/tmp/rubato-independence-baseline \
  node --test harness/rubato-pi/test/integration/*.test.mjs
```

위 명령은 기준선을 읽기 위한 것이지 독립화를 승인하는 명령이 아니다.
