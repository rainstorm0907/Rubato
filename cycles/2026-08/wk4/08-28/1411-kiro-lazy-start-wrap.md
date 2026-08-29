---
date: 2026-08-28
scope: [rubato, kiro, docker, bridge]
type: fix
---

## TL;DR
Kiro를 사용하지 않아도 로그인 직후 Docker Desktop이 상시 기동되던 흐름을 제거했습니다. 실제 `kiro/*` 요청이 들어올 때만 Docker와 `kiro-rs`를 복원하며, 기존 자격증명을 그대로 사용합니다.

## Keywords
`kiro.rs` `Docker Desktop` `lazy start` `ensureKiroSidecar` `kiro-setup.sh`

## Context
Rubato는 Kiro 구독 모델을 `kiro.rs` 사이드카를 통해 호출합니다. 기존 구현은 재부팅 뒤 사이드카가 사라지는 문제를 막기 위해 로그인 supervisor와 일반 Rubato 실행에서 `kiro-setup.sh ensure`를 선제 호출했습니다.

이 방식은 복원에는 확실했지만 Kiro를 쓰지 않는 날에도 Docker Desktop VM을 항상 띄웠습니다. 현재 구성에서는 `kiro-rs` 컨테이너 하나가 약 16MiB를 쓰는 반면 Docker Desktop 전체는 약 943MiB를 사용했습니다. 비용을 발생시키는 시점을 실제 Kiro 사용 시점으로 옮길 필요가 있었습니다.

## Investigation
- `harness/scripts/start.sh`와 `harness/scripts/rubato-pi.sh`가 로그인 및 일반 세션 시작 때 `ensure`를 호출하는 것을 확인했습니다.
- 브리지의 모든 직접 프로바이더 요청이 `directProviderToFxSse`를 지나며, 이 함수가 모델 공급자를 판별한 뒤 업스트림 요청을 만드는 것을 확인했습니다.
- 기존 `~/.rubato-pi/kiro/credentials.json`에 refresh token, client ID, client secret이 모두 남아 있고, 브라우저 로그인 없이 모델 19개를 조회할 수 있음을 확인했습니다.
- Docker Desktop을 완전히 정지한 뒤 지연 기동 경로로 Docker, `kiro-rs`, 모델 목록을 순서대로 복원했습니다. 이 기기의 측정값은 7~8초였으며 최악 시간의 상한으로 보지 않습니다.
- 실제 Docker Desktop CLI에서 실행 중 `status`는 종료 코드 0, 완전 종료 상태는 종료 코드 1을 반환하는 것을 확인했습니다.

## What Didn't Work
### Docker 앱을 `open`으로만 다시 여는 방식
- 시도: Docker Desktop 앱을 종료한 뒤 `open -gja Docker`로 복원했습니다.
- 문제: 앱 프로세스는 남고 Linux VM만 내려간 반종료 상태에서 macOS가 이미 실행 중인 앱으로 판단했습니다. `docker info`도 응답 없이 오래 대기했습니다.
- 교훈: 앱 존재 여부가 아니라 Docker 엔진 상태를 제한 시간 안에 확인하고, Docker Desktop 전용 `start` 또는 `restart` 명령을 선택해야 합니다.

## Decision Rationale
`kiro.rs` 바이너리는 Linux ELF로 배포되어 macOS에서 직접 실행할 수 없습니다. OrbStack으로 교체하는 방법도 검토했지만 Kiro 하나를 위해 별도 컨테이너 런타임을 유지한다는 구조는 그대로였습니다.

따라서 기존 Docker 배포는 유지하되 기동 시점만 요청 경계로 옮겼습니다. 자동 종료는 다른 Docker 작업까지 끌 수 있으므로 이번 범위에서 제외했습니다.

## Work Accomplished
### 1. Kiro 요청 경계에서 사이드카를 복원합니다
서버가 SSE 200 헤더를 보내기 전에 `prepareDirectProvider`로 `kiro/*` 모델의 `ensureKiroSidecar`를 기다립니다. 복원 실패는 HTTP 503으로 전달합니다. 동시에 들어온 요청은 같은 브리지 프로세스 안에서 진행 중인 복원 작업을 공유하고, 비Kiro 공급자는 이 경로를 타지 않습니다.

### 2. 로그인과 일반 세션의 Docker 선기동을 제거합니다
로그인 supervisor의 백그라운드 `ensure`를 삭제했습니다. 일반 Rubato 시작에서는 예전 자격의 `clientId`만 보정하는 `heal`을 호출하며 Docker는 띄우지 않습니다.

### 3. Docker Desktop의 반종료 상태를 복구합니다
`docker info` 판정을 3초로 제한했습니다. Docker Desktop 엔진 상태가 살아 있으면 `restart`, 내려가 있으면 `start`를 호출하고 최대 30회 준비 상태를 확인합니다. 자격 보정만 수행할 때는 Docker가 이미 건강한 경우에만 컨테이너를 재시작합니다.

### 4. 회귀 테스트를 보강합니다
Kiro는 업스트림 요청 전에 복원되는지, 비Kiro 요청은 복원을 호출하지 않는지, Docker Desktop의 정상 종료와 반종료 상태를 각각 복구하는지 검증합니다.

## Architecture Impact
- 브리지 모델 목록은 정적이므로 Kiro 모델을 조회하는 것만으로 Docker가 기동되지 않습니다.
- 첫 Kiro 요청에는 이 기기에서 7~8초의 냉기동 지연이 발생했습니다. 이미지 재다운로드나 느린 Docker 기동에서는 더 오래 걸릴 수 있습니다.
- 기존 Kiro 자격증명을 재사용하므로 브라우저 로그인이 필요하지 않습니다.
- Docker 또는 사이드카 복원 실패는 첫 Kiro 요청의 오류로 전달됩니다. 다른 공급자에는 영향을 주지 않습니다.

## Files Changed
| File | Change |
|------|--------|
| `harness/bridge/src/direct-provider.ts` | Kiro 요청 직전 사이드카 지연 기동 |
| `harness/bridge/src/server.ts` | Kiro 복원을 SSE 헤더 전으로 이동하고 실패를 503으로 전달 |
| `harness/bridge/test/direct-provider.test.ts` | Kiro 순서 및 비Kiro 격리 테스트 |
| `harness/scripts/kiro-setup.sh` | 제한 시간 probe와 Docker Desktop 상태별 복구 |
| `harness/scripts/start.sh` | 로그인 시 Kiro 선기동 제거 |
| `harness/scripts/rubato-pi.sh` | 일반 실행 시 자격 보정만 수행 |
| `harness/rubato-pi/test/unit/kiro-recovery.test.mjs` | 복구 정책 회귀 테스트 |
| `harness/docs/provider-routing.md` | 지연 기동 운영 문서 갱신 |

## Commit
fix(kiro): 첫 요청에서 Docker 사이드카를 깨운다

Co-Authored-By: Codex <noreply@openai.com>
