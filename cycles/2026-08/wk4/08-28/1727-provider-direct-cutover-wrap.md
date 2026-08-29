---
date: 2026-08-28
scope: [provider-direct, cursor-exec-journal, antigravity, live-smoke, cutover]
type: feature
---

## TL;DR

FX bridge(`:8788`)와 OpenCodex(`:10100`)를 저장소에서 제거하고 여섯 provider 전부 Senpi
프로세스 안에서 vendor를 직접 부르게 했다. Phase 5A·5B 완료, 로컬 450 + 180 통과, 실 vendor
검증 5 PASS / 1 FAIL / 5 SKIP.

**이번 세션의 가장 중요한 사실은 "무엇이 실패했나"를 잘못 귀속한 사례가 다섯 번 나왔다는
것이다.** 코드가 아니라 검증 도구가 틀렸고, 그 오진을 독립 리뷰가 사실로 받아 "코드 회귀"로
판정하기까지 했다. 실 검증 러너 자신이 검증 대상이라는 것을 배웠다.

미해결은 Antigravity 3턴 이어짐 하나. `Cannot read properties of undefined (reading
'includes')` 로 죽는데 우리 stream에 진입조차 하지 않는다.

## Keywords

`AssistantMessageEventStream.result()` `runStateful` `stopReason` `cursor-exec-journal`
`retryAuthorization` `settleAndListUnresolved` `attachWaiter` `credentialSource`
`cursor-activation.json` `modelCount=113` `RUBATO_PROVIDER_DIRECT` `upstream-compat.mjs`
`credit_usage` `refresh token rotation` `BROKER_CREDENTIAL`

## Context

이전 세션이 투두만 남기고 죽었다. Phase 0~3이 `[✓]`, Phase 4(Antigravity)가 `[•]`,
Cutover와 검증이 전부 미착수. 설계서 두 개가 정본이다:
`harness/docs/provider-direct-routing-design.md`,
`harness/docs/rubato-engine-cutover-manifest.md`.

사용자가 건 제약 둘: 공유 브릿지를 죽이면 그 기기의 모든 세션이 멈추므로 별도 포트에서
검증할 것, 서브에이전트는 `kiro/claude-opus-5` · `kiro/gpt-5.6-sol` · `xai/grok-4.6` 만.

## Investigation

### 이전 세션의 `[✓]`가 gate 통과를 뜻하지 않았다

Phase 0~3 감사를 grok에 맡겼더니 Phase 2가 실제로는 열려 있었다. 설계서 268-273줄이 요구하는
exec journal(`prepared → executing → completed | failed | unknown`)이
`cursor-exec-bridge.js` 에 **아예 없었다.** `kCursorExecResolved` 는 한 프로세스 한 호출 안의
중복만 막는다. 즉 같은 `toolCallId` 가 재시작을 건너 두 번 실행될 수 있었다.

유닛 테스트 통과가 gate 통과가 아니라는 것도 같은 감사에서 나왔다. `antigravity-route.test.mjs`
의 OAuth refresh 테스트 둘이 `RUBATO_ANTIGRAVITY_CLIENT_ID` 를 세팅하는데 `oauthClients` 는 그
env를 읽지 않는다 — `~/.rubato-pi/antigravity-oauth.json` 을 읽는다. **그 파일이 이 기기에
있어서 통과한 것**이고 lock/refresh를 증명한 게 아니었다.

### 오류를 예외로 기다리면 안 된다

`pi-ai/dist/utils/event-stream.js` 의 `AssistantMessageEventStream` 은 `result()` 를 **reject
하지 않는다.** error event가 오면 `event.error` 로 **resolve** 한다.

`antigravity-route.mjs` 의 `runStateful` 이 정확히 이걸로 깨져 있었다. `try/catch` 로 실패를
잡으려 했으니 그 catch가 영원히 안 걸리고, 오류·abort turn이 `stateStore.drop()` 을 못 불러
`lastExecutionId` 와 `stepIndex` 가 남았다. 다음 turn이 상류가 받지도 않은 step에서 이어진다.

