// The Cards line marker has two spellings while the old one is on its way out: `%% card: <type>` and
// `%% cardtile: <type>` (docs/VOCABULARY.md, "Lines and lanes on disk"). This file holds the rules of
// that window:
//   · every reader takes both spellings and reads the same cell from either;
//   · a line keeps the spelling it was written with through a save, in both directions;
//   · writers still write `%% card:` for a line that is new;
//   · nothing that only looks like the marker is touched.
// It also holds the front lane's planned heading (`## front`), which the reader already takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseCard, serializeCard, extractCell, cellToRaw, normalizeCell, setSpan, setToken, reorder,
  mergeAssets, setTitle,
} from './card-core.js';
import { renderPage } from './card-render.mjs';
import { assembleSave, thinCard } from './card-save.mjs';
import { isTemplateOnly } from './card-blank.mjs';
import { whatIsWrong } from './w/md-guard.mjs';
import { sandboxDoorFields } from './w/sandbox-door.mjs';
import { splitCard, readsAsCard } from './w3/host-bridge.mjs';
import { cardKey } from './serve/card-api.mjs';
import { EDITOR_PROTOCOL } from './ai-ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FM = '---\ncard-page: aster\ntitle: Aster\n---\n\n';
const oldOf = (md) => md.replace(/%% cardtile:/g, '%% card:');
const newOf = (md) => md.replace(/%% card:/g, '%% cardtile:');

// one file, written entirely in the old spelling, in the shape serializeCard writes
const OLD = FM +
  '## grid\n\n' +
  '- [ ] %% card: profile w=6 back=#about %% Illustrator.\n' +
  '- [ ] %% card: link w=3 %% [Shop](https://example.org/shop)\n' +
  '- [ ] %% card: text %%\n\tline one\n\tline two\n' +
  '- [ ] %% card: embed kind=slider images="https://i.example/1.png" %%\n\n\n' +
  '## Shop\n\n' +
  '- [ ] %% card: link w=6 %% [Blog](https://example.org/blog)\n\n\n' +
  '## back: about\n\n' +
  '- [ ] %% card: text %% I draw things.\n\n\n' +
  '## assets\n\n' +
  '- [ ] %% card: asset id=sha256-aaaaaaaaaaaaaaaa mime=image/png %% AAAA\n' +
  '- [ ] %% card: asset id=sha256-bbbbbbbbbbbbbbbb mime=image/webp %% BBBB\n';
const NEW = newOf(OLD);
// every other marker switched: the two spellings side by side in every lane
const MIXED = (() => { let n = 0; return OLD.replace(/%% card:/g, (s) => (n++ % 2 ? '%% cardtile:' : s)); })();

const stripMarker = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'marker' ? undefined : v)));

// ── the reader ───────────────────────────────────────────────────────────────────────────────

test('🔴 a `%% cardtile: <type>` line is a cell: same type, params and body as `%% card: <type>`', () => {
  const md = FM + '## grid\n\n- [ ] %% cardtile: profile w=6 avatar="asset:pic" %% Illustrator.\n';
  const [cell, ...rest] = parseCard(md).cells;
  assert.equal(rest.length, 0);
  assert.equal(cell.type, 'profile', 'the line was not read as a profile cell');
  assert.deepEqual(cell.params, { w: '6', avatar: 'asset:pic' });
  assert.equal(cell.rawParams, 'w=6 avatar="asset:pic"');
  assert.equal(cell.body, 'Illustrator.');
  assert.deepEqual(stripMarker(cell), parseCard(oldOf(md)).cells[0], 'the two spellings read as different cells');
});

