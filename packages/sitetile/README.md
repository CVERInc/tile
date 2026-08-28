# @tile/sitetile

The tile family's **whole-website** content model — the **REEF with Site** renderer.

Card = one page (WYSIWYG) · Blog = flowing posts · pagetile = paged books · **sitetile = a Site page**: a sequence of typed sections authored in plain Markdown, rendered to a clean static site. Same family rule as the rest: **one pure Markdown model, exact round-trip — your data stays Markdown, not a database.**

```
packages/sitetile/
├─ site-core.js        # pure model: parse / serialize (round-trip) / reference HTML renderer
├─ site-core.test.js   # 16 tests (round-trip, fence guards, all 5 types, params)
├─ icon-core.mjs       # pure model: the favicon / apple-touch-icon set every build emits
├─ astro/              # the production rendering seam (per-type Astro components + platform shell)
└─ import/             # mirror → IR converter (the Recast SKU import path)
```

## IR syntax (LOCKED)

A page is **one plain-Markdown file** (the SSOT). Structure is native Markdown headings; the only thing Markdown can't express — a section's layout *type* — rides in an Obsidian-style `%% … %%` sentinel (never `:::`, never `<!-- -->`), namespaced `sitetile:`.

```markdown
---
sitetile-page: home            ← claim flag (frontmatter; routes the file). title/lang/locales too.
title: 山田珈琲
lang: zh-Hant
locales: zh-TW, ja-JP, en-US   ← Lingo mount points → <html lang> + hreflang
---

## 每一杯，都從產地說起        ← `## ` = ONE section; heading text = the section title
%% sitetile: hero bg=cover.jpg cta="預約"→/booking %%   ← type line: HUGS the `##`. No line = prose.
自家烘焙咖啡店的日常筆記。      ← section body = Markdown (inline rendered via @tile/cssmd)

## 我們的豆子
%% sitetile: grid cols=3 %%
### 單品                      ← inside a grid, `### ` = ONE cell
產地直送、小批烘焙⋯
### 配方
每季調整、風味筆記⋯
```

- **Frontmatter**: hand-written `key: value`, **no YAML dep**. `sitetile-page:` is the claim flag (`isSiteFile()` routes on it). `title`, `lang`, `locales` are read by the layout.
- **`## ` heading** = one section. Heading text = the section title.
- **`%% sitetile: <type> [params] %%`** = the type line. Must hug the `## ` (be its next line). Absent ⇒ `prose`. Complex params ⇒ `%% sitetile:settings` + a fenced JSON block.
- **`### ` heading** = a grid cell (only meaningful inside a `grid` section).
- Inline Markdown (`**bold**` / `*italic*` / `` `code` `` / `[link](/x)`) renders through **@tile/cssmd** (markers CSS-hidden, text↔DOM round-trip preserved).
- Namespace: CSS classes `st-*`, sentinel `sitetile:`.

## The 5 section types (minimal set)

| Type | Params | Renders | Notes |
|---|---|---|---|
| **prose** | — | `<section class="st-prose">` h2 + paragraphs/figures | **Default** (no type line needed). |
| **hero** | `bg=<url>` · `cta="Label"→/href` · `media=avatar\|logo` | `<section class="st-hero" data-media>` h1 + body + CTA | Full-bleed, optional bg. A foreground image in the body renders per `media`: **avatar** (round portrait, default) or **logo** (uncropped wordmark). |
| **grid** | `cols=N` · `### ` = each cell · `### Title →/href` = whole-cell link | `<section class="st-grid" data-cols>` + responsive `st-cell` cards | Cells collapse on small screens regardless of `cols`. A cell with a trailing `→/href` becomes `<a class="st-cell st-cell-link">` with a chevron CTA; without, a plain `<div>`. |
| **cta** | `button="Label"→/href` | `<section class="st-cta">` centered band | |
| **embed** | — | `<section class="st-embed">` **body VERBATIM** | Escape hatch (the one portability-debt seam). |

Unknown types render as `prose` but round-trip their literal type token.

**Body content** (prose / hero / grid-cell bodies) is rendered by a small block parser — inline marks via cssmd **plus** these blocks:

- **images** — `![alt](src)` / Obsidian `![[wikilink]]` → `<img class="st-img">`; an image-only block is a `<figure>` (hero portraits / in-body figures), an inline image stays in the `<p>`.
- **lists** — `-` / `*` / `1.` → `<ul>` / `<ol class="st-list">`.
- **blockquotes** — `> …` → `<blockquote class="st-quote">`.
- **fenced code** — ```` ``` ```` → `<pre class="st-code">` **verbatim** (the `#` / `>` / `|` / `-` inside are NOT parsed as blocks).
- **GFM tables** — `| a | b |` + `| --- | --- |` → `<table class="st-table">`.

