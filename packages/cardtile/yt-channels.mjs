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
import { isChannelRef, resolveChannel } from './yt.mjs';

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
 * Resolve every channel a card's video cells name, concurrently. Returns { [ref]: {id, title,
 * channelId} } — keyed by what the card WROTE (UC id or @handle), because that is what the renderer
 * looks up.
 */
export async function resolveChannels(cardMd, doFetch) {
  return resolveChannelIds(channelsIn(cardMd), doFetch);
}

/** resolveChannels for a model already parsed (one window of long Cards: only its own video tiles) */
export async function resolveChannelsOf(model, doFetch) {
  return resolveChannelIds(channelsOf(model), doFetch);
}

async function resolveChannelIds(ids, doFetch) {
  if (!ids.length) return {};
  const got = await Promise.all(ids.map((c) => resolveChannel(c, doFetch)));
  const out = {};
  ids.forEach((c, i) => { if (got[i]) out[c] = got[i]; });
  return out;
}
