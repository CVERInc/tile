// Guard for #68: dialogue bubble sides are decided per PAGE, not per run, plus the opt-in
// `dialogue: author-right`.
//   run: node packages/sitetile/dialogue-sides.test.mjs   (wired into scripts/test.sh by glob)
//
// The bug: renderDialogue rebuilt its speaker order for every run of consecutive quote blocks,
// so in an article whose runs are separated by prose the party who OPENED each run took the
// left. Two published cver.net posts flipped sides mid-article because of it; the other ten
// happened to open every run with the same speaker. The fixtures below reproduce those shapes
// with fictional names.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { bodyHtml, dialogueContext } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// blog.mjs imports the model layer as `@sitetile`, an Astro alias plain node cannot resolve
// (same shim as blog-unlisted.test.mjs).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { flowingHtml, parsePost, dialogueAuthorRight } = await import('./astro/src/lib/blog.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// One turn: `> **Name**` + speech. A run is turns joined by a blank line; prose between runs
// splits them into separate <div class="st-dialogue"> groups.
const turn = (name, text) => '> **' + name + '**\n> ' + text;
const run = (...turns) => turns.join('\n\n');
// The sides of every turn on the page, in document order, paired with the speaker's initial.
const sides = (html) => [...html.matchAll(/data-side="(left|right)"[^>]*><div class="st-turn-who"[^>]*>([^<])/g)].map((m) => m[2] + ':' + m[1]);
const groups = (html) => (html.match(/<div class="st-dialogue">/g) || []).length;

// ── A: the first speaker on the page sits left, in every run ─────────────────────────────────

test('A: two runs, the second opened by the other speaker → both keep their first-assigned sides', () => {
  const body = run(turn('Ada', 'Does it fold?'), turn('Bram', 'Only on Tuesdays.'))
    + '\n\nSome prose in between.\n\n'
    + run(turn('Bram', 'It is Tuesday.'), turn('Ada', 'Then fold it.'));
  const html = bodyHtml(body);
  assert.equal(groups(html), 2, 'two runs, two groups');
  assert.deepEqual(sides(html), ['A:left', 'B:right', 'B:right', 'A:left']);
});

test('A: three speakers across runs → first on the page left, every other speaker right', () => {
  const body = run(turn('Ada', 'One.'), turn('Bram', 'Two.'))
    + '\n\nProse.\n\n'
    + run(turn('Cy', 'Three.'), turn('Ada', 'Four.'))
    + '\n\nMore prose.\n\n'
    + run(turn('Bram', 'Five.'), turn('Cy', 'Six.'));
  assert.deepEqual(sides(bodyHtml(body)), ['A:left', 'B:right', 'C:right', 'A:left', 'B:right', 'C:right']);
});

test('A: a single-run post renders byte-identical to before', () => {
  // Rendered by origin/main's site-core.js (pre-#68) on 2026-09-27 and pasted verbatim.
  const before = '<div class="st-dialogue"><div class="st-turn" data-side="left"><div class="st-turn-who" aria-hidden="true">A</div><p class="st-turn-name">Ada</p><div class="st-bubble"><p>Does it fold?</p></div></div><div class="st-turn" data-side="right"><div class="st-turn-who" aria-hidden="true">B</div><p class="st-turn-name">Bram</p><div class="st-bubble"><p>Only on Tuesdays.</p></div></div><div class="st-turn" data-side="left"><div class="st-turn-who" aria-hidden="true">A</div><p class="st-turn-name">Ada</p><div class="st-bubble"><p>Then fold it Tuesday.</p></div></div></div>';
  const body = run(turn('Ada', 'Does it fold?'), turn('Bram', 'Only on Tuesdays.'), turn('Ada', 'Then fold it Tuesday.'));
  assert.equal(bodyHtml(body), before);
  assert.equal(bodyHtml(body, { dialogue: dialogueContext() }), before, 'an explicit fresh context is the same page');
});

test('A: the context is per call, not module state — a second page starts its own order', () => {
  const p1 = bodyHtml(run(turn('Ada', 'Hi.'), turn('Bram', 'Hi.')));
  const p2 = bodyHtml(run(turn('Bram', 'Hi.'), turn('Ada', 'Hi.')));
  assert.deepEqual(sides(p1), ['A:left', 'B:right']);
  assert.deepEqual(sides(p2), ['B:left', 'A:right'], 'page two is judged on its own');
});

test('A: one context threaded through several bodyHtml calls is one page', () => {
  const dialogue = dialogueContext();
  const h1 = bodyHtml(run(turn('Ada', 'Hi.'), turn('Bram', 'Hi.')), { dialogue });
  const h2 = bodyHtml(run(turn('Bram', 'Again.'), turn('Ada', 'Again.')), { dialogue });
  assert.deepEqual(sides(h1 + h2), ['A:left', 'B:right', 'B:right', 'A:left']);
});

test('A: flowingHtml shares one order across the blocks a heading splits a post into', () => {
  const body = run(turn('Ada', 'Hi.'), turn('Bram', 'Hi.'))
    + '\n\n## Later\n\n'
    + run(turn('Bram', 'Again.'), turn('Ada', 'Again.'));
  const html = flowingHtml(body);
  assert.ok(html.includes('<h2>Later</h2>'));
  assert.deepEqual(sides(html), ['A:left', 'B:right', 'B:right', 'A:left']);
});

// ── the three live shapes from the #68 scan (fictional names) ────────────────────────────────

