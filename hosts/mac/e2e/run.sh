#!/bin/bash
# End-to-end tests for marktile.app: real app, real keystrokes, judged by the bytes on disk.
#
#   hosts/mac/e2e/run.sh            # build a debug app, run every test
#   hosts/mac/e2e/run.sh fast_save  # run tests whose name contains "fast_save"
#
# Needs a logged-in GUI session and the Accessibility grant on the process that runs it (it posts
# keyboard events). Over plain SSH that grant is missing; run it from a Terminal window in the
# session, or from a tmux started there. See README.md.
#
# Every test types at least one character before saving. A test that only opens and saves a file
# would pass even if Save never wrote anything, so each one checks for a byte that only a real
# write could have put there.
set -u
cd "$(dirname "$0")/.."

FILTER="${1:-}"
WORK="$(mktemp -d /tmp/marktile-e2e.XXXXXX)"
APP="$WORK/marktile.app"
DRIVE="$WORK/mtdrive"
SETTLE="${MARKTILE_E2E_SETTLE:-2}"   # seconds for the web view to mount the engine after the window appears

pass=0; fail=0; failed=()

app_pids() { pgrep -f "$APP/Contents/MacOS/MarktileApp" || true; }
quit_app() {
  local p; p="$(app_pids)"
  [ -n "$p" ] && kill $p 2>/dev/null
  "$DRIVE" wait-gone 5 || { [ -n "$(app_pids)" ] && kill -9 $(app_pids) 2>/dev/null; }
}

# launch <file>: start the app on <file>. The previous test's app has left the process table by now
# (quit_app waits for that), but LaunchServices drops it from its own list a moment later, and an
# `open` in that gap fails with -600 (procNotFound). Retry briefly instead of sleeping blindly.
launch() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    open -a "$APP" "$1" 2>/dev/null && return 0
    sleep 0.5
  done
  open -a "$APP" "$1"
}

# open_doc <file>: launch a fresh app on <file> and wait for its document window.
open_doc() {
  launch "$1"
  "$DRIVE" wait-windows 1 15 || return 1
  sleep "$SETTLE"
}

# expect_bytes <file> <printf-format> — compare against an expectation built without the app.
expect_bytes() {
  local want="$WORK/want"
  printf "$2" > "$want"
  if cmp -s "$1" "$want"; then return 0; fi
  echo "    want: $(od -c "$want" | head -3 | tr -s ' ' | tr '\n' ' ')"
  echo "    got : $(od -c "$1" | head -3 | tr -s ' ' | tr '\n' ' ')"
  return 1
}

doc_windows() { "$DRIVE" windows | awk 'NR>1 { split($1, d, "x"); if (d[1] >= 420) n++ } END { print n + 0 }'; }

run() {
  local name="$1"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && return
  local dir="$WORK/$name"; mkdir -p "$dir"
  printf '%-28s ' "$name"
  if ( set -e; cd "$dir"; "t_$name" ) > "$dir/log" 2>&1; then
    echo "ok"; pass=$((pass + 1))
  else
    echo "FAIL"; sed 's/^/  /' "$dir/log"; fail=$((fail + 1)); failed+=("$name")
  fi
  quit_app
}

# --- tests -------------------------------------------------------------------------------------

# CRLF on every line, trailing spaces, a tab, and no final newline: all of it must come back.
t_crlf_roundtrip() {
  printf '# Title\r\n\r\nline one  \r\n\tindented\r\nlast line' > f.md
  open_doc f.md
  "$DRIVE" type Z; "$DRIVE" key cmd+s; sleep 1.5
  expect_bytes f.md 'Z# Title\r\n\r\nline one  \r\n\tindented\r\nlast line'
}

# LF file with non-ASCII text, a task line with trailing spaces, and several blank lines at the end.
t_lf_unicode_roundtrip() {
  printf '日本語 ✅ 👩‍👩‍👧\n\n- [ ] task  \n\n\n' > f.md
  open_doc f.md
  "$DRIVE" type Z; "$DRIVE" key cmd+s; sleep 1.5
  expect_bytes f.md 'Z日本語 ✅ 👩‍👩‍👧\n\n- [ ] task  \n\n\n'
}

