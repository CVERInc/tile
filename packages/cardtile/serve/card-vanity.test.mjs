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
