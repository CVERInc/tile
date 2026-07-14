// Guard against the 7 bugs identified during the Phase A adversarial review (out/review-phaseA.md): C1 C2 H1 M1 M2 M3 L1.
// Pure Node.js, extracting the CORE from plugin.src.js.
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'packages', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function tileRenderText'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={parseFile,serializeFile};')(m);
const { parseFile, serializeFile } = m.exports;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name); } };
const L = (arr) => arr.join('\n');

// ---- C1: CRLF card header prefix is not left over, and editing does not stack them ----
{
  const crlf = '## Todo\r\n\r\n- [ ] hello\r\n\r\n%% kanban:settings\r\n```\r\n{}\r\n```\r\n%%\r\n';
  const md = parseFile(crlf);
  ok('C1 CRLF 牌 text 去掉前綴與 \\r', md.columns[0].tiles[0].text === 'hello');
  // Simulate editing: rebuilding raw from text should not add another layer of - [ ]
  const reraw = '- [ ] ' + md.columns[0].tiles[0].text;
  ok('C1 重建 raw 無雙重前綴', reraw === '- [ ] hello');
}

// ---- C2: Isolated *** in lead is not treated as archive, preventing active cards from being swallowed ----
{
  const b = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', 'desc', '', '***', '', 'more', '', '- [ ] real card', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(b);
  ok('C2 真牌仍在 Todo 欄（沒被封存）', md.columns[0].tiles.length === 1 && md.columns[0].tiles[0].text === 'real card');
  ok('C2 archive 為空（孤立 *** 不算分隔）', md.archive === '');
  ok('C2 *** 與 more 留在 lead', md.columns[0].lead.join('\n').indexOf('***') !== -1);
}

// ---- C2b: archive is only recognized when *** is followed by ## ----
{
  const b = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', '- [ ] a', '', '***', '', '## Archive', '', '- [x] z', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(b);
  ok('C2b *** + ## Archive 仍正確當封存', md.columns.length === 1 && md.archive.indexOf('- [x] z') !== -1);
}

// ---- H1: ## lines within code fences inside lead do not become phantom columns ----
{
  const b = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', '```python', '## a comment line', 'x = 1', '```', '', '- [ ] card', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(b);
  ok('H1 只有一欄（fence 內 ## 不成欄）', md.columns.length === 1 && md.columns[0].title === 'Todo');
  ok('H1 牌正常解析', md.columns[0].tiles.length === 1 && md.columns[0].tiles[0].text === 'card');
  ok('H1 code block 保留在 lead', md.columns[0].lead.join('\n').indexOf('## a comment line') !== -1);
  ok('H1 round-trip 冪等', (() => { const o = serializeFile(md); return o === serializeFile(parseFile(o)); })());
}

// ---- M1 (Fixed): archive separator only recognizes ***, and does not misidentify --- / ___ (aligns with kanban to prevent swallowing columns) ----
{
  const star = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', '- [ ] a', '', '***', '', '## Archive', '', '- [x] z', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(star);
  ok('M1 *** 當封存分隔', md.columns.length === 1 && md.archive.indexOf('- [x] z') !== -1);
  for (const hr of ['---', '___']) {
    const b = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', '- [ ] a', '', hr, '', '## Archive', '', '- [x] z', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
    const m2 = parseFile(b);
    ok('M1 ' + hr + ' 不當封存（Archive 成普通欄、不吞）', m2.archive === '' && m2.columns.length === 2);
  }
}

// ---- M2: archive-only with no active columns ----
{
  const b = L(['---', 'kanban-plugin: board', '---', '', '***', '', '## Archive', '', '- [x] x', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(b);
  ok('M2 純封存板：0 真欄', md.columns.length === 0);
  ok('M2 純封存板：封存牌不復活成活躍', md.archive.indexOf('- [x] x') !== -1);
}

// ---- M3: CRLF file saves back without mixing line endings ----
{
  const crlf = '## Todo\r\n\r\n- [ ] hello\r\n\r\n%% kanban:settings\r\n```\r\n{}\r\n```\r\n%%\r\n';
  const out = serializeFile(parseFile(crlf));
  ok('M3 輸出全 CRLF（無裸 \\n）', !/[^\r]\n/.test(out) && out.indexOf('\r\n') !== -1);
  ok('M3 CRLF 往返冪等', out === serializeFile(parseFile(out)));
  // LF files still output LF
  const lf = serializeFile(parseFile('## A\n\n- [ ] x\n\n%% kanban:settings\n```\n{}\n```\n%%\n'));
  ok('M3 LF 檔仍輸出 LF（無 \\r）', lf.indexOf('\r') === -1);
}

// ---- L1: 3-space continuation indentation is also stripped ----
{
  const b = L(['---', 'kanban-plugin: board', '---', '', '## Todo', '', '- [ ] head', '   three', '', '%% kanban:settings', '```', '{}', '```', '%%', '']);
  const md = parseFile(b);
  ok('L1 3 空白續行被去縮排', md.columns[0].tiles[0].text === 'head\nthree');
}

console.log(fail === 0 ? `\n✅ review-phaseA all pass (${pass})` : `\n❌ ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
