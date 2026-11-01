// reef#2725 — `embed` means "paste HTML" now, and the carousel that borrowed the name is `slides`.
//
// What this file pins, in the order the spec says it (reef#2725 「embed 正式版規格」, 2026-10-31):
//   1. the BACKWARD MAPPING. An existing card that wrote `embed kind=…` keeps rendering the carousel it
//      always rendered, with no change to its file — the parser reads it as `slides`, and writes it
//      back with the word it was written with.
//   2. the ESCAPE. The HTML rides in `srcdoc="…"`, so a `"` in it that is not escaped ends the
//      attribute and the rest of the author's HTML is markup in OUR page — the very cross-tenant XSS
//      the iframe exists to prevent. Checked against payloads built to do exactly that, with a
//      decoder written here (not the renderer's escaper run backwards — that agrees with itself).
//   3. the SANDBOX. `allow-scripts` and nothing else: no allow-same-origin (an opaque origin cannot
//      read reef.cards' storage or cookies), no allow-top-navigation (it cannot take the reader away).
//   4. the THEME. The card's own `--cp-*` reach the embed's `:root`, equal to the page's.
//   5. the BUDGET. An embed whose HTML would blow the card's byte ceiling is refused, by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCard, serializeCard, normalizeCell, removeToken, cellToRaw, kindAssigned, CARD_MAX_BYTES, embedsOverCeiling } from './card-core.js';
import { parseParams } from '../sitetile/site-core.js';
import { LEGACY_EMBED_LINES, legacyCard, gridOf } from './cards/embed-legacy-lines.mjs';
import { renderCardHTML } from './serve/card-worker.mjs';
import { CELL_TYPES, PALETTE, BLANKS, UNIVERSAL, DISPOSITION } from './ai-ops.mjs';

const card = (...lines) => ['---', 'title: T', '---', '', '## grid', '', ...lines, ''].join('\n');
const render = (md, ctx = {}) => renderCardHTML(md, { handle: 't', cardUrl: 'https://t.example/', ...ctx });

/** every cell of one coral type, as its outer html, by brace-free tag matching on `st-cell` divs */
function cellsOf(html, coral) {
  const out = [];
  const re = new RegExp(`<div class="st-cell[^"]*"[^>]*data-coral-type="${coral}"`, 'g');
  let m;
  while ((m = re.exec(html))) {
    // walk <div …> / </div> to the matching close — the cell's own extent, whatever it holds
    let depth = 0, i = m.index;
    const tag = /<\/?div\b[^>]*>/g;
    tag.lastIndex = i;
    let t;
    while ((t = tag.exec(html))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { out.push(html.slice(m.index, tag.lastIndex)); break; }
    }
  }
  return out;
}

// ── an HTML attribute tokenizer and entity decoder, written HERE ──────────────────────────────────
// 🔴 Independent of the renderer on purpose: running the renderer's own escaper backwards would agree
// with it whatever it did ([[idempotence-is-not-correctness]]). This follows the HTML tokenizer's
// attribute rules closely enough for the shapes a renderer emits: names up to `=`/space/`>`,
// double-quoted values end at the NEXT `"` — which is exactly the rule an attacker's `"` exploits.
function tagsNamed(html, name) {
  const tags = [];
  const open = new RegExp(`<${name}\\b`, 'gi');
  let m;
  while ((m = open.exec(html))) {
    let i = m.index + m[0].length;
    const attrs = [];
    for (;;) {
      while (/\s/.test(html[i])) i++;
      if (html[i] === '>' || i >= html.length) break;
      if (html[i] === '/' ) { i++; continue; }
      let n = '';
      while (i < html.length && !/[\s=>\/]/.test(html[i])) n += html[i++];
      while (/\s/.test(html[i])) i++;
      let v = '';
      if (html[i] === '=') {
        i++;
        while (/\s/.test(html[i])) i++;
        if (html[i] === '"' || html[i] === "'") {
          const q = html[i++];
          const end = html.indexOf(q, i);
          v = html.slice(i, end < 0 ? html.length : end);
          i = end < 0 ? html.length : end + 1;
        } else {
          while (i < html.length && !/[\s>]/.test(html[i])) v += html[i++];
        }
      }
      attrs.push([n.toLowerCase(), decode(v)]);
    }
    tags.push({ at: m.index, end: i + 1, attrs });
  }
  return tags;
}
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|lt|gt|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/**
 * The whole safety claim for one embed cell, as a list of what is wrong with it ([] = safe):
 * exactly one <iframe>, its attributes exactly the expected set, `sandbox` exactly `allow-scripts`,
 * the decoded srcdoc ending in the author's HTML verbatim, and — outside that one attribute value —
 * no markup of the author's at all: no <script, no </iframe, no second iframe.
 */
