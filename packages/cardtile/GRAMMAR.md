# Card grammar

A Card is one Markdown file: a frontmatter fence, then lanes (`## grid`, `## back: <id>`,
`## assets`), each holding `- [ ] %% card: <type> <params> %% <body>` lines. The cell types and
their parameters live in [ai-ops.mjs](ai-ops.mjs) (`CELL_TYPES`, `UNIVERSAL`); editor labels and
hints live in [w/cell-i18n.mjs](w/cell-i18n.mjs).

A line's marker has a second spelling, `%% cardtile: <type>`. It is read exactly like
`%% card: <type>`, and a line keeps the spelling it has when the file is saved. New lines are still
written `%% card:`; [docs/VOCABULARY.md](../../docs/VOCABULARY.md) says when that changes. The first
lane may likewise be headed `## front` instead of `## grid` and keeps the heading it has.

This note covers what belongs to the whole card: its settings, views, backs, geometry, the editor's
embedding protocol and the custom-domain API, followed by the link and social icon rules. The same
rules are exported as data from [ai-ops.mjs](ai-ops.mjs) (`FRONTMATTER`, `CARD_SETTINGS`, `BACKS`,
`GEOMETRY`, `EDITOR_PROTOCOL`), and [ai-ops-card.test.mjs](ai-ops-card.test.mjs) holds that data,
and every whole-card example below, to what the code reads.

## Card settings (frontmatter)

One `key: value` per line between the `---` fences at the top of the file. **A key at its default
is written as no line at all**: remove the line to go back to the default. The editor removes a line
when its control returns to the default, so never write out a default such as `theme: auto`.
Keys not listed here are kept in the file and do nothing.

```markdown
---
title: Aster
accent: #c0392b
theme: dark
views: stack wall
view: wall
---

## grid

- [ ] %% card: profile w=6 %% Illustrator.
```

Set in the editor's Cards settings:

| Key | Values | Without the line |
|---|---|---|
| `title` | one line of text, unquoted | the card's handle |
| `accent` | a CSS colour; the editor writes lowercase `#rrggbb` | `#0a8c8e` |
| `theme` | `light` or `dark` | follows the visitor's system |
| `header` | `left` | avatar centred above the name |
| `icons` | `mono` (also read: `grey`, `gray`, `monochrome`) | fetched marks keep their colours |
| `backdrop` | `asset:<id>` or an image URL | no backdrop |
| `backdrop-dim` | a number 0–100, no `%` (editor offers 0, 25, 45, 65) | derived from the accent |
| `views` | some of `stack list wall`, in that order | all three |
| `view` | one of `views` | the first of `views` |
| `back` | `"#<id>"`, in double quotes (see Backs) | the printed business card |

Written by hand only:

| Key | Values | Without the line |
|---|---|---|
| `arrows` | `on`: arrows on link rows and calls to action | no arrows |
| `since` | a year: the footer reads `© <since>–<this year>` | this year only |
| `radius` | `square` | rounded tiles |
| `lang` | a BCP 47 tag such as `zh-TW`; anything else is `en` | `en` |
| `generator` | `off` removes the generator meta tag; other text replaces it | `feelreef` |
| `powered-by` | `on`: a credit link in the footer | none |

A `backdrop-dim` that is not a number means the default, not 0. `powered-by` is ignored whenever
the platform states whether the card is in the card pool.

## Views

A visitor sees the card in one of three views:

- `stack`: a pile of cards, one tile per card, each with a front and a back.
- `list`: the same cards one under another, scrolling.
- `wall`: the whole face as one page, laid out on the six-column grid.

`views:` limits which ones a visitor may switch between (one view hides the switcher), and
`view:` picks the one the card opens on. A visitor who switched views gets their own last pick
back next time, when it is still offered. The editor writes `views:` only when not all three are
on, and `view:` only when it is not the first of them.

## Backs

A back is what a tile shows when it turns over. Backs are one level deep: a back cannot open
another back.

```markdown
---
title: Aster
back: "#about"
---

## grid

- [ ] %% card: profile w=6 back=#about %% Illustrator.
- [ ] %% card: link w=3 %% [Shop](https://example.org/shop)


## back: about | About me

- [ ] %% card: text %% I draw things.
```

- `## back: <id>` starts a back lane, and `## back: <id> | <Title>` gives it a title. The id is
  lower-cased and spaces become hyphens. Files that say `## drawer: <id>` are still read and keep
  that word.