test('extractCell: both spellings, with and without spaces, inline and multi-line bodies', () => {
  for (const [text, want] of [
    ['%% cardtile: link w=3 %% [Shop](https://example.org/)', { type: 'link', rawParams: 'w=3', body: '[Shop](https://example.org/)' }],
    ['%%cardtile:link w=3%% [Shop](https://example.org/)', { type: 'link', rawParams: 'w=3', body: '[Shop](https://example.org/)' }],
    ['%% cardtile: text %%\nline one\nline two', { type: 'text', rawParams: '', body: 'line one\nline two' }],
    ['%% cardtile: feature w=3 img=https://example.org/a.png %%', { type: 'feature', rawParams: 'w=3 img=https://example.org/a.png', body: '' }],
  ]) {
    const got = extractCell(text);
    assert.deepEqual({ type: got.type, rawParams: got.rawParams, body: got.body }, want, text);
    assert.equal(got.marker, 'cardtile', `${text}: the spelling was not remembered`);
    const old = extractCell(text.replace('cardtile:', 'card:'));
    assert.deepEqual(stripMarker(got), old, `${text}: the old spelling reads differently`);
    assert.equal('marker' in old, false, 'a `%% card:` cell carries no spelling note: its shape is what it always was');
  }
});

test('the legacy carousel word is read under the new marker too, and keeps both of its spellings', () => {
  const cell = extractCell('%% cardtile: embed kind=slider images="https://i.example/1.png" %%');
  assert.equal(cell.type, 'slides');
  assert.equal(cell.spelled, 'embed');
  assert.equal(cell.marker, 'cardtile');
  assert.equal(cellToRaw(cell), '- [ ] %% cardtile: embed kind=slider images="https://i.example/1.png" %%');
});

test('a whole file in the new spelling parses to the model the old spelling gives', () => {
  const a = parseCard(OLD);
  const b = parseCard(NEW);
  assert.equal(b.cells.length, 5);
  assert.equal(b.drawers.length, 1);
  assert.deepEqual(Object.keys(b.assets), ['sha256-aaaaaaaaaaaaaaaa', 'sha256-bbbbbbbbbbbbbbbb'], 'the assets lane was not read');
  assert.deepEqual(stripMarker(b), a);
  assert.deepEqual(stripMarker(parseCard(MIXED)), a);
});

// ── render ───────────────────────────────────────────────────────────────────────────────────

test('render: the page is the same page whichever spelling its lines use', () => {
  const ctx = { name: 'Aster', handle: 'aster' };
  const want = renderPage(parseCard(OLD), ctx);
  assert.ok(want.includes('Illustrator.') && want.includes('https://example.org/shop'), 'setup: the control page drew nothing');
  assert.equal(renderPage(parseCard(NEW), ctx), want);
  assert.equal(renderPage(parseCard(MIXED), ctx), want);
});

// ── round trip: a save keeps each line's spelling ────────────────────────────────────────────

test('🔴 round trip: a save rewrites neither spelling — old stays old, new stays new, mixed stays mixed', () => {
  for (const [name, md] of [['old', OLD], ['new', NEW], ['mixed', MIXED]]) {
    const once = serializeCard(parseCard(md));
    assert.equal(once, md, `${name}: a save changed the file`);
    assert.equal(serializeCard(parseCard(once)), once, `${name}: not idempotent`);
  }
  assert.ok(!OLD.includes('cardtile:') && !NEW.includes('%% card:'), 'setup');
  assert.ok(MIXED.includes('%% card:') && MIXED.includes('%% cardtile:'), 'setup: the mixed file is not mixed');
});

test('an edit to a cell keeps the spelling of its line', () => {
  const model = parseCard(NEW);
  const cell = model.cells[1];
  assert.equal(setSpan(cell, 6).marker, 'cardtile');
  assert.equal(normalizeCell({ ...cell, rawParams: setToken(cell.rawParams, 'sub', 'prints') }).marker, 'cardtile');
  assert.equal(cellToRaw(setSpan(cell, 6)), '- [ ] %% cardtile: link w=6 %% [Shop](https://example.org/shop)');
  // …and an old line stays old through the same edits
  const old = parseCard(OLD).cells[1];
  assert.equal(cellToRaw(normalizeCell(setSpan(old, 6))), '- [ ] %% card: link w=6 %% [Shop](https://example.org/shop)');
});

test('reordering a mixed file moves each line with its own spelling', () => {
  const md = FM + '## grid\n\n- [ ] %% card: link %% [A](https://a.example)\n- [ ] %% cardtile: link %% [B](https://b.example)\n';
  const out = serializeCard(reorder(parseCard(md), 0, 1));
  assert.equal(out, FM + '## grid\n\n- [ ] %% cardtile: link %% [B](https://b.example)\n- [ ] %% card: link %% [A](https://a.example)\n');
});

