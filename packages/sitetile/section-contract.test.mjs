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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';
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
  { title: 'Hero layered', marker: '%% sitetile: hero layers=/img/back.png|/img/front.png logo=/img/logo.png %%', body: 'Layered hero.' },
  { title: 'Grid cells', marker: '%% sitetile: grid cols=3 %%',
    body: '### Plain\nBody one.\n\n### Linked →/internal\nBody two.\n\n### Labelled →/x "Read"\nBody three.\n\n### 🎉 Emoji\nBody four.\n\n### Badged [New]\nBody five.\n\n### External →https://example.com/e\nBody six.' },
  { title: '', label: 'Grid untitled', marker: '%% sitetile: grid cols=2 %%', body: '### Only\nBody.' },
  { title: 'Collection later', marker: '%% sitetile: collection %%', body: '### Group\n#### Item one\nBody one.\n\n#### Item two\nBody two.' },
  { title: 'Form', marker: '%% sitetile: form %%', body: 'Write to us.\n\n### Name {required}\n### Email {email}\n### Topic\n- A\n- B\n### Message {textarea}' },
  { title: 'Form inbox', marker: '%% sitetile: form action=inbox %%', body: 'Write to us.\n\n### Email {email}\n### Message {textarea}' },
  { title: 'FAQ', marker: '%% sitetile: faq %%', body: '### Why?\nBecause.\n\n### How?\nLike this.' },
  { title: 'Timeline', marker: '%% sitetile: timeline %%', body: '### 2020\nStart.\n\n### 2021\nGrowth.' },
  { title: 'CTA', marker: '%% sitetile: cta %%', body: 'Come along.\n\n[Join](/join)' },
  { title: 'Gallery', marker: '%% sitetile: gallery %%', body: '![One](/img/1.png)\n\n![Two](/img/2.png)' },
];

// Known gaps, by name. Each must be real (the sections tagged with it differ) or the test fails.
// Remove the entry when the gap is closed.
const XFAIL = {
  'form-inbox': 'action=inbox: Form.astro adds the success card, return_to hidden input, honeypot, error line and script; the string branch has none of them (S4b)',
  'hero-layered': 'string render has no st-hero-layered variant (layers= / logo=)',
  'collection-card-heading': 'a collection item title is <h4> in the string render and <h3> in the built page (non-first section)',
};
// The sections that carry a gap, by title.
const GAPS = {
  'Hero layered': 'hero-layered',
  'Collection later': 'collection-card-heading',
  'Form inbox': 'form-inbox',
};

const MD = '---\nsitetile-page: home\ntitle: Section contract\nlang: en-US\n---\n\n'
  + CASES.map((c) => `##${c.title ? ' ' + c.title : ''}\n${c.marker ? c.marker + '\n' : ''}${c.body}\n`).join('\n');
const site = parseSite(MD);
const nameOf = (c) => c.label || c.title;
const idOf = (title) => site.sections[CASES.findIndex((c) => nameOf(c) === title)].id;

const stringById = sectionsById(renderSiteToHtml(site), 'string render');

await test('the fixture parsed into the section types it was written as', () => {
  const want = ['prose', 'prose', 'prose', 'prose', 'hero', 'hero', 'hero', 'grid', 'grid', 'collection', 'form', 'form', 'faq', 'timeline', 'cta', 'gallery'];
  assert.deepEqual(site.sections.map((s) => s.type), want);
  for (const c of CASES) assert.ok(stringById.get(idOf(nameOf(c))), `string render has no section for ${nameOf(c)}`);
});

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
    const result = await buildSite({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' });
    const astroHtml = result.code === 0 ? readFileSync(join(out, 'index.html'), 'utf8') : '';
    const astroById = sectionsById(astroHtml, 'built page');

    await test('the fixture built, and every section is on the page under the id the string render gave it', () => {
      assert.equal(result.code, 0, 'astro build exited non-zero');
      for (const c of CASES) assert.ok(astroById.get(idOf(nameOf(c))), `no section ${nameOf(c)} in the built page`);
    });

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
