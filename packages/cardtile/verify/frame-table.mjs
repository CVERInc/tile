// The frame table, made into a gate.
//
// SPEC-card-draft.md, "The frame — decided":
//
//   不能按的不准長得像按鈕。能按的必須看得出來能按。
//
//   | link, drawer opener, QR, social | the lane surface + a chevron |
//   | prose                           | none — text on the ground    |
//   | header / avatar / tagline       | none                         |
//   | picture                         | the picture is the surface   |
//
// 🔴 WHY THIS FILE EXISTS. That table was decided, prose was implemented against it (88c07c0), and
// the header simply never was — `.st-hero` kept `.st-cell`'s surface, border and radius plus its own
// gradient for weeks. Nobody noticed because no check encoded the table; it was found by looking at a
// screenshot for an unrelated reason. A decided rule with no gate is a rule that drifts, so the rule
// now has one.
//
// The control is built into the shape of the test rather than bolted on: the SAME probe reads all
// four content types, and two of them must have a frame while two must not. A probe that cannot see
// frames fails the link row; a probe that sees frames everywhere fails the header and prose rows.
// There is no way for it to pass while being blind.
//
//   node packages/cardtile/verify/frame-table.mjs
import http from 'node:http';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// 🩸 Three customer handles used to be listed here, and they left this package on 2026-08-12.
// The frame table is a rule about the RENDERER, so the input was always interchangeable — naming
// customers only meant the gate died the day they moved.
// 🔴 Which specimen goes where is NOT positional: the veil checks need one card WITH a backdrop
// and at least one WITHOUT, so both are picked by reading the cards.
const SPECIMENS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const hasBackdrop = (h) => /^backdrop:/m.test(readCard(h));
const WITH_BACKDROP = SPECIMENS.find(hasBackdrop);
const WITHOUT_BACKDROP = SPECIMENS.filter((h) => !hasBackdrop(h));
if (!WITH_BACKDROP || !WITHOUT_BACKDROP.length) {
  throw new Error('the veil checks need one specimen with a backdrop and at least one without');
}
const REAL = SPECIMENS;
// One card carrying every row of the table at once, including the two the real cards lack (prose,
// and a bare picture). `backdrop` is deliberately absent here — the veil case is checked separately
// on a backdrop card, because a veil is the one thing that must NOT be mistaken for a frame.
// 🔴 `arrows: on` because the chevron is OPT-IN — arrowOf() is
// `ctx.arrows === 'on' ? … : ''`, and no card renders one without asking. The frame table's link row
// says "the lane surface + a chevron", which is the rule for a card that HAS arrows; asserting the
// chevron on a card that never opted in was testing the default, not the rule, and reported
// "a link has no chevron" about a card that correctly has none.
const ALL = ['---', 'card-page: all', 'title: All', 'accent: #0556ff', 'arrows: on', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar="https://example.com/avatar.jpg" chips="a | b" %% A tagline',
  '- [ ] %% card: text w=6 %% A paragraph that is not a button and must not look like one.',
  // a BARE picture: `feature` with no title, cta or body, which is the "the picture is the surface" case
  '- [ ] %% card: feature w=3 img="https://example.com/cover.jpg" href="https://example.com" %%',
  '- [ ] %% card: link w=3 icon=shop sub="a sub" %% [Shop](https://example.com)',
  // a RUN of full-width rows — the other half of the "link" row of the table, and the half that
  // changed when the run became a real element. Three, because the doubled-divider bug only appeared
  // from the THIRD row on: two rows looked perfect while the mechanism was already broken.
  '- [ ] %% card: link w=6 icon=shop %% [One](https://example.com)',
  '- [ ] %% card: link w=6 icon=shop %% [Two](https://example.com)',
  '- [ ] %% card: link w=6 icon=shop %% [Three](https://example.com)',
].join('\n');

