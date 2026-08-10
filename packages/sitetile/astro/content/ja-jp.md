---
sitetile-page: home
title: 山田活版所 — 一字、一鉛
lang: ja
locales: en-US, zh-TW, ja-JP, ko-KR
# The same fictional business as home.md, in another locale — which is the point of this fixture:
# it makes the hreflang invariant checkable in BOTH directions. All four locales now have a home,
# so the declared-but-ABSENT case moved to blocks.md, which exists in two of the four.
#
# Body text is いろは歌 — every kana exactly once, author unknown, public domain. No word
# spaces, which is the property a line-setting rule is actually tested on.
packages: lingo
nav: |
  - ホーム /
  - プロダクト /products
  - 概要 /about
---

## いろはにほへと　ちりぬるを
%% sitetile: hero bg=/img/demo-hero.jpg cta="活字を見る"→/checkup %%
わかよたれそ　つねならむ。うゐのおくやま　けふこえて。**あさきゆめみし**　ゑひもせす。

## 三つの仕事
%% sitetile: grid %%
- **鋳造** — いろはにほへと
- **組版** — ちりぬるをわか
- **印刷** — よたれそつねならむ
