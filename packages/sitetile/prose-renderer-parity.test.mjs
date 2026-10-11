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
import { parseSite, renderSiteToHtml } from './site-core.js';
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
];
const MD = '---\nsitetile-page: home\ntitle: Prose parity\nlang: en-US\n---\n\n'
  + SECTIONS.map(([title, marker, body]) => `## ${title}\n${marker ? marker + '\n' : ''}${body}\n`).join('\n');

const site = parseSite(MD);
const idOf = (title) => site.sections[SECTIONS.findIndex(([t]) => t === title)].id;

// ── what the page must be, written out by hand and derived from neither renderer ────────────
const img = (src, alt, container) => ({ src, alt, in: container });
const EXPECTED = {
  Mixed: {
    children: ['h2', 'p', 'p', 'ul.st-list', 'p', 'p', 'div.st-prose-btns', 'div.st-prose-imgs'],
    images: [
      img('/img/dot.png', 'dot', 'p'),
      img('/img/list.png', 'in a list', 'li'),
      img('/img/first.png', 'First alone', 'div.st-prose-imgs'),
      img('/img/second.jpg', 'Second alone', 'div.st-prose-imgs'),
      img('/img/pair-left.png', 'Pair left', 'div.st-prose-imgs'),
      img('/img/pair-right.png', 'Pair right', 'div.st-prose-imgs'),
    ],
    buttons: [['Read on', '/more', 'st-prose-btn st-prose-btn-primary'], ['Elsewhere', 'https://example.com/elsewhere', 'st-prose-btn st-prose-btn-secondary']],
    counts: { 'st-prose-imgs': 1, 'st-prose-btns': 1, 'st-prose-btn': 2, 'st-figure': 0, 'st-img': 6 },
  },
  Plain: {
    children: ['h2', 'p', 'ul.st-list', 'p'],
    images: [img('/img/plain-dot.png', 'dot', 'p')],
    buttons: null,
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 0, 'st-figure': 0, 'st-img': 1 },
  },
  'Images only': {
    children: ['h2', 'p', 'p', 'div.st-prose-imgs'],
    images: [img('/img/solo.png', 'Solo', 'div.st-prose-imgs')],
    buttons: null,
    counts: { 'st-prose-imgs': 1, 'st-prose-btns': 0, 'st-figure': 0 },
  },
  'Links only': {
    children: ['h2', 'p', 'p', 'div.st-prose-btns'],
    images: [],
    buttons: [['Only link', '/only', 'st-prose-btn st-prose-btn-primary']],
    counts: { 'st-prose-imgs': 0, 'st-prose-btns': 1, 'st-prose-btn': 1 },
  },
  // A lone "Back to …" link is navigation: it joins the row, but as a plain link and not a button.
  'Back link': {
    children: ['h2', 'p', 'div.st-prose-btns'],
    images: [],
    buttons: [['Back to the index', '/index', 'st-prose-plain']],
    counts: { 'st-prose-btns': 1, 'st-prose-plain': 1, 'st-prose-btn': 0 },
  },
  Dressed: {
    children: ['p.st-prose-eyebrow', 'h2', 'p', 'div.st-prose-imgs'],
    images: [img('/img/dressed.png', 'Dressed image', 'div.st-prose-imgs')],
    buttons: null,
    counts: { 'st-prose-eyebrow': 1, 'st-prose-imgs': 1, 'st-figure': 0 },
  },
  Ordered: {
    children: ['h2', 'p', 'ol.st-ordered'],
    images: [img('/img/clause.png', 'Clause figure', 'figure.st-figure')],
    buttons: null,
    counts: { 'st-prose-imgs': 0, 'st-figure': 1, 'st-ord-item': 1 },
  },
};

function assertExpected(where, byId) {
  for (const [title, want] of Object.entries(EXPECTED)) {
    const section = byId.get(idOf(title));
    assert.ok(section, `${where}: no section for ${JSON.stringify(title)}`);
    const got = facts(section);
    const at = `${where}, section ${JSON.stringify(title)}`;
    assert.deepEqual(got.children, want.children, `${at}: the section's children, in order`);
    assert.deepEqual(got.images, want.images, `${at}: every image, in document order, and the element holding it`);
    const rows = got.buttonRows.map((row) => row.map((b) => [b.label, b.href, b.cls]));
    assert.deepEqual(rows, want.buttons ? [want.buttons] : [], `${at}: the button row`);
    for (const [cls, n] of Object.entries(want.counts)) assert.equal(got.counts[cls] || 0, n, `${at}: elements carrying .${cls}`);
  }
}

// ── the string renderer, which needs nothing but this file's imports ────────────────────────
const stringHtml = renderSiteToHtml(site);
const stringById = sectionsById(stringHtml);

await test('the fixture parsed into the sections it was written as, all of them prose', () => {
  assert.equal(site.sections.length, SECTIONS.length);
  for (const s of site.sections) assert.equal(s.type, 'prose', `${s.title} parsed as ${s.type}`);
  assert.equal(stringById.size, SECTIONS.length, 'a section the string renderer wrote has no id to find it by');
});

await test('🔴 string renderer: standalone images are gathered, standalone links are a button row', () => {
  assertExpected('string renderer', stringById);
});

await test('string renderer: a titled image is not in the grammar, and is not read as an image', () => {
  const mixed = stringById.get(idOf('Mixed'));
  assert.ok(!all(mixed).some((n) => n.tag === 'img' && n.attrs.src === '/img/titled.png'), 'the titled image became an <img>');
  assert.ok(textOf(mixed).includes('"A title"'), 'the titled image\'s source text is gone from the page altogether');
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
await test('Prose.astro splits a body through proseBodyHtml and has no second way to do it', () => {
  const src = readFileSync(join(HERE, 'astro/src/components/sections/Prose.astro'), 'utf8');
  const imports = [...src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'@sitetile';?\s*$/gm)];
  assert.equal(imports.length, 1, `expected one import from @sitetile, found ${imports.length}`);
  const names = imports[0][1].split(',').map((s) => s.trim()).filter(Boolean);
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

    await test('🔴 built page: standalone images are gathered, standalone links are a button row', () => {
      assertExpected('built page', astroById);
    });

    await test('🔴 the two renderers agree: children, images and their order, button row, class counts', () => {
      for (const title of under) {
        const a = facts(astroById.get(idOf(title))), s = facts(stringById.get(idOf(title)));
        const at = `section ${JSON.stringify(title)}`;
        assert.deepEqual(s.children, a.children, `${at}: children (string renderer vs built page)`);
        assert.deepEqual(s.images, a.images, `${at}: images, in order, and their containers`);
        assert.deepEqual(s.buttonRows, a.buttonRows, `${at}: the button row`);
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

    await test('CONTROL: the comparison can tell two sections apart', () => {
      const mixed = facts(astroById.get(idOf('Mixed'))), plain = facts(stringById.get(idOf('Plain')));
      assert.notDeepEqual(mixed.children, plain.children);
      assert.notDeepEqual(mixed.images, plain.images);
      assert.notEqual(innerHtml(astroHtml, idOf('Mixed')), innerHtml(stringHtml, idOf('Plain')));
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
