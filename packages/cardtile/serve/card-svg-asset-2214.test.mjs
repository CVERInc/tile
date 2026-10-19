// A card's user SVG never leaves the Card Worker as a document of its own type (reef#2214).
// run: node --test card-svg-asset-2214.test.mjs
//
// 🔴 WHAT THIS IS HOLDING. reef's `put_asset` accepts image/svg+xml again (reef PR #2228) on ONE
// premise, measured on this repo at fdb68c3: an asset is only ever shown as a PICTURE — base64 inside
// `<img src="data:…">` or a CSS `url()` — so an SVG with `<script>` in it runs nothing. There is no
// per-asset route, the icon exits refuse a non-raster avatar, and the thin markdown exit drops the
// lane. If any of that changes (an asset route, an inline `<svg>`, an `<object>` embed, an icon exit
// that passes the avatar through), SVG on reef must go behind `attachment` + `CSP: sandbox` first —
// and the red here is how that gets noticed. Assertions are about what a CLIENT gets: every exit —
// the page included — is requested through worker.fetch, canonical and vanity. The card is made up;
// no real person.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { cardPath } from './card-worker.mjs';

const HANDLE = 'quillmoss';
const VHOST = 'links.quillmoss-example.test';
const CARD_URL = `https://card.feelreef.com/${HANDLE}`;
const MARK = 'pwn2214';     // a word only the asset's script contains
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert('${MARK}')</script><rect width="1" height="1"/></svg>`;
const B64 = Buffer.from(SVG).toString('base64');
const URI = `data:image/svg+xml;base64,${B64}`;

// every place a card can name an asset, all pointing at the one SVG
const card = ({ svgAvatar = true, assets = true } = {}) => [
  '---', `card-page: ${HANDLE}`, 'title: Quill Moss', "accent: '#2a7fff'",
  ...(assets ? ['backdrop: asset:logo'] : []), '---', '',
  '## grid', '',
  `- [ ] %% card: profile w=6 h=2${svgAvatar ? ' avatar=asset:logo' : ''} %% a made-up bookbinder`,
  `- [ ] %% card: link w=2 h=2${assets ? ' iconimg=asset:logo' : ''} %% [Shop](https://example.com/shop)`,
  ...(assets ? [
    '- [ ] %% card: feature w=3 h=2 img=asset:logo title="t" %% eyebrow',
    '- [ ] %% card: feature img=asset:logo %%',   // picture-only: its own <img> branch in card-render
    '- [ ] %% card: embed bleed kind=bubbles images="asset:logo,asset:logo" bg=asset:logo %%',
    '- [ ] %% card: embed kind=slider images="asset:logo" %%',
  ] : []),
  ...(assets || svgAvatar ? ['', '## assets', '', `- [ ] %% card: asset id=logo mime=image/svg+xml %% ${B64}`] : []),
].join('\n') + '\n';
const SVG_CARD = card();

/** a CARDS store holding the card; with `vanity`, the card is bound to VHOST */
const envWith = (md, vanity = false) => {
  const kv = new Map([[HANDLE, md], ...(vanity ? [[`vanity:${VHOST}`, HANDLE], [`vanityof:${HANDLE}`, VHOST]] : [])]);
  return { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null } };
};
const get = async (md, url, { headers = {}, vanity = false } = {}) => {
  const res = await worker.fetch(new Request(url, { headers, redirect: 'manual' }), envWith(md, vanity));
  return { res, body: Buffer.from(await res.arrayBuffer()) };
};

