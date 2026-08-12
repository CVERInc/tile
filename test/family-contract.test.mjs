// The family contract — the parts of it that MORE THAN ONE model implements.
//
// The models here share no code by design: six `*-core` files and none of them imports another
// (card-core, in the private lab, imports two helpers from site-core and is the exception). Zero
// coupling is the right answer for six parsers of six different document types. What it costs is
// that "they agree" is a claim nobody was checking.
//
// 🔴 AND THE CLAIM WAS WIDER THAN THE TRUTH. The structure decision said "seven models, one
// markdown". Measured, the shared substrate is much narrower:
//
//   · a typed marker `%% <keyword>: <params> %%`   — site-core and card-core only. board-core uses
//     `%%tg-home:…%%` for one fixed thing, not a vocabulary; book/flow/pwa/modaltile have no marker.
//   · `parseParams`                                — ONE implementation (site-core). card-core
//     imports it. Nothing to drift.
//   · `splitFrontmatter`                           — TWO implementations. site-core's own comment
//     says it was "copied from book-core.js splitFrontmatter".
//   · `slugify`                                    — TWO implementations, both exported.
//
// So this file gates the two functions that genuinely exist twice. Everything else in the family is
// either single-sourced (nothing to check) or genuinely different (nothing to enforce). A test that
// pretended otherwise would be measuring agreement it manufactured.
//
// Both pairs agree today, on every case below. That is exactly when a gate is worth adding: the
// drift has not happened, and nothing was going to notice when it did. A slug is a URL fragment —
// two models disagreeing means one page's anchor stops matching its own table of contents.
import test from 'node:test';
import assert from 'node:assert/strict';

import { slugify as siteSlug, splitFrontmatter, parseSite, serializeSite, FRONTMATTER_KEY as SITE_KEY }
  from '../packages/sitetile/site-core.js';
import { slugify as bookSlug, parseBook, serializeBook, FRONTMATTER_KEY as BOOK_KEY }
  from '../pagetile-w/book-core.js';

// Specimens, not examples. Each line is here because it lands on a boundary some plausible
// implementation gets wrong — and the CJK ones are public-domain primers chosen for coverage:
// 千字文 (a thousand Han characters, no two alike), いろは歌 (every kana once), 훈민정음 (Hangul,
// and the only one of the three that carries word spaces).
const SLUG_CASES = [
  ['Hello World', 'the ordinary case, so a total failure is visible'],
  ['  padded  ', 'leading/trailing whitespace'],
  ['a  b', 'a run of spaces collapses to ONE separator'],
  ['a--b', 'a run of separators collapses too'],
  ['-leading-dash-', 'separators are trimmed from both ends'],
  ['Hello, World!', 'punctuation drops rather than becoming a separator'],
  ['C++ & C#', 'symbol soup — three tokens, not five separators'],
  ['100% pure', 'a digit-leading token survives'],
  ['a.b.c', 'dots are separators, not kept'],
  ['a/b/c', 'so are slashes — this one decides whether a slug can nest'],
  ['tabs\there', 'tab is whitespace'],
  ['new\nline', 'so is a newline — a heading can wrap in the source'],
  ['ALLCAPS', 'case folding'],
  ['İstanbul', '🔴 Turkish dotted capital I, U+0130. Its DEFAULT lowercase is two code points — '
    + '"i" + U+0307 COMBINING DOT ABOVE — and U+0307 is a Mark, so it is neither \\p{L} nor \\p{N}. '
    + 'Which means a slugifier that lowercases then replaces non-alphanumerics splits a Turkish '
    + 'word at its FIRST letter: İstanbul -> i-stanbul. One implementation that normalises or '
    + 'strips marks and one that does not will hand back "istanbul" and "i-stanbul", and both look '
    + 'entirely reasonable. (An earlier version of this note said toLowerCase is locale-dependent '
    + 'here. It is not — it is locale-independent by spec, measured identical under LANG=C, en_US '
    + 'and tr_TR. Only toLocaleLowerCase varies, and 🔴 nobody may switch to it: under "tr", plain '
    + '"I".toLocaleLowerCase() is "ı", so every existing anchor on the site would break at once.)'],
  ['ß sharp', 'ß has no single-character uppercase; some folds expand it to ss'],
  ['Ω mega', 'Greek, to prove folding is not ASCII-only'],
  ['Ünïcödé Ácçents', 'combining marks — kept, or stripped to ASCII? both are defensible, so both '
    + 'must answer the same'],
  ['千字文', 'Han with no spaces at all'],
  ['天地玄黃　宇宙洪荒', '🔴 IDEOGRAPHIC SPACE U+3000, not U+0020. A \\s-based split catches it; a '
    + 'literal " " split does not'],
  ['いろは歌', 'kana'],
  ['훈민정음', 'Hangul'],
  ['你好 world', 'mixed script across a space'],
  ['emoji 🌊 here', 'astral plane — a surrogate pair must not be cut in half'],
  ['---', 'nothing but separators'],
  ['', 'empty'],
  ['   ', 'whitespace only'],
];

