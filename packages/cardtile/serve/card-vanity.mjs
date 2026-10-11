// Vanity bindings — a creator's own domain, bound to their card — and the API that writes them.
//
// The worker (card-worker.mjs) has READ two keys from the CARDS store since 2026-08-12:
//
//   vanity:<host>       → handle    a creator's own domain resolves to their card
//   vanityof:<handle>   → host      the inverse: a card with its own domain has ONE address
//
// …and until this file nothing in the product could WRITE them: binding a domain was a hand-run
// store write. That made the step CUSTOM-DOMAIN.md marks 🔴 ("adding the host is a step, not an
// afterthought") the one step with no door. This is the door: `/_api/vanity/<handle>`, behind the
// same bearer as the rest of `/_api/` (card-api.mjs routes here), so whatever calls save_card can
// also finish binding a domain.
//
// The keys are defined HERE and imported by the worker, so the reader and the writer cannot drift
// onto two spellings of one key.

/** where a host's card lives. */
export const vanityKey = (host) => `vanity:${host}`;
/** where a card's own host lives. */
export const vanityOfKey = (handle) => `vanityof:${handle}`;

// One DNS label: 1–63 of [a-z0-9-], not starting or ending with a hyphen. Lowercase only — see vanityHost.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** our own zone. Everything under it is platform routing, never a creator's domain. */
const OWN_ZONE = 'feelreef.com';

/**
 * vanityHost: input → the host itself, or null. Pure.
 *
 * Accepts exactly what a browser's Host header can carry for a creator's domain once the worker has
 * stripped the port — because that is the only form under which `vanity:<host>` is ever looked up.
 * A key in any other form is a binding no request can reach, and the failure it causes (the creator's
 * apex showing the directory page) is silent.
 *
 *   - 🔴 lowercase only, refused rather than lowercased: the caller reads back the host it sent.
 *   - no port, path, scheme, query, userinfo, whitespace or trailing dot.
 *   - at least two labels; each label 1–63 chars; the whole name ≤ 253.
 *   - not an IP address (the last label must not be all digits; brackets are not in the grammar).
 *   - Unicode names arrive as punycode (`xn--…`), which is what the Host header carries.
 *   - 🔴 nothing at or under feelreef.com: the canonical host and the SaaS fallback origin live there.
 */
export function vanityHost(input) {
  if (typeof input !== 'string') return null;
  const h = input;
  if (!h || h.length > 253) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null;
  if (h === OWN_ZONE || h.endsWith('.' + OWN_ZONE)) return null;
  return h;
}

const out = (status, body) => ({ status, body });

