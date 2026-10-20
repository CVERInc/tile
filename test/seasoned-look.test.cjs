// Seasoned's look: the three-way palette, the font, and the back-compat read of the setting they replaced.
//
// The settings keys are a CONTRACT with more than one host: the Obsidian plugin stores them, and the macOS app
// stores the same keys in its own defaults and hands them to the same equipEditor. So the mapping is tested as a
// pure function, the classes as what lands on the mount, and the stylesheet for the one thing a class cannot
// promise on its own — that the rule it names exists and is not outranked.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'editor-core.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let fail = 0;
const eq = (got, want, msg) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('  ✗', msg, '— got', JSON.stringify(got), 'want', JSON.stringify(want)); }
};
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg); } };

// Pull a top-level `function name(...) { ... }` out of the core (it closes at a column-0 `}`).
function grabFn(name) {
  const start = core.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('editor-core.js: function ' + name + ' not found');
  const end = core.indexOf('\n}', start + 1);
  return core.slice(start + 1, end + 2);
}
const palettes = /const SEASONED_PALETTES = (\[[^\]]*\]);/.exec(core);
if (!palettes) throw new Error('editor-core.js: SEASONED_PALETTES not found');
const { seasonedLook, applySeasonedLook } = eval(
  '(() => { const SEASONED_PALETTES = ' + palettes[1] + ';\n' + grabFn('seasonedLook') + '\n' + grabFn('applySeasonedLook') +
  '\nreturn { seasonedLook, applySeasonedLook }; })()');

// ── the mapping ──────────────────────────────────────────────────────────────────────────────────────────────
eq(seasonedLook(undefined), { palette: 'accent', font: 'mono' }, 'no settings at all → today\'s look');
eq(seasonedLook({}), { palette: 'accent', font: 'mono' }, 'empty settings → accent + mono');
eq(seasonedLook({ seasonedColor: true }), { palette: 'color', font: 'mono' }, 'legacy seasonedColor:true → color (a vault set up before the choice keeps its colours)');
eq(seasonedLook({ seasonedColor: false }), { palette: 'accent', font: 'mono' }, 'legacy seasonedColor:false → accent');
eq(seasonedLook({ seasonedPalette: 'plain', seasonedColor: true }), { palette: 'plain', font: 'mono' }, 'an explicit palette beats the legacy flag');
eq(seasonedLook({ seasonedPalette: 'accent', seasonedColor: true }), { palette: 'accent', font: 'mono' }, 'explicit accent beats legacy colour too');
eq(seasonedLook({ seasonedPalette: 'neon', seasonedColor: true }), { palette: 'color', font: 'mono' }, 'an unknown palette falls back to what the legacy flag says, never to nothing');
eq(seasonedLook({ seasonedPalette: 'neon' }), { palette: 'accent', font: 'mono' }, 'an unknown palette with no legacy flag → accent');
eq(seasonedLook({ seasonedFont: 'text' }), { palette: 'accent', font: 'text' }, 'font text');
eq(seasonedLook({ seasonedFont: 'serif' }), { palette: 'accent', font: 'mono' }, 'an unknown font → mono');

// ── what lands on the mount ──────────────────────────────────────────────────────────────────────────────────
const mount = () => { const set = new Set(['marktile-ed']); return { set, classList: { toggle: (c, on) => (on ? set.add(c) : set.delete(c)) } }; };
const classes = (m) => [...m.set].filter((c) => c !== 'marktile-ed').sort();
let m = mount();
applySeasonedLook(m, seasonedLook({}));
eq(classes(m), [], 'accent + mono puts no look class on the mount (today\'s markup, unchanged)');
applySeasonedLook(m, seasonedLook({ seasonedPalette: 'plain', seasonedFont: 'text' }));
eq(classes(m), ['marktile-font-text', 'marktile-palette-plain'], 'plain + text');
applySeasonedLook(m, seasonedLook({ seasonedColor: true }));
eq(classes(m), ['marktile-palette-color'], 're-applying CLEARS what the previous look set (live change from settings)');
ok(/setLook\(settings\) \{ applySeasonedLook\(mount, seasonedLook\(settings\)\); \}/.test(grabFn('equipEditor')),
  'equipEditor returns setLook, the live re-apply the settings tab and the Mac app call');

