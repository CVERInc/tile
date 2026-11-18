// node packages/dynamic-corals/events/events-list.test.mjs
import assert from 'node:assert/strict';
import { listRows, renderRows, rowsShape, tileParts, badgeText, showCount, LIST_DEFAULT, LIST_MAX } from './events-list.mjs';
import { upcoming, whenText } from '../countdown/countdown-feed.mjs';
import { addToCalendarUrl } from './events-core.mjs';
import { mapsUrl } from '../shared/map-link.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };
const H = 36e5, D = 24 * H;
const NOW = Date.UTC(2026, 10, 19, 3, 0, 0);            // 2026-11-19 03:00 UTC
const iso = (t) => new Date(t).toISOString();
const day = (t) => iso(t).slice(0, 10);
const allDay = (uid, startDay, endDay, more = {}) => ({ uid, title: uid, start: startDay, end: endDay, allDay: true,
  startsAt: `${startDay}T00:00:00.000Z`, endsAt: `${endDay}T00:00:00.000Z`, location: null, description: null, url: null, ...more });
const timed = (uid, startsAt, endsAt, more = {}) => ({ uid, title: uid, start: iso(startsAt), end: iso(endsAt), allDay: false,
  startsAt: iso(startsAt), endsAt: iso(endsAt), location: null, description: null, url: null, ...more });
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const UNDER_WAY = allDay('season', '2026-11-16', '2026-11-22', { location: 'https://www.example.com/apply/', description: 'Line one\nLine two' });
const SOON = timed('talk', NOW + 5 * H, NOW + 6.5 * H);
const CON = allDay('con', '2026-12-12', '2026-12-14', { location: 'Harbor Hall, Pier 3 & 4' });
const NEXT_YEAR = allDay('later', '2027-02-13', '2027-02-15');
const FEED = { calendar: { name: 'Studio', timeZone: 'Asia/Tokyo' }, events: [UNDER_WAY, CON, SOON, NEXT_YEAR, allDay('over', '2026-11-01', '2026-11-02')] };
// Intl puts thin and narrow no-break spaces in a range; compared as plain spaces.
const sp = (text) => String(text).replace(/\s/g, ' ');
const rows = (opts = {}) => listRows(FEED, { now: NOW, locale: 'en', far: true, ...opts });

ok('what’s-next order: by the moment each counts to — an event under way sorts by its END', () => {
  assert.deepEqual(rows().map((r) => r.uid), ['talk', 'season', 'con', 'later'], 'starts in 5 h, ends in 3 d, starts in 3 wk, next year; the one that is over is not listed');
  assert.deepEqual(rows().map((r) => r.state), ['before', 'during', 'before', 'before']);
});

ok('the date tile is the day the event counts to: first day ahead, LAST day once under way', () => {
  const tiles = Object.fromEntries(rows().map((r) => [r.uid, r.tile]));
  assert.deepEqual(tiles.con, { mo: 'Dec', day: '12' });
  assert.deepEqual(tiles.season, { mo: 'Nov', day: '21' }, 'the end is exclusive: Nov 22 means through the 21st');
  const [item] = upcoming({ events: [allDay('x', '2026-11-30', '2026-12-01')] }, NOW);
  assert.deepEqual(tileParts(item, NOW, 'en'), { mo: 'Nov', day: '30' }, 'a single all-day date is that date in every zone');
  assert.equal(tileParts(item, NOW, 'ja').mo, '11月');
});

ok('the date line: all-day dates as the calendar wrote them; a year only when it is not this one', () => {
  const when = Object.fromEntries(rows().map((r) => [r.uid, sp(r.when)]));
  assert.equal(when.con, 'Dec 12 – 13');
  assert.equal(when.later, 'Feb 13 – 14, 2027');
  assert.equal(when.season, 'Nov 16 – 21');
  assert.equal(sp(whenText(NEXT_YEAR, 'en')), 'Feb 13 – 14', 'without `now` the line is as it was (the countdown’s)');
  assert.match(when.talk, /\d{1,2}:\d{2}/, 'a timed event shows its time');
});