test('🔴 writers still write `%% card:`: a cell that was never read from a file gets the current spelling', () => {
  assert.equal(cellToRaw({ type: 'link', rawParams: 'w=6', body: '[A](https://a.example)' }), '- [ ] %% card: link w=6 %% [A](https://a.example)');
  assert.equal(cellToRaw({ type: 'text', rawParams: '', body: '' }), '- [ ] %% card: text %%');
  // only the exact note is honoured: nothing else chooses a marker
  for (const marker of ['card', 'CARDTILE', 'sitetile', 'x %% y', '', null, true]) {
    assert.equal(cellToRaw({ type: 'text', rawParams: '', body: 'hi', marker }), '- [ ] %% card: text %% hi', String(marker));
  }
  // a new asset added to a file written in the new spelling is a new line, so it is written `%% card:`
  const model = parseCard(NEW);
  model.assets = { ...model.assets, 'sha256-cccccccccccccccc': { mime: 'image/png', b64: 'CCCC' } };
  const out = serializeCard(model);
  assert.ok(out.includes('- [ ] %% card: asset id=sha256-cccccccccccccccc mime=image/png %% CCCC'));
  assert.ok(out.includes('- [ ] %% cardtile: asset id=sha256-aaaaaaaaaaaaaaaa mime=image/png %% AAAA'));
  // a line with no marker at all is still wrapped as a text cell in the current spelling
  assert.ok(serializeCard(parseCard(FM + '## grid\n\n- [ ] just words\n')).includes('- [ ] %% card: text %% just words'));
});

test('🔴 the save path: thin exit, assembled save and the editor split all keep both spellings', () => {
  const thin = thinCard(MIXED);
  assert.equal(thin, MIXED.slice(0, MIXED.indexOf('## assets')).replace(/\n+$/, '\n'), 'the thin card changed a line');
  // the assets come back from the store, each in the spelling the store holds
  const saved = assembleSave(thin, MIXED);
  assert.equal(saved.md, MIXED);
  assert.equal(assembleSave(thinCard(NEW), NEW).md, NEW);
  assert.equal(assembleSave(thinCard(OLD), OLD).md, OLD);
  // an incoming card in one spelling over a stored card in the other: cells follow the caller's
  // text, assets follow the store's
  const crossed = assembleSave(thinCard(NEW), OLD).md;
  assert.equal(crossed, thinCard(NEW).replace(/\n*$/, '\n') + OLD.slice(OLD.indexOf('## assets') - 2));
  // the editor's split hands the parent the same lane entries either way: what crosses to the
  // parent is bytes for put_asset, and the store keeps the spelling of each line it already holds
  const withRef = NEW.replace('w=6 back=#about', 'w=6 avatar="asset:sha256-aaaaaaaaaaaaaaaa"');
  const { md, assets } = splitCard(withRef);
  assert.equal(md, thinCard(withRef));
  assert.deepEqual(assets, { 'sha256-aaaaaaaaaaaaaaaa': { mime: 'image/png', b64: 'AAAA' } });
  assert.deepEqual(splitCard(oldOf(withRef)).assets, { 'sha256-aaaaaaaaaaaaaaaa': { mime: 'image/png', b64: 'AAAA' } });
});

// ── the other readers of stored markdown ─────────────────────────────────────────────────────

test('the Markdown-mode guard takes a `%% cardtile:` line as a tile, and still names a line with no marker', () => {
  assert.equal(whatIsWrong(NEW), null);
  assert.equal(whatIsWrong(MIXED), null);
  assert.equal(whatIsWrong(OLD), null);
  assert.equal(whatIsWrong(FM + '## grid\n\n- [ ] %% cardtile : text %% spaced\n'), null, 'the guard has always allowed a space before the colon');
  const broken = FM + '## grid\n\n- [ ] %% cardtile: text %% fine\n- [ ] no marker here\n';
  assert.deepEqual(whatIsWrong(broken), { line: broken.split('\n').indexOf('- [ ] no marker here') + 1 });
  for (const line of ['- [ ] %% sitetile: hero %%', '- [ ] %% tugtile:settings', '- [ ] %% cardtiles: text %% x', '- [ ] %% postcard: text %% x']) {
    const md = FM + '## grid\n\n' + line + '\n';
    assert.deepEqual(whatIsWrong(md), { line: 8 }, `${line} passed as a Cards line`);
  }
});

