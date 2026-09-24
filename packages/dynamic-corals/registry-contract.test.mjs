// The registry/channel contract, generalised over EVERY registry-participant coral — is this
// coral actually DISTRIBUTED, or does it only exist in the tree?
//   run: node packages/dynamic-corals/registry-contract.test.mjs
//
// A coral reaches a page through the registry: `/corals/<coral>/v0/<coral>.js` resolves the
// channel in registry/manifest.json to a version, then serves registry/versions/<coral>/<version>/.
// Three separate files therefore have to agree — the manifest, the artifact on disk, and the
// coral's own package.json — and each of them is edited by hand at a different moment.
//
// 🩸 The registry has been bitten by exactly this seam twice already, both recorded next door (see
// sponsor-registry.test.mjs, which held this whole file's job until now): deploy.sh verified two
// hard-coded coral names while a third was published unchecked (2026-08-19), and release.mjs exists
// because a fresh version number was shipped over a stale bundle three times in a row. Both
// failures pass every check that reads only ONE of the three files.
//
// This generalises that same check from sponsor alone to every registry participant — read from
// corals.mjs, never hand-listed, so the day a fifth one is added it is covered automatically and
// `qr`/`drawer` (Cardtile-served, no channels) cannot silently drift in.
//
// 🔴 LAG IS TOLERATED ON PURPOSE. A release that moves several layered corals' channel pointers
// together may legitimately hold one coral's channel behind its own package version for a while —
// a held pointer is not a stale one, and requiring channel == package version here would be wrong
// for three of the four registry corals as this is written. What still has to be true regardless:
// the version a coral claims is actually published, not just bumped in package.json; every channel
// points at something actually published, not a version name nobody built; a channel is never AHEAD
// of the version it is meant to describe, because a channel cannot serve a version its own source
// does not yet describe; and the source manifest — even while it legitimately lags the package
// version — agrees with the immutable published manifest once the SAME package-version
// normalisation build.mjs applies is applied to it. Tightening this back to strict equality is a
// separate, later change, gated on a coordinated multi-coral channel repoint; do not do it here.
//
// 🔴 It SKIPS BY NAME rather than passing when handed no registry, and that distinction is the
// whole reason this file exists. Every failure it was written for — a channel pointing at an
// artifact nobody built, a fresh version number over a stale bundle — is invisible to a check that
// quietly succeeds when it cannot look. "I could not look" and "I looked and it is fine" must never
// print the same thing. The synthetic fixtures below need no registry at all and always run, real
// or not; only the checks against a REAL handed registry are gated on `CORAL_REGISTRY`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCoralManifest, normalizeManifestForVersion } from './manifest-schema.mjs';
import { REGISTRY_CORALS } from './corals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));   // packages/dynamic-corals
const CORALS_DIR = HERE;

// 🔴 The REGISTRY is a DEPLOYMENT's, not this repo's — same reasoning as sponsor-registry.test.mjs
// and build.mjs's own --registry flag. No path to it, and nothing about it, is committed here; it
// arrives at runtime through `CORAL_REGISTRY`, the same variable build.mjs publishes into.
const REGISTRY_ROOT = process.env.CORAL_REGISTRY || join(CORALS_DIR, 'registry');
const MANIFEST_PATH = join(REGISTRY_ROOT, 'manifest.json');

/**
 * These corals use plain `major.minor.patch` numbers with no pre-release or build suffix, so a
 * numeric compare is honest here; anything else is a shape this cannot compare and should say so
 * rather than fall back to string ordering, which gets e.g. "0.10.9" vs "0.10.10" wrong.
 */
