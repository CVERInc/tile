// @ts-nocheck — plain untyped JS (checker pragma only, no logic change), same
// as the square-shop coral beside it, so a consumer with strict `checkJs` can
// vendor this file unmodified rather than fork a typed copy.
//
// REEF with Inbox — the visitor bubble.
//
// A dynamic coral (see ../square-shop/PROVENANCE.md for the mount contract this
// implements): one plain JS module that installs, byte-for-byte, into either
// substrate — feelreef's own pages, or a sitetile static Astro build via an
// `embed` section's <script src>.
//
// ── What this is, and what it deliberately is not ───────────────────────────
//
// It is the bubble everybody already recognises in the bottom-right corner. It
// is NOT a chat client. There is no presence, no typing indicator, no queue, no
// "an agent will be with you shortly". `docs/SPEC-visitor-messages.md` §7 gives
// the reason: those exist because the products that have them were built for a
// support DEPARTMENT, and nearly every REEF customer is one person. Our
// differentiator is that the whole layer is missing.
//
// 🔴 IT NEVER CLAIMS ANYONE IS THERE. The panel shows 「通常 N 小時內回覆」only
// when the owner has actually set a number, and shows nothing otherwise. §7:
// 「在線狀態不准說謊」— that is no-phantom applied to a person, and a person is
// far easier to feel lied to about than a widget.
//
// 🔴 THE CONVERSATION ID COMES FROM THE SERVER. This browser stores whatever
// the server minted and sends it back; it never invents one. The CMS this was
// studied against lets the browser generate the id, and a browser that can
// choose an id can choose whose conversation to open.
//
// 🔴 AND THIS FILE OFFERS NO API FOR A PAGE SCRIPT TO PICK ONE — WHICH IS WHY THERE IS NO
// HAND-OFF EVENT (0.7.5, review B3). 0.7.4 added `reef-inbox:handle` so a page holding an id the
// server minted by another route could push it into an already-mounted panel. 0.7.5 addressed that
// event to one mount, and addressing fixed misdelivery, not reach: the address IS the mount
// element, and any script on the page can `querySelector` it. So the EVENT is what went (tile #15,
// won't do). No event, no export, no attribute takes a conversation id from the page.
//
// 🔴 WHAT THAT DOES NOT BUY, SAID PLAINLY (review B3, round 3 — this header used to claim more).
// A same-origin script that can write `localStorage['reef-inbox:<kind>:<id>']` and then navigate
// can still choose the conversation a visitor's next message is filed under: that is the same
// intake reef's own `/report` form uses, and it belongs to storage access, not to this widget.
// 🔴 AND SINCE 0.7.6 THERE ARE TWO KEYS, NOT ONE (review D12). `reef-inbox:ai:<kind>:<id>` — the
// deferred question buffer — carries a `handle` of its own, and that handle goes onto the wire
// with the questions, so the same one script can file this visitor's buffered questions under a
// conversation it chose. Same capability, same intake, second key; both are bounded by what they
// are read through (`parseHandle`, `parseAiLog`, `aiHandle`) and neither is a place this file can
// tell one same-origin writer from another.
// Removing the event took away the IN-PLACE, INVISIBLE version — switching the thread under a
// visitor who is mid-sentence in an open panel, with no navigation and nothing on screen to see.
// It did not take away the capability, and no code in this file can. A site that loads
// third-party script it does not trust (ads, analytics, a plugin) has given that script this
// capability the same way it has already given it `localStorage` and the DOM.
//
// A hand-off is a FULL NAVIGATION instead, which is what the platform already does: reef's own
// `/report` form writes the handle to storage and sends the visitor to a page where this coral
// mounts — and this file reads its handle at mount, from storage, which stays its one intake.
// A page that wants a mounted panel to switch conversations reloads it. The thirty days that
// handle then lives for are counted from the `ts` INSIDE IT — the timestamp whoever wrote the key
// chose (see `loadHandle`); `saveHandle` only stamps `Date.now()` on the handles this file writes
// itself.
//
// ── Two doors, and the second one has to be pressed ────────────────────────
//
// With data-kaito="1" the panel asks the SITE first (/api/kaito, extractive:
// a stored published passage returned verbatim, or the one fixed refusal). Only
// when the machine has nothing does a button appear offering to pass the
// question to a person — and 🔴 THAT PRESS IS THE POINT. A refusal is common and
// most of them are someone browsing; turning every one of them into an
// interruption is precisely the bubble this product exists not to be. The
// deliberate act is what earns a person's attention (SPEC §2).
//
// 🔴 A KAITO ANSWER IS NEVER STORED AND NEVER JOINS THE TRANSCRIPT. It is a
// machine quoting one of the owner's own pages; a message is a person speaking.
// Mixing them would put the owner's reply next to machine text with no way to
// tell who said what — and it is the mirror of the rule that a transcript never
// enters the corpus (SPEC §5). Only the visitor's OWN question travels, verbatim,
// when they press.
//
// Once a conversation exists the panel is a conversation, permanently — the
// stored handle IS the "already asked a person" flag, so there is no second
// piece of state to disagree with it.
//
// Config (data-* attributes on the container):
//   data-kind      (required) — 'site' | 'card' | 'cardtile' | 'ext'
//   data-id        (required) — the tenant key for that kind
//   data-kaito     (optional) — "1" asks the site first (needs REEF with KAITO)
//   data-open-on-hash (optional) — "1" lets `#inbox` in the URL open the panel at load. Off by
//                  default: a fragment is written by whoever authored the LINK, not by the site
//                  (see shouldAutoOpenFromHash).
//   data-ai-log    (optional) — "0" opts this mount out of the deferred question
//                  log entirely (ruling 54): nothing is buffered, nothing is
//                  probed, nothing is ever sent. Any other value, including the
//                  attribute being absent, leaves it on — and「on」still writes
//                  nothing at all unless the tenant actually has an Inbox.
//   data-api-base  (optional) — override the feelreef origin
//   data-assistant-name (optional) — what VISITORS see the assistant called
//                  instead of "KAITO" (owner ruling, 2026-09-05: the name may
//                  change, but the panel still marks the reply as AI — see
//                  statusDefault). Trimmed to a single line, capped at 40
//                  grapheme clusters AND 200 UTF-16 units (a cluster has no
//                  length limit of its own — see ASSISTANT_NAME_MAX_UNITS);
//                  blank/whitespace falls back to "KAITO".
//   data-status    (optional) — the one visible sentence under the site name on a mount WITHOUT
//                  KAITO (tile#20), replacing the locale's `statusNoAi`. Plain text: escaped, one
//                  line, capped at 80 grapheme clusters. Ignored when data-kaito="1" — that line
//                  carries the AI disclosure and no attribute may replace it.
//   data-title / data-placeholder / data-send / data-… (optional) — copy. 🔴 `data-title` is
//                  the dialog's aria-label ONLY (ruling 2026-09-07); it is never visible text.
//
// Usage:
//   <div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="cver"></div>
//   <script type="module" src=".../inbox-bubble.js"></script>

const DEFAULT_API_BASE = 'https://feelreef.com';
const SELECTOR = '[data-dynamic-coral="inbox-bubble"]';
const PREFIX = 'dc-inbox';
/**
 * The honeypot label's own `style` attribute, on top of the `.dc-inbox-hp` rule (tile#19).
 *
 * 🩸 The rule alone is not enough on a layered site. There the injected stylesheet is inside
 * `@layer reef.corals`, and ANY unlayered host declaration beats a layered one whatever its
 * specificity — so a site's ordinary `form label{display:block;position:static}` put the honeypot
 * and its「Leave this empty」back inside the panel, and a visitor who typed into it had their
 * message silently dropped as spam. An inline declaration outranks every normal author rule,
 * layered or not. Off-screen and transparent, deliberately NOT `display:none` — the same posture
 * as sitetile's Form.astro honeypot, so a bot's DOM-level autofill still finds it.
 */
const HP_STYLE = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;opacity:0';

// ── in-site search (reef#2160) ───────────────────────────────────────────────
// The bubble filters the site's own /search-index.json in the visitor's browser as they type
// (chodaict 2026-10-18: one input; typing floats matching articles, Enter is always「ask」). The
// index is named by the host's `data-search-index` attribute (the sitetile layout sets it only on a
// blog site with bubble search on), fetched ONCE per mount and only on the FIRST OPEN — never at
// page load — and an index that is `[]` or unreachable draws today's bubble, byte for byte.
// 🔴 WHAT THE VISITOR TYPES NEVER LEAVES THE PAGE through this feature: the filter runs here, the
// list is links, and nothing is recorded (ticket item 6 — no query analytics of any kind).
/** Rows shown at most: the panel is 22rem wide and the list sits above the composer. */
const SEARCH_MAX = 8;
/**
 * A query longer than this collapses the list: it is a message being written, not a title being
 * looked for. 40 is above the longest title on the largest index measured (tniop, 1,410 rows:
 * p99 title 23 characters, max 31), so no title that could match is ever cut off by the limit.
 */
const SEARCH_QUERY_MAX = 40;

// 🔴 VERBATIM COPY of packages/sitetile/astro/src/packages/blog-search/search-filter.mjs — the ONE
// filter the header magnifier, the /search page and this bubble run (reef#2159). A coral has no
// imports (nothing to bundle), so it is pasted, not imported; search-filter-sync.test.mjs fails the
// moment the two blocks differ. Edit the module, then paste it here.
// ── SHARED-FILTER-BEGIN (verbatim in inbox-bubble.js) ──
/** fold: NFC → lowercase → strip combining diacritics. CJK passes through untouched. */
function fold(s) {
	return String(s == null ? '' : s)
		.normalize('NFC').toLowerCase()
		.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Substring filter over an index of `{t,u,g,d,i,e?}` rows. Title hits sort before tag/excerpt-only
 * hits; an empty or whitespace-only query, or no index, is no results. At most `max` rows.
 */
function filterIndex(index, q, max) {
	const nq = fold(q).trim();
	if (!nq || !Array.isArray(index)) return [];
	const titleHits = [];
	const rest = [];
	for (const row of index) {
		if (fold(row.t).indexOf(nq) !== -1) { titleHits.push(row); continue; }
		const g = fold(Array.isArray(row.g) ? row.g.join(' ') : (row.g || ''));
		const e = fold(row.e || '');
		if (g.indexOf(nq) !== -1 || e.indexOf(nq) !== -1) rest.push(row);
	}
	return titleHits.concat(rest).slice(0, max);
}
// ── SHARED-FILTER-END ──

/**
 * 0.7.2 (owner ruling 2026-09-06 #34). The AI marker used to be the literal characters
 * "(AI)"/"（AI）" baked into each locale's `statusDefault` PLAIN TEXT below. It is a
 * Discord-APP-style CHIP now: a styled `<span>`, never parentheses.
 *
 * 🩸 THIS LANDED IN THE WRONG REPO FIRST. It was written into reef's vendored snapshot
 * (`apps/feelreef/src/lib/dynamic-corals/inbox-bubble/`) on 2026-09-06 because that snapshot's
 * sibling test was the coral's only browser coverage anywhere — and a vendored snapshot ships
 * to nobody. The bytes a visitor runs come from this file, through the registry. It is here
 * now, and reef re-vendors 0.7.2 from the published artifact.
 *
 * 🔴 THE TOKEN, NOT THE MARKUP, LIVES IN `COPY`. Each locale's `statusDefault` still owns
 * WHERE the marker sits in its own sentence (that placement is a translation decision, and
 * stays one per locale) — it just marks the spot with this sentinel instead of typing "(AI)"
 * itself. `statusFor` below is the ONE place that turns the sentinel into real HTML, which is
 * also the one place that has to reason about escaping (see its own comment) — so there is
 * exactly one seam that can get that wrong, not five.
 *
 * 🔴 NON-REMOVABLE BY CONSTRUCTION, not by convention. There is no config attribute that
 * reaches this token or the chip it becomes — `resolveAssistantName` only ever supplies the
 * NAME, and every locale's `statusDefault` places this token unconditionally. The invariant
 * the file header already states — the AI identity may never be hidden — is enforced by there
 * being no code path that can construct a status line without it.
 *
 * 🔴 WRAPPED IN U+2063 (INVISIBLE SEPARATOR), not a plain word or a null byte: real text, so
 * grep/diff/every other text tool still treats this file as text (a null byte earlier in this
 * same edit made `grep` silently skip the whole file — measured, not theoretical), and
 * invisible enough that nothing a translator or an owner-supplied `data-assistant-name` would
 * ever legitimately type collides with it. It never reaches the DOM either way: `statusFor`
 * below splits on it and replaces it with `AI_CHIP_HTML` before anything is escaped or inserted.
 */
const AI_CHIP_TOKEN = '⁣AI_CHIP⁣';

/**
 * The chip itself — no leading/trailing text-level space either side (every locale's
 * `statusDefault` places the token flush against its neighbours); the CSS class below gives it
 * its own inline margin instead, so the visual gap is uniform across locales rather than
 * depending on whichever locale happened to type a space next to its parentheses.
 *
 * `aria-label="AI"` is belt-and-braces alongside the chip's own visible "AI" text:
 * `font-variant: all-small-caps` (the CSS below) restyles the letterforms but must never change
 * what a screen reader announces, and pinning the accessible name here means it can't, regardless
 * of how the visual styling evolves.
 */
const AI_CHIP_HTML = `<span class="${PREFIX}-ai-chip" aria-label="AI">AI</span>`;

/**
 * How long this browser remembers which conversation it is part of.
 *
 * 🩸 Was seven days, matching the studied CMS (§9). Bumped to thirty
 * (2026-09-04, from a production report on a live site): a visitor who hands off and comes
 * back a week later — entirely plausible for a shop the owner replies to by
 * hand — found their handle already gone and started over with no memory of
 * having asked. What it still buys: the visitor never logs in, we never mint a
 * session, and the handle to their own words lives on their machine with an
 * expiry date they control. What it costs, stated so nobody rediscovers it as
 * a bug: a different device is a different conversation, and after thirty
 * days a returning visitor starts a new one. The owner's copy never expires —
 * only this pointer does. (Not to be confused with `HANDOFF_STALE_MS` below,
 * which is about the CONTENT of a live conversation, not this storage TTL.)
 */
const HANDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long a human hand-off may sit with no fresh word from the owner before
 * the panel treats it as concluded and offers KAITO again on next open.
 *
 * 🔴 A FALLBACK, not the first choice — see `handoffConcluded` below. The
 * `/api/inbox` response this file reads is `{ messages }` today (see
 * docs/SPEC-visitor-messages.md); the server's own `InboxState` already has a
 * real `closed` (reef `$lib/inbox/conversation.ts`), it just is not on the
 * wire yet. When it is, this constant stops mattering for any site that sends
 * it. Seven days chosen to match the storage TTL's old value — long enough
 * that a normal reply cadence never trips it, short enough that "stuck in
 * human mode for days" (the bug this file exists to fix) cannot recur.
 */
const HANDOFF_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PREFIX = 'reef-inbox:';
/** How often the panel checks for a reply while it is OPEN. Closed costs nothing. */
const POLL_MS = 15000;
/**
 * Give up polling after this many failures in a row.
 *
 * 🔴 Not politeness — arithmetic. An open panel polled every 15s forever, so a
 * server having a bad minute was being asked again by every open tab on every
 * site running this coral, for as long as those tabs stayed open, with no
 * ceiling. The visitor sees nothing either way; the difference is whether a
 * degraded endpoint gets to recover.
 *
 * Sending still works after this stops: a message is a deliberate act and gets
 * its own request. Only the background checking gives up, and reopening the
 * panel starts it again.
 */
const POLL_GIVE_UP_AFTER = 4;

// The document-root attribute a site's `_site.md` declaration stamps (see
// packages/sitetile/astro/src/lib/dynamic-coral-css.mjs, the renderer/emitter-side definition of
// the same attribute and token). This file is `bundle:false` — it IS the registry artifact, no
// build step touches it — so it cannot import that module; the two literals are duplicated here
// instead of adding a new cross-package dependency to a widget meant to mount on any host page.
const DYNAMIC_CORAL_CSS_ATTR = 'data-dynamic-coral-css';
const DYNAMIC_CORAL_CSS_LAYERED = 'layered';

/** Wrap `css` in `@layer reef.corals { … }` when the document root declares the layered mode;
 *  return it byte-for-byte unchanged otherwise. Absent attribute means legacy, and legacy must
 *  stay exactly what it always was — a site that never rebuilds still gets this widget through
 *  the fleet-wide channel repoint, and it is mounted site-wide by default. */
function withDynamicCoralCssLayer(css) {
	const root = typeof document !== 'undefined' ? document.documentElement : null;
	const layered = !!root && typeof root.getAttribute === 'function' &&
		root.getAttribute(DYNAMIC_CORAL_CSS_ATTR) === DYNAMIC_CORAL_CSS_LAYERED;
	return layered ? `@layer reef.corals {\n${css}\n}` : css;
}

// 🔴 VERBATIM COPY of ../shared/dock.mjs's DOCK-BASE block — the corner dock every corner coral joins
// (reef#2790): where the bubble sits, how it stacks with the site's own corner items, the shape and
// the shadow budget. A coral has no imports, so it is pasted, not imported; dock-sync.test.mjs fails
// the moment the two blocks differ. Edit the module, then paste it here. The three-sentence contract
// that lets this copy and an older or newer one on the same page cooperate is in that module's header.
// ── DOCK-BASE-BEGIN (verbatim in inbox-bubble.js) ──
const DOCK_TAG = 'dc-dock';
const DOCK_OPEN = 'dc-dock:open';
/** The budget (see the header): the outer layer's reach, 4 + 12 = 16px, is the edge margin. */
const DOCK_SHADOW = '0 1px 3px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.14)';
/** Tabs in the installed-app bar before the last one becomes "More". */
const DOCK_BAR_MAX = 5;
const DOCK_CSS = `
:host{position:fixed!important;z-index:2147483000;display:flex!important;flex-direction:column-reverse;
  box-sizing:border-box;margin:0!important;border:0!important;width:auto;height:auto;
  padding:0 0 var(--_dc-reserve,0px)!important;pointer-events:none;
  gap:var(--dc-dock-gap);bottom:calc(var(--dc-dock-margin) + env(safe-area-inset-bottom,0px));
  --dc-dock-margin:max(1rem,16px);--dc-dock-size:3.5rem;--dc-dock-w:var(--dc-dock-size);--dc-dock-gap:.5rem;
  --dc-dock-radius:50%;--dc-dock-shadow:${DOCK_SHADOW};--dc-dock-vh:100vh;
  --dc-dock-room:calc(var(--dc-dock-vh) - 2 * var(--dc-dock-margin) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - var(--_dc-reserve,0px));
  --dc-dock-panel-w:min(22rem,calc(100vw - 2 * var(--dc-dock-margin) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)))}
@supports (height:100dvh){:host{--dc-dock-vh:100dvh}}
:host([hidden]){display:none!important}
:host(:not([name="left"])){right:calc(var(--dc-dock-margin) + env(safe-area-inset-right,0px));align-items:flex-end}
:host([name="left"]){left:calc(var(--dc-dock-margin) + env(safe-area-inset-left,0px));align-items:flex-start}
::slotted(*){display:flex!important;flex-direction:column!important;align-items:inherit!important;gap:var(--dc-dock-gap)!important;
  flex:none!important;position:static!important;margin:0!important;padding:0!important;pointer-events:auto}
::slotted([hidden]){display:none!important}
:host([name="bar"]){left:0;right:0;bottom:0;flex-direction:row;align-items:stretch;gap:0;
  padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important;
  background:var(--dc-dock-bar-bg,#fff);color:var(--dc-dock-bar-fg,#111);box-shadow:0 -1px 0 rgba(0,0,0,.12);
  --dc-dock-w:100%;--dc-dock-radius:0;--dc-dock-shadow:none;--dc-dock-item-bg:transparent;--dc-dock-item-ink:currentColor;
  --dc-dock-room:calc(var(--dc-dock-vh) - var(--dc-dock-size) - var(--dc-dock-margin) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
  --dc-dock-panel-w:auto}
:host([name="bar"]) ::slotted(*){flex:1 1 0!important;min-width:0!important;min-height:var(--dc-dock-size)!important;
  align-items:center!important;justify-content:center!important;gap:0!important;box-sizing:border-box!important;
  color:inherit;text-align:center;text-decoration:none;font-size:.75rem;line-height:1.2;overflow-wrap:anywhere}
:host([name="bar"]) ::slotted([aria-current="page"]),:host([name="bar"]) ::slotted([data-current]){font-weight:700;box-shadow:inset 0 3px 0 currentColor}
:host([name="bar"]) ::slotted([slot="more"]){flex:none!important;min-height:3rem!important;align-items:stretch!important;justify-content:center!important;padding:0 1rem!important;text-align:start;font-size:1rem}
.more{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;min-height:var(--dc-dock-size);display:flex;flex-direction:column;
  align-items:center;justify-content:center;cursor:pointer;color:inherit;font:inherit;font-size:.75rem;line-height:1.2;pointer-events:auto}
.more[hidden]{display:none}
.more:focus-visible{outline:2px solid currentColor;outline-offset:-4px}
.more svg{width:1.5rem;height:1.5rem}
.sheet{position:fixed;left:0;right:0;bottom:calc(var(--dc-dock-size) + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;
  max-height:var(--dc-dock-room);overflow:auto;padding:0 env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px);
  background:inherit;color:inherit;box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14);border-radius:.9rem .9rem 0 0;
  visibility:hidden;pointer-events:none}
.sheet[data-open]{visibility:visible;pointer-events:auto}
@media (prefers-color-scheme:dark){:host([name="bar"]){background:var(--dc-dock-bar-bg,#1c1c1e);color:var(--dc-dock-bar-fg,#f2f2f7)}}
@media print{:host{display:none!important}}
`;
const DOCK_MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';

/** The × an open item's bubble shows in place of its icon: the bubble is the panel's close control. */
const DOCK_CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>';

/**
 * The renderer's bar, when this page view uses it (contract ①): written by the page and switched on
 * by `<html data-dc-dock-bar>`. Otherwise null — and then every item stays in the corners.
 */
function dockBarOn(doc) {
  if (!doc.documentElement || typeof doc.documentElement.hasAttribute !== 'function') return null;
  if (!doc.documentElement.hasAttribute('data-dc-dock-bar')) return null;
  return doc.querySelector(`${DOCK_TAG}[name="bar"]`);
}

/**
 * The owner's bottom reserve, validated: a length (not a percentage) or 0px. A typo in a site's
 * theme must not invalidate the dock's own geometry, so the public token is read and only a value
 * the browser accepts as a length reaches the private one the stylesheet uses.
 */
function dockReserve(dock) {
  let v = '';
  try { v = String(getComputedStyle(dock).getPropertyValue('--dc-dock-reserve') || '').trim(); } catch { /* no CSSOM */ }
  const ok = v && !/%/.test(v) && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('padding-bottom', v);
  dock.style.setProperty('--_dc-reserve', ok ? `clamp(0px,${v},50vh)` : '0px');
}

/** The bar's "More": children past the fourth go to `slot="more"` once there are more than five. */
function dockBar(dock, shadow) {
  const doc = dock.ownerDocument;
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'more';
  more.hidden = true;
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'dc-dock-sheet');
  const label = dock.getAttribute('data-more-label') || 'More';
  more.innerHTML = DOCK_MORE_ICON;
  more.appendChild(doc.createElement('span')).textContent = label;
  const sheet = doc.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'dc-dock-sheet';
  sheet.setAttribute('role', 'group');
  sheet.setAttribute('aria-label', label);
  sheet.appendChild(doc.createElement('slot')).name = 'more';
  shadow.append(more, sheet);
  const show = (open, focus) => {
    sheet.toggleAttribute('data-open', open);
    more.setAttribute('aria-expanded', String(open));
    if (open) doc.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: dock }));
    else if (focus) more.focus();
  };
  more.addEventListener('click', () => show(more.getAttribute('aria-expanded') !== 'true'));
  // Any other open closes the sheet — an item opened FROM the sheet included: its panel takes the
  // screen, and stays visible because an item's panel sets `visibility:visible` over the sheet's.
  // Not an opener INSIDE a More entry (a nav group's list): what it opens is part of the sheet, and
  // closing the sheet would hide it again (review of tile#233, finding 4).
  doc.addEventListener(DOCK_OPEN, (e) => {
    const d = e.detail;
    if (d === dock) return;
    const entry = d && typeof d.closest === 'function' ? d.closest('[slot="more"]') : null;
    if (entry && entry !== d && entry.parentNode === dock) return;
    show(false);
  });
  shadow.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.hasAttribute('data-open')) show(false, true); });
  const sync = () => {
    const kids = [...dock.children].filter((k) => !k.hidden);
    // Entries the renderer said will join later (`data-reserve`) count from the start, until they do.
    const reserve = Math.min(Math.max(parseInt(dock.getAttribute('data-reserve') || '0', 10) || 0, 0), DOCK_BAR_MAX);
    const own = kids.filter((k) => !k.dockAnchor).length;
    const over = Math.max(kids.length, own + reserve) > DOCK_BAR_MAX;
    kids.forEach((k, i) => {
      const want = over && i >= DOCK_BAR_MAX - 1 ? 'more' : null;
      if (k.getAttribute('slot') !== want) { if (want) k.setAttribute('slot', want); else k.removeAttribute('slot'); }
    });
    more.hidden = !over;
    if (!over && sheet.hasAttribute('data-open')) show(false);
    // An empty bar is no bar: a strip along the bottom with nothing in it is a broken page.
    // 🩸 ONLY WHEN IT CHANGES. Setting `hidden` to the value it already has still queues an attribute
    // record, the observer below watches exactly that attribute, and an empty bar re-ran this forever:
    // the page froze (review of tile#233, finding 1).
    if (dock.hidden !== (kids.length === 0)) dock.hidden = kids.length === 0;
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver(sync).observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  sync();
}

/**
 * Contract ③: one observer per page, set up by the first copy to claim a dock. When nodes leave the
 * document it retires every docked item whose anchor went with them — the inbox whose container a
 * route change replaced, a dock item whose section was torn down — as removing the container did
 * when the item still lived inside it. Removals only, and only the docks' own children are looked at.
 */
function dockWatch(doc) {
  if (doc.dcDockWatch || typeof MutationObserver !== 'function') return;
  doc.dcDockWatch = true;
  new MutationObserver((records) => {
    if (!records.some((r) => r.removedNodes.length)) return;
    for (const dock of doc.querySelectorAll(DOCK_TAG)) {
      for (const item of [...dock.children]) if (item.dockAnchor && !item.dockAnchor.isConnected) item.remove();
    }
  }).observe(doc, { childList: true, subtree: true });
}

/** Gives a dock its look, once: the first copy to arrive attaches the shadow root, later ones see it. */
function dockClaim(dock) {
  if (dock.shadowRoot) return;
  const doc = dock.ownerDocument;
  dockWatch(doc);
  const shadow = dock.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = DOCK_CSS;
  shadow.append(style, doc.createElement('slot'));
  dockReserve(dock);
  if (typeof window !== 'undefined') window.addEventListener('resize', () => dockReserve(dock));
  if (dock.getAttribute('name') === 'bar') dockBar(dock, shadow);
  else dock.hidden = false;
}

/** Contract ①. Returns the dock the item is now in, or null where there is no document to join. */
function dockJoin(item, anchor, name) {
  const doc = item.ownerDocument;
  if (!doc || !doc.body || typeof doc.querySelector !== 'function') return null;
  const bar = dockBarOn(doc);
  // `bar` is the renderer's to write: a coral asking for it by name gets a corner like any other name.
  const want = /^[a-z][a-z0-9-]*$/.test(name || '') && name !== 'bar' ? name : 'right';
  let dock = bar || doc.querySelector(`${DOCK_TAG}[name="${want}"]`);
  if (!dock) {
    dock = doc.createElement(DOCK_TAG);
    dock.setAttribute('name', want);
    doc.body.appendChild(dock);
  }
  dockClaim(dock);
  item.dockAnchor = anchor;
  const at = (n) => n.dockAnchor || n;
  let before = null;
  for (const child of dock.children) {
    if (child === item) continue;
    // DOCUMENT_POSITION_FOLLOWING: the child's place comes after this item's.
    if (anchor.compareDocumentPosition(at(child)) & 4) { before = child; break; }
  }
  if (item.parentNode !== dock || item.nextElementSibling !== before) dock.insertBefore(item, before);
  return dock;
}

/** How many visible items sit between this one and the corner — what an open panel must leave room for. */
function dockBelow(item) {
  let n = 0;
  for (let s = item.previousElementSibling; s; s = s.previousElementSibling) if (!s.hidden) n++;
  return n;
}

/** Contract ②, both halves: announce an open; close when another item announces one. */
function dockAnnounce(item) {
  item.ownerDocument.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: item }));
}
function dockListen(item, close) {
  const doc = item.ownerDocument;
  const on = (e) => { if (e.detail !== item) close(); };
  doc.addEventListener(DOCK_OPEN, on);
  return () => doc.removeEventListener(DOCK_OPEN, on);
}

/**
 * Is any corner item open right now, whoever drew it? Read from what every item already shows: a
 * control with `aria-expanded="true"` in its open shadow root (or the bar's own More), or an open
 * `<details>` among a renderer's own entries. An auto-open asks this first, so it never closes what a
 * visitor, a `#name` or a `reef-inbox:open` opened.
 */
function dockAnyOpen(doc) {
  const open = (root) => !!(root && root.querySelector('[aria-expanded="true"]'));
  for (const dock of doc.querySelectorAll(DOCK_TAG)) {
    if (open(dock.shadowRoot)) return true;
    for (const item of dock.children) {
      if (item.shadowRoot ? open(item.shadowRoot) : !!item.querySelector('details[open]')) return true;
    }
  }
  return false;
}

/**
 * Where the focus goes when an item's panel closes from the keyboard: its bubble — or, for an item
 * that sits in the bar's More sheet (closed by the time its panel was open), the More button, the
 * nearest control still on screen.
 */
