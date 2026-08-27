# Rubato에서 반복되는 OpenAI `Invalid prompt` 오류 분석

작성일: 2026-08-27  
전달 대상: Rubato 저장소 관리자  
상태: 최초 실패의 발생 지점은 확인했고, 같은 세션에서 오류를 반복시키는 Rubato 쪽 원인은 확인했다. OpenAI가 최초 요청을 왜 차단했는지는 아직 후보를 좁히는 단계다.

## 한 줄 결론

이 오류는 요청을 보내자마자 거절되는 일반적인 입력 차단이 아니다. OpenAI Codex transport가 reasoning summary를 일부 전달한 뒤 같은 턴에 top-level `error` 이벤트를 보내 `Invalid prompt`로 끝낸다. 최초 차단은 Rubato가 직접 만든 오류가 아니라 OpenAI Codex 응답에서 돌아오고, Rubato는 실패한 assistant 턴을 다음 요청에 다시 넣고 정책 오류까지 재시도해서 한 번 난 오류를 같은 세션에서 반복시키고 있었다.

## 사용자에게 보인 증상

Rubato로 정상적인 코딩·문서·브라우저 작업을 하던 중 다음 오류가 갑자기 나온다.

```text
Codex error: Invalid prompt: your prompt was flagged as potentially violating our usage policy. Please try again with a different prompt.
```

문제는 사용자가 같은 위험 문구를 계속 입력해서 생긴 모양이 아니었다. 확인한 실패는 문서 편집, 브라우저 확인, CodexBar 조사 등 서로 관련 없는 작업에 걸쳐 있었다. 첫 오류가 난 뒤 같은 세션에서 평범한 후속 요청을 보내도 같은 오류가 다시 나오는 경우가 많았다. Rubato를 수정한 뒤 프로세스를 재시작하자 그 장기 세션에서 다시 정상 응답이 나왔다.

## 최초 발견 조건

- 최초로 확인한 실패 시각은 **2026-08-25 15:33:03 UTC**다.
- **2026-08-25 15:33 UTC부터 2026-08-27 09:44 UTC까지**, 4개 세션에서 실제 assistant 오류 턴 23건을 확인했다.
- 세션에 저장된 provider는 `openai-codex`, model은 `openai-codex/gpt-5.6-sol`이었다.
- 짧은 단발성 질문보다 시스템 지시, 도구 정의, 이전 대화와 도구 결과가 함께 들어가는 장기 agent 세션에서 관찰됐다.
- 자동 컴팩션 직후에만 생긴 오류는 아니다. 컴팩션 문제와 같은 장기 세션에서 함께 보일 수는 있지만, 현재 근거로 둘을 같은 원인이라고 묶을 수 없다.

집계할 때는 오류 문자열 개수를 세면 안 된다. 같은 문구가 후속 prompt, 도구 출력, 조사 기록에도 복사돼 숫자가 부풀기 때문이다. 여기서 말하는 23건은 `role=assistant`, `stopReason=error`, `errorMessage`에 해당 정책 오류가 있는 턴만 구조적으로 센 값이다.

집계 대상은 사용자별 Rubato 상태 디렉터리의 `agent/sessions/<worktree>/*.jsonl`이다. 세션 파일은 저장소에 없고 사용자 대화가 들어 있어 이 문서에도 첨부하지 않았다. 재확인할 때는 위 세 조건을 만족하는 턴만 세면 된다.

## 재현 조건

### 실제 증상을 재현하는 방법

최초 차단은 간헐적이라 아직 한 번에 재현되는 짧은 prompt는 찾지 못했다. 현재 가장 가까운 재현 조건은 다음과 같다.

1. Rubato에서 `openai-codex/gpt-5.6-sol`을 선택한다.
2. 여러 차례 도구를 호출한 기존 세션을 계속 사용한다. 시스템 지시와 도구 schema, 사용자·assistant·도구 이력이 요청에 함께 들어가야 한다.
3. 코딩, 문서 수정, 브라우저 확인처럼 정상적인 agent 작업을 이어 간다.
4. transport 원본 로그에서 `response.reasoning_summary_text.delta`가 하나 이상 나온 뒤 top-level `type: "error"`가 오는지 기록한다. Rubato 세션 기록만 볼 수 있다면 부분 reasoning과 `stopReason=error`의 순서로 대신 확인한다.
5. 첫 실패 뒤 같은 세션에서 후속 요청을 보낸다. 수정 전 코드에서는 실패 assistant 턴이 다시 전송되고 정책 오류도 재시도돼 오류가 연속될 수 있다.

