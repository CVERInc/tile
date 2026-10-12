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

test('🔴 a brand we draw is drawn — Instagram and Threads never reach the favicon service', () => {
  // DuckDuckGo answers 404 for instagram.com, threads.net and threads.com. A mark we ship cannot 404,
  // and the link row and the social row take it from the SAME table, so they cannot disagree.
  assert.ok(ICONS.threads && /^<svg/.test(ICONS.threads), 'there is no drawn Threads mark to use');
  for (const [url, name] of [['https://instagram.com/someone', 'instagram'], ['https://www.instagram.com/someone', 'instagram'],
    ['https://www.threads.net/@someone', 'threads'], ['https://www.threads.com/@someone', 'threads']]) {
    const html = markup(card(`- [ ] %% card: link %% [L](${url})`, `- [ ] %% card: social w=6 %% [S](${url})`));
    assert.equal(linkMark(html), ICONS[name], `link to ${url} is not the drawn ${name}`);
    assert.deepEqual(socialMarks(html), [ICONS[name]], `social mark for ${url} is not the drawn ${name}`);
    assert.ok(!/_icon\/[^"]*(instagram|threads)/.test(html), `${url} still asks the favicon service`);
  }
  // a drawn mark cannot fail, so it carries no broken-image fallback glyph either
  const soc = markup(card('- [ ] %% card: social w=6 %% [IG](https://instagram.com/x)'));
  assert.ok(!/st-social-bare/.test(soc), 'a drawn mark got the dead fallback glyph');
  // 🔴 and it is SIZED in a 40px circle: the drawn marks carry no width/height of their own, and an
  // unsized inline <svg> lays out at 300×150.
  const css = renderCardHTML(card('- [ ] %% card: social w=6 %% [IG](https://instagram.com/x)'), { handle: 'x' });
  assert.match(css, /\.st-social-btn \.st-cell-icon\{width:20px;height:20px/);
});

test('🔴 the drawn mark is for the LISTED hosts only: an unlisted subdomain or a look-alike is fetched', () => {
  // The table names exact hosts. `siteOf()` once reduced foo.instagram.com to instagram.com, so any
  // subdomain borrowed the brand's drawn mark — which is a claim about a host we never measured.
  for (const url of ['https://foo.instagram.com/x', 'https://notinstagram.com/x', 'https://instagram.com.evil.tld/x',
    'https://foo.threads.net/x']) {
    const html = markup(card(`- [ ] %% card: link %% [L](${url})`, `- [ ] %% card: social w=6 %% [S](${url})`));
    assert.match(linkMark(html), /^<img/, `link to ${url} drew a built-in mark`);
    assert.ok(socialMarks(html).every((m) => /^<img/.test(m)), `social mark for ${url} drew a built-in mark`);
  }
});

test('the author still outranks the table: icon= and iconhost= on a link are obeyed', () => {
  const html = markup(card('- [ ] %% card: link iconhost=webtoons.com %% [IG](https://instagram.com/x)',
    '- [ ] %% card: link icon=shop %% [IG](https://instagram.com/x)'));
  assert.match(html, /_icon\/webtoons\.com\.ico/, 'an explicit iconhost lost to the brand table');
  assert.ok(html.includes(ICONS.shop), 'an explicit icon= lost to the brand table');
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

test('🔴 an upstream 404 is cached for an hour, not a week; a mark for a week', async () => {
  // `cf.cacheTtl` is "cache this for N seconds regardless of what the response says" — it is the Edge
  // Cache TTL override, and Cloudflare's edge caches a 404 like any other cacheable status. So one
  // bad answer from the favicon service locked a domain's mark out for seven days (books.com.tw:
  // the service answered 200, our route kept answering 404). `cacheTtlByStatus` gives each class
  // its own TTL. The upstream here is a fake; what is under test is what we ASK the edge to keep.
  const seen = [];
  const real = globalThis.fetch;
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
    assert.equal(seen.length, 2, 'setup: the route did not reach the upstream');
    for (const { url, cf } of seen) {
      assert.ok(cf, `${url}: no cf options at all`);
      assert.equal(cf.cacheTtl, undefined, `${url}: cacheTtl applies to EVERY status, 404 included`);
      assert.deepEqual(cf.cacheTtlByStatus, { '200-299': 604800, 404: 3600, '500-599': 0 });
    }
  } finally { globalThis.fetch = real; }
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
