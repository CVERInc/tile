// flow-core — the post-overview model, extracted from ejecta's admin page 2026-08-02.
//   run: node --test packages/flowtile/flow-core.test.mjs
//
// It had no tests where it came from, because it was 139 lines of inline <script> inside a template
// literal inside a 6,184-line server — nothing could import it. That is the argument for the split:
// a model that lives in a string is a model nobody can check.

import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUPS, matchesPost, filterPosts, facetItems, facetRail, toggleFacet } from './flow-core.js';

const P = (over = {}) => ({ stem: 'x', title: 'Hello', status: 'publish', categories: [], tags: [], year: '2026', ...over });
const CORPUS = [
  P({ stem: 'a', title: '外科訓練', status: 'publish', tags: ['臨床', '雜談'], categories: ['醫學'], year: '2026' }),
  P({ stem: 'b', title: '值班日記', status: 'draft', tags: ['雜談'], categories: ['生活'], year: '2025' }),
  P({ stem: 'c', title: 'Surgery notes', status: 'publish', tags: ['臨床'], categories: ['醫學'], year: '2025' }),
];

test('no query and no facets ⇒ everything survives', () => {
  assert.equal(filterPosts(CORPUS).length, 3);
});

test('the query matches the TITLE, case-insensitively', () => {
  assert.deepEqual(filterPosts(CORPUS, { query: 'surgery' }).map((p) => p.stem), ['c']);
  assert.deepEqual(filterPosts(CORPUS, { query: '值班' }).map((p) => p.stem), ['b']);
  assert.deepEqual(filterPosts(CORPUS, { query: 'nothing here' }), []);
});

test('🔴 WITHIN a group the values are OR — selecting a second tag WIDENS', () => {
  // The failure this guards reads as a broken filter rather than a wrong one: if within-group were
  // AND, picking a second tag would return nothing, every time.
  const one = filterPosts(CORPUS, { active: { tags: new Set(['臨床']) } });
  const two = filterPosts(CORPUS, { active: { tags: new Set(['臨床', '雜談']) } });
  assert.deepEqual(one.map((p) => p.stem), ['a', 'c']);
  assert.deepEqual(two.map((p) => p.stem), ['a', 'b', 'c']);
  assert.ok(two.length > one.length, 'a second value in the same group must widen');
});

test('🔴 ACROSS groups the values are AND — adding a second facet NARROWS', () => {
  const r = filterPosts(CORPUS, { active: { tags: new Set(['臨床']), status: new Set(['draft']) } });
  assert.deepEqual(r.map((p) => p.stem), [], 'no post is both 臨床 and draft');
  const r2 = filterPosts(CORPUS, { active: { tags: new Set(['雜談']), status: new Set(['draft']) } });
  assert.deepEqual(r2.map((p) => p.stem), ['b']);
});

test('an empty selection in a group narrows nothing', () => {
  // An untouched group and a group whose last value was just deselected must behave the same.
  assert.equal(filterPosts(CORPUS, { active: { tags: new Set() } }).length, 3);
  assert.equal(filterPosts(CORPUS, { active: {} }).length, 3);
});

test('query and facets combine', () => {
  const r = filterPosts(CORPUS, { query: '外科', active: { status: new Set(['publish']) } });
  assert.deepEqual(r.map((p) => p.stem), ['a']);
});

test('matchesPost survives junk without throwing', () => {
  assert.equal(matchesPost(null), false);
  assert.equal(matchesPost(P({ title: undefined }), { query: 'x' }), false);
  assert.equal(matchesPost(P({ tags: undefined }), { active: { tags: new Set(['t']) } }), false);
});

test('facetItems counts values across the corpus', () => {
  const tags = facetItems(CORPUS, GROUPS.find((g) => g.key === 'tags'), { sort: 'count' });
  assert.deepEqual(tags, [{ value: '臨床', count: 2 }, { value: '雜談', count: 2 }]);
  const years = facetItems(CORPUS, GROUPS.find((g) => g.key === 'years'), { sort: 'count' });
  assert.deepEqual(years, [{ value: '2025', count: 2 }, { value: '2026', count: 1 }]);
});

test('an empty or absent value is never a facet value', () => {
  const corpus = [P({ status: '' }), P({ status: undefined }), P({ status: 'draft' })];
  assert.deepEqual(facetItems(corpus, GROUPS.find((g) => g.key === 'status')), [{ value: 'draft', count: 1 }]);
});

test('🩸 counts are over the WHOLE corpus, not the filtered set', () => {
  // Matching what this was extracted from. Pinned because "the counts don't update" reads like a
  // bug to anyone who has not been told, and a future surface may genuinely want the other one.
  const filtered = filterPosts(CORPUS, { active: { status: new Set(['draft']) } });
  assert.equal(filtered.length, 1);
  const tagsFromWhole = facetItems(CORPUS, GROUPS.find((g) => g.key === 'tags'));
  assert.equal(tagsFromWhole.find((i) => i.value === '臨床').count, 2, 'still 2, though only 1 post is showing');
});

test('sort by name uses zh-Hant collation, not codepoint order', () => {
  // The corpus this was built for is Chinese; default collation orders 一二三 by codepoint, which
  // looks like no order at all.
  const corpus = [P({ tags: ['三'] }), P({ tags: ['一'] }), P({ tags: ['二'] })];
  const byName = facetItems(corpus, GROUPS.find((g) => g.key === 'tags'), { sort: 'name' }).map((i) => i.value);
  const byCodepoint = ['三', '一', '二'].sort();
  assert.deepEqual(byName, ['一', '三', '二'].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  assert.notDeepEqual(byName, byCodepoint, 'collation must actually differ from a naive sort here');
});

test('a group cap truncates AFTER sorting, so the cap keeps the top N', () => {
  const many = Array.from({ length: 60 }, (_, i) => P({ tags: [`t${String(i).padStart(2, '0')}`] }));
  const items = facetItems(many, GROUPS.find((g) => g.key === 'tags'), { sort: 'name' });
  assert.equal(items.length, 40, 'the tags group caps at 40');
  assert.equal(items[0].value, 't00');
});

test('facetRail drops groups that have nothing in them', () => {
  const corpus = [P({ tags: [], categories: [], status: 'draft', year: '' })];
  const rail = facetRail(corpus);
  assert.deepEqual(rail.map((g) => g.key), ['status']);
});

test('toggleFacet returns a NEW map and never mutates the old one', () => {
  const a = {};
  const b = toggleFacet(a, 'tags', 'x');
  assert.equal(Object.keys(a).length, 0, 'the original is untouched');
  assert.deepEqual([...b.tags], ['x']);
  const c = toggleFacet(b, 'tags', 'x');
  assert.deepEqual([...c.tags], [], 'toggling the same value clears it');
  assert.deepEqual([...b.tags], ['x'], 'and the previous state is still intact');
});
