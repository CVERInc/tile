// The Card editor — served at card.feelreef.com/try/edit (the public sandbox) and /edit?host=<origin>
// (host mode: framed by feelreef's dashboard to edit a real Card). Bundled by
// serve/gen-edit3-assets.mjs into serve/edit3-assets.mjs, which the Worker serves.
//
// Built on the engine's own pieces: the state is the card's Markdown (card-core); the sheet a pencil
// opens is cell-form-core's, built from CELL_TYPES, with cell-form-dom's pickers; a text tile is
// written with the family's text editor (editor-core + its web shim, borrowed as they ship). This
// module owns the row of tiles, the pairing chain, the swap, the numbers, Cards options, and Save.
//
// 🔴 NOTHING GOES LIVE UNTIL SAVE. The draft lives in this browser (localStorage) and survives a
// reload; leaving with it unsaved asks first. Save is the only door out:
//   sandbox  Save keeps it in this browser (there is no account behind /try/edit). The way to the
//            real thing is the banner's door: it parks the card and opens the creation flow.
//   host     Save posts `card:save {md}` to the parent (w3/host-bridge.mjs, schema in its header);
//            the parent stores it and answers `card:saved` / `card:save-failed`.
//
// The preview of a view is the PAGE: renderCardHTML(md, { deck }) — the same function, with the same
// deck (w3/deck-page.mjs), that the Worker serves to visitors.
import { parseCard, serializeCard, normalizeCell, setTitle, setToken, removeToken } from '../card-core.js';
import { CELL_TYPES, blankCell, PALETTE, DISPOSITION, CONTROL } from '../ai-ops.mjs';
import { formBodyHtml, composeCell } from '../w/cell-form-core.mjs';
import { whatIsWrong } from '../w/md-guard.mjs';
import { wireForm } from '../w/cell-form-dom.mjs';
import { cellStrings, text as cellText } from '../w/cell-i18n.mjs';
import { chromeStrings, primaryLocale, SANDBOX_LOCALES, buildSandboxCard } from '../w/sandbox-i18n.mjs';
import { sandboxDoorHref, parkSandboxCard } from '../w/sandbox-door.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { cardTitle } from './card-title.mjs';
import { typeIconSvg } from './type-icons.mjs';
import { createHostBridge, validHostOrigin, readsAsCard } from './host-bridge.mjs';
import { editStrings, fmt } from './edit3-i18n.mjs';

// ── the page's options, written by the Worker (card-worker.mjs editorHtml) ──
const OPTS = window.__CARDTILE_W3_OPTS__ || { sandbox: true };
const HOST = validHostOrigin(OPTS.host) || '';          // host mode wins: an allowed parent means a real card
const SANDBOX = !HOST;
const ASSET = OPTS.assets || {};                         // the borrowed files, by name → their served URL
const Q = new URLSearchParams(location.search);
const LOCALE = primaryLocale(Q.get('lang') || Q.get('locale') || OPTS.locale || navigator.language || 'en');

// the family's text editor (the one modaltile and tugtile write with), run outside Obsidian by its web
// shim. It reads its language once, when it is evaluated, so the global is set before the shim loads.
const FAMILY_LOCALE = { zh: 'zh-TW', ja: 'ja-JP', ko: 'ko-KR' };
globalThis.__TILE_LOCALE = FAMILY_LOCALE[LOCALE] || 'en-US';
await import(ASSET['obsidian-shim.js']);
const { mountEditor } = await import(ASSET['editor-core.js']);
const { makeWebHost } = await import(ASSET['web-host.js']);

const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
const MDICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── the engine's view of the kinds: only the params that asked for a control ──
// 🔴 minus `w`: how wide a tile sits on the face is the wall's question, so a tile's sheet never asks it
const LAYOUT = new Set(['w']);
const noLayout = (rows) => rows.filter((r) => !LAYOUT.has(r.name)).map((r) => (r.group ? { ...r, rows: noLayout(r.rows) } : r));
const TYPES = Object.fromEntries(Object.entries(CELL_TYPES).map(([type, def]) => [type, {
  ...def,
  ...(def.form ? { form: noLayout(def.form) } : {}),
  fields: Object.entries(def.params).filter(([n, p]) => p.disposition === DISPOSITION.FORM && !LAYOUT.has(n)).map(([name, p]) => ({ name, ...p })),
}]));

// ── words: this editor's own (edit3-i18n.mjs), the shared chrome, and the sheets' ──
const L = editStrings(LOCALE);
L.views = { stack: L.viewStack, list: L.viewList, wall: L.viewWall };
L.viewSays = { stack: L.viewSaysStack, list: L.viewSaysList, wall: L.viewSaysWall };
L.dimNames = { 0: L.dim0, 25: L.dim25, 45: L.dim45, 65: L.dim65 };
L.themeNames = { auto: L.themeAuto, light: L.themeLight, dark: L.themeDark };
L.headerNames = { centre: L.headerCentre, left: L.headerLeft };
L.iconsNames = { colour: L.iconsColour, mono: L.iconsMono };
L.poolNames = { on: L.poolNameOn, off: L.poolNameOff };
const T = chromeStrings(LOCALE), TX = cellStrings(LOCALE);
const PERSONA = SANDBOX_LOCALES[LOCALE] || SANDBOX_LOCALES.en;
document.documentElement.lang = PERSONA.lang;
for (const n of document.querySelectorAll('[data-l]')) n.textContent = L[n.dataset.l];
for (const n of document.querySelectorAll('[data-l-label]')) n.setAttribute('aria-label', L[n.dataset.lLabel]);
for (const n of document.querySelectorAll('[data-l-title]')) n.title = L[n.dataset.lTitle];
el('cardset').title = L.options;
const say = (key) => cellText(TX, key);

// ── state: the card's Markdown is the truth; the model is re-read from it on every change ──
// sandbox: KEY = what Save kept, DKEY = the draft being edited. host: the parent holds what is saved,
// and the draft is kept per handle, with the saved card it was made on top of (see onLoad).
const KEY = 'cardtile:w3:saved', DKEY = 'cardtile:w3:draft';
const W2_DRAFT_KEY = 'cardtile:try:draft:v1';   // the previous sandbox kept every edit here, unasked
const hostDraftKey = () => `cardtile:w3:host-draft:${handle || 'card'}`;
const EMPTY = '## cards\n\n';
let handle = '', cardUrl = '';
let savedMd = SANDBOX ? loadSaved() : EMPTY, md = SANDBOX ? loadDraft() : EMPTY, m = read(md), view = 'stack', editing = false, pending = {};
let bridge = null, hostWaiting = !SANDBOX;
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* best-effort */ } }
function loadSaved() {
  const saved = lsGet(KEY);
  if (saved != null) return saved;
  // a visitor who used the previous sandbox finds their card again, as the thing they last kept
  const w2 = lsGet(W2_DRAFT_KEY);
  if (w2 && readsAsCard(w2)) return w2;
  return buildSandboxCard(LOCALE);
}
function loadDraft() { return lsGet(DKEY) ?? savedMd; }
// Nothing goes live until Save; the draft lives in this browser; leaving with it unsaved asks first.
function persist() {
  if (SANDBOX) lsSet(DKEY, md === savedMd ? null : md);
  else if (!hostWaiting) lsSet(hostDraftKey(), md === savedMd ? null : JSON.stringify({ base: savedMd, md }));
  if (bridge) bridge.changed(md);
  paintMain();
}
const dirty = () => md !== savedMd;
addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });
function read(text) { const x = parseCard(text); if (!x.blocks.length) x.blocks = [{ label: '', start: 0, count: 0 }]; return x; }
function commit(next, { quiet = false } = {}) {   // next: a model → it becomes the file
  md = serializeCard(next); m = read(md);
  persist();
  draw(); if (!quiet) show();   // quiet: the screen already shows it (the wall moves the tiles itself)
}
const clone = () => structuredClone(m);

