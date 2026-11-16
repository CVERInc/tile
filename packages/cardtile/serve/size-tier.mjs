// The size tier of the cardtile worker's page view (reef#3361).
//
// Every exit of a Cards page used to start by parsing the whole file into a full model, and the page
// view then rendered every tile into one string before the first byte left. Cost grows with the tile
// count (bench/every-number, steps 1 and 2), so a file far past what a person writes by hand cannot be
// one page inside the runtime's memory and CPU at all. Above ON_DEMAND_TILES the page view is served
// in WINDOWS: the page itself is the first window, and `?w=<n>&r=<revision>` is the n-th. Each window
// is a whole page made by the same renderer as every page (serve/card-worker.mjs renderCardHTML's
// own path, card-render.mjs) from a model that holds only that window's tiles, the backs they turn
// over to, and the pictures they draw; each names the windows before and after it in plain links, so
// a reader with no script walks the Cards window by window, and w3/deck.js fetches the next window
// itself when a visitor reaches the end of what is loaded (stack, list and wall alike).
// At or below the threshold none of this is asked for anything but the count: the page is today's,
// byte for byte.
//
// 🔴 ONE READER OF THE FILE'S SHAPE. scanCard walks the lines with the board parser's own rules
// (tugtile/board-core.js parseFile: the frontmatter, top-level code fences, the archive rule, the
// settings block) and card-core.js's lane kinds (assets, backs, face lanes), and records where every
// tile starts. It never builds a cell. Everything else here reads tiles by those offsets and hands
// each piece it needs to card-core's own parseCard, so what a tile IS is never decided twice: a piece
// is a whole tile (or a whole lane), cut where the board parser itself starts the next one, so parsing
// it alone gives the cell the whole file gives.
import { parseCard } from '../card-core.js';
import { frontOf } from '../w3/deck-page.mjs';
import { isTemplateCell } from '../card-blank.mjs';

/**
 * The most tiles (face and back; the `## assets` lane's lines are pictures, not tiles) a page view
 * renders as one page. Above it, the windows.
 *
 * 5,000, measured (bench/every-number/logs/step2-before.jsonl, the page view before the tier, one
 * request per fresh Node 22 process): at 5,000 tiles both shapes measured — one-line text tiles (the
 * sample's) and w=2 link tiles, the costliest measured per tile, because packing a grid of them grows
 * with the square of the count — finish inside a 32 MB V8 old space, a quarter of the runtime's 128 MB,
 * in at most 0.46 s of CPU and 0.28 s to the first byte. At 10,000 the link tiles no longer fit 32 MB
 * (they need 64 MB, 0.75 s of CPU); at 20,000 they no longer fit 64 MB (2.0 s of CPU).
 */
export const ON_DEMAND_TILES = 5000;

/**
 * One window: at most WINDOW_TILES tiles and WINDOW_UNITS UTF-16 code units of tile text, counting
 * the window's face tiles and every back they turn over to (a back is drawn in each window that
 * names it). A window always holds at least one face tile, so a tile whose back alone is larger than
 * a window is drawn with it, whole (see the report's "not done").
 *
 * 1,000 tiles: a fifth of the measured 5,000-tile page (bench/every-number/STEP3.md), so the render
 * itself is a small part of an invocation whose floor is holding the file (the KV value is read
 * whole). 1 Mi units: a thousand tiles of a thousand characters each.
 */
export const WINDOW_TILES = 1000;
export const WINDOW_UNITS = 1 << 20;

const RE_WS = /\s/;
const isSettingsAt = (s, a) => s.startsWith('%% kanban:settings', a) || s.startsWith('%% tugtile:settings', a);

// The end of the line that starts at `a`: the first `\n` or `\r` (parseFile splits on /\r\n|\r|\n/).
// `c` keeps the next of each found so far, so a walk over the whole file reads every character once.
function lineEnd(s, c, a) {
  if (c.nl !== -1 && c.nl < a) c.nl = s.indexOf('\n', a);
  if (c.cr !== -1 && c.cr < a) c.cr = s.indexOf('\r', a);
  if (c.nl === -1) return c.cr === -1 ? s.length : c.cr;
  return c.cr === -1 ? c.nl : Math.min(c.nl, c.cr);
}
// where the line after the one ending at `e` starts (s.length + 1: there is none)
const lineNext = (s, e) => (e >= s.length ? s.length + 1 : s.charCodeAt(e) === 13 && s.charCodeAt(e + 1) === 10 ? e + 2 : e + 1);
const cursor = () => ({ nl: -2, cr: -2 });

