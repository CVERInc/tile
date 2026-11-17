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
import { HANDLE_RE, isChannelRef, resolveChannel, ytCacheTtl } from './yt.mjs';

/**
 * Every channel reference (UC id or @handle) a Card's video cells ask for, de-duplicated, in the order
 * they first appear (face cells, then each back). Reads the markdown rather than taking a model so the
 * Worker can resolve BEFORE rendering — renderCardHTML is pure and synchronous, and stays that way.
 */
export function channelsIn(cardMd) {
  const md = String(cardMd || '');
  let model;
  try { model = parseCard(md); } catch { return []; }
  return channelsOf(model);
}

/** channelsIn's answer for a model already parsed (serve/size-tier.mjs: one window of long Cards) */
export function channelsOf(model) {
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
 * The most fetches resolveChannel makes for one reference (yt.mjs, since tile#341): a UC id is its
 * uploads-playlist oEmbed and then that video's own oEmbed, for the title (2); an @handle is its handle
 * page first (3). A handle that does not resolve stops after the first fetch, an uploads oEmbed that
 * names no video after its own.
 */
export const channelFetches = (ref) => (HANDLE_RE.test(ref) ? 3 : 2);

/** the most channels one isolate remembers; the oldest goes first */
export const CHANNEL_KEPT_MOST = 1000;

/**
 * How old an upstream answer already was when it arrived, in whole seconds, from its headers — or null
 * when nothing says. The edge copy may have been cached long before this request: `Age` is how long the edge
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
 * keptChannels() → the answers this isolate already has: { get(ref), deadline(url, headers),
 * set(ref, answer, deadlines) }. Memory only, so reading it is not a subrequest. Only a resolved answer
 * is kept, never a failure (a channel YouTube did not answer for is asked again by the next view that
 * has room for it).
 *
 * 🔴 tile#357 review: an answer is remembered for what is LEFT of the edge's freshness, not for a fresh
 * TTL from the moment it arrived; restarting the clock here kept an old "latest video" up to twice as
 * long as the edge would. Since tile#341 one answer is built from up to three YouTube responses — the
 * handle page, the uploads-playlist oEmbed, the video's own oEmbed — each held at the edge for its own
 * `ttl` (yt.mjs ytCacheTtl: 1800 s for the uploads oEmbed, a day for the other two), and any of them may
 * already have been held there for most of it. The entry expires when the first of those edge copies
 * does (in practice the uploads oEmbed, which bounds how old "latest" can be).
 *
 * 🔴 tile#357 review r3: that expiry is fixed the moment each response ARRIVES, not when the answer is
 * stored. `deadline(url, headers)` is called on receipt and returns the absolute time (this clock, ms)
 * that edge copy expires: receipt + ttl(url) − its age; null when nothing states its age. `set` takes
 * the deadlines of every response the answer was built from and remembers it until the earliest. Reading
 * the old age again at store time restarted the clock by however long came between: reading a body,
 * fetching the title, waiting for the other channels of the same page. An answer with no deadline, or
 * one whose age nothing states, or whose earliest deadline has already passed, is not remembered at all.
 * Setting a ref again while its entry is still live never moves that entry's expiry later: the same
 * edge copy seen again reads the same expiry, give or take the whole-second rounding of `Age`.
 */
export function keptChannels({ ttl = ytCacheTtl, most = CHANNEL_KEPT_MOST, now = Date.now } = {}) {
  const m = new Map();
  const live = (ref) => {
    const e = m.get(ref);
    if (!e) return null;
    if (now() < e.until) return e;
    m.delete(ref);
    return null;
  };
  return {
    get(ref) {
      const e = live(ref);
      return e ? e.answer : null;
    },
    deadline(url, headers) {
      const t = now();
      const age = upstreamAge(headers, t);
      return age === null ? null : t + (ttl(String(url)) - age) * 1000;
    },
    set(ref, answer, deadlines) {
      if (!answer || !Array.isArray(deadlines) || !deadlines.length) return;
      if (!deadlines.every((d) => typeof d === 'number' && Number.isFinite(d))) return;
      const before = live(ref);
      const until = Math.min(...deadlines, before ? before.until : Infinity);
      if (!(until > now())) return;
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
 * `kept` remembers every answer this call resolves, until the first edge copy it was built from expires
 * (keptChannels). Never throws.
 */
export async function resolveChannels(cardMd, doFetch, share) {
  return resolveChannelIds(channelsIn(cardMd), doFetch, share);
}

/**
 * resolveChannels for a model already parsed: one window of long Cards (serve/size-tier.mjs windowOf),
 * so only the channels that window's own video tiles name. The same share and the same memory as a
 * whole page, counted the same way: a window is one page view, and what it resolves is remembered for
 * every later page view of this isolate (another window, or any page naming the same channel).
 */
export async function resolveChannelsOf(model, doFetch, share) {
  return resolveChannelIds(channelsOf(model), doFetch, share);
}

async function resolveChannelIds(ids, doFetch, { subrequests = Infinity, kept = null } = {}) {
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
  // The deadline of every response each channel's answer is built from, for keptChannels' expiry, taken
  // the moment that response arrives (tile#357 review r3): time spent after that — reading the body,
  // fetching the title, waiting here for the other channels — uses up its freshness rather than
  // restarting it. Copied the moment resolveChannel answers: a title oEmbed still in flight when the
  // deadline won is not part of it.
  const got = await Promise.all(ask.map((c) => {
    const due = [];
    const recording = (u) => Promise.resolve(doFetch(u)).then((res) => {
      if (res && kept) due.push(kept.deadline(u, res.headers || null));
      return res;
    });
    return resolveChannel(c, recording).then((answer) => ({ answer, due: due.slice() }));
  }));
  ask.forEach((c, i) => {
    const { answer, due } = got[i];
    if (!answer) return;
    out[c] = answer;
    if (kept) kept.set(c, answer, due);
  });
  return out;
}
