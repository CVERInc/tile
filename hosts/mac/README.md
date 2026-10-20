# marktile for macOS

A document app that opens and edits `.md`, and nothing else. Double-click a Markdown
file in Finder and you get the same three-mode editor the Obsidian plugin runs —
Seasoned, Rendered, Plain — in a window, with no vault involved.

It does **not** reimplement the editor. This is an `NSDocument` + `WKWebView` shell
around `editor-core.js`, so the fourth surface cannot drift from the other three.
`scripts/sync-engine.sh` copies the engine in at build time from this repo's single
sources; `Sources/MarktileApp/Resources/Engine` is generated, git-ignored, and never
hand-edited.

## Build

No Xcode — the Swift toolchain from Command Line Tools is enough.

```bash
./scripts/build-app.sh                          # dev (unsandboxed) → /Applications/marktile.app
./scripts/build-app.sh debug                    # faster debug build
./scripts/build-app.sh release /tmp/marktile.app
./scripts/build-app.sh --channel appstore       # sandboxed → .build/appstore/marktile.app
```

`build-app.sh` runs `sync-engine.sh` first, so the app always contains a freshly built
engine. It also refuses to finish if the SwiftPM resource bundle did not make it into
the `.app`: without that check the app still runs on the machine that built it
(`Bundle.module` quietly falls back to `.build/`) and opens an empty window everywhere
else — which is the only kind of machine a release lands on.

## One product, built two ways

marktile ships through the **Mac App Store** only, and runs in the App Sandbox. There is no
separately distributed build: with search linked in (below), a second channel would offer nothing the
store build lacks, and would double the signing, the release steps and the "does it work in the
other one" testing.

`build-app.sh` still builds the same binary two ways, and `--channel` changes exactly one thing —
which file under `entitlements/` goes into the signature:

| | `entitlements/dev.entitlements` (default) | `entitlements/appstore.entitlements` |
|---|---|---|
| Who it is for | working on the app; never released | the store |
| Hardened runtime | yes, no exceptions | yes |
| App Sandbox | no | yes, with `files.user-selected.read-write`, `files.bookmarks.app-scope` and `network.client` (for WebKit, not the internet — see the file) |

The code does not know which channel it was built for. It asks the running process whether a
sandbox applied (`APP_SANDBOX_CONTAINER_ID`, set by the sandbox itself — `FolderAccess.swift`),
because a compile-time flag is a label that can disagree with the signature: the dev build re-signed
with the sandbox to test it would then skip asking for folders it cannot read. One binary also means
every run of the dev build exercises the code the store build ships.

`build-app.sh` signs ad-hoc (`codesign -s -`) with the channel's entitlements, then runs the
installed binary twice without opening a window: `--verify-resources` (can it find its engine) and
`--report-sandbox` (is it sandboxed, can it list the home folder). The build fails if the second
answer does not match the channel. That is the only runtime proof of the sandbox that does not need
a window; reading the entitlements shows what was asked for, not what applied.

What reaches outside the open document, and what the sandbox does to it:

| Feature | dev | appstore |
|---|---|---|
| Open, edit, Save, Save As the document | works | works — the sandbox grants the file that was opened |
| ⌘-click `[[wikilink]]` → sibling note, vault lookup, "which one" menu | works | works after a **folder grant**: the first ⌘-click in a folder the app cannot read asks once with an Open panel pointed at it; the answer is saved as a security-scoped bookmark and resolved at every launch. Cancel ⇒ no second ask until relaunch |
| Search every document | the whole home folder | the same, after **one ask** at the first search: the panel opens at the home folder, Allow grants it. A smaller folder is a smaller scope, and is never asked about again. Cancel ⇒ searches what is already granted, asks again next launch |
| ⌘-click an http(s) or mailto link | opens in the browser | same — the browser opens it, not the app |
| Accent colour, text size, toolbar preference | works | works; preferences live in the app's container, so they are not shared with a dev copy |

Granting a vault's top folder rather than the note's own folder is what makes links anywhere in the
vault work; the panel says so. A grant of the note's folder alone finds siblings but cannot see the
`.obsidian` folder above it.

## Search