// one row of tiles: every face cell in order; a face cell whose `back=#id` names a back lane is a pair
const backId = (cell) => String((cell.params || {}).back || '').replace(/^#/, '');
const items = () => m.cells.map((cell, i) => ({ i, cell, back: (backId(cell) && m.drawers.find((d) => d.id === backId(cell))) || null }));
const withRaw = (cell, rawParams) => normalizeCell({ ...cell, rawParams });

// the face's block ranges, kept true when a cell comes or goes
function insertCell(x, at, cell) {
  x.cells.splice(at, 0, cell);
  let bi = x.blocks.findIndex((b) => at >= b.start && at <= b.start + b.count); if (bi < 0) bi = x.blocks.length - 1;
  x.blocks = x.blocks.map((b, k) => (k === bi ? { ...b, count: b.count + 1 } : (b.start >= at && k > bi ? { ...b, start: b.start + 1 } : b)));
}
function removeCell(x, at) {
  x.cells.splice(at, 1);
  const bi = x.blocks.findIndex((b) => at >= b.start && at < b.start + b.count);
  x.blocks = x.blocks.map((b, k) => (k === bi ? { ...b, count: b.count - 1 } : (b.start > at ? { ...b, start: b.start - 1 } : b)));
}
// the default back: the frontmatter's `back: "#id"` names one back lane, the same pointer a tile's `back=#id` is, at
// the scope of the whole Cards. Quoted, because a bare # starts a YAML comment. None → the printed business card.
const defId = (pre = m.pre) => String(fmRead(pre).back || '').replace(/^["']|["']$/g, '').replace(/^#/, '');
const defBack = () => { const id = defId(); return (id && m.drawers.find((d) => d.id === id)) || null; };
const freshBackId = (x) => { let n = 1; while (x.drawers.some((d) => d.id === 'b' + n)) n++; return 'b' + n; };

// ── one tile on its own: the card with only that tile on its face, rendered by the engine in the page ──
function soloMd(cells) {
  // a tile in the row is drawn full width: how wide it sits on the face is the wall's business
  const solo = (c) => withRaw(c, setToken(removeToken(c.rawParams || '', 'back'), 'w', String(m.cols || 6)));
  return serializeCard({ ...m, cells: cells.map(solo), blocks: [{ label: '', start: 0, count: cells.length }], drawers: [] });
}
const cache = new Map();
const DRESS = `<style>
  .st-footer{display:none!important}
  html,body{height:100%!important;margin:0!important;overflow:hidden!important;scrollbar-width:none!important;scrollbar-gutter:auto!important}
  ::-webkit-scrollbar{display:none!important}
  .st-wrap{min-height:100%!important;width:100%!important;max-width:none!important;display:flex!important;flex-direction:column!important;justify-content:center!important;padding:20px 0!important;box-sizing:border-box!important}
  .st-card{background:transparent!important;box-shadow:none!important;border:0!important}
</style>`;
function render(text) {
  if (!cache.has(text)) {
    let h;
    try { h = renderCardHTML(text, { deck: false }).replace('</head>', () => DRESS + '</head>'); } catch (e) { h = `<pre style="padding:16px;color:#c0392b;white-space:pre-wrap">${esc(e.message)}</pre>`; }
    cache.set(text, h);
  }
  return cache.get(text);
}
function fit(frame, box) { frame.style.transform = `scale(${box.clientWidth / 390})`; frame.style.opacity = 1; }

// ── the row ──
const row = el('row');
function cardEl(cells, label, onPen, multi) {
  const c = document.createElement('div'); c.className = 'card';
  const f = document.createElement('iframe'); f.setAttribute('tabindex', '-1'); f.title = label;
  c.appendChild(f);
  f.addEventListener('load', () => fit(f, c));
  f.srcdoc = render(soloMd(cells));
  new ResizeObserver(() => fit(f, c)).observe(c);
  if (multi) {   // a back of several tiles is the file's to edit, not the sheet's (backs are 1:1 here)
    const n = document.createElement('button'); n.className = 'note'; n.textContent = L.backInRaw;
    n.onclick = (e) => { e.stopPropagation(); openRaw(); };
    c.appendChild(n);
  } else {
    const pen = document.createElement('button'); pen.className = 'pen'; pen.innerHTML = PEN; pen.setAttribute('aria-label', L.editTile);
    pen.onclick = (e) => { e.stopPropagation(); onPen(); };
    c.appendChild(pen);
  }
  return c;
}
function chainBtn(on, onClick, label, disabled) {
  const g = document.createElement('div'); g.className = 'gapbtn';
  const b = document.createElement('button');
  b.className = 'chain' + (on ? ' on' : ''); b.innerHTML = LINK; b.title = label; b.setAttribute('aria-label', label);
  if (disabled) b.disabled = true; else b.onclick = onClick;
  g.appendChild(b); return g;
}
const spacer = () => { const g = document.createElement('div'); g.className = 'gapbtn'; return g; };
// every gap BETWEEN tiles takes a new one; the gap inside a pair has none, so a pair cannot be split by adding
function insBtn(gap, at) {
  const b = document.createElement('button'); b.className = 'ins'; b.innerHTML = PLUS;
  b.title = b.ariaLabel = fmt(L.addBetween, { a: at, b: at + 1 });
  b.onclick = () => openPicker(at);
  gap.appendChild(b); return gap;
}
const kindName = (cell) => (TYPES[cell.type] ? say(TYPES[cell.type].title) : cell.type);
const flipped = new Set();   // tiles turned over here — the author's hand: a visitor turns only what has a back
const TURN_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
// what a visitor turns over to when the tile has no back of its own (deck.js decides the same way: a
// link's address, a video's page on YouTube, everything else the owner's business card). The printed
// business card here is a likeness of the deck's; the deck draws the real one on the page.
function printedBack(i, frontFrame) {
  const box = document.createElement('div'); box.className = 'card printed';
  const d = frontFrame && frontFrame.contentDocument;
  const a = d && d.querySelector('a.st-gal-link, a.st-cell-link'), href = (a && a.getAttribute('href')) || '';
  const yt = d && d.querySelector('.st-embed-video-btn[data-yt]');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  if (yt) box.innerHTML = `<span class="pill">${esc(L.ytPill)} ↗</span><small>${esc(L.ytSays)}</small>`;
  else if (/^https?:/.test(href)) box.innerHTML = `<span class="pill">${esc(host(href))} ↗</span><small>${esc(L.linkSays)}</small>`;
  else if (defBack()) {   // the default back, as every visitor gets it; its pencil edits the one all of them share
    const c = cardEl(defBack().cells.slice(0, 1), L.bcL, () => edit(-1, 'default'));
    const w = document.createElement('button'); w.type = 'button'; w.className = 'ctw-btn dflt'; w.textContent = L.writeBack;
    w.onclick = (e) => { e.stopPropagation(); openPicker(i, { backOf: i }); };
    // it looks like any written back, but its pencil changes the one every such tile shares — so it says whose it is
    const tag = document.createElement('span'); tag.className = 'dflt-tag'; tag.textContent = L.bcL;
    c.append(tag, w); return c;
  }
  else box.innerHTML = `<div class="bc-name">${esc(ownerName())}</div><div class="bc-qr" aria-hidden="true"></div><small>${esc(L.bcCard)}</small>`;
  const w = document.createElement('button'); w.type = 'button'; w.className = 'ctw-btn'; w.textContent = L.writeBack;
  w.onclick = (e) => { e.stopPropagation(); openPicker(i, { backOf: i }); };
  box.appendChild(w);
  return box;
}
const profileAt = () => m.cells.findIndex((c) => c.type === 'profile');
// the profile's name IS the title (composeCell renames the card when the profile is renamed): one value, two doors
const ownerName = () => cardTitle(md) || L.untitled;
function draw() {
  document.title = fmt(L.docTitle, { t: cardTitle(md) || L.untitled });
  row.textContent = '';
  const list = items();
  list.forEach((it, k) => {
    const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.i = String(it.i);
    const num = document.createElement('div'); num.className = 'num'; num.textContent = String(k + 1);
    const front = cardEl([it.cell], kindName(it.cell), () => edit(it.i, 'front'));
    front.classList.add('front'); front.onclick = () => zoomPair(it);
    const foot = document.createElement('div'); foot.className = 'slot-foot';
    const turn = document.createElement('button'); turn.type = 'button'; turn.className = 'turnbtn' + (it.back ? ' has' : '');
    turn.innerHTML = TURN_ICO + esc(L.turn); turn.setAttribute('aria-pressed', String(flipped.has(it.i)));
    foot.appendChild(turn);
    slot.append(num, front, foot);
    const paint = (animate) => {
      const over = flipped.has(it.i), shown = slot.querySelector('.card');
      let next;
      if (!over) next = front;
      else if (it.back) {
        const multi = it.back.cells.length !== 1;
        next = cardEl(it.back.cells.slice(0, 1), L.back, () => edit(it.i, 'back'), multi);
        next.onclick = () => zoomPair(it);
      } else next = printedBack(it.i, front.querySelector('iframe'));
      foot.querySelectorAll('.sidebtn').forEach((b) => b.remove());
      if (over && it.back) {
        const peel = document.createElement('button'); peel.type = 'button'; peel.className = 'sidebtn'; peel.textContent = L.peel; peel.onclick = () => { flipped.delete(it.i); unlink(it.i); };
        const up = document.createElement('button'); up.type = 'button'; up.className = 'sidebtn'; up.textContent = L.sideUp; up.onclick = () => { flipped.delete(it.i); commit(swapped(it.i)); };
        foot.append(peel, up);
      }
      if (shown !== next) shown.replaceWith(next);
      if (animate) { next.classList.remove('turning'); void next.offsetWidth; next.classList.add('turning'); }
      turn.setAttribute('aria-pressed', String(over));
    };
    turn.onclick = () => { if (flipped.has(it.i)) flipped.delete(it.i); else flipped.add(it.i); paint(true); };
    if (flipped.has(it.i)) front.querySelector('iframe').addEventListener('load', () => paint(false), { once: true });
    row.appendChild(slot);
    const next = list[k + 1];
    const g = next && !it.back && !next.back ? chainBtn(false, () => link(it.i), L.pair) : spacer();
    row.appendChild(next ? insBtn(g, it.i + 1) : g);
  });
  const slot = document.createElement('div'); slot.className = 'slot';
  const num = document.createElement('div'); num.className = 'num';
  const nb = document.createElement('button'); nb.className = 'new'; nb.innerHTML = PLUS; nb.setAttribute('aria-label', L.addTile);
  nb.onclick = () => openPicker();
  slot.append(num, nb);
  row.appendChild(slot);
  edges();
  if (!list.length) { const h = document.createElement('p'); h.className = 'empty-hint'; h.textContent = L.firstTile; slot.appendChild(h); }
  paintViews();
}

// ── chain, unchain, swap: card-core's own param primitives on the back token ──
function link(i) {
  const x = clone(), id = freshBackId(x), backCell = withRaw(x.cells[i + 1], removeToken(x.cells[i + 1].rawParams || '', 'back'));
  x.cells[i] = withRaw(x.cells[i], setToken(x.cells[i].rawParams || '', 'back', '#' + id));
  removeCell(x, i + 1);
  x.drawers.push({ id, title: '', cells: [backCell] });
  commit(x);
}
function unlink(i) {
  const x = clone(), id = backId(x.cells[i]), d = x.drawers.find((y) => y.id === id);
  x.cells[i] = withRaw(x.cells[i], removeToken(x.cells[i].rawParams || '', 'back'));
  x.drawers = x.drawers.filter((y) => y !== d);
  insertCell(x, i + 1, d.cells[0]);
  commit(x);
}
function swapped(i) {
  const x = clone(), id = backId(x.cells[i]), d = x.drawers.find((y) => y.id === id);
  const front = x.cells[i], back = d.cells[0];
  x.cells[i] = withRaw(back, setToken(back.rawParams || '', 'back', '#' + id));
  d.cells = [withRaw(front, removeToken(front.rawParams || '', 'back'))];
  return x;
}

// ── "+" ──
function openPicker(at = m.cells.length, opt = {}) {
  const kinds = PALETTE.map((t) => `<button class="ctw-pick-btn" type="button" data-type="${esc(t)}" title="${esc(say(TYPES[t].hint))}">`
    + `<span class="ctw-pick-ico">${typeIconSvg(t)}</span><span class="ctw-pick-name">${esc(say(TYPES[t].title))}</span>`
    + `<span class="ctw-pick-hint">${esc(say(TYPES[t].hint))}</span></button>`).join('');
  const raw = `<button class="ctw-pick-btn" type="button" data-type=""><span class="ctw-pick-ico">${MDICO}</span><span class="ctw-pick-name">${esc(L.free)}</span><span class="ctw-pick-hint">${esc(L.freeHint)}</span></button>`;
  el('picker-row').innerHTML = kinds + raw;
  for (const b of el('picker-row').querySelectorAll('.ctw-pick-btn')) b.onclick = () => { el('picker').hidden = true; if (opt.asDefault) addDefault(b.dataset.type); else if (opt.backOf != null) addBack(b.dataset.type, opt.backOf); else add(b.dataset.type, at); };
  el('picker').hidden = false;
}

// a new tile is added for real and the sheet opens on it; closing that sheet without Done takes it back out
let undoTo = null;
const blank = (type) => normalizeCell({ ...blankCell(type || 'text', TX), params: {}, ...(type ? {} : { body: '' }) });
function add(type, at = m.cells.length) {
  const before = md, x = clone(), last = at >= x.cells.length;
  // Raw content is a text tile opened on its text: the kind is the file's business, not the person's
  insertCell(x, at, blank(type));
  commit(x);
  undoTo = before;
  edit(at, 'front', !type);
  const s = row.querySelectorAll('.slot')[at];
  requestAnimationFrame(() => (last ? row.scrollTo({ left: row.scrollWidth, behavior: 'smooth' }) : s && s.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })));
}

// one back per tile (a card has one other side), and it starts the same way a tile does
function addBack(type, i) {
  const before = md, x = clone(), id = freshBackId(x);
  x.cells[i] = withRaw(x.cells[i], setToken(x.cells[i].rawParams || '', 'back', '#' + id));
  x.drawers.push({ id, title: '', cells: [blank(type)] });
  flipped.add(i);
  commit(x);
  undoTo = before;
  edit(i, 'back', !type);
}

function addDefault(type) {
  const before = md, x = clone(), id = x.drawers.some((d) => d.id === 'default') ? freshBackId(x) : 'default';
  x.drawers.push({ id, title: '', cells: [blank(type)] });
  x.pre = fmWrite(x.pre, 'back', `"#${id}"`);
  commit(x);
  undoTo = before;
  edit(-1, 'default', !type);
}
function dropDefault(x) { const id = defId(x.pre); x.drawers = x.drawers.filter((d) => d.id !== id); x.pre = fmWrite(x.pre, 'back', null); return x; }

// ── the pencil: cell-form-core's sheet for the tile's kind, or the tile's own line as Markdown ──
let open = null;   // { i, which, asMd } | { card: true } | { whole: true }
const cellAt = (i, which) => (which === 'default' ? defBack().cells[0] : which === 'back' ? m.drawers.find((d) => d.id === backId(m.cells[i])).cells[0] : m.cells[i]);
function previewSrc(value) {
  const a0 = /^asset:(.+)$/.exec(String(value || '').trim());
  if (!a0) return String(value || '');
  const a = pending[a0[1]] || (m.assets || {})[a0[1]];
  return a ? `data:${a.mime};base64,${a.b64}` : '';
}
const formCtx = () => ({ T, say, targetOptions: () => null, previewSrc, cardTitle: cardTitle(md) });
function edit(i, which, asMd = false) {
  open = { i, which, asMd }; pending = {}; prose = null;
  const cell = cellAt(i, which), def = TYPES[cell.type];
  const paired = !!(items()[i] && items()[i].back);
  const body = el('modal-body');
  if (asMd || !def) {
    el('modal-title').textContent = L.free;
    el('modal-hint').textContent = L.freeModal;
    body.innerHTML = `<div class="ctw-field" data-field="__raw"><textarea id="f-__raw" class="ctw-md" spellcheck="false" style="min-height:180px;font:13px/1.45 ui-monospace,Menlo,monospace"></textarea><p class="ctw-err" id="e-__raw"></p></div>`;
    el('f-__raw').value = cell.body || '';
  } else {
    el('modal-title').textContent = say(def.title);
    el('modal-hint').textContent = say(def.hint || '');
    // only where the text IS the tile and the form does not already show it as it is
    const mdOk = def.body && cell.type !== 'text';
    body.innerHTML = (mdOk ? `<button class="ctw-btn mdsw" type="button" id="to-md">${esc(L.toFree)}</button>` : '') + formBodyHtml(def, cell, formCtx());
    wireForm(body, def, { T, previewSrc, stage: (id, a) => { pending[id] = a; } });
    if (mdOk) el('to-md').onclick = () => edit(i, which, true);
    if (cell.type === 'text') proseEditor(document.getElementById('f-__body'));
  }
  if (paired) {   // switching sides keeps what was typed: it is Done on this side, then the other side opens
    const seg = document.createElement('div'); seg.className = 'open-seg side-seg';
    seg.innerHTML = ['front', 'back'].map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === which}">${esc(s === 'front' ? L.front : L.back)}</button>`).join('');
    seg.onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === which || el('modal-save').disabled) return; saveSheet(); if (el('modal').hidden) edit(i, b.dataset.s); };
    body.prepend(seg);
  }
  el('modal').hidden = false;
  // a field the tile cannot go without: Done waits for it instead of refusing afterwards, and the
  // sheet opens on it when it is still empty
  const need = asMd || !def ? [] : requiredNames(def);
  const empty = () => need.map((n) => document.getElementById(`f-${n}`)).filter((f) => f && f.closest('[data-field]') && !f.closest('[data-field]').hidden && !f.value.trim());
  const gate = () => { el('modal-save').disabled = empty().length > 0; };
  body.oninput = body.onchange = gate; gate();
  const first = empty()[0] || body.querySelector('.prose-ed [contenteditable]') || body.querySelector('input,textarea,select'); if (first) first.focus();
}
// A text tile's words are written with the family editor, holding only the tools whose marks a card
// actually draws (card-render.mjs mdInline/mdBlock: bold, italic, # to ###, `- ` lists, links, ---).
// Off: everything the card would print as literal symbols. On: the divider (`---`), and links
// written as [text](url) — the card has no vault to resolve Obsidian's [[ ]] against.
// The textarea stays the field the form reads; the editor only writes into it.
const CARD_TOOLS_OFF = ['strike', 'clear', 'number', 'check', 'quote', 'table', 'code', 'image', 'video', 'date', 'time'];
// 🩸 The editor reports a change once typing has been idle for a moment (editor-core's scheduleSync),
// so Done pressed right after the last keystroke read a textarea one sync behind and the last words
// were lost. Done reads the editor itself (syncProse) before it reads the form.
let prose = null;   // { ctl, ta } of the sheet's open text editor
const syncProse = () => { if (prose && prose.ta.isConnected) prose.ta.value = prose.ctl.rawValue(); };
function proseEditor(ta) {
  if (!ta) return;
  const host = makeWebHost({ linkSyntax: 'markdown' });
  for (const k of CARD_TOOLS_OFF) host.plugin.settings.editorTools[k] = false;
  host.plugin.settings.editorTools.rule = true;
  const box = document.createElement('div'); box.className = 'prose-ed';
  ta.hidden = true; ta.after(box);
  const ctl = mountEditor(box, { text: ta.value, onChange: () => { ta.value = ctl.rawValue(); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, host);
  prose = { ctl, ta };
  const ed = box.querySelector('[contenteditable]'); if (ed) ed.setAttribute('aria-label', ta.closest('[data-field]')?.querySelector('label')?.textContent || L.text);
}
function requiredNames(def) {
  const out = [], walk = (rows) => rows.forEach((r) => (r.group ? walk(r.rows) : r.required && out.push(r.name)));
  walk(def.form || def.fields || []); return out;
}
function closeSheet(kept) {
  el('modal').hidden = true; open = null; pending = {}; prose = null;
  if (!kept && undoTo != null) { const back = undoTo; undoTo = null; md = back; m = read(md); persist(); draw(); }
  undoTo = null;
}
function saveSheet() {
  if (!open) return;
  const { i, which, asMd } = open, cell = cellAt(i, which);
  syncProse();
  for (const n of el('modal-body').querySelectorAll('.ctw-err')) n.textContent = '';
  let next, rename = null;
  if (asMd || !TYPES[cell.type]) {
    next = normalizeCell({ ...cell, body: el('f-__raw').value.replace(/\s+$/, '') });
  } else {
    const readField = (name) => { const n = document.getElementById(`f-${name}`); if (!n) return null; if (n.type === 'checkbox') return n.checked ? 'on' : ''; return name === '__body' ? n.value : n.value.trim(); };
    const visible = (name) => { const b = el('modal-body').querySelector(`[data-field="${name}"]`); return !!b && !b.hidden; };
    const out = composeCell(cell, TYPES[cell.type], { read: readField, visible }, formCtx());
    if (out.error) { const e = document.getElementById(`e-${out.error.field}`); if (e) e.textContent = out.error.message; return; }
    next = normalizeCell({ ...cell, rawParams: out.rawParams, body: out.body });
    rename = out.rename;
  }
  let x = clone();
  if (rename) x = setTitle(x, rename);
  if (Object.keys(pending).length) x.assets = { ...(x.assets || {}), ...pending };
  if (which === 'default') x.drawers.find((d) => d.id === defId(x.pre)).cells = [withRaw(next, removeToken(next.rawParams || '', 'back'))];
  else if (which === 'back') x.drawers.find((d) => d.id === backId(x.cells[i])).cells = [withRaw(next, removeToken(next.rawParams || '', 'back'))];
  else { const id = backId(x.cells[i]); x.cells[i] = id ? withRaw(next, setToken(next.rawParams || '', 'back', '#' + id)) : next; }
  undoTo = null;
  closeSheet(true);
  commit(x);
}
function deleteSheet() {
  if (!open) return;
  const { i, which } = open;
  const was = md, fresh = undoTo != null;
  const x = clone(), id = which === 'default' ? '' : backId(x.cells[i]), d = id && x.drawers.find((y) => y.id === id);
  if (which === 'default') dropDefault(x);   // the printed business card comes back
  else if (which === 'back') { x.cells[i] = withRaw(x.cells[i], removeToken(x.cells[i].rawParams || '', 'back')); x.drawers = x.drawers.filter((y) => y !== d); }
  else if (d && d.cells.length === 1) { x.cells[i] = withRaw(d.cells[0], removeToken(d.cells[0].rawParams || '', 'back')); x.drawers = x.drawers.filter((y) => y !== d); }
  else removeCell(x, i);
  undoTo = null;
  closeSheet(true);
  commit(x);
  // 🔴 no "are you sure?" first: the question blocks every time to save the rare mistake. Gone at once,
  // and back with one tap. (A tile that was never kept is just the add taken back — nothing to offer.)
  // Undo puts the file back and repaints whatever screen you are on — the row alone was not enough on the wall
  if (!fresh) toast(L.deleted, () => { md = was; m = read(md); persist(); draw(); show(); });
}
let toastTimer = 0;
function toast(textValue, undo) {
  el('toast-text').textContent = textValue; el('toast').hidden = false;
  el('toast-undo').hidden = !undo; el('toast-undo').onclick = () => { el('toast').hidden = true; undo && undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el('toast').hidden = true; }, 6000);
}
// ── Cards options: what belongs to the whole card, not to one tile ──
// the frontmatter keys the renderer (backdrop, backdrop-dim, accent, theme, header, icons) and the deck (views, view, back) read
const VIEW_IDS = ['stack', 'list', 'wall'], VIEW_NAMES = L.views;
const P = (label, control, extra = {}) => ({ disposition: DISPOSITION.FORM, label, control, ...extra });
const CARD_DEF = {
  title: L.options, hint: L.setHint, body: null,
  params: {
    backdrop: P(L.backdrop, CONTROL.ASSET, { hint: L.backdropHint }),
    'backdrop-dim': P(L.dim, CONTROL.SELECT, { options: ['0', '25', '45', '65'], optionLabels: L.dimNames, hint: L.dimHint }),
  },
};
CARD_DEF.fields = Object.entries(CARD_DEF.params).map(([name, p]) => ({ name, ...p }));
function fmRead(pre) {
  const o = {}, f = /^---\n([\s\S]*?)\n---/.exec(pre || '');
  if (f) for (const l of f[1].split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) o[k[1]] = k[2].trim(); }
  return o;
}
// one `key: value` line inside the frontmatter fence; null removes it
function fmWrite(pre, key, value) {
  const f = /^---\n([\s\S]*?)\n---/.exec(pre || '');
  const lines = f ? f[1].split('\n') : [];
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (value == null || value === '') { if (at >= 0) lines.splice(at, 1); }
  else if (at >= 0) lines[at] = `${key}: ${value}`; else lines.push(`${key}: ${value}`);
  const fence = `---\n${lines.join('\n')}\n---`;
  return f ? pre.replace(f[0], () => fence) : `${fence}\n${pre || ''}`;
}
function openCard() {
  open = { card: true }; pending = {};
  const fm = fmRead(m.pre), views = String(fm.views || VIEW_IDS.join(' ')).split(/[\s,]+/);
  const params = { backdrop: fm.backdrop || '', 'backdrop-dim': fm['backdrop-dim'] || '' };
  el('modal-title').textContent = CARD_DEF.title;
  el('modal-hint').textContent = CARD_DEF.hint;
  const body = el('modal-body');
  body.oninput = body.onchange = null; el('modal-save').disabled = false;
  // the empty choice of the backdrop dim is the renderer's own dim, so it says Auto rather than (default)
  body.innerHTML = formBodyHtml(CARD_DEF, { type: 'card', params, rawParams: '', body: '' }, { ...formCtx(), T: { ...T, selectDefaultOption: L.auto } });
  // six groups, each under its own small heading, with air between them
  const look = [...body.childNodes]; body.textContent = '';
  const sec = (title) => { const x = document.createElement('section'); x.className = 'optsec'; x.innerHTML = `<h3>${esc(title)}</h3>`; body.appendChild(x); return x; };
  const optRow = (into, html, cls = '') => { const r = document.createElement('div'); r.className = 'optrow' + (cls ? ' ' + cls : ''); r.innerHTML = html; into.appendChild(r); return r; };
  // 1 · name and address
  const s1 = sec(L.secName), pi = profileAt();
  optRow(s1, `<span>${esc(L.titleL)}</span><input id="opt-title" type="text" autocomplete="off" value="${esc(fm.title || '')}" placeholder="${esc(L.untitled)}">`
    + (pi >= 0 ? `<p>${esc(L.titleFromProfile)}</p>` : ''));
  handleRow(optRow(s1, ''));
  // 🔴 the address, the domain, the pool and the transfer belong to the PLATFORM, not the file. In host
  // mode they are a real Card's, and this editor cannot change them yet: shown read-only, or not at all.
  if (SANDBOX) optRow(s1, `<span>${esc(L.domainL)}</span><p>${esc(L.domainSays)}</p><button type="button" class="ctw-btn" disabled title="${esc(L.notYet)}">${esc(L.connect)}</button>`);
  // 2 · look: the backdrop form, then the arrangements the engine already reads (header: left, icons: mono)
  const s2 = sec(L.secLook); s2.append(...look);
  segRow(s2, 'opt-header', L.headerL, L.headerNames, fm.header === 'left' ? 'left' : 'centre');
  segRow(s2, 'opt-icons', L.iconsL, L.iconsNames, fm.icons === 'mono' ? 'mono' : 'colour');
  { const a = String(fm.accent || '').replace(/^["']|["']$/g, ''), ok = /^#[0-9a-f]{6}$/i.test(a);
    const r = optRow(s2, `<span>${esc(L.accentL)}</span><div class="seg-line"><input type="color" id="opt-accent" value="${ok ? a : '#14a3b3'}"${ok ? '' : ' data-unset'}><button type="button" class="ctw-btn" id="opt-accent-0">${esc(L.accentReset)}</button></div><p>${esc(L.accentSays)}</p>`);
    const inp = r.querySelector('#opt-accent'), b0 = r.querySelector('#opt-accent-0');
    const paintA = () => { b0.disabled = inp.hasAttribute('data-unset'); }; paintA();
    inp.addEventListener('input', () => { inp.removeAttribute('data-unset'); paintA(); });
    b0.onclick = () => { inp.setAttribute('data-unset', ''); paintA(); }; }
  segRow(s2, 'opt-theme', L.themeL, L.themeNames, ['light', 'dark'].includes(fm.theme) ? fm.theme : 'auto');
  // 3 · views
  sec(L.secViews).appendChild(viewsControl(views.filter((v) => VIEW_IDS.includes(v)), fm.view));
  // 4 · back — drawn, not described: the default back is a card, so it shows as one. Out of the box it is the printed
  // business card (its name is the title above, so typing there re-prints it); Replace puts any one tile there instead.
  const dfl = defBack();
  const bc = optRow(sec(L.secBack), `<span>${esc(L.bcL)}</span>` + (dfl ? '' : `<div class="card printed bc-mini" aria-hidden="true"><div class="bc-name"></div><div class="bc-qr"></div></div>`)
    + `<p>${esc(dfl ? L.dfSays : L.bcSays)}</p><button type="button" class="ctw-btn" id="opt-df">${esc(dfl ? L.toBc : L.replaceBack)}</button>`);
  if (dfl) { const c = cardEl(dfl.cells.slice(0, 1), L.bcL, () => { saveCard(); edit(-1, 'default'); }); c.classList.add('bc-mini'); bc.querySelector('span').after(c); }
  if (!dfl) { const reprint = () => { bc.querySelector('.bc-name').textContent = el('opt-title').value.trim() || L.untitled; }; reprint(); el('opt-title').addEventListener('input', reprint); }
  el('opt-df').onclick = () => { saveCard(); if (dfl) { const was = md; commit(dropDefault(clone())); toast(L.toBcDone, () => { md = was; m = read(md); persist(); draw(); show(); }); } else openPicker(0, { asDefault: true }); };
  // 5 · being found — one switch: in the pool (drawn at reef.cards, on the home page) ⇔ the reef.cards card and footer
  // link. The platform's switch (reef#2913), never the file's: kept in this browser in the sandbox, and
  // not offered in host mode until the platform side exists.
  if (SANDBOX) {
    const pool = segRow(sec(L.secFound), 'opt-pool', L.poolL, L.poolNames, poolOn() ? 'on' : 'off');
    const poolSays = document.createElement('p'); pool.appendChild(poolSays);
    const sayPool = () => { poolSays.textContent = segVal('opt-pool') === 'off' ? L.poolOff : L.poolOn; }; sayPool();
    pool.addEventListener('click', sayPool);
  }
  // 6 · more — the file itself, a backup, and (sandbox only, set apart, last) giving it away
  const s6 = sec(L.secMore);
  optRow(s6, `<span>${esc(L.raw)}</span><p>${esc(L.rawSays)}</p><button type="button" class="ctw-btn" id="opt-raw">${esc(L.openRaw)}</button>`);
  optRow(s6, `<span>${esc(L.backupL)}</span><p>${esc(L.backupSays)}</p><div class="bk-acts"><button type="button" class="ctw-btn" id="opt-dl">${esc(L.download)}</button><button type="button" class="ctw-btn" id="opt-up">${esc(L.replaceFile)}</button><input type="file" id="opt-file" accept=".md,text/markdown,text/plain" hidden></div><p class="err" id="opt-bkerr" hidden></p>`);
  el('opt-dl').onclick = () => { const u = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); const x = document.createElement('a'); x.href = u; x.download = `${getHandle()}.md`; x.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  el('opt-up').onclick = () => el('opt-file').click();
  // a file replaces the DRAFT, never what is saved: it still needs Save, like any other change
  el('opt-file').onchange = async () => {
    const f = el('opt-file').files[0]; if (!f) return; let t = await f.text(); el('opt-file').value = '';
    const wrong = whatIsWrong(t);
    if (wrong) { el('opt-bkerr').hidden = false; el('opt-bkerr').textContent = fmt(L.badFile, { n: wrong.line }); return; }
    if (!t.endsWith('\n')) t += '\n';
    const was = md, before = m.cells.length;
    closeSheet(true); el('modal-delete').hidden = false;
    md = t; m = read(md); persist(); cache.clear(); flipped.clear(); draw(); show();
    toast(fmt(L.replaced, { a: before, b: m.cells.length }), () => { md = was; m = read(md); persist(); cache.clear(); draw(); show(); });
  };
  if (SANDBOX) optRow(s6, `<span>${esc(L.transferL)}</span><p>${esc(L.transferSays)}</p><button type="button" class="ctw-btn" disabled title="${esc(L.notYet)}">${esc(L.transferL)}</button>`, 'optlast');
  el('opt-raw').onclick = () => { saveCard(); openRaw(); };
  wireForm(body, CARD_DEF, { T, previewSrc, stage: (id, a) => { pending[id] = a; } });
  el('modal-delete').hidden = true;
  el('modal').hidden = false;
}
// 🔴 THE WRONG ANSWER IS NOT ON OFFER. Three tiles say which views a visitor gets; the row under them
// says which one opens, and holds only the views that are on. Turning off the one that opens moves the
// opening to the first one left; the last one on cannot be turned off. Nothing to check on Done.
const VIEW_SAYS = L.viewSays;
let viewState = null;
function viewsControl(on, first) {
  viewState = { on: new Set(on.length ? on : VIEW_IDS), open: null };
  viewState.open = viewState.on.has(first) ? first : VIEW_IDS.find((v) => viewState.on.has(v));
  const box = document.createElement('div'); box.className = 'ctw-field views';
  box.innerHTML = `<span>${esc(L.viewsLabel)}</span><div class="vw-row">`
    + VIEW_IDS.map((v) => `<button type="button" class="vw" data-v="${v}"><span class="tick">${TICK}</span><b>${esc(VIEW_NAMES[v])}</b><small>${esc(VIEW_SAYS[v])}</small></button>`).join('')
    + `</div><div class="open-row"><span>${esc(L.opensAs)}</span><div class="open-seg">`
    + VIEW_IDS.map((v) => `<button type="button" data-v="${v}">${esc(VIEW_NAMES[v])}</button>`).join('') + '</div></div>';
  const paint = () => {
    for (const b of box.querySelectorAll('.vw')) {
      const isOn = viewState.on.has(b.dataset.v);
      b.setAttribute('aria-pressed', String(isOn));
      b.disabled = isOn && viewState.on.size === 1;   // the last one stays
    }
    for (const b of box.querySelectorAll('.open-seg button')) { b.hidden = !viewState.on.has(b.dataset.v); b.setAttribute('aria-pressed', String(b.dataset.v === viewState.open)); }
    box.querySelector('.open-row').hidden = viewState.on.size < 2;   // one view: nothing to choose
  };
  for (const b of box.querySelectorAll('.vw')) b.onclick = () => {
    const v = b.dataset.v;
    if (viewState.on.has(v)) { if (viewState.on.size === 1) return; viewState.on.delete(v); } else viewState.on.add(v);
    if (!viewState.on.has(viewState.open)) viewState.open = VIEW_IDS.find((x) => viewState.on.has(x));
    paint();
  };
  for (const b of box.querySelectorAll('.open-seg button')) b.onclick = () => { viewState.open = b.dataset.v; paint(); };
  paint();
  return box;
}
// a two- or three-way choice in Cards options, drawn like "Opens as"
function segRow(into, id, label, names, value) {
  const r = document.createElement('div'); r.className = 'optrow';
  r.innerHTML = `<span>${esc(label)}</span><div class="seg-line"><div class="open-seg" id="${id}">`
    + Object.entries(names).map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${k === value}">${esc(n)}</button>`).join('') + '</div></div>';
  for (const b of r.querySelectorAll('button')) b.onclick = () => { for (const x of r.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b)); };
  into.appendChild(r); return r;
}
// the sandbox's stand-in for the platform's pool switch: this browser only, never the file
const PKEY = 'cardtile:w3:pool', poolOn = () => lsGet(PKEY) !== 'off';
const segVal = (id) => { const b = el(id) && el(id).querySelector('[aria-pressed=true]'); return b ? b.dataset.v : null; };
// The handle is the platform's (create_card reserves it; nothing in the file). In host mode it is the real Card's
// and is shown as it is. The sandbox keeps a stand-in in this browser so the change can be felt: the old address is
// let go at once, so the gate is the warning, and the owner types the OLD address to let it go.
const HANDLE_KEY = 'cardtile:w3:handle', HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]{0,38}$/;
// a sample of the platform's reserved names, so the sandbox's stand-in can say no the way the real one does
const RESERVED = new Set('cards card reef feelreef cver try edit draw pool random www api mcp admin support help login signup dashboard about terms privacy official security billing account settings static assets'.split(' '));
const getHandle = () => (SANDBOX ? lsGet(HANDLE_KEY) || 'yourname' : handle || 'card');
function handleRow(r) {
  if (!SANDBOX) {   // a real Card's address: read-only here
    r.innerHTML = `<span>${esc(L.handleL)}</span><div class="seg-line"><span class="addr"><small>reef.cards/</small>${esc(getHandle())}</span></div><p>${esc(L.handleSays)} ${esc(L.handleHere)}</p>`;
    return;
  }
  const paint = () => {
    const h = getHandle();
    r.innerHTML = `<span>${esc(L.handleL)}</span><div class="seg-line"><span class="addr"><small>reef.cards/</small>${esc(h)}</span><button type="button" class="ctw-btn" id="opt-hchange">${esc(L.change)}</button></div><p>${esc(L.handleSays)}</p>`;
    el('opt-hchange').onclick = () => {
      r.innerHTML = `<span>${esc(L.handleL)}</span><div class="hd-change"><label>${esc(L.newHandle)}<input id="opt-hnew" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" value="${esc(h)}"></label>`
        + `<p class="err" id="opt-herr" hidden></p><p class="warn">${esc(fmt(L.handleWarn, { o: h }))}</p>`
        + `<label>${esc(fmt(L.typeOld, { o: h }))}<input id="opt-hold" type="text" autocomplete="off" spellcheck="false" autocapitalize="off"></label>`
        + `<div class="acts"><button type="button" class="ctw-btn" id="opt-hgo" disabled>${esc(L.doChange)}</button><button type="button" class="ctw-btn" id="opt-hno">${esc(L.cancel)}</button></div></div>`;
      const check = () => {
        const v = el('opt-hnew').value.trim().toLowerCase();
        const why = v === h ? L.hSame : !HANDLE_SHAPE.test(v) ? L.hShape : RESERVED.has(v.replace(/-/g, '')) ? L.hReserved : '';
        el('opt-herr').hidden = !why || !v; el('opt-herr').textContent = why;
        el('opt-hgo').disabled = !!why || el('opt-hold').value.trim() !== h;
      };
      el('opt-hnew').oninput = el('opt-hold').oninput = check; check();
      el('opt-hno').onclick = paint;
      el('opt-hgo').onclick = () => { const v = el('opt-hnew').value.trim().toLowerCase(); lsSet(HANDLE_KEY, v); paint(); toast(fmt(L.handleDone, { h: v }), () => { lsSet(HANDLE_KEY, h); if (el('opt-hchange')) paint(); }); };
      el('opt-hnew').focus(); el('opt-hnew').select();
    };
  };
  paint();
}
function saveCard() {
  const on = VIEW_IDS.filter((v) => viewState.on.has(v));
  const opens = viewState.open === on[0] ? '' : viewState.open;   // the first one on opens anyway: say nothing
  const x = clone();
  let pre = x.pre;
  pre = fmWrite(pre, 'backdrop', el('f-backdrop').value.trim() || null);
  pre = fmWrite(pre, 'backdrop-dim', el('f-backdrop-dim').value || null);
  pre = fmWrite(pre, 'views', on.length === VIEW_IDS.length ? null : on.join(' '));
  pre = fmWrite(pre, 'view', opens || null);
  if (el('opt-title')) pre = fmWrite(pre, 'title', el('opt-title').value.trim() || null);
  if (el('opt-header')) pre = fmWrite(pre, 'header', segVal('opt-header') === 'left' ? 'left' : null);
  if (el('opt-icons')) pre = fmWrite(pre, 'icons', segVal('opt-icons') === 'mono' ? 'mono' : null);
  if (el('opt-pool')) lsSet(PKEY, segVal('opt-pool') === 'off' ? 'off' : null);   // platform side, never the file
  if (el('opt-accent')) pre = fmWrite(pre, 'accent', el('opt-accent').hasAttribute('data-unset') ? null : el('opt-accent').value);
  if (el('opt-theme')) pre = fmWrite(pre, 'theme', segVal('opt-theme') === 'auto' ? null : segVal('opt-theme'));
  x.pre = pre;
  if (Object.keys(pending).length) x.assets = { ...(x.assets || {}), ...pending };
  closeSheet(true); el('modal-delete').hidden = false;
  cache.clear(); commit(x);
}
el('cardset').onclick = openCard;
el('modal-save').onclick = () => (open && open.whole ? saveRaw() : open && open.card ? saveCard() : saveSheet());
el('modal-delete').onclick = deleteSheet;

