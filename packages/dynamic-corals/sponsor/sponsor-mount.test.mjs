// REEF with Sponsor — the mount, driven the way a visitor drives it.
//   run: node packages/dynamic-corals/sponsor/sponsor-mount.test.mjs
//
// This file exists for ONE sentence in the plan (feelreef 金流表面主線 D23): a URL may prefill the
// amount and may never be the source of the amount that is charged. Asserting that on the parsing
// function alone would prove nothing — the bug it guards against is a wiring bug, three lines
// further on, where somebody reaches for the value they already parsed instead of the one in the
// box. So the real `mountSponsor` is mounted, the field is edited the way a visitor edits it, the
// button is pressed, and the assertion is on what left over the wire.
//
// The DOM is fake-dom.mjs, and the CONTROL tests below are what make it evidence rather than
// decoration: the same fixture is handed a mount that deliberately does the wrong thing, and it
// must catch it.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mountSponsor,
  buildSponsorRequest,
  readPrefillAmount,
  resetStyleInjectionForTests,
  SPONSOR_PATH,
  UNMOUNTED_ATTR,
} from './sponsor-core.mjs';
import { fakeDocument, fakeWindow, fakeFetch } from './fake-dom.mjs';

const LINK = 'https://pay.example/session/abc';
const ORIGIN = 'https://rsp.example';

function mount(attrs, opts) {
  const o = opts || {};
  const document = fakeDocument();
  const window = fakeWindow({ search: o.search || '' });
  const fetch = fakeFetch(o.response === undefined ? { json: { url: LINK } } : o.response);
  const el = document.createElement('div');
  el.setAttribute('data-dynamic-coral', 'sponsor');
  el.setAttribute('data-guild-id', 'g1');
  // The backend origin is stated here for the same reason a real site states it: the coral has no
  // default to fall back to, so a mount that does not name one refuses to mount at all. The tests
  // that assert THAT are below; every other test in this file needs a block that works.
  el.setAttribute('data-api-base', ORIGIN);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  const parts = mountSponsor(el, { document, window, fetch });
  return { el, parts, document, window, fetch };
}

/** A form submit — what pressing the button does in a browser. Returns when the work is done. */
function press(parts) {
  return Promise.all(parts.root.dispatchEvent('submit'));
}

// ── it renders the thing a cta section cannot ──────────────────────────────────────────────────

test('mounting puts an amount field on the page', () => {
  const { el, parts } = mount({ 'data-presets': '100,300,500', 'data-title': '請我喝杯咖啡' });
  assert.equal(el.children.length, 1, 'the block is appended into the container');
  assert.equal(parts.input.getAttribute('inputmode'), 'decimal');
  assert.equal(parts.presets.length, 3);
  assert.ok(el.textContent.includes('請我喝杯咖啡'));
  assert.ok(el.textContent.includes('TWD 100'), 'the suggested amounts are visible, with a currency');
});

test('the styles arrive with the block, themed off the host\'s tokens', () => {
  resetStyleInjectionForTests();
  const { document } = mount({});
  const style = document.head.children[0];
  assert.equal(style.tagName, 'STYLE');
  assert.equal(style.getAttribute('data-dc'), 'sponsor');
  assert.ok(style.textContent.includes('var(--gd-accent'), 'the host decides the colour, not the coral');
});

test('a container with no seller degrades honestly instead of showing a dead button', () => {
  const document = fakeDocument();
  const el = document.createElement('div');
  const parts = mountSponsor(el, { document, window: fakeWindow(), fetch: fakeFetch({}) });
  assert.equal(parts, null);
  assert.ok(el.textContent.includes('not set up'));
  assert.equal(el.find((n) => n.tagName === 'INPUT'), null, 'no field, because there is nowhere to send it');
});

test('🔴 a container with a seller but no backend origin refuses, and names what is missing', () => {
  // The alternative this replaces: mount the block, let the visitor type an amount, press the
  // button, and POST to a fabricated origin that 404s. That failure is indistinguishable from a
  // backend outage on the visitor's screen and invisible to whoever shipped the page, so the
  // block refuses up front and says which attribute would fix it.
  const document = fakeDocument();
  const el = document.createElement('div');
  el.setAttribute('data-guild-id', 'g1');            // somebody to pay…
  const fetch = fakeFetch({ json: { url: LINK } });  // …and a backend that WOULD have answered
  const parts = mountSponsor(el, { document, window: fakeWindow(), fetch });

  assert.equal(parts, null, 'nothing is mounted');
  assert.equal(el.find((n) => n.tagName === 'INPUT'), null, 'no field');
  assert.equal(el.find((n) => n.tagName === 'BUTTON'), null, 'and no button to press');
  assert.equal(fetch.calls.length, 0, 'and not one request at an address nobody chose');
  assert.equal(el.getAttribute(UNMOUNTED_ATTR), 'data-api-base',
    'the container says which attribute is absent, so the owner is not left guessing');
  assert.ok(el.textContent.includes('not set up'));
});

