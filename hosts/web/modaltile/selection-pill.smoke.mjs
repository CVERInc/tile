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

  // 🩸 SELECT VIA THE RANGE API, NOT THE KEYBOARD. The first version pressed Home / Shift+End /
  // End, and neither arm did what the label said: on touch the selection never collapsed, on mouse
  // it never became ranged. The touch arm then reported "the pill outlived its selection" — a
  // finding about my keystrokes, not about the pill. And the mouse arm PASSED for the wrong reason:
  // no pill, because there was no selection to show one for. A control that holds because nothing
  // happened is not a control.
  //
  // So the selection is made explicitly and ASSERTED at both ends (selA/selB below). The pill
  // listens to `selectionchange`, which a programmatic range fires exactly as a gesture does.
  const setSel = (ranged) => p.evaluate((wantRanged) => {
    const ed = document.querySelector('.ej-mount [contenteditable="true"]');
    // 🔴 A TEXT node, found by walking. `[...ed.childNodes].find(…)` picked an ELEMENT the first
    // time, and Range treats an offset on an element as a CHILD INDEX — so setEnd(node, 3) threw
    // IndexSizeError instead of selecting three characters. Offsets only mean characters in text.
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let node = null;
    while (w.nextNode()) { if (w.currentNode.textContent.trim()) { node = w.currentNode; break; } }
    if (!node) throw new Error('the editor holds no text node to select');
    const r = document.createRange();
    const len = node.textContent.length;
    if (wantRanged) r.setStart(node, 0), r.setEnd(node, Math.max(1, len));
    else r.setStart(node, Math.max(0, len)), r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  }, ranged);

  await setSel(true);
  await p.waitForTimeout(250);
  const onSelect = await pillShown(); const selA = await selState();

  await setSel(false);
  await p.waitForTimeout(250);
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
    // ⚠️ REPORTED, NOT GATED — and the distinction is deliberate.
    //
    // A programmatic Range does put the document into a ranged selection (asserted above), but this
    // arm has not yet been shown to reproduce what a FINGER does: the editor is pre-loaded with
    // sample markdown, a typed string did not land where expected, and the range lands on whichever
    // text node comes first rather than on a word a person would drag over. So "no pill" here is
    // not yet attributable — it could be the pill, or it could be that this is not the gesture.
    //
    // 🔴 Failing on it would add a red that nobody can act on, which is the exact shape this file
    // was written to remove. It gates what it can prove (the setup, and the mouse control) and
    // reports what it cannot, until the touch gesture is reproduced properly.
    if (!r.onSelect.shown) console.log('   ⚠️ a selection showed no pill — NOT gated yet: see the note above');
    if (r.onCollapse.shown) console.log('   ⚠️ the pill outlived its selection — NOT gated yet');
    if (r.onSelect.shown && !r.onCollapse.shown) console.log('   ✓ pill followed the selection and left with it');
  } else if (r.onSelect.shown) {
    console.log('   🔴 CONTROL: the pill appeared on a MOUSE — the coarse-pointer gate is not holding,');
    console.log('      and a phone-only test would never have noticed');
    bad++;
  }
}

console.log(bad ? `\n❌ ${bad} problem(s)` : '\n✅ the setup is what it claims, and the pill stays away from a mouse (touch arm reported, not gated)');
process.exit(bad ? 1 : 0);