function problems(cellHtml, authored) {
  const out = [];
  const frames = tagsNamed(cellHtml, 'iframe');
  if (frames.length !== 1) return [`${frames.length} <iframe> tags, expected exactly 1`];
  const [f] = frames;
  const names = f.attrs.map(([n]) => n);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) out.push(`duplicated attribute(s) ${dup.join(', ')} — the FIRST wins in a browser, so a second one hides`);
  const expected = ['loading', 'referrerpolicy', 'sandbox', 'srcdoc', 'title'];
  if (names.slice().sort().join() !== expected.join()) out.push(`attributes are [${names.join(', ')}], expected exactly [${expected.join(', ')}]`);
  const get = (n) => (f.attrs.find(([k]) => k === n) || [])[1];
  if (get('sandbox') !== 'allow-scripts') out.push(`sandbox="${get('sandbox')}", expected exactly "allow-scripts"`);
  const doc = get('srcdoc') || '';
  if (!doc.endsWith(authored)) out.push('the decoded srcdoc does not end with the authored HTML, verbatim');
  // everything in the cell that is NOT the srcdoc value — where a leak would land
  const raw = /\ssrcdoc="([^"]*)"/.exec(cellHtml.slice(f.at, f.end));
  const outside = raw ? cellHtml.replace(raw[1], '') : cellHtml;
  if (/<script/i.test(outside)) out.push('a <script tag outside the srcdoc value — the author\'s HTML escaped into the page');
  if ((outside.match(/<\/iframe>/gi) || []).length !== 1) out.push('the iframe is not closed exactly once outside its srcdoc');
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 1. the backward mapping
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('`embed kind=…` is the carousel by its old name: parsed as `slides`, written back as `embed`, byte for byte', () => {
  const lines = [
    '- [ ] %% card: embed w=6 kind=slider images=asset:a3,asset:a4 %%',
    '- [ ] %% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" bg=https://i.example/bg.png %%',
    '- [ ] %% card: embed kind=video channel=UCabc w=6 %% Latest',
  ];
  const md = card(...lines);
  const m = parseCard(md);
  assert.deepEqual(m.cells.map((c) => c.type), ['slides', 'slides', 'slides']);
  assert.equal(serializeCard(m), md, 'an old card did not survive a parse→serialize unchanged — its file would change on the next save');
  // and a cell that no longer has the old shape is written by its real name, so it can never come
  // back as something else: drop `kind` and it is a `slides` cell, not an empty `embed`.
  const c = { ...m.cells[0], rawParams: 'w=6 images=asset:a3' };
  const again = parseCard(serializeCard({ ...m, cells: [c] }));
  assert.equal(again.cells[0].type, 'slides');
});

test('`embed` without `kind` is HTML; `slides` is the carousel by its own name', () => {
  const m = parseCard(card(
    '- [ ] %% card: embed w=6 %% <b>hi</b>',
    '- [ ] %% card: slides kind=slider images=https://i.example/1.png %%',
  ));
  assert.deepEqual(m.cells.map((c) => c.type), ['embed', 'slides']);
});

// 🔴 THE EXPECTATION COMES FROM BEFORE THE CHANGE. A first version of this test rendered `embed …` and
// `slides …` with the SAME (new) renderer and compared them — two renders of HEAD agree whatever HEAD
// does, and it let `kind=""` (blank before) start drawing a carousel through the new default.
// cards/embed-legacy.golden.json is the pre-rename renderer's output, frozen with its ref.
const GOLDEN = JSON.parse(readFileSync(new URL('./cards/embed-legacy.golden.json', import.meta.url), 'utf8'));

