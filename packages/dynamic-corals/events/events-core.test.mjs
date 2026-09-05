// REEF with Events — model tests (plain node, zero framework).
//   run: node --test packages/dynamic-corals/events/events-core.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
// (2026-07-16, same day it was written: the differential test that lifted `countdown()` out of
// events.js and compared it against countdownText is GONE, deliberately — events.js is now BUILT
// from events-client.mjs, which imports countdownText itself. The drift the test guarded against
// is structurally impossible; a test of source-level mirroring would only re-verify the bundler.)
import { parseICal, parseICalDate } from './ical.mjs';
import { mergeEvents, upcomingEvents, countdownText, addToCalendarUrl, renderEvents, formatWhen } from './events-core.mjs';


const H = 36e5, D = 24 * H;
const NOW = Date.parse('2026-08-01T12:00:00.000Z');

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:con-1@northwind',
  'SUMMARY:Comic Con — Northwind booth',
  'DTSTART:20260815T100000Z',
  'DTEND:20260815T180000Z',
  'LOCATION:Taipei World Trade Center\\, Hall 1',   // escaped comma
  'URL:https://example.com/con',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1@northwind',
  'SUMMARY:Free comic day',
  'DTSTART;VALUE=DATE:20260901',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICalDate: date-only / UTC / floating', () => {
  assert.deepEqual(parseICalDate('20260815'), { iso: '2026-08-15', allDay: true });
  assert.deepEqual(parseICalDate('20260815T100000Z'), { iso: '2026-08-15T10:00:00.000Z', allDay: false });
  assert.deepEqual(parseICalDate('20260815T100000'), { iso: '2026-08-15T10:00:00', allDay: false });
  assert.deepEqual(parseICalDate('20260815', { VALUE: 'DATE' }), { iso: '2026-08-15', allDay: true });
});

test('parseICal: two VEVENTs → normalized shape (title/start/end/location/url/allDay)', () => {
  const evs = parseICal(SAMPLE);
  assert.equal(evs.length, 2);
  const con = evs[0];
  assert.equal(con.title, 'Comic Con — Northwind booth');
  assert.equal(con.start, '2026-08-15T10:00:00.000Z');
  assert.equal(con.end, '2026-08-15T18:00:00.000Z');
  assert.equal(con.location, 'Taipei World Trade Center, Hall 1', 'escaped comma unescaped');
  assert.equal(con.url, 'https://example.com/con');
  assert.equal(con.allDay, false);
  assert.equal(con.source, 'ical');
  const allday = evs[1];
  assert.equal(allday.allDay, true);
  assert.equal(allday.start, '2026-09-01');
});

test('parseICal: unfolds folded lines + tolerates junk without throwing', () => {
  const folded = ['BEGIN:VEVENT', 'SUMMARY:A very long title that the', '  calendar folded onto two lines', 'DTSTART:20260815T100000Z', 'END:VEVENT'].join('\r\n');
  const [e] = parseICal(folded);
  assert.equal(e.title, 'A very long title that the calendar folded onto two lines');
  assert.deepEqual(parseICal('garbage\r\nno events here'), []);
});

test('mergeEvents: dedupe by uid, sort by start', () => {
  const a = [{ uid: 'x', title: 'X', start: '2026-08-10T00:00:00Z' }];
  const b = [{ uid: 'x', title: 'X dup', start: '2026-08-10T00:00:00Z' }, { uid: 'y', title: 'Y', start: '2026-08-05T00:00:00Z' }];
  const m = mergeEvents([a, b]);
  assert.equal(m.length, 2, 'uid x deduped');
  assert.deepEqual(m.map((e) => e.uid), ['y', 'x'], 'sorted by start asc');
});

test('upcomingEvents: drops already-ended, keeps currently-running', () => {
  const evs = [
    { title: 'past', start: '2026-07-01T00:00:00Z', end: '2026-07-01T01:00:00Z' },
    { title: 'running', start: '2026-08-01T11:00:00Z', end: '2026-08-01T13:00:00Z' },
    { title: 'future', start: '2026-08-20T00:00:00Z' },
  ];
  const up = upcomingEvents(evs, NOW);
  assert.deepEqual(up.map((e) => e.title), ['running', 'future']);
});

test('countdownText: live / <24h ticking seconds / <7d / >7d buckets', () => {
  const at = (offset) => ({ start: new Date(NOW + offset).toISOString() });
  assert.equal(countdownText({ start: new Date(NOW - H).toISOString(), end: new Date(NOW + H).toISOString() }, NOW), 'Now');
  assert.equal(countdownText(at(2 * H + 5 * 6e4 + 9e3), NOW), 'in 2h 05m 09s', 'trailing m/s zero-padded for stable width');
  assert.equal(countdownText(at(5 * 6e4 + 9e3), NOW), 'in 5m 09s', '<1h drops hours; leading m unpadded, s padded');
  assert.equal(countdownText(at(9e3), NOW), 'in 09s', '<1m seconds-only, still 2-digit');
  assert.equal(countdownText(at(42e3), NOW), 'in 42s', 'two-digit seconds unchanged');
  assert.equal(countdownText(at(3 * D), NOW), 'in 3d', '1–7d stays coarse days');
  assert.equal(countdownText(at(30 * D), NOW), '', '>7d → no countdown (date carries it)');
});

