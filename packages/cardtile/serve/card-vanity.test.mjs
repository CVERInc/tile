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

test('vanityHost: anything that is not a string is refused', () => {
  for (const h of [undefined, null, 42, {}, ['creator.example']]) assert.equal(vanity.vanityHost(h), null);
});

test('the two store keys are the ones the worker reads', () => {
  assert.equal(vanity.vanityKey('creator.example'), 'vanity:creator.example');
  assert.equal(vanity.vanityOfKey('maple'), 'vanityof:maple');
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
 *   I1  at most ONE host serves a card — read off the store: two `vanity:*` keys naming it.
 *   I2  card.feelreef.com/<h> never sends anyone to a host that does not serve <h> — read off the
 *       WORKER, because that is where it is enforced. 🔴 Not off the store: card-vanity.mjs shows no
 *       single-key write order can keep `vanityof:` and `vanity:` in step AND stay retryable, so a
 *       dangling `vanityof:` exists for one store call during a rebind. What must hold is that no
 *       visitor is ever redirected by it — the worker checks both halves before it 301s.
 */
const assertInvariants = async (store, handle, label) => {
  assert.ok(hostsOf(store, handle).length <= 1, `${label}: two hosts serve "${handle}": ${hostsOf(store, handle)}`);
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

test('GET /_api/vanity/<h>: bound → its host; unbound → null; no card → 404 card_not_found', async () => {
  const store = kv({ maple: CARD, other: OTHER, 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' });
  assert.deepEqual(await call(store, 'GET', 'maple'), { status: 200, body: { handle: 'maple', host: 'creator.example' } });
  assert.deepEqual(await call(store, 'GET', 'other'), { status: 200, body: { handle: 'other', host: null } });
  assert.deepEqual(await call(store, 'GET', 'nobody'), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(store.ops, []);
});

// ── PUT ──

test('PUT: a fresh binding writes both keys and says changed', async () => {
  const store = kv({ maple: CARD });
  const r = await call(store, 'PUT', 'maple', { host: 'creator.example' });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'creator.example', changed: true } });
  assert.equal(store._m.get('vanity:creator.example'), 'maple');
  assert.equal(store._m.get('vanityof:maple'), 'creator.example');
});

test('🔴 PUT: the same binding sent twice is a no-op the second time — changed:false, zero writes', async () => {
  const store = kv({ maple: CARD });
  await call(store, 'PUT', 'maple', { host: 'creator.example' });
  const before = store.ops.length;
  const r = await call(store, 'PUT', 'maple', { host: 'creator.example' });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'creator.example', changed: false } });
  assert.equal(store.ops.length, before, `a repeat wrote: ${store.ops.slice(before)}`);
});

test('🔴 PUT: a host bound to ANOTHER card → 409 vanity_taken, nothing written, and the owner is not named', async () => {
  const seed = { maple: CARD, other: OTHER, 'vanity:creator.example': 'other', 'vanityof:other': 'creator.example' };
  const store = kv(seed);
  const r = await call(store, 'PUT', 'maple', { host: 'creator.example' });
  assert.deepEqual(r, { status: 409, body: { error: 'vanity_taken' } });
  assert.deepEqual(store.ops, []);
  assert.deepEqual(Object.fromEntries(store._m), seed);
  // CONTROL: a different host for the same card is fine — the 409 was about the host, not the card.
  assert.equal((await call(store, 'PUT', 'maple', { host: 'creator2.example' })).status, 200);
});

test('🔴 PUT: no such card → 404 card_not_found, nothing written', async () => {
  const store = kv({ maple: CARD });
  assert.deepEqual(await call(store, 'PUT', 'nobody', { host: 'creator.example' }), { status: 404, body: { error: 'card_not_found' } });
  assert.deepEqual(store.ops, []);
});

