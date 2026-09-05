// sandbox-i18n — pure derivation + a round-trip through card-core. run: node --test sandbox-i18n.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCard } from '../card-core.js';
import { sandboxDoorFields } from './sandbox-door.mjs';
import {
  CHROME_STRINGS, chromeStrings, LOCALE_KEYS, SANDBOX_LOCALES, buildSandboxCard,
  localeFromAcceptLanguage, primaryLocale,
} from './sandbox-i18n.mjs';

// The nine console locales the owner ruled on 2026-09-05 — this list IS the contract; every test
// below that says "for every locale" walks this, not `Object.keys(SANDBOX_LOCALES)`, so a locale
// silently dropped from the table fails here instead of just shrinking the loop.
const NINE = ['en', 'zh', 'ja', 'zh-Hans', 'ko', 'de', 'fr', 'es', 'pt'];

test('LOCALE_KEYS: exactly the nine console locales, nothing missing, nothing extra', () => {
  assert.deepEqual([...LOCALE_KEYS].sort(), [...NINE].sort());
});

test('SANDBOX_LOCALES: every one of the nine has a complete persona (no missing field, nothing blank)', () => {
  const FIELDS = ['lang', 'name', 'bio', 'linkLabel', 'textBody', 'imageAlt', 'bannerStatus', 'bannerText',
    // the door: its button, the sentence before it, and the two ways out of that sentence. A locale
    // missing any of these is a locale where the door opens onto silence — see bootSandbox().
    'doorCta', 'doorNote', 'doorContinue', 'doorBack',
    'reset', 'pageTitle'];
  for (const key of NINE) {
    const p = SANDBOX_LOCALES[key];
    assert.ok(p, `${key}: missing from SANDBOX_LOCALES entirely`);
    for (const f of FIELDS) {
      assert.equal(typeof p[f], 'string', `${key}.${f}: expected a string`);
      assert.ok(p[f].trim().length > 0, `${key}.${f}: blank`);
    }
  }
});

test('SANDBOX_LOCALES: every persona is its own translation, not a copy-pasted duplicate of another locale\'s', () => {
  // Names CAN legitimately repeat (zh and zh-Hans both use 小美 — those two characters have no
  // Traditional/Simplified variant, same as "Sam" not changing between en-US/en-GB) — what must
  // never repeat is the CONTENT: two locales sharing a `bio`/`bannerText` would mean one was never
  // actually translated, just copied under a new key.
  for (const field of ['bio', 'bannerText', 'doorCta', 'doorNote']) {
    const values = NINE.map((k) => SANDBOX_LOCALES[k][field]);
    assert.equal(new Set(values).size, values.length, `${field}: expected 9 distinct translations, found a duplicate`);
  }
});

test('SANDBOX_LOCALES: zh (Traditional) and zh-Hans (Simplified) are genuinely different tables, not aliases', () => {
  const zh = SANDBOX_LOCALES.zh;
  const hans = SANDBOX_LOCALES['zh-Hans'];
  assert.notEqual(zh.lang, hans.lang);
  assert.equal(zh.lang, 'zh-TW');
  assert.equal(hans.lang, 'zh-CN');
  // Traditional-only characters that must NOT appear in the Simplified copy, and vice versa.
  assert.match(zh.bannerText, /儲存/); // Traditional 儲
  assert.doesNotMatch(hans.bannerText, /儲存/);
  assert.match(hans.bannerText, /保存/); // Simplified equivalent
});

test('CHROME_STRINGS: every one of the nine has every chrome key, no missing key, nothing blank', () => {
  const KEYS = Object.keys(CHROME_STRINGS.en);
  assert.ok(KEYS.length > 15, 'sanity: the English table should carry the full chrome key set');
  for (const key of NINE) {
    const c = CHROME_STRINGS[key];
    assert.ok(c, `${key}: missing from CHROME_STRINGS entirely`);
    for (const k of KEYS) {
      assert.equal(typeof c[k], 'string', `${key}.${k}: expected a string`);
      assert.ok(c[k].trim().length > 0, `${key}.${k}: blank`);
    }
    // no locale's chrome table carries a key none of the others do (a typo'd key would sit there
    // silently, always falling through to nothing on read since editor.mjs only ever reads the
    // canonical names)
    assert.deepEqual(Object.keys(c).sort(), KEYS.sort(), `${key}: chrome key set doesn't match en's`);
  }
});

