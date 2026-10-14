// A link's brand mark, and the chain it falls back through (CVERInc/reef#2011).
//
//   node --test packages/cardtile/serve/link-icons.test.mjs
//
// 🩸 WHAT THIS IS HOLDING (measured 2026-10-12): every Card's Instagram and Threads marks were
// broken, and books.com.tw's was stuck. DuckDuckGo has no mark for `instagram.com` or `threads.*`
// (404) but does for `www.instagram.com` (200) — and the renderer stripped `www.` before asking, so
// the one name that had a picture was the one name it could never ask for. The cards and the
// upstream below are made up; the three sample domains are the real ones the ticket measured.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { renderCardHTML } from './card-worker.mjs';
import { ICONS } from './card-assets.mjs';

const card = (...cells) => ['---', 'card-page: x', 'title: X', '---', '', '## grid', '', ...cells].join('\n') + '\n';
const markup = (md) => renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
/** the candidates one <img> will walk, in order: its src, then data-iconfallback */
const chainOf = (img) => [/src="([^"]+)"/.exec(img)[1],
  ...((/data-iconfallback="([^"]*)"/.exec(img) || [, ''])[1].split(' ').filter(Boolean))];
const linkMark = (html) => /<div class="st-cell-head">(<svg[\s\S]*?<\/svg>|<img[^>]*>)/.exec(html)[1];
const socialMarks = (html) => [...html.matchAll(/<a class="st-social-btn"[^>]*>(<svg[\s\S]*?<\/svg>|<img[^>]*>)/g)].map((m) => m[1]);

test('a two-level public suffix is not a site: books.com.tw never falls back to com.tw', () => {
  // Never a wrong icon — `com.tw` has none — but one wasted request on every such card, every visit.
  const chain = chainOf(linkMark(markup(card('- [ ] %% card: link %% [博客來](https://books.com.tw/products/1)'))));
  assert.ok(chain.includes('/_icon/books.com.tw.ico'), `setup: ${chain}`);
  for (const d of ['com.tw', 'www.com.tw']) assert.ok(!chain.includes(`/_icon/${d}.ico`), `asked ${d}: ${chain}`);
  // …and the same for a SUBDOMAIN under one: it climbs to the site, not past it
  const sub = chainOf(linkMark(markup(card('- [ ] %% card: link %% [S](https://shop.example.co.uk/x)'))));
  assert.ok(sub.includes('/_icon/example.co.uk.ico') && !sub.includes('/_icon/co.uk.ico'), `${sub}`);
});

test('🔴 the host as written is asked first, and its www. twin is always in the chain', () => {
  // books.com.tw is not a brand we draw, so it is the one that shows the chain itself.
  const written = linkMark(markup(card('- [ ] %% card: link %% [博客來](https://www.books.com.tw/products/1)')));
  assert.deepEqual(chainOf(written).slice(0, 2), ['/_icon/www.books.com.tw.ico', '/_icon/books.com.tw.ico'],
    'www. was stripped before asking — the name with the picture is never asked for');
  const bare = linkMark(markup(card('- [ ] %% card: link %% [博客來](https://books.com.tw/products/1)')));
  assert.deepEqual(chainOf(bare).slice(0, 2), ['/_icon/books.com.tw.ico', '/_icon/www.books.com.tw.ico'],
    'a bare host gets no www. twin to fall back to');
  // the social row walks the same chain — it is the same helper, and must stay so
  const [soc] = socialMarks(markup(card('- [ ] %% card: social w=6 %% [博客來](https://www.books.com.tw/)')));
  assert.deepEqual(chainOf(soc).slice(0, 2), ['/_icon/www.books.com.tw.ico', '/_icon/books.com.tw.ico']);
});

