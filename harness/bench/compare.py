#!/usr/bin/env python3
"""fx와 Claude Code 벤치 결과를 같은 척도로 비교한다.

fx는 ~/.fx/usage.jsonl 델타를 턴 시간창에 join하고, Claude Code는 헤드리스 JSON을 쓴다.
usage: python3 compare.py <out-dir> [--from N] [--to N]
"""
import json, sys, pathlib, argparse


def load_jsonl(p):
    p = pathlib.Path(p)
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def fx_rows(out):
    """턴 시간창으로 generation fact를 묶는다. usage가 0인 fact는 따로 센다."""
    before = {f["fact"]["id"] for f in load_jsonl(f"{out}/fx-usage-before.jsonl")
              if f.get("kind") == "generation"}
    after = [f["fact"] for f in load_jsonl(f"{out}/fx-usage-after.jsonl")
             if f.get("kind") == "generation"]
    new = sorted((f for f in after if f["id"] not in before), key=lambda f: f["created_at_ms"])
    turns = load_jsonl(f"{out}/fx-turns.jsonl")
    rows = []
    claimed = set()  # 턴 창이 겹쳐 같은 generation이 두 번 세지는 것을 막는다
    for i, t in enumerate(turns):
        # 기록이 응답 종료 직후에 떨어지므로 뒤로 3초 여유를 준다. 다만 다음 턴이
        # 그 안에 시작하면 여유가 다음 턴 것을 삼키므로 경계에서 자른다.
        nxt = turns[i + 1]["start_ms"] if i + 1 < len(turns) else float("inf")
        hi = min(t["end_ms"] + 3000, nxt - 1)
        gens = [g for g in new
                if t["start_ms"] <= g["created_at_ms"] <= hi
                and g["id"] not in claimed]
        claimed.update(g["id"] for g in gens)
        real = [g for g in gens if g["input_tokens"] > 0]
        rows.append({
            "turn": t["turn"], "harness": "fx", "semantics": "total",
            "seconds": (t["end_ms"] - t["start_ms"]) / 1000,
            "generations": len(gens),
            # emptyFxUsage() 때문에 usage 없는 응답이 0으로 기록된다. 측정 실패이지 0이 아니다.
            "unmeasured": len(gens) - len(real),
            "input": sum(g["input_tokens"] for g in real),
            "cache_read": sum(g["cache_read_tokens"] for g in real),
            "cache_write": sum(g["cache_write_tokens"] for g in real),
            "output": sum(g["output_tokens"] for g in real),
            "cost": sum(g["total_cost"] for g in gens),
            "answer_chars": t.get("answer_chars", 0),
            "ok": t.get("rc") == 0,
        })
    return rows


def cc_rows(out):
    rows = []
    for r in load_jsonl(f"{out}/cc-usage.jsonl"):
        if "error" in r:
            rows.append({"turn": r["turn"], "harness": "claude-code", "semantics": "exclusive", "ok": False,
                         "generations": 0, "unmeasured": 0, "seconds": 0, "input": 0,
                         "cache_read": 0, "cache_write": 0, "output": 0, "cost": 0,
                         "answer_chars": 0})
            continue
        rows.append({
            "turn": r["turn"], "harness": "claude-code", "semantics": "exclusive",
            "seconds": (r["end_ms"] - r["start_ms"]) / 1000,
            "generations": r.get("generations", r.get("num_turns", 0)), "unmeasured": 0,
            "input": r["input"], "cache_read": r["cache_read"],
            "cache_write": r["cache_write"], "output": r["output"],
            "cost": r.get("cost") or 0.0, "answer_chars": r.get("answer_chars", 0),
            "ok": not r.get("is_error"),
        })
    return rows


def exclusive_rows(out, tag):
    """usage 가 배타적인 하네스 (Claude Code, Grok CLI) 의 턴 로그를 읽는다."""
    rows = []
    for r in load_jsonl(f"{out}/{tag}-usage.jsonl"):
        if "error" in r:
            rows.append({"turn": r["turn"], "harness": tag, "ok": False,
                         "generations": 0, "unmeasured": 0, "seconds": 0, "input": 0,
                         "cache_read": 0, "cache_write": 0, "output": 0, "cost": 0,
                         "answer_chars": 0, "semantics": "exclusive"})
            continue
        rows.append({
            "turn": r["turn"], "harness": tag,
            "seconds": (r["end_ms"] - r["start_ms"]) / 1000,
            "generations": r.get("generations", 0), "unmeasured": 0,
            "input": r["input"], "cache_read": r["cache_read"],
            "cache_write": r["cache_write"], "output": r["output"],
            "cost": r.get("cost") or 0.0, "answer_chars": r.get("answer_chars", 0),
            "ok": not r.get("is_error"), "semantics": "exclusive",
        })
    return rows


def meight_rows(out, tag="meight"):
    """meight/Codex 는 input 이 총계이고 cached 가 그 부분집합이다 (fx 와 같다).

    cache_write 는 status.json 이 보고하지 않는다. 0 으로 들어오지만 미보고이지 0 이 아니다 —
    이 하네스의 write 는 비교에서 빼고 읽어라.
    """
    rows = []
    for r in load_jsonl(f"{out}/{tag}-usage.jsonl"):
        rows.append({
            "turn": r["turn"], "harness": tag,
            "seconds": (r["end_ms"] - r["start_ms"]) / 1000,
            "generations": 0,
            # 델타가 음수면 세션 스냅샷이 어긋난 것이다. 측정 실패로 센다.
            "unmeasured": 1 if r["input"] < 0 else 0,
            "input": max(r["input"], 0), "cache_read": max(r["cache_read"], 0),
            "cache_write": 0, "output": max(r["output"], 0),
            "cost": 0.0, "answer_chars": r.get("answer_chars", 0),
            "ok": r.get("rc") == 0, "semantics": "total",
        })
    return rows


