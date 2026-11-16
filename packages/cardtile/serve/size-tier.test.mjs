// reef#3361 — the size tier of the cardtile worker's page view (serve/size-tier.mjs).
//
// Above ON_DEMAND_TILES tiles the page view serves a shell made from the head of the file and names
// the file in `data-card-src`; w3/deck.js reads it in the visitor's browser. At or below, the page is
// today's. What this holds:
//   - where the line is: ON_DEMAND_TILES tiles is today's page, one more is the shell
//   - the shell carries what the full page's head carries (title, lang, canonical, share tags, icons,
//     the exchange link-back) without the file being parsed for it
//   - no exit asks the blank rule above the tier (it parses the whole file)
//   - deck.js deals the real 25 MiB sample from the address the shell names
//
//   node --test packages/cardtile/serve/size-tier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { renderCardHTML, resolveHandle } from './card-worker.mjs';
import { tilesAbove, shellSource, withCardSrc, ON_DEMAND_TILES, HEAD_UNITS } from './size-tier.mjs';
import { cardKey, poolKey } from './card-api.mjs';
import { BLANKS } from '../ai-ops.mjs';
import { makeWindow } from '../w3/mini-dom.mjs';
import { pieces, SAMPLE_SHA256 } from '../bench/every-number/sample.mjs';
import { createHash } from 'node:crypto';

const DECK_JS = readFileSync(new URL('../w3/deck.js', import.meta.url), 'utf8');
const OWN = 'links.creator-example.test';   // a made-up vanity host: the one host a Card is indexable on in every switch position
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** a Cards file of `n` tiles: frontmatter, a profile with a picture, n−2 text tiles, one back with one tile, the pictures */
const fileOf = (n, { profile = true } = {}) => [
  '---', 'card-page: maple', 'title: Maple Lee', 'lang: de', 'accent: #b890e8', 'views: stack wall', '---', '', '## grid', '',
  ...(profile ? ['- [ ] %% card: profile w=6 avatar=asset:sha256-aa %% Making **things** by hand, [here](https://example.com).'] : ['- [ ] %% card: text %% tile -1']),
  ...Array.from({ length: n - 2 }, (_, i) => `- [ ] %% card: text${i === 3 ? ' back=#more' : ''} %% tile ${i}`),
  '', '## back: more | More', '', '- [ ] %% card: text %% the back', '',
  '## assets', '',
  `- [ ] %% card: asset id=sha256-aa mime=image/png %% ${PNG}`,
  `- [ ] %% card: asset id=sha256-aa.png mime=image/png %% ${PNG}`,
  `- [ ] %% card: asset id=sha256-bb mime=image/png %% ${PNG}`,
  '',
].join('\n');

