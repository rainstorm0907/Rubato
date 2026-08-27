---
date: 2026-08-27
scope: [rubato-pi, model-core, openai-codex]
type: fix
---

## TL;DR

OpenAI Codex가 정상 agent 작업 도중 `Invalid prompt`를 반환하면 Rubato가 실패한 assistant 턴을 다음 요청에 다시 싣고, 오류 문구의 `try again` 때문에 같은 요청까지 재시도하던 고리를 끊었다. 최초 upstream 정책 오류의 판정 지점은 열어 두고, Rubato가 한 번의 오류를 세션 전체 장애로 키우지 않도록 두 경계를 고쳤다.

## Keywords

`Invalid prompt` `contextToFxRequest` `shouldRetryError` `stopReason=error` `openai-codex`

## Context

장기 Rubato 세션에서 정상적인 문서 편집, 브라우저 확인, 개발 작업을 하던 중 OpenAI Codex가 다음 오류를 반환했다.

```text
Codex error: Invalid prompt: your prompt was flagged as potentially violating our usage policy. Please try again with a different prompt.
```

2026-08-25 15:33 UTC부터 2026-08-27 09:44 UTC까지 사용자별 세션 저장소에서 `role=assistant`, `stopReason=error`, 해당 `errorMessage`를 모두 만족한 실제 오류 턴 23건을 확인했다. 서로 관련 없는 작업에서도 발생했으므로 특정 사용자 문구를 공통 원인으로 규정할 수 없었다. 더 큰 운영 문제는 첫 오류 뒤 평범한 후속 요청에도 같은 오류가 반복돼 해당 세션을 계속 쓰기 어려워진다는 점이었다.

## Investigation

실제 `openai-codex/*` 요청 경로는 다음과 같다.

```text
Senpi context
→ harness/rubato-pi broker
→ harness/bridge :8788
→ direct-provider.ts
→ @code-yeongyu/senpi-ai openai-codex provider
→ OpenAI Codex backend
```

`server.ts`는 `openai-codex/*`를 direct provider로 분기하므로 OpenCodex `:10100`, `fx-request.ts`, `fx-stream.ts`는 이번 오류 경로에 들어오지 않는다.

저장된 실패 턴과 Senpi AI Codex parser를 대조한 결과 reasoning summary가 일부 나온 뒤 top-level `error`가 왔다. 사용자에게 보인 `Codex error:` 접두사는 Senpi AI parser의 top-level error 분기에서만 붙고 `response.failed` 분기에는 붙지 않는다. 따라서 HTTP 입구에서 즉시 거절된 오류라고 부를 수는 없지만, 정책 판정 대상이 입력인지 생성 중 reasoning인지는 원본 payload와 request ID 없이 확정할 수 없다.

Rubato 안에서는 반복을 만드는 두 고리를 확인했다.

1. `contextToFxRequest()`가 `stopReason=error`인 assistant 메시지도 정상 대화처럼 다음 prompt에 포함했다.
2. 공용 오류 분류기가 정책 문구 끝의 `try again`을 일반 재시도 신호로 읽었다.

## What Didn't Work

### reasoning 원문 전체 제거

- Tried: 과거 reasoning을 다음 요청에서 전부 제외하는 방안을 검토했다.
- Problem: direct Codex 경로는 `fxPromptToPiContext()`에서 reasoning과 signature를 정상 복원한다. 전체 제거는 정상 대화 연속성까지 깨고, 최초 정책 판정 원인이 reasoning이라는 증거도 없었다.
- Lesson: 미확정 upstream 원인을 우회하려고 정상 메시지 의미를 넓게 훼손하지 않는다. provider가 실패한 턴만 제외하는 좁은 경계가 맞다.

### OpenCodex 경로로 원인 규정

- Tried: 초기에는 Rubato가 OpenCodex `:10100`을 거쳐 OpenAI에 간다고 해석했다.
- Problem: 현재 코드의 `isDirectModel()`과 `server.ts` 분기가 `openai-codex/*`를 먼저 direct provider로 보낸다.
- Lesson: provider 이름과 과거 설계 문서만 보고 경로를 추측하지 않고, 실행 분기부터 확인한다.

## Decision Rationale

최초 정책 오류 자체를 숨기거나 무조건 복구하려 하지 않았다. 클라이언트가 확실히 소유하는 책임만 고쳤다.

- provider 오류 턴은 assistant가 완성한 대화가 아니므로 다음 prompt에서 제외한다.
- `Invalid prompt`와 정책 위반 가능성 문구는 같은 요청을 다시 보내도 해결되지 않으므로 STOP 패턴이 일반 `try again` 패턴보다 우선하게 한다.
- 정상 assistant 턴, tool call, reasoning 연속성은 그대로 둔다.

## Work Accomplished