고침은 throw를 기다리는 대신 정착값의 `stopReason` 을 보는 것:

```js
const settled = await stateStore.run(key, fn, { signal: options?.signal });
if (settled?.stopReason === "error" || settled?.stopReason === "aborted") stateStore.drop(key);
```

`harness/rubato-pi/src/` 전체에서 같은 함정을 찾았고 다른 자리는 없었다(리뷰도 REFUTED).

### 두 provider가 같은 병을 앓고 있었다

Antigravity의 lineage state 누출과 Cursor의 journal 부재는 같은 부류다: **비정상 종료가 남긴
state를 다음 turn이 믿는다.** 워크스트림을 둘 다 본 자리에서만 보이는 연결이었고, 그래서 순서를
정정했다 — journal 구현이 bridge 삭제(5A)보다 먼저다. journal 없이 지우면 tool 이중 실행 경로가
그대로 남는다.

### Kiro 시작 정지: 재지 않고 코드만 읽어 두 번 틀렸다

사용자가 "Kiro 사이드카 단계에서 멈춘다"고 했다. 처음엔 `docker info` 루프라고 했고, 다음엔
`kiro_ready` 루프라고 했다. **둘 다 아니었다.** 실제로 `time` 을 걸어 재니 첫 실행 28초, 그
다음 50밀리초 — AWS SSO 토큰 원격 갱신 한 번이었다. `kiro_ready` 는 11밀리초에 200을 준다.

## What Didn't Work

### ❌ `upstream-compat.mjs` 를 `OMO_*` 를 지키는 집으로 만든 것

- 시도: manifest가 "`OMO_*` 는 `upstream-compat.mjs` 한 파일에서만 다룬다"고 했으니, 그 파일을
  만들어 다섯 이름을 모으고 `applyUpstreamTelemetryOff()` 같은 헬퍼로 감쌌다.
- 문제: 사용자가 "omo를 걷어내는 게 목적 아니야? 지키는 게 아니라"고 지적했다. 모으라는 것은
  **세어보고 지우기 위해서**였는데 나는 보존할 집을 지어줬다. 실제 reader를 찾아보지도 않았다.
- 세어보니 다섯 중 하나만 진짜였다: `OMO_MEMORY_CHILD_EXTENSIONS` 는
  `packages/omo-senpi/.../child-extensions.ts:26` 이 읽고, `OMO_NATIVE`/`OMO_BIN` 은
  omo-native 런처가 **넣는** 값이라 하는 일이 지우는 것뿐이고, `OMO_DISABLE_POSTHOG` 계열은
  **아무도 읽지 않는다**(telemetry는 `packages/telemetry-core/src/env.ts:39` 의 `DO_NOT_TRACK`).
- 교훈: 격리하라는 지시를 받으면 격리 대상이 아직 필요한지부터 센다. 가드 테스트도 방향을
  뒤집어, probe와 helpers를 허용목록에서 **빼서** 죽은 이름을 잔재로 지적하게 했다.

### ❌ 손으로 `auth.json` 의 sentinel을 지우려 한 것

- 시도: 자격증명 복사가 no-overwrite에 막혔으니 sentinel을 백업하고 지우려 했다.
- 문제: 설계서가 "수동 JSON 편집과 상시 token copy는 금지한다"고 못 박았고 AGENTS.md도
  "상태가 아니라 코드를 고친다"고 한다. 손으로 고치면 이 기기에서만 되고 아무데도 안 퍼진다.
- 백업 파일까지 만든 뒤 되돌렸다. 대신 importer가 sentinel을 "자격증명 없음"으로 보게 하는
  코드 수정으로 방향을 바꿨고, 결국 사용자 재인증으로 해결됐다.

### ❌ `pi.md` 의 `:8788` 언급을 잔재로 보고 고친 것

- 시도: 리뷰가 `harness/skills/agent-taskforce/runtimes/pi.md` 가 "모델 호출은 `:8788` broker로
  간다"고 적어 에이전트를 없는 경로로 보낸다고 지적했다. 맞다고 보고 고쳤다.
