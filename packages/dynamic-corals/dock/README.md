# dock — the corners, shared

A page's corners hold small round things: the inbox bubble, a countdown, a back-to-top button, a
phone number. Before this coral each of them positioned itself, and a second one in the same
corner had to copy the first one's size, colour, shadow and margin from its source and move itself
up by a hand-measured `3.5rem + 8px`. Nothing checked that the copies agreed.

Now there is one **dock** per corner (`dc-dock[name="right"]`, `dc-dock[name="left"]`; the name
is open-ended) and every corner item puts itself into it. Stacking, one item disappearing and the
next taking its place are ordinary layout. The base lives in `../shared/dock.mjs`; inbox-bubble
carries a verbatim copy of it (`../inbox-bubble/dock-sync.test.mjs` holds the two equal). This
coral is the owner-written item.

## The contract — three sentences

Every coral bundle carries its own copy of the base, so two copies of different ages can meet on
one page. They only have to agree on this:

1. **To join position P**, take `document.querySelector('dc-dock[name="P"]')` — creating it at the
   end of `<body>` if it is missing — or, when the page's renderer has written a
   `dc-dock[name="bar"]` and switched it on (`<html data-dc-dock-bar>`), that bar, which no coral
   ever creates; set `item.dockAnchor` to a node left where the item stood, and insert the item
   before the first child whose `dockAnchor` follows that anchor in document order. A child without
   a `dockAnchor` (a renderer's own entry, such as a nav tab) is never passed: those come first.
2. **When an item opens**, it dispatches `dc-dock:open` on `document` with `detail` = the item;
   every other open item that hears it closes.
3. **An item whose `dockAnchor` has left the document leaves its dock**: the first copy to claim a
   dock on a page sets `document.dcDockWatch` and watches the page (removals only) for every item of
   every dock, whoever drew it. Removing the place an item was written — a section, an SPA route —
   removes the item, as it did when items lived where they were written.

Everything else — the dock's look, its custom properties, the bar's "More" — belongs to whichever
copy created the dock (the first `attachShadow` wins; a later copy sees `shadowRoot` and leaves the
dock alone) and may change between versions without breaking an older copy on the same page.

Earlier in the document means nearer the corner. A site layout that injects the inbox bubble
before the site's own embed slot therefore gets the inbox nearest the corner without doing
anything; an owner who wants another order turns the automatic bubble off and writes the items in
the order they want.

## Prevent ugliness within reason; beyond that, do not clean up after the owner

The dock stops ordinary page CSS from breaking the corner (its shadow stylesheet's `!important`
declarations reach slotted items past a site's `div{…}` or `*{margin:…}`) and keeps every item the
same size, at the same distance from the edge, with a shadow the edge does not cut off. It does
not hide, collapse, reorder or move back items an owner has stacked too high: five bubbles in one
corner reach up the screen, and that is what the page asked for.

## The embed

```html
<!-- a panel item -->
<div data-dynamic-coral="dock" data-dock="left" data-label="Cohort 6 closes soon"
     data-color="#ff5d61" data-open-on-hash="cohort6" data-auto-open="1" hidden>
  <svg slot="icon" viewBox="0 0 24 24" aria-hidden="true">…</svg>
  <div data-dynamic-coral="countdown" data-deadline="2026-12-01T23:59:59+09:00" hidden>…</div>
</div>

<!-- a link item -->
<div data-dynamic-coral="dock" data-href="#top" data-label="Back to top" hidden>
  <svg slot="icon" viewBox="0 0 24 24" aria-hidden="true">…</svg>
</div>

<script type="module" src="https://feelreef.com/corals/dock/v0/dock.js"></script>
```

- **The element is the item.** It gets an open shadow root (the bubble and the panel's frame) and
  moves into the dock, leaving a comment where it was written. Its children stay the owner's:
  `slot="icon"` is the bubble's glyph (inline SVG; there is no icon library), everything else is
  the panel, slotted in on the **first open**. Because the element moves, the panel's content must
  not depend on what used to surround it. A `<div>`, `<aside>` or `<section>` works; an element
  that cannot host a shadow root (`<a>`, `<button>`) is left as authored.
- **Owner-set:** colour (`data-color`), icon, icon colour (`data-icon-color`; by default black or
  white by the colour's relative luminance), corner (`data-dock`), the panel's content, `#name`
  (`data-open-on-hash="name"` — the per-item form of inbox-bubble's `data-open-on-hash`), opening
  once per visit (`data-auto-open="1"`, phones included). **Fixed:** size, edge distance, shadow.
  Anything else, write by hand in the site-wide embed slot.
- **Behaviour:** collapsed by default. A visitor's collapse is remembered for the tab
  (sessionStorage `dc-dock:<name>`), so an item that opens once per visit stays collapsed after it.
  When two items ask to open once per visit, the first in the document opens. Nothing ever moves by
  itself: no badge, no pulse. One panel is open at a time across every dock item on the page. Esc
  closes it and returns focus to the bubble; the bubble carries `aria-expanded`/`aria-controls`, and
  its name comes from `data-label` or the panel's first heading. Hidden in print.
- **The panel sits directly above its own bubble**, inside the dock, so the items above it are
  pushed up and come back down when it closes. Its height never exceeds the visible viewport minus
  the bubbles below it; past that it scrolls inside.
- **When the panel's content hides itself, the item retires.** If every element of the content is
  `hidden` (a countdown at its deadline), the item is hidden too — and shown again if one comes
  back. The dock knows nothing about deadlines.
- **No script, no item.** Keep the `hidden` in the embed: the coral removes it once the item is
  mounted, so a page whose script did not load shows nothing.

## Owner tokens

| custom property | |
|---|---|
| `--dc-dock-reserve` | the site-wide bottom reserve (a cookie bar, a vendor widget): both corners move up by it. A length; anything else counts as 0. Clamped to 0…50% of the viewport height |
| `--dc-dock-panel-bg` / `--dc-dock-panel-fg` | the panel frame's background and text colour (default white / `#111`) |
| `--dc-dock-bar-bg` / `--dc-dock-bar-fg` | the installed-app bar's background and ink |

`--dc-dock-margin`, `--dc-dock-size`, `--dc-dock-gap`, `--dc-dock-radius`, `--dc-dock-shadow`,
`--dc-dock-room` and `--dc-dock-panel-w` are the dock's own, set on the dock for its items to read.

## Shadows

A shadow may not reach further than the edge margin, or the screen edge cuts it. Measured on an
iPhone 14 (390×664 visible): the inbox panel's former `0 12px 40px` was cut by 18 / 24 / 36 px. The
budget is `0 1px 3px` + `0 4px 12px` — 16px down, 12px sideways, inside the `max(1rem, 16px)` margin.

## The bubble, open

While its panel is open, an item's bubble shows **×** in place of its icon, is named "Close <label>"
in the page's language (「Close」alone for an item without a label), says `aria-expanded="true"`, and
closes the panel when pressed. The panel has no × of its own, with one exception: in the bar's More
sheet (below). Esc closes it too and returns the focus to the bubble.

**Auto-open** (`data-auto-open="1"`) opens a panel once per visit — this tab, across pages
(sessionStorage, keyed by the item's `data-open-on-hash` name, or else by its corner and label) —
and never over something already open: a panel the visitor opened, one a `#name` opened, the inbox
opened by `reef-inbox:open`, whichever bundle drew it (read from the `aria-expanded="true"` every
open item shows).

## In an installed app — only on the renderer's bar

A coral never creates the bar and never decides "installed app" by itself: an installed PWA without
a renderer's bar keeps its corners, exactly like a browser (a bar made up by a coral covered the
page's footer and its own bottom bar, with nothing reserving room for it). A site renderer that
wants a bar writes one `dc-dock[name="bar"]`, hidden, with its own nav links, and switches it on
before first paint with `<html data-dc-dock-bar>` — sitetile does on a `packages: pwa` site with a
`nav:`, in an installed app wherever its header would fold into the hamburger (`max-width: 64rem`,
1024px included); a wider installed window keeps the corners.
Then every item joins **one bar along the bottom edge** as a square tab — the dock's shape, the
items unchanged — after the renderer's links, wherever on the page the item was written: the nav
leads, the tools follow. With more than five visible entries the first four
stay and the rest move into a **More** sheet (`data-more-label` on the bar names it); entries the
renderer knows will join later count from the first paint (`data-reserve="<n>"`, sitetile's inbox),
so nothing jumps into More when they arrive. A list that opens inside a More entry (a nav group)
keeps the sheet open; an item's own panel opens as a sheet above the bar and closes More. Its bubble
is in the closed sheet then, so there — and only there — the panel shows its own ×, first in it
and named like the bubble; that × or Esc closes the panel and returns the focus to the More button. The inbox follows the same rule: its panel shows no × of its own unless it was opened from More. An empty bar is hidden. The bar clears only the
home-indicator inset.

## Known limits

The page watcher (contract ③) sees what the document's own mutation records show, and the client
mounts each item once. sitetile uses none of the cases below; a third-party host may.

- **An item written inside a shadow root.** Removing its place there makes no record in the
  document, so the item leaves its dock only at the next removal anywhere in the page. Its order
  against items in the light DOM (`compareDocumentPosition` across trees) is not defined.
- **A place removed and put back in a later task** (a keep-alive cache, an async morph). The item
  retires when its place leaves and is not mounted again when it returns; a move within one task is
  fine.
- **Routers that swap `<body>`** (Turbo, Astro's ClientRouter, swup). The docks are written at the
  end of `<body>` and the swap discards them, with every item, without anything retiring: the place
  the item was written is still connected, in the new body or a persisted container. Before 0.8.0
  the inbox bubble lived inside its container and survived a persisted one; in a dock it does not.

<!-- coral metadata: start (generated by catalog-readme.mjs) -->
## dock metadata

A corner bubble the owner writes in plain markup — one that opens a panel of the owner's own content, or one that is a link — placed in the shared corner dock beside the inbox bubble; in an installed app whose page carries a site renderer's bottom bar, the item joins that bar.

Author: `official`.

### Embed

```html
<div data-dynamic-coral="dock" data-dock="left" data-label="Cohort 6 closes soon" data-color="#ff5d61" data-open-on-hash="cohort6" hidden>
  <svg slot="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l3.6 2.1-1 1.7L11 13V7z"/></svg>
  <div>Your panel: any markup, styled by the site's own CSS.</div>
</div>
<script type="module" src="https://feelreef.com/corals/dock/v0/dock.js"></script>
```

### Attributes

| Attribute | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `data-dynamic-coral` | enum | yes | — | Selects the dock coral. The element itself becomes the item and moves into the corner dock; a comment marks where it was written. Values: `dock`. |
| `data-dock` | string | no | `right` | Which corner: right or left (a lowercase name; unknown names sit where right does). Items in one corner stack in document order, the earliest nearest the corner. Ignored where the page's renderer has switched its installed-app bottom bar on (sitetile: an installed app on a narrow screen): there every item joins that bar. |
| `data-href` | url | no | — | Makes the item a link instead of a panel: http(s), mailto, tel, a #fragment or a same-site path. Any other scheme leaves the bubble without a destination. |
| `data-label` | string | no | — | The bubble's and the panel's accessible name. Without it, the text of the panel's first heading. |
| `data-color` | string | no | `#111` | The bubble's colour, any CSS colour. |
| `data-icon-color` | string | no | — | The icon's colour. Without it, black or white, whichever the bubble colour's luminance calls for. |
| `data-open-on-hash` | string | no | — | A name (letters, digits, _ or -): #name in the URL opens this panel, at load and on a later hashchange. Also the key that remembers this item's once-per-visit auto-open. Pattern: `^[A-Za-z0-9_-]{1,64}$`. |
| `data-auto-open` | boolean | no | `false` | Set to 1 to open the panel once per visit (this tab, across pages), phones included, and never over another panel that is already open. Remembered by data-open-on-hash, or else by corner and label. When two items ask, the first in the document opens. |

<!-- coral metadata: end -->
