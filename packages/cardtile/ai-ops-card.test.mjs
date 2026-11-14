// The WHOLE-CARD half of ai-ops.mjs — CARD_SETTINGS, BACKS, GEOMETRY, EDITOR_PROTOCOL — held equal
// to the code that reads it, and GRAMMAR.md's examples held to what the parser reads back.
//
// Where the code can be run, it is run: applySetting, the host bridge, the parser and the renderer
// answer for themselves. Source text is scanned only where nothing is exported to call — the
// Worker's private frontmatter reader and the case list of applySetting's switch — and then with
// comments stripped first, because both files describe what they do in comments, and a scan that
// reads the explanation passes whatever the code says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SETTINGS, FRONTMATTER, BACKS, GEOMETRY, EDITOR_PROTOCOL, DISPOSITION, SCOPE, LANGUAGE_FILES } from './ai-ops.mjs';
import { LOCALES_KEY, PER_LANGUAGE_KEYS, WHOLE_CARD_KEYS, MAX_LOCALES } from './languages.mjs';
import { CLAIM_KEYS } from './claim.mjs';
import { applySetting, fmRead, VIEW_IDS } from './w3/card-settings.mjs';
import { DECK_KEYS, DECK_VIEWS } from './w3/deck-page.mjs';
import {
  createHostBridge, validHostOrigin, HOST_V, CHANGE_DEBOUNCE_MS, READY_EVERY_MS, READY_GIVE_UP_MS,
} from './w3/host-bridge.mjs';
import { parseCard, serializeCard, packGrid } from './card-core.js';
import { renderCardHTML } from './serve/card-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');

/** JS source with comments removed (strings and escapes respected, so `https://` survives) */
function code(src) {
  let out = '', q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    out += c;
  }
  return out;
}

const KEYS = Object.keys(CARD_SETTINGS);

// ── CARD_SETTINGS ────────────────────────────────────────────────────────────────────────────────