def flag_refusals(rows):
    """답변이 앞 구간 중앙값의 20% 아래로 떨어지면 작업 거부를 의심한다.

    Claude Code가 유사한 질문이 이어지면 '같은 세트가 반복 전송된다'고 판단해
    답변을 거부한 사례가 있다. 그 구간을 비교에 넣으면 비용이 부당하게 낮게 나온다.
    """
    chars = [r["answer_chars"] for r in rows if r["answer_chars"] > 0]
    if len(chars) < 4:
        return set()
    head = sorted(chars[: max(3, len(chars) // 2)])
    med = head[len(head) // 2]
    return {r["turn"] for r in rows if r["answer_chars"] < med * 0.2}


def agg(rows):
    a = {k: sum(r[k] for r in rows) for k in
         ("generations", "unmeasured", "input", "cache_read", "cache_write", "output", "cost", "seconds")}
    # 토큰 semantics가 하네스마다 다르다. 같은 식을 쓰면 안 된다.
    #   fx: bridge의 piUsageToFx 가 inputTokens.total = input + cacheRead + cacheWrite 로 만든다.
    #       즉 input_tokens 가 총계이고 cache_read 는 그 부분집합이다.
    #   Claude Code: input_tokens / cache_read_input_tokens / cache_creation_input_tokens 가 서로 배타적이다.
    harness = rows[0]["harness"] if rows else ""
    # fx/meight 는 input 이 총계, Claude Code/Grok CLI 는 셋이 배타적이다.
    total_semantics = rows and rows[0].get("semantics", "total" if harness == "fx" else "exclusive") == "total"
    if total_semantics:
        denom = a["input"]
    else:
        denom = a["input"] + a["cache_read"] + a["cache_write"]
    a["prompt_basis"] = denom
    # 실제 과금 대상: 캐시에 걸리지 않은 순수 input
    a["uncached"] = (a["input"] - a["cache_read"] - a["cache_write"]) if total_semantics else a["input"]
    a["cache_read_share"] = a["cache_read"] / denom if denom else 0.0
    a["turns"] = len(rows)
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--from", dest="lo", type=int, default=1)
    ap.add_argument("--to", dest="hi", type=int, default=10**6)
    ap.add_argument("--arms", default="fx,claude-code",
                    help="비교할 두 축. fx | claude-code | meight | <tag>(grok CLI 러너의 TAG)")
    args = ap.parse_args()

    def load_arm(name):
        if name == "fx":
            return fx_rows(args.out)
        if name in ("cc", "claude-code"):
            return cc_rows(args.out)
        if name.startswith("meight"):
            return meight_rows(args.out, name)
        return exclusive_rows(args.out, name)

    a_name, b_name = [x.strip() for x in args.arms.split(",")]
    fx, cc = load_arm(a_name), load_arm(b_name)
    ref_fx, ref_cc = flag_refusals(fx), flag_refusals(cc)
    if ref_fx or ref_cc:
        print(f"경고: 작업 거부 의심 턴 — {a_name} {sorted(ref_fx) or '없음'}, "
              f"{b_name} {sorted(ref_cc) or '없음'}")
        print("      그 구간은 일을 안 한 것이므로 비교에서 빼야 한다. --to 로 자르라.\n")

    for name, rows in ((a_name, fx), (b_name, cc)):
        sel = [r for r in rows if args.lo <= r["turn"] <= args.hi]
        if not sel:
            continue
        a = agg(sel)
        print(f"=== {name} (턴 {args.lo}-{min(args.hi, max(r['turn'] for r in sel))}) ===")
        print(f"  시간        {a['seconds']:.0f}s")
        print(f"  generation  {a['generations']}" +
              (f"  (usage 미측정 {a['unmeasured']})" if a["unmeasured"] else ""))
        print(f"  cache-read  {a['cache_read_share']:.1%}")
        print(f"  input/read/write  {a['input']:,} / {a['cache_read']:,} / {a['cache_write']:,}")
        print(f"  프롬프트 총량     {a['prompt_basis']:,} 토큰")
        print(f"  과금 토큰   uncached {a['uncached']:,} / read {a['cache_read']:,} / write {a['cache_write']:,}")
        print(f"  답변 분량   {sum(r['answer_chars'] for r in sel):,}자")
        print(f"  하네스 보고 비용  ${a['cost']:.4f}  (신뢰하지 마라 — 아래 주석)")
        print()

    fs = [r for r in fx if args.lo <= r["turn"] <= args.hi]
    cs = [r for r in cc if args.lo <= r["turn"] <= args.hi]
    if fs and cs:
        af, ac = agg(fs), agg(cs)
        print("=== 비교 (같은 모델일 때만 의미가 있다) ===")
        for label, k in (("cache read", "cache_read"), ("cache write", "cache_write"),
                         ("uncached input", "uncached"), ("output", "output")):
            if ac[k]:
                print(f"  {a_name} {label:15} {af[k] / ac[k]:5.2f}x  ({af[k]:,} vs {ac[k]:,})")
        if ac["seconds"]:
            print(f"  {a_name} 시간          {af['seconds'] / ac['seconds']:5.2f}x  "
                  f"({af['seconds']:.0f}s vs {ac['seconds']:.0f}s)")
        print()
        print("비용은 토큰 배수로 읽어라. 두 하네스의 cost 필드는 서로 다른 방식으로 계산된다 —")
        print("fx 쪽은 pi-ai 추정값이고 청구서가 아니다. 같은 모델이면 토큰이 곧 비용이다.")
        print("답변 분량 차이가 크면 품질이 다른 것이므로 토큰만 비교하지 마라.")


if __name__ == "__main__":
    main()
