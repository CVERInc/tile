// REEF with Sponsor — is this coral actually DISTRIBUTED, or does it only exist in the tree?
//   run: node packages/dynamic-corals/sponsor/sponsor-registry.test.mjs
//
// A coral reaches a page through the registry: `/corals/<coral>/v0/<coral>.js` resolves the channel
// in registry/manifest.json to a version, then serves registry/versions/<coral>/<version>/. Three
// separate files therefore have to agree — the manifest, the artifact on disk, and the coral's own
// package.json — and each of them is edited by hand at a different moment.
//
// 🩸 The registry has been bitten by exactly this seam twice already, both recorded next door:
// deploy.sh verified two hard-coded coral names while a third was published unchecked (2026-08-19),
// and release.mjs exists because a fresh version number was shipped over a stale bundle three times
// in a row. Both failures pass every check that reads only ONE of the three files.
//
// So this reads all three, and the last assertion is the one those stories are about: the artifact
// the manifest points at must be the CURRENT source, not merely a file that exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPONSOR_PATH, SELECTOR, RETURN_PARAM } from './sponsor-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORALS = join(HERE, '..');
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));

// 🔴 THE REGISTRY IS A DEPLOYMENT'S, NOT THIS REPO'S. The channel table and the published artifacts
// are live serving state; they live with the deploy that performs it, and this repo holds the
// source they are built from. So this file asks a question it can only answer when somebody hands
// it a registry: `CORAL_REGISTRY=<dir>`, the same variable build.mjs publishes into.
//
// 🔴 It SKIPS BY NAME rather than passing, and that distinction is the whole reason this file
// exists. Every failure it was written for — a channel pointing at an artifact nobody built, a
// fresh version number over a stale bundle — is invisible to a check that quietly succeeds when it
// cannot look. "I could not look" and "I looked and it is fine" must never print the same thing.
const REGISTRY = process.env.CORAL_REGISTRY || join(CORALS, 'registry');
const MANIFEST_PATH = join(REGISTRY, 'manifest.json');
if (!existsSync(MANIFEST_PATH)) {
  console.log(`SKIP - no coral registry at ${REGISTRY} (set CORAL_REGISTRY=<the deployment's registry dir>).`);
  console.log('       Every assertion in this file is about a published artifact; none of them ran.');
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/** The version a channel resolves to, or null when the registry has never heard of the coral. */
function channelFor(coral, channel) {
  const channels = manifest[coral];
  if (!channels || typeof channels !== 'object') return null;
  return channels[channel] || null;
}

/**
 * Every absolute origin the SHIPPED BYTES mention. Deliberately not limited to code: esbuild keeps
 * some comments, and an origin sitting in a comment would satisfy a check like this exactly as
 * well as one in a string — that is a guard matching its own prose, which this repo has been bitten
 * by before. So the source keeps no full origin literal anywhere, comments included.
 */
const ORIGINS = (text) => text.match(/https?:\/\/[^"'`\s]+/g) || [];

const artifactPath = (coral, version) =>
  join(REGISTRY, 'versions', coral, version, `${coral}.js`);

test('the registry serves the sponsor coral on the channel every site rides', () => {
  const v0 = channelFor('sponsor', 'v0');
  assert.ok(v0, 'sponsor has no v0 channel in registry/manifest.json — no site can load it');
  assert.equal(v0, pkg.version, 'the channel points somewhere other than this coral\'s version');
  assert.equal(channelFor('sponsor', 'latest'), pkg.version, 'and the dogfood channel agrees');
});

test('CONTROL: the same lookup returns null for a coral the registry does not carry', () => {
  // Without this, "sponsor is on v0" and "the lookup returns something for anything" read alike.
  // The live example is `drawer`: built, versioned under versions/, and deliberately on no channel.
  assert.equal(channelFor('sponsor-not-registered', 'v0'), null);
  assert.equal(channelFor('sponsor', 'no-such-channel'), null);
});

test('the version the channel points at is really on disk', () => {
  const version = channelFor('sponsor', 'v0');
  assert.ok(existsSync(artifactPath('sponsor', version)),
    `manifest points at sponsor@${version} and versions/sponsor/${version}/sponsor.js does not exist`);
});

test('every coral the manifest carries has the artifact it promises', () => {
  // Not sponsor-specific on purpose: the 2026-08-19 failure was a deploy that checked two names by
  // hand while a third shipped unverified. Read the manifest, so a coral cannot be added without
  // being checked.
  for (const [coral, channels] of Object.entries(manifest)) {
    if (!channels || typeof channels !== 'object') continue;   // the "//" documentation key
    for (const [channel, version] of Object.entries(channels)) {
      assert.ok(existsSync(artifactPath(coral, version)),
        `${coral}@${channel} points at ${version}, which has no artifact under versions/`);
    }
  }
});

test('the artifact is stamped as the version it is served under', () => {
  const version = channelFor('sponsor', 'v0');
  const built = readFileSync(artifactPath('sponsor', version), 'utf8');
  assert.match(built.split('\n')[0], new RegExp(`coral sponsor@${version.replace(/\./g, '\\.')} `));
  assert.ok(built.includes(`['sponsor']='${version}'`),
    'the artifact announces its own version on window.__coralVersions, so a page can be asked what it is running');
});

test('🔴 the published artifact is the CURRENT source, not a file that merely exists', () => {
  // esbuild renames locals, so the comparison is on things it cannot rename: string literals. Each
  // of these is a contract the coral would be shipping a lie about if the bundle were stale.
  const built = readFileSync(artifactPath('sponsor', channelFor('sponsor', 'v0')), 'utf8');
  for (const literal of [SPONSOR_PATH, SELECTOR, RETURN_PARAM, 'dc-sponsor', 'inputmode',
                         'data-guild-id', 'client_request_ref']) {
    assert.ok(built.includes(literal), `the published bundle is missing ${literal} — it is STALE`);
  }
});

test('CONTROL: that staleness check can tell a stale bundle from a fresh one', () => {
  const built = readFileSync(artifactPath('sponsor', channelFor('sponsor', 'v0')), 'utf8');
  // A literal from no version of this coral must be absent — otherwise `includes` matches anything.
  assert.equal(built.includes('/api/v2/shop/sponsor-that-never-shipped'), false);
});

test('the test fixture never ships', () => {
  const built = readFileSync(artifactPath('sponsor', channelFor('sponsor', 'v0')), 'utf8');
  assert.equal(built.includes('FakeNode'), false, 'fake-dom.mjs is a fixture and is not part of the coral');
  assert.equal(built.includes('fakeFetch'), false);
});

test('🔴 one request, one route, and NO origin — the page names the backend or nothing happens', () => {
  // Two invariants in one read of the shipped bytes, and the second is newer than the first.
  //
  // The zero-new-payment-implementation invariant: this coral collects an amount and asks the
  // backend for a link, so a provider endpoint appearing here would mean that promise is broken
  // and the sites embedding it are the ones who find out.
  //
  // 🔴 And since 0.2.0, no ORIGIN either. Until then the bundle carried `feelreef.com` as a
  // fallback, and that address answers this route on no deployment that exists — the front door
  // names no `/api/v2/shop/*` route of its own and the backend behind the fallthrough has no
  // `sponsor` one. A mount with no `data-api-base` now refuses instead of posting to a 404, and
  // that only stays true while the bytes hold no origin to quietly fall back to. Guarding the
  // ABSENCE is the point: a default cannot be reintroduced without an origin reaching this file.
  const built = readFileSync(artifactPath('sponsor', channelFor('sponsor', 'v0')), 'utf8');
  const requests = built.match(/\bfetch\s*\(/g) || [];
  assert.equal(requests.length, 1, `the bundle makes ${requests.length} kinds of request; it should make one`);
  const origins = ORIGINS(built);
  assert.deepEqual(origins, [],
    `the bundle names an origin, and it has no business naming one; found ${origins.join(', ')}`);
  const paths = [...new Set(built.match(/"\/api\/[^"]*"/g) || [])];
  assert.deepEqual(paths, [`"${SPONSOR_PATH}"`], 'one route, and it is the one this coral documents');
});

test('CONTROL: the origin check can still SEE an origin — 0.1.0 is the artifact that had one', () => {
  // An empty match list and a matcher that stopped matching read identically, and asserting an
  // absence is exactly where that costs you. The version this coral shipped before is immutable
  // and still on disk carrying the origin that was removed, so the ruler is checked against a real
  // published artifact rather than a string written to make it pass.
  assert.deepEqual(ORIGINS(readFileSync(artifactPath('sponsor', '0.1.0'), 'utf8')),
    ['https://feelreef.com']);
});

test('build.mjs is the producer of this artifact — the coral is in its table', () => {
  // The other half of "registered": the manifest says where to serve it from, build.mjs is what
  // puts it there. A coral missing here can never be rebuilt, and its channel freezes silently.
  const build = readFileSync(join(CORALS, 'build.mjs'), 'utf8');
  assert.match(build, /'sponsor':\s*\{\s*src:\s*'sponsor-client\.mjs',\s*bundle:\s*true\s*\}/);
});
