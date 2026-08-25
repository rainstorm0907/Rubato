# 기억 저장소 마이그레이션 가이드

2026-08-26 변경분. **다른 머신에서 한 번씩 해야 하는 일**을 적는다.

버전을 받으면 코드는 자동으로 따라온다(프롬프트, `install.sh`, `resolve.ts`, `memory-search.py`, seed). 하지만 **이미 만들어진 기억 저장소는 자동으로 안 바뀐다** — seed 는 빈 저장소에만 먹고, 기존 저장소는 `initMemoryWithSeeds` 가 no-op 이다(`packages/memory-core/src/seeds/seeds.test.ts`). 그 손질이 이 문서다.

소요: 10~20분. 저장소에 쌓인 게 많으면 3번에서 더 걸린다.

---

## 무엇이 바뀌었나

| | 전 | 후 |
|---|---|---|
| 저장소 이름 | `<basename>-<sha256[:8]>` (cwd 해시) | 명시하면 **그 이름 그대로** |
| 저장소 경계 | 체크아웃마다 하나 | 프로젝트별. 관할이 같으면 **합칠 수 있다** |
| `msearch` | `~/.zshrc` alias 만 | `~/.local/bin` 심링크 (**비대화형 bash 에서도**) |
| 기억 쓰기 | 파일에 append | **한 파일 = 한 질문**, 제자리에서 고쳐 쓰기 |
| 디렉터리 | `reference/` 하나 | `decisions/`(뒤집히면 덮어씀) + `reference/`(조회용) |

배경과 근거는 `agent-taskforce/reference/memory-pipeline-design.md`.

---

## 0. 먼저 백업

```bash
tar czf ~/memory-backup-$(date +%Y%m%d-%H%M%S).tgz -C ~/.omo/memory agents
ls -lh ~/memory-backup-*.tgz | tail -1
```

아래 전부 되돌릴 수 있게 하는 유일한 안전망이다. **건너뛰지 마라.**

---

## 1. 최신 버전 받고 설치기 돌리기

```bash
cd <Rubato 클론>
git pull
./install.sh            # dry-run — 무엇을 할지만 보여준다
./install.sh --apply    # 실제 적용
```

`단계 4.2 · msearch 를 PATH 에` 가 보이면 맞다. 확인:

```bash
bash -lc 'command -v msearch'      # /Users/<you>/.local/bin/msearch
```

**아무것도 안 나오면** `~/.local/bin` 이 PATH 에 없는 것이다. rc 에 넣는다:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

> 왜 alias 로는 안 되나: 에이전트가 도구로 부르는 bash 는 **비대화형**이라 `~/.zshrc` 를 안 읽는다. 프롬프트는 `msearch` 로 기억을 찾으라고 지시하는데 그 명령이 없는 상태가 오래 갔다.

---

## 2. 저장소 정리 — 대부분은 버릴 것이다

```bash
cd ~/.omo/memory/agents
ls -d */ | wc -l                                   # 저장소 개수

# 저장소별 '진짜 내용' 개수. seed 는 세지 않는다.
for d in */repo; do
  n=$(find "$d" -name '*.md' \
        ! -path '*memory-discipline*' \
        ! -name 'persona.md' ! -name 'human.md' 2>/dev/null | wc -l | tr -d ' ')
  printf '%4s  %s\n' "$n" "${d%/repo}"
done | sort -rn
```

**0 인 저장소만 버릴 후보다.** 1 이상이면 무엇이 들었는지 반드시 눈으로 본다.

> 이 명령의 앞 버전은 임계값이 `-gt 2` 였다. 참고 머신에서 seed 가 3개라 그 숫자가 맞아 보였을 뿐이고, **내용 파일이 1~2개인 저장소를 "비었다"고 표시해 지우게 만든다.** 샌드박스로 마이그레이션 전 상태를 만들어 돌려보고 잡았다. 지금 형태는 임계값 대신 **전부 세어서 정렬**하므로 판단이 사람에게 남는다.

`persona.md` 는 대개 모든 저장소가 **바이트 단위로 동일**하다:

```bash
md5 -q */repo/system/persona.md 2>/dev/null | sort | uniq -c   # macOS
md5sum */repo/system/persona.md 2>/dev/null | awk '{print $1}' | sort | uniq -c  # Linux
```

빈 것들을 버린다. **지우기 전에 내용을 한 번 더 확인한다:**

```bash
find <저장소>/repo -name '*.md' ! -path '*memory-discipline*'   # 비어야 한다
rm -rf <저장소>
```

`runtime/` 만 있고 `repo/` 가 없는 것도 버려도 된다(전사·큐 캐시다).

---

## 3. 이름 정하고 저장소 옮기기

### 이름 규칙

- 소문자·숫자·하이픈만. 그러면 **해시 없이** 그 이름이 디렉터리가 된다.
- 그 외 문자가 있으면 슬러그로 접히고 해시가 붙는다(`Backend Lead` → `backend-lead-<해시>`). 피해라.
- **관할이 같으면 합쳐라.** 참고 머신은 하네스(Rubato)와 스킬(agent-taskforce)이 레포는 둘이어도 판단이 한 덩어리라 `rubato` 하나로 묶었다.

### 옮기기

```bash
cd ~/.omo/memory/agents
mv <옛-이름-해시> <새-이름>
cd <새-이름>/repo && git config omo.agentid <새-이름>
git log --oneline | wc -l          # 커밋 수가 그대로면 이력 보존된 것
```

`repo/.git` 이 통째로 따라가므로 이력은 안 잃는다.

