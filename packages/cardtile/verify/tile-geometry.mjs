// tile-geometry — the browser half of tile-geometry.test.mjs. Measures COMPUTED geometry, which the
// node ruler cannot see (it pins markup and that the CSS rules exist; this proves they win).
//
// THE RULE
//  1. A run is a grouped list, like an inset-grouped list on iOS: the run's OUTER corners take the
//     card's tile radius (18px), inner seams are square. `.st-run` is a flex column ⇒ the first row
//     rounds TL+TR, the last row BL+BR, middle rows none, a lone row all four.
//  2. A tile type's empty (edit-only) state has the same geometry as its filled state — for a link,
//     the title sits at the same offset from the tile's top as a filled link with the same head.
//  3. A link head with nothing to show (none, or only a favicon that failed) collapses.
//
//   PW=/path/to/node_modules/playwright node verify/tile-geometry.mjs            # local specimen
//   PW=… node verify/tile-geometry.mjs https://<preview-worker>/try/edit          # a served page
// A served page is searched frame by frame for `.st-card` (the editor renders into a srcdoc frame).
// Prints a table; exits 1 on any mismatch, 2 if there was nothing to measure.
const PW = process.env.PW || 'playwright';
const { chromium } = await import(PW.endsWith('.mjs') || PW.endsWith('.js') ? PW : `${PW}/index.mjs`).catch(() => import('playwright'));
const URL_ = process.argv[2];
const R = '18px';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1400 } });
if (URL_) {
  await p.goto(URL_, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
} else {
  const { renderCardHTML } = await import('../serve/card-worker.mjs');
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## run of three', '',
    '- [ ] %% card: link w=6 sub=s %% [first](https://example.com/1)',
    '- [ ] %% card: link w=6 %% middle empty',
    '- [ ] %% card: link w=6 sub=s %% [last](https://example.com/3)',
    '- [ ] %% card: text w=6 %% break', '',
    '- [ ] %% card: link w=6 sub=s %% [lone filled](https://example.com/4)',
    '- [ ] %% card: text w=6 %% break', '',
    '- [ ] %% card: link w=6 %% lone empty',
    '- [ ] %% card: text w=6 %% square tiles', '',
    '- [ ] %% card: link w=3 %% [square filled](https://example.com/5)',
    '- [ ] %% card: link w=3 %% square empty', ''].join('\n');
  await p.setContent(renderCardHTML(md, { handle: 't', cardUrl: '', editIndex: true }), { waitUntil: 'load' });
}

let data = null;
for (const f of p.frames()) {
  data = await f.evaluate(() => {
    if (!document.querySelector('.st-card')) return null;
    const cs = (e) => getComputedStyle(e);
    const corners = (e) => { const s = cs(e); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]; };
    const name = (e) => (e.querySelector('.st-cell-title')?.textContent || '').trim().slice(0, 18);
    const rows = [];
    document.querySelectorAll('.st-card .st-run').forEach((run, ri) => {
      const kids = [...run.children].filter((k) => k.classList.contains('st-cell-tile'));
      kids.forEach((k, i) => {
        const pos = kids.length === 1 ? 'lone' : i === 0 ? 'first' : i === kids.length - 1 ? 'last' : 'middle';
        rows.push({ run: ri, pos, unset: k.classList.contains('st-cell-unset'), name: name(k), corners: corners(k) });
      });
    });
    const links = [...document.querySelectorAll('.st-card .st-cell-tile')].map((k) => {
      const t = k.querySelector('.st-cell-title'), h = k.querySelector('.st-cell-head');
      const hr = h ? h.getBoundingClientRect() : null;
      return { unset: k.classList.contains('st-cell-unset'), name: name(k), w: k.dataset.w || '',
        head: !h ? 'missing' : cs(h).display === 'none' ? 'collapsed' : `${Math.round(hr.height)}px`,
        titleTop: t ? Math.round(t.getBoundingClientRect().top - k.getBoundingClientRect().top) : null };
    });
    return { rows, links };
  }).catch(() => null);
  if (data) break;
}
await b.close();
if (!data) { console.error('no .st-card on the page (or in any frame)'); process.exit(2); }

const want = { first: [R, R, '0px', '0px'], middle: ['0px', '0px', '0px', '0px'], last: ['0px', '0px', R, R], lone: [R, R, R, R] };
let bad = 0;
console.log('run  pos     unset  corners TL/TR/BR/BL           expected                 tile');
for (const r of data.rows) {
  const ok = r.corners.join() === want[r.pos].join(); if (!ok) bad++;
  console.log(`${String(r.run).padEnd(4)} ${r.pos.padEnd(7)} ${String(r.unset).padEnd(6)} ${r.corners.join(' ').padEnd(28)} ${want[r.pos].join(' ').padEnd(24)} ${r.name}${ok ? '' : '   <-- MISMATCH'}`);
}
console.log('\nlink tiles: head / titleTop (px from tile top)');
for (const l of data.links) console.log(`  ${l.unset ? 'unset ' : 'filled'} w=${l.w.padEnd(2)} head=${l.head.padEnd(9)} titleTop=${String(l.titleTop).padEnd(4)} ${l.name}`);
for (const u of data.links.filter((l) => l.unset)) {
  if (u.head === 'missing') { bad++; console.log(`MISMATCH: unset "${u.name}" has no .st-cell-head (the pre-fix placeholder)`); continue; }
  const peer = data.links.find((l) => !l.unset && l.w === u.w && l.head === u.head);
  if (!peer) { console.log(`note: no filled link with w=${u.w} head=${u.head} to compare "${u.name}" against`); continue; }
  if (peer.titleTop !== u.titleTop) { bad++; console.log(`MISMATCH: title offset unset "${u.name}" ${u.titleTop} vs filled "${peer.name}" ${peer.titleTop}`); }
}
if (!data.rows.length) { console.error('no .st-run on the page — nothing to measure'); process.exit(2); }
console.log(bad ? `\n${bad} mismatch(es)` : '\nall tiles match the rule'); process.exit(bad ? 1 : 0);
