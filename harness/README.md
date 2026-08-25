# rubato — 커스텀 하네스

이름은 *tempo rubato*("훔친 시간") — 템포의 재량을 지휘자가 아니라 연주자가 갖는 연주법. 하네스는 박자를 강제하지 않고, 모델이 자기 시간으로 사고한다. 노이즈를 줄이는 이유도 같다: 적어야 사고 공간이 넓어진다.

이 디렉토리가 하네스 정본이다. 엔진 포크와 오버레이가 한 레포에 있다.

## 레포가 둘인 이유

- **이 레포(Rubato)** 가 하네스다. 엔진 포크 + rubato-pi 오버레이 + 역할별 시스템 프롬프트 + provider bridge. 실행에 필요한 것은 전부 여기다. upstream(`code-yeongyu/oh-my-openagent`)을 추적한다.
- **agent-taskforce** 는 스킬, agent 정의, Claude Code 런타임 훅, 사례, 참고 자료다. 하네스 없이 의미가 있고 다른 CLI와 공유한다.

예전에 `harness/`는 agent-taskforce 안에 있었다. 지금은 여기로 옮겼다. agent-taskforce의 `runtime/`은 Claude Code 설정(컴팩션 훅 등)이고, 실행 하네스가 아니다.

목표는 모델 인지 프로파일 칼럼(agent-taskforce `research/2026-08-20-model-cognition-column.md`)의 분업 구조 — Fable framing / Opus lead / Sol investigator / Grok builder — 를 최적 배치로 돌리는 것이다.

## 설치 — 이 레포만으로

```bash
git clone --recurse-submodules --branch rubato/base https://github.com/keepitmello/Rubato.git
cd Rubato
./install.sh                         # 계획만 본다
./install.sh --apply                 # 설치하고 모델 왕복까지 확인한다
```

installer는 submodule, 엔진·bridge·rubato-pi 의존성, 엔진 확장 빌드, 역할별 프롬프트 합성,
번들 스킬, 셸 alias 블록을 이 클론만으로 설치한다. 기존 스킬은 덮어쓰지 않는다.
크레덴셜은 복사하거나 만들지 않고 상태만 알려 준다.

alias는 `~/.zshrc`의 마커 블록(`# >>> rubato aliases >>>`) 하나로 관리된다.
낟개로 넣으면 alias를 하나 늘릴 때 기존 사용자에게 안 가기 때문이다.

| alias | 하는 일 |
|---|---|
| `rubato`, `rubato-pi` | 세션을 띄운다 |
| `rubato-soul` | 역할별 조립 없이 `Documents/SOUL.md`만 시스템 프롬프트로 |
| `rubato-restart`, `rbr` | 공유 bridge 를 인증 drain 한 뒤 교체하고 `/health` 까지 확인 |
| `msearch` | 기억 검색 |

설치 후에는 `rubato update`가 이 블록과 cmux 세션 복원까지 같이 따라온다.
셸 설정만 다시 심고 싶으면 `./install.sh --apply --only-shell`.

수동으로 각 단계를 실행해야 할 때만 아래를 쓴다:

```bash
git submodule update --init --recursive
bun install                          # 엔진(senpi). npm 은 workspace: 를 못 읽는다. bun 1.4+
npm install --prefix harness         # bridge
npm install --prefix harness/rubato-pi
node harness/scripts/build-engine.mjs   # 엔진 산출물 → ~/.rubato-pi/engine/plugin
harness/prompts/build.sh
harness/scripts/install-skills.sh
```

엔진 산출물은 레포가 아니라 `~/.rubato-pi/engine/plugin` 에 만든다. 레포 안의
`packages/omo-senpi/plugin/extensions/` 는 upstream 이 직접 커밋하는 원본이라,
거기에 우리 빌드를 덮으면 worktree 가 영구히 dirty 가 되어 업데이트가 막힐다
(산출물 첫 줄의 소스 해시가 매번 달라진다). 보관용과 사용본을 갈라 둔 것이다.
`rubato` 를 띄울 때마다 자동으로 돌고, 신선하면 0.06초에 끝난다.

## 업데이트

`rubato` 를 띄울 때마다 원격을 본다(보통 0.5초). 새 커밋이 있으면 한 줄만 띄우고
세션은 그대로 진행한다. 받을 때까지 매번 뜼는 것이 의도다.

느린 네트워크에서 세션 시작이 매달리지 않게 git 레버로 끊는다 — 3초간 1KB/s 를
못 넘기면 포기하고, 이미 받아 둔 원격 ref 로 비교만 한다. 네트워크가 아예 없으면 0.1초에 빠진다.

```text
✦ rubato 업데이트 3개  `rubato update` 로 받는다
```

```bash
rubato update          # 무엇이 바뀌는지 보여주고 물어본다
rubato update --yes    # 묻지 않고 전부
rubato update --check  # 새 커밋이 있는지만 (있으면 exit 10)
rubato build           # 로컬 시스템 프롬프트를 다시 합성
```

