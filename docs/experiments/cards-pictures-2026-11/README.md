# Cards pictures: inline, by URL, or hybrid — measured (tile#339)

Inline pictures were chosen on purpose: fewer requests, for the fastest page. This measures that choice
against the same goal — fastest for the visitor — on a phone-class CPU and a 4G-class network, before
anything ships. Nothing here changes a deployment: the strategies sit behind a local switch
(`CARDTILE_PICTURES`, `packages/cardtile/serve/asset-urls.mjs`) that is set nowhere in this repository,
and with it unset the cardtile worker answers byte for byte as before.

## The numbers first

Medians of 5 runs; full tables with min–max spread in [`results/summary.md`](results/summary.md), every run
in [`results/runs.json`](results/runs.json). Times are from navigation start. The heavy specimen is
~9.9 MB of HTML with 36 pictures; the medium one ~1.2 MB with 8. "Stack" is the default view of a Cards
page (the deck's pile); "wall" is the same page opening on the grid (`view: wall`).

**First screen complete** (first contentful paint and every picture on the first screen painted):

| page | visit | inline (today) | by URL | hybrid: first 2 inline, rest by URL, lazy | **hybrid: first 2 preloaded, rest by URL, lazy** |
|---|---|---|---|---|---|
| heavy, stack | cold | 3.5 s ¹ — pile at **12.7 s** | 0.81 s | 1.44 s | **0.97 s** |
| heavy, stack | repeat (2 min) | 3.3 s ¹ — pile at **11.8 s** | 0.43 s | 3.40 s | **0.68 s** |
| heavy, wall | cold | 9.9 s | 7.3 s | 5.9 s | **5.3 s** |
| heavy, wall | repeat | 1.5 s | 0.51 s | 0.87 s | **0.49 s** |
| medium, stack | cold | 2.07 s | 0.79 s | 1.12 s | **0.92 s** |
| medium, stack | repeat | 1.73 s | 0.71 s | 1.04 s | **0.83 s** |
| medium, wall | cold | 1.70 s | 1.56 s | 1.47 s | **1.44 s** |
| medium, wall | repeat | 1.21 s | 0.48 s | 0.68 s | **0.53 s** |

¹ What inline shows at 3.5 s is not the page the visitor gets. The deck's pile is dealt by `deck.js`, an
external script at the end of `<body>`, so it runs only after all 9.9 MB are parsed. Until then the page
shows the wall arrangement (the first pictures fill in as their bytes arrive), and at ~12.7 s it jumps into
the stack: inline's layout shift on that page is **0.126** (up to 0.235). See the filmstrip.

**Everything else that matters** (heavy page; medium in the summary):

| | inline | by URL | hybrid preload + lazy |
|---|---|---|---|
| all 36 pictures in, cold, stack (visitor flicking a card every 0.7 s) | 13.2 s | 9.6 s | 9.4 s |
| all 36 pictures in, cold, wall (visitor scrolling a screen every 0.7 s) | 11.0 s | 7.3 s | 9.1 s ² |
| layout shift (CLS), cold, wall | 0.000 | **0.115** | 0.000 |
| layout shift (CLS), cold, stack | **0.126** | 0.000 | 0.000 |
| requests, cold | 6 | 42 | 42 |
| bytes, cold | 10.14 MB | 7.68 MB | 7.69 MB |
| requests / bytes, repeat after 2 minutes | 1 / **9.88 MB** | 1 / 53 kB | 1 / 62 kB |

² The after-paint variant gets all pictures in sooner on the wall (7.1 s cold, 0.48 s repeat instead of
3.0 s) at the cost of a later first screen (6.4 s instead of 5.3 s cold). On the stack the two are within
noise of each other.

**Side by side, heavy page, cold, throttled** (inline · by URL · hybrid preload + lazy):
[`results/side-by-side-specimen-heavy.webm`](results/side-by-side-specimen-heavy.webm) (15 s) and all six
strategies as a filmstrip at 0.5–12 s: [`results/filmstrip-specimen-heavy.jpg`](results/filmstrip-specimen-heavy.jpg).

## Recommendation

**Hybrid, first-screen pictures preloaded, the rest by URL with their box reserved, loading as the markup
already says (`loading="lazy"`)** — `hybrid-preload-lazy`.

- Its first screen beats inline in all eight cells above, is the fastest of all six strategies on the
  wall, and trails plain by-URL by 0.05–0.25 s in the stack (where by-URL starts nothing ahead of the
  deck's own script and stylesheet). It is the only strategy with no layout shift on any page and the
  best-or-near-best first screen on both views.
- On the heavy page the visitor gets the real first screen **13× sooner** in the default view (0.97 s
  against 12.7 s for the pile), **1.9× sooner** on the wall (5.3 s against 9.9 s), and a repeat visit
  costs **62 kB instead of 9.88 MB**.
- On the medium page the cold wall is close to a tie (1.44 s against 1.70 s first screen; all pictures
  1.44 s against 1.43 s): inlining is not slower there, it just stops paying back on any repeat visit
  (1.24 MB again every time, because the page is cached for 60 s).
- No layout shift anywhere, which plain by-URL does not manage on the wall (0.115).
- No script: the after-paint variant needs one and is not faster where it counts first.

**Why "fewer requests" does not win here.** All requests go over one HTTP/2 connection, so 42 requests
cost about what their bytes cost. What inline costs instead: (1) nothing caches past the page's 60 s,
(2) every byte must be parsed before `deck.js` runs, which is what the default view waits for, and (3)
the browser cannot put the first screen's bytes ahead of the rest.

**What loses, and why:**
- *Inline the first screen* (`hybrid-inline-*`): 0.5 MB of base64 in the HTML delays DOMContentLoaded
  (so the pile) and is downloaded again on every repeat visit: 3.4 s on a repeat visit of the heavy stack,
  against 0.68 s preloaded.
- *Plain by URL* (`url`): fine in the stack, but on the wall the full-width pictures have no box until
  they arrive (CLS 0.115), and nothing tells the browser which pictures are on screen first.
- *Lazy vs eager-after-first-paint*: on a Cards page lazy loading defers little (next section), so the two
  measure close; lazy is kept because it needs no script and gave the earlier first screen on the wall.

## Two things learned about the page itself

1. **`loading="lazy"` defers almost nothing on a Cards page.** In the stack every card of the pile sits
   inside the viewport, so every picture counts as on screen. On the wall, this Chromium (151) starts lazy
   pictures within roughly 3,200–4,300 px below the fold, whatever the network emulation says
   (`navigator.connection.effectiveType` stayed `4g`); the heavy wall is 4,780 px tall. Measured with a
   synthetic page and JavaScript off, so it is the browser, not `deck.js`.
2. **The default view hides the whole grid until `deck.js` has run** (`html.deck … .st-grid{display:none}`
   once the head script has set the class), and `deck.js` runs after the document is parsed. Any byte in
   the HTML is a byte the pile waits for.

## Step 1: the picture route's own cache

The product owner adopted `hybrid-preload-lazy` in two steps: first the picture route stops re-reading
the whole file, measured; only then is the switch set. This is step 1. **The switch is still unset
everywhere**: nothing below runs in any deployment.

What it is (`packages/cardtile/serve/picture-cache.mjs`): the decoded bytes of a picture are kept in the
Workers Cache API under (handle, generation, hash, extension). A page view keeps the pictures it names
(it has already decoded and hashed them); a picture found in the file is kept for the next request. A
request that finds its picture reads the handle's generation and its stop, never the body.

Host CPU of the cardtile worker, medians, `hybrid-preload-lazy`, measured by
[`picture-cost.mjs`](picture-cost.mjs) on the commit before the cache and on this one, in one sitting
([`results/picture-cost-before.json`](results/picture-cost-before.json),
[`results/picture-cost-after.json`](results/picture-cost-after.json), 15 runs each):

| | before | after, picture asked for with no page view first (miss) | after, cold visit (page view, then its pictures) | after, warm |
|---|---|---|---|---|
| heavy, per picture | 36.5 ms | 26.5 ms | **0.24 ms** | 0.24 ms |
| heavy, the 36 pictures of one visit | 1,403 ms | 969 ms | **16 ms** | 18 ms |
| heavy wall, per picture | 48.5 ms | 37.7 ms | **0.21 ms** | 0.21 ms |
| heavy wall, the 36 pictures | 1,748 ms | 1,445 ms | **12 ms** | 12 ms |
| medium, per picture | 8.2 ms | 5.6 ms | **0.14 ms** | 0.13 ms |
| medium, the 8 pictures | 75 ms | 46 ms | **1.4 ms** | 1.3 ms |
| whole-file reads from the store for the pictures of one heavy visit | 36 (354 million characters) | 36 | **0** | 0 |
| small store keys read per picture | 6 | 8 | 3 | 3 |

- **A miss costs what the route cost before**; the cache does not make the whole-file path faster. The
  "before" and "miss" columns differ only because this shared machine was busier during the "before" run
  (load 21 against 16). Two interleaved pairs of 5 runs (`results/picture-cost-interleaved-*.json`) put
  the two within 2–10 % of each other: 36.1 and 35.1 ms after, 37.3 and 38.7 ms before, per heavy picture.
  Across all sittings the uncached path measured 26–51 ms per heavy picture and the cached one 0.2–0.4 ms.
- **The page view pays for keeping the pictures once**: about 10 ms more on the heavy page's first view
  (129.8 against 120.4 ms in the same run), one cache read on later views. That run kept all 36.
- **Since then a page view keeps at most its first 10 pictures** (in the order the page draws them), and
  fewer when its YouTube tiles already spent the request's budget: every Cache API call is a subrequest,
  and the Workers Free plan allows 50 per invocation, `fetch()` included (`picture-cache.mjs`
  `prefillCalls`: 1 read + 10 writes + 1 write of 50, 8 held back). On the heavy page pictures 11–36 are
  therefore kept by their own first request, which costs the "miss" column once per data center per
  hour. Not re-measured.
- What is not in these numbers: the store and the cache are in-memory stand-ins that answer at once. The
  time a real store takes to hand over a ~10 MB body 36 times is the larger saving and is not measured
  here; neither is a real cache's lookup time, eviction, or the fact that each data center has its own
  cache (a visitor's page view and picture requests normally reach the same one; when they do not, a
  picture request is a miss and costs the "miss" column).

How it stops when the page does:

- **Delete, and the next owner of the handle:** the key names the generation. A delete starts a new one,
  so every kept picture of the old lifetime is unreachable at once, everywhere, with nothing to purge.
- **Stop:** read on every picture request, cached or not. A stopped page's pictures answer the same 404
  as a handle that never existed while their entries are still in the cache; after a resume they are
  served from it again.
- **A picture taken off the page inside one lifetime:** a kept copy lives one hour
  (`PICTURE_CACHE_SECONDS`), so its URL can go on answering for up to that long in a data center that
  kept it. The visitor is still told `public, max-age=31536000, immutable`: the hour bounds what the
  cardtile worker serves, not what a browser that already has the picture keeps.

## Before anything ships (not done here)

- **Done in step 1 (above):** the picture route no longer costs the whole file once a picture is kept.
  What this bullet said before: It reads and parses the whole Cards file and hashes
  candidates for every picture: 27–46 ms of worker time per picture on the heavy file on this machine,
  1.0–1.6 s per cold heavy visit, plus a full store read of the ~10 MB file per picture
  ([`results/server-cost.json`](results/server-cost.json); the store stub here answers instantly).
  Pictures need their own cache entry (for example the edge cache, keyed by the immutable URL) or their
  own stored copy before this is viable. The page render itself is cheaper by URL than inline (113 ms
  against 227 ms on the heavy file) even though it hashes every picture.
- **Stopped pages and shared caches.** The route answers a stopped page's pictures with the same 404 as
  the page, but `public, max-age=31536000, immutable` lets any shared cache keep a picture for a year after
  the page stops. Inline pictures disappear with the page's 60 s. If a stop must take pictures down
  everywhere, use `private` (browser cache only) or a shorter shared lifetime; this was not measured.
- **First screen = the first two pictures the page draws** on its front (markup order, backs excluded; the
  measured runs used the first two the text names; on the specimens every reference is a drawn front tile,
  in order, so by construction the two are the same). That is the avatar and the next tile in the
  stack and list, and part of the wall's first screen (the wall shows about five). Preloading only the
  avatar might recover the ~0.16 s by-URL is ahead in the cold stack; not measured.
- **No validator on the page.** The page carries no `ETag`, so a repeat visit after 60 s downloads the
  HTML again in full. With pictures by URL that is ~60 kB; inline it is the whole page.

## Edge cases

- **A creator's own domain**: the page names `/a/<sha256>.<ext>` (`/<handle>/a/…` on the shared hosts; the
  root card under `/<root>/a/…`), and both the domain and the shared-host path answer the picture; a
  stopped page's pictures get the same small 404 the domain gives its page (tests in
  `packages/cardtile/serve/cardtile-asset-urls.test.mjs`, `cardtile-picture-switch.test.mjs`).
