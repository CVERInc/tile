// cardtile-w — the human editor.
//
// See docs/SPEC-cardtile-w.md. The two rules everything here obeys:
//
//   1. The canvas is rendered by `renderCardHTML` — the SAME function the Worker calls — into an
//      iframe. Not a preview of the card: the card. So the row runs, the frame table, picture labels
//      and the centred header are all visible while you arrange them, and there is no second
//      renderer to drift.
//   2. Every mutation goes through card-core. This file never assembles markdown. What a self-built
//      model loses is the params it has no UI for, which is exactly the long tail a creator wrote by
//      hand — and their card is their only copy.
import {
  parseCard, serializeCard, reorder, normalizeCell, setTitle,
} from '../card-core.js';
import { cardUrlFor, renderCardHTML } from '../serve/card-worker.mjs';
// 🔴 The forms are BUILT from the shared ai_ops definition, not from a copy of it. fields.mjs was
// that copy for one day and it was already behind: the renderer honours video.poster, video.title
// and embed.origin/narrow/bg, and the form had never heard of any of them. One definition, and a
// test (ai-ops.test.mjs) that it cannot drift from the renderer.
import { CELL_TYPES, blankCell, PALETTE, CONTROL, DISPOSITION } from '../ai-ops.mjs';
// 🔴 The seven typed sheets are PURE and SHARED — see cell-form-core.mjs's header. `w2/edit2.mjs`
// (`/try/edit`) mounts the same rows over the tugtile board; the composition rules (a link's `[text](url)`, the
// profile rename, which param a drawer choice owns) exist once, here, for both. `setToken`,
// `removeToken`, `quoteParam`, `linkOf` and `hostLabel` moved WITH them — this file no longer
// touches a param token or parses a link body itself, which is the point.
import { esc, flatRows, formBodyHtml, composeCell } from './cell-form-core.mjs';
import { whatIsWrong } from './md-guard.mjs';
// 🔴 The tile definitions carry KEYS; the words live here, in nine locales. `ai-ops.mjs` is the
// SHARED definition (MCP and GAIDO read it too) and must not import an editor surface, so the
// resolution happens on THIS side — see cell-i18n.mjs's header for why it is keyed key-first.
import { CELL_STRINGS_ZH, cellStrings, text as tx } from './cell-i18n.mjs';
// The `card.feelreef.com/try/edit` sandbox (chodaict, rebuilt 2026-09 after the legacy
// `feelreef.com/card/try` route — same product, new substrate — was retired 2026-08-28 by
// 3fcfb09ff). Both modules are pure; sandbox mode is this file deciding NOT to touch `/_w/*`.
import { sandboxDoorHref, parkSandboxCard } from './sandbox-door.mjs';
import {
  buildSandboxCard, chromeStrings, primaryLocale, SANDBOX_LOCALES,
} from './sandbox-i18n.mjs';

// 🔴 THE REAL EDITOR'S DEFAULT LANGUAGE, NOT A FALLBACK. `w/editor.mjs` is documented (see this
// file's own header and HANDOFF.md) as a local-only dev/ops tool with Traditional-Chinese-only
// chrome — that was a deliberate call, not an oversight, so it stays exactly as it always read.
// `T` starts as these exact literal strings (byte-for-byte what used to be hard-coded inline) and
// bootSandbox() is the ONLY place that ever replaces it — with chromeStrings(locale), a table that
// itself carries this same `zh` object as ITS fallback (sandbox-i18n.mjs), so the two can never
// drift into two different ideas of what the Traditional Chinese chrome says.
let T = {
  menu: '選單',
  undo: '復原',
  openFile: '開啟 .md',
  download: '下載 .md',
  addCellHeader: '加一張牌',
  faceTabLabel: '卡片正面',
  addDrawerButton: '＋抽屜',
  addDrawerTitleAttr: '新增抽屜',
  addDrawerPrompt: '抽屜的標題（訪客會看到）',
  addDrawerPromptDefault: '更多',
  addDrawerDuplicateAlert: '已經有同名的抽屜了。',
  modalCloseAria: '關閉',
  modalRawSummary: '原始參數',
  modalRawNote: '表單只動它認得的參數，其他的原封不動留著。',
  modalDelete: '刪除這張牌',
  modalSave: '完成',
  deleteConfirm: '刪除這張牌？',
  selectDefaultOption: '（預設）',
  unknownCellHint: '這種牌還沒有表單，只能改原始設定。',
  unknownCellBodyLabel: '內容',
  canvasTitle: '卡片',
  assetPick: '選一張圖片',
  assetReplace: '換一張',
  assetUrl: '或貼上圖片網址',
  assetTooBig: '這張太大了，換一張或縮小再試。',
  assetUnreadable: '讀不到這個檔案，換一張試試。',
  targetUrl: '網址',
  targetDrawer: '抽屜：',
  needAddress: '要有網址',
  needValue: '這一欄要填',
  linkUnset: '還沒填網址',
  imgUnset: '＋ 加一張圖片',
  moveUp: '往上移',
  moveDown: '往下移',
  mdMode: 'Markdown 模式',
  mdBack: '回到卡片',
  mdBroken: '第 {n} 行看不懂，卡片沒有改。',
  cardUrlHeader: '卡片網址',
  cardUrlNote: 'QR 碼指向這裡，社群列裡連到同一個網域的那個也會換成手繪的房子圖示。它不存在檔案裡 — 上線時由網址決定。',
  mdHeader: 'markdown（就是存起來的那份）',
  mdNote: '改這裡的文字，卡片會跟著變 — 兩個方向都是同一份檔案。',
  pubTitle: '存到線上',
  pubBackup: '先存一份 .md 到下載資料夾',
  pubNote: '卡片沒有「發佈」這一步 — 按下去就是線上的樣子。',
  pubCancel: '取消',
  pubSave: '存',
};

// the editor's view of the definition: the types, with only the params that asked for a control.
// RAW and RETIRED params are still carried through an edit untouched — they just have no field.
const TYPES = Object.fromEntries(Object.entries(CELL_TYPES).map(([type, def]) => [type, {
  ...def,
  fields: Object.entries(def.params)
    .filter(([, p]) => p.disposition === DISPOSITION.FORM)
    .map(([name, p]) => ({ name, ...p })),
}]));

// 🔴 THE SAME SHAPE AS `T`, AND FOR THE SAME REASON. The internal editor is Traditional-Chinese-only
// by decision, so this starts as the zh table — byte-identical to the literals that used to live in
// ai-ops.mjs — and bootSandbox() is the only place that ever replaces it. A visitor's language now
// reaches the palette and every form label, not just the buttons around them.
let TX = CELL_STRINGS_ZH;
/** a definition's title/label/hint (a KEY) → the words, in the language currently loaded */
const say = (key) => tx(TX, key);

