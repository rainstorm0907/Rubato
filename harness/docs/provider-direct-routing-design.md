# Rubato provider 직결 전환 설계

상태: 독립 검토 반영·구현 준비 완료
작성일: 2026-08-27
대상: `harness/rubato-pi`, `harness/bridge`, provider 인증·카탈로그·계측 경계

## 결론

Rubato의 목표 경로는 Senpi 프로세스 안의 `pi-ai` provider가 vendor를 직접 호출하는 구조다.
`127.0.0.1:8788` FX bridge는 제거한다. OpenCodex `127.0.0.1:10100`은 native Cursor가 모든
배포 대상에서 gate를 통과할 때 제거하고, 실패한 환경에서는 Cursor 전용 fallback으로만 남긴다.

```text
Rubato/Senpi
  ├─ openai-codex ───────────────→ chatgpt.com/backend-api
  ├─ xai ────────────────────────→ api.x.ai
  ├─ anthropic ──────────────────→ api.anthropic.com
  ├─ cursor ─────────────────────→ api2.cursor.sh
  ├─ kiro ───────────────────────→ kiro.rs :8990 → AWS Kiro
  └─ google-antigravity ─────────→ daily-cloudcode-pa.googleapis.com
```

OpenCodex는 Cursor native 경로가 검증 gate를 통과하지 못할 때만 rollback 경로로 남긴다.
그 경우에도 `Senpi → OpenCodex :10100 → Cursor` 한 경로만 허용하며 다른 provider를 묶지
않는다. native gate가 통과하면 OpenCodex 의존성과 rollback 경로도 삭제한다.

## 왜 바꾸는가

현재 `broker-overlay.mjs`는 모든 provider의 `stream`을 `streamBroker`로 바꾼다. 그 결과
직접 provider도 다음 왕복을 거친다.

```text
pi-ai Context
  → FX request
  → HTTP :8788
  → pi-ai Context
  → vendor transport
  → FX SSE
  → pi-ai event
```

Cursor는 여기에 `:10100`이 하나 더 붙는다.

```text
Senpi → :8788 → OpenCodex :10100 → Cursor
```

