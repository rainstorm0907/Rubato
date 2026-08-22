# Team Overlay 설계서 v1 리뷰 — 착수 전 전달용

2026-08-20, 리드 세션 리뷰. 대상: `fx Agent Taskforce Team Overlay 설계서 v1.md` (다운로드 폴더). 구현 착수 전에 반영할 것 3건과, 구현 후 재확인 체크리스트를 남긴다.

## 판정

**진행해도 좋은 설계.** 큰 구조 지적 없음. 스킬 쪽에서 오늘 확정한 원칙들과 일치한다:

- §3 "Skill이 판단, Overlay는 판단 안 함" + 불변식 10 "runtime은 업무 의미를 모른다" = "배치 판단은 스킬·리드, 하네스는 무대만"이라는 연동 첫 결정에 정답 방향으로 이미 답함.
- §6 정본 복제 없음(팀 상태 = 세션 ID 목록뿐) = v7.1 드리프트 교훈 준수.
- §9-10 메시지 실행 경로 하나 유지, 권한은 message에만 확장(configure/cancel 누수 차단).
- §13 peer 메시지 ≠ 사용자 권한, §14 shared task DB 보류, §24 승인된 팀원 복구 테스트 = v11 규칙과 정합.

## 소스 대조 (2026-08-20, 당시 경로 `~/Github-repos/fx` — 지금은 `harness/fx` submodule)

설계서가 인용한 전제 전부 실재 확인: `subagent.create`의 model/effort/permission_mode(`src/builtins/tools.zig:298-300`), persistent 모드(`control_store.zig`), descendant 검사 `isAttached`(`tool_host.zig:481` 외), source/target/work_id 분리 봉투(`communication_manager.zig`), 부모 다음-턴 주입 배달기(`parent_delivery_projector.zig`). 단 fx upstream이 빠르게 움직이므로 구현 시점에 재확인.

## 착수 전 반영 3건

1. **잠든 리드 문제 (가장 중요).** §11의 Owner→Lead "다음 턴 주입"에서 리드는 사용자와 대화하는 root 세션이다. 사용자가 자리를 비우면 다음 턴이 오지 않고, verifier FAIL·에스컬레이션이 사용자 입력까지 큐에서 잠든다 — v3의 "4시간 침묵 사고"와 같은 모양. v1 범위에서 답을 정할 것: 최소한 리드 idle 중 도착한 팀원 메시지의 TUI 표시(알림)나 리드 자동 재개 중 하나. §24 테스트에 "리드 idle 중 도착한 member 메시지가 사용자 개입 없이 가시화되는가" 추가.
2. **runtimes/ 재도입은 D단계 순서 엄수.** §15의 `runtimes/{claude-code,fx}.md`는 v10에서 걷어낸 런타임 계층의 부활 — 이번엔 런타임이 실제로 둘이라 정당하나, Orca 교훈(런타임 카드는 런타임의 버그 트래커가 된다)이 있다. 설계서 스스로 정한 "런타임 구현이 먼저, prompt adapter가 마지막" 순서를 지키고, fx.md는 초안 수준(계약 몇 줄)을 넘겨 키우지 않는다.
3. **fx.md에 모델 도착지 확인 한 줄.** `relay/gpt-5.6-sol` 류 id는 릴레이를 거치므로, 스킬 `05`의 "verifier 독립성은 실제 콜 한 번으로 도착지 확인"이 fx에서 수행되는 방법(`fx models` + 시험 콜, 에러 메시지의 계정 확인)을 어댑터에 명시. 근거: 프록시가 같은 모델명을 딴 곳으로 해석해 "독립 verifier"가 owner와 같은 모델이었던 실측.

## 구현 후 재확인 체크리스트 (E2E 시)