test('🔴 Instagram and Threads are fetched LIVE like every other mark — no automatic built-in SVG (reef#2026)', () => {
  // tile#123 drew these by host because DuckDuckGo had nothing; reef#2026 reversed it: marks are never
  // stored on our side, /_icon asks DuckDuckGo then Google. The built-in glyph is for `icon=instagram`.
  assert.ok(ICONS.threads && /^<svg/.test(ICONS.threads), 'the named icon= must still ship');
  for (const url of ['https://instagram.com/someone', 'https://www.instagram.com/someone',
    'https://www.threads.net/@someone', 'https://www.threads.com/@someone']) {
    const html = markup(card(`- [ ] %% card: link %% [L](${url})`, `- [ ] %% card: social w=6 %% [S](${url})`));
    assert.match(linkMark(html), /^<img[^>]*src="\/_icon\//, `link to ${url} is not a live <img>`);
    assert.ok(socialMarks(html).every((m) => /^<img[^>]*src="\/_icon\//.test(m)), `social mark for ${url} is not a live <img>`);
  }
});

test('the author still outranks the table: icon= and iconhost= on a link are obeyed', () => {
  const html = markup(card('- [ ] %% card: link iconhost=webtoons.com %% [IG](https://instagram.com/x)',
    '- [ ] %% card: link icon=shop %% [IG](https://instagram.com/x)'));
  assert.match(html, /_icon\/webtoons\.com\.ico/, 'an explicit iconhost lost to the brand table');
  assert.ok(html.includes(ICONS.shop), 'an explicit icon= lost to the brand table');
  // 🔴 control: the SAME link with no override is the live favicon, so the two lines above prove the
  // author's word changed something (reef#2026: there is no automatic brand SVG any more).
  assert.match(linkMark(markup(card('- [ ] %% card: link %% [IG](https://instagram.com/x)'))), /^<img[^>]*_icon\/instagram\.com\.ico/,
    'no override, yet the link was not the live favicon');
});

test('🔴 each mark in a social row can be told its icon: icon= and iconhost= after the address', () => {
  // The row had NO override at all, so one broken mark meant giving up the whole row for big link
  // buttons — and the escape route led authors to iconimg=, which draws a 64×64 artwork thumbnail.
  const html = markup(card('- [ ] %% card: social w=6 %% [Shop](https://shop.example.com/a) icon=shop\n'
    + '\t[Comic](https://bit.ly/xyz) iconhost=webtoons.com\n\t[Plain](https://example.org/)'));
  const [shop, comic, plain] = socialMarks(html);
  assert.equal(shop, ICONS.shop, 'icon= on a social line was ignored');
  assert.deepEqual(chainOf(comic), ['/_icon/webtoons.com.ico'], 'iconhost= on a social line was ignored, or second-guessed');
  assert.equal(chainOf(plain)[0], '/_icon/example.org.ico', 'a line with no override changed');
  // the override is not part of the address, and not part of what the visitor is told
  assert.match(html, /href="https:\/\/bit\.ly\/xyz"/);
  assert.ok(!/iconhost|icon=shop/.test(html.replace(/<a class="st-social-btn"[^>]*>/g, (a) => a.replace(/href="[^"]*"/, ''))
    .match(/<div class="st-cell st-social"[\s\S]*?<\/div>/)[0].replace(/<svg[\s\S]*?<\/svg>|<img[^>]*>/g, '')),
  'the override leaked into the row');
  // an icon= that names nothing we have falls through to the favicon, never to an empty circle
  const [unknown] = socialMarks(markup(card('- [ ] %% card: social w=6 %% [S](https://example.org/) icon=nope')));
  assert.equal(chainOf(unknown)[0], '/_icon/example.org.ico');
});

test('🔴 a bare address keeps its mark when an override follows it', () => {
  // The hint says "add icon= after the address"; a bare-URL line used to stop being a URL the moment
  // anything followed it, and the whole mark vanished.
  const html = markup(card('- [ ] %% card: social w=6 %% https://example.org/x icon=shop\n\thttps://bit.ly/y iconhost=webtoons.com'));
  const [shop, comic] = socialMarks(html);
  assert.equal(shop, ICONS.shop, 'bare URL + icon= drew nothing, or ignored the override');
  assert.deepEqual(chainOf(comic), ['/_icon/webtoons.com.ico'], 'bare URL + iconhost= drew nothing, or ignored it');
  assert.match(html, /href="https:\/\/example\.org\/x"/, 'the override leaked into the address');
});

test('🔴 an explicit override beats the default envelope and house marks', () => {
  const md = card('- [ ] %% card: social w=6 %% [Home](https://www.example.org/x) icon=shop\n\t[Mail](mailto:x@example.org) icon=shop\n'
    + '\t[Home2](https://example.org/y) iconhost=webtoons.com\n\t[Home3](https://example.org/z)\n\t[Mail2](mailto:y@example.org)');
  const html = renderCardHTML(md, { handle: 'x', cardUrl: 'https://example.org/x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  const [home, mail, home2, home3, mail2] = socialMarks(html);
  assert.equal(home, ICONS.shop, 'icon= on an own-site mark lost to the house');
  assert.equal(mail, ICONS.shop, 'icon= on a mail mark lost to the envelope');
  assert.deepEqual(chainOf(home2), ['/_icon/webtoons.com.ico'], 'iconhost= on an own-site mark lost to the house');
  // with no override, the defaults are unchanged
  assert.match(home3, /M3 10\.6 12 3\.4l9 7\.2/, 'own-site default is no longer the house');
  assert.match(mail2, /m2 7 10 6 10-6/, 'mail default is no longer the envelope');
});

test('🔴 only a validated mark is kept (caches.default); no cf cache options on the upstream fetch', async () => {
  // r9: `cf.cacheTtl*` would keep an UNVALIDATED upstream answer. The route now asks for no edge caching on
  // the upstream fetch and stores only a response that passed the MIME check. A miss is asked again.
  const seen = [], stored = new Map();
  const real = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async (r) => stored.get(r.url)?.clone(), put: async (r, v) => { stored.set(r.url, v); } } };
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), cf: init && init.cf });
    return /books/.test(String(url)) ? new Response('', { status: 404 })
      : new Response(new Uint8Array([0, 0, 1, 0]), { status: 200, headers: { 'content-type': 'image/x-icon' } });
  };
  try {
    const env = { PREVIEW: 'false', CARDS: { get: async () => null } };
    const miss = await worker.fetch(new Request('https://card.feelreef.com/_icon/books.com.tw.ico'), env);
    const hit = await worker.fetch(new Request('https://card.feelreef.com/_icon/www.instagram.com.ico'), env);
    assert.equal(miss.status, 404);
    assert.equal(hit.status, 200);
    // reef#2026 (tile#125): the books miss asks DuckDuckGo AND Google before giving up; the hit stops at DuckDuckGo.
    assert.equal(seen.length, 3, 'setup: the route did not reach the upstream');
    for (const { url, cf } of seen) assert.equal(cf, undefined, `${url}: upstream fetch must not ask the edge to cache`);
    assert.deepEqual([...stored.keys()], ['https://card.feelreef.com/_icon/www.instagram.com.ico']);
  } finally { globalThis.fetch = real; globalThis.caches = realCaches; }
});

