// tugtile regression test: guards C1 (empty board with settings) and M1 (column lead text retention) identified during review.
// Pure Node.js, extracting the CORE functions from plugin.src.js.
const fs = require('node:assert');
const assert = require('node:assert');
const path = require('path');

const src = require('fs').readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function tileRenderText'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={parseFile,serializeFile};')(m);
const { parseFile, serializeFile } = m.exports;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name); } };
const count = (s, sub) => s.split(sub).length - 1;

// ---- C1: Empty board created by official kanban (0 columns, settings present) ----
const empty = '---\nkanban-plugin: board\n---\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n';
{
  const md = parseFile(empty);
  ok('C1 空看板：pre 不含 settings', md.pre.indexOf('kanban:settings') === -1);
  ok('C1 空看板：post 含 settings', md.post.indexOf('kanban:settings') !== -1);
  ok('C1 空看板：0 欄', md.columns.length === 0);
  // Simulate adding the first column
  md.columns.push({ header: '## 新欄', title: '新欄', tiles: [{ raw: '- [ ] 卡片', text: '卡片' }], lead: [] });
  const out = serializeFile(md);
  ok('C1 新增欄後 settings 只出現一次', count(out, '%% kanban:settings') === 1);
  const md2 = parseFile(out);
  ok('C1 重開後欄還在（1 欄、未被吞）', md2.columns.length === 1 && md2.columns[0].title === '新欄');
  ok('C1 重開後牌還在', md2.columns[0].tiles.length === 1 && md2.columns[0].tiles[0].text === '卡片');
}

// ---- M1: Column lead (text between title and the first card) description text must be preserved ----
const withLead = '---\nkanban-plugin: board\n---\n\n## Todo\n\n這是欄首說明文字\n\n- [ ] 卡片A\n- [ ] 卡片B\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n';
{
  const md = parseFile(withLead);
  ok('M1 lead 被保留（非丟棄）', md.columns[0].lead.join('\n').indexOf('這是欄首說明文字') !== -1);
  const out = serializeFile(md);
  ok('M1 serialize 仍含欄首文字', out.indexOf('這是欄首說明文字') !== -1);
  const md2 = parseFile(out);
  ok('M1 round-trip 後 lead 一致', md2.columns[0].lead.join('\n') === md.columns[0].lead.join('\n'));
  // Idempotency
  ok('M1 serialize 冪等', serializeFile(md2) === out);
}

// ---- A1: Multiline continuation indentation accepts "4 spaces" (written this way by kanban in a vault with useTab=false) ----
{
  const fourSpace = '---\nkanban-plugin: board\n---\n\n## L\n\n- [ ] 第一行\n    第二行\n    第三行\n\n\n%% kanban:settings\n```\n{}\n```\n%%\n';
  const md = parseFile(fourSpace);
  const t = md.columns[0].tiles[0].text;
  ok('A1 4空白續行被去縮排（text 無前導空白）', t === '第一行\n第二行\n第三行');
}

console.log(fail === 0 ? `\n✅ regression all pass (${pass})` : `\n❌ ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
