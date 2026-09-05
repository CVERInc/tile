# Card layout — what we tried, and what the browser said

Not competitor research (that is `docs/research/link-in-bio-survey-2026-07/`). This is our own
design work: two experiments run on 2026-07-29 while deciding what a Card's grid should be.

The survey had just established, from five independent sources, that **a row is what a link is** and
a tile is what a link becomes when it has a picture worth looking at. These experiments ask what
that implies for the grid.

## Experiment 1 — drop `h`, let the browser pack

`flow-experiment.mjs` — override today's stylesheet so heights come from content and CSS does the
packing (`grid-auto-rows: auto` + `grid-auto-flow: row dense`), then measure.

**It produced garbage, three times.** Cells overlapping, images spilling 329px out of their boxes,
grids reporting negative empty space.

That failure is the finding: **`.st-gal-img` is `position: absolute`, filling a box whose height the
GRID supplies.** Take the grid's height away and the picture contributes none, so the cell collapses
to one row while the image overflows it. Every image tile in the renderer rests on that assumption.

> **This change cannot be previewed from the outside. It is a rebuild of the cell layer, not a CSS
> flag.**

Three rounds of overrides showed the fight, not the idea — which is its own lesson about method.

## Experiment 2 — the same idea, written from scratch

`flow-proto.mjs` — ~40 lines of honest CSS, same content, read from the real cards through
`card-core`. No legacy assumptions to fight.

| card | result | overlaps |
|---|---|---|
| a link-heavy card | **26 links, all rows**, grouped under lane headings with favicon + sub-label | 0 |
| a picture-heavy card | **the bento rhythm intact** — 6-wide, 3+3, 6-wide, 3+3 | 0 |

Same stylesheet, same model, opposite-looking pages — decided entirely by content type and `w`.
`h` never appears. Internals reflow from the cell's own width via a container query, so nobody
authors "row" or "tile".

**Measured, and the nicest result of the day:**

| | width | height | in base units |
|---|---|---|---|
| square picture at `w=3` | 173 | **173** | **exactly 3.00** |

A square picture at `w=N` is exactly N units tall — N column widths plus N−1 gaps, on both axes.
**The old grid's rhythm survives without `h` existing**, as arithmetic rather than as a rule.

🔴 What this prototype does NOT prove: it renders 3 of 7 cell types (feature / link / prose). No
profile, video, social, drawers, backdrop, QR mount. **Page heights are therefore not comparable**
to the live cards and are not quoted here. The 2:1 aspect for full-width pictures is a choice made
in the prototype, not a finding. Ragged mixed-aspect rows are untested — the picture-heavy card's
images all happen to be square.

## Experiment 3 — what happens when content exceeds its box

`minmax-overflow.html`. The candidate: `grid-auto-rows: minmax(1 unit, auto)` — every implicit row
is at least one unit and grows if what is in it needs more.

| cell | height | units | scrolls? |
|---|---|---|---|
| square picture 3×3 | 173 | **exactly 3.00** | no |
| full-width 6×2 | 111 | **exactly 2.00** | no |
| 2×2 with far too much text | 431 | 7.19 | **no — it grew** |
| **2×2 with two characters** | **431** | **7.19** | no |

It works: content that will not fit grows the cell instead of scrolling or clipping, in pure CSS,
with squares still exact.

**And the last row is the price.** A grid row's height is shared, so the overflowing cell dragged
its neighbour to 431px too — two characters alone at the top of a huge empty box (`shots/minmax.png`).

So the growth is safe exactly when the cell has no row-mates:

> **A full-width cell may exceed its declared height. A narrower one may not.**
> Not a policy — the geometry. `w=6` owns its rows; `w=2` shares them.

### Which answers "what about beyond 6×6"

**`h > 6` is not needed.** Anything tall enough to want it — a long text, a rate card, terms — is
full-width by nature (nobody reads a long text in a two-column-wide box on a phone), and a
full-width cell grows on its own. `SPAN_MAX = 6` is ours, not CSS's, and it stops being a ceiling
that bites because everything that would hit it is on the other path.

A **short** text in a 2×2 is fine and lands on exactly 2 units. A **long** one in a 2×2 is an
authoring mistake, and the right response is to show the author, not to silently inflate the
neighbour — **quietly compensating turns one person's mistake into two broken cells.**

## Where this leaves the design

- `1x1 … 6x6` **stays**. Its rhythm is real, and squares land on whole units by arithmetic.
- Height stops being authored: `minmax` grows what does not fit.
- Only full-width cells may grow.
- `h > 6` never needs to exist.

Still open, and it decides how dense a row is: **does the frame sit on the cell or on the lane?**
Linktree puts it on the cell — a 64px bordered button, ~76px pitch. The ancestor puts it on the
group — plain ~35px rows inside one rounded card, which is how 27 links fit in a 1945px page.

## Reproduce

    node docs/experiments/card-layout-2026-07/flow-proto.mjs      # writes /tmp/proto-<card>.html + shots
    open docs/experiments/card-layout-2026-07/minmax-overflow.html

`flow-experiment.mjs` is kept for the failure, not the result — it is the evidence that this cannot
be done as an override.

## 🔴 What is not here, and why

Two things stayed in the private incubator when this moved to the public engine on 2026-09-07:

- **The two prototype screenshots** (`proto-*.png`). They are renders of two real creators' pages.
  A filename can be de-identified; the pixels cannot, and a screenshot of somebody's card in an MIT
  repo reads as sample data. `shots/minmax.png` is synthetic and would have been safe, but it is
  kept with its siblings rather than split across two repos for no gain.
- **The cards themselves.** `flow-proto.mjs` and `flow-experiment.mjs` ran on three live cards;
  they run on the package's synthetic specimens now, which is why the numbers above are **not**
  reproducible from this repo. They are the original measurements, not a claim about what the
  specimens do.

The experience is what moved. The people in it did not.
