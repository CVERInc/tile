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

const hostPage = (hostCss, bodyHtml = '', hostAttrs = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>${hostCss}</style></head><body>
${bodyHtml}
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="position-smoke" ${hostAttrs}
  data-api-base="${new URL('.', fixtureUrl).origin}"></div>
<script type="module">await import(${JSON.stringify(coralUrl)});</script>
</body></html>`;

const b = await chromium.launch();
const failures = [];

/** Mounts the bubble and returns the closed bubble's box, then (optionally) the open panel's. */
async function measure({ viewport, mobile = false, inset = null, hostCss = '', bodyHtml = '', initScript = null, openPanel = false, composer = false, grow = 0, lastResort = false, hostAttrs = '', searchIndex = null, waitLabel = null, width = false }) {
	const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
	const p = await ctx.newPage();
	// Runs before any page script: a theme's own JS (a prior registration), or a browser without an API.
	if (initScript) await p.addInitScript(initScript);
	const errs = [];
	p.on('pageerror', (e) => errs.push(String(e)));
	if (inset) {
		const cdp = await ctx.newCDPSession(p);
		await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: inset });
	}
	await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: hostPage(hostCss, bodyHtml, hostAttrs) }));
	await p.route('**/api/**', (r) => {
		const u = r.request().url();
		if (u.includes('/api/inbox/session') && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, claimed: true }) });
		return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	if (searchIndex) await p.route('**/search.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(searchIndex) }));
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
		if (waitLabel) {
			// The search index loads on the first open and THEN relabels the button: wait for that.
			await p.waitForFunction((label) => document.querySelector('.dc-inbox-host').shadowRoot
				.querySelector('.dc-inbox-form button[type="submit"]').textContent === label, waitLabel, { timeout: 10000 });
			await p.waitForTimeout(200);
		}
		panel = await rect('.dc-inbox-panel');
	}
	const widthProbe = openPanel && width ? await p.evaluate(composerWidth) : null;
	const controls = openPanel && composer ? await p.evaluate(composerProbe, grow) : null;
	let lastResortProbe = null;
	if (openPanel && lastResort) {
		// A REAL wheel, not `scrollTop =`: script can scroll an overflow:hidden box, a visitor cannot.
		const pr = await rect('.dc-inbox-panel');
		const sizes = await p.evaluate(() => {
			const panel = document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-panel');
			return { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
		});
		await p.mouse.move((pr.left + pr.right) / 2, pr.top + 8);
		await p.mouse.wheel(0, 2000);
		await p.waitForTimeout(300);
		lastResortProbe = { ...sizes, ...(await p.evaluate(() => {
			const sr = document.querySelector('.dc-inbox-host').shadowRoot;
			const out = { scrollTop: sr.querySelector('.dc-inbox-panel').scrollTop };
			for (const [k, sel] of [['sendHit', '.dc-inbox-form button[type="submit"]'], ['textareaHit', '.dc-inbox-form textarea']]) {
				const el = sr.querySelector(sel);
				const r = el.getBoundingClientRect();
				const hit = sr.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
				out[k] = hit === el || el.contains(hit);
			}
			return out;
		})) };
	}
	// The page's own element that reads the public knob (the @property arm), after the mount.
	const pageProbe = await p.evaluate(() => {
		const el = document.getElementById('theme-probe');
		return el ? { before: window.__themeProbeBefore ?? null, after: getComputedStyle(el).height } : null;
	});
	await ctx.close();
	return { bubble, panel, controls, width: widthProbe, lastResort: lastResortProbe, pageProbe, envBottom, errs };
}

/**
 * In the page, with the panel open: is the composer USABLE, and does the conversation scroll?
 *
 * 🩸 THE OUTER RECT WAS NOT ENOUGH (tile#199 review P2-1). A 128px panel sat neatly inside a
 * 667×320 viewport while its textarea and Send button hung out of the bottom of it, cut off by the
 * panel's own overflow — and the arm that measured only the panel's rectangle was green. So each
 * control is measured itself: its box inside the viewport AND inside the panel, and the point at
 * its centre hit-tests to it (a clipped or covered control fails that even when its box looks right).
 * Then the log is filled past its height, and it must scroll while the controls stay where they were.
 */
async function composerProbe(grow) {
	const host = document.querySelector('.dc-inbox-host');
	const sr = host.shadowRoot;
	const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
	const panelEl = sr.querySelector('.dc-inbox-panel');
	const log = sr.querySelector('.dc-inbox-log');
	const controlsNow = () => {
		const panel = box(panelEl);
		const vp = { width: innerWidth, height: innerHeight };
		const out = {};
		for (const [k, sel] of [['textarea', '.dc-inbox-form textarea'], ['send', '.dc-inbox-form button[type="submit"]']]) {
			const el = sr.querySelector(sel);
			const r = box(el);
			const cx = (r.left + r.right) / 2;
			const cy = (r.top + r.bottom) / 2;
			const hit = sr.elementFromPoint(cx, cy);
			out[k] = {
				rect: r,
				inViewport: r.left >= 0 && r.top >= 0 && r.right <= vp.width + 0.5 && r.bottom <= vp.height + 0.5,
				inPanel: r.left >= panel.left - 0.5 && r.top >= panel.top - 0.5 && r.right <= panel.right + 0.5 && r.bottom <= panel.bottom + 0.5,
				hit: hit === el || el.contains(hit),
				big: r.width >= 40 && r.height >= 24
			};
		}
		return { panel, ...out };
	};
	const empty = controlsNow();
	for (let i = 0; i < 30; i++) {
		const m = document.createElement('div');
		m.className = 'dc-inbox-msg dc-inbox-msg-owner';
		m.textContent = `A message long enough to wrap at least once in a narrow panel, number ${i}.`;
		log.appendChild(m);
	}
	const before = log.scrollTop;
	log.scrollTop = 1e6;
	const scroll = { scrollHeight: log.scrollHeight, clientHeight: log.clientHeight, moved: log.scrollTop - before };
	const out = { empty, full: controlsNow(), scroll };
	if (grow) {
		// A fixed part growing AFTER the panel opened (the search block appearing does this): the
		// room has to be re-made, not just measured once at open.
		const extra = document.createElement('div');
		extra.style.height = `${grow}px`;
		sr.querySelector('.dc-inbox-head').appendChild(extra);
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		out.grown = { ...controlsNow(), logHeight: log.clientHeight };
	}
	return out;
}

/** The composer's widths: the textarea's CONTENT box (what the visitor sees their text in) and the button. */
function composerWidth() {
	const sr = document.querySelector('.dc-inbox-host').shadowRoot;
	const ta = sr.querySelector('.dc-inbox-form textarea');
	const btn = sr.querySelector('.dc-inbox-form button[type="submit"]');
	const panel = sr.querySelector('.dc-inbox-panel').getBoundingClientRect();
	const cs = getComputedStyle(ta);
	const content = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	// 10ch in the textarea's own font, measured rather than assumed.
	const probe = document.createElement('div');
	probe.style.cssText = `position:absolute;visibility:hidden;width:10ch;font:${cs.font}`;
	ta.parentNode.appendChild(probe);
	const tenCh = probe.getBoundingClientRect().width;
	probe.remove();
	const b = btn.getBoundingClientRect();
	const hit = sr.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
	return {
		label: btn.textContent,
		textareaBottom: ta.getBoundingClientRect().bottom,
		textareaContent: content,
		tenCh,
		panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, width: panel.width },
		button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width },
		buttonInPanel: b.left >= panel.left - 0.5 && b.right <= panel.right + 0.5 && b.top >= panel.top - 0.5 && b.bottom <= panel.bottom + 0.5,
		buttonHit: hit === btn || btn.contains(hit),
		buttonInViewport: b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5
	};
}

function widthProblems(w, label) {
	const problems = [];
	if (label && w.label !== label) problems.push(`control: the button reads ${JSON.stringify(w.label)}, not ${JSON.stringify(label)}`);
	if (!(w.textareaContent >= w.tenCh - 0.5)) problems.push(`the textarea's content width is ${w.textareaContent.toFixed(1)}px, under 10ch (${w.tenCh.toFixed(1)}px)`);
	if (!w.buttonInPanel) problems.push(`the button leaves the panel: ${JSON.stringify(w.button)} vs ${JSON.stringify(w.panel)}`);
	if (!w.buttonHit || !w.buttonInViewport) problems.push(`the button is not reachable: ${JSON.stringify(w.button)}`);
	return problems;
}

