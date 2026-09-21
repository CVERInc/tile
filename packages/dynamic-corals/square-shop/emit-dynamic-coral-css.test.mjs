// Guard: `--dynamic-coral-css` is a declaration the emitter BAKES and nothing else.
//   run: node packages/dynamic-corals/square-shop/emit-dynamic-coral-css.test.mjs
//
// The flag tells the generated worker where this site's dynamic-coral package CSS belongs in the
// cascade. Its value comes from the site's base `_site.md`, the same read the renderer's
// document-root attribute comes from, so the two cannot disagree about one site.
//
// Three properties, in the order they can break:
//
//   · ABSENT IS LEGACY, and legacy must be the bytes it always was. Every site that never
//     declares keeps unlayered CSS forever — that path is permanent, not a migration window — so
//     an emitter that baked `"legacy"`, or `null`, or an empty string would rewrite every one of
//     them for nothing. Absent flag ⇒ absent key ⇒ the flag might as well not exist.
//   · DECLARED CHANGES ONE THING. This emitter carries the declaration; it does not wrap CSS.
//     The test below diffs a declared worker against an undeclared one and insists the only
//     difference is the config.
//   · A TYPO IS FATAL. `--dynamic-coral-css true` must not quietly pick legacy: the renderer has
//     already stamped a root attribute by then, and a worker that disagreed with it would inject
//     first-paint CSS into the wrong layer of a page that looks correct in review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const emitter = join(here, 'emit-shop-function.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'emit-dynamic-coral-css-'));

// A synthetic origin: this emitter carries no hostname of its own, and what is under test is the
// declaration, not whose backend answers. Same reason emit-site-identity.test.mjs uses one.
const SHOP_API_BASE = 'https://api.example';
const SHOPS = JSON.stringify([{ shopPath: '/shop', labels: {} }]);
const STOREFRONTS = JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]);

let emitted = 0;
function emit(extraArgs) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [emitter,
		'--site-id', 'harbour-press', '--name', 'Harbour Press', '--api', SHOP_API_BASE,
		'--shops', SHOPS, '--storefronts', STOREFRONTS,
		...extraArgs, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return readFileSync(out, 'utf8');
}

function bakedConfig(source) {
	const m = /const CFG = (\{.*\});/.exec(source);
	assert.ok(m, 'could not find the baked config in the emitted worker');
	return JSON.parse(m[1]);
}

const legacy = emit([]);
const layered = emit(['--dynamic-coral-css', 'layered']);

test('absent flag bakes no key at all, and the baked CONFIG carries no trace of it', () => {
	assert.equal('dynamicCoralCss' in bakedConfig(legacy), false);
	// 🔴 Narrowed from a whole-file substring check: the two Worker-emitted CSS points now read
	// this field AT RUNTIME off the config every emission carries (see
	// product-page-core.js's `config.dynamicCoralCss` / shop-function-template.js's own
	// `cfg.dynamicCoralCss`), so that source — concatenated into every generated worker whether or
	// not this flag was passed — legitimately names the field. What "absent flag ⇒ the flag might
	// as well not exist" actually promises is that the BAKED CONFIG this emitter writes carries no
	// trace, which is what the line below still checks exactly; the test right after this one
	// independently proves declaring changes nothing else in the emitted bytes.
	const cfgLine = /const CFG = \{.*\};/.exec(legacy)[0];
	assert.equal(cfgLine.includes('dynamicCoralCss'), false,
		'an undeclared site\'s baked config must carry no trace of the flag');
});

test('the declaration is baked under the config key the worker reads', () => {
	assert.equal(bakedConfig(layered).dynamicCoralCss, 'layered');
});

test('🔴 declaring changes the CONFIG and nothing else — this emitter does not wrap CSS', () => {
	const a = bakedConfig(legacy);
	const b = bakedConfig(layered);
	delete b.dynamicCoralCss;
	assert.deepEqual(b, a, 'no other baked value may move when a site declares');
	// Line-for-line: the only lines that may differ are the ones carrying the baked config (the
	// worker's own `const CFG`, and the template's header comment, which quotes it verbatim).
	const before = legacy.split('\n');
	const differing = layered.split('\n').filter((line, i) => line !== before[i]);
	assert.ok(differing.length > 0, 'the declaration must reach the worker at all');
	for (const line of differing) {
		assert.ok(line.includes('"dynamicCoralCss":"layered"'),
			`only the baked config may change, but this line did: ${line.slice(0, 120)}`);
	}
	assert.ok(differing.some((line) => line.includes('const CFG = ')), 'the worker\'s own config must carry it');
});

test('🔴 an unrecognised value fails the build closed, naming the flag and the value', () => {
	for (const bad of ['true', 'yes', 'reef.base', 'Layered', 'unlayered', 'legacy']) {
		let err = null;
		try { emit(['--dynamic-coral-css', bad]); } catch (e) { err = e; }
		assert.ok(err, `"${bad}" must not emit a worker`);
		assert.equal(err.status, 2, 'the emitter refuses with its usual exit code');
		const said = String(err.stderr || '');
		assert.match(said, /--dynamic-coral-css/);
		assert.ok(said.includes(JSON.stringify(bad)), `the error must quote the bad value, got: ${said}`);
		assert.match(said, /layered/);
	}
});

test('CONTROL: a shopless site still emits, declared or not', () => {
	// Every site gets a worker, not only the ones with a storefront — the declaration must not
	// have quietly become a shop-only flag.
	const out = join(workDir, 'worker-shopless.mjs');
	execFileSync('node', [emitter, '--name', 'Plain Site', '--dynamic-coral-css', 'layered', '--out', out],
		{ stdio: ['ignore', 'ignore', 'pipe'] });
	assert.equal(bakedConfig(readFileSync(out, 'utf8')).dynamicCoralCss, 'layered');
});
