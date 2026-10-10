// REEF with Repo Facts — the edge half. A small Cloudflare Worker that reads ONE owner's public
// repository listing from the forge once a day and answers with four checked fields per repo:
//
//   GET /v0/repo-facts?owner=CVERInc
//   → { "clikae": { "name": "clikae", "pushed_at": "2026-10-07", "archived": false, "stars": 4 }, … }
//
// Why an edge worker: so the visitor's browser never talks to the forge. Of the visitor's request
// only the method, the path and `owner` are read, so nothing of theirs can be passed on.
//
// 🔴 NOT A PROXY. The owner must be in OWNERS (hard-coded), and the only upstream address this file
// can build is that owner's listing. No name from the request reaches the forge.
//
// 🔴 NO FREE TEXT LEAVES HERE. Each answer is built from scratch out of four fields that passed a
// shape check; descriptions, topics and the rest of the listing stay behind.
//
// The facts change by the day, so the cache is one entry per owner, fresh for a day. After that the
// old answer is served at once and refreshed behind the response; a failed read keeps the old
// answer. One forge call per owner per day per Cloudflare location — well inside the forge's
// anonymous quota (60 an hour), which is why there is no token.
export const OWNERS = ['cverinc'];
export const FRESH_MS = 24 * 3600 * 1000;
// A refresh claims the entry before it asks, so a forge that is down (or a quota spent by another
// Worker on the same address) is asked once per RETRY_MS, not once per page view.
export const RETRY_MS = 15 * 60 * 1000;
const UPSTREAM = 'https://api.github.com';
const KEY = 'https://repo-facts.invalid/v0/owner/';   // a cache key only; `.invalid` never resolves
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
};
const json = (body, status, extra) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS, ...extra },
});

/** A listing → `{ <lower-case name>: { name, pushed_at, archived, stars } }`, or null if it is not a list. */
export function facts(items, owner) {
  if (!Array.isArray(items)) return null;
  const out = {};
  for (const j of items) {
    const day = j && typeof j.pushed_at === 'string' && /^\d{4}-\d\d-\d\dT/.test(j.pushed_at) ? j.pushed_at.slice(0, 10) : '';
    if (!day || j.private !== false || j.visibility !== 'public' || typeof j.archived !== 'boolean'
      || typeof j.name !== 'string' || !/^[\w.-]{1,100}$/.test(j.name)
      || String(j.full_name).toLowerCase() !== `${owner}/${j.name.toLowerCase()}`
      || !Number.isSafeInteger(j.stargazers_count) || j.stargazers_count < 0) continue;
    out[j.name.toLowerCase()] = { name: j.name, pushed_at: day, archived: j.archived, stars: j.stargazers_count };
  }
  return out;
}

const read = async (cache, owner) => {
  try { const e = await (await cache.match(KEY + owner))?.json(); return e && typeof e === 'object' ? e : null; } catch { return null; }
};
const write = (cache, owner, entry) => cache.put(KEY + owner, new Response(JSON.stringify(entry), {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=2592000' },
})).catch(() => {});

/** Ask the forge once. Resolves to the new entry, or to the old one when anything went wrong. */
async function refresh(owner, old, now, deps) {
  await write(deps.cache, owner, { ...old, tried: now });
  try {
    const r = await deps.fetch(`${UPSTREAM}/orgs/${owner}/repos?type=public&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'repo-facts-coral/0 (+https://github.com/CVERInc/tile)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
    });
    const repos = r.status === 200 ? facts(await r.json(), owner) : null;
    if (!repos) return old;
    const entry = { at: now, tried: now, repos };
    await write(deps.cache, owner, entry);
    return entry;
  } catch { return old; }
}

export async function handleRequest(request, ctx, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url);
  if (url.pathname !== '/v0/repo-facts') return json({ error: 'not_found' }, 404);
  const owner = (url.searchParams.get('owner') || '').toLowerCase();
  if (!OWNERS.includes(owner)) return json({ error: 'owner is not one this endpoint answers for' }, 400);

  const now = deps.now();
  let entry = await read(deps.cache, owner), state = 'hit';
  if (!(now - (entry?.at || 0) < FRESH_MS)) {
    state = 'stale';
    if (now - (entry?.tried || 0) >= RETRY_MS) {
      const p = refresh(owner, entry, now, deps);
      ctx.waitUntil(p);                          // finishes whether or not the visitor waits
      if (!entry?.repos) { state = 'miss'; entry = await p; }
    }
  }
  const repos = entry?.repos || {};
  return json(repos, 200, {
    'Cache-Control': Object.keys(repos).length ? 'public, max-age=3600' : 'public, max-age=60',
    'X-Repo-Facts-Cache': state,
  });
}

export default {
  // `fetch` is wrapped, not passed: called as a property of another object it throws.
  fetch: (request, env, ctx) => handleRequest(request, ctx, { fetch: (u, i) => fetch(u, i), cache: caches.default, now: Date.now }),
};
