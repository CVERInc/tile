// Guard: the OG card's font cascade. Runs without satori/resvg installed — the trap being guarded
// is in how we ASSEMBLE the font list, and that is pure data.
//   run: node packages/sitetile/og-card.test.mjs   (wired into scripts/test.sh)
//
// WHY (2026-08-03). satori does no per-glyph fallback between fonts sharing a `name`: it takes the
// first and every other glyph becomes a NO GLYPH box, silently, exit code 0. CJK forces chunked
// fonts (one weight of Noto Sans TC is 106 unicode-range chunks), so a multilingual card hits this
// by default, not by accident.
//
// It cost three broken rulers to find: byte count said fine, chunk count said fine, and counting
// <path> elements in the SVG said fine — satori emits ONE path for a whole text run, so eight
// glyphs report 1 whether they all drew or none did. Only looking at the image showed it. The
// assertions below are the part that CAN be mechanised; the picture still needs eyes.
import assert from 'node:assert/strict';
import { chunksFor, familyList, cardTree, ourCardPath, deadCards, CARD_W, CARD_H } from './og/og-card.mjs';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const mustFail = (name, fn) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert.ok(threw, `CONTROL GROUP FAILED: "${name}" passed on broken input — this ruler measures nothing`);
  n++; console.log(`  ✓ [control] ${name} fires when broken`);
};

// A miniature stand-in for fontsource's shape: latin in one chunk, two disjoint CJK chunks.
const IDX = [
  { pkg: 'latin', file: 'latin.woff', ranges: [[0x20, 0x24f]] },
  { pkg: 'tc', file: 'tc-a.woff', ranges: [[0x628a, 0x628a]] },          // 把
  { pkg: 'tc', file: 'tc-b.woff', ranges: [[0x4efb, 0x4efb], [0x4f55, 0x4f55]] }, // 任 何
];

check('a latin-only string needs exactly one chunk', () => {
  assert.equal(chunksFor('ATLAS.DEV', IDX).length, 1);
});

check('mixed scripts pull in every chunk the text actually needs', () => {
  const picks = chunksFor('把任何 ATLAS', IDX);
  assert.equal(picks.length, 3, 'latin + both CJK chunks');
});

check('a glyph no chunk covers is skipped rather than mispointed at a wrong chunk', () => {
  assert.deepEqual(chunksFor('\u{1F600}', IDX), [], 'an uncovered codepoint contributes no chunk');
});

check('chunks are deduped and keep first-use order — the order becomes the cascade', () => {
  const picks = chunksFor('把把把任把', IDX);
  assert.equal(picks.length, 2);
  assert.equal(picks[0].file, 'tc-a.woff');
});

// ── the trap itself ──────────────────────────────────────────────────────────────────────────────
check('🔴 every family name is DISTINCT — same-named fonts render NO GLYPH boxes', () => {
  const names = familyList(chunksFor('把任何 ATLAS', IDX));
  assert.equal(new Set(names).size, names.length,
    'satori takes the first font per family name and does not fall back per glyph');
});

check('the card asks for the whole cascade, not just the first family', () => {
  const names = familyList(chunksFor('把任何 ATLAS', IDX));
  const family = names.join(', ');
  const tree = cardTree({ title: '把任何 ATLAS', brand: 'ATLAS.DEV', bg: '#111', fg: '#fff', family });
  const seen = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.style?.fontFamily) seen.push(node.props.style.fontFamily);
    const c = node.props?.children;
    if (Array.isArray(c)) c.forEach(walk); else walk(c);
  })(tree);
  assert.ok(seen.length >= 3, 'root + title + brand must each carry the cascade');
  for (const f of seen) assert.equal(f, family, 'a node that names only one family loses every other script');
});

check('the card is the size every platform crops to', () => {
  assert.equal(CARD_W, 1200);
  assert.equal(CARD_H, 630);
});

// ── the build gate: a page must never ship an og:image the build did not create ──────────────────
check('only OUR cards are claimed — a site that authored its own share-image is left alone', () => {
  assert.equal(ourCardPath('https://example.com/og/about.png'), '/og/about.png');
  assert.equal(ourCardPath('/og/devlog/x.png'), '/og/devlog/x.png');
  assert.equal(ourCardPath('https://example.com/custom/mine.jpg'), '', 'someone else\'s image is not ours to make or to police');
  assert.equal(ourCardPath('/og/notapng.svg'), '');
  assert.equal(ourCardPath(''), '');
});

check('a claimed card that is not on disk is reported', () => {
  const pages = [{ img: '/og/a.png' }, { img: '/og/b.png' }, { img: '/custom/c.jpg' }];
  const dead = deadCards(pages, (rel) => rel === '/og/a.png');
  assert.deepEqual(dead.map((d) => d.img), ['/og/b.png'], 'b is missing; the third is not ours to check');
});

check('all present → nothing dead', () => {
  assert.deepEqual(deadCards([{ img: '/og/a.png' }], () => true), []);
});

// ── control group ────────────────────────────────────────────────────────────────────────────────
mustFail('the distinct-names check', () => {
  const names = ['OG', 'OG', 'OG'];   // the exact bug: one name for every chunk
  assert.equal(new Set(names).size, names.length);
});

mustFail('the cascade-everywhere check', () => {
  // a node that names only the first family — renders latin, boxes the rest
  const seen = ['OGF0, OGF1', 'OGF0'];
  for (const f of seen) assert.equal(f, 'OGF0, OGF1');
});

mustFail('the dead-card gate', () => {
  // the gate believing everything exists is indistinguishable from everything existing
  assert.deepEqual(deadCards([{ img: '/og/missing.png' }], () => true).map((d) => d.img), ['/og/missing.png']);
});

mustFail('the not-ours check', () => {
  assert.equal(ourCardPath('https://example.com/custom/mine.jpg'), '/custom/mine.jpg');
});

mustFail('the chunk-coverage check', () => {
  assert.equal(chunksFor('把任何 ATLAS', IDX).length, 1);  // pretending one chunk is enough
});

console.log(`\n✅ og card: ${n} checks passed (incl. 5 control-group probes)`);
