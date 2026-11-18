# countdown — time left, from parts that already work

A deadline and the elements that show what is left of it. Everything around the numbers — labels,
language, layout, the card it sits in — is the host's own markup; the coral only writes digits.

## The embed

```html
<div data-dynamic-coral="countdown" data-deadline="2026-12-01T23:59:59+09:00" hidden>
  <span data-part="days" data-flip></span> days
  <span data-part="hours" data-flip></span>:<span data-part="minutes" data-flip></span>:<span data-part="seconds" data-flip></span>
</div>
<script type="module" src="https://feelreef.com/corals/countdown/v0/countdown.js"></script>
```

- `data-deadline` **must name its offset** (`Z` or `±hh:mm`) and a real date. Without an offset the
  same embed would end at a different moment for every visitor's time zone; a date that does not
  exist (`2026-02-31`, `T24:00`) would silently roll over. Both are refused and the root is left as
  authored.
- Each `data-part` (`days` · `hours` · `minutes` · `seconds`) shows at least two digits and as many
  as the value needs. The **largest unit present carries everything above it**: with only
  hours/minutes/seconds, 2 d 5 h 12 m 30 s reads `53:12:30`, never `05:12:30`. Without `data-flip`
  (or with `data-flip="false"`) the element's text is the number. With it the element holds one
  split-flap card per digit, a card is added or dropped on the left when the digit count changes,
  and a visually hidden copy of the value stays readable to a screen reader.
- The root is shown after the first tick, so a root marked `hidden` never flashes `00`. The coral
  injects `[data-dynamic-coral="countdown"][hidden]{display:none!important}`, so a site rule giving
  the root a display cannot defeat that, or keep a frozen value on screen after the deadline.
- Ticks land on whole-second boundaries of the deadline, so no second is skipped or shown twice.
- The final second reads `00:00:00`. At the deadline itself the timer stops: `data-expired="hide"`
  (default) hides the root; `data-expired="text"` replaces its content with `data-expired-text`
  (and hides when that text is empty).
- Reduced motion: cards change without folding. It is read live, so switching it on settles every
  card that is folding (a turning drum jumps to its target) at once.
- `stop()` and expiry settle every card at once, and a card dropped on a digit-count change is
  settled before it is removed: nothing keeps folding after the countdown has stopped. Calling
  `tick()` after `stop()` resumes it, reduced motion still read live.

Nothing stored, and no network call unless the root carries `data-src`.

## The deadline from a calendar — `data-src`

```html
<div data-dynamic-coral="countdown" hidden
     data-src="https://<events feed>/v0/?cal=<public calendar>&show=3"
     data-count-to="end" data-offset="+09:00">
  <strong data-event="title">Applications open</strong>
  <span data-part="days"></span> d <span data-part="hours"></span> h <span data-part="minutes"></span> m
  <a data-event-href="location" href="/apply">Details</a>
</div>
```

- `data-src` names an **events feed** — the events coral's (`../events/events-worker.mjs`), which
  answers `{ html, events }`. The root makes one GET on load and counts to the **first event still
  ahead**. Editing the calendar moves the countdown; the page is not rebuilt.
- `data-count-to` is `start` (default) or `end`. An event with no end is counted to its start. An
  all-day event's end is the midnight after its last day, so `end` on a one-day "closes on the 1st"
  event is the end of the 1st.
- **An event's moment must name its offset, like a typed deadline.** A timed event the feed gives in
  UTC is exact. An all-day event is only a date and a floating time only a wall clock, so each is
  read in the root's `data-offset` (`Z` or `±hh:mm`) — and without one it is passed over, never read
  in the visitor's zone.
- `data-event="title|location|description"` on a child replaces its text with that field;
  `data-event-href="location|url"` on a link sets its href. `location` is the location itself when
  the author wrote an http(s) URL there (a sign-up page, an online event) and otherwise a map search
  for the place — the same link the events coral gives that field. An empty field, or anything that
  is not http(s), leaves the element as authored, so the host's own text and link are the defaults.
- A feed that fails, or holds no event the root can count to, falls back to `data-deadline` when the
  root has a valid one; otherwise the root is left exactly as authored (a `hidden` root stays
  unseen — the honest state for "nothing coming up").
- The event is chosen once, on load. When its countdown ends, `data-expired` applies as usual; the
  next page load picks the next event.

## The card — `shared/flip.mjs`

One card is "1 片": two static halves and, during a change, two flaps. A card shows ANY text — a
digit, a letter, one CJK character, or a whole pre-printed word (「各駅停車」→「東京」, as one flap on a
station board); countdown is just one caller that feeds it digits. The order is the part that is
easy to get wrong, so it lives here once:

| | during the fold | settled |
|---|---|---|
| top half | **new** (uncovered by the falling flap) | new |
| bottom half | **old** (until the rising flap covers it) | new |
| front flap | old, folds down | — |
| back flap | new, folds up after it | — |

Each half carries a full-height glyph pinned to its own edge, so the seam cuts one glyph in two. A
change that arrives mid-fold drops the running flaps first.

**A flap has one size.** The card never resizes per face: it is as wide as the widest of its
**faces** — the full set it can show, declared with `data-flip-faces` (comma-separated, in order).
Every face sits stacked and invisible inside the card, so the browser measures them in the card's own
font and re-lays them out when a web font arrives or the size changes. Countdown's digit cards use
`0,1,2,3,4,5,6,7,8,9` unless the element says otherwise, so every digit card is the width of the
widest digit. Without a declared set a card keeps every face it has shown, so it only grows.
`--dc-flip-width` overrides both.