// Every output point in card-render.mjs that writes a resolved `asset:` (resolveAsset), as the exact
// picture sink it must be. Each occurrence of the base64 has to be claimed by exactly one of these,
// and each of these has to claim at least one — so a branch that stops emitting, or emits through a
// different element, is red here, and two bubbles frames cannot stand in for a missing iconimg.
const DATA = 'data:image\\/svg\\+xml;base64,';
const SINKS = [
  // name                kind   the markup right before the base64 (anchored)                                         right after
  ['backdrop',          'css', new RegExp(`<style>\\.st-backdrop\\{[^{}<]*background-image:url\\("${DATA}$`),             '")'],
  ['profile avatar',    'img', new RegExp(`data-coral-type="profile"><div class="st-figure"[^<>]*><img class="cp-icon" src="${DATA}$`), '"'],
  ['link iconimg',      'img', new RegExp(`<img class="st-cell-icon-img st-cell-icon-art" src="${DATA}$`),                  '"'],
  ['feature with copy', 'img', new RegExp(`<div class="st-cell st-gal-cell" [^<>]*data-coral-type="feature"><div class="st-gal-link"><img class="st-gal-img" src="${DATA}$`), '" alt="" loading="lazy"><div class="st-gal-scrim">'],
  ['feature picture',   'img', new RegExp(`<div class="st-cell st-gal-cell st-gal-cell-bare" [^<>]*data-coral-type="feature"><div class="st-gal-link"><img class="st-gal-img" src="${DATA}$`), '"'],
  ['bubbles bg',        'css', new RegExp(`<div class="st-carousel" style="background-image:url\\('${DATA}$`),             "')\""],
  ['bubbles image',     'img', new RegExp(`<div class="st-carousel"[^<>]*>(?:<figure><img src="[^"<>]*"[^<>]*></figure>)*<figure><img src="${DATA}$`), '"'],
  ['slider image',      'img', new RegExp(`<figure id="sl[a-z0-9]+-\\d+"><img src="${DATA}$`),                              '"'],
];

/** each occurrence of the asset's base64 in `html`, and which sink(s) claim it */
function claims(html) {
  const out = [];
  for (let i = html.indexOf(B64); i !== -1; i = html.indexOf(B64, i + 1)) {
    const before = html.slice(Math.max(0, i - 4000), i), after = html.slice(i + B64.length, i + B64.length + 60);
    const by = SINKS.filter(([, , re, tail]) => re.test(before) && after.startsWith(tail)).map(([name]) => name);
    out.push({ by, at: before.slice(-80) + '⟨b64⟩' + after.slice(0, 12) });
  }
  return out;
}

// ── 1. the page, through the Worker ──────────────────────────────────────────────────────────────

// what browsers actually send for a navigation (Chrome/Edge, Firefox, Safari)
const BROWSER_ACCEPTS = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
];
const PAGES = [[CARD_URL, false], [`https://${VHOST}/`, true]];

/** the card page as a visitor's browser gets it: 200 text/html, or the test is red */
async function page(url, vanity, accept) {
  const { res, body } = await get(SVG_CARD, url, { vanity, headers: { Accept: accept } });
  assert.equal(res.status, 200, `${url}: status`);
  assert.match(res.headers.get('content-type') || '', /^text\/html\b/, `${url}: not served as HTML`);
  return body.toString('utf8');
}

for (const [url, vanity] of PAGES) {
  for (const accept of BROWSER_ACCEPTS) {
    const tag = `${url} (Accept: ${accept.slice(0, 28)}…)`;

    test(`🔴 #2214 — ${tag}: the SVG reaches the page only through its picture sinks, each one sampled`, async () => {
      const found = claims(await page(url, vanity, accept));
      const stray = found.filter((f) => f.by.length !== 1);
      assert.deepEqual(stray, [], 'base64 of the SVG not claimed by exactly one <img src="data:…"> / url() sink');
      // a ruler with no sample passes forever: EVERY output point must be reached, not a total
      for (const [name] of SINKS) {
        assert.ok(found.some((f) => f.by[0] === name), `no sample for the "${name}" sink: ${JSON.stringify(found.map((f) => f.by))}`);
      }
    });

    test(`🔴 #2214 — ${tag}: the SVG is never decoded into the page, nor handed to a document-loading element`, async () => {
      const html = await page(url, vanity, accept);
      assertNoDocumentSink(html);
    });
  }
}

