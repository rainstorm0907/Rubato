# Team Overlay v1.1 — 착수 결정

2026-08-20. 설계서 v1(`~/Downloads/fx Agent Taskforce Team Overlay 설계서 v1.md`)과 그에 대한 리뷰(`team-overlay-v1-review.md`)를 받아, 구현 착수 전에 리드가 닫은 결정을 남긴다. 설계서 본문을 대체하지 않는다 — 설계서가 열어둔 자리와 리뷰가 지적한 충돌만 여기서 정한다.

## 결정 1 — 잠든 리드: 기존 알림 계약을 재사용한다

**문제.** 설계서 §11은 Owner→Lead 메시지를 리드의 다음 turn context에 주입하고 실행 중인 턴을 끊지 않는다. 리드는 사용자와 대화하는 root 세션이라, 사용자가 자리를 비우면 다음 턴이 오지 않고 verifier의 FAIL이나 owner의 에스컬레이션이 큐에서 잠든다. 그런데 §22는 TUI renderer를 손대지 말라 하고 §27은 Team TUI를 v2로 미뤘다. "보이게 하라"와 "TUI 건드리지 마라"가 충돌한다.

**해소.** 충돌은 새 UI를 만든다는 전제에서만 생긴다. fx에는 사용자 주의를 부르는 계약이 이미 있다:

- `src/core/notifications/notification_contract.zig:23` — `Kind = { turn_end, attention_required }`, `Notification{ kind, cue }`, `Provider`
- `src/core/hooks/definitions.zig:201` — `AttentionKind = { permission, question, route_recovery }`
- 진입점: `dispatchAttentionRequired(app, turn_id, kind)` (`src/main.zig:718`, 구현 `src/core/app/app_notification_runtime.zig:57`)
- 실제 호출 예: 권한 대기 시 `app.dispatchAttentionRequired(snapshot.active_turn_id, .permission)` (`src/core/app/app_worker_runtime.zig:475`)
- 사용자 설정: `settings.json`의 `notifications.attention_required` (`src/core/config/config_runtime.zig:1432`)
- hooks의 `AttentionRequiredHandler`로 사용자 커스텀 알림도 이미 붙는다

**결정.** `AttentionKind`에 팀 메시지용 값을 하나 추가하고, idle 리드에게 peer 메시지가 배달되는 지점에서 `dispatchAttentionRequired`를 호출한다. 렌더러도, Team 전용 UI도 만들지 않는다. 따라서 §22와 §27을 깨지 않는다.

**하지 않는 것.** 리드 자동 재개는 채택하지 않는다. root 세션이 사용자 없이 스스로 새 턴을 시작하면 승인 경계가 무너지고, 설계서 §11의 "Lead는 background child가 아니다"와 정면으로 어긋난다. 알림은 사용자를 부르는 것이지 사용자를 대신하는 것이 아니다.

**검증.** `tests/e2e/`에 tmux로 TUI를 구동하는 결정론적 테스트가 이미 있고(`tui-subagent-manager.test.ts`, `notifications.test.ts`, tmux 설치 확인됨), `notifications.test.ts`는 `notifications = { turn_end, attention_required }` 설정을 직접 조립해 검증한다. 리뷰가 요구한 "리드 idle 중 도착한 member 메시지가 사용자 개입 없이 가시화되는가"는 이 패턴으로 쓴다.

## 결정 2 — 모델 도착지는 카탈로그가 아니라 실제 콜로 확인한다

리뷰 3번이 실측으로 재현됐다. 현재 카탈로그에 `gpt-5.6-sol`과 `cursor/gpt-5.6-sol`이 서로 다른 항목으로 동시에 존재하고, 전자는 HTTP 400으로 죽고 후자는 응답한다. 이름이 같은데 도착지가 다른 상황이 가정이 아니라 현재 환경의 사실이다.

D단계의 `runtimes/fx.md`에는 "`fx models`에 있으면 쓸 수 있다"가 아니라 **팀원 배치 전에 `FX_MODEL=<id> fx ask`로 한 번 실제 응답을 받아 도착지를 확인한다**로 쓴다. 근거와 실측 표는 `team-overlay-v1-review.md`의 착수일 실측 절에 있다.

## 결정 3 — 구현 순서와 검증 팀원