- 문제: 그 파일은 `agent-taskforce` 정본에서 굽는 **사본**이고, 정본은 **라이브 하네스**를
  설명한다. 거기엔 bridge가 아직 살아 있다(pid 21554). 고치면 오늘의 사실이 틀려지고 다음
  bundle이 되돌린다.
- 즉시 되돌렸다. 이건 잔재가 아니라 다른 시스템의 정확한 설명이고, cutover 시점에 같이 갱신할
  항목이다.
- 교훈: "이 문서가 틀렸다"고 판단하기 전에 그 문서가 **어느 시스템**을 서술하는지 본다.

### ❌ `NODE_OPTIONS=--import` 로 포착기를 더 일찍 세우려 한 것

- 시도: `openai-codex-fast` 가 요청 body를 못 보니, `-e` extension 로드가 SDK보다 늦다고 보고
  프로세스 시작 시점에 포착기를 세웠다.
- 문제: Codex는 여전히 못 잡았고(`boots=1`, `urls=[]`), 그러면서 **이미 동작하던 Kiro와
  Anthropic Keychain 포착을 깨뜨렸다.** 두 검사가 "no request captured"로 실패했다. 같은 모듈이
  두 경로로 로드되어 설치 가드가 먼저 걸린 것으로 보인다 `[추정]` — 정확한 기제는 확인하지
  않고 되돌렸다.
- 교훈: 안 되는 계측을 고치려다 되는 계측을 깼다. 전수를 돌리기 전에 **되던 것이 여전히
  되는지**를 먼저 확인해야 했다. 부분 실행(`RUBATO_DIRECT_SMOKE_ONLY`)으로 대상만 보면 이런
  옆동네 회귀가 안 보인다.

### ❌ Antigravity 빈 응답 원인을 세 번 연속 틀리게 짚은 것

1. "catalog가 `input` 을 잃는다" → 라이브 세션의 `get_available_models` 는
   `input: ["text","image"]` 를 정상으로 준다.
2. "다른 lane(`cursor-cli-oauth`)의 catalog가 같은 모델 id를 가린다" → 그 lane을 끄니 캐시가
   사라졌는데 오류는 같았다.
3. "provider가 세션에 안 보인다" → **없는 RPC 명령(`list_models`)에 물어본 답**을 근거로 삼은
   것이었다. 올바른 명령으로 다시 물으니 여섯 provider 다 보였다.
- 교훈: 같은 접근이 두 번 틀리면 접근을 바꾼다. 읽어서 좁히는 것을 멈추고 살아 있는
  프로세스에서 스택을 받아야 한다. 그리고 프로브가 쓰는 명령이 **실제로 존재하는지**부터
  확인한다. 셋 다 코드를 읽어 추론한 것이었다.

## Decision Rationale

### journal의 `completed` 와 tool result를 한 번의 원자적 쓰기로

opus가 설계서와 다르게 판단했고 나도 동의했다. 둘로 나누면 "도구가 끝났고 result도 있는데
기록만 `completed`" 인 창이 생기고, 재시작이 그걸 읽으면 **성공한 turn을 `unknown` 으로 보고**
해야 한다. 거짓 `unknown` 이 더 나쁜 실패다. 대가로 kill 지점 3번과 4번이 같은 상태로 떨어진다.

### 중복 판정 신원과 진단 기록의 수명을 분리

첫 구현이 둘을 같은 상한(512개)에 뒀다. 상한 밖으로 밀려난 `toolCallId` 가 재전달되면
`prepare()` 가 새 호출로 보고 실행을 허가한다 — **상한이 곧 중복 실행 창구**가 된다.
`entries`(진단, 512개·7일)와 `ledger`(신원, 50,000개·180일)로 갈랐고, 신원은 lineage 단위로만
evict한다. 반쪽만 남기면 권위 있어 보이면서 지워진 절반의 재실행을 허용한다.

