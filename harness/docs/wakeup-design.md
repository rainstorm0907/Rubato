# 깨우기(wakeup) 설계 — 서브에이전트 terminal 시 부모 턴 자동 개시

2026-08-21. 읽기 전용 조사. 소스는 수정하지 않았다. 체크아웃 커밋 `b7c0ad5` (`harness/fx`, 2026-08-21) 기준이며 줄 번호는 그 시점 값이다.

전제 정리부터. `team-overlay-v1.1-decisions.md:20`의 "리드 자동 재개는 채택하지 않는다"는 이전 세션 리드의 판단이 사용자 결정으로 기록된 것이고 2026-08-21 사용자가 무효화했다(`rubato-improvements-backlog.md:191`). 기능은 만든다. 다만 그 문장이 지목한 승인 경계 문제는 실재하므로 3절에서 별도로 답한다.

**결론 요약.** 알림은 "부모의 다음 턴"이 아니라 **부모의 다음 gateway step**마다 주입되고, 부모가 이미 턴을 돌고 있으면 그 턴 안에서 즉시 도착한다(1절). 남는 공백은 "부모가 완전히 idle일 때"뿐인데, **그 상태는 좁은 예외가 아니라 멀티에이전트 위임의 정상 상태다**(6절). 공백을 메우는 데 필요한 것은 대부분 이미 있다 — 사용자 없이 턴을 여는 프로덕션 경로(2절)와 읽기 전용 도구 정책 기계(3절) 둘 다 완성돼 있고 트리거만 없다. 권장안은 5절.

**개정 이력.** 초판(같은 날 앞선 시각)은 6절에서 이 기능의 값을 부정적으로 평가하고 기본 off를 권고했다. 리드가 반례를 제시해 결론을 뒤집었다. 사실 조사 부분(1·2절)은 초판 그대로이고, 3·5·6절과 4절 일부를 개정했다. 뒤집힌 경위는 6절에 남겼다.

---

## 1. 현재 알림 경로 — 코드 추적

### 1-1. 전체 경로

자식 terminal → 부모 프롬프트까지 다섯 단계다.

**(a) 자식이 terminal에 도달하면 durable ledger에 delivery가 append된다.**

```
harness/fx/src/core/subagent/communication_manager.zig:957
pub fn reconcileTerminalsLocked(
    alloc: Allocator,
    store: communication_store.Store,
    record: control_store.Record,
) Error!usize {
```

같은 함수 안:

```
harness/fx/src/core/subagent/communication_manager.zig:967
    for (record.queue) |work_item| {
        const terminal_state: domain.State = switch (work_item.status) {
            .completed => .completed,
            .failed => .failed,
            .cancelled => .cancelled,
            else => continue,
        };
```

```
harness/fx/src/core/subagent/communication_manager.zig:987
        const appended = communication.appendDelivery(alloc, &ledger, .{
            .id = &id,
            .source_id = record.child_id,
            .target_id = work_item.source_id,
            .work_id = work_item.id,
            .timestamp_ms = timestamp_ms,
            .payload = .{ .terminal = terminal_state },
        }) catch |err| return mapMutation(err);
```

주석이 계약을 밝힌다 (`:955`): "Rebuilds terminal projections from committed control transitions. Stable delivery IDs and event timestamps make retries/restarts exact-once."

**즉 이 지점까지는 즉시다.** 자식이 끝나면 그 사실은 곧바로 디스크에 남는다. 부모가 자든 말든 무관하다.

**(b) 부모 쪽 투영은 `parent_delivery_projector.prepare`가 한다.**

```
harness/fx/src/core/subagent/parent_delivery_projector.zig:20
pub const consumer_id = "parent-model";
```

```
harness/fx/src/core/subagent/parent_delivery_projector.zig:184
        var page = delivery_manager.prepareParentBoundaryPage(
            alloc,
            candidate.child_id,
            consumer_id,
            parent_session_id,
            .turn_boundary,
            null,
            child_limit,
        ) catch |err| switch (err) {
```

**(c) 그 함수는 agent runtime deps의 콜백으로 등록돼 있다.** 호스트 네 곳 전부에서:

- `harness/fx/src/core/app/app_callbacks.zig:281` — `.prepare_parent_turn_context = agentPrepareParentTurnContext,` (TUI)
- `harness/fx/src/core/cli/cli_ask.zig:1743` — `.prepare_parent_turn_context = prepareParentTurnContext,` (`fx ask`)
- `harness/fx/src/acp/prompt.zig:950` — 같은 필드 (ACP)
- `harness/fx/src/core/subagent/agent_adapter.zig:261` — 같은 필드 (자식이 자기 손자를 가질 때)

계약 선언은 여기다.

```
harness/fx/src/core/agent/runtime/deps.zig:198
    prepare_parent_turn_context: ?*const fn (ctx: *anyopaque, arena: Allocator) anyerror!?PreparedParentTurnContext = null,
    acknowledge_parent_turn_context: ?*const fn (ctx: *anyopaque, arena: Allocator, acknowledgements: []const ParentTurnDeliveryAck) void = null,
```

**(d) orchestrator가 그 콜백을 부른다.**

```
harness/fx/src/core/agent/runtime/orchestrator.zig:383
fn appendPreparedParentTurnContext(
    deps: *const AgentRuntimeDeps,
    arena: Allocator,
    messages: *std.ArrayList(ChatMessage),
) !ParentTurnDeliveryState {
    const prepare = deps.prepare_parent_turn_context orelse return .{};
    const prepared = try prepare(deps.ctx, arena) orelse return .{};
    if (prepared.content.len == 0) return .{};
    try messages.ensureUnusedCapacity(arena, 1);
    messages.appendAssumeCapacity(.{
        .role = .system,
        .content = prepared.content,
    });
    return .{ .acknowledgements = prepared.acknowledgements };
}
```

**(e) — 여기가 핵심 발견이다.** 호출 지점이 턴 시작이 아니라 **agent step 루프 안**이다.

