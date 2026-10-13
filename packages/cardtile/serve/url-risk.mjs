// Google Web Risk lookup for the URLs a card is about to link to (reef#2044 ②).
//
// 🔴 FAIL-OPEN, ON PURPOSE. No key, a timeout, or a non-2xx answer lets the save through with one
// log line. This check protects visitors from a known-bad link; it must never become the reason a
// creator cannot edit their own card because a third-party API is slow or unconfigured.
//
// 🔴 The key never appears in a log line or a response: it travels only in the request URL to
// Google, and every log below names the condition, not the request.
//
// URLs come from card-destinations.mjs (the renderer's output). Nothing here reads markdown.
export const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
export const MAX_URLS = 50;
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
  if (unique.length > MAX_URLS) { log(`url-risk: ${unique.length} URLs exceeds ${MAX_URLS}; save allowed unchecked`); return null; }

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

  const results = await Promise.all(unique.map(one));
  const hit = results.find((r) => r && r.url);
  if (hit) return hit;
  const failed = results.filter((r) => r && r.failed);
  if (failed.length) log(`url-risk: ${failed.length}/${unique.length} lookups failed (${failed[0].failed}); save allowed for those`);
  return null;
}