/** Problems with a `composerProbe` result: the controls in both states, and the log's scroll. */
function composerProblems(c) {
	const problems = [];
	for (const [state, at] of [['empty', c.empty], ['full log', c.full]]) {
		for (const k of ['textarea', 'send']) {
			const x = at[k];
			if (!x.inViewport) problems.push(`${state}: the ${k} leaves the viewport: ${JSON.stringify(x.rect)}`);
			if (!x.inPanel) problems.push(`${state}: the ${k} is clipped by the panel: ${JSON.stringify(x.rect)} vs panel ${JSON.stringify(at.panel)}`);
			if (!x.hit) problems.push(`${state}: the ${k}'s centre does not hit-test to it (clipped or covered): ${JSON.stringify(x.rect)}`);
			if (!x.big) problems.push(`${state}: the ${k} is squeezed to ${x.rect.width}×${x.rect.height}`);
		}
	}
	if (!(c.scroll.scrollHeight > c.scroll.clientHeight + 1) || !(c.scroll.moved > 0)) problems.push(`the overflowing log does not scroll: ${JSON.stringify(c.scroll)}`);
	if (c.scroll.clientHeight < 40) problems.push(`the log is squeezed to ${c.scroll.clientHeight}px, too little to read a message`);
	if (c.grown) {
		for (const k of ['textarea', 'send']) if (!c.grown[k].inPanel || !c.grown[k].hit) problems.push(`after the header grew, the ${k} is clipped: ${JSON.stringify(c.grown[k].rect)}`);
		if (c.grown.logHeight < 40) problems.push(`after the header grew, the log is squeezed to ${c.grown.logHeight}px: the room was not re-made`);
	}
	return problems;
}