test('🔴 PUT: a bad host → 400 vanity_host_invalid, nothing written — including no body at all', async () => {
  const store = kv({ maple: CARD });
  for (const body of [{ host: 'Creator.example' }, { host: 'creator.example:443' }, { host: 'https://creator.example/' },
    { host: 'card.feelreef.com' }, { host: 'saas.feelreef.com' }, { host: '名片.example' }, {}, { host: 7 }, null]) {
    const r = await call(store, 'PUT', 'maple', body);
    assert.deepEqual(r, { status: 400, body: { error: 'vanity_host_invalid' } }, JSON.stringify(body));
  }
  const notJson = await call(store, 'PUT', 'maple', 'creator.example', { raw: true });
  assert.deepEqual(notJson, { status: 400, body: { error: 'vanity_host_invalid' } });
  assert.deepEqual(store.ops, []);
});

test('🔴 PUT: rebinding moves the card — the old host stops serving it, and the order is the documented one', async () => {
  const store = kv({ maple: CARD, 'vanity:old.example': 'maple', 'vanityof:maple': 'old.example' });
  const r = await call(store, 'PUT', 'maple', { host: 'new.example' });
  assert.deepEqual(r, { status: 200, body: { handle: 'maple', host: 'new.example', changed: true } });
  assert.equal(store._m.has('vanity:old.example'), false, 'the old host still serves the card');
  assert.equal(store._m.get('vanity:new.example'), 'maple');
  assert.equal(store._m.get('vanityof:maple'), 'new.example');
  assert.deepEqual(store.ops, [
    'delete vanity:old.example',
    'delete vanityof:maple',
    'put vanity:new.example=maple',
    'put vanityof:maple=new.example',
  ]);
});

test('🔴 PUT: rebinding never deletes a forward key that points at somebody else', async () => {
  // A store a hand-run write left inconsistent: maple thinks it lives on old.example, but old.example
  // now belongs to `other`. Moving maple must not take other's domain down with it.
  const store = kv({ maple: CARD, other: OTHER, 'vanity:old.example': 'other', 'vanityof:other': 'old.example', 'vanityof:maple': 'old.example' });
  assert.equal((await call(store, 'PUT', 'maple', { host: 'new.example' })).status, 200);
  assert.equal(store._m.get('vanity:old.example'), 'other');
  assert.equal(store._m.get('vanityof:other'), 'old.example');
});

test('🔴 PUT: a Worker that dies at ANY step of a rebind leaves no forbidden state — and a retry finishes the job', async () => {
  const seed = { maple: CARD, 'vanity:old.example': 'maple', 'vanityof:maple': 'old.example' };
  for (let k = 1; k <= 4; k++) {
    const store = kv(seed, { failAt: k });
    await assert.rejects(call(store, 'PUT', 'maple', { host: 'new.example' }), /injected failure/, `step ${k}`);
    await assertInvariants(store, 'maple', `died at step ${k}`);
    // the retry, on the same store, now healthy
    const healthy = kv(Object.fromEntries(store._m));
    const r = await call(healthy, 'PUT', 'maple', { host: 'new.example' });
    assert.equal(r.status, 200, `retry after step ${k}`);
    assert.deepEqual(Object.fromEntries(healthy._m),
      { maple: CARD, 'vanity:new.example': 'maple', 'vanityof:maple': 'new.example' }, `retry after step ${k}`);
  }
});

test('🔴 PUT: losing a race for the host is a 409, and the loser never points its redirect at the winner', async () => {
  // Two binds for one host, interleaved: ours writes `vanity:<host>`, the other lands right after it.
  // The read-back sees the other handle, so we stop before `vanityof:` — otherwise maple's canonical
  // URL would 301 to a domain that serves somebody else's card.
  const store = kv({ maple: CARD, other: OTHER }, {
    afterPut: (k, m) => { if (k === 'vanity:contested.example') m.set(k, 'other'); },
  });
  const r = await call(store, 'PUT', 'maple', { host: 'contested.example' });
  assert.deepEqual(r, { status: 409, body: { error: 'vanity_taken' } });
  assert.equal(store._m.has('vanityof:maple'), false);
  await assertInvariants(store, 'maple', 'race');
});

