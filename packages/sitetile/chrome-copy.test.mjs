// The chrome a visitor reads must speak the site's language, and live in ONE place.
//   run: node packages/sitetile/chrome-copy.test.mjs
//
// 🩸 2026-08-06. The blog sidebar's headings were Chinese string literals written inline in THREE
// components (BlogIndexView, PostView, ArchiveView), the archive counts were wrapped in full-width
// parentheses for everyone, DateArchiveView hardcoded `2026 年 7 月`, and the tag/date subhead
// prefixes appeared in FOUR more routes. Only the search placeholder had an override key. A
// Japanese, Korean or English tenant that turned the sidebar on read 最新文章 / 標籤雲 / 所有貼文.
//
// Underneath it was the same shape twice over:
//   • a multi-tenant renderer treating one language as the default rather than as a choice — the
//     family that once served the vendor's blog title to every other site;
//   • the same string in N places with nothing checking they agree, so a fix could land in one copy
//     and read as done.
//
// And one thing nobody could express at all: splitFrontmatter trims every value, so `Posts tagged `
// — a prefix whose trailing space is the whole point — was unwritable. The CJK default hid that for
// months because a full-width colon carries its own gap.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiCopy, dateHeading } from './astro/src/packages/lingo/locale.mjs';
import { unquote, archivePrefixes, dateBadgeParts } from './astro/src/lib/chrome-copy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
  return /\.(astro|mjs|js)$/.test(n) ? [p] : [];
});
// Comments are allowed to contain CJK — they explain the defect. Strip them before looking.
const stripComments = (t) => t
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');
const CJK = /[一-鿿぀-ヿ가-힯]/;

test('every locale has a full set of chrome copy', () => {
  for (const l of ['en-US', 'zh-TW', 'ja-JP', 'ko-KR']) {
    const u = uiCopy(l);
    for (const k of ['recent', 'tags', 'archive', 'search', 'tagPrefix', 'datePrefix']) {
      assert.ok(u[k] && String(u[k]).trim(), `${l} is missing ${k}`);
    }
    assert.equal(typeof u.month, 'function');
    assert.equal(typeof u.count, 'function');
  }
});

test('🔴 zh-TW is byte-identical to what shipped before — this fix changes no live Chinese site', () => {
  const u = uiCopy('zh-TW');
  assert.equal(u.recent, '最新文章');
  assert.equal(u.tags, '標籤雲');
  assert.equal(u.archive, '所有貼文');
  assert.equal(u.search, '搜尋......');
  assert.equal(u.count(u.month('07'), 41), '7月（41）', 'full-width parens, no space');
  assert.equal(u.count(2015, 128), '2015（128）', 'and the same for a year row');
  assert.equal(dateHeading('zh-TW', 2026, 7), '2026 年 7 月');
  assert.equal(u.tagPrefix, '顯示具有以下標籤的文章：');
  assert.equal(u.datePrefix, '發表於：');
});

test('🔴 no other locale borrows Chinese', () => {
  for (const l of ['en-US', 'ko-KR']) {
    const u = uiCopy(l);
    for (const k of ['recent', 'tags', 'archive', 'search', 'tagPrefix', 'datePrefix']) {
      assert.ok(!/[一-鿿]/.test(String(u[k])), `${l}.${k} still reads Chinese: ${u[k]}`);
    }
  }
  assert.equal(dateHeading('en-US', 2026, 7), 'July 2026', 'and the order is a language fact');
  assert.equal(dateHeading('ko-KR', 2026, 7), '2026년 7월');
});

test('punctuation belongs to the language, not the template', () => {
  assert.equal(uiCopy('en-US').count('July', 41), 'July (41)', 'space + half-width');
  assert.equal(uiCopy('ja-JP').count('7月', 41), '7月（41）', 'no space + full-width');
});

test('🔴 a Latin prefix keeps its trailing space — the thing that was unwritable', () => {
  assert.equal(uiCopy('en-US').tagPrefix, 'Posts tagged ');
  assert.ok(uiCopy('en-US').tagPrefix.endsWith(' '), 'or the tag name collides with the word');
  assert.equal(uiCopy('en-US').tagPrefix + 'archive', 'Posts tagged archive');
});

