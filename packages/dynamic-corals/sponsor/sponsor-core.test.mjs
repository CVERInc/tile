// REEF with Sponsor — model tests (plain node, zero framework).
//   run: node packages/dynamic-corals/sponsor/sponsor-core.test.mjs
//
// The amount is the only value this coral has, so most of what is here is about the one function
// that decides what an amount IS. The behaviour that matters most — that a URL can prefill the
// field and can never decide what is sent — is exercised end to end in sponsor-mount.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAmount,
  readPrefillAmount,
  parsePresets,
  buildSponsorRequest,
  requestRefFor,
  readConfig,
  renderSponsor,
  SPONSOR_PATH,
} from './sponsor-core.mjs';
import { fakeDocument } from './fake-dom.mjs';

// ── amounts ────────────────────────────────────────────────────────────────────────────────────

test('an amount is canonicalised, not merely accepted', () => {
  assert.deepEqual(normalizeAmount('500'), { ok: true, amount: '500', hundredths: 50000 });
  assert.equal(normalizeAmount('  500  ').amount, '500', 'surrounding space is typing');
  assert.equal(normalizeAmount('1,000').amount, '1000', 'a thousands separator is typing');
  assert.equal(normalizeAmount('0500').amount, '500', 'leading zeros are not a different number');
  assert.equal(normalizeAmount('12.50').amount, '12.5');
  assert.equal(normalizeAmount('12.').amount, '12');
  // Sub-unit amounts need a page that allows them: the default floor is 1, because a 0.5 TWD
  // sponsorship is a typo everywhere it is not a card-testing bot.
  assert.equal(normalizeAmount('.5', { min: '0.01' }).amount, '0.5');
});

test('the comparison is exact where a float would not be', () => {
  // 0.1 * 100 is 10.000000000000002 in binary floating point. This one is not.
  const cents = { min: '0.01' };
  assert.equal(normalizeAmount('0.1', cents).hundredths, 10);
  assert.equal(normalizeAmount('0.07', cents).hundredths, 7);
  assert.equal(normalizeAmount('999999.99').hundredths, 99999999);
});

test('what is not an amount says WHY it is not', () => {
  const reason = (raw, opts) => normalizeAmount(raw, opts).reason;
  assert.equal(reason(''), 'empty');
  assert.equal(reason(null), 'empty');
  assert.equal(reason('.'), 'not_a_number');
  assert.equal(reason('abc'), 'not_a_number');
  assert.equal(reason('-5'), 'not_a_number', 'a negative sponsorship is a refund request');
  assert.equal(reason('1e5'), 'not_a_number', 'exponent notation is somebody probing');
  assert.equal(reason('0x20'), 'not_a_number');
  assert.equal(reason('5.001'), 'too_many_decimals', 'money is not silently rounded here');
  assert.equal(reason('0'), 'zero');
  assert.equal(reason('0.00'), 'zero');
  assert.equal(reason('5', { min: '100' }), 'below_min');
  assert.equal(reason('100000000', { max: '1000' }), 'above_max');
  assert.equal(reason('9'.repeat(40)), 'not_a_number', 'a 40-digit URL is not a sponsorship');
});

test('bounds are read from the page, and an unreadable bound falls back rather than off', () => {
  assert.equal(normalizeAmount('50', { min: '100' }).ok, false);
  assert.equal(normalizeAmount('50', { min: 'lots' }).ok, true, 'a broken min uses the default, not "no min"');
  assert.equal(normalizeAmount('0.5', { min: 'lots' }).ok, false, 'and the default min (1) still applies');
});

// ── the deep link ──────────────────────────────────────────────────────────────────────────────

test('a shared link prefills the field', () => {
  assert.equal(readPrefillAmount('?amount=500', 'amount'), '500');
  assert.equal(readPrefillAmount('amount=500', 'amount'), '500', 'with or without the leading ?');
  assert.equal(readPrefillAmount('?give=300', 'give'), '300', 'the parameter name is the page\'s choice');
});

