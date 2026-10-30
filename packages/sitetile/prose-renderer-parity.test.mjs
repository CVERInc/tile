// One `prose` body, two renderers, one structure.
//   run: node packages/sitetile/prose-renderer-parity.test.mjs
//
// This engine renders a section twice: `astro/src/components/sections/*.astro` builds the pages a
// site ships, and `renderSection` in site-core.js returns the same section as a string — the
// "reference render" an editor previews with and a tool reads to say what a CSS selector matches.
//
// 🩸 For `prose` they disagreed. `Prose.astro` lifted every paragraph that was only an image into
// one trailing `.st-prose-imgs`, and every paragraph that was only links into a `.st-prose-btns`
// row; the string renderer left each image where it was written, as a `figure.st-figure`, and the
// links as a paragraph. A count taken from the string render (`.st-figure` → 2) described a page
// whose visitors were served zero of them. Nothing fed one body to both, so nothing was red.
//
// CVERInc/tile#120 made them agree by moving every standalone image to one trailing
// `.st-prose-imgs` and every links-only paragraph to one row before it — in both renderers.
// CVERInc/reef#1933 (S6, chodaict's ruling) puts them back where the author wrote them: an
// images-only paragraph is a `figure.st-figure` in place (several images in one paragraph = one
// figure holding them all), a links-only paragraph is a `.st-prose-btns` row in place, and there
// is no `.st-prose-imgs` at all. The paragraphs are the ones `bodyHtml` already finds, so a fenced
// code block or a list is never cut up by a blank line inside it — the old split ran a blank-line
// regex over the raw body and lifted a link line out of the middle of a code fence.
//
// 🔴 Three kinds of assertion, because each alone has a way of staying green:
//   · parity (Astro == string) is silent when both are wrong the same way — and they now share
//     `proseBodyHtml`, so "the same way" is the likeliest way;
//   · the written-out expectation below is derived from neither renderer, which is what catches a
//     shared mistake — but it is checked against each renderer separately;
//   · the plain-prose control proves the comparison can see a section that takes NO split, so a
//     harness that matched nothing would not pass as "identical".
//
// The Astro half builds a real page and is SKIPPED without packages/sitetile/astro/node_modules;
// the string half and the source check on `Prose.astro` run regardless.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionSource } from './section-source.mjs';
import { bodyHtml, parseSite, proseBodyHtml, renderSiteToHtml } from './site-core.js';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..');