test('an unknown locale falls back to English, never to Chinese', () => {
  assert.deepEqual(uiCopy('xx-XX').recent, uiCopy('en-US').recent);
  assert.equal(dateHeading('', 2026, 7), 'July 2026');
});

test('🔴 the strings exist in exactly ONE place', () => {
  const offenders = [];
  for (const f of walk(SRC)) {
    if (f.endsWith('packages/lingo/locale.mjs')) continue;       // the table itself
    const body = stripComments(readFileSync(f, 'utf8'));
    for (const s of ['最新文章', '標籤雲', '所有貼文', '搜尋......', '顯示具有以下標籤的文章', '發表於']) {
      if (body.includes(s)) offenders.push(`${relative(SRC, f)}: ${s}`);
    }
    if (/\d\s*月（/.test(body)) offenders.push(`${relative(SRC, f)}: hardcoded 月（…）`);
  }
  assert.deepEqual(offenders, [], `chrome copy escaped the table:\n${offenders.join('\n')}`);
});

test('🔴 the whole renderer carries no other CJK UI literal', () => {
  // Structural, not a denylist: any CJK string sitting in JSX text or an attribute is chrome
  // somebody hardcoded. The lingo tables are the exception because being per-language IS their job.
  // A file that carries its OWN complete locale table is not the defect this looks for — it is the
  // fix, applied locally. Collection.astro owns section-specific copy (GitHub / learn-more) and maps
  // all four locales, so its Korean string is Korean on purpose. The allowlist is explicit rather
  // than a pattern match, so adding to it is a decision somebody makes on the record — and each
  // entry must still PROVE it maps every locale, or it is just a hardcode with a friend.
  const OWNS_A_TABLE = ['components/sections/Collection.astro'];
  // fmtDate's `cjk-full` / `cjk-md` branches ARE Chinese, and that is the feature: they are named
  // date formats a site opts into with `blog-date-format`. What would make them a defect is being
  // reachable without asking — so rather than exempt the file, prove the shape: every CJK format
  // sits behind a `case` label, and the DEFAULT branch is not one of them.
  const blog = readFileSync(join(SRC, 'lib/blog.mjs'), 'utf8');
  const fmt = blog.slice(blog.indexOf('export function fmtDate('), blog.indexOf('// footerWidgets'));
  assert.match(fmt, /default:\s*\n\s*return d\.toLocaleDateString\('en-US'/,
    'the default date format must stay neutral — a CJK default is the defect, a CJK option is not');
  for (const line of fmt.split('\n')) {
    if (!CJK.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;
    assert.ok(/case '/.test(line) || /case '/.test(fmt.slice(0, fmt.indexOf(line))),
      `CJK in fmtDate outside a case branch: ${line.trim()}`);
  }
  const CASE_ONLY = ['lib/blog.mjs'];
  for (const rel of OWNS_A_TABLE) {
    const body = readFileSync(join(SRC, rel), 'utf8');
    for (const l of ['zh-tw', 'ja-jp', 'ko-kr']) {
      assert.ok(body.toLowerCase().includes(`'${l}'`), `${rel} claims a locale table but has no ${l} row`);
    }
  }
  const offenders = [];
  for (const f of walk(SRC)) {
    if (f.includes('/packages/lingo/')) continue;
    if (OWNS_A_TABLE.some((rel) => f.endsWith(rel))) continue;
    if (CASE_ONLY.some((rel) => f.endsWith(rel))) continue;   // proven above, branch by branch
    const body = stripComments(readFileSync(f, 'utf8'));
    for (const m of body.matchAll(/(?:>|['"`])([^<>'"`]{0,60})/g)) {
      if (CJK.test(m[1])) offenders.push(`${relative(SRC, f)}: ${m[1].trim().slice(0, 40)}`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded CJK chrome:\n${[...new Set(offenders)].join('\n')}`);
});

test('🔴 unquote is how a site says "this whitespace is mine"', () => {
  // splitFrontmatter trims every value, so `Posts tagged ` is unwritable bare and leaks its quotes
  // if the reader does not unquote. Trimming before unquoting would undo the whole point.
  assert.equal(unquote('"Posts tagged "'), 'Posts tagged ');
  assert.equal(unquote("'Posts tagged '"), 'Posts tagged ');
  assert.equal(unquote('Posts tagged'), 'Posts tagged', 'unquoted values pass through');
  assert.equal(unquote('"mismatched\''), '"mismatched\'', 'only a MATCHED pair counts');
  assert.equal(unquote('""'), '', 'an explicit empty string is expressible');
  assert.equal(unquote(null), '');
});

test('🔴 archivePrefixes: locale default, site override, and the override may be blank-ish', () => {
  assert.equal(archivePrefixes({ lang: 'en-US' }).tag, 'Posts tagged ');
  assert.equal(archivePrefixes({ lang: 'zh-TW' }).date, '發表於：');
  assert.equal(archivePrefixes({ lang: 'en-US', 'blog-label-prefix': '"Filed under "' }).tag, 'Filed under ');
  assert.equal(archivePrefixes({ lang: 'en-US', 'blog-label-prefix': '' }).tag, 'Posts tagged ',
    'an empty value is not an override — it falls back rather than rendering a bare tag name');
  for (const k of ['tag', 'date', 'author', 'category']) {
    assert.ok(archivePrefixes({ lang: 'ko-KR' })[k], `ko-KR is missing ${k}`);
  }
});

test('🔴 the date badge is SHORT, and it is the site\'s language', () => {
  // The badge is a compact chip. A full month heading in it ("July 2026") is a different string
  // wearing the same name — the mistake that made this assertion necessary.
  assert.equal(dateBadgeParts('2026-07-14', 'en-US').month, 'Jul');
  assert.equal(dateBadgeParts('2026-07-14', 'zh-TW').month, '7月', 'unchanged for the CJK sites');
  assert.equal(dateBadgeParts('2026-07-14', 'ko-KR').month, '7월');
  assert.equal(dateBadgeParts('2026-07-14').month, 'Jul', 'no lang → the neutral default, never Chinese');
  assert.equal(dateBadgeParts('nonsense', 'en-US').month, '');
});

test('🔴 every dateBadgeParts call site passes the language', () => {
  // The signature gained a parameter. A call site that forgets it silently renders English months on
  // a Chinese site — a regression with no error, which is why this counts call sites structurally.
  const bad = [];
  for (const f of walk(SRC)) {
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/dateBadgeParts\(([^)]*)\)/g)) {
      if (!/,/.test(m[1]) && !/^s\b|^s,/.test(m[1].trim())) bad.push(`${relative(SRC, f)}: dateBadgeParts(${m[1]})`);
    }
  }
  assert.deepEqual(bad, [], `call sites missing the lang argument:\n${bad.join('\n')}`);
});

test('🔴 the locale a SITE writes is a BCP-47 tag, not the data code', () => {
  // 🩸 A site declares `lang: zh-Hant`, because that is what belongs in <html lang>. The table was
  // keyed by the data code, so every default fell through to English on a Taiwanese site — measured
  // on its own preview: sidebar "All posts / Recent posts / Tags" where live says 所有貼文 / 最新文章
  // / 標籤雲, and date badges "Nov" where live says 11月. The reference site writes en-US, so nothing on the
  // site I was verifying against could ever have shown it. N was 1, and the wall was untested.
  for (const wild of ['zh-Hant', 'zh-hant', 'zh-Hant-TW', 'zh-tw', 'zh']) {
    assert.equal(uiCopy(wild).archive, '所有貼文', `${wild} must resolve to Traditional Chinese`);
    assert.equal(dateBadgeParts('2026-11-02', wild).month, '11月', `${wild} date badge`);
  }
  assert.equal(uiCopy('ja').archive, uiCopy('ja-JP').archive, 'bare subtags too');
  assert.equal(uiCopy('ko').archive, uiCopy('ko-KR').archive);
  assert.equal(uiCopy('en-GB').archive, 'All posts', 'and a region we do not carry falls to its language');
});

test('🔴 a more specific tag still outranks its bare subtag', () => {
  // `zh` alone resolving to Traditional Chinese is a choice this project already made elsewhere
  // (LINGO_PREFIXES maps zh → zh-TW). What must not happen is a prefix match beating an exact one.
  assert.equal(uiCopy('zh-Hant').archive, uiCopy('zh-TW').archive);
  assert.equal(uiCopy('ja-JP').archive, 'すべての記事', 'exact data code, unchanged');
  assert.equal(uiCopy('nope').archive, 'All posts', 'an unknown tag still falls to English, never to Chinese');
});

console.log(`\n${passed} passed`);
