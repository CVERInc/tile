// header-overlay with a text-free hero (reef#2857).
//   run: node packages/sitetile/header-overlay-headingless.test.mjs
//
// The overlay turns the header solid once the hero's CONTENT block reaches the header band. The
// content block was `.st-hero-overlay`, else the hero's <h1>, else the hero itself. A text-free
// hero writes no <h1> (reef#2857), so the fallback became the whole section — whose top is the
// page top — and an entrance hero with a bg picture had a solid header from the first frame, the
// opposite of what the overlay is for. The content block is now the hero's first element that is
// not the `.st-hero-bg` picture layer; a hero with no such element collides with nothing.
//
// Runs the real script against a stub document whose geometry is chosen per case.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'astro/src/packages/header-overlay/header-overlay.js'), 'utf8');

console.log('header-overlay-headingless');
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// A stub element: `cls` its class tokens, `top` its viewport top, `kids` its element children.
function el(cls, top, kids = [], tag = 'div') {
  const set = new Set(cls);
  const node = {
    tag, kids, top, offsetHeight: 600,
    classList: { add: (c) => set.add(c), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) },
    has: (c) => set.has(c),
    get children() { return kids; },
    getBoundingClientRect: () => ({ top: node.top }),
    querySelector(sel) {
      const all = [];
      const walk = (n) => { for (const k of n.kids) { all.push(k); walk(k); } };
      walk(node);
      if (sel === 'h1') return all.find((k) => k.tag === 'h1') || null;
      if (sel.startsWith('.')) return all.find((k) => k.has(sel.slice(1))) || null;
      throw new Error('stub querySelector: ' + sel);
    },
  };
  return node;
}

// Runs the script; returns whether the header is solid at rest (scrollY 0).
function solidAtRest(hero) {
  const header = el(['rf-header'], 0);
  header.offsetHeight = 64;
  const document = { querySelector: (sel) => (sel === '.rf-header' ? header : sel.includes('.st-hero') ? hero : null) };
  const window = { scrollY: 0, addEventListener() {} };
  new Function('document', 'window', 'requestAnimationFrame', SRC)(document, window, (f) => f());
  assert.ok(header.has('rf-header--overlay'), 'the overlay did not engage');
  return header.has('is-solid');
}

test('🔴 a text-free entrance hero (no <h1>) keeps the header transparent at rest', () => {
  // <section class="st-hero" data-enter> <div class="st-hero-bg"> <p>lead</p> <div class="st-hero-cta">
  const hero = el(['st-hero'], 0, [el(['st-hero-bg'], 0), el([], 420, [], 'p'), el(['st-hero-cta'], 480)], 'section');
  assert.equal(solidAtRest(hero), false);
});

test('🔴 a text-free entrance hero with nothing but its picture keeps the header transparent at rest', () => {
  const hero = el(['st-hero'], 0, [el(['st-hero-bg'], 0)], 'section');
  assert.equal(solidAtRest(hero), false);
});

test('CONTROL: a titled entrance hero still keys on its <h1>', () => {
  const lowH1 = el(['st-hero'], 0, [el(['st-hero-bg'], 0), el([], 400, [], 'h1')], 'section');
  assert.equal(solidAtRest(lowH1), false, 'h1 below the header band');
  const highH1 = el(['st-hero'], 0, [el(['st-hero-bg'], 0), el([], 20, [], 'h1')], 'section');
  assert.equal(solidAtRest(highH1), true, 'h1 inside the header band');
});

test('CONTROL: a layered hero still keys on .st-hero-overlay', () => {
  const hero = el(['st-hero', 'st-hero-layered'], 0, [el(['st-hero-stage'], 0), el(['st-hero-overlay'], 30)], 'section');
  assert.equal(solidAtRest(hero), true);
});

console.log(`  ${passed} passed`);
