---
inbox-bubble-except: /blocks, /markers
# 🩸 2026-09-03 (sodaart /faq): `brand` is the SITE's own short name, deliberately DIFFERENT from
# any page's own `title:` — every fixture page's title is its own composed <title> text (see
# home.md, forms.md, …), exactly like a real site's pages each carry their own full SEO title.
# Site-name consumers (og:site_name, the inbox bubble's data-site-name) must resolve to THIS,
# never to whichever page happens to be rendering — see the /faq check below.
brand: Yamada Letterpress
# 🩸 2026-09-03 (sodaart /category × Lingo gap): the BLOG's own site-wide config lives HERE —
# pages/[...path].astro's per-locale blog block, and now the locale category/tag archives, read
# `meta.locales`/`meta.packages` from siteMeta() (this file, when it exists), NOT from home.md's
# own frontmatter (a content PAGE's `locales:`/`packages:` only govern that page). Home.md has
# declared `packages: lingo` + all four locales since the hreflang fix, but the BLOG never gained
# the same — so blog/zh-tw/*.md (below) would sit unrouted no matter how many translated posts
# existed. en-US only + zh-TW: the ONE translated-locale fixture the category/tag archives need
# (blog/zh-tw/a-signed-post.md, blog/zh-tw/an-unsigned-post.md — 2 posts, sharing `press` by
# inheritance from their base-locale slugs).
# 🩸 `lang` matters here for the SAME reason: without it, every blog-level route (devlog, and now
# /category /tag, base AND locale) fell back to SiteLayout's neutral DEFAULT_LANG ('zh-Hant') —
# caught by this very fixture: /category/press/ (base/en-US) rendered `<html lang="zh-Hant">`
# until this line existed, even though the home page (its own `lang: en-US`) was correct all
# along. Matches home.md's own declared default so the blog's language agrees with the rest of
# the site instead of disagreeing with a fallback nobody chose (lingo/locale.mjs's own doctrine
# on DEFAULT_LANG vs NEUTRAL_UI_LANG — this is exactly the class of drift that doctrine warns of).
lang: en-US
locales: en-US, zh-TW
packages: lingo
# blog/{a-signed,an-unsigned}-post.md both carry `categories: ["press"]`; their zh-TW translations
# carry none and inherit it by slug (see lib/blog.mjs's localizeArchiveHref/localeBlogCorpora
# header for why taxonomy is a property of the POST, not of one locale's rendering of it).
blog-category-routes: true
blog-tag-routes: true
blog-category-names: press=Press
# The authored category rail (blog-category-sidebar): one entry, count 2 (both fixture posts).
# Its href is the exact case localizeArchiveHref exists for — on the zh-TW edition it must become
# /zh-tw/category/press/ (that locale's own build routes `press`, from its own 2 posts), and on any
# locale that does NOT route it, the href must stay the unprefixed base archive rather than 404.
blog-categories: Press|2|/category/press
blog-category-sidebar: true
---