console.log('prose-renderer-parity');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ── a tree, so "which container is this image in" is a question about parents and not a regex ──
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
function parseHtml(html) {
  const root = { tag: '#root', cls: [], attrs: {}, kids: [], parent: null, text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/gi;
  let at = 0, m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    top.text += html.slice(at, m.index);
    at = re.lastIndex;
    if (m[1]) {
      const t = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === t) { stack.length = k; break; }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(), attrs = {};
    for (const a of m[3].matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const node = { tag, cls: (attrs.class || '').split(/\s+/).filter(Boolean), attrs, kids: [], parent: top, text: '' };
    top.kids.push(node);
    if (VOID.has(tag) || m[4]) continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf('</' + tag, at);
      at = re.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    stack.push(node);
  }
  return root;
}
const all = (n, out = []) => { for (const k of n.kids) { out.push(k); all(k, out); } return out; };
const sig = (n) => n.tag + n.cls.map((c) => '.' + c).join('');
const textOf = (n) => (n.text + n.kids.map(textOf).join('')).replace(/\s+/g, ' ').trim();

// What a section IS, as far as this test is concerned. Every field is read off the tree.
function facts(section) {
  const nodes = all(section);
  const counts = {};
  for (const n of nodes) for (const c of n.cls) counts[c] = (counts[c] || 0) + 1;
  return {
    children: section.kids.map(sig),
    // document order — the ORDER of the images is half of what went wrong
    images: nodes.filter((n) => n.tag === 'img').map((n) => ({ src: n.attrs.src, alt: n.attrs.alt, in: sig(n.parent) })),
    buttonRows: nodes.filter((n) => n.cls.includes('st-prose-btns'))
      .map((row) => row.kids.map((b) => ({ tag: b.tag, cls: b.cls.join(' '), href: b.attrs.href ?? null, label: textOf(b) }))),
    // what each figure holds, element by element — "one figure with two images" vs "two figures"
    figures: nodes.filter((n) => n.tag === 'figure').map((f) => f.kids.map(sig)),
    counts,
  };
}
function sectionsById(html) {
  const out = new Map();
  for (const n of all(parseHtml(html))) if (n.tag === 'section' && n.attrs.id) out.set(n.attrs.id, n);
  return out;
}
// The section's markup between its own tags, with the whitespace an Astro template leaves between
// its expressions taken out. What remains is attribute-for-attribute what each renderer wrote.
function innerHtml(html, id) {
  const open = new RegExp(`<section\\b[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  return html.slice(from, html.indexOf('</section>', from)).replace(/>\s+</g, '><').trim();
}

// ── the fixture ─────────────────────────────────────────────────────────────────────────────
// 🔴 NON-UNIFORM ON PURPOSE. Every image has its own src and alt and every link its own label, so
// a renderer that drops one, repeats one or reverses two cannot produce the same list by accident.
const MIXED = [
  'Opening paragraph with an inline ![dot](/img/dot.png) image.',
  '![First alone](/img/first.png)',
  'A middle paragraph, which the first image was written ABOVE.',
  '[Read on](/more) · [Elsewhere](https://example.com/elsewhere)',
  '- a list item carrying ![in a list](/img/list.png)\n- a second item',
  '![Second alone](/img/second.jpg)',
  // The grammar has no image title. Both renderers must agree on what this is — and it is not an image.
  '![Titled](/img/titled.png "A title")',
  '![Pair left](/img/pair-left.png) ![Pair right](/img/pair-right.png)',
  'Closing paragraph.',
].join('\n\n');

const ESC_TITLE = 'Salt & <pepper> "twice"，全形。';
const ESC_EYEBROW = 'Tea & <milk> > sugar，全形。';

const SECTIONS = [
  // First, so that no section under test is the page's primary heading: the built page gives the
  // first section an <h1>, the string renderer has no notion of position. Not this file's subject.
  ['Lead', '', 'A first section, so nothing below is the page\'s h1.'],
  ['Mixed', '', MIXED],
  ['Plain', '', 'Only text, with a [link](/inline) inside a sentence and an inline ![dot](/img/plain-dot.png).\n\n- one\n- two\n\nEnd.'],
  ['Images only', '', 'Before.\n\n![Solo](/img/solo.png)\n\nAfter.'],
  ['Links only', '', 'Before.\n\n[Only link](/only)\n\nAfter.'],
  ['Back link', '', 'Before.\n\n[Back to the index](/index)'],
  ['Dressed', '%% sitetile: prose eyebrow="A label" surface=cream align=left %%', 'Text.\n\n![Dressed image](/img/dressed.png)'],
  // `ordered` numbers its clauses and takes no split: its image stays a figure, in place, in both.
  ['Ordered', '%% sitetile: prose ordered %%', 'Lead.\n\n### First clause\nBody.\n\n![Clause figure](/img/clause.png)'],
  // 🔴 Escaping. After the split the only markup a renderer still writes for itself is the section
  // tag, the eyebrow and the title, and every title and eyebrow above is plain letters — so a
  // renderer that stopped escaping either would have stayed green. These two carry `&`, `<`, `>`
  // and full-width punctuation (and the title a `"` too; the eyebrow cannot, its value is quoted).
  [ESC_TITLE, '', 'Body.'],
  ['Eyebrow escaping', `%% sitetile: prose eyebrow="${ESC_EYEBROW}" %%`, 'Body.'],
  // The #1933 S6 fixture, verbatim from the plan: every kind of standalone paragraph, interleaved.
  ['In place', '', 'intro\n\n![a](/1.png)\n\nmiddle\n\n[A](/a) · [B](/b)\n\n![b](/2.png)![c](/3.png)\n\nend'],
  // A row written straight after an image stays after it — and each row is its own row, with its
  // own first (primary) button, not one merged row.
  ['Row after image', '', '![Lead image](/img/lead.png)\n\n[Go](/go) · [More](https://example.com/more)\n\nBetween.\n\n[Second row](/second)'],
  // 🔴 A fence with blank lines, a links-only line and an images-only line inside it is CODE. The
  // old blank-line split lifted `[A](/a)` into the button row and `![x]` into the image group.
  ['Fenced', '', 'Intro.\n\n```\ncode\n\n[A](/a)\n\n![x](/x.png)\n\nmore\n```\n\nAfter.'],
  // A loose list (blank lines between items) with a links-only paragraph inside the run: the row
  // stays between the items it was written between.
  ['Loose list', '', '- one\n\n- two\n\n[Mid list](/mid)\n\n- three'],
  // Three images in one paragraph: ONE figure holding three images.
  ['Trio', '', 'Team.\n\n![t1](/img/t1.png)![t2](/img/t2.png)![t3](/img/t3.png)'],
  // 🔴 The shape a real site writes (wtg, reef#1933 inventory): eight images, ONE PER LINE, single
  // newlines, one paragraph. One figure whose children are eight ADJACENT images — no <br>, no
  // whitespace text between them — or `> .st-img ~ .st-img`, `:first-child` and a lightbox's
  // `querySelectorAll('.st-prose .st-figure .st-img')` all see something else.
  ['Eight lines', '', 'Shots.\n\n' + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `![w${n}](/img/w${n}.png)`).join('\n')],
  // CONTROL: a HARD break (two trailing spaces) is the author asking for a line break, so this is a
  // paragraph — <p><img><br><img></p> — not a figure (and so never the hero's avatar row).
  ['Hard break', '', '![h1](/img/h1.png)  \n![h2](/img/h2.png)'],
  // CONTROL: the same images with a blank line between are two paragraphs, so two figures.
  ['Two figures', '', '![x1](/img/x1.png)\n\n![x2](/img/x2.png)'],
  // tile#148: a YouTube line is the click-to-play block in place — not a button row (it IS a
  // links-only paragraph), and its neighbours keep theirs: a labelled YouTube link is still a row.
  ['YouTube line', '', 'Watch.\n\n[https://www.youtube.com/watch?v=dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\nhttps://youtu.be/K9j8H7g6F5d?t=30\n\n[Watch it there](https://youtu.be/K9j8H7g6F5d)'],
];
const MD = '---\nsitetile-page: home\ntitle: Prose parity\nlang: en-US\n---\n\n'
  + SECTIONS.map(([title, marker, body]) => `## ${title}\n${marker ? marker + '\n' : ''}${body}\n`).join('\n');

const site = parseSite(MD);
const idOf = (title) => site.sections[SECTIONS.findIndex(([t]) => t === title)].id;

// ── what the page must be, written out by hand and derived from neither renderer ────────────
const img = (src, alt, container) => ({ src, alt, in: container });
const FIG = 'figure.st-figure';
const IMG = 'img.st-img';
const btn = (label, href) => [label, href, 'st-prose-btn st-prose-btn-primary'];
const btn2 = (label, href) => [label, href, 'st-prose-btn st-prose-btn-secondary'];
// `rows` = every `.st-prose-btns` row in document order; `figures` = every figure's children.
const EXPECTED = {
  Mixed: {
    children: ['h2', 'p', FIG, 'p', 'div.st-prose-btns', 'ul.st-list', FIG, 'p', FIG, 'p'],
    images: [
      img('/img/dot.png', 'dot', 'p'),
      img('/img/first.png', 'First alone', FIG),
      img('/img/list.png', 'in a list', 'li'),
      img('/img/second.jpg', 'Second alone', FIG),
      img('/img/pair-left.png', 'Pair left', FIG),
      img('/img/pair-right.png', 'Pair right', FIG),
    ],
    rows: [[btn('Read on', '/more'), btn2('Elsewhere', 'https://example.com/elsewhere')]],
    figures: [[IMG], [IMG], [IMG, IMG]],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 1, 'st-prose-btn': 2, 'st-figure': 3, 'st-img': 6 },
  },
  Plain: {
    children: ['h2', 'p', 'ul.st-list', 'p'],
    images: [img('/img/plain-dot.png', 'dot', 'p')],
    rows: [], figures: [],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 0, 'st-figure': 0, 'st-img': 1 },
  },
  'Images only': {
    children: ['h2', 'p', FIG, 'p'],
    images: [img('/img/solo.png', 'Solo', FIG)],
    rows: [], figures: [[IMG]],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 0, 'st-figure': 1 },
  },
  'Links only': {
    children: ['h2', 'p', 'div.st-prose-btns', 'p'],
    images: [],
    rows: [[btn('Only link', '/only')]], figures: [],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 1, 'st-prose-btn': 1 },
  },
  // A lone "Back to …" link is navigation: it is a row, but holding a plain link and not a button.
  'Back link': {
    children: ['h2', 'p', 'div.st-prose-btns'],
    images: [],
    rows: [[['Back to the index', '/index', 'st-prose-plain']]], figures: [],
    counts: { 'st-prose-btns': 1, 'st-prose-plain': 1, 'st-prose-btn': 0 },
  },
  Dressed: {
    children: ['p.st-prose-eyebrow', 'h2', 'p', FIG],
    images: [img('/img/dressed.png', 'Dressed image', FIG)],
    rows: [], figures: [[IMG]],
    counts: { 'st-prose-eyebrow': 1, 'st-prose-imgs': 0, 'st-figure': 1 },
  },
  Ordered: {
    children: ['h2', 'p', 'ol.st-ordered'],
    images: [img('/img/clause.png', 'Clause figure', FIG)],
    rows: [], figures: [[IMG]],
    counts: { 'st-prose-imgs': 0, 'st-figure': 1, 'st-ord-item': 1 },
  },
  [ESC_TITLE]: { children: ['h2', 'p'], images: [], rows: [], figures: [], counts: { 'st-prose-eyebrow': 0 } },
  'Eyebrow escaping': { children: ['p.st-prose-eyebrow', 'h2', 'p'], images: [], rows: [], figures: [], counts: { 'st-prose-eyebrow': 1 } },
  // p, figure.st-figure>img, p, div.st-prose-btns, figure.st-figure>img+img, p — source order.
  'In place': {
    children: ['h2', 'p', FIG, 'p', 'div.st-prose-btns', FIG, 'p'],
    images: [img('/1.png', 'a', FIG), img('/2.png', 'b', FIG), img('/3.png', 'c', FIG)],
    rows: [[btn('A', '/a'), btn2('B', '/b')]],
    figures: [[IMG], [IMG, IMG]],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 1, 'st-prose-btn': 2, 'st-figure': 2, 'st-img': 3 },
  },
  'Row after image': {
    children: ['h2', FIG, 'div.st-prose-btns', 'p', 'div.st-prose-btns'],
    images: [img('/img/lead.png', 'Lead image', FIG)],
    rows: [[btn('Go', '/go'), btn2('More', 'https://example.com/more')], [btn('Second row', '/second')]],
    figures: [[IMG]],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 2, 'st-prose-btn': 3, 'st-prose-btn-primary': 2, 'st-figure': 1 },
  },
  Fenced: {
    children: ['h2', 'p', 'pre.st-code', 'p'],
    images: [], rows: [], figures: [],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 0, 'st-figure': 0, 'st-img': 0, 'st-code': 1 },
  },
  'Loose list': {
    children: ['h2', 'ul.st-list', 'ul.st-list', 'div.st-prose-btns', 'ul.st-list'],
    images: [], rows: [[btn('Mid list', '/mid')]], figures: [],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 1 },
  },
  Trio: {
    children: ['h2', 'p', FIG],
    images: [img('/img/t1.png', 't1', FIG), img('/img/t2.png', 't2', FIG), img('/img/t3.png', 't3', FIG)],
    rows: [], figures: [[IMG, IMG, IMG]],
    counts: { 'st-prose-imgs': 0, 'st-figure': 1, 'st-img': 3 },
  },
};
// The fence's text, typed out: every line of it survives, inside the <pre>, in order.
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];
EXPECTED['Eight lines'] = {
  children: ['h2', 'p', FIG],
  images: EIGHT.map((n) => img(`/img/w${n}.png`, `w${n}`, FIG)),
  rows: [], figures: [EIGHT.map(() => IMG)],
  counts: { 'st-prose-imgs': 0, 'st-figure': 1, 'st-img': 8 },
};
EXPECTED['Hard break'] = {
  children: ['h2', 'p'],
  images: [img('/img/h1.png', 'h1', 'p'), img('/img/h2.png', 'h2', 'p')],
  rows: [], figures: [],
  counts: { 'st-figure': 0, 'st-img': 2 },
};
EXPECTED['Two figures'] = {
  children: ['h2', FIG, FIG],
  images: [img('/img/x1.png', 'x1', FIG), img('/img/x2.png', 'x2', FIG)],
  rows: [], figures: [[IMG], [IMG]],
  counts: { 'st-figure': 2, 'st-img': 2 },
};
// Every figure's child NODES: nothing but images. The tree above drops text, so a figure that
// held `img␠img<br>img` would pass `figures`; this reads the figure's own text, whitespace included.
function assertBareFigures(where, byId) {
  for (const title of Object.keys(EXPECTED)) {
    for (const f of all(byId.get(idOf(title))).filter((n) => n.tag === 'figure')) {
      assert.equal(JSON.stringify(f.text), '""', `${where}, section ${JSON.stringify(title)}: text between a figure's images`);
      assert.ok(f.kids.every((k) => k.tag === 'img'), `${where}, section ${JSON.stringify(title)}: a figure holds ${f.kids.map(sig).join(', ')}`);
    }
  }
}
// The hard-break paragraph, node for node: img, br, img and no text between them.
function assertHardBreak(where, byId) {
  const p = byId.get(idOf('Hard break')).kids.find((n) => n.tag === 'p');
  assert.ok(p, `${where}: the hard-break paragraph is not a <p> (${byId.get(idOf('Hard break')).kids.map(sig).join(', ')})`);
  assert.deepEqual(p.kids.map(sig), ['img.st-img', 'br', 'img.st-img'], `${where}: the hard-break paragraph's children`);
  assert.equal(JSON.stringify(p.text), '""', `${where}: text inside the hard-break paragraph`);
}
const FENCE_TEXT = 'code [A](/a) ![x](/x.png) more';

