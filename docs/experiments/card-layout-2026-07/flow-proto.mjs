// The flow model, written from scratch instead of overridden onto the old one.
//
// Three rounds of CSS overrides produced garbage, not a preview — because today's cells are built on
// interlocking assumptions (absolutely-positioned images, a fixed row height, height:100% chains,
// overflow:hidden) and fighting those from outside shows you the fight, not the idea. So: same
// content, read from the real cards through card-core, rendered by ~40 lines of honest CSS.
//
// What is being tested: only `w` is authored (1..6). Rows are `auto`. `dense` does the packing.
// A picture tile is square because the PICTURE carries aspect-ratio — the 防醜 guarantee moved from
// the layout engine to the content type. Everything else takes the height of what is in it.
//
// 🔴 THE CARDS THIS ORIGINALLY RAN ON ARE NOT IN THIS REPO. It read three live creators' cards
// through `readCard`, which at the time resolved to copies of their pages. Those left the package
// on 2026-08-12 (see verify/paths.mjs) and `readCard` resolves to the SPECIMENS now — so the
// handles below are the specimens, and this file runs again instead of dying on ENOENT. The
// numbers in README.md are from the original run on the live cards and are NOT reproducible here;
// they are kept because the finding is the finding, and re-deriving it needs cards of comparable
// shape, not those particular people's.
import fs from 'node:fs';
import { readCard, PLAYWRIGHT } from '../../../packages/cardtile/verify/paths.mjs';
import { parseCard } from '../../../packages/cardtile/card-core.js';

const SPECIMENS = ['specimen-rich', 'specimen-plain', 'specimen-assets'];