### 실패 assistant 턴 재전송 차단

`harness/rubato-pi/src/broker-request.mjs`에서 `message.stopReason !== "error"`인 assistant 메시지만 FX prompt로 변환한다. 회귀 테스트는 provider 오류 content가 다음 prompt에서 빠지는지 확인한다.

### 정책 거절 자동 재시도 차단

`packages/model-core/src/model-error-classifier.ts`의 STOP 패턴에 `invalid prompt`, `flagged as potentially violating`을 추가했다. 테스트는 문구에 `try again`이 포함돼도 `shouldRetryError()`가 `false`를 반환하는지 확인한다.

### 관리자용 사고 분석 기록

`docs/rubato/openai-invalid-prompt-incident.md`에 최초 발견 조건, 실제와 단위 수준 재현 조건, direct provider 요청 경로, 확인된 원인과 열린 가설, 필요한 후속 계측을 분리해 기록했다.

## Architecture Impact

변경은 두 경계에만 적용된다.

- 모든 provider의 `stopReason=error` assistant 턴은 다음 broker prompt에서 제외된다. provider 실패를 정상 assistant 발화로 취급하지 않는 공통 불변식이다.
- OpenAI prompt-policy 오류는 자동 retry/fallback 대상에서 제외된다.

최초 upstream 오류는 다시 발생할 수 있다. 이 변경은 오류를 숨기지 않고 사용자에게 한 번 보여 주되 같은 세션을 계속 오염시키지 않는 데 목적이 있다.

## Verification

```bash
bun test packages/model-core/src/model-error-classifier.test.ts harness/rubato-pi/test/unit/broker.test.mjs
```

```text
87 pass
0 fail
```

## Files Changed

| File | Change |
|------|--------|
| `harness/rubato-pi/src/broker-request.mjs` | provider error assistant 턴을 다음 prompt에서 제외 |
| `harness/rubato-pi/test/unit/broker.test.mjs` | 오류 턴 재전송 회귀 테스트 |
| `packages/model-core/src/model-error-classifier.ts` | prompt-policy STOP 패턴 추가 |
| `packages/model-core/src/model-error-classifier.test.ts` | `try again` 포함 정책 오류의 비재시도 테스트 |
| `docs/rubato/openai-invalid-prompt-incident.md` | 관리자용 원인·재현·후속 조사 문서 |

## Commit

```text
fix(rubato): 정책 오류가 세션을 반복 오염시키지 않게 한다

Co-Authored-By: Codex <noreply@openai.com>
```

============================================================

## Codex native history 복원 [1949]

**Time**: 2026-08-27 19:49 +0900

### What Changed

최초 정책 오류의 원인을 좁히려고 원본 payload 계측 지점을 추적하다가, 계측보다 먼저 고쳐야 할 실제 요청 shape 버그를 확인했다.

- `fxPromptToPiContext()`가 OpenAI Codex의 과거 assistant 턴에 `api: "anthropic-messages"`를 붙였다.
- Senpi AI Responses serializer는 provider·api·model이 모두 현재 요청과 같은 reasoning item만 native continuation으로 재사용한다.
- 수정 전 wire test에서 signed reasoning은 `type: "reasoning"`과 `encrypted_content`로 남지 않고 일반 assistant `output_text`로 강등됐다.
- fast 모델은 history에 catalog alias를 붙이고 wire에는 canonical model을 보내서, API 태그만 고쳐도 같은 foreign-history 판정이 남았다.

`direct-provider.ts`가 Codex history를 `api: "openai-codex-responses"`로 표시하고, history model ID도 `requestModel.id`로 맞추도록 수정했다. 이제 fast 모델에서도 wire input에 native reasoning item과 암호화 continuation이 그대로 남는다.

### Decision

원본 Codex 오류 payload 계측은 이번 수정에서 보류했다. 해당 metadata는 Senpi AI stream catch에서 이미 평탄화되어 Rubato bridge에서 안전하게 복원할 수 없다. 이를 보존하려면 벤더 패치와 별도 유지보수 계약이 필요하다. 반면 history 태그 오류는 Rubato 소유 코드에 있고 공식 Codex 흐름과 다른 요청을 실제로 만들고 있었으므로 먼저 고치는 게 맞다. 수정 뒤에도 정책 오류가 재발하면 그때 최소 벤더 패치로 원본 event type/code/request ID를 보존한다.

### Files Modified

- `harness/bridge/src/direct-provider.ts`: Codex assistant history의 API·wire model identity 수정
- `harness/bridge/test/direct-provider.test.ts`: native reasoning context와 fast wire replay 회귀 테스트
- `docs/rubato/openai-invalid-prompt-incident.md`: 열린 가설이던 요청 차이를 확인된 버그와 수정으로 갱신