// parseFile's isHr: /^\*\*\*+[ \t]*$/
function isHr(s, a, e) {
  let i = a;
  while (i < e && s.charCodeAt(i) === 42) i++;
  if (i - a < 3) return false;
  while (i < e && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  return i === e;
}
// parseFile's blank test: line.trim() === ''
function isBlank(s, a, e) {
  for (let i = a; i < e; i++) if (!RE_WS.test(s.charAt(i))) return false;
  return true;
}
// parseFile's tile test: /^- \[.\]/ (`.` is one UTF-16 unit that is not a line terminator)
function isTileAt(s, a, e) {
  if (e - a < 5 || s.charCodeAt(a) !== 45 || s.charCodeAt(a + 1) !== 32 || s.charCodeAt(a + 2) !== 91 || s.charCodeAt(a + 4) !== 93) return false;
  const x = s.charCodeAt(a + 3);
  return x !== 0x2028 && x !== 0x2029;
}

// a lane's kind, by card-core's own reading of its heading (parseCard: the assets lane, a back, or a face lane)
const KINDS = new Map();
function laneKind(title) {
  let k = KINDS.get(title);
  if (k) return k;
  // one tile under the heading: a face lane makes it a cell, a back a back's cell, the assets lane nothing
  const m = parseCard(`## ${title}\n- [ ] x\n`);
  const d = m.drawers[0];
  k = d ? { kind: 'back', id: d.id } : m.cells.length ? { kind: 'face' } : { kind: 'assets' };
  if (KINDS.size < 4096) KINDS.set(title, k);
  return k;
}

/**
 * scanCard(md, { limit }) → where the file's lanes and tiles are, by the board parser's rules:
 *   { length, fmEnd, preEnd, laneEnd, settings, cr, lanes, starts, face, back, tiles, above, complete }
 * `lanes`: [{ kind: 'face'|'back'|'assets', title, id (a back's), head, end, t0, t1 }] in file order —
 * `head` is the offset of the `## ` line, `end` where the lane stops (the next lane's heading, the
 * archive rule, the settings block, or the end of the file), and tiles t0..t1-1 of `starts` are its own.
 * Tile i runs from starts[i] to starts[i + 1], or to its lane's `end` for the lane's last tile.
 * `limit`: stop once more than that many tiles (face and back) are found; `above` says so.
 */
export function scanCard(md, { limit = Infinity } = {}) {
  const s = String(md ?? '');
  const L = s.length;
  const c = cursor();
  const lanes = [];
  const starts = [];
  let fmEnd = 0, settings = -1;
  // the frontmatter: lines[0] === '---' and the next line that is exactly '---' anywhere (lines.indexOf('---', 1)).
  // The settings block is the first line anywhere that begins with its marker (lines.findIndex); one inside the
  // frontmatter leaves the file with no lanes at all.
  let e = lineEnd(s, c, 0);
  if (e === 3 && s.startsWith('---')) {
    for (let a = lineNext(s, e); a <= L; a = lineNext(s, e)) {
      e = lineEnd(s, c, a);
      if (settings < 0 && isSettingsAt(s, a)) settings = a;
      if (e - a === 3 && s.startsWith('---', a)) { fmEnd = Math.min(L, lineNext(s, e)); break; }
    }
    if (!fmEnd) settings = -1;   // no closing line: no frontmatter, and the walk below finds the settings block itself
  }
  const out = { length: L, fmEnd, preEnd: -1, laneEnd: L, settings: -1, cr: s.indexOf('\r') >= 0, lanes, starts, face: 0, back: 0, tiles: 0, above: false, complete: true };
  if (settings >= 0) { out.settings = settings; out.preEnd = settings; out.laneEnd = settings; return out; }
  c.nl = -2; c.cr = -2;
  let fence = false, lane = null, stop = -1;
  for (let a = fmEnd; a <= L; a = lineNext(s, e)) {
    e = lineEnd(s, c, a);
    if (isSettingsAt(s, a)) { out.settings = a; stop = a; break; }
    const ch = s.charCodeAt(a);
    if ((ch === 96 && s.startsWith('```', a)) || (ch === 126 && s.startsWith('~~~', a))) { fence = !fence; continue; }
    if (fence) continue;
    if (ch === 42 && isHr(s, a, e)) {
      // the archive rule: a horizontal rule followed, after blank lines only, by a lane heading ends the lanes
      const c2 = { nl: c.nl, cr: c.cr };
      let b = lineNext(s, e), be = b <= L ? lineEnd(s, c2, b) : L;
      while (b <= L && isBlank(s, b, be)) { b = lineNext(s, be); if (b <= L) be = lineEnd(s, c2, b); }
      if (b <= L && !isSettingsAt(s, b) && s.startsWith('## ', b)) { stop = a; break; }
      continue;
    }
    if (ch === 35 && s.startsWith('## ', a)) {
      if (lane) { lane.end = a; lane.t1 = starts.length; }
      if (out.preEnd < 0) out.preEnd = a;
      const title = s.slice(a + 3, e).trim();
      const k = laneKind(title);
      lane = { kind: k.kind, title, id: k.id, head: a, end: L, t0: starts.length, t1: starts.length };
      lanes.push(lane);
      continue;
    }
    if (lane && ch === 45 && isTileAt(s, a, e)) {
      starts.push(a);
      if (lane.kind === 'face') out.face++;
      else if (lane.kind === 'back') out.back++;
      if (out.face + out.back > limit) { out.above = true; out.complete = false; stop = L; break; }
    }
  }
  if (stop >= 0) out.laneEnd = stop;
  if (lane) { lane.t1 = starts.length; if (out.complete) lane.end = out.laneEnd; }
  if (out.preEnd < 0) out.preEnd = out.laneEnd;
  out.tiles = out.face + out.back;
  if (out.tiles > limit) out.above = true;
  return out;
}

/** tile i's text, as the board parser cuts it */
const spanOf = (idx, lane, i) => [idx.starts[i], i + 1 < lane.t1 ? idx.starts[i + 1] : lane.end];
/** the end of the first line of the text starting at `a`; `c` a cursor (asked at offsets that only grow) */
const firstLineEnd = (s, c, a) => lineEnd(s, c, a);
/** the face lanes' tiles in page order: f(lane, i, ordinal) for each; f returning false stops */
function eachFace(idx, f) {
  let k = 0;
  for (const lane of idx.lanes) {
    if (lane.kind !== 'face') continue;
    for (let i = lane.t0; i < lane.t1; i++, k++) if (f(lane, i, k) === false) return;
  }
}

/**
 * The `## assets` lane's pictures by id: id → the span of the line that holds it. Read from the first
 * line of each picture tile only (its marker, where the id is), by card-core's parseCard; the LAST line
 * with an id is the one parseCard keeps, so it is the one kept here.
 */
function assetIndex(md, idx) {
  const s = String(md);
  const map = new Map();
  const c = cursor();
  for (const lane of idx.lanes) {
    if (lane.kind !== 'assets') continue;
    for (let i = lane.t0; i < lane.t1; i++) {
      const [a, b] = spanOf(idx, lane, i);
      const e = Math.min(b, firstLineEnd(s, c, a));
      // the marker is at the start of the line; its first 4,096 units hold it unless it is longer than that
      let got = Object.keys(parseCard(`## assets\n${s.slice(a, Math.min(e, a + 4096))}\n`).assets);
      if (!got.length && e > a + 4096) got = Object.keys(parseCard(`## assets\n${s.slice(a, e)}\n`).assets);
      for (const id of got) map.set(id, [a, b]);   // a later line takes the place of the first, as in parseCard's map
    }
  }
  return map;
}

/**
 * The file's pictures as a model's `assets`, read when the renderer asks for one (card-render.mjs
 * resolveAsset, card-icon.mjs cardAvatar / cardRaster: `assets[id]`). The answer for any name is the
 * answer the whole file's parseCard().assets gives — a picture's line parsed alone, or for a name that is
 * no picture what a plain object answers (its inherited members included, as the parsed map would) —
 * so a window draws the same pictures its tiles draw on the whole page, without decoding the others.
 */
export function assetsOnDemand(md, idx) {
  const s = String(md);
  let map = null;
  const got = new Map();
  const plain = {};
  const read = (id) => {
    map ??= assetIndex(s, idx);
    const at = map.get(id);
    if (!at) return undefined;
    if (!got.has(id)) got.set(id, parseCard(`## assets\n${s.slice(at[0], at[1])}`).assets[id]);
    return got.get(id);
  };
  return new Proxy(plain, {
    get: (t, k) => (typeof k === 'string' ? (read(k) ?? plain[k]) : plain[k]),
    has: (t, k) => (typeof k === 'string' && read(k) !== undefined) || k in plain,
    ownKeys: () => { map ??= assetIndex(s, idx); return [...map.keys()]; },
    getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && read(k) !== undefined ? { value: read(k), enumerable: true, configurable: true, writable: false } : undefined),
  });
}

