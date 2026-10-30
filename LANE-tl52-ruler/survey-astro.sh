#!/usr/bin/env bash
# tile-lab#52 題① — per-file counts of Astro-specific features in the 16 sitetile sections.
# Run from the worktree root: bash LANE-tl52-ruler/survey-astro.sh
# Every column is a `grep -c` (line count) except Astro.* (distinct members) — read the pattern
# next to each header before trusting a zero.
set -u
D=packages/sitetile/astro/src/components/sections
printf '| file | lines | <style | is:global/:global( | <slot | client: | set:html/set:text | import .astro | define:vars | <script | is:inline | Astro.* used | Fragment |\n'
printf '|---|---|---|---|---|---|---|---|---|---|---|---|---|\n'
for f in "$D"/*.astro; do
  n=$(basename "$f")
  c() { grep -cE -- "$1" "$f"; }
  astro=$(grep -oE 'Astro\.[a-zA-Z]+' "$f" | sort -u | paste -sd, -)
  printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' "$n" "$(wc -l < "$f")" \
    "$(c '<style')" "$(c 'is:global|:global\(')" "$(c '<slot')" "$(c 'client:')" \
    "$(c 'set:(html|text)')" "$(c "^import .*\.astro['\"]")" "$(c 'define:vars')" \
    "$(c '<script')" "$(c 'is:inline')" "${astro:--}" "$(c '<Fragment|<>')"
done
echo
echo '## every import line'
grep -nE '^import ' "$D"/*.astro | sed "s|$D/||"
echo
echo '## every set:html / set:text'
grep -nE 'set:(html|text)' "$D"/*.astro | sed "s|$D/||"
echo
echo '## every <script (with attributes)'
grep -nE '<script' "$D"/*.astro | sed "s|$D/||"
echo
echo '## every <style (with attributes)'
grep -nE '<style' "$D"/*.astro | sed "s|$D/||"
