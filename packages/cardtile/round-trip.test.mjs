// The guarantee an editor stands on.
//
// SPEC-card-draft.md, "Editing": 🔴 *Whatever the editor is, it must go through card-core's model,
// which round-trips exactly. A WYSIWYG that builds its own model loses whatever that model does not
// capture, on save.*
//
// That sentence is a promise about somebody's only copy of their card. It was written down and never
// asserted against the real cards — the existing round-trip tests all use small hand-made fixtures,
// which is precisely the shape of card that has nothing unusual in it to lose. These run the three
// live cards, including one at 1.1MB with its base64 assets and drawers.
//
//   node --test packages/cardtile/round-trip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard, serializeCard, reorder, setSpan, normalizeCell, setToken, removeToken, quoteParam } from './card-core.js';
import {
  boardLanes, boardSlots, identityOrder, applyBoardOrder, drawerLinks, cardTitle, tileFace, boardMd,
} from './w2/board-bridge.mjs';

const CARDS = join(dirname(fileURLToPath(import.meta.url)), 'cards/specimens');
const LIVE = ['specimen-assets', 'specimen-rich', 'specimen-plain'];
const read = (h) => fs.readFileSync(join(CARDS, `${h}.card.md`), 'utf8');

// 🩸 These three were real creators' cards until 2026-08-12, and the point of them was SIZE and
// MESS: the heaviest is 1.1 MB of base64 assets and drawers, which is the shape a
// hand-written round-trip fixture never reaches by accident. The property being tested is "the
// parser is byte-exact on a big awkward document", and that is a requirement for a DOCUMENT, not
// for a customer. specimen-assets carries 33 cells and two embedded images for exactly this.
//
// The audit that genuinely is about those three still runs, in lab/round-trip-live.test.mjs,
// for as long as we are the ones holding copies of their pages.
for (const handle of LIVE) {
  test(`round-trip is byte-exact on the live ${handle} card`, () => {
    const src = read(handle);
    const out = serializeCard(parseCard(src));
    if (out !== src) {
      let i = 0;
      while (i < Math.min(src.length, out.length) && src[i] === out[i]) i++;
      assert.fail(`differs at offset ${i} (line ${src.slice(0, i).split('\n').length})\n`
        + `  src: ${JSON.stringify(src.slice(Math.max(0, i - 50), i + 50))}\n`
        + `  out: ${JSON.stringify(out.slice(Math.max(0, i - 50), i + 50))}`);
    }
    // CONTROL: a test that passes on an empty parse would be worthless. These cards have content.
    assert.ok(src.length > 500, 'fixture is suspiciously small');
    assert.ok(parseCard(src).cells.length > 3, 'nothing was parsed — the comparison is vacuous');
  });
}

test('🔴 a reorder changes the ORDER and nothing else — no cell is altered in passing', () => {
  const src = read('specimen-assets');   // 30 cells — reorder(3, 12) needs the list to be long
  const before = parseCard(src);
  const after = reorder(before, 3, 12);
  const raw = (m) => m.cells.map((c) => c.type + '|' + c.rawParams + '|' + c.body);
  assert.notDeepEqual(raw(after), raw(before), 'nothing moved — the test proves nothing');
  assert.deepEqual([...raw(after)].sort(), [...raw(before)].sort(),
    'a cell was altered, not just moved');
  assert.equal(after.cells.length, before.cells.length);
});

test('🔴 an edit to one param does not disturb params the editor knows nothing about', () => {
  // This is the WYSIWYG failure the spec names, in its smallest form. A resize gesture touches `w`;
  // everything else on that cell belongs to the creator and must come back untouched — including
  // params no form in the editor will ever render.
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=3 icon=patreon sub="Early chapters" unknown-to-us="keep me" %% [P](https://e.com)',
  ].join('\n') + '\n';
  const m = parseCard(md);
  const edited = { ...m, cells: [setSpan(m.cells[0], 2, 1, 6)] };
  const out = serializeCard(edited);
  assert.match(out, /icon=patreon/);
  assert.match(out, /sub="Early chapters"/);
  assert.match(out, /unknown-to-us="keep me"/, 'a param the editor does not model was dropped');
  assert.match(out, /w=2/);
  assert.ok(!/w=3/.test(out));
});

