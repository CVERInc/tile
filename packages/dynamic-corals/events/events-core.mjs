// REEF with Events — the source-agnostic core. Zero I/O, node-runnable (same posture as
// product-page-core). Source adapters (iCal today; Discord next, in reef) each map their feed into
// the normalized Event shape; this core MERGES events from every configured source, dedupes, sorts,
// filters to upcoming, and renders the widget (date · location · live countdown · add-to-calendar).
//
//   Event { title, start(ISO), end(ISO|null), location, url, allDay, uid, source }
//
// `now` is always passed in (ISO or ms) so render + countdown are deterministic + testable; the
// client script (events.js) refreshes the countdowns live from data-start after hydration.
//
// The time-left arithmetic is ../shared/countdown-parts.mjs — the same module the countdown coral
// uses — so two corals cannot disagree about how many seconds are left.
import { remainingParts, pad2, parseDeadline } from '../shared/countdown-parts.mjs';
import { zonedInstant, knownTimeZone, addDays } from '../shared/zoned-time.mjs';
import { mapsUrl } from '../shared/map-link.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));

// Lucide line icons (no colour emoji anywhere — the house rule). 1em / currentColor; verbatim
// inner paths from lucide-static. Only the two the widget uses are inlined.
const LUCIDE = {
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'calendar-plus': '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="M16 19h6"/><path d="M19 16v6"/>',
  'calendar': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};
const icon = (name) => `<svg class="dc-ev-ic" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`;

