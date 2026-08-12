// tugtile archive "restore to home lane": the %%tg-home:Lane%% token must be hidden in display, survive the
// archive round-trip, and the restore strip regex must recover the lane name and remove the token cleanly.
// Pure Node.js, extracting the CORE from plugin.src.js (View methods like addToArchive/restoreArchived are
// DOM-bound and live outside CORE; this covers the serialisable + display logic they rely on).
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function tileRenderText'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={parseFile,serializeFile,tileRenderText};')(m);
const { parseFile, serializeFile, tileRenderText } = m.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

// 1. display hides the token (archived cards only; active cards never carry it)
ok('tileRenderText 藏 home token', tileRenderText(['- [ ] 卡片內容 %%tg-home:進行中%%']) === '卡片內容');
ok('home 藏掉、blockId 留', tileRenderText(['- [ ] 內容 %%tg-home:Todo%% ^abc']) === '內容 ^abc');
ok('無 token 不受影響', tileRenderText(['- [ ] 一般內容']) === '一般內容');

// 2. round-trip: an archive blob carrying the token survives parse→serialize and stays idempotent
const board = ['## 進行中', '', '- [ ] 活躍卡', '', '***', '', '## Archive', '', '- [ ] 封存卡 %%tg-home:進行中%%'].join('\n');
const out = serializeFile(parseFile(board));
ok('home token 在 archive round-trip 後保留', out.includes('%%tg-home:進行中%%'));
ok('round-trip 冪等', serializeFile(parseFile(out)) === out);

// 3. restore: the strip regex recovers the lane name and removes the token (leaving any blockId intact)
const raw = '- [ ] 封存卡 %%tg-home:進行中%% ^id1';
const hm = /\s*%%tg-home:(.*?)%%/.exec(raw);
ok('復原解析出 home 欄名', !!hm && hm[1] === '進行中');
ok('復原 strip 後乾淨（blockId 留）', raw.replace(/\s*%%tg-home:.*?%%/, '') === '- [ ] 封存卡 ^id1');

console.log(fail ? ('\n✗ ' + fail + ' failed') : ('\n✅ archive-home all pass (' + pass + ')'));
if (fail) process.exit(1);
