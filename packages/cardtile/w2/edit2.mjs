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
//   · the 牽線 between a tile and the drawer it opens;
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
import { boardStrings, colon } from './board-i18n.mjs';
import { typeIconSvg } from './type-icons.mjs';
import {
  boardLanes, boardSlots, boardMd, applyBoardOrder, drawerLinks, cardTitle, tileFace,
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
  drawerPrefix: T.targetDrawer,
  drawerTitle: (id) => {
    const d = (S.model.drawers || []).find((x) => x.id === id);
    return d ? (d.title || d.id) : id;
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
  paintPreview();
  if (reloadTable) loadTable();
  else decorate();                                  // the 牽線 can change without the order changing
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
    cardUrl: '',
    // the two EDIT-ONLY placeholders the renderer draws for a tile whose address or picture is not
    // filled in yet — handed in from here because this side speaks nine locales and card-render's
    // own table deliberately speaks four.
    editStrings: { linkUnset: T.linkUnset, imgUnset: T.imgUnset },
  })
    // the guard's one sentence, in the visitor's language — the same nine-locale string the table's
    // own dangling badge carries, because it is the same fact said in the other pane.
    + `<script>window.__CT2_HINT__=${JSON.stringify({ dangling: TB['board.danglingDrawer'] })}<\/script>`
    + PREVIEW_GUARD;
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
    if (w && w.__ready) { wireTable(); loadTable(); el('table').classList.add('is-ready'); return; }
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
  /* 牽線 — the visible line between a tile and the drawer it opens. A badge on each end, so it
     survives the phone's vertical stack where the two ends are nowhere near each other, plus a
     drawn line on the wide layout where they are.
     🩸 11px and a whole sentence: the ja badge measured 194px at 390 and ran into the lane's edge.
     The badge NAMES the other end (「↳ 更多」「↰ 預約」) and the sentence moved to its title
     attribute — shorter in every language, and legible at 12px instead of 11.
     (Still no backticks in here: this block is one template literal, see the note above.) */
  .ct2-tug { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; max-width: 100%;
    font-size: 12px; font-weight: 600; border-radius: 999px; padding: 2px 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
    color: var(--text-accent); }
  .ct2-tug-bad { background: color-mix(in srgb, var(--text-error) 18%, transparent); color: var(--text-error); }
  .ct2-tug-lane { margin-left: 6px; }
  .ct2-wire { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: visible; }
  .ct2-wire path { fill: none; stroke: var(--text-accent); stroke-width: 2; stroke-dasharray: 4 4; opacity: .75; }
