// The cell-layer rebuild, measured against the REAL previous renderer.
//
// 🔴 The first version of this compared against a hand-reconstructed "old" stylesheet pinned with
// !important. That is the same trap as every other broken instrument today: a reconstruction is a
// guess, my new rules were still applying underneath it, and the "before" column was measuring
// something that never shipped. So the baseline is a `git worktree` at HEAD — the actual bytes the
// last commit renders — and this file drives both.
//
//   git worktree add --detach <dir> HEAD~1
//   git -C <dir> submodule update --init --recursive      ← 🔴 not optional, see below
//   CARD_BASELINE=<dir> node packages/cardtile/verify/cell-layer.mjs
//
// 🩸 A WORKTREE DOES NOT BRING SUBMODULES, and since engine/ became one (2026-08-13) this half has
// been unable to run AT ALL: the baseline tree has an empty engine/, every import from it fails,
// and the harness died on ERR_MODULE_NOT_FOUND before measuring anything. Third place that same
// property has bitten in one day — after scripts/test-clean.sh and CI's actions/checkout. The
// harness checks for it now rather than exploding, because a tool that dies on a missing directory
// teaches you nothing about the thing you asked it about.
//
// Reports, per card: page height, cell geometry, overlaps, and a pixel diff. Nothing here decides
// whether the result is BETTER — that is a judgement and it needs the maintainer's eye. What it
// decides is whether the result is CORRECT: no overlaps, no clipping, squares landing on whole
// units, and every outbound link still present.
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';

const BASELINE = process.env.CARD_BASELINE;
if (BASELINE) {
  const { existsSync } = await import('node:fs');
  // 🩸 This marker used to be `<baseline>/engine/packages/tugtile/board-core.js`, and it was
  // checking for a SUBMODULE: cardtile lived in the incubator, and a `git worktree add` there
  // produces an empty engine/, so a baseline comparison would have been run against a tree that
  // could not import half of itself. Both halves are in one repo since 2026-09-07, so a worktree
  // of THIS repo is complete — and the marker has to move with the file, or it goes on checking a
  // path that can never exist and this exits 1 on every baseline run.
  const marker = `${BASELINE}/packages/tugtile/board-core.js`;
  if (!existsSync(marker)) {
    console.error(`✗ CARD_BASELINE=${BASELINE} does not look like a checkout of this repo — ${marker} is missing.`);
    console.error('  It wants a worktree of CVERInc/tile:  git worktree add <dir> <ref>');
    process.exit(1);
  }
}
const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const VIEW = { width: 390, height: 844 };

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

/** Serve the three cards from a given checkout of the renderer. */
async function serverFor(root) {
  const worker = (await import(root ? join(root, 'packages/cardtile/serve/card-worker.mjs') : '../serve/card-worker.mjs')).default;
  const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
  const server = http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
    const b = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(b);
  });
  await new Promise((ok) => server.listen(0, ok));
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

