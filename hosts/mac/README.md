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
./scripts/build-app.sh                          # release → /Applications/marktile.app
./scripts/build-app.sh debug                    # faster debug build
./scripts/build-app.sh release /tmp/marktile.app
./scripts/build-app.sh --channel appstore       # sandboxed → .build/appstore/marktile.app
```

`build-app.sh` runs `sync-engine.sh` first, so the app always contains a freshly built
engine. It also refuses to finish if the SwiftPM resource bundle did not make it into
the `.app`: without that check the app still runs on the machine that built it
(`Bundle.module` quietly falls back to `.build/`) and opens an empty window everywhere
else — which is the only kind of machine a release lands on.

## Two channels, one binary

marktile ships two ways: a **direct** build signed with Developer ID and notarized, and an
**appstore** build for the Mac App Store, which runs in the App Sandbox. They are the same binary.
`--channel` changes exactly one thing — which file under `entitlements/` goes into the signature:

| | `entitlements/direct.entitlements` | `entitlements/appstore.entitlements` |
|---|---|---|
| Hardened runtime | yes, no exceptions | yes |
| App Sandbox | no | yes, with `files.user-selected.read-write`, `files.bookmarks.app-scope` and `network.client` (for WebKit, not the internet — see the file) |

The code does not know which channel it was built for. It asks the running process whether a
sandbox applied (`APP_SANDBOX_CONTAINER_ID`, set by the sandbox itself — `FolderAccess.swift`),
because a compile-time flag is a label that can disagree with the signature: the direct build
re-signed with the sandbox to test it would then skip asking for folders it cannot read. One binary
also means every run of the direct build exercises the code the store build ships.

`build-app.sh` signs ad-hoc (`codesign -s -`) with the channel's entitlements, then runs the
installed binary twice without opening a window: `--verify-resources` (can it find its engine) and
`--report-sandbox` (is it sandboxed, can it list the home folder). The build fails if the second
answer does not match the channel. That is the only runtime proof of the sandbox that does not need
a window; reading the entitlements shows what was asked for, not what applied.

What reaches outside the open document, and what each channel does with it:

| Feature | direct | appstore |
|---|---|---|
| Open, edit, Save, Save As the document | works | works — the sandbox grants the file that was opened |
| ⌘-click `[[wikilink]]` → sibling note, vault lookup, "which one" menu | works | works after a **folder grant**: the first ⌘-click in a folder the app cannot read asks once with an Open panel pointed at it; the answer is saved as a security-scoped bookmark and resolved at every launch. Cancel ⇒ beep, and no second ask until relaunch |
| Search every document (flintfind, `ff`) | works when `ff` is installed | **absent** — see Deliberate omissions |
| ⌘-click an http(s) or mailto link | opens in the browser | same — the browser opens it, not the app |
| Accent colour, text size, toolbar preference | works | works; preferences live in the app's container, so they are not shared with a direct copy |

Granting a vault's top folder rather than the note's own folder is what makes links anywhere in the
vault work; the panel says so. A grant of the note's folder alone finds siblings but cannot see the
`.obsidian` folder above it.

## Two things the document class exists to enforce

Both are the same shape: **open a file, save it unchanged, get a byte-identical file.**

1. Text is read back with `ctrl.rawValue()`, never `getValue()` — `getValue()` strips
   trailing whitespace, which is right for a kanban card and wrong for a file.
2. Line endings survive, line by line. The editor works in LF; each line goes back out
   with the ending it came in with, so a file that mixes CRLF and LF keeps both. An edited
   line keeps the ending of the line it replaced; a new line takes the file's majority
   (`LineEndings.swift`).

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
- **Search every document, in the App Store build.** It runs flintfind, an external tool the person
  installs separately. A sandboxed app's child process inherits the sandbox and could not read the
  person's files anyway, and a store app may not depend on software from outside the store. So the
  store build reports the `searchAll` capability as absent and the engine grows no search control —
  the same seam that hides it in the direct build on a Mac without `ff`. A ⌘-click on a wikilink
  with no matching note beeps instead of opening the search. It comes back in both channels when
  the search is ported into the app (the seam is one function in `EditorViewController.swift`).
- **Per-button toolbar settings.** The Obsidian plugin lets you curate which buttons
  appear; here the whole toolbar hides at once (View ▸ Hide Toolbar, ⌥⌘T). Safe in a
  Markdown editor in a way it would not be elsewhere — the syntax *is* the input
  method, so `**bold**` is reachable whether or not a **B** button is on screen.

## Tested end to end

`e2e/run.sh` drives the real app with keyboard events and checks the bytes on disk: CRLF and
LF round trips, a file that mixes the two, the last keystrokes surviving an immediate ⌘S ⌘Q, quitting with unsaved edits,
a file changed on disk while open, and a non-UTF-8 file. See `e2e/README.md` for where it can
run (it needs a GUI session and the Accessibility grant).

## Not yet verified

Everything below was reasoned about or exercised once by hand. Treat this section as the
to-do list, not as reassurance.

- **A second machine.** Every run so far has been an unsigned, ad-hoc build on the
  machine that built it. The resource-bundle guard in `build-app.sh` exists precisely
  because that case differs — but the guard has never been watched failing on a clean
  machine, so it is untested, not passed.
- **Which dialog appears.** The end-to-end tests can see that a dialog came up and that
  the file was left alone, not what the dialog says or which button does what.
- **Real editing hours.** A text editor's defects live in the long tail — undo across a
  mode switch, IME composition at a line boundary, a very large file, a table of
  contents drag abandoned halfway. None of these have been sat with.

- **The App Store build's folder grants.** A document opens, takes typing and saves in the sandboxed
  build (that is how the `network.client` entitlement was found to be required — see
  `entitlements/appstore.entitlements`). The wikilink → folder panel → grant → relaunch path has
  not run. It needs a real click: mouse events posted to the app's own process do not reach a link
  inside the web view, the panel belongs to a separate system process, and posting events to the
  whole system from the test Mac's background session could land in whoever holds its screen. By
  hand, in the appstore build: open a note inside an Obsidian vault and ⌘-click a `[[link]]` to a
  sibling → the panel opens at the note's folder → choose the vault folder, Allow → the sibling
  opens; quit, relaunch, ⌘-click again → no panel; Cancel in an ungranted folder → a beep, and no
  second panel until relaunch. Also unchecked: the accent colour following System Settings (it
  arrives as a distributed notification).

Smaller, known: the menus are English-only while the editor speaks four languages.

## Icon

Lucide's `square-m` — the icon marktile already wears in Obsidian — drawn out of Markdown
symbols: a frame of mixed symbols, an M whose stems are `#`, strokes `\` and `*`, turns `>`.
`icon/make-icon.swift` draws it; the 16 and 32 px sizes are the plain outline, because the
symbols blur into a smudge there. To change it, edit the script and regenerate:

