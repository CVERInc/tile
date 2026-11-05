// `/_api/vanity/<handle>` on the lifetime-bound bindings.  run: node --test card-vanity.test.mjs
//
// The contract is reef-mcp's `makeCardVanityClient` (CVERInc/reef#1971). Every refusal here is paired
// with the legitimate call it must not be confused with, and the race and crash tests judge the
// outcome on PUBLIC responses (the creator's domain, the canonical address), not on keys alone.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleApi, liveCard, cardKey, genKey, vanityKey, vanityOfKey, legacyVanityOfKey, bindVanity, releaseVanity,
  HostBindings, CardLifetime, TICKET_TTL_MS, _internal,
} from './card-api.mjs';
import { vanityHost } from './card-vanity.mjs';
import worker from './card-worker.mjs';
import { cardVersion } from '../card-save.mjs';

// ── doubles (the same shapes card-api.test.mjs uses) ─────────────────────────────────────────────

const card = (title, handle) => ['---', `card-page: ${handle}`, `title: ${title}`, '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% hello', ''].join('\n');
const A_CARD = card('Alpha card', 'a'), B_CARD = card('Bravo card', 'b');
const TOKEN = 'vanity-test-bearer';
let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    _m: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true };
    },
  };
};
const doStorage = () => {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list({ prefix = '' } = {}) { return new Map([...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k, structuredClone(m.get(k))])); },
    _alarm: null,
    async setAlarm(t) { this._alarm = t; },
  };
};
/** one object per name, requests delivered concurrently (the object's own queue orders them) */
const objectNs = (Class, { prepare = null } = {}) => (objectEnv) => {
  const objects = new Map(), storages = new Map(), ready = new Map();
  const storageOf = (name) => { if (!storages.has(name)) storages.set(name, doStorage()); return storages.get(name); };
  return {
    storageOf,
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({
      async fetch(url, init) {
        if (!objects.has(name)) objects.set(name, new Class({ storage: storageOf(name) }, objectEnv));
        if (prepare && !ready.has(name)) ready.set(name, prepare(objects.get(name), name, objectEnv));
        if (ready.has(name)) await ready.get(name);
        return objects.get(name).fetch(new Request(url, init));
      },
    }),
  };
};
/** a seeded card stands for one its object already holds (card-api.test.mjs `presettle`) */
const presettle = async (object, handle, objectEnv) => {
  const real = object.storage._m, kvMap = objectEnv.CARDS._m;
  const gen = (real.get('life') || {}).gen || '0';
  if (real.has(`card:${gen}`)) return;
  const md = kvMap.get(cardKey(handle, gen)) ?? (gen === '0' ? kvMap.get(handle) : undefined);
  if (md == null) { real.set('life', { ...(real.get('life') || { gen, hosts: [], pending: {} }), cardless: gen }); return; }
  const scratch = doStorage();
  scratch._m.set('life', { gen, hosts: [], pending: {} });
  await new CardLifetime({ storage: scratch }, objectEnv).keepCard(handle, gen, md, await cardVersion(md), 'written', null, { from: 'kv-settled' });
  for (const [k, v] of scratch._m) if (k.startsWith('card:')) real.set(k, v);
};
const envWith = (seed = { a: A_CARD, b: B_CARD }) => {
  const env = { CARDS: fakeKv(seed), MCP_TOKEN_HASH: TOKEN_HASH };
  env.HOST_BINDINGS = objectNs(HostBindings)(env);
  env.CARD_LIFETIMES = objectNs(CardLifetime, { prepare: presettle })(env);
  return env;
};

const X = 'mine.example', Y = 'other.example';
const api = async (env, method, path, body, token = TOKEN) => {
  const url = new URL('https://card.feelreef.com' + path);
  const res = await handleApi(new Request(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  }), env, url);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const vget = (env, h = 'a') => api(env, 'GET', `/_api/vanity/${h}`);
