//   run: node --test packages/dynamic-corals/shared/zoned-time.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedInstant, knownTimeZone, addDays } from './zoned-time.mjs';

test('a date is that zone’s midnight; a wall time is that zone’s wall time', () => {
  assert.equal(zonedInstant('2026-12-01', 'Asia/Tokyo'), Date.UTC(2026, 10, 30, 15));
  assert.equal(zonedInstant('2026-12-02', 'Asia/Tokyo'), Date.parse('2026-12-01T23:59:59+09:00') + 1000);
  assert.equal(zonedInstant('2026-12-01T14:00', 'Asia/Tokyo'), Date.UTC(2026, 11, 1, 5));
  assert.equal(zonedInstant('2026-12-01T14:00:30', 'Asia/Tokyo'), Date.UTC(2026, 11, 1, 5, 0, 30));
  assert.equal(zonedInstant('2026-12-01', 'UTC'), Date.UTC(2026, 11, 1));
  assert.equal(zonedInstant('2026-12-12', 'Asia/Taipei'), Date.UTC(2026, 11, 11, 16));
});

test('daylight saving is the zone’s, on the day in question', () => {
  // Los Angeles: PDT (−7) in July, PST (−8) in December.
  assert.equal(zonedInstant('2026-07-23', 'America/Los_Angeles'), Date.UTC(2026, 6, 23, 7));
  assert.equal(zonedInstant('2026-12-12', 'America/Los_Angeles'), Date.UTC(2026, 11, 12, 8));
  // The night the clocks go back (2026-11-01 02:00 PDT → 01:00 PST): 00:00 is still PDT, 03:00 is PST.
  assert.equal(zonedInstant('2026-11-01T00:00', 'America/Los_Angeles'), Date.UTC(2026, 10, 1, 7));
  assert.equal(zonedInstant('2026-11-01T03:00', 'America/Los_Angeles'), Date.UTC(2026, 10, 1, 11));
  // 01:30 happens twice: the first one (PDT).
  assert.equal(zonedInstant('2026-11-01T01:30', 'America/Los_Angeles'), Date.UTC(2026, 10, 1, 8, 30));
  // The night they go forward (2026-03-08 02:00 → 03:00): 02:30 does not exist; just after the jump.
  assert.equal(zonedInstant('2026-03-08T03:00', 'America/Los_Angeles'), Date.UTC(2026, 2, 8, 10));
  assert.equal(zonedInstant('2026-03-08T01:59', 'America/Los_Angeles'), Date.UTC(2026, 2, 8, 9, 59));
  assert.equal(zonedInstant('2026-03-08T02:30', 'America/Los_Angeles'), Date.UTC(2026, 2, 8, 10, 30), 'read with the offset before the jump: 03:30 PDT');
});

test('what cannot be placed is NaN', () => {
  for (const [wall, tz] of [['2026-02-31', 'Asia/Tokyo'], ['2026-12-01', 'Mars/Olympus'], ['2026-12-01', ''],
    ['2026-12-01', null], ['tomorrow', 'UTC'], ['2026-12-01T25:00', 'UTC'], ['2026-12-01T10:00:00Z', 'UTC'], [null, 'UTC']]) {
    assert.ok(Number.isNaN(zonedInstant(wall, tz)), `${wall} / ${tz}`);
  }
  assert.equal(knownTimeZone('Asia/Tokyo'), true);
  assert.equal(knownTimeZone('Mars/Olympus'), false);
  assert.equal(knownTimeZone(''), false);
  assert.equal(knownTimeZone(undefined), false);
});

test('addDays walks the calendar, month and year ends included', () => {
  assert.equal(addDays('2026-12-01', 1), '2026-12-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('nope', 1), '');
});
