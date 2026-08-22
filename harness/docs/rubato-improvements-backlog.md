# rubato 개선 백로그 — rewind / 프롬프트 캐시 순서 / 리드 깨우기

2026-08-21. 세션 중 발견한 세 가지 개선 후보를 휘발시키지 않으려고 남긴다. 셋 다 상태가 다르다 — rewind는 안전성 설계가 닫혔고, 캐시 순서는 조사 중 전제가 뒤집혔고, 깨우기는 아직 설계가 없다. 이 문서는 착수 결정이 아니라 조사 결과 보존이 목적이다.

인용한 줄 번호는 2026-08-21 기준 `harness/fx` 체크아웃(로컬 fork)에서 직접 확인했다. upstream이 움직이면 재확인이 필요하다.

## 배경 — 왜 세 개가 같이 올라왔나

셋 다 이 세션에서 실제로 겪은 불편에서 나왔다.

- rewind: 이전 턴으로 돌아가 메시지를 다시 보내는 기능이 fx에 없다. 사용자 판단으로 "없으면 안 되는" 기능.
- 캐시 순서: 매 턴 바뀌는 오버레이가 대화 기록 앞에 있어서 기록 전체가 캐시 대상에서 빠진다.
- 깨우기: 서브에이전트 결과를 기다리다 60초 wait을 세 번 돌렸다. 결과는 못 받고 빈 응답 세 개만 히스토리에 쌓였다.

단, 세 번째 불편의 원인은 깨우기 부재가 아니라 wait 사용 실수였다. 한 번 크게 걸었으면 그 자리에서 받았다. 실제로 같은 세션에서 깨우기 없이 결과를 정상 수령했다. 이 구분은 아래 3절에서 다시 다룬다.

---

## 1. rewind — 안전성 설계 확정됨

fx 0.0.4에 rewind는 존재하지 않는다. 아래는 `xai/grok-4.6` 팀원(`rewind-design`)에게 읽기 전용으로 조사시킨 결과이며, 인용된 코드 위치 네 곳은 리드가 직접 재확인했다.

### 1-1. 되감기 단위 — canonical HistoryTurn 슬롯

`HistoryTurn`은 4칸 union이고 그중 하나가 요약 턴이다.

```
harness/fx/src/core/shared/types.zig:1448
pub const CompactedSummaryHistoryTurn = struct {
    summary: []u8,
    removed_turn_count: usize,
    compaction_count: usize,
    root_user_messages: [][]u8 = &.{},   // legacy 호환용, 원본 아카이브 아님
    ...
};
pub const HistoryTurn = union(enum) {
    compacted_summary: CompactedSummaryHistoryTurn,
    assistant: AssistantHistoryTurn,
    background_command: BackgroundCommandHistoryTurn,
    interrupted: InterruptedHistoryTurn,
};
```

요약 슬롯은 텍스트와 카운트만 들고 있고 원본 턴을 중첩 저장하지 않는다. 따라서 요약 슬롯 하나는 **원자 단위**다. 통째로 남기거나 통째로 버리는 것만 가능하다.

**중요한 발견 — 라이브 compact는 canonical을 지우지 않는다.**

```
harness/fx/src/core/session/session.zig:1977
pub fn forceCompaction(self: *SessionRuntime) void {
    if (self.history.items.len <= 1) return;
    self.context_history_start = self.history.items.len - 1;
}
```

`forceCompaction`은 `context_history_start` 인덱스만 옮긴다. 실제로 턴을 접는 `compactHistory`는 `snapshotOwnedContextHistory`가 만든 **복사본**에만 작용한다 (`session.zig:2001` 주석: "canonical history is not truncated").

즉 세션 중 `/compact`가 몇 번 났든 원본 턴은 `SessionRuntime.history` 배열에 살아 있다. 그 구간은 자유롭게 되감을 수 있다.

**확정.** 컷 인덱스는 canonical `SessionRuntime.history` 기준. 자른 뒤 `context_history_start`를 새 길이로 clamp하면 파생물은 다음 턴에 재생성된다.

**남는 위험.** canonical `[0]`이 이미 `compacted_summary`인 세션(resume된 세션)은 요약 이전 원본이 디스크에도 없다. 그 지점보다 앞으로는 되감을 수 없다.

**미확인.** 라이브 `/compact` 외에 프로덕션이 canonical에 `compacted_summary`를 append하는 경로가 더 있는지는 안 닫혔다. `appendHistoryEntry`는 넘어온 턴을 그대로 넣으므로, 그런 턴이 오면 원자 슬롯으로 취급하면 된다.

### 1-2. 진행 중 턴과 큐 — 기존 cancel을 그대로 쓰면 안 된다

`QueuedPrompt`는 자체 `history` 슬라이스를 들고 있다 (`worker_runtime.zig:57`). 워커가 참조하는 건 canonical 포인터가 아니라 스냅샷이다.

문제는 `requestCancel`이 플래그만 세우고 큐를 비우지 않는데, 다음 잡을 꺼낼 때 그 플래그를 리셋한다는 점이다.