function dockFocusBack(item, bubble) {
  const dock = item.parentNode;
  const more = item.getAttribute && item.getAttribute('slot') === 'more' && dock && dock.shadowRoot
    ? dock.shadowRoot.querySelector('.more') : null;
  const to = more && !more.hidden ? more : bubble;
  if (to && typeof to.focus === 'function') to.focus();
}

/** `#rgb`, `#rrggbb`, `rgb()`/`rgba()` → [r, g, b] (0–255), or null. */
function dockRgb(text) {
  const s = String(text || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [m[1], m[2], m[3]].map(Number) : null;
}

/**
 * Black or white ink for a background, by relative luminance (WCAG 2): white below 0.179, where the
 * two contrast ratios cross. A colour that cannot be read is treated as dark — the default bubble is.
 */
function dockInk(bg) {
  const rgb = dockRgb(bg);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}
// ── DOCK-BASE-END ──

// ── copy ────────────────────────────────────────────────────────────────────
// Defaults come from the PAGE's declared language (`<html lang>`), which is the
// site's own statement about who it is for — not from a guess, and not from the
// visitor's browser (a Japanese reader on a Taiwanese site should see the site's
// language, the same as every other word on the page). Every string is still
// overridable per-embed via data-*, and anything unknown falls back to English.
//
// 🔴 0.7.3 (owner ruling 2026-09-07): THE ASK PANEL SAYS TWO THINGS FEWER. It used to open with
// four sentences before the visitor could type — a status line, a body line in the empty log, a
// placeholder, and a 「站主看得到」 footer under the form — and the owner's word for that was
// 「太囉唆」. What survives is the status line (now 「<名字>[AI]先回，轉出去真人會看」: the same two
// facts, in half the words) and the placeholder. `empty` and `seen` are GONE, not shortened, so
// there is no key left for a locale to re-grow them from — and `data-empty-label` went with
// `empty`, because an override for a string nothing renders is a promise this file cannot keep.
//
// 🔴 The status line keeps carrying `AI_CHIP_TOKEN` and the assistant-name slot. Shorter copy is
// exactly where a disclosure gets dropped by accident, and the 2026-09-05 ruling did not move:
// the name may change, the reply is always marked AI.
export const COPY = {
	en: {
		ask: 'Ask about this site…',
		asking: 'Looking…',
		source: 'Where this comes from',
		refused: "I don't have a record of that.",
		toHuman: 'Ask a person instead',
		toHumanAfterRefusal: 'Send this to a person',
		kaitoUnavailable: "The AI can't answer right now.",
		kaitoUnavailableToHuman: "The AI can't answer right now. You can send this to a person.",
		sentToHuman: "Passed to a person — you'll get a reply here.",
		name: 'Name (optional)',
		email: 'Email (optional)',
		emailNote: "Leave your email to get a reply by email. Without it, you can only see replies by coming back to this page.",
		cancel: 'Cancel',
		open: 'Message us',
		title: 'Leave a message',
		placeholder: 'Type your question…',
		send: 'Send',
		sending: 'Sending…',
		stored: "Got it — we've saved your message.",
		within: (h) => `Usually replies within ${h} hours.`,
		you: 'You',
		them: 'Reply',
		error: "That didn't go through. Please try again.",
		errorInboxStorageFull: "This site's inbox is full and can't take new messages right now.",
		rate: "That's a lot of messages — please try again in a minute.",
		closed: 'Close',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}answers first, a person reads what you send on`,
		statusNoAi: 'A person reads what you send',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}answers from this site's content`,
		statusHandedOffEmail: "Passed to a person — the reply will come by email.",
		statusHandedOffNoEmail: 'Passed to a person — the reply will show here.',
		askAgain: (a) => `Ask ${a} again`,
		newConversation: 'Start a new conversation',
		backToHuman: 'Back to your conversation',
		handoffEnded: 'Your last conversation has ended.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: 'Typing only searches inside your browser. Nothing is sent until you press the button.',
		askAi: 'Ask AI',
		sendOwner: 'Send to a person'
	},
	'zh-tw': {
		ask: '問這個站的事…',
		asking: '找找看⋯⋯',
		source: '這段出自哪裡',
		refused: '我沒有這方面的紀錄。',
		toHuman: '還是想問真人',
		toHumanAfterRefusal: '幫我轉給真人',
		kaitoUnavailable: 'AI 現在沒辦法回答。',
		kaitoUnavailableToHuman: 'AI 現在沒辦法回答，可以轉給真人。',
		sentToHuman: '已經轉給真人了，回覆會出現在這裡。',
		name: '姓名（選填）',
		email: 'Email（選填）',
		emailNote: '留下 email 才收得到回覆；不留的話，只有回到這個網頁才看得到。',
		cancel: '取消',
		open: '傳訊息',
		title: '留言給我們',
		placeholder: '想問什麼都可以⋯⋯',
		send: '送出',
		sending: '送出中⋯⋯',
		stored: '已經記下來了。',
		within: (h) => `通常 ${h} 小時內回覆。`,
		you: '你',
		them: '回覆',
		error: '沒有送出去，請再試一次。',
		errorInboxStorageFull: "這個網站的收件匣已滿，目前無法接收新訊息。",
		rate: '訊息有點多，請稍等一分鐘再試。',
		closed: '關閉',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，轉出去真人會看`,
		statusNoAi: '真人會看',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}用這個站的內容回答`,
		statusHandedOffEmail: '已轉給真人，回覆會寄到你填的信箱',
		statusHandedOffNoEmail: '已轉給真人，回覆會顯示在這裡',
		askAgain: (a) => `重新問 ${a}`,
		newConversation: '新對話',
		backToHuman: '回到真人對話',
		handoffEnded: '上次的對話已結束',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: '打字時只在你的瀏覽器裡找，按下按鈕才會送出。',
		askAi: '問 AI',
		sendOwner: '傳給真人'
	},
	ja: {
		ask: 'このサイトについて質問…',
		asking: '探しています…',
		source: 'この一節の出どころ',
		refused: 'そのことについては記録がありません。',
		toHuman: 'やはり人に聞く',
		toHumanAfterRefusal: '人に取り次いでもらう',
		kaitoUnavailable: 'AIは今お答えできません。',
		kaitoUnavailableToHuman: 'AIは今お答えできません。人に取り次ぐこともできます。',
		sentToHuman: '担当者に取り次ぎました。返信はここに表示されます。',
		name: 'お名前（任意）',
		email: 'メールアドレス（任意）',
		emailNote: 'メールアドレスを残していただくと、返信をメールで受け取れます。残さない場合は、このページに戻ったときだけ返信を確認できます。',
		cancel: 'キャンセル',
		open: 'メッセージ',
		title: 'メッセージを残す',
		placeholder: 'ご質問をどうぞ…',
		send: '送信',
		sending: '送信中…',
		stored: '受け取りました。',
		within: (h) => `通常 ${h} 時間以内に返信します。`,
		you: 'あなた',
		them: '返信',
		error: '送信できませんでした。もう一度お試しください。',
		errorInboxStorageFull: "このサイトの受信箱はいっぱいで、現在新しいメッセージを受け取れません。",
		rate: '送信が多すぎます。1分ほどお待ちください。',
		closed: '閉じる',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}が先に回答・送れば人が読みます`,
		statusNoAi: '送った内容は人が読みます',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}がこのサイトの内容から回答します`,
		statusHandedOffEmail: '担当者に取り次ぎました。返信はメールで届きます。',
		statusHandedOffNoEmail: '担当者に取り次ぎました。返信はここに表示されます。',
		askAgain: (a) => `もう一度${a}に聞く`,
		newConversation: '新しい会話を始める',
		backToHuman: 'やり取りに戻る',
		handoffEnded: '前回のやり取りは終了しました。',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: '入力中はブラウザの中だけで探します。ボタンを押すまで何も送信されません。',
		askAi: 'AI に聞く',
		sendOwner: '担当者に送る'
	},
	'zh-cn': {
		ask: '问这个网站的事…',
		asking: '找找看⋯⋯',
		source: '这段出自哪里',
		refused: '我没有这方面的记录。',
		toHuman: '还是想问真人',
		toHumanAfterRefusal: '帮我转给真人',
		kaitoUnavailable: 'AI 现在没办法回答。',
		kaitoUnavailableToHuman: 'AI 现在没办法回答，可以转给真人。',
		sentToHuman: '已经转给真人了，回复会出现在这里。',
		name: '姓名（选填）',
		email: 'Email（选填）',
		emailNote: '留下 email 才收得到回复；不留的话，只有回到这个网页才看得到。',
		cancel: '取消',
		open: '发消息',
		title: '留言给我们',
		placeholder: '想问什么都可以⋯⋯',
		send: '发送',
		sending: '发送中⋯⋯',
		stored: '已经记下来了。',
		within: (h) => `通常 ${h} 小时内回复。`,
		you: '你',
		them: '回复',
		error: '没有发送出去，请再试一次。',
		errorInboxStorageFull: "这个网站的收件箱已满，目前无法接收新消息。",
		rate: '消息有点多，请稍等一分钟再试。',
		closed: '关闭',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}先回，转出去真人会看`,
		statusNoAi: '真人会看',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}用这个网站的内容回答`,
		statusHandedOffEmail: '已转给真人，回复会发送到你填写的邮箱',
		statusHandedOffNoEmail: '已转给真人，回复会显示在这里',
		askAgain: (a) => `重新问 ${a}`,
		newConversation: '新对话',
		backToHuman: '回到真人对话',
		handoffEnded: '上次的对话已结束',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: '打字时只在你的浏览器里找，按下按钮才会送出。',
		askAi: '问 AI',
		sendOwner: '传给真人'
	},
	// 🔴 The five below arrived 2026-09-27 (tile #14): a German site set its own title and
	// placeholder through data-*, and every other word in the panel — Send, the errors, the status
	// line, the accessible names — came out English beside them, because these keys did not exist
	// and `resolveLocale` fell through to `en`. They are feelreef's console locales (the same nine
	// cardtile's sandbox speaks), in the same register cardtile already chose for each: Sie, vous,
	// tú, você, 해요체. The test that keeps this from recurring asks cardtile's list, not this one.
	de: {
		ask: 'Etwas zu dieser Website fragen…',
		asking: 'Wird gesucht…',
		source: 'Woher das stammt',
		refused: 'Dazu liegt mir nichts vor.',
		toHuman: 'Lieber einen Menschen fragen',
		toHumanAfterRefusal: 'An einen Menschen weitergeben',
		kaitoUnavailable: 'Die KI kann gerade nicht antworten.',
		kaitoUnavailableToHuman: 'Die KI kann gerade nicht antworten. Sie können dies an einen Menschen weitergeben.',
		sentToHuman: 'An einen Menschen weitergegeben — die Antwort erscheint hier.',
		name: 'Name (optional)',
		email: 'E-Mail (optional)',
		emailNote: 'Hinterlassen Sie Ihre E-Mail-Adresse, um eine Antwort per E-Mail zu erhalten. Ohne sie sehen Sie Antworten nur, wenn Sie auf diese Seite zurückkehren.',
		cancel: 'Abbrechen',
		open: 'Nachricht senden',
		title: 'Nachricht hinterlassen',
		placeholder: 'Ihre Frage…',
		send: 'Senden',
		sending: 'Wird gesendet…',
		stored: 'Angekommen — Ihre Nachricht ist gespeichert.',
		within: (h) => `Antwort meist innerhalb von ${h} Stunden.`,
		you: 'Sie',
		them: 'Antwort',
		error: 'Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.',
		errorInboxStorageFull: "Das Postfach dieser Website ist voll und kann derzeit keine neuen Nachrichten empfangen.",
		rate: 'Das sind viele Nachrichten — bitte versuchen Sie es in einer Minute noch einmal.',
		closed: 'Schließen',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}antwortet zuerst, was Sie weitergeben, liest ein Mensch`,
		statusNoAi: 'Was Sie senden, liest ein Mensch',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}antwortet mit den Inhalten dieser Website`,
		statusHandedOffEmail: 'An eine Person weitergegeben — die Antwort kommt per E-Mail.',
		statusHandedOffNoEmail: 'An eine Person weitergegeben — die Antwort erscheint hier.',
		askAgain: (a) => `${a} noch einmal fragen`,
		newConversation: 'Neues Gespräch beginnen',
		backToHuman: 'Zurück zu Ihrem Gespräch',
		handoffEnded: 'Ihr letztes Gespräch ist beendet.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: 'Beim Tippen wird nur in Ihrem Browser gesucht. Erst mit dem Knopf wird etwas gesendet.',
		askAi: 'KI fragen',
		sendOwner: 'An eine Person senden'
	},
	fr: {
		ask: 'Une question sur ce site…',
		asking: 'Je cherche…',
		source: 'D’où cela vient',
		refused: 'Je n’ai rien à ce sujet.',
		toHuman: 'Plutôt demander à une personne',
		toHumanAfterRefusal: 'Transmettre à une personne',
		kaitoUnavailable: 'L’IA ne peut pas répondre pour le moment.',
		kaitoUnavailableToHuman: 'L’IA ne peut pas répondre pour le moment. Vous pouvez transmettre ceci à une personne.',
		sentToHuman: 'Transmis à une personne — la réponse s’affichera ici.',
		name: 'Nom (facultatif)',
		email: 'E-mail (facultatif)',
		emailNote: 'Laissez votre e-mail pour recevoir la réponse par e-mail. Sans lui, vous ne verrez les réponses qu’en revenant sur cette page.',
		cancel: 'Annuler',
		open: 'Nous écrire',
		title: 'Laisser un message',
		placeholder: 'Posez votre question…',
		send: 'Envoyer',
		sending: 'Envoi…',
		stored: 'Bien reçu — votre message est enregistré.',
		within: (h) => `Réponse habituellement sous ${h} heures.`,
		you: 'Vous',
		them: 'Réponse',
		error: 'L’envoi a échoué. Veuillez réessayer.',
		errorInboxStorageFull: "La boîte de réception de ce site est pleine et ne peut pas recevoir de nouveaux messages pour le moment.",
		rate: 'Cela fait beaucoup de messages — réessayez dans une minute.',
		closed: 'Fermer',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}répond d’abord, une personne lit ce que vous transmettez`,
		statusNoAi: 'Une personne lit ce que vous envoyez',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}répond à partir du contenu de ce site`,
		statusHandedOffEmail: 'Transmis à une personne — la réponse arrivera par e-mail.',
		statusHandedOffNoEmail: 'Transmis à une personne — la réponse s’affichera ici.',
		askAgain: (a) => `Redemander à ${a}`,
		newConversation: 'Nouvelle conversation',
		backToHuman: 'Revenir à votre conversation',
		handoffEnded: 'Votre dernière conversation est terminée.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: 'En tapant, la recherche reste dans votre navigateur. Rien n’est envoyé avant d’appuyer sur le bouton.',
		askAi: 'Demander à l’IA',
		sendOwner: 'Envoyer à une personne'
	},
	es: {
		ask: 'Pregunta sobre este sitio…',
		asking: 'Buscando…',
		source: 'De dónde sale esto',
		refused: 'No tengo nada registrado sobre eso.',
		toHuman: 'Mejor preguntar a una persona',
		toHumanAfterRefusal: 'Enviar esto a una persona',
		kaitoUnavailable: 'La IA no puede responder en este momento.',
		kaitoUnavailableToHuman: 'La IA no puede responder en este momento. Puedes enviar esto a una persona.',
		sentToHuman: 'Enviado a una persona: la respuesta aparecerá aquí.',
		name: 'Nombre (opcional)',
		email: 'Correo (opcional)',
		emailNote: 'Deja tu correo para recibir la respuesta por email. Sin él, solo verás las respuestas si vuelves a esta página.',
		cancel: 'Cancelar',
		open: 'Escríbenos',
		title: 'Deja un mensaje',
		placeholder: 'Escribe tu pregunta…',
		send: 'Enviar',
		sending: 'Enviando…',
		stored: 'Recibido: hemos guardado tu mensaje.',
		within: (h) => `Suele responder en menos de ${h} horas.`,
		you: 'Tú',
		them: 'Respuesta',
		error: 'No se ha podido enviar. Inténtalo de nuevo.',
		errorInboxStorageFull: "La bandeja de entrada de este sitio está llena y no puede recibir mensajes nuevos en este momento.",
		rate: 'Son muchos mensajes: vuelve a intentarlo en un minuto.',
		closed: 'Cerrar',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}responde primero; lo que envíes lo lee una persona`,
		statusNoAi: 'Lo que envíes lo lee una persona',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}responde con el contenido de este sitio`,
		statusHandedOffEmail: 'Enviado a una persona: la respuesta llegará por correo.',
		statusHandedOffNoEmail: 'Enviado a una persona: la respuesta aparecerá aquí.',
		askAgain: (a) => `Volver a preguntar a ${a}`,
		newConversation: 'Empezar una conversación nueva',
		backToHuman: 'Volver a tu conversación',
		handoffEnded: 'Tu última conversación ha terminado.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: 'Al escribir, solo se busca en tu navegador. No se envía nada hasta que pulses el botón.',
		askAi: 'Preguntar a la IA',
		sendOwner: 'Enviar a una persona'
	},
	'pt-br': {
		ask: 'Pergunte sobre este site…',
		asking: 'Procurando…',
		source: 'De onde vem isto',
		refused: 'Não tenho registro sobre isso.',
		toHuman: 'Prefiro perguntar a uma pessoa',
		toHumanAfterRefusal: 'Enviar para uma pessoa',
		kaitoUnavailable: 'A IA não pode responder agora.',
		kaitoUnavailableToHuman: 'A IA não pode responder agora. Você pode enviar isto para uma pessoa.',
		sentToHuman: 'Enviado para uma pessoa — a resposta vai aparecer aqui.',
		name: 'Nome (opcional)',
		email: 'E-mail (opcional)',
		emailNote: 'Deixe seu e-mail para receber a resposta por e-mail. Sem ele, você só vê as respostas voltando a esta página.',
		cancel: 'Cancelar',
		open: 'Fale conosco',
		title: 'Deixe uma mensagem',
		placeholder: 'Digite sua pergunta…',
		send: 'Enviar',
		sending: 'Enviando…',
		stored: 'Recebido — sua mensagem foi salva.',
		within: (h) => `Costuma responder em até ${h} horas.`,
		you: 'Você',
		them: 'Resposta',
		error: 'Não foi possível enviar. Tente de novo.',
		errorInboxStorageFull: "A caixa de entrada deste site está cheia e não pode receber novas mensagens no momento.",
		rate: 'São muitas mensagens — tente de novo daqui a um minuto.',
		closed: 'Fechar',
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}responde primeiro, uma pessoa lê o que você encaminhar`,
		statusNoAi: 'Uma pessoa lê o que você envia',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}responde com o conteúdo deste site`,
		statusHandedOffEmail: 'Enviado para uma pessoa — a resposta chega por e-mail.',
		statusHandedOffNoEmail: 'Enviado para uma pessoa — a resposta vai aparecer aqui.',
		askAgain: (a) => `Perguntar de novo a ${a}`,
		newConversation: 'Começar uma nova conversa',
		backToHuman: 'Voltar para a sua conversa',
		handoffEnded: 'Sua última conversa foi encerrada.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: 'Ao digitar, a busca fica só no seu navegador. Nada é enviado até você apertar o botão.',
		askAi: 'Perguntar à IA',
		sendOwner: 'Enviar para uma pessoa'
	},
	ko: {
		ask: '이 사이트에 대해 물어보세요…',
		asking: '찾아보는 중…',
		source: '이 내용의 출처',
		refused: '그 부분에 대한 기록이 없어요.',
		toHuman: '사람에게 물어볼래요',
		toHumanAfterRefusal: '사람에게 전달하기',
		kaitoUnavailable: '지금은 AI가 답할 수 없어요.',
		kaitoUnavailableToHuman: '지금은 AI가 답할 수 없어요. 사람에게 전달할 수 있어요.',
		sentToHuman: '사람에게 전달했어요. 답장은 여기에 표시돼요.',
		name: '이름 (선택)',
		email: '이메일 (선택)',
		emailNote: '이메일을 남기면 답장을 이메일로 받을 수 있어요. 남기지 않으면 이 페이지에 다시 와야만 답장을 볼 수 있어요.',
		cancel: '취소',
		open: '메시지 보내기',
		title: '메시지 남기기',
		placeholder: '궁금한 점을 적어 주세요…',
		send: '보내기',
		sending: '보내는 중…',
		stored: '받았어요. 메시지를 저장했어요.',
		within: (h) => `보통 ${h}시간 안에 답장해요.`,
		you: '나',
		them: '답장',
		error: '보내지 못했어요. 다시 시도해 주세요.',
		errorInboxStorageFull: "이 사이트의 받은편지함이 가득 차서 현재 새 메시지를 받을 수 없습니다.",
		rate: '메시지가 너무 많아요. 1분 뒤에 다시 시도해 주세요.',
		closed: '닫기',
		// No subject particle after the name: 이/가 depends on the name's last syllable, and the
		// name is owner-chosen at runtime. A label-style sentence without it reads naturally.
		statusDefault: (a) => `${a}${AI_CHIP_TOKEN}먼저 답하고, 보내면 사람이 읽어요`,
		statusNoAi: '보내면 사람이 읽어요',
		statusAiOnly: (a) => `${a}${AI_CHIP_TOKEN}이 사이트의 내용으로 답해요`,
		statusHandedOffEmail: '사람에게 전달했어요. 답장은 이메일로 와요.',
		statusHandedOffNoEmail: '사람에게 전달했어요. 답장은 여기에 표시돼요.',
		askAgain: (a) => `${a}에게 다시 묻기`,
		newConversation: '새 대화 시작하기',
		backToHuman: '대화로 돌아가기',
		handoffEnded: '지난 대화는 종료되었어요.',
		// reef#2160 in-site search (only rendered where the host names an index with rows)
		searchNote: '입력하는 동안은 브라우저 안에서만 찾아요. 버튼을 누르기 전에는 아무것도 보내지 않아요.',
		askAi: 'AI에게 묻기',
		sendOwner: '사람에게 보내기'
	}
};

/**
 * Resolve a BCP-47 `<html lang>` tag to one of this file's COPY keys.
 *
 * 🩸 The site's own `lang` attribute is not always spelled the way this
 * object's keys are. A zh-TW page can say `lang="zh-Hant-TW"` — a real,
 * common tag this file used to not recognise at all, so it silently fell
 * through to `COPY.en` and every zh-TW visitor got English (finding #5,
 * 2026-09-03 cold-read). Handled here, exhaustively, rather than leaving
 * every future locale to rediscover the same gap:
 *   - an exact key match wins first (`zh-tw`, `zh-cn`, `ja`, `en`, …)
 *   - a `hant` subtag anywhere in the tag → Traditional (`zh-tw`)
 *   - a `hans` subtag anywhere in the tag → Simplified (`zh-cn`)
 *   - a bare primary subtag `zh` (no script/region) → Traditional (`zh-tw`),
 *     REEF's own default per the owner's zh-TW-first sites
 *   - `zh-tw`/`zh-hk`/`zh-mo` region without a script subtag → Traditional
 *   - `zh-cn`/`zh-sg` region without a script subtag → Simplified
 *   - any `pt` tag (`pt`, `pt-BR`, `pt-PT`) → `pt-br`, the one Portuguese table
 *   - otherwise the bare primary subtag (`ja`, `de`, `ko`, …), then English
 */
export function resolveLocale(lang) {
	const declared = String(lang || 'en').toLowerCase();
	if (COPY[declared]) return declared;
	const parts = declared.split('-').filter(Boolean);
	const primary = parts[0] || '';
	if (primary === 'zh') {
		if (parts.includes('hant')) return 'zh-tw';
		if (parts.includes('hans')) return 'zh-cn';
		if (parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) return 'zh-tw';
		if (parts.includes('cn') || parts.includes('sg')) return 'zh-cn';
		return 'zh-tw';
	}
	// Portuguese has one table, Brazilian (the one the platform ships). A pt-PT page reads it far
	// more comfortably than it reads English, so every `pt-*` tag lands there.
	if (primary === 'pt') return 'pt-br';
	return COPY[primary] ? primary : 'en';
}

function copyFor(el) {
	const declared = document.documentElement.getAttribute('lang') || 'en';
	const base = COPY[resolveLocale(declared)];
	const attr = (name, fallback) => el.getAttribute(`data-${name}`) || fallback;
	return {
		...base,
		open: attr('open-label', base.open),
		title: attr('title', base.title),
		placeholder: attr('placeholder', base.placeholder),
		send: attr('send-label', base.send),
		// tile#20. Only the no-KAITO line is overridable: `statusFor` never reads it when KAITO is
		// on, so no attribute can take the AI chip off the panel.
		statusNoAi: resolveStatusText(el) || base.statusNoAi
	};
}

// ── the handle this browser keeps ───────────────────────────────────────────

function storeKey(tenant) {
	return STORE_PREFIX + tenant;
}

/**
 * Returns `{ conv, hasEmail, mode }`, or `null` when there is no live handle.
 *
 * `mode` is this browser's last CHOSEN view — `'human'` (default, and every
 * handle written before 2026-09-04 reads as this) or `'ask'`, meaning the
 * visitor pressed "ask KAITO again" / "start a new conversation" and the panel
 * should open fresh rather than jump straight to the old thread. It is a
 * preference, not the source of truth for whether a thread EXISTS — `conv`
 * still is, which is why "回到真人對話" keeps working after a reset (bug
 * report 2026-09-04: hand-off used to be a one-way door with no way back to
 * asking KAITO or starting over).
 */
/**
 * Is `raw` a well-formed handle — the shape `saveHandle` writes, read back out of this browser's
 * own storage by `JSON.parse`. Pure and exported because storage is a place OTHER code writes
 * (reef's own `/report` form writes this exact shape before navigating the visitor to a page the
 * coral mounts on), so「well-formed」has to be one decision this file can state and test, and a
 * malformed entry has to be provably ignored rather than thrown.
 */
export function parseHandle(raw) {
	// 🔴 `Number.isFinite`, not `typeof raw.ts === 'number'` — `typeof NaN` is 'number', and a NaN
	// timestamp passes every comparison a TTL check can make (`now - NaN > TTL` is false), so the
	// old shape test let through the one value that makes an expiry test silently answer「fresh」.
	if (!raw || typeof raw !== 'object' || typeof raw.conv !== 'string' || !Number.isFinite(raw.ts)) return null;
	// `ts` is CARRIED OUT, not dropped (review B6). The reader has to answer 「how old is this
	// handle」 without reaching past this function into the raw JSON to find out.
	return { conv: raw.conv, ts: raw.ts, hasEmail: raw.hasEmail === true, mode: raw.mode === 'ask' ? 'ask' : 'human' };
}

// 🔴 THE THIRTY DAYS ARE COUNTED FROM THE `ts` IN THE STORED VALUE, which is to say from a
// timestamp chosen by whoever wrote that key (review B3, round 3 — the header says the same). The
// handles THIS file writes are stamped `Date.now()` by `saveHandle` and nothing else, but anything
// same-origin can write the key, and a `ts` in the future never satisfies the `>` below at all.
// That is a property of the storage intake, not a check this function can make: the value is not
// signed and there is nothing here to check it against.
function loadHandle(tenant) {
	let raw;
	try {
		raw = window.localStorage.getItem(storeKey(tenant));
	} catch {
		return null; // storage disabled — the bubble still works, just forgetfully
	}
	if (!raw) return null;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const handle = parseHandle(parsed);
	if (!handle) return null;
	if (Date.now() - handle.ts > HANDLE_TTL_MS) {
		try {
			window.localStorage.removeItem(storeKey(tenant));
		} catch {
			/* nothing to do; the check above already treats it as absent */
		}
		return null;
	}
	return handle;
}

// 🔴 `ts` IS `Date.now()` AND NOTHING ELSE MAY SUPPLY IT (review B6). Every caller is a visitor's
// own action in this panel — they just used the thread, so the thirty days may start again. The
// fifth parameter that let a value from elsewhere be written here existed for the hand-off event,
// and went with it (B3, round 2): a TTL counted from a timestamp somebody else chose is not a TTL.
function saveHandle(tenant, conv, hasEmail, mode = 'human') {
	try {
		window.localStorage.setItem(
			storeKey(tenant),
			JSON.stringify({ conv, ts: Date.now(), hasEmail: !!hasEmail, mode: mode === 'ask' ? 'ask' : 'human' })
		);
	} catch {
		// Storage disabled or full. The message is already stored on OUR side —
		// this browser just will not be able to follow the thread. Silently
		// degrading is right: the visitor's question was received.
	}
}

// ── what the visitor asked the machine, kept here until they leave ──────────
//
// Owner ruling 54 (2026-09-07, reef `docs/SPEC-inbox-bubble-position.md` §三):
//「訪客問的每一句真人都看得到，AI 只是先服務不必等」. The owner sees the questions; the
// machine's answers are still never sent anywhere (§5, and the file header above).
//
// 🔴 DEFERRED WRITE, NOT A PING PER QUESTION. The obvious shape — POST each question as
// it is asked — is the shape this coral exists not to be: it turns a browsing visitor
// into a request stream, and it makes the owner's own inbox the busiest thing on their
// site. So the questions live HERE, in this browser, in the same storage the handle
// lives in, and leave on the way out: on `pagehide` as a beacon, or the moment the visitor
// presses for a person, whichever comes first.
//
// 🔴 ONCE PER `pagehide`, AND ONLY WITH SOMETHING NEW — not once per session. A visitor who
// asks again on a second page sends the same `session_id` a second time, carrying the whole
// session, which is why the endpoint is idempotent on that id (contract §一.2) and why the
// README and the manifest may not say「once per session」(review D9).
//
// 🔴 AND ONLY WHEN THE SITE HAS AN INBOX. A KAITO-only tenant — somebody who bought the
// ask-the-site half and nothing else — writes nothing, ever. That is not a quota, it is
// whose data this is: the questions are addressed to a person, and a site with no inbox
// has no person to address them to.