/**
 * handleVanity: one `/_api/vanity/<handle>` call → { status, body }. card-api.mjs owns the door (the
 * bearer, the handle grammar, the JSON response); this owns the two keys.
 *
 *   GET     → 200 {handle, host|null}                     404 card_not_found
 *   PUT     {host} → 200 {handle, host, changed}           400 vanity_host_invalid · 404 card_not_found
 *                                                          409 vanity_taken · 503 vanity_unconfirmed
 *   DELETE  → 200 {handle, host:null, changed}
 *
 * `handle` arrives already decoded, lowercased and inside the card grammar.
 *
 * ── 🔴 THE WRITE ORDER (KV has no transactions) ─────────────────────────────────────────────────
 *
 * Two states are forbidden at every point a Worker could die, not just at the end:
 *
 *   I1  two hosts serving one card     — duplicate content we created, competing with the creator
 *   I2  vanityof:<h> = X while vanity:X ≠ h
 *                                      — card.feelreef.com/<h> 301s to a host that does not serve
 *                                        that card (the directory page, or someone else's card)
 *
 * A rebind of h from OLD to NEW therefore runs:
 *
 *   1. delete vanity:OLD      (only if it still says h)  — OLD stops serving h before NEW starts: I1
 *   2. delete vanityof:h                                  — the redirect is withdrawn, not left dangling
 *   3. put    vanity:NEW = h,  then read it back           — NEW serves h; lost a race ⇒ 409, stop here
 *   4. put    vanityof:h = NEW                             — only now does the redirect point at NEW: I2
 *
 * Dying after 1 leaves `vanityof:h → OLD` while OLD no longer serves h — I2 broken in the STORE for
 * exactly one call. 🔴 No single-key order avoids that and stays retryable, and the reason is short:
 * `vanityof:h` is the only record of OLD, so it must outlive `vanity:OLD` (or a retry can never find
 * and delete `vanity:OLD` — a permanent I1); and I2 says it must NOT outlive it. Both at once means
 * changing two keys in one write, which KV cannot do. So the order keeps the property that is
 * permanent (I1, plus "the same PUT again finishes the job"), and I2 is enforced where it is
 * observed: card-worker.mjs 301s only when `vanity:<vanityof:h>` names h. A dangling `vanityof:` is
 * then inert — the card answers on its canonical URL — and the tests kill the Worker at every step,
 * check both invariants through the worker, and retry.
 *
 * Dying after 2 or 3 leaves the card served at its canonical URL (no redirect) and on at most one
 * creator host: legal, and a retry completes it.
 *
 * 🔴 What the order does NOT buy: KV is eventually consistent ACROSS edge locations, so a reader on
 * another continent can see these four writes in any mix for up to about a minute. The order bounds
 * what this Worker and its retry observe, which is what makes a retry correct; it is not a promise
 * about every visitor during the propagation window. (The worker's both-halves check holds I2 there
 * too, since it reads both keys at the visitor's own location; I1 can be briefly violated at a
 * location that has not yet seen step 1.)
 */
export async function handleVanity({ method, handle, store, readJson }) {
  const card = await store.get(handle);

  if (method === 'GET') {
    if (card == null) return out(404, { error: 'card_not_found' });
    return out(200, { handle, host: (await store.get(vanityOfKey(handle))) || null });
  }

  if (method === 'PUT') {
    const body = await readJson();
    const host = vanityHost(body && typeof body === 'object' ? body.host : undefined);
    if (!host) return out(400, { error: 'vanity_host_invalid' });
    if (card == null) return out(404, { error: 'card_not_found' });

    const holder = await store.get(vanityKey(host));
    // 🔴 The other card is not named: whose domain this is belongs to that card's owner, and the
    // caller is acting for somebody else.
    if (holder != null && holder !== handle) return out(409, { error: 'vanity_taken' });
    const old = await store.get(vanityOfKey(handle));
    if (holder === handle && old === host) return out(200, { handle, host, changed: false });

    // 1 + 2 — let go of the old host (only if it is still ours), then withdraw the redirect.
    if (old && old !== host) {
      if ((await store.get(vanityKey(old))) === handle) await store.delete(vanityKey(old));
      await store.delete(vanityOfKey(handle));
    }
    // 3 — take the new host, and confirm we have it before anything points at it.
    if (holder !== handle) await store.put(vanityKey(host), handle);
    const landed = await store.get(vanityKey(host));
    if (landed != null && landed !== handle) return out(409, { error: 'vanity_taken' });
    if (landed !== handle) return out(503, { error: 'vanity_unconfirmed' });
    // 4 — only now does the canonical URL send people there.
    await store.put(vanityOfKey(handle), host);
    if ((await store.get(vanityOfKey(handle))) !== host) return out(503, { error: 'vanity_unconfirmed' });
    return out(200, { handle, host, changed: true });
  }

  if (method === 'DELETE') {
    // No card check: removing a binding must stay possible after the card it pointed at is gone.
    // Same order as a rebind's first two steps, for the same reason — `vanityof:` is the last record
    // of the host, so it goes last.
    const host = await store.get(vanityOfKey(handle));
    if (!host) return out(200, { handle, host: null, changed: false });
    if ((await store.get(vanityKey(host))) === handle) await store.delete(vanityKey(host));
    await store.delete(vanityOfKey(handle));
    return out(200, { handle, host: null, changed: true });
  }

  return out(405, { error: 'method_not_allowed' });
}
