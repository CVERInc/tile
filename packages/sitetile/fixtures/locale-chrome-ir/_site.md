---
# A site whose translated chrome lives in two different places (site-chrome-keys.test.mjs builds it
# and reads the pages; it is also built with the previous engine and compared byte for byte).
#   ko-kr/ has NO _site.md. Its pages carry their own nav, footer, announce, copyright and header
#     button, the way a site is translated before it has a locale config. They must render exactly
#     those, with nothing in the build log.
#   ja-jp/ HAS a _site.md that sets nav and footer. For ja-jp pages those are the site's: a page's
#     own line for them is ignored and named against content/ja-jp/_site.md. copyright, which only
#     this file sets, is ignored on such a page too and named against this file.
brand: Kite Lantern
lang: en-US
locales: en-US, ko-KR, ja-JP
nav: Home / | About /about
footer: Terms /terms | Contact /contact
announce: Spring kites are in
copyright: © Kite Lantern
header-cta: Visit=/visit
---