이 절차는 반복 가능성을 높이는 조건이지 결정적 최소 재현은 아니다. 최초 차단을 확실히 재현하려면 요청 원문을 보관한 뒤, 아래 비교 실험을 해야 한다.

### Rubato 쪽 반복 버그를 재현하는 방법

반복을 만드는 Rubato 버그는 외부 API 없이 단위 테스트로 재현된다.

1. 대화 이력에 `stopReason: "error"`인 assistant 메시지를 넣는다.
2. 그 메시지의 content와 `errorMessage`에 `Invalid prompt` 정책 오류를 넣는다.
3. `contextToFxRequest()`를 호출한다.
4. 수정 전에는 실패 메시지가 다음 `prompt`에 assistant 대화로 포함된다.
5. 오류 분류기에 같은 문구를 넣으면 문장 끝의 `try again` 때문에 재시도 가능한 오류로 판정된다.

즉, 최초 차단을 만드는 문제와 최초 차단을 세션 전체 문제로 키우는 문제는 따로 재현할 수 있다.

## 실제 요청 경로

Rubato의 OpenAI Codex 요청은 Senpi 기본 provider에서 바로 나가지 않는다. Rubato가 자체 broker와 bridge를 거친 뒤 Senpi AI의 Codex transport를 호출한다. **현재 `openai-codex/*` 경로는 OpenCodex `:10100`을 거치지 않는다.**

```text
Senpi 대화 상태
  ↓
Rubato broker overlay
  harness/rubato-pi/src/extensions/broker-overlay.mjs
  ↓
Rubato broker request/stream 변환
  harness/rubato-pi/src/broker-request.mjs
  harness/rubato-pi/src/broker-stream.mjs
  ↓ HTTP :8788
Rubato FX bridge
  harness/bridge/src/server.ts
  harness/bridge/src/direct-provider.ts
  ↓
@code-yeongyu/senpi-ai의 openai-codex provider
  harness/bridge/package.json에서 2026.8.19로 고정
  ↓
OpenAI Codex backend
```

`broker-overlay.mjs`가 `openai-codex` provider의 stream 함수를 Rubato의 `streamBroker`로 바꾼다. `broker-request.mjs`가 Senpi 대화 상태를 FX gateway 형식으로 만들고, `server.ts`가 `openai-codex/*` 모델을 direct provider로 분기한다. `direct-provider.ts`는 FX prompt를 다시 Senpi AI context로 만들고 `@code-yeongyu/senpi-ai`의 `openaiCodexProvider()`로 보낸다.

응답은 반대로 올라온다. Senpi AI transport가 reasoning을 `thinking_*` 이벤트로 주면 `direct-provider.ts`가 Rubato의 `reasoning-*` 이벤트로 바꾼다. 오류가 오면 같은 파일이 `event.error.errorMessage`를 Rubato 오류 이벤트로 넘긴다. `broker-stream.mjs`는 이 이벤트들을 최종 Senpi assistant 메시지로 조립한다. 따라서 reasoning 일부가 먼저 도착하고 그 뒤 오류가 났다는 순서는 저장된 세션과 direct transport 변환 코드로 설명된다.

`fx-request.ts`, `fx-stream.ts`, OpenCodex `:10100`은 **OpenCodex 카탈로그의 비-direct 모델**에 쓰는 별도 경로다. 이번 `openai-codex/gpt-5.6-sol` 오류의 실행 경로로 적으면 안 된다.

여기서 **broker**는 Senpi의 모델 요청을 `127.0.0.1:8788`로 보내는 Rubato overlay다. **FX**는 broker와 bridge 사이에서 쓰는 중간 요청 형식이고, **direct provider**는 bridge가 OpenCodex 같은 외부 중계기를 거치지 않고 vendor transport를 호출하는 경로다.

## 무엇이 비표준인가

여기서 비표준이라는 말은 개별 API가 잘못됐다는 뜻이 아니다. **공식 Codex CLI가 관리하는 대화 상태를 그대로 보내는 경로가 아니라, Senpi 대화를 Rubato FX 형식으로 바꿨다가 다시 Senpi AI context로 복원해서 Codex transport에 넣는 자체 조합**이라는 뜻이다.

차이가 생기는 지점은 다음과 같다.

