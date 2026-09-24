// cardtile-w2 — the public Card sandbox with the TUGTILE BOARD as its editing table. Served at the
// official path `/try/edit` since the 2026-09-06 re-review ruled "換上正式路徑"; this module and its
// generated bundle kept the `edit2`/`w2` names they were built under (staged beside the ORIGINAL
// `/try/edit`, a palette down one side and a static preview down the other, since retired).
//
// Owner ruling, 2026-09-06 (#32): the original sandbox had bad UX — a palette down one side and a
// static preview down the other. Rebuild it as A+C: REUSE tugtile, do not imitate it.
//
// ── WHAT IS INHERITED, AND FROM WHERE ────────────────────────────────────────────────────────────
//
// The left pane is an iframe carrying `engine/hosts/web/tugtile/index.html` — the engine's own
// browser tugtile, unmodified, driven through its published entry point `window.__load(md)`. Every
// board behaviour is ITS code running: the lane chrome, the tile chrome and its grip, SortableJS
// drag with the touch delay, arrow-key tugging between lanes, the three-cycle fold, lane collapse,
// search, the board/table view cycle, the lock. This file adds none of that and re-implements none
// of it.
//
// What this file owns is everything that is about a CARD rather than a board:
//   · the card markdown, which is the SSOT (card-core) — the board never writes a byte of it;
//   · the seven typed sheets (w/cell-form-core.mjs, shared with the retired original editor);
//   · 「＋加一張牌」, the one-row icon picker at the end of a lane;
//   · the words saying which tile opens which drawer (labels, not lines — ruling 2026-09-24);
//   · the live preview, the door, the banner, Markdown mode.
//
// ── HOW THE TWO TALK ─────────────────────────────────────────────────────────────────────────────
//
// Down:  md → boardMd() → `__load()`. A SUMMARY of each cell (see board-bridge), never the raw
//        `%% card: … %%` line — the board's own text editor has never heard of a Card marker and
//        must never be handed one.
// Up:    a MutationObserver on the lists notices any move (drag, arrow key, tugtile's own undo) and
//        reads the board's ORDER back as a permutation, which card-core applies. Nothing else
//        crosses: a tile's content only ever changes through a sheet in THIS document.
//
// 🔴 THE INTERCEPTS ARE CAPTURE-PHASE, ON THE IFRAME'S DOCUMENT. The engine's host binds its click
// handler on `#board` in the bubble phase, so a capture listener on its `document` runs first and
// `stopPropagation()` decides. That is the whole mechanism — no fork, no patched copy, no build step
// that rewrites somebody else's file. What it costs is that this list has to be complete, which is
// why every intercepted control is named here with what it does instead.
import { parseCard, serializeCard, normalizeCell, reorder, setTitle } from '../card-core.js';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { CELL_TYPES, blankCell, PALETTE, CONTROL, DISPOSITION } from '../ai-ops.mjs';
import { esc, flatRows, formBodyHtml, composeCell } from '../w/cell-form-core.mjs';
import { whatIsWrong } from '../w/md-guard.mjs';
import { CELL_STRINGS_ZH, cellStrings, text as tx } from '../w/cell-i18n.mjs';
import { buildSandboxCard, chromeStrings, primaryLocale, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { sandboxDoorHref, parkSandboxCard } from '../w/sandbox-door.mjs';
import { createHostBridge, validHostOrigin } from './host-bridge.mjs';
import { boardStrings, colon, addTileLabel } from './board-i18n.mjs';
import { typeIconSvg } from './type-icons.mjs';
import {
  boardLanes, boardSlots, boardMd, applyBoardOrder, drawerLinks, drawerLabels, BOARD_LIGHT_CSS, cardTitle, tileFace,
  slotOfRenderedCell, laneKeyForCardAdd, cardDropOrder,
} from './board-bridge.mjs';
// the icon ROUTE, and the guard on what may reach it — the same pair the renderer uses, so a mark
// on the table and the same mark on the card are one request to one path.
import { iconPath, ICON_DOMAIN_RE } from '../marks.mjs';

const el = (id) => document.getElementById(id);

// the editor's view of the shared definition: types, with only the params that asked for a control
const TYPES = Object.fromEntries(Object.entries(CELL_TYPES).map(([type, def]) => [type, {
  ...def,
  fields: Object.entries(def.params).filter(([, p]) => p.disposition === DISPOSITION.FORM).map(([name, p]) => ({ name, ...p })),
}]));

let T = chromeStrings('en');      // the editor chrome, in the visitor's language
let TX = CELL_STRINGS_ZH;         // the seven tile kinds and their fields
let TB = boardStrings('en');      // this surface's own handful of strings
let COLON = colon('en');          // the mark between a label and its value, in this script
const say = (key) => tx(TX, key);

// ── state ────────────────────────────────────────────────────────────────────────────────────────
//
// `md` is the truth; `model` is a projection rebuilt on every change, so the two can never disagree.
const S = {
  md: '',
  model: null,
  locale: 'en',
  sandbox: false,
  handle: 'try',
  cardUrl: '',
  host: '',             // HOST MODE: the parent origin (feelreef) — see host-bridge.mjs
  bridge: null,
  tableBase: '',
  undo: [],
  // slot ↔ the board's own `data-tid`. Invariant: immediately after `__load`, tid n is slot n,
  // because the host pushes tiles onto one flat array in the reading order of the md we gave it.
  slotOfTid: [],
  wired: false,          // the iframe document's intercepts are installed once per LOAD
  syncing: false,        // suppress the observer while WE are the ones rewriting the board
  addLane: null,         // which lane 「＋加一張牌」 was pressed in
  openSlot: null,        // the tile whose sheet is open
  pendingAssets: {},
};

const SANDBOX_STORAGE_KEY = 'cardtile:try:draft:v1';
const readDraft = () => { try { return (typeof window !== 'undefined' && window.localStorage.getItem(SANDBOX_STORAGE_KEY)) || ''; } catch { return ''; } };
const writeDraft = (md) => { try { if (typeof window !== 'undefined') window.localStorage.setItem(SANDBOX_STORAGE_KEY, md); } catch { /* best-effort */ } };
export const clearDraft = () => { try { if (typeof window !== 'undefined') window.localStorage.removeItem(SANDBOX_STORAGE_KEY); } catch { /* best-effort */ } };

/** everything board-bridge needs to speak the visitor's language */
const bridgeCtx = () => ({
  faceLabel: T.faceTabLabel,
  title: cardTitle(S.md),
  typeName: (t) => (TYPES[t] ? say(TYPES[t].title) : t),
  opensLabel: TB['board.opensLabel'],
  drawerTitle: (id) => {
    const d = (S.model.drawers || []).find((x) => x.id === id);
    return d ? (d.title || d.id) : '';           // '' → the subtitle reads 「⚠ id」 (dangling)
  },
  // what the RENDERER writes on a tile whose address or picture is not filled in yet. The table
  // says the same sentence, because the tile is a mini-render of that element and not a label for it.
  unsetLink: T.linkUnset,
  unsetImg: T.imgUnset,
});

/** everything cell-form-core needs from THIS surface */
const formCtx = () => ({ T, say, targetOptions, previewSrc, cardTitle: cardTitle(S.md) });

// ── the one place the model changes ──────────────────────────────────────────────────────────────
//
// `reloadTable: false` is for a change the board ALREADY made to itself — a drag, an arrow key. The
// DOM is right; re-loading it would throw away the animation, the focus and the scroll position to
// arrive at the arrangement already on screen.
function commit(nextMd, { undoable = true, reloadTable = true } = {}) {
  if (undoable) S.undo.push(S.md);
  S.md = nextMd;
  S.model = parseCard(S.md);
  if (S.sandbox) writeDraft(S.md);
  if (S.bridge) S.bridge.changed(S.md);        // host mode: every commit is a change the parent hears of
  paintPreview();
  if (reloadTable) loadTable();
  else decorate();                                  // the drawer labels can change without the order changing
}

/** mutate the model through a callback, then serialize. Never build markdown by hand. */
const edit = (fn) => {
  const next = fn(structuredClone({ ...S.model }));
  commit(serializeCard(next));
};

// ── the preview: the card itself, not a picture of it ────────────────────────────────────────────
//
// 🩸 AND CLICKING A DRAWER BUTTON IN IT LOADED THE WHOLE EDITOR INTO THE PREVIEW PANE. Cold read
// 2026-09-06, P1-1, reproduced at 390 and 1280 in all three languages: the preview is a `srcdoc`
// iframe, so its document URL is `about:srcdoc` and a bare fragment resolves against the PARENT's
// url — 「預約」 renders as `href="#更多"` and the browser dutifully navigated the pane to
// `/try/edit2#更多`. A second banner, a second masthead, a second board, inside the preview.
//
// 🔴 The fix is a guard that travels WITH the document, not a listener attached from out here after
// it loads. `srcdoc` is re-set on every commit, so a wiring race would be a race we run dozens of
// times a session; a script appended to the html cannot lose it. It never reaches a live card —
// this is the editor's own preview, the same place `editStrings` already only exists.
//
// What it does, in the three cases a card's own links have:
//   `#<drawer>`  opens that drawer IN THE PREVIEW. A drawer is `:target`, which is a URL mechanism
//                and therefore the one thing a srcdoc document cannot have — so the panel is opened
//                by marking it, and the marked-open rules are DERIVED from the card's own `:target`
//                rules at run time rather than written a second time here.
//   `#`          closes it (the scrim and the ✕ are both `href="#"`).
//   http(s)      a new tab. The preview is a card, and its links are the author's real ones.
//   anything else — refused, rather than navigating a pane that has no way back.
const PREVIEW_GUARD = `<script>(function(){
  var OPEN='data-preview-open';
  function mirror(){
    var sheets=[].slice.call(document.styleSheets);
    for(var i=0;i<sheets.length;i++){
      var rules; try{rules=sheets[i].cssRules}catch(e){continue}
      if(!rules) continue;
      var add=[];
      (function walk(list,parent){
        for(var j=0;j<list.length;j++){
          var r=list[j];
          if(r.cssRules&&r.type!==1){walk(r.cssRules,r);continue}
          if(r.selectorText&&r.selectorText.indexOf(':target')!==-1)add.push([parent||sheets[i],r.cssText]);
        }
      })(rules,null);
      for(var k=0;k<add.length;k++){
        var host=add[k][0],text=add[k][1].replace(/:target/g,'['+OPEN+']');
        try{host.insertRule(text,(host.cssRules||[]).length)}catch(e){}
      }
    }
  }
  function open(id){
    var panels=document.querySelectorAll('[data-drawer-panel]');
    for(var i=0;i<panels.length;i++)panels[i].removeAttribute(OPEN);
    if(!id)return true;
    var p=document.querySelector('[data-drawer-panel="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
    if(!p)return false;
    p.setAttribute(OPEN,'');
    return true;
  }
  function hint(text){
    var n=document.getElementById('ct2-preview-hint');
    if(!n){n=document.createElement('div');n.id='ct2-preview-hint';
      n.setAttribute('style','position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;'
        +'max-width:88%;padding:8px 14px;border-radius:999px;font:600 13px/1.4 system-ui,sans-serif;'
        +'text-align:center;background:rgba(20,20,20,.92);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.3)');
      document.body.appendChild(n);}
    n.textContent=text;
    clearTimeout(n._t);n._t=setTimeout(function(){n.remove()},2600);
  }
  function outward(){
    var as=document.querySelectorAll('a[href]');
    for(var i=0;i<as.length;i++){
      var h=as[i].getAttribute('href')||'';
      if(/^https?:/i.test(h)){as[i].target='_blank';as[i].rel='noopener noreferrer';}
    }
  }
  mirror();outward();
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href]');
    if(!a)return;
    var href=a.getAttribute('href')||'';
    if(href.charAt(0)==='#'){
      e.preventDefault();
      if(!open(href.slice(1)))hint(window.__CT2_HINT__.dangling);
      return;
    }
    if(/^(https?:|mailto:|tel:)/i.test(href)){a.target='_blank';a.rel='noopener noreferrer';return;}
    e.preventDefault();
  },true);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')open('')});
})();<\/script>`;

function paintPreview() {
  const frame = el('canvas');
  if (!frame) return;
  frame.srcdoc = renderCardHTML(S.md, {
    handle: S.handle,
    cardUrl: S.cardUrl,
    // `data-cell` on every cell, so a tap ON THE CARD can open that cell's sheet (wireCard below).
    // Stripping it reproduces the production bytes — verify/editor.mjs holds that line.
    editIndex: true,
    // the two EDIT-ONLY placeholders the renderer draws for a tile whose address or picture is not
    // filled in yet — handed in from here because this side speaks nine locales and card-render's
    // own table deliberately speaks four.
    editStrings: { linkUnset: T.linkUnset, imgUnset: T.imgUnset },
  })
    // the guard's one sentence, in the visitor's language — the same nine-locale string the table's
    // own dangling badge carries, because it is the same fact said in the other pane.
    + `<script>window.__CT2_HINT__=${JSON.stringify({ dangling: TB['board.danglingDrawer'] })}<\/script>`
    + PREVIEW_GUARD
    // the drag engine for reordering ON the card — the SAME vendored Sortable the board's host loads,
    // from the same Worker path. Editor-only: appended after the renderer's output, never inside it.
    + `<script src="${esc(sortableSrc())}"><\/script>`;
}

// ── the card itself is the editing surface ───────────────────────────────────────────────────────
//
// Owner ruling 2026-09-06: the experience baseline is an ordinary link-in-bio editor — you tap the
// thing on the card and change it. The board stays (it is the reorder table and the path from an
// Obsidian board to a Card), but it is no longer the only door into a sheet.
//
// 🔴 HOW A TAP FINDS ITS CELL. The renderer writes `data-cell` (editIndex), whose number is the index
// into `model.cells` on the face and into THAT drawer's cells inside a drawer panel. So the element's
// enclosing `[data-drawer-panel]` is read too, and board-bridge's `slotOfRenderedCell` turns the pair
// into the board slot `openCell` already takes — the same sheet the board opens, not a second one.
// A cell that renders to NOTHING even while editing has no element to tap; it stays reachable from
// the board, which lists every cell whether or not it draws.
//
// 🔴 WINDOW-capture, not document-capture. PREVIEW_GUARD's own click listener is on the document in
// the capture phase and was registered first (it parses with the page); on a `#drawer` link it would
// open the drawer and on an http one let the browser follow it. Window capture runs before any
// document listener, and stopPropagation there means the guard never sees a tap that meant "edit".
//
// Everything added here is DOM added after load — none of it is in renderCardHTML's output, so the
// production card cannot grow an edit affordance by accident.
/** the vendored Sortable, from where the board's own host gets it (the Worker's table path) */
const sortableSrc = () => {
  try { return new URL('Sortable.min.js', new URL(S.tableBase || './', location.href)).href; } catch { return 'Sortable.min.js'; }
};

const COACH_KEY = 'cardtile:try:coach:v1';
// host mode: once per SESSION (sessionStorage), and never the sandbox's localStorage — a real
// card's editor must not read or write the practice mode's browser state.
const coachStore = () => (S.host ? window.sessionStorage : window.localStorage);
const coachSeen = () => { try { return coachStore().getItem(COACH_KEY) === '1'; } catch { return false; } };
const coachDone = () => {
  try { coachStore().setItem(COACH_KEY, '1'); } catch { /* best-effort: it just shows again */ }
  const n = el('coach');
  if (n) n.hidden = true;
};

const CARD_EDIT_CSS = `
html.ct2-edit [data-cell]{cursor:pointer;outline:2px solid transparent;outline-offset:3px;border-radius:inherit;transition:outline-color .12s}
html.ct2-edit [data-cell]:hover{outline-color:rgba(64,120,255,.55)}
html.ct2-edit [data-cell]:focus-visible{outline-color:rgba(64,120,255,.95)}
html.ct2-edit [data-cell] [data-cell]{outline:none}
html.ct2-edit,html.ct2-edit body{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.45) transparent}
html.ct2-edit ::-webkit-scrollbar{width:8px;height:8px;background:transparent}
html.ct2-edit ::-webkit-scrollbar-track{background:transparent}
html.ct2-edit ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.45);border-radius:8px}
html.ct2-edit .sortable-ghost{opacity:.35}
html.ct2-edit .sortable-drag,html.ct2-edit .sortable-fallback{opacity:.95;box-shadow:0 12px 30px rgba(0,0,0,.25)}
html.ct2-dragging,html.ct2-dragging body{touch-action:none;user-select:none;-webkit-user-select:none}
.ct2-add{color:var(--ct2-ink,currentColor);display:flex;align-items:center;justify-content:center;gap:.4em;width:100%;min-height:48px;margin:12px 0 4px;
  font:600 14px/1.3 system-ui,sans-serif;opacity:.75;cursor:pointer;
  background:transparent;border:1.5px dashed currentColor;border-radius:14px}
.ct2-add:hover,.ct2-add:focus-visible{opacity:1}
.ct2-opens{position:absolute;bottom:6px;right:6px;z-index:2;display:inline-flex;align-items:center;min-height:28px;padding:2px 10px;
  font:600 11px/1.2 system-ui,sans-serif;color:#fff;background:rgba(20,20,20,.78);border:0;border-radius:999px;cursor:pointer}
html.ct2-edit [data-cell]:has(.ct2-opens){position:relative}
html.ct2-fit,html.ct2-fit body{min-height:0!important;overflow:hidden!important}
`;

/** the drawer a rendered element sits in, or null for the face */
const drawerOfEl = (node) => {
  const panel = node.closest('[data-drawer-panel]');
  return panel ? panel.getAttribute('data-drawer-panel') : null;
};

/** open a drawer inside the preview — the same attribute PREVIEW_GUARD's own `open()` sets */
function openPreviewDrawer(doc, id) {
  for (const p of doc.querySelectorAll('[data-drawer-panel]')) p.removeAttribute('data-preview-open');
  const p = [...doc.querySelectorAll('[data-drawer-panel]')].find((x) => x.getAttribute('data-drawer-panel') === id);
  if (p) p.setAttribute('data-preview-open', '');
}

// ── the card FLOATS on the porch (desktop, ≥1024px) ─────────────────────────────────────────────
// 🩸 2026-09-24, Safari 1200 / Chromium 1400: the #canvas iframe filled its column to the footer, so
// the card document's own dark ground read as a full-height slab with the porch only at the sides.
// So on a wide screen the iframe is as tall as the card's content and the COLUMN scrolls instead.
// 🔴 The card's CSS gives html/body `min-height:100vh`, and inside an iframe vh IS the iframe — sized
// to scrollHeight it could only ever grow. `html.ct2-fit` (editor-injected, never in the card's own
// output) zeroes that min-height so scrollHeight is the content's. Below 1024 the preview is a full
// view of its own and keeps scrolling inside the iframe (Sortable's touch autoscroll depends on it).
const FIT_MQ = '(min-width: 1024px)';
function fitCanvas(frame, doc, win) {
  const mq = window.matchMedia(FIT_MQ);
  const root = doc.documentElement;
  const size = () => {
    if (!mq.matches) { root.classList.remove('ct2-fit'); frame.style.height = ''; return; }
    root.classList.add('ct2-fit');
    const h = Math.ceil(root.scrollHeight);
    if (frame.style.height !== `${h}px`) frame.style.height = `${h}px`;
  };
  size();
  if (win && win.ResizeObserver) new win.ResizeObserver(size).observe(doc.body);
  // images and fonts finishing change the height without resizing body's box on every engine
  win?.addEventListener('load', size);
  mq.addEventListener?.('change', size);
}

function wireCard() {
  const frame = el('canvas');
  const doc = frame && frame.contentDocument;
  const win = frame && frame.contentWindow;
  if (!doc || !doc.body || doc.documentElement.classList.contains('ct2-edit')) return;
  doc.documentElement.classList.add('ct2-edit');
  hostSaveKey(doc);
  const style = doc.createElement('style');
  style.textContent = CARD_EDIT_CSS;
  doc.head.appendChild(style);
  fitCanvas(frame, doc, win);

  for (const c of doc.querySelectorAll('[data-cell]')) {
    // the OUTERMOST cell element only — a cell never nests another, but be exact about it
    if (c.parentElement && c.parentElement.closest('[data-cell]')) continue;
    c.setAttribute('tabindex', '0');
    c.setAttribute('role', 'button');
    // a tile that opens a drawer: the tap edits the tile, and this chip is how you get INTO the
    // drawer to edit what is inside it. Its words are the table's own drawer wording.
    const a = c.matches('a[data-drawer]') ? c : c.querySelector('a[data-drawer]');
    if (a) {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'ct2-opens';
      chip.dataset.opens = a.getAttribute('data-drawer');
      chip.textContent = `${TB['board.opensDrawer']} →`;
      c.appendChild(chip);
    }
  }
  // 「＋加一張牌」 at the end of the face and of every drawer panel
  const addBtn = (drawerId) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'ct2-add';
    b.dataset.addLane = laneKeyForCardAdd(S.model, drawerId);
    b.textContent = addTileLabel(S.locale, T);
    return b;
  };
  // 🩸 the add button inherited the PAGE's colour (a pale ink meant for a dark ground) and vanished on
  // a white card. It takes the card's own text colour: the renderer's `--cp-ink` token if set, else
  // the computed colour of the hero name / first cell — read once here, set as `--ct2-ink`.
  const inkFrom = doc.querySelector('.st-hero-name, [data-cell]');
  const tokenInk = win.getComputedStyle(doc.querySelector('.st-card') || doc.body).getPropertyValue('--cp-ink').trim();
  const ink = tokenInk || (inkFrom ? win.getComputedStyle(inkFrom).color : '');
  if (ink) doc.documentElement.style.setProperty('--ct2-ink', ink);
  const face = doc.querySelector('.st-card');
  if (face) face.appendChild(addBtn(null));
  for (const body of doc.querySelectorAll('[data-drawer-panel] .dc-drawer-body')) {
    body.appendChild(addBtn(drawerOfEl(body)));
  }

  wireCardDrag(doc, win);

  const act = (e) => {
    if (S.cardDragging) return true;               // the click that ends a drag is not a tap
    const t = e.target;
    if (!t || !t.closest) return false;
    const chip = t.closest('.ct2-opens');
    if (chip) { openPreviewDrawer(doc, chip.dataset.opens); return true; }
    const add = t.closest('.ct2-add');
    if (add) { openPicker(add.dataset.addLane); return true; }
    const cell = t.closest('[data-cell]');
    if (!cell) return false;
    const slot = slotOfRenderedCell(S.model, drawerOfEl(cell), cell.getAttribute('data-cell'), bridgeCtx());
    if (slot < 0) return false;                    // stale DOM — do nothing rather than open a wrong sheet
    coachDone();
    openCell(slot);
    return true;
  };
  win.addEventListener('click', (e) => {
    if (act(e)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-cell], .ct2-add, .ct2-opens')) return;
    if (act(e)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// ── reordering ON the card ───────────────────────────────────────────────────────────────────────
//
// Same wiring as the retired w/editor.mjs canvas (its drag harness found every trap in it), per lane:
//   · a tile moves only within its LANE — a face section or one drawer. Each Sortable container is
//     given the group of the lane its cells belong to, so a drop into another section is refused by
//     Sortable itself rather than half-applied.
//   · only the INNERMOST containers (`.st-run` sits inside `.st-cells`; two instances claiming one
//     child is a reorder that silently does nothing — measured on the retired editor).
//   · forceFallback: never native HTML5 DnD across a srcdoc boundary; pointer events all the way.
//   · a 150ms press before a TOUCH drag begins, so a tap still opens the sheet. Mouse is unaffected.
//
// 🔴 ONE MUTATION PATH. The drop is read back as the lane's new order of board slots and handed to
// `cardDropOrder` → `applyBoardOrder` — the function the board's own drag ends in. The card never
// serialises order its own way.
function wireCardDrag(doc, win) {
  const Sortable = win.Sortable;
  S.cardDragEnabled = !!Sortable;
  if (!Sortable) {
    // 🔴 DEGRADE, BUT SAY SO (the retired editor's rule): tapping still edits, the sheet's move
    // buttons and the board still reorder — but a silent return is how drag went missing for six
    // days once, so the fact is recorded where a person and a harness can both see it.
    console.warn(`[cardtile] card drag is OFF — ${sortableSrc()} did not load. Tap-to-edit, the sheet's move buttons and the board still work.`);
    return;
  }
  const laneOfEl = (n) => {
    const cell = n.matches('[data-cell]') ? n : n.querySelector('[data-cell]');
    if (!cell) return null;
    const drawerId = drawerOfEl(cell);
    const slot = slotOfRenderedCell(S.model, drawerId, cell.getAttribute('data-cell'), bridgeCtx());
    const s = boardSlots(S.model, bridgeCtx())[slot];
    return s ? s.laneKey : null;
  };
  const containers = [...doc.querySelectorAll('.st-cells, .st-run, .st-bleed')]
    .filter((c) => [...c.children].some((n) => n.matches('[data-cell]')));
  S.cardDragContainers = containers.length;
  for (const c of containers) {
    const laneKey = laneOfEl(c);
    if (!laneKey) continue;
    new Sortable(c, {
      group: { name: `ct2:${laneKey}`, pull: true, put: true },
      animation: 120,
      draggable: '[data-cell]',
      filter: '.ct2-opens, .ct2-add',
      preventOnFilter: false,
      forceFallback: true,
      fallbackTolerance: 6,
      delay: 150,
      delayOnTouchOnly: true,
      onStart: () => { S.cardDragging = true; doc.documentElement.classList.add('ct2-dragging'); },
      onEnd: () => {
        doc.documentElement.classList.remove('ct2-dragging');
        setTimeout(() => { S.cardDragging = false; }, 0);
        onCardDrop(doc, laneKey);
      },
    });
  }
}

/** read the lane's rendered order back and apply it — through the board's own permutation path */
function onCardDrop(doc, laneKey) {
  const drawerId = laneKey.startsWith('drawer:') ? laneKey.slice('drawer:'.length) : null;
  const scope = drawerId
    ? [...doc.querySelectorAll('[data-drawer-panel]')].find((p) => p.getAttribute('data-drawer-panel') === drawerId)
    : doc.querySelector('.st-card');
  if (!scope) return;
  const slots = boardSlots(S.model, bridgeCtx());
  const rendered = [...scope.querySelectorAll('[data-cell]')]
    .filter((n) => !(n.parentElement && n.parentElement.closest('[data-cell]')))
    .map((n) => slotOfRenderedCell(S.model, drawerId, n.getAttribute('data-cell'), bridgeCtx()))
    .filter((n) => n >= 0 && slots[n] && slots[n].laneKey === laneKey);
  const order = cardDropOrder(S.model, laneKey, rendered, bridgeCtx());
  if (!order) { paintPreview(); return; }           // not a clean permutation: redraw the truth
  const md = serializeCard(applyBoardOrder(S.model, order, bridgeCtx()));
  if (md === S.md) { paintPreview(); return; }       // dropped where it started
  // reloadTable: true — the board re-renders from the new md under S.syncing, so its observer
  // does not read that re-render back as a second move.
  commit(md);
}

// ── the table: the engine's own tugtile, in an iframe ────────────────────────────────────────────
const tableWin = () => { const f = el('table'); return f && f.contentWindow; };
const tableDoc = () => { const f = el('table'); return f && f.contentDocument; };

// ── what a tile SHOWS: the finished element, in miniature ────────────────────────────────────────
//
// 🔴 The host renders a tile's body by calling back here (its `tileHtml` option — see the engine's
// hosts/web/tugtile/index.html). `tileFace` in board-bridge decides WHAT is on it; this decides how
// it is drawn, because only this side can resolve `asset:` bytes to a data: URI and only it knows
// the icon route.
//
// 🔴 THE HOOK RUNS DURING A RENDER, so `facesFor` is the slot list the CURRENT board render was made
// from — set immediately before `__load`, which is the only moment the host renders tiles that are
// ours. Anything else it renders (its own sample board, before we have handed it a card) gets null
// back and falls through to the host's own markdown, rather than a face belonging to another board.
let facesFor = null;

/** a favicon <img> for a domain, behind which the type icon is already drawn if it never loads */
function markImg(domain) {
  const d = String(domain || '').toLowerCase();
  if (!ICON_DOMAIN_RE.test(d)) return '';
  // inline `onerror` rather than wiring after the fact: the image can fail before any listener this
  // file adds is attached, and a tile with a broken image slot is the thing being fixed.
  return `<img class="ct2-face-mark" src="${esc(iconPath(d))}" alt="" loading="lazy"`
    + ` referrerpolicy="no-referrer" onerror="this.remove()">`;
}

function faceHtml(cell) {
  const f = tileFace(cell, bridgeCtx());
  const kindName = TYPES[f.kind] ? say(TYPES[f.kind].title) : f.kind;
  const icon = `<span class="ct2-face-ico" aria-hidden="true">${typeIconSvg(f.kind)}</span>`;
  const src = f.img ? previewSrc(f.img) : '';
  let art = '';
  if (src) art = `<span class="ct2-face-art">${icon}<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
  else if (f.icons.length === 1) art = `<span class="ct2-face-art ct2-face-art--mark">${icon}${markImg(f.icons[0])}</span>`;
  else if (f.icons.length > 1) art = `<span class="ct2-face-marks">${f.icons.map(markImg).join('')}</span>`;
  return `<div class="ct2-face ct2-face--${esc(f.kind)}">${art}`
    + `<span class="ct2-face-main"><span class="ct2-face-title">${esc(f.title)}</span>`
    + (f.sub ? `<span class="ct2-face-sub">${esc(f.sub)}</span>` : '')
    + '</span>'
    + `<span class="ct2-face-kind" title="${esc(kindName)}" aria-label="${esc(kindName)}">${typeIconSvg(f.kind)}</span>`
    + '</div>';
}

/** hand the board the current card, as a board. Waits for the host to publish `__ready`. */
function loadTable() {
  const w = tableWin();
  if (!w || typeof w.__load !== 'function') return;      // not ready yet; onTableReady will call us
  if (!S.model) return;                                   // host mode before card:load: nothing to show
  S.syncing = true;
  facesFor = boardSlots(S.model, bridgeCtx());
  w.__load(boardMd(S.model, bridgeCtx()));
  // tid n is slot n again — the host just re-rendered from the md we handed it
  S.slotOfTid = boardSlots(S.model, bridgeCtx()).map((_, i) => i);
  decorate();
  S.syncing = false;
}

/** poll for the host's own readiness flag, then load. The host sets it after its i18n fetch settles. */
function onTableFrameLoad() {
  S.wired = false;
  const start = Date.now();
  const tick = () => {
    const w = tableWin();
    if (w && w.__ready) { hostSaveKey(w.document); wireTable(); loadTable(); el('table').classList.add('is-ready'); return; }
    if (Date.now() - start > 10000) return;              // it is not coming; the sheet still works
    setTimeout(tick, 30);
  };
  tick();
}

// ── the intercepts ───────────────────────────────────────────────────────────────────────────────
//
// Every control the board draws is in exactly one of three states, and this is the whole list:
//
//   INHERITED   lane collapse · the tile grip and its drag · arrow-key tugging
//   ROUTED      a tile → the Card sheet for that cell        undo → this file's stack
//               「＋加一張牌」 → the icon picker              ＋抽屜 → a new drawer
//               the raw-markdown action → whole-page Markdown mode
//               a lane title → renaming that section or drawer
//   NEVER BUILT search · redo · the board/table view cycle · the lock · fold-all · open-a-file ·
//               archive · board settings  (BOARD_OPTS.controls — the host does not draw them)
//   REMOVED     the per-tile and per-lane ⋯ menus
//
// 🔴 The REMOVED two are removed because each one mutates the BOARD's model behind this file's
// back — tugtile's `duplicateTile`, `archiveLane`, `openSettings` all end in `commit()` over there,
// and the card would never hear about it. Hidden by CSS rather than swallowed by a click handler:
// a control that is on screen and does nothing is worse than one that was never drawn.
const HIDE_IN_BOARD = ['.tugtile__tile-more', '.tugtile__lane-more'].join(',');

// ── how the ENGINE's host is configured for a Card ───────────────────────────────────────────────
//
// 🔴 OPTIONS, NOT A FORK. `window.__configure` is the host's own opening (engine
// hosts/web/tugtile/index.html), every option defaults to the kanban behaviour, and switching one
// off here changes nothing for anybody else who mounts that page. The three cold-read findings this
// answers (2026-09-06 P1-2 and P1-4) were all "a kanban control on a link page":
//
//   numbers  a `1` `2` `3` chip on every tile reads as a ticket number. A link page's buttons are
//            not numbered; the tile carries its TYPE icon in that corner instead.
//   fold     every Card tile summary is multi-line by construction, so the host folded all of them
//            — and a folded tile is a title with no picture, which is the opposite of a mini-render.
//   controls 「找牌／牌表／鎖／全展開」 are board tools. A five-tile card needs none of them, and the
//            lock's is a one-tap dead end (it disables 「＋加一張牌」 while leaving it on screen).
//            What is left is the two a Card author acts on: 復原, and Markdown mode.
//   tileHtml the tile IS the finished element — see faceHtml above.
const BOARD_OPTS = {
  numbers: false,
  fold: false,
  controls: ['undo', 'md'],
  tileHtml: (tile, tid) => {
    const s = facesFor && facesFor[tid];
    return s ? faceHtml(s.cell) : null;
  },
};

const BOARD_CSS = `
  ${HIDE_IN_BOARD} { display: none !important; }
  /* the engine's own opt-in responsive board: lanes reflow into one vertical stack on a narrow
     pane. Not on by default over there; on here, because a phone is the case this must work in. */
  .tugtile { container-type: inline-size; container-name: tugtileboard; }
  /* every target a finger has to hit is at least 44px — including the two header icons that are
     left once the board tools are gone (they were 30x30, measured in the cold read) */
  .tugtile__add-btn, .tugtile__addcol-btn { min-height: 44px; }
  .tugtile__tile { min-height: 44px; }
  .tugtile__lane-head { min-height: 44px; }
  .tw-iconbtn { min-width: 44px; min-height: 44px; }

  /* ── THE TILE IS THE FINISHED ELEMENT ─────────────────────────────────────────────────────────
     A picture, the words, the grey line, and the kind — the same four things the element has on the
     card. See faceHtml / board-bridge's tileFace for what goes in each. */
  .ct2-face { display: flex; align-items: center; gap: 10px; }
  .ct2-face-main { flex: 1; min-width: 0; }
  .ct2-face-title { display: block; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
  .ct2-face-sub { display: block; margin-top: 2px; font-size: 12px; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct2-face-art { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 44px; height: 44px; border-radius: 8px;
    overflow: hidden; display: flex; align-items: center; justify-content: center;
    background: var(--background-modifier-hover); color: var(--text-faint); }
  .ct2-face-art > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .ct2-face-art .ct2-face-ico { width: 20px; height: 20px; }
  /* a favicon is a MARK, not a photograph: it sits in the middle at its own size */
  .ct2-face-art--mark > img { inset: 10px; width: 24px; height: 24px; object-fit: contain; }
  .ct2-face--profile .ct2-face-art { border-radius: 50%; }
  .ct2-face-marks { display: flex; flex: 0 0 auto; gap: 4px; }
  .ct2-face-marks img { width: 20px; height: 20px; object-fit: contain; }
  .ct2-face-ico svg, .ct2-face-kind svg { width: 100%; height: 100%; display: block; }
  .ct2-face-kind { box-sizing: border-box; flex: 0 0 auto; width: 28px; height: 28px; padding: 6px;
    border-radius: 8px; background: var(--background-modifier-hover); color: var(--text-muted); }
  /* 🩸 THE HEADER COLLIDED WITH ITSELF AT 390px, measured on the first harness run: the host's bar
     was a fixed 42px with a centred 「牌桌 · tugtile-ing（理牌中）」 cluster between two icon groups,
     and on a phone that cluster wrapped to three lines straight through the icons either side of it.
     The cluster itself is gone now (BOARD_OPTS.controls never builds the view cycle or the lock, so
     its 「tugtile-ing」 brand text stops leaking an internal name too) — what is left is letting the
     bar grow rather than clip.
     (No backticks in this comment: the whole block is one template literal, and a stray pair closes
     it — which is how this fix silently failed to ship on its first attempt while the harness went
     on measuring the previous bundle and reporting 315/315.) */
  @media (max-width: 760px) {
    .tw-header { height: auto; min-height: 44px; flex-wrap: nowrap; gap: 2px; }
  }
`;

function wireTable() {
  const doc = tableDoc();
  if (!doc || S.wired) return;
  S.wired = true;

  const style = doc.createElement('style');
  // BOARD_LIGHT_CSS: the board follows the shell's fixed light look, not the OS (see board-bridge)
  style.textContent = BOARD_CSS + BOARD_LIGHT_CSS;
  doc.head.appendChild(style);
  const root = doc.querySelector('.tugtile');
  if (root) root.classList.add('tugtile--rwd');
  // 🔴 BEFORE the first `__load`. The host re-renders whatever it is holding when this is called, so
  // arriving late would mean one render of the card with the kanban's chrome on it.
  const w = tableWin();
  if (w && typeof w.__configure === 'function') w.__configure(BOARD_OPTS);

  doc.addEventListener('click', (e) => {
    const t = e.target;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    // 「＋加一張牌」 at the END of a lane → the one-row icon picker
    const add = t.closest('.tugtile__add-btn');
    if (add) { stop(); openPicker(laneKeyOf(add.closest('.tugtile__lane'))); return; }

    // ＋ a lane → a new drawer, in this file's vocabulary
    if (t.closest('.tugtile__addcol-btn')) { stop(); addDrawer(); return; }

    // the header actions this file owns
    if (t.closest('#undo')) { stop(); undo(); return; }
    if (t.closest('#redo')) { stop(); return; }        // 🔴 see undo(): there is one stack, not two
    if (t.closest('#md')) { stop(); setView('md'); return; }

    // a lane title. Collapsed → let the board's own expand-on-click through; otherwise rename.
    const title = t.closest('.tugtile__lane-title');
    if (title) {
      const lane = title.closest('.tugtile__lane');
      if (lane && lane.dataset.collapsed === 'true') return;   // inherited: it expands
      stop(); renameLane(laneKeyOf(lane)); return;
    }

    // a tile → the Card sheet. The engine would open its own markdown editor here.
    const tile = t.closest('.tugtile__tile');
    if (tile) {
      // 🔴 ONE TAP, ALWAYS — and this is the one inherited behaviour that is deliberately NOT kept.
      // tugtile expands a folded long card on the first tap and edits on the second, which is right
      // for a kanban where the card's text IS the thing. Here the tile is a SUMMARY of a cell and
      // every tile is multi-line by construction (a heading, a kind, an address), so `isLong` is
      // true for all of them — inheriting that rule would have made "tap a tile to edit it" cost two
      // taps on every tile on the board. Measured on the first harness run, at 390px, in zh-TW.
      // Folding is not lost: the header's three-cycle fold control is inherited whole and still
      // folds and unfolds the lot.
      stop();
      openCell(slotOf(tile));
    }
  }, true);

  // the board's own context menus mutate its model, not the card
  doc.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tugtile__tile, .tugtile__lane-head')) e.preventDefault();
  }, true);

  // 🔴 A DRAG IS NOT AN EVENT WE ARE GIVEN. SortableJS's `onEnd` is configured inside the engine's
  // host and there is no hook out of it — and the arrow-key path does not go through Sortable at
  // all. What both DO is move an element between `.tugtile__list` nodes, so that is what is
  // watched. One observer catches every reorder the board can perform, including its own undo.
  const obs = new doc.defaultView.MutationObserver(() => { if (!S.syncing) syncOrder(); });
  const board = doc.getElementById('board');
  if (board) obs.observe(board, { childList: true, subtree: true });
}

/** the lane key this file stamped on a lane element (`face:0`, `drawer:about`) */
const laneKeyOf = (laneEl) => (laneEl && laneEl.dataset.cardLane) || '';

/** a tile element → its slot, which is simply its position in the board's reading order */
function slotOf(tileEl) {
  const doc = tableDoc();
  const tiles = [...doc.querySelectorAll('.tugtile__list > .tugtile__tile')];
  return tiles.indexOf(tileEl);
}

/**
 * Read the board's ORDER back and apply it. The only thing that ever crosses upward.
 *
 * 🔴 `data-tid` is what makes this a permutation rather than a guess. The host assigns it once per
 * render and never touches it again, so a tile that moved still carries the number it had when we
 * knew where it was — and `slotOfTid` translates. After the apply, the model's reading order IS the
 * DOM's, so the map is rebuilt as the identity over the new positions.
 */
function syncOrder() {
  const doc = tableDoc();
  if (!doc || !S.model) return;
  const lanes = [...doc.querySelectorAll('.tugtile__lane')];
  if (!lanes.length) return;
  const order = lanes.map((lane) => ({
    key: laneKeyOf(lane),
    slots: [...lane.querySelectorAll('.tugtile__list > .tugtile__tile')]
      .map((t) => S.slotOfTid[Number(t.dataset.tid)])
      .filter((n) => Number.isInteger(n)),
  })).filter((l) => l.key);
  const flat = order.flatMap((l) => l.slots);
  const expected = boardSlots(S.model, bridgeCtx()).length;
  // 🔴 A partial read is a read taken mid-render. Applying it would DELETE whatever the board had
  // not drawn yet — so it is refused, not merged. The next mutation brings a complete one.
  if (flat.length !== expected || new Set(flat).size !== expected) return;

  const next = applyBoardOrder(S.model, order, bridgeCtx());
  const md = serializeCard(next);
  if (md === S.md) return;                                  // a move that changed nothing
  S.syncing = true;
  // rebuild the map BEFORE commit: after this, tid t sits at DOM position p, and the new model's
  // slot p is that same tile.
  const tids = lanes.flatMap((lane) => [...lane.querySelectorAll('.tugtile__list > .tugtile__tile')].map((t) => Number(t.dataset.tid)));
  const map = [];
  tids.forEach((tid, pos) => { map[tid] = pos; });
  S.slotOfTid = map;
  commit(md, { reloadTable: false });
  S.syncing = false;
}

// ── decoration: the lane keys, and which tile opens which drawer ─────────────────────────────────
//
// Owner ruling 2026-09-24: "a view answers one question" — the board answers what is in the card,
// in what order, and which link opens which drawer. A one-to-one relation needs a WORD, not a line:
// the dashed connector lines that used to be drawn here (and re-drawn on every scroll and resize)
// are gone. The words come from board-bridge's `drawerLabels`, pure, so a test pins them.
function decorate() {
  const doc = tableDoc();
  if (!doc || !S.model) return;
  const lanes = boardLanes(S.model, bridgeCtx());
  const els = [...doc.querySelectorAll('.tugtile__lane')];
  els.forEach((lane, i) => { if (lanes[i]) lane.dataset.cardLane = lanes[i].key; });

  // the tile's side is its SUBTITLE (tileFace → opensText); only the lane heading is set here.
  const labels = drawerLabels(S.model, bridgeCtx(), TB);
  // the drawer lane's heading names the tile that opens it. Only the TEXT is swapped: the title
  // element is the host's own, and a rename still starts from the plain drawer title (renameLane
  // reads the model, never this DOM).
  const laneOfKey = (key) => els[lanes.findIndex((l) => l.key === key)];
  for (const h of labels.lanes) {
    const lane = laneOfKey(h.laneKey);
    if (!lane) continue;
    for (const t of lane.querySelectorAll('.tugtile__lane-title, .tugtile__lane-title-v')) {
      if (!t.children.length && t.textContent !== h.heading) t.textContent = h.heading;
    }
  }
}

// ── 「＋加一張牌」 — one row, seven icons ────────────────────────────────────────────────────────
function openPicker(laneKey) {
  S.addLane = laneKey || 'face:0';
  const lane = boardLanes(S.model, bridgeCtx()).find((l) => l.key === S.addLane);
  el('picker-title').textContent = TB['board.pickTitle'];
  el('picker-lane').textContent = lane ? lane.title : '';
  el('picker-row').innerHTML = PALETTE.map((t) =>
    `<button class="ctw-pick-btn" type="button" data-type="${esc(t)}" title="${esc(say(TYPES[t].hint))}">`
    + `<span class="ctw-pick-ico">${typeIconSvg(t)}</span>`
    + `<span class="ctw-pick-name">${esc(say(TYPES[t].title))}</span></button>`).join('');
  for (const b of el('picker-row').querySelectorAll('.ctw-pick-btn')) {
    b.onclick = () => { el('picker').hidden = true; addCell(b.dataset.type, S.addLane); };
  }
  el('picker').hidden = false;
  const first = el('picker-row').querySelector('.ctw-pick-btn');
  if (first) first.focus();
}

/**
 * A new cell goes at the END of the lane it was added in — that is where the button is, and a tile
 * that appears somewhere other than under the finger that made it is a tile nobody can find.
 *
 * A new cell is NOT empty: an empty one renders to nothing, so `BLANKS` render as visibly
 * unfinished instead, and the sheet opens on top of them.
 */
function addCell(type, laneKey) {
  const blank = normalizeCell({ ...blankCell(type, TX), params: {} });
  edit((m) => {
    if (laneKey.startsWith('drawer:')) {
      const d = m.drawers.find((x) => `drawer:${x.id}` === laneKey);
      if (d) d.cells = d.cells.concat([blank]);
      return m;
    }
    const bi = Number(laneKey.slice('face:'.length)) || 0;
    const b = m.blocks[bi] || m.blocks[m.blocks.length - 1];
    const at = b.start + b.count;
    m.cells = [...m.cells.slice(0, at), blank, ...m.cells.slice(at)];
    // the ranges after the one we grew all shift by one
    m.blocks = m.blocks.map((x, i) => (i === bi ? { ...x, count: x.count + 1 } : (x.start >= at ? { ...x, start: x.start + 1 } : x)));
    return m;
  });
  // the sheet opens on top of the new tile: the LAST slot in the lane it was added to
  let last = -1;
  boardSlots(S.model, bridgeCtx()).forEach((s, i) => { if (s.laneKey === laneKey) last = i; });
  if (last >= 0) openCell(last);
}

function addDrawer() {
  const title = prompt(T.addDrawerPrompt, T.addDrawerPromptDefault);
  if (title == null) return;
  const id = (title.trim().toLowerCase().replace(/\s+/g, '-') || 'drawer');
  if (S.model.drawers.some((d) => d.id === id)) { alert(T.addDrawerDuplicateAlert); return; }
  edit((m) => { m.drawers = (m.drawers || []).concat([{ id, title: title.trim(), cells: [] }]); return m; });
}

/**
 * Renaming a lane. A drawer lane renames the DRAWER (what a visitor sees on the overlay); a face
 * section renames its `## heading`.
 *
 * 🔴 The first face lane is NOT renamable, and refusing is the honest answer. It has no heading of
 * its own in the file — `## grid` is the card's own lane name, never shown to anybody — so a rename
 * would either be discarded on the next save or would invent a section heading the author did not
 * ask for. `T.faceTabLabel` is what it is called on both sandboxes.
 */
function renameLane(laneKey) {
  if (!laneKey || laneKey === 'face:0') return;
  const lane = boardLanes(S.model, bridgeCtx()).find((l) => l.key === laneKey);
  if (!lane) return;
  const next = prompt(T.addDrawerPrompt, lane.title);
  if (next == null || !next.trim()) return;
  edit((m) => {
    if (lane.kind === 'drawer') {
      m.drawers = m.drawers.map((d) => (d.id === lane.drawerId ? { ...d, title: next.trim() } : d));
      return m;
    }
    m.blocks = m.blocks.map((b, i) => (i === lane.block ? { ...b, label: next.trim() } : b));
    return m;
  });
}

// ── the Card-typed sheet ─────────────────────────────────────────────────────────────────────────
function laneCellsOf(laneKey) {
  const lane = boardLanes(S.model, bridgeCtx()).find((l) => l.key === laneKey);
  return lane ? lane.cells : [];
}

function targetOptions() {
  const drawers = (S.model && S.model.drawers) || [];
  if (!drawers.length) return null;
  return [{ value: '', label: T.targetUrl }]
    .concat(drawers.map((d) => ({ value: d.id, label: T.targetDrawer + (d.title || d.id) })));
}

/** what to show in a picture field's thumbnail: a data: URI for a stored/pending asset, else the address */
function previewSrc(value) {
  const m = /^asset:(.+)$/.exec(String(value || '').trim());
  if (!m) return String(value || '');
  const a = S.pendingAssets[m[1]] || ((S.model && S.model.assets) || {})[m[1]];
  return a ? `data:${a.mime};base64,${a.b64}` : '';
}

function openCell(slot) {
  const slots = boardSlots(S.model, bridgeCtx());
  const s = slots[slot];
  if (!s) return;
  S.openSlot = slot;
  S.pendingAssets = {};
  const cell = s.cell;
  const def = TYPES[cell.type] || { title: cell.type, hint: T.unknownCellHint, body: { label: T.unknownCellBodyLabel, control: CONTROL.AREA, hint: '' }, fields: [], params: {} };

  el('modal-title').textContent = say(def.title);
  el('modal-hint').textContent = say(def.hint || '');
  el('modal-body').innerHTML = formBodyHtml(def, cell, formCtx());
  el('modal-raw').value = cell.rawParams || '';
  el('modal').hidden = false;
  syncMoveButtons();
  wireForm(def);
  el('modal-close').focus();
}

/** live wiring inside the open sheet: picture pickers, and rows that depend on another row's value */
function wireForm(def) {
  for (const box of el('modal-body').querySelectorAll('.ctw-asset')) {
    const id = box.dataset.for;
    const store = document.getElementById(id);
    const file = document.getElementById(`${id}-file`);
    const urlIn = document.getElementById(`${id}-url`);
    const err = document.getElementById(`${id}-err`);
    const shot = box.querySelector('.ctw-asset-shot');
    const pickLabel = box.querySelector('.ctw-asset-pick');
    const show = (value) => {
      store.value = value;
      const src = previewSrc(value);
      shot.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
      pickLabel.firstChild.nodeValue = value ? T.assetReplace : T.assetPick;
    };
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      err.textContent = '';
      try {
        const asset = await encodeImage(f);
        if (!asset) { err.textContent = T.assetTooBig; return; }
        S.pendingAssets[asset.id] = { mime: asset.mime, b64: asset.b64 };
        urlIn.value = '';
        show(`asset:${asset.id}`);
      } catch (e) {
        console.warn('[cardtile] that picture could not be read —', e && e.message);
        err.textContent = T.assetUnreadable;
      } finally { file.value = ''; }
    });
    urlIn.addEventListener('input', () => { if (urlIn.value.trim()) show(urlIn.value.trim()); else show(''); });
  }
  for (const row of flatRows(def)) {
    if (!row.showWhen) continue;
    const [dep, want] = Object.entries(row.showWhen)[0];
    const depNode = document.getElementById(`f-${dep}`);
    const target = el('modal-body').querySelector(`[data-field="${row.name}"]`);
    if (!target) continue;
    const sync = () => { target.hidden = !!depNode && String(depNode.value) !== String(want); };
    if (depNode) depNode.addEventListener('change', sync);
    sync();
  }
}

const closeModal = () => { el('modal').hidden = true; S.openSlot = null; S.pendingAssets = {}; };

/** where the open tile sits inside its own lane — the sheet's up/down buttons work within a lane */
function openPlace() {
  const slots = boardSlots(S.model, bridgeCtx());
  const s = slots[S.openSlot];
  if (!s) return null;
  return { laneKey: s.laneKey, index: s.cellIndex, count: laneCellsOf(s.laneKey).length };
}

function syncMoveButtons() {
  const p = S.openSlot == null ? null : openPlace();
  const n = p ? p.count : 0;
  el('modal-up').disabled = !p || p.index <= 0;
  el('modal-down').disabled = !p || p.index >= n - 1;
  el('modal-move').hidden = n < 2;
}

/** the keyboard/button reorder — the path that cannot fail, and the CONTROL a drag is measured against */
function moveCell(delta) {
  const p = openPlace();
  if (!p) return;
  const to = p.index + delta;
  if (to < 0 || to >= p.count) return;
  edit((m) => {
    if (p.laneKey.startsWith('drawer:')) {
      const d = m.drawers.find((x) => `drawer:${x.id}` === p.laneKey);
      d.cells = reorder({ cells: d.cells }, p.index, to).cells;
      return m;
    }
    const bi = Number(p.laneKey.slice('face:'.length)) || 0;
    const b = m.blocks[bi];
    return reorder(m, b.start + p.index, b.start + to);
  });
  // the sheet stays open on the SAME tile, which has simply moved
  S.openSlot = boardSlots(S.model, bridgeCtx()).findIndex((s) => s.laneKey === p.laneKey && s.cellIndex === to);
  syncMoveButtons();
}

function fieldError(name, message) {
  const node = document.getElementById(`e-${name}`);
  if (node) node.textContent = message;
  const input = document.getElementById(`f-${name}`);
  if (input && input.focus) input.focus();
}

function saveCell() {
  if (S.openSlot == null) return;
  const p = openPlace();
  const slots = boardSlots(S.model, bridgeCtx());
  const cell = slots[S.openSlot].cell;
  const def = TYPES[cell.type];
  for (const node of el('modal-body').querySelectorAll('.ctw-err')) node.textContent = '';

  const read = (name) => {
    const node = document.getElementById(`f-${name}`);
    if (!node) return null;
    if (node.type === 'checkbox') return node.checked ? 'on' : '';
    return name === '__body' ? node.value : node.value.trim();
  };
  const visible = (name) => {
    const box = el('modal-body').querySelector(`[data-field="${name}"]`);
    return !!box && !box.hidden;
  };

  const out = composeCell(cell, def, { read, visible }, formCtx());
  if (out.error) { fieldError(out.error.field, out.error.message); return; }
  const next = normalizeCell({ ...cell, rawParams: out.rawParams, body: out.body });
  const staged = S.pendingAssets;
  edit((m0) => {
    const m = out.rename ? setTitle(m0, out.rename) : m0;
    if (Object.keys(staged).length) m.assets = { ...(m.assets || {}), ...staged };
    if (p.laneKey.startsWith('drawer:')) {
      const d = m.drawers.find((x) => `drawer:${x.id}` === p.laneKey);
      d.cells = d.cells.map((c, i) => (i === p.index ? next : c));
      return m;
    }
    const bi = Number(p.laneKey.slice('face:'.length)) || 0;
    const at = m.blocks[bi].start + p.index;
    m.cells = m.cells.map((c, i) => (i === at ? next : c));
    return m;
  });
  closeModal();
}

function deleteCell() {
  const p = openPlace();
  if (!p) return;
  if (!confirm(T.deleteConfirm)) return;
  edit((m) => {
    if (p.laneKey.startsWith('drawer:')) {
      const d = m.drawers.find((x) => `drawer:${x.id}` === p.laneKey);
      d.cells = d.cells.filter((_, i) => i !== p.index);
      return m;
    }
    const bi = Number(p.laneKey.slice('face:'.length)) || 0;
    const at = m.blocks[bi].start + p.index;
    m.cells = m.cells.filter((_, i) => i !== at);
    m.blocks = m.blocks.map((b, i) => (i === bi ? { ...b, count: b.count - 1 } : (b.start > at ? { ...b, start: b.start - 1 } : b)));
    return m;
  });
  closeModal();
}

// ── pictures ─────────────────────────────────────────────────────────────────────────────────────
//
// A chosen file becomes bytes IN THE CARD (`## assets`), not an upload: that is what makes a Card
// one portable file. Downscaled and re-encoded in the browser first.
const ASSET_MAX_EDGE = 1600;
const ASSET_MAX_BYTES = 1500 * 1024;
const ASSET_QUALITIES = [0.82, 0.7, 0.55];

async function encodeImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, ASSET_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  for (const q of ASSET_QUALITIES) {
    // `toBlob('image/webp')` quietly hands back a PNG on a browser without webp — read the type
    // back and fall to jpeg deliberately, rather than discovering it as a size problem.
    let blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (!blob) continue;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > ASSET_MAX_BYTES) continue;
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { id: `sha256-${hex.slice(0, 16)}`, mime: blob.type, b64: btoa(bin) };
  }
  return null;
}

// ── undo ─────────────────────────────────────────────────────────────────────────────────────────
//
// 🔴 ONE STACK, AND IT IS THIS ONE. The board keeps its own undo history of the board — and the
// board is a projection that gets thrown away and rebuilt on every change, so an undo over there
// would restore an arrangement of summaries with no card behind it. The header's undo button is
// routed here; its redo is stopped rather than routed, because this file has never had a redo and a
// button that looks live and does nothing is the phantom kind.
function undo() {
  if (!S.undo.length) return;
  commit(S.undo.pop(), { undoable: false });
}

// ── Markdown mode ────────────────────────────────────────────────────────────────────────────────
//
// The board's own `file-text` header action opens this. It is the SAME either/or tugtile's header
// toggle is: two complete ways to edit one card, never both on screen at once — except that the
// text in the box is the CARD, not the board, because the card is the file.
function openMdMode() {
  el('md-title').textContent = T.mdMode;
  el('md-note').textContent = T.mdNote;
  el('md-cancel').textContent = T.pubCancel;
  el('md-done').textContent = T.mdBack;
  el('md-error').hidden = true;
  el('md').value = S.md;
  el('mdmodal').hidden = false;
  el('md').focus();
}

/**
 * Leaving VALIDATES first and stays put when the text has stopped being a card. There is no way to
 * leave this mode having quietly lost something, which is the property that lets it be offered to a
 * stranger at all.
 */
function closeMdMode(apply) {
  if (!apply) { el('mdmodal').hidden = true; setView(S.view || 'card'); return; }
  const value = el('md').value;
  const wrong = whatIsWrong(value);
  if (wrong) {
    const err = el('md-error');
    err.textContent = T.mdBroken.replace('{n}', String(wrong.line));
    err.hidden = false;
    el('md').focus();
    return;                                   // 🔴 still in the mode, and the card is untouched
  }
  el('mdmodal').hidden = true;
  setView(S.view || 'card');
  if (value !== S.md) commit(value); else paintPreview();
}

// ── the view switch: 卡 · 牌桌 · Markdown ─────────────────────────────────────────────────────────
//
// Three views over ONE card markdown; switching never changes content. The CARD is the default
// editing surface (tap to edit, drag to reorder). The board is the engine's tugtile, shown beside
// the card on a wide screen and in place of it on a phone; it stays loaded and in sync while hidden,
// so showing it is instant. Markdown is the existing whole-page mode — leaving it still validates
// first, and a refused leave keeps you in it (closeMdMode).
const VIEW_KEY = 'cardtile:try:view:v1';
const VIEWS = ['card', 'board', 'md'];
const readView = () => { try { const v = window.localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'card'; } catch { return 'card'; } };
const writeView = (v) => { try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* best-effort */ } };

function paintViewSwitch(view) {
  for (const b of document.querySelectorAll('[data-view-btn]')) {
    b.setAttribute('aria-pressed', b.dataset.viewBtn === view ? 'true' : 'false');
  }
}

/** `table`/`preview` are the old two-tab names, still accepted so a harness that says them works */
function setView(view) {
  const v = view === 'table' ? 'board' : view === 'preview' ? 'card' : view;
  if (!VIEWS.includes(v)) return;
  if (v === 'md') {
    if (!S.model) return;                   // host mode before card:load: no card to write out
    paintViewSwitch('md');
    writeView('md');
    if (el('mdmodal').hidden) openMdMode();
    return;
  }
  if (!el('mdmodal').hidden) el('mdmodal').hidden = true;     // switching away = cancel, as ✕ does
  S.view = v;
  document.body.dataset.view = v;
  paintViewSwitch(v);
  writeView(v);
}

// ── HOST MODE: feelreef's page embeds this editor on a REAL card ──────────────────────────────────
//
// The editor holds no credential and never reads the sandbox's localStorage draft: the card arrives
// from the parent (`card:load`), every commit goes back to it (`card:change`), and Save is a
// `card:save` the parent answers. All of the message logic is in host-bridge.mjs (node-tested);
// this is only the DOM around it.
const HOST_STATUS_KEY = { waiting: 'board.hostWaiting', unsaved: 'board.hostUnsaved', saving: 'board.hostSaving', saved: 'board.hostSaved', failed: 'board.hostFailed' };

function paintHostStatus(status, message) {
  const n = el('host-status');
  if (!n) return;
  n.dataset.status = status;
  n.hidden = status === 'idle';
  // on failure the parent's message verbatim — it is the owner's own tool's words
  n.textContent = status === 'failed' && message ? `${TB[HOST_STATUS_KEY.failed]}${COLON}${message}` : (TB[HOST_STATUS_KEY[status]] || '');
  const btn = el('host-save');
  if (btn) btn.disabled = status === 'saving';
}

/** Cmd/Ctrl+S saves — installed on every same-origin document that can hold focus (the page, the
 * card, the board), because a keydown inside an iframe never reaches the parent document. */
function hostSaveKey(doc) {
  if (!S.host || !doc || doc.__ct2HostKeys) return;
  doc.__ct2HostKeys = true;
  doc.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (S.bridge) S.bridge.save();
    }
  }, true);
}

