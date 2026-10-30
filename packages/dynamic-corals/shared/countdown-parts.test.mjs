// The countdown arithmetic, and the one-brain guard between it and events.
//   run: node --test packages/dynamic-corals/shared/countdown-parts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDeadline, remainingParts, pad2 } from './countdown-parts.mjs';
import { countdownText } from '../events/events-core.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const D = 864e5, H = 36e5;

test('parts: days / hours / minutes / seconds, seconds floored', () => {
  const dl = parseDeadline('2026-12-01T23:59:59+09:00');
  const now = dl - (32 * D + 12 * H + 40 * 6e4 + 2 * 1e3 + 600);
  assert.deepEqual(remainingParts(dl, now), { expired: false, total: 32 * 86400 + 12 * 3600 + 40 * 60 + 2, days: 32, hours: 12, minutes: 40, seconds: 2 });
});

test('expiry is AT the deadline: the final second is 00 and not expired', () => {
  const dl = parseDeadline('2026-12-01T23:59:59Z');
  assert.deepEqual(remainingParts(dl, dl - 1001), { expired: false, total: 1, days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.deepEqual(remainingParts(dl, dl - 999), { expired: false, total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(remainingParts(dl, dl - 1), { expired: false, total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(remainingParts(dl, dl).expired, true);
  assert.deepEqual(remainingParts(dl, dl + 5000), { expired: true, total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test('pad2 keeps two digits minimum and never truncates (100 days stays 100)', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2(7), '07');
  assert.equal(pad2(99), '99');
  assert.equal(pad2(100), '100');
});

test('a deadline without an explicit offset is refused', () => {
  for (const bad of ['2026-12-01T23:59:59', '2026-12-01', '', null, 'soon', '2026-12-01 23:59:59+09:00']) {
    assert.ok(Number.isNaN(parseDeadline(bad)), String(bad));
  }
  for (const good of ['2026-12-01T23:59:59Z', '2026-12-01T23:59+09:00', '2026-12-01T23:59:59.500-05:00']) {
    assert.ok(!Number.isNaN(parseDeadline(good)), good);
  }
});

test('a date that does not exist is refused, not rolled over', () => {
  for (const bad of ['2026-02-31T00:00Z', '2026-02-29T00:00Z', '2026-04-31T00:00Z', '2026-13-01T00:00Z', '2026-00-10T00:00Z',
    '2026-12-01T24:00Z', '2026-12-01T23:60Z', '2026-12-01T23:59:60Z', '2026-12-01T23:59+24:00', '2026-12-01T23:59+09:60', '2026-12-00T00:00Z']) {
    assert.ok(Number.isNaN(parseDeadline(bad)), bad);
  }
  assert.equal(parseDeadline('2028-02-29T00:00Z'), Date.UTC(2028, 1, 29), 'a real leap day is accepted');
});

test('every accepted deadline is the same instant Date.parse gives for it (no engine leniency involved)', () => {
  const cases = [];
  for (const date of ['2026-01-31', '2026-02-28', '2028-02-29', '2026-12-01', '1999-12-31'])
    for (const time of ['00:00', '23:59', '12:34:56', '07:08:09.5', '07:08:09.123'])
      for (const zone of ['Z', '+09:00', '-05:30', '+00:00', '+14:00', '-12:00']) cases.push(`${date}T${time}${zone}`);
  for (const c of cases) assert.equal(parseDeadline(c), Date.parse(c), c);
  assert.equal(cases.length, 150);
});

test('same remaining time under TZ=UTC and TZ=Asia/Tokyo', () => {
  const probe = `import { parseDeadline, remainingParts } from ${JSON.stringify(HERE + 'countdown-parts.mjs')};
    const now = Date.parse('2026-10-30T02:19:00Z');
    process.stdout.write(JSON.stringify([remainingParts(parseDeadline('2026-12-01T23:59:59+09:00'), now), Number.isNaN(parseDeadline('2026-12-01T23:59:59')), new Date(now).getHours()]));`;
  const run = (TZ) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, TZ } }).toString());
  const utc = run('UTC'), tokyo = run('Asia/Tokyo');
  assert.notEqual(utc[2], tokyo[2], 'CONTROL: the two child processes really ran in different zones');
  assert.deepEqual(utc[0], tokyo[0]);
  assert.deepEqual(utc[0], { expired: false, total: 32 * 86400 + 12 * 3600 + 40 * 60 + 59, days: 32, hours: 12, minutes: 40, seconds: 59 });
  assert.deepEqual([utc[1], tokyo[1]], [true, true], 'the zone-dependent spelling is refused in both');
});

// 🔴 ONE BRAIN. events-core.countdownText now takes its final-day h/m/s from remainingParts. This
// drives events THROUGH that path across the whole final day and checks it against an expectation
// computed here by plain integer division — not against remainingParts, which would be circular now
// that events calls it.
test('events countdownText (via remainingParts) matches an independent h/m/s on every step of the final day', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const two = (n) => String(n).padStart(2, '0');
  for (let left = 1000; left < D; left += 997) {          // a prime step walks every second-of-minute
    const secs = Math.trunc(left / 1000);
    const h = Math.trunc(secs / 3600), m = Math.trunc((secs % 3600) / 60), s = secs % 60;
    const expect = 'in ' + (h ? `${h}h ${two(m)}m ${two(s)}s` : m ? `${m}m ${two(s)}s` : `${two(s)}s`);
    assert.equal(countdownText({ start: new Date(now + left).toISOString(), end: null }, now), expect, `left=${left}ms`);
  }
});
