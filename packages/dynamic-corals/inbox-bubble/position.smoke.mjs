// Where the bubble SITS, in a real browser: the phone's safe area and the owner's offset (reef#2418).
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/inbox-bubble/position.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/inbox-bubble/
//
// 🩸 WHY THIS EXISTS. A field report: on a phone the bubble covered the bottom-right corner of the
// page — a page title sat under it. Up to 0.7.15 the root was `right:1rem;bottom:1rem` and nothing
// else, so on a phone with a home indicator it sat partly inside the safe area, and an owner had no
// supported way to move it out of the way of their own content.
//
// 🔴 THE INSET IS THE BROWSER'S OWN, NOT A STAND-IN. Chromium's DevTools protocol can override the
// safe-area insets (`Emulation.setSafeAreaInsetsOverride`), so `env(safe-area-inset-*)` resolves to
// a real non-zero value here and the coral's stylesheet is measured exactly as a phone resolves it.
// If that command ever disappears, this throws rather than measuring a 0 inset and calling it green.
//
// 🔴 EVERY MOVE IS MEASURED AGAINST A CONTROL ARM, not against a number in this file: "80px up" is
// the difference between two runs on the same viewport, so a base offset that changes later is a
// change to the control, not a broken assertion. The desktop arm is the one that pins the base
// itself: 16px from the corner, 56×56, a 22rem panel — the look before reef#2418.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node position.smoke.mjs <url of packages/dynamic-corals/inbox-bubble/>');
const fixtureUrl = new URL('__position-host.html', base).href;
const coralUrl = new URL('inbox-bubble.js', base).href;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1200, height: 900 };
// A home indicator below and, uneven on purpose, a notch-side inset on the right.
const INSET = { top: 0, left: 0, bottom: 34, right: 20 };

const hostPage = (hostCss) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>${hostCss}</style></head><body>
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="position-smoke"
  data-api-base="${new URL('.', fixtureUrl).origin}"></div>
