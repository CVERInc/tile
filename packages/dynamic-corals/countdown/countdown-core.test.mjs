// The countdown root, driven with a fake document and a hand-advanced clock.
//   run: node --test packages/dynamic-corals/countdown/countdown-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCountdown, mountAll } from './countdown-core.mjs';
import { FLIP_MS } from '../shared/flip.mjs';
import { createDocument, createClock } from '../shared/fake-dom.mjs';

const DEADLINE = '2026-12-01T23:59:59+09:00';
const DL = Date.parse(DEADLINE);
const D = 864e5;

function page({ deadline = DEADLINE, flip = true, expired = null, expiredText = null, units = ['days', 'hours', 'minutes', 'seconds'] } = {}) {
  const doc = createDocument();
  const root = doc.createElement('div');
  root.setAttribute('data-dynamic-coral', 'countdown');
  if (deadline !== null) root.setAttribute('data-deadline', deadline);
  if (expired) root.setAttribute('data-expired', expired);
  if (expiredText) root.setAttribute('data-expired-text', expiredText);
  root.hidden = true;
  for (const unit of units) {
    const el = doc.createElement('span');
    el.setAttribute('data-part', unit);
    if (flip) el.setAttribute('data-flip', '');
    root.appendChild(el);
  }
  doc.body.appendChild(root);
  return { doc, root, part: (u) => root.querySelector(`[data-part="${u}"]`) };
}

const env = (doc, clock, reduced = false) => ({
  document: doc, now: clock.now, reduced,
  setInterval: clock.setInterval, clearInterval: clock.clearInterval,
  setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
});
const cardsOf = (el) => el.querySelectorAll('.dc-flip');
const shown = (el) => cardsOf(el).map((c) => c.querySelector('.dc-flip-top').firstChild.textContent).join('');
const sr = (el) => el.querySelector('.dc-cd-sr').textContent;

test('first tick fills every unit and un-hides the root', () => {
  const { doc, root, part } = page();
  const clock = createClock(Date.parse('2026-10-30T02:19:00Z'));
  mountCountdown(root, env(doc, clock));
  assert.equal(root.hidden, false);
  assert.deepEqual(['days', 'hours', 'minutes', 'seconds'].map((u) => shown(part(u))), ['32', '12', '40', '59']);
  assert.equal(sr(part('days')), '32', 'the value stays readable to a screen reader');
});

test('plain text parts (no data-flip) get the two-digit value', () => {
  const { doc, root, part } = page({ flip: false });
  const clock = createClock(DL - (3 * D + 4 * 36e5 + 5 * 6e4 + 6e3));
  mountCountdown(root, env(doc, clock));
  assert.deepEqual(['days', 'hours', 'minutes', 'seconds'].map((u) => part(u).textContent), ['03', '04', '05', '06']);
  assert.equal(cardsOf(part('days')).length, 0);
});

test('ticks every second, and the seconds card flips in the right order', () => {
  const { doc, root, part } = page();
  const clock = createClock(DL - 10 * 1000);
  mountCountdown(root, env(doc, clock));
  assert.equal(shown(part('seconds')), '10');
  clock.advance(10);
  const ones = cardsOf(part('seconds'))[1];
  const f = (sel) => { const el = ones.querySelector(sel); return el ? el.firstChild.textContent : '-'; };
  assert.equal(f('.dc-flip-top') + f('.dc-flip-bottom') + f('.dc-flip-front') + f('.dc-flip-back'), '9009');
});

test('99 → 100 days and back: cards are added and dropped on the LEFT; the ones card keeps its node', () => {
  const second = page({ units: ['days'] });
  const clock2 = createClock(DL - 100 * D - 1000);
  const ctl = mountCountdown(second.root, env(second.doc, clock2));
  assert.equal(cardsOf(second.part('days')).length, 3);
  assert.equal(shown(second.part('days')), '100');
  const onesAt100 = cardsOf(second.part('days'))[2];
  clock2.advance(2000);                                  // crosses 100 → 99
  clock2.advance(FLIP_MS);
  assert.equal(cardsOf(second.part('days')).length, 2);
  assert.equal(shown(second.part('days')), '99');
  assert.equal(cardsOf(second.part('days'))[1], onesAt100, 'the ones digit is the same card throughout');
  ctl.stop();
});

