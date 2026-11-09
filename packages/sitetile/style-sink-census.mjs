// The style-sink census, read off the Astro compiler's own AST (style-text.test.mjs runs it).
//
// 🩸 Rounds 2–4 of tile#273 classified each `set:html` by reading source TEXT: the nearest `<`
// before the token was taken as the enclosing tag. Every round a reviewer found another spelling
// that put a plausible `<div …` inside an attribute's JavaScript string, template literal or
// comment, the scanner exempted the real `<style>` as a div, and the census stayed green. A census
// that guesses at syntax when the real parser is installed is the defect, so this one asks the
// parser Astro itself compiles with (`@astrojs/compiler-rs`, a dependency of `astro`).
//
// What it checks, per `.astro` source:
//   - parse() must succeed with ZERO diagnostics. Anything else is a census failure, never a pass.
//   - Every element whose tag is `style` (any case) and carries `set:html` must carry exactly one,
//     no spread attributes, and its value must be the expression `styleText(<identifier or
//     non-computed member chain>)`, where `styleText` is the named import from `lib/style-text.mjs`.
//     Every other appearance of the identifier `styleText` (a local definition, a shadowing
//     parameter, an alias, a reassignment) fails, so the name cannot be bound to something else.
//   - `set:html` on an element whose tag is not a plain lowercase name (a component, a dynamic tag
//     variable, `Tag.X`) fails: the AST cannot prove where that HTML lands.
//   - `set:html` on a plain element or the built-in `<Fragment>`, and any `<slot>`, fails when an
//     enclosing element is a style element or a tag the AST cannot classify. An enclosing component
//     is accepted only when it is a relative `.astro` default import that the census itself covers
//     (its own slots are then checked in its own file) AND no other identifier of that name appears
//     anywhere in the file, since a parameter or local of the same name could bind the tag to
//     "style". The same rule decides whether `<Fragment>` is the built-in.
//   - Node offsets are read in the unit the installed parser actually uses (measured, see
//     offsetUnit), so positions and messages hold for non-ASCII sources.
// A false alarm is fixed by writing the sink in the one allowed shape, never by widening this.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SRC = join(HERE, 'astro', 'src');
const STYLE_TEXT_MODULE = join(SRC, 'lib', 'style-text.mjs');

// The parser Astro compiles with, resolved through the renderer's own `astro` install so it is the
// same copy a build uses. Throws if the renderer's dependencies are absent; callers must fail on it.
// Astro itself loads it with an ESM `import "@astrojs/compiler-rs"` from its compile module; this
// resolves the same specifier from astro's package directory, and the package's `exports` map has
// only a `default` condition, so both resolve to the same file (checked on a clean `npm ci` of the
// lockfile: the same path, and the same module instance as the one astro imports).
export async function loadAstroParse() {
  const fromRenderer = createRequire(join(HERE, 'astro', 'package.json'));
  const fromAstro = createRequire(fromRenderer.resolve('astro/package.json'));
  const mod = await import(pathToFileURL(fromAstro.resolve('@astrojs/compiler-rs')).href);
  if (typeof mod.parse !== 'function') throw new Error('@astrojs/compiler-rs has no parse()');
  return mod.parse;
}

// 🩸 Round 5: the census cut node text out of UTF-8 bytes because the parser installed on the box
// it was written on (compiler-rs 0.3.1) counted bytes; the lockfile installs 0.5.1, which counts
// UTF-16 code units, and every sink after the first non-ASCII character was cut from the wrong
// place. So the unit is measured: parse a probe whose element sits after a CJK character and an
// astral emoji (where the three conventions differ), and see which slicing gives the element back.
const OFFSET_PROBE = '<!-- 漢\u{1F9F8} -->\n<a b="1"/>';
const OFFSET_PROBE_ELEMENT = '<a b="1"/>';
const offsetUnits = new WeakMap();
export function offsetUnit(parse) {
  if (offsetUnits.has(parse)) return offsetUnits.get(parse);
  let unit = null;
  try {
    const el = (parse(OFFSET_PROBE)?.ast?.body ?? []).find((n) => n?.type === 'JSXElement');
    if (el && OFFSET_PROBE.slice(el.start, el.end) === OFFSET_PROBE_ELEMENT) unit = 'utf16';
    else if (el && Buffer.from(OFFSET_PROBE, 'utf8').subarray(el.start, el.end).toString('utf8') === OFFSET_PROBE_ELEMENT) unit = 'utf8';
  } catch { unit = null; }
  offsetUnits.set(parse, unit);
  return unit;
}

