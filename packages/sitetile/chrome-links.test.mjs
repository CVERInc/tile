// chrome-links.mjs — the one reader (and writer) of the link-bearing `_site.md` chrome keys.
//
// Three things are asserted here, all without a build:
//
//   1. PARITY. Every chrome value this repo holds — the frontmatter of every tracked .md file, every
//      `key: value` line in a tracked test or fixture source, a hand-written edge corpus, and a seeded
//      fuzz over each grammar's own alphabet — is read by the renderer's OLD inline readers (frozen
//      verbatim below, from SiteLayout.astro / PostView.astro as they stood before they were
//      replaced by imports of chrome-links.mjs) and by the module, and the two must agree on every
//      field. 🔴 The frozen copies are temporary: they are the oracle for the move, and can go once
//      nobody needs to see that the move changed nothing. Two entries are NOT frozen copies but the
//      live second readers chrome-links.mjs's header names — site-core.js's parseSidebarNav and
//      lib/announce.mjs's `announce-href` — and those stay as a standing pin.
//   2. SPANS. Every link parseChromeLinks reports names the exact characters of its href in the raw
//      value, and every href the old reader took from the value is reported, in order.
//   3. THE ROUND-TRIP LAW. withHref(key, v, link, link.href) === v for every link of every value, and
//      a hostile new href lands as exactly one link whose decoded target is the one asked for, with
//      every other part of the parse unchanged — or withHref refuses.
//
// The render half of the law (the HTML differs only in that link's target) needs the renderer's
// dependencies and lives in chrome-links-render.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, parseSidebarNav } from './site-core.js';
import { announceModel } from './astro/src/lib/announce.mjs';
import {
  CHROME_LINK_KEYS, parseChromeLinks, withHref,
  navMenuOf, footerLinksOf, footerColsOf, labelHrefListOf, headerCtaOf, headerActionsOf, postCtaOf,
  sidebarNavOf, hrefValueOf, parseNavPart, parseNavIndented, parseNavFlat,
} from './chrome-links.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));

