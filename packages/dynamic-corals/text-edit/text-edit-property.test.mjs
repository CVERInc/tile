// Property test for the text-edit editing session (round 5): random event sequences — click, type,
// Enter/blur, Escape, and host replies that save or refuse — driven through createEditor against a
// host that applies each edit to its own copy of the page with the reference applier.
//   run: node --test packages/dynamic-corals/text-edit/text-edit-property.test.mjs
//   PROPERTY_SEED=<n> PROPERTY_RUNS=<n> to replay or widen.
//
// The properties:
//  1. After every event, an element that is `idle` or `refused` and not being typed in shows exactly
//     the words the saved page has for it: a draft is never presented as saved.
//  2. `pending` is left only by a host reply: no click, blur, Enter, Escape or typing moves an
//     element out of it.
//  3. At rest (nobody typing, every reply given), every element is idle or refused, and the preview
//     shows the saved page word for word.
//  4. Every edit sent for an element carries words the owner typed into it AFTER the typing that
//     the element's previous edit carried: a refused edit is never retried, and no reply, blur or
//     Escape invents an edit. (Sent order is not typing order — an edit can wait its turn while
//     the owner types newer words — so this pairs each edit with a keystroke, not with a send.)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';
import { editableAt, createEditor, cleanText, RESULT_MESSAGE } from './text-edit-core.mjs';
import { applyTextEdit, sourceRevision, htmlTree } from './text-edit-source.mjs';

const render = (md) => htmlTree(renderSiteToHtml(parseSite(md, { sourceLines: true })));
const offered = (root) => [...root.all()].map(editableAt).filter((f, i, arr) => f && f.plain && arr.findIndex((g) => g && g.el === f.el) === i);

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PAGE = '## About\n\nOriginal\n\nOriginal\n\n- Item\n';
// Words an owner might type: the page's own words (so reversals and duplicates happen), new words,
// words the applier refuses as not plain, nothing at all, and a character the coral refuses itself.
const WORDS = ['Original', 'Item', 'About', 'First', 'Second', 'Third', '**bold**', '', 'a\u0000b'];

