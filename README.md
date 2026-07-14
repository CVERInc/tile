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

Two Obsidian plugins ship from here today:

- **tugtile** — a card table (kanban) for your Markdown notes: tug tiles to reorder,
  lanes with WIP limits, and it reads your existing kanban-style boards. CJK-friendly.
- **marktile** — a Markdown editor where the markers never hide: headings grow while
  `##` stays put. Opens any `.md` file, not just boards. Pairs with tugtile. CJK-friendly.

Both are in the official Obsidian community-plugins directory.

## How it works

**Engine ⇄ host layering.** The engine (`packages/core/editor-core.js`) is the single
source of the actual editor code — `mountEditor`, highlighting, list/table/TOC logic,
image paste. It has no hard Obsidian import: it calls a handful of DOM-sugar helpers
(`createEl`, `setIcon`, `Modal`, `Platform`) that a host provides. Inside Obsidian the
app injects them; outside Obsidian a small shim supplies them. The core is never forked
per host.

- **`packages/core`** — the editor engine (SSOT).
- **`packages/cssmd`** — the shared inline-mark primitive (`**bold**` / `*italic*` /
  `` `code` `` rendered with the raw markers hidden via one CSS rule). The engine
  delegates to it so there is one implementation, not a copy per consumer.
- **`packages/tugtile`** — the kanban host: wires the engine to a board view that
  parses/serializes a `.md` board.
- **`packages/marktile`** — the editor host: wires the same engine to a minimal file
  view.

Each plugin builds to a single `main.js` by inlining the engine, cssmd, the shared
`i18n/*.json` strings, and SortableJS (drag-and-drop) — so what a user installs is one
self-contained file. Obsidian is the **first** host; the engine is also emitted as a
platform-agnostic ES module (`tile-core.js`) for a browser host that loads the shim
first.

Localized in **en-US, ja-JP, ko-KR, zh-TW** — locale strings live in `i18n/*.json` and
are injected at build time.

## Repos & artifacts

This monorepo is the **source**. Public artifacts are assembled from it by the scripts
in `scripts/` and published to their own repos (Obsidian requires one repo = one
plugin, so each plugin ships as a thin publish mirror — nobody hand-edits those):

| Artifact | Published as | What it is |
|---|---|---|
| tugtile plugin | `CVERInc/tugtile` (MIT) | Obsidian community plugin |
| marktile plugin | `CVERInc/marktile` (MIT) | Obsidian community plugin |
| `tile-core.js` | `CVERInc/tilecore` (MIT) | the engine as a platform-agnostic ES module for web hosts |

`scripts/publish.sh` assembles a plugin payload (`main.js` + `manifest.json` +
`styles.css` + `versions.json` + `LICENSE`); `scripts/publish-tilecore.sh` assembles the
tilecore payload. Both build fresh from this repo — the public repos can never drift
into their own development line.

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