test('a link that carries nonsense prefills NOTHING — it is never clamped into a number', () => {
  for (const search of ['?amount=abc', '?amount=-5', '?amount=0', '?amount=<script>', '?amount=' + '9'.repeat(40)]) {
    assert.equal(readPrefillAmount(search, 'amount'), null, `${search} should not prefill`);
  }
  assert.equal(readPrefillAmount('?amount=99999999', 'amount', { max: '1000' }), null,
    'over the ceiling is not silently turned into the ceiling — nobody chose that figure');
  assert.equal(readPrefillAmount('?nothing=1', 'amount'), null);
});

test('presets are the owner\'s list, in the owner\'s order, minus what cannot be read', () => {
  assert.deepEqual(parsePresets('100,300,500'), ['100', '300', '500']);
  assert.deepEqual(parsePresets('100, 300 ,abc,300,0'), ['100', '300'], 'junk and duplicates drop out');
  assert.deepEqual(parsePresets(''), []);
  assert.deepEqual(parsePresets(null), []);
});

// ── the wire ───────────────────────────────────────────────────────────────────────────────────

test('the request body is the shape the backend baton reads', () => {
  const body = buildSponsorRequest({
    guildId: 'g1', amount: '500', currency: 'TWD',
    redirectUrl: 'https://site.example/thanks?dc_sponsor=done', clientRequestRef: 'ref-1',
  });
  assert.deepEqual(body, {
    guild_id: 'g1',
    amount: '500',
    currency: 'TWD',
    redirect_url: 'https://site.example/thanks?dc_sponsor=done',
    client_request_ref: 'ref-1',
  });
  assert.equal(SPONSOR_PATH, '/api/v2/shop/sponsor');
});

test('the amount travels as a decimal string in MAJOR units, with its currency beside it', () => {
  const body = buildSponsorRequest({ guildId: 'g1', amount: '500', currency: 'TWD', clientRequestRef: 'r' });
  // 🔴 The guard is against a browser-side ×100. TWD has no minor unit, so a coral that "helpfully"
  // sent 50000 would be asking for a hundred times the money on every zero-decimal currency.
  assert.equal(body.amount, '500');
  assert.equal(typeof body.amount, 'string');
  assert.equal(body.currency, 'TWD');
  assert.equal('amount_minor' in body, false, 'the browser does not know the rail\'s exponent');
  assert.equal(JSON.parse(JSON.stringify(body)).redirect_url, undefined, 'an absent return URL is absent');
});