test('expiry with data-expired=hide (default): root hidden, timer stopped', () => {
  const { doc, root } = page();
  const clock = createClock(DL - 2000);
  const ctl = mountCountdown(root, env(doc, clock));
  assert.equal(ctl.running, true);
  clock.advance(5000);
  assert.equal(root.hidden, true);
  assert.equal(ctl.running, false);
  assert.equal(clock.pending() <= 2, true, 'only flip settle timers may remain, never the tick');
  clock.advance(FLIP_MS);
  assert.equal(clock.pending(), 0);
});

test('expiry with data-expired=text: content replaced, root shown, timer stopped', () => {
  const { doc, root } = page({ expired: 'text', expiredText: 'Registration closed' });
  const clock = createClock(DL + 1);
  const ctl = mountCountdown(root, env(doc, clock));
  assert.equal(root.textContent, 'Registration closed');
  assert.equal(root.hidden, false);
  assert.equal(ctl.running, false);
  assert.equal(clock.pending(), 0, 'already expired at mount: no interval was ever started');
});

test('a deadline without an offset mounts nothing and changes nothing', () => {
  for (const deadline of ['2026-12-01T23:59:59', null]) {
    const { doc, root } = page({ deadline });
    const clock = createClock(DL - D);
    assert.equal(mountCountdown(root, env(doc, clock)), null);
    assert.equal(root.hidden, true);
    assert.equal(clock.pending(), 0);
    assert.equal(doc.head.children.length, 0, 'no style injected either');
  }
});

test('reduced motion: cards change with no flaps and no settle timers', () => {
  const { doc, root, part } = page();
  const clock = createClock(DL - 10 * 1000);
  mountCountdown(root, env(doc, clock, true));
  clock.advance(10);
  assert.equal(part('seconds').querySelectorAll('.dc-flip-flap').length, 0);
  assert.equal(shown(part('seconds')), '09');
  assert.equal(clock.pending(), 1, 'only the tick interval');
});



test('mountAll mounts each root once', () => {
  const { doc, root } = page();
  const clock = createClock(DL - D);
  mountAll(doc, env(doc, clock));
  mountAll(doc, env(doc, clock));
  assert.equal(root.getAttribute('data-dynamic-coral-mounted'), '1');
  assert.equal(clock.pending(), 1, 'one interval, not two');
});

