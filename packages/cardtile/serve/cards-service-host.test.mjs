// The service has a host of its own, and the short domain holds only what people wrote.
//
// Three roles, two settings and one constant (card-worker.mjs `serviceHostStage`):
//
//   people's canonical host   reef.cards           CARD_CANONICAL_HOST = "reef.cards"   (as before)
//   the service's host        cards.feelreef.com   CARDS_SERVICE_HOST = "cards.feelreef.com"   (new)
//   the legacy host           card.feelreef.com    no setting: it is the host everything moved from
//
//   off     CARDS_SERVICE_HOST unset or anything else   every answer is the one the Worker gave before
//                                                       (service-host-off.test.mjs, against a fixture)
//   open    CARDS_SERVICE_HOST only                     cards.feelreef.com answers as the service's
//                                                       home; nothing redirects to it, no address the
//                                                       Worker writes changes
//   split   both settings                               the ruling's table, below
//
//   cards.feelreef.com   the service pages                       served
//   reef.cards/<handle>  what a person wrote                     served (canonical)
//   reef.cards/          no handle                               302 → cards.feelreef.com/try/edit
//   card.feelreef.com    a service page                          301 → the same path on cards.feelreef.com
//                        what a person wrote                     301 → reef.cards/<handle>
//
// Every row is a real request through the Worker's fetch handler. A test marked CONTROL passes on
// the Worker as it was: it pins what must not move.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import worker, * as W from './card-worker.mjs';
import * as SV from '../w/serve.mjs';

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
const file = (title) => ['---', `title: ${title}`, '---', '', '## grid', '', '- [ ] %% card: profile w=6 %% A public bio', ''].join('\n');
const SEED = { t: file('Test page'), feelreef: file('feelreef'), v: file('Own domain'), 'vanity:own.example': 'v', 'vanityof:v': 'own.example' };

const TOKEN = 'service-host-test-token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const AUTH = { authorization: `Bearer ${TOKEN}` };

const PEOPLE = 'reef.cards', SERVICE = 'cards.feelreef.com', LEGACY = 'card.feelreef.com';
const CANONICAL = { CARD_CANONICAL_HOST: 'reef.cards' };
const OPEN = { CARDS_SERVICE_HOST: 'cards.feelreef.com' };
const SPLIT = { ...CANONICAL, ...OPEN };
const envFor = (setting, extra = {}) => ({ PREVIEW: 'false', MCP_TOKEN_HASH: TOKEN_HASH, CARDS: store(SEED), ...setting, ...extra });
const ask = (host, path, env, init = {}) => worker.fetch(new Request(`https://${host}${path}`, init), env);
const loc = (res) => res.headers.get('location');
const tryBoot = (html) => /window\.__deckTry="([^"]*)";/.exec(html)?.[1];

// ── row 3: reef.cards/ ──────────────────────────────────────────────────────────────────────────
test('split: reef.cards/ is a temporary redirect to the editor on the service host, and reads nothing', async () => {
  const env = envFor(SPLIT);
  const res = await ask(PEOPLE, '/', env);
  assert.equal(res.status, 302, 'temporary: a home page will replace it');
  assert.equal(loc(res), 'https://cards.feelreef.com/try/edit');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(env.CARDS.reads, [], 'no store read behind a redirect');
  const head = await ask(PEOPLE, '/', envFor(SPLIT), { method: 'HEAD' });
  assert.equal(head.status, 302);
  assert.equal(loc(head), 'https://cards.feelreef.com/try/edit');
});

test('split: reef.cards/ carries its query to the editor (a language, a referrer)', async () => {
  assert.equal(loc(await ask(PEOPLE, '/?lang=ja', envFor(SPLIT))), 'https://cards.feelreef.com/try/edit?lang=ja');
  assert.equal(loc(await ask(PEOPLE, '/?ref=t', envFor(SPLIT))), 'https://cards.feelreef.com/try/edit?ref=t');
});

// ── row 2: reef.cards/<handle> ──────────────────────────────────────────────────────────────────
test('CONTROL split: reef.cards/<handle> is served, canonical on reef.cards', async () => {
  const res = await ask(PEOPLE, '/t', envFor(SPLIT));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<link rel="canonical" href="https://reef.cards/t">'), 'canonical names reef.cards/t');
  assert.equal(res.headers.get('x-robots-tag'), null, 'indexable on the people\'s host');
});

test('split: a page\'s "make your own" goes to the service host; outside split it is the address it was', async () => {
  assert.equal(tryBoot(await (await ask(PEOPLE, '/t', envFor(SPLIT))).text()), 'https://cards.feelreef.com/try/edit');
  // the nothing-here page is a page too
  const none = await ask(PEOPLE, '/nobody', envFor(SPLIT));
  assert.equal(none.status, 404);
  assert.equal(tryBoot(await none.text()), 'https://cards.feelreef.com/try/edit');
  // CONTROL: canonical alone, and the open stage of the service host, write the old address
  assert.equal(tryBoot(await (await ask(PEOPLE, '/t', envFor(CANONICAL))).text()), 'https://card.feelreef.com/try/edit');
  assert.equal(tryBoot(await (await ask(LEGACY, '/t', envFor(OPEN))).text()), 'https://card.feelreef.com/try/edit');
});

test('split: only the page\'s own boot line is rewritten, never the same text inside what a person wrote', async () => {
  const forged = 'window.__deckTry="https://card.feelreef.com/try/edit";';
  const md = ['---', 'title: Forged', '---', '', '## grid', '', `- [ ] %% card: text %% ${forged}`, ''].join('\n');
  const html = await (await ask(PEOPLE, '/forged', envFor(SPLIT, { CARDS: store({ forged: md }) }))).text();
  assert.equal((html.match(/window\.__deckTry="https:\/\/cards\.feelreef\.com\/try\/edit";/g) || []).length, 1, 'exactly one boot line names the service host');
  assert.ok(!html.includes(forged), 'the text a person wrote is escaped as it always was');
});

