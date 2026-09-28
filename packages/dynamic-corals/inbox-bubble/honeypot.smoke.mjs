// The honeypot, in a real browser, on a host that dynamic-imports the coral (tile#19).
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/inbox-bubble/honeypot.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/inbox-bubble/
//
// 🩸 WHY THIS EXISTS. tile#19 reported the `_hp` input visible, with its「Leave this empty」text
// beside Send, and a visitor who typed into it lost their message without a word. The report's own
// correction then found `.dc-inbox-hp{position:absolute;left:-9999px;…}` in the injected
// stylesheet and blamed the probe. On a legacy host that correction is right. On a host that
// declares `data-dynamic-coral-css="layered"` it is not: the coral's CSS is wrapped in
// `@layer reef.corals`, an UNLAYERED host rule beats every layered one regardless of specificity,
// and a site's ordinary `label{position:static}` put the honeypot back inside the panel. Measured
// 2026-09-27 before the fix: compose label at left 923px, hand-off label at 939px, both on screen.
// compose.test.mjs and mount.test.mjs pin the inline style that fixes it; only a browser can say
// the style actually leaves no box where a person can see it.
//
// 🔴 THE HOSTILE ARMS NEED A CONTROL. "the honeypot stayed hidden under a hostile host rule" is
// only a finding if the rule actually applied — so every arm also measures one of the host's OWN
// labels and requires the rule to have taken there. Without that, a typo in the host CSS would turn
// every arm into the no-host-CSS arm and still pass.
//
// 🔴 The hand-off form is reached the way a visitor reaches it — data-kaito="1", a question, a
// refusal from /api/kaito, the "to a person" button — not by pasting `handoffFormHtml()` in. The
// API is answered by page.route; nothing leaves the machine.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node honeypot.smoke.mjs <url of packages/dynamic-corals/inbox-bubble/>');
const fixtureUrl = new URL('__honeypot-host.html', base).href;
const coralUrl = new URL('inbox-bubble.js', base).href;

// A host rule of the ordinary kind: forms that stack their labels. Each declaration is one the
// coral's hiding relies on.
const HOSTILE = 'form label{display:block;position:static;opacity:1;width:auto;height:auto}';

const hostPage = ({ layered, hostCss }) => `<!doctype html>
<html lang="en"${layered ? ' data-dynamic-coral-css="layered"' : ''}><head><meta charset="utf-8">
<style>${hostCss}</style></head><body>
<form><label id="host-label">host label</label></form>
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke" data-kaito="1"
  data-api-base="${new URL('.', fixtureUrl).origin}"></div>
<script type="module">await import(${JSON.stringify(coralUrl)});</script>
</body></html>`;

const b = await chromium.launch();
const failures = [];

async function arm({ label, layered, hostCss }) {
	const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
	const p = await ctx.newPage();
	const errs = [];
	p.on('pageerror', (e) => errs.push(String(e)));
	await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: hostPage({ layered, hostCss }) }));
	await p.route('**/api/**', (r) => {
		const u = r.request().url();
		if (u.includes('/api/kaito')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'refused', text: 'no record' }) });
		return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	await p.goto(fixtureUrl, { waitUntil: 'load', timeout: 20000 });
	await p.click('.dc-inbox-open');
	await p.fill('.dc-inbox-form textarea', 'do you ship abroad?');
	await p.press('.dc-inbox-form textarea', 'Enter');
	await p.click('.dc-inbox-tohuman', { timeout: 5000 });
	await p.waitForSelector('.dc-inbox-handoff', { timeout: 5000 });

	/** Where a label is, and whether any of it lands inside the viewport a person is looking at. */
	const measure = (sel) => p.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		const onScreen = r.width > 0 && r.height > 0 &&
			r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
		return { left: Math.round(r.left), width: Math.round(r.width), display: cs.display, position: cs.position, opacity: cs.opacity, onScreen };
	}, sel);

	const handoff = await measure('.dc-inbox-handoff .dc-inbox-hp');
	const host = await measure('#host-label');
	// The compose form's honeypot lives in the human-thread panel; the hand-off's Send takes the
	// visitor there only after a successful POST, so it is measured on a second, KAITO-less mount.
	await p.evaluate(() => {
		const el = document.querySelector('[data-dynamic-coral="inbox-bubble"]');
		const fresh = el.cloneNode(false);
		fresh.removeAttribute('data-kaito');
		fresh.removeAttribute('data-dynamic-coral-mounted');
		fresh.setAttribute('data-id', 'smoke-compose');
		el.replaceWith(fresh);
	});
	await p.evaluate((u) => import(u).then((m) => m.mountAll()), coralUrl);
	await p.click('.dc-inbox-open');
	await p.waitForSelector('.dc-inbox-form .dc-inbox-hp');
	const compose = await measure('.dc-inbox-form .dc-inbox-hp');

	const problems = [];
	if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
	for (const [name, m] of [['hand-off', handoff], ['compose', compose]]) {
		if (!m) problems.push(`${name}: no honeypot label rendered`);
		else if (m.onScreen) problems.push(`${name}: honeypot has an on-screen box ${JSON.stringify(m)}`);
		else if (m.opacity !== '0') problems.push(`${name}: honeypot opacity ${m.opacity}`);
	}
	// `display:block` is the declaration that proves it: a label is inline by default, while
	// `position:static` and `opacity:1` are what an unstyled label already has.
	if (hostCss && !(host && host.display === 'block' && host.onScreen)) {
		problems.push(`control: the host rule did not take on the host's own label ${JSON.stringify(host)}`);
	}
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  hand-off=${JSON.stringify(handoff)} compose=${JSON.stringify(compose)}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
	await ctx.close();
}

await arm({ label: 'legacy, no host CSS', layered: false, hostCss: '' });
await arm({ label: 'legacy, hostile host label rule', layered: false, hostCss: HOSTILE });
await arm({ label: 'layered, no host CSS', layered: true, hostCss: '' });
await arm({ label: 'layered, hostile host label rule', layered: true, hostCss: HOSTILE });
await b.close();

if (failures.length) {
	console.error('✗ honeypot smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ honeypot smoke: no on-screen honeypot box in any arm');
