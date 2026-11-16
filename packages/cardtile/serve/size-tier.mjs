// The size tier of the cardtile worker's page view (reef#3361, option A).
//
// Every exit of a Cards page used to start by parsing the whole file into a full model — three times
// on a page view — and the page view then rendered every tile into one string before the first byte
// left. Cost grows with the tile count (bench/every-number, step 1 and step 2), so a file far past
// what a person writes by hand cannot be a page inside the runtime's memory and CPU at all. Above
// ON_DEMAND_TILES the page view does not parse or render the file: it serves a SHELL — the page as
// the head of the file makes it — that names the file's own address in `data-card-src`, and the
// visitor's browser reads the file there and builds tiles as they come into view (w3/deck.js, its
// file mode). At or below it, nothing here is asked for anything but the count: the page is today's,
// byte for byte.
//
// 🔴 Nothing in this file parses the whole file. Each reader is bounded by what it looks for (a tile
// count that stops at the threshold, a head of HEAD_UNITS, the asset lines of one picture), so its
// cost does not grow with the tiles it is not about.
import { parseCard, serializeCard } from '../card-core.js';

/**
 * The most tiles a page view renders on the server. Above it, the shell and the browser's file mode.
 *
 * 5,000, measured (bench/every-number/logs/step2-before.jsonl, the page view before the tier, one
 * request per fresh Node 22 process): at 5,000 tiles both shapes measured — one-line text tiles (the
 * sample's) and w=2 link tiles, the costliest measured per tile, because packing a grid of them grows
 * with the square of the count — finish inside a 32 MB V8 old space, a quarter of the runtime's 128 MB,
 * in at most 0.46 s of CPU and 0.28 s to the first byte. At 10,000 the link tiles no longer fit 32 MB
 * (they need 64 MB, 0.75 s of CPU); at 20,000 they no longer fit 64 MB (2.0 s of CPU).
 */
export const ON_DEMAND_TILES = 5000;

/** how far into the file the shell looks for the profile tile (UTF-16 code units) */
export const HEAD_UNITS = 64 * 1024;

const isAssetLane = (title) => /^assets$/i.test(String(title).trim());   // card-core.js RE_ASSET_LANE

/**
 * tilesAbove(md, limit) → true when the file holds more than `limit` tiles that render, counting no
 * further than limit + 1. A tile is a line `- [<any one character>]` inside a lane, as the board parser
 * reads it (tugtile/board-core.js parseFile); a lane is a line that begins `## `; the lines of the
 * `## assets` lane are pictures, not tiles (card-core.js parseCard hoists them), so they are not
 * counted. Front lanes and back lanes are: the page draws both.
 *
 * It errs in one direction only: a line the board parser would not take as a tile (one inside a
 * top-level code fence, or after the archive rule) is counted all the same, which can only move a
 * file toward the on-demand page, never a file the server cannot render toward the server.
 */
export function tilesAbove(md, limit = ON_DEMAND_TILES) {
  const s = String(md || '');
  let n = 0;
  let lane = s.startsWith('## ') ? 0 : s.indexOf('\n## ');
  if (lane < 0) return false;                     // no lane: no tile
  if (s.charCodeAt(lane) === 10) lane += 1;
  while (lane >= 0) {
    const eol = s.indexOf('\n', lane);
    const next = s.indexOf('\n## ', lane);        // where this lane ends
    const end = next < 0 ? s.length : next + 1;
    if (!isAssetLane(s.slice(lane + 3, eol < 0 ? s.length : eol))) {
      let at = s.indexOf('\n- [', lane);
      while (at >= 0 && at < end) {
        if (s.charCodeAt(at + 5) === 93 && ++n > limit) return true;   // `]`
        at = s.indexOf('\n- [', at + 4);
      }
    }
    lane = next < 0 ? -1 : next + 1;
  }
  return false;
}

/** the frontmatter fence at the top of the file (`---` … `---`), within the head, or '' */
function frontFence(head) {
  const s = head.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return '';
  const close = s.indexOf('\n---\n', 3);
  return close < 0 ? '' : s.slice(0, close + 5);
}

