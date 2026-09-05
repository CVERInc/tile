// Bundle the card's static assets (stylesheet + link icons) into an importable ES module so the
// edge Worker is self-contained (Workers can't read the filesystem). Regenerate after editing
// card.css or icons.json:  node packages/cardtile/serve/gen-assets.mjs
//
// Icon keys are normalised to the SEMANTIC names an author writes in card.md (`icon=patreon`),
// not the btn-* class names they were scraped from — the renderer looks up ctx.icons[p.icon].
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(join(DIR, 'card.css'), 'utf8');
const raw = JSON.parse(fs.readFileSync(join(DIR, 'icons.json'), 'utf8'));
// the QR coral's built client — the Worker serves it at /_coral/qr.js so the card page can
// reference it as an EXTERNAL script (the production shape), while the preview stays self-contained.
const CORALS = join(DIR, '../../dynamic-corals');   // a sibling package, since 2026-09-07
const qrJs = fs.readFileSync(join(CORALS, 'qr/qr.js'), 'utf8');
const drawerJs = fs.readFileSync(join(CORALS, 'drawer/drawer.js'), 'utf8');
// 🔴 The coral is served immutable (a year). That is only safe because the URL carries the
// version: an immutable response at a STABLE url means a coral fix can never reach anyone who has
// already visited — which is what /_coral/qr.js was, until 2026-07-29. Bumping the coral changes
// the path, so the browser fetches rather than trusting what it already has.
const { version: qrVersion } = JSON.parse(fs.readFileSync(join(CORALS, 'qr/package.json'), 'utf8'));
const { version: drawerVersion } = JSON.parse(fs.readFileSync(join(CORALS, 'drawer/package.json'), 'utf8'));

// ── the signet arrow, taken from the package rather than re-drawn ──────────────────────────────
// A seal with two impressions is not a seal ([[signet-is-the-only-copy]]). cardtile can't import
// Arrow.astro — it renders at the edge, with no Astro — so it takes both halves from the installed
// package at build time: the stylesheet verbatim, and the markup EXTRACTED from Arrow.astro's own
// template. Nothing here is hand-copied, so a signet release reaches cards by regenerating.
//
// The card was previously carrying a hand-written span+svg that reproduced the shape but not the
// behaviour: signet's arrow retracts its tail into the chevron on hover, and the card's never did.
// 🩸 This used to read `../../sitetile/astro/node_modules/@cvernet/signet` — a reach into a
// SIBLING package's install. sitetile graduated to the public CVERInc/tile repo on 2026-08-11 and
// that path stopped existing here, so this generator has been dead since, silently: nothing runs it
// on a schedule, and its output is committed. What surfaced it was the drift gate ("the bundled
// stylesheet is the one on disk") on the first edit to card.css after the graduation — six days.
//
// Now resolved as a declared dependency of THIS package (see ../package.json). Not vendored: signet
// is an import package whose only copy is npm, and a local copy is how publish → bump → deploy gets
// quietly bypassed.
//
// Resolved by PATH rather than by `import.meta.resolve`, because the files this needs (src/arrow.css,
// src/Arrow.astro) are build inputs, not module entry points — signet's `exports` map does not list
// them, and asking the resolver for them is ERR_PACKAGE_PATH_NOT_EXPORTED. The path stays inside
// THIS package, which is the whole difference from what it replaced.
const SIGNET = join(DIR, '../node_modules/@cvernet/signet');
if (!fs.existsSync(join(SIGNET, 'package.json'))) {
  throw new Error('@cvernet/signet is not installed here. Run: npm install --prefix packages/cardtile\n'
    + '(It is a declared dependency of packages/cardtile — see that package.json for why it is not vendored.)');
}
const signetPkg = JSON.parse(fs.readFileSync(join(SIGNET, 'package.json'), 'utf8'));
const arrowCss = fs.readFileSync(join(SIGNET, 'src/arrow.css'), 'utf8');

/** Lift Arrow.astro's template and turn it into a plain HTML string. Throws if its shape changed. */
function arrowHtmlTemplate() {
  const astro = fs.readFileSync(join(SIGNET, 'src/Arrow.astro'), 'utf8');
  const tpl = astro.split(/^---$/m)[2];                       // after the frontmatter fence
  if (!tpl || !tpl.includes('signet-arrow__tail')) throw new Error('Arrow.astro: template not found');
  const svg = /<svg[\s\S]*?<\/svg>/.exec(tpl);
  if (!svg) throw new Error('Arrow.astro: svg not found');
  // Astro expressions → our two knobs. Anything left un-substituted is a shape change we must see.
  const html = svg[0]
    .replace(/=\{size\}/g, '="__SIZE__"')                     // JSX-style attr → a quoted one
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .replace(/> </g, '><');
  if (/[{}]/.test(html)) throw new Error('Arrow.astro: unhandled expression in svg — ' + html);
  // __DIR__ is signet's direction modifier, not a decoration: a link tile points up-right (outbound)
  // and a CTA points right (onward). Baking one in silently rotated the other by 45° — caught by the
  // baseline as an exact +23 bytes, which is the length of " signet-arrow--up-right".
  return `<span class="__CLASS__ signet-arrow__DIR__" style="width:__SIZE__px;height:__SIZE__px;--signet-arrow-w:__SIZE__px" aria-hidden="true"><span class="signet-arrow__tail"></span>${html}</span>`;
}
const ARROW_TEMPLATE = arrowHtmlTemplate();

// scraped-key → author-facing semantic name (what card.md's `icon=` uses)
const KEY = { 'btn-patreon': 'patreon', 'btn-conv': 'conventions', 'btn-shop': 'shop', 'btn-ig': 'instagram', 'btn-x': 'x' };
const icons = {};
for (const [k, v] of Object.entries(raw)) icons[KEY[k] || k] = v;

// signet's stylesheet goes LAST so its rules win over the copy minified into card.css by the
// Python era. When card.css is retired (the stylesheet regrows), this becomes the only source.
const out = `// GENERATED by gen-assets.mjs — do not edit. Card stylesheet + link icons + qr coral client
// for the edge renderer (Workers can't read the filesystem; these must be bundled).
export const CSS = ${JSON.stringify(css + '\n' + arrowCss)};
export const ICONS = ${JSON.stringify(icons)};
export const QR_JS = ${JSON.stringify(qrJs)};
export const QR_VERSION = ${JSON.stringify(qrVersion)};
export const DRAWER_JS = ${JSON.stringify(drawerJs)};
export const DRAWER_VERSION = ${JSON.stringify(drawerVersion)};
// The arrow, from @cvernet/signet@${signetPkg.version}'s own Arrow.astro. Substitute __SIZE__ and __CLASS__.
export const ARROW = ${JSON.stringify(ARROW_TEMPLATE)};
export const SIGNET_VERSION = ${JSON.stringify(signetPkg.version)};
`;
fs.writeFileSync(join(DIR, 'card-assets.mjs'), out);
console.log('wrote card-assets.mjs — icons:', Object.keys(icons).join(', '), '| css', css.length,
            '+ signet arrow.css', arrowCss.length, '| qr.js', qrJs.length, 'bytes @', qrVersion, '| drawer.js', drawerJs.length, '@', drawerVersion,
            '| signet', signetPkg.version);
