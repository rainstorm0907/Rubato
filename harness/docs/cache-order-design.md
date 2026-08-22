# 프롬프트 캐시 접두사 설계 — overlay가 끊는 것과 그 대안

조사 대상: `harness/fx` (rubato, fx 포크). 읽기 전용 조사이며 소스는 수정하지 않았다.
백로그 2절(`harness/docs/rubato-improvements-backlog.md:122`)의 후속 설계다.

표기 규칙:
- **[확인]** — 코드를 읽거나 실행해서 직접 확인한 사실. 파일·줄·인용을 붙였다.
- **[추정]** — 코드로 확정하지 못하고 추론한 것.
- **[실측]** — 이 세션에서 실제로 측정한 수치.

---

## 0. 요약

1. 백로그의 (b) "system 선두 집중 불변식"은 **프로덕션 불변식이 아니다.** `saw_non_system` 검사는
   테스트 블록 안에만 존재하고, 프로덕션 코드는 이미 non-system 뒤에 system을 보내고 있다. **[확인]**
2. 캐시가 끊기는 실제 지점은 순서가 아니라 `gateway_json.zig:334`의 `prefix_cacheable` 래치다.
   overlay가 `.no_cache`이면 그 뒤 **모든** 캐시 마킹이 죽고, `findCacheBreakpoint`가 계산한
   history 끝 breakpoint도 함께 죽는다. **[확인]**
3. 그래서 "overlay를 뒤로 옮기기"만으로는 부족하고, 반대로 **overlay를 그대로 두고 래치만 고쳐도**
   대부분의 이득이 나온다. 이게 권장안이다.
4. 이득은 요청당 대략 캐시 write 감소가 아니라 **history 구간의 캐시 read 전환**이다. 실측 세션에서
   요청당 캐시 read는 이미 62k~100k 토큰, uncached input은 전체의 6.0%다. **[실측]**

---

## 1. 현재 파이프라인 — 확인된 사실

### 1-1. 조립 순서

```zig
// harness/fx/src/core/agent/runtime/prompt_context.zig:38
try messages.appendSlice(alloc, stable_prefix);
try appendEphemeralOverlayMessages(alloc, &messages, ephemeral_overlay);
try messages.appendSlice(alloc, durable_history);
try messages.append(alloc, current_user_message);
try messages.appendSlice(alloc, within_turn_suffix);
```

overlay는 append 시점에 정책이 강제된다.

```zig
// harness/fx/src/core/agent/runtime/prompt_context.zig:46
fn appendEphemeralOverlayMessages(alloc: Allocator, messages: *std.ArrayList(ChatMessage), ephemeral_overlay: []const ChatMessage) !void {
    for (ephemeral_overlay) |overlay_message| {
        var copy = overlay_message;
        copy.cache_policy = .no_cache;
        try messages.append(alloc, copy);
    }
}
```

프로덕션 호출부는 두 곳이며 둘 다 같은 함수다. **[확인]**

```
harness/fx/src/core/agent/runtime/orchestrator.zig:2636   (스텝 진입 시)
harness/fx/src/core/agent/runtime/orchestrator.zig:2800   (재시도/재빌드 시)
```

`buildGatewayMessages`의 다른 호출자는 없다. `grep -rn "buildGatewayMessages" src` 결과가
위 두 줄과 `prompt_context.zig` 자신뿐이다. **[확인]**

### 1-2. 캐시 마킹의 실제 규칙 — 여기가 핵심이다

```zig
// harness/fx/src/core/gateway/gateway_json.zig:308
const cache_breakpoint_idx = if (options.prompt_caching) findCacheBreakpoint(messages) else null;
var prefix_cacheable = true;

try out.writer.writeAll("{\"prompt\":[");
for (messages, 0..) |message, i| {
    ...
    const use_cache = prefix_cacheable and shouldCacheMessage(message, i, cache_breakpoint_idx, options.prompt_caching);
    ...
    if (message.cache_policy == .no_cache) prefix_cacheable = false;   // :334
}
```

```zig
// harness/fx/src/core/gateway/gateway_json.zig:510
pub fn shouldCacheMessage(message: ChatMessage, index: usize, cache_breakpoint_idx: ?usize, prompt_caching: bool) bool {
    if (!prompt_caching) return false;
    if (message.cache_policy == .no_cache) return false;
    return message.role == .system or (cache_breakpoint_idx != null and index == cache_breakpoint_idx.?);
}
```

```zig
// harness/fx/src/core/gateway/gateway_json.zig:752
fn findCacheBreakpoint(messages: []const ChatMessage) ?usize {
    if (messages.len < 3) return null;
    var i = messages.len - 2;
    while (i > 0) : (i -= 1) {
        const role = messages[i].role;
        if (role == .user or role == .assistant) return i;
    }
    return null;
}
```

세 조각을 합치면 이렇게 동작한다. **[확인]**