test('readers that count cells or read one take the new spelling', () => {
  assert.equal(readsAsCard(NEW), true);
  assert.deepEqual(sandboxDoorFields(NEW), { name: 'Aster', tagline: 'Illustrator.' });
  assert.deepEqual(sandboxDoorFields(NEW), sandboxDoorFields(OLD));
  assert.deepEqual(sandboxDoorFields(FM + '## grid\n\n- [ ] %% sitetile: profile %% not ours\n'), { name: 'Aster', tagline: '' });
  assert.deepEqual(sandboxDoorFields(FM + '## grid\n\n- [ ] %% cardtiles: profile %% not ours\n'), { name: 'Aster', tagline: '' });
  for (const md of [OLD, NEW, MIXED]) assert.equal(isTemplateOnly(md), isTemplateOnly(OLD));
});

test('a blank template is recognised as blank in either spelling, and a look-alike line is not a template tile', () => {
  const blank = FM + '## grid\n\n- [ ] %% card: profile w=6 %% blank.profile\n- [ ] %% card: text %% blank.text\n';
  assert.equal(isTemplateOnly(blank), true, 'setup: the old-spelling template is blank');
  assert.equal(isTemplateOnly(newOf(blank)), true, 'a template written `%% cardtile:` was not recognised as blank');
  assert.equal(isTemplateOnly(blank.replace('%% card: text', '%% cardtile: text')), true, 'mixed');
  // the marker has to be READ for the answer to be "blank": a line the parser does not take as a
  // tile is authored text, and so is a filled tile in the new spelling
  assert.equal(isTemplateOnly(blank.replace('%% card: text', '%% cardtiles: text')), false, 'look-alike');
  assert.equal(isTemplateOnly(newOf(blank).replace('blank.text', 'I draw things.')), false, 'a filled new-spelling tile');
});

// ── a picture staged over an id the file already holds ───────────────────────────────────────
// Asset ids are content addresses, so choosing the same picture again — or choosing an embedded
// picture as the backdrop — stages an id the assets lane already has. The staged entry is the
// picker's `{ mime, b64 }`; the line it lands on keeps the marker it was written with.
const A = 'sha256-aaaaaaaaaaaaaaaa', B = 'sha256-bbbbbbbbbbbbbbbb';   // in MIXED: A is `card:`, B is `cardtile:`
const STAGED = { [A]: { mime: 'image/png', b64: 'AAAA' }, [B]: { mime: 'image/webp', b64: 'BBBB' } };

test('🔴 mergeAssets: staged bytes replace an entry, the line keeps its marker, a new id is written `card:`', () => {
  assert.ok(MIXED.includes(`%% card: asset id=${A}`) && MIXED.includes(`%% cardtile: asset id=${B}`), 'setup');
  for (const id of [A, B]) {
    const x = parseCard(MIXED);
    x.assets = mergeAssets(x.assets, { [id]: STAGED[id] });
    assert.equal(serializeCard(x), MIXED, `re-staging ${id} changed the file`);
  }
  const x = parseCard(NEW);
  x.assets = mergeAssets(x.assets, { [B]: { mime: 'image/gif', b64: 'CCCC' }, 'sha256-cccccccccccccccc': { mime: 'image/png', b64: 'DDDD', marker: 'cardtile' } });
  const out = serializeCard(x);
  assert.ok(out.includes(`- [ ] %% cardtile: asset id=${B} mime=image/gif %% CCCC\n`), 'new bytes on an existing line respelled it');
  assert.ok(out.includes('- [ ] %% card: asset id=sha256-cccccccccccccccc mime=image/png %% DDDD\n'), 'a new asset line is written `%% card:`');
  assert.equal(out.replace(/^.*id=sha256-(b|c){16} .*\n/gm, ''), NEW.replace(/^.*id=sha256-b{16} .*\n/m, ''), 'another line moved');
  // pure: neither argument is written to, and an absent side is an empty one
  const had = parseCard(NEW).assets, before = JSON.stringify(had);
  mergeAssets(had, STAGED);
  assert.equal(JSON.stringify(had), before);
  assert.deepEqual(mergeAssets(undefined, STAGED), STAGED);
  assert.deepEqual(mergeAssets(had, undefined), had);
});

