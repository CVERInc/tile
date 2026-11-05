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

test('a card at the byte ceiling made of one-line items parses and round-trips exactly', async () => {
  const { CARD_MAX_BYTES, utf8Length } = await import('./card-core.js');
  const head = '## grid\n\n';
  const lines = [];
  let bytes = head.length;
  for (let i = 0; ; i++) {
    const line = `- [ ] %% card: text %% ${i}\n`;
    if (bytes + line.length > CARD_MAX_BYTES) break;   // ASCII only: characters = bytes
    lines.push(line);
    bytes += line.length;
  }
  const md = head + lines.join('');
  assert.ok(utf8Length(md) <= CARD_MAX_BYTES, 'the fixture itself must fit under the ceiling');
  assert.ok(lines.length > 800_000, `expected the ceiling to hold over 800k one-line items, built ${lines.length}`);
  const model = parseCard(md);
  assert.equal(model.cells.length, lines.length);
  assert.equal(serializeCard(model), md);
});

// A card's other side is a BACK lane: `## back: about`. It used to be `## drawer: about`, and every card written
// before the rename still says that, so both are read and each keeps the word it was written with. Rewriting
// `drawer` to `back` on an ordinary save would change a creator's file without their asking (reef#2725, 2026-11-02);
// the old word leaves through one deliberate migration instead.
test('🔴 a back lane is read as `back:` or `drawer:`, and a save keeps whichever word the file used', () => {
  const face = '## grid\n\n- [ ] %% card: link %% [More](#about)\n- [ ] %% card: text back=#more %% Hi\n\n\n';
  const old = face + '## drawer: about | About me\n\n- [ ] %% card: text %% one\n\n\n## drawer: more\n\n- [ ] %% card: text %% two\n';
  const now = old.replace(/^## drawer:/gm, '## back:');
  const mixed = face + '## drawer: about | About me\n\n- [ ] %% card: text %% one\n\n\n## back: more\n\n- [ ] %% card: text %% two\n';
  for (const [label, md] of [['drawer', old], ['back', now], ['mixed', mixed]]) {
    const m = parseCard(md);
    assert.deepEqual(m.drawers.map((d) => [d.id, d.title, d.cells.length]), [['about', 'About me', 1], ['more', '', 1]],
      label + ': the back lanes were not read as backs');
    assert.equal(m.cells.length, 2, label + ': a back lane leaked into the face');
    assert.equal(serializeCard(m), md, label + ': a save rewrote the lane headings');
  }
});

test('a back lane added by an editor is written with the new word', () => {
  const m = parseCard('## grid\n\n- [ ] %% card: text %% Hi\n\n\n## drawer: about\n\n- [ ] %% card: text %% one\n');
  m.drawers.push({ id: 'more', title: 'More', cells: [] });
  const heads = serializeCard(m).split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## grid', '## drawer: about', '## back: more | More']);
});
