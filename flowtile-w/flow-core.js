// flow-core — the tile family's POST-OVERVIEW model: given a corpus of posts, a search query and a
// set of active facets, which posts survive and what does each facet offer next.
//
// Deliberately only HALF of flowtile. The overview lives inside ejecta's admin
// page (core/admin/server.mjs, listPage) and, unlike modaltile, it is genuinely part of that page:
// it reaches into ten DOM ids the surrounding HTML owns and calls five ejecta-specific routes, two
// of which (/api/blog-posts-sync, /api/blog-category-post-add) are one storefront's own concepts. So
// moving the whole surface is a DESIGN — what a "post" is to flowtile, which routes are the
// surface's and which are the host's — and that is a call for whoever owns the product, not
// something to invent while moving a file.
//
// What CAN move today is the part that was never about ejecta at all: the model. This is the same
// split pagetile and tugtile already make — `book-core.js` and `board-core.js` are the models, and
// the `-w` directory is a thin host around them. flowtile now has its `-core` too, so looking for
// it by name finds something, which is the whole point of 歸位.
//
// Pure: no DOM, no fetch, no localStorage. Everything here is a function of its arguments.

/**
 * The facet groups, as a SHAPE. No labels and no value formatting — those are i18n, which belongs
 * to the host: ejecta renders them through its own dictionary, and a second surface would render
 * them through a different one. A model that carries display strings is a model with a language.
 */
export const GROUPS = [
  { key: 'status', vals: (p) => [p.status] },
  { key: 'categories', vals: (p) => p.categories || [] },
  { key: 'tags', vals: (p) => p.tags || [], cap: 40 },
  { key: 'years', vals: (p) => (p.year ? [p.year] : []) },
];

/**
 * Does this post survive the current query and facet selection?
 *
 * 🔴 The two combinators are NOT the same, and the difference is the whole feel of the thing:
 * WITHIN a group the selected values are OR (tag:a or tag:b — widen), ACROSS groups they are AND
 * (tag:a and status:draft — narrow). Getting them the same way round makes selecting a second tag
 * return nothing, which reads as a broken filter rather than a wrong one.
 *
 * @param {{query?: string, active?: Record<string, Set<string>>, groups?: object[]}} opts
 *        `query` is matched case-insensitively against the title, and is expected already
 *        lower-cased by the caller (the host lower-cases once per keystroke, not once per post).
 */
export function matchesPost(post, { query = '', active = {}, groups = GROUPS } = {}) {
  if (!post) return false;
  if (query && !String(post.title || '').toLowerCase().includes(query)) return false;
  for (const g of groups) {
    const sel = active[g.key];
    if (!sel || !sel.size) continue;          // an untouched group narrows nothing
    const vals = g.vals(post) || [];
    if (!vals.some((v) => sel.has(v))) return false;
  }
  return true;
}

/** The surviving posts, in corpus order. */
export function filterPosts(posts, opts = {}) {
  return (posts || []).filter((p) => matchesPost(p, opts));
}

/**
 * What one facet group offers: every value present in the corpus, with how many posts carry it.
 *
 * 🩸 Counted over the WHOLE corpus, not the filtered set — matching the behaviour this was
 * extracted from. It means a facet count does not shrink as you select other facets, which is the
 * right call for this UI (the counts stay a stable map of what exists) and the wrong one for a
 * shop-style refinement UI. Written down because "the counts don't update" reads like a bug to
 * anyone who has not been told, and the next surface may genuinely want the other behaviour.
 *
 * @param {'name'|'count'} sort  'name' uses zh-Hant collation — the corpus this was built for is
 *        Chinese, and the default collation orders 一二三 by codepoint, which looks like no order
 *        at all.
 */
export function facetItems(posts, group, { sort = 'name' } = {}) {
  const counts = new Map();
  for (const p of posts || []) {
    for (const v of group.vals(p) || []) {
      if (!v) continue;                        // an absent status/year is not a facet value
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  let items = [...counts.entries()].map(([value, count]) => ({ value, count }));
  items.sort(sort === 'count'
    ? (a, b) => b.count - a.count
    : (a, b) => String(a.value).localeCompare(String(b.value), 'zh-Hant'));
  if (group.cap) items = items.slice(0, group.cap);
  return items;
}

/** Every group's items in one call — what a host needs to draw the whole facet rail. */
export function facetRail(posts, { groups = GROUPS, sort = 'name' } = {}) {
  return groups
    .map((g) => ({ key: g.key, items: facetItems(posts, g, { sort }) }))
    .filter((g) => g.items.length);            // a group with nothing in it is not a group
}

/** Toggle one facet value, returning a NEW active map — the host keeps no mutation rules. */
export function toggleFacet(active, groupKey, value) {
  const next = { ...active };
  const set = new Set(next[groupKey] || []);
  set.has(value) ? set.delete(value) : set.add(value);
  next[groupKey] = set;
  return next;
}