test('addToCalendarUrl: carries title, dates, location', () => {
  const url = addToCalendarUrl({ title: 'Con', start: '2026-08-15T10:00:00.000Z', end: '2026-08-15T18:00:00.000Z', location: 'TWTC' });
  assert.match(url, /calendar\.google\.com/);
  assert.match(url, /dates=20260815T100000Z%2F20260815T180000Z/);
  assert.match(url, /location=TWTC/);
});

test('countdownText: `always` extends past 7d into w/mo; default still blanks', () => {
  const D = 24 * 36e5;
  const at = (days) => ({ title: 'Con', start: new Date(NOW + days * D).toISOString() });

  // default (urgency-only) is unchanged — this is what every existing site gets
  assert.equal(countdownText(at(3), NOW), 'in 3d');
  assert.equal(countdownText(at(30), NOW), '', 'far event stays blank by default');

  // opt-in
  assert.equal(countdownText(at(3), NOW, {}, true), 'in 3d', 'near buckets untouched by `always`');
  assert.equal(countdownText(at(30), NOW, {}, true), 'in 4w');
  assert.equal(countdownText(at(120), NOW, {}, true), 'in 4mo');
  assert.equal(countdownText(at(30), NOW, { inPrefix: '還有 ' }, true), '還有 4w', 'prefix still applies');
});

test('renderEvents: countdown:"always" reaches the badge', () => {
  const far = [{ title: 'Con', start: new Date(NOW + 90 * 24 * 36e5).toISOString() }];
  assert.match(renderEvents(far, { now: NOW, countdown: 'always' }), /<span class="dc-ev-cd"[^>]*>in 3mo</);
  // default: the badge element still ships (the client ticks it) but carries no text
  assert.match(renderEvents(far, { now: NOW }), /<span class="dc-ev-cd"[^>]*><\/span>/);
});

test('parseICal: DESCRIPTION → description, absent → null', () => {
  const ics = [
    'BEGIN:VEVENT',
    'SUMMARY:2026 SDCC',
    'DTSTART;VALUE=DATE:20260723',
    'LOCATION:San Diego Convention Center',
    'DESCRIPTION:Booth 5524\\nSigning at 2pm\\, Sat',   // escaped newline + comma
    'END:VEVENT',
  ].join('\r\n');
  const [e] = parseICal(ics);
  assert.equal(e.description, 'Booth 5524\nSigning at 2pm, Sat');
  assert.equal(parseICal(SAMPLE)[0].description, null, 'feed without DESCRIPTION → null, not undefined');
});

test('renderEvents: description renders when present, omitted when absent', () => {
  const start = new Date(NOW + 10 * D).toISOString();
  const withDesc = renderEvents([{ title: 'Con', start, description: 'Booth 5524\nSigning at 2pm' }], { now: NOW });
  assert.match(withDesc, /class="dc-ev-desc"/);
  assert.match(withDesc, /Booth 5524 · Signing at 2pm/, 'newlines fold to a middot-joined line');

  const noDesc = renderEvents([{ title: 'Con', start }], { now: NOW });
  assert.equal(noDesc.includes('dc-ev-desc'), false, 'no empty node for feeds without DESCRIPTION');

  // third-party feed text is never trusted as HTML
  const evil = renderEvents([{ title: 'Con', start, description: '<img src=x onerror=alert(1)>' }], { now: NOW });
  assert.equal(evil.includes('<img src=x'), false);
  assert.match(evil, /&lt;img src=x/);
});

test('renderEvents: list markers, showCount clamp, empty state, escaping', () => {
  const evs = parseICal(SAMPLE);
  const html = renderEvents(evs, { showCount: 1, now: NOW, labels: { add: 'Add' } });
  assert.match(html, /class="dc-ev-list"/);
  assert.equal((html.match(/dc-ev-item/g) || []).length, 1, 'showCount clamps to 1');
  assert.match(html, /dc-ev-cd/);
  assert.match(html, /dc-ev-add/);
  assert.equal(renderEvents([], { now: NOW }).includes('dc-ev--empty'), true, 'empty state');
  // XSS-escaped
  const evil = renderEvents([{ title: '<script>x', start: new Date(NOW + D).toISOString() }], { now: NOW });
  assert.equal(evil.includes('<script>x'), false);
  assert.match(evil, /&lt;script&gt;/);
});
