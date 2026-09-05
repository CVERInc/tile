// cardtile — heterogeneous widget GRID as a Markdown SSOT (the REEF with Card content model).
//
// 🔴 SCOPE: tile monorepo package. The production feelreef Card (block-JSON) is a SEPARATE thing and
// is NOT touched. This is the markdown-substrate model the family points at (Blog flowtile / Site
// sitetile / Card cardtile, all "markdown 當底材、編輯器投影結構", see [[site-ir-markdown-substrate]]).
//
// Reuse, don't rebuild:
//   - tugtile board-core  → the markdown↔cards MACHINE (one `## ` lane holds the cells, `- [ ]` cards,
//     fence-guard, frontmatter/pre·post preserved, exact round-trip).
//   - sitetile parseParams → the typed-marker PARAM parser (`type w=2 h=1 cta="x"→/y`).
//
// Model = a FLAT, ordered list of typed cells + a column count. The 2D grid is a RENDER-time PACK of
// that flat list into a `cols`-wide grid honouring each cell's w×h span (first-fit, no overlap = the
// 1×1–3×3 防醜 grid: you can't author gaps or collisions). Reorder = reorder the flat list.
//
// On-disk shape (one Card page = one markdown file):
//   ---
//   card-page: aster
//   cols: 3
//   ---
//   ## grid                              ← one lane carries the ordered cells (board-core needs a lane)
//   - [ ] %% card: text w=3 %% Hi, I'm **Aster**.       ← short body inline after the marker
//   - [ ] %% card: button w=1 %% [Patreon](https://…)
//   - [ ] %% card: events w=1 h=2 %%                    ← heavy widget: fenced-JSON body on tab续行
//   	```
//   	{"source":"discord:guild123","show_count":3}
//   	```
//
// 🔴 Fenced-JSON / body indentation rule (formalised): a cell's body is stored DE-INDENTED in the
// model. cellToRaw prefixes EXACTLY ONE tab to every body line; board-core strips exactly one leading
// tab (it prefers \t over spaces in its de-indent), so a fence's ``` and any inner JSON space-indent
// survive verbatim AND never sit at column 0 — therefore a body `## x`, `- [ ] y`, or ``` can never be
// mis-read as a lane heading / new card / lane-level fence. Round-trip safe.

// 🩸 These two used to be VENDORED COPIES — three files pulled out of the public repo by
// scripts/fetch-tile.sh, pinned by blob hash in a lock, checked by a drift script and an
// integrity test. That whole apparatus existed for one reason: the public repo was somewhere
// else on the disk. It is a submodule now (engine/, pinned by commit like every other repo in
// the portfolio), so the copies and the machinery that kept them honest are both gone.
import { parseFile, serializeFile } from '../tugtile/board-core.js';
import { parseParams, splitFrontmatter } from '../sitetile/site-core.js';

// 🔴 A Card is SIX columns. Not a default — the number. `cols:` used to be a frontmatter knob with
// a default of 3, and every card ever written set it to 6, because 6 is what makes the bento's base
// unit a square at card width. A knob nobody turns is a decision pretending to be a preference: it
// costs a line in every card, a branch in the renderer, and a way for a card to arrive malformed.
// If a different width is ever genuinely wanted, that is a new layout, not a number.
const DEFAULT_COLS = 6;
// Span ceiling. Raised 3→6 (2026-07-28) because a real card on its own domain
// is a 6-col grid with a full-width (w=6) profile banner + 3×2 / 2×2 tiles — the
// substrate must carry the card spec, not shrink it to a demo-stage cap. 防醜 is
// preserved regardless: packGrid still clamps w to `cols` and guarantees no gaps /
// no overlap, so a cell can never overflow the grid or collide.
const SPAN_MAX = 6;
const DEFAULT_LANE = 'grid';

// marker + body, body either INLINE after the closing %% (button/link) or on the following lines
// (prose / fenced JSON). [1]=inner(type+params), [2]=same-line trailing, [3]=following lines.
const RE_CARD_MARKER = /^%%\s*card:\s*(.*?)\s*%%[ \t]*([^\n]*)\n?([\s\S]*)$/;

