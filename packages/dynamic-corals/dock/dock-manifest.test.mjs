// dock/manifest.json, and the claims it makes about the shipped bytes.
//   run: node --test packages/dynamic-corals/dock/dock-manifest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCoralManifest } from '../manifest-schema.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
const bundle = readFileSync(join(DIR, 'dock.js'), 'utf8');
const code = bundle.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('dock manifest.json passes validateCoralManifest at its own stored identity', () => {
  assert.deepEqual(validateCoralManifest(manifest, { name: 'dock', version }), { ok: true, missing: [], mismatches: [] });
});

test('calls nothing, requires nothing; stores only the collapse mark in sessionStorage — and the bundle agrees', () => {
  assert.deepEqual(manifest.calls, []);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(manifest.stores.length, 1);
  assert.match(manifest.stores[0], /^browser sessionStorage/);
  for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'indexedDB', 'document.cookie']) {
    assert.equal(code.includes(api), false, `bundle uses ${api}`);
  }
  assert.match(code, /sessionStorage/);
});
