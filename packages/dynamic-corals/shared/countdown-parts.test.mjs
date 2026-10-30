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

// 🔴 ONE BRAIN. events-core.countdownText splits its final day into h/m/s with the same floors as
// remainingParts. events does not import this module yet (that changes events.js and is an events
// release), so until it does, this holds the two to the same answer across the whole final day.
test('events countdownText agrees with remainingParts on every h/m/s inside the final day', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  for (let left = 1000; left < D; left += 997) {          // a prime step walks every second-of-minute
    const start = new Date(now + left).toISOString();
    const r = remainingParts(now + left, now);
    const expect = 'in ' + (r.hours ? `${r.hours}h ${p(r.minutes)}m ${p(r.seconds)}s` : r.minutes ? `${r.minutes}m ${p(r.seconds)}s` : `${p(r.seconds)}s`);
    assert.equal(countdownText({ start, end: null }, now), expect, `left=${left}ms`);
  }
});
