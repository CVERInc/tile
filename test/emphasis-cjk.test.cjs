// Emphasis next to CJK text — the flanking rule's two CJK clauses (packages/cssmd/cssmd.js, isCjk).
//
// CommonMark decides whether a `*` run can open or close from the characters on either side of it,
// and its one use of punctuation assumes a script with spaces between words. Chinese, Japanese and
// Korean prose has none, so `已經**手動關閉（Kill）**了` printed its asterisks: the closer sits
// between `）` and a letter, which the rule reads as "not at a word boundary".
//
// Where the expected values come from: NOT from this engine. Every row below was checked against
// two references while it was written — the `commonmark` package for rows with no CJK neighbour
// (the rule there must be CommonMark's, unchanged), and `markdown-it` with the
// `markdown-it-cjk-friendly` plugin for the rest. Neither is a dependency of this repo, so neither
// can be the gate; this table is, exactly as test/emphasis.test.cjs is for the spec's own examples.
//
// Structure is asserted, and the round trip alongside it: a delimiter that turns out to be a
// marker moves into a hidden span, and one that does not must still be in the text as itself.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
const { renderInlineMd } = new Function(src + '\nreturn { renderInlineMd };')();

let pass = 0, fail = 0;

// The emphasis skeleton: <B>/<I> for the effect spans, <?> for any other span, markers dropped.
function shape(html) {
  return html
    .replace(/<span class="tg-mk">.*?<\/span>/g, '')
    .replace(/<span class="tg-b">/g, '<B>')
    .replace(/<span class="tg-i">/g, '<I>')
    .replace(/<span class="[^"]*">/g, '<?>')
    .replace(/<\/span>/g, '>');
}
const textOf = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function eq(input, want, why) {
  const html = renderInlineMd(input);
  const got = shape(html);
  try {
    assert.strictEqual(textOf(html), input, `${why} — ROUND TRIP BROKEN\n  in  ${JSON.stringify(input)}\n  out ${JSON.stringify(textOf(html))}`);
    assert.strictEqual(got, want, `${why}\n  in   ${JSON.stringify(input)}\n  got  ${got}\n  want ${want}`);
    console.log('PASS ' + why);
    pass++;
  } catch (e) { fail++; console.error('FAIL ' + e.message); }
}
const literal = (input, why) => eq(input, input, why);
const table = (rows) => { for (const [input, want, why] of rows) eq(input, want, why); };

// ── CJK letters on both sides of the markers ────────────────────────────────────────────────────
// These already worked — a letter is a letter in any script — and are here so the table is whole:
// the rows after them differ from these only in the punctuation.
table([
  ['已經**手動關閉**了', '已經<B>手動關閉>了', 'CJK letters around and inside bold'],
  ['這是*斜體*的', '這是<I>斜體>的', 'CJK letters around and inside italic'],
  ['これは**太字**です', 'これは<B>太字>です', 'kana around bold'],
  ['이것은**굵게**입니다', '이것은<B>굵게>입니다', 'hangul around bold'],
  ['按**Ctrl+C**結束', '按<B>Ctrl+C>結束', 'Latin inside, CJK letters outside'],
]);

// ── full-width punctuation INSIDE the markers, a letter outside ─────────────────────────────────
// The reported defect. Each of these printed its asterisks.
table([
  ['已經**手動關閉（Kill）**了', '已經<B>手動關閉（Kill）>了', 'the reported line: a closer between `）` and a CJK letter'],
  ['這是**「重點」**的地方', '這是<B>「重點」>的地方', 'corner brackets inside both markers'],
  ['他說*（真的）*嗎', '他說<I>（真的）>嗎', 'italic, full-width parentheses inside both markers'],
  ['**粗體。**後面', '<B>粗體。>後面', 'a full stop before the closer'],
  ['前面**。粗體**', '前面<B>。粗體>', 'a full stop after the opener'],
  ['價格**１００元！**起', '價格<B>１００元！>起', 'full-width digits and exclamation mark'],
  ['これは**「重要」**です', 'これは<B>「重要」>です', 'Japanese, brackets inside'],
  ['**注意：**必ず', '<B>注意：>必ず', 'a full-width colon before the closer'],
  ['ｶﾀｶﾅ**（半角）**ｶﾅ', 'ｶﾀｶﾅ<B>（半角）>ｶﾅ', 'half-width katakana outside'],
  ['Ａ**（全形）**Ｂ', 'Ａ<B>（全形）>Ｂ', 'full-width Latin letters outside'],
]);