// 🔴 The escaped text, as the markup both renderers must write — typed out here, not read from
// either of them, so a mistake they share (both writing the raw string) is still red. `"` stays
// literal in element text; `&`, `<`, `>` become entities; the full-width marks pass through.
const ESCAPED_INNER = {
  [ESC_TITLE]: '<h2>Salt &amp; &lt;pepper&gt; "twice"，全形。</h2><p>Body.</p>',
  'Eyebrow escaping': '<p class="st-prose-eyebrow">Tea &amp; &lt;milk&gt; &gt; sugar，全形。</p><h2>Eyebrow escaping</h2><p>Body.</p>',
};
function assertEscaped(where, html) {
  for (const [title, want] of Object.entries(ESCAPED_INNER)) {
    assert.equal(innerHtml(html, idOf(title)), want, `${where}, section ${JSON.stringify(title)}: escaped title / eyebrow`);
  }
}

// The opening `<section …>` tag as a sorted list of name=value. Read off the parsed tree, so the
// order an attribute was written in and the whitespace around it do not count.
const tagAttrs = (n) => Object.entries(n.attrs).map(([k, v]) => `${k}=${v}`).sort();
// What the tag of each section carrying params must be, written out by hand (the id is the
// parser's, the rest is the section's params).
const EXPECTED_TAG = {
  Dressed: (id) => ['class=st-prose', 'data-align=left', 'data-surface=cream', `id=${id}`],
  Ordered: (id) => ['class=st-prose', 'data-ordered=', `id=${id}`],
  Plain: (id) => ['class=st-prose', `id=${id}`],
};
function assertTags(where, byId) {
  for (const [title, want] of Object.entries(EXPECTED_TAG)) {
    assert.deepEqual(tagAttrs(byId.get(idOf(title))), want(idOf(title)), `${where}, section ${JSON.stringify(title)}: the <section> tag's attributes`);
  }
}

