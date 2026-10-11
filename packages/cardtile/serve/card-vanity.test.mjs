// The vanity-binding API — a creator's own domain, bound to their card.  run: node --test card-vanity.test.mjs
//
// 🔴 Same discipline as card-api.test.mjs: every refusal is paired with the legitimate call it must
// not also refuse, so a 4xx here means "the guard fired" and not "the route is missing".
//
// The module is imported as a NAMESPACE on purpose. A named import of a function that does not exist
// yet fails the whole file at link time, which is red for a reason no single assertion owns; through
// the namespace each test fails on its own line.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as vanity from './card-vanity.mjs';

// ── the host grammar ─────────────────────────────────────────────────────────────────────────────

/** every host this file expects to be accepted — the property tests run over all of them. */
const ACCEPTED = ['creator.example', 'card.creator.example', 'a-b.example.co.uk', 'xn--fiqs8s.example',
  'xn--2qq421a.example', 'xn--bcher-kva.example', 'x1.example', 'notfeelreef.com', 'feelreef.com.example',
  '0x.example', `${'a'.repeat(63)}.example`];

test('vanityHost: an ordinary lowercase hostname is accepted as itself', () => {
  for (const h of ['creator.example', 'card.creator.example', 'a-b.example.co.uk', 'xn--fiqs8s.example', 'x1.example']) {
    assert.equal(vanity.vanityHost(h), h, h);
  }
});

test('🔴 vanityHost: uppercase is refused, not quietly lowercased', () => {
  // The worker lowercases the Host header before it reads `vanity:<host>`, so a key with a capital in
  // it is a binding nothing can ever reach. The contract says "lowercase hostname"; holding the caller
  // to it means the host they read back is byte-for-byte the host they sent.
  assert.equal(vanity.vanityHost('Creator.example'), null);
  assert.equal(vanity.vanityHost('creator.example'), 'creator.example'); // CONTROL
});

test('🔴 vanityHost: a port, a path, a scheme or a trailing dot is not a hostname', () => {
  for (const h of ['creator.example:8443', 'creator.example/card', 'https://creator.example',
    'creator.example.', 'creator.example?x=1', ' creator.example', 'creator.example ', 'user@creator.example']) {
    assert.equal(vanity.vanityHost(h), null, JSON.stringify(h));
  }
});

test('🔴 vanityHost: label grammar — empty labels, edge hyphens, over-long labels, single labels', () => {
  const long = 'a'.repeat(64);
  for (const h of ['creator..example', '.creator.example', '-creator.example', 'creator-.example',
    `${long}.example`, 'localhost', 'example', '', 'cre_ator.example']) {
    assert.equal(vanity.vanityHost(h), null, JSON.stringify(h));
  }
  // CONTROL: 63 is the limit, not 62 — the boundary itself is legal.
  assert.equal(vanity.vanityHost(`${'a'.repeat(63)}.example`), `${'a'.repeat(63)}.example`);
  // and the whole name is capped at 253
  const big = Array.from({ length: 4 }, () => 'b'.repeat(63)).join('.'); // 255
  assert.equal(vanity.vanityHost(big), null);
});

test('🔴 vanityHost: an IP address is not a creator\'s domain', () => {
  assert.equal(vanity.vanityHost('203.0.113.7'), null);
  assert.equal(vanity.vanityHost('[2001:db8::1]'), null);
});

test('🔴 vanityHost: a Unicode hostname must arrive as punycode', () => {
  // The Host header a browser sends for an IDN is the xn-- form, so that is the only form a key can
  // be reached under. A raw 中文 host stored as-is would be a binding no request ever matches.
  assert.equal(vanity.vanityHost('名片.example'), null);
  assert.equal(vanity.vanityHost('xn--2qq421a.example'), 'xn--2qq421a.example'); // CONTROL
});

test('🔴 vanityHost: nothing under feelreef.com — those hosts are ours, and routed already', () => {
  // card.feelreef.com is the canonical host (it never even reads a vanity key); saas.feelreef.com is
  // the Cloudflare-for-SaaS fallback origin every creator domain arrives through. Binding either
  // would turn platform plumbing into one creator's page.
  for (const h of ['feelreef.com', 'card.feelreef.com', 'saas.feelreef.com', 'x.y.feelreef.com']) {
    assert.equal(vanity.vanityHost(h), null, h);
  }
  // CONTROL: a name that merely ENDS in the same letters is somebody else's domain.
  assert.equal(vanity.vanityHost('notfeelreef.com'), 'notfeelreef.com');
  assert.equal(vanity.vanityHost('feelreef.com.example'), 'feelreef.com.example');
});

test('🔴 vanityHost: every OTHER spelling of an IPv4 address is refused — the URL parser turns them into one', () => {
  // A label grammar alone accepts these: no label is all digits. But every URL consumer (the worker's
  // own Response.redirect included) normalises them to a dotted quad, so a "host" like this would be
  // stored under one name and redirected to another — loopback, here.
  for (const h of ['127.0x1', '0x7f.0x0.0x0.0x1', '0x7f.0x1', '1.2.3.0x4', '0x7f000001.example.0x1']) {
    assert.equal(vanity.vanityHost(h), null, h);
  }
});

