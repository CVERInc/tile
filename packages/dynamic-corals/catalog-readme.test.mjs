import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CORALS } from './corals.mjs';
import { attributeReads, sourceFor, INTERNAL, DYNAMIC_NAMES } from './catalog-source.mjs';
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

for (const [name, coral] of Object.entries(CORALS)) {
  test(`${name}: metadata matches runtime attribute reads`, () => {
    const metadata = JSON.parse(readFileSync(join(HERE, name, 'metadata.json')));
    const reads = attributeReads(sourceFor(join(HERE, name, coral.src)));
    for (const [attribute, reason] of Object.entries(DYNAMIC_NAMES[name] || {})) {
      assert.ok(reason.trim(), `${name}: dynamic name needs a reason`);
      assert.ok(reads.has(attribute), `${name}: stale dynamic allow-list entry ${attribute}`);
    }
    const documented = new Set(metadata.attributes.map(a => a.name));
    for (const attribute of reads) assert.ok(documented.has(attribute) || INTERNAL[attribute], `${name}: source reads undocumented ${attribute}`);
    for (const attribute of documented) assert.ok(reads.has(attribute) || attribute === 'data-dynamic-coral', `${name}: metadata documents unread ${attribute}`);
  });
}

const metadataFor = name => JSON.parse(readFileSync(join(HERE, name, 'metadata.json')));
const attributeFor = (name, attribute) => metadataFor(name).attributes.find(a => a.name === `data-${attribute}`);
const checks = [
  ['square-shop cart modes', () => assert.deepEqual(attributeFor('square-shop', 'cart').values, ['1', 'header'])],
  ['square-shop source origin default', () => assert.equal(attributeFor('square-shop', 'api-base').default, '')],
  ['square-shop shipping scope', () => assert.match(attributeFor('square-shop', 'collect-shipping').description, /cart mode only/i)],
  ['square-shop JPY scope', () => assert.match(attributeFor('square-shop', 'subtotal-label').description, /JPY total row/)],
  ['square-shop locator alternatives', () => assert.deepEqual(metadataFor('square-shop').anyOf, [['data-site-id'], ['data-guild-id']])],
  ['square-shop embed summary', () => assert.match(metadataFor('square-shop').summary, /instant.*Square sellers only/)],
  ['localized defaults are values', () => { for (const name of Object.keys(CORALS)) for (const a of metadataFor(name).attributes) assert.notEqual(a.default, 'locale dictionary', `${name}: ${a.name} has a sentinel default`); }],
  ['qr hosted requirements', () => { const m = metadataFor('qr'); assert.equal(m.host, 'cardtile'); assert.match(m.embed, /class="st-figure"/); assert.match(m.embed, /\/_coral\/qr.js/); assert.equal(attributeFor('qr', 'url').required, false); assert.match(attributeFor('qr', 'version').description, /too small/); }],
  ['drawer hosted requirements', () => { const m = metadataFor('drawer'); assert.equal(m.host, 'cardtile'); for (const text of ['class="dc-drawer"', 'data-drawer="details"', 'dc-drawer-close', '/_coral/drawer.js']) assert.ok(m.embed.includes(text), text); assert.match(attributeFor('drawer', 'drawer-panel').description, /id/); }],
  ['inbox defaults and gate', () => { assert.equal(attributeFor('inbox-bubble', 'api-base').default, 'https://feelreef.com'); assert.match(attributeFor('inbox-bubble', 'site-name').description, /og:site_name.*hostname/); assert.match(metadataFor('inbox-bubble').summary, /only where.*Inbox/); assert.match(attributeFor('inbox-bubble', 'title').description, /visible/); }],
  ['sponsor real English defaults', () => { for (const [key, value] of Object.entries({ 'amount-label': 'Amount', 'submit-label': 'Sponsor', 'invalid-label': 'Enter an amount to sponsor.', 'error-label': 'Could not start that just now — try again.', 'not-activated-label': "This site hasn't turned on payments yet.", 'unconnected-label': 'Sponsoring is not set up on this site yet.' })) assert.equal(attributeFor('sponsor', key).default, value, key); assert.equal(attributeFor('sponsor', 'guild-id').description, 'Seller the checkout link is created for.'); }],
  ['repo-facts input constraints', () => { assert.equal(attributeFor('repo-facts', 'owner').pattern, '^[\\w.-]{1,100}$'); assert.match(attributeFor('repo-facts', 'api-base').description, /https:\/\//); assert.match(attributeFor('repo-facts', 'locale').description, /then en/); }],
  ['events fetch failure copy', () => assert.match(attributeFor('events', 'empty').description, /fetch failure/)],
];
for (const [name, check] of checks) test(name, check);

test('collector covers literal, dataset and helper read forms', () => {
  assert.deepEqual([...attributeReads(`el.getAttribute('data-a'); el.dataset.longName; el.dataset['otherName']; attr('label'); attr('data-title'); el.dataset.written = 1;`)].sort(), ['data-a', 'data-label', 'data-long-name', 'data-other-name', 'data-title']);
});

test('drawer example includes the stylesheet emitted by Cardtile', async () => {
  const { DRAWER_CSS } = await import('./drawer/drawer-style.mjs');
  assert.ok(metadataFor('drawer').embed.includes(`<style>${DRAWER_CSS}</style>`), 'drawer: embed omits renderer stylesheet');
});
