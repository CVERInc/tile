// The events list, drawn in the browser from the feed's `events` — the calendar as data — by the
// same rules the countdown follows (countdown-feed.mjs is where they live; this file adds only what
// a LIST needs: the date tile, the badge, and the markup).
//
//   • what the calendar says is what is shown: nothing translated, filtered or tidied;
//   • WHAT'S-NEXT order — by the moment each event counts to (`upcoming`);
//   • every word that is not the calendar's is the browser's (Intl), in the page's language;
//   • a timed event is read on the visitor's clock, an all-day one keeps the calendar's dates;
//   • a location that is a URL is a link to it, any other is a place on the platform's map;
//   • add-to-calendar has three doors on each row: the date tile, the date line and the badge.
import { upcoming, phaseOf, nextMoment, locationKind, locationText, eventHref, whenText } from '../countdown/countdown-feed.mjs';
import { esc, icon } from './events-core.mjs';

const H = 36e5, D = 24 * H;

/**
 * A language tag Intl will take, or undefined (the browser's own). A page's `lang` is whatever its
 * author typed — `en_US`, `x` — and a tag Intl refuses throws from every formatter, which would
 * leave a row with no date at all.
 */
export function usableLocale(tag) {
  const text = String(tag == null ? '' : tag).trim();
  if (!text) return undefined;
  try { return Intl.getCanonicalLocales(text)[0]; } catch { return undefined; }
}
export const LIST_DEFAULT = 5;
export const LIST_MAX = 20;

/**
 * The date tile: month, weekday and day of the moment the event counts to — its first day while
 * that is ahead, its last day once it is under way. An all-day event's dates are the calendar's own (its
 * end is exclusive, so the last day is the one before); a timed event's are the visitor's.
 */
export function tileParts(item, now, locale) {
  const { event } = item;
  const during = phaseOf(item, now) === 'during';
  let date, timeZone;
  const dateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (event.allDay && dateOnly(event.start)) {
    const first = Date.parse(`${event.start}T00:00:00Z`);
    const last = dateOnly(event.end) ? Math.max(first, Date.parse(`${event.end}T00:00:00Z`) - D) : first;
    date = new Date(during ? last : first); timeZone = 'UTC';
  } else {
    // The last day of a timed event is the day its last moment is in: one that ends at midnight
    // ends on the day before, not on the day that midnight begins.
    date = new Date(during ? Math.max(item.startsAt, item.endsAt - 1) : item.startsAt);
  }
  const part = (options) => { try { return new Intl.DateTimeFormat(locale || undefined, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date); } catch { return ''; } };
  // The day is the NUMBER alone. Some languages write a day as number + a word for "day" (19日);
  // on a calendar leaf that word is the leaf itself, so only Intl's `day` part is taken — still the
  // browser's digits for the language, never ours.
  const dayNumber = () => {
    try {
      const parts = new Intl.DateTimeFormat(locale || undefined, { day: 'numeric', ...(timeZone ? { timeZone } : {}) }).formatToParts(date);
      return parts.filter((p) => p.type === 'day').map((p) => p.value).join('') || part({ day: 'numeric' });
    } catch { return ''; }
  };
  return { mo: part({ month: 'short' }), wd: part({ weekday: 'short' }), day: dayNumber() };
}

/**
 * The badge: how far off the start is ("in 3 wk.", "tomorrow"), or the browser's word for "now"
 * while the event is under way. Intl.RelativeTimeFormat's words, never ours. '' when the browser
 * has no such formatter.
 */
export function badgeText(item, now, locale) {
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto', style: 'short' }); } catch { return ''; }
  if (phaseOf(item, now) === 'during') return rtf.format(0, 'second');
  const ms = item.startsAt - now;
  // A unit never shows the next unit's worth: 59 min 40 s is "in 59 min.", not "in 60 min.".
  if (ms < H) return rtf.format(Math.min(59, Math.max(1, Math.round(ms / 6e4))), 'minute');
  if (ms < D) return rtf.format(Math.min(23, Math.max(1, Math.round(ms / H))), 'hour');
  // From a day out, days are CALENDAR days on the visitor's clock: "tomorrow" is the next date,
  // whether that is 3 hours or 40 hours away.
  const midnight = (t) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const days = Math.round((midnight(item.startsAt) - midnight(now)) / D);
  // 24 hours off and still today: the day the clocks go back is 25 hours long.
  if (days < 1) return rtf.format(23, 'hour');
  if (days < 14) return rtf.format(days, 'day');
  if (days < 60) return rtf.format(Math.round(days / 7), 'week');
  if (days < 365) return rtf.format(Math.min(11, Math.round(days / 30.44)), 'month');
  return rtf.format(Math.max(1, Math.round(days / 365.25)), 'year');
}

/** Whether a root keeps the badge on far-off events: its `data-countdown="always"`, or the feed
 *  address's own `countdown=always` (read like `show=`, so the address a site pasted keeps working). */
export function farBadges(dataCountdown, feedSrc) {
  if (dataCountdown === 'always') return true;
  try { return new URL(String(feedSrc || ''), 'https://x.invalid/').searchParams.get('countdown') === 'always'; } catch { return false; }
}