### `unknown` 재시도의 주체는 도구가 아니다

설계서 문장("tool이 idempotency key를 지원한다고 명시한 경우")이 주체를 흐리게 뒀고 구현이
그것을 도구의 자기 선언으로 읽었다. bridge가 도구에서 key를 자동으로 뽑아 넘겨서, **평범한
서버 재전달이 `unknown` 을 다시 실행**시켰다.

도구가 자기를 멱등이라 선언하는 것은 재시도가 안전할 수 있다는 **조건**이고, 재시도해도 된다는
**허가**가 아니다. 지금은 둘 다 필요하다: 선언된 key + 그 `toolCallId` 를 지목한 caller의
`retryAuthorization`.

### journal 읽기 실패의 거절 범위를 프로필 전역으로

grok의 판단이고 맞다고 본다. journal이 신원 저장소 전체이므로 파싱이 안 되면 **어느 lineage도
"비어 있다"고 증명할 수 없다.** 자기 lineage만 거절하면 다른 lineage의 완료된 호출을 여전히
허가한다. 세션이 못 쓰게 되는 것이 그 대가이고, 그게 요점이다.

### 5B를 gate 없이 실행

설계는 native Cursor canary가 모든 배포 대상에서 통과해야 5B를 허용한다. 그 gate는 돌지
않았고, 사용자가 명시적으로 뒤집었다("게이트에 목매지말고 모든 작업을 끝내라고"). 기기마다 한
번 재인증하는 비용을 받아들이기로 했다.

그래서 이것은 gate 통과가 아니라 **대가를 알고 고른 선택**이고, 설계서에 그렇게 적었다. 대가:
HTTP/2가 막힌 망에서는 Cursor 경로가 없다. 되돌리려면 지운 네 파일을 git에서 복원해야 한다.

**사후에 그 gate가 실증됐다.** 사용자가 로그인할 때 부모 세션이 실제 vendor canary를 통과해
`~/.rubato-pi/agent/cursor-activation.json` 에 `route: "native"`, `modelCount: 113` 을 남겼다.

## Work Accomplished

### 1. Antigravity 오류·abort turn state 누출 (커밋 예정)

`runStateful` 이 정착값의 `stopReason` 을 보게 고쳤다. 정상 turn에서 drop하면 continuation이
깨지므로 버리는 자리는 오류·abort·세대 교체·shutdown·TTL뿐이다.
- `harness/rubato-pi/src/antigravity-route.mjs:202-214`
- 테스트 3개. drop은 스트림 정착보다 **한 tick 늦다** — `await stream.result()` 직후에 단언하면
  아직 0이다.

### 2. Cursor exec journal (벤더 패치 3개)

설계서가 요구했는데 아예 없던 것. `{conversationLineageId, toolCallId}` 로 키를 잡고
`prepared → executing → completed | failed | unknown` 을 관리한다. 실제 SIGKILL을 네 지점에
넣어 검증했고 `executing` 은 재시작 뒤 `unknown` 으로 정착하며 자동 재실행하지 않는다.

리뷰가 잡은 결함 셋을 이어서 고쳤다: 유계 보존의 중복 실행 창구, `unknown` 자동 재실행,
그리고 **읽기 실패 fail-open**(깨진 파일을 빈 journal로 취급해 dedup ledger를 버렸다).
- `patches/@code-yeongyu%2Fsenpi/2026.8.22/20260827-2132Z-cursor-exec-journal.patch`
- `.../20260828-0737Z-cursor-exec-journal-fail-closed.patch`
- `harness/rubato-pi/src/cursor-exec-notice.mjs` — `settleAndListUnresolved()` 로 시작 시 알림

### 3. Phase 5A — FX bridge 삭제

`harness/bridge/` 29파일 + `broker*.mjs` 726줄. `brokerProviders()` →
`supportedProviders()`, `ourProviderIds`/`FALLBACK_OURS` → 정적 `SUPPORTED_PROVIDER_IDS`.
`RUBATO_PROVIDER_DIRECT` 는 route-neutral로 남겼다 — bridge가 없으니 꺼질 경로가 없다.

