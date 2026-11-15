// tile#298 part 3 — whose language the page CHROME speaks (the deck's view switcher, its calls to
// action), and how the answer is kept from leaking between visitors through a cache.
//
//   card declares `lang:`        → the card's language, exactly as before: byte for byte, headers too
//   card declares no `lang:`     → the visitor's: `?lang=` (or the older `?locale=`), then
//                                  Accept-Language (the editor's own matcher), then English —
//                                  and the response says `Vary: Accept, Accept-Language`
//   either way                   → `<html lang>` and the owner's content are the card's, untouched
//
// run: node --test packages/cardtile/serve/card-chrome-lang.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { renderCardHTML } from './card-worker.mjs';

const NO_LANG = [
  '---', 'card-page: t', 'title: Test Card', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% A public bio',
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/x)',
  '',
].join('\n');
const WITH_LANG = NO_LANG.replace('title: Test Card', 'title: Test Card\nlang: zh-TW');

const deckWords = (html) => JSON.parse(/window\.__deckStrings=(\{.*?\});/.exec(html)[1]);
// (the root tag carries the deck's opening view too — data-view / data-views, tile#297 — so `lang` is not its first attribute)
const htmlLang = (html) => /<html\b[^>]*\slang="([^"]*)"/.exec(html)[1];
// the page without the deck's words: what the owner wrote and the renderer drew
const withoutWords = (html) => html.replace(/window\.__deckStrings=\{.*?\};/, '');

const store = (md) => ({
  get: async (k) => (k === 't' ? md : null),
  getWithMetadata: async (k) => ({ value: k === 't' ? md : null, metadata: null }),
});
const page = async (md, { query = '', al } = {}) => {
  const headers = al == null ? {} : { 'accept-language': al };
  const res = await worker.fetch(new Request(`https://card.feelreef.com/t${query}`, { headers }), { PREVIEW: 'false', CARDS: store(md) });
  return { res, body: await res.text() };
};

// ── the pure renderer ────────────────────────────────────────────────────────────────────────────

test('renderCardHTML: a card with no lang: speaks the caller’s chromeLang in the deck, and only there', () => {
  const plain = renderCardHTML(NO_LANG, { handle: 't' });
  const ja = renderCardHTML(NO_LANG, { handle: 't', chromeLang: 'ja' });
  assert.equal(deckWords(plain).viewStack, 'Stack');
  assert.equal(deckWords(ja).viewStack, '重ね');
  assert.equal(htmlLang(ja), 'en', '<html lang> is the content’s language, not the visitor’s');
  assert.equal(withoutWords(ja), withoutWords(plain), 'nothing but the deck’s words changed');
});

test('renderCardHTML: a card WITH lang: ignores chromeLang entirely (byte-identical)', () => {
  const own = renderCardHTML(WITH_LANG, { handle: 't' });
  assert.equal(renderCardHTML(WITH_LANG, { handle: 't', chromeLang: 'ja' }), own);
  assert.equal(deckWords(own).viewStack, '疊');
});

// ── the Worker: the precedence, end to end ───────────────────────────────────────────────────────

const CASES = [
  // [what, query, Accept-Language, expected viewStack]
  ['nothing said → English', '', undefined, 'Stack'],
  ['Accept-Language ja', '', 'ja-JP,en;q=0.5', '重ね'],
  ['Accept-Language: first one we speak wins', '', 'xx-YY,zh-TW;q=0.9,ja;q=0.8', '疊'],
  ['Accept-Language zh-CN → Simplified', '', 'zh-CN', '叠'],
  ['Accept-Language nothing we speak → English', '', 'xx-YY', 'Stack'],
  // tile#298 r2 — the reviewer's three requests: quality weights, not written order
  ['Accept-Language: q=0 excludes a language', '', 'ja;q=0,en;q=1', 'Stack'],
  ['Accept-Language: a later, higher q wins', '', 'en;q=0.1,ja;q=1', '重ね'],
  ['Accept-Language: a later, higher q wins (zh-TW)', '', 'ja;q=0.2,zh-TW;q=0.9', '疊'],
  ['Accept-Language: the only language excluded → English', '', 'ja;q=0', 'Stack'],
  ['?lang= beats Accept-Language', '?lang=ja', 'zh-TW', '重ね'],
  ['?lang= takes a full tag', '?lang=zh-TW', 'ja', '疊'],
  ['?locale= still works', '?locale=ja', undefined, '重ね'],
];

for (const [what, query, al, want] of CASES) {
  test(`no lang: — ${what}`, async () => {
    const { res, body } = await page(NO_LANG, { query, al });
    assert.equal(res.status, 200);
    assert.equal(deckWords(body).viewStack, want);
    assert.equal(htmlLang(body), 'en', '<html lang> stays the card’s (default) language');
  });
}

test('no lang: — the response varies by Accept-Language, and says so (with Accept, as before)', async () => {
  for (const al of [undefined, 'ja']) {
    const { res } = await page(NO_LANG, { al });
    const vary = res.headers.get('vary').split(',').map((s) => s.trim().toLowerCase()).sort();
    assert.deepEqual(vary, ['accept', 'accept-language'], `Vary for Accept-Language ${al}`);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60', 'caching itself is unchanged');
  }
});

test('no lang: — only the deck’s words differ between two visitors', async () => {
  const en = await page(NO_LANG, { al: 'en-US' });
  const ja = await page(NO_LANG, { al: 'ja-JP' });
  assert.notEqual(en.body, ja.body);
  assert.equal(withoutWords(ja.body), withoutWords(en.body));
});

test('lang: declared — every visitor gets the same bytes and the same headers as before', async () => {
  const base = await page(WITH_LANG);
  assert.equal(base.res.headers.get('vary'), 'Accept', 'no Accept-Language in Vary: this page does not vary by it');
  assert.equal(deckWords(base.body).viewStack, '疊');
  for (const opts of [{ al: 'ja-JP' }, { al: 'zh-CN' }, { query: '?lang=ja' }, { query: '?lang=ko', al: 'de' }]) {
    const other = await page(WITH_LANG, opts);
    assert.equal(other.body, base.body, JSON.stringify(opts));
    assert.deepEqual([...other.res.headers], [...base.res.headers], JSON.stringify(opts));
  }
});

test('the no-card page is not touched: English, and no Accept-Language in Vary', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/nobody', { headers: { 'accept-language': 'ja' } }),
    { PREVIEW: 'false', CARDS: store(null) });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('vary'), 'Accept');
  assert.equal(deckWords(await res.text()).viewStack, 'Stack');
});

test('the markdown exit does not vary by language (it is the owner’s file)', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/t', { headers: { accept: 'text/markdown', 'accept-language': 'ja' } }),
    { PREVIEW: 'false', CARDS: store(NO_LANG) });
  assert.equal(res.status, 200);
  assert.ok(!/accept-language/i.test(res.headers.get('vary') || ''));
});
