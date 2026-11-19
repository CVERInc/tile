// node packages/dynamic-corals/shared/add-menu.test.mjs
import assert from 'node:assert/strict';
import { menuPlace, wireAddMenu, httpHref, focusTarget, ADD_MENU_ROWS, ADD_MENU_CSS } from './add-menu.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };
const VIEW = { width: 1000, height: 700 }, MENU = { width: 200, height: 90 };
const door = (left, top, width, height = 30) => ({ left, top, right: left + width, bottom: top + height });

ok('the two rows are brand names, A to Z', () => {
  assert.deepEqual(ADD_MENU_ROWS, ['Apple · Outlook', 'Google Calendar']);
  assert.deepEqual([...ADD_MENU_ROWS].sort((a, b) => a.localeCompare(b, 'en')), ADD_MENU_ROWS);
});

ok('the menu opens under the door, at the pointer', () => {
  assert.deepEqual(menuPlace(door(100, 100, 60), MENU, VIEW, 130), { left: 110, top: 136 });
  assert.deepEqual(menuPlace(door(100, 100, 60), MENU, VIEW), { left: 100, top: 136 }, 'by keyboard: at the door’s own left');
});

ok('a wide door (a whole header bar) keeps the menu under itself, by the pointer', () => {
  const bar = door(20, 400, 440);
  assert.equal(menuPlace(bar, MENU, VIEW, 436).left, 260, 'a click at its right end: flush with the bar’s right edge, not past it');
  assert.equal(menuPlace(bar, MENU, VIEW, 30).left, 20, 'a click at its left end: flush with the left edge');
  assert.equal(menuPlace(bar, MENU, VIEW, 240).left, 220);
});

ok('it never leaves the screen: pushed in from the right edge, flipped above when there is no room below', () => {
  assert.equal(menuPlace(door(900, 100, 60), MENU, VIEW, 950).left, 792);
  assert.equal(menuPlace(door(100, 650, 60), MENU, VIEW, 120).top, 554);
  assert.equal(menuPlace(door(-50, 10, 20), MENU, VIEW, -40).left, 8);
  assert.equal(menuPlace(door(100, 20, 60, 660), MENU, VIEW, 120).top, 8, 'no room either way: the top edge');
});

ok('a document without popovers is left alone: the doors stay ordinary links', () => {
  const noPopover = { body: {}, head: {}, createElement: () => ({}) };
  assert.equal(wireAddMenu(noPopover), false);
  assert.equal(noPopover.__dcAddMenu, undefined);
  assert.equal(wireAddMenu(null), false);
  assert.equal(wireAddMenu({}), false, 'no body yet');
});

ok('only an http(s) address becomes a row: a javascript: or data: attribute on someone else’s markup is not vouched for', () => {
  assert.equal(httpHref('https://feed.example/v0/?ics=a', 'https://site.example/'), 'https://feed.example/v0/?ics=a');
  assert.equal(httpHref('/v0/?ics=a', 'https://site.example/x/'), 'https://site.example/v0/?ics=a');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'blob:https://site.example/1', 'file:///etc/passwd', 'webcal://feed.example/x.ics', '', null, undefined]) {
    assert.equal(httpHref(bad, 'https://site.example/'), '', String(bad));
  }
  assert.equal(httpHref('//[', 'https://site.example/'), '', 'unparseable');
});

ok('focus goes back to a door a screen reader can name: the door itself, or the row’s named one when the door is hidden', () => {
  const el = (attrs, row) => ({ isConnected: true, getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: () => row || null });
  const named = el({});
  const row = { querySelector: (q) => (q === 'a[data-dc-add-file]:not([aria-hidden="true"])' ? named : null) };
  assert.equal(focusTarget(named), named);
  assert.equal(focusTarget(el({ 'aria-hidden': 'true', tabindex: '-1' }, row)), named);
  assert.equal(focusTarget(el({ tabindex: '-1' }, row)), named);
  assert.equal(focusTarget(el({ 'aria-hidden': 'true' })), null, 'a hidden door outside any row: nowhere better, leave focus alone');
  assert.equal(focusTarget({ isConnected: false }), null);
  assert.equal(focusTarget(null), null);
});

ok('the style reads the site’s tokens and guesses no colour of its own for the surface', () => {
  assert.match(ADD_MENU_CSS, /background:var\(--gd-bg,var\(--gd-surface,Canvas\)\)/);
  assert.match(ADD_MENU_CSS, /color:var\(--gd-text,CanvasText\)/);
});

console.log(`\nadd-menu: ${n} passed`);
