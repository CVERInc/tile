// Which event a countdown root counts to, and when — and the root reading it from a feed.
//   run: node --test packages/dynamic-corals/countdown/countdown-feed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventInstant, pickEvent, httpUrl, eventHref, eventText } from './countdown-feed.mjs';
import { mountFromFeed, mountAll, FEED_TIMEOUT_MS } from './countdown-core.mjs';
import { mapsUrl, feedEvents, renderEvents, FEED_MAX } from '../events/events-core.mjs';
import { parseICal } from '../events/ical.mjs';
import { createDocument, createClock } from '../shared/fake-dom.mjs';

const H = 36e5, D = 24 * H;

test('a UTC event is exact, with or without an offset on the root', () => {
  const ev = { start: '2026-12-12T01:00:00.000Z', end: '2026-12-12T09:00:00.000Z' };
  assert.equal(eventInstant(ev, 'start', null), Date.UTC(2026, 11, 12, 1));
  assert.equal(eventInstant(ev, 'start', '+09:00'), Date.UTC(2026, 11, 12, 1), 'the offset is not applied twice');
  assert.equal(eventInstant(ev, 'end', null), Date.UTC(2026, 11, 12, 9));
  assert.equal(eventInstant(ev, undefined, null), Date.UTC(2026, 11, 12, 1), 'start is the default');
  assert.equal(eventInstant(ev, 'nonsense', null), Date.UTC(2026, 11, 12, 1));
});

test('an all-day event needs the root to say where it is', () => {
  const ev = { start: '2026-12-01', end: '2026-12-02', allDay: true };
  assert.ok(Number.isNaN(eventInstant(ev, 'start', null)), 'a bare date is no instant');
  assert.ok(Number.isNaN(eventInstant(ev, 'start', '')));
  assert.ok(Number.isNaN(eventInstant(ev, 'start', '9')), 'a malformed offset is refused, not guessed');
  assert.ok(Number.isNaN(eventInstant(ev, 'start', 'Asia/Tokyo')));
  assert.equal(eventInstant(ev, 'start', '+09:00'), Date.UTC(2026, 10, 30, 15));
  assert.equal(eventInstant(ev, 'start', 'Z'), Date.UTC(2026, 11, 1));
  // the feed's all-day end is exclusive: the end of a one-day deadline is the midnight after it
  assert.equal(eventInstant(ev, 'end', '+09:00'), Date.UTC(2026, 11, 1, 15));
  assert.equal(eventInstant(ev, 'end', '+09:00'), Date.parse('2026-12-01T23:59:59+09:00') + 1000);
});

test('a floating time needs the offset too; an event with no end counts to its start', () => {
  const ev = { start: '2026-12-01T10:00:00', end: null };
  assert.ok(Number.isNaN(eventInstant(ev, 'start', null)));
  assert.equal(eventInstant(ev, 'start', '-05:00'), Date.UTC(2026, 11, 1, 15));
  assert.equal(eventInstant(ev, 'end', '-05:00'), Date.UTC(2026, 11, 1, 15));
});

test('an all-day event that names no end is that one day', () => {
  const ev = { start: '2026-12-01', end: null, allDay: true };
  assert.equal(eventInstant(ev, 'start', '+09:00'), Date.UTC(2026, 10, 30, 15));
  assert.equal(eventInstant(ev, 'end', '+09:00'), Date.UTC(2026, 11, 1, 15), 'the midnight after it, not the one before');
});

test('junk is NaN, never a date that rolled over', () => {
  for (const ev of [null, {}, { start: '' }, { start: 'tomorrow' }, { start: '2026-02-31' }, { start: 20261201 }]) {
    assert.ok(Number.isNaN(eventInstant(ev, 'start', '+09:00')), JSON.stringify(ev));
  }
});