- 캐시 마킹은 Anthropic `cacheControl: ephemeral` breakpoint 방식이다
  (`gateway_json.zig:516`의 `anthropic_cache_meta`).
- `findCacheBreakpoint`는 **끝에서 두 번째 이전**의 마지막 user/assistant를 고른다. 즉 정상
  상황이면 durable_history의 마지막 근처를 가리킨다. 이게 원래 의도된 "history까지 캐시" 지점이다.
- 그런데 `prefix_cacheable`이 overlay(=`.no_cache`)에서 false로 떨어지고 **다시 켜지지 않는다.**
  그래서 breakpoint 인덱스에 도달해도 `use_cache`가 false다.

이걸 로직 그대로 시뮬레이션해서 확인했다. **[실측]** — `stable×2 + overlay(no_cache)×4 +
history(user/assistant)×20 + current_user`, 총 27개 메시지:

```
breakpoint idx: 25 of 27
marked: [(0, 'system', 'stable0'), (1, 'system', 'stable1')]
```

breakpoint는 25(history 끝)로 **정확히 계산되지만 마킹되지 않는다.** 실제로 캐시 마커가 붙는 건
overlay 앞의 stable system 2개뿐이다.

`gateway_json.zig:1044`의 기존 테스트가 이 동작을 못 박고 있다. **[확인]**

```zig
// harness/fx/src/core/gateway/gateway_json.zig:1044 "buildGatewayRequestBodyWithOptions leaves transient system messages uncached"
const cache_marker = "\"cacheControl\":{\"type\":\"ephemeral\"}";
try std.testing.expectEqual(@as(usize, 2), std.mem.count(u8, body, cache_marker));
...
const overlay_idx = std.mem.indexOf(u8, body, "volatile runtime overlay") orelse return error.TestExpectedPromptMessageMissing;
try std.testing.expect(std.mem.find(u8, body[overlay_idx..], "cacheControl") == null);
```

마지막 두 줄이 "overlay **이후 전체**에 cacheControl이 없어야 한다"를 검사한다. overlay 자신만이
아니라 그 뒤 전부다. 즉 이 테스트는 `prefix_cacheable` 래치 자체를 계약으로 고정한다.

### 1-3. 캐시가 켜지는 조건

```zig
// harness/fx/src/core/config/model_capabilities.zig:84
fn localCapabilitiesForModel(model: []const u8) Capabilities {
    var capabilities: Capabilities = .{};
    if (std.mem.startsWith(u8, model, "anthropic/")) {
        capabilities.prompt_caching = true;
    }
```

Anthropic 모델에서만 켜진다. **[확인]** 다른 프로바이더에서는 이 설계 전체가 no-op이다.

### 1-4. overlay의 실제 내용

`orchestrator.zig:2626`에서 매 스텝 새로 만든다.

```zig
// harness/fx/src/core/agent/runtime/orchestrator.zig:2626
var ephemeral_overlay: std.ArrayList(ChatMessage) = .empty;
if (config.explicit_skills_prompt_section.len > 0) {
    try ephemeral_overlay.append(overlay_arena, .{ .role = .system, .content = config.explicit_skills_prompt_section });
}
try deps.append_runtime_context(deps.ctx, overlay_arena, &ephemeral_overlay);
var parent_turn_delivery = try appendPreparedParentTurnContext(deps, overlay_arena, &ephemeral_overlay);
```

`append_runtime_context`는 최종적으로 `src/builtins/context.zig:2900 appendTransient`로 간다.
거기서 붙는 것들: **[확인]**

| 조각 | 위치 | 매 턴 변하나 |
|---|---|---|
| `<fx-turn-context>` (workspace, cwd, OS, shell, date_utc, home, git branch/worktree/remote) | `context.zig:1968` | date는 하루 단위, git worktree/branch는 자주 |
| noninteractive 안내문 | `context.zig:2910` | 고정 |
| workspace access 디렉터리 | `context.zig:2953` | 드묾 |
| permission mode | `context.zig:2917` | 드묾 |
| sandbox | `context.zig:2918` | 드묾 |
| focused verification (tracked changes) | `context.zig:2979` | **매 턴 변함** |
| background 명령 목록 (pid, log path 포함) | `context.zig:2925` | **매 턴 변함** |
| non-live background history | `context.zig:2951` | 변함 |

즉 overlay는 단일 메시지가 아니라 **여러 개의 system 메시지**다. 대부분은 사실상 고정이고,
진짜로 매 턴 바뀌는 건 git worktree 상태, tracked changes, background 목록 정도다.

### 1-5. (c) 인덱스 소비처 — 전부 추적함

```zig
// harness/fx/src/core/agent/runtime/orchestrator.zig:2638
const history_start_index = stable_prefix.items.len + ephemeral_overlay.items.len;
const current_user_message_index = history_start_index + history_messages.items.len;
```

`grep -rn` 결과 **[확인]**:

- `history_start_index` — **소비처 없음.** 2639에서 `current_user_message_index`를 계산하는 데만
  쓰인다. 리포 전체에서 다른 등장이 없다.
