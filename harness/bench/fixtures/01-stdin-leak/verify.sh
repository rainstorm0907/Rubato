#!/bin/bash
# 동작만 본다. 어떻게 고쳤는지는 보지 않는다.
cd "$(dirname "$0")" || exit 1
out=$(./run.sh 2>&1) || { echo "FAIL: run.sh 가 0이 아닌 코드로 끝났다"; exit 1; }
echo "$out" | grep -q "processed 4 items." || { echo "FAIL: 4개를 처리하지 않았다"; echo "$out"; exit 1; }
for w in alpha bravo charlie delta; do
  grep -qx "$w" processed.txt || { echo "FAIL: processed.txt 에 $w 가 없다"; cat processed.txt; exit 1; }
done
[ "$(grep -c . processed.txt)" = "4" ] || { echo "FAIL: processed.txt 줄 수가 4가 아니다"; cat processed.txt; exit 1; }
echo "PASS"