// ── a tile up close ──
const zoom = el('zoom');
// a link or a video turns over to its address, not to the default back (deck.js decides the same way)
const isAddress = (cell) => cell.type === 'link' || cell.type === 'video' || (cell.type === 'feature' && /^https?:/.test(String((cell.params || {}).href || '')));
function zoomPair(it) {
  const backCells = it.back ? it.back.cells : defBack() && !isAddress(it.cell) ? defBack().cells : null;   // what this tile turns over to
  zoom.innerHTML = `<div class="flip"><div class="face front"><iframe></iframe></div>${backCells ? '<div class="face back"><iframe></iframe></div>' : ''}</div>`;
  const flip = zoom.querySelector('.flip'), fr = zoom.querySelectorAll('iframe');
  zoom.hidden = false;
  fr.forEach((f) => f.addEventListener('load', () => fit(f, flip)));
  fr[0].srcdoc = render(soloMd([it.cell]));
  if (backCells) fr[1].srcdoc = render(soloMd(backCells));
  // up close the tile itself turns over, as it does in a visitor's hand: no separate button (the row has Turn over)
  flip.onclick = (e) => { e.stopPropagation(); if (backCells) flip.classList.toggle('over'); };
  flip.style.cursor = backCells ? 'pointer' : 'default';
}

