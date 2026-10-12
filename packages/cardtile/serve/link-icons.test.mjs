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
import { renderCardHTML } from './card-worker.mjs';

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
