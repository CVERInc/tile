// grid `filter=` over plain (non-image) cards, with and without `pack=masonry`, in a real browser.
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/grid-filter/filter-masonry.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/grid-filter/
//
// 🩸 WHY THIS EXISTS. Two defects, both on origin/main as of 2026-10-31, found while verifying
// tile#223 — neither visible to any test, because nothing had ever clicked a pill:
//   · the pills come from EVERY cell's badge (gridFacets), but only image cards carried
//     `data-cat`. On a plain-card grid the filter compared each pill against `null`, so below
//     992 px every pill hid every cell — the section went blank on the first click.
//   · at ≥992 px `pack=masonry` moves the cells into column wrappers before the filter wires,
//     and the filter only looked for `.st-cells > …` (direct children): it found no cells at
//     all, so every pill did nothing.
// The fix: every cell carries its category (packages/emit/grid.mjs); the filter finds cells
// wherever masonry put them and says when it changed the visible set; masonry re-lays out only
// the visible cells, so a filtered result fills the columns from the top instead of leaving
// the holes where the hidden cards were.
//
// 🔴 The markup is the EMITTER's (emitGrid, the function sitetile's Grid.astro calls), and the
// scripts are the committed BUILT corals — the same bytes a Worker host serves. Both script
// orders run: Astro bundles masonry first (Grid.astro's import order), a Worker host may not.
// They load as `type="module"`, the way Astro emits them: deferred, so each one runs with the
// document already parsed — a classic script at the end of <body> would instead see
// readyState 'loading', and masonry would postpone itself to DOMContentLoaded behind the filter,
// which is not the order a real sitetile page runs them in.
//
// 🔴 The masonry layout arm needs a CONTROL. "the filtered cells fill three columns" is only a
// finding if they would NOT on their own: the Acme cells sit at indices 0, 3 and 6, which
// index-parity bucketing puts all in column 0 — so the check below is red unless masonry really
// re-bucketed the visible set.
import { parseSite, inlineHtml, bodyHtml, gridCellBodyHtml } from '../../sitetile/site-core.js';
import { emitGrid } from '../../emit/grid.mjs';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node filter-masonry.smoke.mjs <url of packages/dynamic-corals/grid-filter/>');
const fixtureUrl = new URL('__filter-masonry-host.html', base).href;
const FILTER_JS = new URL('grid-filter.js', base).href;
const MASONRY_JS = new URL('../grid-masonry/grid-masonry.js', base).href;