- Rubato는 긴 system prompt를 FX prompt의 `system` 메시지로 만들고, `direct-provider.ts`가 다시 `systemPrompt`로 합친다. Senpi AI의 Codex serializer가 그다음 실제 upstream body를 만든다.
- 이전 사용자 메시지, assistant 출력, tool call, tool result를 매 요청마다 FX prompt로 재구성한 뒤 다시 Senpi AI message로 복원한다.
- Senpi의 `thinking`은 중간 FX 형식에서 `reasoning` part가 되고, direct 경로의 `fxPromptToPiContext()`는 이를 다시 `thinking` block과 signature로 복원한다. 따라서 이번 direct Codex 경로에서는 과거 reasoning이 버려진다는 설명이 맞지 않는다.
- 반대로 실패한 턴에 남은 content는 수정 전 `broker-request.mjs`가 정상 assistant 대화처럼 다음 요청에 넣었다.
- direct provider는 최종 오류를 `openai-codex_direct`라는 공통 code로 바꾼다. upstream의 세부 `code/type`과 request ID는 최종 세션 기록에 남지 않아 어느 정책 판정기가 거절했는지 가를 정보가 부족하다.

이 차이 때문에 공식 Codex CLI에서 같은 사용자 문장을 입력한 결과와 Rubato의 결과를 바로 같다고 볼 수 없다. 사용자 문장은 같아도 실제 서버가 받는 `instructions`, 전체 이력, tool schema, continuation 정보가 다르다.

## 이벤트 순서로 확인한 사실

Senpi AI Codex transport가 처리하는 원본 이벤트와 저장된 실패 턴을 대조하면 순서는 아래와 같다.

```text
response.reasoning_summary_text.delta
response.reasoning_summary_text.delta
...
error
  message = "Invalid prompt: ... potentially violating ..."
```

Senpi AI의 Codex parser는 top-level `error`에만 `Codex error:` 접두사를 붙인다. `response.failed` 분기도 따로 있지만 그쪽은 이 접두사를 붙이지 않는다. 실제 사용자 오류가 `Codex error: Invalid prompt...`였으므로, 이번 23건은 `response.failed`가 아니라 top-level `error` 경로로 보는 것이 코드와 맞다.

따라서 “OpenAI가 요청 본문을 읽기 전에 HTTP 단계에서 바로 막았다”는 설명은 틀리다. 모델 응답 처리가 시작됐고 reasoning summary 일부가 스트리밍된 뒤 오류가 왔다.

다만 이것만으로 **정책 판정 대상이 생성 중 reasoning이었다**고 확정할 수도 없다. OpenAI가 입력을 비동기로 검사하다 늦게 실패시켰을 수도 있고, 생성된 reasoning을 검사했을 수도 있으며, Senpi AI transport가 upstream 이벤트를 최종 오류로 바꾸는 과정에서 세부 정보를 잃었을 수도 있다. 현재 로그가 확정하는 것은 오류가 reasoning 전달 뒤에 관찰됐다는 데까지다.

한 가지 이상한 점도 남아 있다. `broker-stream.mjs`는 reasoning을 `thinking` block으로 만들지만, 실패한 23개 assistant 턴의 최종 세션 기록에는 부분 생성물이 `text` block으로 저장돼 있었다. thinking을 text로 바꾸는 코드는 broker stream과 direct provider에서 찾지 못했다. 다만 오류 조립 경로는 `broker-stream.mjs`의 error 처리와 `settleBrokerOutput()`까지 좁혔다. 도구 호출이 있는 실패 턴은 여기서 `toolUse`로 바뀌고 `errorMessage`가 지워지므로, `stopReason=error`로 남은 23개 턴은 도구 호출이 없던 턴이다. 남은 후보는 reasoning slot이 애초에 열리지 않았거나 세션 저장 계층에서 모양이 바뀌는 경우다. 반복 오염을 막는 수정은 error assistant 턴 전체를 제외하므로 이 미확정 변환과 상관없이 동작한다.

## 원인 규정

### 확인된 원인 1: 오류 문구는 Codex transport가 upstream 필드로 조립한다

Rubato 코드가 `Invalid prompt` 문구를 만드는 것은 아니다. `direct-provider.ts`는 Senpi AI stream의 `event.error.errorMessage`를 읽어 전달하고, Senpi AI의 Codex parser는 upstream 오류의 message를 `Codex error: ...`로 조립한다. 확인된 것은 문구의 생성·전달 지점까지다. 실제 정책 판정이 어느 서버 구간에서 일어났는지는 원본 payload와 request ID가 없어 아직 확정하지 못했다.

### 확인된 원인 2: Rubato가 실패 턴을 다시 보냈다

