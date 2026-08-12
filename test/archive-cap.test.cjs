// W5.1 archive-cap: max-archive-size drops the OLDEST cards once the archive exceeds the cap.
// Cards append newest-last, so enforcing the cap must keep the last N and discard the earliest.
// Loads the built main.js with an 'obsidian' stub, captures BoardView, and drives addToArchive directly
// (no DOM needed — addToArchive + enforceArchiveCap + splitArchive/rebuildArchive are pure string logic).
const fs = require('fs');
const path = require('path');

const setIcon = () => {};
const obsidian = {
  ItemView: class { constructor(leaf) { this.leaf = leaf; } },
  Plugin: class {}, PluginSettingTab: class {}, Setting: class { setName() { return this; } setDesc() { return this; } then() { return this; } addToggle() { return this; } addText() { return this; } addDropdown() { return this; } },
  TextFileView: class { constructor(leaf) { this.leaf = leaf; } }, MarkdownView: class {},
  Notice: class { constructor(m) { obsidian.__lastNotice = m; } },
  Menu: class { addItem() { return this; } showAtMouseEvent() {} },
  MarkdownRenderer: { render() {} },
  Component: class { load() {} unload() {} },
  setIcon, Platform: { isMobile: false }, Modal: class {},
};
const src = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'main.js'), 'utf8');
const m = { exports: {} };
const req = (n) => (n === 'obsidian' ? obsidian : require(n));
new Function('module', 'exports', 'require', src + '\ntry{module.exports.__BoardView=BoardView;}catch(e){}')(m, m.exports, req);
const BoardView = m.exports.__BoardView;
if (!BoardView) { console.log('✗ could not capture BoardView'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

function newView(cap) {
  const v = Object.create(BoardView.prototype);
  v.model = { archive: '' };
  v.archiveWithDate = false; v.appendArchiveDate = false; v.archiveDateSeparator = ''; v.archiveHeading = 'Archive';
  v.maxArchiveSize = cap;
  return v;
}
// count archived cards by counting checklist lines
const cardCount = (s) => (s.match(/^- \[.\]/gm) || []).length;
const has = (s, txt) => s.indexOf(txt) !== -1;

// 1. cap = 3: archive 5 cards → only the newest 3 survive, oldest two are dropped
{
  const v = newView(3);
  for (let i = 1; i <= 5; i++) v.addToArchive('- [ ] card ' + i);
  ok('cap=3 ：5 張只留 3 張', cardCount(v.model.archive) === 3);
  ok('cap=3 ：丟最舊 (card 1/2 不在)', !has(v.model.archive, 'card 1') && !has(v.model.archive, 'card 2'));
  ok('cap=3 ：留最新 (card 3/4/5 都在)', has(v.model.archive, 'card 3') && has(v.model.archive, 'card 4') && has(v.model.archive, 'card 5'));
  // newest stays last (append order preserved)
  ok('cap=3 ：最新仍在最後', v.model.archive.lastIndexOf('card 5') > v.model.archive.lastIndexOf('card 3'));
  // archive header is preserved after trimming
  ok('cap=3 ：保留 archive 標題', has(v.model.archive, '## Archive'));
}

// 2. cap = -1 (unlimited): nothing dropped
{
  const v = newView(-1);
  for (let i = 1; i <= 5; i++) v.addToArchive('- [ ] u' + i);
  ok('cap=-1 ：不刪 (5 張全留)', cardCount(v.model.archive) === 5);
}

// 3. cap = 0 (treated as unlimited): nothing dropped
{
  const v = newView(0);
  for (let i = 1; i <= 4; i++) v.addToArchive('- [ ] z' + i);
  ok('cap=0 ：視同無限 (4 張全留)', cardCount(v.model.archive) === 4);
}

// 4. cap exactly at boundary: cap = 2, archive 2 → both stay; archive 3rd → oldest drops to 2
{
  const v = newView(2);
  v.addToArchive('- [ ] b1'); v.addToArchive('- [ ] b2');
  ok('cap=2 ：剛好 2 張全留', cardCount(v.model.archive) === 2);
  v.addToArchive('- [ ] b3');
  ok('cap=2 ：第 3 張進來→剩 2 張', cardCount(v.model.archive) === 2);
  ok('cap=2 ：b1 被擠掉', !has(v.model.archive, 'b1') && has(v.model.archive, 'b2') && has(v.model.archive, 'b3'));
}

// 5. multi-line cards: a 3-line card counts as ONE card (split by checklist line, not raw line)
{
  const v = newView(2);
  v.addToArchive('- [ ] first\n  detail a\n  detail b');
  v.addToArchive('- [ ] second');
  v.addToArchive('- [ ] third');
  ok('多行牌算 1 張：cap=2 留 2 張', cardCount(v.model.archive) === 2);
  ok('多行牌算 1 張：first 整張被擠掉(含明細)', !has(v.model.archive, 'detail a') && !has(v.model.archive, 'first'));
  ok('多行牌算 1 張：third 在', has(v.model.archive, 'third'));
}

console.log(fail ? ('\n✗ ' + fail + ' failed') : ('\n✅ archive-cap all pass (' + pass + ')'));
if (fail) process.exit(1);
