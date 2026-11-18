// Stand-in hosts — how a staging deployment plays the three host roles without their real names.
//
// The cardtile worker decides by the request's hostname, and each role has exactly one name
// (card-worker.mjs: the service's host, the people's canonical host, the legacy host). Those names
// route to production, so a staging deployment can never be asked as one of them. `CARDS_HOST_STANDINS`
// names the hostnames that stand in for them there:
//
//   CARDS_HOST_STANDINS = "service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com"
//
// A request to a stand-in is answered as the role's real host would answer it — the request is
// re-addressed and run through the same router, the way the open stage re-addresses reef.cards
// (card-worker.mjs openStageAnswer) — and then:
//
//   · a `Location` that names a role's real host names that role's stand-in instead (when it has one),
//     so a redirect chain stays inside staging and can be followed end to end;
//   · every answer carries `X-Robots-Tag: noindex, nofollow`.
//
// 🔴 What it does NOT change: the addresses written INSIDE a page (canonical, og:url, the QR, the
// "make your own" link) are the real hosts'. Staging proves which host answers what, and where each
// redirect goes — not the text of a page, which the engine's own tests read.
//
// 🔴 A stand-in is a name of OURS: strictly under feelreef.com or reef.cards, never a role's real
// name, the apex or the fallback origin, and never a creator's domain. Anything else in the setting is
// ignored, as is a role named twice or a host given to two roles. Roles and hostnames are read as
// written — lowercase, as a request's hostname is; `Service=` or an upper-case host is ignored, not
// folded. Unset (every deployment that is not staging): nothing here runs.
//
// 🔴 The list alone turns nothing on. The Worker reads it only when BOTH hold (card-worker.mjs
// standInsOn): CARDS_SERVICE_HOST is exactly its one value — unset or mistyped, a request to a
// stand-in's hostname is answered as that hostname always was — and the deployment is not production
// (`PREVIEW` is not "false"). This module does not check either: it is the mapping, not the switch.

// One DNS label, as card-vanity.mjs reads it.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ZONES = ['feelreef.com', 'reef.cards'];
const NEVER = ['saas.feelreef.com', 'www.feelreef.com', 'staging.feelreef.com'];

/**
 * hostName: a host as the three roles compare it — lower case, no port, no trailing dot. Pure.
 * `new URL().hostname` is lowercase and port-free, but it keeps the dot of a fully qualified name
 * (`cards.feelreef.com.`), and the same host must not be two names to a rule that is decided by
 * name (tile#378). Read only once the service host is on: with it off, every host is compared as
 * it always was (card-worker.mjs serviceHostStage).
 */
export const hostName = (host) => String(host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

/**
 * standIns: (env, real: { role → real host }) → { byHost: Map stand-in → real host, byRole: Map role → stand-in }. Pure.
 */
export function standIns(env, real) {
  const byHost = new Map(), byRole = new Map();
  const raw = env && typeof env.CARDS_HOST_STANDINS === 'string' ? env.CARDS_HOST_STANDINS : '';
  if (!raw) return { byHost, byRole };
  const taken = new Set([...Object.values(real), ...NEVER]);
  for (const entry of raw.split(/[\s,]+/)) {
    const eq = entry.indexOf('=');
    if (eq < 1) continue;
    const role = entry.slice(0, eq);
    const h = entry.slice(eq + 1);
    if (!Object.hasOwn(real, role) || byRole.has(role) || byHost.has(h)) continue;
    if (!h || h.length > 253 || taken.has(h)) continue;
    if (!ZONES.some((z) => h.endsWith('.' + z))) continue;
    if (!h.split('.').every((l) => LABEL.test(l))) continue;
    byRole.set(role, h);
    byHost.set(h, real[role]);
  }
  return { byHost, byRole };
}

/**
 * standIn: (request, env, real) → null when the request's host is no configured stand-in; otherwise
 * `{ request, answer }` — the request re-addressed to the role's real host, and the function that
 * turns the router's response into the stand-in's.
 */
export function standIn(request, env, real) {
  const map = standIns(env, real);
  if (!map.byHost.size) return null;
  const url = new URL(request.url);
  const to = map.byHost.get(hostName(url.hostname));
  if (!to) return null;
  url.hostname = to;
  const headers = new Headers(request.headers);
  const roleOf = new Map(Object.entries(real).map(([role, host]) => [host, role]));
  // a browser on the stand-in says so in Origin; the routes that compare it compare it with the real host.
  // 🔴 Only the hostname is re-addressed, as in the URL above: the scheme and the port are the
  // sender's, and an origin on another port is another origin.
  // 🔴 An Origin that names a role's REAL host is another site to the stand-in, but after the request
  // is re-addressed it could equal the request's own origin: it is replaced by "null", which equals no
  // origin, so it stays cross-origin (tile#378).
  const origin = headers.get('origin');
  if (origin) {
    try {
      const o = new URL(origin);
      const r = map.byHost.get(o.hostname);
      if (r && o.protocol === 'https:' && origin === o.origin) { o.hostname = r; headers.set('origin', o.origin); }
      else if (roleOf.has(hostName(o.hostname))) headers.set('origin', 'null');
    } catch { /* not an origin: left as sent */ }
  }
  return {
    request: new Request(url.href, new Request(request, { headers })),
    answer(res) {
      const out = new Headers(res.headers);
      const loc = out.get('location');
      if (loc) {
        try {
          const l = new URL(loc);   // a relative Location stays on the stand-in by itself
          const s = map.byRole.get(roleOf.get(l.hostname));
          if (s && (l.protocol === 'https:' || l.protocol === 'http:')) { l.hostname = s; out.set('location', l.href); }
        } catch { /* relative: untouched */ }
      }
      out.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    },
  };
}
