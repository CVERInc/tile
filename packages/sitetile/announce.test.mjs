// The site-wide announcement with a deadline (reef#2301).
//   run: node packages/sitetile/announce.test.mjs
//
// The rendered HTML is proven end to end in packages/build/build-site.test.mjs (band byte-identical,
// past until → nothing, future until → card). This file proves the parts a build cannot show: the
// decision under a chosen clock, and that a page built BEFORE the deadline takes the card down by
// itself once the visitor's clock passes it — the guard run as the browser runs it (its exact text,
// in a vm, with a fake clock), and the module's own deadline timer.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceModel, announceDismissKey, mountAnnounceCard, ANNOUNCE_GUARD_SCRIPT } from './astro/src/lib/announce.mjs';
import { uiCopy, LINGO_LOCALES } from './locale.mjs';
import { safeHref } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-11-20T00:00:00Z');
const UNTIL = '2026-12-01T23:59:00+09:00';
const UNTIL_ISO = '2026-12-01T14:59:00.000Z';
const UNTIL_MS = Date.parse(UNTIL);

test('announceModel: the four shapes, under a clock the caller hands in', () => {
  const m = (meta, now = NOW) => announceModel(meta, { now, safeHref });
  assert.deepEqual(m({}), { mode: '', text: '', href: '', until: '' });
  assert.deepEqual(m({ announce: '  Hello  ' }), { mode: 'band', text: 'Hello', href: '', until: '' });
  assert.deepEqual(m({ announce: 'Hello', 'announce-href': '/post/a/' }), { mode: 'band', text: 'Hello', href: '/post/a/', until: '' });
  assert.equal(m({ announce: 'Hello', 'announce-href': 'javascript:alert(1)' }).href, '', 'safeHref drops a script destination');
  assert.deepEqual(m({ announce: 'Hello', 'announce-href': '/a/', 'announce-until': UNTIL }),
    { mode: 'card', text: 'Hello', href: '/a/', until: UNTIL_ISO }, 'future until → card, until normalised to UTC ISO');
  assert.equal(m({ announce: 'Hello', 'announce-until': UNTIL }, UNTIL_MS + 1).mode, '', 'past until → nothing');
  assert.equal(m({ announce: 'Hello', 'announce-until': UNTIL }, UNTIL_MS).mode, '', 'the deadline itself is already over');
  assert.equal(m({ announce: 'Hello', 'announce-until': UNTIL }, UNTIL_MS - 1).mode, 'card');
  assert.equal(m({ announce: 'Hello', 'announce-until': UNTIL }, '2026-11-01T00:00:00Z').mode, 'card', 'now may be ISO, as in events-core');
  assert.equal(m({ announce: 'Hello', 'announce-until': 'next Tuesday' }).mode, '', 'an unreadable deadline is not "forever"');
  assert.equal(m({ 'announce-href': '/a/', 'announce-until': UNTIL }).mode, '', 'no text → nothing, whatever else is set');
});

// A card as the guard and the module see it: attributes, three children, remove().
function fakeCard({ until = UNTIL_ISO, text = 'Spring class', prefix = 'Ends in ' } = {}) {
  const listeners = {};
  const t = { textContent: text };
  const cd = { textContent: '', getAttribute: (k) => (k === 'data-prefix' ? prefix : k === 'data-until' ? until : null) };
  const x = { hidden: true, addEventListener: (ev, f) => { listeners[ev] = f; }, click: () => listeners.click && listeners.click() };
  const card = {
    className: 'rf-announce-card', removed: false,
    getAttribute: (k) => (k === 'data-until' ? until : null),
    querySelector: (sel) => ({ '.rf-announce-t': t, '.rf-announce-cd': cd, '.rf-announce-x': x }[sel] || null),
    remove() { this.removed = true; },
  };
  return { card, cd, x };
}

function runGuard(card, now, storage = {}) {
  class FakeDate extends Date { static now() { return now; } }
  const localStorage = typeof storage === 'function' ? { getItem: storage } : { getItem: (k) => (k in storage ? storage[k] : null) };
  vm.runInNewContext(ANNOUNCE_GUARD_SCRIPT, {
    Date: FakeDate, localStorage, document: { currentScript: { previousElementSibling: card } },
  });
  return card.removed;
}

test('the inline guard: a page built before the deadline hides the card once now ≥ until', () => {
  assert.equal(runGuard(fakeCard().card, UNTIL_MS - 1000), false, 'before the deadline the card stays');
  assert.equal(runGuard(fakeCard().card, UNTIL_MS), true, 'at the deadline it is removed');
  assert.equal(runGuard(fakeCard().card, UNTIL_MS + 864e5 * 30), true, 'a month later it is removed');
  assert.equal(runGuard(fakeCard({ until: 'garbage' }).card, NOW), true, 'an unreadable until never shows');
});