function run(seed, steps) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  let md = PAGE;
  const inbox = [];
  const log = [];
  const fail = (msg) => assert.fail(`seed ${seed}: ${msg}\n  events: ${log.join(' ')}`);
  const typed = [];             // { line, words, t } for every type event, in order
  const carried = new Map();    // line → t of the type event its last sent edit carried
  // (The coral catches a throwing `post` as a failed send, so a violation is recorded here and
  // raised by check(), never thrown from inside post.)
  const violations = [];
  const post = (m) => {
    const last = carried.has(m.anchor.start) ? carried.get(m.anchor.start) : -1;
    const k = typed.find((e) => e.line === m.anchor.start && e.words === m.after && e.t > last);
    if (!k) violations.push(`${m.id} (${JSON.stringify(m.after)}) was sent for line ${m.anchor.start}, but those words were not typed there after the typing its previous edit carried`);
    else carried.set(m.anchor.start, k.t);
    inbox.push(m);
  };
  const ed = createEditor({ page: '/', revision: sourceRevision(md), post, hint: () => {} });
  const root = render(md);
  const els = offered(root);

  const saved = () => offered(render(md)).map((f) => cleanText(f.el.textContent));
  function check(event) {
    if (violations.length) fail(`after ${event}, ${violations[0]}`);
    const want = saved();
    assert.equal(want.length, els.length, 'every edit replaces one line with one line');
    els.forEach((f, i) => {
      const state = ed.stateOf(f.el);
      const typing = ed.active && ed.active.el === f.el;
      if ((state === 'idle' || state === 'refused') && !typing && cleanText(f.el.textContent) !== want[i])
        fail(`after ${event}, element ${i} is ${state} showing ${JSON.stringify(f.el.textContent)} but the page saved ${JSON.stringify(want[i])}`);
    });
  }
  function reply(ok) {
    const m = inbox.shift();
    const res = ok ? applyTextEdit(md, m) : { ok: false };
    if (res.ok) md = res.markdown;
    ed.onResult(res.ok ? { type: RESULT_MESSAGE, id: m.id, ok: true, revision: res.revision, section: res.section } : { type: RESULT_MESSAGE, id: m.id, ok: false });
  }
  // A user event: no element that was pending before it may be anything else after it.
  function user(name, fn) {
    const before = els.map((f) => ed.stateOf(f.el));
    fn();
    els.forEach((f, i) => { if (before[i] === 'pending' && ed.stateOf(f.el) !== 'pending') fail(`${name} moved element ${i} out of pending to ${ed.stateOf(f.el)}`); });
  }

  // Typing picks the element's saved words a third of the time, so reversals happen often.
  for (let s = 0; s < steps; s++) {
    const roll = r();
    let event;
    if (roll < 0.25) { const i = Math.floor(r() * els.length); event = `click${i}`; user(event, () => ed.begin(els[i])); }
    else if (roll < 0.5) { if (!ed.active) continue; const w = r() < 0.3 ? saved()[els.findIndex((f) => f.el === ed.active.el)] : pick(WORDS); event = `type(${JSON.stringify(w)})`; user(event, () => { ed.active.el.textContent = w; typed.push({ line: Number(ed.active.el.getAttribute('data-src').split('-')[0]), words: w, t: typed.length }); }); }
    else if (roll < 0.65) { event = 'enter'; user(event, () => ed.commit()); }
    else if (roll < 0.72) { event = 'escape'; user(event, () => ed.cancel()); }
    else { if (!inbox.length) continue; const ok = r() < 0.7; event = ok ? 'ok' : 'refuse'; reply(ok); }
    log.push(event);
    check(event);
  }
  // Come to rest: leave the field, then answer everything (a reply may send a draft).
  ed.commit(); log.push('blur');
  check('the final blur');
  for (let guard = 0; inbox.length; guard++) {
    if (guard > 50) fail('replies never ran out');
    reply(r() < 0.7); log.push('reply'); check('a reply at rest');
  }
  const want = saved();
  els.forEach((f, i) => {
    const state = ed.stateOf(f.el);
    if (state !== 'idle' && state !== 'refused') fail(`at rest element ${i} is ${state}`);
    if (cleanText(f.el.textContent) !== want[i]) fail(`at rest element ${i} shows ${JSON.stringify(f.el.textContent)}, the page saved ${JSON.stringify(want[i])}`);
  });
}

test('random click/type/Enter/Escape/reply sequences never show a draft as saved, and come to rest on the saved page', () => {
  const runs = Number(process.env.PROPERTY_RUNS) || 1000;
  const first = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : 1;
  const only = !!process.env.PROPERTY_SEED;
  for (let seed = first; seed < first + (only ? 1 : runs); seed++) run(seed, 40);
});

test('the reviewer\'s round-4 sequence, as a fixed event list through the same checks', () => {
  // click, type First, Enter, click, type Original, blur, then e1 succeeds.
  let md = '## About\n\nOriginal\n';
  const inbox = [];
  const ed = createEditor({ page: '/', revision: sourceRevision(md), post: (m) => inbox.push(m), hint: () => {} });
  const f = offered(render(md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Original'; ed.commit();
  while (inbox.length) {
    const m = inbox.shift();
    const res = applyTextEdit(md, m);
    assert.ok(res.ok, JSON.stringify(res));
    md = res.markdown;
    ed.onResult({ type: RESULT_MESSAGE, id: m.id, ok: true, revision: res.revision, section: res.section });
  }
  assert.equal(md, '## About\n\nOriginal\n');
  assert.equal(cleanText(f.el.textContent), 'Original');
  assert.equal(ed.stateOf(f.el), 'idle');
});
