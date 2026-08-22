# Provider routing and verification status

기준일: 2026-08-20

이 문서는 rubato harness에서 모델별 실제 전송 경로와 검증 범위를 구분한다. 모델이 목록에 보이거나 단일 응답을 반환하는 것만으로 `stable` 또는 `cache verified`라고 부르지 않는다.

## 현재 라우팅

```text
fx
  → 127.0.0.1:8788 fx-v3-bridge
       ├─ xai/*       → senpi-ai xAI transport → api.x.ai
       ├─ anthropic/* → senpi-ai Anthropic Messages transport → Anthropic
       └─ 나머지      → OpenCodex 127.0.0.1:10100
                        ├─ Codex
                        └─ Cursor (보류)
```

`senpi-ai`에서는 provider transport만 사용한다. Senpi agent나 Senpi tool executor는 사용하지 않는다. 모델의 tool call은 bridge가 fx SSE로 변환하고 실제 도구는 fx가 실행한다.

## 상태표

| 프로바이더 | 모델 예 | 경로 | 실제 fx tool loop | 캐시 | 현재 판정 |
|---|---|---|---|---|---|
| Grok | `xai/grok-4.6` | xAI OAuth direct | PASS | provider usage에서 cache read 관측 | canary |
| Claude | `anthropic/claude-opus-5` | Anthropic Messages + Claude setup-token | PASS | cold `cacheWrite=45037`, 후속 `cacheRead=45037` | canary |
| Codex | `gpt-5.6-*` | OpenCodex | Responses 변환 및 실제 fx 응답 PASS | 53KB prefix T2–T6 모두 `cacheRead=13056/13879` | 유지 |
| Cursor | `cursor/*` | OpenCodex Cursor Connect | 단일 턴 기준선만 있음 | 멀티턴 캐시 실패/미검증 | 보류 |

Grok과 Claude도 평가 계약의 `주력 채택` 조건을 전부 통과한 것은 아니다. 현재 live evidence는 실제 fx tool loop와 cache telemetry까지다. 6턴·2 tool call·abort·bridge 재시작·OAuth refresh를 모두 묶은 soak가 남아 있어 판정은 `canary`다.

Codex는 OpenCodex 경로를 유지한다. 최초 측정에서 캐시가 간헐적으로만 적중했지만 원인은 bridge가 fx session을 버린 것이었다. bridge가 같은 fx session을 OpenCodex body의 `prompt_cache_key`와 `session-id` header에 전달하도록 고친 뒤, 고유 SALT가 붙은 53,052-byte prefix에서 T1 cold, T2–T6 `cacheRead=13,056 / input=13,879`가 연속 관측됐다. 후속 hit rate는 약 94.1%로 평가 계약의 85% 기준을 넘는다. cache usage도 이제 fx finish event에 보인다.

Cursor는 기본 경로로 배치하지 않는다. 공식 Cursor CLI의 resume/cache 기준선은 있지만 OpenCodex Cursor route가 같은 수준으로 prefix cache를 보존한다는 증거가 없으며 이전 멀티턴 측정에서 정상 판정을 받지 못했다.

공개 조사에서도 CLIProxyAPI + `cliproxy-cursor-plugin`과 `oh-my-pi`에는 Cursor prefix-cache hit 수치가 없었다. 현재 가장 가까운 증거는 `senpi` native Cursor transport의 2턴 probe(T1 `cacheWrite=21354`, T2 `cacheRead=17575`)다. 이것도 n=2이고 OpenAI-compatible proxy가 아니므로 바로 채택하지 않는다. 다음 세션에는 cache usage가 없는 경로를 `0`이 아니라 `unavailable`로 기록하는 공통 계측부터 추가하고, 공식 Cursor CLI·현재 OpenCodex·senpi native 후보를 같은 53KB/6턴 fixture로 비교한다. 상세 근거와 필드는 `case-studies/2026-08-20-cursor-cache-public-evidence-and-next-steps.md`에 있다.

## OpenCodex 유지와 교체 기준

현재 Codex cache가 계약을 통과했으므로 OpenCodex를 즉시 제거하지 않는다. 다음 중 하나가 재현되면 Codex route를 별도 transport로 분리한다.

- 같은 `prompt_cache_key`에서 T3–T6 중앙 hit rate가 85% 미만
- upstream Codex protocol drift가 반복되어 fx tool loop를 깨뜨림
- OpenCodex의 넓은 provider surface 때문에 회귀 또는 운영 부담이 direct route보다 커짐
- credential refresh, account pinning 또는 취소 전파가 P0 계약을 반복 위반

대안 우선순위:

1. **공식 `openai/codex` transport 직접 이식**: cache key와 Responses 계약의 정본에 가장 가깝지만 OAuth refresh, SSE/WebSocket, tool/event 변환을 우리가 유지해야 한다.
2. **`dvcrn/codex-oauth-proxy` sidecar**: MIT, Responses endpoint와 `prompt_cache_key` 보존/생성을 구현한 작은 Codex 전용 후보. 프로젝트 규모와 최신 모델 ID 호환성은 canary로 검증해야 한다.
3. **`router-for-me/CLIProxyAPI`**: MIT, 매우 활발하고 Codex 지원이 넓지만 OpenCodex를 또 다른 대형 범용 proxy로 교체하는 선택이라 단순화 효과가 작다.

`zendext/codex-oauth-proxy`는 session affinity와 usage를 명시하지만 신규·저사용 프로젝트이며 README가 AI 작성임을 경고하므로 우선순위가 낮다.

## 인증 경계

- xAI OAuth credential: 기본 `~/.senpi/agent/auth.json`; bridge는 refresh 시 원자적으로 갱신하고 로그에 토큰을 남기지 않는다.
- Claude setup-token: macOS Keychain의 `Claude Code-setup-token-${FX_CLAUDE_ACCOUNT:-sub}`.
- Claude identity: `CLAUDE_CODE_PATH` 또는 `~/.local/bin/claude` symlink에서 설치 버전을 읽어 `claude-cli/<version>` User-Agent를 맞춘다.
- Codex/Cursor credential: OpenCodex가 소유한다.
- bridge는 loopback에만 bind한다.

## Claude 도구 경계

Anthropic OAuth route는 Claude Code-compatible tool name을 요구한다. bridge는 요청 시 이름만 변환하고 응답 즉시 원래 fx 이름으로 복원한다.

```text
read_file       ↔ Read
write_file      ↔ Write
edit_file       ↔ Edit
terminal        ↔ Bash
grep_files      ↔ Grep
glob_files      ↔ Glob
other_fx_tool   ↔ mcp__fx__other_fx_tool
```

JSON Schema, tool call ID, 실행 승인, 실제 filesystem/shell 작업은 fx가 소유한다.

## 검증 명령

```bash
cd harness
npm ci
npm test --workspace=bridge
./scripts/start.sh
```

live smoke는 격리 임시 디렉터리에서 `harness/fx/zig-out/bin/fx`를 사용한다. PATH의 별도 `fx` 바이너리를 검증 대상으로 쓰지 않는다.

관련 근거:

- `case-studies/2026-08-20-oauth-provider-proxy-evaluation-contract.md`
- `case-studies/provider-routing/xai-direct-provider-probe.md`
- `case-studies/provider-routing/direct-provider-results.md`
- `case-studies/provider-routing/codex-route-alternatives.md`
- `case-studies/2026-08-20-cursor-cache-public-evidence-and-next-steps.md`