test('🔴 the two slugify implementations agree — a slug is a URL, and there are two of them', () => {
  // CONTROL: they must actually be two functions. If a refactor ever made one re-export the other,
  // every assertion below would pass while proving nothing at all.
  assert.notEqual(siteSlug, bookSlug,
    'site-core and pagetile-w now export the SAME slugify — delete this test, or it is measuring a '
    + 'function against itself');

  const disagree = [];
  for (const [input, why] of SLUG_CASES) {
    const a = siteSlug(input);
    const b = bookSlug(input);
    if (a !== b) disagree.push(`  ${JSON.stringify(input)}\n      site=${JSON.stringify(a)}  book=${JSON.stringify(b)}\n      (${why})`);
  }
  assert.deepEqual(disagree, [],
    `slugify has drifted between site-core and book-core:\n${disagree.join('\n')}\n\n`
    + '  Whichever is right, they cannot both stay. A slug that differs by model means a heading\n'
    + '  anchor that does not match its own table of contents.');
});

// ── frontmatter: two readers, one shape ──────────────────────────────────────────────────────
//
// Both are hand-rolled `key: value` readers — the family deliberately has no YAML dependency, so
// there is no upstream keeping them honest. The cases below are the ones where "minimal" readers
// usually part company.
const FM_CASES = [
  ['---\ntitle: Hello\n---\nbody\n', 'the ordinary case'],
  ['---\ntitle: Hello\n---\n', 'no body at all'],
  ['no frontmatter here\n', 'absent — must be {} and the whole text as body, not a throw'],
  ['---\n---\nbody\n', 'present but empty'],
  ['---\ntitle: a: b: c\n---\n', '🔴 colons in the VALUE — split on the first, or the last?'],
  ['---\ntitle:\n---\n', 'a key with no value'],
  ['---\n  title: indented\n---\n', 'leading whitespace on the key'],
  ['---\ntitle: trailing spaces   \n---\n', 'trailing spaces in the value'],
  ['---\ntitle: 天地玄黃　宇宙洪荒\n---\n', 'a CJK value with an ideographic space'],
  ['---\ntitle: "quoted"\n---\n', 'quotes — kept as characters, or unwrapped?'],
  ['---\n# comment\ntitle: x\n---\n', 'a line that is not a pair'],
  ['---\ntitle: x\r\n---\r\nbody\r\n', '🔴 CRLF. A file edited on Windows, or pasted through one'],
  ['---\ntitle: x\n---', 'no trailing newline after the closing fence'],
  ['\n---\ntitle: x\n---\n', '🔴 a blank FIRST line — the block is no longer at offset 0, so it is '
    + 'not frontmatter at all. Both must agree it is absent'],
];

test('🔴 the two frontmatter readers agree — including on what is NOT frontmatter', () => {
  const disagree = [];
  for (const [input, why] of FM_CASES) {
    // site's is exported directly; book's is internal, so it is reached the only way a consumer
    // can reach it — through the parse entry point that uses it.
    const a = splitFrontmatter(input).meta;
    const b = parseBook(input).meta;
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) disagree.push(`  ${JSON.stringify(input)}\n      site=${sa}  book=${sb}\n      (${why})`);
  }
  assert.deepEqual(disagree, [],
    `the frontmatter readers have drifted:\n${disagree.join('\n')}\n\n`
    + '  site-core.js says its reader was copied from book-core.js. Nothing has been keeping that\n'
    + '  true since. Fix the one that is wrong — do not add a third.');
});

// ── the substrate round-trips ────────────────────────────────────────────────────────────────