```
harness/fx/src/core/agent/runtime/orchestrator.zig:2607
    var step: usize = 0;
    while (agent_steps.allowsStep(config.agent_step_limit, step)) : (step += 1) {
```

```
harness/fx/src/core/agent/runtime/orchestrator.zig:2624
        _ = overlay_arena_state.reset(.retain_capacity);
        const overlay_arena = overlay_arena_state.allocator();
        var ephemeral_overlay: std.ArrayList(ChatMessage) = .empty;
        if (config.explicit_skills_prompt_section.len > 0) {
            try ephemeral_overlay.append(overlay_arena, .{ .role = .system, .content = config.explicit_skills_prompt_section });
        }
        try deps.append_runtime_context(deps.ctx, overlay_arena, &ephemeral_overlay);
        var parent_turn_delivery = try appendPreparedParentTurnContext(
            deps,
            overlay_arena,
            &ephemeral_overlay,
        );
```

`while` 안이므로 **step마다 새로 투영된다.** 자식 결과는 부모의 다음 *턴*이 아니라 다음 *모델 호출*에 실린다.

**(f) ack는 delivery certainty 경계에서 일어난다.**

```
harness/fx/src/core/agent/runtime/orchestrator.zig:365
    fn observeGatewayDelivery(
        self: *ParentTurnDeliveryState,
        deps: *const AgentRuntimeDeps,
        arena: Allocator,
        delivery: runtime_gateway_step.DeliveryCertainty.State,
    ) void {
        if (self.acknowledged or
            self.acknowledgements.len == 0 or
            delivery == .definitely_unsent)
        {
            return;
        }
```

주석 (`:360`): "`possibly_sent` is the delivery-certainty boundary ... Definitely-unsent attempts stay pending so the next parent turn projects the same deliveries again." 즉 못 받은 delivery는 durable하게 남아 다음 기회에 다시 나온다. 유실은 없다.

### 1-2. 그래서 어디까지 즉시고 어디서 잠드나

| 부모 상태 | 자식 terminal 결과 도착 시점 | 대기 여부 |
|---|---|---|
| 턴 실행 중 (step 루프 안) | 다음 step의 gateway 호출 | **즉시** — 대기 없음 |
| 턴 종료 직후, 사용자 입력 대기 | 사용자가 다음 프롬프트를 보낼 때 | **잠듦** |
| 완전 idle (사용자 부재) | 무기한 | **잠듦** |

**[확인된 사실]** 코드상 대기가 발생하는 유일한 지점은 `while (agent_steps.allowsStep(...))` 루프 밖, 즉 부모에게 실행 중인 잡이 없을 때다. 백로그가 쓴 "부모의 다음 턴에 실려 들어온다"는 부정확하다 — 정확히는 "부모의 다음 gateway step"이고, 부모가 돌고 있으면 그건 몇 초 안이다.

**[확인된 사실]** `dispatchAttentionRequired`는 서브에이전트 terminal에 대해 호출되지 않는다. 프로덕션 호출부는 두 곳뿐이다:

```
harness/fx/src/core/app/app_worker_runtime.zig:473
            if (!was_approval_active and app.approval_prompt.isActive()) {
                if (comptime @hasDecl(App, "dispatchAttentionRequired")) {
                    app.dispatchAttentionRequired(snapshot.active_turn_id, .permission);
                }
            }
```

```
harness/fx/src/core/app/app_worker_runtime.zig:774
                            if (!was_active and app.question_prompt.isActive()) {
                                app.shell.render_requests.request(.modal);
                                if (comptime @hasDecl(App, "dispatchAttentionRequired")) {
                                    app.dispatchAttentionRequired(
                                        app.worker.activeTurnId(),
```

권한 대기와 질문 대기뿐이다.

**[확인된 사실]** `AttentionKind`에 `team_message`가 이미 추가돼 있다.

```
harness/fx/src/core/hooks/definitions.zig:201
pub const AttentionKind = enum {
    permission,
    question,
    route_recovery,
    team_message,
};
```

하지만 실제 dispatch 호출부는 없다. 문자열 매핑만 있다:

```
harness/fx/src/builtins/hooks.zig:71
                .team_message => "team_message",
```

즉 결정 1이 채택한 "알림으로 사용자를 부른다" 쪽도 enum까지만 들어갔고 배선은 안 됐다. **[추정]** Team Overlay 구현 중 자리만 잡아두고 호출부는 후속으로 미룬 상태로 보인다 — 이 판단은 커밋 히스토리를 안 봤으므로 추정이다.

---

## 2. 사용자 입력 없이 턴을 여는 기존 경로

**있다. 하나다.** `queueRecoveryCheckpoint`.

```
harness/fx/src/main.zig:1227
    pub fn queueRecoveryCheckpoint(
        self: *App,
        checkpoint: *const session_codec.RecoveryCheckpoint,
    ) !bool {
        if (!try self.snapshotAndQueuePrompt(
            checkpoint.user.text,
            &.{},
            null,
            checkpoint,
        )) return false;
        WorkerAppRuntime.syncState(
            self,
            app_callbacks.Bindings(App).worker_tool_lifecycle_presenter(self),
        );
        return true;
    }
```

`snapshotAndQueuePrompt`는 일반 사용자 프롬프트와 **같은 함수**다.

```
harness/fx/src/main.zig:1244
    fn snapshotAndQueuePrompt(
        self: *App,
        prompt: []const u8,
        skill_tokens: []const registered_entities.SkillTokenSpan,
        review_draft: ?worker_runtime.QueueReviewDraft,
        recovery_checkpoint: ?*const session_codec.RecoveryCheckpoint,
    ) !bool {
```

일반 경로(`enqueuePromptWithOptionalReview`, `main.zig:1051`)도 같은 함수를 `recovery_checkpoint = null`로 부른다(`main.zig:1076`). 즉 **턴 개시 메커니즘은 이미 프롬프트 텍스트를 인자로 받는 일반 함수이고, 사용자 키 입력에 묶여 있지 않다.**

