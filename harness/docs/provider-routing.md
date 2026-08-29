# Provider routing and verification status

기준일: 2026-08-28 (provider 직결 전환 뒤)

이 문서는 rubato harness에서 모델별 실제 전송 경로와 검증 범위를 구분한다. 모델이 목록에
보이거나 단일 응답을 반환하는 것만으로 `stable` 또는 `cache verified`라고 부르지 않는다.

## 현재 라우팅

`127.0.0.1:8788` FX bridge와 OpenCodex `127.0.0.1:10100` 은 **제거됐다**. 여섯 provider 전부
Senpi 프로세스 안의 `pi-ai` provider가 vendor를 직접 호출한다.

```text
Rubato/Senpi (in-process)
  ├─ openai-codex/*      → chatgpt.com/backend-api
  ├─ xai/*               → api.x.ai
  ├─ anthropic/*         → api.anthropic.com
  ├─ cursor/*            → api2.cursor.sh (HTTP/2 필수, proxy fallback 없음)
  ├─ kiro/*              → kiro.rs 127.0.0.1:8990 → AWS Kiro
  └─ google-antigravity/* → daily-cloudcode-pa.googleapis.com
```

남은 로컬 의존은 Kiro 사이드카 `:8990` 하나뿐이다. 그 ensure 는 Kiro 첫 호출 직전에만
돌므로, Codex 나 xAI 로 여는 세션이 Docker 를 깨우지 않는다.

Senpi agent나 provider CLI가 도구를 실행하지 않는다. transport는 tool call만 반환하며 실행과
승인, tool result 전달은 하네스가 소유한다.

## 상태표

| 프로바이더 | 모델 예 | 경로 | 실 vendor 검증 | 현재 판정 |
|---|---|---|---|---|
| Grok | `xai/grok-4.6` | 직결, xAI OAuth | `xhigh` 가 wire 에 실림 PASS | 통과 |
| Claude | `anthropic/claude-*` | 직결, setup-token(파일 → Keychain) | OAuth 신원·tool 이름 PASS, Keychain fallback PASS | 통과 |
| Kiro | `kiro/claude-opus-5`, `kiro/gpt-5.6-sol` | 직결, 사이드차 + Anthropic Messages | 3턴 tool loop + 이미지 PASS | 통과 |
| Codex | `gpt-5.6-*`, Daybreak | 직결, ChatGPT 구독 OAuth | signed reasoning 3턴·재시작 PASS(자격증명 만료 전) | 자격증명 갱신 필요 |
| Antigravity | `gemini-3.7-flash`, `gemini-3.1-pro` | 직결, Google OAuth | 3턴 이어짐 실패 — 진단 중 | 미통과 |
| Cursor | `cursor/*` | 직결 native Connect-RPC | 미실행(로그인 필요) | 미검증 |

`gpt-5.6-sol` 과 `claude-opus-5` 의 272K/1M 상한은 picker 표시용이고 truncation·usage 역산에
쓰지 않는다. 사이드카가 usage 를 퍼센트로 주지 않아 그 상한을 상류에서 확인할 길이 없다.

실 검증 러너는 `harness/rubato-pi/test/smoke/direct-real.mjs` 다. 격리 프로필에서 돌고 실
프로필 `auth.json` 을 건드리지 않는다. 그 러너에서 SKIP 은 자격증명을 못 쓴다는 뜻이고 FAIL 은
쓸 수 있는 자격증명으로 gate 가 깨졌다는 뜻이다 — 둘을 섞지 않는다.

## 이력: bridge·OpenCodex 시절의 측정

아래는 전환 **전** 기록이다. 경로가 사라졌으므로 현재 상태가 아니지만, 그때 무엇을 재서
무엇을 근거로 판단했는지는 남긴다.

Codex 는 OpenCodex 경로를 유지하다가 직결로 옮겼다. 캐시가 간헐적으로만 적중한 원인은
bridge 가 fx session 을 버린 것이었고, 같은 session 을 `prompt_cache_key` 와 `session-id`
header 로 전달하게 고친 뒤 53,052-byte prefix 에서 T1 cold, T2–T6
`cacheRead=13,056 / input=13,879` 가 연속 관측됐다(후속 hit rate 약 94.1%).

Cursor 는 OpenCodex Cursor route 가 prefix cache 를 보존한다는 증거가 없어 기본 경로로 두지
않았다. 당시 가장 가까운 증거가 `senpi` native transport 의 2턴 probe
(T1 `cacheWrite=21354`, T2 `cacheRead=17575`)였고, 지금은 그 native 경로가 유일한 Cursor
경로다. 상세는 `case-studies/2026-08-20-cursor-cache-public-evidence-and-next-steps.md`.

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

`rubato` 기동은 자격 파일만 `heal`하고 Docker 는 띄우지 않는다. 사이드카 복원은
실제 `kiro/*` 요청이 처음 들어온 provider 경계가 맡는다. Docker의
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

