// One event as an iCalendar file (RFC 5545) — what "add to calendar" hands a device whose own
// calendar opens .ics (Apple's: iPhone, iPad, Mac). Pure: no fetch, no DOM. The worker serves it;
// the corals link to it. The event is a FEED event (feedEvents): `uid`, `title`, `start`/`end`
// (dates, for an all-day one), `startsAt`/`endsAt` (UTC instants), `location`, and `description`
// that is already plain text.

const CRLF = '\r\n';

/**
 * TEXT value escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, and a newline as `\n`.
 * Control characters other than a tab are not TEXT at all and are dropped: the value is a third
 * party's, and a NUL in a file is something a native parser may stop at.
 */
export function icsText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line at 75 OCTETS (§3.1), never inside a UTF-8 sequence: a continuation line
 * starts with one space, which counts toward its own 75.
 */
export function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder();
  const out = [];
  let at = 0;
  let room = 75;
  while (at < bytes.length) {
    let end = Math.min(bytes.length, at + room);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;   // back off a continuation byte
    out.push(dec.decode(bytes.subarray(at, end)));
    at = end;
    room = 74;
  }
  return out.join(CRLF + ' ');
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');   // 20261012T000000Z
const dateOnly = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).replace(/-/g, '') : '');
function nextDay(yyyymmdd) {
  const t = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) + 864e5;
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * The file, or '' when the event cannot be stated (no uid, or no start that can be read). An
 * all-day event keeps its DATES — a date is the same date for everyone — and its end stays
 * exclusive, as the feed has it. A timed event is its exact instants, in UTC.
 */
export function eventIcs(event, opts = {}) {
  if (!event || !event.uid) return '';
  const now = opts.now == null ? Date.now() : opts.now;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//feelreef//events coral//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'];
  lines.push('UID:' + icsText(event.uid), 'DTSTAMP:' + stamp(now));
  if (event.allDay) {
    const start = dateOnly(event.start);
    if (!start) return '';
    const end = dateOnly(event.end);
    lines.push('DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + (end && end > start ? end : nextDay(start)));
  } else {
    const startsAt = Date.parse(event.startsAt);
    if (Number.isNaN(startsAt)) return '';
    const endsAt = Date.parse(event.endsAt);
    lines.push('DTSTART:' + stamp(startsAt));
    if (!Number.isNaN(endsAt) && endsAt > startsAt) lines.push('DTEND:' + stamp(endsAt));
  }
  lines.push('SUMMARY:' + icsText(event.title || ''));
  if (event.location) lines.push('LOCATION:' + icsText(event.location));
  if (event.description) lines.push('DESCRIPTION:' + icsText(event.description));
  const url = /^https?:\/\/\S+$/i.test(String(event.url || '').trim()) ? String(event.url).trim() : '';
  if (url) lines.push('URL:' + url);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Where that file is served: the feed's own address with `ics=<uid>` (the events worker answers
 * it). '' when there is no uid or the feed's address is not an absolute http(s) URL.
 */
export function icsUrl(feedSrc, uid) {
  if (!uid) return '';
  let u;
  try { u = new URL(String(feedSrc || '')); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  u.searchParams.set('ics', String(uid));
  return u.toString();
}
