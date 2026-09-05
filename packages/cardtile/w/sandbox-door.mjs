// cardtile-w's sandbox — the ONE door out, into the real thing.
//
// Ported from feelreef's `apps/feelreef/src/lib/card/tryToReal.ts` (chodaict, 2026-08-27), which
// used to compute this for the retired `feelreef.com/card/try` route. That route died with the rest
// of the legacy Python surfaces (commit 3fcfb09ff, 2026-08-28) — but the CONTRACT it wrote down did
// not stop being true: `/dashboard/cards`'s own input still carries
// `pattern="[a-z0-9][a-z0-9-]{0,38}"` (feelreef `src/routes/dashboard/cards/+page.svelte`), and a
// handle the real form would reject is worse than no handle at all, because the visitor has already
// clicked the door by then.
//
// This file cannot `import` the original — it lives in a different repo — so the RULE is
// re-typed here rather than re-derived: same regex, same caps, same "empty is an honest answer"
// behaviour. If `/dashboard/cards`'s own pattern or field lengths ever change, this drifts and
// sandbox-door.test.mjs is what would need to change WITH it — there is no shared import to keep it
// honest automatically, only the paired comment on both sides.
//
// 🔴 EMPTY IS AN ANSWER. cardtile's sandbox persona names are NOT always ASCII (ゆい / 小美 / 지우 —
// see sandbox-i18n.mjs) — a name with no latin letters or digits in it has no honest handle to
// derive, so `slugFromName` returns `''` and the caller omits `handle` from the URL entirely rather
// than sending something the real form would refuse anyway.

/** Mirrors `/dashboard/cards`' own input `pattern` — see this file's header. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const HANDLE_MAX_LEN = 39;
/** Mirrors the real form's `title` input `maxlength="120"`. */
const TITLE_MAX_LEN = 120;
/** Mirrors the real form's `tagline` input `maxlength="200"`. */
const TAGLINE_MAX_LEN = 200;

/** Where the door leads. Same host every sandbox visitor is reading the banner on. */
export const REAL_CARD_ORIGIN = 'https://feelreef.com';

/**
 * A visitor-typed name → a handle the real form's `pattern` will accept, or `''` when the name has
 * nothing usable in it (see this file's header).
 */
export function slugFromName(name) {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX_LEN)
    .replace(/-+$/, ''); // the slice above can re-expose a trailing '-' at the cut point
  return HANDLE_RE.test(slug) ? slug : '';
}

/**
 * The door's href: `/dashboard/cards` with `handle` / `title` / `tagline` prefilled from what the
 * visitor already has on screen, URL-encoded via `URLSearchParams` (never trusted beyond that by the
 * receiving end — `/dashboard/cards`'s own `load` re-sanitizes on the way in). A param whose value is
 * empty after trimming/capping is omitted rather than sent as `''`, so the real form's own
 * placeholders show instead of a param that would just clear back to nothing.
 */
export function realCardHref({ name, tagline, draft }) {
  const trimmedName = String(name ?? '').trim().slice(0, TITLE_MAX_LEN);
  const handle = slugFromName(name);
  const trimmedTagline = String(tagline ?? '').trim().slice(0, TAGLINE_MAX_LEN);

  const params = new URLSearchParams();
  if (handle) params.set('handle', handle);
  if (trimmedName) params.set('title', trimmedName);
  if (trimmedTagline) params.set('tagline', trimmedTagline);
  // 🔴 THE WHOLE CARD, by reference. `title`/`tagline` were all the door ever carried, so the links,
  // the pictures, the text and the drawers were dropped on the floor — and the button that dropped
  // them was called 「把這張變成真的」. `draft` is the id of the card parked at
  // `card.feelreef.com/try/park`; feelreef's side reads it back over `GET /_api/try/<id>`.
  //
  // 🔴 OPTIONAL BY CONSTRUCTION, both ways. Parking can fail (offline, a store that is not bound),
  // and a door that refuses to open because a convenience failed is worse than a door that carries
  // less — so the id is simply absent then, and this is exactly the URL it has always been. On the
  // far side the param is inert until feelreef's own lane reads it.
  if (draft) params.set('draft', String(draft));

  const qs = params.toString();
  return `${REAL_CARD_ORIGIN}/dashboard/cards${qs ? `?${qs}` : ''}`;
}

/**
 * `name`/`tagline` out of a sandbox card's OWN markdown, so the door always reflects whatever the
 * visitor is looking at right now — same idea as the retired page's live re-derivation on every
 * keystroke, just read back out of the one place this editor already keeps the truth (`S.md`).
 *
 * `name` is the frontmatter `title:` (what the visitor renamed the persona to, or the persona's
 * name if they never touched it). `tagline` is the FIRST `profile` cell's body (the "one-line intro"
 * a visitor edits first) — regex-only, deliberately: card-worker.mjs's own `fm()` reads frontmatter
 * the same way, and a cell's inline body is a single line by the format's own grammar (card-core.js),
 * so a naive first-line read is the honest one here, not a shortcut.
 */
export function sandboxDoorFields(md) {
  const name = /^title:\s*(.+)$/m.exec(String(md ?? ''))?.[1]?.trim() || '';
  const cellBody = /^-\s*\[ ?\]\s*%%\s*card:\s*profile\b[^%]*%%[ \t]*([^\n]*)/m.exec(String(md ?? ''))?.[1];
  const tagline = (cellBody || '').trim();
  return { name, tagline };
}

/** The door's href, derived straight from a sandbox card's current markdown. */
export function sandboxDoorHref(md, { draft } = {}) {
  return realCardHref({ ...sandboxDoorFields(md), draft });
}

/** Where the card is parked on the way out. Same origin as the sandbox — see card-worker.mjs. */
export const PARK_PATH = '/try/park';

/**
 * Park the card and hand back its id, or `''` when that did not work.
 *
 * 🔴 NEVER THROWS, and never blocks the door. This is luggage, not a ticket: if the request fails
 * the visitor still walks through, just carrying a title and a tagline the way they always did.
 * `fetchImpl` is injectable so a harness can prove BOTH halves — the id, and the degrade.
 */
export async function parkSandboxCard(md, { origin = '', fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || !md) return '';
  try {
    const r = await doFetch(`${origin}${PARK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: md,
    });
    if (!r.ok) return '';
    const j = await r.json();
    return typeof j.id === 'string' ? j.id : '';
  } catch {
    return '';
  }
}