설계서 §23의 A(membership) → B(message path 분리) → C(peer message) → D(스킬 어댑터) 순서를 유지한다. A/B/C가 `tool_host.zig`·`communication_manager.zig` 같은 같은 파일을 순차로 진화시키므로 owner는 한 명이고 세션을 이어간다. 나누면 충돌만 남는다.

독립 검증은 상시 팀원을 두지 않고 C 완료 시점에 한 번 붙인다. 권한 topology(§12 거부 목록)는 코드 리뷰가 실효적이고, 상시 verifier가 매 단계 볼 증거가 아직 쌓이지 않기 때문이다.

E2E에서 "서로 다른 모델을 가진 owner 둘"은 `xai/grok-4.6`과 `cursor/gemini-3.7-flash`(또는 `cursor/composer-2.5`)로 구성한다. 셋 다 실제 응답 확인됨. 검증은 싼 모델로 돌린다.

## 열린 채로 두는 것

- 설계서 §21이 지목한 수정 지점들의 현재 형태 — upstream이 리뷰 시점보다 앞서 있어 재확인이 필요하다. 조사 결과가 오면 이 문서에 덧붙인다.
- Team state 파일(`<lead-session>/team/state.json`)이 fx의 기존 per-session 상태 패턴(lock, atomic save, schema version)과 어떻게 맞물리는지.

## 결정 4 — Team state 파일을 만들지 않는다 (설계서 §5~§7 재설계)

**설계서 원안.** `<lead-session>/team/state.json`에 팀원 세션 ID 목록을 저장하고, `team.register` / `unregister`로 그 목록을 관리한다. 등록 조건은 "root의 direct child, attached, persistent".

**관찰.** 그 등록 조건을 만족하는 child 집합은 fx가 이미 갖고 있다.

- `src/core/subagent/relationship_index.zig:349` — `page(alloc, sessions, parent_id, options, cursor, limit, scan_limit)`가 부모 ID로 direct child 목록을 페이징 조회한다
- 인덱스는 child 생성·제거 시점에 갱신된다 (`manager.zig:1681`, `1836`, `1949`, `1994`, `2049`, `execution.zig:5497`)
- `parent_id`와 `mode`는 control record에 이미 durable하게 있다 (`domain.zig:191`, `158`, `339`)

즉 "root의 direct persistent children"은 저장하지 않아도 언제든 계산된다.

**결정.** `team/state.json`과 `register`/`unregister`를 만들지 않는다. 팀원은 **root의 direct persistent child라는 사실 그 자체**로 정의한다. `team` tool에는 `members`와 `message` 둘만 남는다.

**왜 이쪽이 나은가.**

- 설계서 §6의 목표(정본을 복제하지 않는다)와 불변식 9를 규율이 아니라 구조로 달성한다. 저장할 상태가 없으면 드리프트할 상태도 없다. 이 레포가 반복해서 겪은 "정본 선언해놓고 요약본이 갈라지는" 실패의 재발 여지가 아예 사라진다.
- membership이 stale해질 수 없다. 등록 후 세션이 죽거나 archived되면 원안에서는 state.json이 거짓말을 하지만, 매번 계산하면 그 순간의 사실이다. §24의 "archived/stale member는 안전하게 실패한다"가 자명해진다.
- restart 후 membership 생존(§24 Recovery)이 자동이다. control_store가 이미 durable하다.
- 승인된 팀원을 새 세션으로 복구한 뒤 unregister/register하는 절차가 사라진다. 새 child를 만들면 그게 곧 팀원이다.
- 파일 lock, atomic save, schema version, 세션 capability, 스키마 검증이 전부 불필요해진다. 설계서 §20의 신규 모듈 셋 중 `store.zig`가 통째로 사라지고 `domain.zig`도 거의 남지 않는다.
- 설계서 §3("Overlay는 판단하지 않는다")과 불변식 10에 더 충실하다. `register`는 "이 자식은 팀이다"라는 판단을 Overlay 안에 기록하는 절차인데, 그 판단은 스킬과 리드의 것이다. 리드가 direct persistent child를 만드는 행위 자체가 이미 팀원 생성이다.

