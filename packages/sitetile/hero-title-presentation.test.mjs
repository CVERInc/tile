// Guard (reef#2869 r2): a hero title keeps the hero's typography at EITHER heading level.
//   run: node packages/sitetile/hero-title-presentation.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 reef#2869 made a hero's title the page <h1> only when the hero is the page's h1 owner
// (pageH1Index) and an <h2> anywhere else. site.css styled the hero title ONLY as `.st-hero h1`
// (font-size clamp, line-height 1.1, margin 0, max-width 18ch, and the compiled-theme `--gd-h1`
// font-size), so a demoted <h2> fell back to plain heading styling and lost its 18ch measure. The
// structural tests (section-contract) see the right element and are green either way: only the
// stylesheet can say what the heading LOOKS like.
//
// Both renderers stamp `.st-hero-title` on the hero heading (h1 or h2, logo heading included) and
// site.css targets that class. This file checks it two ways:
//   1. TEXT (always runs, no dependencies): every site.css rule that styles `.st-hero h1` also
//      carries the class arm at the SAME specificity, and the lilac example theme does too.
//   2. CASCADE (needs packages/sitetile/astro/node_modules for css-tree + css-select; says SKIPPED
//      by name without them): render the review's page and a hero-first page with the STRING
//      renderer, match every site.css rule against the real elements with css-select, and resolve
//      font-size / line-height / max-width / margin by layer, specificity and source order. The
//      owner <h1>, the demoted <h2>, and an <h1> without the class (a page built before the class
//      existed) must resolve to the same values. 🔴 No browser: this emulates the cascade for
//      author rules only (UA defaults, inheritance and @media/@supports-nested rules are out of it).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_CSS = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const LILAC_CSS = readFileSync(join(HERE, 'examples/lilac/theme.css'), 'utf8');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Selector lists (split on top-level commas) of every rule whose selector mentions `.st-hero` and `h1`. */
function heroH1Rules(css) {
  const out = [];
  for (const m of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (/\.st-hero\b[^,]*\bh1\b/.test(sel)) out.push({ arms: sel.split(/,(?![^(]*\))/).map((s) => s.trim()), css: m[2] });
  }
  return out;
}

// The review's page: prose owns the h1, the hero below it writes <h2>.
const DEMOTED_MD = '---\nsitetile-page: p\ntitle: p\nlang: en-US\n---\n\n## Lead\nWelcome.\n\n'
  + '## Our studio and the people behind our work\n%% sitetile: hero %%\nAbout us.\n';
// A page that opens with the same hero: it IS the owner and writes <h1>.
const OWNER_MD = '---\nsitetile-page: q\ntitle: q\nlang: en-US\n---\n\n'
  + '## Our studio and the people behind our work\n%% sitetile: hero %%\nAbout us.\n\n## After\nMore.\n';
const ownerHtml = renderSiteToHtml(parseSite(OWNER_MD));
const demotedHtml = renderSiteToHtml(parseSite(DEMOTED_MD));

await test('both pages render the hero title with `.st-hero-title`: <h1> as the owner, <h2> demoted', () => {
  assert.match(ownerHtml, /<section class="st-hero[^"]*"[^>]*><h1 class="st-hero-title">Our studio/, 'owner hero title');
  assert.match(demotedHtml, /<section class="st-hero[^"]*"[^>]*><h2 class="st-hero-title">Our studio/, 'demoted hero title');
});