// tile#148, written out by hand: p, the two blocks (each figure.st-video-youtube > a.st-video-yt >
// img.st-video-yt-poster + span, then the script), then the labelled link's row.
function assertYoutube(where, byId) {
  const sec = byId.get(idOf('YouTube line'));
  assert.ok(sec, `${where}: no YouTube line section`);
  assert.deepEqual(sec.kids.map(sig), ['h2', 'p', 'figure.st-video.st-video-youtube', 'figure.st-video.st-video-youtube', 'div.st-prose-btns'], `${where}: the YouTube section's children`);
  const figs = sec.kids.filter((n) => n.tag === 'figure');
  assert.deepEqual(figs.map((f) => f.kids.map(sig)), [['a.st-video-yt', 'script'], ['a.st-video-yt', 'script']], `${where}: what each block holds`);
  assert.deepEqual(figs.map((f) => [f.kids[0].attrs['data-yt'], f.kids[0].attrs['data-yt-start'] ?? null, f.kids[0].kids[0].attrs.src]),
    [['dQw4w9WgXcQ', null, '/_yt/dQw4w9WgXcQ.jpg'], ['K9j8H7g6F5d', '30', '/_yt/K9j8H7g6F5d.jpg']], `${where}: each block's video, start and proxied poster`);
  const rows = facts(sec).buttonRows.map((row) => row.map((b) => [b.label, b.href, b.cls]));
  assert.deepEqual(rows, [[btn('Watch it there', 'https://youtu.be/K9j8H7g6F5d')]], `${where}: only the labelled link is a row`);
}