// 🩸 Was `../../../tugtile-w/Sortable.min.js`. That directory stopped existing when the `-w`
// surfaces were retired, and the editor answered with a 404 and a shrug — see dragEnabled below.
// 🔴 OVERRIDABLE, not just computed. `import.meta.url` is only meaningful in the served-as-a-real-
// module context this file has locally (w/serve.mjs) — a bundled build (gen-editor-assets.mjs, for
// card.feelreef.com/try/edit) has no such URL, esbuild bakes in the BUILD machine's path if asked,
// and that path would not exist on a visitor's machine. So the bundling build sets
// `window.__CARDTILE_SORTABLE_SRC__` on the page BEFORE this module runs, and that wins when
// present; local dev never sets it, so this is exactly the URL it has always been there.
const SORTABLE_SRC = (typeof window !== 'undefined' && window.__CARDTILE_SORTABLE_SRC__)
  || new URL('../../../Sortable.min.js', import.meta.url).href;

const el = (id) => document.getElementById(id);

// ── state ────────────────────────────────────────────────────────────────────────────────────────
// `md` is the truth. `model` is a projection of it that is thrown away and rebuilt on every change,
// so there is never a moment where the two could disagree about what the file says.
const S = {
  md: '',
  model: null,
  handle: 'card',
  // set from the local bridge: whether this machine holds a token, and the version the open card was
  // read at. `baseVersion` null ⇒ the save is UNGUARDED, and the confirmation says so out loud.
  canSave: false,
  baseVersion: null,
  cardUrl: '',
  lane: { kind: 'face', id: '' },   // which lane the palette adds to and drag reorders within
  undo: [],
  dragging: false,
  // 🔴 SANDBOX MODE. Set once, at boot, from the caller's opts — never flips mid-session. When true:
  // no `/_w/*` bridge call is ever made (not even `can-save`), every commit is mirrored into
  // localStorage instead of a real card, and `publish`'s button is repurposed into the door out
  // (see sandboxDoorHref) rather than hidden-until-proven-savable.
  sandbox: false,
  locale: 'en',
};

/** Where a sandbox visitor's in-progress card lives. Never sent anywhere — see commit(). */
const SANDBOX_STORAGE_KEY = 'cardtile:try:draft:v1';

/** Best-effort localStorage read. `''` on anything (no window, private browsing, quota, no key) —
 *  every caller treats that exactly like "no draft yet", the same contract as feelreef's retired
 *  `sandboxWrites.ts`. */
function readSandboxDraft() {
  try {
    return (typeof window !== 'undefined' && window.localStorage.getItem(SANDBOX_STORAGE_KEY)) || '';
  } catch {
    return '';
  }
}

/** Best-effort localStorage write. Never throws into a caller mid-edit — a draft that fails to
 *  persist still works for the rest of THIS page load, it just will not survive a reload. */
function writeSandboxDraft(md) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(SANDBOX_STORAGE_KEY, md);
  } catch { /* best-effort */ }
}

/** Wipe the sandbox draft — a reload after this sees the fresh persona again, same as a visitor's
 *  very first open of `/try/edit`. */
export function clearSandboxDraft() {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(SANDBOX_STORAGE_KEY);
  } catch { /* best-effort */ }
}

/**
 * The card's PUBLIC URL, which is a render input and not file content.
 *
 * 🔴 It is not cosmetic. `social` gives a link to the creator's OWN domain a drawn house mark
 * instead of a favicon, and "own" means "same registrable host as cardUrl" — so guessing
 * card.feelreef.com/<handle> made one creator's first social mark an EMPTY CIRCLE in the editor while the
 * live card shows a house. A preview that quietly disagrees with production about which link is the
 * author's own site is the thing this editor exists not to be.
 *
 * Computed by the Worker's own cardUrlFor — the inverse of the routing, imported rather than
 * restated — over whatever bindings the CALLER knows about. A browser cannot read the store, so an
 * editor opened with nothing said about the card gets the canonical path; and the field stays
 * author-editable, because a card on a domain nobody has told us about is the normal case for the
 * next creator.
 */

const laneCells = () => (S.lane.kind === 'face'
  ? S.model.cells
  : (S.model.drawers.find((d) => d.id === S.lane.id) || { cells: [] }).cells);

/** the ONE place the model changes: take a new markdown string, re-parse, repaint. */
function commit(nextMd, { undoable = true } = {}) {
  if (undoable) S.undo.push(S.md);
  S.md = nextMd;
  S.model = parseCard(S.md);
  if (S.lane.kind === 'drawer' && !S.model.drawers.some((d) => d.id === S.lane.id)) S.lane = { kind: 'face', id: '' };
  // 🔴 THE ONLY PLACE A SANDBOX WRITE GOES. commit() is the one function every mutation in this file
  // already funnels through (addCell, saveCell, deleteCell, onDrop, the raw-markdown textarea, undo)
  // — so gating HERE, once, is what makes "sandbox writes never leave the browser" true by
  // construction rather than by every call site remembering to check. Never network, never `/_w/*`.
  if (S.sandbox) writeSandboxDraft(S.md);
  paint();
}

/** mutate the model through a callback, then serialize. Never build markdown by hand. */
const edit = (fn) => {
  const next = fn(structuredClone({ ...S.model }));
  commit(serializeCard(next));
};

// ── the canvas ───────────────────────────────────────────────────────────────────────────────────
//
// 🔴 `editIndex: true` asks the renderer for `data-cell` attributes. A cell can render to the empty
// string (a link with no url, a video with neither yt nor channel), so the editor cannot map "the
// 4th box on screen" back to "the 4th cell in the file" by counting boxes. Guessing that would put
// an edit on the wrong cell. verify/editor-fidelity.mjs asserts that stripping the attribute
// reproduces the production bytes exactly, so what is being dragged is still what is being served.
function canvasHtml() {
  const doc = renderCardHTML(S.md, {
    handle: S.handle,
    cardUrl: S.cardUrl,
    editIndex: true,
    // the two EDIT-ONLY placeholders the renderer draws for a tile whose address or picture is not
    // filled in yet. Handed in from here because this side speaks the console's nine locales and
    // card-render's own table deliberately speaks four — see its `label()`.
    editStrings: { linkUnset: T.linkUnset, imgUnset: T.imgUnset },
  });
  const inject = `<script src="${esc(SORTABLE_SRC)}"><\/script>`;
  if (!doc.includes('</body>')) throw new Error('the rendered document has no </body> — the canvas cannot be wired');
  return doc.replace('</body>', inject + '</body>');
}

function paint() {
  const frame = el('canvas');
  frame.srcdoc = canvasHtml();
  el('md').value = S.md;
  el('cardurl').value = S.cardUrl;
  paintLanes();
  paintPalette();
  el('undo').disabled = !S.undo.length;
}

// ── the canvas's height on a phone ───────────────────────────────────────────────────────────────
//
// 🔴 The stacked layout gives the iframe no height of its own — the page scrolls, once, so the
// canvas has to be exactly as tall as the card inside it. That number lives in the iframe's own
// document and nowhere else, so it is read from there and written back out. On desktop the inline
// height is CLEARED, not left behind: the two-column grid wants `height:100%` and an inline pixel
// value from a narrow window would survive a resize and pin it.
const STACKED = '(max-width: 768px)';
const isStacked = () => typeof matchMedia === 'function' && matchMedia(STACKED).matches;

function fitCanvas() {
  const frame = el('canvas');
  if (!frame) return;
  if (!isStacked()) { frame.style.height = ''; return; }
  const doc = frame.contentDocument;
  if (!doc || !doc.body) return;
  const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
  if (h > 0) frame.style.height = `${h}px`;
}