async function look(base, handle, tag) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    // 🔴 A run of full-width rows is now ONE grid item (`.st-run`) with the rows inside it, so
    // "direct children of .st-cells" stopped seeing rows at all — this harness's row control fired
    // ("the row case was not exercised"), which is precisely what it is for. Descend into a run so
    // the unit measured is still the CELL, whatever the grid happens to hold.
    const cells = Array.from(document.querySelectorAll('.st-cells > *'))
      .flatMap((el) => (el.classList.contains('st-run') ? Array.from(el.children) : [el]));
    const box = cells.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height),
        clipped: el.scrollHeight - el.clientHeight > 2,
        span: el.getAttribute('data-span'),
        // 🩸 A CLOSED DRAWER'S CELLS STILL HAVE GEOMETRY. They are `visibility: hidden`, not removed,
        // so they are laid out, they have boxes, and those boxes sit wherever the flow put them. The
        // overlap check below ran over every cell in the document and never noticed, because the
        // specimen had exactly ONE drawer and one lane cannot collide with itself. A second drawer
        // was added on 2026-08-12 and the two hidden lanes landed 33px apart — a red about two things
        // nobody can see. An overlap is only a defect between cells that are BOTH being shown.
        shown: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      };
    });
    const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
    const countOverlaps = (bs) => {
      let n = 0;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) n++;
      return n;
    };
    const visible = box.filter((b) => b.shown);
    const overlaps = countOverlaps(visible);
    // 🔴 CONTROL. The check above has never been shown to fire: every card it has been pointed at
    // laid out correctly, so "0 overlaps" and "the loop compared nothing" printed the same thing.
    // Put a real cell on top of its neighbour and count again — if that does not go up, the zero
    // above means nothing. Done on the measured BOXES, not the DOM, so the page is never disturbed.
    const forced = visible.length > 1
      ? countOverlaps([{ ...visible[0] }, { ...visible[1], x: visible[0].x, y: visible[0].y }, ...visible.slice(2)])
      : -1;
    // does any picture spill out of the cell that holds it?
    let spill = 0;
    for (const img of document.querySelectorAll('.st-gal-img')) {
      const cell = img.closest('.st-cell');
      if (!cell) continue;
      const ir = img.getBoundingClientRect(), cr = cell.getBoundingClientRect();
      if (ir.height - cr.height > 2 || ir.width - cr.width > 2) spill++;
    }
    return {
      height: document.documentElement.scrollHeight,
      cells: box, overlaps, spill, forced,
      hiddenCells: box.length - visible.length,
      clipped: box.filter((b) => b.clipped).length,
      links: Array.from(document.querySelectorAll('a[href^="http"]')).map((a) => a.href).sort(),
    };
  });
  const shot = await page.screenshot({ path: join(OUT, `cell-${handle}-${tag}.png`), fullPage: true });
  await ctx.close();
  return { ...m, shot };
}

async function diff(a, b) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<div></div>');
  const out = await page.evaluate(async ([x, y]) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const grab = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    if (ia.width !== ib.width || ia.height !== ib.height) return { pct: -1, h: [ia.height, ib.height] };
    const da = grab(ia), db = grab(ib);
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 2 || Math.abs(da[i + 1] - db[i + 1]) > 2 || Math.abs(da[i + 2] - db[i + 2]) > 2) n++;
    return { pct: (n / (da.length / 4)) * 100, h: [ia.height, ib.height] };
  }, [a.toString('base64'), b.toString('base64')]);
  await ctx.close();
  return out;
}

const now = await serverFor(null);
const was = BASELINE ? await serverFor(BASELINE) : null;
if (!BASELINE) console.log('⚠️  no CARD_BASELINE — reporting the new renderer only, with no comparison\n');

console.log('card        page height      overlaps  clipped  spill   pixels vs HEAD');
for (const handle of CARDS) {
  const a = await look(now.base, handle, 'now');
  const b = was ? await look(was.base, handle, 'head') : null;
  const d = b ? await diff(a.shot, b.shot) : null;
  console.log(`${handle.padEnd(11)} ${String(a.height).padEnd(6)}${b ? ' (was ' + b.height + ')' : ''}`.padEnd(30)
    + ` ${String(a.overlaps).padEnd(9)} ${String(a.clipped).padEnd(8)} ${String(a.spill).padEnd(7)} `
    + (d ? (d.pct < 0 ? 'different size' : d.pct.toFixed(2) + '%') : '—'));

  // 🔴 CORRECTNESS — these are mine to guarantee, and none of them is a matter of taste.
  if (a.overlaps) { console.log(`   🔴 ${a.overlaps} overlapping cells (of ${a.cells.length - a.hiddenCells} shown; ${a.hiddenCells} hidden cell(s) not compared)`); bad++; }
  // the control must fire, or "0 overlaps" is a claim about an empty loop
  if (a.forced === 0) { console.log('   🔴 CONTROL: two cells forced onto the same spot still counted 0 overlaps — the overlap check is dead'); bad++; }
  else if (a.forced < 0) console.log(`   ⚠️ fewer than two shown cells — the overlap check had nothing to compare`);
  if (a.spill) { console.log(`   🔴 ${a.spill} pictures spilling out of their cell`); bad++; }
  if (a.clipped) { console.log(`   🔴 ${a.clipped} cells still clipping their content`); bad++; }
  if (b) {
    const gone = b.links.filter((l) => !a.links.includes(l));
    const added = a.links.filter((l) => !b.links.includes(l));
    if (gone.length || added.length) { console.log(`   🔴 outbound links changed: -${gone.length} +${added.length}`); bad++; }
  }
  // squares must still land on whole units: a picture at w=N is N column widths + N−1 gaps
  const unit = (a.cells.length && a.cells[0].w) ? null : null;
  const sq = a.cells.filter((c) => c.span && /^(\d)x\1$/.test(c.span) && Math.abs(c.w - c.h) > 2);
  if (sq.length) { console.log(`   ⚠️  ${sq.length} square-spanned cells are not square: ${sq.map((c) => `${c.span} ${c.w}×${c.h}`).join(', ')}`); }
}

