// The Card ⇄ tugtile-BOARD projection. Pure; no DOM, no window, node-testable.
//
// 🔴 THE ONE IDEA THIS FILE EXISTS TO PROTECT. A Card's markdown already IS a tugtile board — the
// `## <lane>` headings are lanes and the `- [ ] %% card: … %%` items are tiles, which is why
// card-core parses it with board-core's own `parseFile`. So `/try/edit` does not need a board
// implementation; it needs a way to show the board a person can read.
//
// It gets that by PROJECTING, in one direction only:
//
//     card markdown  ──boardMd()──▶  a tugtile board the engine's host renders
//          ▲                                        │
//          └──────── applyBoardOrder(order) ◀────────┘  (ORDER ONLY, never text)
//
// The card markdown is the SSOT and the board never writes a byte of it back. What comes back from
// the board is a PERMUTATION — which tile sits in which lane, in what order — and that is applied to
// the model with card-core's own primitives. That is what keeps the round-trip promise: a board you
// look at and do not touch serialises to the card you opened, byte for byte, base64 assets and all.
//
// 🩸 The tempting alternative was to feed the card markdown to `window.__load` directly. It would
// have worked, once: the tiles would read `%% card: link w=6 sub="Discord" %% [a community's](…)`,
// and every tile edit would have gone back through tugtile's own text editor — which knows nothing
// about `%% card:` markers, cannot compose a link, and would have handed a creator's file to a
// markdown textarea. The board shows a SUMMARY; the seven typed sheets do the editing.
import { linkOf, hostLabel, hostOf, iconDomains } from '../card-render.mjs';
import { posterPath } from '../yt.mjs';

/** the frontmatter `title:` — the name a profile tile shows. Same one-line read as w/editor.mjs. */
export const cardTitle = (md) => /^title:\s*(.*)$/m.exec(String(md || ''))?.[1]?.trim() || '';

/**
 * The lanes of the board, in board order: every face BLOCK, then every drawer.
 *
 * A Card's face is already sectioned — `model.blocks` holds ranges into `model.cells`, the first
 * unlabelled (the card's front) and the rest titled by their own `## English` heading. Those are the
 * lanes. Drawers follow, each its own lane, which is exactly the owner's mental model: a
 * second-level card lives in the second lane and links back.
 *
 * `key` is the STABLE identity a lane is addressed by (`face:0`, `drawer:stockists`) — not its
 * position, because a lane can be dragged.
 */
export function boardLanes(model, ctx = {}) {
  const cells = model.cells || [];
  const blocks = (model.blocks && model.blocks.length)
    ? model.blocks
    : [{ label: '', start: 0, count: cells.length }];
  const lanes = blocks.map((b, i) => ({
    key: `face:${i}`,
    kind: 'face',
    block: i,
    // the first block is the card's front and carries no heading of its own, so it is NAMED here
    title: i === 0 ? (ctx.faceLabel || 'Card front') : (b.label || ''),
    cells: cells.slice(b.start, b.start + b.count),
  }));
  for (const d of model.drawers || []) {
    lanes.push({
      key: `drawer:${d.id}`,
      kind: 'drawer',
      drawerId: d.id,
      title: d.title || d.id,
      cells: d.cells || [],
    });
  }
  return lanes;
}

/**
 * Every cell on the board in READING ORDER, with where it came from.
 *
 * 🔴 The index into this array is the tile's identity for the whole session, and it is the same
 * number the engine's host puts in `data-tid` — that host pushes tiles onto one flat `TILES` array
 * as it renders lane after lane, so "the n-th tile the board rendered" and "the n-th slot here" are
 * the same n by construction, not by coincidence. Nothing else has to be agreed on between the two.
 */
export function boardSlots(model, ctx = {}) {
  const out = [];
  for (const lane of boardLanes(model, ctx)) {
    lane.cells.forEach((cell, i) => out.push({ laneKey: lane.key, kind: lane.kind, block: lane.block, drawerId: lane.drawerId, cellIndex: i, cell }));
  }
  return out;
}

/**
 * A RENDERED cell → its board slot. This is what a tap on the card itself resolves through.
 *
 * The renderer (editIndex) writes `data-cell` on each cell, and the number means two different
 * things depending on WHERE the element is:
 *   on the face        the index into `model.cells` (the absolute one — blocks are ranges into it)
 *   inside a drawer    the index into THAT drawer's `cells` — renderDrawers renders each drawer as
 *                      its own one-block grid, so the count restarts at 0 in every panel
 * So the caller passes the drawer id it found the element under (`null` for the face) and this
 * finds the slot. -1 when nothing matches (a stale DOM after an edit) — never a guess, because a
 * guess opens the wrong cell's sheet.
 */
