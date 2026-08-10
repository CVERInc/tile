---
sitetile-page: home
title: Yamada Letterpress — one character, one piece of lead
lang: en-US
locales: en-US, zh-TW, ja-JP, ko-KR
# 🩸 Lingo was never switched on in any fixture, so "Lingo hreflang" tested the NON-Lingo
# passthrough — raw locale codes and uppercase paths, which is a different code path from
# every real Lingo site. A live site emits hreflang="zh-Hant" href="/zh-tw/"; /zh-TW/ is a 404.
#
# THE FIXTURE SET. One fictional letterpress studio, four locales. Each translation carries the
# founding text of its own script rather than translated marketing, because that is what a
# specimen is for: a page that renders beautifully and never touches a boundary proves nothing
# when it passes. All three are public domain, all three are documents about their own writing
# system, and all three are what a type foundry already prints to show a typeface.
#
#   /        en-US    plain English — this page is also the first thing a reader opens
#   /zh-tw/  zh-Hant  千字文 (周興嗣, 6C) — a thousand characters, by design no two the same
#   /ja-jp/  ja       いろは歌 — every kana exactly once
#   /ko-kr/  ko       훈민정음 (1443) — and Hangul carries word spaces, which the other two do not
#
# Reasoning and the vetted texts: reepub packages/cjk-specimen. The texts are copied, not the
# package imported — public-domain data is not a dependency.
#
# The declared-but-absent hreflang case lives on blocks.md, which exists in two of these four.
# A site translating its home everywhere and an inner page only partly is the realistic shape,
# and it exercises alternateLocales' non-home branch, which nothing else here reaches.
packages: lingo
nav: |
  - Home /
  - Products /products
    - Apps /apps
    - Games /games
      - Puzzle /games/puzzle
      - Action /games/action
  - About /about
---

## One character, one piece of lead
%% sitetile: hero bg=/img/demo-hero.jpg cta="See the type cases"→/checkup %%
We cast, set and print by hand. Nothing here is fast, and **that is the point** — a page of metal type has to be built one sort at a time before it can say anything at all.

## Three things we do
%% sitetile: grid cols=3 %%
### Casting
Molten lead into a matrix, one sort at a time, in the sizes a jobbing shop actually runs out of.

### Setting
Composed in a stick, justified with brass and copper, proofed until the line looks like a line.

### Printing
Dampened paper, a slow impression, and ink mixed for the sheet rather than for the swatch book.

## About this page
This section has no type line, so it is the default **prose**. Every translation of this page carries the founding text of its own script instead of translated copy — 千字文, いろは歌, 훈민정음 — because a fixture exists to be measured, not admired. The content is plain markdown throughout, and it travels with you.

## Want to see the cases?
%% sitetile: cta button="Come by"→/start %%
One character, one piece of lead.

## Video
%% sitetile: embed %%
<iframe src="https://www.youtube.com/embed/PLACEHOLDER_ID" title="A placeholder embed" allowfullscreen></iframe>
