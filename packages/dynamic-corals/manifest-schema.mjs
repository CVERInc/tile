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
  // `source` is the one version-bearing field the registry build does not rewrite
  // (`build.mjs` spreads the source manifest and overrides `version` only), so a bump that
  // forgets it publishes a manifest whose `version` and `source` disagree — with every other
  // check green. The published `source` must point at its own version's directory.
  const version = String(manifest.version ?? '');
  const source = String(manifest.source ?? '');
  if (version && source && !source.includes(`/${version}/`)) {
    mismatches.push(`source: expected a path containing /${version}/, got ${source}`);
  }
  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}
