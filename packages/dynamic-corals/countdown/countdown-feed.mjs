// REEF with Countdown — the feed half: which events a root shows, in what order, what each one
// counts to, and the words for it. Zero I/O and no DOM (node drives it directly); countdown-core.mjs
// does the one fetch and the writing.
//
// The feed is the events coral's (`../events/events-worker.mjs`):
//   { calendar: { name, timeZone, description }, events: [ { uid, title, start, end, allDay,
//     startsAt, endsAt, location, description, url } ] }
// `startsAt`/`endsAt` are exact instants the feed worked out with the CALENDAR's own zone, so nothing
// here — and nothing on the host page — states an offset. An event without them cannot be counted
// to and is left out.
//
// 🔴 THE CALENDAR IS THE SOURCE. Nothing here filters by what an event says: an untitled event is
// shown untitled, a free/busy-only calendar shows "Busy". The owner's calendar is what the page says.
//
// 🔴 NO WORDS OF OUR OWN. Units, dates, ranges and zone names come from the runtime's Intl in the
// page's language; this file holds no translation table. What Intl cannot give (the accessible names
// of the controls) is the host's markup.
import { mapsUrl, mapHref } from '../shared/map-link.mjs';
import { addToCalendarUrl } from '../events/events-core.mjs';
import { icsUrl, opensIcs } from '../events/ics-file.mjs';

/**
 * Which feed a root reads on a page in `language`: `data-src-<language>` when the root has one for
 * the page's language, else `data-src`; '' when none applies. The page's tag is tried whole
 * (`zh-TW` → `data-src-zh-tw`), then as language and region without what sits between them
 * (`zh-Hant-TW` → `data-src-zh-tw`, what a host naturally writes), then shortened from the end one
 * subtag at a time down to the language alone (`data-src-zh-hant`, `data-src-zh`).
 *
 * Why: one calendar is in one language. A site in several puts ONE countdown in the chrome every
 * page shares, and each language's pages are to show that language's calendar. A root that names
 * only some languages shows nothing on the others, which is the honest state for "no calendar here".
 */
export function feedSource(root, language) {
  const tag = String(language || '').trim().toLowerCase();
  const tries = [];
  if (/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(tag)) {
    const parts = tag.split('-');
    tries.push(tag);
    const region = parts.slice(1).find((p) => /^([a-z]{2}|\d{3})$/.test(p));
    if (region) tries.push(`${parts[0]}-${region}`);
    for (let n = parts.length - 1; n >= 1; n--) tries.push(parts.slice(0, n).join('-'));
  }
  for (const t of [...new Set(tries)]) {
    const own = String(root.getAttribute(`data-src-${t}`) || '').trim();
    if (own) return own;
  }
  return String(root.getAttribute('data-src') || '').trim();
}

const instant = (iso) => (typeof iso === 'string' && /Z$/.test(iso) ? Date.parse(iso) : NaN);

/** What an item counts to at `now`: its start while that is ahead, its end once it is under way. */
export function nextMoment(item, now) {
  return item.startsAt > now ? item.startsAt : item.endsAt;
}

/** 'before' (counting to the start) or 'during' (counting to the end). */
export function phaseOf(item, now) {
  return item.startsAt > now ? 'before' : 'during';
}

/**
 * The events still to be shown, as { event, startsAt, endsAt } in WHAT'S-NEXT order: by the moment
 * each one counts to, soonest first, the feed's own order breaking a tie. An event that has ended,
 * or whose instants the feed could not give, is not in it.
 */
export function upcoming(feed, now) {
  const events = feed && Array.isArray(feed.events) ? feed.events : [];
  const items = [];
  events.forEach((event, order) => {
    if (!event || typeof event !== 'object') return;
    const startsAt = instant(event.startsAt), endsAt = instant(event.endsAt);
    if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || !(endsAt > now)) return;
    items.push({ event, startsAt, endsAt, order });
  });
  return items.sort((a, b) => nextMoment(a, now) - nextMoment(b, now) || a.order - b.order);
}

