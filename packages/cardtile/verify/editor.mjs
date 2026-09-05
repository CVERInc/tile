// cardtile-w's four claims, each with a control.
//
// The editor writes to a creator's ONLY copy of their card. There is no draft table, no revision
// history, no second store to reconcile against — so the claims below are not "does it look right",
// they are the conditions under which it is safe to let a human touch the file at all.
//
//   1. FIDELITY   the canvas is what the Worker serves, byte for byte, once the editor's own
//                 `data-cell` attributes are removed.
//   2. ROUNDTRIP  open a live card, change nothing, read the markdown back: identical bytes.
//   3. EDIT       a form edit changes exactly the param it was pointed at, and leaves alone a param
//                 the form has no field for.
//   4. DRAG       a real mouse drag reorders the cells and alters nothing else — and writes no `h`.
//
// 🔴 Every one has a control, because "found no problem" and "was not looking" print the same thing.
//
//   node packages/cardtile/verify/editor.mjs
import { readCard, PLAYWRIGHT } from './paths.mjs';
import { createServer } from '../w/serve.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const server = createServer();
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/packages/cardtile/w/`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;
const fail = (msg) => { console.log(`   🔴 ${msg}`); bad++; };

async function open(handle) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW);
  if (handle) {
    await page.evaluate((md) => window.__cardtileW.load(md, 'x'), readCard(handle));
    await page.waitForTimeout(500);
  }
  return { ctx, page, errors };
}

// ── 1. FIDELITY ─────────────────────────────────────────────────────────────────────────────────
console.log('1. FIDELITY — the canvas is the served document\n');
console.log('card         canvas bytes   worker bytes   identical after stripping data-cell');
for (const handle of CARDS) {
  const { ctx, page, errors } = await open(handle);
  const canvas = await page.evaluate(() => window.__cardtileW.canvasHtml());
  const stripped = canvas
    .replace(/<script src="[^"]*Sortable[^"]*"><\/script>/, '')
    .replace(/ data-cell="\d+"/g, '');
  // 🔴 compare against the URL the editor actually rendered with, read back from it. Hardcoding one
  // here would make this pass by agreeing with itself, and cardUrl is a real render input — it
  // decides which social link is the author's own site.
  const cardUrl = await page.evaluate(() => window.__cardtileW.cardUrl);
  const served = renderCardHTML(readCard(handle), { handle: 'x', cardUrl });
  const same = stripped === served;
  console.log(`${handle.padEnd(12)} ${String(canvas.length).padEnd(14)} ${String(served.length).padEnd(14)} ${same ? 'yes' : 'NO'}`);
  if (!same) fail(`${handle}: the editor is showing a document the Worker would not serve`);
  if ((canvas.match(/data-cell=/g) || []).length === 0) fail(`${handle}: no data-cell attributes — the editor cannot address a single cell`);
  if (errors.length) fail(`${handle}: page errors — ${errors[0]}`);
  await ctx.close();
}
// 🔴 CONTROL: a changed card must NOT match. Without this, "identical" could mean the comparison is
// between two copies of the same string produced the same way.
{
  const { ctx, page } = await open('specimen-rich');
  const changed = await page.evaluate(() => {
    const w = window.__cardtileW;
    w.commit(w.md.replace('%% card: profile', '%% card: profile chips=CONTROL'));
    return w.canvasHtml();
  });
  const served = renderCardHTML(readCard('specimen-rich'), { handle: 'x', cardUrl: await page.evaluate(() => window.__cardtileW.cardUrl) });
  const stripped = changed.replace(/<script src="[^"]*Sortable[^"]*"><\/script>/, '').replace(/ data-cell="\d+"/g, '');
  console.log(`\nCONTROL      an edited card differs from the served one: ${stripped !== served ? 'yes' : 'NO'}`);
  if (stripped === served) fail('CONTROL: an edited card compared EQUAL — the fidelity check above compares nothing');
  await ctx.close();
}

// ── 2. ROUNDTRIP ────────────────────────────────────────────────────────────────────────────────
console.log('\n2. ROUNDTRIP — open, touch nothing, read it back\n');
console.log('card         bytes in    bytes out   identical');
for (const handle of CARDS) {
  const { ctx, page } = await open(handle);
  const before = readCard(handle);
  const after = await page.evaluate(() => window.__cardtileW.md);
  const same = after === before;
  console.log(`${handle.padEnd(12)} ${String(before.length).padEnd(11)} ${String(after.length).padEnd(11)} ${same ? 'yes' : 'NO'}`);
  if (!same) {
    // 🔴 Same index on both sides — see specimens.test.mjs for what mixing them reports.
    let at = 0;
    while (at < before.length && at < after.length && before[at] === after[at]) at++;
    fail(`${handle}: the editor rewrote the file at byte ${at}: ${JSON.stringify(before.slice(at - 40, at + 40))} → ${JSON.stringify(after.slice(at - 40, at + 40))}`);
  }
  await ctx.close();
}
// 🔴 CONTROL: an actual edit must break byte-equality, or the comparison is not reading the file.
{
  const { ctx, page } = await open('specimen-rich');
  const same = await page.evaluate(() => {
    const w = window.__cardtileW;
    const before = w.md;
    // 🔴 Edit the BODY, not a type-specific param. The first version asked for `sub` on whatever
    // cell happened to sit at index 1, then for the first `link` cell — and the card under test had
    // neither, so the control returned "no-field" and stopped being a control while still printing
    // a line. Every cell type with a body has this field, so this one cannot go quiet.
    let i = -1;
    for (let k = 0; k < w.model.cells.length; k++) { w.openCell(k); if (w.field('__body')) { i = k; break; } }
    if (i < 0) return 'no-editable-body';
    w.field('__body').value = 'CONTROL ' + (w.field('__body').value || '');
    w.saveCell();
    return w.md === before;
  });
  console.log(`\nCONTROL      an edit changes the bytes: ${same === false ? 'yes' : 'NO (' + same + ')'}`);
  if (same !== false) fail('CONTROL: an edit did NOT change the file — the roundtrip check above proves nothing');
  await ctx.close();
}

// ── 3. EDIT ─────────────────────────────────────────────────────────────────────────────────────
//
// The claim that matters is the second one. A creator's card carries params this editor has never
// heard of; a form that rebuilds `rawParams` from its own fields silently drops them, and the loss
// is invisible until they notice their card stopped doing something.
console.log('\n3. EDIT — changes the field it was pointed at, and nothing else\n');
{
  const { ctx, page } = await open(null);
  const r = await page.evaluate(() => {
    const w = window.__cardtileW;
    // a cell carrying a param no form field exists for
    w.load(['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
      '- [ ] %% card: link w=6 sub=old zzz=keepme icon=patreon %% [A](https://a.example)',
      '- [ ] %% card: link w=6 %% [B](https://b.example)'].join('\n') + '\n', 't');
    const before = w.model.cells[0].rawParams;
    w.openCell(0);
    w.field('sub').value = 'new sub';
    w.saveCell();
    const after = w.model.cells[0];
    return { before, after: after.rawParams, params: after.params, otherCell: w.model.cells[1].rawParams, md: w.md };
  });
  console.log(`   before: ${r.before}`);
  console.log(`   after:  ${r.after}`);
  if (!/zzz=keepme/.test(r.after)) fail('a param the form has no field for was DROPPED — this is the failure mode that matters');
  if (r.params.sub !== 'new sub') fail(`the edit did not land: sub is ${JSON.stringify(r.params.sub)}`);
  if (!/sub="new sub"/.test(r.after)) fail('a value with a space was written unquoted — it will re-parse as a different param');
  if (r.params.icon !== 'patreon' || r.params.w !== '6') fail('an untouched named param changed');
  if (r.otherCell !== 'w=6') fail(`a cell nobody edited changed: ${r.otherCell}`);
  // 🔴 CONTROL: the probe can see a param change at all
  if (r.before === r.after) fail('CONTROL: rawParams did not change — this whole section is comparing a string with itself');
  console.log(`   unknown param survived: ${/zzz=keepme/.test(r.after) ? 'yes' : 'NO'}`);
  await ctx.close();
}

// ── 4. DRAG ─────────────────────────────────────────────────────────────────────────────────────
//
// A REAL mouse drag, not a call to the handler. The handler is the part I wrote; the part that
// breaks is whether a press-move-release inside an iframe reaches it at all.
console.log('\n4. DRAG — a real mouse drag reorders, and alters nothing in passing\n');
{
  const { ctx, page } = await open(null);
  await page.evaluate(() => window.__cardtileW.load(['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=6 %% [One](https://one.example)',
    '- [ ] %% card: link w=6 %% [Two](https://two.example)',
    '- [ ] %% card: link w=6 %% [Three](https://three.example)'].join('\n') + '\n', 't'));
  await page.waitForTimeout(500);
  const frame = page.frameLocator('#canvas');
  const before = await page.evaluate(() => window.__cardtileW.md);
  const a = await frame.locator('[data-cell="0"]').boundingBox();
  const c = await frame.locator('[data-cell="2"]').boundingBox();
  if (!a || !c) fail('could not find the cells to drag — nothing was tested');
  else {
    // Sortable needs movement, not a teleport: a single move to the target is often below its
    // threshold or lands before the drag has started.
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((c.y + c.height - a.y) * i) / 12);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const after = await page.evaluate(() => window.__cardtileW.md);
  const order = (md) => [...md.matchAll(/\[(One|Two|Three)\]/g)].map((m) => m[1]).join(' ');
  console.log(`   before: ${order(before)}`);
  console.log(`   after:  ${order(after)}`);
  if (order(before) === order(after)) fail('the drag did not move anything — Sortable is not reaching the model');
  if (order(after).split(' ').sort().join() !== 'One,Three,Two') fail('a cell was lost or duplicated by the drag');
  // nothing else moved: the same three lines, only reordered
  const lines = (md) => md.split('\n').filter((l) => l.startsWith('- [ ]')).sort().join('\n');
  if (lines(before) !== lines(after)) fail('the drag altered a cell in passing:\n' + lines(after));
  // 🔴 and it wrote no `h`. This is the retired token that a resize gesture put back into a file
  // as recently as 2026-07-29 — an editor is exactly where a dead parameter comes back to life.
  if (/\bh=\d/.test(after)) fail('the drag wrote an `h` token — the retired parameter is back');
  console.log(`   no h= written: ${/\bh=\d/.test(after) ? 'NO' : 'yes'}`);
  await ctx.close();
}

// ── 5. THE REST OF THE SURFACE ──────────────────────────────────────────────────────────────────
//
// Adding and deleting move the block RANGES that the face's lanes are made of, and getting that
// arithmetic wrong is invisible until a card serializes with its sections in the wrong places. The
// test is the same shape as the roundtrip one: do a thing and its inverse, and the file must come
// back byte-identical. A block-count check alone would pass while the ranges were merely consistent
// and wrong.
console.log('\n5. LANES, ADD, DELETE, UNDO\n');
{
  const { ctx, page } = await open('specimen-rich');
  page.on('dialog', (d) => d.accept());
  const r = await page.evaluate(async () => {
    const w = window.__cardtileW;
    const out = { before: w.md.length };

    // a drawer's cells are addressable in ITS panel, not the face's
    const id = w.model.drawers[0] && w.model.drawers[0].id;
    if (!id) return { ...out, drawer: 'no drawers on this card' };
    w.lane = { kind: 'drawer', id };
    await new Promise((res) => setTimeout(res, 600));
    const doc = document.getElementById('canvas').contentDocument;
    const panel = doc.getElementById('drawer-' + id) || doc.querySelector(`[data-drawer-panel="${id}"]`);
    out.panelCells = panel ? panel.querySelectorAll('[data-cell]').length : -1;
    out.laneCells = w.model.drawers[0].cells.length;

    // add then delete on the face → back to the same bytes
    w.lane = { kind: 'face', id: '' };
    const original = w.md;
    w.addCell('link'); w.saveCell();
    out.added = w.model.cells.length;
    out.blocksAfterAdd = w.model.blocks.reduce((a, b) => a + b.count, 0);
    w.openCell(w.model.cells.length - 1); w.deleteCell();
    out.restored = w.md === original;
    out.blocksAfterDelete = w.model.blocks.reduce((a, b) => a + b.count, 0);
    out.cellsAfterDelete = w.model.cells.length;

    // undo takes the file back a step, exactly
    const mark = w.md;
    w.openCell(0);
    if (w.field('__body')) { w.field('__body').value = 'UNDO ME'; w.saveCell(); }
    out.changed = w.md !== mark;
    document.getElementById('undo').click();
    out.undone = w.md === mark;
    return out;
  });
  console.log(`   drawer panel cells ${r.panelCells} (model says ${r.laneCells})`);
  console.log(`   add → delete restores the file byte-for-byte: ${r.restored ? 'yes' : 'NO'}`);
  console.log(`   block ranges still cover every cell: ${r.blocksAfterDelete === r.cellsAfterDelete ? 'yes' : 'NO'}`);
  console.log(`   undo returns the previous bytes: ${r.undone ? 'yes' : 'NO'}`);
  if (r.panelCells !== r.laneCells) fail(`a drawer's cells are not addressable in its panel (${r.panelCells} vs ${r.laneCells})`);
  if (!r.restored) fail('add then delete did NOT restore the file — the block ranges are drifting');
  if (r.blocksAfterDelete !== r.cellsAfterDelete) fail(`blocks cover ${r.blocksAfterDelete} cells but there are ${r.cellsAfterDelete}`);
  // 🔴 CONTROL: undo is only meaningful if the edit before it actually changed something
  if (!r.changed) fail('CONTROL: the edit before undo changed nothing — the undo check proves nothing');
  if (!r.undone) fail('undo did not restore the previous bytes');
  await ctx.close();
}

