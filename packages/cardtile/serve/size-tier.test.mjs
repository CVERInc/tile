// reef#3361 — the size tier of the cardtile worker's page view (serve/size-tier.mjs).
//
// Above ON_DEMAND_TILES tiles the page view is served in windows: the page is the first, `?w=<n>&r=<rev>`
// the n-th, each a whole page by the same renderer, with plain links to the windows on either side, and
// w3/deck.js fetches the next one when a visitor nears the end of what is loaded. What this holds:
//   - the count follows the board parser (fences, the archive rule, the settings block, lane kinds)
//   - every tile of a window is the tile the whole-file render draws, byte for byte, rich tiles included
//   - a reader with no script walks every window by the links, and meets every tile once, in order
//   - the head (title, lang, description, share image, icons) is the whole page's, wherever the
//     profile is and however long the frontmatter is
//   - the blank-template rule holds at any size
//   - the page and its windows carry one revision; a window asked for under another is redirected,
//     and deck.js takes no window of another revision
//   - at or below the line, the page is today's
//
//   node --test packages/cardtile/serve/size-tier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { renderCardHTML, resolveHandle } from './card-worker.mjs';
import * as tier from './size-tier.mjs';
import { cardKey, poolKey } from './card-api.mjs';
import { parseCard } from '../card-core.js';
import { isTemplateOnly } from '../card-blank.mjs';
import { BLANKS } from '../ai-ops.mjs';
import { makeWindow } from '../w3/mini-dom.mjs';
import { pieces, SAMPLE_SHA256 } from '../bench/every-number/sample.mjs';
import { createHash } from 'node:crypto';

const LINE = 5000;   // ON_DEMAND_TILES, written out: the r1 module exported it too, and this file must load against it
const DECK_JS = readFileSync(new URL('../w3/deck.js', import.meta.url), 'utf8');
const OWN = 'links.creator-example.test';   // a made-up vanity host: the one host a Card is indexable on in every switch position
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8Dwn4GBgYEJAA0EAf/2t0VtAAAAAElFTkSuQmCC';

// the tiles an author writes every day: a link, a picture (by address and from the file), a video, a
// tile with a back, a link into a back, slides, pasted HTML, a social row
const RICH = (tag) => [
  `- [ ] %% card: link w=2 %% [Visit shop ${tag}](https://shop.example.test/${tag})`,
  `- [ ] %% card: feature w=2 img=https://img.example.test/${tag}.jpg title=Photograph %%`,
  `- [ ] %% card: feature w=2 img=asset:sha256-bb href=https://pics.example.test/${tag} %%`,
  `- [ ] %% card: video w=2 yt=dQw4w9WgXcQ %% Film ${tag}`,
  `- [ ] %% card: text back=#more %% Turn over ${tag}`,
  `- [ ] %% card: link w=6 back=#second %% [Second ${tag}](https://second.example.test/${tag})`,
  `- [ ] %% card: text %% Read [the story](#story) ${tag}`,
  `- [ ] %% card: slides kind=slider w=6 images=https://img.example.test/s1.jpg,https://img.example.test/s2.jpg %%`,
  '- [ ] %% card: embed w=6 %%',
  `\t<p>Pasted <b>HTML</b> ${tag}</p>`,
  '- [ ] %% card: social w=6 %%',
  '\thttps://instagram.com/maple',
  '\tmailto:hello@example.test',
];
const RICH_COUNT = 11;

/** a rich Cards file of about `n` tiles: rich tiles at the top, in the middle and at the end, a labelled section, three backs, the pictures */
function richFile(n) {
  const filler = (from, k) => Array.from({ length: k }, (_, i) => `- [ ] %% card: text %% filler ${from + i}`);
  const third = Math.floor((n - 3 * RICH_COUNT - 1) / 3);
  return [
    '---', 'card-page: maple', 'title: Maple Lee', 'lang: de', 'accent: #b890e8', 'views: stack list wall', 'back: "#story"', '---', '', '## grid', '',
    '- [ ] %% card: profile w=6 avatar=asset:sha256-aa %% Making **things** by hand, [here](https://example.com).',
    ...RICH('top'), ...filler(0, third),
    '', '## English', '',
    ...RICH('middle'), ...filler(third, third),
    ...filler(2 * third, third), ...RICH('end'),
    '', '## back: more | More', '', '- [ ] %% card: link %% [Back link](https://back.example.test)', '- [ ] %% card: feature img=asset:sha256-bb %%',
    '', '## back: second', '', '- [ ] %% card: text %% The second back.',
    '', '## back: story | The story', '', '- [ ] %% card: text %% Once upon a time.',
    '', '## assets', '',
    `- [ ] %% card: asset id=sha256-aa mime=image/png %% ${PNG}`,
    `- [ ] %% card: asset id=sha256-aa.png mime=image/png %% ${PNG}`,
    `- [ ] %% card: asset id=sha256-bb mime=image/png %% ${PNG}`,
    `- [ ] %% card: asset id=sha256-bb mime=image/png %% ${PNG2}`,   // the same id twice: the later line is the picture (parseCard)
    '',
  ].join('\n');
}
const tilesIn = (md) => { const m = parseCard(md); return m.cells.length + m.drawers.reduce((n, d) => n + d.cells.length, 0); };

