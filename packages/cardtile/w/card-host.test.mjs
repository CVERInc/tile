// reef#2725 r2 — the local editor and its dev server name the card host the deployment's switch
// names (CARD_CANONICAL_HOST), not a literal `card.feelreef.com`. Unset = today's bytes, pinned.
//   run: node --test packages/cardtile/w/card-host.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// namespaces, so a missing export goes red on its own assertion rather than as a link error
import * as E from './editor.mjs';
import * as SV from './serve.mjs';

const ON = { CARD_CANONICAL_HOST: 'reef.cards' };
const OFFS = [undefined, {}, { CARD_CANONICAL_HOST: '' }, { CARD_CANONICAL_HOST: 'card.feelreef.com' }, { CARD_CANONICAL_HOST: 'evil.example' }];

test('reef#2725 r2 ②: the editor reads a handle\'s public .md exit from the configured card host', () => {
  assert.equal(typeof E.cardExitOrigin, 'function', 'editor.mjs exports no cardExitOrigin');
  for (const env of OFFS) assert.equal(E.cardExitOrigin(undefined, env), 'https://card.feelreef.com', JSON.stringify(env));
  assert.equal(E.cardExitOrigin(undefined, ON), 'https://reef.cards');
  // `?from=` still wins over the switch, trailing slash trimmed as before
  assert.equal(E.cardExitOrigin('https://unreachable.invalid/', ON), 'https://unreachable.invalid');
});

test('reef#2725 r2 ②: serve.mjs derives its API base and card host from the switch; CARD_API_BASE still overrides the API', () => {
  assert.equal(typeof SV.cardHosts, 'function', 'serve.mjs exports no cardHosts');
  for (const env of OFFS) {
    assert.deepEqual(SV.cardHosts(env || {}), { cardHost: 'card.feelreef.com', api: 'https://card.feelreef.com' }, JSON.stringify(env));
  }
  assert.deepEqual(SV.cardHosts(ON), { cardHost: 'reef.cards', api: 'https://reef.cards' });
  assert.deepEqual(SV.cardHosts({ ...ON, CARD_API_BASE: 'https://staging.example' }), { cardHost: 'reef.cards', api: 'https://staging.example' });
});

// The wiring, end to end: a real serve.mjs process with the switch in its environment. The
// child can still use serve.mjs's Keychain fallback, so give it a PATH containing only a failing
// security stand-in. This also keeps a saved developer token from changing the probe's answer.
const SERVE = fileURLToPath(new URL('./serve.mjs', import.meta.url));
const NO_KEYCHAIN = fileURLToPath(new URL('./test-bin/', import.meta.url));
const PROBE = `
const { createServer } = await import(${JSON.stringify(SERVE)});
const srv = createServer().listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const canSave = await (await fetch(base + '/_w/can-save')).json();
  console.log(JSON.stringify({ canSave }));
  srv.close();
});`;
const probe = (extra) => new Promise((resolve, reject) => {
  execFile(process.execPath, ['--input-type=module', '-e', PROBE],
    { env: { PATH: NO_KEYCHAIN, HOME: NO_KEYCHAIN, CARD_API_TOKEN: '', ...extra }, timeout: 30000 },
    (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(JSON.parse(stdout.trim().split('\n').pop()))));
});

test('reef#2725 r2 ②: a running serve.mjs tells the editor the card host', async () => {
  const off = await probe({});
  assert.deepEqual(off.canSave, { canSave: false, api: 'https://card.feelreef.com', cardHost: 'card.feelreef.com' });
  const on = await probe(ON);
  assert.deepEqual(on.canSave, { canSave: false, api: 'https://reef.cards', cardHost: 'reef.cards' });
});