// ── the OLD readers, frozen verbatim ─────────────────────────────────────────────────────────────
// Each takes the raw meta value (as `meta[key]` holds it) and returns what the layout consumed.
const OLD = (() => {
  const parseNavPart = (part) => { const m = part.match(/^(.*\S)\s+(\S+)$/); return m ? { label: m[1], href: m[2] } : { label: part, href: '#' }; };
  const parseNavIndented = (text) => {
    const root = { children: [] };
    const stack = [{ node: root, indent: -1 }];
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      const indent = (raw.match(/^[ \t]*/)[0] || '').replace(/\t/g, '  ').length;
      const item = { ...parseNavPart(raw.replace(/^[ \t]*-?[ \t]*/, '').trim()), children: [] };
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      stack[stack.length - 1].node.children.push(item);
      stack.push({ node: item, indent });
    }
    return root.children;
  };
  const parseNavFlat = (text) => text.split('|').map((s) => s.trim()).filter(Boolean)
    .map((part) => ({ ...parseNavPart(part), children: [] }));
  const list = (v) => String(v || '').split(';').map((s) => s.trim()).filter(Boolean)
    .map((part) => { const m = part.match(/^(.*\S)\s*=\s*(\S+)$/); return m ? { label: m[1].trim(), href: m[2].trim() } : null; })
    .filter(Boolean);
  // SiteLayout's parseHeaderAction, minus the two layout-only lookups (icon SVG, element ids) that
  // are computed from fields compared here.
  const parseHeaderAction = (label, spec) => {
    const t = String(spec || '').trim().split(/\s+/).filter(Boolean);
    const iconName = t[0] || '';
    const type = (t[1] === 'toggle') ? 'toggle' : 'link';
    const target = t[2] || '';
    let reveal = '', badge = null, mobile = false;
    for (const tok of t.slice(3)) {
      if (tok === 'mobile') mobile = true;
      else if (tok === 'dropdown' || tok === 'drawer' || tok.startsWith('drawer:')) reveal = tok;
      else if (tok === 'badge' || tok.startsWith('badge:')) badge = tok.indexOf(':') >= 0 ? tok.slice(tok.indexOf(':') + 1) : '';
    }
    const side = reveal.startsWith('drawer:') ? reveal.slice(7) : (reveal === 'drawer' ? 'right' : 'right');
    const key = target || iconName;
    return { label, iconName, type, target, reveal, side, badge, mobile, key };
  };
  return {
    nav: (v) => { const navRaw = String(v || ''); return navRaw.includes('\n') ? parseNavIndented(navRaw) : parseNavFlat(navRaw); },
    footer: (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const di = s.indexOf('>>'); return di >= 0 ? s.slice(0, di).trim() : s; })
      .map((part) => { const m = part.match(/^(.*\S)\s+(\S+)$/); return m ? { label: m[1], href: m[2] } : { label: part, href: '#' }; }),
    'footer-cols': (v) => String(v || '').split(';;').map((c) => c.trim()).filter(Boolean).map((col) => {
      const firstColon = col.indexOf(':');
      const ci = firstColon >= 0 && !col.slice(0, firstColon).includes('=') ? firstColon : -1;
      const head = ci >= 0 ? col.slice(0, ci).trim() : '';
      const itemsRaw = ci >= 0 ? col.slice(ci + 1) : col;
      const items = itemsRaw.split(';').map((s) => s.trim()).filter(Boolean).map((it) => {
        const m = it.match(/^(.*\S)\s*=\s*(\S+)$/); return m ? { label: m[1].trim(), href: m[2].trim() } : { label: it, href: '' };
      });
      return { head, items };
    }),
    'footer-social': list,
    'sidebar-social': list,
    'breadcrumb-trail': list,
    'age-gate-note-links': list,
    // site-core.js's parseSidebarNav is not frozen: it stays the reference renderer's (editor
    // preview) reader, so this is a standing pin between the two, not a one-off check.
    'sidebar-nav': (v) => parseSidebarNav(v),
    'header-cta': (v) => { const m = String(v || '').match(/^(.*\S)\s*=\s*(\S+)$/); return m ? { label: m[1].trim(), href: m[2].trim() } : null; },
    'header-actions': (v) => String(v || '').split(';').map((s) => s.trim()).filter(Boolean)
      .map((part) => { const m = part.match(/^(.*\S)\s*=\s*(\S.*)$/); return m ? parseHeaderAction(m[1].trim(), m[2].trim()) : null; })
      .filter(Boolean),
    'blog-post-cta': (v) => {
      const ctaRaw = String(v || '').trim();
      const ctaEq = ctaRaw.indexOf('=');
      return ctaRaw && ctaEq > 0 ? { label: ctaRaw.slice(0, ctaEq).trim(), href: ctaRaw.slice(ctaEq + 1).trim() } : null;
    },
    // The whole-value keys: SiteLayout (`String(meta[k]).trim()` behind a truthiness test, or
    // `String(meta[k] || '').trim()`) and lib/announce.mjs (`announce-href`, the same).
    'copyright-href': (v) => (v ? String(v).trim() : ''),
    'language-href': (v) => (v ? String(v).trim() : ''),
    'header-actions-cart-href': (v) => (v ? String(v).trim() : ''),
    'age-gate-back-url': (v) => String(v || '').trim(),
    'announce-href': (v) => announceModel({ announce: 'x', 'announce-href': v }, { safeHref: (h) => h }).href,
  };
})();

