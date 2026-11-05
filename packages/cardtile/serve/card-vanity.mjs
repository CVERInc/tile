// `/_api/vanity/<handle>` — a creator's own domain, bound to their card (reef#1971).
//
// The caller is reef-mcp's `connect_card_domain` (its `makeCardVanityClient`), behind the same bearer
// as the rest of `/_api/`. This file is the route and nothing else: every write goes through the
// lifetime-bound door in card-api.mjs —
//   bindVanity     register → point → confirm   (HostBindings owns `vanity:<host>`, CardLifetime the inverse)
//   releaseVanity  admit → withdraw → unbind    (the same two objects, in the order that undoes a bind)
// — and no key is written from here. The keys, their writers and the write orders are the table in
// cards/README.md ("who writes each key").
//
//   GET     → 200 {handle, host|null, redirect, invalid_host?: true, inconsistent?: true}
//             404 card_not_found
//   PUT     {host, redirect?=true, expect?} → 200 {handle, host, redirect, changed}
//             400 vanity_host_invalid · vanity_redirect_invalid · vanity_expect_invalid
//             404 card_not_found · 409 vanity_state_inconsistent · vanity_state_changed
//             409 {vanity_taken, held_by} · 503 vanity_unconfirmed
//   DELETE  {expect?, host?} → 200 {handle, host:null, changed}
//             with `host`: 200 {handle, host|null, changed, orphan_removed}
//             400 vanity_expect_invalid · vanity_host_invalid · 409 vanity_state_changed
//             409 {vanity_taken, held_by} · 503 vanity_unconfirmed
//   all     400 handle_invalid · 405 method_not_allowed · 503 vanity_unavailable (an object is not bound)
//
// ── What the card's binding IS, read from the objects ────────────────────────────────────────────
//
// A host H is this card's when HostBindings(H) names `{ handle, gen }` with `gen` the card's current
// lifetime in CardLifetime(handle). The candidates are the hosts that lifetime registered plus the host
// its inverse names (and, before CardLifetime adopted a generation-0 legacy inverse, what the renderer
// reads for it). A host whose object never adopted its legacy pointer is held by that pointer's handle
// at generation 0, as HostBindings will adopt it. Ownership is never read from the KV pointer otherwise:
// that is a cache.
//   · one host held, and the inverse names it or nothing → `{ host, redirect }`;
//   · nothing held and no inverse                          → `{ host: null, redirect: false }`;
//   · more than one held, or an inverse naming a host the card does not hold → `inconsistent: true`.
//     The route never makes either (a PUT releases the old host before it binds the new one), but two
//     unserialised PUTs to different hosts can, and so can hand-made legacy keys. PUT refuses it;
//     DELETE is the repair (it releases every host the card holds and withdraws the redirect);
//   · a held or redirected host the route would refuse (vanityHost) → `invalid_host: true`. DELETE or a
//     PUT to a valid host releases it.
// The view reports `host: null, redirect: false` in the last two cases, and `expect` compares with it.
//
// 🔴 The objects serialise each host and each handle; this route does not serialise a CALL. A GET, the
// `expect` comparison and the writes are separate object turns, so `expect` narrows a lost update and
// does not prevent one. The caller serialises (reef's claim on the host). What the objects DO make
// impossible, whatever the callers do: two cards' binds both landing on one host, a refused bind
// publishing anything, a bind of an ended lifetime landing, a bind admitted before a release landing
// after it, and a redirect to a host the card does not hold surviving a loss or a release.

import {
  VALID_HANDLE, GEN0, bindVanity, releaseVanity, hostOwnerOf, lifetimeBinding, liveCard, boundHostOf, vanityKey,
} from './card-api.mjs';

// One DNS label: 1–63 of [a-z0-9-], not starting or ending with a hyphen. Lowercase only — see vanityHost.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** platform zones: everything at or under these is our routing, never a creator's domain */
const PLATFORM_ZONES = ['feelreef.com', 'reef.cards', 'workers.dev'];

/**
 * vanityHost: input → the host itself, or null. Pure.
 *
 * Accepts exactly what `new URL(request.url).hostname` is for a creator's domain, because that is the
 * only form under which the worker looks a binding up. A host in any other form is a binding no request
 * can reach.
 *   - 🔴 lowercase only, refused rather than lowercased: the caller reads back the host it sent;
 *   - no port, path, scheme, query, userinfo, whitespace or trailing dot; ≥ 2 labels, ≤ 253 chars;
 *   - not an IP address in any spelling: the last label is not all digits, and the WHATWG URL parser
 *     must read the name back as itself and not as a dotted quad (`127.0x1`, `0x7f.1` are 127.0.0.1);
 *   - IDNs as punycode, and VALID punycode (the parser throws on `xn--a.example`);
 *   - 🔴 nothing at or under a platform zone (the canonical hosts, the SaaS fallback origin).
 */
