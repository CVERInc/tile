// Property test for the text-edit editing session (rounds 5–7): random event sequences — click,
// type, Enter/blur, Escape, host replies that save or refuse, replies that come late, out of order
// or never, stray replies with the wrong id, and the coral's own bounded wait running out — driven
// through createEditor against a host that applies each edit to its own copy of the page with the
// reference applier and answers readbacks with the reference readTextAt.
//   run: node --test packages/dynamic-corals/text-edit/text-edit-property.test.mjs
//   PROPERTY_SEED=<n> PROPERTY_RUNS=<n> to replay or widen.
//
// The properties:
//  1. After every event, an element that is not being typed in and is not marked unconfirmed
//     (`data-text-edit` absent or `refused`) shows exactly the words the saved page has for IT —
//     for that paragraph, followed through lines other editors inserted above it, not for whatever
//     now sits at its old line: words the host has not confirmed never look like saved words.
//  2. After every event, `data-text-edit` is the element's state (absent when idle).
//  3. No user event (click, typing, Enter/blur, Escape) moves an element out of `pending`.
//  4. Every edit sent for an element carries words the owner typed into it AFTER the typing that
//     the element's previous edit carried: a refused or lost edit is never retried, and no reply,
//     blur, Escape or timeout invents an edit. (Sent order is not typing order — an edit can wait
//     its turn while the owner types newer words — so this pairs each edit with a keystroke.)
//  5. A reply with an id the coral is not waiting for is ignored and changes nothing.
//  6. At rest (nobody typing, every message answered or dropped, every timer run), no element is
//     pending; idle and refused ones show the saved page word for word, and any other is marked
//     `unknown` or `changed`.
//
// The host keeps the contract the README states: it PROCESSES what it receives in order, one
// message at a time (an edit is applied or refused before a later readback is read). What is not
// promised is modelled freely: a message can be lost before the host gets it, and an answer can be
// lost, delayed past the coral's wait, or delivered out of order. And the page is not the frame's
// alone (round 7): another editor can insert a paragraph above the frame's paragraphs at any time
// — between a send and its readback too, so a readback answers for a span that has moved — and
// take it out again (the page then has the revision it had before).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';
import { editableAt, createEditor, cleanText, RESULT_MESSAGE, EDIT_MESSAGE, READBACK_MESSAGE, READBACK_RESULT_MESSAGE, PENDING_TIMEOUT_MS } from './text-edit-core.mjs';
import { applyTextEdit, sourceRevision, htmlTree, readTextAt } from './text-edit-source.mjs';

const render = (md) => htmlTree(renderSiteToHtml(parseSite(md, { sourceLines: true })));
const offered = (root) => [...root.all()].map(editableAt).filter((f, i, arr) => f && f.plain && arr.findIndex((g) => g && g.el === f.el) === i);

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeClock() {
  let now = 0, n = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++n, { at: now + ms, fn }); return n; },
    clearTimer: (id) => { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}

const PAGE = '## About\n\nOriginal\n\nOriginal\n\n- Item\n';
// Words an owner might type: the page's own words (so reversals and duplicates happen), new words,
// words the applier refuses as not plain, nothing at all, and a character the coral refuses itself.
const WORDS = ['Original', 'Item', 'About', 'First', 'Second', 'Third', '**bold**', '', 'a\u0000b'];

