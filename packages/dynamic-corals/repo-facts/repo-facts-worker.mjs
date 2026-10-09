// REEF with Repo Facts — the edge half. A small Cloudflare Worker that asks the forge about the
// repositories a page names, and answers with SIX validated fields per repo and nothing else:
//
//   GET /v0/repo-facts?repos=owner/repo,owner/other
//   → { "owner/repo": { "tag": "v1.2.0", "releasedAt": "2026-10-07", "pushedAt": "2026-10-07",
//                       "license": "MIT", "archived": false, "fullName": "owner/repo" } }
//
// Why an edge worker at all: so the visitor's browser never talks to the forge. It asks the origin
// the page already trusts; the forge sees one caller, never the visitor. Nothing of the visitor's
// request but its method and its `repos` parameter is read here, so nothing else can be passed on.
//
// 🔴 NO FREE TEXT LEAVES HERE. A description, a release title, a topic — anything a stranger can
// type upstream — would arrive on a page nobody reviewed it for. Each answer is BUILT from scratch
// out of fields that passed the shared shape check (repo-facts-fields.mjs, the same table the
// browser checks against); a field that fails is dropped, never passed through.
//
// 🔴 WHO MAY BE ASKED ABOUT, AND WHAT IT COSTS. The forge's quota is shared and small, and a name
// that does not exist costs as much of it as one that does. So:
//   · OWNERS are an allow-list (`ALLOWED_OWNERS`). Any other owner is refused, with no upstream call.
//   · WHETHER A REPO EXISTS is answered from ONE listing per owner — its public repositories,
//     kept for an hour — and never by asking about the name. A name that is not in the listing is
//     simply absent from the answer, at no cost: a typo, a junk name, a private repo and a
//     renamed-away repo all look the same, and none of them reaches the forge.
//   · The only per-repo call is `releases/latest`, remembered PER REPO (including "has none"), so
//     a subset or a reordering of a list already answered costs nothing.
//   · One request makes at most MAX_UPSTREAM calls; requests that arrive together share ONE
//     refresh per owner (in this isolate for certain, across isolates by a best-effort lease);
//     a read that failed is not repeated for five minutes; and once the forge says the quota is
//     spent, ALL upstream calls stop until the reset it named.
// What is left: the first sight of each real repo of an allowed owner costs one call. See README.
//
// 🔴 NOBODY WAITS FOR THE FORGE. A request is answered within DEADLINE_MS with whatever is known
// by then — possibly `{}` for a repo not read yet — and the refresh finishes behind it
// (`ctx.waitUntil`). The browser gives up after three seconds; an answer that arrives after that
// is a refresh thrown away, on every visit, for ever.
//
// Env (all optional):
//   ALLOWED_OWNERS  comma-separated owners this deployment answers for. Default: CVERInc.
//   GITHUB_TOKEN    a token with read access to PUBLIC repositories only, from an account used
//                   for nothing else. Raises the quota. It is sent upstream and nowhere else —
//                   never logged, never echoed, never in an error.
import { FIELDS, REPO } from './repo-facts-fields.mjs';

export const MAX_REPOS = 30;
// A sixteen-card page read cold is 1 listing + 16 releases; a full list of 30 fills over two
// requests. It counts CALLS — a redirect hop is one — because calls are what the quota counts.
export const MAX_UPSTREAM = 24;
export const BUDGET_MS = 5000;
export const DEADLINE_MS = 2000;
const MAX_PAGES = 3;
// RETRY is how long a FAILED read is remembered. A page of sixteen cards against a forge that
// answers 500 would otherwise ask sixteen times a minute — a thousand calls an hour into an
// outage, and into our own quota.
const FRESH = 3600, GONE = 600, RETRY = 300, HOLE = 60, LEASE = 30;
const STALE_WHILE_REVALIDATE = 86400, STALE_IF_ERROR = 604800;
export const CACHE_CONTROL =
  `public, max-age=300, s-maxage=${FRESH}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}, stale-if-error=${STALE_IF_ERROR}`;