function bootHost() {
  document.body.dataset.hostWaiting = '1';          // nothing to edit until the parent hands a card over
  const saveBtn = el('host-save');
  saveBtn.textContent = T.pubSave;
  saveBtn.hidden = false;
  S.bridge = createHostBridge({
    host: S.host,
    post: (msg, origin) => window.parent.postMessage(msg, origin),
    onStatus: paintHostStatus,
    onLoad: ({ md, handle, cardUrl }) => {
      S.handle = handle || S.handle;
      S.cardUrl = cardUrl || '';
      S.undo = [];
      delete document.body.dataset.hostWaiting;
      commit(md, { undoable: false });
    },
  });
  saveBtn.onclick = () => S.bridge.save();
  window.addEventListener('message', (e) => S.bridge.receive(e));
  hostSaveKey(document);
  window.addEventListener('beforeunload', (e) => {
    if (!S.bridge.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  S.bridge.ready();
}

// ── boot ─────────────────────────────────────────────────────────────────────────────────────────
export function boot(opts = {}) {
  const q = typeof location !== 'undefined' ? new URL(location.href).searchParams : new URLSearchParams();
  const localeKey = primaryLocale(q.get('lang') || q.get('locale') || opts.locale
    || (typeof navigator !== 'undefined' && navigator.language) || 'en');
  S.locale = localeKey;
  // HOST MODE wins over everything: an allowed parent origin means a real card, never the sandbox.
  S.host = validHostOrigin(opts.host) || '';
  S.sandbox = !S.host && opts.sandbox !== false;
  T = chromeStrings(localeKey);
  TX = cellStrings(localeKey);
  TB = boardStrings(localeKey);
  COLON = colon(localeKey);
  const persona = SANDBOX_LOCALES[localeKey];
  if (document.documentElement) document.documentElement.lang = persona.lang;

  // static markup that no paint*() rebuilds — set once, from the same tables everything else reads
  el('modal-close').setAttribute('aria-label', T.modalCloseAria);
  el('md-close').setAttribute('aria-label', T.modalCloseAria);
  el('picker-close').setAttribute('aria-label', T.modalCloseAria);
  el('raw-summary').textContent = T.modalRawSummary;
  el('raw-note').textContent = T.modalRawNote;
  el('modal-delete').textContent = T.modalDelete;
  el('modal-save').textContent = T.modalSave;
  el('modal-up').textContent = T.moveUp;
  el('modal-down').textContent = T.moveDown;
  el('table').title = TB['board.tableTitle'];
  el('canvas').title = TB['board.previewTitle'];
  el('canvas').addEventListener('load', wireCard);
  el('table-heading').textContent = TB['board.tableTitle'];
  el('coach-text').textContent = persona.coachMark;
  el('coach').hidden = !(S.sandbox || S.host) || coachSeen();
  el('coach-close').setAttribute('aria-label', T.modalCloseAria);
  el('coach-close').onclick = coachDone;

  el('modal-close').onclick = closeModal;
  el('modal-save').onclick = saveCell;
  el('modal-delete').onclick = deleteCell;
  el('modal-up').onclick = () => moveCell(-1);
  el('modal-down').onclick = () => moveCell(1);
  el('modal').addEventListener('click', (e) => { if (e.target === el('modal')) closeModal(); });
  el('picker-close').onclick = () => { el('picker').hidden = true; };
  el('picker').addEventListener('click', (e) => { if (e.target === el('picker')) el('picker').hidden = true; });
  el('md-close').onclick = () => closeMdMode(false);
  el('md-cancel').onclick = () => closeMdMode(false);
  el('md-done').onclick = () => closeMdMode(true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('modal').hidden) closeModal();
    else if (!el('picker').hidden) el('picker').hidden = true;
    else if (!el('mdmodal').hidden) closeMdMode(false);
    else if (!el('doormodal').hidden) el('doormodal').hidden = true;
  });

  // the view switch — every word already exists: the card (chrome `canvasTitle`), the board
  // (`board.viewBoard`), Markdown (`board.viewMd`)
  el('view-card').textContent = T.canvasTitle;
  el('view-board').textContent = TB['board.viewBoard'];
  el('view-md').textContent = TB['board.viewMd'];
  for (const b of document.querySelectorAll('[data-view-btn]')) b.onclick = () => setView(b.dataset.viewBtn);
  S.view = 'card';
  const firstView = readView();
  setView(firstView === 'md' ? 'card' : firstView);

  // ── the banner, and the door ───────────────────────────────────────────────────────────────────
  el('sandbox-banner-text').textContent = persona.bannerText;
  el('sandbox-banner-status').textContent = persona.bannerStatus;
  el('sandbox-reset').textContent = persona.reset;
  el('sandbox-reset').onclick = () => { clearDraft(); commit(buildSandboxCard(localeKey), { undoable: false }); };
  el('sandbox-banner').hidden = !S.sandbox;

  const doorBtn = el('publish');
  doorBtn.textContent = persona.doorCta;
  doorBtn.hidden = !S.sandbox;
  el('door-title').textContent = persona.doorCta;
  el('door-note').textContent = persona.doorNote;
  el('door-go').textContent = persona.doorContinue;
  el('door-back').textContent = persona.doorBack;
  el('door-back').onclick = () => { el('doormodal').hidden = true; };
  el('doormodal').addEventListener('click', (e) => { if (e.target === el('doormodal')) el('doormodal').hidden = true; });
  // 🔴 NOTHING CLEARS THE DRAFT HERE. `/try/edit`'s door used to, and a visitor who did not finish
  // signing up came back to find ten minutes of work gone, deleted by the button labelled "make
  // this real". 「重新開始」 is the exit that empties it, and it says so.
  el('door-go').onclick = async () => {
    el('door-go').disabled = true;
    const draft = await parkSandboxCard(S.md, { origin: location.origin });
    location.href = sandboxDoorHref(S.md, { draft });
  };
  doorBtn.onclick = () => { el('doormodal').hidden = false; el('door-go').disabled = false; el('door-go').focus(); };

  // ── the table ──────────────────────────────────────────────────────────────────────────────────
  S.tableBase = opts.tableBase || `/try/edit/t/${encodeURIComponent(localeKey)}/`;
  const frame = el('table');
  frame.addEventListener('load', onTableFrameLoad);
  frame.src = S.tableBase;

  // A returning visitor's own edits win; a fresh browser gets the persona. Never a network read.
  const draft = S.sandbox ? readDraft() : '';
  const cells = draft ? (() => { try { return parseCard(draft).cells.length; } catch { return 0; } })() : 0;
  // 🔴 HOST MODE NEVER BUILDS THE SEED. A real card's editor that shows "Sam, family doctor" for
  // even a moment — or forever, when the load never lands — is showing somebody else's card. The
  // canvas stays empty (no srcdoc, no [data-cell]) until card:load; the status says we are waiting.
  if (S.host) bootHost();
  else commit(cells ? draft : buildSandboxCard(localeKey), { undoable: false, reloadTable: false });
  if (firstView === 'md' && S.model) setView('md');      // after the card exists: the mode edits S.md

  // the harness drives these; harmless in normal use
  window.__cardtileW2 = {
    get md() { return S.md; },
    get model() { return S.model; },
    get locale() { return S.locale; },
    get lanes() { return boardLanes(S.model, bridgeCtx()); },
    get slots() { return boardSlots(S.model, bridgeCtx()); },
    get tugs() { return drawerLinks(S.model, bridgeCtx()); },
    get ready() { return !!(tableWin() && tableWin().__ready); },
    boardMd: () => boardMd(S.model, bridgeCtx()),
    load: (md) => commit(md, { undoable: false }),
    openPicker, addCell, openCell, saveCell, closeModal, deleteCell, undo,
    openMdMode, closeMdMode, setView, syncOrder,
    field: (name) => el(`f-${name}`),
    tableDoc,
  };
}