test('split: the platform\'s own handle is an ordinary handle on reef.cards — its address is /feelreef, not the bare origin', async () => {
  const res = await ask(PEOPLE, '/feelreef', envFor(SPLIT));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<link rel="canonical" href="https://reef.cards/feelreef">'), 'the bare origin redirects now, so it cannot be a canonical address');
  assert.ok(html.includes('data-url="https://reef.cards/feelreef"') || !html.includes('data-url="https://reef.cards"'), 'the QR does not carry the bare origin');
  assert.equal(W.cardUrlFor('feelreef', {}, SPLIT), 'https://reef.cards/feelreef');
  assert.equal(W.cardUrlFor('t', {}, SPLIT), 'https://reef.cards/t');
  // CONTROL: without the service host the root address is the bare origin, as before
  assert.equal(W.cardUrlFor('feelreef', {}, CANONICAL), 'https://reef.cards');
  assert.equal(W.cardUrlFor('feelreef', {}, OPEN), 'https://card.feelreef.com');
  // the origin's icon files still answer an image
  const ico = await ask(PEOPLE, '/favicon.ico', envFor(SPLIT));
  assert.equal(ico.status, 200);
  assert.match(ico.headers.get('content-type'), /^image\//);
});

test('split: reef.cards answers no service page — the editor paths redirect to the service host, a write is refused', async () => {
  for (const [path, want] of [
    ['/try/edit', 'https://cards.feelreef.com/try/edit'],
    ['/try/edit?lang=ja', 'https://cards.feelreef.com/try/edit?lang=ja'],
    ['/try/edit/', 'https://cards.feelreef.com/try/edit/'],
    ['/try/edit2', 'https://cards.feelreef.com/try/edit2'],
    ['/edit?host=https://feelreef.com', 'https://cards.feelreef.com/edit?host=https://feelreef.com'],
  ]) {
    const env = envFor(SPLIT);
    const res = await ask(PEOPLE, path, env);
    assert.equal(res.status, 301, path);
    assert.equal(loc(res), want, path);
    assert.deepEqual(env.CARDS.reads, [], path);
  }
  const env = envFor(SPLIT);
  const park = await ask(PEOPLE, '/try/park', env, { method: 'POST', body: SEED.t });
  assert.equal(park.status, 404, 'nothing is parked through the people\'s host');
  assert.equal([...env.CARDS.kv.keys()].filter((k) => k.startsWith('try:')).length, 0);
});

test('split: the write API does not answer on reef.cards', async () => {
  const env = envFor(SPLIT);
  for (const [path, init] of [
    ['/_api/cards', { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["t"]}' }],
    ['/_api/card/t', { headers: AUTH }],
    ['/_api/card/t', {}],
  ]) {
    const res = await ask(PEOPLE, path, env, init);
    assert.equal(res.status, 404, `${init.method || 'GET'} ${path}`);
    assert.equal(await res.text(), '', 'and it does not say whether the caller was authorised');
  }
  assert.deepEqual(env.CARDS.reads, []);
});

test('CONTROL split: reef.cards keeps its report door and its security.txt', async () => {
  assert.equal((await ask(PEOPLE, '/report', envFor(SPLIT))).status, 200);
  const sec = await ask(PEOPLE, '/.well-known/security.txt', envFor(SPLIT));
  assert.equal(sec.status, 200);
  assert.match(await sec.text(), /^Canonical: https:\/\/reef\.cards\/\.well-known\/security\.txt$/m);
});

// ── row 4: card.feelreef.com ────────────────────────────────────────────────────────────────────
test('split: a service page on the legacy host redirects to the same path on the service host', async () => {
  for (const [path, want] of [
    ['/try/edit', 'https://cards.feelreef.com/try/edit'],
    ['/try/edit/', 'https://cards.feelreef.com/try/edit/'],
    ['/try/edit?lang=zh-TW', 'https://cards.feelreef.com/try/edit?lang=zh-TW'],
    ['/try/edit2?lang=ja', 'https://cards.feelreef.com/try/edit2?lang=ja'],
  ]) {
    const env = envFor(SPLIT);
    const res = await ask(LEGACY, path, env);
    assert.equal(res.status, 301, path);
    assert.equal(loc(res), want, path);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400', path);
    assert.deepEqual(env.CARDS.reads, [], path);
  }
});

test('CONTROL split: what a person wrote on the legacy host redirects to reef.cards/<handle>', async () => {
  for (const [path, want] of [
    ['/t', 'https://reef.cards/t'], ['/t?utm=qr', 'https://reef.cards/t?utm=qr'], ['/t.md', 'https://reef.cards/t.md'],
    ['/T', 'https://reef.cards/T'], ['/nobody', 'https://reef.cards/nobody'], ['/', 'https://reef.cards/'],
    ['/report', 'https://reef.cards/report'],
  ]) {
    const res = await ask(LEGACY, path, envFor(SPLIT));
    assert.equal(res.status, 301, path);
    assert.equal(loc(res), want, path);
  }
});

test('split: an editor left open on the legacy host keeps working — its draft can still be opened there, and Save still parks', async () => {
  // the draft is in that browser's storage under the legacy origin; `?stay=1` is the way back to it
  const stay = await ask(LEGACY, '/try/edit?stay=1', envFor(SPLIT));
  assert.equal(stay.status, 200, 'the editor, in place');
  assert.match(stay.headers.get('content-type'), /^text\/html/);
  assert.ok((await stay.text()).includes('window.__CARDTILE_W3_OPTS__'), 'it is the editor');
  assert.equal(stay.headers.get('x-robots-tag'), 'noindex, nofollow');
  // only exactly `stay=1`
  assert.equal((await ask(LEGACY, '/try/edit?stay=0', envFor(SPLIT))).status, 301);
  assert.equal((await ask(LEGACY, '/try/edit?stay', envFor(SPLIT))).status, 301);
});

test('CONTROL split: the legacy host still answers what cannot follow a redirect — the API, the park, host mode, the editor\'s files', async () => {
  const env = envFor(SPLIT);
  // the API: a caller holding a bearer (a redirect to another origin drops the Authorization header)
  const list = await ask(LEGACY, '/_api/cards', env, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["t"]}' });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).cards[0].handle, 't');
  // the park: a same-origin POST from an editor already open on this origin
  const park = await ask(LEGACY, '/try/park', env, { method: 'POST', headers: { origin: 'https://card.feelreef.com' }, body: SEED.t });
  assert.equal(park.status, 200);
  assert.match((await park.json()).id, /^[0-9a-f-]{36}$/);
  // host mode: the page that frames it pins this origin
  assert.equal((await ask(LEGACY, '/edit?host=https://feelreef.com', env)).status, 200);
});

// ── row 1: cards.feelreef.com ───────────────────────────────────────────────────────────────────
for (const [name, setting] of [['split', SPLIT], ['open', OPEN]]) {
  test(`CONTROL ${name}: the service host serves the service pages`, async () => {
    const env = envFor(setting);
    const edit = await ask(SERVICE, '/try/edit', env);
    assert.equal(edit.status, 200);
    assert.ok((await edit.text()).includes('window.__CARDTILE_W3_OPTS__'));
    assert.equal((await ask(SERVICE, '/edit?host=https://feelreef.com', env)).status, 200);
    const park = await ask(SERVICE, '/try/park', env, { method: 'POST', headers: { origin: 'https://cards.feelreef.com' }, body: SEED.t });
    assert.equal(park.status, 200);
    const list = await ask(SERVICE, '/_api/cards', env, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["t"]}' });
    assert.equal(list.status, 200);
    const old = await ask(SERVICE, '/try/edit2?lang=ja', env);
    assert.equal(old.status, 301);
    assert.equal(loc(old), 'https://cards.feelreef.com/try/edit?lang=ja');
  });

  test(`${name}: the service host's root is a temporary redirect to its editor`, async () => {
    const env = envFor(setting);
    const res = await ask(SERVICE, '/', env);
    assert.equal(res.status, 302);
    assert.equal(loc(res), 'https://cards.feelreef.com/try/edit');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(loc(await ask(SERVICE, '/?lang=ja', envFor(setting))), 'https://cards.feelreef.com/try/edit?lang=ja');
    assert.deepEqual(env.CARDS.reads, []);
  });

  test(`${name}: the service host never serves what a person wrote — a handle's address redirects to the people's host, unread`, async () => {
    const people = setting === SPLIT ? PEOPLE : LEGACY;
    for (const path of ['/t', '/t?utm=qr', '/t.md', '/t/avatar', '/nobody', '/feelreef', '/favicon.ico', '/apple-touch-icon.png']) {
      const env = envFor(setting);
      const res = await ask(SERVICE, path, env);
      assert.equal(res.status, 301, path);
      assert.equal(loc(res), `https://${people}${path}`, path);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=86400', path);
      assert.deepEqual(env.CARDS.reads, [], path);
    }
  });

  test(`${name}: anything else on the service host is the nothing-here page, unread`, async () => {
    for (const [path, init] of [['/robots.txt', {}], ['/.well-known/security.txt', {}], ['/report', {}], ['/try', {}], ['/_api', {}], ['/_preview/nope', {}], ['/try/edit/a/not-a-hash/nope.js', {}]]) {
      const env = envFor(setting);
      const res = await ask(SERVICE, path, env, init);
      assert.equal(res.status, 404, `${init.method || 'GET'} ${path}`);
      const body = await res.text();
      assert.match(body, /Nothing here\./, path);
      assert.ok(body.includes('<html'), `${path}: the page, not the bare line an unbound domain gets`);
      assert.deepEqual(env.CARDS.reads, [], path);
    }
  });
}

test('split: a parked preview is what a person wrote — the service host sends it to reef.cards, which renders it', async () => {
  const id = 'a'.repeat(32);
  const env = envFor(SPLIT, { CARDS: store({ ...SEED, [`_preview:${id}`]: file('Draft') }) });
  const res = await ask(SERVICE, `/_preview/${id}`, env);
  assert.equal(res.status, 302, 'a preview lasts an hour: nothing about it is permanent');
  assert.equal(loc(res), `https://reef.cards/_preview/${id}`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(env.CARDS.reads, []);
  const page = await ask(PEOPLE, `/_preview/${id}`, env);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Draft'));
});

// ── the settings ────────────────────────────────────────────────────────────────────────────────
test('serviceHostStage: only exactly "cards.feelreef.com" turns the service host on', () => {
  assert.equal(typeof W.serviceHostStage, 'function', 'card-worker.mjs exports no serviceHostStage');
  assert.equal(W.SERVICE_HOST, 'cards.feelreef.com');
  assert.equal(W.serviceHostStage(undefined), 'off');
  assert.equal(W.serviceHostStage({}), 'off');
  assert.equal(W.serviceHostStage(CANONICAL), 'off');
  assert.equal(W.serviceHostStage(OPEN), 'open');
  assert.equal(W.serviceHostStage({ ...OPEN, CARDS_HOST_OPEN: 'reef.cards' }), 'open');
  assert.equal(W.serviceHostStage(SPLIT), 'split');
  // exactly the string: nothing is trimmed, lowercased or converted
  for (const typo of ['', ' ', 'true', '1', 'on', true, 1, null, 'card.feelreef.com', 'cards.feelreef.co', 'cards.feelreef.com.', 'https://cards.feelreef.com',
    'cards.feelreef.com/', 'www.cards.feelreef.com', 'reef.cards', 'evil.example',
    'CARDS.FEELREEF.COM', 'Cards.FeelReef.com', ' cards.feelreef.com', 'cards.feelreef.com ', ' cards.feelreef.com ', 'cards.feelreef.com\n', '\tcards.feelreef.com',
    ['cards.feelreef.com'], new String('cards.feelreef.com'), { toString: () => 'cards.feelreef.com' }]) {
    assert.equal(W.serviceHostStage({ CARDS_SERVICE_HOST: typo, ...CANONICAL }), 'off', JSON.stringify(typo));
  }
});

test('a typo in CARDS_SERVICE_HOST — another case and a space around it included — redirects nothing to a host nobody serves', async () => {
  for (const typo of ['true', 'cards.feelreef.co', 'card.feelreef.com', 'CARDS.FEELREEF.COM', ' cards.feelreef.com ', 'cards.feelreef.com\n']) {
    const setting = { ...CANONICAL, CARDS_SERVICE_HOST: typo };
    assert.equal((await ask(PEOPLE, '/', envFor(setting))).status, 200, `${typo}: reef.cards/ is the page it was`);
    assert.equal(loc(await ask(LEGACY, '/try/edit', envFor(setting))), 'https://reef.cards/try/edit', typo);
    assert.equal((await ask(SERVICE, '/', envFor(setting))).status, 404, typo);
  }
});

test('the local editor\'s server calls the API on the service host and reads public exits from the people\'s host', () => {
  assert.deepEqual(SV.cardHosts(SPLIT), { cardHost: 'reef.cards', api: 'https://cards.feelreef.com' });
  assert.deepEqual(SV.cardHosts(OPEN), { cardHost: 'card.feelreef.com', api: 'https://cards.feelreef.com' });
  assert.deepEqual(SV.cardHosts({ ...SPLIT, CARD_API_BASE: 'https://staging.example' }), { cardHost: 'reef.cards', api: 'https://staging.example' });
  assert.equal(typeof SV.cardExit, 'function', 'serve.mjs exports no cardExit');
  assert.equal(SV.cardExit(SPLIT), 'https://reef.cards', 'reef.cards does not answer the API, and the service host serves no .md');
  assert.equal(SV.cardExit(OPEN), 'https://card.feelreef.com');
  assert.equal(SV.cardExit({ ...SPLIT, CARD_API_BASE: 'https://staging.example' }), 'https://staging.example', 'the override still names both, as before');
  // CONTROL: without the service host both are what they were
  assert.deepEqual(SV.cardHosts(CANONICAL), { cardHost: 'reef.cards', api: 'https://reef.cards' });
  assert.equal(SV.cardExit(CANONICAL), 'https://reef.cards');
  assert.equal(SV.cardExit({}), 'https://card.feelreef.com');
});

// ── staging: stand-ins for the three hosts (host-standins.mjs) ──────────────────────────────────
const STANDINS = { CARDS_HOST_STANDINS: 'service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com' };
const S_SERVICE = 'cards-staging.feelreef.com', S_PEOPLE = 'staging.reef.cards', S_LEGACY = 'card-staging.feelreef.com';
// a deployment that is not production: the only kind the stand-ins run in (card-worker.mjs standInsOn)
const NOT_PRODUCTION = { PREVIEW: 'true' };

test('staging: each stand-in answers as its role\'s host, and every redirect of the ruling stays inside staging', async () => {
  const setting = { ...SPLIT, ...STANDINS, ...NOT_PRODUCTION };
  for (const [host, path, status, want] of [
    [S_PEOPLE, '/', 302, 'https://cards-staging.feelreef.com/try/edit'],
    [S_PEOPLE, '/try/edit?lang=ja', 301, 'https://cards-staging.feelreef.com/try/edit?lang=ja'],
    [S_LEGACY, '/try/edit', 301, 'https://cards-staging.feelreef.com/try/edit'],
    [S_LEGACY, '/t?utm=qr', 301, 'https://staging.reef.cards/t?utm=qr'],
    [S_LEGACY, '/', 301, 'https://staging.reef.cards/'],
    [S_SERVICE, '/', 302, 'https://cards-staging.feelreef.com/try/edit'],
    [S_SERVICE, '/t', 301, 'https://staging.reef.cards/t'],
    [S_SERVICE, '/try/edit2', 301, 'https://cards-staging.feelreef.com/try/edit'],
  ]) {
    const res = await ask(host, path, envFor(setting));
    assert.equal(res.status, status, `${host}${path}`);
    assert.equal(loc(res), want, `${host}${path}`);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', `${host}${path}: staging is never indexed`);
  }
  const page = await ask(S_PEOPLE, '/t', envFor(setting));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  // the addresses INSIDE a page are the real hosts': staging proves the routing, not the page's text
  assert.ok((await page.text()).includes('<link rel="canonical" href="https://reef.cards/t">'));
  assert.equal((await ask(S_SERVICE, '/try/edit', envFor(setting))).status, 200);
  assert.equal((await ask(S_LEGACY, '/try/edit?stay=1', envFor(setting))).status, 200);
});

test('staging: a redirect to a host that is no role (a creator\'s domain) and a relative one are left alone', async () => {
  const setting = { ...SPLIT, ...STANDINS, ...NOT_PRODUCTION };
  const own = await ask(S_PEOPLE, '/v', envFor(setting));
  assert.equal(own.status, 301);
  assert.equal(loc(own), 'https://own.example/', 'the page\'s own domain, untouched');
  const sent = await ask(S_PEOPLE, '/report', envFor(setting), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://staging.reef.cards' },
    body: 'card=https%3A%2F%2Freef.cards%2Ft&reason=other&_hp=bot',
  });
  assert.equal(sent.status, 303, 'the honeypot path: told what a person is told, nothing sent');
  assert.equal(loc(sent), '/report?sent=1&lang=en-US');
});

test('CONTROL staging: a browser on the stand-in passes the same-origin check, another site still does not, and a body travels', async () => {
  const env = envFor({ ...SPLIT, ...STANDINS, ...NOT_PRODUCTION });
  const park = await ask(S_SERVICE, '/try/park', env, { method: 'POST', headers: { origin: 'https://cards-staging.feelreef.com' }, body: SEED.t });
  assert.equal(park.status, 200);
  const other = await ask(S_SERVICE, '/try/park', env, { method: 'POST', headers: { origin: 'https://evil.example' }, body: SEED.t });
  assert.equal(other.status, 403);
  const list = await ask(S_SERVICE, '/_api/cards', env, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["t"]}' });
  assert.equal(list.status, 200, 'the request body travels with the re-addressed request');
  assert.equal((await list.json()).cards[0].handle, 't');
});

test('staging: a stand-in keeps the scheme and the port of an Origin — the same-origin check answers as on the real host, for every port pair', async () => {
  let rows = 0;
  for (const [real, standin] of [[SERVICE, S_SERVICE], [LEGACY, S_LEGACY]]) {
    for (const urlPort of ['', ':8443']) for (const originPort of ['', ':8443', ':9443']) {
      const answers = [];
      for (const host of [real, standin]) {
        const env = envFor({ ...SPLIT, ...STANDINS, ...NOT_PRODUCTION });
        const before = env.CARDS.kv.size;
        const res = await ask(`${host}${urlPort}`, '/try/park', env, { method: 'POST', headers: { origin: `https://${host}${originPort}` }, body: SEED.t });
        answers.push({ status: res.status, stored: env.CARDS.kv.size - before });
      }
      const row = `${standin}${urlPort} asked from port "${originPort}"`;
      rows += 1;
      // CONTROL: the real host parks for its own origin only — the same port included
      assert.deepEqual(answers[0], urlPort === originPort ? { status: 200, stored: 1 } : { status: 403, stored: 0 }, `the real host, ${row}`);
      assert.deepEqual(answers[1], answers[0], row);
    }
  }
  assert.equal(rows, 12);
});

test('staging: only a name of ours can stand in — anything else in the setting is ignored', async () => {
  const { standIns } = await import('./host-standins.mjs');
  const real = { service: SERVICE, people: PEOPLE, legacy: LEGACY };
  const hosts = (v) => Object.fromEntries(standIns({ CARDS_HOST_STANDINS: v }, real).byRole);
  assert.deepEqual(hosts(STANDINS.CARDS_HOST_STANDINS), { service: S_SERVICE, people: S_PEOPLE, legacy: S_LEGACY });
  assert.deepEqual(hosts(`service=${S_SERVICE}, people=${S_PEOPLE}`), { service: S_SERVICE, people: S_PEOPLE }, 'comma or space');
  // read as written: a role or a host in another case is ignored, not folded
  assert.deepEqual(hosts('Service=cards-staging.feelreef.com, people=Staging.Reef.Cards legacy=card-staging.feelreef.com'), { legacy: S_LEGACY });
  for (const bad of [
    'service=evil.example',                 // a creator's domain
    'service=cards.feelreef.com',           // a role's real name
    'people=reef.cards', 'legacy=card.feelreef.com',
    'service=feelreef.com', 'people=reef.cards.', 'service=saas.feelreef.com', 'service=staging.feelreef.com', 'service=www.feelreef.com',
    'service=x.workers.dev',                // not a zone a stand-in may live in
    'service=notfeelreef.com', 'service=a.feelreef.com.evil.example',
    'service=-bad.feelreef.com', 'service=a..feelreef.com', 'service=x.feelreef.com/y', 'service=x.feelreef.com:8443',
    'editor=x.feelreef.com', '=x.feelreef.com', 'service', 'service=', '',
  ]) assert.deepEqual(hosts(bad), {}, bad);
  // a role named twice keeps the first; one host is never two roles
  assert.deepEqual(hosts('service=a.feelreef.com service=b.feelreef.com'), { service: 'a.feelreef.com' });
  assert.deepEqual(hosts('service=a.feelreef.com people=a.feelreef.com'), { service: 'a.feelreef.com' });
  for (const v of [undefined, null, 1, true, {}]) assert.equal(standIns({ CARDS_HOST_STANDINS: v }, real).byHost.size, 0);
  assert.equal(standIns(undefined, real).byHost.size, 0);
});

test('CONTROL staging: a host that is no stand-in is answered as itself, stand-ins or not', async () => {
  const setting = { ...SPLIT, ...STANDINS, ...NOT_PRODUCTION };
  for (const [host, path] of [[PEOPLE, '/'], [LEGACY, '/try/edit'], [SERVICE, '/'], [PEOPLE, '/t'], ['own.example', '/']]) {
    const a = await ask(host, path, envFor(setting)), b = await ask(host, path, envFor({ ...SPLIT, ...NOT_PRODUCTION }));
    assert.equal(a.status, b.status, `${host}${path}`);
    assert.deepEqual([...a.headers], [...b.headers], `${host}${path}`);
    assert.equal(await a.text(), await b.text(), `${host}${path}`);
  }
});

// ── the boundary, for every method (card-worker.mjs hostBoundary) ───────────────────────────────
//
// Two rules, each asked under every method — a browser can be sent anywhere by a cross-origin form
// POST, so a rule that holds for GET alone does not hold:
//
//   the service's host never renders, reflects or reads anything a person wrote;
//   the people's host never answers a service endpoint.
//
// A marker is planted in everything a person can have stored — a page's title and text, the
// platform's own page, a page on its own domain, a parked preview, a parked sandbox draft.
const MARKER = 'PERSON-WROTE-THIS-7f3a';
const marked = (what) => ['---', `title: ${MARKER} ${what} title`, '---', '', '## grid', '', `- [ ] %% card: profile w=6 %% ${MARKER} ${what} text`, ''].join('\n');
const PREVIEW_ID = 'a'.repeat(32);
const PARKED_ID = '11111111-2222-4333-8444-555555555555';
const MARKED_SEED = {
  t: marked('page'), feelreef: marked('platform'), v: marked('own domain'), 'vanity:own.example': 'v', 'vanityof:v': 'own.example',
  [`_preview:${PREVIEW_ID}`]: marked('preview'), [`try:${PARKED_ID}`]: marked('parked'),
};
const { BORROWED } = await import('./edit3-assets.mjs');
const { DECK_JS_PATH, DECK_CSS_PATH } = await import('../w3/deck-page.mjs');
const ASSET_NAME = Object.keys(BORROWED)[0];
const ASSET_PATH = `/try/edit/a/${BORROWED[ASSET_NAME].hash}/${ASSET_NAME}`;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND'];
const READS = ['GET', 'HEAD'];

// [class, path, what the service's host answers a GET/HEAD with]
const SERVICE_TABLE = [
  // what a person wrote, or an address shaped like it
  ['person', '/t', 301], ['person', '/T', 301], ['person', '/t?utm=qr', 301], ['person', '/t.md', 301], ['person', '/t/avatar', 301], ['person', '/t/anything/else', 301],
  ['person', '/feelreef', 301], ['person', '/feelreef.md', 301], ['person', '/v', 301], ['person', '/index.md', 301], ['person', '/favicon.ico', 301],
  ['person', `/_preview/${PREVIEW_ID}`, 302], ['person', `/_preview/${PREVIEW_ID}?x=1`, 302],
  // nothing of the service's and no handle's address
  ['nothing', '/_preview/nope', 404], ['nothing', `/_preview/${PREVIEW_ID}/`, 404], ['nothing', '/report', 404], ['nothing', '/.well-known/security.txt', 404],
  ['nothing', '/robots.txt', 404], ['nothing', '/try', 404], ['nothing', '/_api', 404], ['nothing', '/try/edit/a/not-a-hash/nope.js', 404],
  ['nothing', `/try/${PARKED_ID}`, 404], ['nothing', '//evil.example', 404], ['nothing', '/%2f%2fevil.example', 404],
  // the service's own pages and files: GET/HEAD only
  ['service page', '/', 302], ['service page', `/?ref=${MARKER}`, 302], ['service page', '/try/edit', 200], ['service page', '/try/edit/', 200], ['service page', `/try/edit?lang=${MARKER}`, 200],
  ['service page', '/try/edit2', 301], ['service page', '/edit', 400], ['service page', '/edit?host=https://feelreef.com', 200], ['service page', `/edit?host=${MARKER}`, 400],
  ['service page', ASSET_PATH, 200], ['service page', '/try/edit/a/000000000000/nope.js', 404], ['service page', DECK_JS_PATH, 200], ['service page', DECK_CSS_PATH, 200],
  ['service page', '/_icon/example.com.ico', 200], ['service page', '/_icon/%zz.ico', 400], ['service page', '/_yt/abcdefghijk.jpg', 200],
];
// the two endpoints: every method reaches the handler, and without a credential none of them answers with a stored word
const SERVICE_ENDPOINTS = ['/try/park', '/_api/card/t', '/_api/cards', '/_api/card/t/preview', `/_api/try/${PARKED_ID}`, '/_api/nope'];

/** run `fn` with the upstream fetch replaced by a counted raster stub (the image relays ask it) */
async function withUpstream(fn) {
  const fetch0 = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response('raster', { headers: { 'content-type': 'image/png' } }); };
  try { return await fn(calls); } finally { globalThis.fetch = fetch0; }
}
const bodyOf = (method) => (READS.includes(method) ? {} : { body: MARKER });

for (const [name, setting] of [['split', SPLIT], ['open', OPEN]]) {
  test(`${name}: the service host renders, reflects and reads nothing a person wrote — every path class × every method`, async () => {
    let rows = 0;
    await withUpstream(async (upstream) => {
      for (const [cls, path, readStatus] of SERVICE_TABLE) {
        for (const method of METHODS) {
          for (const headers of [{}, { origin: 'https://evil.example' }]) {
            const row = `${method} ${path} (${cls})`;
            const env = envFor(setting, { CARDS: store(MARKED_SEED) });
            const asked = upstream.length;
            const res = await ask(SERVICE, path, env, { method, headers, ...bodyOf(method) });
            const body = await res.text();
            rows += 1;
            assert.ok(!body.includes(MARKER), `${row}: the answer carries what a person wrote`);
            assert.deepEqual(env.CARDS.reads, [], `${row}: the store was read`);
            if (READS.includes(method)) {
              assert.equal(res.status, readStatus, row);
              if (cls === 'person') {
                const to = new URL(loc(res));
                assert.equal(to.hostname, setting === SPLIT ? PEOPLE : LEGACY, `${row}: sent to the people's host`);
                assert.equal(to.pathname, new URL(`https://x${path}`).pathname, row);
              }
            } else {
              // no other method is answered at all, whatever the path is
              assert.equal(res.status, 405, row);
              assert.equal(body, '', row);
              assert.equal(res.headers.get('allow'), 'GET, HEAD', row);
              assert.equal(loc(res), null, row);
              assert.equal(upstream.length, asked, `${row}: an upstream was asked`);
            }
          }
        }
      }
    });
    assert.equal(rows, SERVICE_TABLE.length * METHODS.length * 2);

    // the endpoints, without a credential: never a page, never a stored word, never a read
    for (const path of SERVICE_ENDPOINTS) {
      for (const method of METHODS) {
        const row = `${method} ${path}`;
        const env = envFor(setting, { CARDS: store(MARKED_SEED) });
        const res = await ask(SERVICE, path, env, { method, headers: { origin: 'https://evil.example' }, ...bodyOf(method) });
        const body = await res.text();
        assert.ok(!body.includes(MARKER), `${row}: the answer carries what a person wrote`);
        assert.ok(!/^text\/html/.test(res.headers.get('content-type') || ''), `${row}: an endpoint answered with a page`);
        assert.ok([400, 401, 403, 404, 405].includes(res.status), `${row}: ${res.status}`);
        assert.deepEqual(env.CARDS.reads, [], `${row}: the store was read`);
        assert.equal(env.CARDS.kv.size, Object.keys(MARKED_SEED).length, `${row}: something was stored`);
      }
    }
  });
}

test('CONTROL split: the people\'s host answers no service endpoint — every service path × every method, with or without a credential', async () => {
  const paths = ['/try/edit', '/try/edit/', '/try/edit?stay=1', '/try/edit2', '/try/edit2/', '/edit', '/edit/', '/edit?host=https://feelreef.com', '/try/park', ASSET_PATH,
    '/try/edit/a/000000000000/nope.js', '/_api', '/_api/', '/_api/card/t', '/_api/cards', `/_api/try/${PARKED_ID}`];
  let rows = 0;
  for (const path of paths) {
    for (const method of METHODS) {
      for (const headers of [{}, AUTH, { ...AUTH, origin: 'https://reef.cards', 'content-type': 'application/json' }]) {
        const row = `${method} ${path}`;
        const env = envFor(SPLIT, { CARDS: store(MARKED_SEED) });
        const res = await ask(PEOPLE, path, env, { method, headers, ...(READS.includes(method) ? {} : { body: SEED.t }) });
        rows += 1;
        assert.equal(await res.text(), '', `${row}: the people's host answered a service endpoint with a body`);
        assert.deepEqual(env.CARDS.reads, [], `${row}: the store was read`);
        assert.equal(env.CARDS.kv.size, Object.keys(MARKED_SEED).length, `${row}: something was stored`);
        const api = path === '/_api' || path.startsWith('/_api/');
        if (READS.includes(method) && !api) {
          assert.equal(res.status, 301, row);
          assert.equal(loc(res), `https://cards.feelreef.com${path}`, row);
        } else {
          assert.equal(res.status, 404, row);
          assert.equal(loc(res), null, row);
        }
      }
    }
  }
  assert.equal(rows, paths.length * METHODS.length * 3);
});

// ── the legacy host after the split ─────────────────────────────────────────────────────────────
// It still serves the editor in place (host mode, and the sandbox at `?stay=1`), so it is an origin
// that serves the editor: it never renders what a person wrote either. A read moves, as before; any
// other method is refused unread. What it answers in place is untouched.
const LEGACY_IN_PLACE = ['/_api/card/t', '/_api/cards', `/_api/try/${PARKED_ID}`, '/_api/nope', '/try/park', '/edit', '/edit/', '/edit?host=https://feelreef.com',
  '/try/edit', '/try/edit/', '/try/edit?stay=1', '/try/edit2', ASSET_PATH, '/try/edit/a/000000000000/nope.js', '/try/edit/a/not-a-hash/nope.js'];
// [class, path]: everything else — a read is a 301 to the same address on the people's host.
// (Bare `/_api` is left out: a read of it does not move — movedTo's exception, as at the cutover — and
// is the nothing-here page; any other method is refused like the rest, asserted further down. And
// anything under the editor's file prefix is answered in place, a name that is no file included.)
const LEGACY_MOVED = [
  ...SERVICE_TABLE.filter(([cls, path]) => cls !== 'service page' && path !== '/_api' && !path.startsWith('/try/edit/a/')).map(([cls, path]) => [cls, path]),
  ['person', '/'], ['person', `/?ref=${MARKER}`], ['person', '/nobody'], ['person', '/t/'],
  ['file', DECK_JS_PATH], ['file', DECK_CSS_PATH], ['file', '/_icon/example.com.ico'], ['file', '/_yt/abcdefghijk.jpg'],
];

test('split: the legacy host renders, reflects and reads nothing a person wrote — every path class × every method', async () => {
  let rows = 0;
  await withUpstream(async (upstream) => {
    for (const [cls, path] of LEGACY_MOVED) {
      for (const method of METHODS) {
        for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'https://card.feelreef.com' }]) {
          const row = `${method} ${path} (${cls})`;
          const env = envFor(SPLIT, { CARDS: store(MARKED_SEED) });
          const res = await ask(LEGACY, path, env, { method, headers, ...bodyOf(method) });
          const body = await res.text();
          rows += 1;
          assert.ok(!body.includes(MARKER), `${row}: the answer carries what a person wrote`);
          assert.deepEqual(env.CARDS.reads, [], `${row}: the store was read`);
          assert.equal(env.CARDS.kv.size, Object.keys(MARKED_SEED).length, `${row}: something was stored`);
          assert.equal(upstream.length, 0, `${row}: an upstream was asked`);
          assert.equal(body, '', row);
          if (READS.includes(method)) {
            // CONTROL: a read moves as it did
            assert.equal(res.status, 301, row);
            assert.equal(loc(res), `https://reef.cards${path}`, row);
          } else {
            assert.equal(res.status, 405, row);
            assert.equal(res.headers.get('allow'), 'GET, HEAD', row);
            assert.equal(loc(res), null, row);
          }
        }
      }
    }
  });
  assert.equal(rows, LEGACY_MOVED.length * METHODS.length * 3);
});

