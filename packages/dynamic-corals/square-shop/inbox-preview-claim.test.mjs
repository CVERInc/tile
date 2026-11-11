import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { after, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'inbox-preview-claim-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const SITE = 'claim-example';
const KEY = '9913df079513a191d224a9d8957c4b693c25522011c09ba47b426e215e4592bf';
const IP = '203.0.113.9';
const TS = '1790000000';
const hmac = (message) => createHmac('sha256', KEY).update(message).digest('hex');

function emit(name, { key, flag }) {
	const out = join(dir, name + '.mjs');
	const env = { ...process.env };
	delete env.INBOX_FORWARD_SITE_KEY;
	if (key) env.INBOX_FORWARD_SITE_KEY = key;
	const result = spawnSync(process.execPath, [join(here, 'emit-shop-function.mjs'),
		'--site-id', SITE, '--guild', 'other-site', '--platform-origin', 'https://platform.example',
		'--out', out, ...(flag ? ['--inbox-preview-claim'] : [])
	], { encoding: 'utf8', env });
	assert.equal(result.status, 0, 'emitter succeeds: ' + result.stderr);
	return { out, bytes: readFileSync(out, 'utf8') };
}

const claimed = emit('claimed', { key: KEY, flag: true });
const plain = emit('plain', { key: KEY, flag: false });
const keyless = emit('keyless', { key: '', flag: true });
const assets = { ASSETS: { fetch: async () => new Response('<html></html>') } };

async function forward(t, built) {
	const worker = (await import(pathToFileURL(built.out))).default;
	t.mock.method(Date, 'now', () => Number(TS) * 1000 + 999);
	let sent;
	t.mock.method(globalThis, 'fetch', async (url, opts) => {
		sent = { headers: new Headers(opts.headers) };
		return new Response('{}');
	});
	const response = await worker.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST',
		body: new URLSearchParams({ Name: 'Example', return_to: '/contact' }),
		headers: { 'cf-connecting-ip': IP, 'x-reef-forward-preview': 'forged' }
	}), assets);
	assert.equal(response.headers.get('location'), '/contact?inbox=sent');
	assert.ok(sent);
	return sent.headers;
}

test('--inbox-preview-claim with a key adds the preview claim and signs the five-line message', async (t) => {
	const h = await forward(t, claimed);
	assert.equal(h.get('x-reef-forward-preview'), 'latest');
	assert.equal(h.get('x-reef-forward-ts'), TS);
	assert.equal(h.get('x-reef-forward-sig'), hmac('site:' + SITE + '\n' + IP + '\n' + TS + '\npreview\nlatest'));
	assert.ok(claimed.bytes.includes('"inboxPreviewBuild":"latest"'));
});

test('without the flag there is no claim header and the three-line signature is unchanged', async (t) => {
	const h = await forward(t, plain);
	assert.equal(h.get('x-reef-forward-preview'), null);
	assert.equal(h.get('x-reef-forward-sig'), hmac('site:' + SITE + '\n' + IP + '\n' + TS));
	assert.equal(plain.bytes.includes('"inboxPreviewBuild":'), false, 'key is not written');
});

test('the flag without a signing key never sends a claim', async (t) => {
	const h = await forward(t, keyless);
	assert.equal(h.get('x-reef-forward-preview'), null);
	assert.equal(h.get('x-reef-forward-sig'), null);
});

test('the flag changes only the baked config key: the flagless output is the claimed output without it', () => {
	// The pre-change bytes are the claimed output with the opt-in key removed from the baked
	// config and the template branch ignored by absence; the full-emitter comparison against the
	// previous commit is recorded in the leg evidence. Here: the only config difference is the key.
	const stripped = claimed.bytes.replaceAll(',"inboxPreviewBuild":"latest"', '');
	assert.equal(stripped, plain.bytes);
});