/** Longest single question kept. Beyond this it is prose, and the row is not a transcript. */
export const AI_LOG_MAX_TEXT = 500;
/** Most questions carried in one session row. When full the OLDEST go — see `capAiQuestions`. */
export const AI_LOG_MAX_QUESTIONS = 20;
/** Most pages named in one session row's page sequence. */
export const AI_LOG_MAX_PAGES = 40;
/** Longest path or locale tag kept, so neither can be used to pad a row. */
export const AI_LOG_MAX_FIELD = 200;
/**
 * Longest conversation id kept — the same length the contract gives `session_id`.
 *
 * 🩸 THE FIELD D5's KNIFE MISSED (review E2). `session_id` was sliced twice and `page` four times,
 * and `handle` — the only other opaque id on this row — went from storage to the wire with a
 * `typeof` check and nothing else. Under D5's own threat model (a same-origin script writes this
 * browser's cell) the review planted 200,000 characters there and measured a 200,189-octet body:
 * three times what the beacon carries, while the README said caps were applied on the way in.
 * Both ids are minted elsewhere and are opaque here, so they are bounded by the same number.
 */
export const AI_LOG_MAX_HANDLE = 64;
/**
 * What the transport will actually carry, in OCTETS: `sendBeacon` and `fetch(keepalive)` are
 * both budgeted at ~64 KiB per origin, and a body over it is refused rather than truncated.
 */
export const AI_LOG_MAX_WIRE_BYTES = 64 * 1024;
/**
 * The page sequence's share of that budget, in octets.
 *
 * 🩸 THE ONE FIELD WITH NO LENGTH LIMIT AT ALL (review D5) — `AI_LOG_MAX_PAGES` bounded how many
 * pages, never how long each one was, while the constant beside it promised「so neither can be
 * used to pad a row」. Forty paths at the 200-character cap in Chinese is 24 KiB, and the
 * questions may already be 46; together they are the review's 70,403 bytes, which is over what
 * the beacon carries. This is what the page sequence gets, and the oldest pages go first.
 */
export const AI_LOG_MAX_PAGE_BYTES = 12 * 1024;
/**
 * How long a session may sit idle before the next page view is a NEW session.
 *
 * 🔴 A SESSION IS NOT A PAGE. On a static site every navigation is a fresh document and a
 * fresh `mount()`, so a buffer scoped to one document would make「一列一個 session」mean
 *「一列一頁」— and the page SEQUENCE, which is the whole point of the row, would never have
 * more than one entry in it. The buffer therefore lives in `localStorage` (the same place
 * the handle lives, per the ruling) and this is what ends the session instead.
 */
export const AI_LOG_IDLE_MS = 30 * 60 * 1000;
/** How long this browser trusts a DEFINITE claim-state answer before asking again. */
export const AI_LOG_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * How long it waits after a probe that answered「we do not know」.
 *
 * 🔴 NOT THE TTL, BECAUSE NOTHING WAS LEARNED. A failure — no network, an unreadable shape, or
 * the contract's own `throttled` — must not be cached as an answer; but it must not be free
 * either, or every question re-asks (review D8 measured eight probes for eight questions against
 * a manifest that promises at most one per six hours). So it is bounded here instead: one probe
 * per five minutes per browser until somebody actually answers.
 */
export const AI_LOG_CLAIM_RETRY_MS = 5 * 60 * 1000;
const AI_LOG_PREFIX = 'reef-inbox:ai:';

/** The buffer's own key — beside the handle's (`reef-inbox:<tenant>`), never inside it. */
export function aiLogKey(tenant) {
	return AI_LOG_PREFIX + tenant;
}

/** One line of text, bounded, with the control characters a row is not allowed to carry. */
function aiLine(raw, max) {
	if (typeof raw !== 'string') return '';
	return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * How many UTF-8 octets a string costs — the unit the transport and the server both count in.
 *
 * 🩸 TWO NUMBERS IN DIFFERENT COORDINATE SYSTEMS (review D4). Every cap above is applied with
 * `String.prototype.slice`, which counts UTF-16 characters, while `sendBeacon`'s ~64 KiB budget
 * counts octets — and one CJK character is three of them. So a row measured at「20 × 500」can
 * reach the transport at three times the size it was capped to: the review's worst profile came
 * to 70,403 bytes, and a beacon that big is refused. Nothing in this file had ever counted the
 * other unit.
 *
 * Spelled out rather than `new TextEncoder()`: this runs inside a `pagehide` handler, where a
 * global that may not exist is not worth a try/catch for arithmetic this small.
 *
 * 🩸 A HIGH SURROGATE IS NOT A PAIR JUST BECAUSE SOMETHING FOLLOWS IT (review E6). The old test
 * was `i + 1 < s.length`, so `'\ud800嗎'` was counted as one four-octet character and the 嗎 was
 * swallowed: 4 where the real encoding is 6. The specimen that passed was a lone surrogate at the
 * END of the string — the one position where that test is false. It is not a live budget defect
 * (what is measured is `JSON.stringify`'s output, which escapes a lone surrogate to six ASCII
 * characters, so the hot path never meets one) but this function is exported and says it counts
 * octets, so it counts them.
 */
export function utf8Bytes(text) {
	const s = typeof text === 'string' ? text : '';
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		const next = s.charCodeAt(i + 1); // NaN past the end, and NaN fails every comparison below
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { n += 4; i++; }
		// An unpaired surrogate — high or low — is what a UTF-8 encoder makes of it: the
		// three-octet replacement character, which is also what `TextEncoder` produces.
		else n += 3;
	}
	return n;
}

/**
 * 🔴 THE PATH, NEVER THE QUERY STRING. A page is `/pricing`; `?token=…&email=…` is whatever
 * the site put in its own links, and a row that carries it is a row holding somebody's
 * credentials because they happened to ask a question on the page they landed on.
 */
export function aiPagePath(href) {
	// 🔴 The non-string cases have to be refused BEFORE `new URL`, not caught after it: `new URL`
	// stringifies its first argument, so `undefined` resolves — quietly — to the page `/undefined`.
	if (typeof href !== 'string') return '/';
	try {
		return aiLine(new URL(href, 'https://x.invalid').pathname, AI_LOG_MAX_FIELD) || '/';
	} catch {
		return '/';
	}
}

/**
 * A hit is a URL, and that is what keeps the machine's answer off the wire BY SHAPE.
 *
 * 🔴 THE ONE FIELD ON THIS ROW THAT COULD EVER CARRY THE ANSWER. `text` is the visitor's own
 * sentence and `page` is a path; `hit` is the only slot where a caller could hand us the
 * machine's words by passing the wrong property of the same object — and review D3 measured
 * exactly that: swapping `answer.source_url` for `answer.text` at the one call site left all
 * hundred tests green. Prose is not a URL, so it lands here as `null` instead of on the wire.
 * The rule is enforced by the value's own shape rather than by everyone who ever calls
 * `question()` remembering it, which is what「cannot become an argument」has to mean.
 */
function aiHit(raw) {
	if (typeof raw !== 'string') return null;
	const url = aiLine(raw, AI_LOG_MAX_FIELD);
	return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/**
 * The conversation id, admitted by SHAPE and bounded in length like every other outbound field.
 *
 * 🔴 THE SHAPE `saveHandle` WRITES, AND NOTHING ELSE: a non-empty single-line string, capped. An
 * id the server minted is all of those; the 200,000-character value the review planted in this
 * browser's own cell is none of them past the cap, and one that is empty or is not a string at
 * all is DROPPED rather than sent as `""` — `handle` is the optional sixth key of the body, and
 * an absent one is the truthful way to say this session never reached a person.
 */
export function aiHandle(raw) {
	if (typeof raw !== 'string') return null;
	return aiLine(raw, AI_LOG_MAX_HANDLE) || null;
}

/**
 * The whitelist a question row is BUILT FROM — never a filter applied to something richer.
 *
 * 🔴 EVERY FIELD ON THE WIRE IS NAMED HERE, and a field that is not named here cannot get
 * there: the row is assembled by walking these keys, so「the log grew a field」and「the wire
 * grew a field」are no longer the same event. Contract §一.2 names the same five, and
 * `compose.test.mjs` asserts this list against that one — a sixth key added to the buffer,
 * to a transcript object, or to `question()`'s arguments turns those tests red rather than
 * turning up in somebody's Inbox.
 */
const AI_QUESTION_READERS = {
	text: (q) => aiLine(q.text, AI_LOG_MAX_TEXT),
	page: (q) => aiLine(q.page, AI_LOG_MAX_FIELD) || '/',
	hit: (q) => aiHit(q.hit),
	lang: (q) => aiLine(q.lang, 16),
	at: (q) => (Number.isFinite(q.at) ? q.at : 0)
};
/** The five fields of a question row, in contract order. */
export const AI_QUESTION_FIELDS = Object.keys(AI_QUESTION_READERS);
/** The six keys of the wire body — `handle` only when this session reached a person. */
export const AI_SESSION_FIELDS = ['kind', 'id', 'session_id', 'pages', 'questions', 'handle'];

/**
 * The size cap, applied where a hostile client cannot skip it — on the way IN, every time.
 *
 * 🔴 THE OLDEST GO, not the newest refused. The row is a session read back in order; a
 * visitor whose twenty-first question is the one they escalated on would otherwise have
 * that question silently dropped while twenty older ones stayed.
 */
export function capAiQuestions(list) {
	return (Array.isArray(list) ? list : []).slice(-AI_LOG_MAX_QUESTIONS).map((q) => {
		const src = q && typeof q === 'object' ? q : {};
		const row = {};
		for (const field of AI_QUESTION_FIELDS) row[field] = AI_QUESTION_READERS[field](src);
		return row;
	});
}

/**
 * Drop the OLDEST rows until the array's own JSON fits a budget of octets — the same posture as
 * every other cap here, and never down to nothing: one row, whatever it costs, still goes.
 */
function capBytes(rows, budget) {
	const sizes = rows.map((row) => utf8Bytes(JSON.stringify(row)));
	let total = sizes.reduce((n, size) => n + size + 1, 1); // the commas, and the two brackets
	let cut = 0;
	while (cut < rows.length - 1 && total > budget) total -= sizes[cut++] + 1;
	return cut ? rows.slice(cut) : rows;
}

/**
 * The page sequence, bounded the way `AI_LOG_MAX_FIELD`'s own comment says it is.
 *
 * 🩸 IT WAS BOUNDED IN COUNT ONLY (review D5). `questions[].page` went through `aiLine`, and the
 * identical value in `pages[]` did not — nothing between `localStorage` and the wire ever looked
 * at how long one of these strings was, so a 50,001-character「path」planted in this browser's own
 * cell arrived at the endpoint whole. reef truncates it on the other side, which is why this was
 * a missing layer rather than a hole; the layer is here now, where the README says it is.
 */
export function capAiPages(list) {
	const rows = (Array.isArray(list) ? list : [])
		.filter((p) => typeof p === 'string')
		.map((p) => aiLine(p, AI_LOG_MAX_FIELD) || '/')
		.slice(-AI_LOG_MAX_PAGES);
	return capBytes(rows, AI_LOG_MAX_PAGE_BYTES);
}

/** Consecutive duplicates collapse — a reload is not a second page. */
export function appendAiPage(pages, page) {
	const rows = capAiPages(pages);
	const row = aiLine(page, AI_LOG_MAX_FIELD) || '/';
	if (rows[rows.length - 1] === row) return rows;
	return capAiPages([...rows, row]);
}

/**
 * Read a buffer back out of this browser's own storage.
 *
 * Same posture as `parseHandle`: storage is a place other code can write, so「well-formed」
 * is one decision stated once and a malformed entry is provably ignored rather than thrown.
 */
export function parseAiLog(raw) {
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.sid !== 'string' || !raw.sid) return null;
	if (!Number.isFinite(raw.started) || !Number.isFinite(raw.last)) return null;
	const questions = capAiQuestions(raw.questions);
	return {
		sid: raw.sid.slice(0, 64),
		started: raw.started,
		last: raw.last,
		pages: capAiPages(raw.pages),
		questions,
		// 🔴 CLAMPED TO WHAT IS ACTUALLY HERE. A `sent` that outran the buffer — a value
		// somebody hand-wrote, or a cap that dropped an already-counted question — would
		// permanently convince this browser it had nothing left to flush.
		sent: Number.isFinite(raw.sent) ? Math.max(0, Math.min(raw.sent, questions.length)) : 0,
		handle: aiHandle(raw.handle),
		claim: raw.claim === true || raw.claim === false ? raw.claim : null,
		// 🔴 WHEN WE LEARNED, and separately WHEN WE LAST ASKED (review E1). Both are persisted
		// because a static site's every navigation is a new document: a backoff kept in a variable
		// is a backoff that resets on the next page, and an answer's age kept in a variable is an
		// answer that is never old. Neither is on the wire — `aiSessionPayload` is a whitelist.
		claimAt: Number.isFinite(raw.claimAt) ? raw.claimAt : 0,
		probedAt: Number.isFinite(raw.probedAt) ? raw.probedAt : 0
	};
}

/**
 * The wire body — see reef `docs/SPEC-inbox-bubble-position.md` §三 and the endpoint's header.
 *
 * 🔴 ASSEMBLED FROM NAMED FIELDS, NEVER SPREAD FROM THE BUFFER. `{ ...state }` would put
 * whatever the log happens to hold — today `claim`, `claimAt`, `sent`, `started` — on the
 * wire the day somebody adds a field, and the review's mutation of exactly that shape
 * (M20) left every test green. `AI_SESSION_FIELDS` is the list, and it is asserted against
 * the bytes a real `mount()` sends, not against this literal.
 */
export function aiSessionPayload(kind, id, state) {
	const held = state && typeof state === 'object' ? state : {};
	const body = {
		kind,
		id,
		session_id: typeof held.sid === 'string' ? held.sid.slice(0, 64) : '',
		pages: capAiPages(held.pages),
		questions: capAiQuestions(held.questions)
	};
	// The same gate as on the way in, for the same reason `pages` has one at both doors: this
	// function is handed a state object, and the door it was read through is not this one's to
	// assume (review E2).
	const handle = aiHandle(held.handle);
	if (handle) body.handle = handle;
	return body;
}

/**
 * Hand one payload to the network in a way that survives the page going away.
 *
 * 🔴 `sendBeacon` FIRST, and with the JSON **string**, not a `Blob`. Measured on Safari 26
 * (CVERInc/reef#466, 2026-09-07): a `Blob` typed `application/json` makes this a CORS request
 * that needs a preflight, and what was observed is the OUTCOME — the beacon reports `true` and
 * nothing reaches the server. Whether WebKit skips the preflight for a beacon or starts one that
 * loses to the document's unload is not something that measurement can tell apart, and it does
 * not matter here: the fix is to keep the body a CORS *simple* request, not to flush earlier.
 * A bare string beacon is sent as `text/plain;charset=UTF-8`, which is simple, so no preflight
 * is involved — and in the same measurement it was delivered. The endpoint's Content-Type
 * whitelist is exactly `application/json` and `text/plain` (media type before `;`, trimmed,
 * case-insensitive; anything else is `400 invalid_body` — so a Blob with NO type, which carries
 * no Content-Type at all, would be refused). That whitelist has held `text/plain` since reef
 * ship-132 (2026-09-07); what did not change on the server is the body check — still parsed as
 * strict JSON through the same field whitelist, so `text/plain` is a different label, not a
 * laxer check.
 * 0.7.6 did not fail at a gate: its JSON-Blob beacon simply never left Safari. The gate that
 * matters is the one the STRING beacon then ran into — SvelteKit's pre-route CSRF check treats
 * `text/plain` as a form content type and refused it until reef relocated that check into a hook
 * exempting only `/api/inbox/session` (reef#466 R1-01). That relocation is what this transport
 * depends on; if it ever comes back in front of the route, the string beacon dies the same way.
 * `fetch(..., { keepalive: true })` is what a browser without `sendBeacon` gets, what a
 * REFUSED beacon falls through to (D4), and what a caller asking to be told the outcome gets
 * — and it is second rather than first because a `pagehide` handler's ordinary `fetch` is
 * cancelled with the document.
 *
 * 🔴 THE ANSWER COMES IN ONE OF THE TWO TENSES A BROWSER HAS, and the caller has to read
 * which one it got (review D1):
 *
 * - `false` — REFUSED. Nothing was sent and nothing will be; the buffer must survive.
 * - `true` — QUEUED, and that is everything a beacon can ever say. `sendBeacon` hands the
 *   request to the browser and the document is gone before any response exists.
 * - a `Promise<boolean>` — the fetch path, which resolves to whether the SERVER took it
 *   (a 2xx, including the idempotent replay of one). A caller that can still act — the
 *   escalation press, a bfcache restore — waits for that instead of assuming.
 *
 * `opts.confirm` asks for the third of those on purpose: the press for a person happens with
 * the document alive, so it can afford one round trip to learn what a `pagehide` never can.
 */
export function sendAiSession(url, body, env = {}, opts = {}) {
	// 🔴 `in`, NOT `??`. An injected `null` means「this world has no such thing」and `??` would
	// fall straight through to the real global — so a test asserting「no transport sends nothing」
	// would have been sending through the browser's own fetch and reading it as a pass.
	const pick = (name, real) => (name in env ? env[name] : real);
	const nav = pick('navigator', typeof navigator === 'undefined' ? null : navigator);
	const json = JSON.stringify(body);
	// 🔴 THE BUDGET IS MEASURED, NOT ASSUMED. A body over the beacon's ~64 KiB is refused by the
	// browser, so it goes to the fetch instead — the path that can say what happened, and whose
	//「no」leaves the questions in this browser rather than throwing them away (D1). The caps in
	// `capAiQuestions`/`capAiPages` are what keep an ordinary session from ever reaching this.
	const overBudget = utf8Bytes(json) > AI_LOG_MAX_WIRE_BYTES;
	if (!opts.confirm && !overBudget) {
		try {
			if (nav && typeof nav.sendBeacon === 'function') {
				// 🔴 `false` FALLS THROUGH TO THE FETCH, it does not return (review D4). The spec's
				// answer to「over the beacon quota」is a `false` return, not a throw — so returning it
				// here meant the fallback below covered the one case that hardly happens and missed
				// the exact case its own comment was written for.
				if (nav.sendBeacon(url, json) === true) {
					return true;
				}
			}
		} catch {
			// A beacon that throws (a browser that counts it against a quota, say) falls through
			// to the fetch below rather than losing the session.
		}
	}
	const f = pick('fetch', typeof fetch === 'undefined' ? null : fetch);
	if (!f) return false;
	try {
		return f(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: json,
			keepalive: true
		}).then((res) => !!res && res.ok === true, () => false);
	} catch {
		return false;
	}
}

/**
 * The buffer itself, as a thing that can be tested without a DOM.
 *
 * Every side effect it has is an injected function — storage, the clock, the id source, the
 * transport, the claim probe — because the behaviour worth pinning here (the caps, flush-once,
 * never-when-unclaimed, escalation clears) is arithmetic, and arithmetic that can only be
 * exercised through a browser is arithmetic nobody exercises.
 */
export function createAiLog(opts) {
	const {
		tenant,
		kind,
		id,
		storage,
		now = () => Date.now(),
		newId,
		send,
		probeClaim,
		enabled = true
	} = opts;
	const key = aiLogKey(tenant);

	/**
	 * Storage took a write and then refused a later one — a full quota, not a disabled store.
	 *
	 * 🩸 THE HALF-WRITTEN CASE IS THE BAD ONE (review D7). `write()` swallowed the failure and
	 * said so in a comment:「this browser just will not be able to tell the owner about them」.
	 * That was not what happened. Every method re-reads storage, so what came back after a failed
	 * write was the state from BEFORE the newest question — three questions asked, one recorded,
	 * and the owner shown a visitor who asked once, which looks exactly like a visitor who did.
	 * A quiet PARTIAL record is worse than none. So a store that stops accepting writes stops
	 * being read as well: the session continues in memory, bounded by the same caps as ever, and
	 * what it cannot do is outlive this document or be seen by another tab — which is the thing
	 * the comment should have said all along.
	 */
	let readOnly = false;
	function read() {
		if (!storage || readOnly) return null;
		try {
			const raw = storage.getItem(key);
			return raw ? parseAiLog(JSON.parse(raw)) : null;
		} catch {
			return null;
		}
	}
	function write(state) {
		if (!storage) return;
		try {
			storage.setItem(key, JSON.stringify(state));
			readOnly = false;
		} catch {
			readOnly = true;
		}
	}
	function fresh(at, carry) {
		return {
			sid: newId(),
			started: at,
			last: at,
			pages: [],
			questions: [],
			sent: 0,
			handle: null,
			// 🔴 THE CLAIM ANSWER OUTLIVES THE SESSION, deliberately. It is a fact about the
			// SITE, not about this visit, so a second session ten minutes later must not cost
			// another probe — and a `false` must not be forgotten, since forgetting it is how a
			// KAITO-only tenant starts receiving requests again.
			claim: carry ? carry.claim : null,
			claimAt: carry ? carry.claimAt : 0,
			// The backoff outlives the session for the same reason the answer does: it says how
			// recently this browser bothered the endpoint, which is not a fact about this visit.
			probedAt: carry ? carry.probedAt : 0
		};
	}
	let state = null;
	let probing = false;

	/**
	 * Put back what a send turned out not to have delivered.
	 *
	 * 🔴 ONLY IF IT IS STILL THE SAME SESSION. A late「no」about `sid-1` must not lower the sent
	 * mark of `sid-2` — the questions it is talking about are not in this buffer any more, and
	 * re-sending a session that already went is what the server's idempotency is for anyway.
	 */
	function unsend(sid, sent) {
		const held = read() ?? state;
		if (!held || held.sid !== sid) return;
		held.sent = Math.min(held.sent, sent);
		state = held;
		write(state);
	}

	/**
	 * The live session, starting a new one when the old one has gone cold.
	 *
	 * 🩸 `read() ?? state`, NOT `read()` ALONE. Storage is re-read on every call so a second tab
	 * cannot drift, and it is the source of truth the moment there IS one — but a session that
	 * has been minted and not yet written (this coral mints one at mount and writes at the first
	 * `page()`) is not in storage yet, and treating that as「no session」made every mount mint an
	 * id, throw it away and mint a second one. The symptom was not an error: it was a page
	 * sequence that reset itself, i.e. exactly the thing the row exists to record.
	 */
	function current(at) {
		const held = read() ?? state;
		if (!held) return fresh(at, null);
		if (at - held.last > AI_LOG_IDLE_MS) return fresh(at, held);
		return held;
	}

	if (enabled) state = current(now());

	/**
	 * 🔴 AN UNCLAIMED ANSWER DROPS WHAT IS ALREADY HELD, rather than merely refusing to send it.
	 * Keeping a KAITO-only site's visitors' questions in their browsers against the day somebody
	 * claims the inbox would make the claim retroactive, and nobody asked those questions of a
	 * person.
	 */
	function dropBuffer(held) {
		held.questions = [];
		held.pages = [];
		held.sent = 0;
	}

	/**
	 * Whether「this site has no Inbox」is still in force.
	 *
	 * 🔴 AN EXPIRED NO IS NOT A NO. Past the TTL the answer is due to be asked again, and until
	 * somebody answers it this browser is in the same「we do not know」state as a throttled probe
	 * (review D2) — so the questions asked in that window are HELD, not dropped, and the next
	 * answer decides what becomes of them.
	 *
	 * The age is measured from `claimAt`, which is stamped by an ANSWER and by nothing else
	 * (review E1) — otherwise the expiry this guards is one a failed probe keeps postponing.
	 */
	function unclaimedStands() {
		return !!state && state.claim === false && now() - state.claimAt < AI_LOG_CLAIM_TTL_MS;
	}

	/**
	 * Ask whether this tenant has an inbox at all — once per TTL for an answer, once per the
	 * shorter backoff for a non-answer.
	 *
	 * 🩸 THE TWO ARE NOT THE SAME EVENT (review D2/D8). The old gate cached whatever came back
	 * for six hours and, when nothing came back, re-asked on every single question. `claimed`
	 * false is a fact about the site and is worth six hours; a throttle, a dropped connection or
	 * a shape we could not read is worth a retry and nothing else — it may never be written down
	 * as a no, because a no here also empties this visitor's buffer.
	 *
	 * 🩸 AND「WHEN WE ASKED」IS NOT「WHEN WE LEARNED」(review E1). D2 stamped `claimAt` on every
	 * reply so the backoff had something to measure from, and D10 read `claimAt` to decide how old
	 * the cached answer was — so a throttled probe, which brings back NOTHING, re-dated the answer
	 * it failed to refresh. A site whose owner opened the Inbox after a `false` never saw that
	 * `false` expire: the review ran seventy-two hours of hourly questions past it and watched
	 * sixty of them destroyed, with every test green. Two quantities, two fields, two gates.
	 */
	function ensureClaim() {
		if (!state || probing || !probeClaim) return;
		// 🩸 EVERY TIME, NOT ONLY WHEN THE ANSWER ARRIVES (review D10). The first `false` emptied
		// the buffer and then the six-hour cache took the early return below, so every question
		// asked in those six hours went on accumulating in this visitor's browser — never sent,
		// but HELD, which is the one thing the README promises does not happen to a site with no
		// Inbox. Nothing left, so nothing broke; it was just untrue.
		if (unclaimedStands() && (state.questions.length || state.pages.length)) {
			dropBuffer(state);
			write(state);
		}
		// An answer we still hold is not due to be asked again — six hours from the moment we
		// LEARNED it, never from the last time somebody failed to tell us.
		if (state.claim !== null && state.claimAt && now() - state.claimAt < AI_LOG_CLAIM_TTL_MS) return;
		// And whatever the state of the answer, a probe costs one request per backoff and no more.
		if (state.probedAt && now() - state.probedAt < AI_LOG_CLAIM_RETRY_MS) return;
		probing = true;
		const settle = (claimed) => {
			probing = false;
			if (!state) return;
			// Every reply costs one probe and no more, including「we do not know」— that is what
			// the backoff is measured from, and what the manifest's sentence was untrue about.
			state.probedAt = now();
			// 🔴 ONLY AN ANSWER RE-DATES THE ANSWER (review E1). A throttled probe learned nothing,
			// so the six hours go on running from the reply that did.
			if (typeof claimed === 'boolean') {
				state.claimAt = now();
				state.claim = claimed;
				if (!claimed) dropBuffer(state);
			}
			write(state);
		};
		void Promise.resolve()
			.then(() => probeClaim())
			.then(settle)
			.catch(() => settle(null));
	}

	return {
		/** Whether this mount is logging at all — `data-ai-log="0"` turns everything below off. */
		enabled: () => !!state,
		/** Whether a definite「this site has no Inbox」is in force — the funnel reads it (reef#422). */
		unclaimed: () => unclaimedStands(),
		/** For tests and for the mount's own reads. Never a live reference. */
		state: () => (state ? JSON.parse(JSON.stringify(state)) : null),

		/** This page view, recorded at mount. Costs no request and reaches no network. */
		page(path) {
			if (!state) return;
			const at = now();
			state = current(at);
			state.last = at;
			// 🔴 A SITE WITH NO INBOX ACCUMULATES NOTHING — not the questions (see `ensureClaim`)
			// and not the page sequence either. The answer is already known here, so this costs
			// no request; what it stops is the buffer quietly refilling between questions.
			if (unclaimedStands()) dropBuffer(state);
			else state.pages = appendAiPage(state.pages, path);
			write(state);
		},

		/**
		 * One question, asked and answered by the machine.
		 *
		 * 🔴 THE ANSWER IS NOT AN ARGUMENT HERE and cannot become one. What travels is the
		 * question, the page, whether a passage was cited (and which), the language and the
		 * time — the same line `kaito_exchanges` already holds on the server. `hit` is the
		 * only argument that could hold the answer instead, and `aiHit` refuses anything
		 * that is not an http(s) URL, so passing `answer.text` here sends `null`.
		 */
		question(text, page, hit, lang) {
			if (!state) return;
			const at = now();
			state = current(at);
			const merged = [...state.questions, { text, page, hit: hit || null, lang, at }];
			const capped = capAiQuestions(merged);
			// 🔴 `sent` COUNTS FROM THE FRONT, so when the cap drops the oldest it has to come
			// down by exactly as many. Clamping it to the new LENGTH instead — which is what the
			// first draft did — makes a 21st question look already-flushed the moment the buffer
			// is full, i.e. the one shape where a hostile client and an ordinary chatty visitor
			// both silently lose the question they actually escalated on.
			const dropped = merged.length - capped.length;
			state.questions = capped;
			state.sent = Math.max(0, state.sent - dropped);
			state.last = at;
			write(state);
			ensureClaim();
		},

		/**
		 * Send what is unsent, or nothing.
		 *
		 * Returns the payload that went, or `null` — which is the ordinary case, and the
		 * reason the second `pagehide` of a page view costs nothing.
		 *
		 * 🔴 WHAT ENDS A RETRY, SPELLED OUT (review E4), because the contract delta named the wrong
		 * thing and reef would have implemented that one: a tenant whose endpoint keeps saying no
		 * is retried on EVERY `pagehide` that has something unsent, and what stops it is a 2xx or
		 * the thirty-minute idle rotation in `page()` — which ends the session and takes the unsent
		 * questions with it. The claim cache takes no part in that decision: the gate below reads
		 * `claim`, never its age, and `ensureClaim()` is reached from `question()` alone, so a
		 * visitor who has stopped asking and is only browsing never probes again at all.
		 */
		flush() {
			if (!state || !send) return null;
			// 🩸 THE ONE METHOD THAT DID NOT RE-READ ITS OWN STORAGE — and the only one that puts
			// anything on the network (review D6). `page()`, `question()` and `escalated()` all
			// begin at `current(at)`; this one used a `state` frozen at the mount of ITS tab, so a
			// visitor with two tabs open sent, from the second one, a SHORTER body under the same
			// `session_id` — and whether that truncates the row is decided on the far side of a
			// boundary this file cannot see. It knew there was fresher state and sent the older.
			//
			// 🔴 THE SAME SESSION ONLY, NOT `current()`. `current()` would rotate a session that
			// has gone idle and take the unsent questions with it; what is wanted here is the
			// freshest copy of the session this tab is holding, never a decision about whether
			// that session is over.
			const held = read();
			if (held && held.sid === state.sid) state = held;
			// 🔴 UNKNOWN IS NOT PERMISSION. A probe that never came back leaves `claim` null,
			// and null must behave exactly like `false` here: the questions stay in this
			// browser and go on the next page view, once we actually know.
			if (state.claim !== true) return null;
			if (state.questions.length <= state.sent) return null;
			const payload = aiSessionPayload(kind, id, state);
			const outcome = send(payload);
			// A refusal is not a send: nothing moves, and the next `pagehide` tries again.
			if (!outcome) return null;
			const sid = state.sid;
			const before = state.sent;
			state.sent = state.questions.length;
			write(state);
			if (typeof outcome.then === 'function') {
				// 🔴 QUEUED NOW, UNSENT IF THE SERVER SAYS NO. The fetch path can still be answered
				// while this document is alive (a bfcache restore, an escalation on the same page),
				// and a definite no has to put the questions back rather than leave them marked told.
				// A `pagehide` that really is the end of the document never sees this — which is
				// exactly why the server side is idempotent on `session_id`.
				void outcome.then((ok) => { if (ok !== true) unsend(sid, before); }, () => unsend(sid, before));
			}
			return payload;
		},

		/**
		 * The visitor pressed for a person, and the server minted a conversation.
		 *
		 * 🔴 THE PRESS PROVES THE CLAIM. A conversation id only exists because `/api/inbox`
		 * accepted a message, and it only accepts one for a claimed tenant — so this is the
		 * one place claim state is learned without asking anybody.
		 *
		 * Flushes immediately (this session is now attached to a real conversation, and the
		 * owner is about to open it) and CLEARS — but only once the send has been ANSWERED.
		 *
		 * 🩸 IT USED TO CLEAR EITHER WAY (review D1). `went` was computed, returned, and never
		 * consulted about whether to reset, so a transport that said no destroyed the whole
		 * conversation's questions in the browser — including the one the visitor escalated on,
		 * the single most valuable row this file exists to carry — and returned `null`, so the
		 * caller could not tell it had happened either. This is the one send that happens with
		 * the document alive, so it can wait for the server's own answer rather than the
		 * transport's; anything short of a 2xx leaves the buffer exactly where it was, and the
		 * next `pagehide` carries it under the same idempotency key.
		 */
		async escalated(conv) {
			if (!state) return null;
			const at = now();
			state = current(at);
			state.handle = aiHandle(conv);
			// 🩸 THE PROOF IS THE ID, SO THE ID IS WHAT IT IS CONDITIONED ON (review D11/E7). The
			// handle was defended against a server that answered `ok:true` with no
			// `conversation_id`; the claim beside it was not, and a `claim: true` is carried across
			// sessions for six hours by `fresh()` — a write permission opened by a conversation
			// that does not exist. Both call sites pass `body.conversation_id` after a 2xx, so this
			// is a shape rather than a bug today, and it is the shape that has to be right.
			if (state.handle) {
				state.claim = true;
				state.claimAt = at;
			}
			state.last = at;
			// The handle and the claim answer are facts already — a failed send must not cost
			// them, so they are written before the network is asked anything.
			write(state);
			const payload = state.questions.length > state.sent && send ? aiSessionPayload(kind, id, state) : null;
			if (!payload) return null;
			let went = false;
			try {
				went = (await send(payload, { confirm: true })) === true;
			} catch {
				went = false;
			}
			if (!went) return null;
			// 🩸 A QUESTION ASKED DURING THE ROUND TRIP WAS NOT IN THIS SEND (review E5). The report
			// argued the window was shut because the panel changes after the press — it changes to
			// a panel with an「ask <assistant> again」button on it, one click from the compose box,
			// while this `await` is still in flight. It is a narrow window (one fetch, three
			// actions) and the review agreed it is narrow; what it is not is closed, and the fix is
			// cheaper than the bet: clear only what this send actually carried.
			const held = read();
			if (held && held.sid === state.sid) state = held;
			const carried = payload.questions.length;
			const newest = payload.questions[carried - 1];
			const rows = state.questions;
			const last = rows[rows.length - 1];
			// Longer, or ending on a row this send did not carry — the second case is the buffer at
			// its cap, where a new question drops the oldest and the length never changes.
			if (rows.length > carried || !last || last.at !== newest.at || last.text !== newest.text) {
				state.sent = Math.max(0, Math.min(carried, rows.length - 1));
				// The session is NOT rotated: the question that arrived belongs to the conversation
				// this handle just opened, and the next `pagehide` carries it under the same
				// idempotency key — a repeat the endpoint is built for, unlike a lost question.
			} else {
				state = fresh(now(), state);
			}
			write(state);
			return payload;
		}
	};
}