test('CONTROL split: what the legacy host answers in place is answered as before the split, for every method — the API, the park, host mode, the editor\'s files', async () => {
  let rows = 0;
  for (const path of LEGACY_IN_PLACE) {
    for (const method of METHODS) {
      assert.equal(W.hostBoundary(SPLIT, LEGACY, new URL(`https://x${path}`).pathname, method), null, `${method} ${path}: the boundary decided`);
      // a read of the sandbox and of the park's address moves in the split (movedTo); nothing else differs
      if (READS.includes(method) && ['/try/edit', '/try/edit/', '/try/edit?stay=1', '/try/edit2', '/try/park'].includes(path)) continue;
      for (const headers of [{}, AUTH, { origin: 'https://card.feelreef.com' }]) {
        const init = { method, headers, ...bodyOf(method) };
        const split = await whole(LEGACY, path, envFor(SPLIT, { CARDS: store(MARKED_SEED) }), init);
        const before = await whole(LEGACY, path, envFor(CANONICAL, { CARDS: store(MARKED_SEED) }), init);
        rows += 1;
        // the nothing-here page links to the editor, whose address is the split's own: its text differs
        const seen = (w) => (path === '/try/edit/a/not-a-hash/nope.js' ? { status: w.status, reads: w.reads } : w);
        assert.deepEqual(seen(split), seen(before), `${method} ${path}`);
      }
    }
  }
  assert.equal(rows, (LEGACY_IN_PLACE.length * METHODS.length - 5 * READS.length) * 3);
});

