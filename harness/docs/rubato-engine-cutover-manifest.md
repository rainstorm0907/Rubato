# Rubato Engine cutover manifest

상태: provider 직결 구현과 함께 적용할 runtime 정리 계약

운영자 적용 순서는 [`provider-direct-apply-runbook.md`](provider-direct-apply-runbook.md)에
있다. 이 문서는 **무엇을 지우고 무엇을 남기는가**의 계약이고, 그것을 라이브 설치로 옮기는
순서는 그쪽이다.

## 이름과 경계

- 최종 제품과 runtime 이름은 `Rubato Engine`이다.
- 사용자 명령은 `rubato`를 유지한다.
- provider extension은 `provider-overlay.mjs`, 공통 stream 계층은
  `rubato-stream.mjs` / `withRubatoStream`으로 부른다.
- `127.0.0.1:8788`과 shadow `:18788`은 제품 구성요소가 아니라 전환 중인 legacy
  compatibility bridge다. Rubato Engine 최종 runtime은 이 포트들을 알거나 관리하지 않는다.
- upstream package/export/patch 이름은 출처 추적과 update 호환에 필요한 범위에서만 유지한다.

## provider cutover에 포함하는 삭제

Phase 5A gate가 통과하면 Rubato 소유 runtime에서 다음을 제거한다.

- `harness/bridge/`의 FX request/SSE 변환과 bridge 전용 dependency
- `broker.mjs`, `broker-request.mjs`, `broker-stream.mjs`
- `extensions/broker-overlay.mjs`
- `ensureBroker`, `loadCatalog`, `streamBroker`와 broker catalog 합성
- bridge health/supervisor/restart/doctor/install hook
- `FX_BRIDGE_*`, `RUBATO_BROKER_*`, `RUBATO_NO_BRIDGE_CHECK`,
  `RUBATO_NO_SUPERVISOR`, `RUBATO_SUPERVISED`, `RUBATO_SUPERVISOR_*`
- 사용자 UI와 로그의 `fx-v3-bridge`, `Rubato broker`, `rubato-broker` 명칭

기존 8788/18788 listener와 LaunchAgent를 unload·signal·drain·rewrite하지 않는다. 새 runtime이
독립적으로 gate를 통과한 뒤 repository integration만 먼저 제거한다. listener 폐기는 별도
operator cutover다.

## provider cutover에 포함하는 rename

- `broker-overlay.mjs` → `provider-overlay.mjs`
- `brokerProviders` → `supportedProviders`
- `ourProviderIds` / `FALLBACK_OURS` → 정적 `SUPPORTED_PROVIDER_IDS`
- Rubato 소유 오류·상태·문서의 `rubato-pi` → `Rubato Engine`
- 새 provider 설정은 `RUBATO_ENGINE_*` 또는 provider별 `RUBATO_*` 이름을 쓴다.

`senpi:no-turn-retry:`와 pinned `pi-ai`의 Cursor exec-resolved symbol은 engine contract이므로
rename하지 않는다.

## compatibility window

provider 설정의 예전 `FX_*` 변수는 canonical 변수가 없을 때만 읽고 한 번 경고한다. child
process에는 canonical 변수만 넘긴다. 모든 배포 대상이 새 이름을 쓰면 fallback을 제거한다.

upstream package가 요구하는 `OMO_*` 값은 `upstream-compat.mjs` 한 파일에서만 읽거나 지운다.
Rubato 제품 설정, UI, 로그, child export에는 노출하지 않는다.

## 이번 cutover와 분리하는 state migration

다음 경로는 문자열 rename만으로 옮기지 않는다.

- `~/.rubato-pi`
- `~/.omo`
- repository `.omo/`

인증·세션·cmux resume·measurement·Cursor journal을 두 root에 나누면 단일 권위와 rollback
불변식이 깨진다. 새 `~/.rubato-engine` profile은 별도 change에서 lock, atomic copy/rename,
검증 marker, rollback과 기존 session reattach 시험을 갖춘 뒤 도입한다. 그 전까지
`~/.rubato-pi`는 legacy profile root이지만 제품 UI에는 표시하지 않는다. 사용자 데이터를
자동 삭제하지 않는다.

## 허용하는 upstream provenance

다음은 runtime branding이 아니라 build/update 출처이므로 좁게 허용한다.

- `packages/omo-*`, `packages/oh-my-opencode-*`, `@oh-my-opencode/*`
- `extensions/omo.js`, `extensions/omo-task.js` 같은 upstream export 이름
- `patches/@code-yeongyu%2Fsenpi*/**`
- `docs/upstream/**`, `THIRD-PARTY-NOTICES.md`, lockfile
- component policy와 upstream independence 기록의 정확한 upstream 이름

## 완료 gate

Phase 5 뒤 아래 검색은 migration/provenance allowlist 밖의 Rubato 소유 runtime 잔재가 없어야
한다.

```bash
rg -n -S \
  '(FX_[A-Z0-9_]+|fx-v3-bridge|rubato-broker|Rubato broker|broker-overlay|broker-stream|streamBroker|ensureBroker|loadCatalog|RUBATO_BROKER_[A-Z0-9_]+|127\.0\.0\.1:(8788|18788)|RUBATO_PI_[A-Z0-9_]+|rubato-pi)' \
  harness install.sh docs/rubato \
  --glob '!**/node_modules/**'
```

허용 목록은 이 manifest, provider-direct migration evidence, upstream provenance 문서와
`upstream-compat.mjs`로 제한한다. 별도로 다음을 확인한다.

```bash
test -f packages/omo-senpi/package.json
test -f packages/omo-senpi/plugin/extensions/omo.js
test -f patches/@code-yeongyu%2Fsenpi@2026.8.22.patch
```