test('🔴 vanityHost: an A-label that is not valid punycode is refused; valid ones still pass', () => {
  for (const h of ['xn--a.example', 'xn--abc.example']) assert.equal(vanity.vanityHost(h), null, h);
  for (const h of ['xn--fiqs8s.example', 'xn--bcher-kva.example']) assert.equal(vanity.vanityHost(h), h, h); // CONTROL
});

test('🔴 vanityHost: whatever it accepts, the URL parser reads back as exactly the same name', () => {
  // The property the two tests above are instances of, run over every host this file accepts.
  for (const h of ACCEPTED) {
    assert.equal(vanity.vanityHost(h), h, h);
    assert.equal(new URL(`https://${h}/`).hostname, h, h);
  }
});

test('vanityHost: anything that is not a string is refused', () => {
  for (const h of [undefined, null, 42, {}, ['creator.example']]) assert.equal(vanity.vanityHost(h), null);
});

test('the two store keys are the ones the worker reads, and the record key is not one of them', () => {
  assert.equal(vanity.vanityKey('creator.example'), 'vanity:creator.example');
  assert.equal(vanity.vanityOfKey('maple'), 'vanityof:maple');
  assert.equal(vanity.vanityHostKey('maple'), 'vanityhost:maple');
  // `:` is outside the handle grammar, so none of the three can ever shadow a card's own key
  assert.ok(!vanity.vanityHostKey('maple').startsWith('vanity:'), 'the record would be read as a host binding');
});

// ── the API: /_api/vanity/<handle> ───────────────────────────────────────────────────────────────

import { handleApi, _internal } from './card-api.mjs';
import worker from './card-worker.mjs';

const TOKEN = 'vanity-test-bearer';
let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

const CARD = ['---', 'card-page: maple', 'title: Maple Bindery', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% hand-bound notebooks', ''].join('\n');
const OTHER = CARD.replace('Maple Bindery', 'Somebody Else').replace('card-page: maple', 'card-page: other');

/**
 * A KV double with the real binding's surface — get/put/delete, `null` for a missing key, deleting a
 * missing key is not an error — plus two things the real one cannot do on demand:
 *
 *   ops      every MUTATION, in order, so a test can assert what was written and in which order;
 *   failAt   throw on the Nth mutation (1-based), BEFORE it lands — a Worker that dies mid-sequence.
 *
 * It cannot model eventual consistency across edge locations; see the ordering note in card-vanity.mjs
 * for what the ordering does and does not buy because of that.
 */
const kv = (seed = {}, { failAt = 0, afterPut = null } = {}) => {
  const m = new Map(Object.entries(seed));
  let n = 0;
  const step = (op) => { n += 1; if (failAt && n === failAt) throw new Error(`injected failure at ${op}`); };
  return {
    _m: m,
    ops: [],
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) {
      step(`put ${k}`);
      if (typeof v !== 'string') throw new TypeError('KV values here are strings');
      m.set(k, v); this.ops.push(`put ${k}=${v}`);
      if (afterPut) afterPut(k, m);
    },
    async delete(k) { step(`delete ${k}`); m.delete(k); this.ops.push(`delete ${k}`); },
  };
};

const env = (store) => ({ CARDS: store, MCP_TOKEN_HASH: TOKEN_HASH });

