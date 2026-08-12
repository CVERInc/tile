// tugtile compatibility hardening tests (Phase A): using a real, comprehensive kanban board
// to verify that parse→serialize→reparse is non-destructive and idempotent, and that archive / (N) / **Complete** / <br> /
// blockId / @{} / #tags / 4-space indentation / [x] / CJK are all safely preserved.
// Pure Node.js, extracting the CORE from plugin.src.js.
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function tileRenderText'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={parseFile,serializeFile,setListCollapse,parseWip,extractMeta,extractTags,setSetting,formatDateTokens,parseDateStr};')(m);
const { parseFile, serializeFile, setListCollapse, parseWip, extractMeta, extractTags, setSetting, formatDateTokens, parseDateStr } = m.exports;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name); } };

const board = [
  '---',
  'kanban-plugin: board',
  '---',
  '',
  '## 待辦 (3)',
  '',
  '- [ ] 第一張 #tag1 @{2026-06-06}',
  '- [ ] 多行卡',
  '\t第二行內文',
  '\t- 子項目',
  '- [x] 已完成的牌 ^block123',
  '',
  '## 進行中<br>子標題',
  '',
  '**Complete**',
  '',
  '- [ ] 用四空白縮排的卡',
  '    這行用四個空白',
  '',
  '***',
  '',
  '## Archive',
  '',
  '- [ ] 被封存的卡 @{2026-01-01}',
  '- [ ] 另一張封存',
  '',
  '%% kanban:settings',
  '```',
  '{"kanban-plugin":"board","list-collapse":[false,false]}',
  '```',
  '%%',
  '',
].join('\n');

const md = parseFile(board);

// --- A2 Archive Zone ---
ok('A2 只解析出 2 個真欄（Archive 不算欄）', md.columns.length === 2);
ok('A2 欄名是 待辦/進行中（沒有 Archive 欄）', md.columns.map((c) => c.title).join(',').indexOf('Archive') === -1);
ok('A2 archive 區被擷取且以 *** 開頭', md.archive.indexOf('***') === 0);
ok('A2 archive 含被封存的卡', md.archive.indexOf('被封存的卡') !== -1 && md.archive.indexOf('另一張封存') !== -1);
ok('A2 archive 含 ## Archive 標題', md.archive.indexOf('## Archive') !== -1);

// --- *** is not attached to the preceding card ---
const lastTileOfCol2 = md.columns[1].tiles[md.columns[1].tiles.length - 1];
ok('A2 *** 未黏進進行中最後一張牌', lastTileOfCol2.raw.indexOf('***') === -1);

// --- A3 (N) / **Complete** retention ---
ok('A3 待辦欄 (3) WIP 上限保留在 header', md.columns[0].header.indexOf('(3)') !== -1);
ok('A3 **Complete** 保留在進行中欄 lead', md.columns[1].lead.join('\n').indexOf('**Complete**') !== -1);

// --- A4 <br> lane title retention ---
ok('A4 <br> 換行標題原樣保留', md.columns[1].header.indexOf('進行中<br>子標題') !== -1);

// --- blockId / [x] / @{} / #tag ---
ok('blockId ^block123 保留在 raw', md.columns[0].tiles[2].raw.indexOf('^block123') !== -1);
ok('[x] 勾選狀態保留在 raw', md.columns[0].tiles[2].raw.indexOf('- [x]') === 0);
ok('@{日期} 保留', md.columns[0].tiles[0].text.indexOf('@{2026-06-06}') !== -1);
ok('#標籤 保留', md.columns[0].tiles[0].text.indexOf('#tag1') !== -1);

// --- A1 Strip 4-space continuation indentation (display text has no leading spaces), but preserve in raw for round-tripping ---
ok('A1 4空白卡 text 去縮排', md.columns[1].tiles[0].text === '用四空白縮排的卡\n這行用四個空白');

// --- Multiline tab-indented card ---
ok('tab 多行卡 text 去一層縮排', md.columns[0].tiles[1].text === '多行卡\n第二行內文\n- 子項目');

