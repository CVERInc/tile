#!/usr/bin/env bash
# Step 2: the page view's exits, before and after the size tier. One capped child process per run.
#
#   LABEL=before|after bash run-step2.sh [stage ...]     default: page page-100000 md accept-md deck
#
# Same rules as run-all.sh: `timeout` on every child, `--max-old-space-size`, and a wait for
# load1 <= MAX_LOAD before each run that sleeps between checks and gives up after MAX_WAIT seconds.
# Appends to logs/step2-<LABEL>.jsonl.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/every-number-bench"
mkdir -p "$work" "$here/logs"
sample="$work/sample.md"
LABEL="${LABEL:?LABEL=before or after}"
MAX_LOAD="${MAX_LOAD:-12}"
MAX_WAIT="${MAX_WAIT:-1800}"
T="${MEASURE_TIMEOUT:-300}"
OLD="${OLD_SPACE_MB:-4096}"
REPS="${REPS:-3}"

wait_for_load() {
  local waited=0 l1
  while :; do
    l1=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l1" -v m="$MAX_LOAD" 'BEGIN { exit !(l <= m) }'; then return 0; fi
    if [ "$waited" -ge "$MAX_WAIT" ]; then return 1; fi
    sleep 15; waited=$((waited + 15))
  done
}

run() {
  local stage="$1" old="$2" loaded=ok load1 line rc
  wait_for_load || loaded=over
  load1=$(cut -d' ' -f1 /proc/loadavg)
  line=$(timeout "$T" node --expose-gc --max-old-space-size="$old" "$here/step2.mjs" "$stage" "$sample" 2>"$work/step2.err")
  rc=$?
  [ -n "$line" ] || line=null
  printf '{"label":"%s","oldSpaceMB":%s,"exit":%s,"load1":%s,"loadWait":"%s","at":"%s","result":%s}\n' "$LABEL" "$old" "$rc" "$load1" "$loaded" "$(date -u +%FT%TZ)" "$line" >> "$here/logs/step2-$LABEL.jsonl"
  echo "$LABEL $stage old=$old exit=$rc"
}

[ -f "$sample" ] || timeout 300 node "$here/sample.mjs" "$sample" || exit 1

stages=("$@")
[ "${#stages[@]}" -eq 0 ] && stages=(page page-100000 md accept-md deck)
for s in "${stages[@]}"; do
  if [ "$s" = ladder ]; then
    # the page view inside a capped old space: which tile counts finish in 32 / 64 / 128 MB
    for st in ${LADDER:-page-10000 page-20000 page-50000 page-100000 links-10000 links-20000 links-50000}; do
      for old in 32 64 128; do run "$st" "$old"; done
    done
  else
    for _ in $(seq 1 "$REPS"); do run "$s" "$OLD"; done
  fi
done