// ── 6. ?handle= LOADS A REAL CARD ───────────────────────────────────────────────────────────────
//
// 🔴 This never worked. There was no `.md` route, and a vanity host maps every path to one handle —
// so `<their-domain>/<handle>.md` returned 200 with the card's HTML, `r.ok` was true, `parseCard` ate it
// without throwing, and the editor opened an EMPTY card. Silently. A 200 is not evidence that you
// got what you asked for.
console.log('\n6. ?handle= — loading a card by name\n');
{
  const { ctx, page } = await open(null);
  page.on('dialog', (d) => d.accept());
  const r = await page.evaluate(async (origin) => {
    const w = window.__cardtileW;
    await w.loadHandle('specimen-rich', origin);
    const ok = { cells: w.model.cells.length, drawers: w.model.drawers.length, assets: Object.keys(w.model.assets).length, bytes: w.md.length };
    ok.drawerIds = w.model.drawers.map((d) => d.id).join(',');
    // 🔴 THE GUARD, tested on what it actually keys on. The first version of this control pointed
    // loadHandle at a creator's live domain "because every path there returns HTML" — two things wrong:
    // that host now returns real markdown at /<handle>.md (the exit shipped), and a cross-origin fetch
    // from 127.0.0.1 is refused by CORS anyway. It fell back to the starter for a THIRD reason and
    // I would have called that a pass. So: feed the guard a real HTML document directly.
    const html = document.documentElement.outerHTML;
    let cellsFromHtml = -1;
    try { cellsFromHtml = w.parseCard(html).cells.length; } catch { cellsFromHtml = 0; }
    ok.cellsFromHtml = cellsFromHtml;
    // and the cross-origin path, labelled as what it is: unreachable, therefore refused
    await w.loadHandle('specimen-rich', 'https://unreachable.invalid');   // RFC 2606: guaranteed never to resolve
    ok.afterUnreachable = w.model.cells.length;
    return ok;
  }, BASE.replace(/\/packages\/.*$/, ''));
  console.log(`   loaded from the .md exit: ${r.cells} cells, ${r.drawers} drawers, ${r.assets} assets, ${r.bytes} bytes`);
  console.log(`   an HTML document parses to ${r.cellsFromHtml} cells — which is what the guard refuses on`);
  console.log(`   an unreachable origin (CORS): fell back to a ${r.afterUnreachable}-cell starter`);
  if (r.cells < 5) fail(`?handle= loaded ${r.cells} cells — that is not the card that was asked for`);
  if (r.assets === 0) fail('the loaded card has no assets — the editor got the THIN exit, and the pictures are gone');
  // 🩸 Was `r.drawers < 2` — a literal copied from a real card that happened to have two lanes. A
  // number in an assertion that nothing in the repo can justify is a number that goes stale the day
  // the subject changes, and this one had: the specimen has its own count. So ask the FILE. It also
  // catches the failure the literal was reaching for — an exit that keeps only the first lane — which
  // a `>= 1` would not, and which is why the specimen now carries two.
  const wantDrawers = (readCard('specimen-rich').match(/^## drawer:/gm) || []).length;
  if (wantDrawers < 2) fail(`the specimen has ${wantDrawers} drawer lane(s) — one cannot tell "the drawers came" from "the first drawer came"`);
  if (r.drawers !== wantDrawers) fail(`the .md exit carried ${r.drawers} drawer(s) (${r.drawerIds}) but the file has ${wantDrawers}`);
  // CONTROL: the guard's premise must hold — an HTML body must parse to NO cells, or "cells > 0"
  // is not a test of anything.
  if (r.cellsFromHtml !== 0) fail(`CONTROL: an HTML document parsed to ${r.cellsFromHtml} cells — the guard's premise is false`);
  if (r.afterUnreachable >= r.cells) fail('an unreachable origin loaded something claiming to be the card');
  await ctx.close();
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the canvas is the card, the file survives being opened, and an edit changes only what it aimed at');
process.exitCode = bad ? 1 : 0;
