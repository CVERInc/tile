// The Mac host's half of the seam — the counterpart of MarktileView in the Obsidian plugin and of
// makeWebHost() in hosts/web/example/index.html. It mounts the SAME engine; it does not reimplement any
// part of it.
//
// Rule inherited from the family (three-layer architecture): the core toolbar is the single source
// of what this editor can do. A surface may DISABLE a capability the host genuinely cannot provide;
// it must never grow one of its own. The Mac surface disables exactly one thing — the vault image
// picker, because there is no vault — and adds nothing.

import "../Engine/obsidian-shim.js";
import { mountEditor, equipEditor, buildEditorCtl, t } from "../Engine/tile-core.js";
import { makeWebHost } from "../Engine/host.js";

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

// ── Search every document ────────────────────────────────────────────────────────────────────────
// The engine asks a host for this and grows no scope control without it, so the capability has to be
// KNOWN BEFORE the editor mounts — AppKit pushes it on `ready`, ahead of the first open(). A machine
// with no flintfind installed therefore shows no door at all, rather than one that fails when
// pressed.
//
// 🔴 Interim, and named as such: this shells out to the `ff` CLI, which is a Python tool in someone's
// homebrew and NOT part of this app. It is behind the engine's one searchAll seam precisely so the
// Swift port replaces this function and nothing else.
let caps = { searchAll: false };
let searchId = 0;
const pending = new Map();

const searchAll = (query, onPartial) => new Promise((resolve) => {
  const id = ++searchId;
  pending.set(id, { resolve: resolve, onPartial: onPartial });
  send("search", { id: id, query: query });
  // A host that never answers must not leave the panel spinning for ever. The engine treats an
  // empty result as an answer, which is the honest thing to show when the search itself failed.
  setTimeout(() => {
    if (pending.has(id)) { pending.delete(id); resolve({ hits: [], offline: [], files: 0, skipped: 0 }); }
  }, 25000);
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

function open(text) {
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
    // `[[wikilink]]` deliberately does NOT open yet. Resolving one means asking which file on this
    // machine is called that, which is the retrieval side's job and its own piece of work; a link
    // that silently does nothing is better than one that guesses at a file and opens the wrong note.
    (() => {
      const host = makeWebHost({
        openLink: (link) => {
          if (link.kind === 'url' || link.kind === 'image') send('openurl', { url: link.target });
          // A result from the search panel is a file on this machine — AppKit opens it as a document.
          else if (link.kind === 'file') send('openfile', { path: link.target, line: link.line || 0 });
        },
      });
      if (caps.searchAll) host.searchAll = searchAll;   // absent ⇒ the engine grows no scope control
      return host;
    })()
  );

  app.classList.add("marktile-ed");   // marktile IS a markdown editor → monospace, not board cards

  rig = equipEditor({
    mount: app,
    ctrl: ctrl,
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
  if (!locked) ctrl.focus();
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
  canSearchAll: () => !!(ctrl && ctrl.canSearchAll()),
  // ⌘+ / ⌘- / ⌘0. One custom property on the root, read by the one rule in index.html that sizes the
  // editable surface — so the TEXT scales and the toolbar, the find bar and the window chrome do not.
  // Swift owns the ladder and the persistence; this end only paints.
  setTextSize: (px) => { document.documentElement.style.setProperty('--mt-ed-size', px + 'px'); },
  // Pushed on `ready`, before the first open(), because the engine decides at MOUNT whether it has
  // a scope control to draw.
  setCapabilities: (c) => { caps = Object.assign({}, caps, c || {}); },
  // AppKit's answer to one search. `json` is a string flintfind printed — parsed here, never
  // evaluated. A malformed or missing answer resolves as an empty result, which is what the panel
  // can honestly show when the search itself failed.
  // AppKit's answer to one search — possibly several times. flintfind prints the indexed half as
  // soon as it has it and the unindexed half ~4s later, so `partial` says whether more is coming.
  // `json` is a string it printed: parsed here, never evaluated.
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
