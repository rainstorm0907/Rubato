---
date: 2026-08-27
scope: [rubato, omo-senpi, architecture, portability]
type: refactor
---

## TL;DR

Rubato의 OMO 독립화는 타당한 문제 제기지만 아직 구현 결론은 아니다. 네 활성 기능은 이미
Rubato가 소유한 코드이고 Pi 공개 extension도 존재한다. 동시에 OMO 조립층은 tool capture,
idle injection, DAG SDK/PATH provisioning, profile별 등록처럼 현재 Task·memory가 소비하는
계약을 제공한다. 다음 세션이 이름을 보고 삭제하지 않고 현재 경계, 공개 대체재의 parity,
clean-install 제거 실험을 순서대로 검증하도록
`docs/rubato/omo-independence-study.md`에 실행 gate를 남겼다.

## Keywords

`omo-independence` `omo-senpi` `Rubato registrar` `ON_COMPONENTS`
`composeOmoSenpiExtension` `senpi-task` `memory-core` `clean install`

## Context

이식성 감사에서 처음에는 “Task와 memory가 약 67k줄의 fork-owned code이므로 OMO를 전면
제거하지 말고 작은 registrar만 추출하자”는 방향을 잡았다. 사용자가 네 기능은 자신이 직접
뜯어고친 것이며 OMO에 묶일 이유가 없고 Pi 생태계에 adapter가 많을 수 있다고 지적했다.

그 지적은 맞다. “OMO를 유지해야 기능을 쓸 수 있다”는 전제가 뒤집혔다. 다만 바로 이어서
“독립 설계를 섣불리 하지 말고 신중하게 하자”는 제약이 추가됐다. 그래서 이번 문서는
registrar 추출을 결정하지 않고, 그 가설을 검증할 기준과 중단선을 남긴다.

## Investigation

- 실제 활성 component는 `ast-grep`, `lsp`, `task`, `memory` 네 개다.
- build gate와 runtime overlay gate가 따로 있다. adapter-only DAG child에서는 Task를
  빼지만 team member process에는 Task 엔진과 board tool을 다시 붙인다.
- `packages/omo-senpi/src/extension`은 약 565줄이지만 tool capture와 idle injection 등
  비단순 조립 서비스를 제공한다.
- 비테스트 코드 규모는 Task adapter/core 약 38.4k줄, memory adapter/core 약 30.8k줄,
  LSP 1.6k줄, ast-grep registrar 61줄이다.
- 공개 후보는 확인했다. `pi-lsp-extension`, `pi-ast-grep`, 여러 subagent package,
  `pi-memory` 계열이 있다. 존재만 확인했으며 source-level parity는 아직 검증하지 않았다.
- `harness/rubato-pi`의 npm `omo-ai`는 소스에서 직접 import되지 않고 중첩 Senpi 사본을
  만든다. 현재 실행 사본은 레포 루트 Senpi와 out-of-repo Rubato extension이다. 따라서
  npm 의존성은 제거 후보지만 clean install에서 lifecycle/transitive dependency 영향부터
  증명해야 한다.
- 직전 이식성 감사 기준점은 원격 `rubato/base`의 `79cfc9752`다.

## What Didn't Work

### ❌ 전체 OMO 제거와 registrar 추출을 같은 판단으로 본 것

- 시도: OMO가 제공하는 활성 기능이 네 개뿐이므로 작은 Rubato registrar가 정답이라고
  빠르게 결론내렸다.
- 문제: 기능 구현의 소유권과 공용 composition service의 필요성을 한 축으로 합쳤다.
  registrar 추출은 유력한 가설이지만 tool capture, idle injection, lead/member profile과
  배포 경로를 보존한다는 증거가 없었다.
- 교훈: 상위 프로젝트에서 독립할 때는 이름·LOC가 아니라 제품 구현, host adapter,
  composition, dead dependency를 먼저 분리한다.