// ── the guidance funnel (reef#422) ──────────────────────────────────────────
//
// 「被引導 → 到達 → 解決」, as events: KAITO cited a page (`guided`), the visitor then reached
// that page (`arrived`), asked again (`followed_up`) or went to a person (`handed_off`). The
// contract is reef `apps/feelreef/src/lib/inbox/funnel.ts`'s header and SPEC-inbox-bubble-position
// 五; the endpoint is `POST /api/inbox/funnel`, one event per request.
//
// 🔴 NO WORDS, BY SHAPE. A funnel body is assembled from `FUNNEL_FIELDS` and nothing else — no
// question, no answer, no text of any kind, no time (the server stamps it), no session id, no
// handle. The endpoint refuses an unknown key with a 400, so a field added here without the
// contract changing is a bug that shows.
//
// 🔴 THE SAME POSTURE AS THE QUESTION LOG, NOT A NEW ONE. The funnel runs exactly where the log
// runs — the full bubble, with `data-ai-log` not "0" — and stops where the log's own definite
// 「no Inbox」stands. The full bubble is only ever drawn after the mount's gate heard yes (or, when
// it cannot be asked, a yes this browser heard within 30 days), so that is the claim the funnel
// stands on; it does not wait for the log's second probe, because it carries no words to hold
// back. The ask-only bubble creates neither, and writes nothing (ruling 54). The server drops
// every event for an unclaimed tenant as well, with the same 204 and zero writes.
//
// 🔴 NOTHING UNTIL KAITO GUIDES. A journey is minted by the first `guided` and by nothing else, so
// a visitor who never asks — or whose questions were all refused — costs no request and no storage
// write. `arrived`, `followed_up` and `handed_off` exist only inside a journey that was guided:
// without one there is no funnel for them to be a step of.
//
// 🔴 `journey` IS NOT `session_id`, and cannot be. The log's `session_id` is a UUID; a journey is
// `f_` + 16 lowercase hex, the namespace the server reserves for it on both routes, minted by its
// own call and kept under its own key — so the two rows can never be joined.

/** The four stages, in contract order. */
export const FUNNEL_STAGES = ['guided', 'arrived', 'followed_up', 'handed_off'];
/** Every key a funnel body may carry — reef's `FUNNEL_BODY_FIELDS`, the same eight. */
export const FUNNEL_FIELDS = ['kind', 'id', 'journey', 'stage', 'page', 'cited_page', 'section', 'locale'];
/** The journey namespace the server accepts: `f_` + 16 lowercase hex, nothing else. */
export const FUNNEL_JOURNEY = /^f_[0-9a-f]{16}$/;
/** What `section` holds when the stage has none, or the citation named no usable anchor. */
export const FUNNEL_NO_SECTION = 'none';
/** The server's section shape: letters, digits, `-`, `_`, at most 80. */
const FUNNEL_SECTION = /^[\p{L}\p{N}_-]{1,80}$/u;
/** The server's locale shape: '' (the site's primary locale) or a lowercase `xx` / `xx-yy` tag. */
const FUNNEL_LOCALE = /^([a-z]{2,3}(-[a-z0-9]{2,8})?)?$/;
/** Most guidances one journey remembers while waiting for an arrival; the oldest go first. */
export const FUNNEL_MAX_GUIDED = 20;
const FUNNEL_PREFIX = 'reef-inbox:funnel:';

/** The journey's own key — beside the log's and the handle's, never inside either. */
export function funnelKey(tenant) {
	return FUNNEL_PREFIX + tenant;
}

/**
 * A fresh journey id. `getRandomValues` where there is one; the fallback is only ever reached by a
 * browser without Web Crypto, and is still shaped for the namespace.
 */
export function mintJourney(fill) {
	const bytes = new Uint8Array(8);
	try {
		(fill || ((b) => crypto.getRandomValues(b)))(bytes);
	} catch {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	return 'f_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Which page an address is, for「did the visitor reach the cited page」— a COMPARISON key, never
 * sent. The same identities reef's `inboxPageKey` applies (path only, percent-decoded, slashes
 * collapsed, case folded), so a citation spelled `/FAQ/` and a page at `/faq` are one page here
 * exactly as they are one row there.
 */
export function funnelPageKey(raw) {
	let path = aiPagePath(raw);
	try {
		path = decodeURIComponent(path);
	} catch {
		// A truncated `%E5` stays as it was.
	}
	path = (path.split(/[?#]/)[0] || '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
	return path.toLowerCase() || '/';
}

/** The cited section: the citation's fragment, when it is a shape the server accepts, else `none`. */
export function funnelSection(url) {
	if (typeof url !== 'string') return FUNNEL_NO_SECTION;
	let hash = '';
	try {
		hash = new URL(url, 'https://x.invalid').hash.slice(1);
		hash = decodeURIComponent(hash);
	} catch {
		return FUNNEL_NO_SECTION;
	}
	return FUNNEL_SECTION.test(hash) ? hash : FUNNEL_NO_SECTION;
}

/**
 * One event's wire body, ASSEMBLED FROM NAMED FIELDS. `cited_page` exists on `guided` and only
 * there — the server requires it there and refuses it anywhere else.
 */
export function funnelPayload(kind, id, journey, stage, fields = {}) {
	const body = {
		kind,
		id,
		journey,
		stage,
		page: aiPagePath(fields.page)
	};
	if (stage === 'guided') body.cited_page = aiPagePath(fields.cited_page);
	body.section = typeof fields.section === 'string' && FUNNEL_SECTION.test(fields.section)
		? fields.section
		: FUNNEL_NO_SECTION;
	// The server's locale shape, checked here so a page segment it would refuse travels as the
	// primary locale ('') rather than costing the whole event a 400.
	const locale = typeof fields.locale === 'string' ? aiLine(fields.locale, 16).toLowerCase() : '';
	body.locale = FUNNEL_LOCALE.test(locale) ? locale : '';
	return body;
}

/**
 * Hand one event to the network and forget it.
 *
 * 🔴 A KEEPALIVE `fetch` WITH A JSON BODY, NOT `sendBeacon`. The session beacon is a `text/plain`
 * string because it leaves on `pagehide`, where Safari runs no CORS preflight — and reef's
 * cross-site form check lets `text/plain` through for `/api/inbox/session` ALONE (hooks.server.ts
 * `CSRF_EXEMPT_PATHS`), so the same string sent here would be refused 403 before the route ran.
 * None of the four stages happens at `pagehide`: each one is a moment the document is alive (an
 * answer drawn, a page mounted, a link clicked, a send answered), so the preflighted JSON request
 * has time to run, and `keepalive` carries it past a navigation that starts right after.
 *
 * Never throws and never waits: the endpoint answers 204 whatever happened, and an event that did
 * not arrive is not retried — the funnel is bookkeeping, and the visitor never sees it.
 */
export function sendFunnelEvent(url, body, env = {}) {
	const f = 'fetch' in env ? env.fetch : typeof fetch === 'undefined' ? null : fetch;
	if (!f) return false;
	try {
		const p = f(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'omit',
			keepalive: true
		});
		if (p && typeof p.catch === 'function') p.catch(() => {});
		return true;
	} catch {
		return false;
	}
}

/**
 * Read a journey back out of this browser's own storage. Malformed, or idle past the log's own
 * thirty minutes, is no journey — the same session boundary the question log draws.
 */
export function parseFunnel(raw, at) {
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.journey !== 'string' || !FUNNEL_JOURNEY.test(raw.journey)) return null;
	if (!Number.isFinite(raw.last) || at - raw.last > AI_LOG_IDLE_MS) return null;
	const guided = (Array.isArray(raw.guided) ? raw.guided : [])
		.filter((g) => g && typeof g.page === 'string')
		.map((g) => ({
			page: aiLine(g.page, AI_LOG_MAX_FIELD) || '/',
			section: typeof g.section === 'string' && FUNNEL_SECTION.test(g.section) ? g.section : FUNNEL_NO_SECTION
		}))
		.slice(-FUNNEL_MAX_GUIDED);
	return { journey: raw.journey, last: raw.last, guided };
}

/**
 * The funnel, as a thing that can be tested without a DOM — every side effect injected, like
 * `createAiLog`. Each method sends at most one event and returns the body it sent, or `null`.
 */
export function createFunnel(opts) {
	const {
		tenant,
		kind,
		id,
		storage,
		now = () => Date.now(),
		newJourney = () => mintJourney(),
		send,
		enabled = true,
		unclaimed = () => false
	} = opts;
	const key = funnelKey(tenant);
	/** The copy this document holds — the whole story when storage is missing or stops taking writes. */
	let mem = null;
	let readOnly = false;

	function read(at) {
		if (storage && !readOnly) {
			try {
				const raw = storage.getItem(key);
				return raw ? parseFunnel(JSON.parse(raw), at) : null;
			} catch {
				// An unreadable cell is no journey; the copy in memory still is one.
			}
		}
		return mem ? parseFunnel(mem, at) : null;
	}
	function write(state) {
		mem = state;
		if (!storage) return;
		try {
			storage.setItem(key, JSON.stringify(state));
			readOnly = false;
		} catch {
			readOnly = true;
		}
	}
	const on = () => {
		if (!enabled || !send) return false;
		try {
			return !unclaimed();
		} catch {
			return false;
		}
	};
	function emit(journey, stage, fields) {
		const body = funnelPayload(kind, id, journey, stage, fields);
		try {
			send(body);
		} catch {
			// Best effort: a transport that throws costs the visitor nothing.
		}
		return body;
	}

	return {
		enabled: on,
		/** For tests. Never a live reference. */
		state: () => {
			const held = read(now());
			return held ? JSON.parse(JSON.stringify(held)) : null;
		},

		/** KAITO's answer cited `citedUrl`, and the visitor was shown it, on `page`. */
		guided(page, citedUrl, locale) {
			if (!on()) return null;
			const at = now();
			const held = read(at) ?? { journey: newJourney(), last: at, guided: [] };
			if (!FUNNEL_JOURNEY.test(held.journey)) return null;
			const section = funnelSection(citedUrl);
			held.guided = [...held.guided, { page: funnelPageKey(citedUrl), section }].slice(-FUNNEL_MAX_GUIDED);
			held.last = at;
			write(held);
			return emit(held.journey, 'guided', { page, cited_page: citedUrl, section, locale });
		},

		/**
		 * The visitor is on `page` — a mount, or a click on a citation that points at the page they
		 * are already on. Sends `arrived` only when this journey was guided to this page and has not
		 * arrived there since; the guidance it answers is used up, so a reload is not a second arrival.
		 */
		arrived(page, locale) {
			if (!on()) return null;
			const at = now();
			const held = read(at);
			if (!held) return null;
			const here = funnelPageKey(page);
			const matches = held.guided.filter((g) => g.page === here);
			held.last = at;
			if (!matches.length) {
				write(held);
				return null;
			}
			held.guided = held.guided.filter((g) => g.page !== here);
			write(held);
			return emit(held.journey, 'arrived', { page, section: matches[matches.length - 1].section, locale });
		},

		/** The visitor asked KAITO again, inside a guided journey. */
		followedUp(page, locale) {
			return step('followed_up', page, locale);
		},

		/** A message reached a person, inside a guided journey. */
		handedOff(page, locale) {
			return step('handed_off', page, locale);
		}
	};

	function step(stage, page, locale) {
		if (!on()) return null;
		const at = now();
		const held = read(at);
		if (!held) return null;
		held.last = at;
		write(held);
		return emit(held.journey, stage, { page, locale });
	}
}

// ── the panel's title ───────────────────────────────────────────────────────

/**
 * What the panel calls the site it is sitting on.
 *
 * 🔴 NEVER `document.title` (owner ruling, 2026-09-03 cold-read finding #7).
 * A page's `<title>` is written for a browser tab and a search result — "NORTHWIND
 * | LIVE2D" told a visitor nothing about what this floating panel was FOR, and
 * on an article or product page it is often not the site's name at all. Priority:
 * an explicit `data-site-name` (the mount already knows what SiteLayout calls
 * itself), then the page's own `og:site_name` (written for the same purpose —
 * "what is this site called" — by whatever already renders it into the head),
 * then the bare hostname, which is always true even when nobody set anything.
 */
export function resolveSiteName(el, doc) {
	const fromAttr = el && el.getAttribute && el.getAttribute('data-site-name');
	if (fromAttr && fromAttr.trim()) return fromAttr.trim();
	const meta = doc && doc.querySelector && doc.querySelector('meta[property="og:site_name"]');
	const fromMeta = meta && meta.getAttribute && meta.getAttribute('content');
	if (fromMeta && fromMeta.trim()) return fromMeta.trim();
	try {
		return location.hostname || '';
	} catch {
		return '';
	}
}

const DEFAULT_ASSISTANT_NAME = 'KAITO';
const ASSISTANT_NAME_MAX = 40;
/**
 * The second half of the cap, and the reason there are two (review B7, 2026-09-08).
 *
 * 🩸 COUNTING GRAPHEMES REMOVED THE LENGTH LIMIT. `.slice(0, 40)` counted UTF-16 units, so it was
 * a hard ceiling as well as a cap; counting clusters is right for「40 characters」 as a person
 * means it, but a cluster has no upper bound — `('a' + '́'.repeat(500)).repeat(40)` is
 * exactly 40 clusters and 20,040 units, and the measured result was that it passed through
 * untouched into the status line and the second-action button as a page-high wall of Zalgo.
 *
 * So the cluster cap says how many characters, and this says how much text. 200 units is five
 * times the cluster cap — far past any real name in any script, including a fully-decomposed one,
 * and still a bound. The truncation lands on a cluster boundary either way, never mid-sequence.
 */
const ASSISTANT_NAME_MAX_UNITS = 200;

/**
 * Bidi/format controls (issue #17, pre-existing, found by the review of #12 R2/R3 P3): an
 * embedding override or isolate reaching the status text node is unisolated there, so a name
 * carrying U+202E could flip the reading direction of everything AFTER it in the same sentence.
 * Every code point that can do that — the five embedding/override controls, the four isolates,
 * ALM, and the two marks — is stripped at the same intake point `AI_CHIP_TOKEN` already goes
 * through, so nothing downstream (`statusFor`, the second-action label) has to defend itself.
 *
 * 🔴 `\u` ESCAPES, NEVER THE LITERAL CHARACTERS. These are exactly the code points behind
 * "Trojan Source" (CVE-2021-42574): a bidi override sitting as literal source bytes can make an
 * editor or a diff RENDER this file's own code in an order that does not match how it executes.
 * Spelling them out defeats the one thing this constant exists to strip.
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F]/g;

/**
 * The characters `AI_CHIP_TOKEN` cannot exist without — the U+2063 either side of it — derived
 * FROM the token rather than retyped, so a sentinel that ever changes its wrapper is covered by
 * this the day it changes. ASCII is deliberately excluded: "AI_CHIP" as letters is a legal thing
 * for an owner to call their assistant; it is the invisible wrapper that makes `statusFor`'s
 * `split` see a marker.
 *
 * 🔴 THIS IS WHAT MAKES THE STRIP STRUCTURAL — review B1, round 2, and the reason the old
 * 「convergent order」claim was not true (see `cleanAssistantName`). Removing the token as a
 * STRING can hand back the very thing it removed: `T.slice(0, 3) + T + T.slice(3)` is one whole
 * token with its own prefix in front and its matching suffix behind, so deleting that one
 * occurrence joins the two remnants into a complete new token. Deleting the characters instead
 * has no fixed point to miss — afterwards there is no U+2063 anywhere in the name, and every step
 * that follows only ever deletes characters, so not one of them can put one back.
 *
 * 🔴 `\u{…}` AND THE `u` FLAG, WHICH IS WHAT MAKES 「covered the day it changes」 TRUE (review B14,
 * round 3). The escapes used to be four-digit `\uXXXX` with no flag, and that is a BMP-only
 * spelling: a wrapper of U+1F5A5 came out as `὚5`, which a non-unicode regex reads as
 * `὚` followed by a literal `5` — so the new wrapper was NOT stripped (B1's guarantee off,
 * silently) while U+1F5A and the digit 5 were, and nothing threw. A one-character change to the
 * sentinel would have done that. `\u{…}` with `u` spells any code point, and `[...new Set(token)]`
 * already iterates by code point, so a surrogate pair arrives here whole. Exported only so the
 * derivation can be tested against a stand-in wrapper the sentinel does not currently use — the
 * sentinel itself stays private, as it always has.
 */
export function privateCharsOf(token) {
	return new RegExp(
		`[${[...new Set(token)]
			.filter((ch) => ch.codePointAt(0) > 0x7e)
			.map((ch) => `\\u{${ch.codePointAt(0).toString(16)}}`)
			.join('')}]`,
		'gu'
	);
}

const AI_CHIP_PRIVATE_RE = privateCharsOf(AI_CHIP_TOKEN);

/**
 * How much of an incoming name is examined at all, and B7's sibling: the fixed-point loop in
 * `cleanAssistantName` is the one pass there that can run more than once, and a deeply nested
 * payload could otherwise make it quadratic in the length of an attribute nobody bounded. The
 * result is capped at the caller's unit cap regardless (`ASSISTANT_NAME_MAX_UNITS` for a name,
 * `STATUS_TEXT_MAX_UNITS` for `data-status`), so twenty times that is far past any
 * real name in any script and still a ceiling on the work a one-megabyte attribute can ask for.
 */
const RAW_NAME_MAX_FACTOR = 20;

/**
 * A ZERO WIDTH JOINER left dangling at the end of a truncated name (review B8) — the one format
 * character `BIDI_CONTROL_RE` deliberately does not carry, because U+200D inside a name is
 * meaningful (it is what holds an emoji sequence together) and only a TRAILING one is debris.
 * Cutting a three-person family emoji straight after its first joiner leaves one figure and a
 * joiner with nothing left to join, sitting in the DOM.
 *
 * 🔴 STRIPPED TO A FIXED POINT WITH `trim()`, NOT BEFORE IT (review B13, round 3). The claim used
 * to be 「trimmed after every cut that could produce one has already been made」 and the `.trim()`
 * on the same line was itself such a cut: taking a trailing joiner off 「小美 ZWJ SP ZWJ」 uncovers
 * the space, trimming the space uncovers the joiner before it, and one pass in one order stopped
 * there with the joiner still in the DOM. Each step only ever deletes, so alternating them
 * converges — see the end of `cleanAssistantName`.
 */
const TRAILING_JOINER_RE = /\u200D+$/;

/**
 * The three Unicode questions `fallbackGraphemes` below asks:
 *   EXTENDS — does this code point continue the cluster before it (combining marks, variation
 *             selectors, the enclosing keycap, the Fitzpatrick skin-tone modifiers)?
 *   PIC_END / PIC_START — is a ZERO WIDTH JOINER sitting between two PICTOGRAPHS? That is the
 *             one place a joiner actually welds two clusters into one (UAX #29 GB11), which is
 *             how 「👨‍👩‍👧」 and 「🏳️‍🌈」 count once each. A joiner between anything else does
 *             not, so `a` + ZWJ + `👩` stays two clusters exactly as `Intl.Segmenter` says.
 *
 * 🔴 Built with `new RegExp` inside a `try`, never as regex LITERALS. Unicode property escapes
 * are younger than some of the engines that reach the fallback at all, and a literal an engine
 * cannot parse is a SyntaxError for the WHOLE MODULE — the bubble would not render, to make a
 * name one cluster tidier. `null` means the fallback degrades to counting code points, which is
 * exactly what it did before this.
 */
const [GRAPHEME_EXTEND_RE, PICTOGRAPH_END_RE, PICTOGRAPH_START_RE] = (() => {
	try {
		return [
			new RegExp('^(?:\\p{Grapheme_Extend}|\\p{Emoji_Modifier})$', 'u'),
			new RegExp('\\p{Extended_Pictographic}(?:\\p{Grapheme_Extend}|\\p{Emoji_Modifier})*$', 'u'),
			new RegExp('^\\p{Extended_Pictographic}', 'u')
		];
	} catch {
		return [null, null, null];
	}
})();

/** U+200D, spelled as an escape for the same reason `BIDI_CONTROL_RE` is — see its comment. */
const ZWJ = '\u200D';

const REGIONAL_INDICATOR_LO = 0x1f1e6;
const REGIONAL_INDICATOR_HI = 0x1f1ff;

/**
 * The `Intl.Segmenter`-free path, and 🔴 it now AGREES with the Segmenter path rather than
 * merely avoiding lone surrogates (review B8).
 *
 * 🩸 `Array.from` alone counts CODE POINTS, so the same name was two different names depending
 * on the browser: a three-person ZWJ family ×45 capped to 40 whole families with a Segmenter and
 * to 8 without one, and Firefox only shipped `Intl.Segmenter` in 125 — this is a live split, not
 * a museum piece. Worse, the cut landed anywhere inside a sequence, which is where the dangling
 * joiner `TRAILING_JOINER_RE` above exists to clean up came from.
 *
 * Three joining rules: an extending code point glues to what precedes it, two regional
 * indicators pair up into one flag, and a joiner welds two pictographs. That is enough to agree
 * with `Intl.Segmenter` cluster-for-cluster on every sequence the review measured plus the ones
 * the tests add (families, flags, keycaps, skin tones, rainbow/kiss ZWJ sequences, Hangul,
 * combining stacks) — which is what the test asserts, against the real Segmenter, rather than
 * against a table written here.
 *
 * 🔴 IT IS NOT A UAX #29 IMPLEMENTATION and must not be described as one. Indic conjuncts
 * (virama sequences) still count as more clusters here than a Segmenter says, so a Devanagari
 * name is capped shorter on an engine without one. That is a display-length difference on a
 * label, in the same direction the old code already erred, and buying the rest of UAX #29 to
 * close it would put a segmentation table in a widget that has to stay small.
 */
function fallbackGraphemes(str) {
	const out = [];
	let joinNext = false;
	let riOpen = false;
	for (const cp of str) {
		const code = cp.codePointAt(0);
		const isRI = code >= REGIONAL_INDICATOR_LO && code <= REGIONAL_INDICATOR_HI;
		const pairsWithPrevious = isRI && riOpen;
		const previous = out.length ? out[out.length - 1] : '';
		const extendsPrevious = GRAPHEME_EXTEND_RE ? GRAPHEME_EXTEND_RE.test(cp) : false;
		// GB11: pictograph, joiner, pictograph — the joiner is already part of `previous`, so what
		// is tested for the left-hand pictograph is `previous` with that trailing joiner removed.
		const weldedByJoiner =
			joinNext &&
			!!PICTOGRAPH_START_RE &&
			PICTOGRAPH_START_RE.test(cp) &&
			PICTOGRAPH_END_RE.test(previous.slice(0, -1));
		if (out.length && (weldedByJoiner || extendsPrevious || cp === ZWJ || pairsWithPrevious)) {
			out[out.length - 1] += cp;
		} else {
			out.push(cp);
		}
		joinNext = cp === ZWJ;
		riOpen = isRI && !pairsWithPrevious;
	}
	return out;
}

/**
 * Splits `str` into user-perceived characters — an emoji or a combining sequence counts once —
 * using `Intl.Segmenter` where it exists and `fallbackGraphemes` where it does not. Either is
 * enough to stop the cap producing a lone surrogate (issue #17): a plain `.slice(0, N)` counts
 * UTF-16 units, so a 40-char cap could land inside a surrogate pair and cut an astral character
 * in half.
 */
function graphemes(str) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), (s) => s.segment);
	}
	return fallbackGraphemes(str);
}

/**
 * What VISITORS see the site's Q&A assistant called (owner ruling, 2026-09-05:
 * "KAITO" is OUR product name; the site owner may rename what visitors see it
 * as — e.g. 「重新問 KAITO」→「重新問 小美」 — but the AI identity itself must
 * never be hidden, which is why `statusDefault` always appends the AI_CHIP_TOKEN
 * `statusFor` below turns into the non-removable AI chip, regardless of this
 * name). `data-assistant-name` on the mount, trimmed to a single line and
 * capped at `ASSISTANT_NAME_MAX` chars; blank/whitespace (or the attribute
 * simply being absent) falls back to "KAITO".
 */
export function resolveAssistantName(el) {
	const raw = el && el.getAttribute && el.getAttribute('data-assistant-name');
	return cleanAssistantName(raw) || DEFAULT_ASSISTANT_NAME;
}

/** tile#20: the cap on `data-status`, in grapheme clusters and (for the same reason as the name's
 * two caps — see ASSISTANT_NAME_MAX_UNITS) in UTF-16 units. */
const STATUS_TEXT_MAX = 80;
const STATUS_TEXT_MAX_UNITS = 400;

/**
 * tile#20. `data-status` — the one visible sentence a site without KAITO puts under its name
 * (「真人會看」, 'a person reads what you send'). `data-title` could not do it: that is the
 * dialog's aria-label and nothing else (ruling 2026-09-07, bubble-copy lane §一).
 *
 * Returns PLAIN TEXT, or `''` for "no usable override". It goes through the same intake as a
 * name — bidi controls and every sentinel character out, one line, trimmed, capped on a cluster
 * boundary — because it lands in the same status node; `statusFor` escapes it on the way out.
 */
