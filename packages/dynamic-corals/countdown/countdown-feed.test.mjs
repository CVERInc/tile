// Which events a countdown root shows, in what order, what each counts to — and the root doing it.
//   run: node --test packages/dynamic-corals/countdown/countdown-feed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { upcoming, nextMoment, phaseOf, httpUrl, locationKind, locationText, eventHref, eventText, whenText, unitText } from './countdown-feed.mjs';
import { mountFromFeed, mountAll, FEED_TIMEOUT_MS } from './countdown-core.mjs';
import { feedEvents, eventInstants, plainText, renderEvents, addToCalendarUrl, FEED_MAX } from '../events/events-core.mjs';
import { parseICal, parseICalCalendar } from '../events/ical.mjs';
import { mapsUrl, mapHref, mapPlatform } from '../shared/map-link.mjs';
import { createDocument, createClock } from '../shared/fake-dom.mjs';

const H = 36e5, D = 24 * H;
const NOW = Date.UTC(2026, 10, 18);
const iso = (t) => new Date(t).toISOString();
const ev = (title, startsAt, endsAt, more = {}) => ({ uid: title, title, start: iso(startsAt), end: iso(endsAt), allDay: false,
  startsAt: iso(startsAt), endsAt: iso(endsAt), location: null, description: null, url: null, ...more });

// ── the feed side: a calendar's own zone decides when its bare dates are ────────────────────────
const ICS = ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Studio events', 'X-WR-TIMEZONE:Asia/Tokyo', 'X-WR-CALDESC:Classes\\, streams',
  'BEGIN:VEVENT', 'UID:gone', 'SUMMARY:Gone', 'DTSTART:20261101T000000Z', 'DTEND:20261101T010000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:open', 'SUMMARY:Applications open', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261202',
  'LOCATION:https://example.com/apply', 'DESCRIPTION:<b>Closes</b> when full<br>Ask us &amp; see', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:talk', 'SUMMARY:Talk', 'DTSTART;TZID=America/Los_Angeles:20261125T100000', 'DTEND;TZID=America/Los_Angeles:20261125T110000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:off', 'SUMMARY:Called off', 'STATUS:CANCELLED', 'DTSTART:20261126T000000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:', 'DTSTART;VALUE=DATE:20261220', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');