function compareVersions(a, b) {
  const toParts = (v) => {
    const parts = String(v).split('.');
    if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) {
      throw new Error(`not a plain major.minor.patch version: ${v}`);
    }
    return parts.map(Number);
  };
  const [aMajor, aMinor, aPatch] = toParts(a);
  const [bMajor, bMinor, bPatch] = toParts(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

const artifactPath = (registryRoot, coral, version) =>
  join(registryRoot, 'versions', coral, version, `${coral}.js`);
const versionManifestPath = (registryRoot, coral, version) =>
  join(registryRoot, 'versions', coral, version, 'manifest.json');

/**
 * The one guard: does `name`'s registry/channel state, read from `registryRoot`, actually hold?
 * Shared between the real four registry participants (below, gated on a real handed registry) and
 * every synthetic fixture (further below, gated on nothing) — one implementation of "does the
 * contract hold", not a copy for corals and a second copy for the tests that probe it.
 *
 * Reads, never writes — see "the guard never writes to the registry it is handed" further down.
 */
function checkRegistryContract({ name, coralDir, registryRoot }) {
  const pkg = JSON.parse(readFileSync(join(coralDir, 'package.json'), 'utf8'));
  const version = pkg.version;

  // (1) the coral's OWN current version has an immutable published artifact.
  assert.ok(existsSync(artifactPath(registryRoot, name, version)),
    `${name}@${version} (from package.json) has no published artifact under versions/${name}/${version}/ — bumped but never published`);

  const registryManifest = JSON.parse(readFileSync(join(registryRoot, 'manifest.json'), 'utf8'));
  const channels = registryManifest[name];
  assert.ok(channels && typeof channels === 'object',
    `${name} has no channel entry in registry/manifest.json — no site can load it`);

  // (2)+(3)+(4) v0 and latest both exist, both resolve to something published, and neither is
  // ahead of the coral's own current version — a channel cannot serve a version its own source
  // does not yet describe. Behind is fine (see the lag-tolerance note at the top of this file).
  for (const channel of ['v0', 'latest']) {
    const channelVersion = channels[channel];
    assert.ok(channelVersion,
      `${name} has no ${channel} channel in registry/manifest.json — no site can load it`);
    assert.ok(existsSync(artifactPath(registryRoot, name, channelVersion)),
      `${name} ${channel} points at ${channelVersion}, which has no published artifact under versions/${name}/${channelVersion}/`);
    assert.ok(compareVersions(channelVersion, version) <= 0,
      `${name} ${channel} points at ${channelVersion}, which is ahead of this coral's own version ${version} — `
      + 'a channel cannot serve a version its own source does not yet describe');
  }

  const sourceManifest = JSON.parse(readFileSync(join(coralDir, 'manifest.json'), 'utf8'));
  const sourceVersion = String(sourceManifest.version ?? '');

  // (5) the RAW source manifest is schema-valid at its OWN stored identity. It is not compared to
  // the package version here — package.json is release-version authority, and the raw source
  // manifest is free to still lag it right up until the next build (see normalizeManifestForVersion
  // for the rewrite that happens between here and publication).
  const ownIdentity = validateCoralManifest(sourceManifest, { name, version: sourceVersion });
  assert.ok(ownIdentity.ok,
    `${name} source manifest.json is not schema-valid at its own stored identity (${sourceVersion}): `
    + [...ownIdentity.missing.map((f) => `missing ${f}`), ...ownIdentity.mismatches].join('; '));

  // (6) the source manifest, after EXACTLY build.mjs's package-version normalisation (shared, not
  // reimplemented — see the import above), equals the immutable manifest published beside the
  // coral's own current version. Comparing the RAW source manifest's stored version/source against
  // the package version directly would be wrong: it would be red whenever the source manifest
  // legitimately still lags, which today is three of the four registry corals.
  const { manifest: normalized } = normalizeManifestForVersion(sourceManifest, version);
  const publishedManifestPath = versionManifestPath(registryRoot, name, version);
  assert.ok(existsSync(publishedManifestPath),
    `${name}@${version} has a published artifact but no manifest.json beside it under versions/${name}/${version}/`);
  const publishedManifest = JSON.parse(readFileSync(publishedManifestPath, 'utf8'));
  assert.deepEqual(publishedManifest, normalized,
    `${name}@${version}'s published manifest.json does not equal its source manifest after build.mjs's own package-version normalisation`);
}

// ── synthetic fixtures — never touch the real registry, always run, registry or no registry ────
//
// Build every fixture in a mkdtemp directory (never a real coral dir, never the real registry).
function buildFixture({
  name = 'fixture-coral',
  packageVersion,
  sourceVersion = packageVersion,
  channelVersion = packageVersion,
  publishPackageVersion = true,
  publishChannelVersionArtifact = true,
  mutateImmutableManifest = null,
}) {
  const tmp = mkdtempSync(join(tmpdir(), 'registry-contract-fixture-'));
  const coralDir = join(tmp, 'coral');
  const registryRoot = join(tmp, 'registry');
  mkdirSync(coralDir, { recursive: true });

  writeFileSync(join(coralDir, 'package.json'),
    JSON.stringify({ name: `@example/${name}`, version: packageVersion, private: true, type: 'module' }, null, 2) + '\n');

  // RFC 2606 reserved name only — this repo is public and MIT, and this fixture is never published.
  const sourceManifest = {
    name, version: sourceVersion, author: 'Example', license: 'MIT',
    source: `https://example.test/corals/${name}/${sourceVersion}/${name}.js`,
    requires: [], calls: ['GET https://example.test/data'], stores: ['none'],
    paid: false, funding: null, without: 'No fallback.', capabilities: [],
  };
  writeFileSync(join(coralDir, 'manifest.json'), JSON.stringify(sourceManifest, null, 2) + '\n');

  mkdirSync(registryRoot, { recursive: true });

  if (publishPackageVersion) {
    const dir = join(registryRoot, 'versions', name, packageVersion);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.js`), '/* fixture bundle */\n');
    const { manifest: normalized } = normalizeManifestForVersion(sourceManifest, packageVersion);
    const immutableManifest = mutateImmutableManifest ? mutateImmutableManifest(normalized) : normalized;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(immutableManifest, null, 2) + '\n');
  }

  if (channelVersion !== packageVersion && publishChannelVersionArtifact) {
    // A historical already-published version names ITSELF, not the current package version — at
    // the moment IT was published, package.json and the source manifest agreed.
    const dir = join(registryRoot, 'versions', name, channelVersion);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.js`), '/* fixture bundle (historical channel version) */\n');
    const historicalManifest = {
      ...sourceManifest, version: channelVersion,
      source: `https://example.test/corals/${name}/${channelVersion}/${name}.js`,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(historicalManifest, null, 2) + '\n');
  }

  writeFileSync(join(registryRoot, 'manifest.json'),
    JSON.stringify({ [name]: { v0: channelVersion, latest: channelVersion } }, null, 2) + '\n');

  return { tmp, name, coralDir, registryRoot };
}

