---
date: 2026-08-29
scope: [harness, updater]
type: fix
---

## TL;DR

`harness/scripts/rubato-update.sh`의 실행 비트를 복구하고, 이후 병합에서 다시 사라지면 단위 테스트가 바로 실패하도록 고정하였다.

## Keywords

`rubato-update.sh` `rubato-pi.sh` `executable mode` `100755` `Permission denied`

## Context

origin의 `rubato-update.sh`가 `100644`로 추적되고 있었다. 런처의 `rubato update` 경로는 스크립트를 직접 실행하므로 `Permission denied`로 종료되었고, 세션 시작 시 자동 확인은 `[ -x "$HERE/rubato-update.sh" ]` 조건에서 조용히 건너뛰었다. 사용자는 업데이트 알림을 받지 못한 채 28커밋 뒤처졌다.

이 파일은 `2aa3b883a`에서 한 번 `100755`로 복구되었지만, `4874b4ec7` 병합이 실행 비트 없는 부모의 파일을 선택하면서 다시 `100644`가 되었다. 모드만 고치고 검증하지 않으면 같은 회귀가 반복될 수 있었다.

## Investigation

`origin/rubato/base`를 아카이브해 깨끗한 복사본에서 실행하였다.

- `rubato-update.sh --check`: exit 126, `Permission denied`
- `rubato-pi.sh update --check`: exit 1, `Permission denied`
- `chmod +x rubato-update.sh` 후 직접 실행: exit 0

기존 `rubato-update.test.mjs`는 `spawnSync("sh", [scriptPath])`로 본문을 검사하므로 실행 비트가 없어도 모두 통과하였다. 따라서 동작 테스트만으로는 이 회귀를 잡을 수 없었다.

## Decision Rationale

정상 인터페이스가 스크립트를 직접 실행하고 다른 하네스 스크립트도 `100755`로 추적되므로, 호출부를 모두 `sh` 우회로 바꾸지 않고 파일 모드를 복구하였다. 대신 소스 파일의 실행 비트를 직접 검사하는 테스트를 추가하여 병합이나 패치 적용이 모드를 다시 잃으면 CI에서 드러나게 하였다.

Anthropic 인증 문제는 이 변경에서 제외하였다. 그 문제는 로컬 셸이 setup-token을 공식 OAuth 변수 대신 bearer 변수에 넣어 발생한 별도 설정 문제이며, updater 실행 권한과 원인·수정 경계가 다르다.

## Work Accomplished

1. `harness/scripts/rubato-update.sh`를 `100644`에서 `100755`로 복구하였다.
2. `rubato-update.test.mjs`에 정본 스크립트가 실행 가능한지 검사하는 회귀 테스트를 추가하였다.

## Architecture Impact

업데이트 내용과 병합 절차는 바뀌지 않는다. 런처가 원래 의도한 직접 실행 경로만 다시 살아나며, 이후 실행 비트 손실은 테스트 실패로 차단된다.

## Files Changed

| File | Change |
|------|--------|
| `harness/scripts/rubato-update.sh` | 실행 비트를 `100755`로 복구 |
| `harness/rubato-pi/test/unit/rubato-update.test.mjs` | 정본 updater 실행 권한 회귀 테스트 추가 |
| `cycles/2026-08/wk5/08-29/1507-updater-executable-mode-wrap.md` | 원인, 재현, 결정과 검증 기록 |

## Commit

`fix(harness): 업데이트 스크립트의 실행 비트를 되살린다`

`test(harness): 업데이트 실행 권한 회귀를 막는다`