test('🔴 CONTROL: the same fixture mounts and sends once the origin IS named', async () => {
  // Without this, the refusal above would read the same as a coral that never works at all.
  const { parts, fetch } = mount({});
  assert.notEqual(parts, null);
  parts.input.value = '500';
  await press(parts);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, ORIGIN + SPONSOR_PATH);
});

test('the two ways to be unset are told apart, never collapsed into one', () => {
  // Two guards sharing one marker are one guard as far as a test can see, and they send the owner
  // to different attributes, so each has a case that only it can produce.
  const refusalFor = (attrs) => {
    const document = fakeDocument();
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const parts = mountSponsor(el, { document, window: fakeWindow(), fetch: fakeFetch({}) });
    assert.equal(parts, null);
    return el.getAttribute(UNMOUNTED_ATTR);
  };
  assert.equal(refusalFor({ 'data-api-base': ORIGIN }), 'data-guild-id', 'a backend and no seller');
  assert.equal(refusalFor({ 'data-guild-id': 'g1' }), 'data-api-base', 'a seller and no backend');
  assert.equal(refusalFor({}), 'data-guild-id', 'neither: the first thing to fix');
});

// ── the deep link ──────────────────────────────────────────────────────────────────────────────

test('a shared link prefills the field', () => {
  const { parts } = mount({}, { search: '?amount=500' });
  assert.equal(parts.input.value, '500');
});

test('the page\'s own default fills the field when the link says nothing', () => {
  const { parts } = mount({ 'data-default-amount': '300' });
  assert.equal(parts.input.value, '300');
});

test('a link beats the owner\'s default, for the PREFILL only', () => {
  const { parts } = mount({ 'data-default-amount': '300' }, { search: '?amount=500' });
  assert.equal(parts.input.value, '500');
});

test('a link carrying nonsense leaves the field alone', () => {
  assert.equal(mount({}, { search: '?amount=abc' }).parts.input.value, '');
  assert.equal(mount({ 'data-default-amount': '300' }, { search: '?amount=-1' }).parts.input.value, '300',
    'and falls back to the default the owner chose');
});

// ── 🔴 the invariant ───────────────────────────────────────────────────────────────────────────

test('🔴 the URL prefills the box; the BOX decides what is sent', async () => {
  const { parts, fetch } = mount({}, { search: '?amount=500' });
  assert.equal(parts.input.value, '500', 'the link had its one effect');

  // …and now the visitor types over it, which is the entire point of a prefilled field.
  parts.input.value = '120';
  parts.input.dispatchEvent('input');
  await press(parts);

  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].body.amount, '120', 'what was in the box, not what was in the link');
  assert.notEqual(fetch.calls[0].body.amount, '500');
});

test('🔴 CONTROL: the same fixture CATCHES a mount that trusts the URL at submit time', async () => {
  // The bug this file exists for, written out and run through the identical harness. If this ever
  // stops sending 500, the test above has stopped being able to tell the two apart.
  const window = fakeWindow({ search: '?amount=500' });
  const fetch = fakeFetch({ json: { url: LINK } });
  const input = { value: '120' };
  const fromUrl = readPrefillAmount(window.location.search, 'amount');
  const buggyBody = buildSponsorRequest({
    guildId: 'g1',
    // the mistake: reaching for the value already parsed instead of the one in the box
    amount: fromUrl || input.value,
    currency: 'TWD',
    clientRequestRef: 'ref',
  });
  await fetch('https://feelreef.com' + SPONSOR_PATH, { method: 'POST', body: JSON.stringify(buggyBody) });
  assert.equal(fetch.calls[0].body.amount, '500',
    'the control must reproduce the bug — otherwise the assertion above proves nothing');
});

test('🔴 a second press after editing again sends the NEW value, not the first one', async () => {
  const { parts, fetch } = mount({}, { search: '?amount=500', response: { ok: false, status: 502 } });
  parts.input.value = '120';
  await press(parts);
  parts.input.value = '80';
  await press(parts);
  assert.deepEqual(fetch.calls.map((c) => c.body.amount), ['120', '80']);
  assert.notEqual(fetch.calls[0].body.client_request_ref, fetch.calls[1].body.client_request_ref,
    'a different amount is a different intent, so it gets its own token');
});

test('a retry of the SAME amount reuses the token, so a lost response cannot mint two', async () => {
  const { parts, fetch } = mount({}, { response: { ok: false, status: 502 } });
  parts.input.value = '250';
  await press(parts);
  await press(parts);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].body.client_request_ref, fetch.calls[1].body.client_request_ref);
});

