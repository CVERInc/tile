// Every path in PUBLIC-PATHS.json must still exist.
//
// Why this test exists: on 2026-08-10/11 the family reorganised, and five hardcoded paths broke.
// Four of them were found AFTER the fact — not by a test, but by something downstream failing and
// somebody eventually noticing. That is the shape of the problem: a path this repo does not import
// can still be load-bearing, because another repo fetches it from GitHub by name. `git grep` in here
// shows nothing. The break lands in a deploy log in a different repo, on a different day.
//
// The listed consumers can go stale — they are facts about other repos, and this repo cannot verify
// them. The PATHS cannot, and that is the whole trick: what is asserted is our own tree, so a rename
// turns THIS commit red, here, with the consumer's name in the message.
//
// Absence from the manifest means "nobody outside was known to name this", never "safe to move".
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'PUBLIC-PATHS.json');

let doc;
try {
  doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  throw new Error(`PUBLIC-PATHS.json did not parse: ${e.message}`);
}

const entries = Object.entries(doc.paths || {});
if (entries.length === 0) {
  // An empty manifest and a manifest that lost its contents look identical from a green test.
  throw new Error('PUBLIC-PATHS.json declares no paths — if that is really true, delete this test too');
}

const missing = [];
const unexplained = [];

for (const [p, meta] of entries) {
  if (path.isAbsolute(p) || p.split(path.sep).includes('..')) {
    throw new Error(`PUBLIC-PATHS.json: "${p}" must be a path relative to the repo root`);
  }
  if (!fs.existsSync(path.join(ROOT, p))) missing.push([p, meta]);

  // An entry with no claim attached is a path somebody added to silence something. Reject it:
  // the whole value of the manifest is that whoever gets the red knows who to go and tell.
  const named = Array.isArray(meta && meta.namedBy) ? meta.namedBy.filter((s) => String(s).trim()) : [];
  if (!named.length || !String((meta || {}).breaks || '').trim()) unexplained.push(p);
}

if (unexplained.length) {
  throw new Error(
    'PUBLIC-PATHS.json entries need both `namedBy` (who fetches it) and `breaks` (what fails):\n'
    + unexplained.map((p) => `  · ${p}`).join('\n'),
  );
}

if (missing.length) {
  const lines = missing.map(([p, meta]) => [
    `  ✗ ${p}`,
    ...meta.namedBy.map((n) => `      named by ${n}`),
    `      breaks: ${meta.breaks}`,
  ].join('\n'));
  throw new Error(
    `${missing.length} path(s) other repos fetch by name no longer exist here:\n${lines.join('\n\n')}\n\n`
    + '  Either put them back, or move them AND update every consumer listed above — then remove or\n'
    + '  re-point the entry. A rename is not done until the consumers know about it.',
  );
}

console.log(`  public paths: ${entries.length} declared, all present`);
