// text-edit as a REGISTRY coral: a host that frames a preview loads it from the registry channel
// (`/corals/text-edit/v1/text-edit.js`; `v0` stays on 0.1.0) like every other dynamic coral, instead of serving its own
// copy. And it is NOT LISTED in the public coral catalog: it is an editing aid a host injects into
// its own framed preview, not something a site owner installs on a page.
//   run: node --test packages/dynamic-corals/text-edit/text-edit-registry.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORALS, REGISTRY_CORALS } from '../corals.mjs';
import { validateCoralManifest } from '../manifest-schema.mjs';
import { listedInCatalog } from '../catalog-readme.mjs';
import { normalizeGeneratedCode } from '../normalize-generated-code.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const metadataOf = (name) => JSON.parse(readFileSync(join(HERE, '..', name, 'metadata.json'), 'utf8'));
const VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;

test('text-edit is a registry participant at 1.1.0, with a valid source manifest', () => {
  assert.equal(CORALS['text-edit'].registry, true);
  assert.ok(REGISTRY_CORALS.includes('text-edit'));
  assert.equal(VERSION, '1.1.0');
  const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
  assert.deepEqual(validateCoralManifest(manifest, { name: 'text-edit', version: VERSION }), { ok: true, missing: [], mismatches: [] });
  assert.equal(manifest.source, `https://feelreef.com/corals/text-edit/${VERSION}/text-edit.js`);
  assert.deepEqual(manifest.capabilities, [], 'it posts words to its parent frame; it moves no money');
});

test('the embed loads the registry channel v1, not a host-served copy and never v0', () => {
  const { embed } = metadataOf('text-edit');
  assert.match(embed, /<script src="https:\/\/feelreef\.com\/corals\/text-edit\/v1\/text-edit\.js"><\/script>/);
  assert.doesNotMatch(embed, /src="text-edit\.js"/);
  assert.doesNotMatch(embed, /\/v0\//, 'v0 is the 0.1.0 host contract; 1.0.0 is breaking for hosts (tile#284)');
});

// tile#284 — 1.0.0 is breaking for hosts (an answer must echo `doc`), so it is a new major on a new
// channel. A channel is a major: `v<N>` serves N.x, and an embed names the channel of its own major.
test('tile#284: text-edit is 1.x (1.1.0 adds the probe, additive) on channel v1, and the README says what breaks for hosts', () => {
  assert.equal(VERSION, '1.1.0');
  const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.source, 'https://feelreef.com/corals/text-edit/1.1.0/text-edit.js');
  assert.match(metadataOf('text-edit').requirements, /channel `v1`/);
  const readme = readFileSync(join(HERE, 'README.md'), 'utf8');
  assert.match(readme, /1\.0\.0 is breaking for hosts: echo `doc`/);
  assert.match(readme, /`v0`\s+keeps 0\.1\.0 and is never repointed/);
  assert.doesNotMatch(readme, /corals\/text-edit\/v0\//);
});

test('tile#284: every registry coral\'s embed names the channel of its own major (v0 for 0.x, v1 for 1.x)', () => {
  for (const name of REGISTRY_CORALS) {
    const major = JSON.parse(readFileSync(join(HERE, '..', name, 'package.json'), 'utf8')).version.split('.')[0];
    const channels = [...String(metadataOf(name).embed).matchAll(new RegExp(`/corals/${name}/([^/]+)/`, 'g'))].map((m) => m[1]);
    assert.ok(channels.length > 0, `${name}: its embed loads no registry channel`);
    for (const c of channels) assert.equal(c, `v${major}`, `${name}@${major}.x embeds channel ${c}`);
  }
});

test('the public catalog does not list text-edit, and lists every other registry coral', () => {
  assert.equal(metadataOf('text-edit').listed, false);
  assert.equal(listedInCatalog(metadataOf('text-edit')), false);
  const listed = REGISTRY_CORALS.filter((name) => listedInCatalog(metadataOf(name)));
  assert.deepEqual(listed.sort(), ['countdown', 'dock', 'events', 'inbox-bubble', 'repo-facts', 'sponsor', 'square-shop']);
  // `listed` is a boolean when present, and only `false` hides a coral
  for (const name of Object.keys(CORALS)) {
    const m = metadataOf(name);
    if ('listed' in m) assert.equal(typeof m.listed, 'boolean', name);
  }
  assert.equal(listedInCatalog({}), true);
  assert.equal(listedInCatalog({ listed: true }), true);
});

test('the registry build publishes text-edit@1.1.0: the artifact and its manifest', (t) => {
  // build.mjs also rewrites <coral>/<coral>.js where it runs, so it runs on a COPY: inside the repo's
  // gitignored out/ (it stamps the commit with `git rev-parse`), never over the committed artifact.
  const repo = join(HERE, '../../..');
  mkdirSync(join(repo, 'out'), { recursive: true });
  const sandbox = mkdtempSync(join(repo, 'out', 'text-edit-registry-'));
  const registry = join(sandbox, 'registry');
  try {
    for (const f of ['build.mjs', 'corals.mjs', 'manifest-schema.mjs', 'normalize-generated-code.mjs', 'package.json']) cpSync(join(HERE, '..', f), join(sandbox, f));
    cpSync(HERE, join(sandbox, 'text-edit'), { recursive: true });
    // Same candidates, same order, as build.mjs and generated-bundles.test.mjs.
    const esbuild = [process.env.ESBUILD, join(HERE, '../../sitetile/astro/node_modules/.bin/esbuild'), join(repo, 'node_modules/.bin/esbuild'), join(repo, '../node_modules/.bin/esbuild')].find((p) => p && existsSync(p));
    if (!esbuild) { t.skip('no esbuild (npm install in packages/sitetile/astro)'); return; }
    const env = { ...process.env, ESBUILD: esbuild };
    delete env.CORAL_REGISTRY;
    execFileSync('node', [join(sandbox, 'build.mjs'), 'text-edit', '--registry', registry], { stdio: 'pipe', env });
    const dir = join(registry, 'versions', 'text-edit', VERSION);
    assert.ok(existsSync(join(dir, 'text-edit.js')), 'versions/text-edit/1.1.0/text-edit.js');
    const norm = (text) => normalizeGeneratedCode(text, 'text-edit', VERSION);
    assert.equal(norm(readFileSync(join(dir, 'text-edit.js'), 'utf8')), norm(readFileSync(join(HERE, 'text-edit.js'), 'utf8')),
      'the published code is the committed local artifact (the commit stamp aside)');
    const published = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    assert.equal(validateCoralManifest(published, { name: 'text-edit', version: VERSION }).ok, true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