### 2-1. 그런데 이 경로도 사용자가 시작한다

```
harness/fx/src/core/app/app_session_runtime.zig:2496
        pub fn continuePausedRecovery(app: *App) !bool {
            var checkpoint = (try snapshotRecoveryCheckpoint(
                app,
                std.heap.c_allocator,
            )) orelse return false;
            defer checkpoint.deinit(std.heap.c_allocator);

            app.session.setConversationLanguageFromUserMessage(checkpoint.user.text);
            return app.queueRecoveryCheckpoint(&checkpoint);
        }
```

유일한 프로덕션 호출부는 `/continue` 슬래시 명령이다.

```
harness/fx/src/core/app/app_commands.zig:522
        fn commandContinueRecovery(ctx: *anyopaque) !void {
            const app: *App = @ptrCast(@alignCast(ctx));
            const queued = app.continuePausedRecovery() catch |err| switch (err) {
```

`grep -rn "continuePausedRecovery\|queueRecoveryCheckpoint" src/`가 프로덕션에서 잡는 건 이 세 줄(`app_session_runtime.zig:2504`, `app_commands.zig:524`, `main.zig:1224`)뿐이고 나머지는 테스트다. 사용자에게 보여주는 안내 문구도 명시적으로 `/continue`를 요구한다:

```
harness/fx/src/core/app/app_session_runtime.zig:3674
                    "model response recovery is paused at attempt {d}/{d}; run /continue to resume the preserved turn",
```

**판정: 재사용 가능하다.** 필요한 건 새 턴 개시 메커니즘이 아니라 **새 트리거**다. `snapshotAndQueuePrompt`는 이미 "임의의 텍스트로 턴을 연다"를 하고 있고, 승인 경계 논점은 "누가 그 함수를 부르느냐"로 좁혀진다. 이건 이 기능의 난이도를 크게 낮춘다.

### 2-2. 훅을 걸 자리

`loopCollectFacts`가 idle에서도 도는 이벤트 루프다.

```
harness/fx/src/main.zig:2447
    pub fn loopCollectFacts(ctx: *anyopaque) !void {
```

이 함수 안에 이미 폴링형 fact 수집이 여러 개 있다 — `collectUpgradeFacts` (`:2466`), `pollLoadTransition` (`:2470`), `collectMcpReloadFacts` (`:2473`), `pollSessionPicker` (`:2519`), 그리고 `processNextCooperativePrompt` (`:2481`). 깨우기 판정도 같은 자리에 들어간다. **런루프의 구조를 바꿀 필요는 없고 fact 수집 하나가 추가되는 형태다.**

### 2-3. 잡에 권한이 실린다

```
harness/fx/src/core/agent/worker_runtime.zig:57
pub const QueuedPrompt = struct {
    turn_id: u64 = 0,
    prompt: []u8,
    images: []types.ImageAttachment,
    authorized_image_catalog: []types.ImageAttachment = &.{},
    model: []u8,
    api_key: []u8,
    gateway_team: ?[]u8 = null,
    credential_source: ?types.CredentialSource = null,
    permission_mode: types.PermissionMode,
    sandbox_backend: sandbox.BackendKind = .none,
```

`permission_mode`와 `sandbox_backend`가 **잡별 필드**다. 세션 전역이 아니다. 즉 "이 턴만 제한 권한"이 구조적으로 가능하다. 3절 A안의 근거다.

`ToolChoice`에 `none`도 있다.

```
harness/fx/src/core/shared/types.zig:1546
pub const ToolChoice = enum {
    auto,
    none,
```

다만 이건 **첫 호출에만** 적용되고 그 뒤 리셋된다.

```
harness/fx/src/core/agent/runtime/orchestrator.zig:2853
            else if (configured_first_tool_choice_pending and vision_mode != .required)
                config.first_call_tool_choice
```

```
harness/fx/src/core/agent/runtime/orchestrator.zig:3839
            if (vision_mode != .required) configured_first_tool_choice_pending = false;
```

3절 B안(도구 없이 수집만)이 `first_call_tool_choice = .none`만으로는 안 되는 이유다. 2번째 step부터 `.auto`로 풀린다.

---

## 3. 승인 경계 해소안

### 문제 진술

결정 1의 우려를 코드로 옮기면 이렇다. `snapshotAndQueuePrompt`가 만드는 잡은 `permission_mode`를 세션 현재값에서 스냅샷한다.

```
harness/fx/src/core/agent/worker_runtime.zig:1175
            prompt.permission_mode = snapshot.mode;
```

사용자가 `auto`나 `yolo`로 돌고 있으면 — rubato는 실제로 yolo다 — 깨어난 턴은 그 권한 그대로 파일을 쓰고 명령을 돌린다. 사용자는 자리에 없다. `ask` 모드면 승인 프롬프트가 뜨고 `dispatchAttentionRequired`가 사용자를 부르지만(`app_worker_runtime.zig:475`), 아무도 없으면 그대로 멈춰 있다.

핵심은 이거다: **깨우기 자체가 위험한 게 아니라, 깨어난 턴이 사용자가 승인한 적 없는 부작용을 낼 수 있다는 게 위험하다.** 부작용이 구조적으로 불가능하면 승인 경계 문제는 소멸한다.

### A안 — 제한 권한 턴

깨어난 잡을 `permission_mode = .ask`, `sandbox_backend`는 세션값 유지로 큐잉한다. 도구를 부르면 승인 프롬프트가 뜨고, 사용자가 없으면 거기서 멈춘다.

- 근거: `QueuedPrompt.permission_mode`가 잡별 필드다(`worker_runtime.zig:66`).
- 장점: 새 개념이 없다. 기존 승인 UI가 그대로 게이트다.
- 단점: **멈춘 자리가 지저분하다.** 부분 실행된 턴이 남고, 사용자는 돌아와서 승인 프롬프트부터 마주친다. 그리고 깨우기의 목적("결과를 받아둔다")을 못 이룰 수 있다 — 모델이 결과를 요약하기 전에 도구를 부르면 거기서 정지다.
- **[추정]** `ask`로 강등된 턴에서 사용자가 없을 때 승인 프롬프트가 무기한 살아 있는지, 타임아웃이 있는지는 확인하지 않았다. 착수 전 `app_permission_runtime.Runtime(App).tick` (`main.zig:2460`)을 확인해야 한다.

