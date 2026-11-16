// Resolving "my latest video" — the four conditions, as tests.
//
//   node --test packages/cardtile/yt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yt from './yt.mjs';
import { resolveChannel, resolveHandle, channelIdFromPage, posterPath, CHANNEL_RE, VIDEO_RE, HANDLE_RE, isChannelRef } from './yt.mjs';
import { channelsIn, resolveChannels } from './yt-channels.mjs';
import * as worker from './serve/card-worker.mjs';
import { parseParams } from '../sitetile/site-core.js';

const { renderCardHTML } = worker;
const CH = 'UCabcdefghijklmnopqrstuv';          // UC + 22
// A whole Card around some lines. channelsIn reads the Card as the renderer does (parseCard), and a
// line outside any `## lane` is not a cell, so every channelsIn input below is a real Card.
const CARD = (block) => `---\ncard-page: t\ntitle: T\naccent: #0556ff\n---\n\n## grid\n\n${block}\n`;
const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const notOk = (status, body = '') => ({ ok: false, status, text: async () => body });

// ── tile#341: YouTube's own answers, recorded ────────────────────────────────────────────────────
// fixtures/yt/ holds responses recorded 2026-11-16 with plain curl (no credentials) from
// https://www.youtube.com/oembed?format=json&url=<encoded youtube.com address>, byte for byte:
//   oembed-uploads-<UC id>.json   the uploads playlist (UU…) of YouTube's own channel and of Google
//                                 for Developers — the two channels the public issue names
//   oembed-video-vLAegkGGWrM.json the newest upload of the second one
//   oembed-uploads-unknown.404.txt / oembed-video-unknown.400.txt   what oEmbed says to an id it
//                                 does not know (404 "Not Found" / 400 "Bad Request")
// The same day, /feeds/videos.xml answered 404 for every channel tried, in every form
// (channel_id=, playlist_id=, user=). No test here touches the network.
const FIX = (name) => readFileSync(new URL(`./fixtures/yt/${name}`, import.meta.url), 'utf8');
const YT = 'UCBR8-60-B28hp2BmDPdntcQ';          // YouTube's own channel
const GD = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';          // Google for Developers
const OE = (page) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`;
const UPLOADS_OE = (uc) => OE(`https://www.youtube.com/playlist?list=UU${uc.slice(2)}`);
const VIDEO_OE = (id) => OE(`https://www.youtube.com/watch?v=${id}`);
/**
 * YouTube as recorded: each recorded address answers its recorded body, the feed answers 404 (as it
 * does for every channel today), an unknown playlist 404 and an unknown video 400 — oEmbed's own
 * answers. `extra` maps more addresses to responses. Every request is logged.
 */
const recorded = (extra = {}) => {
  const urls = [];
  const table = {
    [UPLOADS_OE(YT)]: ok(FIX(`oembed-uploads-${YT}.json`)),
    [UPLOADS_OE(GD)]: ok(FIX(`oembed-uploads-${GD}.json`)),
    [VIDEO_OE('vLAegkGGWrM')]: ok(FIX('oembed-video-vLAegkGGWrM.json')),
    ...extra,
  };
  const doFetch = async (u) => {
    urls.push(u);
    if (u in table) return typeof table[u] === 'function' ? table[u]() : table[u];
    if (u.startsWith('https://www.youtube.com/feeds/videos.xml?')) return notOk(404, '<title>Error 404 (Not Found)!!1</title>');
    if (u.includes('watch%3Fv%3D')) return notOk(400, FIX('oembed-video-unknown.400.txt'));
    return notOk(404, FIX('oembed-uploads-unknown.404.txt'));
  };
  return { doFetch, urls };
};
/** a channel's recorded answer, built for a made-up channel id: the uploads oEmbed names `id` */
const UPLOADS_OF = (id, thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) =>
  FIX(`oembed-uploads-${GD}.json`).replace('https://i.ytimg.com/vi/vLAegkGGWrM/hqdefault.jpg', thumb);
const VIDEO_OF = (title) =>
  JSON.stringify({ ...JSON.parse(FIX('oembed-video-vLAegkGGWrM.json')), title });

test('🔴 tile#341: a channel resolves to its newest upload from YouTube’s answers as recorded today (the feed is 404)', async () => {
  const { doFetch } = recorded();
  assert.deepEqual(await resolveChannel(GD, doFetch),
    { id: 'vLAegkGGWrM', title: 'Building with Gemini in Google Antigravity', channelId: GD });
  // YouTube's own channel: the video's title is not recorded, so its oEmbed answers 400 here — the
  // poster stays, the title is empty, and the renderer falls back to the cell's own label.
  assert.deepEqual(await resolveChannel(YT, doFetch), { id: 'bkSNwyl7iHE', title: '', channelId: YT });
});