Search every document is [flintfind](https://github.com/CVERInc/flintfind)'s engine, `FlintfindKit`,
linked in — the same library the `ff` command is a door onto, so the app and the command cannot
disagree about what matches. Spotlight answers first; the folders Spotlight never indexes (anything
under a dot-directory) are read directly and arrive a few seconds later.

It needs no scope of its own in the sandbox. Spotlight answers a sandboxed process with only the
documents it may read — measured: a whole-machine query from a sandboxed probe returned the match in
its granted folder and not the identical note beside it — so whatever the person granted is the
scope. A ⌘-click on a wikilink with no matching note opens the search with the name in it.

To see what a build can find, from where it is installed and with its saved grants, ask it — no
window, so it works over ssh, and it prints the two answers the page would receive:

```bash
marktile.app/Contents/MacOS/MarktileApp --search <term> [term…]
```

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

- **The App Store build's folder grants, and search after one — run once, by hand.** On
  2026-10-20, in the appstore build over screen sharing: ⌘-click a `[[link]]` → the panel opened
  at the note's folder → Allow with nothing selected → the sibling opened; ⌘F⌘F, a word from a note
  outside the vault → the panel opened at the home folder → Allow → that note was found; relaunch →
  no panels. Afterwards the sandboxed build's `--search` resolved the saved grant over ssh. Not
  automated: mouse events posted to the app's own process do not reach a link inside the web view,
  the panel belongs to a separate system process, and posting events to the whole system from the
  test Mac's background session could land in whoever holds its screen. Not yet run: Cancel (no
  second panel until relaunch), and choosing a folder smaller than home for search. Also unchecked:
  the accent colour following System Settings (it arrives as a distributed notification).
- **No network requests — checked once.** A document holding a Markdown image, an HTML `<img>`,
  an `<iframe>` and a `<video>`, all pointed at a local server, was cycled through all three modes
  in both builds: the server logged nothing, and a `curl` to it as a control was logged. The
  privacy policy says marktile makes no network requests of its own; this is what that rests on.

## Icon

Lucide's `square-m` — the icon marktile already wears in Obsidian — drawn out of Markdown
symbols: a frame of mixed symbols, an M whose stems are `#`, strokes `\` and `*`, turns `>`.
`icon/make-icon.swift` draws it; the 16 and 32 px sizes are the plain outline, because the
symbols blur into a smudge there. To change it, edit the script and regenerate:

```bash
swift icon/make-icon.swift /tmp/AppIcon.iconset && iconutil -c icns /tmp/AppIcon.iconset -o icon/AppIcon.icns
```

## Languages

Menus, dialogs and the document kind speak the engine's languages — English, Japanese, Korean
and Traditional Chinese — and the editor is told which one the menus resolved to, so the two are
always in the same language. Standard items read exactly as macOS says them; the editor's own
concepts (the three modes, wikilink) use the engine's words. Strings live in
`Localization/<lang>.lproj`, keyed by their English text, and `scripts/check-l10n.py` fails the
build when a language lacks a key, an `L("…")` has no entry, or a title skips `L()`. A language
the engine does not have cannot be added here alone.

To see what a language actually says, ask the built app — no window, so it works over ssh:

```bash
marktile.app/Contents/MacOS/MarktileApp --dump-menu -AppleLanguages '(ja)'
```

It prints the language the menus resolved to, the locale handed to the editor, and every menu
item with its shortcut. AppKit's own additions (Services, Enter Full Screen) only exist in a
running app and are not in that list.

## Releasing

Not signed with a real certificate yet: the Apple Developer membership is being set up. The release
is scripted so it runs the moment it exists, and until then it stops at its first check and names
what is missing. Certificate names are parameters — pass exactly what `security find-identity -v`
prints; nothing here guesses them. No secret is written in a script or passed on a command line.

```bash
MARKTILE_APPSTORE_APP_IDENTITY="…"          # Apple Distribution / 3rd Party Mac Developer Application
MARKTILE_APPSTORE_INSTALLER_IDENTITY="…"    # 3rd Party Mac Developer Installer
MARKTILE_APPSTORE_PROFILE=…/marktile.provisionprofile
MARKTILE_ASC_KEY_ID=… MARKTILE_ASC_ISSUER_ID=…   # API key; AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys
./scripts/release-appstore.sh 0.1.0 1
```

Checks the profile is a store profile for `net.cver.marktile`, builds the appstore channel, embeds
the profile, adds the application and team identifiers from the profile to the committed
entitlements, signs, `productbuild --sign`s a `.pkg`, then `altool --validate-app` and
`--upload-app`. `MARKTILE_UPLOAD=0` stops at the `.pkg` for Transporter. The build number (second
argument) has to go up on every upload.

Not verified, because none of it can run without the certificates: any real signature, the profile
checks and entitlement merge against a real profile, `productbuild`, and the upload. Whether App
Store Connect accepts an arm64-only binary (SwiftPM without Xcode builds for this Mac's architecture
only) has not been checked.
