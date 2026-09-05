// Pull a card's remote images INTO the card, so the file is the whole thing.
//
//   node packages/cardtile/assets/embed.mjs <handle> [--budget 1500] [--dry]
//
// WHY THIS EXISTS, and why it is not object storage. A Card must be editable by an agent — GAIDO,
// an MCP tool, a person with a text editor. With images in R2 the edit becomes: upload bytes, mint
// a URL, write the reference, and later work out which blobs nobody points at any more. With images
// in the file it is read, change, write. Binary is precisely where "markdown is the substrate" is
// tested, so this is where the bet gets paid, not waived.
//
// It is also what makes "you can leave" true. Today one demo card hot-links eight images out of the
// platform she is leaving: close that account and the card is blank. Links being clean is not the
// same as being able to go.
//
// 🔴 THE COMPRESSION IS THE PRICE, AND IT SAYS SO. A Card is a single file, so it has a size, so
// pictures get smaller — that is an honest line, not a crippled free tier, and the upgrade it points
// at (a Site, where images are files) is a different medium rather than the same one unlocked. What
// would NOT be honest is doing it quietly: this prints what every image became, and refuses to
// pretend a card fits when it does not.
//
// 🔴 ONLY AT INGEST. The Worker never touches an image. Re-encoding per request would turn every
// card view into image work at the edge, which is the opposite of why a card is one row.
//
// 🔴 CONSENT. Rehosting someone's pictures is a thing you do when they ask you to move them, not
// when you have decided they would probably say yes. Run this on your own card, or on a card whose
// creator pressed the button.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCard, serializeCard } from '../card-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = join(HERE, '../cards');

// sharp lives in the reef app's install — this is a dev-time tool, nothing here ships to the edge.
// 🔴 TRIED in order, not hardcoded to one absolute path. The single hardcoded path is what turned
// this from a tool into a thing only this Mac could run — the same defect ingest-full.mjs had.
const SHARP_CANDIDATES = [
  'sharp',
  process.env.SHARP_PATH,
  join(HERE, '../../../node_modules/sharp/lib/index.js'),
  `${process.env.HOME}/Developer/reef/apps/feelreef/node_modules/sharp/lib/index.js`,
].filter(Boolean);
let sharp = null;
for (const c of SHARP_CANDIDATES) {
  try { sharp = (await import(c)).default; break; } catch { /* try the next */ }
}
if (!sharp) throw new Error('sharp not found. Tried: ' + SHARP_CANDIDATES.join(', '));

const args = process.argv.slice(2);
const handle = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
// 🔴 3000KB, and the number has a reason rather than a feeling — raised from 1500 on 2026-07-30
// after measuring what these pages weigh TODAY, in a real browser:
//
//   HTL           71 requests · 1,298KB · networkidle 2,976ms   → card 1 request ·   114KB
//   PeachyBoys    82 requests · 2,036KB · networkidle 3,095ms   → card 1 request ·   196KB
//   Incrediville 133 requests · 16,180KB · networkidle 8,033ms  → card 1 request · 2,660KB
//
// The budget's job is not "be small in the abstract" — it is "be one document that beats what the
// creator already has". Against 16MB and 133 requests, a 2.6MB single file is six times lighter,
// so refusing it at 1500 was measuring against the wrong thing. chodaict, 2026-07-30: 「不管怎麼樣
// 來我們家都會變快」 — which turned out to be true by a wide margin, and is now evidence.
//
// 🔴 The line itself does NOT move: a Card is one file, so it has a size, and something is still
// too big for one. What changed is where the line sits, and now it sits somewhere justified.
// 🩸 THE BUDGET WAS A NUMBER I MADE UP, TWICE.
//
// 1500 was a feeling. When it refused a real creator's card I raised it to 3000 — also a feeling —
// and then declared that creator 「a Site customer」 on top of it. chodaict, 2026-07-30: 「我單純覺得
// 限制得太著急」. He is right, and the shape is the one this codebase keeps catching: a premise that
// arrives exactly where it makes the argument work.
//
// The only HARD ceiling here is not ours: a KV value is 25MB. Everything else I was calling a limit
// is a SERVING concern, and it exists only because the card inlines its base64 — which is an
// implementation choice, not a property of the format. A Worker route that serves each
// content-addressed asset as its own immutable URL would make images lazy and normal, and then
// weight stops being about first paint at all.
//
// So the default now guards the real ceiling and nothing else. Weight is still REPORTED on every
// import, loudly, because that is how the line eventually gets drawn — from what real cards actually
// weigh, not from what looked reasonable before anybody had thirteen of them.
//
// 🔴 Refusing a creator's card is not "an honest line" to the creator. They experience 「這東西不能
// 用」. Draw the line when the evidence draws it.
const budgetKB = Number((args.find((a) => a.startsWith('--budget')) || '').split(/[= ]/)[1] || 20000);
// 🔴 the usage check belongs INSIDE cli(). At module scope it fired on `import`, so the moment this
// file grew an export, importing it killed the importer with exit(2).