test('tile#341: exactly two requests, both to the public keyless oEmbed — never the dead feed', async () => {
  const { doFetch, urls } = recorded();
  await resolveChannel(GD, doFetch);
  assert.deepEqual(urls, [
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DUU_x5XG1OV2P6uZZ5FSM9Ttw',
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DvLAegkGGWrM',
  ]);
  for (const u of urls) assert.ok(!/key=|token=|access|Authorization|feeds\//i.test(u), u);
  assert.equal(yt.uploadsOf(GD), 'UU_x5XG1OV2P6uZZ5FSM9Ttw');
  assert.equal(yt.uploadsOf('UUnot-a-channel-id'), null);
});

test('tile#341: the video id is read ONLY from an i.ytimg.com/vi/<id>/ thumbnail — anything else is no video', () => {
  const read = yt.latestFromUploadsOEmbed;
  assert.equal(read(FIX(`oembed-uploads-${YT}.json`)), 'bkSNwyl7iHE');
  assert.equal(read(FIX(`oembed-uploads-${GD}.json`)), 'vLAegkGGWrM');
  // a live stream's thumbnail and the webp path are the same video
  assert.equal(read(UPLOADS_OF('x', 'https://i.ytimg.com/vi/vLAegkGGWrM/hqdefault_live.jpg')), 'vLAegkGGWrM');
  assert.equal(read(UPLOADS_OF('x', 'https://i.ytimg.com/vi_webp/vLAegkGGWrM/hqdefault.webp')), 'vLAegkGGWrM');
  // 🔴 the playlist's `title` ("Uploads from …") and `html` (videoseries) never stand in for a video
  for (const thumb of [
    'https://example.com/vi/vLAegkGGWrM/hqdefault.jpg',          // another host
    'https://i.ytimg.com/pl_c/UU_x5XG1OV2P6uZZ5FSM9Ttw/cover.jpg', // a playlist cover, not a video
    'https://i.ytimg.com/vi/short/hqdefault.jpg',                 // not a video id
    'https://i.ytimg.com/vi/vLAegkGGWrM/../../x.jpg',             // a path that climbs
    'http://i.ytimg.com/vi/vLAegkGGWrM/hqdefault.jpg',            // not https
    '',
  ]) assert.equal(read(UPLOADS_OF('x', thumb)), null, thumb);
  for (const junk of [FIX('oembed-uploads-unknown.404.txt'), '', 'null', '[]', '{"thumbnail_url":7}', '<html>']) {
    assert.equal(read(junk), null, junk);
  }
  assert.equal(yt.titleFromOEmbed(FIX('oembed-video-vLAegkGGWrM.json')), 'Building with Gemini in Google Antigravity');
  assert.equal(yt.titleFromOEmbed(FIX('oembed-video-unknown.400.txt')), '');
});

test('tile#341: no uploads (or no such channel) is oEmbed’s 404 — null, the designed noposter state, no second request', async () => {
  const { doFetch, urls } = recorded();
  assert.equal(await resolveChannel(CH, doFetch), null);
  assert.deepEqual(urls, [UPLOADS_OE(CH)]);
});

test('tile#341: a title that fails or hangs costs the label, never the poster', async () => {
  const id = 'dQw4w9WgXcQ';
  const base = { [UPLOADS_OE(CH)]: ok(UPLOADS_OF(id)) };
  const thrown = recorded({ ...base, [VIDEO_OE(id)]: () => { throw new Error('network'); } });
  assert.deepEqual(await resolveChannel(CH, thrown.doFetch), { id, title: '', channelId: CH });
  const t0 = Date.now();
  const hung = recorded({ ...base, [VIDEO_OE(id)]: () => new Promise(() => {}) });
  assert.deepEqual(await resolveChannel(CH, hung.doFetch, 60), { id, title: '', channelId: CH });
  assert.ok(Date.now() - t0 < 1000, `waited ${Date.now() - t0}ms on a title that never arrives`);
  // a title is JSON: it arrives unescaped, and is used verbatim
  const amp = recorded({ ...base, [VIDEO_OE(id)]: ok(VIDEO_OF('Q&A: "live" <3')) });
  assert.equal((await resolveChannel(CH, amp.doFetch)).title, 'Q&A: "live" <3');
});

// ── tile#346 review P2: an oEmbed answer is bounded before it is parsed ────────────────────────────
// Written out rather than read from yt.OEMBED_MAX_BYTES, so these tests stay meaningful against code
// that has no ceiling at all.
const OEMBED_MAX = 8 * 1024;
/**
 * A real Response over a stream that serves `text` in `chunk`-byte pieces, and logs how many bytes
 * were pulled and whether it was cancelled. `length` sets a content-length header (none by default:
 * the body is chunked).
 */
const streamed = (text, { chunk = 1024, length } = {}) => {
  const bytes = new TextEncoder().encode(text);
  const log = { pulled: 0, cancelled: false };
  let at = 0;
  const body = new ReadableStream({
    pull(c) {
      if (at >= bytes.length) { c.close(); return; }
      const piece = bytes.slice(at, at + chunk);
      at += piece.length; log.pulled += piece.length;
      c.enqueue(piece);
    },
    cancel() { log.cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = length == null ? {} : { 'content-length': String(length) };
  return { res: new Response(body, { status: 200, headers }), log };
};
/** `json` with an unused field padding it to exactly `size` bytes */
const padTo = (json, size) => {
  const bare = Buffer.byteLength(JSON.stringify({ ...JSON.parse(json), unused: '' }));
  return JSON.stringify({ ...JSON.parse(json), unused: '0'.repeat(size - bare) });
};

test('🔴 tile#346: an oversized chunked uploads answer is cancelled while reading — null, the noposter state', async () => {
  const id = 'dQw4w9WgXcQ';
  // the review's input: the right thumbnail, plus an unused field of 4 MB, no content-length
  const big = streamed(padTo(UPLOADS_OF(id), 4 * 1024 * 1024));
  const { doFetch } = recorded({ [UPLOADS_OE(CH)]: big.res, [VIDEO_OE(id)]: ok(VIDEO_OF('x')) });
  assert.equal(await resolveChannel(CH, doFetch), null);
  assert.ok(big.log.cancelled, 'the oversized stream was not cancelled');
  assert.ok(big.log.pulled <= OEMBED_MAX + 1024, `read ${big.log.pulled} bytes of an oversized answer`);
});

test('🔴 tile#346: an oversized chunked title answer costs the title, never the poster', async () => {
  const id = 'dQw4w9WgXcQ';
  const big = streamed(padTo(VIDEO_OF('Too big'), 4 * 1024 * 1024));
  const { doFetch } = recorded({ [UPLOADS_OE(CH)]: ok(UPLOADS_OF(id)), [VIDEO_OE(id)]: big.res });
  assert.deepEqual(await resolveChannel(CH, doFetch), { id, title: '', channelId: CH });
  assert.ok(big.log.cancelled, 'the oversized stream was not cancelled');
  assert.ok(big.log.pulled <= OEMBED_MAX + 1024, `read ${big.log.pulled} bytes of an oversized answer`);
});

test('🔴 tile#346: an honest content-length over the ceiling is refused without reading the body', async () => {
  const id = 'dQw4w9WgXcQ';
  const text = padTo(UPLOADS_OF(id), 64 * 1024);
  const big = streamed(text, { length: Buffer.byteLength(text) });
  const { doFetch } = recorded({ [UPLOADS_OE(CH)]: big.res, [VIDEO_OE(id)]: ok(VIDEO_OF('x')) });
  assert.equal(await resolveChannel(CH, doFetch), null);
  assert.equal(big.log.pulled, 0, 'the body was read although its length was already over the ceiling');
  // and the same for the title: the poster stays, the title is empty
  const title = padTo(VIDEO_OF('Too big'), 64 * 1024);
  const bigTitle = streamed(title, { length: Buffer.byteLength(title) });
  const t = recorded({ [UPLOADS_OE(CH)]: ok(UPLOADS_OF(id)), [VIDEO_OE(id)]: bigTitle.res });
  assert.deepEqual(await resolveChannel(CH, t.doFetch), { id, title: '', channelId: CH });
  assert.equal(bigTitle.log.pulled, 0);
});

test('🔴 tile#346: exactly at the ceiling resolves; one byte over does not — streamed, unstreamed, and lying about its length', async () => {
  const id = 'dQw4w9WgXcQ';
  // a title with multi-byte characters, so the ceiling is counted in bytes, not characters
  const title = 'Ünïcödé — 🎬';
  const run = async (uploads, video) => resolveChannel(CH, recorded({ [UPLOADS_OE(CH)]: uploads, [VIDEO_OE(id)]: video }).doFetch);
  const atU = padTo(UPLOADS_OF(id), OEMBED_MAX), overU = padTo(UPLOADS_OF(id), OEMBED_MAX + 1);
  const atV = padTo(VIDEO_OF(title), OEMBED_MAX), overV = padTo(VIDEO_OF(title), OEMBED_MAX + 1);
  assert.equal(Buffer.byteLength(atV), OEMBED_MAX);
  assert.equal(Buffer.byteLength(overV), OEMBED_MAX + 1);
  const want = { id, title, channelId: CH };
  // at the ceiling: chunked, with an honest length, and as a plain text() answer
  assert.deepEqual(await run(streamed(atU, { chunk: 777 }).res, streamed(atV, { chunk: 777 }).res), want);
  assert.deepEqual(await run(streamed(atU, { length: OEMBED_MAX }).res, streamed(atV, { length: OEMBED_MAX }).res), want);
  assert.deepEqual(await run(ok(atU), ok(atV)), want);
  // one byte over: chunked, with a content-length that claims it fits, and as a plain text() answer
  assert.equal(await run(streamed(overU, { chunk: 777 }).res, ok(atV)), null);
  assert.equal(await run(streamed(overU, { length: 100 }).res, ok(atV)), null);
  assert.equal(await run(ok(overU), ok(atV)), null);
  for (const v of [streamed(overV, { chunk: 777 }).res, streamed(overV, { length: 100 }).res, ok(overV)]) {
    assert.deepEqual(await run(ok(atU), v), { id, title: '', channelId: CH });
  }
  assert.equal(yt.OEMBED_MAX_BYTES, OEMBED_MAX);
});

test('tile#341: the cardtile worker caches "latest" for 30 minutes, a video’s title and a handle page for a day', () => {
  assert.equal(typeof worker.ytCacheTtl, 'function');
  assert.equal(worker.ytCacheTtl(UPLOADS_OE(GD)), 1800);
  assert.equal(worker.ytCacheTtl(VIDEO_OE('vLAegkGGWrM')), 86400);
  assert.equal(worker.ytCacheTtl('https://www.youtube.com/@some.body'), 86400);
});

test('🔴 tile#341 end to end: recorded answers → the rendered page plays and shows that video through our own path', async () => {
  const { doFetch } = recorded();
  const md = CARD(`- [ ] %% card: video channel="${GD}" %%`);
  const videos = await resolveChannels(md, doFetch);
  const html = renderCardHTML(md, { handle: 't', videos }).replace(/<style[\s\S]*?<\/style>/g, '');
  assert.ok(html.includes('data-yt="vLAegkGGWrM"'), 'playback does not name the newest upload');
  assert.ok(html.includes(posterPath('vLAegkGGWrM')), 'no poster through /_yt/');
  assert.ok(html.includes('Building with Gemini in Google Antigravity'), 'the video title is not the label');
  assert.ok(!html.includes('st-embed-video-noposter'), 'still the noposter state');
  // condition 4: the oEmbed answer names i.ytimg.com — that address must never reach the markup
  assert.ok(!/i\.ytimg\.com/.test(html), 'a Google-hosted image in the page');
});

test('channelsIn reads the video cells, quoted or bare, and de-duplicates', () => {
  const md = CARD(`- [ ] %% card: video channel="${CH}" %% A
- [ ] %% card: video channel=${CH} %% B
- [ ] %% card: video yt=dQw4w9WgXcQ %% C`);
  assert.deepEqual(channelsIn(md), [CH]);
});

test('🔴 a channel id that is not a channel id never reaches a URL', async () => {
  // The card's markdown is creator-authored input, and this is the one place it touches the network.
  for (const bad of ['../../etc', 'UCshort', 'http://evil.example', 'UC' + 'x'.repeat(40)]) {
    assert.equal(CHANNEL_RE.test(bad), false, bad);
    let called = false;
    assert.equal(await resolveChannel(bad, async () => { called = true; return ok(''); }), null);
    assert.equal(called, false, `fetched for ${bad}`);
  }
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video channel="../../etc" %%`)), []);
});

test('🔴 condition 2: the cache key is the CHANNEL, so one channel is fetched once for N cards', async () => {
  const urls = [];
  const md = CARD(Array(3).fill(`- [ ] %% card: video channel="${CH}" %%`).join('\n'));
  await resolveChannels(md, async (u) => { urls.push(u); return u === UPLOADS_OE(CH) ? ok(UPLOADS_OF('dQw4w9WgXcQ')) : ok(VIDEO_OF('x')); });
  // one channel: its uploads oEmbed once, and its newest video's oEmbed once
  assert.deepEqual(urls, [UPLOADS_OE(CH), VIDEO_OE('dQw4w9WgXcQ')], 'the same channel was fetched more than once');
  // and it is the public, keyless oEmbed — no api key, no token, nothing of the creator's (condition 1)
  for (const u of urls) {
    assert.ok(u.startsWith('https://www.youtube.com/oembed?'), u);
    assert.ok(!/key=|token=|access|Authorization/i.test(u), u);
  }
});

test('🔴 condition 3: YouTube being down or slow never throws, it just resolves to nothing', async () => {
  assert.equal(await resolveChannel(CH, async () => { throw new Error('network'); }), null);
  assert.equal(await resolveChannel(CH, async () => ({ ok: false, text: async () => '' })), null);
  assert.deepEqual(await resolveChannels(CARD(`- [ ] %% card: video channel="${CH}" %%`), async () => { throw new Error('down'); }), {});
});

test('🔴 a hanging YouTube gives up the poster, not the card', async () => {
  // This now sits on the render path. Without a deadline a hung YouTube does not degrade the video
  // block — it holds the creator's whole page hostage, and every other condition stays satisfied
  // right up until the card never arrives.
  const t0 = Date.now();
  const got = await resolveChannel(CH, () => new Promise(() => {}), 60);
  assert.equal(got, null);
  assert.ok(Date.now() - t0 < 1000, `waited ${Date.now() - t0}ms on a fetch that never resolves`);
  // CONTROL: the same call with a fetch that DOES answer must return the video, or this test would
  // pass just as well against a resolver that always gives up.
  assert.deepEqual(
    await resolveChannel(CH, async (u) => (u === UPLOADS_OE(CH) ? ok(UPLOADS_OF('dQw4w9WgXcQ')) : ok(VIDEO_OF('x'))), 60),
    { id: 'dQw4w9WgXcQ', title: 'x', channelId: CH },
  );
});

// ── and the same four conditions, seen from the rendered card ────────────────────────────────────
// 🔴 Strip the stylesheet before asserting on any class name. The bundled CSS *mentions* every class
// it styles — `st-embed-video-noposter` included — so `html.includes('…noposter')` is true whether or
// not the element wears it, and an assertion that a class is ABSENT can never fail. This is not
// hypothetical: written without it, the "degraded state" test below passed while the markup said the
// opposite.
const markup = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '');

test('🔴 condition 4: no rendered card ever points a visitor’s browser at Google', () => {
  const resolved = renderCardHTML(CARD(`- [ ] %% card: video channel="${CH}" %% Latest`),
    { handle: 't', videos: { [CH]: { id: 'dQw4w9WgXcQ', title: 'The Newest One' } } });
  const plain = renderCardHTML(CARD('- [ ] %% card: video yt=dQw4w9WgXcQ %% One'), { handle: 't' });
  for (const [name, html] of [['resolved channel', resolved], ['static id', plain]]) {
    assert.ok(!/i\.ytimg\.com/.test(html), `${name} embeds a Google-hosted image`);
    assert.ok(!/<img[^>]+src="https?:\/\/(?!127\.)/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')),
      `${name} loads a cross-origin image on page load`);
  }
  assert.ok(resolved.includes(posterPath('dQw4w9WgXcQ')));
});

test('a resolved channel shows a poster, and poster and playback name the same video', () => {
  const html = markup(renderCardHTML(CARD(`- [ ] %% card: video channel="${CH}" %%`),
    { handle: 't', videos: { [CH]: { id: 'dQw4w9WgXcQ', title: 'The Newest One' } } }));
  assert.ok(html.includes(`data-yt="dQw4w9WgXcQ"`), 'playback does not name the resolved video');
  assert.ok(html.includes(posterPath('dQw4w9WgXcQ')), 'no poster');
  assert.ok(!html.includes('st-embed-video-noposter'), 'still wearing the degraded state');
  assert.ok(html.includes('The Newest One'), 'the entry title is not used as the label');
});

test('🔴 unresolved falls back to the DESIGNED degraded state, not to a black box', () => {
  // The whole reason condition 3 exists. This is the render when YouTube could not be reached.
  const html = markup(renderCardHTML(CARD(`- [ ] %% card: video channel="${CH}" %% Latest video`), { handle: 't' }));
  assert.ok(html.includes('st-embed-video-noposter'), 'the degraded state is not applied');
  assert.ok(html.includes(`data-yt-channel="${CH}"`), 'playback is lost — pressing play must still work');
  assert.ok(html.includes('Latest video'), 'the label is gone, so it reads as broken rather than unopened');
  assert.ok(!/_yt\//.test(html), 'points at a poster that cannot exist');
});

test('an author’s own poster is never overridden by resolution', () => {
  const html = renderCardHTML(CARD(`- [ ] %% card: video channel="${CH}" poster="https://example.com/mine.jpg" %%`),
    { handle: 't', videos: { [CH]: { id: 'dQw4w9WgXcQ', title: 'x' } } });
  assert.ok(html.includes('https://example.com/mine.jpg'));
  assert.ok(!html.includes(posterPath('dQw4w9WgXcQ')));
});

test('VIDEO_RE is what stands between the poster route and an open proxy', () => {
  for (const bad of ['../../secret', 'a'.repeat(50), 'short', '']) assert.equal(VIDEO_RE.test(bad), false, bad);
  assert.equal(VIDEO_RE.test('dQw4w9WgXcQ'), true);
});

// ---- @handle: what a creator actually knows about their channel ---------------------------------

const HANDLE = '@some.body';
// Shaped like the real page: three OTHER channels' ids in the JSON before the page names itself.
const PAGE = (id) => `<!doctype html><html><head>
<link rel="canonical" href="https://www.youtube.com/channel/${id}">
<meta itemprop="identifier" content="${id}">
</head><body><script>var ytInitialData = {"channelId":"UCdecoy00000000000000001","x":{"channelId":"UCdecoy00000000000000002"}}</script></body></html>`;

test('channelsIn reads a handle as well as a UC id, quoted or bare, and nothing else', () => {
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video channel=${HANDLE} %% x\n- [ ] %% card: video channel="${CH}" %%`)), [HANDLE, CH]);
  for (const bad of ['@ab', '@', '@!bang']) {   // too short, empty, not a handle
    assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video channel=${bad} %%`)), [], bad);
  }
  assert.ok(HANDLE_RE.test('@somebody') && HANDLE_RE.test('@a.b-c_d') && !HANDLE_RE.test('somebody'));
});

test('🔴 the page’s own id is the identifier meta — the first "channelId" in its JSON is someone else’s', () => {
  const html = PAGE(CH);
  assert.equal(channelIdFromPage(html), CH);
  assert.notEqual(channelIdFromPage(html), 'UCdecoy00000000000000001');
  // canonical link alone is enough; a page that names nobody resolves to nobody
  assert.equal(channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${CH}">`), CH);
  assert.equal(channelIdFromPage('<html>nothing here</html>'), null);
});