export function vanityHost(input) {
  if (typeof input !== 'string') return null;
  const h = input;
  if (!h || h.length > 253) return null;
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null;
  if (PLATFORM_ZONES.some((z) => h === z || h.endsWith('.' + z))) return null;
  // Within the label grammar above the parser only rewrites IPv4 spellings, which the dotted-quad test
  // catches; `parsed !== h` stays as the rule itself, for the day that grammar loosens.
  let parsed;
  try { parsed = new URL(`https://${h}/`).hostname; } catch { return null; }
  if (parsed !== h || /^\d+\.\d+\.\d+\.\d+$/.test(parsed)) return null;
  return h;
}

const out = (status, body) => ({ status, body });
const refuse = (status, error, extra = {}) => out(status, { error, ...extra });

/** `expect`: `{host: string|null, redirect: boolean}` (what GET returned), undefined when absent */
const INVALID = Symbol('invalid');
function parseExpect(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'expect')) return undefined;
  const e = obj.expect;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return INVALID;
  if (!(e.host === null || typeof e.host === 'string') || typeof e.redirect !== 'boolean') return INVALID;
  return { host: e.host, redirect: e.redirect };
}

/**
 * who holds `host`: `{ handle, gen }` from its object, or — while the object has never adopted the
 * legacy KV pointer — that pointer's handle at generation 0, exactly as HostBindings would adopt it
 * (a value outside the handle grammar is no owner there either). null = nobody.
 */
async function holderOf(env, host) {
  const o = await hostOwnerOf(env, host);
  if (o.handle) return { handle: o.handle, gen: o.gen };
  if (o.adopted) return null;
  const legacy = await env.CARDS.get(vanityKey(host));
  return typeof legacy === 'string' && VALID_HANDLE.test(legacy) ? { handle: legacy, gen: GEN0 } : null;
}

/**
 * the card's binding as the objects have it: `{ gen, hosts, held, inverse }` — `hosts` every host the
 * lifetime registered, `held` those it holds now (see the header)
 */
async function bindingOf(env, handle) {
  const life = await lifetimeBinding(env, handle);
  const inverse = life.inverse
    ?? (life.gen === GEN0 && !life.adopted ? await boundHostOf(env.CARDS, handle, GEN0) : null);
  const candidates = [...new Set([...life.hosts, ...(inverse ? [inverse] : [])])];
  const holders = await Promise.all(candidates.map((h) => holderOf(env, h)));
  const held = candidates.filter((h, i) => holders[i] && holders[i].handle === handle && holders[i].gen === life.gen);
  return { gen: life.gen, hosts: life.hosts, held, inverse: inverse || null };
}

/**
 * every host a release must reach: the held ones, the inverse's, and every host the lifetime
 * registered — a bind registers before it points (bindVanity), so a release of a registered host also
 * fences a bind of it still in flight (HostBindings `released`)
 */
const reach = (state) => [...new Set([...state.hosts, ...state.held, ...(state.inverse ? [state.inverse] : [])])];

/** what GET reports for a binding, and what `expect` is compared with */
function viewOf({ held, inverse }) {
  if (held.length > 1 || (inverse && !held.includes(inverse))) return { host: null, redirect: false, inconsistent: true };
  if (held.some((h) => !vanityHost(h)) || (inverse && !vanityHost(inverse))) return { host: null, redirect: false, invalid_host: true };
  if (!held.length) return { host: null, redirect: false };
  return { host: held[0], redirect: inverse === held[0] };
}
const moved = (view, expect) => !!expect && (view.host !== expect.host || view.redirect !== expect.redirect);

/** a card exists exactly when the worker would serve a body for it: a non-empty value */
async function cardExists(store, handle) {
  const { md, gen } = await liveCard(store, handle);
  return { exists: typeof md === 'string' && md.length > 0, gen };
}

/**
 * release each host, in order; a conflict (a newer bind of this card landed, or the ticket expired)
 * stops and is reported. → { released: boolean (anything was this card's), conflict? }
 */
async function releaseAll(env, handle, hosts, gen) {
  let released = false;
  for (const h of hosts) {
    const r = await releaseVanity(env, handle, h, { gen });
    if (r.conflict) return { released, conflict: true };
    released = released || r.released === true;
  }
  return { released };
}

/**
 * handleVanity({ method, handle, env, readJson }) → { status, body }. card-api.mjs owns the door (the
 * bearer, the JSON response); `handle` arrives decoded, lowercased and inside the card grammar.
 */
