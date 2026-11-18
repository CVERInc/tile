// tile#378 — three follow-ups to the service host (card-worker.mjs serviceHostStage).
//
//   1. a host is compared as one name: lower case, no port, no trailing dot. `new URL().hostname`
//      keeps the dot of a fully qualified name (`cards.feelreef.com.`), and with the service host on
//      that dot must not take a request past the boundary. With it off, nothing here is read.
//   2. the stand-ins (host-standins.mjs): an `Origin` that names a role's real host is another site
//      to the stand-in, and an `http:` Location is mapped back to the stand-in like an `https:` one.
//
// Every request row goes through the cardtile worker's fetch handler. A test marked CONTROL passes
// on the cardtile worker as it was: it pins what must not move.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, * as W from './card-worker.mjs';
import { standIn } from './host-standins.mjs';

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
const MARKER = 'PERSON-WROTE-THIS-378';
const file = (title) => ['---', `title: ${MARKER} ${title}`, '---', '', '## grid', '', `- [ ] %% card: profile w=6 %% ${MARKER} text`, ''].join('\n');
const PREVIEW_ID = 'b'.repeat(32);
const SEED = { t: file('page'), feelreef: file('platform'), [`_preview:${PREVIEW_ID}`]: file('draft') };

const PEOPLE = 'reef.cards', SERVICE = 'cards.feelreef.com', LEGACY = 'card.feelreef.com';
const CANONICAL = { CARD_CANONICAL_HOST: 'reef.cards' };
const OPEN = { CARDS_SERVICE_HOST: 'cards.feelreef.com' };
const SPLIT = { ...CANONICAL, ...OPEN };
const envFor = (setting, extra = {}) => ({ PREVIEW: 'false', CARDS: store(SEED), ...setting, ...extra });
const ask = (origin, path, env, init = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const loc = (res) => res.headers.get('location');
// the same request with and without the trailing dot answers the same, and reads the same keys
async function twin(host, path, setting, init = {}) {
  const plain = envFor(setting), dotted = envFor(setting);
  const a = await ask(`https://${host}`, path, plain, init);
  const b = await ask(`https://${host}.`, path, dotted, init);
  return { a, b, aBody: await a.text(), bBody: await b.text(), aReads: plain.CARDS.reads, bReads: dotted.CARDS.reads };
}

// ── 1. the trailing dot ─────────────────────────────────────────────────────────────────────────
test('378-1: the URL parser keeps a trailing dot in the hostname (the premise)', () => {
  assert.equal(new URL(`https://${SERVICE}./x`).hostname, `${SERVICE}.`);
});

test('378-1 split: the service host with a trailing dot does not render a parked preview — it sends it to the people\'s host', async () => {
  const env = envFor(SPLIT);
  const res = await ask(`https://${SERVICE}.`, `/_preview/${PREVIEW_ID}`, env);
  const body = await res.text();
  assert.ok(!body.includes(MARKER), 'what a person wrote is not rendered on the service host');
  assert.equal(res.status, 302);
  assert.equal(loc(res), `https://reef.cards/_preview/${PREVIEW_ID}`);
  assert.deepEqual(env.CARDS.reads, []);
});

for (const [name, setting] of [['split', SPLIT], ['open', OPEN]]) {
  test(`378-1 ${name}: the service host with a trailing dot answers every boundary row as without it`, async () => {
    for (const [path, init] of [
      ['/t', {}], ['/t.md', {}], ['/feelreef', {}], ['/', {}], [`/_preview/${PREVIEW_ID}`, {}], ['/robots.txt', {}], ['/report', {}],
      ['/t', { method: 'POST', body: 'x' }],
    ]) {
      const row = `${init.method || 'GET'} ${path}`;
      const { a, b, aBody, bBody, aReads, bReads } = await twin(SERVICE, path, setting, init);
      assert.ok(!bBody.includes(MARKER), `${row}: nothing a person wrote`);
      assert.equal(b.status, a.status, row);
      assert.equal(loc(b), loc(a), row);
      assert.equal(bBody, aBody, row);
      assert.deepEqual(bReads, aReads, row);
    }
  });
}

test('378-1 split: the people\'s host with a trailing dot answers no service endpoint', async () => {
  for (const [path, init] of [
    ['/_api/card/t', {}],
    ['/_api/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"handles":["t"]}' }],
    ['/try/park', { method: 'POST', headers: { origin: `https://${PEOPLE}.` }, body: SEED.t }],
    ['/try/edit', {}], ['/edit?host=https://feelreef.com', {}], ['/', {}],
  ]) {
    const row = `${init.method || 'GET'} ${path}`;
    const { a, b, aBody, bBody } = await twin(PEOPLE, path, SPLIT, init);
    assert.equal(b.status, a.status, row);
    assert.equal(loc(b), loc(a), row);
    assert.equal(bBody, aBody, row);
  }
});