function check(label, problems, m) {
	if (m.errs?.length) problems.push(`page errors: ${m.errs.join(' | ')}`);
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  bubble=${JSON.stringify(m.bubble)}${m.panel ? ` panel=${JSON.stringify(m.panel)}` : ''}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
}

const inside = (r, vp) => r.left >= 0 && r.top >= 0 && r.right <= vp.width && r.bottom <= vp.height;

// 1. The default look on desktop — the base itself, pinned: nothing about reef#2418 moves it.
{
	const m = await measure({ viewport: DESKTOP, openPanel: true, composer: true });
	const problems = [];
	const bb = m.bubble;
	if (bb.width !== 56 || bb.height !== 56) problems.push(`bubble is ${bb.width}×${bb.height}, not 56×56`);
	if (bb.right !== DESKTOP.width - 16 || bb.bottom !== DESKTOP.height - 16) problems.push(`bubble is not 16px from the corner: right ${bb.right}, bottom ${bb.bottom}`);
	if (m.panel.width !== 352) problems.push(`panel width ${m.panel.width}, not 22rem (352px)`);
	// reef#2790: the open panel sits directly above its own bubble (the dock's gap, 8px), the bubble
	// staying where it is — it used to take the bubble's place in the corner.
	if (m.panel.right !== DESKTOP.width - 16 || m.panel.bottom !== DESKTOP.height - 16 - 56 - 8) problems.push(`panel is not directly above the bubble in the corner: right ${m.panel.right}, bottom ${m.panel.bottom}`);
	// The composer probe's own control: on the roomy default panel it must pass.
	problems.push(...composerProblems(m.controls));
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

// A length in other units is resolved, not just passed through: 2.5em + 40px at a 16px font is
// 80px. A percentage is not a length (it would mean a different thing on each axis) and counts as 0.
{
	const m = await measure({ viewport: PHONE, mobile: true, hostCss: ':root{--reef-inbox-offset-y:calc(2.5em + 40px);--reef-inbox-offset-x:10%}' });
	const problems = [];
	const dy = phoneControl.bubble.bottom - m.bubble.bottom;
	const dx = phoneControl.bubble.right - m.bubble.right;
	if (dy !== 80) problems.push(`--reef-inbox-offset-y:calc(2.5em + 40px) moved the bubble up by ${dy}px, not 80px`);
	if (dx !== 0) problems.push(`--reef-inbox-offset-x:10% moved the bubble left by ${dx}px, not 0`);
	check('phone, offset calc(2.5em + 40px) / 10%', problems, m);
}

// 4. The clamps. A huge offset cannot push the bubble — or the open panel — off the screen, and a
// negative one cannot pull it into the safe area or past the base.
{
	const m = await measure({ viewport: PHONE, mobile: true, inset: INSET, hostCss: ':root{--reef-inbox-offset-y:5000px;--reef-inbox-offset-x:5000px}', openPanel: true, composer: true });
	const problems = [];
	problems.push(...composerProblems(m.controls));
	if (!inside(m.bubble, PHONE)) problems.push(`a 5000px offset pushed the bubble off the screen: ${JSON.stringify(m.bubble)}`);
	if (!inside(m.panel, PHONE)) problems.push(`a 5000px offset pushed the open panel off the screen: ${JSON.stringify(m.panel)}`);
	if (m.panel.width < 120 || m.panel.height < 120) problems.push(`the open panel collapsed under a 5000px offset: ${m.panel.width}×${m.panel.height}`);
	check('phone + inset, offset 5000px (clamped high)', problems, m);
}
// The same on a phone held sideways, where the room above the raised corner is SHORTER than the
// panel's header plus its composer. 🩸 r1 asserted only that the panel's outer box stayed on screen —
// it did, at 142px, with the Send button cut off below it (tile#199 review P2-1). Now the composer
// must be whole and usable and the log must scroll, and the control requires that the requested
// offset really was too high for that, i.e. that the panel had to come DOWN from it to fit.
for (const arm of [
	{ label: 'landscape phone + inset, offset-y 5000px', vp: { width: 844, height: 390 }, inset: { top: 0, left: 47, bottom: 21, right: 47 }, grow: 100 },
	{ label: 'small landscape 667×320, offset-y 5000px', vp: { width: 667, height: 320 }, inset: null, grow: 0 }
]) {
	const m = await measure({ viewport: arm.vp, mobile: true, inset: arm.inset, hostCss: ':root{--reef-inbox-offset-y:5000px}', openPanel: true, composer: true, grow: arm.grow });
	const problems = [];
	if (!inside(m.panel, arm.vp)) problems.push(`the open panel leaves the screen: ${JSON.stringify(m.panel)}`);
	if (m.panel.top < 16) problems.push(`the open panel is closer than 1rem to the top: ${m.panel.top}`);
	problems.push(...composerProblems(m.controls));
	// Where the panel's corner would be at the requested (50vh-clamped) offset.
	const requestedBottom = arm.vp.height - 16 - (arm.inset?.bottom ?? 0) - arm.vp.height / 2;
	if (!(m.panel.bottom > requestedBottom + 1)) problems.push(`control: the panel sits at the requested offset (bottom ${m.panel.bottom}, requested ${requestedBottom}), so the composer never had to be made room for`);
	check(arm.label, problems, m);
}
// 🩸 THE SAME SHORTFALL SIDEWAYS (tile#199 review r3). A 5000px `-x` clamps to 50vw, so on a 390px
// phone the panel was 163px wide; once the search index loads the button reads「Send to a person」
// (145px), and the textarea was left with no content width at all while the button ran past the
// panel's edge. A 24px root font does the same with the plain「Send」. The open panel's `-x` is now
// lowered by the shortfall like its `-y`, so each arm requires 10ch of text and the whole button,
// and the control requires that the panel really had to move in from the requested offset.
const searchIndex = [{ t: 'example', u: '/example', d: '2026-01-01' }];
for (const arm of [
	{ label: 'phone, offset-x 5000px, search loaded (Send to a person)', hostCss: ':root{--reef-inbox-offset-x:5000px}', hostAttrs: 'data-search-index="/search.json"', searchIndex, waitLabel: 'Send to a person' },
	{ label: 'phone, offset-x 5000px, 24px root font', hostCss: ':root{--reef-inbox-offset-x:5000px;font-size:24px}', waitLabel: 'Send' }
]) {
	const m = await measure({ viewport: PHONE, mobile: true, hostCss: arm.hostCss, hostAttrs: arm.hostAttrs ?? '', searchIndex: arm.searchIndex ?? null, waitLabel: arm.waitLabel, openPanel: true, width: true });
	const problems = widthProblems(m.width, arm.waitLabel);
	if (!inside(m.panel, PHONE)) problems.push(`the open panel leaves the screen: ${JSON.stringify(m.panel)}`);
	const requestedRight = PHONE.width - parseFloat(/font-size:(\d+)px/.exec(arm.hostCss)?.[1] ?? 16) - PHONE.width / 2;
	if (!(m.width.panel.right > requestedRight + 1)) problems.push(`control: the panel sits at the requested offset (right ${m.width.panel.right}, requested ${requestedRight}), so it never had to make room`);
	check(arm.label, problems, m);
}
// And where even offset 0 is too narrow (a 280px screen at a 24px root font, search loaded): the
// button wraps below the textarea, still whole and inside the panel, and the text keeps its 10ch.
// Tall on purpose: at 640px the wrapped composer plus the header and search block outgrow the
// panel's 70dvh, and the panel's own scroll (the last-resort arm below) is what answers that — this
// arm is about the width alone. The control requires that the row really did wrap.
{
	const NARROW = { width: 280, height: 900 };
	const m = await measure({ viewport: NARROW, mobile: true, hostCss: ':root{font-size:24px}', hostAttrs: 'data-search-index="/search.json"', searchIndex, waitLabel: 'Send to a person', openPanel: true, width: true });
	const problems = widthProblems(m.width, 'Send to a person');
	if (!(m.width.button.top >= m.width.textareaBottom - 0.5)) problems.push(`control: the button did not wrap below the textarea: ${JSON.stringify(m.width)}`);
	if (!inside(m.panel, NARROW)) problems.push(`the open panel leaves the screen: ${JSON.stringify(m.panel)}`);
	check('narrow 280px, 24px root font, search loaded: the button wraps', problems, m);
}

// The last resort: a viewport too short for the header and the composer even at offset 0 (the
// panel's own 70dvh cap is under them). Nothing can make room, so the PANEL scrolls: the composer is
// reachable by scrolling it, never cut off behind an overflow that cannot be scrolled.
{
	const SHORT = { width: 640, height: 180 };
	const m = await measure({ viewport: SHORT, mobile: true, openPanel: true, lastResort: true });
	const problems = [];
	const r = m.lastResort;
	if (!inside(m.panel, SHORT)) problems.push(`the open panel leaves the screen: ${JSON.stringify(m.panel)}`);
	if (!(r.scrollHeight > r.clientHeight + 1)) problems.push(`control: the panel was not too short for its own parts (${JSON.stringify(r)}), so this arm measured nothing`);
	if (!r.sendHit || !r.textareaHit) problems.push(`scrolled to the end, the composer is still not reachable: ${JSON.stringify(r)}`);
	check('too short for the composer at offset 0: the panel scrolls to it', problems, m);
}
{
	const m = await measure({ viewport: PHONE, mobile: true, inset: INSET, hostCss: ':root{--reef-inbox-offset-y:-200px;--reef-inbox-offset-x:-200px}' });
	const problems = [];
	const safe = { bottom: PHONE.height - INSET.bottom, right: PHONE.width - INSET.right };
	if (m.bubble.bottom !== safe.bottom - 16 || m.bubble.right !== safe.right - 16) problems.push(`a negative offset was not clamped to 0: bottom ${m.bubble.bottom}, right ${m.bubble.right}`);
	check('phone + inset, offset -200px (clamped at 0)', problems, m);
}
// A value that is not a length must fall back to the base, not drop the whole `right`/`bottom`
// declaration (which would leave the root at its static position in the page: (8,8)). 🩸 r1 held
// this only while the coral's own global `CSS.registerProperty` succeeded (tile#199 review P2-2):
// a browser without the API, or a theme that registered the name first, put the bubble at (8,8).
// So the same invalid values are measured on all three paths, and each must equal the control.
const noRegisterApi = () => { try { delete CSS.registerProperty; } catch {} try { CSS.registerProperty = undefined; } catch {} };
const themeRegistersStar = () => {
	for (const name of ['--reef-inbox-offset-x', '--reef-inbox-offset-y']) CSS.registerProperty({ name, syntax: '*', inherits: true });
};
for (const arm of [
	{ label: 'phone, offset not a length (ignored)', initScript: null },
	{ label: 'phone, offset not a length, no CSS.registerProperty', initScript: noRegisterApi },
	{ label: "phone, offset not a length, theme registered the names syntax:'*'", initScript: themeRegistersStar }
]) {
	const m = await measure({ viewport: PHONE, mobile: true, initScript: arm.initScript, hostCss: ':root{--reef-inbox-offset-y:banana;--reef-inbox-offset-x:12}', openPanel: true });
	const problems = [];
	if (m.bubble.bottom !== phoneControl.bubble.bottom || m.bubble.right !== phoneControl.bubble.right) problems.push(`a non-length offset moved the bubble: ${JSON.stringify(m.bubble)} vs ${JSON.stringify(phoneControl.bubble)}`);
	if (!inside(m.panel, PHONE) || m.panel.width < 300) problems.push(`a non-length offset broke the open panel: ${JSON.stringify(m.panel)}`);
	check(arm.label, problems, m);
}

// 🩸 THE COMMON KNOB IS THE PAGE'S, NOT OURS (tile#199 review P2-3). r1 registered both names with
// `CSS.registerProperty`, and a JS registration outranks a stylesheet's `@property` document-wide: a
// theme that declared `--reef-inbox-offset-y` with `initial-value:80px` lost that 80px on its OWN
// elements the moment the bubble mounted. The coral now only reads the value. So: a page element
// that uses the knob keeps 80px after the mount (and had it before — the control), and the bubble
// honours the theme's 80px exactly like a set value.
{
	const m = await measure({
		viewport: PHONE,
		mobile: true,
		hostCss: '@property --reef-inbox-offset-y{syntax:"<length>";inherits:true;initial-value:80px}#theme-probe{height:var(--reef-inbox-offset-y)}',
		bodyHtml: '<div id="theme-probe"></div><script>window.__themeProbeBefore = getComputedStyle(document.getElementById("theme-probe")).height;</script>'
	});
	const problems = [];
	if (m.pageProbe?.before !== '80px') problems.push(`control: the theme's @property did not give its own element 80px before the mount: ${JSON.stringify(m.pageProbe)}`);
	if (m.pageProbe?.after !== '80px') problems.push(`mounting the bubble changed the theme's own --reef-inbox-offset-y on a page element: ${JSON.stringify(m.pageProbe)}`);
	const dy = phoneControl.bubble.bottom - m.bubble.bottom;
	if (dy !== 80) problems.push(`the theme's @property initial-value 80px moved the bubble up by ${dy}px, not 80px`);
	check("phone, theme @property --reef-inbox-offset-y initial-value 80px", problems, m);
}

await b.close();

if (failures.length) {
	console.error('✗ position smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ position smoke: the bubble clears the safe area, follows the owner\'s offset within its clamps, and its panel stays on screen');
