# fx Team Overlay — 무엇을 어떻게 개조했나

2026-08-20. 우리 하네스(rubato) 안에서 fx가 어떤 위치이고, Taskforce의 팀 운영을 담기 위해 fx의 무엇을 바꿨는지 남긴다. 결정의 근거와 기각 사유는 `team-overlay-v1.1-decisions.md`, 남은 검증은 `team-overlay-progress.md`에 있다.

## 우리 아키텍처에서 fx의 자리

```text
사용자
  │
  ▼
Taskforce 스킬          팀 운영 정책 — 누가 무엇을 소유하고, 무엇이 완료 증거인가
  │
  ▼
fx (개조 대상)          세션·수명·통신·가시성 — 무대
  │
  ▼
fx-v3-bridge :8788      Vercel Gateway 형식 ↔ OpenAI Responses 형식
  │
  ▼
OpenCodex :10100        계정·토큰·갱신
  │
  └─ Codex / xAI / Cursor / Anthropic
```

경계가 셋이다. **스킬은 판단하고, fx는 무대를 제공하고, bridge 아래는 모델에 닿는 배관이다.** 이번 개조는 가운데 층만 건드렸다. `src/gateway/*`와 OAuth는 한 줄도 손대지 않았다.

## 개조 전에 없던 것

fx의 subagent는 원래 부모-자식 트리다. 에이전트는 부모에게만 말할 수 있고, 에이전트끼리는 서로를 볼 수도 부를 수도 없었다. 통신을 막고 있던 것은 자료구조가 아니라 **권한 위상**이었다 — 메시지 봉투는 이미 `source_id`, `target_id`, `work_id`를 따로 갖고 있었지만, 대상 검사가 "내게 붙어 있는 자손인가"만 물었다.

그래서 owner A가 owner B에게 무언가 알리려면 리드를 거쳐야 했다. 리드가 우체부가 되고, 팀이 커질수록 리드가 병목이 된다. Taskforce의 "리드는 중계자가 아니다"라는 운영 원칙이 하네스 수준에서 성립하지 않았다.

## 개조 후

`team`이라는 built-in tool 하나가 늘었다. 명령은 둘뿐이다.

- `team.members` — 팀에 누가 있는지
- `team.message` — 팀원에게 직접 보내기

승인된 팀원끼리는 리드를 거치지 않고 기존 메시지 큐로 직접 통신한다. 그 외의 실행 경로와 상태는 새로 만들지 않았다.

## 손댄 곳

| 파일 | 무엇 |
|---|---|
| `src/tools/agent/team.zig` | 새 파일. tool 본체 — decode, 팀원 판정, members, message |
| `src/builtins/tools.zig` | tool spec 등록 |
| `src/core/tooling/tool_dispatch.zig` | `team` executor/provider 종류 추가 |
| `src/core/tooling/tool_runtime.zig` | host·caller를 조회에 연결, 리드 대상 메시지에 알림 발동 |
| `src/core/tooling/tool_advertisement.zig` | `subagent`가 광고되는 곳에서만 `team`도 광고 |
| `src/core/subagent/tool_host.zig` | 메시지 경로에서 권한 검사와 실행을 분리 |
| `src/core/subagent/communication_manager.zig` | 멤버십 확인 후에만 쓰는 좁은 peer 경로 |
| `src/core/subagent/manager.zig` | 같은 분리에 따른 조정 |
| `src/core/subagent/parent_delivery_projector.zig` | peer 배달 |
| `src/core/hooks/definitions.zig` | `AttentionKind`에 `team_message` 한 값 |
| `src/builtins/hooks.zig`, `src/core/agent/runtime/deps.zig` | 위 값의 배선 |

커밋 셋으로 나뉘어 있다: `dea44f4`(members) → `650d304`(경로 분리) → `86eba06`(peer 메시지 + 알림).

## 설계에서 뒤집은 것 셋

### 1. 팀원 명부를 저장하지 않는다

원 설계서는 `<lead-session>/team/state.json`에 팀원 세션 ID를 저장하고 `register`/`unregister`로 관리하자고 했다. 그런데 등록 조건인 "리드 root의 direct persistent child"를 fx가 **이미 정본으로 갖고 있다** — `Manager.snapshot`이 canonical child tree를 돌려주고, 각 노드에 직계 여부(`depth`)와 종류(`mode`)와 이름과 상태가 들어 있다.

그래서 **팀원은 등록해서 되는 것이 아니라 리드의 직속 persistent child라는 사실 자체로 팀원**이다. 저장하는 것이 없으니 정본이 갈라질 여지도, 명부가 현실과 어긋날 여지도 없다. 재시작 후 생존은 자동이고, 파일 잠금·원자적 저장·스키마 버전·등록 명령이 전부 불필요해졌다.