### B안 — 부작용 없는 수집 턴

깨어난 턴은 **도구 호출이 구조적으로 불가능한 턴**으로 돌린다. 모델은 자식 결과를 읽고 요약만 남기고 끝난다.

구현 방식은 두 갈래인데 어느 쪽이든 새 필드 하나가 필요하다.

**(i) 도구 목록을 비운 채로 조립.** 잡에 `wakeup: bool` 같은 표시를 두고, orchestrator가 그 턴에서는 advertised tool 목록을 빈 슬라이스로 만든다. 모델에게 도구가 아예 안 보인다.

**(ii) step 상한 1 + tool_choice none.** `config.agent_step_limit`을 1로 두고 `first_call_tool_choice = .none`을 건다. 첫 호출에만 적용되는 제약(`orchestrator.zig:3839`)이 step이 하나뿐이면 문제가 안 된다.

- 장점: **승인 경계 문제가 소멸한다.** 부작용을 낼 방법이 없으므로 "승인 안 받은 도구 호출"이 정의상 불가능하다. 사용자가 돌아왔을 때 히스토리에는 "자식 A가 이렇게 끝났고 요약은 이렇다"만 남아 있다.
- 장점: 깨우기의 실제 목적과 정확히 맞는다. 목적은 "부모가 일을 계속하는 것"이 아니라 "결과가 잠들지 않는 것"이다.
- 단점: 부모가 후속 작업을 자동으로 이어가진 못한다. 그건 사용자가 돌아와서 시작한다.
- 단점: 새 필드가 orchestrator 계약에 하나 늘어난다.

**[추정]** (ii)가 (i)보다 손대는 곳이 적어 보이지만, `agent_step_limit`을 잡 단위로 덮어쓰는 경로가 지금 있는지는 확인하지 않았다. 착수 시 `runtime/config.zig:41` 주변과 `AgentTurnSettings`(`worker_runtime.zig:74`)를 봐야 한다.

**B안의 한계 — 리드 반례에서 드러남.** 6절의 사례에서 리드가 깨어나 실제로 한 일은 자식 텍스트를 읽는 것만이 아니었다. 산출물 파일을 직접 열고, 자식이 인용한 코드를 확인해 주장이 맞는지 검증했다. 수집 전용 턴이었으면 그중 아무것도 못 했다. 자식 보고를 그대로 믿고 요약했을 것이고, 그건 리드가 하는 일의 핵심(통합 전 검증)을 빼먹는 것이다. B안은 안전하지만 실제 필요를 못 채운다.

### B2안 — 읽기 허용 턴 (신규, 권장)

깨어난 턴에 **읽기 전용 도구만** 준다. 파일 읽기·grep·glob·목록·자식 inspect는 되고, 파일 편집·terminal·자식 생성은 안 된다.

승인 경계 논리는 B안과 동일하게 성립한다. 읽기는 사용자가 승인한 적 없는 **부작용을 만들지 않는다.** 워크스페이스 상태가 바뀌지 않고, 프로세스가 뜨지 않고, 외부에 나가는 것이 없다. 사용자가 돌아왔을 때 달라진 것은 히스토리에 검증된 요약이 하나 늘어난 것뿐이다.

**핵심 발견 — 이 기계는 이미 완성돼 있다.** 새로 만들 것이 거의 없다.

읽기 전용 도구 분류가 상수로 있다.

```
harness/fx/src/builtins/tools.zig:1714
pub const read_only_tool_names = [_][]const u8{
    "read_file",
    "glob_files",
    "grep_files",
    "list_files",
};

pub fn isReadOnlyToolName(name: []const u8) bool {
    for (read_only_tool_names) |tool_name| {
        if (std.mem.eql(u8, tool_name, name)) return true;
    }
    return false;
}
```

`ToolSet` 계약에 그 목록 자리가 있다.

```
harness/fx/src/core/tooling/tool_set.zig:4
pub const ToolSet = struct {
    registry: tool_dispatch.Registry,
    order: []const []const u8,
    read_only_tool_names: []const []const u8,
};
```

투영 빌더가 두 종류를 이미 만든다.

```
harness/fx/src/core/tooling/tool_advertisement.zig:794
pub fn buildGatewayToolProjectionForSet(alloc: Allocator, tool_set: tool_set_contract.ToolSet, options: Options) !EffectiveToolProjection {
    return buildToolProjection(alloc, tool_set, .full, options);
}

pub fn buildReadOnlyGatewayToolProjectionForSet(alloc: Allocator, tool_set: tool_set_contract.ToolSet, options: Options) !EffectiveToolProjection {
    return buildToolProjection(alloc, tool_set, .read_only, options);
}
```

`.read_only`일 때 광고에서 제외되는 규칙도 들어 있다 — 정규 목록에 없는 동적 도구는 아예 안 붙는다.

```
harness/fx/src/core/tooling/tool_advertisement.zig:817
    if (kind == .full) {
        for (tool_set.registry.tools) |tool| {
            if (isCanonicalToolName(tool_set, tool.name)) continue;
            try writeBuiltinTool(alloc, &tools_out.writer, &guidance_out.writer, &first, &first_custom_guidance, tool, kind, tool_set, options);
        }
    }
```

그리고 **광고 필터만이 아니라 실행 차단도 있다.** 이중 방어다.

```
harness/fx/src/core/modes/mode_registry.zig:37
    pub fn toolAllowed(
        self: Registry,
        tool_set: tool_set_contract.ToolSet,
        id: []const u8,
        tool_name: []const u8,
    ) bool {
        if (tool_set.registry.lookup(tool_name) == null) return true;
        const mode = self.lookup(id) orelse return true;
        return switch (mode.tool_policy) {
            .full => true,
            .read_only => nameInSet(tool_set.read_only_tool_names, tool_name),
        };
    }
```