test('resolveHandle: the handle page, and only that page; 404 (no such handle) is null, never a throw', async () => {
  const urls = [];
  assert.equal(await resolveHandle(HANDLE, async (u) => { urls.push(u); return ok(PAGE(CH)); }), CH);
  assert.deepEqual(urls, [`https://www.youtube.com/${HANDLE}`]);
  assert.equal(await resolveHandle(HANDLE, async () => ({ ok: false, text: async () => '' })), null);
  assert.equal(await resolveHandle(HANDLE, async () => { throw new Error('network'); }), null);
  let called = false;
  assert.equal(await resolveHandle('not-a-handle', async () => { called = true; return ok(PAGE(CH)); }), null);
  assert.equal(called, false, 'a non-handle never reaches a URL');
});

test('resolveChannel with a handle: page then oEmbeds, keyed by the handle the card wrote, carrying the UC id', async () => {
  const urls = [];
  const doFetch = async (u) => {
    urls.push(u);
    if (u === UPLOADS_OE(CH)) return ok(UPLOADS_OF('dQw4w9WgXcQ'));
    if (u === VIDEO_OE('dQw4w9WgXcQ')) return ok(VIDEO_OF('The Newest One'));
    return ok(PAGE(CH));
  };
  assert.deepEqual(await resolveChannel(HANDLE, doFetch), { id: 'dQw4w9WgXcQ', title: 'The Newest One', channelId: CH });
  assert.deepEqual(urls, [`https://www.youtube.com/${HANDLE}`, UPLOADS_OE(CH), VIDEO_OE('dQw4w9WgXcQ')]);
  // the UC form carries channelId too, so the renderer has one shape to read
  assert.deepEqual(await resolveChannel(CH, doFetch), { id: 'dQw4w9WgXcQ', title: 'The Newest One', channelId: CH });
  // a handle that does not resolve is the degraded state — oEmbed is never asked
  const asked = [];
  assert.equal(await resolveChannel(HANDLE, async (u) => { asked.push(u); return { ok: false, text: async () => '' }; }), null);
  assert.equal(asked.length, 1);
  const all = await resolveChannels(CARD(`- [ ] %% card: video channel=${HANDLE} %%\n- [ ] %% card: video channel=${CH} %%`), doFetch);
  assert.deepEqual(Object.keys(all).sort(), [HANDLE, CH].sort());
});