const envOf = (md, { pool, extra = {} } = {}) => {
  const kv = new Map([[cardKey('maple', '0'), md], [`vanity:${OWN}`, 'maple']]);
  if (pool) kv.set(poolKey('maple', '0'), pool);
  return { PREVIEW: 'false', ...extra, _kv: kv, CARDS: { get: async (k) => kv.get(k) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
};
const ask = (env, url, headers = {}) => worker.fetch(new Request(url, { redirect: 'manual', headers }), env, { waitUntil() {} });
const fetchOf = (md, { url = `https://${OWN}/`, headers = {}, pool, extra } = {}) => ask(envOf(md, { pool, extra }), url, headers);
const resolvedOwn = () => { const r = resolveHandle(OWN, '/', { [OWN]: 'maple' }); return { ...r, canonicalUrl: r.cardUrl, videos: {} }; };

const headOf = (html) => html.slice(0, html.indexOf('</head>'));
const rootTag = (html) => /<html[^>]*>/.exec(html)[0];
const unAmp = (s) => s.replace(/&amp;/g, '&');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nextOf = (html) => { const m = /<a rel="next" href="([^"]+)"/.exec(html); return m ? unAmp(m[1]) : null; };
const prevOf = (html) => { const m = /<a rel="prev" href="([^"]+)"/.exec(html); return m ? unAmp(m[1]) : null; };
const revOf = (html) => /<html[^>]* data-cardtile-rev="([^"]*)"/.exec(html)?.[1] ?? null;
/** a page without what only a window has: the revision on its root, the two <link>s in its head, the pager after its card */
const unwindowed = (html) => html.replace(/ data-cardtile-rev="[^"]*"/, '').replace(/<link rel="(prev|next)" href="[^"]*">/g, '').replace(/<nav class="st-pager">[\s\S]*?<\/nav>/, '');

/** the face tiles of a rendered page, in order, as markup; the backs' panels by id */
function partsOf(html) {
  const doc = makeWindow(html).document;
  const tiles = doc.querySelectorAll('main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell')
    .filter((c) => !c.closest('.dc-drawer')).map((c) => c.outerHTML);
  const backs = new Map(doc.querySelectorAll('.dc-drawer').map((d) => [d.id, d.outerHTML]));
  const labels = doc.querySelectorAll('main .st-grid-label').filter((c) => !c.closest('.dc-drawer')).map((c) => c.textContent);
  return { tiles, backs, labels };
}
/** every window of a page, by its rel=next links, as a reader with no script walks them */
async function walk(env, first) {
  const out = [];
  for (let url = first, guard = 0; url && guard < 2000; guard++) {
    const r = await ask(env, url.startsWith('http') ? url : `https://${OWN}${url}`);
    assert.equal(r.status, 200, `${url}: ${r.status} ${r.headers.get('location')}`);
    const html = await r.text();
    out.push({ url, html, res: r });
    url = nextOf(html);
  }
  return out;
}