// ── ordinary punctuation inside the markers, a CJK character outside ────────────────────────────
// The second clause: the CJK character stands where a space would have been. Korean is written
// with ASCII punctuation, and Chinese curly quotes, dashes and ellipses are the same code points
// as the Western ones, so the first clause alone does not reach these.
table([
  ['已經**手動關閉(Kill)**了', '已經<B>手動關閉(Kill)>了', 'the reported line with ASCII parentheses'],
  ['他說**"好"**然後', '他說<B>"好">然後', 'straight quotes inside, CJK letters outside'],
  ['이것은**"중요"**합니다', '이것은<B>"중요">합니다', 'hangul outside, straight quotes inside'],
  ['前**“引號”**後', '前<B>“引號”>後', 'curly quotes inside'],
  ['前**—破折—**後', '前<B>—破折—>後', 'em dashes inside'],
  ['前**…**後', '前<B>…>後', 'nothing but an ellipsis inside'],
  // An ideograph outside the BMP is two UTF-16 units; the rule has to see the character, not a half.
  ['**"OK"**𠮷野家', '<B>"OK">𠮷野家', 'a supplementary-plane ideograph after the closer'],
  ['𠮷**"OK"**', '𠮷<B>"OK">', 'a supplementary-plane ideograph before the opener'],
]);

// ── full-width punctuation OUTSIDE the markers ──────────────────────────────────────────────────
// Punctuation on the outer side was always enough, CJK or not. Unchanged, and pinned so that the
// clauses above cannot quietly take it away.
table([
  ['（**粗體**）', '（<B>粗體>）', 'full-width parentheses outside, letters inside'],
  ['，**（括號）**，', '，<B>（括號）>，', 'full-width punctuation outside and inside'],
  ['，**(note)**，', '，<B>(note)>，', 'full-width outside, ASCII inside'],
  ['他說：**"好"**。', '他說：<B>"好">。', 'full-width outside, straight quotes inside'],
  ['「*斜體*」', '「<I>斜體>」', 'italic inside corner brackets'],
]);

// ── Latin and CJK mixed ─────────────────────────────────────────────────────────────────────────
table([
  ['Foo**（bar）**baz', 'Foo<B>（bar）>baz', 'Latin letters outside, full-width parentheses inside'],
  ['用**Kill（強制）**結束', '用<B>Kill（強制）>結束', 'a Latin word then a full-width parenthesis before the closer'],
  ['Kill**（強制）**process', 'Kill<B>（強制）>process', 'Latin words outside, CJK inside'],
  ['the **「重點」** here', 'the <B>「重點」> here', 'spaces outside — never in question'],
  ['see **bold** and 看**粗體（對）**吧', 'see <B>bold> and 看<B>粗體（對）>吧', 'a Latin pair and a CJK pair on one line'],
]);

// ── bold and italic nested ──────────────────────────────────────────────────────────────────────
// The last three did not come out plain before: they came out WRONG, an italic covering the tail of
// the line, because the inner closer was refused and its asterisk paired with the outer run.
table([
  ['**這句話變得*更強（真的）*，不是更弱**', '<B>這句話變得<I>更強（真的）>，不是更弱>', 'italic ending in `）` inside bold, punctuation after it'],
  ['***又粗又斜（真的）***喔', '<I><B>又粗又斜（真的）>>喔', 'three delimiters, a closer after `）`'],
  ['*斜體裡有**粗體（對）**的*', '<I>斜體裡有<B>粗體（對）>的>', 'bold ending in `）` inside italic'],
  ['**粗體裡有*斜體（對）*的**', '<B>粗體裡有<I>斜體（對）>的>', 'italic ending in `）` inside bold, a letter after it'],
  ['這**很*重要（真的）*喔**！', '這<B>很<I>重要（真的）>喔>！', 'the same, mid-sentence'],
  ['**「*重點*」**的', '<B>「<I>重點>」>的', 'italic inside brackets inside bold'],
]);

