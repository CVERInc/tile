// tile#339 measurement — build the two specimen Cards files the measurement serves.
//
//   node make-fixtures.mjs <playwright index.js> <out dir>
//
// Pictures are drawn in Chromium's canvas (no image library in this repo) from a seeded PRNG and encoded
// the way the asset ingest stores them (assets/embed.mjs: WebP up to 1600 px wide, quality ~82), with a
// few JPEG and one PNG among them as `put_asset` can store. Each picture's encoder quality is searched so
// its size lands near a target; the targets are chosen so the served inline page has the shape of a real
// picture-heavy Cards page (heavy: ~9.6 MB of HTML, 36 pictures; medium: ~1.2 MB, 8 pictures). Nothing
// here is anybody's content: the pictures are abstract and numbered, the handle and words are made up.
//
// The output is NOT committed (about 11 MB); this script regenerates it. It is deterministic for one
// Chromium build (the encoders are Chromium's), which is enough: the numbers are about the page's shape.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';

const [PW, OUT] = process.argv.slice(2);
if (!PW || !OUT) throw new Error('usage: node make-fixtures.mjs <playwright index.js> <out dir>');
const { chromium } = createRequire(import.meta.url)(PW);

// [cell width, picture w, picture h, type, target KB, title?]
const HEAVY = [
  ['avatar', 512, 512, 'image/webp', 60],
  ...Array.from({ length: 35 }, (_, i) => {
    const k = i % 5;
    if (k === 0) return [6, 1600, 1000, i === 10 ? 'image/jpeg' : 'image/webp', 280, `Picture ${i + 2}`];
    if (k === 1 || k === 2) return [3, 1200, 1200, i === 6 || i === 21 ? 'image/jpeg' : 'image/webp', 185];
    if (i === 13) return [2, 400, 400, 'image/png', 0];   // an illustration: flat colour, no texture
    return [2, 1000, 1000, i === 28 ? 'image/jpeg' : 'image/webp', 170];
  }),
];
const MEDIUM = [
  ['avatar', 512, 512, 'image/webp', 50],
  [6, 1600, 1000, 'image/webp', 150, 'Picture 2'],
  [3, 1200, 1200, 'image/webp', 120],
  [3, 1200, 1200, 'image/jpeg', 120],
  [2, 1000, 1000, 'image/webp', 85],
  [6, 1600, 1000, 'image/webp', 150, 'Picture 6'],
  [3, 1200, 1200, 'image/webp', 120],
  [2, 1000, 1000, 'image/webp', 85],
];

// Runs in the page: draw picture `n` and encode it near `targetKB`.
const draw = async ({ n, w, h, type, targetKB, seed }) => {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const hue = Math.floor(rnd() * 360);
  const lg = g.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, `hsl(${hue} 60% 30%)`);
  lg.addColorStop(1, `hsl(${(hue + 80 + rnd() * 120) % 360} 70% 55%)`);
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w, y = rnd() * h, r = (0.03 + rnd() * 0.25) * Math.max(w, h);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${Math.floor(rnd() * 360)} 70% ${40 + rnd() * 40}% / ${0.25 + rnd() * 0.5})`);
    rg.addColorStop(1, 'hsla(0 0% 0% / 0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.lineWidth = Math.max(2, w / 300);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `hsla(${Math.floor(rnd() * 360)} 50% ${30 + rnd() * 60}% / .55)`;
    g.beginPath(); g.moveTo(rnd() * w, rnd() * h);
    g.bezierCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h, rnd() * w, rnd() * h); g.stroke();
  }
  // texture: what makes a photo cost bytes
  if (type !== 'image/png') {
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (rnd() - 0.5) * 34; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
    g.putImageData(img, 0, 0);
  }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h * 0.38, w, h * 0.24);
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.16)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n === 1 ? 'Avatar' : `Picture ${n}`, w / 2, h / 2);
  const enc = (q) => new Promise((ok) => c.toBlob((b) => ok(b), type, q));
  const b64 = async (blob) => {
    const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  if (type === 'image/png') return { b64: await b64(await enc()), q: null };
  let lo = 0.05, hi = 0.97, best = null;
  for (let k = 0; k < 9; k++) {
    const q = (lo + hi) / 2; const blob = await enc(q);
    if (!best || Math.abs(blob.size - targetKB * 1024) < Math.abs(best.blob.size - targetKB * 1024)) best = { blob, q };
    if (blob.size > targetKB * 1024) hi = q; else lo = q;
  }
  return { b64: await b64(best.blob), q: Math.round(best.q * 100) / 100 };
};

const browser = await chromium.launch();
const page = await browser.newPage();
fs.mkdirSync(OUT, { recursive: true });

async function build(handle, title, spec) {
  const assets = [];
  const cells = [];
  let n = 0;
  for (const [cw, w, h, type, kb, ttl] of spec) {
    n++;
    const { b64, q } = await page.evaluate(draw, { n, w, h, type, targetKB: kb, seed: (handle.length * 7919 + n * 104729) >>> 0 });
    const bytes = Buffer.from(b64, 'base64');
    const id = `sha256-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
    assets.push({ id, type, b64, bytes: bytes.length, w, h, q });
    if (cw === 'avatar') {
      cells.push(`- [ ] %% card: profile w=6 avatar=asset:${id} chips="specimen, pictures" %% A made-up page for measuring how pictures load.`);
      cells.push('- [ ] %% card: link w=3 %% [Shop](https://example.com/shop)');
      cells.push('- [ ] %% card: link w=3 %% [Newsletter](https://example.com/news)');
      continue;
    }
    const t = ttl ? ` title="${ttl}" cta="Open"` : '';
    cells.push(`- [ ] %% card: feature w=${cw} img=asset:${id} alt="Picture ${n}"${t} href=https://example.com/p${n} %%${ttl ? ' Specimen' : ''}`);
    if (n % 9 === 0) cells.push(`- [ ] %% card: text w=6 %% Section ${n / 9}: a short paragraph between pictures, as pages have.`);
  }
  const md = ['---', `card-page: ${handle}`, `title: ${title}`, '---', '', '## cards', '', ...cells, '',
    '## assets', '', ...assets.map((a) => `- [ ] %% card: asset id=${a.id} mime=${a.type} %% ${a.b64}`)].join('\n') + '\n';
  fs.writeFileSync(join(OUT, `${handle}.card.md`), md);
  // the same page opening on the wall (`view: wall`) — the default view is the stack
  fs.writeFileSync(join(OUT, `${handle}-wall.card.md`), md.replace(`card-page: ${handle}\n`, `card-page: ${handle}-wall\nview: wall\n`));
  const meta = assets.map(({ b64, ...a }) => a);
  fs.writeFileSync(join(OUT, `${handle}.pictures.json`), JSON.stringify(meta, null, 1));
  const total = meta.reduce((s, a) => s + a.bytes, 0);
  console.log(`${handle}: ${meta.length} pictures, ${total} bytes decoded, file ${Buffer.byteLength(md)} bytes`);
}

await build('specimen-heavy', 'Specimen — heavy pictures', HEAVY);
await build('specimen-medium', 'Specimen — medium pictures', MEDIUM);
await browser.close();