const UPSTREAM = 'https://api.github.com';
const USER_AGENT = 'repo-facts-coral/0 (+https://github.com/CVERInc/tile)';
// Cache keys only — never fetched. `.invalid` cannot resolve (RFC 2606).
const KEY = 'https://repo-facts.invalid/v0/';
// Owners live under their own prefix, so an owner called `backoff` is not the backoff entry.
const ownerKey = (owner) => `${KEY}owner/${owner}`;
// Refreshes under way in THIS isolate, by owner: `{ entry, tail }`. Requests that arrive together
// share the one entry object and queue behind one another, so the second finds the first's work
// already done instead of repeating it. (Another isolate cannot see this; the lease is for that.)
const INFLIGHT = new Map();

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept',
  'X-Content-Type-Options': 'nosniff',
};

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS, ...extra },
  });
}
// An error costs the forge nothing (it is refused before any upstream call), and says so to
// whatever sits in front of this: the same bad request need not come back for ten minutes.
const refuse = (error, status) => json({ error }, status, { 'Cache-Control': `public, max-age=${GONE}` });

// `.` and `..` fit the character class and are not names: in a URL path they would walk out of
// /repos/ and turn this into a proxy for the rest of the upstream API.
export const isRepo = (n) => typeof n === 'string' && REPO.test(n) && !n.split('/').some((s) => s === '.' || s === '..');

/** The owners this deployment answers for, lower-cased. */
export function allowedOwners(env) {
  return new Set(String((env && env.ALLOWED_OWNERS) || 'CVERInc').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * The `repos` parameter → `{ asked, owners }`, or null when ANY name is not a plain `owner/repo`
 * of an allowed owner. `asked` keeps every spelling the caller used (the answer is keyed by them);
 * `owners` maps each owner to the names asked of it. Both are lower-cased, because the forge does
 * not tell `A/B` from `a/b` and neither may the cache.
 */
export function parseRepos(raw, allowed) {
  if (typeof raw !== 'string' || !raw) return null;
  const asked = raw.split(',');
  if (asked.length > MAX_REPOS || !asked.every(isRepo)) return null;
  // No prototype: an owner may be called `constructor`, and that must be a key like any other.
  const owners = Object.create(null);
  for (const n of asked) {
    const key = n.toLowerCase(), owner = key.split('/')[0];
    if (!allowed.has(owner)) return null;
    (owners[owner] ||= new Set()).add(key);
  }
  return { asked, owners };
}

/** Keep the entries of `candidate` that pass the shared field table; `null` is kept where given. */
const checked = (candidate) => Object.fromEntries(Object.entries(candidate)
  .filter(([k, v]) => v === null || FIELDS[k](v)));
const stampDay = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v) ? v.slice(0, 10) : undefined);

/** The four fields one item of a repository listing may contribute. A bad field is DROPPED. */
export function repoFields(j) {
  const spdx = j.license === null ? null : j.license && j.license.spdx_id;
  const f = checked({
    pushedAt: stampDay(j.pushed_at),
    // NOASSERTION is the forge saying "there is a licence file and I cannot name it" — not an id.
    license: spdx === 'NOASSERTION' ? undefined : spdx,
    archived: j.archived,
    fullName: j.full_name,
  });
  if (!isRepo(f.fullName)) delete f.fullName;
  return f;
}

/** The two fields a latest-release answer may contribute. */
export function releaseFields(j) {
  return checked({ tag: j.tag_name == null ? undefined : j.tag_name, releasedAt: stampDay(j.published_at) });
}

/** Did the forge just say the quota is spent? Returns the epoch-ms to stay away until, or 0. */
function limitedUntil(r, now) {
  const h = (k) => r.headers.get(k);
  const spent = r.status === 429 || (r.status === 403 && (h('x-ratelimit-remaining') === '0' || h('retry-after')));
  if (!spent && !(r.ok && h('x-ratelimit-remaining') === '0')) return 0;
  const after = Number(h('retry-after'));
  const reset = after > 0 ? now + after * 1000 : Number(h('x-ratelimit-reset')) * 1000 || 0;
  // Never trust the header for more than an hour, and never come back sooner than a minute.
  return Math.min(Math.max(reset, now + HOLE * 1000), now + FRESH * 1000);
}