test('live shape: run 1 opened by X, runs 2–6 opened by Y → X stays left throughout (was: Y took the left in 2–6)', () => {
  // the `i-have-no-fingers` shape: 6 runs.
  const body = [run(turn('Xan', 'Ready?'), turn('Yu', 'Ready.'))]
    .concat([2, 3, 4, 5, 6].map((n) => run(turn('Yu', 'Run ' + n + '.'), turn('Xan', 'Noted.'))))
    .join('\n\nProse.\n\n');
  const html = flowingHtml(body);
  assert.equal(groups(html), 6);
  assert.deepEqual(sides(html), ['X:left', 'Y:right'].concat(...[2, 3, 4, 5, 6].map(() => ['Y:right', 'X:left'])));
});

test('live shape: 5 runs, opened by G, a later run opened by O → O moves right (was: O left in its own run)', () => {
  // the `overrides-on-overrides-on-overrides` shape: 5 runs, two models, G opens the article.
  const body = [
    run(turn('Gale', 'First.'), turn('Orin', 'Reply.')),
    run(turn('Gale', 'Second.')),
    run(turn('Orin', 'Third.'), turn('Gale', 'Reply.')),
    run(turn('Gale', 'Fourth.')),
    run(turn('Orin', 'Fifth.')),
  ].join('\n\nProse.\n\n');
  const html = flowingHtml(body);
  assert.equal(groups(html), 5);
  assert.deepEqual(sides(html), ['G:left', 'O:right', 'G:left', 'O:right', 'G:left', 'G:left', 'O:right']);
});

test('live shape: every run opened by the same speaker → unchanged (the other nine posts)', () => {
  const body = [
    run(turn('Kai', 'One.'), turn('Lou', 'Two.')),
    run(turn('Kai', 'Three.'), turn('Lou', 'Four.'), turn('Kai', 'Five.')),
    run(turn('Kai', 'Six.')),
  ].join('\n\nProse.\n\n');
  const html = flowingHtml(body);
  assert.equal(groups(html), 3);
  assert.deepEqual(sides(html), ['K:left', 'L:right', 'K:left', 'L:right', 'K:left', 'K:left']);
});

// ── C: `dialogue: author-right` ──────────────────────────────────────────────────────────────

const POST = (fm, body) => parsePost('p', '---\n' + fm + '\n---\n' + body);

test('C: author-right on, author speaks second on the page → author right, the other party left', () => {
  const body = run(turn('Bram', 'Hi.'), turn('Ada', 'Hi.')) + '\n\nProse.\n\n' + run(turn('Ada', 'Again.'), turn('Bram', 'Also.'));
  const post = POST('title: t\nauthor: Ada\ndialogue: author-right', body);
  assert.equal(dialogueAuthorRight(post), 'Ada');
  const html = flowingHtml(post.body, { authorRight: dialogueAuthorRight(post) });
  assert.deepEqual(sides(html), ['B:left', 'A:right', 'A:right', 'B:left']);
});

test('C: with a third party, the author is out of the order — first non-author left, the next right', () => {
  const body = run(turn('Ada', 'Hi.'), turn('Bram', 'Hi.'), turn('Cy', 'Also.'));
  const post = POST('title: t\nauthor: Ada\ndialogue: author-right', body);
  assert.deepEqual(sides(flowingHtml(post.body, { authorRight: dialogueAuthorRight(post) })), ['A:right', 'B:left', 'C:right']);
});

test('C: the author match is case-insensitive and trimmed', () => {
  const body = run(turn('ada', 'Hi.'), turn('Bram', 'Hi.'));
  const post = POST('title: t\nauthor:   ADA  \ndialogue: Author-Right', body);
  assert.deepEqual(sides(flowingHtml(post.body, { authorRight: dialogueAuthorRight(post) })), ['A:right', 'B:left']);
});

test('C: author never speaks → identical to A', () => {
  const body = run(turn('Bram', 'Hi.'), turn('Cy', 'Hi.')) + '\n\nProse.\n\n' + run(turn('Cy', 'Again.'), turn('Bram', 'Again.'));
  const post = POST('title: t\nauthor: Ada\ndialogue: author-right', body);
  assert.equal(flowingHtml(post.body, { authorRight: dialogueAuthorRight(post) }), flowingHtml(post.body));
  assert.deepEqual(sides(flowingHtml(post.body)), ['B:left', 'C:right', 'C:right', 'B:left']);
});

test('C: option absent, or any other value → identical to A', () => {
  const body = run(turn('Bram', 'Hi.'), turn('Ada', 'Hi.'));
  const off = POST('title: t\nauthor: Ada', body);
  const other = POST('title: t\nauthor: Ada\ndialogue: left', body);
  assert.equal(off.dialogue, '');
  assert.equal(other.dialogue, 'left');
  assert.equal(dialogueAuthorRight(off), '');
  assert.equal(dialogueAuthorRight(other), '');
  const a = flowingHtml(body);
  assert.equal(flowingHtml(off.body, { authorRight: dialogueAuthorRight(off) }), a);
  assert.equal(flowingHtml(other.body, { authorRight: dialogueAuthorRight(other) }), a);
  assert.deepEqual(sides(a), ['B:left', 'A:right']);
});

test('C: author-right without an author has nobody to seat → A', () => {
  const post = POST('title: t\ndialogue: author-right', run(turn('Bram', 'Hi.'), turn('Ada', 'Hi.')));
  assert.equal(dialogueAuthorRight(post), '');
});

console.log('\ndialogue-sides: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