const SAME_SPEC_ARM = /^(html |body:not\(\[data-theme-custom\]\) )?\.st-hero :is\(h1, h2\):where\(\.st-hero-title\)$/;
await test('TEXT: every site.css `.st-hero … h1` rule also styles `.st-hero-title` at the same specificity', () => {
  const rules = heroH1Rules(SITE_CSS);
  assert.ok(rules.length >= 2, `expected the base hero rule and the compiled-theme override, found ${rules.length}`);
  for (const r of rules) {
    const h1Arm = r.arms.find((a) => /\.st-hero h1$/.test(a));
    assert.ok(h1Arm, `no plain \`.st-hero h1\` arm (pages built before the class): ${r.arms.join(', ')}`);
    const classArm = r.arms.find((a) => SAME_SPEC_ARM.test(a));
    assert.ok(classArm, `\`${h1Arm}\` has no \`.st-hero :is(h1, h2):where(.st-hero-title)\` arm, so a demoted <h2> hero title loses { ${r.css.trim()} }`);
    assert.equal(classArm.replace(/\s*\.st-hero :is.*$/, ''), h1Arm.replace(/\s*\.st-hero h1$/, ''), 'the class arm keeps the h1 arm\'s context prefix');
  }
  const base = rules.find((r) => /max-width:\s*18ch/.test(r.css));
  assert.ok(base, 'the base hero-title rule (max-width: 18ch) is gone');
  for (const p of [/font-size:/, /line-height:\s*1\.1/, /margin:\s*0/]) assert.match(base.css, p);
  assert.ok(rules.some((r) => /var\(--gd-h1/.test(r.css) && r.arms.some((a) => a.startsWith('body:not([data-theme-custom])'))), 'the compiled-theme --gd-h1 override lost its class arm');
});

await test('TEXT: the lilac example theme styles the demoted hero title like its h1', () => {
  const rules = heroH1Rules(LILAC_CSS);
  assert.ok(rules.length >= 1, 'lilac has no hero h1 rule');
  for (const r of rules) assert.ok(r.arms.some((a) => SAME_SPEC_ARM.test(a)), `lilac \`${r.arms.join(', ')}\` has no class arm`);
});

// ── CASCADE ──────────────────────────────────────────────────────────────────────────────────────
const NM = join(HERE, 'astro/node_modules');
if (!existsSync(join(NM, 'css-select')) || !existsSync(join(NM, 'css-tree')) || !existsSync(join(NM, 'parse5'))) {
  console.log('  · hero-title-presentation CASCADE SKIPPED — no packages/sitetile/astro/node_modules (css-tree, css-select, parse5)');
} else {
  const req = createRequire(join(NM, 'x.js'));
  const csstree = req('css-tree');
  const { selectAll, is: matches, compile } = req('css-select');
  const { parse: parseWhat } = req('css-what');
  const parse5 = req('parse5');
  const { Element, Text, Document } = req('domhandler');

  // parse5 tree → domhandler nodes (what css-select's default adapter walks).
  function toDom(p5, parent) {
    if (p5.nodeName === '#text') { const t = new Text(p5.value); t.parent = parent; return t; }
    if (!p5.tagName) return null;
    const el = new Element(p5.tagName, Object.fromEntries(p5.attrs.map((a) => [a.name, a.value])), []);
    el.parent = parent;
    el.children = (p5.childNodes || []).map((c) => toDom(c, el)).filter(Boolean);
    el.children.forEach((c, i) => { c.prev = el.children[i - 1] || null; c.next = el.children[i + 1] || null; });
    return el;
  }
  function docOf(fragment, bodyAttrs = '') {
    const p5 = parse5.parse(`<!doctype html><html><head></head><body${bodyAttrs}><main>${fragment}</main></body></html>`);
    const doc = new Document([]);
    doc.children = p5.childNodes.map((c) => toDom(c, doc)).filter(Boolean);
    return doc;
  }

  // Specificity [a, b, c] of one css-what selector: :where = 0, :is/:not/:has = the max of their args.
  const add = (x, y) => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
  const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
  function spec(tokens) {
    let s = [0, 0, 0];
    for (const t of tokens) {
      if (t.type === 'tag') s = add(s, [0, 0, 1]);
      else if (t.type === 'pseudo-element') s = add(s, [0, 0, 1]);
      else if (t.type === 'attribute') s = add(s, t.name === 'id' && t.action === 'equals' ? [1, 0, 0] : [0, 1, 0]);
      else if (t.type === 'pseudo') {
        if (t.name === 'where') continue;
        if (Array.isArray(t.data)) s = add(s, t.data.map(spec).reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]));
        else s = add(s, [0, 1, 0]);
      }
    }
    return s;
  }

  /** Author rules as { selector, spec, rank, order, decls }. `rank` = cascade layer position; rules
   *  nested in any at-rule other than the named @layer are left out (and counted). */
  function rulesOf(css, layerRanks, unlayeredRank) {
    const ast = csstree.parse(css, { parseValue: false, parseRulePrelude: false });
    const out = [];
    let skipped = 0;
    (function walk(node, rank, nested) {
      for (const child of node.children ? node.children.toArray() : []) {
        if (child.type === 'Atrule') {
          if (child.name === 'layer' && child.block) {
            const name = csstree.generate(child.prelude).trim();
            walk(child.block, layerRanks[name] ?? rank, nested);
          } else if (child.block) { skipped += 1; walk(child.block, rank, true); }
        } else if (child.type === 'Rule' && !nested) {
          const decls = {};
          for (const d of child.block.children.toArray()) {
            if (d.type === 'Declaration') decls[d.property] = { value: csstree.generate(d.value).trim(), important: !!d.important };
          }
          const prelude = csstree.generate(child.prelude);
          for (const sel of parseWhat(prelude)) {
            // A pseudo-element styles a box that is not the element; a state/unsupported pseudo-class
            // (:hover, :focus-visible …) css-select cannot compile never applies to a heading at rest.
            if (sel.some((t) => t.type === 'pseudo-element')) { skipped += 1; continue; }
            try { compile([sel]); } catch { skipped += 1; continue; }
            out.push({ selector: sel, text: prelude, spec: spec(sel), rank, order: out.length, decls });
          }
        }
      }
    })(ast, unlayeredRank, false);
    return { rules: out, skipped };
  }

  const PROPS = ['font-size', 'line-height', 'max-width', 'margin'];
  // [important, layer rank, a, b, c, source order]: the later key in this order wins the cascade.
  // (Layer order inverts for !important; no hero-title rule uses it, so the rank is not flipped.)
  const later = (k, w) => { for (let i = 0; i < k.length; i++) if (k[i] !== w[i]) return k[i] > w[i]; return false; };
  function computed(el, rules) {
    const res = {};
    for (const p of PROPS) {
      let win = null;
      for (const r of rules) {
        const d = r.decls[p];
        if (!d || !matches(el, [r.selector])) continue;
        const key = [d.important ? 1 : 0, r.rank, ...r.spec, r.order];
        if (!win || later(key, win.key)) win = { key, value: d.value };
      }
      res[p] = win ? win.value : '(none)';
    }
    return res;
  }

  // SiteLayout's layer order: reef.base, reef.corals, reef.theme (a site's own theme.css), reef.responsive;
  // unlayered CSS beats every layer.
  const LAYERS = { 'reef.base': 0, 'reef.corals': 1, 'reef.theme': 2, 'reef.responsive': 3 };
  const UNLAYERED = 4;
  const base = rulesOf(SITE_CSS, LAYERS, UNLAYERED);
  const titleOf = (doc, tag) => {
    const found = selectAll(`.st-hero > ${tag}`, doc);
    assert.equal(found.length, 1, `exactly one hero <${tag}> title`);
    return found[0];
  };
  // A page built before the class existed: same owner markup minus the attribute.
  // (The first test above is what fails when the renderer stops writing the class.)
  const legacyHtml = ownerHtml.replace(' class="st-hero-title"', '');

  for (const [label, bodyAttrs] of [['compiled-theme body', ''], ['hand-rolled-theme body', ' data-theme-custom']]) {
    await test(`CASCADE (${label}): the demoted <h2> resolves the owner <h1>'s hero font-size / line-height / max-width / margin`, () => {
      const owner = computed(titleOf(docOf(ownerHtml, bodyAttrs), 'h1'), base.rules);
      const demoted = computed(titleOf(docOf(demotedHtml, bodyAttrs), 'h2'), base.rules);
      const legacy = computed(titleOf(docOf(legacyHtml, bodyAttrs), 'h1'), base.rules);
      assert.equal(owner['max-width'], '18ch', `the owner <h1> lost its 18ch measure: ${JSON.stringify(owner)}`);
      assert.equal(owner['line-height'], '1.1', `owner line-height: ${JSON.stringify(owner)}`);
      assert.match(owner['font-size'], bodyAttrs ? /^clamp\(/ : /^var\(--gd-h1/, `owner font-size: ${JSON.stringify(owner)}`);
      assert.deepEqual(demoted, owner, 'a hero title that is not the page h1 owner (<h2>) must look like the owner <h1>');
      assert.deepEqual(legacy, owner, 'a page built before `.st-hero-title` (bare <h1>) must keep the same hero type');
    });
  }

  await test('CASCADE (lilac example theme over site.css): the demoted <h2> gets the theme\'s hero title too', () => {
    const lilac = rulesOf(LILAC_CSS, {}, LAYERS['reef.theme']); // SiteLayout wraps theme.css in @layer reef.theme
    const all = [...base.rules, ...lilac.rules.map((r) => ({ ...r, order: r.order + base.rules.length }))];
    const owner = computed(titleOf(docOf(ownerHtml, ' data-theme-custom'), 'h1'), all);
    const demoted = computed(titleOf(docOf(demotedHtml, ' data-theme-custom'), 'h2'), all);
    assert.equal(owner['max-width'], 'none', `lilac sets max-width:none on the hero title: ${JSON.stringify(owner)}`);
    assert.deepEqual(demoted, owner);
  });
}

console.log(`hero-title-presentation: ${passed} passed`);