Lists **nest** by indentation (ul/ol, mixed), blockquotes carry **multiple paragraphs** (blank `>` line splits them), and **single-column** tables work (a bare `---` with no leading pipe stays a paragraph, not a separator). All zero-JS, reef-token styled, round-trip preserved (render-only).

## Astro seam (production renderer)

`astro/` wraps each parsed section in a per-type Astro component inside the platform shell.

```sh
cd packages/sitetile/astro
npm install
npm run build      # content/*.md  →  dist/  (static)
npm run smoke      # isolated build (dist-smoke/) + assert: 5 types, VT, markers, blocks, zero UNACCOUNTED JS, the icon set (59 checks)
```

- **Content** lives in `astro/content/*.md`. `home.md` → `/`; `<name>.md` → `/<name>`. Files are read **raw** and parsed by `site-core` — they are NOT Astro's own Markdown loader (they have `%%` sentinels + non-YAML frontmatter).
- The model is aliased as **`@sitetile`** (see `astro.config.mjs`) so the components share ONE source of truth with the reference renderer + tests. Components import `parseParams / inlineHtml / bodyHtml / ctaHtml`.
- **Platform defaults baked in** (`src/layouts/SiteLayout.astro`): reef design tokens (`--gd-*`), `reef-*` landmarks, Lingo i18n mount points (`lang` + `hreflang` from `locales`), and **native cross-document View Transitions** (`is:inline @view-transition` — pure CSS, **zero client JS**).
- `content/home.md` is the **canonical fixture** — a realistic marketing homepage exercising all 5 types; `npm run smoke` builds and verifies it.

> ⚠️ `<style>` with `@view-transition` must be `is:inline` — Astro's scoped-style CSS pipeline drops the at-rule otherwise.

### Icons — every built site has one, without being asked

Three routes emit an icon set on **every** build, no opt-in: `/favicon.ico` (32×32), `/favicon.svg` and `/apple-touch-icon.png` (180×180, opaque). They are drawn by `icon-core.mjs` — a pure, zero-dependency model aliased as **`@icons`** — and `SiteLayout` takes its `<link rel=icon>` / `<link rel=apple-touch-icon>` hrefs from **that same model**, so a link can never name a file the build did not emit.

🩸 Before 2026-08-28 none of those paths existed. A site that had not set `favicon:` got no icon link either, so the two absences hid each other: three live sites answered **404** to every one of the three paths — which is what a browser, a crawler and iOS all ask for unprompted.

| a site that… | gets |
|---|---|
| has set `favicon:` (or `site-logo:` / `footer-logo:`) | its own mark in `<link rel=icon>`, and as the apple-touch icon too when the mark is a raster (iOS ignores SVG) |
| has set nothing | a badge: its own initial on its own `theme-color` (override with `icon-color: #rrggbb`) |
| hand-places `public/favicon.ico` etc. | that file — Astro skips a route whose name a `public/` file claims, which is also how REEF with PWA's `gen-icons.sh` output keeps winning |

The badge is deterministic: same site → byte-identical files, so a rebuild never churns them.

## 🔴 Marker growth policy (dogfood phase)

> The minimal set is 5 **on purpose**. Do **not** pre-build section types for hypothetical needs (shiny-object trap / premature engineering).

- **Hit a layout the 5 can't hold? Judge in one second:**
  - **Reusable shape** → add a real marker on the spot (update `site-core.js` KNOWN_TYPES + a layout component + tests). Clean Markdown = the moat.
  - **Genuinely one-off weird thing** → use `embed` (verbatim). Don't grow a marker for it.