// The ladder. DETERMINISTIC and ordered: the same picture always lands on the same rung, so a
// re-run is a no-op rather than a slow drift downwards. Each rung is tried in turn and the first
// one under `perImageKB` wins; if none do, the last rung is used and the image is reported as the
// reason the card is over budget.
const LADDER = [
  { width: 1600, quality: 82 },
  { width: 1200, quality: 78 },
  { width: 1000, quality: 78 },
  { width: 800, quality: 72 },
  { width: 640, quality: 68 },
];
const PER_IMAGE_KB = 220;

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

/** Every place a card can name an image, as {get,set} accessors over the model. */
function imageRefs(model) {
  const refs = [];
  const fm = model.pre || '';
  const bd = /^backdrop:\s*(.+)$/m.exec(fm);
  if (bd) refs.push({ what: 'backdrop', url: bd[1].trim(), set: (v) => { model.pre = model.pre.replace(bd[0], `backdrop: ${v}`); } });
  const all = [...model.cells, ...(model.drawers || []).flatMap((d) => d.cells)];
  for (const c of all) {
    for (const key of ['avatar', 'img', 'bg', 'poster', 'iconimg']) {
      const v = c.params?.[key];
      if (v && /^https?:/.test(v)) refs.push({ what: `${c.type}.${key}`, url: v, set: (nv) => setParam(c, key, nv) });
    }
    if (c.params?.images && /^https?:/.test(c.params.images)) {
      const list = String(c.params.images).split(/\s*,\s*/).filter(Boolean);
      list.forEach((u, i) => refs.push({
        what: `${c.type}.images[${i}]`, url: u,
        set: (nv) => { list[i] = nv; setParam(c, 'images', list.join(',')); },
      }));
    }
  }
  return refs;
}