// ── the rest of the interaction ────────────────────────────────────────────────────────────────

test('a suggested amount fills the field, and the field is still the thing that is sent', async () => {
  const { parts, fetch } = mount({ 'data-presets': '100,300,500' }, { search: '?amount=500' });
  parts.presets[1].click();
  assert.equal(parts.input.value, '300');
  assert.equal(parts.presets[1].getAttribute('aria-pressed'), 'true');
  assert.equal(parts.presets[2].getAttribute('aria-pressed'), 'false');
  await press(parts);
  assert.equal(fetch.calls[0].body.amount, '300');
});

test('an amount that is not an amount never reaches the wire', async () => {
  const { parts, fetch } = mount({});
  for (const typed of ['', 'abc', '0', '-5', '1.005']) {
    parts.input.value = typed;
    await press(parts);
  }
  assert.equal(fetch.calls.length, 0, 'nothing was sent');
  assert.ok(parts.status.textContent.length > 0, 'and the visitor is told why');
  assert.equal(parts.submit.disabled, false, 'the button is still pressable');
});

test('an amount outside the page\'s range never reaches the wire either', async () => {
  const { parts, fetch } = mount({ 'data-min': '50', 'data-max': '5000' });
  parts.input.value = '10';
  await press(parts);
  parts.input.value = '99999';
  await press(parts);
  assert.equal(fetch.calls.length, 0);
});

test('what is sent is what the field shows — the two cannot tell different stories', async () => {
  const { parts, fetch } = mount({});
  parts.input.value = ' 1,500.50 ';
  await press(parts);
  assert.equal(fetch.calls[0].body.amount, '1500.5');
  assert.equal(parts.input.value, '1500.5', 'the box is rewritten to exactly what left');
});

test('the request goes to the feelreef backend, carrying the seller and a way back', async () => {
  const { parts, fetch } = mount({ 'data-api-base': 'https://rsp.example', 'data-currency': 'usd' });
  parts.input.value = '25';
  await press(parts);
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://rsp.example' + SPONSOR_PATH);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.body.guild_id, 'g1');
  assert.equal(call.body.currency, 'USD');
  assert.equal(call.body.redirect_url, 'https://site.example/support?dc_sponsor=done');
});

test('a link the backend hands back is followed; that is the only navigation this coral does', async () => {
  const { parts, window } = mount({});
  parts.input.value = '500';
  await press(parts);
  assert.deepEqual(window.navigations, [LINK]);
});

test('a backend that cannot answer leaves an honest failure and a pressable button', async () => {
  for (const response of [{ ok: false, status: 500 }, { json: {} }, new Error('offline')]) {
    const { parts, window } = mount({}, { response });
    parts.input.value = '500';
    await press(parts);
    assert.deepEqual(window.navigations, [], 'nowhere to go, so nobody is sent anywhere');
    assert.equal(parts.submit.disabled, false);
    assert.ok(parts.status.textContent.includes('try again'));
    assert.equal(parts.submit.textContent, 'Sponsor', 'the button says what it said before');
  }
});

test('403 checkout-not-activated shows its plain sentence and restores the button', async () => {
  const { parts, window } = mount({}, {
    response: { ok: false, status: 403, json: { error: 'checkout_module_not_activated' } },
  });
  parts.input.value = '500';
  await press(parts);

  assert.deepEqual(window.navigations, []);
  assert.equal(parts.status.textContent, "This site hasn't turned on payments yet.");
  assert.equal(parts.submit.disabled, false);
  assert.equal(parts.submit.textContent, 'Sponsor');
});

test('checkout-not-activated sentence is configurable without changing other failures', async () => {
  const custom = '這個網站還沒開通收款';
  const notActivated = mount({ 'data-not-activated-label': custom }, {
    response: { ok: false, status: 403, json: { error: 'checkout_module_not_activated' } },
  });
  notActivated.parts.input.value = '500';
  await press(notActivated.parts);
  assert.equal(notActivated.parts.status.textContent, custom);

  for (const response of [
    { ok: false, status: 403, json: { error: 'something_else' } },
    { ok: false, status: 404, json: { error: 'checkout_module_not_activated' } },
    { ok: false, status: 500, json: { error: 'checkout_module_not_activated' } },
  ]) {
    const generic = mount({ 'data-error-label': 'generic failure' }, { response });
    generic.parts.input.value = '500';
    await press(generic.parts);
    assert.equal(generic.parts.status.textContent, 'generic failure');
    assert.equal(generic.parts.submit.disabled, false);
  }
});

test('CONTROL: the failure test can tell success from failure', async () => {
  const { parts, window } = mount({});
  parts.input.value = '500';
  await press(parts);
  assert.equal(window.navigations.length, 1, 'the same harness DOES navigate when the backend answers');
});