const clampSpan = (v, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(1, Math.floor(n)));
};

// one tugtile card's text → a typed cell. No marker = a plain text widget (whole text is the body).
function extractCell(text) {
  const m = RE_CARD_MARKER.exec(text || '');
  if (!m) return { type: 'text', params: {}, rawParams: '', body: (text || '').trim() };
  const sp = /^(\S+)\s*([\s\S]*)$/.exec(m[1].trim());
  const type = sp ? sp[1] : 'text';
  const rawParams = sp ? sp[2].trim() : '';
  const body = (m[2] + (m[3] ? '\n' + m[3] : '')).replace(/\s+$/, '');
  return { type, params: parseParams(rawParams), rawParams, body: body.replace(/^\n+/, '') };
}

// a typed cell → one tugtile `- [ ] …` card block. Short single-line body stays inline after the
// marker; multi-line body (prose / fenced JSON) goes on tab-indented续行 (the indentation rule above).
function cellToRaw(cell) {
  const marker = '%% card: ' + cell.type + (cell.rawParams ? ' ' + cell.rawParams : '') + ' %%';
  const body = cell.body || '';
  if (!body) return '- [ ] ' + marker;
  if (!body.includes('\n')) return '- [ ] ' + marker + ' ' + body;
  return '- [ ] ' + marker + body.split('\n').map((l) => '\n\t' + l).join('');
}

// A DRAWER lane: `## drawer: about` holds cells shown in an overlay over the card face, opened by a
// `[label](#about)` link. This is how a Card gains depth WITHOUT gaining pages:
//   one markdown file · one store row · one URL (a #hash at most) · ONE LEVEL DEEP.
// 🔴 Drawers are LEAVES: they cannot open other drawers and cannot nest (enforced at render). Without
// a navigation graph you cannot build a site out of them — that structural impossibility, not a rule
// anyone has to remember, is what keeps a free Card from creeping into being a free Site.
// A drawer may carry a display title after an ASCII `|`:  `## drawer: stockists | 寄售店家資訊`.
// The id is what `[label](#stockists)` targets and what the hash deep-links; the title is what the
// overlay shows AND its accessible name — a role="dialog" with no name is a dialog a screen reader
// announces as nothing. Previously that heading was a `section` cell sitting inside the drawer,
// which is why removing the section cell had to answer this rather than drop it.
// The ASSETS lane: `## assets` holds the card's images, base64-encoded, one per line, addressed by
// the sha256 of their bytes. This is what makes a Card ONE FILE — read it, change it, write it back,
// and the pictures came along. The alternative (object storage plus URLs) is cheaper in bytes and
// much worse where it counts: an agent editing a card would have to upload bytes, mint a URL, write
// a reference and collect orphans afterwards, which is four operations and a garbage-collection
// problem where markdown gives one read and one write. Binary is exactly where the "markdown is the
// agent's native substrate" bet either holds or leaks.
//
// 🔴 Assets are hoisted OUT of `cells` and `blocks` into `model.assets`. That is not tidiness: a
// reader that walks the cells — an editor, an agent, a diff — never has a megabyte of base64 in
// front of it, and can hand back a modified card without ever having held the blobs.
// On disk each asset is an ordinary cell of type `asset` — the same `- [ ] %% card: … %%` machine as
// everything else, so nothing new had to learn to read or write it:
//   ## assets
//   - [ ] %% card: asset id=sha256-462fe2371720dccb mime=image/webp %% UklGRg…
const RE_ASSET_LANE = /^assets$/i;

const RE_DRAWER_LANE = /^drawer\s*:\s*(.+)$/i;
const splitDrawer = (title) => {
  const m = RE_DRAWER_LANE.exec(String(title || '').trim());
  if (!m) return null;
  const bar = m[1].indexOf('|');
  const id = (bar < 0 ? m[1] : m[1].slice(0, bar)).trim().toLowerCase().replace(/\s+/g, '-');
  return { id, title: bar < 0 ? '' : m[1].slice(bar + 1).trim() };
};
const drawerId = (title) => (splitDrawer(title) || {}).id ?? null;