export function slotOfRenderedCell(model, drawerId, index, ctx = {}) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0) return -1;
  const blocks = (model.blocks && model.blocks.length)
    ? model.blocks
    : [{ start: 0, count: (model.cells || []).length }];
  return boardSlots(model, ctx).findIndex((s) => (drawerId
    ? s.kind === 'drawer' && s.drawerId === drawerId && s.cellIndex === n
    : s.kind === 'face' && blocks[s.block] && blocks[s.block].start + s.cellIndex === n));
}

/**
 * A drag ON THE CARD → the whole-board order `applyBoardOrder` takes. One mutation path: the card's
 * drag and the board's drag both end in `applyBoardOrder`, so there is no second serializer.
 *
 * `laneKey` is the lane the drag happened in (the card only lets a tile move within its own lane),
 * `renderedSlots` the board slots of that lane's RENDERED cells, in their new on-screen order.
 *
 * 🔴 A cell that renders to nothing has no element, so it is missing from `renderedSlots`. It keeps
 * its position in the lane and the rendered ones fill the remaining positions in their new order —
 * rebuilding the lane from the DOM alone would silently delete it from the file.
 *
 * Returns null (apply nothing) if the read is not a permutation of that lane's rendered cells: an
 * unknown slot, a slot from another lane, or a duplicate means the DOM was read mid-repaint.
 */
export function cardDropOrder(model, laneKey, renderedSlots, ctx = {}) {
  const order = identityOrder(model, ctx);
  const entry = order.find((e) => e.key === laneKey);
  if (!entry) return null;
  const inLane = new Set(entry.slots);
  const moved = (renderedSlots || []).map(Number);
  const set = new Set(moved);
  if (set.size !== moved.length || moved.some((n) => !inLane.has(n))) return null;
  let k = 0;
  entry.slots = entry.slots.map((n) => (set.has(n) ? moved[k++] : n));
  return order;
}

/** the lane an 「＋加一張牌」 drawn ON THE CARD adds to: the face's last section, or that drawer */
export function laneKeyForCardAdd(model, drawerId) {
  if (drawerId) return `drawer:${drawerId}`;
  const n = (model.blocks && model.blocks.length) || 1;
  return `face:${n - 1}`;
}

/** the board's own order, unchanged — the CONTROL every permutation test is measured against */
export function identityOrder(model, ctx = {}) {
  let n = 0;
  return boardLanes(model, ctx).map((lane) => ({ key: lane.key, slots: lane.cells.map(() => n++) }));
}

// ── what a tile SAYS ─────────────────────────────────────────────────────────────────────────────
//
// A summary, in the visitor's language, made of the markdown the engine's host already renders:
// a `###` line carrying the tile's own words AND a `#tag` naming its kind (which the host turns
// into a real chip via its `.tag` span), then a second line for the address or the drawer it opens.
// A second line is also what makes a tile FOLDABLE — the host folds anything with a newline in it —
// so the inherited fold control has something to fold, and the first line is what survives it.

const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim() !== '') || '';
const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

