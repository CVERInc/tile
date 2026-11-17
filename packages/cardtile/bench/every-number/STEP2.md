# every-number, step 2 — the page view by size tier

**Step 2 of the "Every number" work.** Step 1 (README.md beside this file) measured that every path a
25 MiB Cards file takes parses all of it first. Step 2 changes the page view only: above
`ON_DEMAND_TILES` tiles (`serve/size-tier.mjs`) the cardtile worker does not parse or render the file.
It serves a shell — the page the head of the file makes — with `data-card-src` naming the file at its
own download address, and `w3/deck.js` reads the file in the browser (its file mode). At or below the
threshold the page is what it was. The save path is not changed; it is measured again here.

`sample.mjs` and `harness.mjs` are the step-1 bench's, byte for byte; `README.md`, `measure.mjs` and
`run-all.sh` (which measured the save path below) arrive with the step-1 bench itself.

Medians of 3 runs, each one request in a fresh Node 22 process (`step2.mjs`, `run-step2.sh`), load1 at
the start of every run in the logs (all runs between 5.8 and 11.5). "First byte" is the time until
`worker.fetch` resolves: every exit here answers with a body that is already whole, so no byte can
leave before it. Peak RSS is the whole process, the sample string included. Raw lines:
`logs/step2-before.jsonl` (the worker at the commit this branch starts from),
`logs/step2-after.jsonl`, `logs/step2-save.jsonl`.

## The page view, before and after

| File | | First byte | CPU | Peak RSS | Response |
|---|---|---|---|---|---|
| the 25 MiB sample, 834,151 tiles | before | 5,910 ms | 8,736 ms | 1,693 MB | 114,684,377 B |
| | **after** | **67 ms** | **82 ms** | **143 MB** | **33,646 B** (the shell) |
| its first 100,000 tiles | before | 695 ms | 1,123 ms | 344 MB | 14,500,778 B |
| | **after** | **44 ms** | **54 ms** | **127 MB** | 33,646 B |
| `GET /<handle>.md` (25 MiB) | before | 1,067 ms | 1,566 ms | 533 MB | 26,214,400 B |
| | **after** | **69 ms** | **158 ms** | **225 MB** | 26,214,400 B |
| `Accept: text/markdown` (25 MiB) | before | 2,485 ms | 3,761 ms | 869 MB | 26,214,400 B |
| | after | 1,747 ms | 2,758 ms | 792 MB | 26,214,400 B |

`deck.js` over the shell the worker serves for the sample, with the browser's fetch of `data-card-src`
answered by the same worker, under `w3/mini-dom.mjs` (no layout): 834,151 items, `ready`, 299 ms wall
and 354 ms CPU for the fetch, the read and the boot; 729 elements on the page after boot.

The step-1 numbers (README.md) were taken before the grid stylesheet stopped being repeated per back
(tile#359); "before" here is re-measured on the commit this branch starts from, which has that.

### Inside a capped old space (`--max-old-space-size`)

| File | 32 MB | 64 MB | 128 MB |
|---|---|---|---|
| 25 MiB sample, after | ✗ | ✗ | ✓ |
| 100,000 tiles, after | ✓ | ✓ | ✓ |
| 5,000 text tiles, after (shell: 5,365 tiles with its backs) | ✓ | ✓ | ✓ |
| 5,000 link tiles, after (rendered, at the threshold) | ✓ | ✓ | ✓ |
| 5,001 link tiles, after (shell) | ✓ | ✓ | ✓ |

The 25 MiB file does not fit 64 MB **before the page view does anything**: the worker reads the KV
value whole, and this sample, which holds `×`, `…` and `’`, is a two-byte string of 52 MB. Control arm:
the worker's modules loaded and the sample read and held, no request — 63 MB of heap in use. What the
shell path adds on top of holding the file is small; holding the file is the floor, and only a read of
the head of the value (not the whole value) would lower it. Not done here.

## The threshold: 5,000 tiles

From the page view before the tier (`logs/step2-before.jsonl`):

| Tiles | Text tiles: first byte / CPU / RSS | Link tiles (w=2): first byte / CPU / RSS | Fits 32 MB / 64 MB / 128 MB (text · links) |
|---|---|---|---|
| 5,000 | 113–125 ms / 228–249 ms / 116–123 MB | 270 ms / 401 ms / 161 MB | ✓✓✓ · ✓✓✓ |
| 10,000 | 147 ms / 288 ms / 148 MB | 552 ms / 757 ms / 201 MB | ✓✓✓ · ✗✓✓ |
| 20,000 | 212 ms / 410 ms / 186 MB | 1,650 ms / 1,990 ms / 278 MB | ✗✓✓ · ✗✗✓ |
| 50,000 | 427 ms / 720 ms / 253 MB | 6,720 ms / 7,220 ms / 393 MB | ✗✓✓ · ✗✗✓ |
| 100,000 | 695 ms / 1,123 ms / 344 MB | — | ✗✗✓ · — |

Text tiles cost about 9–11 µs of CPU each past the first 10,000 ((1,123 − 288) ms / 90,000 tiles; (720 − 288) ms / 40,000). Link tiles do not grow linearly:
packing a grid of w=2 tiles (`card-core.js` `packGrid`) starts every tile's search at row 0, so it
grows with the square of the count (alone: 5,000 tiles 95 ms, 10,000 701 ms, 20,000 2,923 ms). At
5,000 tiles both shapes finish inside a 32 MB old space — a quarter of the runtime's 128 MB — in at
most 0.46 s of CPU in Node. At 10,000 the link tiles no longer fit 32 MB. The Workers CPU limit is not
quoted here (the limits page could not be opened from this session); what is measured is CPU in Node.

## The save path, measured again (not changed)

`PUT /_api/card/every-number` through the worker's API and the real `CardLifetime` (`run-all.sh save
resave save-parts`), 3 runs each:

| | Wall | CPU | Peak RSS |
|---|---|---|---|
| first save (`create: true`) | 11,705 ms | 16,324 ms | 1,813 MB |
| the next save (`base_version`) | 15,522 ms | 21,092 ms | 2,981 MB |
| `assembleSave`, alone | 1,783 ms | 2,858 ms | — |
| `cardLinkReport`, alone (renders the page for its links) | 3,120 ms | 4,444 ms | — |

## What the shell is made of, and what it is not

`shellSource` (`serve/size-tier.mjs`) is a small Cards file, rendered by the same `renderCardHTML` as
every page, so its head is built by the same code: the frontmatter fence; the first profile tile in a
front lane within the first 64 KiB (`HEAD_UNITS`); that tile's avatar and its PNG copy, found in the
`## assets` lane by searching for their ids, not by parsing the lane. The exchange state, the canonical
address, the visitor's language and the picture plan are computed as for any page, over that file.

Read only from the frontmatter fence: today's page reads `title:`, `lang:`, `accent:` and the rest from
the first line in the whole file that starts with the key, body included.