// parseCard: markdown → { pre, post, cols, lane, blocks:[{label,cells}], cells:[Cell], drawers:[…] }.
//
// A non-drawer lane is a BENTO BLOCK — one titled section of the card face, packed independently.
// The first lane is the face itself and carries no label (`## grid`); every lane after it shows its
// title, so `## English` is a section heading and nothing else has to be.
//
// This replaces a `section` CELL that existed only to say "a new block starts here": a heading
// wearing a cell's clothes, taking `w=6 h=1` of a grid it was not really part of. The lane machine
// was already here, doing exactly this job for drawers.
//
// 🔴 `blocks` holds RANGES into `cells`, not its own cell arrays. There is exactly one array of
// cells, so the existing mutation paths (`model.cells[i] = setSpan(...)`, reorder) keep working.
// The first version gave each block its own list and the two aliased the same objects — assigning
// through `cells[i]` updated one view and not the other, and serialize silently wrote the stale
// cell back out. Two views over one truth is a fork with extra steps.
function parseCard(md) {
  const m = parseFile(md);
  const { meta } = splitFrontmatter((m.pre || '') + '\n');
  const cells = [];
  const blocks = [];
  const drawers = [];
  let faceLane = null;
  const assets = {};
  for (const col of m.columns) {
    const laneTitle = String(col.title || '').trim();
    if (RE_ASSET_LANE.test(laneTitle)) {
      for (const t of col.tiles) {
        const c = extractCell(t.text);
        const id = (c.params.id || '').trim();
        if (c.type === 'asset' && id) assets[id] = { mime: c.params.mime || 'image/webp', b64: (c.body || '').trim() };
      }
      continue;                                    // never a cell, never a block
    }
    const d = splitDrawer(col.title);
    const laneCells = col.tiles.map((t) => extractCell(t.text));
    if (d) { drawers.push({ id: d.id, title: d.title, cells: laneCells }); continue; }
    // the first face lane names itself (`grid`) and shows no label; later lanes are titled sections
    const label = faceLane == null ? '' : String(col.title || '').trim();
    if (faceLane == null) faceLane = col.title;
    blocks.push({ label, start: cells.length, count: laneCells.length });
    cells.push(...laneCells);
  }
  if (!blocks.length) blocks.push({ label: '', start: 0, count: 0 });
  return {
    pre: m.pre || '',
    post: m.post || '',
    cols: DEFAULT_COLS,          // a Card is six columns. See the note on DEFAULT_COLS.
    lane: faceLane != null ? faceLane : DEFAULT_LANE,
    blocks,
    cells,
    drawers,
    assets,
  };
}

// serializeCard: model → markdown. One canonical face lane + one lane per drawer. Idempotent.
function serializeCard(model) {
  const laneOf = (title, cells) => ({
    header: '## ' + title,
    title,
    lead: [],
    tiles: (cells || []).map((c) => ({ raw: cellToRaw(c), text: '', check: ' ', block: null })),
  });
  // one lane per bento block (the first is the face and keeps the card's lane name), then the
  // drawers. Round-trips: a labelled block came from `## <label>` and goes back out the same way.
  const cells = model.cells || [];
  const blocks = model.blocks && model.blocks.length
    ? model.blocks
    : [{ label: '', start: 0, count: cells.length }];
  const columns = blocks.map((b, i) =>
    laneOf(i === 0 ? (model.lane || DEFAULT_LANE) : (b.label || DEFAULT_LANE),
           cells.slice(b.start, b.start + b.count)));
  for (const d of model.drawers || []) columns.push(laneOf('drawer: ' + d.id + (d.title ? ' | ' + d.title : ''), d.cells));
  // the blobs go LAST, so a human opening the file reads the card before the bytes
  const assetIds = Object.keys(model.assets || {});
  if (assetIds.length) {
    columns.push(laneOf('assets', assetIds.sort().map((id) => ({
      type: 'asset',
      rawParams: `id=${id} mime=${model.assets[id].mime}`,
      params: { id, mime: model.assets[id].mime },
      body: model.assets[id].b64,
    }))));
  }
  return serializeFile({ pre: model.pre || '', columns, archive: '', post: model.post || '', eol: '\n' });
}