// The module's own reader for each key, in the shape the layout consumes.
const NEW = {
  nav: navMenuOf,
  footer: footerLinksOf,
  'footer-cols': footerColsOf,
  'footer-social': labelHrefListOf,
  'sidebar-social': labelHrefListOf,
  'breadcrumb-trail': labelHrefListOf,
  'age-gate-note-links': labelHrefListOf,
  'sidebar-nav': sidebarNavOf,
  'header-cta': headerCtaOf,
  'header-actions': headerActionsOf,
  'blog-post-cta': postCtaOf,
  'copyright-href': hrefValueOf,
  'language-href': hrefValueOf,
  'header-actions-cart-href': hrefValueOf,
  'age-gate-back-url': hrefValueOf,
  'announce-href': hrefValueOf,
};
const KEYS = Object.keys(OLD);

// Every href the OLD model took FROM THE VALUE, in reading order. `#` is the nav/footer default for a
// label with no href, `''` the footer-cols/sidebar-nav one; neither can be told from an authored
// `#` by the old model alone, so those are allowed to be absent from the module's list.
function oldHrefs(key, model) {
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.items) { n.items.forEach(walk); return; }
    if (key === 'header-actions') { if (n.type === 'link' && n.target) out.push(n.target); return; }
    out.push(n.href);
    if (n.children) n.children.forEach(walk);
  };
  walk(model);
  return out;
}

