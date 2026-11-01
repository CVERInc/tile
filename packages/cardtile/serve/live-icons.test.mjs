// Link marks are fetched live, in colour — never an automatic built-in brand SVG (reef#2026).
//
//   node --test packages/cardtile/serve/live-icons.test.mjs
//
// Design principle (reef#2026): an external site's mark is NOT kept on our side; it is fetched every
// time, so a rebrand follows by itself. Colour is the default; `icons: mono` is the author's switch.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { renderCardHTML } from './card-worker.mjs';
import { ICONS } from './card-assets.mjs';

const card = (...cells) => ['---', 'card-page: x', 'title: X', '---', '', '## grid', '', ...cells].join('\n') + '\n';
const full = (md) => renderCardHTML(md, { handle: 'x' });
const markup = (md) => full(md).replace(/<style>[\s\S]*?<\/style>/g, '');
const linkMark = (html) => /<div class="st-cell-head">(<svg[\s\S]*?<\/svg>|<img[^>]*>)/.exec(html)[1];

test('🔴 no automatic brand SVG: an instagram.com cell is a live <img src="/_icon/…">', () => {
  for (const url of ['https://instagram.com/x', 'https://www.instagram.com/x', 'https://threads.net/@x', 'https://www.threads.com/@x']) {
    const html = markup(card(`- [ ] %% card: link %% [L](${url})`));
    const m = linkMark(html);
    assert.match(m, /^<img[^>]*src="\/_icon\/[^"]+\.ico"/, `${url}: ${m.slice(0, 80)}`);
    assert.notEqual(m, ICONS.instagram);
    assert.notEqual(m, ICONS.threads);
  }
});

test('an explicitly named icon=instagram is still the built-in SVG', () => {
  assert.ok(ICONS.instagram && /^<svg/.test(ICONS.instagram), 'setup: no built-in Instagram mark');
  const html = markup(card('- [ ] %% card: link icon=instagram %% [L](https://example.com/x)',
    '- [ ] %% card: link icon=instagram %% [L](https://instagram.com/x)'));
  assert.equal([...html.matchAll(/<div class="st-cell-head">(<svg[\s\S]*?<\/svg>)/g)].filter((m) => m[1] === ICONS.instagram).length, 2);
});

test('🔴 /_icon asks DuckDuckGo, then Google (fixed addresses), then gives up', async () => {
  const real = globalThis.fetch;
  const run = async (domain, answer) => {
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return answer(String(url)); };
    try {
      const env = { PREVIEW: 'false', CARDS: { get: async () => null } };
      const res = await worker.fetch(new Request(`https://card.feelreef.com/_icon/${domain}.ico`), env);
      return { res, seen };
    } finally { globalThis.fetch = real; }
  };
  const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
  const none = () => new Response('', { status: 404 });
  const ddg = 'https://icons.duckduckgo.com/ip3/books.com.tw.ico';
  const google = 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://books.com.tw&size=64';

  const a = await run('books.com.tw', (u) => (u === ddg ? png() : none()));
  assert.deepEqual(a.seen, [ddg], 'DuckDuckGo had it: Google must not be asked');
  assert.equal(a.res.status, 200);

  const b = await run('books.com.tw', (u) => (u === google ? png() : none()));
  assert.deepEqual(b.seen, [ddg, google], 'order: DuckDuckGo first, then Google');
  assert.equal(b.res.status, 200);
  assert.equal(b.res.headers.get('content-type'), 'image/png');

  const c = await run('books.com.tw', none);
  assert.deepEqual(c.seen, [ddg, google]);
  assert.equal(c.res.status, 404, 'both 404 → 404, so the card walks to its own fallback');

  // a network error on the first is the same as a miss
  const d = await run('books.com.tw', (u) => { if (u === ddg) throw new Error('boom'); return png(); });
  assert.deepEqual(d.seen, [ddg, google]);
  assert.equal(d.res.status, 200);

  // never a creator-chosen address: a bad domain reaches no upstream at all
  const e = await run('127.0.0.1', png);
  assert.deepEqual(e.seen, []);
  assert.equal(e.res.status, 400);
  for (const u of [...a.seen, ...b.seen]) assert.match(u, /^https:\/\/(icons\.duckduckgo\.com|t1\.gstatic\.com)\//);
});

test('🔴 icons: mono spares the artwork thumbnail (.st-cell-icon-art)', () => {
  const css = [...full(card('- [ ] %% card: link %% [L](https://example.com/)')).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const mono = css.split('}').filter((r) => /st-card-marks-mono/.test(r) && /\.st-cell-icon-img/.test(r));
  assert.ok(mono.length >= 3, `setup: found ${mono.length} mono icon rules`);
  for (const rule of mono) {
    const sel = rule.slice(0, rule.indexOf('{')).replace(/@media[^{]*\{/, '');
    // every `.st-cell-icon-img` in a mono selector must exclude art — a selector that can match an
    // art <img> would grey the author's own picture
    for (const part of sel.split(',')) {
      if (!/\.st-cell-icon-img/.test(part)) continue;
      assert.match(part, /\.st-cell-icon-img:not\(\.st-cell-icon-art\)/, `can still match art: ${part}`);
    }
    assert.equal(sel.replace(/:not\(\.st-cell-icon-art\)/g, '').includes('.st-cell-icon-art'), false, sel);
  }
});