수정 전 `contextToFxRequest()`는 `role=assistant`면 `stopReason=error`여도 다음 prompt에 포함했다. provider가 중간에 실패한 턴은 모델이 정상적으로 끝낸 답변이 아닌데도 대화 이력으로 취급한 셈이다. 저장된 부분 출력과 정책 오류 주변 문맥이 다음 요청에 다시 들어가면서 같은 세션이 오염됐다.

### 확인된 원인 3: 정책 오류를 재시도했다

오류 문구에는 `Please try again with a different prompt`가 들어 있다. 공용 오류 분류기는 `try again`을 재시도 신호로 봤다. 하지만 이 문장의 뜻은 같은 요청을 다시 보내라는 말이 아니라 다른 prompt로 바꾸라는 말이다. 정책 거절을 그대로 재시도하면서 첫 실패가 연속 실패로 커졌다.

### 아직 확정하지 않은 것

- OpenAI가 입력 전체를 차단했는지, 생성 중 reasoning을 차단했는지
- Senpi AI Codex serializer가 공식 Codex CLI와 정확히 어떤 필드 차이로 요청했는지
- 긴 `instructions`, 누적 이력, tool schema 중 어느 부분이 최초 판정을 흔들었는지
- 오류의 원본 `code`, `type`, request ID가 무엇이었는지
- 부분 reasoning이 최종 세션에서 `text`로 저장되는 정확한 변환 지점

## reasoning 오탐이 생겼을 가능성

아래는 가능한 설명을 우선순위대로 열어 둔 것이다. 아직 원인으로 확정하면 안 된다.

### 가능성 A — 생성된 reasoning을 정책기가 뒤늦게 막았다

reasoning summary가 먼저 나온 뒤 실패했다는 관찰과 가장 잘 맞는다. agent는 파일, 프로세스, 인증, 종료, 정책 같은 말을 자주 다룬다. 사용자의 실제 목적은 정상적인 개발 작업이어도 모델 내부 reasoning이 이 단어들을 강한 명령형으로 조합하면 정책기가 문맥을 잘못 읽을 수 있다.

반증 방법은 원본 요청을 고정한 채 reasoning effort만 바꾸거나 reasoning summary를 요청하지 않는 대조군을 돌리는 것이다. 오류율이 같다면 이 가설은 약해진다.

### 가능성 B — 긴 system instructions와 누적 대화를 하나의 위험한 prompt로 판정했다

Rubato의 system prompt에는 도구 실행, 프로세스 제어, 파일 수정, 브라우저 조작 같은 권한 설명이 많이 들어간다. 각각은 개발 agent에 필요한 정상 지시지만, 긴 대화 이력과 합쳐진 전체 문자열을 일반 사용자 prompt처럼 검사하면 오탐할 수 있다.

반증하려면 사용자 메시지는 그대로 두고 system instructions, tool schema, 이전 이력을 하나씩 뺀 요청을 같은 모델에 보내야 한다.

### 가능성 C — Rubato의 대화 재구성이 공식 Codex의 연속성 규칙과 다르다

Rubato는 이전 대화를 매번 FX prompt로 만들고 다시 Senpi AI context로 복원한다. direct 경로에서는 reasoning과 signature도 복원하지만, 공식 Codex CLI의 원래 response item이나 continuation ID를 그대로 재사용하는지는 확인하지 못했다. 같은 내용이어도 대화 연속성을 표현하는 방식이 달라 정책 판정이나 모델 상태 복원에 영향을 줄 수 있다.

반증하려면 같은 작업을 공식 Codex CLI 요청과 Rubato 요청으로 각각 캡처해 필드 단위로 비교해야 한다. 사용자 콘텐츠 비교만으로는 부족하다.

### 가능성 D — Senpi AI Codex transport가 공식 CLI와 다른 body를 만든다

Rubato direct provider는 `@code-yeongyu/senpi-ai`의 `openaiCodexProvider()`를 쓴다. 공식 Codex CLI와 같은 인증 계열을 써도 모델 이름, session ID, reasoning 설정, service tier, continuation 관련 필드가 완전히 같은지는 아직 비교하지 않았다. transport는 upstream 오류를 Rubato가 쓰는 하나의 오류 모양으로 바꾸므로 세부 정보도 줄어든다.

반증하려면 동일한 사용자 작업을 공식 Codex CLI와 Rubato direct provider에서 실행하고, 민감 값을 지운 최종 요청 body를 필드 단위로 비교해야 한다.

