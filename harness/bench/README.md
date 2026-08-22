# bench — fx와 Claude Code를 같은 태스크로 재는 도구

같은 모델·같은 태스크를 두 하네스에 던지고 토큰과 시간을 같은 척도로 뽑는다.
"어느 하네스가 싼가"는 이걸로만 답한다. 하네스가 스스로 보고하는 비용은 믿지 않는다.

## 쓰는 법

```bash
cd harness/bench
OUT=/tmp/bench-$(date +%s)

# 조건을 고정하려면 레포 스냅샷을 뜬다 (다른 세션이 파일을 고치는 중일 수 있다)
REPO=/tmp/bench-repo
rsync -a --exclude node_modules --exclude .git --exclude zig-out ../ "$REPO/harness/"

MODEL=sonnet REPO="$REPO" TASKS=tasks/repo-comprehension.txt OUT="$OUT" ./run-cc.sh
FX_MODEL=anthropic/claude-sonnet-5 REPO="$REPO" TASKS=tasks/repo-comprehension.txt OUT="$OUT" ./run-fx.sh

python3 compare.py "$OUT"
python3 compare.py "$OUT" --to 6     # 무효 구간을 잘라낼 때
```

`run-fx.sh`는 bridge(`../scripts/start.sh`)가 떠 있어야 한다.

## 반드시 알아야 하는 함정

**1. 두 하네스의 `cost` 필드를 나란히 놓지 마라.**
서로 다른 방식으로 계산된 값이다. fx 쪽은 pi-ai 추정치이고 청구서가 아니다.
실제로 fx가 프롬프트 토큰을 7.8배 쓰는데도 보고 비용은 27% *낮게* 나온 적이 있다.
`compare.py`가 토큰 배수를 주 지표로 내는 이유다. 같은 모델이면 토큰이 곧 비용이다.

**2. 토큰 semantics가 하네스마다 다르다.**
- fx: bridge의 `piUsageToFx`가 `inputTokens.total = input + cacheRead + cacheWrite`로 만든다.
  즉 `input_tokens`가 **총계**이고 `cache_read`는 그 부분집합이다.
- Claude Code: `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`가 **배타적**이다.

같은 식으로 cache-read share를 계산하면 90.9%가 46.0%로 나온다. `compare.py`가 분기한다.

**3. Claude Code는 유사한 질문이 이어지면 작업을 거부한다.**
실측에서 턴 7부터 "같은 12개 질문 세트가 여덟 번째로 반복 전송되고 있습니다.
내용에 변화가 없어 다시 답변을 채우지 않겠습니다"라며 멈췄다. fx는 같은 턴에서 정상 답변했다.
그 구간을 비교에 넣으면 Claude Code 비용이 부당하게 낮게 나온다.
`compare.py`가 답변 길이 급감으로 감지해 경고하지만, **태스크를 서로 충분히 다르게 쓰는 것이 근본 대책이다.**

**4. `fx ask --no-save`를 쓰지 마라.**
세션 저장 모드에서만 `x-session-id`/`x-session-affinity`가 실린다. `--no-save`면
`server.ts`가 `sessionId`를 못 읽어 `prompt_cache_key`가 아예 안 실리고, 캐시 라우팅이 깨진다.
usage publisher도 붙지 않아 `~/.fx/usage.jsonl`에 아무것도 안 남는다.

**5. 벤치 중에 다른 fx 호출을 섞지 마라.**
`~/.fx/usage.jsonl`은 프로필 전역이다. `run-fx.sh`가 before/after 스냅샷을 떠서 델타로 집계하므로
같은 시간에 다른 fx가 돌면 그 generation이 벤치 수치에 섞인다.

**6. `usage 미측정` 건수를 확인하라.**
`fx-stream.ts`/`direct-provider.ts`가 `usage: piUsageToFx(...) ?? emptyFxUsage()`로 되어 있어,
응답에 usage가 없으면 **전부 0인 usage**를 기록한다. 측정 실패를 0으로 뭉갠 것이다.
`compare.py`가 이 건수를 따로 센다. 0이 아니면 분모가 오염된 상태이므로 비율을 믿지 마라.
xAI 경로에서 관측됐고 anthropic 경로에서는 아직 0건이다.
(`harness/docs/provider-routing.md`가 같은 결론에 도달했다 — `0`이 아니라 `unavailable`로 기록해야 한다.)