/** One request's upstream budget: a call ceiling, a deadline, and the stop the forge can pull. */
function upstreamRun(env, deps, now, backoffUntil) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.budgetMs || BUDGET_MS);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': USER_AGENT };
  if (env && env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const run = {
    calls: 0,
    backoffUntil,
    done: () => clearTimeout(timer),
    /**
     * One upstream GET. `undefined` when it was NOT MADE (the ceiling, the backoff, the budget) or
     * was refused for quota — nothing was learned, so nothing may be remembered; `null` when it
     * was made and failed. Never retried.
     */
    async get(path) {
      for (let hop = 0, url = UPSTREAM + path; hop < 2; hop++) {
        if (run.backoffUntil > now || run.calls >= MAX_UPSTREAM || ctl.signal.aborted) return undefined;
        run.calls++;
        let r;
        try { r = await deps.fetch(url, { headers, redirect: 'manual', signal: ctl.signal }); } catch { return null; }
        const until = limitedUntil(r, now);
        if (until) run.backoffUntil = until;
        // A refusal for quota is not an answer about anything: it must not be remembered as a
        // failure of this repo (that would outlast the backoff), let alone as "no release".
        if (until && !r.ok) return undefined;
        const to = [301, 302, 307, 308].includes(r.status) && r.headers.get('location');
        if (!to) return r;
        // A renamed repo answers 301 to its numeric address. Followed once, by hand, and only when
        // the PARSED target is that exact shape on the same origin — a prefix check would let
        // `/repositories/../user` through, and the token above would go with it.
        let next;
        try { next = new URL(to); } catch { return null; }
        if (next.origin !== UPSTREAM || next.search || next.hash
          || !/^\/repositories\/\d+(\/releases\/latest)?$/.test(next.pathname)) return null;
        url = next.href;
      }
      return null;
    },
  };
  return run;
}

/** An owner's public repositories: `{ state: 'ok', repos }`, `'gone'`, `'error'`, or `'skipped'` (not asked). */
async function readListing(owner, run) {
  for (const kind of ['orgs', 'users']) {
    const repos = {};
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await run.get(`/${kind}/${owner}/repos?${kind === 'orgs' ? 'type=public&' : ''}per_page=100&page=${page}`);
      if (!r) return { state: r === undefined ? 'skipped' : 'error' };
      if (r.status === 404 && page === 1) {
        if (kind === 'users') return { state: 'gone' };
        break;                                  // not an organisation — try it as a user
      }
      if (!r.ok) return { state: 'error' };
      let items;
      try { items = await r.json(); } catch { return { state: 'error' }; }
      if (!Array.isArray(items)) return { state: 'error' };
      for (const j of items) {
        // 🔴 `private: false` exactly, and `public` wherever visibility is stated. With a token
        // that can see more than it should, a private repo is IN this listing — and must still
        // look like one that does not exist.
        if (!j || j.private !== false || (j.visibility !== undefined && j.visibility !== 'public')) continue;
        const f = repoFields(j);
        if (f.fullName && f.fullName.toLowerCase().startsWith(owner + '/')) repos[f.fullName.toLowerCase()] = f;
      }
      if (items.length < 100 || page === MAX_PAGES) return { state: 'ok', repos };
    }
  }
  return { state: 'error' };
}

/** A repo's latest release: `{ state: 'ok', fields }`, `'none'`, `'error'`, or `'skipped'` (not asked). */
async function readRelease(fullName, run) {
  const r = await run.get(`/repos/${fullName}/releases/latest`);
  if (!r) return { state: r === undefined ? 'skipped' : 'error' };
  if (r.status === 404) return { state: 'none' };
  if (!r.ok) return { state: 'error' };
  try { return { state: 'ok', fields: releaseFields(await r.json()) }; } catch { return { state: 'error' }; }
}