test('the idempotency token is stable per amount and distinct across amounts', () => {
  const refs = new Map();
  const first = requestRefFor(refs, '500');
  assert.equal(requestRefFor(refs, '500'), first, 'a retry asks for the SAME link');
  assert.notEqual(requestRefFor(refs, '1000'), first, 'a different amount is a different intent');
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

// ── configuration and markup ───────────────────────────────────────────────────────────────────

function container(attrs) {
  const doc = fakeDocument();
  const el = doc.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return { doc, el };
}

test('config is read entirely from data-* attributes, with honest defaults', () => {
  const { el } = container({ 'data-guild-id': 'g1' });
  const cfg = readConfig(el);
  assert.equal(cfg.guildId, 'g1');
  assert.equal(cfg.currency, 'TWD');
  assert.equal(cfg.currencyLabel, 'TWD', 'no symbol table is invented for a currency code');
  assert.deepEqual(cfg.presets, []);
  assert.equal(cfg.amountParam, 'amount');
  assert.equal(cfg.apiBase, '',
    'the honest default for "where do I send the money" is nowhere — no origin is invented');
});

test('🔴 an origin is only ever the one the page named', () => {
  // The value that used to sit here — https://feelreef.com — is answered by nothing: the front
  // door names no /api/v2/shop route, and the backend the fallthrough reaches has no sponsor one.
  // A mount that cannot name its backend must not manufacture a plausible-looking address for it.
  const { el } = container({ 'data-guild-id': 'g1' });
  assert.equal(readConfig(el).apiBase, '');
  // CONTROL: the same reader DOES yield an origin when the page supplies one — without this, the
  // assertion above would also hold for a function that returned '' no matter what it was given.
  const named = container({ 'data-guild-id': 'g1', 'data-api-base': 'https://rsp.example' });
  assert.equal(readConfig(named.el).apiBase, 'https://rsp.example');
});

test('a trailing slash on the origin is typing, not a different backend', () => {
  // With no fallback left, this attribute is the only source of the origin, so a stray slash would
  // double itself into every request the site makes.
  const { el } = container({ 'data-guild-id': 'g1', 'data-api-base': '  https://rsp.example/  ' });
  assert.equal(readConfig(el).apiBase, 'https://rsp.example');
});

test('a page passes its own currency, presets, bounds, parameter name and copy', () => {
  const { el } = container({
    'data-guild-id': 'g1', 'data-currency': 'usd', 'data-currency-symbol': '$',
    'data-presets': '5,10,25', 'data-min': '5', 'data-max': '100',
    'data-amount-param': 'give', 'data-submit-label': '贊助',
  });
  const cfg = readConfig(el);
  assert.equal(cfg.currency, 'USD', 'the code is normalised, the visible symbol is not');
  assert.equal(cfg.currencyLabel, '$');
  assert.deepEqual(cfg.presets, ['5', '10', '25']);
  assert.equal(cfg.amountParam, 'give');
  assert.equal(cfg.labels.submit, '贊助');
  assert.equal(normalizeAmount('200', cfg.bounds).reason, 'above_max', 'the page\'s ceiling is in force');
});

test('the block renders an amount field — the thing a cta section cannot grow', () => {
  const { doc, el } = container({ 'data-guild-id': 'g1', 'data-presets': '100,300', 'data-title': 'Buy me a coffee' });
  const parts = renderSponsor(doc, readConfig(el));
  assert.equal(parts.input.tagName, 'INPUT');
  assert.equal(parts.input.getAttribute('type'), 'text');
  assert.equal(parts.input.getAttribute('inputmode'), 'decimal',
    'a number spinner rounds and steps behind your back, and this is money');
  assert.equal(parts.input.getAttribute('name'), 'amount');
  assert.equal(parts.presets.length, 2, 'suggested amounts are buttons, not prose');
  assert.equal(parts.presets[0].getAttribute('data-amount'), '100');
  assert.equal(parts.submit.getAttribute('type'), 'submit');
  assert.ok(parts.root.textContent.includes('Buy me a coffee'));
});

test('the field has a name a screen reader can read, and the status is announced', () => {
  const { doc, el } = container({ 'data-guild-id': 'g1', 'data-amount-label': '金額' });
  const parts = renderSponsor(doc, readConfig(el));
  const id = parts.input.getAttribute('id');
  const label = parts.root.find((n) => n.tagName === 'LABEL');
  assert.ok(id, 'the field has an id to point a label at');
  assert.equal(label.getAttribute('for'), id);
  assert.equal(label.textContent, '金額');
  assert.equal(parts.status.getAttribute('role'), 'status');
  assert.equal(parts.status.getAttribute('aria-live'), 'polite');
});

test('the owner\'s own strings can never become markup', () => {
  const { doc, el } = container({ 'data-guild-id': 'g1', 'data-title': '<img src=x onerror=alert(1)>' });
  const parts = renderSponsor(doc, readConfig(el));
  const title = parts.root.find((n) => n.className === 'dc-sponsor-title');
  // It is TEXT on a node, so there is no parse step for it to escape from.
  assert.equal(title.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(title.children.length, 0);
});

test('two mounts on one page do not share a field id', () => {
  const { doc, el } = container({ 'data-guild-id': 'g1' });
  const a = renderSponsor(doc, readConfig(el));
  const b = renderSponsor(doc, readConfig(el));
  assert.notEqual(a.input.getAttribute('id'), b.input.getAttribute('id'));
});