test('render: a handle card plays the resolved uploads playlist; unresolved, its button opens the channel', () => {
  const md = `- [ ] %% card: video channel=${HANDLE} %% Latest`;
  const resolved = renderCardHTML(CARD(md), { handle: 't', videos: { [HANDLE]: { id: 'dQw4w9WgXcQ', title: 'T', channelId: CH } } });
  assert.match(resolved, /data-yt="dQw4w9WgXcQ"/);
  assert.doesNotMatch(resolved, /data-yt-handle="/);   // the attribute — the inline player script names it too
  const degraded = renderCardHTML(CARD(md), { handle: 't', videos: {} });
  assert.ok(degraded.includes(`data-yt-handle="${HANDLE}"`), 'the button carries the handle the card wrote');

  assert.doesNotMatch(degraded, /data-yt-channel="/, 'a handle must never be turned into list=UU…');
  assert.doesNotMatch(degraded, /i\.ytimg\.com/);
});

test('🔴 #1929: channelsIn reads a NAME whole — `yt-channel=` is not `channel=` (the renderer already says so)', () => {
  // The renderer reads `yt-channel=` as the key `yt-channel` (parseParams takes a name whole), so
  // `p.channel` is unset and the card draws no channel video. channelsIn used to run \bchannel=
  // over the raw text, where `-` is a word boundary: the Worker made an upstream request for a
  // reference the card never uses.
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video yt-channel="${CH}" %% x`)), [], 'hyphenated prefix');
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video my-yt-channel=${HANDLE} %% x`)), [], 'two hyphens deep');
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video x_channel=${CH} %% x`)), [], 'underscore prefix');
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video a--channel=${CH} %% x`)), [], 'word, then a run of hyphens');
  // CONTROLS: the plain spellings still resolve, and so does a leading `--` (parseParams drops a
  // hyphen run BEFORE the first word character: `--wide=1` is `wide`).
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video channel="${CH}" %% x`)), [CH]);
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video --channel=${HANDLE} %%`)), [HANDLE]);
  assert.deepEqual(channelsIn(CARD(`- [ ] %% card: video yt-channel="${CH}" channel=${HANDLE} %%`)), [HANDLE], 'the real one beside the decoy');
});