받으면 바뀐 것에 맞춰 다시 만든다 — 의존성, 엔진 플러그인, 시스템 프롬프트, 번들 스킬.
`packages/` 가 바뀌면 엔진 빌드까지 돌아서 몇 분 걸린다.

일반 `rubato` 실행도 시작 전에 로컬 시스템 프롬프트를 다시 합성한다. 보통 0.01초라
프롬프트 조각을 직접 고친 뒤 `rubato build` 를 잊어도 새 세션부터 바로 반영된다.

커밋하지 않은 수정이 있어도 멈추지 않는다. 그대로 받아 보고, 겹쳐서 거부당할 때만
잠시 치웠다(`git stash`) 받은 직후 되돌린다. 받기에 실패해도 치운 것을 반드시
제자리에 돌려놓고 빠진다. 되돌리다 충돌해도 stash 항목은 남으므로 잃는 것은 없다.

예전에는 수정이 있으면 멈춰 사람에게 정리를 시켰는데, 이 레포는 가만히 둬도
산출물 때문에 dirty 가 되어 정리해도 다음 세션에 또 걸렸다. 산출물을 레포 밖으로
뻐면서 그 고리를 끊었고, 떠넘기는 분기도 같이 없앱다.

그래도 안 건드리는 경우가 둘 남는다. 브랜치가 `rubato/base` 가 아니거나, 로컬에만
있는 커밋과 갈라져 fast-forward 가 안 될 때다.
알림을 끄려면 `RUBATO_NO_UPDATE_CHECK=1`, 엔진 빌드를 건너뛰려면 `RUBATO_NO_ENGINE_BUILD=1`.

## cmux 세션 복원