function assertExpected(where, byId) {
  for (const [title, want] of Object.entries(EXPECTED)) {
    const section = byId.get(idOf(title));
    assert.ok(section, `${where}: no section for ${JSON.stringify(title)}`);
    const got = facts(section);
    const at = `${where}, section ${JSON.stringify(title)}`;
    assert.deepEqual(got.children, want.children, `${at}: the section's children, in order`);
    assert.deepEqual(got.images, want.images, `${at}: every image, in document order, and the element holding it`);
    const rows = got.buttonRows.map((row) => row.map((b) => [b.label, b.href, b.cls]));
    assert.deepEqual(rows, want.rows, `${at}: the button rows, in order`);
    assert.deepEqual(got.figures, want.figures, `${at}: what each figure holds`);
    for (const [cls, n] of Object.entries(want.counts)) assert.equal(got.counts[cls] || 0, n, `${at}: elements carrying .${cls}`);
  }
  const pre = all(byId.get(idOf('Fenced'))).find((n) => n.tag === 'pre');
  assert.equal(pre && textOf(pre), FENCE_TEXT, `${where}: the fenced code block's text`);
}

// ── the string renderer, which needs nothing but this file's imports ────────────────────────
const stringHtml = renderSiteToHtml(site);
const stringById = sectionsById(stringHtml);