## 가격을 어떻게 얻는가 — 하네스가 보고하는 cost를 쓰지 마라

`compare.py`는 토큰만 낸다. 실제 가격은 **Claude Code가 보고한 `total_cost_usd`에서 단가를 역산해서** 구한다.
Claude Code의 cost는 Anthropic이 계산한 값이고, 턴별 (uncached, read, write, output) → cost 를
최소제곱으로 풀면 단가가 나온다. 실측에서 오차 0.00%로 떨어졌다.

```
claude-sonnet-5 ($/1M):  input 3.00 · cache_read 0.30 · cache_write 6.00 · output 15.00
```

`cache_write`가 input의 2배면 1시간 캐시다(5분은 1.25배). Claude Code는 1시간 캐시만 쓴다
(응답의 `cache_creation.ephemeral_1h_input_tokens` 로 확인).

**fx가 보고하는 cost는 틀렸다.** pi-ai의 `calculateCost`가 다른 가격표를 쓴다 —
역산하면 input 2.00 / read 0.20 / write 4.00 / output 10.00 으로 **전 항목이 정확히 2/3배**다.
fx 토큰에 위 실측 단가를 곱해야 실제 비용이 나온다.

fx의 토큰 자체는 정확하다. pi-ai가 Anthropic의 `input_tokens`(uncached) / `cache_read_input_tokens` /
`cache_creation_input_tokens` 를 그대로 가져오고, bridge의 `piUsageToFx` 가 셋을 합쳐
`total` 로 만들며, fx는 그 `total` 을 `input_tokens` 로 기록한다. 즉 **fx의 `input_tokens` = uncached + read + write** 다.

fx도 1시간 캐시를 쓴다. `getCacheControl` 이 retention `long` + Anthropic baseUrl 이면 `ttl: "1h"` 를 붙이고,
bridge config 기본값이 `long` 이다.

## 실측 기록 — 2026-08-21

`claude-sonnet-5`, `tasks/repo-comprehension.txt` 12턴, 레포 스냅샷 828파일, 태스크는 레포 밖(`~/.cache/bench/`).

검증을 통과한 실행이다: 양쪽 12턴 전부 성공, 답변이 턴별로 하나씩(시험지 노출 없음), 거부 구간 없음,
모델 동일(`claude-sonnet-5`), fx generation 60건 중 59건이 턴 시간창 안, `usage=0` 0건.

| 턴 1-12 | fx | Claude Code | 배수 |
|---|---|---|---|
| uncached input | 118 | 108 | 1.09x |
| cache read | 5,933,528 | 5,332,252 | 1.11x |
| **cache write** | **752,737** | **196,716** | **3.83x** |
| output | 25,426 | 33,170 | 0.77x |
| **비용** | **$6.68** | **$3.28** | **2.04x** |
| 시간 | 343s | 439s | 0.78x |
| generation | 59 | 74 | 0.80x |
| 답변 분량 | 32,692자 | 15,337자 | 2.13x |

**fx가 2.04배 비싸다. 차이의 몸통은 cache write 3.83배 하나다.**
read와 uncached는 사실상 같고, 캐시 쓰기 단가가 읽기의 20배라 그것만으로 비용이 갈린다.
fx는 시간이 22% 짧고 최종 답변이 2배 길다. 답변 품질은 채점하지 않았으므로 길이를 품질로 읽지 마라.

cache write가 왜 3.83배인지는 아직 모른다. 12턴이면 fx의 8턴 history compaction이 발동하는 구간이라
의심은 가지만 확인하지 않았다.

## 디버깅 벤치 — `run-debug.sh`

읽기 태스크는 "잘 찾기"를 잴 뿐 코딩이 아니다. 파일을 고치고 검증하는 축은 픽스처로 따로 잰다.