const vput = (env, body, h = 'a') => api(env, 'PUT', `/_api/vanity/${h}`, body);
const vdel = (env, body = {}, h = 'a') => api(env, 'DELETE', `/_api/vanity/${h}`, body);
/** a visitor on `host` asking for `path` */
const visit = (env, host, path = '/') => worker.fetch(new Request(`https://${host}${path}`), env);
/** who `host` serves: the X-Card-Handle it answers with on a 200, else null */
const servedBy = async (env, host) => {
  const res = await visit(env, host);
  return res.status === 200 ? res.headers.get('x-card-handle') : null;
};
/** where canonical /<handle> 301s to, or null */
const redirectOf = async (env, handle) => {
  const res = await visit(env, 'card.feelreef.com', `/${handle}`);
  return res.status === 301 ? new URL(res.headers.get('location')).hostname : null;
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// ── vanityHost ───────────────────────────────────────────────────────────────────────────────────

test('vanityHost accepts a creator\'s hostname exactly as the URL parser spells it', () => {
  for (const h of ['mine.example', 'www.mine.example', 'a-b.c-d.example', 'xn--fiqs8s.example', 'xn--bcher-kva.example', '1.example', 'x1.y2']) {
    assert.equal(vanityHost(h), h, h);
    assert.equal(new URL(`https://${h}/`).hostname, h, `CONTROL ${h}`);
  }
});

test('🔴 vanityHost refuses every host no request could reach or that is ours: IPs in any spelling, bad A-labels, platform zones', () => {
  for (const h of [
    '', 'example', 'Mine.example', 'mine.example.', 'mine.example:443', 'https://mine.example', 'mine.example/x', ' mine.example',
    'a..example', '-a.example', 'a-.example', 'a_b.example', `${'a'.repeat(64)}.example`,
    '127.0.0.1', '10.1.2.3', '127.0x1', '0x7f.0x0.0x0.0x1', '0x7f.0x1', '1.2.3.0x4', '1.2.3.04', '[::1]',
    'xn--a.example', 'xn--abc.example',
    'feelreef.com', 'card.feelreef.com', 'saas.feelreef.com', 'reef.cards', 'x.reef.cards', 'cardtile.acct.workers.dev',
    null, undefined, 42, { toString: null }, ['mine.example'],
  ]) assert.equal(vanityHost(h), null, JSON.stringify(h));
});

// ── the door ─────────────────────────────────────────────────────────────────────────────────────

test('the door: no bearer 401, a handle outside the grammar 400 handle_invalid, other methods 405', async () => {
  const env = envWith();
  assert.equal((await api(env, 'GET', '/_api/vanity/a', undefined, null)).status, 401);
  assert.equal((await api(env, 'PUT', '/_api/vanity/a', { host: X }, 'wrong')).status, 401);
  for (const bad of ['%E0%A4', '%', '%zz', encodeURIComponent('楓葉'), 'a_b', '-a']) {
    const r = await api(env, 'GET', `/_api/vanity/${bad}`);
    assert.deepEqual([r.status, r.body], [400, { error: 'handle_invalid' }], bad);
  }
  assert.deepEqual(await api(env, 'POST', '/_api/vanity/a', {}), { status: 405, body: { error: 'method_not_allowed' } });
  // CONTROL: the same handle in upper case is the handle
  assert.deepEqual(await api(env, 'GET', '/_api/vanity/A'), { status: 200, body: { handle: 'a', host: null, redirect: false } });
});

test('without both objects the route refuses (503 vanity_unavailable) and writes nothing', async () => {
  for (const missing of ['HOST_BINDINGS', 'CARD_LIFETIMES']) {
    const env = envWith();
    delete env[missing];
    const before = new Map(env.CARDS._m);
    for (const [m, body] of [['GET'], ['PUT', { host: X }], ['DELETE', {}]]) {
      assert.deepEqual(await api(env, m, '/_api/vanity/a', body), { status: 503, body: { error: 'vanity_unavailable' } }, `${missing} ${m}`);
    }
    assert.deepEqual(new Map(env.CARDS._m), before);
  }
});

// ── GET ──────────────────────────────────────────────────────────────────────────────────────────

test('GET: 404 card_not_found for no card (and an empty one); an unbound card has `redirect` and `host: null`', async () => {
  const env = envWith({ a: A_CARD, e: '' });
  assert.deepEqual(await vget(env, 'nobody'), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(await vget(env, 'e'), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(await vget(env), { status: 200, body: { handle: 'a', host: null, redirect: false } });
});

// ── PUT ──────────────────────────────────────────────────────────────────────────────────────────

test('PUT binds through the objects: the domain serves the card with X-Card-Handle, the canonical address 301s there', async () => {
  const env = envWith();
  assert.deepEqual(await vput(env, { host: X }), { status: 200, body: { handle: 'a', host: X, redirect: true, changed: true } });
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: true });
  assert.equal(await servedBy(env, X), 'a');
  assert.equal(await redirectOf(env, 'a'), X);
  // the keys are the objects' (cards/README.md "who writes each key"), never written from the route
  assert.equal(env.CARDS._m.get(vanityKey(X)), 'a');
  assert.equal(env.CARDS._m.get(vanityOfKey('a', '0')), X);
  assert.equal(env.HOST_BINDINGS.storageOf(X)._m.get('host').owner.handle, 'a');
  // the same body again changes nothing
  assert.deepEqual(await vput(env, { host: X }), { status: 200, body: { handle: 'a', host: X, redirect: true, changed: false } });
});

test('🔴 redirect:false binds the domain without the 301; then true turns it on; then false turns it off again', async () => {
  const env = envWith();
  assert.deepEqual((await vput(env, { host: X, redirect: false })).body, { handle: 'a', host: X, redirect: false, changed: true });
  assert.equal(await servedBy(env, X), 'a', 'the domain serves the card');
  assert.equal(await redirectOf(env, 'a'), null, 'redirect:false 301d the canonical address');
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: false });
  assert.deepEqual((await vput(env, { host: X, redirect: true })).body, { handle: 'a', host: X, redirect: true, changed: true });
  assert.equal(await redirectOf(env, 'a'), X);
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: true });
  assert.deepEqual((await vput(env, { host: X, redirect: false })).body, { handle: 'a', host: X, redirect: false, changed: true });
  assert.equal(await redirectOf(env, 'a'), null, 'true → false left the 301');
  assert.equal(await servedBy(env, X), 'a', 'true → false took the domain down');
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: false });
  assert.deepEqual((await vput(env, { host: X, redirect: false })).body.changed, false);
});