// An asset id is any name the API takes, and some of those are names every object already answers
// to. Each one is still a line in the assets lane: its own entry in the map, never a write to the
// map's prototype, and never mistaken for an entry the lane holds.
test('🔴 mergeAssets: an id that is also an Object.prototype name is an asset like any other', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const staged = Object.fromEntries([[id, { mime: 'image/png', b64: 'QUJD' }]]);
    const x = parseCard(OLD);
    const had = Object.keys(x.assets);
    x.assets = mergeAssets(x.assets, staged);
    assert.ok(Object.prototype.hasOwnProperty.call(x.assets, id), `${id} is not an own entry`);
    assert.deepEqual(Object.keys(x.assets), [...had, id], `${id} is not listed`);
    assert.deepEqual(x.assets[id], { mime: 'image/png', b64: 'QUJD' }, `${id} holds something else`);
    assert.equal(Object.getPrototypeOf(x.assets), Object.prototype, `${id} replaced the map's prototype`);
    const out = serializeCard(x);
    assert.ok(out.includes(`- [ ] %% card: asset id=${id} mime=image/png %% QUJD\n`), `${id} wrote no asset line`);
    // staged again over the map that now holds it: one line, same spelling, new bytes
    x.assets = mergeAssets(x.assets, Object.fromEntries([[id, { mime: 'image/gif', b64: 'REVG' }]]));
    const again = serializeCard(x);
    assert.ok(again.includes(`- [ ] %% card: asset id=${id} mime=image/gif %% REVG\n`), `${id} re-staged wrote no line`);
    assert.equal(again.split(`asset id=${id} `).length, 2, `${id} is written twice`);
  }
  // an inherited name is not a held asset: `constructor` on a lane without one gets no marker …
  const fresh = mergeAssets(parseCard(NEW).assets, { constructor: { mime: 'image/png', b64: 'QUJD' } });
  assert.deepEqual(fresh.constructor, { mime: 'image/png', b64: 'QUJD' });
  // … and one the lane does hold, written `cardtile:`, keeps that spelling
  const y = parseCard(NEW.replace(/\n*$/, '\n') + '- [ ] %% cardtile: asset id=constructor mime=image/png %% QUJD\n');
  const HELD = serializeCard(y);   // the lane is written sorted by id
  assert.ok(HELD.includes('- [ ] %% cardtile: asset id=constructor mime=image/png %% QUJD\n') && !HELD.includes('%% card:'), 'setup');
  y.assets = mergeAssets(y.assets, { constructor: { mime: 'image/gif', b64: 'REVG' } });
  assert.equal(serializeCard(y), HELD.replace('id=constructor mime=image/png %% QUJD', 'id=constructor mime=image/gif %% REVG'));
});

// The editors are browser modules. Each function that folds staged pictures into the file is one
// top-level block; it is run here, as written, over stand-ins for the page around it.
function editorFn(file, name, env) {
  const src = readFileSync(join(HERE, file), 'utf8').split('\n');
  const from = src.findIndex((l) => l.startsWith(`function ${name}(`));
  const to = src.findIndex((l, i) => i > from && l === '}');
  assert.ok(from >= 0 && to > from, `${file}: ${name} moved; this test no longer finds it`);
  return new Function('env', `with (env) { return (${src.slice(from, to + 1).join('\n')}); }`)(env);
}
const noDom = { querySelectorAll: () => [], querySelector: () => null };