- `current_user_message_index` — 소비처 2곳, 둘 다 vision 경로다.
  - `orchestrator.zig:2832` → `runtime_vision_contracts.project_native_messages`
  - `orchestrator.zig:2843` → `runtime_vision_contracts.project_text_only_messages`

두 소비처의 계약은 이렇다.

```zig
// harness/fx/src/core/agent/runtime/vision_contracts.zig:470
if (current_user_message_index >= projected.len or
    projected[current_user_message_index].role != .user or
    projected[current_user_message_index].permission_feedback)
{
    return error.MissingUserMessage;
}
```

```zig
// harness/fx/src/core/agent/runtime/vision_contracts.zig:494
std.debug.assert(current_user_message_index < messages.len);
std.debug.assert(messages[current_user_message_index].role == .user);
```

즉 이 인덱스가 요구하는 건 **"현재 유저 메시지의 정확한 위치"** 하나뿐이다. `project_native_messages`는
그 인덱스를 "root turn 경계"로도 쓴다(`vision_contracts.zig:522`, `:532`, `:556` — `message_index >=
current_user_message_index`인 vision 호출만 유지). 순서를 바꾸면 이 산술만 맞춰주면 된다.
`assert`는 ReleaseSafe에서 살아 있으므로 틀리면 조용히 넘어가지 않고 죽는다. **[확인]**

---

## 2. 질문 1 — (b) 불변식은 왜 존재하는가

### 판정: 프로덕션 불변식이 아니다. 테스트 안에만 있는 어서션이다.

`saw_non_system` 패턴은 리포 전체에 딱 두 군데 있고 **둘 다 `test` 블록 안**이다. **[확인]**

```
harness/fx/src/core/agent/runtime/prompt_context.zig:253   (test "buildGatewayMessages preserves one system prefix for projected session history")
harness/fx/src/core/session/session.zig:3854               (session history projection test)
```

```zig
// harness/fx/src/core/agent/runtime/prompt_context.zig:253
var saw_non_system = false;
...
for (messages.items) |entry| {
    if (entry.role == .system) {
        try std.testing.expect(!saw_non_system);
    } else {
        saw_non_system = true;
    }
```

프로덕션 직렬화 경로(`gateway_json.zig:292 buildGatewayRequestBodyValidated`,
`:445 validateToolMessageHistory`)에는 role 순서 검사가 **없다.**

`validateToolMessageHistory`가 강제하는 건 tool 메시지 짝맞춤뿐이다. **[확인]**

```zig
// harness/fx/src/core/gateway/gateway_json.zig:445
pub fn validateToolMessageHistory(alloc: std.mem.Allocator, messages: []const ChatMessage) !void {
    var i: usize = 0;
    while (i < messages.len) {
        const msg = messages[i];
        if (msg.role == .tool) return error.InvalidGatewayHistory;          // 짝 없는 tool 결과 금지
        if (msg.role != .assistant or msg.tool_calls.len == 0) {
            i += 1;
            continue;                                                       // system은 그냥 통과
        }
        ...
```

system 메시지는 첫 분기에도 안 걸리고 두 번째 분기에서 `i += 1; continue`로 조용히 지나간다.
**위치와 무관하게 통과한다.** 다만 주의할 점이 하나 있다: assistant의 tool_calls 직후에는
tool 결과가 **연속으로** 와야 한다.

```zig
// harness/fx/src/core/gateway/gateway_json.zig:473
while (result_count < calls.len) : (j += 1) {
    if (j >= messages.len) return error.InvalidGatewayHistory;
    const result = messages[j];
    if (result.role != .tool) return error.InvalidGatewayHistory;          // 사이에 system 끼면 실패
```

→ **tool_calls와 tool 결과 사이**에는 system을 끼울 수 없다. 그 외 위치는 자유다. **[확인]**

### 결정적 반례: 프로덕션은 이미 이 "불변식"을 깨고 있다

```zig
// harness/fx/src/core/agent/runtime/orchestrator.zig:7206
if (execution.system_notice) |notice| {
    try within_turn_suffix.append(arena, .{ .role = .system, .content = notice });
}
```

`within_turn_suffix`는 조립 순서상 **맨 마지막**이다(`prompt_context.zig:42`). 즉 도구 실행이
system_notice를 내면, 실제 전송되는 프롬프트는 `[system...][user history][assistant][tool][system notice]`
모양이 된다. 이건 테스트가 금지하는 형태인데 **프로덕션에서 이미 나가고 있다.** 그리고 이 경로는
tool 결과 블록이 닫힌 뒤에 붙으므로 `validateToolMessageHistory`도 통과한다. **[확인]**

`within_turn_suffix`의 다른 append들도 role이 섞여 있다 (`orchestrator.zig:3413` user,
`:4212` assistant, `:4213` user, `:7206` system).

### 그럼 왜 테스트가 그렇게 쓰였나

