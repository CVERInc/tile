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
| `locales` | the Card's languages, e.g. `[en-US, ja-JP]`, at most 12 (see Languages) | one language |

A `backdrop-dim` that is not a number means the default, not 0. `powered-by` is ignored whenever
the platform states whether the card is in the card pool.

## Languages

A Card can exist in several languages, the way a Site can: **one file per language**, never
several languages inside one file, and never a language in the address. The main file is the Card.
Its `locales:` lists the languages, its own `lang:` among them, and each other listed language may
have a file of its own: a complete card file in the same grammar, holding the owner's words in that
language.

```markdown
---
title: Aster
lang: en-US
locales: [en-US, ja-JP]
accent: #c0392b
---

## grid

- [ ] %% card: profile w=6 %% Illustrator.
```

```markdown
---
title: アスター
lang: ja-JP
---

## grid

- [ ] %% card: profile w=6 %% イラストレーター。
```

A language file changes the words, never what the Card is. It is rendered as written when it is
chosen; keeping its tiles in step with the main file's (which tiles, their order and sizes, the
backs) is the writer's job, and the engine does not compare the two. Everything the frontmatter
decides for the whole Card is read from the main file, always:

| Key | Decided by | Why |
|---|---|---|
| `title` | each language file (absent: the main file's) | the Card's name, in the owner's words |
| `lang` | each language file (must be its tag; absent: the tag) | the language of the words served |
| `accent`, `theme`, `header`, `icons`, `radius`, `arrows` | the main file | one Card looks one way in every language |
| `backdrop`, `backdrop-dim` | the main file | a picture is an asset, and assets are the Card's |
| `views`, `view`, `back` | the main file | the structure a visitor navigates |
| `since`, `generator`, `powered-by` | the main file | the same Card, the same footer and page metadata |
| `card-page`, `cardtile` (the claim) | the main file | which handle the file is |
| `locales` | the main file | which languages exist |

A language file may carry only `title` and `lang`. Any other frontmatter key is refused when the
file is saved (`cards_language_key_refused`, naming the key) and ignored when it is read. That
includes keys this repository does not read: a repository that embeds the engine may read them for
the whole Card. A line such as `accent: #f00` in the text between the frontmatter and the first lane
is refused the same way, because the renderer reads a `key:` line wherever it starts a line. A `lang:`
that is not the file's tag is refused (`cards_language_lang_mismatch`).

There is one assets lane per Card, the main file's: `asset:<id>` means the same picture in every
language, and an assets lane sent with a language file is dropped, as a save drops the caller's.
The avatar and the icon files are always the main file's.

### Language tags

A tag in `locales:`, in a route or in `?lang=` is read the same way:

| Written | Read as | Rule |
|---|---|---|
| `ja-JP`, `JA-jp`, `ja_JP` | `ja-JP` | case as RFC 5646 writes it (language lower, script Title, region upper); `_` is `-` |
| `zh-hant-tw` | `zh-Hant-TW` | the same |
| `zh-TW` and `zh-Hant-TW` | two tags | nothing is aliased; matching decides how near they are |
| `es-419`, `sl-rozaj` | as written | numeric regions and variants are tags |
| `*`, `en-x-private`, `de-u-co-phonebk`, `en-`, `e`, `<x>`, over 35 characters | not a tag | the renderer's `<html lang>` shape only: letters, then 2–8 letter or digit subtags |

A request is matched against the listed tags (and the main file's own `lang`) in this order:

| Step | Example | Served |
|---|---|---|
| exact | `ja-JP` | `ja-JP` |
| lookup: drop the last subtag until one matches (RFC 4647) | `zh-Hant-TW` with `zh-Hant` listed | `zh-Hant` |
| the same language, the first listed | `en-GB` with `en-US` listed | `en-US` |
| …but never across Chinese scripts, named or implied by the region | `zh-CN` with only `zh-TW` listed | the main file |
| nothing matches | `fr` | the main file |

### Which file a visitor gets

1. `?lang=<tag>`. A well-formed value decides: a match is served, anything else is the main file,
   and the header is not asked. An empty or malformed value is ignored.
2. `Accept-Language`, with its `q` weights: the highest weight that matches wins, ties keep the
   header's order, `q=0` excludes, `*` matches nothing.
3. Otherwise, the main file.

A chosen language with a file is served as that file's `title` and lanes over the main file's other
keys and assets. A listed language with no file, an unlisted one and an unknown one are the main
file. A language is never a reason for a 404. The page (`<html lang>`), the markdown exits
(`Accept: text/markdown`, `/<handle>.md`) and their `Content-Language` all name the file actually
served. Every answer of a Card that lists `locales:` says `Vary: Accept, Accept-Language`, and its
page carries one `rel="alternate" hreflang` link per listed language (its `?lang=` address) plus
`x-default` (the bare address). A language chosen by `?lang=` is its own canonical address. A Card
without `locales:` answers exactly as a Card always has.

### Language files through the API

On both prefixes, beside the main file's routes:

| Method | Path | Body or header | Answer |
|---|---|---|---|
| `GET` | `/_api/cards/<handle>/lang/<tag>` | | `{handle, lang, version, markdown, assets, total_bytes}`: the file without an assets lane, the main file's asset manifest |
| `GET` | `/_api/cards/<handle>/lang/<tag>/full` | | the file with the main file's assets lane |
| `PUT` | `/_api/cards/<handle>/lang/<tag>` | `{markdown, base_version?, dry_run?}` | `{handle, lang, version, commit, bytes, created, wouldChange}` |
| `DELETE` | `/_api/cards/<handle>/lang/<tag>` | `If-Version`, optional | `{handle, lang, deleted: true}` |

A language file has its own version, and `base_version` / `If-Version` are that version. Its links
pass the same scheme, count and safety checks as the main file's, and it obeys the same byte ceiling,
per file. The main file's routes take no `?lang=` (`cards_language_use_path`): there, a lost query
would turn a translation's save into an overwrite of the main file, or a removal into the deletion of
the whole Card. The main file's `GET` adds `locales` and `languages` (each tag that may have a file →
its version, or `null`) when it lists any. A main save that drops a tag from `locales:` removes that
tag's file in the same write and says so (`languages_removed`); deleting the Card removes every
language file.

| Code | Status | When |
|---|---|---|
| `cards_language_tag_invalid` | 400 | the tag is not a language tag |
| `cards_language_not_listed` | 409 (a `GET`: 404) | the main file does not list the tag |
| `cards_language_is_main` | 409 (a `GET`: 404) | the tag is the main file's own `lang` |
| `cards_language_key_refused` | 422 | the file carries a key the main file decides (`key`) |
| `cards_language_lang_mismatch` | 422 | the file's `lang` is not the tag |
| `cards_language_no_card` | 404 | there is no main file |
| `cards_language_missing` | 404 | the tag is listed and has no file |
| `cards_language_use_path` | 400 | `?lang=` on a main-file route |
| `cards_locales_invalid` | 422 | a main save lists something that is not a tag |
| `cards_locales_too_many` | 422 | a main save lists more than 12 tags |

The visitor-facing language switch and banner, any product limit on the number of languages, and
automatic translation are not part of this.

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
