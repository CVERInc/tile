// COMPOSITION (ai-ops.mjs) — the guide that tells an agent what one tile is for and how much fits on
// it — held to what a browser drew.
//
//   node --test packages/cardtile/ai-ops-composition.test.mjs
//
// Three links, each checked where it can be:
//
//   browser → receipt   w3/deck-composition.smoke.mjs renders real tiles in the three views, measures
//                       them and writes w3/deck-composition.measured.json. It needs a browser, so it
//                       runs with the browser smokes; this file does not.
//   receipt → guide     HERE: every number the guide states is the receipt's, in the guide's own words,
//                       and the guide states no number the receipt does not hold.
//   stylesheet → receipt HERE: the lengths the receipt's numbers follow from (the tile's proportions,
//                       paddings, borders, font sizes, line heights) are read out of the stylesheets and
//                       must equal what the browser resolved, to a twentieth of a px. Change one and
//                       this fails until the smoke has measured again and the guide is rewritten.
//
// 🔴 HOW THE STYLESHEET IS READ. Only rules that apply unconditionally: a rule inside `@media`,
// `@supports` or `@container` is not the base rule and is not read. Where two sheets set one property
// (the tile's border: the base sheet draws one, the Cards sheet takes it off a text tile) the rule
// that wins is named below, and the receipt says what the browser made of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION, CELL_TYPES, PALETTE, OPS, CARD_SETTINGS, GEOMETRY } from './ai-ops.mjs';
import { VIEW_IDS } from './w3/card-settings.mjs';
import { parseCard, serializeCard } from './card-core.js';
import { renderCardHTML } from './serve/card-worker.mjs';
import { CELL_STRINGS_BY_KEY, cellStrings, text } from './w/cell-i18n.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const DECK_CSS = read('w3/deck.css');
const DECK_JS = read('w3/deck.js');
const CARD_CSS = read('serve/card.css');
const RENDER = read('card-render.mjs');
const RECEIPT = JSON.parse(read('w3/deck-composition.measured.json'));
const PROSE_KEYS = Object.keys(COMPOSITION).filter((k) => k !== 'example');
const PROSE = PROSE_KEYS.map((k) => COMPOSITION[k]).join('\n');

// ── reading a stylesheet ─────────────────────────────────────────────────────────────────────────

/** the unconditional rules of a stylesheet as [selectors[], declarations{}]: at-rule blocks are skipped whole */
function baseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    if (!prelude.startsWith('@')) {
      const decl = {};
      for (const d of src.slice(open + 1, j - 1).split(';')) { const k = d.indexOf(':'); if (k > 0) decl[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
      out.push([prelude.replace(/^\}+\s*/, '').split(',').map((s) => s.trim()), decl]);
    }
    i = j;
  }
  return out;
}
/** the declarations a selector ends up with: every base rule that names it exactly, later ones winning */
function styleOf(css, selector) {
  const hit = baseRules(css).filter(([sels]) => sels.includes(selector));
  assert.ok(hit.length, `no base rule for \`${selector}\` — the stylesheet moved and this file is reading nothing`);
  return Object.assign({}, ...hit.map(([, d]) => d));
}
const px = (v, what) => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); assert.ok(m, `${what}: expected a px length, found ${JSON.stringify(v)}`); return Number(m[1]); };
/** `28px 30px` → { v: 28, h: 30 }; one value is both */
const pad = (v, what) => { const p = String(v).trim().split(/\s+/); return { v: px(p[0], what), h: px(p[1] ?? p[0], what) }; };
/** a `font:` shorthand → its line height in px */
const line = (v, what) => { const m = /(?:^|\s)([\d.]+)px\/([\d.]+)(?:\s|$)/.exec(String(v)); assert.ok(m, `${what}: no <size>px/<line-height> in ${JSON.stringify(v)}`); return Math.round(Number(m[1]) * Number(m[2]) * 100) / 100; };
const border = (v, what) => (/^(none|0)\b/.test(String(v).trim()) ? 0 : px(String(v).trim().split(/\s+/)[0], what));

