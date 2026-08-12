// kitchen-sink: a board with all possible kanban structures, verifying that tugtile round-trips without data loss and the board remains readable by kanban.
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function tileRenderText'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={parseFile,serializeFile,extractMeta,extractTags};')(m);
const { parseFile, serializeFile } = m.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

const settings = '{"kanban-plugin":"board","list-collapse":[true,false],"new-line-trigger":"shift-enter","show-checkboxes":true,"tag-colors":[{"tagKey":"#標籤","color":"#fff","backgroundColor":"#a00"}],"date-format":"YYYY-MM-DD","hide-card-count":false,"unknown-future-key":42}';
const B = [
  '---', 'kanban-plugin: board', '---', '',
  '## 待辦 (3)', '', '欄首說明文字', '',
  '- [ ] 一般牌 #標籤 @{2026-06-10}',
  '- [x] 已完成 ^blk1',
  '- [ ] 多行tab', '\t第二行 @@{15:30}', '\t- 子項',
  '- [ ] 多行4空白', '    第二行空白縮排', '',
  '## 進行中<br>副標', '', '**Complete**', '',
  '- [ ] 連結 [[wiki]] 與 ![[圖.png]] 和 [外](https://x.com/p#sec)', '',
  '***', '', '## Archive', '',
  '- [x] 封存牌1', '- [ ] 封存牌2 @{2026-01-01}', '',
  '%% kanban:settings', '```', settings, '```', '%%', '',
].join('\n');

const md = parseFile(B);
const out1 = serializeFile(md), md2 = parseFile(out1), out2 = serializeFile(md2);
const strip = (s) => s.replace(/[ \t\r\n]+/g, '');

ok('只 2 真欄（Archive 不算欄）', md.columns.length === 2);
ok('待辦 4 牌 / 進行中 1 牌', md.columns[0].tiles.length === 4 && md.columns[1].tiles.length === 1);
ok('WIP (3) 保留', md.columns[0].header.indexOf('(3)') !== -1);
ok('<br> 標題保留', md.columns[1].header.indexOf('<br>') !== -1);
ok('**Complete** 在 lead', md.columns[1].lead.join('').indexOf('**Complete**') !== -1);
ok('欄首說明保留', md.columns[0].lead.join('').indexOf('欄首說明文字') !== -1);
ok('blockId ^blk1 保留', md.columns[0].tiles[1].raw.indexOf('^blk1') !== -1);
ok('[x] 勾選保留', md.columns[0].tiles[1].raw.indexOf('- [x]') === 0);
ok('tab 多行去縮排', md.columns[0].tiles[2].text === '多行tab\n第二行 @@{15:30}\n- 子項');
ok('4 空白多行去縮排', md.columns[0].tiles[3].text === '多行4空白\n第二行空白縮排');
ok('archive 含兩張封存牌', md.archive.indexOf('封存牌1') !== -1 && md.archive.indexOf('封存牌2') !== -1);
ok('未知設定鍵保留', out1.indexOf('unknown-future-key') !== -1 && out1.indexOf('tag-colors') !== -1);
ok('連結/嵌入/URL#frag 原樣保留', out1.indexOf('[[wiki]]') !== -1 && out1.indexOf('![[圖.png]]') !== -1 && out1.indexOf('https://x.com/p#sec') !== -1);
ok('冪等 out1===out2', out1 === out2);
ok('內容零變動（去空白完全相等）', strip(B) === strip(out1));

console.log(fail === 0 ? `\n✅ kitchensink all pass (${pass})` : `\n❌ ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
