// The events list in a real browser: the BUILT events.js drawing a feed's `events` — layout at phone
// widths, the three add-to-calendar doors, what a keyboard reaches, Intl's words in the page's
// language, and the three feeds that are not a calendar as data (empty, `html` only, unreachable).
// The node tests state the rules; here the browser's own Intl, layout and fetch apply them.
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/events/events-list.smoke.mjs http://127.0.0.1:8749/packages/dynamic-corals/events/
//
// The argument is the base URL of this directory; events.js is read from it. EVENTS_LIST_SRC=<path>
// reads events.js from that file instead (for a mutation run). Chromium only. Exits 1 on any failure.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;
const base = process.argv[2];
if (!base) throw new Error('usage: node events-list.smoke.mjs <url of packages/dynamic-corals/events/>');
const { readFileSync } = await import('node:fs');
const SRC = process.env.EVENTS_LIST_SRC
  ? readFileSync(process.env.EVENTS_LIST_SRC, 'utf8')
  : await (async () => {
    const r = await fetch(new URL('events.js', base), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`events.js: HTTP ${r.status}`);
    return r.text();
  })();

const results = [];
const failures = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

const now = Date.now(), H = 36e5, D = 24 * H;
const iso = (t) => new Date(t).toISOString(), day = (t) => iso(t).slice(0, 10);
const FEED = { ics: true, calendar: { name: 'Stress', timeZone: 'Asia/Tokyo' }, events: [
  { uid: 'under-way', title: 'Under way', start: day(now - 2 * D), end: day(now + 3 * D), allDay: true, startsAt: iso(now - 2 * D), endsAt: iso(now + 3 * D), location: 'https://www.example.com/a/very/long/path/that/keeps/going/and/going/registration?utm_source=calendar&utm_medium=feed', description: 'Closes when full' },
  { uid: 'soon', title: 'Busy', start: iso(now + 5 * H), end: iso(now + 6.5 * H), allDay: false, startsAt: iso(now + 5 * H), endsAt: iso(now + 6.5 * H), location: null, description: null },
  { uid: 'long', title: 'Donaudampfschifffahrtsgesellschaftskapitänsversammlung und Jahreshauptversammlung der Mitglieder', start: iso(now + 2 * D), end: iso(now + 2 * D + 3 * H), allDay: false, startsAt: iso(now + 2 * D), endsAt: iso(now + 2 * D + 3 * H), location: 'Exhibition Centre West Hall 4F, 3 Chome-11-1 Ariake, Koto City, Tokyo 135-0063', description: 'Line one\nLine two\nA third, much longer line that is there to see the whole description shown https://example.com/x' },
  { uid: 'markup', title: '<b>bold?</b> & "quotes"', start: day(now + 40 * D), end: day(now + 41 * D), allDay: true, startsAt: iso(now + 40 * D), endsAt: iso(now + 41 * D), location: null, description: null },
  { uid: 'far', title: 'Next year', start: day(now + 400 * D), end: day(now + 403 * D), allDay: true, startsAt: iso(now + 400 * D), endsAt: iso(now + 403 * D), location: 'Harbor Hall', description: null },
] };
const LEGACY = { html: '<ul class="dc-ev-list"><li class="dc-ev-item"><div class="dc-ev-body"><div class="dc-ev-main"><span class="dc-ev-title">From a static feed</span><span class="dc-ev-cd" data-start="2999-01-01" data-end=""></span></div></div></li></ul>' };
// The default is pinned: the map link and the .ics link both go by platform, and the browser's own
// user agent is whatever machine this runs on.
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const page = (lang, src, extra = 'data-countdown="always"', css = '', column = 0) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif}${css}</style></head><body><div${column ? ` style="width:${column}px"` : ''}><div data-dynamic-coral="events" data-src="${src}" data-empty="Nothing right now." ${extra}></div></div></body></html>`;

const browser = await lib.chromium.launch();
async function open({ lang = 'en', src = '/feed.json', width = 1280, userAgent = DESKTOP, extra = 'data-countdown="always"', css = '', column = 0 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Taipei', userAgent });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route('http://events.test/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/feed.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(FEED) });
    if (path === '/empty.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [] }) });
    if (path === '/legacy.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(LEGACY) });
    if (path === '/down.json') return r.fulfill({ status: 503, body: 'no' });
    return r.fulfill({ contentType: 'text/html', body: page(lang, src, extra, css, column) });
  });
  await p.goto('http://events.test/');
  await p.addScriptTag({ content: SRC });
  await p.waitForFunction(() => document.querySelector('[data-dynamic-coral="events"]').children.length > 0);
  const state = await p.evaluate(() => {
    const root = document.querySelector('[data-dynamic-coral="events"]');
    const items = [...root.querySelectorAll('.dc-ev-item')];
    const doors = (item) => [...item.querySelectorAll('a')].filter((a) => /calendar\.google\.com|[?&]ics=/.test(a.href));
    return {
      live: !!root.querySelector('.dc-ev-list--live'), uids: items.map((i) => i.querySelector('.dc-ev-title').textContent), states: items.map((i) => i.getAttribute('data-state')),
      overflowX: document.documentElement.scrollWidth > innerWidth, widest: Math.max(0, ...items.map((i) => Math.round(i.getBoundingClientRect().right))), viewport: innerWidth,
      badges: items.map((i) => (i.querySelector('.dc-ev-cd') || {}).textContent || ''), whens: items.map((i) => (i.querySelector('.dc-ev-when') || {}).textContent || ''),
      doors: items.map((i) => doors(i).map((a) => (/[?&]ics=/.test(a.href) ? 'ics' : 'google'))), doorsReached: items.map((i) => doors(i).filter((a) => a.tabIndex >= 0 && a.getAttribute('aria-hidden') !== 'true').length),
      titleLinks: items.map((i) => (i.querySelector('a.dc-ev-title') || {}).href || ''), tags: root.querySelectorAll('b, script, img').length,
      badgeFilled: items.map((i) => { const b = i.querySelector('.dc-ev-cd'); return b ? getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)' : null; }),
      descriptionLines: (() => { const d = root.querySelector('.dc-ev-desc > span'); return d ? Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight)) : 0; })(),
      empty: (root.querySelector('.dc-ev--empty') || {}).textContent || null,
      tiles: items.map((i) => {
        const tile = i.querySelector('.dc-ev-cal'), face = i.querySelector('.dc-ev-cal-face');
        if (!tile || !face) return null;
        const t = tile.getBoundingClientRect(), f = face.getBoundingClientRect();
        const top = face.firstElementChild.getBoundingClientRect().top - f.top, bottom = f.bottom - face.lastElementChild.getBoundingClientRect().bottom;
        const bar = tile.querySelector('.dc-ev-cal-mo').getBoundingClientRect();
        return { size: Math.round(t.width), square: Math.abs(t.width - t.height) <= 1, offCentre: Math.abs(top - bottom), faceShare: Math.round(100 * f.height / (t.bottom - bar.bottom)) / 100, fits: face.scrollHeight <= face.clientHeight + 1 && top >= 0 && bottom >= 0, flush: Math.abs(bar.left - t.left) < 0.01 && Math.abs(bar.right - t.right) < 0.01 && Math.abs(bar.top - t.top) < 0.01 && parseFloat(getComputedStyle(tile).borderTopWidth) === 0, ring: getComputedStyle(tile, '::after').boxShadow !== 'none', text: [...tile.querySelectorAll('span > span, .dc-ev-cal-mo')].map((x) => x.textContent).join('/') };
      }),
      tileBackground: root.querySelector('.dc-ev-cal') ? getComputedStyle(root.querySelector('.dc-ev-cal')).backgroundColor : null,
      dayColour: root.querySelector('.dc-ev-cal-day') ? getComputedStyle(root.querySelector('.dc-ev-cal-day')).color : null, bodyColour: getComputedStyle(document.body).color,
    };
  });
  await ctx.close();
  return { ...state, errors };
}

// ── 1: the list as drawn from the calendar as data ───────────────────────────────────────────────
{
  const s = await open({});
  check('a feed with `events` is drawn in the browser, in what’s-next order', s.live && s.uids.join('|') === 'Busy|Donaudampfschifffahrtsgesellschaftskapitänsversammlung und Jahreshauptversammlung der Mitglieder|Under way|<b>bold?</b> & "quotes"|Next year', JSON.stringify(s.uids));
  check('the event under way is marked so, and only its badge is filled', s.states.join() === 'before,before,during,before,before' && s.badgeFilled.join() === 'false,false,true,false,false', JSON.stringify([s.states, s.badgeFilled]));
  check('each row has three doors to add-to-calendar and a keyboard reaches one', s.doors.every((d) => d.length === 3) && s.doorsReached.every((n) => n === 1), JSON.stringify([s.doors, s.doorsReached]));
  check('the title links where the location goes; a row with no location has no title link', /^https:\/\/www\.example\.com\//.test(s.titleLinks[2]) && /google\.com\/maps/.test(s.titleLinks[1]) && s.titleLinks[0] === '', JSON.stringify(s.titleLinks));
  check('markup in a title is text', s.tags === 0, `${s.tags} element(s) from the feed`);
  check('a description keeps its lines and is shown whole', s.descriptionLines >= 3, `${s.descriptionLines} line(s)`);
  check('badges are Intl’s words', s.badges[2] === 'now' && /^in 5 hr/.test(s.badges[0]) && /yr|year/.test(s.badges[4]), JSON.stringify(s.badges));
  // the row under way runs from two days ago to two days ahead: over New Year those are two years
  const sameYear = new Date(now - 2 * D).getUTCFullYear() === new Date(now + 2 * D).getUTCFullYear() && new Date(now - 2 * D).getUTCFullYear() === new Date(now).getFullYear();
  check('a date in another year carries its year', /\d{4}/.test(s.whens[4]) && /\d{4}/.test(s.whens[2]) === !sameYear, JSON.stringify(s.whens));
  check('the tile is a square with the month as a bar, weekday and day centred in the face under it', s.tiles.every((t) => t && t.square && t.fits && t.offCentre <= 1 && t.faceShare >= 0.9 && t.faceShare <= 0.99), JSON.stringify(s.tiles));
  // A bar clipped inside a real border leaves a hairline of the face showing between the two curves on a phone screen.
  check('the month bar runs to the very edge of the tile, under an outline painted over it (no border to leave a seam)', s.tiles.every((t) => t && t.flush && t.ring), JSON.stringify(s.tiles));
  check('on a page with no theme the tile, now a link, keeps the page’s text colour', s.dayColour === s.bodyColour, `${s.dayColour} vs ${s.bodyColour}`);
  check('no script error', s.errors.length === 0, s.errors.join(' | '));
}

// ── 2: phone widths, other languages — nothing wider than the screen ─────────────────────────────
for (const [lang, width] of [['zh-Hant', 390], ['de', 340], ['ja', 320]]) {
  const s = await open({ lang, width });
  check(`${lang} at ${width}px: no row is wider than the viewport`, !s.overflowX && s.widest <= s.viewport, `widest ${s.widest} of ${s.viewport}`);
  check(`${lang} at ${width}px: every tile is square and its weekday and day fit, centred`, s.tiles.every((t) => t && t.square && t.fits && t.offCentre <= 1), JSON.stringify(s.tiles));
}
{
  const s = await open({ lang: 'en_US' });
  check('a page language Intl refuses still gets dates, tiles and badges', s.whens.every(Boolean) && s.badges.every(Boolean) && s.tiles.every((t) => t && /\S\/\S+\/\S/.test(t.text)), JSON.stringify([s.whens, s.badges, s.tiles.map((t) => t && t.text)]));
}
{
  const s = await open({ lang: 'ja' });
  check('the page’s language decides the words (ja)', s.badges[2] === '今' || s.badges[2] === '現在', JSON.stringify(s.badges));
}

// ── 2b: the tile is sized from itself, and guesses no colour ─────────────────────────────────────
{
  // a 280px column on a 1280px screen: the tile is as small as on a phone, and the viewport says "desktop"
  const s = await open({ column: 280 });
  check('in a narrow column on a wide screen the tile is small and its weekday and day still fit, centred', s.tiles.every((t) => t && t.size <= 64 && t.square && t.fits && t.offCentre <= 1), JSON.stringify(s.tiles));
}
{
  const s = await open({});
  check('with no theme tokens the tile takes no background of its own', s.tileBackground === 'rgba(0, 0, 0, 0)', s.tileBackground);
  const dark = await open({ css: 'body{background:#111;color:#eee}' });
  check('so on a dark page with no tokens the day is the page’s light text on the page’s dark ground', dark.tileBackground === 'rgba(0, 0, 0, 0)' && dark.dayColour === 'rgb(238, 238, 238)', JSON.stringify([dark.tileBackground, dark.dayColour]));
  const themed = await open({ css: ':root{--gd-bg:#14161a;--gd-text:#e9edf2}' });
  check('and where the host names its background, the tile’s face is that', themed.tileBackground === 'rgb(20, 22, 26)' && themed.dayColour === 'rgb(233, 237, 242)', JSON.stringify([themed.tileBackground, themed.dayColour]));
}
{
  // far-off badges asked for in the feed address alone, the way a pasted worker URL does
  const without = await open({ extra: '' });
  const inAddress = await open({ extra: '', src: '/feed.json?countdown=always' });
  check('countdown=always in the feed address keeps the far-off badges; without either, they are gone', without.badges[4] === '' && inAddress.badges[4] !== '', JSON.stringify([without.badges, inAddress.badges]));
}

// ── 3: add to calendar is the feed’s .ics in Safari on an Apple device ───────────────────────────
{
  const s = await open({ userAgent: SAFARI_IOS, width: 390, extra: 'data-countdown="always" data-show="2"' });
  check('data-show limits the rows', s.uids.length === 2, String(s.uids.length));
  check('in Safari on iOS, with a feed that serves it, all three doors are the .ics file', s.doors.every((d) => d.join() === 'ics,ics,ics'), JSON.stringify(s.doors));
}

// ── 4: the feeds that are not a calendar as data ─────────────────────────────────────────────────
{
  let s = await open({ src: '/empty.json' });
  check('an empty calendar says what the site wrote', s.empty === 'Nothing right now.' && !s.live, JSON.stringify(s));
  s = await open({ src: '/down.json' });
  check('an unreachable feed says the same', s.empty === 'Nothing right now.', JSON.stringify(s.empty));
  s = await open({ src: '/legacy.json' });
  check('a feed with only `html` is shown as it came, its countdown ticking as before', !s.live && s.uids.join() === 'From a static feed' && /^in \d+mo$/.test(s.badges[0]), JSON.stringify([s.uids, s.badges]));
}

await browser.close();
console.log(results.join('\n'));
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n` + failures.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log(`\nevents-list: ${results.length} passed`);
