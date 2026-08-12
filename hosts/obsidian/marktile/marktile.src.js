/* marktile — the tile-family standalone editor. Opens any .md note in the SAME world-class editor as
   tugtile (headings grow while the '## ' markers stay; CJK-safe contenteditable; smart-Enter lists).
   It is a switchable pane: the leaf becomes marktile, with a header button back to Obsidian's editor — and
   Obsidian's editor gets a button over to marktile. No global hijack (registerExtensions), so the native
   editor is always one tap away and a bug can never lock you out of a note.
   Built by build-marktile.sh, which (1) injects i18n into the TR object below and (2) inlines the shared
   core blocks (marked core-start / core-end in ../plugin.src.js) at the core-inline line. */
const { Plugin, Notice, TextFileView, Modal, Menu, setIcon, Platform, PluginSettingTab, Setting } = require('obsidian');   // Modal/Menu/setIcon/Platform are used by the inlined core editor; PluginSettingTab/Setting for the settings tab

// ---- i18n (mirrors tugtile; the same i18n/*.json is injected at build) ----
const LOCALE = (() => {
  let lang = '';
  try { lang = (window.localStorage.getItem('language') || ''); } catch (e) { lang = ''; }
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'ko') return 'ko-KR';
  return 'en-US';
})();
const TR = {};   // injected by build-marktile.sh
function t(key, ...args) {
  let s = (TR[LOCALE] && TR[LOCALE][key]);
  if (s == null) s = TR['en-US'] && TR['en-US'][key];
  if (s == null) return key;
  if (typeof s === 'string' && args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? args[+i] : m));
  return s;
}

//#core-inline   (build replaces this line with packages/core/editor-core.js — the shared engine)

const VIEW_TYPE = 'marktile-editor';

// marktile settings. editorTools: per-button on/off (missing key = on), same convention as tugtile — uncheck
// everything and the toolbar disappears. defaultEditor: opt-in to register marktile as the default .md editor
// (off by default, so Obsidian's native editor stays the no-surprise default).
const DEFAULTS = { editorTools: {}, defaultEditor: false, modes: {}, seasonedColor: false };

// The 3-mode cycle + its decorations live in the shared core (EDITOR_MODES + equipEditor, inlined). settings.modes
// gates which modes appear in the cycle (missing key = on, like editorTools); the picker keeps >=1 on.

// The editor's board-only hooks are no-ops; a .md file never "submits" on Enter (Enter is always a newline).
function makeFileHost(plugin, view) {
  const tools = (plugin && plugin.settings && plugin.settings.editorTools) || {};
  return {
    // ⌘-click on a link. Inside Obsidian the vault already knows how to open both kinds, so this
    // hands each one to the app rather than reimplementing resolution — `[[wiki]]` goes through the
    // same link resolver the rest of Obsidian uses (including "create if missing"), and a URL goes
    // out through the app's own opener so the user's settings about external links still apply.
    openLink(link) {
      const app = plugin && plugin.app;
      if (!app) return;
      const from = (view && view.file) ? view.file.path : '';
      if (link.kind === 'wiki' || link.kind === 'ref') app.workspace.openLinkText(link.target, from, false);
      else if (link.kind === 'url' || link.kind === 'image') window.open(link.target, '_blank');
    },
    _editModalOpen: false,
    freezeBoard() {}, unfreezeBoard() {}, closePopup() {}, consumePendingReload() {},
    attachDatePicker() {}, isSubmitKey() { return false; },
    dateTrigger: '@', timeTrigger: '@@',
    // date/time buttons insert tugtile's kanban-only syntax (meaningless in a plain note) → always off; everything
    // else follows the user's toolbar settings.
    plugin: { settings: { editorTools: Object.assign({}, tools, { date: false, time: false }) } },
  };
}