test('🔴 the editor: finishing a sheet with a re-chosen picture leaves the file byte for byte as it was', () => {
  for (const id of [B, A]) {
    const m = parseCard(MIXED);
    let out = null;
    const env = {
      open: { i: 1, which: 'front', asMd: true }, pending: { [id]: STAGED[id] }, undoTo: null, TYPES: {},
      cellAt: (i) => m.cells[i], syncProse() {}, closeSheet() {}, clone: () => structuredClone(m),
      el: (n) => (n === 'f-__raw' ? { value: m.cells[1].body } : noDom),
      backId: () => '', defId: () => '', withRaw: (c) => c,
      commit: (x) => { out = serializeCard(x); },
      normalizeCell, setTitle, setToken, mergeAssets,
    };
    editorFn('w3/edit3.mjs', 'saveSheet', env)();
    assert.equal(out, MIXED, `saveSheet respelled a line (staged ${id})`);
  }
});

test('🔴 the editor: an embedded picture chosen as the backdrop keeps its asset line', () => {
  for (const id of [B, A]) {
    const m = parseCard(MIXED);
    let out = null;
    const env = {
      pending: { [id]: STAGED[id] }, clone: () => structuredClone(m), cache: { clear() {} },
      applySetting: (pre, name, value) => pre.replace('title: Aster\n', `title: Aster\n${name}: ${value}\n`),
      commit: (x) => { out = serializeCard(x); },
      mergeAssets,
    };
    editorFn('w3/edit3.mjs', 'putSetting', env)('backdrop', `asset:${id}`);
    assert.equal(out, MIXED.replace('title: Aster\n', `title: Aster\nbackdrop: asset:${id}\n`), `putSetting respelled a line (staged ${id})`);
    assert.deepEqual(env.pending, {}, 'the staged picture was not taken');
  }
});

test('🔴 the older editor: saving a tile with a re-chosen picture leaves the file byte for byte as it was', () => {
  for (const id of [B, A]) {
    const S = { model: parseCard(MIXED), lane: { kind: 'face' } };
    let out = null;
    const env = {
      S, openIndex: 1, pendingAssets: { [id]: STAGED[id] }, TYPES: { link: {} },
      laneCells: () => S.model.cells, el: () => noDom, document: { getElementById: () => null },
      composeCell: (cell) => ({ rawParams: cell.rawParams, body: cell.body, rename: null }),
      formCtx() {}, fieldError() {}, closeModal() {},
      edit: (fn) => { out = serializeCard(fn(structuredClone({ ...S.model }))); },
      normalizeCell, setTitle, mergeAssets,
    };
    editorFn('w/editor.mjs', 'saveCell', env)();
    assert.equal(out, MIXED, `saveCell respelled a line (staged ${id})`);
  }
});

