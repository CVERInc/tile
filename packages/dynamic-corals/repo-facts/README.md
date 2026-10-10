# repo-facts — the facts nobody should retype

A sitetile `collection` page lists open-source projects as cards. Each card says "Updated
yesterday", and that line was typed once and has been false ever since. This coral keeps two facts
on those cards true — **when the repo was last pushed** and **whether it is archived** — and
touches nothing else.

## The embed — one per page

```html
<div data-dynamic-coral="repo-facts" data-owner="CVERInc" data-api-base="https://feelreef.com"></div>
<script type="module" src="https://feelreef.com/corals/repo-facts/v0/repo-facts.js"></script>
```

| attribute | |
|---|---|
| `data-owner` | **required** — the GitHub owner whose repository links on the page are filled |
| `data-api-base` | **required**, https — the origin serving `GET /v0/repo-facts` (the worker below). No default: a guessed origin is a 404 that reads as an outage |
| `data-locale` | optional — the language to write in. Default: `<html lang>` |

It asks the edge once, then for every card (`.st-item`) whose GitHub link is
`https://github.com/<data-owner>/<repo>`:

- the card's `.st-item-updated` line is rewritten from the repo's last push, in the renderer's own
  wording and the browser's own relative phrase. A page that typed no `updated:` has no such line
  (the renderer writes it only from a typed date), so the coral creates it where Collection.astro
  would have — first in `.st-item-meta-left` (or `.st-item-meta`); a separator is the theme's
  to draw — and finds it next time, so it is never built twice.
  Without JS such a page shows no date at all;
- an archived repo gets one archived pill in `.st-item-badges` (not added twice, also not when the
  author already typed one in any of the four languages).

A card the answer does not cover — another owner, a name the owner no longer has, a malformed
entry — is left byte for byte as it was. On any failure (no answer in 3 s, not ok, a redirect, not
JSON) the page is exactly what was rendered. Text only; no markup is built from the answer.

| | en | zh-TW | ja-JP | ko-KR |
|---|---|---|---|---|
| updated | `Updated 3 days ago` | `前天 更新` | `先月 更新` | `업데이트 날짜: 지난달` |
| archived | `Archived` | `已封存` | `アーカイブ済み` | `보관됨` |

The wrapper words are Collection.astro's (a test holds the two together); the phrase is
`Intl.RelativeTimeFormat(lang, { numeric: 'auto' })` over whole UTC days — today, yesterday, N days
under 30, then months (days ÷ 30), then years (days ÷ 365) — which is how the live pages were
phrased to begin with. A language other than the four reads English, like the renderer.

```js
window.__coralDiagnostics['repo-facts']   // { filled: 13, skipped: 0 } — cards carrying a fact, and cards
                                          // with a fact but no meta row to write it into; or { error: 1 }
```

## The edge: `repo-facts-worker.mjs`

```
GET /v0/repo-facts?owner=CVERInc
→ 200 { "clikae": { "name": "clikae", "pushed_at": "2026-10-07", "archived": false, "stars": 4 }, … }
```

- **One forge call per owner per day**: the owner's public listing
  (`/orgs/<owner>/repos?type=public&per_page=100`). Four fields per repo survive a shape check;
  everything else in the listing (descriptions, topics, URLs) stays behind. Private or internal
  items, and items of another owner, are dropped.
- **Not a proxy.** The owner must be in `OWNERS`, hard-coded; anything else is `400` with no
  upstream call. Nothing from the request reaches the forge — not a name, not a header.
- **Cache**: one entry per owner, fresh for 24 h. After that the old answer is served at once and
  refreshed behind the response; a failed read keeps the old answer and is not retried for 15
  minutes. No token: one call a day is far inside the forge's anonymous quota (60 an hour per
  address), and a spent quota only delays a refresh by up to fifteen minutes.
- `Access-Control-Allow-Origin: *`, never credentials or cookies, `nosniff`, `max-age=3600`
  (`60` for an empty answer). `X-Repo-Facts-Cache` says `hit`, `stale` or `miss`.
- One page of 100 repos: an owner with more than 100 public repos is not served beyond them.

## Shape

`repo-facts-core.mjs` is the page half; `repo-facts-client.mjs` mounts it; `repo-facts.js` is BUILT
from those two — do not edit it. `repo-facts-worker.mjs` is the edge. `fake-page.mjs` and
`fixtures/` are test fixtures and never ship.

Publishing is the registry chain, not a copy: bump `package.json` → `node ../build.mjs repo-facts`
with the deployment's `--registry` → repoint the channel → deploy the registry. The worker is a
separate deploy with a config the deployment owns.
