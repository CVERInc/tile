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

## The countdown from a calendar — `data-src`

```html
<div data-dynamic-coral="countdown" hidden data-event-fit
     data-src="https://<events feed>/v0/?cal=<public calendar>">
  <a data-event-href="add" aria-label="Add to calendar">
    <span data-event="calendar"></span> <span data-event="when"></span>
  </a>
  <span data-part="days"></span> <span data-unit="days">d</span>
  <span data-part="hours"></span> <span data-unit="hours">h</span>
  <span data-part="minutes"></span> <span data-unit="minutes">m</span>
  <a data-event="title" data-event-href="location"></a>
  <a data-event-if="location" data-event-href="location"><span data-event="location"></span></a>
  <p data-event-if="description" data-event-more><span data-event="description"></span></p>
  <div data-event-if="several">
    <button data-event-nav="prev" aria-label="Previous event">‹</button>
    <span data-event="position"></span>
    <button data-event-nav="next" aria-label="Next event">›</button>
  </div>
</div>
```

**The calendar is the source.** The owner writes an event in their calendar and the page says it:
nothing about the event is written on the page, nothing is translated, and nothing is filtered by
what an event says (an untitled event is shown untitled). What is left out is what cannot be shown
or is not happening: an event the calendar marks cancelled; one the feed could not place in time
(an all-day or zoneless event in a calendar that states no time zone); a second entry with the UID
of an earlier one; and anything past the feed's own cap of 20 upcoming events.

- `data-src` names an **events feed** — the events coral's (`../events/events-worker.mjs`), which
  answers `{ html, calendar, events }`. One GET, on load.
- **One calendar per language.** A calendar is written in one language, and nothing here translates
  it. A site in several puts one countdown in the chrome every page shares and names a feed per
  language: `data-src-zh-tw="…"`, `data-src-en="…"`, with `data-src` for the rest. The page's
  `<html lang>` picks — the whole tag, then language and region (`zh-Hant-TW` finds
  `data-src-zh-tw`), then shorter and shorter down to the language alone — never the visitor's
  browser. A root
  that names feeds only for some languages shows nothing on the others.
- **What's next.** Each event counts to its start while that is ahead and to its end once it is
  under way; the events are shown in the order of those moments, soonest first, and every opening
  starts at the first. `data-event-nav="prev|next"` pages through them, stopping at the ends.
- **At zero nothing reloads.** An event that has started goes on to count to its end; one that has
  ended gives way to the next. The order is worked out again at that moment and only then, and a
  visitor paging through keeps the event they were looking at. When nothing is left, `data-expired`
  applies as for a typed deadline.
- **No time zone on the page.** The feed places every event with the calendar's own zone
  (`X-WR-TIMEZONE`): an all-day event starts at that zone's midnight and ends at the midnight after
  its last day. `data-event="when"` shows an all-day event's dates as the calendar wrote them, and
  a timed event on the visitor's clock with the zone named.
- **No words of ours.** `data-event="when"` and `data-unit` are the browser's own (Intl), in the
  page's language (`<html lang>`). The accessible names of the controls are the host's markup.
- **A location is a link.** When the whole field is an http(s) URL it is that URL (shown without its
  scheme); anything else is a place and links to the platform's map. `data-event-if="url|place"`
  and the root's `data-event-location` let the host draw the two differently. Text from the feed is
  always written as text.
- **`data-event-fit`** keeps one element as tall as the tallest event needs, so paging moves neither
  the controls nor the edges. It is measured while the element has a box, and again when its width
  changes.
- **`data-event-more`** is for text the host's CSS clips — a description held to two lines. Whether
  it is clipped is only known once laid out, so the coral measures — the element itself and the
  text inside it, whichever holds the clamp — and measures again when a panel it sits in reopens: a
  clipped one gets
  `data-event-clipped` and becomes a control (`role="button"`, focusable, `aria-expanded`; click,
  Enter, Space) that toggles `data-event-open`, and the host's CSS shows the whole text for that
  attribute. One that fits is left exactly as authored. Showing another event closes it, and the
  height `data-event-fit` keeps is the height with everything closed — so one long description
  never becomes the height of every event. The element's kind stays the host's (the coral adds a
  role, it does not swap in a `<button>`), so no browser button styling arrives with it.
- **Add to calendar says what the event says.** The link carries the description (as plain text,
  its first 1,500 characters) and the event's URL, so the copy in the visitor's own calendar is where the whole of a long
  description can be read.
