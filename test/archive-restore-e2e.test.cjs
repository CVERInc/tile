// End-to-end: archive a card from a non-first lane, then restore it, and assert it lands back in its home lane.
// Loads the built main.js with an 'obsidian' stub, captures the internal BoardView, and drives archiveTile +
// restoreArchived against a hand-rolled fake DOM (only the bits those two methods touch). makeTileEl/persist/
// renumber are stubbed to record where the restored card was placed.
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
const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'tugtile', 'main.js'), 'utf8');
const m = { exports: {} };
const req = (n) => (n === 'obsidian' ? obsidian : require(n));
new Function('module', 'exports', 'require', src + '\ntry{module.exports.__BoardView=BoardView;module.exports.__backupWhen=backupWhen;}catch(e){}')(m, m.exports, req);
const BoardView = m.exports.__BoardView;
const backupWhen = m.exports.__backupWhen;
if (!BoardView) { console.log('✗ could not capture BoardView'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

// --- fake DOM: each lane has a title + its own list; makeTileEl is stubbed to record placement ---
function makeFakeBoard(laneNames) {
  const lanes = laneNames.map((name) => {
    const list = { __name: name, __placed: [] };
    const lane = {
      querySelector: (sel) => sel === '.tugtile__lane-title' ? { textContent: name } : sel === '.tugtile__list' ? list : null,
    };
    list.__lane = lane;
    return { name, lane, list };
  });
  const contentEl = {
    querySelectorAll: (sel) => sel === '.tugtile__lane' ? lanes.map((l) => l.lane) : [],
    querySelector: (sel) => sel === '.tugtile__list' ? lanes[0].list : sel === '.tugtile__lane' ? lanes[0].lane : null,
  };
  return { lanes, contentEl };
}

function newView(laneNames) {
  const v = Object.create(BoardView.prototype);
  const board = makeFakeBoard(laneNames);
  v.contentEl = board.contentEl;
  v.model = { archive: '' };
  v.allTiles = [];
  v.archiveWithDate = false; v.appendArchiveDate = false; v.archiveDateSeparator = ''; v.archiveHeading = 'Archive'; v.maxArchive = -1;
  v.persist = () => {}; v.renumber = () => {};
  v.makeTileEl = (listEl, tile) => { listEl.__placed.push(tile); return {}; };
  v.__board = board;
  return v;
}

// archive a raw card "from" a given lane (simulates archiveTile's lane lookup result)
function archiveFrom(v, raw, laneName) {
  const lane = v.__board.lanes.find((l) => l.name === laneName).lane;
  v.addToArchive(raw, v._laneName(lane));
}

// 1. simple lane name: archive from lane 2, restore → must land in lane 2 (not lane 1)
{
  const v = newView(['待辦', '進行中', '完成']);
  archiveFrom(v, '- [ ] 修 bug', '進行中');
  ok('token 有寫進 archive', /%%tg-home:進行中%%/.test(v.model.archive));
  v.restoreArchived(0);
  const inProg = v.__board.lanes[1].list.__placed.length;
  const first = v.__board.lanes[0].list.__placed.length;
  ok('簡單欄名：復原回「進行中」(非第一欄)', inProg === 1 && first === 0);
}

// 2. full-width space in lane name (a tested kanban scenario) — home is lane 2 so a failed match would wrongly fall to lane 1
{
  const v = newView(['待辦', '進　行　中']);
  archiveFrom(v, '- [ ] 卡', '進　行　中');
  v.restoreArchived(0);
  ok('全形空格欄名：復原回「進　行　中」(非第一欄)', v.__board.lanes[1].list.__placed.length === 1 && v.__board.lanes[0].list.__placed.length === 0);
}

// 3. home lane gone → fallback to first lane (graceful)
{
  const v = newView(['待辦', '進行中']);
  archiveFrom(v, '- [ ] 孤兒卡', '進行中');
  // rename: rebuild board without 進行中
  const board2 = makeFakeBoard(['待辦', '已完成']);
  v.contentEl = board2.contentEl; v.__board = board2;
  v.restoreArchived(0);
  ok('老家欄消失：退回第一欄', board2.lanes[0].list.__placed.length === 1);
}

// 4. backups: backupWhen parses the timestamp; listBackups filters to this board's .md, newest first
{
  ok('backupWhen 解析時間戳', backupWhen('我的板-2026-06-14T02-30-05-000Z.md') === '2026-06-14 02:30:05');
  const v = Object.create(BoardView.prototype);
  v.filePath = 'Boards/我的板.md';
  v.app = { vault: { getAbstractFileByPath: (p) => p === '_tugtile-backups' ? { children: [
    { name: '我的板-2026-06-14T01-00-00-000Z.md' },
    { name: '我的板-2026-06-14T03-00-00-000Z.md' },
    { name: '別的板-2026-06-14T02-00-00-000Z.md' },
    { name: '我的板-notes.txt' },
  ] } : null } };
  const b = v.listBackups();
  ok('listBackups 只挑這塊板的 .md（2 份）', b.length === 2);
  ok('listBackups 最新在前', b[0].name.includes('T03') && b[1].name.includes('T01'));
}

console.log(fail ? ('\n✗ ' + fail + ' failed') : ('\n✅ archive-restore-e2e all pass (' + pass + ')'));
if (fail) process.exit(1);