test('the calendar says what it is called and where it lives', () => {
  assert.deepEqual(parseICalCalendar(ICS), { name: 'Studio events', timeZone: 'Asia/Tokyo', description: 'Classes, streams' });
  assert.deepEqual(parseICalCalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nX-WR-CALNAME:not the calendar\r\nEND:VEVENT'), { name: null, timeZone: null, description: null });
});

test('eventInstants: a bare date is the calendar zone’s midnight; a zoned time is its own zone’s', () => {
  const [, open, talk] = parseICal(ICS);
  assert.deepEqual(eventInstants(open, 'Asia/Tokyo'), { startsAt: Date.UTC(2026, 9, 11, 15), endsAt: Date.UTC(2026, 11, 1, 15) });
  assert.equal(eventInstants(open, 'Asia/Tokyo').endsAt, Date.parse('2026-12-01T23:59:59+09:00') + 1000, 'the end of Dec 1 in Tokyo');
  assert.deepEqual(eventInstants(open, 'America/Los_Angeles'), { startsAt: Date.UTC(2026, 9, 12, 7), endsAt: Date.UTC(2026, 11, 2, 8) }, 'PDT at one end, PST at the other');
  // 10:00 in Los Angeles in November is 18:00Z, whatever zone the calendar is in
  assert.deepEqual(eventInstants(talk, 'Asia/Tokyo'), { startsAt: Date.UTC(2026, 10, 25, 18), endsAt: Date.UTC(2026, 10, 25, 19) });
  // no zone anywhere: no instant, never a guess
  const bare = eventInstants(open, null);
  assert.ok(Number.isNaN(bare.startsAt) && Number.isNaN(bare.endsAt));
  // an unknown TZID falls back to the calendar's zone
  assert.equal(eventInstants({ start: '2026-11-25T10:00:00', startZone: 'Mars/Olympus' }, 'Asia/Tokyo').startsAt, Date.UTC(2026, 10, 25, 1));
  // UTC is UTC; a timed event with no end gets the hour this core assumes; an all-day one with no end is that day
  assert.deepEqual(eventInstants({ start: '2026-11-25T10:00:00.000Z' }, 'Asia/Tokyo'), { startsAt: Date.UTC(2026, 10, 25, 10), endsAt: Date.UTC(2026, 10, 25, 11) });
  assert.deepEqual(eventInstants({ start: '2026-12-20', allDay: true }, 'Asia/Tokyo'), { startsAt: Date.UTC(2026, 11, 19, 15), endsAt: Date.UTC(2026, 11, 20, 15) });
});

test('plainText: a formatted description is its words', () => {
  assert.equal(plainText('<b>Closes</b> when full<br>Ask us &amp; see'), 'Closes when full\nAsk us & see');
  assert.equal(plainText('<p>One</p><p>Two</p><ul><li>a</li><li>b</li></ul>'), 'One\nTwo\na\nb');
  assert.equal(plainText('a &lt;b&gt; c &quot;d&quot; &#39;e&#39;&nbsp;f'), 'a <b> c "d" \'e\' f');
  assert.equal(plainText('  plain   text \n\n\n next '), 'plain text\nnext');
  assert.equal(plainText('<script>alert(1)</script>x'), 'alert(1)x', 'still text: whoever shows it writes it as text');
  assert.equal(plainText(null), '');
});

test('feedEvents: what is still to come, with instants; cancelled is not offered; an untitled event is', () => {
  const feed = feedEvents(parseICal(ICS), { now: NOW, timeZone: 'Asia/Tokyo' });
  assert.deepEqual(feed.map((e) => e.title), ['Applications open', 'Talk', '']);
  assert.deepEqual(feed[0], { uid: 'open', title: 'Applications open', start: '2026-10-12', end: '2026-12-02', allDay: true,
    startsAt: '2026-10-11T15:00:00.000Z', endsAt: '2026-12-01T15:00:00.000Z', location: 'https://example.com/apply',
    description: 'Closes when full\nAsk us & see', url: null });
  // it leaves at its real end, not where a UTC reading of the date would put it
  const tokyoLastHour = Date.UTC(2026, 11, 1, 14);          // Dec 1 23:00 in Tokyo; the event ends at 15:00Z
  assert.equal(feedEvents(parseICal(ICS), { now: tokyoLastHour, timeZone: 'Asia/Tokyo' })[0].title, 'Applications open');
  assert.equal(feedEvents(parseICal(ICS), { now: tokyoLastHour + H, timeZone: 'Asia/Tokyo' }).some((e) => e.uid === 'open'), false);
  // without a zone the instants are null, and the event stays a day past where it looks over
  const zoneless = feedEvents(parseICal(ICS), { now: NOW });
  assert.equal(zoneless[0].startsAt, null);
  assert.equal(zoneless[0].endsAt, null);
  const many = Array.from({ length: FEED_MAX + 15 }, (_, i) => ({ title: 'e' + i, uid: 'e' + i, start: iso(NOW + (i + 1) * D) }));
  assert.equal(feedEvents(many, { now: NOW }).length, FEED_MAX);
});

// ── the reader's side ──────────────────────────────────────────────────────────────────────────
test('what’s next: each event by the moment it counts to, soonest first', () => {
  const feed = { events: [
    ev('season', NOW - 30 * D, NOW + 13 * D),      // under way, ends in 13 d
    ev('workshop', NOW + 7 * D, NOW + 7 * D + 2 * H), // starts in 7 d
    ev('over', NOW - 2 * D, NOW - D),
    ev('ends first', NOW - D, NOW + 2 * D),        // under way, ends in 2 d
    ev('far', NOW + 75 * D, NOW + 120 * D),
    { title: 'no instants', startsAt: null, endsAt: null }, null, 'junk',
  ] };
  const items = upcoming(feed, NOW);
  assert.deepEqual(items.map((i) => i.event.title), ['ends first', 'workshop', 'season', 'far']);
  assert.deepEqual(items.map((i) => phaseOf(i, NOW)), ['during', 'before', 'during', 'before']);
  assert.equal(nextMoment(items[0], NOW), NOW + 2 * D);
  assert.equal(nextMoment(items[1], NOW), NOW + 7 * D);
  // a week later the workshop has started: it now counts to its end, and the order follows
  const later = NOW + 7 * D + H;
  assert.deepEqual(upcoming(feed, later).map((i) => i.event.title), ['workshop', 'season', 'far']);
  assert.equal(phaseOf(upcoming(feed, later)[0], later), 'during');
  const tie = { events: [ev('first', NOW + D, NOW + 2 * D), ev('second', NOW + D, NOW + 3 * D)] };
  assert.deepEqual(upcoming(tie, NOW).map((i) => i.event.title), ['first', 'second']);
  for (const bad of [null, undefined, {}, { events: 'x' }, 3]) assert.deepEqual(upcoming(bad, NOW), []);
});

test('only http(s) ever becomes an href', () => {
  assert.equal(httpUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//example.com', 'example.com', 'mailto:a@b.c', '', null, 'https://']) {
    assert.equal(httpUrl(bad), '', String(bad));
  }
});

test('location: a URL is a link and shown without its scheme; anything else is a place and a map', () => {
  const url = { location: ' https://www.example.com/apply/ ' }, place = { location: 'NTU Sports Center, Taipei' };
  assert.deepEqual([locationKind(url), locationKind(place), locationKind({ location: '' }), locationKind({}), locationKind(null)], ['url', 'place', 'none', 'none', 'none']);
  assert.equal(locationKind({ location: 'Zoom https://example.com/j/1' }), 'place', 'only a WHOLE-field URL is a URL');
  assert.equal(locationText(url), 'example.com/apply');
  assert.equal(locationText({ location: 'http://example.com' }), 'example.com');
  assert.equal(locationText(place), 'NTU Sports Center, Taipei');
  assert.equal(eventHref(url, 'location', ''), 'https://www.example.com/apply/');
  assert.equal(eventHref(place, 'location', ''), mapsUrl('NTU Sports Center, Taipei'));
  assert.equal(eventHref(place, 'location', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'https://maps.apple.com/?q=NTU%20Sports%20Center%2C%20Taipei');
  assert.equal(eventHref(place, 'location', 'Mozilla/5.0 (Linux; Android 15)'), 'geo:0,0?q=NTU%20Sports%20Center%2C%20Taipei');
  assert.equal(eventHref({ location: 'javascript:alert(1)' }, 'location', ''), mapsUrl('javascript:alert(1)'), 'searched for, never followed');
  assert.equal(eventHref({ location: null }, 'location', ''), '');
  assert.equal(eventHref({ url: 'https://example.com/e' }, 'url'), 'https://example.com/e');
  assert.equal(eventHref({ url: 'javascript:alert(1)' }, 'url'), '');
  assert.equal(eventHref(url, 'other'), '');
  assert.equal(eventHref(null, 'location'), '');
  // one map link per place, in both corals
  assert.equal(mapHref('x', ''), mapsUrl('x'));
  assert.deepEqual(['', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mozilla/5.0 (Linux; Android 15; Pixel)'].map(mapPlatform), ['other', 'apple', 'android']);
  assert.match(renderEvents([{ title: 'x', start: '2999-01-01T00:00:00.000Z', location: 'A & B' }], { now: 0 }), /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=A%20%26%20B"/);
});

test('add to calendar is the events coral’s link for the same event', () => {
  const event = { title: 'Open', start: '2026-10-12', end: '2026-12-02', allDay: true, location: 'https://example.com/apply' };
  assert.equal(eventHref(event, 'add'), addToCalendarUrl(event));
  assert.match(eventHref(event, 'add'), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Open&dates=20261012%2F20261202/);
});

test('add to calendar states a timed event’s exact instants, whoever’s device builds the link', () => {
  // 10:00 in Los Angeles: the feed keeps the wall clock in start/end and gives the instants beside it.
  const zoned = { title: 'Talk', allDay: false, start: '2026-11-25T10:00:00', end: '2026-11-25T11:00:00', startsAt: '2026-11-25T18:00:00.000Z', endsAt: '2026-11-25T19:00:00.000Z' };
  assert.match(eventHref(zoned, 'add'), /dates=20261125T180000Z%2F20261125T190000Z/, 'never the wall clock read in this machine’s zone');
  assert.match(eventHref({ ...zoned, endsAt: null }, 'add'), /dates=20261125T180000Z%2F20261125T180000Z/);
  // no instants (an older feed): the events coral's own reading, unchanged
  const old = { title: 'Talk', allDay: false, start: '2026-11-25T18:00:00.000Z', end: null };
  assert.equal(eventHref(old, 'add'), addToCalendarUrl(old));
});

test('whenText and unitText are the runtime’s words, in the page’s language', () => {
  const allDay = { allDay: true, start: '2026-10-12', end: '2026-12-02' };
  assert.equal(whenText(allDay, 'en'), new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).formatRange(new Date(Date.UTC(2026, 9, 12)), new Date(Date.UTC(2026, 11, 1))));
  assert.match(whenText(allDay, 'en'), /Oct 12.*Dec 1$/, 'the last day is the one before the exclusive end');
  assert.match(whenText({ allDay: true, start: '2026-12-01', end: '2026-12-02' }, 'en'), /^Dec 1$/, 'one day is one date, not a range');
  assert.match(whenText({ allDay: true, start: '2026-12-01', end: null }, 'en'), /^Dec 1$/);
  assert.notEqual(whenText(allDay, 'ja'), whenText(allDay, 'en'));
  const timed = { allDay: false, startsAt: '2026-11-25T05:00:00.000Z', endsAt: '2026-11-25T07:00:00.000Z' };
  assert.match(whenText(timed, 'en'), /Nov 2[45]/);
  const zoneName = new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(new Date(Date.parse(timed.startsAt))).find((p) => p.type === 'timeZoneName').value;
  assert.ok(whenText(timed, 'en').includes(zoneName), `a time on the reader’s clock names its zone (${zoneName})`);
  assert.notEqual(whenText(timed, 'en'), new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).formatRange(new Date(Date.parse(timed.startsAt)), new Date(Date.parse(timed.endsAt))), 'and is not the same text without it');
  assert.equal(whenText({ allDay: false, startsAt: null }, 'en'), '');
  assert.equal(whenText(null, 'en'), '');
  assert.equal(whenText(allDay, 'not a locale!!'), '', 'a locale Intl refuses gives nothing rather than throwing');
  assert.deepEqual(['days', 'hours', 'minutes', 'seconds'].map((u) => unitText(u, 'en')), ['days', 'hr', 'min', 'sec']);
  assert.equal(unitText('days', 'ja'), '日');
  assert.equal(unitText('weeks', 'en'), '');
  assert.equal(unitText('days', 'not a locale!!'), '');
});

test('eventText: the slot’s words, or nothing', () => {
  const event = { title: ' Open ', location: 'https://www.example.com/x/', description: 'full', allDay: true, start: '2026-12-01', end: '2026-12-02' };
  const ctx = { calendar: { name: ' Studio events ' }, locale: 'en', index: 1, count: 4 };
  assert.equal(eventText(event, 'title', ctx), 'Open');
  assert.equal(eventText(event, 'location', ctx), 'example.com/x');
  assert.equal(eventText(event, 'description', ctx), 'full');
  assert.equal(eventText(event, 'when', ctx), 'Dec 1');
  assert.equal(eventText(event, 'calendar', ctx), 'Studio events');
  assert.equal(eventText(event, 'position', ctx), '2/4');
  assert.equal(eventText(event, 'position', { index: 0, count: 1 }), '', 'one event has no position');
  assert.equal(eventText(event, 'calendar', {}), '');
  for (const field of ['url', 'start', '__proto__', 'constructor', '', null]) assert.equal(eventText(event, field, ctx), '', String(field));
  assert.equal(eventText({ title: null }, 'title', ctx), '');
});

// ── the root, with a fake document, clock and fetch ─────────────────────────────────────────────
function page(attrs = {}) {
  const doc = createDocument();
  doc.documentElement.setAttribute('lang', 'en');
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
    calendar: add('span', { 'data-event': 'calendar' }, 'authored calendar'),
    when: add('a', { 'data-event': 'when', 'data-event-href': 'add' }, 'authored when'),
    title: add('a', { 'data-event': 'title', 'data-event-href': 'location', href: '/authored' }, 'authored title'),
    locLine: add('a', { 'data-event-if': 'location', 'data-event-href': 'location' }),
    loc: add('span', { 'data-event': 'location' }, 'authored location'),
    descLine: add('div', { 'data-event-if': 'description' }),
    desc: add('span', { 'data-event': 'description' }, 'authored description'),
    pager: add('div', { 'data-event-if': 'several' }),
    prev: add('button', { 'data-event-nav': 'prev' }),
    pos: add('span', { 'data-event': 'position' }, 'authored position'),
    next: add('button', { 'data-event-nav': 'next' }),
    days: add('span', { 'data-part': 'days' }),
    hours: add('span', { 'data-part': 'hours' }),
    unit: add('span', { 'data-unit': 'days' }, 'd'),
  };
  doc.body.appendChild(root);
  return { doc, root, els };
}
const feedOf = (body, { ok = true } = {}) => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok, json: async () => body }; };
  return { fetch, calls };
};
const env = (doc, clock, fetch) => ({ document: doc, now: clock.now, reduced: true, fetch, userAgent: '', language: 'en', ResizeObserver: null,
  setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
const flush = () => new Promise((r) => setImmediate(r));
const SEASON = ev('Applications open', NOW - 30 * D, NOW + 13 * D + 6 * H, { allDay: true, start: '2026-10-12', end: '2026-12-02', location: 'https://www.example.com/apply', description: 'Closes when full' });
const WORKSHOP = ev('Workshop', NOW + 7 * D, NOW + 7 * D + 2 * H, { location: 'Harbor Hall, Pier 3' });
const HOLIDAY = ev('Closed for the holidays', NOW + 40 * D, NOW + 47 * D);
const FEED = { calendar: { name: 'Studio events', timeZone: 'Asia/Tokyo', description: null }, events: [SEASON, WORKSHOP, HOLIDAY] };

test('a data-src root shows what’s next and writes the calendar into the markup', async () => {
  const { doc, root, els } = page({ 'data-src': 'https://feed.example/v0/?cal=x' });
  const clock = createClock(NOW);
  const { fetch, calls } = feedOf(FEED);
  const c = await mountFromFeed(root, env(doc, clock, fetch));
  assert.deepEqual(calls, [{ url: 'https://feed.example/v0/?cal=x', init: { headers: { Accept: 'application/json' } } }], 'one GET, nothing else sent');
  assert.ok(c.running);
  assert.equal(c.count, 3);
  assert.equal(c.index, 0);
  assert.equal(root.hidden, false);
  // the workshop starts in 7 d — sooner than the season ends (13 d)
  assert.equal(els.title.textContent, 'Workshop');
  assert.equal(root.getAttribute('data-event-state'), 'before');
  assert.equal(els.days.textContent, '07');
  assert.equal(els.calendar.textContent, 'Studio events');
  assert.equal(els.loc.textContent, 'Harbor Hall, Pier 3');
  assert.equal(els.title.getAttribute('href'), mapsUrl('Harbor Hall, Pier 3'));
  assert.equal(els.locLine.getAttribute('href'), mapsUrl('Harbor Hall, Pier 3'));
  assert.equal(els.locLine.hidden, false);
  assert.equal(root.getAttribute('data-event-location'), 'place');
  assert.equal(els.desc.textContent, '', 'no description: the slot is emptied, not left as authored');
  assert.equal(els.descLine.hidden, true);
  assert.equal(els.when.getAttribute('href'), addToCalendarUrl(WORKSHOP));
  assert.notEqual(els.when.textContent, 'authored when');
  assert.equal(els.pos.textContent, '1/3');
  assert.equal(els.pager.hidden, false);
  assert.deepEqual([els.prev.disabled, els.next.disabled], [true, false]);
  assert.equal(root.getAttribute('data-event-index'), '1');
  assert.equal(root.getAttribute('data-event-count'), '3');
  assert.equal(els.unit.textContent, 'days', 'the unit word is Intl’s, in the page’s language');
  assert.equal(root.getAttribute('data-under-a-day'), null);
  c.stop();
});

test('paging: next and prev move through the events, stop at the ends, and never wrap', async () => {
  const { doc, root, els } = page({ 'data-src': '/f' });
  const clock = createClock(NOW);
  const c = await mountFromFeed(root, env(doc, clock, feedOf(FEED).fetch));
  els.prev.click();
  assert.equal(c.index, 0, 'prev at the first does nothing');
  els.next.click();
  assert.equal(c.index, 1);
  assert.equal(els.title.textContent, 'Applications open');
  assert.equal(root.getAttribute('data-event-state'), 'during');
  assert.equal(els.days.textContent, '13');
  assert.equal(els.hours.textContent, '06');
  assert.equal(els.title.getAttribute('href'), 'https://www.example.com/apply');
  assert.equal(els.loc.textContent, 'example.com/apply');
  assert.equal(root.getAttribute('data-event-location'), 'url');
  assert.equal(els.desc.textContent, 'Closes when full');
  assert.equal(els.descLine.hidden, false);
  assert.equal(els.pos.textContent, '2/3');
  assert.deepEqual([els.prev.disabled, els.next.disabled], [false, false]);
  c.next();
  assert.equal(els.title.textContent, 'Closed for the holidays');
  assert.equal(els.title.getAttribute('href'), null, 'no location: the title is not a link');
  assert.equal(els.locLine.getAttribute('href'), null);
  assert.equal(els.locLine.hidden, true);
  assert.equal(root.getAttribute('data-event-location'), 'none');
  assert.deepEqual([els.prev.disabled, els.next.disabled], [false, true]);
  c.next();
  assert.equal(c.index, 2, 'next at the last does nothing');
  c.prev(); c.prev();
  assert.equal(els.title.textContent, 'Workshop');
  assert.equal(clock.pending(), 1, 'paging leaves exactly one tick scheduled, not one per page turn');
  c.stop();
  assert.equal(clock.pending(), 0);
  c.next();
  assert.equal(els.title.textContent, 'Workshop', 'a stopped root does not page');
});

test('paging onto an event that has ended meanwhile: it is let go, and no timer is orphaned', async () => {
  // Only the event being viewed has a timer. A ends while the visitor is looking at B.
  const a = ev('A', NOW + 10e3, NOW + 20e3), b = ev('B', NOW + 100e3, NOW + 200e3), c3 = ev('C', NOW + 300e3, NOW + 400e3);
  const { doc, root, els } = page({ 'data-src': '/f' });
  const clock = createClock(NOW);
  const c = await mountFromFeed(root, env(doc, clock, feedOf({ events: [a, b, c3] }).fetch));
  c.next();
  assert.equal(els.title.textContent, 'B');
  clock.advance(30e3);                      // A is over; B's timer has been ticking
  assert.equal(c.count, 3, 'not yet noticed: nothing has asked');
  els.prev.click();
  assert.equal(els.title.textContent, 'B', 'there is nothing before B any more');
  assert.equal(c.count, 2);
  assert.equal(els.pos.textContent, '1/2');
  assert.deepEqual([els.prev.disabled, els.next.disabled], [true, false]);
  assert.ok(c.running);
  assert.equal(clock.pending(), 1, 'one countdown, one timer');
  c.next();
  assert.equal(els.title.textContent, 'C');
  assert.equal(clock.pending(), 1);
  c.stop();
  assert.equal(clock.pending(), 0, 'stop() reaches the only timer there is');
  const seconds = els.hours.textContent;
  clock.advance(5e3);
  assert.equal(els.hours.textContent, seconds, 'and nothing writes after it');

  // the event being viewed is the one that ended unwatched? It cannot: it has the timer. But the
  // LAST other event can end, leaving one.
  const p2 = page({ 'data-src': '/f' });
  const clock2 = createClock(NOW);
  const c2 = await mountFromFeed(p2.root, env(p2.doc, clock2, feedOf({ events: [a, b] }).fetch));
  c2.next();
  clock2.advance(30e3);
  c2.prev();
  assert.equal(c2.count, 1);
  assert.equal(p2.els.pager.hidden, true, 'a single event has no pager');
  assert.equal(clock2.pending(), 1);
  c2.stop();
});

test('one event: no pager, no position', async () => {
  const { doc, root, els } = page({ 'data-src': '/f' });
  const c = await mountFromFeed(root, env(doc, createClock(NOW), feedOf({ events: [SEASON] }).fetch));
  assert.equal(c.count, 1);
  assert.equal(els.pager.hidden, true);
  assert.equal(els.pos.textContent, '');
  assert.deepEqual([els.prev.disabled, els.next.disabled], [true, true]);
  assert.equal(els.calendar.textContent, '', 'a feed with no calendar block names none');
  c.stop();
});

test('at zero nothing reloads: a start becomes a count to the end, an end gives way to the next', async () => {
  const soon = ev('Stream', NOW + 10e3, NOW + 30e3);
  const after = ev('After', NOW + 60e3, NOW + 90e3);
  const { doc, root, els } = page({ 'data-src': '/f' });
  const clock = createClock(NOW);
  const c = await mountFromFeed(root, env(doc, clock, feedOf({ events: [soon, after] }).fetch));
  assert.equal(els.title.textContent, 'Stream');
  assert.equal(root.getAttribute('data-event-state'), 'before');
  assert.equal(root.getAttribute('data-under-a-day'), '');
  clock.advance(10e3 + 10);
  assert.equal(els.title.textContent, 'Stream', 'still the same event');
  assert.equal(root.getAttribute('data-event-state'), 'during', 'now counting to its end');
  assert.equal(c.count, 2);
  assert.equal(root.hidden, false);
  clock.advance(20e3 + 10);
  assert.equal(els.title.textContent, 'After', 'it ended: the next one');
  assert.equal(root.getAttribute('data-event-state'), 'before');
  assert.equal(c.count, 1);
  assert.equal(els.pager.hidden, true);
  clock.advance(30e3 + 10);
  assert.equal(root.getAttribute('data-event-state'), 'during');
  clock.advance(30e3 + 10);
  assert.equal(root.hidden, true, 'nothing left: the root expires as a typed deadline does');
  assert.equal(c.running, false);
  assert.equal(clock.pending(), 0);
});

test('at zero the visitor keeps the event they were looking at, even when the order changed under it', async () => {
  // A starts in 10 s and runs a year; B starts in 20 s. While A is ahead it is first. Once A starts
  // it counts to its far end, so B (20 s) is now what's next — but the visitor was looking at A.
  const a = ev('A', NOW + 10e3, NOW + 365 * D), b = ev('B', NOW + 20e3, NOW + 2 * D);
  const { doc, root, els } = page({ 'data-src': '/f' });
  const clock = createClock(NOW);
  const c = await mountFromFeed(root, env(doc, clock, feedOf({ events: [a, b] }).fetch));
  assert.deepEqual([els.title.textContent, c.index], ['A', 0]);
  clock.advance(10e3 + 10);
  assert.equal(els.title.textContent, 'A', 'still A');
  assert.equal(c.index, 1, 'which is now second');
  assert.equal(els.pos.textContent, '2/2');
  assert.deepEqual([els.prev.disabled, els.next.disabled], [false, true]);
  c.prev();
  assert.equal(els.title.textContent, 'B');
  c.stop();
});

test('feed text is written as text, and only http(s) or a map becomes a link', async () => {
  const evil = ev('<img src=x onerror=alert(1)>', NOW + D, NOW + 2 * D, { location: 'javascript:alert(1)', description: '<script>x</script>' });
  const { doc, root, els } = page({ 'data-src': '/f' });
  const c = await mountFromFeed(root, env(doc, createClock(NOW), feedOf({ calendar: { name: '<b>cal</b>' }, events: [evil] }).fetch));
  assert.equal(els.title.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(els.title.children.length, 0, 'no element was created from it');
  assert.equal(els.calendar.textContent, '<b>cal</b>');
  assert.equal(els.calendar.children.length, 0);
  assert.equal(els.desc.textContent, '<script>x</script>');
  assert.equal(els.title.getAttribute('href'), mapsUrl('javascript:alert(1)'));
  c.stop();
});

test('no event to show: falls back to data-deadline, and without one leaves the root as authored', async () => {
  const cases = [
    ['empty feed', feedOf({ events: [] }).fetch],
    ['no events key', feedOf({ html: '<ul></ul>' }).fetch],
    ['events without instants (an older worker)', feedOf({ events: [{ title: 'x', start: '2026-12-01', end: '2026-12-02', allDay: true }] }).fetch],
    ['non-ok response', feedOf(FEED, { ok: false }).fetch],
    ['network failure', async () => { throw new Error('offline'); }],
    ['not JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })],
    ['every event already over', feedOf({ events: [ev('old', NOW - 2 * D, NOW - D)] }).fetch],
    ['no fetch in this runtime', null],
  ];
  for (const [name, fetch] of cases) {
    const bare = page({ 'data-src': '/f' });
    assert.equal(await mountFromFeed(bare.root, env(bare.doc, createClock(NOW), fetch)), null, name);
    assert.equal(bare.root.hidden, true, `${name}: still hidden`);
    assert.equal(bare.els.title.textContent, 'authored title', `${name}: slots untouched`);
    assert.equal(bare.els.title.getAttribute('href'), '/authored', `${name}: link untouched`);
    assert.equal(bare.els.days.textContent, '', `${name}: no digits written`);
    assert.equal(bare.root.getAttribute('data-event-count'), null, name);

    const typed = page({ 'data-src': '/f', 'data-deadline': '2026-11-20T00:00:00Z' });
    const mounted = await mountFromFeed(typed.root, env(typed.doc, createClock(NOW), fetch));
    assert.ok(mounted && mounted.running, `${name}: the typed deadline runs`);
    assert.equal(typed.els.days.textContent, '02', name);
    assert.equal(typed.els.title.textContent, 'authored title', `${name}: a fallback fills no slot`);
    mounted.stop();
  }
});

test('a feed that never answers is a feed that failed: the typed deadline gets its turn', async () => {
  const { doc, root, els } = page({ 'data-src': '/f', 'data-deadline': '2026-11-20T00:00:00Z' });
  const clock = createClock(NOW);
  const pending = mountFromFeed(root, env(doc, clock, () => new Promise(() => {})));
  await flush();
  clock.advance(FEED_TIMEOUT_MS - 1);
  await flush();
  assert.equal(root.hidden, true, 'still waiting');
  clock.advance(1);
  const mounted = await pending;
  assert.ok(mounted && mounted.running);
  assert.equal(els.days.textContent, '01', 'eight seconds later, counting to the typed deadline');
  mounted.stop();
});

test('data-event-fit: the element is as tall as the tallest event needs, and paging does not change it', async () => {
  const { doc, root, els } = page({ 'data-src': '/f', 'data-event-fit': '' });
  // a stand-in for layout: the box is taller the more it has to say
  let width = 352;
  root.getBoundingClientRect = () => ({ width, height: 200 + (els.descLine.hidden ? 0 : 24) + (els.locLine.hidden ? 0 : 20) + (width < 300 ? 40 : 0) });
  let resized = null;
  const e = { ...env(doc, createClock(NOW), feedOf(FEED).fetch), ResizeObserver: class { constructor(fn) { resized = fn; } observe() {} disconnect() { resized = null; } } };
  const c = await mountFromFeed(root, e);
  assert.equal(root.style.minHeight, '244px', 'the season (a location line and a description) is the tallest');
  assert.equal(els.title.textContent, 'Workshop', 'measuring leaves the current event showing');
  c.next(); c.next();
  assert.equal(root.style.minHeight, '244px');
  width = 280; resized();
  assert.equal(root.style.minHeight, '284px', 'a new width is measured again');
  assert.equal(els.title.textContent, 'Closed for the holidays');
  resized();
  assert.equal(root.style.minHeight, '284px');
  c.stop();
  assert.equal(resized, null, 'stop() lets go of the observer');

  // the host's own min-height is a floor, never erased; and measuring never disables a control
  const own = page({ 'data-src': '/f', 'data-event-fit': '' });
  own.root.style.minHeight = '20rem';
  own.root.getBoundingClientRect = () => ({ width: 352, height: 0 });
  const c3 = await mountFromFeed(own.root, env(own.doc, createClock(NOW), feedOf({ events: [SEASON] }).fetch));
  assert.equal(own.root.style.minHeight, '20rem', 'one event: the host’s value stands');
  c3.stop();
  const nav = page({ 'data-src': '/f', 'data-event-fit': '' });
  let sawNextDisabled = false;
  nav.root.getBoundingClientRect = () => { if (nav.els.next.disabled) sawNextDisabled = true; return { width: 352, height: 240 }; };
  const c4 = await mountFromFeed(nav.root, env(nav.doc, createClock(NOW), feedOf(FEED).fetch));
  assert.equal(sawNextDisabled, false, 'laying out the last event to measure it does not disable Next');
  c4.stop();

  // with no box yet (a closed panel) nothing is set; one event needs no reserving
  const closed = page({ 'data-src': '/f', 'data-event-fit': '' });
  closed.root.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const c2 = await mountFromFeed(closed.root, env(closed.doc, createClock(NOW), feedOf(FEED).fetch));
  assert.equal(closed.root.style.minHeight, undefined);
  c2.stop();
});

test('mountAll: only a root that carries data-src touches the network', async () => {
  const typed = page({ 'data-deadline': '2026-11-20T00:00:00Z' });
  const a = feedOf(FEED);
  mountAll(typed.doc, env(typed.doc, createClock(NOW), a.fetch));
  await flush();
  assert.equal(a.calls.length, 0, 'a typed deadline makes no request');
  assert.equal(typed.els.days.textContent, '02');
  assert.equal(typed.els.title.textContent, 'authored title');
  assert.equal(typed.els.unit.textContent, 'd', 'and nothing but its digits is written');

  const fed = page({ 'data-src': '/f' });
  const b = feedOf(FEED);
  mountAll(fed.doc, env(fed.doc, createClock(NOW), b.fetch));
  mountAll(fed.doc, env(fed.doc, createClock(NOW), b.fetch));
  await flush();
  assert.equal(b.calls.length, 1, 'mounted once, fetched once');
  assert.equal(fed.els.title.textContent, 'Workshop');
});
