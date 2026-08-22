#!/bin/bash
# 번들된 스킬을 ~/.agents/skills 에 깐다. bundle-skills.sh 의 반대 방향이다.
#
# 이 레포만 clone 한 기기를 위한 것이다. rubato 는 `~/.agents/skills` 를 읽고
# Claude Code 와 Codex 도 같은 자리를 보므로, 여기 풀어 두면 셋이 같은 스킬을 쓴다.
#
# **이미 있는 스킬은 건드리지 않는다.** 그 기기에서 사람이 고쳐 온 것이 정본일 수
# 있기 때문이다(agent-taskforce 를 쓰는 기기에서는 실제로 그렇다). 덮어쓰려면
# --force 를 준다.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/skills"
DEST="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

[ -d "$SRC" ] || { echo "install-skills: 번들이 없다 - $SRC" >&2; exit 1; }
mkdir -p "$DEST"

added=0; kept=0; replaced=0
for dir in "$SRC"/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/SKILL.md" ] || continue
  if [ -e "$DEST/$name" ]; then
    if [ "$FORCE" -eq 1 ]; then
      rm -rf "$DEST/$name"
      cp -R "$dir" "$DEST/$name"
      replaced=$((replaced + 1))
    else
      kept=$((kept + 1))
    fi
  else
    cp -R "$dir" "$DEST/$name"
    added=$((added + 1))
  fi
done

echo "install-skills: 새로 $added, 유지 $kept, 덮어씀 $replaced -> $DEST"
[ "$kept" -gt 0 ] && [ "$FORCE" -eq 0 ] && echo "  (이미 있는 것은 두었다. 덮어쓰려면 --force)"
exit 0
