# tile

**Edit Markdown as living structure — the raw markers never leave the text.** One
editor engine projects headings, lists, tables, and inline marks as real UI while
`##`, `**`, and `` ` `` stay present in the document, so every keystroke round-trips
back to plain Markdown byte-for-byte.

This monorepo is the source of truth for the **tile family**: a shared editor engine
and the Obsidian plugins built on top of it.

## What & why

Most rich editors throw the Markdown away and keep a model. tile keeps the Markdown
*as* the model: the text stays authoritative, and the editor decorates it in place —
headings grow, tables snap to a grid, inline `**bold**` renders while its markers
hide via CSS — without ever rewriting the underlying characters. Read the text back
with `getText()` and you get exactly what a plain editor would. That "structure on
top of an unmodified text substrate" is the whole design, and it is why the same
engine can drive very different hosts.

Three hosts ship from here today — two Obsidian plugins and a macOS app:

- **tugtile** — a card table (kanban) for your Markdown notes: tug tiles to reorder,
  lanes with WIP limits, and it reads your existing kanban-style boards. CJK-friendly.
- **marktile** — a Markdown editor where the markers never hide: headings grow while
  `##` stays put. Opens any `.md` file, not just boards. Pairs with tugtile. CJK-friendly.

Both are in the official Obsidian community-plugins directory.

- **marktile for macOS** ([`hosts/mac`](hosts/mac)) — the same editor as a document app:
  double-click a `.md` in Finder, no vault involved. An `NSDocument` + `WKWebView` shell
  around the same engine, built without Xcode. Not yet signed; see its README for what
  has and has not been verified.

## How it works

**Engine ⇄ host layering.** The engine (`packages/core/editor-core.js`) is the single
source of the actual editor code — `mountEditor`, highlighting, list/table/TOC logic,
image paste. It has no hard Obsidian import: it calls a handful of DOM-sugar helpers
(`createEl`, `setIcon`, `Modal`, `Platform`) that a host provides. Inside Obsidian the
app injects them; outside Obsidian a small shim supplies them. The core is never forked
per host.

- **`packages/core`** — the editor engine (SSOT). What it knows about markdown, where it stands
  against CommonMark, and the one construct still rendering wrongly: [`MARKDOWN.md`](packages/core/MARKDOWN.md).
- **`packages/cssmd`** — the shared inline-mark primitive (`**bold**` / `*italic*` /
  `` `code` `` rendered with the raw markers hidden via one CSS rule). The engine
  delegates to it so there is one implementation, not a copy per consumer.
- **`packages/tugtile`** — the kanban host: wires the engine to a board view that
  parses/serializes a `.md` board.
- **`packages/marktile`** — the editor host: wires the same engine to a minimal file
  view.
- **`hosts/mac`** — the macOS host: an `NSDocument` + `WKWebView` shell. The engine is
  copied in at build time (`scripts/sync-engine.sh`) rather than vendored, so there is
  no second copy that could drift.

Each plugin builds to a single `main.js` by inlining the engine, cssmd, the shared
`i18n/*.json` strings, and SortableJS (drag-and-drop) — so what a user installs is one
self-contained file. Obsidian is the **first** host; the engine is also emitted as a
platform-agnostic ES module (`tile-core.js`) for a browser host that loads the shim
first.

Localized in **en-US, ja-JP, ko-KR, zh-TW** — locale strings live in `i18n/*.json` and
are injected at build time.

## Use the engine

The engine is framework-agnostic — drop it into any page with a small host shim. A
runnable demo lives at [`tile-core/example.html`](tile-core/example.html); the shape:

```html
<div id="app"></div>
<script type="module">
  import '../packages/core/obsidian-shim.js';  // browser equivalents of the DOM-sugar the engine calls
  import { mountEditor } from './tile-core.js'; // the engine
  import { makeWebHost } from './host.js';      // a tiny host — see tile-core/host.js

  mountEditor(document.getElementById('app'), {
    text: '## Hello\n\n- edit me',
    onChange() { console.log('changed'); },
  }, makeWebHost());
</script>
```

`obsidian-shim.js` supplies plain-browser equivalents (Lucide icons as inline SVG, a
no-op `Modal`, `HTMLElement.prototype` sugar) so the core runs byte-identical in a bare
page — no `if (isObsidian)` branches. The shim's name just reflects where that API shape
came from.

## Repos & artifacts

This monorepo is the **source**. The two Obsidian plugins ship as thin publish mirrors
(Obsidian requires one repo = one plugin, so nobody hand-edits those):

| Artifact | Published as | What it is |
|---|---|---|
| tugtile plugin | `CVERInc/tugtile` (MIT) | Obsidian community plugin |
| marktile plugin | `CVERInc/marktile` (MIT) | Obsidian community plugin |

`scripts/publish.sh` assembles a plugin payload (`main.js` + `manifest.json` +
`styles.css` + `versions.json` + `LICENSE`) and builds fresh from this repo — the
publish mirrors can never drift into their own development line.

The **editor engine** needs no separate repo: it lives here as
`packages/core/editor-core.js` (source), emitted to `tile-core/tile-core.js` (a
platform-agnostic ES module). Drop it into any page with the small host shim — see
**Use the engine** below.

## Development

Requirements: **Node**, **python3**, **bash** (the builds inline sources via a short
Python step).

```bash
bash scripts/test.sh
```

That single entry point runs syntax checks, validates the i18n JSON, builds both
plugins and the tile-core emit, asserts the committed build artifacts still equal a
fresh build, and runs the full Node test suite. The same script backs the `hooks/pre-push`
git hook and CI (`.github/workflows/ci.yml`), so local and CI can never disagree.

Edit the `*.src.js` and `packages/core/editor-core.js` sources — **never** the generated
`main.js` / `tile-core/tile-core.js`; those are overwritten on the next build and the
freshness check fails if a committed artifact is stale.

To activate the pre-push hook once: `git config core.hooksPath hooks`.

## Contributing

Issues and pull requests are welcome. A few house rules:

- Change source, not generated artifacts, and run `bash scripts/test.sh` before pushing.
- Translations are just JSON: edit `i18n/<locale>.json` (the four existing locales are the
  template) — no code change needed to improve wording.
- Keep the round-trip guarantee: the editor must never alter the underlying Markdown text.

## License

MIT — see [LICENSE](LICENSE). Drag-and-drop is powered by
[SortableJS](https://github.com/SortableJS/Sortable) (MIT).
