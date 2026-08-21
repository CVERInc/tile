// Every section carries the id the parser already computed for it.
//   run: node packages/sitetile/section-anchor.test.mjs
//
// 🩸 2026-08-18. `parseSite` has computed `id: 's<n>-<slug>'` for every section since it was
// written, and NOTHING has ever read it — measured across site-core.js (zero `.id` reads, zero
// destructures) and confirmed against live cver.net, whose entire homepage carried exactly one
// `id` attribute, belonging to a locale banner. A value computed on every parse and discarded
// every time.
//
// It is being emitted now because KAITO cites its answers, and a citation that only names the PAGE
// hands a reader an article and tells them the sentence is in there somewhere. With the id it can
// point at the passage.
//
// 🔴 WHY THIS FILE EXISTS RATHER THAN A SPOT CHECK. There are fifteen-plus hand-written
// `<section ...>` strings inside renderSection. The id is stamped at the single seam above them so
// that none can be missed — and this test is what proves that claim, by rendering EVERY section
// type the grammar has and asserting each one came back with an id. A missing anchor is invisible
// in use: the link still resolves, the page still loads, it just lands at the top, which reads as
// "the citation is vague" and not as a defect. Nothing else would go red.

import assert from 'node:assert/strict';
import { parseSite, renderSiteToHtml, slugify } from './site-core.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/** Render one markdown site and hand back its HTML. */
const render = (md) => renderSiteToHtml(parseSite(md));

/** Every `<section id="...">` in document order. */
const sectionIds = (html) => [...html.matchAll(/<section\b[^>]*\sid="([^"]*)"/g)].map((m) => m[1]);

/** Every opening `<section` tag, so "how many got one" can be compared to "how many exist". */
const sectionCount = (html) => (html.match(/<section\b/g) || []).length;

const FRONT = '---\ntitle: T\n---\n\n';

// ── One section type per case, named exactly as the grammar names them ──────
//
// 🔴 The list is the point. A test that renders `prose` and calls it a day
// proves nothing about `faq`, and `faq` is a likely thing for a visitor to have
// a question answered from.
const TYPES = {
	prose: '## 服務範圍\n\n我們提供 Live2D 建模。',
	hero: '## 歡迎\n%% sitetile: hero %%\n\n第一句話。',
	grid: '## 主打課程\n%% sitetile: grid %%\n\n### 動畫班\n內容。\n\n### 進階班\n內容。',
	cta: '## 現在開始\n%% sitetile: cta %%\n\n來信詢問。',
	faq: '## 常見問題\n%% sitetile: faq %%\n\n### 要多久？\n約兩週。',
	gallery: '## 作品\n%% sitetile: gallery %%\n\n### 一\n圖說。',
	people: '## 團隊\n%% sitetile: people %%\n\n### 小紅\n職稱。',
	timeline: '## 沿革\n%% sitetile: timeline %%\n\n### 2024\n成立。',
	collection: '## 選集\n%% sitetile: collection %%\n\n### 一\n內容。',
	social: '## 追蹤我們\n%% sitetile: social %%\n\n來看看。',
	carousel: '## 輪播\n%% sitetile: carousel %%\n\n### 一\n圖說。'
};

console.log('section anchors');

for (const [type, md] of Object.entries(TYPES)) {
	const html = render(FRONT + md);
	const ids = sectionIds(html);
	const total = sectionCount(html);
	assert.ok(total >= 1, `${type}: rendered no <section> at all — the fixture is wrong, not the code`);
	assert.equal(
		ids.length,
		total,
		`${type}: ${total} section(s) rendered but only ${ids.length} carried an id`
	);
	assert.ok(ids[0].length > 0, `${type}: id is empty`);
	ok(`${type} — ${total} section(s), all with an id (${ids[0]})`);
}

// ── The id's shape, because KAITO has to be able to compute the same string ──

{
	const html = render(FRONT + '## 服務範圍\n\n第一段。\n\n## 常見問題\n\n第二段。');
	const ids = sectionIds(html);
	assert.deepEqual(ids, ['s1-' + slugify('服務範圍', ''), 's2-' + slugify('常見問題', '')]);
	ok('id is `s<ordinal>-<slugify(title)>`, numbered from 1 in document order');
}

{
	// 🔴 The anchor has to survive the titles customers actually write. A fixture
	// of `Section One` would pass while every real Japanese heading collapsed to
	// the fallback — `move-the-specimen-not-the-ruler`.
	for (const title of ['LIVE2D制作', 'よくある質問', '料金・お支払い', 'R18作品', 'Q&A — 2024']) {
		const html = render(FRONT + `## ${title}\n\n本文。`);
		const [id] = sectionIds(html);
		assert.ok(id && id.startsWith('s1-'), `title ${JSON.stringify(title)} produced ${id}`);
		assert.ok(!/["<>\s]/.test(id), `id ${JSON.stringify(id)} is not attribute-safe`);
	}
	ok('real CJK / punctuated titles produce attribute-safe ids');
}

{
	// A section with no title still gets an id — it is still a citable place.
	const html = render(FRONT + '## \n\n沒有標題的段落。');
	const ids = sectionIds(html);
	assert.ok(ids.length >= 1 && ids[0].startsWith('s'), `untitled section got ${JSON.stringify(ids)}`);
	ok('an untitled section still gets an ordinal id');
}

{
	// 🔴 The control: prove the assertion above can FAIL. If `withSectionId`
	// silently did nothing, every case above would still find `<section` tags and
	// only the id count would drop — so this checks that the count is what is
	// actually being measured, not that the regex matches something.
	const html = render(FRONT + '## 一\n\n甲。\n\n## 二\n\n乙。');
	assert.equal(sectionCount(html), 2);
	const stripped = html.replace(/\sid="[^"]*"/g, '');
	assert.equal(sectionIds(stripped).length, 0);
	assert.notEqual(sectionIds(html).length, sectionIds(stripped).length);
	ok('control — with the ids removed the same assertion goes red');
}

{
	// An `embed` section's body may itself contain a `<section>`. Only the
	// OUTER, opening tag may be stamped; rewriting one inside someone's embedded
	// markup would be editing their HTML.
	const html = render(
		FRONT + '## 外層\n%% sitetile: embed %%\n\n<section class="theirs"><p>他們的</p></section>'
	);
	assert.equal(sectionIds(html).length, 1, 'stamped more than the outer section');
	assert.ok(/<section class="theirs">/.test(html), 'rewrote the author’s own <section>');
	ok('an embedded <section> in the body is left alone');
}

console.log(`\n${passed} passed`);