### 가능성 E — 특정 콘텐츠가 아니라 요청 크기나 도구 수가 확률을 올린다

오류가 서로 다른 주제의 장기 세션에서 나왔다는 점과 맞는다. 긴 instructions, 많은 input item, 큰 tool schema가 정책 검사기의 분할이나 요약 과정에 영향을 줬을 수 있다.

반증하려면 실패 요청마다 instructions 문자 수, input item 수, tool 수, tool schema 크기, 컴팩션 직후 여부를 콘텐츠 없이 기록하고 정상 요청과 비교해야 한다.

## 이미 적용한 Rubato 쪽 수정

최초 upstream 차단 원인을 모르는 상태에서도 반복 고리는 끊을 수 있다.

1. `harness/rubato-pi/src/broker-request.mjs`
   - `stopReason === "error"`인 assistant 메시지를 다음 요청에서 제외했다.
   - provider 실패는 assistant가 완성한 대화가 아니라는 기준을 적용했다.
2. `packages/model-core/src/model-error-classifier.ts`
   - `invalid prompt`, `flagged as potentially violating`을 재시도 중단 패턴에 넣었다.
   - 문구 안에 `try again`이 있어도 정책 거절을 자동 재시도하지 않는다.
3. 두 동작에 회귀 테스트를 추가했다.

reasoning 원문을 전부 제거하는 수정도 한때 검토했지만 되돌렸다. 실제 `openai-codex/*` direct 경로는 `fxPromptToPiContext()`가 reasoning과 signature를 복원한다. reasoning 전체를 지우면 정상 대화 연속성까지 깨질 수 있고, 실패 턴 전체를 제외하는 더 좁은 수정으로 반복 고리를 끊을 수 있다.

## 검증 결과

다음 테스트를 실행했다.

```bash
bun test packages/model-core/src/model-error-classifier.test.ts harness/rubato-pi/test/unit/broker.test.mjs
```

결과:

```text
87 pass
0 fail
```

수정 전 프로세스는 이전 코드를 메모리에 들고 있어서 같은 오류가 계속 났다. 프로세스를 종료하고 수정 뒤 다시 시작한 다음, 문제가 나던 장기 세션에서 정상 응답이 생성되는 것까지 확인했다. 다만 이것은 반복 고리가 끊겼다는 실행 증거다. 최초 upstream 정책 차단이 다시는 발생하지 않는다는 뜻은 아니다.

## 다음 조사에서 꼭 남겨야 할 정보

최초 차단 원인을 더 좁히려면 개인정보와 대화 원문을 남기지 않고 아래 메타데이터를 기록하는 편이 좋다.

- OpenAI Codex request ID
- top-level Codex `error` 이벤트의 code/type/payload 원문
- model ID, reasoning effort, service tier
- system instructions 문자 수와 해시
- input item 수를 role과 type별로 나눈 값
- tool 수와 tool schema 전체 크기
- 세션 누적 턴 수, 마지막 컴팩션과의 거리
- reasoning 첫 delta부터 실패까지 걸린 시간과 생성된 문자 수
- 같은 요청을 공식 Codex CLI, Rubato direct provider, 최소 system prompt로 보낸 비교 결과

원문 전체를 먼저 수집하는 방식은 피하는 게 좋다. 위 메타데이터로 상관관계를 좁힌 뒤, 재현되는 요청 한 건만 민감 정보를 지워 비교하면 된다.

## 관리자에게 요청하는 판단

Rubato 쪽에서는 실패 턴 재전송과 잘못된 재시도를 막는 수정이 타당한지 먼저 봐줬으면 한다. 그다음 최초 차단은 아래 순서로 확인하는 게 가장 빠르다.

1. top-level Codex `error` 이벤트의 원본 code/type/payload와 request ID를 보존한다.
2. 공식 Codex CLI와 Rubato→Senpi AI Codex transport의 최종 요청 shape를 비교한다.
3. 동일 요청에서 instructions, history, tools, reasoning 설정을 하나씩 줄여 대조한다.
4. Rubato broker/FX 변환을 생략하고 bridge에서 Codex transport를 직접 호출한 대조군을 만든다.

지금 단계에서 “사용자 prompt가 정책을 위반했다”거나 “reasoning이 확실히 오탐됐다”고 닫으면 안 된다. 확인된 것은 **응답 스트림이 시작된 뒤 정책 실패가 왔다는 것**, 그리고 **Rubato가 그 한 번의 실패를 같은 세션에서 반복시키고 있었다는 것**까지다.