test('🔴 a resize must not re-introduce `h`, which the renderer no longer honours', () => {
  // `h` was removed from the renderer and from all three cards (74f83d8) — one layout model, heights
  // discovered from content. setSpan still had an `h` parameter, so a drag-to-resize gesture was the
  // one path that could write the dead token back into a creator's file, where it would serialise,
  // survive review as "just a span", and mean nothing.
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=3 %% [P](https://e.com)'].join('\n') + '\n';
  const m = parseCard(md);
  for (const h of [1, 2, 4]) {
    const out = serializeCard({ ...m, cells: [setSpan(m.cells[0], 2, h, 6)] });
    assert.ok(!/\bh=\d/.test(out), `setSpan(w=2, h=${h}) wrote an h token: ${out.split('\n').find((l) => l.includes('card:'))}`);
    assert.match(out, /w=2/);
  }
});

test('an existing `h` in a creator’s file is left alone until something edits that cell', () => {
  // Not the same claim. We do not go through anyone's card deleting tokens; we just stop writing new
  // ones. A file that still carries `h` round-trips byte-exact, because that is the whole promise.
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=3 h=2 %% [P](https://e.com)'].join('\n') + '\n';
  assert.equal(serializeCard(parseCard(md)), md);
});

// ── the primitives cardtile-w edits through ─────────────────────────────────────────────────────

test('🔴 normalizeCell goes through the PARSER, not through extractCell', () => {
  // The editor's first version did `extractCell(cellToRaw(cell))`. cellToRaw emits a whole tugtile
  // line — the `- [ ] ` prefix and the one-tab body indent are board-core's — and extractCell has
  // never seen either. So every form save turned a `link` cell into a `text` cell whose body was the
  // literal text `- [ ] %% card: link … %%`, with a form that had read and written every param
  // correctly. The params were never the hard part; the boundary between two parsers was.
  const cell = normalizeCell({ type: 'link', rawParams: 'w=6 sub="two words"', body: '[A](https://a.example)' });
  assert.equal(cell.type, 'link', 'a cell came back as the wrong TYPE — the prefix leaked into the body');
  assert.equal(cell.body, '[A](https://a.example)');
  assert.equal(cell.params.sub, 'two words');
  assert.equal(cell.params.w, '6');
  assert.ok(!/^- \[ \]/.test(cell.body), 'the tugtile line prefix is inside the body');
});

test('normalizeCell survives a multi-line body, which is where the tab indent lives', () => {
  const body = 'line one\n\n## not a lane heading\n- [ ] not a new cell';
  const cell = normalizeCell({ type: 'text', rawParams: '', body });
  assert.equal(cell.type, 'text');
  assert.equal(cell.body, body, 'the body did not survive the tab-indent round trip');
});

test('🔴 setToken understands QUOTED values, which may contain spaces', () => {
  // The value grammar has to be parseParams's. With `\\S+`, setting an existing `title="Two Words"`
  // replaces only `title="Two` and leaves `Words"` behind as a stray bare word — which parseParams
  // then reads as a boolean flag. Nothing wrote params programmatically until there was an editor.
  const rp = 'w=6 title="Two Words" icon=patreon';
  const out = setToken(rp, 'title', quoteParam('Three Whole Words'));
  assert.equal(out, 'w=6 title="Three Whole Words" icon=patreon');
  assert.equal(parseCard('## grid\n- [ ] %% card: feature ' + out + ' %%\n').cells[0].params.title, 'Three Whole Words');
  assert.equal(removeToken(rp, 'title'), 'w=6 icon=patreon');
});

test('quoteParam only quotes what needs it, so untouched files stay untouched', () => {
  assert.equal(quoteParam('6'), '6');
  assert.equal(quoteParam('patreon'), 'patreon');
  assert.equal(quoteParam('two words'), '"two words"');
});

// ── the BOARD projection (/try/edit2) ────────────────────────────────────────────────────────────
//
// `/try/edit2` mounts the engine's web tugtile as the editing table, which means the card is now
// also displayed by something that is not card-core. w2/board-bridge.mjs is the seam, and the whole
// design rests on one claim: THE BOARD IS A PROJECTION. It shows a summary of each cell and hands
// back a permutation; it never writes a byte of the file.
//
// 🔴 So the check is not "does the board render". It is: open the board, touch NOTHING, apply what
// the board says the order is, and get the same bytes out. If that ever stops holding, a person
// dragging one tile silently rewrites the rest of their card.
const boardCtx = (src) => ({
  faceLabel: '卡片正面',
  title: cardTitle(src),
  typeName: (t) => t,
  drawerPrefix: '抽屜：',
  drawerTitle: (id) => id,
});

for (const handle of LIVE) {
  test(`the board round-trips the ${handle} card byte-for-byte when nothing is moved`, () => {
    const src = read(handle);
    const model = parseCard(src);
    const ctx = boardCtx(src);
    const out = serializeCard(applyBoardOrder(model, identityOrder(model, ctx), ctx));
    assert.equal(out, src, 'a board that was only LOOKED at changed the file');
    // CONTROL: the projection has to have had something to project, or the equality above is a
    // comparison of two empty documents dressed up as a guarantee.
    assert.ok(boardSlots(model, ctx).length > 3, 'the board is empty — the round trip proves nothing');
    assert.ok(boardLanes(model, ctx).length >= 1, 'no lanes');
  });
}

test('🔴 a tile dragged to another lane moves — and every other cell is left exactly as it was', () => {
  // specimen-rich is the one with more than one lane — a face and two drawers, which is the shape
  // the owner's model describes (a second-level card lives in the second lane).
  const src = read('specimen-rich');
  const model = parseCard(src);
  const ctx = boardCtx(src);
  const order = identityOrder(model, ctx);
  // pick the first two lanes that both have tiles, and move one tile between them
  const from = order.find((l) => l.slots.length > 1);
  const to = order.find((l) => l !== from && l.slots.length > 0) || order.find((l) => l !== from);
  assert.ok(from && to, 'this fixture has only one lane — the drag cannot be expressed');
  const moved = from.slots.shift();
  to.slots.unshift(moved);

  const after = applyBoardOrder(model, order, ctx);
  const raw = (m) => [...m.cells, ...m.drawers.flatMap((d) => d.cells)].map((c) => c.type + '|' + c.rawParams + '|' + c.body);
  assert.deepEqual([...raw(after)].sort(), [...raw(model)].sort(), 'a cell was altered, not just moved');
  assert.notDeepEqual(raw(after), raw(model), 'nothing moved — the test proves nothing');
  // the pictures are not cells and must survive a reorder untouched
  assert.deepEqual(Object.keys(after.assets || {}), Object.keys(model.assets || {}), 'the assets lane did not survive');
  // …and it still serialises to something the parser reads back the same way
  const text = serializeCard(after);
  assert.equal(text, serializeCard(parseCard(text)), 'the moved board does not round-trip');
});

test('🔴 a lane the board never reported is still there afterwards', () => {
  // The board can be showing a subset — a lane filtered out, a render that has not caught up. An
  // apply that treated "not mentioned" as "deleted" would eat a whole section of somebody's card.
  const src = read('specimen-rich');
  const model = parseCard(src);
  const ctx = boardCtx(src);
  const full = identityOrder(model, ctx);
  assert.ok(full.length > 1, 'this fixture has one lane — the omission cannot be expressed');
  const partial = full.slice(0, 1);
  const after = applyBoardOrder(model, partial, ctx);
  assert.equal(serializeCard(after), src, 'a lane the board did not mention was dropped');
});

test('drawer links are discovered from what a cell actually says, and a dead one is REPORTED', () => {
  const md = ['---', 'card-page: t', 'title: T', '---', '',
    '## grid', '',
    '- [ ] %% card: link w=6 %% [About](#about)',
    '- [ ] %% card: feature w=3 href=#about %% look',
    '- [ ] %% card: link w=6 %% [Outside](https://example.com/)',
    '- [ ] %% card: link w=6 %% [Gone](#nosuch)',
    '',
    '## drawer: about | About me', '',
    '- [ ] %% card: text %% hello',
  ].join('\n') + '\n';
  const model = parseCard(md);
  const ctx = boardCtx(md);
  const { links, dangling } = drawerLinks(model, ctx);
  assert.deepEqual(links.map((l) => [l.slot, l.drawerId, l.drawerTitle]), [[0, 'about', 'About me'], [1, 'about', 'About me']],
    'the two tiles that open a drawer were not both found');
  assert.deepEqual(links.map((l) => l.drawerLane), ['drawer:about', 'drawer:about'], 'the 牽線 points at no lane');
  assert.deepEqual(dangling.map((d) => d.drawerId), ['nosuch'],
    'a link to a drawer that does not exist was filtered out instead of reported');
  // CONTROL: an ordinary external link is not a 牽線, and the discovery must not invent one
  assert.ok(!links.some((l) => l.slot === 2) && !dangling.some((d) => d.slot === 2),
    'an https link was read as opening a drawer');
});

// ── what a TILE SHOWS ────────────────────────────────────────────────────────────────────────────
//
// The cold read's P1-2: the board drew a numbered chip, a `#型別` hashtag and a folded title, and a
// first-time visitor read a to-do list. A tile is a mini-render of the finished element now, and
// `tileFace` is the whole of that decision — pure, so it is checked here rather than in a browser.
test('🔴 every tile kind renders as the ELEMENT: a picture, the words, the grey line', () => {
  const md = ['---', 'card-page: t', 'title: 小美', 'lang: zh-TW', '---', '',
    '## grid', '',
    '- [ ] %% card: profile w=6 avatar=asset:a1 %% 台北的家庭醫師',
    '- [ ] %% card: link w=3 %% [預約](https://www.example.com/book)',
    '- [ ] %% card: link w=3 %% [沒填](  )',
    '- [ ] %% card: feature w=3 img=asset:a2 alt=封面 %% eyebrow',
    '- [ ] %% card: text w=6 %% 第一行\n\t第二行',
    '- [ ] %% card: video w=6 yt=abcdefghijk %% 最新的影片',
    '- [ ] %% card: social w=6 %% [IG](https://instagram.com/x)\n\t[X](https://twitter.com/x)',
    '- [ ] %% card: embed w=6 kind=slider images=asset:a3,asset:a4 %%',
    '- [ ] %% card: link w=3 %% [更多](#more)',
    '',
    '## drawer: more | 更多', '',
    '- [ ] %% card: text %% inside',
  ].join('\n') + '\n';
  const ctx = { ...boardCtx(md), unsetLink: '還沒填網址', unsetImg: '＋ 加一張圖片',
    drawerTitle: (id) => (id === 'more' ? '更多' : id) };
  const faces = boardSlots(parseCard(md), ctx).map((s) => tileFace(s.cell, ctx));
  const by = (kind) => faces.filter((f) => f.kind === kind);

  // the profile's NAME is the file's frontmatter title — the one thing not on the cell at all
  assert.deepEqual(by('profile')[0], { kind: 'profile', title: '小美', sub: '台北的家庭醫師', img: 'asset:a1', icons: [] });
  // a link carries the mark its button will carry, derived the renderer's way (www. stripped)
  assert.deepEqual(by('link')[0], { kind: 'link', title: '預約', sub: 'example.com', img: '', icons: ['example.com'] });
  // …and a link with no address says what the CARD says about it, rather than looking finished
  assert.equal(by('link')[1].sub, '還沒填網址');
  assert.deepEqual(by('link')[1].icons, [], 'an empty address produced a favicon domain');
  // a picture is its own thumbnail; prose is its first line, with the second underneath
  assert.equal(by('feature')[0].img, 'asset:a2');
  assert.deepEqual([by('text')[0].title, by('text')[0].sub], ['第一行', '第二行']);
  // a video is its poster, at the SAME path the renderer emits (never i.ytimg.com)
  assert.equal(by('video')[0].img, '/_yt/abcdefghijk.jpg');
  // a social row is a row of marks, and twitter.com's mark lives at x.com (the renderer's alias)
  assert.deepEqual(by('social')[0].icons, ['instagram.com', 'x.com']);
  assert.equal(by('embed')[0].sub, '2', 'a slideshow does not say how many pictures it holds');
  // a 牽線 says where it goes instead of a url
  assert.equal(by('link')[2].sub, '抽屜：更多');

  // 🔴 CONTROL: nothing here is empty, and no face fell through to the default branch
  assert.equal(faces.length, 10, 'the fixture did not produce nine face cells plus the one in the drawer');
  for (const f of faces) assert.ok(f.title, `a ${f.kind} tile has no words on it`);
});

test('🩸 the tile text no longer carries a #type hashtag', () => {
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=6 %% [Book](https://example.com/)', ''].join('\n') + '\n';
  const ctx = { ...boardCtx(md), typeName: () => '連結' };
  const board = boardMd(parseCard(md), ctx);
  assert.ok(board.includes('Book'), 'the tile lost its words');
  assert.ok(!board.includes('#連結'), 'the board markdown still tags every tile with its kind');
  // (`#[^\s#]` and not `#\S`: the summary's own `### ` heading marker is three of them in a row)
  assert.ok(!/#[^\s#]/.test(board.split('\n').filter((l) => l.startsWith('- [ ]')).join('\n')),
    'a tile line still carries a hashtag');
});