test('PUT to another host moves the card: the old host lets go (and its redirect), the new one serves — in either mode', async () => {
  for (const [first, second] of [[true, true], [true, false], [false, true], [false, false]]) {
    const env = envWith();
    await vput(env, { host: X, redirect: first });
    assert.deepEqual((await vput(env, { host: Y, redirect: second })).body, { handle: 'a', host: Y, redirect: second, changed: true });
    const where = `${first} → ${second}`;
    assert.equal(await servedBy(env, X), null, `${where}: the old host still serves`);
    assert.equal(await servedBy(env, Y), 'a', where);
    assert.equal(await redirectOf(env, 'a'), second ? Y : null, where);
    assert.deepEqual((await vget(env)).body, { handle: 'a', host: Y, redirect: second }, where);
  }
});

test('PUT refusals, each with nothing written: host, redirect, expect, card, taken, changed', async () => {
  const env = envWith();
  await vput(env, { host: X }, 'b');
  const before = new Map(env.CARDS._m);
  const cases = [
    [{}, 400, 'vanity_host_invalid'],
    [{ host: 'Mine.example' }, 400, 'vanity_host_invalid'],
    [{ host: { toString: null } }, 400, 'vanity_host_invalid'],
    [{ host: '127.0x1' }, 400, 'vanity_host_invalid'],
    [{ host: 'saas.feelreef.com' }, 400, 'vanity_host_invalid'],
    [{ host: Y, redirect: 'yes' }, 400, 'vanity_redirect_invalid'],
    [{ host: Y, redirect: null }, 400, 'vanity_redirect_invalid'],
    [{ host: Y, expect: null }, 400, 'vanity_expect_invalid'],
    [{ host: Y, expect: { host: null } }, 400, 'vanity_expect_invalid'],
    [{ host: Y, expect: { host: 1, redirect: false } }, 400, 'vanity_expect_invalid'],
    [{ host: Y, expect: [] }, 400, 'vanity_expect_invalid'],
    [{ host: Y, expect: { host: Y, redirect: true } }, 409, 'vanity_state_changed'],
  ];
  for (const [body, status, error] of cases) {
    assert.deepEqual(await vput(env, body), { status, body: { error } }, JSON.stringify(body));
  }
  assert.deepEqual(await vput(env, { host: Y }, 'nobody'), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(await vput(env, { host: X }), { status: 409, body: { error: 'vanity_taken', held_by: 'b' } });
  assert.deepEqual(new Map(env.CARDS._m), before, 'a refused PUT wrote a key');
  assert.equal(await servedBy(env, X), 'b');
  // CONTROL: the same calls made legitimately go through
  assert.equal((await vput(env, { host: Y, expect: { host: null, redirect: false } })).status, 200);
});

test('a legacy pointer (no object state) is held by its handle: vanity_taken names it, and a DELETE {host} by that handle frees it', async () => {
  const env = envWith({ a: A_CARD, b: B_CARD, [vanityKey(X)]: 'b' });
  assert.equal(await servedBy(env, X), 'b', 'CONTROL: a generation-0 pointer alone binds');
  assert.deepEqual(await vput(env, { host: X }), { status: 409, body: { error: 'vanity_taken', held_by: 'b' } });
  // the convergence path reef takes on held_by: GET the holder; it does not report X; DELETE {host}
  assert.deepEqual((await vget(env, 'b')).body, { handle: 'b', host: null, redirect: false });
  assert.deepEqual((await vdel(env, { host: X, expect: { host: null, redirect: false } }, 'b')).body, { handle: 'b', host: null, changed: true, orphan_removed: true });
  assert.equal(env.CARDS._m.get(vanityKey(X)), undefined);
  assert.equal((await vput(env, { host: X })).status, 200);
  assert.equal(await servedBy(env, X), 'a');
});

test('a legacy two-key binding (pointer + bare inverse) reads as bound, and DELETE removes both', async () => {
  const env = envWith({ a: A_CARD, [vanityKey(X)]: 'a', [legacyVanityOfKey('a')]: X });
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: true });
  assert.equal(await redirectOf(env, 'a'), X);
  assert.deepEqual((await vdel(env, { expect: { host: X, redirect: true } })).body, { handle: 'a', host: null, changed: true });
  assert.equal(await redirectOf(env, 'a'), null);
  assert.equal(await servedBy(env, X), null);
  assert.equal(env.CARDS._m.get(legacyVanityOfKey('a')), undefined);
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false });
});