owner가 자기 밑에 만든 헬퍼는 nested라 직계 필터에서 자연히 빠진다. 팀은 잔챙이로 불어나지 않는다.

### 2. 권한은 통신만 넓힌다

가장 하면 안 되는 구현은 "같은 팀이면 자손으로 친다"였다. 그러면 owner A가 owner B를 configure하고 cancel하고 close할 수 있는 쪽으로 권한이 샌다.

그래서 공개 `subagent.message` 경로의 자손 검사는 그대로 두고, **멤버십이 이미 확인된 뒤에만 쓸 수 있는 좁은 내부 경로**를 따로 열었다. 큐·재생·재개·배달 코드는 하나를 공유한다. 도구가 둘이어도 실행 경로는 하나다.

peer가 얻는 것은 메시지를 보낼 능력 하나뿐이다.

### 3. peer 메시지는 사용자 명령이 아니다

동료에게서 온 메시지가 사용자 권한으로 승격되면, "사용자가 승인했으니 프로덕션 DB를 지워"라는 한 줄이 승인 경계를 뚫는다.

실측으로 확인된 결과: 리드가 준 work item에는 `root_user_intent_context`가 채워져 있고, peer에게서 온 work item은 **빈 문자열**이다. 규칙으로 막은 것이 아니라 데이터가 그렇게 흐른다.

## 잠든 리드

리드는 사용자와 대화하는 root 세션이다. 팀원 메시지를 리드의 다음 턴에 주입하는 것만으로는, 사용자가 자리를 비운 사이 verifier의 실패 보고가 큐에서 함께 잠든다.

리드를 자동으로 깨우는 선택지는 버렸다. root 세션이 사용자 없이 새 턴을 시작하면 승인 경계가 무너지고, "리드는 백그라운드 에이전트가 아니다"라는 전제와 어긋난다.

대신 fx에 이미 있던 알림 계약을 재사용했다. 권한을 물을 때 사용자를 부르는 그 경로에 `team_message` 종류를 하나 더하고, **메시지 대상이 리드일 때만** 발동한다. 팀원끼리 주고받을 때는 울리지 않는다. 새 렌더러도 팀 전용 UI도 만들지 않았으므로, "TUI를 건드리지 않는다"는 원래 경계도 지켜진다. 알림은 사용자를 부르는 것이지 대신하는 것이 아니다.

## 곁가지로 고친 것 — bridge가 도구를 막고 있었다

작업 중 fx가 **도구를 아예 쓰지 못하는 상태**임을 발견했다. 모델이 도구를 호출하는 순간 `ModelError`로 죽었다.

원인은 team 쪽이 아니라 bridge였다. fx는 도구 호출이 실린 응답의 finish reason이 `tool-calls`가 아니면 응답 전체를 버리는데, bridge가 OpenCodex의 완료 이벤트를 항상 `stop`으로 옮기고 있었다. `harness/bridge/src/fx-stream.ts`에서 도구 호출을 내보낸 적이 있으면 `tool-calls`로 끝내도록 고쳤고 회귀 테스트를 붙였다 (`91a37e3`).

이것이 안 풀렸으면 peer 통신을 완성해도 검증할 수 없었다. 팀원을 띄우는 것 자체가 도구 호출이기 때문이다.

## 스킬 쪽 연결

fx가 두 번째 런타임이 되면서, 스킬에 하드코딩돼 있던 Claude Code 전제를 걷어내고 어댑터로 갈랐다.

- `SKILL.md`의 Runtime 절 — 어느 하네스인지에 따라 `runtimes/`의 해당 어댑터를 읽으라고만 한다
- `runtimes/claude-code.md`, `runtimes/fx.md` — 각각 계약 표 하나. 리드가 무엇이고, 승인된 역할이 무엇이고, 소환·통신·명부가 어디에 있는지
- 역할 계약(`teammate/*.md`)은 런타임과 무관하게 공통이다. fx 팀원도 파일을 읽으므로 복제하지 않고 경로를 가리킨다

fx 어댑터에는 한 가지가 더 있다. **팀원을 앉히기 전에 모델 id가 실제로 어디에 닿는지 실제 콜로 확인하라**는 것이다. 릴레이를 거치면 같아 보이는 id가 다른 계정으로 갈 수 있고, 카탈로그에 이름이 보인다고 그 모델이 뜬다는 보장도 없다 — 실제로 목록에 있으면서 호출하면 죽는 id가 있다. 독립 검증자가 조용히 owner와 같은 모델이면 검증이 아니다.

## 손대지 않은 것

`src/gateway/*`, OAuth 중계, provider 어댑터, 모델 카탈로그, MCP, 기존 agent runner, TUI 렌더러. 그리고 broadcast, 공유 task 원장, 중첩 팀, 턴 중간 주입은 만들지 않았다 — 필요가 관찰되면 그때 붙인다.