const call = async (store, method, handle, body, { token = TOKEN, host = 'card.feelreef.com', raw = false } = {}) => {
  const url = new URL(`https://${host}/_api/vanity/${handle}`);
  const req = new Request(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  const res = await handleApi(req, env(store), url);
  return { status: res.status, body: await res.json() };
};

/** every host whose forward key points at `handle`. */
const hostsOf = (store, handle) => [...store._m].filter(([k, v]) => k.startsWith('vanity:') && v === handle).map(([k]) => k.slice(7));

/**
 * The two states a half-finished write must never leave, checked on whatever the store holds now:
 *
 *   I1  at most ONE host serves a card — two `vanity:*` keys naming it.
 *   I2  card.feelreef.com/<h> never sends anyone to a host that does not serve <h>.
 *
 * I2 is checked TWICE, on purpose: in the store (`vanityof:h = X` ⇒ `vanity:X = h`, which the write
 * order guarantees for ONE serialised caller on a store that shows it its own writes — the only
 * setting these tests model) and through the worker (which refuses the 301 unless both halves agree
 * locally — the guard for hand-written bindings). Either check alone would let the other mechanism
 * rot unnoticed. Concurrency and cross-location staleness are NOT modelled here and NOT claimed: the
 * caller serialises (card-vanity.mjs, file header).
 */
const assertInvariants = async (store, handle, label) => {
  assert.ok(hostsOf(store, handle).length <= 1, `${label}: two hosts serve "${handle}": ${hostsOf(store, handle)}`);
  const own = store._m.get(`vanityof:${handle}`);
  if (own) assert.equal(store._m.get(`vanity:${own}`), handle, `${label}: the store says "${handle}" redirects to ${own}, which does not serve it`);
  const canon = await worker.fetch(new Request(`https://card.feelreef.com/${handle}`, { redirect: 'manual' }), env(store));
  if (canon.status === 301) {
    const to = new URL(canon.headers.get('location'));
    const there = await worker.fetch(new Request(to), env(store));
    assert.equal(there.status, 200, `${label}: card.feelreef.com/${handle} 301s to ${to.host}, which answers ${there.status}`);
    assert.equal(store._m.get(`vanity:${to.host}`), handle, `${label}: ${to.host} serves another card`);
  } else {
    assert.equal(canon.status, 200, `${label}: the canonical URL answers ${canon.status}`);
  }
};

/**
 * Kill the Worker before each write of `send` in turn, check both invariants on what was left, then
 * send the same call again on a healthy store and compare with `final`. Runs until a pass where the
 * injected failure is never reached — so the loop covers every step whatever the step count is, and
 * a change that adds a step is covered without anyone updating a number.
 */
const crashEveryStep = async (seed, send, final, handle = 'maple') => {
  let k = 1;
  for (;; k++) {
    const store = kv(seed, { failAt: k });
    let died = false;
    try { await send(store); } catch (e) { if (!/injected failure/.test(e.message)) throw e; died = true; }
    if (!died) break;
    await assertInvariants(store, handle, `died at write ${k}`);
    const healthy = kv(Object.fromEntries(store._m));
    const r = await send(healthy);
    assert.equal(r.status, 200, `retry after write ${k}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(Object.fromEntries(healthy._m), final, `retry after write ${k}`);
    await assertInvariants(healthy, handle, `retry after write ${k}`);
  }
  assert.ok(k > 1, 'the call made no writes at all — the crash loop tested nothing');
  return k - 1;
};

/** the three keys of one binding, as the API writes them. */
const bound = (handle, host, { redirect = true } = {}) => ({
  [`vanity:${host}`]: handle,
  [`vanityhost:${handle}`]: host,
  ...(redirect ? { [`vanityof:${handle}`]: host } : {}),
});

const visit = (store, href, init) => worker.fetch(new Request(href, init), env(store));

// ── the door ──

test('🔴 vanity API: no bearer / wrong bearer → 401, and nothing is written', async () => {
  const store = kv({ maple: CARD });
  assert.equal((await call(store, 'PUT', 'maple', { host: 'creator.example' }, { token: null })).status, 401);
  assert.equal((await call(store, 'PUT', 'maple', { host: 'creator.example' }, { token: 'wrong' })).status, 401);
  assert.deepEqual(store.ops, []);
  // CONTROL: the real bearer gets through, so the 401s were the guard and not a missing route.
  assert.equal((await call(store, 'PUT', 'maple', { host: 'creator.example' })).status, 200);
});

test('🔴 vanity API: a handle outside the card grammar is 400 handle_invalid — 中文, too — and touches nothing', async () => {
  const store = kv({ maple: CARD });
  for (const h of [encodeURIComponent('楓葉'), '%E0%A4', 'a_b', '-maple', encodeURIComponent('maple:x')]) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await call(store, method, h, method === 'PUT' ? { host: 'creator.example' } : undefined);
      assert.equal(r.status, 400, `${method} ${h}`);
      assert.deepEqual(r.body, { error: 'handle_invalid' }, `${method} ${h}`);
    }
  }
  assert.deepEqual(store.ops, []);
});

test('vanity API: other methods → 405', async () => {
  const r = await call(kv({ maple: CARD }), 'POST', 'maple', { host: 'creator.example' });
  assert.equal(r.status, 405);
});

// ── GET ──

test('GET /_api/vanity/<h>: bound → host + redirect; unbound → null; no card → 404 card_not_found', async () => {
  const store = kv({ maple: CARD, other: OTHER, third: OTHER, ...bound('maple', 'creator.example'),
    ...bound('other', 'quiet.example', { redirect: false }) });
  assert.deepEqual(await call(store, 'GET', 'maple'), { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: true } });
  assert.deepEqual(await call(store, 'GET', 'other'), { status: 200, body: { handle: 'other', host: 'quiet.example', redirect: false } });
  assert.deepEqual(await call(store, 'GET', 'third'), { status: 200, body: { handle: 'third', host: null, redirect: false } });
  assert.deepEqual(await call(store, 'GET', 'nobody'), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(store.ops, []);
});

test('🔴 GET: a binding made before this API (vanity: + vanityof:, no vanityhost:) reads as bound and redirecting', async () => {
  const store = kv({ maple: CARD, 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' });
  assert.deepEqual(await call(store, 'GET', 'maple'), { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: true } });
  assert.deepEqual(store.ops, [], 'a GET wrote');
});

test('🔴 GET: a record whose host does not serve the card is NOT reported as bound', async () => {
  // what a 409 lost race or a Worker that died mid-rebind can leave: `vanityhost:` names a host whose
  // `vanity:` key is gone or belongs to someone else. GET answers what a visitor would get.
  for (const forward of [undefined, 'other']) {
    const seed = { maple: CARD, other: OTHER, 'vanityhost:maple': 'creator.example' };
    if (forward) seed['vanity:creator.example'] = forward;
    assert.deepEqual(await call(kv(seed), 'GET', 'maple'), { status: 200, body: { handle: 'maple', host: null, redirect: false } }, `forward ${forward}`);
  }
});

// ── PUT ──

test('PUT: a fresh binding writes all three keys, redirects by default, and says changed', async () => {
  const store = kv({ maple: CARD });
  const r = await call(store, 'PUT', 'maple', { host: 'creator.example' });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: true, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD, ...bound('maple', 'creator.example') });
});

test('🔴 PUT redirect:false: the domain serves the card, and the canonical URL does NOT 301 to it', async () => {
  const store = kv({ maple: CARD });
  const r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect: false });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: false, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD, ...bound('maple', 'creator.example', { redirect: false }) });
  assert.equal((await visit(store, 'https://creator.example/')).status, 200);
  assert.equal((await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' })).status, 200);
});

test('🔴 PUT: false → true on the same host writes ONLY vanityof: (changed); true → false removes only it', async () => {
  const store = kv({ maple: CARD, ...bound('maple', 'creator.example', { redirect: false }) });
  const up = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect: true });
  assert.deepEqual(up, { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: true, changed: true } });
  assert.deepEqual(store.ops, ['put vanityof:maple=creator.example']);
  const canon = await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' });
  assert.equal(canon.status, 301);
  assert.equal(canon.headers.get('location'), 'https://creator.example/');

  // and back: the request says what the binding should BE, so redirect:false turns the 301 off
  store.ops.length = 0;
  const down = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect: false });
  assert.deepEqual(down, { status: 200, body: { handle: 'maple', host: 'creator.example', redirect: false, changed: true } });
  assert.deepEqual(store.ops, ['delete vanityof:maple']);
  assert.equal((await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' })).status, 200);
  assert.equal((await visit(store, 'https://creator.example/')).status, 200);
});

test('🔴 PUT: the same binding sent twice is a no-op the second time — changed:false, zero writes, both modes', async () => {
  for (const redirect of [true, false]) {
    const store = kv({ maple: CARD });
    await call(store, 'PUT', 'maple', { host: 'creator.example', redirect });
    const before = store.ops.length;
    const r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect });
    assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'creator.example', redirect, changed: false } });
    assert.equal(store.ops.length, before, `a repeat wrote: ${store.ops.slice(before)}`);
  }
});

test('🔴 PUT: `redirect` that is not a boolean → 400 vanity_redirect_invalid, nothing written', async () => {
  const store = kv({ maple: CARD });
  for (const redirect of ['false', 0, 1, null, 'yes']) {
    const r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect });
    assert.deepEqual(r, { status: 400, body: { error: 'vanity_redirect_invalid' } }, JSON.stringify(redirect));
  }
  assert.deepEqual(store.ops, []);
});

test('🔴 PUT: a host bound to ANOTHER card → 409 vanity_taken, nothing written, and the owner is not named', async () => {
  for (const redirect of [true, false]) {
    const seed = { maple: CARD, other: OTHER, ...bound('other', 'creator.example', { redirect }) };
    const store = kv(seed);
    const r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect });
    assert.deepEqual(r, { status: 409, body: { error: 'vanity_taken' } });
    assert.deepEqual(store.ops, []);
    assert.deepEqual(Object.fromEntries(store._m), seed);
    // CONTROL: a different host for the same card is fine — the 409 was about the host, not the card.
    assert.equal((await call(store, 'PUT', 'maple', { host: 'creator2.example', redirect })).status, 200);
  }
});

test('🔴 PUT: no such card → 404 card_not_found, nothing written', async () => {
  const store = kv({ maple: CARD });
  assert.deepEqual(await call(store, 'PUT', 'nobody', { host: 'creator.example' }), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(await call(store, 'PUT', 'nobody', { host: 'creator.example', redirect: false }), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(store.ops, []);
});

test('🔴 PUT: a bad host → 400 vanity_host_invalid, nothing written — including no body at all', async () => {
  const store = kv({ maple: CARD });
  for (const body of [{ host: 'Creator.example' }, { host: 'creator.example:443' }, { host: 'https://creator.example/' },
    { host: 'card.feelreef.com' }, { host: 'saas.feelreef.com' }, { host: '名片.example' }, {}, { host: 7 }, null,
    { host: 'Creator.example', redirect: false }]) {
    const r = await call(store, 'PUT', 'maple', body);
    assert.deepEqual(r, { status: 400, body: { error: 'vanity_host_invalid' } }, JSON.stringify(body));
  }
  const notJson = await call(store, 'PUT', 'maple', 'creator.example', { raw: true });
  assert.deepEqual(notJson, { status: 400, body: { error: 'vanity_host_invalid' } });
  assert.deepEqual(store.ops, []);
});

test('🔴 PUT: rebinding moves the card — the old host lets go first, the redirect is withdrawn first and pointed last', async () => {
  const store = kv({ maple: CARD, ...bound('maple', 'old.example') });
  const r = await call(store, 'PUT', 'maple', { host: 'new.example' });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'new.example', redirect: true, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD, ...bound('maple', 'new.example') });
  assert.deepEqual(store.ops, [
    'delete vanityof:maple',
    'delete vanity:old.example',
    'put vanityhost:maple=new.example',
    'put vanity:new.example=maple',
    'put vanityof:maple=new.example',
  ]);
});

test('🔴 PUT redirect:false onto a NEW host also clears the old redirect — no 301 to the domain it just left', async () => {
  const store = kv({ maple: CARD, ...bound('maple', 'old.example') });
  const r = await call(store, 'PUT', 'maple', { host: 'new.example', redirect: false });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'new.example', redirect: false, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD, ...bound('maple', 'new.example', { redirect: false }) });
  assert.equal((await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' })).status, 200);
  assert.equal((await visit(store, 'https://old.example/')).status, 404);
});

test('🔴 PUT: a binding made before this API (no vanityhost:) is rebound cleanly — its record is written first', async () => {
  const store = kv({ maple: CARD, 'vanity:old.example': 'maple', 'vanityof:maple': 'old.example' });
  assert.equal((await call(store, 'PUT', 'maple', { host: 'new.example' })).status, 200);
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD, ...bound('maple', 'new.example') });
  assert.equal(store.ops[0], 'put vanityhost:maple=old.example', 'the old host must be recorded before vanityof: is withdrawn');
});

test('🔴 PUT: rebinding never deletes a forward key that points at somebody else', async () => {
  // A store a hand-run write left inconsistent: maple thinks it lives on old.example, but old.example
  // now belongs to `other`. Moving maple must not take other's domain down with it.
  const store = kv({ maple: CARD, other: OTHER, ...bound('other', 'old.example'), 'vanityof:maple': 'old.example', 'vanityhost:maple': 'old.example' });
  assert.equal((await call(store, 'PUT', 'maple', { host: 'new.example' })).status, 200);
  assert.equal(store._m.get('vanity:old.example'), 'other');
  assert.equal(store._m.get('vanityof:other'), 'old.example');
});

test('🔴 PUT: a Worker that dies at ANY write leaves no forbidden state, and the same PUT again finishes — every mode and starting point', async () => {
  const cases = [
    ['rebind, redirect on', bound('maple', 'old.example'), { host: 'new.example' }, bound('maple', 'new.example')],
    ['rebind, redirect off', bound('maple', 'old.example'), { host: 'new.example', redirect: false }, bound('maple', 'new.example', { redirect: false })],
    ['rebind from an unredirected binding', bound('maple', 'old.example', { redirect: false }), { host: 'new.example' }, bound('maple', 'new.example')],
    ['rebind a pre-API binding', { 'vanity:old.example': 'maple', 'vanityof:maple': 'old.example' }, { host: 'new.example' }, bound('maple', 'new.example')],
    ['fresh, redirect off', {}, { host: 'new.example', redirect: false }, bound('maple', 'new.example', { redirect: false })],
    ['turn the redirect on', bound('maple', 'new.example', { redirect: false }), { host: 'new.example', redirect: true }, bound('maple', 'new.example')],
    ['turn the redirect off', bound('maple', 'new.example'), { host: 'new.example', redirect: false }, bound('maple', 'new.example', { redirect: false })],
  ];
  for (const [label, seed, body, final] of cases) {
    const writes = await crashEveryStep({ maple: CARD, ...seed }, (s) => call(s, 'PUT', 'maple', body), { maple: CARD, ...final });
    assert.ok(writes >= 1, label);
  }
});

test('🔴 PUT: losing a race for the host is a 409, the loser never points its redirect at the winner, and drops its record', async () => {
  // Two binds for one host, interleaved: ours writes `vanity:<host>`, the other lands right after it.
  // The read-back sees the other handle, so we stop before `vanityof:` — otherwise maple's canonical
  // URL would 301 to a domain that serves somebody else's card.
  const store = kv({ maple: CARD, other: OTHER }, {
    afterPut: (k, m) => { if (k === 'vanity:contested.example') m.set(k, 'other'); },
  });
  const r = await call(store, 'PUT', 'maple', { host: 'contested.example' });
  assert.deepEqual(r, { status: 409, body: { error: 'vanity_taken' } });
  assert.equal(store._m.has('vanityof:maple'), false);
  assert.equal(store._m.has('vanityhost:maple'), false);
  await assertInvariants(store, 'maple', 'race');
  assert.deepEqual((await call(store, 'GET', 'maple')).body, { handle: 'maple', host: null, redirect: false });
});

// ── DELETE ──

test('DELETE: removes every key of the binding, either mode, and says changed; unbound → changed:false, zero writes', async () => {
  for (const seed of [bound('maple', 'creator.example'), bound('maple', 'creator.example', { redirect: false }),
    { 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' }]) {
    const store = kv({ maple: CARD, ...seed });
    assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: true } });
    assert.deepEqual(Object.fromEntries(store._m), { maple: CARD }, JSON.stringify(seed));
    const n = store.ops.length;
    assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: false } });
    assert.equal(store.ops.length, n);
  }
});

test('🔴 DELETE: `vanity:<host>` is removed only while it still points at this card', async () => {
  const store = kv({ maple: CARD, other: OTHER, ...bound('other', 'old.example'), 'vanityof:maple': 'old.example', 'vanityhost:maple': 'old.example' });
  assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: true } });
  assert.equal(store._m.get('vanity:old.example'), 'other');
  assert.equal(store._m.has('vanityof:maple'), false);
  assert.equal(store._m.has('vanityhost:maple'), false);
});

test('DELETE: a binding whose card is gone can still be removed — cleanup never needs the card', async () => {
  const store = kv({ ...bound('gone', 'creator.example') });
  assert.deepEqual(await call(store, 'DELETE', 'gone'), { status: 200, body: { handle: 'gone', host: null, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), {});
});

test('🔴 DELETE: a Worker that dies at any write leaves no forbidden state, and a retry finishes — every starting point', async () => {
  for (const seed of [bound('maple', 'creator.example'), bound('maple', 'creator.example', { redirect: false }),
    { 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' }]) {
    await crashEveryStep({ maple: CARD, ...seed }, (s) => call(s, 'DELETE', 'maple'), { maple: CARD });
  }
});

// ── through the worker: what a visitor sees after each call ──

const viaWorker = (store, method, handle, body, host = 'card.feelreef.com') => visit(store, `https://${host}/_api/vanity/${handle}`, {
  method,
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('🔴 end to end, in the runbook\'s order: bind without redirect → DNS → redirect on → rebind → unbind', async () => {
  const store = kv({ maple: CARD });
  // before: the creator's apex is the directory — the scar CUSTOM-DOMAIN.md is about
  assert.equal((await visit(store, 'https://creator.example/')).status, 404);

  // certificate active, DNS not moved yet: bind WITHOUT the redirect. The canonical URL must keep
  // answering — a 301 now would send it to a domain that does not reach us yet.
  assert.equal((await viaWorker(store, 'PUT', 'maple', { host: 'creator.example', redirect: false })).status, 200);
  assert.equal((await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' })).status, 200);
  const apex = await visit(store, 'https://creator.example/');
  assert.equal(apex.status, 200, 'the moment DNS points here, the apex must already be the card');
  assert.match(await apex.text(), /<title>Maple Bindery<\/title>/);

  // hostname active: turn the redirect on
  assert.equal((await viaWorker(store, 'PUT', 'maple', { host: 'creator.example', redirect: true })).status, 200);
  const canon = await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' });
  assert.equal(canon.status, 301);
  assert.equal(canon.headers.get('location'), 'https://creator.example/');

  assert.equal((await viaWorker(store, 'PUT', 'maple', { host: 'creator2.example' })).status, 200);
  assert.equal((await visit(store, 'https://creator.example/')).status, 404, 'the old domain still serves the card');
  assert.equal((await visit(store, 'https://creator2.example/')).status, 200);

  assert.equal((await viaWorker(store, 'DELETE', 'maple')).status, 200);
  assert.equal((await visit(store, 'https://creator2.example/')).status, 404);
  assert.equal((await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' })).status, 200);
});

test('🔴 every host the API accepts is redirected to under exactly that name, and never throws', async () => {
  for (const h of ACCEPTED) {
    const store = kv({ maple: CARD });
    assert.equal((await call(store, 'PUT', 'maple', { host: h })).status, 200, h);
    const canon = await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' });
    assert.equal(canon.status, 301, h);
    assert.equal(new URL(canon.headers.get('location')).hostname, h, h);
  }
});

test('🔴 a hand-written vanityof: the API would refuse is never followed — no throw, no 301 elsewhere', async () => {
  // Keys written before this API, by hand, never went through vanityHost. The worker must not turn
  // one into an exception (an invalid A-label throws inside Response.redirect) or a 301 to loopback.
  for (const h of ['xn--a.example', '127.0x1', '0x7f.0x0.0x0.0x1', 'Creator.example', 'creator.example/x']) {
    const store = kv({ maple: CARD, [`vanity:${h}`]: 'maple', [`vanityof:maple`]: h });
    const res = await visit(store, 'https://card.feelreef.com/maple', { redirect: 'manual' });
    assert.equal(res.status, 200, h);
  }
});

// ── expect: the caller's view of the binding, checked before anything is written ──

test('🔴 PUT/DELETE with a matching `expect` go ahead; without `expect` they behave as before', async () => {
  const store = kv({ maple: CARD });
  let r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect: false, expect: { host: null, redirect: false } });
  assert.deepEqual(r.body, { handle: 'maple', host: 'creator.example', redirect: false, changed: true });
  r = await call(store, 'PUT', 'maple', { host: 'creator.example', redirect: true, expect: { host: 'creator.example', redirect: false } });
  assert.equal(r.status, 200);
  r = await call(store, 'DELETE', 'maple', { expect: { host: 'creator.example', redirect: true } });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: null, changed: true } });
});

test('🔴 PUT/DELETE whose `expect` no longer matches → 409 vanity_state_changed, nothing written', async () => {
  const seed = { maple: CARD, ...bound('maple', 'creator.example', { redirect: false }) };
  const stale = [{ host: null, redirect: false }, { host: 'creator.example', redirect: true }, { host: 'old.example', redirect: false }];
  for (const expect of stale) {
    const store = kv(seed);
    assert.deepEqual(await call(store, 'PUT', 'maple', { host: 'new.example', expect }), { status: 409, body: { error: 'vanity_state_changed' } }, JSON.stringify(expect));
    assert.deepEqual(await call(store, 'DELETE', 'maple', { expect }), { status: 409, body: { error: 'vanity_state_changed' } }, JSON.stringify(expect));
    assert.deepEqual(store.ops, []);
    assert.deepEqual(Object.fromEntries(store._m), seed);
  }
});

test('🔴 `expect` is compared with what GET reports — a dangling record is "unbound"', async () => {
  // A record whose host does not serve the card reads as host:null on GET, so that is what a caller
  // who just read GET will send.
  const store = kv({ maple: CARD, 'vanityhost:maple': 'creator.example' });
  assert.equal((await call(store, 'PUT', 'maple', { host: 'new.example', expect: { host: null, redirect: false } })).status, 200);
});

test('🔴 a malformed `expect` → 400 vanity_expect_invalid, nothing written', async () => {
  const store = kv({ maple: CARD });
  for (const expect of [null, 'creator.example', {}, { host: 'creator.example' }, { redirect: false },
    { host: 7, redirect: false }, { host: 'creator.example', redirect: 'no' }]) {
    assert.deepEqual(await call(store, 'PUT', 'maple', { host: 'creator.example', expect }), { status: 400, body: { error: 'vanity_expect_invalid' } }, JSON.stringify(expect));
    assert.deepEqual(await call(store, 'DELETE', 'maple', { expect }), { status: 400, body: { error: 'vanity_expect_invalid' } }, JSON.stringify(expect));
  }
  assert.deepEqual(store.ops, []);
});

test('🔴 a DELETE with no body, or a body without `expect`, still works', async () => {
  const store = kv({ maple: CARD, ...bound('maple', 'creator.example') });
  assert.equal((await call(store, 'DELETE', 'maple', {})).status, 200);
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD });
});

// ── X-Card-Handle: how reef's probe tells "this domain answers with THIS card" ──

const asBrowser = { headers: { accept: 'text/html' } };

test('🔴 X-Card-Handle: a card served on its own domain names itself — before and after the redirect is on', async () => {
  for (const redirect of [false, true]) {
    const store = kv({ maple: CARD, other: OTHER });
    assert.equal((await call(store, 'PUT', 'maple', { host: 'creator.example', redirect })).status, 200);
    const res = await visit(store, 'https://creator.example/', asBrowser);
    assert.equal(res.status, 200, `redirect ${redirect}`);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('x-card-handle'), 'maple', `redirect ${redirect}`);
  }
});

