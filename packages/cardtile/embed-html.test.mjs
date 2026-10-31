// reef#2725 — `embed` means "paste HTML" now, and the carousel that borrowed the name is `slides`.
//
// What this file pins, in the order the spec says it (reef#2725 「embed 正式版規格」, chodaict 10-31):
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
import { parseCard, serializeCard, CARD_MAX_BYTES, embedsOverCeiling } from './card-core.js';
import { renderCardHTML } from './serve/card-worker.mjs';
import { CELL_TYPES, PALETTE, BLANKS } from './ai-ops.mjs';

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

test('an old `embed kind=slider|bubbles` renders exactly what the same cell renders as `slides`', () => {
  for (const params of [
    'w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png,https://i.example/3.png"',
    'w=6 kind=slider images="https://i.example/1.png"',
    'bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" origin="10% 20%" narrow="30% 40%" bg=https://i.example/bg.png',
    'kind=bubbles images=https://i.example/1.png origin-narrow="1% 2%"',
  ]) {
    const old = render(card(`- [ ] %% card: embed ${params} %%`));
    const now = render(card(`- [ ] %% card: slides ${params} %%`));
    assert.equal(old, now, `embed ${params} renders differently from slides ${params}`);
    assert.equal(cellsOf(old, 'slides').length, 1, `embed ${params} rendered no carousel at all`);
    assert.doesNotMatch(old, /<iframe/, 'a carousel became an iframe');
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
