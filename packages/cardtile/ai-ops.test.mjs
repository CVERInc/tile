// The skew signal for the Card's shared ai_ops definition.
//
// `SPEC-ai-door-capability-parity.md` §4.4 asks for one: 「任一軌偵測到自己落後於 SSOT,吐警告」.
// This is the version that can exist today.
//
// 🔴 WHAT IT PROVES, exactly. The definition has ONE consumer right now, so this cannot assert that
// two doors agree — the second door does not exist. It asserts the weaker, load-bearing thing: that
// the definition and THE RENDERER cannot drift apart. A param card-render.mjs honours and ai-ops.mjs
// has never heard of is a silent capability: an author can write it, one door can preserve it, and
// another door drops it on save. When GAIDO grows a Card capability, this file gains its second half
// and the claim gets stronger. Until then the scope note is part of the test.
//
// 🔴 Source-TEXT parsing, not importing the renderer, for the same reason reef's own
// `catalog.parity.test.ts` does it: the thing being checked is what the code SAYS, and importing a
// module lets it answer for itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELL_TYPES, UNIVERSAL, PALETTE, BLANKS, DISPOSITION, OPS } from './ai-ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER = readFileSync(join(HERE, 'card-render.mjs'), 'utf8');

/** the `switch (cell.type)` block, by brace matching — never by eye */
function switchBody(src) {
  const k = src.indexOf('switch (cell.type)');
  assert.ok(k > 0, 'the renderer has no `switch (cell.type)` — this whole file is measuring nothing');
  const open = src.indexOf('{', k);
  let d = 0, q = null, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) break;
  }
  return src.slice(open, i);
}

/** case name → the source of that case, so params can be attributed to a type */
function casesOf(body) {
  const out = {};
  const parts = body.split(/case '/).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf("'"));
    out[name] = part;
  }
  return out;
}

// Some types read their params inside a helper instead of inline. The mapping is DECLARED here, so a
// new helper that nobody registers shows up as a param this file cannot find rather than as silence.
const DELEGATES = { link: ['linkIcon'], embed: ['renderEmbed'] };
/**
 * 🩸 WAS `RENDER.slice(k, k + 2000)` — a fixed byte window, which is a ruler that SHRINKS as the code
 * grows. On 2026-07-30 `renderEmbed` gained a second slider kind (~2,500 chars) and the bubbles
 * branch's `p.origin` / `p.narrow` / `p.bg` fell off the end. The test said 「ai-ops.mjs declares
 * embed.origin and card-render never reads it」 — a true statement about the WINDOW and a false one
 * about the renderer.
 *
 * 🔴 And the miss runs in the silent direction too: a param the renderer honours past the 2,000th
 * character reads as unread, so check (a) — 「nothing the renderer honours is missing from the
 * definition」, the one that actually matters — would have stopped covering it without ever failing.
 *
 * Brace-matched now, starting from the first `{` AFTER the signature's closing paren. That offset is
 * not cosmetic: `function renderEmbed(p, body, size, ctx = {})` has a DEFAULT-PARAMETER brace, and
 * matching from the function keyword closes at depth 0 right there — capturing 43 characters.
 */
const fnBody = (name) => {
  const k = RENDER.indexOf(`function ${name}(`);
  assert.ok(k > 0, `renderer has no function ${name} — DELEGATES is stale`);
  let i = RENDER.indexOf(')', k);
  let depth = 0;
  // walk back out of any nested parens in the signature, then find the body's opening brace
  while (i > 0 && RENDER.slice(k, i).split('(').length - 1 !== RENDER.slice(k, i).split(')').length) i = RENDER.indexOf(')', i + 1);
  const open = RENDER.indexOf('{', i);
  for (let j = open; j < RENDER.length; j++) {
    if (RENDER[j] === '{') depth++;
    else if (RENDER[j] === '}' && --depth === 0) return RENDER.slice(open, j + 1);
  }
  assert.fail(`could not brace-match the body of ${name}`);
  return '';
};
const paramsIn = (src) => new Set([...src.matchAll(/\bp\.([a-zA-Z_]\w*)/g)].map((m) => m[1]));

const BODY = switchBody(RENDER);
const CASES = casesOf(BODY);

test('every type the renderer handles is in the definition, and nothing else is', () => {
  assert.deepEqual(
    Object.keys(CASES).sort(),
    Object.keys(CELL_TYPES).sort(),
    'the renderer and ai-ops.mjs disagree about which cell types exist',
  );
  // …and the palette and the blanks cover exactly the same set, or the editor offers a type nobody
  // can render, or fails to offer one that works.
  assert.deepEqual(PALETTE.slice().sort(), Object.keys(CELL_TYPES).sort(), 'PALETTE does not cover the types');
  assert.deepEqual(Object.keys(BLANKS).sort(), Object.keys(CELL_TYPES).sort(), 'BLANKS does not cover the types');
});