/** Rewrite one param in a cell's rawParams (the serialised form) and params (the parsed one). */
function setParam(cell, key, value) {
  cell.params[key] = value;
  const q = /[\s"']/.test(value) ? `"${value}"` : value;
  const re = new RegExp(`(^|\\s)${key}=("[^"]*"|'[^']*'|\\S+)`);
  cell.rawParams = re.test(cell.rawParams)
    ? cell.rawParams.replace(re, `$1${key}=${q}`)
    : `${cell.rawParams} ${key}=${q}`.trim();
}

/** Sniff the mime from the magic bytes, so an untouched original keeps its real type. */
function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString() === '<?xml' || buf.slice(0, 4).toString() === '<svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * 🔴 ANIMATION GETS ITS OWN LADDER, and the still ladder is not allowed to touch it.
 *
 * 🩸 Found 2026-07-30 on 怪奇事物所's avatar — a 66-frame GIF that arrived on the card as a single
 * frozen frame. Nothing was broken; the still ladder did exactly what it says. `candidates.reduce`
 * picks the SMALLEST, and a still WebP of an animated source is 4KB against 123KB for the animated
 * one. So the animation lost every time, by a rule that is correct for stills and was never told
 * this case exists.
 *
 * 🔴 And the still ladder's core assumption is FALSE here: measured on that avatar, 200px q65 came
 * out at 170KB while 256px q65 came out at 123KB. Resizing an animation breaks the similarity
 * BETWEEN frames, which is where an animated codec gets its compression — so "narrower is smaller"
 * simply does not hold. Quality is the only knob that moves the right way; width stays native.
 *
 * The cost is real and is stated rather than hidden: an animated avatar is ~119KB more than a frozen
 * one. That is the creator's identity — chodaict spotted the frozen frame within seconds of looking
 * at the card — so it is worth the bytes, and when it is NOT affordable the caller is told, never
 * silently handed a still.
 */
const ANIMATED_LADDER = [{ quality: 70 }, { quality: 60 }, { quality: 50 }];

async function encodeAnimated(buf, meta) {
  const candidates = [{ buf, rung: { width: meta.width, quality: null }, mime: sniff(buf), kept: true, animated: true }];
  for (const rung of ANIMATED_LADDER) {
    try {
      // 🔴 native width. No `.resize()`, and no `.rotate()` — rotate flattens an animation to its
      // first frame, which is the very defect this branch exists to prevent.
      const out = await sharp(buf, { animated: true }).webp({ quality: rung.quality, effort: 6 }).toBuffer();
      candidates.push({ buf: out, rung: { width: meta.width, quality: rung.quality }, mime: 'image/webp', animated: true });
      if (out.length <= PER_IMAGE_KB * 1024) break;
    } catch { /* an input libvips will not page through falls back to the still path below */ }
  }
  const best = candidates.reduce((a, b) => (b.buf.length < a.buf.length ? b : a));
  return {
    buf: best.buf, mime: best.mime, kept: !!best.kept, rung: best.rung, animated: true,
    frames: meta.pages, outWidth: meta.width, original: buf.length,
    srcWidth: meta.width, srcHeight: meta.height,
    overCap: best.buf.length > PER_IMAGE_KB * 1024,
  };
}

async function encode(buf) {
  const meta = await sharp(buf).metadata();
  // 🔴 BEFORE the still ladder, never after — see encodeAnimated. A frozen frame is not a smaller
  // version of an animation, it is a different picture.
  if ((meta.pages || 1) > 1) {
    const a = await encodeAnimated(buf, meta);
    if (a.buf) return a;
  }
  // 🔴 The original is a CANDIDATE, and so is lossless. Flat-colour artwork — speech bubbles, logos,
  // the things a comic artist actually puts on a card — is what PNG is good at, and lossy WebP at
  // q82 came out BIGGER than the source on every one of a real card's images. "Compression" that
  // inflates a creator's picture and degrades it at the same time is not a trade-off, it is a bug,
  // and it would have shipped silently because the report only ever printed the encoded size.
  const candidates = [{ buf, rung: { width: meta.width, quality: null }, mime: sniff(buf), kept: true }];
  try {
    const ll = await sharp(buf).rotate().webp({ lossless: true, effort: 6 }).toBuffer();
    candidates.push({ buf: ll, rung: { width: meta.width, quality: 'lossless' }, mime: 'image/webp' });
  } catch { /* some inputs can't go lossless; the lossy rungs still apply */ }
  let last = null;
  for (const rung of LADDER) {
    const out = await sharp(buf)
      .rotate()                                        // honour EXIF before resizing, or portraits land sideways
      .resize({ width: Math.min(rung.width, meta.width || rung.width), withoutEnlargement: true })
      .webp({ quality: rung.quality, effort: 6 })
      .toBuffer();
    // Report the size it ACTUALLY came out at, not the rung's ceiling. `withoutEnlargement` means a
    // small original keeps its own width, and printing the ceiling made a 591px avatar read as
    // "591px → 1600px" — an upscale that never happened. A tool whose entire job is to say what it
    // did to a creator's picture cannot be loose about that.
    const outMeta = await sharp(out).metadata();
    last = { buf: out, rung, outWidth: outMeta.width, mime: 'image/webp' };
    candidates.push(last);
    if (out.length <= PER_IMAGE_KB * 1024) break;
  }
  // Smallest wins, and the original wins ties — never re-encode for nothing.
  const best = candidates.reduce((a, b) => (b.buf.length < a.buf.length ? b : a));
  const bestMeta = best.kept ? meta : await sharp(best.buf).metadata();
  return {
    buf: best.buf, mime: best.mime, kept: !!best.kept, rung: best.rung,
    outWidth: bestMeta.width, original: buf.length, srcWidth: meta.width, srcHeight: meta.height,
    overCap: best.buf.length > PER_IMAGE_KB * 1024,
  };
}

/**
 * embedImages(md, opts) → { md, images, bytes, overBudget, log, failed }
 *
 * The whole job, as a function, so the importer can finish what it started: an imported card that
 * still hot-links the platform it came from is not a card anybody can leave with. Extracted
 * 2026-07-30 — the logic was always general, it was only ever reachable through a CLI that read one
 * fixed directory.
 *
 * `quiet` suppresses the per-image lines; the caller gets them in `log` either way. Nothing here
 * writes a file: deciding where the result goes belongs to the caller.
 */
export async function embedImages(md, { budgetKB: bkb = 1500, quiet = false } = {}) {
  const model = parseCard(md);
  const refs = imageRefs(model);
  const log = [];
  const say = (s) => { log.push(s); if (!quiet) console.log(s); };
  const failed = [];
  if (!refs.length) {
    return { md, images: 0, bytes: 0, overBudget: false, log, failed, alreadyLocal: true };
  }
  say(`${refs.length} remote image(s), budget ${bkb}KB`);
  model.assets = model.assets || {};
  let total = 0;
  const seen = new Map();
  for (const ref of refs) {
    if (seen.has(ref.url)) { ref.set(`asset:${seen.get(ref.url)}`); say(`  ${ref.what.padEnd(22)} → reuses ${seen.get(ref.url)}`); continue; }
    let raw;
    try {
      const res = await fetch(ref.url, { headers: { 'User-Agent': 'cardtile-embed' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      raw = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      // 🔴 Reported, not swallowed. An image left as a link is the exact thing this tool exists to
      // remove, so a failure here must reach the caller rather than a console nobody reads.
      failed.push({ what: ref.what, url: ref.url, why: String(e.message || e).slice(0, 60) });
      say(`  ${ref.what.padEnd(22)} ⚠️  could not fetch (${e.message}) — left as a link`);
      continue;
    }
    const enc = await encode(raw);
    const id = 'sha256-' + createHash('sha256').update(enc.buf).digest('hex').slice(0, 16);
    model.assets[id] = { mime: enc.mime, b64: enc.buf.toString('base64') };
    seen.set(ref.url, id);
    ref.set(`asset:${id}`);
    total += enc.buf.length;
    const how = enc.kept
      ? `kept as-is (${enc.mime.replace('image/', '')}) — nothing beat the original`
      : `${enc.srcWidth}px → ${enc.outWidth}px webp `
        + (enc.rung.quality === 'lossless' ? 'lossless' : `q${enc.rung.quality}`)
        + (enc.outWidth === enc.srcWidth ? ', not resized' : '');
    say(`  ${ref.what.padEnd(22)} ${kb(enc.original).padStart(7)} → ${kb(enc.buf.length).padStart(7)}  ${how}`
      + (enc.animated ? `  🎞 ${enc.frames} frames KEPT` : '')
      + (enc.overCap ? '  ⚠️ still over the per-image cap' : ''));
  }
  const out = serializeCard(model);
  say(`images ${kb(total)} · card file ${kb(out.length)} (base64 adds ~33%)`);
  return {
    md: out, images: seen.size, bytes: out.length, failed, log,
    overBudget: out.length > bkb * 1024,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) await cli();

async function cli() {
if (!handle) { console.error('usage: embed.mjs <handle> [--budget 1500] [--dry]'); process.exit(2); }
const file = join(CARDS, `${handle}.card.md`);
const md = fs.readFileSync(file, 'utf8');
const model = parseCard(md);
const refs = imageRefs(model);

if (!refs.length) { console.log('no remote images left — this card already carries its own pictures'); process.exit(0); }

console.log(`${handle}: ${refs.length} remote image(s), budget ${budgetKB}KB\n`);
model.assets = model.assets || {};
let total = 0;
const seen = new Map();                                // url → asset id, so a repeated image is stored once

for (const ref of refs) {
  if (seen.has(ref.url)) { ref.set(`asset:${seen.get(ref.url)}`); console.log(`  ${ref.what.padEnd(22)} → reuses ${seen.get(ref.url)}`); continue; }
  let raw;
  try {
    const res = await fetch(ref.url, { headers: { 'User-Agent': 'cardtile-embed' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    raw = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`  ${ref.what.padEnd(22)} ⚠️  could not fetch (${e.message}) — left as a link`);
    continue;
  }
  const enc = await encode(raw);
  // content-addressed: the same bytes are the same asset, whoever references them
  const id = 'sha256-' + createHash('sha256').update(enc.buf).digest('hex').slice(0, 16);
  model.assets[id] = { mime: enc.mime, b64: enc.buf.toString('base64') };
  seen.set(ref.url, id);
  ref.set(`asset:${id}`);
  total += enc.buf.length;
  const how = enc.kept
    ? `kept as-is (${enc.mime.replace('image/', '')}) — nothing beat the original`
    : `${enc.srcWidth}px → ${enc.outWidth}px webp `
      + (enc.rung.quality === 'lossless' ? 'lossless' : `q${enc.rung.quality}`)
      + (enc.outWidth === enc.srcWidth ? ', not resized' : '');
  console.log(`  ${ref.what.padEnd(22)} ${kb(enc.original).padStart(7)} → ${kb(enc.buf.length).padStart(7)}  ${how}`
    + (enc.overCap ? '  ⚠️ still over the per-image cap' : ''));
}

const out = serializeCard(model);
// base64 costs a third on top of the bytes; the number that matters is what the row weighs.
console.log(`\nimages ${kb(total)} · card file ${kb(out.length)} (base64 adds ~33%)`);
if (out.length > budgetKB * 1024) {
  console.log(`\n🔴 OVER BUDGET by ${kb(out.length - budgetKB * 1024)}. Not written.`);
  console.log('   A Card is one file, so it has a size. This one is a Site: images stay files there,');
  console.log('   at full quality, and nothing has to be squeezed. That is a different medium, not');
  console.log('   this one with the lid off.');
  process.exit(1);
}
if (dry) { console.log('\n--dry: nothing written'); process.exit(0); }
fs.writeFileSync(file, out);
console.log(`\nwrote ${file}`);
console.log('🔴 the KV row still has the old card — see cards/README.md for the --remote write.');
}