test('invalid_host: a legacy inverse the route would refuse is reported, never 301d to, and a PUT to a valid host cleans it', async () => {
  for (const bad of ['xn--a.example', '127.0x1']) {
    const env = envWith({ a: A_CARD, [vanityKey(bad)]: 'a', [legacyVanityOfKey('a')]: bad });
    assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false, invalid_host: true }, bad);
    assert.equal((await visit(env, 'card.feelreef.com', '/a')).status, 200, `${bad}: the canonical address redirected to it`);
    assert.deepEqual((await vput(env, { host: X, expect: { host: null, redirect: false } })).body, { handle: 'a', host: X, redirect: true, changed: true });
    assert.deepEqual((await vget(env)).body, { handle: 'a', host: X, redirect: true }, bad);
  }
});

test('inconsistent: two hosts held (unserialised binds) refuse PUT 409 vanity_state_inconsistent; DELETE is the repair', async () => {
  const env = envWith();
  await bindVanity(env, 'a', X, { redirect: false });
  await bindVanity(env, 'a', Y, { redirect: false });
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false, inconsistent: true });
  const before = new Map(env.CARDS._m);
  assert.deepEqual(await vput(env, { host: X }), { status: 409, body: { error: 'vanity_state_inconsistent' } });
  assert.deepEqual(new Map(env.CARDS._m), before);
  assert.deepEqual((await vdel(env, { expect: { host: null, redirect: false } })).body, { handle: 'a', host: null, changed: true });
  assert.equal(await servedBy(env, X), null);
  assert.equal(await servedBy(env, Y), null);
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false });
});

test('an object that fails mid-PUT answers 503 vanity_unconfirmed, and the same call again finishes', async () => {
  const env = envWith();
  const lives = env.CARD_LIFETIMES;
  env.CARD_LIFETIMES = { ...lives, get: (id) => ({ fetch: (url, init) =>
    (new URL(url).pathname === '/confirm' ? Promise.resolve(new Response('no', { status: 500 })) : lives.get(id).fetch(url, init)) }) };
  assert.deepEqual(await vput(env, { host: X }), { status: 503, body: { error: 'vanity_unconfirmed' } });
  assert.equal(await redirectOf(env, 'a'), null, 'the redirect was published without its confirm');
  env.CARD_LIFETIMES = lives;
  assert.deepEqual((await vput(env, { host: X })).body, { handle: 'a', host: X, redirect: true, changed: true });
  assert.equal(await redirectOf(env, 'a'), X);
});

// ── DELETE ───────────────────────────────────────────────────────────────────────────────────────

test('DELETE releases the card\'s host and its redirect; again is changed:false; refusals for expect and host', async () => {
  const env = envWith();
  await vput(env, { host: X });
  assert.deepEqual(await vdel(env, { expect: { host: X, redirect: false } }), { status: 409, body: { error: 'vanity_state_changed' } });
  assert.deepEqual(await vdel(env, { expect: 'x' }), { status: 400, body: { error: 'vanity_expect_invalid' } });
  assert.deepEqual(await vdel(env, { host: 'Bad.example' }), { status: 400, body: { error: 'vanity_host_invalid' } });
  assert.deepEqual(await vdel(env, { host: { toString: null } }), { status: 400, body: { error: 'vanity_host_invalid' } });
  assert.equal(await servedBy(env, X), 'a', 'a refused DELETE released the host');
  assert.deepEqual(await vdel(env, { expect: { host: X, redirect: true } }), { status: 200, body: { handle: 'a', host: null, changed: true } });
  assert.equal(await servedBy(env, X), null);
  assert.equal(await redirectOf(env, 'a'), null);
  assert.equal(env.CARDS._m.get(vanityKey(X)), undefined, 'the pointer is the object\'s to delete, and it did');
  assert.equal(env.HOST_BINDINGS.storageOf(X)._m.get('host').owner, null);
  assert.deepEqual(await vdel(env, {}), { status: 200, body: { handle: 'a', host: null, changed: false } });
  // a card that does not exist has nothing bound, and the DELETE still answers
  assert.deepEqual(await vdel(env, {}, 'nobody'), { status: 200, body: { handle: 'nobody', host: null, changed: false } });
});

test('DELETE {host}: the card\'s own host, another card\'s host (409 held_by, untouched), and a host nobody holds', async () => {
  const env = envWith();
  await vput(env, { host: X });
  await vput(env, { host: Y }, 'b');
  assert.deepEqual(await vdel(env, { host: Y }), { status: 409, body: { error: 'vanity_taken', held_by: 'b' } });
  assert.equal(await servedBy(env, Y), 'b');
  assert.deepEqual((await vdel(env, { host: 'free.example' })).body, { handle: 'a', host: X, changed: false, orphan_removed: false });
  assert.deepEqual((await vdel(env, { host: X })).body, { handle: 'a', host: null, changed: true, orphan_removed: false });
  assert.equal(await servedBy(env, X), null);
  assert.equal(await redirectOf(env, 'a'), null);
});

// ── across a lifetime ────────────────────────────────────────────────────────────────────────────

