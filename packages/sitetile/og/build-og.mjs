#!/usr/bin/env node
// Render the link-preview cards for a built site, into dist/og/**.png.
//
//   node build-og.mjs <distDir> [--brand "ATLAS.DEV"] [--bg "#084a4c"] [--fg "#ffffff"]
//                                [--reuse <dir>] [--report <file>]
//
// --reuse <dir>   cards a previous build drew, laid out like a site root (<dir>/og/….png, each at
//                 the path its og:image names, untouched). They are CANDIDATES, never trusted for
//                 being there: one is copied in only when the key inside it equals the key of the
//                 card this build would draw (og-card.mjs, "reuse"). A caller may hand over a whole
//                 previous deployment without knowing what changed since.
// --report <file> the counts below as JSON, for a caller that must not parse a sentence.
//
// Runs AFTER astro build and BEFORE deploy. It reads the BUILT html rather than the IR on purpose:
// the title and description in dist/ are the ones that actually shipped, after every merge and
// fallback rule the renderer applies. Re-deriving them here would be a second implementation of
// those rules, free to disagree with the first — which is the failure shape this repo keeps
// meeting (one fact, several projections, no gate between them).
//
// 🔴 THE GATE, and why it is not optional. SiteLayout emits <meta property="og:image"> pointing at
// a path this script has not created yet. If a render silently fails, the page ships a meta tag
// aimed at a 404 — and a broken share card looks exactly like no share card to everyone except the
// person who clicked. So: every og:image a page claims must exist on disk when this exits, and if
// one does not, explicit opt-in FAILS the build. Default-enabled cards may degrade only after
// removing their image metadata, so no surviving claim can point at a missing card.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCardRenderer, ourCardPath, deadCards, cardInputs, cardMatches } from './og-card.mjs';

const arg = (n, d = '') => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DIST = process.argv[2];
if (!DIST || DIST.startsWith('--')) { console.error('build-og: usage: build-og.mjs <distDir> [--brand X] [--bg #] [--fg #]'); process.exit(2); }

// Flags OVERRIDE what the page says; absent, the page decides. Defaults live at the use site.
const BRAND = arg('brand', '');
const BG = arg('bg', '');
const FG = arg('fg', '');
const REUSE = arg('reuse', '');
const REPORT = arg('report', '');
// Never the reason a build fails: the cards are what was asked for, the report is about them.
const report = (counts) => {
  if (!REPORT) return;
  try { writeFileSync(REPORT, JSON.stringify({ v: 1, ...counts }) + '\n'); } catch { /* see above */ }
};

function htmlFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) htmlFiles(p, out);
    else if (e.endsWith('.html')) out.push(p);
  }
  return out;
}
// Deliberately a regex and not a DOM parse: we want three attributes out of a head, the input is
// our own renderer's output, and adding a parser to the image for this would be the expensive half.
const metaOf = (html, prop) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  return tag ? (/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '') : '';
};
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'");

// Brand and colours come from the PAGE, not from flags the caller has to remember to pass. The
// tags are already there and already correct: og:site_name is the site's name (a per-site constant
// since the drift fix), and theme-color is the skin the site actually chose. Reading them here
// means a site's card matches its site without anyone wiring three env vars per tenant — and it
// cannot drift from the site, because it IS the site's own output.
const pages = htmlFiles(DIST).map((file) => {
  const html = readFileSync(file, 'utf8');
  const img = metaOf(html, 'og:image');
  const brand = decode(metaOf(html, 'og:site_name'));
  let title = decode(metaOf(html, 'og:title'));
  // Posts title themselves "<post> — <site>". The card shows the brand on its own line, so leaving
  // the suffix in prints the site's name twice and steals a line from the title.
  if (brand && title.endsWith(` — ${brand}`)) title = title.slice(0, -(brand.length + 3)).trim();
  return { file, html, img, title, brand, bg: decode(metaOf(html, 'theme-color')),
    optional: metaOf(html, 'sitetile:og-card') === 'optional' };
}).filter((p) => p.img);

// Only pages whose card WE are supposed to make. A site that authored its own share-image points
// somewhere else entirely, and that is not ours to overwrite.
const mine = pages.filter((p) => ourCardPath(p.img));

if (!mine.length) {
  report({ cards: 0, rendered: 0, reused: 0, replaced: 0, omitted: 0 });
  console.log('▸ og cards: none requested');
  process.exit(0);
}

// Resolved from the ASTRO package, not from here. This file lives in og/ and the renderer's deps
// are installed in astro/node_modules — node resolution walks UP from the importer, never sideways,
// so a bare `import('satori')` fails here with a message that reads like "not installed" when it is
// installed one directory over.
const ASTRO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'astro');
const req = createRequire(join(ASTRO_DIR, 'package.json'));
const strict = mine.some((p) => !p.optional);
let satori, Resvg, setupError;
try {
  const mod = await import(pathToFileURL(req.resolve('satori')).href);
  // satori ships dual CJK/ESM; importing the resolved CJS entry by URL can nest the callable one
  // level deeper. Take whichever of the three is actually a function rather than assuming a shape.
  satori = [mod.default?.default, mod.default, mod.satori].find((f) => typeof f === 'function');
  if (!satori) throw Object.assign(new Error('satori export is not callable'), { code: 'BAD_EXPORT' });
  ({ Resvg } = req('@resvg/resvg-js'));
} catch (e) {
  if (strict) {
    console.error(`✗ og cards: ${mine.length} page(s) ask for a card but the renderer is not installed (${e.code || 'import failed'}).`);
    console.error('  Deploying now would ship that many meta tags pointing at 404s. Refusing.');
    process.exit(1);
  }
  setupError = e;
}

