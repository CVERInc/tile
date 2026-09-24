// Resolving "my latest video" — the four conditions, as tests.
//
//   node --test packages/cardtile/yt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsIn, latestFromFeed, resolveChannel, resolveChannels, resolveHandle, channelIdFromPage, posterPath, CHANNEL_RE, VIDEO_RE, HANDLE_RE } from './yt.mjs';
import { renderCardHTML } from './serve/card-worker.mjs';

const CH = 'UCabcdefghijklmnopqrstuv';          // UC + 22
const FEED = (id, title) => `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>The Channel Itself</title>
  <link rel="alternate" href="https://www.youtube.com/channel/${CH}"/>
  <entry>
    <yt:videoId>${id}</yt:videoId>
    <title>${title}</title>
  </entry>
  <entry><yt:videoId>OLDER123456</yt:videoId><title>An older one</title></entry>
</feed>`;
const ok = (body) => ({ ok: true, text: async () => body });

test('the newest entry wins, and its title is the ENTRY’s not the CHANNEL’s', () => {
  const got = latestFromFeed(FEED('dQw4w9WgXcQ', 'The Newest One'));
  assert.deepEqual(got, { id: 'dQw4w9WgXcQ', title: 'The Newest One' });
});

test('🔴 a document-wide search would return the channel name — the entry is read within its bounds', () => {
  // The channel's <title> and <link> come FIRST in the document. A regex that is not scoped to the
  // entry returns "The Channel Itself", which is a card that says it is showing a video and is not.
  const xml = FEED('dQw4w9WgXcQ', 'The Newest One');
  assert.ok(xml.indexOf('The Channel Itself') < xml.indexOf('<entry>'));
  assert.equal(latestFromFeed(xml).title, 'The Newest One');
});

test('entities in a title are unescaped once, and & survives', () => {
  assert.equal(latestFromFeed(FEED('dQw4w9WgXcQ', 'Q&amp;A: &quot;live&quot; &lt;3')).title, 'Q&A: "live" <3');
});

test('a feed with no entries, or a junk id, resolves to null rather than a broken video', () => {
  assert.equal(latestFromFeed('<feed><title>Empty</title></feed>'), null);
  assert.equal(latestFromFeed(''), null);
  assert.equal(latestFromFeed(FEED('tooshort', 'x')), null);
});

test('channelsIn reads the raw markdown, quoted or bare, and de-duplicates', () => {
  const md = `- [ ] %% card: video channel="${CH}" %% A
- [ ] %% card: video channel=${CH} %% B
- [ ] %% card: video yt=dQw4w9WgXcQ %% C`;
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
  assert.deepEqual(channelsIn(`channel="../../etc"`), []);
});

test('🔴 condition 2: the cache key is the CHANNEL, so one channel is fetched once for N cards', async () => {
  const urls = [];
  const md = `channel="${CH}"\nchannel="${CH}"\nchannel="${CH}"`;
  await resolveChannels(md, async (u) => { urls.push(u); return ok(FEED('dQw4w9WgXcQ', 'x')); });
  assert.equal(urls.length, 1, 'the same channel was fetched more than once');
  assert.ok(urls[0].includes(`channel_id=${CH}`));
  // and it is the public, keyless feed — no api key, no token, nothing of the creator's (condition 1)
  assert.ok(urls[0].startsWith('https://www.youtube.com/feeds/videos.xml?'));
  assert.ok(!/key=|token=|access|Authorization/i.test(urls[0]));
});

test('🔴 condition 3: YouTube being down or slow never throws, it just resolves to nothing', async () => {
  assert.equal(await resolveChannel(CH, async () => { throw new Error('network'); }), null);
  assert.equal(await resolveChannel(CH, async () => ({ ok: false, text: async () => '' })), null);
  assert.deepEqual(await resolveChannels(`channel="${CH}"`, async () => { throw new Error('down'); }), {});
});

test('🔴 a hanging YouTube gives up the poster, not the card', async () => {
  // This now sits on the render path. Without a deadline a hung feed does not degrade the video
  // block — it holds the creator's whole page hostage, and every other condition stays satisfied
  // right up until the card never arrives.
  const t0 = Date.now();
  const got = await resolveChannel(CH, () => new Promise(() => {}), 60);
  assert.equal(got, null);
  assert.ok(Date.now() - t0 < 1000, `waited ${Date.now() - t0}ms on a fetch that never resolves`);
  // CONTROL: the same call with a fetch that DOES answer must return the video, or this test would
  // pass just as well against a resolver that always gives up.
  assert.deepEqual(
    await resolveChannel(CH, async () => ok(FEED('dQw4w9WgXcQ', 'x')), 60),
    { id: 'dQw4w9WgXcQ', title: 'x', channelId: CH },
  );
});

// ── and the same four conditions, seen from the rendered card ────────────────────────────────────
const CARD = (block) => `---\ncard-page: t\ntitle: T\naccent: #0556ff\n---\n\n## grid\n\n${block}\n`;
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
  assert.deepEqual(channelsIn(`- [ ] %% card: video channel=${HANDLE} %% x\n- [ ] %% card: video channel="${CH}" %%`), [HANDLE, CH]);
  assert.deepEqual(channelsIn('channel=@ab channel=@ channel=@!bang'), []);   // too short, empty, not a handle
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

test('resolveChannel with a handle: page then feed, keyed by the handle the card wrote, carrying the UC id', async () => {
  const urls = [];
  const doFetch = async (u) => {
    urls.push(u);
    return u.includes('/feeds/') ? ok(FEED('dQw4w9WgXcQ', 'The Newest One')) : ok(PAGE(CH));
  };
  assert.deepEqual(await resolveChannel(HANDLE, doFetch), { id: 'dQw4w9WgXcQ', title: 'The Newest One', channelId: CH });
  assert.deepEqual(urls, [`https://www.youtube.com/${HANDLE}`, `https://www.youtube.com/feeds/videos.xml?channel_id=${CH}`]);
  // the UC form carries channelId too, so the renderer has one shape to read
  assert.deepEqual(await resolveChannel(CH, async () => ok(FEED('dQw4w9WgXcQ', 'x'))), { id: 'dQw4w9WgXcQ', title: 'x', channelId: CH });
  // a handle that does not resolve is the degraded state — the feed is never asked
  const asked = [];
  assert.equal(await resolveChannel(HANDLE, async (u) => { asked.push(u); return { ok: false, text: async () => '' }; }), null);
  assert.equal(asked.length, 1);
  const all = await resolveChannels(`channel=${HANDLE} channel=${CH}`, doFetch);
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
