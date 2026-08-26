# Provider routing and verification status

기준일: 2026-08-20

이 문서는 rubato harness에서 모델별 실제 전송 경로와 검증 범위를 구분한다. 모델이 목록에 보이거나 단일 응답을 반환하는 것만으로 `stable` 또는 `cache verified`라고 부르지 않는다.

## 현재 라우팅

```text
fx
  → 127.0.0.1:8788 fx-v3-bridge
       ├─ xai/*       → senpi-ai xAI transport → api.x.ai
       ├─ anthropic/* → senpi-ai Anthropic Messages transport → Anthropic
       ├─ kiro/*      → Anthropic Messages transport → kiro.rs 127.0.0.1:8990 → AWS Kiro
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
| Kiro | `kiro/claude-opus-5`, `kiro/gpt-5.6-sol` | kiro.rs 사이드카 + Anthropic Messages | 텍스트·이미지·tool loop·3턴 멀티턴 PASS | 캐시 없음(상류가 필드를 안 준다) | canary |

Grok과 Claude도 평가 계약의 `주력 채택` 조건을 전부 통과한 것은 아니다. 현재 live evidence는 실제 fx tool loop와 cache telemetry까지다. 6턴·2 tool call·abort·bridge 재시작·OAuth refresh를 모두 묶은 soak가 남아 있어 판정은 `canary`다.

Codex는 OpenCodex 경로를 유지한다. 최초 측정에서 캐시가 간헐적으로만 적중했지만 원인은 bridge가 fx session을 버린 것이었다. bridge가 같은 fx session을 OpenCodex body의 `prompt_cache_key`와 `session-id` header에 전달하도록 고친 뒤, 고유 SALT가 붙은 53,052-byte prefix에서 T1 cold, T2–T6 `cacheRead=13,056 / input=13,879`가 연속 관측됐다. 후속 hit rate는 약 94.1%로 평가 계약의 85% 기준을 넘는다. cache usage도 이제 fx finish event에 보인다.

Cursor는 기본 경로로 배치하지 않는다. 공식 Cursor CLI의 resume/cache 기준선은 있지만 OpenCodex Cursor route가 같은 수준으로 prefix cache를 보존한다는 증거가 없으며 이전 멀티턴 측정에서 정상 판정을 받지 못했다.

공개 조사에서도 CLIProxyAPI + `cliproxy-cursor-plugin`과 `oh-my-pi`에는 Cursor prefix-cache hit 수치가 없었다. 현재 가장 가까운 증거는 `senpi` native Cursor transport의 2턴 probe(T1 `cacheWrite=21354`, T2 `cacheRead=17575`)다. 이것도 n=2이고 OpenAI-compatible proxy가 아니므로 바로 채택하지 않는다. 다음 세션에는 cache usage가 없는 경로를 `0`이 아니라 `unavailable`로 기록하는 공통 계측부터 추가하고, 공식 Cursor CLI·현재 OpenCodex·senpi native 후보를 같은 53KB/6턴 fixture로 비교한다. 상세 근거와 필드는 `case-studies/2026-08-20-cursor-cache-public-evidence-and-next-steps.md`에 있다.

## Kiro

`kiro/*`는 `zyphrzero/kiro-rs` 컨테이너를 loopback 사이드카로 띄우고 그 앞에
Anthropic Messages transport를 그대로 붙인다. 새 transport를 짜지 않는다 — kiro.rs가
이미 Anthropic 호환 프록시다. kiro.rs 소스는 레포에 넣지 않는다(52k줄 Rust,
업스트림이 활발하다). 자격증명은 `~/.rubato-pi/kiro`에만 둔다.

키는 환경변수로 받지 않는다. 브리지가 `~/.rubato-pi/kiro/config.json`을 직접 읽는다 —
셔하금마다 export 해야 하면 “내 기기에서만 도는 고침”이 된다. `KIRO_API_KEY` /
`KIRO_BASE_URL`이 있으면 그쪽이 이긴다.

### 설정 경로 셋

```
kiro-setup.sh                  # 이 기기의 Kiro IDE 토큰으로 붙는다
kiro-setup.sh export [파일]    # 자격증명을 뽑는다(남에게 줄 때)
kiro-setup.sh import <파일>    # 받은 파일로 붙는다 — 로그인 불필요
kiro-setup.sh ensure           # Docker와 사이드카를 현재 설정에서 복원한다
```

설정·이식 세 경로는 모두 같은 정규화를 탄다(`normalize_credential`). 그래야 받는 기기에서
`endpoint`나 `profileArn`이 빠져 아래 표의 실패로 떨어지지 않는다. `import`는
Kiro IDE 도 `kiro-cli` 도 요구하지 않는다 — 빈 기기에서 파일 하나로 모델 19개와
두 모델의 실응답까지 확인했다.

로그인 supervisor와 `rubato` 기동은 자격 파일이 있는 기기에서 `ensure`를 자동
호출한다. supervisor는 브리지 기동을 늦추지 않도록 백그라운드에서 복원한다. Docker의
`restart=unless-stopped`는 데몬이 먼저 떠야만 작동하므로, macOS에서는 현재 Docker
context에 맞춰 OrbStack 또는 Docker Desktop을 깨운 뒤 기존 `kiro-rs`를 시작한다.
Linux Docker Desktop은 user unit을 깨우고, 시스템 Docker는 OS supervisor에 맡긴다.
컨테이너가 사라졌으면 같은 `config.json`과 `credentials.json`으로 다시 만들며,
어느 경로든 인증한 `/v1/models` 응답이 돌아와야 복원이 끝난다. Kiro를 설정하지 않은
기기에서는 Docker를 찾거나 띄우지 않는다.

자격증명 파일은 그 자체가 계정 접근권이다(refreshToken). 넘기면 회수 수단이
비밀번호 변경뿐이고, 크레딧도 공유된다.

공유 자체는 위험 신호가 아니다. `machineId` 는 export 에 실리지 않아 받는 기기가
자기 것을 생성하고(`kiro/machine_id.rs`, 상류로 나가는 식별자다), 같은 망이면
공인 IP 도 같다 — AWS 입장에선 한 사람이 기기 둘을 쓰는 모양이다. Kiro 는 IDE 와
CLI 병행을 전제하므로 이 정도는 정상 범위다.

`429 suspicious activity` 와 계정 단위 쿨다운(kiro.rs 기본 1800초)은 장소가 멀리 떨어진
접속이 겹칠 때가 가깝다. 같은 집에서 돌리는 경우라면 실질 제약은 크레딧 공유다.

브리지 경유로 `kiro/claude-opus-5`(`in=6790 out=7`)와 `kiro/gpt-5.6-sol`(`in=1596
out=11`)이 fx SSE 로 정상 종료했고, 64x64 빨간 PNG 에 둘 다 "Red" 를 돌려줘
모달리티 배선도 확인했다.

**tool loop 은 3턴으로 완주했다**: 도구 호출(`get_weather({city:"Seoul"})`) → 결과
주입(`17C, light rain`) → 모델이 그 값을 반영한 답 → 다음 턴에서 앞 맥락을
호출("17"). 두 모델 모두 PASS. 그래서 판정을 `실험`에서 `canary` 로 올렸다.
thinking effort, abort, bridge 재시작을 묶은 soak 는 아직이라 Grok·Claude 와 같은
`canary` 단계다.

tool loop 을 넘기기 전에 **도구 이름 비대칭 버그**가 있었다. `read_file` 을 보냈는데
`Read` 가 돌아왔다 — kiro 를 anthropic 규칙으로 보내면 `fxToolToClaude` 로 바뀜서
나가지만, 역변환 `claudeToolToFx` 는 `provider === "anthropic"` 에만 걸려 있어
돌아오지 않는다. fx 가 `Read` 를 못 찾으니 loop 이 그자리서 끊긴다.

Claude Code 이름 규칙은 Anthropic 직결 전용이다. kiro 는 메시지 모양만 Anthropic 이고
상대는 AWS 라 바꿀 이유가 없다. 그래서 api 축(`anthropic-messages`)과 이름 축
(`ToolNaming`)을 분리했다. `direct-provider.test.ts` 의
"kiro keeps fx tool names..." 가 이 비대칭을 지킨다.

이미지를 시험할 때는 **진짜 사진 크기를 쓴다**. 1x1·8x8 같은 생성 PNG 는 상류가
`IMAGE_FORMAT_UNSUPPORTED` 로 거부해서, 배선이 멀지만 안 보이는 것처럼 오독하기 쉽다.
kiro.rs 로그의 `image_count=1` 이 이미지 도달 여부를 가른다.

캐시 열은 비워 두지 않고 "없음"으로 적는다. kiro.rs 주석이 실측을 밝힌다 — Kiro 상류
`meteringEvent`는 credit 계량만 주고 `cache_creation` / `cache_read` 필드를 내려주지
않는다(`src/anthropic/cache_metering.rs`). kiro.rs가 보고하는 캐시 수치는 중계층
시뮬레이션이다. 다만 Kiro는 토큰이 아니라 credit 과금이라(관측: opus-5 `0.028`,
sol `0.015` credit) 캐시 부재가 비용 손해로 이어지지 않는다. `broker.mjs`는
`provider === "anthropic"`일 때만 `cacheRetention`을 붙이므로 `kiro`는 자동으로 빠진다.

자격증명에서 두 값을 반드시 같이 줘야 한다. 하나만으로는 전부 실패한다.

| endpoint | profileArn | 결과 |
|---|---|---|
| `ide` | 없음 | 400 `INVALID_MODEL_ID` |
| `cli` | 없음 | 400 `profileArn is required` |
| `cli` | 있음 | 400 `profileArn is required` (origin이 `KIRO_CLI`로 나간다) |
| **`ide`** | **있음** | **성공** |

IdC(Builder ID)는 여기에 `clientId`가 더 붙어야 한다. IDE 토큰(`~/.aws/sso/cache/kiro-auth-token.json`)은 `clientIdHash`만 남기고, 값은 같은 디렉터리의 `<hash>.json`에 있다. 이 둘이 빠지면 첫 시간은 `accessToken`으로 통하고, 만료 뒤 kiro.rs가 `IdC 刷新需要 clientId`로 3번 실패한 다음 자격을 끈다. 브리지는 그걸 `502 Upstream API request failed`로 포장한다. `kiro-setup.sh`가 해시 파일을 읽어 같이 싣고, 이미 떠 있는 자격은 `rubato` 기동의 `heal`이 제자리에서 채운다. 갱신된 `refreshToken`은 덮지 않는다.

Builder ID 계정은 `ListAvailableProfiles`가 403(`AWS Builder ID is not supported for this
operation`)이라 kiro.rs가 ARN을 스스로 못 구한다. Kiro IDE가 실제로 200을 받는 값을
그대로 쓴다. 계정 등급도 갈린다 — 무료(`KIRO FREE`)는 모델 9개뿐이고 `claude-opus-5`와
`gpt-5.6-sol`이 아예 없다. 목록은 AWS `ListAvailableModels` 응답이라 설정으로 못 뚫는다.

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
