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
// The endpoint is YouTube's channel RSS feed. Public, no key, no quota, cacheable, and it has been
// the same URL for fifteen years:  /feeds/videos.xml?channel_id=UC…
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
/** A video id is 11 url-safe chars. */
export const VIDEO_RE = /^[\w-]{11}$/;

/**
 * How long the render path will wait for YouTube. Measured against the real feed: 206ms warm. This
 * is generous for that and still short of anything a reader would call a slow card.
 */
export const TIMEOUT_MS = 1500;

/** Where the card's own markup points for a poster — our origin, never Google's. */
export const posterPath = (videoId) => `/_yt/${videoId}.jpg`;

/**
 * Every channel id a card asks about. Reads the raw markdown rather than the parsed model so the
 * Worker can resolve BEFORE rendering — renderCardHTML is pure and synchronous, and stays that way.
 */
export function channelsIn(cardMd) {
  const out = new Set();
  for (const m of String(cardMd || '').matchAll(/\bchannel\s*=\s*"?([A-Za-z0-9_-]+)"?/g)) {
    if (CHANNEL_RE.test(m[1])) out.add(m[1]);
  }
  return [...out];
}

/**
 * The newest video on a channel, or null.
 *
 * 🔴 The first `<entry>` is taken and then read WITHIN its own bounds. The feed carries a
 * channel-level `<title>` and `<link>` before any entry, so a document-wide search for `<title>`
 * returns the channel's name and a document-wide search for a video id can outrun its entry. Scoping
 * to the entry is the difference between "her latest video" and "her channel, mislabelled".
 */
export function latestFromFeed(xml) {
  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/.exec(String(xml || ''));
  if (!entry) return null;
  const id = /<yt:videoId>\s*([A-Za-z0-9_-]+)\s*<\/yt:videoId>/.exec(entry[1]);
  if (!id || !VIDEO_RE.test(id[1])) return null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry[1]);
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  return { id: id[1], title: title ? unescape(title[1]) : '' };
}

/**
 * Resolve one channel. `doFetch` is injected so this is testable without a network and so the Worker
 * can hand in Cloudflare's caching fetch.
 *
 * 🔴 Never throws. A live block that cannot resolve must land on the degraded state, which is already
 * designed and already looks like a video you have not opened — not on a 500 that takes the whole
 * card down with it. The creator's card is not allowed to depend on YouTube being up.
 */
export async function resolveChannel(channelId, doFetch, timeoutMs = TIMEOUT_MS) {
  if (!CHANNEL_RE.test(channelId)) return null;
  let timer;
  try {
    const feed = doFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
      .then(async (r) => (r && r.ok ? latestFromFeed(await r.text()) : null));
    // 🔴 A DEADLINE, because this now sits on the render path. Without it a slow or hanging YouTube
    // does not degrade the video block — it holds up the creator's entire card, and the four
    // conditions are satisfied right up until the page never arrives. Losing the poster is the
    // designed failure; losing the card is not. Raced rather than passed as an AbortSignal so it
    // holds for ANY injected fetch, including the fakes in the tests.
    return await Promise.race([
      feed,
      new Promise((ok) => { timer = setTimeout(() => ok(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);   // or a pending timer keeps a test runner alive after the assertions pass
  }
}

/** Resolve every channel a card mentions, concurrently. Returns { [channelId]: {id, title} }. */
export async function resolveChannels(cardMd, doFetch) {
  const ids = channelsIn(cardMd);
  if (!ids.length) return {};
  const got = await Promise.all(ids.map((c) => resolveChannel(c, doFetch)));
  const out = {};
  ids.forEach((c, i) => { if (got[i]) out[c] = got[i]; });
  return out;
}
