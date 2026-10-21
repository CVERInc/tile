// reef#2159/#2160: the bubble's in-site filter is a VERBATIM COPY of the blog-search module's — a
// coral has no imports, so it cannot share the file. This is the gate that makes「verbatim」a fact
// rather than a comment: the two SHARED-FILTER blocks must be byte-identical, and the copy must
// behave like the original on the same index.
//   run: node --test packages/dynamic-corals/inbox-bubble/search-filter-sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BEGIN = '// ── SHARED-FILTER-BEGIN';
const END = '// ── SHARED-FILTER-END ──';
const block = (src, where) => {
	const b = src.indexOf(BEGIN);
	const e = src.indexOf(END);
	assert.ok(b >= 0 && e > b, `${where}: no SHARED-FILTER block`);
	assert.equal(src.indexOf(BEGIN, b + 1), -1, `${where}: two SHARED-FILTER blocks`);
	return src.slice(b, e + END.length);
};

const moduleSrc = readFileSync(new URL('../../sitetile/astro/src/packages/blog-search/search-filter.mjs', import.meta.url), 'utf8');
const coralSrc = readFileSync(new URL('./inbox-bubble.js', import.meta.url), 'utf8');

test('🔴 inbox-bubble.js carries search-filter.mjs\'s SHARED-FILTER block byte for byte', () => {
	assert.equal(block(coralSrc, 'inbox-bubble.js'), block(moduleSrc, 'search-filter.mjs'),
		'the bubble\'s filter drifted from the module — edit search-filter.mjs, then paste the block into inbox-bubble.js');
});

test('the copy ranks a query exactly as the module does, on the same rows', async () => {
	const { filterIndex } = await import('../../sitetile/astro/src/packages/blog-search/search-filter.mjs');
	// The coral does not export its copy (nothing in it is public API); evaluate the block itself.
	const copy = new Function(`${block(coralSrc, 'inbox-bubble.js')}\nreturn filterIndex;`)();
	const rows = [
		{ t: 'Café notes', u: '/a', g: ['coffee'], d: '2025-10-31' },
		{ t: '深空眠', u: '/b', g: ['sleep'], d: '2025-11-11', e: 'cafe talk' },
		{ t: 'Zed', u: '/c', g: [], d: '' },
	];
	for (const q of ['cafe', 'CAFÉ', '空', 'zed', '', 'none']) {
		assert.deepEqual(copy(rows, q, 8), filterIndex(rows, q, 8), `query ${JSON.stringify(q)}`);
	}
});