// packGrid: the 2D PROJECTION. First-fit pack of the flat cell list into a `cols`-wide grid honouring
// w (col-span) and h (row-span). Returns { placements:[{cell,index,row,col,w,h,type}], rows, cols }.
// A row-spanning (h>1) cell truly occupies cells in the next row(s); later cells flow around it. No
// overlap, no manual gaps — the 防醜 guarantee.
function packGrid(model) {
  const cols = Math.max(1, model.cols || DEFAULT_COLS);
  const occ = [];                                   // occ[r][c] = occupied?
  const ensureRow = (r) => { while (occ.length <= r) occ.push(new Array(cols).fill(false)); };
  const fits = (r, c, w, h) => {
    if (c + w > cols) return false;
    for (let dr = 0; dr < h; dr++) { ensureRow(r + dr); for (let dc = 0; dc < w; dc++) if (occ[r + dr][c + dc]) return false; }
    return true;
  };
  const mark = (r, c, w, h) => { for (let dr = 0; dr < h; dr++) { ensureRow(r + dr); for (let dc = 0; dc < w; dc++) occ[r + dr][c + dc] = true; } };

  const placements = [];
  (model.cells || []).forEach((cell, index) => {
    const w = Math.min(clampSpan(cell.params.w, SPAN_MAX), cols);   // can't be wider than the grid
    const h = clampSpan(cell.params.h, SPAN_MAX);
    let r = 0, done = false;
    while (!done) {
      ensureRow(r);
      for (let c = 0; c < cols; c++) {
        if (fits(r, c, w, h)) { mark(r, c, w, h); placements.push({ cell, index, row: r, col: c, w, h, type: cell.type }); done = true; break; }
      }
      r++;
      if (r > 10000) { done = true; }                               // safety
    }
  });
  return { placements, rows: occ.length, cols };
}

// set/remove a `key=value` token in a rawParams string, preserving other params + their order.
//
// 🔴 The VALUE grammar is parseParams's, not `\S+`. A quoted value may contain spaces
// (`title="Two Words"`, and the link form `cta="Label"→/href`), and a `\S+` pattern matches only
// `title="Two` — so setting an existing quoted param used to replace half of it and leave the rest
// as a stray bare word, which parseParams then reads as a boolean flag. It never came up because
// nothing wrote params programmatically until there was an editor. An editor is where this class of
// thing surfaces: hand-written files carry the shapes the code paths never exercised.
const VAL = '("[^"]*"(?:→\\S+)?|\\S+)';
const tokenRe = (key) => new RegExp('(^|\\s)' + key + '=' + VAL);

/** quote a value if it needs it, so a token round-trips through parseParams unchanged */
function quoteParam(v) {
  const s = String(v);
  if (s === '') return '""';
  return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '') + '"' : s;
}

function setToken(rp, key, val) {
  const re = tokenRe(key);
  if (re.test(rp)) return rp.replace(re, (m, pre) => pre + key + '=' + val);
  return (rp ? rp + ' ' : '') + key + '=' + val;
}
function removeToken(rp, key) {
  return rp.replace(tokenRe(key), '').replace(/^\s+|\s+$/g, '').replace(/\s{2,}/g, ' ');
}