/** `text` when it is an absolute http(s) URL, else ''. Nothing else is ever written into an href. */
export function httpUrl(text) {
  const value = String(text == null ? '' : text).trim();
  if (!/^https?:\/\//i.test(value)) return '';
  try { return new URL(value).href; } catch { return ''; }
}

/** 'url' when the WHOLE location is an http(s) URL, 'place' for any other text, 'none' when empty. */
export function locationKind(event) {
  const location = String((event && event.location) || '').trim();
  if (!location) return 'none';
  return httpUrl(location) ? 'url' : 'place';
}

/** The location as shown: a place as written; a URL without its scheme, `www.` or trailing slash. */
export function locationText(event) {
  const location = String((event && event.location) || '').trim();
  if (locationKind(event) !== 'url') return location;
  return location.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

/**
 * The href for a `data-event-href` link, or '' ("no link here").
 *   location → the location itself when it is a URL; a map for a place (the platform's own, by
 *              `userAgent` — the same link the events coral gives a place).
 *   url      → the event's own URL property.
 *   add      → an add-to-calendar link for this event (the events coral's). In Safari on an Apple
 *              device (opensIcs), when the feed's address is known (`feedSrc`) and the event has a
 *              uid, the event as an .ics file from that feed instead: the device's own calendar
 *              opens it, where the Google link would ask for a Google sign-in first.
 */
export function eventHref(event, which, userAgent, feedSrc) {
  if (!event) return '';
  if (which === 'url') return httpUrl(event.url);
  if (which === 'add') {
    const file = opensIcs(userAgent) ? icsUrl(feedSrc, event.uid) : '';
    return file || addToCalendarUrl(calendarEntry(event), { descriptionIsText: true });   // the feed's description is already text
  }
  if (which !== 'location') return '';
  const kind = locationKind(event);
  if (kind === 'url') return httpUrl(event.location);
  return kind === 'place' ? mapHref(String(event.location).trim(), userAgent) : '';
}
export { mapsUrl };

/**
 * The event as an add-to-calendar link must state it. A timed event's `start`/`end` may be a wall
 * clock with no zone (a zoned or floating time in the feed); read on the visitor's device that
 * would become THEIR local time. The feed's exact instants are used instead. An all-day event keeps
 * its dates: a date is the same date for everyone.
 */
function calendarEntry(event) {
  if (event.allDay) return event;
  const startsAt = instant(event.startsAt), endsAt = instant(event.endsAt);
  if (Number.isNaN(startsAt)) return event;
  return { ...event, start: event.startsAt, end: Number.isNaN(endsAt) ? event.startsAt : event.endsAt };
}

const DAY = 864e5;
function formatRange(format, a, b) {
  if (typeof format.formatRange === 'function') return format.formatRange(a, b);
  return `${format.format(a)} – ${format.format(b)}`;
}

/**
 * When the event is, in the page's language, from Intl alone.
 * An all-day event is its DATES as the calendar wrote them (its end is exclusive, so the last day is
 * the one before): "Oct 12 – Dec 1", or one date. A timed event is its instants in the VISITOR's
 * zone, with the zone named, because a time read on a screen is a time on the reader's clock.
 * With `now`, a date that is not in the year `now` is in carries its year ("Feb 13 – 14, 2027"): a
 * list that runs past December would otherwise show next year's dates as if they were this year's.
 */
export function whenText(event, locale, now) {
  if (!event) return '';
  const lang = locale || undefined;
  // "This year" is the year on the VISITOR's calendar; an all-day date's own year is read in UTC,
  // where it was parsed (`zone`), a timed one's on the visitor's clock.
  const year = (ms, zone) => (now == null ? {} : (() => {
    const y = (t, z) => Number(new Intl.DateTimeFormat('en', { year: 'numeric', ...(z ? { timeZone: z } : {}) }).format(new Date(t)));
    const thisYear = y(now);
    return ms.some((t) => y(t, zone) !== thisYear) ? { year: 'numeric' } : {};
  })());
  try {
    if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(String(event.start))) {
      const first = Date.parse(`${event.start}T00:00:00Z`);
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event.end)) ? Date.parse(`${event.end}T00:00:00Z`) - DAY : first;
      const format = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC', ...year([first, endDate], 'UTC') });
      return endDate > first ? formatRange(format, new Date(first), new Date(endDate)) : format.format(new Date(first));
    }
    const startsAt = instant(event.startsAt), endsAt = instant(event.endsAt);
    if (Number.isNaN(startsAt)) return '';
    const format = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...year(endsAt > startsAt ? [startsAt, endsAt] : [startsAt]) });
    return endsAt > startsAt ? formatRange(format, new Date(startsAt), new Date(endsAt)) : format.format(new Date(startsAt));
  } catch { return ''; }
}

const UNIT = { days: 'day', hours: 'hour', minutes: 'minute', seconds: 'second' };
/** The page-language word for a unit ("days" → 日 / hr / Tg.), from Intl; '' when it has none. */
export function unitText(part, locale) {
  if (!UNIT[part]) return '';
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'unit', unit: UNIT[part], unitDisplay: 'short' })
      .formatToParts(2).filter((p) => p.type === 'unit').map((p) => p.value).join('').trim();
  } catch { return ''; }
}

/**
 * The text for a `data-event` slot, or '' (the slot is emptied — the calendar is the source).
 * `ctx` is { calendar, index, count, locale }.
 */
export function eventText(event, field, ctx = {}) {
  if (!event) return '';
  if (field === 'title' || field === 'description') return String(event[field] == null ? '' : event[field]).trim();
  if (field === 'location') return locationText(event);
  if (field === 'when') return whenText(event, ctx.locale);
  if (field === 'calendar') return String((ctx.calendar && ctx.calendar.name) || '').trim();
  if (field === 'position') return ctx.count > 1 ? `${ctx.index + 1}/${ctx.count}` : '';
  return '';
}