test('chromeStrings: returns the matching table, and falls back to English for an unknown key', () => {
  assert.equal(chromeStrings('ja'), CHROME_STRINGS.ja);
  assert.equal(chromeStrings('fr-FR'), CHROME_STRINGS.en); // not a locale KEY (that's the full tag) — falls back
  assert.equal(chromeStrings(''), CHROME_STRINGS.en);
});

test('primaryLocale: recognises all nine locale keys, by their own key or a realistic full tag', () => {
  const cases = [
    ['en', 'en'], ['en-US', 'en'],
    ['zh-TW', 'zh'], ['zh-Hant', 'zh'], ['zh-HK', 'zh'], ['zh', 'zh'],
    ['zh-CN', 'zh-Hans'], ['zh-Hans', 'zh-Hans'], ['zh-SG', 'zh-Hans'],
    ['ja-JP', 'ja'], ['ja', 'ja'],
    ['ko-KR', 'ko'], ['ko', 'ko'],
    ['de-DE', 'de'], ['de', 'de'],
    ['fr-FR', 'fr'], ['fr', 'fr'],
    ['es-ES', 'es'], ['es-MX', 'es'],
    ['pt-BR', 'pt'], ['pt-PT', 'pt'],
  ];
  for (const [tag, want] of cases) assert.equal(primaryLocale(tag), want, `primaryLocale(${tag})`);
});

test('primaryLocale: anything unrecognised (or empty) falls back to en', () => {
  assert.equal(primaryLocale('it-IT'), 'en');
  assert.equal(primaryLocale('ru-RU'), 'en');
  assert.equal(primaryLocale(''), 'en');
  assert.equal(primaryLocale(undefined), 'en');
});

test('localeFromAcceptLanguage: first recognised tag in header order wins, checked as a FULL tag', () => {
  assert.equal(localeFromAcceptLanguage('it-IT,ja;q=0.9,en-US;q=0.8'), 'ja');
  assert.equal(localeFromAcceptLanguage('zh-TW,zh;q=0.9'), 'zh');
  assert.equal(localeFromAcceptLanguage('zh-CN,zh;q=0.9'), 'zh-Hans'); // the FIRST tag, not the bare fallback later in the same header
  assert.equal(localeFromAcceptLanguage('de-DE,fr-FR;q=0.9'), 'de');
  assert.equal(localeFromAcceptLanguage('pt-BR,es-ES;q=0.9'), 'pt');
});

test('localeFromAcceptLanguage: no header, or nothing recognised, → en', () => {
  assert.equal(localeFromAcceptLanguage(''), 'en');
  assert.equal(localeFromAcceptLanguage(undefined), 'en');
  assert.equal(localeFromAcceptLanguage('it-IT,ru-RU'), 'en');
});

test('buildSandboxCard: parses cleanly for all nine locales, three cells, a profile lane', () => {
  for (const key of NINE) {
    const md = buildSandboxCard(key);
    const model = parseCard(md);
    assert.equal(model.cells.length, 3, `${key}: expected 3 cells`);
    assert.equal(model.cells[0].type, 'profile');
    assert.equal(model.cells[1].type, 'link');
    assert.equal(model.cells[2].type, 'text');
  }
});

test('buildSandboxCard: the persona name in frontmatter matches the locale table, never a real person', () => {
  for (const key of NINE) {
    const persona = SANDBOX_LOCALES[key];
    const md = buildSandboxCard(key);
    assert.match(md, new RegExp(`^title: ${persona.name}$`, 'm'));
  }
});

test('buildSandboxCard: an unrecognised locale key falls back to the en persona (Sam)', () => {
  const md = buildSandboxCard('it-IT');
  assert.match(md, /^title: Sam$/m);
});

test('buildSandboxCard × sandboxDoorFields: round-trips name + tagline for every locale', () => {
  for (const key of NINE) {
    const persona = SANDBOX_LOCALES[key];
    const { name, tagline } = sandboxDoorFields(buildSandboxCard(key));
    assert.equal(name, persona.name);
    assert.equal(tagline, persona.bio);
  }
});

// ── the internal codename never reaches a visitor (Top-10 #5, §3.2) ─────────────────────────────

