// The tile definitions, in nine languages — the gate the review asked for by name (§3.1.2):
// 「缺一個 key 就不准出貨」.
//
//   node --test packages/cardtile/w/sandbox-cells.test.mjs
//
// 🔴 WHAT WENT WRONG WITHOUT IT. Every one of these strings was a Traditional Chinese literal in
// ai-ops.mjs, printed straight into the palette and every form. The CHROME around them had a
// nine-locale table and a test; the product inside them had neither, so ja/en/de/… visitors read a
// translated button and then seven Chinese words under it. A table without a completeness gate is
// a table that will be incomplete by Thursday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_STRINGS_BY_KEY, CELL_KEYS, cellStrings, CELL_STRINGS_ZH, text } from './cell-i18n.mjs';
import { LOCALE_KEYS } from './sandbox-i18n.mjs';
import { CELL_TYPES, UNIVERSAL, BLANKS, blankCell, DISPOSITION } from '../ai-ops.mjs';

// The nine console locales, written out rather than derived — same contract as sandbox-i18n.test.mjs
const NINE = ['en', 'zh', 'ja', 'zh-Hans', 'ko', 'de', 'fr', 'es', 'pt'];

test('the locale set here IS the sandbox\'s locale set — one list, not two that agree today', () => {
  assert.deepEqual([...LOCALE_KEYS].sort(), [...NINE].sort());
});

test('🔴 every key carries every one of the nine locales — this is the ship gate', () => {
  assert.ok(CELL_KEYS.length >= 45, `only ${CELL_KEYS.length} keys — the table is not being read`);
  const missing = [];
  for (const key of CELL_KEYS) {
    const row = CELL_STRINGS_BY_KEY[key];
    for (const loc of NINE) {
      if (typeof row[loc] !== 'string') missing.push(`${key}/${loc}`);
    }
    // no locale has a key none of the others do — a typo'd locale code would sit there silently,
    // always falling through on read, and nothing would ever say so
    assert.deepEqual(Object.keys(row).sort(), [...NINE].sort(), `${key}: locale set does not match`);
  }
  assert.deepEqual(missing, [], 'keys with no translation in some locale');
});

test('a key that is not blank in English is not blank anywhere', () => {
  // (`type.video.channel.hint` is deliberately empty in all nine — the label says everything.)
  for (const key of CELL_KEYS) {
    const row = CELL_STRINGS_BY_KEY[key];
    const enBlank = row.en.trim() === '';
    for (const loc of NINE) {
      assert.equal(row[loc].trim() === '', enBlank, `${key}/${loc}: blank in one language and not another`);
    }
  }
});

test('🔴 the three languages the review checked are genuinely three translations, not one copied', () => {
  // CJK share characters, so this cannot be "all nine differ" — but zh/ja/en of a SENTENCE must.
  const SENTENCES = ['type.link.hint', 'type.feature.hint', 'type.text.hint', 'type.profile.hint'];
  for (const key of SENTENCES) {
    const row = CELL_STRINGS_BY_KEY[key];
    for (const [a, b] of [['zh', 'ja'], ['zh', 'en'], ['ja', 'en'], ['zh', 'zh-Hans'], ['de', 'fr']]) {
      assert.notEqual(row[a], row[b], `${key}: ${a} and ${b} are the same string`);
    }
  }
});