ok('the badge is Intl’s words: how far off, or the browser’s "now"', () => {
  const badge = Object.fromEntries(rows().map((r) => [r.uid, sp(r.badge)]));
  assert.equal(badge.season, 'now');
  assert.equal(badge.talk, 'in 5 hr.');
  assert.equal(badge.con, 'in 3 wk.');
  assert.equal(badge.later, 'in 3 mo.');
  const at = (ms) => sp(badgeText({ startsAt: NOW + ms, endsAt: NOW + ms + H }, NOW, 'en'));
  assert.deepEqual([at(20e3), at(40 * 6e4), at(D), at(2 * D), at(13 * D), at(400 * D)], ['in 1 min.', 'in 40 min.', 'tomorrow', 'in 2 days', 'in 13 days', 'next yr.']);
  assert.equal(badgeText({ startsAt: NOW + D, endsAt: NOW + 2 * D }, NOW, 'ja'), '明日');
  assert.equal(badgeText({ startsAt: NOW - H, endsAt: NOW + H }, NOW, 'de'), 'jetzt');
});

ok('without data-countdown="always" only the coming week and what is under way keep a badge', () => {
  const badge = Object.fromEntries(rows({ far: false }).map((r) => [r.uid, sp(r.badge)]));
  assert.deepEqual([badge.season, badge.talk, badge.con, badge.later], ['now', 'in 5 hr.', '', '']);
});

ok('the location: a URL is a link to it, shown without its scheme; a place is a map', () => {
  const by = Object.fromEntries(rows().map((r) => [r.uid, r]));
  assert.deepEqual([by.season.locationKind, by.season.location, by.season.locationHref], ['url', 'example.com/apply', 'https://www.example.com/apply/']);
  assert.deepEqual([by.con.locationKind, by.con.location, by.con.locationHref], ['place', 'Harbor Hall, Pier 3 & 4', mapsUrl('Harbor Hall, Pier 3 & 4')]);
  assert.deepEqual([by.talk.locationKind, by.talk.locationHref], ['none', '']);
});