history 프로젝션이 **능동적으로** leading summary만 system으로 내보내기 때문이다. **[확인]**

```zig
// harness/fx/src/core/session/session.zig:2791 appendHistoryChatMessagesImpl
var in_leading_summary_prefix = starts_in_leading_summary_prefix;
for (history) |turn| {
    const summary_is_system = in_leading_summary_prefix;
    in_leading_summary_prefix = continuesLeadingSummaryPrefix(in_leading_summary_prefix, turn);
    switch (turn) {
        .compacted_summary => |entry| {
            ...
            try messages.append(alloc, .{
                .role = if (summary_is_system) .system else .user,        // 여기
                .content = text,
            });
        },
```

```zig
// harness/fx/src/core/session/session.zig:2581
fn continuesLeadingSummaryPrefix(in_leading_summary_prefix: bool, turn: HistoryTurn) bool {
    return in_leading_summary_prefix and turn == .compacted_summary;
}
```

compaction 요약이 히스토리 맨 앞에 연속으로 있을 때만 system이고, 중간에 끼면 user로 강등된다.
`prompt_context.zig:253`의 어서션은 **이 프로젝션 규칙이 지켜지는지**를 검증하는 것이지
게이트웨이 제약을 표현한 게 아니다. **[추정]** — 테스트 이름
(`"preserves one system prefix for projected session history"`)이 "projected session history"를
명시하는 게 근거지만, 커밋 히스토리가 squash되어(`git log` 결과 `439f83c Initial commit`) 저자 의도를
직접 확인할 수는 없었다.

### 깨면 실제로 무슨 일이 일어나는가

- **fx 내부**: `prompt_context.zig:253` 테스트가 실패한다. 그게 전부다. 프로덕션 코드 경로는
  role 순서를 검사하지 않는다. **[확인]**
- **게이트웨이 검증**: 통과한다. 단, tool_calls-결과 블록 사이만 피하면 된다. **[확인]**
- **프로바이더**: Anthropic Messages API는 `system`을 top-level 파라미터로 받지만, fx는 Vercel AI
  Gateway의 `prompt` 배열로 보내고(`gateway_json.zig:311` `{"prompt":[`) 게이트웨이가 변환한다.
  게이트웨이가 중간 system을 어떻게 매핑하는지는 이 리포에서 판정 불가다. **[추정]** — 다만
  `orchestrator.zig:7206`이 이미 그 형태를 프로덕션에서 내보내고 있고 별도 우회 코드가 없으므로,
  현재 사용 모델에서 거부되지는 않는다고 보는 게 합리적이다. 새 배치를 실제로 도입할 때는 라이브
  요청으로 한 번 확인해야 한다.

---

## 3. 질문 2 — 대안 비교

네 개를 놓고 본다. A는 순서를 안 건드리고, B~D는 건드린다.

---

### 안 A — `prefix_cacheable` 래치를 없애고 breakpoint 마킹만 살린다 (순서 유지)

**무엇을 바꾸나**

`gateway_json.zig:334`의 `prefix_cacheable = false` 래치를 제거하거나, 래치가 `role == .system`
자동 마킹만 끄고 명시 breakpoint 마킹은 살리도록 분리한다. 조립 순서, overlay 위치, 인덱스는
전부 그대로다.

**왜 되나**

`findCacheBreakpoint`는 이미 history 끝을 정확히 가리킨다(§1-2 시뮬레이션에서 idx 25 확인).
Anthropic 캐시는 breakpoint **이전 전체**를 캐시 대상으로 잡으므로, breakpoint 하나만 살아나면
`[stable][overlay][history]` 전체가 캐시 접두사가 된다. overlay가 접두사 **안**에 있다는 게 문제로
보이지만 —

**여기가 이 안의 진짜 트레이드오프다.** overlay가 접두사 안에 있으면, overlay가 바뀌는 턴에는
캐시가 miss 나고 접두사 전체를 다시 write 해야 한다. §1-4에서 봤듯 overlay 중 매 턴 확실히
바뀌는 건 tracked changes와 background 목록이다. 즉:

- overlay가 안 바뀐 턴: history까지 전부 캐시 read. **큰 이득.**
- overlay가 바뀐 턴: 지금과 동일하게 stable_prefix만 read하고 나머지 write. **현상 유지.**

지금은 **항상** 후자다. A는 전자를 되찾는다.

**비용/위험**

- 코드 변경량이 가장 작다. `gateway_json.zig` 한 함수.
- overlay가 자주 바뀌면 이득이 줄어든다. 최악의 경우 현상 유지지 악화는 아니다.
- 캐시 write가 늘어날 수 있다 — 접두사가 길어지면 write 단가가 붙는 구간도 길어진다. overlay가
  매 턴 바뀌는 세션에서는 **write 비용만 늘고 read는 안 늘 수 있다.** 이게 이 안의 실질 리스크다.
  Anthropic 기준 write는 base의 1.25배, read는 0.1배이므로, 히트율이 낮으면 손해가 난다. **[추정]**
  — 단가는 이 리포에 없다.