// ── the stylesheet ───────────────────────────────────────────────────────────────────────────────────────────
// Find a rule by its exact selector list and return [index, body]. Existence first: an order check on a missing
// rule compares -1 and passes for the wrong reason.
function rule(selector) {
  const i = css.indexOf('\n' + selector + ' {');
  ok(i >= 0, 'styles.css has a rule for `' + selector.replace(/\n/g, ' ') + '`');
  if (i < 0) return [-1, ''];
  return [i, css.slice(i, css.indexOf('}', i))];
}
const [plainH, plainBody] = rule('.marktile-palette-plain .tugtile-ed-rich .tg-h,\n.marktile-palette-plain .tugtile-ed-rich .tg-code,\n.marktile-palette-plain .tugtile-ed-rich .tg-check,\n.marktile-palette-plain .tugtile-ed-rich .tg-tag');
ok(/color: var\(--text-normal\)/.test(plainBody), 'plain palette: headings and tokens wear the text colour');
ok(!/tg-link/.test(plainBody), 'plain palette leaves links alone — they keep the accent');
const [plainMk, plainMkBody] = rule('.marktile-palette-plain .tugtile-ed-rich .tg-mk');
ok(/var\(--text-faint\)/.test(plainMkBody), 'plain palette: markers recede');
const [font, fontBody] = rule('.marktile-ed.marktile-font-text .tugtile-ed-rich');
ok(/font-family: var\(--font-text\)/.test(fontBody), 'font text: the base moves to the body font');
const [mono] = rule('.marktile-ed .tugtile-ed-rich');
ok(mono >= 0 && font > mono, 'the body-font rule comes after (and outranks) the monospace base');
const [codeMono, codeMonoBody] = rule('.tugtile-ed-rich .tg-code');
ok(/font-family: var\(--font-monospace\)/.test(codeMonoBody), 'inline code names its own monospace, so the body font cannot reach it');
const [chip, chipBody] = rule('.tugtile-preview .tugtile-ed-rich .tg-code');
ok(/color: var\(--text-normal\)/.test(chipBody) && /background:/.test(chipBody), 'Rendered inline code is a text-coloured chip, not an accent run');
const [colorCode] = rule('.marktile-palette-color .tugtile-ed-rich .tg-code');
ok(colorCode >= 0 && chip > colorCode, 'the Rendered chip comes after the colour palette, so no palette can tint it back');
ok(plainH >= 0 && chip > plainH, 'the Rendered chip comes after the plain palette');
// The Plain-mode reset has to stay after every syntax rule (the specificity contract in styles.css).
const reset = css.indexOf('\n.marktile-ed.tugtile-plain .tugtile-ed-rich .tg-line *');
ok(reset >= 0, 'the Plain-mode reset exists');
ok(reset > Math.max(plainH, plainMk, chip, font), 'the Plain-mode reset still comes after every new rule');

// ── the Rendered icon ────────────────────────────────────────────────────────────────────────────────────────
const rendered = /\{ key: 'rendered', cls: 'tugtile-preview', icon: '([a-z-]+)'/.exec(core);
ok(rendered, 'EDITOR_MODES has a rendered entry');
eq(rendered && rendered[1], 'book-open', 'Rendered wears a reading icon, not a pen');

// ── the settings tab's strings, in every locale ──────────────────────────────────────────────────────────────
const KEYS = ['mtSeasonedPalette', 'mtSeasonedPaletteDesc', 'mtPaletteAccent', 'mtPaletteColor', 'mtPalettePlain',
  'mtSeasonedFont', 'mtSeasonedFontDesc', 'mtFontMono', 'mtFontText'];
const mt = fs.readFileSync(path.join(ROOT, 'hosts', 'obsidian', 'marktile', 'marktile.src.js'), 'utf8');
for (const k of KEYS) ok(mt.includes("t('" + k + "')"), 'the marktile settings tab uses ' + k);
for (const loc of ['en-US', 'zh-TW', 'ja-JP', 'ko-KR']) {
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', loc + '.json'), 'utf8'));
  for (const k of KEYS) ok(typeof tr[k] === 'string' && tr[k].length > 0, loc + ' has ' + k);
}

if (fail) { console.log(`seasoned-look: ${fail} failed`); process.exit(1); }
console.log('seasoned-look: ok');