- `back=#<id>` on a tile points it at that lane. It is honoured on `profile`, `text`, `link` and
  `feature`; `video`, `slides`, `social` and `embed` ignore it. A pointer to a lane that does not
  exist does nothing.
- A `link` whose address is `#<id>`, or a `feature` with `href=#<id>`, opens that back too.
- `back: "#<id>"` in the frontmatter is the **default back**: every tile without a back of its own
  that is not a link or a video turns over to it. Keep the double quotes; a bare `#` starts a YAML
  comment. (This repository's readers also accept it unquoted or without `#`, but the editor
  writes it quoted.)
- With no default back, those tiles turn over to the printed business card: the card's name, a
  QR code and its address. In the stack and list views a link without a back turns over to its
  address, and a video to its YouTube page.

## Size and geometry

```markdown
---
title: Aster
---

## grid

- [ ] %% card: link w=3 %% [Shop](https://example.org/shop)
- [ ] %% card: link w=3 %% [Blog](https://example.org/blog)
- [ ] %% card: text %% Text always spans the whole card.
```

- A card is six columns. There is no `cols:` key.
- `w=1` to `w=6` is the only size. Values are clamped to that range, and a cell with no `w` is one
  column wide.
- **There is no height parameter.** Height comes from content: a row is at least one column-width
  square and grows to fit. `h=` is retired: ignored by the layout, never offered, never written.
- `text` cells and cells with `bleed` always span all six columns, whatever their `w`.
- A picture keeps its own aspect ratio; an `embed` is as tall as it is wide.
- Cells pack in file order, but a later narrow cell may fill a gap left earlier.
- Width only matters on the wall view. Stack and list show each tile as a full-width card, which
  is why the editor sets width on the wall only.

## Editor protocol (for hosts embedding `/edit`)

A host page frames `/edit?host=<its own origin>` and talks to it with `postMessage`. The origin
must be exactly `https://feelreef.com`, `https://staging.feelreef.com` or `http://localhost` (any
port): no path, query or credentials; anything else is refused with a 400. The editor posts only
to that origin, never `*`, ignores messages from any other origin, and may be framed only by it.
It holds no credential: the host stores the card.

Every message is an object with `v: 1` and a `type`; anything else is ignored.

| Direction | `type` | Fields | When |
|---|---|---|---|
| editor → host | `card:ready` | | on start, every 500 ms until the first `card:load`, for up to 60 s |
| host → editor | `card:load` | `md`, `handle`, `cardUrl`, `locale`?, `version`? | load a card (a second load reloads) |
| editor → host | `card:load-failed` | `message` | `md` missing or not a card |
| editor → host | `card:change` | `md`, `dirty` | after each edit, debounced 150 ms |
| editor → host | `card:save` | `md` | the person pressed Save (or Cmd/Ctrl+S) |
| host → editor | `card:saved` | `version` | the save was stored |
| host → editor | `card:save-failed` | `message` | the save was refused; `message` is shown as written |
| host → editor | `card:get-draft` | | ask for the current draft |
| editor → host | `card:draft` | `md`, `dirty` | the answer; `md` is `null` before `card:load` |
| host → editor | `card:propose` | `md` | put `md` in the editor as an unsaved draft; only the person saves it |
| editor → host | `card:propose-failed` | `message` | before `card:load`, or `md` is not a card |

`dirty` is true when the draft differs from what the host last loaded or confirmed saved.
`card:saved` and `card:save-failed` are ignored unless a save is out. A proposal is announced
like any edit, with `card:change`. Every `md` is the whole file, `## assets` lane included; a host
that saves through `save_cards` uploads new assets with `put_asset` first
(`splitCard()` in [w3/host-bridge.mjs](w3/host-bridge.mjs) does that split).

## Custom-domain API (server to server)

`/_api/vanity/<handle>` binds a creator's own domain to a card. It sits behind the same bearer
token as the rest of `/_api/` and is called by the platform's server, not by an editor or an
agent: an agent uses the platform's `connect_card_domain` tool. The authoritative description,
including every error, is the header of [serve/card-vanity.mjs](serve/card-vanity.mjs); setup is
in [serve/CUSTOM-DOMAIN.md](serve/CUSTOM-DOMAIN.md).

| Method | Body | 200 response |
|---|---|---|
| `GET` | | `{handle, host \| null, redirect}`, plus `invalid_host` or `inconsistent` when set |
| `PUT` | `{host, redirect?, expect?}` | `{handle, host, redirect, changed}` |
| `DELETE` | `{expect?, host?}` | `{handle, host: null, changed}`; with `host`, also `orphan_removed` |