- **Editor, previews, save-time render, `/_preview/<id>`**: they never pass a plan, so they stay inline,
  byte for byte as now. og:image and the icons are unchanged (their own PNG paths).
- **The single-file markdown does not change**: `/<handle>.md`, `Accept: text/markdown` and the avatar
  exit are byte-identical with the switch on (18 of 18 requests over both specimens and three strategies).
- **What stays inline under every strategy**: SVG (an SVG served from the Cards origin could run script;
  inside `<img>` as data: it cannot), pictures of 1,024 bytes or less, base64 that does not decode.
- **Reserved boxes**: read from PNG, GIF, WebP and JPEG headers; AVIF gets none, and a JPEG turned by its
  EXIF orientation gets the stored ratio rather than the shown one.

## Method

- **Server**: the real cardtile worker, in-process, behind a local HTTP/2 + TLS front (`serve.mjs`); one
  origin per strategy. Responses are memoised after their first answer so the browser measures the page,
  not this machine rendering 10 MB; the worker's own cost is `server-cost.mjs`. The page's headers are the
  worker's: `Cache-Control: public, max-age=60` on HTML; `public, max-age=31536000, immutable` and
  `nosniff` on pictures. Favicon relays for the made-up links answer 404 locally (no run touches the
  internet).
- **Browser**: Playwright's Chromium 151, 390×844 CSS px at 3x, touch; CPU ×4
  (`Emulation.setCPUThrottlingRate`); network **9 Mbit/s down, 1.5 Mbit/s up, 150 ms added per request**
  (`Network.emulateNetworkConditions`). DevTools throttling adds latency per request and does not delay
  connection setup; with one origin and one HTTP/2 connection that is the same constant for every strategy.