const CSS = `
:root{--gap:12px;--ink:#e8f2ff;--dim:#9fb6cc;--line:rgba(120,160,220,.28);--surface:rgba(12,22,44,.72);--accent:#4d8dff}
*{box-sizing:border-box}
body{margin:0;background:#0a1226;color:var(--ink);font:15px/1.5 -apple-system,"PingFang TC",sans-serif;padding:16px}
h2{font-size:.9rem;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin:28px 2px 10px}

/* the whole proposal: six columns, rows sized by content, the browser packs */
.cells{display:grid;grid-template-columns:repeat(6,1fr);gap:var(--gap);grid-auto-flow:row dense;align-items:start}
[data-w="1"]{grid-column:span 1}[data-w="2"]{grid-column:span 2}[data-w="3"]{grid-column:span 3}
[data-w="4"]{grid-column:span 4}[data-w="5"]{grid-column:span 5}[data-w="6"]{grid-column:span 6}

/* chrome is one switch, independent of shape */
.framed{background:var(--surface);border:1px solid var(--line);border-radius:18px}

/* a picture tile: square because it is a picture tile */
.pic{display:block;overflow:hidden;border-radius:18px}
.pic img{display:block;width:100%;aspect-ratio:1;object-fit:cover}
[data-w="6"].pic img{aspect-ratio:2/1}          /* a full-width picture is a banner, not a square */

/* a link: one component, internals follow from its own width */
.link{display:block;text-decoration:none;color:inherit;padding:12px 14px;min-height:64px;
      container-type:inline-size}
.link .in{display:flex;align-items:center;gap:12px;height:100%}
.link img.ico{width:24px;height:24px;border-radius:6px;flex:0 0 auto}
.link .lbl{font-weight:600;min-width:0;overflow-wrap:anywhere}
.link .sub{color:var(--dim);font-size:.82rem}
.link .arw{margin-left:auto;color:var(--accent);flex:0 0 auto}
/* narrow enough that a row would not fit → stack, with no author involvement */
@container (max-width: 200px){
  .link .in{flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:6px}
  .link .arw{margin-left:0}
}
.prose{padding:14px;font-size:.9rem;line-height:1.7}
.prose p{margin:0 0 .7em}
`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkOf = (b) => { const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(b || ''); return m ? { label: m[1], url: m[2] } : { label: (b || '').trim(), url: '#' }; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const asset = (u, assets) => { const m = /^asset:(.+)$/.exec(String(u || '')); if (!m) return u; const a = assets[m[1].trim()]; return a ? `data:${a.mime};base64,${a.b64}` : ''; };

function cell(c, assets) {
  const p = c.params || {}, b = (c.body || '').trim();
  // 🔴 THE PROPOSAL: a link defaults to full width — it is a ROW unless the author says otherwise.
  // The cards still say w=2 from the tile era, so honouring their w would test today, not this.
  // Pictures keep their authored width, because a picture's size is a real editorial choice.
  const w = c.type === 'link'
    ? (process.env.KEEP_W ? Math.min(6, Number(p.w) || 6) : 6)
    : Math.min(6, Math.max(1, Number(p.w) || 6));
  const box = (inner, cls = '') => `<div data-w="${w}" class="${cls}">${inner}</div>`;
  if (c.type === 'profile') return '';
  if (c.type === 'feature') {
    const src = asset(p.img, assets);
    return box(`<a class="pic" href="${esc(p.href || '#')}"><img src="${esc(src)}" alt=""></a>`, 'pic');
  }
  if (c.type === 'link') {
    const { label, url } = linkOf(b);
    const ico = p.iconimg || (host(url) ? `https://icons.duckduckgo.com/ip3/${host(url)}.ico` : '');
    return box(`<a class="link" href="${esc(url)}"><span class="in">`
      + (ico ? `<img class="ico" src="${esc(ico)}" alt="">` : '')
      + `<span class="lbl">${esc(label)}${p.sub ? `<br><span class="sub">${esc(p.sub)}</span>` : ''}</span>`
      + `<span class="arw">›</span></span></a>`, 'framed');
  }
  if (c.type === 'text') return box(`<div class="prose">${esc(b).replace(/\n{2,}/g, '</p><p>').replace(/^/, '<p>') + '</p>'}</div>`, 'framed');
  return '';
}

function page(handle) {
  const md = readCard(handle);
  const m = parseCard(md);
  const blocks = m.blocks.map((blk) => {
    const cells = m.cells.slice(blk.start, blk.start + blk.count).map((c) => cell(c, m.assets)).join('');
    if (!cells.trim()) return '';
    return (blk.label ? `<h2>${esc(blk.label)}</h2>` : '') + `<div class="cells">${cells}</div>`;
  }).join('');
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${CSS}</style><body>${blocks}`;
}

for (const h of SPECIMENS) {
  fs.writeFileSync(`/tmp/proto-${h}.html`, page(h));
}

const pw = (await import(PLAYWRIGHT)).default;
const b = await pw.chromium.launch();
console.log('card        height  cells  overlaps  rows(ar>2.5)  tiles');
for (const h of SPECIMENS) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto('file:///tmp/proto-' + h + '.html', { waitUntil: 'load' });
  await pg.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await pg.waitForTimeout(800);
  const m = await pg.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.cells > *')).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    let ov = 0;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], c2 = cs[j];
      if (a.x < c2.x + c2.w - 1 && c2.x < a.x + a.w - 1 && a.y < c2.y + c2.h - 1 && c2.y < a.y + a.h - 1) ov++;
    }
    return { h: document.documentElement.scrollHeight, n: cs.length, ov,
      rows: cs.filter((c2) => c2.h && c2.w / c2.h >= 2.5).length,
      tiles: cs.filter((c2) => c2.h && c2.w / c2.h < 2.5).length };
  });
  console.log(`${h.padEnd(11)} ${String(m.h).padEnd(7)} ${String(m.n).padEnd(6)} ${String(m.ov).padEnd(9)} ${String(m.rows).padEnd(13)} ${m.tiles}`);
  await pg.screenshot({ path: `/tmp/proto-${h}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log('\n/tmp/proto-<card>.png');
