// The same-origin inbox forwarder's two input bounds (Refs CVERInc/tile-lab#64):
//   · `page_url` is always a URL on the site's OWN origin, whatever `return_to` was posted;
//   · an oversize submission is refused before it is parsed or forwarded — by its declared
//     Content-Length, by a hard cap while reading when that header is absent or wrong, and by a
//     cap on how many fields it carries and how long each name and value is.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'inbox-forward-bounds-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const out = join(dir, 'worker.mjs');
const env = { ...process.env };
delete env.INBOX_FORWARD_SITE_KEY;
const emitted = spawnSync(process.execPath, [
	new URL('./emit-shop-function.mjs', import.meta.url).pathname,
	'--site-id', 'bounds-site', '--platform-origin', 'https://platform.example', '--out', out,
], { encoding: 'utf8', env });
assert.equal(emitted.status, 0, 'worker emission succeeds');
const worker = (await import(pathToFileURL(out))).default;

const ORIGIN = 'https://site.example';
// The limits under test, restated here on purpose: a change to one in the template has to be made
// twice, once where it acts and once where it is promised.
const MAX_BODY_BYTES = 1048576;
const MAX_FIELDS = 100;
const MAX_NAME_CHARS = 256;
const MAX_VALUE_CHARS = 32768;

async function post(t, init) {
	const calls = [];
	t.mock.method(globalThis, 'fetch', async (url, opts) => {
		calls.push({ url, payload: JSON.parse(opts.body) });
		return new Response('{}');
	});
	const response = await worker.fetch(new Request(ORIGIN + '/__reef/inbox', { method: 'POST', ...init }), {});
	return { response, location: response.headers.get('location'), calls, payload: calls[0] && calls[0].payload };
}

// ── page_url ────────────────────────────────────────────────────────────────────────────────

const HOSTILE_RETURN_TO = [
	'.evil.example/login',        // glued on as a longer host name
	'@evil.example/x',            // turns the site's host into userinfo
	'//evil.example',             // network-path reference
	'/\\evil.example',            // the same, second slash spelled as a backslash
	'\\\\evil.example',
	'\\/evil.example',
	':8443/x',                    // glued on as a port
	'/\t/evil.example',           // a tab the URL parser drops
	'/\n/evil.example',
	'/\r/evil.example',
	'/./\t/evil.example',         // admitted by the raw-string gate; resolves to a `//` path
	'/.//evil.example',
	'/%2e//evil.example',
	'https://evil.example/collect',
	'javascript:alert(1)',
	'/../../evil',
	'/\u0000evil.example',
	'\u0001//evil.example',
	' //evil.example',
	'evil.example',
];

test('page_url is on the site\'s own origin for every hostile return_to', async (t) => {
	for (const returnTo of HOSTILE_RETURN_TO) {
		const { payload } = await post(t, { body: new URLSearchParams({ Name: 'A visitor', return_to: returnTo }) });
		assert.ok(payload, 'forwarded: ' + JSON.stringify(returnTo));
		const url = new URL(payload.page_url);
		assert.equal(url.origin, ORIGIN, JSON.stringify(returnTo) + ' → ' + payload.page_url);
		assert.equal(url.username + url.password, '', 'no userinfo: ' + payload.page_url);
		assert.ok(payload.page_url.startsWith(ORIGIN + '/'), 'the origin is followed by a path: ' + payload.page_url);
		assert.ok(!url.pathname.startsWith('//'), 'not a network-path lookalike: ' + payload.page_url);
	}
});

test('a return_to that is not a path on this site yields the site root, never the posted text', async (t) => {
	for (const returnTo of ['.evil.example/login', '@evil.example/x', '//evil.example', '/\\evil.example', '/./\t/evil.example', '']) {
		const { payload } = await post(t, { body: new URLSearchParams({ Name: 'A visitor', return_to: returnTo }) });
		assert.equal(payload.page_url, ORIGIN + '/', JSON.stringify(returnTo));
	}
	const { payload } = await post(t, { body: new URLSearchParams({ Name: 'A visitor' }) });
	assert.equal(payload.page_url, ORIGIN + '/', 'no return_to at all');
});

test('a real site-relative return_to still names its own page, query and fragment kept', async (t) => {
	for (const [returnTo, expected] of [
		['/contact/', ORIGIN + '/contact/'],
		['/contact?ref=mail#form', ORIGIN + '/contact?ref=mail#form'],
		['/zh-TW/聯絡/', ORIGIN + '/zh-TW/%E8%81%AF%E7%B5%A1/'],
	]) {
		const { payload, location } = await post(t, { body: new URLSearchParams({ Name: 'A visitor', return_to: returnTo }) });
		assert.equal(payload.page_url, expected);
		assert.ok(location.includes('inbox=sent'), location);
	}
});

test('a same-origin Referer is still the page_url; a foreign one is not', async (t) => {
	const own = await post(t, {
		body: new URLSearchParams({ Name: 'A visitor', return_to: '/contact/' }),
		headers: { referer: ORIGIN + '/contact/?ref=mail' },
	});
	assert.equal(own.payload.page_url, ORIGIN + '/contact/?ref=mail');
	const foreign = await post(t, {
		body: new URLSearchParams({ Name: 'A visitor', return_to: '@evil.example/x' }),
		headers: { referer: 'https://evil.example/autosubmit' },
	});
	assert.equal(foreign.payload.page_url, ORIGIN + '/');
});