function assertNoDocumentSink(html) {
  assert.ok(!html.includes(MARK), "the asset's script text is in the page");
  assert.ok(!html.includes(`<script>alert(`), "the asset's literal <script> is in the page");
  assert.ok(!html.includes('<rect width="1"'), 'the SVG markup is in the page, decoded');
  for (const tag of ['object', 'iframe', 'embed', 'frame', 'portal']) {
    assert.ok(!new RegExp(`<${tag}\\b[^>]*data:image/svg`, 'i').test(html), `<${tag}> carries the SVG`);
  }
  assert.ok(!/<a\b[^>]*\bhref="data:/i.test(html), '<a href="data:…">');
  assert.ok(!/<link\b[^>]*\bhref="data:/i.test(html), '<link href="data:…">');
  assert.ok(!/<(?:use|image|feImage)\b[^>]*href="data:image\/svg/i.test(html), 'an inline-SVG reference to the asset');
}

// ── 2. the icon exits ────────────────────────────────────────────────────────────────────────────

for (const [file, type] of [['favicon.ico', 'image/x-icon'], ['favicon.svg', 'image/svg+xml'], ['apple-touch-icon.png', 'image/png']]) {
  for (const vanity of [false, true]) {
    const url = vanity ? `https://${VHOST}/${file}` : `${CARD_URL}/${file}`;
    test(`🔴 #2214 — ${url} with an SVG avatar serves the generated badge, not the user's bytes`, async () => {
      const { res, body } = await get(SVG_CARD, url, { vanity });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), type);
      assert.ok(!body.includes(MARK) && !body.includes(B64) && !body.includes(SVG), 'user SVG bytes in the icon');
      // the badge is what a card with NO avatar gets — same name, same accent ⇒ the same bytes
      const bare = await get(card({ svgAvatar: false, assets: false }), url, { vanity });
      assert.equal(bare.res.status, 200);
      assert.ok(body.equals(bare.body), `${file}: not the badge a card without an avatar gets`);
    });
  }
}

// ── 3. no asset route ────────────────────────────────────────────────────────────────────────────

const SUBPATHS = ['logo', 'logo.svg', 'asset/logo', 'assets/logo.svg', 'asset/logo.svg'];

test('🔴 #2214 — asset-looking sub-paths route to nothing (cardPath → null), canonical and vanity', () => {
  for (const s of SUBPATHS) {
    assert.equal(cardPath(`/${HANDLE}/${s}`, HANDLE, false), null, `/${HANDLE}/${s}`);
    assert.equal(cardPath(`/${s}`, HANDLE, true), null, `vanity /${s}`);
  }
  // control: the same function does route the card and its icon files, so null above is a judgement
  assert.equal(cardPath(`/${HANDLE}`, HANDLE, false), 'page');
  assert.equal(cardPath(`/${HANDLE}/favicon.svg`, HANDLE, false), 'svg');
});

test('🔴 #2214 — and through the Worker those sub-paths answer 404 with none of the asset in it', async () => {
  for (const s of SUBPATHS) {
    for (const [url, vanity] of [[`${CARD_URL}/${s}`, false], [`https://${VHOST}/${s}`, true]]) {
      const { res, body } = await get(SVG_CARD, url, { vanity });
      assert.equal(res.status, 404, url);
      assert.ok(!body.includes(B64) && !body.includes(MARK), `${url} carries the asset`);
      assert.doesNotMatch(res.headers.get('content-type') || '', /svg/, url);
    }
  }
});

// ── 4. the thin markdown exit ────────────────────────────────────────────────────────────────────

for (const [url, fatUrl, vanity] of [[CARD_URL, `${CARD_URL}.md`, false], [`https://${VHOST}/`, `https://${VHOST}/index.md`, true]]) {
  test(`🔴 #2214 — ${url} thin markdown exit (Accept: text/markdown) strips the assets`, async () => {
    const { res, body } = await get(SVG_CARD, url, { vanity, headers: { Accept: 'text/markdown' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^text\/markdown/);
    const md = body.toString('utf8');
    assert.ok(!md.includes(B64), 'thin markdown carries the asset');
    assert.ok(!/card: asset id=/.test(md), 'thin markdown carries an asset row');
    assert.ok(md.includes('avatar=asset:logo'), 'control: it is the card, references intact');
    // control: the fat exit DOES carry it — as markdown, never under the asset's own type
    const fat = await get(SVG_CARD, fatUrl, { vanity });
    assert.equal(fat.res.status, 200, fatUrl);
    assert.ok(fat.body.includes(B64), `${fatUrl}: control — the fat file carries the asset`);
    assert.match(fat.res.headers.get('content-type') || '', /^text\/markdown/);
  });
}