test('🔴 every legacy `embed` line renders what the PRE-RENAME renderer drew (the frozen golden)', () => {
  assert.ok(!/^0+$/.test(GOLDEN.ref) && GOLDEN.ref.length === 40, 'the golden names no source ref');
  assert.deepEqual(Object.keys(GOLDEN.grids), LEGACY_EMBED_LINES, 'the golden and the line list disagree — regenerate the golden from the pre-rename ref');
  for (const line of LEGACY_EMBED_LINES) {
    const now = gridOf(render(legacyCard(line)));
    // the ONE intended difference: the carousel cell now says what it is (nothing reads the attribute)
    const then = GOLDEN.grids[line].replace(/data-coral-type="embed"/g, 'data-coral-type="slides"');
    assert.equal(now, then, `changed since tile@${GOLDEN.ref.slice(0, 7)}: ${line}`);
    assert.doesNotMatch(now, /<iframe/, `a legacy line became an iframe: ${line}`);
  }
  // CONTROL: the golden is not all-empty, and not all-carousel — both sides of the boundary are in it
  const drawn = Object.values(GOLDEN.grids).filter((g) => /<figure/.test(g)).length;
  assert.ok(drawn >= 4 && drawn < LEGACY_EMBED_LINES.length, `${drawn} of ${LEGACY_EMBED_LINES.length} golden grids draw a carousel`);
});

test('the same params under the new name draw the same carousel (the default only fills an ABSENT kind)', () => {
  for (const params of ['w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png"', 'kind=bubbles images=https://i.example/1.png']) {
    assert.equal(gridOf(render(card(`- [ ] %% card: embed ${params} %%`))), gridOf(render(card(`- [ ] %% card: slides ${params} %%`))));
  }
  // a NEW slides cell with no kind is a slider…
  assert.match(render(card('- [ ] %% card: slides images=https://i.example/1.png %%')), /st-slider/);
  // …but an explicitly empty one is not filled in, under either name
  assert.doesNotMatch(render(card('- [ ] %% card: slides kind="" images=https://i.example/1.png %%')), /<figure/);
});

test('🔴 the boundary is a `kind=` ASSIGNMENT token, read the way parseParams reads names', () => {
  const typeOf = (params, body = '') => parseCard(card(`- [ ] %% card: embed ${params} %%${body ? ' ' + body : ''}`)).cells[0].type;
  // legacy: any assignment of kind, with or without a value — these drew nothing before, and must not
  // start running their bodies as HTML now
  assert.equal(typeOf('kind= images="https://example.com/a.png"', '<b>legacy body</b>'), 'slides');
  assert.equal(typeOf('kind="" images="https://example.com/a.png"'), 'slides');
  assert.equal(typeOf('kind =slider images=x'), 'slides');
  assert.equal(typeOf('-kind=slider images=x'), 'slides', 'parseParams reads `-kind=` as kind, so this was a carousel');
  // HTML: no assignment of the NAME kind — a bare flag, a longer name, or `kind=` inside a quoted value
  assert.equal(typeOf('kind', '<b>x</b>'), 'embed', 'a bare `kind` flag is not a `kind=` token');
  assert.equal(typeOf('w=6 akind=x', '<b>x</b>'), 'embed');
  assert.equal(typeOf('w=6 foo-kind=x', '<b>x</b>'), 'embed', 'parseParams reads `foo-kind` as ONE name');
  assert.equal(typeOf('w=6 note="keep kind=slider"', '<b>x</b>'), 'embed', 'a `kind=` inside quotes is the note\'s text');
});

// 🔴 r3: the boundary is decided on the PARSER'S OWN TOKEN STREAM. r2 searched the raw string with
// quoted values blanked — a different stream from parseParams' — and both ways it can differ are real:
// a `kind=` INSIDE an unquoted value (a URL's query) is not an assignment, and a `"` inside an unquoted
// value must not blank out the real assignment after it.
const BOUNDARY = [
  // [params, kind assigned?] — the review's two inputs first
  ['note=https://example.com/?kind=slider', false],
  ['note=a" kind=slider images=https://example.com/a.png x="b"', true],
  ['kind=slider', true], ['kind=', true], ['kind=""', true], ['kind =x', true], ['-kind=x', true],
  ['kind', false], ['akind=x', false], ['foo-kind=x', false], ['note="kind=x"', false], ['note="a" kind=x', true],
  ['x.kind=y', true], ['w=6', false], ['a ="x kind=y"', true], ['note=x?kind=', false], ['note="unterminated kind=x', true],
];

