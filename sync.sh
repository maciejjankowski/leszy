#!/usr/bin/env bash
# Copies the Wielki Leszy project from the internal source tree into this repo.
# Usage: ./sync.sh [SOURCE_DIR]   (default: the-template/deliverables/projects/2026-10-094-drone-radar)
# Copies only app/ (-> repo root), app/presentations/ (-> presentations/), tests/, i18n/.
# Never deletes anything in the repo. Source is never modified.
set -euo pipefail
SRC="${1:-/Users/mj/code/the-template/deliverables/projects/2026-10-094-drone-radar}"
DST="$(cd "$(dirname "$0")" && pwd)"
[ -d "$SRC/app" ] || { echo "no $SRC/app" >&2; exit 1; }

EXC=(--exclude 'data/' --exclude 'pin.config.php' --exclude '.DS_Store' --exclude 'node_modules/')

# app -> root (README handled separately, presentations separately)
rsync -a "${EXC[@]}" --exclude 'presentations/' --exclude 'README.md' "$SRC/app/" "$DST/"
mkdir -p "$DST/presentations" "$DST/tests" "$DST/i18n"
rsync -a "${EXC[@]}" "$SRC/app/presentations/" "$DST/presentations/"
rsync -a "${EXC[@]}" --exclude 'deck_facts.js' "$SRC/tests/" "$DST/tests/"
rsync -a "${EXC[@]}" "$SRC/i18n/" "$DST/i18n/"

# README: strip leading YAML frontmatter and the internal [[wikilink]] line
awk 'NR==1 && $0=="---"{fm=1; next} fm && $0=="---"{fm=0; next} fm{next} /^\[\[.*\]\][[:space:]]*$/{next} {print}' \
  "$SRC/app/README.md" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$DST/README.md"

# tests were written against ../app/ ; here the app sits at the repo root
for f in "$DST"/tests/*.js "$DST"/tests/*.cjs; do
  sed -i.bak -e "s#__dirname + '/\.\./app/'#__dirname + '/../'#g" -e "s#\.\./app/#../#g" "$f" && rm -f "$f.bak"
done
echo "synced from $SRC"
