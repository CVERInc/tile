import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCoralManifest } from './manifest-schema.mjs';

const valid = {
  name: 'sample', version: '1.2.3', author: 'A', license: 'MIT', source: 'https://example.test/a.js',
  requires: [], calls: [], stores: [], paid: false, funding: null, without: 'No fallback.', capabilities: [],
};

test('validator rejects a missing hard field', () => {
  const { calls, ...missingCalls } = valid;
  const result = validateCoralManifest(missingCalls, { name: 'sample', version: '1.2.3' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['calls']);
});

test('validator rejects name and version mismatches', () => {
  const result = validateCoralManifest(valid, { name: 'other', version: '9.9.9' });
  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 2);
});

test('validator accepts a complete manifest with matching identity', () => {
  assert.deepEqual(validateCoralManifest(valid, { name: 'sample', version: '1.2.3' }),
    { ok: true, missing: [], mismatches: [] });
});