function run(seed, steps) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  let md = PAGE;
  const inbox = [];             // messages sent to the host and not processed yet, oldest first
  const outbox = [];            // the host's answers not delivered yet
  const answered = [];          // ids already answered (a stray reply may repeat one)
  const log = [];
  const fail = (msg) => assert.fail(`seed ${seed}: ${msg}\n  events: ${log.join(' ')}`);
  const typed = [];             // { line, words, t } for every type event, in order
  const carried = new Map();    // line → t of the type event its last sent edit carried
  // (The coral catches a throwing `post` as a failed send, so a violation is recorded here and
  // raised by check(), never thrown from inside post.)
  const violations = [];
  const post = (m) => {
    if (m.type === EDIT_MESSAGE) {
      const last = carried.has(m.anchor.start) ? carried.get(m.anchor.start) : -1;
      const k = typed.find((e) => e.line === m.anchor.start && e.words === m.after && e.t > last);
      if (!k) violations.push(`${m.id} (${JSON.stringify(m.after)}) was sent for line ${m.anchor.start}, but those words were not typed there after the typing its previous edit carried`);
      else carried.set(m.anchor.start, k.t);
    } else if (m.type !== READBACK_MESSAGE) violations.push(`unknown message type ${m.type}`);
    inbox.push(m);
  };
  const clock = makeClock();
  const ed = createEditor({ page: '/', revision: sourceRevision(md), post, hint: () => {}, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const root = render(md);
  const els = offered(root);

  // Where each frame element's own paragraph is in the saved page now (other editors move it).
  const lineOf = els.map((f) => Number(f.el.getAttribute('data-src').split('-')[0]));
  const inserted = [];          // words of paragraphs other editors inserted at line 2, newest last
  const saved = () => lineOf.map((line) => { const r = readTextAt(md, { anchor: { start: line, end: line } }); assert.ok(r.ok, `line ${line} of ${JSON.stringify(md)}`); return r.words; });
  function insertAbove(words) {
    const ls = md.split('\n'); ls.splice(2, 0, words, ''); md = ls.join('\n');
    lineOf.forEach((line, i) => { if (line >= 2) lineOf[i] = line + 2; });
    inserted.push(words);
  }
  function takeOut() {
    const ls = md.split('\n');
    if (!inserted.length || ls[2] !== inserted[inserted.length - 1]) return false; // edited since: leave it
    ls.splice(2, 2); md = ls.join('\n');
    lineOf.forEach((line, i) => { if (line >= 4) lineOf[i] = line - 2; });
    inserted.pop();
    return true;
  }
  const snapshot = () => els.map((f) => [ed.stateOf(f.el), f.el.textContent, f.el.getAttribute('data-text-edit')].join('|')).join(';') + '#' + inbox.length + '/' + outbox.length;
  function check(event) {
    if (violations.length) fail(`after ${event}, ${violations[0]}`);
    const want = saved();
    els.forEach((f, i) => {
      const state = ed.stateOf(f.el);
      const attr = f.el.getAttribute('data-text-edit');
      if (attr !== (state === 'idle' ? null : state)) fail(`after ${event}, element ${i} is ${state} but marked ${JSON.stringify(attr)}`);
      const typing = ed.active && ed.active.el === f.el;
      if ((attr === null || attr === 'refused') && !typing && cleanText(f.el.textContent) !== want[i])
        fail(`after ${event}, element ${i} is ${state} showing ${JSON.stringify(f.el.textContent)} as saved, but the page saved ${JSON.stringify(want[i])}`);
    });
  }
  // The host processes the oldest message it has: an edit is applied (or refused), a readback is
  // read. Its answer goes out, to be delivered (or lost) later.
  function processNext(ok) {
    const m = inbox.shift();
    if (m.type === READBACK_MESSAGE) {
      const res = ok ? readTextAt(md, m) : { ok: false };
      outbox.push({ type: READBACK_RESULT_MESSAGE, doc: m.doc, id: m.id, ok: res.ok, words: res.words, revision: res.revision, section: res.section });
    } else {
      const res = ok ? applyTextEdit(md, m) : { ok: false };
      if (res.ok) md = res.markdown;
      outbox.push(res.ok ? { type: RESULT_MESSAGE, doc: m.doc, id: m.id, ok: true, revision: res.revision, section: res.section } : { type: RESULT_MESSAGE, doc: m.doc, id: m.id, ok: false });
    }
    return m.id;
  }
  function deliver(i) { const [a] = outbox.splice(i, 1); answered.push(a.id); ed.onResult(a); return a.id; }
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
    if (roll < 0.2) { const i = Math.floor(r() * els.length); event = `click${i}`; user(event, () => ed.begin(els[i])); }
    else if (roll < 0.4) { if (!ed.active) continue; const w = r() < 0.3 ? saved()[els.findIndex((f) => f.el === ed.active.el)] : pick(WORDS); event = `type(${JSON.stringify(w)})`; user(event, () => { ed.active.el.textContent = w; typed.push({ line: Number(ed.active.el.getAttribute('data-src').split('-')[0]), words: w, t: typed.length }); }); }
    else if (roll < 0.52) { event = 'enter'; user(event, () => ed.commit()); }
    else if (roll < 0.57) { event = 'escape'; user(event, () => ed.cancel()); }
    else if (roll < 0.72) { if (!inbox.length) continue; const ok = r() < 0.7; event = (ok ? 'process:' : 'refuse:') + processNext(ok); }
    else if (roll < 0.87) {
      if (!outbox.length) continue;
      const i = outbox.length > 1 && r() < 0.3 ? outbox.length - 1 : 0; // sometimes out of order
      event = 'deliver' + (i ? '(last)' : '') + ':' + deliver(i);
    }
    else if (roll < 0.9) { // never answered: lost on the way in, or its answer lost on the way out
      if (inbox.length && (!outbox.length || r() < 0.5)) event = 'lost:' + inbox.shift().id;
      else if (outbox.length) event = 'answer-lost:' + outbox.splice(Math.floor(r() * outbox.length), 1)[0].id;
      else continue;
    }
    else if (roll < 0.93) { event = 'tick'; clock.tick(PENDING_TIMEOUT_MS); }
    else if (roll < 0.96) { // another editor: a paragraph above, sometimes with words the frame shows
      if (inserted.length && r() < 0.4) { if (!takeOut()) continue; event = 'other-editor:take-out'; }
      else { // half the time a duplicate of a paragraph the page has: words alone cannot tell them apart
        const w = r() < 0.5 ? pick(saved()) : pick(['Inserted', 'Original', 'First', 'Item']);
        insertAbove(w); event = `other-editor:insert(${w})`;
      }
    }
    else {
      const id = answered.length && r() < 0.5 ? pick(answered) : 'e' + (900 + Math.floor(r() * 99));
      const type = r() < 0.5 ? RESULT_MESSAGE : READBACK_RESULT_MESSAGE;
      event = `stray(${id})`;
      const before = snapshot();
      if (inbox.some((m) => m.id === id) || outbox.some((a) => a.id === id)) continue; // that would be a real answer
      const took = ed.onResult({ type, doc: ed.doc, id, ok: r() < 0.5, revision: 'r-stray', words: 'Stray', section: 's1-about' });
      if (took) fail(`a ${type} for ${id} was taken, but nothing was waiting for it`);
      if (snapshot() !== before) fail(`a stray ${type} for ${id} changed something`);
    }
    log.push(event);
    check(event);
  }
  // Come to rest: leave the field, then answer, drop and wait until nothing is left.
  ed.commit(); log.push('blur');
  check('the final blur');
  for (let guard = 0; inbox.length || outbox.length || clock.pending; guard++) {
    if (guard > 300) fail('it never came to rest');
    let event;
    const roll = r();
    if (inbox.length && roll < 0.5) event = roll < 0.07 ? 'lost:' + inbox.shift().id : 'process:' + processNext(roll < 0.4);
    else if (outbox.length && roll < 0.9) event = roll < 0.55 ? 'answer-lost:' + outbox.shift().id : 'deliver:' + deliver(0);
    else { event = 'tick'; clock.tick(PENDING_TIMEOUT_MS); }
    log.push(event); check(event + ' at rest');
  }
  const want = saved();
  els.forEach((f, i) => {
    const state = ed.stateOf(f.el);
    if (state === 'pending' || state === 'editing') fail(`at rest element ${i} is ${state}`);
    if (state !== 'unknown' && state !== 'changed' && cleanText(f.el.textContent) !== want[i]) fail(`at rest element ${i} shows ${JSON.stringify(f.el.textContent)}, the page saved ${JSON.stringify(want[i])}`);
  });
}

