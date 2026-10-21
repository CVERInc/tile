// Signed-in /account on a generated site carries a sign-out control that POSTs the
// existing logout route same-origin, reloads on success, and stays signed in with a
// visible error on failure. Drives the EMITTED worker, then runs its page script.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'account-sign-out-'));
const CONTRACT = {
	schemaVersion: 2,
	bindingName: 'SEAMLINK',
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, max-age=0, no-store' },
	siteOwnedBuyerPages: [{ path: '/hub', method: 'GET', kind: 'account', factsPath: '/zapi/hub-facts' }],
	forward: [{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] }]
};
const contractPath = join(workDir, 'contract.json');
writeFileSync(contractPath, JSON.stringify(CONTRACT));
const out = join(workDir, 'worker.mjs');
execFileSync('node', [join(here, 'emit-shop-function.mjs'), '--site-id', 'site-1', '--api-contract', contractPath, '--out', out],
	{ stdio: ['ignore', 'ignore', 'pipe'] });
const worker = await import(pathToFileURL(out).href);

const shell = (lang) => `<!doctype html><html lang="${lang}"><head><title>s</title></head><body><main><p>HOME</p></main></body></html>`;
async function accountHtml(lang, signedIn) {
	const env = {
		ASSETS: { fetch: async () => new Response(shell(lang), { status: 200, headers: { 'content-type': 'text/html' } }) },
		SEAMLINK: { fetch: async () => new Response(JSON.stringify({ signed_in: signedIn, sections: ['orders'] }), { status: 200 }) }
	};
	return (await worker.default.fetch(new Request('https://shop.example.test/hub'), env)).text();
}

test('signed in: a sign-out button in the shell locale, styled like the other actions', async () => {
	const zh = await accountHtml('zh-Hant', true);
	assert.match(zh, /<button type="button" class="st-runtime-action" data-ejecta-account-sign-out="">登出<\/button>/);
	assert.equal(zh.includes('data-ejecta-account-sign-out-status='), true);
	const en = await accountHtml('en', true);
	assert.equal(en.includes('>Sign out</button>'), true);
	const ja = await accountHtml('ja', true);
	assert.equal(ja.includes('>ログアウト</button>'), true);
	const cn = await accountHtml('zh-Hans', true);
	assert.equal(cn.includes('>退出登录</button>'), true);
});

test('signed out: no sign-out control', async () => {
	const html = await accountHtml('zh-Hant', false);
	assert.equal(html.includes('data-ejecta-account-sign-out'), false);
});

function runScript(html, fetchImpl) {
	const script = html.match(/<script>(\(function\(\)\{var b=document\.querySelector\('\[data-ejecta-account-sign-out\][\s\S]*?)<\/script>/)[1];
	const btn = { disabled: false, handlers: {}, addEventListener(t, h) { this.handlers[t] = h; } };
	const status = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
	const win = { location: { reloaded: 0, reload() { this.reloaded++; } } };
	const doc = { querySelector: (q) => q === '[data-ejecta-account-sign-out]' ? btn : q === '[data-ejecta-account-sign-out-status]' ? status : null };
	vm.runInNewContext(script, { document: doc, window: win, fetch: fetchImpl });
	return { btn, status, win };
}

test('press: POSTs the logout route same-origin and reloads on success', async () => {
	const html = await accountHtml('zh-Hant', true);
	const calls = [];
	const { btn, win } = runScript(html, async (url, init) => { calls.push([url, init]); return { ok: true }; });
	await btn.handlers.click();
	assert.equal(calls.length, 1);
	assert.equal(calls[0][0], '/api/auth/logout');
	assert.equal(calls[0][1].method, 'POST');
	assert.equal(calls[0][1].credentials, 'same-origin');
	assert.equal(win.location.reloaded, 1);
});

test('press: a refused logout shows an error, stays signed in, button re-enabled', async () => {
	for (const failing of [async () => ({ ok: false, status: 403 }), async () => { throw new Error('net'); }]) {
		const html = await accountHtml('zh-Hant', true);
		const { btn, status, win } = runScript(html, failing);
		await btn.handlers.click();
		assert.equal(win.location.reloaded, 0);
		assert.equal(status.textContent, '無法登出，請再試一次。');
		assert.equal(status.attrs['data-ejecta-status-tone'], 'error');
		assert.equal(btn.disabled, false);
	}
});