/** the keys serve/card-worker.mjs reads: `fm('k')`, `frontmatter(cardMd, 'k')`, and cardName's `title` */
function workerKeys() {
  const src = code(read('serve/card-worker.mjs'));
  const keys = new Set([
    ...[...src.matchAll(/\bfm\('([\w-]+)'\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bfrontmatter\(cardMd, '([\w-]+)'\)/g)].map((m) => m[1]),
  ]);
  if (/const cardName = [^\n]*\/\^title:/.test(src)) keys.add('title');
  return keys;
}
/** the names applySetting's switch accepts */
function settingNames() {
  const src = code(read('w3/card-settings.mjs'));
  const body = src.slice(src.indexOf('export function applySetting'));
  return new Set([...body.matchAll(/case '([\w-]+)':/g)].map((m) => m[1]));
}

test('CARD_SETTINGS lists exactly the frontmatter keys the renderer, the deck and the editor read', () => {
  const worker = workerKeys();
  assert.ok(worker.size >= 12, `found only ${worker.size} keys in card-worker — the scan is not reading it`);
  const used = new Set([...worker, ...DECK_KEYS, ...settingNames(), LOCALES_KEY]);
  assert.deepEqual(KEYS.filter((k) => !used.has(k)).sort(), [], 'CARD_SETTINGS declares keys no code reads');
  assert.deepEqual([...used].filter((k) => !KEYS.includes(k)).sort(), [], 'code reads frontmatter keys CARD_SETTINGS does not declare');
});

test('every name applySetting accepts is some key\'s `setting`, and nothing else is', () => {
  const names = settingNames();
  assert.ok(names.size >= 8, `found only ${names.size} cases in applySetting`);
  const declared = new Set(KEYS.map((k) => CARD_SETTINGS[k].setting).filter(Boolean));
  assert.deepEqual([...declared].sort(), [...names].sort());
  // …and running it agrees with the scan: every declared name is accepted, an unknown one is refused
  for (const n of declared) assert.doesNotThrow(() => applySetting('', n, n === 'views' ? { on: VIEW_IDS, open: 'stack' } : ''), n);
  assert.throws(() => applySetting('', 'no-such-setting', 'x'), /no setting called/);
});

test('each key has a disposition, a values description and a default; FORM keys are the editor\'s', () => {
  for (const [k, s] of Object.entries(CARD_SETTINGS)) {
    assert.ok([DISPOSITION.FORM, DISPOSITION.RAW].includes(s.disposition), `${k}: disposition`);
    assert.ok(Array.isArray(s.values) ? s.values.length : typeof s.values === 'string' && s.values, `${k}: values`);
    assert.ok(typeof s.default === 'string' && s.default, `${k}: default`);
  }
  // FORM without a `setting` must be written by the editor some other way: `view` by the views
  // setting, `back` by the default-back sheet. Anything else would be a FORM key with no form.
  const other = KEYS.filter((k) => CARD_SETTINGS[k].disposition === DISPOSITION.FORM && !CARD_SETTINGS[k].setting);
  assert.deepEqual(other.sort(), ['back', 'view']);
  assert.match(code(read('w3/edit3.mjs')), /fmWrite\(x\.pre, 'back', `"#\$\{id\}"`\)/, 'the editor no longer writes `back: "#id"`');
});

test('🔴 a default is written as no line at all, and a real value as `key: value`', () => {
  const pre = '---\ntitle: Old\naccent: #112233\ntheme: dark\nheader: left\nicons: mono\nbackdrop: asset:x\nbackdrop-dim: 25\nviews: list wall\nview: wall\n---\n';
  const defaults = { title: '', accent: '', theme: 'auto', header: 'centre', icons: 'colour', backdrop: '', 'backdrop-dim': '' };
  for (const [name, v] of Object.entries(defaults)) {
    const out = fmRead(applySetting(pre, name, v));
    assert.ok(!(name in out), `${name} at its default still writes a line`);
  }
  const all = fmRead(applySetting(pre, 'views', { on: VIEW_IDS, open: VIEW_IDS[0] }));
  assert.ok(!('views' in all) && !('view' in all), 'all views, opening on the first, still writes a line');
  assert.match(FRONTMATTER.defaultIsNoLine, /no line at all/);

  // closed value sets: each word is written back exactly, under the key's own name
  for (const k of ['theme', 'header', 'icons']) {
    for (const v of CARD_SETTINGS[k].values) assert.equal(fmRead(applySetting('', CARD_SETTINGS[k].setting, v))[k], v, `${k}: ${v}`);
  }
  assert.equal(fmRead(applySetting('', 'accent', '#A0B1C2')).accent, '#a0b1c2', 'the editor writes accent as lowercase #rrggbb');
});

test('the views are the same three words everywhere', () => {
  assert.deepEqual(CARD_SETTINGS.views.values, VIEW_IDS);
  assert.deepEqual(CARD_SETTINGS.view.values, VIEW_IDS);
  assert.deepEqual(DECK_VIEWS, VIEW_IDS);
  // and `view` is written by the views setting, only when it is not the first one on
  const out = fmRead(applySetting('', 'views', { on: ['list', 'wall'], open: 'wall' }));
  assert.equal(out.views, 'list wall');
  assert.equal(out.view, 'wall');
});

test('the renderer does what CARD_SETTINGS says for the closed RAW keys', () => {
  const card = (fm) => `---\ntitle: A\n${fm}\n---\n\n## grid\n\n- [ ] %% card: link w=6 %% [Shop](https://example.org/)\n`;
  const page = (fm) => renderCardHTML(card(fm), { deck: false });
  // the card's own class list — the class names also appear in the stylesheet, so match the attribute
  const cls = (fm) => /class="(st-card\b[^"]*)"/.exec(page(fm))?.[1].split(/\s+/) || [];
  assert.ok(cls('radius: square').includes('st-card-square'));
  assert.ok(cls('').length && !cls('').includes('st-card-square'), 'CONTROL: no class list found, or square by default');
  assert.match(page('lang: zh-TW'), /<html lang="zh-TW"/);
  assert.match(page('lang: not a tag'), /<html lang="en"/);
  assert.match(page(''), /name="generator" content="feelreef"/);
  assert.doesNotMatch(page('generator: off'), /name="generator"/);
  assert.match(page('since: 2019'), /&copy; 2019–/);
  for (const v of ['mono', 'grey', 'gray', 'monochrome']) assert.ok(cls(`icons: ${v}`).includes('st-card-marks-mono'), `icons: ${v}`);
  assert.ok(cls('header: left').includes('st-card-head-left'));
  assert.ok(!cls('').includes('st-card-head-left') && !cls('').includes('st-card-marks-mono'));
  assert.match(page('theme: dark'), /data-theme="dark"/);
});