test('378-1 open: the people\'s host with a trailing dot is as dark as without it — no API, no park', async () => {
  // the service host on, the people's host not yet (cardsHostStage 'dark'): reef.cards answers nothing
  for (const [path, init] of [
    ['/_api/card/t', {}], ['/_api/nope', { method: 'POST', body: 'x' }],
    ['/try/park', { method: 'POST', headers: { origin: `https://${PEOPLE}.` }, body: SEED.t }], ['/try/park', {}],
    ['/t', {}], ['/_icon/x.ico', {}],
  ]) {
    const row = `${init.method || 'GET'} ${path}`;
    const { a, b, aBody, bBody, aReads, bReads } = await twin(PEOPLE, path, OPEN, init);
    assert.equal(b.status, a.status, row);
    assert.equal(bBody, aBody, row);
    assert.deepEqual(bReads, aReads, row);
  }
});

test('378-1 split: the legacy host with a trailing dot moves as without it, and refuses a POST to a page', async () => {
  for (const [path, init] of [['/try/edit', {}], ['/try/edit2?lang=ja', {}], ['/t?utm=qr', {}], ['/', {}], ['/t', { method: 'POST', body: 'x' }]]) {
    const row = `${init.method || 'GET'} ${path}`;
    const { a, b, aBody, bBody } = await twin(LEGACY, path, SPLIT, init);
    assert.equal(b.status, a.status, row);
    assert.equal(loc(b), loc(a), row);
    assert.equal(bBody, aBody, row);
  }
});

test('378-1: hostBoundary and movedTo read a host as one name — case, port and trailing dot aside — once the service host is on', () => {
  const u = (p) => new URL(`https://x${p}`);
  for (const host of ['cards.feelreef.com.', 'CARDS.feelreef.com', 'cards.feelreef.com:443', 'Cards.FeelReef.com.:8443']) {
    for (const [p, m] of [[`/_preview/${PREVIEW_ID}`, 'GET'], ['/t', 'GET'], ['/t', 'POST'], ['/', 'GET']]) {
      assert.deepEqual(W.hostBoundary(SPLIT, host, p, m), W.hostBoundary(SPLIT, SERVICE, p, m), `${host} ${m} ${p}`);
      assert.deepEqual(W.hostBoundary(OPEN, host, p, m), W.hostBoundary(OPEN, SERVICE, p, m), `open ${host} ${m} ${p}`);
    }
  }
  for (const host of ['reef.cards.', 'REEF.cards:443']) {
    assert.deepEqual(W.hostBoundary(SPLIT, host, '/_api/card/t', 'GET'), { answer: 'refused' }, host);
  }
  for (const host of ['card.feelreef.com.', 'CARD.feelreef.com', 'card.feelreef.com:443']) {
    assert.equal(W.movedTo(host, u('/try/edit'), 'GET', SPLIT), 'https://cards.feelreef.com/try/edit', host);
    assert.equal(W.movedTo(host, u('/t'), 'GET', SPLIT), 'https://reef.cards/t', host);
    assert.deepEqual(W.hostBoundary(SPLIT, host, '/t', 'POST'), { answer: 'method' }, host);
  }
});

test('CONTROL 378-1: with the service host off, nothing is normalised — a dotted host is still another name', () => {
  const u = (p) => new URL(`https://x${p}`);
  for (const setting of [{}, CANONICAL, { ...CANONICAL, CARDS_SERVICE_HOST: 'cards.feelreef.com.' }]) {
    assert.equal(W.hostBoundary(setting, 'cards.feelreef.com.', '/t', 'GET'), null);
    assert.equal(W.movedTo('card.feelreef.com.', u('/t'), 'GET', setting), null, JSON.stringify(setting));
  }
  assert.equal(W.movedTo('card.feelreef.com', u('/t'), 'GET', CANONICAL), 'https://reef.cards/t');
});