await test('the fixture parsed into the sections it was written as, all of them prose', () => {
  assert.equal(site.sections.length, SECTIONS.length);
  for (const s of site.sections) assert.equal(s.type, 'prose', `${s.title} parsed as ${s.type}`);
  assert.equal(stringById.size, SECTIONS.length, 'a section the string renderer wrote has no id to find it by');
});

await test('🔴 string renderer: standalone images and link rows stay where they were written', () => {
  assertExpected('string renderer', stringById);
});

await test('🔴 string renderer: a YouTube line is the click-to-play block in place, not a button row', () => {
  assertYoutube('string renderer', stringById);
});

await test('🔴 string renderer: a figure is images and nothing else — no <br>, no whitespace between them', () => {
  assertBareFigures('string renderer', stringById);
});

await test('string renderer: two images with a hard break between them are <p><img><br><img></p>', () => {
  assertHardBreak('string renderer', stringById);
});

await test('🔴 string renderer: no .st-prose-imgs anywhere on the page', () => {
  assert.ok(!/st-prose-imgs/.test(stringHtml), 'the string render still writes a .st-prose-imgs group');
});

// The figure is bodyHtml's own: a prose body with no links-only paragraph renders byte-for-byte as
// bodyHtml renders it. Only a links-only paragraph is drawn differently, and only in place.
await test('a prose body without a links-only paragraph is exactly bodyHtml', () => {
  const bodies = SECTIONS.map(([, , body]) => body).filter((b) => !/^\[[^\]]+\]\([^)]*\)\s*(?:[·,]\s*\[[^\]]+\]\([^)]*\)\s*)*$/m.test(b));
  assert.ok(bodies.length >= 6, `only ${bodies.length} bodies to compare`);
  for (const b of bodies) assert.equal(proseBodyHtml(b), bodyHtml(b), JSON.stringify(b.slice(0, 40)));
  // CONTROL: a body WITH a links-only paragraph is not bodyHtml — the comparison can see a difference.
  assert.notEqual(proseBodyHtml('Text.\n\n[A](/a)'), bodyHtml('Text.\n\n[A](/a)'));
});