### 설정 박기

기억을 공유할 **각 레포**에 `<레포>/.omo/omo.jsonc`:

```jsonc
{
  // 이 레포의 기억은 이름 붙은 저장소 하나로 모은다.
  "memory": {
    "agent": "<새-이름>"
  }
}
```

합치는 경우 **양쪽 레포에 같은 값**을 넣는다. 명시값은 문자열을 해시하므로(또는 슬러그 안전하면 그대로 쓰므로) 경로가 달라도 같은 저장소로 간다.

### 확인

```bash
cd <레포A> && msearch "아무 단어" | head -3    # [<새-이름>/repo/...] 로 시작해야 한다
cd <레포B> && msearch "아무 단어" | head -3    # 같은 이름이어야 한다
```

**한 곳만 보고 넘어가지 마라.** 참고 머신에서 정확히 이 함정을 밟았다 — 한쪽은 basename 이 우연히 새 이름과 같아서 **고치기 전에도 통과**했고, 다른 쪽에서만 0건이 나와 드러났다. 값이 우연히 겹치지 않는 위치에서 반드시 한 번 더 본다.

---

## 4. 기억 규칙 갱신 (`memory-discipline`)

**빈 저장소에는 자동으로 새 버전이 들어간다.** 기존 저장소는 안 바뀌므로 손으로 넣는다.

```bash
cd ~/.omo/memory/agents/<새-이름>/repo
grep '^version:' skills/memory-discipline/SKILL.md      # 0.1.0 이면 갱신 대상
```

`0.1.0` 이면 클론에서 꺼내 덮어쓴다:

```bash
cd <Rubato 클론>
bun -e 'import{MEMORY_DISCIPLINE_SKILL_CONTENT as c}from"./packages/memory-core/src/seeds/memory-discipline";process.stdout.write(c)' \
  > ~/.omo/memory/agents/<새-이름>/repo/skills/memory-discipline/SKILL.md

cd ~/.omo/memory/agents/<새-이름>/repo
grep '^version:' skills/memory-discipline/SKILL.md      # 0.2.0
```

> 이 파일이 **모델에게 기억 규칙이 닿는 유일한 경로**다. 저장소 안에 있어서 모델이 매번 읽는다. 이걸 안 갱신하면 나머지를 다 해놔도 다음 세션이 예전처럼 append 한다.

---

## 5. `decisions/` 와 `reference/` 가르기

기존 문서를 훑어 **6개월 뒤 이 답이 바뀌면 덮어쓸 것인가, 더할 것인가**로 가른다.

- **덮어쓸 것 → `decisions/`** — 판단. 포크할지 말지, 어떤 모델을 어디에, 왜 이 구조로
- **더할 것 → `reference/`** — 조회용 사실. 레이아웃, 카탈로그, 경로, 감사 범위

```bash
cd ~/.omo/memory/agents/<새-이름>/repo
mkdir -p decisions
grep -m1 '^description:' reference/*.md      # 한 줄씩 보고 가른다
git mv reference/<판단>.md decisions/
```

애매하면 `reference/` 에 둔다. `decisions/` 는 "여기 있는 건 뒤집힐 수 있다"는 신호라 잘못 넣으면 그 신호가 흐려진다.

---

## 6. 커밋하고 재색인

```bash
cd ~/.omo/memory/agents/<새-이름>/repo
git add -A && git commit -m "기억 저장소를 이름 기반으로 옮기고 결정과 참고를 가른다"

msearch --index      # 경로가 바뀌었으니 다시 건다
msearch --doctor     # 전부 초록이어야 한다
```

`--doctor` 가 Redis 를 못 찾으면 검색은 안 되지만 기억은 안전하다(파일과 git 은 그대로). Redis 를 올리고 `--index` 를 다시 돌리면 된다.

---

## 7. 최종 확인

```bash
bash -lc 'msearch "<네 저장소에 있을 만한 단어>"' | head -3
```

이게 `[<새-이름>/repo/...]` 를 돌려주면 끝이다. 세 가지가 동시에 성립한 것이다:
비대화형 bash 에서 `msearch` 가 잡히고, 새 이름으로 해석되고, 색인이 최신이다.

---

## 되돌리기

```bash
rm -rf ~/.omo/memory/agents
tar xzf ~/memory-backup-<타임스탬프>.tgz -C ~/.omo/memory
rm -f ~/.local/bin/msearch
# 각 레포의 .omo/omo.jsonc 에서 memory.agent 를 지운다 (또는 파일째)
```

코드는 되돌릴 필요 없다 — 명시 `memory.agent` 가 없으면 예전 auto 동작(cwd 해시) 그대로다.

---

## 함정

**이미 돌고 있는 세션은 옛 이름을 들고 있다.** 설정은 시작할 때 읽힌다. 마이그레이션 중에 세션이 떠 있었으면 옛 이름 디렉터리가 `runtime/` 만 갖고 되살아난다 — 무해하고, 지워도 된다. 새 이름은 **다음 세션부터** 붙는다.

**세션 안에서 `memory` 툴이 `cross-identity access denied` 를 낸다.** 같은 이유다. 그 세션은 옛 id 에 묶여 있다. 새 세션을 띄우면 풀린다.

**`git add -A` 를 저장소 밖에서 쓰지 마라.** 다른 세션이 같은 레포에서 작업 중일 수 있다. 마이그레이션은 경로를 찍어서 스테이징한다.

**`omo.jsonc` 는 JSONC 다.** 주석은 되지만 마지막 쉼표는 안 된다.
