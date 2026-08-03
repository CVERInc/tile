# marktile for macOS

A document app that opens and edits `.md`, and nothing else. Double-click a Markdown
file in Finder and you get the same three-mode editor the Obsidian plugin runs —
Seasoned, Rendered, Plain — in a window, with no vault involved.

It does **not** reimplement the editor. This is an `NSDocument` + `WKWebView` shell
around `tile-core.js`, so the fourth surface cannot drift from the other three.
`scripts/sync-engine.sh` copies the engine in at build time from this repo's single
sources; `Sources/MarktileApp/Resources/Engine` is generated, git-ignored, and never
hand-edited.

## Build

No Xcode — the Swift toolchain from Command Line Tools is enough.

```bash
./scripts/build-app.sh                          # release → /Applications/marktile.app
./scripts/build-app.sh debug                    # faster debug build
./scripts/build-app.sh release /tmp/marktile.app
```

`build-app.sh` runs `sync-engine.sh` first, so the app always contains a freshly built
engine. It also refuses to finish if the SwiftPM resource bundle did not make it into
the `.app`: without that check the app still runs on the machine that built it
(`Bundle.module` quietly falls back to `.build/`) and opens an empty window everywhere
else — which is the only kind of machine a release lands on.

## Two things the document class exists to enforce

Both are the same shape: **open a file, save it unchanged, get a byte-identical file.**

1. Text is read back with `ctrl.rawValue()`, never `getValue()` — `getValue()` strips
   trailing whitespace, which is right for a kanban card and wrong for a file.
2. Line endings survive. A CRLF file is converted to LF on the way in and back on the
   way out.

Reading is UTF-8 only, and it says so rather than guessing: silently misidentifying a
legacy encoding corrupts the file on the next save.

## Why a custom URL scheme

The page is served over `marktile-app://` (a `WKURLSchemeHandler`), not `file://`. A
page loaded from `file://` has an opaque origin, so every ES `import` is blocked by
CORS — in `WKWebView` exactly as in a browser — and the window comes up blank with the
failure buried in a web console nobody opens. The custom scheme gives the page a real
origin. It is public API and sandbox-safe, so the Mac App Store option stays open.

## Deliberate omissions

- **Image and video insertion.** The engine models these as host seams
  (`needs: 'pickImage'` hides the button when the host has not wired the hook), so the
  buttons are absent rather than present-and-broken. Images in a document render as
  their Markdown text.
- **Per-button toolbar settings.** The Obsidian plugin lets you curate which buttons
  appear; here the whole toolbar hides at once (View ▸ Hide Toolbar, ⌥⌘T). Safe in a
  Markdown editor in a way it would not be elsewhere — the syntax *is* the input
  method, so `**bold**` is reachable whether or not a **B** button is on screen.

## Not yet verified

Everything below was reasoned about or exercised once by hand. None of it is covered by
a test, and none of it has run outside the machine it was written on. Treat this section
as the to-do list, not as reassurance.

- **A second machine.** Every run so far has been an unsigned, ad-hoc build on the
  build machine itself. The resource-bundle guard in `build-app.sh` exists precisely
  because that case differs — but the guard has never been watched failing on a clean
  machine, so it is untested, not passed.
- **A file changed underneath an open document.** `NSDocument` compares modification
  dates and is expected to warn before overwriting, but that dialog has never been made
  to appear here. Until it has, "open a file, `git checkout`, press ⌘S" is an unknown,
  and it is the unknown with the worst consequence.
- **The Swift half has no tests.** The 20-plus green test files in this repo all cover
  the engine. UTF-8 refusal, CRLF restoration, and the flush that pulls the last
  keystrokes out of the web view before a save are exactly where data would be lost,
  and all three are currently verified by reading the code.
- **Real editing hours.** A text editor's defects live in the long tail — undo across a
  mode switch, IME composition at a line boundary, a very large file, a table of
  contents drag abandoned halfway. None of these have been sat with.

Smaller, known: the menus are English-only while the editor speaks four languages, and
the app ships without an icon.

## Releasing

Not signed or notarized yet. `scripts/build-app.sh` follows the conventions used by
CVER's other Swift app, and the signing half (`codesign` with a hardened runtime →
`notarytool submit --wait` → `stapler staple`) follows the same shape once a Developer
ID certificate exists. Until then the app runs locally but Gatekeeper will refuse it
anywhere else.
