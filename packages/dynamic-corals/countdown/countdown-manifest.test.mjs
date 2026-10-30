// countdown/manifest.json, and the claims it makes about the shipped bytes.
//   run: node --test packages/dynamic-corals/countdown/countdown-manifest.test.mjs
//
// The second half reads countdown.js, the BUILT bundle: a manifest describes what a browser
// downloads. (That the bundle is what the current source produces is ../generated-bundles.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCoralManifest } from '../manifest-schema.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
const bundle = readFileSync(join(DIR, 'countdown.js'), 'utf8');
const code = bundle.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('countdown manifest.json passes validateCoralManifest at its own stored identity', () => {
  assert.deepEqual(validateCoralManifest(manifest, { name: 'countdown', version }), { ok: true, missing: [], mismatches: [] });
});

test('declares no call, no storage, no requirement, no capability — and the bundle agrees', () => {
  assert.deepEqual(manifest.calls, []);
  assert.deepEqual(manifest.stores, ['none']);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.capabilities, []);
  for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.equal(code.includes(api), false, `bundle uses ${api}`);
  }
});

test('the bundle carries the shared card and the shared arithmetic (one copy, bundled in)', () => {
  assert.match(code, /dc-flip-on/);
  assert.match(code, /ISO_WITH_OFFSET|\(\?:Z\|\[\+-\]\\d\{2\}:\\d\{2\}\)/);
});