// A real editor pane for a .md file. TextFileView handles file load/save; we mount the shared editor into it
// and autosave on change. A header action switches the leaf back to Obsidian's native markdown editor.
class MarktileView extends TextFileView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }   // plugin ref → the editor reads its toolbar settings
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file ? this.file.basename : 'marktile'; }
  getIcon() { return 'square-m'; }   // marktile's identity = an 'M' badge (= its Seasoned mode), like tugtile's board = gallery-vertical
  async onOpen() {
    // Header actions register RIGHT-TO-LEFT (addAction renders in reverse), and Obsidian's own ⋯ sits rightmost.
    // Target order L→R: [→ tugtile] [→ Obsidian] [settings] [⋯]. So register settings → Obsidian → tugtile.
    this.addAction('settings', t('mtSettings'), () => { try { this.app.setting.open(); this.app.setting.openTabById(this.plugin.manifest.id); } catch (e) {} });
    this.addAction('file-text', t('mtBackToObsidian'), () => this.toObsidian());   // file-text = the conventional "native markdown" icon (Obsidian/Kanban/Excalidraw all use it)
    // tile-family interop: hand this file off to tugtile (open it as a kanban board), if it's installed (leftmost)
    if (this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('tugtile')) {
      this.addAction('gallery-vertical', t('mtToTugtile'), () => this.toTugtile());
    }
    this.watchHeaderTitle();   // take over the header title (clear the redundant filename, drop in the control strip) — see _buildHeaderCtl
  }
  // ── Header takeover, ported 1:1 from tugtile's BoardView (same CSS classes → identical look). The filename is
  //    redundant (the tab shows it), so it's cleared; the strip = viewcycle + brand/lock. Phone → a content-top
  //    .tugtile__ctlbar (built in setViewData); desktop → injected into the .view-header-title here.
  //    viewcycle cycles the view modes (cycleMode); brand/lock toggles read-only (toggleLock).
  _headerTitleEl() { return this.containerEl ? this.containerEl.querySelector('.view-header-title') : null; }
  decorateHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el) return;
    if (Platform.isPhone) { if (el.textContent !== '') el.textContent = ''; return; }   // Phone: strip lives in the content ctlbar; keep the header title empty
    if (el.querySelector('.tugtile-headerctl')) return;   // Already built; skip (also prevents observer loops). Obsidian wipes it on updateHeader → we rebuild.
    el.textContent = '';
    this._buildHeaderCtl(el);
  }
  watchHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el || this._titleObserver) return;
    this._titleObserver = new MutationObserver(() => this.decorateHeaderTitle());   // Obsidian resets the title on updateHeader → re-apply
    this._titleObserver.observe(el, { childList: true });
    this.decorateHeaderTitle();
  }
  _buildHeaderCtl(parent) {
    const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
    const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });   // the view-mode cycle (Seasoned / Rendered / Plain)
    vc.setAttribute('role', 'button');
    vc.setAttribute('aria-label', t('mtModeToggle'));   // cycles the view modes (NOT tugtile's board/table view switch)
    vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.cycleMode(); };
    this._viewCycleEl = vc;
    wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
    const lk = wrap.createSpan({ cls: 'tugtile-brand' });   // brand suffix + lock icon = the read-only toggle
    lk.setAttribute('role', 'button');
    lk.setAttribute('aria-label', t('mtLockToggle'));   // locks the EDITOR read-only (marktile has no board)
    lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleLock(); };
    this._lockBtnEl = lk;
    this.refreshCtl();
    return wrap;
  }
  refreshCtl() {
    const vc = this._viewCycleEl;
    if (vc && vc.isConnected) {
      vc.empty();
      const _m = this._currentMode();
      setIcon(vc.createSpan({ cls: 'tugtile-viewcycle-icon' }), _m.icon);   // square-m Seasoned · square-pen Rendered · square-code Plain
      vc.createSpan({ cls: 'tugtile-viewcycle-name', text: t(_m.name) });
    }
    const lk = this._lockBtnEl;
    if (lk && lk.isConnected) {
      lk.empty();
      lk.createSpan({ cls: 'tugtile-brand-text', text: this._locked ? t('mtBrandLocked') : t('mtBrand') });
      setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), this._locked ? 'lock' : 'lock-open');
    }
  }
  // The view cycle + its decorations are the shared core rig (equipEditor). The view only drives the button:
  // cycleMode advances the rig and remembers the key (restored across a reload); _currentMode feeds refreshCtl.
  _currentMode() {
    return this._rig ? this._rig.currentMode() : EDITOR_MODES[0];
  }
  cycleMode() {
    if (!this._rig) return;
    this._rig.cycleMode();
    this._modeKey = this._rig.currentMode().key;
    this.refreshCtl();
  }
  // Lock: make the editor read-only. Obsidian has no save step (whatever you change IS saved), so this guards
  // against stray edits/taps. Disables the contenteditable + (via CSS) the toolbar.
  toggleLock() {
    this._locked = !this._locked;
    this._applyLock();
    this.refreshCtl();
  }
  _applyLock() {
    const ed = this.contentEl.querySelector('.tugtile-ed-rich');
    if (ed) ed.setAttribute('contenteditable', String(!this._locked));
    this.contentEl.toggleClass('tugtile--locked', !!this._locked);
  }
  // Table of contents: a toggle side panel of H1–H3. The toggle button is added by the shared editor (onToc hook)
  // in the ✕-close slot of marktile's ancestor, tugtile's card modal. Click a heading → scroll the editor to it.
  // TOC = the shared core wireToc (one TOC for marktile + the web host). marktile's extras ride as hooks: the panel pins
  // below the in-flow toolbar (anchorScroll), the phone overlay closes after a jump (onNavigate), and the Sortable
  // gets tugtile's mobile touch tuning (sortableOptions). the rig (this._rig) is (re)created in setViewData after the mount.
  toggleToc(force) { if (this._rig && this._rig.toc) this._rig.toc.toggle(force); }
  _refreshTocSoon() { if (this._rig && this._rig.toc) this._rig.toc.refresh(); }   // shared wireToc no-ops when the panel is closed
  toTugtile() {
    if (!this.file) return;
    this.leaf.setViewState({ type: 'tugtile-board', active: true, state: { file: this.file.path } });
  }
  getViewData() { return this._ctrl ? this._ctrl.rawValue() : this.data; }
  setViewData(data, clear) {
    this.data = data;
    if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; }
    const _tocWasOpen = this._rig && this._rig.toc ? this._rig.toc.isOpen() : false;   // remember across the rebuild
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    this.contentEl.empty();
    this._ctrl = mountEditor(this.contentEl, { text: data, onChange: () => { this.requestSave(); this._refreshTocSoon(); }, onToc: () => this.toggleToc(), pickImage: () => pickVaultImage(this.app, this.file ? this.file.path : ''), pickVideo: () => promptVideoEmbed() }, makeFileHost(this.plugin, this));
    // mountEditor() empties contentEl, so build the phone control strip AFTER it and prepend above the toolbar.
    if (Platform.isPhone) { const ctl = createDiv({ cls: 'tugtile__ctlbar' }); this._buildHeaderCtl(ctl); this.contentEl.prepend(ctl); }
    this.decorateHeaderTitle();   // desktop: inject into the header title; phone: keep the header filename cleared
    this.contentEl.addClass('marktile-ed');   // scope: marktile IS a markdown editor → monospace font (not tugtile cards)
    this._applyLock();
    // Equip the shared editor rig (mode cycle + in-grid tables + inline images + TOC) on contentEl — the exact same
    // rig tugtile's modal equips. Host hooks: Obsidian vault image resolution, and the TOC's mobile/anchor tuning.
    this._rig = equipEditor({
      mount: this.contentEl, ctrl: this._ctrl,
      enabledModes: (this.plugin.settings && this.plugin.settings.modes) || {},
      seasonedColor: !!(this.plugin.settings && this.plugin.settings.seasonedColor),   // Seasoned palette: accent vs colour
      initialMode: this._modeKey,   // restore the current mode across a reload
      saveImage: (blob) => saveVaultImage(this.app, this.file ? this.file.path : '', blob),   // paste/drop an image → vault attachment + ![[…]]
      resolveSrc: (raw) => {
        raw = String(raw).split('|')[0].trim();
        if (/^(https?:|data:|app:)/i.test(raw)) return raw;
        if (!/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(raw.split('#')[0])) return null;
        try { const f = this.app.metadataCache.getFirstLinkpathDest(raw, this.file ? this.file.path : ''); return f ? this.app.vault.getResourcePath(f) : null; } catch (e) { return null; }
      },
      toc: {
        Sortable: (typeof Sortable !== 'undefined' ? Sortable : undefined),
        labels: { title: t('mtToc'), empty: t('mtTocEmpty') },
        onReorder: () => this.requestSave(),
        onNavigate: () => { if (Platform.isPhone) this.toggleToc(false); },   // phone overlay closes after a jump
        anchorScroll: '.tugtile-ed-scroll',                                    // pin the panel below the in-flow toolbar
        sortableOptions: { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, dragClass: 'marktile-toc-item--drag' },
      },
    });
    this.refreshCtl();   // viewcycle button reflects the restored mode
    if (_tocWasOpen) this._rig.toc.toggle(true);   // restore the TOC across a reload
  }
  clear() {
    if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; }
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    this.contentEl.empty();
    this.data = '';
  }
  async onClose() { if (this._rig) { this._rig.destroy(); this._rig = null; } if (this._titleObserver) { this._titleObserver.disconnect(); this._titleObserver = null; } if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; } }
  toObsidian() {
    if (!this.file) return;
    // tugtile globally hooks setViewState to reclaim board files as boards, so a plain setViewState('markdown')
    // on a board file bounces straight back to tugtile. Use tugtile's sanctioned escape-hatch API when present;
    // fall back to a direct switch when tugtile isn't installed (then there's no hook to dodge).
    const tg = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['tugtile'];
    if (tg && typeof tg.openAsObsidian === 'function') { tg.openAsObsidian(this.leaf); return; }
    this.leaf.setViewState({ type: 'markdown', active: true, state: { file: this.file.path, mode: 'source' } });
  }
}

