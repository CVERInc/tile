// tugtile CJK / display-width engine tests (Pure Node.js, no npm dependencies).
//
// Covers the CORE pieces that make CJK a tested fact rather than a claim:
//   1. displayWidth() — visual column counting (CJK/fullwidth = 2, latin = 1), incl. the long-card
//      collapse boundary (>60 columns) and surrogate-pair handling.
//   2. parseFile() fullwidth tolerance — a checkbox written with a non-ASCII mark inside `- [x]`
//      style parses without crashing and the raw line survives parse→serialize verbatim.
//   3. homeKey() fullwidth-space handling — the lane-name matcher collapses U+3000 like any whitespace.
//
// Loading mirrors the other engine tests: slice the CORE block out of plugin.src.js and evaluate it
// with `new Function` so the pure helpers run Obsidian-free. We slice from `function homeKey` (rather
// than `function tileRenderText`) so homeKey is included alongside displayWidth/parseFile/serializeFile.
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'plugin.src.js'), 'utf8');
const core = src.slice(src.indexOf('function homeKey'), src.indexOf('/* ===================== /CORE'));
const m = {};
new Function('module', core + '\nmodule.exports={homeKey,displayWidth,parseFile,serializeFile,tileRenderText};')(m);
const { homeKey, displayWidth, parseFile, serializeFile } = m.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };

// ---------- 1. displayWidth: visual columns ----------
ok('displayWidth latin-only ("hello"→5)', displayWidth('hello') === 5);
ok('displayWidth CJK ("理牌"→4)', displayWidth('理牌') === 4);
ok('displayWidth mixed ("a理b"→4)', displayWidth('a理b') === 4);
ok('displayWidth fullwidth punctuation ("：，"→4)', displayWidth('：，') === 4);
ok('displayWidth empty→0', displayWidth('') === 0);
// Hiragana + Katakana + Hangul syllable are all width-2 (spot-check each declared block)
ok('displayWidth kana ("あ"→2, "カ"→2)', displayWidth('あ') === 2 && displayWidth('カ') === 2);
ok('displayWidth hangul ("한"→2)', displayWidth('한') === 2);
ok('displayWidth ideographic space U+3000 →2', displayWidth('　') === 2);
// Surrogate-pair (astral) CJK Extension B char "𠀀" (U+20000): 1 code point, .length===2, width 2.
ok('displayWidth surrogate-pair CJK ("𠀀"→2, not 4)', displayWidth('𠀀') === 2 && '𠀀'.length === 2);

// ---------- 1b. long-card collapse boundary (>60 visual columns) ----------
// isLong is computed inline in host (View) code as `displayWidth(meta.clean) > 60`, so we assert the
// pure boundary the host relies on. Latin behaviour is unchanged: 60 latin chars = width 60 (NOT long),
// 61 latin chars = width 61 (long) — identical to the old `.length > 60`.
ok('latin 60 chars = width 60 (not long)', displayWidth('x'.repeat(60)) === 60);
ok('latin 61 chars = width 61 (>60, long)', displayWidth('x'.repeat(61)) === 61 && 61 > 60);
// CJK: ~30 chars reach the same visual budget. 29 CJK = width 58 (not long); 31 CJK = width 62 (long).
ok('29 CJK chars = width 58 (≤60, not long)', displayWidth('理'.repeat(29)) === 58 && !(58 > 60));
ok('31 CJK chars = width 62 (>60, would collapse)', displayWidth('理'.repeat(31)) === 62 && 62 > 60);

// ---------- 2. parseFile: fullwidth / non-ASCII checkbox tolerance + raw fidelity ----------
// The checkbox matcher is /^- \[(.)\]/ — it captures ANY single char inside the brackets, so a fullwidth
// or non-ASCII mark (here a fullwidth "Ｘ") must parse without crashing and round-trip verbatim.
const fwMark = '- [Ｘ] 完成的卡片';   // fullwidth Ｘ (U+FF38) inside the checkbox brackets
const board = ['## 進行中', '', fwMark].join('\n');
let model = null, threw = false;
try { model = parseFile(board); } catch (e) { threw = true; }
ok('parseFile tolerates fullwidth checkbox mark (no crash)', !threw && !!model);
ok('fullwidth checkbox card parsed', !!model && model.columns.length === 1 && model.columns[0].tiles.length === 1);
ok('fullwidth checkbox mark captured verbatim', !!model && model.columns[0].tiles[0].check === 'Ｘ');
ok('raw line preserved verbatim (round-trip fidelity)', !!model && model.columns[0].tiles[0].raw === fwMark);
ok('parse→serialize keeps the fullwidth checkbox line', serializeFile(parseFile(board)).includes(fwMark));
ok('round-trip idempotent', serializeFile(parseFile(board)) === serializeFile(parseFile(serializeFile(parseFile(board)))));

// ---------- 3. homeKey: fullwidth space (U+3000) handling ----------
// homeKey collapses /\s+/ → single space; \s matches the ideographic space U+3000, so a lane named with
// a fullwidth space must produce the same key as its ASCII-space twin (else a restore token won't match).
ok('homeKey collapses fullwidth space U+3000', homeKey('進行　中') === '進行 中');
ok('homeKey fullwidth-space == ascii-space twin', homeKey('進行　中') === homeKey('進行 中'));
ok('homeKey trims + collapses mixed whitespace', homeKey('  進行 　 中  ') === '進行 中');

console.log(fail ? ('\n✗ ' + fail + ' failed') : ('\n✅ cjk all pass (' + pass + ')'));
if (fail) process.exit(1);
