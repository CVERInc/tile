#!/usr/bin/env node
/* Every key the code asks for exists in every locale.
 *
 * 🩸 WHY. On 2026-08-13 chodaict spotted `aria-label="顯示 QR code"` in the source and asked whether
 * CI should enforce "outward-facing code and comments must be all English". The obvious gate — grep
 * the public repo for CJK — was measured and rejected: 93.1% of the CJK occurrences in this tree are
 * CORRECT (locale data, CJK test fixtures for a CJK-first editor, regex character classes). A gate
 * with a 93.1% false-positive rate is a gate somebody switches off, and then it guards nothing.
 *
 * 🔴 SO THIS ONE IS STRUCTURAL, NOT LEXICAL. It does not care what alphabet anything is in. It asks
 * one question: does every key the code passes to T() exist in every locale file?
 *
 * That is the shape of the actual bug. The table menu (sort by column, move column/row) shipped with
 * ten labels reading `T('TBL_INS_COL_L', '在左方插入欄')` — real i18n calls, correct pattern — and
 * the keys were never added to any of the four locale files. `T` falls back to its second argument,
 * which is the author's own language, so every English, Japanese and Korean user of the published
 * Obsidian plugins saw a Chinese menu. Nothing was red. The feature worked.
 *
 * A missing translation is not a language problem, it is a COVERAGE problem, and coverage is
 * countable.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['en-US', 'zh-TW', 'ja-JP', 'ko-KR'];

// Sources that call T(). Kept explicit: a glob would quietly start covering vendored copies, which
// are generated and would double every failure.
const SOURCES = ['packages/core/editor-core.js'];

const KEY_RE = /\bT\(\s*'([A-Za-z0-9_]+)'/g;

const locales = Object.fromEntries(LOCALES.map((l) =>
  [l, JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', `${l}.json`), 'utf8'))]));

let used = [];
for (const rel of SOURCES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  used.push(...[...src.matchAll(KEY_RE)].map((m) => m[1]));
}
used = [...new Set(used)];

// 🔴 CONTROL FOR THE SCAN. A regex that stops matching reports a perfectly covered tree. The key
// pattern was `[A-Za-z]+` in the first draft of this check and matched NONE of the ten keys that
// prompted it, because they contain underscores — I made exactly that mistake while measuring.
assert.ok(used.length >= 10, `only ${used.length} T() keys found — the extractor is not matching`);

const missing = [];
for (const [loc, table] of Object.entries(locales)) {
  for (const k of used) if (!(k in table)) missing.push(`${loc}: ${k}`);
}

// 🔴 CONTROL FOR THE VERDICT. A key nobody has translated must be reported as missing, or "0
// missing" is a claim about an empty comparison.
assert.ok(!('__DEFINITELY_NOT_A_REAL_KEY__' in locales['en-US']), 'setup');
assert.ok(!used.includes('__DEFINITELY_NOT_A_REAL_KEY__'), 'setup');
{
  const probe = [...used, '__DEFINITELY_NOT_A_REAL_KEY__'];
  const wouldMiss = probe.filter((k) => !(k in locales['en-US']));
  assert.ok(wouldMiss.includes('__DEFINITELY_NOT_A_REAL_KEY__'),
    'CONTROL: an untranslated key was not reported — this check compares nothing');
}

if (missing.length) {
  console.error(`✗ ${missing.length} key(s) the code asks for do not exist in a locale:`);
  for (const m of missing) console.error(`    ${m}`);
  console.error('  → the user sees T()\'s second argument, which is whatever language it was written in');
  process.exit(1);
}

console.log(`✓ i18n coverage: ${used.length} key(s) × ${LOCALES.length} locale(s), none missing`);