// setSpan: PURE — return a new cell with its WIDTH set (clamped 1..SPAN_MAX, and to maxW=cols).
// Writes BOTH params (the parsed map) AND rawParams (what serializeCard emits), so the resize
// survives round-trip.
//
// 🔴 It no longer writes `h`, and the third argument is ignored rather than removed so existing
// callers keep working instead of silently passing maxW into the wrong slot. There is ONE layout
// model now (74f83d8): a cell's height comes from its content, and the renderer sets `grid-row:auto`,
// so an authored `h` means nothing. A drag-to-resize gesture was the one remaining path that could
// write the dead token back into a creator's file, where it would serialise cleanly, read as "just a
// span" in review, and do nothing at all. An editor is exactly where a retired parameter comes back.
//
// Any `h` ALREADY in someone's file is left where it is — round-tripping their card byte-for-byte is
// the promise the editor stands on, and quietly rewriting tokens we no longer like would break it.
// We stop writing new ones; we do not go through anybody's card deleting things.
function setSpan(cell, w, _hIgnored, maxW) {
  const cw = Math.min(clampSpan(w, SPAN_MAX), maxW || SPAN_MAX);
  const rp = setToken(cell.rawParams || '', 'w', String(cw));
  return { ...cell, rawParams: rp, params: parseParams(rp) };
}

// normalizeCell: {type, rawParams, body} → the cell a re-parse of the FILE would produce.
//
// An editor that hands back a cell object it built itself is asserting that the reader agrees with
// it. This runs the assertion instead: serialize the cell into a one-lane document and parse that
// document, so what the editor stores is, by construction, what reading the file back gives.
//
// 🔴 It goes through parseCard, NOT extractCell. cellToRaw emits a whole tugtile line — the
// `- [ ] ` prefix and the one-tab body indent are board-core's, and extractCell has never seen
// either. cardtile-w did exactly that for its first hour: every form save turned a `link` cell into
// a `text` cell whose body was the literal text `- [ ] %% card: link … %%`, silently, with a form
// that had read and written every param correctly. The params were never the hard part; the
// boundary between two parsers was.
function normalizeCell(cell) {
  return parseCard('## ' + DEFAULT_LANE + '\n' + cellToRaw(cell) + '\n').cells[0];
}

// setTitle: PURE — the card's NAME, which is the frontmatter `title:` and not a cell at all.
//
// 🔴 This exists because the name was the one thing a visitor could not change. The renderer draws
// `ctx.name` from frontmatter, the profile form had no field for it, and its hint said 「名字來自
// frontmatter 的 title」 — an instruction to go and edit something the sandbox deliberately hides.
//
// 🔴 ONE LINE. `model.pre` is everything before the first lane: the frontmatter block AND whatever
// prose an author put under it. The rewrite is scoped to the frontmatter fence (`---` … `---`) so a
// sentence beginning "title:" in someone's lead paragraph is not silently a field. If there is no
// fence, or no `title:` in it, one is inserted at the top of the block and nothing else moves —
// round-tripping a creator's file byte-for-byte apart from the line they changed is the promise.
function setTitle(model, name) {
  const pre = String(model.pre || '');
  const line = 'title: ' + String(name == null ? '' : name).trim();
  const fence = /^---\r?\n([\s\S]*?)(\r?\n)---[ \t]*$/m.exec(pre);
  if (!fence) return { ...model, pre: '---\n' + line + '\n---\n' + (pre ? '\n' + pre.replace(/^\n+/, '') : '') };
  const inner = fence[1];
  const next = /^title:.*$/m.test(inner)
    ? inner.replace(/^title:.*$/m, line)
    : (inner ? line + '\n' + inner : line);
  return { ...model, pre: pre.slice(0, fence.index) + '---\n' + next + fence[2] + '---' + pre.slice(fence.index + fence[0].length) };
}

// reorder: PURE flat-list move (drag → drop). Returns a new model with cell moved from→to (clamped).
function reorder(model, from, to) {
  const cells = (model.cells || []).slice();
  if (from < 0 || from >= cells.length) return model;
  const [moved] = cells.splice(from, 1);
  const dest = Math.min(Math.max(0, to), cells.length);
  cells.splice(dest, 0, moved);
  return { ...model, cells };
}

export { parseCard, serializeCard, packGrid, reorder, setSpan, extractCell, cellToRaw, clampSpan };
// the param primitives, exported for cardtile-w. 🔴 The editor must not carry its own copy of this
// grammar — two implementations of "what a param looks like" is how a form starts writing tokens the
// parser reads differently, on somebody's only copy of their file.
export { setToken, removeToken, quoteParam, normalizeCell, setTitle };
