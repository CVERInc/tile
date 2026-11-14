// The three views of a Card page — stack, list, wall — are one set of nodes (tile#297). This runs the
// REAL w3/deck.js over the REAL page renderCardHTML serves, in the stand-in DOM beside it
// (w3/mini-dom.mjs), and holds the deck to what a view switch promises:
//
//   - no switch navigates or reloads
//   - the cells the engine rendered are the same nodes (===) before and after, and none of them is
//     ever outside the document
//   - the wall, after any trip through another view, is the engine's own markup again
//   - the switcher keeps focus, and the place you were reading carries over
//   - the view a page opens on is in the markup, and is applied before deck.js runs
//
// 🔴 What this cannot say: there is no layout and no paint in the stand-in. "No flash" and "no
// layout shift" are asked of a real browser by verify/deck-views.mjs; here the claim is narrower —
// which classes the root carries before the deck's script has run.
//
//   node --test packages/cardtile/w3/deck-views.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { withDeck, openingView, DECK_JS_PATH, DECK_TRY_URL } from './deck-page.mjs';
import { deckStrings, DECK_STRINGS } from './deck-i18n.mjs';
import { makeWindow } from './mini-dom.mjs';
import { hrefAllowed } from '../../sitetile/site-core.js';

const DECK_JS = readFileSync(new URL('./deck.js', import.meta.url), 'utf8');
const LS = 'reef-card-layout';
const INNER = { stack: 'deck', list: 'list', wall: 'spread' };
const VIEWS = ['stack', 'list', 'wall'];
// 🔴 nodes are compared with ===, never handed to assert.equal: on a failure node:assert prints both
// operands, and printing a node walks the whole page through every parent and child (minutes of it).
const same = (a, b, why) => assert.ok(a === b, why);

/** a Card with one of every shape the deck treats differently */
const card = ({ views, view, n = 0 } = {}) => ['---', 'card-page: specimen', 'title: Specimen',
  ...(views ? [`views: ${views}`] : []), ...(view ? [`view: ${view}`] : []), '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% A bio.',
  '- [ ] %% card: link w=6 %% [One](https://example.com/1)',          // two full-width links in a row: a run
  '- [ ] %% card: link w=6 %% [Two](https://example.com/2)',
  '- [ ] %% card: text w=6 back=#about %% Turn me over.',              // full-bleed, with a back of its own
  '- [ ] %% card: link w=3 %% [Three](https://example.com/3)',
  '- [ ] %% card: text w=3 noback %% No back.',
  ...Array.from({ length: n }, (_, i) => `- [ ] %% card: link w=2 %% [L${i}](https://example.com/l${i})`),
  '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');

/** the engine's cells, in page order — asked of the page BEFORE the deck's script has run */
// (a back's own tiles are not the card's: a back is in its drawer on the wall and on its card in a pile)
const engineCells = (doc) => doc.querySelectorAll('main .st-cell').filter((c) => !c.closest('.dc-drawer, .dc-drawer-body'));
/** the engine's own markup for the card, which the wall must still be (the deck's markers are comments) */
const wallMarkup = (doc) => doc.querySelectorAll('main .st-grid, main .st-bleed')
  .filter((e) => !e.closest('.dc-drawer') && !e.closest('.deck-table'))
  .map((e) => e.outerHTML.replace(/<!--[\s\S]*?-->/g, '')).join('\n');

/**
 * Open a page: parse what the Worker serves, run its inline scripts (the head script among them),
 * then the deck. `layout` gives the stand-in the two measurements the deck asks a browser for: how
 * tall the document is, and where the wall's tiles are.
 */
function open(md, { storage, moveBefore, ctx = {}, bare = false, deckJs = DECK_JS, quiet = false, page = null, before: setUp = null, layout = null, reducedMotion = false } = {}) {
  let html = renderCardHTML(md, { handle: 'specimen', ...ctx });
  if (bare) html = html.replace(/<html[^>]*>/, '<html lang="en">').replace(/<script>\(function\(d\)[\s\S]*?<\/script>/, '');
  if (page) html = page(html);   // what another page of ours adds to the markup (the draw page's attribute)
  const win = makeWindow(html, { scripts: true, storage, moveBefore, reducedMotion });
  const doc = win.document, root = doc.documentElement;
  const cells = engineCells(doc);
  const ft = doc.querySelector('footer.st-footer');
  const before = { cells, wall: wallMarkup(doc), parents: cells.map((c) => c.parentNode), footerParent: ft && ft.parentNode, rootBeforeDeck: { view: root.dataset.view, cls: root.className } };
  if (quiet) win.console = { ...console, error() {} };   // a deck that fails says so on the console; the test that makes it fail does not need to read it
  const inDeck = () => root.classList.contains('deck');
  doc.scrollHeightOf = (el) => (el !== root ? 0 : inDeck() ? win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length) : 400 + cells.length * 300);
  doc.rectOf = (el) => (inDeck() || !cells.includes(el) ? { width: 342, height: 480 } : { top: 200 + cells.indexOf(el) * 300 - win.scrollY, left: 24, width: 342, height: 280 });
  if (layout) layout(win, doc);     // a page with measurements of its own (the file wall)
  if (setUp) setUp(win, doc);       // what the page has on window before the deck runs (a card file, a fixed shuffle)
  win.run(deckJs, 'deck.js'); win.tick(3000);
  const button =(v) => doc.querySelector(`.deck-seg button[data-m="${INNER[v]}"]`);
  const press = (v) => { const b = button(v); assert.ok(b, `the switcher has no ${v} button`); b.focus(); b.click(); win.tick(3000); return b; };
  return { win, doc, root, cells, before, button, press };
}

/** the promises that hold in EVERY view, checked after every step */
function holds(p, view, why) {
  const { win, doc, root, cells, before } = p;
  assert.equal(win.nav.reloads, 0, `${why}: location.reload() was called`);
  assert.deepEqual(win.nav.assigns, [], `${why}: the page navigated`);
  assert.equal(root.dataset.view, view, `${why}: the root does not name the view`);
  assert.equal(root.classList.contains('deck'), view !== 'wall', `${why}: html.deck`);
  assert.equal(root.classList.contains('list'), view === 'list', `${why}: html.list`);
  const now = engineCells(doc);
  assert.equal(now.length, cells.length, `${why}: the page has ${now.length} engine cells, it was served ${cells.length}`);
  for (const c of cells) assert.ok(c.isConnected, `${why}: a cell the engine rendered is outside the document`);
  for (const c of cells) assert.ok(now.includes(c), `${why}: a cell was replaced by another node`);
  assert.equal(doc.left.filter((n) => cells.some((c) => n === c || n.contains(c))).length, 0, `${why}: a cell left the document at some point`);
  if (view === 'wall') {
    assert.equal(wallMarkup(doc), before.wall, `${why}: the wall is not the engine's own markup`);
    cells.forEach((c, i) => same(c.parentNode, before.parents[i], `${why}: cell ${i} is not back where the engine put it`));
  } else {
    // a tile is the front of its card — or, in a long Card, still where the engine put it until the pile reaches it
    let seated = 0;
    cells.forEach((c, i) => {
      const f = c.parentNode;
      if (f === before.parents[i]) return;
      assert.ok(f.classList.contains('deck-front') && f.parentNode.classList.contains('deck-card'), `${why}: a cell is neither the front of a card nor where the engine put it`);
      assert.ok(f.parentNode.closest('.deck-table'), `${why}: a card is not on the table`);
      seated++;
    });
    const onTable = doc.querySelectorAll('.deck-stack > .deck-card');
    assert.ok(onTable.length > 0 && onTable.length <= 60, `${why}: ${onTable.length} cards on the table`);
    if (cells.length <= 40) assert.equal(seated, cells.length, `${why}: a short Card has every tile on its card`);
    // the card that is up holds the tile it stands for
    const top = doc.querySelector('.deck-stack > .deck-card.is-top'), cur = p.win.__deckCur();
    assert.ok(top, `${why}: no card is up`);
    if (cur < cells.length) same(cells[cur].closest('.deck-card'), top, `${why}: the card that is up does not hold tile ${cur}`);
  }
  for (const v of VIEWS) { const b = p.button(v); if (b) assert.equal(b.getAttribute('aria-pressed'), String(v === view), `${why}: the ${v} button's pressed state`); }
}

// ── the six switches ─────────────────────────────────────────────────────────────────────────────
for (const from of VIEWS) for (const to of VIEWS) {
  if (from === to) continue;
  test(`${from} → ${to}: no navigation, the same cell nodes, the switcher keeps focus`, () => {
    const p = open(card({ view: from }));
    holds(p, from, `opened on ${from}`);
    const b = p.press(to);
    holds(p, to, `${from} → ${to}`);
    same(p.doc.activeElement, b, 'focus left the switcher');
    assert.equal(p.win.localStorage.getItem(LS), INNER[to], 'the visitor\'s pick is remembered');
    // and back again: a round trip leaves the first view as it was
    const back = p.press(from);
    holds(p, from, `${from} → ${to} → ${from}`);
    same(p.doc.activeElement, back, 'focus left the switcher on the way back');
  });
}

