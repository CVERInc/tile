// REEF with Blog — THE one filter over /search-index.json (reef#2159, reef#2160).
//
// Three entrances read the same index: the header magnifier overlay, the /search page (both in
// blog-search.js) and the inbox bubble (packages/dynamic-corals/inbox-bubble/inbox-bubble.js).
// This module is the filter all of them run, so a query ranks the same wherever it is typed.
//
// 🔴 THE BUBBLE CARRIES A VERBATIM COPY, NOT AN IMPORT. A dynamic coral is hand-written and
// self-contained (no imports, nothing to bundle — see its package.json), so it cannot import this
// file. The block between the SHARED-FILTER markers below is copied into inbox-bubble.js byte for
// byte, and packages/dynamic-corals/inbox-bubble/search-filter-sync.test.mjs fails the moment the
// two drift. Edit HERE, then paste the block there; the test is the gate, not this sentence.
//
// CJK-safe by design: a substring match over NFC-folded, lowercased, diacritic-stripped text needs
// no tokenizer — Chinese/Japanese/Korean queries match naturally (no word boundaries to guess) and
// Latin accents fold (café == cafe). Honest scope: substring, not fuzzy / stemming / pinyin.

// ── SHARED-FILTER-BEGIN (verbatim in inbox-bubble.js) ──
/** fold: NFC → lowercase → strip combining diacritics. CJK passes through untouched. */
function fold(s) {
	return String(s == null ? '' : s)
		.normalize('NFC').toLowerCase()
		.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Substring filter over an index of `{t,u,g,d,i,e?}` rows. Title hits sort before tag/excerpt-only
 * hits; an empty or whitespace-only query, or no index, is no results. At most `max` rows.
 */
function filterIndex(index, q, max) {
	const nq = fold(q).trim();
	if (!nq || !Array.isArray(index)) return [];
	const titleHits = [];
	const rest = [];
	for (const row of index) {
		if (fold(row.t).indexOf(nq) !== -1) { titleHits.push(row); continue; }
		const g = fold(Array.isArray(row.g) ? row.g.join(' ') : (row.g || ''));
		const e = fold(row.e || '');
		if (g.indexOf(nq) !== -1 || e.indexOf(nq) !== -1) rest.push(row);
	}
	return titleHits.concat(rest).slice(0, max);
}
// ── SHARED-FILTER-END ──

export { fold, filterIndex };