async function readEntry(cache, url) {
  try {
    const hit = await cache.match(url);
    const entry = hit && (await hit.json());
    return entry && typeof entry === 'object' ? entry : null;
  } catch { return null; }
}
const writeEntry = (cache, url, entry) => cache.put(url, new Response(JSON.stringify(entry), {
  // Kept for as long as a stale answer may still be served; freshness is decided here, per record.
  headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${STALE_IF_ERROR + FRESH}` },
})).catch(() => {});

/** What a failed read leaves behind: what was known, not to be asked about again for RETRY. */
const afterError = (old, now) => ({ ...(old || { state: 'error', at: now }), until: now + RETRY * 1000 });
const afterAnswer = (got, now) => ({ ...got, at: now, until: now + (got.state === 'gone' ? GONE : FRESH) * 1000 });

/** A cache entry made safe to walk: whatever was stored, the shape below is what comes out. */
function owned(read) {
  const entry = { lease: 0, ...read };
  const record = (r) => r && typeof r === 'object' && typeof r.at === 'number' && typeof r.until === 'number';
  entry.releases = Object.fromEntries(Object.entries((typeof entry.releases === 'object' && entry.releases) || {}).filter(([, r]) => record(r)));
  const list = entry.list;
  if (!record(list) || (list.state === 'ok' && (!list.repos || typeof list.repos !== 'object'))) delete entry.list;
  return entry;
}
const listed = (entry) => (entry.list && entry.list.state === 'ok' && entry.list.repos) || {};
const dueOf = (entry, names, now) => [...names].filter((k) => listed(entry)[k] && (!entry.releases[k] || now >= entry.releases[k].until));

/**
 * Bring one owner's entry up to date for the names asked of it — the listing if it is due, then
 * the release of each asked repo that is in the listing and due. Mutates `entry` as it goes, so a
 * caller that stops waiting still sees everything learned so far.
 */
async function refresh(owner, names, entry, run, deps, now) {
  const listDue = !entry.list || now >= entry.list.until;
  // Queued behind another request's refresh, and it has already done the work: nothing to do.
  if (!listDue && !dueOf(entry, names, now).length) return;
  // The lease first: a request in ANOTHER isolate that finds this entry in the next LEASE seconds
  // serves what is there instead of starting the same refresh. It is read-then-write, so two
  // isolates that start in the same instant can both take it — best effort, not a lock.
  entry.lease = now + LEASE * 1000;
  await writeEntry(deps.cache, ownerKey(owner), entry);
  if (listDue) {
    const got = await readListing(owner, run);
    if (got.state === 'error') entry.list = afterError(entry.list, now);
    else if (got.state !== 'skipped') entry.list = afterAnswer(got, now);
  }
  const queue = dueOf(entry, names, now);
  const worker = async () => {
    for (let key; (key = queue.shift());) {
      const got = await readRelease(listed(entry)[key].fullName, run);
      // Not asked (the ceiling, the backoff, the budget): nothing is recorded, so the next
      // request asks. Asked and failed: not again for RETRY.
      if (got.state === 'skipped') continue;
      entry.releases[key] = got.state === 'error' ? afterError(entry.releases[key], now) : afterAnswer(got, now);
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  // Before writing back, read what is there NOW. Another isolate may have finished its own
  // refresh for other names while this one ran; whichever record is newer is kept, so two
  // refreshes do not write each other's work away and pay for it again. And because the read and
  // the write are not one step, look once more after writing: if what is stored is missing
  // something known here, or knows something this does not, merge and write again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const theirs = owned(await readEntry(deps.cache, ownerKey(owner)));
    if (theirs.list && (!entry.list || theirs.list.at > entry.list.at)) entry.list = theirs.list;
    for (const [k, rec] of Object.entries(theirs.releases)) {
      if (!entry.releases[k] || rec.at > entry.releases[k].at) entry.releases[k] = rec;
    }
    // A repo that is no longer in the listing takes its remembered release with it.
    if (entry.list && entry.list.state !== 'error') {
      entry.releases = Object.fromEntries(Object.entries(entry.releases).filter(([k]) => listed(entry)[k]));
    }
    entry.lease = 0;
    const keys = Object.keys(entry.releases);
    const settled = attempt > 0 && theirs.list && entry.list && theirs.list.at === entry.list.at
      && keys.length === Object.keys(theirs.releases).length
      && keys.every((k) => theirs.releases[k] && theirs.releases[k].at === entry.releases[k].at);
    if (settled) break;
    await writeEntry(deps.cache, ownerKey(owner), entry);
  }
}

export async function handleRequest(request, env, ctx, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== 'GET') return refuse('method_not_allowed', 405);
  const url = new URL(request.url);
  // Major-versioned from day one: a URL pasted into a page is a permanent contract.
  if (url.pathname.replace(/\/+$/, '') !== '/v0/repo-facts') return refuse('not_found', 404);
  const asked = parseRepos(url.searchParams.get('repos'), allowedOwners(env));
  if (!asked) return refuse('repos must be 1 to 30 comma-separated owner/repo names of an owner this endpoint answers for', 400);

  const now = deps.now();
  const inflight = deps.inflight || INFLIGHT;
  const usable = (rec, grace) => !!rec && rec.state !== 'error' && now - rec.at <= (FRESH + grace) * 1000;
  const entries = Object.create(null), work = [];
  let wait = false, anyDue = false;
  for (const [owner, names] of Object.entries(asked.owners)) {
    const read = inflight.has(owner) ? null : await readEntry(deps.cache, ownerKey(owner));
    // A refresh for this owner already under way here: look at ITS entry, which is ahead of the cache.
    const shared = inflight.get(owner);
    const entry = entries[owner] = shared ? shared.entry : owned(read);
    const listDue = !entry.list || now >= entry.list.until;
    const due = dueOf(entry, names, now);
    if (listDue || due.length) anyDue = true;
    // Another isolate holds the lease: leave it to that one. Our own refresh: queue behind it.
    if ((listDue || due.length) && (shared || !(entry.lease > now))) work.push([owner, names]);
    // Wait (up to the deadline) only for what has no answer young enough to show; everything
    // else is served as it stands and refreshed behind the response.
    if (!usable(entry.list, STALE_WHILE_REVALIDATE) || due.some((k) => !usable(entry.releases[k], STALE_WHILE_REVALIDATE))) wait = true;
  }

  let state = anyDue ? 'stale' : 'hit';
  if (work.length) {
    const backoff = await readEntry(deps.cache, KEY + 'backoff');
    const backoffUntil = backoff && backoff.until > now ? backoff.until : 0;
    if (backoffUntil) {
      state = 'backoff';
    } else {
      const run = upstreamRun(env, deps, now, backoffUntil);
      const done = (async () => {
        try {
          for (const [owner, names] of work) {
            // One refresh per owner at a time in this isolate. Whoever is first owns the entry;
            // everyone who arrives meanwhile adopts it and waits its turn, and by its turn the
            // work is usually done. Registered with no `await` in between, so two requests cannot
            // both be first.
            const slot = inflight.get(owner) || { entry: entries[owner], tail: Promise.resolve() };
            inflight.set(owner, slot);
            entries[owner] = slot.entry;
            const mine = slot.tail = slot.tail.then(() => refresh(owner, names, slot.entry, run, deps, now)).catch(() => {});
            await mine;
            if (slot.tail === mine) inflight.delete(owner);
          }
        } finally {
          run.done();
          if (run.backoffUntil > backoffUntil) await writeEntry(deps.cache, KEY + 'backoff', { until: run.backoffUntil });
        }
      })().catch(() => {});
      // The refresh belongs to the runtime, not to this visitor: it finishes whether or not
      // anybody is still listening.
      ctx.waitUntil(done);
      if (wait) {
        state = 'miss';
        let timer;
        await Promise.race([done, new Promise((r) => { timer = setTimeout(r, deps.deadlineMs || DEADLINE_MS); })]);
        clearTimeout(timer);
      }
    }
  }

  const body = {};
  let unread = false;
  for (const name of asked.asked) {
    const key = name.toLowerCase(), entry = entries[key.split('/')[0]];
    if (!usable(entry.list, STALE_IF_ERROR)) {
      body[name] = {};                          // the listing itself is unknown: could not read
      unread = true;
      continue;
    }
    const facts = listed(entry)[key];
    if (!facts) continue;                       // not a public repo of this owner: simply absent
    const release = entry.releases[key];
    if (!usable(release, STALE_IF_ERROR)) {
      body[name] = { ...facts };                // the repo is known, its release not yet
      unread = true;
    } else {
      body[name] = release.state === 'none' ? { ...facts, tag: null, releasedAt: null } : { ...facts, ...release.fields };
    }
  }
  // An answer with a hole in it is not worth an hour of anybody's cache.
  return json(body, 200, {
    'Cache-Control': unread ? `public, max-age=30, s-maxage=${HOLE}` : CACHE_CONTROL,
    'X-Repo-Facts-Cache': state,
  });
}

export default {
  fetch(request, env, ctx) {
    // `fetch` is wrapped, not passed: called as a property of another object it throws.
    return handleRequest(request, env, ctx, { fetch: (url, init) => fetch(url, init), cache: caches.default, now: Date.now });
  },
};