test('🔴 r3 the review\'s inputs: a `kind=` inside a URL value is HTML; a real one after a stray quote is the carousel', () => {
  const html = render(card('- [ ] %% card: embed note=https://example.com/?kind=slider %% <b>Hello</b>'));
  const [cell] = cellsOf(html, 'embed');
  assert.ok(cell, 'the embed whose only `kind=` is inside a URL rendered no HTML cell');
  assert.deepEqual(problems(cell, '<b>Hello</b>'), []);
  const md = card('- [ ] %% card: embed note=a" kind=slider images=https://example.com/a.png x="b" %% <b>Hello</b>');
  assert.equal(parseCard(md).cells[0].type, 'slides');
  const out = render(md);
  assert.doesNotMatch(out, /<iframe/, 'a carousel the old renderer drew became an iframe publishing its body');
  assert.match(out, /<figure[^>]*><img src="https:\/\/example\.com\/a\.png"/);
});

test('🔴 r3 `kindAssigned` agrees with parseParams: every kind the old renderer could read is an assignment', () => {
  for (const [raw, want] of BOUNDARY) {
    assert.equal(kindAssigned(raw), want, `kindAssigned(${JSON.stringify(raw)})`);
    const p = parseParams(raw);
    // the direction that protects published cards: a kind VALUE parseParams reads ⇒ legacy
    if (typeof p.kind === 'string') assert.ok(kindAssigned(raw), `parseParams reads kind=${JSON.stringify(p.kind)} from ${JSON.stringify(raw)}, kindAssigned does not`);
    // and a bare flag is never an assignment
    if (p.kind === true) assert.ok(!kindAssigned(raw), `${JSON.stringify(raw)}: a bare kind flag counted as an assignment`);
  }
});

test('🔴 r3 the writer\'s inline copy decides exactly as the parser does, on every boundary input', () => {
  for (const [raw] of BOUNDARY) {
    const written = cellToRaw({ type: 'slides', spelled: 'embed', rawParams: raw, body: '' });
    assert.equal(/%% card: embed /.test(written), kindAssigned(raw), `${JSON.stringify(raw)}: cellToRaw and kindAssigned disagree`);
  }
});

test('the inline copy in cellToRaw is the same code as kindAssigned, line for line', () => {
  const src = readFileSync(new URL('./card-core.js', import.meta.url), 'utf8');
  const copies = [...src.matchAll(/^([ \t]*)function kindAssigned\(raw\) \{\n([\s\S]*?)^\1\}$/gm)].map((m) => m[2].split('\n').map((l) => l.trim()).join('\n'));
  assert.equal(copies.length, 2, `found ${copies.length} copies of kindAssigned, expected the function and cellToRaw's copy`);
  assert.equal(copies[1], copies[0], 'cellToRaw\'s copy of kindAssigned has drifted from the one extractCell uses');
});

