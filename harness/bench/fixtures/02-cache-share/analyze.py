#!/usr/bin/env python3
"""usage.jsonl 에서 하네스별 cache-read share 를 계산한다."""
import json, collections

def main():
    tot = collections.defaultdict(lambda: {"input": 0, "read": 0, "write": 0, "output": 0})
    with open("usage.jsonl") as f:
        for line in f:
            r = json.loads(line)
            t = tot[r["harness"]]
            t["input"] += r["input_tokens"]
            t["read"] += r["cache_read_tokens"]
            t["write"] += r["cache_write_tokens"]
            t["output"] += r["output_tokens"]

    out = {}
    for name in sorted(tot):
        t = tot[name]
        denom = t["input"] + t["read"] + t["write"]
        share = t["read"] / denom if denom else 0.0
        out[name] = round(share, 4)
        print(f"{name:6} cache-read share = {share:.1%}")
    with open("result.json", "w") as f:
        json.dump(out, f)

if __name__ == "__main__":
    main()
