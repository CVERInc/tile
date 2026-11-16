// Resolving "my latest video" — the one quadrant the admissibility rule left open.
//
// SPEC-card-draft.md, "Live blocks": a live block is admissible when all four hold —
//   1. the fetch is to a public, keyless, cacheable endpoint
//   2. the cache key is not the card (per-channel), so cost does not scale with cards
//   3. it degrades to a static state that does not look broken
//   4. 🔴 the visitor's browser never talks to the third party before they choose to
//
// (3) shipped already (924eed1). This is (1), (2) and (4).
//
// The endpoint is YouTube's oEmbed, asked about the channel's UPLOADS playlist (`UC…` → `UU…`):
//   /oembed?format=json&url=https://www.youtube.com/playlist?list=UU…
// Public, no key, no quota, cacheable, ~700 bytes of JSON. oEmbed is a published protocol that every
// site embedding YouTube links depends on, so it is the most stable keyless contract YouTube offers.
// The answer names the playlist's first video only in `thumbnail_url` (`i.ytimg.com/vi/<id>/…`), and
// the uploads playlist is newest-first, videos, Shorts and streams together — the same set the old
// feed listed. A second oEmbed, for that video, gives its title.
//
// 🩸 tile#341: until 2026-11 this was the channel RSS feed, /feeds/videos.xml?channel_id=UC…, the same
// URL for fifteen years. Measured 2026-11-16 it answers 404 for every channel, and so do its
// `playlist_id=` and `user=` forms; the feed path is gone, not kept as a first try. What breaks the
// oEmbed path: YouTube refusing oEmbed for playlists, or a playlist thumbnail that stops being the
// first video's. Either one yields no video id, and the cell lands on the designed noposter state.
//
// 🔴 Condition 4 is why this file also proxies the THUMBNAIL, which looks like scope creep and is
// not. The poster URL is `i.ytimg.com`, i.e. Google. Putting it in the markup means every visitor's
// browser announces itself to Google — IP, user-agent, referring card — before anyone presses
// anything. Resolving the video server-side to avoid contacting YouTube and then embedding a Google
// image would satisfy the letter of the rule and none of its point. The Worker fetches the poster
// too, on its own cache key, and the visitor talks only to us until they press play.
//
// What is deliberately NOT done here: no API key, no OAuth, no quota, nothing belonging to the
// creator. Condition 1 means no credential of theirs — our own infrastructure keys would be a
// different category, and we do not need one either.

/** A channel id is `UC` + 22 url-safe chars. Anything else never reaches a URL. */
export const CHANNEL_RE = /^UC[\w-]{22}$/;
/**
 * A handle is what a creator actually knows about their channel: `@name`, 3–30 of letters, digits,
 * underscore, period, hyphen — the shape YouTube enforces. Nobody knows their UC id; everybody knows
 * their handle, and the channel page's share button hands out `youtube.com/@name`. A handle in the
 * card is resolved to the UC id here, server-side, on its own cache key (condition 2), and the
 * visitor's browser still never talks to YouTube before pressing play (condition 4).
 */
export const HANDLE_RE = /^@[\w.-]{3,30}$/;
/** A channel reference as a card may write it: a UC id or an @handle. */
export const isChannelRef = (s) => CHANNEL_RE.test(s) || HANDLE_RE.test(s);
/** A video id is 11 url-safe chars. */
export const VIDEO_RE = /^[\w-]{11}$/;

/**
 * How long the render path will wait for YouTube: once for a handle page, once for the latest video
 * (its two oEmbeds share the one deadline). Measured 2026-11-16: an oEmbed answers in 40–75 ms. This
 * is generous for that and still short of anything a reader would call a slow page.
 */
export const TIMEOUT_MS = 1500;

/** Where the card's own markup points for a poster — our origin, never Google's. */
export const posterPath = (videoId) => `/_yt/${videoId}.jpg`;

/**
 * What a YouTube address names — a video id, a channel code or an @handle — read off its host and
 * path. ONE copy of these rules: the Card editor's paste box (w/cell-form-core.mjs `youtubeRef`) and
 * sitetile's YouTube line (site-core.js, tile#148) both read it, so "is this a YouTube video" cannot
 * mean two things in one product. `u` is a parsed URL. Returns '' for any other address. NOT
 * validated: each caller holds the answer against the shapes it accepts (VIDEO_RE, CHANNEL_RE, …).
 * No imports, on purpose — sitetile's vendored import closure carries this file and nothing else
 * from cardtile.
 */
