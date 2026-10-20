// marktile ▸ Settings… — the Mac host's copy of the Obsidian plugin's settings tab (MarktileSettingTab in
// hosts/obsidian/marktile/marktile.src.js): the same groups, the same engine lists, icons and words, and
// the same stored shape (`editorTools`, `modes`; a missing key means on). Swift stores the object and hands
// it to every editor window (EditorSettings.swift); nothing here is interpreted twice.
//
// Changes apply at once — there is no Save button on a Mac settings pane, and no "reload required".

import "../Engine/obsidian-shim.js";
import { EDITOR_TOOLS, EDITOR_MODES, t } from "../Engine/editor-core.js";

const send = (kind, payload) => {
  try { window.webkit.messageHandlers.marktile.postMessage(Object.assign({ kind }, payload || {})); } catch (e) {}
};

let settings = {};
const save = () => send("save", { json: JSON.stringify(settings) });

const root = document.getElementById("root");
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function row(icon, name, checked, onChange) {
  const label = el("label");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb));
  const ic = el("span", "ic"); setIcon(ic, icon);
  label.append(cb, ic, el("span", null, name));
  return label;
}

function section(title, desc) {
  const s = el("section");
  s.append(el("h2", null, title));
  if (desc) s.append(el("p", null, desc));
  const g = el("div", "group");
  s.append(g);
  root.append(s);
  return { s, g };
}

// The Obsidian tab's four toolbar groups, with the same filters. Image and video need a host seam this app
// does not have, and date/time belong to the board editor — so, as there, they are not offered.
const offered = (tk) => tk !== "sep" && tk !== "rowbreak" && !tk.needs && tk.key !== "date" && tk.key !== "time";
const GROUPS = [
  ["mtEssentialTools", "mtEssentialToolsDesc", (tk) => tk.fixed],
  ["gFormatTools", "gFormatToolsDesc", (tk) => tk.cat === "format"],
  ["gBlockTools", "gBlockToolsDesc", (tk) => tk.cat === "block"],
  ["gInsertTools", "mtInsertToolsDesc", (tk) => tk.cat === "insert"],
];

function render() {
  root.replaceChildren();
  const tools = settings.editorTools || (settings.editorTools = {});
  for (const [title, desc, filter] of GROUPS) {
    const { g } = section(t(title), t(desc));
    for (const tk of EDITOR_TOOLS.filter((x) => offered(x) && filter(x))) {
      g.append(row(tk.icon, t(tk.tip), tools[tk.key] !== false, (cb) => { tools[tk.key] = cb.checked; save(); }));
    }
  }

  const modes = settings.modes || (settings.modes = {});
  const { s, g } = section(t("mtModesPick"), t("mtModesPickDesc"));
  const note = el("p", "note");
  s.append(note);
  for (const m of EDITOR_MODES) {
    g.append(row(m.icon, t(m.name), modes[m.key] !== false, (cb) => {
      const on = EDITOR_MODES.filter((x) => (x.key === m.key ? cb.checked : modes[x.key] !== false));
      // At least one mode, as in Obsidian — and said where the click happened, not in a toast.
      if (!on.length) { cb.checked = true; note.textContent = t("mtModesMinOne"); return; }
      note.textContent = "";
      modes[m.key] = cb.checked;
      save();
    }));
  }

  // The legacy `seasonedColor: true` (from before there were three palettes) reads as "color", as it does in
  // the engine — so the menu shows what the editor is actually doing.
  if (!settings.seasonedPalette && settings.seasonedColor) settings.seasonedPalette = "color";
  choice("mtSeasonedPalette", "mtSeasonedPaletteDesc", "seasonedPalette",
    [["accent", "mtPaletteAccent"], ["color", "mtPaletteColor"], ["plain", "mtPalettePlain"]]);
  choice("mtSeasonedFont", "mtSeasonedFontDesc", "seasonedFont",
    [["mono", "mtFontMono"], ["text", "mtFontText"]]);
}

// Two choices of look, as pop-up menus — the Obsidian tab's two dropdowns, same keys, same words.
function choice(title, desc, key, options) {
  const { g } = section(t(title), t(desc));
  g.classList.add("single");
  const select = el("select");
  for (const [value, label] of options) {
    const o = el("option", null, t(label)); o.value = value; select.append(o);
  }
  select.value = settings[key] || options[0][0];
  select.addEventListener("change", () => { settings[key] = select.value; save(); });
  g.append(select);
}

window.__settings = {
  load: (s) => { settings = (s && typeof s === "object") ? s : {}; render(); },
};

send("ready");
