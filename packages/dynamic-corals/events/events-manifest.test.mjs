// Focused coverage for events/manifest.json itself — not the schema function in the abstract
// (manifest-schema.test.mjs already covers that with synthetic data), but the real, checked-in
// manifest this coral ships, at its own current stored identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCoralManifest, CORAL_MANIFEST_HARD_FIELDS } from '../manifest-schema.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));

test('events manifest.json passes validateCoralManifest at its own stored identity', () => {
  const result = validateCoralManifest(manifest, { name: 'events', version });
  assert.deepEqual(result, { ok: true, missing: [], mismatches: [] });
});

test('events manifest.json carries every CORAL_MANIFEST_HARD_FIELDS key', () => {
  for (const field of CORAL_MANIFEST_HARD_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, field), `missing ${field}`);
  }
});

test('events manifest.json declares no module requirement and no money/site-write capability', () => {
  // The current client (events-client.mjs) checks no module gate and makes exactly one GET fetch —
  // no purchase flow, no site mutation. A future source change that adds one of those should also
  // change this manifest, which this assertion exists to force.
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.stores, ['none']);
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(manifest.paid, false);
});
