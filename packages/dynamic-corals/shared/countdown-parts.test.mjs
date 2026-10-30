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
  assert.deepEqual(remainingParts(dl, now), { expired: false, days: 32, hours: 12, minutes: 40, seconds: 2 });
});

test('expiry: from the deadline on, expired and all zero', () => {
  const dl = parseDeadline('2026-12-01T23:59:59Z');
  assert.equal(remainingParts(dl, dl - 1001).expired, false);
  assert.deepEqual(remainingParts(dl, dl - 999), { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(remainingParts(dl, dl).expired, true);
  assert.equal(remainingParts(dl, dl + 5000).expired, true);
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

test('same remaining time under TZ=UTC and TZ=Asia/Tokyo', () => {
  const probe = `import { parseDeadline, remainingParts } from ${JSON.stringify(HERE + 'countdown-parts.mjs')};
    const now = Date.parse('2026-10-30T02:19:00Z');
    process.stdout.write(JSON.stringify([remainingParts(parseDeadline('2026-12-01T23:59:59+09:00'), now), Number.isNaN(parseDeadline('2026-12-01T23:59:59')), new Date(now).getHours()]));`;
  const run = (TZ) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, TZ } }).toString());
  const utc = run('UTC'), tokyo = run('Asia/Tokyo');
  assert.notEqual(utc[2], tokyo[2], 'CONTROL: the two child processes really ran in different zones');
  assert.deepEqual(utc[0], tokyo[0]);
  assert.deepEqual(utc[0], { expired: false, days: 32, hours: 12, minutes: 40, seconds: 59 });
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
