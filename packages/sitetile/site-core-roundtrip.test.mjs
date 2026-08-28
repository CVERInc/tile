// sitetile round-trip — the guard that `serializeSite(parseSite(x))` loses NOTHING an author wrote.
//   run: node site-core-roundtrip.test.mjs
//
// 🩸 Why this file exists, and why it does NOT check idempotence. A collection category's lead
// paragraph was parsed into `group.lead`, dropped by the model builder, and never emitted — so
// every save through every door (MCP `save_page`, the console editor, batch `save_pages`) deleted
// those paragraphs. Measured 2026-08-28: `serialize(parse(x))` was a STABLE FIXPOINT on every one
// of the eight fixtures this package ships, and on the broken collection page too. Of course it
// was — dropping the same text twice drops nothing the second time. A round-trip that agrees with
// itself agrees with itself while both halves are wrong.
//
// So this file carries TWO rulers, and neither one asks the parser whether it agrees with itself:
//   1. CORALS — one canonical page per coral, asserted BYTE-IDENTICAL through the round trip.
//   2. SHIPPED FIXTURES — every .md in the package that claims to be a sitetile page, asserted for
//      CONTENT PRESERVATION: every non-blank body line the author wrote is still in the output.
//      Independent of any parser: it compares the author's bytes to the output's bytes.
// Each ruler is proven to fire (see the two `control:` tests) — a gate nobody has watched fail is
// a gate you only know is quiet.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, serializeSite, isSiteFile, splitFrontmatter } from './site-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// ── ruler 1: one canonical page per coral, byte-identical ──────────────────────────────────────
// Written in the exact shape serializeSite emits, so "round-trip" means equality and not a
// negotiation about whitespace. Every coral in KNOWN_TYPES that has an inner structure is here;
// a new coral that forgets its serializer arrives as a red line with its own name on it.
const page = (typeline, body) =>
  '---\nsitetile-page: home\ntitle: T\n---\n\n## S\n%% sitetile: ' + typeline + ' %%\n' + body.join('\n') + '\n';

const CORALS = {
  'prose': page('prose', ['Plain **prose** with a [link](/x).']),
  'hero': page('hero bg=cover.jpg cta="Get started"→/signup', ['A **bold** start.']),
  'grid': page('grid cols=3', ['Pick one.', '### Fast', 'Loads quick.', '### Cheap', 'Costs little.']),
  'grid (icon shortcode)': page('grid cols=3', ['### :book-open: The Comic', 'Read it.']),
  'grid (emoji + href + cta + linked badge)': page('grid cols=3', ['### 📖 The Comic →/c "Read" [Soon →/s]', 'Body.']),
  'gallery': page('gallery', ['### Cover', '![c](/c.jpg)', 'Caption.']),
  'carousel': page('carousel cols=4', ['### One', '![1](/1.jpg)', '### Two', '![2](/2.jpg)']),
  'collection (flat categories)': page('collection', ['### Web', '#### Alpha →/a', '### Print', '#### Beta →/b']),
  'collection (category leads)': page('collection', [
    'What we have shipped.', '### Web', '受託開発とサイト制作。', '#### Alpha →/a', 'Body a.',
    '### Print', '書籍と図録の装丁。', '#### Beta →/b']),
  'collection (per-item seams)': page('collection', [
    '### OSS', '#### sheersweep →/s "Get"', 'A cleaner.', 'tags: mac, swift', 'learn: /docs', 'updated: last week']),
  'people (flat roster)': page('people', ['### Ake Fumi', '![Ake Fumi](/media/a.jpg)', 'Illustrator.', 'links: X=https://x.com/a', 'tone: dark']),
  'people (grouped, group leads)': page('people', [
    '### 繪師', 'Illustrators we work with.', '#### 白露', '#### 鴉參', '### 背景', 'Background artists.', '#### 游象宜']),
  'faq': page('faq', ['Ask us anything.', '### What is it?', 'A thing.', '### How much?', 'Free.']),
  'timeline': page('timeline', ['Our story.', '### 2021', '#### Founded', 'In a garage.', '### 2024', 'We shipped.']),
  'form': page('form', ['Say hello.', '### Name', '### Topic', '- Sales', '- Support', '### Message {textarea}']),
  'cta': page('cta button="Sign up"→/signup', ['Join today.']),
  'embed': page('embed', ['<div class="custom">verbatim ## not a heading</div>']),
};

for (const [name, src] of Object.entries(CORALS)) {
  test('coral round-trips byte-identical: ' + name, () => {
    assert.equal(serializeSite(parseSite(src)), src);
  });
}