# A file that mixes CRLF and LF. Saving it unchanged must not rewrite the lines it did not touch.
t_mixed_line_endings() {
  printf 'a\r\nb\nc\r\n' > f.md
  open_doc f.md
  "$DRIVE" type Z; "$DRIVE" key cmd+s; sleep 1.5
  expect_bytes f.md 'Za\r\nb\nc\r\n'
}

# Type, ⌘S, ⌘Q with no pause: the last keystrokes are still in the editor's debounce window.
t_fast_save_then_quit() {
  printf 'body\n' > f.md
  open_doc f.md
  "$DRIVE" type fast; "$DRIVE" key cmd+s; "$DRIVE" key cmd+q
  "$DRIVE" wait-gone 8 || { echo "    app did not quit after save (a dialog is probably up)"; false; }
  expect_bytes f.md 'fastbody\n'
}

# Quitting with unsaved edits must ask, and must not write.
t_unsaved_quit_asks() {
  printf 'body\n' > f.md
  open_doc f.md
  "$DRIVE" type U; sleep 0.5; "$DRIVE" key cmd+q
  "$DRIVE" wait-windows 2 5 || { echo "    no dialog appeared; windows: $("$DRIVE" windows | tr '\n' ' ')"; false; }
  [ -n "$(app_pids)" ] || { echo "    app quit without asking"; false; }
  expect_bytes f.md 'body\n'
}

# The file changes on disk while it is open (git checkout, another editor). ⌘S must not silently
# overwrite that change.
t_external_change_not_overwritten() {
  printf 'mine\n' > f.md
  open_doc f.md
  sleep 1.1                                   # make sure the modification date actually moves
  printf 'theirs\n' > f.md
  "$DRIVE" type Z; "$DRIVE" key cmd+s; sleep 2
  local windows; windows="$("$DRIVE" windows | head -1)"
  expect_bytes f.md 'theirs\n' || { echo "    the other change was overwritten (windows on screen: $windows)"; false; }
  [ "$windows" -ge 2 ] || { echo "    file kept, but no dialog appeared (windows: $windows)"; false; }
}

# Not UTF-8: refuse to open rather than guess, and leave the file alone.
t_non_utf8_refused() {
  printf 'caf\351\n' > f.md                   # Latin-1 é
  launch f.md
  sleep 4
  local docs; docs="$(doc_windows)"
  [ "$docs" -eq 0 ] || { echo "    a document window opened ($docs)"; false; }
  [ "$("$DRIVE" windows | head -1)" -ge 1 ] || { echo "    no error was shown"; false; }
  expect_bytes f.md 'caf\351\n'
}

# --- main --------------------------------------------------------------------------------------

swiftc -O e2e/mtdrive.swift -o "$DRIVE" || { echo "mtdrive did not compile"; exit 2; }
if ! "$DRIVE" trusted >/dev/null; then
  echo "This process has no Accessibility grant, so keystrokes would go nowhere."
  echo "Run from a Terminal window in the GUI session (System Settings ▸ Privacy & Security ▸ Accessibility ▸ Terminal)."
  exit 2
fi
if pgrep -x MarktileApp >/dev/null; then
  echo "Another marktile is running; quit it first so keystrokes cannot go to the wrong one."
  exit 2
fi

echo "▸ building into $APP"
./scripts/build-app.sh debug "$APP" > "$WORK/build.log" 2>&1 || { tail -20 "$WORK/build.log"; exit 2; }

for t in crlf_roundtrip lf_unicode_roundtrip mixed_line_endings fast_save_then_quit \
         unsaved_quit_asks external_change_not_overwritten non_utf8_refused; do
  run "$t"
done

echo
echo "$pass passed, $fail failed ${failed[*]:-}"
[ "$fail" -eq 0 ] && rm -rf "$WORK"
[ "$fail" -eq 0 ]
