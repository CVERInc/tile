// Google Web Risk lookup for the URLs a card is about to link to (reef#2044 ②).
//
// 🔴 FAIL-OPEN, ON PURPOSE. No key, a timeout, or a non-2xx answer lets the save through with one
// log line. This check protects visitors from a known-bad link; it must never become the reason a
// creator cannot edit their own card because a third-party API is slow or unconfigured.
//
// 🔴 The key never appears in a log line or a response: it travels only in the request URL to
// Google, and every log below names the condition, not the request.
//
// 🔴 THE LIMIT IS ENFORCED, NOT WAIVED. Every destination is checked (in batches of BATCH). More than
// MAX_URLS distinct destinations is refused by the caller (`tooManyLinks`) — "over the limit, check
// nothing" would hand a card author a deterministic bypass. An outage still fails open.
//
// URLs come from card-destinations.mjs (the renderer's output). Nothing here reads markdown.
export const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
export const MAX_URLS = 200;
export const BATCH = 10;
export const TIMEOUT_MS = 3000;
export const ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search';

/**
 * → { url, threat } for the first listed URL, or null (clean, skipped, or failed open).
 * deps: { fetch, log, timeoutMs } — injectable for tests.
 */
export async function checkUrls(urls, env, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const log = deps.log || ((s) => console.log(s));
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const key = env && env.WEB_RISK_API_KEY;
  const unique = [...new Set(urls)];
  if (!unique.length) return null;
  if (!key) { log('url-risk: WEB_RISK_API_KEY not set; save allowed unchecked'); return null; }

  const one = async (uri) => {
    const q = new URLSearchParams();
    for (const t of THREAT_TYPES) q.append('threatTypes', t);
    q.set('uri', uri);
    q.set('key', key);
    const ctl = new AbortController();
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error('timeout')); }, timeoutMs); });
    try {
      const res = await Promise.race([doFetch(`${ENDPOINT}?${q}`, { signal: ctl.signal }), timeout]);
      if (!res.ok) return { failed: `status ${res.status}` };
      const body = await res.json();
      const types = body && body.threat && body.threat.threatTypes;
      return types && types.length ? { url: uri, threat: types[0] } : null;
    } catch (e) {
      return { failed: e && e.message === 'timeout' ? 'timeout' : 'request error' };
    } finally { clearTimeout(timer); }
  };

  const results = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    results.push(...await Promise.all(unique.slice(i, i + BATCH).map(one)));
    if (results.some((r) => r && r.url)) break;      // a listed URL decides; no need to query the rest
  }
  const hit = results.find((r) => r && r.url);
  if (hit) return hit;
  const failed = results.filter((r) => r && r.failed);
  if (failed.length) log(`url-risk: ${failed.length}/${results.length} lookups failed (${failed[0].failed}); save allowed for those`);
  return null;
}

/** → null, or the 422 body when a card has more distinct destinations than can be checked. Only applies when checking is on. */
export function tooManyLinks(urls, env) {
  if (!(env && env.WEB_RISK_API_KEY)) return null;
  const n = new Set(urls).size;
  if (n <= MAX_URLS) return null;
  return { error: 'card_too_many_links', limit: MAX_URLS, count: n,
    message: `A card can have at most ${MAX_URLS} outbound links and images; this one has ${n}. Remove some and save again.` };
}