// ── DELETE ──

test('DELETE: removes both keys and says changed; unbound → changed:false with zero writes', async () => {
  const store = kv({ maple: CARD, 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' });
  assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), { maple: CARD });
  const n = store.ops.length;
  assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: false } });
  assert.equal(store.ops.length, n);
});

test('🔴 DELETE: `vanity:<host>` is removed only while it still points at this card', async () => {
  const store = kv({ maple: CARD, other: OTHER, 'vanity:old.example': 'other', 'vanityof:other': 'old.example', 'vanityof:maple': 'old.example' });
  assert.deepEqual(await call(store, 'DELETE', 'maple'), { status: 200, body: { handle: 'maple', host: null, changed: true } });
  assert.equal(store._m.get('vanity:old.example'), 'other');
  assert.equal(store._m.has('vanityof:maple'), false);
});

test('DELETE: a binding whose card is gone can still be removed — cleanup never needs the card', async () => {
  const store = kv({ 'vanity:creator.example': 'gone', 'vanityof:gone': 'creator.example' });
  assert.deepEqual(await call(store, 'DELETE', 'gone'), { status: 200, body: { handle: 'gone', host: null, changed: true } });
  assert.deepEqual(Object.fromEntries(store._m), {});
});

test('🔴 DELETE: a Worker that dies between the two deletes leaves no forbidden state, and a retry finishes', async () => {
  const seed = { maple: CARD, 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' };
  for (let k = 1; k <= 2; k++) {
    const store = kv(seed, { failAt: k });
    await assert.rejects(call(store, 'DELETE', 'maple'), /injected failure/);
    await assertInvariants(store, 'maple', `died at step ${k}`);
    const healthy = kv(Object.fromEntries(store._m));
    assert.equal((await call(healthy, 'DELETE', 'maple')).status, 200);
    assert.deepEqual(Object.fromEntries(healthy._m), { maple: CARD }, `retry after step ${k}`);
  }
});

// ── through the worker: what a visitor sees after each call ──

const visit = (store, href, init) => worker.fetch(new Request(href, init), env(store));
const viaWorker = (store, method, handle, body, host = 'card.feelreef.com') => visit(store, `https://${host}/_api/vanity/${handle}`, {
  method,
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('🔴 end to end: bind → the apex is the card and the canonical URL 301s there; rebind → the old apex lets go', async () => {
  const store = kv({ maple: CARD });
  // before: the creator's apex is the directory — the scar CUSTOM-DOMAIN.md is about
  assert.equal((await visit(store, 'https://creator.example/')).status, 404);

  assert.equal((await viaWorker(store, 'PUT', 'maple', { host: 'creator.example' })).status, 200);
  const apex = await visit(store, 'https://creator.example/');
  assert.equal(apex.status, 200);
  assert.match(await apex.text(), /<title>Maple Bindery<\/title>/);
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

test('🔴 the vanity API is host-agnostic: on a creator\'s domain it still acts on the handle in the PATH', async () => {
  // card-worker.mjs routes /_api/ before any host resolution. A creator domain bound to maple must not
  // turn `/_api/vanity/other` into an operation on maple.
  const store = kv({ maple: CARD, other: OTHER, 'vanity:creator.example': 'maple', 'vanityof:maple': 'creator.example' });
  const r = await viaWorker(store, 'PUT', 'other', { host: 'other.example' }, 'creator.example');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { handle: 'other', host: 'other.example', changed: true });
  assert.equal(store._m.get('vanityof:maple'), 'creator.example');
  // and it is just as gated there
  const naked = await visit(store, 'https://creator.example/_api/vanity/other');
  assert.equal(naked.status, 401);
});
