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
import { withDeck, openingView, DECK_JS_PATH } from './deck-page.mjs';
import { makeWindow } from './mini-dom.mjs';

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
function open(md, { storage, moveBefore, ctx = {}, bare = false, deckJs = DECK_JS, quiet = false } = {}) {
  let html = renderCardHTML(md, { handle: 'specimen', ...ctx });
  if (bare) html = html.replace(/<html[^>]*>/, '<html lang="en">').replace(/<script>\(function\(d\)[\s\S]*?<\/script>/, '');
  const win = makeWindow(html, { scripts: true, storage, moveBefore });
  const doc = win.document, root = doc.documentElement;
  const cells = engineCells(doc);
  const ft = doc.querySelector('footer.st-footer');
  const before = { cells, wall: wallMarkup(doc), parents: cells.map((c) => c.parentNode), footerParent: ft && ft.parentNode, rootBeforeDeck: { view: root.dataset.view, cls: root.className } };
  if (quiet) win.console = { ...console, error() {} };   // a deck that fails says so on the console; the test that makes it fail does not need to read it
  const inDeck = () => root.classList.contains('deck');
  doc.scrollHeightOf = (el) => (el !== root ? 0 : inDeck() ? win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length) : 400 + cells.length * 300);
  doc.rectOf = (el) => (inDeck() || !cells.includes(el) ? { width: 342, height: 480 } : { top: 200 + cells.indexOf(el) * 300 - win.scrollY, left: 24, width: 342, height: 280 });
  win.run(deckJs, 'deck.js'); win.tick(3000);
  const button = (v) => doc.querySelector(`.deck-seg button[data-m="${INNER[v]}"]`);
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
