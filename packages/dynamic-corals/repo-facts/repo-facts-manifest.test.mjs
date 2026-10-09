// Focused coverage for repo-facts/manifest.json itself — the real, checked-in manifest this coral
// ships, at its own current stored identity — and for the claims it makes about the shipped bytes.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-manifest.test.mjs
//
// The second half reads repo-facts.js, the BUILT bundle, not the source it was built from: a
// manifest describes what a browser downloads. (That the bundle is what the current source
// produces is ../generated-bundles.test.mjs's job, for every bundled coral at once.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCoralManifest, CORAL_MANIFEST_HARD_FIELDS } from '../manifest-schema.mjs';
import { CORALS } from '../corals.mjs';
import { PATH, SELECTOR, MARK, DIAGNOSTICS } from './repo-facts-core.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
const bundle = readFileSync(join(DIR, 'repo-facts.js'), 'utf8');
// What runs, without the comments: the stamp on the first line, and the module-name comments
// esbuild leaves in. A guard that matched its own explanation would not be a guard.
const code = bundle.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('repo-facts manifest.json passes validateCoralManifest at its own stored identity', () => {
  const result = validateCoralManifest(manifest, { name: 'repo-facts', version });
  assert.deepEqual(result, { ok: true, missing: [], mismatches: [] });
});

test('repo-facts manifest.json carries every CORAL_MANIFEST_HARD_FIELDS key', () => {
  for (const field of CORAL_MANIFEST_HARD_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, field), `missing ${field}`);
  }
});

test('repo-facts manifest.json declares no module requirement, no storage and no capability', () => {
  // The client makes one GET and writes text into the page it is on — no purchase flow, no site
  // mutation, nothing kept in the browser. A source change that adds one of those should also
  // change this manifest, which this assertion exists to force.
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.stores, ['none']);
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(manifest.paid, false);
  assert.equal(manifest.calls.length, 1);
});

test('build.mjs is the producer of this artifact — the coral is in its table, as a registry participant', () => {
  assert.deepEqual(CORALS['repo-facts'], { src: 'repo-facts-client.mjs', bundle: true, registry: true });
});

test('the bundle is the current source: it carries the literals esbuild cannot rename', () => {
  for (const literal of [PATH, SELECTOR, MARK, DIAGNOSTICS, 'data-api-base', 'data-scope', 'data-forge',
    '.st-item', '.st-item-meta-left', '.st-item-gh', 'st-item-updated', 'st-item-badge']) {
    assert.ok(bundle.includes(literal), `the bundle is missing ${literal} — it is STALE`);
  }
});

test('🔴 the budget: the whole artifact, stamp included, is at most 2 KB gzipped', () => {
  const size = gzipSync(Buffer.from(bundle), { level: 9 }).length;
  assert.ok(size <= 2048, `repo-facts.js is ${size} bytes gzipped; the budget is 2048`);
});

test('CONTROL: that ruler can say no — a neighbour built the same way is over this budget', () => {
  const events = readFileSync(join(DIR, '../events/events.js'), 'utf8');
  assert.ok(gzipSync(Buffer.from(events), { level: 9 }).length > 2048);
});

test('🔴 one request, to one route, with no cookies — as the manifest says', () => {
  assert.equal((code.match(/\bfetch\s*\(/g) || []).length, 1);
  assert.equal((code.match(/credentials:\s*"omit"/g) || []).length, 1);
  assert.equal((code.match(/redirect:\s*"error"/g) || []).length, 1, 'and it follows no redirect');
  for (const api of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'import(']) {
    assert.equal(code.includes(api), false, `the bundle reaches the network a second way: ${api}`);
  }
});

test('🔴 no origin is baked in: the page names the endpoint or nothing is asked', () => {
  // The forge's hostname is there — it is how a repository link is recognised — but as a bare
  // name to compare against, never as an address to call.
  assert.deepEqual(code.match(/https?:\/\/[^"'`\s\\]+/g) || [], []);
  assert.equal((code.match(/github\.com/g) || []).length, 1);
});

test('CONTROL: the origin check can see an origin when there is one', () => {
  assert.deepEqual('var base = "https://edge.example";'.match(/https?:\/\/[^"'`\s\\]+/g), ['https://edge.example']);
});

test('🔴 nothing is stored, and no markup is ever built from a string', () => {
  for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie',
    'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'DOMParser', 'eval(', 'Function(']) {
    assert.equal(code.includes(api), false, `the bundle uses ${api}`);
  }
  assert.ok(code.includes('textContent'), 'and it does write text, so the check above is not vacuous');
});

test('the test fixtures never ship', () => {
  for (const name of ['FakeElement', 'FakeText', 'parsePage', 'fakeFetch']) {
    assert.equal(bundle.includes(name), false, `${name} is a fixture and is not part of the coral`);
  }
});
