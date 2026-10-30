// The countdown arithmetic, once: a deadline and a "now" in, whole days/hours/minutes/seconds out.
// Zero I/O and no DOM, so node drives it directly and every coral that shows time-remaining reads
// the same answer. events-core.countdownText and the countdown coral both import this module.
//
// 🔴 A DEADLINE MUST NAME ITS OFFSET. `Date.parse('2026-12-01T23:59:59')` is read in the VISITOR's
// zone, so one embed would end nine hours apart for a visitor in Tokyo and one in London — and both
// pages would look correct. `parseDeadline` accepts only an ISO date-time ending in `Z` or `±hh:mm`
// and returns NaN for anything else; a caller treats NaN as "not configured" and shows nothing.
// It also refuses a date that does not exist (2026-02-31, T24:00) instead of letting it roll over
// into a different moment, and computes the instant itself with Date.UTC, so no engine's Date.parse
// leniency decides when a deadline is.

const SECOND = 1e3;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/** Deadline text → epoch ms, or NaN when it is not a real ISO date-time with an explicit offset. */
export function parseDeadline(text) {
  const m = ISO_WITH_OFFSET.exec(String(text == null ? '' : text).trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s = '0', frac = '0', z, sign, oh, om] = m;
  const Y = +y, M = +mo, D = +d, H = +h, MI = +mi, S = +s;
  const ms = +frac.padEnd(3, '0');
  const offset = z ? 0 : (sign === '-' ? -1 : 1) * (+oh * 60 + +om);
  if (M < 1 || M > 12 || H > 23 || MI > 59 || S > 59 || (!z && (+oh > 23 || +om > 59))) return NaN;
  const daysInMonth = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  if (D < 1 || D > daysInMonth) return NaN;
  return Date.UTC(Y, M - 1, D, H, MI, S, ms) - offset * MINUTE;
}

/**
 * Whole units left until `deadline` (both epoch ms). Seconds are floored, so the final second before
 * the deadline reads 00:00:00 and a second is never shown before it has started. `expired` turns true
 * AT the deadline (no time left at all), not a second early; every unit is 0 then. `total` is the
 * whole seconds left, for a caller that folds larger units into a smaller one.
 */
export function remainingParts(deadline, now) {
  const raw = deadline - now;
  const total = raw > 0 ? Math.floor(raw / SECOND) : 0;
  const left = total * SECOND;
  return {
    expired: !(raw > 0),
    total,
    days: Math.floor(left / DAY),
    hours: Math.floor((left % DAY) / HOUR),
    minutes: Math.floor((left % HOUR) / MINUTE),
    seconds: Math.floor((left % MINUTE) / SECOND),
  };
}

/** At least two digits, more when the number has them (100 days stays 100, never 00). */
export function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}