test('pickEvent takes the first event still ahead, and passes over what it cannot place', () => {
  const now = Date.UTC(2026, 10, 18);
  const events = [
    { title: 'past', start: '2026-11-01T00:00:00.000Z' },
    { title: 'all-day', start: '2026-11-20', end: '2026-11-21', allDay: true },
    { title: 'utc', start: '2026-11-25T00:00:00.000Z' },
  ];
  assert.equal(pickEvent(events, now, 'start', null).event.title, 'utc', 'no offset: the all-day one is skipped');
  assert.equal(pickEvent(events, now, 'start', '+09:00').event.title, 'all-day');
  assert.equal(pickEvent(events, now, 'start', '+09:00').deadline, Date.UTC(2026, 10, 19, 15));
  assert.equal(pickEvent(events, Date.UTC(2026, 11, 1), 'start', 'Z'), null);
  // an event under way has no start ahead, but its end still is
  const running = [{ title: 'on now', start: '2026-11-17T00:00:00.000Z', end: '2026-11-19T00:00:00.000Z' }];
  assert.equal(pickEvent(running, now, 'start', null), null);
  assert.equal(pickEvent(running, now, 'end', null).event.title, 'on now');
  for (const bad of [null, undefined, {}, 'x', 3]) assert.equal(pickEvent(bad, now, 'start', null), null);
});

test('pickEvent takes the SOONEST instant, which is not always the first in the feed', () => {
  const now = Date.UTC(2026, 10, 18);
  // The feed sorts by start read as UTC: the timed event (Nov 19 20:00Z) comes before the all-day
  // Nov 20 — which under +09:00 really starts Nov 19 15:00Z, five hours earlier.
  const mixed = [
    { title: 'timed', start: '2026-11-19T20:00:00.000Z' },
    { title: 'all-day', start: '2026-11-20', end: '2026-11-21', allDay: true },
  ];
  assert.equal(pickEvent(mixed, now, 'start', '+09:00').event.title, 'all-day');
  assert.equal(pickEvent(mixed, now, 'start', '-08:00').event.title, 'timed');
  // counting to ENDS: a long event that started first does not end first
  const ends = [
    { title: 'season', start: '2026-11-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' },
    { title: 'sale', start: '2026-11-10T00:00:00.000Z', end: '2026-11-20T00:00:00.000Z' },
  ];
  assert.equal(pickEvent(ends, now, 'end', null).event.title, 'sale');
  const tie = [{ title: 'first', start: '2026-11-20T00:00:00.000Z' }, { title: 'second', start: '2026-11-20T00:00:00.000Z' }];
  assert.equal(pickEvent(tie, now, 'start', null).event.title, 'first');
});

