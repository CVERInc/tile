// The three things the review's first-time visitor could not do, asserted where they are decided.
//
// This file is the node-runnable half of Top-10 item 1 (「連結／圖片／名字三個表單改成純 UI」). The
// browser half — tapping a file input, seeing a thumbnail — is verify/sandbox-served.mjs's job. What
// is checked HERE is everything that survives without a DOM: the shape of the form definition, the
// renderer's refusal to draw a dead button or a broken picture, and the rename primitive.
//
//   node --test packages/cardtile/w/sandbox-forms.test.mjs
//
// 🔴 EVERY CLAIM HAS A CONTROL. A test that says "no `href=\"#\"` in the output" passes beautifully
// against an empty string, so each one below also proves the output it is scanning is real, and the
// two behaviours that were WRONG are reconstructed by hand so the check is watched failing on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_TYPES, SOURCE, CONTROL, DISPOSITION, PALETTE, blankCell } from '../ai-ops.mjs';
import { parseCard, serializeCard, setTitle, normalizeCell, cellToRaw } from '../card-core.js';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { cellStrings } from './cell-i18n.mjs';
import { LOCALE_KEYS } from './sandbox-i18n.mjs';
import { drawerLinks } from '../w2/board-bridge.mjs';

const card = (...cells) => ['---', 'card-page: try', 'title: 小美', 'lang: zh-TW', '---', '',
  '## cards', '', ...cells].join('\n') + '\n';

const EDIT_STRINGS = { linkUnset: '還沒填網址', imgUnset: '＋ 加一張圖片' };
const live = (md) => renderCardHTML(md, { handle: 'try', cardUrl: '' });
const editing = (md) => renderCardHTML(md, { handle: 'try', cardUrl: '', editIndex: true, editStrings: EDIT_STRINGS });

// ── the form definition ──────────────────────────────────────────────────────────────────────────

test('every form row points at something that exists — a param, the body, or a declared derived field', () => {
  const DERIVED = new Set(['link.text', 'link.url', 'link.target', 'feature.target', 'profile.name']);
  let checked = 0;
  for (const [type, def] of Object.entries(CELL_TYPES)) {
    if (!def.form) continue;
    const flat = def.form.flatMap((r) => (r.group ? r.rows : [r]));
    assert.ok(flat.length, `${type}: an empty form is not a form`);
    for (const row of flat) {
      checked++;
      if (row.source === SOURCE.BODY) { assert.ok(def.body, `${type}: form asks for a body the type has none of`); continue; }
      if (row.source === SOURCE.PARAM) {
        assert.ok(def.params[row.name], `${type}.${row.name}: form row names a param that is not declared`);
        assert.equal(def.params[row.name].disposition, DISPOSITION.FORM,
          `${type}.${row.name}: a RAW/RETIRED param must never get a form row`);
        continue;
      }
      assert.equal(row.source, SOURCE.DERIVED, `${type}.${row.name}: unknown row source ${row.source}`);
      assert.ok(DERIVED.has(`${type}.${row.name}`), `${type}.${row.name}: derived row with no codec in editor.mjs`);
      assert.ok(row.label && row.control, `${type}.${row.name}: a derived row must carry its own label and control`);
    }
  }
  // CONTROL: the loop above must actually have walked something
  assert.ok(checked >= 15, `only ${checked} form rows scanned — the form definitions are not being read`);
  for (const t of ['profile', 'link', 'feature', 'text']) assert.ok(CELL_TYPES[t].form, `${t} has no form`);
});

test('🔴 a form definition carries KEYS, never a sentence in one language', () => {
  // 🔴 The WORDS are sandbox-cells.test.mjs's subject — all nine locales, with the review's own
  // forbidden list over every one of them. What is checked HERE is the thing that makes that gate
  // reachable at all: nothing in this file may be a literal, or it is a string in exactly one
  // language that no locale table will ever be asked about.
  const KEY = /^(type|width|blank)\.[a-z0-9.]+$/;
  const seen = [];
  for (const [type, def] of Object.entries(CELL_TYPES)) {
    if (!def.form) continue;
    const strings = [def.title, def.hint, def.body && def.body.label, def.body && def.body.hint];
    for (const row of def.form.flatMap((r) => (r.group ? [{ label: r.group }, ...r.rows] : [r]))) {
      const p = row.name && def.params[row.name];
      strings.push(row.label, row.hint, p && p.label, p && p.hint);
    }
    for (const s of strings.filter(Boolean)) {
      seen.push(s);
      assert.match(s, KEY, `${type}: ${JSON.stringify(s)} is a literal, not a key`);
    }
  }
  assert.ok(seen.length >= 25, `only ${seen.length} strings scanned — this is measuring nothing`);
  // CONTROL: the pattern rejects what these strings used to be
  assert.doesNotMatch('`[顯示文字](網址)`。', KEY);
});

