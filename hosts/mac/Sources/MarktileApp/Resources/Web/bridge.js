// The Mac host's half of the seam — the counterpart of MarktileView in the Obsidian plugin and of
// makeWebHost() in tile-core/example.html. It mounts the SAME engine; it does not reimplement any
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

const app = document.getElementById("app");
let ctrl = null;
let rig = null;
let ctl = null;        // the head strip: mode cycle + lock
let locked = false;    // survives a reload, like the mode does

// The head layer's lock, applied exactly the way the Obsidian host applies it — same attribute, same
// class, so the shared stylesheet's read-only rules (editor, toolbar, AND find/replace, which would
// otherwise let Replace All walk straight past contenteditable) all engage.
function applyLock() {
  const ed = app.querySelector(".tugtile-ed-rich");
  if (ed) ed.setAttribute("contenteditable", String(!locked));
  app.classList.toggle("tugtile--locked", locked);
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
    makeWebHost()
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
    brand: t("mtBrand"),
    brandLocked: t("mtBrandLocked"),
    modeLabel: t("mtModeToggle"),
    lockLabel: t("mtLockToggle"),
  });
  applyLock();
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
};

send("ready");