export function resolveStatusText(el) {
	const raw = el && el.getAttribute && el.getAttribute('data-status');
	return cleanAssistantName(raw, STATUS_TEXT_MAX, STATUS_TEXT_MAX_UNITS);
}

/**
 * The one place a name from OUTSIDE this file becomes a name this file will render: single
 * line, trimmed, capped at `ASSISTANT_NAME_MAX`, and with `AI_CHIP_TOKEN` removed. Returns
 * `''` for "there is no usable name here" — each caller decides what that means (the baked
 * attribute falls back to "KAITO"; the platform read falls back to「change nothing」).
 *
 * 🩸 THE TOKEN STRIP IS NOT HOUSEKEEPING. `AI_CHIP_TOKEN` is U+2063-wrapped text, and U+2063
 * is a format character, not whitespace — so `trim()`, the newline check and the cap all wave it
 * straight through. An owner who set the name to a string containing the token would make
 * `statusFor`'s `split` yield THREE parts, and `[before, after]` drops the third:
 * 「先回，轉出去真人會看」 disappears from the status line and only the chip is left. The
 * AI disclosure itself never breaks (the chip is still there, by construction), but the rest
 * of the sentence does, so the token is stripped where names arrive rather than defended
 * against where they render.
 *
 * 🩸 THE ORDER WAS THE DEFENCE, AND THE ORDER WAS NOT ENOUGH — review B1, twice. 0.7.4 ran the
 * bidi strip AFTER the token strip, so a control character the token strip could not see and the
 * bidi strip then deleted smuggled a token in and reassembled it:
 *
 *   data-assistant-name = "\u2063A\u202EI_CHIP\u2063"   (\u202E written as an escape, never
 *      as a literal byte — see BIDI_CONTROL_RE)
 *     → split(AI_CHIP_TOKEN) sees no token (the U+202E is in the middle of it) and passes it on
 *     → replace(BIDI_CONTROL_RE) deletes the U+202E and hands back a COMPLETE AI_CHIP_TOKEN
 *     → `statusFor` splits into three, drops the third, and the whole sentence is gone
 *
 * Every one of the twelve stripped controls worked as the smuggling character, at any position.
 * 0.7.5 put the deletes first and called the resulting order convergent. It was not, and round 2
 * of the review supplied the eighteen characters that show why — with T for the token:
 *
 *   T.slice(0, 3) + T + T.slice(3)
 *     → ONE split(T).join('') removes the middle T, and the two remnants left either side of the
 *       hole are exactly T's own first three characters and its own last nine: T again
 *     → so the LAST step in the chain handed the DOM the token it exists to remove
 *
 * Nothing had to invent a U+2063 for that; the string arrived carrying the pieces. The fix is to
 * stop making「is the token here」a question about a string at all. The token comes out to a
 * FIXED POINT (which is what the nested payload defeats in a single pass), and then, whatever is
 * left in whatever arrangement, every character `AI_CHIP_TOKEN` cannot exist without goes — see
 * `AI_CHIP_PRIVATE_RE`. From that line to the `return` nothing does anything but delete, so the
 * name that comes back provably carries no sentinel character and has nothing to reassemble from.
 */
function cleanAssistantName(raw, maxClusters = ASSISTANT_NAME_MAX, maxUnits = ASSISTANT_NAME_MAX_UNITS) {
	// 1. Bound the input before the one pass below that can repeat (see RAW_NAME_MAX_FACTOR), and
	//    cut on a code point boundary so it cannot leave half a surrogate pair behind.
	let name = String(raw || '');
	const rawMax = maxUnits * RAW_NAME_MAX_FACTOR;
	if (name.length > rawMax) {
		name = name.slice(0, rawMax).replace(/[\uD800-\uDBFF]$/, '');
	}
	// 2. Format controls out — nothing downstream can be tricked by what is no longer here.
	name = name.replace(BIDI_CONTROL_RE, '');
	// 3. The token as a string, to a fixed point. This is the courtesy half: it is what makes a
	//    name that is NOTHING BUT the sentinel come out empty, and so fall back to KAITO, rather
	//    than leaving the bare letters behind as somebody's name. It is not the guarantee.
	let previous;
	do {
		previous = name;
		name = name.split(AI_CHIP_TOKEN).join('');
	} while (name !== previous);
	// 4. 🔴 THE GUARANTEE, and the whole of round 2's B1: every character the sentinel cannot
	//    exist without, gone, whatever step 3 left and however it was arranged. No line below
	//    this one adds a character to the name.
	name = name.replace(AI_CHIP_PRIVATE_RE, '');
	// 5. One line, trimmed.
	const trimmed = name.trim().split('\n')[0].trim();
	if (!trimmed) return '';
	// 6. Both halves of the cap, on the same pass and always on a cluster boundary: at most
	//    ASSISTANT_NAME_MAX clusters, and at most ASSISTANT_NAME_MAX_UNITS UTF-16 units (B7 — a
	//    single cluster can be 500 units on its own, and one that does not fit stops the name
	//    rather than being cut in half).
	let capped = '';
	let count = 0;
	for (const cluster of graphemes(trimmed)) {
		if (count >= maxClusters || capped.length + cluster.length > maxUnits) break;
		capped += cluster;
		count++;
	}
	// 7. The joiner a cut in step 6 may have left dangling (B8), and the whitespace stripping it
	//    exposes, and the joiner stripping THAT exposes — to a fixed point (review B13, round 3).
	//    `replace(...).trim()` ran once and in that order, so 「小美 ZWJ SP ZWJ」 came back as
	//    「小美 ZWJ」: the replace took the last joiner, the trim then took the space that had been
	//    hiding the one before it, and nothing looked again. Deletes only — see step 4 — so this
	//    loop is bounded by the length of a name already capped at ASSISTANT_NAME_MAX_UNITS.
	let tail = capped;
	let before;
	do {
		before = tail;
		tail = tail.trim().replace(TRAILING_JOINER_RE, '');
	} while (tail !== before);
	return tail;
}

/**
 * 🏛 THE PLATFORM'S ANSWER, WHICH BEATS THE BAKED ONE — CANON-where-values-live.md 第一條
 * (owner ruling 2026-09-06 #36/38). `data-assistant-name` above is compiled INTO the site at
 * build time, so honouring only that would mean an owner's rename did not reach visitors until
 * somebody rebuilt and republished the site. The name's home is the platform, and this is the
 * runtime read that makes 「存了就生效」 literally true.
 *
 * 🔴 THIS MAY NEVER BREAK, BLOCK, OR DELAY THE BUBBLE. It is a nicety on a label: every failure
 * — no network, a slow platform, a non-200, a malformed body, a site with no override at all —
 * resolves to `null`, and `null` means「keep whatever `resolveAssistantName` already decided」.
 * That fallback chain is the eject story working in miniature: platform value → the repo mirror
 * baked into `data-assistant-name` → "KAITO". A site that has left the platform gets the second
 * rung forever and never notices the first one is gone.
 *
 * 🔴 CAPPED AND SINGLE-LINED AGAIN HERE, through the same `cleanAssistantName` the baked
 * attribute goes through. The value already crossed two services that each say they enforce
 * this; a coral running on a customer's page is the last place that can still be sure, and
 * sharing the helper means the platform path cannot quietly enforce less than the repo path.
 *
 * 🩸 `''` HAD TWO MEANINGS AND THEY WERE MERGED HERE — review R2-P1-2, and it broke the one
 * move an owner is told is safe: CLEARING the name. `/api/inbox/assistant` answers `''` for
 *「no override, visitors see KAITO」 AND for every degraded path it has (rate limited, RSP
 * down, malformed body, no platform configured) — it says so in its own header. `''` then hit
 * `|| null` here, `null` means「nothing to correct」, and so an owner who set 小美, published
 * once (baking `data-assistant-name="小美"` into the page) and later cleared the field was told
 * 「已儲存，已生效」 while every visitor kept seeing 小美 for ever. The console half of CANON
 * 第一條 was fixed in the same PR; this was the last stretch of the road where the repo mirror
 * still won.
 *
 * 🔴 SO THE PROXY NOW SAYS WHETHER IT ACTUALLY ASKED: `resolved: true` rides ONLY on an answer
 * the platform really gave. `resolved` + `''` is a FACT (「no override」) and resolves to
 * `DEFAULT_ASSISTANT_NAME`, which is what「留空＝KAITO」 promises on screen. `''` without it
 * stays `null` — an old proxy, a rate-limited minute, a platform that could not be reached —
 * and the baked name stands, exactly as before. The two meanings are two values again, and the
 * conservative one is still what an unknown answer gets.
 */
export async function fetchAssistantName(apiBase, kind, id) {
	try {
		const res = await fetch(
			`${apiBase}/api/inbox/assistant?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
			{ headers: { accept: 'application/json' } }
		);
		if (!res.ok) return null;
		const body = await res.json();
		const raw = body && typeof body.assistantName === 'string' ? body.assistantName : '';
		const name = cleanAssistantName(raw);
		if (name) return name;
		return body && body.resolved === true ? DEFAULT_ASSISTANT_NAME : null;
	} catch {
		return null;
	}
}

/**
 * Does this tenant have an Inbox — i.e. is there a person at the other end at all?
 *
 * 🔴 THE ONLY QUESTION THIS ASKS, and it is asked LAZILY: not at mount, but the first time a
 * visitor actually types a question, and then at most once per `AI_LOG_CLAIM_TTL_MS` per
 * browser once it has an answer — once per `AI_LOG_CLAIM_RETRY_MS` while it does not. A probe
 * at mount would put a request on every page view of every site carrying this coral to answer
 * a question that matters only for the small share of visits where somebody asks something.
 *
 * `null` (a network failure, a shape we cannot read, a 429, the contract's own `throttled`) is
 * NOT `false` — it is「we do not know」, and `createAiLog`'s flush treats not-knowing exactly
 * like a no while refusing to write it down as one.
 */
export async function probeInboxClaim(apiBase, kind, id) {
	return (await askInboxClaim(apiBase, kind, id)).answer;
}

/**
 * The same request, saying also whether asking again could change the answer — which only the
 * claim gate below needs. `answer` is exactly what `probeInboxClaim` returns.
 *
 * 🔴 `retry` IS TRUE ONLY FOR「COULD NOT ASK」: no network, a 5xx, a body of the wrong shape (and,
 * in the gate, a timeout). NOT for `throttled` and NOT for a 4xx: the probe's rate limit counts per
 * address across every site on the platform, so asking a throttled endpoint three more times only
 * spends that address's allowance on the next site as well; and a 400 (`bad_kind`/`bad_id`) says
 * the same thing every time it is asked.
 */
export async function askInboxClaim(apiBase, kind, id, signal) {
	try {
		const res = await fetch(
			`${apiBase}/api/inbox/session?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
			// `signal` only from the claim gate below, which bounds each attempt; the log's own
			// probe passes none and is exactly the request it always was.
			signal ? { headers: { accept: 'application/json' }, signal } : { headers: { accept: 'application/json' } }
		);
		if (!res.ok) return { answer: null, retry: !(res.status >= 400 && res.status < 500) };
		const body = await res.json();
		// 🔴 `throttled` IS THE SERVER SAYING「WE DO NOT KNOW」, and it arrives dressed as a no
		// (contract §一.1: over the read rate limit the endpoint answers 200 `claimed:false,
		// throttled:true` rather than 429, because a coral that cannot ask must not write). Reading
		// that field is the entire reason it exists: without it a rate-limited probe — the ordinary
		// case on a busy site, since the probe shares the `read` bucket with a 15-second transcript
		// poll — is indistinguishable from「this site has no Inbox」, which drops this browser's
		// buffer and poisons the answer for six hours (review D2).
		if (body?.throttled === true) return { answer: null, retry: false };
		return typeof body?.claimed === 'boolean'
			? { answer: body.claimed, retry: false }
			: { answer: null, retry: true };
	} catch {
		return { answer: null, retry: true };
	}
}

// ── the claim gate: draw a bubble only where a message can actually arrive ─────────────────────
//
// 🩸 WHY A MOUNT NOW ASKS FIRST. A site layout may put this coral on every page of a site at build
// time, and a build cannot know whether that site's owner ever opened the Inbox. The server refuses
// every message for a tenant without one — on purpose: nothing may switch itself on because a
// stranger used it. Each half is right, and together they were a button that failed every time it
// was pressed, on live sites, with the owner never told. A bubble that cannot deliver is worse than
// no bubble, so the decision moved to the one place that can see both halves: here, at view time.
//
// 🔴 THREE OUTCOMES AND NO FOURTH. Yes ⇒ the bubble, exactly as it was drawn before the gate. No ⇒
// nothing: no node, no listener, no storage, no further request. Could not ask ⇒ also nothing, and
// ask again on a fixed schedule; draw the moment somebody says yes. There is no「maybe」state on
// screen — not a greyed button, not a bubble that apologises when opened — because every such state
// is one a visitor can press and be let down by.
//
// 🔴 THE SAME QUESTION THE SERVER ASKS. `GET /api/inbox/session` answers `claimed` from the same
// settings row whose absence makes a message come back `not_claimed`, for every kind this coral
// mounts, so the bubble and the send cannot disagree about which tenants have an Inbox.
//
// 🩸 THE GATE DECIDES WHICH BUBBLE, NOT ONLY WHETHER (0.7.11, CVERInc/reef#1866). As first written
// it returned on every no — and `data-kaito="1"` on a tenant without an Inbox is not a broken
// install, it is the state owner ruling 54 describes by name: the ask-the-site half, bought on its
// own. That half needs nobody to receive anything, so the gate was hiding a working product behind
// a question about a different one. The three outcomes above are unchanged for a mount WITHOUT
// KAITO. With KAITO, a no and a「could not ask」both draw the ASK-ONLY bubble (`askOnly` in
// `mount`): the ask view and nothing else — no way to a person on screen, no conversation handle
// read or written, no question log, no `pagehide` listener, and the status line that says what is
// true there. It is still not a「maybe」state: everything it shows works, because everything that
// needs an Inbox is absent rather than greyed.
//
// 🔴「COULD NOT ASK」WITH KAITO IS ASK-ONLY, AT THE FIRST NON-ANSWER. The two ways to be wrong are
// not the same size: ask-only on a site that has an Inbox costs one page view without the route to
// a person; the full bubble on a site that has none is the button that fails every time, which is
// what the gate exists to end. And once something is drawn the asking stops (see `settleOnUnknown`),
// so the upgrade is the next page's — where a no was never remembered, and the question is asked
// again.

/**
 * How long this browser trusts a YES before asking again at mount — the log's own six hours.
 *
 * 🔴 ONLY A YES IS REMEMBERED. An Inbox, once opened, is not closed by its owner (a site that leaves
 * the platform stops answering yes, and the next ask after this window notices). A NO is never
 * written down: the person most likely to have just seen this site without an Inbox is its owner,
 * and they must see the bubble on the very next page after opening one — not six hours later.
 */
export const CLAIM_GATE_TTL_MS = AI_LOG_CLAIM_TTL_MS;
/**
 * How old a remembered yes may be and still stand in for an answer nobody could give.
 *
 * 🔴 ONLY FOR「NOBODY COULD SAY」, NEVER AGAINST A NO. Before the gate existed the bubble was drawn
 * without asking anything, so on a site that HAS an Inbox the gate must not add a new way to lose
 * it — a throttled address, a slow minute. Past the six hours a yes is due to be asked again, not
 * void: when the asking fails, a yes heard within this window is the best answer there is, and the
 * bubble is drawn. A definite no still wins over it and deletes it.
 */
export const CLAIM_GATE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * The waits between attempts when the question could not be asked — so at most four requests per
 * mount, forty seconds of waiting between them (100 s if every one also times out), and then nothing
 * until the next page. Not the log's five-minute backoff: that
 * one guards a buffer that can wait; this one decides whether a visitor sees a way to reach a person
 * on THIS page.
 */
export const CLAIM_GATE_RETRY_MS = Object.freeze([2000, 8000, 30000]);
/** Each attempt's own ceiling — a request that never comes back is a「could not ask」, not a hang. */
export const CLAIM_GATE_TIMEOUT_MS = 15_000;
const CLAIM_GATE_PREFIX = 'reef-inbox:claim:';

/** The remembered yes — beside the handle and the log, never inside either. */
export function claimGateKey(tenant) {
	return CLAIM_GATE_PREFIX + tenant;
}

/**
 * A yes this browser heard less than `CLAIM_GATE_TTL_MS` ago.
 *
 * Same posture as `parseHandle`: storage is a place other code can write, so anything but our own
 * shape is ignored rather than trusted — and a stamp from the future is not believed at all, or it
 * would never expire.
 */
export function rememberedClaim(storage, tenant, now = Date.now(), maxAge = CLAIM_GATE_TTL_MS) {
	if (!storage) return false;
	try {
		const raw = JSON.parse(storage.getItem(claimGateKey(tenant)));
		return !!raw && raw.claim === true && Number.isFinite(raw.at) && raw.at <= now &&
			now - raw.at < maxAge;
	} catch {
		return false;
	}
}

/** Writes a yes, forgets on a no, and leaves things alone when nobody answered. */
function rememberClaim(storage, tenant, claimed, now = Date.now()) {
	if (!storage || typeof claimed !== 'boolean') return;
	try {
		if (claimed) storage.setItem(claimGateKey(tenant), JSON.stringify({ claim: true, at: now }));
		else storage.removeItem(claimGateKey(tenant));
	} catch {
		// A store that will not take the write costs this browser one probe per page, nothing more.
	}
}

/** One attempt, cut off at `CLAIM_GATE_TIMEOUT_MS`; aborts the request it gave up on. */
function probeOnce(apiBase, kind, id) {
	const ctl = typeof AbortController === 'function' ? new AbortController() : null;
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => {
			if (ctl) ctl.abort();
			resolve({ answer: null, retry: true });
		}, CLAIM_GATE_TIMEOUT_MS);
	});
	return Promise.race([askInboxClaim(apiBase, kind, id, ctl ? ctl.signal : undefined), timeout])
		.finally(() => clearTimeout(timer));
}

/**
 * Ask until somebody answers, the schedule runs out, or asking again could not help (`throttled`, a
 * 4xx — see `askInboxClaim`): `true`/`false` is the answer, `null` is「nobody could say」.
 * `cancelled()` stops it between attempts (an SPA that took the container off while it was asking).
 */
async function awaitInboxClaim(apiBase, kind, id, cancelled, settleOnUnknown = false) {
	for (let attempt = 0; ; attempt++) {
		const { answer, retry } = await probeOnce(apiBase, kind, id);
		if (typeof answer === 'boolean' || cancelled()) return answer;
		// `settleOnUnknown`: the caller already has an answer to fall back on (a remembered yes, see
		// `CLAIM_GATE_STALE_MS`) and will draw on this `null` — so it must stop asking, or a later no
		// would arrive with a bubble already on screen and nothing honest to do about it.
		if (settleOnUnknown || !retry || attempt >= CLAIM_GATE_RETRY_MS.length) return null;
		await new Promise((resolve) => setTimeout(resolve, CLAIM_GATE_RETRY_MS[attempt]));
		if (cancelled()) return null;
	}
}

/** Mounts still waiting on their claim answer → the function that tells them to stop. */
const gating = new WeakMap();

// ── the site layout's loader hands over what it already learned (0.7.12, CVERInc/reef#1921) ─────
//
// sitetile no longer puts this file in a <script src> on every page: an inline loader asks the
// mount's claim question first and imports this coral only where it will draw. Two things that
// loader learned before this file existed on the page used to reach it the long way round, and
// both arrived wrong (codex review of tile#151):
//
// 🩸 THE ANSWER WENT THROUGH `localStorage`. The loader wrote the yes it heard, and the mount was
// meant to find it there. Where storage refuses the write or the read (quota, a privacy mode, a
// policy, a consent script that clears it on load) the mount found nothing, asked again, and a
// second answer — a no, a `throttled`, a 4xx — took away a bubble the first yes had earned.
//
// 🩸 THE HELD OPEN WAS REBROADCAST. The loader replayed a `reef-inbox:open` once the import had
// resolved — but this file's listeners exist from its own evaluation, before that, so an open
// dispatched in between was delivered to both and handled twice (a second focus, a second event
// for anyone else listening).
//
// 🔴 SO THE LOADER LEAVES THEM ON `window.__reefInboxLoader` AND THIS FILE TAKES THEM, ONCE, IN
// MEMORY: `{ v: 1, claims: { '<kind>:<id>': true | false | null }, open, taken }`. `claims` is the
// whole gate's outcome for a tenant the loader asked about on THIS page load (the same schedule,
// the same retries — `null` is「nobody could say」), so `mount` takes it instead of asking. `open`
// is an open nobody was listening for yet; `mount` honours it exactly like its own held open.
// `taken` is how the loader learns it must not replay anything: set here, in the same synchronous
// turn that installs this file's own listeners, so from that moment one listener — ours — hears
// every open. A loader that finds `taken` unset has an older coral; its fallbacks narrow the gap
// but do not close it (a probe write that succeeds does not make the later claim write succeed),
// so the loader REQUIRES this contract: `LOADER_HANDOFF_SINCE` is the floor the channel must not
// drop below while loader pages exist, and sitetile's loader test pins its `CORAL_FLOOR` to it.
// 🔴 Removing or renaming any of this is a breaking change for every site built with the loader.
//
// Taken by `mountAll`, not at the top of the module: behind the loader the document is always
// parsed by the time this file evaluates, so that IS evaluation — and a page that loads this file
// with a plain <script src> while still parsing keeps the loader's listener in charge until the
// mounts that will honour it exist. A shape this file does not know is left alone: a page script
// can write `window` exactly as it can write the remembered yes in `localStorage`, and earns the
// same trust — a value of the right type or nothing. A WELL-shaped one is honoured: a page script
// can draw the bubble without the question being asked, exactly as a forged remembered yes can.
// That is a UI bypass, not an authority — every send still needs the backend's own yes.
const LOADER_HANDOFF = '__reefInboxLoader';
/** The first version that takes the handoff — the floor for a channel behind the loader. */
export const LOADER_HANDOFF_SINCE = '0.7.12';

function takeLoaderHandoff() {
	if (typeof window === 'undefined') return null;
	const handoff = window[LOADER_HANDOFF];
	if (!handoff || typeof handoff !== 'object' || handoff.v !== 1 || handoff.taken === true) return null;
	handoff.taken = true;
	try {
		delete window[LOADER_HANDOFF];
	} catch {
		window[LOADER_HANDOFF] = undefined;
	}
	return handoff;
}

/** The loader's answer for this tenant: `true`/`false`/`null`, or `undefined` when it did not ask. */
function handedClaim(handoff, tenant) {
	const claims = handoff && handoff.claims;
	if (!claims || typeof claims !== 'object' || !Object.prototype.hasOwnProperty.call(claims, tenant)) return undefined;
	const claim = claims[tenant];
	return claim === true || claim === false || claim === null ? claim : undefined;
}

/**
 * The one-line status under the title — the part of the header that actually
 * changes as the conversation moves, so the title itself (the site's name)
 * never has to. Once a conversation has a handle, hand-off has happened —
 * the wording only needs to know whether an email came with it (SPEC §9's
 * "leave your email or come back to this page" split).
 *
 * 🔴 RETURNS SAFE HTML, NOT PLAIN TEXT — owner ruling 2026-09-06 #34 moved the
 * escaping IN here rather than leaving it at the call site. `headHtml()` used
 * to `escHtml()` this function's whole return value before inserting it, which
 * worked while the AI marker was literal text; it cannot work now that the
 * marker is a real `<span>`, because escaping the chip's own markup would
 * print `&lt;span…` instead of rendering it. So this function does the one
 * escaping decision itself: `assistantName` is owner/visitor-influenced
 * (`data-assistant-name`, `resolveAssistantName`) and is ALWAYS escaped before
 * it reaches the DOM; `copy.statusHandedOffEmail`/`statusHandedOffNoEmail` are
 * fixed translated strings with no interpolation and need none. The caller
 * inserts what comes back exactly as an HTML fragment, not as text content.
 */
export function statusFor(copy, { hasConv, hasEmail, kaitoOn, askOnly }, assistantName = DEFAULT_ASSISTANT_NAME) {
	if (hasConv) return hasEmail ? copy.statusHandedOffEmail : copy.statusHandedOffNoEmail;
	// tile#20: without KAITO there is no machine answering, so the line says only that a person
	// reads what is sent — no name, no chip. It may be the owner's `data-status`, hence escaped.
	if (!kaitoOn) return escHtml(copy.statusNoAi || '');
	// `copy.statusDefault(assistantName)` carries exactly one `AI_CHIP_TOKEN` — every locale's
	// entry places it unconditionally (see the token's own header comment) — splitting on it
	// yields the two plain-text halves around the chip. `String#split` on a string that never
	// contains the token would hand back a one-element array; `after` defaults to '' for that
	// case rather than rendering "undefined", though in practice every locale carries the token.
	//
	// `askOnly` — KAITO on a tenant with no Inbox (ruling 54's second line,「KAITO [AI] 用這個站的內容
	// 回答」). `statusDefault` promises that a person reads what is sent on, and there nobody does,
	// so it may not be shown. Same name slot, same one token, same chip.
	const raw = (askOnly && copy.statusAiOnly ? copy.statusAiOnly : copy.statusDefault)(assistantName);
	const [before, after = ''] = raw.split(AI_CHIP_TOKEN);
	return `${escHtml(before)}${AI_CHIP_HTML}${escHtml(after)}`;
}

/**
 * Has this human hand-off wound down, from the visitor's side?
 *
 * 🔴 A SERVER-DECLARED status wins when the `/api/inbox` response actually
 * carries one — `'closed'` or `'resolved'` — since the owner (or the backend)
 * is the one source of truth for "is anyone still going to write back here".
 * Today's response is `{ messages }` only (see docs/SPEC-visitor-messages.md
 * and reef `$lib/inbox/index.ts`'s `visitorTranscript`), so this branch is
 * forward-compatible rather than load-bearing right now.
 *
 * Lacking that field, the fallback reads the transcript itself: the owner
 * replied at some point and then `HANDOFF_STALE_MS` has passed with nothing
 * newer from them. 🩸 This is an approximation, stated so nobody mistakes it
 * for a real "closed" signal: a visitor who wrote back after the owner's last
 * reply still has the clock running from that reply, not their own follow-up,
 * because this file has no way to tell "still waiting" from "gave up" without
 * one. The cost of a false positive is one extra click behind a small
 * "回到真人對話" link back to the exact same thread; the cost of never firing
 * is the bug this file exists to fix — a visitor stuck looking at a dead
 * thread with no way to ask anything again, for days.
 */
export function handoffConcluded(messages, status, now = Date.now()) {
	if (status === 'closed' || status === 'resolved') return true;
	if (status) return false;
	if (!Array.isArray(messages) || !messages.length) return false;
	let lastOwnerAt = -1;
	for (const m of messages) {
		if (m && m.author === 'owner' && typeof m.at === 'number' && m.at > lastOwnerAt) lastOwnerAt = m.at;
	}
	if (lastOwnerAt < 0) return false; // the owner never replied — nothing has concluded, still waiting
	return now - lastOwnerAt > HANDOFF_STALE_MS;
}

/**
 * Which view the panel opens into — pure so the branching mount() does is one
 * function this file's tests can drive without a browser.
 *
 *   - no hand-off thread yet → ask KAITO when it is offered, else the plain
 *     compose form (unchanged first-time behaviour).
 *   - a concluded thread → ask mode always wins, regardless of what the
 *     visitor last chose — that is the automatic "next open" return this
 *     function exists for.
 *   - otherwise, the visitor's own last choice (`storedMode`), defaulting to
 *     the existing thread — this is what used to be the ONLY behaviour, and
 *     bug #1 (2026-09-04) was that it was the only behaviour forever.
 */
export function resolveViewMode({ hasHandoffConv, storedMode, concluded, kaitoOn }) {
	if (!hasHandoffConv) return kaitoOn ? 'ask' : 'human';
	if (concluded) return 'ask';
	return storedMode === 'ask' ? 'ask' : 'human';
}

/**
 * The poller's identity, so that stopping it stops the requests it already made (review B2).
 *
 * 🩸 `clearInterval` STOPS THE TIMER, NOT THE FETCH THAT IS ALREADY IN THE AIR. `refresh()` read
 * `conv` once on the way in and then wrote whatever came back straight into the panel, with no
 * second look at whether it was still the same panel. So: a visitor is mid-poll on conversation
 * A; a hand-off arrives; the poller is torn down, `conv` becomes B, the log is emptied and
 * redrawn; then A's fetch resolves and paints A's messages into B's log — `.dc-inbox-log` is the
 * class both views use, so the stale reply lands in the new conversation's window looking exactly
 * like part of it. If the new handle resolved to ask mode it is worse: 「問 KAITO」 shows a human
 * transcript. The same race existed on 「重新問」 before this branch, but only a visitor's own
 * click could open the window; #15 let any script open it at will, as often as it liked.
 *
 * 🔴 A GENERATION, NOT AN AbortController. Aborting cancels the request; this has to cancel the
 * RESULT, including a response that already arrived and is sitting in a resolved promise, and it
 * has to do it for every in-flight call at once rather than one handle at a time. Exported and
 * dependency-free so the race itself is testable with a delayed fetch and no browser.
 */
export function pollGeneration() {
	let current = 0;
	return {
		/** Everything in flight is now stale; results still to come are dropped. */
		invalidate() {
			current += 1;
		},
		/**
		 * Await `work`, then hand the result to `apply` — unless `invalidate()` ran while it was in
		 * flight, in which case `apply` is never called. Resolves to whatever `apply` returned, or
		 * `false` for a result that was thrown away. A rejected `work` is a `null` result, not a
		 * throw: the caller's failure handling is the same either way and this must never reach an
		 * unhandled rejection from a background timer.
		 */
		async run(work, apply) {
			const token = current;
			const got = await work().catch(() => null);
			if (token !== current) return false;
			return apply(got);
		}
	};
}