test('the legacy host\'s rule is the split\'s alone — off, open and at the cutover the boundary decides nothing there', () => {
  for (const env of [undefined, {}, CANONICAL, OPEN, { ...CANONICAL, CARDS_SERVICE_HOST: 'CARDS.FEELREEF.COM' }]) {
    for (const [, path] of LEGACY_MOVED) for (const method of METHODS) {
      assert.equal(W.hostBoundary(env, LEGACY, new URL(`https://x${path}`).pathname, method), null, `${JSON.stringify(env)} ${method} ${path}`);
    }
  }
  // CONTROL: in the split it decides, and only for the legacy host — a creator's domain is not one
  assert.deepEqual(W.hostBoundary(SPLIT, LEGACY, '/t', 'POST'), { answer: 'method' });
  assert.deepEqual(W.hostBoundary(SPLIT, LEGACY, '/_api', 'POST'), { answer: 'method' });
  assert.equal(W.hostBoundary(SPLIT, LEGACY, '/t', 'GET'), null);
  for (const method of METHODS) assert.equal(W.hostBoundary(SPLIT, 'own.example', '/', method), null);
});

test('hostBoundary: off, it decides nothing — on any host, any path, any method', () => {
  assert.equal(typeof W.hostBoundary, 'function', 'card-worker.mjs exports no hostBoundary');
  for (const env of [undefined, {}, CANONICAL, { ...CANONICAL, CARDS_SERVICE_HOST: 'CARDS.FEELREEF.COM' }, { ...CANONICAL, CARDS_SERVICE_HOST: ' cards.feelreef.com ' }]) {
    for (const host of [SERVICE, PEOPLE, LEGACY, 'own.example']) for (const path of ['/', '/t', '/try/edit', '/_api/card/t', `/_preview/${PREVIEW_ID}`]) for (const method of METHODS) {
      assert.equal(W.hostBoundary(env, host, path, method), null, `${JSON.stringify(env)} ${method} ${host}${path}`);
    }
  }
  // CONTROL: on, it does decide; and it never decides for a host that is neither of the two
  assert.deepEqual(W.hostBoundary(SPLIT, SERVICE, `/_preview/${PREVIEW_ID}`, 'POST'), { answer: 'method' });
  assert.deepEqual(W.hostBoundary(SPLIT, PEOPLE, '/_api/card/t', 'GET'), { answer: 'refused' });
  for (const host of [LEGACY, 'own.example', 'saas.feelreef.com']) for (const method of METHODS) assert.equal(W.hostBoundary(SPLIT, host, '/try/edit', method), null);
  // before the cutover the short domain is not the people's host yet: cardsHostStage answers for it
  for (const method of METHODS) assert.equal(W.hostBoundary(OPEN, PEOPLE, '/_api/card/t', method), null);
});

