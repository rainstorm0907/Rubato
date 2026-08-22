# audit — 하네스 사용량을 나중에 감사할 수 있게 보존한다

실제 태스크를 굴리면서 "어느 모델에 얼마 썼나"를 나중에 확인하기 위한 최소 도구다.

## 왜 필요한가

**fx 는 약 35일 retention 으로 오래된 generation fact 를 지운다.** 그 창을 넘어서면 기록이 없다.
`snapshot.sh` 가 지워지기 전에 아카이브로 옮긴다. 같은 id 는 다시 저장하지 않으므로 몇 번 돌려도 안전하다.

```bash
./snapshot.sh                 # ~/.fx/usage.jsonl -> ~/.fx-audit/usage-archive.jsonl
python3 report.py --days 7    # 날짜·모델별 토큰과 비용
```

하루 한 번 자동으로 돌리려면:

```bash
(crontab -l 2>/dev/null; echo "0 4 * * * $(pwd)/snapshot.sh >> ~/.fx-audit/snapshot.log 2>&1") | crontab -
```

## 비용을 어떻게 계산하는가

**fx 가 기록한 `total_cost` 는 쓰지 않는다.** pi-ai 의 `calculateCost` 가 다른 가격표를 쓴다 —
역산하면 전 항목이 정확히 2/3배다. 그대로 믿으면 실제보다 1/3 싸게 보인다.

`prices.json` 의 단가로 다시 계산한다. 그 단가는 추정이 아니라 **Claude Code 가 보고한 실제
`total_cost_usd` 에서 역산한 값**이다(오차 0.00%). 새 모델을 추가할 때도 같은 방법을 쓴다 —
방법은 `harness/bench/README.md` 의 "가격을 어떻게 얻는가" 절에 있다.

단가를 모르는 모델은 `unknown` 으로 표시하고 합계에서 뺀다. 추정치로 채우지 않는다.

## 읽을 때 주의할 것

**`미측정` 열이 0 이 아니면 합계는 하한이다.**
`fx-stream.ts` / `direct-provider.ts` 의 `usage: piUsageToFx(...) ?? emptyFxUsage()` 가
usage 없는 응답에 전부 0 인 usage 를 붙여 내보내고, fx 가 그것을 그대로 기록한다.
사용량이 0 인 것이 아니라 **측정에 실패한 것**이다. 지금까지 xAI 경로에서만 관측됐다.

**usage.jsonl 에는 세션/턴 ID 가 없다.** 프로필 전역 원장이라 "이 generation 이 어느 작업의
몇 번째 턴인지"를 사후에 확정할 수 없다. 작업 단위로 나누려면 그 작업의 시작·끝 시각을 따로
남기고 시간창으로 join 해야 한다 (`harness/bench/run-fx.sh` 가 그렇게 한다).

**벤치를 돌린 날은 그 비용이 섞인다.** 실사용 비용만 보려면 벤치 실행 시간대를 제외하라.

## 다른 하네스

- **meight (Codex)**: `~/.meight/workers/<name>/status.json` 에 `tokens`, `model`, `effort`, `state` 가 있다. 세션별 파편이라 통합 집계는 아직 없다.
- **Claude Code**: `~/.claude/projects/<encoded>/<session>.jsonl` transcript 에 `message.usage` 가 있다. 헤드리스(`claude -p --output-format json`)는 `total_cost_usd` 를 직접 준다 — 이게 이 레포에서 유일하게 신뢰하는 비용 값이다.

세 소스를 같은 스키마로 뽑는 추출기는 `~/Downloads/agent-cache-measurement-kit-v0.1.zip` 에 있다.
`discover` 로 위치를 찾고 `extract --source all` 로 `requests.jsonl` / `turns.csv` / `sessions.csv` 를 만든다.