test('every ordered pair in one sitting: one page, twelve switches, still the same nodes', () => {
  const p = open(card({ view: 'stack' }));
  let at = 'stack';
  for (const to of ['list', 'wall', 'stack', 'wall', 'list', 'stack', 'list', 'stack', 'wall', 'list', 'wall', 'stack']) {
    p.press(to); holds(p, to, `${at} → ${to}`); at = to;
  }
});

test('with Element.moveBefore the cells are moved, not re-inserted', () => {
  const p = open(card({ view: 'stack' }), { moveBefore: true });
  const moved = p.doc.moved;
  p.press('wall'); holds(p, 'wall', 'stack → wall');
  assert.ok(p.doc.moved >= moved + p.cells.length, 'the switch did not use moveBefore for the cells');
  p.press('list'); holds(p, 'list', 'wall → list');
});

// ── what carries over ────────────────────────────────────────────────────────────────────────────
test('the card you were on carries over: stack ⇄ list keep it, the wall scrolls to its tile, and back', () => {
  const p = open(card({ view: 'stack' }));
  p.win.__deckJump(4); p.win.tick(1000);
  assert.equal(p.win.__deckCur(), 4);
  p.press('list'); assert.equal(p.win.__deckCur(), 4, 'stack → list lost the place');
  p.press('wall');
  same(p.doc.scrolledIntoView.at(-1)?.el, p.cells[4], 'list → wall did not bring the tile you were on into view');
  assert.equal(typeof p.win.__deckCur, 'undefined', 'the wall still answers for the deck (a dice would jump a pile that is not showing)');
  // read on down the wall, then go back to the pile: the card under the middle of the window is up
  p.win.scrollTo({ top: 200 + 2 * 300 + 140 - p.win.innerHeight / 2 });
  p.press('stack');
  assert.equal(p.win.__deckCur(), 2, 'wall → stack did not open on the tile in the middle of the window');
  p.win.scrollTo({ top: 0 }); p.win.tick(1000);
});

test('the wall at the very top opens the pile on its first card', () => {
  const p = open(card({ view: 'wall' }));
  p.press('stack');
  assert.equal(p.win.__deckCur(), 0);
});

test('a back, the door to it and the footer are the same nodes in every view', () => {
  const p = open(card({ view: 'wall' }));
  const { doc } = p;
  const body = doc.querySelector('#about .dc-drawer-body'), door = doc.querySelector('.st-back-door'), footer = doc.querySelector('footer.st-footer');
  assert.ok(body && door && footer, 'the specimen lost a subject');
  const home = { body: body.parentNode, footer: footer.parentNode };
  p.press('stack');
  assert.ok(body.parentNode.classList.contains('deck-back-scroll'), 'in stack the back is the card\'s other side');
  same(body.closest('.deck-card'), door.closest('.deck-card'), 'the back is on the card whose tile names it');
  assert.ok(door.isConnected && door.parentNode.classList.contains('st-cell'), 'the door is still in its tile (the stylesheet hides it in a pile)');
  assert.ok(footer.closest('.st-card'), 'the footer sits under the cards, in their stacking context');
  p.press('wall');
  same(body.parentNode, home.body, 'on the wall the back is in its own drawer again');
  same(footer.parentNode, home.footer, 'on the wall the footer is where the engine put it');
  same(doc.querySelector('.st-back-door'), door, 'the door is another node');
  assert.equal(doc.querySelectorAll('#about').length, 1, 'the back exists once');
});

test('a card can be turned over in stack and list, and a switch puts it back first', () => {
  const p = open(card({ view: 'stack' }));
  const top = p.cells[0].closest('.deck-card');
  p.cells[0].parentNode.dispatchEvent(new p.win.Event('click', { bubbles: true, isTrusted: true })); p.win.tick(1000);
  assert.ok(top.classList.contains('flipped') && p.root.classList.contains('open'), 'the top card did not turn over');
  p.win.__deckView('wall'); p.win.tick(1000);
  assert.ok(!p.root.classList.contains('open') && !top.classList.contains('is-open'), 'the wall was entered with a card still held');
  holds(p, 'wall', 'stack (open) → wall');
});

test('a switch made with a card held gives focus back to the switcher, not to where the card was picked up from', () => {
  const p = open(card({ view: 'stack' }));
  const elsewhere = p.doc.querySelector('.st-hero-name'); elsewhere.focus();
  p.cells[0].parentNode.dispatchEvent(new p.win.Event('click', { bubbles: true, isTrusted: true })); p.win.tick(1000);
  assert.ok(p.root.classList.contains('open'), 'CONTROL: a card is held');
  const b = p.press('list');
  holds(p, 'list', 'stack (open) → list');
  assert.ok(!p.root.classList.contains('open'), 'the card is still held');
  same(p.doc.activeElement, b, 'putting the card back took focus away from the switcher');
});

test('Enter on the switcher switches, and does not also turn the top card over', () => {
  const p = open(card({ view: 'stack' }));
  const key = (el) => el.dispatchEvent(new p.win.Event('keydown', { key: 'Enter', bubbles: true }));
  key(p.doc.body); p.win.tick(1000);
  assert.ok(p.root.classList.contains('open'), 'CONTROL: Enter on the page turns the top card over');
  p.win.dispatchEvent(new p.win.Event('keydown', { key: 'Escape' })); p.win.tick(1000);
  assert.ok(!p.root.classList.contains('open'), 'CONTROL: Escape puts it back');
  const b = p.button('list'); b.focus(); key(b);
  assert.ok(!p.root.classList.contains('open'), 'Enter on the switcher turned a card over');
  b.click(); p.win.tick(3000);
  holds(p, 'list', 'stack → list by keyboard');
  same(p.doc.activeElement, b, 'focus left the switcher');
});

test('a card put back before its turn ends does not take focus afterwards', () => {
  const p = open(card({ view: 'stack' }));
  const b = p.button('list'); b.focus();
  p.cells[0].parentNode.dispatchEvent(new p.win.Event('click', { bubbles: true, isTrusted: true }));   // the turn starts; focus would follow in 620 ms
  p.win.tick(100); b.click(); p.win.tick(3000);
  holds(p, 'list', 'stack (turning) → list');
  same(p.doc.activeElement, b, 'the card that was put back took focus');
});

test('the root is the word on the opening view: deck.js opens on what it says, not on a second opinion', () => {
  // the head script has decided before the first paint; a deck that decided again, differently, would redraw the page
  const html = renderCardHTML(card({ view: 'stack' }), { handle: 'specimen' }).replace('data-view="stack"', 'data-view="list"');
  const win = makeWindow(html, { scripts: true });
  win.document.scrollHeightOf = () => 844 * 6;
  win.run(DECK_JS, 'deck.js'); win.tick(3000);
  const root = win.document.documentElement;
  assert.equal(root.dataset.view, 'list');
  assert.ok(root.classList.contains('deck') && root.classList.contains('list'), `the root's classes are "${root.className}"`);
  assert.equal(win.document.querySelector('.deck-seg button[aria-pressed="true"]').dataset.m, 'list');
});

test('every tile is a card: a run of full-width links is dealt too', () => {
  const p = open(card({ view: 'stack' }));
  const inRun = p.cells.filter((c) => c.parentNode === p.before.parents[p.cells.indexOf(c)] ? false : p.before.parents[p.cells.indexOf(c)].classList.contains('st-run'));
  assert.equal(inRun.length, 2, 'the specimen has no run');
  assert.equal(p.win.__deckCount(), p.cells.length, 'the pile has a card for every tile');
});