<script type="module">await import(${JSON.stringify(coralUrl)});</script>
</body></html>`;

const b = await chromium.launch();
const failures = [];

/** Mounts the bubble and returns the closed bubble's box, then (optionally) the open panel's. */
async function measure({ viewport, mobile = false, inset = null, hostCss = '', openPanel = false }) {
	const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
	const p = await ctx.newPage();
	const errs = [];
	p.on('pageerror', (e) => errs.push(String(e)));
	if (inset) {
		const cdp = await ctx.newCDPSession(p);
		await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: inset });
	}
	await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: hostPage(hostCss) }));
	await p.route('**/api/**', (r) => {
		const u = r.request().url();
		if (u.includes('/api/inbox/session') && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, claimed: true }) });
		return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	await p.goto(fixtureUrl, { waitUntil: 'load', timeout: 20000 });
	await p.waitForSelector('.dc-inbox-open', { timeout: 10000 });
	const rect = (sel) => p.evaluate((sel) => {
		const find = (root) => {
			const hit = root.querySelector(sel);
			if (hit) return hit;
			for (const e of root.querySelectorAll('*')) {
				const inner = e.shadowRoot && find(e.shadowRoot);
				if (inner) return inner;
			}
			return null;
		};
		const el = find(document);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
	}, sel);
	// The inset the page itself resolves — proof the override took, so a 0 can never pass for one.
	const envBottom = await p.evaluate(() => {
		const d = document.createElement('div');
		d.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
		document.body.appendChild(d);
		const v = parseFloat(getComputedStyle(d).paddingBottom);
		d.remove();
		return v;
	});
	const bubble = await rect('.dc-inbox-open');
	let panel = null;
	if (openPanel) {
		await p.click('.dc-inbox-open');
		await p.waitForSelector('.dc-inbox-panel', { timeout: 10000 });
		// Past the .16s entrance animation, which translates the panel 6px.
		await p.waitForTimeout(400);
		panel = await rect('.dc-inbox-panel');
	}
	await ctx.close();
	return { bubble, panel, envBottom, errs };
}

function check(label, problems, m) {
	if (m.errs?.length) problems.push(`page errors: ${m.errs.join(' | ')}`);
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  bubble=${JSON.stringify(m.bubble)}${m.panel ? ` panel=${JSON.stringify(m.panel)}` : ''}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
}

const inside = (r, vp) => r.left >= 0 && r.top >= 0 && r.right <= vp.width && r.bottom <= vp.height;

// 1. The default look on desktop — the base itself, pinned: nothing about reef#2418 moves it.
{
	const m = await measure({ viewport: DESKTOP, openPanel: true });
	const problems = [];
	const bb = m.bubble;
	if (bb.width !== 56 || bb.height !== 56) problems.push(`bubble is ${bb.width}×${bb.height}, not 56×56`);
	if (bb.right !== DESKTOP.width - 16 || bb.bottom !== DESKTOP.height - 16) problems.push(`bubble is not 16px from the corner: right ${bb.right}, bottom ${bb.bottom}`);
	if (m.panel.width !== 352) problems.push(`panel width ${m.panel.width}, not 22rem (352px)`);
	if (m.panel.right !== DESKTOP.width - 16 || m.panel.bottom !== DESKTOP.height - 16) problems.push(`panel is not 16px from the corner: right ${m.panel.right}, bottom ${m.panel.bottom}`);
	check('desktop, defaults', problems, m);
}

// 2. RED before reef#2418: a phone with a safe area. The bubble's box must not reach into it, and
// it keeps its own 16px clear of the inset edge (the base offset is ADDED to the inset).
const phoneControl = await measure({ viewport: PHONE, mobile: true });
{
	const m = await measure({ viewport: PHONE, mobile: true, inset: INSET, openPanel: true });
	const problems = [];
	if (m.envBottom !== INSET.bottom) problems.push(`control: env(safe-area-inset-bottom) resolved to ${m.envBottom}px, not ${INSET.bottom}px — the override did not take`);
	const safe = { bottom: PHONE.height - INSET.bottom, right: PHONE.width - INSET.right };
	if (m.bubble.bottom > safe.bottom || m.bubble.right > safe.right) {
		problems.push(`the bubble overlaps the safe area: bottom ${m.bubble.bottom} > ${safe.bottom} or right ${m.bubble.right} > ${safe.right}`);
	}
	if (m.bubble.bottom !== safe.bottom - 16 || m.bubble.right !== safe.right - 16) problems.push(`bubble is not 16px clear of the inset: bottom ${m.bubble.bottom}, right ${m.bubble.right}`);
	if (!inside(m.panel, PHONE) || m.panel.bottom > safe.bottom || m.panel.right > safe.right) problems.push(`the open panel leaves the safe viewport: ${JSON.stringify(m.panel)}`);
	check('phone, safe-area inset 34 bottom / 20 right', problems, m);
}

// 3. The owner's offset: `--reef-inbox-offset-y: 80px` moves it up by exactly 80px, `-x` left.
{
	const m = await measure({ viewport: PHONE, mobile: true, hostCss: ':root{--reef-inbox-offset-y:80px;--reef-inbox-offset-x:24px}', openPanel: true });
	const problems = [];
	const dy = phoneControl.bubble.bottom - m.bubble.bottom;
	const dx = phoneControl.bubble.right - m.bubble.right;
	if (dy !== 80) problems.push(`--reef-inbox-offset-y:80px moved the bubble up by ${dy}px, not 80px`);
	if (dx !== 24) problems.push(`--reef-inbox-offset-x:24px moved the bubble left by ${dx}px, not 24px`);
	if (!inside(m.panel, PHONE)) problems.push(`the open panel leaves the viewport: ${JSON.stringify(m.panel)}`);
	check('phone, offset 24px / 80px', problems, m);
}

// 4. The clamps. A huge offset cannot push the bubble — or the open panel — off the screen, and a
// negative one cannot pull it into the safe area or past the base.
{
	const m = await measure({ viewport: PHONE, mobile: true, inset: INSET, hostCss: ':root{--reef-inbox-offset-y:5000px;--reef-inbox-offset-x:5000px}', openPanel: true });
	const problems = [];
	if (!inside(m.bubble, PHONE)) problems.push(`a 5000px offset pushed the bubble off the screen: ${JSON.stringify(m.bubble)}`);
	if (!inside(m.panel, PHONE)) problems.push(`a 5000px offset pushed the open panel off the screen: ${JSON.stringify(m.panel)}`);
	if (m.panel.width < 120 || m.panel.height < 120) problems.push(`the open panel collapsed under a 5000px offset: ${m.panel.width}×${m.panel.height}`);
	check('phone + inset, offset 5000px (clamped high)', problems, m);
}
// The same on a phone held sideways, where the room above the raised corner is SHORTER than the
// panel's own content — so the panel's max-height is what keeps it on screen, not luck. The control
// requires that the panel really was cut down, or this arm would be measuring nothing.
{
	const LANDSCAPE = { width: 844, height: 390 };
	const m = await measure({ viewport: LANDSCAPE, mobile: true, inset: { top: 0, left: 47, bottom: 21, right: 47 }, hostCss: ':root{--reef-inbox-offset-y:5000px}', openPanel: true });
	const problems = [];
	if (!inside(m.panel, LANDSCAPE)) problems.push(`the open panel leaves the screen: ${JSON.stringify(m.panel)}`);
	if (m.panel.top < 16) problems.push(`the open panel is closer than 1rem to the top: ${m.panel.top}`);
	if (m.panel.height >= 172) problems.push(`control: the panel was not cut down (${m.panel.height}px), so its max-height was never exercised`);
	check('landscape phone + inset, offset-y 5000px (panel max-height bites)', problems, m);
}
{
	const m = await measure({ viewport: PHONE, mobile: true, inset: INSET, hostCss: ':root{--reef-inbox-offset-y:-200px;--reef-inbox-offset-x:-200px}' });
	const problems = [];
	const safe = { bottom: PHONE.height - INSET.bottom, right: PHONE.width - INSET.right };
	if (m.bubble.bottom !== safe.bottom - 16 || m.bubble.right !== safe.right - 16) problems.push(`a negative offset was not clamped to 0: bottom ${m.bubble.bottom}, right ${m.bubble.right}`);
	check('phone + inset, offset -200px (clamped at 0)', problems, m);
}
// A value that is not a length is invalid at computed-value time — it must fall back to the base,
// not drop the whole `right`/`bottom` declaration (which would leave the root at static position).
{
	const m = await measure({ viewport: PHONE, mobile: true, hostCss: ':root{--reef-inbox-offset-y:banana;--reef-inbox-offset-x:12}' });
	const problems = [];
	if (m.bubble.bottom !== phoneControl.bubble.bottom || m.bubble.right !== phoneControl.bubble.right) problems.push(`a non-length offset moved the bubble: ${JSON.stringify(m.bubble)} vs ${JSON.stringify(phoneControl.bubble)}`);
	check('phone, offset not a length (ignored)', problems, m);
}

await b.close();

if (failures.length) {
	console.error('✗ position smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ position smoke: the bubble clears the safe area, follows the owner\'s offset within its clamps, and its panel stays on screen');