거부 사유 JSON까지 준비돼 있다.

```
harness/fx/src/core/modes/mode_registry.zig:51
    pub fn toolPolicyDeniedJson(
        self: Registry,
        alloc: std.mem.Allocator,
        tool_set: tool_set_contract.ToolSet,
        id: []const u8,
        tool_name: []const u8,
    ) !?[]u8 {
        if (self.toolAllowed(tool_set, id, tool_name)) return null;
```

authority 캡처에도 모드 정책이 실린다.

```
harness/fx/src/core/subagent/tool_host.zig:2153
pub const ModePolicy = union(enum) {
    full,
    active: struct {
        registry: mode_registry.Registry,
        id: []const u8,
    },

    fn allows(self: ModePolicy, tool_set: tool_set_contract.ToolSet, tool_name: []const u8) bool {
        return switch (self) {
            .full => true,
            .active => |active| active.registry.toolAllowed(tool_set, active.id, tool_name),
        };
    }
};
```

**그런데 아무도 안 쓴다.** 내장 모드 둘 다 `tool_policy`가 기본값 `.full`이다.

```
harness/fx/src/builtins/modes.zig:12
pub const all = [_]ModeSpec{
    .{ .id = "code", .name = "Code", .description = "Write and modify code with full tool access", .permission_mode = .auto },
    .{ .id = "ask", .name = "Ask", .description = "Request permission before making any changes", .permission_mode = .ask },
};
```

테스트가 그걸 못 박는다.

```
harness/fx/src/builtins/modes.zig:37
    try std.testing.expectEqual(ToolPolicy.full, lookup("code").?.tool_policy);
    try std.testing.expectEqual(ToolPolicy.full, lookup("ask").?.tool_policy);
```

그리고 TUI 호스트는 모드 레지스트리를 아예 안 거치고 `.full`을 하드코딩한다.

```
harness/fx/src/core/app/app_session_runtime.zig:4669
            return subagent_tool_host.captureHostAuthorityWithMcpView(
                alloc,
                .{
                    .tool_set = app.toolAdvertisementSet(),
                    .mode = .full,
                },
```

TUI의 gateway 투영도 `mode_registry`를 우회한다.

```
harness/fx/src/main.zig:1517
    fn snapshotGatewayToolProjectionForRules(
        self: *App,
        alloc: Allocator,
        permission_mode: types.PermissionMode,
        permission_rules: types.PermissionRuleSet,
    ) !tool_advertisement.EffectiveToolProjection {
        return app_mcp_runtime.buildGatewayToolProjection(&self.mcp, alloc, self.toolAdvertisementSet(), .{
```

모드 경유는 ACP(`acp/prompt.zig:514`, `:1153`)와 `fx ask`(`cli_ask.zig:1506`, `:1947`)에만 배선돼 있다.

**정리.** 읽기 허용 모드에 필요한 **판정 로직·광고 필터·실행 차단·거부 메시지가 전부 이미 있고 테스트도 있다.** 없는 것은 (a) `tool_policy = .read_only`인 모드 정의 하나와 (b) TUI 잡 경로가 그 모드를 탈 수 있게 하는 배선이다. `.read_only`는 만들다 만 기능이 아니라 **완성된 뒤 소비자만 없는 기능**이다.

- 장점: 깨어난 턴이 산출물을 실제로 검증한다. 리드가 사람 대신 하는 일의 핵심을 유지한다.
- 장점: 승인 경계가 B안과 같은 강도로 지켜진다. 부작용이 정의상 불가능하다.
- 장점: **신규 코드가 B안보다도 적을 가능성이 높다.** B안은 orchestrator에 새 분기를 넣어야 하지만, B2안은 기존 모드 정책을 켜는 쪽이다.
- 단점: TUI 배선이 필요하다. `.mode = .full` 하드코딩(`app_session_runtime.zig:4673`)과 `snapshotGatewayToolProjectionForRules`(`main.zig:1517`) 두 곳을 모드 인지형으로 바꿔야 한다. **[추정]** 이 둘이 TUI에서 모드가 미배선인 유일한 지점인지는 전수 확인하지 않았다.
- 단점: `read_only_tool_names`에 자식 조회 도구가 없다. 목록은 `read_file`/`glob_files`/`grep_files`/`list_files` 넷뿐이고 `subagent`(inspect)는 빠져 있다. 깨어난 턴이 자식 상태를 더 파려면 이 목록을 늘려야 하는데, **그 목록은 다른 소비자(ACP·`fx ask`의 read-only 모드)와 공유된다.** 늘리면 그쪽 의미도 같이 바뀐다. 서브에이전트 host는 자체 목록을 따로 갖고 있어(`tool_host.zig:2274`의 `.{ "inspect", "list_files" }`) 선례는 있다 — 깨우기 전용 `ToolSet`을 별도로 조립하는 쪽이 안전하다.

### C안 — 명시적 대기 선언이 있을 때만

사용자가 `/wait` 같은 걸로 "나 이거 기다린다"를 선언한 세션에서만 깨운다.

- 장점: 승인이 문자 그대로 사용자에게서 나온다. 결정 1의 우려에 가장 정직한 답이다.
- 단점: 사용자가 선언을 잊으면 기능이 없는 것과 같다. 그리고 애초의 불편(자리를 비운 사이 결과가 잠듦)은 "비우기 전에 선언"을 요구하는데, 자리를 비울 걸 미리 아는 경우에만 작동한다.
- 단점: 새 슬래시 명령과 그 상태의 durable 저장이 필요하다. 결정 4가 세운 "저장할 상태를 만들지 않는다" 원칙과 마찰한다.

### D안 — 설정 키 (기본 on)

