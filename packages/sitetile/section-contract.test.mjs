// Section contract: one markdown page, two renderers, one structure — per section.
//   run: node packages/sitetile/section-contract.test.mjs
//
// The engine renders a section twice: `astro/src/components/sections/*.astro` builds the pages a
// site ships, and `renderSection` in site-core.js returns the string "reference render" that
// editors preview with and tools read selector hits from. Where they differ, a number taken from
// the reference describes a page nobody is served. prose-renderer-parity.test.mjs guards prose;
// this file is the same guard for every other section type, plus the known gaps, named.
//
// 🔴 KNOWN GAPS are an explicit xfail list. Two ways an xfail list rots, both made red here:
//   · an entry that is no longer different (fixed, or never was) fails — the list cannot become a
//     permanent exemption, and a gap can only be listed while it is real;
//   · a section that differs without an entry fails.
// Fixing a gap = delete its entry; the section then has to be identical.
//
// 🔴 The Astro half builds a real page. In CI it must run, so a missing
// packages/sitetile/astro/node_modules FAILS this test. Set SECTION_CONTRACT_ALLOW_NO_ASTRO=1 to
// run the string half only, knowingly.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml, heroHeadingless, pageH1Index } from './site-core.js';
import { contentRelsOf } from './locale.mjs';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..');