test('only http(s) ever becomes an href', () => {
  assert.equal(httpUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  assert.equal(httpUrl('HTTP://example.com'), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//example.com', 'example.com', 'mailto:a@b.c', '', null, 'https://']) {
    assert.equal(httpUrl(bad), '', String(bad));
  }
});

test('eventHref: a URL in the location is the link; a place is the same map search events gives it', () => {
  assert.equal(eventHref({ location: 'https://example.com/apply' }, 'location'), 'https://example.com/apply');
  const place = 'NTU Sports Center, Taipei';
  assert.equal(eventHref({ location: place }, 'location'), mapsUrl(place), 'a place: the same map link in both corals');
  assert.match(renderEvents([{ title: 'x', start: '2999-01-01T00:00:00.000Z', location: place }], { now: 0 }), new RegExp(mapsUrl(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')), 'and that IS what events renders');
  assert.equal(eventHref({ location: 'javascript:alert(1)' }, 'location'), mapsUrl('javascript:alert(1)'), 'searched for, never followed');
  assert.equal(eventHref({ location: null }, 'location'), '');
  assert.equal(eventHref({ url: 'https://example.com/e' }, 'url'), 'https://example.com/e');
  assert.equal(eventHref({ url: 'javascript:alert(1)' }, 'url'), '');
  assert.equal(eventHref({ url: 'https://example.com/e', location: 'x' }, 'other'), '');
  assert.equal(eventHref(null, 'url'), '');
});

test('eventText: three named fields, trimmed; anything else is empty', () => {
  const ev = { title: ' Cohort 6 ', location: 'Online', description: 'x', url: 'https://example.com', start: '2026-12-01' };
  assert.equal(eventText(ev, 'title'), 'Cohort 6');
  assert.equal(eventText(ev, 'location'), 'Online');
  assert.equal(eventText(ev, 'description'), 'x');
  for (const field of ['url', 'start', '__proto__', 'constructor', '', null]) assert.equal(eventText(ev, field), '', String(field));
  assert.equal(eventText({ title: null }, 'title'), '');
});

test('feedEvents is the calendar as data, in the fields the countdown reads', () => {
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Gone', 'DTSTART:20261101T000000Z', 'DTEND:20261101T010000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Deadline', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261202', 'LOCATION:https://example.com/apply', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Later', 'DTSTART:20261212T010000Z', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const now = Date.UTC(2026, 10, 18);
  const feed = feedEvents(parseICal(ics), { now });
  assert.deepEqual(feed, [
    { title: 'Deadline', start: '2026-12-01', end: '2026-12-02', allDay: true, location: 'https://example.com/apply', description: null, url: null },
    { title: 'Later', start: '2026-12-12T01:00:00.000Z', end: null, allDay: false, location: null, description: null, url: null },
  ]);
  assert.equal(feedEvents(parseICal(ics), { showCount: 1, now }).length, 2, 'the rendered list’s showCount does not narrow the feed');
  // and the countdown side reads exactly that
  const picked = pickEvent(JSON.parse(JSON.stringify(feed)), now, 'end', '+09:00');
  assert.equal(picked.event.title, 'Deadline');
  assert.equal(picked.deadline, Date.UTC(2026, 11, 1, 15));
});

test('feedEvents keeps what a reader in another offset still needs', () => {
  const H = 36e5;
  // Floating 10:00–11:00 on Dec 1. Read as UTC it is over at 11:00Z; at −08:00 it STARTS at 18:00Z.
  const floating = [{ title: 'west', start: '2026-12-01T10:00:00', end: '2026-12-01T11:00:00' }];
  const noon = Date.UTC(2026, 11, 1, 12);
  assert.equal(feedEvents(floating, { now: noon }).length, 1, 'still in the feed after it looks over from here');
  assert.equal(pickEvent(feedEvents(floating, { now: noon }), noon, 'start', '-08:00').deadline, Date.UTC(2026, 11, 1, 18));
  // All-day Dec 1, counted to its end at −08:00 (Dec 2 08:00Z), asked at Dec 2 01:00Z.
  const allDay = [{ title: 'day', start: '2026-12-01', end: '2026-12-02', allDay: true }];
  const late = Date.UTC(2026, 11, 2, 1);
  assert.equal(pickEvent(feedEvents(allDay, { now: late }), late, 'end', '-08:00').deadline, Date.UTC(2026, 11, 2, 8));
  // …and it does leave: two days on, it is gone.
  assert.equal(feedEvents(allDay, { now: late + 48 * H }).length, 0);
  // Events under way do not hide the next start, however many there are.
  const now = Date.UTC(2026, 10, 18);
  const busy = [];
  for (let i = 0; i < 5; i++) busy.push({ title: 'on' + i, uid: 'on' + i, start: '2026-11-17T00:00:00.000Z', end: '2026-11-19T00:00:00.000Z' });
  busy.push({ title: 'next', uid: 'next', start: '2026-11-25T00:00:00.000Z' });
  assert.equal(pickEvent(feedEvents(busy, { now }), now, 'start', null).event.title, 'next');
  const many = Array.from({ length: FEED_MAX + 15 }, (_, i) => ({ title: 'e' + i, uid: 'e' + i, start: new Date(now + (i + 1) * 864e5).toISOString() }));
  assert.equal(feedEvents(many, { now }).length, FEED_MAX, 'capped');
});

test('events: a feed URL that is not http(s) never becomes the title link', () => {
  const start = '2999-01-01T00:00:00.000Z';
  assert.match(renderEvents([{ title: 'ok', start, url: 'https://example.com/e' }], { now: 0 }), /<a class="dc-ev-title" href="https:\/\/example\.com\/e"/);
  for (const url of ['javascript:alert(1)', 'data:text/html,x', ' JaVaScript:alert(1)', '//example.com']) {
    const html = renderEvents([{ title: 'bad', start, url }], { now: 0 });
    assert.equal(html.includes('<a class="dc-ev-title"'), false, url);
    assert.match(html, /<span class="dc-ev-title">bad<\/span>/);
  }
});

// ── the root, with a fake document, clock and fetch ─────────────────────────────────────────────
function page(attrs = {}) {
  const doc = createDocument();
  const root = doc.createElement('div');
  root.setAttribute('data-dynamic-coral', 'countdown');
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  root.hidden = true;
  const add = (tag, a, text) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    root.appendChild(el);
    return el;
  };
  const els = {
    title: add('div', { 'data-event': 'title' }, 'authored title'),
    desc: add('div', { 'data-event': 'description' }, 'authored description'),
    link: add('a', { 'data-event-href': 'location', href: '/authored' }),
    days: add('span', { 'data-part': 'days' }),
    hours: add('span', { 'data-part': 'hours' }),
  };
  doc.body.appendChild(root);
  return { doc, root, els };
}
const feedOf = (body, { ok = true } = {}) => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok, json: async () => body }; };
  return { fetch, calls };
};
const env = (doc, clock, fetch) => ({ document: doc, now: clock.now, reduced: true, fetch,
  setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
const NOW = Date.UTC(2026, 10, 18);
const EVENT = { title: 'Cohort 6', start: '2026-12-01', end: '2026-12-02', allDay: true, location: 'https://example.com/apply', description: null, url: null };

test('a data-src root counts to the feed’s next event and fills the slots it has words for', async () => {
  const { doc, root, els } = page({ 'data-src': 'https://feed.example/v0/?cal=x', 'data-count-to': 'end', 'data-offset': '+09:00' });
  const clock = createClock(NOW);
  const { fetch, calls } = feedOf({ html: '<ul></ul>', events: [EVENT] });
  const mounted = await mountFromFeed(root, env(doc, clock, fetch));
  assert.ok(mounted && mounted.running);
  assert.deepEqual(calls, [{ url: 'https://feed.example/v0/?cal=x', init: { headers: { Accept: 'application/json' } } }], 'one GET, nothing else sent');
  assert.equal(root.hidden, false);
  // 2026-11-18T00:00Z → 2026-12-01T15:00Z = 13 d 15 h
  assert.equal(els.days.textContent, '13');
  assert.equal(els.hours.textContent, '15');
  assert.equal(els.title.textContent, 'Cohort 6');
  assert.equal(els.desc.textContent, 'authored description', 'an empty field leaves its slot as authored');
  assert.equal(els.link.getAttribute('href'), 'https://example.com/apply');
  mounted.stop();
});

test('feed text is written as text: markup in a title stays characters', async () => {
  const { doc, root, els } = page({ 'data-src': '/f', 'data-offset': 'Z' });
  const { fetch } = feedOf({ events: [{ ...EVENT, title: '<img src=x onerror=alert(1)>', location: 'javascript:alert(1)' }] });
  const mounted = await mountFromFeed(root, env(doc, createClock(NOW), fetch));
  assert.equal(els.title.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(els.title.children.length, 0, 'no element was created from it');
  assert.equal(els.link.getAttribute('href'), mapsUrl('javascript:alert(1)'));
  mounted.stop();
});

test('no usable event: falls back to data-deadline, and without one leaves the root as authored', async () => {
  const cases = [
    ['empty feed', feedOf({ events: [] }).fetch],
    ['no events key (an older worker)', feedOf({ html: '<ul></ul>' }).fetch],
    ['non-ok response', feedOf({ events: [EVENT] }, { ok: false }).fetch],
    ['network failure', async () => { throw new Error('offline'); }],
    ['not JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })],
    ['all-day event, no data-offset', feedOf({ events: [EVENT] }).fetch, { 'data-offset': '' }],
    ['every event already over', feedOf({ events: [{ ...EVENT, start: '2026-11-01', end: '2026-11-02' }] }).fetch],
    ['no fetch in this runtime', null],
  ];
  for (const [name, fetch, extra = {}] of cases) {
    const bare = page({ 'data-src': '/f', 'data-offset': '+09:00', ...extra });
    assert.equal(await mountFromFeed(bare.root, env(bare.doc, createClock(NOW), fetch)), null, name);
    assert.equal(bare.root.hidden, true, `${name}: still hidden`);
    assert.equal(bare.els.title.textContent, 'authored title', `${name}: slots untouched`);
    assert.equal(bare.els.link.getAttribute('href'), '/authored', `${name}: link untouched`);
    assert.equal(bare.els.days.textContent, '', `${name}: no digits written`);

    const typed = page({ 'data-src': '/f', 'data-offset': '+09:00', 'data-deadline': '2026-11-20T00:00:00Z', ...extra });
    const mounted = await mountFromFeed(typed.root, env(typed.doc, createClock(NOW), fetch));
    assert.ok(mounted && mounted.running, `${name}: the typed deadline runs`);
    assert.equal(typed.els.days.textContent, '02', name);
    assert.equal(typed.els.title.textContent, 'authored title', `${name}: a fallback fills no slot`);
    mounted.stop();
  }
});

test('a feed that never answers is a feed that failed: the typed deadline gets its turn', async () => {
  const { doc, root, els } = page({ 'data-src': '/f', 'data-offset': 'Z', 'data-deadline': '2026-11-20T00:00:00Z' });
  const clock = createClock(NOW);
  const pending = mountFromFeed(root, env(doc, clock, () => new Promise(() => {})));
  await new Promise((r) => setImmediate(r));
  assert.equal(root.hidden, true, 'still waiting');
  clock.advance(FEED_TIMEOUT_MS - 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(root.hidden, true);
  clock.advance(1);
  const mounted = await pending;
  assert.ok(mounted && mounted.running);
  assert.equal(root.hidden, false);
  assert.equal(els.days.textContent, '01', 'eight seconds later, counting to the typed deadline');
  mounted.stop();
});

test('an answered feed leaves no timeout behind', async () => {
  const { doc, root } = page({ 'data-src': '/f', 'data-offset': 'Z' });
  const clock = createClock(NOW);
  const mounted = await mountFromFeed(root, env(doc, clock, feedOf({ events: [EVENT] }).fetch));
  assert.equal(clock.pending(), 1, 'only the countdown’s own next tick');
  mounted.stop();
  assert.equal(clock.pending(), 0);
});

test('a usable feed wins over a typed data-deadline', async () => {
  const { doc, root, els } = page({ 'data-src': '/f', 'data-offset': 'Z', 'data-deadline': '2026-11-20T00:00:00Z' });
  const mounted = await mountFromFeed(root, env(doc, createClock(NOW), feedOf({ events: [EVENT] }).fetch));
  assert.equal(els.days.textContent, '13');
  mounted.stop();
});

test('mountAll: only a root that carries data-src touches the network', async () => {
  const typed = page({ 'data-deadline': '2026-11-20T00:00:00Z' });
  const a = feedOf({ events: [EVENT] });
  mountAll(typed.doc, env(typed.doc, createClock(NOW), a.fetch));
  await new Promise((r) => setImmediate(r));
  assert.equal(a.calls.length, 0, 'a typed deadline makes no request');
  assert.equal(typed.els.days.textContent, '02');
  assert.equal(typed.els.title.textContent, 'authored title');

  const fed = page({ 'data-src': '/f', 'data-offset': 'Z' });
  const b = feedOf({ events: [EVENT] });
  mountAll(fed.doc, env(fed.doc, createClock(NOW), b.fetch));
  mountAll(fed.doc, env(fed.doc, createClock(NOW), b.fetch));
  await new Promise((r) => setImmediate(r));
  assert.equal(b.calls.length, 1, 'mounted once, fetched once');
  assert.equal(fed.els.days.textContent, '13');
});