// ── the corpus ───────────────────────────────────────────────────────────────────────────────────
const tracked = (...globs) => execFileSync('git', ['-C', ENGINE, 'ls-files', '-z', '--', ...globs], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const corpus = new Map(KEYS.map((k) => [k, new Set()]));
const add = (k, v) => { if (corpus.has(k) && v != null) corpus.get(k).add(String(v)); };

// (a) the frontmatter of every tracked Markdown file, read by the renderer's own frontmatter parser
//     (so a `nav: |` block arrives as the value the layout sees).
let mdFiles = 0;
for (const rel of tracked('*.md')) {
  let text;
  try { text = readFileSync(join(ENGINE, rel), 'utf8'); } catch { continue; }
  const { meta } = splitFrontmatter(text);
  let hit = false;
  for (const k of KEYS) if (meta[k] != null) { add(k, meta[k]); hit = true; }
  if (hit) mdFiles++;
}
// (b) every single-line `key: value` written inside a tracked JS source (test IR, fixtures, smokes).
const KEY_RE = new RegExp(`(?:^|\\\\n|\\n|['"\`])(${KEYS.map((k) => k.replace(/-/g, '\\-')).join('|')}):[ \\t]*([^\\n'"\`]*?)(?=\\\\n|\\n|['"\`]|$)`, 'g');
let srcHits = 0;
for (const rel of tracked('*.mjs', '*.js', '*.cjs')) {
  if (rel.startsWith('packages/sitetile/chrome-links')) continue;
  let text;
  try { text = readFileSync(join(ENGINE, rel), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(KEY_RE)) { const v = m[2].replace(/\\t/g, '\t').trim(); if (v && !v.includes('${')) { add(m[1], v); srcHits++; } }
}
// (c) the edge corpus — every shape the grammars disagree about, written down once.
const EDGE = {
  nav: ['A /a | B /b', 'Solo', 'A /a |  | B', '  A  /a  |B /b  ', 'A B C /x?q=1#f', 'A /a >> B /b ; C /c', 'Ünï 關於 /關於/', 'A /x|y',
    '- A /a\n  - B /b\n    - C /c\n- D', '- A /a\n\t- B /b\n  - C', 'A /a\n\nB /b', '-A /a\n -B', '- /only', '- A  /a  \r\n- B /b\r', 'A\u3000/a | B /b'],
  footer: ['A /a | B /b', 'A /a >> B /b | C /c', '>> B /b', 'A >> /b', 'A/a', 'A /x>y | B /b', 'Shop https://x.example/s?a=b | C /c'],
  'footer-cols': ['Company: About=/about ;; Help & Support!: FAQ=/faq ;; --Mixed__Case 42--: A=/a',
    'About=https://x.example/about ; Help=/help', 'Heading: A=https://x.example/a', 'Soon ; A=/x:y', ': A=/a', 'H: A = /a ; B ; C=/c=d',
    'A=/a ;;; B=/b', 'H:;;', 'H: A=/a;B=/b;;H2:C=/c'],
  'sidebar-nav': ['Cats: A=/a ; B=/b^12 ;; Tags: T=/t^9.5', 'A=https://x.example/a ; B=/b', 'A=/x:y ; B=/b', 'H: A=mailto:me@x.example',
    'A=^12', 'A=/a^ ; B=/b^1.', 'A = /a^3^4', ':: A=/a', 'H: A=/a ;; ;; H2: B'],
  'footer-social': ['Facebook=https://x.example/f ; Insta = https://x.example/i', 'A=/a;B', ' ; ;', 'A=b=c', 'A =', '=x'],
  'sidebar-social': ['A=https://x.example/a'],
  'breadcrumb-trail': ['Cat=/cat ; Sub=/cat/sub', 'Cat'],
  'age-gate-note-links': ['Shop A=https://x.example/a ; Shop B=https://x.example/b'],
  'header-cta': ['Subscribe=/subscribe', 'Buy = /shop?a=b', '  Pad = /p  ', 'NoHref', 'A=/x y'],
  'header-actions': ['Cart = cart toggle cart drawer:right badge:0 ; Menu = bars toggle sidebar mobile', 'Search = magnifier link /search',
    'S = magnifier link', 'S = magnifier toggle /x', 'S = m l /a ; T = m l https://x.example/t?q=1 mobile', 'X=y', 'A = i link /a=b'],
  'blog-post-cta': ['Support us=/donate', '  Pad = /p?a=b c  ', '=/x', 'A=', 'Plain', 'A=/a=b;c'],
  'copyright-href': ['/about', '  https://x.example/  ', ''],
  'language-href': ['/language'],
  'header-actions-cart-href': ['/cart'],
  'age-gate-back-url': ['/somewhere-else', ''],
  'announce-href': ['/news', ' /a b '],
};
for (const [k, vs] of Object.entries(EDGE)) vs.forEach((v) => add(k, v));
// (d) a seeded fuzz over every grammar's alphabet at once — offsets are where a port goes wrong.
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(0xC4120E);
const ATOMS = ['A', 'Shop', '關於', 'a b', '/a', '/b/c', 'https://x.example/p?q=1', '//x.example/n', 'mailto:me@x.example', '#', '/w^12', '^3', '/p;q', '/a=b',
  '/x:y', '|', ';', ';;', '=', ' = ', ':', ' >> ', '>>', '\n', '\n  - ', '\n- ', '\n\t', ' ', '  ', '\t', '\u3000', '-', 'cart', 'toggle', 'link', 'sidebar',
  'mobile', 'badge:2', 'drawer:left', '\r'];
for (const k of KEYS) for (let i = 0; i < 1500; i++) {
  let s = '';
  const n = 1 + Math.floor(rnd() * 12);
  for (let j = 0; j < n; j++) s += ATOMS[Math.floor(rnd() * ATOMS.length)];
  add(k, s);
}

test('the corpus actually holds the repo\'s own chrome values', () => {
  assert.ok(mdFiles >= 5, `expected chrome keys in several tracked .md files, found ${mdFiles}`);
  assert.ok(srcHits >= 10, `expected chrome lines in tracked sources, found ${srcHits}`);
  for (const k of KEYS) assert.ok(corpus.get(k).size > 1000, `${k}: corpus is ${corpus.get(k).size}`);
  assert.deepEqual([...CHROME_LINK_KEYS].sort(), [...KEYS].sort(), 'CHROME_LINK_KEYS must be exactly the keys this suite covers');
});

for (const k of KEYS) {
  test(`parity: ${k} — the module reads every value exactly as the old inline reader did`, () => {
    for (const v of corpus.get(k)) assert.deepEqual(NEW[k](v), OLD[k](v), `${k}: ${JSON.stringify(v)}`);
    // non-string meta values (a YAML-less parser never produces them, but the readers coerce them)
    for (const v of [undefined, null, '', 0, false]) assert.deepEqual(NEW[k](v), OLD[k](v), `${k}: ${String(v)}`);
  });

  test(`spans: ${k} — every reported href is its exact characters, and none the old reader read is missing`, () => {
    for (const v of corpus.get(k)) {
      const links = parseChromeLinks(k, v);
      let last = -1;
      for (const l of links) {
        assert.equal(v.slice(l.start, l.end), l.href, `${k}: span of ${JSON.stringify(l)} in ${JSON.stringify(v)}`);
        assert.ok(l.href.length > 0 && l.start > last, `${k}: links are non-empty and in order in ${JSON.stringify(v)}`);
        last = l.start;
      }
      const want = oldHrefs(k, OLD[k](v));
      let i = 0;
      for (const h of want) {
        if (i < links.length && links[i].href === h) { i++; continue; }
        assert.ok(h === '#' || h === '', `${k}: old reader's href ${JSON.stringify(h)} is not reported for ${JSON.stringify(v)}`);
      }
      assert.equal(i, links.length, `${k}: module reports links the old reader never read in ${JSON.stringify(v)}`);
    }
  });

  test(`round-trip law: ${k} — writing a link's own href back is the identity`, () => {
    for (const v of corpus.get(k)) for (const l of parseChromeLinks(k, v)) assert.equal(withHref(k, v, l, l.href), v, `${k}: ${JSON.stringify(v)} @${l.start}`);
  });
}

// The parse with every href (and what an href decides: a header action's target and key) masked.
function maskHrefs(key, model) {
  if (model == null || typeof model === 'string') return model == null ? model : '·';
  return JSON.parse(JSON.stringify(model, (name, val) => (
    name === 'href' || (key === 'header-actions' && (name === 'target' || name === 'key')) ? '·' : val)));
}

// A path built from every character any of the grammars treats as syntax.
const HOSTILE = ['/Jane;Doe/new/', '/a b/', '/p|q/', '/x>>y/', '/k=v/', '/c:d/', '/w^12', '/tab\there/', '/ideo\u3000space/', '/all ;|=:>>^\t/'];
for (const k of KEYS) {
  test(`writer: ${k} — a hostile href lands as one link, decoding to what was asked, with nothing else moved`, () => {
    let wrote = 0;
    for (const v of corpus.get(k)) {
      const links = parseChromeLinks(k, v);
      for (let idx = 0; idx < links.length; idx++) for (const target of HOSTILE) {
        let out;
        try { out = withHref(k, v, links[idx], target); } catch (e) {
          assert.match(String(e && e.message), /^withHref: /, `${k}: withHref failed with something other than its refusal`);
          continue;
        }
        wrote++;
        const after = parseChromeLinks(k, out);
        assert.equal(after.length, links.length, `${k}: link count moved in ${JSON.stringify(out)}`);
        assert.equal(decodeURIComponent(after[idx].href), target, `${k}: ${JSON.stringify(out)}`);
        assert.equal(after[idx].start, links[idx].start);
        assert.equal(out.slice(0, links[idx].start), v.slice(0, links[idx].start), 'nothing before the link moves');
        assert.equal(out.slice(after[idx].end), v.slice(links[idx].end), 'nothing after the link moves');
        // every other link is where and what it was…
        for (let j = 0; j < links.length; j++) {
          assert.equal(after[j].label, links[j].label, `${k}: label ${j} moved in ${JSON.stringify(out)}`);
          if (j !== idx) assert.equal(after[j].href, links[j].href, `${k}: link ${j} moved in ${JSON.stringify(out)}`);
        }
        // …and so is everything in the parse that is not an href (labels, headings, tree, weights, flags)
        assert.deepEqual(maskHrefs(k, NEW[k](out)), maskHrefs(k, NEW[k](v)), `${k}: ${JSON.stringify(v)} → ${JSON.stringify(out)}`);
      }
    }
    assert.ok(wrote > 0, `${k}: the writer never succeeded`);
  });
}

test('writer: the brief\'s own example — `;` in a `label=href` list is written as %3B', () => {
  const v = 'Home=/ ; Jane=/old/ ; Shop=/shop';
  const [, jane] = parseChromeLinks('footer-social', v);
  assert.equal(withHref('footer-social', v, jane, '/Jane;Doe/new/'), 'Home=/ ; Jane=/Jane%3BDoe/new/ ; Shop=/shop');
  // …but in nav, where `;` is not syntax, the readable spelling survives as one link
  const n = 'Home / | Jane /old/';
  assert.equal(withHref('nav', n, parseChromeLinks('nav', n)[1], '/Jane;Doe/new/'), 'Home / | Jane /Jane;Doe/new/');
  // and `|` in nav is
  assert.equal(withHref('nav', n, parseChromeLinks('nav', n)[1], '/a|b/'), 'Home / | Jane /a%7Cb/');
});

test('writer: a footer item keeps its collapsed `>>` tail, and `>>` in its new href is encoded', () => {
  const v = 'A /a >> B /b | C /c';
  const [a] = parseChromeLinks('footer', v);
  assert.deepEqual(a, { label: 'A', href: '/a', start: 2, end: 4 });
  assert.equal(withHref('footer', v, a, '/x>>y'), 'A /x%3E%3Ey >> B /b | C /c');
});

test('writer: a query keeps its delimiters — a grammar that cannot hold them raw refuses', () => {
  const list = 'A=/old ; B=/b';
  const a = parseChromeLinks('footer-social', list)[0];
  assert.throws(() => withHref('footer-social', list, a, '/new?x=1'), /^Error: withHref: /);
  assert.throws(() => withHref('footer-social', list, a, '/new?x;y'), /^Error: withHref: /);
  // whitespace and never-valid characters in a query are still encoded
  assert.equal(withHref('footer-social', list, a, '/new?qa b'), 'A=/new?qa%20b ; B=/b');
  // where `=` / `;` are not syntax, the query is written as asked
  const n = 'A /old | B /b';
  assert.equal(withHref('nav', n, parseChromeLinks('nav', n)[0], '/new?x=1;y=2#f:g'), 'A /new?x=1;y=2#f:g | B /b');
  const c = 'Go=/old';
  assert.equal(withHref('blog-post-cta', c, parseChromeLinks('blog-post-cta', c)[0], '/new?x=1;y'), 'Go=/new?x=1;y');
});

test('writer: a sidebar-nav `^weight` stays the weight, and a `^n` in the new href is encoded', () => {
  const v = 'Tags: A=/a^12 ; B=/b';
  const [a, b] = parseChromeLinks('sidebar-nav', v);
  assert.deepEqual([a.href, b.href], ['/a', '/b']);
  assert.equal(withHref('sidebar-nav', v, a, '/new'), 'Tags: A=/new^12 ; B=/b');
  assert.equal(withHref('sidebar-nav', v, b, '/c^3'), 'Tags: A=/a^12 ; B=/c%5E3');
  assert.deepEqual(sidebarNavOf(withHref('sidebar-nav', v, b, '/c^3'))[0].items[1], { label: 'B', href: '/c%5E3' });
});

test('writer: a scheme and an authority keep their colons; a colon that would become a group heading is encoded', () => {
  const v = 'A=/old ; B=/b';
  const [a] = parseChromeLinks('sidebar-nav', v);
  assert.equal(withHref('sidebar-nav', v, a, 'https://x.example/p'), 'A=https://x.example/p ; B=/b');
  // a port's colon is the headless group's first bare colon, and an authority cannot be encoded
  assert.throws(() => withHref('sidebar-nav', v, a, 'https://x.example:8443/p'), /^Error: withHref: /);
  assert.equal(withHref('sidebar-nav', v, a, '/c:d'), 'A=/c%3Ad ; B=/b');
  // a headless group's first bare colon IS the heading separator, and `mailto:` cannot be encoded
  assert.throws(() => withHref('sidebar-nav', v, a, 'mailto:me@x.example'), /^Error: withHref: /);
  // under a heading it is just a link
  const h = 'H: A=/old';
  assert.equal(withHref('sidebar-nav', h, parseChromeLinks('sidebar-nav', h)[0], 'mailto:me@x.example'), 'H: A=mailto:me@x.example');
  assert.equal(withHref('sidebar-nav', h, parseChromeLinks('sidebar-nav', h)[0], 'https://x.example:8443/a b'), 'H: A=https://x.example:8443/a%20b');
});

test('writer: an indented nav keeps its tree when a child moves', () => {
  const v = '- Shop /shop\n  - Hats /shop/hats\n  - Bags /shop/bags\n- About /about';
  const links = parseChromeLinks('nav', v);
  assert.deepEqual(links.map((l) => l.href), ['/shop', '/shop/hats', '/shop/bags', '/about']);
  const out = withHref('nav', v, links[1], '/new hats/');
  assert.equal(out, '- Shop /shop\n  - Hats /new%20hats/\n  - Bags /shop/bags\n- About /about');
  assert.equal(navMenuOf(out)[0].children[0].href, '/new%20hats/');
});

test('writer: a stale or foreign link, an empty href, and an unknown key are refused', () => {
  const v = 'A /a | B /b';
  assert.throws(() => withHref('nav', v, { label: 'A', href: '/zz', start: 2, end: 4 }, '/x'), /^Error: withHref: /);
  assert.throws(() => withHref('nav', v, { label: 'A', href: '/a', start: 1, end: 3 }, '/x'), /^Error: withHref: /);
  assert.throws(() => withHref('nav', v, parseChromeLinks('nav', v)[0], ''), /^Error: withHref: /);
  assert.throws(() => withHref('cell-cta', v, { start: 0, end: 1, href: 'A' }, '/x'), /^Error: withHref: /);
  assert.deepEqual(parseChromeLinks('cell-cta', 'A=/a'), []);
});

test('writer: a line break never reaches the value raw, so a one-line key stays one line', () => {
  for (const k of ['copyright-href', 'blog-post-cta', 'header-cta']) {
    const v = k === 'copyright-href' ? '/old' : 'Go=/old';
    const out = withHref(k, v, parseChromeLinks(k, v)[0], '/a\nb');
    assert.ok(!/[\r\n]/.test(out), `${k}: ${JSON.stringify(out)}`);
    assert.equal(decodeURIComponent(parseChromeLinks(k, out)[0].href), '/a\nb');
  }
});

test('legacy names: parseNavPart / parseNavIndented / parseNavFlat keep their shapes for vendored readers', () => {
  assert.deepEqual(parseNavPart('A B /x'), { label: 'A B', href: '/x' });
  assert.deepEqual(parseNavPart('Solo'), { label: 'Solo', href: '#' });
  assert.deepEqual(parseNavFlat('A /a | B'), [{ label: 'A', href: '/a', children: [] }, { label: 'B', href: '#', children: [] }]);
  assert.deepEqual(parseNavIndented('- A /a\n  - B /b'), [{ label: 'A', href: '/a', children: [{ label: 'B', href: '/b', children: [] }] }]);
  // and nothing about where an href sits leaks into the objects a template or a JSON diff sees
  assert.deepEqual(Object.keys(navMenuOf('A /a')[0]), ['label', 'href', 'children']);
  assert.deepEqual(Object.keys(sidebarNavOf('A=/a^2')[0].items[0]), ['label', 'href', 'weight']);
});