`settings.json`에 `wakeup.enabled` 같은 걸 두되 **기본값은 on**이다. 끄고 싶은 사람이 끌 수 있게 키만 남긴다.

- 근거: `notifications.attention_required`가 이미 같은 자리에 있다(`config_runtime.zig:1432`).
- 이건 A~B2·C와 배타적이지 않다. **직교하는 축**이다. 어느 안을 골라도 설정 게이트는 얹을 수 있다.
- **기본 on인 이유는 6절에 있다.** 이건 값을 증명해야 하는 신기능이 아니라 빠져 있는 기본 기능이다. 기본 off로 넣으면 대부분의 사용자에게 없는 것과 같고, 그러면 위임이 절반만 작동하는 상태가 그대로 남는다.

### 비교

| | 부작용 가능? | 산출물 검증 가능? | 사용자 승인 근거 | 새 코드 | 결정 1 우려 |
|---|---|---|---|---|---|
| A 제한 권한 | 가능 (승인 시) | 가능 | 기존 승인 UI | 없음 | 완화 |
| B 수집 전용 | **불가능** | **불가능** | 불필요 (부작용 없음) | orchestrator 분기 | **소멸** |
| B2 읽기 허용 | **불가능** | **가능** | 불필요 (부작용 없음) | 모드 정의 + TUI 배선 | **소멸** |
| C 명시 선언 | 가능 | 가능 | 사용자 선언 | durable 상태 | 소멸 |
| D 설정 키 | 안에 따름 | 안에 따름 | 설정 | settings 키 1개 | 완화 |

B와 B2는 승인 경계에 대해 **같은 강도**다. 둘 다 부작용이 정의상 불가능하다. 차이는 깨어난 턴이 쓸모 있는 일을 하느냐뿐이고, 그 점에서 B2가 B를 지배한다.

---

## 4. 구현 범위 추정

B2안 + D 기준이다. **[추정]** — 실제 착수 시 늘어날 수 있다.

**반드시 건드리는 곳**

1. `src/core/agent/worker_runtime.zig` — `QueuedPrompt`에 깨우기 표시 필드 하나(모드 id 또는 `wakeup: bool`). **주의: 이 파일은 rewind 구현 세션이 지금 수정 중이다(2026-08-21 확인, 확인 시점 5분 전에도 쓰기 있었음). 충돌 조율이 필요하고, 착수 순서상 rewind 뒤로 두는 편이 안전하다.**
2. `src/builtins/modes.zig:12` — `tool_policy = .read_only`인 모드 정의 추가. 지금 `all`에는 `code`/`ask` 둘뿐이고 **둘 다 `.full`이다**(`:37` 테스트가 못 박고 있다). 사용자에게 노출되는 모드로 넣을지 내부 전용으로 둘지는 결정 필요.
3. `src/core/app/app_session_runtime.zig:4673` — `.mode = .full` 하드코딩을 모드 인지형으로. 깨우기 턴일 때만 `.active`로 간다.
4. `src/main.zig:1517` `snapshotGatewayToolProjectionForRules` — `app_mcp_runtime.buildGatewayToolProjection`(full 고정)을 부르는데, 깨우기 턴에서는 `mode_registry.buildGatewayToolProjection`을 타야 한다. ACP(`acp/prompt.zig:514`)와 `fx ask`(`cli_ask.zig:1506`)가 이미 그렇게 하고 있으므로 그 형태를 따르면 된다.
5. `src/main.zig` — `queueRecoveryCheckpoint`(`:1227`) 옆에 `queueWakeupTurn` 형제 함수. `snapshotAndQueuePrompt`(`:1244`)가 깨우기 표시를 잡에 싣도록.
6. `src/main.zig:2447` `loopCollectFacts` — 깨우기 판정 fact 수집 한 줄 추가. **런루프 구조는 안 바꾼다.**
7. 깨우기 판정 로직 자체 — 새 파일이거나 `app_session_runtime.zig`의 얇은 함수. "미수령 terminal delivery가 있고, 워커가 idle이고, 마지막 깨우기 이후 새 delivery가 있는가". `parent_delivery_projector.prepare`를 그대로 쓸 수 있는지가 갈림길인데, 그 함수는 호출 자체가 delivery를 소비 대상으로 표시하므로 **판정용 별도 peek 경로가 필요할 가능성이 높다**. `prepareParentBoundaryPage`(`parent_delivery_projector.zig:184`)의 `.turn_boundary` 인자 옆에 다른 모드가 있는지 확인해야 한다. **[미확인]**
8. `src/core/config/config_runtime.zig:1426` 주변 — 설정 키 파싱. 기본 on.

**아마 건드리는 곳**

9. 깨우기 전용 `ToolSet` 조립 — `read_only_tool_names`(`tools.zig:1714`)는 파일 도구 넷뿐이라 자식 조회(`subagent` inspect)가 빠져 있다. 공유 상수를 늘리면 ACP·`fx ask`의 read-only 의미도 같이 바뀌므로, 서브에이전트 host가 자체 목록을 갖는 선례(`tool_host.zig:2274`)를 따라 별도 조립하는 쪽이 안전하다.
10. `src/core/hooks/definitions.zig:201` — `AttentionKind`에 `subagent_terminal` 추가. 깨우기와 별개로 "알림만" 경로도 필요하면.
11. `src/builtins/hooks.zig:71` — 위 문자열 매핑.
12. `tests/e2e/` — `notifications.test.ts` 패턴을 따르는 tmux 테스트. 결정 1의 검증 절이 이미 이 패턴을 지목했다(`team-overlay-v1.1-decisions.md:22`). 여기에 더해 **읽기 허용 턴이 쓰기 도구를 실제로 거부하는지**를 고정하는 테스트가 필요하다 — `mode_registry.toolAllowed`에 이미 단위 테스트가 있으므로 그 위에 얹는다.