// ── one way out of every layer: the frosted button at the top left (and Escape, and the backdrop) ──
const LAYERS = ['zoom', 'modal', 'picker', 'doormodal'];
function dismiss() {
  if (!zoom.hidden) zoom.hidden = true;
  else if (!el('modal').hidden) { el('modal-delete').hidden = false; closeSheet(false); }
  else if (!el('picker').hidden) el('picker').hidden = true;
  else if (!el('doormodal').hidden) el('doormodal').hidden = true;
}
el('close').onclick = dismiss;
addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
zoom.onclick = (e) => { if (e.target === zoom) dismiss(); };
for (const id of ['modal', 'picker', 'doormodal']) el(id).addEventListener('click', (e) => { if (e.target === el(id)) dismiss(); });
// watch the layers only (the button's own `hidden` is a mutation too — watching the body loops forever)
const closeObs = new MutationObserver(() => { const none = LAYERS.every((id) => el(id).hidden); if (el('close').hidden !== none) el('close').hidden = none; });
for (const id of LAYERS) closeObs.observe(el(id), { attributes: true, attributeFilter: ['hidden'] });

// ── the row: a mouse wheel scrolls it sideways; a trackpad's own sideways swipe is left alone ──
function edges() {
  const max = row.scrollWidth - row.clientWidth;
  row.classList.toggle('more-l', row.scrollLeft > 2);
  row.classList.toggle('more-r', row.scrollLeft < max - 2);
}
row.addEventListener('scroll', edges, { passive: true });
addEventListener('resize', edges);
let wheelTo = null;
row.addEventListener('wheel', (e) => {
  if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;   // a pinch, or already sideways
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0) return;
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * row.clientWidth : e.deltaY;
  // a mouse notch arrives as one big step: glide it. A trackpad sends many small ones: follow them.
  if (Math.abs(dy) >= 50) {
    wheelTo = Math.max(0, Math.min(max, (wheelTo ?? row.scrollLeft) + dy * 1.6));
    row.scrollTo({ left: wheelTo, behavior: 'smooth' });
    clearTimeout(row._wt); row._wt = setTimeout(() => { wheelTo = null; }, 300);
  } else { wheelTo = null; row.scrollLeft += dy; }
}, { passive: false });