## 이력: OpenCodex 유지 판단과 그 종결

전환 전에는 Codex cache 가 계약을 통과했으므로 OpenCodex 를 두고, 아래가 재현되면 별도
transport 로 분리하기로 했다: 같은 `prompt_cache_key` 에서 T3–T6 중앙 hit rate 85% 미만,
upstream Codex protocol drift 반복, 넓은 provider surface 로 인한 운영 부담, credential
refresh·account pinning·취소 전파의 P0 위반.

**그 판단은 종결됐다.** 분리 사유가 재현된 것이 아니라, 직결 전환이 그 선택 자체를
없앴다 — Codex 는 pinned `openaiCodexProvider()` 로 vendor 를 직접 부르고 중계기가 없다.
당시 검토했던 대안(공식 `openai/codex` transport 이식, `dvcrn/codex-oauth-proxy`,
`router-for-me/CLIProxyAPI`)도 같은 이유로 더 쓰지 않는다. 남기는 이유는 하나다: 다음에
"중계기를 하나 두면 편하지 않나" 라는 질문이 올 때, 그 길을 이미 걸었고 무엇을 대가로
치렀는지 보이도록.

## 인증 경계

권위 저장소는 브랜드 profile 의 `~/.rubato-pi/agent/auth.json` 이다. provider 마다 refresh
writer 는 하나이고, Senpi `AuthStorage` 가 `proper-lockfile` 과 원자적 쓰기로 직렬화한다.

- Codex·xAI·Cursor·Antigravity OAuth: profile `auth.json`. `/login` 이 채운다.
- Claude setup-token: `~/.claude/auth/setup-token-<계정>` → 없으면 Keychain
  `Claude Code-setup-token-<계정>`. 갱신 대상이 아니라 기존 저장소를 그대로 쓴다.
  계정 이름은 `RUBATO_CLAUDE_ACCOUNT` 이고, 예전 `FX_CLAUDE_ACCOUNT` 는 정식 이름이 없을 때만
  읽으며 한 번 알린다.
- Claude identity: pinned OAuth 경로가 `sk-ant-oat` 접두를 보고 고정 `claude-cli/<version>`
  user-agent 와 Claude Code beta, cache retention 을 적용한다.
- Kiro sidecar key: `~/.rubato-pi/kiro/config.json`(`kiro-setup.sh` 가 쓴다). 갱신 대상이 아니다.
- Antigravity 는 Keychain 을 일회성 import 입력으로만 읽고, 이관은 **부모 세션만** 한다 —
  격리 자식마다 Keychain 을 읽고 `loadCodeAssist` 를 부르면 시작 부작용이 자식 수만큼 곱해진다.
- 토큰을 파일 사이로 복사하지 않는다. 같은 refresh token 을 두 저장소가 들면 먼저 갱신한 쪽이
  다른 쪽을 무효로 만든다.

## 직결 경로의 env 계약

`RUBATO_PROVIDER_DIRECT=1` 로 켜는 in-process 직결 경로가 읽는 이름이다. 위 "인증 경계" 는
bridge 경로(기본값)를 설명하고, 이 절은 직결 경로만 설명한다. 두 경로는 같은 기기에서
공존하므로 이름을 섞지 않는다.

| 이름 | 기본값 | 용도 |
|---|---|---|
| `RUBATO_CLAUDE_ACCOUNT` | `sub` | setup-token 계정. 파일 이름과 Keychain service 이름에 함께 쓴다 |
| `RUBATO_CLAUDE_SETUP_TOKEN_FILE` | `~/.claude/auth/setup-token-<계정>` | setup-token 파일 경로 |
| `KIRO_API_KEY` | 없음 | 사이드카 key. config 파일보다 **먼저** 쓴다 |
| `KIRO_CONFIG_PATH` | `~/.rubato-pi/kiro/config.json` | `kiro-setup.sh` 가 쓴 config |
| `KIRO_BASE_URL` | `http://127.0.0.1:8990` | 사이드카 주소. **loopback 만** 받고, 아니면 기본값으로 되돌린다 |

Anthropic 자격증명 우선순위는 pinned provider 가 소유한다: 저장된 자격증명 → `ANTHROPIC_AUTH_TOKEN`
→ `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → setup-token(파일 → Keychain). setup-token 은
**마지막 출처**이고 `sk-ant-oat` 접두를 확인한 값만 쓴다 — 그 접두가 pinned 층의 Claude CLI
신원·beta·cache 동작을 켠다. 어느 경로도 token 을 복사하거나 다시 쓰지 않는다.

직결 경로에는 bridge 의 `read_file ↔ Read` 변환이 없다. pinned OAuth 경로가 canonical
대소문자 교정을 이미 적용하므로 그것을 남기면 이중 변환이다. Kiro 는 사이드카 key 가
`sk-ant-oat` 가 아니어서 그 교정 자체가 걸리지 않는다.

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