const store = { get: async (h) => (h === 'all' ? ALL : REAL.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

// What "wearing a frame" means, read off computed style. A frame is an EDGE — a border or a radius
// or a shadow. It is deliberately not "has a background": the header's backdrop veil is a background
// and is not a frame, and that distinction is the whole point of the row it appears in.
async function read(handle, scheme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const framed = (el) => {
      const c = getComputedStyle(el);
      const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(c['border' + s + 'Width']) || 0);
      const br = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => parseFloat(c['border' + s + 'Radius']) || 0);
      const visibleBorder = bw.some((w) => w > 0) && c.borderTopStyle !== 'none'
        && !/transparent|rgba\(0, 0, 0, 0\)/.test(c.borderTopColor);
      return {
        border: visibleBorder,
        radius: br.some((r) => r > 0),
        shadow: c.boxShadow !== 'none',
        bg: c.backgroundColor,
        bgImage: c.backgroundImage !== 'none',
        // 🔴 A DIVIDER IS NOT A FRAME, and conflating them made this harness report the correct
        // render as broken. A frame ENCLOSES — it needs a radius, or an edge on a side other than
        // the one it shares with the row above. A single `border-top` is the hairline between two
        // rows of one surface, which is the thing we are building, not the thing we are forbidding.
        encloses: br.some((r) => r > 0) || (bw[1] > 0 || bw[2] > 0 || bw[3] > 0),
      };
    };
    const one = (sel) => { const el = document.querySelector(sel); return el ? framed(el) : null; };
    const link = document.querySelector('.st-cell-tile');
    return {
      header: one('.st-hero'),
      prose: one('.st-prose'),
      picture: one('.st-gal-cell'),
      link: link ? framed(link) : null,
      // "the picture is the surface" — the image fills the cell, no inset
      picFills: (() => {
        const cell = document.querySelector('.st-gal-cell');
        const img = cell && cell.querySelector('.st-gal-img');
        if (!cell || !img) return null;
        const a = cell.getBoundingClientRect(), b = img.getBoundingClientRect();
        return {
          ok: Math.abs(a.width - b.width) <= 1 && Math.abs(a.top - b.top) <= 1,
          cell: `${Math.round(a.width)}x${Math.round(a.height)}`,
          img: `${Math.round(b.width)}x${Math.round(b.height)}`,
          inset: `${Math.round(b.left - a.left)},${Math.round(b.top - a.top)}`,
          bare: cell.classList.contains('st-gal-cell-bare'),
        };
      })(),
      // "+ a chevron"
      chevron: !!(link && link.querySelector('.st-cell-arrow, .signet-arrow')),
      // "the LANE surface" — a run of full-width rows is one framed box, and the rows inside are
      // plain, evenly divided, edge to edge.
      run: (() => {
        const run = document.querySelector('.st-run');
        if (!run) return null;
        const rows = [...run.children];
        const rb = run.getBoundingClientRect();
        const boxes = rows.map((r) => r.getBoundingClientRect());
        return {
          framed: framed(run),
          rows: rows.length,
          childFramed: rows.filter((r) => framed(r).encloses).length,
          // 🔴 the actual bug: a 1px sliver between rows read as a doubled divider
          gaps: boxes.slice(1).map((b, i) => Math.round(b.top - boxes[i].bottom)),
          // and rows must span the run, or the divider stops mid-card and the chevron loses its edge
          fullWidth: boxes.every((b) => Math.abs(b.width - rb.width) <= 2),
          dividers: rows.filter((r) => parseFloat(getComputedStyle(r).borderTopWidth) > 0).length,
        };
      })(),
    };
  });
  await ctx.close();
  return out;
}

// 🔴 A RADIUS CLIPS SOMETHING, OR IT CLIPS NOTHING. The rule above deliberately says a frame is an
// edge and not "has a background" — that is what keeps the header's backdrop veil from counting.
// But it also made a radius on a fully TRANSPARENT box count, and such a radius is invisible:
// measured 2026-08-12, `prose` and `picture` render identically (border=0 radius=1 shadow=0
// bg=none) and one was reported as WEARING A FRAME while the other passed.
//
// So a radius counts only when there is something for it to round off. A background alone still is
// not a frame, which is the distinction the original rule exists to protect.
const PAINTS_NOTHING = (f) => !f.border && !f.shadow && !f.bgImage
  && /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(f.bg);
const anyEdge = (f) => f.border || f.shadow || (f.radius && !PAINTS_NOTHING(f));
// 🔴 `bg` is printed now. A radius counts as an edge (see anyEdge), but a radius on a TRANSPARENT
// box is invisible — so a reader who sees "radius=1 🔴 WEARS A FRAME" needs the one fact that says
// whether anything was actually painted. It was captured all along and never shown.
const show = (f) => f ? `border=${+f.border} radius=${+f.radius} shadow=${+f.shadow} bg=${/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(f.bg) ? 'none' : f.bg}` : 'ABSENT';