test('the inline guard honours the visitor\'s × — the same key the module writes', () => {
  const key = announceDismissKey('Spring class', UNTIL_ISO);
  assert.equal(runGuard(fakeCard().card, NOW, { [key]: '1' }), true, 'dismissed → removed before paint');
  assert.equal(runGuard(fakeCard({ text: 'Summer class' }).card, NOW, { [key]: '1' }), false,
    'a new period (new words) shows again');
  assert.equal(runGuard(fakeCard().card, NOW, () => { throw new Error('storage blocked'); }), false,
    'blocked storage leaves the card up rather than throwing');
});

test('the inline guard leaves anything that is not the card alone', () => {
  const other = { className: 'rf-header', getAttribute: () => null, querySelector: () => null, removed: false, remove() { this.removed = true; } };
  assert.equal(runGuard(other, UNTIL_MS + 1), false);
  // Its text is the same on every page — nothing interpolated, so one CSP hash covers every site —
  // and it cannot close its own <script> element.
  assert.doesNotMatch(ANNOUNCE_GUARD_SCRIPT, /<|\$\{/);
});

function fakeClock(start) {
  let now = start; const timers = [];
  return {
    env: { now: () => now, setTimeout: (f, ms) => { timers.push({ f, ms }); } },
    timers,
    advance(ms) { now += ms; },
    fireNext() { const t = timers.shift(); if (t) t.f(); return t; },
  };
}

test('the module: countdown ticks, and a page left open takes the card down at the deadline', () => {
  const { card, cd, x } = fakeCard();
  const clock = fakeClock(UNTIL_MS - 3 * 864e5);
  mountAnnounceCard(card, { ...clock.env, storage: null });
  assert.equal(cd.textContent, 'Ends in 3d', 'events-core countdownText, with the locale prefix');
  assert.equal(x.hidden, false, 'the × is unhidden once script can act on it');
  assert.equal(clock.timers[0].ms, 30000, 'days out → a half-minute cadence');

  clock.advance(3 * 864e5 - 5000); clock.fireNext();
  assert.equal(cd.textContent, 'Ends in 05s');
  assert.equal(clock.timers[0].ms, 1000, 'the final day ticks every second');

  clock.advance(5000); clock.fireNext();
  assert.equal(card.removed, true, 'at the deadline the card is gone');
  assert.equal(clock.timers.length, 0, 'and nothing keeps ticking');
});

test('the module never waits past the deadline', () => {
  const { card } = fakeCard();
  const clock = fakeClock(UNTIL_MS - 12000 - 864e5);  // 1 day + 12 s out: the 30 s cadence
  mountAnnounceCard(card, { ...clock.env, storage: null });
  assert.equal(clock.timers[0].ms, 30000);
  const clock2 = fakeClock(UNTIL_MS - 400);
  mountAnnounceCard(fakeCard().card, { ...clock2.env, storage: null });
  assert.equal(clock2.timers[0].ms, 400, 'the last timer lands on the deadline, not after it');
});

test('the module: × stores the dismissal locally and removes the card', () => {
  const { card, x } = fakeCard();
  const stored = {};
  mountAnnounceCard(card, { ...fakeClock(NOW).env, storage: { setItem: (k, v) => { stored[k] = v; } } });
  x.click();
  assert.equal(card.removed, true);
  assert.deepEqual(stored, { [announceDismissKey('Spring class', UNTIL_ISO)]: '1' });
});

test('× label and countdown words exist in every sitetile locale, in that locale', () => {
  for (const l of LINGO_LOCALES) {
    const u = uiCopy(l);
    assert.ok(u.announceClose && u.announceClose.trim(), `${l} has no announceClose`);
    assert.ok(u.announceEndsIn && u.announceEndsIn.trim(), `${l} has no announceEndsIn`);
    assert.ok(u.announceLabel && u.announceLabel.trim(), `${l} has no announceLabel`);
    if (l !== 'en-US') assert.notEqual(u.announceClose, uiCopy('en-US').announceClose, `${l} borrows the English ×`);
  }
});

// reef's reference-render vocabulary (its scripts/layout-classes.mjs) is swept from STATIC
// `class=` attributes in this layout — a class added only by script would read there as a typo.
test('every rf-announce* class is a static class attribute in SiteLayout', () => {
  const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');
  for (const c of ['rf-announce', 'rf-announce-card', 'rf-announce-t', 'rf-announce-cd', 'rf-announce-x']) {
    assert.ok(layout.includes(`class="${c}"`), `${c} is not a static class attribute`);
  }
});