// Settings tab: toolbar-button pickers (same style as tugtile; uncheck all → no toolbar) + the default-editor opt-in.
class MarktileSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: t('mtSettingsTitle') });
    containerEl.createEl('p', { cls: 'setting-item-description', text: t('mtSettingsDesc') });
    const toolPicker = (name, desc, filter) => new Setting(containerEl).setName(name).setDesc(desc).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const et = this.plugin.settings.editorTools || (this.plugin.settings.editorTools = {});
      EDITOR_TOOLS.forEach((tk) => {
        if (tk === 'sep' || tk === 'rowbreak' || !filter(tk)) return;
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = et[tk.key] !== false;
        const glyph = lbl.createSpan({ cls: 'tugtile-tool-chk-i' });
        if (tk.icon) setIcon(glyph, tk.icon); else glyph.textContent = tk.g;   // same icon the toolbar uses
        cb.onchange = async () => { et[tk.key] = cb.checked; await this.plugin.saveSettings(); };
      });
    });
    toolPicker(t('mtEssentialTools'), t('mtEssentialToolsDesc'), (tk) => tk.fixed);             // search / undo / redo
    toolPicker(t('gFormatTools'), t('gFormatToolsDesc'), (tk) => tk.cat === 'format');           // headings / bold / italic / strike
    toolPicker(t('gBlockTools'), t('gBlockToolsDesc'), (tk) => tk.cat === 'block');               // lists / check / quote / table
    toolPicker(t('gInsertTools'), t('mtInsertToolsDesc'), (tk) => tk.cat === 'insert' && tk.key !== 'date' && tk.key !== 'time');   // code / link (date/time are board-only)
    new Setting(containerEl).setName(t('mtModesPick')).setDesc(t('mtModesPickDesc')).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const md = this.plugin.settings.modes || (this.plugin.settings.modes = {});
      EDITOR_MODES.forEach((m) => {
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = md[m.key] !== false;
        setIcon(lbl.createSpan({ cls: 'tugtile-tool-chk-i' }), m.icon);
        lbl.createSpan({ text: t(m.name) });
        cb.onchange = async () => {
          const willOn = EDITOR_MODES.filter((x) => (x.key === m.key ? cb.checked : md[x.key] !== false));
          if (!willOn.length) { cb.checked = true; new Notice(t('mtModesMinOne')); return; }   // keep at least one mode in the cycle
          md[m.key] = cb.checked; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
        };
      });
    });
    new Setting(containerEl).setName(t('mtSeasonedColor')).setDesc(t('mtSeasonedColorDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.seasonedColor).onChange(async (v) => {
        this.plugin.settings.seasonedColor = v; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
      }));
    new Setting(containerEl).setName(t('mtDefaultEditor')).setDesc(t('mtDefaultEditorDesc'))
      .addToggle((tg) => tg.setValue(this.plugin.settings.defaultEditor).onChange(async (v) => {
        this.plugin.settings.defaultEditor = v; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
      }));

    // tile family cross-discovery: tell marktile users tugtile exists (even if not installed)
    const hasTg = !!(this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('tugtile'));
    const fam = new Setting(containerEl).setName(t('familyTugtile')).setDesc(hasTg ? t('familyHave') : t('familyTugtileDesc'));
    if (!hasTg) fam.addButton((b) => b.setButtonText(t('familyGet')).onClick(() => window.open('obsidian://show-plugin?id=tugtile')));
  }
}