// ── the stand-ins are inert unless the service host is on, and in production whatever is set ─────
/** one answer, whole: status, headers, body, the store keys read */
async function whole(host, path, env, init) {
  const res = await ask(host, path, env, init);
  return { status: res.status, headers: [...res.headers], body: await res.text(), reads: env.CARDS.reads };
}
const STANDIN_PATHS = ['/', '/t', '/t.md', '/feelreef', '/try/edit', '/try/edit2?lang=ja', '/try/park', '/edit?host=https://feelreef.com', '/_api/card/t', `/_preview/${PREVIEW_ID}`, '/report', '/robots.txt'];

test('staging: with the service host off — unset or not exactly its value — a stand-in list changes no answer, on the stand-ins\' own hostnames', async () => {
  let rows = 0;
  for (const value of [undefined, '', 'typo', 'CARDS.FEELREEF.COM', ' cards.feelreef.com ', 'cards.feelreef.com.']) {
    for (const stage of [{}, { CARDS_HOST_OPEN: 'reef.cards' }, CANONICAL]) {
      for (const deployment of [NOT_PRODUCTION, { PREVIEW: 'false' }]) {
        const setting = { ...stage, ...deployment, ...(value === undefined ? {} : { CARDS_SERVICE_HOST: value }) };
        assert.equal(W.standInsOn({ ...setting, ...STANDINS }), false);
        for (const host of [S_SERVICE, S_PEOPLE, S_LEGACY]) for (const path of STANDIN_PATHS) for (const method of ['GET', 'POST']) {
          const init = { method, ...(method === 'POST' ? { body: 'x' } : {}) };
          const withList = await whole(host, path, envFor({ ...setting, ...STANDINS }, { CARDS: store(MARKED_SEED) }), init);
          const without = await whole(host, path, envFor(setting, { CARDS: store(MARKED_SEED) }), init);
          rows += 1;
          assert.deepEqual(withList, without, `${JSON.stringify(setting)} ${method} ${host}${path}`);
        }
      }
    }
  }
  assert.equal(rows, 6 * 3 * 2 * 3 * STANDIN_PATHS.length * 2);
});

