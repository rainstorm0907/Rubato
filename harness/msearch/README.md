# msearch

에이전트 메모리를 의미 기반으로 검색한다. BM25 + 벡터 하이브리드에 한국어 형태소
토크나이즈와 최신성·앵커 가중치가 얹혀 있다.

원본은 `~/.claude/roo-channel/scripts` 에서 한 채널 전용으로 자란 코드다. 여기서는
경로와 이름공간을 설정으로 빼서 아무 메모리 저장소나 가리킬 수 있게 했다. 랭킹 로직은
건드리지 않았다 — 재활용의 알맹이가 거기 있다.

## 쓰기

```
msearch '찾을 내용'      검색
msearch --index          색인 갱신 (바뀐 파일만)
msearch --reindex        전체 재색인
msearch --doctor         설치 상태 진단
```

`--doctor` 부터 돌리면 된다. 뭐가 없는지와 다음에 뭘 할지 알려준다.

## 필요한 것

| 항목 | 이유 |
|------|------|
| Redis Stack | 벡터 + 전문 검색. **일반 redis 는 안 된다** — RediSearch 모듈이 필요하다 |
| `OPENAI_API_KEY` | 임베딩 생성 (`text-embedding-3-small`) |
| python 패키지 | `redis`, `python-dotenv`, `openai`, `konlpy` |

Redis Stack 띄우기:

```bash
docker run -d -p 6380:6379 --name msearch-redis redis/redis-stack-server:latest
```

또는 `brew tap redis-stack/redis-stack && brew install redis-stack`.

API 키는 환경변수로 두거나 `<state>/.env` 에 `OPENAI_API_KEY=sk-...` 한 줄로 둔다.
state 경로는 `--doctor` 가 알려준다.

## 설정

전부 선택이고, 기본값은 rubato 메모리 레이아웃을 가리킨다.

| 변수 | 기본값 | 뜻 |
|------|--------|-----|
| `MSEARCH_ROOT` | `~/.omo/memory/agents` | 색인 대상 루트 |
| `MSEARCH_STATE_DIR` | `<root>/../msearch-state` | 회상 로그·`.env` 등 런타임 상태 |
| `MSEARCH_REDIS_URL` | `redis://localhost:6380` | |
| `MSEARCH_INDEX` | `msearch_idx` | RediSearch 인덱스 이름 |
| `MSEARCH_CHANNEL` | `rubato` | 논리적 이름공간. 한 redis 에 여러 코퍼스를 나눠 담을 때 |
| `MSEARCH_EMBEDDING_MODEL` | `text-embedding-3-small` | |

`ROO_MEMORY_*` 도 계속 읽는다. roo-channel 에서 넘어온 기존 설정이 그대로 살아야 하기
때문이고, 새 이름이 있으면 새 이름이 이긴다.

다른 코퍼스를 가리키려면 루트와 채널을 같이 바꾼다. 채널을 안 바꾸면 한 이름공간에
두 코퍼스가 섞인다.

```bash
MSEARCH_ROOT=~/notes MSEARCH_CHANNEL=notes msearch --index
```

## 구조

| 파일 | 역할 |
|------|------|
| `msearch` | 진입점. 백엔드가 죽어 있으면 검색 대신 진단으로 보낸다 |
| `msearch_config.py` | 모든 경로·이름 해석. 다른 파일은 여기서만 읽는다 |
| `msearch_doctor.py` | 설치 진단 |
| `memory-index.py` | 마크다운 → 청크 → 임베딩 → Redis |
| `memory-search.py` | 하이브리드 검색과 랭킹 |
| `memory_affect.py` / `memory_entities.py` | 정서 신호, 인물 별칭 |
| `memory_episode_adapter.py` / `memory_episode_review.py` | 에피소드 v2 게이트 (선택 레이어, 없으면 통과) |

## 알아둘 것

- **색인은 자동이 아니다.** 메모리에 새로 쓴 내용은 `msearch --index` 를 돌려야 잡힌다.
- **검색 결과는 사용자 화면에만 뜬다.** 에이전트 컨텍스트로 자동 주입되지 않는다.
- 색인은 `.git/` 과 `runtime/` 을 제외한다 — 기억이 아니라 기계 상태다.
- 에피소드 v2 인덱스(sqlite)가 없으면 게이트는 전 건 통과시킨다. 순수 마크다운
  코퍼스에서는 그게 정상 동작이다.
