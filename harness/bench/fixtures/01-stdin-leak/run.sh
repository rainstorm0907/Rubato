#!/bin/bash
set -uo pipefail
n=0
: > processed.txt
while IFS= read -r item; do
  n=$((n+1))
  echo "[$n] processing: $item"
  ./process.sh "$item" >> processed.txt
done < items.txt
echo "done. processed $n items."
