// The Mac host's half of the seam — the counterpart of MarktileView in the Obsidian plugin and of
// makeWebHost() in hosts/web/example/index.html. It mounts the SAME engine; it does not reimplement any
// part of it.
//
// Rule inherited from the family (three-layer architecture): the core toolbar is the single source
// of what this editor can do. A surface may DISABLE a capability the host genuinely cannot provide;
// it must never grow one of its own. The Mac surface disables exactly one thing — the vault image
// picker, because there is no vault — and adds nothing.

import "../Engine/obsidian-shim.js";
import { mountEditor, equipEditor, buildEditorCtl, EDITOR_TOOLS, t } from "../Engine/editor-core.js";
import { makeWebHost } from "../Engine/web-host.js";

const send = (kind, payload) => {
  try {
    window.webkit.messageHandlers.marktile.postMessage(Object.assign({ kind }, payload || {}));
  } catch (e) {
    /* no host attached (opened in a plain browser for debugging) — stay quiet */
  }
};

// ── System accent ────────────────────────────────────────────────────────────────────────────────
// The host hands us macOS's accent colour. It goes straight onto --interactive-accent, which is used
// for controls (the checked task box, focus) where an accent colour belongs.
//
// --text-accent is NOT the same job: the stylesheet uses it for heading TEXT, links and inline code,
// and several of macOS's accents are chosen to sit on a control, not to be read as small text. Yellow
// on white is about 1.7:1. So the text variant is the accent walked toward the background's opposite
// until it clears 4.5:1, which keeps the hue the person picked and keeps the words legible.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = ([r, g, b]) => "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

function readable(accentHex, bgHex, target) {
  const bg = rgb(bgHex);
  let c = rgb(accentHex);
  if (ratio(c, bg) >= target) return hex(c);
  const toward = lum(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];   // light page → darken, dark page → lighten
  for (let step = 1; step <= 50; step++) {
    const mixed = c.map((v, i) => v + (toward[i] - v) * (step / 50));
    if (ratio(mixed, bg) >= target) return hex(mixed);
  }
  return hex(toward);
}

