// The closed bubble's SHAPE, in a real browser, under a page that styles every button (reef#2139).
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/inbox-bubble/shape.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/inbox-bubble/
//
// 🩸 WHY THIS EXISTS. reef#2139: a visitor's screenshot showed the black bubble as something other
// than a circle, on a site whose own CSS touches no button at all. Chromium with the coral's own
// stylesheet was a circle at every dpr, under forced-colors and at a 20px root — the ONLY way to
// reshape it was a rule from outside: `button{min-width:88px}` turned it into an 88×56 capsule.
// Up to 0.7.12 the bubble sat in the light DOM behind a single class (specificity 0,1,0) that set
// width, height, radius and padding and nothing else, so every property it left unset — min-width,
// box-sizing, aspect-ratio, flex sizing, appearance — was the page's (or a browser extension's
// cosmetic CSS) to fill in. On a host that declares the layered mode it was worse: an unlayered
// `button{border-radius:4px}` beats every layered rule regardless of specificity.
//
// 🔴 THE HOSTILE ARMS NEED A CONTROL, same as honeypot.smoke.mjs: "the bubble stayed round under a
// hostile host rule" is only a finding if the rule actually applied, so every hostile arm also
// measures one of the host's OWN buttons and requires min-width 88px to have taken there.
//
// 🔴 THE CUSTOM PROPERTIES ARE MEASURED, NOT ASSUMED. Isolating the bubble must not cost the owner
// the two colour knobs the README promises (`--reef-inbox-accent`, `--reef-inbox-on-accent`) or the
// site's own font — custom properties and `font` inherit into a shadow tree, and this is what
// checks that they still arrive.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node shape.smoke.mjs <url of packages/dynamic-corals/inbox-bubble/>');
const fixtureUrl = new URL('__shape-host.html', base).href;
const coralUrl = new URL('inbox-bubble.js', base).href;

// The page from the brief: every button a padded, square-cornered, 88px-minimum box, and a reset
// that puts every element back on content-box sizing.
const HOSTILE = 'button{min-width:88px;padding:1em;border-radius:4px} *{box-sizing:content-box}';
// A site theme's own knobs, uneven on purpose so a default can never pass for an inherited value.
const THEME = ':root{--reef-inbox-accent:rgb(1, 2, 3);--reef-inbox-on-accent:rgb(250, 240, 230)}' +
	' body{font-family:"Smoke Serif Probe", Georgia, serif}';

const hostPage = ({ layered, hostCss }) => `<!doctype html>
<html lang="en"${layered ? ' data-dynamic-coral-css="layered"' : ''}><head><meta charset="utf-8">
<style>${THEME} ${hostCss}</style></head><body>
<button id="host-button" type="button">host</button>
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="shape-smoke"
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
		// The tenant has an Inbox: without a yes from the claim probe the coral draws no bubble at all.
		if (u.includes('/api/inbox/session') && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, claimed: true }) });
		return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	await p.goto(fixtureUrl, { waitUntil: 'load', timeout: 20000 });
	// Playwright's CSS engine pierces open shadow roots, so this waits for the bubble wherever it is.
	await p.waitForSelector('.dc-inbox-open', { timeout: 10000 });

	const m = await p.evaluate(() => {
		// Walks open shadow roots too — the bubble may live in one (0.7.13) or not (0.7.12), and the
		// measurement has to be the same measurement on both.
		const find = (root, sel) => {
			const hit = root.querySelector(sel);
			if (hit) return hit;
			for (const e of root.querySelectorAll('*')) {
				const inner = e.shadowRoot && find(e.shadowRoot, sel);
				if (inner) return inner;
			}
			return null;
		};
		const box = (el) => {
			const r = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			return {
				width: r.width, height: r.height,
				radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
				minWidth: cs.minWidth, boxSizing: cs.boxSizing,
				background: cs.backgroundColor, color: cs.color, fontFamily: cs.fontFamily
			};
		};
		const open = find(document, '.dc-inbox-open');
		const root = find(document, '.dc-inbox-root');
		return {
			bubble: open && box(open),
			rootFont: root && getComputedStyle(root).fontFamily,
			// Isolation itself: a page script's (or an extension's) document-level selector finds nothing.
			pageCanSelect: !!document.querySelector('.dc-inbox-open'),
			host: box(document.getElementById('host-button'))
		};
	});

	const problems = [];
	if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
	const bb = m.bubble;
	if (!bb) problems.push('no closed bubble rendered');
	else {
		if (bb.width !== 56 || bb.height !== 56) problems.push(`bubble box is ${bb.width}×${bb.height}, not 56×56`);
		if (!bb.radii.every((r) => r === '50%')) problems.push(`bubble radius is ${bb.radii.join(' ')}, not 50%`);
		if (bb.background !== 'rgb(1, 2, 3)') problems.push(`--reef-inbox-accent did not reach the bubble: background ${bb.background}`);
		if (bb.color !== 'rgb(250, 240, 230)') problems.push(`--reef-inbox-on-accent did not reach the bubble: color ${bb.color}`);
	}
	if (!m.rootFont || !m.rootFont.includes('Smoke Serif Probe')) problems.push(`the site's font did not reach the panel root: ${m.rootFont}`);
	if (m.pageCanSelect) problems.push('document.querySelector(".dc-inbox-open") reaches the bubble — it is not isolated');
	if (hostCss && m.host.minWidth !== '88px') {
		problems.push(`control: the host rule did not take on the host's own button ${JSON.stringify(m.host)}`);
	}
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  bubble=${JSON.stringify(bb)}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
	await ctx.close();
}

await arm({ label: 'legacy, no host CSS', layered: false, hostCss: '' });
await arm({ label: 'legacy, hostile button rules', layered: false, hostCss: HOSTILE });
await arm({ label: 'layered, no host CSS', layered: true, hostCss: '' });
await arm({ label: 'layered, hostile button rules', layered: true, hostCss: HOSTILE });
await b.close();

if (failures.length) {
	console.error('✗ shape smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ shape smoke: the bubble is a 56×56 circle in the site\'s colours in every arm');