/** the file's first HEAD_UNITS, cut where a tile or a lane begins, so every tile in it is whole */
function headOf(md) {
  if (md.length <= HEAD_UNITS) return md;
  const cut = Math.max(md.lastIndexOf('\n- [', HEAD_UNITS), md.lastIndexOf('\n## ', HEAD_UNITS));
  return cut < 0 ? '' : md.slice(0, cut + 1);
}

/**
 * The lines of the `## assets` lane whose id is one of `ids`, read by searching for each id rather
 * than parsing the lane (it holds every picture of the file). The lines found are parsed on their
 * own, so what counts as their id and type is card-core's reading, not this search's.
 */
function assetsNamed(md, ids) {
  const want = new Set(ids.filter(Boolean));
  if (!want.size) return {};
  const at = md.search(/(^|\n)## +assets[ \t]*\r?(\n|$)/i);
  if (at < 0) return {};
  const from = md.indexOf('## ', at);
  const next = md.indexOf('\n## ', from + 3);
  const lane = md.slice(from, next < 0 ? md.length : next + 1);
  const lines = [];
  for (const id of want) {
    for (let i = lane.indexOf(`id=${id}`); i >= 0; i = lane.indexOf(`id=${id}`, i + 3)) {
      const start = lane.lastIndexOf('\n- [', i) + 1;
      if (start <= 0) continue;
      // the tile runs to the next line that is not its continuation (a tab-indented line)
      let end = lane.indexOf('\n', i);
      while (end >= 0 && lane.charCodeAt(end + 1) === 9) end = lane.indexOf('\n', end + 1);
      lines.push(lane.slice(start, end < 0 ? lane.length : end));
    }
  }
  if (!lines.length) return {};
  const found = parseCard(`## assets\n\n${lines.join('\n')}\n`).assets;
  const out = {};
  for (const id of want) if (Object.prototype.hasOwnProperty.call(found, id)) out[id] = found[id];
  return out;
}

/**
 * shellSource(md) → a small Cards file: what the page above the tier is made from, by the same
 * renderer as every page, so its head is built by the same code as today's:
 *
 *   - the frontmatter fence, whole (title, lang, accent, theme, views, …): every page-level key the
 *     page reads. Read from the fence only — today's page reads `key:` from the first line anywhere in
 *     the file that starts with it, body included; the shell does not scan the body for it.
 *   - the first profile tile in a front lane within the first HEAD_UNITS, if any: the description,
 *     og:image, the favicon and the tab's name come from it (card-share.mjs, card-icon.mjs), and so
 *     does the top of the page while the file is on its way. One further down is not looked for.
 *   - its avatar, and the avatar's PNG copy (card-core rasterCopyId), from the `## assets` lane — the
 *     only pictures the shell draws, so the only ones a picture plan can be made of.
 *
 * Nothing else: no other tile, no back, no prose. Those are the file's, and the browser reads them there.
 */
export function shellSource(md) {
  const s = String(md || '');
  const head = headOf(s);
  const front = frontFence(head);
  let profile = null;
  try { profile = parseCard(head).cells.find((c) => c && c.type === 'profile') || null; } catch { profile = null; }
  const avatar = /^asset:(.+)$/.exec(String((profile && profile.params && profile.params.avatar) || '').trim());
  const assets = avatar ? assetsNamed(s, [avatar[1].trim(), `${avatar[1].trim()}.png`]) : {};
  const cells = profile ? [profile] : [];
  return serializeCard({ pre: front.replace(/\n$/, ''), lane: 'grid', blocks: [{ label: '', start: 0, count: cells.length }], cells, drawers: [], assets, post: '' });
}

/**
 * withCardSrc(html, src) → the page with `data-card-src="<src>"` on its root, the attribute w3/deck.js
 * reads to fetch the file and deal it (its file mode). `<html` is the renderer's own first tag, as
 * w3/deck-page.mjs withDeck relies on too.
 */
export function withCardSrc(html, src) {
  const at = html.indexOf('<html');
  if (at < 0) return html;
  const v = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `${html.slice(0, at + 5)} data-card-src="${v}"${html.slice(at + 5)}`;
}