test('🔴 no string anywhere in the table talks to an engineer', () => {
  // The review's own §3.1.4 forbidden list — applied to ALL NINE, not to whichever one was on screen.
  const BANNED = [
    [/`/, 'a backtick'],
    [/\bw=\d/, 'a raw parameter'],
    [/frontmatter/i, 'frontmatter'],
    [/favicon/i, 'favicon'],
    [/sha256/i, 'sha256'],
    // 🩸 WAS `/\bpx\b/`, and the CONTROL below is what caught it: there is no word boundary between
    // `0` and `p`, so the one real offender in the old table — 「一排 40px 的圖示」 — sailed straight
    // through the ruler written to catch it. A ban list that cannot see the string it was written
    // for is worse than none, because it signs off on it.
    [/px\b/i, 'a pixel count'],
    [/\bCTA\b/, 'CTA'],
    [/\bmarkdown\b/i, 'markdown'],
    [/\bGoogle\b/, 'Google'],
    [/\bcardtile\b/i, 'the internal name'],
  ];
  let scanned = 0;
  for (const key of CELL_KEYS) {
    for (const loc of NINE) {
      const s = CELL_STRINGS_BY_KEY[key][loc];
      scanned++;
      for (const [re, what] of BANNED) {
        assert.doesNotMatch(s, re, `${key}/${loc} shows a person ${what}: ${JSON.stringify(s)}`);
      }
    }
  }
  assert.ok(scanned >= 400, `only ${scanned} strings scanned — the ban list is measuring nothing`);
});

test('CONTROL: the ban list fires on the strings this table REPLACED', () => {
  // verbatim, from ai-ops.mjs before 2026-09-06
  const OLD = [
    '整列寬(w=6)時會和相鄰的連結列併成同一塊。',
    '卡片的頭部:大頭貼、名字、一句話。名字來自 frontmatter 的 title。',
    '留空則自動抓該網域的 favicon。',
    '一排 40px 的圖示,沒有文字。連到自己網域的那個會拿到手繪的房子圖示。',
    '`[顯示文字](網址)`。網址寫 `#抽屜id` 會改成打開抽屜。',
    '卡片內的圖片(sha256-…)或網址。',
    '點了才載入 YouTube — 在那之前訪客的瀏覽器不會跟 Google 說話。',
  ];
  const BANNED = [/`/, /\bw=\d/, /frontmatter/i, /favicon/i, /sha256/i, /px\b/i, /\bGoogle\b/];
  for (const s of OLD) {
    assert.ok(BANNED.some((re) => re.test(s)), `the ban list cannot see anything wrong with ${JSON.stringify(s)}`);
  }
});

test('🔴 zh-TW uses full-width punctuation, never half-width in running text', () => {
  // 「,」 and 「:」 between CJK characters were all over the old hints (「一張圖,可以只是圖」).
  const HALF_WIDTH_BETWEEN_CJK = /[一-鿿][,:;?!][^\s]/;
  for (const key of CELL_KEYS) {
    for (const loc of ['zh', 'zh-Hans']) {
      assert.doesNotMatch(CELL_STRINGS_BY_KEY[key][loc], HALF_WIDTH_BETWEEN_CJK,
        `${key}/${loc}: half-width punctuation between Chinese characters`);
    }
  }
  // CONTROL: the pattern DOES fire on the old text
  assert.match('一張圖,可以只是圖,也可以壓上標題', HALF_WIDTH_BETWEEN_CJK);
});

// ── the definitions and the table have to agree ──────────────────────────────────────────────────

test('🔴 every string a person can be shown resolves to a real key — no key ever reaches a screen', () => {
  const zh = CELL_STRINGS_ZH;
  const shown = [];
  const push = (v) => { if (v) shown.push(v); };
  for (const def of Object.values(CELL_TYPES)) {
    push(def.title); push(def.hint);
    if (def.body) { push(def.body.label); push(def.body.hint); }
    for (const [, p] of Object.entries(def.params)) {
      if (p.disposition !== DISPOSITION.FORM) continue;   // RAW params are never rendered to a person
      push(p.label); push(p.hint);
      for (const v of Object.values(p.optionLabels || {})) push(v);
    }
    for (const row of (def.form || []).flatMap((r) => (r.group ? [{ label: r.group }, ...r.rows] : [r]))) {
      push(row.label); push(row.hint);
    }
  }
  assert.ok(shown.length >= 40, `only ${shown.length} definition strings found — nothing is being scanned`);
  const unresolved = shown.filter((v) => !Object.prototype.hasOwnProperty.call(zh, v));
  assert.deepEqual(unresolved, [], 'definition strings with no entry in the table — these would print as keys');
});

test('the universal width control is keyed too — it appears on almost every form', () => {
  assert.equal(UNIVERSAL.w.label, 'width.label');
  assert.equal(CELL_STRINGS_ZH['width.label'], '寬度');
  assert.equal(cellStrings('ja')['width.label'], '幅');
  assert.equal(cellStrings('de')['width.6'], '6 (ganze Zeile)');
});

test('🔴 a NEW tile speaks the visitor\'s language, not the author\'s', () => {
  assert.equal(blankCell('text', cellStrings('en')).body, 'Write something.');
  assert.equal(blankCell('text', cellStrings('ja')).body, 'ここに文章を。');
  assert.equal(blankCell('text', cellStrings('de')).body, 'Schreiben Sie etwas.');
  assert.equal(blankCell('link', cellStrings('fr')).body, 'Nouveau lien');
  assert.equal(blankCell('profile', cellStrings('pt')).body, 'Uma linha sobre você');
});

test('🔴 a new link tile no longer ships a finished-looking button to example.com', () => {
  assert.doesNotMatch(BLANKS.link.body, /example\.com/);
  assert.doesNotMatch(BLANKS.link.body, /\]\(/, 'the blank still composes a markdown link');
});

test('the social blank keeps its whole [name](url) line — that IS the grammar a social row reads', () => {
  assert.match(BLANKS.social.body, /^\[[^\]]+\]\(https?:\/\/\S+\)$/);
  // …and it needs no translation: it is a brand name, and the table does not pretend otherwise
  assert.ok(!Object.prototype.hasOwnProperty.call(CELL_STRINGS_BY_KEY, 'blank.social.name'));
});

test('blankCell: an unknown type is null, and an unresolvable key passes through unchanged', () => {
  assert.equal(blankCell('nonsense', CELL_STRINGS_ZH), null);
  assert.equal(blankCell('feature', CELL_STRINGS_ZH).body, '');
  assert.equal(text({}, 'type.link.title'), 'type.link.title');
});

test('cellStrings: an unknown locale falls back to English PER KEY, never to a bare key', () => {
  const it = cellStrings('it');
  assert.equal(it['type.link.title'], 'Link');
  assert.deepEqual(Object.keys(it).sort(), [...CELL_KEYS].sort());
  for (const v of Object.values(it)) assert.doesNotMatch(v, /^type\.|^width\.|^blank\./);
});
