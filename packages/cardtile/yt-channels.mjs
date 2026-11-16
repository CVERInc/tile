// Which channels a Card's video cells name — and nothing else — for the Worker to resolve before it
// renders. Split out of yt.mjs (tile#325) because the answer needs the Card PARSE, and yt.mjs may
// import nothing: sitetile's vendored import closure carries that file and nothing else from cardtile.
//
// 🔴 tile#325: this used to pattern-match `channel=` over the raw markdown. The renderer reads a
// different thing — the `channel` param of a `video` cell, from parseCard (card-core.js), whose
// params are parseParams' token stream (sitetile/site-core.js). The two disagreed on every line where
// the raw text and the token stream differ, and the Worker made upstream requests for channels the
// Card never draws:
//   · an unbalanced quote — `channel="UC…`, `channel=UC…"`: the value carries the quote;
//   · trailing junk — `channel=UC…,`, `channel=@name/videos`: the value is the whole token, and the
//     regex took the valid-looking prefix;
//   · `channel=` inside another value — `note="see channel=UC…"`, `note=https://x/?channel=UC…`;
//   · `channel=UC…` in a cell's body text, after the marker;
//   · `channel=` on a line that is not a video cell at all (another cell type, the frontmatter, the
//     assets lane, a line outside any lane).
// And once the other way: `channel=" UC… "` is padded inside its quotes, the renderer trims it and
// draws `data-yt-channel="UC…"`, and the regex — which wanted a ref character right after the quote —
// never asked for it, so the poster could never resolve.
//
// So this reads the Card exactly as the renderer does: parseCard, every face cell and every back
// (drawer) cell, `video` cells only, and the value as card-render.mjs takes it —
// `String(p.channel || '').trim()`. yt.test.mjs holds the two readers to one answer by rendering
// each case and comparing what is requested with what the markup carries.
//
// The cost is one more parseCard per request (measured on the largest fixture, 350 KB: ~1 ms against
// ~13 ms for the render that follows). Every Card pays it. There is deliberately no "skip the parse
// when the raw text lacks `channel`" shortcut: the name the renderer reads need not be a substring of
// the markdown. parseCard removes an archive home token (`%%tg-home:<lane>%%`, tugtile's
// stripHomeToken) from a cell's first line before parseParams reads it, so
// `chan%%tg-home:grid%%nel=@x` is drawn as `channel=@x`, and a shortcut on the raw text skipped it
// unless some unrelated line happened to hold the word. Any test on the raw text is a second reader.
import { parseCard } from './card-core.js';
import { HANDLE_RE, isChannelRef, resolveChannel } from './yt.mjs';

/**
 * Every channel reference (UC id or @handle) a Card's video cells ask for, de-duplicated, in the order
 * they first appear (face cells, then each back). Reads the markdown rather than taking a model so the
 * Worker can resolve BEFORE rendering — renderCardHTML is pure and synchronous, and stays that way.
 */
export function channelsIn(cardMd) {
  const md = String(cardMd || '');
  let model;
  try { model = parseCard(md); } catch { return []; }
  const out = new Set();
  const cells = [...(model.cells || []), ...(model.drawers || []).flatMap((d) => d.cells || [])];
  for (const cell of cells) {
    if (!cell || cell.type !== 'video') continue;
    // card-render.mjs renderCellBody, `case 'video'`: the same expression, so the key this asks for
    // is the key the renderer looks up in ctx.videos. A bare `channel` flag (true) or a link-form
    // value (an object) stringifies to something no ref pattern accepts.
    const chan = String((cell.params || {}).channel || '').trim();
    if (isChannelRef(chan)) out.add(chan);
  }
  return [...out];
}

/**
 * The most fetches resolveChannel makes for one reference: a UC id is its feed (1), an @handle is its
 * handle page and then its feed (2). A handle that does not resolve stops after the first.
 */
export const channelFetches = (ref) => (HANDLE_RE.test(ref) ? 2 : 1);

/** the feed's edge TTL (serve/card-worker.mjs ytFetch, seconds): no remembered answer outlives it */
export const CHANNEL_KEPT_SECONDS = 1800;
/** the most channels one isolate remembers; the oldest goes first */
export const CHANNEL_KEPT_MOST = 1000;

