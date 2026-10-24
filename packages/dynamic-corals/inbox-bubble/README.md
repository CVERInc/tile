# inbox-bubble — REEF with Inbox, the visitor's side

The bubble everybody recognises in the bottom-right corner, and deliberately not
a chat client: no presence, no typing indicator, no queue, no "an agent will be
with you shortly". Those exist because the products that have them were built for
a support department, and nearly every REEF customer is one person.

```html
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="<site key>"></div>
<script type="module" src="https://feelreef.com/corals/inbox-bubble/v0/inbox-bubble.js"></script>
```

| attribute | |
|---|---|
| `data-kind` | required — `site` \| `card` \| `cardtile` \| `ext` |
| `data-id` | required — the tenant key for that kind |
| `data-kaito` | `"1"` asks the site first (needs REEF with KAITO on that tenant) |
| `data-assistant-name` | what VISITORS see the assistant called instead of "KAITO" (owner-chosen; the panel still marks the reply with the non-removable **AI** chip — the name can change, the AI identity cannot). The BAKED opening answer only: from 0.7.2 the bubble also reads the platform's current value once per mount (`GET /api/inbox/assistant`) and patches the two nodes that carry the name, so an owner's rename reaches visitors without a republish. That read only beats the baked value when the proxy says it actually asked the platform (`resolved: true` in the body) — which is also how CLEARING the name works: a resolved empty answer means「no override」and falls back to KAITO, while an empty answer without `resolved` means「we could not ask」and this attribute stands. Whichever value wins is trimmed to one line and capped at **40 grapheme clusters and 200 UTF-16 units** — a cluster has no length of its own, so both halves are needed for「40 characters」to also mean「not a wall of text」— and bidi/format controls (U+202A–202E, U+2066–2069, U+061C, U+200E/F) are removed, since a name is not allowed to change the direction the rest of the status line reads in |
| `data-open-on-hash` | `"1"` lets `#inbox` in the URL open the panel at load. Off by default — see "Opening the panel programmatically" |
| `data-ai-log` | `"0"` opts this mount out of the deferred question log entirely, and the guidance funnel with it — see "What the visitor asked the machine" and "The guidance funnel". Anything else, including the attribute being absent, leaves it on |
| `data-api-base` | override the feelreef origin (previews) |
| `data-status` | the one visible sentence under the site name on a mount **without** KAITO (tile#20) — replaces the locale default「真人會看」/ 'A person reads what you send'. Plain text: HTML-escaped, first line only, trimmed, capped at **80 grapheme clusters** (and 400 UTF-16 units), bidi/format controls removed. **Ignored when `data-kaito="1"`**: that line carries the AI disclosure, and no attribute may replace it |
| `data-search-index` | the site's search index to filter in the browser as the visitor types (0.7.14, reef#2160) — the sitetile layout sets `/search-index.json` on a blog site with bubble search on. Fetched **once, on the first open**, never at page load; `[]` or unreachable draws today's bubble. See「Searching the site from the bubble」|
| `data-open-label` / `data-title` / `data-placeholder` / `data-send-label` | copy overrides. 🔴 `data-title` is the dialog's `aria-label` **only** (ruling 2026-09-07) — it is never shown; the visible heading is the site name. For a visible sentence, use `data-status` |

Words default from the PAGE's `<html lang>` — the site's own statement about who
it is for, not a guess and not the visitor's browser preference. The panel speaks
the platform's nine locales — English, Traditional and Simplified Chinese, Japanese,
Korean, German, French, Spanish and Brazilian Portuguese (any `pt-*` page gets the
Brazilian table); any other language falls back to English. Before tile #14 only
the first four existed, so a `de-DE` page that set its own `data-title` got a German
heading above an English Send button.

From 0.7.3 the ask panel says two things, not four (owner ruling 2026-09-07,
「太囉唆」): the status line under the site name —「\<名字\>**AI**先回，轉出去真人會看」—
and the box's own placeholder. The body line in the empty log and the
「站主看得到」 footer under the form are gone in every locale, and
`data-empty-label` went with the string it overrode.

A mount without KAITO shows a status line too (tile#20): with no machine answering first there is
no name and no chip, only the fact that is true —「真人會看」/ 'A person reads what you send', in
each of the nine locales, or the site's own `data-status`. Before tile#20 such a panel showed the
site name, ×, the form and Send, and said nothing about who reads the message.

## Only where a message can arrive

A bubble that takes messages is drawn only for a tenant that has an Inbox. Before anything else — no style, no node, no
listener, nothing in storage — a mount asks `GET /api/inbox/session?kind=…&id=…`, the same question
the server answers when a message arrives (a tenant without an Inbox refuses every message, on
purpose: nothing switches itself on because a stranger used it). A layout that puts this coral on
every page of every site is therefore safe: where the owner never opened the Inbox, the page has no
bubble — or, with `data-kaito="1"`, only the half that needs nobody to receive anything (see
"KAITO without an Inbox" below).

The table is for a mount **without** `data-kaito="1"`:

| the answer | what the page gets |
|---|---|
| `claimed: true` | the bubble, exactly as it was drawn before this check existed |
| `claimed: false` | nothing — not a hidden bubble, no bubble — and no further request |
| could not ask: a network failure, no reply within **15 s**, a 5xx, or a body of the wrong shape | nothing yet; asked again after **2 s, 8 s and 30 s** — at most four requests per mount — and drawn the moment one answers yes |
| asked and refused: `throttled`, or a 4xx | nothing, and not asked again on this page — the rate limit counts per address across every site, so asking again would only spend it on the next site too, and a 4xx says the same thing every time |

There is no fourth row on purpose: no greyed-out bubble, no panel that apologises when opened. Any
such state is one a visitor can press and be let down by.

**Only a yes is remembered**, in this browser, for six hours (`reef-inbox:claim:<kind>:<id>`), so on
a site with an Inbox every page after the first draws without waiting for anything. A no is never
remembered: the person most likely to have just looked at a site without an Inbox is its owner,
and after opening one they should see the bubble on the very next page they load. So:

- **Inbox opened** → a visitor sees the bubble on their next page load (the endpoint is not cached).
- **Inbox gone** (a site that leaves the platform) → a browser that heard yes keeps drawing it for
  at most six hours from that answer; the first ask after that takes it away.

**An older yes stands in when nobody can answer.** Past six hours a yes is asked again, not thrown
away: if that ask cannot be answered — refused, throttled, timed out, unreachable — and this browser
heard yes within the last **30 days**, the bubble is drawn anyway and nothing more is asked on that
page. Before this check existed the bubble was drawn without asking anything, so a site with an
Inbox must not gain a new way to lose it. Only a missing answer is covered this way: a definite no
still draws nothing and deletes the remembered yes.

The cost: one request per page view on a site without an Inbox, one request per six hours per
browser on a site with one — up to four per mount only while the endpoint cannot be reached.

### KAITO without an Inbox (0.7.11)

The ask-the-site half can be had on its own, and it needs no Inbox: the question goes to
`/api/kaito` and the answer comes back from the site's own published content. From 0.7.10's
gate until 0.7.11 such a mount drew **nothing** — the gate returned on every no, so a tenant with KAITO
and no Inbox got an empty container and no error (CVERInc/reef#1866). The gate now decides
**which** bubble to draw, not only whether:

| `data-kaito` | the answer | the bubble | a way to a person | the question log | status line |
|---|---|---|---|---|---|
| `1` | `claimed: true` | drawn — exactly as before | yes | yes | 「\<名字\>**AI**先回，轉出去真人會看」 |
| `1` | `claimed: false` | **drawn, ask-only** | **none** | **none** | 「\<名字\>**AI**用這個站的內容回答」 |
| `1` | could not ask, or asked and refused | **drawn, ask-only** | **none** | **none** | 「\<名字\>**AI**用這個站的內容回答」 |
| — | `claimed: true` | drawn — exactly as before | yes | — | 「真人會看」 or `data-status` |
| — | `claimed: false` | nothing | | | |
| — | could not ask, or asked and refused | nothing — the table above | | | |

**Ask-only is the ask view and nothing that needs an Inbox** (owner ruling 54: a KAITO-only tenant
writes nothing, ever):

- No「Ask a person instead」under an answer and no「Send this to a person」under a refusal — both
  post to `/api/inbox`, which refuses every message for a tenant without an Inbox. The answer, or
  the refusal, is the whole exchange.
- No compose form, no hand-off form, no second action in the header.
- **No conversation handle is read or written.** One left in this browser from another day stays
  where it is, unfetched and unshown; if a later page hears yes, the thread is where it was.
- **No question log**: no `reef-inbox:ai:…` buffer, no second ask of `/api/inbox/session`, no
  `pagehide` listener, no beacon — the switch `data-ai-log="0"` throws, thrown for the mount.
- The one `window` listener is `reef-inbox:open`, and it opens the ask view.
- **Accessible names.** The locale defaults (`Message us` / `Leave a message`) name a place to
  leave a message, and here there is none, so they are replaced by the ask box's own words without
  the placeholder's ellipsis (`Ask about this site`). A `data-title` the host set still names the
  dialog — it is what the host calls the panel (a site layout passes the site's name), and the
  accessible name agrees with it. `data-open-label` is ignored on an ask-only mount: it is the
  override for「Message us」specifically.

So a whole visit — mount, open, ask, read the answer, leave — sends exactly three requests and no
beacon: `GET /api/inbox/session` (the gate's one question), `GET /api/inbox/assistant` (the name
the owner gave the assistant) and `POST /api/kaito` (the question, which is the product).

**Could not ask ⇒ ask-only, at the first non-answer.** The two ways to be wrong are not the same
size: ask-only on a site that does have an Inbox costs that page view its route to a person; the
full bubble on a site that has none is the button that fails every time it is pressed. A KAITO
mount therefore does not retry on the 2 s / 8 s / 30 s schedule — something is on screen already,
and a later answer would have nothing honest to do about it. A yes heard within 30 days still
stands in for a missing answer exactly as above, and that mount is the full bubble.

**It is never stuck.** A no is not remembered and neither is ask-only, so the next page asks again:
the first page load after the owner opens the Inbox draws the full bubble.

**If you embed this without a compatible backend.** A host that sets `data-kaito="1"` and has
nothing answering at `data-api-base` drew nothing in 0.7.10 (the gate could not be asked). From
0.7.11 it draws the ask-only bubble, and every question gets the existing error line (`That didn't
go through. Please try again.`) — the gate cannot tell「no backend」from「could not ask this time」.
If you do not want that, do not set `data-kaito`.

## Searching the site from the bubble (0.7.14, reef#2160)

One input, three rungs (chodaict 2026-10-18): **typing** floats the site's own matching posts
(title + date, as links) above the composer, filtered inside the visitor's browser; **Enter** is
always「ask」— the button says「問 AI」/ Ask AI on the ask view and「傳給站主」/ Send to the owner
on the compose view, so the input says what Enter does (an explicit `data-send-label` still
wins over both); a person is the last rung as before. After Enter the list stays down until the
visitor edits the text again — an index that arrives mid-ask does not bring it back, and a
successful send that empties the box takes down whatever an edit made during the ask had opened.

- The host names the index with `data-search-index`; without it the bubble is byte for byte the
  one it was (the mount tests pin that). sitetile sets it on a blog site unless the owner writes
  `inbox-bubble-search: off` (one line, site-level), and emits rows into `/search-index.json` on
  the same switch — independent of `blog-search`, which still governs the header magnifier alone.
- The index is fetched **once per mount and only on the first open** — a visitor who never opens
  the bubble costs nothing. The filter is the SAME code the header magnifier and `/search` run
  (`packages/sitetile/astro/src/packages/blog-search/search-filter.mjs`, pasted verbatim —
  `search-filter-sync.test.mjs` fails on drift): substring over NFC-folded, lowercased,
  diacritic-stripped text, title hits first, CJK-safe, at most 8 rows.
- No results draws nothing — no「not found」line. A newline, or more than 40 characters, collapses
  the list (that is a message being written; 40 is above the longest title on the largest index
  measured, tniop's 1,410 rows, max 31). Submitting collapses it too.
- The results are a list with an accent rule, not message bubbles, so an old post is never read as
  the assistant's answer. The privacy sentence (`searchNote`, nine locales) shows once the index is
  known to have rows:「打字時只在你的瀏覽器裡找，按下『問』才會送出。」
- 🔴 What the visitor types never leaves the page through this feature and is never recorded —
  ticket item 6 forbids query analytics of any kind. A result link is an ordinary link.

## Opening the panel programmatically

From 0.7.4, two ways in besides a visitor's own click — both inert unless this coral is actually
mounted on the page, because neither is wired until a `mount()` for a valid `data-kind`/`data-id`
has already run:

- `window.dispatchEvent(new CustomEvent('reef-inbox:open'))` — a site's own link (a footer "report
  a problem" anchor, say) can open the panel in place instead of sending the visitor to another
  page. When the panel is **already** open this refocuses the compose box rather than doing
  nothing, so that footer link is never a dead click for a visitor who left the panel open and
  scrolled away.
- `#inbox` in the page's URL fragment at load — honoured once, at mount, and **only with
  `data-open-on-hash="1"` on the mount**. 🔴 Off by default on purpose: a fragment is written by
  whoever authored the LINK, not by the site, so without the opt-in any external page, email or
  QR code could make your site open a message panel and take the cursor on any page, for every
  visitor, with nothing you could do about it. The attribute puts that decision back in your own
  markup — and stops a page whose own `<h2 id="inbox">` or hash route happens to be spelled the
  same way from tripping it by coincidence.

Either reaches exactly what a click on the closed bubble reaches, so it focuses the ask/compose
input the same way every other way into the panel already does — there is no separate focus path
to keep in sync.

Both are wired **before** the panel's first transcript fetch, so a site that dispatches
`reef-inbox:open` from its own `DOMContentLoaded` handler is not racing a network round trip for
a listener to exist. On a page where the coral is still asking whether the tenant has an Inbox (see
"Only where a message can arrive"), the event is **held**: it is honoured the moment the answer is
yes, and dropped if it is anything else — so it is not lost to that round trip either, and on a site
without an Inbox it still opens nothing. `#inbox` is checked once, when the bubble is drawn, so on
such a page it moves focus one round trip later than the page load.

## Behind the site layout's loader (0.7.12)

sitetile does not put this file in a `<script src>` on every page any more (CVERInc/reef#1921): an
inline loader asks the mount's Inbox question first and imports this coral only where it will draw.
What the loader learned before this file was on the page reaches it **in memory**, on
`window.__reefInboxLoader = { v: 1, claims: { '<kind>:<id>': true | false | null }, open, taken }`,
and `mountAll()` takes it once, in the same turn that installs the mounts' own listeners:

- **`claims`** — the gate's whole outcome for a tenant the loader asked about on this page load
  (same 2/8/30 s schedule, `null` is「nobody could say」). The mount takes it instead of asking: no
  second `GET /api/inbox/session`, and no second answer that could take away a bubble the first yes
  earned — which is what happened when the yes travelled through `localStorage` alone and the browser
  refused the write or the read.
- **`open`** — a `reef-inbox:open` dispatched before this file was listening. The mount honours it
  exactly like one it held itself. The loader does **not** rebroadcast it: an open that arrives once
  this file is listening reaches this file's listener alone, once.
- **`taken`** — set by this file; it is how the loader knows not to replay anything.

A shape this file does not know (another `v`, a claim that is not `true`/`false`/`null`) is ignored and
the mount asks, as it would with no loader — a page script can write `window` just as it can write the
remembered yes, and earns the same trust. A well-shaped one is honoured, so a page script can draw the
bubble without the question being asked — the same UI bypass a forged remembered yes already gives.
It carries no conversation handle and no token; every send still needs the backend's own yes. A host
that mounts this file with `<script src>` or calls `mount(el)` itself never sees any of it.

**🔴 0.7.12 is the floor behind the loader — not a nicety.** Up to 0.7.11 nothing takes the handoff,
so the loader can only pass the yes through `localStorage`. It narrows that gap: a throwaway write and
read (`carries()`) sends **uniformly** broken storage (none, a throwing getter, every write or every
read refused) down the old eager path, and only an open that arrived before the coral evaluated is
replayed. It does **not** guarantee the later claim write: a quota with room for the probe and not for
the claim, a script that clears storage before the coral reads it, a second bubble for a different
tenant that answered no, or an open dispatched from inside the coral's own mount all leave an older
coral worse off than with `<script src>` — the first of those loses a bubble the first yes earned. So
`v0` must serve ≥ 0.7.12 before any page carries the loader, and must not drop below it while one does
(see Publishing). `LOADER_HANDOFF_SINCE` in this file and `CORAL_FLOOR` in sitetile's loader are the
same string, and the loader test fails if they are not.

## Handing a conversation over from elsewhere: navigate, do not dispatch

<!-- handoff-section:start — compose.test.mjs reads between these two markers; keep them around this section's warnings -->

0.7.4 added a `reef-inbox:handle` event for this and **0.7.5 removed it again** (tile #15, won't
do). If a page holds a conversation id the server minted — reef's own `/report` form writes the
handle this file's `saveHandle` writes — hand it over the way the platform already does: **write
the handle to `localStorage` under `reef-inbox:<kind>:<id>` and navigate**. The coral reads its
handle at mount, so the visitor lands on a page whose panel is already the right conversation.

Why the event went, rather than being tightened further: it was addressed to the mount element to
stop two corals on a page both adopting a handle meant for one of them, and any script on the page
can look that element up with one `querySelector`. So the address stopped misdelivery and left a
page script able to choose which conversation a visitor's next message is filed under, in place,
with nothing on screen to see.

🔴 **Be exact about what removing it bought, because the recipe above is the same capability.** Any
same-origin script that can write that key and navigate can choose which conversation a visitor's
next message is filed under — and **a site that loads third-party script it does not trust (ads,
analytics, a plugin) has given that script this capability, the same way it has already given it
`localStorage` and the DOM.** What is gone is the *in-place, invisible* version of it: the thread
can no longer be switched under a visitor mid-sentence in an open panel, without a navigation. The
capability itself belongs to storage access, and no code in this coral can take it back. What this
coral does promise is narrower and checkable: it offers **no API** for it — no event, no export, no
attribute takes a conversation id from the page, and the one intake is this browser's own storage,
read once, at mount.

Note what the 30-day expiry is counted from: the `ts` **inside the stored value** — the timestamp
whoever wrote that key chose. The coral stamps `Date.now()` on the handles it writes itself (a
visitor's own action in the panel) and cannot vouch for one it reads; a `ts` in the future does not
expire at all.

There is no in-place switch for an already-mounted panel, on purpose. If you need one, reload.

<!-- handoff-section:end -->

## What the visitor asked the machine (0.7.6)

Every question a visitor asks reaches a person; the machine only answers first so nobody has to
wait. From 0.7.6 the questions asked through the ask-the-site half are shown to the site's owner
in their Inbox — as an aggregate, under 「AI 已答」, which never notifies anybody.

**It is a deferred write, and the shape is the point.**

- The questions stay in **this browser**, in the same `localStorage` the conversation handle lives
  in, keyed `reef-inbox:ai:<kind>:<id>`.
- They leave **at most once per `pagehide`, and only when there is something new** — as a
  `navigator.sendBeacon`, or the moment the visitor presses for a person, whichever comes first.
  Never one request per question, and a second `pagehide` with nothing new sends nothing. It is
  **not** once per session: a visitor who asks something on a second page sends the same
  `session_id` again, carrying the whole session, which is why the endpoint is idempotent on that
  id rather than inserting a row per request.
- **A send that is refused changes nothing.** A beacon the browser will not take, a fetch that
  never arrives, anything but a 2xx: the questions stay in this browser and the next `pagehide`
  carries them. Only an accepted send moves the mark, and only the escalation press — which
  happens with the page still alive — waits to hear what the server said.
- A session spans **pages**, not documents: on a static site every navigation is a new `mount()`,
  so a per-document buffer would make the page sequence — the whole reason the row exists — always
  one entry long. Thirty idle minutes ends a session instead.
- **Only when the site has an Inbox.** The log asks `GET /api/inbox/session?kind=…&id=…` for itself
  the first time a visitor actually types a question. That is a separate ask from the one the mount
  makes before drawing (see "Only where a message can arrive"): each keeps its own answer, so the
  rules below are exactly what they were before the mount started asking. A definite
  answer is cached for six hours; a probe that could not answer — no network, or the endpoint's own
  `throttled` — is **not** an answer, so it is never written down as「no」, and it is retried at most
  once every five minutes rather than once per question. The six hours are counted from the answer
  itself: a probe that could not answer **does not extend them**, so a cached「no」expires on
  schedule however many failed probes there have been since. Not knowing behaves exactly like「no」for
  sending: nothing leaves until somebody actually says yes. A KAITO-only tenant writes nothing,
  ever, and while that answer stands an unclaimed site holds nothing either — the buffer is dropped
  every time, not only when the answer first arrives. From 0.7.11 the ask-only bubble (see "KAITO
  without an Inbox") does not create this log at all, so on such a mount none of the above runs.
- **The machine's answers are never sent**, and cannot be: what travels is the visitor's own
  question, the path it was asked on, the cited passage's URL (or `null`), the page's locale, and
  the time. The row is assembled from that list of five fields rather than from whatever the buffer
  holds, and the citation must parse as an `http(s)` URL — so an answer handed in by mistake lands
  as `null` instead of on the wire. Query strings never travel: a page is `/pricing`, not
  `/pricing?token=…`.
- **Caps are applied on the way in**, so a hostile client cannot bloat a row: 20 questions per
  session, 500 characters each, 40 pages of at most 200 characters, oldest dropped first — and the
  page sequence is bounded in UTF-8 octets as well, because the transport's ~64 KiB budget counts
  octets while every cap above counts characters, and one CJK character is three of them. The
  conversation handle is bounded too, at 64 characters — the length the contract gives
  `session_id`, its twin — and a handle that is not a non-empty string is dropped rather than sent.
- **If storage stops accepting writes** (a full quota, not a disabled store), the session continues
  in memory for the rest of the document, under the same caps. What it loses is the ability to
  outlive that document or be seen by another tab — never the questions already asked, which is
  what a stale read would have cost.

The escalation press stays the only thing that notifies the owner. This log does not.

## The guidance funnel (0.7.15, reef#422)

What the owner sees per page is「被引導 → 到達 → 解決」: how many visitors KAITO pointed at a page,
how many then reached it, and how many of those did not ask again or go to a person. The bubble
sends the events; the receiver is `POST <data-api-base>/api/inbox/funnel` (reef PR #2310), one
event per request:

| stage | sent when | `page` | `cited_page` | `section` |
|---|---|---|---|---|
| `guided` | KAITO's answer is drawn **with a citation** — a refusal or an uncited answer guides nowhere and sends nothing | where the bubble is | the cited page's path | the citation's fragment, or `none` |
| `arrived` | a page mounts that KAITO cited earlier in this journey, or comes back from the back/forward cache (a `pageshow` with `persisted: true` — no mount runs then) — or the visitor clicks a citation into the page they are already on, since no new mount will see that one. Once per guidance: a reload is not a second arrival | the cited page | — | the cited fragment |
| `followed_up` | the visitor presses Ask again inside a guided journey (the press, not the answer) | where the bubble is | — | `none` |
| `handed_off` | a message reaches a person inside a guided journey (any of the three sends to `/api/inbox` answered `ok`) | where the bubble is | — | `none` |

- **Nothing until KAITO guides.** A journey is minted by the first `guided` and by nothing else, so a
  visit that never asks, or whose questions were all refused, costs no request and no storage
  write. The other three stages exist only inside a guided journey.
- **No words, by shape.** A body is `kind`, `id`, `journey`, `stage`, `page`, `cited_page` (on
  `guided` only), `section` and `locale` — nothing else: no question, no answer, no time (the
  server stamps it), no session id, no conversation handle. Paths only, never a query string. A
  locale the receiver would refuse travels as `''`.
- **`journey` is not the question log's `session_id`.** It is `f_` + 16 random hex, minted for
  itself and kept under its own key (`reef-inbox:funnel:<kind>:<id>`), a namespace the server
  refuses as a session id — the two rows cannot be joined. Thirty idle minutes end a journey, the
  same boundary the log draws; it remembers at most 20 cited pages while waiting for an arrival.
- **The same switch as the question log.** Off on the ask-only bubble, off with `data-ai-log="0"`,
  off while the log holds a definite「no Inbox」. The full bubble is only drawn after the mount's
  gate heard yes, which is the claim the funnel stands on; the receiver drops every event for a
  tenant without an Inbox anyway, with the same 204 and zero writes.
- **Best effort.** Each event is one `fetch` with `keepalive: true`, a JSON body and no
  credentials — not `sendBeacon`, whose `text/plain` body reef's cross-site form check lets through
  for `/api/inbox/session` alone. None of the four happens at `pagehide`, so the preflighted
  request has a live document to run in. Nothing is awaited, retried or shown: a failure costs the
  visitor nothing and the owner one event.

## The three things not to break

**It never claims anyone is there.** The panel shows a reply window only when the
owner actually set a number. No presence, ever — that is no-phantom applied to a
person, and a person is far easier to feel lied to about than a widget.

**The conversation id comes from the SERVER.** This browser stores what the server
minted and sends it back; it never invents one. A browser that can choose an id
can choose whose conversation to open — which is why there is exactly one intake
for a handle (this browser's own storage, read at mount) and why the hand-off
event that gave page scripts a second one was removed in 0.7.5. The handle
expires locally after 30 days (`HANDLE_TTL_MS`, bumped from seven on 2026-09-04;
this line still said seven); the owner's copy never expires.

**A KAITO answer is never stored and never joins the transcript.** It is a machine
quoting one of the owner's own pages; a message is a person speaking. Only the
visitor's own question travels when they press the button — and the press is the
point: a refusal is common, and turning every one into an interruption is the
bubble this product exists not to be.

## Taking it off the page (0.7.9)

A plain page never needs this. A host that removes the container itself — an SPA changing route —
calls `unmount(el)` (exported beside `mount`) before or after it does: both `window` listeners the
mount added (`reef-inbox:open`, `pagehide`) are removed, the transcript poller stops, the panel is
removed and `data-dynamic-coral-mounted` is cleared so the element can be mounted again. It leaves
`localStorage` alone — the visitor's handle and unsent questions outlive the panel exactly as they
outlive a navigation. Without it, a page keeps one pair of listeners per element it ever mounted.

## Styling

Every colour is a `--reef-inbox-*` custom property with a neutral fallback, so a
site's theme wins without this file knowing anything about it. Dark mode follows
`prefers-color-scheme`; the entrance animation respects reduced motion.

**Since 0.7.13 the panel lives in a shadow root** (`mode:'open'`, on a `div.dc-inbox-host`
the coral appends to the container), with its stylesheet inside it — nothing goes into
`document.head`. A page's selectors, and a browser extension's cosmetic CSS, no longer reach
the bubble: reef#2139 measured one `button{min-width:88px}` turning it into an 88×56 capsule.
What crosses the boundary is what inherits, on purpose: the `--reef-inbox-*` custom properties
and the site's `font`. So the colour knobs above, and the two position knobs below, are the
whole styling surface — a site rule aimed at `.dc-inbox-*` no longer applies. A script that
needs a node reaches it deliberately through `host.shadowRoot`; `shape.smoke.mjs` measures the
shape, the colours and the font in chromium.

### Where it sits (0.7.16, reef#2418)

A field report: on a phone the bubble covered a page title in the bottom-right corner. The
bubble is still 1rem from the corner; added to that are the phone's safe area
(`env(safe-area-inset-right/bottom)`: the home indicator, the notch side in landscape) and two
owner knobs, which a theme or `custom_css` can set like the colours:

```css
:root { --reef-inbox-offset-y: 80px; --reef-inbox-offset-x: 0px; }  /* 80px higher */
```

- Each is clamped to 0…50% of the viewport (`50vh` up, `50vw` in from the right). A negative value
  counts as 0, so the knob cannot push the bubble into the safe area. A huge value cannot push it
  off the screen.
- They are registered as `<length>` (`CSS.registerProperty`), so anything that is not a length
  (`up`, `12`, a percentage) counts as `0px`. Unregistered, a typo would invalidate the
  root's `bottom` and the fixed box would drop to its static position somewhere in the page.
  The registration is document-wide and covers only these two names.
- On a page without `<meta name="viewport" content="…, viewport-fit=cover">` the browser reports
  every `env(safe-area-inset-*)` as 0, because the viewport itself is already inset. There the
  bubble sits exactly where it did before 0.7.16, which is harmless.
- The open panel grows up and left from the same corner and sizes itself to the room left there
  (minus 1rem and the opposite inset), so it stays fully on screen at any offset. On a phone held
  sideways with a large offset it gets shorter and scrolls. With no offset and no inset its
  bounds are the old `calc(100vw - 2rem)` × `min(30rem, 70vh)`.

`position.smoke.mjs` measures all of this in chromium with a real inset
(`Emulation.setSafeAreaInsetsOverride`), every move against a control arm. A bubble over a
cookie banner (reef#2265) is a different case and not handled here.

## Full inbox (0.7.14, reef#2357)

A send refused with HTTP 507 and `reason: "inbox_storage_full"` shows “This site's inbox is
full and can't take new messages right now.” in the page's locale. The five locales shared
with the site form use its exact sentence; the other four bubble locales carry the same
meaning. The draft and ordinary Send button remain, without a retry instruction. Direct
compose, the handoff form and the send-to-a-person action use the same mapping; all other
statuses and reasons keep their existing messages.

## Publishing

Registry pipeline, same as every coral — bump `package.json`, `node
packages/dynamic-corals/build.mjs inbox-bubble`, repoint `registry/manifest.json`,
`registry/deploy.sh`. 🔴 Never `cp` a fix somewhere; the URL above is the only copy
anyone consumes.

`package.json` owns the version the build uses. The source `manifest.json` records the same
version and source URL; the build normalizes both in the registry copy. A local build of
just this coral, without changing any deployment's channels:

```sh
node packages/dynamic-corals/build.mjs inbox-bubble --registry packages/dynamic-corals/inbox-bubble/out/registry
sha256sum packages/dynamic-corals/inbox-bubble/out/registry/versions/inbox-bubble/0.7.16/inbox-bubble.js
```

The registry directory passed to the build belongs to the caller. `out/` above is ignored
scratch; deployment artifacts, channel pointers and `deploy.sh` live in the deployment
repository described in [the registry README](../registry/README.md). A published version
is immutable: if that deployment already has different bytes at 0.7.16, stop and choose a
new version before publishing.

### 🔴 Rolling out the loader handoff (0.7.12) — coral first, in this order

The sitetile engine that inlines the loader (CVERInc/tile#151, reef#1921) needs this coral at
0.7.12 or later on `v0` (see "Behind the site layout's loader"). Each step is a gate for the next:

- [ ] **Publish the immutable version.** `node packages/dynamic-corals/build.mjs inbox-bubble
      --registry <deployment registry root>` (plus that deployment's `--defaults` file if it uses
      one) writes `versions/inbox-bubble/0.7.12/{inbox-bubble.js,manifest.json}`.
- [ ] **Repoint `v0` → `0.7.12`** in the deployment's `manifest.json`.
- [ ] **Deploy the registry** (`registry/deploy.sh`).
- [ ] **Make the cached channel serve 0.7.12.** The worker answers channel URLs with `Cache-Control:
      public, max-age=300, stale-while-revalidate=3600` (`registry/registry-worker.mjs`), so any cache
      that holds an old response may hand it out for up to **3,900 s** after that response was
      served. Purge whatever shared cache can be purged — but visitors' browser caches cannot be,
      so in any case wait the full 3,900 s counted from the moment the deployed registry first served
      0.7.12 (the last moment an old response could have been handed out), plus deploy propagation.
      One fresh response proves nothing about anybody else's cache.
- [ ] **Verify the channel**, from outside, on `/corals/inbox-bubble/v0/inbox-bubble.js`: the header
      `X-Coral-Resolved: 0.7.12` **and** the body itself contains `__reefInboxLoader` and the
      version stamp `['inbox-bubble']='0.7.12'`. Both, not one: the header is the table, the body is
      what browsers run.
- [ ] **Only then release the engine** carrying the loader, and rebuild sites.

On its own, 0.7.12 changes nothing on pages that still carry `<script src>`: no handoff exists there,
so `mountAll()` takes nothing and every mount asks as before. That is why this order is safe and the
reverse is not.

**Rollback rule: never serve a coral below 0.7.12 while loader pages exist.** Built pages carry the
floor in the loader's first bytes (`/*inbox-bubble>=0.7.12*/`), so a site's HTML can be searched for
it. To downgrade the coral: first restore the eager engine (`<script src>`) and rebuild every site
that carries the loader, wait out the longest HTML cache those sites are served with, confirm the
marker is gone — then repoint `v0`. Rolling the **engine** back needs no coral change: the `<script
src>` page works with any coral.

<!-- coral metadata: start (generated by catalog-readme.mjs) -->
## inbox-bubble metadata

Draws a visitor inbox bubble only where the site has an Inbox; with data-kaito="1", falls back to an ask-only site-answer view.

Author: `official`.

### Embed

```html
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="YOUR_SITE_KEY"></div>
<script type="module" src="https://feelreef.com/corals/inbox-bubble/v0/inbox-bubble.js"></script>
```

### Attributes

| Attribute | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `data-dynamic-coral` | enum | yes | — | Selects the inbox-bubble coral. Values: `inbox-bubble`. |
| `data-kind` | enum | yes | — | Tenant kind: site, card, cardtile, or ext. Values: `site`, `card`, `cardtile`, `ext`. |
| `data-id` | string | yes | — | Tenant key for the selected kind. |
| `data-api-base` | url | no | `https://feelreef.com` | Backend origin override. |
| `data-kaito` | boolean | no | `false` | Set to 1 to enable the site-answer view. |
| `data-assistant-name` | string | no | — | Baked assistant name until the platform resolves its current value. |
| `data-open-on-hash` | boolean | no | `false` | Set to 1 to let #inbox open the panel. |
| `data-ai-log` | boolean | no | `true` | Set to 0 to disable the deferred question log and the guidance funnel. |
| `data-status` | string | no | — | Visible status line when the site-answer view is off. |
| `data-title` | string | no | — | Dialog accessible-name override; also the visible panel label in the ask-only view. |
| `data-open-label` | string | no | — | Open button label override. |
| `data-placeholder` | string | no | — | Message placeholder override. |
| `data-send-label` | string | no | — | Send button label override. |
| `data-site-name` | string | no | — | Site name: this attribute takes priority, then og:site_name, then hostname. |
| `data-search-index` | url | no | — | Path of the site's search index (sitetile sets /search-index.json on a blog site); fetched once on the first open, filtered in the browser as the visitor types. Absent, [] or unreachable: no search UI. |

<!-- coral metadata: end -->
