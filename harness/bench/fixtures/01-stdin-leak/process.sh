#!/bin/bash
# 항목 하나를 처리한다. 표준입력으로 부가 설정을 받을 수 있고, 없으면 기본값을 쓴다.
item="$1"
extra=$(cat)
if [ -n "$extra" ]; then
  echo "  (extra config: $(echo "$extra" | wc -l | tr -d ' ') lines)"
fi
echo "$item"
