// script-inventory — every <script> on every page a build wrote, as one comparable list.
//
// The smoke build's inventory is committed as script-inventory.golden.json and smoke-build.mjs
// compares each run against it. The point is a measured answer to "did this change alter any script
// a page ships?": a change that says it leaves the output alone (a new setting that is off, a
// refactor) must leave this file alone too, and a change that moves a script shows up here as a
// reviewable line — which page, which script — instead of somewhere inside a hashed chunk name.
//
// What is recorded, per page, in the order the scripts appear in the file:
//   · an inline script  — the SHA-256 and length of its exact bytes (everything between the end of
//                          its start tag and its end tag, nothing trimmed), and its attributes;
//   · an external script — its `src` and its other attributes.
// Data blocks (`type="application/json"`, JSON-LD) are scripts to this file too: their `type`
// attribute is in the record, and their bytes are what a later reader of them receives.
// Also recorded: every script file the build wrote, by path, hash and length — a chunk that only an
// `import()` reaches is on no page, and its bytes should not be able to change unseen either.
// A script file is one whose name ends in `.js` or `.mjs`, in any case: the two extensions served
// as JavaScript (`text/javascript` in the MIME table the build tool itself uses; a module script is
// only run under such a type). The bundler names its own chunks `.js`; `.mjs` is what a file copied
// from `public/` or written by an endpoint route could be called. `.cjs` is not served as
// JavaScript and source maps are not scripts, so neither is recorded. (The golden's `about` line
// and its `jsFiles` count keep their first wording, so that this widening leaves the file as it is.)
//
// REGENERATE ON PURPOSE, never to make a red run green without reading it:
//   cd packages/sitetile/astro && SITETILE_SCRIPT_GOLDEN=write node smoke-build.mjs
// That run writes the file and then EXITS 3 (or 1, if a check failed as well) — never 0. A run that
// wrote the golden has compared the build with itself and proved nothing, so it is not a passing
// run and cannot be mistaken for one by whatever started it. Read
// `git diff script-inventory.golden.json` line by line, commit it with the change that moved it,
// and run the smoke again WITHOUT the switch: that run is the check.
// Where `CI` is set the switch is refused before anything is built or written (exit 2): nobody is
// there to read the diff. No script, hook or workflow sets it (script-inventory.test.mjs looks).
//
// VARIABLE PARTS. The golden holds exact hashes, so it relies on two builds of the same input
// writing the same bytes. Where an inline script carries bytes that differ between two builds of
// the same input, that part must be NAMED in the golden's `variableParts` list (a name, the pattern
// that matches it, and why it varies) and is replaced by `{{name}}` before hashing; the rest of the
// script stays pinned. The list is empty when nothing varies. It is never a place to hide a
// difference nobody has explained.
//
// parse5 finds the scripts (the tokenizer a browser uses, so a `<script` inside a comment, an
// attribute or a <textarea> is not one). The file is read as Latin-1, one character per byte: HTML
// syntax is ASCII, so the parse is the same, every offset is a byte offset, and the hash is of the
// file's bytes whatever their encoding. Attribute values are turned back into UTF-8 text.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const GOLDEN_PATH = fileURLToPath(new URL('./script-inventory.golden.json', import.meta.url));
export const REGENERATE = 'cd packages/sitetile/astro && SITETILE_SCRIPT_GOLDEN=write node smoke-build.mjs';

/** The environment variable that makes the smoke write the golden. Its only value is `write`. */
export const GOLDEN_SWITCH = 'SITETILE_SCRIPT_GOLDEN';
/** The smoke's exit code after it wrote the golden and no check failed. Never 0: see above. */
export const REGENERATED_EXIT = 3;
/** The smoke's exit code when it refuses the switch, before building anything. */
export const REFUSED_EXIT = 2;
/** What follows the regenerate command wherever it is printed. */
export const REGENERATE_THEN = `that run writes the golden and exits ${REGENERATED_EXIT}, not 0 (it is refused where CI is set); `
  + 'read the diff of script-inventory.golden.json, commit it with the change that caused it, then run the smoke again without the switch';

/**
 * What the switch asks for in `env`: `'check'` (unset or empty) or `'write'`. Throws, with a
 * message for a person, when the switch has any other value or when it is set where `CI` is set to
 * anything at all. The caller must not build or write before it has asked.
 */
