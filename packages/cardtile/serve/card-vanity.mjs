// Vanity bindings — a creator's own domain, bound to their card — and the API that writes them.
//
// The worker (card-worker.mjs) has READ two keys from the CARDS store since 2026-08-12:
//
//   vanity:<host>       → handle    a creator's own domain resolves to their card
//   vanityof:<handle>   → host      the canonical URL 301s there: a card with its own domain has ONE address
//
// …and this API keeps a third, which the worker never reads:
//
//   vanityhost:<handle> → host      the API's own record of the binding, in BOTH modes
//
// Why a third key (reef#1971). A binding can exist WITHOUT the redirect (`redirect: false`): the
// domain serves the card, but card.feelreef.com/<handle> keeps answering — the state between "the
// certificate is active" and "the creator has pointed DNS here", when a 301 would send the canonical
// URL to a domain that does not reach us yet. In that state `vanityof:` is absent, and `vanity:<host>`
// cannot be found from the handle without listing the store, so GET would have no way to say what
// the card is bound to. (Asking GET for `?host=` instead would make the caller remember what the
// store already knows, and DELETE would need it too.) The record is also what lets a rebind's write
// order survive a Worker dying mid-call — see handleVanity.
//
// ── 🔴 WHAT THIS API DOES NOT DO: arbitrate ────────────────────────────────────────────────────────
//
// KV has no atomic operation, and a value written at one location can take 60 seconds or more to be
// seen at another (Cloudflare does not even promise read-your-write at the writing location). So
// nothing in this file can decide, atomically, who owns a host, and nothing here is safe to call
// concurrently: two un-serialised changes to the same host, or to the same handle, can leave a host
// silently taken from its card or a card served on two hosts, permanently. Reading back our own write
// does not reserve anything against a later writer.
//
// 🔴 THE CALLER MUST SERIALISE all changes to one host and to one handle. The one caller (reef's
// `connect_card_domain`, holding the infrastructure bearer) does that against its own authoritative
// record of who owns which domain; this API is the KV projection of that decision, not the decision.
// What this API adds on top is a cheap optimistic check — `expect`, below — and an order that a
// SINGLE serialised caller can always finish by retrying.
//
// GET answers from THIS location's reads only. It says what a visitor here would get right now, not
// what every location sees, and not whether the domain's DNS reaches us.
//
// Compatibility with bindings written by hand before this API covers the two-key shape only
// (`vanity:<host>` + `vanityof:<handle>`). A forward-only key (`vanity:<host>` with no reverse key)
// cannot be found from the handle: GET reports it as unbound, DELETE cannot remove it, and binding
// that card elsewhere leaves it serving. Those must be cleaned up by hand.
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
/** where a card's canonical URL redirects to (present only while the redirect is on). */
export const vanityOfKey = (handle) => `vanityof:${handle}`;
/** the API's record of which host a card is bound to, redirect or not. Never read by the worker. */
export const vanityHostKey = (handle) => `vanityhost:${handle}`;

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
 *   - Unicode names arrive as punycode (`xn--…`), which is what the Host header carries — and it must
 *     be VALID punycode: the WHATWG URL parser must accept it and read back the identical name.
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
  // 🔴 …and the URL parser must read it back as the SAME name. Every consumer of this host is a URL
  // (the worker's own Response.redirect, a browser): `127.0x1` passes every rule above and is
  // `127.0.0.1` to all of them, and `xn--a.example` passes them and is not a URL at all. So the
  // parser that will consume the name is the one that judges it — and a dotted quad, however it was
  // spelled, is still an address.
  let parsed;
  try { parsed = new URL(`https://${h}/`).hostname; } catch { return null; }
  if (parsed !== h || /^\d+\.\d+\.\d+\.\d+$/.test(parsed)) return null;
  return h;
}

const out = (status, body) => ({ status, body });

/**
 * `expect`: the caller's view of the binding — `{host: string|null, redirect: boolean}`, the shape GET
 * returns — or undefined when the body does not carry one. INVALID when present and malformed.
 */
const INVALID = Symbol('invalid');
function parseExpect(obj) {
  if (!('expect' in obj)) return undefined;
  const e = obj.expect;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return INVALID;
  if (!(e.host === null || typeof e.host === 'string') || typeof e.redirect !== 'boolean') return INVALID;
  return { host: e.host, redirect: e.redirect };
}