### 4. Phase 5B — OpenCodex 삭제

`cursor-fallback-route.mjs`(780), `cursor-opencodex.mjs`(379),
`cursor-authority-lease.mjs`(256), `cursor-pi-shapes.mjs`. lease는 native와 OpenCodex가 공존할
때 refresh writer를 하나로 유지하려 있었고, 공존이 끝나 역할이 사라졌다 — 리뷰가 이 삭제에
구멍이 없음을 확인했다(`AuthStorage.modify` 가 lock 안에서 다시 읽고 이미 갱신됐으면 건너뛴다).

HTTP/2 실패를 읽을 수 있게 했다: `Cursor requires HTTP/2 to api2.cursor.sh; there is no proxy
fallback.`

### 5. Kiro ensure 배경 실행

`harness/scripts/rubato-pi.sh:98-105` 가 동기로 돌아 Codex/xAI 세션이 Docker 기동을 기다렸다.
그 테스트가 "세션을 막지 않는다"는 이름으로 `|| true` 만 단언했는데, 그건 실패를 삼키는 것이지
기다림을 없애는 게 아니다. 그래서 결함이 안 보였다.

### 6. `upstream-compat.mjs` 와 죽은 이름 제거

`OMO_*` 를 한곳에 모아 세고, 읽는 코드가 없는 `OMO_DISABLE_POSTHOG` 계열을 넘기던 3곳을
걷어냈다. 세 곳 다 바로 위에 `DO_NOT_TRACK: "1"` 이 이미 있어 중복이었다.

### 7. 실 vendor 검증 러너

`harness/rubato-pi/test/smoke/direct-real.mjs` + `rpc-waiter.mjs`. 격리는 `mkdtempSync` 임시
home + `launchEnv` 의 `RUBATO_PI_CODING_AGENT_DIR`, 그리고 자식마다
`RUBATO_TARGET_AUTH_PATH` 를 명시로 못 박고 그 값을 기록해 사후 증명한다.

### 8. 호환 창구 결함

`rubato-auth.sh` 가 legacy `FX_CLAUDE_*` 만 읽어서, 정식 `RUBATO_CLAUDE_ACCOUNT` 를 쓰는
사람에게 진단이 **다른 계정**을 보고했다. 정식 우선 + legacy 유지 + 한 번 알림.
- `harness/rubato-pi/test/unit/legacy-env-window.test.mjs`

### 9. 문서를 현재 사실로

`provider-routing.md` 와 `harness/README.md` 가 삭제된 시스템을 현재형으로 설명하고 있었다.
특히 "Codex credential은 OpenCodex가 소유한다"가 틀렸다. `architecture.md` 는 삭제된
컴포넌트의 설계서라 이력 표시를 붙였다. 캐시 실측 기록은 이력으로 남겼다 — 다음에 "중계기 하나
두면 편하지 않나" 할 때 이미 걸어본 길이라는 게 보이도록.

## Verification

```
cd harness/rubato-pi && node --test test/unit/*.test.mjs   → 450 pass, 0 fail
bun test patch-tests                                        → 180 pass, 0 fail
node test/smoke/direct-real.mjs                             → PASS=5 FAIL=1 SKIP=5
                                                               liveAuthUnchanged: true
```

실 vendor 호출로 통과: xAI(`xhigh` wire), Anthropic(setup-token OAuth 신원),
Anthropic Keychain, Kiro(3턴 tool loop + 이미지), Kiro 상한 실측,
Codex(signed reasoning 3턴 + 프로세스 재시작, `nativeReasoning before=2 after=2`).

Cursor는 `cursor-activation.json` 의 `route: native`, `modelCount: 113` 으로 native canary
통과가 확인됐다.

격리: 공유 브릿지 pid 21554 무사, 실 프로필에 journal 파일 없음, `auth.json` 은 사용자 로그인
외에 변경 없음.

