// tile#299 — reef.cards: an open-but-not-canonical stage.
//
// Two settings, three states, one function that decides (card-worker.mjs `cardsHostStage`):
//
//   dark       neither setting names reef.cards           reef.cards answers nothing (today's default)
//   open       CARDS_HOST_OPEN = "reef.cards" only         reef.cards MIRRORS card.feelreef.com for a
//                                                          visitor's reads, noindex, nofollow; nothing
//                                                          else anywhere changes
//   canonical  CARD_CANONICAL_HOST = "reef.cards"          the cutover, whatever CARDS_HOST_OPEN says
//
// The table below is the whole decision: setting × host × route class → answer. Every cell is a real
// request through the Worker's fetch handler, not a call to a predicate, so a route that is decided
// somewhere the table does not know about still shows up here as a wrong answer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, * as W from './card-worker.mjs';
import { QR_VERSION, DRAWER_VERSION } from './card-assets.mjs';
import { DECK_JS_PATH, DECK_CSS_PATH } from '../w3/deck-page.mjs';
import { BORROWED } from './edit3-assets.mjs';
import { cardHosts } from '../w/serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** a KV double; `reads` records every key asked for */
function store(seed = {}) {
  const kv = new Map(Object.entries(seed));
  const reads = [];
  return {
    kv, reads,
    get: async (k) => { reads.push(k); return kv.has(k) ? kv.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    put: async (k, v) => { kv.set(k, v); },
  };
}

const card = (title, avatar = 'asset:pic') => [
  '---', `title: ${title}`, '---', '', '## grid', '',
  `- [ ] %% card: profile w=6 avatar="${avatar}" %% A public bio`,
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/x)',
  '', '## assets', '',
  // a real 1×1 PNG: a PNG avatar is what gives a Card its og:image (card-share shareImage)
  '- [ ] %% card: asset id=pic mime=image/png %% iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  '',
].join('\n');

const T_CARD = card('Test Card');
const ROOT_CARD = card('feelreef');
const V_CARD = card('Vanity Card');
// `t` lives on the shared host; `v` has its own domain (card.example) and its inverse, so the shared
// host 301s `/v` to it; `feelreef` is the root card.
const SEED = {
  t: T_CARD, feelreef: ROOT_CARD, v: V_CARD,
  'vanity:card.example': 'v', 'vanityof:v': 'card.example',
};

const TOKEN = 'open-stage-test-token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

// The settings an operator can write. `stage` is what cardsHostStage must answer for each.
const NEW = 'reef.cards', OLD = 'card.feelreef.com';
const SETTINGS = [
  ['unset', {}, 'dark'],
  ['open', { CARDS_HOST_OPEN: 'reef.cards' }, 'open'],
  ['canonical', { CARD_CANONICAL_HOST: 'reef.cards' }, 'canonical'],
  ['canonical + open', { CARD_CANONICAL_HOST: 'reef.cards', CARDS_HOST_OPEN: 'reef.cards' }, 'canonical'],
  // a typo in either setting is never a redirect and never a served new host it did not ask for
  ['open typo: "true"', { CARDS_HOST_OPEN: 'true' }, 'dark'],
  ['canonical typo + open', { CARD_CANONICAL_HOST: 'reef.card', CARDS_HOST_OPEN: 'reef.cards' }, 'open'],
  ['canonical + open typo', { CARD_CANONICAL_HOST: 'reef.cards', CARDS_HOST_OPEN: 'reef.card' }, 'canonical'],
];
const TYPOS = ['', ' ', 'true', 'TRUE', '1', 'yes', 'on', 'open', true, 1, 'reef.card', 'reefcards', 'reef.cards.',
  'https://reef.cards', 'reef.cards/', 'www.reef.cards', 'card.feelreef.com', 'evil.example', null, undefined];

const envFor = (setting, extra = {}) => ({ PREVIEW: 'false', MCP_TOKEN_HASH: TOKEN_HASH, CARDS: store(SEED), ...setting, ...extra });