/**
 * #13: should a page LOAD, by itself, open the panel? Pure so mount()'s one-line call is the only
 * place this reads `location.hash`, and this file's tests can drive it without a browser.
 *
 * Exactly `#inbox`, not a prefix or substring test — a page's own anchor (`#inbox-pricing`, a
 * heading id that happens to start the same way) must not trip a widget its author never asked
 * for.
 *
 * 🔴 AND THE SITE HAS TO HAVE ASKED FOR IT — `data-open-on-hash="1"`, review B5. The original
 * reasoning here was that 「a site that wants this deliberately writes the literal fragment, the
 * same way data-kind is a deliberate attribute」, and that was simply wrong about who writes a
 * URL fragment: `location.hash` comes from whoever authored the LINK. Any external page, email,
 * QR code or search result could point at `https://customer.example/anything#inbox` and make a
 * customer's site pop a message panel open and pull the cursor into it, on any page, for every
 * visitor, with no way for the owner to turn it off. It is also a WCAG 3.2.1/3.2.5 change of
 * context nobody requested, on a `role="dialog"` with no Escape binding.
 *
 * An attribute is a different thing entirely: it is in the site's own markup, so the deliberate
 * act belongs to the person whose site it is. It also settles the other half of the same
 * problem — a docs page with an `<h2 id="inbox">`, or a hash-router SPA whose `#inbox` route is
 * its own, no longer trips a widget by coincidence.
 */
export function shouldAutoOpenFromHash(hash, optedIn) {
	if (optedIn !== '1') return false;
	return hash === '#inbox';
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * 🩸 Safe to put in an `href`?
 *
 * `escHtml` below stops a value breaking OUT of the attribute; it does nothing
 * about the SCHEME inside it, and the two look like the same job. A citation
 * whose `source_url` is `javascript:…` renders as a perfectly escaped link that
 * runs script when a visitor clicks it. Today that URL comes from the site's own
 * published corpus — but `ext` tenants push their own, so "our content" is not a
 * guarantee this file gets to rely on.
 *
 * 🔴 Asks the PARSER, never a prefix test: `java\nscript:` and a leading space
 * both defeat `startsWith` even lowercased, and both parse to `javascript:`.
 */
function safeHref(u) {
	try {
		const p = new URL(String(u)).protocol;
		return p === 'http:' || p === 'https:' ? String(u) : null;
	} catch {
		return null;
	}
}

function escHtml(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
}

/**
 * The closed bubble's glyph.
 *
 * A ROUNDED bubble, chosen by chodaict over the squared one: 「上面的比較好，
 * 圓圓的親切」. Support widgets are the friendliest thing on a page or they are
 * the most annoying, and the corner radius is most of that.
 *
 * 🔴 GEOMETRICALLY centred, not eyeballed. Centring the SVG BOX is not enough — a
 * glyph drawn off-centre inside a centred box still sits off-centre, which is
 * what the first attempt did (chodaict: 「注意按鈕內的位置」). The test measures
 * the path's real `getBBox()` in a chromium and fails if its centre drifts off
 * (12, 12), so redrawing this without balancing it is a red test, not a shrug.
 *
 * `currentColor` so the site's `--reef-inbox-on-accent` keeps working.
 */
const OPEN_ICON =
	'<svg class="dc-inbox-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
	'<path fill="currentColor" d="M12 3.255c-5.08 0-9.2 3.4-9.2 7.6 0 2.4 1.34 4.54 3.42 5.94-.12 1.06-.6 2.36-1.66 3.42-.22.22-.02.6.28.52 1.9-.3 3.56-1.08 4.76-2.16.76.18 1.56.28 2.4.28 5.08 0 9.2-3.4 9.2-7.6S17.08 3.4 12 3.4z"/>' +
	'</svg>';

/** The owner's two public position knobs, and the private properties this file writes them to. */
const OFFSET_KNOBS = [
	{ axis: 'x', knob: '--reef-inbox-offset-x', own: '--_reef-inbox-ox' },
	{ axis: 'y', knob: '--reef-inbox-offset-y', own: '--_reef-inbox-oy' }
];
/** Every public knob a page may set for the bubble — what crosses into the shadow root by inheritance. */
const KNOBS = ['--reef-inbox-accent', '--reef-inbox-on-accent', '--reef-inbox-bg', '--reef-inbox-fg', '--reef-inbox-offset-x', '--reef-inbox-offset-y'];
/** The conversation keeps at least this much height before the open panel is moved down to make room. */
const MIN_LOG_REM = 5;

/**
 * Reads the owner's position knobs, validates them, and places the bubble and its open panel
 * (0.7.16, reef#2418; reworked after the tile#199 review).
 *
 * 🩸 THE KNOBS ARE READ, NEVER REGISTERED. r1 typed them with a global `CSS.registerProperty`
 * `<length>`, so that a typo computed to 0px instead of invalidating the root's `bottom` (a fixed box
 * with both insets invalid drops to its static position: measured at (8,8), top-left). Three ways that
 * went wrong, all measured: a browser without the API, and a theme that had already registered the
 * names (`syntax:'*'`), both skipped the registration and put a typo'd bubble at (8,8) again; and
 * where it did succeed, a JS registration OUTRANKS a stylesheet's `@property` document-wide — a theme
 * that declared `--reef-inbox-offset-y` with `initial-value:80px` lost that 80px on its own elements
 * the moment the bubble mounted. A registration cannot be scoped to a shadow tree, so the coral does
 * not make one. The public names stay the page's, whatever (if anything) the page registered.
 *
 * 🔴 WHAT THE STYLESHEET CONSUMES IS PRIVATE AND ALWAYS VALID. Each knob is read from the host's
 * computed style (so a registered `@property` initial value counts like a set value, and an
 * unregistered one arrives as text), resolved to px through a hidden probe in the shadow root —
 * `outline-offset` takes a `<length>` and nothing else (no percentage, no keyword), resolves `em`
 * against the panel's own font and `calc()` too, and CSSOM silently refuses anything it cannot
 * parse — and written to `--_reef-inbox-ox/-oy` on the host as `<n>px`. Anything that is not a
 * length (`banana`, `12`, `10%`) is 0px. The stylesheet clamps those to 0..50% of the viewport.
 * Outside a browser (no `getComputedStyle`, or an element without `style.setProperty`) every call
 * here does nothing and the stylesheet's own fallbacks (0px) stand.
 *
 * 🩸 A HIGH OFFSET USED TO CUT THE COMPOSER OFF (tile#199 review P2-1). The panel grows up from the
 * raised corner, and its max-height is the room left above it; on a phone held sideways with a large
 * `-y` that room (142px, 128px) was shorter than the header plus the composer, and the panel's
 * `overflow:hidden` cut the textarea and Send button off. The stylesheet now gives every part but the
 * log its natural height (the log takes what is left and scrolls), and `fit()` checks the room: when
 * the header, the composer and `MIN_LOG_REM` of conversation do not fit at the owner's offset, the
 * OPEN panel's offset is lowered by exactly the shortfall (to 0 at most). The closed bubble keeps the
 * owner's offset. If even 0 is too little (a viewport under ~15rem tall), the panel itself scrolls
 * rather than clipping. position.smoke.mjs measures the controls themselves, not the panel's box.
 *
 * WHEN IT RUNS: at mount, on every render (open, close, a re-render), on window `resize` (which is
 * also how a rotation arrives), and while the panel is open, whenever one of the panel's fixed parts
 * changes size (a ResizeObserver: the search block appearing, a results list growing). A theme that
 * changes the knobs at runtime without any of those is picked up on the next open or close; there is
 * no cheap way to be told a custom property changed, and polling for it would cost every page.
 */
function createPlacement(host, shadow, root, el = host) {
	const live =
		typeof getComputedStyle === 'function' &&
		!!host.style &&
		typeof host.style.setProperty === 'function' &&
		typeof document.createElement === 'function';
	if (!live) return { update() {}, dispose() {} };
	const probe = document.createElement('span');
	probe.setAttribute('aria-hidden', 'true');
	probe.style.setProperty('display', 'none');
	shadow.appendChild(probe);

	/** Where the probe cannot answer: a bare px number (or 0) and nothing else. */
	const manualPx = (raw) => {
		const m = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i.exec(raw);
		if (!m) return null;
		const n = parseFloat(m[1]);
		return m[2] || n === 0 ? n : null;
	};

	/** A CSS length → px, or null when it is not a length. */
	function px(value) {
		const raw = String(value ?? '').trim();
		if (!raw) return null;
		if (typeof probe.style.getPropertyValue !== 'function') return manualPx(raw);
		probe.style.removeProperty('outline-offset');
		probe.style.setProperty('outline-offset', raw);
		// Refused by CSSOM: not a length.
		if (!probe.style.getPropertyValue('outline-offset')) return null;
		const resolved = getComputedStyle(probe).outlineOffset;
		if (typeof resolved !== 'string' || !resolved) return manualPx(raw);
		const out = parseFloat(resolved);
		return Number.isFinite(out) ? out : null;
	}

	/**
	 * 🔴 THE KNOBS ARE READ FROM THE CONTAINER, and carried to the host (review of tile#233, finding 3).
	 * Custom properties inherit along the DOM, and since 0.8.0 the host lives in the dock at the end of
	 * <body>, not inside `el`: a page that set `--reef-inbox-accent` or `--reef-inbox-offset-y` on a
	 * wrapper around the container (or inline on it) — not on `:root` — lost them. So the six knobs are
	 * read where the page wrote them, `el`, and each one that has a value there is set on the host,
	 * whose shadow stylesheet reads them as before; one without a value leaves the host to inherit.
	 */
	function carry(cs) {
		if (el === host) return;
		for (const knob of KNOBS) {
			const v = String(cs.getPropertyValue(knob) || '').trim();
			if (v) host.style.setProperty(knob, v);
			else host.style.removeProperty(knob);
		}
	}

	function want() {
		const cs = getComputedStyle(el);
		carry(cs);
		const out = {};
		for (const { axis, knob } of OFFSET_KNOBS) out[axis] = px(cs.getPropertyValue(knob)) ?? 0;
		return out;
	}

	function write(o) {
		for (const { axis, own } of OFFSET_KNOBS) host.style.setProperty(own, `${o[axis]}px`);
	}

	let observer = null;
	let observed = null;
	function unobserve() {
		if (observer) observer.disconnect();
		observer = null;
		observed = null;
	}

	/** Width the composer still lacks at the panel's current width: 10ch of text, a gap, the whole button. */
	function composerShort(panel) {
		const form = panel.querySelector(`.${PREFIX}-form`);
		const ta = form && form.querySelector('textarea');
		const btn = form && form.querySelector('button[type="submit"]');
		if (!ta || !btn) return 0;
		const num = (cs, ...k) => k.reduce((n, key) => n + (parseFloat(cs[key]) || 0), 0);
		const fcs = getComputedStyle(form);
		const tcs = getComputedStyle(ta);
		// The button at its one-line width — the size it has wherever it is not forced to wrap.
		btn.style.setProperty('max-width', 'none');
		btn.style.setProperty('white-space', 'nowrap');
		const button = btn.getBoundingClientRect().width;
		btn.style.removeProperty('max-width');
		btn.style.removeProperty('white-space');
		const need =
			num(fcs, 'paddingLeft', 'paddingRight') +
			num(tcs, 'minWidth', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth') +
			num(fcs, 'columnGap') +
			button;
		return Math.ceil(need - form.clientWidth);
	}

	/**
	 * Lowers the open panel's offsets until its parts fit: `-y` until the header, the composer and
	 * some conversation fit above the corner, `-x` until the composer's 10ch of text and its whole
	 * button fit left of it (tile#199 review r3: a 50vw `-x` on a 390px phone left a 163px panel, and
	 *「Send to the owner」took all of it). The two interact — a narrower composer wraps and gets taller —
	 * so it is a few passes, each lowering either by exactly its shortfall, and never below 0.
	 */
	function fit(panel, o) {
		const log = panel.querySelector(`.${PREFIX}-log`);
		const rem = px('1rem') || 16;
		let x = Math.min(Math.max(o.x, 0), px('50vw') ?? Infinity);
		let y = Math.min(Math.max(o.y, 0), px('50vh') ?? Infinity);
		for (let pass = 0; pass < 4; pass++) {
			write({ x, y });
			const shortX = composerShort(panel);
			// The room this corner leaves is the panel's max-height; a forced height reads it back.
			panel.style.setProperty('height', '100000px');
			const room = panel.getBoundingClientRect().height;
			panel.style.removeProperty('height');
			let fixed = 0;
			for (const part of panel.children) {
				if (part === log) continue;
				const cs = getComputedStyle(part);
				if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
				fixed += part.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
			}
			const shortY = Math.ceil(fixed + MIN_LOG_REM * rem - room);
			const nx = shortX > 0 ? Math.max(0, x - shortX) : x;
			const ny = shortY > 0 ? Math.max(0, y - shortY) : y;
			if (nx === x && ny === y) break;
			x = nx;
			y = ny;
		}
		write({ x, y });
		if (typeof ResizeObserver === 'function' && observed !== panel) {
			unobserve();
			observed = panel;
			observer = new ResizeObserver(() => update());
			// The composer is one of these: a button relabelled after open (「Send」→「Send to a person」
			// once search loads) no longer fits its row, wraps, and the form's new height is the signal.
			for (const part of panel.children) if (part !== log) observer.observe(part);
		}
	}

	function update() {
		const o = want();
		const panel = root.querySelector(`.${PREFIX}-panel`);
		if (!panel) {
			unobserve();
			write(o);
			return;
		}
		fit(panel, o);
	}

	const onResize = () => update();
	window.addEventListener('resize', onResize);
	return {
		update,
		dispose() {
			unobserve();
			window.removeEventListener('resize', onResize);
		}
	};
}

/**
 * The panel's stylesheet, written into the mount's OWN shadow root (0.7.13, reef#2139).
 *
 * 🩸 WHY A SHADOW ROOT. Up to 0.7.12 this `<style>` went into `document.head` and the bubble sat in
 * the light DOM behind one class (specificity 0,1,0) that set width, height, radius and padding and
 * nothing else. Every property it left unset was the page's to fill in — and not only the page's:
 * a browser extension's cosmetic CSS (Dark Reader, Grammarly, translators, ad blockers; common on
 * Windows Chrome) is page CSS too. Measured for reef#2139: one `button{min-width:88px}` turned the
 * bubble into an 88×56 capsule, and on a layered host an unlayered `button{border-radius:4px}` beat
 * every rule here regardless of specificity. A document-level selector cannot match inside a
 * shadow tree, so the coral's look is now the coral's.
 *
 * 🔴 WHAT STILL CROSSES THE BOUNDARY, ON PURPOSE: inherited properties. The two colour knobs a site
 * theme sets (`--reef-inbox-accent`, `--reef-inbox-on-accent`, and the panel's `-bg`/`-fg`) are
 * custom properties, which inherit into a shadow tree — so a site's own theme still wins without
 * this file knowing anything about it. `font` inherits too, and `:host` says so out loud: the panel
 * speaks in the site's typeface, as it did in the light DOM. shape.smoke.mjs measures all three.
 *
 * Still wrapped by `withDynamicCoralCssLayer` on a layered host: inside a shadow tree nothing from
 * the page competes with the layer, so the wrapper changes no outcome, and keeping it keeps the one
 * rule dynamic-coral-css-registry.test.mjs holds every coral to.
 */
function styleElement() {
	const style = document.createElement('style');
	const css = `
:host{font:inherit}
/* WHERE IT SITS (0.7.16, reef#2418). A field report: on a phone the bubble covered a page title in
   the bottom-right corner. The base is still 1rem from the corner; to it are ADDED the safe-area
   inset (a home indicator, a notch side) and the owner's own offset, clamped to 0..50% of the
   viewport so neither a negative value nor a huge one can push it into the inset or off the screen.
   On a page without viewport-fit=cover the browser reports every env(safe-area-inset-*) as 0 (the
   viewport is already inset), so there this is exactly the old 1rem. The two sums are kept as
   properties because the panel below sizes itself against them.
   🔴 NOT var(--reef-inbox-offset-*): the public knobs are the page's, unvalidated text (a typo would
   invalidate right/bottom). createPlacement() reads and validates them and writes these two private
   px values on the host; 0px when it has not (yet) run. */
.${PREFIX}-root{position:fixed;z-index:2147483000;font:inherit;
  --${PREFIX}-right:calc(1rem + clamp(0px,var(--_reef-inbox-ox,0px),50vw) + env(safe-area-inset-right,0px));
  --${PREFIX}-bottom:calc(1rem + clamp(0px,var(--_reef-inbox-oy,0px),50vh) + env(safe-area-inset-bottom,0px));
  right:var(--${PREFIX}-right);bottom:var(--${PREFIX}-bottom);
  display:flex;flex-direction:column;align-items:flex-end;gap:var(--dc-dock-gap,.5rem)}
/* IN THE DOCK (reef#2790). The corner is the dock's: its margin, the safe areas, the site-wide bottom
   reserve and the stacking with the site's own corner items. The root is then an ordinary box inside
   the host the dock lays out; the owner's offset knobs (still read and validated by
   createPlacement()) become margins on it, so a raised inbox lifts itself and whatever is stacked
   above it, exactly as far as before. The fixed rule above is for a host that could not join a dock. */
:host([data-docked]) .${PREFIX}-root{position:relative;right:auto;bottom:auto;z-index:auto;
  margin:0 clamp(0px,var(--_reef-inbox-ox,0px),50vw) clamp(0px,var(--_reef-inbox-oy,0px),50vh) 0}
:host([data-docked="bar"]) .${PREFIX}-root{margin:0;align-items:stretch;align-self:stretch}
/* 🔴 EVERY SHAPE PROPERTY IS SET, not only the four that draw it (reef#2139). The shadow root keeps
   the page's selectors out; the one stylesheet that still reaches this button is the browser's
   own, and its button defaults are exactly these properties, differently per engine. So the shape
   does not depend on what any stylesheet but this one leaves unset: min-width (the measured
   capsule), box-sizing (a content-box reset), aspect-ratio and flex (a flex parent), appearance
   (a native button look), margin. 50% rather than 999px: on a square box the same circle, and an
   ellipse rather than a capsule if a size ever does get through. */
.${PREFIX}-open{box-sizing:border-box;margin:0;border:0;padding:0;
  width:3.5rem;height:3.5rem;min-width:0;min-height:0;max-width:none;max-height:none;
  aspect-ratio:1;flex:none;border-radius:50%;-webkit-appearance:none;appearance:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff);
  box-shadow:${DOCK_SHADOW};line-height:0}
/* The SHAPE is the dock's (reef#2790): size, radius and shadow arrive as --dc-dock-* from the dock this
   bubble sits in — a round 3.5rem bubble in a corner, a square tab in an installed app's bar. The
   fallbacks are the same round bubble, for a host outside any dock. The shadow is the dock's budget
   (0 1px 3px + 0 4px 12px: 16px of reach, inside the 16px margin); 0 6px 24px was cut by the screen edge. */
:host([data-docked]) .${PREFIX}-open{width:var(--dc-dock-w,3.5rem);height:var(--dc-dock-size,3.5rem);
  border-radius:var(--dc-dock-radius,50%);box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW});
  background:var(--dc-dock-item-bg,var(--reef-inbox-accent,#111));color:var(--dc-dock-item-ink,var(--reef-inbox-on-accent,#fff))}
:host([slot="more"]) .${PREFIX}-open{justify-content:flex-start;gap:.75rem;height:3rem;font-size:1rem;line-height:1.2}
:host([slot="more"]) .${PREFIX}-open::after{content:attr(aria-label)}
.${PREFIX}-open:focus-visible{outline:2px solid var(--reef-inbox-accent,#111);outline-offset:2px}
.${PREFIX}-icon{width:1.6rem;height:1.6rem;display:block;flex:none}
/* The open panel grows up and to the left from the same corner, so what keeps it on screen is the
   room left of and above that corner, less 1rem and the opposite inset. With no offset and no inset
   both reduce to the old calc(100vw - 2rem) and min(30rem,70vh). dvh after vh: a phone's toolbar. */
.${PREFIX}-panel{width:min(22rem,calc(100vw - var(--${PREFIX}-right) - 1rem - env(safe-area-inset-left,0px)));
  max-height:min(30rem,70vh,calc(100vh - var(--${PREFIX}-bottom) - 1rem - env(safe-area-inset-top,0px) - 4rem));
  max-height:min(30rem,70dvh,calc(100dvh - var(--${PREFIX}-bottom) - 1rem - env(safe-area-inset-top,0px) - 4rem));
  display:flex;flex-direction:column;border-radius:.9rem;overflow-x:hidden;overflow-y:auto;
  background:var(--reef-inbox-bg,#fff);color:var(--reef-inbox-fg,#111);
  box-shadow:${DOCK_SHADOW};visibility:visible}
/* In the dock the panel sits directly above its own bubble (reef#2790), so the room it may take is the
   dock's visible height less the bubble and every item below it (--_dc-below, counted on open: every
   item is the same size, so counting is exact — no measuring). The 30rem / 70vh caps are unchanged. */
:host([data-docked]) .${PREFIX}-panel{
  width:min(22rem,calc(var(--dc-dock-panel-w,100vw) - clamp(0px,var(--_reef-inbox-ox,0px),50vw)));
  max-height:min(30rem,70vh,calc(var(--dc-dock-room,100vh) - clamp(0px,var(--_reef-inbox-oy,0px),50vh) - (var(--_dc-below,0) + 1) * (var(--dc-dock-size,3.5rem) + var(--dc-dock-gap,.5rem))));
  max-height:min(30rem,70dvh,calc(var(--dc-dock-room,100dvh) - clamp(0px,var(--_reef-inbox-oy,0px),50vh) - (var(--_dc-below,0) + 1) * (var(--dc-dock-size,3.5rem) + var(--dc-dock-gap,.5rem))));
  box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW})}
/* In an installed app's bar the panel is a sheet above the bar, as wide as the screen. */
:host([data-docked="bar"]) .${PREFIX}-panel{position:fixed;left:0;right:0;bottom:calc(var(--dc-dock-size,3.5rem) + env(safe-area-inset-bottom,0px));
  width:auto;max-height:var(--dc-dock-room,calc(100vh - 4.5rem));border-radius:.9rem .9rem 0 0;
  box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14)}
@media print{.${PREFIX}-root{display:none}}
.${PREFIX}-head{display:flex;align-items:flex-start;justify-content:space-between;
  gap:.5rem;padding:.75rem .9rem;border-bottom:1px solid rgba(0,0,0,.08)}
.${PREFIX}-head-text{min-width:0}
.${PREFIX}-head h2{margin:0;font-size:1rem;font-weight:600;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-status{margin:.15rem 0 0;font-size:.75rem;opacity:.65;line-height:1.4}
/* The AI chip (owner ruling 2026-09-06 #34) — a Discord-APP-style badge, not the "(AI)" /
   "（AI）" parenthetical this replaced. Small-caps rather than shrunk-and-uppercased, so it
   reads as a label and not as shouting; the background is a neutral grey wash rather than a
   new --reef-inbox-* custom property for one badge (same non-brand posture as .${PREFIX}-msg-
   owner two rules down). inline-block so its own margin — not a text-level space baked into any
   locale string — is what separates it from its neighbours, uniformly across every locale. */
.${PREFIX}-ai-chip{display:inline-block;margin:0 .3em;padding:0 .35em;border-radius:.3em;
  font-size:.85em;font-weight:600;font-variant:all-small-caps;line-height:1.5;
  background:rgba(127,127,127,.28);vertical-align:baseline}
/* 「重新問 KAITO」/「新對話」in the human thread, or 「回到真人對話」in ask/fresh
   mode (that one carries .dc-inbox-quiet too, styled below, once it exists). */
.${PREFIX}-second{display:block;margin:.35rem 0 0;border:1px solid currentColor;border-radius:.45rem;
  padding:.2rem .5rem;cursor:pointer;background:transparent;color:inherit;font:inherit;font-size:.72rem}
.${PREFIX}-ended{margin:.3rem 0 0;text-align:left}
.${PREFIX}-close{border:0;background:none;cursor:pointer;font-size:1.1rem;line-height:1;
  padding:.25rem;color:inherit;opacity:.6}
/* 🩸 WHEN THE PANEL IS SHORT, ONLY THE LOG GIVES (tile#199 review P2-1). Every other part (header,
   hint, search, error, composer) keeps its content height: a flex item does not shrink below it. The
   log takes what is left and scrolls (min-height:0 is a scroll container's automatic minimum anyway;
   written out because it is the point). r1's clip was the room itself being shorter than the header
   plus the composer, so the panel's own overflow cut the Send button off; createPlacement() now keeps
   that room, and the panel's overflow-y:auto is the last resort for a viewport too short even at
   offset 0, so a control is scrolled to, never cut off. */
.${PREFIX}-log{flex:1;min-height:0;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.6rem}
.${PREFIX}-msg{max-width:85%;padding:.5rem .7rem;border-radius:.7rem;font-size:.9rem;
  line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.${PREFIX}-msg-visitor{align-self:flex-end;background:var(--reef-inbox-accent,#111);
  color:var(--reef-inbox-on-accent,#fff)}
.${PREFIX}-msg-owner{align-self:flex-start;background:rgba(0,0,0,.06)}
.${PREFIX}-hint{font-size:.8rem;opacity:.65;margin:0;text-align:center}
/* 🩸 A .dc-inbox-seen rule lived here until 0.7.3 — the 「站主看得到」 footer under the form, with a
   comment saying it may never be hidden. The owner removed the SENTENCE (2026-09-07), and a rule
   for an element nothing renders is dead CSS that reads like a live promise, so it went with it.
   What the line was defending is unchanged and now lives in the status line above the log: the
   panel still says, before anyone types, that a person is on the other end. */
.${PREFIX}-src{display:block;margin-top:.4rem;font-size:.75rem;opacity:.7;color:inherit}
.${PREFIX}-tohuman{align-self:flex-start;border:1px solid currentColor;border-radius:.5rem;
  padding:.35rem .7rem;cursor:pointer;background:transparent;color:inherit;font:inherit;font-size:.8rem}
.${PREFIX}-tohuman[disabled]{opacity:.5;cursor:default}
.${PREFIX}-handoff{align-self:stretch;display:flex;flex-direction:column;gap:.45rem;
  padding:.7rem;border:1px solid rgba(0,0,0,.12);border-radius:.7rem}
.${PREFIX}-handoff label{font-size:.78rem}
.${PREFIX}-handoff textarea,.${PREFIX}-handoff input{box-sizing:border-box;width:100%;margin-top:.2rem;
  border:1px solid rgba(0,0,0,.15);border-radius:.45rem;padding:.45rem .55rem;font:inherit;
  font-size:max(1rem,16px);background:transparent;color:inherit}
.${PREFIX}-handoff textarea{resize:vertical;min-height:4.5rem}
.${PREFIX}-email-note{font-size:.72rem;opacity:.7;margin:0;line-height:1.4}
.${PREFIX}-handoff-actions{display:flex;justify-content:flex-end;gap:.45rem}
.${PREFIX}-handoff-actions button{border:1px solid currentColor;border-radius:.45rem;padding:.4rem .7rem;
  cursor:pointer;background:transparent;color:inherit;font:inherit}
.${PREFIX}-handoff-actions button[type="submit"]{background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff)}
.${PREFIX}-handoff :disabled{opacity:.5;cursor:default}
/* After a real answer the offer is a quieter afterthought, not a second CTA
   competing with the answer the visitor just got. */
.${PREFIX}-quiet{border-color:transparent;opacity:.6;padding-left:0}
/* 🩸 THE COMPOSER NEVER GIVES ITS TEXT AWAY (tile#199 review r3). In a narrow panel the button used to
   keep its width and the textarea took whatever was left — 0px of text under「Send to the owner」.
   The textarea keeps at least 10ch of CONTENT width (box-sizing stated, so min-width is the text
   area itself): about two words, enough to see what one is typing and where the caret is; less is
   a slot, not a box. createPlacement() moves the open panel in from a high -x so that 10ch and the
   whole button fit on one line; where even offset 0 is too narrow, the row wraps and the button
   drops below the textarea, its own label wrapping before it would ever leave the panel. */
.${PREFIX}-form{display:flex;flex-wrap:wrap;gap:.5rem;padding:.7rem;border-top:1px solid rgba(0,0,0,.08)}
.${PREFIX}-form textarea{flex:1 1 10ch;box-sizing:content-box;min-width:10ch;resize:none;border:1px solid rgba(0,0,0,.15);border-radius:.5rem;
  padding:.45rem .55rem;font:inherit;font-size:max(1rem,16px);min-height:2.6rem;max-height:7rem;
  background:transparent;color:inherit}
.${PREFIX}-form button{flex:none;max-width:100%;min-height:2.6rem;margin-left:auto;white-space:normal;
  overflow-wrap:anywhere;border:0;border-radius:.5rem;padding:0 .9rem;cursor:pointer;
  background:var(--reef-inbox-accent,#111);color:var(--reef-inbox-on-accent,#fff);font-size:.9rem}
.${PREFIX}-form button[disabled]{opacity:.5;cursor:default}
.${PREFIX}-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.${PREFIX}-error{margin:0 .9rem .6rem;font-size:.85rem;color:#b3261e}
/* reef#2160: the in-site search block above the composer. A LIST of links, not bubbles: no
   rounded message shape, an accent rule on the left, title and date on one row — so an old post
   is never read as the assistant's answer. Hidden until the index is known to have rows. */
.${PREFIX}-search{padding:.5rem .9rem 0;border-top:1px solid rgba(0,0,0,.08)}
.${PREFIX}-search[hidden]{display:none}
.${PREFIX}-search-note{margin:0 0 .35rem;font-size:.72rem;opacity:.65;line-height:1.4}
.${PREFIX}-results{list-style:none;margin:0;padding:0;max-height:9.5rem;overflow-y:auto}
.${PREFIX}-results[hidden]{display:none}
.${PREFIX}-result a{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem;
  margin:0 0 .15rem;padding:.3rem .5rem;border-left:3px solid var(--reef-inbox-accent,#111);
  border-radius:0 .35rem .35rem 0;color:inherit;text-decoration:none;font-size:.85rem;line-height:1.35}
.${PREFIX}-result a:hover,.${PREFIX}-result a:focus{background:rgba(0,0,0,.06)}
.${PREFIX}-result-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-result time{flex:none;font-size:.72rem;opacity:.6;font-variant-numeric:tabular-nums}
@media (prefers-color-scheme:dark){
  .${PREFIX}-panel{background:var(--reef-inbox-bg,#1c1c1e);color:var(--reef-inbox-fg,#f2f2f7)}
  .${PREFIX}-msg-owner{background:rgba(255,255,255,.10)}
  .${PREFIX}-head,.${PREFIX}-form{border-color:rgba(255,255,255,.12)}
  .${PREFIX}-form textarea{border-color:rgba(255,255,255,.2)}
  .${PREFIX}-search{border-color:rgba(255,255,255,.12)}
  .${PREFIX}-result a:hover,.${PREFIX}-result a:focus{background:rgba(255,255,255,.10)}
}
@media (prefers-reduced-motion:no-preference){.${PREFIX}-panel{animation:${PREFIX}-in .16s ease-out}}
@keyframes ${PREFIX}-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;
	// Layered only for a site whose document root declares it (absent = legacy, unchanged).
	style.textContent = withDynamicCoralCssLayer(css);
	return style;
}

// 🔴 No `copy` parameter any more (0.7.3): `copy.empty` was the only string this function ever
// read, and a parameter nothing reads is the next thing somebody re-fills with a sentence.
function renderLog(logEl, messages) {
	// 🔴 An empty thread is EMPTY (0.7.3). This used to paint `copy.empty` —
	// 「想問什麼都可以，是真人在看。」— and that sentence was removed by the same ruling that
	// removed it from the ask panel, so the placeholder in the box below is the only invitation
	// left. Deliberately not replaced with a different sentence: the ruling was about how many
	// lines the panel says before the visitor types, and this is one of them.
	if (!messages.length) {
		logEl.innerHTML = '';
		return;
	}
	logEl.innerHTML = messages
		.map(
			(m) =>
				`<div class="${PREFIX}-msg ${PREFIX}-msg-${m.author === 'owner' ? 'owner' : 'visitor'}">${escHtml(m.text)}</div>`
		)
		.join('');
	logEl.scrollTop = logEl.scrollHeight;
}

// ── the network ─────────────────────────────────────────────────────────────

/**
 * 🔴 The conversation id travels in a HEADER, not the query string.
 *
 * It is a bearer token: whoever holds it reads this whole transcript. A query
 * string is written into edge logs, into browser history, and into a `Referer`
 * the day this panel renders any link — a header is in none of those.
 */
/**
 * Returns `{ messages, status }`, or `null` when the fetch failed outright.
 *
 * `status` is speculative — see `handoffConcluded`'s header comment. Reading
 * it here costs nothing and means the day `/api/inbox` starts sending it,
 * this file already listens.
 */
async function fetchTranscript(apiBase, kind, id, conv) {
	const url = `${apiBase}/api/inbox?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
	const res = await fetch(url, {
		headers: { accept: 'application/json', 'x-inbox-conversation': conv }
	});
	if (!res.ok) return null;
	const body = await res.json();
	if (!Array.isArray(body && body.messages)) return null;
	return { messages: body.messages, status: typeof body.status === 'string' ? body.status : null };
}

/**
 * Ask the site. Returns a render-ready shape, or null when we could not ask.
 *
 * 🔴 CITED-ALWAYS, defence in depth: a `grounded` answer that arrives without a
 * source_url is demoted to a refusal here, exactly as `$lib/kaito/widget.ts`
 * does for our own page. KAITO shows a citation or it shows nothing — and this
 * file is a separate implementation of the same promise, so it has to keep it
 * on its own rather than trusting the wire.
 */
/**
 * Which locale THIS page is served under, as the site's own URL segment —
 * 'ja-jp', or '' for a bare page (the site's primary locale, and every
 * single-locale site).
 *
 * 🩸 The bubble has always known its page's language — `declared` above reads
 * `<html lang>` to pick this widget's own UI copy — and never told the engine.
 * So a visitor reading the Japanese page could be handed the Korean copy of the
 * same paragraph: four translations of one sentence sit almost on top of each
 * other in a multilingual embedding space, and the tie broke arbitrarily.
 * Measured 2026-08-21 across two live sites: 27 of 70 grounded answers came back
 * in a language the visitor had not asked in.
 *
 * 🔴 The URL SEGMENT, not `<html lang>`. The segment is exactly what the stored
 * citation URLs carry, so the two compare without a locale table on either side —
 * and a site that adds a locale needs no release here. `<html lang>` is a BCP-47
 * tag in a different spelling ('zh-Hant' for a page served at /zh-tw/), which is
 * the sort of near-miss that matches nothing and fails silently.
 */
function pageLocale() {
	try {
		const seg = String(location.pathname || '').replace(/^\/+/, '').split('/')[0] || '';
		return /^[a-z]{2}-[a-z]{2}$/i.test(seg) ? seg.toLowerCase() : '';
	} catch {
		return '';
	}
}

async function askKaito(apiBase, kind, id, query, copy) {
	let res;
	try {
		res = await fetch(`${apiBase}/api/kaito`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, id, query, locale: pageLocale() })
		});
	} catch {
		return null;
	}
	// A 503 is the engine saying it cannot answer at all — retrying the same question will not
	// help, so it is told apart from the failures a retry can fix. Everything else stays `null`.
	if (res.status === 503) return { kind: 'unavailable' };
	if (!res.ok) return null;
	let body;
	try {
		body = await res.json();
	} catch {
		return null;
	}
	// cited-always, and now cite-SAFELY: an answer whose citation cannot be
	// linked is demoted exactly like one that has no citation at all. KAITO shows
	// a usable citation or it shows nothing.
	if (body && body.kind === 'grounded' && body.text && safeHref(body.source_url)) {
		return { kind: 'grounded', text: String(body.text), source_url: String(body.source_url) };
	}
	// 🩸 The refusal is UI COPY, not content — and the visitor's language is a
	// CLIENT fact. Until 2026-08-19 this returned the server's string verbatim, so
	// a Japanese visitor asking 「俺のこと知ってんの？」 on a Japanese page was
	// answered 「我沒有這方面的紀錄」. The server keeps its fixed string as the
	// default for callers that are not a browser (the Discord card path), and the
	// bubble — which already knows what language its page is in — says it here.
	//
	// 🔴 Only the REFUSAL. A grounded answer is a stored passage from the owner's
	// own page and is returned verbatim, in whatever language they wrote it. That
	// is the cited-always guarantee, and it is not ours to translate.
	if (body && typeof body.text === 'string' && body.text) {
		return { kind: 'refused', text: copy.refused || body.text };
	}
	return null;
}