console.log('every row of the frame table, on one card that carries all four\n');
const all = await read('all');
for (const [row, want] of [['header', false], ['prose', false], ['picture', 'surface'], ['link', true]]) {
  const f = all[row];
  if (!f) { console.log(`  ${row.padEnd(9)} 🔴 not rendered — this row was not tested at all`); bad++; continue; }
  const edge = anyEdge(f);
  if (want === false) {
    console.log(`  ${row.padEnd(9)} ${show(f)}   ${edge ? '🔴 WEARS A FRAME' : 'no frame ✓'}`);
    if (edge) { console.log(`     the table says "${row}" carries no frame`); bad++; }
  } else if (want === true) {
    console.log(`  ${row.padEnd(9)} ${show(f)}   ${edge ? 'framed ✓' : '🔴 NO FRAME'}   chevron=${+all.chevron}`);
    // 🔴 This is the CONTROL for the two rows above: if the probe cannot see a frame here, its
    // "no frame" verdicts mean nothing.
    if (!edge) { console.log('     🔴 CONTROL: the probe found no frame on a LINK — it cannot see frames, so the rows above proved nothing'); bad++; }
    if (!all.chevron) { console.log('     🔴 a link has no chevron — "must look like you can tap it" is half the rule'); bad++; }
  } else {
    const p = all.picFills;
    console.log(`  ${row.padEnd(9)} ${show(f)}   cell ${p.cell} img ${p.img} inset ${p.inset}  bare=${+p.bare}   ${p.ok ? 'fills ✓' : '🔴 INSET'}`);
    if (!p.ok) { console.log('     🔴 the picture is not the surface — the image does not fill its cell'); bad++; }
  }
}

console.log('\na RUN of full-width rows is ONE surface — "the lane surface", literally');
const r = all.run;
if (!r) { console.log('  🔴 no .st-run rendered — the run case was not tested at all'); bad++; }
else {
  console.log(`  ${r.rows} rows  run framed=${+r.framed.border}/${+r.framed.radius}  rows framed=${r.childFramed}  gaps=[${r.gaps}]  fullWidth=${r.fullWidth}  dividers=${r.dividers}`);
  if (!r.framed.border || !r.framed.radius) { console.log('   🔴 the run itself carries no surface'); bad++; }
  if (r.childFramed) { console.log(`   🔴 ${r.childFramed} row(s) inside the run still wear their own frame — that is a stack of buttons`); bad++; }
  // 🔴 the defect this replaced: subpixel rounding left a 1px sliver and the divider read as doubled
  if (r.gaps.some((g) => g !== 0)) { console.log(`   🔴 rows do not touch (${r.gaps}) — a sliver of page shows through as a doubled divider`); bad++; }
  if (!r.fullWidth) { console.log('   🔴 rows do not span the run — the divider stops mid-card and the chevron loses its edge'); bad++; }
  // rows - 1 dividers: every row but the first
  if (r.dividers !== r.rows - 1) { console.log(`   🔴 ${r.dividers} dividers for ${r.rows} rows — expected ${r.rows - 1}`); bad++; }
}

// The veil must not read as a frame, and must not be mistaken for one by this harness either.
console.log('\nthe backdrop veil is a background, not a frame');
for (const scheme of ['dark', 'light']) {
  const n = await read(WITH_BACKDROP, scheme);
  const edge = anyEdge(n.header);
  console.log(`  ${WITH_BACKDROP.padEnd(15)} ${scheme.padEnd(6)} ${show(n.header)}   veil=${+n.header.bgImage}   ${edge ? '🔴 FRAME' : 'no frame ✓'}`);
  if (edge) { console.log('     🔴 the header grew an edge on a backdrop card'); bad++; }
  // 🔴 REVERSED 2026-07-30. This used to REQUIRE a veil — a `--cp-ground` plate under the header on
  // any backdrop card — because stripping the frame had put a tagline on bare artwork at
  // 1.89:1. chodaict: 「st-cell st-hero 目前疊超多層顏色,有沒有可能弄出『沒有背景色也好看的版本』?」
  //
  // He was right, and the 1.89 was never the artwork's fault: the tagline was wearing `--cp-muted`,
  // a colour derived for a surface it was not on, and my "fix" then forced #fff, which is worse
  // still in light mode where the scrim brightens the picture. With THEMED ink the same text measures
  // 5.70 dark / 10.36 light on the bare artwork (verify/theme.mjs), no plate involved.
  //
  // So the assertion inverts: a header on a backdrop card must carry NO background of any kind.
  // The legibility claim did not disappear with it — theme.mjs scores it against real pixels.
  if (n.header.bgImage || !/rgba\(0, 0, 0, 0\)|transparent/.test(n.header.bg)) {
    console.log(`     🔴 the header has a background on a backdrop card (${n.header.bgImage ? 'image' : n.header.bg}) — 沒有背景色`);
    bad++;
  }
}

// And a card with NO backdrop must not carry the veil — it would be a band of ground on the ground.
console.log('\na card with no backdrop carries no veil');
for (const handle of WITHOUT_BACKDROP) {
  const f = (await read(handle)).header;
  console.log(`  ${handle.padEnd(10)} ${show(f)}   veil=${+f.bgImage}`);
  if (f.bgImage) { console.log('     🔴 veil on a card with no backdrop'); bad++; }
  if (anyEdge(f)) { console.log('     🔴 the header wears a frame'); bad++; }
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ every row of the frame table holds, and the probe proved it can see a frame');
process.exitCode = bad ? 1 : 0;