// ── BACKS ────────────────────────────────────────────────────────────────────────────────────────

test('the BACKS example parses as it says, round-trips byte for byte, and renders its door', () => {
  const md = BACKS.example;
  const m = parseCard(md);
  assert.equal(serializeCard(m), md, 'the example is not in the form the serializer writes');
  assert.deepEqual(m.drawers.map((d) => [d.id, d.title]), [['about', 'About me']]);
  assert.equal(m.cells[0].params.back, '#about');
  // the card-wide default back: the editor's and the deck's reading of `back:`
  assert.equal(fmRead(m.pre).back, '"#about"');
  const deckId = String(fmRead(m.pre).back).replace(/^["']|["']$/g, '').replace(/^#/, '');
  assert.ok(m.drawers.some((d) => d.id === deckId));
  const html = renderCardHTML(md, { deck: false });
  assert.match(html, /class="st-back-door" href="#about" data-drawer="about"/, 'the profile has no door to its back');
});

test('`back=` is honoured on exactly the types BACKS names', () => {
  const md = (line) => `---\ntitle: A\n---\n\n## grid\n\n- [ ] %% card: ${line}\n\n\n## back: about\n\n- [ ] %% card: text %% Hi.\n`;
  // only the face counts: the back lane's own panel is rendered too, and says data-drawer of itself
  const opens = (line) => /data-drawer="about"/.test(renderCardHTML(md(line), { deck: false }).split('data-drawer-panel')[0]);
  assert.ok(opens('profile w=6 back=#about %% Hi.'));
  assert.ok(opens('text back=#about %% Some words.'));
  assert.ok(opens('link w=3 back=#about %% [Shop](https://example.org/)'));
  assert.ok(opens('feature img=https://example.org/a.png back=#about %%'));
  assert.ok(!opens('slides kind=slider images=https://example.org/a.png back=#about %%'));
  assert.ok(!opens('text %% Some words.'), 'CONTROL: a tile with no back= opens nothing');
  assert.match(BACKS.tileTypes, /`profile` and `text`.*`link` and `feature`.*`video`, `slides`, `social` and `embed` ignore/);
});

// ── GEOMETRY ─────────────────────────────────────────────────────────────────────────────────────

test('GEOMETRY: six columns, w clamped, no w is one column, text is full width, cols: is ignored', () => {
  const w = (params) => packGrid({ cells: [{ params }], cols: 6 }).placements[0].w;
  assert.equal(w({}), 1);
  assert.equal(w({ w: '9' }), 6);
  assert.equal(w({ w: '0' }), 1);
  assert.equal(parseCard('---\ncols: 3\n---\n\n## grid\n\n- [ ] %% card: text %% Hi.\n').cols, 6);
  const html = renderCardHTML('---\ntitle: A\n---\n\n## grid\n\n- [ ] %% card: text w=2 %% Hi.\n', { deck: false });
  assert.match(html, /data-w="6" data-coral-type="text"/, 'a text cell with w=2 is not full width');
  assert.match(GEOMETRY.height, /no height param/);
  assert.match(GEOMETRY.width, /no `w` is one column/);
});

// ── EDITOR_PROTOCOL ──────────────────────────────────────────────────────────────────────────────

const HOST = 'https://feelreef.com';
const CARD = '---\ntitle: A\n---\n\n## grid\n\n- [ ] %% card: text %% Hi.\n';

/** drive a real bridge through every path; record what it sends, and which incoming types it takes */
function exercise() {
  const sent = [], loads = [], timers = new Map(); let n = 0;
  const b = createHostBridge({
    host: HOST,
    post: (msg, origin) => sent.push({ msg, origin }),
    onLoad: (x) => loads.push(x),
    setTimer: (fn, ms) => { const id = ++n; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const tick = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  const handled = new Set();
  const from = (data, origin = HOST) => { const ok = b.receive({ origin, data: { v: HOST_V, ...data } }); if (ok) handled.add(data.type); return ok; };

  b.ready();                                                      // card:ready
  from({ type: 'card:get-draft' });                               // card:draft (md null)
  from({ type: 'card:propose', md: CARD });                       // card:propose-failed (not loaded)
  from({ type: 'card:load', md: 'not a card' });                  // card:load-failed
  from({ type: 'card:load', md: CARD, handle: 'a', cardUrl: 'https://x/a', locale: 'en', version: 3 });
  b.changed(CARD + '- [ ] %% card: text %% More.\n'); tick();      // card:change
  b.save();                                                       // card:save
  from({ type: 'card:saved', version: 4 });
  b.changed(CARD); b.save();
  from({ type: 'card:save-failed', message: 'no' });
  from({ type: 'card:get-draft' });
  from({ type: 'card:propose', md: CARD });
  const unknown = from({ type: 'card:nope' });
  const foreign = b.receive({ origin: 'https://evil.example', data: { v: HOST_V, type: 'card:get-draft' } });
  return { sent, loads, handled, unknown, foreign };
}

test('EDITOR_PROTOCOL: version, and the timings it states, are the bridge\'s', () => {
  assert.equal(EDITOR_PROTOCOL.v, HOST_V);
  const when = Object.values(EDITOR_PROTOCOL.toParent).map((x) => x.when).join(' ');
  assert.ok(when.includes(`${CHANGE_DEBOUNCE_MS} ms`), 'debounce');
  assert.ok(when.includes(`${READY_EVERY_MS} ms`), 'ready interval');
  assert.ok(when.includes(`${READY_GIVE_UP_MS / 1000} s`), 'ready give-up');
});

test('🔴 EDITOR_PROTOCOL: every message type and its fields, in each direction, are what the bridge does', () => {
  const { sent, loads, handled, unknown, foreign } = exercise();
  // editor → parent: run, not read
  const out = {};
  for (const { msg, origin } of sent) {
    assert.equal(origin, HOST, `${msg.type} was posted to ${origin}, not the host`);
    assert.equal(msg.v, HOST_V);
    const { v, type, ...fields } = msg;
    (out[type] ||= new Set()); for (const f of Object.keys(fields)) out[type].add(f);
  }
  assert.deepEqual(Object.keys(out).sort(), Object.keys(EDITOR_PROTOCOL.toParent).sort(), 'editor → parent types');
  for (const [t, def] of Object.entries(EDITOR_PROTOCOL.toParent)) assert.deepEqual([...out[t]].sort(), [...def.fields].sort(), `${t} fields`);
  // parent → editor: the types receive() takes, and nothing else
  assert.deepEqual([...handled].sort(), Object.keys(EDITOR_PROTOCOL.toEditor).sort(), 'parent → editor types');
  assert.equal(unknown, false, 'an unknown type was taken');
  assert.equal(foreign, false, 'a message from another origin was taken');
  assert.deepEqual(Object.keys(loads[0]).sort(), EDITOR_PROTOCOL.toEditor['card:load'].fields.map((f) => f.replace('?', '')).sort());
});

test('EDITOR_PROTOCOL: no type in the bridge\'s code that the definition lacks, and none the other way', () => {
  const src = code(read('w3/host-bridge.mjs'));
  assert.ok(!src.includes('iframe → parent'), 'comments were not stripped — this would read the header, not the code');
  const inCode = new Set([...src.matchAll(/'(card:[a-z-]+)'/g)].map((m) => m[1]));
  const declared = new Set([...Object.keys(EDITOR_PROTOCOL.toParent), ...Object.keys(EDITOR_PROTOCOL.toEditor)]);
  assert.deepEqual([...inCode].sort(), [...declared].sort());
});

test('EDITOR_PROTOCOL: the origins it names are the ones validHostOrigin allows', () => {
  for (const o of ['https://feelreef.com', 'https://staging.feelreef.com', 'http://localhost:8788', 'http://localhost']) {
    assert.equal(validHostOrigin(o), o, o);
    assert.ok(EDITOR_PROTOCOL.origins.allowed.includes(o.replace(/:\d+$/, '')), o);
  }
  for (const bad of ['https://feelreef.com/edit', 'https://evil.example', 'http://feelreef.com', '*']) assert.equal(validHostOrigin(bad), null, bad);
});

// ── GRAMMAR.md ───────────────────────────────────────────────────────────────────────────────────

const GRAMMAR = read('GRAMMAR.md');
const wholeCards = () => [...GRAMMAR.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.startsWith('---\n'));

test('GRAMMAR.md: every whole-card example round-trips, and uses only keys CARD_SETTINGS declares', () => {
  const cards = wholeCards();
  assert.ok(cards.length >= 3, `found only ${cards.length} whole-card examples in GRAMMAR.md`);
  for (const md of cards) {
    assert.equal(serializeCard(parseCard(md)), md, `not in the serializer's form:\n${md}`);
    for (const k of Object.keys(fmRead(md))) assert.ok(KEYS.includes(k), `GRAMMAR.md example uses undeclared key ${k}`);
  }
});

test('GRAMMAR.md: the settings table names every key in CARD_SETTINGS, and every message type', () => {
  for (const k of KEYS) assert.ok(GRAMMAR.includes('`' + k + '`'), `GRAMMAR.md does not mention \`${k}\``);
  for (const t of [...Object.keys(EDITOR_PROTOCOL.toParent), ...Object.keys(EDITOR_PROTOCOL.toEditor)]) {
    assert.ok(GRAMMAR.includes('`' + t + '`'), `GRAMMAR.md does not mention \`${t}\``);
  }
});

// ── tile#304: which file decides each key ────────────────────────────────────────────────────────

/** the refusal codes a source file can emit: string literals `cards_language_…` / `cards_locales_…` */
const codesIn = (rel) => new Set([...code(read(rel)).matchAll(/'(cards_(?:language|locales)_[a-z_]+)'/g)].map((m) => m[1]));

test('every key’s `scope` is the one languages.mjs enforces, and the two lists cover every key read', () => {
  for (const [k, s] of Object.entries(CARD_SETTINGS)) {
    assert.equal(s.scope, PER_LANGUAGE_KEYS.includes(k) ? SCOPE.LANGUAGE : SCOPE.CARD, `${k}: scope`);
  }
  // the code's classification is exactly CARD_SETTINGS plus the claim — nothing read is unclassified,
  // and nothing classified is unread
  assert.deepEqual([...PER_LANGUAGE_KEYS, ...WHOLE_CARD_KEYS].sort(), [...KEYS, ...CLAIM_KEYS].sort());
  assert.match(CARD_SETTINGS.locales.values, new RegExp(`at most ${MAX_LOCALES}\\b`));
  assert.match(LANGUAGE_FILES.limits, new RegExp(`At most ${MAX_LOCALES} tags`));
});

test('LANGUAGE_FILES names exactly the refusal codes the code emits', () => {
  const emitted = new Set([...codesIn('languages.mjs'), ...codesIn('serve/card-api.mjs')]);
  assert.ok(emitted.size >= 8, `found only ${emitted.size} codes: the scan is not reading the code`);
  assert.deepEqual(Object.keys(LANGUAGE_FILES.refusals).sort(), [...emitted].sort());
  for (const c of emitted) assert.ok(GRAMMAR.includes('`' + c + '`'), `GRAMMAR.md does not mention \`${c}\``);
});

// 🔴 THE CONTROL: set comparisons over a scan that found nothing pass beautifully.
test('CONTROL: the comparisons above fire on a fabricated drift', () => {
  // the code scan sees a code, and not the same code inside a comment
  assert.deepEqual([...new Set([...code("x = 'cards_language_fake' // 'cards_language_hidden'").matchAll(/'(cards_(?:language|locales)_[a-z_]+)'/g)].map((m) => m[1]))], ['cards_language_fake']);
  const used = new Set([...workerKeys(), ...DECK_KEYS, ...settingNames(), LOCALES_KEY]);
  const short = KEYS.filter((k) => k !== 'radius');
  assert.deepEqual([...used].filter((k) => !short.includes(k)), ['radius']);
  assert.ok(code("a // 'card:fake'\nb").indexOf('card:fake') < 0, 'the comment stripper keeps line comments');
  assert.ok(code("x = 'https://a' // c").includes('https://a'), 'the comment stripper eats URLs in strings');
  assert.ok(code('r = /^https?:\\/\\//; y // z').includes('y'), 'the comment stripper eats code after a regex');
});