function inboxErrorText(status, body, copy) {
	if (status === 507 && body?.reason === 'inbox_storage_full') return copy.errorInboxStorageFull;
	return status === 429 ? copy.rate : copy.error;
}

async function send(apiBase, payload) {
	const res = await fetch(`${apiBase}/api/inbox`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		/* a body we cannot read is handled by status alone below */
	}
	return { status: res.status, body };
}

/**
 * Wire the shared one-at-a-time, keyboard-safe compose behaviour. `onCleared` runs after a
 * successful send empties the draft: assigning `textarea.value` fires no `input` event, so
 * anything that follows the box (the reef#2160 search list) is told here.
 */
export function bindCompose(form, textarea, button, pendingLabel, idleLabel, onSend, onCleared) {
	let sending = false;
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (sending) return;
		const text = textarea.value.trim();
		if (!text) return;

		sending = true;
		button.disabled = true;
		button.textContent = pendingLabel;
		textarea.setAttribute('aria-busy', 'true');
		let succeeded = false;
		try {
			succeeded = (await onSend(text)) === true;
			if (succeeded) {
				textarea.value = '';
				if (onCleared) onCleared();
			}
		} finally {
			sending = false;
			button.disabled = false;
			// reef#2160: a function, so a label that depends on state the search wiring learns after
			// the first open (「問 AI」/「傳給真人」once the index has rows) survives a send.
			button.textContent = typeof idleLabel === 'function' ? idleLabel() : idleLabel;
			textarea.removeAttribute('aria-busy');
			textarea.focus();
		}
	});
	textarea.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
		event.preventDefault();
		if (!sending) form.requestSubmit();
	});
}

export function inboxPayload(kind, id, conv, text, pageUrl, hp = '', visitorName = '', visitorEmail = '') {
	const payload = { kind, id, conversation_id: conv, text, page_url: pageUrl, _hp: hp };
	if (visitorEmail.trim()) payload.visitor_email = visitorEmail.trim();
	if (visitorName.trim()) payload.visitor_name = visitorName.trim();
	return payload;
}

export function handoffFormHtml(copy, question) {
	return `<form class="${PREFIX}-handoff">
  <label>${escHtml(copy.placeholder)}<textarea name="text" rows="3">${escHtml(question)}</textarea></label>
  <label>${escHtml(copy.name)}<input name="visitor_name" autocomplete="name"></label>
  <label>${escHtml(copy.email)}<input name="visitor_email" type="email" autocomplete="email"></label>
  <p class="${PREFIX}-email-note">${escHtml(copy.emailNote)}</p>
  <label class="${PREFIX}-hp" aria-hidden="true" style="${HP_STYLE}"><span>Leave this empty</span><input type="text" name="_hp" tabindex="-1" autocomplete="off"></label>
  <div class="${PREFIX}-handoff-actions"><button type="button" data-cancel>${escHtml(copy.cancel)}</button><button type="submit">${escHtml(copy.send)}</button></div>
</form>`;
}

export function refusalNeedsHandoffForm(answer) {
	return !answer || answer.kind !== 'grounded';
}

// ── mount ───────────────────────────────────────────────────────────────────

