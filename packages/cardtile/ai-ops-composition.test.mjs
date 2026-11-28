// COMPOSITION (ai-ops.mjs) — the guide that tells an agent what one tile is for and how much fits on
// it — held to the code that draws a card.
//
//   node --test packages/cardtile/ai-ops-composition.test.mjs
//
// Every number the guide states is DERIVED here from the stylesheet a card is drawn with (w3/deck.css,
// plus the two base rules it sits on) and from w3/deck.js, then looked for in the guide's words. Change
// the card's proportions, its design width, a padding, a font size or a line height, and the number
// derived here moves while the guide's sentence does not: the test fails until the guide is rewritten.
//
// 🔴 WHAT IT DOES NOT PROVE. This is box arithmetic over the CSS as written, not a browser's layout:
// nothing here loads a font. Lines per card follow exactly from heights. Characters per line need a
// glyph width, and that is an ASSUMPTION, named below (LATIN_EM): half an em for an average Latin
// glyph, one em for a CJK one. The guide says "about" for those and only those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION, CELL_TYPES, PALETTE, OPS, CARD_SETTINGS } from './ai-ops.mjs';
import { VIEW_IDS } from './w3/card-settings.mjs';
import { parseCard, serializeCard } from './card-core.js';
import { renderCardHTML } from './serve/card-worker.mjs';
import { cellStrings, text } from './w/cell-i18n.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const DECK_CSS = read('w3/deck.css');
const DECK_JS = read('w3/deck.js');
const CARD_CSS = read('serve/card.css');
const RENDER = read('card-render.mjs');

/** an average Latin glyph, in ems of its font size. The one assumption in this file. */
const LATIN_EM = 0.5;

// ── reading the stylesheet ───────────────────────────────────────────────────────────────────────

/** every rule of a stylesheet as [selectors[], declarations{}], comments and at-rule wrappers dropped */
function rules(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    const decl = {};
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':');
      if (k > 0) decl[d.slice(0, k).trim()] = d.slice(k + 1).trim();
    }
    out.push([sel.split(',').map((s) => s.trim()), decl]);
  }
  return out;
}
/** the declarations a selector ends up with: every rule that names it exactly, later ones winning */
function styleOf(css, selector) {
  const hit = rules(css).filter(([sels]) => sels.includes(selector));
  assert.ok(hit.length, `no rule for \`${selector}\` — the stylesheet moved and this file is measuring nothing`);
  return Object.assign({}, ...hit.map(([, d]) => d));
}
const px = (v, what) => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); assert.ok(m, `${what}: expected a px length, found ${JSON.stringify(v)}`); return Number(m[1]); };
/** `28px 30px` → { v: 28, h: 30 }; one value is both */
const pad = (v, what) => { const p = String(v).trim().split(/\s+/); return { v: px(p[0], what), h: px(p[1] ?? p[0], what) }; };
/** a `font:` shorthand → { size, line } in px */
const font = (v, what) => { const m = /(?:^|\s)([\d.]+)px\/([\d.]+)(?:\s|$)/.exec(String(v)); assert.ok(m, `${what}: no <size>px/<line-height> in ${JSON.stringify(v)}`); return { size: Number(m[1]), line: Number(m[1]) * Number(m[2]) }; };
const border = (v, what) => px(String(v).trim().split(/\s+/)[0], what);

// ── the derivation ───────────────────────────────────────────────────────────────────────────────