function setAccent(accentHex) {
  if (!/^#[0-9a-f]{6}$/i.test(accentHex)) return;
  const root = document.documentElement;
  const bg = getComputedStyle(root).getPropertyValue("--background-primary").trim() || "#ffffff";
  root.style.setProperty("--interactive-accent", accentHex);
  root.style.setProperty("--text-accent", /^#[0-9a-f]{6}$/i.test(bg) ? readable(accentHex, bg, 4.5) : accentHex);
}

const app = document.getElementById("app");
let ctrl = null;
let rig = null;
let ctl = null;        // the head strip: mode cycle + lock
let locked = false;    // survives a reload, like the mode does

// The person's choices from marktile ▸ Settings… — the Obsidian plugin's shape (`editorTools`, `modes`; a
// missing key means on), pushed by AppKit before the first open() and again whenever they change.
let settings = {};

// ── Search every document ────────────────────────────────────────────────────────────────────────
// The engine asks a host for this and grows no scope control without it, so the capability has to be
// KNOWN BEFORE the editor mounts — AppKit pushes it on `ready`, ahead of the first open(). The search
// itself is flintfind's engine, linked into the app (EditorViewController.runSearch).
let caps = { searchAll: false };
let searchId = 0;
const pending = new Map();

const searchAll = (query, onPartial) => new Promise((resolve) => {
  const id = ++searchId;
  // A host that never answers must not leave the panel spinning for ever. The engine treats an
  // empty result as an answer, which is the honest thing to show when the search itself failed.
  const timer = setTimeout(() => {
    if (pending.has(id)) { pending.delete(id); resolve({ hits: [], offline: [], files: 0, skipped: 0 }); }
  }, 25000);
  pending.set(id, { resolve: resolve, onPartial: onPartial, timer: timer });
  send("search", { id: id, query: query });
});

const EMPTY = { hits: [], offline: [], files: 0, skipped: 0 };

// The head layer's lock, applied exactly the way the Obsidian host applies it — same attribute, same
// class, so the shared stylesheet's read-only rules (editor, toolbar, AND find/replace, which would
// otherwise let Replace All walk straight past contenteditable) all engage.
function applyLock() {
  const ed = app.querySelector(".tugtile-ed-rich");
  if (ed) ed.setAttribute("contenteditable", String(!locked));
  app.classList.toggle("tugtile--locked", locked);
  send("lock", { locked: locked });   // the menu's checkmark can't read the page synchronously
}

// Hiding the toolbar is legitimate here in a way it would not be in a rich-text editor: the syntax IS
// the input method. `**bold**` is two asterisks whether or not a B button is on screen, so the toolbar
// is a convenience over markdown, not the only door to it.
let toolbarHidden = false;
function applyToolbar() {
  app.classList.toggle("mt-no-toolbar", toolbarHidden);
}

function teardown() {
  if (rig) { try { rig.destroy(); } catch (e) {} rig = null; }
  if (ctrl) { try { ctrl.destroy(); } catch (e) {} ctrl = null; }
  ctl = null;
  app.replaceChildren();
}

function open(text, keep) {
  keep = keep || {};
  teardown();

  ctrl = mountEditor(
    app,
    {
      text: text,
      onChange: () => {
        // rawValue(), never getValue(): getValue() trims trailing whitespace, which would rewrite
        // the person's file behind their back on the next ⌘S.
        send("change", { text: ctrl.rawValue() });
        if (rig && rig.toc) rig.toc.refresh();
      },
      onToc: () => { if (rig && rig.toc) rig.toc.toggle(); },
    },
    // A URL goes to the system browser through AppKit, not `window.open` — inside a WKWebView that
    // would try to navigate the app's own view, and this app has exactly one document in it.
    //
    // `[[wikilink]]` goes to AppKit by NAME. Which file that name means is a question about the disk,
    // so Swift answers it (WikilinkResolver): the one file it can be sure of, or — when it can't —
    // this page's own search panel with the name already typed. It never guesses.
    (() => {
      const host = makeWebHost({
        openLink: (link) => {
          if (link.kind === 'url' || link.kind === 'image') send('openurl', { url: link.target });
          // A result from the search panel is a file on this machine — AppKit opens it as a document.
          else if (link.kind === 'file') send('openfile', { path: link.target, line: link.line || 0 });
          else if (link.kind === 'wiki') send('openwiki', { target: link.target });
        },
      });
      if (caps.searchAll) host.searchAll = searchAll;   // absent ⇒ the engine grows no scope control
      // Which toolbar buttons exist. Date and time stay off whatever is stored: they belong to the board
      // editor, which is why the settings page does not offer them either.
      host.plugin = { settings: { editorTools: Object.assign({}, settings.editorTools, { date: false, time: false }) } };
      return host;
    })()
  );

  app.classList.add("marktile-ed");   // marktile IS a markdown editor → monospace, not board cards

  rig = equipEditor({
    mount: app,
    ctrl: ctrl,
    enabledModes: settings.modes || {},
    initialMode: keep.mode,
    toc: {
      Sortable: (typeof Sortable !== "undefined" ? Sortable : undefined),
      onReorder: () => send("change", { text: ctrl.rawValue() }),
      anchorScroll: ".tugtile-ed-scroll",
    },
  });

  // The head layer — mode cycle + lock. Locked capability, free placement (three-layer rule), so on Mac
  // it sits above the toolbar the way the phone surface does. Built with the CORE's buildEditorCtl, not
  // a hand-rolled native strip: it is the same control, and a second implementation of it would drift
  // from the other three surfaces on the first wording or icon change.
  // Compact placement: the strip rides at the right end of the toolbar row rather than claiming a row
  // of its own. "Placement follows the surface" is the freedom the three-layer rule grants, and on a
  // window with a real title bar above it, a third stacked strip is just vertical space spent on chrome.
  const bar = app.querySelector(".tugtile-ed-bar") || app;
  ctl = buildEditorCtl(bar, {
    cycleMode: () => { if (rig) rig.cycleMode(); },
    currentMode: () => (rig ? rig.currentMode() : { icon: "square-m", name: "mtModeSeasoned" }),
    toggleLock: () => { locked = !locked; applyLock(); },
    isLocked: () => locked,
    // This surface puts the strip in a flex row beside a centred toolbar, so its width has to hold
    // still — otherwise every mode switch nudges all 17 buttons. The other three surfaces don't ask.
    stableWidth: true,
    brand: t("mtBrand"),
    brandLocked: t("mtBrandLocked"),
    modeLabel: t("mtModeToggle"),
    lockLabel: t("mtLockToggle"),
  });
  applyLock();
  applyToolbar();
  watchToolbar();
  if (keep.scroll) { const sc = app.querySelector(".tugtile-ed-scroll"); if (sc) sc.scrollTop = keep.scroll; }
  if (!locked) ctrl.focus();
}

// A settings change rebuilds the editor around the same text: which buttons and which modes exist is
// decided when the engine mounts. The mode and the scroll position are carried across so the window does
// not visibly jump; the text never left the page.
function setSettings(s) {
  settings = (s && typeof s === "object") ? s : {};
  if (!ctrl) return;
  const sc = app.querySelector(".tugtile-ed-scroll");
  const mode = rig && rig.currentMode ? rig.currentMode().key : undefined;
  open(ctrl.rawValue(), { mode: mode, scroll: sc ? sc.scrollTop : 0 });
}

// ── One toolbar row ───────────────────────────────────────────────────────────────────────────────
// The tools never wrap. Whatever does not fit goes behind a "⋯" at the end of the row, which opens a
// native menu (AppKit draws it: a Mac menu, keyboard and all) listing exactly the buttons it is standing
// in for. Nothing is lost at any width, and every one of them is also in the Format menu with its shortcut.
// The buttons carry no key of their own, only their translated label — the same label EDITOR_TOOLS derives
// it from — so that is what maps a hidden button back to the tool it runs.
//
// Which buttons go first is not "from the end of the row": that would keep undo and redo, which every Mac
// person presses as ⌘Z without looking, and hide bold. They go in this order instead — the ones with the
// most familiar shortcut, and the rarest, first; the row keeps its order for whatever stays.
const keyByLabel = new Map(EDITOR_TOOLS.filter((x) => x && x.tip).map((x) => [t(x.tip), x.key]));
const SHED_ORDER = ["redo", "undo", "clear", "h3", "quote", "table", "number", "code", "strike", "h2",
                    "check", "link", "search", "bullet", "italic", "h1", "bold"];
const shedRank = (b) => { const i = SHED_ORDER.indexOf(keyByLabel.get(b.getAttribute("aria-label"))); return i < 0 ? -1 : i; };
let moreBtn = null;
let toolbarObserver = null;

function fitToolbar() {
  const tools = app.querySelector(".tugtile-ed-tools");
  if (!tools) return;
  if (!moreBtn || moreBtn.parentElement !== tools) {
    moreBtn = document.createElement("button");
    moreBtn.className = "tugtile-iconbtn tugtile-ed-tool mt-more";
    const ic = document.createElement("span"); setIcon(ic, "more-horizontal"); moreBtn.append(ic);
    moreBtn.setAttribute("aria-label", t("selMoreLabel"));
    moreBtn.addEventListener("mousedown", (e) => e.preventDefault());   // keep the caret in the text
    moreBtn.addEventListener("click", () => {
      // Key and label both: the menu uses the Format menu's own item when there is one, and the engine's
      // label when there is not (Clear Formatting has no menu item), so no hidden button is ever dropped.
      const items = Array.from(tools.querySelectorAll(".tugtile-ed-tool.mt-overflow"))
        .filter((b) => b !== moreBtn)
        .map((b) => ({ key: keyByLabel.get(b.getAttribute("aria-label")), label: b.getAttribute("aria-label") }))
        .filter((x) => x.key);
      const r = moreBtn.getBoundingClientRect();
      send("overflow", { items: items, x: r.left, y: r.bottom + 4 });
    });
    tools.append(moreBtn);
  }
  const items = Array.from(tools.children).filter((n) => n !== moreBtn);
  for (const n of items) n.classList.remove("mt-overflow");
  moreBtn.classList.add("mt-overflow");
  if (tools.scrollWidth <= tools.clientWidth) return;
  moreBtn.classList.remove("mt-overflow");
  const buttons = items.filter((n) => n.classList.contains("tugtile-ed-tool"))
    .sort((a, b) => shedRank(a) - shedRank(b));   // unknown buttons (rank -1) would go first; there are none today
  for (const b of buttons) {
    if (tools.scrollWidth <= tools.clientWidth) break;
    b.classList.add("mt-overflow");
    tidySeps(items);
  }
}

// A divider is only worth drawing between two visible buttons: hide one at either end of the row or next to
// another divider, so shedding a whole group never leaves "| |" or a stray line before the "⋯".
function tidySeps(items) {
  let prevVisible = null;
  for (const n of items) {
    if (n.classList.contains("tugtile-ed-sep")) {
      n.classList.remove("mt-overflow");
      if (!prevVisible || prevVisible.classList.contains("tugtile-ed-sep")) n.classList.add("mt-overflow");
      else prevVisible = n;
    } else if (!n.classList.contains("mt-overflow") && getComputedStyle(n).display !== "none") {
      prevVisible = n;
    }
  }
  if (prevVisible && prevVisible.classList.contains("tugtile-ed-sep")) prevVisible.classList.add("mt-overflow");
  // A divider kept here has a drawn button on both sides of it, in a row that cannot wrap — so it is never
  // alone on a row, and any `visibility: hidden` the engine's own tidy left on it from an earlier layout
  // is stale. The engine only re-tidies when the row's SIZE changes, which shedding a button does not do.
  for (const n of items) if (n.classList.contains("tugtile-ed-sep") && !n.classList.contains("mt-overflow")) n.style.visibility = "";
}

function watchToolbar() {
  if (toolbarObserver) toolbarObserver.disconnect();
  const bar = app.querySelector(".tugtile-ed-bar");
  if (!bar) return;
  toolbarObserver = new ResizeObserver(() => fitToolbar());
  toolbarObserver.observe(bar);
  fitToolbar();
}

window.__mt = {
  open: open,
  text: () => (ctrl ? ctrl.rawValue() : ""),
  // The menu items are keyboard routes into the same rig the strip drives — never a second code path.
  // Each one refreshes the strip so the label and the lock icon can't disagree with reality.
  cycleMode: () => { if (rig) rig.cycleMode(); if (ctl) ctl.refresh(); },
  toggleToc: (force) => { if (rig && rig.toc) rig.toc.toggle(force); },
  toggleLock: () => { locked = !locked; applyLock(); if (ctl) ctl.refresh(); },
  isLocked: () => locked,
  setAccent: setAccent,
  setToolbar: (visible) => { toolbarHidden = !visible; applyToolbar(); },
  // The Format menu and its ⌘-equivalents. Same `runs` map the toolbar buttons are bound to — the menu
  // is a second DOOR to each capability, never a second definition of it. Returns false for a key the
  // engine doesn't have, which is how the Swift side can refuse to ship a menu item that does nothing.
  tool: (key) => !!(ctrl && ctrl.runTool(key)),
  // ⌘F, and ⌘F again. 🔴 The engine's own ⌘F⌘F handler CANNOT fire in this app: an AppKit menu key
  // equivalent is matched before the web view ever sees the event, so the second press hits the menu
  // item again and never reaches the find field. So the escalation decision lives here, where the
  // menu actually lands — press once to search this file, press again to search every document.
  find: () => {
    if (!ctrl) return;
    const bar = document.querySelector('.tugtile-ed-find');
    const open = bar && bar.style.display !== 'none';
    if (open && caps.searchAll) { ctrl.toggleSearchAll(true); return; }
    ctrl.toggleFind(true);
  },
  toggleSearchAll: (show) => { if (ctrl) ctrl.toggleSearchAll(show); },
  // A `[[wikilink]]` AppKit could not settle to one file: the panel opens already searching for the
  // name, so "which of these did you mean" is one arrow key away rather than a retyped query.
  searchFor: (query) => { if (ctrl && caps.searchAll) ctrl.toggleSearchAll(true, query); },
  canSearchAll: () => !!(ctrl && ctrl.canSearchAll()),
  // ⌘+ / ⌘- / ⌘0. One custom property on the root, read by the one rule in index.html that sizes the
  // editable surface — so the TEXT scales and the toolbar, the find bar and the window chrome do not.
  // Swift owns the ladder and the persistence; this end only paints.
  setTextSize: (px) => { document.documentElement.style.setProperty('--mt-ed-size', px + 'px'); },
  // Pushed on `ready`, before the first open(), because the engine decides at MOUNT whether it has
  // a scope control to draw.
  setCapabilities: (c) => { caps = Object.assign({}, caps, c || {}); },
  setSettings: setSettings,
  // The host is asking the person for a folder before it can search (App Store build, first search).
  // A person reading that panel is not a host that stopped answering, so the timeout stands down.
  searchHold: (id) => { const w = pending.get(id); if (w) clearTimeout(w.timer); },
  // AppKit's answer to one search — possibly several times: the indexed half as soon as it is known
  // and the unindexed half ~4s later, so `partial` says whether more is coming. `json` is a string,
  // parsed here and never evaluated; a malformed or missing answer resolves as an empty result,
  // which is what the panel can honestly show when the search itself failed.
  searchResult: (id, json) => {
    const waiting = pending.get(id);
    if (!waiting) return;                   // already timed out, or an answer to a question nobody asked
    let res = null;
    try { res = json ? JSON.parse(json) : null; } catch (e) { res = null; }
    const payload = res && res.hits ? res : EMPTY;
    if (res && res.partial) {
      if (waiting.onPartial) waiting.onPartial(payload);
      return;                               // stays pending: the real answer has not arrived yet
    }
    pending.delete(id);
    clearTimeout(waiting.timer);
    waiting.resolve(payload);
  },
};

// Hover tooltips for every icon. The engine labels its icon buttons with `aria-label` — one string,
// already translated, already the accessible name — so the tooltip is that same string mirrored into
// `title` rather than a second list to keep in sync.
//
// It lives HERE, in the host, and not in the engine: inside Obsidian `aria-label` is already what
// draws a tooltip, so adding `title` upstream would give the plugins two tooltips for one button.
// A MutationObserver rather than a one-time pass, because the strip rebuilds its buttons (mode
// cycling, the find bar opening) and a pass at load would only ever label the first generation.
(function mirrorLabelsToTooltips() {
  const mirror = (root) => {
    if (!root || root.nodeType !== 1) return;
    const els = root.matches('[aria-label]') ? [root] : [];
    for (const el of els.concat(Array.from(root.querySelectorAll('[aria-label]')))) {
      const label = el.getAttribute('aria-label');
      if (label && el.getAttribute('title') !== label) el.setAttribute('title', label);
    }
  };
  mirror(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') { mirror(r.target); continue; }
      for (const n of r.addedNodes) mirror(n);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
})();

send("ready");
