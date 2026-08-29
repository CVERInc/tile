---
sitetile-page: markers
title: Marker coverage — hero variants + linked cells
lang: en-US
locales: en-US, zh-TW
---

## Logo hero, uncropped
%% sitetile: hero media=logo %%
![Mark](/img/demo-logo.gif)

A hero rendered as an uncropped **logo** (not the round avatar), carrying a block image figure — the coverage the home fixture's `bg=` hero can't reach.

## Linked cells
%% sitetile: grid cols=2 %%
### Products →/products "See products"
**A cell that is a whole-cell link** — with a caption and a chevron.

### Patreon →https://example.com/patreon
**A whole-cell link with a bare external href** — no caption.

## Workshop tools
%% sitetile: collection eyebrow="Workshop" link="All tools"→/tools %%
A grouped collection fixture with a card-wide primary destination and a separate external link.

### Composing
#### Compose →https://github.com/example/compose "Stable · Zero JS"
Arrange a page without adding a client runtime.
tags: layout, zero-js
learn: /tools/compose
updated: 2026-08-29

### Printing
#### Proof →/tools/proof "Beta"
Check the impression before the full run.
tags: proofing
updated: 2026-08-28
