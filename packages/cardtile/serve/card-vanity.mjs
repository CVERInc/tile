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