- **Recurring events are not expanded**: the feed's parser reads a repeating event's first
  occurrence only. A timed event that states no end is treated as lasting an hour (the events
  coral's long-standing reading), so it shows as under way for that hour; `DURATION` is not read. A calendar that shares only free/busy shows what it shares ("Busy").
- A feed that fails, does not answer within eight seconds, or holds no event still to come falls
  back to `data-deadline` when the root has a valid one; otherwise the root is left exactly as
  authored (a `hidden` root stays unseen — the honest state for "nothing coming up").
- Every root, typed or fed, carries `data-under-a-day` while less than a day is left: the hook for
  trading the days for the seconds in CSS.

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
the feed half — which events, in what order, and the words for them — with no DOM and no I/O. The countdown arithmetic
is `../shared/countdown-parts.mjs`, which `../events` agrees with to the second
(`shared/countdown-parts.test.mjs`). `countdown.js` is BUILT from these, so do not edit it.

Publishing is the registry chain, not a copy: bump `package.json`, run `node ../build.mjs countdown`
with the deployment's `--registry`, repoint the channel, then deploy the registry.

<!-- coral metadata: start (generated by catalog-readme.mjs) -->
## countdown metadata

Counts down to a deadline in the visitor’s browser — typed on the element, or read from a calendar’s events feed, paging through what’s next — as plain digits or split-flap cards, and hides or swaps itself when nothing is left.

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
| `data-deadline` | string | no | — | ISO date-time WITH an explicit offset (Z or ±hh:mm) naming a real date; otherwise the root is left as authored. With data-src it is the fallback, used when the feed gives no event to show. Pattern: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z\|[+-]\d{2}:\d{2})$`. |
| `data-src` | url | no | — | An events feed URL (the events coral’s feed for one public calendar). The root makes one GET to it on load and shows the events still to come in what’s-next order: each counts to its start while that is ahead and to its end once it is under way, and at zero carries on to the next without a reload. The calendar’s own time zone places its all-day events; nothing about time is written on the page. Without data-src the root makes no network call. One calendar is in one language: a root may also carry a feed per language as data-src-<language> (data-src-zh-tw, data-src-en), used instead of data-src on a page whose <html lang> is that language — the whole tag first, then language and region (zh-Hant-TW finds data-src-zh-tw), then shorter down to the language alone. A root that names feeds only for some languages is not fed on the rest. |
| `data-event` | enum | no | — | With data-src, on a child element: its text becomes that part of the event being shown (emptied when the event has none). when is the date or range in the page’s language — an all-day event’s dates as the calendar wrote them, a timed event in the visitor’s zone with the zone named. location is the place, or a URL without its scheme. calendar is the calendar’s name. position is like 2/4, empty for a single event. Values: `title`, `location`, `description`, `when`, `calendar`, `position`. |
| `data-event-href` | enum | no | — | With data-src, on a child link: its href (removed when there is none). location is the location itself when the whole field is an http(s) URL and otherwise the platform’s map for the place; url is the event’s own URL; add is an add-to-calendar link for the event: a Google Calendar link, or, in Safari on an Apple device when the feed says it serves one (`ics: true`), the event as an .ics file from the feed’s own address, which the device’s calendar opens. Only http(s), a map, or that add link is ever written. Values: `location`, `url`, `add`. |
| `data-event-if` | enum | no | — | With data-src, on a child element: shown only while that holds for the event being shown, hidden otherwise. url and place are the two kinds of location; several is true when there is more than one event to page through. Values: `title`, `location`, `description`, `url`, `place`, `several`. |
| `data-event-nav` | enum | no | — | With data-src, on a child button: pages to the previous or next event. Disabled at the first and the last; it does not wrap. Values: `prev`, `next`. |
| `data-event-fit` | boolean | no | `false` | With data-src, on the root or one child: that element is kept at least as tall as the tallest event needs, measured again when its width changes, so paging moves nothing around it. |
| `data-event-more` | boolean | no | `false` | With data-src, on a child element whose text the host’s CSS clips (a two-line description): when the text really is clipped the element gets data-event-clipped and becomes a control (role, tabindex, aria-expanded; click, Enter, Space) that toggles data-event-open, for which the host’s CSS shows the whole text. Text that fits is left exactly as authored. Showing another event closes it. |
| `data-event-clipped` | boolean | no | `false` | Written by the coral, not by the host: present on a data-event-more element while its text is clipped. The hook for showing that there is more (an arrow, a cursor). |
| `data-event-open` | boolean | no | `false` | Written by the coral, not by the host: present on a data-event-more element while the visitor has opened it. The host’s CSS shows the whole text for it. |
| `data-unit` | enum | no | — | With data-src, on a child element: its text becomes the page-language word for that unit, from the browser (日, hr, Tg.). Left as authored where the browser has none. Values: `days`, `hours`, `minutes`, `seconds`. |
| `data-expired` | enum | no | `hide` | What the root does when nothing is left to count to (the deadline, or the last event of a feed): hide it, or replace its content with data-expired-text (text without a data-expired-text hides). Values: `hide`, `text`. |
| `data-expired-text` | string | no | `` | Text shown in place of the countdown when data-expired is text. |
| `data-part` | enum | yes | — | On a child element: which unit it shows, two digits minimum and as many as needed (no upper bound). The largest unit present also carries every unit above it (hours alone show 53 for 2 d 5 h). Values: `days`, `hours`, `minutes`, `seconds`. |
| `data-flip` | boolean | no | `false` | On a data-part element: show one split-flap card per digit instead of plain text. data-flip="false" keeps plain text. |
| `data-flip-faces` | string | no | `0,1,2,3,4,5,6,7,8,9` | On a data-flip element: comma-separated faces its cards can show. Every card is locked to the widest of them. It only sizes the cards: with data-flip-mode="drum" the wheel is still 9, 8, … 0, so the default written out behaves exactly like leaving it out. |
| `data-flip-mode` | enum | no | — | On a data-flip element: drum makes each card a counter wheel that only turns forward (always 9, 8, … 0), folding through every digit in between — the tens of the seconds go 0→9→8→7→6→5 at the minute. Unset keeps the straight-to-target flip. Reduced motion always goes straight. Values: `drum`. |

<!-- coral metadata: end -->
