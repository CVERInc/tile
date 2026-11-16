# Step 3: the page view past the size tier, in windows

Step 2 (STEP2.md) served a page past `ON_DEMAND_TILES` as a shell and left the tiles to the visitor's
browser. That shell is gone. Past the tier the page is now served in **windows**
(`serve/size-tier.mjs`): the page is the first window, `?w=<n>&r=<revision>` is the n-th, and each one
is a whole page rendered by the same renderer as every page, with plain links to the windows on either
side. `w3/deck.js` fetches the next window when a visitor nears the end of what is loaded.

A window holds at most `WINDOW_TILES` (1,000) tiles and `WINDOW_UNITS` (1 Mi UTF-16 units) of tile
text. Both count the window's front tiles and every back those tiles turn over to.

Raw lines: `logs/step3-after.jsonl` (`run-step3.sh`, `step3.mjs`). One request per fresh Node 22
process. The figures are medians of 3 runs, at load1 8.8–9.5.

## Per window (first byte · CPU · peak RSS)

| Source | Before the tier (dd0f44e, whole page) | Shell (step 2) | Window 1 | Middle window | Last window |
|---|---|---|---|---|---|
| 25 MiB sample, 834,151 front tiles, 4,201 back lanes (842 windows) | 5,910 ms · 8,736 ms · 1,693 MB, 114.7 MB of HTML | 67 · 82 · 143 MB, no tiles | **332 · 410 · 198 MB**, 232 KB, 1,000 tiles | 330 · 402 · 199 MB | 333 · 407 · 197 MB (114 tiles) |
| The sample's first 100,000 tiles (103 windows) | 695 · 1,123 · 344 MB, 14.5 MB | 44 · 54 · 127 MB | **108 · 171 · 134 MB**, 232 KB | 104 · 169 · 134 MB | 107 · 173 · 134 MB |
| 100,000 link tiles, w=2 (100 windows) | not measured at 100k (50,000: 6,720 · 7,220 · 393 MB) | not measured | **109 · 157 · 131 MB**, 773 KB | 112 · 163 · 130 MB | 118 · 169 · 130 MB |

Every window costs about the same. Where it starts in the file changes nothing measurable: each request
reads the whole file once, and renders one window.

What a window request spends on the 25 MiB sample, timed piece by piece in one process:

| Piece | Time |
|---|---|
| Bounded count (stops past 5,000 tiles) | 7 ms |
| Full index of where the tiles are | 81 ms |
| The window cut (`windowsOf`) | 132 ms |
| The revision (SHA-256 in 1 Mi-unit slices) | 69 ms |
| One window's model | 6–10 ms |
| The first profile tile | 15 ms |

The rest is the 13 frontmatter keys, read from the whole file as every page reads them (41 ms
measured), and the render of 1,000 tiles.

🩸 The first run of this bench measured about 6 s of CPU per window of the sample
(`windowsOf` alone: 7,280 ms). The sample has 4,201 back lanes, and every tile holding a `#` was
compared against every back's id. The lookup now goes by the ids' lengths at each `#`, which is the
same rule (size-tier.mjs `backsNamed`).

## Inside a capped V8 old space (does one request finish?)

| Source | 32 MB | 64 MB | 128 MB |
|---|---|---|---|
| 25 MiB sample, any window | no | no | **yes** |
| first 100,000 tiles, any window | **yes** | yes | yes |
| 100,000 link tiles, any window | no | **yes** (48 MB too, one run) | yes |

The sample's floor is the file itself. The KV value is read whole into a 52 MB two-byte string, as in
step 2, so nothing under 64 MB holds it plus the request.

For 100,000 link tiles, the file alone (7 MB, built by the harness, no request made) is 10 MB of heap
after a collection. Every piece of the window request fits under 32 MB when run on its own
(`.bench-tmp` probe: 23 MB after the window's model). The whole request does not fit under 32 MB, and
neither does its icon exit; the download exit does. Not chased further: every window fits in a quarter
of the runtime's 128 MB except the sample's, whose floor is the read.

## The other exits, past the tier

| Exit | 25 MiB sample | First 100k tiles | 100k links |
|---|---|---|---|
| `GET /<h>.md` | 144 ms · 273 ms · 254 MB (step 2 shell: 69 · 158 · 225; before: 1,067 · 1,566 · 533) | 52 · 105 · 140 MB | 49 · 81 · 133 MB |
| `GET /<h>/favicon.svg` | 135 · 187 · 155 MB | 54 · 97 · 128 MB | 56 · 75 · 115 MB |

Both exits now read the index once, because the blank-template rule holds above the tier (size-tier.mjs
`blankAbove`). That accounts for the download's 75 ms over step 2's shell.

## What is not measured here

- The save path. It is unchanged; STEP2.md has its numbers.
- `Accept: text/markdown`. It still parses the whole file.
- A real KV read of 25 MiB, and the Workers runtime itself. As in step 2, `harness.mjs` names what the
  stand-ins cannot model.
- The deck in a real browser. `serve/size-tier.test.mjs` drives `w3/deck.js` in `w3/mini-dom.mjs`,
  which has no layout.
- step2.mjs's `deck` stage. It read the file the step-2 shell named in `data-card-src`. The worker names
  no file now, so that stage measures nothing.
