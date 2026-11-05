// The Card editor — served at card.feelreef.com/try/edit (the public sandbox) and /edit?host=<origin>
// (host mode: framed by feelreef's dashboard to edit a real Card). Bundled by
// serve/gen-edit3-assets.mjs into serve/edit3-assets.mjs, which the Worker serves.
//
// Built on the engine's own pieces: the state is the card's Markdown (card-core); the sheet a pencil
// opens is cell-form-core's, built from CELL_TYPES, with cell-form-dom's pickers; a text tile is
// written with the family's text editor (editor-core + its web shim, borrowed as they ship). This
// module owns the row of tiles, the pairing chain, the swap, the numbers, Cards settings, and Save.
//
// 🔴 NOTHING GOES LIVE UNTIL SAVE. The draft lives in this browser (localStorage) and survives a
// reload; leaving edit mode with it unsaved asks (Save / Keep editing / Discard, w3/leave-edit.mjs),
// and closing the tab asks the browser's own question. Save is the only door out:
//   sandbox  there is no account behind /try/edit, so Save keeps the draft in this browser and opens
//            the door to the real thing: it parks the card and opens the creation flow.
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
import { chromeStrings, primaryLocale, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { sandboxDoorHref, parkSandboxCard } from '../w/sandbox-door.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { cardTitle } from './card-title.mjs';
import { typeIconSvg } from './type-icons.mjs';
import { createHostBridge, validHostOrigin, readsAsCard } from './host-bridge.mjs';
import { editStrings, fmt } from './edit3-i18n.mjs';
import { createNotices } from './notice.mjs';
import { leaveStep, resolveLeave } from './leave-edit.mjs';
import { withRaw, backId, freshBackId, insertCell, removeCell, pair, unpair, canPair } from './pairing.mjs';
import { VIEW_IDS, fmRead, fmWrite, readViews, toggleView, applySetting } from './card-settings.mjs';
import { NETWORKS, parseSocial, composeSocial } from './social-rows.mjs';
import { WIDE_MIN, CHOICES, createPageStack, sidebarGroups, confirmShape, topLayer, closeShows, LAYER_TOP_FIRST, swipeCloses } from './settings-nav.mjs';
import { encodeImage } from '../w/cell-form-dom.mjs';
import { DEFAULT_ACCENT } from '../colour.mjs';

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
// lucide link-2 / unlink-2: the control between two tiles pairs them, or takes a pair apart
const LINK2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>';
const UNLINK2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const XICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ELLIPSIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';
// lucide qr-code: the default back's placeholder for the code the deck draws on the live page
const QRICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>';
// the views, in the glyphs the live deck's own switch uses (w3/deck.js: deck, list, grid)
const VIEW_ICO = {
  stack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.65 7.65a2 2 0 012.629-1.046l5.51 2.374a2 2 0 011.046 2.628l-3.957 9.184a2 2 0 01-2.628 1.046l-5.51-2.374a2 2 0 01-1.046-2.628z"/><path d="M18 7.777V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v10a2 2 0 001.137 1.805"/><path d="m8 4.389-4.364.809a2 2 0 00-1.602 2.33l1.822 9.833a2 2 0 002.331 1.602l2.542-.47"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v18"/><rect width="12" height="18" x="6" y="3" rx="2"/><path d="M22 3v18"/></svg>',
  wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/></svg>',
};
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
L.netNames = Object.fromEntries(NETWORKS.map((n) => [n.id, n.id === 'web' ? L.socialWeb : n.id === 'email' ? L.socialEmail : n.label]));
L.viewSays = { stack: L.viewSaysStack, list: L.viewSaysList, wall: L.viewSaysWall };
L.dimNames = { 0: L.dim0, 25: L.dim25, 45: L.dim45, 65: L.dim65 };
L.themeNames = { auto: L.themeAuto, light: L.themeLight, dark: L.themeDark };
L.headerNames = { centre: L.headerCentre, left: L.headerLeft };
L.iconsNames = { colour: L.iconsColour, mono: L.iconsMono };
const T = chromeStrings(LOCALE), TX = cellStrings(LOCALE);
const PERSONA = SANDBOX_LOCALES[LOCALE] || SANDBOX_LOCALES.en;
document.documentElement.lang = PERSONA.lang;
for (const n of document.querySelectorAll('[data-l]')) n.textContent = L[n.dataset.l];
for (const n of document.querySelectorAll('[data-l-label]')) n.setAttribute('aria-label', L[n.dataset.lLabel]);
for (const n of document.querySelectorAll('[data-l-title]')) n.title = L[n.dataset.lTitle];
el('cardset').title = L.options;
// the views are icons only; their names are the buttons' accessible names (and a pointer's tooltip)
for (const b of document.querySelectorAll('.modes button')) { b.innerHTML = VIEW_ICO[b.dataset.view]; b.setAttribute('aria-label', L.views[b.dataset.view]); b.title = L.views[b.dataset.view]; }const say = (key) => cellText(TX, key);

// ── state: the card's Markdown is the truth; the model is re-read from it on every change ──
// sandbox: KEY = what Save kept, DKEY = the draft being edited. host: the parent holds what is saved,
// and the draft is kept per handle, with the saved card it was made on top of (see onLoad).
const KEY = 'cardtile:w3:saved', DKEY = 'cardtile:w3:draft';
const W2_DRAFT_KEY = 'cardtile:try:draft:v1';   // the previous sandbox kept every edit here, unasked
const hostDraftKey = () => `cardtile:w3:host-draft:${handle || 'card'}`;
const EMPTY = '## cards\n\n';
// 🔴 the sandbox starts from a NEW, EMPTY card: one big "add" on the canvas, nobody else's sample to clear first
const SANDBOX_START = EMPTY;
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
  return SANDBOX_START;
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
function commit(next, { quiet = false, settings = true } = {}) {   // next: a model → it becomes the file
  md = serializeCard(next); m = read(md);
  persist();
  draw(); if (!quiet) show();   // quiet: the screen already shows it (the wall moves the tiles itself)
  if (settings) setPaint();     // Cards settings, when open under this, shows the file as it now is
}
const clone = () => structuredClone(m);

// one row of tiles: every face cell in order; a face cell whose `back=#id` names a back lane is a pair
const items = () => m.cells.map((cell, i) => ({ i, cell, back: (backId(cell) && m.drawers.find((d) => d.id === backId(cell))) || null }));

// the default back: the frontmatter's `back: "#id"` names one back lane, the same pointer a tile's `back=#id` is, at
// the scope of the whole Cards. Quoted, because a bare # starts a YAML comment. None → the printed business card.
const defId = (pre = m.pre) => String(fmRead(pre).back || '').replace(/^["']|["']$/g, '').replace(/^#/, '');
const defBack = () => { const id = defId(); return (id && m.drawers.find((d) => d.id === id)) || null; };

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
// The tile is laid out at its REAL width (300–390px) and only scaled by what is left, so on a phone its words
// are their real size instead of a 390px page shrunk to a third (the row is the phone's main screen).
function fit(frame, box) {
  const w = box.clientWidth, h = box.clientHeight; if (!w) return;
  const lay = Math.max(300, Math.min(390, w)), k = w / lay;
  frame.style.width = `${lay}px`; frame.style.height = `${h / k}px`;
  frame.style.transform = `scale(${k})`; frame.style.opacity = 1;
}

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
    const n = document.createElement('button'); n.type = 'button'; n.className = 'note'; n.textContent = L.backInRaw;
    n.onclick = (e) => { e.stopPropagation(); openRaw(); };
    c.appendChild(n);
  } else {   // 🔴 the pencil is ALWAYS at a tile's top-left, one style — here and on the wall
    const pen = document.createElement('button'); pen.type = 'button'; pen.className = 'pen'; pen.innerHTML = PEN; pen.setAttribute('aria-label', `${L.editTile} · ${label}`);
    pen.onclick = (e) => { e.stopPropagation(); onPen(); };
    c.appendChild(pen);
  }
  return c;
}
// the control between two tiles: pair them (link-2), or — inside a pair — take them apart (unlink-2)
function pairBtn(on, onClick) {
  const b = document.createElement('button'); b.type = 'button';
  b.className = 'chain' + (on ? ' on' : ''); b.innerHTML = on ? UNLINK2 : LINK2;
  const label = on ? L.pairOff : L.pairOn; b.title = label; b.setAttribute('aria-label', label);
  b.onclick = onClick; return b;
}
// every gap BETWEEN tiles takes a new one, on the same axis as the pair control and clear of it
function gapEl(it, next) {
  const g = document.createElement('div'); g.className = 'gapbtn';
  if (canPair(m, it.i)) g.appendChild(pairBtn(false, () => commit(pair(clone(), it.i))));
  const b = document.createElement('button'); b.type = 'button'; b.className = 'ins'; b.innerHTML = PLUS;
  b.title = fmt(L.addBetween, { a: it.i + 1, b: it.i + 2 }); b.setAttribute('aria-label', b.title);
  b.onclick = () => openPicker(next.i);
  g.appendChild(b); return g;
}
const kindName = (cell) => (TYPES[cell.type] ? say(TYPES[cell.type].title) : cell.type);
const profileAt = () => m.cells.findIndex((c) => c.type === 'profile');
function draw() {
  document.title = fmt(L.docTitle, { t: cardTitle(md) || L.untitled });
  row.textContent = '';
  const list = items();
  row.classList.toggle('is-empty', !list.length);
  list.forEach((it, k) => {
    const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.i = String(it.i);
    const num = document.createElement('div'); num.className = 'num'; num.textContent = String(k + 1);
    const front = cardEl([it.cell], kindName(it.cell), () => edit(it.i, 'front'));
    front.classList.add('front'); front.onclick = () => zoomPair(it);
    if (it.back) {
      // 🔴 A PAIR IS SHOWN, NOT HIDDEN: both faces side by side, front on the left, in one shared frame,
      // with the control that takes them apart between them
      slot.classList.add('paired');
      const back = cardEl(it.back.cells.slice(0, 1), L.back, () => edit(it.i, 'back'), it.back.cells.length !== 1);
      back.classList.add('backface'); back.onclick = () => zoomPair(it, true);
      const faces = document.createElement('div'); faces.className = 'faces';
      const side = (card, words) => { const s = document.createElement('div'); s.className = 'side'; const t = document.createElement('small'); t.textContent = words; s.append(card, t); return s; };
      const mid = document.createElement('div'); mid.className = 'gapbtn in-pair'; mid.appendChild(pairBtn(true, () => commit(unpair(clone(), it.i))));
      faces.append(side(front, L.front), mid, side(back, L.back));
      slot.append(num, faces);
    } else slot.append(num, front);
    row.appendChild(slot);
    const next = list[k + 1];
    if (next) row.appendChild(gapEl(it, next));
  });
  // the end of the row: one more. With nothing yet it IS the canvas — one big "add", no words needed.
  const slot = document.createElement('div'); slot.className = 'slot add';
  const num = document.createElement('div'); num.className = 'num';
  const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'new'; nb.innerHTML = PLUS; nb.setAttribute('aria-label', L.addTile);
  nb.onclick = () => openPicker();
  slot.append(num, nb);
  row.appendChild(slot);
  edges();
  paintViews();
}

// ── "+" ──
function openPicker(at = m.cells.length, opt = {}) {
  const kinds = PALETTE.map((t) => `<button class="ctw-pick-btn" type="button" data-type="${esc(t)}" title="${esc(say(TYPES[t].hint))}">`
    + `<span class="ctw-pick-ico">${typeIconSvg(t)}</span><span class="ctw-pick-name">${esc(say(TYPES[t].title))}</span>`
    + `<span class="ctw-pick-hint">${esc(say(TYPES[t].hint))}</span></button>`).join('');
  // (raw editing lives in one place only: Cards settings → More → Edit raw content)
  el('picker-row').innerHTML = kinds;
  for (const b of el('picker-row').querySelectorAll('.ctw-pick-btn')) b.onclick = () => { el('picker').hidden = true; if (opt.asDefault) addDefault(b.dataset.type); else add(b.dataset.type, at); };
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
let open = null;   // { i, which, asMd } | { whole: true }
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
  const paired = which !== 'default' && !!(items()[i] && items()[i].back);
  const body = el('modal-body');
  el('modal-foot').hidden = false;
  if (asMd || !def) {   // a kind this editor has no form for: its own line, as written
    el('modal-title').textContent = L.raw;
    el('modal-hint').textContent = '';
    body.innerHTML = `<div class="ctw-field" data-field="__raw"><textarea id="f-__raw" class="ctw-md" spellcheck="false"></textarea><p class="ctw-err" id="e-__raw" role="alert"></p></div>`;
    el('f-__raw').value = cell.body || '';
  } else {
    el('modal-title').textContent = say(def.title);
    el('modal-hint').textContent = say(def.hint || '');
    body.innerHTML = formBodyHtml(def, cell, formCtx());
    wireForm(body, def, { T, previewSrc, stage: (id, a) => { pending[id] = a; } });
    if (cell.type === 'text') proseEditor(document.getElementById('f-__body'));
    if (cell.type === 'social') socialForm(document.getElementById('f-__body'));
    tidyHints(body);
  }
  if (paired) {   // switching sides keeps what was typed: it is Done on this side, then the other side opens
    const seg = document.createElement('div'); seg.className = 'open-seg side-seg';
    seg.innerHTML = ['front', 'back'].map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === which}">${esc(s === 'front' ? L.front : L.back)}</button>`).join('');
    seg.onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === which || el('modal-save').disabled) return; saveSheet(); if (el('modal').hidden) edit(i, b.dataset.s); };
    body.prepend(seg);
  }
  // 🔴 a tile that is not there yet (just added, not Done) has nothing to delete: the way out is Cancel
  const fresh = undoTo != null, del = el('modal-delete');
  del.hidden = false; del.textContent = fresh ? L.cancel : L.deleteTile;
  del.classList.toggle('ctw-btn-danger', !fresh);
  el('modal').hidden = false;
  // a field the tile cannot go without: Done waits for it instead of refusing afterwards, the field says
  // so, the line beside Done says which, and the sheet opens on it when it is still empty
  const need = asMd || !def ? [] : requiredNames(def);
  const fieldOf = (n) => { const f = document.getElementById(`f-${n}`); return f && f.closest('[data-field]'); };
  for (const n of need) {
    const box = fieldOf(n); if (!box || box.querySelector('.ctw-need')) continue;
    const tag = document.createElement('em'); tag.className = 'ctw-need'; tag.textContent = L.required;
    (box.querySelector(':scope > span') || box).appendChild(tag);
  }
  const empty = () => need.map((n) => document.getElementById(`f-${n}`)).filter((f) => f && fieldOf(f.id.slice(2)) && !fieldOf(f.id.slice(2)).hidden && !f.value.trim());
  const gate = () => {
    const gaps = empty();
    el('modal-save').disabled = gaps.length > 0;
    for (const n of need) { const box = fieldOf(n); if (box) box.classList.toggle('is-missing', gaps.some((f) => f.id === `f-${n}`)); }
    const first = gaps[0] && fieldOf(gaps[0].id.slice(2));
    el('modal-why').textContent = first ? fmt(L.needs, { f: (first.querySelector(':scope > span')?.firstChild?.textContent || '').trim() }) : '';
  };
  body.oninput = body.onchange = gate; gate();
  const first = empty()[0] || body.querySelector('.prose-ed [contenteditable]') || body.querySelector('input:not([type=hidden]),textarea:not([hidden]),select'); if (first) first.focus({ preventScroll: true });
  notices.place();
}
// Help text stays short on screen: a long explanation goes behind a "?" by its label, shown on tap. An
// address in a hint never breaks in the middle, and a hint's last line never holds one lonely character.
const LONG_HINT = 64;
function tidyHints(body) {
  for (const em of body.querySelectorAll('.ctw-field > em:not(.ctw-err):not(.ctw-need)')) {
    const t = em.textContent;
    em.innerHTML = esc(t).replace(/((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}\/[^\s，。、)）]*)/gi, '<span class="nw">$1</span>');
    em.classList.add('hint');
    if (t.length <= LONG_HINT) continue;
    const label = em.parentElement.querySelector(':scope > span'); if (!label) continue;
    const id = `h-${em.parentElement.dataset.field}`; em.id = id; em.hidden = true;
    const q = document.createElement('button'); q.type = 'button'; q.className = 'qhelp'; q.textContent = '?';
    q.setAttribute('aria-label', L.help); q.setAttribute('aria-expanded', 'false'); q.setAttribute('aria-controls', id);
    q.onclick = (e) => { e.preventDefault(); e.stopPropagation(); em.hidden = !em.hidden; q.setAttribute('aria-expanded', String(!em.hidden)); };
    label.appendChild(q);
  }
}
// ── the social-icons tile: one row per account (w3/social-rows.mjs). The textarea stays the field the
// form reads (like the text editor's); the rows only write into it. No Markdown, %20 or icon= by hand.
function socialForm(ta) {
  if (!ta) return;
  const box = ta.closest('[data-field]'); ta.hidden = true;
  for (const em of box.querySelectorAll(':scope > em:not(.ctw-err)')) em.remove();
  let rows = parseSocial(ta.value);
  if (!rows.some((r) => r.raw == null)) rows.push({ net: 'instagram', url: '', label: '', extra: '' });
  const list = document.createElement('div'); list.className = 'soc-rows'; ta.after(list);
  const write = () => { ta.value = composeSocial(rows); ta.dispatchEvent(new Event('input', { bubbles: true })); };
  const opts = (sel) => NETWORKS.map((n) => `<option value="${n.id}"${n.id === sel ? ' selected' : ''}>${esc(L.netNames[n.id])}</option>`).join('');
  const paint = () => {
    list.textContent = '';
    rows.forEach((r, k) => {
      if (r.raw != null) return;   // a line the form cannot show is kept as written, out of the way
      const line = document.createElement('div'); line.className = 'soc-row';
      // a new row's starting address is the network's front page: show it empty, so the person types theirs
      if (r.net !== 'web' && /^https?:\/\/(www\.)?[^/]+\/?$/.test(r.url)) r.url = '';
      line.innerHTML = `<select aria-label="${esc(L.socialNet)}">${opts(r.net)}</select>`
        + `<input type="text" inputmode="${r.net === 'email' ? 'email' : 'url'}" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="${esc(L.socialLink)}" placeholder="${esc(L.socialLink)}" value="${esc(r.url)}">`
        + `<button type="button" class="soc-x" aria-label="${esc(L.socialRemove)}">${XICO}</button>`;
      const [sel, inp, x] = line.children;
      sel.onchange = () => { r.net = sel.value; r.label = ''; inp.inputMode = r.net === 'email' ? 'email' : 'url'; write(); };
      inp.oninput = () => { r.url = inp.value; write(); };
      x.onclick = () => { rows.splice(k, 1); if (!rows.some((y) => y.raw == null)) rows.push({ net: 'instagram', url: '', label: '', extra: '' }); paint(); write(); };
      list.appendChild(line);
    });
    const more = document.createElement('button'); more.type = 'button'; more.className = 'ctw-btn soc-add'; more.innerHTML = PLUS + esc(L.socialAdd);
    more.onclick = () => { rows.push({ net: 'instagram', url: '', label: '', extra: '' }); paint(); list.querySelector('.soc-row:last-of-type input')?.focus(); };
    list.appendChild(more);
  };
  paint();
  if (composeSocial(rows) !== ta.value) write();   // a front-page placeholder shown empty is empty in the tile too
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
  const ed = box.querySelector('[contenteditable]'); if (ed) ed.setAttribute('aria-label', ta.closest('[data-field]')?.querySelector('span')?.textContent || L.text);
  fitToolbar(box);
}
// 🔴 The toolbar NEVER WRAPS (P44): it is one row; the tools that do not fit go, from the end, into a "more"
// menu (lucide ellipsis). Search stays in the row. The editor's own buttons are moved, never copied, so each
// keeps its own wiring.
function fitToolbar(box) {
  const tools = box.querySelector('.tugtile-ed-tools'); if (!tools) return;
  const all = [...tools.children];
  const more = document.createElement('div'); more.className = 'tb-more';
  more.innerHTML = `<button type="button" class="tugtile-iconbtn tugtile-ed-tool tb-more-btn" aria-label="${esc(L.more)}" aria-haspopup="true" aria-expanded="false">${ELLIPSIS}</button><div class="tb-more-menu" hidden></div>`;
  const btn = more.firstChild, menu = more.lastChild;
  const shut = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the text's selection for the tool picked next
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', () => setTimeout(shut, 0));
  box.ownerDocument.addEventListener('click', (e) => { if (!more.contains(e.target)) shut(); });
  let lastW = -1;
  const layout = () => {
    const w = tools.clientWidth; if (!w || w === lastW) return; lastW = w;   // not on screen yet: wait for the size
    shut(); more.remove();
    for (const n of all) tools.appendChild(n);
    // measured by the boxes, not scrollWidth: each tool's enlarged hit area overhangs it by a few pixels
    const over = () => { const l = tools.lastElementChild; return !!l && l.getBoundingClientRect().right > tools.getBoundingClientRect().right + 0.5; };
    if (!over()) return;
    tools.appendChild(more);
    const movable = all.slice(1);   // the first tool is search: it stays
    for (let k = movable.length - 1; k >= 0 && over(); k--) menu.prepend(movable[k]);
    // a divider never ends the row
    const last = more.previousElementSibling; if (last && last.classList.contains('tugtile-ed-sep')) menu.prepend(last);
  };
  new ResizeObserver(layout).observe(tools);
  layout();
}
function requiredNames(def) {
  const out = [], walk = (rows) => rows.forEach((r) => (r.group ? walk(r.rows) : r.required && out.push(r.name)));
  walk(def.form || def.fields || []); return out;
}
function closeSheet(kept) {
  el('modal').hidden = true; open = null; pending = {}; prose = null;
  if (!kept && undoTo != null) { const back = undoTo; undoTo = null; md = back; m = read(md); persist(); draw(); }
  undoTo = null;
  setPaint();   // back to Cards settings when the sheet was opened from there
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
  if (!fresh) confirmNote('deleted', L.deleted, backTo(was));
}
// ── the one notice (w3/notice.mjs): top = status and errors, bottom = confirmations (with Undo) ──
// the open sheet a bottom notice moves into: the top-most one (Cards settings sits under the sheets it opens)
const LAYER_ORDER = ['leavemodal', 'doormodal', 'modal', 'picker', 'settings'];
const openPanel = () => {
  for (const id of LAYER_ORDER) if (id === 'settings' ? setOpen() : !el(id).hidden) return el(id).querySelector('.ctw-modal-panel, .set-panel');
  return null;
};
const notices = createNotices({ top: el('notice-top'), bottom: el('notice-bottom'), openSheet: openPanel });
const confirmNote = (kind, words, undo) => notices.show(kind, words, undo ? { label: L.undo, run: undo } : null);
const backTo = (was) => () => { md = was; m = read(md); cache.clear(); persist(); draw(); show(); setPaint(); };