test('🔴 bind, card DELETE, card again: the new lifetime is unbound, its domain is free; rebind and unbind work in it', async () => {
  const env = envWith();
  await vput(env, { host: X });
  assert.equal((await api(env, 'DELETE', '/_api/card/a')).status, 200);
  assert.equal(await servedBy(env, X), null, 'the ended lifetime still serves');
  assert.deepEqual(await vget(env), { status: 404, body: { error: 'card_not_found' } });
  assert.equal((await api(env, 'PUT', '/_api/card/a', { markdown: A_CARD })).status, 200);
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false }, 'the next lifetime inherited the binding');
  assert.equal(await redirectOf(env, 'a'), null);
  // the freed host can go to another card
  assert.equal((await vput(env, { host: X }, 'b')).status, 200);
  assert.equal(await servedBy(env, X), 'b');
  assert.deepEqual(await vput(env, { host: X }), { status: 409, body: { error: 'vanity_taken', held_by: 'b' } });
  // the new lifetime binds, unbinds and binds again
  assert.equal((await vput(env, { host: Y, redirect: false })).status, 200);
  assert.equal(await servedBy(env, Y), 'a');
  assert.equal((await vdel(env)).body.changed, true);
  assert.equal(await servedBy(env, Y), null);
  assert.deepEqual((await vput(env, { host: Y })).body, { handle: 'a', host: Y, redirect: true, changed: true });
  assert.equal(await servedBy(env, Y), 'a');
  assert.equal(await redirectOf(env, 'a'), Y);
});

test('🔴 a binding from an ended lifetime is none: a DELETE whose end was not delivered leaves an inert owner that GET does not report and DELETE {host} clears', async () => {
  const env = envWith();
  await vput(env, { host: X });
  const ns = env.HOST_BINDINGS;
  env.HOST_BINDINGS = { ...ns, get: (id) => ({ fetch: (url, init) =>
    (new URL(url).pathname === '/end' ? Promise.resolve(new Response('no', { status: 503 })) : ns.get(id).fetch(url, init)) }) };
  assert.equal((await api(env, 'DELETE', '/_api/card/a')).status, 503);
  env.HOST_BINDINGS = ns;
  // the lifetime ended in CardLifetime; KV still names the old generation and the card still serves
  assert.equal(ns.storageOf(X)._m.get('host').owner.handle, 'a', 'CONTROL: the owner is the ended lifetime');
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false });
  // a PUT checks the card under the KV generation, which CardLifetime has ended: refused, nothing bound
  assert.deepEqual(await vput(env, { host: Y }), { status: 409, body: { error: 'vanity_state_changed' } });
  assert.equal(await servedBy(env, Y), null);
  // b cannot take X while the ended lifetime still owns it; a's DELETE {host} frees it
  assert.deepEqual(await vput(env, { host: X }, 'b'), { status: 409, body: { error: 'vanity_taken', held_by: 'a' } });
  assert.deepEqual((await vdel(env, { host: X })).body, { handle: 'a', host: null, changed: true, orphan_removed: true });
  assert.equal((await vput(env, { host: X }, 'b')).status, 200);
  assert.equal(await servedBy(env, X), 'b');
});

// ── races through the objects ────────────────────────────────────────────────────────────────────

/** hold the first object call matching `match(path, body)` until released */
const holdObjectCall = (env, key, match) => {
  const ns = env[key], started = deferred(), release = deferred();
  let armed = true;
  env[key] = { ...ns, get: (id) => ({ async fetch(url, init) {
    if (armed && match(new URL(url).pathname, JSON.parse(init.body))) { armed = false; started.resolve(); await release.promise; }
    return ns.get(id).fetch(url, init);
  } }) };
  return { started: started.promise, release: () => { env[key] = ns; release.resolve(); } };
};

test('🔴 two cards racing for one host: the one whose /point reaches the host first keeps it, the other is 409 vanity_taken naming it', async () => {
  // a passes the up-front check, then is held just before its /point; b binds X meanwhile
  const env = envWith();
  const held = holdObjectCall(env, 'HOST_BINDINGS', (p, b) => p === '/point' && b.handle === 'a');
  const a = vput(env, { host: X });
  await held.started;
  assert.equal((await vput(env, { host: X }, 'b')).status, 200, 'b');
  held.release();
  assert.deepEqual(await a, { status: 409, body: { error: 'vanity_taken', held_by: 'b' } });
  assert.equal(await servedBy(env, X), 'b', 'a took the host from b');
  assert.equal(await redirectOf(env, 'a'), null, 'a refused bind published a redirect');
  assert.equal(await redirectOf(env, 'b'), X);
  assert.deepEqual((await vget(env)).body, { handle: 'a', host: null, redirect: false });
  // CONTROL: unheld and concurrent, exactly one wins
  for (let i = 0; i < 5; i++) {
    const e = envWith();
    const rs = await Promise.all([vput(e, { host: X }), vput(e, { host: X }, 'b')]);
    const won = rs.filter((r) => r.status === 200);
    assert.equal(won.length, 1, JSON.stringify(rs));
    const winner = won[0].body.handle, loser = winner === 'a' ? 'b' : 'a';
    assert.deepEqual(rs.find((r) => r.status !== 200), { status: 409, body: { error: 'vanity_taken', held_by: winner } });
    assert.equal(await servedBy(e, X), winner);
    assert.equal(await redirectOf(e, loser), null);
  }
});