// Nine plain cells in the shapes a plain grid has: a bare <div>, a whole-cell link, a link with a
// labelled CTA (badge goes into the foot), and two with no badge at all (in no facet).
const CELLS = [
  '### C0 [Acme]\nzero', '### C1 →/one [Beta]\none', '### C2\ntwo', '### C3 →/three "Read" [Acme]\nthree',
  '### C4 [Beta]\nfour', '### C5 →/five [Gamma]\nfive', '### C6 [Acme]\nsix', '### C7 [Gamma]\nseven', '### C8\neight',
];
const EXPECT = { '': ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'], Acme: ['C0', 'C3', 'C6'], Beta: ['C1', 'C4'], Gamma: ['C5', 'C7'] };
const section = parseSite(`---\ntitle: t\n---\n\n## Grid\n%% sitetile: grid filter=All %%\n${CELLS.join('\n\n')}\n`).sections[0];
const ctx = { hero: false, inline: inlineHtml, block: bodyHtml, cellBlock: gridCellBodyHtml };
const gridHtml = (packMasonry) => emitGrid(section, { eyebrow: null, cols: '', imageCards: false, more: null, packMasonry, surface: undefined, filterLabel: 'All' }, ctx);

const hostPage = ({ packMasonry, order }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>body{margin:0;font:16px/1.4 sans-serif}main{padding:0 16px}
.st-cell{display:block;border:1px solid #888;padding:8px;margin:0 0 12px}.st-cells:not([data-pack]){display:grid;grid-template-columns:repeat(3,1fr);gap:12px}</style></head>
<body><main>${gridHtml(packMasonry)}</main>
${order.map((s) => `<script type="module" src="${s === 'filter' ? FILTER_JS : MASONRY_JS}"></script>`).join('\n')}
</body></html>`;

const b = await chromium.launch();
const failures = [];
let passed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Visible cells, in reading order of the original markup, with their boxes. */
const visible = (p) => p.evaluate(() => [...document.querySelectorAll('.st-cell')]
  .filter((c) => c.isConnected && !c.closest('[hidden]') && c.getClientRects().length > 0)
  .map((c) => { const r = c.getBoundingClientRect(); return { t: c.querySelector('h3').textContent, x: Math.round(r.left), y: Math.round(r.top + scrollY) }; })
  .sort((a, b) => a.t.localeCompare(b.t)));
const pill = (p, cat) => p.click(cat ? `.st-filter-pill[data-cat="${cat}"]` : '.st-filter-pill[data-cat=""]');
const distinct = (xs) => new Set(xs).size;

async function arm({ label, width, packMasonry, order }) {
  console.log(`▸ ${label}`);
  const ctx2 = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx2.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: hostPage({ packMasonry, order }) }));
  await p.goto(fixtureUrl, { waitUntil: 'load', timeout: 20000 });
  const cols = packMasonry ? (width >= 1400 ? 3 : width >= 992 ? 2 : 1) : null;
  if (packMasonry) {
    const wrapped = await p.evaluate(() => document.querySelectorAll('.st-cells > div:not(.st-cell)').length);
    check(`${label}: masonry ran (${cols === 1 ? 'no' : cols} column wrappers)`, wrapped === (cols === 1 ? 0 : cols), `wrappers=${wrapped}`);
  }
  for (const cat of ['Acme', 'Beta', 'Gamma', '']) {
    await pill(p, cat);
    const vis = await visible(p);
    const got = vis.map((v) => v.t);
    check(`${label}: pill ${cat || 'All'} shows exactly ${EXPECT[cat].join(',')}`, JSON.stringify(got) === JSON.stringify(EXPECT[cat]), `shows ${got.join(',') || '(nothing)'}`);
    const pressed = await p.evaluate(() => [...document.querySelectorAll('.st-filter-pill[aria-pressed="true"]')].map((e) => e.dataset.cat));
    check(`${label}: pill ${cat || 'All'} is the one pressed`, JSON.stringify(pressed) === JSON.stringify([cat]), `pressed=${JSON.stringify(pressed)}`);
    if (cols > 1 && vis.length) {
      // The visible set fills the columns from the top: its first `cols` cells (DOM order) share
      // a top edge on `min(n, cols)` distinct columns.
      const top = vis.slice(0, cols);
      check(`${label}: pill ${cat || 'All'} — masonry re-laid out the visible set (${top.length} columns, one top row)`,
        distinct(top.map((v) => v.x)) === top.length && distinct(top.map((v) => v.y)) === 1,
        `first row ${JSON.stringify(top)}`);
    }
  }
  if (packMasonry && width >= 1400) {
    // A resize re-runs masonry; it must keep the filter's answer, and re-bucket for the new count.
    await pill(p, 'Acme');
    await p.setViewportSize({ width: 1100, height: 900 });
    await p.waitForTimeout(400);
    const vis = await visible(p);
    check(`${label}: after a resize to 2 columns the Acme filter still holds`, JSON.stringify(vis.map((v) => v.t)) === JSON.stringify(EXPECT.Acme), `shows ${vis.map((v) => v.t).join(',')}`);
    check(`${label}: …and the three Acme cells sit in 2 columns`, distinct(vis.map((v) => v.x)) === 2, JSON.stringify(vis));
    await pill(p, '');
    const all = await p.evaluate(() => [...document.querySelectorAll('.st-cells > div:not(.st-cell)')].map((w) => [...w.querySelectorAll('h3')].map((h) => h.textContent).join(',')));
    check(`${label}: back to All, the cells are bucketed by their original index again`, JSON.stringify(all) === JSON.stringify(['C0,C2,C4,C6,C8', 'C1,C3,C5,C7']), JSON.stringify(all));
  }
  check(`${label}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx2.close();
}

try {
  for (const width of [390, 1440]) {
    await arm({ label: `${width}px plain pack`, width, packMasonry: false, order: ['filter'] });
    await arm({ label: `${width}px masonry (masonry script first)`, width, packMasonry: true, order: ['masonry', 'filter'] });
    await arm({ label: `${width}px masonry (filter script first)`, width, packMasonry: true, order: ['filter', 'masonry'] });
  }
} finally {
  await b.close();
}
console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
