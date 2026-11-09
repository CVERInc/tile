---
# Every link-bearing chrome key, each href unique in the whole build (chrome-links-render.test.mjs
# rewrites one link per key and asserts that the built site changes in that link's target and
# nowhere else). Pages override the site layer where a key only renders on some pages.
brand: Example
lang: en-US
locales: en-US
packages: blog
nav: |
  - Shop /nav-shop/
    - Hats /nav-hats/
    - Bags /nav-bags/
  - About /nav-about/
  - Soon
footer: Help /foot-help/ | Terms /foot-terms/ >> Dead /foot-dead/ | Plain
header-cta: Subscribe=/cta-subscribe/
header-actions: Search = magnifier link /ha-search/ ; Cart = cart toggle cart drawer:right badge:0
header-actions-cart-guild: example-guild
header-actions-cart-href: /cart-page/
copyright: Example
copyright-href: /copy-page/
language-href: /lang-choose/
announce: Something new
announce-href: /news-item/
blog-post-cta: Support the work=/donate-here/
---