/** wire the freshly-loaded canvas. srcdoc inherits our origin, so we reach in directly. */
function wireCanvas() {
  const frame = el('canvas');
  const doc = frame.contentDocument;
  if (!doc) return;
  const win = frame.contentWindow;
  // the card's own height, followed as it changes: images finishing, a drawer opening, a font
  // arriving. Without this the canvas is right once and wrong after the first picture loads.
  fitCanvas();
  if (win.ResizeObserver && doc.body) {
    const ro = new win.ResizeObserver(() => fitCanvas());
    ro.observe(doc.body);
  }

  // which container holds the cells of the lane being edited
  const root = S.lane.kind === 'face'
    ? doc.querySelector('.st-card')
    : doc.getElementById(`drawer-${S.lane.id}`) || doc.querySelector(`[data-drawer-panel="${S.lane.id}"]`);
  if (!root) return;

  for (const cell of root.querySelectorAll('[data-cell]')) {
    cell.classList.add('ctw-cell');
    cell.addEventListener('click', (e) => {
      if (S.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      openCell(Number(cell.dataset.cell));
    }, true);
  }
  // the lane being edited is the one you can touch; the rest of the card stays visible and inert,
  // because hiding it would be showing you a layout that is not the one you are arranging.
  doc.documentElement.classList.add('ctw-editing');
  const style = doc.createElement('style');
  style.textContent = CANVAS_CSS;
  doc.head.appendChild(style);

  // 🔴 DEGRADE, BUT SAY SO. Losing drag is survivable — clicking still reorders — so this must not
  // throw at a person mid-edit. But a silent `return` is how it stayed lost for six days after the
  // path went stale: the editor looked fine, nothing was red, and the only symptom was a feature
  // that quietly was not there. So the fact is recorded where both a human and a harness can see it.
  const Sortable = win.Sortable;
  S.dragEnabled = !!Sortable;
  if (!Sortable) {
    console.warn(`[cardtile] drag is OFF — ${SORTABLE_SRC} did not load. Click-to-reorder still works.`);
    return;
  }
  // Cells of one lane live in several containers: each `.st-cells` grid, each `.st-run` wrapper, and
  // a `.st-bleed` per prose cell. One shared group lets a cell move between all of them.
  //
  // 🩸 …BUT ONLY THE INNERMOST ONE. `.st-run` (the wrapper two full-width link tiles get merged
  // into) lives INSIDE `.st-cells`, so both got a Sortable and both claimed the same elements. The
  // measured effect was exact: link→text moved, link→link — the pair that share an `.st-run` —
  // never did, and neither did profile→link. Two instances fighting over one child is not a
  // near-miss, it is a reorder that silently does nothing to the file.
  //
  // A container qualifies when it DIRECTLY contains a `[data-cell]`. An ancestor whose cells all sit
  // inside a nested run has nothing of its own to drag and gets no instance.
  const containers = [...root.querySelectorAll('.st-cells, .st-run, .st-bleed')]
    .filter((c) => [...c.children].some((n) => n.matches('[data-cell]')));
  // 🔴 EXPOSED so a harness can read the fix instead of inferring it. `doubleClaimed` is the defect
  // itself, counted: a tile sitting inside two of these containers is one Sortable overriding
  // another, which is what made link→link and profile→link silently do nothing.
  S.dragContainers = {
    count: containers.length,
    classes: containers.map((c) => c.className.trim().split(/\s+/)[0]),
    doubleClaimed: [...root.querySelectorAll('[data-cell]')]
      .filter((n) => containers.filter((c) => c.contains(n)).length > 1).length,
  };
  for (const c of containers) {
    new Sortable(c, {
      group: { name: 'ctw', pull: true, put: true },
      animation: 120,
      draggable: '[data-cell]',
      // 🔴 NEVER the browser's own HTML5 drag-and-drop. This canvas is a `srcdoc` iframe, and native
      // DnD across that boundary is where every one of the nine measured attempts died — including
      // real touch events, which get long-press text selection instead of a drag. Sortable's own
      // fallback implementation is pointer events all the way down, so it behaves the same in the
      // frame as out of it.
      forceFallback: true,
      fallbackTolerance: 6,
      // a short press before a touch drag begins, so a TAP still opens the form. Mouse is unaffected.
      delay: 150,
      delayOnTouchOnly: true,
      // 🔴 freeze background scroll for the DURATION of a drag — same fix as tugtile's
      // `.is-dragging { touch-action: none }` (release/obsidian-tugtile styles.css): on a touch
      // screen, without this a finger dragging a cell also scrolls the page underneath it, and the
      // two gestures fight. `.ctw-editing` is the root class already set once above; this only adds
      // the touch-action override while a drag is actually in progress.
      onStart: () => { S.dragging = true; doc.documentElement.classList.add('ctw-dragging'); },
      onEnd: (ev) => {
        doc.documentElement.classList.remove('ctw-dragging');
        setTimeout(() => { S.dragging = false; }, 0);
        onDrop(root, Number(ev.item.dataset.cell));
      },
    });
  }
}

/**
 * Turn a drop into ONE card-core `reorder`.
 *
 * 🔴 Not "read the DOM order and rebuild the list". A cell that renders to nothing has no element,
 * so a DOM-order rebuild would drop it out of the file entirely — the card would look right and be
 * missing a cell. Reading the drop as a single from→to move leaves every invisible cell exactly
 * where it was, and uses the primitive that round-trip.test.mjs already covers.
 */
function onDrop(root, from) {
  const order = [...root.querySelectorAll('[data-cell]')].map((n) => Number(n.dataset.cell));
  const j = order.indexOf(from);
  if (j < 0) { paint(); return; }
  const cells = laneCells();
  let to;
  if (j === order.length - 1) to = cells.length - 1;
  else {
    const next = order[j + 1];
    to = next > from ? next - 1 : next;          // index AFTER the splice-out, which is what reorder wants
  }
  if (to === from) { paint(); return; }
  edit((m) => {
    if (S.lane.kind === 'face') return reorder(m, from, to);
    const d = m.drawers.find((x) => x.id === S.lane.id);
    d.cells = reorder({ cells: d.cells }, from, to).cells;
    return m;
  });
}

// injected into the canvas: just enough to say "this is editable", nothing that moves anything
// 🔴 `.sortable-drag`/`.sortable-chosen`/`.sortable-ghost` are Sortable's own default class names
// (unchanged from the library — no custom `dragClass`/`chosenClass` option is passed above), which
// is also what release/obsidian-tugtile/styles.css's tile drag styling targets ("Dragging state
// (corresponding to the Sortable class in main.js)"). The "picked up" tilt below borrows that same
// styling idea (rotate/scale as STANDALONE CSS properties, never `transform`) for the same reason
// tugtile's own comment gives: Sortable already animates the dragged element's position via its own
// `transform: translate(...)` on every frame, so a rule using the shorthand `transform` property
// here would overwrite that translation outright — `rotate`/`scale` compose with it instead of
// replacing it. No CSS transition on either: Sortable's own `animation: 120` already handles the
// motion, and adding a second, independent one here is exactly the kind of thing
// prefers-reduced-motion exists to catch, so it is left out rather than guarded.
// 🔴 The grip. Drawn HERE rather than in card-render's markup, because it is an editor affordance
// and a live card must never carry it — the production bytes have to stay byte-identical with
// `editIndex` stripped (verify/editor-fidelity asserts exactly that). It is a hint, not a handle:
// the whole tile is draggable, and the grip is what tells you so. `pointer-events:none` so it can
// never eat the tap that opens the form.
const GRIP = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'"
  + " fill='%23ffffff'%3E%3Ccircle cx='9' cy='6' r='1.7'/%3E%3Ccircle cx='9' cy='12' r='1.7'/%3E"
  + "%3Ccircle cx='9' cy='18' r='1.7'/%3E%3Ccircle cx='15' cy='6' r='1.7'/%3E"
  + "%3Ccircle cx='15' cy='12' r='1.7'/%3E%3Ccircle cx='15' cy='18' r='1.7'/%3E%3C/svg%3E\")";

const CANVAS_CSS = `
/* 🩸 A DRAG THAT SELECTS TEXT. Without this, pulling a tile highlighted the paragraph under the
   finger instead — measured, screenshotted, and the reason a real drag looked like a broken one. */
.ctw-cell{cursor:grab;position:relative;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.ctw-cell::after{content:'';position:absolute;top:5px;left:5px;width:16px;height:16px;opacity:0;
  background:${GRIP} center/contain no-repeat;pointer-events:none;transition:opacity .15s;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.ctw-cell:hover::after,.ctw-cell.sortable-chosen::after{opacity:.75}
@media (hover:none){.ctw-cell::after{opacity:.5}}
@media (prefers-reduced-motion:reduce){.ctw-cell::after{transition:none}}
.ctw-cell:hover{outline:2px solid var(--cp-accent);outline-offset:2px}
.ctw-cell.sortable-ghost{opacity:.35}
.ctw-cell.sortable-drag{rotate:2deg;scale:1.03;box-shadow:0 12px 28px rgba(0,0,0,.35);cursor:grabbing}
.ctw-cell.sortable-chosen:not(.sortable-drag){outline:2px solid var(--cp-accent);outline-offset:2px}
.ctw-editing.ctw-dragging{touch-action:none}
.ctw-editing .st-card{scroll-margin-top:1rem}
/* An unfinished tile — no address yet, or no picture yet. It exists ONLY here (a live card renders
   nothing at all in that case, which is why the production stylesheet has never heard of this
   class): a dashed outline you can still tap to finish, rather than a cell you cannot reach. */
.ctw-editing .st-cell-unset{border-style:dashed;opacity:.72;align-items:center;justify-content:center;text-align:center}
.ctw-editing .st-cell-unset .st-cell-body{align-items:center;text-align:center}
`;

// ── lanes ────────────────────────────────────────────────────────────────────────────────────────
function paintLanes() {
  const wrap = el('lanes');
  const tabs = [{ kind: 'face', id: '', label: T.faceTabLabel }]
    .concat(S.model.drawers.map((d) => ({ kind: 'drawer', id: d.id, label: d.title || d.id })));
  wrap.innerHTML = tabs.map((t) => {
    const on = t.kind === S.lane.kind && t.id === S.lane.id;
    return `<button class="ctw-tab${on ? ' is-on' : ''}" data-kind="${t.kind}" data-id="${esc(t.id)}">${esc(t.label)}</button>`;
  }).join('') + `<button class="ctw-tab ctw-tab-add" id="add-drawer" title="${esc(T.addDrawerTitleAttr)}">${esc(T.addDrawerButton)}</button>`;
  for (const b of wrap.querySelectorAll('.ctw-tab[data-kind]')) {
    b.onclick = () => { S.lane = { kind: b.dataset.kind, id: b.dataset.id }; paint(); };
  }
  el('add-drawer').onclick = addDrawer;
}

function addDrawer() {
  const title = prompt(T.addDrawerPrompt, T.addDrawerPromptDefault);
  if (title == null) return;
  const id = (title.trim().toLowerCase().replace(/\s+/g, '-') || 'drawer') + '';
  if (S.model.drawers.some((d) => d.id === id)) { alert(T.addDrawerDuplicateAlert); return; }
  edit((m) => {
    m.drawers = (m.drawers || []).concat([{ id, title: title.trim(), cells: [] }]);
    return m;
  });
  S.lane = { kind: 'drawer', id };
  paint();
}

// ── the palette ──────────────────────────────────────────────────────────────────────────────────
function paintPalette() {
  el('palette').innerHTML = PALETTE.map((t) => {
    const d = TYPES[t];
    return `<button class="ctw-add" data-type="${t}"><b>${esc(say(d.title))}</b><span>${esc(say(d.hint))}</span></button>`;
  }).join('');
  for (const b of el('palette').querySelectorAll('.ctw-add')) b.onclick = () => addCell(b.dataset.type);
}

/**
 * A new cell is NOT empty. An empty one renders to nothing, which drops the author onto a card where
 * the thing they just added is invisible — so the blanks in fields.mjs render as visibly unfinished
 * instead, and the form opens on top of them.
 */
function addCell(type) {
  const blank = normalizeCell({ ...blankCell(type, TX), params: {} });
  let at;
  edit((m) => {
    if (S.lane.kind === 'face') {
      at = m.cells.length;
      m.cells = m.cells.concat([blank]);
      // the face's blocks hold RANGES into cells; the new cell joins the last one
      const last = m.blocks[m.blocks.length - 1];
      if (last) last.count += 1;
      return m;
    }
    const d = m.drawers.find((x) => x.id === S.lane.id);
    at = d.cells.length;
    d.cells = d.cells.concat([blank]);
    return m;
  });
  openCell(at);
}

// ── the form ─────────────────────────────────────────────────────────────────────────────────────
//
// 🔴 THE FORM IS NOT THE FILE. Every field here is a plain question in a person's own language — a
// text box, an address box, a picture picker — and this module composes the markdown afterwards. The
// review that produced this rewrite found the opposite arrangement: a field called 「連結」 that
// asked a stranger to type `[顯示文字](網址)`, and produced `href="#"` when they did the obvious
// thing instead. What the file looks like is card-core's business; what a person is asked is this
// file's, and the two meet only at `normalizeCell`.

/** the file's frontmatter `title:` — what the card shows as the name. Read-only helper; see setTitle. */
const cardTitle = (md) => /^title:\s*(.*)$/m.exec(String(md || ''))?.[1]?.trim() || '';

/** everything cell-form-core needs from THIS surface: its language, its drawers, its thumbnails. */
const formCtx = () => ({ T, say, targetOptions, previewSrc, cardTitle: cardTitle(S.md) });

/** the drawer choices for a "what does this open" select, or null when the card has no drawers */
function targetOptions() {
  const drawers = (S.model && S.model.drawers) || [];
  if (!drawers.length) return null;
  return [{ value: '', label: T.targetUrl }]
    .concat(drawers.map((d) => ({ value: d.id, label: T.targetDrawer + (d.title || d.id) })));
}

let openIndex = null;
/** Pictures chosen in the open sheet but not yet saved: id → {mime, b64}. Merged in on 完成. */
let pendingAssets = {};

/** what to show in the picker's thumbnail: a data: URI for a stored/pending asset, else the address */
function previewSrc(value) {
  const m = /^asset:(.+)$/.exec(String(value || '').trim());
  if (!m) return String(value || '');
  const a = pendingAssets[m[1]] || ((S.model && S.model.assets) || {})[m[1]];
  return a ? `data:${a.mime};base64,${a.b64}` : '';
}

function openCell(index) {
  const cells = laneCells();
  const cell = cells[index];
  if (!cell) return;
  openIndex = index;
  pendingAssets = {};
  const def = TYPES[cell.type] || { title: cell.type, hint: T.unknownCellHint, body: { label: T.unknownCellBodyLabel, control: CONTROL.AREA, hint: '' }, fields: [], params: {} };

  el('modal-title').textContent = say(def.title);
  el('modal-hint').textContent = say(def.hint || '');
  el('modal-body').innerHTML = formBodyHtml(def, cell, formCtx());
  el('modal-raw').value = cell.rawParams || '';
  el('modal').hidden = false;
  syncMoveButtons();
  wireForm(def, cell);
  el('modal-close').focus();
}

/** live wiring inside the open sheet: picture pickers, and rows that depend on another row's value */
function wireForm(def, cell) {
  for (const box of el('modal-body').querySelectorAll('.ctw-asset')) {
    const id = box.dataset.for;               // "f-<name>" — the hidden input holding the saved value
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
        pendingAssets[asset.id] = { mime: asset.mime, b64: asset.b64 };
        urlIn.value = '';
        show(`asset:${asset.id}`);
      } catch (e) {
        // 🔴 SAY SO, in the field, and in the console for whoever is looking. A picture that silently
        // does nothing is the same shape as the bug this whole picker replaces.
        console.warn('[cardtile] that picture could not be read —', e && e.message);
        err.textContent = T.assetUnreadable;
      } finally {
        file.value = '';
      }
    });
    urlIn.addEventListener('input', () => { if (urlIn.value.trim()) show(urlIn.value.trim()); else show(''); });
  }

  // `showWhen: {target: ''}` — the address row exists only while "this opens: an address" is chosen
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
  void cell;
}