export function youtubeUrlRef(u) {
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return seg[0] || '';
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (seg[0] === 'watch') return u.searchParams.get('v') || '';
    if (['shorts', 'embed', 'live', 'v'].includes(seg[0])) return seg[1] || '';
    if (seg[0] === 'channel') return seg[1] || '';
    if (seg[0] && seg[0].startsWith('@')) return decodeURIComponent(seg[0]);   // youtube.com/@name(/videos)
  }
  return '';
}

/**
 * A written-out link → the one video it plays, `{ id, start }`, or null. Strict where the paste box is
 * forgiving: a scheme is required (http/https — this reads links an author published, not something
 * being typed) and the answer must be a VIDEO id, never a channel or a handle. `start` is the `t=`
 * (or `start=`, or an old `#t=`) the link carries, in whole seconds — `90`, `90s`, `1m30s`, `1h2m3s`;
 * 0 when absent or unreadable, which is where the video starts anyway.
 */
const MAX_START = 86400 * 365;
export function youtubeVideoOf(href) {
  const s = String(href == null ? '' : href).trim();
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  let u, id;
  try { u = new URL(s); id = youtubeUrlRef(u); } catch { return null; }
  if (!VIDEO_RE.test(id)) return null;
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? hash.get('t') ?? '';
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(t);
  const start = m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
  // Past a year is not a start time anyone wrote on purpose — and an unbounded one printed `1e+23`
  // into the markup (tile#150 N1). Treated like an unreadable `t=`: the start of the video.
  return { id, start: Number.isFinite(start) && start <= MAX_START ? start : 0 };
}

// Which channels a CARD names — `channelsIn` / `resolveChannels` — is yt-channels.mjs (tile#325): the
// answer is read off the Card parse, and this file may import nothing.

/** A channel's uploads playlist: the same 22 characters after `UU`. Only for a valid UC id. */
export const uploadsOf = (channelId) => (CHANNEL_RE.test(channelId) ? `UU${channelId.slice(2)}` : null);

/** YouTube's public oEmbed for a youtube.com page address. JSON, keyless. */
export const oembedUrl = (pageUrl) =>
  `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`;

/**
 * How long the edge keeps a YouTube answer, in seconds (the cardtile worker's `cf.cacheTtl`, which
 * re-exports this). The uploads-playlist oEmbed: 30 minutes — that TTL is what bounds how old "latest"
 * can be. A handle page (`youtube.com/@name`, resolved to the UC id): a day — it is a couple of MB, and a
 * handle's id does not change. A video's own oEmbed (its title): a day — one video, one answer.
 * tile#355: yt-channels.mjs keptChannels reads the same rule, so a channel the isolate remembers never
 * outlives the edge copies its answer was built from.
 */
export const ytCacheTtl = (u) =>
  (/^https:\/\/www\.youtube\.com\/@/.test(u) || /[?&]url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3F/.test(u) ? 86400 : 1800);

/**
 * The most an oEmbed answer may be, in bytes, before it is parsed. Recorded answers are 716–830
 * bytes. A title is at most 100 characters and appears twice (`title`, and the `html` iframe's
 * title); even written as \u-escaped surrogate pairs (12 bytes a character) that is 2.4 KB, and a
 * long `author_name` about 1.2 KB more — under 5 KB in all. 8 KiB leaves room above that.
 */
export const OEMBED_MAX_BYTES = 8 * 1024;

/**
 * An oEmbed body as text, or null when it is over `max` bytes. 🔴 Counted while READING, and the
 * stream is cancelled the moment the count passes the ceiling: a body that is chunked, or whose
 * content-length is missing or wrong, is still never held whole, and no oversized JSON ever reaches
 * JSON.parse (tile#346 review P2: a 4 MB answer parsed synchronously cost ~17 MB and ~75 ms of the
 * shared cardtile worker). A content-length already over the ceiling is refused without reading.
 * A response with no stream (the injected fakes in the tests) is measured after text().
 */