```bash
HARNESS=cc MODEL=opus OUT=/tmp/dbg ./run-debug.sh
HARNESS=fx FX_MODEL=anthropic/claude-opus-5 OUT=/tmp/dbg ./run-debug.sh
```

픽스처는 `fixtures/` 에 있고 전부 **2026-08-21 세션에서 실제로 겪은 버그**다.
증상은 보이는데 원인이 다른 층에 있는 것들만 골랐다.

| 픽스처 | 증상 | 원인 |
|---|---|---|
| `01-stdin-leak` | 배치 러너가 4줄 중 1줄만 처리 | `while ... done < file` 안에서 자식이 stdin을 상속해 나머지를 소비 |
| `02-cache-share` | 두 하네스 캐시 효율이 46.7% 대 92.0% | 한쪽은 `input_tokens`가 총계인데 배타적으로 취급해 분모를 부풀림 |
| `03-empty-ledger` | 원장에 `incident`만 쌓이고 사용량 0건 | relay가 SSE에 `providerMetadata.gateway.generationId`를 안 실어 collector가 폐기 |

설계 규칙 셋을 지켰다. `verify.sh`는 **동작만 보고 특정 코드를 찾지 않는다**(어떻게 고치든 통과).
기능을 지워서 통과하는 것을 막는 검사를 넣었다(02는 데이터 수정 금지, 03은 collector 수정 금지).
**정답은 픽스처 안에 두지 않는다.** 초기 상태는 각 픽스처의 git으로 고정한다.

프록시 400 버그는 뺐다. 이 세션이 원인을 확정하지 못한 버그라 채점 기준을 만들 수 없다.

### 실측 — Opus 5, 2026-08-21

| | fx | Claude Code |
|---|---|---|
| 성공 | **3/3** | **3/3** |
| 시간 | 142s | 144s |
| 비용 | **$1.049** | **$0.859** |
| cache read | 498,354 | 253,278 |
| cache write | 52,865 | 49,451 |

`claude-opus-5` 단가도 같은 방법으로 역산했다(오차 0.00%):
`input 5.00 / cache_read 0.50 / cache_write 10.00 / output 25.00` per 1M.
Sonnet에서 확인된 비율 `1 : 0.1 : 2 : 5` 가 Opus에서도 성립했다.

**fx가 22% 비싸고 성공률과 속도는 같다.** 읽기 태스크의 2.04배보다 차이가 훨씬 작다.
토큰 패턴도 다르다 — 읽기에서는 fx의 cache write가 3.83배였는데 여기서는 write가 1.07배로 같고
read가 1.97배다. 읽기 태스크에서 fx를 비싸게 만든 요인이 디버깅에서는 나타나지 않는다.

수정 내용을 확인한 결과 양쪽 다 원인을 정확히 짚었고 우회는 없었다. 허용된 파일만 고쳤다.

### 턴이 쌓이면 어떻게 되는가

읽기 태스크 12턴의 턴별 비용비(fx/cc): 전반 6턴 **1.84배**, 후반 6턴 **2.24배**.
세션이 길어질수록 fx가 상대적으로 더 비싸진다.

다만 턴별 비율이 0.17에서 4.92까지 튄다. n=12로 추세를 단정하기에는 약하고,
반복 실행으로 중앙값을 봐야 한다.

**집계 함정**: 턴 시간창에 뒤로 3초 여유를 주는데, 다음 턴이 그 안에 시작하면
앞 턴이 뒷 턴의 generation을 삼킨다. 실측에서 마지막 턴이 0건이 되고 앞 턴의 write가
read보다 커지는 왜곡이 나왔다. `compare.py`는 다음 턴 시작 직전에서 창을 자른다.
총합은 영향이 없고 턴별 분배만 달라지지만, 이 왜곡 상태로 전반/후반을 비교하면 **추세 방향이 반대로 나온다.**

## 미완

- 답변 품질 자동 채점. 지금은 분량만 본다. 정답이 정해진 질문(파일 목록, 설정값)에 대한 채점 키를 붙이는 것이 가장 싸다.
- 태스크 세트가 하나뿐이다. Claude Code의 거부를 피하려면 성격이 다른 질문을 섞은 세트가 더 필요하다.
- `xai/*` 모델 측정. xAI 캐시는 서버별 저장이고 언제든 evict되므로(§`case-studies/cache/`) 캐시 수치가 진동한다. 반복 실행 후 중앙값을 봐야 한다.