function closeModal() { el('modal').hidden = true; openIndex = null; pendingAssets = {}; }

// ── reordering, without a gesture ────────────────────────────────────────────────────────────────
//
// 🩸 THE ONLY WAY TO REORDER WAS A DRAG NOBODY COULD DISCOVER. Measured on the live sandbox: nine
// attempts (mouse press-move-release, Playwright dragTo, CDP touch) changed the order zero times.
// There was no handle, no hint, and no alternative — while a comment in this file said
// "Click-to-reorder still works", describing a feature that does not exist in the UI.
//
// These two buttons are the path that cannot fail. They call the same `reorder` primitive the drop
// handler does, so there is one idea of what a move is, and they are what the drag harness measures
// AGAINST: a drag that fails is then a disappointment, not a dead end.
function moveCell(delta) {
  if (openIndex == null) return;
  const from = openIndex;
  const to = from + delta;
  if (to < 0 || to >= laneCells().length) return;
  edit((m) => {
    if (S.lane.kind === 'face') return reorder(m, from, to);
    const d = m.drawers.find((x) => x.id === S.lane.id);
    d.cells = reorder({ cells: d.cells }, from, to).cells;
    return m;
  });
  // the sheet stays open on the SAME tile, which has simply moved — so a person can press again
  openIndex = to;
  syncMoveButtons();
}