// ── the stylesheet's half ─────────────────────────────────────────────────────────────────────────
// deck.js leaves nodes in the page and relies on deck.css not to draw them. 🔴 This reads what the
// stylesheet DECLARES (comments stripped, rule by rule) — there is no cascade here, so it cannot say
// that nothing overrides a rule; verify/deck-views.mjs asks a browser which tiles have a box.
test('deck.css declares what deck.js leaves to it: what is not drawn in a pile, and what is not drawn on the wall', () => {
  const css = readFileSync(new URL('./deck.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((x) => x.trim()), body: m[2] }));
  const hidden = (sel) => rules.some((r) => r.sels.includes(sel) && /(^|;)\s*display\s*:\s*none\s*(;|$)/.test(r.body));
  assert.ok(rules.length > 300, 'CONTROL: the stylesheet was read');
  assert.ok(!hidden('html.deck .deck-table') && !hidden('.deck-seg'), 'CONTROL: the reader does not say yes to everything');
  for (const sel of [
    'html.deck main > .st-card > .st-grid', 'html.deck main > .st-card > .st-bleed',   // the engine's grid, in a pile (and before deck.js has run)
    'html.deck .st-back-door',                                                         // the wall's door to a back
    'html:not(.deck) .deck-table', 'html:not(.deck) .deck-veil', 'html:not(.deck) .deck-rail', 'html:not(.deck) .deck-bar > :not(.deck-seg)',   // the pile, on the wall
    '.deck-bench',                                                                     // cards outside the window
  ]) assert.ok(hidden(sel), `deck.css no longer declares \`${sel}{display:none}\` — deck.js leaves those nodes in the page and counts on it`);
});

// ── a long Card ──────────────────────────────────────────────────────────────────────────────────
test('200 tiles: only a window of cards is on the table, and every tile stays in the document', () => {
  const p = open(card({ view: 'stack', n: 200 }));
  assert.equal(p.cells.length, 206);
  holds(p, 'stack', 'opened');
  const onTable = () => p.doc.querySelectorAll('.deck-stack > .deck-card').length;
  const made = () => p.doc.querySelectorAll('.deck-card').length;
  assert.ok(onTable() < 60, `the whole pile is on the table (${onTable()} cards)`);
  assert.ok(made() < 60, `opening a long Card made a card for every tile (${made()}) instead of for the ones near the top`);
  assert.equal(p.win.__deckCount(), 206, 'the pile still counts every tile');
  for (const i of [150, 205, 3, 99]) { p.win.__deckJump(i); p.win.tick(1000); holds(p, 'stack', `jumped to ${i}`); assert.ok(onTable() < 60); }
  // a card that was made and then left behind waits on the bench, with its tile — it is not unmade
  const first = p.cells[0].closest('.deck-card');
  assert.ok(first && first.parentNode.classList.contains('deck-bench'), 'the first card, far from the top now, is not on the bench');
  p.press('wall'); holds(p, 'wall', 'stack → wall');
  p.press('list'); holds(p, 'list', 'wall → list');
});

// ── the opening view is in the markup ────────────────────────────────────────────────────────────
const MATRIX = [
  { fm: {}, opens: 'stack', offers: 'stack list wall' },
  { fm: { view: 'stack' }, opens: 'stack', offers: 'stack list wall' },
  { fm: { view: 'list' }, opens: 'list', offers: 'stack list wall' },
  { fm: { view: 'wall' }, opens: 'wall', offers: 'stack list wall' },
  { fm: { views: 'wall' }, opens: 'wall', offers: 'wall' },
  { fm: { views: 'list wall' }, opens: 'list', offers: 'list wall' },
  { fm: { views: 'wall, stack' }, opens: 'wall', offers: 'wall stack' },
  { fm: { views: 'stack list', view: 'wall' }, opens: 'stack', offers: 'stack list' },   // not offered: the first offered
  { fm: { views: 'stack list', view: 'list' }, opens: 'list', offers: 'stack list' },
  { fm: { views: 'nonsense' }, opens: 'stack', offers: 'stack' },
];
for (const { fm, opens, offers } of MATRIX) {
  const name = JSON.stringify(fm);
  test(`${name}: the served markup opens on ${opens}, before the deck's script`, () => {
    const md = card(fm);
    const html = renderCardHTML(md, { handle: 'specimen' });
    assert.match(html, new RegExp(`^<!doctype html><html [^>]*data-view="${opens}" data-views="${offers}"`), 'the markup does not carry the opening view');
    assert.deepEqual(openingView(md), { view: opens, views: offers.split(' ') });
    const p = open(md);
    // the root already says so when deck.js starts: the head script turned the attribute into the classes the stylesheet keys on
    assert.deepEqual(p.before.rootBeforeDeck, { view: opens, cls: opens === 'wall' ? '' : opens === 'list' ? 'deck list' : 'deck' });
    holds(p, opens, 'opened');
    assert.deepEqual(VIEWS.filter((v) => p.button(v)).sort(), offers.split(' ').sort(), 'the switcher offers what the file offers');
  });
  test(`${name}: deck.js alone (a page without the markup) decides the same`, () => {
    const p = open(card(fm), { bare: true });
    assert.deepEqual(p.before.rootBeforeDeck, { view: undefined, cls: '' }, 'CONTROL: this page really has no opening view in its markup');
    holds(p, opens, 'opened bare');
  });
}

test('a visitor\'s last pick opens the page — before the deck\'s script, and only when the file offers it', () => {
  let p = open(card({ view: 'stack' }), { storage: { [LS]: 'spread' } });
  assert.deepEqual(p.before.rootBeforeDeck, { view: 'wall', cls: '' }, 'the stored pick was not applied by the head script');
  holds(p, 'wall', 'stored wall');
  p = open(card({ view: 'wall' }), { storage: { [LS]: 'list' } });
  assert.deepEqual(p.before.rootBeforeDeck, { view: 'list', cls: 'deck list' });
  holds(p, 'list', 'stored list');
  p = open(card({ views: 'stack list' }), { storage: { [LS]: 'spread' } });
  assert.deepEqual(p.before.rootBeforeDeck, { view: 'stack', cls: 'deck' }, 'a pick the file does not offer was honoured');
  holds(p, 'stack', 'stored wall, not offered');
  p = open(card({ view: 'list' }), { storage: { [LS]: 'nonsense' } });
  holds(p, 'list', 'a stored value that names no view');
});

test('the editor names the view: a stored pick is ignored, and its switch is in place and remembers nothing', () => {
  const p = open(card({ view: 'wall' }), { storage: { [LS]: 'spread' }, ctx: { deck: { view: 'list' } } });
  assert.ok(p.root.hasAttribute('data-view-pin'), 'the markup does not say the view was named for it');
  assert.deepEqual(p.before.rootBeforeDeck, { view: 'list', cls: 'deck list' });
  holds(p, 'list', 'pinned list');
  assert.equal(p.win.__deckView('stack'), true, 'the deck refused a view the file offers');
  p.win.tick(3000);
  holds(p, 'stack', 'editor: list → stack');
  assert.equal(p.win.localStorage.getItem(LS), 'spread', 'the editor\'s switch overwrote the visitor\'s pick');
  assert.equal(p.win.__deckView('stack'), true, 'naming the view it is on is not a failure');
  assert.equal(p.win.__deckView('nonsense'), false);
});

test('__deckView refuses a view the file does not offer', () => {
  const p = open(card({ views: 'stack list' }));
  assert.equal(p.win.__deckView('wall'), false);
  holds(p, 'stack', 'refused wall');
});

test('without scripts the page is the wall, and a deck script that fails to load says so', () => {
  const html = renderCardHTML(card({ view: 'stack' }), { handle: 'specimen' });
  const win = makeWindow(html);   // no script ran
  assert.equal(win.document.documentElement.className, '', 'the markup alone must not hide the page behind a deck that never arrives');
  const tag = new RegExp(`<script src="${DECK_JS_PATH.replace(/[.]/g, '\\.')}" onerror="([^"]*)"></script></body>`).exec(html);
  assert.ok(tag, 'deck.js is not the last thing in the body, with a fallback');
  const p = makeWindow(html, { scripts: true });
  assert.equal(p.document.documentElement.className, 'deck');
  p.run(tag[1].replace(/&quot;/g, '"'), 'onerror');
  assert.equal(p.document.documentElement.className, '', 'the fallback leaves the deck\'s classes on a page with no deck');
});

test('withDeck leaves a page it cannot read alone, and never writes the attribute twice', () => {
  assert.equal(withDeck('<p>not a page</p>', card()), '<p>not a page</p>');
  const once = renderCardHTML(card({ view: 'list' }), { handle: 'specimen' });
  assert.equal(once.split('data-view="').length, 2);
});

// ── a deck that does not come up ─────────────────────────────────────────────────────────────────
// html.deck is on the root before the first paint and the stylesheet does not draw the engine's grid
// under it. So ANY way the deck fails to come up must give the page back as the wall: the script
// failing to load, the script throwing (before it has done anything, or half-way through building
// the pile), and the script simply not having arrived yet. Otherwise the visitor has an empty table.
const failedToWall = (p, why) => {
  const root = p.doc.documentElement;
  assert.equal(root.className, '', `${why}: the root still carries a pile's classes ("${root.className}")`);
  assert.equal(root.dataset.view, 'wall', `${why}: the root does not say wall`);
  assert.ok(root.hasAttribute('data-deck-off'), `${why}: the root does not say the deck is off`);
};
test('deck.js throws half-way through building the pile: every tile is back on the wall, which is the engine\'s markup', () => {
  const at = 'const API={};';
  assert.equal(DECK_JS.split(at).length, 2, 'CONTROL: the place the throw is injected at is in deck.js exactly once');
  const p = open(card({ view: 'stack' }), { deckJs: DECK_JS.replace(at, 'throw new Error("injected: half-way");' + at), quiet: true });
  assert.ok(p.doc.querySelector('.deck-card'), 'CONTROL: the throw came after cards were made');
  failedToWall(p, 'threw half-way');
  assert.equal(wallMarkup(p.doc), p.before.wall, 'the wall is not the engine\'s own markup');
  p.cells.forEach((c, i) => same(c.parentNode, p.before.parents[i], `cell ${i} was left on a card nobody draws`));
  same(p.doc.querySelector('footer.st-footer').parentNode, p.before.footerParent, 'the footer was left under the pile');
  assert.equal(p.win.__deckView, undefined, 'a deck that failed still answers __deckView');
  assert.equal(p.win.nav.reloads, 0);
});
test('deck.js throws on a page that opens on the wall: still the wall, and no switcher that does nothing', () => {
  const at = 'bar.append(left,seg);';
  assert.equal(DECK_JS.split(at).length, 2, 'CONTROL: the injection point exists once');
  const p = open(card({ view: 'wall' }), { deckJs: DECK_JS.replace(at, at + 'document.body.appendChild(bar);throw new Error("injected: wall");'), quiet: true });
  failedToWall(p, 'threw on the wall');
  assert.equal(wallMarkup(p.doc), p.before.wall);
});
test('the deck\'s script threw before doing anything, or never ran: when the page is parsed and no deck has reported, it is the wall', () => {
  const html = renderCardHTML(card({ view: 'list' }), { handle: 'specimen' });
  const win = makeWindow(html, { scripts: true });
  assert.equal(win.document.documentElement.className, 'deck list', 'CONTROL: the head script set the pile\'s classes');
  assert.throws(() => win.run('throw new Error("injected: first line")', 'deck.js'));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  failedToWall({ doc: win.document }, 'parsed, no deck');
});
test('a deck that came up is not taken for one that did not', () => {
  const p = open(card({ view: 'stack' }));
  p.doc.dispatchEvent(new p.win.Event('DOMContentLoaded')); p.win.tick(10000);
  holds(p, 'stack', 'after DOMContentLoaded and the wait');
  assert.ok(!p.root.hasAttribute('data-deck-off'));
});
test('the deck\'s script is slow: after a short wait the wall is shown, and the pile still opens when the script arrives', () => {
  const html = renderCardHTML(card({ view: 'stack' }), { handle: 'specimen' });
  const win = makeWindow(html, { scripts: true }); const root = win.document.documentElement;
  win.tick(2000); assert.equal(root.className, 'deck', 'the wait is shorter than two seconds: an ordinary load would flash the wall');
  win.tick(2000); assert.equal(root.className, '', 'four seconds on, the page is still an empty table');
  assert.equal(root.dataset.view, 'stack', 'the wait gave up the view the page opens on');
  assert.ok(!root.hasAttribute('data-deck-off'), 'a slow script was taken for a failed one');
  win.document.scrollHeightOf = (el) => (el === root ? 844 * 6 : 0); win.document.rectOf = () => ({ width: 342, height: 480 });
  win.run(DECK_JS, 'deck.js'); win.tick(3000);
  assert.equal(root.className.split(' ').includes('deck'), true, 'the script arrived and the pile did not open');
  assert.equal(root.dataset.view, 'stack');
});

// ── round 3: the review's findings ───────────────────────────────────────────────────────────────
/** every id that is in the document more than once (`about×2`) — in the page, on the cards, on the bench, in the drawers */
const dupIds = (doc) => { const n = new Map(); for (const e of doc.querySelectorAll('[id]')) n.set(e.id, (n.get(e.id) || 0) + 1); return [...n].filter(([, k]) => k > 1).map(([id, k]) => `${id}×${k}`); };
const turnOver = (p, cell) => { cell.parentNode.dispatchEvent(new p.win.Event('click', { bubbles: true, isTrusted: true })); p.win.tick(1000); };
const putBack = (p) => { p.win.dispatchEvent(new p.win.Event('keydown', { key: 'Escape' })); p.win.tick(1000); };

// 2 — a back that two tiles name is ONE node: it is on the card that is turned over, never copied
const sharedBack = (view) => ['---', 'card-page: specimen', 'title: Specimen', `view: ${view}`, '---', '', '## cards', '',
  '- [ ] %% card: text back=#about %% One.', '- [ ] %% card: text back=#about %% Two.', '- [ ] %% card: text noback %% Three.',
  '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
for (const view of VIEWS) test(`two tiles that name one back, opened on ${view}: no id is in the document twice, in any view`, () => {
  const p = open(sharedBack(view));
  assert.equal(p.doc.querySelectorAll('#drawer-about-title').length >= 1, true, 'CONTROL: the back has a title with an id');
  assert.ok(p.doc.querySelectorAll('[id]').length >= 2, 'CONTROL: the stand-in answers [id]');
  assert.deepEqual(dupIds(p.doc), [], `opened on ${view}`);
  let at = view;
  for (const to of [...VIEWS.filter((v) => v !== view), view, ...VIEWS.filter((v) => v !== view).reverse(), view]) {
    p.press(to); holds(p, to, `${at} → ${to}`);
    assert.deepEqual(dupIds(p.doc), [], `${at} → ${to}: an id is in the document more than once`);
    at = to;
  }
});
test('the back two tiles name is on whichever of their cards is turned over — the same node — and in its drawer on the wall', () => {
  const p = open(sharedBack('stack'));
  const body = p.doc.querySelector('.dc-drawer-body'), title = p.doc.getElementById('drawer-about-title');
  const drawer = p.doc.getElementById('about');
  const [one, two] = p.cells.map((c) => c.closest('.deck-card'));
  assert.ok(one.classList.contains('can-flip') && two.classList.contains('can-flip'), 'both cards can be turned over');
  for (const [mode, n, k] of [['stack', 1, two], ['stack', 0, one], ['list', 1, two], ['list', 0, one], ['list', 1, two]]) {
    if (p.root.dataset.view !== mode) p.press(mode);
    p.win.__deckJump(n); p.win.tick(1000);
    turnOver(p, p.cells[n]);
    assert.ok(k.classList.contains('flipped') && p.root.classList.contains('open'), `${mode}: card ${n} did not turn over`);
    same(body.closest('.deck-card'), k, `${mode}: card ${n} is turned over and the back it names is not on it`);
    same(p.doc.getElementById('drawer-about-title'), title, `${mode}: the title's id answers with another node`);
    assert.deepEqual(dupIds(p.doc), [], `${mode}, card ${n} turned over`);
    putBack(p);
  }
  p.press('wall'); holds(p, 'wall', 'list → wall');
  same(body.parentNode, drawer, 'on the wall the back is in its drawer');
  p.press('stack'); holds(p, 'stack', 'wall → stack');
  p.win.__deckJump(0); p.win.tick(1000); turnOver(p, p.cells[0]);
  same(body.closest('.deck-card'), one, 'after the wall the back is on the card that is turned over');
});
test('the file\'s default back (`back: "#id"`) is one node too, however many tiles take it', () => {
  const md = ['---', 'card-page: specimen', 'title: Specimen', 'view: stack', 'back: "#about"', '---', '', '## cards', '',
    '- [ ] %% card: text %% One.', '- [ ] %% card: text %% Two.', '- [ ] %% card: text back=#about %% Three.', '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
  const p = open(md);
  const body = p.doc.querySelector('.dc-drawer-body');
  assert.deepEqual(dupIds(p.doc), [], 'opened on stack');
  for (const n of [1, 2, 0]) {
    p.win.__deckJump(n); p.win.tick(1000); turnOver(p, p.cells[n]);
    assert.ok(p.root.classList.contains('open'), `card ${n} did not turn over`);
    same(body.closest('.deck-card'), p.cells[n].closest('.deck-card'), `card ${n} is turned over without the default back on it`);
    putBack(p);
  }
  for (const to of ['wall', 'list', 'stack']) { p.press(to); holds(p, to, `→ ${to}`); assert.deepEqual(dupIds(p.doc), [], `→ ${to}`); }
});

// 3 — a page whose items are a card file: the place carries over, pile item N ⇄ the file wall's N-th tile
const FILE_ITEMS = 300, SPACE_TOP = 300, VB_W = 366, VB_ROW = (VB_W - 5 * 12) / 6 + 12, VB_H = Math.ceil(FILE_ITEMS / 6) * VB_ROW;
const fileHost = (view) => ['---', 'card-page: specimen', 'title: Host', `view: ${view}`, '---', '', '## cards', '', '- [ ] %% card: profile w=6 %% A page whose items are a card file.', ''].join('\n');
const fileOf = (view) => ['---', 'title: Host', `view: ${view}`, '---', '', '## cards', '', ...Array.from({ length: FILE_ITEMS }, (_, i) => `- [ ] %% card: text %% File ${i}.`), ''].join('\n');
const openFile = (view) => open(fileHost(view), {
  before: (win) => { win.__cardMd = fileOf(view); },
  layout: (win, doc) => {
    const root = doc.documentElement, inDeck = () => root.classList.contains('deck');
    doc.scrollHeightOf = (el) => (el !== root ? 0 : inDeck() ? win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length) : SPACE_TOP + VB_H + 100);
    doc.rectOf = (el) => (!inDeck() && el.classList.contains('vb-space') ? { top: SPACE_TOP - win.scrollY, left: 12, width: VB_W, height: VB_H } : { width: 342, height: 480 });
  },
});
/** the scroll offset that puts the tiles of row r of the file wall in the middle of the window */
const rowMid = (win, r) => Math.max(0, SPACE_TOP + r * VB_ROW - win.innerHeight / 2 + (VB_ROW - 12) / 2);   // the tile's own middle: a row is a tile and the gap under it
for (const pile of ['stack', 'list']) test(`a card-file page, ${pile} ⇄ wall: the item you were on is where the wall opens, and the wall's item is the card that is up`, () => {
  const p = openFile(pile), { win, doc } = p;
  const first = win.__mdFirst;
  assert.equal(win.__mdCount, FILE_ITEMS, 'CONTROL: the pile is over the file');
  win.__deckJump(first + 200); win.tick(1000);
  assert.equal(win.__deckCur(), first + 200, 'CONTROL: the pile is on item 200');
  p.press('wall');
  assert.ok(doc.querySelector('.vb-space'), 'CONTROL: the file wall is drawn');
  assert.ok(Math.abs(win.scrollY - rowMid(win, Math.floor(200 / 6))) <= 1, `${pile} → wall: the wall is at ${win.scrollY}, item 200's row is in the middle of the window at ${rowMid(win, Math.floor(200 / 6))}`);
  assert.equal((doc.querySelector('.vb-tile.vb-hit') || {}).textContent, 'File 200.', `${pile} → wall: the item you were on is not the one marked`);
  p.press(pile);
  assert.equal(win.__deckCur(), first + 200, `wall → ${pile}: the wall was left where it was entered, and the pile is not on that item`);
  // read on down the wall: the pile opens on the row in the middle of the window
  p.press('wall'); win.scrollTo({ top: rowMid(win, 40) }); win.tick(100);
  p.press(pile);
  assert.equal(Math.floor((win.__deckCur() - first) / 6), 40, `wall → ${pile}: the pile opened on card ${win.__deckCur()}, the middle of the window was row 40 (items 240–245)`);
  // the top of the wall is the first card, as on any page
  p.press('wall'); win.scrollTo({ top: 0 }); win.tick(100);
  p.press(pile);
  assert.equal(win.__deckCur(), 0, 'the top of the file wall is the first card');
  // …and the first card is the top of the wall
  p.press('wall');
  assert.equal(win.scrollY, 0, 'the first card is the top of the wall');
  assert.ok(!doc.querySelector('.vb-tile.vb-hit'), 'an item is marked although the card that was up is not an item');
});

// 4 — the draw page deals its tiles in a shuffled order; the wall is still the engine's own markup
test('the draw page: a shuffled pile, and the wall after it is the engine\'s grid, runs and bleed again', () => {
  const p = open(card({ view: 'stack' }), { page: (h) => h.replace('<html', '<html data-reef-draw'), before: (win) => win.run('{ let k = 0; const seq = [0.9, 0.05, 0.5, 0.3, 0.7, 0.1]; Math.random = () => seq[k++ % seq.length]; }', 'a fixed shuffle') });
  const { doc, cells, before } = p;
  assert.ok(doc.documentElement.hasAttribute('data-reef-draw'), 'CONTROL: this is the draw page');
  const tileOf = (k) => cells.indexOf(k.querySelector('.deck-front').firstElementChild);
  const dealt = () => doc.querySelectorAll('.deck-card').filter((k) => tileOf(k) >= 0).sort((a, b) => a.dataset.i - b.dataset.i).map(tileOf);
  const order = dealt();
  assert.equal(order.length, cells.length, 'CONTROL: every tile was dealt');
  assert.notDeepEqual(order, cells.map((_, i) => i), 'CONTROL: the pile is shuffled');
  for (const c of cells) assert.ok(c.isConnected, 'a tile is outside the document');
  p.press('wall');
  assert.equal(wallMarkup(doc), before.wall, 'stack → wall on the draw page: the wall is not the engine\'s own markup');
  cells.forEach((c, i) => same(c.parentNode, before.parents[i], `cell ${i} is not back where the engine put it`));
  p.press('list');
  assert.deepEqual(dealt(), order, 'the pile kept the order it was dealt in');
  p.press('wall');
  assert.equal(wallMarkup(doc), before.wall, 'list → wall on the draw page');
  assert.equal(doc.left.filter((n) => cells.some((c) => n === c || n.contains(c))).length, 0, 'a tile left the document at some point');
});
test('the draw page that opens on the wall: the engine\'s markup stays as it was while the pile is dealt from it', () => {
  const p = open(card({ view: 'wall' }), { page: (h) => h.replace('<html', '<html data-reef-draw') });
  assert.equal(wallMarkup(p.doc), p.before.wall);
  p.press('stack'); p.press('wall');
  assert.equal(wallMarkup(p.doc), p.before.wall, 'wall → stack → wall');
});

// 1 — the cases the review named for a deck that does not come up
const flush = () => new Promise((r) => setImmediate(r));
const filePage = (view) => renderCardHTML(fileHost(view), { handle: 'specimen' }).replace('<html', '<html data-card-src="/items.card.md"');
test('a card file that cannot be fetched (data-card-src): the page is the wall, and says the deck is off', async () => {
  const win = makeWindow(filePage('stack'), { scripts: true }); const root = win.document.documentElement;
  win.console = { ...console, error() {} };
  assert.equal(root.className, 'deck', 'CONTROL: the head script set the pile\'s classes');
  win.run(DECK_JS, 'deck.js');
  assert.equal(win.__deckBoot, 'pending', 'CONTROL: the deck is waiting for its card file');
  await flush(); await flush();
  failedToWall({ doc: win.document }, 'the card file was refused');
  assert.equal(win.__deckBoot, 'failed');
});
test('a card file that is slow or never answers: after the wait the wall is shown, not an empty table, and the pile opens if it arrives', async () => {
  const win = makeWindow(filePage('stack'), { scripts: true }); const root = win.document.documentElement;
  let arrive; win.fetch = () => new Promise((ok) => { arrive = ok; });
  win.run(DECK_JS, 'deck.js'); await flush();
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  assert.ok(!root.hasAttribute('data-deck-off'), 'a deck waiting for its card file was taken for a failed one');
  win.tick(2000); assert.equal(root.className, 'deck', 'the wait is shorter than two seconds');
  win.tick(2000); assert.equal(root.className, '', 'four seconds on, the card file has not come and the page is still an empty table');
  assert.equal(root.dataset.view, 'stack', 'the wait gave up the view the page opens on');
  assert.ok(!root.hasAttribute('data-deck-off'), 'a slow card file was taken for a failed one');
  win.document.scrollHeightOf = (el) => (el === root ? 844 * 12 : 0); win.document.rectOf = () => ({ width: 342, height: 480 });
  arrive({ ok: true, text: () => Promise.resolve(fileOf('stack')) }); await flush(); await flush(); win.tick(3000);
  assert.equal(win.__deckBoot, 'ready', 'the card file arrived and the deck did not come up');
  assert.ok(root.classList.contains('deck'), 'the card file arrived and the pile did not open');
});
// A policy that refuses inline scripts refuses the head script, the hand-over script and the onerror handler alike. The
// pile's classes are the head script's, so such a page starts as the wall and stays it unless deck.js itself comes up.
test('inline scripts and inline handlers refused (a strict CSP): no deck → the wall; deck.js throws → the wall; deck.js runs → the pile', () => {
  const html = renderCardHTML(card({ view: 'stack' }), { handle: 'specimen' });
  const fresh = () => { const win = makeWindow(html); const doc = win.document; doc.scrollHeightOf = (el) => (el === doc.documentElement ? 844 * 8 : 0); doc.rectOf = () => ({ width: 342, height: 480 }); win.console = { ...console, error() {} }; return win; };
  let win = fresh();   // deck.js refused as well, or failed to load: nothing ran at all
  assert.equal(win.document.documentElement.className, '', 'no script ran and the root carries a pile\'s classes');
  win = fresh();       // deck.js runs and throws half-way: nobody else is there to put the page back
  const wall = wallMarkup(win.document), at = 'const API={};';
  win.run(DECK_JS.replace(at, 'throw new Error("injected: half-way");' + at), 'deck.js'); win.tick(3000);
  assert.ok(win.document.querySelector('.deck-card'), 'CONTROL: the throw came after cards were made');
  failedToWall({ doc: win.document }, 'CSP, threw half-way');
  assert.equal(wallMarkup(win.document), wall, 'CSP, threw half-way: the wall is not the engine\'s own markup');
  win = fresh();       // deck.js alone: it reads the opening view from the markup and comes up
  win.run(DECK_JS, 'deck.js'); win.tick(3000);
  assert.equal(win.__deckBoot, 'ready');
  assert.equal(win.document.documentElement.className.split(' ').includes('deck'), true, 'deck.js alone did not open the pile the markup names');
});

// 5 — the words of a card-file page come from the table (w3/deck-i18n.mjs), in the page's language, and are text at every sink
const smallFile = ['---', 'title: Host', '---', '', '## cards', '', '- [ ] %% card: text %% File 0.', '- [ ] %% card: text %% File 1.', '- [ ] %% card: text %% File 2.', ''].join('\n');
const noLangHost = ['---', 'card-page: specimen', 'title: Host', 'view: stack', '---', '', '## cards', '', '- [ ] %% card: profile w=6 %% A page whose items are a card file.', ''].join('\n');
/** the capacity demo (reef.cards home over a card file), or the plain home page, in the words of `lang`; `words` replaces some of them */
const openOurs = ({ lang, words = null, file = true, ...more } = {}) => open(noLangHost, {
  ctx: lang ? { chromeLang: lang } : {},
  page: (h) => h.replace('<html', `<html data-reef-home${file ? ' data-card-src="/items.card.md"' : ''}`),
  before: (win) => { if (file) win.__cardMd = smallFile; if (words) win.__deckStrings = { ...win.__deckStrings, ...words };
    if ('tryUrl' in more) { if (more.tryUrl === undefined) win.run('delete window.__deckTry'); else win.__deckTry = more.tryUrl; } },   // what the page hands over as the sandbox's address (absent: nothing — taken away INSIDE the page: a delete from out here leaves the page's own global holding it)
});
const textOf = (doc, sel) => doc.querySelectorAll(sel).map((e) => e.textContent.trim());
const fill = (s, o) => s.replace(/\{(\w)\}/g, (m, k) => o[k] ?? m);
for (const lang of ['en', 'zh-TW', 'de']) test(`a card-file page in ${lang}: the item count, the last card and its button say the table's words`, () => {
  const S = deckStrings(lang);
  if (lang !== 'en') for (const k of ['mdOf', 'fileEndTitle', 'fileEndText', 'makeYourOwn', 'fileNote']) assert.notEqual(S[k], DECK_STRINGS.en[k], `CONTROL: ${lang} has its own ${k}`);
  const { doc, win } = openOurs({ lang });
  assert.equal(win.__mdCount, 3, 'CONTROL: the pile is over the file');
  assert.deepEqual(textOf(doc, '.md-plain p').sort(), [1, 2, 3].map((i) => fill(S.mdOf, { i, n: 3 })).sort(), 'the plain back of an item');   // (sorted: the pile lays its cards out top card last)
  assert.deepEqual(textOf(doc, '.deck-ours-cta h2'), [S.fileEndTitle], 'the last card\'s title');
  assert.deepEqual(textOf(doc, '.deck-ours-cta p'), [fill(S.fileEndText, { n: 3 })], 'the last card\'s line');
  assert.deepEqual(textOf(doc, '.deck-go .note'), [S.fileNote], 'the note over the button');
  const btn = doc.querySelectorAll('.deck-go a.btn');
  assert.equal(btn.length, 1, 'one button on the last card\'s back');
  assert.ok(btn[0].textContent.trim().startsWith(S.makeYourOwn), `the button reads ${JSON.stringify(btn[0].textContent)}`);
  assert.equal(btn[0].getAttribute('href'), DECK_TRY_URL, 'the button goes to the sandbox deck-page.mjs names');
});
test('the home page\'s "try it" link goes to the sandbox deck-page.mjs names, and deck.js writes no address of its own', () => {
  const { doc } = openOurs({ file: false });
  const a = doc.querySelectorAll('a.try');
  assert.equal(a.length, 1, 'CONTROL: the home page\'s last card has its link');
  assert.equal(a[0].getAttribute('href'), DECK_TRY_URL);
  assert.ok(!/https?:\/\/card\.feelreef\.com/.test(DECK_JS.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'deck.js still writes a card.feelreef.com address itself');
});
test('a translation with markup in it is text at every sink: no element is made from it', () => {
  const evil = (k) => `<img src=x onerror=alert(1)><b>${k}</b> {i} {n} "q" & more`;
  const KEYS = ['mdOf', 'fileEndTitle', 'fileEndText', 'makeYourOwn', 'fileNote'];
  const { doc } = openOurs({ words: Object.fromEntries(KEYS.map((k) => [k, evil(k)])) });
  const said = (k) => fill(evil(k), { i: 1, n: 3 });
  assert.ok(textOf(doc, '.md-plain p').includes(said('mdOf')), 'the plain back');
  assert.deepEqual(textOf(doc, '.deck-ours-cta h2'), [evil('fileEndTitle')], 'the last card\'s title');
  assert.deepEqual(textOf(doc, '.deck-ours-cta p'), [fill(evil('fileEndText'), { n: 3 })], 'the last card\'s line');
  assert.deepEqual(textOf(doc, '.deck-go .note'), [evil('fileNote')], 'the note');
  assert.ok(doc.querySelector('.deck-go a.btn').textContent.trim().startsWith(evil('makeYourOwn')), 'the button');
  for (const sel of ['.md-plain p', '.deck-ours-cta', '.deck-go']) for (const host of doc.querySelectorAll(sel)) {
    assert.equal(host.querySelectorAll('img').length + host.querySelectorAll('b').length, 0, `${sel}: an element was made from a translation`);
  }
});

// ── a hand-over address becomes a link only when it is an absolute http(s) URL (tile#297 round 5) ──
// window.__deckTry is handed to deck.js by the page (deck-page.mjs DECK_TRY_URL). A page that hands
// over something else — or nothing — gets no button and no link; the words around it stay.
// The table also holds the repo's rule for a Card link destination (site-core hrefAllowed, behind
// card-render's cardHref): deck.js is a classic script and cannot import it, so its rule is a mirror —
// stricter (absolute http(s) only, nothing before the scheme) and never wider.
const QUOTES = 'https://example.test/" onclick="alert(1)';
const ADDRESSES = [
  // [handed over, a Card link may point there (hrefAllowed), the deck makes a link of it]
  [DECK_TRY_URL, true, true],
  ['http://example.test/a?b=1&c=2', true, true],
  ['HTTPS://Example.test/', true, true],
  [QUOTES, true, true],                                   // a link, and only a link: see the test below
  ['javascript:alert(1)', false, false],
  ['JaVaScRiPt:alert(1)', false, false],
  ['data:text/html,<script>alert(1)</script>', false, false],
  ['data:image/png;base64,iVBORw0KGgo=', false, false],
  ['vbscript:msgbox(1)', false, false],
  ['\u0001javascript:alert(1)', false, false],
  ['\njavascript:alert(1)', false, false],
  [' javascript:alert(1)', false, false],
  ['java\tscript:alert(1)', false, false],
  ['blob:https://example.test/1', false, false],
  ['file:///etc/hosts', false, false],
  // what a Card link may be and a hand-over address may not: not absolute http(s), or something before the scheme
  [' https://example.test/', true, false],
  ['\thttps://example.test/', true, false],
  ['\u0001https://example.test/', true, false],
  ['//example.test/x', true, false],
  ['/try/edit', true, false],
  ['try/edit', true, false],
  ['#top', true, false],
  ['http:example.test', true, false],
  ['https://', false, false],
  ['mailto:someone@example.test', true, false],
  ['ftp://example.test/', true, false],
  ['', true, false],
  [undefined, true, false],
];
const SINKS = [['the card-file page\'s button', true, '.deck-go a.btn', '.deck-go'], ['the home page\'s "try it" link', false, 'a.try', '.deck-bcard']];
const show = (v) => (v === undefined ? '(nothing handed over)' : JSON.stringify(v));
const handed = (file, v) => openOurs({ file, tryUrl: v });
/** the last card of the home page (the one whose front is the call to action) */
const lastCard = (doc) => doc.querySelectorAll('.deck-card').filter((k) => k.querySelector('.deck-ours-cta'));
test('CONTROL: the table is right about the repo\'s rule for a Card link, and the deck\'s rule is never wider', () => {
  for (const [v, cardMay, deckMay] of ADDRESSES) {
    assert.equal(hrefAllowed(v === undefined ? '' : v), cardMay, `hrefAllowed(${show(v)})`);
    assert.ok(!deckMay || cardMay, `${show(v)}: the deck would link what a Card link may not be`);
  }
});
for (const [what, file, linkSel, hostSel] of SINKS) {
  test(`${what}: only an absolute http(s) address handed over is made a link`, () => {
    for (const [v, , deckMay] of ADDRESSES) {
      const { doc, win } = handed(file, v);
      same(win.run('window.__deckTry'), v, `CONTROL: the page was handed ${show(v)}`);   // asked inside the page, where deck.js reads it
      const last = lastCard(doc);
      assert.equal(last.length, 1, `${show(v)}: CONTROL: the last card is there`);
      assert.equal(last[0].querySelectorAll(hostSel).length, 1, `${show(v)}: the last card's back (${hostSel})`);
      const hrefs = last[0].querySelectorAll('a').map((a) => a.getAttribute('href'));
      if (!deckMay) {
        assert.deepEqual(hrefs, [], `${show(v)}: the last card has a link`);
        assert.equal(last[0].querySelectorAll('button').length, 0, `${show(v)}: the last card has a button`);
        assert.equal(doc.querySelectorAll(linkSel).length, 0, `${show(v)}: ${linkSel} was drawn`);
      } else {
        assert.equal(hrefs.length, 1, `${show(v)}: one link`);
        const u = new URL(hrefs[0]);
        assert.ok(u.protocol === 'https:' || u.protocol === 'http:', `${show(v)}: the link's scheme is ${u.protocol}`);
        assert.equal(u.href, new URL(v).href, `${show(v)}: the link goes somewhere else (${hrefs[0]})`);
        assert.equal(doc.querySelectorAll(linkSel).length, 1, `${show(v)}: ${linkSel}`);
      }
      // the words around the link are drawn either way
      assert.equal(textOf(doc, '.deck-ours-cta h2').length, 1, `${show(v)}: the last card's title`);
      if (file) assert.equal(textOf(doc, '.deck-go .note').length, 1, `${show(v)}: the note over the button`);
      else assert.equal(last[0].querySelectorAll('.deck-bcard .nm').length, 1, `${show(v)}: the business card`);
    }
  });
  test(`${what}: an address with a quote in it stays inside the href — no attribute is made from it`, () => {
    const { doc } = handed(file, QUOTES);
    const a = doc.querySelectorAll(linkSel);
    assert.equal(a.length, 1, 'CONTROL: the link is drawn');
    for (const name of ['onclick', 'onerror', 'onload', 'onmouseover']) assert.equal(a[0].getAttribute(name), null, `the link has ${name}`);
    assert.equal(doc.querySelectorAll('[onclick]').length, 0, 'an element in the page has onclick');
    assert.equal(new URL(a[0].getAttribute('href')).href, new URL(QUOTES).href, 'the href is the whole address handed over');
    assert.equal(a[0].getAttribute('target'), '_blank', 'the attributes written after the href are still its own');
  });
  test(`${what}: the address deck-page.mjs names is the link`, () => {
    const { doc } = handed(file, DECK_TRY_URL);
    assert.deepEqual(doc.querySelectorAll(linkSel).map((a) => a.getAttribute('href')), [DECK_TRY_URL]);
  });
}

// ── a shared back stays on the card that is being put back until that turn is over (tile#297 round 5) ──
// close() starts deck-put (560 ms) and the card shows its back for the first half of it. The back two
// tiles name is ONE node: lent to the next card at once, the card still turning showed an empty back.
const PUT = 560, FALLBACK = 700;   // deck.css deck-put, and a wait longer than deck.js's own fallback
const defaultBack = (view) => ['---', 'card-page: specimen', 'title: Specimen', `view: ${view}`, 'back: "#about"', '---', '', '## cards', '',
  '- [ ] %% card: text %% One.', '- [ ] %% card: text %% Two.', '- [ ] %% card: text noback %% Three.', '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
const tap = (p, cell) => cell.parentNode.dispatchEvent(new p.win.Event('click', { bubbles: true, isTrusted: true }));
const escKey = (p) => p.win.dispatchEvent(new p.win.Event('keydown', { key: 'Escape' }));
const flagged = (p) => p.doc.querySelectorAll('.deck-card.is-open');
/** open A, put it back, and ask for B while A is still turning; returns the page with the clock at the moment of the ask */
function midTurn(view, kind, more = {}) {
  const p = open((kind === 'default' ? defaultBack : sharedBack)('stack'), more);
  if (view === 'list') p.press('list');
  const body = p.doc.querySelector('.dc-drawer-body');
  const [a, b] = p.cells.map((c) => c.closest('.deck-card'));
  p.win.__deckJump(0); p.win.tick(1000);
  tap(p, p.cells[0]); p.win.tick(1000);
  assert.ok(a.classList.contains('flipped') && p.root.classList.contains('open'), 'CONTROL: A is turned over');
  same(body.closest('.deck-card'), a, 'CONTROL: A holds the back');
  escKey(p);
  assert.ok(!p.root.classList.contains('open') && flagged(p).length === 0, 'CONTROL: A is being put back');
  if (!more.reducedMotion) assert.ok(a.classList.contains('flipping-close'), 'CONTROL: A is in its put-back turn');
  p.win.__deckJump(1); assert.ok(b.classList.contains('is-top'), 'CONTROL: B is the card that is up');   // a tap on the NEXT card walks to it (in list too); a tap on the card that is up turns it over
  if (!more.reducedMotion && view === 'list') assert.ok(a.classList.contains('flipping-close'), 'CONTROL: in list A is still turning after the walk');
  tap(p, p.cells[1]);
  return { p, body, a, b };
}
const bIsOpen = ({ p, body, a, b }, why) => {
  same(body.closest('.deck-card'), b, `${why}: B does not hold the back`);
  assert.ok(b.classList.contains('is-open') && b.classList.contains('flipped') && p.root.classList.contains('open'), `${why}: B is not turned over`);
  assert.ok(flagged(p).length === 1 && flagged(p)[0] === b, `${why}: ${flagged(p).length} cards are flagged open`);
  assert.ok(!a.classList.contains('is-open'), `${why}: A is still flagged open`);
  assert.deepEqual(dupIds(p.doc), [], why);
};
for (const view of ['list', 'stack']) for (const kind of ['named', 'default']) {
  test(`${view}, the ${kind} back: B asked for while A is being put back gets the back when A's turn ends, not before`, () => {
    const s = midTurn(view, kind), { p, body, a, b } = s;
    for (let t = 0; t < PUT; t += 40) {
      same(body.closest('.deck-card'), a, `${t} ms into A's turn: the back has left A`);
      assert.ok(!b.classList.contains('is-open') && !b.classList.contains('flipped') && flagged(p).length === 0, `${t} ms into A's turn: B is already turned over`);
      p.win.tick(40);
    }
    a.dispatchEvent(new p.win.Event('animationend', { bubbles: true, animationName: 'deck-face-off' }));   // a face's own animation ends with the card's: not the turn
    a.dispatchEvent(new p.win.Event('animationend', { bubbles: true, animationName: 'deck-put' }));
    bIsOpen(s, 'A\'s turn ended');
    p.win.tick(3000); bIsOpen(s, 'three seconds later');
    escKey(p); p.win.tick(3000);
    assert.equal(flagged(p).length, 0, 'B was put back and a card is still flagged open');
  });
  test(`${view}, the ${kind} back: an animationend that never comes does not leave B waiting`, () => {
    const s = midTurn(view, kind), { p, body, a } = s;
    p.win.tick(PUT / 2 - 20);
    same(body.closest('.deck-card'), a, 'just before the half turn: the back has left A');
    p.win.tick(FALLBACK);
    bIsOpen(s, 'after the fallback');
  });
  test(`${view}, the ${kind} back: with reduced motion there is no turn to wait for — B opens at once`, () => {
    const s = midTurn(view, kind, { reducedMotion: true });
    bIsOpen(s, 'at once');
    // no animation means no animationend: a card that waited for one to turn its face back kept showing its back — now without the words
    assert.ok(!s.a.classList.contains('flipped'), 'A was put back and still shows its back face (flipped), which B now holds');
  });
}
test('a card asked for during a put-back turn is not turned over when it is put back first, or when the view leaves the pile', () => {
  const s = midTurn('list', 'named'), { p, body, a, b } = s;
  escKey(p); p.win.tick(3000);
  assert.ok(!b.classList.contains('is-open') && flagged(p).length === 0 && !p.root.classList.contains('open'), 'Escape during the wait, and B turned over anyway');
  same(body.closest('.deck-card'), a, 'the back moved for a card that never turned over');
  const w = midTurn('list', 'named');
  w.p.press('wall'); holds(w.p, 'wall', 'list (B waiting) → wall');
  assert.ok(flagged(w.p).length === 0 && !w.p.root.classList.contains('open'), 'on the wall a card was turned over');
});
test('A asked for again during its own put-back turn turns over at once: the back never left it', () => {
  const p = open(sharedBack('stack')); p.press('list');
  const body = p.doc.querySelector('.dc-drawer-body'), a = p.cells[0].closest('.deck-card');
  p.win.__deckJump(0); p.win.tick(1000); tap(p, p.cells[0]); p.win.tick(1000);
  escKey(p); p.win.tick(100);
  tap(p, p.cells[0]);
  assert.ok(a.classList.contains('is-open') && a.classList.contains('flipped'), 'A did not turn over again');
  same(body.closest('.deck-card'), a, 'A is turned over without its back');
  p.win.tick(3000);
  assert.ok(flagged(p).length === 1 && flagged(p)[0] === a, 'three seconds later');
});
test('with reduced motion a card that is put back shows its front again at once, in stack and list', () => {
  for (const view of ['stack', 'list']) {
    const p = open(sharedBack('stack'), { reducedMotion: true }); if (view === 'list') p.press('list');
    const a = p.cells[0].closest('.deck-card');
    p.win.__deckJump(0); p.win.tick(1000); tap(p, p.cells[0]); p.win.tick(1000);
    assert.ok(a.classList.contains('flipped'), `${view}: CONTROL: A is turned over`);
    escKey(p);
    assert.ok(!a.classList.contains('flipped') && !a.classList.contains('is-open'), `${view}: A was put back and is still flipped`);
    tap(p, p.cells[0]); p.win.tick(1000);
    assert.ok(a.classList.contains('flipped') && a.classList.contains('is-open'), `${view}: A does not turn over a second time`);
  }
});

// ── a card that is waiting to be turned over, and the visitor moves on (tile#297 round 6) ─────────────────────────
// A is being put back, B was asked for and waits for A's turn to end. If the visitor leaves B before that — by ANY way the
// card that is up can change — the request is over: nothing turns over when A's turn ends, on the card they left or on the
// one they went to, and coming back to B does not revive it. The reviewer's sequence is the first row (a jump to C).
const backsOnAll = (n) => ['---', 'card-page: specimen', 'title: Specimen', 'view: stack', '---', '', '## cards', '',
  ...Array.from({ length: n }, (_, i) => `- [ ] %% card: text back=#about %% Card ${i}.`), '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
/** A (card 0) is in its put-back turn and B (card 1) has been asked for; `n` cards, every one with the same back */
function waitingOnB(view, n = 3) {
  const p = open(backsOnAll(n));
  if (view === 'list') p.press('list');
  const body = p.doc.querySelector('.dc-drawer-body');
  const cards = p.cells.map((c) => c.closest('.deck-card'));
  const [a, b] = cards;
  p.win.__deckJump(0); p.win.tick(1000);
  tap(p, p.cells[0]); p.win.tick(1000);
  assert.ok(a.classList.contains('flipped') && p.root.classList.contains('open'), 'CONTROL: A is turned over');
  escKey(p);
  assert.ok(a.classList.contains('flipping-close') && flagged(p).length === 0, 'CONTROL: A is in its put-back turn');
  p.win.__deckJump(1); tap(p, p.cells[1]);
  assert.equal(p.win.__deckCur(), 1, 'CONTROL: B is the card that is up');
  assert.ok(flagged(p).length === 0 && !p.root.classList.contains('open'), 'CONTROL: B waits for A\'s turn');
  same(body.closest('.deck-card'), a, 'CONTROL: the back is still on A');
  return { p, body, a, b, cards, ph: p.win.innerHeight };
}
const ENDINGS = {
  animationend: ({ p, a }) => a.dispatchEvent(new p.win.Event('animationend', { bubbles: true, animationName: 'deck-put' })),
  'the 600 ms fallback': ({ p }) => p.win.tick(FALLBACK),
};
const noneOpen = ({ p, body, a, cards }, why) => {
  // A itself is left out of `flipped`: when its animationend never comes it keeps that class (as it did before this round) — what is asked here is that no OTHER card turns over
  const over = cards.map((c, i) => (c.classList.contains('is-open') || (c !== a && c.classList.contains('flipped')) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(over, [], `${why}: card ${over} is turned over (card ${p.win.__deckCur()} is up)`);
  assert.ok(!p.root.classList.contains('open'), `${why}: the page says a card is held`);
  same(body.closest('.deck-card'), a, `${why}: the back moved to a card that was not turned over`);
};
const ev = (p, type, init) => new p.win.Event(type, { bubbles: true, cancelable: true, isTrusted: true, ...init });
// every way the card that is up changes (deck.js: every assignment to `cur`), each as the visitor does it
const WAYS_OFF = [
  { name: 'a jump (__deckJump) to C', views: ['list', 'stack'], go: ({ p }) => p.win.__deckJump(2) },
  { name: 'the dice\'s riffle (__deckRiffle) to C', views: ['list', 'stack'], go: ({ p }) => { p.win.__deckRiffle(2); p.win.tick(300); }   /* the riffle starts two cards back and walks: by now it has landed */ },
  { name: 'the arrow key (a walk)', views: ['list', 'stack'], go: ({ p }) => { p.win.dispatchEvent(ev(p, 'keydown', { key: 'ArrowRight' })); p.win.tick(40); } },
  { name: 'a tap on the next card (a walk)', views: ['stack'], go: ({ p }) => { p.cells[2].parentNode.dispatchEvent(ev(p, 'click')); p.win.tick(40); } },
  { name: 'a sideways wheel swipe', views: ['list', 'stack'], go: ({ p, ph }) => { p.root.dispatchEvent(ev(p, 'wheel', { deltaX: ph, deltaY: 0, deltaMode: 0, timeStamp: 5000 })); p.win.tick(40); } },
  { name: 'a drag of the top card', views: ['stack'], go: ({ p }) => { const t = p.cells[1].parentNode;
    t.dispatchEvent(ev(p, 'pointerdown', { pointerId: 7, clientX: 300, clientY: 300, pointerType: 'mouse' }));
    t.dispatchEvent(ev(p, 'pointermove', { pointerId: 7, clientX: 80, clientY: 300, pointerType: 'mouse' }));
    t.dispatchEvent(ev(p, 'pointerup', { pointerId: 7, clientX: 80, clientY: 300, pointerType: 'mouse' })); p.win.tick(40); },
    retap: false },   // after a drag the deck swallows the next click on the dragged card (meant for the drag's own click, which the stand-in does not send): the closing control below would be measuring that
  { name: 'a finger dragging the row', views: ['list'], go: ({ p }) => { const t = p.cells[1].parentNode;
    t.dispatchEvent(ev(p, 'pointerdown', { pointerId: 7, clientX: 320, clientY: 300, pointerType: 'touch' }));
    t.dispatchEvent(ev(p, 'pointermove', { pointerId: 7, clientX: 10, clientY: 300, pointerType: 'touch' }));
    t.dispatchEvent(ev(p, 'pointerup', { pointerId: 7, clientX: 10, clientY: 300, pointerType: 'touch' })); p.win.tick(40); } },
  { name: 'the scrollbar, one card on', views: ['list', 'stack'], go: ({ p, ph }) => { p.win.scrollTo({ top: 2 * ph }); p.win.tick(40); } },
  { name: 'the scrollbar, far (a jump, not a walk)', views: ['stack'], n: 20, go: ({ p, ph }) => { p.win.scrollTo({ top: 17 * ph }); p.win.tick(40); } },
  { name: 'a card picked from the fan', views: ['stack'], go: ({ p }) => { p.doc.rectOf = () => ({ top: 200, left: 24, width: 342, height: 480 });   /* the fan measures the pile to tell which card is under the finger */
    p.win.__deckFan(); assert.ok(p.root.classList.contains('fan'), 'CONTROL: the fan is out');
    p.doc.dispatchEvent(ev(p, 'pointerup', { pointerId: 7, clientX: 1e6, clientY: 300, pointerType: 'touch' })); } },   // far right of the pivot: the last card
];
for (const way of WAYS_OFF) for (const view of way.views) for (const ending of Object.keys(ENDINGS)) {
  test(`${view}: B waits for A's turn, the visitor leaves by ${way.name}, the turn ends (${ending}) — nothing turns over`, () => {
    const s = waitingOnB(view, way.n), { p } = s;
    way.go(s);
    assert.notEqual(p.win.__deckCur(), 1, `CONTROL: ${way.name} did not move off B`);
    same(s.body.closest('.deck-card'), s.a, 'CONTROL: A\'s turn is not over yet');
    ENDINGS[ending](s);
    noneOpen(s, 'A\'s turn ended'); p.win.tick(3000); noneOpen(s, 'three seconds later');
  });
  test(`${view}: B waits, the visitor leaves by ${way.name} and comes back before the turn ends (${ending}) — the request is not revived`, () => {
    const s = waitingOnB(view, way.n), { p, b } = s;
    way.go(s);
    assert.notEqual(p.win.__deckCur(), 1, `CONTROL: ${way.name} did not move off B`);
    p.win.__deckJump(1);
    assert.ok(p.win.__deckCur() === 1 && b.classList.contains('is-top'), 'CONTROL: B is up again');
    same(s.body.closest('.deck-card'), s.a, 'CONTROL: A\'s turn is not over yet');
    ENDINGS[ending](s);
    noneOpen(s, 'A\'s turn ended'); p.win.tick(3000); noneOpen(s, 'three seconds later');
    if (way.retap === false) return;
    tap(p, p.cells[1]); p.win.tick(1000);
    assert.ok(b.classList.contains('is-open') && flagged(p).length === 1, 'CONTROL: asked for again, B turns over');
    same(s.body.closest('.deck-card'), b, 'CONTROL: asked for again, B holds the back');
  });
}
// the ways that are not a change of card: they put the waiting card back (close), which takes the request with it
for (const ending of Object.keys(ENDINGS)) for (const [view, other] of [['list', 'stack'], ['stack', 'list']]) {
  test(`${view}: B waits for A's turn and the view is switched to ${other} and back, or to the wall and back (${ending}) — nothing turns over`, () => {
    for (const via of [other, 'wall']) {
      const s = waitingOnB(view), { p } = s;
      p.button(via).click(); p.button(view).click();   // no clock between them: A's turn is still running
      assert.equal(p.win.__deckCur(), 1, 'CONTROL: B is up again');
      ENDINGS[ending](s); p.win.tick(3000);
      const over = s.cards.filter((c) => c.classList.contains('is-open') || (c !== s.a && c.classList.contains('flipped')));
      assert.ok(over.length === 0 && !p.root.classList.contains('open'), `${view} → ${via} → ${view}: a card turned over`);
    }
  });
}
