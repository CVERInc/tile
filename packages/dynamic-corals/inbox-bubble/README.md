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
| `data-open-label` / `data-title` / `data-placeholder` / `data-send-label` | copy overrides |

Words default from the PAGE's `<html lang>` — the site's own statement about who
it is for, not a guess and not the visitor's browser preference. Unknown language
falls back to English.

From 0.7.3 the ask panel says two things, not four (owner ruling 2026-09-07,
「太囉唆」): the status line under the site name —「\<名字\>**AI**先回，轉出去真人會看」—
and the box's own placeholder. The body line in the empty log and the
「站主看得到」 footer under the form are gone in every locale, and
`data-empty-label` went with the string it overrode.

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
a listener to exist.

## Handing a conversation over from elsewhere: navigate, do not dispatch

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
- **Only when the site has an Inbox.** The coral asks `GET /api/inbox/session?kind=…&id=…` the
  first time a visitor actually types a question (not at mount — that would be a request on every
  page view of every site to answer a question that matters on a small share of them). A definite
  answer is cached for six hours; a probe that could not answer — no network, or the endpoint's own
  `throttled` — is **not** an answer, so it is never written down as「no」, and it is retried at most
  once every five minutes rather than once per question. Not knowing behaves exactly like「no」for
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
  octets while every cap above counts characters, and one CJK character is three of them.
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

## Styling

Every colour is a `--reef-inbox-*` custom property with a neutral fallback, so a
site's theme wins without this file knowing anything about it. Dark mode follows
`prefers-color-scheme`; the entrance animation respects reduced motion.

## Publishing

Registry pipeline, same as every coral — bump `package.json`, `node
packages/dynamic-corals/build.mjs inbox-bubble`, repoint `registry/manifest.json`,
`registry/deploy.sh`. 🔴 Never `cp` a fix somewhere; the URL above is the only copy
anyone consumes.