test('staging: in a production deployment (PREVIEW "false") a stand-in list changes no answer, the service host on or not', async () => {
  assert.equal(typeof W.standInsOn, 'function', 'card-worker.mjs exports no standInsOn');
  // the list is read only with the service host on AND outside production
  assert.equal(W.standInsOn({ ...SPLIT, ...STANDINS, PREVIEW: 'true' }), true);
  assert.equal(W.standInsOn({ ...OPEN, ...STANDINS, PREVIEW: 'true' }), true);
  assert.equal(W.standInsOn({ ...SPLIT, ...STANDINS }), true, 'PREVIEW unset is a preview, as everywhere in this Worker');
  assert.equal(W.standInsOn({ ...SPLIT, ...STANDINS, PREVIEW: 'false' }), false);
  assert.equal(W.standInsOn({ ...CANONICAL, ...STANDINS, PREVIEW: 'true' }), false);
  assert.equal(W.standInsOn(undefined), false);
  let rows = 0;
  for (const setting of [SPLIT, OPEN]) {
    for (const host of [S_SERVICE, S_PEOPLE, S_LEGACY]) for (const path of STANDIN_PATHS) for (const method of ['GET', 'POST']) {
      const init = { method, ...(method === 'POST' ? { body: 'x' } : {}) };
      const withList = await whole(host, path, envFor({ ...setting, ...STANDINS }, { CARDS: store(MARKED_SEED) }), init);
      const without = await whole(host, path, envFor(setting, { CARDS: store(MARKED_SEED) }), init);
      rows += 1;
      assert.deepEqual(withList, without, `${method} ${host}${path}`);
    }
  }
  assert.equal(rows, 2 * 3 * STANDIN_PATHS.length * 2);
  // CONTROL: the same request outside production is answered as the role's host
  const res = await ask(S_LEGACY, '/t', envFor({ ...SPLIT, ...STANDINS, ...NOT_PRODUCTION }));
  assert.equal(res.status, 301);
  assert.equal(loc(res), 'https://staging.reef.cards/t');
});