/** first tile cannot go up, last cannot go down. A button that does nothing is a button that lies. */
function syncMoveButtons() {
  const n = openIndex == null ? 0 : laneCells().length;
  el('modal-up').disabled = openIndex == null || openIndex <= 0;
  el('modal-down').disabled = openIndex == null || openIndex >= n - 1;
  // one tile in the lane ⇒ there is no order to change, so the whole row goes away
  el('modal-move').hidden = n < 2;
}

/** show a per-field error under the control and keep the sheet open */
function fieldError(name, message) {
  const node = document.getElementById(`e-${name}`);
  if (node) node.textContent = message;
  const input = document.getElementById(`f-${name}`);
  if (input && input.focus) input.focus();
}

function saveCell() {
  if (openIndex == null) return;
  const cells = laneCells();
  const cell = cells[openIndex];
  const def = TYPES[cell.type];
  const idx = openIndex;

  for (const node of el('modal-body').querySelectorAll('.ctw-err')) node.textContent = '';

  // 🔴 The BODY is never trimmed. A prose cell's blank lines are its paragraph breaks — trimming
  // them on save is a silent edit to somebody's writing. Params are trimmed: a stray space in a
  // token is a parse problem, not a stylistic one.
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

  // the composition — a link's `[text](url)`, the profile rename, the param tokens — is
  // cell-form-core's, shared verbatim with w2/edit2.mjs. This side owns the DOM and the errors.
  const out = composeCell(cell, def, { read, visible }, formCtx());
  if (out.error) { fieldError(out.error.field, out.error.message); return; }
  const { rawParams, body, rename } = out;

  // 🔴 Re-derive the cell by round-tripping it through the SAME machine that reads the file, so what
  // is stored is exactly what a re-parse produces. card-core owns that (normalizeCell) because the
  // editor doing it itself is how the first version turned every edited link into a text cell whose
  // body was the raw markdown line — the `- [ ] ` prefix belongs to board-core, not here.
  const next = normalizeCell({ ...cell, rawParams, body });
  const staged = pendingAssets;
  edit((m0) => {
    // pictures chosen in this sheet join the card's own `## assets` lane — one file, pictures included
    const m = rename ? setTitle(m0, rename) : m0;
    if (Object.keys(staged).length) m.assets = { ...(m.assets || {}), ...staged };
    if (S.lane.kind === 'face') { m.cells = m.cells.map((c, i) => (i === idx ? next : c)); return m; }
    const d = m.drawers.find((x) => x.id === S.lane.id);
    d.cells = d.cells.map((c, i) => (i === idx ? next : c));
    return m;
  });
  closeModal();
}

// ── pictures ─────────────────────────────────────────────────────────────────────────────────────
//
// A chosen file becomes bytes IN THE CARD (`## assets`), not an upload: that is what makes a Card one
// portable file. Downscaled and re-encoded in the browser first — a phone camera's 4 MB original
// would blow the 1.5 MB ingest budget on its own, and nobody needs 4032px on a 6-column grid.
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
    // 🔴 `toBlob('image/webp')` does NOT fail on a browser without webp — it quietly hands back a
    // PNG, which is several times larger and would fail the budget for the wrong reason. Read the
    // type back and fall to jpeg deliberately rather than discovering it as a size problem.
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
    // content-addressed, same 16-hex shape every asset in a card already carries
    return { id: `sha256-${hex.slice(0, 16)}`, mime: blob.type, b64: btoa(bin) };
  }
  return null;
}