이 왕복은 프로세스와 변환 코드만 늘리는 것이 아니다. [PR #5](https://github.com/keepitmello/Rubato/pull/5)의
`harness/bridge/test/direct-provider.test.ts` 회귀에서 Codex signed reasoning이
FX history 복원 중 `anthropic-messages`로 잘못 표시되어 평문 `output_text`로 강등되는 실제
의미 손상을 확인했다. provider-native message를 중간 공통 형식으로 접었다 펴는 경로를
없애야 같은 부류의 오류가 구조상 발생하지 않는다.

## 설계 원칙

1. provider-agnostic FX 형식으로 접었다 펴는 왕복을 하지 않는다. vendor encoder/decoder는
   해당 provider 안에서만 수행하고 provider-native identity와 metadata를 보존한다.
2. 인증·catalog·refresh는 Senpi와 `pi-ai`가 소유한다.
3. Rubato 고유 동작은 transport가 아니라 얇은 in-process decorator가 소유한다.
4. 모델별 특수 동작은 해당 provider 등록에 둔다. 전역 router에 prefix 분기를 쌓지 않는다.
5. 자격증명 권위와 활성 refresh writer는 provider마다 하나만 둔다. `pi-ai`가 갱신하는
   OAuth는 `~/.rubato-pi/agent/auth.json`을 쓰고, 갱신하지 않는 setup-token과 Kiro sidecar
   key만 각 provider의 기존 저장소를 유지한다.
6. 한 provider의 rollback 때문에 다른 provider를 proxy에 묶지 않는다.

## Cursor 판정

### 인증과 주 전송은 같다

pin된 Senpi 2026.8.22의 native Cursor와 현재 OpenCodex 2.32.1-preview는 같은 계열의
인증·전송을 구현한다.

| 항목 | Senpi native | OpenCodex | 판정 |
|---|---|---|---|
| 로그인 | `loginDeepControl`, PKCE S256, UUID poll | 동일 | 같음 |
| poll | `api2.cursor.sh/auth/poll` | 동일 | 같음 |
| refresh | `auth/exchange_user_api_key`에 refresh bearer | 동일 | 같음 |
| catalog | `AgentService/GetUsableModels` | 동일 | 같음 |
| 생성 | HTTP/2 Connect `AgentService/Run` | 동일 | 같음 |
| wire identity | `x-ghost-mode:true`, client type `cli` | 동일 | OpenCodex가 vendor 노출을 낮춘다는 근거 없음 |
| client version | `cli-2026.07.23-e383d2b` 단일 | Run `cli-2026.07.08-0c04a8a`, discovery `cli-2026.02.13-41ac335` | 형태와 값이 다름 |
| 저장소 | flat Senpi `auth.json` | OpenCodex 다계정 store | 다름 |
| HTTP/1 fallback | 없음 | `RunSSE` + `BidiAppend` | OpenCodex만 있음 |
| 다계정 routing | 없음 | cooldown/failover 포함 | OpenCodex만 있음 |

OpenCodex를 유지해야 Cursor 계정의 vendor 노출이나 제재 위험이 줄어든다는 근거는 없다.
둘 다 같은 subscription OAuth와 CLI wire identity를 쓰지만 재시도·동시성·버전까지 같지는
않으므로 전체 행동 위험이 같다고 단정하지 않는다. 현재 OpenCodex Cursor 계정은 하나라
다계정 router의 이점도 쓰지 않는다.

### native를 기본으로 택하는 이유

- Responses API와 Cursor protobuf 사이의 OpenCodex 변환을 통째로 없앤다.
- Cursor server-driven exec를 Senpi의 실제 tool execution 경계에 직접 연결한다.
- Senpi `cursor-exec-bridge`는 기존 `AgentTool.execute`를 사용하므로 승인, sandbox,
  truncation, rendering을 일반 tool call과 동일하게 적용한다.
- Senpi `AuthStorage`는 `proper-lockfile`로 여러 Rubato 프로세스의 refresh를 직렬화한다.
- OpenCodex와 Senpi가 같은 refresh token을 따로 갱신하는 split ownership을 없앤다.

### native gate가 실패했다고 보는 조건

다음 중 하나가 재현되면 Cursor만 OpenCodex에 남기는 임시 fallback을 허용한다.

- 배포 대상 네트워크 중 하나라도 HTTP/2 연결이 불가능하고 OpenCodex HTTP/1 fallback만
  성공한다.
- server-driven exec가 Senpi 승인·sandbox를 우회하거나 같은 tool을 두 번 실행한다.
- session resume/branch 뒤 tool result나 conversation state가 잘못 재사용된다.
- 동일 계정·모델 A/B에서 native만 지속적으로 context continuity를 잃는다.
- stable `x-session-id`를 넣은 뒤에도 반복 prompt의 cache/TTFT가 OpenCodex 기준보다
  일관되게 나빠진다.

단순히 로그인 화면이 다시 뜨거나 저장소 schema가 다르다는 이유는 fallback 사유가 아니다.

## 최종 컴포넌트 경계

### `provider-overlay.mjs`

현재 `broker-overlay.mjs`를 대체하는 명시적 extension이다. 부모와 memory/reflection 같은
격리 agent 모두 `brand.mjs`의 `providerExtensionPaths()`로 같은 extension을 받는다.

역할은 다음으로 제한한다.

- built-in provider 중 Rubato가 지원하는 provider만 노출한다.
- `openai-codex`에 Daybreak 모델을 추가한다.
- xAI `grok-4.6`의 `xhigh` reasoning mapping을 보존한다.
- Anthropic setup-token resolver를 등록한다.
- Kiro와 Antigravity custom provider를 등록한다.
- 각 provider stream을 Rubato decorator로 감싼다.
- `provider-ids.mjs`의 broker catalog 유도식을 없애고 지원 provider 여섯 개
  (`openai-codex`, `xai`, `anthropic`, `cursor`, `kiro`, `google-antigravity`)를 정적
  allowlist로 둔다. 그렇지 않으면 뒤 세 provider가 foreign으로 분류되어 unregister 된다.

catalog의 권위는 provider가 `fetchModels`로 갱신하고 `restoreModels`로 저장분을 복원하는
경로다. Cursor는 로그인 전 빈 catalog로 시작한다. 부모가 선택한
`{providerId, modelId, capabilitySnapshot, catalogGeneration}`을 격리 agent에 넘기고, 격리
agent는 `GetUsableModels`를 다시 호출하지 않고 `models.json` 저장분으로 같은 descriptor를
복원한다. catalog refresh는 세션 경계에서만 적용한다. `:8788` catalog를 합치거나 OpenCodex
catalog를 prefix로 재작성하지 않는다. Rubato가 직접 만든 Daybreak, Kiro, Antigravity 모델만
overlay에서 정의한다.

### `withRubatoStream`

transport를 구현하지 않고 native `stream`/`streamSimple`을 감싸는 transparent decorator다.
현재 `broker-stream.mjs`에서 transport와 무관한 동작만 옮긴다.

- 첫 유효 output 시각, reasoning 종료, model 종료를 기록해 `message.timing`을 붙인다.
- measurement recorder의 `startCall`, `firstOutput`, `endCall`, tool reinsertion 관측을 잇는다.
- delta가 나온 뒤의 오류에 `senpi:no-turn-retry:` 의미를 보존한다.
- tool call을 가진 사용자 중단 턴만 `toolUse`로 정착시킨다.
- 네트워크 오류나 잘린 tool arguments를 성공 턴으로 바꾸지 않는다.

`adapter.mjs`의 input/tool/agent lifecycle hook은 task 경계를 계속 소유한다. decorator는
그 recorder의 model-call API만 호출하며 `startTask`/`endTask`를 다시 만들지 않는다. 이
분리를 지켜야 한 사용자 턴 안의 여러 model call을 한 task로 묶고 중복 event를 피한다.

decorator가 새 `AssistantMessageEventStream`을 만들어 event만 재방출하면 안 된다. Cursor가
server-driven tool을 실행하는 동안 원본 stream의 `hasPendingLocalWork()`가 true여야 agent
loop의 idle watchdog가 정상 요청을 끊지 않는다. 원본의 async iterator, `result()`, 취소 전파,
`trackLocalWork()`와 `hasPendingLocalWork()`를 그대로 위임하는 proxy/delegation 방식으로
감싼다. pin된 `pi-ai`의 `lazyStream`도 현재 이 제어면을 위임하지 않으므로 Phase 0에서 얇은
vendor patch와 회귀 테스트를 먼저 넣는다.

Cursor의 server-driven exec block에는 `kCursorExecResolved` 표지가 붙는다. decorator는 이
block을 일반 미실행 tool call로 되살리지 않으며, native Cursor가 이미 실행한 tool을 agent
loop가 다시 실행할 수 없게 한다.

Phase 0에서는 `streamBroker`도 이 decorator를 사용하게 만들어 동작을 먼저 분리한다.
provider 전환 전에 기존 broker tests가 그대로 통과해야 한다.

#### decorator 적용 계약

- 한 logical model call에는 정확히 한 번만 적용한다. agent loop가 호출하는 `streamSimple`을
  canonical entry로 삼고, 그 내부의 `stream`에는 다시 적용하지 않는다.
- provider object에 private symbol을 붙여 이미 감싼 provider의 재등록은 실패시킨다.
- broker route는 `streamBroker`, native route는 provider `streamSimple`, Cursor fallback은
  전용 provider에서 각각 한 번만 감싼다. 한 요청이 native와 broker를 동시에 지나지 않는다.
- logical call ID와 provider attempt ID를 구분한다. retry는 attempt만 늘리고 logical call의
  `startCall == 1`, `firstOutput <= 1`, `endCall == 1`을 보존한다.
- `message.timing`과 Rubato 내부 표지는 로컬 metadata다. 다음 provider 요청에서 제거하며
  provider-native item이나 signed reasoning item을 제자리에서 수정하지 않는다.

#### 종료 정착표

| 종료 상황 | 저장·재시도 | tool 정착 | 계측 |
|---|---|---|---|
| delta 전 재시도 가능 오류 | turn 저장 없음, 재시도 허용 | 없음 | logical call에서 한 번 |
| delta 후 오류 | 부분 오류 저장, `senpi:no-turn-retry:` | 미완성 tool 실행 금지 | 한 번 |
| 사용자 중단 + 완성된 미실행 tool | `toolUse`, turn 재시도 금지 | agent loop가 한 번 실행 | 한 번 |
| 사용자 중단 + 불완전 arguments | 성공 처리·재시도 금지 | 실행 금지 | 한 번 |
| Cursor가 이미 실행한 tool result | 영속 result 저장, 재시도 금지 | 재삽입·재실행 금지 | 한 번 |
| 실행 여부가 불명확한 tool | `unknown`, 자동 재시도 금지 | 실행 금지 | 한 번 |

`kCursorExecResolved` 블록만 남은 중단·오류 turn은 실행할 tool이 없으므로 `toolUse`로
재분류하지 않는다.

### provider별 소유 동작

#### OpenAI Codex

- pin된 `openaiCodexProvider()`를 그대로 쓴다.
- Daybreak/Daybreak Fast 모델 정의만 overlay에서 추가한다.
- Fast 모델의 canonical `upstreamModelId`와 `serviceTier: priority`를 유지한다.
- PR #5의 native reasoning identity 회귀 테스트를 이 경로로 이전한다.

#### xAI

- pin된 `xaiProvider()`를 그대로 쓴다.
- `grok-4.6`의 `xhigh` mapping만 보존한다.

#### Anthropic

- native `anthropicProvider()`를 기반으로 쓴다.
- `~/.claude/auth/setup-token-<account>` 또는 Keychain을 읽는 credential resolver만 덧댄다.
- setup-token을 `apiKey`로 돌려준다. native는 `sk-ant-oat` prefix에서 OAuth를 판별해
  `claude-cli/2.1.75`, Claude Code beta와 cache retention을 적용한다. bridge가 로컬 Claude
  설치 버전으로 user-agent를 만들던 동작과 달라지는 것을 wire gate에서 수용한다.
- bridge의 `read_file ↔ Read` mapping은 삭제한다. native OAuth 경로가 이미
  `toClaudeCodeName`을 적용하므로 남기면 이중 변환이다.

#### Kiro

- 현재 `kiroProvider()`의 작은 Anthropic Messages provider 정의를 in-process로 옮긴다.
- `kiro.rs :8990`과 setup hook은 유지한다.
- `claude-opus-5` 1M, `gpt-5.6-sol` 272K context window를 모델 정의에 고정한다.
- 이 상한은 현재 `harness/bridge/src/direct-provider.ts` 기준선이다. 새 provider metadata를
  기존 fixture와 비교하고 실제 Kiro 응답 계약을 확인하기 전에는 truncation 계산에 쓰지 않는다.
- **실측 결과 이 gate 의 전제가 틀렸다(2026-08-28).** 사이드카는 usage 를 퍼센트로 주지 않는다 —
  절대 `input_tokens` 와 `credit_usage` float 를 돌려준다. 그래서 `pct × window / 100` 역산이
  성립하지 않는다.

  실측값(`harness/rubato-pi/test/smoke/direct-real.mjs` 의 `kiro-caps`):

  | 요청 | `input_tokens` | `credit_usage` | `input / credit` |
  |---|---|---|---|
  | opus 짧게 | 23,271 | 0.164857 | 141,159 |
  | opus 길게 | 33,321 | 0.234287 | 142,223 |
  | sol 짧게 | 11,902 | 0.098256 | 121,133 |

  `credit_usage` 는 `input_tokens` 에 거의 선형이고(opus 두 요청의 input 비 1.4319 대 credit 비
  1.4212), 나눈 값은 모델마다 다른 상수다 — opus 약 141K, sol 약 121K. 1M 도 272K 도 아니다.
  즉 이것은 컨텍스트 창의 비율이 아니라 **모델별 과금 요율**이고, usage 에서 창 크기를 유도할
  길이 없다. 상한을 확인하려면 다른 증거가 필요하다(상한 지점의 오류 응답 등). 그것을 얻기
  전에는 truncation 과 usage 역산에 쓰지 않는다 — 지금 코드가 그렇게 동작한다.
- Kiro sidecar key는 `sk-ant-oat`가 아니어서 Claude Code tool-name mapping이 자동 적용되지
  않는다. 별도 mapping은 두지 않는다.

#### Antigravity

- 현재 custom transport를 in-process API provider로 옮긴다.
- OAuth credential은 Keychain을 일회성 import 입력으로만 읽어 `google-antigravity` 항목을
  profile `auth.json`에 쓴다. provider `auth.oauth`의 refresh를 사용해
  `resolveStoredOAuth → AuthStorage.modify`가 읽기·만료 재확인·원격 refresh 전체를
  `proper-lockfile` 아래 수행하게 한다. 현재 AuthStorage는 잠근 파일을 제자리 덮어쓰므로
  Phase 0 vendor patch에서 mode 0600 temp write → file fsync → atomic rename → directory fsync로
  바꾼 뒤 Antigravity를 이 경로에 올린다.
- thought signature, image, tool call 변환은 provider 내부에 둔다.
- state key는 `{profileId, providerId, modelId, sessionId, branchId,
  conversationGeneration}`이다. profile 전체 64개, lineage당 4개를 상한으로 하고 30분 idle
  TTL, 정상 종료·오류·abort cleanup을 적용한다. 같은 lineage의 동시 호출은 직렬화하며 상한을
  넘으면 기존 state를 추측하지 않고 fail closed한다.
- 이 이관이 끝날 때까지 `:8788` 삭제는 허용하지 않는다.

#### Cursor

- pin된 `cursorProvider()`와 `cursor-agent` API를 사용한다.
- `/login cursor`가 `~/.rubato-pi/agent/auth.json`을 채운다.
- dynamic `GetUsableModels` catalog를 그대로 사용한다.
- stable Rubato session ID를 `x-session-id` caller header로 보낸다. native transport는
  caller header를 허용하지만 기본값으로 이 header를 만들지 않는다. OpenCodex 경로와
  동일한 session identity를 주지 않으면 기존 cache 판정을 비교할 수 없다. pin된
  `sanitizeCursorCallerHeaders()` 실행에서 이 header가 보존되는 것도 확인했다.
- pin된 native transport의 module-level conversation/checkpoint/blob map은 현재 무제한이다.
  broad rollout 전에 session 종료와 TTL/LRU에 따라 정리하는 vendor patch를 넣는다. overlay는
  module-private state를 복제하거나 별도 shadow map을 만들지 않는다.
- `cursor-cli-oauth` extension은 별개 lane이므로 계속 끈다. native Connect-RPC와 real
  `cursor-agent` binary spawn을 동시에 노출하지 않는다.

### Cursor server-driven exec 정착 계약

임의의 외부 부작용과 transcript 저장은 원자화할 수 없으므로 재시작까지 포함한
exactly-once를 약속하지 않는다.

- `kCursorExecResolved`는 현재 프로세스·현재 호출 안의 중복 실행만 막는다.
- `{conversationLineageId, toolCallId}`를 영속 key로 삼고
  `prepared → executing → completed | failed | unknown` journal을 profile 아래 atomic file로
  기록한다. `cursor-exec-bridge`가 이 journal의 단일 owner이며 multi-process lock과
  temp write → fsync → rename을 사용한다.
- `completed`와 영속 tool result가 함께 있으면 다시 실행하지 않는다.
- 재시작 때 `executing`이면 부작용 발생 여부를 알 수 없으므로 `unknown`으로 정착시키고 자동
  재실행하지 않는다. tool이 idempotency key를 지원한다고 명시한 경우만 같은 key로 재시도한다.
- `unknown`은 사용자와 agent loop에 오류 상태로 노출하며 성공 turn으로 바꾸지 않는다.
- 정상 단일 프로세스 안에서는 동일 `toolCallId`를 한 번만 실행한다. route rollback은 checkpoint
  손실과 full-history fallback을 명시하는 세션 경계에서만 수행한다.

## 인증 전환

최종 권위 저장소는 브랜드 profile의 다음 파일이다.

```text
~/.rubato-pi/agent/auth.json
```

현재 bridge가 읽는 `~/.senpi/agent/auth.json`은 전환 뒤 provider refresh에 쓰지 않는다.
`~/.opencodex/auth.json`은 Cursor fallback이 활성인 환경에서만 Cursor의 권위로 남고,
native가 채택된 환경에서는 refresh writer를 중지한다.

초기 전환은 Rubato 안의 `/login cursor`만 지원한다. OpenCodex token migration은 schema 전체와
source quarantine 계약을 별도로 검증할 때까지 범위에서 제외한다. 수동 JSON 편집과 상시 token
copy는 금지한다.

Cursor authority 전환은 다음 상태 기계 하나로 수행한다.

```text
LEGACY_OPENCODEX
  → DRAIN_CURSOR_CALLS
  → STOP_OPENCODEX_ROUTE_AND_REFRESH_WRITER
  → LOGIN_NATIVE_CURSOR
  → NATIVE_CANARY
  → NATIVE_ACCEPTED

NATIVE_CANARY_FAILED
  → STOP_NATIVE_ROUTE_AND_REFRESH_WRITER
  → QUARANTINE_NATIVE_CREDENTIAL
  → START_OPENCODEX_AUTHORITY
  → LEGACY_OPENCODEX
```

Phase 2 전체 gate를 통과하고 진행 중인 Cursor 요청을 drain하기 전에는 authority를 확정하지
않는다. 두 저장소에 token이 남아 있어도 활성 route와 refresh writer는 하나뿐이어야 한다.

Anthropic setup-token과 Kiro sidecar key는 refresh 대상이 아니므로 기존 저장소를 유지한다.
Antigravity는 Keychain에서 일회성 import한 뒤 profile `auth.json`을 권위로 쓴다.

## 이행 순서와 gate

### 준비 — PR #5

PR #5를 먼저 병합한다. 현재 구조에서 signed reasoning 손상을 막고, 전환 전후 동등성을
검사할 wire 회귀 테스트를 확보한다. 메모리 안 3턴뿐 아니라 transcript 저장 → 프로세스 종료
→ 새 프로세스 resume 뒤 outbound context에서 provider identity, item type, signature를 검사한다.

### Phase 0 — decorator 추출

`broker-stream.mjs`의 계측·정착 동작을 `withRubatoStream`으로 분리한다. 아직 모든 요청은
`:8788`을 지난다.

Gate:

- broker stream retry/abort tests
- statusline/TPS timing tests
- measurement recorder tests
- tool call이 있는 사용자 중단과 전송 실패가 서로 다른 stop reason을 유지한다.
- idle timeout보다 오래 실행되는 Cursor server-driven tool 동안 outer stream의
  `hasPendingLocalWork()`가 true이고 요청이 중단되지 않는다.
- decorator를 두 번 적용해도 event, recorder call, 취소 handler가 중복되지 않는다.
- `result()`, async iterator `return`, `execHandlers`, `onToolResult`, `sessionId`, `onPayload`,
  `signal`이 원본 stream으로 그대로 전달된다.
- AuthStorage write가 crash 중에도 완전한 이전 JSON 또는 완전한 새 JSON만 남기며 mode 0600을
  보존한다.

### Phase 1 — Codex와 xAI 직결

현재 bridge 내부에서도 pinned `pi-ai` native 구현을 쓰는 두 provider부터 전환한다. `:8788`은
다른 provider를 위해 계속 돈다.

Gate:

- Codex signed reasoning이 3턴과 프로세스 재시작 뒤에도 native item으로 남는다.
- Fast 모델 payload에 canonical model ID와 `service_tier: priority`가 들어간다.
- 이미지 입력과 tool loop가 통과한다.
- xAI `xhigh`가 picker와 wire에 남는다.
- 두 Rubato 프로세스가 같은 강제 만료 credential을 동시에 요청해도 lock 안에서 다시 읽어
  원격 refresh가 한 번만 발생하고, 다른 프로세스는 새 credential을 재사용한다.

### Phase 2 — Cursor native canary

Cursor route를 drain하고 OpenCodex route·refresh writer를 중지한 다음, 격리된 임시
workspace의 Rubato profile에서 Cursor를 새로 로그인해 native catalog를 refresh한다. 같은
계정으로 OpenCodex와 동시에 요청하지 않는다.

Gate:

- `GetUsableModels`가 오류 없이 현재 계정의 usable catalog를 반환하고 선택한 canary 모델을
  포함한다. 모델 수는 계정과 시점에 따라 달라지므로 고정하지 않는다.
- read/edit/bash/MCP가 일반 tool과 같은 승인·sandbox 경계를 지난다.
- server-driven exec가 정상 단일 프로세스에서 transcript와 실제 실행에 한 번만 남는다.
- 정상 단일 프로세스에서 같은 `toolCallId`가 한 번만 실행된다.
- 사용자 중단, stream retry, session resume, branch가 tool result를 중복 실행하지 않는다.
- 실행 직전, 부작용 직후, `completed` 기록 직후, tool result 저장 직후에 각각 프로세스를
  종료하고 resume한다. `executing`은 `unknown`이 되며 자동 재실행되지 않는다.
- 멱등 도구만 같은 idempotency key로 명시적 재시도가 허용된다.
- `kCursorExecResolved` block만 남은 abort/error가 `toolUse`로 바뀌지 않는다.
- 새 프로세스로 session을 재개해도 full history fallback이 정확하다.
- 10턴 연속 tool loop에서 context continuity 오류가 없다.
- 종료한 Cursor session의 conversation/checkpoint/blob state가 TTL/LRU 뒤 제거되고 active
  session은 제거되지 않는다.
- 동일 session ID를 wire의 `x-session-id`로 보내고, 같은 prompt A/B를 각각 3회 이상
  반복해 TTFT·usage·checkpoint 연속성을 OpenCodex와 비교한다.
- native를 배포할 모든 대상 네트워크에서 HTTP/2 연결이 안정적으로 통과한다.

실패하면 native route·writer를 중지하고 native credential을 quarantine한 뒤 OpenCodex
authority를 복원한다. Cursor 전용 adapter를 구현하고 실패 증거를 문서화한다. 성공하면
OpenCodex runtime 결합을 끄고 fallback adapter 자체를 만들지 않는다.

### Phase 3 — Anthropic과 Kiro 직결

Gate:

- setup-token file과 Keychain fallback이 각각 동작한다.
- setup-token이 `apiKey`로 전달되고 Claude OAuth wire의 고정 user-agent, 1시간 cache usage,
  native tool names를 확인한다.
- Kiro 3턴 tool loop와 이미지 입력이 통과한다.
- Kiro 새 metadata가 기존 fixture와 일치한다. **1M/272K 상한 자체는 이 gate 로 닫지 않는다** —
  사이드카가 퍼센트를 주지 않음이 실 상류 응답으로 확인됐으므로(위 Kiro 절), truncation 과
  usage 역산은 계속 끈다.

### Phase 4 — Antigravity 직결

Gate:

- OAuth refresh와 동시 요청이 credential을 잃지 않는다.
- 두 프로세스가 같은 만료 credential을 요청해도 lock 안에서 재확인하여 원격 refresh가 한
  번만 일어나고 나머지는 새 credential을 읽는다.
- thinking signature와 branch-aware session scope가 lineage 사이에 섞이지 않는다.
- 같은 session의 두 branch를 병렬 실행해도 state가 서로 섞이지 않는다.
- 이미지, tool call, 3턴 continuation이 통과한다.
- state map이 종료 세션을 bounded하게 정리한다.

### Phase 5A — FX bridge 삭제

Codex, xAI, Anthropic, Kiro, Antigravity gate가 통과하고 Cursor가 native 또는 전용 OpenCodex
adapter gate를 통과하면 다음을 제거한다. native가 실패했고 전용 adapter도 없으면 `:8788`을
삭제하지 않는다.

- `harness/bridge/`
- `ensureBroker`, `loadCatalog`, `broker-stream`, FX request/SSE 변환
- `:8788` supervisor, drain/admin token, restart/doctor/smoke 경로
- bridge 전용 2026.8.19 `pi-ai` pin

Cursor 전용 fallback provider는 OpenCodex `/v1/responses`만 호출하며 model ID 변환, pi-ai
event 변환, abort, post-delta no-turn-retry, usage·timing을 소유한다. OpenCodex가 인증 권위이며
다른 provider catalog나 credential은 읽지 않는다.

Kiro `:8990` ensure는 Kiro provider의 첫 호출 직전에만 실행한다. Codex나 xAI 실행이 Kiro
sidecar 상태에 의존하지 않게 한다. doctor는 resolved profile root, 정적 provider 등록,
credential schema·만료, 활성 authority·refresh writer와 요청받은 Kiro sidecar를 검사한다.
실제 vendor 요청은 별도 smoke로 둔다. Rubato가 더 쓰지 않는다는 이유로 사용자의 OpenCodex
설치나 `~/.opencodex` 데이터를 삭제하지 않는다.

### Phase 5B — OpenCodex 연동 삭제

계획: 모든 지원 머신·네트워크에서 native Cursor의 전체 gate가 통과한 경우에만 Rubato의 `:10100`
listener, 시작·진단·catalog 의존성과 Cursor fallback 경로를 제거한다. HTTP/2가 막힌 지원
환경이 하나라도 있으면 그 환경에는 Cursor-only fallback을 유지한다. 사용자의 OpenCodex
설치나 데이터를 삭제하지 않는다.

**실제로는 그 조건을 채우지 않고 실행했다(2026-08-28, 사용자 지시).** native canary 는 어느
망에서도 돌지 않았다 — Cursor native 로그인 자체가 되어 있지 않았고, `auth.json` 의 cursor
항목은 broker sentinel 이었다. 사용자가 gate 를 기다리지 말고 전환을 끝내라고 명시했고, 기기마다
한 번 재인증하는 비용은 받아들이기로 했다.

그래서 이것은 "gate 통과"가 아니라 **대가를 알고 고른 선택**이다. 대가는 이렇다:

- HTTP/2 로 `api2.cursor.sh` 에 닿지 못하는 망에서는 Cursor 경로가 **없다.** 우회가 없다.
  그 실패는 일반 transport 오류로 숨지 않고 그 사실을 그대로 말한다
  (`Cursor requires HTTP/2 to api2.cursor.sh; there is no proxy fallback.`).
- native Cursor 의 catalog·10턴 연속성·TTFT 는 실 vendor 로 확인되지 않았다. 배포 전에 각 망에서
  확인해야 하는 조건으로 `test/smoke/direct-real.mjs` 의 `uncovered` 에 남겨 뒀다.
- 되돌리려면 삭제한 lane 을 git 에서 복원해야 한다. 지운 파일은 `cursor-fallback-route.mjs`,
  `cursor-opencodex.mjs`, `cursor-authority-lease.mjs`, `cursor-pi-shapes.mjs` 다.

lease 를 통째로 지운 근거: listen-socket lease 는 native 와 OpenCodex 가 공존할 때 refresh
writer 를 하나로 유지하려고 있었다. 공존이 끝나면 그 역할이 사라지고, native refresh 는 Senpi
`AuthStorage` + `proper-lockfile` 이 직렬화한다.

## rollback

transport·catalog·provider 인증 오류는 provider 단위로 rollback한다. `provider-overlay`나
`withRubatoStream` 공통 오류는 extension 버전 전체를 rollback한다. native provider가 gate를
통과하기 전까지 기존 bridge route를 지우지 않는다. 한 provider의 실패로 이미 통과한
provider를 `:8788`로 되돌리지 않는다.

Cursor fallback이 필요하면 허용 경로는 다음 하나뿐이다.

```text
Senpi Cursor-only provider → OpenCodex :10100 → Cursor
```

이 fallback은 HTTP/2 불가나 native correctness 실패가 재현된 동안만 유지하며, 다른
provider catalog나 인증을 OpenCodex에서 읽지 않는다.

Cursor checkpoint는 native 프로세스의 memory에만 있으므로 route rollback은 세션 경계에서만
수행한다. 진행 중 세션에서 전환하지 않으며, 재개가 필요하면 checkpoint 손실과 full-history
fallback을 사용자에게 명시한다.

## 구현하며 드러난 것 (2026-08-28)

설계가 못 박지 않았거나 틀리게 적었던 것들. 다시 밟지 않도록 남긴다.

### 오류를 예외로 기다리면 안 된다

`AssistantMessageEventStream.result()` 는 error event 를 **reject 가 아니라 resolve** 로
정착시킨다(`pi-ai/dist/utils/event-stream.js` 의 final-result 변환). 그래서 stream 을 감싸고
`try/catch` 로 실패를 잡으려 하면 그 catch 가 영원히 안 걸린다.

`antigravity-route.mjs` 의 `runStateful` 이 이걸로 깨져 있었다: 오류·abort turn 이
`stateStore.drop()` 을 못 불러 `lastExecutionId` 와 `stepIndex` 가 남고, 다음 turn 이 상류가
받지도 않은 step 에서 이어졌다. 고침은 정착값의 `stopReason` 을 보는 것이다. 정상 turn 에서
drop 하면 continuation 이 깨지므로, 버리는 자리는 오류·abort·세대 교체·shutdown·TTL 뿐이다.

같은 함정을 `harness/rubato-pi/src/` 전체에서 찾았고 다른 자리는 없었다.

### 중복 실행 방어는 진단 기록과 수명이 달라야 한다

exec journal 의 첫 구현은 무거운 진단 기록과 중복 판정 신원을 같은 상한에 뒀다. 상한 밖으로
밀려난 `toolCallId` 가 재전달되면 `prepare()` 가 새 호출로 보고 실행을 허가한다 — 상한이
곧 중복 실행 창구가 된다.

그래서 둘을 갈랐다: `entries`(진단, 512개·7일)와 `ledger`(신원, 50,000개·180일). 신원은
lineage 단위로만 evict 한다 — 한 대화의 신원을 반쪽만 남기면 권위 있는 것처럼 보이면서
지워진 절반의 재실행을 허용한다.

### `unknown` 재시도의 주체는 도구가 아니다

설계의 "tool 이 idempotency key 를 지원한다고 명시한 경우만" 은 주체를 흐리게 뒀고, 구현이
그것을 도구의 자기 선언으로 읽었다. `cursor-exec-bridge` 가 도구에서 key 를 자동으로 뽑아
넘겼으므로, 평범한 서버 재전달이 `unknown` 을 다시 실행시켰다.

재시도에는 **둘 다** 필요하다: 도구가 선언한 key(재시도가 안전할 수 있다는 조건)와, 그
`toolCallId` 를 지목한 caller 의 명시 지시(재시도해도 된다는 허가). 도구가 자기를 서술하는
것은 요구가 아니다.

### Kiro 사이드카는 usage 를 퍼센트로 주지 않는다

위 Kiro 절의 표를 보라. `credit_usage` 는 모델별 과금 요율이고 컨텍스트 창과 무관하다.
이 gate 는 이 경로로 닫을 수 없다.

### Codex refresh token 은 한 번 쓰면 끝이다

`~/.senpi/agent/auth.json` 의 Codex refresh token 이 길이만 보면 멀쩡해 보여도(196자) 이미
소진됐을 수 있다. 직접 `auth.openai.com/oauth/token` 에 물어보면 401 과 함께
`"Your refresh token has already been used to generate a new access token"` 이 온다.

OpenAI 는 refresh 를 **쓸 때 회전**시킨다. 그래서 같은 token 을 두 저장소가 들고 있으면 먼저
갱신한 쪽이 다른 쪽을 영구히 무효로 만든다 — 설계가 "토큰을 복사하지 않는다" 를 못 박은 이유가
이것이고, 추상적인 위험이 아니라 이 기기에서 실제로 일어난 일이다.

따라서 "refresh 가 남아 있으니 재인증 없이 갱신하면 된다" 는 판단은 **길이만 보고 내리면
틀린다.** 살아 있는지는 물어봐야 안다.

### 실 검증 러너에서 "gate 실패" 와 "자격증명 불가" 는 다른 사실이다

만료된 token 으로 돌리면 모든 단언이 실패한다. 그것을 FAIL 로 적으면 읽는 사람에게 "그 gate
가 회귀했다" 고 거짓을 말한다. 실제로 Codex token 만료 뒤 signed reasoning gate 가 FAIL 로
찍혀, 독립 리뷰가 그것을 코드 회귀로 판정했다. FAIL 은 **쓸 수 있는 자격증명으로** gate 가
깨졌을 때만 쓴다.

### 러너 자신이 검증 도구다

`attachWaiter` 의 대기 큐가 구독 이후의 레코드만 매치했다. 앞선 대기가 시간을 넘겨 fallback
으로 넘어가면 그 사이 흘러간 응답을 영원히 기다린다 — Kiro 가 통과하는데 FAIL 로 적힌 원인이
이것이었고, 세션은 3초에 정상 응답하고 있었다.

백로그를 훑게 하면 반대 방향 결함이 열린다: `promptTurn` 은 id 없는 `agent_end` 를 매치하므로
소비하지 않으면 2턴째가 1턴의 종료를 집어 3턴 이어짐 gate 가 **거짓 통과**한다. 두 방향을
같이 고정해야 한다(`test/unit/rpc-waiter.test.mjs`).

## 완료 조건

현재 상태를 각 줄에 적는다(2026-08-28). 통과·미통과를 섞어 적는 이유는, 무엇이 남았는지가
"거의 끝났다" 보다 쓸모 있기 때문이다.

- **통과.** 일반 모델 요청 중 `:8788`과 FX gateway 형식이 한 번도 등장하지 않는다. bridge 와
  broker 는 저장소에서 삭제됐고, loopback endpoint override 도 `8788`/`18788` 을 거부한다.
- **통과(대가 있음).** `:10100` listener 없이 모든 지원 모델이 동작한다. 단 Cursor 는 native
  HTTP/2 전용이 되어, 그 연결이 막힌 망에는 Cursor 경로가 없다. 위 Phase 5B 절 참조.
- **provider별로 갈림.** reasoning·tool call·image·usage·cache 보존은 xAI, Anthropic,
  Anthropic Keychain, Kiro 에서 실 vendor 호출로 확인됐다. Codex 는 자격증명 만료로 미확인
  (만료 전에는 signed reasoning 3턴·프로세스 재시작이 통과했다). Antigravity 3턴 이어짐은
  **실패 중**이다. Cursor 는 로그인 전이라 미확인.
- **로컬 통과, 실 확인 부분.** statusline TTFT/wait/think/TPS 와 measurement log 의 의미는
  유닛으로 고정돼 있고, 실 vendor 왕복에서도 xAI·Anthropic·Kiro 구간이 정상이었다. OpenCodex
  대조 A/B 는 대상이 삭제되어 더 이상 성립하지 않는다.
- **통과.** 인증 refresh writer 는 provider 마다 하나이고 Senpi `AuthStorage` 가
  `proper-lockfile` 과 원자적 쓰기로 직렬화한다. Cursor lease 는 공존이 끝나 삭제됐다.
- **통과(판정 정정).** 부모와 격리 agent 는 같은 provider overlay 를 쓴다. "부모가 고정한
  descriptor 를 자식이 같게 해석한다" 의 요구 사항은 **자식이 `GetUsableModels` 를 다시 부르지
  않는 것**이고, Cursor 에서 activation marker + `restoreModels` 로 구현돼 있다
  (`cursor-route.mjs:50-70`). 나머지 다섯은 정적 catalog 라 재조회가 없어 질문이 성립하지 않는다.
  `capabilitySnapshot` 이라는 이름의 tuple 을 직렬화하는 것이 목적이 아니었다.
  또한 Antigravity 이관은 부모 세션만 한다 — 자식마다 Keychain 을 읽고 `loadCodeAssist` 를
  부르면 시작 부작용이 자식 수만큼 곱해진다.
