// node packages/dynamic-corals/events/events-worker.test.mjs
// The worker's `ics=<uid>` route against a stubbed calendar: the real handler, the real parser.
import assert from 'node:assert/strict';
import worker from './events-worker.mjs';
import { parseICal } from './ical.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('PASS ' + name); };
const far = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const CAL = ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Studio events', 'X-WR-TIMEZONE:Asia/Tokyo',
  'BEGIN:VEVENT', 'UID:open@google.com', 'SUMMARY:Applications open\\, cohort 6', `DTSTART;VALUE=DATE:${far(-5)}`, `DTEND;VALUE=DATE:${far(20)}`, 'LOCATION:https://example.com/apply', 'DESCRIPTION:Closes when full\\nSecond line', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:gone@google.com', 'SUMMARY:Gone', `DTSTART;VALUE=DATE:${far(-30)}`, `DTEND;VALUE=DATE:${far(-29)}`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:off@google.com', 'SUMMARY:Called off', 'STATUS:CANCELLED', `DTSTART;VALUE=DATE:${far(3)}`, `DTEND;VALUE=DATE:${far(4)}`, 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const SRC = 'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics';
const realFetch = globalThis.fetch;
let asked = [];
globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(CAL, { status: 200 }); };
const get = (qs) => worker.fetch(new Request('https://w.example/v0/?' + qs));
const q = (o) => new URLSearchParams(o).toString();

await ok('the feed says it serves an event as a file', async () => {
  const body = await (await get(q({ cal: SRC }))).json();
  assert.equal(body.ics, true);
  assert.deepEqual(body.events.map((e) => e.uid), ['open@google.com']);
});

await ok('ics=<uid> answers that event as text/calendar, readable by this repo\'s own parser', async () => {
  const res = await get(q({ cal: SRC, ics: 'open@google.com' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^inline; filename="event\.ics"$/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const text = await res.text();
  const [back, ...rest] = parseICal(text, 'x');
  assert.equal(rest.length, 0, 'one event, not the calendar');
  assert.equal(back.uid, 'open@google.com');
  assert.equal(back.title, 'Applications open, cohort 6');
  assert.equal(back.allDay, true);
  assert.equal(back.location, 'https://example.com/apply');
  assert.equal(back.description, 'Closes when full\nSecond line');
  assert.ok(!text.includes('Gone') && !text.includes('Called off'));
});

await ok('an event that is over, cancelled or unknown is a 404 in JSON, not a file', async () => {
  for (const uid of ['gone@google.com', 'off@google.com', 'nobody', '']) {
    const res = await get(q({ cal: SRC, ics: uid }));
    assert.equal(res.status, 404, uid);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await res.json(), { error: 'no_such_event' });
  }
});

await ok('the calendar guard comes first: ics does not widen what the worker will fetch', async () => {
  asked = [];
  const res = await get(q({ cal: 'https://169.254.169.254/latest/meta-data/', ics: 'open@google.com' }));
  assert.equal(res.status, 400);
  assert.deepEqual(asked, [], 'nothing was fetched');
});

globalThis.fetch = realFetch;
console.log(`\nevents-worker: ${n} passed`);