// ── the wall: the face exactly as a visitor gets it. Grab a tile to move it; pull the picked tile's right
// edge to say how many columns it takes; the handle you pull says the width (½, ⅓ …) and, focused, takes
// ← → too. Everything lands at once, there is nothing to confirm, and nothing is redrawn: what moved on
// screen is already the truth. Width is the ONLY size: height follows content (ai-ops.mjs, `h` is retired), so
// no handle ever offers a vertical or corner pull. A tile the renderer lays full width whatever it says
// (text runs edge to edge) has no width to set: it moves, but it has no edge to pull.
let picked = null;
const faceCells = (d) => [...d.querySelectorAll('[data-cell]')].filter((c) => !c.closest('[data-drawer-panel]') && !(c.parentElement && c.parentElement.closest('[data-cell]')));
const sizable = (c) => !c.closest('.st-bleed') && !!m.cells[+c.dataset.cell];
// a width as the fraction of the row it takes, in Unicode's ready-made fraction glyphs (½ ⅓ ⅔ ⅙ ⅚ …)
const FRACTIONS = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘', '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' };
const widthSays = (w, cols) => {
  if (w >= cols) return L.full;
  const g = (a, b) => (b ? g(b, a % b) : a), d = g(w, cols), f = `${w / d}/${cols / d}`;
  return FRACTIONS[f] || f.replace('/', '⁄');
};
function paintLayout() {
  const f = el('gridframe'), ac = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a8c8e';
  const css = `<style>html{scrollbar-width:none}::-webkit-scrollbar{display:none}.st-footer{display:none}
    .lay-mv{cursor:grab;touch-action:pan-y}html.lay-dragging,html.lay-dragging *{cursor:grabbing!important}
    .lay-ok{outline:2px dashed color-mix(in srgb,${ac} 50%,transparent);outline-offset:3px;transition:outline-color .12s}
    .lay-ok:hover{outline-color:${ac}}.lay-mv.lay-on{outline:3px solid ${ac};outline-offset:3px}
    .lay-p{display:none;position:absolute;z-index:2147483000;transform:translate(-50%,-50%);width:32px;height:32px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:999px;background:#fff;border:2px solid ${ac};color:${ac};cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.15)}.lay-p svg{width:15px;height:15px}.lay-p.lay-show{display:flex}.lay-p::after{content:"";position:absolute;inset:-8px}
    .lay-ghost{opacity:.35}.lay-chosen{box-shadow:0 18px 40px rgba(0,0,0,.18)}
    .lay-h{display:none;position:absolute;transform:translate(-50%,-50%);min-width:30px;height:30px;padding:0 8px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:999px;background:#fff;border:2px solid ${ac};color:${ac};font:700 15px/1 system-ui,-apple-system,sans-serif;white-space:nowrap;cursor:ew-resize;z-index:2147483000;touch-action:none;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    .lay-h::after{content:"";position:absolute;inset:-10px -12px}html .lay-h:focus{outline:none;border-radius:999px}html .lay-h:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,${ac} 35%,transparent)}
    .lay-h.lay-show{display:flex}html.lay-sizing .lay-h{background:${ac};color:#fff}html.lay-sizing,html.lay-sizing *{cursor:ew-resize!important;user-select:none}</style>
    <script src="${esc(ASSET['Sortable.min.js'] || '')}"><\/script>`;
  f.onload = () => {
    const w = f.contentWindow, d = f.contentDocument; if (!d) return;
    for (const c of faceCells(d)) {
      c.classList.add('lay-mv');
      c.classList.toggle('lay-on', +c.dataset.cell === picked);
      if (sizable(c)) c.classList.add('lay-ok');
    }
    // ONE handle, sitting on the picked tile's right edge (outside the tile, so a narrow tile's words stay
    // readable and the tile's own clipping can't swallow it). It is the width's label as well as its grip.
    const h = d.createElement('span'); h.className = 'lay-h'; h.tabIndex = -1;
    h.setAttribute('role', 'slider'); h.setAttribute('aria-label', L.width); h.setAttribute('aria-valuemin', '1');
    h.setAttribute('aria-valuemax', String(m.cols || 6));
    h.addEventListener('pointerdown', (e) => { const c = d.querySelector('.lay-on'); if (c) pull(e, c, h, d); }, true);
    h.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key], c = d.querySelector('.lay-on');
      if (e.key === 'Escape') { pick(null); return; }
      if (e.key === 'Enter' && picked != null) { e.preventDefault(); edit(picked, 'front'); return; }
      if (!k || !c) return;
      e.preventDefault(); const cols = m.cols || 6, was = Math.min(+c.dataset.w || cols, cols), now = Math.max(1, Math.min(cols, was + k));
      if (now !== was) { showWidth(c, h, now); setWidth(+c.dataset.cell, now); }
    });
    d.body.appendChild(h);
    const p = d.createElement('button'); p.type = 'button'; p.className = 'lay-p'; p.innerHTML = PEN; p.setAttribute('aria-label', L.editTile);
    d.body.appendChild(p);
    p.addEventListener('keydown', (e) => { if (e.key === 'Escape') pick(null); });
    w.addEventListener('resize', () => placeHandle());
    // window capture runs before the card's own scripts: here a tap only ever picks, it never follows a link or opens a back
    w.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (dragged) { dragged = false; return; }
      if (e.target.closest && e.target.closest('.lay-p')) { if (picked != null) edit(picked, 'front'); return; }
      const t = e.target.closest && e.target.closest('.lay-mv'); pick(t && m.cells[+t.dataset.cell] ? +t.dataset.cell : null);
    }, true);
    if (w.Sortable) for (const box of new Set(faceCells(d).map((c) => c.parentElement))) {
      new w.Sortable(box, {
        group: 'face', draggable: '.lay-mv', filter: '.lay-h,.lay-p', preventOnFilter: false,
        animation: 140, forceFallback: true, fallbackTolerance: 6, delay: 150, delayOnTouchOnly: true,
        ghostClass: 'lay-ghost', chosenClass: 'lay-chosen',
        onStart: () => { dragged = true; d.documentElement.classList.add('lay-dragging'); h.classList.remove('lay-show'); p.classList.remove('lay-show'); },
        onEnd: () => { d.documentElement.classList.remove('lay-dragging'); setTimeout(() => { dragged = false; }, 0); dropped(d); setTimeout(placeHandle, 160); },
      });
    }
    if (picked != null && !d.querySelector('.lay-on')) picked = null;
    placeHandle();
  };
  f.srcdoc = renderCardHTML(md, { editIndex: true }).replace('</head>', () => css + '</head>');
}
let dragged = false;
// the order on screen becomes the file's order. A cell that draws nothing keeps its place; a move that
// would carry a tile out of its own labelled group is not a move this view makes, so the truth is redrawn.
function dropped(d) {
  const order = faceCells(d).map((c) => +c.dataset.cell);
  const slots = [...order].sort((a, b) => a - b);
  if (order.every((v, k) => v === slots[k])) return;
  const group = (i) => m.blocks.findIndex((b) => i >= b.start && i < b.start + b.count);
  if (slots.some((s, k) => group(s) !== group(order[k]))) { paintLayout(); return; }
  const x = clone(), cells = [...x.cells];
  slots.forEach((s, k) => { cells[s] = m.cells[order[k]]; });
  x.cells = cells;
  if (picked != null) picked = slots[order.indexOf(picked)];
  faceCells(d).forEach((c, k) => { c.dataset.cell = String(slots[k]); });
  commit(x, { quiet: true });
}
// pull the right edge: the tile snaps to whole columns as it goes, and the file changes on letting go
function pull(e, c, h, d) {
  e.preventDefault(); e.stopPropagation();
  const grid = c.parentElement.closest('.st-cells') || c.parentElement, cols = m.cols || 6;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0, colW = (grid.getBoundingClientRect().width - gap * (cols - 1)) / cols;
  const left = c.getBoundingClientRect().left, was = +c.dataset.w || cols;
  let now = was;
  d.documentElement.classList.add('lay-sizing'); h.setPointerCapture(e.pointerId);
  const move = (ev) => { const k = Math.max(1, Math.min(cols, Math.round((ev.clientX - left + gap) / (colW + gap)))); if (k !== now) { now = k; showWidth(c, h, k); } };
  const up = () => {
    h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
    d.documentElement.classList.remove('lay-sizing'); dragged = true; setTimeout(() => { dragged = false; }, 0);
    if (now !== was) setWidth(+c.dataset.cell, now);
  };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
}
function pick(i) {
  picked = i;
  const d = el('gridframe').contentDocument;
  if (d) for (const c of d.querySelectorAll('.lay-mv')) c.classList.toggle('lay-on', +c.dataset.cell === i);
  placeHandle();
  const h = d && (d.querySelector('.lay-h.lay-show') || d.querySelector('.lay-p.lay-show')); if (h) h.focus({ preventScroll: true });
}
// the handle follows the picked tile: centred on its right edge, in the card page's own coordinates
function placeHandle() {
  const d = el('gridframe').contentDocument, h = d && d.querySelector('.lay-h'), p = d && d.querySelector('.lay-p'); if (!h || !p) return;
  const c = d.querySelector('.lay-on');
  h.classList.toggle('lay-show', !!c && c.classList.contains('lay-ok')); p.classList.toggle('lay-show', !!c); if (!c) return;
  const r = c.getBoundingClientRect(), v = d.defaultView;
  // the pencil sits on the top edge, clear of the handle on the right edge (a short tile has room for both)
  p.style.left = `${Math.max(r.left + 18, r.right - 34) + v.scrollX}px`; p.style.top = `${r.top + v.scrollY}px`;
  if (!c.classList.contains('lay-ok')) return;
  h.style.left = `${r.right + v.scrollX}px`; h.style.top = `${r.top + r.height / 2 + v.scrollY}px`;
  labelWidth(c, h);
}
// the tile takes the width on screen at once; the handle says it
function showWidth(c, h, k) {
  c.dataset.w = String(k); c.dataset.span = (c.dataset.span || '').replace(/^\d+/, String(k)) || `${k}x1`;
  placeHandle();
}
function labelWidth(c, h) {
  const cols = m.cols || 6, w = Math.min(+c.dataset.w || cols, cols), says = widthSays(w, cols);
  h.textContent = says; h.setAttribute('aria-valuenow', String(w)); h.setAttribute('aria-valuetext', says);
}
function setWidth(i, k) {
  const x = clone(), c = x.cells[i]; if (!c) return;
  x.cells[i] = withRaw(c, setToken(c.rawParams || '', 'w', String(k)));
  commit(x, { quiet: true });   // the tile already shows the width
}
const viewsOn = () => { const fm = fmRead(m.pre); const on = String(fm.views || VIEW_IDS.join(' ')).split(/[\s,]+/).filter((v) => VIEW_IDS.includes(v)); return on.length ? on : VIEW_IDS; };
function paintViews() {
  const on = viewsOn();
  if (!on.includes(view)) view = on[0];
  for (const b of document.querySelectorAll('.modes button')) {
    b.textContent = L.views[b.dataset.view]; b.hidden = !on.includes(b.dataset.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
}
// the whole file's raw content is the same sheet as one tile's (one idea at two scopes): Done keeps it if the
// engine can still read every tile, Close leaves the file as it was, and either way you are back where you were
function openRaw() {
  open = { whole: true }; pending = {};
  el('modal-title').textContent = L.raw;
  el('modal-hint').textContent = L.rawSays;
  el('modal-body').innerHTML = `<div class="ctw-field" data-field="__raw"><textarea id="f-__raw" class="ctw-md" spellcheck="false" style="min-height:min(56vh,520px);font:13px/1.45 ui-monospace,Menlo,monospace"></textarea><p class="ctw-err" id="e-__raw"></p></div>`;
  el('modal-body').oninput = el('modal-body').onchange = null;
  el('f-__raw').value = md;
  el('modal-delete').hidden = true; el('modal-save').disabled = false;
  el('modal').hidden = false; el('f-__raw').focus();
}
function saveRaw() {
  const t = el('f-__raw').value;
  if (t !== md) {
    const wrong = whatIsWrong(t);   // the engine's own guard: no way out of here having quietly lost a tile
    if (wrong) { el('e-__raw').textContent = T.mdBroken.replace('{n}', String(wrong.line)); el('f-__raw').focus(); return; }
    md = t.endsWith('\n') ? t : t + '\n'; m = read(md);
    persist();
    cache.clear(); flipped.clear();
  }
  closeSheet(true); el('modal-delete').hidden = false;
  draw(); show();
}
function show() {
  paintViews(); paintMain();
  if (hostWaiting) return;
  if (!m.cells.length && view !== 'wall') editing = true;   // nothing to look at yet: the row with its "+"
  const pane = view === 'wall' ? 'layout' : editing ? 'edit' : 'preview';
  for (const id of ['preview', 'edit', 'layout']) el(id).hidden = id !== pane;
  if (pane === 'edit') edges();
  if (pane === 'layout') paintLayout(); else picked = null;
  if (pane === 'preview') {   // what a visitor gets in this view: the live page's own deck, opened on this view
    lsSet('reef-card-layout', null);   // the deck remembers a visitor's last pick; the editor names the view instead
    el('deckframe').srcdoc = renderCardHTML(md, { handle, deck: { view, ...(SANDBOX ? { pool: poolOn() } : {}) } });
  }
}
for (const b of document.querySelectorAll('.modes button')) b.onclick = () => {
  editing = false; view = b.dataset.view; show();
};
// the main action, far right: Edit while looking; Save while editing (and on the wall, which is always editable)
const SAVE_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let saving = false;
function paintMain() {
  const b = el('editbtn'); if (!b) return;
  const inEdit = editing || view === 'wall';
  b.innerHTML = (inEdit ? SAVE_ICO + esc(L.save) : PEN + esc(L.editBtn)) + (!inEdit && dirty() ? `<span class="dot" title="${esc(L.unsaved)}"></span>` : '');
  b.disabled = hostWaiting || saving || (view === 'wall' && !dirty());
  b.title = !inEdit && dirty() ? L.unsaved : '';
}
function doSave() {
  if (SANDBOX) { savedMd = md; lsSet(KEY, md); persist(); toast(L.savedLocal); return; }
  if (bridge && bridge.save()) { saving = true; paintMain(); }
}
el('editbtn').onclick = () => {
  if (editing || view === 'wall') {
    if (dirty()) doSave();
    if (m.cells.length) editing = false;
    show(); return;
  }
  let at = 0; try { at = el('deckframe').contentWindow.__deckCur?.() || 0; } catch { /* the frame is not ready */ }
  editing = true; show();
  const s = row.querySelectorAll('.slot')[Math.min(at, m.cells.length)];
  requestAnimationFrame(() => s && s.scrollIntoView({ inline: 'center', block: 'nearest' }));
};
// the assistant palette behind ⌘K and the magnifier: a stand-in that changes nothing
el('seek').setAttribute('aria-label', L.seek); el('seek').title = L.seek + ' (⌘K)';
el('pal-q').placeholder = L.palPh; el('pal-say').textContent = L.palSays;
const palOpen = () => { el('pal').hidden = false; el('pal-ans').hidden = true; el('pal-q').value = ''; el('pal-q').focus(); };
const palClose = () => { el('pal').hidden = true; };
el('seek').onclick = palOpen;
el('pal').onclick = (e) => { if (e.target === el('pal')) palClose(); };
el('pal-q').onkeydown = (e) => { if (e.key === 'Enter' && el('pal-q').value.trim()) { el('pal-ans').hidden = false; el('pal-ans').textContent = fmt(L.palEcho, { q: el('pal-q').value.trim() }); } };
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (el('pal').hidden) palOpen(); else palClose(); }
  else if (e.key === 'Escape' && !el('pal').hidden) { e.stopImmediatePropagation(); palClose(); }
}, true);

