#!/usr/bin/env python3
"""보존된 fx usage 를 모델·날짜별로 집계한다.

fx 가 기록한 total_cost 는 쓰지 않는다. pi-ai 가 다른 가격표(전 항목 2/3배)를 쓰기 때문이다.
prices.json 의 검증된 단가로 다시 계산하고, 단가를 모르는 모델은 unknown 으로 표시한다.
"""
import json, pathlib, collections, datetime as dt, argparse

HERE = pathlib.Path(__file__).parent
ARCHIVE = pathlib.Path.home() / ".fx-audit" / "usage-archive.jsonl"


def load_prices():
    return {k: v for k, v in json.loads((HERE / "prices.json").read_text()).items()
            if not k.startswith("_")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--archive", default=str(ARCHIVE))
    args = ap.parse_args()

    prices = load_prices()
    path = pathlib.Path(args.archive)
    if not path.exists():
        print(f"아카이브가 없다: {path}\n먼저 ./snapshot.sh 를 돌려라.")
        return

    cutoff = (dt.datetime.now() - dt.timedelta(days=args.days)).timestamp() * 1000
    by = collections.defaultdict(lambda: {"n": 0, "unmeasured": 0, "u": 0, "r": 0,
                                          "w": 0, "o": 0, "cost": None})
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("kind") != "generation":
            continue
        f = r["fact"]
        if f["created_at_ms"] < cutoff:
            continue
        day = dt.datetime.fromtimestamp(f["created_at_ms"] / 1000).strftime("%m-%d")
        t = by[(day, f["model"])]
        t["n"] += 1
        if f["input_tokens"] == 0:
            # emptyFxUsage() 가 측정 실패를 0 으로 기록한다. 사용량 0 이 아니라 미측정이다.
            t["unmeasured"] += 1
            continue
        read, write = f["cache_read_tokens"], f["cache_write_tokens"]
        # fx 의 input_tokens 는 총계다 (piUsageToFx 가 input+cacheRead+cacheWrite 로 합친다).
        t["u"] += f["input_tokens"] - read - write
        t["r"] += read
        t["w"] += write
        t["o"] += f["output_tokens"]

    print(f"{'날짜':>6} {'모델':28} {'건수':>5} {'미측정':>6} {'read':>12} {'write':>10} {'out':>8} {'비용':>10}")
    print("-" * 96)
    total = 0.0
    unknown = set()
    for (day, model), t in sorted(by.items()):
        p = prices.get(model)
        if p:
            cost = (t["u"] * p["input"] + t["r"] * p["cache_read"]
                    + t["w"] * p["cache_write"] + t["o"] * p["output"]) / 1e6
            total += cost
            cs = f"${cost:.4f}"
        else:
            unknown.add(model)
            cs = "unknown"
        warn = f"{t['unmeasured']:>6}" if t["unmeasured"] else f"{'':>6}"
        print(f"{day:>6} {model:28} {t['n']:>5} {warn} {t['r']:>12,} {t['w']:>10,} {t['o']:>8,} {cs:>10}")
    print("-" * 96)
    print(f"단가를 아는 모델 합계  ${total:.4f}   (최근 {args.days}일)")
    if unknown:
        print(f"단가 미확인: {', '.join(sorted(unknown))}")
        print("  → prices.json 에 추가하라. 방법은 harness/bench/README.md 참조.")
    tot_un = sum(t["unmeasured"] for t in by.values())
    if tot_un:
        print(f"미측정 generation {tot_un}건 — emptyFxUsage() 가 usage 없는 응답을 0 으로 기록한 것이다.")
        print("  이 건들의 실제 사용량은 알 수 없으므로 위 합계는 하한이다.")


if __name__ == "__main__":
    main()