// ── the NEW model, on a card that states no heights ───────────────────────────────────────────
// The three real cards prove the change costs nothing. This proves it does something.
const NOH = ['---', 'card-page: noh', 'title: NoH', 'accent: #0556ff', '---', '', '## grid', '',
  '- [ ] %% card: feature w=3 img=https://placehold.co/600 href="https://a.com" %%',
  '- [ ] %% card: feature w=3 img=https://placehold.co/600 href="https://b.com" %%',
  '- [ ] %% card: feature w=6 img=https://placehold.co/1200x600 href="https://c.com" %%',
  '- [ ] %% card: link w=2 %% [' + 'a very long label that cannot possibly fit '.repeat(4) + '](https://d.com)',
  '- [ ] %% card: link w=2 %% [Short](https://e.com)',
  '- [ ] %% card: link w=6 icon=patreon sub="early chapters" %% [A full-width row](https://f.com)',
  '- [ ] %% card: link w=6 icon=shop sub="prints" %% [Another row](https://g.com)',
  '- [ ] %% card: link w=6 %% [A third](https://h.com)',
  '- [ ] %% card: feature w=3 img=https://placehold.co/600 href="https://i.com" alt="Labelled" label=on %%',
  '- [ ] %% card: feature w=3 img=https://placehold.co/600 href="https://j.com" alt="Not shown" %%',
].join('\n');
{
  const worker = (await import('../serve/card-worker.mjs')).default;
  const srv = http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: { get: async () => NOH }, PREVIEW: 'true' });
    const b = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(b);
  });
  await new Promise((ok) => srv.listen(0, ok));
  const m = await look('http://127.0.0.1:' + srv.address().port, 'noh', 'new');
  srv.close();
  console.log('\nthe new model — a card that authors no heights');
  for (const c of m.cells) console.log(`   ${String(c.span).padEnd(5)} ${c.w}×${c.h} @${c.y}`);
  if (m.overlaps) { console.log(`   🔴 ${m.overlaps} overlaps`); bad++; }
  if (m.spill) { console.log(`   🔴 ${m.spill} pictures spilling`); bad++; }
  if (m.clipped) { console.log(`   🔴 ${m.clipped} cells clipping — the whole point is that they grow`); bad++; }
  // 🔴 THE ARITHMETIC: a square picture at w=N is exactly N column widths + N−1 gaps, on both axes.
  const sq = m.cells.filter((c) => /^3x/.test(c.span || ''));
  for (const c of sq) {
    if (Math.abs(c.w - c.h) > 2) { console.log(`   🔴 a w=3 square picture is ${c.w}×${c.h} — not square`); bad++; }
  }
  // and the overlong label grew past one unit rather than being cut off
  const grown = m.cells.filter((c) => c.h > 90);
  if (!grown.length) { console.log('   🔴 CONTROL: nothing grew, so the overflow case was never exercised'); bad++; }
  // 🔴 the ROW model: a run of full-width links must be dense and must touch.
  const rows = m.cells.filter((c) => c.w > 300 && c.h < 100 && c.span !== '6x1' || (c.w > 300 && c.h < 100));
  console.log(`   full-width rows: ${rows.length}  heights ${rows.map((r) => r.h).join(',')}  pitch ${rows.slice(1).map((r, i) => r.y - rows[i].y).join(',')}`);
  if (rows.length < 3) { console.log('   🔴 CONTROL: the row case was not exercised'); bad++; }
  for (const r of rows) if (r.h < 44) { console.log(`   🔴 a row is ${r.h}px — below the 44pt touch target`); bad++; }
  const pitches = rows.slice(1).map((r, i) => r.y - rows[i].y);
  // 🔴 Each row against its OWN predecessor, not against the first row's height. Rows are no longer
  // uniform — height comes from content since `h` was removed — so comparing every pitch to rows[0].h
  // reports a perfectly continuous run (heights 59,60,47 with pitches 59,60) as broken. The claim is
  // "no space between consecutive rows", so measure the space.
  const gaps = rows.slice(1).map((r, i) => r.y - (rows[i].y + rows[i].h));
  if (gaps.some((g) => g !== 0)) { console.log(`   🔴 rows do not touch: gaps ${gaps} — a sliver of page shows through as a doubled divider`); bad++; }
  if (pitches.some((p) => p > 76)) { console.log(`   🔴 pitch ${Math.max(...pitches)}px is no denser than Linktree's 76px`); bad++; }

  // 🔴 A picture label must not change the cell's BUDGET. The picture shrinks; the tile does not.
  const lab = m.cells.filter((c) => c.span === '3x1').slice(-2);
  if (lab.length === 2) {
    console.log(`   labelled tile ${lab[0].w}×${lab[0].h}   plain tile ${lab[1].w}×${lab[1].h}`);
    if (lab[0].h !== lab[1].h) { console.log(`   🔴 the label changed the tile's height (${lab[0].h} vs ${lab[1].h})`); bad++; }
    if (Math.abs(lab[0].w - lab[0].h) > 2) { console.log('   🔴 a labelled tile is no longer square'); bad++; }
  } else { console.log('   🔴 CONTROL: the label case was not exercised'); bad++; }
}