/** the box of a text tile and of a social tile in the stack, for a window of `vw` px, from the sources given */
function derive(deckCss, deckJs, vw, cardCss = CARD_CSS, renderSrc = RENDER) {
  // the tile's shape: every base rule that gives the pile or one of its tiles a ratio
  const shapes = [...new Set(baseRules(deckCss).filter(([sels, d]) => d['aspect-ratio'] && sels.some((s) => /\.deck-(stack|card)$/.test(s))).map(([, d]) => d['aspect-ratio'].replace(/\s+/g, '')))].filter((r) => r !== 'auto');
  const [rw, rh] = (shapes[0] || '0/1').split('/').map(Number);
  const fit = /Math\.min\(1,w\/(\d+)\)/.exec(deckJs);
  assert.ok(fit, 'deck.js no longer zooms a tile by min(1, width / <design width>)');
  // its width in the stack: the share of the window's width the stylesheet gives it (a phone is narrower than it is tall)
  // (the last base rule for it wins: `width:var(--cardw)`, a property the root's base rule sets. The list's narrower
  // --cardw is inside @media, and is the list's: the receipt is the stack's.)
  let width = styleOf(deckCss, 'html.deck .deck-stack').width;
  const named = /^var\((--[\w-]+)\)$/.exec(width);
  if (named) width = styleOf(deckCss, 'html.deck')[named[1]] ?? '';
  const share = /^min\((\d+)vw,/.exec(width);
  assert.ok(share, 'the stack\'s width is no longer min(<n>vw, …)');
  const sideW = vw * Number(share[1]) / 100, sideH = sideW * rh / rw;

  assert.match(cardCss, /\*\{[^}]*box-sizing:border-box/, 'the base sheet no longer sets border-box: every subtraction below is wrong');
  const side = styleOf(deckCss, 'html.deck .deck-face'), front = styleOf(deckCss, 'html.deck .deck-front');
  const sideBorder = border(side.border, 'the side\'s border'), sidePad = pad(front.padding, 'the front\'s padding').v;
  // a tile's border. The base sheet draws one on every tile; the Cards sheet takes it off a text tile with a rule of
  // higher specificity (three classes against one), and nothing in deck.css puts it back.
  const drawn = [...cardCss.matchAll(/(?:^|\})\.st-cell\{[^}]*?border:([^;}]+)/g)].map((m) => m[1]).pop();
  const tileBorder = border(drawn ?? '', 'the tile\'s border');
  const proseBare = /\.st-card \.st-cell\.st-prose\{[^}`]*border:none/.test(renderSrc);
  assert.ok(!baseRules(deckCss).some(([sels, d]) => 'border' in d && sels.some((s) => /\.st-prose$/.test(s))), 'deck.css gives a text tile a border of its own now: read it here');

  const prose = styleOf(deckCss, 'html.deck .deck-front > .st-prose');
  const pp = pad(prose.padding, 'the text tile\'s padding');
  const h5 = styleOf(deckCss, 'html.deck .deck-front > .st-prose h5'), p = styleOf(deckCss, 'html.deck .deck-front > .st-prose p');
  assert.equal(p.margin, '0', 'paragraphs on a tile have a margin now: lines per tile is no longer height / line');
  const box = {
    textW: sideW - 2 * sideBorder - 2 * sidePad - 2 * (proseBare ? 0 : tileBorder) - 2 * pp.h,
    bodyLine: line(p.font, 'the body\'s font'), headLine: line(h5.font, 'the heading\'s font'),
    headGap: px(h5.margin.split(/\s+/)[2] ?? '0px', 'the heading\'s margin'),
    tilePadV: pp.v, tilePadH: pp.h, tileBorder: proseBare ? 0 : tileBorder, sidePad, sideBorder, sideH, sideW,
  };
  const textH = sideH - 2 * sideBorder - 2 * sidePad - 2 * box.tileBorder - 2 * pp.v;
  const lines = (heads) => (textH - (heads ? heads * box.headLine + box.headGap : 0)) / box.bodyLine;

  // a social tile: a column of rows. The row's height is the base rule's; the pile's rule sets none of its own.
  const soc = styleOf(deckCss, 'html.deck .deck-front > .st-social'), btn = styleOf(deckCss, 'html.deck .deck-front > .st-social .st-social-btn');
  assert.ok(!('height' in btn) && !('min-height' in btn), 'a social row on a tile has a height of its own now: read it here');
  const social = { row: px(/\.st-social-btn\{[^}`]*?height:([^;}]+)/.exec(renderSrc)?.[1] ?? '', 'a social button\'s height'), gap: px(soc.gap, 'the social column\'s gap'), pad: pad(soc.padding, 'the social tile\'s padding').v, border: tileBorder };
  const rows = (sideH - 2 * sideBorder - 2 * sidePad - 2 * social.border - 2 * social.pad + social.gap) / (social.row + social.gap);

  return { shapes, design: Number(fit[1]), box, social, room: { bodyOnly: lines(0), head1: lines(1), head2: lines(2), rows } };
}
const D = derive(DECK_CSS, DECK_JS, RECEIPT.viewport[0]);
/** does a derivation agree with the receipt? The first thing that does not, or '' */
function disagrees(d, r = RECEIPT) {
  for (const k of Object.keys(r.box)) if (!(Math.abs(d.box[k] - r.box[k]) <= 0.05)) return `box.${k}: stylesheet ${d.box[k]}, browser ${r.box[k]}`;
  for (const k of ['row', 'gap', 'pad', 'border']) if (d.social[k] !== r.social[k]) return `social.${k}: stylesheet ${d.social[k]}, browser ${r.social[k]}`;
  for (const k of ['bodyOnly', 'head1', 'head2']) if (Math.floor(d.room[k]) !== r.lines[k]) return `lines.${k}: stylesheet ${d.room[k].toFixed(2)}, browser ${r.lines[k]}`;
  if (Math.floor(d.room.rows) !== r.social.rows) return `social rows: stylesheet ${d.room.rows.toFixed(2)}, browser ${r.social.rows}`;
  return '';
}