function deleteCell() {
  if (openIndex == null) return;
  const idx = openIndex;
  if (!confirm(T.deleteConfirm)) return;
  edit((m) => {
    if (S.lane.kind === 'face') {
      m.cells = m.cells.filter((_, i) => i !== idx);
      for (const b of m.blocks) {
        if (idx < b.start) b.start -= 1;
        else if (idx < b.start + b.count) b.count -= 1;
      }
      return m;
    }
    const d = m.drawers.find((x) => x.id === S.lane.id);
    d.cells = d.cells.filter((_, i) => i !== idx);
    return m;
  });
  closeModal();
}

// ── files ────────────────────────────────────────────────────────────────────────────────────────
function load(md, handle, { cardUrl, vanity } = {}) {
  S.handle = handle || S.handle;
  // Stated > derived > canonical. Whoever opened this editor may know the domain; we do not.
  S.cardUrl = cardUrl || cardUrlFor(S.handle, vanity || {});
  S.undo = [];
  S.lane = { kind: 'face', id: '' };
  commit(md, { undoable: false });
}

/**
 * Load a card by handle over its own `.md` exit — the FAT one, because an editor needs the pictures.
 *
 * 🔴 This never worked before 2026-07-30, and the way it failed is the point. There was no `.md`
 * route at all: `card.feelreef.com/<handle>.md` 301s, the workers.dev path 404'd — but a vanity
 * host maps EVERY path to one handle, so `<their-domain>/<handle>.md` returned **200 with the card's
 * own HTML**.
 * `r.ok` was true, `parseCard` ate HTML without throwing, and the editor opened an empty card.
 * Silently. I wrote that fetch against a route I had not verified existed.
 *
 * So there are two fixes, not one: the route now exists, AND a body that does not parse to a card is
 * refused instead of loaded. A 200 is not evidence that you got what you asked for.
 *
 * ⚠️ was: 「card.feelreef.com is still not bound to the Worker」. It is, since 2026-07-30 — a plain
 * route on the feelreef.com zone. So the default origin is the canonical host now, which is also
 * what every non-vanity card's QR encodes. `?from=` still overrides it.
 */
const CARD_ORIGIN = 'https://card.feelreef.com';

async function loadHandle(handle, from) {
  const origin = (from || CARD_ORIGIN).replace(/\/$/, '');
  let md = null;
  // Prefer the local bridge when this machine can save: it hands back the card AND the `version`
  // that a later save is guarded by. Reading over the public exit and then saving would mean saving
  // against a version we never read — an optimistic lock nobody armed.
  if (!from && S.canSave) {
    try {
      const r = await fetch(`/_w/card/${encodeURIComponent(handle)}`);
      if (r.ok) { const j = await r.json(); md = j.md; S.baseVersion = j.version; }
    } catch { /* the bridge is optional — fall through to the public exit */ }
  }
  try {
    if (!md) {
      const r = await fetch(`${origin}/${encodeURIComponent(handle)}.md`);
      if (r.ok && /markdown/.test(r.headers.get('content-type') || '')) md = await r.text();
    }
  } catch { /* offline, blocked, wrong origin — falls through to the honest failure below */ }
  // a card has cells. Anything that parses to none of them is not a card, whatever the status was.
  const cells = md ? (() => { try { return parseCard(md).cells.length; } catch { return 0; } })() : 0;
  if (!cells) {
    alert(`讀不到「${handle}」的卡片。\n\n${origin}/${handle}.md 沒有回傳一張卡。\n先開一張空白的。`);
    load(STARTER, handle);
    return;
  }
  load(md, handle);
}

