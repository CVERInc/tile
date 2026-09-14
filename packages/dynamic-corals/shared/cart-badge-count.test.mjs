// The badge algorithm must exist ONCE.
//
// Review round 3, P3-4: "sum e[1] over the rows" had three implementations — sitetile's header
// island, the product detail page's inline script, and a copy inside the very test that asserts
// the badge equals the checkout POST. All three agreed on the day they were measured. That is
// what three copies buy you: they agree until they do not, and the test that would have noticed
// is one of the copies.
//
// Two of the consumers cannot import (see ./cart-badge-count.mjs for why — a raw published
// artifact, and a file concatenated into every site's _worker.js). So the rule here is the one
// ./close-button.test.mjs uses: the module is the original, the consumers carry a MIRROR, and this
// file asserts the mirrored text is the module's own toString() output character for character.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartRowQty, cartBadgeCount } from './cart-badge-count.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const CORAL = join(HERE, '../square-shop/square-shop.js');
const PRODUCT_PAGE = join(HERE, '../square-shop/product-page-core.js');
const ISLAND = join(ROOT, 'packages/sitetile/astro/src/packages/header-actions/header-actions-cart.js');

const read = (p) => readFileSync(p, 'utf8');

test('the coral mirrors cartRowQty character for character', () => {
	assert.ok(read(CORAL).includes(String(cartRowQty)),
		'square-shop.js no longer carries this module’s cartRowQty verbatim. It cannot import ' +
		'(build.mjs publishes it as a raw artifact and feelreef vendors it unmodified), so a ' +
		'mirror pinned here is the only thing keeping the two one implementation.');
});

test('the product page mirrors both functions character for character', () => {
	const src = read(PRODUCT_PAGE);
	assert.ok(src.includes(String(cartRowQty)), 'product-page-core.js lost the cartRowQty mirror');
	assert.ok(src.includes(String(cartBadgeCount)), 'product-page-core.js lost the cartBadgeCount mirror');
});

test('the product page still has no imports — the mirror is why', () => {
	// emit-shop-function.mjs CONCATENATES this file with the worker template: "both source files
	// are ES modules with no imports, so concatenation yields one valid module". An import here
	// does not break a test, it breaks every site's dist/_worker.js.
	const offending = read(PRODUCT_PAGE).split('\n').filter((l) => /^\s*import\s/.test(l));
	assert.deepEqual(offending, [], 'product-page-core.js may never import anything');
});

test('the header island imports the real function instead of mirroring it', () => {
	const src = read(ISLAND);
	const m = /import \{ cartBadgeCount \} from '([^']+)';/.exec(src);
	assert.ok(m, 'header-actions-cart.js must import cartBadgeCount, not re-implement it');
	assert.ok(existsSync(resolve(dirname(ISLAND), m[1])),
		`the island's import path does not resolve: ${m[1]}`);
});

test('no fourth copy of the sum is loose in the tree', () => {
	// The mirrors are the only places this expression may appear. Strip them, then look for it.
	// Review round 5, P3-2: this used to grep one literal shape (`parseInt(e[1]`), so a fourth
	// copy written as `Number(e[1])`, `+e[1]`, or `e[1] | 0` slipped straight past it — the same
	// index read, just spelled differently. Widened to catch those too.
	const mirrors = [String(cartRowQty), String(cartBadgeCount)];
	const FOURTH_COPY_SHAPES = [
		/parseInt\(e\[1\]/,
		/Number\(e\[1\]\)/,
		/\+e\[1\]/,
		/e\[1\]\s*\|\s*0/
	];
	for (const file of [CORAL, PRODUCT_PAGE, ISLAND]) {
		let src = read(file);
		for (const m of mirrors) src = src.split(m).join('');
		for (const shape of FOURTH_COPY_SHAPES) {
			assert.ok(!shape.test(src),
				`${file} sums e[1] somewhere outside the pinned mirror (shape ${shape}) — that is a fourth copy`);
		}
	}
});

// ── and the behaviour the mirrors are pinned to ──────────────────────────────

const SHAPES = [
	{ what: 'an empty basket', rows: [], held: [], n: 0 },
	{ what: 'two ordinary rows', rows: [['A', 1], ['B', 2]], held: [], n: 3 },
	{ what: 'one of them held', rows: [['A', 1], ['B', 2]], held: ['B'], n: 1 },
	{ what: 'all of them held', rows: [['A', 1], ['B', 2]], held: ['A', 'B'], n: 0 },
	{ what: 'a held row nobody told us about', rows: [['A', 3]], held: [], n: 3 },
	{ what: 'a 0.11.15 row, migration read', rows: [['A', 0, 3]], held: [], n: 3 },
	{ what: "0.11.15's own corrupted row", rows: [['A', 1, 3]], held: [], n: 3 },
	{ what: 'a row with no quantity at all', rows: [['A']], held: [], n: 1 },
	{ what: 'rows no writer here understands', rows: [['A', 2], { x: 1 }, [], 's', [null, 4]], held: [], n: 2 },
	{ what: 'a quantity above the stepper cap', rows: [['A', 500]], held: [], n: 99 }
];

for (const s of SHAPES) {
	test(`badge: ${s.what}`, () => {
		assert.equal(cartBadgeCount(s.rows, s.held), s.n);
	});
}

test('a basket that is not an array counts zero rather than throwing', () => {
	assert.equal(cartBadgeCount(null), 0);
	assert.equal(cartBadgeCount({ rows: [] }), 0);
	assert.equal(cartBadgeCount([['A', 1]], 'not-a-list'), 1);
});
