---
sitetile-page: announce-card
title: Announce card — a site announcement with a deadline
lang: en-US
announce: Spring class now enrolling
announce-href: /blocks/
announce-until: 2099-12-01T23:59:00+09:00
---

## Announce card

`announce-until` in the future turns the site's `announce` band into a small corner card: the text
(a link, with `announce-href`), a countdown, and a close button. This page exists so the smoke's
client-JS audit sees the card's two scripts — the inline before-first-paint guard and the module
that ticks the countdown — and the card's markup with script off.
