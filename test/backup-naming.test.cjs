// Unit test for isBackupOf — which backup files belong to which board.
// Reproduces a data-safety bug: a plain startsWith(base+'-') made board "Plan" also claim board "Plan-2"'s
// backups, so pruning/restoring one board could delete/list another board's snapshots. The fix anchors the
// ISO timestamp suffix. Loads the built main.js with an 'obsidian' stub and captures the internal helper.
const fs = require('fs');
const path = require('path');

const setIcon = () => {};
const obsidian = {
  ItemView: class { constructor(leaf) { this.leaf = leaf; } },
  Plugin: class {}, PluginSettingTab: class {},
  Setting: class { setName() { return this; } setDesc() { return this; } then() { return this; } addToggle() { return this; } addText() { return this; } addDropdown() { return this; } },
  TextFileView: class { constructor(leaf) { this.leaf = leaf; } }, MarkdownView: class {},
  Notice: class {}, Menu: class { addItem() { return this; } showAtMouseEvent() {} },
  MarkdownRenderer: { render() {} }, Component: class { load() {} unload() {} },
  setIcon, Platform: { isMobile: false }, Modal: class {},
};
const src = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'obsidian', 'tugtile', 'main.js'), 'utf8');
const m = { exports: {} };
const req = (n) => (n === 'obsidian' ? obsidian : require(n));
new Function('module', 'exports', 'require', src + '\ntry{module.exports.__isBackupOf=isBackupOf;}catch(e){}')(m, m.exports, req);
const isBackupOf = m.exports.__isBackupOf;
if (!isBackupOf) { console.log('✗ could not capture isBackupOf'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL ', n); } };

const stamp = '2026-06-15T16-05-37-677Z';
// A real snapshot of "Plan" is matched.
ok('matches own backup', isBackupOf('Plan-' + stamp + '.md', 'Plan') === true);
// THE BUG: "Plan" must NOT claim "Plan-2"'s backup (Plan-2-<stamp>.md).
ok('does NOT match sibling board Plan-2', isBackupOf('Plan-2-' + stamp + '.md', 'Plan') === false);
// And "Plan-2" correctly matches its own.
ok('Plan-2 matches its own backup', isBackupOf('Plan-2-' + stamp + '.md', 'Plan-2') === true);
// Plain files that merely start with the base are not backups.
ok('not a backup: arbitrary file', isBackupOf('Plan-notes.md', 'Plan') === false);
ok('not a backup: no timestamp', isBackupOf('Plan-.md', 'Plan') === false);
// CJK base name with timestamp.
ok('cjk base', isBackupOf('旅行-' + stamp + '.md', '旅行') === true);
ok('cjk base does not match sibling', isBackupOf('旅行-2-' + stamp + '.md', '旅行') === false);
// Guards.
ok('empty name', isBackupOf('', 'Plan') === false);
ok('empty base', isBackupOf('Plan-' + stamp + '.md', '') === false);

console.log(fail ? `\n${fail} failed, ${pass} passed` : `all ${pass} backup-naming cases pass`);
process.exit(fail ? 1 : 0);
