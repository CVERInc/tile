# every-number — a 25 MiB Cards file, measured on every path

**Step 1 of the "Every number" work: measure only.** Nothing in the engine changed for this. The
question was whether one Cards file at the ceiling — 834,151 tiles, one line each, 26,214,400 bytes —
can be saved, stored and served by the cardtile worker as it is today, and where it breaks first.

Short answer: **it fits the save path's byte check with 0 bytes to spare, and every path that reads
it parses all of it first.** Parsing alone does not finish inside 256 MB of V8 old space; the page
view and the save do not finish inside 768 MB, take 12–15 s of CPU in Node, and the page answers with
153 MB of HTML, none of which exists before all of it does. Numbers first; raw lines in `logs/`.

## Numbers

Medians of 3 runs, each in a fresh process, Node 22, load1 ≤ 12 at the start of each run (ranges and
every run's load are in the logs). "Peak RSS" is the whole process, sample string included. Paths
are relative to `packages/cardtile/`; line numbers are of the commit this directory arrived in.

### The sample

| | |
|---|---|
| bytes (UTF-8) | **26,214,400** (= 25 MiB) |
| UTF-16 code units | 26,210,617 (it holds `×`, `…`, `’`: V8 keeps it as a two-byte string, ~50 MB of heap) |
| newlines | 867,935 |
| front tiles / backs / back tiles | 834,151 / 4,201 / 4,201 |
| gzip -6 | 2,397,424 bytes |
| sha256 | `f169698c48e681d2cf563c17746c7dde2ca61af57ef04f7ddca4e28e78e95453` (the prototype's file) |

### 1. The save path's size checks

| Check | Where | Limit | The sample | Headroom |
|---|---|---|---|---|
| the ceiling | `card-core.js:496` `CARD_MAX_BYTES = 25 * 1024 * 1024` | 26,214,400 B | 26,214,400 B | **0 B** |
| save_cards | `serve/card-api.mjs:1104` (`bytes > KV_MAX_BYTES` → 413; `KV_MAX_BYTES = CARD_MAX_BYTES`, `:39`) | 26,214,400 B | passes: the test is `>` | 0 B — one byte more is a 413 |
| the commit, last line | `serve/card-api.mjs:1058` (throws) | same | passes | 0 B |
| put_asset | `serve/card-api.mjs:1160` | same | — (no assets) | any asset is a 413 |
| sandbox park `/try/park` | `serve/card-worker.mjs:1021`, `TRY_MAX_BYTES` `serve/card-api.mjs:1337` | 1,536,000 code units | 26,210,617 | **24,674,617 over** (413 "That card is too big to carry.") |
| outbound links (only with a Web Risk key) | `serve/url-risk.mjs:66` | `MAX_URLS` | 0 destinations | — |
| the request body | none in the code; `serve/card-api.mjs:1848` parses it whole | (the runtime's, not cited) | **27,095,141 B** of JSON | — |

A save does not add a byte: `serializeCard(parseCard(x))`, `assembleSave(x)` and `thinCard(x)` all return
the file unchanged (`logs/roundtrip.jsonl`, `identical: true`, 2.6 s / 3.4 s / 2.6 s each). The Durable
Object keeps it as 100 chunks of at most 262,144 code units (`serve/card-api.mjs:1004–1009`).

`bytes` in the save answer is **26,210,617**, not 26,214,400: it is `md.length`, code units
(`serve/card-api.mjs:1067`; the same in list_cards `:1626` and get_cards `total_bytes` `:1842`).

### 2. The KV value

The code states the figure twice, differently: `card-core.js:492` "a KV value is 25 MiB" (and enforces
26,214,400), `assets/embed.mjs:66` "a KV value is 25MB". The Cloudflare page that would settle it could
not be opened from this session. The harness's KV took the value (one put, `card:every-number:0`,
26,214,400 bytes, sha256 equal to the sample) — a Map cannot refuse, so that says nothing about KV.

If KV refuses a value of this size, the code path is: `writeThrough` (`serve/card-api.mjs:1037`) catches
the put's error, the save still answers **200** with `cache: "pending"`, and `retryLater`
(`serve/card-api.mjs:417`) re-arms the object's alarm, which re-reads the 100 chunks and tries the put
again, without a cap. For a new handle the page meanwhile has no body to serve.

### 3. Parser and renderer

| Step | Wall | CPU | Peak RSS | Out |
|---|---|---|---|---|
| `parseCard` | 1,341 ms | 1,830 ms | 441 MB | 834,151 front tiles, 4,201 backs |
| `renderCardHTML` (as the page calls it) | 4,956 ms | 7,109 ms | 1,926 MB | **160,336,614 B** (152.9 MiB) of HTML, 3,103,484 B gzipped; 838,352 tile elements |

Time to the first tile: the first tile's markup is at character 31,830 of 160,336,614, but
`renderCardHTML` returns one string, so **no byte of the page — the first tile's included — exists until
the whole render has returned**: 4.9 s for the render alone, and 9.1 s from the request in the page
view (section 4), which parses twice more before it renders.

28.4% of that HTML is one stylesheet: `renderGrid` opens every grid with `<style>${NATIVE_CSS}</style>`
(`card-render.mjs:1489`), and `renderDrawers` draws one grid per back (`card-render.mjs:1507`), so the
10,852-byte sheet is in the page **4,202 times — 45,589,252 bytes** (`logs/html-share.jsonl`; at 1,000
tiles it is 89.3% of the page). The rest is ~137 bytes per tile: every tile here is `text`, and each one
is its own full-width `.st-bleed` row (`card-render.mjs:1467–1469`).

### 4. The page view (cardtile worker, `GET /every-number`)

| | Wall | CPU | Peak RSS | Response |
|---|---|---|---|---|
| `GET /every-number` | **9,094 ms** | **12,179 ms** | 2,155 MB | 200, **160,336,614 B** |
| `GET /every-number.md` (the download) | 1,476 ms | 1,952 ms | 881 MB* | 200, 26,214,400 B |
| `GET /every-number`, `Accept: text/markdown` | 3,077 ms | 4,553 ms | 881 MB* | 200, 26,214,400 B |

\* both `.md` exits in one process.

The page view parses the whole file **three times** before it answers (`logs/view-parts.jsonl`):

| Step, in order | Where | Wall | CPU |
|---|---|---|---|
| `isTemplateOnly` → `parseCard` | `serve/card-worker.mjs:1182` → `card-blank.mjs:82` | 1,117 ms | 1,495 ms |
| `resolveChannels` → `channelsIn` → `parseCard` | `serve/card-worker.mjs:1269` → `yt-channels.mjs:44` | 1,179 ms | 1,499 ms |
| `renderCardHTML` → `renderFlat` → `parseCard`, then the render | `serve/card-worker.mjs:1281` → `:417` | 3,719 ms | 5,304 ms |

The download exit `.md` serves the stored bytes, but only after `isTemplateOnly` has parsed them
(`serve/card-worker.mjs:1182` runs before the `want === 'fat'` exit at `:1249`).

CPU against the Workers CPU limit: `wrangler.example.toml` sets no `[limits]`, so the deployed default
applies; that figure is not quoted here (see above). What is measured is ~12 s of CPU in Node for one
page view.

### 5. save_cards end to end (`PUT /_api/card/every-number`, a new handle)

| | Wall | CPU | Peak RSS | Answer |
|---|---|---|---|---|
| first save (`create: true`, body streamed) | **10,735 ms** | **15,247 ms** | 2,089 MB | 200; KV holds the file byte for byte; 103 object puts |
| the next save (`base_version`, one tile edited, same size) | **21,233 ms** | **27,052 ms** | 3,160 MB | 200 |

Its steps, each alone (`logs/save-parts.jsonl`): `JSON.parse` of the body 46 ms; `assembleSave` 2,632 ms
wall / 4,248 ms CPU; `cardLinkReport` 4,766 / 6,470 — **the save renders the whole page** to learn its
link destinations (`serve/card-api.mjs:1875` → `serve/card-destinations.mjs:33`); `cardVersion` (sha256)
74 ms; `utf8Length` 76 ms. One save runs `assembleSave` three times (the object's check,
`serve/card-api.mjs:1866` → `:1102`; the Worker's, `:1874`; the object's write, `:1102` again), each a
parse and two serializes (`card-save.mjs:133–151`); the next save parses the stored file as well.

### 6. The editor (edit3)

No headless path (edit3.mjs binds to the DOM at module top level). Its non-DOM work on load:
`parseCard` 1,685 ms; the layout view, `renderCardHTML(md, { editIndex: true })` into an iframe
(`w3/edit3.mjs:1155`), 5,379 ms wall / 7,623 ms CPU → **173.5 MB** of HTML; the preview,
`renderCardHTML(md, { deck: false })` (`w3/edit3.mjs:169`), 4,011 ms → 152.9 MB. Peak RSS 2,696 MB.
Then the browser lays out ~838k tile elements and Sortable is attached to every container of front
tiles (`w3/edit3.mjs:1143`) — not measured.

### 7. Memory ladder — does it finish inside a V8 old-space cap?

| Path | 128 MB | 256 MB | 384 MB | 512 MB | 768 MB | 1024 MB |
|---|---|---|---|---|---|---|
| `parseCard` | ✗ parseCard | ✗ parseCard | ✓ | ✓ | ✓ | ✓ |
| page view, step by step | ✗ isTemplateOnly | ✗ isTemplateOnly | ✗ renderCardHTML | ✗ renderCardHTML | ✗ renderCardHTML | ✓ |
| page view, `worker.fetch` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `renderCardHTML` alone | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| save, step by step | ✗ assembleSave | ✗ assembleSave | ✗ assembleSave | ✗ assembleSave | ✗ cardLinkReport | ✓ |
| save, `handleApi` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `deck.js` file mode (section 9) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |

✗ = V8 out-of-memory abort (exit 134) in the step named. The step-by-step save holds the request body and the sample
at once (the bench's own strings), so its steps are charged more than the real handler would be; the end-to-end save streams its body and holds no copy of the file.

### 8. Scale — the page view at K tiles (same generator, stopped after K)

| Tiles | File | HTML | Wall | CPU | Peak RSS | Inside 128 MB old space |
|---|---|---|---|---|---|---|
| 1,000 | 53,278 B | 2,551,502 B | 97 ms | 136 ms | 121 MB | ✓ |
| 10,000 | 351,288 B | 7,056,668 B | 277 ms | 500 ms | 209 MB | ✓ |
| 100,000 | 3,237,653 B | 35,756,600 B | 1,421 ms | 1,962 ms | 536 MB | ✓ |
| 834,151 | 26,214,400 B | 160,336,614 B | 8,130 ms | 10,403 ms | 2,021 MB | ✗ |

Cost grows about linearly with the tile count: ~10 µs of wall and ~12 µs of CPU per tile here.

### 9. The on-demand half that already exists (`w3/deck.js`)

`w3/deck.js` can already take a whole Cards file as its items: from `window.__cardMd`, or fetched from
the page's `data-card-src` (`w3/deck.js:60–62`). It reads the file with its own line scanner — not
`parseCard` (`w3/deck.js:88–96`) — and builds a tile only when it comes near view (`w3/deck.js:283`;
the wall view is virtualized, `virtualBrick`, `:177`). This is what the prototype runs. Measured under
`w3/mini-dom.mjs`, the stand-in DOM that `w3/deck-views.test.mjs` uses (no layout, so this is the script's work
only), with the 25 MiB sample handed to a one-tile host page (`logs/deck-file.jsonl`):

| | Wall | CPU | Peak RSS | Items | Elements on the page after boot |
|---|---|---|---|---|---|
| `deck.js`, file mode | **163 ms** | **216 ms** | 233 MB | 834,151 | 328 (30 before) |

It finishes inside a 256 MB old space, not inside 128 MB (`logs/ladder-deck-file.jsonl`; the stand-in
DOM is in that heap too). Two limits on what it is: it shows each line's text and its back's lines as
plain text — no links, pictures or other tile types (`w3/deck.js:283`) — and the cardtile worker never
writes `data-card-src` today; only the prototype's page does.

## Where it breaks first

Walking the path an owner's file takes, in order:

1. **The save, at its first full parse** — `serve/card-api.mjs:1866` asks the handle's object to check
   the save, which runs `assembleSave` (`serve/card-api.mjs:1102`) → `parseCard`
   (`card-save.mjs:134`). Under any cap up to 512 MB the save dies there; the size check that follows
   it (`:1104`) would pass with 0 bytes to spare. At 768 MB it gets one step further and dies in the
   Worker's own full render for link destinations (`:1875` → `serve/card-destinations.mjs:33`).
2. **The page view, at its first full parse** — `serve/card-worker.mjs:1182` (`isTemplateOnly` →
   `card-blank.mjs:82`), under 256 MB; then in the render (`:1281`), under 768 MB. When it does finish:
   ~12 s of CPU, 153 MB of HTML, nothing sent before the end.
3. **The visitor's browser** — 160 MB to parse into ~838k tile elements; not measured here.

So the first thing that breaks is not a size check. It is that **every path reads the whole file into
a full model before doing anything** — three times on a page view, four (create) to seven (update)
times on a save, once even to serve the raw download.

## Options (not implemented)

**A. A size tier, read on demand in the browser (the prototype's own shape).** Above a tile count the
page exit stops rendering the file: it serves the page shell with `data-card-src="/<handle>.md"`, and the
browser fetches the file (2.4 MB gzipped) and builds tiles as they come into view — the path `w3/deck.js`
already has (section 9: 163 ms of script for all 834,151 items, against ~9 s and 153 MB for the server
render). *Changes:* the page exit (`serve/card-worker.mjs:1281`) and the two parses before it (`:1182`,
`:1269`) decide by size first, from the byte length or a line count, never a parse; the shell; and, for
any file that is not one line of text per tile, a client renderer that reuses `card-render.mjs` (pure
ESM) instead of widening `deck.js`'s own scanner into a second grammar. *Cost:* for this file, small — the
client half exists and matches its shape. For Cards files in general, the client renderer is the work,
and `deck.js:88–96` is already a second reader of the format beside `card-core.js` that nothing holds to
the first. A visitor without JavaScript and a crawler see the shell only (the file itself stays at
`/<handle>.md`; the HTML page does not link it as an alternate today — only the markdown exit's `Link`
header does, `serve/card-worker.mjs:659`). The editor needs its own answer (its layout view is the full render). It does nothing
for the save path, which still parses everything four times and renders everything once.

**B. One parse, and a streamed body.** Parse once per request and pass the model along (the three
parses become one); make `renderGrid` / `renderDrawers` / `renderPage` yield pieces and answer with a
`ReadableStream`; and stop repeating the grid stylesheet per back (−45.6 MB, −28% of this page, and the
largest share on small files with many backs). *Changes:* `card-render.mjs` (`:1400–1531` to generators;
the `grid.includes(…)` checks at `:1556`, `:1559` computed from the model instead), `withDeck`
(`w3/deck-page.mjs:124–130`, which slices the finished string), `isTemplateOnly` / `channelsIn` taking a
model, and the save's `cardLinkReport` consuming the stream without keeping it. *Cost:* a refactor of the
renderer core that must stay byte-identical with today's output for every existing Cards file (the
`editor-fidelity` and specimen tests are the gate). First byte comes in milliseconds and peak memory
drops by the size of the HTML; **CPU does not drop** below one `renderCardHTML`, its parse included (~5.3 s here), and
the browser still receives ~115 MB. Necessary for A's first screen anyway; not sufficient alone.

**C. A measured serving ceiling, refused by name at save.** Keep 25 MiB as the storage ceiling and add a
second one for what the cardtile worker will render as a page — a tile count, set from the scale table
against the runtime's real limits — refused at save the way an oversized embed is
(`embedsOverCeiling`, `card-core.js:520`), naming the count. *Changes:* one check in
`serve/card-api.mjs` beside `:1104`, one in the commit (`:1058`), and `GRAMMAR.md`. *Cost:* smallest, and
it means this file cannot be a page as it is; "the most a Cards file can hold" would then be a different
number from 25 MB, which is the owner's word to give, not this bench's (the product's own copy says
"One file. Under 25 MB.", `w3/deck-i18n.mjs:38`). The save still has to parse to count, unless the
count is taken from lines.

The numbers point at **A for this file, with C's check as its trigger**: the tier test C needs is the
same test A switches on, the client half of A is already in the repository and takes about a fiftieth of the
page view's time on the same file in the same Node harness (163 ms against 9,094 ms — before any browser
layout, which neither number includes), and C alone would mean the file cannot be a page at all. B's single
parse and the stylesheet are worth doing on their own (they cut every page view, not just this one),
but streaming alone leaves the CPU where it is. Whatever is chosen, the save path is untouched by A and
B and stays at ~15 s of CPU and ~1 GB for this file: that needs its own decision (C's ceiling, or a
destination scan that does not render).

## What is here

| File | What it does |
|---|---|
| `sample.mjs` | Builds the sample. Reproduces the prototype's file byte for byte and checks it: `sha256 f169698c…e95453`, 26,214,400 bytes, 867,935 newlines. One tile per number 0…834,150 (`- [ ] %% card: text … %% <n>`); 4,200 numbers open a back with a story of their own (`## back: n<n>`); the 66,351 other primes open the one shared `## back: prime`. Stories are computed (palindromes, triangular numbers, squares, cubes, repdigits, runs, Fibonacci, powers of two, factorials, perfect numbers) except 51 written by hand, which are a table in the file. |
| `measure.mjs` | One stage of the measurement in one process; prints one JSON line. Every outbound `fetch` is replaced by one that refuses and counts (`networkAttempts`, 0 in every log). |
| `harness.mjs` | The stand-ins: a Map for KV, and Durable Object namespaces holding the **real** `CardLifetime` and `HostBindings` classes over a Map storage — the same shapes as `serve/card-api.test.mjs`. |
| `html-share.mjs` | How much of the page view's HTML is the grid stylesheet repeated once per back. |
| `run-all.sh` | Builds the sample in `$TMPDIR`, then runs each stage in its own child process under `timeout` and `--max-old-space-size`, waiting for load1 ≤ 12 before each run. Appends to `logs/<stage>.jsonl`. |
| `logs/` | The raw results this README quotes. Each line carries the old-space cap, exit code, load average and time of the run. |

Run: `TMPDIR=<scratch> bash run-all.sh` (all stages, ~30 min on an idle machine), or name stages:
`bash run-all.sh render view`. The sample is never committed; `sample.mjs` makes it in ~2 s.

## What the numbers can and cannot say

- **Node, not workerd.** No Miniflare or workerd is installed in this repository and this lane
  installs nothing, so "the cardtile worker under the local harness" is the worker's own
  `fetch`/`handleApi` run in Node 22 with the stand-ins above — the repository's existing worker test
  setup. Same V8 family, different runtime: the times are an estimate of the work, not of the edge.
- **CPU** is `process.cpuUsage()` for the whole process, so GC helper threads are included; wall time
  is beside it. The machine is shared: each log line records load1 at the start of the run.
- **Memory** is reported two ways: the process's peak RSS, and the *memory ladder* — the same stage run
  under `--max-old-space-size` 128, 256, 384, 512, 768 and 1024 MB. A run that cannot finish dies with
  V8's out-of-memory abort (exit 134) and its log line names the step it was in (`diedIn`). The cap is
  V8's old space only; it is a floor for what a runtime must give the isolate, not a model of one.
- **Limits not measured, only named.** The stand-ins accept any value size, so nothing here measures
  KV's refusal of a large value, the Durable Object storage's per-value limit, the runtime's CPU or
  memory limits, or the time a real 25 MiB KV read takes. The Cloudflare limits pages could not be
  opened from this session, so **no Cloudflare figure is quoted here**; the only KV figure is the one the
  code itself states (see below).
- **No browser.** No browser automation was available to this lane, so what a visitor's browser does
  with the page (download, parse, layout of ~838k tile elements, `deck.js` on top) is not measured.
  edit3 has no headless path (it binds to the DOM at module top level); what it runs on load that is
  not DOM — the parse, the layout render, the preview render — is measured as the `editor` stage.