test('random user events, replies (late, out of order, never, stray) and timeouts never show unconfirmed words as saved', () => {
  const runs = Number(process.env.PROPERTY_RUNS) || 1000;
  const first = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : 1;
  const only = !!process.env.PROPERTY_SEED;
  for (let seed = first; seed < first + (only ? 1 : runs); seed++) run(seed, 40);
});

test('the reviewer\'s round-4 sequence, as a fixed event list through the same checks', () => {
  // click, type First, Enter, click, type Original, blur, then e1 succeeds.
  let md = '## About\n\nOriginal\n';
  const inbox = [];
  const clock = makeClock();
  const ed = createEditor({ page: '/', revision: sourceRevision(md), post: (m) => inbox.push(m), hint: () => {}, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const f = offered(render(md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Original'; ed.commit();
  while (inbox.length) {
    const m = inbox.shift();
    const res = applyTextEdit(md, m);
    assert.ok(res.ok, JSON.stringify(res));
    md = res.markdown;
    ed.onResult({ type: RESULT_MESSAGE, doc: m.doc, id: m.id, ok: true, revision: res.revision, section: res.section });
  }
  assert.equal(md, '## About\n\nOriginal\n');
  assert.equal(cleanText(f.el.textContent), 'Original');
  assert.equal(ed.stateOf(f.el), 'idle');
});

test('the reviewer\'s round-5 sequence: Enter, then the host never answers', () => {
  const md = '## About\n\nOriginal\n';
  const inbox = [];
  const clock = makeClock();
  const ed = createEditor({ page: '/', revision: sourceRevision(md), post: (m) => inbox.push(m), hint: () => {}, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const f = offered(render(md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, doc: ed.doc, id: 'e999', ok: true, revision: 'bogus' }), false);
  assert.equal(f.el.getAttribute('data-text-edit'), 'pending', 'unconfirmed words are marked while they wait');
  clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(cleanText(f.el.textContent), 'Original', 'and after the wait the saved words are back');
  assert.equal(f.el.getAttribute('data-text-edit'), 'unknown');
  clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(clock.pending, 0);
  assert.equal(cleanText(f.el.textContent), 'Original');
  assert.equal(f.el.getAttribute('data-text-edit'), 'unknown');
});