// ── the count follows the board parser ───────────────────────────────────────────────────────────
// Each file is a shape the board parser reads differently from a line scan. scanCard's count must be
// parseCard's, and the windows cut from its index, read back to back, must be parseCard's cells.
const T = (s) => `- [ ] %% card: text %% ${s}`;
const SHAPES = {
  'a fenced assets heading': ['## grid', '', '```', '## assets', '```', T('a'), T('b'), ''],
  'fenced tile lines': ['## grid', '', T('a'), '```', '- [ ] fake', '- [x] fake too', '```', T('b'), ''],
  'a tilde fence': ['## grid', '', T('a'), '~~~', '## not a lane', '~~~', T('b'), ''],
  'the archive rule': ['## grid', '', T('a'), '', '***', '', '## done', '', T('archived'), ''],
  'a rule with no lane after it': ['## grid', '', T('a'), '***', 'words', T('b'), ''],
  'a rule before the first lane': ['***', '## grid', '', T('a'), ''],
  'a fenced rule': ['## grid', '', '```', '***', '```', '## next', T('a'), ''],
  'the settings block': ['## grid', '', T('a'), '', '%% kanban:settings', '```', '{}', '```', T('after'), ''],
  'the settings block in a fence': ['## grid', '', T('a'), '```', '%% tugtile:settings', '```', T('b'), ''],
  'the settings block in the frontmatter': ['---', '%% kanban:settings', '---', '## grid', T('a'), ''],
  'frontmatter never closed': ['---', 'title: x', '## grid', '', T('a'), ''],
  'frontmatter closed late': ['---', 'title: x', '## grid', T('in front'), '---', '## real', T('a'), ''],
  'tiles before the first lane': [T('nowhere'), '## grid', T('a'), ''],
  'checked, unmarked, odd boxes': ['## grid', '- [x] done', '- [ ] plain words', '- [ ] not a tile', '- [😀] not a tile', '- [] no', '-  [ ] no', T('a'), ''],
  'headings that are not': ['## grid', '##not a lane', '\t## in a body', ' ## indented', T('a'), '## ', T('b'), ''],
  'an open fence inside a tile': ['## grid', T('a'), '\tbody', '```', '- [ ] inside the fence', '## inside the fence', '```', T('b'), ''],
  'a fence that never closes': ['## grid', T('a'), '```', T('swallowed'), '## swallowed'],
  'lanes of every kind': ['---', 'title: x', '---', 'lead words', '## grid', 'lane lead', T('a'), '## back: one | One', T('b1'), '## drawer: two', T('b2'),
    '## English', T('c'), '## assets', `- [ ] %% card: asset id=x mime=image/png %% ${PNG}`, '- [ ] %% card: asset %% no id', T('not an asset'), '## Assets', `- [ ] %% card: asset id=x mime=image/png %% ${PNG2}`, '## empty', '## Last', T('d'), ''],
};
const flavours = (lines) => ({ LF: lines.join('\n'), CRLF: lines.join('\r\n'), CR: lines.join('\r'), 'no final newline': lines.join('\n').replace(/\n+$/, '') });

test('scanCard counts the tiles parseCard reads, in every shape the board parser reads differently from a line scan', () => {
  for (const [name, lines] of Object.entries(SHAPES)) {
    for (const [fl, md] of Object.entries(flavours(lines))) {
      const m = parseCard(md);
      const idx = tier.scanCard(md);
      assert.equal(idx.face, m.cells.length, `${name} (${fl}): face tiles`);
      assert.equal(idx.back, m.drawers.reduce((n, d) => n + d.cells.length, 0), `${name} (${fl}): back tiles`);
      // the windows, at every size from one tile up, read back to back: parseCard's cells, block labels included
      for (const size of [1, 2, 3, 1000]) {
        const plan = tier.windowsOf(md, idx, { tiles: size });
        const cells = [];
        for (let w = 0; w < plan.count; w++) cells.push(...tier.windowOf(md, idx, plan, w).cells);
        assert.equal(JSON.stringify(cells), JSON.stringify(m.cells), `${name} (${fl}): windows of ${size}`);
      }
      // the pictures, one line at a time: parseCard's map, a later line of one id winning
      assert.equal(JSON.stringify(tier.allAssets(md, idx)), JSON.stringify(m.assets), `${name} (${fl}): pictures`);
    }
  }
});

test('the tier is decided by the parsed count: a fenced assets heading does not hide 5,001 tiles, and fenced fake tiles do not add to 5,000', async () => {
  const real = (n) => Array.from({ length: n }, (_, i) => T(`t${i}`));
  const fenced = (n) => ['## grid', '', '```', '## assets', '- [ ] fake', '- [ ] fake', '```', ...real(n), ''].join('\n');
  for (const n of [4999, 5000, 5001]) {
    const md = fenced(n);
    assert.equal(parseCard(md).cells.length, n, 'CONTROL: the board parser reads n tiles');
    const page = await (await fetchOf(md)).text();
    if (n <= LINE) assert.equal(page, renderCardHTML(md, resolvedOwn()), `${n}: at or below the line the page is not the whole render of the file`);
    else assert.ok(revOf(page) && !page.includes(`t${n - 1}<`), `${n}: past the line the page is not served in windows`);
  }
  // the reviewer's reproducer: `## grid`, a fence holding `## assets`, then 5,001 tiles
  const repro = ['## grid', '', '```', '## assets', '```', ...real(5001), ''].join('\n');
  assert.ok(revOf(await (await fetchOf(repro)).text()), 'the fenced heading hid the tiles from the tier');
  // a query naming a window means nothing to a page below the line
  const small = fenced(10);
  assert.equal(await (await fetchOf(small, { url: `https://${OWN}/?w=2&r=abc` })).text(), renderCardHTML(small, resolvedOwn()));
});