/** Merge events from N source-arrays → deduped (by uid, else title+start), sorted by start ascending. */
export function mergeEvents(sourceArrays) {
  const all = [].concat(...(sourceArrays || []).filter(Boolean));
  const seen = new Map();
  for (const e of all) {
    if (!e || !e.start) continue;
    const key = e.uid ? `uid:${e.uid}` : `ts:${(e.title || '').toLowerCase()}|${e.start}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => ms(a.start) - ms(b.start));
}

/** Upcoming events: keep those not yet ended (end, else start + 1h) relative to `now`. */
export function upcomingEvents(events, now) {
  const n = ms(now);
  return mergeEvents([events]).filter((e) => {
    const start = ms(e.start);
    const end = e.end ? ms(e.end) : start + 3600e3;
    return end >= n;
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Feed text → the words in it. A Google Calendar description is HTML when its author used the
 * formatting bar (<b>, <a href>, <br>, lists); a reader that shows text wants the text. Tags go,
 * block ends and <br> become line breaks, the five entities a calendar actually emits are decoded,
 * and runs of blank space collapse. Not a sanitiser — the result is still TEXT and must be written
 * as text — just the difference between "Booth 5524" and "<b>Booth 5524</b>" on the page.
 */
export function plainText(value) {
  return String(value == null ? '' : value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    // Only what is SHAPED like a tag goes: `<b>`, `</a>`, `<a href="…">`. A description typed as
    // plain text may say "under < 10 and > 5", and everything between those two signs is its words.
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/**
 * When an event really starts and ends, as epoch ms — { startsAt, endsAt }, either NaN when it
 * cannot be known.
 *
 * A time the feed gives in UTC is exact. Everything else is a wall clock or a bare date and needs a
 * zone: the event's own (`startZone`/`endZone`, a zoned DTSTART) when the runtime knows it, else the
 * CALENDAR's (`calendarZone`, its X-WR-TIMEZONE). An all-day event is a date in the calendar's zone:
 * it starts at that zone's midnight and ends at the midnight after its last day (the feed's own end
 * is already exclusive; an all-day event that names none is one day). A timed event with no end is
 * given the hour the rest of this core already assumes (see upcomingEvents).
 *
 * 🔴 No zone, no instant. Reading a bare date in the server's zone, or the visitor's, would put the
 * same event at different moments for different people and look right to each of them.
 */
export function eventInstants(ev, calendarZone) {
  const at = (text, own) => {
    const t = String(text || '').trim();
    if (!t) return NaN;
    if (/(?:Z|[+-]\d{2}:\d{2})$/.test(t)) return parseDeadline(t);
    const zone = !DATE_ONLY.test(t) && knownTimeZone(own) ? own : calendarZone;
    return zonedInstant(t, zone);
  };
  const startsAt = at(ev && ev.start, ev && ev.startZone);
  let endsAt = at(ev && ev.end, ev && ev.endZone);
  if (Number.isNaN(endsAt) && !Number.isNaN(startsAt) && !(ev && ev.end)) {
    endsAt = ev.allDay && DATE_ONLY.test(String(ev.start)) ? zonedInstant(addDays(ev.start, 1), calendarZone) : startsAt + 3600e3;
  }
  return { startsAt, endsAt };
}

/**
 * The calendar as DATA: what another coral needs to act on an event without scraping the rendered
 * HTML (the countdown coral counts to these). Each event carries the Event shape's own fields plus
 * `startsAt`/`endsAt` — ISO instants in UTC, computed with the calendar's zone (eventInstants), null
 * when unknowable — and `description` as plain text.
 *
 * 🔴 NOT the rendered list's filter, and not its `showCount`. An event stays until it has really
 * ended (`endsAt`), which the rendered list's UTC reading of a bare date can miss by half a day; one
 * with no knowable end stays a day past where it looks over from here. And the cap is this feed's
 * own: a reader paging through events must see past every one that is under way, which a caller's
 * `show=1` would hide. A cancelled event is not offered. Order is the source's (by start); the
 * reader orders by what it counts to.
 */
export const FEED_GRACE_MS = 864e5;
export const FEED_MAX = 20;
export function feedEvents(events, opts = {}) {
  const { now = Date.now(), timeZone = null } = opts;
  const n = ms(now);
  const out = [];
  for (const ev of mergeEvents([events])) {
    if (ev.cancelled) continue;
    const { startsAt, endsAt } = eventInstants(ev, timeZone);
    if (Number.isNaN(endsAt)) {
      const looksOver = ev.end ? ms(ev.end) : ms(ev.start) + 3600e3;
      if (!(looksOver >= n - FEED_GRACE_MS)) continue;
    } else if (!(endsAt > n)) continue;
    const iso = (t) => (Number.isNaN(t) ? null : new Date(t).toISOString());
    out.push({
      uid: ev.uid || null,
      title: ev.title || '',
      start: ev.start,
      end: ev.end || null,
      allDay: !!ev.allDay,
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      location: ev.location || null,
      description: plainText(ev.description) || null,
      url: ev.url || null,
    });
    if (out.length === FEED_MAX) break;
  }
  return out;
}

/** Human "when" — a live-countdown bucket: live / <1h ticking seconds / <24h / <7d / (date beyond).
 *  Seconds appear only inside the final hour, where they add real drama; days/hours out stay coarse.
 *
 *  `always` (opt-in, `data-countdown="always"`) keeps the badge on for far-off dates too, in w/mo.
 *  Default stays urgency-only: past 7 days the badge vanishes, so a list of distant events shows
 *  badges on some rows and not others. A site whose whole list is months out (a conventions calendar)
 *  wants the steady rhythm instead; a site listing this week's gigs wants the urgency. Hence a knob,
 *  not a new default — the corals get reused and this shouldn't move under anyone.
 *  Units stay in the terse d/h/m/s vocabulary already shipped (w = weeks, mo = months); like those,
 *  they're not localised — only `inPrefix` is. Worth revisiting if this goes multilingual. */
export function countdownText(ev, now, L = {}, always = false) {
  const n = ms(now), start = ms(ev.start), end = ev.end ? ms(ev.end) : start + 3600e3;
  if (n >= start && n <= end) return L.live || 'Now';
  const d = start - n;
  if (d <= 0) return '';
  const H = 36e5, D = 24 * H, pre = L.inPrefix || 'in ';
  if (d < D) { // within a day → h/m/s, ticking every second; trailing units 2-digit for stable width
    const { hours: h, minutes: m, seconds: s } = remainingParts(start, n);
    return pre + (h ? `${h}h ${pad2(m)}m ${pad2(s)}s` : m ? `${m}m ${pad2(s)}s` : `${pad2(s)}s`);
  }
  if (d < 7 * D) return pre + `${Math.round(d / D)}d`;
  if (!always) return ''; // >7 days out → the date itself carries it, no countdown
  if (d < 60 * D) return pre + `${Math.round(d / (7 * D))}w`;
  return pre + `${Math.round(d / (30.44 * D))}mo`;
}

/** Compact date label, RANGE-aware (the authoritative line; the date tile only shows the start).
 *  Single day → "Aug 15" (all-day) / "Aug 15, 10:00" (timed). Multi-day → "Aug 15–17" (same month)
 *  / "Aug 15 – Sep 2" (spanning). Locale-driven via `locale`. */
export function formatWhen(ev, locale = 'en-US') {
  const start = new Date(ev.start);
  if (isNaN(start)) return String(ev.start);
  // iCal all-day DTEND is EXCLUSIVE (the day AFTER the last day) — pull it back a day so a Jul 15–17
  // con reads "15–17", not "15–18". Timed events keep their exact end.
  let end = ev.end ? new Date(ev.end) : null;
  if (end && !isNaN(end.getTime()) && ev.allDay) end = new Date(end.getTime() - 864e5);
  const dOpts = ev.allDay ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  try {
    const fmt = new Intl.DateTimeFormat(locale, dOpts);
    const single = !end || isNaN(end.getTime()) || start.toDateString() === end.toDateString();
    if (single) return fmt.format(start);
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const endStr = sameMonth
      ? new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(end)
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(end);
    return `${fmt.format(start)}–${endStr}`; // en dash
  } catch { return String(ev.start); }
}

/** The date-tile face — the START date only, as { mo, day } (month short + day number, locale-driven).
 *  The tile is the glanceable anchor; the full range/time is carried by formatWhen in the meta line. */
export function formatCalTile(ev, locale = 'en-US') {
  const d = new Date(ev.start);
  if (isNaN(d.getTime())) return { mo: '', day: String(ev.start || '').slice(0, 10) };
  try {
    return {
      mo: new Intl.DateTimeFormat(locale, { month: 'short' }).format(d),
      day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(d),
    };
  } catch { return { mo: '', day: String(d.getDate()) }; }
}

/** ISO → the compact form Google Calendar wants (UTC Z for timed; date for all-day). */
function gcalStamp(iso, allDay) {
  if (allDay) return String(iso).slice(0, 10).replace(/-/g, '');
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// The maps link lives in ../shared/map-link.mjs now — the countdown coral gives a place the same one.
export { mapsUrl };

/**
 * An "add to Google Calendar" link carrying the event's title / range / location — and what it
 * says: the description as plain text, then the event's own URL. Without the description the copy
 * in the visitor's calendar was an event with nothing in it; the place to read the whole of a long
 * description is the calendar it was written for.
 */
export const DETAILS_MAX = 1500;
export function addToCalendarUrl(ev, opts = {}) {
  const start = gcalStamp(ev.start, ev.allDay);
  const end = gcalStamp(ev.end || ev.start, ev.allDay);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title || '' });
  if (start && end) p.set('dates', `${start}/${end}`);
  if (ev.location) p.set('location', ev.location);
  // `descriptionIsText`: the caller's description is ALREADY plain text (the feed's is). Running
  // plainText over it again would decode entities a second time and turn the visible text `&lt;b&gt;`
  // into a tag. The description is capped (a link this is going into has a length someone's server
  // will refuse) and the URL goes after the cap, so a long description never costs the link.
  // Google reads `details` as limited HTML, so the text's own <, > and & are escaped to stay text.
  let said = opts.descriptionIsText ? String(ev.description == null ? '' : ev.description).trim() : plainText(ev.description);
  if (said.length > DETAILS_MAX) said = said.slice(0, DETAILS_MAX - 1).trimEnd() + '…';
  said = said.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = /^https?:\/\//i.test(String(ev.url || '').trim()) ? String(ev.url).trim() : '';
  const details = [said, link].filter(Boolean).join('\n\n');
  if (details) p.set('details', details);
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

/**
 * Render the events widget body (HTML string). `events` = normalized (any sources, already or not
 * merged — merge is idempotent). Opts: { showCount=3, now, locale, labels{ live,inPrefix,empty,add } }.
 */
export function renderEvents(events, opts = {}) {
  const { showCount = 3, now = Date.now(), locale = 'en-US', labels = {}, countdown = 'near' } = opts;
  const up = upcomingEvents(events, now).slice(0, Math.max(1, showCount | 0));
  if (up.length === 0) {
    return `<div class="dc-ev dc-ev--empty">${esc(labels.empty || 'No upcoming events.')}</div>`;
  }
  const rows = up.map((ev) => {
    const when = esc(formatWhen(ev, locale));
    const cd = countdownText(ev, now, labels, countdown === 'always');
    // Location → tap-to-map. Static href is Google Maps web (universal, no-JS + desktop safe);
    // events.js rewrites per-platform (Apple → maps.apple.com native · Android → geo: system chooser).
    const loc = ev.location
      ? `<a class="dc-ev-loc" href="${esc(mapsUrl(ev.location))}" data-loc="${esc(ev.location)}" target="_blank" rel="noopener">${icon('map-pin')}${esc(ev.location)}</a>`
      : '';
    // Description → the "what am I actually doing there" line (booth, signings, panels). Optional
    // and additive: a feed without DESCRIPTION renders exactly as it did before this existed.
    // Escaped, never HTML — Google Calendar descriptions routinely carry markup and links, and this
    // string comes from a third-party feed we don't control.
    const desc = ev.description
      ? `<p class="dc-ev-desc">${icon('info')}<span>${esc(ev.description.replace(/\s*\n\s*/g, ' · ').trim())}</span></p>`
      : '';
    const cdHtml = cd ? `<span class="dc-ev-cd" data-start="${esc(ev.start)}" data-end="${esc(ev.end || '')}">${esc(cd)}</span>` : `<span class="dc-ev-cd" data-start="${esc(ev.start)}" data-end="${esc(ev.end || '')}"></span>`;
    // 🔴 http(s) only: `ev.url` is the feed's URL property, third-party text like the rest, and a
    // `javascript:` value here would be a link that runs on the host page.
    const title = /^https?:\/\//i.test(String(ev.url || '').trim())
      ? `<a class="dc-ev-title" href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
      : `<span class="dc-ev-title">${esc(ev.title)}</span>`;
    // The date tile (start month + day) is the glanceable left anchor; it's decorative (the full,
    // authoritative date/range is in .dc-ev-when), hence aria-hidden so a screen reader hears the
    // real line once, not the day twice.
    const cal = formatCalTile(ev, locale);
    return `<li class="dc-ev-item">
  <div class="dc-ev-cal" aria-hidden="true"><span class="dc-ev-cal-mo">${esc(cal.mo)}</span><span class="dc-ev-cal-day">${esc(cal.day)}</span></div>
  <div class="dc-ev-body">
    <div class="dc-ev-main">${title}${cdHtml}</div>
    <span class="dc-ev-when">${icon('calendar')}<span>${when}</span></span>
    ${loc}
    ${desc}
    <a class="dc-ev-add" href="${esc(addToCalendarUrl(ev))}" target="_blank" rel="noopener">${icon('calendar-plus')}${esc(labels.add || 'Add to calendar')}</a>
  </div>
</li>`;
  }).join('\n');
  return `<ul class="dc-ev-list">\n${rows}\n</ul>`;
}