// ── the two readers of a `channel=` token ───────────────────────────────────────────────────────
// A Card line is read twice: channelsIn (the Worker, BEFORE rendering, to decide what to fetch) and
// the renderer (to decide what to draw). Since tile#325 both take the params from parseCard, i.e.
// parseParams, so these hold by construction; they stay as the spacing case's own record. The param grammar has one assignment form —
// the name, `=`, the value, nothing between them — and that is how every other Card parameter is
// read and written (parseParams' token scan; card-core's setToken/removeToken). A space on either
// side of the `=` is not an assignment: parseParams leaves the name without a value.
const SPACED = [
  ['space on both sides', (v) => `channel = ${v}`],
  ['space before the =', (v) => `channel =${v}`],
  ['space after the =', (v) => `channel= ${v}`],
  ['tab on both sides', (v) => `channel\t=\t${v}`],
  ['spaced, quoted', (v) => `channel = "${v}"`],
];
const TIGHT = [
  ['bare', (v) => `channel=${v}`],
  ['quoted', (v) => `channel="${v}"`],
];
const LINE = (params) => `- [ ] %% card: video ${params} %% x`;

test('🔴 channelsIn: `channel = x` is not an assignment — no upstream request for a channel the card does not draw', async () => {
  for (const ref of [CH, HANDLE]) {
    for (const [name, write] of SPACED) {
      assert.deepEqual(channelsIn(CARD(LINE(write(ref)))), [], `${name}: ${write(ref)}`);
    }
    // CONTROLS: the one assignment form still resolves.
    for (const [name, write] of TIGHT) {
      assert.deepEqual(channelsIn(CARD(LINE(write(ref)))), [ref], `${name}: ${write(ref)}`);
    }
  }
  assert.deepEqual(channelsIn(CARD(LINE(`channel = ${CH} channel=${HANDLE}`))), [HANDLE], 'the real one beside the spaced one');
  // and nothing is fetched for it
  let calls = 0;
  const got = await resolveChannels(CARD(LINE(`channel = ${CH}`)), async () => { calls++; return ok(UPLOADS_OF('dQw4w9WgXcQ')); });
  assert.deepEqual(got, {});
  assert.equal(calls, 0, 'no request');
});