export async function mount(el, handoff = null) {
	const kind = el.getAttribute('data-kind') || '';
	const id = el.getAttribute('data-id') || '';
	const kaitoOn = el.getAttribute('data-kaito') === '1';
	const apiBase = (el.getAttribute('data-api-base') || DEFAULT_API_BASE).replace(/\/$/, '');
	// reef#2160: the index this bubble may search, or '' — see the SEARCH_* constants' header.
	const searchIndexUrl = String(el.getAttribute('data-search-index') || '').trim();
	if (!kind || !id) {
		// Named, and visible only to whoever embedded it — a silent no-op here
		// means an owner who thinks they installed a bubble and has not.
		el.innerHTML = `<p class="${PREFIX}-error">inbox-bubble: missing data-kind / data-id</p>`;
		return;
	}
	const tenant = `${kind}:${id}`;

	// The claim gate — see its header above `CLAIM_GATE_TTL_MS`. A remembered yes takes no await at
	// all, so on a site with an Inbox every page after the first draws exactly when it always did.
	// Otherwise nothing below runs — no style, no node, no listener, no storage — until a yes arrives,
	// or, with KAITO, until the gate settles on the ask-only bubble.
	const gateStore = (() => {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	})();
	/**
	 * A `reef-inbox:open` that arrived while the gate was still asking — see `heldOpen` below — or
	 * one the site layout's loader held before this file was on the page (see `takeLoaderHandoff`).
	 */
	let openRequested = !!(handoff && handoff.open === true);
	/**
	 * KAITO on a tenant the gate did not hear a yes for: the ask view and nothing that needs an
	 * Inbox — see the gate's header. Decided once, here, and never revised by this mount.
	 */
	let askOnly = false;
	const handed = handedClaim(handoff, tenant);
	if (handed !== undefined) {
		// The loader already ran this whole gate on this page load — asking again is the request, and
		// the second answer, that the handoff exists to remove. It also wrote the yes down (or tried
		// to), so nothing is written here. Same outcomes as the awaited branch below.
		const fallback = rememberedClaim(gateStore, tenant, Date.now(), CLAIM_GATE_STALE_MS);
		if (handed === false || (handed === null && !fallback)) {
			if (!kaitoOn) return;
			askOnly = true;
		}
	} else if (!rememberedClaim(gateStore, tenant)) {
		let cancelled = false;
		// 🩸 AN OPEN ASKED FOR WHILE WE ASK IS HELD, NOT DROPPED. A site's own `DOMContentLoaded`
		// handler (a footer「report a problem」link, say) may dispatch `reef-inbox:open` a round trip
		// before there is an answer — the exact race the listener-before-first-fetch rule further
		// down exists to prevent. So a stand-in listener only remembers that it was asked; it is
		// removed when the answer arrives, whatever it is, or on `unmount`, and the request is
		// honoured only when a bubble is drawn. It opens nothing itself: there is no panel to open yet.
		const heldOpen = () => {
			openRequested = true;
		};
		window.addEventListener('reef-inbox:open', heldOpen);
		gating.set(el, () => {
			cancelled = true;
			window.removeEventListener('reef-inbox:open', heldOpen);
		});
		// An expired yes, still young enough to stand in for an answer nobody could give.
		const fallback = rememberedClaim(gateStore, tenant, Date.now(), CLAIM_GATE_STALE_MS);
		// `|| kaitoOn`: a KAITO mount draws on a non-answer too (ask-only), so it stops at the first.
		const claimed = await awaitInboxClaim(apiBase, kind, id, () => cancelled, fallback || kaitoOn);
		if (cancelled) return;
		gating.delete(el);
		window.removeEventListener('reef-inbox:open', heldOpen);
		rememberClaim(gateStore, tenant, claimed);
		if (claimed === false || (claimed === null && !fallback)) {
			if (!kaitoOn) return;
			askOnly = true;
		}
	}

	const copy = copyFor(el);
	const site = resolveSiteName(el, document);
	// 🏛 `let`, not `const` — the baked value is only the OPENING answer. The platform read at the
	// bottom of `mount` may replace it, which is what makes an owner's rename effective without a
	// republish (CANON 第一條). Every reader below already goes through `headHtml()`/`renderClosed()`,
	// so a re-render after that read is all it takes.
	let assistantName = resolveAssistantName(el);
	// 🏛 The platform's name is read when the panel OPENS, not at mount (reef#1921).
	//
	// 🔴 A MOUNT COSTS NO REQUEST FOR A VISITOR WHO NEVER OPENS THE BUBBLE — nearly all of them. The
	// name is only ever painted inside the panel (`headHtml`), so reading it at page load bought a
	// round trip per page view for a label nobody looked at. An owner's rename is still effective
	// without a republish: the next open reads it. Once per mount; a failed read keeps the baked
	// name and is not retried by every re-render.
	//
	// Not awaited: the panel draws at once with the baked value and corrects itself a beat later
	// (`applyAssistantName` patches the name nodes only, so a draft survives).
//
// 🔴 DEFINED BEFORE ANY OPEN PATH CAN RUN (codex round 1, P1): `#inbox` auto-open and a held
// `reef-inbox:open` reach `renderOpen` during mount, so the reader may not be installed later.
// `renderOpen` calls it unconditionally; the guard keeps it to once per mount.
	let nameRead = false;
	function readName() {
		if (nameRead) return;
		nameRead = true;
		void fetchAssistantName(apiBase, kind, id).then((platformName) => {
			if (!platformName || platformName === assistantName) return;
			assistantName = platformName;
			applyAssistantName();
		});
	}

	// ── in-site search (reef#2160) ──
	// 🔴 NO REQUEST BEFORE THE FIRST OPEN. `ensureSearchIndex` is reached only from `wireSearch`,
	// which only a rendered panel calls — the same discipline as `readName` above: a visitor who
	// never opens the bubble (nearly all of them) costs no fetch. Once per mount; a failed or empty
	// read is `[]`, which draws today's bubble and is not retried by every re-render.
	let searchRows = null;
	let searchLoading = null;
	/** True once the index is known to have rows — the only state in which any search UI shows. */
	let searchLive = false;
	/**
	 * 🔴 THE OWNER'S WORDS WIN (codex r1 on tile#180). `data-send-label` is a documented override;
	 *「問 AI」/「傳給真人」are only better DEFAULTS than「Send」, so they never replace a label the
	 * host chose — not on open, not when the index lands, not after a send.
	 */
	const ownSendLabel = Boolean(el.getAttribute('data-send-label'));
	function ensureSearchIndex() {
		if (searchRows) return Promise.resolve(searchRows);
		if (searchLoading) return searchLoading;
		searchLoading = fetch(searchIndexUrl, { headers: { accept: 'application/json' } })
			.then((r) => (r.ok ? r.json() : []))
			.then((d) => { searchRows = Array.isArray(d) ? d : []; return searchRows; })
			.catch(() => { searchRows = []; return searchRows; });
		return searchLoading;
	}
	/**
	 * The search block between the log and the composer — rendered only where the host named an
	 * index, hidden until that index is known to have rows, removed when it has none. A mount
	 * without `data-search-index` renders exactly the markup it rendered before 0.7.14.
	 */
	function searchBlockHtml() {
		// An index already known to be empty draws nothing on a re-render, not a block to remove.
		if (!searchIndexUrl || (searchRows && !searchRows.length)) return '';
		// 🔴 NO WHITESPACE OF ITS OWN. The block sits between the indent and `<form>`, so removing the
		// one element leaves exactly the markup a mount without the attribute renders — no stray
		// text node, byte for byte (mount.test pins the digest for `[]`, 404 and a failed fetch).
		return `<div class="${PREFIX}-search" hidden><p class="${PREFIX}-search-note">${escHtml(copy.searchNote)}</p><ul class="${PREFIX}-results" hidden></ul></div>`;
	}
	/**
	 * Typing filters; Enter and the button stay what they were (`bindCompose`). The list collapses
	 * on a newline or past SEARCH_QUERY_MAX characters — that is a message being written — and on
	 * submit. No results draws nothing: no「not found」line (chodaict 2026-10-18). `label` is the
	 * button's idle wording (`idleLabel` below), set once the index turns search on.
	 *
	 * 🩸 A SUBMIT STAYS SUBMITTED (codex r1 on tile#180). The index can arrive after the visitor
	 * already pressed Enter; painting then filtered the still-full textarea and floated the asked
	 * question's results back over the answer. Only an edit (`input`) re-arms the list — the late
	 * index paints only while the visitor is still typing a query nobody has sent.
	 *
	 * 🩸 THE LIST FOLLOWS THE BOX, NOT ITS EVENTS (codex r2 on tile#180). A successful send empties
	 * the textarea by assignment, which fires no `input`: an edit made while the ask was pending
	 * left its results floating over an empty composer. `sync()` re-reads `textarea.value` through
	 * the same `paint`; it is returned so `bindCompose` calls it after clearing the draft.
	 */
	function wireSearch(form, textarea, button, label) {
		const none = () => {};
		if (!searchIndexUrl) return none;
		const box = root.querySelector(`.${PREFIX}-search`);
		const list = root.querySelector(`.${PREFIX}-results`);
		if (!box || !list) return none;
		const collapse = () => { list.innerHTML = ''; list.hidden = true; };
		const paint = () => {
			const q = String(textarea.value || '');
			const writing = q.indexOf('\n') !== -1 || Array.from(q).length > SEARCH_QUERY_MAX;
			const rows = writing ? [] : filterIndex(searchRows, q, SEARCH_MAX);
			const items = rows.map((r) => {
				// Index rows are site-relative (`/devlog/slug`) or an absolute permalink; `safeHref` alone
				// knows only the second. A root-relative path (one slash, not `//host`) is the site's own.
				const href = /^\/(?!\/)/.test(String(r.u || '')) ? String(r.u) : safeHref(r.u);
				if (!href) return '';
				const when = r.d ? `<time datetime="${escHtml(r.d)}">${escHtml(r.d)}</time>` : '';
				return `<li class="${PREFIX}-result"><a href="${escHtml(href)}"><span class="${PREFIX}-result-title">${escHtml(r.t)}</span>${when}</a></li>`;
			}).filter(Boolean);
			// A hit whose only link was dropped is no hit: an empty list is never shown.
			if (!items.length) { collapse(); return; }
			list.innerHTML = items.join('');
			list.hidden = false;
		};
		let editing = true;
		const sync = () => { if (searchLive && editing) paint(); else collapse(); };
		textarea.addEventListener('input', () => { editing = true; sync(); });
		form.addEventListener('submit', () => { editing = false; collapse(); });
		void ensureSearchIndex().then((rows) => {
			if (!rows.length) { box.remove(); return; }
			searchLive = true;
			box.hidden = false;
			if (!button.disabled) button.textContent = label();
			sync();
		});
		return sync;
	}
	// 🔴 ASK-ONLY READS NO HANDLE. A handle is a conversation with a person; adopting one here would
	// put the human thread, its poller and its compose box back on a tenant we were just told (or
	// could not confirm) has nobody to read them. It is left in storage untouched — if the next page
	// hears a yes, the thread is where the visitor left it.
	const handle = askOnly ? null : loadHandle(tenant);
	/**
	 * The reachable human thread — 🔴 renamed from the old bare `conv` on
	 * purpose. This one only ever changes when a message actually reaches a
	 * person (the server hands back a `conversation_id`); it is NEVER nulled
	 * out just to show a fresh view. `conv` below is the ACTIVE variable the
	 * rest of this file already reads and sends — it now tracks which view is
	 * showing, not just whether a thread exists.
	 */
	let handoffConv = handle ? handle.conv : null;
	/** Whether the LIVE hand-off (if any) was made with an email address. */
	let hasEmail = handle ? handle.hasEmail : false;
	/** The visitor's last CHOSEN view — see `loadHandle`'s header comment. */
	let storedMode = handle ? handle.mode : 'human';
	/**
	 * The one writer, so every path that changes what this panel is showing stamps storage the same
	 * way — `saveHandle`'s own `ts` default, meaning「the visitor just used this thread」. Nothing
	 * in `mount()` calls `saveHandle` direct.
	 */
	function storeHandle(convId, email, mode) {
		saveHandle(tenant, convId, email, mode);
	}
	/**
	 * The active conversation — `handoffConv` while showing the human thread,
	 * `null` while asking KAITO or composing fresh. Every existing `conv` read
	 * in this file (the send payloads, `refresh()`'s guard, `headHtml()`'s
	 * status) keeps working unchanged; only ASSIGNING it is new.
	 */
	let conv = storedMode === 'human' ? handoffConv : null;
	let messages = [];
	/** Speculative — see `handoffConcluded`. `null` until a fetch says otherwise. */
	let conversationStatus = null;

	/**
	 * The deferred question log (ruling 54). Built here, wired in exactly three places below —
	 * this page view, each answered question, and the escalation — plus the one `pagehide`
	 * listener at the bottom of `mount`.
	 *
	 * 🔴 IT IS HANDED ITS WORLD RATHER THAN REACHING FOR ONE, so the same object the browser
	 * runs is the object `compose.test.mjs` drives with a plain Map and a counter.
	 */
	const aiLog = createAiLog({
		tenant,
		kind,
		id,
		// 🔴 ASK-ONLY KEEPS NO LOG AT ALL (ruling 54: a KAITO-only tenant writes nothing, ever). Off
		// here means no buffer in storage, no probe on the first question and no `pagehide`
		// listener — the same switch `data-ai-log="0"` throws, so there is no second path to audit.
		enabled: !askOnly && el.getAttribute('data-ai-log') !== '0',
		storage: (() => {
			try {
				return window.localStorage;
			} catch {
				return null;
			}
		})(),
		newId: () => {
			// 🔴 A SESSION ID IS NOT A CONVERSATION ID. The file header's rule —「the conversation
			// id comes from the server」— is about a bearer token that opens somebody's transcript.
			// This one names a row of questions nobody can read back through any endpoint; it is
			// minted here because the whole point is that the row is assembled before the first
			// request exists.
			try {
				return crypto.randomUUID();
			} catch {
				return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
			}
		},
		send: (payload, opts) => sendAiSession(`${apiBase}/api/inbox/session`, payload, {}, opts),
		probeClaim: () => probeInboxClaim(apiBase, kind, id)
	});
	/**
	 * The guidance funnel (reef#422) — see its header above `FUNNEL_STAGES`. Switched by the log's
	 * own switch, so there is still one path to audit: off on ask-only, off with `data-ai-log="0"`,
	 * off while the log holds a definite「no Inbox」.
	 */
	const funnel = createFunnel({
		tenant,
		kind,
		id,
		enabled: aiLog.enabled(),
		unclaimed: () => aiLog.unclaimed(),
		storage: (() => {
			try {
				return window.localStorage;
			} catch {
				return null;
			}
		})(),
		send: (payload) => sendFunnelEvent(`${apiBase}/api/inbox/funnel`, payload)
	});
	/** Where the visitor is, as the funnel names it — the path and the page's locale segment. */
	const funnelHere = () => [aiPagePath(location.href), pageLocale()];
	/**
	 * Set only by `renderOpen()`, only when it auto-returns to ask mode because
	 * the human thread concluded — never by a deliberate "ask again" click.
	 * Read fresh at render time so it can't drift from a `messages` array that
	 * gets cleared the moment the view switches (see `renderOpen`).
	 */
	let handoffEndedNote = false;
	let open = false;
	let poller = null;
	/** Set from the server's answer. NEVER defaulted — see the file header. */
	let replyWithinHours = null;

	function headHtml() {
		// 🔴 `status` IS ALREADY SAFE HTML, NOT PLAIN TEXT (owner ruling 2026-09-06 #34) — `statusFor`
		// itself escapes the dynamic parts and splices in the AI chip's real markup, so it must be
		// inserted BELOW as an HTML fragment, never re-escaped. Re-`escHtml`ing it here (the way this
		// line used to) would print the chip's own `<span>` as literal text instead of rendering it.
		const status = statusFor(copy, { hasConv: !!conv, hasEmail, kaitoOn, askOnly }, assistantName);
		// 🔑 The escape hatch bug #1 (2026-09-04) exists to add: once a hand-off
		// happens the panel used to show the human thread FOREVER, with no way
		// back to KAITO or a fresh question. `conv` truthy → viewing the human
		// thread, offer the way out. `conv` falsy with `handoffConv` still around
		// → viewing ask/fresh mode with an old thread parked behind a quiet link.
		let secondLabel = null;
		let quiet = false;
		if (conv) {
			secondLabel = kaitoOn ? copy.askAgain(assistantName) : copy.newConversation;
		} else if (handoffConv) {
			secondLabel = copy.backToHuman;
			quiet = true;
		}
		const secondBtn = secondLabel
			? `<button type="button" class="${PREFIX}-second${quiet ? ` ${PREFIX}-quiet` : ''}">${escHtml(secondLabel)}</button>`
			: '';
		const note = !conv && handoffConv && handoffEndedNote
			? `<p class="${PREFIX}-hint ${PREFIX}-ended">${escHtml(copy.handoffEnded)}</p>`
			: '';
		return `<div class="${PREFIX}-head-text"><h2>${escHtml(site)}</h2>` +
			(status ? `<p class="${PREFIX}-status">${status}</p>` : '') +
			secondBtn + note +
			`</div><button type="button" class="${PREFIX}-close" aria-label="${escHtml(copy.closed)}">×</button>`;
	}

	/** Wires the close button and, when `headHtml()` rendered one, the second action. */
	function wireHead() {
		root.querySelector(`.${PREFIX}-close`).addEventListener('click', () => hide(true));
		const second = root.querySelector(`.${PREFIX}-second`);
		if (second) second.addEventListener('click', () => (conv ? goAsk() : goHuman()));
	}

	/**
	 * 🩸 THE LATE RENAME MUST NOT COST THE VISITOR THEIR DRAFT (0.7.2). The platform read at the
	 * bottom of `mount` used to finish with `if (open) renderOpen(); else renderClosed();`, and
	 * `renderOpen` → `renderAsk`/`renderMessages` assign `root.innerHTML` and re-`focus()` the
	 * textarea. The window is not theoretical: that fetch is queued AFTER the transcript refresh,
	 * so for a returning visitor on a slow connection it lands two round trips into a panel they
	 * can already type in. Two lines typed, or a KAITO answer just received, and the whole panel
	 * is replaced — and a send in flight would write its result into a detached `log`, which
	 * looks exactly like a message that vanished.
	 *
	 * 🔴 SO PATCH THE NAME NODES, NOT THE PANEL. There are exactly two of them, and `headHtml`
	 * above is where both are built: the status line (`statusFor`, safe HTML by contract — see
	 * its own comment — so `innerHTML`, deliberately, not `textContent`) and the second action's
	 * label when it reads 「重新問 <名字>」. Everything else in the panel — draft, log, focus,
	 * scroll — is untouched by construction, because nothing else interpolates the name.
	 *
	 * 🔴 THE CLOSED STATE NEEDS NOTHING. `renderClosed` paints one icon button whose accessible
	 * name is `copy.open`; no name reaches it. And the next `renderOpen` reads `assistantName`
	 * fresh, so a visitor who opens the panel later still gets the new name.
	 */
	function applyAssistantName() {
		const status = root.querySelector(`.${PREFIX}-status`);
		if (status) status.innerHTML = statusFor(copy, { hasConv: !!conv, hasEmail, kaitoOn, askOnly }, assistantName);
		const second = root.querySelector(`.${PREFIX}-second`);
		if (second && conv && kaitoOn) second.textContent = copy.askAgain(assistantName);
	}

	/** 「重新問 KAITO」/「新對話」— leave the human thread up without discarding it. */
	function goAsk() {
		storedMode = 'ask';
		storeHandle(handoffConv, hasEmail, storedMode);
		conv = null;
		messages = [];
		handoffEndedNote = false;
		stopPolling();
		if (kaitoOn) renderAsk();
		else renderMessages();
	}

	/** 「回到真人對話」— the human thread was never gone, only not the active view. */
	function goHuman() {
		storedMode = 'human';
		storeHandle(handoffConv, hasEmail, storedMode);
		conv = handoffConv;
		handoffEndedNote = false;
		renderMessages();
	}

	// What the closed button and the dialog are CALLED. With an Inbox: `copy.open` / `copy.title`,
	// as ever — nothing on that path reads the lines below.
	//
	// Ask-only: the locale defaults (「Message us」/「Leave a message」) name a place to leave a
	// message, and a screen reader told that by a panel that takes none has been told something
	// untrue. So they are replaced by the ask box's own words, without the trailing ellipsis a
	// placeholder carries and a name should not (it is read aloud).
	//
	// 🔴 BUT A `data-title` SOMEBODY SET STANDS, for the dialog. It is whatever the host calls this
	// panel — a site layout passes the site's own name — and it is the heading a sighted visitor
	// reads; the accessible name agrees with it. `data-open-label` does not get the same pass: it is
	// the override for「Message us」specifically, so on a mount that takes no messages it is ignored.
	const askName = String(copy.ask || '').replace(/\s*(?:…|\.{3})\s*$/, '');
	const openLabel = askOnly ? askName : copy.open;
	const panelLabel = askOnly ? (el.getAttribute('data-title') || askName) : copy.title;

	// 🔴 THE PANEL LIVES IN A SHADOW ROOT ON A HOST OF ITS OWN (0.7.13, reef#2139 — see `styleElement`).
	// Not on `el` itself: a shadow root cannot be attached twice, so an `unmount(el)` followed by a
	// remount would throw, and `el`'s own children would vanish behind it. Every query this file
	// makes for its own nodes already goes through `root` (or a node under it), never `document`, so
	// they all keep working unchanged inside the shadow tree; `focus()` on a node in an open shadow
	// root focuses it as before. `mode:'open'` so a host script, a test, or an assistive tool can
	// still reach in deliberately (`host.shadowRoot`) — isolation is from selectors, not from people.
	const host = document.createElement('div');
	host.className = `${PREFIX}-host`;
	const shadow = host.attachShadow({ mode: 'open' });
	shadow.appendChild(styleElement());
	const root = document.createElement('div');
	root.className = `${PREFIX}-root`;
	shadow.appendChild(root);
	// 🔴 INTO THE CORNER DOCK (reef#2790), not into `el`. The dock is where the corner's items stack in
	// document order, and `el` — which stays where the page wrote it — is this item's place in that
	// order (contract ①: the anchor). Where there is no document to join (a test double, a host
	// without `body`), the host goes into `el` as it did before, and the fixed rules position it.
	const dock = typeof dockJoin === 'function' && host.ownerDocument ? dockJoin(host, el, 'right') : null;
	if (dock) host.setAttribute('data-docked', dock.getAttribute('name') || 'right');
	else el.appendChild(host);
	// Contract ②: another corner item opening closes this panel — without taking the focus anywhere.
	const stopListening = dock ? dockListen(host, () => { if (open) hide(false); }) : () => {};
	// Esc closes the panel and gives the focus back to the bubble. On the root, which every render keeps.
	if (typeof root.addEventListener === 'function') {
		root.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !open) return;
			event.stopPropagation();
			hide(true);
		});
	}
	// Where it sits: the owner's offset, read and validated, and room for the composer (see the function).
	const placement = createPlacement(host, shadow, root, el);

	/** See `pollGeneration` — what makes `stopPolling()` reach the requests already in the air. */
	const generation = pollGeneration();

	/**
	 * 🔴 THE CONTAINER'S LIFETIME IS THE BUBBLE'S AGAIN (review of tile#233, finding 5). The host lives
	 * in the dock, not in `el`, so removing `el` no longer takes the bubble with it by itself: the dock's
	 * page watcher (contract ③) takes the host out of the dock when `el` leaves the document — a route
	 * change replacing the container, a checkout step removing it — and the next thing this mount is
	 * asked to do finds that out here and undoes the rest (listeners, poller), as `unmount(el)` does.
	 */
	function retired() {
		if (!dock || host.isConnected !== false || el.isConnected !== false) return false;
		unmount(el);
		return true;
	}

	function stopPolling() {
		// 🔴 UNCONDITIONAL, and before the `poller` check: there can be a `refresh()` in flight with
		// no interval running at all (mount's own first read, `escalate`'s, a poller that gave up),
		// and those are exactly the ones that used to paint a dead conversation into a live panel.
		generation.invalidate();
		if (poller) {
			clearInterval(poller);
			poller = null;
		}
	}

	let pollFailures = 0;

	async function refresh() {
		if (!conv || retired()) return;
		const at = conv;
		await generation.run(
			() => fetchTranscript(apiBase, kind, id, conv),
			(got) => {
				// Belt and braces alongside the generation: every path that changes `conv` calls
				// `stopPolling()` today, and this is what keeps the guard true of one that forgets.
				if (conv !== at) return false;
				if (got) {
					pollFailures = 0;
					messages = got.messages;
					conversationStatus = got.status;
					const log = root.querySelector(`.${PREFIX}-log`);
					if (log) renderLog(log, messages);
					return true;
				}
				// Counted, not ignored: a 404 for a conversation the server no longer has
				// and a network that is down look identical from here, and neither is
				// worth asking about forever.
				if (++pollFailures >= POLL_GIVE_UP_AFTER) stopPolling();
				return false;
			}
		);
	}

	/**
	 * Which panel to show.
	 *
	 * 🩸 Used to be "a conversation, once it exists, wins forever" — the exact
	 * bug this file exists to fix (2026-09-04 report): a visitor who once used
	 * the hand-off saw the human thread on every later open, with no way back
	 * to KAITO or a new question, for days. Now the stored handle is still the
	 * "already asked a person" flag, but it is no longer the ONLY vote —
	 * `resolveViewMode` also hears the visitor's last choice and whether the
	 * thread has concluded.
	 */
	function renderOpen() {
	readName();
		// How many corner items sit below this one: the room the panel leaves for them (see the CSS).
		if (dock && host.style && typeof host.style.setProperty === 'function') {
			host.style.setProperty('--_dc-below', String(dockBelow(host)));
		}
		const concluded = handoffConcluded(messages, conversationStatus);
		const mode = resolveViewMode({ hasHandoffConv: !!handoffConv, storedMode, concluded, kaitoOn });
		if (mode === 'ask') {
			handoffEndedNote = concluded && !!handoffConv;
			conv = null;
			messages = [];
		} else {
			handoffEndedNote = false;
			conv = handoffConv;
		}
		if (mode === 'ask' && kaitoOn) return renderAsk();
		return renderMessages();
	}

	function renderClosed() {
		stopPolling();
		// 🩸 This was the label as visible TEXT — so every site's corner read
		// 「メッセージ」/「傳訊息」, and a site that wanted the icon everyone else's
		// support widget has had to override our CSS from its own page. That is
		// portability debt we handed the owner for something the coral should own.
		//
		// The words are not deleted, they MOVE: `copy.open` is now the button's
		// accessible name, so a screen reader says exactly what it said before
		// while the corner shows a glyph.
		root.innerHTML = bubbleHtml(false);
		placement.update();
		wireBubble();
	}

	/**
	 * The bubble. Closed it is the whole root; open it stays BELOW the panel (reef#2790: the panel sits
	 * directly above its own item), says so with `aria-expanded`, names the panel with
	 * `aria-controls`, and is the panel's close control: × in place of the glyph, named「Close」(the
	 * same word as the panel's own ×, which stays for compatibility), and a press closes the panel.
	 */
	function bubbleHtml(expanded) {
		const label = expanded ? copy.closed : openLabel;
		const icon = expanded ? DOCK_CLOSE_ICON.replace('<svg ', `<svg class="${PREFIX}-icon" `) : OPEN_ICON;
		return `<button type="button" class="${PREFIX}-open" aria-label="${escHtml(label)}" aria-expanded="${expanded}" aria-controls="${PREFIX}-panel">${icon}</button>`;
	}
	function wireBubble() {
		root.querySelector(`.${PREFIX}-open`).addEventListener('click', () => (open ? hide(true) : show()));
	}
	/** Opens the panel — every way in (a click, `reef-inbox:open`, `#inbox`) comes through here. */
	function show() {
		open = true;
		renderOpen();
		if (dock) dockAnnounce(host);
	}
	/**
	 * Closes it; `focus` returns the focus to the bubble (Esc, ×, the bubble) — or, from the bar's More
	 * sheet, to the More button, the bubble being in the closed sheet — never when another item took over.
	 */
	function hide(focus) {
		open = false;
		renderClosed();
		if (focus) {
			const bubble = root.querySelector(`.${PREFIX}-open`);
			if (dock) dockFocusBack(host, bubble);
			else if (bubble && bubble.focus) bubble.focus();
		}
	}

	/**
	 * Hand the visitor's OWN question to a person. Only ever called from a click.
	 *
	 * What travels is the question, verbatim, and nothing else — not the passage
	 * KAITO offered, not the fact that it refused, not a note we wrote. The owner
	 * reads what was asked. ("KAITO could not answer this" is real and useful,
	 * but it belongs to the refusal league table (SPEC §5), not smuggled into
	 * somebody's message.)
	 */
	async function escalate(question, button, copyRef) {
		button.disabled = true;
		button.textContent = copyRef.sending;
		const { status, body } = await send(apiBase, {
			kind,
			id,
			conversation_id: conv,
			text: question,
			page_url: location.href
		}).catch(() => ({ status: 0, body: null }));

		if (status === 200 && body && body.ok) {
			conv = body.conversation_id;
			handoffConv = conv;
			storedMode = 'human';
			// The quiet "still want a person?" button carries no form — no email
			// was ever offered on this path.
			hasEmail = false;
			storeHandle(conv, hasEmail, storedMode);
			funnel.handedOff(...funnelHere());
			// The press is the flush. This session now belongs to a conversation the owner is
			// about to open, so the questions that led to it travel with it rather than waiting
			// for the visitor to close the tab.
			//
			// 🔴 NOT AWAITED, and it settles on its own: the confirmed send is a round trip and the
			// visitor is waiting for the panel to say their message went, not for our bookkeeping.
			// A send the server does not take leaves the buffer alone; the next `pagehide` carries it.
			void aiLog.escalated(conv);
			replyWithinHours = body.reply_within_hours ?? null;
			renderMessages();
			const log = root.querySelector(`.${PREFIX}-log`);
			if (log) {
				const hint = document.createElement('p');
				hint.className = `${PREFIX}-hint`;
				hint.textContent = copyRef.sentToHuman;
				log.appendChild(hint);
			}
			await refresh();
			return;
		}
		button.disabled = false;
		button.textContent = copyRef.toHumanAfterRefusal;
		showError(status, copyRef, body);
	}

	function showHandoffForm(question, button, copyRef) {
		button.insertAdjacentHTML('afterend', handoffFormHtml(copyRef, question));
		button.remove();
		const form = root.querySelector(`.${PREFIX}-handoff`);
		const textarea = form.querySelector('textarea');
		const sendButton = form.querySelector('button[type="submit"]');
		form.querySelector('[data-cancel]').addEventListener('click', () => {
			form.replaceWith(button);
			button.focus();
		});
		textarea.focus();
		bindCompose(form, textarea, sendButton, copyRef.sending, copyRef.send, async (text) => {
			const emailGiven = !!form.querySelector('input[name="visitor_email"]').value.trim();
			const payload = inboxPayload(kind, id, conv, text, location.href,
				form.querySelector('input[name="_hp"]').value,
				form.querySelector('input[name="visitor_name"]').value,
				form.querySelector('input[name="visitor_email"]').value);
			const { status, body } = await send(apiBase, payload).catch(() => ({ status: 0, body: null }));
			if (status >= 200 && status < 300 && body && body.ok) {
				conv = body.conversation_id;
				handoffConv = conv;
				storedMode = 'human';
				hasEmail = emailGiven;
				storeHandle(conv, hasEmail, storedMode);
				// Same press, the other door — see `escalate`.
				funnel.handedOff(...funnelHere());
				void aiLog.escalated(conv);
				replyWithinHours = body.reply_within_hours ?? null;
				// 🩸 The confirmation used to render AFTER `await refresh()` — a real
				// network round trip — so the panel sat on the freshly-reset empty
				// state for however long that took (finding #8, 2026-09-03 cold-read:
				// ~600ms of "did my message just disappear?"). The hint now lands
				// synchronously in the SAME tick as the re-render, exactly like the
				// no-email escalate() path beside this one always has; refresh() then
			// only replaces the message list underneath it, never blanks the panel.
				renderMessages();
				const log = root.querySelector(`.${PREFIX}-log`);
				if (log) {
					const hint = document.createElement('p');
					hint.className = `${PREFIX}-hint`;
					hint.textContent = copyRef.sentToHuman;
					log.appendChild(hint);
				}
				await refresh();
				return true;
			}
			showError(status, copyRef, body);
			return false;
		});
	}

	function showError(status, copyRef, body) {
		const existing = root.querySelector(`.${PREFIX}-error`);
		if (existing) existing.remove();
		const err = document.createElement('p');
		err.className = `${PREFIX}-error`;
		err.textContent = inboxErrorText(status, body, copyRef);
		const panel = root.querySelector(`.${PREFIX}-panel`);
		if (panel) panel.appendChild(err);
	}

	/**
	 * The ASK view — only reachable with data-kaito="1" and no conversation yet.
	 *
	 * 🔴 The button that reaches a person is rendered only AFTER an answer comes
	 * back, and it is never pre-armed. See the file header: the press is what
	 * makes the interruption deliberate.
	 */
	function renderAsk() {
		root.innerHTML = `
<div class="${PREFIX}-panel" id="${PREFIX}-panel" role="dialog" aria-label="${escHtml(panelLabel)}">
  <div class="${PREFIX}-head">${headHtml()}</div>
  <div class="${PREFIX}-log"></div>
  ${searchBlockHtml()}<form class="${PREFIX}-form">
    <textarea name="q" rows="1" placeholder="${escHtml(copy.ask)}"></textarea>
    <button type="submit">${escHtml(copy.send)}</button>
  </form>
</div>${bubbleHtml(true)}`;
		placement.update();
		wireHead();
		wireBubble();

		const form = root.querySelector(`.${PREFIX}-form`);
		const textarea = form.querySelector('textarea');
		const button = form.querySelector('button');
		const log = root.querySelector(`.${PREFIX}-log`);
		textarea.focus();

		const idle = () => (searchLive && !ownSendLabel ? copy.askAi : copy.send);
		const syncSearch = wireSearch(form, textarea, button, idle);
		bindCompose(form, textarea, button, copy.asking, idle, async (question) => {
			// Asking again inside a guided journey is the funnel's「not resolved」. Before the ask, so
			// it is the press that counts — not whatever the engine then answers.
			funnel.followedUp(...funnelHere());
			const answer = await askKaito(apiBase, kind, id, question, copy);

			// 🔴 RECORDED HERE, WHERE THE OUTCOME IS KNOWN, AND NOWHERE ELSE. What goes in is the
			// visitor's own sentence, the page they were on, the passage that was cited (or `null`
			// — a refusal, an uncited answer and an engine we could not reach are all「no hit」),
			// and the page's locale. `answer.text` is never passed: the machine's words are the
			// owner's own page quoted back, and §5 keeps them out of every record we hold.
			aiLog.question(
				question,
				aiPagePath(location.href),
				answer && answer.kind === 'grounded' ? answer.source_url : null,
				pageLocale()
			);

			// The question the visitor asked, shown back to them, so the panel
			// reads as an exchange rather than a slot machine.
			log.innerHTML =
				`<div class="${PREFIX}-msg ${PREFIX}-msg-visitor">${escHtml(question)}</div>`;

			// 🔴 ASK-ONLY OFFERS NO PERSON. Both buttons below POST to `/api/inbox`, which refuses every
			// message for a tenant without an Inbox — they are the button the claim gate exists to keep
			// off the screen. So there the answer (or the refusal) is the whole exchange.
			const src = answer && answer.kind === 'grounded' ? safeHref(answer.source_url) : null;
			if (answer && answer.kind === 'grounded' && src) {
				log.insertAdjacentHTML(
					'beforeend',
					`<div class="${PREFIX}-msg ${PREFIX}-msg-owner">${escHtml(answer.text)}` +
						`<a class="${PREFIX}-src" href="${escHtml(src)}" rel="noopener noreferrer">${escHtml(copy.source)}</a></div>` +
						(askOnly ? '' : `<button type="button" class="${PREFIX}-tohuman ${PREFIX}-quiet">${escHtml(copy.toHuman)}</button>`)
				);
				// `guided` at the moment the citation is ON SCREEN — the link drawn above is the
				// guidance. A refusal or an uncited answer guides nowhere and sends nothing.
				if (funnel.enabled()) {
					funnel.guided(aiPagePath(location.href), src, pageLocale());
					// A citation into the page the visitor is already on navigates nowhere, so no mount
					// will see the arrival: the click is it. Any other page's mount reports its own.
					log.querySelector(`.${PREFIX}-src`).addEventListener('click', () => {
						if (funnelPageKey(src) === funnelPageKey(location.href)) funnel.arrived(...funnelHere());
					});
				}
			} else {
				// A refusal, an uncited answer, and an engine we could not reach all
				// land here — and they land the same way ON PURPOSE. From the
				// visitor's side the useful fact is identical ("the site does not
				// answer that; want a person?"), and dressing our plumbing up as
				// three different experiences would tell them about us instead of
				// helping them. The one exception is KAITO answering 503: retrying
				// cannot help, so it says the AI cannot answer (naming the person door
				// only when that door is drawn) instead of the send-failure sentence.
				const said = answer && answer.kind === 'unavailable'
					? (askOnly ? copy.kaitoUnavailable : copy.kaitoUnavailableToHuman)
					: answer ? answer.text : copy.error;
				log.insertAdjacentHTML(
					'beforeend',
					`<div class="${PREFIX}-msg ${PREFIX}-msg-owner">${escHtml(said)}</div>` +
						(askOnly ? '' : `<button type="button" class="${PREFIX}-tohuman">${escHtml(copy.toHumanAfterRefusal)}</button>`)
				);
			}
			log.scrollTop = log.scrollHeight;
			if (askOnly) return true;

			const toHuman = log.querySelector(`.${PREFIX}-tohuman`);
			toHuman.addEventListener('click', () => {
				if (refusalNeedsHandoffForm(answer)) showHandoffForm(question, toHuman, copy);
				else escalate(question, toHuman, copy);
			});
			return true;
		}, syncSearch);
	}

	function renderMessages() {
		root.innerHTML = `
<div class="${PREFIX}-panel" id="${PREFIX}-panel" role="dialog" aria-label="${escHtml(copy.title)}">
  <div class="${PREFIX}-head">${headHtml()}</div>
  <div class="${PREFIX}-log"></div>
  ${replyWithinHours ? `<p class="${PREFIX}-hint">${escHtml(copy.within(replyWithinHours))}</p>` : ''}
  ${searchBlockHtml()}<form class="${PREFIX}-form">
    <label class="${PREFIX}-hp" aria-hidden="true" style="${HP_STYLE}">
      <span>Leave this empty</span><input type="text" name="_hp" tabindex="-1" autocomplete="off">
    </label>
    <textarea name="text" rows="1" placeholder="${escHtml(copy.placeholder)}"></textarea>
    <button type="submit">${escHtml(copy.send)}</button>
  </form>
</div>${bubbleHtml(true)}`;

		const log = root.querySelector(`.${PREFIX}-log`);
		renderLog(log, messages);
		placement.update();

		wireHead();
		wireBubble();

		const form = root.querySelector(`.${PREFIX}-form`);
		const textarea = form.querySelector('textarea');
		const button = form.querySelector('button');
		textarea.focus();

		const idle = () => (searchLive && !ownSendLabel ? copy.sendOwner : copy.send);
		const syncSearch = wireSearch(form, textarea, button, idle);
		bindCompose(form, textarea, button, copy.sending, idle, async (text) => {
			const { status, body } = await send(apiBase, {
				kind,
				id,
				conversation_id: conv,
				text,
				page_url: location.href,
				_hp: form.querySelector('input[name="_hp"]').value
			}).catch(() => ({ status: 0, body: null }));
			if (status === 200 && body && body.ok) {
				conv = body.conversation_id;
				handoffConv = conv;
				storedMode = 'human';
				// This is the direct compose form — it has no email field, so
				// whatever `hasEmail` already recorded (from an earlier hand-off,
				// or never-set) stands.
				storeHandle(conv, hasEmail, storedMode);
				funnel.handedOff(...funnelHere());
				// Trust our own copy, not the local one: the server has just told us
				// what it stored, and a locally-appended message that silently failed
				// to save is the exact lie this product cannot tell.
				replyWithinHours = body.reply_within_hours ?? null;
				await refresh();
				const hint = document.createElement('p');
				hint.className = `${PREFIX}-hint`;
				hint.textContent = copy.stored;
				log.appendChild(hint);
				log.scrollTop = log.scrollHeight;
				return true;
			}

			// 🔴 Honest failure. The message is NOT shown as sent, and the words stay
			// in the box so nobody has to retype them.
			const existing = root.querySelector(`.${PREFIX}-error`);
			if (existing) existing.remove();
			const err = document.createElement('p');
			err.className = `${PREFIX}-error`;
			err.textContent = inboxErrorText(status, body, copy);
			form.parentNode.insertBefore(err, form);
			return false;
		}, syncSearch);

		// 🔴 STOP FIRST, THEN READ. The old order (read, stop, restart) started a fetch and then
		// invalidated its own generation one line later, so the first read after every re-render
		// would be thrown away — the read that exists so a returning visitor sees the reply
		// waiting for them.
		stopPolling();
		refresh();
		poller = setInterval(refresh, POLL_MS);
	}

	renderClosed();

	/**
	 * Opens the panel exactly as the closed bubble's own click does.
	 *
	 * 🩸 ALREADY OPEN IS NOT NOTHING (review B10). `if (open) return;` is right about not
	 * re-rendering — that would throw away a draft mid-sentence — but it used to return without
	 * doing anything at all, and the use README recommends is a site's footer 「report a problem」
	 * link. A visitor whose panel is already open, scrolled out of view at the other end of the
	 * page, clicked that link and NOTHING happened: an ordinary broken link, as far as they can
	 * tell. Refocusing the compose box is the whole fix — it scrolls the panel into view and puts
	 * the cursor where the visitor was going anyway, without touching what they have typed.
	 */
	function openPanel() {
		// Retired by the dock (contract ③: the container left the document): finish the job, as
		// `unmount(el)` would, instead of opening a panel nobody can see.
		if (retired()) return;
		if (open) {
			const textarea = root.querySelector('textarea');
			if (textarea && textarea.focus) textarea.focus();
			return;
		}
		show();
	}

	// #13: a programmatic way in. A site's own "report a problem" footer link can open this panel
	// in place instead of sending the visitor to another page — a `reef-inbox:open` CustomEvent on
	// `window`, or `#inbox` in the URL the visitor already landed on. Both are wired only here,
	// inside a successful `mount()`, so either is inert wherever the coral is not mounted: there is
	// no listener and no hash check running for an element that failed the `data-kind`/`data-id`
	// guard at the top of this function. `openPanel` reaches `renderOpen()`, which every existing
	// path into the panel already funnels through — the ask/compose textarea's own `.focus()` call
	// (`renderAsk`/`renderMessages`) fires the same way it does for a click, with no new code path
	// to keep in sync.
	//
	// 🔴 ONE OF THE `window` LISTENERS A DRAWN BUBBLE KEEPS (the others are ruling 54's `pagehide`
	// and the funnel's `pageshow`, at the bottom of `mount`, both only where the question log is on;
	// the claim gate's `heldOpen` exists only while it asks, and is gone before this line runs).
	// All are removed by `unmount(el)` (review B9, closed in 0.7.9):
	// an SPA that tears the container out calls it, and neither listener is left holding `root`
	// and `el`, nor re-rendering into a node nobody can see. A host that never calls it gets what
	// every version before 0.7.9 did — `mountAll`'s `data-dynamic-coral-mounted` guard stops the
	// same element being mounted twice, so a page accumulates one listener per element it ever
	// mounted, not per re-render. `reef-inbox:open` is a BROADCAST on purpose —「open the panel」 is a request any
	// script may honestly make of every panel on the page, and it names no conversation, which is
	// the whole difference between it and the hand-off event 0.7.5 removed (review B3).
	window.addEventListener('reef-inbox:open', openPanel);
	if (openRequested || shouldAutoOpenFromHash(location.hash, el.getAttribute('data-open-on-hash'))) openPanel();

	// ── the deferred write's two lines (ruling 54) ─────────────────────────────────────────
	//
	// This page view, recorded locally — no request, no cookie, nothing leaves. It is what makes
	// the row's page SEQUENCE a sequence rather than a single entry, and it is why the buffer is
	// in `localStorage` rather than scoped to this document.
	aiLog.page(aiPagePath(location.href));
	// The funnel's `arrived`, when this page is one KAITO cited earlier in this journey. Without a
	// guided journey it reads one storage key and sends nothing.
	funnel.arrived(...funnelHere());

	// 🔴 `pagehide`, NOT `beforeunload` OR `unload`. Both of the others are ignored or actively
	// penalised on mobile Safari (a page that registers `unload` is excluded from the back/forward
	// cache), and neither fires when an app is backgrounded and later discarded — which is exactly
	// how a phone visit ends. `pagehide` is the one that fires in all of those.
	//
	// 🔴 AND IT IS THE SAME LISTENER WHETHER OR NOT THERE IS ANYTHING TO SEND. `flush()` answers
	// `null` for a session with no unsent questions, for an unclaimed tenant and for a tenant whose
	// claim state we could not learn — so the ordinary page view, the one where nobody asked
	// anything, reaches the network exactly as often as it did before this existed: never.
	const onPagehide = () => aiLog.flush();
	if (aiLog.enabled()) window.addEventListener('pagehide', onPagehide);
	// 🩸 A PAGE RESTORED FROM THE BACK/FORWARD CACHE IS NOT A NEW DOCUMENT (tile#193 review P2). The
	// visitor on /faq goes to /, asks, is cited /faq#shipping and presses Back: the browser hands
	// back the /faq it kept, module and `mount()` both already run, so the `arrived` line above never
	// sees that guidance and the owner's funnel undercounts. A persisted `pageshow` is the one signal
	// that this document is being looked at again; it re-asks the same consume-once question, so a
	// restore after an arrival already recorded — or a second restore — sends nothing. A
	// non-persisted `pageshow` is the first load's own, which the line above already answered.
	const onPageshow = (event) => {
		if (event && event.persisted === true) funnel.arrived(...funnelHere());
	};
	if (aiLog.enabled()) window.addEventListener('pageshow', onPageshow);

	// 🔴 REGISTERED HERE, SYNCHRONOUSLY, BESIDE THE TWO LISTENERS IT UNDOES (review B9). The only
	// await above this line is the claim gate's, and the one thing installed across it — `heldOpen`
	// — is removed by the answer or by an `unmount` through `gating`; from here back to the gate's
	// answer nothing awaits,
	// so there is no window in which a listener exists and its removal does not: an `unmount` that
	// races the first transcript read below still finds it.
	// `stopPolling()` invalidates that read too, so it cannot paint into a detached root.
	mounted.set(el, () => {
		window.removeEventListener('reef-inbox:open', openPanel);
		window.removeEventListener('pagehide', onPagehide);
		window.removeEventListener('pageshow', onPageshow);
		stopListening();
		stopPolling();
		placement.dispose();
		host.remove();
	});

	// One read at mount so a returning visitor sees the reply waiting for them behind the closed
	// bubble — without opening a panel nobody asked for.
	//
	// 🔴 AFTER THE LISTENER, NOT BEFORE (review B5). This is a network round trip, and everything
	// below it used to be everything above: on a slow connection a site's own `DOMContentLoaded`
	// handler could dispatch `reef-inbox:open` seconds before there was a listener for it, and the
	// event went nowhere — an intermittent failure nobody would ever debug. `#inbox` had the same
	// problem from the other side: it stole focus a round trip late, by which time the visitor may
	// have started typing in the site's own search box. Registering first costs nothing; every
	// handler only runs once the panel exists, and `renderClosed()` above already built it.
	//
	// `!open` because an auto-opened panel has already started its own read through
	// `renderMessages()`, and a second one would be two requests for one paint.
	if (conv && !open) await refresh();
}

/** Each mounted element → the one function that undoes what its `mount()` installed (review B9). */
const mounted = new WeakMap();

/**
 * Takes a bubble off an element: removes both `window` listeners its `mount()` added, stops the
 * transcript poller (and any read already in the air), removes the panel, and clears
 * `data-dynamic-coral-mounted` so the element may be mounted again. For a host that removes the
 * container itself (an SPA route change); a plain page never needs it.
 *
 * Touches nothing in `localStorage` — the visitor's conversation handle and unsent questions
 * outlive the panel exactly as they outlive a navigation. Returns `false` for an element this
 * file did not mount (or already unmounted), and does nothing then.
 */
export function unmount(el) {
	// Still asking whether there is an Inbox: nothing is installed yet, so stopping the ask is all
	// there is to undo — and the answer, when it lands, draws nothing.
	const stopAsking = gating.get(el);
	if (stopAsking) {
		gating.delete(el);
		stopAsking();
		el.removeAttribute('data-dynamic-coral-mounted');
		return true;
	}
	const dispose = mounted.get(el);
	if (!dispose) return false;
	mounted.delete(el);
	dispose();
	el.removeAttribute('data-dynamic-coral-mounted');
	return true;
}

export function mountAll() {
	// Taken before the first mount and in the same turn as every mount's synchronous half, so the
	// loader's listener goes quiet exactly when ours start — see `takeLoaderHandoff`.
	const handoff = takeLoaderHandoff();
	document.querySelectorAll(SELECTOR).forEach((el) => {
		if (el.getAttribute('data-dynamic-coral-mounted') === '1') return;
		el.setAttribute('data-dynamic-coral-mounted', '1');
		mount(el, handoff);
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', mountAll);
} else {
	mountAll();
}
