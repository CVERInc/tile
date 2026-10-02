import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'inbox-signing-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// Fixed interoperability vectors: the hexadecimal key is UTF-8 text, not decoded bytes.
const KAT = {
	tenant: 'site:kat-example',
	ip: '203.0.113.9',
	ts: '1790000000',
	siteKey: '9913df079513a191d224a9d8957c4b693c25522011c09ba47b426e215e4592bf',
	sigWithIp: 'a14c991ca103f09a1d97f72906d687e9f2774b696f1ccd79e53c15fb633c38af',
	sigNoIp: '5d47545c867bcc2a75a07258f5901d3df62ac27e4a38034d0737bcc9a5ac501f'
};
const fakeHeaders = {
	'x-reef-forward-ts': '123',
	'x-reef-forward-sig': 'forged',
	'x-reef-visitor-ip': '198.51.100.7',
	'x-reef-extra': 'untrusted',
	'x-forwarded-for': '198.51.100.8',
	cookie: 'session=untrusted'
};

function emit(name, key, args = []) {
	const out = join(dir, name + '.mjs');
	const env = { ...process.env };
	delete env.INBOX_FORWARD_SITE_KEY;
	if (key !== undefined) env.INBOX_FORWARD_SITE_KEY = key;
	const result = spawnSync(process.execPath, [join(here, 'emit-shop-function.mjs'),
		'--site-id', KAT.tenant.slice('site:'.length), '--guild', 'other-site',
		'--platform-origin', 'https://platform.example', '--out', out, ...args
	], { encoding: 'utf8', env });
	assert.equal(result.status, 0, 'emitter succeeds');
	return { out, result, bytes: readFileSync(out, 'utf8') };
}
const signed = emit('signed', KAT.siteKey, [
	'--api', 'https://api.example',
	'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])
]);
const unsigned = emit('unsigned');
const signedWorker = (await import(pathToFileURL(signed.out))).default;
const unsignedWorker = (await import(pathToFileURL(unsigned.out))).default;
const assets = { ASSETS: { fetch: async () => new Response('<html><head></head><body><main>Static</main></body></html>') } };

async function forward(t, worker, headers = {}) {
	t.mock.method(Date, 'now', () => Number(KAT.ts) * 1000 + 999);
	let sent;
	t.mock.method(globalThis, 'fetch', async (url, opts) => {
		sent = { url, headers: new Headers(opts.headers), payload: JSON.parse(opts.body), opts };
		return new Response('{}');
	});
	const body = new URLSearchParams({
		Name: 'Example', return_to: '/contact', id: 'attacker', tenant: 'site:attacker',
		inboxForwardKey: 'attacker-key'
	});
	const response = await worker.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body, headers: { ...fakeHeaders, ...headers }
	}), assets);
	assert.equal(response.headers.get('location'), '/contact?inbox=sent', 'forward succeeds');
	assert.ok(sent, 'the platform receives a request');
	assert.equal(sent.url, 'https://platform.example/api/inbox');
	assert.equal(sent.payload.id, 'kat-example', 'identity comes from baked configuration');
	assert.equal(sent.payload.kind, 'site');
	assert.equal(sent.payload.fields.Name, 'Example');
	return sent;
}

test('signed forwarding matches the fixed vector using the trusted visitor IP', async (t) => {
	const sent = await forward(t, signedWorker, { 'cf-connecting-ip': KAT.ip });
	assert.equal(sent.headers.get('x-reef-forward-ts'), KAT.ts, 'timestamp uses whole Unix seconds');
	assert.equal(sent.headers.get('x-reef-visitor-ip'), KAT.ip, 'visitor IP comes from Cloudflare');
	assert.equal(sent.headers.get('x-reef-forward-sig'), KAT.sigWithIp, 'UTF-8 hex-key signature matches');
	assert.equal(sent.headers.get('x-reef-extra'), null, 'arbitrary visitor forwarding headers are dropped');
	assert.equal(sent.headers.get('cookie'), null, 'visitor cookies are dropped');
	assert.equal(sent.opts.credentials, 'omit');
});

test('missing Cloudflare IP signs an empty string and omits the visitor IP header', async (t) => {
	const sent = await forward(t, signedWorker);
	assert.equal(sent.headers.get('x-reef-forward-ts'), KAT.ts);
	assert.equal(sent.headers.get('x-reef-forward-sig'), KAT.sigNoIp, 'empty-IP signature matches');
	assert.equal(sent.headers.get('x-reef-visitor-ip'), null, 'forged visitor IP is not used');
});

test('an absent key preserves unsigned forwarding and drops all forged forwarding headers', async (t) => {
	const sent = await forward(t, unsignedWorker, { 'cf-connecting-ip': KAT.ip });
	for (const name of Object.keys(fakeHeaders)) {
		assert.equal(sent.headers.get(name), null, 'unsigned request excludes ' + name);
	}
	assert.equal(unsigned.bytes.includes('"inboxForwardKey":'), false, 'absent key is omitted from configuration');
});

test('the key is emitted only in Worker configuration, never logs or provenance', () => {
	assert.ok(signed.bytes.includes('"inboxForwardKey":"' + KAT.siteKey + '"'), 'key is baked into Worker config');
	assert.equal(signed.result.stdout.includes(KAT.siteKey), false, 'stdout excludes key');
	assert.equal(signed.result.stderr.includes(KAT.siteKey), false, 'stderr excludes key');
	const provenance = signed.bytes.split('\n').slice(0, 3).join('\n');
	assert.match(provenance, /emitter commit:/, 'provenance was emitted');
	assert.equal(provenance.includes(KAT.siteKey), false, 'provenance excludes key');
	assert.deepEqual(readdirSync(dir).sort(), ['signed.mjs', 'unsigned.mjs'], 'no extra artifact receives the key');
});

test('the key never reaches static or rendered browser responses', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ item: {
		processor: 'square', id: 'item', slug: 'example', title: 'Example',
		variants: [{ id: 'one', title: 'One', price_minor: 500, currency: 'USD' }]
	} })));
	for (const path of ['/contact', '/shop/example']) {
		const response = await signedWorker.fetch(new Request('https://site.example' + path), assets);
		assert.equal(response.status, 200);
		const html = await response.text();
		if (path.startsWith('/shop/')) assert.ok(html.includes('dc-pp'), 'product rendering was exercised');
		assert.equal(html.includes(KAT.siteKey), false, 'browser HTML excludes key');
		assert.equal(JSON.stringify([...response.headers]).includes(KAT.siteKey), false, 'response headers exclude key');
	}
});

test('a key requires an output file instead of printing the Worker to stdout', () => {
	const result = spawnSync(process.execPath, [join(here, 'emit-shop-function.mjs'), '--site-id', 'kat-example'], {
		encoding: 'utf8', env: { ...process.env, INBOX_FORWARD_SITE_KEY: KAT.siteKey }
	});
	assert.equal(result.status, 2, 'secret-bearing stdout emission is rejected');
	assert.equal(result.stdout, '', 'stdout remains empty');
	assert.match(result.stderr, /--out/, 'error tells the caller to provide an output path');
	assert.equal(result.stderr.includes(KAT.siteKey), false, 'error excludes key');
});