`host` is a lowercase host name, not under a platform zone and not an IP address. `redirect`
(default `true`) makes the domain the card's one address, so the platform address redirects to
it. `expect` is the `{host, redirect}` a previous `GET` returned; when the binding has moved since,
the call is refused with `409 vanity_state_changed`.

## Link and social icons

The rules below are shared by the editing table and published cards.

## Automatic marks

Leave `icon=`, `iconhost=` and `iconimg=` unset to use automatic marks. A social
row draws an envelope for `mailto:` and a house for the card's own host (with or
without `www.`); other HTTP(S) links use the linked site's favicon. An Instagram
or Threads address does not automatically select a bundled SVG. Favicons come from
the favicon services, so a brand change does not require a new icon bundle,
though the validated-image cache can take up to seven days to show the new mark.
External favicons are fetched rather than saved as Card assets.

The shared resolver tries host candidates, including the site's `www` spelling.
For each candidate, `/_icon/<host>.ico` asks DuckDuckGo first. A network error or
non-success response makes it ask Google's faviconV2. A successful DuckDuckGo
response with an unsupported content type returns 404 without asking Google. On
404, the card tries its next candidate; when all candidates fail, a link cell
hides the mark and a published social button shows a generic link symbol. The
editing table follows the same candidate chain and hides its empty mark slot.

The Worker contacts fixed favicon-service addresses. Its existing response cache
can reuse a validated image for up to seven days; misses are not cached. “Fetched”
here distinguishes service-provided favicons from a maintained brand-icon bundle;
it does not mean an upstream request on every page view.

## Author overrides

A link cell takes its override in the parameter list:

```markdown
- [ ] %% card: link icon=instagram %% [Instagram](https://instagram.com/example)
- [ ] %% card: link iconhost=example.com %% [Short link](https://example.org/go)
```

A supported `icon=<name>` selects that built-in SVG, even when the link points to
another site. It takes precedence over `iconhost=<domain>`. An unknown icon name
falls through to `iconhost=`, or to the automatic mark if no host is specified.
`iconhost=` takes a domain without a scheme or path and uses that one host only.

For a social cell, put the override after the address on each line:

```markdown
- [ ] %% card: social w=6 %% [Instagram](https://instagram.com/example) icon=instagram
	[Website](https://example.org/) iconhost=example.com
```

Write one link per line. If a line contains two links, only the first is shown.
Both surfaces use [link-marks.mjs](link-marks.mjs) for the override rules.

## Colour and artwork

Fetched brand marks keep their own colours by default. Generic drawn symbols,
such as a house or envelope, use the theme colour.

Set `icons: mono` in the card's frontmatter to make fetched marks greyscale.
Hover restores their colour. Explicitly named `icon=` SVGs use `currentColor`,
follow the theme colour, and are left alone by mono mode.
`iconimg=` supplies an artwork thumbnail for a link cell and takes precedence
over its mark; these thumbnails also retain their colours in mono mode.

## Embed and slides

`embed` is pasted HTML, scripts included (reef#2725):

```markdown
- [ ] %% card: embed w=3 %% <div id="t"></div><script>t.textContent = new Date().toLocaleTimeString()</script>
```

The body becomes the `srcdoc` of an `<iframe sandbox="allow-scripts">` and nothing
else: the document has an opaque origin, so it cannot read the card's storage or
cookies, touch the card's DOM, navigate the page, open popups or submit forms. The
iframe fills a square cell of its own width and does not grow to fit its content.
The card's `--cp-*` colour variables are declared on the document's `:root`, and
its background is transparent over the tile. An embed whose HTML is over the
card's byte ceiling (25 MiB) is refused by name on save and never rendered.

The image carousel that used the name `embed` is now `slides` (`kind=slider` or
`kind=bubbles`, same params). An existing `embed` line **with** a `kind=` token is
read as `slides` and written back unchanged, so old cards render exactly as before
without editing their files. An `embed` line without `kind=` rendered nothing
before, and is HTML now.

## Language note

This repository has no localized Markdown grammar documents. This note is in
English; the editor's labels and hints use the existing nine-language flow in
`w/cell-i18n.mjs`. The one-link-per-social-line explanation is already present
in all nine languages. No editor strings or golden rows change here.

These rules follow reef#2026 and
reef#2015, implemented by
[tile#125](https://github.com/CVERInc/tile/pull/125).