## grok 두 경로 재기 — `run-grok.sh` / `run-meight.sh`

같은 Grok을 **grok CLI로 직접** 부를 때와 **meight(Codex 세션 + opencodex 라우팅)** 로 부를 때를
같은 척도로 잰다. 러너 둘은 위 fx/cc 러너와 같은 시험지 격리 규칙을 따른다.

```bash
OUT=/tmp/bench-$(date +%s)
REPO=/tmp/bench-repo
rsync -a --exclude node_modules --exclude .git --exclude zig-out --exclude .zig-cache \
      --exclude bench ../ "$REPO/harness/"

TAG=grok      MODEL=grok-4.6           REPO=$REPO TASKS=tasks/repo-comprehension.txt OUT=$OUT ./run-grok.sh
TAG=grok-ocx  MODEL=ocx-xai-grok-4-6   REPO=$REPO TASKS=tasks/repo-comprehension.txt OUT=$OUT ./run-grok.sh
MEIGHT_MODEL=grok NAME=bench-$(date +%s) REPO=$REPO TASKS=tasks/repo-comprehension.txt OUT=$OUT ./run-meight.sh

python3 compare.py "$OUT" --arms meight,grok
python3 compare.py "$OUT" --arms grok-ocx,grok     # 라우팅 효과만
```

`grok` vs `meight` 는 하네스와 라우팅이 함께 달라지는 비교다. 두 효과를 분리하려면
중간 축(`grok-ocx` = 하네스는 grok CLI, 라우팅은 opencodex)이 필요한데 **그 축은 지금 못 쓴다.**

**`grok-ocx` 는 툴 호출이 나가지 않는다 (2026-08-21 실측).** 디버깅 픽스처 2개에서 모델이
"증상 파일부터 읽어볼게"라고 말만 하고 `end_turn` 했다 — `num_turns=1`, output 154토큰, 9초와 7초 만에 FAIL.
같은 opencodex 를 쓰는 meight 는 3/3 통과했으므로 프록시 자체가 아니라 **grok CLI ↔ opencodex 조합**의
문제다. grok CLI 가 보내는 툴 정의를 `openai-chat` 어댑터가 넘기지 못하는 쪽을 의심하지만 확정하지 않았다.
이 축을 되살리려면 그것부터 고쳐야 한다.

### 이 비교에서만 붙는 함정

**7. 세 경로가 어디로 나가는지 — `ocx provider show xai` 를 믿지 마라.**

| 경로 | 실제 엔드포인트 | wire | 토큰 특권 |
|---|---|---|---|
| grok CLI 직결 | grok.com (응답 모델명 `grok-4.6-build`) | — | 구독 |
| meight (opencodex) | `cli-chat-proxy.grok.com/v1` | Chat Completions | `grok-cli:access` |
| fx | `api.x.ai/v1` | Responses | `api:access` |

`ocx provider show xai` 는 `baseUrl=https://api.x.ai/v1` 을 보여주지만 **그건 저장된 값일 뿐이다.**
OAuth 모드면 런타임에 덮어쓴다 — `@bitkyc08/opencodex/src/providers/xai-transport.ts:5,144`
(`XAI_GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1"`), 그리고 같은 파일 `:33,113` 이
Grok CLI 위장 헤더(`x-xai-token-auth: xai-grok-cli`)를 붙인다.

즉 **opencodex 경유와 fx 는 같은 OAuth 토큰의 서로 다른 두 특권을 쓴다.** 스코프는
`~/.senpi/agent/auth.json` 하나에 둘 다 들어 있다(`pi-ai/dist/auth/oauth/xai.js:6`).
**비용은 어느 조합도 나란히 놓지 마라.** 캐시·속도·품질만 비교가 성립한다.