**런루프를 손대야 하는가: 아니다.** `loopCollectFacts`가 이미 폴링형 fact 수집을 여러 개 담고 있고(`collectUpgradeFacts` `:2466`, `pollLoadTransition` `:2470`, `collectMcpReloadFacts` `:2473`, `pollSessionPicker` `:2519`), 깨우기 판정은 그중 하나로 들어간다. 새 스레드도, 새 타이머도 필요 없다.

**규모 감각.** 코어 변경은 7~9개 파일, 각각 수 줄에서 수십 줄. 실질 신규 코드는 판정 로직(7번) 하나다. 도구 정책 기계는 3절에서 확인했듯 이미 완성돼 있어 **켜는 배선**만 한다. rewind(세션 커밋 경로를 건드림)보다 작다.

**착수 순서.** rewind가 `worker_runtime.zig`를 놓은 뒤에 시작한다. 1번이 그 파일이고, 나머지(2~4번 모드 배선)는 rewind와 파일이 겹치지 않아 먼저 해도 된다.

---

## 5. 권장안

**B2안 읽기 허용 턴 + D 설정 키(기본 on).**

근거 넷.

**하나 — 승인 경계 문제를 완화가 아니라 소멸시킨다.** A안과 C안은 "위험한 일이 일어날 수 있지만 게이트가 있다"이고, B2안은 "위험한 일이 일어날 방법이 없다"다. 읽기는 워크스페이스를 바꾸지 않고 프로세스를 띄우지 않는다. 결정 4가 team state에 적용한 논리와 같다 — 규율이 아니라 구조로 달성한다(`team-overlay-v1.1-decisions.md:59`). 이 레포가 반복해서 택해온 방식이다.

**둘 — 깨어난 턴이 실제로 쓸모 있는 일을 한다.** 6절 사례에서 리드가 한 일은 자식 텍스트 요약이 아니라 산출물 검증이었다. B안(수집 전용)은 그걸 못 한다. 자식 보고를 그대로 받아적는 요약은 리드의 통합 판단을 흉내만 낸 것이고, 사용자는 돌아와서 어차피 다시 검증해야 한다. B2안은 사용자가 돌아왔을 때 **검증까지 끝난 상태**를 만든다.

**셋 — 기계가 이미 있다.** 3절에서 확인했듯 읽기 전용 분류(`tools.zig:1714`), 광고 필터(`tool_advertisement.zig:798`), 실행 차단(`mode_registry.zig:37`), 거부 메시지(`:51`), authority 정책(`tool_host.zig:2153`)이 전부 구현돼 있고 테스트도 있다. 없는 건 `tool_policy = .read_only`인 모드 정의 하나와 TUI 배선 두 곳이다. **B안보다 신규 코드가 적을 가능성이 높다** — B안은 orchestrator에 새 분기를 넣지만 B2안은 있는 정책을 켠다.

**넷 — 기존 경로 재사용 비율이 높다.** 턴 개시는 `snapshotAndQueuePrompt`(`main.zig:1244`), 훅 자리는 `loopCollectFacts`(`main.zig:2447`), 설정은 `notifications` 옆(`config_runtime.zig:1426`). 새로 만드는 건 깨우기 판정 로직 하나다.

**D를 기본 on으로 두는 이유.** 6절이 밝히듯 이건 값을 증명해야 하는 신기능이 아니라 주요 하네스에 이미 있는 기본 기능이다. 기본 off면 대부분의 사용자에게 없는 것과 같고, 위임이 절반만 작동하는 상태가 유지된다. 키를 남기는 건 끄고 싶은 사람을 위해서지 기본값을 유보하기 위해서가 아니다.

**착수 시 B안을 완전히 버리지는 마라.** B2안의 TUI 배선(`app_session_runtime.zig:4673`, `main.zig:1517`)이 예상보다 크면, B안으로 먼저 내보내고 B2로 올리는 단계 분할이 가능하다. 둘은 승인 경계 논리가 같아서 나중에 올려도 안전성 재검토가 필요 없다.

---

## 6. 이 기능에 값이 있는가 — 판단이 한 번 뒤집혔다

이 절은 초판의 판단과 그것이 뒤집힌 경위를 둘 다 남긴다. 어떻게 틀렸는지가 기록으로 가치가 있다.

### 6-1. 초판의 판단 (부정적)

초판은 이렇게 결론냈다. 요지 그대로 옮긴다.

> 계기가 된 불편은 이 기능과 무관하다. 60초 wait 세 번은 도구 사용 실수였다(`rubato-improvements-backlog.md:15`, `:195`). 부모가 턴을 돌고 있으면 자식 결과는 이미 step마다 즉시 도착하므로, wait을 길게 한 번 거는 것만으로 그 자리에서 받는다.
>
> 남는 공백은 "부모 idle + 사용자 이석" 하나뿐이고 이건 **좁은 시나리오**다. 그 시나리오에서도 이득은 "돌아왔을 때 턴 하나를 아낀다" 정도이고, 손해 가능성(쓸모없는 자동 요약 턴이 히스토리에 쌓임)은 실재한다. 그래서 만들되 기본 off로 두고, 값이 확인되면 기본값을 바꾼다.

**이 중 사실 조사는 전부 맞고 그대로 유지한다.** 60초 wait이 도구 사용 실수였던 것도, 부모가 일하는 중이면 step마다 이미 온다는 것도 코드로 확인된 사실이다(1절).

**틀린 것은 그 사실에서 도출한 결론이다.**

### 6-2. 리드가 제시한 반례

문서 초판을 쓰는 동안 리드 세션이 자식 셋을 띄우고 idle로 앉아 있었다. 셋 중 둘이 완료됐다. 사용자는 자리를 비웠다가 돌아와 "결과 회수 좀 해보자"라고 말했고, 그제서야 리드가 깨어나 결과를 읽었다.

**즉 초판이 "좁은 시나리오 하나"라고 평가한 그 상황이, 이 과제를 수행하는 그 시간에 실제로 발생했고 실제로 손실을 냈다.**