// --- Round-trip preserves content + Idempotency ---
const shape = (x) => JSON.stringify({
  cols: x.columns.map((c) => ({ h: c.header, lead: c.lead, tiles: c.tiles.map((t) => t.text) })),
  archive: x.archive,
  post: x.post.replace(/^\s+|\s+$/g, ''),
});
const out1 = serializeFile(md);
const md2 = parseFile(out1);
ok('往返後結構/內容完全一致', shape(md) === shape(md2));
ok('serialize 冪等（out1 === out2）', out1 === serializeFile(md2));
ok('封存內容仍在輸出', out1.indexOf('被封存的卡') !== -1 && out1.indexOf('## Archive') !== -1);
ok('settings 只出現一次', out1.split('%% kanban:settings').length - 1 === 1);
ok('list-collapse 設定原樣保留', out1.indexOf('"list-collapse":[false,false]') !== -1);

// --- B2 Card checkbox character parsing ---
ok('B2 已勾選牌 check === x', md.columns[0].tiles[2].check === 'x');
ok('B2 未勾選牌 check === 空白', md.columns[0].tiles[0].check === ' ');

// --- A5/B7 settings JSON fault-tolerant parsing ---
ok('settings 被解析成物件', md.settings && Array.isArray(md.settings['list-collapse']));
ok('壞 JSON 不爆（回空物件、不毀檔）', (() => {
  const bad = parseFile('---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] x\n\n%% kanban:settings\n```\n{壞掉的 json,,,\n```\n%%\n');
  return bad && typeof bad.settings === 'object' && bad.columns.length === 1;
})());

// --- B1 Archived cards: round-trip remains idempotent after appending raw to archive ---
{
  const m3 = parseFile(out1);
  m3.archive = (m3.archive.replace(/\s+$/, '')) + '\n- [ ] 新封存的牌';
  const o3 = serializeFile(m3);
  const m4 = parseFile(o3);
  ok('B1 封存追加後仍在 archive', m4.archive.indexOf('新封存的牌') !== -1);
  ok('B1 封存追加未變成欄', m4.columns.length === 2);
  ok('B1 封存追加後冪等', o3 === serializeFile(m4));
}

// ---- Column collapse: setListCollapse accurately overwrites list-collapse, leaving other settings untouched ----
{
  const honey = '%% kanban:settings\n```\n{"kanban-plugin":"list","list-collapse":[true,true,false,true,true,true,true],"new-line-trigger":"enter","full-list-lane-width":true}\n```\n%%';
  const out = setListCollapse(honey, [false, false, false, false, false, false, false]);
  ok('收合：list-collapse 被改寫', out.indexOf('"list-collapse":[false,false,false,false,false,false,false]') !== -1);
  ok('收合：其他設定原樣保留', out.indexOf('"new-line-trigger":"enter"') !== -1 && out.indexOf('"full-list-lane-width":true') !== -1 && out.indexOf('"kanban-plugin":"list"') !== -1);
  // Insert when list-collapse key is missing
  const noKey = '%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%';
  const ins = setListCollapse(noKey, [true, false]);
  ok('收合：無鍵時插入 list-collapse', ins.indexOf('"list-collapse":[true,false]') !== -1 && ins.indexOf('"kanban-plugin":"board"') !== -1);
  ok('收合：插入後 JSON 仍可解析', (() => { try { JSON.parse(/```\s*\n([\s\S]*?)\n```/.exec(ins)[1]); return true; } catch (e) { return false; } })());
  // Empty object
  ok('收合：空物件插入正確', setListCollapse('{}', [true]).indexOf('{"list-collapse":[true]}') !== -1);
}

// ---- WIP (N) parsing ----
{
  ok('WIP：解析 (3)', parseWip('進行中 (3)').max === 3 && parseWip('進行中 (3)').title === '進行中');
  ok('WIP：無上限', parseWip('待辦').max === null && parseWip('待辦').title === '待辦');
  ok('WIP：含全形空格標題', parseWip('第一回　申請 (5)').max === 5 && parseWip('第一回　申請 (5)').title === '第一回　申請');
  ok('WIP：(0) 也算上限', parseWip('X (0)').max === 0);
  ok('WIP：括號非數字不誤判', parseWip('備註(草稿)').max === null);
}