ok('add to calendar: the Google link; the feed’s own .ics in Safari on an Apple device when the feed serves one', () => {
  assert.equal(rows().find((r) => r.uid === 'con').addHref, addToCalendarUrl(CON, { descriptionIsText: true }));
  const src = 'https://feed.example/v0/?cal=x';
  const apple = (feed) => listRows(feed, { now: NOW, locale: 'en', userAgent: SAFARI_IOS, feedSrc: src }).find((r) => r.uid === 'season').addHref;
  assert.equal(new URL(apple({ ...FEED, ics: true })).searchParams.get('ics'), 'season');
  assert.match(apple(FEED), /^https:\/\/calendar\.google\.com\//, 'a feed that does not say so keeps the Google link');
});

ok('how many rows: data-show, else the feed address’s show=, else the default; never past the cap', () => {
  assert.equal(showCount(null, 'https://f.example/v0/?cal=x&show=6'), 6);
  assert.equal(showCount('2', 'https://f.example/v0/?cal=x&show=6'), 2);
  assert.equal(showCount('', '/events.json'), LIST_DEFAULT);
  assert.equal(showCount('999', ''), LIST_MAX);
  assert.equal(showCount('0', '?show=-3'), LIST_DEFAULT);
  assert.equal(showCount('abc', 'not a url ?show=4'), 4);
  assert.equal(rows({ show: 2 }).length, 2);
});

ok('markup: three doors to add-to-calendar per row, one of them for a screen reader', () => {
  const html = renderRows(rows());
  const first = html.slice(html.indexOf('<li'), html.indexOf('</li>'));
  const add = addToCalendarUrl(SOON, { descriptionIsText: true }).replace(/&/g, '&amp;');
  assert.equal(first.split(`href="${add}"`).length - 1, 3, 'tile, date line, badge');
  assert.equal(first.split('aria-hidden="true" tabindex="-1"').length - 1, 2, 'tile and badge are extra doors, not extra announcements');
  assert.match(first, /class="dc-ev-line dc-ev-when"[^>]*aria-label="Add to calendar: [^"]+"/);
  assert.equal(html.split('<li class="dc-ev-item"').length - 1, 4);
  assert.match(html, /<li class="dc-ev-item" data-state="during">/);
});

ok('markup: the title links where the location goes; no location, no link', () => {
  const html = renderRows(rows());
  assert.match(html, /<a class="dc-ev-title" href="https:\/\/www\.example\.com\/apply\/"[^>]*>season<\/a>/);
  assert.match(html, /<span class="dc-ev-title">talk<\/span>/);
  assert.match(html, /class="dc-ev-line dc-ev-loc"[^>]*>.*?<span>example\.com\/apply<\/span>/);
  assert.match(html, /<p class="dc-ev-line dc-ev-desc">.*?<span>Line one\nLine two<\/span><\/p>/s, 'the description whole, its line break kept');
});

ok('every value from the feed is escaped, and nothing but http(s) or a map becomes an href', () => {
  const evil = allDay('x', '2026-12-01', '2026-12-02', { title: '<img src=x onerror=1>"\'&', location: 'javascript:alert(1)', description: '</p><script>alert(1)</script>' });
  const html = renderRows(listRows({ events: [evil] }, { now: NOW, locale: 'en', far: true }));
  assert.ok(!/<img|<script|onerror=1>/.test(html));
  assert.ok(html.includes('&lt;img src=x onerror=1&gt;&quot;&#39;&amp;'));
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes(`href="${mapsUrl('javascript:alert(1)').replace(/&/g, '&amp;')}"`), 'searched for on a map, never navigated to');
  // the same title on a row with NO location takes the other branch (a span, not a link)
  const bare = renderRows(listRows({ events: [{ ...evil, location: null }] }, { now: NOW, locale: 'en', far: true }));
  assert.ok(!/<img|onerror=1>/.test(bare));
  assert.ok(bare.includes('<span class="dc-ev-title">&lt;img src=x onerror=1&gt;&quot;&#39;&amp;</span>'));
  // and each remaining text slot on its own: when-less values cannot occur, so location text and badge
  const place = renderRows([{ uid: 'p', state: 'before', title: 't', when: '<w>', tile: { mo: '<m>', day: '<d>' }, badge: '<b>', location: '<l>', locationKind: 'place', locationHref: '', description: '', addHref: '' }]);
  assert.ok(!/<(w|m|d|b|l)>/.test(place), 'when, tile, badge and location text are escaped with or without links');
});

ok('an empty list says what the site wrote, escaped', () => {
  assert.equal(renderRows([], { empty: 'Nothing <yet>' }), '<div class="dc-ev--empty">Nothing &lt;yet&gt;</div>');
  assert.equal(renderRows(listRows({ events: [] }, { now: NOW })), '<div class="dc-ev--empty">No upcoming events.</div>');
  assert.deepEqual(listRows(null, { now: NOW }), []);
});

ok('rowsShape: the same rows a minute later differ only in badge words; a start or an end changes the shape', () => {
  const feed = { events: [timed('a', NOW + 40 * 6e4, NOW + 2 * H), CON] };
  const at = (t) => listRows(feed, { now: t, locale: 'en', far: true });
  assert.equal(rowsShape(at(NOW)), rowsShape(at(NOW + 6e4)));
  assert.notEqual(at(NOW)[0].badge, at(NOW + 6e4)[0].badge);
  assert.notEqual(rowsShape(at(NOW)), rowsShape(at(NOW + 41 * 6e4)), 'it started');
  assert.notEqual(rowsShape(at(NOW)), rowsShape(at(NOW + 3 * H)), 'it ended');
});

console.log(`\nevents-list: ${n} passed`);