**돌리지 않은 것:** 다른 망에서의 HTTP/2 도달, OpenCodex 대조 TTFT A/B(대상 삭제로 성립 안 함),
Kiro 상한을 truncation에 적용(전제가 틀려 못 함).

## Architecture Impact

남은 로컬 의존은 Kiro 사이드카 `:8990` 하나. 그 ensure는 배경으로 돌아 다른 provider 세션을
붙잡지 않는다.

**HTTP/2가 막힌 망에 Cursor 경로가 없다.** 우회가 없고 오류가 그 사실을 말한다.

**`~/.rubato-pi/agent/auth.json` 의 항목이 실 토큰이 아닐 수 있다.** broker 경로에서 `/login`
하면 `BROKER_CREDENTIAL` sentinel(`access: "local"`, `refresh: "rubato-broker"`)이 박힌다.
`accessLen` 이 5면 sentinel이다. 파일 존재로 로그인 여부를 판단하면 틀린다.

**Codex refresh token은 한 번 쓰면 끝이다.** 길이가 멀쩡해 보여도(196자) 소진됐을 수 있고,
직접 물어보면 401 + `"already been used to generate a new access token"` 이 온다. OpenAI는
refresh를 쓸 때 회전시키므로 같은 token을 두 저장소가 들면 먼저 쓴 쪽이 다른 쪽을 영구히
무효로 만든다 — 설계가 "토큰을 복사하지 않는다"를 못 박은 이유의 실물이다.

**Kiro 사이드카는 usage를 퍼센트로 주지 않는다.** 절대 `input_tokens` 와 `credit_usage` float를
주고, `input/credit` 이 opus 141K / sol 121K로 모델마다 다른 **과금 요율**이다. 1M/272K를 이
경로로 유도할 수 없다.

## 검증 도구가 틀린 다섯 사례

이번 세션에서 가장 값진 발견이다. 전부 "무엇이 실패했나"를 잘못 귀속했다.

1. **대기 큐가 구독 이후 레코드만 매치.** 앞선 대기가 시간을 넘겨 fallback으로 가면 그 사이
   흘러간 응답을 영원히 기다린다. Kiro가 실제로 통과하는데 FAIL로 적혔고, 세션은 3초에 정상
   응답하고 있었다. 백로그를 훑게 하면 **반대 방향**이 열린다: `promptTurn` 은 id 없는
   `agent_end` 를 매치하므로 소비하지 않으면 2턴째가 1턴 종료를 집어 3턴 gate가 **거짓 통과**
   한다. 두 방향을 같이 고정해야 한다.
2. **만료 자격증명의 FAIL.** 만료된 token으로 돌리면 모든 단언이 실패하는데 그것을 FAIL로 적어
   "signed reasoning gate가 회귀했다"고 거짓을 말했다. **독립 리뷰가 그걸 사실로 받아 코드
   회귀로 판정했다.** 같은 실행에서 xAI가 통과한 것이 반증이었다.
3. **cutover가 권위를 뒤집은 것을 러너가 못 따라감.** broker 시절엔 실 토큰이 `~/.senpi` 에
   있고 profile은 sentinel만 들었다. 이제 `/login` 이 profile에 쓴다. 러너가 legacy만 봐서
   사용자가 방금 로그인한 것을 못 보고 "만료"로 SKIP했다.
4. **격리 검사의 거짓 양성.** 실 파일의 바이트 변화를 "내가 썼다"로 읽어서, 사용자가 검증 중에
   xAI를 로그인하자 정당한 실행을 막았다. 우리 자식이 실 프로필을 가리켰는지를 봐야 한다.
5. **계측 실패를 gate 실패로.** `openai-codex-fast` 가 요청 body를 못 봐서 FAIL이었는데 모델은
   `gpt-daybreak-blue-latest` 로 정상 응답했다. pinned Codex는 OpenAI SDK를 쓰고 SDK는 client를
   만들 때 그 시점의 전역 `fetch` 를 붙잡아서, `-e` extension이든 `--import` 든 그보다 앞선다는
   보장이 없다.