/**
 * handleVanity: one `/_api/vanity/<handle>` call → { status, body }. card-api.mjs owns the door (the
 * bearer, the handle grammar, the JSON response); this owns the keys.
 *
 *   GET     → 200 {handle, host|null, redirect}          404 card_not_found
 *   PUT     {host, redirect?=true, expect?} → 200 {handle, host, redirect, changed}
 *           400 vanity_host_invalid · 400 vanity_redirect_invalid · 400 vanity_expect_invalid
 *           404 card_not_found · 409 vanity_state_changed · 409 vanity_taken · 503 vanity_unconfirmed
 *   DELETE  {expect?} → 200 {handle, host:null, changed}  400 vanity_expect_invalid · 409 vanity_state_changed
 *
 * `expect` is `{host: string|null, redirect: boolean}` — exactly what GET returned. When present and
 * this location's current binding differs, the call writes nothing and answers 409
 * vanity_state_changed. It narrows the window for a lost update; it does not close it (KV cannot),
 * which is why the caller serialises — see the file header.
 *
 * `handle` arrives already decoded, lowercased and inside the card grammar.
 *
 * PUT is DECLARATIVE: the body says what the binding should be, and the call makes it so. Sending
 * `redirect: true` to a binding made with `false` writes only `vanityof:`; sending `false` to one
 * made with `true` removes only `vanityof:`. The same body twice is `changed: false` with no writes.
 *
 * ── 🔴 THE WRITE ORDER (KV has no transactions) ─────────────────────────────────────────────────
 *
 * 🔴 Everything in this section assumes ONE serialised caller and a store that shows that caller its
 * own writes. Under concurrent callers or stale reads it guarantees nothing — see the file header.
 *
 * Two states are forbidden at every point a Worker could die, not just at the end:
 *
 *   I1  two hosts serving one card     — duplicate content we created, competing with the creator
 *   I2  vanityof:<h> = X while vanity:X ≠ h
 *                                      — card.feelreef.com/<h> 301s to a host that does not serve
 *                                        that card (the directory page, or someone else's card)
 *
 * …and a third property: the SAME call sent again finishes whatever a dead Worker left half-done.
 * That needs the old host to be findable until its `vanity:` key is gone, and `vanityhost:` is that
 * record — written BEFORE the key it describes, deleted AFTER it. A PUT of h to NEW (redirect on):
 *
 *   0. put    vanityhost:h = OLD   only for a binding made before this key existed (it had only
 *                                  vanityof:), so the record exists before vanityof: is withdrawn
 *   1. delete vanityof:h           the redirect is withdrawn FIRST — nothing points anywhere: I2
 *   2. delete vanity:OLD           only if it still says h — OLD lets go before NEW serves: I1
 *   3. put    vanityhost:h = NEW   the record moves before the key it describes exists
 *   4. put    vanity:NEW = h       then read it back; lost a race ⇒ drop the record, 409, stop
 *   5. put    vanityof:h = NEW     only if redirect, and only once NEW verifiably serves h: I2
 *
 * Every step is skipped when it is already true, so turning the redirect on is step 5 alone and
 * turning it off is step 1 alone. DELETE is 0, 1, 2, then `delete vanityhost:h` last.
 *
 * For a single serialised caller, at every point between those steps, I1 and I2 hold in the store as
 * that caller sees it, and the record names the only host that can still say h — so a retry always
 * knows what to let go of. (Before the record existed,
 * `vanityof:` was the only trace of OLD; it had to outlive `vanity:OLD` for the retry and could not for
 * I2, so one store call of dangling redirect was unavoidable. The record removes that trade.) The
 * tests kill the Worker before every write, in every mode and from every starting state, check both
 * invariants, and retry.
 *
 * 🔴 What the order does NOT buy: anything at another location. KV propagates each write to each
 * location on its own schedule (60 seconds or more), so a visitor elsewhere can see these writes in
 * any mix: the old domain still serving, or a 301 from a location that sees both new keys to a
 * domain whose own location does not serve the card yet. card-worker.mjs refuses the 301 unless both
 * keys agree where IT reads them; that check is local, and it says nothing about what the
 * destination will answer.
 */
