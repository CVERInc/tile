// Cards settings' shape (w3/settings-nav.mjs): which panel at which width, the groups and rows in each mode,
// the narrow page stack, the confirmation's shape, and which layer ✕ / Escape closes. The DOM half is driven
// in a real browser by verify/settings-panel.mjs.
//
//   node --test packages/cardtile/w3/settings-nav.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDE_MIN, PANEL_MAX, layoutFor, settingsPlan, sidebarGroups, opensPage, CHOICES, createPageStack,
  confirmShape, topLayer, closeShows, LAYER_TOP_FIRST, swipeCloses, SWIPE_CLOSE_PX,
} from './settings-nav.mjs';
import { EDIT3_STRINGS } from './edit3-i18n.mjs';

test('the panel: iOS Settings below 700px, iPadOS Settings from 700, at most 1000 wide', () => {
  assert.equal(WIDE_MIN, 700);
  assert.equal(PANEL_MAX, 1000);
  assert.equal(layoutFor(390), 'narrow');
  assert.equal(layoutFor(699), 'narrow');
  assert.equal(layoutFor(700), 'wide');
  assert.equal(layoutFor(1280), 'wide');
});

test('groups, in order: the sandbox has the sign-in row first and Start over in the red group at the bottom', () => {
  const plan = settingsPlan({ sandbox: true });
  assert.deepEqual(plan.map((g) => g.id), ['account', 'name', 'look', 'views', 'found', 'more', 'danger']);
  assert.deepEqual(plan[0].rows, ['signin'], 'the first row is the sign-in entry');
  assert.deepEqual(plan.find((g) => g.id === 'name').rows, ['title', 'address', 'domain']);
  assert.deepEqual(plan.find((g) => g.id === 'look').rows, ['theme', 'accent', 'backdrop', 'header', 'icons']);
  assert.deepEqual(plan.find((g) => g.id === 'views').rows, ['views', 'back']);
  assert.deepEqual(plan.find((g) => g.id === 'more').rows, ['raw', 'backup', 'transfer']);
  assert.deepEqual(plan.at(-1), { id: 'danger', rows: ['reset'] }, 'Start over is the last group, on its own');
});

test('host mode: the platform-owned rows are not offered (pool, domain, transfer, Start over, sign-in)', () => {
  const plan = settingsPlan({ sandbox: false });
  const rows = plan.flatMap((g) => g.rows);
  for (const gone of ['signin', 'domain', 'pool', 'transfer', 'reset']) assert.ok(!rows.includes(gone), gone);
  assert.ok(rows.includes('address'), 'the address is still shown (read-only)');
  assert.deepEqual(plan.map((g) => g.id), ['name', 'look', 'views', 'more'], 'no red group at the root: Replace lives on the Backup page');
});

test('wide: the sidebar lists the groups; Replace and Start over sit together under More', () => {
  assert.deepEqual(sidebarGroups({ sandbox: true }), ['name', 'look', 'views', 'found', 'more']);
  assert.deepEqual(sidebarGroups({ sandbox: false }), ['name', 'look', 'views', 'more']);
  const more = settingsPlan({ sandbox: true, layout: 'wide' }).find((g) => g.id === 'more');
  assert.deepEqual(more.danger, ['replace', 'reset']);
  assert.deepEqual(settingsPlan({ sandbox: false, layout: 'wide' }).find((g) => g.id === 'more').danger, ['replace']);
});

test('pages: narrow pushes a page for every choice; wide keeps simple choices inline', () => {
  for (const r of ['theme', 'header', 'icons', 'accent', 'backdrop', 'views', 'back', 'backup', 'address', 'domain']) assert.ok(opensPage(r, 'narrow'), r);
  for (const r of ['title', 'pool', 'raw', 'signin', 'reset']) assert.ok(!opensPage(r, 'narrow'), r);
  for (const r of ['theme', 'header', 'icons', 'views', 'back', 'backup']) assert.ok(!opensPage(r, 'wide'), r);
  assert.ok(opensPage('address', 'wide'), 'changing the address asks for the old one first: its own page');
  // every 2–3-option choice has exactly its options (a checkmark list narrow, a dropdown wide)
  assert.deepEqual(CHOICES.theme, ['auto', 'light', 'dark']);
  assert.deepEqual(CHOICES.header, ['centre', 'left']);
  assert.deepEqual(CHOICES.icons, ['colour', 'mono']);
});