// ── size ────────────────────────────────────────────────────────────────────────────────────

// A body that hands out 64 KiB chunks for as long as it is asked, and counts how many it was
// asked for — the count is the measurement: a forwarder that stops reading stops asking.
function endlessBody(limitChunks) {
	const chunk = new Uint8Array(65536).fill(97);
	const seen = { pulled: 0, cancelled: false };
	const stream = new ReadableStream({
		pull(controller) {
			if (seen.pulled >= limitChunks) { controller.close(); return; }
			seen.pulled += 1;
			controller.enqueue(chunk);
		},
		cancel() { seen.cancelled = true; },
	}, { highWaterMark: 0 });
	return { stream, seen };
}
const FORM = 'application/x-www-form-urlencoded';

test('a declared Content-Length over the cap is refused without reading the body', async (t) => {
	const { stream, seen } = endlessBody(512);
	const { response, location, calls } = await post(t, {
		body: stream, duplex: 'half',
		headers: { 'content-type': FORM, 'content-length': String(MAX_BODY_BYTES + 1), referer: ORIGIN + '/contact/?ref=mail' },
	});
	assert.equal(response.status, 303);
	assert.equal(location, '/contact/?ref=mail&inbox=too_long', 'back to the page it came from, with the existing too_long outcome');
	assert.equal(seen.pulled, 0, 'not one chunk was read');
	assert.equal(calls.length, 0, 'nothing was forwarded');
});

test('a body over the cap with no Content-Length, or a false one, stops being read at the cap', async (t) => {
	for (const headers of [{ 'content-type': FORM }, { 'content-type': FORM, 'content-length': '12' }]) {
		const { stream, seen } = endlessBody(512);   // 32 MiB on offer
		const { response, location, calls } = await post(t, { body: stream, duplex: 'half', headers });
		assert.equal(response.status, 303);
		assert.equal(location, '/?inbox=too_long');
		assert.ok(seen.pulled * 65536 <= MAX_BODY_BYTES + 2 * 65536, 'read at most the cap plus a chunk in flight, read ' + seen.pulled + ' chunks');
		assert.ok(seen.cancelled, 'the rest of the body was cancelled, not drained');
		assert.equal(calls.length, 0, 'nothing was forwarded');
	}
});

test('a multipart body over the cap (a file upload) is refused the same way', async (t) => {
	const data = new FormData();
	data.set('return_to', '/contact/');
	data.set('Message', 'hello');
	data.set('upload', new Blob([new Uint8Array(MAX_BODY_BYTES + 1)]), 'big.bin');
	const { location, calls } = await post(t, { body: data });
	assert.equal(location, '/?inbox=too_long');
	assert.equal(calls.length, 0);
});

test('more fields than the cap, or a name or value longer than its cap, is refused and not forwarded', async (t) => {
	const tooMany = new URLSearchParams({ return_to: '/contact/' });
	for (let i = 0; i < MAX_FIELDS; i += 1) tooMany.append('f' + i, 'x');
	const longValue = new URLSearchParams({ return_to: '/contact/', Message: 'x'.repeat(MAX_VALUE_CHARS + 1) });
	const longName = new URLSearchParams({ return_to: '/contact/', ['n'.repeat(MAX_NAME_CHARS + 1)]: 'x' });
	const repeated = new URLSearchParams({ return_to: '/contact/' });
	for (let i = 0; i < MAX_FIELDS; i += 1) repeated.append('Message', 'x');
	for (const [label, body] of [['too many', tooMany], ['long value', longValue], ['long name', longName], ['one name repeated', repeated]]) {
		const { response, location, calls } = await post(t, { body });
		assert.equal(response.status, 303, label);
		assert.equal(location, '/contact/?inbox=too_long', label);
		assert.equal(calls.length, 0, label + ': nothing was forwarded');
	}
});

test('a submission exactly at every cap is forwarded whole, urlencoded and multipart', async (t) => {
	const entries = [['return_to', '/contact/'], ['Message', 'x'.repeat(MAX_VALUE_CHARS)], ['n'.repeat(MAX_NAME_CHARS), 'y']];
	while (entries.length < MAX_FIELDS) entries.push(['f' + entries.length, 'z']);
	const multipart = new FormData();
	for (const [k, v] of entries) multipart.set(k, v);
	for (const body of [new URLSearchParams(entries), multipart]) {
		const { location, payload } = await post(t, { body });
		assert.equal(location, '/contact/?inbox=sent');
		assert.equal(Object.keys(payload.fields).length, MAX_FIELDS - 1, 'every field but return_to');
		assert.equal(payload.fields.Message.length, MAX_VALUE_CHARS);
	}
});

test('the longest message the value cap admits fits the body cap in its widest encoding', () => {
	// A no-script submit is urlencoded: one CJK character is three UTF-8 bytes, nine once escaped.
	const widest = new URLSearchParams({ Message: '訊'.repeat(MAX_VALUE_CHARS) }).toString();
	assert.ok(new TextEncoder().encode(widest).byteLength < MAX_BODY_BYTES / 2, 'under half the body cap');
});

test('an unparseable body is still an empty submission, not a refusal', async (t) => {
	const { location, payload } = await post(t, { body: 'not a form', headers: { 'content-type': 'text/plain' } });
	assert.equal(location, '/?inbox=sent');
	assert.deepEqual(payload.fields, {});
});