export async function handleVanity({ method, handle, store, readJson }) {
  const card = await store.get(handle);

  // which host this card is bound to, if any, and whether that host actually serves it.
  // The record first; a binding made before the record existed has only vanityof:.
  const recorded = async () => (await store.get(vanityHostKey(handle))) || (await store.get(vanityOfKey(handle))) || null;

  // the binding as GET reports it. 🔴 A host is reported only if THIS location's store says it serves
  // this card — a record left by a lost race or a dead Worker is not a binding.
  const current = async () => {
    const host = await recorded();
    if (!host || (await store.get(vanityKey(host))) !== handle) return { host: null, redirect: false };
    return { host, redirect: (await store.get(vanityOfKey(handle))) === host };
  };
  // `expect` given and no longer true ⇒ the caller decided on a state that has since changed.
  const stale = async (expect) => {
    if (!expect) return false;
    const now = await current();
    return now.host !== expect.host || now.redirect !== expect.redirect;
  };

  if (method === 'GET') {
    if (card == null) return out(404, { error: 'card_not_found' });
    return out(200, { handle, ...(await current()) });
  }

  if (method === 'PUT') {
    const body = await readJson();
    const obj = body && typeof body === 'object' ? body : {};
    const host = vanityHost(obj.host);
    if (!host) return out(400, { error: 'vanity_host_invalid' });
    if ('redirect' in obj && typeof obj.redirect !== 'boolean') return out(400, { error: 'vanity_redirect_invalid' });
    const redirect = obj.redirect !== false;
    const expect = parseExpect(obj);
    if (expect === INVALID) return out(400, { error: 'vanity_expect_invalid' });
    if (card == null) return out(404, { error: 'card_not_found' });
    if (await stale(expect)) return out(409, { error: 'vanity_state_changed' });

    const holder = await store.get(vanityKey(host));
    // 🔴 The other card is not named: whose domain this is belongs to that card's owner, and the
    // caller is acting for somebody else.
    if (holder != null && holder !== handle) return out(409, { error: 'vanity_taken' });

    let record = await store.get(vanityHostKey(handle));
    const own = await store.get(vanityOfKey(handle));
    const want = redirect ? host : null;
    if (holder === handle && (record || own) === host && (own || null) === want) {
      // Already exactly this. A pre-record binding gets its record now so its next change is
      // ordered like every other; that is bookkeeping, not a change to what anyone sees.
      if (!record) await store.put(vanityHostKey(handle), host);
      return out(200, { handle, host, redirect, changed: false });
    }

    // 0 — a binding from before the record: write the record before vanityof: (its only trace) goes.
    if (!record && own) { await store.put(vanityHostKey(handle), own); record = own; }
    // 1 — withdraw the redirect unless it already points exactly where it should stay.
    if (own != null && own !== want) await store.delete(vanityOfKey(handle));
    // 2 — let go of the old host, only if it is still ours.
    if (record && record !== host && (await store.get(vanityKey(record))) === handle) await store.delete(vanityKey(record));
    // 3 — the record moves before the key it describes exists.
    if (record !== host) await store.put(vanityHostKey(handle), host);
    // 4 — take the new host, and confirm we have it before anything points at it.
    if (holder !== handle) {
      await store.put(vanityKey(host), handle);
      const landed = await store.get(vanityKey(host));
      if (landed != null && landed !== handle) {
        await store.delete(vanityHostKey(handle));
        return out(409, { error: 'vanity_taken' });
      }
      if (landed !== handle) return out(503, { error: 'vanity_unconfirmed' });
    }
    // 5 — only now, and only if asked, does the canonical URL send people there.
    if (redirect && own !== host) {
      await store.put(vanityOfKey(handle), host);
      if ((await store.get(vanityOfKey(handle))) !== host) return out(503, { error: 'vanity_unconfirmed' });
    }
    return out(200, { handle, host, redirect, changed: true });
  }

  if (method === 'DELETE') {
    // No card check: removing a binding must stay possible after the card it pointed at is gone.
    // Same order as a PUT's first steps; the record goes LAST because it is what a retry reads.
    const body = await readJson();
    const expect = parseExpect(body && typeof body === 'object' ? body : {});
    if (expect === INVALID) return out(400, { error: 'vanity_expect_invalid' });
    if (await stale(expect)) return out(409, { error: 'vanity_state_changed' });
    let record = await store.get(vanityHostKey(handle));
    const own = await store.get(vanityOfKey(handle));
    if (!record && !own) return out(200, { handle, host: null, changed: false });
    if (!record) { await store.put(vanityHostKey(handle), own); record = own; }
    if (own != null) await store.delete(vanityOfKey(handle));
    if ((await store.get(vanityKey(record))) === handle) await store.delete(vanityKey(record));
    await store.delete(vanityHostKey(handle));
    return out(200, { handle, host: null, changed: true });
  }

  return out(405, { error: 'method_not_allowed' });
}