// ── the sandbox: the banner, and its doors toward the real creation flow ──
// The server already wrote the banner's sentences into the markup (a visitor without JavaScript reads
// them too); these are the same strings from the same table.
function bootSandbox() {
  el('sandbox-banner').hidden = false;
  el('sandbox-banner-text').textContent = PERSONA.bannerText;
  el('sandbox-banner-status').textContent = PERSONA.bannerStatus;
  // Start over: the one exit that empties this browser's copy, and it says so
  el('sandbox-reset').textContent = PERSONA.reset;
  el('sandbox-reset').onclick = () => {
    const seed = buildSandboxCard(LOCALE);
    lsSet(KEY, null); lsSet(DKEY, null); lsSet(W2_DRAFT_KEY, null);
    savedMd = seed; md = seed; m = read(md); cache.clear(); flipped.clear(); persist(); draw(); show();
  };
  // Make this card real: the sentence first, then the card is parked (the WHOLE card travels) and the
  // creation flow opens with it. 🔴 Nothing clears the draft here: a visitor who does not finish signing up
  // comes back to it.
  const doorBtn = el('publish');
  doorBtn.textContent = PERSONA.doorCta;
  el('door-title').textContent = PERSONA.doorCta;
  el('door-note').textContent = PERSONA.doorNote;
  el('door-go').textContent = PERSONA.doorContinue;
  el('door-back').textContent = PERSONA.doorBack;
  el('door-back').onclick = () => { el('doormodal').hidden = true; };
  el('door-go').onclick = async () => {
    el('door-go').disabled = true;
    const draft = await parkSandboxCard(md, { origin: location.origin });
    location.href = sandboxDoorHref(md, { draft });
  };
  doorBtn.onclick = () => { el('doormodal').hidden = false; el('door-go').disabled = false; el('door-go').focus(); };
}