// ── what a window draws ──────────────────────────────────────────────────────────────────────────
test('every tile of every window is the tile the whole-file render draws, byte for byte — rich tiles in the first window and the last', async () => {
  const md = richFile(6200);
  assert.ok(tilesIn(md) > LINE, 'CONTROL: past the line');
  const full = partsOf(renderCardHTML(md, resolvedOwn()));
  assert.ok(full.tiles.length > 6000, 'CONTROL: the whole render draws the tiles');
  const env = envOf(md);
  const windows = await walk(env, `https://${OWN}/`);
  assert.ok(windows.length >= 7, `CONTROL: ${windows.length} windows`);
  const seen = [];
  for (const [k, w] of windows.entries()) {
    const p = partsOf(w.html);
    seen.push(...p.tiles);
    // each back a window's tiles turn over to is in that window, and is the whole page's back
    const named = new Set([...w.html.matchAll(/data-drawer="([^"]+)"/g)].map((m) => m[1]));
    for (const id of named) assert.equal(p.backs.get(id), full.backs.get(id), `window ${k + 1}: the back #${id}`);
    // the default back (frontmatter `back: "#story"`) is in every window: deck.js gives it to every tile without one
    assert.equal(p.backs.get('story'), full.backs.get('story'), `window ${k + 1}: the default back`);
  }
  assert.equal(seen.length, full.tiles.length, 'the windows do not hold every tile once');
  for (let i = 0; i < seen.length; i++) if (seen[i] !== full.tiles[i]) assert.equal(seen[i], full.tiles[i], `tile ${i}`);
  // the labelled section is labelled once, where it starts
  assert.deepEqual(windows.flatMap((w) => partsOf(w.html).labels), full.labels);
  // the reviewer's reading, by name: a navigable link, a picture, a play control, a back that opens with a link on it
  for (const [k, w] of [[0, windows[0]], [windows.length - 1, windows.at(-1)]]) {
    const tag = k === 0 ? 'top' : 'end';
    assert.match(w.html, new RegExp(`<a [^>]*href="${reEsc(`https://shop.example.test/${tag}`)}"`), `window ${k + 1}: the shop link`);
    assert.match(w.html, new RegExp(`<img [^>]*src="${reEsc(`https://img.example.test/${tag}.jpg`)}"`), `window ${k + 1}: the picture`);
    assert.match(w.html, /src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAC/, `window ${k + 1}: the picture from the file (the later line of its id)`);
    assert.match(w.html, /class="st-embed-video-btn"/, `window ${k + 1}: the play control`);
    assert.match(w.html, /<script>\(function\(\)\{document\.addEventListener\('click',function\(e\)\{\nvar b=e\.target\.closest&&e\.target\.closest\('\.st-embed-video-btn'\)/, `window ${k + 1}: the video script`);
    assert.match(w.html, /<div class="dc-drawer" id="more"[\s\S]*?href="https:\/\/back\.example\.test"/, `window ${k + 1}: the back with its link`);
  }
});

test('a reader with no script walks Cards of 20,000 tiles window by window, and meets every tile once, in order', async () => {
  const n = 20000;
  const md = ['---', 'title: Long', '---', '', '## grid', '', ...Array.from({ length: n }, (_, i) => T(`n${i}`)), ''].join('\n');
  const env = envOf(md);
  const windows = await walk(env, `https://${OWN}/`);
  assert.equal(windows.length, Math.ceil(n / 1000), 'windows of a thousand tiles');
  const texts = windows.flatMap((w) => [...w.html.matchAll(/<p>(n\d+)<\/p>/g)].map((m) => m[1]));
  assert.equal(texts.length, n);
  assert.ok(texts.every((t, i) => t === `n${i}`), 'a tile is missing, repeated or out of order');
  const rev = revOf(windows[0].html);
  for (const [k, w] of windows.entries()) {
    assert.match(w.html, /^<!doctype html><html[\s\S]*<\/body><\/html>$/, `window ${k + 1} is not a whole page`);
    assert.equal(revOf(w.html), rev, `window ${k + 1}: another revision`);
    assert.equal(prevOf(w.html), k === 0 ? null : windows[k - 1].url.replace(`https://${OWN}`, ''), `window ${k + 1}: its previous link`);
    assert.equal(/<link rel="next" href="([^"]*)">/.exec(w.html)?.[1] ?? null, k === windows.length - 1 ? null : /<a rel="next" href="([^"]+)"/.exec(w.html)[1], `window ${k + 1}: its <link rel=next>`);
    assert.match(w.html, /<title>Long<\/title>/);
    assert.equal(w.res.headers.get('cache-control'), 'public, max-age=60');
  }
  assert.equal(windows[1].url, `/?w=2&r=${rev}`);
});

// ── the head is the whole page's ─────────────────────────────────────────────────────────────────
test('the head of every window is the whole page\'s: a profile far down the file, and a frontmatter longer than 64 KiB', async () => {
  const filler = Array.from({ length: 5001 }, (_, i) => T(`${'x'.repeat(15)} ${i}`));
  const late = ['---', 'card-page: maple', 'title: Late Profile', 'lang: ja', '---', '', '## grid', '', ...filler,
    '- [ ] %% card: profile avatar=asset:sha256-aa %% LATE UNIQUE TAGLINE', '', '## assets', '',
    `- [ ] %% card: asset id=sha256-aa mime=image/png %% ${PNG}`, `- [ ] %% card: asset id=sha256-aa.png mime=image/png %% ${PNG}`, ''].join('\n');
  assert.ok(late.indexOf('LATE UNIQUE TAGLINE') > 65536, 'CONTROL: the profile is past the first 64 KiB');
  const longFront = ['---', 'title: Long Front', 'lang: ko', `note: ${'y'.repeat(70000)}`, 'theme: light', '---', '', '## grid', '',
    '- [ ] %% card: profile %% A short tagline.', ...filler, ''].join('\n');
  assert.ok(longFront.indexOf('\n---\n', 4) > 65536, 'CONTROL: the frontmatter is longer than 64 KiB');
  // a frontmatter key read from the first line anywhere that starts with it, as the whole page reads it
  const anywhere = ['## grid', '', '- [ ] %% card: profile %% Hi.', '- [ ] %% card: text %% words', 'title: Written In A Body', ...filler, ''].join('\n');
  for (const [name, md] of [['late profile', late], ['long frontmatter', longFront], ['a key in a body', anywhere]]) {
    const full = renderCardHTML(md, resolvedOwn());
    const windows = await walk(envOf(md), `https://${OWN}/`);
    assert.ok(windows.length >= 2, `CONTROL ${name}: served in windows`);
    for (const [k, w] of windows.entries()) {
      assert.equal(unwindowed(headOf(w.html)), headOf(full), `${name}, window ${k + 1}: the head differs from the whole page's`);
    }
  }
  const one = await (await fetchOf(late)).text();
  assert.match(one, /<meta name="description" content="LATE UNIQUE TAGLINE">/);
  assert.match(one, /<meta property="og:image" content="https:\/\/links\.creator-example\.test\/apple-touch-icon\.png">/);
  assert.match(rootTag(one), /lang="ja"/);
  const two = await (await fetchOf(longFront)).text();
  assert.match(two, /<title>Long Front<\/title>/);
  assert.match(rootTag(two), /lang="ko" data-theme="light"/);
});

test('above the line the icons and the avatar are the ones the whole file gives, the profile far down the file', async () => {
  const filler = Array.from({ length: 5001 }, (_, i) => T(`f${i}`));
  const tail = ['- [ ] %% card: profile avatar=asset:sha256-aa %% Far down.', '', '## assets', '',
    `- [ ] %% card: asset id=sha256-aa mime=image/png %% ${PNG2}`, `- [ ] %% card: asset id=sha256-aa.png mime=image/png %% ${PNG2}`, ''];
  const md = ['---', 'title: Icons', 'accent: #336699', '---', '', '## grid', '', ...filler, ...tail].join('\n');
  const small = ['---', 'title: Icons', 'accent: #336699', '---', '', '## grid', '', ...tail].join('\n');
  for (const p of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/avatar']) {
    const r = await fetchOf(md, { url: `https://${OWN}${p}` });
    const s = await fetchOf(small, { url: `https://${OWN}${p}` });   // the same head, below the tier: the full parse
    assert.equal(r.status, s.status, p);
    assert.equal(r.headers.get('content-type'), s.headers.get('content-type'), p);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(await s.arrayBuffer()), p);
  }
});

// ── the blank-template rule at any size ──────────────────────────────────────────────────────────
test('a file that is still only the blank template is noindex at 5,001 tiles as at 5,000, on every exit', async () => {
  const ON = { CARD_CANONICAL_HOST: 'reef.cards' };
  const blankOf = (n, more = []) => ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
    ...Array.from({ length: n }, (_, i) => (i % 2 ? `- [ ] %% card: ${BLANKS.text.type} %% ${BLANKS.text.body}` : `- [ ] %% card: link w=2 %% ${BLANKS.link.body}`)), ...more, ''].join('\n');
  const robots = async (md, url, headers = {}) => (await fetchOf(md, { url, headers, extra: ON })).headers.get('x-robots-tag');
  const at = blankOf(LINE), over = blankOf(LINE + 1);
  assert.equal(isTemplateOnly(over), true, 'CONTROL: the file is the blank template');
  assert.equal(await robots(at, 'https://reef.cards/maple'), 'noindex', 'CONTROL: at the line a blank file is noindex');
  const rev = revOf(await (await fetchOf(over, { url: 'https://reef.cards/maple', extra: ON })).text());
  for (const [name, url, headers] of [['page', 'https://reef.cards/maple', {}], ['a window', `https://reef.cards/maple?w=2&r=${rev}`, {}],
    ['thin markdown', 'https://reef.cards/maple', { accept: 'text/markdown' }], ['download', 'https://reef.cards/maple.md', {}], ['icon', 'https://reef.cards/maple/favicon.svg', {}]]) {
    assert.equal(await robots(over, url, headers), 'noindex', `${name}: a blank file past the line is indexable`);
  }
  // one authored tile, anywhere — the last one here — and it is the author's page again
  assert.equal(await robots(blankOf(LINE + 1, [T('I wrote this.')]), 'https://reef.cards/maple'), null);
});

test('blankAbove gives isTemplateOnly\'s answer, in every way a file stops being the blank template', () => {
  const tpl = (n) => Array.from({ length: n }, () => `- [ ] %% card: ${BLANKS.text.type} %% ${BLANKS.text.body}`);
  const base = (extra = [], pre = []) => ['---', 'title: x', '---', ...pre, '## grid', '', ...tpl(6), ...extra, ''].join('\n');
  const cases = {
    blank: base(),
    'an authored tile': base([T('mine')]),
    'a back': base(['## back: about', T('b')]),
    'an empty back': base(['## back: about']),
    'a picture': base(['## assets', `- [ ] %% card: asset id=a mime=image/png %% ${PNG}`]),
    'an assets lane with no picture': base(['## assets', '- [ ] %% card: asset %% none']),
    'a section label': base(['## Shop', ...tpl(1)]),
    'an empty labelled lane': base(['## Shop']),
    'a blank second lane': base(['##  ', ...tpl(1)]),
    'prose before the lanes': base([], ['Hello there.']),
    'the settings block': base(['%% kanban:settings', '```', '{}', '```']),
    'the archive': base(['***', '', '## done', T('old')]),
    'a width': base(['- [ ] %% card: text w=3 %% ' + BLANKS.text.body]),
    'a param an author set': base(['- [ ] %% card: text sub=x %% ' + BLANKS.text.body]),
  };
  for (const [name, md] of Object.entries(cases)) {
    for (const [fl, m] of Object.entries(flavours(md.split('\n')))) {
      assert.equal(tier.blankAbove(m, tier.scanCard(m)), isTemplateOnly(m), `${name} (${fl})`);
    }
  }
});

// ── one revision ─────────────────────────────────────────────────────────────────────────────────
test('the page and its windows carry one revision; a window asked for under another is sent to the current one', async () => {
  const md = richFile(6200);
  const env = envOf(md);
  const page = await (await ask(env, `https://${OWN}/`)).text();
  const rev = revOf(page);
  assert.match(rev, /^[0-9a-f]{16}$/);
  assert.equal(nextOf(page), `/?w=2&r=${rev}`);
  const w2 = await ask(env, `https://${OWN}/?w=2&r=${rev}`);
  assert.equal(w2.status, 200);
  assert.equal(revOf(await w2.text()), rev);
  // the same file is the same revision; one character more is another
  assert.equal(revOf(await (await fetchOf(md)).text()), rev);
  env._kv.set(cardKey('maple', '0'), md.replace('filler 10<', 'filler 10!<').replace('filler 10\n', 'filler 10!\n'));
  const now = revOf(await (await ask(env, `https://${OWN}/`)).text());
  assert.ok(now && now !== rev, 'an edit did not change the revision');
  const stale = await ask(env, `https://${OWN}/?w=2&r=${rev}`);
  assert.equal(stale.status, 302, 'a window of the old revision was served');
  assert.equal(stale.headers.get('location'), `https://${OWN}/?w=2&r=${now}`);
  const gone = await ask(env, `https://${OWN}/?w=900&r=${now}`);
  assert.equal(gone.status, 302);
  assert.equal(gone.headers.get('location'), `https://${OWN}/`);
  // a window named without a revision is the current one's (the address a search engine keeps)
  const bare = await ask(env, `https://${OWN}/?w=2`);
  assert.equal(bare.status, 200);
  assert.equal(revOf(await bare.text()), now);
  // on the shared host the windows are the handle's own path
  const shared = await (await fetchOf(md, { url: 'https://card.feelreef.com/maple' })).text();
  assert.equal(nextOf(shared), `/maple?w=2&r=${rev}`);
});

test('the pager links only to paths on this host: a scheme or another host is no link', () => {
  const md = ['## grid', '', T('a'), ''].join('\n');
  const html = renderCardHTML(md, { ...resolvedOwn(), pager: { rev: 'abc', prev: '//evil.example.test/x', next: 'javascript:alert(1)' } });
  assert.ok(!/rel="(prev|next)"/.test(html), 'a link that is not a path on this host was written');
  assert.match(rootTag(html), / data-cardtile-rev="abc"/);
  const ok = renderCardHTML(md, { ...resolvedOwn(), pager: { rev: 'abc', prev: '/maple', next: '/maple?w=3&r=abc' } });
  assert.match(ok, /<a rel="prev" href="\/maple">Previous page<\/a><a rel="next" href="\/maple\?w=3&amp;r=abc">Next page<\/a>/);
  // no pager: the page as it was
  assert.equal(renderCardHTML(md, { ...resolvedOwn(), pager: undefined }), renderCardHTML(md, resolvedOwn()));
});

test('the platform\'s closing reef.cards tile is drawn once, in the last window; the footer link in every one', async () => {
  const md = richFile(6200);
  const windows = await walk(envOf(md, { pool: 'in' }), `https://${OWN}/`);
  assert.ok(windows.length >= 2, `CONTROL: ${windows.length} windows`);
  const closing = windows.map((w) => (w.html.match(/<section class="st-grid st-pool"/g) || []).length);
  assert.deepEqual(closing, [...Array(windows.length - 1).fill(0), 1]);
  for (const w of windows) assert.match(w.html, /<footer class="st-footer">[\s\S]*?href="https:\/\/reef\.cards\/\?ref=maple"/);
});

// ── deck.js over the windows ─────────────────────────────────────────────────────────────────────
// a fetch here is the worker answering in-process; its revision hash (crypto.subtle) finishes on the thread pool, so
// a wait for something to happen polls until it has (at most 10 s), and a check that nothing happened waits as long
// as a fetch that did happen took (flush after a positive wait in the same test)
const flush = async (k = 60) => { for (let i = 0; i < k; i++) await new Promise((r) => setImmediate(r)); };
const until = async (cond, ms = 10000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); };
/** the page the worker serves, then deck.js over it, with the browser's fetch answered by the same worker (redirects followed) */
async function openDeck(env, { url = `https://${OWN}/`, storage, rectOf } = {}) {
  const html = await (await ask(env, url)).text();
  const win = makeWindow(html, { scripts: true, url, storage });
  const doc = win.document;
  const errors = [], warned = [];
  win.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ')), warn: (...a) => warned.push(a.map(String).join(' ')) };
  doc.scrollHeightOf = () => win.innerHeight * 10;
  doc.rectOf = rectOf || (() => ({ top: 0, left: 0, width: 342, height: 480, bottom: 480, right: 342 }));
  const asked = [];
  win.fetch = async (u) => {
    let to = new URL(u, url);
    asked.push(to.pathname + to.search);
    let r = await ask(env, to.href);
    for (let k = 0; k < 5 && (r.status === 301 || r.status === 302); k++) { to = new URL(r.headers.get('location'), to); r = await ask(env, to.href); }
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
  win.run(DECK_JS, 'deck.js');
  win.tick(3000);
  return { win, doc, errors, warned, asked, html };
}
const faceTiles = (doc) => doc.querySelectorAll('main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell, .deck-front > .st-cell').filter((c) => !c.closest('.dc-drawer'));

test('deck.js, stack: nearing the last loaded tile fetches the next window, and its tiles are dealt next', async () => {
  const md = ['---', 'title: Long', 'views: stack list wall', '---', '', '## grid', '', ...Array.from({ length: 6000 }, (_, i) => T(`n${i}`)), ''].join('\n');
  const env = envOf(md);
  const { win, doc, errors, asked } = await openDeck(env, { storage: { 'reef-card-layout': 'deck' } });
  assert.deepEqual(errors, []);
  assert.equal(win.__deckBoot, 'ready');
  const before = win.__deckCount();
  assert.equal(before, 1000, 'CONTROL: the first window is a thousand tiles');
  assert.deepEqual(asked, [], 'a window was fetched before the visitor went anywhere');
  win.__deckJump(before - 10); win.tick(100); await until(() => win.__deckCount() > before); win.tick(100);
  assert.equal(asked.length, 1, 'nearing the end did not fetch the next window');
  assert.match(asked[0], /^\/\?w=2&r=[0-9a-f]{16}$/);
  assert.equal(win.__deckCount(), 2000, 'the next window\'s tiles were not dealt');
  win.__deckJump(1000); win.tick(100);
  const top = doc.querySelector('.deck-stack > .deck-card.is-top');
  assert.equal(top && top.querySelector('.deck-front').textContent.trim(), 'n1000', 'what comes after the first window is not the next tile');
  assert.equal(doc.querySelector('main > .st-pager a[rel="next"]').getAttribute('href').replace(/&r=.*/, ''), '/?w=3');
  assert.deepEqual(errors, []);
});

test('deck.js, wall: the pager coming near fetches the next window, and its tiles are drawn after the ones in place', async () => {
  const md = ['---', 'title: Long', 'view: wall', '---', '', '## grid', '', ...Array.from({ length: 6000 }, (_, i) => T(`n${i}`)), ''].join('\n');
  const env = envOf(md);
  let pagerTop = 10000;   // where the pager is: far below at first
  const rectOf = (el) => (el.classList && el.classList.contains('st-pager') ? { top: pagerTop, bottom: pagerTop + 20, left: 0, right: 0, width: 0, height: 20 } : { top: 0, left: 0, width: 342, height: 480 });
  const { win, doc, errors, asked } = await openDeck(env, { rectOf });
  assert.equal(doc.documentElement.dataset.view, 'wall', 'CONTROL: the wall');
  assert.deepEqual(errors, []);
  const before = faceTiles(doc).length;
  assert.equal(before, 1000);
  // the pager more than three screens away: nothing; within them: the next window
  pagerTop = win.innerHeight * 3 + 10;
  win.dispatchEvent(new win.Event('scroll')); await flush();
  assert.deepEqual(asked, [], 'a window was fetched with the pager three screens away');
  pagerTop = win.innerHeight;
  win.dispatchEvent(new win.Event('scroll')); await until(() => faceTiles(doc).length >= 2000);
  assert.ok(asked.length >= 1, 'the pager came near and nothing was fetched');
  const tiles = faceTiles(doc);
  assert.ok(tiles.length >= 2000, `the next window's tiles are not on the wall (${tiles.length})`);
  assert.equal(tiles[1000].textContent.trim(), 'n1000');
  assert.equal(doc.querySelectorAll('main > .st-card > style').length, 1, 'a window\'s copy of the grid stylesheet came along');
  // …and the pile, entered now, deals them all
  win.__deckView('stack'); win.tick(100);
  assert.ok(win.__deckCount() >= 2000);
  assert.deepEqual(errors, []);
});

test('deck.js takes no window of another revision: the Cards changed after the page was served', async () => {
  const md = ['---', 'title: Long', '---', '', '## grid', '', ...Array.from({ length: 6000 }, (_, i) => T(`n${i}`)), ''].join('\n');
  const env = envOf(md);
  const { win, doc, errors, warned, asked } = await openDeck(env, { storage: { 'reef-card-layout': 'deck' } });
  const next = doc.querySelector('main > .st-pager a[rel="next"]').getAttribute('href');
  env._kv.set(cardKey('maple', '0'), md.replace('n5999', 'changed'));
  win.__deckJump(995); win.tick(100); await until(() => warned.length > 0); win.tick(100);
  assert.equal(asked.length, 1, 'CONTROL: the next window was asked for');
  assert.equal(win.__deckCount(), 1000, 'a window of another revision joined the pile');
  assert.equal(faceTiles(doc).length, 1000);
  assert.equal(doc.querySelector('main > .st-pager a[rel="next"]').getAttribute('href'), next, 'the pager\'s link was moved on');
  assert.ok(warned.some((w) => /changed since this page was served/.test(w)), warned.join('\n'));
  win.__deckJump(999); win.tick(100); await flush();
  assert.equal(asked.length, 1, 'it asked again');
  assert.deepEqual(errors, []);
});

test('deck.js: a window\'s backs and its video script join the page; a back already there is not drawn twice', async () => {
  const md = richFile(6200);
  const env = envOf(md);
  const { win, doc, errors } = await openDeck(env, { storage: { 'reef-card-layout': 'deck' } });
  assert.deepEqual(errors, []);
  const n = win.__deckCount();
  win.__deckJump(n - 5); win.tick(100); await until(() => win.__deckCount() > n); win.tick(100);
  assert.ok(win.__deckCount() > n, 'CONTROL: the next window joined');
  for (const id of ['more', 'second', 'story']) assert.equal(doc.querySelectorAll('.dc-drawer').filter((d) => d.id === id).length, 1, `#${id}`);
  assert.equal(doc.querySelectorAll('script').filter((s) => /st-embed-video-btn/.test(s.textContent) && !/__deck/.test(s.textContent)).length, 1, 'the video script');
  assert.deepEqual(errors, []);
});

// ── the real sample ──────────────────────────────────────────────────────────────────────────────
test('the real sample (834,151 tiles, 25 MiB): the page and its last window, each a thousand tiles of the file', async () => {
  const md = [...pieces()].join('');
  assert.equal(createHash('sha256').update(md).digest('hex'), SAMPLE_SHA256, 'CONTROL: the sample is the prototype\'s file');
  const env = envOf(md);
  const page = await (await ask(env, `https://${OWN}/`)).text();
  const rev = revOf(page);
  assert.ok(rev, 'the sample is not served in windows');
  assert.ok(page.length < 1024 * 1024, `the first window is ${page.length} characters`);
  // the sample's tiles turn over to backs, and a window counts the backs it carries: its own plan says how many windows there are
  const last = tier.windowsOf(md, tier.scanCard(md), { front: tier.deckFront(md) }).count;
  assert.ok(last >= Math.ceil(834151 / 1000), `CONTROL: ${last} windows`);
  const r = await ask(env, `https://${OWN}/?w=${last}&r=${rev}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.equal(nextOf(html), null, 'the last window names a next one');
  assert.equal(prevOf(html), `/?w=${last - 1}&r=${rev}`);
  const m = parseCard(md);
  const want = m.cells.at(-1).body;
  assert.ok(html.includes(`>${want}<`), 'the last tile of the file is not in the last window');
  assert.equal((await ask(env, `https://${OWN}/?w=${last + 1}&r=${rev}`)).status, 302);
});