test('the palette leads with the profile — the thing a first visit is actually for', () => {
  assert.equal(PALETTE[0], 'profile');
});

test('a picture field is a picture PICKER, not a text box', () => {
  assert.equal(CELL_TYPES.feature.params.img.control, CONTROL.ASSET);
  assert.equal(CELL_TYPES.profile.params.avatar.control, CONTROL.ASSET);
});

// ── a bare address becomes a working link ────────────────────────────────────────────────────────

test('🔴 a bare address in a link body renders a REAL button, never href="#"', () => {
  const md = card('- [ ] %% card: link w=6 %% https://instagram.com/samdoc');
  const html = live(md);
  assert.match(html, /href="https:\/\/instagram\.com\/samdoc"/, 'the address is not the href');
  assert.doesNotMatch(html, /href="#"/, 'the dead-button href is back');
  // and the button is named after the site, not printed as a raw address
  assert.match(html, /st-cell-title">instagram\.com</);
  assert.doesNotMatch(html, /st-cell-title">https:/);
});

test('CONTROL: the href="#" scan can see a real one, and the page it scans is a real page', () => {
  // a `#drawer` target is the ONE legitimate `#` href, and it must still work
  const md = card('- [ ] %% card: link w=6 %% [More](#more)', '', '## drawer: more | More', '',
    '- [ ] %% card: text %% inside');
  const html = live(md);
  assert.match(html, /href="#more" data-drawer="more"/, 'a drawer link stopped working');
  assert.ok(html.length > 2000, `the rendered page is ${html.length} bytes — this scan has no subject`);
});

test('🔴 a link with nothing usable in it draws NOTHING live, and a tappable outline while editing', () => {
  const md = card('- [ ] %% card: link w=6 %% just some words');
  assert.doesNotMatch(live(md), /just some words/, 'a dead button is still being drawn on a live card');
  const draft = editing(md);
  assert.match(draft, /st-cell-unset/);
  assert.match(draft, /還沒填網址/, 'the editing placeholder is not localised from the caller');
  assert.match(draft, /data-cell="0"/, 'the outline is not addressable — it cannot be tapped to finish');
});

test('editStrings only reaches the editor: a live card never carries the placeholder words', () => {
  const md = card('- [ ] %% card: link w=6 %% just some words');
  assert.doesNotMatch(live(md), /還沒填網址/);
});

// ── an empty picture never renders a broken img ──────────────────────────────────────────────────

test('🔴 a picture cell with no picture emits no <img> at all — live or editing', () => {
  const md = card('- [ ] %% card: feature w=3 %%');
  const html = live(md);
  assert.doesNotMatch(html, /<img[^>]*src=""/, 'the broken-image <img src=""> is back');
  // 🩸 NOT `doesNotMatch(html, /st-gal-cell/)`. The whole stylesheet is inlined in this document, so
  // that scan reads the CSS RULE for the class and fails on a page that renders no such cell at all.
  // `data-coral-type` is markup the renderer emits and the stylesheet never mentions.
  assert.doesNotMatch(html, /data-coral-type="feature"/, 'an empty picture cell is still drawing a cell');
  const draft = editing(md);
  assert.doesNotMatch(draft, /<img[^>]*src=""/);
  assert.match(draft, /加一張圖片/, 'nothing to tap to add the picture');
});

test('🔴 a picture with no destination is a PICTURE, not a link to the current page', () => {
  const md = card('- [ ] %% card: feature w=3 img=https://example.com/a.png alt=Cat %%');
  const html = live(md);
  assert.match(html, /src="https:\/\/example\.com\/a\.png"/, 'the picture itself is missing');
  assert.doesNotMatch(html, /href=""/, 'the empty-href self-link is back');
  assert.doesNotMatch(html, /<a class="st-gal-link"/, 'a picture with no destination is still wrapped in a link');
  assert.match(html, /<div class="st-gal-link"/, 'the picture lost its layout box along with the anchor');
});

test('a picture WITH a destination is still a link, and still opens in a new tab', () => {
  const md = card('- [ ] %% card: feature w=3 img=https://example.com/a.png href=https://example.com/shop %%');
  const html = live(md);
  assert.match(html, /<a class="st-gal-link" href="https:\/\/example\.com\/shop" target="_blank"/);
});

test('CONTROL: the empty-src scan fires on the markup the old renderer produced', () => {
  const old = '<a class="st-gal-link" href="" target="_blank"><img class="st-gal-img" src="" alt=""></a>';
  assert.match(old, /<img[^>]*src=""/, 'the scanner cannot see an empty src at all');
  assert.match(old, /href=""/, 'the scanner cannot see an empty href at all');
});

// ── the name ─────────────────────────────────────────────────────────────────────────────────────

test('🔴 setTitle changes exactly one line and leaves the rest of the file alone', () => {
  const md = card('- [ ] %% card: profile w=6 %% a bio', '- [ ] %% card: text %% words');
  const before = md.split('\n');
  const after = serializeCard(setTitle(parseCard(md), 'Sam')).split('\n');
  const differing = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
  assert.equal(differing.length, 1, `expected one changed line, got ${JSON.stringify(differing)}`);
  assert.deepEqual(differing[0], ['title: 小美', 'title: Sam']);
  assert.equal(before.length, after.length, 'the file grew or shrank');
});

test('setTitle: the new name is what the card actually shows', () => {
  const md = card('- [ ] %% card: profile w=6 %% a bio');
  const renamed = serializeCard(setTitle(parseCard(md), '小明'));
  assert.match(live(renamed), /st-hero-name">小明</);
  assert.doesNotMatch(live(renamed), /st-hero-name">小美</);
});

test('setTitle: a frontmatter with no title gets one, and nothing else moves', () => {
  const md = ['---', 'card-page: try', 'lang: zh-TW', '---', '', '## cards', '',
    '- [ ] %% card: text %% hi'].join('\n') + '\n';
  const out = serializeCard(setTitle(parseCard(md), 'Sam'));
  assert.match(out, /^title: Sam$/m);
  assert.match(out, /^card-page: try$/m);
  assert.match(out, /^lang: zh-TW$/m);
});

test('🔴 setTitle does NOT treat prose under the frontmatter as a field', () => {
  const md = ['---', 'card-page: try', 'title: 小美', '---', '',
    'title: this is a sentence someone wrote', '', '## cards', '',
    '- [ ] %% card: text %% hi'].join('\n') + '\n';
  const out = serializeCard(setTitle(parseCard(md), 'Sam'));
  assert.match(out, /^title: Sam$/m, 'the frontmatter field was not updated');
  assert.match(out, /^title: this is a sentence someone wrote$/m, 'a sentence in the lead prose was rewritten');
});

test('setTitle is pure — the model it was handed is unchanged', () => {
  const model = parseCard(card('- [ ] %% card: text %% hi'));
  const pre = model.pre;
  setTitle(model, 'Someone Else');
  assert.equal(model.pre, pre);
});

// ── Markdown mode (Top-10 #10, §3.4) ─────────────────────────────────────────────────────────────
//
// 🩸 THE REVIEW'S PREMISE WAS WRONG, and finding that out is most of what this section is.
// §3.4 specifies 「解析失敗時不離開模式…錯誤來自 parseCard 的 throw」. There is no such throw:
// parseCard degrades, every time. A guard written against an exception would have been a red line
// that could never appear — a gate nobody would ever see fail. These tests pin down what actually
// goes wrong instead, which is what editor.mjs's `whatIsWrong` is written against.

test('🔴 parseCard does NOT throw on broken input — it degrades, which is why a throw-guard is not the gate', () => {
  const BROKEN = {
    'an unterminated frontmatter fence': '---\ncard-page: try\ntitle: X\n\n## cards\n\n- [ ] %% card: text %% hi\n',
    'no lane heading at all': '---\ntitle: X\n---\n\nhello\n',
    'not markdown at all': 'just some words\n',
    'a cell marker with the colon missing': '---\ntitle: X\n---\n\n## cards\n\n- [ ] %% card text %% hi\n',
    'nothing': '',
  };
  for (const [what, md] of Object.entries(BROKEN)) {
    assert.doesNotThrow(() => parseCard(md), `parseCard threw on ${what} — the review's premise would hold`);
  }
});

test('the two shapes that DO lose something are both detectable, and both are things people type', () => {
  // (mirrors editor.mjs's whatIsWrong — kept here because the editor's copy needs a DOM to reach)
  const wrong = (md) => {
    const lines = String(md).split('\n');
    const orphan = lines.findIndex((l) => /^\s*-\s*\[/.test(l) && !/%%\s*card\s*:/.test(l));
    if (orphan >= 0) return { line: orphan + 1 };
    if (!lines.some((l) => /^##\s+\S/.test(l))) return { line: 1 };
    return null;
  };
  const good = '---\ntitle: X\n---\n\n## cards\n\n- [ ] %% card: text %% hi\n';
  assert.equal(wrong(good), null, 'a good card must be leaveable');

  // A tile whose `%% card: … %%` marker got mangled. 🩸 The setup assertion here caught me
  // asserting the wrong loss: the CELL is not dropped — board-core still reads the `- [ ]` line, so
  // it survives as a *text* cell whose body is the wreckage ("card: text hi"). That is the same
  // damage wearing a different shape: a link tile silently becomes a paragraph of its own source,
  // which is exactly what turned every edited link into raw markdown the first time this editor was
  // built. Worth refusing to leave over, and now asserted for what it actually is.
  const mangled = good.replace('%% card: text %%', 'card: text');
  assert.deepEqual(wrong(mangled), { line: 7 }, 'a marker-less tile line is not reported');
  const [wreck] = parseCard(mangled).cells;
  assert.equal(wreck.body, 'card: text hi', 'setup: the mangled line really does absorb its own marker');
  assert.notEqual(wreck.body, parseCard(good).cells[0].body, 'setup: nothing was actually damaged');

  // the lane heading deleted: the file has stopped being a card
  assert.deepEqual(wrong(good.replace('## cards\n', '')), { line: 1 });
  assert.deepEqual(wrong(''), { line: 1 });

  // CONTROL: a card with SEVERAL tiles reports the first broken one, not just any line
  const two = '---\ntitle: X\n---\n\n## cards\n\n- [ ] %% card: text %% one\n- [ ] card: text %% two\n';
  assert.deepEqual(wrong(two), { line: 8 });
});

test('🔴 Markdown mode round-trips: text in, the same card back out', () => {
  // What the mode promises is that `commit(textarea.value)` reproduces the file — so a card that
  // goes out through serializeCard and back in through parseCard must be the same card.
  const md = card(
    '- [ ] %% card: profile w=6 avatar=asset:sha256-aaaaaaaaaaaaaaaa %% a bio',
    '- [ ] %% card: link w=6 sub="a note" %% [Shop](https://shop.example.com/)',
    '- [ ] %% card: text %% some words',
    '',
    '## assets',
    '',
    '- [ ] %% card: asset id=sha256-aaaaaaaaaaaaaaaa mime=image/webp %% UklGRg',
  );
  const once = serializeCard(parseCard(md));
  const twice = serializeCard(parseCard(once));
  assert.equal(once, twice, 'the round trip is not idempotent');
  const model = parseCard(once);
  assert.equal(model.cells.length, 3);
  assert.deepEqual(Object.keys(model.assets), ['sha256-aaaaaaaaaaaaaaaa'], 'the pictures did not survive');
  assert.equal(model.cells[1].params.sub, 'a note', 'a quoted param did not survive');
});

test('a change made in the raw text reaches the card, and only what was changed', () => {
  const before = card('- [ ] %% card: profile w=6 %% a bio', '- [ ] %% card: text %% some words');
  const edited = before.replace('some words', 'different words');
  const model = parseCard(edited);
  assert.equal(model.cells[1].body, 'different words');
  assert.equal(model.cells[0].body, 'a bio', 'the untouched tile changed too');
  assert.match(live(edited), /different words/);
});

// ── 「＋加一張牌」 (/try/edit2's one-row icon picker) ─────────────────────────────────────────────
//
// The picker offers the SEVEN types and nothing else, and pressing one puts a tile on the card. What
// is asserted here is the step between those two facts: the type a person pressed becomes a
// `%% card: <that type> … %%` line, in the lane they pressed it in — through `normalizeCell`, so
// what is stored is what re-reading the file gives, not what the picker believed it made.
//
// 🩸 The failure this is watching for is not hypothetical. cardtile-w spent its first hour turning
// every saved cell into a `text` cell whose body was the literal string `- [ ] %% card: link … %%`
// — a form that read and wrote every param correctly, on the wrong side of a parser boundary.

test('every type in the palette adds a tile that serialises as THAT type', () => {
  const strings = cellStrings('zh');
  for (const type of PALETTE) {
    const blank = blankCell(type, strings);
    assert.ok(blank, `${type}: the palette offers a type with no blank`);
    const cell = normalizeCell({ ...blank, params: {} });
    assert.equal(cell.type, type, `${type}: adding it produced a ${cell.type} cell`);
    // it has to survive being written into a card and read back — the picker's real round trip
    const md = card(cellToRaw(cell));
    const back = parseCard(md).cells;
    assert.equal(back.length, 1, `${type}: the added tile did not come back as exactly one cell`);
    assert.equal(back[0].type, type, `${type}: re-reading the file gives a ${back[0].type}`);
    assert.match(md, new RegExp(`%% card: ${type}\\b`), `${type}: the marker does not name the type`);
    assert.ok(!/^- \[ \]/.test(back[0].body), `${type}: the tugtile line prefix leaked into the body`);
  }
  // CONTROL: the loop must have walked the whole palette, and the palette must be the seven types
  assert.equal(PALETTE.length, 7, 'the palette is no longer seven types — this test was written for seven');
  assert.deepEqual([...PALETTE].sort(), Object.keys(CELL_TYPES).sort(),
    'the picker and the definition disagree about which types exist');
});

test('🔴 a blank tile carries the words of the locale it was added in, in all nine', () => {
  // The picker's labels and the tile it creates come from the same table. A blank whose body is a
  // Chinese literal is what an English visitor used to watch appear on their own card.
  for (const locale of LOCALE_KEYS) {
    const strings = cellStrings(locale);
    for (const type of PALETTE) {
      const blank = blankCell(type, strings);
      // BLANKS holds KEYS; a key that survives resolution is a key that will be printed at somebody
      assert.ok(!/^blank\./.test(blank.body), `${locale}/${type}: the blank body is still the key ${blank.body}`);
    }
  }
  const zh = blankCell('text', cellStrings('zh')).body;
  const en = blankCell('text', cellStrings('en')).body;
  assert.notEqual(zh, en, 'CONTROL: two locales gave the same blank — the resolution is not happening');
});

test('the drawer a tile opens is discovered from the cell, not from where it sits', () => {
  // 🔴 The 牽線 `/try/edit2` draws is only as honest as this: it must read what the CELL says. A
  // discovery that keyed off lane position would draw a line for a tile that happens to sit next to
  // a drawer, and none for the one that actually opens it.
  const md = card(
    '- [ ] %% card: link w=6 %% [About](#about)',
    '- [ ] %% card: link w=6 %% [Elsewhere](https://example.com/)',
    '',
    '## drawer: about | About', '',
    '- [ ] %% card: text %% inside',
  );
  const model = parseCard(md);
  const { links, dangling } = drawerLinks(model, { faceLabel: 'F' });
  assert.deepEqual(links.map((l) => l.drawerId), ['about']);
  assert.equal(links[0].fromLane, 'face:0', 'the opener was not located on the face');
  assert.equal(links[0].drawerLane, 'drawer:about');
  assert.deepEqual(dangling, []);
  // CONTROL: the second tile sits in the same lane and opens nothing
  assert.equal(links.length, 1, 'a plain external link was counted as a 牽線');
});
