// REEF with Countdown — the feed half: which event a root counts to, and when that is.
// Zero I/O and no DOM (node drives it directly); countdown-core.mjs does the one fetch and the
// writing. The feed is the events coral's (`../events/events-worker.mjs`): `{ events: [...] }`, each
// event in the Event shape — `title, start, end, allDay, location, description, url`.
//
// 🔴 AN EVENT'S MOMENT MUST NAME ITS OFFSET, the same rule a typed `data-deadline` follows
// (../shared/countdown-parts.mjs). A timed event that arrives in UTC (`…Z`, what a public Google
// Calendar feed sends) is exact. An ALL-DAY event is only a date, and a floating time is only a
// wall clock: neither says where on earth it is, so each needs the root's `data-offset` (`Z` or
// `±hh:mm`), and without one the event is passed over rather than read in the visitor's zone —
// which would end the same countdown hours apart for two visitors and look correct to both.
import { parseDeadline } from '../shared/countdown-parts.mjs';

const OFFSET = /^(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/**
 * The instant (epoch ms) a root counts to for `event`, or NaN when it cannot be known.
 * `countTo` is `start` (default) or `end`; an event with no end is counted to its start. An all-day
 * event's end is the feed's own exclusive one (the midnight AFTER its last day), so `end` on a
 * one-day deadline is the end of that day.
 */
export function eventInstant(event, countTo, offset) {
  if (!event) return NaN;
  const text = String((countTo === 'end' && event.end) || event.start || '').trim();
  const off = String(offset == null ? '' : offset).trim();
  if (DATE_ONLY.test(text)) return OFFSET.test(off) ? parseDeadline(`${text}T00:00:00${off}`) : NaN;
  if (FLOATING.test(text)) return OFFSET.test(off) ? parseDeadline(text + off) : NaN;
  return parseDeadline(text);
}

/** The first event (feed order: soonest first) whose instant is still ahead of `now`, or null. */
export function pickEvent(events, now, countTo, offset) {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    const deadline = eventInstant(event, countTo, offset);
    if (!Number.isNaN(deadline) && deadline > now) return { event, deadline };
  }
  return null;
}

/** `text` when it is an absolute http(s) URL, else ''. Nothing else is ever written into an href. */
export function httpUrl(text) {
  const value = String(text == null ? '' : text).trim();
  if (!/^https?:\/\//i.test(value)) return '';
  try { return new URL(value).href; } catch { return ''; }
}

/**
 * The href for a `data-event-href` link. `url` is the event's own URL. `location` is the location
 * when the author wrote a URL there (an online event, a sign-up page), and otherwise a map search
 * for it — the same link the events coral gives the same field (asserted in countdown-feed.test.mjs).
 * '' means "leave the link as authored".
 */
export function eventHref(event, which) {
  if (!event) return '';
  if (which === 'url') return httpUrl(event.url);
  if (which !== 'location' || !event.location) return '';
  return httpUrl(event.location)
    || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(event.location);
}

/** The text for a `data-event` slot, or '' (leave the slot as authored). */
export function eventText(event, field) {
  if (!event || !['title', 'location', 'description'].includes(field)) return '';
  return String(event[field] == null ? '' : event[field]).trim();
}
