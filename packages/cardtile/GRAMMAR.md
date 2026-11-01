# Card link and social icon syntax

This note covers the icon rules shared by the editing table and published cards.
The cell and parameter definitions live in [ai-ops.mjs](ai-ops.mjs); editor labels
and hints live in [w/cell-i18n.mjs](w/cell-i18n.mjs).

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

`embed` is pasted HTML, scripts included ([reef#2725](https://github.com/CVERInc/reef/issues/2725)):

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