module.exports = class MarktilePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._mdBtns = [];   // injected native-header buttons, tracked so we can remove them on unload
    this.registerView(VIEW_TYPE, (leaf) => new MarktileView(leaf, this));
    this.addSettingTab(new MarktileSettingTab(this.app, this));
    // Opt-in (off by default): make marktile the default editor for .md. Board files still open here too — hop to
    // tugtile with the gallery-vertical button. Toggling needs an Obsidian reload to take effect.
    if (this.settings.defaultEditor) { try { this.registerExtensions(['md'], VIEW_TYPE); } catch (e) {} }
    this.addRibbonIcon('square-m', t('mtRibbon'), () => this.openActiveInMarktile());
    this.addCommand({
      id: 'open-in-marktile',
      name: t('mtOpenCmd'),
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!(f && f.extension === 'md');
        if (ok && !checking) this.openActiveInMarktile();
        return ok;
      },
    });
    // Put an "open in marktile" button on every native markdown editor's header (the Obsidian → marktile hop)
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.injectMdButton(leaf)));
    // Also inject into markdown panes already open when marktile loads (active-leaf-change won't fire for them)
    this.app.workspace.onLayoutReady(() => this.app.workspace.getLeavesOfType('markdown').forEach((l) => this.injectMdButton(l)));
  }
  onunload() {
    // Per Obsidian plugin guidelines: do NOT detachLeavesOfType here — Obsidian reinitializes
    // open leaves at their original position on update; detaching ourselves causes problems.
    (this._mdBtns || []).forEach(({ view, el }) => { if (el) el.remove(); if (view) delete view._mtBtn; });   // Remove the buttons we injected into native headers
    this._mdBtns = [];
  }
  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
  injectMdButton(leaf) {
    this._mdBtns = (this._mdBtns || []).filter(({ el }) => el && el.isConnected);   // prune entries for closed leaves so dead MarkdownView refs can be GC'd (L3)
    const v = leaf && leaf.view;
    if (!v || typeof v.getViewType !== 'function' || v.getViewType() !== 'markdown' || v._mtBtn) return;
    try {
      const el = v.addAction('square-m', t('mtRibbon'), () => {
        const f = v.file;
        if (f) leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: f.path } });
      });
      v._mtBtn = el;
      this._mdBtns.push({ view: v, el });
    } catch (e) { /* header injection is best-effort; the command/ribbon are the reliable entry points */ }
  }
  openActiveInMarktile() {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== 'md') { new Notice(t('mtNoFile')); return; }
    const leaf = this.app.workspace.getLeaf(false);
    leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: f.path } });
  }
};