test('🔴 the grammar says what iconimg IS: an artwork thumbnail, not a brand mark', async () => {
  // describe_card_grammar reads every param's label and hint through cell-i18n. iconimg's hint was
  // empty and its label said "Your own icon image" — so an agent with a broken Instagram mark put
  // the brand logo there, and got a 64×64 square three times the size of the 22px marks beside it.
  const { CELL_TYPES } = await import('../ai-ops.mjs');
  const { CELL_STRINGS_BY_KEY } = await import('../w/cell-i18n.mjs');
  const key = CELL_TYPES.link.params.iconimg.hint;
  assert.ok(key, 'iconimg has no hint at all');
  const row = CELL_STRINGS_BY_KEY[key];
  assert.ok(row, `${key} is not in the string table`);
  for (const loc of ['zh', 'ja', 'en', 'ko', 'zh-Hans', 'de', 'fr', 'es', 'pt']) {
    assert.ok(row[loc] && row[loc].includes('64×64') && row[loc].includes('icon='), `${loc}: ${row[loc]}`);
  }
  assert.match(row.en, /thumbnail/i);
});

test('🔴 a literal space in a URL query is the URL, not an override (review v2 P2)', async () => {
  const { linkOf } = await import('../card-render.mjs');
  const hrefs = (html) => [...html.matchAll(/<a class="st-social-btn"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  // codex input 1: tail `icon=shop` is itself a legal token → override, url cut before it
  const a = 'https://example.org/?q=one icon=shop';
  assert.deepEqual(linkOf(a).over, { icon: 'shop' });
  assert.equal(linkOf(a).url, 'https://example.org/?q=one');
  // codex input 2: tail carries `&x=2`, not a token → the whole line is the URL, nothing dropped
  const b = 'https://example.org/?q=one icon=shop&x=2';
  assert.equal(linkOf(b).url, b);
  assert.equal(linkOf(b).over, undefined);
  const html = markup(card(`- [ ] %% card: social w=6 %% ${b}`));
  assert.ok(hrefs(html).every((h) => h.includes('x=2')), `${hrefs(html)}`);
  assert.ok(!html.includes(ICONS.shop), 'drew the shop mark for a URL that never asked');
  // %20 control: the space is escaped, so the override is real and the URL keeps its query
  const c = 'https://example.org/?q=one%20icon=shop';
  assert.equal(linkOf(c).url, c);
  assert.equal(linkOf(c).over, undefined);
  // several legal tokens
  const d = linkOf('https://example.org/x icon=shop iconhost=x.com');
  assert.equal(d.url, 'https://example.org/x');
  assert.deepEqual(d.over, { icon: 'shop', iconhost: 'x.com' });
  // an illegal host is not a token either
  assert.equal(linkOf('https://example.org/x iconhost=not_a_host').url, 'https://example.org/x iconhost=not_a_host');
});

test('🔴 a social line is ONE link, and the hint says what happens to a second (reef#2015)', async () => {
  // The grammar is one `[name](url)` per line (ai-ops.mjs's BLANKS note, and the hint's first words);
  // a second link on the same line is not read. That is the rule, not an accident — so the hint has
  // to say it, or the author of `[A](…) [B](…)` (specimen-rich does it) never learns why B is gone.
  const html = markup(card('- [ ] %% card: social w=6 %% [Instagram](https://instagram.com/x) [YouTube](https://www.youtube.com/@x)'));
  assert.equal(socialMarks(html).length, 1, 'the second link on a line was drawn — the hint below would be wrong');
  const { CELL_STRINGS_BY_KEY } = await import('../w/cell-i18n.mjs');
  const row = CELL_STRINGS_BY_KEY['type.social.body.hint'];
  const said = { zh: '第一個', ja: '最初', en: 'first', ko: '첫 번째', 'zh-Hans': '第一个', de: 'erste', fr: 'premier', es: 'primer', pt: 'primeiro' };
  for (const [loc, word] of Object.entries(said)) assert.ok(row[loc] && row[loc].includes(word), `${loc}: ${row[loc]}`);
});