/** How many rows a root asks for: `show` (the root's `data-show`, else the feed address's own
 *  `show=`), an integer 1…LIST_MAX; LIST_DEFAULT when neither says. */
export function showCount(dataShow, feedSrc) {
  let asked = Number(dataShow);
  if (!(asked >= 1)) {
    try { asked = Number(new URL(String(feedSrc || ''), 'https://x.invalid/').searchParams.get('show')); } catch { asked = NaN; }
  }
  return asked >= 1 ? Math.min(LIST_MAX, Math.floor(asked)) : LIST_DEFAULT;
}

/**
 * The rows to draw. `opts`: { now, locale, userAgent, feedSrc, show, far }.
 * `far` (the root's `data-countdown="always"`) keeps the badge on events more than a week off;
 * without it those rows have none — the knob the list has always had.
 */
export function listRows(feed, opts = {}) {
  const { now = Date.now(), userAgent = '', feedSrc = '', show = LIST_DEFAULT, far = false } = opts;
  const locale = usableLocale(opts.locale);
  const fileSrc = feed && feed.ics === true ? feedSrc : '';
  return upcoming(feed, now).slice(0, show).map((item) => {
    const { event } = item;
    const state = phaseOf(item, now);
    const kind = locationKind(event);
    return {
      uid: event.uid == null ? '' : String(event.uid),
      state,
      title: String(event.title == null ? '' : event.title).trim(),
      when: whenText(event, locale, now),
      tile: tileParts(item, now, locale),
      badge: state === 'during' || far || item.startsAt - now < 7 * D ? badgeText(item, now, locale) : '',
      location: locationText(event),
      locationKind: kind,
      locationHref: eventHref(event, 'location', userAgent),
      description: String(event.description == null ? '' : event.description).trim(),
      addHref: eventHref(event, 'add', userAgent, fileSrc),
    };
  });
}

/** What must match for a repaint to be only a change of badge words: which rows, in which state. */
export const rowsShape = (rows) => rows.map((r) => `${r.uid}\u0000${r.state}\u0000${r.title}\u0000${r.when}\u0000${r.tile.mo}${r.tile.wd}${r.tile.day}\u0000${r.badge ? 1 : 0}`).join('\u0001');

const ADD = 'Add to calendar';   // accessible name only; English like every aria string the corals ship
const link = (href, cls, inner, label) => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</a>`;

/** The list's markup. Every value is escaped: the feed is a third party's text. */
export function renderRows(rows, opts = {}) {
  if (!rows.length) return `<div class="dc-ev--empty">${esc(opts.empty || 'No upcoming events.')}</div>`;
  const items = rows.map((r) => {
    // The tile: the month as a bar across the top, weekday and day centred in what is left.
    const tileInner = `<span class="dc-ev-cal-mo">${esc(r.tile.mo)}</span><span class="dc-ev-cal-face"><span class="dc-ev-cal-wd">${esc(r.tile.wd)}</span><span class="dc-ev-cal-day">${esc(r.tile.day)}</span></span>`;
    // The tile and the badge are extra doors to what the date line already does and says, so a
    // screen reader is given the date line only: one "Add to calendar: <when>", not three.
    const tile = r.addHref
      ? `<a class="dc-ev-cal" href="${esc(r.addHref)}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${tileInner}</a>`
      : `<div class="dc-ev-cal" aria-hidden="true">${tileInner}</div>`;
    const title = r.locationHref ? link(r.locationHref, 'dc-ev-title', esc(r.title)) : `<span class="dc-ev-title">${esc(r.title)}</span>`;
    const badge = !r.badge ? ''
      : r.addHref ? `<a class="dc-ev-cd" href="${esc(r.addHref)}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${esc(r.badge)}</a>`
      : `<span class="dc-ev-cd">${esc(r.badge)}</span>`;
    const when = r.addHref
      ? link(r.addHref, 'dc-ev-line dc-ev-when', `${icon('calendar-plus')}<span>${esc(r.when)}</span>`, `${ADD}: ${r.when}`)
      : `<span class="dc-ev-line dc-ev-when">${icon('calendar')}<span>${esc(r.when)}</span></span>`;
    const place = r.locationKind === 'none' ? ''
      : r.locationHref ? link(r.locationHref, 'dc-ev-line dc-ev-loc', `${icon(r.locationKind === 'url' ? 'link' : 'map-pin')}<span>${esc(r.location)}</span>`)
      : `<span class="dc-ev-line dc-ev-loc">${icon('map-pin')}<span>${esc(r.location)}</span></span>`;
    const said = r.description ? `<p class="dc-ev-line dc-ev-desc">${icon('info')}<span>${esc(r.description)}</span></p>` : '';
    return `<li class="dc-ev-item" data-state="${r.state}">${tile}<div class="dc-ev-body"><div class="dc-ev-main">${title}${badge}</div>${when}${place}${said}</div></li>`;
  });
  return `<ul class="dc-ev-list dc-ev-list--live">${items.join('')}</ul>`;
}
