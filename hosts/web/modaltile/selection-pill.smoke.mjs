// The selection pill, end to end — the half of the selection menu that no test covered.
//
//   (cd <this repo> && python3 -m http.server 8731 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node hosts/web/modaltile/selection-pill.smoke.mjs http://localhost:8731/hosts/web/modaltile/
//
// 🩸 WHY THIS EXISTS. test/pill-placement.test.cjs covers pillPlacement() — the pure arithmetic of
// WHERE the pill goes — and its header says exactly why: "the pill cannot be eyeball-debugged on a
// device you are not holding". That is true and it is only half. Nothing checked whether the pill
// APPEARS, or goes away, or that the coarse-pointer gate around it works. A feature whose only gate
// is its own geometry is a feature that can stop existing without a single test turning red.
//
// 🔴 THE COARSE-POINTER ARM IS THE POINT. editor-core gates the pill on
// `matchMedia('(pointer: coarse)').matches` — on a mouse the right-click menu is the path, and the
// pill must NEVER appear. So this runs the SAME script twice, once touch and once mouse, and the
// mouse run is not a formality: it is the control. Without it, a pill that showed up everywhere
// would pass a test that only ever looked at a phone.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const url = process.argv[2];
if (!url) throw new Error('usage: node selection-pill.smoke.mjs <url of hosts/web/modaltile/>');

const b = await chromium.launch();

/** Open modaltile, put a word in the editor, select it, and report what the pill did. */
async function run({ label, touch }) {
  const ctx = await b.newContext(
    touch ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }
          : { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

  // 🔴 Confirm the emulation actually took. `isMobile` is what makes Chromium report a coarse
  // pointer, and if it ever stops doing so this arm would quietly test the other one.
  const coarse = await p.evaluate(() => matchMedia('(pointer: coarse)').matches);

  await p.click('#open');
  await p.waitForTimeout(700);
  const ed = '.ej-mount [contenteditable="true"]';
  await p.click(ed);
  await p.keyboard.type('選取這一段');

  // 🔴 Report the SELECTION too. "the pill outlived its selection" is only a finding if the
  // selection actually went away — otherwise it is my keystroke that failed, not the pill.
  const selState = () => p.evaluate(() => {
    const s = getSelection();
    if (!s || s.rangeCount === 0) return 'none';
    return s.isCollapsed ? 'collapsed' : ('ranged:' + String(s.toString()).slice(0, 12));
  });
  const pillShown = () => p.evaluate(() => {
    const el = document.querySelector('.ej-selpill');
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { present: true, shown: cs.display !== 'none' && r.width > 0 && r.height > 0 };
  });

  // 🩸 SELECT BY DRAGGING, NOT BY BUILDING A RANGE. Two earlier versions of this file each measured
  // something other than the pill. Pressing Home/Shift+End did not produce the state the label
  // claimed. Then a programmatic Range DID put the document into a ranged selection — asserted — and
  // still no pill appeared on touch, which I recorded as "not yet attributable, needs a real finger".
  //
  // 🔴 It never needed a finger. updateSelPill() looks at exactly two things: coarsePointer(), and
  // the EDITOR'S OWN readSel(). It has no way to know what moved the caret. A synthetic Range fires
  // selectionchange but does not give readSel() a non-collapsed pair, so the pill hid — correctly.
  // The probe was the finding. A drag with the mouse under mobile emulation gives a coarse pointer
  // AND a real browser selection, which is everything the pill can observe, and it appears.
  const dragSelect = async () => {
    const t = await p.evaluate((sel) => {
      const root = document.querySelector(sel);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        if (n.textContent.trim().length < 6) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.width > 40 && b.height > 0) return { x: b.x, y: b.y + b.height / 2, w: b.width };
      }
      return null;
    }, ed);
    if (!t) throw new Error('no line long enough to drag across — the editor loaded no sample text');
    await p.mouse.move(t.x + 2, t.y);
    await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(t.x + 2 + (t.w - 4) * i / 8, t.y); await p.waitForTimeout(20); }
    await p.mouse.up();
  };
  // Collapse the way a person does: one tap inside the text. 🔴 Not a click at some fixed screen
  // point — the first version used (20, 20), which lands outside the editor, left the selection
  // exactly where it was, and the SETUP assertion below caught it. A collapse that does not collapse
  // would have turned the next check into a claim about my click.
  const collapse = () => p.click(ed, { position: { x: 8, y: 8 } });

  await dragSelect();
  await p.waitForTimeout(300);
  const onSelect = await pillShown(); const selA = await selState();

  await collapse();
  await p.waitForTimeout(300);
  const onCollapse = await pillShown(); const selB = await selState();

  await ctx.close();
  return { label, touch, coarse, onSelect, onCollapse, selA, selB, errs };
}

const results = [await run({ label: 'touch (coarse pointer)', touch: true }),
                 await run({ label: 'mouse (fine pointer)', touch: false })];
await b.close();

let bad = 0;
for (const r of results) {
  console.log(`\n── ${r.label}`);
  console.log(`   pointer: coarse reported by the page: ${r.coarse}`);
  console.log(`   with a selection: ${JSON.stringify(r.onSelect)}   sel=${r.selA}`);
  console.log(`   after collapsing: ${JSON.stringify(r.onCollapse)}   sel=${r.selB}`);
  if (r.errs.length) { console.log(`   🔴 ${r.errs.length} JS error(s)`); r.errs.slice(0, 3).forEach((e) => console.log(`      ✗ ${e.slice(0, 140)}`)); bad++; }

  // the emulation must be what it says it is, or neither arm means anything
  if (r.coarse !== r.touch) { console.log(`   🔴 SETUP: expected pointer coarse=${r.touch}, page reports ${r.coarse}`); bad++; continue; }
  if (!r.onSelect.present) { console.log('   🔴 no .ej-selpill in the document at all — the pill is not being built'); bad++; continue; }

  // 🔴 THE SETUP IS ASSERTED BEFORE ANY VERDICT. Both arms once "passed"/"failed" on a selection
  // that was never in the state the label claimed, and neither said so. If the ranged step is not
  // ranged, or the collapsed step is not collapsed, nothing below this line means anything.
  if (!String(r.selA).startsWith('ranged')) { console.log(`   🔴 SETUP: the "with a selection" step is ${r.selA} — nothing was selected, so the pill has nothing to answer`); bad++; continue; }
  if (r.selB !== 'collapsed') { console.log(`   🔴 SETUP: the "after collapsing" step is ${r.selB} — the selection never went away, so "the pill outlived it" would be about this probe`); bad++; continue; }

  if (r.touch) {
    // 🔴 GATED since 2026-08-12. This arm used to only REPORT, because a synthetic Range produced no
    // pill and I could not tell the pill from the probe. A real drag settles it: the pill appears.
    // Both halves are assertions now — it must show up, and it must leave when the selection does.
    if (!r.onSelect.shown) { console.log('   🔴 a selection on a coarse pointer showed NO pill'); bad++; }
    else if (r.onCollapse.shown) { console.log('   🔴 the pill outlived its selection'); bad++; }
    else console.log('   ✓ pill followed the selection and left with it');
  } else if (r.onSelect.shown) {
    console.log('   🔴 CONTROL: the pill appeared on a MOUSE — the coarse-pointer gate is not holding,');
    console.log('      and a phone-only test would never have noticed');
    bad++;
  }
}

console.log(bad ? `\n❌ ${bad} problem(s)` : '\n✅ the pill follows a real selection on a coarse pointer, leaves with it, and never appears on a mouse');
process.exit(bad ? 1 : 0);