test('🔴 a PUT held before its /point across a DELETE of the same card never lands after it (the release ticket)', async () => {
  const env = envWith();
  await vput(env, { host: X, redirect: false });
  // the PUT turns the redirect on; it registers, then is held before /point
  const held = holdObjectCall(env, 'HOST_BINDINGS', (p, b) => p === '/point' && b.handle === 'a');
  const put = vput(env, { host: X, redirect: true });
  await held.started;
  const del = await vdel(env, {});
  assert.deepEqual(del.body, { handle: 'a', host: null, changed: true });
  held.release();
  assert.deepEqual(await put, { status: 409, body: { error: 'vanity_state_changed' } });
  assert.equal(await servedBy(env, X), null, 'a bind admitted before the release landed after it');
  assert.equal(await redirectOf(env, 'a'), null);
  // CONTROL: a bind admitted after the release lands
  assert.equal((await vput(env, { host: X })).status, 200);
  assert.equal(await servedBy(env, X), 'a');
});

test('🔴 a first PUT, registered but not yet pointed, is fenced by a DELETE that found nothing held yet', async () => {
  const env = envWith();
  const held = holdObjectCall(env, 'HOST_BINDINGS', (p, b) => p === '/point' && b.handle === 'a');
  const put = vput(env, { host: X });
  await held.started;
  // nothing is bound yet, but the lifetime registered X: the release reaches it and leaves its ticket
  assert.deepEqual((await vdel(env, {})).body, { handle: 'a', host: null, changed: false });
  held.release();
  assert.deepEqual(await put, { status: 409, body: { error: 'vanity_state_changed' } });
  assert.equal(await servedBy(env, X), null, 'a PUT in flight across a DELETE bound the host after it');
  assert.equal(await redirectOf(env, 'a'), null);
});

test('🔴 a release whose ticket predates a newer bind of the same card is refused at /unbind: the newer bind stands', async () => {
  const env = envWith();
  await vput(env, { host: X });
  const held = holdObjectCall(env, 'HOST_BINDINGS', (p) => p === '/unbind');
  const del = vdel(env, {});
  await held.started;
  // a bind of the same host and card admitted after the release's ticket lands first
  const r = await bindVanity(env, 'a', X);
  assert.ok(r.accepted, JSON.stringify(r));
  held.release();
  assert.deepEqual(await del, { status: 409, body: { error: 'vanity_state_changed' } });
  assert.equal(await servedBy(env, X), 'a', 'the older release undid the newer bind');
  assert.equal(await redirectOf(env, 'a'), X, 'the older release withdrew the newer bind\'s redirect');
});

test('released entries are forgotten only once every ticket they could refuse has expired', async () => {
  const storage = doStorage(), o = new HostBindings({ storage }, { CARDS: fakeKv({}), CARD_LIFETIMES: objectNs(CardLifetime)({ CARDS: fakeKv({}) }) });
  const post = async (op, body) => (await o.fetch(new Request(`https://host-bindings.example/${op}`, { method: 'POST', body: JSON.stringify({ host: X, ...body }) }))).json();
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const { ticket: old } = await post('admit', { handle: 'a' });
    now += 10;
    const { ticket: rel } = await post('admit', { handle: 'a' });
    assert.deepEqual(await post('unbind', { handle: 'a', ticket: rel }), { released: false });
    assert.ok((await post('point', { handle: 'a', gen: '0', ticket: old })).superseded, 'a bind older than the release landed');
    now += TICKET_TTL_MS - 11;
    await post('admit', { handle: 'b' }); // a write: the object stores its pruned state
    assert.ok(storage._m.get('host').released.a, 'an entry a live ticket still needs was dropped');
    now += TICKET_TTL_MS;
    await post('admit', { handle: 'b' });
    assert.equal(storage._m.get('host').released.a, undefined);
    assert.ok((await post('point', { handle: 'a', gen: '0', ticket: old })).expired, 'CONTROL: that ticket is expired on its own');
  } finally { Date.now = realNow; }
});

// ── crash between steps ──────────────────────────────────────────────────────────────────────────

/**
 * A Worker that dies before its n-th outside call (any KV call or object request it makes itself; the
 * objects' own calls are theirs and run whole). Every call from the n-th on throws, so nothing after the
 * death happens. → the crashing view of `env`, and `reached()` = whether the n-th call was reached.
 */