const FENCED_CJK = [
  '天地玄黃　宇宙洪荒　日月盈昃　辰宿列張',
  '',
  '```js',
  '// --- this looks like frontmatter and a heading, and is neither',
  '## not a section',
  '%% sitetile: not a marker %%',
  '```',
  '',
  'いろは歌：いろはにほへと ちりぬるを',
  '훈민정음: 나랏말싸미 듕귁에 달아',
].join('\n');

const SUBSTRATE = [
  ['site', `---\n${SITE_KEY}: home\ntitle: 標本\n---\n\n## 千字文\n\n${FENCED_CJK}\n`, parseSite, serializeSite],
  ['book', `---\n${BOOK_KEY}: specimen\ntitle: 標本\n---\n\n## 千字文\n\n${FENCED_CJK}\n`, parseBook, serializeBook],
];

test('🔴 serialize∘parse is a FIXPOINT — which is what the contract actually says', () => {
  // 🩸 This test first asserted `serialize(parse(x)) === x`, because that is how the family contract
  // had been written down. Measured, it is false for both models and always was — they NORMALISE:
  //   · site drops the blank line between a `## ` heading and its body
  //   · book rewrites its claim flag to `true` and emits a `# ` title line even when empty
  // Neither is a defect. Both make `=== x` a claim about CANONICAL input, not about the models, and
  // a contract that is false for the first document you try is not a contract.
  //
  // The property that IS true, and is the one worth holding: applying the round trip again changes
  // nothing. Editing a document must converge, not oscillate.
  const broken = [];
  for (const [name, src, parse, serialize] of SUBSTRATE) {
    const once = serialize(parse(src));
    const twice = serialize(parse(once));
    if (twice !== once) {
      const i = [...once].findIndex((c, k) => c !== twice[k]);
      broken.push(`  ${name}: not a fixpoint — differs at offset ${i}\n`
        + `      1st: ${JSON.stringify(once.slice(Math.max(0, i - 30), i + 30))}\n`
        + `      2nd: ${JSON.stringify(twice.slice(Math.max(0, i - 30), i + 30))}`);
    }
  }
  assert.deepEqual(broken, [], `the round trip does not converge:\n${broken.join('\n')}`);
});

test('🔴 a fenced block survives VERBATIM — the check that is independent of any parser', () => {
  // 🩸 Idempotence is not correctness. A parser that treated every line as its own paragraph would
  // be a perfect fixpoint, and cardtile's round-trip suite once passed 11 corpora and a 110-chapter
  // book while doing something close to that. A fixpoint test agrees with itself; it cannot tell
  // you it is wrong.
  //
  // So here is an expectation that does not come from a parser: these exact bytes went in, and they
  // must come out, unchanged and contiguous. The block contains a `---`, a `## ` and a `%% … %%`,
  // so any model that scans lines without tracking fences will have eaten one of them and the
  // substring will not be found — while the document still looks like a normal document.
  const inner = FENCED_CJK;
  const missing = [];
  for (const [name, src, parse, serialize] of SUBSTRATE) {
    if (!serialize(parse(src)).includes(inner)) missing.push(name);
  }
  assert.deepEqual(missing, [],
    `the fenced block did not survive intact in: ${missing.join(', ')}\n`
    + '  Something inside a code fence was read as structure. Look for a line loop that does not\n'
    + '  track ``` state before you look anywhere else.');
});

test('CONTROL: both round-trip checks can actually fail', () => {
  // A gate nobody has seen fail is a gate you only know is quiet. Damage the fence and confirm each
  // check above notices — if either of these stops failing, the specimen has stopped containing the
  // thing it was built to contain.
  const src = `---\n${SITE_KEY}: home\n---\n\n## 千字文\n\n${FENCED_CJK}\n`;
  const unbalanced = src.replace('```js', '');
  assert.ok(!serializeSite(parseSite(unbalanced)).includes(FENCED_CJK),
    'the verbatim check passed on an UNBALANCED fence — it is no longer exercising the fence guard');

  // And the fixpoint check: a fixpoint is the weaker property, so prove the comparison itself is
  // live by asserting the two models really do normalise (i.e. `=== x` is genuinely false here).
  const normalised = SUBSTRATE.filter(([, s, p, ser]) => ser(p(s)) !== s).map(([n]) => n);
  assert.deepEqual(normalised, ['site', 'book'],
    'a model stopped normalising the substrate. That is not a failure — but the note above explains '
    + 'why `=== x` was rejected, and it is now stale for whichever model changed.');
});