test('🔴 X-Card-Handle names the card ACTUALLY served — a domain bound to another card says that card', async () => {
  const store = kv({ maple: CARD, other: OTHER, ...bound('other', 'creator.example', { redirect: false }) });
  const res = await visit(store, 'https://creator.example/', asBrowser);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-card-handle'), 'other');
  assert.match(await res.text(), /Somebody Else/);
});

test('🔴 X-Card-Handle is absent wherever the domain is NOT serving a card through its binding', async () => {
  const store = kv({ maple: CARD, ...bound('maple', 'creator.example', { redirect: false }), 'vanity:dangling.example': 'nobody' });
  const cases = [
    ['canonical, bound card without redirect', 'https://card.feelreef.com/maple', 200],
    ['canonical, unbound card', 'https://card.feelreef.com/maple', 200],
    ['an unbound host: the directory', 'https://unbound.example/', 404],
    ['a bound host, a path that is not the card', 'https://creator.example/nothing-here', 404],
    ['a host bound to a card that does not exist', 'https://dangling.example/', 404],
    ['the canonical directory', 'https://card.feelreef.com/', 404],
  ];
  for (const [label, href, status] of cases) {
    const target = label === 'canonical, unbound card' ? kv({ maple: CARD }) : store;
    const res = await visit(target, href, { ...asBrowser, redirect: 'manual' });
    assert.equal(res.status, status, label);
    assert.equal(res.headers.get('x-card-handle'), null, label);
  }
  // CONTROL: the same store, the card's own domain — the header is there, so its absence above is
  // the rule and not a header that never exists.
  assert.equal((await visit(store, 'https://creator.example/', asBrowser)).headers.get('x-card-handle'), 'maple');
});