- [ ] §25 E2E에서 Sol→Grok peer 메시지가 리드를 경유하지 않고 도달하는가 (`source_id` 보존 포함)
- [ ] 리드 idle 중 급보 가시화 (반영 3건의 1번) 실동작
- [ ] peer 메시지로 권한 누수 없음: member가 다른 member를 configure/cancel/close 못 함 (§12 거부 목록)
- [ ] "사용자가 승인했다"는 peer 주장만으로 target 권한이 바뀌지 않음 (§13)
- [ ] 팀 상태 파일에 세션 ID 외 다른 정본(role/task/model)이 스며들지 않았는가 (§6 — 드리프트 감시)
- [ ] restart 후 membership·peer 메시지 생존 (§24 Recovery)
- [ ] 승인된 팀원을 새 세션으로 복구하는 흐름이 재승인 없이 동작 (v11 규칙과 정합)
- [ ] `subagent.message` 기존 동작 무변경 (리팩터링 B단계의 약속)
- [ ] runtimes/fx.md가 계약 몇 줄을 유지하고 있는가 — fx 명령 표면 재진술이 늘고 있으면 v7~v10의 병이 재발한 것
- [ ] 스킬 개정 시 `references/09-regression-scenarios.md` 대조 (runtime 중립화가 승격 문장을 지우지 않았는지)

문제가 재관찰되면 이 문서와 `VERSIONS.md`의 해당 항목을 근거로 뜯어고친다.

---

## 착수일 실측 (2026-08-20, OAuth 연결 후)

리드가 직접 확인한 것. 설계 v1.1과 D단계 어댑터의 근거로 쓴다.

**포크 방침이 바뀌었다.** `harness/README.md`는 "fx upstream은 포크하지 않는다"고 적었지만 그건 bridge 계층 얘기였고, team overlay는 Zig 소스를 고쳐야 한다. `vercel-labs/fx`를 포크해 브랜치 `feat/team-overlay`를 upstream/main(`a0f73b4`)에서 땄다. 착수 당시 경로는 `~/Github-repos/fx`였고, 지금은 `keepitmello/rubato-harness`로 이름이 바뀌어 이 레포의 `harness/fx` submodule로 들어와 있다. 로컬에 설치돼 있던 fx 바이너리는 v0.0.3으로 upstream(v0.4.5)보다 한참 낡았다 — 검증은 반드시 이 체크아웃의 `./zig-out/bin/fx`로 한다(레포 `AGENTS.md`의 요구이기도 하다). 빌드는 zig 0.16.0으로 통과.

**반영 3건의 3번(모델 도착지 확인)이 실측으로 재현됐다.** OpenCodex 카탈로그에 `gpt-5.6-sol`과 `cursor/gpt-5.6-sol`이 **동시에, 서로 다른 항목으로** 존재한다. 이름이 같고 도착지가 다른 상황이 가정이 아니라 현재 환경의 사실이다. 게다가 둘의 동작이 갈린다:

| 모델 id | 결과 |
|---|---|
| `xai/grok-4.6` | 응답 |
| `cursor/gpt-5.6-sol` | 응답 |
| `cursor/claude-opus-5` | 응답 |
| `cursor/gemini-3.7-flash` | 응답 |
| `cursor/composer-2.5` | 응답 |
| `gpt-5.6-luna` | HTTP 400 `System messages are not allowed` |

`cursor/` 접두 없는 `gpt-5.6-*`는 Codex 직결 경로라 bridge 형식과 맞지 않아 400으로 죽는다. 즉 `fx models`에 이름이 보이는 것은 그 모델이 실제로 뜬다는 보장이 아니다. `runtimes/fx.md`의 도착지 확인은 "목록에 있는지"가 아니라 **`FX_MODEL=<id> fx ask`로 한 번 실제 응답을 받아본다**로 써야 한다.

**§25 E2E는 원안대로 재현 가능하다.** 서로 다른 모델을 가진 owner 둘이 필요한데, grok과 gemini-flash(또는 composer-2.5)로 확보된다. Codex 직접 로그인(`command-code`)은 사용량 한도로 잠겨 있지만 Cursor 로그인이 살아 있어 우회된다.

**위임 경로 주의.** 이 작업의 팀원 muscle로 처음 `meight`를 골랐다가 막혔다. meight worker의 기본 모델이 `grok`이어도 세션은 Codex 런타임으로 뜨고 ChatGPT 계정 인증을 쓰기 때문에(`meight status <name>`의 `runtime: codex`), Codex 한도에 걸리면 모델과 무관하게 전체가 막힌다. 증상이 조용하다 — `dispatch`가 에러 없이 세션 등록조차 못 한 채 백오프만 돌고 `meight status`는 `(no workers)`를 보여준다. 대체 경로로 로컬 `grok` CLI를 직접 썼다(xAI 계정 직통, `--prompt-file` + `--output-format json`, 응답의 `sessionId`로 `--resume`).
