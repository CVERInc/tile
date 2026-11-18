// A wall-clock time in a named zone → the instant it is. Zero I/O, no tz database of our own: the
// runtime's Intl has one (a Worker and every browser this ships to), and asking it "what does this
// instant read as in that zone" twice is enough to invert it.
//
// Why this exists: an iCal feed says WHERE a calendar lives (`X-WR-TIMEZONE`) and gives its all-day
// events as bare dates and its zoned events as wall clocks. Counting down to one of those needs the
// instant, and the calendar's own zone is the only honest source for it — not the server's zone and
// not the visitor's.
import { parseDeadline } from './countdown-parts.mjs';

const WALL = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?$/;
const formatters = new Map();

function formatter(timeZone) {
  if (formatters.has(timeZone)) return formatters.get(timeZone);
  let f = null;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { f = null; }
  formatters.set(timeZone, f);
  return f;
}

/** Is this a zone name the runtime knows? ('' and junk are not.) */
export function knownTimeZone(timeZone) {
  return typeof timeZone === 'string' && timeZone !== '' && formatter(timeZone) !== null;
}

/** How far ahead of UTC the zone is at this instant, in ms (whole seconds). */
function offsetAt(utcMs, timeZone) {
  const at = Math.floor(utcMs / 1000) * 1000;
  const p = {};
  for (const part of formatter(timeZone).formatToParts(new Date(at))) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at;
}

/**
 * `wall` is `YYYY-MM-DD` (midnight) or `YYYY-MM-DDTHH:MM[:SS]`, read in `timeZone` → epoch ms.
 * NaN for a date that does not exist or a zone the runtime does not know. A wall time that a
 * daylight-saving jump skips resolves to the instant just after the jump; one that happens twice
 * resolves to its first occurrence.
 */
export function zonedInstant(wall, timeZone) {
  const m = WALL.exec(String(wall == null ? '' : wall).trim());
  if (!m || !knownTimeZone(timeZone)) return NaN;
  const asUtc = parseDeadline(`${m[1]}T${m[2] || '00:00'}:${m[3] || '00'}Z`);
  if (Number.isNaN(asUtc)) return NaN;
  // The zone's offset a day either side brackets any change that could apply here. Each gives a
  // candidate; a candidate is REAL when the zone, asked about that instant, reads back this wall time.
  const before = asUtc - offsetAt(asUtc - 864e5, timeZone);
  const after = asUtc - offsetAt(asUtc + 864e5, timeZone);
  const real = (t) => offsetAt(t, timeZone) === asUtc - t;
  if (real(before) && real(after)) return Math.min(before, after);   // happens twice: the first
  if (real(before)) return before;
  if (real(after)) return after;
  return before;                                                      // skipped: just after the jump
}

/** The calendar date `days` after `date` (`YYYY-MM-DD`), as `YYYY-MM-DD`. */
export function addDays(date, days) {
  const t = parseDeadline(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? '' : new Date(t + days * 864e5).toISOString().slice(0, 10);
}
