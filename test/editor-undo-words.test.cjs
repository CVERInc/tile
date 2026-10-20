// The text editor's undo/redo take the platform's plain words; the board keeps its card-game joke.
//
// One action, one name per surface: marktile's Mac app shows macOS's own "Undo"/"還原" in its Edit menu, so a
// toolbar button reading "悔牌（復原）" — the board's word for taking back a tile — named the same key twice.
// tugtile's board actions (undoAction/redoAction) are untouched; this only pins which keys the EDITOR uses.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'editor-core.js'), 'utf8');
const locales = fs.readdirSync(path.join(ROOT, 'i18n')).filter((f) => f.endsWith('.json'));

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg); } };

const tip = (key) => { const m = new RegExp("\\{ key: '" + key + "'[^}]*tip: '([^']+)'").exec(core); return m && m[1]; };
ok(tip('undo') === 'edUndo', "EDITOR_TOOLS undo uses edUndo (got " + tip('undo') + ")");
ok(tip('redo') === 'edRedo', "EDITOR_TOOLS redo uses edRedo (got " + tip('redo') + ")");

// The words themselves: macOS's Edit-menu strings, the same ones hosts/mac/Localization carries.
const want = { 'en-US': ['Undo', 'Redo'], 'ja-JP': ['取り消す', 'やり直す'], 'ko-KR': ['실행 취소', '실행 복귀'], 'zh-TW': ['還原', '重做'] };
for (const f of locales) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', f), 'utf8'));
  const loc = f.replace(/\.json$/, '');
  ok(typeof d.edUndo === 'string' && d.edUndo && typeof d.edRedo === 'string' && d.edRedo, loc + ': edUndo/edRedo present');
  if (want[loc]) {
    ok(d.edUndo === want[loc][0], loc + ': edUndo is the system word ' + want[loc][0] + ' (got ' + d.edUndo + ')');
    ok(d.edRedo === want[loc][1], loc + ': edRedo is the system word ' + want[loc][1] + ' (got ' + d.edRedo + ')');
  }
  ok(d.undoAction && d.undoAction !== d.edUndo || loc === 'en-US', loc + ': the board keeps its own undoAction');
}

if (fail) { console.log('editor-undo-words: ' + fail + ' failed'); process.exit(1); }
console.log('editor-undo-words: ok');