test('no writer folds staged pictures into the assets lane by hand', () => {
  // one merge, in card-core: a spread of `{ mime, b64 }` over an entry drops the line's marker
  for (const f of ['w3/edit3.mjs', 'w/editor.mjs', 'serve/card-api.mjs']) {
    const src = readFileSync(join(HERE, f), 'utf8');
    assert.doesNotMatch(src, /assets = \{ *\.\.\./, `${f} spreads over the assets map`);
    assert.match(src, /assets = mergeAssets\(/, `${f} does not merge through card-core`);
  }
});

test('the verification scripts that pick a line by its marker take either spelling, and keep it', () => {
  // these run in a browser against a served card; the selector itself is one expression, run here
  const line = (file, has) => {
    const l = readFileSync(join(HERE, file), 'utf8').split('\n').find((x) => x.includes(has));
    assert.ok(l, `${file}: the selector moved; this test no longer finds it`);
    return l;
  };
  const control = /w\.md(\.replace\(.*\))\);/.exec(line('verify/editor.mjs', 'chips=CONTROL'));
  assert.ok(control, 'verify/editor.mjs: the control edit changed shape');
  const edit = new Function('md', `return md${control[1]};`);
  assert.ok(edit(OLD).includes('- [ ] %% card: profile chips=CONTROL w=6'), 'old spelling');
  assert.ok(edit(NEW).includes('- [ ] %% cardtile: profile chips=CONTROL w=6'), 'the control edit did nothing to a `%% cardtile:` file');
  assert.equal(oldOf(edit(NEW)), edit(OLD), 'the control edit respelled a line');
  const leak = /if \((\/.*\/m)\.test\(thinRow\.body\)\)/.exec(line('verify/negotiation.mjs', 'an asset line survived'));
  assert.ok(leak, 'verify/negotiation.mjs: the leak check changed shape');
  const leaked = new Function(`return ${leak[1]};`)();
  for (const md of [OLD, NEW, MIXED]) assert.equal(leaked.test(md), true, 'an asset line in a thin card went unseen');
  for (const md of [OLD, NEW, MIXED]) assert.equal(leaked.test(thinCard(md)), false);
  assert.equal(leaked.test(FM + '## assets\n\n- [ ] %% cardtiles: asset id=x mime=image/png %% AAAA\n'), false, 'look-alike');
});

// deck.js is a browser script; its item reader is one block, run here against a stand-in `window`.
function deckItems(md) {
  const src = readFileSync(join(HERE, 'w3/deck.js'), 'utf8').split('\n');
  const from = src.findIndex((l) => l.includes('const mdTexts=[]'));
  const to = src.findIndex((l, i) => i > from && /^\s*a=b\+1; \} \} \}\s*$/.test(l));
  assert.ok(from >= 0 && to > from, 'deck.js: the item reader moved; this test no longer finds it');
  const run = new Function('window', src.slice(from, to + 1).join('\n') + '\nreturn { mdTexts, backAt: [...backAt], backs: [...backs] };');
  return run({ __cardMd: md });
}

test('the deck reads its items from either spelling, and from a file that mixes them', () => {
  const want = deckItems(OLD);
  assert.deepEqual(want.mdTexts, ['Illustrator.', '[Shop](https://example.org/shop)', '', '', '[Blog](https://example.org/blog)', 'AAAA', 'BBBB'], 'setup: the control read changed');
  assert.deepEqual(want.backAt, [[0, 'about']]);
  assert.deepEqual(want.backs, [['about', ['I draw things.']]]);
  assert.deepEqual(deckItems(NEW), want);
  assert.deepEqual(deckItems(MIXED), want);
  assert.deepEqual(deckItems(NEW.replace(/\n/g, '\r\n').replace(/^---\r\n/, '---\n').replace(/\r\n---\r\n/, '\n---\n')), want, 'CRLF');
  // look-alikes are not items
  for (const line of ['- [ ] %% cardtiles: text %% x', '- [ ] %% cards: text %% x', '- [ ] %% card : text %% x', '- [ ] %% sitetile: hero %% x', '- [ ] %% tugtile:settings']) {
    assert.deepEqual(deckItems(FM + '## grid\n\n' + line + '\n').mdTexts, [], line);
  }
});

// ── look-alikes ──────────────────────────────────────────────────────────────────────────────

test('🔴 look-alikes are not the marker: each is read exactly as it was before the new spelling', () => {
  const plain = (text) => ({ type: 'text', params: {}, rawParams: '', body: text });
  for (const text of [
    '%% sitetile: hero bg=cover.jpg %%',
    '%% tugtile:settings',
    '%% kanban:settings',
    '%% cardtiles: link %% [A](https://a.example)',
    '%% cards: link %% [A](https://a.example)',
    '%% card-page: link %% [A](https://a.example)',
    '%% cardtile-x: link %% [A](https://a.example)',
    '%% postcard: link %% [A](https://a.example)',
    '%% xcardtile: link %% [A](https://a.example)',
    '%% tile: link %% [A](https://a.example)',
    '%% Cardtile: link %% [A](https://a.example)',
    '%% CARD: link %% [A](https://a.example)',
    '%% card tile: link %% [A](https://a.example)',
    'card:aster:0',
    'cardtile: link',
    'see %% cardtile: link %% in the middle of a line',
  ]) {
    assert.deepEqual(extractCell(text), plain(text), text);
  }
});