test('control: the byte-identical ruler fires when a coral drops a field', () => {
  // Proves ruler 1 is reading the serializer and not a coincidence: strip a category lead off the
  // model by hand — exactly the shape of the bug this file was written for — and the comparison
  // must go red. Without this, "all green" could mean the fixtures simply have nothing to lose.
  const src = CORALS['collection (category leads)'];
  const site = parseSite(src);
  site.sections[0].groups.forEach((g) => { g.lead = ''; });
  assert.notEqual(serializeSite(site), src, 'a dropped category lead MUST break byte-equality');
});

// ── ruler 2: every shipped fixture keeps every line its author wrote ───────────────────────────
// Ask the TREE, not a hand-kept list: a fixture added tomorrow is covered the day it lands. The
// same discipline scripts/test.sh applies to test files, one directory down.
function markdownUnder(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) markdownUnder(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const FIXTURES = markdownUnder(HERE)
  .filter((p) => isSiteFile(fs.readFileSync(p, 'utf8')))
  .sort();

// 🔴 A ruler that measures no samples reports "worst case 0" and passes forever. Say the count out
// loud and assert a floor, so a fixture move turns this file red instead of quietly emptying it.
console.log('  · ' + FIXTURES.length + ' shipped sitetile fixture(s) found under ' + path.basename(HERE) + '/');
test('the fixture sweep actually has fixtures to sweep', () => {
  assert.ok(FIXTURES.length >= 5, 'expected at least 5 shipped sitetile pages, found ' + FIXTURES.length);
});

// Everything before the first `## ` is dropped on re-serialize by documented design (parseSite's
// pass 1, same as book-core — authoring keeps everything under a section), so it is not "loss". Compare
// only what an author put inside a section.
function authoredLines(src) {
  const { body } = splitFrontmatter(src);
  const lines = body.split('\n');
  const first = lines.findIndex((l) => /^## /.test(l));
  return (first === -1 ? [] : lines.slice(first)).map((l) => l.replace(/\s+$/, '')).filter((l) => l !== '');
}

// Multiset, not set membership: a line the author wrote twice must still be there twice, or a
// deduplicating bug reads as clean. 🔴 "Does it contain X" cannot see a lost duplicate — ask how
// many, not whether.
function tally(lines) {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
  return m;
}

function linesLost(src) {
  const want = tally(authoredLines(src));
  const have = tally(authoredLines(serializeSite(parseSite(src))));
  const lost = [];
  for (const [l, n] of want) {
    const kept = have.get(l) || 0;
    if (kept < n) lost.push(n === 1 ? l : `${l}  (written ${n}×, kept ${kept}×)`);
  }
  return lost;
}

for (const f of FIXTURES) {
  const rel = path.relative(HERE, f);
  test('shipped fixture loses no authored line: ' + rel, () => {
    const lost = linesLost(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(lost, [], 'these lines did not survive serialize(parse):\n      ' + lost.join('\n      '));
  });
}

// The corals table goes through the same ruler — it is the one that carries the structures the
// shipped fixtures happen not to use (no shipped page uses collection, people, faq or timeline as
// of 2026-08-28, which is exactly why the bug lived here).
for (const [name, src] of Object.entries(CORALS)) {
  test('coral loses no authored line: ' + name, () => {
    assert.deepEqual(linesLost(src), []);
  });
}

test('control: the content-preservation ruler fires on a real deletion', () => {
  // A preservation check that cannot report a loss is a green light wired to nothing. Wrap the
  // serializer in one that deletes a line and require linesLost to name it — same comparison, a
  // round trip that provably loses something.
  const src = CORALS['collection (category leads)'];
  const want = tally(authoredLines(src));
  const have = tally(authoredLines(serializeSite(parseSite(src)).replace('受託開発とサイト制作。\n', '')));
  const lost = [...want].filter(([l, n]) => (have.get(l) || 0) < n).map(([l]) => l);
  assert.deepEqual(lost, ['受託開発とサイト制作。'], 'the comparison names exactly the deleted line');
});

test('control: the ruler counts duplicates, so a deduplicating bug cannot hide in it', () => {
  // 🔴 The same line twice is the case set-membership silently passes. Prove the multiset sees it.
  const src = CORALS['faq'].replace('A thing.', 'A thing.\n### Repeat?\nA thing.');
  const want = tally(authoredLines(src));
  assert.equal(want.get('A thing.'), 2, 'the fixture really does say it twice');
  const have = tally(authoredLines(serializeSite(parseSite(src)).replace('A thing.\n', '')));
  assert.ok((have.get('A thing.') || 0) < want.get('A thing.'), 'dropping ONE of the two reads as loss');
  assert.deepEqual(linesLost(src), [], 'and the real serializer keeps both');
});

console.log('\nsitetile round-trip: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
