// UI state-machine tests for the three high-churn, DOM-coupled features that previously
// had ZERO coverage: tugtile's fold-all CYCLE, and marktile's PLAIN + LOCK toggles.
// These caught real regressions in review (B1: fold desync, B2: lock bypass) — this pins them.
//
// Pattern (the template): these are class METHODS, not pure functions, so we can't just
// grab()+eval() like the other tests. Instead we extract the method source, turn it into a
// standalone function, and .call() it on a hand-built fake `this` (a minimal DOM stub). No
// jsdom, no Obsidian — same zero-dependency spirit as the rest of the suite.
const fs = require('fs');
const path = require('path');
const tug = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const mt = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'marktile', 'marktile.src.js'), 'utf8');

// Extract a 2-space-indented class method `name(...) { ... }` and return a callable function.
function grabMethod(src, name) {
  const re = new RegExp('\\n  ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  const start = m.index + 1;                 // drop the leading \n
  const end = src.indexOf('\n  }', start);   // method body closes at a 2-space-indent }
  const body = src.slice(start, end + 4);    // "name(...) { ... }"
  return eval('(function ' + body.replace(/^[A-Za-z_$][\w$]*/, '') + ')');   // -> function(...) { ... }
}

let fail = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('  ✗', msg, '— got', JSON.stringify(got), 'want', JSON.stringify(want)); } };

// ---- tugtile fold-all cycle: the PURE decision now lives in CORE (foldStateFrom/nextFold/FOLD_ICONS/FOLD_TARGETS),
//      shared by BoardView (reads the DOM, then calls them) and board-core.js (web). Test the pure logic directly. ----
const grabFn = (name) => eval('(' + new RegExp('function ' + name + '\\([^)]*\\) \\{[^}]*\\}').exec(tug)[0].replace('function ' + name, 'function') + ')');
const FOLD_ICONS = eval(tug.match(/const FOLD_ICONS = (\[[^\]]*\]);/)[1]);
const FOLD_TARGETS = eval(tug.match(/const FOLD_TARGETS = (\[[\s\S]*?\]);/)[1]);
const foldStateFrom = grabFn('foldStateFrom');   // also kept in scope so the grabbed _foldState (which calls it) resolves
const nextFold = grabFn('nextFold');

eq(foldStateFrom(true, true), 2, 'foldStateFrom: all lanes collapsed -> 2');
eq(foldStateFrom(false, false), 0, 'foldStateFrom: a tile folded -> 0 (the B1 case)');
eq(foldStateFrom(false, true), 1, 'foldStateFrom: lanes open + nothing folded -> 1 (all open)');
eq([0, 1, 2].map(nextFold), [1, 2, 0], 'nextFold cycle: lanes-only -> all-open -> collapsed -> loop');
eq(FOLD_ICONS, ['maximize-2', 'expand', 'shrink'], 'FOLD_ICONS = [maximize-2, expand, shrink] (button shows the NEXT action)');
eq(FOLD_TARGETS.map((x) => [x.lanesCollapsed, x.cardsExpanded]), [[false, false], [false, true], [true, false]], 'FOLD_TARGETS: 0=lanes-open/folded, 1=all-open, 2=all-collapsed');

// the BoardView wrapper still reads the LIVE DOM correctly and feeds foldStateFrom (B1: a folded tile in an open lane -> NOT all open)
const _foldState = grabMethod(tug, '_foldState');
const lane = (collapsed) => ({ dataset: { collapsed: collapsed ? 'true' : 'false' } });
const tile = (folded) => ({ dataset: { long: 'true' }, classList: { contains: (c) => c === 'tugtile__tile--folded' && folded } });
const board = (lanes, tiles) => ({ contentEl: { querySelectorAll: (sel) => sel === '.tugtile__lane' ? lanes : tiles } });
eq(_foldState.call(board([lane(1), lane(1)], [])), 2, '_foldState DOM: all lanes collapsed -> 2');
eq(_foldState.call(board([lane(0)], [tile(1)])), 0, '_foldState DOM: lane open but a tile folded -> 0 (B1)');
eq(_foldState.call(board([lane(0), lane(0)], [tile(0)])), 1, '_foldState DOM: lanes open + nothing folded -> 1');

// _applyFoldState(0) must open lanes UNCONDITIONALLY. It used to gate on the in-memory _lanesCollapsed
// flag, which a fresh render (collapse restored from disk via makeLane, NOT setAllLanesCollapsed) never
// sets. So after switching tugtile→marktile→tugtile (or ANY reload) while fully collapsed, the flag was
// stale-false and the s=0 step skipped opening lanes — the cycle button froze. Same class as B1.
const applyFoldState = grabMethod(tug, '_applyFoldState');
let laneCall = 'NONE';
const foldThis = { _lanesCollapsed: false, setAllLanesCollapsed(v) { laneCall = v; }, setAllCardsExpanded() {}, persist() {} };
applyFoldState.call(foldThis, 0);
eq(laneCall, false, '_applyFoldState(0) opens lanes even when _lanesCollapsed is stale-false (the marktile round-trip freeze)');

// ---- editor view modes: the 3-mode data lives in core (EDITOR_MODES, which drives equipEditor's class toggling);
//      marktile's cycleMode/_currentMode just delegate to the shared rig. ----
const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
const EDITOR_MODES = eval(coreSrc.match(/const EDITOR_MODES = (\[[\s\S]*?\n\]);/)[1]);
eq(EDITOR_MODES.map((m) => [m.key, m.cls]), [['seasoned', ''], ['rendered', 'tugtile-preview'], ['plain', 'tugtile-plain']], 'EDITOR_MODES: seasoned (no class) / rendered (preview) / plain');
const cycleMode = grabMethod(mt, 'cycleMode');
let cycled = 0, refreshed = 0;
const cyThis = { _rig: { cycleMode: () => { cycled++; }, currentMode: () => ({ key: 'rendered' }) }, refreshCtl: () => { refreshed++; } };
cycleMode.call(cyThis); eq([cycled, cyThis._modeKey, refreshed], [1, 'rendered', 1], 'cycleMode: advances the rig, remembers the mode key, refreshes the button');
const currentMode = grabMethod(mt, '_currentMode');
eq(currentMode.call({ _rig: { currentMode: () => ({ key: 'plain' }) } }).key, 'plain', '_currentMode delegates to the rig');

// ---- marktile LOCK: _applyLock sets contenteditable + .tugtile--locked ----
const applyLock = grabMethod(mt, '_applyLock');
let edAttr = null, lockCls = null;
const ed = { setAttribute: (k, v) => { if (k === 'contenteditable') edAttr = v; } };
const lockThis = (locked) => ({ _locked: locked, contentEl: { querySelector: () => ed, toggleClass: (c, on) => { if (c === 'tugtile--locked') lockCls = on; } } });
applyLock.call(lockThis(true)); eq([edAttr, lockCls], ['false', true], 'lock: editor becomes contenteditable=false + .tugtile--locked');
applyLock.call(lockThis(false)); eq([edAttr, lockCls], ['true', false], 'unlock: editor editable again, class removed');

console.log(fail ? (fail + ' failed') : 'all ui-state assertions pass (fold cycle + plain + lock)');
process.exit(fail ? 1 : 0);