/** the sentences the receipt's numbers must appear in, word for word */
function claims(r) {
  return {
    unit: ['a portrait 3:4.2 front'],
    text: [
      `In the stack on a phone a tile shows ${r.lines.bodyOnly} body lines (${r.lines.head2} under a two-line heading) of about ${r.perLine.latinBody} Latin or ${r.perLine.cjkBody} CJK characters; more scrolls.`,
      `a heading within ${r.advice.headLatin} Latin or ${r.advice.headCjk} CJK characters, a body within ${r.advice.bodyLatin} or ${r.advice.bodyCjk}.`,
    ],
    pictures: [`16:9 covers about ${r.picture.wide}% of the tile, 3:4 about ${r.picture.tall}%`, 'The wall crops it square unless `w=6`.'],
    links: [`(${r.social.rows} fit, more scroll)`],
    // one column, to the nearest 5 px: an engine that draws its scrollbar over the page has a wall 10 px wider
    wall: [`no \`w\` is one column (about ${Math.round(r.wall.column / 5) * 5} px on a phone)`, '`w=1`…`w=6`'],
  };
}

// ── the numbers ──────────────────────────────────────────────────────────────────────────────────

test('🔴 every number in the guide is the one a browser measured', () => {
  for (const [key, list] of Object.entries(claims(RECEIPT))) {
    for (const s of list) assert.ok(COMPOSITION[key].includes(s), `COMPOSITION.${key} no longer says ${JSON.stringify(s)} — the measurement changed, or the guide did`);
  }
  // and no number is in the guide that the receipt does not hold
  const said = new Set(PROSE.match(/\d+(?:[:.]\d+)*/g) || []);
  const known = new Set(Object.values(claims(RECEIPT)).flat().flatMap((s) => s.match(/\d+(?:[:.]\d+)*/g) || []));
  assert.deepEqual([...said].filter((x) => !known.has(x)), [], 'the guide states a number nothing measured');
  // what it calls "a phone" is the window the receipt was measured in, and the tile there is not zoomed
  assert.deepEqual(RECEIPT.viewport, [390, 844]);
  assert.equal(RECEIPT.engine, 'chromium');
  // the advice is inside what was measured: two heading lines, and half the lines a tile shows under them
  assert.ok(RECEIPT.advice.headLatin <= 2 * RECEIPT.perLine.latinHead && RECEIPT.advice.headCjk <= 2 * RECEIPT.perLine.cjkHead, 'the heading the guide aims for is longer than two measured lines');
  assert.ok(RECEIPT.advice.bodyLatin <= RECEIPT.advice.bodyLines * RECEIPT.perLine.latinBody && RECEIPT.advice.bodyCjk <= RECEIPT.advice.bodyLines * RECEIPT.perLine.cjkBody, 'the body the guide aims for is longer than the lines it was measured to take');
  assert.equal(RECEIPT.advice.bodyLines, RECEIPT.lines.head2 / 2);
});

