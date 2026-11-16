#!/usr/bin/env bash
# Builds the "Every number" sample and measures it on every path, one capped child process per run.
#
#   bash run-all.sh [stage ...]          default: every stage, then the memory ladder
#
# Each run: `timeout` (MEASURE_TIMEOUT, default 600 s) and `--max-old-space-size` (OLD_SPACE_MB,
# default 4096) so no single process can take the machine. Before each heavy run the script waits
# until the 1-minute load average is at most MAX_LOAD (default 12), sleeping between checks and giving
# up after MAX_WAIT seconds. Raw JSON lines go to logs/<stage>.jsonl, appended, one per run.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/every-number-bench"
mkdir -p "$work" "$here/logs"
sample="$work/sample.md"
MAX_LOAD="${MAX_LOAD:-12}"
MAX_WAIT="${MAX_WAIT:-1800}"
T="${MEASURE_TIMEOUT:-600}"
OLD="${OLD_SPACE_MB:-4096}"
REPS="${REPS:-3}"

wait_for_load() {
  local waited=0
  while :; do
    local l1
    l1=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l1" -v m="$MAX_LOAD" 'BEGIN { exit !(l <= m) }'; then return 0; fi
    if [ "$waited" -ge "$MAX_WAIT" ]; then echo "load1 $l1 still above $MAX_LOAD after ${MAX_WAIT}s; running anyway, noted in the log" >&2; return 1; fi
    sleep 15; waited=$((waited + 15))
  done
}

# one run: stage, old-space cap, log name. Records the exit code and load beside the JSON line.
run() {
  local stage="$1" old="$2" log="$3" loaded=ok
  wait_for_load || loaded=over
  local load1; load1=$(cut -d' ' -f1 /proc/loadavg)
  local line rc
  line=$(timeout "$T" node --expose-gc --max-old-space-size="$old" "$here/measure.mjs" "$stage" "$sample" 2>"$work/$log.err")
  rc=$?
  if [ -n "$line" ]; then
    printf '{"oldSpaceMB":%s,"exit":%s,"load1":%s,"loadWait":"%s","at":"%s","result":%s}\n' "$old" "$rc" "$load1" "$loaded" "$(date -u +%FT%TZ)" "$line" >> "$here/logs/$log.jsonl"
  else
    # the step it died in (measure.mjs marks each one on stderr) and whether V8 called it out of memory
    local last oom=false
    last=$(grep '^bench-step ' "$work/$log.err" | tail -n 1 | cut -c12- | tr '"\\' '  ')
    if grep -q -E 'heap out of memory|FatalProcessOutOfMemory|Reached heap limit' "$work/$log.err"; then oom=true; fi
    printf '{"oldSpaceMB":%s,"exit":%s,"load1":%s,"loadWait":"%s","at":"%s","result":null,"diedIn":"%s","outOfMemory":%s}\n' "$old" "$rc" "$load1" "$loaded" "$(date -u +%FT%TZ)" "$stage: $last" "$oom" >> "$here/logs/$log.jsonl"
  fi
  echo "$stage old=$old exit=$rc"
}

timeout 300 node "$here/sample.mjs" "$sample" | tee "$here/logs/sample.json" || { echo "the sample is not the prototype's file" >&2; exit 1; }

stages=("$@")
if [ "${#stages[@]}" -eq 0 ]; then stages=(limits parse roundtrip render editor save-parts save resave view view-parts view-md deck-file ladder scale html-share); fi
for s in "${stages[@]}"; do
  if [ "$s" = html-share ]; then
    # how much of the page is one stylesheet repeated per back (html-share.mjs says why)
    for k in 1000 834151; do
      wait_for_load || true
      timeout "$T" node --max-old-space-size="$OLD" "$here/html-share.mjs" "$k" >> "$here/logs/html-share.jsonl"
      echo "html-share $k exit=$?"
    done
  elif [ "$s" = scale ]; then
    # the page view at K tiles: timed with room, then again inside a 128 MB old space
    for k in 1000 10000 100000 834151; do
      for _ in $(seq 1 "$REPS"); do run "scale-$k" "$OLD" scale; done
      run "scale-$k" 128 ladder-scale
    done
  elif [ "$s" = ladder ]; then
    # the smallest old space each path completes in: a run that exits 134 / 137 / non-zero ran out
    # save-parts and view-parts run each path's own steps one at a time, in the path's order, so the
    # step a capped run dies in (`diedIn`) names the line that path would break at
    for st in ${LADDER_STAGES:-parse render view save save-parts view-parts deck-file}; do
      for old in 128 256 384 512 768 1024; do run "$st" "$old" "ladder-$st"; done
    done
  elif [ "$s" = limits ]; then
    run "$s" "$OLD" "$s"
  else
    for _ in $(seq 1 "$REPS"); do run "$s" "$OLD" "$s"; done
  fi
done