test('🔴 no string in either table says "cardtile" — that is our word, not theirs', () => {
  // 🔴 THE TABLES, NOT THE SOURCE FILE. sandbox-i18n.mjs's own header comment explains what
  // cardtile-w is, and a `grep` over the file would fail on the explanation while the strings were
  // perfectly clean — or, worse, pass once someone deleted the comment. What ships to a browser is
  // the VALUES, so the values are what is scanned.
  let scanned = 0;
  for (const key of NINE) {
    for (const [field, value] of Object.entries(SANDBOX_LOCALES[key])) {
      scanned++;
      assert.doesNotMatch(value, /cardtile/i, `SANDBOX_LOCALES.${key}.${field} carries the internal name`);
    }
    for (const [field, value] of Object.entries(CHROME_STRINGS[key])) {
      scanned++;
      assert.doesNotMatch(value, /cardtile/i, `CHROME_STRINGS.${key}.${field} carries the internal name`);
    }
  }
  assert.ok(scanned >= 350, `only ${scanned} strings scanned — this is measuring nothing`);
  // CONTROL: the pattern DOES fire on what pageTitle used to be
  assert.match('cardtile-w — 沙盒', /cardtile/i);
});

test('every page title names the PRODUCT and the platform, in that locale', () => {
  for (const key of NINE) {
    const title = SANDBOX_LOCALES[key].pageTitle;
    assert.match(title, /Card/, `${key}: the title does not say what this is`);
    assert.match(title, / · feelreef$/, `${key}: the title does not end with the platform`);
  }
  // …and the nine are not one string repeated: the verb in front of "Card" is translated
  const leads = NINE.map((k) => SANDBOX_LOCALES[k].pageTitle.replace(/ · feelreef$/, ''));
  assert.ok(new Set(leads).size >= 7, `only ${new Set(leads).size} distinct titles across nine locales`);
});

// ── one word for the thing you touch (Top-10 #9; owner ruling CARD-VOCAB-ADDENDUM 2026-09-06) ────
//
// 🔴 THE ADDENDUM OVERRIDES THE REVIEW. REVIEW-card-try's §2 proposed 「區塊」/block; the owner ruled
// on the same day that the unit a person touches is 「牌」 — a TILE, on lanes — and that the ruling
// wins over any vocabulary the review recommends. So the ban list below forbids the word the review
// itself argued for, which is the whole reason it is written down rather than remembered.

const UNIT = {
  en: { want: /\btile\b/i, banned: [/\bblocks?\b/i] },
  zh: { want: /牌/, banned: [/區塊/, /一格/, /這格/, /格子/] },
  ja: { want: /タイル/, banned: [/ブロック/] },
  ko: { want: /타일/, banned: [/블록/] },
  'zh-Hans': { want: /牌/, banned: [/区块/, /一格/, /这格/, /格子/] },
  de: { want: /Kachel/, banned: [/\bBlock\b/, /\bBlöcke/, /Blocktyp/] },
  fr: { want: /tuile/i, banned: [/\bblocs?\b/i] },
  es: { want: /ficha/i, banned: [/\bbloques?\b/i] },
  pt: { want: /peça/i, banned: [/\bblocos?\b/i] },
};

test('🔴 「加一張牌」 — the palette header names the unit, in every language', () => {
  for (const key of NINE) {
    assert.match(CHROME_STRINGS[key].addCellHeader, UNIT[key].want,
      `${key}: the palette header does not name the unit`);
  }
  // the three the owner wrote out by hand, verbatim
  assert.equal(CHROME_STRINGS.zh.addCellHeader, '加一張牌');
  assert.equal(CHROME_STRINGS.ja.addCellHeader, 'タイルを追加');
  assert.equal(CHROME_STRINGS.en.addCellHeader, 'Add a tile');
});

test('🔴 no visitor-facing string still calls it a block — or a 格', () => {
  let scanned = 0;
  for (const key of NINE) {
    const { banned } = UNIT[key];
    const strings = [...Object.entries(CHROME_STRINGS[key]), ...Object.entries(SANDBOX_LOCALES[key])];
    for (const [field, value] of strings) {
      scanned++;
      for (const re of banned) {
        assert.doesNotMatch(value, re, `${key}.${field} still says ${re}: ${JSON.stringify(value)}`);
      }
    }
  }
  assert.ok(scanned >= 400, `only ${scanned} strings scanned — this is measuring nothing`);
  // CONTROL: the list fires on what these strings said yesterday
  for (const [key, was] of [['zh', '加一格'], ['ja', 'ブロックを追加'], ['en', 'Add a block'],
    ['de', 'Block hinzufügen'], ['es', 'Añadir un bloque']]) {
    assert.ok(UNIT[key].banned.some((re) => re.test(was)), `the ${key} ban list cannot see ${JSON.stringify(was)}`);
  }
});