test('digit cards are sized by the whole digit set 0–9 (or data-flip-faces), not the digit shown', () => {
  const { doc, root, part } = page({ units: ['seconds'] });
  mountCountdown(root, env(doc, createClock(DL - 10 * 1000)));
  for (const card of cardsOf(part('seconds'))) {
    assert.deepEqual(card.querySelector('.dc-flip-size').children.map((c) => c.textContent), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  }
  const custom = page({ units: ['seconds'] });
  custom.part('seconds').setAttribute('data-flip-faces', '０,１,２,３,４,５,６,７,８,９');
  mountCountdown(custom.root, env(custom.doc, createClock(DL - 10 * 1000)));
  assert.equal(cardsOf(custom.part('seconds'))[0].querySelector('.dc-flip-size').children[0].textContent, '０');
});

test('styles are injected once per document — also when a later root flips and an earlier one did not', () => {
  const a = page({ flip: false });
  const clock = createClock(DL - D);
  mountCountdown(a.root, env(a.doc, clock));
  assert.equal(a.doc.head.children.length, 1, 'injected even with no flipping part (the [hidden] guard)');
  const second = a.doc.createElement('div');
  second.setAttribute('data-deadline', DEADLINE);
  const p = a.doc.createElement('span');
  p.setAttribute('data-part', 'seconds');
  p.setAttribute('data-flip', '');
  second.appendChild(p);
  a.doc.body.appendChild(second);
  mountCountdown(second, env(a.doc, clock));
  assert.equal(a.doc.head.children.length, 1, 'a second, flipping root on the same document adds no second style');
  assert.match(a.doc.head.children[0].textContent, /\.dc-flip\{/, 'the one style carries the card CSS too');
});

test('the [hidden] guard is part of the injected CSS and beats a site display rule', () => {
  const { doc, root } = page({ flip: false });
  mountCountdown(root, env(doc, createClock(DL - D)));
  assert.ok(doc.head.children[0].textContent.startsWith('[data-dynamic-coral="countdown"][hidden]{display:none!important}'));
});

test('the LARGEST present unit absorbs the units above it (no silently dropped days)', () => {
  const left = 2 * D + 5 * 36e5 + 12 * 6e4 + 30e3;
  const hms = page({ flip: false, units: ['hours', 'minutes', 'seconds'] });
  mountCountdown(hms.root, env(hms.doc, createClock(DL - left)));
  assert.deepEqual(['hours', 'minutes', 'seconds'].map((u) => hms.part(u).textContent), ['53', '12', '30']);
  const ms = page({ flip: false, units: ['minutes', 'seconds'] });
  mountCountdown(ms.root, env(ms.doc, createClock(DL - left)));
  assert.deepEqual(['minutes', 'seconds'].map((u) => ms.part(u).textContent), ['3192', '30']);
  const s = page({ units: ['seconds'] });
  mountCountdown(s.root, env(s.doc, createClock(DL - left)));
  assert.equal(shown(s.part('seconds')), String(left / 1000), 'flip cards grow to fit too');
  const all = page({ flip: false });
  mountCountdown(all.root, env(all.doc, createClock(DL - left)));
  assert.deepEqual(['days', 'hours', 'minutes', 'seconds'].map((u) => all.part(u).textContent), ['02', '05', '12', '30'], 'with days present nothing is folded');
});

test('ticks land on whole-second boundaries of the deadline: every change is exactly one second', () => {
  const { doc, root, part } = page({ flip: false, units: ['seconds'] });
  const clock = createClock(DL - 10300);                 // mounted 300 ms into a second (DL - 10000 exactly is covered below)
  mountCountdown(root, env(doc, clock));
  let last = part('seconds').textContent, changes = 0;
  for (let t = 0; t < 8000; t += 10) {
    clock.advance(10);
    const now = part('seconds').textContent;
    if (now === last) continue;
    changes++;
    assert.equal(Number(last) - Number(now), 1, `skipped or repeated a second: ${last} → ${now}`);
    const into = (DL - clock.now()) % 1000;
    assert.ok(into === 0 || into >= 980, `changed ${1000 - into} ms after the boundary, not on it`);
    last = now;
  }
  assert.equal(changes, 8);
});

test('the final second reads 00 and the countdown expires AT the deadline, not a second early', () => {
  const { doc, root, part } = page({ flip: false, units: ['minutes', 'seconds'] });
  const clock = createClock(DL - 1500);
  mountCountdown(root, env(doc, clock));
  assert.equal(part('seconds').textContent, '01');
  clock.advance(600);                                    // DL - 900
  assert.equal(part('seconds').textContent, '00');
  assert.equal(root.hidden, false, '00:00 is on screen during the final second');
  clock.advance(890);                                    // DL - 10
  assert.equal(root.hidden, false);
  clock.advance(20);                                     // DL + 10
  assert.equal(root.hidden, true);
});

test('data-flip="false" shows text, not cards', () => {
  const { doc, root, part } = page({ units: ['seconds'] });
  part('seconds').setAttribute('data-flip', 'false');
  mountCountdown(root, env(doc, createClock(DL - 7000)));
  assert.equal(part('seconds').textContent, '07');
  assert.equal(cardsOf(part('seconds')).length, 0);
});

test('data-expired="text" with no data-expired-text hides instead of leaving an empty box', () => {
  const { doc, root } = page({ expired: 'text' });
  mountCountdown(root, env(doc, createClock(DL + 1)));
  assert.equal(root.hidden, true);
});

test('mounted exactly on a whole second: the next second follows immediately, none is skipped', () => {
  const { doc, root, part } = page({ flip: false, units: ['seconds'] });
  const clock = createClock(DL - 10000);
  mountCountdown(root, env(doc, clock));
  assert.equal(part('seconds').textContent, '10');
  clock.advance(10);
  assert.equal(part('seconds').textContent, '09');
  clock.advance(995);
  assert.equal(part('seconds').textContent, '08');
});
