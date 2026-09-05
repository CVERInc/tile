// Release a coral — the WHOLE chain, in the only order that works.
//
//   node packages/dynamic-corals/release.mjs qr [--bump patch|minor]
//
// 🩸 WHY THIS EXISTS. On 2026-07-30 I shipped the QR coral three times and every deploy was empty.
// The chain is:
//
//     gen-<coral>-client.mjs  →  <coral>-client.mjs  →  npm run build  →  qr.js
//                                                                          ↓
//                        card-assets.mjs  ←  cardtile/serve/gen-assets.mjs
//
// `gen-assets` reads the BUILT bundle. I edited the source, skipped `npm run build`, and rebuilt the
// assets from a stale artifact — three times. The version number changed every time, so every check
// I ran said the deploy had landed. chodaict tested on real phones three times and told me it still
// did not work, three times.
//
// 🔴 It was already written down — 「改 coral＝發佈(bump→build→頻道→deploy)非 cp」 — in a memory
// that loads every session. Prose did not stop me. A script does: there is now no way to run half
// of this.
//
// 🔴 AND: /_coral/ is served `immutable` for a year, so a version that ships a stale bundle can
// never be corrected at that URL — 0.14.1 is permanently poisoned at the edge. That is why this
// VERIFIES the bundle before it lets the version be spent.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..');   // dynamic-corals/.. — cardtile is a SIBLING, not an uncle
const coral = process.argv[2];
if (!coral) {
  console.error('usage: release.mjs <coral> [--bump patch|minor]');
  process.exit(2);
}
const bumpKind = (process.argv.includes('--bump') && process.argv[process.argv.indexOf('--bump') + 1]) || 'patch';
const dir = join(HERE, coral);
const pkgPath = join(dir, 'package.json');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });

// 1. bump — BEFORE the build, so the artifact carries the version it will be served under
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const before = pkg.version;
pkg.version = bumpKind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`1. version  ${before} → ${pkg.version}`);

// 2. regenerate the client from its source-of-truth transform, when the coral has one
try {
  run('node', [`gen-${coral}-client.mjs`], dir);
  console.log(`2. generate ${coral}-client.mjs`);
} catch {
  console.log(`2. generate (no gen-${coral}-client.mjs — hand-written client)`);
}

// 3. 🔴 THE STEP I SKIPPED. gen-assets reads the BUILT bundle, not the client.
run('npm', ['run', 'build'], dir);
console.log('3. build    → ' + coral + '.js');

// 4. 🔴 PROVE the bundle is the one just generated, before spending the version. A stale bundle
// under a fresh version number is exactly the failure this file exists to prevent, and `immutable`
// means that URL can never be corrected.
const bundle = readFileSync(join(dir, `${coral}.js`), 'utf8');
// 🔴 COMMENTS STRIPPED FIRST. The gate's first run failed on `0.07` — a number that appears only in
// a comment describing the history of that constant (0.10 → 0.07 → 0.05). esbuild removes comments,
// so the bundle legitimately lacks it. A gate whose first firing is a false positive is a gate
// somebody switches off, so the ruler gets fixed rather than the threshold loosened.
const client = readFileSync(join(dir, `${coral}-client.mjs`), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
// esbuild renames locals, so compare on things it cannot rename: string and numeric literals.
const marks = [...new Set([
  ...(client.match(/"[A-Z]"/g) || []),
  ...(client.match(/\b0\.\d{2}\b/g) || []),
])].slice(0, 12);
if (!marks.length) {
  console.error('\n🔴 no comparable literal found in the client — this check would pass on anything.');
  process.exit(1);
}
const missing = marks.filter((m) => !bundle.includes(m.replace(/^'|'$/g, '"')));
if (missing.length) {
  console.error(`\n🔴 the bundle does not contain ${missing.join(' ')} from the client — it is STALE.`);
  console.error('   Nothing was deployed. The version bump above is spent; bump again after fixing.');
  process.exit(1);
}
console.log(`4. verify   bundle carries ${marks.length} literal(s) from the client`);

// 5. the serving copy
run('node', ['gen-assets.mjs'], join(PACKAGES, 'cardtile/serve'));
const assets = readFileSync(join(PACKAGES, 'cardtile/serve/card-assets.mjs'), 'utf8');
// 🔴 either quote. My first version demanded single quotes; gen-assets writes double, so the check
// reported 「(none)」 about a file that had just been rebuilt correctly. Third ruler bug in this one
// script — which is itself the argument for scripts over prose: each of these got FIXED, once.
const served = new RegExp(`${coral.toUpperCase()}_VERSION\\s*=\\s*["']([^"']+)["']`).exec(assets);
if (!served || served[1] !== pkg.version) {
  console.error(`\n🔴 card-assets says ${served ? served[1] : '(none)'} but we just built ${pkg.version}.`);
  process.exit(1);
}
console.log(`5. assets   card-assets.mjs @ ${served[1]}`);

console.log(`\n✅ ${coral} ${pkg.version} is ready. Deploy:`);
console.log('   cd packages/cardtile/serve && CLOUDFLARE_API_TOKEN=… npx wrangler deploy --env production');
console.log(`\n🔴 Then read the SERVED FILE, not the version in the HTML:`);
console.log(`   curl -sS https://card.feelreef.com/_coral/${coral}-${pkg.version}.js | grep -o '…'`);
console.log('   Checking the version number is what let three empty deploys pass.');
