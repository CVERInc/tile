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
    for (const [path, init] of [['/robots.txt', {}], ['/.well-known/security.txt', {}], ['/report', {}], ['/try', {}], ['/t', { method: 'POST', body: 'x' }]]) {
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
  assert.equal(W.serviceHostStage({ CARDS_SERVICE_HOST: ' Cards.FeelReef.com ', ...CANONICAL }), 'split', 'case and surrounding space aside');
  for (const typo of ['', ' ', 'true', '1', 'on', true, 1, null, 'card.feelreef.com', 'cards.feelreef.co', 'cards.feelreef.com.', 'https://cards.feelreef.com',
    'cards.feelreef.com/', 'www.cards.feelreef.com', 'reef.cards', 'evil.example']) {
    assert.equal(W.serviceHostStage({ CARDS_SERVICE_HOST: typo, ...CANONICAL }), 'off', JSON.stringify(typo));
  }
});

test('CONTROL: a typo in CARDS_SERVICE_HOST redirects nothing to a host nobody serves', async () => {
  for (const typo of ['true', 'cards.feelreef.co', 'card.feelreef.com']) {
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

test('staging: each stand-in answers as its role\'s host, and every redirect of the ruling stays inside staging', async () => {
  const setting = { ...SPLIT, ...STANDINS };
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
  const setting = { ...SPLIT, ...STANDINS };
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
  const env = envFor({ ...SPLIT, ...STANDINS });
  const park = await ask(S_SERVICE, '/try/park', env, { method: 'POST', headers: { origin: 'https://cards-staging.feelreef.com' }, body: SEED.t });
  assert.equal(park.status, 200);
  const other = await ask(S_SERVICE, '/try/park', env, { method: 'POST', headers: { origin: 'https://evil.example' }, body: SEED.t });
  assert.equal(other.status, 403);
  const list = await ask(S_SERVICE, '/_api/cards', env, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["t"]}' });
  assert.equal(list.status, 200, 'the request body travels with the re-addressed request');
  assert.equal((await list.json()).cards[0].handle, 't');
});

test('staging: only a name of ours can stand in — anything else in the setting is ignored', async () => {
  const { standIns } = await import('./host-standins.mjs');
  const real = { service: SERVICE, people: PEOPLE, legacy: LEGACY };
  const hosts = (v) => Object.fromEntries(standIns({ CARDS_HOST_STANDINS: v }, real).byRole);
  assert.deepEqual(hosts(STANDINS.CARDS_HOST_STANDINS), { service: S_SERVICE, people: S_PEOPLE, legacy: S_LEGACY });
  assert.deepEqual(hosts('Service=Cards-Staging.FeelReef.com, people=staging.reef.cards'), { service: S_SERVICE, people: S_PEOPLE }, 'comma or space, any case');
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
  const setting = { ...SPLIT, ...STANDINS };
  for (const [host, path] of [[PEOPLE, '/'], [LEGACY, '/try/edit'], [SERVICE, '/'], [PEOPLE, '/t'], ['own.example', '/']]) {
    const a = await ask(host, path, envFor(setting)), b = await ask(host, path, envFor(SPLIT));
    assert.equal(a.status, b.status, `${host}${path}`);
    assert.deepEqual([...a.headers], [...b.headers], `${host}${path}`);
    assert.equal(await a.text(), await b.text(), `${host}${path}`);
  }
});