### ❌ 공개 extension의 존재를 교체 가능성으로 읽는 것

- 시도: Pi 생태계에 LSP/subagent/memory extension이 있으므로 기존 구현을 대체할 수
  있다고 보려 했다.
- 문제: 일반 subagent는 Rubato의 reattach/DAG/team/provider admission 계약을, 일반
  memory는 identity/reflection/dreaming/data migration 계약을 보장하지 않는다.
- 교훈: 대체재 평가는 기능 이름이 아니라 현재 회귀 테스트가 고정한 계약을 행 단위로
  비교해야 한다.

## Decision Rationale

이번 세션은 독립 여부를 결정하지 않았다. 다음 순서를 결정했다.

1. 현재 runtime/import/bundle closure를 증명한다.
2. 공개 후보를 component별 contract matrix로 비교한다.
3. 격리 환경에서 npm `omo-ai` 제거를 먼저 실험한다.
4. characterization test 뒤 가장 작은 component로 registrar shadow spike를 한다.
5. 결과를 보고 유지, registrar 추출, 일부 교체, 대형 migration 중 하나를 사용자와 고른다.

Task·memory 교체, package rename, config rename은 첫 spike에 포함하지 않는다.

## Work Accomplished

### 1. 독립화 검토 기준 문서

- `docs/rubato/omo-independence-study.md`
- 현재 실행 경로와 두 component gate를 기록했다.
- component별 parity 질문과 네 선택지를 기록했다.
- 다음 세션의 Gate 0~4, 완료 조건, 금지할 지름길, 첫 조사 명령을 기록했다.

## Verification

- 문서의 활성 component 목록을 `harness/rubato-pi/src/policy.mjs`와
  `packages/omo-senpi/src/extension/component-list.ts`에서 대조했다.
- 런타임 경로를 `harness/rubato-pi/src/engine-paths.mjs`에서 대조했다.
- LOC는 `rg --files`로 비테스트 TS/JS/MJS만 다시 집계했다.
- 공개 후보는 pi.dev package 페이지와 `code-yeongyu/pi-ast-grep` README에서 존재만
  확인했다. 구현 parity와 license pin 검토는 다음 세션의 미결이다.
- 코드 변경은 없으므로 build/test는 돌리지 않았다.

## Architecture Impact

아키텍처는 바꾸지 않았다. 이 문서가 정한 중요한 경계는 다음과 같다.

- Senpi 유지 여부와 OMO composition 제거 여부는 별개다.
- registrar 독립화와 Task·memory 제품 구현 교체는 별개다.
- npm `omo-ai` 제거와 package rename도 별개다.
- low-risk spike와 high-risk migration을 한 PR에 섞지 않는다.

## Files Changed

| File | Change |
|---|---|
| `docs/rubato/omo-independence-study.md` | 독립화 판단 기준과 다음 세션 실행 gate |
| `cycles/2026-08/wk4/08-27/1747-omo-independence-handoff-wrap.md` | 이번 판단의 경위와 인수인계 |

## 미결

- 공개 LSP/ast-grep/subagent/memory 후보의 pinned source·license·contract matrix
- build metafile 기준 실제 OMO-origin module closure
- 격리 clean install에서 npm `omo-ai` 제거 실험
- 현재 registrar의 lead/member tool·event·flag characterization snapshot
- Rubato registrar shadow spike의 범위와 rollback 설계
- Linux/Windows에서 install, path, child-process parity

## 다음 세션 첫 문장

> `docs/rubato/omo-independence-study.md`를 정본으로 읽고 Gate 0과 Gate 1만 먼저 수행해.
> 구현이나 package rename은 하지 말고, 현재 runtime closure와 component contract matrix를
> 증거와 함께 가져와. dirty Task/DAG/model 파일은 다른 세션 소유이므로 건드리지 마.

## Commit

`docs(rubato): OMO 독립화 검토 기준을 남긴다`