/** everything the guide states as a number, from the sources given */
function derive(deckCss, deckJs, cardCss = CARD_CSS, renderSrc = RENDER) {
  // the card: its proportions, and the width it is designed at
  const ratios = new Set();
  for (const [sels, d] of rules(deckCss)) {
    if (d['aspect-ratio'] && sels.some((s) => /\.deck-(stack|card)$/.test(s))) ratios.add(d['aspect-ratio'].replace(/\s+/g, ''));
  }
  const shapes = [...ratios].filter((r) => r !== 'auto');
  const fit = /Math\.min\(1,w\/(\d+)\)/.exec(deckJs);
  assert.ok(fit, 'deck.js no longer scales a card by min(1, width / <design width>)');
  const width = Number(fit[1]);
  const [rw, rh] = (shapes[0] || '0/1').split('/').map(Number);
  const height = width * rh / rw;

  // the side of a card, and the tile on it. `*{box-sizing:border-box}` is the base sheet's.
  assert.match(cardCss, /\*\{[^}]*box-sizing:border-box/, 'the base sheet no longer sets border-box: every subtraction below is wrong');
  const face = styleOf(deckCss, 'html.deck .deck-face');
  const front = styleOf(deckCss, 'html.deck .deck-front');
  const fb = border(face.border, 'the side\'s border'), fp = pad(front.padding, 'the front\'s padding');
  const innerW = width - 2 * fb - 2 * fp.h, innerH = height - 2 * fb - 2 * fp.v;
  // a tile's own border: the base rule's. Some tiles drop it; keeping it is the smaller box.
  const cellBorder = border(/\.st-cell\{[^}]*?border:([^;}]+)/.exec(cardCss)?.[1] ?? '', 'the tile\'s border');

  // a text tile on a card
  const prose = styleOf(deckCss, 'html.deck .deck-front > .st-prose');
  const pp = pad(prose.padding, 'the text tile\'s padding');
  const h5 = styleOf(deckCss, 'html.deck .deck-front > .st-prose h5');
  const p = styleOf(deckCss, 'html.deck .deck-front > .st-prose p');
  const head = font(h5.font, 'the heading\'s font'), body = font(p.font, 'the body\'s font');
  const headGap = pad(h5.margin.split(/\s+/).slice(2).join(' ') || '0px', 'the heading\'s margin').v;
  assert.equal(pad(p.margin.replace(/^0$/, '0px'), 'the paragraph\'s margin').v, 0, 'paragraphs on a card have a margin now: lines per card is no longer height / line');
  const textW = innerW - 2 * cellBorder - 2 * pp.h, textH = innerH - 2 * cellBorder - 2 * pp.v;
  const bodyLines = (headLines) => Math.floor((textH - (headLines ? headLines * head.line + headGap : 0)) / body.line);
  const tens = (n) => Math.floor(n / 10) * 10;

  // a social tile on a card: a column of rows
  const social = styleOf(deckCss, 'html.deck .deck-front > .st-social');
  const row = styleOf(deckCss, 'html.deck .deck-front > .st-social .st-social-btn');
  assert.ok(!('height' in row) && !('min-height' in row), 'a social row on a card has a height of its own now: re-derive how many fit');
  const rowH = px(/\.st-social-btn\{[^}`]*?height:([^;}]+)/.exec(renderSrc)?.[1] ?? '', 'a social button\'s height');
  const gap = px(social.gap, 'the social column\'s gap'), sp = pad(social.padding, 'the social tile\'s padding');
  const socialRows = Math.floor((innerH - 2 * cellBorder - 2 * sp.v + gap) / (rowH + gap));

  return {
    shapes, width, height,
    bodyOnly: bodyLines(0), headLinesMax: 2, bodyWithHead: bodyLines(2),
    bodyLatin: tens(textW / (body.size * LATIN_EM)), bodyCjk: Math.floor(textW / body.size),
    headLatin: tens(textW / (head.size * LATIN_EM)), headCjk: Math.floor(textW / head.size),
    socialRows,
    // a 16:9 picture shown whole across the side, as a share of the side's height, to the nearest 10%
    wide: Math.round((innerW * 9 / 16) / innerH * 10) * 10,
  };
}

/** the sentences those numbers must appear in, word for word */
function claims(n) {
  const [rw, rh] = (n.shapes[0] || '').split('/');
  const half = Math.floor(n.bodyWithHead / 2);
  return {
    unit: [`${rw}:${rh}`, `designed ${n.width} px wide`],
    text: [
      `A card shows ${n.bodyOnly} body lines, or a heading of up to ${n.headLinesMax} lines plus ${n.bodyWithHead}`,
      `a body line holds about ${n.bodyLatin} Latin or ${n.bodyCjk} CJK characters`,
      `a heading line about ${n.headLatin} or ${n.headCjk}`,
      `a heading under ${n.headLatin * n.headLinesMax} characters`,
      `at most ${half} body lines.`,
    ],
    pictures: [`a 16:9 picture fills about ${n.wide}% of the card`],
    links: [`lists up to ${n.socialRows} links on one card`],
  };
}

const N = derive(DECK_CSS, DECK_JS);

// ── the numbers ──────────────────────────────────────────────────────────────────────────────────

test('🔴 a card is one portrait shape, and the guide states that shape and its design width', () => {
  assert.deepEqual(N.shapes, ['3/4.2'], 'the stack and the list no longer share one card shape — the guide says there is one');
  assert.equal(N.width, 342);
  assert.ok(N.height > N.width, 'a card is no longer portrait: "There is no landscape card" is false');
  // the stack's width is cut from the viewport's height by the same proportion, both times it is written
  const cuts = [...DECK_CSS.matchAll(/\(100[ds]vh[^;{}]*?\*\s*(\d+)\s*\/\s*([\d.]+)\)\)/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.ok(cuts.length >= 2 && cuts.every((c) => c === N.shapes[0]), `the width formula and the aspect ratio disagree: ${cuts}`);
  assert.match(COMPOSITION.unit, /There is no landscape card\./);
  // "scaled down on narrower screens": the factor is capped at 1, so a wider card is not enlarged
  assert.match(DECK_JS, /Math\.min\(1,w\/342\)/);
  assert.match(DECK_CSS, /html\.deck \.deck-face > \*\{zoom:var\(--deck-k,1\)\}/);
});

test('🔴 every number in the guide is the one derived from the stylesheet', () => {
  for (const [key, list] of Object.entries(claims(N))) {
    for (const s of list) assert.ok(COMPOSITION[key].includes(s), `COMPOSITION.${key} no longer says ${JSON.stringify(s)} — the card changed, or the guide did`);
  }
  // and no number is in the guide that this file did not derive or pin on purpose
  const said = new Set(Object.entries(COMPOSITION).filter(([k]) => k !== 'example').flatMap(([, v]) => v.match(/\d+(?:[:.]\d+)*/g) || []));
  const known = new Set(Object.values(claims(N)).flat().flatMap((s) => s.match(/\d+(?:[:.]\d+)*/g) || []));
  assert.deepEqual([...said].filter((x) => !known.has(x)), [], 'the guide states a number nothing derives');
});

test('the derived numbers are the ones this file was written against (a change here is a change to the guide)', () => {
  assert.deepEqual(
    { ...N, height: Math.round(N.height * 10) / 10 },
    { shapes: ['3/4.2'], width: 342, height: 478.8, bodyOnly: 15, headLinesMax: 2, bodyWithHead: 12, bodyLatin: 30, bodyCjk: 16, headLatin: 20, headCjk: 10, socialRows: 7, wide: 40 },
  );
});

test('CONTROL: a different card shape, design width or type size derives different numbers, and the guide fails them', () => {
  const fails = (n) => Object.entries(claims(n)).some(([k, list]) => list.some((s) => !COMPOSITION[k].includes(s)));
  assert.equal(fails(N), false, 'CONTROL: the real sources fail too — this control proves nothing');
  const square = derive(DECK_CSS.replaceAll('aspect-ratio:3/4.2', 'aspect-ratio:1/1'), DECK_JS);
  assert.deepEqual(square.shapes, ['1/1']);
  assert.ok(square.bodyOnly < N.bodyOnly && fails(square), 'a square card was not noticed');
  const wider = derive(DECK_CSS, DECK_JS.replace('Math.min(1,w/342)', 'Math.min(1,w/400)'));
  assert.ok(wider.width === 400 && fails(wider), 'a wider design width was not noticed');
  const bigger = derive(DECK_CSS.replace('.st-prose p{font:16px/1.65', '.st-prose p{font:18px/1.65'), DECK_JS);
  assert.ok(bigger.bodyOnly < N.bodyOnly && fails(bigger), 'larger body type was not noticed');
  const roomier = derive(DECK_CSS.replace('.deck-front > .st-prose{display:flex;flex-direction:column;justify-content:center;padding:28px 30px', '.deck-front > .st-prose{display:flex;flex-direction:column;justify-content:center;padding:48px 30px'), DECK_JS);
  assert.ok(roomier.bodyOnly < N.bodyOnly && fails(roomier), 'more padding was not noticed');
});

// ── what it says a card is ───────────────────────────────────────────────────────────────────────

const page = (md) => renderCardHTML(md, { deck: false });
const tile = (line) => page(`---\ntitle: A\n---\n\n## grid\n\n- [ ] %% card: ${line}\n`);
const typesOf = (html) => [...html.matchAll(/<div class="st-cell [^"]*" data-span="[^"]*" data-w="\d"[^>]* data-coral-type="(\w+)"/g)].map((m) => m[1]);

test('the views it names are the three there are, and a pile is one tile per card', () => {
  for (const v of VIEW_IDS) assert.ok(COMPOSITION.unit.includes('`' + v + '`'), `COMPOSITION.unit does not name \`${v}\``);
  assert.equal(VIEW_IDS.length, 3);
  // deck.js makes one card of each tile the engine drew: its list of tiles is the cells themselves
  assert.match(DECK_JS, /const tiles=\(\)=>\[\.\.\.document\.querySelectorAll\('main \.st-cells > \.st-cell, /);
  assert.match(DECK_JS, /const dealt=i=>\{ const k=tileCard\(cells\[i\]\);/);
  // …and it opens on the stack unless the file says otherwise
  assert.equal(CARD_SETTINGS.views.values[0], 'stack');
  assert.match(CARD_SETTINGS.view.default, /^The first view in `views`\./);
  assert.match(renderCardHTML(COMPOSITION.example, {}), /<html data-view="stack"/);
});

test('the example is in the serializer\'s form, and draws the tiles it shows in the order it shows them', () => {
  const md = COMPOSITION.example;
  assert.equal(serializeCard(parseCard(md)), md);
  assert.deepEqual(parseCard(md).cells.map((c) => c.type), ['profile', 'text', 'text', 'link']);
  assert.deepEqual(typesOf(page(md)), ['profile', 'text', 'text', 'linktile']);
  // the cover: a profile tile shows the file's `title`
  assert.match(page(md), /data-coral-type="profile">[\s\S]*?Why the launch moved[\s\S]*?Product review, March\./);
  // its text tiles keep the guide's own advice: a heading under the limit, a body within half a card
  for (const c of parseCard(md).cells.filter((x) => x.type === 'text')) {
    const [h, ...rest] = c.body.split('\n');
    assert.match(h, /^### \S/);
    assert.ok(h.length - 4 < N.headLatin * N.headLinesMax, `heading too long for its own guide: ${h}`);
    assert.ok(rest.join(' ').length <= Math.floor(N.bodyWithHead / 2) * N.bodyLatin, `body too long for its own guide: ${rest.join(' ')}`);
  }
});

test('text: `### ` is the large heading, `#` and `##` are not; no pictures, no tables', () => {
  const body = (b) => /data-coral-type="text">(.*?)<\/div>/s.exec(tile('text %%\n' + b.split('\n').map((l) => '\t' + l).join('\n')))[1];
  assert.equal(body('### Big\nline'), '<h5>Big</h5><p>line</p>');
  assert.equal(body('# One\n## Two'), '<h3>One</h3><h4>Two</h4>');
  // on a card only h5 is given the heading's type; h3 and h4 keep the base sheet's small one
  const sized = rules(DECK_CSS).filter(([sels]) => sels.some((s) => /\.deck-front > \.st-prose h\d$/.test(s))).flatMap(([sels]) => sels);
  assert.deepEqual([...new Set(sized)], ['html.deck .deck-front > .st-prose h5']);
  assert.match(RENDER, /\.st-prose h3,\.st-prose h4,\.st-prose h5\{[^}]*font-size:\.95rem/);
  assert.doesNotMatch(body('![x](https://example.org/a.png)'), /<img/);
  assert.doesNotMatch(body('| a | b |\n|---|---|\n| 1 | 2 |'), /<table/);
  // "More than that scrolls inside the card": the side scrolls, it does not clip
  assert.equal(styleOf(DECK_CSS, 'html.deck .deck-face')['overflow-y'], 'auto');
});

test('pictures: a feature is one picture, shown whole on a card; `asset:` and a URL both draw', () => {
  const one = tile('feature img=https://example.org/a.png %%');
  assert.equal((one.match(/<img class="st-gal-img"/g) || []).length, 1);
  for (const sel of ['html.deck .deck-front > .st-gal-cell .st-gal-img', 'html.deck .deck-front > .st-gal-cell:not(.st-gal-cell-bare) img.st-gal-img']) {
    assert.equal(styleOf(DECK_CSS, sel)['object-fit'], 'contain', `${sel}: a picture on a card is cropped now`);
  }
  assert.match(RENDER, /const ASSET_RE = \/\^asset:\(\.\+\)\$\//);
  assert.ok(CELL_TYPES.feature.params.img, 'feature has no `img` param');
});

test('links: one address per link tile; a social tile is a column of labelled rows on a card', () => {
  const html = tile('link w=6 %% [One](https://example.org/1) [Two](https://example.org/2)');
  assert.equal((html.match(/<a class="st-cell-link/g) || []).length, 1);
  const social = styleOf(DECK_CSS, 'html.deck .deck-front > .st-social');
  assert.equal(social['flex-direction'], 'column');
  assert.match(styleOf(DECK_CSS, 'html.deck .deck-front > .st-social .st-social-btn::after').content, /attr\(aria-label\)/);
});

test('`slides` draws pictures and nothing else, and its description says so first', () => {
  const html = tile('slides kind=slider images=https://example.org/a.png,https://example.org/b.png %% words');
  const cell = /<div class="st-cell st-embed"[^>]*data-coral-type="slides">([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] || '';
  assert.equal((cell.match(/<img /g) || []).length, 2);
  assert.doesNotMatch(cell.replace(/<style>[\s\S]*?<\/style>/, ''), /words/, 'a slides tile draws its body now: it can carry text');
  assert.equal(CELL_TYPES.slides.body, null);
  // the words describe_card_grammar gives an agent for this type: the hint, in English
  const hint = text(cellStrings('en'), CELL_TYPES.slides.hint);
  assert.equal(hint.split('. ')[0], 'An image carousel inside one tile, not a way to build a presentation');
  assert.match(hint, /composition guide/);
  assert.match(COMPOSITION.presentation, /`slides` is not for this: it is an image carousel inside one tile\./);
  // 🔴 the type is NOT renamed: stored files say `slides`
  assert.ok(PALETTE.includes('slides') && 'slides' in CELL_TYPES);
});

test('every type, op, key and param the guide names exists', () => {
  const prose = Object.entries(COMPOSITION).filter(([k]) => k !== 'example').map(([, v]) => v).join(' ');
  const ticked = [...prose.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const known = new Set([...PALETTE, ...VIEW_IDS, ...Object.keys(CARD_SETTINGS), '### ', '#', '##', 'img=asset:<id>']);
  assert.deepEqual(ticked.filter((t) => !known.has(t)), [], 'the guide names something in backticks that is not a type, a view, a setting or a spelling checked above');
  for (const op of prose.match(/\b[a-z]+_[a-z]+\b/g) || []) assert.ok(Object.hasOwn(OPS, op), `the guide names \`${op}\`, which is not an op`);
  assert.ok(prose.includes('put_asset') && prose.includes('preview_cards'));
});

// ── its size ─────────────────────────────────────────────────────────────────────────────────────

test('the guide is short enough to be read whole: every entry one string, the prose within its budget', () => {
  const keys = ['unit', 'oneIdea', 'text', 'pictures', 'links', 'cover', 'presentation', 'notFor', 'ask', 'example'];
  assert.deepEqual(Object.keys(COMPOSITION), keys);
  for (const k of keys) assert.ok(typeof COMPOSITION[k] === 'string' && COMPOSITION[k], k);
  const prose = keys.filter((k) => k !== 'example').map((k) => COMPOSITION[k]).join('\n');
  assert.ok(prose.length <= 1800, `the guide's prose is ${prose.length} characters: over 1,800 an agent skims it. Cut, do not raise this.`);
  assert.ok(COMPOSITION.example.length <= 400, `the example is ${COMPOSITION.example.length} characters`);
  assert.doesNotMatch(prose, /[㐀-鿿]/, 'the guide is English');
});