export function goldenMode(env) {
  const value = env[GOLDEN_SWITCH];
  if (value === undefined || value === '') return 'check';
  if (value !== 'write') {
    throw new Error(`${GOLDEN_SWITCH} is set to a value that is not "write", and is refused: "write" is its only value (${REGENERATE}). Unset it to run the check.`);
  }
  if (env.CI !== undefined && env.CI !== '') {
    throw new Error(`${GOLDEN_SWITCH}=write is refused because CI is set: the golden is regenerated by a person who then reads its diff, never by an unattended run. `
      + `Nothing was built and nothing was written. Unset ${GOLDEN_SWITCH} to run the check.`);
  }
  return 'write';
}

/**
 * The smoke's exit code. Zero only when no check failed AND the golden was not written by this
 * run; a failed check is 1 whether or not the golden was written.
 */
export function smokeExitCode({ failed, regenerated }) {
  if (failed !== 0) return 1;
  return regenerated ? REGENERATED_EXIT : 0;
}

const sha256 = (buf) => 'sha256-' + createHash('sha256').update(buf).digest('base64');
const utf8 = (latin1) => Buffer.from(latin1, 'latin1').toString('utf8');

/** Apply the named variable parts to an inline script's bytes (Latin-1 string in, Buffer out). */
function pinned(text, variableParts) {
  let out = text;
  for (const part of variableParts) out = out.replace(new RegExp(part.pattern, 'g'), `{{${part.name}}}`);
  return Buffer.from(out, 'latin1');
}

/** The <script> elements of a file (Latin-1 string), in source order, each with its text's byte range. */
function scriptNodes(source, parse) {
  const found = [];
  (function walk(node) {
    if (node.tagName === 'script' && node.sourceCodeLocation) found.push(node);
    for (const child of node.childNodes || []) walk(child);
    if (node.content) walk(node.content); // a <template>'s scripts are in the file too
  })(parse(source, { sourceCodeLocationInfo: true }));
  found.sort((a, b) => a.sourceCodeLocation.startOffset - b.sourceCodeLocation.startOffset);
  return found.map((node) => {
    const loc = node.sourceCodeLocation;
    const start = loc.startTag.endOffset;
    // An unclosed <script> runs to the end of the file. Its location then has no end tag, and its
    // text is where its last text node ends.
    const last = node.childNodes[node.childNodes.length - 1];
    const end = loc.endTag ? loc.endTag.startOffset : Math.max(start, loc.endOffset, last?.sourceCodeLocation?.endOffset ?? start);
    return { node, start, end };
  });
}

/**
 * Where each script's own bytes sit in the file: `[{ index, start, end, external }]`, `index`
 * counting from 0 in source order. For a test that needs to change one byte of one script.
 */
export function scriptByteRanges(file, parse) {
  return scriptNodes(file.toString('latin1'), parse).map(({ node, start, end }, index) => (
    { index, start, end, external: node.attrs.some((a) => a.name === 'src') }));
}

/**
 * The scripts of one HTML file, in source order.
 * @param {Buffer} file the file's bytes
 * @param {(html: string, opts: object) => object} parse parse5's `parse`
 * @param {{name: string, pattern: string}[]} [variableParts]
 */
export function pageScripts(file, parse, variableParts = []) {
  const source = file.toString('latin1');
  return scriptNodes(source, parse).map(({ node, start, end }) => {
    const text = source.slice(start, end);
    const attrs = {};
    let src = null;
    for (const { name, value } of node.attrs) {
      if (name === 'src') src = utf8(value);
      else attrs[utf8(name)] = utf8(value);
    }
    const entry = {};
    if (src !== null) entry.src = src;
    // An external script's own text is ignored by a browser, and is empty in everything the
    // renderer writes. If it is ever not empty, that is recorded rather than dropped.
    if (src === null || text.length > 0) {
      const bytes = pinned(text, variableParts);
      entry.inline = sha256(bytes);
      entry.bytes = bytes.length;
    }
    entry.attrs = attrs;
    return entry;
  });
}

/** The file extensions served as JavaScript. Matched at the end of a name, whatever its case. */
export const SCRIPT_FILE_EXTENSIONS = Object.freeze(['.js', '.mjs']);