// ── 1 + 2: the stand-ins ────────────────────────────────────────────────────────────────────────
const STANDINS = { CARDS_HOST_STANDINS: 'service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com' };
const S_SERVICE = 'cards-staging.feelreef.com', S_PEOPLE = 'staging.reef.cards', S_LEGACY = 'card-staging.feelreef.com';
const STAGING = { ...SPLIT, ...STANDINS, PREVIEW: 'true' };
const REAL = { service: SERVICE, people: PEOPLE, legacy: LEGACY };

test('378-1 staging: a stand-in with a trailing dot answers as the stand-in', async () => {
  for (const [host, path] of [[S_SERVICE, '/t'], [S_SERVICE, `/_preview/${PREVIEW_ID}`], [S_PEOPLE, '/'], [S_LEGACY, '/try/edit']]) {
    const { a, b, aBody, bBody } = await twin(host, path, STAGING);
    assert.equal(b.status, a.status, `${host}${path}`);
    assert.equal(loc(b), loc(a), `${host}${path}`);
    assert.equal(b.headers.get('x-robots-tag'), 'noindex, nofollow', `${host}${path}`);
    assert.equal(bBody, aBody, `${host}${path}`);
  }
});

test('378-2 staging: an Origin that names the role\'s real host is another site to the stand-in — the park and the report refuse it', async () => {
  const env = envFor(STAGING);
  const park = await ask(`https://${S_SERVICE}`, '/try/park', env, { method: 'POST', headers: { origin: `https://${SERVICE}` }, body: SEED.t });
  assert.equal(park.status, 403);
  assert.equal([...env.CARDS.kv.keys()].filter((k) => k.startsWith('try:')).length, 0, 'nothing parked');
  const legacyPark = await ask(`https://${S_LEGACY}`, '/try/park', envFor(STAGING), { method: 'POST', headers: { origin: `https://${LEGACY}` }, body: SEED.t });
  assert.equal(legacyPark.status, 403);
  const report = await ask(`https://${S_PEOPLE}`, '/report', envFor(STAGING), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${PEOPLE}` },
    body: 'card=https%3A%2F%2Freef.cards%2Ft&reason=other&_hp=bot',
  });
  assert.equal(report.status, 403);
});

test('CONTROL 378-2 staging: the stand-in\'s own Origin still passes, and the real host still parks for its own Origin', async () => {
  assert.equal((await ask(`https://${S_SERVICE}`, '/try/park', envFor(STAGING), { method: 'POST', headers: { origin: `https://${S_SERVICE}` }, body: SEED.t })).status, 200);
  assert.equal((await ask(`https://${SERVICE}`, '/try/park', envFor(STAGING), { method: 'POST', headers: { origin: `https://${SERVICE}` }, body: SEED.t })).status, 200);
  const report = await ask(`https://${S_PEOPLE}`, '/report', envFor(STAGING), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${S_PEOPLE}` },
    body: 'card=https%3A%2F%2Freef.cards%2Ft&reason=other&_hp=bot',
  });
  assert.equal(report.status, 303);
});

test('378-2 staging: an http: Location that names a role\'s real host is mapped back to its stand-in', async () => {
  // the retired editor path redirects to the request's own origin, scheme included
  const res = await ask(`http://${S_SERVICE}`, '/try/edit2?lang=ja', envFor(STAGING));
  assert.equal(res.status, 301);
  assert.equal(loc(res), `http://${S_SERVICE}/try/edit?lang=ja`);
  // the adapter alone, for each role, the port kept
  for (const [role, real] of Object.entries(REAL)) {
    const s = standIn(new Request(`https://${S_SERVICE}/x`), STANDINS, REAL);
    const out = s.answer(new Response(null, { status: 302, headers: { location: `http://${real}:8080/p?q=1` } }));
    const want = { service: S_SERVICE, people: S_PEOPLE, legacy: S_LEGACY }[role];
    assert.equal(loc(out), `http://${want}:8080/p?q=1`, role);
  }
});

test('CONTROL 378-2: a Location in another scheme, or to a host that is no role, is left alone', () => {
  const s = standIn(new Request(`https://${S_SERVICE}/x`), STANDINS, REAL);
  for (const l of ['ftp://cards.feelreef.com/x', 'https://own.example/', 'http://own.example/', '/relative']) {
    assert.equal(loc(s.answer(new Response(null, { status: 302, headers: { location: l } }))), l, l);
  }
});