// ── Cards settings: what belongs to the whole card, not to one tile ──
// 🔴 iOS SETTINGS IS THE RULER (w3/settings-nav.mjs holds the shape). A panel that slides up from the bottom of
// the glass and back down when closed. Narrow: grouped inset lists, one thing per row (label left, its value
// right, a chevron when it opens a page), pages pushed in from the right with "‹ Settings" at their top-left.
// Wide: a sidebar of the groups and the chosen group's rows; a 2–3-option choice is a dropdown there.
// Explanations are grey footnotes under a group, never inside a row. Destructive actions are a red group at
// the bottom, confirmed first (an action sheet narrow, a centred alert wide).
// Every change goes into the DRAFT the moment it is made (w3/card-settings.mjs): there is no Save in here;
// the top bar's Save (and its unsaved dot) is how it is saved, after the panel is closed.
const setLayer = el('settings'), setPanel = el('set-panel'), setPages = el('set-pages'), setConfirm = el('set-confirm');
const wideMQ = matchMedia(`(min-width: ${WIDE_MIN}px)`), calm = matchMedia('(prefers-reduced-motion: reduce)');
let setLayout = 'narrow', wideGroup = 'name', wideSub = null, bdErr = '', bkErr = '';
const setStack = createPageStack('root');
const setOpen = () => !setLayer.hidden && !setLayer.classList.contains('is-closing');
const unq = (v) => String(v || '').replace(/^["']|["']$/g, '');
const fmNow = () => fmRead(m.pre);
const NOW = {
  theme: () => (['light', 'dark'].includes(fmNow().theme) ? fmNow().theme : 'auto'),
  header: () => (fmNow().header === 'left' ? 'left' : 'centre'),
  icons: () => (fmNow().icons === 'mono' ? 'mono' : 'colour'),
  dim: () => (CHOICES.dim.includes(String(fmNow()['backdrop-dim'] || '')) ? String(fmNow()['backdrop-dim'] || '') : ''),
  accent: () => { const a = unq(fmNow().accent).toLowerCase(); return /^#[0-9a-f]{6}$/.test(a) ? a : ''; },
  backdrop: () => unq(fmNow().backdrop).trim(),
};
// in the order offered: [value, name] pairs (an object would put the numeric keys before Auto's '')
L.dimAll = CHOICES.dim.map((k) => [k, k ? L.dimNames[k] : L.auto]);
const pairs = (names) => (Array.isArray(names) ? names : Object.entries(names));
const CHOICE_NAMES = { theme: L.themeNames, header: L.headerNames, icons: L.iconsNames, dim: L.dimAll };
const CHOICE_KEY = { theme: 'theme', header: 'header', icons: 'icons', dim: 'backdrop-dim' };
const GROUP_NAME = { name: L.secName, look: L.secLook, views: L.secViewsBack, found: L.secFound, more: L.secMore };
const PAGE_TITLE = { address: L.handleL, domain: L.domainL, theme: L.themeL, accent: L.accentL, backdrop: L.backdrop, header: L.headerL, icons: L.iconsL, views: L.viewsL, back: L.bcL, backup: L.backupL };
// the main colours on offer: the engine's default first (what Reset gives back), then a spread of hues
const SWATCHES = [DEFAULT_ACCENT, '#e4572e', '#f3a712', '#29bf12', '#4361ee', '#9b5de5', '#f15bb5', '#222222'];
const CHEVL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const AVATAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21c.8-4.4 4.2-6.8 8.5-6.8s7.7 2.4 8.5 6.8z"/></svg>';

// ── the rows: one thing per row ──
const node = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
/** a group: an optional header, the inset list, and at most one grey footnote under it */
function sGroup(body, title, foot = '', { err = false, id = '' } = {}) {
  if (title) body.append(node('h3', 'set-gh', esc(title)));
  const g = node('div', 'set-g'); body.append(g);
  if (foot) { const f = node('p', 'set-foot' + (err ? ' is-err' : '')); f.textContent = foot; if (id) f.id = id; if (err) f.setAttribute('role', 'alert'); body.append(f); }
  return g;
}
function rowBtn(g, label, { value = '', valueHtml = '', chevron = false, tone = '', id = '', disabled = false, onClick = null } = {}) {
  const r = node('button', 'set-r' + (tone ? ` is-${tone}` : '')); r.type = 'button'; if (id) r.id = id; r.disabled = disabled;
  r.innerHTML = `<span class="set-l">${esc(label)}</span>${valueHtml || (value ? `<span class="set-v">${esc(value)}</span>` : '')}${chevron ? `<span class="set-chev">${CHEV}</span>` : ''}`;
  if (onClick) r.onclick = onClick;
  g.append(r); return r;
}
function rowStatic(g, label, value = '', { id = '' } = {}) {
  const r = node('div', 'set-r', `<span class="set-l">${esc(label)}</span>${value ? `<span class="set-v">${esc(value)}</span>` : ''}`); if (id) r.id = id;
  g.append(r); return r;
}
function rowField(g, label, input, { prefix = '' } = {}) {
  const r = node('label', 'set-r is-field', `${label ? `<span class="set-l">${esc(label)}</span>` : ''}${prefix ? `<span class="set-pre">${esc(prefix)}</span>` : ''}`);
  r.append(input); g.append(r); return r;
}
function textInput(id, value, { placeholder = '', type = 'text', mode = '' } = {}) {
  const i = document.createElement('input'); i.type = type; i.id = id; i.value = value; i.placeholder = placeholder;
  i.autocomplete = 'off'; i.spellcheck = false; if (mode) { i.inputMode = mode; i.setAttribute('autocapitalize', 'off'); }
  return i;
}
// a switch row is one <label>: tapping the words toggles it too. A row may carry ONE short second line (iOS's
// subtitle cell) when it names a thing — never an explanation; those are the group's footnote.
function rowSwitch(g, label, sub, on, onChange, { disabled = false, id = '' } = {}) {
  const r = node('label', 'set-r is-switch', `<span class="set-l">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`);
  const sw = document.createElement('input'); sw.type = 'checkbox'; sw.className = 'switch'; sw.setAttribute('role', 'switch');
  if (id) sw.id = id; sw.checked = on; sw.disabled = disabled; sw.onchange = () => onChange(sw.checked);
  r.append(sw); g.append(r); return r;
}
// a 2–3-option choice on the narrow shape: a checkmark list (never a segmented control, never a native select)
function rowChecks(g, names, value, onPick, label) {
  g.setAttribute('role', 'radiogroup'); if (label) g.setAttribute('aria-label', label);
  for (const [k, n] of pairs(names)) {
    const r = rowBtn(g, n, { valueHtml: `<span class="set-ck">${k === value ? CHECK : ''}</span>`, onClick: () => onPick(k) });
    r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', String(k === value)); r.dataset.v = k;
  }
}
// …and on the wide shape: an inline dropdown
function rowSelect(g, label, names, value, onPick, id) {
  const r = node('label', 'set-r is-select', `<span class="set-l">${esc(label)}</span>`);
  const s = document.createElement('select'); s.className = 'set-sel'; s.id = id;
  s.innerHTML = pairs(names).map(([k, n]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(n)}</option>`).join('');
  s.onchange = () => onPick(s.value);
  r.append(s); g.append(r); return r;
}
const inlineBtn = (label, { id = '', disabled = false, title = '', onClick = null } = {}) => {
  const b = node('button', 'set-inl'); b.type = 'button'; b.textContent = label; if (id) b.id = id; b.disabled = disabled; if (title) b.title = title;
  if (onClick) b.onclick = onClick; return b;
};

// ── the rows that are the same on both shapes ──
function titleRow(g) {
  const inp = textInput('opt-title', unq(fmNow().title), { placeholder: L.untitled });
  inp.oninput = () => putSoon('title', inp.value);
  inp.onchange = () => { settingNext = ['title', inp.value]; flushSetting(); };
  rowField(g, L.titleL, inp);
}
const addr = (h) => `reef.cards/${h}`;
function addressRow(g) {
  // 🔴 a real Card's address is the platform's: read-only here
  if (!SANDBOX) { rowStatic(g, L.handleL, addr(getHandle()), { id: 'opt-handle' }); return; }
  rowBtn(g, L.handleL, { value: addr(getHandle()), chevron: true, id: 'opt-hchange', onClick: () => setPush('address') });
}
const nameFoot = () => (!SANDBOX ? L.handleHere : profileAt() >= 0 ? L.titleFromProfile : '');
const viewsValue = () => readViews(m.pre).on.map((v) => L.views[v]).join(L.listSep);
const backValue = () => { const d = defBack(); return d && d.cells[0] ? kindName(d.cells[0]) : L.bcValue; };
const dot = (c) => `<span class="set-dot" style="background:${esc(c)}" aria-hidden="true"></span>`;
function poolGroup(body) {
  const on = poolOn();
  rowSwitch(sGroup(body, '', on ? L.poolOn : L.poolOff), L.poolL, '', on, (want) => { lsSet(PKEY, want ? null : 'off'); show(); setPaint(); }, { id: 'opt-pool' });
}
function signInRow(g, { small = false } = {}) {
  // the sandbox's first row, shaped like the account row at the top of a phone's settings. It opens the SAME
  // door Save opens: the draft is parked and the creation flow takes it from there.
  const b = node('button', 'set-acct' + (small ? ' is-small' : ''), `<span class="set-av">${AVATAR}</span><span class="set-acct-t"><b>${esc(L.signIn)}</b><small>${esc(small ? L.sbxStatus : L.signInSays)}</small></span>${small ? '' : `<span class="set-chev">${CHEV}</span>`}`);
  b.type = 'button'; b.id = 'opt-signin'; b.onclick = () => openDoor();
  g.append(b);
}
function swatchRow(g, { inline = false } = {}) {
  const cur = NOW.accent() || DEFAULT_ACCENT, list = SWATCHES.includes(cur) ? SWATCHES : [cur, ...SWATCHES];
  const pal = node('div', 'set-pal' + (inline ? ' is-inline' : '')); pal.setAttribute('role', 'radiogroup'); pal.setAttribute('aria-label', L.accentL);
  for (const c of list) {
    const b = node('button', 'set-sw'); b.type = 'button'; b.style.setProperty('--sw', c);
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(c === cur)); b.setAttribute('aria-label', c); b.dataset.c = c;
    b.onclick = () => putSetting('accent', c === DEFAULT_ACCENT ? null : c);
    pal.append(b);
  }
  if (inline) { const r = node('div', 'set-r is-pal', `<span class="set-l">${esc(L.accentL)}</span>`); r.append(pal); g.append(r); return r; }
  const r = node('div', 'set-r is-pal'); r.append(pal); g.append(r); return r;
}
const accentReset = (g) => rowBtn(g, L.accentReset, { tone: 'act', id: 'opt-accent-0', disabled: !NOW.accent(), onClick: () => putSetting('accent', null) });
// the backdrop: a picture from the phone's library or an address, and taking it away
function backdropRows(g) {
  const v = NOW.backdrop(), src = v ? previewSrc(v) : '';
  if (src) g.append(node('div', 'set-shot', `<img src="${esc(src)}" alt="">`));
  const pick = node('label', 'set-r is-act', `<span class="set-l">${esc(L.bdPick)}</span>`);
  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true; fi.id = 'opt-bdfile';
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return;
    try {
      const a = await encodeImage(f);
      if (!a) { bdErr = T.assetTooBig; setPaint(); return; }
      bdErr = ''; pending[a.id] = { mime: a.mime, b64: a.b64 }; putSetting('backdrop', `asset:${a.id}`);
    } catch { bdErr = T.assetUnreadable; setPaint(); }
  };
  pick.append(fi); g.append(pick);
  const url = textInput('opt-bdurl', /^asset:/.test(v) ? '' : v, { type: 'url', mode: 'url', placeholder: 'https://…' });
  url.onchange = () => { bdErr = ''; putSetting('backdrop', url.value.trim() || null); };
  rowField(g, L.bdUrl, url);
  if (v) rowBtn(g, L.bdRemove, { tone: 'red', id: 'opt-bdoff', onClick: () => { bdErr = ''; putSetting('backdrop', null); } });
}
function viewsSwitches(g, vs) {
  for (const v of VIEW_IDS) {
    const on = vs.on.includes(v);
    rowSwitch(g, L.views[v], L.viewSays[v], on, (want) => putSetting('views', toggleView(vs, v, want)), { disabled: on && vs.on.length === 1, id: `opt-view-${v}` });
  }
}
// the default back — drawn, not described: the default back is a tile, so it shows as one. Out of the box it
// shows your name and a QR code; Replace puts any one tile there.
function backMini() {
  const d = defBack();
  const mini = d ? cardEl(d.cells.slice(0, 1), L.bcL, () => edit(-1, 'default'))
    : node('div', 'card printed', `<div class="bc-name"></div><div class="bc-qr" aria-hidden="true">${QRICO}</div>`);
  mini.classList.add('bc-mini');
  const n = mini.querySelector('.bc-name'); if (n) n.textContent = unq(fmNow().title).trim() || L.untitled;
  return mini;
}
function backAction() {
  if (defBack()) { const was = md; commit(dropDefault(clone())); confirmNote('done', L.toBcDone, backTo(was)); }
  else openPicker(0, { asDefault: true });   // the picker, then the new back's own sheet, open ABOVE settings
}
const backActLabel = () => (defBack() ? L.toBc : L.replaceBack);
function downloadMd() { const u = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); const x = document.createElement('a'); x.href = u; x.download = `${getHandle()}.md`; x.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
const askReplace = () => confirmDanger({ ask: L.replaceAsk, act: L.replaceGo, run: () => el('opt-file').click() });
const askReset = () => confirmDanger({ ask: L.resetAsk, act: PERSONA.reset, run: resetSandbox });

// ── the narrow shape's pages ──
const PAGES = {
  root(body) {
    if (SANDBOX) signInRow(sGroup(body, '', L.sbxStatus));
    { const g = sGroup(body, L.secName, nameFoot()); titleRow(g); addressRow(g);
      if (SANDBOX) rowBtn(g, L.domainL, { value: L.domainNone, chevron: true, id: 'opt-domain', onClick: () => setPush('domain') }); }
    { const g = sGroup(body, L.secLook);
      rowBtn(g, L.themeL, { value: L.themeNames[NOW.theme()], chevron: true, id: 'opt-theme', onClick: () => setPush('theme') });
      rowBtn(g, L.accentL, { valueHtml: dot(NOW.accent() || DEFAULT_ACCENT), chevron: true, id: 'opt-accent', onClick: () => setPush('accent') });
      rowBtn(g, L.backdrop, { value: NOW.backdrop() ? L.bdSet : L.bdNone, chevron: true, id: 'opt-backdrop', onClick: () => setPush('backdrop') });
      rowBtn(g, L.headerL, { value: L.headerNames[NOW.header()], chevron: true, id: 'opt-header', onClick: () => setPush('header') });
      rowBtn(g, L.iconsL, { value: L.iconsNames[NOW.icons()], chevron: true, id: 'opt-icons', onClick: () => setPush('icons') }); }
    { const g = sGroup(body, L.secViewsBack);
      rowBtn(g, L.viewsL, { value: viewsValue(), chevron: true, id: 'opt-views', onClick: () => setPush('views') });
      rowBtn(g, L.bcL, { value: backValue(), chevron: true, id: 'opt-back', onClick: () => setPush('back') }); }
    if (SANDBOX) { body.append(node('h3', 'set-gh', esc(L.secFound))); poolGroup(body); }
    { const g = sGroup(body, L.secMore);
      rowBtn(g, L.openRaw, { chevron: true, id: 'opt-raw', onClick: () => openRaw() });
      rowBtn(g, L.backupL, { chevron: true, id: 'opt-backup', onClick: () => setPush('backup') });
      if (SANDBOX) rowStatic(g, L.transferL, L.notYet, { id: 'opt-transfer' }); }
    if (SANDBOX) rowBtn(sGroup(body, '', L.resetSays), PERSONA.reset, { tone: 'red', id: 'opt-reset', onClick: askReset });
  },
  // The handle is the platform's (create_card reserves it; nothing in the file). The sandbox keeps a stand-in in
  // this browser so the change can be felt: the old address is let go at once, so the gate is the warning, and
  // the owner types the OLD address to let it go.
  address(body) {
    const h = getHandle();
    const nw = textInput('opt-hnew', h, { mode: 'url' });
    const g1 = sGroup(body, L.newHandle, L.handleSays, { id: 'opt-herr' }), foot = g1.nextElementSibling;
    rowField(g1, '', nw, { prefix: 'reef.cards/' });
    const old = textInput('opt-hold', '', { mode: 'url', placeholder: h });
    rowField(sGroup(body, fmt(L.typeOld, { o: h }), fmt(L.handleWarn, { o: h })), '', old);
    const go = rowBtn(sGroup(body, ''), L.doChange, { tone: 'act', id: 'opt-hgo', disabled: true });
    // what you type is what is saved: the address is lowercase, so the box is lowercased as you type
    const lower = (inp) => { const a = inp.selectionStart, b = inp.selectionEnd, v = inp.value.toLowerCase(); if (v !== inp.value) { inp.value = v; inp.setSelectionRange(a, b); } };
    const check = () => {
      lower(nw);
      // the box opens on the address you have: that is not a mistake yet, just nothing to change
      const v = nw.value.trim(), why = !v || v === h ? '' : !HANDLE_SHAPE.test(v) ? L.hShape : RESERVED.has(v.replace(/-/g, '')) ? L.hReserved : '';
      foot.textContent = why || L.handleSays; foot.classList.toggle('is-err', !!why);
      if (why) foot.setAttribute('role', 'alert'); else foot.removeAttribute('role');
      go.disabled = !v || v === h || !!why || old.value.trim().toLowerCase() !== h;
    };
    nw.oninput = old.oninput = check; check();
    go.onclick = () => {
      const v = nw.value.trim(); lsSet(HANDLE_KEY, v); setPop();
      confirmNote('done', fmt(L.handleDone, { h: v }), () => { lsSet(HANDLE_KEY, h); setPaint(); });
    };
  },
  domain(body) { rowBtn(sGroup(body, '', L.domainSays), L.connect, { tone: 'act', value: L.notYet, disabled: true, id: 'opt-connect' }); },
  theme(body) { choicePage(body, 'theme', L.themeAutoSays); },
  header(body) { choicePage(body, 'header'); },
  icons(body) { choicePage(body, 'icons'); },
  accent(body) { const g = sGroup(body, '', L.accentSays); swatchRow(g); accentReset(g); },
  backdrop(body) {
    backdropRows(sGroup(body, '', bdErr || L.backdropHint, { err: !!bdErr }));
    rowChecks(sGroup(body, L.dim, L.dimHint), L.dimAll, NOW.dim(), (v) => putSetting('backdrop-dim', v), L.dim);
  },
  views(body) {
    const vs = readViews(m.pre);
    viewsSwitches(sGroup(body, L.viewsLabel, L.viewsKeepOne), vs);
    if (vs.on.length > 1) rowChecks(sGroup(body, L.opensAs), Object.fromEntries(vs.on.map((v) => [v, L.views[v]])), vs.open, (v) => putSetting('views', { ...vs, open: v }), L.opensAs);
  },
  back(body) {
    const p = node('div', 'set-backview'); p.append(backMini()); body.append(p);
    body.append(node('p', 'set-foot is-centre', esc(L.dfSays)));
    rowBtn(sGroup(body, ''), backActLabel(), { tone: 'act', id: 'opt-df', onClick: backAction });
  },
  backup(body) {
    rowBtn(sGroup(body, '', L.backupSays), L.download, { tone: 'act', id: 'opt-dl', onClick: downloadMd });
    rowBtn(sGroup(body, '', bkErr || L.replaceSays, { err: !!bkErr, id: 'opt-bkerr' }), L.replaceFile, { tone: 'red', id: 'opt-up', onClick: askReplace });
  },
};
function choicePage(body, key, foot = '') {
  rowChecks(sGroup(body, '', foot), CHOICE_NAMES[key], NOW[key](), (v) => putSetting(CHOICE_KEY[key], v), PAGE_TITLE[key]);
}

// ── the wide shape's groups: the same rows, the simple choices inline ──
const GROUPS = {
  name(body) {
    const g = sGroup(body, '', SANDBOX ? L.handleSays : nameFoot()); titleRow(g); addressRow(g);
    if (SANDBOX) { const r = rowStatic(g, L.domainL); r.append(inlineBtn(L.connect, { disabled: true, title: L.notYet, id: 'opt-connect' })); }
  },
  look(body) {
    const g = sGroup(body, '');
    rowSelect(g, L.themeL, L.themeNames, NOW.theme(), (v) => putSetting('theme', v), 'opt-theme');
    const r = swatchRow(g, { inline: true });
    if (NOW.accent()) r.append(inlineBtn(L.accentReset, { id: 'opt-accent-0', onClick: () => putSetting('accent', null) }));
    rowSelect(g, L.headerL, L.headerNames, NOW.header(), (v) => putSetting('header', v), 'opt-header');
    rowSelect(g, L.iconsL, L.iconsNames, NOW.icons(), (v) => putSetting('icons', v), 'opt-icons');
    const b = sGroup(body, L.backdrop, bdErr || L.backdropHint, { err: !!bdErr });
    backdropRows(b);
    rowSelect(b, L.dim, L.dimAll, NOW.dim(), (v) => putSetting('backdrop-dim', v), 'opt-dim');
  },
  views(body) {
    const vs = readViews(m.pre), g = sGroup(body, L.viewsLabel, L.viewsKeepOne);
    viewsSwitches(g, vs);
    if (vs.on.length > 1) rowSelect(g, L.opensAs, Object.fromEntries(vs.on.map((v) => [v, L.views[v]])), vs.open, (v) => putSetting('views', { ...vs, open: v }), 'opt-opens');
    const b = sGroup(body, L.bcL, L.dfSays), r = node('div', 'set-r is-back');
    r.append(backMini(), inlineBtn(backActLabel(), { id: 'opt-df', onClick: backAction })); b.append(r);
  },
  found(body) { poolGroup(body); },
  more(body) {
    const g = sGroup(body, '');
    rowBtn(g, L.openRaw, { chevron: true, id: 'opt-raw', onClick: () => openRaw() });
    const r = rowStatic(g, L.backupL); r.append(inlineBtn(L.download, { id: 'opt-dl', onClick: downloadMd }));
    if (SANDBOX) rowStatic(g, L.transferL, L.notYet, { id: 'opt-transfer' });
    const d = sGroup(body, '', bkErr || (SANDBOX ? L.dangerSays : L.replaceSays), { err: !!bkErr, id: 'opt-bkerr' });
    rowBtn(d, L.replaceFile, { tone: 'red', id: 'opt-up', onClick: askReplace });
    if (SANDBOX) rowBtn(d, PERSONA.reset, { tone: 'red', id: 'opt-reset', onClick: askReset });
  },
};

// ── drawing ──
function navBar(backLabel, title) {
  const n = node('div', 'set-head set-nav', `<button type="button" class="set-back" id="set-back">${CHEVL}<span>${esc(backLabel)}</span></button><h2 class="set-nt">${esc(title)}</h2>`);
  n.querySelector('.set-back').onclick = setPop;
  return n;
}
function renderPage(pg, id) {
  const y = pg.scrollTop;
  pg.textContent = '';
  const head = id === 'root' ? node('div', 'set-head set-big', `<h2 id="set-title">${esc(L.options)}</h2>`) : navBar(L.settingsBack, PAGE_TITLE[id]);
  const body = node('div', 'set-body');
  pg.append(head, body); PAGES[id](body);
  swipeToClose(head);
  pg.scrollTop = y;
}
const livePages = () => [...setPages.children].filter((p) => p.classList.contains('set-pg') && !p.classList.contains('is-leaving'));
function paintNarrow() {
  let pages = livePages();
  if (pages.length !== setStack.depth || setPages.querySelector('.set-side')) {   // a fresh panel, or the shape changed
    setPages.textContent = '';
    pages = setStack.pages.map((id, k, all) => { const p = node('div', 'set-pg' + (k < all.length - 1 ? ' is-under' : '')); p.inert = k < all.length - 1; setPages.append(p); return p; });
    setStack.pages.forEach((id, k) => renderPage(pages[k], id));
    return;
  }
  renderPage(pages[pages.length - 1], setStack.top);
}
function paintWide() {
  const y = setPages.querySelector('.set-main')?.scrollTop || 0;
  setPages.textContent = '';
  const side = node('nav', 'set-side', `<div class="set-head set-side-top"><h2 id="set-title">${esc(L.options)}</h2></div>`);
  side.setAttribute('aria-labelledby', 'set-title');
  if (SANDBOX) signInRow(side, { small: true });
  for (const g of sidebarGroups({ sandbox: SANDBOX })) {
    const b = node('button', 'set-si'); b.type = 'button'; b.textContent = GROUP_NAME[g]; b.dataset.g = g;
    if (g === wideGroup) b.setAttribute('aria-current', 'true');
    b.onclick = () => { wideGroup = g; wideSub = null; paintWide(); setPages.querySelector(`.set-si[data-g="${g}"]`)?.focus(); };
    side.append(b);
  }
  const main = node('div', 'set-main'), body = node('div', 'set-body');
  setPages.append(side, main);   // in the document before the rows are built: a row may look its neighbours up
  if (wideSub) { main.append(navBar(GROUP_NAME[wideGroup], PAGE_TITLE[wideSub]), body); PAGES[wideSub](body); }
  else { main.append(node('h2', 'set-ttl', esc(GROUP_NAME[wideGroup])), body); GROUPS[wideGroup](body); }
  main.scrollTop = y;
}
// a repaint keeps the field that had focus (a value written while you type must not take the caret away)
function setPaint() {
  if (setLayer.hidden) return;
  const a = document.activeElement, fid = a && setPanel.contains(a) && a.id, sel = fid && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  const was = setLayout; setLayout = wideMQ.matches ? 'wide' : 'narrow';
  if (was !== setLayout) { setStack.reset('root'); wideSub = null; }
  setPanel.dataset.layout = setLayout;
  if (setLayout === 'wide') paintWide(); else paintNarrow();
  if (fid) { const n = el(fid); if (n && setPanel.contains(n)) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } } }
}
wideMQ.addEventListener('change', () => { closeConfirm(); setPaint(); });
const slideDone = (fn) => (calm.matches ? fn() : requestAnimationFrame(() => requestAnimationFrame(fn)));
// narrow: a page slides in from the right over the one it came from; wide: it replaces the group's rows
function setPush(id) {
  if (setLayout === 'wide') { wideSub = id; paintWide(); el('set-back')?.focus({ preventScroll: true }); return; }
  const cur = livePages().at(-1); setStack.push(id);
  const pg = node('div', 'set-pg is-off'); setPages.append(pg); renderPage(pg, id);
  if (cur) cur.inert = true;   // the page underneath is out of reach until Back
  slideDone(() => { pg.classList.remove('is-off'); cur?.classList.add('is-under'); });
  pg.querySelector('.set-back')?.focus({ preventScroll: true });
}
function setPop() {
  if (setLayout === 'wide') { wideSub = null; paintWide(); return; }
  if (setStack.depth < 2) return;
  const pages = livePages(), top = pages.at(-1), prev = pages.at(-2);
  setStack.pop(); renderPage(prev, setStack.top);
  top.classList.add('is-leaving', 'is-off'); top.inert = true; prev.inert = false; prev.classList.remove('is-under');
  setTimeout(() => top.remove(), calm.matches ? 0 : 360);
}
function openSettings() {
  pending = {}; bdErr = ''; bkErr = ''; wideGroup = 'name'; wideSub = null; setStack.reset('root');
  setLayer.classList.remove('is-closing'); setPanel.style.removeProperty('--set-from');
  setPages.textContent = ''; setLayer.hidden = false;
  setPaint(); setPanel.focus({ preventScroll: true });
  notices.place();
}
// slides back down (and the glass fades) before the layer goes; at once when motion is reduced
function closeSettings({ from = 0 } = {}) {
  if (setLayer.hidden || setLayer.classList.contains('is-closing')) return;
  flushSetting(); closeConfirm();
  const done = () => { clearTimeout(t); setLayer.removeEventListener('animationend', onEnd); setLayer.classList.remove('is-closing'); setLayer.hidden = true; setPanel.style.transform = ''; notices.place(); el('cardset').focus({ preventScroll: true }); };
  const onEnd = (e) => { if (e.target === setPanel) done(); };
  let t = 0;
  if (calm.matches) { done(); return; }
  setPanel.style.setProperty('--set-from', `${from}px`); setPanel.style.transform = '';
  setLayer.classList.add('is-closing');
  setLayer.addEventListener('animationend', onEnd); t = setTimeout(done, 450);
  notices.place();
}
// a downward swipe on the panel's header closes it, the same as ✕ (the header follows the finger meanwhile)
function swipeToClose(head) {
  let s = null;
  head.addEventListener('pointerdown', (e) => {
    if (setLayout !== 'narrow' || e.button > 0 || e.target.closest('button,input,select,a')) return;
    s = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { head.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  });
  head.addEventListener('pointermove', (e) => { if (!s || e.pointerId !== s.id) return; const dy = Math.max(0, e.clientY - s.y); setPanel.style.transform = dy ? `translateY(${dy}px)` : ''; });
  head.addEventListener('pointerup', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y; s = null;
    if (swipeCloses(dx, dy)) closeSettings({ from: Math.max(0, dy) }); else setPanel.style.transform = '';
  });
  head.addEventListener('pointercancel', () => { s = null; setPanel.style.transform = ''; });
}
// a destructive action asks first: an action sheet from the bottom of the panel (narrow), a centred alert (wide)
function confirmDanger({ ask, act, run }) {
  const shape = confirmShape(setLayout);
  setConfirm.className = `set-confirm is-${shape}`;
  setConfirm.innerHTML = shape === 'sheet'
    ? `<div class="set-sheet" role="alertdialog" aria-modal="true" aria-labelledby="set-ask"><div class="set-sheet-box"><p id="set-ask">${esc(ask)}</p><button type="button" class="set-sheet-go" id="set-go">${esc(act)}</button></div><button type="button" class="set-sheet-no" id="set-no">${esc(L.cancel)}</button></div>`
    : `<div class="set-alert" role="alertdialog" aria-modal="true" aria-labelledby="set-ask"><p id="set-ask">${esc(ask)}</p><div class="set-alert-acts"><button type="button" id="set-no">${esc(L.cancel)}</button><button type="button" class="is-red" id="set-go">${esc(act)}</button></div></div>`;
  setConfirm.hidden = false;
  el('set-no').onclick = closeConfirm;
  el('set-go').onclick = () => { closeConfirm(); run(); };
  el('set-no').focus();
}
function closeConfirm() { if (setConfirm.hidden) return; setConfirm.hidden = true; setConfirm.textContent = ''; }
setConfirm.addEventListener('click', (e) => { if (e.target === setConfirm) closeConfirm(); });
setLayer.addEventListener('click', (e) => { if (e.target === setLayer) closeSettings(); });   // the glass beside a wide panel
// a file replaces the DRAFT, never what is saved: it still needs Save, like any other change
el('opt-file').onchange = async () => {
  const f = el('opt-file').files[0]; if (!f) return; let t = await f.text(); el('opt-file').value = '';
  const wrong = whatIsWrong(t);
  if (wrong) { bkErr = fmt(L.badFile, { n: wrong.line }); setPaint(); return; }
  bkErr = '';
  if (!t.endsWith('\n')) t += '\n';
  const was = md, before = m.cells.length;
  closeSettings();
  md = t; m = read(md); persist(); cache.clear(); draw(); show();
  confirmNote('replaced', fmt(L.replaced, { a: before, b: m.cells.length }), backTo(was));
};
// one setting → the draft, at once
function putSetting(name, value, { repaint = true } = {}) {
  const x = clone(); x.pre = applySetting(x.pre, name, value);
  if (Object.keys(pending).length) { x.assets = { ...(x.assets || {}), ...pending }; pending = {}; }
  cache.clear(); commit(x, { settings: repaint });
}
let settingTimer = 0, settingNext = null;
const putSoon = (name, value) => { clearTimeout(settingTimer); settingNext = [name, value]; settingTimer = setTimeout(flushSetting, 450); };
function flushSetting() { clearTimeout(settingTimer); const n = settingNext; settingNext = null; if (n) putSetting(n[0], n[1], { repaint: false }); }
// the sandbox's stand-in for the platform's pool switch: this browser only, never the file
const PKEY = 'cardtile:w3:pool', poolOn = () => lsGet(PKEY) !== 'off';
// The handle is the platform's (create_card reserves it; nothing in the file). In host mode it is the real Card's
// and is shown as it is; the sandbox keeps a stand-in in this browser (see PAGES.address).
const HANDLE_KEY = 'cardtile:w3:handle', HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]{0,38}$/;
// a sample of the platform's reserved names, so the sandbox's stand-in can say no the way the real one does
const RESERVED = new Set('cards card reef feelreef cver try edit draw pool random www api mcp admin support help login signup dashboard about terms privacy official security billing account settings static assets'.split(' '));
const getHandle = () => (SANDBOX ? lsGet(HANDLE_KEY) || 'yourname' : handle || 'card');
function resetSandbox() {
  settingNext = null; closeSettings();   // first: a title typed a moment ago must not land on the empty card
  lsSet(KEY, null); lsSet(DKEY, null); lsSet(W2_DRAFT_KEY, null);
  savedMd = SANDBOX_START; md = SANDBOX_START; m = read(md); cache.clear();
  persist(); draw(); show();
}
el('cardset').onclick = openSettings;
el('modal-save').onclick = () => (open && open.whole ? saveRaw() : saveSheet());
el('modal-delete').onclick = deleteSheet;

// ── a tile up close ──
const zoom = el('zoom');
// a link or a video turns over to its address, not to the default back (deck.js decides the same way)
const isAddress = (cell) => cell.type === 'link' || cell.type === 'video' || (cell.type === 'feature' && /^https?:/.test(String((cell.params || {}).href || '')));
function zoomPair(it, startBack = false) {
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
  if (startBack && backCells) flip.classList.add('over');
}

// ── ONE GLASS LAYER for anything opened: the whole screen, the top bar included, goes under frosted glass, and
// only the glass's ✕ floats above it — at the top-left, where the logo is, whichever layer is open (a tile's sheet,
// the picker, Cards settings, the door, a tile up close). ✕, Escape and a tap on the bare glass close the TOP-MOST
// layer first (w3/settings-nav.mjs topLayer). The small leave dialog has its own three answers and no ✕.
const isOpen = (id) => (id === 'settings' ? setOpen() : !el(id).hidden);
const openNow = () => Object.fromEntries(LAYER_TOP_FIRST.map((id) => [id, isOpen(id)]));
function dismiss() {
  switch (topLayer(openNow())) {
    case 'leavemodal': el('leavemodal').hidden = true; break;   // Escape there is Keep editing
    case 'zoom': zoom.hidden = true; break;
    case 'modal': closeSheet(false); break;
    case 'picker': el('picker').hidden = true; break;
    case 'doormodal': el('doormodal').hidden = true; break;
    case 'set-confirm': closeConfirm(); break;
    case 'settings': closeSettings(); break;
    default: break;
  }
}
el('close').onclick = dismiss;
addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
zoom.onclick = (e) => { if (e.target === zoom) dismiss(); };
for (const id of ['modal', 'picker', 'doormodal', 'leavemodal']) el(id).addEventListener('click', (e) => { if (e.target === el(id)) dismiss(); });
// ✕ sits where the logo is: the bar's own row, the lockup's left edge (the top notice, when shown, moves both down).
// --bar-bottom is where the bar ends: a sheet or the settings panel never reaches above it, so ✕ is never covered.
const bar = document.querySelector('header');
function placeClose() {
  const c = el('close'), hd = bar.getBoundingClientRect(), lk = el('lockup').getBoundingClientRect();
  c.style.top = `${Math.max(0, hd.top) + Math.max(0, (hd.height - 44) / 2)}px`;
  c.style.left = `${Math.max(8, lk.left)}px`;
  document.documentElement.style.setProperty('--bar-bottom', `${Math.max(0, Math.round(hd.bottom))}px`);
}
new ResizeObserver(placeClose).observe(bar);
new ResizeObserver(placeClose).observe(el('notice-top'));
addEventListener('resize', placeClose);
// watch the layers only (the button's own `hidden` is a mutation too — watching the body loops forever)
const closeObs = new MutationObserver(() => {
  const none = !closeShows(openNow());
  if (el('close').hidden !== none) el('close').hidden = none;
  placeClose(); notices.place();
});
for (const id of LAYER_TOP_FIRST) closeObs.observe(el(id), { attributes: true, attributeFilter: ['hidden', 'class'] });
placeClose();

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
    /* outlines sit INSIDE each tile, so two neighbours' frames never overlap */
    .lay-mv{cursor:grab;touch-action:pan-y}html.lay-dragging,html.lay-dragging *{cursor:grabbing!important}
    .lay-mv{outline:2px dashed ${ac};outline-offset:-2px;transition:outline-color .12s}
    @media (hover:hover){.lay-mv:hover{outline-style:solid}}.lay-mv.lay-on{outline:3px solid ${ac};outline-offset:-3px}
    .lay-p{display:none;position:absolute;z-index:2147483000;transform:translate(-50%,-50%);width:34px;height:34px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:999px;background:#fff;border:2px solid ${ac};color:${ac};cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.15)}.lay-p svg{width:15px;height:15px}.lay-p.lay-show{display:flex}.lay-p::after{content:"";position:absolute;inset:-5px}
    .lay-ghost{opacity:1!important;outline:2px dashed ${ac}!important}.lay-ghost>*{visibility:hidden!important}
    .sortable-fallback{opacity:1!important;background:var(--lay-bg,#fff)!important;overflow:hidden!important;box-shadow:0 18px 40px rgba(0,0,0,.22)!important}
    .lay-h{display:none;position:absolute;transform:translate(-50%,-50%);min-width:34px;height:30px;padding:0 8px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:999px;background:#fff;border:2px solid ${ac};color:${ac};font:700 15px/1 system-ui,-apple-system,sans-serif;white-space:nowrap;cursor:ew-resize;z-index:2147483000;touch-action:none;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    .lay-h::after{content:"";position:absolute;inset:-7px 0 -7px -6px}html .lay-h:focus{outline:none;border-radius:999px}html .lay-h:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,${ac} 35%,transparent)}
    .lay-h.lay-show{display:flex}html.lay-sizing .lay-h{background:${ac};color:#fff}html.lay-sizing,html.lay-sizing *{cursor:ew-resize!important;user-select:none}</style>
    <script src="${esc(ASSET['Sortable.min.js'] || '')}"><\/script>`;
  f.onload = () => {
    const w = f.contentWindow, d = f.contentDocument; if (!d) return;
    // the tile being dragged is drawn on the page's own ground, opaque: its words never overprint another's
    { const bg = (n) => getComputedStyle(n).backgroundColor, clear = (c) => !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c);
      const g = [d.body, d.documentElement].map(bg).find((c) => !clear(c)) || '#fff'; d.documentElement.style.setProperty('--lay-bg', g); }
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
  // 🔴 the pencil is at the tile's TOP-LEFT, as on the row; the width handle sits just inside the RIGHT edge, so
  // it never lies over the pencil or over the neighbour (its hit area grows outward only along the edge)
  p.style.left = `${r.left + 6 + v.scrollX}px`; p.style.top = `${r.top + 6 + v.scrollY}px`;   // on the corner, clear of the words
  if (!c.classList.contains('lay-ok')) return;
  labelWidth(c, h);
  const hw = h.offsetWidth || 34;
  h.style.left = `${Math.max(r.left + 30 + hw / 2, r.right - hw / 2 - 4) + v.scrollX}px`;
  h.style.top = `${r.top + Math.max(r.height / 2, Math.min(r.height - 15, 54)) + v.scrollY}px`;
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
    b.hidden = !on.includes(b.dataset.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
}
// the whole file's raw content is the same sheet as one tile's (one idea at two scopes): Done keeps it if the
// engine can still read every tile, Close leaves the file as it was, and either way you are back where you were
function openRaw() {
  el('modal-title').textContent = L.raw;
  el('modal-hint').textContent = L.rawSays;
  open = { whole: true }; pending = {};
  el('modal-title').textContent = L.raw;
  el('modal-hint').textContent = L.rawSays;
  el('modal-body').innerHTML = `<div class="ctw-field" data-field="__raw"><textarea id="f-__raw" class="ctw-md whole" spellcheck="false"></textarea><p class="ctw-err" id="e-__raw" role="alert"></p></div>`;
  el('modal-body').oninput = el('modal-body').onchange = null;
  el('f-__raw').value = md;
  el('modal-foot').hidden = false; el('modal-why').textContent = '';
  el('modal-delete').hidden = true; el('modal-save').disabled = false;
  el('modal').hidden = false; el('f-__raw').focus();
}
function saveRaw() {
  const t = el('f-__raw').value;
  if (t !== md) {
    const wrong = whatIsWrong(t);   // the engine's own guard: no way out of here having quietly lost a tile
    if (wrong) { el('e-__raw').textContent = fmt(L.badFile, { n: wrong.line }); el('f-__raw').focus(); return; }
    md = t.endsWith('\n') ? t : t + '\n'; m = read(md);
    persist();
    cache.clear();
  }
  closeSheet(true);
  draw(); show(); setPaint();
}
function show() {
  if (!hostWaiting && !m.cells.length && view !== 'wall') editing = true;   // nothing to look at yet: the row's one big "+"
  paintViews(); paintMain();
  if (hostWaiting) return;
  const pane = view === 'wall' ? 'layout' : editing ? 'edit' : 'preview';
  for (const id of ['preview', 'edit', 'layout']) el(id).hidden = id !== pane;
  if (pane === 'edit') edges();
  if (pane === 'layout') paintLayout(); else picked = null;
  if (pane === 'preview') {   // what a visitor gets in this view: the live page's own deck, opened on this view
    lsSet('reef-card-layout', null);   // the deck remembers a visitor's last pick; the editor names the view instead
    // the sandbox always says its pool switch out loud (true unless set off): deck.js counts only `true` as in the
    // pool, so a page that says nothing — host mode today, until the platform side exists — shows no reef.cards card
    el('deckframe').srcdoc = renderCardHTML(md, { handle, deck: { view, ...(SANDBOX ? { pool: poolOn() } : {}) } });
  }
}
// The row and the wall are edit mode. Going from either to a view a visitor gets, with something unsaved, asks
// first — Save / Keep editing / Discard (w3/leave-edit.mjs). Row ⇄ wall is not leaving.
function goView(v) {
  const go = () => { editing = false; view = v; show(); };
  if (leaveStep({ dirty: dirty(), editing: editing || view === 'wall', toEditing: v === 'wall' }) === 'go') { go(); return; }
  const answer = (choice) => {
    el('leavemodal').hidden = true;
    const r = resolveLeave(choice, { md, savedMd });
    if (choice === 'discard') { md = r.md; m = read(md); cache.clear(); persist(); draw(); }
    if (r.save) doSave();
    if (r.leave) go();
  };
  el('leave-save').onclick = () => answer('save');
  el('leave-keep').onclick = () => answer('keep');
  el('leave-discard').onclick = () => answer('discard');
  el('leavemodal').hidden = false; el('leave-save').focus();
}
for (const b of document.querySelectorAll('.modes button')) b.onclick = () => goView(b.dataset.view);
// the main action, far right: Edit while looking; Save while editing (and on the wall, which is always editable).
// 🔴 ONE RULE for Save, everywhere: it can be pressed only when there is something to save.
const SAVE_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let saving = false;
function paintMain() {
  const b = el('editbtn'); if (!b) return;
  const inEdit = editing || view === 'wall';
  const unsaved = !hostWaiting && dirty();
  // the unsaved dot: something in the draft is not saved yet (a change made in Cards settings shows here too)
  b.innerHTML = (inEdit ? SAVE_ICO + esc(L.save) : PEN + esc(L.editBtn)) + (unsaved ? `<span class="hd-dot"><span class="sr">${esc(L.leaveTitle)}</span></span>` : '');
  b.disabled = hostWaiting || saving || (inEdit && !dirty());
  b.classList.toggle('is-save', inEdit);
  b.classList.toggle('is-dirty', unsaved);
}
// sandbox: there is no account behind /try/edit, so Save keeps the draft in this browser and opens the door to
// the real thing (the creation flow explains the account; the editor does not). host: the parent saves it.
function doSave() {
  if (SANDBOX) { savedMd = md; lsSet(KEY, md); persist(); openDoor(); return; }
  if (bridge && bridge.save()) { saving = true; paintMain(); }
}
el('editbtn').onclick = () => {
  if (editing || view === 'wall') {
    if (!dirty()) return;
    doSave();
    if (m.cells.length && view !== 'wall') editing = false;
    show(); return;
  }
  let at = 0; try { at = el('deckframe').contentWindow.__deckCur?.() || 0; } catch { /* the frame is not ready */ }
  editing = true; show();
  const s = row.querySelectorAll('.slot')[Math.min(at, m.cells.length)];
  requestAnimationFrame(() => s && s.scrollIntoView({ inline: 'center', block: 'nearest' }));
};
// the assistant palette behind ⌘K and the sparkle button: a stand-in that changes nothing
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

// ── the sandbox: Save's door toward the real creation flow ──
// The card is parked (the WHOLE card travels) and the creation flow opens with it. 🔴 Nothing clears the draft
// here: a visitor who does not finish signing up comes back to it.
function openDoor() { el('doormodal').hidden = false; el('door-go').disabled = false; el('door-go').focus(); }
function bootSandbox() {
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
}

// ── host mode: the card arrives from the parent and Save goes back to it (w3/host-bridge.mjs) ──
// Until `card:load` the editor's controls are inert and the top notice says what it is waiting for; a page
// that never answers gets a sentence and a Reload, not a blank screen.
const INERT = () => [el('cardset'), document.querySelector('.modes'), el('editbtn'), el('seek'), el('preview'), el('edit'), el('layout')];
function hostStatus(status, message) {
  if (status === 'waiting') notices.show(bridge && bridge.gaveUp ? 'loadFailed' : 'waiting', bridge && bridge.gaveUp ? L.hostLoadFailed : L.hostWaiting,
    bridge && bridge.gaveUp ? { label: L.reload, run: () => location.reload() } : null);
  else if (status === 'saving') notices.show('saving', L.hostSaving);
  else if (status === 'failed') notices.show('failed', message ? `${L.hostFailed}${L.colon}${message}` : L.hostFailed);
  else notices.clear('top');
}
function bootHost() {
  el('lockup').target = '_top';
  document.body.dataset.hostWaiting = '1';   // nothing to edit until the parent hands a card over
  for (const n of INERT()) n.inert = true;
  bridge = createHostBridge({
    host: HOST,
    post: (msg, origin) => window.parent.postMessage(msg, origin),
    onStatus: (status, message) => {
      hostStatus(status, message);
      if (status === 'saved' || status === 'unsaved' || status === 'failed') {
        const wasSaving = saving; saving = false;
        if (wasSaving && status !== 'failed') { savedMd = bridge.savedMd; persist(); confirmNote('saved', L.savedLive); }
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
      for (const n of INERT()) n.inert = false;
      notices.clear('top');
      m = read(md); cache.clear(); undoTo = null; editing = false;
      { const fm = fmRead(m.pre); if (VIEW_IDS.includes(fm.view)) view = fm.view; }
      persist(); draw(); show();
    },
    onPropose: ({ md: next }) => {
      // a suggestion becomes the draft — shown, dirty, never saved by itself
      if (!el('modal').hidden) closeSheet(true);
      el('picker').hidden = true; zoom.hidden = true;
      md = next.endsWith('\n') ? next : next + '\n'; m = read(md);
      cache.clear(); undoTo = null;
      persist(); draw(); show(); setPaint();
      confirmNote('proposed', L.proposed);
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