// ── the route classes ───────────────────────────────────────────────────────────────────────────
//
// [class, path, init, on reef.cards: [dark, open, canonical], on card.feelreef.com: [dark, open, canonical]]
//
//   reef.cards       DARK    the dark host's empty 404 (no store read)
//                    MIRROR  card.feelreef.com's answer to the same path, byte for byte, plus
//                            `X-Robots-Tag: noindex, nofollow`
//                    LIVE    the cutover's answer (whatever it is: not the dark 404)
//   card.feelreef    SERVE   today's answer (the baseline every other column is compared with)
//                    SAME    byte for byte the baseline
//                    MOVED   301 → https://reef.cards<same path + query>
//                    STAYS   not a 301 to reef.cards
const DARK = 'dark', MIRROR = 'mirror', LIVE = 'live';
const SERVE = 'serve', SAME = 'same', MOVED = 'moved', STAYS = 'stays';
const PREVIEW_ID = 'a'.repeat(32);
const EDITOR_ASSET = `/try/edit/a/${BORROWED['Sortable.min.js'].hash}/Sortable.min.js`;
const AUTH = { headers: { authorization: `Bearer ${TOKEN}` } };
const POST = (body = 'x', headers = {}) => ({ method: 'POST', body, headers });

const ROUTES = [
  // ── a Card, and everything its page loads: mirrored in the open stage ──
  ['card page', '/t', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['card page HEAD', '/t', { method: 'HEAD' }, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['card page, query', '/T?utm_source=qr', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['thin markdown', '/t', { headers: { accept: 'text/markdown' } }, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['fat markdown', '/t.md', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['card icon', '/t/favicon.ico', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['card apple icon', '/t/apple-touch-icon.png', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['card avatar', '/t/avatar', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['root card', '/', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['root alias', '/feelreef?x=1', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['root icon', '/favicon.ico', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['root download', '/feelreef.md', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['Card with its own domain', '/v?from=qr', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['no such Card', '/nobody', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['unknown sub-path', '/t/x', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['deck script', DECK_JS_PATH, {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['deck stylesheet', DECK_CSS_PATH, {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['QR coral', `/_coral/qr-${QR_VERSION}.js`, {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['drawer coral', `/_coral/drawer-${DRAWER_VERSION}.js`, {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['brand mark relay', '/_icon/example.com.ico', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  ['video poster relay', '/_yt/dQw4w9WgXcQ.jpg', {}, [DARK, MIRROR, LIVE], [SERVE, SAME, MOVED]],
  // ── everything else stays dark on reef.cards until the cutover ──
  ['POST to a Card', '/t', POST(), [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['write API', '/_api/card/t', AUTH, [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['write API, new prefix', '/_api/cards/t', AUTH, [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['bare /_api', '/_api', {}, [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['report door', '/report', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['report door POST', '/report', POST('card=https%3A%2F%2Freef.cards%2Ft', { 'content-type': 'application/x-www-form-urlencoded' }), [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['security.txt', '/.well-known/security.txt', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['host-mode editor', '/edit?host=https%3A%2F%2Ffeelreef.com', {}, [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['sandbox editor', '/try/edit?lang=ja', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['editor file', EDITOR_ASSET, {}, [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['retired editor path', '/try/edit2', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['park a draft', '/try/park', POST(T_CARD, { 'content-type': 'text/markdown' }), [DARK, DARK, LIVE], [SERVE, SAME, STAYS]],
  ['bare /try', '/try', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['draft preview', `/_preview/${PREVIEW_ID}`, {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['robots.txt', '/robots.txt', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
  ['other .well-known', '/.well-known/change-password', {}, [DARK, DARK, LIVE], [SERVE, SAME, MOVED]],
];
const STAGE_COLUMN = { dark: 0, open: 1, canonical: 2 };

// Hosts that are neither card host: their answers must not depend on either setting being open.
const OTHER_HOSTS = ['card.example', 'saas.feelreef.com', 'cards.example.workers.dev', 'localhost', 'unbound.example'];

// ── the request runner ──────────────────────────────────────────────────────────────────────────

/** every upstream the relays could reach answers with one fixed PNG; nothing else goes out */
async function withUpstream(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const href = typeof u === 'string' ? u : u.url;
    if (/^https:\/\/feelreef\.com\//.test(href)) return new Response('site origin');
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const build = (host, path, init) => new Request(`https://${host}${path}`, { ...init, headers: { ...(init.headers || {}) } });

/** a response as bytes: status, every header, the body (random ids masked, so two parks compare) */
async function snap(res) {
  const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>');
  return { status: res.status, headers: [...res.headers].sort(([a], [b]) => (a < b ? -1 : 1)), body };
}
const ask = async (setting, host, path, init) => snap(await worker.fetch(build(host, path, init), envFor(setting)));

// NOT_RELAYED as this runtime sends it (Node's Response adds the text/plain type to an empty string body)
const DARK_ANSWER = { status: 404, headers: [['cache-control', 'no-store'], ['content-type', 'text/plain;charset=UTF-8'], ['x-content-type-options', 'nosniff']], body: '' };
const withHeader = (s, name, value) => ({
  ...s, headers: [...s.headers.filter(([k]) => k !== name), [name, value]].sort(([a], [b]) => (a < b ? -1 : 1)),
});

// ── 1. the state function ───────────────────────────────────────────────────────────────────────

test('tile#299 ①: cardsHostStage — three states, named in one place; canonical alone wins; a typo is dark', () => {
  assert.equal(typeof W.cardsHostStage, 'function', 'card-worker.mjs exports no cardsHostStage');
  for (const [name, setting, stage] of SETTINGS) {
    assert.equal(W.cardsHostStage(setting), stage, name);
    // everything else asks the same function: the canonical host is reef.cards in exactly one state
    assert.equal(W.canonicalHost(setting), stage === 'canonical' ? NEW : OLD, name);
  }
  assert.equal(W.cardsHostStage(undefined), 'dark');
  assert.equal(W.cardsHostStage(null), 'dark');
  // the same parse for both settings: case and surrounding space are not a typo (as CARD_CANONICAL_HOST
  // has always read), anything else is
  assert.equal(W.cardsHostStage({ CARDS_HOST_OPEN: ' Reef.Cards ' }), 'open');
  for (const typo of TYPOS) {
    assert.equal(W.cardsHostStage({ CARDS_HOST_OPEN: typo }), 'dark', `CARDS_HOST_OPEN=${JSON.stringify(typo)}`);
    assert.equal(W.cardsHostStage({ CARD_CANONICAL_HOST: typo }), 'dark', `CARD_CANONICAL_HOST=${JSON.stringify(typo)}`);
    assert.equal(W.cardsHostStage({ CARD_CANONICAL_HOST: typo, CARDS_HOST_OPEN: 'reef.cards' }), 'open', `canonical typo ${JSON.stringify(typo)}`);
    assert.equal(W.cardsHostStage({ CARD_CANONICAL_HOST: 'reef.cards', CARDS_HOST_OPEN: typo }), 'canonical', `open typo ${JSON.stringify(typo)}`);
  }
});

// ── 2. the decision table ───────────────────────────────────────────────────────────────────────

test('tile#299 ②: the decision table — setting × card host × route class', async () => {
  await withUpstream(async () => {
    for (const [cls, path, init, onNew, onOld] of ROUTES) {
      const baseline = await ask({}, OLD, path, init);
      const darkNew = await ask({}, NEW, path, init);
      assert.deepEqual(darkNew, DARK_ANSWER, `${cls}: the baseline itself — reef.cards is dark when nothing is set`);
      for (const [name, setting, stage] of SETTINGS) {
        const col = STAGE_COLUMN[stage];
        const where = `${cls} [${name}]`;

        // reef.cards
        const s = await ask(setting, NEW, path, init);
        if (onNew[col] === DARK) {
          assert.deepEqual(s, DARK_ANSWER, `reef.cards ${where}: dark`);
        } else if (onNew[col] === MIRROR) {
          const mirrored = await ask(setting, OLD, path, init);
          assert.deepEqual(s, withHeader(mirrored, 'x-robots-tag', 'noindex, nofollow'), `reef.cards ${where}: mirrors card.feelreef.com`);
          assert.doesNotMatch(String(new Map(s.headers).get('location') ?? ''), /reef\.cards/, `reef.cards ${where}: never sends a visitor to a reef.cards address`);
        } else {
          assert.notDeepEqual(s, DARK_ANSWER, `reef.cards ${where}: the cutover serves this route`);
        }

        // card.feelreef.com
        const o = await ask(setting, OLD, path, init);
        const loc = new Map(o.headers).get('location');
        if (onOld[col] === SERVE || onOld[col] === SAME) {
          assert.deepEqual(o, baseline, `card.feelreef.com ${where}: byte for byte today's answer`);
        } else if (onOld[col] === MOVED) {
          assert.equal(o.status, 301, `card.feelreef.com ${where}: moved`);
          assert.equal(loc, `https://${NEW}${new URL(path, 'https://x').pathname}${new URL(path, 'https://x').search}`, `card.feelreef.com ${where}: path + query intact`);
        } else {
          assert.ok(!(o.status === 301 && /^https:\/\/reef\.cards/.test(String(loc))), `card.feelreef.com ${where}: stays`);
        }
      }
    }
  });
});

test('tile#299 ③: every other host answers the same in every stage but the cutover, and the cutover alone decides it', async () => {
  await withUpstream(async () => {
    for (const host of [...OTHER_HOSTS, 'feelreef.com']) {
      for (const [cls, path, init] of ROUTES) {
        const baseline = await ask({}, host, path, init);
        for (const [name, setting, stage] of SETTINGS) {
          const s = await ask(setting, host, path, init);
          if (stage === 'canonical') {
            // the cutover's own answer, whatever CARDS_HOST_OPEN says
            assert.deepEqual(s, await ask({ CARD_CANONICAL_HOST: 'reef.cards' }, host, path, init), `${host} ${cls} [${name}]`);
          } else {
            assert.deepEqual(s, baseline, `${host} ${cls} [${name}]: byte for byte the unset answer`);
          }
        }
      }
    }
  });
});

test('tile#299 ④: a typo in either setting is today, byte for byte, on both card hosts', async () => {
  await withUpstream(async () => {
    for (const typo of TYPOS) {
      for (const setting of [{ CARDS_HOST_OPEN: typo }, { CARD_CANONICAL_HOST: typo }, { CARD_CANONICAL_HOST: typo, CARDS_HOST_OPEN: typo }]) {
        for (const host of [NEW, OLD]) {
          for (const [cls, path, init] of ROUTES.filter(([c]) => ['card page', 'root card', 'write API', 'security.txt'].includes(c))) {
            assert.deepEqual(await ask(setting, host, path, init), await ask({}, host, path, init),
              `${host} ${cls} ${JSON.stringify(setting)}`);
          }
        }
      }
    }
  });
});

test('tile#299 ⑤: dark and the open stage\'s dark routes read nothing from the store', async () => {
  for (const setting of [{}, { CARDS_HOST_OPEN: 'reef.cards' }]) {
    const env = envFor(setting);
    for (const [cls, path, init, onNew] of ROUTES) {
      if (onNew[STAGE_COLUMN[W.cardsHostStage(setting)]] !== DARK) continue;
      await worker.fetch(build(NEW, path, init), env);
      assert.deepEqual(env.CARDS.reads, [], `${cls} ${JSON.stringify(setting)}`);
    }
  }
});

// ── 3. every address the Worker emits, in the open stage ────────────────────────────────────────
//
// A QR printed during "open" must not carry the new host. So: every place a Card's address leaves
// this Worker, asked on BOTH hosts in the open stage, must name card.feelreef.com.

const OPEN = { CARDS_HOST_OPEN: 'reef.cards' };
const attr = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

test('tile#299 ⑥: in the open stage no address the Worker emits names reef.cards', async () => {
  await withUpstream(async () => {
    for (const host of [NEW, OLD]) {
      const env = envFor(OPEN);
      for (const [path, want] of [['/t', 'https://card.feelreef.com/t'], ['/', 'https://card.feelreef.com']]) {
        const res = await worker.fetch(build(host, path, {}), env);
        assert.equal(res.status, 200, `${host}${path}`);
        const html = await res.text();
        // the canonical link and og:url (card-share), the QR mount's data-url (what the QR encodes)
        assert.deepEqual(attr(html, /<link rel="canonical" href="([^"]*)"/g), [want], `${host}${path} canonical`);
        assert.deepEqual(attr(html, /<meta property="og:url" content="([^"]*)"/g), [want], `${host}${path} og:url`);
        assert.deepEqual(attr(html, /data-dynamic-coral="qr" data-url="([^"]*)"/g), [want], `${host}${path} QR`);
        // the icon links are paths (so a page seen on reef.cards loads its icons from reef.cards, which
        // the mirror answers); the share image is absolute, off the same cardUrl
        const icons = attr(html, /<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]*)"/g);
        assert.ok(icons.length > 0, `${host}${path}: no icon links found — the check below would be vacuous`);
        for (const href of icons) assert.match(href, /^\//, `${host}${path} icon ${href}`);
        const images = attr(html, /<meta property="og:image" content="([^"]*)"/g);
        assert.ok(images.length > 0, `${host}${path}: no og:image found`);
        for (const href of images) assert.match(href, /^https:\/\/card\.feelreef\.com\//, `${host}${path} og:image ${href}`);
        // and nothing else on the page names the new host either
        assert.doesNotMatch(html, /reef\.cards/, `${host}${path}: the page names reef.cards`);
        // same origin: every path the page loads relatively is one the open stage answers on reef.cards
        const relative = attr(html, /(?:src|href)="(\/[^"/][^"]*)"/g);
        assert.ok(relative.some((p) => p.startsWith('/_deck/')) && relative.some((p) => p.startsWith('/_coral/')), `${host}${path}: ${relative}`);
        for (const p of relative) {
          const pathname = new URL(p, 'https://x').pathname;
          assert.ok(W.openStageMirrors(pathname, 'GET'), `${host}${path} loads ${p}, which reef.cards would not answer`);
        }
      }
      // the thin markdown's alternate link (the download), and the root alias's redirect
      const thin = await worker.fetch(build(host, '/t', { headers: { accept: 'text/markdown' } }), env);
      assert.equal(thin.headers.get('link'), '<https://card.feelreef.com/t.md>; rel="alternate"; type="text/markdown"', host);
      const rootThin = await worker.fetch(build(host, '/', { headers: { accept: 'text/markdown' } }), env);
      assert.equal(rootThin.headers.get('link'), '<https://card.feelreef.com/feelreef.md>; rel="alternate"; type="text/markdown"', host);
      const alias = await worker.fetch(build(host, '/feelreef?x=1', {}), env);
      assert.equal(alias.status, 301);
      assert.equal(alias.headers.get('location'), 'https://card.feelreef.com/?x=1', host);
      // a Card with its own domain: its one address, never a card host's
      const own = await worker.fetch(build(host, '/v?from=qr', {}), env);
      assert.equal(own.headers.get('location'), 'https://card.example/?from=qr', host);
    }
    // the write API answers on the old host only, and the addresses it hands out are the old host's
    const env = envFor(OPEN);
    const preview = await worker.fetch(new Request(`https://${OLD}/_api/preview`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 't', markdown: T_CARD }),
    }), env);
    assert.equal(preview.status, 200);
    assert.match((await preview.json()).url, /^https:\/\/card\.feelreef\.com\/_preview\/[0-9a-f]{32}$/);
    const newApi = await worker.fetch(new Request(`https://${NEW}/_api/preview`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 't', markdown: T_CARD }),
    }), env);
    assert.deepEqual(await snap(newApi), DARK_ANSWER, 'the write API is not on reef.cards in the open stage');
    // security.txt: the old host's own, naming itself; none on the new host
    const sec = await worker.fetch(new Request(`https://${OLD}/.well-known/security.txt`), env);
    assert.match(await sec.text(), /^Canonical: https:\/\/card\.feelreef\.com\/\.well-known\/security\.txt$/m);
    assert.deepEqual(await snap(await worker.fetch(new Request(`https://${NEW}/.well-known/security.txt`), env)), DARK_ANSWER);
  });
  // the pure inverses the editor and the dev server read
  assert.equal(W.cardUrlFor('t', {}, OPEN), 'https://card.feelreef.com/t');
  assert.equal(W.cardUrlFor('feelreef', {}, OPEN), 'https://card.feelreef.com');
  assert.equal(W.cardOrigin(OPEN), 'https://card.feelreef.com');
  assert.equal(W.canonicalHost(OPEN), OLD);
  assert.deepEqual(cardHosts(OPEN), { cardHost: OLD, api: 'https://card.feelreef.com' });
  assert.equal(W.movedTo(OLD, new URL('https://card.feelreef.com/t'), 'GET', OPEN), null);
});

// ── 4. caches ───────────────────────────────────────────────────────────────────────────────────
//
// caches.default is one store for the whole zone set, and two of the Worker's keys do not carry the
// request's host: the avatar relay's (a fixed origin + the picture's hash) and, in the open stage,
// the relays' (the mirrored request is the old host's). Whatever the open stage puts there must be
// exactly what the old host would have put, and must never carry the open stage's noindex.

test('tile#299 ⑦: an open-stage answer never poisons a cache entry the old host reads', async () => {
  const REMOTE_ROOT = card('feelreef', 'https://img.example/a.png');
  const stored = new Map();
  const realCaches = globalThis.caches;
  globalThis.caches = { default: {
    match: async (r) => stored.get(r.url)?.clone(),
    put: async (r, v) => { stored.set(r.url, v); },
  } };
  try {
    await withUpstream(async () => {
      const seed = { ...SEED, feelreef: REMOTE_ROOT };
      // what the old host answers with an EMPTY cache, before the open stage existed
      const before = {};
      // the root card's avatar is /feelreef/avatar (a bare /avatar would be a handle named "avatar")
      for (const path of ['/feelreef/avatar', '/_yt/dQw4w9WgXcQ.jpg', '/_icon/example.com.ico']) {
        stored.clear();
        before[path] = await snap(await worker.fetch(new Request(`https://${OLD}${path}`), { PREVIEW: 'false', CARDS: store(seed) }));
        assert.equal(before[path].status, 200, path);
        assert.equal(new Map(before[path].headers).get('x-robots-tag'), undefined, `${path}: the root's avatar is indexable on the old host`);
      }
      stored.clear();
      const env = { PREVIEW: 'false', CARDS: store(seed), ...OPEN };
      for (const path of Object.keys(before)) {
        // the new host fills the cache…
        const n = await worker.fetch(new Request(`https://${NEW}${path}`), env);
        assert.equal(n.status, 200, path);
        assert.equal(n.headers.get('x-robots-tag'), 'noindex, nofollow', path);
        await n.arrayBuffer();
      }
      // …with nothing keyed on the new host, and nothing carrying its header
      for (const [key, res] of stored) {
        assert.ok(!key.includes('reef.cards'), `cache key ${key}`);
        assert.equal(res.headers.get('x-robots-tag'), null, `cached ${key}`);
      }
      // …and the old host, reading those entries, answers exactly as it did on an empty cache
      for (const path of Object.keys(before)) {
        assert.deepEqual(await snap(await worker.fetch(new Request(`https://${OLD}${path}`), env)), before[path], path);
      }
    });
  } finally { globalThis.caches = realCaches; }
});

// ── 5. the operator's documentation ─────────────────────────────────────────────────────────────

test('tile#299 ⑧: wrangler.example.toml documents the open stage beside the cutover switch', () => {
  const toml = readFileSync(join(HERE, 'wrangler.example.toml'), 'utf8');
  const open = toml.indexOf('# CARDS_HOST_OPEN = "reef.cards"');
  const canonical = toml.indexOf('# CARD_CANONICAL_HOST = "reef.cards"');
  assert.ok(open > 0, 'no commented CARDS_HOST_OPEN line');
  assert.ok(canonical > 0, 'no commented CARD_CANONICAL_HOST line');
  // in [env.production.vars], next to each other: the two settings are read together
  const vars = toml.indexOf('[env.production.vars]');
  const next = toml.indexOf('[[env.production.kv_namespaces]]');
  assert.ok(vars < open && open < next && vars < canonical && canonical < next, 'both lines sit in [env.production.vars]');
  // both lines stay commented: the example never turns a stage on by itself
  assert.doesNotMatch(toml, /^\s*CARDS_HOST_OPEN\s*=/m);
  assert.doesNotMatch(toml, /^\s*CARD_CANONICAL_HOST\s*=/m);
});