`;

function wireTable() {
  const doc = tableDoc();
  if (!doc || S.wired) return;
  S.wired = true;

  const style = doc.createElement('style');
  style.textContent = BOARD_CSS;
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
    if (t.closest('#md')) { stop(); openMdMode(); return; }

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

  doc.defaultView.addEventListener('resize', drawWires);
  doc.addEventListener('scroll', drawWires, true);
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

// ── decoration: the lane keys and the 牽線 ───────────────────────────────────────────────────────
function decorate() {
  const doc = tableDoc();
  if (!doc || !S.model) return;
  const lanes = boardLanes(S.model, bridgeCtx());
  const els = [...doc.querySelectorAll('.tugtile__lane')];
  els.forEach((lane, i) => { if (lanes[i]) lane.dataset.cardLane = lanes[i].key; });

  for (const old of doc.querySelectorAll('.ct2-tug')) old.remove();
  const tiles = [...doc.querySelectorAll('.tugtile__list > .tugtile__tile')];
  const { links, dangling } = drawerLinks(S.model, bridgeCtx());

  // the OUT end: on the tile that opens a drawer.
  //
  // 🔴 THE BADGE NAMES THE OTHER END; the sentence is its `title`. A badge that reads 「牽到抽屜：更多」
  // is 106px in zh and 194px in ja — at 390 the Japanese one ran from x176 into the lane's own edge
  // (cold read §4). 「↳ 更多」 is the same fact, is the width of the drawer's name in every language,
  // and leaves room to be legible at 12px rather than 11.
  const badge = (text, tip, bad) => {
    const s = doc.createElement('span');
    s.className = 'ct2-tug' + (bad ? ' ct2-tug-bad' : '');
    s.textContent = text;
    if (tip) s.title = tip;
    return s;
  };
  const laneOfKey = (key) => els[lanes.findIndex((l) => l.key === key)];
  for (const l of links) {
    const tile = tiles[l.slot];
    if (tile) {
      tile.appendChild(badge(`↳ ${l.drawerTitle}`, `${TB['board.opensDrawer']}${COLON}${l.drawerTitle}`));
      tile.dataset.ct2Tug = l.drawerId;
    }
  }
  for (const d of dangling) {
    const tile = tiles[d.slot];
    if (tile) tile.appendChild(badge(`⚠ ${d.drawerId}`, TB['board.danglingDrawer'], true));
  }
  // the IN end: on the drawer's own lane head — second-level cards live in the second lane and
  // link back, so the lane says so rather than leaving the line one-directional. It names the TILE
  // it is opened from, for the same reason the other end names the drawer.
  const opened = new Map();
  for (const l of links) if (!opened.has(l.drawerId)) opened.set(l.drawerId, l.slot);
  for (const [id, slot] of opened) {
    const lane = laneOfKey(`drawer:${id}`);
    const head = lane && lane.querySelector('.tugtile__lane-head');
    if (!head) continue;
    const from = (boardSlots(S.model, bridgeCtx())[slot] || {}).cell;
    const b = badge(`↰ ${from ? tileFace(from, bridgeCtx()).title : TB['board.openedFrom']}`, TB['board.openedFrom']);
    b.classList.add('ct2-tug-lane');
    head.appendChild(b);
  }
  drawWires();
}

/**
 * The LINE, on the layouts where both ends are on screen at once. Progressive: the badges above are
 * the guarantee, this is the picture. Redrawn on scroll and resize because both ends move.
 */
function drawWires() {
  const doc = tableDoc();
  if (!doc || !S.model) return;
  const board = doc.getElementById('board');
  if (!board) return;
  let svg = doc.querySelector('.ct2-wire');
  if (!svg) {
    svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ct2-wire');
    board.appendChild(svg);
  }
  const box = board.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`);
  svg.style.width = `${box.width}px`;
  svg.style.height = `${box.height}px`;
  svg.style.left = `${board.scrollLeft}px`;
  svg.style.top = `${board.scrollTop}px`;
  const paths = [];
  for (const tile of doc.querySelectorAll('.tugtile__tile[data-ct2-tug]')) {
    const lane = doc.querySelector(`.tugtile__lane[data-card-lane="drawer:${CSS.escape(tile.dataset.ct2Tug)}"]`);
    const head = lane && lane.querySelector('.tugtile__lane-head');
    if (!head) continue;
    const a = tile.getBoundingClientRect();
    const b = head.getBoundingClientRect();
    if (!a.width || !b.width) continue;
    const x1 = a.right - box.left; const y1 = a.top + a.height / 2 - box.top;
    const x2 = b.left - box.left; const y2 = b.top + b.height / 2 - box.top;
    const mid = (x1 + x2) / 2;
    paths.push(`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}"/>`);
  }
  svg.innerHTML = paths.join('');
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
  if (!apply) { el('mdmodal').hidden = true; return; }
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
  if (value !== S.md) commit(value); else paintPreview();
}

// ── the phone's two tabs ─────────────────────────────────────────────────────────────────────────
function setView(view) {
  document.body.dataset.view = view;
  el('tab-table').setAttribute('aria-selected', view === 'preview' ? 'false' : 'true');
  el('tab-preview').setAttribute('aria-selected', view === 'preview' ? 'true' : 'false');
  if (view === 'table') drawWires();          // the board was display:none; its boxes are new
}

// ── boot ─────────────────────────────────────────────────────────────────────────────────────────
export function boot(opts = {}) {
  const q = typeof location !== 'undefined' ? new URL(location.href).searchParams : new URLSearchParams();
  const localeKey = primaryLocale(q.get('lang') || q.get('locale') || opts.locale
    || (typeof navigator !== 'undefined' && navigator.language) || 'en');
  S.locale = localeKey;
  S.sandbox = opts.sandbox !== false;
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

  el('tab-table').textContent = TB['board.tabEdit'];
  el('tab-preview').textContent = TB['board.tabCard'];
  el('tab-table').onclick = () => setView('table');
  el('tab-preview').onclick = () => setView('preview');
  setView('table');

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
  commit(cells ? draft : buildSandboxCard(localeKey), { undoable: false, reloadTable: false });

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