const envOf = (md, { pool, extra = {} } = {}) => {
  const kv = new Map([[cardKey('maple', '0'), md], [`vanity:${OWN}`, 'maple']]);
  if (pool) kv.set(poolKey('maple', '0'), pool);
  return { PREVIEW: 'false', ...extra, CARDS: { get: async (k) => kv.get(k) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
};
const fetchOf = (md, { url = `https://${OWN}/`, headers = {}, pool, extra } = {}) =>
  worker.fetch(new Request(url, { redirect: 'manual', headers }), envOf(md, { pool, extra }), { waitUntil() {} });

const headOf = (html) => html.slice(0, html.indexOf('</head>'));
const rootTag = (html) => /<html[^>]*>/.exec(html)[0];
const bodyOf = (html) => html.slice(html.indexOf('<body'));

// ── the count ──────────────────────────────────────────────────────────────────────────────────────
test('tilesAbove counts the tiles of the front and the backs, not the pictures, and not lines outside a lane', () => {
  // fileOf(10): a profile and 8 text tiles in front, 1 in the back = 10 tiles, and 3 picture lines
  const md = fileOf(10);
  assert.equal(tilesAbove(md, 9), true, 'a tile of the front or the back was not counted');
  assert.equal(tilesAbove(md, 10), false, 'the picture lines are counted as tiles');
  const lead = ['- [ ] %% card: text %% not in a lane', '- [ ] %% card: text %% nor this', '## grid', '', '- [x] %% card: text %% one', '- [ ] two', ''].join('\n');
  assert.equal(tilesAbove(lead, 2), false, 'lines before the first lane are counted');
  assert.equal(tilesAbove(lead, 1), true, '`- [x]` and a tile without a marker are tiles (the board parser reads them)');
  assert.equal(tilesAbove(lead.replace(/\n/g, '\r\n'), 1), true, 'CRLF');
  assert.equal(tilesAbove('', 0), false);
  assert.equal(tilesAbove('## grid\n', 0), false);
});

// ── the line ───────────────────────────────────────────────────────────────────────────────────────
test(`ON_DEMAND_TILES (${ON_DEMAND_TILES}) tiles: the page the server renders today; one more: the shell naming the file`, async () => {
  const at = fileOf(ON_DEMAND_TILES), over = fileOf(ON_DEMAND_TILES + 1);
  assert.equal(tilesAbove(at), false, 'CONTROL: the file at the line is at the line');
  assert.equal(tilesAbove(over), true, 'CONTROL: the file past the line is past it');
  const page = await (await fetchOf(at)).text();
  const resolved = resolveHandle(OWN, '/', { [OWN]: 'maple' });
  assert.equal(page, renderCardHTML(at, { ...resolved, canonicalUrl: resolved.cardUrl, videos: {} }), 'at the line the page is not the whole render of the file');
  assert.ok(!/data-card-src/.test(page), 'at the line the page names the file for the browser to read');
  assert.ok(page.includes(`tile ${ON_DEMAND_TILES - 3}<`), 'CONTROL: the last front tile is in the page');
  const res = await fetchOf(over);
  const shell = await res.text();
  assert.equal(res.status, 200);
  assert.match(rootTag(shell), / data-card-src="\/index\.md"/, 'past the line the page names the file at its own download address');
  assert.ok(!shell.includes('>tile 0<') && !shell.includes('the back'), 'the shell carries tiles of the file');
  assert.ok(shell.length < 64 * 1024, `the shell is ${shell.length} characters`);
  // the address it names answers the whole file, as it did
  const fat = await fetchOf(over, { url: `https://${OWN}/index.md` });
  assert.equal(await fat.text(), over);
  // on the shared host the address is the handle's own
  const shared = await (await fetchOf(over, { url: 'https://card.feelreef.com/maple' })).text();
  assert.match(rootTag(shared), / data-card-src="\/maple\.md"/);
});

// ── what the shell carries ─────────────────────────────────────────────────────────────────────────
test('the shell\'s head is the full page\'s head: title, lang, canonical, description, og:image, icons — and the response headers', async () => {
  const md = fileOf(ON_DEMAND_TILES + 1);
  const resolved = resolveHandle(OWN, '/', { [OWN]: 'maple' });
  const full = renderCardHTML(md, { ...resolved, canonicalUrl: resolved.cardUrl, videos: {} });
  const res = await fetchOf(md);
  const shell = await res.text();
  assert.equal(headOf(shell).replace(' data-card-src="/index.md"', ''), headOf(full), 'the shell\'s head differs from the head of the page the whole file makes');
  assert.equal(rootTag(shell), rootTag(full).replace('<html', '<html data-card-src="/index.md"'));
  // the fields by name, so a failure says which
  assert.match(shell, /<title>Maple Lee<\/title>/);
  assert.match(rootTag(shell), /lang="de"/);
  assert.match(shell, /<link rel="canonical" href="https:\/\/links\.creator-example\.test"/);
  assert.match(shell, /<meta name="description" content="Making things by hand, here\.">/);
  assert.match(shell, /<meta property="og:image" content="https:\/\/links\.creator-example\.test\/apple-touch-icon\.png">/);
  assert.match(shell, /<link rel="icon" type="image\/png" href="\/favicon\.ico">/);
  assert.match(shell, /--cp-accent:#b890e8/);
  assert.match(rootTag(shell), /data-views="stack wall"/);
  // the head of the response: the same as the full page's on this host (indexable, Vary, cache)
  assert.equal(res.headers.get('x-robots-tag'), null);
  assert.equal(res.headers.get('vary'), 'Accept');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('x-card-handle'), 'maple');
  // …and the stricter host keeps its stricter rule
  const old = await fetchOf(md, { url: 'https://card.feelreef.com/maple' });
  assert.equal(old.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('the shell carries the exchange link-back when the platform says in (the closing tile and the footer), and none when out', async () => {
  const md = fileOf(ON_DEMAND_TILES + 1);
  const resolved = resolveHandle(OWN, '/', { [OWN]: 'maple' });
  for (const [state, pool] of [['in', true], ['out', false]]) {
    const shell = await (await fetchOf(md, { pool: state })).text();
    const full = renderCardHTML(md, { ...resolved, canonicalUrl: resolved.cardUrl, videos: {}, pool });
    const footer = (h) => /<footer[\s\S]*?<\/footer>/.exec(h)[0];
    const closing = (h) => /<section class="st-grid st-pool"[\s\S]*?<\/section>/.exec(h)?.[0] ?? null;
    assert.equal(footer(shell), footer(full), `${state}: the footer`);
    assert.equal(closing(shell), closing(full), `${state}: the closing reef.cards tile`);
    assert.equal(/window\.__pool=(true|false)/.exec(shell)?.[1], /window\.__pool=(true|false)/.exec(full)?.[1], `${state}: what the deck is told`);
    if (pool) assert.ok(closing(shell), 'CONTROL: in draws a closing tile');
  }
});

test('the shell reads a bounded head: a profile past HEAD_UNITS is not looked for, and a file without one is a page with none', () => {
  const late = fileOf(ON_DEMAND_TILES + 1).replace(/- \[ \] %% card: profile[^\n]*\n/, '')
    .replace('- [ ] %% card: text %% tile 4000\n', `- [ ] %% card: profile w=6 %% Too far down.\n- [ ] %% card: text %% tile 4000\n`);
  assert.ok(late.indexOf('Too far down') > HEAD_UNITS, 'CONTROL: the profile is past the head');
  assert.ok(!shellSource(late).includes('Too far down'));
  assert.equal(shellSource(fileOf(9, { profile: false })), '---\ncard-page: maple\ntitle: Maple Lee\nlang: de\naccent: #b890e8\nviews: stack wall\n---\n\n## grid\n\n\n');
  // the pictures the shell draws are the avatar and its PNG copy; the file's other pictures stay in the file
  const src = shellSource(fileOf(9));
  assert.ok(src.includes('id=sha256-aa ') && src.includes('id=sha256-aa.png ') && !src.includes('sha256-bb'));
  assert.equal(withCardSrc('<!doctype html><html lang="x">', '/a"b.md'), '<!doctype html><html data-card-src="/a&quot;b.md" lang="x">');
});

// ── no exit judges the blank rule above the tier ───────────────────────────────────────────────────
// A file of nothing but unfilled template tiles IS blank (card-blank.mjs), and the rule answers it with
// noindex — but judging it parses the whole file, on every exit, the markdown download's included.
// Above the tier it is not asked: "not blank", the side card-blank.mjs names as harmless.
test('above the tier the blank rule is not asked on any exit (it parses the whole file); at the line it still is', async () => {
  const ON = { CARD_CANONICAL_HOST: 'reef.cards' };
  const blankOf = (n) => ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
    ...Array.from({ length: n }, () => `- [ ] %% card: ${BLANKS.text.type} %% ${BLANKS.text.body}`), ''].join('\n');
  const robots = async (md, url, headers = {}) => (await fetchOf(md, { url, headers, extra: ON })).headers.get('x-robots-tag');
  const at = blankOf(ON_DEMAND_TILES), over = blankOf(ON_DEMAND_TILES + 1);
  assert.equal(await robots(at, 'https://reef.cards/maple'), 'noindex', 'CONTROL: at the line a blank file is judged blank');
  for (const [name, url, headers] of [['page', 'https://reef.cards/maple', {}], ['thin markdown', 'https://reef.cards/maple', { accept: 'text/markdown' }],
    ['download', 'https://reef.cards/maple.md', {}], ['icon', 'https://reef.cards/maple/favicon.svg', {}]]) {
    assert.equal(await robots(over, url, headers), null, `${name}: the blank rule was asked above the tier`);
  }
});

test('above the tier the icons and the avatar come from the shell, and are the ones the whole file gives', async () => {
  const md = fileOf(ON_DEMAND_TILES + 1);
  for (const p of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/avatar']) {
    const r = await fetchOf(md, { url: `https://${OWN}${p}` });
    assert.equal(r.status, 200, p);
    const small = await fetchOf(fileOf(9), { url: `https://${OWN}${p}` });   // the same head, below the tier: the full parse
    assert.equal(r.headers.get('content-type'), small.headers.get('content-type'), p);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(await small.arrayBuffer()), p);
  }
});

// ── deck.js over the file the shell names ──────────────────────────────────────────────────────────
const flush = () => new Promise((r) => setImmediate(r));
/** the shell the worker serves for md, then deck.js over it, with the browser's fetch answered by the same worker */
async function openShell(md, { pool } = {}) {
  const env = envOf(md, { pool });
  const html = await (await worker.fetch(new Request(`https://${OWN}/`), env, { waitUntil() {} })).text();
  const win = makeWindow(html, { scripts: true, url: `https://${OWN}/` });
  const doc = win.document;
  const errors = [];
  win.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ')) };
  doc.scrollHeightOf = () => win.innerHeight * 10;
  doc.rectOf = () => ({ top: 0, left: 0, width: 342, height: 480 });
  const asked = [];
  win.fetch = async (u) => { asked.push(String(u)); const r = await worker.fetch(new Request(new URL(u, `https://${OWN}/`)), env, { waitUntil() {} }); return { ok: r.ok, status: r.status, text: () => r.text() }; };
  win.run(DECK_JS, 'deck.js');
  for (let i = 0; i < 20 && win.__deckBoot === 'pending'; i++) await flush();
  win.tick(3000);
  return { win, doc, errors, asked, html };
}

test('the real sample (834,151 tiles, 25 MiB): the worker serves a shell, and deck.js deals every item from the file it names', async () => {
  const md = [...pieces()].join('');
  assert.equal(createHash('sha256').update(md).digest('hex'), SAMPLE_SHA256, 'CONTROL: the sample is the prototype\'s file');
  const { win, doc, errors, asked, html } = await openShell(md);
  assert.match(rootTag(html), / data-card-src="\/index\.md"/);
  assert.deepEqual(asked, ['/index.md'], 'deck.js read the file at the address the shell names, once');
  assert.deepEqual(errors, []);
  assert.equal(win.__deckBoot, 'ready');
  assert.equal(win.__mdCount, 834151, 'every tile of the file is an item');
  assert.ok(doc.querySelectorAll('*').length < 2000, 'deck.js built more than the cards near view');
  // the wall: the file's rows go in a grid of their own (the shell has none: the sample has no profile)
  win.__deckView('wall'); win.tick(1000);
  const space = doc.querySelector('main .st-cells .vb-space');
  assert.ok(space, 'the wall over the file has nowhere to draw its rows');
});

test('deck.js file mode: the pictures of the `## assets` lane are not items, and the closing reef.cards tile is the last card, not the second', async () => {
  const md = fileOf(ON_DEMAND_TILES + 1);
  const { win, doc, errors } = await openShell(md, { pool: 'in' });
  assert.deepEqual(errors, []);
  assert.equal(win.__deckBoot, 'ready');
  // the file's items: the front lane's tiles (the profile and the text tiles, ON_DEMAND_TILES of the file's
  // ON_DEMAND_TILES + 1: the other is the back's); never one of its three picture lines
  assert.equal(win.__mdCount, ON_DEMAND_TILES, 'the pictures were dealt as items (or a tile was lost)');
  const last = win.__deckCount() - 1;
  win.__deckJump(last); win.tick(1000);
  const top = doc.querySelector('.deck-stack > .deck-card.is-top');
  assert.ok(top && top.querySelector('.st-pool-card'), 'the last card is not the closing reef.cards tile');
  win.__deckJump(1); win.tick(1000);
  const second = doc.querySelector('.deck-stack > .deck-card.is-top');
  assert.ok(second && !second.querySelector('.st-pool-card'), 'the closing reef.cards tile is dealt before the file');
});