**깨지는 테스트**

- `gateway_json.zig:1044` `"buildGatewayRequestBodyWithOptions leaves transient system messages uncached"`
  — `expectEqual(2, count(cache_marker))`가 3으로 바뀌고, "overlay 이후 cacheControl 없음"
  어서션이 깨진다. **이 테스트는 의도를 다시 써야 한다.**
- `prompt_context.zig:169` `expectEqual(no_cache, messages.items[2].cache_policy)` — 안 깨진다.
  overlay의 `cache_policy` 자체는 그대로 두므로.
- `prompt_context.zig:140`, `:172` — 안 깨진다. 순서를 안 건드린다.
- vision 인덱스 — 안 깨진다.

---

### 안 B — overlay를 history 뒤, current_user 앞으로 옮긴다

**무엇을 바꾸나**

```
[stable_prefix][durable_history][ephemeral_overlay][current_user][within_turn_suffix]
```

`prompt_context.zig:38-42`의 순서 교체 + `orchestrator.zig:2638-2639` 인덱스 재계산:

```
history_start_index          = stable_prefix.len
current_user_message_index   = stable_prefix.len + history.len + overlay.len
```

**왜 되나**

`prefix_cacheable` 래치가 살아 있어도 `[stable][history]`까지는 마킹이 살아난다. 단
`findCacheBreakpoint`가 history 끝을 잡아줘야 하는데, overlay가 그 뒤로 가면 breakpoint 계산은
여전히 "끝에서 두 번째 이전의 마지막 user/assistant"라 **current_user보다 앞의 마지막
assistant**를 잡는다. 즉 history 끝을 정확히 잡는다. 래치는 overlay에서 꺼지지만 그때는 이미
마킹이 끝난 뒤다. **[확인]** — 로직상 그렇고, 시뮬레이션으로 검증하지는 않았다.

**비용/위험**

- overlay가 캐시 접두사 **밖**으로 나가므로, overlay가 매 턴 바뀌어도 history 캐시가 안 깨진다.
  A의 리스크가 없다. 이게 B의 장점이다.
- 대신 프롬프트 의미가 바뀐다. 지금은 "런타임 상태 → 대화 기록" 순으로 읽히는데, B는 "대화 기록 →
  런타임 상태 → 지금 질문"이 된다. 모델이 최신 컨텍스트를 더 가깝게 본다는 점에서 오히려 나을
  수도 있지만, 프롬프트 동작 변화라 별도 검증이 필요하다. **[추정]**
- non-system 뒤 system 배치가 된다. §2에서 판정한 대로 게이트웨이 검증은 통과하고 프로덕션 선례도
  있지만(`orchestrator.zig:7206`), 이 경우는 **매 요청 항상** 그 형태가 된다. 선례는 도구
  system_notice가 있을 때만이라 노출 빈도가 다르다. 라이브 확인이 필요하다.
- vision 경로가 `current_user_message_index`를 root-turn 경계로 쓰므로(`vision_contracts.zig:522`),
  overlay가 그 앞에 끼면 경계 판정이 한 칸 밀린다. 산술만 맞추면 되지만 확인 대상이다.

**깨지는 테스트**

- `prompt_context.zig:140` `"buildGatewayMessages orders transient overlay before history and current prompt"`
  — 이름과 인덱스 어서션(`items[2]`~`items[6]`)이 전부 깨진다. 테스트를 새로 써야 한다.
- `prompt_context.zig:172` `"preserves one system prefix..."` — `saw_non_system` 어서션이 깨진다
  (line 261). 이 어서션 자체를 걷어내거나 "history 프로젝션 구간에 한정"으로 좁혀야 한다.
- `gateway_json.zig:1044` — 메시지 배열을 직접 만드는 테스트라 조립 순서와 무관, 안 깨진다.
  다만 이 테스트가 고정한 "래치" 계약은 B에서도 살아 있으므로 손댈 필요가 없다.

---

### 안 C — overlay의 role을 `.system`에서 `.user`로 바꾼다

**무엇을 바꾸나**

`appendEphemeralOverlayMessages`(`prompt_context.zig:46`)에서 `copy.role = .user`도 함께 강제.
위치는 그대로 둘 수도, B와 조합할 수도 있다.

**왜 되나 / 안 되나**

`shouldCacheMessage`는 `message.role == .system`일 때 자동 마킹하는데, `.no_cache`가 먼저 걸러서
어차피 마킹 안 된다(`gateway_json.zig:512`). 그리고 `prefix_cacheable` 래치는 role과 무관하게
`cache_policy`만 본다(`:334`). **즉 role만 바꾸면 캐시 동작이 전혀 안 바뀐다.** **[확인]**

role 변경은 §2의 "불변식" 회피에만 의미가 있는데, §2에서 그 불변식이 프로덕션 제약이 아니라고
판정했으므로 회피할 대상 자체가 없다.

**비용/위험**