**남는 반론과 처리.** 리드가 팀과 무관한 장기 작업을 direct persistent child로 돌리면 그것도 자동으로 팀원이 된다. 셋 다 완화된다 — (a) fx에서 persistent direct child는 사실상 "장기 대화 상대"라 팀원과 동의어다, (b) peer가 얻는 권한은 message뿐이고 configure·cancel·close는 여전히 막힌다(§12), (c) 메시지를 받아도 수신자의 승인된 brief와 boundary가 peer 메시지보다 우선한다(§13). 실제로 문제가 관찰되면 그때 opt-out 하나를 추가한다 — 설계서 §27이 shared task ledger에 적용한 것과 같은 원칙이다.

**Owner-local helper는 원안과 결과가 같다.** helper는 owner의 child, 즉 root의 nested child라 direct 필터에서 자연히 빠진다(§19). 리드 자신이 팀 밖 헬퍼가 필요하면 one-off로 만들면 persistent 필터에서 빠진다.

**바뀌는 테스트.** §24 Membership 항목이 "등록되는가"에서 "팀원으로 보이는가"로 바뀐다. `duplicate register가 안전하다`는 소멸하고, `restart 후 membership 유지`와 `archived/stale member는 안전하게 실패한다`는 별도 구현 없이 통과해야 한다. Isolation과 Messaging 항목은 그대로 남는다 — authorization은 여전히 매 메시지마다 필요하고, 원안이 register 시점에 한 번 하던 검사를 매번 하게 될 뿐이다.

**조회 수단도 이미 있다 (확인 완료).** `relationship_index`는 projection이고 정본은 control record다 — `removeChild` 호출처(`manager.zig:1994`, `2049`)가 전부 stale projection 정리다. 그래서 인덱스를 직접 읽을 게 아니라 그 위의 정본 조회를 쓴다:

- `Manager.snapshot(alloc, TreeQuery{ .root_id, .cursor, .anchor_id, .limit })` (`manager.zig:470`) — 주석 그대로 "allocator-owned, bounded page of the **canonical** child tree"
- 반환되는 `TreeNode`(`manager.zig:297`)에 `child_id, parent_id, name, mode, state, generation, depth, relationship_issue`가 전부 들어 있다

즉 팀원 판정에 필요한 필터가 이미 노드에 있다 — `depth == 0`이 direct, `mode == .persistent`가 persistent, `state`가 실행 상태, `name`이 이름 resolve용이다. (직계가 `depth == 0`이라는 것은 구현 중 코드로 확인해 테스트로 고정했다. 리드가 처음 이 문서에 적은 `depth == 1`이 틀렸다.) `team.members`는 이 스냅샷을 걸러 내보내는 것으로 끝나고, `team.message`의 authorization도 같은 필터로 source와 target을 확인한다. 조회 코드를 새로 짜지 않는다.

UI 계층인 `ui_projection.Snapshot`(`ui_projection.zig:145`)도 같은 정보에 모델 configuration과 unread까지 얹어 갖고 있지만, 그쪽은 `consumer_id = "subagent-manager-ui"`로 unread 커서를 움직이는 소비자라 tool이 쓰면 UI 상태에 부작용이 난다. `Manager.snapshot`을 쓴다.

**결과적으로 설계서 §20의 신규 모듈이 거의 남지 않는다.** `store.zig`는 저장할 상태가 없어 사라지고, `domain.zig`는 command 타입 정도만 남고, `manager.zig`(team용)는 "스냅샷을 필터링해 peer 여부를 판정하는" 얇은 함수 몇 개가 된다. 실제로 남는 새 코드는 `src/tools/agent/team.zig`와 canonical dispatch를 부르는 authorization 경로다.

**검증 완료 (2026-08-20, 커밋 dea44f4).** 실제 바이너리로 확인했다. 대화형 fx 세션에서 persistent child를 하나 만들자 `team.members`가 즉시 `{"id","name","state"}`로 그를 보여줬고, 저장된 상태는 하나도 없다. Zig 테스트는 persistent 2 + one-off 1 + nested 1 + closed 1 트리에서 리드와 팀원이 같은 roster를 보고 nested·one-off는 팀원이 아니며 archived child는 목록에 남되 `state`가 `archived`임을 고정한다.

`team`은 `subagent`와 같은 조건으로 광고된다 — subagent host가 없으면 둘 다 안 뜬다. 그래서 `fx ask`(단발 비대화형)에서는 확인할 수 없고 대화형 세션이 필요하다. 응답에 model을 넣지 않았다: `TreeNode`에 model이 없고, 그걸 위해 조회를 하나 더 만들 이유가 없었다.