**8. 시스템 프롬프트가 다르다 — 이건 교란이 아니라 측정 대상이다.**
`~/.codex/opencodex-catalog.json` 의 `xai/grok-4.6` 이 `base_instructions` 로 Codex 프롬프트를
통째로 주입한다("You are a coding agent powered by the grok-4.6... As Codex, ...").
grok CLI 는 자기 프롬프트와 사용자 메모리를 쓴다. 프리픽스 캐시의 몸통이 서로 다르다.

**9. opencodex 경유는 `total_cost_usd` 를 안 준다.**
grok CLI 직결 응답에는 있지만 `ocx-*` 모델 응답에는 없다. 비용이 필요하면
`ocx observe usage --range 7d` 에서 가져온다. 그쪽도 `unmeteredRequests` 가 있으니 분모를 확인하라.

**10. meight 의 `tokens` 는 스레드 누적이고 `cache_write` 를 보고하지 않는다.**
`run-meight.sh` 가 턴 전후 차분으로 턴별 값을 만들지만, 한 턴 안에 요청이 여러 개라
**턴별로는 `cached` 델타가 `input` 델타를 넘을 수 있다.** 합계에서는 일관된다 —
meight 축은 턴별이 아니라 구간 합으로 읽어라. write 는 미보고이지 0 이 아니다.

**11. 단발 측정을 믿지 마라.**
xAI 캐시는 서버별로 저장되고 부하·재시작으로 임의 evict 된다
(`case-studies/cache/fx-cache-investigation-checkpoint.md`).
프리픽스가 멀쩡해도 그 서버에 안 닿으면 `cache_read=128`(1블록, 사실상 전량 미스)이 나온다.
반복 실행 후 중앙값을 봐라.

### 아직 안 잰 것 — 품질

`compare.py` 는 토큰과 시간만 낸다. `fixtures/` 3개는 이전 실측에서 두 하네스가 3/3 동률이라
**변별력이 0이었다.** 품질을 재려면 픽스처를 늘리거나 답변을 채점하는 축을 새로 만들어야 한다.
답변 분량을 품질로 읽지 마라.

### 실측 기록 — 2026-08-21, 디버깅 픽스처 3개

`fixtures/` 3개를 독립 시행으로 각 하네스에 던졌다. `grok` = grok CLI 직결(`grok-4.6`),
`meight` = meight worker + opencodex(`xai/grok-4.6`).

| | fx (api.x.ai 직결) | grok CLI 직결 | meight + opencodex |
|---|---|---|---|
| 통과 | 3/3 | 3/3 | 3/3 |
| 시간 | **102s** (평균 34s) | 145s (평균 48s) | 234s (평균 78s) |
| cache-read 비율 | 75.8% | 67.5% | 84.6% |
| 프롬프트 총량 | **339,080** | 409,197 | 919,811 |
| uncached | **82,184** | 132,973 | 141,315 |
| output | 5,782 | 7,215 | 8,327 |

**프롬프트 총량 순서가 시간 순서와 그대로 일치한다.** 339K→409K→920K 에 102s→145s→234s 다.
meight 가 무거운 것은 Codex 시스템 프롬프트 위에 meight 계약 문서까지 매 요청 실리기 때문으로 보이지만
확인하지 않았다. fx 가 빠른 이유가 직결 때문인지 하네스가 가벼워서인지는 **이 실측으로 갈리지 않는다** —
둘 다 다르다.

**cache-read 비율을 단독으로 읽지 마라.** meight 가 84.6% 로 가장 높지만 셋 중 가장 느리고 가장 많이 쓴다.
비율이 높은 것은 캐시가 잘 걸려서이기도 하지만 **분모가 크기 때문**이기도 하다.
비율이 높은 것은 캐시가 잘 걸려서이기도 하지만 **분모가 가장 크기 때문**이다.
비율로 줄을 세우면 순서가 정확히 거꾸로 나온다.

**품질은 이번에도 안 갈렸다.** 3/3 동률이다. 이 픽스처 3개는 두 번째 비교에서도 변별력이 0이었다.
품질을 재려면 더 어려운 픽스처가 필요하다.

n=3 단발이고 xAI 캐시는 서버별로 저장되며 임의 evict 된다. 캐시 수치는 반복 후 중앙값으로 다시 재야 한다.
