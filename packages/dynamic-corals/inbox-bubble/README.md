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
| `data-ai-log` | `"0"` opts this mount out of the deferred question log entirely — see "What the visitor asked the machine". Anything else, including the attribute being absent, leaves it on |
| `data-api-base` | override the feelreef origin (previews) |
| `data-status` | the one visible sentence under the site name on a mount **without** KAITO (tile#20) — replaces the locale default「真人會看」/ 'A person reads what you send'. Plain text: HTML-escaped, first line only, trimmed, capped at **80 grapheme clusters** (and 400 UTF-16 units), bidi/format controls removed. **Ignored when `data-kaito="1"`**: that line carries the AI disclosure, and no attribute may replace it |
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

A bubble is drawn only for a tenant that has an Inbox. Before anything else — no style, no node, no
listener, nothing in storage — a mount asks `GET /api/inbox/session?kind=…&id=…`, the same question
the server answers when a message arrives (a tenant without an Inbox refuses every message, on
purpose: nothing switches itself on because a stranger used it). A layout that puts this coral on
every page of every site is therefore safe: where the owner never opened the Inbox, the page simply
has no bubble.

| the answer | what the page gets |
|---|---|
| `claimed: true` | the bubble, exactly as it was drawn before this check existed |
| `claimed: false` | nothing — not a hidden bubble, no bubble — and no further request |
| no answer: a network failure, no reply within **10 s**, a non-2xx, a body of the wrong shape, or `throttled` | nothing yet; asked again after **2 s, 8 s and 30 s** — at most four requests per mount — and drawn the moment one answers yes |

There is no fourth row on purpose: no greyed-out bubble, no panel that apologises when opened. Any
such state is one a visitor can press and be let down by.

**Only a yes is remembered**, in this browser, for six hours (`reef-inbox:claim:<kind>:<id>`), so on
a site with an Inbox every page after the first draws without waiting for anything. A no is never
remembered: the person most likely to have just looked at a site without an Inbox is its owner,
and after opening one they should see the bubble on the very next page they load. So:

- **Inbox opened** → a visitor sees the bubble on their next page load (the endpoint is not cached).
- **Inbox gone** (a site that leaves the platform) → a browser that heard yes keeps drawing it for
  at most six hours from that answer; the first ask after that takes it away.

The cost: one request per page view on a site without an Inbox, one request per six hours per
browser on a site with one — up to four per mount only while the endpoint cannot answer.

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
  every time, not only when the answer first arrives.
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

## Publishing

Registry pipeline, same as every coral — bump `package.json`, `node
packages/dynamic-corals/build.mjs inbox-bubble`, repoint `registry/manifest.json`,
`registry/deploy.sh`. 🔴 Never `cp` a fix somewhere; the URL above is the only copy
anyone consumes.