[cmux](https://cmux.com) 는 터미널 안에서 도는 코딩 에이전트를 감지해 세션 파일을 기억하고,
앱을 다시 띄우면 resume 명령으로 이어붙인다(Vault). 프로세스를 살려두는 tmux 와 달리
기록을 읽어 재구성하는 방식이라 RAM 을 잡아두지 않고 재부팅도 넘긴다.

Pi 는 기본 지원이지만 rubato 는 둘이 어긋난다 — 프로세스가 `pi` 가 아니라
`node .../rubato-pi.mjs` 로 뜨고, 세션이 `~/.pi` 가 아니라 `~/.rubato-pi/agent/sessions` 에
쌓인다. 둘 다 명시해야 맞는다.

**`rubato` 를 띄우면 알아서 들어간다.** 따로 칠 명령은 없다. cmux 를 안 쓰면
아무 일도 안 생기고, 이미 맞으면 조용하다(43ms). 하네스를 옮겨 `resumeCommand` 의
절대경로가 깨졌을 때도 같은 자리에서 고친다.

`~/.config/cmux/cmux.json` 은 JSONC 라 **쓰면 주석을 잃는다**. 그래서 건드릴 때마다
`cmux.json.<날짜>.bak` 을 남긴다. 다른 항목은 그대로 둔다.

끄려면 `RUBATO_NO_VAULT=1`. 상태만 보거나 블록을 손으로 넣고 싶으면:

```bash
node harness/scripts/cmux-vault.mjs --check   # 상태만
node harness/scripts/cmux-vault.mjs --print   # 붙여넣을 블록만
```

반영은 `cmux reload-config`. 놀고 있는 세션의 RAM 까지 회수하려면 cmux 설정의
`terminal.agentHibernation` 을 따로 켜라 — 둥이는 세션을 죽였다가 탭을 열 때 되살린다.

**요구 사항.** Node 24+, bun 1.4+(그 아래는 `--metafile` 이 없어 확장 빌드가 죽는다). `opencodex` 는 선택이다 — Codex 는 OAuth 로 직접 가고, OpenCodex 가 있으면 그쪽 모델이 카탈로그에 더해질 뿐이다.

**크레덴셜은 각자 넣는다.** 설치는 이것들을 만들지 않는다. 상태는 `rubato auth` 로 본다.

| 프로바이더 | 자리 | 방식 |
|---|---|---|
| xAI | `~/.senpi/agent/auth.json` 의 `xai` | OAuth, 자동 갱신 |
| Codex | 같은 파일의 `openai-codex` | OAuth, 자동 갱신 |
| Claude | `~/.claude/auth/setup-token-<계정>` (없으면 Keychain) | **1년 장기 토큰** `sk-ant-oat...` |

계정 이름 기본값은 `sub` 이고 `FX_CLAUDE_ACCOUNT` 로 바꾼다.

Rubato 실행에 필요한 파일과 스킬은 이 레포에 있다. Claude Code 전용 agent 정의와
컴팩션 훅은 Rubato 실행 범위가 아니며, 필요하면 별도 도구로 설치한다.

## 지금 구조

기본 런타임은 **`rubato-pi`** — Senpi 엔진 계보 위에 얇게 얹는 오버레이다. 계보는 다섯 겹이다.

```text
pi-mono (badlogic)
  ↓  포크
Senpi (code-yeongyu)                       세션 루프·도구 실행·모델 호출
  ↓  이 위에 얹음
omo-ai / oh-my-openagent (code-yeongyu)    task 엔진·component
  ↓  포크
Rubato (keepitmello)                       component를 고른 엔진 + 이 harness/
  └─ harness/rubato-pi/                    역할별 시스템 프롬프트·팀 도구·상태줄·브로커 연결
```

오버레이는 아직 npm의 `omo-ai`를 정확한 버전으로 받아 `plugin/extensions/omo.js`를 `-e`로 얹는다. 그와 별개로 **이 레포가 엔진 포크다.** component를 골라 끄는 경로가 upstream에 없어서 포크를 만들었고, 켜는 여섯 개만 `packages/omo-senpi/src/extension/component-list.ts` 배열에 남긴다. 소스 파일은 지우지 않는다. 어떤 component를 왜 끄는지와 머지 절차는 [docs/rubato/component-policy.md](../docs/rubato/component-policy.md)가 정본이다. 여기서 다시 적지 않는다.

역할별 시스템 프롬프트는 `prompts/`가 정본이다. `build.sh`가 조각(base + core + voice)을 합쳐 역할마다 완결된 파일 하나를 만들고, `~/.agents/rubato`가 그것을 가리키는 심링크다. 통째로 주입되므로 파일 하나가 그 역할의 전부여야 한다.

**역할은 셋인데 파일은 둘이다** — lead 는 `lead.pi.md`, owner 와 verifier 는 `teammate.pi.md` 를 함께 쓴다. 이것은 메우다 만 자리가 아니라 의도다: 검증도 하나의 워크스트림이고, verifier 는 산출물이 판단인 owner 다. 둘을 가르는 것은 부팅 프롬프트가 아니라 받는 브리프다.

파일 이름의 `.pi` 는 계보 표시다. fx 런타임용 판이 따로 있던 시절의 흔적이고, 지금은 pi 판만 남는다.

시스템 프롬프트는 통째 교체다. `.build/lead.pi.md` 또는 `teammate.pi.md` + `dispatching`/`dispatched` 스킬이 본문이고, Senpi/OMO 기본 프롬프트는 버린다. 프로젝트 컨텍스트·memory·스킬 목록·cwd만 남긴다. 다만 memory 블록에 실제로 실리는 것은 `memory.project` 화이트리스트에 적힌 `system/` 파일뿐이고, 기본값은 빈 목록이라 AGENT_ID 만 남는다 — 나머지는 msearch 로 찾아 읽는다. 교체 방식이 `customPrompt`가 아니라 **엔진이 만든 프롬프트를 정규식으로 뜯어 재조립**하는 것이라, 상류가 블록을 추가하면 조용히 사라진다. `test/unit/prompt-drift.test.mjs`가 엔진 산출물과 우리 것을 대조한다.

팀은 OMO 런타임을 유지한다. `team_create` / `task` / `task_send` / 보드. 팀원 모델은 리드가 고르고, 띄우기 전에 역할·모델 배치안을 채팅으로 보여 승낙을 받는다. `~/.omo/omo.jsonc` 카테고리 라우팅은 읽지 않는다. `/login`은 중계기 경로다. OMO 스킬팩은 안 실리고, `~/.agents/skills`만 본다.

## provider bridge

모델 호출은 로컬 브로커를 거친다.

```text
rubato-pi
  → 127.0.0.1:8788  bridge
       ├─ xai/*           → pi-ai xAI transport      → xAI OAuth
       ├─ anthropic/*     → pi-ai Messages transport → Claude 장기 setup-token
       ├─ openai-codex/*  → pi-ai Codex transport    → Codex OAuth
       └─ 나머지           → OpenCodex 127.0.0.1:10100 (선택)
```

셋 다 이 중계기가 직접 문다. OpenCodex 는 없어도 되고, 있으면 그쪽 카탈로그가 더해진다.

Senpi agent나 provider CLI가 도구를 실행하지 않는다. transport는 tool call만 반환하며 실행과 승인, tool result 전달은 하네스가 소유한다. xAI OAuth credential은 기본 `~/.senpi/agent/auth.json`, Claude setup-token은 macOS Keychain에서 읽는다. Codex credential은 OpenCodex가 가진다. Codex 경로를 쓸 때는 OpenCodex가 `10100`에서 살아 있어야 한다.

Cursor는 이 중계기에 없다. 밖의 `cs-agent`(`~/.claude/cs-agent/`)에서 `cursor-agent`를 독립 에이전트로 띄우는 형태다 — 판정 근거는 agent-taskforce `case-studies/provider-routing/cursor-route-verdict/`.

## 실행

```bash
./scripts/start.sh   # bridge
rubato               # = rubato-pi. 보통 alias 가 harness/scripts/rubato-pi.sh
```

브리지는 첫 세션이 알아서 띄운다(`ensureBroker`). 아래 supervisor 를 심어두면 로그인 때 이미 떠 있어서 그 몫이 사라진다. 둘 중 무엇이든 코드는 같다 — `ensureBroker` 가 "살아 있으면 아무것도 안 한다"로 시작하므로 자연히 no-op 이 된다.

### 로그인 때 브리지를 띄운다 (supervisor)

```bash
./install.sh --only-supervisor --apply      # macOS launchd / Linux systemd user unit
./install.sh --uninstall-supervisor --apply # 뗀다
```

`./install.sh --apply` 에도 포함돼 있다. 인자 없이 부르면 무엇을 할지만 보여준다.

supervisor 는 크래시만 되살린다. macOS 는 `KeepAlive` 의 `SuccessfulExit=false` + `Crashed=true`, Linux 는 `Restart=on-failure`. 정상 종료는 `rubato restart` 만 한다 — 브리지가 런타임에 쓴 mode 600 비밀 파일로 `POST /admin/drain` 을 인증하고, 옛 프로세스가 끝난 뒤 교체본을 띄워 `/health` 가 200 일 때만 성공한다. SIGTERM/SIGINT 는 브리지가 무시한다. 세션·에이전트가 공유 브리지를 내릴 수 없고, SIGKILL 뒤에만 supervisor 가 다시 올린다.

systemd 가 없는 곳(WSL 일부, 컨테이너)에는 아무것도 심지 않고 lazy start 로 남는다. `loginctl enable-linger` 는 권하지 않는다 — 브리지가 사용자 인증 파일을 읽으므로 로그인 세션 밖에서 도는 것은 득보다 실이 크다.

한 머신에서 클론을 여럿 돌린다면 `FX_BRIDGE_PORT` 와 함께 `RUBATO_SUPERVISOR_LABEL`(macOS) 또는 `RUBATO_SUPERVISOR_UNIT`(Linux)도 다르게 준다.

> **supervisor 를 쓸 때 Claude setup-token 은 파일로 두는 편이 안전하다.** 브리지는 `~/.claude/auth/setup-token-<계정>` 을 먼저 보고 없으면 Keychain(`security find-generic-password`)으로 떨어지는데, 로그인 직후 launchd 가 띄우는 시점에 키체인이 잠겨 있으면 그 폴백이 실패할 수 있다. 이 경로는 **아직 실측하지 못했다** — 이 머신은 파일 토큰이 먼저 잡혀 확인할 기회가 없었다.

### 로그

```
macOS  ~/Library/Logs/rubato/bridge.log
그 외   ${XDG_STATE_HOME:-~/.local/state}/rubato/bridge.log
```

`RUBATO_BROKER_LOG` 로 덮을 수 있다. 예전에는 `$TMPDIR` 에 뒀는데 재부팅에 날아가서, 뒤늦게 "브리지가 왜 죽었나"를 물을 때 볼 것이 남지 않았다. `rubato-restart.sh` 는 재기동마다 시각·호출자·사유를 한 줄 남긴다.

세션 상태는 `~/.rubato-pi/agent`다. `~/.omo`는 건드리지 않는다. `.build/lead.pi.md`와 `.build/teammate.pi.md`가 없으면 거절한다 — 시스템 프롬프트 없이 도는 것이 과거의 실제 버그였기 때문에 조용히 넘어가지 않는다. 조각을 고친 뒤에는 `prompts/build.sh`를 다시 돌린다.

확인:

```bash
./scripts/doctor.sh
./scripts/smoke-test.sh
```

## fx — 폐기된 이전 세대

처음엔 `vercel-labs/fx` 위에 지었고, Team Overlay를 넣으려고 Zig 소스를 포크해 `keepitmello/rubato-harness`로 둔 적이 있다. **지금은 쓰지 않고 submodule도 걷어냈다.** 역할별 시스템 프롬프트는 그때 `harness/fx/` 아래에 있었고, 지금은 `harness/prompts/`다.

그 시절 기록은 이력으로만 읽는다 — `docs/fx-team-overlay.md`, `docs/team-overlay-v1-review.md`, `docs/team-overlay-v1.1-*.md`, `docs/team-overlay-progress.md`. 거기서 배운 것 하나는 지금도 유효하다: **upstream을 계속 받을 거면 포크에서 고치는 자리를 최소로 줄여야 한다.** `control_store.zig` 스키마 버전 충돌로 머지할 때마다 조용히 깨졌던 것이 그 근거고, 지금 이 포크가 component를 파일 삭제 대신 배열에서만 빼는 이유다.

fx에만 있던 rewind·`fxd` 이름 세션·fx TUI 알림은 옮기지 않았고, 계획에서도 뺀다. 필요해지면 pi 위에 새로 만든다. 아래 rewind·캐시 실측은 그 세대의 기록이다. 파일 경로(`src/core/session/*.zig`, `~/.fx/`)는 이 레포에 없다.

## rewind — 대화를 이전 턴으로 되감는다 (폐기된 fx 포크 전용)

upstream fx에는 없었다. 세션 기록을 실제로 잘라내고 그 시점부터 다시 보내는 기능이었다.

```
/rewind        빈 인자면 피커를 연다
/rewind 3      마지막 3턴을 버린다
Esc Esc        빈 입력창에서 두 번 누르면 피커 (턴 목록, 최신순)
```

피커는 각 항목이 몇 턴을 버리는지와 그 턴 프롬프트의 첫 줄을 같이 보여 줬다. compact 요약 뒤에 갇힌 턴은 되감아도 복원할 수 없으므로 선택 자체를 거부했다.

되감기는 지운다. 버린 턴은 돌아오지 않는다. 그래서 순서를 두 군데에서 고정했다:

- **디스크가 먼저, 메모리가 나중이다.** 잘린 기록을 커밋한 뒤에만 메모리를 교체한다. 커밋이 실패하면 메모리와 디스크가 같은 옛 기록에 남아 반쪽 상태가 생기지 않는다. 로그는 넘어갔는데 뒤따르는 정리가 실패한 경우는 되감기를 채택하고 degraded로 보고한다.
- **취소가 먼저, 자르기가 나중이다.** 워커가 다음 job을 꺼낼 때 cancel 플래그를 리셋하므로, 큐를 비우기 전에 자르면 방금 취소한 턴이 되살아난다.

화면 복원은 resume과 같은 projection 경로를 썼다 — 되감은 뒤 보이는 것이 같은 세션을 resume 했을 때와 일치한다.

구현은 폐기된 fx 포크의 `src/core/session/session_rewind.zig`(자르기)와 `rewind_picker.zig`(선택), `src/ui/rewind_screen.zig`(화면)에 있었다.

## prompt cache — 프로바이더마다 레버가 다르다

측정일 2026-08-21. 세 프로바이더 중 **TTL을 우리가 정할 수 있는 것은 Anthropic direct 하나뿐이다.** 나머지 둘은 우리 코드가 아니라 provider가 막는다. 아래 표의 `FX_*` 이름은 fx 시절 레버다. 브리지가 같은 값을 아직 읽는다.

| 프로바이더 | 캐시 방식 | 1시간 TTL | 우리가 쥔 레버 |
|---|---|---|---|
| `anthropic/*` | 명시 `cache_control` breakpoint | **된다** | `FX_CACHE_RETENTION` |
| `xai/*` | provider 자동, 128토큰 블록 | 파라미터 자체가 없다 | `prompt_cache_key`(서버 affinity)뿐 |
| codex (`gpt-5.6-*`) | provider 자동 | upstream이 400으로 거부 | `prompt_cache_key`뿐 |

### Anthropic — `FX_CACHE_RETENTION`

bridge가 pi-ai에 `cacheRetention`을 넘긴다. 기본값은 `long`이고 `short`/`none`으로 끌 수 있다.

`long`이면 system·tools·마지막 user 블록에 `cache_control: {"type":"ephemeral","ttl":"1h"}`가 붙는다. **Claude setup-token OAuth 경로에서도 거부되지 않는다** — 실측에서 `anthropic-beta`는 `claude-code-20250219,oauth-2025-04-20`만 나갔고 extended-cache-ttl beta 헤더 없이 통과했다. 응답 usage의 `cache_creation.ephemeral_1h_input_tokens`로 provider가 1시간 캐시임을 확인해준다.

sonnet-5 기준 2턴 실측: T1 `cacheWrite1h=10853` → T2 `cacheRead=10853`. bridge를 통과한 e2e도 동일했다.

비용은 공짜가 아니다. 1시간 쓰기는 base input의 **2배**이고 5분 쓰기는 1.25배다(sonnet-5 기준 $4/M 대 $2.5/M, 읽기는 $0.2/M). agent-taskforce `case-studies/cache/fx-compaction-vs-cache-discount-measurement.md`의 실측(외부 턴 간격 5분 초과 24%, 턴당 request 12.4, 세션 턴 중앙값 7, 8턴 초과 세션 47%)을 넣으면 손익분기가 외부 턴 3개 근처다. 그 위로는 계속 `long`이 싸다. 아주 짧은 단발 호출만 도는 용도라면 `FX_CACHE_RETENTION=short`가 맞다.

**fx 포크에서 고친 것 하나.** fx는 `.no_cache` 메시지를 만나면 `prefix_cacheable` 래치를 끄고 다시 켜지 않아, ephemeral overlay 뒤의 모든 메시지가 캐시 대상에서 빠졌다. breakpoint 계산은 대화 끝을 제대로 짚는데 마킹이 안 돼서 요청마다 전체를 새로 썼다. 래치는 애초에 중복이었다 — `shouldCacheMessage`가 `.no_cache`를 개별로 이미 거른다. 래치를 걷어내고 breakpoint 생존을 검증하는 테스트를 넣었다 (`51b2c16`).

### xAI — TTL 레버가 없다

xAI 문서에 캐시 TTL 값도, 그걸 정하는 파라미터도 없다. 캐싱은 자동이고 캐시 엔트리는 서버 부하나 재시작으로 **언제든 evict될 수 있다**고 명시한다. 그래서 pi-ai도 grok 전 모델에 `supportsLongCacheRetention: false`를 박아뒀다.

`prompt_cache_retention`을 강제로 실어보면 400은 안 나지만(200) 캐시가 개선되지 않는다. 실측에서 오히려 그 필드를 넣은 쪽만 미스가 났다. **넣지 마라.**

xAI가 문서에서 권하는 유일한 레버는 같은 서버로 라우팅하는 것이다 — Responses API에서는 `prompt_cache_key`(Chat Completions에서는 `x-grok-conv-id` 헤더). bridge는 fx의 `x-session-id`를 그대로 이 값으로 쓴다.

### codex — upstream이 거부한다

ChatGPT 구독 OAuth backend에 직접 실측한 결과 `prompt_cache_retention: "24h"`와 `prompt_cache_options.ttl`(`30m`/`1h`/`24h` 전부)이 `400 Unsupported parameter`다. TTL 필드만 뺀 대조군은 200이다. OpenCodex는 body를 raw passthrough하므로 중계 쪽 문제가 아니다. bridge에 이 필드를 넣으면 TTL이 늘어나는 게 아니라 codex 요청이 전부 실패한다.

### `--no-save`는 캐시 키를 죽인다

fx는 세션 저장 모드에서만 `x-session-id`/`x-session-affinity`를 보냈다. `--no-save`로 돌리면 두 헤더가 아예 없고, bridge의 `sessionId`가 `undefined`가 되어 `prompt_cache_key`도 실리지 않는다. xAI와 codex는 이 값이 서버 affinity의 전부이므로 `--no-save` 반복 호출은 매번 cold를 부른다. 비용을 재거나 캐시를 논할 때는 저장 모드로 돌린다 (`~/.fx/usage.jsonl` 기록도 `--no-save`에서는 남지 않았다).

## 측정 기록 — 기본은 꺼져 있다

호출마다 TTFT·모델 소요·호출 사이 대기·프로바이더 토큰 사용량(캐시 읽기/쓰기 분해)·컨텍스트
세그먼트 다이제스트를 남기는 기록기가 `harness/rubato-pi/src/measurement-recorder.mjs`에 있다.
`RUBATO_MEASUREMENT_LOG=<path>`가 켜져 있을 때만 동작하고, 꺼져 있으면 `measurementRecorder()`가
`undefined`를 돌려줘 완전한 no-op이다 — 벤치마크 스크립트(`scripts/run-measurement-benchmarks.mjs`)
말고는 아무도 이 변수를 켜지 않았으므로, 지금까지 실사용 세션은 아무것도 기록하지 않았다.

**일상 세션에서 켜려면 경로를 손으로 만들 필요 없이 `RUBATO_MEASUREMENT=1`.** `launchEnv()`
(`src/brand.mjs`)가 `RUBATO_MEASUREMENT_LOG`가 이미 안 잡혀 있을 때만
`~/.rubato-pi/agent/measurements/<ISO시각>-<pid>.jsonl`을 대신 채운다. 직접 경로를 준
`RUBATO_MEASUREMENT_LOG`가 있으면 그쪽이 항상 이긴다.

**기본은 여전히 꺼짐이다.** 두 변수 다 없으면 정상 세션은 0에 가까운 비용을 낸다 — 실측(이 머신,
Apple M4): ~870KB 컨텍스트에서 `contextSegments()`(직렬화 + sha256 해시)가 호출당 약 1ms,
~1MB 이벤트 줄의 `appendFileSync`가 약 0.7ms. 3MB짜리 극단적으로 큰 프롬프트에서도 약 4.3ms다.
모델 호출 자체가 보통 수백 ms~수십 초인 것과 비교하면 무시할 수 있는 수준이라, 기본을 켜둘 만큼
안전하지만 그래도 명시적 opt-in으로 남겨 뒀다 — 기록은 디스크에 프롬프트 다이제스트와 도구 결과
존재 여부를 남기고, 이건 사용자가 원할 때만 쌓여야 하는 흔적이다.

`RUBATO_MEASUREMENT_CAPTURE_RAW=1` + `RUBATO_MEASUREMENT_RAW_DIR=<dir>`는 호출마다 전체 요청
body를 그대로 파일로 남긴다. **개인정보·비밀 유출 위험이 있으므로 기본은 언제나 꺼짐이고, 진단이
필요할 때만 짧게 켠다.**

동시에 여러 rubato 세션이 같은 로그 파일에 append 할 때: `appendFileSync`는 `O_APPEND`로 열어
커널이 write 오프셋을 직렬화하므로 각 프로세스의 한 줄은 서로 끼어들지 않는다 — 실측으로 두 개의
동시 프로세스가 300KB, 5MB짜리 줄을 각각 섞어 써도(macOS/APFS) 깨진 줄이 하나도 없었다. 다만
`RUBATO_MEASUREMENT=1`로 자동 생성한 경로는 프로세스마다 다른 파일명(타임스탬프+pid)이라 애초에
같은 파일에 몰릴 일이 거의 없다 — 같은 파일에 몰리는 경우는 `RUBATO_MEASUREMENT_LOG`를 여러
세션에 똑같이 손으로 준 경우뿐이다.

분석은 `scripts/analyze-measurements.mjs events.jsonl`. TTFT·모델 소요·초당 토큰·캐시 드롭 후보
진단·태스크 단위 합산을 JSON으로 뽑는다.

## 상태줄의 '실제 속도'

상태줄(`src/extensions/statusline.mjs`)은 기존에 모델·컨텍스트 잔량·브랜치·레포·`Cache N%`만
보여줬고, 실제 응답이 얼마나 걸렸는지는 없었다. `tok/s`나 캐시율은 처리량이지 벽시계 지연이
아니다 — 사용자가 원한 건 '이번 턴이 느렸는지, 느렸다면 첫 토큰 전이었는지 후였는지'다.

broker-stream.mjs(`streamBroker`)가 성공한 모델 호출이 끝날 때 assistant 메시지에
`timing: { sentAt, processStartedAt, ttftMs, waitMs, thinkMs, modelDurationMs }`를 붙인다. 첫 실제
텍스트·reasoning·도구 인자 delta가 올 때까지를 TTFT로 세고, 빈 start 프레임은 세지 않는다. 이 계산은
측정 기록기와 완전히 독립이고, **`RUBATO_MEASUREMENT_LOG`가 꺼져 있어도 항상 계산된다** — 실제
속도를 보려고 프롬프트 다이제스트 기록까지 켤 필요는 없다.

한 호출은 [대기] → 첫 reasoning delta → [사고] → 첫 text delta → [생성]이다. `waitMs`는 업스트림이
입을 열기까지, `thinkMs`는 사고에서 첫 텍스트까지다. 사고가 없으면 `waitMs`는 첫 텍스트까지가 통째로
대기이고 `thinkMs`는 아예 붙지 않는다. 내용 없는 reasoning delta(Anthropic이 display가 `"omitted"`일 때
여는 빈 블록)는 사고 시작으로 세지 않는다 — 그러면 업스트림 대기가 think로 옮겨가 delay가 0에 가까워진다.
`ttftMs`는 이름도 의미도 그대로 남겨 기존 로그와 `scripts/analyze-measurements.mjs`가 계속 돈다.

상태줄은 **현재 턴에 속한 모델 호출들의 평균**을 `delay 1.2s · think 4.0s`로 붙인다
(`currentTurnTiming` + `formatLatency`, `src/statusline.mjs`). 한 사용자 턴은 도구 루프 때문에 호출
여러 번으로 갈라지므로 마지막 호출만 보여주면 숫자가 호출마다 튄다. 턴 경계는 브랜치 엔트리에서
직접 뽑는다 — 마지막 user 메시지 뒤의 assistant 들이 곧 현재 턴이다. 그래서 measurement 기록기가
꺼져 있어도 동작하고, 새 user 메시지가 들어오면 평균이 저절로 리셋되며, 턴 도중에는 지금까지 끝난
호출들의 러닝 평균이 보인다. `think`는 **실제로 사고한 호출들만** 모아 평균낸다 — 사고 없는 호출을
0으로 섞으면 98초를 생각한 턴이 절반으로 찍혀 거짓말이 된다. 사고가 하나도 없던 턴은 `delay`만 그리고
`think 0ms`는 쓰지 않는다. 이전 프로세스에서 세션 파일에 저장된 값, 실패·중단된 호출, 델타 없이 끝난
호출은 표시하지 않는다. `modelDurationMs`는 답변 길이에 따라 늘어나는 raw duration이라 속도처럼
보이지 않도록 상태줄에서는 숨기되, 오프라인 분석용 데이터에는 그대로 남긴다.

실측 예시(2026-08-24, anthropic/claude-opus-5, 실제 브리지 호출 — 증명 + 도구 호출 한 턴):

```
✦ Opus 5 xhigh · 100%(1M) · rubato/base · Rubato · Cache 2% · delay 3.2s · think 98.2s ✝𝒓𝒖𝒃𝒂𝒕𝒐✝
```

뒤에 있는 호출별 실제 숫자는 이렇다. 도구 결과를 받은 두 번째 호출은 사고를 하지 않았고, 그래서
`think` 평균을 49초로 끌어내리지 않는다.

| 호출 | waitMs | thinkMs | modelDurationMs |
|---|---|---|---|
| 1 (증명 + 도구 호출) | 4810 | 98212 | 121042 |
| 2 (도구 결과 이후 마무리) | 1635 | — | 14122 |
| 턴 평균 | 3222 | 98212 | |

## 레이아웃

```text
Rubato/
  packages/                upstream 엔진. component 선택은 packages/omo-senpi/src/extension/component-list.ts
  docs/rubato/             이 포크의 정책 (component-policy.md)
  harness/
    README.md
    prompts/               역할별 시스템 프롬프트 정본 (build.sh 로 합성)
    rubato-pi/             기본 런타임 오버레이
    bridge/                provider bridge
    docs/                  설계와 이력
    scripts/               start / doctor / smoke / 런처
    bench/  audit/         벤치와 비용 집계
```

스킬·사례·Claude Code 훅은 agent-taskforce 레포에 있다.

## upstream 머지할 때 — 조용한 실패를 먼저 의심한다

지금 추적하는 upstream은 `code-yeongyu/oh-my-openagent`이고, 이 레포가 그 포크다. 절차와 component 정책은 [docs/rubato/component-policy.md](../docs/rubato/component-policy.md)가 정본이며, 요점만 옮기면 이렇다.

1. `git fetch upstream && git merge upstream/dev`
2. **`component-list.ts` 충돌을 먼저 본다.** 우리가 고치는 자리를 이 파일 하나로 모아 뒀으므로, 늘어난 이름이 곧 새 component다.
3. 새 component는 **끈 채로** 둔다. upstream은 새것을 켜진 상태로 추가하므로, 판단 없이 배열에 넣으면 우리가 고르지 않은 것이 돌게 된다.

**이 레포가 반복해서 만나는 실패는 텍스트 충돌이 아니다.** 파일 diff가 깨끗하고 빌드가 통과하는데 의미만 틀어지는 쪽이다. fx 시절 `control_store.zig`의 스키마 버전이 그랬다 — 업스트림과 우리가 같은 번호를 서로 다른 레코드 모양으로 쓰게 되면서, 머지는 조용히 성공하고 컴파일도 테스트도 통과하는데 옛 세션 레코드를 잘못 읽었다.

같은 모양이 지금도 가능하다. 그래서 머지 뒤에는 **우리가 인용한 계약 문구를 실제 코드에 다시 대조한다.** 주석과 문서는 테스트가 검증하지 않는다.

## 확인된 것 / 아직인 것

아래는 대부분 fx 세대에서 확인한 것이다. 브리지 경로는 그대로 쓰므로 프로바이더 동작은 아직 유효하다. rewind·Team Overlay·`fx models`는 폐기된 런타임의 항목이다.

된 것:

- `fx models`가 OpenCodex 목록과 direct provider 목록을 합쳐 보여 줬다
- provider prefix가 유지된다 (`xai/grok-4.6` ≠ `anthropic/claude-opus-5`)
- xAI direct: 실제 fx `read_file` tool loop와 provider cache telemetry 확인
- Anthropic direct: 실제 fx `read_file` tool loop 확인, 동일 prefix 후속 요청에서 `cacheRead=45037` 확인
- Codex/OpenCodex: 실제 `gpt-5.6-sol` 응답과 system message 호환성 확인
- Codex cache: fx session을 `prompt_cache_key` + `session-id`로 전달한 뒤 53KB prefix T2–T6 모두 약 94.1% hit
- OpenCodex `cached_tokens`를 fx usage의 `cacheRead`로 전달
- text / reasoning / tool-call / cancel fixture

아직:

- Grok/Claude direct도 6턴·abort·bridge 재시작·OAuth refresh 전체 soak 전이므로 `canary`다
- Codex는 cache 6턴은 통과했지만 tool call 2회·abort·재시작을 묶은 전체 P0 soak는 남아 있다
- **Cursor는 하네스가 부르는 모델이 아니라 따로 띄우는 에이전트다.** fx가 도구를 쥐고 코드를 짜게 시키는 쪽은 접었다 — 보류가 아니라 판정이다 — 근거는 agent-taskforce `case-studies/provider-routing/cursor-route-verdict/`. 공식·비공식 어느 경로로 들어가도 도구를 Cursor가 자기가 쥐고 혼자 돌아서 하네스가 낄 자리가 없고(제품의 성질이지 구현 결함이 아니다), prefix cache가 서버 쪽 이유로 99%와 9% 사이를 진동하며, 비공식 경로는 벤더가 계정 밴을 걸어 공개적으로 금지했다. 2026-08-21 18:57에 `customModels`까지 지워 카탈로그에서 제거를 실측으로 확인했다(`subagent --model cursor/*` → HTTP 400). **하네스 밖에서는 산다** — `cursor-agent`를 독립 에이전트로 띄우는 `cs-agent`(`~/.claude/cs-agent/`)가 그 자리다. 셋이 다 풀리는 이유는 판정문 7절에 있다
- credits는 404. 가짜 잔여량은 안 만든다
- Team Overlay는 fx 쪽 구현이 끝났다. 리드가 idle일 때 알림이 실제로 사용자를 부르는지는 눈으로 확인하지 못한 채 fx를 접었다
- rewind는 `zig build test` 통과 상태로 커밋했지만(`2f9c43e`) 실제 TUI에서 Esc Esc를 눌러 피커를 띄우고 되감아 본 적이 없다. fx를 접었으므로 이 항목은 닫는다
- 캐시 breakpoint 수정(`51b2c16`)은 단위 테스트만 통과했다. 실 세션에서 `~/.fx/usage.jsonl`의 `cacheRead`가 실제로 올라가는지는 재지 않은 채 fx를 접었다

Claude setup-token direct는 기술적으로 동작하지만 consumer OAuth identity 재사용이다. Anthropic이 승인한 일반 제3자 통합으로 간주하지 않으며 계정·ToS 위험을 별도로 관리한다.

상세는 `docs/architecture.md`와 `docs/provider-routing.md`.
