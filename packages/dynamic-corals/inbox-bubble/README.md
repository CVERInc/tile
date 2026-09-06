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
  page.
- `#inbox` in the page's URL fragment at load — honoured once, at mount, the same way.

Either reaches exactly what a click on the closed bubble reaches, so it focuses the ask/compose
input the same way every other way into the panel already does — there is no separate focus path
to keep in sync.

## Handing off a conversation from elsewhere

From 0.7.4, a page that mints a hand-off some other way than this file's own escalate/compose
forms — reef's own `/report` form, for instance, which writes the same handle shape this file's
`saveHandle` does — can make an ALREADY-mounted panel switch to it:

```js
const coral = document.querySelector('[data-dynamic-coral="inbox-bubble"]');
window.dispatchEvent(new CustomEvent('reef-inbox:handle', {
  detail: { target: coral, conv: 'the-conversation-id', ts: Date.now(), hasEmail: true, mode: 'human' }
}));
```

`detail` is the object this file's own `saveHandle` stores, plus an addressee — `target` (the
coral's own mount element), `conv` (string) and `ts` (number, when the handle was minted) are
required; `hasEmail` and `mode` (`'human'` or `'ask'`) are optional and default the same way
`saveHandle` itself defaults them. The gap it closes: a same-document `localStorage.setItem`
raises no `storage` event, so without this a mounted panel never finds out that another script on
the same page just gave this visitor a handle. On receipt the panel adopts it, tears down
whatever poller was running against the previous conversation, and re-renders.

🔴 **The panel DOES write the adopted handle to `localStorage`**, under its own
`reef-inbox:<kind>:<id>` key — this paragraph said the opposite until 0.7.5 and the code was
right, not the sentence. It writes because a panel showing one conversation and a storage key
pointing at another is the worse of the two failures: the next page load would open a different
thread than the one the visitor was just looking at. Two consequences to design around, since
that key holds only one handle:

- adopting **replaces** whatever handle this browser held for this tenant, and there is no second
  copy of it on this machine. That pointer is the visitor's only route back to their own thread —
  the owner's copy never expires, this one does — so an emitter that hands over a handle is
  taking that decision on the visitor's behalf.
- the key it writes is **this mount's** tenant, which is not necessarily the key the emitter
  wrote under. If the emitter minted the handle for a different `kind`/`id`, both keys now exist
  and only one of them is what the panel is showing.

The event is **addressed, not broadcast** — four things have to be true or it is silently ignored:

- `detail.target` is that mount's own element. This is a `window` event, so every script on the
  page can reach it; requiring the element means a sender has to know which coral it is talking
  to, so two corals on one page do not both adopt a handle meant for one of them, and a script
  firing blindly at `window` reaches none. 🔴 It is an addressee, not a secret — any script on
  the page can look the element up, so a site that loads third-party script it does not trust
  (ads, analytics, a plugin) has given that script this capability, the same way it has already
  given it `localStorage` and the DOM.
- `conv` is a string and `ts` a finite number — a malformed `detail` (not an object, missing or
  wrong-typed) is ignored, never thrown.
- the handle is inside the same 30-day TTL storage enforces, counted from the `ts` the sender
  supplied. Adoption keeps that `ts` rather than restamping it, so handing a handle over cannot
  extend a life the storage path would have let end.
- it is not older than the handle the panel already holds, so a replayed or stale event cannot
  rewind a visitor to a conversation they have moved past.

## The three things not to break

**It never claims anyone is there.** The panel shows a reply window only when the
owner actually set a number. No presence, ever — that is no-phantom applied to a
person, and a person is far easier to feel lied to about than a widget.

**The conversation id comes from the SERVER.** This browser stores what the server
minted and sends it back; it never invents one. A browser that can choose an id
can choose whose conversation to open — which is why the hand-off event above is
addressed to a mount and refuses to invent, extend or rewind a handle. The
handle expires locally after 30 days (`HANDLE_TTL_MS`, bumped from seven on
2026-09-04; this line still said seven); the owner's copy never expires.

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