test('🔴 the URL decides which domain was asked for — a disagreeing Host header is ignored', async () => {
  const store = kv({ alpha: CARD, beta: OTHER, ...bound('alpha', 'a.example'), ...bound('beta', 'b.example') });
  // canonical URL, a vanity Host header: still the canonical directory, and no card claims it
  const canon = await visit(store, 'https://card.feelreef.com/', { headers: { host: 'a.example', accept: 'text/html' } });
  assert.equal(canon.status, 404);
  assert.equal(canon.headers.get('x-card-handle'), null);
  // one vanity URL, another vanity Host header: the URL's card, and the URL's card's name
  const a = await visit(store, 'https://a.example/', { headers: { host: 'b.example', accept: 'text/html' } });
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('x-card-handle'), 'alpha');
  assert.match(await a.text(), /Maple Bindery/);
  // CONTROL: without the stray header, the same two requests answer the same way
  assert.equal((await visit(store, 'https://card.feelreef.com/', asBrowser)).status, 404);
  assert.equal((await visit(store, 'https://a.example/', asBrowser)).headers.get('x-card-handle'), 'alpha');
});

test('🔴 X-Card-Handle on the markdown exits: /index.md, /<handle>.md and Accept: text/markdown name the card they carry', async () => {
  const store = kv({ maple: CARD, other: OTHER, ...bound('maple', 'creator.example', { redirect: false }), ...bound('other', 'other.example', { redirect: false }) });
  const exits = [
    ['/index.md', {}],
    ['/maple.md', {}],
    ['/', { headers: { accept: 'text/markdown' } }],
  ];
  for (const [path, init] of exits) {
    const res = await visit(store, `https://creator.example${path}`, init);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/markdown/, path);
    assert.equal(res.headers.get('x-card-handle'), 'maple', path);
    assert.match(await res.text(), /Maple Bindery/, path);
  }
  // another card's own domain names THAT card on the same exits
  for (const [path, init] of [['/index.md', {}], ['/', { headers: { accept: 'text/markdown' } }]]) {
    const res = await visit(store, `https://other.example${path}`, init);
    assert.equal(res.headers.get('x-card-handle'), 'other', path);
    assert.match(await res.text(), /Somebody Else/, path);
  }
  // canonical markdown exits carry no header — the card was not reached through a domain
  for (const [path, init] of [['/maple.md', {}], ['/maple', { headers: { accept: 'text/markdown' } }]]) {
    const res = await visit(store, `https://card.feelreef.com${path}`, init);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('x-card-handle'), null, path);
  }
  // and asking maple's domain for another handle's file is not that card
  const foreign = await visit(store, 'https://creator.example/other.md');
  assert.equal(foreign.headers.get('x-card-handle'), null);
});