/**
 * How old a feed answer already was when it arrived, in whole seconds, from its headers — or null when
 * nothing says. The edge copy may have been cached long before this request: `Age` is how long the edge
 * has held it, `Date` is when YouTube produced it. The larger wins (`Date` from a clock that is ahead
 * reads younger, so it is floored at 0 and `Age` still counts).
 */
export function upstreamAge(headers, nowMs) {
  if (!headers || typeof headers.get !== 'function') return null;
  const ages = [];
  const age = String(headers.get('age') ?? '').trim();
  if (/^\d+$/.test(age)) ages.push(Number(age));
  const date = Date.parse(String(headers.get('date') ?? ''));
  if (Number.isFinite(date)) ages.push(Math.max(0, Math.floor((nowMs - date) / 1000)));
  return ages.length ? Math.max(...ages) : null;
}

/**
 * keptChannels() → the answers this isolate already has: { get(ref), set(ref, answer, headers) }. Memory
 * only, so reading it is not a subrequest. Only a resolved answer is kept, never a failure (a channel
 * YouTube did not answer for is asked again by the next view that has room for it).
 *
 * 🔴 tile#357 review: an answer is remembered for what is LEFT of the feed's TTL, not for a fresh TTL
 * from the moment it arrived. `headers` are the feed response's; the edge may already have held that
 * copy for most of its 1800 s, and restarting the clock here kept an old "latest video" up to twice as
 * long as the edge would. So the entry expires when the edge copy it came from does, an answer whose
 * age nothing states is not remembered at all, and setting a ref again from the same old edge copy
 * cannot move its expiry later.
 */
export function keptChannels({ seconds = CHANNEL_KEPT_SECONDS, most = CHANNEL_KEPT_MOST, now = Date.now } = {}) {
  const m = new Map();
  return {
    get(ref) {
      const e = m.get(ref);
      if (!e) return null;
      if (now() < e.until) return e.answer;
      m.delete(ref);
      return null;
    },
    set(ref, answer, headers) {
      if (!answer) return;
      const t = now();
      const age = upstreamAge(headers, t);
      if (age === null) return;
      const until = t + (seconds - age) * 1000;
      if (until <= t) return;
      m.delete(ref);
      m.set(ref, { until, answer });
      while (m.size > most) m.delete(m.keys().next().value);
    },
    get size() { return m.size; },
  };
}

/**
 * Resolve the channels the page's video cells name, concurrently. Returns { [ref]: {id, title,
 * channelId} } — keyed by what the page WROTE (UC id or @handle), because that is what the renderer
 * looks up. A ref missing from the answer is drawn in the renderer's degraded state (card-render.mjs,
 * `case 'video'`): a poster-less play button that opens the channel.
 *
 * tile#355: `subrequests` is this call's share of the invocation's subrequest budget
 * (serve/picture-cache.mjs CHANNEL_SUBREQUESTS). When every channel fits it at its worst case
 * (channelFetches), every channel is fetched, as before. When they do not:
 *   · a channel `kept` already answers for (memory, no subrequest) is served from there;
 *   · the others are fetched in the order the page names them while their worst case still fits,
 *     and fetching stops at the first one that does not;
 *   · the rest are not asked for at all.
 * `kept` remembers every answer this call resolves, for what is left of its feed's TTL. Never throws.
 */
export async function resolveChannels(cardMd, doFetch, { subrequests = Infinity, kept = null } = {}) {
  const ids = channelsIn(cardMd);
  if (!ids.length) return {};
  const over = ids.reduce((n, c) => n + channelFetches(c), 0) > subrequests;
  const out = {};
  const ask = [];
  let left = subrequests;
  for (const c of ids) {
    const known = over && kept ? kept.get(c) : null;
    if (known) { out[c] = known; continue; }
    if (left === null || channelFetches(c) > left) { left = null; continue; }
    left -= channelFetches(c);
    ask.push(c);
  }
  // each channel's feed response headers, for keptChannels' expiry (a handle page's are not the feed's)
  const feedHeaders = ask.map(() => null);
  const got = await Promise.all(ask.map((c, i) => resolveChannel(c, (u) => {
    const r = doFetch(u);
    if (!u.includes('/feeds/videos.xml?')) return r;
    return Promise.resolve(r).then((res) => {
      feedHeaders[i] = (res && res.headers) || null;
      return res;
    });
  })));
  ask.forEach((c, i) => {
    if (!got[i]) return;
    out[c] = got[i];
    if (kept) kept.set(c, got[i], feedHeaders[i]);
  });
  return out;
}