test('parseParams: `channel = x` sets no channel, so the card draws no channel video — the same answer channelsIn gives', () => {
  const draw = (params) => markup(renderCardHTML(CARD(LINE(params)), { handle: 't', videos: {} }));
  for (const ref of [CH, HANDLE]) {
    for (const [name, write] of SPACED) {
      assert.equal(typeof parseParams(`video ${write(ref)}`).channel, 'undefined', `${name}: ${write(ref)}`);
      assert.doesNotMatch(draw(write(ref)), /data-yt-(channel|handle)="/, `${name}: nothing to play`);
    }
    for (const [name, write] of TIGHT) {
      assert.equal(parseParams(`video ${write(ref)}`).channel, ref, name);
      assert.match(draw(write(ref)), /data-yt-(channel|handle)="/, `${name}: the card has a channel to play`);
    }
    // The agreement itself, form by form: a reference is fetched exactly when it is drawn.
    for (const [name, write] of [...SPACED, ...TIGHT]) {
      const drawn = parseParams(`video ${write(ref)}`).channel === ref;
      assert.equal(channelsIn(CARD(LINE(write(ref)))).includes(ref), drawn, `${name}: fetched if and only if drawn`);
    }
  }
});

// ── tile#325: fetched ⇔ drawn, read off the rendered markup ─────────────────────────────────────
// channelsIn used to pattern-match `channel=` over the raw markdown; the renderer reads the `channel`
// param of a video cell off parseParams' token stream. Every line below is rendered, and what the
// Worker REQUESTS (the URLs resolveChannels hands the fetch) must be exactly the references the
// rendered markup carries — `data-yt-channel` / `data-yt-handle`, which is what an unresolved video
// cell plays from. Not a second reading of the params: the markup is the renderer's own answer.
const requested = async (md) => {
  const urls = [];
  // not ok: nothing resolves, so a handle is asked for once (its page) and the markup keeps the
  // reference exactly as the card wrote it
  await resolveChannels(md, async (u) => { urls.push(u); return { ok: false, text: async () => '' }; });
  return urls.map((u) => {
    const uploads = /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fplaylist%3Flist%3DUU([\w-]{22})$/.exec(u);
    if (uploads) return `UC${uploads[1]}`;
    const page = /^https:\/\/www\.youtube\.com\/(@[^/?#]+)$/.exec(u);
    assert.ok(page, `an upstream request that is neither an uploads oEmbed nor a handle page: ${u}`);
    return page[1];
  }).sort();
};
const drawnRefs = (md) => {
  const html = renderCardHTML(md, { handle: 't', videos: {} })
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const refs = [...html.matchAll(/\sdata-yt-(?:channel|handle)="([^"]*)"/g)].map((m) => m[1]);
  // a value the renderer draws but no fetch could ever be made for (`data-yt-handle="&quot;UC…"`) is
  // not a reference; isChannelRef is resolveChannel's own gate
  return [...new Set(refs.filter(isChannelRef))].sort();
};
const VID = (params, body = 'x') => `- [ ] %% card: video ${params} %% ${body}`;
const FETCH_CASES = (ref) => [
  // the issue's cases — each was an over-fetch: requested, never drawn
  ['unbalanced opening quote', CARD(VID(`channel="${ref}`)), []],
  ['unbalanced closing quote', CARD(VID(`channel=${ref}"`)), []],
  ['trailing comma', CARD(VID(`channel=${ref},`)), []],
  ['trailing !x', CARD(VID(`channel=${ref}!x`)), []],
  ['trailing /videos', CARD(VID(`channel=${ref}/videos`)), []],
  ['inside a quoted value', CARD(VID(`note="see channel=${ref} here"`)), []],
  ['inside a URL value', CARD(VID(`note=https://x/?channel=${ref}`)), []],
  ['in the body text after the marker', CARD(VID('title=x', `watch channel=${ref}`)), []],
  // the same class, found on the way: a `channel=` that is not a video cell's param at all
  ['a link cell', CARD(`- [ ] %% card: link channel=${ref} %% [a](https://example.com)`), []],
  ['the frontmatter', CARD('').replace('title: T', `title: T\nnote: channel=${ref}`), []],
  ['outside any lane', CARD('').replace('\n## grid', `\n- [ ] %% card: video channel=${ref} %% x\n\n## grid`), []],
  ['the assets lane', CARD('') + `\n## assets\n\n- [ ] %% card: asset id=a channel=${ref} %% x\n`, []],
  ['a bare channel flag', CARD(VID(`channel ${ref}`)), []],
  // and the one under-fetch: padded inside its quotes, the renderer trims it and draws it
  ['padded inside its quotes', CARD(VID(`channel=" ${ref} "`)), [ref]],
  // CONTROLS — the tight forms, which must be fetched, or this test would pass against a channelsIn
  // that fetches nothing
  ['bare', CARD(VID(`channel=${ref}`)), [ref]],
  ['quoted', CARD(VID(`channel="${ref}"`)), [ref]],
  ['on a back (drawer)', CARD(VID('yt=dQw4w9WgXcQ')) + `\n## back: more\n\n${VID(`channel=${ref}`)}\n`, [ref]],
  ['the real one beside a decoy', CARD(VID(`note="channel=${CH}x" channel=${ref}`)), [ref]],
  // parseCard strips an archive home token (`%%tg-home:<lane>%%`, tugtile's stripHomeToken) from a
  // cell's first line BEFORE parseParams reads it, joining the text on either side. So the param name
  // the renderer reads need not appear anywhere in the raw markdown: `chan%%tg-home:grid%%nel=` is
  // drawn as `channel=`. Every split of the word, and the review's own input verbatim (no body).
  ...[...Array('channel'.length - 1).keys()].map((i) => [
    `the name split by a home token after "${'channel'.slice(0, i + 1)}"`,
    CARD(VID(`${'channel'.slice(0, i + 1)}%%tg-home:grid%%${'channel'.slice(i + 1)}=${ref}`)), [ref]]),
  ['the name split by a home token, no body', CARD(`- [ ] %% card: video chan%%tg-home:grid%%nel=${ref} %%`), [ref]],
  // CONTROL: the same split line with an unrelated line holding the word. Discovery must not depend
  // on prose elsewhere in the Card — both this and the line above are drawn, so both are fetched.
  ['the split name, and the word on an unrelated line', CARD(`- [ ] %% card: video chan%%tg-home:grid%%nel=${ref} %%\n- [ ] a note about my channel`), [ref]],
];

test('🔴 tile#325: resolveChannels requests exactly the channels the rendered markup carries', async () => {
  let walked = 0;
  const wrong = [];
  for (const ref of [CH, HANDLE]) {
    for (const [name, md, want] of FETCH_CASES(ref)) {
      const drawn = drawnRefs(md);
      // the expectation is the renderer's, checked first, so a case that stopped meaning what it
      // says fails here rather than agreeing with a wrong channelsIn
      assert.deepEqual(drawn, want, `${name} (${ref}): the card draws ${JSON.stringify(drawn)}`);
      const got = await requested(md);
      const listed = channelsIn(md).sort();
      if (JSON.stringify(got) !== JSON.stringify(drawn) || JSON.stringify(listed) !== JSON.stringify(drawn)) {
        wrong.push(`${name} (${ref}): requested ${JSON.stringify(got)}, channelsIn ${JSON.stringify(listed)}, drawn ${JSON.stringify(drawn)}`);
      }
      walked++;
    }
  }
  assert.equal(walked, 2 * FETCH_CASES(CH).length);
  assert.deepEqual(wrong, [], `${wrong.length} of ${walked} lines are fetched ≠ drawn:\n  ${wrong.join('\n  ')}`);
});

test('🔴 tile#325 review: the review’s own Card, verbatim — a home token inside the name, and its control', async () => {
  // No literal `channel` anywhere in this Card, yet its one video cell is drawn with that handle.
  const md = '---\ncard-page: t\ntitle: T\n---\n## grid\n- [ ] %% card: video chan%%tg-home:grid%%nel=@a.b-c_d %%\n';
  assert.equal(md.includes('channel'), false);
  assert.deepEqual(drawnRefs(md), ['@a.b-c_d']);
  // CONTROL: an unrelated trailing line that holds the word changes nothing about the cell.
  const control = md + 'my channel\n';
  assert.deepEqual(drawnRefs(control), ['@a.b-c_d']);
  assert.deepEqual(channelsIn(control), ['@a.b-c_d']);
  assert.deepEqual(await requested(control), ['@a.b-c_d']);
  // and the Card without the word is fetched the same
  assert.deepEqual(channelsIn(md), ['@a.b-c_d']);
  assert.deepEqual(await requested(md), ['@a.b-c_d']);
});
