// Resolving "my latest video" — the four conditions, as tests.
//
//   node --test packages/cardtile/yt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestFromFeed, resolveChannel, resolveHandle, channelIdFromPage, posterPath, CHANNEL_RE, VIDEO_RE, HANDLE_RE, isChannelRef } from './yt.mjs';
import * as YC from './yt-channels.mjs';
import { channelsIn, resolveChannels } from './yt-channels.mjs';
import { renderCardHTML } from './serve/card-worker.mjs';
import { parseParams } from '../sitetile/site-core.js';

const CH = 'UCabcdefghijklmnopqrstuv';          // UC + 22
// A whole Card around some lines. channelsIn reads the Card as the renderer does (parseCard), and a
// line outside any `## lane` is not a cell, so every channelsIn input below is a real Card.
const CARD = (block) => `---\ncard-page: t\ntitle: T\naccent: #0556ff\n---\n\n## grid\n\n${block}\n`;
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
  assert.deepEqual(await resolveChannels(CARD(`- [ ] %% card: video channel="${CH}" %%`), async () => { throw new Error('down'); }), {});
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
  const got = await resolveChannels(CARD(LINE(`channel = ${CH}`)), async () => { calls++; return ok(FEED('dQw4w9WgXcQ', 't')); });
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
    const feed = /[?&]channel_id=([^&]+)$/.exec(u);
    if (feed) return feed[1];
    const page = /^https:\/\/www\.youtube\.com\/(@[^/?#]+)$/.exec(u);
    assert.ok(page, `an upstream request that is neither a feed nor a handle page: ${u}`);
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

// ── tile#355: resolution within a share of the subrequest budget ──────────────────────────────────
// The page-view numbers (30, 40, 60 channels against the 50 an invocation has) are in
// serve/cardtile-picture-cache.test.mjs; these hold the rule itself.
const UC = (i) => `UC${String(i).padStart(22, '0')}`;
const LATEST_OF = (ref) => ref.replace(/\W/g, '').slice(-11).padStart(11, 'v');
/** a fake YouTube that answers every handle and feed, counting */
const answering = () => {
  const urls = [];
  const doFetch = async (u) => {
    urls.push(u);
    const h = /youtube\.com\/(@[\w.-]+)$/.exec(u);
    if (h) return ok(`<meta itemprop="identifier" content="${UC(h[1].slice(1))}">`);
    const f = /channel_id=(UC[\w-]{22})$/.exec(u);
    return ok(FEED(LATEST_OF(f[1]), 't'));
  };
  return { urls, doFetch };
};

test('🔴 #355 resolveChannels — past the share, fetching stops at the first channel whose worst case does not fit', async () => {
  // @h01 (2) + UC 1 (1) + @h02 (2) = 5 of a share of 6; the next handle needs 2 and only 1 is left
  const refs = ['@h01', UC(1), '@h02', '@h03', UC(2)];
  const md = CARD(refs.map((r) => `- [ ] %% card: video channel=${r} %%`).join('\n'));
  const { urls, doFetch } = answering();
  const got = await resolveChannels(md, doFetch, { subrequests: 6 });
  assert.deepEqual(Object.keys(got), ['@h01', UC(1), '@h02'], 'not the first channels that fit');
  assert.equal(urls.length, 5);
  assert.ok(!urls.some((u) => u.endsWith(UC(2))), 'a later, cheaper channel was fetched past the first one that did not fit');
  assert.equal(YC.channelFetches('@h01'), 2);
  assert.equal(YC.channelFetches(UC(1)), 1);
});

test('🔴 #355 resolveChannels — within the share, every channel is fetched and memory is never read', async () => {
  const md = CARD([UC(1), UC(2)].map((r) => `- [ ] %% card: video channel=${r} %%`).join('\n'));
  const kept = YC.keptChannels();
  kept.set(UC(1), { id: 'remembered1', title: 'old', channelId: UC(1) }, new Headers({ age: '0' }));
  const { urls, doFetch } = answering();
  const got = await resolveChannels(md, doFetch, { subrequests: 2, kept });
  assert.equal(urls.length, 2);
  assert.equal(got[UC(1)].id, LATEST_OF(UC(1)), 'a page within its share was answered from memory');
});

test('🔴 #355 keptChannels — an answer expires after CHANNEL_KEPT_SECONDS, failures are never kept, the oldest goes first', () => {
  let now = 1_000_000;
  const kept = YC.keptChannels({ most: 2, now: () => now });
  const fresh = new Headers({ age: '0' });
  kept.set('a', { id: 'x' }, fresh);
  kept.set('b', null, fresh);
  assert.equal(kept.get('b'), null, 'a failure was remembered');
  now += YC.CHANNEL_KEPT_SECONDS * 1000 - 1;
  assert.deepEqual(kept.get('a'), { id: 'x' });
  now += 1;
  assert.equal(kept.get('a'), null, 'an answer outlived the feed TTL');
  kept.set('c', { id: 'c' }, fresh);
  kept.set('d', { id: 'd' }, fresh);
  kept.set('e', { id: 'e' }, fresh);
  assert.equal(kept.size, 2);
  assert.equal(kept.get('c'), null, 'the oldest was not the one evicted');
  assert.equal(YC.CHANNEL_KEPT_SECONDS, 1800);
});

// ── tile#357 review: memory never outlives the edge copy an answer came from ─────────────────────────
// The feed is fetched through the edge cache with an 1800 s TTL (serve/card-worker.mjs ytFetch). An
// answer that arrives already 1799 s old has 1 s of freshness left; remembering it for a fresh 1800 s
// showed a visitor the previous "latest video" for up to 3599 s after an upload.
const feedWith = (headers, id) => ({ ok: true, headers: new Headers(headers), text: async () => FEED(id, 't') });
const agedFeed = (headers) => async (u) => {
  const f = /channel_id=(UC[\w-]{22})$/.exec(u);
  return f ? feedWith(headers, LATEST_OF(f[1])) : ok(`<meta itemprop="identifier" content="${UC(9)}">`);
};

test('🔴 #357 resolveChannels — an answer that arrives 1799 s old is remembered for 1 s, not 1800', async () => {
  let now = 1_799_000;
  const kept = YC.keptChannels({ now: () => now });
  const md = CARD(`- [ ] %% card: video channel=${UC(1)} %%`);
  await resolveChannels(md, agedFeed({ age: '1799' }), { kept });
  assert.equal(kept.get(UC(1))?.id, LATEST_OF(UC(1)), 'CONTROL: the answer was remembered');
  now += 1000;   // 1800 s of the edge copy's age: the edge asks YouTube again now, so must memory
  assert.equal(kept.get(UC(1)), null, 'memory outlived the edge copy the answer came from');
});

test('🔴 #357 resolveChannels — a handle is remembered for its feed’s age, not its handle page’s', async () => {
  let now = 0;
  const kept = YC.keptChannels({ now: () => now });
  const md = CARD('- [ ] %% card: video channel=@aged %%');
  const doFetch = async (u) => (/channel_id=/.test(u)
    ? feedWith({ age: '1700' }, 'aaaaaaaaaaa')
    : { ok: true, headers: new Headers({ age: '0' }), text: async () => `<meta itemprop="identifier" content="${UC(9)}">` });
  await resolveChannels(md, doFetch, { kept });
  now = 99_000;
  assert.equal(kept.get('@aged')?.id, 'aaaaaaaaaaa', 'CONTROL: remembered');
  now = 100_000;
  assert.equal(kept.get('@aged'), null, 'the handle page’s age was used, not the feed’s');
});

test('🔴 #357 keptChannels — Date counts as well as Age; the older reading wins', () => {
  const now = Date.parse('2026-01-01T00:30:00Z');
  const old = 'Thu, 01 Jan 2026 00:00:01 GMT';   // 1799 s before `now`
  assert.equal(YC.upstreamAge(new Headers({ date: old, age: '5' }), now), 1799);
  assert.equal(YC.upstreamAge(new Headers({ date: 'Thu, 01 Jan 2026 00:29:59 GMT', age: '600' }), now), 600);
  assert.equal(YC.upstreamAge(new Headers({ date: 'Thu, 01 Jan 2026 01:00:00 GMT' }), now), 0, 'a Date ahead of this clock is not a negative age');
  let t = now;
  const kept = YC.keptChannels({ now: () => t });
  kept.set('d', { id: 'd' }, new Headers({ date: old }));
  assert.equal(kept.get('d')?.id, 'd', 'CONTROL: 1 s left, remembered');
  t += 1000;
  assert.equal(kept.get('d'), null, 'a Date-aged answer outlived its edge copy');
  kept.set('d', { id: 'd' }, new Headers({ date: old }));   // now 1800 s old: nothing left
  assert.equal(kept.size, 0, 'an answer with no freshness left was remembered');
});

test('🔴 #357 keptChannels — an answer whose age nothing states is not remembered', async () => {
  const kept = YC.keptChannels();
  kept.set('a', { id: 'a' });
  kept.set('b', { id: 'b' }, new Headers());
  kept.set('c', { id: 'c' }, new Headers({ age: 'soon', date: 'not a date' }));
  assert.equal(kept.size, 0);
  const md = CARD(`- [ ] %% card: video channel=${UC(1)} %%`);
  const got = await resolveChannels(md, async () => ok(FEED('bbbbbbbbbbb', 't')), { kept });
  assert.equal(got[UC(1)].id, 'bbbbbbbbbbb', 'CONTROL: the page still got its answer');
  assert.equal(kept.size, 0, 'an answer with no age was remembered');
});

test('🔴 #357 keptChannels — a later view of the same old edge copy cannot move the expiry later', async () => {
  // the edge cached its copy at 0 s. A view at 100 s (age 100) and a smaller page at 1700 s (age 1700)
  // both remember it; either way it is gone from memory at 1800 s.
  let now = 100_000;
  const kept = YC.keptChannels({ now: () => now });
  const md = CARD(`- [ ] %% card: video channel=${UC(1)} %%`);
  await resolveChannels(md, agedFeed({ age: '100' }), { kept });
  now = 1_700_000;
  await resolveChannels(md, agedFeed({ age: '1700' }), { kept });
  now = 1_799_999;
  assert.ok(kept.get(UC(1)), 'CONTROL: still within the edge copy’s TTL');
  now = 1_800_000;
  assert.equal(kept.get(UC(1)), null, 'a refresh from the same edge copy pushed the expiry past it');
});
