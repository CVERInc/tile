// node packages/dynamic-corals/events/ics-file.test.mjs
import assert from 'node:assert/strict';
import { eventIcs, icsText, foldLine, icsUrl, opensIcs } from './ics-file.mjs';
import { parseICal } from './ical.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

ok('text escaping: backslash first, then ; , and newlines', () => {
  // spelled with String.raw so that what is compared is the file's own characters
  assert.equal(icsText('a\\b; c, d\ne\r\nf'), String.raw`a\\b\; c\, d\ne\nf`);
  assert.equal(icsText('x;y'), String.raw`x\;y`);
  assert.equal(icsText('x;y').length, 4, 'a semicolon becomes two characters');
  assert.equal(icsText(null), '');
});

ok('folding: every physical line is at most 75 octets and no UTF-8 sequence is cut', () => {
  const line = 'DESCRIPTION:' + '定員に達し次第終了。'.repeat(20);
  const folded = foldLine(line);
  const physical = folded.split('\r\n');
  assert.ok(physical.length > 1);
  for (const p of physical) assert.ok(new TextEncoder().encode(p).length <= 75, `${new TextEncoder().encode(p).length} octets`);
  for (const p of physical.slice(1)) assert.equal(p[0], ' ');
  assert.equal(physical.map((p, i) => (i ? p.slice(1) : p)).join(''), line, 'unfolding gives the line back');
  assert.ok(!folded.includes('�'), 'no replacement character: nothing was cut mid-sequence');
  assert.equal(foldLine('SUMMARY:short'), 'SUMMARY:short');
});

const allDay = { uid: 'a1@example.com', title: '秋の講座｜募集中', start: '2026-10-12', end: '2026-12-02', allDay: true, startsAt: '2026-10-11T15:00:00.000Z', endsAt: '2026-12-01T15:00:00.000Z', location: 'https://www.example.com/apply', description: '定員に達し次第終了', url: null };
const timed = { uid: 't1@example.com', title: 'Panel; Q&A, signing', start: '2026-11-20T19:00:00', end: '2026-11-20T20:30:00', allDay: false, startsAt: '2026-11-20T10:00:00.000Z', endsAt: '2026-11-20T11:30:00.000Z', location: 'Hall 4, Tokyo', description: 'Line one\nLine two', url: 'https://example.com/e' };

ok('an all-day event keeps its dates, end exclusive, and no time or zone', () => {
  const ics = eventIcs(allDay, { now: NOW });
  assert.ok(ics.includes('\r\nDTSTART;VALUE=DATE:20261012\r\n'));
  assert.ok(ics.includes('\r\nDTEND;VALUE=DATE:20261202\r\n'));
  assert.ok(!/DTSTART:\d/.test(ics));
  assert.ok(ics.includes('\r\nDTSTAMP:20261118T120000Z\r\n'));
});

ok('a single all-day date with no end ends the next day (month and year roll over)', () => {
  assert.ok(eventIcs({ ...allDay, start: '2026-12-31', end: null }, { now: NOW }).includes('DTEND;VALUE=DATE:20270101'));
  assert.ok(eventIcs({ ...allDay, start: '2028-02-28', end: '2028-02-28' }, { now: NOW }).includes('DTEND;VALUE=DATE:20280229'), 'an end that is not after the start is not kept');
});

ok('a timed event is its exact instants in UTC, not its wall clock', () => {
  const ics = eventIcs(timed, { now: NOW });
  assert.ok(ics.includes('\r\nDTSTART:20261120T100000Z\r\n'));
  assert.ok(ics.includes('\r\nDTEND:20261120T113000Z\r\n'));
  assert.ok(!ics.includes('190000'), 'the wall-clock start is not what is written');
  assert.ok(ics.includes('\r\n' + String.raw`SUMMARY:Panel\; Q&A\, signing` + '\r\n'));
  assert.ok(ics.includes('\r\nDESCRIPTION:Line one\\nLine two\r\n'));
  assert.ok(ics.includes('\r\nURL:https://example.com/e\r\n'));
});

ok('the file is one VEVENT in one VCALENDAR, CRLF throughout, and ends with CRLF', () => {
  const ics = eventIcs(timed, { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
  assert.equal(ics.split('BEGIN:VEVENT').length, 2);
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF');
});

ok('what cannot be stated is no file: no uid, no readable start', () => {
  assert.equal(eventIcs({ ...timed, uid: null }, { now: NOW }), '');
  assert.equal(eventIcs({ ...timed, startsAt: null }, { now: NOW }), '');
  assert.equal(eventIcs({ ...allDay, start: 'soon' }, { now: NOW }), '');
  assert.equal(eventIcs(null), '');
});

ok('a URL that is not http(s) is not written; third-party text cannot add a property', () => {
  const ics = eventIcs({ ...timed, url: 'javascript:alert(1)', title: 'x\r\nATTENDEE:mailto:a@b.c', location: 'y\nORGANIZER:z' }, { now: NOW });
  assert.ok(!ics.includes('URL:'));
  assert.ok(!/\r\nATTENDEE:/.test(ics) && !/\r\nORGANIZER:/.test(ics), 'a newline in text stays inside the value');
});

ok('round trip: this repo\'s own parser reads the file back as the same event', () => {
  for (const ev of [allDay, timed]) {
    const [back] = parseICal(eventIcs(ev, { now: NOW }), 'x');
    assert.equal(back.title, ev.title);
    assert.equal(back.uid, ev.uid);
    assert.equal(back.allDay, ev.allDay);
    assert.equal(back.location, ev.location);
    assert.equal(back.description, ev.description);
    if (ev.allDay) { assert.equal(back.start, ev.start); assert.equal(back.end, ev.end); }
    else { assert.equal(Date.parse(back.start), Date.parse(ev.startsAt)); assert.equal(Date.parse(back.end), Date.parse(ev.endsAt)); }
  }
});

ok('control characters are not text: dropped, a tab kept', () => {
  assert.equal(icsText('a\u0000b\tc\u0007d\u007Fe\u001Bf'), 'ab\tcdef');
  const ics = eventIcs({ ...timed, title: 'A\u0000B', uid: 'u\u0001v' }, { now: NOW });
  assert.ok(ics.includes('\r\nSUMMARY:AB\r\n') && ics.includes('\r\nUID:uv\r\n'));
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(ics));
});

ok('opensIcs: Safari on an Apple device, and nothing else', () => {
  const yes = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  ];
  const no = [
    '',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.16.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ];
  for (const ua of yes) assert.equal(opensIcs(ua), true, ua);
  for (const ua of no) assert.equal(opensIcs(ua), false, ua);
});

ok('icsUrl: the feed\'s own address plus the uid, encoded; nothing for a relative or odd address', () => {
  const src = 'https://events-coral.example/v0/?cal=https%3A%2F%2Fcalendar.google.com%2Fx.ics&show=6';
  const u = new URL(icsUrl(src, 'a b+c@example.com'));
  assert.equal(u.searchParams.get('ics'), 'a b+c@example.com');
  assert.equal(u.searchParams.get('cal'), 'https://calendar.google.com/x.ics');
  assert.equal(u.searchParams.get('show'), '6');
  assert.equal(icsUrl(src, ''), '');
  assert.equal(icsUrl('/events.json', 'u'), '');
  assert.equal(icsUrl('javascript:alert(1)', 'u'), '');
});

console.log(`\nics-file: ${n} passed`);