const dyingAt = (env, n) => {
  let i = 0, reached = false;
  const step = (what) => { if (i++ >= n) { reached = true; throw new Error(`died before ${what}`); } };
  const kv = {};
  for (const m of ['get', 'getWithMetadata', 'put', 'delete', 'list']) kv[m] = async (...a) => { step(`${m} ${a[0]}`); return env.CARDS[m](...a); };
  const ns = (key) => ({ ...env[key], get: (id) => ({ fetch: async (url, init) => { step(`${key} ${new URL(url).pathname}`); return env[key].get(id).fetch(url, init); } }) });
  return { view: { ...env, CARDS: kv, HOST_BINDINGS: ns('HOST_BINDINGS'), CARD_LIFETIMES: ns('CARD_LIFETIMES') }, reached: () => reached };
};
const viaView = async (view, method, body) => {
  const url = new URL('https://card.feelreef.com/_api/vanity/a');
  // a throw out of the route is the Worker dying there (the deployed Worker answers it 500)
  try {
    const res = await handleApi(new Request(url, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), view, url);
    return res.status;
  } catch { return 'died'; }
};
/** I1: at most one host serves the card. I2: the canonical address 301s only to a host that serves it. */
const invariants = async (env, hosts, where) => {
  const serving = [];
  for (const h of hosts) if ((await servedBy(env, h)) === 'a') serving.push(h);
  assert.ok(serving.length <= 1, `${where}: I1 — the card is served on ${serving.join(' and ')}`);
  const to = await redirectOf(env, 'a');
  if (to) assert.equal(await servedBy(env, to), 'a', `${where}: I2 — /a 301s to ${to}, which does not serve it`);
};

test('🔴 crash before every outside call of every PUT and DELETE: I1 and I2 hold at the crash, and the same call again finishes', async () => {
  const scenarios = [
    ['fresh, redirect on', null, { host: X }],
    ['fresh, redirect off', null, { host: X, redirect: false }],
    ['redirect off → on', { host: X, redirect: false }, { host: X, redirect: true }],
    ['redirect on → off', { host: X, redirect: true }, { host: X, redirect: false }],
    ['rebind, redirect on', { host: X, redirect: true }, { host: Y, redirect: true }],
    ['rebind, redirect off → on', { host: X, redirect: false }, { host: Y, redirect: true }],
    ['rebind, redirect on → off', { host: X, redirect: true }, { host: Y, redirect: false }],
  ].map(([name, start, body]) => [name, start, 'PUT', body])
    .concat([
      ['delete, redirect on', { host: X, redirect: true }, 'DELETE', {}],
      ['delete, redirect off', { host: X, redirect: false }, 'DELETE', {}],
      ['delete {host}, redirect on', { host: X, redirect: true }, 'DELETE', { host: X }],
    ]);
  let crashes = 0;
  for (const [name, start, method, body] of scenarios) {
    // the outcome with no crash, to compare the retried one with
    const clean = envWith();
    if (start) assert.equal((await vput(clean, start)).status, 200);
    assert.equal((await api(clean, method, '/_api/vanity/a', body)).status, 200, `${name}: CONTROL`);
    const want = (await vget(clean)).body;
    for (let n = 0; ; n++) {
      const env = envWith();
      if (start) assert.equal((await vput(env, start)).status, 200);
      const dying = dyingAt(env, n);
      const status = await viaView(dying.view, method, body);
      if (!dying.reached()) { assert.equal(status, 200, `${name}: the call that reached no crash point`); break; }
      crashes++;
      const where = `${name}, died before outside call ${n}`;
      assert.ok(status === 503 || status === 'died', `${where}: ${status}`);
      await invariants(env, [X, Y], where);
      assert.equal((await api(env, method, '/_api/vanity/a', body)).status, 200, `${where}: the retry`);
      assert.deepEqual((await vget(env)).body, want, `${where}: the retry did not finish the job`);
      await invariants(env, [X, Y], `${where} (retried)`);
    }
  }
  assert.ok(crashes >= 60, `CONTROL: only ${crashes} crash points were reached`);
});

// ── the worker's side ────────────────────────────────────────────────────────────────────────────

test('🔴 X-Card-Handle: on the creator\'s domain on all three card exits, in both redirect modes; nowhere else', async () => {
  for (const redirect of [false, true]) {
    const env = envWith();
    await vput(env, { host: X, redirect });
    const page = await visit(env, X, '/');
    const fat = await visit(env, X, '/index.md');
    const thin = await worker.fetch(new Request(`https://${X}/`, { headers: { accept: 'text/markdown' } }), env);
    for (const [name, res] of [['page', page], ['/index.md', fat], ['Accept: text/markdown', thin]]) {
      assert.equal(res.status, 200, `${name} (redirect:${redirect})`);
      assert.equal(res.headers.get('x-card-handle'), 'a', `${name} (redirect:${redirect})`);
    }
    assert.ok((await fat.text()).includes('Alpha card'));
    // never: the canonical host (page or markdown), a non-card path, an icon, an unbound host
    const none = [
      await visit(env, 'card.feelreef.com', '/b'), await visit(env, 'card.feelreef.com', '/a.md'),
      await visit(env, X, '/no-such-path'), await visit(env, X, '/favicon.ico'), await visit(env, 'unbound.example', '/'),
    ];
    for (const res of none) assert.equal(res.headers.get('x-card-handle'), null, `${res.status} ${res.url}`);
  }
});