- 캐시 이득 0. 단독으로는 무의미하다.
- 부작용은 있다. `.user` role은 직렬화 형태가 다르다 — system은 `"content": "..."` 문자열이고
  user는 `"content": [{"type":"text",...}]` 배열이다(`gateway_json.zig:530-548`). 런타임 컨텍스트가
  유저 발화처럼 보이게 되고, `findCacheBreakpoint`가 overlay를 breakpoint 후보로 잡을 수도 있다
  (user/assistant를 찾으므로). 이건 오히려 breakpoint를 history보다 뒤로 밀어버릴 수 있다.
- vision의 `project_text_only_messages`가 `role != .user`로 현재 유저 메시지를 식별하는데
  (`vision_contracts.zig:471`), overlay가 user가 되면 인덱스 오판 위험이 생긴다.

**결론: 기각.** 단독으로 이득이 없고 새 위험만 만든다.

**깨지는 테스트**

- `prompt_context.zig:169`의 `cache_policy` 어서션은 안 깨지지만, `:147`, `:240`이 overlay를
  `.system`으로 만들고 role을 검증하지는 않아 조용히 지나갈 수 있다. 조용히 지나가는 게 더 나쁘다.

---

### 안 D — overlay 내용을 `current_user_message`에 합친다

**무엇을 바꾸나**

overlay 텍스트를 현재 유저 메시지 앞에 붙여 하나의 user 메시지로 만든다. overlay 배열 자체를 없앤다.

**왜 되나**

`[stable][history][current_user(+overlay)]`가 되어 history가 완전히 캐시 접두사 안으로 들어간다.
캐시 관점에서는 B와 동등하고 메시지 개수가 줄어 breakpoint 계산도 단순해진다.

**비용/위험 — 가장 크다**

- `current_user_message`는 세션 히스토리에 그대로 저장되는 값이다. overlay를 합치면 **매 턴의
  런타임 상태가 영구 히스토리에 박힌다.** 다음 턴부터 과거 턴의 낡은 git 상태·background 목록이
  히스토리로 재생된다. 지금 구조가 명시적으로 피하고 있는 것이다 —
  `appendTransient`(`context.zig:2900`)와 `appendStatic`(`app_agent_runtime.zig:731`)이 분리되어
  있는 이유가 이거다. **[확인]**
- 이걸 피하려면 "전송용 current_user"와 "저장용 current_user"를 분리해야 하는데, 그러면
  vision 경로가 건드리는 `current_user_message_index` 대상 메시지의 정체성이 흔들린다
  (`vision_contracts.zig:479`가 그 메시지의 content를 실제로 덮어쓴다).
- 이미지 첨부가 붙는 메시지이기도 하다(`vision_contracts.zig:550` verified images). overlay 텍스트가
  섞이면 이미지-텍스트 배치가 바뀐다.
- `permission_feedback` 플래그 검사(`vision_contracts.zig:472`)와도 얽힌다.

**깨지는 테스트**

- `prompt_context.zig:140`, `:172`, `:294`(`"current portable prompt"` 위치 어서션) 전부.
- vision 관련 테스트 다수. 정확한 목록은 확인하지 않았다. **[추정]**
- 세션 히스토리 왕복 테스트(`session.zig`) 중 current_user 내용을 비교하는 것들.

**결론: 비용 대비 이득이 B와 같은데 위험만 크다. 기각.**

---

### 비교표

| | 캐시 이득 | 코드 변경량 | overlay 변동에 취약 | 프롬프트 의미 변화 | 깨지는 테스트 |
|---|---|---|---|---|---|
| **A** 래치 수정 | 중~대 (overlay 안정 시 대) | 최소 (1개 함수) | **예** | 없음 | 1개 (`gateway_json.zig:1044`) |
| **B** overlay 후치 | 대 (안정적) | 중 (조립 + 인덱스 + vision 확인) | 아니오 | 있음 | 2개 (`prompt_context.zig:140`, `:172`) |
| **C** role 변경 | **0** | 소 | — | 있음 | 없음(그래서 더 나쁨) |
| **D** current_user 병합 | 대 | 대 | 아니오 | 큼 | 다수 + 히스토리 오염 |

**A와 B는 배타적이지 않다.** B를 하면 A 없이도 history가 캐시되고, 둘 다 하면 overlay까지 접두사에
들어간다(= A의 리스크가 다시 생김). 조합은 권하지 않는다.

---

## 4. 질문 3 — 이득 추정

### 4-1. overlay 크기 — [실측]

이 세션의 실제 시스템 프롬프트에 들어온 `<fx-turn-context>` 블록 + 뒤따르는 `Runtime context:`
줄 3개를 그대로 파일로 만들어 쟀다.

```
$ wc -c overlay_sample.txt
948 overlay_sample.txt   (16 lines)
```

**948바이트 ≈ 240~260 토큰.** 영문 기준 4바이트/토큰 가정. **[추정]** — 토크나이저를 직접
돌리지는 않았다.