```
harness/fx/src/core/agent/worker_runtime.zig:1030
var job = self.queued_prompts.orderedRemove(0);
...
self.worker_cancel_requested.store(false, .seq_cst);
...
self.worker_processing = true;
```

cancel만 하고 큐를 두면, 큐에 남은 잡이 **잘린 히스토리를 기준으로 다시 실행된다.**

재사용 가능한 기존 순서는 라이브 세션 전환 경로에 있다 (`app_session_runtime.zig:1521` `prepareLiveSessionTransition`, `:1531` `beginLiveSessionCancellation`).

**확정 순서.**

1. `requestCancel`
2. `clearQueuedPrompts` (큐 리뷰도 reset)
3. `waitUntilIdle`
4. canonical truncate — in-flight가 남긴 `.interrupted` 턴이 컷 범위에 들면 같이 버린다
5. persist (`commitStateReplacement`)

**남는 위험.** `requestCancel`과 `clearQueuedPrompts` 사이에 워커가 다음 잡을 집어가면 그 잡은 clear 대상이 아니다. 세션 전환도 같은 창이 있다. idle 뒤에 `isProcessing() == false && queuedPromptCount() == 0`을 한 번 더 확인해야 한다.

보통의 cancel은 `persistInterruptedTurnOnce`로 `.interrupted` 턴을 canonical에 **추가**한다. rewind 의미와 다르므로 cancel 경로의 히스토리 부수효과는 재사용하지 말고 idle 뒤 truncate로 덮는다.

### 1-3. 커밋 실패 — 메모리를 먼저 자르면 안 된다

이게 가장 값진 발견이다.

```
harness/fx/src/core/session/session_log.zig:808
fn abortCommitLifecycle(self: *LoadedWritableSession) void {
    if (self.commit_lifecycle) |*lifecycle| lifecycle.abort();
}
```

`abort`는 latest-cache 락만 풀 뿐 `SessionRuntime.history`를 되돌리지 않는다.

그런데 fx의 기존 패턴은 대부분 "메모리 먼저, 디스크 나중"이다 — `appendHistoryEntry` 후 `appendEvent` (`app_session_runtime.zig:2672`), `forceCompaction` 후 `commitCurrentStateReplacement` (`:2783`). 이 패턴을 rewind에 그대로 복사하면 **디스크는 옛 히스토리, 메모리는 잘린 상태**가 되고, 재시작하거나 resume하면 되감기가 조용히 사라진 것처럼 보인다.

**확정.** rewind는 `SessionRuntime.history`를 제자리에서 자르지 않는다. 잘린 스냅샷을 만들어 `commitStateReplacement`를 먼저 하고, **성공한 뒤에만** 메모리를 그 스냅샷으로 교체한다. 실패하면 메모리와 디스크 모두 옛 canonical을 유지한다. degraded 커밋을 성공으로 취급하지 않는다.

**남는 위험.** `commitStateReplacementImpl` 성공 후 `maintainCanonicalLogAfterCommit`이 실패하면 abort를 타지 않고 `state_replacement_pending`만 켠다. 이때 `loaded.state`는 이미 새 값일 수 있다. rewind는 이 에러도 실패로 취급해야 한다.

ACP `persistAcpHistoryTurn`도 append 우선이라 같은 split이 있다 (`acp/prompt.zig:1606`).

**미확인.** `loaded.state`와 `SessionRuntime.history`를 한 트랜잭션으로 묶는 API는 없다. 현재 있는 건 위 순서 제약뿐이다.

---

## 2. 프롬프트 캐시 순서 — 전제가 뒤집혔다

### 2-1. 원래 가설

프롬프트는 `[stable_prefix][ephemeral_overlay][durable_history][current_user][within_turn_suffix]` 순으로 조립된다. 오버레이(날짜, git 상태 등 매 턴 바뀌는 것)가 대화 기록 앞에 있어서, 캐시 접두사가 오버레이에서 끊기고 기록 전체가 매 턴 다시 계산된다. 오버레이를 기록 뒤로 옮기면 기록이 캐시 대상이 된다.

조립부는 여기다.

```
harness/fx/src/core/agent/runtime/prompt_context.zig:38
try messages.appendSlice(alloc, stable_prefix);
try appendEphemeralOverlayMessages(alloc, &messages, ephemeral_overlay);
try messages.appendSlice(alloc, durable_history);
try messages.append(alloc, current_user_message);
try messages.appendSlice(alloc, within_turn_suffix);
```

오버레이는 append 시 `cache_policy = .no_cache`로 강제된다 (`:49`).

### 2-2. 조사에서 뒤집힌 것

**리드가 초기에 "한 줄만 옮기면 된다"고 판단한 것은 틀렸다.** 실제로는 세 가지가 걸린다.

**(a) 현재 순서는 의도된 계약이고 테스트가 못 박고 있다.**

`prompt_context.zig:140` 테스트 이름이 그대로 `"buildGatewayMessages orders transient overlay before history and current prompt"`다. 순서를 바꾸면 이 테스트가 깨진다 — 실수가 아니라 계약이라는 뜻이다.

**(b) system 메시지 선두 집중 불변식이 있다.**