let renderCard;
// True only when NOTHING can be drawn this run. It changes what a candidate is compared against —
// see cardMatches — and it is tied to the stand-in below so the two cannot come apart.
let rendererDown = false;
try {
  if (setupError) throw setupError;
  const nodeModulesDir = join(ASTRO_DIR, 'node_modules');
  renderCard = makeCardRenderer({ satori, Resvg, nodeModulesDir, packages: ['inter', 'noto-sans-tc'] });
} catch (e) {
  if (strict) throw e;
  // Only optional cards defer setup failures; a card already here survives if it is this page's.
  rendererDown = true;
  renderCard = async () => { throw e; };
}

// Where a previous build's copy of a card would be, if the caller offered one. `rel` has already
// been through ourCardPath, which is what refuses a path that tries to walk somewhere else.
const offered = (rel) => (REUSE ? join(resolve(REUSE), rel) : '');

function omitFailedCard(p) {
  // Only generated, optional cards reach here. Authored images and unrelated metadata survive.
  let html = p.html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (/name=["']sitetile:og-card["']/i.test(tag)) return '';
    if (/(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag)
        && decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] || '') === decode(p.img)) return '';
    if (/name=["']twitter:card["']/i.test(tag)) return tag.replace(/content=["'][^"']*["']/i, 'content="summary"');
    return tag;
  });
  html = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_, open, json, close) => {
      let graph;
      try { graph = JSON.parse(json); } catch { return open + json + close; }
      let changed = false;
      const removeImage = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.image === decode(p.img)) { delete node.image; changed = true; }
        for (const value of Object.values(node)) removeImage(value);
      };
      removeImage(graph);
      return changed ? open + JSON.stringify(graph).replace(/</g, '\\u003c') + close : open + json + close;
    });
  writeFileSync(p.file, html);
  p.img = ''; // The final disk gate must inspect only claims still present in the HTML.
}

const omissions = new Map();
let made = 0, skipped = 0, omitted = 0, replaced = 0;
const t0 = Date.now();
for (const p of mine) {
  const rel = ourCardPath(p.img);
  const outPath = join(DIST, rel);
  const inputs = cardInputs({
    title: p.title || '', brand: BRAND || p.brand || '',
    bg: BG || p.bg || '#111111', fg: FG || '#ffffff',
  });
  // Incrementality without a second source of truth. A card may already be at its path (a caller
  // refilled dist/ from the previous deployment) or be offered under --reuse; either way it is kept
  // only if the key inside it is the key of the card THIS page, on THIS site, with THIS renderer
  // would get. So it costs nothing on a first build (there is nothing to compare), skips everything
  // that did not change afterwards, and can never leave the gate below unsatisfiable.
  //
  // 🩸 This used to be `existsSync(outPath)`, and "it exists" was read as "it is unchanged". That
  // held only while the caller refilled nothing but pages it had proved untouched; the test knew
  // nothing about a renamed site, a new colour or a new renderer, and would have kept every card
  // through all three.
  const want = rendererDown ? { inputs } : { key: typeof renderCard.keyFor === 'function' ? renderCard.keyFor(inputs) : null };
  let kept = false, candidates = 0;
  for (const from of [outPath, offered(rel)]) {
    if (!from) continue;
    let bytes;
    try { bytes = readFileSync(from); } catch { continue; }
    candidates++;
    if (!cardMatches(bytes, want)) continue;
    if (from !== outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, bytes); }
    kept = true;
    break;
  }
  if (kept) { skipped++; continue; }
  // Whatever sits at the path now is not this page's card. Gone BEFORE the attempt, so a draw that
  // fails cannot leave the old picture behind to be deployed under the new page.
  rmSync(outPath, { force: true });
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    const png = await renderCard(inputs);
    writeFileSync(outPath, png);
    made++;
    if (candidates) replaced++;
  } catch (e) {
    if (!p.optional) throw e;
    omitFailedCard(p);
    omitted++;
    const reason = String(e?.message || e).replace(/[\r\n]+/g, ' ');
    const group = omissions.get(reason) || { count: 0, pages: [] };
    group.count++;
    if (group.pages.length < 5) group.pages.push(relative(DIST, p.file));
    omissions.set(reason, group);
  }
}

for (const [reason, group] of omissions) {
  console.error(`og cards: omitted ${group.count} page(s) [${group.pages.join(', ')}${group.count > group.pages.length ? ', ...' : ''}]: ${reason}`);
}

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────
const dead = deadCards(mine, (rel) => existsSync(join(DIST, rel)));
if (dead.length) {
  console.error(`✗ og cards: ${dead.length} page(s) claim an og:image that does not exist on disk:`);
  for (const d of dead.slice(0, 5)) console.error(`    ${d.file} → ${d.img}`);
  console.error('  A dead share card is invisible to everyone except the person who clicked. Failing the build.');
  process.exit(1);
}
report({ cards: mine.length - omitted, rendered: made, reused: skipped, replaced, omitted });
// `replaced` is the number that explains a slow build: cards that came back and were not this
// build's cards. All of them at once means the site or the renderer changed, not that reuse broke.
console.log(`▸ og cards: ${made} rendered${replaced ? ` (${replaced} in place of a card that no longer matches)` : ''}${skipped ? `, ${skipped} unchanged` : ''}${omitted ? `, ${omitted} omitted` : ''} (${Date.now() - t0}ms) — all ${mine.length - omitted} og:image target(s) exist`);