export async function oembedText(r, max = OEMBED_MAX_BYTES) {
  const body = r && r.body;
  const declared = r && r.headers && typeof r.headers.get === 'function' ? Number(r.headers.get('content-length')) : 0;
  if (declared > max) {
    if (body && typeof body.cancel === 'function') await body.cancel().catch(() => {});
    return null;
  }
  if (!body || typeof body.getReader !== 'function') {
    const t = String(await r.text());
    return new TextEncoder().encode(t).byteLength <= max ? t : null;
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(bytes);
}

const parseJson = (text) => {
  try { const v = JSON.parse(String(text || '')); return v && typeof v === 'object' ? v : null; } catch { return null; }
};

/**
 * The newest upload a channel's uploads-playlist oEmbed names, or null.
 *
 * 🔴 The id is read from `thumbnail_url` and ONLY in the exact `i.ytimg.com/vi/<id>/<file>` shape. That
 * thumbnail is the one place the answer names a video; the `title` is the playlist's ("Uploads from
 * …"), never the video's, and the `html` names the playlist, not a video. A thumbnail in any other
 * shape (a custom cover, another host, a changed path) is not guessed at: it is null, and the cell
 * lands on the designed noposter state rather than on a poster for the wrong video.
 */
export function latestFromUploadsOEmbed(text) {
  const o = parseJson(text);
  const thumb = o && typeof o.thumbnail_url === 'string' ? o.thumbnail_url : '';
  const m = /^https:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\/[\w.-]+$/.exec(thumb);
  return m && VIDEO_RE.test(m[1]) ? m[1] : null;
}

/** A video's own title from its oEmbed, or '' — JSON strings arrive already unescaped. */
export function titleFromOEmbed(text) {
  const o = parseJson(text);
  return o && typeof o.title === 'string' ? o.title.trim() : '';
}

/**
 * The channel id a handle page names. 🔴 Read from `<meta itemprop="identifier">` (with the canonical
 * link as the fallback), NOT from the first `"channelId":"UC…"` in the page's JSON — measured on a
 * real page, that key appears three times before the channel's own id and every one of them is
 * another channel (a recommended one). The identifier meta is the page saying who it is.
 */
export function channelIdFromPage(html) {
  const s = String(html || '');
  const meta = /<meta\s+itemprop="identifier"\s+content="(UC[\w-]{22})"/.exec(s)
    || /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(s);
  return meta && CHANNEL_RE.test(meta[1]) ? meta[1] : null;
}

/**
 * `@handle` → `UC…`, or null. Same shape as resolveChannel: injected fetch, a deadline, never throws.
 * The handle page is public and keyless (condition 1); it is a few hundred KB to a couple of MB, which
 * is why the Worker caches it for a day — a handle's id does not change — and why this is one fetch
 * per handle, not per card or per visitor (condition 2).
 */
export async function resolveHandle(handle, doFetch, timeoutMs = TIMEOUT_MS) {
  if (!HANDLE_RE.test(handle)) return null;
  let timer;
  try {
    const page = doFetch(`https://www.youtube.com/${handle}`)
      .then(async (r) => (r && r.ok ? channelIdFromPage(await r.text()) : null));
    return await Promise.race([
      page,
      new Promise((ok) => { timer = setTimeout(() => ok(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve one channel. `doFetch` is injected so this is testable without a network and so the Worker
 * can hand in Cloudflare's caching fetch.
 *
 * Takes a UC id or an @handle. The answer carries `channelId` either way, so the renderer can play
 * the uploads playlist for a card that wrote the handle — the card's markdown keeps the handle, which
 * is the form a person or an agent can read and check.
 *
 * 🔴 Never throws. A live block that cannot resolve must land on the degraded state, which is already
 * designed and already looks like a video you have not opened — not on a 500 that takes the whole
 * card down with it. The creator's card is not allowed to depend on YouTube being up.
 */
export async function resolveChannel(ref, doFetch, timeoutMs = TIMEOUT_MS) {
  let channelId = ref;
  if (HANDLE_RE.test(ref)) {
    channelId = await resolveHandle(ref, doFetch, timeoutMs);
    if (!channelId) return null;
  }
  const uploads = uploadsOf(channelId);
  if (!uploads) return null;
  let timer;
  // The video once it is known, so a deadline that lands during the TITLE fetch keeps the poster.
  let found = null;
  try {
    const latest = (async () => {
      const r = await doFetch(oembedUrl(`https://www.youtube.com/playlist?list=${uploads}`));
      const id = r && r.ok ? latestFromUploadsOEmbed(await oembedText(r)) : null;
      if (!id) return null;
      found = { id, title: '', channelId };
      // The title is the label's last resort (an author's own label wins in the renderer). Losing it
      // costs a word, never the poster: any failure here keeps the video with an empty title.
      try {
        const v = await doFetch(oembedUrl(`https://www.youtube.com/watch?v=${id}`));
        if (v && v.ok) found = { ...found, title: titleFromOEmbed(await oembedText(v)) };
      } catch { /* the video stands without a title */ }
      return found;
    })().catch(() => null);   // a rejection after the deadline won must not surface as unhandled
    // 🔴 A DEADLINE, because this now sits on the render path. Without it a slow or hanging YouTube
    // does not degrade the video block — it holds up the creator's entire page, and the four
    // conditions are satisfied right up until the page never arrives. Losing the poster is the
    // designed failure; losing the page is not. Raced rather than passed as an AbortSignal so it
    // holds for ANY injected fetch, including the fakes in the tests.
    return await Promise.race([
      latest,
      new Promise((ok) => { timer = setTimeout(() => ok(found), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);   // or a pending timer keeps a test runner alive after the assertions pass
  }
}
