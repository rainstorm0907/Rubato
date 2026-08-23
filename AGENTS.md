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

## 커밋 메시지

**diff 를 읽으면 알 수 있는 것은 적지 않는다.** 무엇을 바꿨는지는 코드가 이미 말하고 있고,
나중에 이 줄을 찾아오는 사람은 그것 때문에 오지 않는다. **왜 그렇게 판단했는지를 적는다** —
어떤 상황이었고, 무엇을 보고 그렇게 결정했고, 무엇을 버렸는지. 이것은 코드 어느 자리에도
남지 않아서, 여기서 잃으면 영영 사라진다.

가장 값진 것들:

- **버린 선택과 그 이유.** 다음에 같은 자리에 선 사람이 같은 길을 다시 탐색하지 않게 한다.
- **증상이 아니라 구조.** "A 를 고쳤다" 보다 "A 와 B 가 겹쳐 서로를 막는 고리였다" 가 오래 쓰인다.
- **틀렸던 과정.** 진단을 한 번에 맞힌 적은 드물다. 어디서 틀렸고 무엇이 그것을 갈랐는지가
  다음 사람의 시간을 가장 많이 아낀다.
- **검증.** 실제로 돌린 것과 그 결과. 돌리지 않은 것은 적지 않는다.

제목은 Conventional Commits 를 따른다:

```
<type>(<scope>): <무엇을 했는가>
```

- **type** 은 이 중 하나: `feat` `fix` `refactor` `docs` `test` `build` `chore` `perf` `revert`.
  이력을 훑을 때 성격이 바로 보이는 것이 목적이다.
- **scope** 는 선택. 쓸 때는 이미 쓰이는 이름을 따른다 — `rubato`, `harness`, `bridge`,
  `prompts`, `omo-senpi`, `senpi-task`, `skills`. 새로 지어내기 전에 `git log` 를 먼저 본다.
- 제목 본문은 **한 줄, 50자 안팎의 평서형**. `git log --oneline` 이 한 화면에 들어와야 한다.
  한국어로 써도 되고 영어로 써도 된다.

나머지:

- 본문은 문제 → 판단 → 검증 순서. 길이보다 밀도가 중요하다 — 회고문이 아니다.
- `git commit -m` 으로 여러 줄을 쓰지 않는다. `\n` 이 글자 그대로 박힌 커밋이 이미 이력에 있다.
  여러 줄은 `git commit -F -` 와 히어도큐먼트로 쓴다.

`packages/` 아래를 건드렸다면 upstream 규약을 따른다(아래).

## 엔진 소스를 고칠 때

`packages/` 아래를 건드리면 upstream 규약이 적용된다. QA 게이트, 증거 기록, PR 정책 전부 upstream 문서에 있다 → [`docs/upstream/AGENTS.upstream.md`](docs/upstream/AGENTS.upstream.md).

**포크에서 하는 수정은 적을수록 유리하다.** upstream 머지 비용이 그만큼 붙는다. 고치기 전에 오버레이(`harness/rubato-pi/`)에서 해결되는지 먼저 본다.