function download() {
  const blob = new Blob([S.md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${S.handle}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── saving to the live card ──────────────────────────────────────────────────────────────────────
//
// 🔴 THE BACKUP IS OFFERED AT THE DANGEROUS MOMENT, AND NOWHERE ELSE.
//
// chodaict's shape (2026-07-30, the Blogger-era 下載範本): no surprise download when you open a card
// — a download you did not ask for is one you learn to dismiss, and a dismissed backup is not a
// backup. The tick lives in the SAVE confirmation, pre-ticked, because that is the moment something
// can be lost. And it downloads the FAT card: the pictures are 99.7% of one real card's file and the part
// nobody can retype.
async function publish() {
  const backup = el('pub-backup').checked;
  const out = el('pub-result');
  el('pub-go').disabled = true;
  out.hidden = false;
  out.textContent = '存檔中…';
  // 🔴 The backup happens BEFORE the write. After would be a backup of whatever the write produced.
  if (backup) download();
  try {
    const r = await fetch(`/_w/card/${encodeURIComponent(S.handle)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ md: S.md, base_version: S.baseVersion }),
    });
    const j = await r.json();
    if (r.status === 409) {
      out.textContent = `這張卡在你打開之後被改過了。\n你根據的是 ${j.expected},線上現在是 ${j.current}。\n重新開一次、把改動做回去,再存。`;
      return;
    }
    if (!r.ok) { out.textContent = j.error || `存不進去(${r.status})。`; return; }
    S.baseVersion = j.version;
    const lines = ['✓ 存好了 — 這就是線上的樣子。'];
    if (j.uploaded?.length) lines.push(`上傳了 ${j.uploaded.length} 張新圖片。`);
    if (j.orphans?.length) lines.push(`有 ${j.orphans.length} 張圖片現在沒有任何一格用到,還留在卡片裡沒有刪掉:${j.orphans.join('、')}`);
    out.textContent = lines.join('\n');
    // 🔴 Found by driving it for real (2026-07-30): the dialog stayed open after a successful save
    // and the only way out was a button labelled 取消 — which, right after a save that already
    // happened, reads like it might undo it. So the footer becomes an exit: nothing left to press
    // twice, and the way out says what it does. The result STAYS on screen, because the orphan line
    // is the one thing here somebody has to act on later.
    el('pub-go').hidden = true;
    el('pub-cancel').textContent = T.modalCloseAria;
  } catch {
    out.textContent = '連不上本機的存檔通道。serve.mjs 還開著嗎?';
  } finally {
    el('pub-go').disabled = false;
  }
}

// 🔴 THE TWO BUTTONS GO THROUGH `T`; THE RESULT PANE DOES NOT, AND THAT IS THE LINE. Everything
// above that writes into #pub-result is a report from the LOCALHOST BRIDGE — a 409 version clash, an
// orphaned-asset list, "is serve.mjs still running" — and it can only ever be read by whoever
// started serve.mjs on this machine, which is the internal tool's Traditional-Chinese audience by
// decision. The button LABELS are different: they are static chrome, they ship in every sandbox
// visitor's document, and `T` is where every other such string already lives.
function openPublish() {
  el('pub-result').hidden = true;
  el('pub-go').hidden = false;
  el('pub-cancel').textContent = T.pubCancel;
  el('pub-backup').checked = true;          // 🔴 re-ticked每次 — an opt-out must not be sticky
  el('pub-what').textContent = S.baseVersion
    ? `把「${S.handle}」的改動存到線上。`
    : `把「${S.handle}」存到線上。⚠️ 這張卡不是從線上讀來的,所以無法確認線上有沒有被別人改過。`;
  el('pubmodal').hidden = false;
}

/**
 * Sandbox boot — never touches `/_w/*`, never loads a real handle. `opts.locale` is whatever the
 * server resolved from `Accept-Language` (see gen-editor-assets.mjs / card-worker.mjs). On the page
 * itself, `?lang=` (the resolution order the brief specifies: URL → Accept-Language → en) or the
 * older `?locale=` (kept for anything already linking to it — same value space, checked second) can
 * override it for manual testing, same override shape as `?handle=`/`?from=` on the real editor.
 */
function bootSandbox(opts) {
  const q = new URL(location.href).searchParams;
  const localeKey = primaryLocale(q.get('lang') || q.get('locale') || opts.locale
    || (typeof navigator !== 'undefined' && navigator.language) || 'en');
  S.locale = localeKey;
  const persona = SANDBOX_LOCALES[localeKey];
  // 🔴 THE ONE PLACE `T` CHANGES. Every dynamically-generated chrome string in this file (paintLanes,
  // addDrawer, openCell's unknown-type fallback, the SWITCH/SELECT form controls, deleteCell) reads
  // from `T` — so swapping it here, before the first paint(), localises all of them at once instead
  // of each call site remembering to ask sandbox-i18n.mjs itself.
  T = chromeStrings(localeKey);
  // …and the tile definitions' own words. Same swap, same one place: `say()` reads TX, every
  // palette entry and every form label reads say(), so this one line localises the PRODUCT rather
  // than just the buttons around it. Before it, a Japanese visitor read 「ブロックを追加」 and then
  // seven Chinese type names underneath.
  TX = cellStrings(localeKey);
  // The server already set `<html lang>` from its own resolution (Accept-Language, or its own
  // `?locale=` read) before this script ever ran — but `?lang=`/`?locale=` read HERE can disagree
  // with that (a visitor testing a different locale by hand), so keep the attribute honest.
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = persona.lang;

  // Chrome that only makes sense for a REAL card: opening a file from disk, a card-URL field (there
  // is no real address yet), the raw-markdown box (an internal-tool honesty a stranger did not ask
  // for). Hidden, not removed — same document as the real editor, see this file's header.
  document.body.dataset.sandbox = '1';
  el('file-block').hidden = true;
  el('cardurl-block').hidden = true;
  el('md-block').hidden = true;

  // Static markup (index.html) that isn't rebuilt by any paint*() function — set directly, once,
  // from the same `T` everything else now reads. Real-editor mode never calls this function, so
  // its own index.html defaults (identical strings — see this file's `T` fallback above) are the
  // only thing a non-sandbox visitor ever sees; nothing here can touch that path.
  el('undo').textContent = T.undo;
  el('download').textContent = T.download;
  if (el('file-block-label')) el('file-block-label').textContent = T.openFile;
  if (el('actions-menu-btn')) el('actions-menu-btn').setAttribute('aria-label', T.menu);
  if (el('add-cell-h2')) el('add-cell-h2').textContent = T.addCellHeader;
  el('modal-close').setAttribute('aria-label', T.modalCloseAria);
  if (el('raw-summary')) el('raw-summary').textContent = T.modalRawSummary;
  if (el('raw-note')) el('raw-note').textContent = T.modalRawNote;
  el('modal-delete').textContent = T.modalDelete;
  el('modal-save').textContent = T.modalSave;
  el('modal-up').textContent = T.moveUp;
  el('modal-down').textContent = T.moveDown;
  // 🩸 …AND THE THREE PANELS THIS FUNCTION HIDES RATHER THAN REMOVES. The four lines below the
  // hides above turn #cardurl-block/#md-block/#pubmodal off, and for that reason none of them was
  // ever localised — a visitor could not see them, so they looked like they were not there. They
  // were: measured on the live page on 2026-09-05 with `Accept-Language: en-US`, the sandbox's save
  // sheet was still offering 「取消」 and 「存」 inside an otherwise English document. And #md-block
  // is not even unreachable — Markdown mode un-hides it, so its heading and note are two taps from
  // any visitor in any language. Hidden is not absent; what ships is the scope.
  if (el('cardurl-h2')) el('cardurl-h2').textContent = T.cardUrlHeader;
  if (el('cardurl-note')) el('cardurl-note').textContent = T.cardUrlNote;
  if (el('md-h2')) el('md-h2').textContent = T.mdHeader;
  if (el('md-note')) el('md-note').textContent = T.mdNote;
  if (el('pub-title')) el('pub-title').textContent = T.pubTitle;
  if (el('pub-backup-label')) el('pub-backup-label').textContent = T.pubBackup;
  if (el('pub-note')) el('pub-note').textContent = T.pubNote;
  el('pub-cancel').textContent = T.pubCancel;
  el('pub-go').textContent = T.pubSave;
  // the escape hatch for people who DO know markdown — see setMdMode. Sandbox only: the internal
  // editor already shows the raw box permanently, which is the honest arrangement for an ops tool.
  el('md-toggle').hidden = false;
  paintMdToggle();
  el('canvas').title = T.canvasTitle;

  el('sandbox-banner-text').textContent = persona.bannerText;
  el('sandbox-banner-status').textContent = persona.bannerStatus;
  el('sandbox-reset').textContent = persona.reset;
  el('sandbox-reset').onclick = () => {
    clearSandboxDraft();
    load(buildSandboxCard(localeKey), 'try');
  };
  el('sandbox-banner').hidden = false;

  // The ONE door out. Repurposes the pill real use reveals only once `/_w/can-save` confirms a
  // token — here it is unconditional, because canSave never turns true in sandbox mode, so the two
  // meanings can never show at once. A plain navigation, not a new tab: walking through a door.
  const doorBtn = el('publish');
  doorBtn.textContent = persona.doorCta;
  doorBtn.hidden = false;
  // ── the door: a sentence, then the walk ───────────────────────────────────────────────────────
  //
  // 🩸 THE BUTTON USED TO DELETE THE CARD. `clearSandboxDraft()` ran BEFORE the navigation, on the
  // reasoning that `card.feelreef.com` and `feelreef.com` are different origins so the far side
  // could never tidy up after a stale draft. That reasoning was sound and the consequence was not:
  // measured on 2026-09-06, pressing 「把這張變成真的」 → sign-in → back to `/try/edit` left three
  // cells. A visitor who did not finish signing up — which is most of them, the first time — came
  // back to find ten minutes of work gone, deleted by the button labelled "make this real".
  //
  // Nothing clears it now. 「重新開始」 is the exit that empties the draft, it says so, and it is a
  // thing the visitor chooses. A returning visitor sees their own card.
  el('door-title').textContent = persona.doorCta;
  el('door-note').textContent = persona.doorNote;
  el('door-go').textContent = persona.doorContinue;
  el('door-back').textContent = persona.doorBack;
  el('door-back').onclick = () => { el('doormodal').hidden = true; };
  el('doormodal').addEventListener('click', (e) => { if (e.target === el('doormodal')) el('doormodal').hidden = true; });
  el('door-go').onclick = async () => {
    const go = el('door-go');
    go.disabled = true;
    // 🔴 The whole card goes with them — parked for an hour under a random key, carried across as
    // `draft=<id>`. Best-effort by design: parkSandboxCard never throws and returns '' when it could
    // not, and the door opens either way rather than trapping someone behind a failed convenience.
    const draft = await parkSandboxCard(S.md, { origin: location.origin });
    location.href = sandboxDoorHref(S.md, { draft });
  };
  doorBtn.onclick = () => {
    el('doormodal').hidden = false;
    el('door-go').disabled = false;
    el('door-go').focus();
  };

  // A returning visitor's own edits win; a fresh browser gets the persona. Never a network read.
  const draft = readSandboxDraft();
  const cells = draft ? (() => { try { return parseCard(draft).cells.length; } catch { return 0; } })() : 0;
  load(cells ? draft : buildSandboxCard(localeKey), 'try');
}

// ── Markdown mode ────────────────────────────────────────────────────────────────────────────────
//
// The whole-page view toggle, the same shape as tugtile's header `file-text` action
// (release/obsidian-tugtile/main.js — `viewName()` / `openMarkdownEditor()` / `cmdToggleView`, string
// `editMarkdown`): TWO COMPLETE WAYS to edit one card, never both on screen at once.
//
// 🔴 IT EXISTS SO THE FORMS CAN STOP TEACHING. Half the review's findings were forms explaining
// markdown to someone who had never heard of it — `[顯示文字](網址)`, 「支援 **粗體** 與 *斜體*」,
// 「Markdown。標題、清單、連結都可以。」 The answer is not better explanations. It is that anyone
// who wants the syntax has a door to it, and everyone else never sees a bracket.
let mdMode = false;

function paintMdToggle() {
  const btn = el('md-toggle');
  if (!btn) return;
  el('md-toggle-label').textContent = mdMode ? T.mdBack : T.mdMode;
  btn.setAttribute('aria-pressed', mdMode ? 'true' : 'false');
}

/**
 * Enter or leave the mode. Leaving VALIDATES first and stays put when the text has stopped being a
 * card — there is no way to leave this mode having quietly lost something, which is the property
 * that lets it be offered to a stranger at all.
 */
function setMdMode(on) {
  if (on === mdMode) return;
  if (!on) {
    const value = el('md').value;
    const wrong = whatIsWrong(value);
    if (wrong) {
      const err = el('md-error');
      err.textContent = T.mdBroken.replace('{n}', String(wrong.line));
      err.hidden = false;
      el('md').focus();
      return;                                  // 🔴 still in the mode, and the card is untouched
    }
    el('md-error').hidden = true;
    mdMode = false;
    document.body.removeAttribute('data-md');
    el('md-block').hidden = true;
    // the card is repainted ONCE, here — not on every keystroke
    if (value !== S.md) commit(value); else paint();
    paintMdToggle();
    return;
  }
  mdMode = true;
  document.body.dataset.md = '1';
  el('md-block').hidden = false;
  el('md-error').hidden = true;
  el('md').value = S.md;
  paintMdToggle();
  el('md').focus();
}

/** the draft, saved while typing raw markdown — 300ms after the last keystroke, never on each one */
let mdDraftTimer = null;
function onMdInput() {
  if (!mdMode || !S.sandbox) return;
  clearTimeout(mdDraftTimer);
  mdDraftTimer = setTimeout(() => writeSandboxDraft(el('md').value), 300);
}

// ── boot ─────────────────────────────────────────────────────────────────────────────────────────
export function boot(opts = {}) {
  el('canvas').addEventListener('load', wireCanvas);
  // crossing 768px in either direction switches between "the page scrolls" and "the grid does"
  if (typeof matchMedia === 'function') {
    const mq = matchMedia(STACKED);
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(fitCanvas);
  }
  el('undo').onclick = () => { if (S.undo.length) commit(S.undo.pop(), { undoable: false }); };
  el('download').onclick = download;
  el('pub-cancel').onclick = () => { el('pubmodal').hidden = true; };
  el('pub-go').onclick = publish;
  el('pubmodal').addEventListener('click', (e) => { if (e.target === el('pubmodal')) el('pubmodal').hidden = true; });
  el('modal-close').onclick = closeModal;
  el('modal-save').onclick = saveCell;
  el('modal-delete').onclick = deleteCell;
  el('modal-up').onclick = () => moveCell(-1);
  el('modal-down').onclick = () => moveCell(1);
  el('modal').addEventListener('click', (e) => { if (e.target === el('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('modal').hidden) closeModal();
    else if (!el('doormodal').hidden) el('doormodal').hidden = true;
  });

  el('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) load(await f.text(), f.name.replace(/\.md$/, ''));
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) load(await f.text(), f.name.replace(/\.md$/, ''));
  });
  // markdown is the SSOT in BOTH directions — edit the text and the card follows
  el('cardurl').addEventListener('change', () => { S.cardUrl = el('cardurl').value.trim(); paint(); });
  // 🔴 `mdMode` short-circuits this. The internal editor commits the raw box on blur and always
  // has; in Markdown mode, clicking the toggle blurs the textarea first, so without this guard the
  // text would be committed once here — unvalidated — and then again by setMdMode.
  el('md').addEventListener('change', () => {
    if (mdMode) return;
    try { commit(el('md').value); } catch (err) { alert(String(err.message || err)); }
  });
  el('md').addEventListener('input', onMdInput);
  el('md-toggle').onclick = () => setMdMode(!mdMode);

  S.sandbox = !!opts.sandbox;

  if (S.sandbox) {
    bootSandbox(opts);
  } else {
    el('publish').onclick = openPublish;
    const q = new URL(location.href).searchParams;
    const handle = q.get('handle');
    // 🔴 ASK FIRST, then show the button. A save button that appears and then fails with "no token" is
    // worse than one that was never there — it is a phantom feature with a friendly face.
    fetch('/_w/can-save').then((r) => r.json()).then((j) => {
      S.canSave = !!j.canSave;
      el('publish').hidden = !S.canSave;
    }).catch(() => { /* not served by serve.mjs — the editor is file-only, which is a valid way to use it */ })
      .finally(() => {
        if (handle) loadHandle(handle, q.get('from'));
        else load(STARTER, 'card');
      });
  }

  // the harness drives these; harmless in normal use
  window.__cardtileW = {
    get md() { return S.md; },
    get cardUrl() { return S.cardUrl; },
    // exposed so a harness can tell "drag was tested and works" from "drag was never there"
    get dragEnabled() { return !!S.dragEnabled; },
    get dragContainers() { return S.dragContainers || { count: 0, classes: [], doubleClaimed: 0 }; },
    set cardUrl(v) { S.cardUrl = v; paint(); },
    get model() { return S.model; },
    get lane() { return S.lane; },
    set lane(v) { S.lane = v; paint(); },
    load, loadHandle, commit, parseCard, openCell, saveCell, closeModal, addCell, deleteCell, onDrop, canvasHtml,
    openPublish, publish,
    get canSave() { return S.canSave; },
    set canSave(v) { S.canSave = v; el('publish').hidden = !v; },
    get baseVersion() { return S.baseVersion; },
    set baseVersion(v) { S.baseVersion = v; },
    get sandbox() { return S.sandbox; },
    get locale() { return S.locale; },
    field: (name) => el(`f-${name}`),
    frame: () => el('canvas'),
  };
}

const STARTER = ['---', 'card-page: card', 'title: 你的名字', 'accent: #0556ff', 'lang: zh-TW', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 %% 一句話介紹你自己',
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/)',
  '- [ ] %% card: link w=6 %% [聯絡我](mailto:you@example.com)',
].join('\n') + '\n';
