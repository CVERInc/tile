// The countdown arithmetic, once: a deadline and a "now" in, whole days/hours/minutes/seconds out.
// Zero I/O and no DOM, so node drives it directly and every coral that shows time-remaining reads
// the same answer.
//
// 🔴 A DEADLINE MUST NAME ITS OFFSET. `Date.parse('2026-12-01T23:59:59')` is read in the VISITOR's
// zone, so one embed would end nine hours apart for a visitor in Tokyo and one in London — and both
// pages would look correct. `parseDeadline` accepts only an ISO date-time ending in `Z` or `±hh:mm`
// and returns NaN for anything else; a caller treats NaN as "not configured" and shows nothing.
//
// events-core's countdownText splits the final day into h/m/s with the same three floors used
// here; countdown-parts.test.mjs holds the two to the same answer until events imports this module
// itself (that is an events release, so it is not done in passing).

const SECOND = 1e3;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Deadline text → epoch ms, or NaN when it is not an ISO date-time with an explicit offset. */
export function parseDeadline(text) {
  const value = String(text == null ? '' : text).trim();
  if (!ISO_WITH_OFFSET.test(value)) return NaN;
  return Date.parse(value);
}

/**
 * Whole units left until `deadline` (both epoch ms). Seconds are floored, so the display reaches
 * 00:00:00 at the deadline and never shows a second that has not yet started. `expired` is true from
 * the deadline on, and every unit is 0 then.
 */
export function remainingParts(deadline, now) {
  const left = Math.floor((deadline - now) / SECOND) * SECOND;
  if (!(left > 0)) return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    expired: false,
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