test('🔴 every param the renderer READS is declared — in both directions', () => {
  const universal = new Set(Object.keys(UNIVERSAL));
  for (const [type, src] of Object.entries(CASES)) {
    const read = paramsIn(src);
    for (const helper of DELEGATES[type] || []) for (const p of paramsIn(fnBody(helper))) read.add(p);
    const declared = new Set([...Object.keys(CELL_TYPES[type].params), ...universal]);

    // (a) nothing the renderer honours is missing from the definition. THIS is the one that matters:
    // an undeclared param is a capability one door will preserve and another will silently drop.
    for (const p of read) {
      assert.ok(declared.has(p), `card-render reads \`${type}.${p}\` and ai-ops.mjs does not declare it`);
    }
    // (b) nothing declared is unread. A param in the definition that the renderer ignores is a
    // promise the editor makes and the page does not keep.
    for (const p of Object.keys(CELL_TYPES[type].params)) {
      if (universal.has(p)) continue;                 // w/bleed are read elsewhere, checked below
      assert.ok(read.has(p), `ai-ops.mjs declares \`${type}.${p}\` and card-render never reads it`);
    }
  }
});

test('the universal params are read where they claim to be read', () => {
  // `w` is packGrid's, `bleed` is renderGrid's — neither appears in a `case`, which is exactly why a
  // per-type scan alone would have missed them and reported a clean sheet.
  assert.match(RENDER + readFileSync(join(HERE, 'card-core.js'), 'utf8'), /params\.w\b/, '`w` is not read anywhere');
  assert.match(RENDER, /params\.bleed\b/, '`bleed` is not read anywhere');
});

test('🔴 a retired param is never offered, and never written', () => {
  const retired = Object.entries(UNIVERSAL).filter(([, v]) => v.disposition === DISPOSITION.RETIRED).map(([k]) => k);
  assert.ok(retired.includes('h'), 'h must still be declared, as RETIRED — deleting it removes the guard');
  for (const name of retired) {
    for (const [type, def] of Object.entries(CELL_TYPES)) {
      assert.ok(!(name in def.params), `${type} offers the retired param ${name}`);
    }
    // and the substrate must not write it: setSpan is the one path that ever could
    const core = readFileSync(join(HERE, 'card-core.js'), 'utf8');
    const setSpan = core.slice(core.indexOf('function setSpan'), core.indexOf('function setSpan') + 600);
    assert.ok(!new RegExp(`setToken\\([^)]*'${name}'`).test(setSpan), `setSpan writes the retired ${name}`);
  }
});

test('every op names a seat, and no op is graded as feelreef-side', () => {
  for (const [name, op] of Object.entries(OPS)) {
    assert.ok(op.seat, `${name} has no seat`);
    // 🔴 COAM §2: fO is NOT a seat on a customer's thing. If it ever appears here, the vendor has
    // given itself a master key on customer content, which is the空缺 feelreef is positioned against.
    assert.ok(!/\bfO\b|\bfA\b|\bfM\b/.test(op.seat), `${name} grants a feelreef-side seat on customer content`);
  }
  assert.equal(OPS.save_card.seat, OPS.put_asset.seat, 'writing a card and writing its assets must need the same seat');
  assert.notEqual(OPS.save_card.seat, OPS.get_card.seat, 'saving must not be as cheap as reading');
});

// 🔴 THE CONTROL. Every assertion above is a set comparison, and a set comparison against a scan
// that silently found nothing passes beautifully. These prove the scan has teeth.
test('CONTROL: the scan finds real content, and fires on a fabricated drift', () => {
  assert.ok(Object.keys(CASES).length >= 7, `the switch scan found only ${Object.keys(CASES).length} cases — it is not reading the renderer`);
  assert.ok(paramsIn(CASES.feature).size >= 5, 'the param scan found almost nothing in `feature` — it is not reading param access');
  assert.ok(paramsIn(fnBody('linkIcon')).has('iconhost'), 'the DELEGATES lookup is not reaching linkIcon');

  // a param the renderer reads and the definition does not declare MUST be caught
  const fake = paramsIn("case 'x': const q = p.definitelyNotDeclared;");
  assert.ok(fake.has('definitelyNotDeclared'), 'the scanner cannot see a param access at all');

  // and a type present in one place and not the other MUST be caught
  assert.throws(
    () => assert.deepEqual(['profile', 'link'].sort(), Object.keys(CELL_TYPES).sort()),
    'the type comparison does not fire on a mismatch',
  );
});