/** Every file under `dir` whose name ends with one of `exts` (in any case), as sorted `/`-separated relative paths. */
function filesUnder(dir, exts) {
  const out = [];
  (function walk(abs, rel) {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else if (exts.some((ext) => name.toLowerCase().endsWith(ext))) out.push(r);
    }
  })(dir, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The script inventory of a build output directory.
 * @returns {{ variableParts: object[], pages: Record<string, object[]>, files: Record<string, {sha256: string, bytes: number}> }}
 */
export function scriptInventory(distDir, parse, variableParts = []) {
  const pages = {};
  for (const rel of filesUnder(distDir, ['.html'])) pages[rel] = pageScripts(readFileSync(join(distDir, rel)), parse, variableParts);
  const files = {};
  for (const rel of filesUnder(distDir, SCRIPT_FILE_EXTENSIONS)) {
    const buf = readFileSync(join(distDir, rel));
    files[rel] = { sha256: sha256(buf), bytes: buf.length };
  }
  return { variableParts, pages, files };
}

/** What the inventory holds, in numbers. Stored in the golden so its size is readable at a glance. */
export function inventoryCounts(inv) {
  const all = Object.values(inv.pages).flat();
  return {
    pages: Object.keys(inv.pages).length,
    scripts: all.length,
    inline: all.filter((s) => s.src === undefined).length,
    external: all.filter((s) => s.src !== undefined).length,
    pagesWithoutScripts: Object.values(inv.pages).filter((p) => p.length === 0).length,
    distinctInline: new Set(all.filter((s) => s.src === undefined).map((s) => s.inline)).size,
    distinctExternal: new Set(all.filter((s) => s.src !== undefined).map((s) => s.src)).size,
    jsFiles: Object.keys(inv.files).length,
  };
}

/** The golden file's text for an inventory: stable order, one script per line, so `git diff` reads. */
export function serializeInventory(inv, build = {}) {
  const lines = ['{'];
  lines.push(`  "about": ${JSON.stringify('Every <script> on every page of the smoke build (inline: SHA-256 and length of its exact bytes, plus attributes; external: src plus attributes; in source order), and every .js file the build wrote. Written by script-inventory.mjs and checked by smoke-build.mjs. Do not edit by hand.')},`);
  lines.push(`  "regenerate": ${JSON.stringify(REGENERATE)},`);
  lines.push(`  "build": ${JSON.stringify(build)},`);
  lines.push(`  "variableParts": ${JSON.stringify(inv.variableParts)},`);
  lines.push(`  "counts": ${JSON.stringify(inventoryCounts(inv))},`);
  lines.push('  "pages": {');
  const pages = Object.keys(inv.pages);
  pages.forEach((page, i) => {
    const scripts = inv.pages[page];
    const comma = i === pages.length - 1 ? '' : ',';
    if (!scripts.length) { lines.push(`    ${JSON.stringify(page)}: []${comma}`); return; }
    lines.push(`    ${JSON.stringify(page)}: [`);
    scripts.forEach((s, j) => lines.push(`      ${JSON.stringify(s)}${j === scripts.length - 1 ? '' : ','}`));
    lines.push(`    ]${comma}`);
  });
  lines.push('  },');
  lines.push('  "files": {');
  const files = Object.keys(inv.files);
  files.forEach((f, i) => lines.push(`    ${JSON.stringify(f)}: ${JSON.stringify(inv.files[f])}${i === files.length - 1 ? '' : ','}`));
  lines.push('  }');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** One script, as a person recognises it in a failure message. */
function label(s) {
  const attrs = Object.entries(s.attrs || {}).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}=${JSON.stringify(v)}`)).join('');
  return s.src !== undefined
    ? `<script src=${JSON.stringify(s.src)}${attrs}>`
    : `<script${attrs}> (inline, ${s.bytes} bytes, ${s.inline})`;
}

/**
 * The differences between a golden inventory and a built one, each a sentence that names the page
 * (or file) and the script. Empty when they are the same.
 */
export function compareInventory(golden, built) {
  const out = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(golden.variableParts || [], built.variableParts || [])) out.push('the variableParts list differs between the golden and this check');
  const gPages = golden.pages || {};
  const bPages = built.pages || {};
  for (const page of Object.keys(gPages)) if (!Object.hasOwn(bPages, page)) out.push(`${page}: the page is in the golden but the build did not write it`);
  for (const page of Object.keys(bPages)) {
    if (!Object.hasOwn(gPages, page)) {
      out.push(`${page}: a page the golden does not have (${bPages[page].length} scripts)`);
      continue;
    }
    const g = gPages[page];
    const b = bPages[page];
    if (same(g, b)) continue;
    if (g.length === b.length) {
      // Same number of scripts: say exactly which ones differ, and in what.
      g.forEach((was, i) => {
        const now = b[i];
        if (same(was, now)) return;
        const what = [];
        if (was.src !== now.src) what.push(was.src === undefined || now.src === undefined ? 'inline/external' : 'src');
        if (was.inline !== now.inline || was.bytes !== now.bytes) what.push('bytes');
        if (!same(was.attrs, now.attrs)) what.push('attributes');
        out.push(`${page}: script #${i + 1} of ${g.length} changed (${what.join(', ')})\n      golden: ${label(was)}\n      built:  ${label(now)}`);
      });
      continue;
    }
    // A different number: name what was added and what was removed, by identity.
    const left = b.map((s, i) => ({ key: JSON.stringify(s), s, i }));
    const removed = [];
    g.forEach((s, i) => {
      const at = left.findIndex((x) => x.key === JSON.stringify(s));
      if (at >= 0) left.splice(at, 1); else removed.push({ s, i });
    });
    out.push(`${page}: ${b.length} scripts, the golden has ${g.length}`
      + removed.map(({ s, i }) => `\n      not built (golden #${i + 1}): ${label(s)}`).join('')
      + left.map(({ s, i }) => `\n      not in the golden (built #${i + 1}): ${label(s)}`).join(''));
  }
  const gFiles = golden.files || {};
  const bFiles = built.files || {};
  for (const f of Object.keys(gFiles)) {
    if (!Object.hasOwn(bFiles, f)) out.push(`${f}: the script file is in the golden but the build did not write it`);
    else if (!same(gFiles[f], bFiles[f])) out.push(`${f}: the script file's bytes changed\n      golden: ${gFiles[f].bytes} bytes, ${gFiles[f].sha256}\n      built:  ${bFiles[f].bytes} bytes, ${bFiles[f].sha256}`);
  }
  for (const f of Object.keys(bFiles)) if (!Object.hasOwn(gFiles, f)) out.push(`${f}: a script file the golden does not have (${bFiles[f].bytes} bytes)`);
  return out;
}

