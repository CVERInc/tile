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

test('declares one conditional call, no storage, no requirement, no capability — and the bundle agrees', () => {
  assert.equal(manifest.calls.length, 1);
  assert.match(manifest.calls[0], /^GET <data-src> — only for a root that carries `data-src`/);
  assert.match(manifest.calls[0], /A root without `data-src` makes no network call at all/);
  assert.deepEqual(manifest.stores, ['none']);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.capabilities, []);
  for (const api of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.equal(code.includes(api), false, `bundle uses ${api}`);
  }
});

test('the bundle has exactly one place a request can leave from, and it is the data-src read', () => {
  // `fetch(` appears where the global is wrapped (twice on that line: the wrapper's own call) and
  // where the feed is read through `env.fetch(` — which is only reached from the data-src branch
  // (countdown-feed.test.mjs drives that: a typed-deadline root makes no request).
  const uses = code.split('\n').filter((l) => /\bfetch\(/.test(l));
  assert.equal(uses.length, 2, uses.join('\n'));
  assert.ok(uses.some((l) => /getAttribute\("data-src"\)/.test(l)), 'the request URL is the root’s data-src and nothing else');
  assert.equal((code.match(/getAttribute\("data-src"\)/g) || []).length, 2, 'data-src is read to branch and to fetch, nowhere else');
});

test('the bundle carries the shared card and the shared arithmetic (one copy, bundled in)', () => {
  assert.match(code, /dc-flip-on/);
  assert.match(code, /ISO_WITH_OFFSET|\(\?:Z\|\[\+-\]\\d\{2\}:\\d\{2\}\)/);
});