## Files Changed

| File | Change |
|------|--------|
| `harness/bridge/**` (29) | 삭제 — Phase 5A |
| `harness/rubato-pi/src/broker*.mjs` (3) | 삭제 — 726줄 |
| `harness/rubato-pi/src/cursor-{fallback-route,opencodex,authority-lease,pi-shapes}.mjs` | 삭제 — Phase 5B |
| `harness/rubato-pi/src/antigravity-route.mjs` | `stopReason` 기반 drop |
| `harness/rubato-pi/src/antigravity-api.mjs` | `withAntigravityCapabilities` |
| `harness/rubato-pi/src/cursor-exec-notice.mjs` | 신규 — 미해결 알림 |
| `harness/rubato-pi/src/upstream-compat.mjs` | 신규 — `OMO_*` 유일 소유자 |
| `harness/rubato-pi/src/kiro-route.mjs` | legacy bridge 포트 거부 |
| `harness/scripts/rubato-pi.sh` | Kiro ensure 배경 실행 |
| `harness/scripts/rubato-auth.sh` | 정식 env 우선 |
| `harness/rubato-pi/test/smoke/direct-real.mjs` | 신규 — 실 vendor 러너 |
| `harness/rubato-pi/test/smoke/rpc-waiter.mjs` | 신규 — 대기 큐 분리 |
| `harness/docs/provider-direct-routing-design.md` | "구현하며 드러난 것" 절 |
| `harness/docs/provider-routing.md` | 현재 라우팅으로 재작성 |
| `harness/README.md` | fallback 서술 제거 |
| `harness/docs/architecture.md` | 삭제된 컴포넌트 이력 표시 |
| `patches/.../*cursor-exec-journal*.patch` | 신규 — journal + fail-closed |

## 미결

**Antigravity 3턴 이어짐이 유일한 실제 실패다.** `Cannot read properties of undefined
(reading 'includes')` 로 죽고, 확실한 사실은 셋이다: 우리 stream에 **진입조차 하지 않는다**
(디버그 프로브가 한 번도 안 찍혔다), `provider_error` 가 3턴에 하나씩 찍힌다, wire log에는
`oauth2.googleapis.com/token` 200 하나뿐이고 `daily-cloudcode-pa.googleapis.com` 요청이 없다.

후보로 `core/tools/read.js:52` 의 `getNonVisionImageNote(ctx?.model)` 가 `model.input` 을 가드
없이 읽는 것을 찾았지만 **확인하지 못했다**. 다음 세션은 읽어서 좁히지 말고 살아 있는
프로세스에서 스택부터 받아야 한다 — 내가 세 번 틀린 자리다.

**리뷰가 남긴 미해결 하나.** `cursorCatalogGeneration` 이 **모델 id만** 해시해서, context
window나 input modality가 바뀌어도 generation이 같다. 자식이 `GetUsableModels` 를 다시 안
부르는 것은 맞지만 "같은 descriptor를 복원한다"는 아니다. 내가 "행동은 구현돼 있다"고 닫은 게
성급했다. 정적 카탈로그인 다섯 provider는 문제 없다.

**`openai-codex-fast` 는 미계측.** provider에 fetch 주입구가 필요하고 그건 pinned 층을
건드리는 별개 작업이다.

**cutover 시점에 같이 갱신할 것.** `agent-taskforce` 정본의
`skills/agent-taskforce/runtimes/pi.md` 가 "모델 호출은 `:8788` broker로 간다"고 적는다. 지금은
라이브 하네스에 대해 **맞는** 서술이라 건드리지 않았다.

**`harness/bench/run-fx.sh`** 는 외부 legacy `fx` 를 상대로 하고 그 게이트웨이가 사라져
비동작이다. 사용자 판단 대기.

## Commit

feat(provider): FX bridge와 OpenCodex를 제거하고 여섯 provider를 직결로 전환한다

Co-Authored-By: Kiro <noreply@kiro.dev>