```
harness/fx/src/core/agent/runtime/prompt_context.zig:259
for (messages.items) |entry| {
    if (entry.role == .system) {
        try std.testing.expect(!saw_non_system);
    } else {
        saw_non_system = true;
    }
```

system 역할 메시지는 전부 맨 앞에 몰려 있어야 하고, non-system이 한 번 등장한 뒤 system이 다시 나오면 안 된다. 오버레이는 `role = .system`이므로 history 뒤로 옮기면 이 불변식이 깨진다. 게이트웨이 검증(`validateToolMessageHistory`)까지 통과하는지도 별도 확인이 필요하다.

**(c) 인덱스 두 개가 순서에 의존한다.**

```
harness/fx/src/core/agent/runtime/orchestrator.zig:2638
const history_start_index = stable_prefix.items.len + ephemeral_overlay.items.len;
const current_user_message_index = history_start_index + history_messages.items.len;
```

순서를 바꾸면 이 산술이 함께 틀어진다. 두 인덱스의 소비처를 모두 추적해야 한다.

### 2-3. 조사 중 확인된 부수 사실

`buildGatewayMessages`를 grep했을 때 테스트만 잡혀서 "프로덕션 미사용 함수"로 잠시 오판했다. 실제 프로덕션 호출부는 `orchestrator.zig:2636`이며, 한 줄이 길어 grep 컨텍스트에서 잘렸던 것이다. `prompt_context.zig`는 `main.zig:3744`에서 `_ = @import(...)`로 테스트 등록되지만, 프로덕션 경로에서도 정상적으로 쓰인다.

### 2-4. 상태

착수 가능하되 "한 줄 수정"이 아니다. 최소한 (a)(b)(c) 세 지점의 처리 방침을 먼저 정해야 한다. 특히 (b)는 단순 이동으로 풀리지 않을 수 있다 — 오버레이를 system이 아닌 역할로 바꾸거나, 캐시 경계를 다른 방식으로 잡는 대안을 함께 검토해야 한다.

---

## 3. 리드 깨우기 — 설계 없음, 그리고 선행 결정과 충돌

서브에이전트가 끝났을 때 부모 턴을 자동으로 열어 결과를 즉시 받는 기능. 현재 알림은 부모의 **다음 턴**에 실려 들어온다.

**선행 문서와의 관계.** `team-overlay-v1.1-decisions.md` 결정 1의 "하지 않는 것"에 다음이 있다:

> 리드 자동 재개는 채택하지 않는다. root 세션이 사용자 없이 스스로 새 턴을 시작하면 승인 경계가 무너지고, 설계서 §11의 "Lead는 background child가 아니다"와 정면으로 어긋난다. 알림은 사용자를 부르는 것이지 사용자를 대신하는 것이 아니다.

**이 기각은 사용자 판단이 아니다.** 2026-08-21 사용자가 직접 확인: "깨우기 기각 — 난 한 적 없어. 문서가 잘못된 거야." 위 문장은 이전 세션에서 리드가 내린 판단이 사용자 결정으로 기록된 것이다. Team Overlay 맥락(리드=사용자와 대화하는 root)에서 나온 제약이며, rubato 전체에 대한 확정 방침이 아니다.

따라서 깨우기는 **열린 항목**이다. 다만 결정 1이 지목한 승인 경계 문제 자체는 실재하는 설계 쟁점이므로, 설계 단계에서 그 우려를 어떻게 해소할지는 답해야 한다.

**참고 — 원래 불편의 직접 원인은 따로 있었다.** 60초 wait 세 번은 도구 사용 실수였다. `subagent.inspect`의 `wait`는 최대 60000ms까지 한 번에 걸 수 있고, 폴링은 빈 응답을 히스토리에 영구히 쌓는다. 캐시 순서를 고쳐도 그 쓰레기는 사라지지 않는다 — 캐시된다는 건 "다시 계산 안 한다"지 "없어진다"가 아니다. 이건 깨우기의 필요성과 별개로 지킬 규칙이다: 이번 턴에 결과가 필요하면 wait을 길게 한 번, 필요 없으면 띄워두고 다음 턴에 수령.

**상태.** 설계 착수. 승인 경계 해소 방안이 설계의 필수 항목이다.

---

## 우선순위 메모

2026-08-21 사용자 결정: **세 개 다 한다.** rewind는 구현 착수, 나머지 둘은 설계부터. 병렬로 진행한다.

- 1(rewind) — 설계 닫힘, 구현 착수. 세션 커밋 경로를 건드리므로 테스트 없이는 완료로 치지 않는다.
- 2(캐시 순서) — 설계 필요. (b) 불변식 때문에 단순 이동으로 풀리지 않는다. 대안 비교가 설계의 핵심.
- 3(깨우기) — 설계 필요. 승인 경계 해소 방안이 필수 항목.

파일 충돌은 없다. 1은 `session/`·`worker_runtime`, 2는 `prompt_context`·`orchestrator`, 3은 알림·런루프 경로다. 다만 2와 3은 설계 산출물만 내므로 소스를 건드리지 않는다 — 실제 쓰기는 1만 한다.