// ── what must STAY literal ──────────────────────────────────────────────────────────────────────
// Whitespace still decides first: a run next to a space, an ideographic space included, opens or
// closes nothing on that side.
literal('2 * 3 * 4', 'arithmetic');
literal('2 * 3 * 4 = 24', 'arithmetic, longer');
literal('**', 'two asterisks alone');
literal('*', 'one asterisk alone');
literal('x ** y', 'a run with a space on each side');
literal('已經 ** 了', 'the same between CJK words');
literal('已經**手動關閉', 'an opener with no closer');
literal('手動關閉**了', 'a lone run between CJK letters');
literal('已經**手動關閉 **了', 'a closer after a space cannot close');
literal('已經** 手動關閉**了', 'an opener before a space cannot open');
literal('已經**\u3000手動關閉**了', 'U+3000 after the opener is whitespace, not a CJK neighbour');
literal('已經**手動關閉\u3000**了', 'U+3000 before the closer is whitespace, not a CJK neighbour');
literal('＊＊粗體＊＊', 'a full-width asterisk is not a delimiter');
literal('評分：*****（五星）', 'a run of stars with nothing to pair with');
eq('\\*\\*（不是粗體）\\*\\*了', '**（不是粗體）**了', 'escaped delimiters decline next to full-width punctuation too');
eq('`**（示範）**`了', '<?>**（示範）**>了', 'a code span holds the syntax it documents');

// With no CJK character beside the run, the rule is CommonMark's, and CommonMark refuses these.
literal('Foo**(bar)**baz', 'Latin letters outside, ASCII punctuation inside');
literal('a*"b"*c', 'the spec\'s own intraword refusal');
// One CJK neighbour does not excuse the other end of the pair: the closer here sits between `"`
// and a Latin letter, with nothing CJK beside it.
literal('𠮷**"OK"**a', 'an opener that qualifies, a closer that does not');

// Underscores: the intraword rule is untouched, in any script. An identifier is not emphasis, and
// neither is a file name written with CJK words.
literal('snake_case_name', 'an identifier');
literal('MAX_VALUE and a_b_c', 'identifiers in running prose');
literal('檔案_名稱_版本', 'underscores between CJK words');
literal('變數__名稱__值', 'double underscores between CJK words');
literal('user_（id）_name', 'underscores between a letter and full-width punctuation');
literal('他說_（真的）_嗎', 'an underscore pair flush between CJK letters — use asterisks');

// …and underscore emphasis that worked keeps working.
table([
  ['_斜體_', '<I>斜體>', 'underscore italic at the edges of the line'],
  ['他說 _（真的）_ 嗎', '他說 <I>（真的）> 嗎', 'underscore italic set off by spaces'],
  ['「__粗體__」', '「<B>粗體>」', 'underscore bold inside brackets'],
]);

// ── the two things the clauses must not be mistaken for ─────────────────────────────────────────
// 1. "Treat a CJK neighbour as whitespace" — the obvious shortcut — would stop these opening at
//    all, since a run followed by whitespace cannot open. They are the first rows of this file for
//    that reason; this is the same claim on the smallest input there is.
eq('**粗**', '<B>粗>', 'a CJK letter directly inside the markers still opens and closes');
// 2. The clauses change which runs CAN pair, not how pairing works. The rule of 3 still refuses a
//    middle run that could play both parts.
eq('**粗****體**', '<B>粗****體>', 'the rule of 3 between CJK letters');

console.log(fail ? `\n✗ emphasis-cjk: ${pass} passed, ${fail} failed` : `\n✅ emphasis-cjk all pass (${pass})`);
process.exit(fail ? 1 : 0);
