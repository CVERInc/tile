// The emitter's four primitives against Astro's own runtime: the same value through `text`/`attr`/
// `boolAttr`/`when` and through Astro's renderChild/addAttribute must print the same bytes.
//   run: node packages/emit/html.test.mjs
//
// Why this exists beside the golden build diff: the golden diff proves the pages the fixtures make,
// and fixtures only hold the values somebody thought to write. This proves the primitive itself
// over the awkward ones — `'`, `false`, `0`, `''` — which is where an escaping rule shows.
//
// 🔴 It needs packages/sitetile/astro/node_modules (CI installs it). Without them it FAILS, unless
// SECTION_CONTRACT_ALLOW_NO_ASTRO=1 — the same knob section-contract.test.mjs uses to say "I know".

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { text, attr, boolAttr, when } from './html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, '..', 'sitetile', 'astro', 'node_modules', 'astro', 'dist', 'runtime', 'server');

console.log('emit html primitives');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

if (!existsSync(RUNTIME)) {
  await test('🔴 Astro runtime present (packages/sitetile/astro/node_modules)', () => {
    if (process.env.SECTION_CONTRACT_ALLOW_NO_ASTRO === '1') {
      console.log('  · primitives NOT compared — no astro runtime and SECTION_CONTRACT_ALLOW_NO_ASTRO=1');
      return;
    }
    assert.fail('no packages/sitetile/astro/node_modules — run npm ci there (or set SECTION_CONTRACT_ALLOW_NO_ASTRO=1 to skip knowingly)');
  });
} else {
  const { renderChild } = await import(pathToFileURL(join(RUNTIME, 'render', 'any.js')));
  const { addAttribute } = await import(pathToFileURL(join(RUNTIME, 'render', 'util.js')));
  const { markHTMLString } = await import(pathToFileURL(join(RUNTIME, 'escape.js')));
  // What a `$$render` template prints for one interpolated child.
  const child = async (v) => {
    let out = '';
    await renderChild({ write: (c) => { out += String(c); } }, v);
    return out;
  };

  const VALUES = ['', 'plain', `a&b<c>d'e"f`, '&amp;', '日本語 & 「引號」', '🎉', ' lead ', 0, 7, -1, null, undefined, false, true, NaN];

  await test('text(v) prints what `{v}` prints', async () => {
    for (const v of VALUES) assert.equal(text(v), await child(v), `value ${JSON.stringify(v)}`);
  });

  await test('attr(name, v) prints what `name={v}` prints on an ordinary attribute', () => {
    for (const name of ['id', 'class', 'href', 'data-cols', 'data-badge']) {
      for (const v of VALUES) assert.equal(attr(name, v), String(addAttribute(v, name)), `${name}=${JSON.stringify(v)}`);
    }
  });

  await test('boolAttr(name, v) prints what `name={v}` prints on a boolean attribute', () => {
    for (const v of VALUES) assert.equal(boolAttr('open', v), String(addAttribute(v, 'open')), `open=${JSON.stringify(v)}`);
  });

  await test('when(c, f) prints what `{c && <markup/>}` prints', async () => {
    for (const v of VALUES) {
      assert.equal(when(v, () => '<b>x</b>'), await child(v && markHTMLString('<b>x</b>')), `cond ${JSON.stringify(v)}`);
    }
  });

  await test('🔴 CONTROL: the comparison sees a one-character escaping difference', async () => {
    const noApos = (s) => text(s).replace(/&#39;/g, "'");
    assert.notEqual(noApos(`it's`), await child(`it's`));
    const falseOmitted = (n, v) => (v === false ? '' : attr(n, v));
    assert.notEqual(falseOmitted('data-x', false), String(addAttribute(false, 'data-x')));
    assert.notEqual(when(0, () => 'x'), '', 'a `0` condition prints "0" — the case a plain `c ? f() : \'\'` gets wrong');
  });
}

console.log(`  ${passed} passed`);