test('🔴 the unit word reaches the four places a person meets it, not just the header', () => {
  for (const key of NINE) {
    for (const field of ['addCellHeader', 'modalDelete', 'deleteConfirm', 'unknownCellHint']) {
      assert.match(CHROME_STRINGS[key][field], UNIT[key].want, `${key}.${field}: the unit is unnamed`);
    }
    // …and on the card itself, in the persona's own first sentence
    assert.match(SANDBOX_LOCALES[key].textBody, UNIT[key].want, `${key}: the persona still says the old word`);
  }
});

test('🔴 zh-TW and zh-Hans did not get each other\'s characters', () => {
  // 🩸 This caught a real slip while it was being written: the Simplified block was handed
  // 「添加一張牌」 and 「刪除這張牌」 — Traditional forms — by a bulk substitution table, and the
  // existing Traditional/Simplified test only looked at `bannerText`.
  const TRAD_ONLY = /[張刪這無來個為區塊儲]/;
  const SIMP_ONLY = /[张删这无来个为区块储]/;
  for (const [field, value] of Object.entries(CHROME_STRINGS['zh-Hans'])) {
    assert.doesNotMatch(value, TRAD_ONLY, `zh-Hans.${field} contains Traditional characters: ${JSON.stringify(value)}`);
  }
  for (const [field, value] of Object.entries(CHROME_STRINGS.zh)) {
    assert.doesNotMatch(value, SIMP_ONLY, `zh.${field} contains Simplified characters: ${JSON.stringify(value)}`);
  }
  // CONTROL: both patterns can see their own side
  assert.match('添加一張牌', TRAD_ONLY);
  assert.match('添加一张牌', SIMP_ONLY);
});

test('🔴 zh full-width punctuation: no half-width comma or colon between Chinese characters', () => {
  const HALF_BETWEEN_CJK = /[一-鿿][,:;?!][^\s]/;
  // 「——」 as a mid-sentence separator is not the Traditional convention either (review §A P3)
  for (const key of ['zh', 'zh-Hans']) {
    for (const [field, value] of [...Object.entries(CHROME_STRINGS[key]), ...Object.entries(SANDBOX_LOCALES[key])]) {
      if (field === 'lang') continue;
      assert.doesNotMatch(value, HALF_BETWEEN_CJK, `${key}.${field}: half-width punctuation — ${JSON.stringify(value)}`);
      assert.doesNotMatch(value, /——/, `${key}.${field}: an em-dash pair used as a separator — ${JSON.stringify(value)}`);
    }
  }
  // CONTROL: both patterns fire on what these strings used to be
  assert.match('這是練習模式（沙盒） —— 你做的變更', /——/);
  assert.match('一張圖,可以只是圖', HALF_BETWEEN_CJK);
});

// ── nothing Chinese ships that bootSandbox() cannot replace ──────────────────────────────────────
//
// 🩸 THE TABLE WAS COMPLETE AND THE PAGE WAS NOT. Every test above walks the TABLES, so all nine
// locales were green while `/try/edit` served an en-US visitor a save sheet reading 「取消」 and
// 「存」 — because those two literals lived in `w/index.html`, had no key, and therefore no test had
// any reason to look at them. A table that is 100% translated says nothing about the strings that
// never entered it.
//
// So this gate walks the OTHER direction: from the markup that actually ships, back to the table.
// The subject is the exact body slice `gen-editor-assets.mjs` cuts out and the Worker inlines — not
// the whole file, because `<title>` and the `<script type="module">` tail are replaced by the
// sandbox composition (card-worker.mjs) and never reach a visitor as written.
//
// The real editor keeps its Traditional Chinese by decision (see editor.mjs's `T`), so the rule is
// NOT "no Chinese in index.html". It is: every Chinese string in the shipped markup must be a
// verbatim CHROME_STRINGS.zh value AND sit on an element bootSandbox() writes to. Both halves are
// needed — a key nobody assigns is as invisible to a visitor as no key at all.

const HERE = dirname(fileURLToPath(import.meta.url));
const CJK = /[　-〿぀-ヿ一-鿿＀-￯]/;