- **Growth is demand-driven**: graduate a candidate when you actually hit it a **2nd time** on a real page — not on the first sighting, not speculatively.
- **The buffer-then-graduate discipline** (embed → seen ≥2× → graduate) is a **phase-2** rule — it only kicks in once there are external paying Site customers (can't redeploy per-site). In the current all-in-house dogfood phase, just add the real marker the moment a reusable shape recurs.

### Graduated

- **First graduations:** `grid-cell-CTA` (`### Title →/href`, a whole-cell link) and `hero media variant` (`media=avatar|logo`). Each earned its place by reaching a SECOND independent site: a cell link on one and product cards on another; a round avatar on one and an uncropped wordmark on another — that avatar/logo split is exactly what `media=` resolves. Block-image *rendering* was a base-content fix, not a marker.

### Observed candidates (NOT built — watch list, from real marketing-page work)

A basic marketing homepage fits the 5 cleanly. A *fuller* real one recurs these, which the 5 hold awkwardly:

| Candidate | Why 5 don't fit | Universality | Stopgap |
|---|---|---|---|
| **testimonial / quote** | prose loses the quote/avatar semantics + layout | ⭐⭐⭐ strongest | prose |
| **stats / metrics band** | number+label, not title+body cards | ⭐⭐⭐ strongest | grid (awkward) |
| logo / "trusted-by" strip | image row, not text cards | ⭐⭐ | grid / embed |
| pricing table | per-column price + feature list + CTA | ⭐⭐ | embed |
| faq / accordion | flat Q/A loses fold (native `<details>` could do it zero-JS) | ⭐⭐ | prose |

**testimonial + stats** are the strongest candidates — graduate when a real page hits them a 2nd time. Until then: not built.

### ⚠️ `grid` overload observation

`grid` is currently doing double-to-quintuple duty (features / steps / logos / stats / pricing). Short-term fine (features/steps fit well), but stats/logos/pricing each have their own structure — long-term they should split into their own markers rather than turning `grid` into a parameter monster.

## Known limits

**The raster badge can draw A–Z and 0–9, and nothing else.** `favicon.ico` and
`apple-touch-icon.png` are PNGs, and this package has no font engine and no image library to make
one with — putting either on the critical path of every site build is a price the icon set is not
worth. So the letter in those two files is drawn from a stroked geometric alphabet in
`icon-core.mjs` (accents fold to their base letter: É → E). A site whose initial is 山, Ж or 한 gets
its real character in `favicon.svg` — which is what browsers use for the tab — and a plain
colour badge on the iOS home screen. A wrong letter would be worse than none, so nothing is guessed
at; the test asserts the blank case rather than describing it. A site that wants a lettered iOS
icon in any script sets `favicon:` to its own mark, or hand-places `public/apple-touch-icon.png`.

**Text direction: LTR only.** The renderer ships nine-language localisation and will happily set
Han, kana and Hangul, but it has no right-to-left support and does not pretend to. Measured rather
than assumed, 2026-08-11:

| | |
|---|---|
| `<html dir>` emitted | never |
| logical properties in `site.css` | `margin-inline` ×10, and nothing else |
| physical properties | `left:` ×25, `right:` ×17, `border-right` ×7, `margin-left` ×8, `text-align: left` ×3 |
| RTL locales in `LINGO_BCP47` | none |

So an Arabic or Hebrew page would render, and render left-to-right. That is a defect, listed here
because a reader who finds out by trying it has lost more than a reader who was told.

**"RTL" is three different features, and this is the only one missing.** Worth separating before
anyone estimates it:

| | where it lives |
|---|---|
| Bidirectional text (Arabic, Hebrew) — `dir=rtl`, logical properties | **not built** — this section |
| Vertical CJK setting (縦書き) — `writing-mode: vertical-rl` | built, in the EPUB toolchain |
| Right-opening page order (comics) | built — `pagetile`'s `direction: ltr\|rtl` |

**PRs are welcome for the first row, and this is what one would need.** We are not building it
ourselves: nobody here reads or writes an RTL script, so we could not dogfood it, and a typographic
feature verified only by someone who cannot read the output is a feature verified by nobody.

1. `dir` on `<html>`, derived from the page's locale.
2. The physical properties above become logical ones. The count is the estimate.
3. 🔴 **The part that is not ours to merge.** A site's theme lives in that site's own repo, so base
   going logical fixes nothing for a theme that writes `margin-left`. RTL needs every theme author
   to follow, and no PR here can do that for them. Say so in the PR rather than discovering it
   after: a renderer that is RTL-correct under themes that are not has moved the bug, not fixed it.
4. A fixture in an RTL script, and — this is the one that actually matters — a reviewer who reads
   that script. We will merge on their word, not on ours.

## Import path (Recast SKU)

`import/mirror-import.js` converts an ejecta **mirror's HTML → clean Markdown IR** — the technical body of the **Recast** SKU and the #5 破釜沈舟 conversion mechanism. 🔴 This is sitetile's **import side**, NOT a parallel transform. Per-source-theme knowledge lives in a `THEMES` table (best-effort; reports per-template manual work; never fabricates structure). See its header for details.
