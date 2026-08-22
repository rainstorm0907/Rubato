#!/usr/bin/env python3
"""디버깅 픽스처 결과를 하네스별로 집계한다.

usage: python3 compare-debug.py <out-dir> [tag ...]
태그를 안 주면 <out>/*-debug.jsonl 을 전부 읽는다.
"""
import json, sys, pathlib, glob


def load(p):
    p = pathlib.Path(p)
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def main():
    out = sys.argv[1]
    tags = sys.argv[2:] or [pathlib.Path(f).name[:-len("-debug.jsonl")]
                            for f in sorted(glob.glob(f"{out}/*-debug.jsonl"))]
    table = {}
    for tag in tags:
        rows = load(f"{out}/{tag}-debug.jsonl")
        if not rows:
            continue
        table[tag] = rows

    if not table:
        print("결과 파일이 없다.")
        return

    fixtures = sorted({r["fixture"] for rows in table.values() for r in rows})

    print("=== 픽스처별 통과 ===")
    print(f"  {'fixture':22}" + "".join(f"{t:>16}" for t in table))
    for f in fixtures:
        line = f"  {f:22}"
        for tag, rows in table.items():
            r = next((x for x in rows if x["fixture"] == f), None)
            if r is None:
                line += f"{'-':>16}"
            else:
                secs = (r["end_ms"] - r["start_ms"]) / 1000
                line += f"{('PASS' if r['pass'] else 'FAIL') + f' {secs:.0f}s':>16}"
        print(line)
    print()

    print("=== 하네스별 합계 ===")
    for tag, rows in table.items():
        # 총계형(meight/fx)은 input 이 cache_read 를 포함하고, 배타형(cc/grok CLI)은 배타적이다.
        total = sum(1 for r in rows if r.get("semantics") == "total")
        exclusive = len(rows) - total
        assert not (total and exclusive), f"{tag}: semantics 가 섞여 있다"
        inp = sum(r.get("input", 0) for r in rows)
        rd = sum(r.get("cache_read", 0) for r in rows)
        wr = sum(r.get("cache_write", 0) for r in rows)
        op = sum(r.get("output", 0) for r in rows)
        secs = sum((r["end_ms"] - r["start_ms"]) / 1000 for r in rows)
        basis = inp if total else inp + rd + wr
        uncached = (inp - rd - wr) if total else inp
        costs = [r.get("cost") for r in rows if r.get("cost") is not None]
        print(f"  {tag}")
        print(f"    통과        {sum(1 for r in rows if r['pass'])}/{len(rows)}")
        print(f"    시간        {secs:.0f}s  (평균 {secs/len(rows):.0f}s)")
        print(f"    cache-read  {rd/basis:.1%}" if basis else "    cache-read  측정 없음")
        print(f"    프롬프트    {basis:,} 토큰  (uncached {uncached:,} / read {rd:,} / write {wr:,})")
        print(f"    output      {op:,}")
        if wr == 0 and total:
            print("    * cache_write 는 이 하네스가 보고하지 않는다 — 미보고이지 0 이 아니다.")
        if costs:
            print(f"    보고 비용   ${sum(costs):.4f}  (모델이 다르면 나란히 놓지 마라)")
        else:
            # cost 가 없는 이유는 하네스마다 다르다. opencodex 경유는 응답에 아예 안 실리고,
            # fx 는 pi-ai 의 cost 가 틀린 가격표를 쓰므로(전 항목 2/3배) 러너가 일부러 버린다.
            print("    보고 비용   미보고 (토큰으로 읽어라)")
        print()

    print("모델이 다르면 비용은 비교가 안 된다. 캐시·시간·통과만 읽어라.")
    print("xAI 캐시는 서버별이고 임의 evict 된다 — 단발 수치를 믿지 말고 반복 후 중앙값을 봐라.")


if __name__ == "__main__":
    main()