// ---- Date/time token extraction (overlapping prefixes: prioritize time first) ----
{
  const a = extractMeta('買票 @{2026-06-10}');
  ok('日期：抽出 date、clean 去 token', a.date === '2026-06-10' && a.clean === '買票' && a.time === null);
  const b = extractMeta('開會 @{2026-06-10} @@{15:00}');
  ok('時間：date+time 都抽出', b.date === '2026-06-10' && b.time === '15:00' && b.clean === '開會');
  const c = extractMeta('只有時間 @@{09:30}');
  ok('時間：只有 @@{} 不被當 date', c.time === '09:30' && c.date === null);
  const d = extractMeta('沒有日期的牌');
  ok('日期：無 token 時 date/time 為 null、clean 不變', d.date === null && d.time === null && d.clean === '沒有日期的牌');
  const e = extractMeta('多行\n第二行 @{2026-01-01}\n第三行');
  ok('日期：多行牌也抽得到、保留其餘行', e.date === '2026-01-01' && e.clean === '多行\n第二行\n第三行');
  const f = extractMeta('兩個日期 @{2026-01-01} 和 @{2026-02-02}');
  ok('日期：多個 token 取首個值、殘留全清（不裸露）', f.date === '2026-01-01' && f.clean.indexOf('@{') === -1);
  const g = extractMeta('連每日筆記 @[[2026-06-10]]');
  ok('日期：@[[..]] (link-date-to-daily-note) 也辨識', g.date === '2026-06-10' && g.clean === '連每日筆記' && g.clean.indexOf('@[[') === -1);
}

// ---- Tag extraction (supports CJK, stops at punctuation) ----
{
  ok('標籤：英數 + CJK', JSON.stringify(extractTags('做 #旅行 和 #todo2 完成')) === JSON.stringify(['#旅行', '#todo2']));
  ok('標籤：遇全形標點停', JSON.stringify(extractTags('規劃 #第一回，然後')) === JSON.stringify(['#第一回']));
  ok('標籤：無標籤回空陣列', extractTags('沒有標籤').length === 0);
}

// ---- setSetting general settings write-back (view mode, etc.) ----
{
  const honey = '%% kanban:settings\n```\n{"kanban-plugin":"list","list-collapse":[true,false],"new-line-trigger":"enter"}\n```\n%%';
  const o1 = setSetting(honey, 'tugtile-view', 'table');
  ok('setSetting：插入新鍵', o1.indexOf('"tugtile-view":"table"') !== -1);
  ok('setSetting：其他鍵不動', o1.indexOf('"new-line-trigger":"enter"') !== -1 && o1.indexOf('"list-collapse":[true,false]') !== -1);
  const o2 = setSetting(o1, 'tugtile-view', 'board');
  ok('setSetting：改寫既有字串值', o2.indexOf('"tugtile-view":"board"') !== -1 && o2.indexOf('table') === -1);
  ok('setSetting：JSON 仍合法', (() => { try { JSON.parse(/```\s*\n([\s\S]*?)\n```/.exec(o2)[1]); return true; } catch (e) { return false; } })());
}

// ---- blockId: hide from text, preserve in raw ----
{
  const b = ['---', 'kanban-plugin: board', '---', '', '## A', '', '- [ ] 卡片內容 ^abc123', '', '%% kanban:settings', '```', '{}', '```', '%%', ''].join('\n');
  const md = parseFile(b);
  const t = md.columns[0].tiles[0];
  ok('blockId：text 隱藏 ^id', t.text === '卡片內容' && t.block === 'abc123');
  ok('blockId：raw 保留 ^id', t.raw.indexOf('^abc123') !== -1);
  ok('blockId：往返後 ^id 仍在', serializeFile(md).indexOf('^abc123') !== -1);
}

// ---- date-format: parse/format non-ISO formats (aligns with kanban date-format) ----
{
  ok('date-format：DD/MM/YYYY 解析', JSON.stringify(parseDateStr('31/12/2025', 'DD/MM/YYYY')) === JSON.stringify({ y: 2025, mo: 12, d: 31 }));
  ok('date-format：ISO 解析', JSON.stringify(parseDateStr('2026-06-10', 'YYYY-MM-DD')) === JSON.stringify({ y: 2026, mo: 6, d: 10 }));
  ok('date-format：非法日期回 null', parseDateStr('2026-13-45', 'YYYY-MM-DD') === null);
  ok('date-format：格式化 DD/MM/YYYY', formatDateTokens({ y: 2025, mo: 12, d: 31 }, 'DD/MM/YYYY') === '31/12/2025');
  ok('date-format：含時間格式化', formatDateTokens({ y: 2026, mo: 6, d: 7, h: 9, mi: 5 }, 'YYYY-MM-DD HH:mm') === '2026-06-07 09:05');
}

console.log(fail === 0 ? `\n✅ compat all pass (${pass})` : `\n❌ ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
