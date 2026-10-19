# End-to-end tests for marktile.app

`run.sh` builds a debug app, opens real files in it, types into it with real keyboard events,
and judges each test by the bytes left on disk.

```bash
hosts/mac/e2e/run.sh              # everything (about a minute)
hosts/mac/e2e/run.sh external     # only tests whose name contains "external"
```

## What it covers

| test | the failure it catches |
|---|---|
| `crlf_roundtrip` | CRLF, trailing spaces, tabs or a missing final newline changed by a save |
| `lf_unicode_roundtrip` | non-ASCII text or trailing blank lines changed by a save |
| `mixed_line_endings` | a file with both CRLF and LF rewritten to one style |
| `fast_save_then_quit` | the last keystrokes lost when ⌘S and ⌘Q follow typing immediately |
| `unsaved_quit_asks` | quitting with unsaved edits without asking, or writing anyway |
| `external_change_not_overwritten` | ⌘S silently overwriting a change made on disk while the file was open |
| `non_utf8_refused` | a non-UTF-8 file opened (and later re-saved) under a guessed encoding |

Every test types at least one character before saving, so a Save that wrote nothing cannot pass.
`fast_save_then_quit` was checked against a build with the save-time flush removed: it fails there
and passes with it.

## Where it runs

It needs a logged-in GUI session, and the process that runs it needs **System Settings ▸ Privacy
& Security ▸ Accessibility**, because it posts keyboard events to the app. Plain SSH has neither.
On a remote test Mac the working setup is a tmux started from Terminal inside the session, which
SSH then attaches to; the commands run with Terminal's grant.

`mtdrive.swift` explains what it avoids and why: in a screen-shared background session the
Automation prompt for System Events never appears, and the Accessibility tree returns stub
windows. So the tests read outcomes from the file and use the window server's window list only to
see that a document window or a dialog is up.

Window counts are a coarse signal. A test that expects a dialog knows one appeared, not which
one; the file's bytes are what the verdict rests on.