now.close();
if (was) was.close();
await browser.close();
console.log(`\n${OUT}/cell-<card>-{now,head}.png`);
// 🩸 THE VERDICT USED TO SAY ✅ WHILE HALF THIS FILE HAD NOT RUN. The comparison against the
// previous renderer needs CARD_BASELINE; without it the correctness claims below are still real —
// overlaps, clipping, spill, links — but the pixel diff simply did not happen. That was announced
// in one ⚠️ line at the TOP of the output and then contradicted by a green tick at the bottom, and
// the bottom is what anyone reads. Surfaced 2026-08-13 when run-all started printing warnings from
// PASSING harnesses; it had been saying ✅ on a partial run for as long as it has existed.
//
// 🔴 Naming the shortfall IN the verdict, not fixing it by supplying a baseline in CI. A worktree
// at HEAD would diff against itself and prove nothing; a worktree at HEAD~1 would diff against a
// commit full of unrelated changes and produce noise nobody can act on. This half is a REFACTOR
// tool — run it with a baseline when you are changing the renderer, which is the only moment its
// answer means anything.
const partial = BASELINE ? '' : '  ⚠️ PARTIAL — the comparison half did not run (no CARD_BASELINE)';
console.log(bad
  ? `🔴 ${bad} correctness problem(s)${partial}`
  : `✅ correct: no overlaps, no spill, no clipping, links unchanged${partial}`);
console.log('   Whether it is BETTER is not measured here. That needs an eye.');
process.exitCode = bad ? 1 : 0;