// ── host mode: the card arrives from the parent and Save goes back to it (w3/host-bridge.mjs) ──
function paintHostStatus(status, message) {
  const n = el('host-status');
  n.dataset.status = status;
  const words = { waiting: L.hostWaiting, saving: L.hostSaving, failed: message ? `${L.hostFailed}: ${message}` : L.hostFailed }[status] || '';
  n.textContent = words; n.hidden = !words;
}
function bootHost() {
  el('lockup').target = '_top';
  document.body.dataset.hostWaiting = '1';   // nothing to edit until the parent hands a card over
  bridge = createHostBridge({
    host: HOST,
    post: (msg, origin) => window.parent.postMessage(msg, origin),
    onStatus: (status, message) => {
      paintHostStatus(status, message);
      if (status === 'saved' || status === 'unsaved' || status === 'failed') {
        const wasSaving = saving; saving = false;
        if (wasSaving && status !== 'failed') { savedMd = bridge.savedMd; persist(); toast(L.savedLive); }
        if (wasSaving && status === 'failed') toast(message ? `${L.hostFailed}: ${message}` : L.hostFailed);
        paintMain();
      }
    },
    onLoad: (x) => {
      handle = x.handle || handle; cardUrl = x.cardUrl || '';
      savedMd = x.md; md = x.md;
      // a draft this browser kept for this Card comes back — but only when it was made on top of exactly
      // the card the parent just loaded. Made on an older save, it is set aside rather than quietly
      // replayed over somebody's newer one.
      try {
        const kept = JSON.parse(lsGet(hostDraftKey()) || 'null');
        if (kept && kept.base === x.md && typeof kept.md === 'string' && readsAsCard(kept.md)) md = kept.md;
      } catch { /* an unreadable draft is no draft */ }
      hostWaiting = false; delete document.body.dataset.hostWaiting;
      m = read(md); cache.clear(); flipped.clear(); undoTo = null; editing = false;
      { const fm = fmRead(m.pre); if (VIEW_IDS.includes(fm.view)) view = fm.view; }
      persist(); draw(); show();
    },
    onPropose: ({ md: next }) => {
      // a suggestion becomes the draft — shown, dirty, never saved by itself
      if (!el('modal').hidden) closeSheet(true);
      el('picker').hidden = true; zoom.hidden = true;
      md = next.endsWith('\n') ? next : next + '\n'; m = read(md);
      cache.clear(); flipped.clear(); undoTo = null;
      persist(); draw(); show();
      toast(L.proposed);
    },
  });
  window.addEventListener('message', (e) => bridge.receive(e));
  // Cmd/Ctrl+S saves, from the page and from every frame in it that can hold focus
  const saveKey = (doc) => doc.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (dirty()) doSave(); }
  }, true);
  saveKey(document);
  bridge.ready();
}

if (SANDBOX) bootSandbox(); else bootHost();
{ const fm = fmRead(m.pre); if (VIEW_IDS.includes(fm.view)) view = fm.view; }
draw(); show();
// the harness drives these; harmless in normal use
window.__cardtileW3 = {
  get md() { return md; }, get savedMd() { return savedMd; }, get model() { return m; }, get dirty() { return dirty(); },
  get mode() { return SANDBOX ? 'sandbox' : 'host'; }, get locale() { return LOCALE; }, get view() { return view; },
};