**Drum mode** — `data-flip-mode="drum"` on a `data-part` element. Each card becomes a counter wheel
that only turns forward: a change folds through every face after the one showing, in wheel order and
wrapping round, one short fold per step (`DRUM_STEP_MS`, 140 ms; the four-face order is the same as
above). A countdown's wheel is 0–9 turning DOWN (9, 8, … 0, 9 …), on every place, as on a mechanical
counter: an ordinary second is one step, and a place that wraps runs through every digit in between —
the tens of the seconds go 0→9→8→7→6→5 at the minute (5 steps), the hours 00→23 at the day (8 and 7).
Cards that have farther to go stop later, so a row finishes raggedly: that 「嘩啦啦」 is the wheel, not an
added stagger. A new value while the wheel is turning is only a new place to stop — it carries on
forward, never back, and never runs twice. The wheel is always 9…0: `data-flip-faces` only sizes the
cards, in drum mode as without it, so writing the default `0,1,2,3,4,5,6,7,8,9` is the same as leaving
it out. A face not on the wheel, the first value, and reduced motion all go straight to the target.
Styling is custom properties only:

| property | default |
|---|---|
| `--dc-flip-width` / `--dc-flip-min-width` / `--dc-flip-height` | `auto` (widest face) / `0` / `1.8em` |
| `--dc-flip-pad` | `.14em` (each side of the content) |
| `--dc-flip-bg-top` / `--dc-flip-bg-bottom` | `#333` / `#262626` |
| `--dc-flip-fg` | `#fff` |
| `--dc-flip-seam` | `rgba(0,0,0,.5)` |
| `--dc-flip-radius` · `--dc-flip-gap` · `--dc-flip-perspective` | `.14em` · `.08em` · `4em` |

Font family, size and weight are inherited from the `data-part` element.

## Shape

`countdown-core.mjs` is the page half and `countdown-client.mjs` mounts it. `countdown-feed.mjs` is
the feed half — which event, and when — with no DOM and no I/O. The countdown arithmetic
is `../shared/countdown-parts.mjs`, which `../events` agrees with to the second
(`shared/countdown-parts.test.mjs`). `countdown.js` is BUILT from these, so do not edit it.

Publishing is the registry chain, not a copy: bump `package.json`, run `node ../build.mjs countdown`
with the deployment's `--registry`, repoint the channel, then deploy the registry.

<!-- coral metadata: start (generated by catalog-readme.mjs) -->
## countdown metadata

Counts down to a deadline in the visitor’s browser — typed on the element, or read from an events feed as the next event — as plain digits or split-flap cards, and hides or swaps itself at the deadline.

Author: `official`.

Requires one of: `data-deadline` or `data-src`.

### Embed

```html
<div data-dynamic-coral="countdown" data-deadline="2026-12-01T23:59:59+09:00" hidden>
  <span data-part="days" data-flip></span> <span data-part="hours" data-flip></span> <span data-part="minutes" data-flip></span> <span data-part="seconds" data-flip></span>
</div>
<script type="module" src="https://feelreef.com/corals/countdown/v0/countdown.js"></script>
```

### Attributes

| Attribute | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `data-dynamic-coral` | enum | yes | — | Selects the countdown coral. Values: `countdown`. |
| `data-deadline` | string | no | — | ISO date-time WITH an explicit offset (Z or ±hh:mm) naming a real date; otherwise the root is left as authored. With data-src it is the fallback, used when the feed gives no event to count to. Pattern: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z\|[+-]\d{2}:\d{2})$`. |
| `data-src` | url | no | — | An events feed URL (the events coral’s feed). The root makes one GET to it on load and counts to the first event still ahead, instead of to a typed data-deadline. Without it the root makes no network call. |
| `data-count-to` | enum | no | `start` | With data-src: which moment of the event is the deadline. An event with no end is counted to its start; an all-day event’s end is the midnight after its last day. Values: `start`, `end`. |
| `data-offset` | string | no | — | With data-src: the UTC offset (Z or ±hh:mm) that all-day and floating events are read in. Without it those events are passed over; an event the feed gives in UTC needs none. Pattern: `^(Z\|[+-]\d{2}:\d{2})$`. |
| `data-event` | enum | no | — | With data-src, on a child element: replace its text with that field of the event being counted to. An empty field leaves the element as authored. Values: `title`, `location`, `description`. |
| `data-event-href` | enum | no | — | With data-src, on a child link: set its href from the event. location is the location itself when it is an http(s) URL and otherwise a map search for it; url is the event’s own URL. Only http(s) is ever written; otherwise the link is left as authored. Values: `location`, `url`. |
| `data-expired` | enum | no | `hide` | What the root does at the deadline: hide it, or replace its content with data-expired-text (text without a data-expired-text hides). Values: `hide`, `text`. |
| `data-expired-text` | string | no | `` | Text shown in place of the countdown when data-expired is text. |
| `data-part` | enum | yes | — | On a child element: which unit it shows, two digits minimum and as many as needed (no upper bound). The largest unit present also carries every unit above it (hours alone show 53 for 2 d 5 h). Values: `days`, `hours`, `minutes`, `seconds`. |
| `data-flip` | boolean | no | `false` | On a data-part element: show one split-flap card per digit instead of plain text. data-flip="false" keeps plain text. |
| `data-flip-faces` | string | no | `0,1,2,3,4,5,6,7,8,9` | On a data-flip element: comma-separated faces its cards can show. Every card is locked to the widest of them. It only sizes the cards: with data-flip-mode="drum" the wheel is still 9, 8, … 0, so the default written out behaves exactly like leaving it out. |
| `data-flip-mode` | enum | no | — | On a data-flip element: drum makes each card a counter wheel that only turns forward (always 9, 8, … 0), folding through every digit in between — the tens of the seconds go 0→9→8→7→6→5 at the minute. Unset keeps the straight-to-target flip. Reduced motion always goes straight. Values: `drum`. |

<!-- coral metadata: end -->