- **Visits**: cold = a new browser context (empty cache); repeat = a new page in the same context opened
  120 s after the cold page closed (so the page's 60 s has expired). 6 strategies × 4 pages × 5
  repetitions, cold and repeat: 240 runs, interleaved and shuffled per round so drift hits every strategy.
- **Visitor**: no input until the first screen is complete; then one viewport every 0.7 s to the end (one
  card per step in the stack, which snaps); the run ends when every picture has loaded.
- **Numbers**: paint timing, Element Timing (`elementtiming` is added to every picture of every strategy
  by the server, ~20 bytes each), largest-contentful-paint, layout shift (session windows), image load
  events, and the CDP network log (requests not from cache, encoded bytes).
- **Specimens** (`make-fixtures.mjs`, not committed: ~22 MB): abstract numbered pictures drawn in
  Chromium's canvas and encoded like the asset ingest stores them (WebP up to 1600 px wide), with four
  JPEGs and one PNG among the 36; their sizes are in `results/specimen-*.pictures.json`. No real content.

### Limits

- One machine, shared: its 1-minute load average was 6–25 during the runs (`load1` per run in
  `runs.json`); the spreads in `summary.md` include that. Throttling ×4 is relative to this host.
- Chromium only. WebKit and Firefox were not measured; their lazy-loading distances differ.
- The **blank** column of `summary.md` (pictures on screen before they loaded) is only meaningful on the
  wall: in the stack, IntersectionObserver counts cards buried in the pile as visible. On the wall it
  also flatters inline, whose not-yet-parsed pictures do not exist yet rather than showing a blank box.
- `firstScreen` in the stack: the deck re-inserts the avatar card and Chromium reports no Element Timing
  entry for it; there the picture counts from max(its load, DOMContentLoaded + 2 frames).
- The recordings are separate runs with a screencast attached, which costs the throttled renderer
  something: they show order and shape; the times to quote are the measured ones.

## Reproduce

```sh
PW=<path to a playwright index.js>
node make-fixtures.mjs "$PW" /tmp/t339/fixtures
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout /tmp/t339/key.pem \
  -out /tmp/t339/cert.pem -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -days 30
node measure.mjs --pw "$PW" --fixtures /tmp/t339/fixtures --cert /tmp/t339/cert.pem --key /tmp/t339/key.pem --out runs.json
node summarize.mjs runs.json > summary.md
node record.mjs --pw "$PW" --fixtures /tmp/t339/fixtures --cert /tmp/t339/cert.pem --key /tmp/t339/key.pem --out rec/
node server-cost.mjs /tmp/t339/fixtures 15 server-cost.json
# step 1: this checkout, then the same harness against a checkout of the commit before the cache
node picture-cost.mjs /tmp/t339/fixtures 15 picture-cost-after.json
node picture-cost.mjs /tmp/t339/fixtures 15 picture-cost-before.json <path to that checkout>
```

The full matrix took 70 minutes here.
