# Rubato

커스텀 에이전트 하네스. `code-yeongyu/oh-my-openagent`(OMO) 포크 위에 오버레이를 얹었다.

이름은 *tempo rubato*("훔친 시간") — 템포의 재량을 지휘자가 아니라 연주자가 갖는 연주법.

## 이 레포에서 뭘 보면 되나

| 목적 | 위치 |
|---|---|
| 설치 | 루트 `install.sh` (기본 dry-run, 실제 설치는 `--apply`) |
| 하네스 정본 | [`harness/README.md`](harness/README.md) |
| 이 포크가 upstream과 다른 점 | [`docs/rubato/component-policy.md`](docs/rubato/component-policy.md) |
| 오버레이 설계 | [`harness/docs/rubato-pi-design.md`](harness/docs/rubato-pi-design.md) |
| 역할별 시스템 프롬프트 | `harness/prompts/` (조각이 정본, `build.sh` 로 합성) |
| 번들 스킬 | `harness/skills/` |

`packages/` 아래는 **upstream OMO 엔진 소스**다. 우리가 빌드해서 쓰지만 우리 코드가 아니다.

## 경계

- **실행은 Rubato.** 엔진 포크 + `rubato-pi` 오버레이 + 시스템 프롬프트 + provider bridge.
- **스킬·훅·기록은 agent-taskforce.** 하네스 없이도 의미가 있고 다른 CLI와 공유한다.

## 브랜치

- `rubato/base` — 기본 브랜치. 우리 작업은 전부 여기.
- `dev` — upstream 추적용. 건드리지 않는다.

upstream 받는 절차는 [`docs/rubato/component-policy.md`](docs/rubato/component-policy.md) 마지막 절.

## 엔진 소스를 고칠 때

`packages/` 아래를 건드리면 upstream 규약이 적용된다. QA 게이트, 증거 기록, PR 정책 전부 upstream 문서에 있다 → [`docs/upstream/AGENTS.upstream.md`](docs/upstream/AGENTS.upstream.md).

**포크에서 하는 수정은 적을수록 유리하다.** upstream 머지 비용이 그만큼 붙는다. 고치기 전에 오버레이(`harness/rubato-pi/`)에서 해결되는지 먼저 본다.