function withFixture(opts, run) {
  const fx = buildFixture(opts);
  try {
    run(fx);
  } finally {
    rmSync(fx.tmp, { recursive: true, force: true });
  }
}

test('CONTROL on the lag tolerance: channel behind package version, package version published, immutable manifest matching the normalised source manifest — green', () => {
  // Exactly today's legitimate shape (see square-shop/inbox-bubble/sponsor's real state): the
  // channel still points at an older already-published version while a newer package version has
  // also been published and not yet promoted to the channel. Without this control, a guard that
  // simply refused everything would look correct.
  withFixture({ packageVersion: '1.0.1', sourceVersion: '1.0.0', channelVersion: '1.0.0' }, (fx) => {
    assert.doesNotThrow(() =>
      checkRegistryContract({ name: fx.name, coralDir: fx.coralDir, registryRoot: fx.registryRoot }));
  });
});

test('a channel pointing at an unpublished version is red', () => {
  withFixture({
    packageVersion: '1.0.0', channelVersion: '0.9.0', publishChannelVersionArtifact: false,
  }, (fx) => {
    assert.throws(() =>
      checkRegistryContract({ name: fx.name, coralDir: fx.coralDir, registryRoot: fx.registryRoot }),
      /has no published artifact under versions\//);
  });
});

test('a channel ahead of the package version is red', () => {
  withFixture({ packageVersion: '1.0.0', channelVersion: '1.1.0' }, (fx) => {
    assert.throws(() =>
      checkRegistryContract({ name: fx.name, coralDir: fx.coralDir, registryRoot: fx.registryRoot }),
      /is ahead of this coral's own version/);
  });
});

test('the package version having no published artifact is red', () => {
  withFixture({
    packageVersion: '2.0.0', channelVersion: '1.9.0', publishPackageVersion: false,
  }, (fx) => {
    assert.throws(() =>
      checkRegistryContract({ name: fx.name, coralDir: fx.coralDir, registryRoot: fx.registryRoot }),
      /bumped but never published/);
  });
});

test('a normalised source manifest that disagrees with the immutable version manifest is red', () => {
  withFixture({
    packageVersion: '1.0.0',
    mutateImmutableManifest: (manifest) => ({ ...manifest, capabilities: ['money'] }),
  }, (fx) => {
    assert.throws(() =>
      checkRegistryContract({ name: fx.name, coralDir: fx.coralDir, registryRoot: fx.registryRoot }),
      /does not equal its source manifest after build\.mjs's own package-version normalisation/);
  });
});

test('CONTROL: the participant set really is the four from the table, derived, not hand-listed', () => {
  // Without this, a guard that iterated an accidentally-wrong list would look correct. Derived from
  // corals.mjs — the same table build.mjs itself reads — never hand-listed here, so a fifth
  // registry participant is covered automatically and qr/drawer cannot silently drift in.
  assert.deepEqual([...REGISTRY_CORALS].sort(), ['events', 'inbox-bubble', 'sponsor', 'square-shop']);
});

// ── against a REAL handed registry — SKIP BY NAME when none is given ────────────────────────────
if (existsSync(MANIFEST_PATH)) {
  const registryManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

  for (const name of REGISTRY_CORALS) {
    test(`${name}: registry/channel contract holds (own version published; v0/latest resolve, never lead; source-manifest identity valid and agrees with the immutable copy after normalisation)`, () => {
      checkRegistryContract({ name, coralDir: join(CORALS_DIR, name), registryRoot: REGISTRY_ROOT });
    });
  }

  test('every coral the manifest carries has the artifact it promises', () => {
    // Not participant-specific on purpose: the 2026-08-19 failure was a deploy that checked two
    // names by hand while a third shipped unverified. Read the manifest, so a coral cannot be added
    // without being checked.
    for (const [coral, channels] of Object.entries(registryManifest)) {
      if (!channels || typeof channels !== 'object') continue;   // the "//" documentation key
      for (const [channel, version] of Object.entries(channels)) {
        assert.ok(existsSync(artifactPath(REGISTRY_ROOT, coral, version)),
          `${coral}@${channel} points at ${version}, which has no artifact under versions/`);
      }
    }
  });

  test('CONTROL: the channel lookup returns nothing for a coral the registry does not carry — qr and drawer are never in the channel table', () => {
    // The live example: qr/drawer are built and versioned under versions/ (Cardtile serves them),
    // and deliberately on no channel at all — see corals.mjs's LOCAL_ONLY_CORALS.
    assert.equal(registryManifest.qr, undefined,
      'qr is Cardtile-served and must never appear in the registry channel table');
    assert.equal(registryManifest.drawer, undefined,
      'drawer is Cardtile-served and must never appear in the registry channel table');
  });

  test('the guard never writes to the registry it is handed', () => {
    const snapshot = (dir) => {
      const out = [];
      const walk = (d, prefix) => {
        for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const full = join(d, entry.name);
          if (entry.isDirectory()) { walk(full, rel); continue; }
          const stat = statSync(full);
          out.push(`${rel}:${stat.size}:${stat.mtimeMs}`);
        }
      };
      walk(dir, '');
      return out;
    };
    // Self-contained — runs every real-registry check itself rather than relying on the tests above
    // having already run in this order, so the proof does not depend on node:test's scheduling.
    const before = snapshot(REGISTRY_ROOT);
    for (const name of REGISTRY_CORALS) {
      checkRegistryContract({ name, coralDir: join(CORALS_DIR, name), registryRoot: REGISTRY_ROOT });
    }
    const after = snapshot(REGISTRY_ROOT);
    assert.deepEqual(after, before,
      'the handed registry changed shape or mtimes after running every check against it — the guard must be read-only');
  });
} else {
  console.log(`SKIP - no coral registry at ${REGISTRY_ROOT} (set CORAL_REGISTRY=<the deployment's registry dir>).`);
  console.log('       These did NOT run: the per-coral registry/channel contract for events, square-shop,');
  console.log('       inbox-bubble and sponsor; the registry-wide "every channel points at a real artifact"');
  console.log('       check; the qr/drawer channel-table scope control; and the no-write check. Every');
  console.log('       synthetic-fixture assertion above this line — including both green controls — still ran.');
}
