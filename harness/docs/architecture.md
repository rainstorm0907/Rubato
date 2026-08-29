# fx-v3-bridge (삭제됨 — 이력)

> **이 컴포넌트는 2026-08-28 provider 직결 전환(Phase 5A)에서 삭제됐다.** 아래는 그것이
> 무엇이었고 어떻게 동작했는지의 기록이다. 현재 라우팅은
> [`provider-routing.md`](provider-routing.md) 와 [`../README.md`](../README.md) 를 봐라 —
> 여섯 provider 전부 세션 프로세스에서 vendor 를 직접 부르고 `:8788` 은 없다.
>
> 지우지 않고 남기는 이유: 이 구조가 왜 필요했고 무엇이 그것을 불필요하게 만들었는지가
> 다음에 "중계기를 하나 두면 편하지 않나" 라는 질문에 답한다. 판단 근거는
> [`provider-direct-routing-design.md`](provider-direct-routing-design.md) 의 "왜 바꾸는가".

정본 위치는 이 레포의 `harness/`다. fx upstream의 provider 코드는 건드리지 않고 Vercel AI Gateway v3 요청을 provider별 transport로 연결한다.

```text
fx  → 127.0.0.1:8788 fx-v3-bridge
      ├─ xai/*
      │    → @code-yeongyu/senpi-ai xAI transport
      │    → xAI OAuth direct
      ├─ anthropic/*, claude-*
      │    → @code-yeongyu/senpi-ai Anthropic Messages transport
      │    → Claude setup-token
      └─ other models
           → OpenCodex 127.0.0.1:10100 /v1/responses
           → Codex
```

## 소유권 경계

bridge는 모델 선택 규칙과 protocol 변환만 가진다.

- 모델은 tool call을 반환한다.
- fx가 도구를 승인하고 실행한다.
- fx가 tool result를 다음 요청에 넣는다.
- Senpi agent, Claude CLI agent, Grok CLI agent는 실행하지 않는다.
- bridge는 loopback에만 bind한다.
- credits endpoint는 404다. 가짜 잔여량을 만들지 않는다.

## Direct provider 변환

`direct-provider.ts`는 다음을 담당한다.

1. fx system/user/assistant/tool history를 pi-ai Context로 변환
2. fx `tools[]` JSON Schema 보존
3. provider tool call stream을 fx SSE로 변환
4. `cacheRead`/`cacheWrite` usage를 fx measured token usage로 전달
5. fx session header를 provider `sessionId`와 `affinitySessionId`로 전달
6. client abort signal을 upstream stream에 전달

OpenCodex route도 fx session을 버리지 않는다. `x-session-id` 또는 `x-session-affinity`를 OpenCodex가 cache routing에 사용하는 body `prompt_cache_key`와 상관관계에 사용하는 `session-id` header로 함께 전달한다. 응답의 `input_tokens_details.cached_tokens`와 `cache_write_tokens`는 fx usage의 `cacheRead`/`cacheWrite`로 변환한다.

Anthropic route는 Claude Code-compatible identity와 tool name을 요구한다. 설치된 `~/.local/bin/claude` symlink에서 버전을 읽어 `claude-cli/<version>` User-Agent를 사용한다. 알려진 fx 도구는 `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob` 등으로 보내고, 나머지는 `mcp__fx__<name>`으로 보낸다. 응답에서는 즉시 원래 fx 이름으로 복원한다.

## Credential

- xAI: `SENPI_AUTH_PATH` 또는 `~/.senpi/agent/auth.json`의 OAuth credential. refresh update는 임시 파일 후 rename으로 원자적 저장.
- Claude: macOS Keychain service `Claude Code-setup-token-${FX_CLAUDE_ACCOUNT:-sub}`. `security find-generic-password` stdout만 읽고 로그에 출력하지 않음.
- Claude binary: `CLAUDE_CODE_PATH` 또는 `~/.local/bin/claude`.
- Codex: OpenCodex 소유. Cursor 경로는 접혔다 (`case-studies/provider-routing/cursor-route-verdict/`).

## 모델 카탈로그

`GET /coding-agent/v1/models`는 OpenCodex 카탈로그에서 `xai/*`, `anthropic/*`를 제거한 뒤 bridge direct catalog를 추가한다. 같은 모델 이름이라도 provider prefix를 제거하지 않는다.

현재 direct catalog:

- `xai/grok-4.6`
- `anthropic/claude-sonnet-5`
- `anthropic/claude-opus-5`
- `anthropic/claude-haiku-4-5`

## 실행

```bash
cd harness
npm ci
ocx start                         # Codex와 fx models에 필요
./scripts/start.sh
export AI_GATEWAY_API_KEY=[redacted]
export FX_GATEWAY_BASE_URL=http://127.0.0.1:8788
export FX_GATEWAY_CHAT_URL=http://127.0.0.1:8788/v3/ai/language-model
export FX_MODEL=anthropic/claude-opus-5
./fx/zig-out/bin/fx models
./fx/zig-out/bin/fx ask --no-save -- 'Reply with exactly pong.'
```

## 검증 상태

- bridge unit/integration tests: 18 PASS (2026-08-20)
- xAI direct 실제 fx tool loop: PASS
- Anthropic direct 실제 fx tool loop: PASS
- Anthropic 동일 긴 prefix cache write/read: PASS
- xAI provider cache telemetry: 관측
- Codex/OpenCodex 53KB prefix: T1 cold, T2–T6 `cacheRead=13056/13879` (약 94.1%)
- Codex `cached_tokens`의 fx usage 전달: PASS
- Cursor: **fx 안에서는 접힘, 밖에서는 산다.** fx가 부르는 모델로는 못 쓴다 — 보류가 아니라 판정이다 — 도구를 Cursor가 자기가 쥐고 혼자 돈다(제품의 성질), prefix cache가 서버 쪽 이유로 9~99% 진동, 비공식 경로는 벤더가 계정 밴을 걸어 공개 금지. 근거는 `case-studies/provider-routing/cursor-route-verdict/`. OpenCodex `~/.opencodex/config.json`에서도 `providers.cursor`와 `modelPickerOrder`의 `cursor/*`를 제거했으나 **반영은 OpenCodex 재시작 시점**이라 옛 설정으로 도는 프로세스에는 아직 남아 있을 수 있다
- direct provider 6턴/abort/restart/refresh 전체 soak: 미완료

운영 판정과 수치는 `provider-routing.md` 및 `case-studies/provider-routing/direct-provider-results.md`를 따른다.