/** the bytes the Worker inlines — the same slice gen-editor-assets.mjs takes, comments removed */
function shippedBody(html) {
  const start = html.indexOf('<body>');
  const end = html.indexOf('<script type="module">');
  assert.ok(start >= 0 && end > start, 'w/index.html shape changed — <body> or the module <script> not found');
  return html.slice(start + '<body>'.length, end).replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Every Chinese string in `body`, with the id of the element carrying it. Text nodes and attribute
 * values both — 「選單」 was only ever an `aria-label`, and an aria-label a screen reader announces in
 * the wrong language is the same defect as a button.
 */
function chineseInMarkup(body) {
  const found = [];
  for (const re of [/>([^<]+)</g, /="([^"]*)"/g]) {
    let m;
    while ((m = re.exec(body))) {
      const value = m[1].trim();
      if (!value || !CJK.test(value)) continue;
      // the element carrying it: the nearest tag opening before this point
      const lt = body.lastIndexOf('<', m.index);
      const tag = body.slice(lt, body.indexOf('>', lt) + 1);
      found.push({ value, id: (tag.match(/\bid="([^"]+)"/) || [])[1] || null });
    }
  }
  return found;
}

/** bootSandbox()'s source, comments stripped — a comment naming an id must not count as wiring it */
function bootSandboxSource() {
  const src = readFileSync(join(HERE, 'editor.mjs'), 'utf8');
  const start = src.indexOf('function bootSandbox(opts) {');
  assert.ok(start > 0, 'bootSandbox() not found in editor.mjs — this gate is reading nothing');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, 'bootSandbox() has no end');
  return src.slice(start, end)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

test('🔴 every Chinese string the sandbox SHIPS is a CHROME_STRINGS.zh value, byte for byte', () => {
  const found = chineseInMarkup(shippedBody(readFileSync(join(HERE, 'index.html'), 'utf8')));
  const known = new Set(Object.values(CHROME_STRINGS.zh));
  const stray = found.filter((f) => !known.has(f.value));
  assert.deepEqual(stray, [], `markup Chinese with no key in CHROME_STRINGS.zh:\n${
    stray.map((s) => `    ${s.id || '(no id)'}: ${JSON.stringify(s.value)}`).join('\n')}`);
  // CONTROL: the scan is reading a real document, not an empty string
  assert.ok(found.length >= 20, `only ${found.length} Chinese strings found in the markup — this is measuring nothing`);
  assert.ok(found.some((f) => f.id === 'pub-go' && f.value === '存'), 'the save button was not even seen');
  assert.ok(found.some((f) => f.id === 'actions-menu-btn'), 'attribute values are not being scanned');
});

test('🔴 CONTROL: the gate above sees a newly hard-coded literal, and sees it in an attribute too', () => {
  // the two shapes the defect really took, reconstructed by hand rather than recovered from git —
  // a commit is one fix away from no longer containing them
  const injected = chineseInMarkup(
    '<body><button class="ctw-btn" id="pub-cancel">取消一下</button>'
    + '<iframe id="canvas" title="全新的字"></iframe></body>');
  const known = new Set(Object.values(CHROME_STRINGS.zh));
  const stray = injected.filter((f) => !known.has(f.value));
  assert.deepEqual(stray.map((s) => [s.id, s.value]).sort(),
    [['canvas', '全新的字'], ['pub-cancel', '取消一下']]);
});

test('🔴 …and bootSandbox() actually writes to the element carrying it', () => {
  const boot = bootSandboxSource();
  const found = chineseInMarkup(shippedBody(readFileSync(join(HERE, 'index.html'), 'utf8')));
  let checked = 0;
  for (const { value, id } of found) {
    assert.ok(id, `a Chinese string sits on an element with no id, so nothing can replace it: ${JSON.stringify(value)}`);
    assert.ok(boot.includes(`el('${id}')`), `#${id} still reads ${JSON.stringify(value)} — bootSandbox() never touches it`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} elements checked`);
  // CONTROL: the check fires on an id bootSandbox has never heard of, and the comment-stripping
  // means an id that appears ONLY in a comment does not count as wired
  assert.ok(!boot.includes("el('pub-what')"), 'pick a different unwired id for this control');
  assert.ok(!/🩸|🔴/.test(boot), 'comments survived the strip — a comment naming an id would pass this gate');
});