console.log('section-contract');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ── a tree, so "same structure" is a question about parents and children and not a regex ────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
function parseHtml(html) {
  const root = { tag: '#root', cls: [], attrs: {}, kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/gi;
  let at = 0, m;
  while ((m = re.exec(html))) {
    at = re.lastIndex;
    if (m[1]) {
      const t = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === t) { stack.length = k; break; }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(), attrs = {};
    for (const a of m[3].matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const node = { tag, cls: (attrs.class || '').split(/\s+/).filter(Boolean), attrs, kids: [] };
    stack[stack.length - 1].kids.push(node);
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
// Structure a stylesheet can see: tag, class tokens (a list, never a joined string — `a.b` and
// `a b` are different), children in document order. No text, ids, data-* or whitespace.
const shape = (n) => ({ tag: n.tag, classes: [...n.cls], children: n.kids.map(shape) });
// A section's wrapper chain: tag + classes of every ancestor between the page's <main> and the
// section, outermost first. The built page has page chrome (html/body/main) that the string
// render, a fragment, does not; an extra wrapper BETWEEN main and the section is what counts.
const chainOf = (n) => {
  const at = n.chain.map((c) => c.tag).lastIndexOf('main');
  return n.chain.slice(at + 1);
};
// Every <section id>, with its ancestor chain. 🔴 A duplicate id is a failure, not an overwrite:
// Map.set would keep the last one and the first would never be compared.
function sectionsById(html, where) {
  const out = new Map();
  const walk = (n, chain) => {
    for (const k of n.kids) {
      if (k.tag === 'section' && k.attrs.id) {
        assert.ok(!out.has(k.attrs.id), `${where}: section id ${JSON.stringify(k.attrs.id)} appears more than once`);
        k.chain = chain.map((c) => ({ tag: c.tag, classes: [...c.cls] }));
        out.set(k.attrs.id, k);
      }
      walk(k, [...chain, k]);
    }
  };
  walk(parseHtml(html), []);
  return out;
}
const whole = (n) => ({ chain: chainOf(n), shape: shape(n) });

// ── the fixture: one page, one section per type under test, none of them uniform ─────────────
// `key` names the xfail entry the section belongs to (if any).
const CASES = [
  // First, and prose: the built page gives the first section an <h1>.
  { title: 'Lead', marker: '', body: 'First section.' },
  { title: 'Plain prose', marker: '', body: 'Text with a [link](/x).\n\n- one\n- two\n\nEnd.' },
  { title: 'Prose images and links', marker: '', body: 'Before.\n\n![Solo](/img/solo.png)\n\nMid.\n\n[Only link](/only)\n\nAfter.' },
  { title: 'Ordered', marker: '%% sitetile: prose ordered %%', body: 'Lead.\n\n### First clause\nBody.' },
  { title: 'Hero legacy', marker: '%% sitetile: hero cta="Go"→/go %%', body: 'A hero.' },
  { title: 'Hero split', marker: '%% sitetile: hero layout=split %%', body: 'Split hero.\n\n[Act](/act)\n\n![Art](/img/art.png)' },
  { title: 'Hero split logo', marker: '%% sitetile: hero layout=split logo=/img/logo.png %%', body: 'Split logo hero.\n\n[Act](/act)\n\n![Art](/img/art.png)' },
  { title: 'Hero layered', marker: '%% sitetile: hero layers=/img/back.png|/img/front.png logo=/img/logo.png %%', body: 'Layered hero.' },
  // reef#2857: a text-free hero (no title, no `logo=`) — a full-bleed bg= picture band. It emits NO
  // heading element at all (not an empty <h1>), in every variant; the logo one keeps its image h1.
  { title: '', label: 'Hero bare legacy', marker: '%% sitetile: hero bg=/img/bg.png cta="Go"→/go %%', body: 'A text-free hero.' },
  { title: '', label: 'Hero bare enter', marker: '%% sitetile: hero bg=/img/bg.png enter %%', body: 'Entrance hero.' },
  { title: '', label: 'Hero bare split', marker: '%% sitetile: hero layout=split bg=/img/bg.png eyebrow="Hi" %%', body: 'Split.\n\n[Act](/act)\n\n![Art](/img/art.png)' },
  { title: '', label: 'Hero bare layered', marker: '%% sitetile: hero layers=/img/back.png|/img/front.png %%', body: 'Layered.' },
  { title: '', label: 'Hero bare layered logo', marker: '%% sitetile: hero layers=/img/back.png|/img/front.png logo=/img/logo.png %%', body: 'Layered logo.' },
  { title: 'Grid cells', marker: '%% sitetile: grid cols=3 %%',
    body: '### Plain\nBody one.\n\n### Linked →/internal\nBody two.\n\n### Labelled →/x "Read"\nBody three.\n\n### 🎉 Emoji\nBody four.\n\n### Badged [New]\nBody five.\n\n### External →https://example.com/e\nBody six.' },
  { title: '', label: 'Grid untitled', marker: '%% sitetile: grid cols=2 %%', body: '### Only\nBody.' },
  { title: 'Collection later', marker: '%% sitetile: collection %%', body: '### Group\n#### Item one\nBody one.\n\n#### Item two\nBody two.' },
  { title: 'Form', marker: '%% sitetile: form %%', body: 'Write to us.\n\n### Name {required}\n### Email {email}\n### Topic\n- A\n- B\n### Message {textarea}' },
  { title: 'Form inbox', marker: '%% sitetile: form action=inbox %%', body: 'Write to us.\n\n### Email {email}\n### Message {textarea}' },
  { title: 'FAQ', marker: '%% sitetile: faq %%', body: '### Why?\nBecause.\n\n### How?\nLike this.' },
  // tile#148: a YouTube line is a player wherever bodyHtml renders a body — a prose section (where the
  // links-only test would have made it a button) and a FAQ answer — in both renderers alike.
  { title: 'Prose YouTube', marker: '', body: 'Watch.\n\n[https://www.youtube.com/watch?v=dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\nhttps://youtu.be/K9j8H7g6F5d?t=30\n\n[Watch it there](https://youtu.be/K9j8H7g6F5d)' },
  { title: 'FAQ YouTube', marker: '%% sitetile: faq %%', body: '### Where is the video?\nHere:\n\nhttps://www.youtube.com/shorts/s0rTsVid3oX' },
  // tile#150 L1: a linked cell is one <a> — its YouTube line stays the paragraph it was, in both
  // renderers; the unlinked cell beside it gets the player. Grid (plain and cards=image), gallery, carousel.
  { title: 'Grid YouTube', marker: '%% sitetile: grid cols=2 %%', body: '### Linked →/internal\nhttps://youtu.be/K9j8H7g6F5d\n\n### Plain\nhttps://youtu.be/dQw4w9WgXcQ' },
  { title: 'Grid image YouTube', marker: '%% sitetile: grid cols=2 cards=image %%', body: '### Linked →/internal\nhttps://youtu.be/K9j8H7g6F5d\n\n### Plain\n[https://youtu.be/dQw4w9WgXcQ](https://youtu.be/dQw4w9WgXcQ)' },
  { title: 'Gallery YouTube', marker: '%% sitetile: gallery %%', body: '### Linked →/internal\nhttps://youtu.be/K9j8H7g6F5d\n\n### Plain\nhttps://youtu.be/dQw4w9WgXcQ' },
  { title: 'Timeline', marker: '%% sitetile: timeline %%', body: '### 2020\nStart.\n\n### 2021\nGrowth.' },
  { title: 'CTA', marker: '%% sitetile: cta %%', body: 'Come along.\n\n[Join](/join)' },
  { title: 'Gallery', marker: '%% sitetile: gallery %%', body: '![One](/img/1.png)\n\n![Two](/img/2.png)' },
  // tile-lab#52 phase 1: the five of the nine emitter sections this list had no case for. Each has a
  // case that exercises its optional parts (eyebrow, caption, a gated destination) beside a bare one.
  { title: 'Embed', marker: '%% sitetile: embed %%', body: '<div class="custom"><p>Raw <b>html</b>.</p></div>' },
  { title: 'Embed wide', marker: '%% sitetile: embed wide %%', body: '<iframe src="https://example.com/e" title="e"></iframe>' },
  { title: 'People flat', marker: '%% sitetile: people cols=3 eyebrow="Team" %%',
    body: 'The team.\n\n### Ada →https://example.com/ada [Founder · CTO]\n![Ada](/img/ada.png)\nWrote the first program.\nlinks: Site=https://ada.example, Blog=/blog, Bad=javascript:void(0)\ntone: dark\n\n### Grace →/grace\nNo portrait.\n\n### Hostile →javascript:alert(1)\nPlain name.' },
  { title: 'People grouped', marker: '%% sitetile: people shape=logo %%',
    body: '### Partners\nPartner lead.\n\n#### Acme →https://acme.example\n![Acme](/img/acme.png)\nA company.\n\n#### Beta\nBeta body.\n\n### Friends\n#### Gamma [Role]\nGamma body.' },
  { title: 'Social', marker: '%% sitetile: social eyebrow="Follow" %%',
    body: 'Find us here.\n\n[Patreon](https://patreon.com/x) · [GitHub](https://github.com/x) · [Mail](mailto:a@example.com) · [Bad](javascript:void(0))' },
  { title: 'Social bare', marker: '%% sitetile: social %%', body: '[Only](/only)' },
  { title: 'Tagcloud', marker: '%% sitetile: tagcloud eyebrow="Topics" %%', body: '- [comic576](/tag/comic)\n- [art12](/tag/art)\n- [bad](javascript:void(0))' },
  { title: 'Links', marker: '%% sitetile: links eyebrow="Read" %%',
    body: 'Sites we like.\n\n- [Example](https://www.example.com/a) — the best one\n- [Internal](/internal) : an internal page\n- [Bad](javascript:alert(1))\n- [Mail](mailto:me@example.com)' },
  { title: 'Links bare', marker: '%% sitetile: links %%', body: '- [Only](https://example.org/)' },
  // …and `eyebrow=` on the three nine-emitter sections whose cases above never set one.
  { title: 'FAQ eyebrow', marker: '%% sitetile: faq eyebrow="Help" %%', body: 'Lead.\n\n### Why?\nBecause.' },
  { title: 'Timeline eyebrow', marker: '%% sitetile: timeline eyebrow="Since 2011" %%', body: '### 2011\nStart.' },
  { title: 'Gallery eyebrow', marker: '%% sitetile: gallery eyebrow="See all" %%', body: '### One\n![One](/img/1.png)' },
  // tile-lab#52 phase 2: carousel had no case at all. A plain one (linked / badged / labelled /
  // bare cells, a gated destination), and one with every optional head part and the blog-full cell.
  { title: 'Carousel', marker: '%% sitetile: carousel cols=3 %%',
    body: 'Intro.\n\n### One →/one [New]\n![One](/img/1.png)\nCaption one.\n\n### Two "Go"\n![Two](/img/2.png)\n\n### Three →https://example.com/3\nNo image.\n\n### Bad →javascript:alert(1)\n![Bad](/img/bad.png)' },
  { title: 'Carousel eyebrow', marker: '%% sitetile: carousel eyebrow="Cast" more="All=/all" start=1 card=blog-full %%',
    body: '### Post →/p "Read"\n![P](/img/p.png)\nExcerpt.' },
  { title: '', label: 'Carousel bare', marker: '%% sitetile: carousel %%', body: '### Only\n![O](/img/o.png)' },
];

// Known gaps, by name. Each must be real (the sections tagged with it differ) or the test fails.
// Remove the entry when the gap is closed.
const XFAIL = {};
// The sections that carry a gap, by title.
const GAPS = {};

const MD = '---\nsitetile-page: home\ntitle: Section contract\nlang: en-US\n---\n\n'
  + CASES.map((c) => `##${c.title ? ' ' + c.title : ''}\n${c.marker ? c.marker + '\n' : ''}${c.body}\n`).join('\n');
const ZH_HOME_MD = '---\nsitetile-page: home\ntitle: Home zh\nlang: zh-TW\nlocales: en-US, zh-TW\n---\n\n## Hi\nzh home.\n';
const ZH_CONTACT_MD = '---\nsitetile-page: contact\ntitle: Contact zh\nlang: zh-TW\nlocales: en-US, zh-TW\n---\n\n## Form zh\n%% sitetile: form action=inbox thanks=/thanks %%\nWrite to us.\n\n### Email {email}\n### Message {textarea}\n';
const zhSite = parseSite(ZH_CONTACT_MD);
const site = parseSite(MD);
const nameOf = (c) => c.label || c.title;
const idOf = (title) => site.sections[CASES.findIndex((c) => nameOf(c) === title)].id;

const stringById = sectionsById(renderSiteToHtml(site), 'string render');

await test('the fixture parsed into the section types it was written as', () => {
  const want = ['prose', 'prose', 'prose', 'prose', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'hero', 'grid', 'grid', 'collection', 'form', 'form', 'faq', 'prose', 'faq', 'grid', 'grid', 'gallery', 'timeline', 'cta', 'gallery',
    'embed', 'embed', 'people', 'people', 'social', 'social', 'tagcloud', 'links', 'links', 'faq', 'timeline', 'gallery',
    'carousel', 'carousel', 'carousel'];
  assert.deepEqual(site.sections.map((s) => s.type), want);
  for (const c of CASES) assert.ok(stringById.get(idOf(nameOf(c))), `string render has no section for ${nameOf(c)}`);
});

// tile#150 L1, written out and checked against each renderer on its own (structure parity alone
// would stay green if both put a player inside the cell's link).
function assertNoPlayerInLinkedCell(where, byId) {
  for (const title of ['Grid YouTube', 'Grid image YouTube', 'Gallery YouTube']) {
    const sec = byId.get(idOf(title));
    assert.ok(sec, `${where}: no section ${title}`);
    const links = all(sec).filter((n) => n.tag === 'a' && n.cls.includes('st-cell-link'));
    assert.equal(links.length, 1, `${where}, ${title}: linked cells`);
    assert.ok(!all(links[0]).some((n) => n.tag === 'a' || n.cls.includes('st-video-youtube')), `${where}, ${title}: a player / an <a> inside the cell's link`);
    assert.equal(all(sec).filter((n) => n.cls.includes('st-video-youtube')).length, 1, `${where}, ${title}: the unlinked cell's player`);
  }
}
await test('🔴 string render: a linked cell holds no YouTube player (no <a> inside its <a>)', () => {
  assertNoPlayerInLinkedCell('string render', stringById);
});

// ── reef#2857: a text-free hero emits no heading; a titled or logo hero is untouched ─────────
// Checked against each renderer on its own: structure parity alone stays green when BOTH write the
// empty <h1></h1> (which is exactly what origin/main did).
const BARE_HEROES = ['Hero bare legacy', 'Hero bare enter', 'Hero bare split', 'Hero bare layered'];
const TITLED_HEROES = ['Hero legacy', 'Hero split', 'Hero split logo', 'Hero layered', 'Hero bare layered logo'];
const LOGO_HEROES = ['Hero split logo', 'Hero layered', 'Hero bare layered logo'];
const headings = (n) => all(n).filter((k) => /^h[1-6]$/.test(k.tag));
function assertHeroHeadings(where, byId) {
  const emitted = [];
  for (const title of BARE_HEROES) {
    const sec = byId.get(idOf(title));
    assert.ok(sec, `${where}: no section ${title}`);
    assert.ok(sec.cls.includes('st-hero') && sec.cls.includes('st-full-bleed'), `${where}, ${title}: no longer a full-bleed hero`);
    const hs = headings(sec).map((h) => `<${h.tag}>`);
    if (hs.length) emitted.push(`${title} ${hs.join('')}`);
  }
  assert.deepEqual(emitted, [], `${where}: text-free heroes emitted a heading`);
  // reef#2869: every titled/logo hero in this fixture sits after `Lead` (the page's h1 owner), so
  // its heading is an <h2> — a hero's title is the <h1> only when the hero IS pageH1Index's owner.
  for (const title of TITLED_HEROES) {
    const sec = byId.get(idOf(title));
    assert.deepEqual(headings(sec).map((h) => h.tag), ['h2'], `${where}, ${title}: a titled/logo hero that is not the page's h1 owner must write exactly one <h2>`);
  }
}
// The raw outer HTML of one hero <section> (a hero holds no nested <section>).
function rawSection(html, id) {
  const at = html.search(new RegExp(`<section\\b[^>]*\\bid="${id}"`));
  if (at < 0) return null;
  return html.slice(at, html.indexOf('</section>', at) + '</section>'.length);
}
// Pinned from origin/main 6c84cea (before reef#2857): the logo heroes, byte for byte.
const LOGO_PIN = {
  string: {
    "Hero split logo":
      "<section class=\"st-hero st-full-bleed\" id=\"s7-hero-split-logo\" data-media=\"avatar\" data-layout=\"split\"><div class=\"st-hero-text\"><h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt=\"Hero split logo\" loading=\"eager\" decoding=\"async\"></h1><p>Split logo hero.</p><div class=\"st-hero-btns\"><a class=\"st-hero-btn st-hero-btn-primary\" href=\"/act\">Act<span class=\"signet-arrow\" style=\"width:16px;height:16px;--signet-arrow-w:16px\" aria-hidden=\"true\"><span class=\"signet-arrow__tail\"></span><svg class=\"signet-arrow__head\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"10 6 16 12 10 18\"/></svg></span></a></div></div><div class=\"st-hero-art\"><img class=\"st-img\" src=\"/img/art.png\" alt=\"Art\" loading=\"lazy\" decoding=\"async\"></div></section>",
    "Hero layered":
      "<section class=\"st-hero st-full-bleed st-hero-layered\" id=\"s8-hero-layered\" data-media=\"avatar\" data-logo-pos=\"bottom\"><div class=\"st-hero-stage\" aria-hidden=\"true\"><img class=\"st-hero-layer\" src=\"/img/back.png\" alt=\"\" data-depth=\"0\" loading=\"eager\" decoding=\"async\"><img class=\"st-hero-layer\" src=\"/img/front.png\" alt=\"\" data-depth=\"1\" loading=\"eager\" decoding=\"async\"></div><div class=\"st-hero-text st-hero-overlay\"><h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt=\"Hero layered\" loading=\"eager\" decoding=\"async\"></h1><p>Layered hero.</p></div></section>",
    "Hero bare layered logo":
      "<section class=\"st-hero st-full-bleed st-hero-layered\" id=\"s13\" data-media=\"avatar\" data-logo-pos=\"bottom\"><div class=\"st-hero-stage\" aria-hidden=\"true\"><img class=\"st-hero-layer\" src=\"/img/back.png\" alt=\"\" data-depth=\"0\" loading=\"eager\" decoding=\"async\"><img class=\"st-hero-layer\" src=\"/img/front.png\" alt=\"\" data-depth=\"1\" loading=\"eager\" decoding=\"async\"></div><div class=\"st-hero-text st-hero-overlay\"><h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt=\"\" loading=\"eager\" decoding=\"async\"></h1><p>Layered logo.</p></div></section>",
  },
  built: {
    "Hero split logo":
      "<section class=\"st-hero st-full-bleed\" id=\"s7-hero-split-logo\" data-media=\"avatar\" data-layout=\"split\">  <div class=\"st-hero-text\">  <h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt=\"Hero split logo\" loading=\"eager\" decoding=\"async\"></h1> <p>Split logo hero.</p> <div class=\"st-hero-btns\"><a class=\"st-hero-btn st-hero-btn-primary\" href=\"/act\">Act<span class=\"signet-arrow\" style=\"width:16px;height:16px;--signet-arrow-w:16px\" aria-hidden=\"true\"><span class=\"signet-arrow__tail\"></span><svg class=\"signet-arrow__head\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"10 6 16 12 10 18\"/></svg></span></a></div> </div> <div class=\"st-hero-art\"> <img class=\"st-img\" src=\"/img/art.png\" alt=\"Art\" loading=\"eager\" decoding=\"async\"> </div> </section>",
    "Hero layered":
      "<section class=\"st-hero st-full-bleed st-hero-layered\" id=\"s8-hero-layered\" data-media=\"avatar\" data-logo-pos=\"bottom\"> <div class=\"st-hero-stage\" aria-hidden=\"true\"> <img class=\"st-hero-layer\" src=\"/img/back.png\" alt=\"\" data-depth=\"0\" loading=\"eager\" decoding=\"async\"><img class=\"st-hero-layer\" src=\"/img/front.png\" alt=\"\" data-depth=\"1\" loading=\"eager\" decoding=\"async\"> </div> <div class=\"st-hero-text st-hero-overlay\">  <h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt=\"Hero layered\" loading=\"eager\" decoding=\"async\"></h1> <p>Layered hero.</p>  </div> </section>",
    "Hero bare layered logo":
      "<section class=\"st-hero st-full-bleed st-hero-layered\" id=\"s13\" data-media=\"avatar\" data-logo-pos=\"bottom\"> <div class=\"st-hero-stage\" aria-hidden=\"true\"> <img class=\"st-hero-layer\" src=\"/img/back.png\" alt=\"\" data-depth=\"0\" loading=\"eager\" decoding=\"async\"><img class=\"st-hero-layer\" src=\"/img/front.png\" alt=\"\" data-depth=\"1\" loading=\"eager\" decoding=\"async\"> </div> <div class=\"st-hero-text st-hero-overlay\">  <h1 class=\"st-hero-logo\"><img src=\"/img/logo.png\" alt loading=\"eager\" decoding=\"async\"></h1> <p>Layered logo.</p>  </div> </section>",
  },
};
// reef#2869: LOGO_PIN is what each logo hero writes as the page's h1 OWNER — so each one is also
// rendered as the FIRST section of a page of its own (LOGO_OWNER_PAGES) and must match its pin byte
// for byte, its section id aside. In the fixture page above, where none of them is the owner, the
// pin's ONLY change is the heading element: `<h1 class="st-hero-logo">…</h1>` → `<h2 …>…</h2>`.
const LOGO_OWNER_PAGES = LOGO_HEROES.map((t, k) => {
  const c = CASES.find((x) => nameOf(x) === t);
  const slug = `logo-owner-${k}`;
  const md = `---\nsitetile-page: ${slug}\ntitle: ${slug}\nlang: en-US\n---\n\n##${c.title ? ' ' + c.title : ''}\n${c.marker}\n${c.body}\n\n## After\nMore.\n`;
  return { t, slug, md, site: parseSite(md) };
});
const pinWithId = (pin, id) => pin.replace(/ id="[^"]*"/, ` id="${id}"`);
const pinAsH2 = (pin) => {
  const out = pin.replace('<h1 class="st-hero-logo">', '<h2 class="st-hero-logo">').replace('</h1>', '</h2>');
  assert.ok(out !== pin && !out.includes('<h1') && !out.includes('</h1>'), 'pinAsH2: the pin holds exactly one logo <h1>');
  return out;
};
function assertLogoOwnerPages(where, htmlOf, pins) {
  for (const p of LOGO_OWNER_PAGES) {
    assert.equal(pageH1Index(p.site.sections), 0, `${p.slug}: the logo hero is the page's h1 owner`);
    const id = p.site.sections[0].id;
    assert.equal(rawSection(htmlOf(p), id), pinWithId(pins[p.t], id), `${where}, ${p.t} as the page's h1 owner`);
  }
}
const stringHtml = renderSiteToHtml(site);
if (process.env.SECTION_CONTRACT_DUMP_LOGO) for (const t of LOGO_HEROES) console.log('PIN string', JSON.stringify(t), JSON.stringify(rawSection(stringHtml, idOf(t))));
await test('🔴 string render: a text-free hero emits no heading (every variant); a titled/logo hero that is not the owner writes one <h2>', () => {
  assertHeroHeadings('string render', stringById);
});
await test('CONTROL string render: a logo hero that IS the page h1 owner is byte-identical to origin/main', () => {
  assertLogoOwnerPages('string render', (p) => renderSiteToHtml(p.site), LOGO_PIN.string);
});
await test('🔴 string render: a logo hero that is not the owner differs from its pin only by <h1> → <h2>', () => {
  for (const t of LOGO_HEROES) assert.equal(rawSection(stringHtml, idOf(t)), pinAsH2(LOGO_PIN.string[t]), `string render, ${t}`);
});

await test('heroHeadingless: whitespace counts as empty; a logo keeps the heading only where the variant draws it', () => {
  const h = (title, params) => heroHeadingless({ type: 'hero', title, params });
  assert.equal(h(' \t ', 'bg=/img/bg.png'), true, 'whitespace title');
  assert.equal(h('', 'bg=/img/bg.png logo=/img/logo.png'), true, 'legacy hero never draws logo= → no heading');
  assert.equal(h('', 'layout=split logo=/img/logo.png'), false, 'layout= logo hero keeps its image h1');
  assert.equal(h('', 'layers=/a.png logo=/img/logo.png'), false, 'layers= logo hero keeps its image h1');
  assert.equal(h('', 'layers=/a.png logo=javascript:alert(1)'), true, 'a refused logo destination draws nothing');
  assert.equal(h('Title', 'bg=/img/bg.png'), false, 'titled');
  assert.equal(heroHeadingless({ type: 'prose', title: '' }), false, 'only heroes');
  const ws = renderSiteToHtml(parseSite('---\nsitetile-page: home\ntitle: t\n---\n\n## Next\nx.\n'));
  assert.match(ws, /<h1>Next<\/h1>/, 'CONTROL: a page with no hero keeps its first-section h1');
  assert.equal(pageH1Index([{ type: 'hero', title: ' ', params: '' }, { type: 'hero', title: '', params: '' }, { type: 'prose', title: 'P' }]), 2);
});

// A page that OPENS with a text-free hero: the page's one <h1> is the next section's title.
const BARE_FIRST_MD = '---\nsitetile-page: bare-hero\ntitle: Bare hero first\nlang: en-US\n---\n\n'
  + '##\n%% sitetile: hero bg=/img/bg.png cta="Go"→/go %%\nPicture band.\n\n## Welcome\nThe first words.\n\n## Later\nMore.\n';
const bareFirst = parseSite(BARE_FIRST_MD);
function assertBareFirstPage(where, html) {
  const hs = all(parseHtml(html)).filter((k) => k.tag === 'section' && k.attrs.id).map((s) => ({ id: s.attrs.id, h: headings(s).map((h) => h.tag) }));
  const ids = bareFirst.sections.map((s) => s.id);
  assert.deepEqual(hs.filter((x) => ids.includes(x.id)).map((x) => x.h), [[], ['h1'], ['h2']], `${where}: headings per section of a page opening with a text-free hero`);
}
await test('🔴 string render: a page opening with a text-free hero takes its <h1> from the next section', () => {
  assertBareFirstPage('string render', renderSiteToHtml(bareFirst));
});

// reef#2857 r2 (review of 2f7bdee): the three pages the review built. Each is checked in BOTH
// renderers, as headings per section in document order.
//   · layers=" | " parses to zero layers → the legacy hero, which never draws logo= → no heading,
//     and Welcome is the page h1 (2f7bdee: <h1></h1> in the hero, Welcome <h2>).
//   · a titled gallery right after the text-free hero cannot render an h1 → NO section gets one;
//     Contact is not promoted past Portfolio's visible <h2> (2f7bdee: nobody had an h1 either, but
//     pageH1Index named the gallery — the string render and Section.astro believed an h1 existed).
//   · an untitled prose section writes no heading → passed over; Welcome is the page h1
//     (2f7bdee: the untitled section took the slot and the page had no h1).
const H1_PAGES = [
  { slug: 'h1-empty-layers', md: '##\n%% sitetile: hero layers=" | " logo=/logo.png %%\nBand.\n\n## Welcome\nHello.\n',
    want: [[], ['h1']], owner: 1 },
  { slug: 'h1-gallery-first', md: '##\n%% sitetile: hero bg=/img/bg.png %%\nBand.\n\n## Portfolio\n%% sitetile: gallery %%\n### Work\n![One](/img/1.png)\n\n## Contact\nWrite.\n',
    want: [[], ['h2', 'h3'], ['h2']], owner: -1 },
  { slug: 'h1-untitled-prose', md: '##\n%% sitetile: hero bg=/img/bg.png %%\nBand.\n\n##\nNo title here.\n\n## Welcome\nHello.\n',
    want: [[], [], ['h1']], owner: 2 },
  // reef#2869 (review of #2864): a titled hero that is not pageH1Index's owner writes <h2>, in all
  // three variants. The review's page — text-free hero, titled gallery, titled hero — has NO h1
  // (origin/main: the last hero wrote one). A titled hero mid-page was a second h1 on origin/main.
  { slug: 'h1-review-gallery-hero', md: '##\n%% sitetile: hero bg=/img/bg.png %%\nBand.\n\n## Portfolio\n%% sitetile: gallery %%\n### Work\n![One](/img/1.png)\n\n## Studio\n%% sitetile: hero %%\nA titled hero.\n',
    want: [[], ['h2', 'h3'], ['h2']], owner: -1, h1s: 0 },
  { slug: 'h1-hero-middle', md: '## Lead\nFirst.\n\n## Legacy\n%% sitetile: hero cta="Go"→/go %%\nA hero.\n\n## Split\n%% sitetile: hero layout=split %%\nSplit.\n\n[Act](/act)\n\n## Layered\n%% sitetile: hero layers=/img/back.png|/img/front.png %%\nLayered.\n\n## Logo\n%% sitetile: hero layout=split logo=/img/logo.png %%\nLogo.\n\n## End\nBye.\n',
    want: [['h1'], ['h2'], ['h2'], ['h2'], ['h2'], ['h2']], owner: 0, h1s: 1 },
  // CONTROL: a page that OPENS with a titled hero — that hero is the owner and keeps its <h1>; a
  // second titled hero further down is an <h2>.
  { slug: 'h1-hero-first', md: '## Welcome\n%% sitetile: hero layout=split %%\nHi.\n\n[Act](/act)\n\n## Studio\n%% sitetile: hero %%\nSecond hero.\n\n## More\nText.\n',
    want: [['h1'], ['h2'], ['h2']], owner: 0, h1s: 1 },
];
const h1PageMd = (p) => `---\nsitetile-page: ${p.slug}\ntitle: ${p.slug}\nlang: en-US\n---\n\n${p.md}`;
for (const p of H1_PAGES) p.site = parseSite(h1PageMd(p));
function assertH1Page(where, p, html) {
  const ids = p.site.sections.map((s) => s.id);
  assert.equal(ids.length, p.want.length, `${p.slug}: the fixture parsed into ${ids.length} sections`);
  const byId = sectionsById(html, where);
  const got = ids.map((id) => { const sec = byId.get(id); assert.ok(sec, `${where}, ${p.slug}: no section ${id}`); return headings(sec).map((h) => h.tag); });
  assert.deepEqual(got, p.want, `${where}, ${p.slug}: headings per section`);
  // The whole page, not only the sections this fixture names: its <main> (the string render, a
  // fragment, has none — the fragment is the page body).
  if (p.h1s != null) {
    const tree = parseHtml(html);
    const scope = all(tree).find((n) => n.tag === 'main') || tree;
    assert.equal(all(scope).filter((n) => n.tag === 'h1').length, p.h1s, `${where}, ${p.slug}: <h1> elements on the page`);
  }
}
for (const p of H1_PAGES) {
  await test(`🔴 pageH1Index, ${p.slug}: owner ${p.owner}`, () => assert.equal(pageH1Index(p.site.sections), p.owner, p.slug));
}
await test('pageH1Index: embed / h2-only types / unknown type / logo hero / empty page', () => {
  // embed writes no title at all → passed over like an untitled section
  const bare = { type: 'hero', title: '', params: 'bg=/img/a.jpg' };
  assert.equal(pageH1Index([bare, { type: 'embed', title: 'Video' }, { type: 'prose', title: 'P' }]), 2, 'embed after a text-free hero');
  for (const t of ['gallery', 'carousel', 'cta']) assert.equal(pageH1Index([bare, { type: t, title: 'T' }, { type: 'prose', title: 'P' }]), -1, t);
  // CONTROL — a page that does not open with a text-free hero keeps the first section as owner (master).
  assert.equal(pageH1Index([{ type: 'prose', title: '' }, { type: 'prose', title: 'P' }]), 0, 'no hero: untitled first section stays the owner');
  for (const t of ['gallery', 'embed']) assert.equal(pageH1Index([{ type: t, title: 'T' }, { type: 'prose', title: 'P' }]), 0, `no hero: ${t} first stays the owner`);
  assert.equal(pageH1Index([{ type: 'nonsense', title: 'T' }]), 0, 'an unknown type renders as prose');
  assert.equal(pageH1Index([{ type: 'hero', title: '', params: 'layout=split logo=/img/logo.png' }, { type: 'prose', title: 'P' }]), 0, 'a logo hero owns it');
  assert.equal(pageH1Index([]), 0, 'empty page');
});
await test('🔴 heroHeadingless reads the variant the renderers draw (zero parsed layers = legacy)', () => {
  const h = (params) => heroHeadingless({ type: 'hero', title: '', params });
  assert.equal(h('layers=" | " logo=/img/logo.png'), true, 'blank layer list → legacy → no logo drawn');
  assert.equal(h('layers=" | /a.png" logo=/img/logo.png'), false, 'CONTROL: one real layer → layered logo h1');
});
for (const p of H1_PAGES) {
  await test(`🔴 string render, ${p.slug}: headings per section`, () => assertH1Page('string render', p, renderSiteToHtml(p.site)));
}

await test('CONTROL: class tokens are compared as a list — `a.b` and `a b` differ', () => {
  const one = parseHtml('<section id="x" class="a.b"><p></p></section>').kids[0];
  const two = parseHtml('<section id="x" class="a b"><p></p></section>').kids[0];
  assert.notDeepEqual(shape(one), shape(two));
  assert.deepEqual(shape(two), shape(parseHtml('<section id="x" class="a  b"><p></p></section>').kids[0]));
});

await test('CONTROL: a duplicate section id fails instead of being overwritten, and a wrapper difference is seen', () => {
  assert.throws(() => sectionsById('<section id="d"></section><section id="d"></section>', 't'), /more than once/);
  const bare = sectionsById('<main><section id="w"><p></p></section></main>', 't').get('w');
  const wrapped = sectionsById('<main><div class="wrap"><section id="w"><p></p></section></div></main>', 't').get('w');
  assert.notDeepEqual(whole(bare), whole(wrapped));
});

const ASTRO = join(ENGINE, RENDERER_SUBPATH);
if (!existsSync(join(ASTRO, 'node_modules'))) {
  await test('🔴 the built page was compared (astro/node_modules is present)', () => {
    if (process.env.SECTION_CONTRACT_ALLOW_NO_ASTRO === '1') {
      console.log(`  · built page NOT compared — no ${RENDERER_SUBPATH}/node_modules and SECTION_CONTRACT_ALLOW_NO_ASTRO=1`);
      return;
    }
    assert.fail(`no ${RENDERER_SUBPATH}/node_modules — run npm ci there (or set SECTION_CONTRACT_ALLOW_NO_ASTRO=1 to skip knowingly)`);
  });
} else {
  const ir = mkdtempSync(join(tmpdir(), 'tile-section-contract-ir-'));
  const out = mkdtempSync(join(tmpdir(), 'tile-section-contract-out-'));
  try {
    writeFileSync(join(ir, 'home.md'), MD);
    // A non-root locale page with an action=inbox form: its return_to and "Back to homepage" depend
    // on the page path and on which locale homes exist, which only the CALLER of the string render
    // knows (opts.path / opts.contentRels). Written as its own pages so the built page has them too.
    mkdirSync(join(ir, 'zh-tw'), { recursive: true });
    writeFileSync(join(ir, 'zh-tw', 'home.md'), ZH_HOME_MD);
    writeFileSync(join(ir, 'zh-tw', 'contact.md'), ZH_CONTACT_MD);
    writeFileSync(join(ir, 'bare-hero.md'), BARE_FIRST_MD);
    for (const p of H1_PAGES) writeFileSync(join(ir, `${p.slug}.md`), h1PageMd(p));
    for (const p of LOGO_OWNER_PAGES) writeFileSync(join(ir, `${p.slug}.md`), p.md);
    const result = await buildSite({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' });
    const astroHtml = result.code === 0 ? readFileSync(join(out, 'index.html'), 'utf8') : '';
    const astroById = sectionsById(astroHtml, 'built page');

    await test('the fixture built, and every section is on the page under the id the string render gave it', () => {
      assert.equal(result.code, 0, 'astro build exited non-zero');
      for (const c of CASES) assert.ok(astroById.get(idOf(nameOf(c))), `no section ${nameOf(c)} in the built page`);
    });

    await test('🔴 built page: a linked cell holds no YouTube player (no <a> inside its <a>)', () => {
      assertNoPlayerInLinkedCell('built page', astroById);
    });

    if (process.env.SECTION_CONTRACT_DUMP_LOGO) for (const t of LOGO_HEROES) console.log('PIN built', JSON.stringify(t), JSON.stringify(rawSection(astroHtml, idOf(t))));
    await test('🔴 built page: a text-free hero emits no heading (every variant); a titled/logo hero that is not the owner writes one <h2>', () => {
      assertHeroHeadings('built page', astroById);
    });
    await test('CONTROL built page: a logo hero that IS the page h1 owner is byte-identical to origin/main', () => {
      assertLogoOwnerPages('built page', (p) => readFileSync(join(out, p.slug, 'index.html'), 'utf8'), LOGO_PIN.built);
    });
    await test('🔴 built page: a logo hero that is not the owner differs from its pin only by <h1> → <h2>', () => {
      for (const t of LOGO_HEROES) assert.equal(rawSection(astroHtml, idOf(t)), pinAsH2(LOGO_PIN.built[t]), `built page, ${t}`);
    });
    await test('🔴 built page: a page opening with a text-free hero takes its <h1> from the next section', () => {
      assertBareFirstPage('built page', readFileSync(join(out, 'bare-hero', 'index.html'), 'utf8'));
    });
    for (const p of H1_PAGES) {
      await test(`🔴 built page, ${p.slug}: headings per section`, () => assertH1Page('built page', p, readFileSync(join(out, p.slug, 'index.html'), 'utf8')));
    }

    const diffs = new Map();
    const SHOW = process.env.SECTION_CONTRACT_SHOW;
    for (const c of CASES) {
      const an = astroById.get(idOf(nameOf(c))), sn = stringById.get(idOf(nameOf(c)));
      const a = an ? whole(an) : { missing: true }, s = whole(sn);
      let same = true;
      try { assert.deepStrictEqual(a, s); } catch { same = false; }
      diffs.set(nameOf(c), same ? null : { a: JSON.stringify(a), s: JSON.stringify(s) });
      if (SHOW && !same) console.log('DIFF', nameOf(c), '\n--- built\n' + JSON.stringify(a) + '\n--- string\n' + JSON.stringify(s));
    }

    for (const c of CASES) {
      await test(`${nameOf(c)}: ${GAPS[nameOf(c)] ? `known gap "${GAPS[nameOf(c)]}" is still real` : 'identical structure'}`, () => {
        const d = diffs.get(nameOf(c)), gap = GAPS[nameOf(c)];
        if (gap) {
          assert.ok(XFAIL[gap], `gap ${gap} is not in XFAIL`);
          assert.ok(d, `${nameOf(c)} is now IDENTICAL in both renderers — remove "${gap}" from the xfail list`);
        } else {
          assert.ok(!d, `${nameOf(c)} differs between the renderers:\n--- built page\n${d && d.a}--- string render\n${d && d.s}`);
        }
      });
    }

    await test('Form inbox on /zh-tw/contact/: identical structure once the caller supplies path and contentRels', () => {
      const html = readFileSync(join(out, 'zh-tw', 'contact', 'index.html'), 'utf8');
      const id = zhSite.sections[0].id;
      const built = sectionsById(html, 'built page (zh-tw/contact)').get(id);
      const str = sectionsById(renderSiteToHtml(zhSite, {
        path: '/zh-tw/contact/',
        contentRels: contentRelsOf({ '/x/content/home.md': 1, '/x/content/zh-tw/home.md': 1, '/x/content/zh-tw/contact.md': 1 }),
      }), 'string render (zh-tw/contact)').get(id);
      assert.ok(built && str, 'the section is missing on one side');
      assert.deepStrictEqual(whole(str), whole(built));
      // …and the values the structure comparison cannot see
      const val = (n, sel) => all(n).find(sel);
      const hidden = (n, name) => val(n, (k) => k.tag === 'input' && k.attrs.name === name);
      assert.equal(hidden(built, 'return_to').attrs.value, '/zh-tw/contact/');
      assert.equal(hidden(str, 'return_to').attrs.value, hidden(built, 'return_to').attrs.value);
      assert.equal(hidden(str, 'thanks_to').attrs.value, hidden(built, 'thanks_to').attrs.value);
      const back = (n) => val(n, (k) => k.tag === 'p' && k.cls.includes('st-form-success-back')).kids[0].attrs.href;
      assert.equal(back(built), '/zh-tw/');
      assert.equal(back(str), back(built));
      assert.equal(str.attrs['data-inbox-copy'], built.attrs['data-inbox-copy']);
    });

    await test('every xfail entry is carried by at least one section, and every section gap names an entry', () => {
      const used = new Set(Object.values(GAPS));
      for (const k of Object.keys(XFAIL)) {
        // an entry may already be fixed (and so carried by no section) only if it was removed
        assert.ok(used.has(k), `xfail entry "${k}" is carried by no section — delete it`);
      }
      for (const g of used) assert.ok(XFAIL[g], `section gap "${g}" has no xfail entry`);
    });

    await test('CONTROL: the comparison can tell two different sections apart', () => {
      assert.notDeepEqual(whole(astroById.get(idOf('FAQ'))), whole(stringById.get(idOf('Timeline'))));
      assert.notDeepEqual(whole(astroById.get(idOf('Plain prose'))), whole(astroById.get(idOf('Gallery'))));
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