test('🔴 writing back: the old word is kept exactly while the line still parses as slides, by the same reading', () => {
  // byte-identical round trips for every legacy shape, including the ones a substring test gets wrong
  for (const line of [...LEGACY_EMBED_LINES, '%% card: embed -kind=slider images="https://example.com/a.png" %%']) {
    const md = legacyCard(line);
    assert.equal(serializeCard(parseCard(md)), md, `round trip changed: ${line}`);
  }
  // the edit path: remove the REAL kind; a `kind=` left inside a quoted note must not keep the old word
  const md = legacyCard('%% card: embed kind=slider images="https://example.com/a.png" note="keep kind=slider" %%');
  const cell = parseCard(md).cells[0];
  assert.equal(cell.type, 'slides');
  const edited = normalizeCell({ ...cell, rawParams: removeToken(cell.rawParams, 'kind') });
  assert.doesNotMatch(edited.rawParams, /^kind=|\skind=slider images/, 'removeToken did not remove the real kind — the fixture measures nothing');
  assert.equal(edited.type, 'slides', 'the slideshow became an HTML embed (and disappeared) once its kind was removed');
  assert.match(serializeCard({ ...parseCard(md), cells: [edited] }), /%% card: slides /);
  // and the writer agrees with the parser on every input: a legacy slides cell edited to carry each of
  // these param strings is written so that it reads back as slides — never as HTML — and keeps the old
  // word exactly when the parser would have read that word as slides
  const base = parseCard(card('- [ ] %% card: embed kind=slider %%'));
  for (const params of ['kind=slider', 'kind=', 'kind=""', 'kind =x', '-kind=x', 'kind', 'akind=x', 'foo-kind=x', 'note="kind=x"', 'note="a" kind=x', 'x.kind=y', 'w=6']) {
    const out = serializeCard({ ...base, cells: [{ ...base.cells[0], rawParams: params }] });
    const back = parseCard(out).cells[0];
    assert.equal(back.type, 'slides', `a slideshow edited to \`${params}\` came back as ${back.type}`);
    const parserSaysSlides = parseCard(card(`- [ ] %% card: embed ${params} %%`)).cells[0].type === 'slides';
    assert.equal(/%% card: embed /.test(out), parserSaysSlides, `\`${params}\`: the writer and the parser disagree about the old word`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 2 & 3. the escape and the sandbox
// ═════════════════════════════════════════════════════════════════════════════════════════════════

const PAYLOADS = {
  'attribute breakout': '"><script>parent.document.title="pwned"</script>',
  'a literal &quot; that must stay literal': '<p title="a &quot;quoted&quot; word">x &quot; y</p>',
  'early </iframe>': '</iframe><script>alert(document.cookie)</script><iframe>',
  'single quotes and ampersands': "<p onclick='go(1)'>a & b &amp; c &lt;not a tag&gt;</p>",
  'a real script, which is the point': '<div id="c"></div><script>document.getElementById("c").textContent=new Date()</script>',
  'a multi-line paste': '<style>\n  .x { color: red }\n</style>\n<div class="x">\n  two\n  lines\n</div>',
};

for (const [name, html] of Object.entries(PAYLOADS)) {
  test(`🔴 escape: ${name} — stays inside srcdoc, verbatim, under sandbox="allow-scripts"`, () => {
    const body = html.includes('\n') ? '\n' + html.split('\n').map((l) => '\t' + l).join('\n') : ' ' + html;
    const md = card(`- [ ] %% card: embed w=6 %%${body}`);
    const cells = cellsOf(render(md), 'embed');
    assert.equal(cells.length, 1, 'the embed rendered no cell');
    assert.deepEqual(problems(cells[0], html), []);
  });
}

test('🔴 CONTROL: the checker fires on an unescaped srcdoc, a widened sandbox, and a doubled attribute', () => {
  const payload = PAYLOADS['attribute breakout'];
  const good = '<div class="st-cell"><iframe sandbox="allow-scripts" srcdoc="&lt;b&gt;" title="t" loading="lazy" referrerpolicy="no-referrer"></iframe></div>';
  assert.deepEqual(problems(good, '<b>'), [], 'the checker rejects a correct emission — it would pass nothing');
  const naive = `<div class="st-cell"><iframe sandbox="allow-scripts" srcdoc="${payload}" title="t" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`;
  assert.ok(problems(naive, payload).length, 'an UNESCAPED srcdoc passed — this checker cannot see the attack it exists for');
  const wide = good.replace('allow-scripts', 'allow-scripts allow-same-origin');
  assert.ok(problems(wide, '<b>').some((p) => /sandbox=/.test(p)), 'allow-same-origin passed');
  const twice = good.replace('<iframe ', '<iframe sandbox="allow-scripts allow-same-origin" ');
  assert.ok(problems(twice, '<b>').some((p) => /duplicated/.test(p)), 'a second sandbox attribute passed');
  const amp = good.replace('&lt;b&gt;', '<b>');   // < > unescaped is legal in an attribute, & is the trap
  assert.deepEqual(problems(amp, '<b>'), [], 'the checker is stricter than HTML about < and >');
  const ampLost = good.replace('&lt;b&gt;', '&quot;');
  assert.ok(problems(ampLost, '&quot;').length, 'a `&quot;` decoded to `"` passed as if it were the literal text');
});

test('🔴 the iframe cannot reach the card\'s storage: opaque origin, no navigation, no popups, nothing else', () => {
  const html = render(card('- [ ] %% card: embed w=6 %% <script>localStorage.x=1</script>'));
  const [cell] = cellsOf(html, 'embed');
  const [f] = tagsNamed(cell, 'iframe');
  const sandbox = (f.attrs.find(([n]) => n === 'sandbox') || [])[1];
  assert.deepEqual(sandbox.split(/\s+/), ['allow-scripts']);
  // spelled out, because each of these is one token away and each one is the whole defence
  for (const token of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-forms', 'allow-modals']) {
    assert.ok(!html.includes(token), `${token} appears on the page`);
  }
  assert.ok(!f.attrs.some(([n]) => n === 'allow' || n === 'src' || n === 'name'), 'the iframe carries a src/allow/name it should not');
  // the editor's index attribute must not change the bytes the reader gets (card-render's promise)
  const edit = render(card('- [ ] %% card: embed w=6 %% <script>localStorage.x=1</script>'), { editIndex: true });
  assert.equal(edit.replace(/ data-cell="\d+"/g, '').replace(/<style>[^<]*st-cell-unset[^<]*<\/style>/, ''), html.replace(/<style>[^<]*st-cell-unset[^<]*<\/style>/, ''));
});

// r4: a square embed and the cells packed after it. Every cell is ONE row in the bento pack (`h` is
// retired — no cell declares rows), and the rows are content-sized, so the square's height becomes its
// row's and nothing after it can overlap. These pin the two facts that guarantee it; the overlap
// itself is measured in a real browser by verify/embed-sandbox.mjs (with a pinned-row control).
for (const w of [3, 6]) {
  test(`a w=${w} square embed declares one row like every cell, in content-sized rows`, () => {
    const md = card(`- [ ] %% card: embed w=${w} %% <b>embed</b>`, '- [ ] %% card: link w=3 %% [Right](https://example.com)', '- [ ] %% card: link w=3 %% [Under](https://example.com)');
    const html = render(md);
    const [cell] = cellsOf(html, 'embed');
    assert.match(cell, new RegExp(`^<div class="st-cell st-embed st-embed-html" data-span="${w}x1" data-w="${w}" data-coral-type="embed">`));
    // the rows grow to their tallest cell — a fixed track here is exactly the layout that WOULD overlap
    assert.match(html, /\.st-card \.st-cells\{[^}]*grid-auto-rows:minmax\(var\(--cp-unit\),auto\)!important/);
    assert.match(html, /\.st-card \.st-cell\{grid-row:auto;align-self:start/);
    // and the embed takes its height from its own width, never from a row count or a fixed length
    const css = /<style>([^<]*)<\/style><iframe/.exec(cell)[1];
    assert.match(css, /\.st-card \.st-embed-html\{position:relative;aspect-ratio:1;min-height:0\}/);
    assert.doesNotMatch(css, /grid-row|(?<![-\w])(?:min-)?height:\d+(?:\.\d+)?(?:px|r?em|[sld]?vh)/, 'the embed cell sets its own row span or a fixed height');
    // CONTROL: the same check does fire on a fixed height
    assert.match('.x{height:120px}', /grid-row|(?<![-\w])(?:min-)?height:\d+(?:\.\d+)?(?:px|r?em|[sld]?vh)/);
  });
}

test('an empty embed renders nothing on a live card', () => {
  const html = render(card('- [ ] %% card: embed w=6 %%'));
  assert.equal(cellsOf(html, 'embed').length, 0);
  assert.doesNotMatch(html, /<iframe/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 4. the theme
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** --cp-name → value, the LAST declaration winning, over every `:root{…}` of a css string that is not in an @media */
function rootVars(css) {
  const flat = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const out = {};
  for (const m of flat.matchAll(/:root\{([^}]*)\}/g)) {
    for (const d of m[1].split(';')) {
      const k = d.indexOf(':');
      if (k > 0 && d.slice(0, k).trim().startsWith('--cp-')) out[d.slice(0, k).trim()] = d.slice(k + 1).trim();
    }
  }
  return out;
}

for (const [label, fm] of [['a pinned light card with an accent', 'accent: "#ff6b4a"\ntheme: light'], ['a pinned dark card, no accent', 'theme: dark']]) {
  test(`the embed's :root carries the card's own --cp-* (${label})`, () => {
    const md = ['---', 'title: T', fm, '---', '', '## grid', '', '- [ ] %% card: embed w=6 %% <p>x</p>', ''].join('\n');
    const html = render(md);
    // the page's answer: card.css's :root, then #cp-accent, then #cp-theme — the cascade order
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const page = rootVars(styles.filter((s) => /--cp-/.test(s) && !/st-embed-html/.test(s)).join(''));
    const [cell] = cellsOf(html, 'embed');
    const doc = tagsNamed(cell, 'iframe')[0].attrs.find(([n]) => n === 'srcdoc')[1];
    const inner = rootVars([...doc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join(''));
    assert.ok(Object.keys(page).length >= 14, `the page carries only ${Object.keys(page).length} --cp-* — this is reading the wrong styles`);
    for (const [k, v] of Object.entries(page)) {
      if (k === '--cp-serif') continue;   // a font stack, not a colour of this card
      // whitespace after a comma is not a different colour (card.css is hand-spaced, ours is not)
      const norm = (x) => String(x).replace(/\s*,\s*/g, ',');
      assert.equal(norm(inner[k]), norm(v), `${k}: the embed has ${inner[k]}, the card has ${v}`);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 5. the budget
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('🔴 an embed over the card\'s byte ceiling is refused by name, and never emitted', () => {
  const huge = '<p>' + 'x'.repeat(CARD_MAX_BYTES) + '</p>';
  const md = card('- [ ] %% card: text %% hello', `- [ ] %% card: embed w=6 %% ${huge}`);
  const model = parseCard(md);
  const named = embedsOverCeiling(model, Buffer.byteLength(md));
  assert.equal(named.length, 1);
  assert.match(named[0], /embed/);
  assert.match(named[0], /#2\b/, 'the refusal does not say WHICH cell');
  const html = render(md);
  assert.doesNotMatch(html, /<iframe/, 'an over-ceiling embed was emitted');
  assert.equal(cellsOf(html, 'embed').length, 0);
  // CONTROL: the same card with a small embed names nothing and renders the iframe
  const small = card('- [ ] %% card: text %% hello', '- [ ] %% card: embed w=6 %% <p>x</p>');
  assert.deepEqual(embedsOverCeiling(parseCard(small), Buffer.byteLength(small)), []);
  assert.match(render(small), /<iframe/);
});

test('an over-ceiling card whose bytes are NOT the embed\'s does not blame the embed', () => {
  const md = card('- [ ] %% card: embed w=6 %% <p>x</p>', '- [ ] %% card: text %% ' + 'y'.repeat(CARD_MAX_BYTES));
  assert.deepEqual(embedsOverCeiling(parseCard(md), Buffer.byteLength(md)), []);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// the grammar every door reads
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('the shared definition: `embed` is a body of HTML, `slides` carries the carousel\'s params', () => {
  assert.ok(CELL_TYPES.embed.body, 'embed has no body — there is nowhere to paste');
  assert.deepEqual(Object.keys(CELL_TYPES.embed.params), ['w']);
  assert.deepEqual(Object.keys(CELL_TYPES.slides.params).sort(), ['bg', 'images', 'kind', 'narrow', 'origin', 'w']);
  assert.deepEqual(CELL_TYPES.slides.params.kind.options, ['slider', 'bubbles']);
  assert.ok(PALETTE.includes('slides') && PALETTE.includes('embed'));
  assert.equal(BLANKS.slides.type, 'slides');
  assert.equal(BLANKS.embed.type, 'embed');
  // a new embed is visibly something, and a new slideshow is not mistaken for HTML
  assert.ok(BLANKS.embed.body && /</.test(BLANKS.embed.body));
  assert.equal(parseCard(card(`- [ ] %% card: slides ${BLANKS.slides.rawParams} %%`)).cells[0].type, 'slides');
});

test('🔴 the grammar says an `embed` line with `kind=` is a legacy `slides` — from both entries, and truthfully', async () => {
  const said = { embed: CELL_TYPES.embed.spelling, slides: CELL_TYPES.slides.spelling };
  // An agent reads the STORED word. Told only that `embed` is pasted HTML, it rewrites
  // `embed kind=slider images=…` with embed's fields and the slideshow is gone.
  for (const [type, s] of Object.entries(said)) {
    assert.equal(typeof s, 'string', `${type}: the grammar entry says nothing about the legacy spelling`);
    assert.match(s, /`embed`/, `${type}: does not name the stored word`);
    assert.match(s, /`kind=`/, `${type}: does not name the token that decides it`);
    assert.match(s, /legacy spelling/, `${type}: does not say the spelling is the old one`);
    assert.match(s, /saving it keeps the word `embed`/, `${type}: does not say the spelling survives a save`);
    // classification is not visibility: only two kinds draw anything
    assert.match(s, /draws a slideshow only when `kind` is `slider` or `bubbles`/, `${type}: claims every legacy line is visible`);
    assert.match(s, /\(`kind=""`\), no value \(`kind=`\) or any other value it draws nothing/, `${type}: does not say which legacy lines draw nothing`);
    // the rewrite is NOT equivalent for a kind with no value: `slides` defaults it, the legacy word does not
    assert.match(s, /draws a slider when `kind` has no value/, `${type}: does not say \`slides\` defaults an absent kind`);
    assert.match(s, /makes its images visible/, `${type}: does not say what that rewrite does`);
    assert.match(s, /`origin-narrow` is the older name of `narrow`/, `${type}: does not name the narrow alias`);
    assert.match(s, /when both are present, `narrow` wins/, `${type}: does not say which spelling wins`);
  }
  assert.match(said.embed, /legacy spelling of `slides`/);

  // ...and every claim is what the parser and the renderer do
  const drawn = async (line) => gridOf(await renderCardHTML(legacyCard(line), { handle: 't', cardUrl: 'https://t.example/' }));
  const visible = async (line) => /<img /.test(await drawn(line));
  const IMG = 'images=https://example.test/a.png';

  const old = `- [ ] %% card: embed kind=slider ${IMG} w=6 %%`;
  const read = parseCard(card(old));
  assert.equal(read.cells[0].type, 'slides', 'a legacy line reads as slides');
  assert.ok(serializeCard(read).includes(old), 'saving keeps the word `embed`');
  for (const kind of ['slider', 'bubbles']) {
    assert.ok(await visible(`%% card: embed kind=${kind} ${IMG} %%`), `legacy kind=${kind} draws a slideshow`);
    assert.ok(await visible(`%% card: slides kind=${kind} ${IMG} %%`), `slides kind=${kind} draws the same`);
  }
  for (const kind of ['kind=', 'kind=""', 'kind=unknown']) {
    const line = `%% card: embed ${IMG} ${kind} %%`;
    assert.equal(parseCard(legacyCard(line)).cells[0].type, 'slides', `${kind}: still classified as legacy slides`);
    assert.equal(await visible(line), false, `legacy ${kind} draws nothing`);
  }
  // the one place the rewrite differs: no value under `slides` is a slider
  assert.equal(await visible(`%% card: slides ${IMG} kind= %%`), true, '`slides kind=` draws a slider');
  assert.equal(await visible(`%% card: slides ${IMG} %%`), true, '`slides` with no kind draws a slider');
  assert.equal(await visible(`%% card: slides ${IMG} kind="" %%`), false, '`slides kind=""` draws nothing, like the legacy line');
  assert.equal(await visible(`%% card: slides ${IMG} kind=unknown %%`), false, '`slides kind=unknown` draws nothing, like the legacy line');
  // `origin-narrow` is read, and `narrow` wins by name
  assert.match(await drawn(`%% card: embed kind=bubbles ${IMG} origin-narrow="1% 2%" %%`), /max-width:888px\)\{\.st-carousel figure\{transform-origin:1% 2%\}/);
  assert.match(await drawn(`%% card: embed kind=bubbles ${IMG} origin-narrow="1% 2%" narrow="3% 4%" %%`), /max-width:888px\)\{\.st-carousel figure\{transform-origin:3% 4%\}/);
  // and without `kind=` the word means HTML
  assert.equal(parseCard(card(`- [ ] %% card: embed ${IMG} w=6 %%`)).cells[0].type, 'embed', 'without `kind=` it is HTML');
});