/** strip the markdown a summary line must not carry INTO a heading (a nested `#` would be a tag) */
const flat = (s) => String(s || '').replace(/[#\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The subtitle of a tile that opens drawer `target`: `opensLabel` filled with the drawer's title;
 * `⚠ <id>` when the drawer does not exist (a dangling link is reported, not hidden); '' for no target.
 */
export function opensText(target, ctx = {}) {
  if (!target) return '';
  const title = ctx.drawerTitle ? ctx.drawerTitle(target) : target;
  if (!title) return `⚠ ${target}`;
  return String(ctx.opensLabel || '→ Opens: {title}').replace('{title}', title);
}

/**
 * One cell → the tile text the board shows. `ctx` carries the words:
 *   ctx.typeName(type)   the tile kind, in the visitor's language (cell-i18n `type.<t>.title`)
 *   ctx.opensLabel       「→ 開啟：{title}」 and friends (board-i18n `board.opensLabel`) — the
 *                        subtitle of a tile that opens a drawer. It IS the board's drawer label
 *                        (ruling 2026-09-24: words, not lines; one place, not a pill beside it).
 *   ctx.title            the card's frontmatter title — the profile tile's name
 *   ctx.drawerTitle(id)  a drawer's display title, or '' when no such drawer exists (→ `⚠ id`)
 */
export function tileText(cell, ctx = {}) {
  const name = (t) => (ctx.typeName ? ctx.typeName(t) : t);
  const p = cell.params || {};
  // 🩸 THE KIND USED TO RIDE THIS LINE as a `#連結` hashtag, because the host's own `#tag` → `.tag`
  // chip was the only badge available and a FOLDED tile showed only line one. Both halves of that
  // reasoning are gone: the Card configuration of the host does not fold (nothing to survive) and
  // draws each tile as `tileFace` below (its own type icon, not a chip). What was left was a `#`
  // hashtag on every tile — which reads as a kanban label, and was the cold read's P1-2.
  const head = (s) => `### ${flat(s)}`;
  const target = drawerTargetOf(cell);
  const opens = opensText(target, ctx);

  switch (cell.type) {
    case 'profile':
      return [head(ctx.title || name('profile')), flat(firstLine(cell.body))].filter(Boolean).join('\n');
    case 'link': {
      const { label, url } = linkOf(cell.body);
      return [head(label || flat(cell.body) || name('link')), opens || url || '', flat(p.sub || '')]
        .filter(Boolean).join('\n');
    }
    case 'feature':
      return [head(flat(p.title) || flat(cell.body) || flat(p.alt) || name('feature')),
        opens || String(p.href || '')].filter(Boolean).join('\n');
    case 'text':
      // prose has no second line of its own — the body IS the tile, so the first line carries it
      return head(flat(firstLine(cell.body)) || name('text'));
    case 'video':
      return [head(flat(cell.body) || name('video')), String(p.yt || p.channel || '')]
        .filter(Boolean).join('\n');
    case 'social':
      return [head(name('social')),
        String(cell.body || '').split('\n').map((l) => linkOf(l).label || '').filter(Boolean).join(' · ')]
        .filter(Boolean).join('\n');
    case 'embed':
      return [head(name('embed')),
        String(p.images || '').split(',').filter(Boolean).length ? `${String(p.images || '').split(',').filter(Boolean).length}` : '']
        .filter(Boolean).join('\n');
    default:
      return head(flat(firstLine(cell.body)) || cell.type);
  }
}

/**
 * ONE CELL → WHAT THE TILE LOOKS LIKE. The mini-render of the finished element, as data.
 *
 * 🔴 THIS IS THE ANSWER TO "a tile that does not read as a link page". The cold read (2026-09-06,
 * P1-2) measured what the board showed a first-time visitor: a numbered chip, a `#型別` hashtag and
 * a folded title — a to-do list. What a Linktree editor shows is the BUTTON, the way it will look.
 * So a tile carries the same four things the finished element does: a picture (avatar, thumbnail,
 * poster), the words, the grey line under them, and a mark.
 *
 * Data, not markup, and pure — `edit2.mjs` turns this into the html the host's `tileHtml` hook asks
 * for, because only that side can resolve `asset:` bytes and only it knows the icon route. Which
 * keeps this file node-testable, which is how the seven types are actually checked.
 *
 *   kind    the cell type — the small icon the tile carries, and the face's modifier class
 *   title   the words on the finished element
 *   sub     the grey line under them: a domain, the drawer it opens, a caption, a count
 *   img     a picture to resolve (`asset:<id>` or a url), or ''
 *   icons   favicon DOMAINS, best first — one for a link, one per mark for a social row
 *
 * `ctx` adds to bridgeCtx: `unsetLink` / `unsetImg`, the two words the RENDERER already puts on a
 * tile whose address or picture is not filled in yet. The table says the same thing the card does.
 */
export function tileFace(cell, ctx = {}) {
  const name = (t) => (ctx.typeName ? ctx.typeName(t) : t);
  const p = (cell && cell.params) || {};
  const target = drawerTargetOf(cell);
  const opens = opensText(target, ctx);
  const face = { kind: (cell && cell.type) || 'text', title: '', sub: '', img: '', icons: [] };
  const marks = (url) => (url && !url.startsWith('#') && !url.startsWith('mailto:') ? iconDomains(hostOf(url)).slice(0, 1) : []);

  switch (face.kind) {
    case 'profile':
      face.title = flat(ctx.title) || name('profile');
      face.sub = flat(firstLine(cell.body));
      face.img = String(p.avatar || '');
      return face;
    case 'link': {
      const { label, url } = linkOf(cell.body);
      face.title = flat(label) || flat(cell.body) || name('link');
      face.sub = opens || (url ? hostLabel(url) : ctx.unsetLink || '');
      face.icons = marks(url);
      return face;
    }
    case 'feature':
      face.title = flat(p.title) || flat(cell.body) || flat(p.alt) || name('feature');
      face.img = String(p.img || '');
      face.sub = opens || (face.img ? flat(p.alt) || flat(cell.body) : ctx.unsetImg || '');
      face.icons = opens ? [] : marks(String(p.href || ''));
      return face;
    case 'text': {
      const ls = lines(cell.body);
      face.title = flat(ls[0] || '') || name('text');
      face.sub = flat(ls[1] || '');
      return face;
    }
    case 'video': {
      const id = String(p.yt || '').trim();
      face.title = flat(cell.body) || flat(p.title) || name('video');
      face.sub = id || String(p.channel || '').trim();
      face.img = String(p.poster || '') || (id ? posterPath(id) : '');
      return face;
    }
    case 'social': {
      const items = lines(cell.body).map((l) => linkOf(l)).filter((x) => x.url && x.url !== '#');
      face.title = name('social');
      face.sub = items.map((x) => x.label || hostLabel(x.url)).join(' · ');
      face.icons = items.flatMap((x) => marks(x.url)).slice(0, 6);
      return face;
    }
    case 'embed': {
      const imgs = String(p.images || '').split(',').map((s) => s.trim()).filter(Boolean);
      face.title = name('embed');
      face.sub = imgs.length ? String(imgs.length) : '';
      face.img = imgs[0] || '';
      return face;
    }
    default:
      face.title = flat(firstLine(cell.body)) || face.kind;
      return face;
  }
}

/**
 * The board markdown the engine's host is handed. Plain tugtile: a `kanban-plugin: board`
 * frontmatter, one `## ` per lane, one `- [ ] ` per tile. Nothing card-shaped survives into it,
 * which is the point — the host has never heard of a `%% card: %%` marker and never needs to.
 */
export function boardMd(model, ctx = {}) {
  const lines = ['---', 'kanban-plugin: board', '---', ''];
  for (const lane of boardLanes(model, ctx)) {
    lines.push(`## ${lane.title}`, '');
    for (const cell of lane.cells) {
      const text = tileText(cell, { ...ctx, title: ctx.title });
      const [head, ...rest] = text.split('\n');
      lines.push(`- [ ] ${head}${rest.map((l) => `\n\t${l}`).join('')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── what comes BACK ──────────────────────────────────────────────────────────────────────────────

/**
 * A permutation read off the board → a new model. `order` is `[{ key, slots:[slotIndex,…] }, …]`
 * in the board's current lane order; every slot index refers to `boardSlots(model)`.
 *
 * 🔴 Face lanes and drawer lanes keep their own groups. The Card model is `blocks` (ranges into one
 * flat `cells` array) and then `drawers` — it has no way to say "a drawer sits between two face
 * sections", so dragging a lane past that boundary must not be able to say it either. Each group
 * keeps its relative order; nothing is silently dropped and nothing is silently invented.
 *
 * 🔴 CELLS ARE MOVED, NEVER REBUILT. Every entry is the same object `parseCard` produced, `rawParams`
 * and all — including the params this editor has no form for, which is exactly the long tail a
 * creator wrote by hand.
 */
export function applyBoardOrder(model, order, ctx = {}) {
  const slots = boardSlots(model, ctx);
  const lanes = boardLanes(model, ctx);
  const byKey = new Map(lanes.map((l) => [l.key, l]));
  const seen = new Set();
  const pick = (n) => {
    const s = slots[n];
    if (!s || seen.has(n)) return null;
    seen.add(n);
    return s.cell;
  };

  const faceLanes = [];
  const drawerCells = new Map();
  for (const entry of order) {
    const lane = byKey.get(entry.key);
    if (!lane) continue;                                   // a lane we do not know is not a lane
    const cells = (entry.slots || []).map(pick).filter(Boolean);
    if (lane.kind === 'face') faceLanes.push({ block: lane.block, label: lane.title, cells });
    else drawerCells.set(lane.drawerId, cells);
  }
  // 🔴 A lane the board never reported is a lane that is still there. Losing one silently is how an
  // editor eats a section; the guard is cheap and the failure it prevents is not.
  for (const lane of lanes) {
    if (order.some((e) => e.key === lane.key)) continue;
    if (lane.kind === 'face') faceLanes.push({ block: lane.block, label: lane.title, cells: lane.cells });
    else if (!drawerCells.has(lane.drawerId)) drawerCells.set(lane.drawerId, lane.cells);
  }

  const cells = [];
  const blocks = [];
  for (const lane of faceLanes) {
    blocks.push({ label: lane.block === 0 ? '' : lane.label, start: cells.length, count: lane.cells.length });
    cells.push(...lane.cells);
  }
  if (!blocks.length) blocks.push({ label: '', start: 0, count: 0 });
  const drawers = (model.drawers || []).map((d) => ({ ...d, cells: drawerCells.has(d.id) ? drawerCells.get(d.id) : d.cells }));
  return { ...model, cells, blocks, drawers };
}

// ── 牽線: the drawer and the tile that opens it ───────────────────────────────────────────────────

/** the drawer id a cell opens, or `''`. A link says it in its body, a picture in its `href`. */
export function drawerTargetOf(cell) {
  if (!cell) return '';
  if (cell.type === 'link') {
    const u = linkOf(cell.body).url || '';
    return u.startsWith('#') ? u.slice(1) : '';
  }
  const h = String((cell.params || {}).href || '');
  return h.startsWith('#') ? h.slice(1) : '';
}

/**
 * Every 牽線 on the board: a tile that opens a drawer, and the lane that drawer IS.
 *
 * 🔴 `dangling` is reported, not hidden. A link to `#stockists` when no such drawer exists renders
 * as a dead button on the live card — that is a thing an author wants to see on the table, not a row
 * this function quietly filters out because it did not match.
 */
export function drawerLinks(model, ctx = {}) {
  const slots = boardSlots(model, ctx);
  const drawers = new Map((model.drawers || []).map((d) => [d.id, d]));
  const links = [];
  const dangling = [];
  slots.forEach((s, slot) => {
    const id = drawerTargetOf(s.cell);
    if (!id) return;
    const d = drawers.get(id);
    const row = { slot, fromLane: s.laneKey, drawerId: id, drawerLane: `drawer:${id}`, drawerTitle: d ? (d.title || d.id) : '' };
    (d ? links : dangling).push(row);
  });
  return { links, dangling };
}

/**
 * The drawer lane's heading, in WORDS (ruling 2026-09-24: a one-to-one relation needs a word, not a
 * line). The tile's side of the relation is its subtitle — see `opensText`. Each drawer's lane reads
 * `drawerOpenedBy` naming the FIRST tile that opens it, or its plain title when nothing opens it.
 * Derived from `drawerLinks`, the data the lines were drawn from.
 */
export function drawerLabels(model, ctx = {}, strings = {}) {
  const openedBy = strings['board.drawerOpenedBy'] || '{title} (opened by “{by}”)';
  const { links } = drawerLinks(model, ctx);
  const slots = boardSlots(model, ctx);
  const firstOpener = new Map();
  for (const l of links) if (!firstOpener.has(l.drawerId)) firstOpener.set(l.drawerId, l.slot);
  const lanes = (model.drawers || []).map((d) => {
    const title = d.title || d.id;
    const slot = firstOpener.get(d.id);
    const cell = slot == null ? null : (slots[slot] || {}).cell;
    const by = cell ? tileFace(cell, ctx).title : '';
    return { laneKey: `drawer:${d.id}`, heading: by ? openedBy.replace('{title}', title).replace('{by}', by) : title };
  });
  return { lanes };
}

/**
 * The board follows the SHELL, not the OS. The engine's tugtile page picks its token set with
 * `prefers-color-scheme`, so under a dark OS it painted rgb(30,30,30) inside feelreef's fixed-light
 * shell. The host has no theme parameter, and its files are reused unmodified, so the editor injects
 * this — the host's OWN light token values, verbatim from hosts/web/tugtile/index.html — into the
 * iframe's head after the host's style, where equal specificity and later order win under both schemes.
 */
export const BOARD_LIGHT_CSS = `
  :root { color-scheme: light;
    --background-primary: #ffffff; --background-secondary: #f6f6f6;
    --background-modifier-border: #e0e0e0; --background-modifier-border-hover: #d4d4d4;
    --background-modifier-form-field: #ffffff; --background-modifier-hover: rgba(0,0,0,.067);
    --text-normal: #222222; --text-muted: #5c5c5c; --text-faint: #ababab;
    --text-accent: hsl(258, 68%, 52%); --text-error: #c0392b; --text-success: #2f9e5e;
  }
`;
