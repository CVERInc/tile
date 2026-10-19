import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CORALS } from './corals.mjs';
import { expectedReadme, renderMetadata } from './catalog-readme.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('every coral has complete catalog metadata and a matching README', () => {
  assert.ok(Object.keys(CORALS).length > 0, 'catalog census is empty');
  for (const name of Object.keys(CORALS)) {
    const dir = join(HERE, name);
    let metadata;
    try { metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8')); }
    catch { assert.fail(`${name}: missing or invalid metadata.json`); }
    assert.equal(metadata.id, name, `${name}: id must match coral name`);
    assert.equal(metadata.author, 'official', `${name}: author must be official`);
    assert.ok(typeof metadata.summary === 'string' && metadata.summary.trim(), `${name}: summary required`);
    assert.ok(typeof metadata.embed === 'string' && metadata.embed.includes(`data-dynamic-coral="${name}"`), `${name}: embed required`);
    assert.ok(Array.isArray(metadata.attributes) && metadata.attributes.length, `${name}: attributes required`);
    const names = new Set();
    for (const attribute of metadata.attributes) {
      assert.match(attribute.name, /^data-[a-z][a-z-]*$/, `${name}: invalid attribute name`);
      assert.ok(!names.has(attribute.name), `${name}: duplicate ${attribute.name}`);
      names.add(attribute.name);
      assert.ok(['string', 'number', 'boolean', 'url', 'enum'].includes(attribute.type), `${name}: ${attribute.name} type required`);
      assert.equal(typeof attribute.required, 'boolean', `${name}: ${attribute.name} required flag missing`);
      assert.ok(Object.hasOwn(attribute, 'default'), `${name}: ${attribute.name} default missing`);
      assert.ok(typeof attribute.description === 'string' && attribute.description.trim(), `${name}: ${attribute.name} description required`);
      if (attribute.required) assert.equal(attribute.default, null, `${name}: ${attribute.name} required attribute has a default`);
    }
    assert.ok(names.has('data-dynamic-coral'), `${name}: selector attribute missing`);
    for (const [, attribute] of metadata.embed.matchAll(/\s(data-[a-z][a-z-]*)=/g)) {
      assert.ok(names.has(attribute), `${name}: embed uses undocumented ${attribute}`);
    }
    for (const attribute of metadata.attributes.filter((item) => item.required && item.name !== 'data-drawer-panel')) {
      assert.ok(metadata.embed.includes(`${attribute.name}=`), `${name}: embed omits required ${attribute.name}`);
    }
    let readme;
    try { readme = readFileSync(join(dir, 'README.md'), 'utf8'); }
    catch { assert.fail(`${name}: README.md missing`); }
    assert.ok(readme.includes(renderMetadata(name, metadata)), `${name}: README metadata drift`);
    assert.equal(readme, expectedReadme(name, metadata, readme), `${name}: README metadata drift`);
  }
});

test('README drift check rejects changed metadata prose', () => {
  const metadata = { author: 'official', summary: 'Current description.', embed: '<div data-dynamic-coral="probe"></div>', attributes: [] };
  const current = renderMetadata('probe', metadata).replace('Current description.', 'Old description.');
  assert.notEqual(current, expectedReadme('probe', metadata, current));
});
