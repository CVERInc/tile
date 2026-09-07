export const CORAL_MANIFEST_HARD_FIELDS = [
  'name', 'version', 'author', 'license', 'source', 'requires', 'calls', 'stores',
  'paid', 'funding', 'without', 'capabilities',
];

export function validateCoralManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, missing: [...CORAL_MANIFEST_HARD_FIELDS], mismatches: [] };
  }

  const missing = CORAL_MANIFEST_HARD_FIELDS.filter((field) =>
    !Object.prototype.hasOwnProperty.call(manifest, field));
  const mismatches = [];
  if (expected.name !== undefined && manifest.name !== expected.name) {
    mismatches.push(`name: expected ${expected.name}, got ${String(manifest.name)}`);
  }
  if (expected.version !== undefined && manifest.version !== expected.version) {
    mismatches.push(`version: expected ${expected.version}, got ${String(manifest.version)}`);
  }
  // The builder rewrites every original version segment; check both the published
  // version and the number of stale segments so a partial rewrite cannot pass.
  const version = String(manifest.version ?? '');
  const source = String(manifest.source ?? '');
  const segments = source.split('/').slice(1, -1);
  const count = (value) => segments.filter((segment) => segment === value).length;
  if (version && source && count(version) === 0) {
    mismatches.push(`source: expected a path containing /${version}/, got ${source}`);
  }
  const sourceVersion = String(expected.sourceVersion ?? '');
  if (sourceVersion && sourceVersion !== version) {
    const remaining = count(sourceVersion);
    if (remaining > 0) {
      mismatches.push(`source: found ${remaining} stale /${sourceVersion}/ segment(s), got ${source}`);
    }
  }
  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}
