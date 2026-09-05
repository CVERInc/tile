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
  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}