const jsxName = (n) => {
  if (!n) return '?';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${jsxName(n.property)}`;
  if (n.type === 'JSXNamespacedName') return `${jsxName(n.namespace)}:${jsxName(n.name)}`;
  return `?${n.type}`;
};

// An identifier, or `a.b.c` with no computed access, no optional chaining and no calls.
const isPlainChain = (e) => {
  if (!e) return false;
  if (e.type === 'Identifier') return true;
  return e.type === 'MemberExpression' && !e.computed && !e.optional
    && e.property?.type === 'Identifier' && isPlainChain(e.object);
};

/**
 * Census one `.astro` source.
 *   file        absolute path (for resolving imports; fixtures pass a path inside SRC)
 *   censused    Set of absolute paths of every `.astro` file the census covers
 * Returns `{ sinks, failures }`: `sinks` are the accepted `<style set:html={styleText(…)}>` sinks
 * (`{ line, arg }`), `failures` are `{ line, reason }`. An empty `failures` is the only pass.
 */
export function censusSource(src, parse, { file = join(SRC, 'Fixture.astro'), censused = new Set() } = {}) {
  const sinks = [];
  const failures = [];
  let result;
  try {
    result = parse(src);
  } catch (e) {
    return { sinks, failures: [{ line: 0, reason: `parse() threw: ${e && e.message ? e.message : e}` }] };
  }
  if (!result || !result.ast || typeof result.ast !== 'object') {
    return { sinks, failures: [{ line: 0, reason: 'parse() returned no AST' }] };
  }
  if (!Array.isArray(result.diagnostics) || result.diagnostics.length) {
    const ds = Array.isArray(result.diagnostics) ? result.diagnostics : [{ severity: '?', text: 'no diagnostics array', labels: [] }];
    return { sinks, failures: ds.map((d) => ({ line: d.labels?.[0]?.line ?? 0, reason: `parse diagnostic (${d.severity}): ${d.text}` })) };
  }

  // Node offsets are in whatever unit the installed parser uses (compiler-rs 0.3 counted UTF-8 bytes,
  // 0.5 counts UTF-16 code units, the same as JS string indices). The unit is measured on this very
  // parse function, never assumed; a parser whose offsets match neither is a census failure.
  const unit = offsetUnit(parse);
  if (!unit) {
    return { sinks, failures: [{ line: 0, reason: 'the parser\'s node offsets are neither UTF-16 nor UTF-8 offsets; the census cannot read source positions' }] };
  }
  const bytes = unit === 'utf8' ? Buffer.from(src, 'utf8') : null;
  const cut = (a, b) => (bytes ? bytes.subarray(a, b).toString('utf8') : src.slice(a, b));
  const textOf = (n) => cut(n.start, n.end);
  const lineOf = (n) => (typeof n?.start === 'number' ? cut(0, n.start).split('\n').length : 0);
  const fail = (node, reason) => failures.push({ line: lineOf(node), reason });

  // Bindings the frontmatter's imports establish.
  const imports = (result.ast.frontmatter?.program?.body ?? []).filter((n) => n.type === 'ImportDeclaration');
  const componentImports = new Map();      // local name -> how many trusted specifiers bind it
  const componentSpecifiers = new Set();
  const canonicalSpecifiers = new Set();
  for (const d of imports) {
    const from = String(d.source?.value ?? '');
    const target = from.startsWith('.') ? resolve(dirname(file), from) : null;
    for (const s of d.specifiers ?? []) {
      if (s.type === 'ImportDefaultSpecifier' && target && from.endsWith('.astro') && censused.has(target)
          && !d.importKind?.startsWith?.('type') && typeof s.local?.name === 'string') {
        componentSpecifiers.add(s);
        componentImports.set(s.local.name, (componentImports.get(s.local.name) ?? 0) + 1);
      }
      if (s.type === 'ImportSpecifier' && target === STYLE_TEXT_MODULE && !d.importKind?.startsWith?.('type')
          && (s.imported?.name ?? s.imported?.value) === 'styleText' && s.local?.name === 'styleText') {
        canonicalSpecifiers.add(s);
      }
    }
  }
  const styleTextImported = canonicalSpecifiers.size === 1;

  // Pass 1: names. A tag is only as trusted as its binding, and the census does not resolve scopes,
  // so it is conservative instead: `Fragment` is the built-in, and an imported component is that
  // component, only if no identifier of that name appears anywhere else in the file (a parameter,
  // a destructured or declared name, even a mere reference). 🩸 Round 5: imported components were
  // trusted by name alone, so `{((SiteLayout) => <SiteLayout>…</SiteLayout>)("style")}` turned the
  // "component" into a <style> element and put an unwrapped set:html inside it, census green.
  // `styleText` may appear only as the canonical import and as a callee.
  const mentioned = new Set();
  const names = (node, parent, key) => {
    if (Array.isArray(node)) { for (const n of node) names(n, parent, key); return; }
    if (!node || typeof node !== 'object') return;
    if (canonicalSpecifiers.has(node) || componentSpecifiers.has(node)) return;
    if (node.type === 'Identifier') {
      mentioned.add(node.name);
      if (node.name === 'styleText' && !(parent?.type === 'CallExpression' && key === 'callee')) {
        fail(node, '`styleText` is bound or used here other than as the import from lib/style-text.mjs and a direct call');
      }
    }
    for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') names(node[k], node, k);
  };
  names(result.ast, null, null);
  const fragmentRebound = mentioned.has('Fragment');
  const components = new Set([...componentImports].filter(([n, count]) => count === 1 && !mentioned.has(n)).map(([n]) => n));

  const kindOf = (nameNode) => {
    if (nameNode?.type === 'JSXIdentifier') {
      const n = nameNode.name;
      if (n.toLowerCase() === 'style') return 'style';
      if (/^[a-z][a-z0-9-]*$/.test(n)) return 'html';
      if (n === 'Fragment' && !fragmentRebound) return 'fragment';
      if (components.has(n)) return 'component';
    }
    return 'unknown';
  };
  const unprovenAncestor = (ancestors) => ancestors.find((a) => a.kind === 'style' || a.kind === 'unknown');

  const checkStyleSink = (el, attrs, sinkAttrs) => {
    if (attrs.some((a) => a.type !== 'JSXAttribute')) {
      fail(el, 'a <style> element with spread attributes cannot be classified');
      return;
    }
    if (sinkAttrs.length === 0) return;
    if (sinkAttrs.length > 1) { fail(el, `a <style> element carries ${sinkAttrs.length} set:html attributes`); return; }
    const v = sinkAttrs[0].value;
    const e = v?.type === 'JSXExpressionContainer' ? v.expression : null;
    const ok = e && e.type === 'CallExpression' && !e.optional
      && e.callee?.type === 'Identifier' && e.callee.name === 'styleText'
      && e.arguments?.length === 1 && isPlainChain(e.arguments[0]);
    if (!ok) {
      fail(sinkAttrs[0], `<style ${textOf(sinkAttrs[0]).slice(0, 80)}> is not set:html={styleText(<identifier or member chain>)}`);
      return;
    }
    if (!styleTextImported) {
      fail(sinkAttrs[0], '`styleText` here is not the named import from lib/style-text.mjs');
      return;
    }
    sinks.push({ line: lineOf(el), arg: textOf(e.arguments[0]) });
  };

  // Pass 2: elements, with the chain of enclosing elements. Attribute values count as enclosed by
  // their element, which only ever makes the census stricter.
  const visit = (node, ancestors) => {
    if (Array.isArray(node)) { for (const n of node) visit(n, ancestors); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement') {
      const open = node.openingElement;
      const kind = kindOf(open?.name);
      const attrs = open?.attributes ?? [];
      const sinkAttrs = attrs.filter((a) => a.type === 'JSXAttribute' && jsxName(a.name).toLowerCase() === 'set:html');
      for (const a of sinkAttrs) {
        // A coordinate check on real nodes, beyond the probe: if offsets stop lining up, messages
        // would point at the wrong text, so say so instead of reporting from the wrong place.
        if (!textOf(a).toLowerCase().startsWith('set:html')) fail(a, 'node offsets do not line up with the source; the census cannot report positions');
      }
      if (kind === 'style') {
        checkStyleSink(node, attrs, sinkAttrs);
      } else if (sinkAttrs.length) {
        if (kind === 'component' || kind === 'unknown') {
          fail(node, `set:html on <${jsxName(open.name)}>, which is not a plain element: the AST cannot prove it is not style`);
        } else {
          const up = unprovenAncestor(ancestors);
          if (up) fail(node, `set:html on <${jsxName(open.name)}> inside <${up.name}>, which the AST cannot prove is not style`);
        }
      }
      if (kind === 'html' && open.name.name === 'slot') {
        const up = unprovenAncestor(ancestors);
        if (up) fail(node, `<slot> inside <${up.name}>, which the AST cannot prove is not style`);
      }
      const inner = [...ancestors, { kind, name: jsxName(open?.name) }];
      visit(attrs, inner);
      visit(node.children, inner);
      return;
    }
    for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') visit(node[k], ancestors);
  };
  visit(result.ast, []);
  return { sinks, failures };
}