export async function handleVanity({ method, handle, env, readJson }) {
  if (!['GET', 'PUT', 'DELETE'].includes(method)) return refuse(405, 'method_not_allowed');
  // both objects or nothing: without them a binding has no writer and its state cannot be read
  if (!env.HOST_BINDINGS || !env.CARD_LIFETIMES) return refuse(503, 'vanity_unavailable');
  const store = env.CARDS;

  if (method === 'GET') {
    const card = await cardExists(store, handle);
    if (!card.exists) return refuse(404, 'card_not_found');
    try {
      return out(200, { handle, ...viewOf(await bindingOf(env, handle)) });
    } catch { return refuse(503, 'vanity_unavailable'); }
  }

  const raw = await readJson();
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  if (method === 'PUT') {
    const host = vanityHost(body.host);
    if (!host) return refuse(400, 'vanity_host_invalid');
    if (Object.prototype.hasOwnProperty.call(body, 'redirect') && typeof body.redirect !== 'boolean') return refuse(400, 'vanity_redirect_invalid');
    const redirect = body.redirect !== false;
    const expect = parseExpect(body);
    if (expect === INVALID) return refuse(400, 'vanity_expect_invalid');
    const card = await cardExists(store, handle);
    if (!card.exists) return refuse(404, 'card_not_found');
    try {
      const state = await bindingOf(env, handle);
      const view = viewOf(state);
      if (view.inconsistent) return refuse(409, 'vanity_state_inconsistent');
      if (moved(view, expect)) return refuse(409, 'vanity_state_changed');
      // checked BEFORE the card lets go of its old host, so the common refusal writes nothing. It is
      // not the guard: `take: false` makes the host's own object refuse at /point, in its turn.
      const holder = await holderOf(env, host);
      if (holder && holder.handle !== handle) return refuse(409, 'vanity_taken', { held_by: holder.handle });
      if (!view.invalid_host && view.host === host && view.redirect === redirect) {
        return out(200, { handle, host, redirect, changed: false });
      }
      // the old host lets go before the new one serves (one card, one domain), and its redirect first
      const others = reach(state).filter((h) => h !== host);
      if ((await releaseAll(env, handle, others, state.gen)).conflict) return refuse(409, 'vanity_state_changed');
      // `gen`: the lifetime of the card this request checked exists (cards/README.md)
      const bound = await bindVanity(env, handle, host, { redirect, gen: card.gen, take: false });
      if (bound.taken) return refuse(409, 'vanity_taken', { held_by: bound.held_by });
      if (bound.conflict || bound.redirect === 'not_published' || bound.redirect === 'not_withdrawn') {
        return refuse(409, 'vanity_state_changed');
      }
      return out(200, { handle, host, redirect, changed: true });
    } catch { return refuse(503, 'vanity_unconfirmed'); }
  }

  // DELETE — no card check: removing a binding must stay possible after the card it served is gone
  const expect = parseExpect(body);
  if (expect === INVALID) return refuse(400, 'vanity_expect_invalid');
  const hasHost = Object.prototype.hasOwnProperty.call(body, 'host');
  const named = hasHost ? vanityHost(body.host) : null;
  if (hasHost && !named) return refuse(400, 'vanity_host_invalid');
  try {
    const state = await bindingOf(env, handle);
    const view = viewOf(state);
    if (moved(view, expect)) return refuse(409, 'vanity_state_changed');

    if (named) {
      // one host BY NAME: the card's own binding, or a host still held for this handle that its GET
      // does not report (an ended lifetime's whose end is owed, a legacy pointer from generation 0,
      // a second host from unserialised PUTs). Never another card's.
      const holder = await holderOf(env, named);
      if (holder && holder.handle !== handle) return refuse(409, 'vanity_taken', { held_by: holder.handle });
      const own = view.host === named;
      let changed = false;
      if (holder || state.inverse === named || state.hosts.includes(named)) {
        const r = await releaseVanity(env, handle, named, { gen: state.gen });
        if (r.conflict) return refuse(409, 'vanity_state_changed');
        changed = r.released === true || state.inverse === named;
      }
      const after = viewOf(await bindingOf(env, handle));
      return out(200, { handle, host: after.host, changed, orphan_removed: !own && changed });
    }

    const all = reach(state);
    if (!all.length) return out(200, { handle, host: null, changed: false });
    const r = await releaseAll(env, handle, all, state.gen);
    if (r.conflict) return refuse(409, 'vanity_state_changed');
    return out(200, { handle, host: null, changed: r.released || !!state.inverse });
  } catch { return refuse(503, 'vanity_unconfirmed'); }
}
