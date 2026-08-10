---
sitetile-page: blocks
title: Base content blocks
lang: en-US
locales: en-US, zh-TW, ja-JP, ko-KR
# 🔴 THE NEGATIVE CASE. This page declares four locales and exists in TWO (here and
# zh-tw/blocks.md), so ja and ko must NOT be advertised on it. A site that translates its
# home everywhere and an inner page only partly is the realistic shape — and it is the only
# fixture reaching alternateLocales' non-home branch (`<loc>/<page>`), which had no specimen.
packages: lingo
---

## Everything a real page body needs
A normal paragraph with **bold**, *italic*, `code`, a [link](/x) and an inline ![dot](/img/demo-logo.gif) image.

What you get:

- Lists (`-` / `*` / `1.`)
- Blockquotes
- Fenced code blocks
- GFM tables

## Why it matters
> Real pages aren't just paragraphs. About pages, docs and posts lean on lists, quotes and tables — base content, not section markers.

Steps:

1. Author plain Markdown
2. Astro renders it clean
3. You own it

| Block | Tag | Inline marks |
| --- | --- | --- |
| list | `ul` / `ol` | yes |
| quote | `blockquote` | yes |
| table | `table` | yes |

```js
// fenced code is verbatim: ## not a heading, > not a quote, | not a table, - not a list
const x = 1;
```

## A quoted name with speech under it
> **KITT**
> A blockquote whose first line is nothing but a bold name is a spoken turn.

> **CHOD**
> An ordinary quotation, above, must keep rendering as a quotation.

> Like this one, which opens with no name and stays a quote.

## A fence that declares its language
```js
const x = 1;              // a comment
const s = 'a string';
```

```diff
--- a/f
+++ b/f
-was
+is
```

## A fence that declares nothing
```
$ gdbus call --session --dest org.gnome.Shell.Screenshot
Error: AccessDenied — not a language, and not painted as one
```