test('🔴 a stored pointer outside the handle grammar is no binding: the host answers as unbound, without throwing', async () => {
  for (const bad of ['bad\nhandle', '楓葉', 'Upper', '']) {
    // a body under that very key too (a hand-written row), so only the grammar check stands between it and the header
    const env = envWith({ a: A_CARD, [vanityKey(X)]: bad, [bad]: A_CARD });
    for (const path of ['/', '/index.md']) {
      const res = await visit(env, X, path);
      assert.equal(res.status, 404, JSON.stringify(bad));
      assert.equal(res.headers.get('x-card-handle'), null);
    }
  }
  // CONTROL: a valid one binds
  assert.equal(await servedBy(envWith({ a: A_CARD, [vanityKey(X)]: 'a' }), X), 'a');
});

test('🔴 a pointer for a platform host or an IP is never read: the fallback origin keeps routing by path, with no X-Card-Handle', async () => {
  const env = envWith({ a: A_CARD, b: B_CARD, [vanityKey('saas.feelreef.com')]: 'b', [vanityKey('10.0.0.1')]: 'b' });
  const root = await visit(env, 'saas.feelreef.com', '/');
  assert.equal(root.headers.get('x-card-handle'), null);
  assert.notEqual(root.status, 200, 'the SaaS fallback origin answered as b\'s domain');
  const byPath = await visit(env, 'saas.feelreef.com', '/a');
  assert.equal(byPath.status, 200);
  assert.ok((await byPath.text()).includes('Alpha card'));
  assert.equal(byPath.headers.get('x-card-handle'), null);
  const ip = await visit(env, '10.0.0.1', '/');
  assert.equal(ip.status, 404);
  assert.equal(ip.headers.get('x-card-handle'), null);
});

test('🔴 the domain asked for is the URL\'s: a Host header that disagrees is ignored', async () => {
  const env = envWith();
  await vput(env, { host: X, redirect: false });
  // the canonical URL with a creator's Host: still the canonical host (b's page by path, no header)
  const canon = await worker.fetch(new Request('https://card.feelreef.com/b', { headers: { host: X } }), env);
  assert.equal(canon.status, 200);
  assert.ok((await canon.text()).includes('Bravo card'));
  assert.equal(canon.headers.get('x-card-handle'), null);
  // a creator's URL with the canonical Host: still the creator's domain
  const own = await worker.fetch(new Request(`https://${X}/`, { headers: { host: 'card.feelreef.com' } }), env);
  assert.equal(own.headers.get('x-card-handle'), 'a');
});

test('/_icon/ with a broken escape is a 400, not a URIError', async () => {
  const env = envWith();
  for (const p of ['/_icon/%.ico', '/_icon/%E0%A4.ico', '/_icon/%zz.ico']) {
    const res = await visit(env, 'card.feelreef.com', p);
    assert.equal(res.status, 400, p);
  }
});

test('request values are type-checked before use: a non-string is skipped or refused, never String()ed', async () => {
  const env = envWith();
  const evil = { toString: null };
  const list = await api(env, 'POST', '/_api/cards', { handles: [evil, 'a'] });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.cards.map((c) => c.handle), ['a']);
  assert.equal((await api(env, 'POST', '/_api/preview', { handle: evil, markdown: A_CARD })).status, 400);
  assert.equal((await api(env, 'PUT', '/_api/card/a/asset/pic', { base64: evil })).status, 400);
  assert.equal((await api(env, 'PUT', '/_api/card/a/asset/pic', { base64: 'R0lG', mime: evil })).status, 400);
  assert.equal((await api(env, 'PUT', '/_api/card/a', { markdown: A_CARD, base_version: evil })).status, 400);
  assert.equal((await api(env, 'PUT', '/_api/card/a', { markdown: A_CARD, base_version: 7 })).status, 400);
  // CONTROL: the same calls with strings are not refused for their type
  assert.equal((await api(env, 'POST', '/_api/preview', { handle: 'a', markdown: A_CARD })).status, 200);
});

test('broken percent-encoding on the API\'s paths is a 400, not a URIError', async () => {
  const env = envWith();
  for (const p of ['/_api/card/%E0%A4', '/_api/card/a/asset/%zz', '/_api/card/%/asset/pic', '/_api/try/%']) {
    assert.equal((await api(env, 'GET', p)).status, 400, p);
  }
});

test('anything thrown inside the API is a plain 500 internal_error, without its message', async () => {
  const env = envWith();
  env.CARDS.get = async () => { throw new Error('secret-store-detail'); };
  const res = await worker.fetch(new Request('https://card.feelreef.com/_api/vanity/a', { headers: { authorization: `Bearer ${TOKEN}` } }), env);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: 'internal_error' });
  assert.ok(!text.includes('secret'));
});