test('a Site line or a board settings block inside a Cards file passes through a save unchanged', () => {
  const md = FM + '## grid\n\n- [ ] %% cardtile: text %% %% sitetile: hero %% and %% card: link %%\n\n\n%% tugtile:settings\n```\n{"a":1}\n```\n%%\n';
  const model = parseCard(md);
  assert.equal(model.cells.length, 1);
  assert.equal(model.cells[0].body, '%% sitetile: hero %% and %% card: link %%', 'a marker inside a body is body');
  assert.ok(model.post.includes('tugtile:settings'), 'the settings block is not a lane and not a cell');
  assert.equal(serializeCard(model), md);
});

test('names that start with `card:` and are not the line marker did not move', () => {
  assert.equal(cardKey('aster', 0), 'card:aster:0');
  assert.equal(cardKey('aster', 3), 'card:aster:3');
  const events = [...Object.keys(EDITOR_PROTOCOL.toParent || {}), ...Object.keys(EDITOR_PROTOCOL.toEditor || {})];
  assert.ok(events.length >= 11, 'setup: the editor protocol table was not found');
  for (const e of events) assert.match(e, /^card:[a-z-]+$/, `${e}: a postMessage event was renamed`);
  assert.ok(events.includes('card:ready') && events.includes('card:load') && events.includes('card:save'));
  // the frontmatter claim keeps its name
  assert.match(parseCard(NEW).pre, /^---\ncard-page: aster\n/);
});

// ── the front lane ───────────────────────────────────────────────────────────────────────────

test('`## front` is the front lane: read as the front, shown without a label, written back as `## front`', () => {
  const md = FM + '## front\n\n- [ ] %% card: profile w=6 %% Illustrator.\n\n\n## Shop\n\n- [ ] %% cardtile: link w=6 %% [Shop](https://example.org/shop)\n\n\n## back: about\n\n- [ ] %% card: text %% I draw things.\n';
  const model = parseCard(md);
  assert.equal(model.lane, 'front');
  assert.deepEqual(model.blocks, [{ label: '', start: 0, count: 1 }, { label: 'Shop', start: 1, count: 1 }], 'the first lane carries no label, whatever it is headed');
  assert.equal(model.drawers.length, 1);
  assert.equal(serializeCard(model), md, '`## front` was rewritten by a save');
  // the same file headed `## grid` is the same Cards, and the page is the same page
  const grid = md.replace('## front', '## grid');
  assert.deepEqual({ ...parseCard(grid), lane: 'front' }, model);
  assert.equal(renderPage(model, { name: 'Aster' }), renderPage(parseCard(grid), { name: 'Aster' }));
  assert.ok(!renderPage(model, { name: 'Aster' }).includes('>front<'), 'the front lane printed its heading');
  assert.equal(serializeCard(parseCard(grid)), grid, '`## grid` was rewritten forward');
});

test('writers still head a new front lane `## grid`', () => {
  assert.equal(parseCard('').lane, 'grid');
  assert.match(serializeCard({ pre: '', post: '', cells: [{ type: 'text', rawParams: '', body: 'hi' }], drawers: [], assets: {} }), /^## grid\n/);
  assert.match(cellToRaw(normalizeCell({ type: 'text', rawParams: '', body: 'hi' })), /^- \[ \] %% card: text %% hi$/);
});

test('the editor starts an empty file from `## cards`, and that heading is kept like any other', () => {
  // docs/VOCABULARY.md says what each writer heads the front lane; this is the editor's seed
  const seed = /^const EMPTY = '(.*)';$/m.exec(readFileSync(join(HERE, 'w3/edit3.mjs'), 'utf8'));
  assert.ok(seed, 'w3/edit3.mjs: the empty-file seed moved; this test no longer finds it');
  const EMPTY = seed[1].replace(/\\n/g, '\n');
  assert.equal(EMPTY, '## cards\n\n');
  const x = parseCard(EMPTY);
  assert.equal(x.lane, 'cards');
  x.cells.push(normalizeCell({ type: 'text', rawParams: '', body: 'hi' }));
  if (x.blocks[0]) x.blocks[0].count = 1; else x.blocks = [{ label: '', start: 0, count: 1 }];
  assert.equal(serializeCard(x), '## cards\n\n- [ ] %% card: text %% hi\n');
});