test('🔴 the stylesheet still gives the box the browser measured, to a twentieth of a px', () => {
  assert.equal(disagrees(D), '');
  assert.deepEqual(D.shapes, ['3/4.2'], 'the stack and the list no longer share one shape — the guide says there is one');
  assert.equal(D.design, 342);
  assert.ok(D.box.sideH > D.box.sideW, 'a front is no longer portrait: "No front is landscape" is false');
  // the precision this is held to: how much of a line is to spare. A line height of 1.6 instead of 1.65 moves the
  // first from 15.25 to 15.72 without moving the line count; the box comparison above is what catches it.
  assert.deepEqual([D.room.bodyOnly, D.room.head1, D.room.head2, D.room.rows].map((x) => x.toFixed(2)), ['15.25', '13.73', '12.59', '7.68']);
  // the stack's width is cut from the window's height by the same proportion, both times it is written
  const cuts = [...DECK_CSS.matchAll(/\(100[ds]vh[^;{}]*?\*\s*(\d+)\s*\/\s*([\d.]+)\)\)/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.ok(cuts.length >= 2 && cuts.every((c) => c === D.shapes[0]), `the width formula and the aspect ratio disagree: ${cuts}`);
  // narrower than the design a tile is zoomed down, never up: the factor is capped at 1
  assert.match(DECK_CSS, /html\.deck \.deck-face > \*\{zoom:var\(--deck-k,1\)\}/);
});

test('CONTROL: a changed shape, line height, type size, padding or row is noticed; a rule inside @media is not read', () => {
  const sub = (css, a, b) => { assert.ok(css.includes(a), `CONTROL: the stylesheet no longer has ${a}`); return css.replace(a, b); };
  const off = (css, js = DECK_JS, render = RENDER) => disagrees(derive(css, js, RECEIPT.viewport[0], CARD_CSS, render));
  assert.match(off(DECK_CSS.replaceAll('aspect-ratio:3/4.2', 'aspect-ratio:1/1')), /sideH/);
  assert.match(off(sub(DECK_CSS, '.st-prose p{font:16px/1.65', '.st-prose p{font:16px/1.6')), /bodyLine/, 'a line height of 1.6 was not noticed');
  assert.match(off(sub(DECK_CSS, '.st-prose p{font:16px/1.65', '.st-prose p{font:18px/1.65')), /bodyLine/);
  assert.match(off(sub(DECK_CSS, '.st-prose h5{font:600 24px/1.25', '.st-prose h5{font:600 24px/1.3')), /headLine/);
  assert.match(off(sub(DECK_CSS, 'justify-content:center;padding:28px 30px;color:var(--cp-ink)}', 'justify-content:center;padding:28px 32px;color:var(--cp-ink)}')), /textW|tilePadH/);
  assert.match(off(sub(DECK_CSS, 'html.deck .deck-front{transform:rotateY(0deg) translateZ(1px);padding:10px}', 'html.deck .deck-front{transform:rotateY(0deg) translateZ(1px);padding:12px}')), /textW|sidePad/);
  assert.match(off(sub(DECK_CSS, 'justify-content:center;gap:14px;padding:28px}', 'justify-content:center;gap:16px;padding:28px}')), /social\.gap/);
  assert.match(off(DECK_CSS, DECK_JS, sub(RENDER, '.st-social-btn{text-decoration:none;width:40px;height:40px', '.st-social-btn{text-decoration:none;width:40px;height:44px')), /social\.row/);
  // the phantom border: were the Cards sheet to stop taking the border off a text tile, the text would be 2 px narrower
  assert.match(off(DECK_CSS, DECK_JS, sub(RENDER, '.st-card .st-cell.st-prose{background:none;border:none;', '.st-card .st-cell.st-prose{background:none;')), /textW|tileBorder/);
  // a rule inside @media is not the base rule: appended last, where it would win a plain text search, it changes nothing
  const inMedia = '@media (max-width:1px){html.deck .deck-front > .st-prose p{font:99px/2 serif;margin:9px}html.deck .deck-front > .st-prose{padding:99px}html.deck .deck-stack{aspect-ratio:1/1}}';
  assert.equal(off(DECK_CSS + inMedia), '');
  assert.equal(baseRules('a{x:1}@media (y){a{x:2}b{x:3}}c{x:4}').map(([s]) => s[0]).join(), 'a,c');
});

// ── what it says the views do ────────────────────────────────────────────────────────────────────

const page = (md) => renderCardHTML(md, { deck: false });
const tile = (l) => page(`---\ntitle: A\n---\n\n## grid\n\n- [ ] %% card: ${l}\n`);
const typesOf = (html) => [...html.matchAll(/<div class="st-cell [^"]*" data-span="[^"]*" data-w="\d"[^>]* data-coral-type="(\w+)"/g)].map((m) => m[1]);
const widthOf = (html) => /<div class="st-cell [^"]*" data-span="[^"]*" data-w="(\d)"/.exec(html)?.[1];

test('the views it names are the three there are; a page opens on the stack, and `view` / `views` are the keys that change it', () => {
  for (const v of VIEW_IDS) assert.ok(PROSE.includes('`' + v + '`'), `the guide does not name \`${v}\``);
  assert.equal(VIEW_IDS.length, 3);
  // in a pile each tile is alone on its own front: the pile's list of tiles is the engine's tiles themselves
  assert.match(DECK_JS, /const tiles=\(\)=>\[\.\.\.document\.querySelectorAll\('main \.st-cells > \.st-cell, /);
  assert.match(DECK_JS, /const dealt=i=>\{ const k=tileCard\(cells\[i\]\);/);
  assert.equal(CARD_SETTINGS.views.values[0], 'stack');
  assert.match(CARD_SETTINGS.view.default, /^The first view in `views`\./);
  assert.deepEqual(CARD_SETTINGS.view.values, ['stack', 'list', 'wall']);
  const fm = (lines) => `---\ntitle: A\n${lines}---\n\n## grid\n\n- [ ] %% card: text %% a\n`;
  assert.match(renderCardHTML(COMPOSITION.example, {}), /<html data-view="stack"/);
  assert.match(renderCardHTML(fm('view: wall\n'), {}), /<html data-view="wall"/);
  assert.match(renderCardHTML(fm('views: stack list\n'), {}), /<html data-view="stack" data-views="stack list"/);
  assert.match(COMPOSITION.presentation, /Leave `view` out so it opens on the stack; `views: stack list` removes the wall\./);
});

test('the wall: no `w` is one column, text is all six whatever it says, and a picture is cropped square unless `w=6`', () => {
  assert.equal(widthOf(tile('link %% [a](https://example.org/)')), '1');
  assert.equal(widthOf(tile('feature img=https://example.org/a.png %%')), '1');
  assert.equal(widthOf(tile('social %% [a](https://instagram.com/a)')), '1');
  assert.equal(widthOf(tile('link w=6 %% [a](https://example.org/)')), '6');
  assert.equal(widthOf(tile('text w=2 %% a')), '6');
  // the wall's rule for a picture, and the one exception to it
  assert.match(RENDER, /`\.st-card \.st-gal-img\{[^`]*aspect-ratio:1;object-fit:cover/);
  assert.match(RENDER, /`\.st-card \[data-w="6"\] \.st-gal-img\{aspect-ratio:auto\}`/);
  // a text tile on the wall has no frame
  assert.match(RENDER, /`\.st-card \.st-cell\.st-prose\{background:none;border:none;/);
  // GEOMETRY says the same of pictures (it said a picture always keeps its own ratio: false below `w=6`)
  assert.match(GEOMETRY.pictures, /^On the wall a picture at `w=6` keeps its own aspect ratio; narrower, it is cropped to a square\. In the stack and list it is always shown whole\./);
});

test('the example is in the serializer\'s form, draws the tiles it shows in order, and keeps the guide\'s own advice', () => {
  const md = COMPOSITION.example;
  assert.equal(serializeCard(parseCard(md)), md);
  assert.deepEqual(parseCard(md).cells.map((c) => c.type), ['profile', 'text', 'text', 'link']);
  assert.deepEqual(typesOf(page(md)), ['profile', 'text', 'text', 'linktile']);
  // the cover: a profile tile shows the file's `title`
  assert.match(page(md), /data-coral-type="profile">[\s\S]*?Why the launch moved[\s\S]*?Product review, March\./);
  // every tile that is not text says `w=6`, as the guide tells an agent to
  for (const c of parseCard(md).cells.filter((x) => x.type !== 'text')) assert.match(c.rawParams, /(^| )w=6( |$)/, `${c.type}: no w=6`);
  for (const c of parseCard(md).cells.filter((x) => x.type === 'text')) {
    const [h, ...rest] = c.body.split('\n');
    assert.match(h, /^### \S/);
    assert.ok(h.length - 4 <= RECEIPT.advice.headLatin, `heading too long for its own guide: ${h}`);
    assert.ok(rest.join(' ').length <= RECEIPT.advice.bodyLatin, `body too long for its own guide: ${rest.join(' ')}`);
  }
});

test('text: `### ` is the large heading, `#` and `##` are not; links, but no pictures and no tables', () => {
  const body = (b) => /data-coral-type="text">(.*?)<\/div>/s.exec(tile('text %%\n' + b.split('\n').map((l) => '\t' + l).join('\n')))[1];
  assert.equal(body('### Big\nline'), '<h5>Big</h5><p>line</p>');
  assert.equal(body('# One\n## Two'), '<h3>One</h3><h4>Two</h4>');
  // on a tile's front only h5 is given the heading's type; h3 and h4 keep the base sheet's small one
  const sized = baseRules(DECK_CSS).filter(([sels]) => sels.some((s) => /\.deck-front > \.st-prose h\d$/.test(s))).flatMap(([sels]) => sels);
  assert.deepEqual([...new Set(sized)], ['html.deck .deck-front > .st-prose h5']);
  assert.match(RENDER, /\.st-prose h3,\.st-prose h4,\.st-prose h5\{[^}]*font-size:\.95rem/);
  assert.match(body('see [the plan](https://example.org/plan)'), /<a [^>]*href="https:\/\/example\.org\/plan"/);
  assert.doesNotMatch(body('![x](https://example.org/a.png)'), /<img/);
  assert.doesNotMatch(body('| a | b |\n|---|---|\n| 1 | 2 |'), /<table/);
  // "more scrolls": the side scrolls, it does not clip
  assert.equal(styleOf(DECK_CSS, 'html.deck .deck-face')['overflow-y'], 'auto');
});

test('a feature is one picture, optionally with a title and a button; in a pile it is shown whole', () => {
  const bare = tile('feature w=6 img=https://example.org/a.png %%');
  assert.equal((bare.match(/<img class="st-gal-img"/g) || []).length, 1);
  const full = tile('feature w=6 img=https://example.org/a.png title=Heading cta=Go href=https://example.org/ %%');
  assert.equal((full.match(/<img class="st-gal-img"/g) || []).length, 1);
  assert.match(full, /Heading[\s\S]*Go/);
  for (const p of ['img', 'title', 'cta']) assert.ok(CELL_TYPES.feature.params[p], `feature has no \`${p}\` param`);
  for (const sel of ['html.deck .deck-front > .st-gal-cell .st-gal-img', 'html.deck .deck-front > .st-gal-cell:not(.st-gal-cell-bare) img.st-gal-img']) {
    assert.equal(styleOf(DECK_CSS, sel)['object-fit'], 'contain', `${sel}: a picture on a front is cropped now`);
  }
  assert.match(RENDER, /const ASSET_RE = \/\^asset:\(\.\+\)\$\//);
});

test('links: one address per link tile; a social tile is labelled rows in a pile and bare icons on the wall', () => {
  const html = tile('link w=6 %% [One](https://example.org/1) [Two](https://example.org/2)');
  assert.equal((html.match(/<a class="st-cell-link/g) || []).length, 1);
  assert.equal(styleOf(DECK_CSS, 'html.deck .deck-front > .st-social')['flex-direction'], 'column');
  // the label is drawn by the pile's rule only: nothing gives a social button a label anywhere else
  const labelled = [...DECK_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*\.st-social-btn::after)\{[^}]*content:attr\(aria-label\)/g)].map((m) => m[1].trim());
  assert.deepEqual(labelled, ['html.deck .deck-front > .st-social .st-social-btn::after']);
  assert.doesNotMatch(RENDER, /\.st-social-btn::after/);
  // not capped: twelve links draw twelve rows
  const twelve = tile('social w=6 %%\n' + Array.from({ length: 12 }, (_, i) => `\t[n${i}](https://example.org/${i})`).join('\n'));
  assert.equal((twelve.match(/class="st-social-btn/g) || []).length, 12);
});

// ── `slides`, and who is told what ───────────────────────────────────────────────────────────────

test('🔴 `slides`: agents are told it is not for presentations; people read what they read before', () => {
  const html = tile('slides kind=slider images=https://example.org/a.png,https://example.org/b.png %% words');
  const cell = /<div class="st-cell st-embed"[^>]*data-coral-type="slides">([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] || '';
  assert.equal((cell.match(/<img /g) || []).length, 2);
  assert.doesNotMatch(cell.replace(/<style>[\s\S]*?<\/style>/, ''), /words/, 'a slides tile draws its body now: it can carry text');
  assert.equal(CELL_TYPES.slides.body, null);
  // the agent-only note: English, on the type, not a key into the editor's strings
  const note = CELL_TYPES.slides.note;
  assert.equal(note.split('. ')[0], 'An image carousel inside one tile; not a way to build a presentation');
  assert.match(note, /COMPOSITION\.presentation/);
  assert.ok(!Object.hasOwn(CELL_STRINGS_BY_KEY, note), 'the note is a key into the editor\'s strings: a person would read it');
  assert.match(COMPOSITION.presentation, /Not `slides`: an image carousel inside one tile, not a way to build a presentation\.$/);
  // what a person reads in the editor is not ours to change, and it is what it was
  assert.equal(text(cellStrings('en'), CELL_TYPES.slides.hint), 'Several pictures, one after another.');
  // no string a person can be shown points at the guide
  for (const [key, byLocale] of Object.entries(CELL_STRINGS_BY_KEY)) {
    for (const [loc, s] of Object.entries(byLocale)) assert.doesNotMatch(String(s), /composition guide|COMPOSITION/i, `${key} (${loc}) is shown to people and points at the agents' guide`);
  }
  // 🔴 the type is NOT renamed: stored files say `slides`
  assert.ok(PALETTE.includes('slides') && 'slides' in CELL_TYPES);
});

// ── its words, and its size ──────────────────────────────────────────────────────────────────────

test('the words are docs/VOCABULARY.md\'s: the unit is a tile, and the retired nouns are not used', () => {
  const rule = read('../../docs/VOCABULARY.md');
  assert.match(rule, /The content unit is a tile, with a front and a back\./);
  assert.match(rule, /Retired inside Cards \(being phased out of code, docs and copy\): the singular noun \*\*card\*\*, \*\*cell\*\*, \*\*deck\*\*/);
  // outside backticks (op names, the stored line marker) and outside the example, which is a file as it is written today
  const plain = PROSE.replace(/`[^`]*`/g, '').replace(/\b[a-z]+_cards\b/g, '');
  assert.deepEqual(plain.match(/\b(?:cards?|cells?|decks?|drawers?|faces?|spreads?)\b/g) || [], [], 'the guide uses a retired noun');
  assert.match(plain, /\bCards\b/);
  assert.match(COMPOSITION.ask, /about how many tiles\./);
  assert.match(COMPOSITION.unit, /each tile has a portrait 3:4\.2 front to itself/);
});

test('every type, op, key and param the guide names exists', () => {
  const ticked = [...PROSE.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const params = Object.keys(CELL_TYPES.feature.params);
  const known = new Set([...PALETTE, ...VIEW_IDS, ...Object.keys(CARD_SETTINGS), ...params, 'w', 'w=1', 'w=6', '### ', '#', '##', 'img=asset:<id>', 'views: stack list']);
  assert.deepEqual(ticked.filter((t) => !known.has(t)), [], 'the guide names something in backticks that is not a type, a view, a setting, a param or a spelling checked above');
  for (const op of PROSE.match(/\b[a-z]+_[a-z]+\b/g) || []) assert.ok(Object.hasOwn(OPS, op), `the guide names \`${op}\`, which is not an op`);
  assert.ok(PROSE.includes('put_asset') && PROSE.includes('preview_cards'));
});

test('the guide is short enough to be read whole: every entry one string, the prose within its budget', () => {
  const keys = ['unit', 'oneIdea', 'text', 'pictures', 'links', 'wall', 'cover', 'presentation', 'notFor', 'ask', 'example'];
  assert.deepEqual(Object.keys(COMPOSITION), keys);
  for (const k of keys) assert.ok(typeof COMPOSITION[k] === 'string' && COMPOSITION[k], k);
  const chars = PROSE_KEYS.reduce((n, k) => n + COMPOSITION[k].length, 0);
  assert.ok(chars <= 1900, `the guide's prose is ${chars} characters: over 1,900 an agent skims it. Cut, do not raise this.`);
  assert.ok(COMPOSITION.example.length <= 400, `the example is ${COMPOSITION.example.length} characters`);
  assert.doesNotMatch(PROSE, /[㐀-鿿]/, 'the guide is English');
});