```bash
swift icon/make-icon.swift /tmp/AppIcon.iconset && iconutil -c icns /tmp/AppIcon.iconset -o icon/AppIcon.icns
```

## Releasing

Not signed with a real certificate yet: the Apple Developer membership is being set up. Both halves
are scripted so they run the moment it exists, and until then each stops at its first check and
names what is missing. Certificate names are parameters — pass exactly what
`security find-identity -v` prints; nothing here guesses them. No secret is written in a script or
passed on a command line.

**Direct (Developer ID).**

```bash
xcrun notarytool store-credentials marktile-notary --apple-id … --team-id …   # once; prompts for the password
MARKTILE_DEVELOPER_ID="Developer ID Application: … (TEAMID)" \
MARKTILE_NOTARY_PROFILE=marktile-notary \
./scripts/release-direct.sh 0.1.0 1
```

Builds the direct channel, signs with `--options runtime --timestamp`, submits to
`notarytool --wait` and reads the status (notarytool can exit 0 for a rejected submission; on
anything but Accepted it prints Apple's log), staples, checks with `spctl`, and zips the stapled
app into `.build/release-direct/`.

**Mac App Store.**

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

Both channels use the bundle identifier `net.cver.marktile`.

Not verified, because none of it can run without the certificates: any real signature, the
notarization and stapling round trip, the profile checks and entitlement merge against a real
profile, `productbuild`, and the upload. Whether App Store Connect accepts an arm64-only binary
(SwiftPM without Xcode builds for this Mac's architecture only) has not been checked.