손실의 성격이 초판의 추정과 달랐다. 초판은 "턴 하나를 아끼는" 문제로 봤는데, 실제로는 사용자가 이미 목표를 준 상태("셋 다 조사해라")에서 **실행이 사람의 물리적 복귀 시각에 묶였다.** 자식 둘이 끝난 시점부터 사용자가 돌아온 시점까지, 할 수 있는 일이 있는데 아무 일도 일어나지 않았다.

### 6-3. 초판이 놓친 것

**하나 — "부모 idle + 사용자 이석"은 예외가 아니라 위임의 정상 상태다.**

초판은 이 상태를 드문 경우로 분류했다. 거꾸로다. **자식에게 일을 맡기는 이유가 바로 그동안 다른 걸 하거나 자리를 비우기 위해서다.** 위임이 성공할수록 이 상태에 더 자주, 더 오래 들어간다. 위임을 쓰지 않는 세션에서만 드문 상태다.

그러면 논리가 이렇게 된다. 사용자가 목표를 이미 줬는데 실행이 사람의 복귀에 묶인다면, 그건 아낄 수 있는 턴 하나의 문제가 아니라 **위임 자체가 절반만 작동한다**는 뜻이다. 일을 맡기는 것까지는 되는데 결과를 받는 데 사람이 필요하다면, 위임의 비동기성이 반쪽이다.

**둘 — 이건 신기능이 아니라 빠져 있는 기본 기능이다.**

사용자에 따르면 메인 세션 깨우기는 Claude Code를 비롯한 주요 하네스에 기본 탑재돼 있다. fx에 없는 쪽이 특이하다. 초판은 이 항목을 "값을 증명해야 하는 후보"로 다뤘는데, 분류가 틀렸다. **재분류: 빠져 있는 기본 기능.**

이 재분류가 기본값 결정을 바꾼다. 신기능이면 기본 off로 넣고 값을 관찰하는 게 맞다. 기본 기능이면 기본 on이고, 끄고 싶은 사람에게 키를 주는 게 맞다.

**셋 — 손해 추정도 과장이었다.**

초판은 "쓸모없는 자동 요약 턴이 쌓인다"를 손해로 들었다. 그런데 그 우려는 B안(수집 전용, 자식 텍스트만 요약)을 전제로 한 것이다. B2안(읽기 허용)에서 깨어난 턴은 산출물을 실제로 열어 검증한다. 리드가 사람 대신 하는 일과 같은 일을 한다. 그 결과물이 쓰레기일 확률은 초판이 가정한 것보다 낮다.

다만 **[추정]** 자동 요약의 품질 문제 자체가 사라진 건 아니다. 사용자 의도가 없는 상태에서의 검증은 사용자가 알고 싶은 각도와 어긋날 수 있다. 이건 써봐야 안다.

### 6-4. 개정된 판단

**값이 있다. 그리고 좁지 않다.**

- 위임을 쓰는 세션의 정상 상태에서 작동한다.
- 사용자가 이미 준 목표의 실행이 사람의 복귀에 묶이는 것을 푼다.
- 주요 하네스에 있는 기본 기능이고 fx에 없는 것이 결손이다.

**여전히 값이 없는 경우도 그대로 맞다:** 사용자가 자리에 있으면 무의미하고, 부모가 일하는 중이면 이미 step마다 온다. 이 두 사실은 1절 조사 결과이고 바뀌지 않는다. 다만 이건 "기능이 불필요하다"가 아니라 "기능이 작동하는 조건이 idle일 때"라는 뜻일 뿐이다.

**초판 대비 바뀐 권고:** 기본 off → **기본 on**. 수집 전용(B) → **읽기 허용(B2)**.

---

## 부록 — 미확인 항목

착수 전에 닫아야 하는 것들.

**이번 개정에서 닫힌 것**

- ~~읽기 전용 도구 분류가 이미 있는지~~ → **있다.** `tools.zig:1714` `read_only_tool_names`, `tool_set.zig:7` 계약 필드, `tool_advertisement.zig:798` 투영 빌더, `mode_registry.zig:37` 실행 차단, `tool_host.zig:2153` authority 정책. 전부 구현·테스트 완료 상태이고 소비자만 없다. 3절 참조.

**열려 있는 것**

1. `prepareParentBoundaryPage`의 `.turn_boundary` 외 모드가 있는지. 깨우기 판정용 non-consuming peek이 가능한가. (`parent_delivery_projector.zig:184`) — 4절 7번의 규모를 좌우한다.
2. TUI에서 모드 정책이 미배선인 지점이 `app_session_runtime.zig:4673`과 `main.zig:1517` 둘뿐인지. 전수 확인하지 않았다.
3. 깨우기 모드를 사용자에게 노출되는 모드(`/mode` 목록)로 넣을지 내부 전용으로 둘지. `builtins/modes.zig:12`의 `all` 배열에 넣으면 ACP `session/set_mode`에도 노출된다. **[미확인]** 그 노출이 바람직한지.
4. `read_only_tool_names`를 늘릴지 깨우기 전용 `ToolSet`을 별도 조립할지. 공유 상수를 늘리면 ACP·`fx ask`의 read-only 모드 의미가 함께 바뀐다.
5. `agent_step_limit`을 잡 단위로 덮어쓰는 경로가 지금 있는지. B안으로 되돌아갈 경우에만 필요. (`runtime/config.zig`, `worker_runtime.zig`의 `AgentTurnSettings`)
6. `ask` 모드 승인 프롬프트가 사용자 부재 시 무기한 유지되는지, 타임아웃이 있는지. A안을 다시 검토할 때 필요. (`app_permission_runtime.zig`)
7. ACP 호스트(`acp/prompt.zig:950`)와 `fx ask`(`cli_ask.zig:1743`)에서 깨우기가 의미가 있는지. 둘 다 대화형 런루프가 없으므로 **[추정]** TUI 전용 기능이 맞을 것 같지만 확인 안 했다.
8. `team_message` AttentionKind가 배선되지 않은 이유. 결정 1의 후속이 미완인지, 의도적으로 보류인지.
