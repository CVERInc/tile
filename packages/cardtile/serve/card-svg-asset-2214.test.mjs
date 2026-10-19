// A card's user SVG never leaves the Card Worker as a document of its own type (reef#2214).
// run: node --test card-svg-asset-2214.test.mjs
//
// 🔴 WHAT THIS IS HOLDING. reef's `put_asset` accepts image/svg+xml again (reef PR #2228) on ONE
// premise, measured on this repo at fdb68c3: an asset is only ever shown as a PICTURE — base64 inside
// `<img src="data:…">` or a CSS `url()` — so an SVG with `<script>` in it runs nothing. There is no
// per-asset route, the icon exits refuse a non-raster avatar, and the thin markdown exit drops the
// lane. If any of that changes (an asset route, an inline `<svg>`, an `<object>` embed, an icon exit
// that passes the avatar through), SVG on reef must go behind `attachment` + `CSP: sandbox` first —
// and the red here is how that gets noticed. Assertions are about what a CLIENT gets, through
// worker.fetch where a route is involved. The card is made up; no real person.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { renderCardHTML, cardPath } from './card-worker.mjs';

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

/** where each occurrence of the asset's base64 sits: the text before it, back to the tag/declaration that holds it */
function contexts(html) {
  const out = [];
  for (let i = html.indexOf(B64); i !== -1; i = html.indexOf(B64, i + 1)) {
    const before = html.slice(Math.max(0, i - 400), i), after = html.slice(i + B64.length, i + B64.length + 8);
    let kind = 'other';
    if (/<img\b[^<>]*\ssrc="data:image\/svg\+xml;base64,$/.test(before) && after.startsWith('"')) kind = 'img';
    else {
      // url( + the same quote on both sides, raw in <style> or HTML-escaped in style=""
      const q = /url\(("|'|&quot;|&#39;|&#x27;)data:image\/svg\+xml;base64,$/.exec(before);
      if (q && after.startsWith(`${q[1]})`)) kind = 'css';
    }
    out.push({ kind, at: before.slice(-60) + '⟨b64⟩' + after });
  }
  return out;
}

// ── 1. the page ──────────────────────────────────────────────────────────────────────────────────

test('🔴 #2214 — the SVG reaches the page only as base64 inside <img src="data:…"> or a CSS url()', () => {
  const html = renderCardHTML(SVG_CARD, { handle: HANDLE, cardUrl: CARD_URL, videos: {} });
  const found = contexts(html);
  // a ruler with no sample passes forever: the fixture must actually reach both kinds of sink
  assert.ok(found.filter((f) => f.kind === 'img').length >= 5, `img sinks reached: ${JSON.stringify(found)}`);
  assert.ok(found.filter((f) => f.kind === 'css').length >= 2, `css url() sinks reached: ${JSON.stringify(found)}`);
  assert.deepEqual(found.filter((f) => f.kind === 'other'), [], 'base64 of the SVG outside <img src> / url()');
});

test('🔴 #2214 — the SVG is never decoded into the page, and never handed to a document-loading element', () => {
  const html = renderCardHTML(SVG_CARD, { handle: HANDLE, cardUrl: CARD_URL, videos: {} });
  assert.ok(!html.includes(MARK), "the asset's script text is in the page");
  assert.ok(!html.includes(`<script>alert(`), "the asset's literal <script> is in the page");
  assert.ok(!html.includes('<rect width="1"'), 'the SVG markup is in the page, decoded');
  for (const tag of ['object', 'iframe', 'embed', 'frame', 'portal']) {
    assert.ok(!new RegExp(`<${tag}\\b[^>]*data:image/svg`, 'i').test(html), `<${tag}> carries the SVG`);
  }
  assert.ok(!/<a\b[^>]*\bhref="data:/i.test(html), '<a href="data:…">');
  assert.ok(!/<link\b[^>]*\bhref="data:/i.test(html), '<link href="data:…">');
  assert.ok(!/<(?:use|image|feImage)\b[^>]*href="data:image\/svg/i.test(html), 'an inline-SVG reference to the asset');
});

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

test('🔴 #2214 — the thin markdown exit (Accept: text/markdown) strips the assets', async () => {
  const { res, body } = await get(SVG_CARD, CARD_URL, { headers: { Accept: 'text/markdown' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/markdown/);
  const md = body.toString('utf8');
  assert.ok(!md.includes(B64), 'thin markdown carries the asset');
  assert.ok(!/card: asset id=/.test(md), 'thin markdown carries an asset row');
  assert.ok(md.includes('avatar=asset:logo'), 'control: it is the card, references intact');
  // control: the fat exit DOES carry it — as markdown, never under the asset's own type
  const fat = await get(SVG_CARD, `${CARD_URL}.md`);
  assert.ok(fat.body.includes(B64));
  assert.match(fat.res.headers.get('content-type') || '', /^text\/markdown/);
});
