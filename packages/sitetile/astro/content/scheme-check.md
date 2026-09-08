---
sitetile-page: scheme-check
title: Scheme check — disallowed destinations must never reach a live sink
lang: en-US
# round 4 (R3-P2-1/R3-P3-1/R3-P2-2): every field below is set on THIS page's own frontmatter
# (never the shared _site.md), so none of it leaks onto any other fixture page — page keys
# override site keys in the merged meta (see pages/[...path].astro's siteConfig merge).
favicon: javascript:void(0)
fonts: javascript:void(0)
header-cta: Buy now=javascript:void(0)
# header-actions-cart-href (R3-P2-1, second instance): reaches window.location.href in
# header-actions-cart.js, not an href=/src= attribute — the sink the R3 sweep's literal
# `href=|src=` grep could not see. Requires the guild + a `cart` toggle to wire at all.
header-actions: Cart=cart toggle cart
header-actions-cart-guild: scheme-check-cart
header-actions-cart-href: javascript:void(0)
---

## Contact — disallowed scheme in the form action
%% sitetile: form action="javascript:void(0)" submit="Send" %%
R3-P2-1: `action=` reaching a live `<form action>` with no gate. A disallowed scheme must
degrade to no backend (disabled submit), never a live `action="javascript:…"`.

### Name

## Contact — safe sibling (control)
%% sitetile: form action="/safe-contact" submit="Send" %%
The safe sibling: same coral, a normal destination, proving the check above did not just
turn every form off.

### Name

## Workshop tools
%% sitetile: collection eyebrow="Scheme check" %%
A grouped collection: a hostile item (disallowed scheme in the whole-card GH-style link, an
entity-encoded scheme in its `learn:` secondary link) beside a safe sibling.

### Group
#### Hostile item →javascript:void(0) "Bad"
The card-wide GH-style link is a disallowed scheme.
learn: javascript&#58;void(0)

#### Safe item →https://github.com/example/safe-scheme-check "Good"
The safe sibling — same coral, live destinations, control for the check above.
learn: /safe-learn

## Linked cells
%% sitetile: grid cols=2 %%
### Hostile cell →javascript:void(0) "Bad"
A whole-cell link with a disallowed scheme.

### Safe cell →/safe-grid "Good"
A whole-cell link with a safe destination — control.

## Gallery
%% sitetile: gallery %%
### Hostile gallery cell →javascript:void(0)
A disallowed scheme on a gallery cell.

### Safe gallery cell →/safe-gallery
A safe sibling — control.

## Carousel
%% sitetile: carousel %%
### Hostile carousel cell →javascript:void(0)
A disallowed scheme on a carousel cell.

### Safe carousel cell →/safe-carousel
A safe sibling — control.

## Roster
%% sitetile: people %%
### Hostile person →javascript:void(0)
![Hostile portrait](data:image/svg+xml;base64,PHN2Zz4=)
An SVG `data:` portrait (excluded from the raster allowlist — an SVG can carry its own
`<script>`) beside a disallowed-scheme name link and a disallowed-scheme entry in `links:`.
links: Bad=javascript:void(0), Good=/safe-person-link

### Safe person →/safe-person
![Safe portrait](data:image/png;base64,iVBORw0KGgo=)
A raster PNG `data:` portrait — allowed by policy (round 2, P1-2) — the control for the SVG
case above: the check must be able to tell these two `data:` images apart.

## Tag cloud
%% sitetile: tagcloud %%
- [Bad tag](javascript:void(0))
- [Good tag](/safe-tag)
- [Protocol-relative tag](//example.test/x)

## Background image
%% sitetile: hero bg=javascript:void(0) %%
A disallowed scheme in `bg=` reaching a live CSS `url()` with no gate before round 4 — the
same sink class as `logo=`/`layers=` elsewhere in this coral (found sweeping every `url(` in
this file, not from the round 3 review). Must degrade to no background image at all, on
both the reference renderer (site-core.js) and this Astro build.