/** every picture of the file, parsed: what parseCard(md).assets holds, one picture line at a time */
export function allAssets(md, idx) {
  const s = String(md);
  const out = {};
  for (const [id, at] of assetIndex(s, idx)) {
    const a = parseCard(`## assets\n${s.slice(at[0], at[1])}`).assets;
    if (Object.prototype.hasOwnProperty.call(a, id)) Object.defineProperty(out, id, { value: a[id], enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/**
 * The model the page's head is made of (card-share.mjs describe / shareImage, card-icon.mjs cardAvatar,
 * iconLinks): the first profile tile of the face lanes, wherever it is in the file, and the pictures on
 * demand. The same tile `model.cells.find(profile)` finds on the whole file, so the description, the
 * share image and the icons of every window are the whole page's.
 */
export function headModel(md, idx) {
  const s = String(md);
  let cell = null, at = -2;
  const c = cursor();
  eachFace(idx, (lane, i) => {
    const [a, b] = spanOf(idx, lane, i);
    if (at !== -1 && at < a) at = s.indexOf('profile', a);
    if (at < 0) return false;                       // no tile from here on says the word: none is a profile
    if (at >= firstLineEnd(s, c, a)) return;      // a profile tile names its type on its first line
    const got = parseCard(`## grid\n${s.slice(a, b)}`).cells[0];
    if (got && got.type === 'profile') { cell = got; return false; }
  });
  return { pre: '', post: '', cols: 6, lane: 'grid', blocks: [{ label: '', start: 0, count: cell ? 1 : 0 }], cells: cell ? [cell] : [], drawers: [], assets: assetsOnDemand(s, idx) };
}

/**
 * card-blank.mjs isTemplateOnly, answered from the index: the same checks in the same terms (no picture,
 * no back, nothing after the lanes, no prose before them, no section label, and every face tile one of
 * the blank-card writers' own), with the tiles read one at a time and the walk stopped at the first one
 * an author wrote. A file of the same few template tiles repeated is read once per distinct tile.
 */
export function blankAbove(md, idx) {
  try {
    const s = String(md);
    if (idx.settings >= 0) return false;                                   // `post` holds the settings block
    if (idx.lanes.some((l) => l.kind === 'back')) return false;            // a back, even an empty one
    if (assetIndex(s, idx).size) return false;                             // a picture
    const preRaw = s.slice(0, idx.preEnd);
    const preLines = preRaw.split(/\r\n|\r|\n/);
    if (idx.preEnd > 0 && /[\r\n]$/.test(preRaw)) preLines.pop();
    if (preLines.join('\n').replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '').trim()) return false;
    let first = true;
    for (const l of idx.lanes) {
      if (l.kind !== 'face') continue;
      if (!first && l.title.trim()) return false;                          // a section label
      first = false;
    }
    const seen = new Map();
    let all = true;
    eachFace(idx, (lane, i) => {
      const [a, b] = spanOf(idx, lane, i);
      const raw = s.slice(a, b);
      let ok = seen.get(raw);
      if (ok === undefined) { ok = isTemplateCell(parseCard(`## grid\n${raw}`).cells[0]); seen.set(raw, ok); }
      if (!ok) { all = false; return false; }
    });
    return all;
  } catch { return false; }
}

/**
 * The frontmatter w3/deck-page.mjs frontOf reads (the fence at the top of the file), read from the
 * shortest prefix of the file that holds it: frontOf normalises CRLF and takes the first `\n---\n`
 * after the opening line, so the prefix ending there reads exactly what the whole file reads.
 */
export function deckFront(md) {
  const s = String(md);
  const open = s.startsWith('---\r\n') ? 5 : s.startsWith('---\n') ? 4 : -1;
  if (open < 0) return '';
  const lf = s.indexOf('\n---\n', open), crlf = s.indexOf('\n---\r\n', open);
  const at = lf < 0 ? crlf : crlf < 0 ? lf : Math.min(lf, crlf);
  if (at < 0) return '';
  return frontOf(s.slice(0, at + (at === crlf ? 6 : 5)));
}

/** the back lanes by id: id → { tiles, units, lanes } (two lanes may share an id: both are drawn) */
function backsOf(idx) {
  const out = new Map();
  for (const l of idx.lanes) {
    if (l.kind !== 'back') continue;
    const b = out.get(l.id) || { tiles: 0, units: 0, lanes: [] };
    b.tiles += l.t1 - l.t0; b.units += l.end - l.head; b.lanes.push(l);
    out.set(l.id, b);
  }
  return out;
}

/**
 * The backs a stretch of text may turn over to: every back whose id follows a `#` in it, read with
 * case and runs of whitespace folded the way card-render.mjs backTarget folds a `back=#…` value. A
 * superset of what the renderer opens (a `back=` param, a `[label](#id)` link): one more back than
 * needed costs a panel nobody opens, one fewer would be a tile that does not turn over.
 * `ids` is backIds(): the ids as a set, and the lengths they come in. At each `#` the text after it is
 * looked up once per length, so the cost is the `#`s times the distinct lengths, never the `#`s times the
 * backs (the 25 MiB sample has 4,201 backs: comparing every one at every `#` took 7 s).
 */
const backIds = (ids) => ({ set: new Set(ids), lengths: [...new Set(ids.map((id) => id.length))] });
function backsNamed(text, ids) {
  if (!ids.set.size || text.indexOf('#') < 0) return [];
  const t = text.toLowerCase().replace(/\s+/g, '-');
  const out = new Set();
  for (let h = t.indexOf('#'); h >= 0; h = t.indexOf('#', h + 1)) {
    for (const n of ids.lengths) { const id = t.substr(h + 1, n); if (id.length === n && ids.set.has(id)) out.add(id); }
  }
  return [...out];
}

/**
 * windowsOf(md, idx, { front }) → { starts, count, faceTotal }: the windows, as the face-tile ordinal
 * each one starts at. Deterministic for one file: every request for one revision cuts it the same way.
 * `front` is the deck's frontmatter (deckFront): the back it names as the default is drawn in every window.
 */
export function windowsOf(md, idx, { front = '', tiles: T = WINDOW_TILES, units: U = WINDOW_UNITS } = {}) {
  const s = String(md);
  const backs = backsOf(idx);
  const ids = [...backs.keys()];
  const named = backIds(ids);
  const always = ids.filter((id) => front.includes(id));
  const baseT = always.reduce((n, id) => n + backs.get(id).tiles, 0);
  const baseU = always.reduce((n, id) => n + backs.get(id).units, 0);
  const starts = [0];
  let wt = baseT, wu = baseU, n = 0, carried = new Set(always), hash = -2, total = 0;
  eachFace(idx, (lane, i, k) => {
    const [a, b] = spanOf(idx, lane, i);
    let refs = [];
    if (ids.length) {
      if (hash !== -1 && hash < a) hash = s.indexOf('#', a);
      if (hash >= 0 && hash < b) refs = backsNamed(s.slice(a, b), named);
    }
    const cost = (set) => refs.filter((id) => !set.has(id)).reduce((x, id) => [x[0] + backs.get(id).tiles, x[1] + backs.get(id).units], [1, b - a]);
    let [dt, du] = cost(carried);
    if (n > 0 && (wt + dt > T || wu + du > U)) {
      starts.push(k);
      carried = new Set(always); wt = baseT; wu = baseU; n = 0;
      [dt, du] = cost(carried);
    }
    for (const id of refs) carried.add(id);
    wt += dt; wu += du; n++; total = k + 1;
  });
  return { starts, count: starts.length, faceTotal: total };
}

/**
 * windowOf(md, idx, plan, n, { front }) → the model of window n (0-based): its face tiles, cut into the
 * blocks they belong to (a block's label shows where the window starts at the top of that lane, as on
 * the whole page: the first face lane has none, and a window that starts inside a lane does not repeat
 * it), the backs those tiles may turn over to plus the frontmatter's default back, and the file's
 * pictures on demand. Each piece is parsed by card-core's parseCard alone — a run of whole tiles of one
 * lane, a whole back lane — so every cell is the cell the whole file's parse holds.
 */
export function windowOf(md, idx, plan, n, { front = '' } = {}) {
  const s = String(md);
  const k0 = plan.starts[n], k1 = n + 1 < plan.count ? plan.starts[n + 1] : plan.faceTotal;
  const backs = backsOf(idx);
  const ids = [...backs.keys()];
  const named = backIds(ids);
  const carried = new Set(ids.filter((id) => front.includes(id)));
  const cells = [], blocks = [];
  let k = 0, firstFace = true;
  for (const lane of idx.lanes) {
    if (lane.kind !== 'face') continue;
    const count = lane.t1 - lane.t0;
    const from = Math.max(k0, k), to = Math.min(k1, k + count);
    if (from < to) {
      const i0 = lane.t0 + (from - k), i1 = lane.t0 + (to - k);
      const a = idx.starts[i0], b = spanOf(idx, lane, i1 - 1)[1];
      const text = s.slice(a, b);
      for (const id of backsNamed(text, named)) carried.add(id);
      const got = parseCard(`## grid\n${text}`).cells;
      if (got.length !== i1 - i0) throw new Error(`size tier: ${i1 - i0} tiles read as ${got.length}`);
      blocks.push({ label: from === k && !firstFace ? lane.title : '', start: cells.length, count: got.length });
      for (const c of got) cells.push(c);
    }
    k += count;
    firstFace = false;
    if (k >= k1) break;
  }
  const drawers = [];
  for (const lane of idx.lanes) {
    if (lane.kind !== 'back' || !carried.has(lane.id)) continue;
    const d = parseCard(s.slice(lane.head, lane.end)).drawers[0];
    if (d) drawers.push(d);
  }
  if (!blocks.length) blocks.push({ label: '', start: 0, count: 0 });
  return { pre: '', post: '', cols: 6, lane: 'grid', blocks, cells, drawers, assets: assetsOnDemand(s, idx) };
}

/**
 * The revision a window belongs to: the first 16 hex digits of a SHA-256 over the file, taken in
 * 1 Mi-unit slices (each slice's digest, then one digest of those), so no copy of the whole file is
 * made to hash it. The page and every window carry it; a window asked for under another revision is
 * redirected (serve/card-worker.mjs), so a visitor never puts two revisions on one page.
 */
export async function revisionOf(md) {
  const s = String(md);
  const enc = new TextEncoder();
  const SLICE = 1 << 20;
  const parts = new Uint8Array(Math.max(1, Math.ceil(s.length / SLICE)) * 32);
  let n = 0;
  for (let a = 0; a < s.length || n === 0; ) {
    let b = Math.min(s.length, a + SLICE);
    if (b < s.length && (s.charCodeAt(b - 1) & 0xfc00) === 0xd800) b--;   // never between the two halves of a pair
    parts.set(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s.slice(a, b)))), n * 32);
    n++;
    if (b >= s.length) break;
    a = b;
  }
  const all = new Uint8Array(await crypto.subtle.digest('SHA-256', parts.subarray(0, n * 32)));
  return [...all.subarray(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