test('the page stack: push, back, and the root has no back', () => {
  const s = createPageStack('root');
  assert.equal(s.top, 'root'); assert.equal(s.back, null); assert.equal(s.depth, 1);
  s.push('theme');
  assert.equal(s.top, 'theme'); assert.equal(s.back, 'root'); assert.equal(s.depth, 2);
  s.push('theme');
  assert.equal(s.depth, 2, 'pushing the page you are on is not a second page');
  assert.equal(s.pop(), 'root');
  assert.equal(s.pop(), 'root', 'back from the root stays at the root');
  s.push('backup'); s.reset();
  assert.deepEqual(s.pages, ['root']);
  s.reset('look'); assert.equal(s.top, 'look');
});

test('a destructive confirmation: an action sheet narrow, a centred alert wide', () => {
  assert.equal(confirmShape('narrow'), 'sheet');
  assert.equal(confirmShape('wide'), 'alert');
});

test('✕ and Escape close the top-most layer first; settings sits under the sheets it opens', () => {
  assert.equal(topLayer({}), null);
  assert.equal(topLayer({ settings: true }), 'settings');
  assert.equal(topLayer({ settings: true, 'set-confirm': true }), 'set-confirm', 'a confirmation closes before the panel');
  assert.equal(topLayer({ settings: true, doormodal: true }), 'doormodal', 'the sign-in door opened from settings closes first');
  assert.equal(topLayer({ settings: true, picker: true }), 'picker');
  assert.equal(topLayer({ settings: true, picker: false, modal: true }), 'modal', 'a tile sheet opened from settings closes first');
  assert.equal(topLayer({ modal: true, zoom: true }), 'zoom');
  assert.equal(topLayer({ leavemodal: true, settings: true }), 'leavemodal');
  assert.equal(LAYER_TOP_FIRST.at(-1), 'settings');
  // ✕ shows whenever something is open, except the leave dialog (its three answers are the way out)
  assert.equal(closeShows({}), false);
  assert.equal(closeShows({ settings: true }), true);
  assert.equal(closeShows({ modal: true }), true);
  assert.equal(closeShows({ leavemodal: true, modal: true }), false);
});

test('a downward swipe on the header closes; a short or sideways one does not', () => {
  assert.equal(swipeCloses(0, SWIPE_CLOSE_PX), true);
  assert.equal(swipeCloses(10, 160), true);
  assert.equal(swipeCloses(0, SWIPE_CLOSE_PX - 1), false, 'too short');
  assert.equal(swipeCloses(120, 100), false, 'more sideways than down');
  assert.equal(swipeCloses(0, -200), false, 'upward');
});

test('the words: every settings string is in English and Traditional Chinese, and the owner’s sign-in lines are exact', () => {
  const keys = ['options', 'settingsBack', 'signIn', 'signInSays', 'sbxStatus', 'secName', 'secLook', 'secViewsBack', 'secFound', 'secMore',
    'viewsL', 'viewsKeepOne', 'listSep', 'bcValue', 'domainNone', 'themeAutoSays', 'bdNone', 'bdSet', 'bdPick', 'bdUrl', 'bdRemove',
    'replaceSays', 'replaceAsk', 'replaceGo', 'resetAsk', 'resetSays', 'dangerSays', 'accentReset', 'download', 'replaceFile'];
  for (const l of ['en', 'zh']) for (const k of keys) assert.ok(typeof EDIT3_STRINGS[l][k] === 'string' && EDIT3_STRINGS[l][k].length, `${k}/${l}`);
  assert.equal(EDIT3_STRINGS.en.options, 'Cards settings');
  assert.equal(EDIT3_STRINGS.zh.options, 'Cards 設定');
  assert.equal(EDIT3_STRINGS.zh.signInSays, '登入後，存好就上線，換台裝置也找得到。這裡的內容會跟著帶過去。');
  assert.equal(EDIT3_STRINGS.zh.sbxStatus, '還沒登入，現在只存在這個瀏覽器裡。');
  // the whole thing is "your Cards" — never 這組 / 整組
  for (const k of keys) assert.doesNotMatch(EDIT3_STRINGS.zh[k], /這組|整組/, k);
});