// ── a stored host the validator would refuse ──

test('🔴 GET does not report a stored host the API would refuse — it says host:null and invalid_host:true', async () => {
  for (const bad of ['xn--a.example', '127.0x1']) {
    for (const seed of [
      { 'vanityhost:maple': bad, 'vanityof:maple': bad, [`vanity:${bad}`]: 'maple' },   // API shape
      { 'vanityof:maple': bad, [`vanity:${bad}`]: 'maple' },                              // two-key legacy shape
    ]) {
      const store = kv({ maple: CARD, ...seed });
      assert.deepEqual(await call(store, 'GET', 'maple'),
        { status: 200, body: { handle: 'maple', host: null, redirect: false, invalid_host: true } }, `${bad} ${Object.keys(seed)}`);
      assert.deepEqual(store.ops, []);
    }
  }
  // CONTROL: a valid stored host is reported, and carries no invalid_host field at all
  const ok = kv({ maple: CARD, ...bound('maple', 'creator.example') });
  assert.deepEqual((await call(ok, 'GET', 'maple')).body, { handle: 'maple', host: 'creator.example', redirect: true });
});

test('🔴 an invalid stored host is cleaned by DELETE and by a PUT elsewhere, with expect taken from GET', async () => {
  for (const bad of ['xn--a.example', '127.0x1']) {
    const seed = { maple: CARD, 'vanityof:maple': bad, [`vanity:${bad}`]: 'maple' };
    const expect = { host: null, redirect: false };   // what GET said
    const del = kv(seed);
    assert.deepEqual(await call(del, 'DELETE', 'maple', { expect }), { status: 200, body: { handle: 'maple', host: null, changed: true } }, bad);
    assert.deepEqual(Object.fromEntries(del._m), { maple: CARD }, bad);
    const put = kv(seed);
    assert.equal((await call(put, 'PUT', 'maple', { host: 'creator.example', expect })).status, 200, bad);
    assert.deepEqual(Object.fromEntries(put._m), { maple: CARD, ...bound('maple', 'creator.example') }, bad);
    // and expect that names the bad host as if it were bound is stale: GET never said that
    assert.deepEqual(await call(kv(seed), 'PUT', 'maple', { host: 'creator.example', expect: { host: bad, redirect: true } }),
      { status: 409, body: { error: 'vanity_state_changed' } }, bad);
  }
});

test('🔴 the vanity API is host-agnostic: on a creator\'s domain it still acts on the handle in the PATH', async () => {
  // card-worker.mjs routes /_api/ before any host resolution. A creator domain bound to maple must not
  // turn `/_api/vanity/other` into an operation on maple.
  const store = kv({ maple: CARD, other: OTHER, ...bound('maple', 'creator.example') });
  const r = await viaWorker(store, 'PUT', 'other', { host: 'other.example' }, 'creator.example');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { handle: 'other', host: 'other.example', redirect: true, changed: true });
  assert.equal(store._m.get('vanityof:maple'), 'creator.example');
  // and it is just as gated there
  const naked = await visit(store, 'https://creator.example/_api/vanity/other');
  assert.equal(naked.status, 401);
});
