// tile#339 — a Cards page names its pictures by their own content-addressed URLs instead of carrying
// them inline as base64. run: node --test packages/cardtile/serve/cardtile-asset-urls.test.mjs
//
// Every assertion is about what a CLIENT gets from worker.fetch. The card, its handle, its domain and
// its pictures are made up; the "pictures" are deterministic bytes behind a real file signature (no
// route here decodes an image, so the bytes only have to be stable and distinct).
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createHash } from 'node:crypto';
import worker, { cardPath, renderCardHTML, ROOT_HANDLE } from './card-worker.mjs';

const HANDLE = 'tidepool';
const VHOST = 'links.tidepool-example.test';
const CANON = 'card.feelreef.com';
const PAGE = `https://${CANON}/${HANDLE}`;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** `n` stable bytes after `head`, distinct per `seed` */
const bytes = (seed, n, head = Buffer.alloc(0)) => {
  const out = [head];
  for (let i = 0, len = head.length; len < n; i++) {
    const b = createHash('sha256').update(`${seed}:${i}`).digest();
    out.push(b);
    len += b.length;
  }
  return Buffer.concat(out).subarray(0, n);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_SIG = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const sha = (b) => createHash('sha256').update(b).digest('hex');

// eight pictures of ~140 KB (the order of the page measured in the issue: 8 pictures, ~1.1 MB of base64),
// one glyph-sized PNG and one SVG — the two that stay inline
const BIG = [
  ['avatar', 'image/webp', 'webp', bytes('avatar', 140_000, WEBP_SIG)],
  ['f1', 'image/jpeg', 'jpg', bytes('f1', 150_000, JPG_SIG)],
  ['f2', 'image/png', 'png', bytes('f2', 130_000, PNG_SIG)],
  ['f3', 'image/webp', 'webp', bytes('f3', 145_000, WEBP_SIG)],
  ['s1', 'image/jpeg', 'jpg', bytes('s1', 135_000, JPG_SIG)],
  ['s2', 'image/jpeg', 'jpg', bytes('s2', 142_000, JPG_SIG)],
  ['art', 'image/png', 'png', bytes('art', 120_000, PNG_SIG)],
  ['bd', 'image/webp', 'webp', bytes('bd', 160_000, WEBP_SIG)],
].map(([name, mime, ext, b]) => ({ id: `sha256-${sha(b).slice(0, 16)}`, name, mime, ext, b, hex: sha(b) }));
const pic = Object.fromEntries(BIG.map((p) => [p.name, p]));
const GLYPH = { id: 'glyph', mime: 'image/png', b: bytes('glyph', 300, PNG_SIG) };
const SVG = { id: 'logo', mime: 'image/svg+xml', b: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>') };

const card = ({ assets = true, override = {} } = {}) => {
  const all = [...BIG, GLYPH, SVG].map((a) => ({ ...a, ...(override[a.id] || {}) }));
  return [
    '---', `card-page: ${HANDLE}`, 'title: Tide Pool', `backdrop: asset:${pic.bd.id}`, '---', '',
    '## grid', '',
    `- [ ] %% card: profile w=6 h=2 avatar=asset:${pic.avatar.id} %% a made-up rock-pool guide`,
    `- [ ] %% card: feature w=3 h=2 img=asset:${pic.f1.id} title="Low tide" %% walks`,
    `- [ ] %% card: feature w=3 h=2 img=asset:${pic.f2.id} title="Anemones" %% guide`,
    `- [ ] %% card: feature img=asset:${pic.f3.id} %%`,
    `- [ ] %% card: slides kind=slider images="asset:${pic.s1.id},asset:${pic.s2.id}" %%`,
    `- [ ] %% card: link w=3 iconimg=asset:${pic.art.id} %% [Prints](https://example.com/prints)`,
    `- [ ] %% card: link w=3 iconimg=asset:${GLYPH.id} %% [Map](https://example.com/map)`,
    `- [ ] %% card: feature img=asset:${SVG.id} %%`,
    ...(assets ? ['', '## assets', '', ...all.map((a) => `- [ ] %% card: asset id=${a.id} mime=${a.mime} %% ${a.b.toString('base64')}`)] : []),
  ].join('\n') + '\n';
};
const CARD = card();

/**
 * a store holding `md` under HANDLE (or nothing), optionally stopped / bound to VHOST; records reads.
 * The local switch is set to 'url' (asset-urls.mjs pictureStrategy): this file is that strategy's
 * contract. With the switch unset the page is today's inline page (cardtile-picture-switch.test.mjs).
 */
const envWith = (md, { stopped = false, vanity = false, handle = HANDLE, pictures = 'url' } = {}) => {
  const kv = new Map([
    ...(md != null ? [[handle, md]] : []),
    ...(vanity ? [[`vanity:${VHOST}`, handle], [`vanityof:${handle}`, VHOST]] : []),
    ...(stopped ? [[`stop:${handle}`, 'stopped']] : []),
  ]);
  const reads = [];
  return {
    reads,
    PREVIEW: 'false',
    CARDTILE_PICTURES: pictures,
    CARDS: {
      get: async (k) => { reads.push(k); return kv.get(k) ?? null; },
      async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    },
  };
};
const get = async (url, env, init = {}) => {
  const res = await worker.fetch(new Request(url, { redirect: 'manual', ...init }), env, { waitUntil() {} });
  return { res, body: Buffer.from(await res.arrayBuffer()) };
};
const headersOf = (res) => [...res.headers].sort();
const pageHtml = async (url, env) => {
  const { res, body } = await get(url, env);
  assert.equal(res.status, 200, url);
  return body.toString('utf8');
};

beforeEach((t) => {
  // nothing on these routes may leave the Worker
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected upstream fetch'); });
});

// ── 1. the page ──────────────────────────────────────────────────────────────────────────────────

test('🔴 #339 — the served page names each picture by /<handle>/a/<sha256>.<ext>, and is a fraction of the inline page', async () => {
  const served = await pageHtml(PAGE, envWith(CARD));
  // what the page was before: the same renderer with nothing to point at, i.e. every picture inline
  const inline = renderCardHTML(CARD, { handle: HANDLE, cardUrl: PAGE });
  for (const p of BIG) {
    assert.ok(served.includes(`/${HANDLE}/a/${p.hex}.${p.ext}`), `${p.name}: no URL for it in the page`);
    assert.ok(!served.includes(p.b.toString('base64').slice(0, 200)), `${p.name}: its bytes are still inline`);
  }
  assert.ok(!/data:image\/(?:png|jpeg|webp|gif|avif);base64,.{2000}/.test(served), 'a large raster data: URI is left in the page');
  const before = Buffer.byteLength(inline), after = Buffer.byteLength(served);
  console.log(`# picture-heavy fixture: HTML ${before} bytes inline → ${after} bytes by URL (${(100 * after / before).toFixed(1)}%)`);
  assert.ok(before > 1_000_000, `the fixture is picture-heavy (${before})`);
  assert.ok(after < before * 0.05, `served HTML ${after} is not under 5% of the inline ${before}`);
});

test('🔴 #339 — a glyph-sized picture and an SVG stay inline, and nothing else changes on a card without pictures', async () => {
  const served = await pageHtml(PAGE, envWith(CARD));
  assert.ok(served.includes(`data:image/png;base64,${GLYPH.b.toString('base64')}`), 'the glyph is not inline');
  assert.ok(served.includes(`data:image/svg+xml;base64,${SVG.b.toString('base64')}`), 'the SVG is not inline');
  assert.ok(served.includes(`/${HANDLE}/a/`), 'control: the large pictures did move');
  // a card with no assets renders byte for byte as the renderer alone renders it
  const bare = card({ assets: false });
  const { body } = await get(PAGE, envWith(bare));
  assert.equal(body.toString('utf8'), renderCardHTML(bare, { handle: HANDLE, cardUrl: PAGE, canonicalUrl: PAGE }));
});

test('🔴 #339 — naming the pictures by URL costs the page no store read', async () => {
  const withPics = envWith(CARD), without = envWith(card({ assets: false }));
  const served = await pageHtml(PAGE, withPics);
  await pageHtml(PAGE, without);
  assert.ok(served.includes(`/${HANDLE}/a/${pic.avatar.hex}.webp`), 'the page names its avatar by URL');
  assert.deepEqual(withPics.reads, without.reads, 'the page with pictures read the store differently');
});

// ── 2. the asset responses ───────────────────────────────────────────────────────────────────────

test('🔴 #339 — each picture answers at its URL with its own bytes, exact type, immutable cache and nosniff', async () => {
  const env = envWith(CARD);
  for (const p of BIG) {
    const { res, body } = await get(`https://${CANON}/${HANDLE}/a/${p.hex}.${p.ext}`, env);
    assert.equal(res.status, 200, p.name);
    assert.ok(body.equals(p.b), `${p.name}: not its bytes`);
    assert.equal(res.headers.get('content-type'), p.mime, p.name);
    assert.equal(res.headers.get('cache-control'), IMMUTABLE, p.name);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p.name);
    assert.equal(res.headers.get('location'), null, p.name);
  }
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('🔴 #339 — the URL is the bytes: new bytes under the same id get a new URL, and the old one stops answering', async () => {
  const changed = bytes('avatar-2', 141_000, WEBP_SIG);
  const md = card({ override: { [pic.avatar.id]: { b: changed } } });
  const env = envWith(md);
  const html = await pageHtml(PAGE, env);
  assert.ok(html.includes(`/${HANDLE}/a/${sha(changed)}.webp`), 'the page does not name the new bytes');
  assert.ok(!html.includes(pic.avatar.hex), 'the page still names the old bytes');
  assert.equal((await get(`${PAGE}/a/${sha(changed)}.webp`, env)).res.status, 200);
  assert.equal((await get(`${PAGE}/a/${pic.avatar.hex}.webp`, env)).res.status, 404);
});

test('🔴 #339 — no type outside the raster allowlist, no wrong extension, no other card\'s picture', async () => {
  const env = envWith(CARD);
  const svgHex = sha(SVG.b);
  // control: the route exists, so each 404 below is a judgement
  assert.equal((await get(`${PAGE}/a/${pic.f1.hex}.jpg`, env)).res.status, 200, 'control: the right URL answers');
  for (const path of [
    `a/${svgHex}.svg`, `a/${svgHex}.png`,          // the SVG is never served, under any extension
    `a/${pic.f1.hex}.png`, `a/${pic.f1.hex}.jpeg`, // the stored type decides the extension, one spelling
    `a/${pic.f1.hex.toUpperCase()}.jpg`, `a/${pic.f1.hex.slice(0, 63)}.jpg`, `a/${pic.f1.hex}.jpg/x`, `a/${pic.f1.id}.jpg`,
  ]) {
    const { res, body } = await get(`${PAGE}/${path}`, env);
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get('content-type') || '', /^text\/html/, path);
    assert.ok(!body.includes(SVG.b) && !body.includes(pic.f1.b.subarray(0, 64)), `${path}: carries asset bytes`);
  }
  // another handle's URL space never reaches this card's lane
  const other = envWith(CARD);
  assert.equal((await get(`https://${CANON}/someone-else/a/${pic.f1.hex}.jpg`, other)).res.status, 404);
});

// ── 3. one answer for "no card" ──────────────────────────────────────────────────────────────────

test('🔴 #339 — a stopped or unknown Cards page\'s pictures answer the no-card 404, byte for byte the page\'s own', async () => {
  const url = `${PAGE}/a/${pic.f1.hex}.jpg`;
  const live = await get(url, envWith(CARD));
  assert.equal(live.res.status, 200, 'control: the same URL answers while the page is live');
  const stopped = await get(url, envWith(CARD, { stopped: true }));
  const unknown = await get(url, envWith(null));
  const stoppedPage = await get(PAGE, envWith(CARD, { stopped: true }));
  for (const [name, r] of [['stopped', stopped], ['unknown', unknown], ['the stopped page', stoppedPage]]) {
    assert.equal(r.res.status, 404, name);
  }
  assert.ok(stopped.body.equals(unknown.body), 'stopped and unknown differ in body');
  assert.deepEqual(headersOf(stopped.res), headersOf(unknown.res), 'stopped and unknown differ in headers');
  assert.ok(stopped.body.equals(stoppedPage.body), 'the picture 404 is not the page 404');
  assert.deepEqual(headersOf(stopped.res), headersOf(stoppedPage.res));
});

// ── 4. a creator's own domain, and the root card ─────────────────────────────────────────────────

test('🔴 #339 — on the creator\'s own domain the page names /a/<sha256>.<ext>, which answers there', async () => {
  const env = envWith(CARD, { vanity: true });
  const html = await pageHtml(`https://${VHOST}/`, env);
  assert.ok(html.includes(`"/a/${pic.f2.hex}.png"`), 'the vanity page does not name /a/<sha>.png');
  assert.ok(!html.includes(`/${HANDLE}/a/`), 'the vanity page names the shared-host path');
  for (const url of [`https://${VHOST}/a/${pic.f2.hex}.png`, `https://${VHOST}/${HANDLE}/a/${pic.f2.hex}.png`,
    // the shared-host address answers the picture too (an image, before the page's redirect to the domain)
    `${PAGE}/a/${pic.f2.hex}.png`]) {
    const { res, body } = await get(url, env);
    assert.equal(res.status, 200, url);
    assert.ok(body.equals(pic.f2.b), url);
    assert.equal(res.headers.get('cache-control'), IMMUTABLE, url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
  }
  // stopped on the domain: the answer that host gives its stopped page
  const stoppedEnv = () => envWith(CARD, { vanity: true, stopped: true });
  const pic404 = await get(`https://${VHOST}/a/${pic.f2.hex}.png`, stoppedEnv());
  const page404 = await get(`https://${VHOST}/`, stoppedEnv());
  assert.equal(pic404.res.status, 404);
  assert.ok(pic404.body.equals(page404.body));
  assert.deepEqual(headersOf(pic404.res), headersOf(page404.res));
});

test('🔴 #339 — the root card (page at /) names its pictures under /<root>/a/, never /a/ (that is a handle)', async () => {
  const md = CARD.replace(`card-page: ${HANDLE}`, `card-page: ${ROOT_HANDLE}`);
  const env = envWith(md, { handle: ROOT_HANDLE });
  const html = await pageHtml(`https://${CANON}/`, env);
  assert.ok(html.includes(`"/${ROOT_HANDLE}/a/${pic.f2.hex}.png"`), 'the root page does not name /<root>/a/<sha>');
  const { res, body } = await get(`https://${CANON}/${ROOT_HANDLE}/a/${pic.f2.hex}.png`, env);
  assert.equal(res.status, 200);
  assert.ok(body.equals(pic.f2.b));
});

// ── 5. the router, pure ──────────────────────────────────────────────────────────────────────────

test('🔴 #339 — cardPath routes exactly the content-addressed shape', () => {
  const hex = 'ab'.repeat(32);
  for (const ext of ['png', 'jpg', 'webp', 'gif', 'avif']) {
    assert.equal(cardPath(`/${HANDLE}/a/${hex}.${ext}`, HANDLE, false), 'asset', ext);
    assert.equal(cardPath(`/a/${hex}.${ext}`, HANDLE, true), 'asset', `vanity ${ext}`);
    assert.equal(cardPath(`/${HANDLE}/a/${hex}.${ext}`, HANDLE, true), 'asset', `vanity /<h>/a ${ext}`);
  }
  for (const p of [`a/${hex}.svg`, `a/${hex}.jpeg`, `a/${hex.slice(1)}.png`, `a/${hex.toUpperCase()}.png`, `a/${hex}.png/`, `a/${hex}`, `a/x/${hex}.png`]) {
    assert.equal(cardPath(`/${HANDLE}/${p}`, HANDLE, false), null, p);
    assert.equal(cardPath(`/${p}`, HANDLE, true), null, `vanity ${p}`);
  }
  // a shared host never reads /a/<x> as anyone's picture but the handle `a`'s
  assert.equal(cardPath(`/a/${hex}.png`, HANDLE, false), null);
});