단 이건 **최소치**다. tracked changes나 background 명령이 있는 세션에서는
`appendFocusedVerificationContext`(`context.zig:2979`)와 background 목록(`context.zig:2925`)이
붙어 수백~수천 바이트가 더 늘어난다. `explicit_skills_prompt_section`(`orchestrator.zig:2628`)도
overlay에 들어가는데, 스킬 카탈로그는 훨씬 크다.

### 4-2. 그 뒤에 걸린 history 규모 — [실측]

`~/.fx/sessions/*/usage-v2.json` 189개 중 요청 5회 이상인 42개 세션을 집계했다.

```
  req      input     c_read    c_write   read%  write%  read/req
  176   13112428   10907511    2204565   83.2%   16.8%     61974
  169   15530583   13341507    2188738   85.9%   14.1%     78944
   92    8145387    6473289    1671920   79.5%   20.5%     70362
   75    7363675    6780653     582872   92.1%    7.9%     90409
   64    4598800    3233920          0   70.3%    0.0%     50530
   59    6686383    5933528     752737   88.7%   11.3%    100568
   52    4189983    3467445     722434   82.8%   17.2%     66682
TOTAL  67389569   54907390    8460008   read%=81.5 write%=12.6 uncached%=6.0
```

읽는 법:
- **요청당 입력이 5만~10만 토큰대**다. 이게 "그 뒤에 걸린 대화 기록"의 실제 규모다.
- 캐시가 **이미 81.5% 작동 중**이다. 이건 백로그의 "대화 기록 전체가 매 턴 재계산된다"와 다르다.

### 4-3. 그런데 왜 81.5%나 hit이 나는가 — 이 부분이 백로그를 정정한다

§1-2에서 확인한 대로 마킹되는 건 stable_prefix뿐이다. 그런데 stable_prefix가 크다.

```zig
// harness/fx/src/core/agent/runtime/orchestrator.zig:1811
try stable_prefix.append(arena, .{ .role = .system, .content = config.system_prompt });
if (config.custom_tool_guidance.len > 0) ... :1813
if (config.skills_prompt_section.len > 0) ... :1816
... :1819
try append_static_context(deps.ctx, arena, &stable_prefix);   // :1822 — 프로젝트 컨텍스트 + MCP 카탈로그
```

시스템 프롬프트 + 툴 가이던스 + 스킬 카탈로그 + 프로젝트 컨텍스트(AGENTS.md 등) + MCP 카탈로그가
전부 여기 들어간다. 이 세션만 봐도 시스템 프롬프트가 수천 토큰이다.

**따라서 현재 81.5% hit은 대부분 stable_prefix 몫이고, history 구간은 캐시 밖이다.** **[추정]**
— usage 데이터가 구간별로 나뉘어 있지 않아 분해할 수 없다. 다만 §1-2의 시뮬레이션이 "마킹은
stable_prefix 2개뿐"임을 확정하므로, history가 캐시 read로 잡힐 경로가 없다는 건 확인된 사실이다.

### 4-4. 그래서 실제 이득은 얼마인가

**uncached input이 전체의 6.0%, 요청당 평균 약 4,100 토큰이다.** (67,389,569 − 54,907,390 −
8,460,008) ÷ 989 = 4,067. **[실측]**

이 4,067 토큰이 매 요청 새로 계산되는 부분 — overlay + 새 history 증분 + current_user다.

그리고 **cache_write가 12.6%, 요청당 평균 8,554 토큰**이다. 캐시 접두사가 history를 포함하지
못하니, 대화가 길어질수록 새 breakpoint를 잡을 기회 없이 같은 접두사만 반복 write하거나 아예
write를 안 한다(위 표에서 `c_write=0`인 세션이 여럿 있다).

**A나 B를 적용하면 기대되는 변화** **[추정]**:
- history 구간이 캐시 read로 전환된다. 요청당 5만~10만 토큰 중 stable_prefix를 뺀 나머지가 대상.
- Anthropic 가격 기준 read는 base의 0.1배, write는 1.25배다. history가 read로 전환되면 그 구간
  비용이 1/10이 된다.
- 다만 **첫 write 비용이 새로 붙는다.** 대화가 짧으면 손익분기 전에 세션이 끝날 수 있다.

정직하게 말하면 **정확한 절감액은 이 리포의 데이터로 계산할 수 없다.** usage-v2.json에는 구간별
분해가 없고, 캐시 히트 여부를 요청 단위로 기록하지 않는다. 확실히 말할 수 있는 건:

1. history는 지금 확실히 캐시 밖이다 (§1-2, **[확인]**).
2. history는 요청당 수만 토큰 규모다 (§4-2, **[실측]**).
3. 이걸 캐시 안으로 넣으면 그 구간 단가가 떨어진다 (**[추정]**, 프로바이더 가격 정책).

### 4-5. 측정 계획 제안

구현 전에 이걸 넣으면 이득을 실측할 수 있다. **[추정]** — 아직 없는 계측이다.