/**
 * Compare a build output with the committed golden.
 * @returns {{ ok: boolean, differences: string[], counts: object }}
 */
export function checkScriptInventory(distDir, parse, { goldenPath = GOLDEN_PATH, build = {} } = {}) {
  let text = '';
  try { text = readFileSync(goldenPath, 'utf8'); } catch {
    return { ok: false, differences: [`there is no golden at ${goldenPath}. Write it on purpose: ${REGENERATE} (${REGENERATE_THEN})`], counts: {} };
  }
  const golden = JSON.parse(text);
  const built = scriptInventory(distDir, parse, golden.variableParts || []);
  const differences = compareInventory(golden, built);
  // The comparison above reads meaning; this one reads the file. A golden that was edited by hand
  // (a stale count, a reordered key) can agree in meaning and still not be what the generator writes.
  if (!differences.length && serializeInventory(built, golden.build ?? build) !== text) {
    differences.push(`the golden file is not what the generator writes for this inventory (edited by hand?). Regenerate it: ${REGENERATE}`);
  }
  if (!differences.length && JSON.stringify(golden.build) !== JSON.stringify(build)) {
    differences.push(`the golden was written for the build ${JSON.stringify(golden.build)}, this check is of ${JSON.stringify(build)}`);
  }
  return { ok: differences.length === 0, differences, counts: inventoryCounts(built) };
}

/** Write the golden for a build output. Keeps the golden's own variableParts list if it has one. */
export function writeScriptGolden(distDir, parse, { goldenPath = GOLDEN_PATH, build = {} } = {}) {
  let variableParts = [];
  try { variableParts = JSON.parse(readFileSync(goldenPath, 'utf8')).variableParts || []; } catch { /* first write */ }
  const inv = scriptInventory(distDir, parse, variableParts);
  writeFileSync(goldenPath, serializeInventory(inv, build));
  return inventoryCounts(inv);
}
