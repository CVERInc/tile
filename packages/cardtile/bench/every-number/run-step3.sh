#!/usr/bin/env bash
# Step 3: the page view past the size tier, in windows — the first, the middle and the last window of each
# source, the download and an icon. One capped child process per run.
#
#   bash run-step3.sh [source ...]     default: the 25 MiB sample, page-100000, links-100000
#
# Same rules as run-step2.sh: `timeout` on every child, `--max-old-space-size`, and a wait for load1 <= MAX_LOAD
# before each run that sleeps between checks and gives up after MAX_WAIT seconds. Appends to logs/step3-after.jsonl.
# LADDER=1: each window also inside a capped old space (32 / 64 / 128 MB): does it finish?
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/every-number-bench"
mkdir -p "$work" "$here/logs"
sample="$work/sample.md"
MAX_LOAD="${MAX_LOAD:-12}"
MAX_WAIT="${MAX_WAIT:-1800}"
T="${MEASURE_TIMEOUT:-300}"
OLD="${OLD_SPACE_MB:-4096}"
REPS="${REPS:-3}"
log="$here/logs/step3-after.jsonl"

wait_for_load() {
  local waited=0 l1
  while :; do
    l1=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l1" -v m="$MAX_LOAD" 'BEGIN { exit !(l <= m) }'; then return 0; fi
    if [ "$waited" -ge "$MAX_WAIT" ]; then return 1; fi
    sleep 15; waited=$((waited + 15))
  done
}

run() {   # run <old-space MB> <step3 args...>
  local old="$1" loaded=ok load1 line rc; shift
  wait_for_load || loaded=over
  load1=$(cut -d' ' -f1 /proc/loadavg)
  line=$(timeout "$T" node --expose-gc --max-old-space-size="$old" "$here/step3.mjs" "$@" 2>"$work/step3.err")
  rc=$?
  [ -n "$line" ] || line=null
  printf '{"oldSpaceMB":%s,"exit":%s,"load1":%s,"loadWait":"%s","at":"%s","result":%s}\n' "$old" "$rc" "$load1" "$loaded" "$(date -u +%FT%TZ)" "$line" >> "$log"
  echo "$* old=$old exit=$rc"
}

[ -f "$sample" ] || timeout 300 node "$here/sample.mjs" "$sample" || exit 1

sources=("$@")
[ "${#sources[@]}" -eq 0 ] && sources=("$sample" page-100000 links-100000)
for src in "${sources[@]}"; do
  plan=$(timeout "$T" node --expose-gc "$here/step3.mjs" plan "$src") || { echo "plan failed: $src"; continue; }
  echo "$plan" >> "$log"
  rev=$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).rev))')
  count=$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).windows)))')
  for n in 1 $(( (count + 1) / 2 )) "$count"; do
    for _ in $(seq 1 "$REPS"); do run "$OLD" window "$src" "$n" "$rev"; done
    if [ "${LADDER:-0}" = 1 ]; then for old in 32 64 128; do run "$old" window "$src" "$n" "$rev"; done; fi
  done
  for _ in $(seq 1 "$REPS"); do run "$OLD" md "$src"; run "$OLD" icon "$src"; done
done
