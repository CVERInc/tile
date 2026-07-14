// Loads the built packages/marktile/main.js with a stubbed 'obsidian' so all top-level definitions
// (i18n, EDITOR_TOOLS, escHtml/highlighters/listContinuation, mountEditor, TileEditModal,
// MarktileView, the plugin class) evaluate — catching missing/undefined symbols from the core
// extraction — then runs onload() so the view registration + button wiring is exercised too.
const Module = require('module');
const orig = Module._load;
const noop = () => {};
const leafStub = { setViewState: noop, view: null };
const workspaceStub = { on: noop, getActiveFile: () => null, getLeaf: () => leafStub, getMostRecentLeaf: () => leafStub, detachLeavesOfType: noop, getLeavesOfType: () => [], onLayoutReady: (cb) => cb() };
Module._load = function (req, parent, isMain) {
  if (req === 'obsidian') {
    return {
      Plugin: class { constructor() { this.app = { workspace: workspaceStub }; } registerView() {} addRibbonIcon() {} addCommand() {} registerEvent() {} addSettingTab() {} registerExtensions() {} async loadData() { return {}; } async saveData() {} },
      Modal: class { constructor(app) { this.app = app; this.contentEl = {}; this.modalEl = {}; } open() {} close() {} },
      TextFileView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = { empty() {} }; } addAction() {} requestSave() {} },
      PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {} }; } },
      Setting: class { setName() { return this; } setDesc() { return this; } then() { return this; } addToggle() { return this; } },
      Notice: class {},
      setIcon: () => {},
      Platform: { isMobile: false },
      MarkdownView: class {},
      Component: class {},
    };
  }
  return orig.apply(this, arguments);
};
global.window = { localStorage: { getItem: () => '' } };

(async () => {
  const P = require('../packages/marktile/main.js');
  if (typeof P !== 'function') throw new Error('marktile main.js did not export a plugin class');
  const inst = new P();
  if (typeof inst.onload !== 'function') throw new Error('plugin has no onload');
  await inst.onload();    // exercises registerView + ribbon/command/event wiring + layout-ready inject
  inst.onunload();        // exercises detach + injected-button cleanup
  console.log('✅ marktile/main.js loads, constructs, onload()+onunload() run; exports', P.name || '(anonymous class)');
})();
