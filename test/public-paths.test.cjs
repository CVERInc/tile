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

// ── and nothing else at the root is pretending to be one ────────────────────
//
// 🩸 2026-09-14: a lane committed an 89 KB stale copy of a coral's source to the REPO ROOT next to
// its real edit. It was byte-identical to the package file at that moment and rotted from the next
// commit onwards, and the source carries no version string, so the two copies were tellable apart
// only by reading them. Nothing here caught it: the manifest test above asserts that every listed
// path still EXISTS, which says nothing about a path that turned up unlisted, and .gitignore
// deliberately does not cover root *.js because the root is exactly where the by-name-fetched ones
// live.
//
// That is what makes an unlisted root script worth failing over rather than tidying away later. In
// this repo the root is the "somebody outside downloads this by name" shelf — PUBLIC-PATHS.json
// says so about Sortable.min.js in as many words, and one of those consumers is a production
// deploy. A file arriving there either belongs on that shelf, in which case it needs the entry that
// says who fetches it and what breaks, or it does not belong at the root at all.
//
// Either answer is cheap; only the third one — leaving it — costs somebody a day. The check is
// the TREE, not a list, so it cannot go stale: add a root script and this goes red on the commit
// that added it.
const ROOT_SCRIPT = /\.(?:js|cjs|mjs)$/;
const strays = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isFile() && ROOT_SCRIPT.test(d.name))
  .map((d) => d.name)
  .filter((name) => !Object.prototype.hasOwnProperty.call(doc.paths || {}, name));

if (strays.length) {
  throw new Error(
    `${strays.length} script(s) sit at the repo root without an entry in PUBLIC-PATHS.json:\n`
    + strays.map((n) => `  ✗ ${n}`).join('\n')
    + '\n\n  The root of this repo is where paths OTHER repos fetch by name live, so a file here is\n'
    + '  read as one of those. If it is: add an entry saying who names it and what breaks without\n'
    + '  it. If it is not — and a copy of something that already lives under packages/ never is —\n'
    + '  delete it, before someone vendors the stale one.',
  );
}

console.log(`  public paths: ${entries.length} declared, all present; root scripts: ${
  fs.readdirSync(ROOT).filter((n) => ROOT_SCRIPT.test(n)).length} declared, no strays`);