- `usage-v2.json` 스냅샷에 `cache_read_tokens`/`cache_write_tokens`가 이미 있으므로
  (`snapshot.cache_read_tokens`), 변경 전후로 같은 작업을 돌려 요청당 read/write/uncached를 비교.
- 더 정확히는 `gateway_json.zig`의 body 빌드 직후 `cacheControl` 마커 개수와 마커 앞 바이트 수를
  trace로 남기면 접두사 길이를 직접 잰다.

---

## 5. 질문 4 — 권장안과 근거

### 권장: 안 A (`prefix_cacheable` 래치 수정), 순서는 건드리지 않는다.

**근거**

1. **문제의 원인이 순서가 아니라 래치다.** §1-2에서 확인했듯 `findCacheBreakpoint`는 이미 history
   끝을 정확히 계산한다(시뮬레이션에서 idx 25). 계산은 맞는데 `prefix_cacheable`이 꺼서 버린다.
   순서를 바꾸는 건 래치를 우회하는 것이고, 래치를 고치는 건 원인을 고치는 것이다.

2. **변경 표면이 가장 작다.** `gateway_json.zig` 한 함수다. 조립 순서, vision 인덱스 산술,
   프롬프트 의미가 전부 그대로다. B는 `prompt_context.zig` + `orchestrator.zig` +
   `vision_contracts.zig` 확인까지 번지고, 매 요청 non-system 뒤 system이라는 새 배치를
   프로바이더에 상시 노출한다.

3. **깨지는 테스트가 1개고, 그 테스트는 어차피 다시 써야 한다.** `gateway_json.zig:1044`는
   "overlay 이후 전체에 cacheControl 없음"을 고정하는데, 이건 버그를 계약으로 굳힌 것이다.
   테스트 의도를 "overlay 자신은 캐시되지 않는다"로 좁히면 원래 의도는 지켜지고 래치는 풀린다.

4. **B의 이득 대비 추가 위험이 정당화되지 않는다.** B가 A보다 나은 유일한 지점은 "overlay가 매 턴
   바뀌어도 history 캐시가 안 깨진다"인데, §1-4에서 봤듯 overlay 조각 대부분(permission, sandbox,
   workspace access, noninteractive 안내)은 사실상 고정이다. 진짜 매 턴 바뀌는 건 tracked changes와
   background 목록이고, 이 둘은 **없는 세션이 많다**(`context.zig:2925`는 `tasks.len > 0`,
   `:2979`는 `stack.items.len > 0`일 때만 붙는다).

**단, A에는 조건부 후속이 붙는다.**

A를 넣고 §4-5의 계측으로 재봤을 때 cache_write가 크게 늘고 read가 안 늘면, overlay 변동이
실제로 잦다는 뜻이다. 그때 B로 넘어간다. 즉:

- **1단계 (A)**: 래치 수정 + `gateway_json.zig:1044` 테스트 의도 재작성 + 요청당 read/write 계측.
- **2단계 (조건부 B)**: 계측에서 overlay 변동이 잦다고 나오면 overlay를 history 뒤로 이동.
  이때 `prompt_context.zig:140`/`:172` 테스트를 다시 쓰고 vision 인덱스 산술을 맞춘다.

**추가 권고 (A/B 무관)**: overlay를 "고정 조각"과 "변동 조각"으로 쪼개서 고정분을
`stable_prefix`로 올리면 A의 리스크가 구조적으로 줄어든다. permission mode, sandbox,
noninteractive 안내는 턴 중에 바뀌지 않는다. 다만 permission mode는 `/permissions`로 세션 중
바뀔 수 있으므로 stable로 올리면 갱신 경로가 필요하다 — 별도 설계 대상이다. **[추정]**

---

## 6. 미확인으로 남긴 것

- 게이트웨이(Vercel AI Gateway)가 `prompt` 배열 중간의 system을 Anthropic Messages API로 어떻게
  변환하는지. `orchestrator.zig:7206`이 이미 그 형태를 내보내므로 거부되지는 않지만, 캐시 접두사
  계산에 어떤 영향을 주는지는 리포 밖 정보다.
- Anthropic 캐시 read/write 단가. §4-4의 1/10 계산은 공개 가격 정책 기억에 의존한 **[추정]**이다.
- overlay가 실제로 몇 %의 턴에서 변하는지. §5의 권장 근거 중 "대부분 고정"은 코드 조건
  (`tasks.len > 0` 등)에서 유도한 것이지 로그로 센 게 아니다.
- vision 경로 테스트 목록 전체. B/D를 택할 경우 `vision_contracts.zig` 관련 테스트를 따로 훑어야
  한다.
- `harness/fx/src/core/session/`과 `worker_runtime.zig`는 다른 세션이 수정 중이라 참고만 했다.
  §2의 `appendHistoryChatMessagesImpl` 인용(`session.zig:2791`)은 읽은 시점 기준이며 바뀔 수 있다.