await test('string renderer: a titled image is not in the grammar, and is not read as an image', () => {
  const mixed = stringById.get(idOf('Mixed'));
  assert.ok(!all(mixed).some((n) => n.tag === 'img' && n.attrs.src === '/img/titled.png'), 'the titled image became an <img>');
  assert.ok(textOf(mixed).includes('"A title"'), 'the titled image\'s source text is gone from the page altogether');
});

await test('🔴 string renderer: a title and an eyebrow are escaped', () => {
  assertEscaped('string renderer', stringHtml);
});

await test('string renderer: the <section> tag carries the section\'s params, attribute by attribute', () => {
  assertTags('string renderer', stringById);
});

await test('the section\'s own attributes are untouched by the split', () => {
  const dressed = stringById.get(idOf('Dressed'));
  assert.equal(dressed.attrs['data-surface'], 'cream');
  assert.equal(dressed.attrs['data-align'], 'left');
  assert.ok('data-ordered' in stringById.get(idOf('Ordered')).attrs);
  assert.ok(!('data-ordered' in dressed.attrs));
});

// 🔴 The shared function is only "shared" while the component calls it. Read the import, not the
// file: the component's comments name the functions it used to call, and a search for their names
// in the whole text would be answered by its own explanation.
// tile-lab#52: the markup moved to packages/emit/prose.mjs, which imports site-core relatively —
// so the imports read are the component's `@sitetile` one AND its emitter's `../sitetile/site-core.js`
// one, each expected once.
await test('Prose.astro splits a body through proseBodyHtml and has no second way to do it', () => {
  const { astro, emit } = sectionSource('Prose.astro');
  const fromCore = (src, spec) => [...src.matchAll(new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*'${spec}';?\\s*$`, 'gm'))];
  const imports = [...fromCore(astro, '@sitetile'), ...fromCore(emit, '\\.\\./sitetile/site-core\\.js')];
  assert.equal(imports.length, emit ? 2 : 1, `expected one site-core import per file, found ${imports.length}`);
  const names = imports.flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  assert.ok(names.includes('proseBodyHtml'), 'Prose.astro does not import proseBodyHtml');
  for (const own of ['heroParts', 'bodyHtml', 'orderedProseHtml', 'linkButtonsHtml', 'imgTag']) {
    assert.ok(!names.includes(own), `Prose.astro imports ${own} — it is assembling a prose body itself again`);
  }
});

// ── the built page ──────────────────────────────────────────────────────────────────────────
const ASTRO = join(ENGINE, RENDERER_SUBPATH);
if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · the built page SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (this run compared the string renderer with what is written here, and NOT with a built page)');
} else {
  const ir = mkdtempSync(join(tmpdir(), 'tile-prose-parity-ir-'));
  const out = mkdtempSync(join(tmpdir(), 'tile-prose-parity-out-'));
  try {
    writeFileSync(join(ir, 'home.md'), MD);
    const result = await buildSite({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' });
    const astroHtml = result.code === 0 ? readFileSync(join(out, 'index.html'), 'utf8') : '';
    const astroById = sectionsById(astroHtml);
    const under = SECTIONS.slice(1).map(([title]) => title);

    await test('the fixture built, and every section is on the page under the id the string renderer gave it', () => {
      assert.equal(result.code, 0, 'astro build exited non-zero');
      for (const title of under) {
        const s = astroById.get(idOf(title));
        assert.ok(s, `no section ${JSON.stringify(idOf(title))} in the built page`);
        assert.deepEqual(s.cls, ['st-prose'], `section ${JSON.stringify(title)} is not a plain .st-prose`);
      }
    });

    await test('🔴 built page: standalone images and link rows stay where they were written', () => {
      assertExpected('built page', astroById);
    });

    await test('🔴 built page: a YouTube line is the click-to-play block in place, not a button row', () => {
      assertYoutube('built page', astroById);
    });

    await test('🔴 built page: a figure is images and nothing else — no <br>, no whitespace between them', () => {
      assertBareFigures('built page', astroById);
    });

    await test('built page: two images with a hard break between them are <p><img><br><img></p>', () => {
      assertHardBreak('built page', astroById);
    });

    await test('🔴 built page: no .st-prose-imgs anywhere on the page', () => {
      assert.ok(!/st-prose-imgs/.test(astroHtml), 'the built page still has a .st-prose-imgs group');
    });

    await test('🔴 the two renderers agree: children, images and their order, button row, class counts', () => {
      for (const title of under) {
        const a = facts(astroById.get(idOf(title))), s = facts(stringById.get(idOf(title)));
        const at = `section ${JSON.stringify(title)}`;
        assert.deepEqual(s.children, a.children, `${at}: children (string renderer vs built page)`);
        assert.deepEqual(s.images, a.images, `${at}: images, in order, and their containers`);
        assert.deepEqual(s.buttonRows, a.buttonRows, `${at}: the button rows`);
        assert.deepEqual(s.figures, a.figures, `${at}: what each figure holds`);
        assert.deepEqual(s.counts, a.counts, `${at}: how many elements carry each class`);
      }
    });

    await test('the two renderers write the same markup inside the section, attribute for attribute', () => {
      for (const title of under) {
        const a = innerHtml(astroHtml, idOf(title)), s = innerHtml(stringHtml, idOf(title));
        assert.ok(a && s, `section ${JSON.stringify(title)} could not be cut out of one of the pages`);
        assert.equal(s, a, `section ${JSON.stringify(title)}`);
      }
    });

    await test('🔴 built page: a title and an eyebrow are escaped', () => {
      assertEscaped('built page', astroHtml);
    });

    // The opening tag, name by name. The inner markup above stops at the tag, so a dropped
    // `data-surface` or `data-align` was invisible to it.
    // KNOWN DIFFERENCES, by name — none among the attributes: both renderers write the same set for
    // every section under test. The one accepted difference between the two pages is not a tag
    // attribute: the first section's heading is an <h1> on the built page and an <h2> in the
    // string render. That section ("Lead") is left out of `under` for exactly that reason.
    const KNOWN_TAG_DIFFERENCES = {};
    await test('🔴 the two renderers write the same <section> tag: the same attributes, name and value', () => {
      for (const title of under) {
        const a = tagAttrs(astroById.get(idOf(title))), s = tagAttrs(stringById.get(idOf(title)));
        const skip = new Set(KNOWN_TAG_DIFFERENCES[title] || []);
        const keep = (list) => list.filter((nv) => !skip.has(nv.split('=')[0]));
        assert.deepEqual(keep(a), keep(s), `section ${JSON.stringify(title)}: <section> attributes (built page vs string renderer)`);
      }
    });

    await test('🔴 built page: the <section> tag carries the section\'s params, attribute by attribute', () => {
      assertTags('built page', astroById);
    });

    await test('CONTROL: the comparison can tell two sections apart', () => {
      const mixed = facts(astroById.get(idOf('Mixed'))), plain = facts(stringById.get(idOf('Plain')));
      assert.notDeepEqual(mixed.children, plain.children);
      assert.notDeepEqual(mixed.images, plain.images);
      assert.notEqual(innerHtml(astroHtml, idOf('Mixed')), innerHtml(stringHtml, idOf('Plain')));
      assert.notDeepEqual(tagAttrs(astroById.get(idOf('Dressed'))), tagAttrs(stringById.get(idOf('Plain'))));
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
