// REEF with Blog — the blog-archive island. Pure front-end, zero backend: when the blog
// index is opened with a `?tag=` or `?ym=YYYY-MM` deep link (from the sidebar tag cloud or
// year→month archive tree), it fetches the build-time /search-index.json ONCE and rebuilds
// the `.bl-list` from the FULL corpus, not just the ~10 posts the server rendered into the
// page.
//
// Why an island and not a DOM hide/show: the archive/tag-cloud sidebar advertises real
// per-tag/per-month COUNTS (e.g. "2015 年 4 月（41）") derived from the whole corpus, but a
// paginated index only holds one page of `.bl-entry` nodes (page-size, ~10). The old
// hide/show filter could only narrow those ~10 — so "2015 年 4 月（41）" showed a BLANK list
// (none of the recent 10 are from 2015) and an old tag showed 10 unrelated recent posts. A
// counted affordance that navigates to nothing is a phantom feature; this island makes the
// count truthful by rendering every matching post from the index. This is the site's
// "static substrate + dynamic island" doctrine: the page ships static (recent set, works
// with no JS), and the full-history archive is a JS island over the same build-time index
// the search overlay already uses — NOT a brute-force static page per month/tag (that would
// be cloning WP's server-side query, the wrong axis for a native recast).
//
// Self-gating: no-op unless a `.bl-list` exists AND a `?tag=`/`?ym=` param is present. Sites
// with the tag-PILL row keep their instant in-page pill toggle — pills carry no count
// and sit on small corpora, so they're not phantoms; this island only owns the counted,
// full-history sidebar deep links.
//
// XSS-safe by construction: every cell is built with createElement + textContent (never
// innerHTML / set:html), so a post title/tag carrying markup renders as literal text — the
// same discipline as blog-search.js and the age-gate island.
(function () {

  // Chrome copy comes from the server (SiteLayout emits <script type="application/json" data-bl-copy>).
  // 🩸 this file used to hold its own Chinese literals — '沒有符合的文章', '✕ 清除篩選' and a
  // `${y} 年 ${m} 月` label — so a Japanese, Korean or English site's filtered view spoke a language
  // its owner never chose. Keeping the tables server-side means one table, not a second copy compiled
  // into a bundle that no locale test can see. Fallbacks are English rather than the old Chinese: if
  // the blob is missing, the honest default is the platform's neutral one.
  const COPY = (() => {
    const fallback = { noMatches: 'No matching posts', clearFilter: '\u2715 Clear filter', countWrap: [' (', ')'], ym: {},
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
    try {
      const el = document.querySelector('script[type="application/json"][data-bl-copy]');
      if (!el) return fallback;
      const parsed = JSON.parse(el.textContent || '{}');
      return {
        noMatches: parsed.noMatches || fallback.noMatches,
        clearFilter: parsed.clearFilter || fallback.clearFilter,
        countWrap: Array.isArray(parsed.countWrap) && parsed.countWrap.length === 2 ? parsed.countWrap : fallback.countWrap,
        months: Array.isArray(parsed.months) && parsed.months.length === 12 ? parsed.months : fallback.months,
        ym: parsed.ym && typeof parsed.ym === 'object' ? parsed.ym : {},
      };
    } catch { return fallback; }
  })();
  const list = document.querySelector('.bl-list');
  if (!list) return;

  // Blogger-label routes (/search/label/<tag>) carry their OWN filter script and take their tag
  // from the PATH, not a ?tag= query — this island only understands query params, so letting it
  // run there would drop the label's tag constraint (a ?ym= link would filter the whole corpus by
  // month, ignoring the label) AND double-wire the pills. Those routes are a separate opt-in
  // (blog-label-routes) with far smaller per-tag sets; leave them to their inline script.
  if (location.pathname.indexOf('/search/label/') !== -1) return;

  // ── tag-PILL wiring (unchanged behaviour for pill sites) ──
  // Instant in-page hide/show of the loaded entries. Runs regardless of URL params so a
  // pill-driven blog with no ?tag deep link still filters. No-op when the pill row is absent
  // (a site using the sidebar cloud hides it instead).
  (function wirePills() {
    const root = document.querySelector('[data-tag-filter]');
    if (!root) return;
    root.hidden = false;
    const pills = [...root.querySelectorAll('.bl-filter-pill')];
    const applyInPage = (tag) => {
      for (const li of list.querySelectorAll('.bl-entry')) {
        const ts = (li.dataset.tags || '').split('|').filter(Boolean);
        li.style.display = tag === '*' || ts.includes(tag) ? '' : 'none';
      }
      for (const pill of pills) pill.classList.toggle('is-active', pill.dataset.tag === tag);
    };
    for (const pill of pills) pill.addEventListener('click', () => {
      applyInPage(pill.classList.contains('is-active') && pill.dataset.tag !== '*' ? '*' : pill.dataset.tag);
    });
  })();

  // ── full-corpus deep-link filter (?tag= / ?ym=) ──
  const params = new URLSearchParams(location.search);
  const wantTag = params.get('tag');
  const wantYm = params.get('ym');
  if (!wantTag && !wantYm) return; // no deep link → leave the server-rendered recent set as-is

  // Mirror whatever card shape the server rendered for the recent set, so a filtered card
  // is visually identical: detect the date style + the "read more" label from the initial DOM.
  const firstEntry = list.querySelector('.bl-entry');
  const badgeMode = !!(firstEntry && firstEntry.querySelector('.bl-date-badge'));
  const rmEl = firstEntry && firstEntry.querySelector('.bl-read-more');
  const readMore = rmEl ? rmEl.textContent : '';

  fetch('/search-index.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return; // index off/empty → keep recent set
      let hits = rows;
      if (wantYm) hits = hits.filter((x) => String(x.d || '').slice(0, 7) === wantYm);
      if (wantTag) hits = hits.filter((x) => Array.isArray(x.g) && x.g.includes(wantTag));
      render(hits);
    })
    .catch(() => { /* network fail → leave the static recent set, no worse than before */ });

  function badgeParts(d) {
    const dt = new Date(d);
    if (isNaN(dt)) return null;
    // SHORT month — this is the compact date badge, not the filter heading. Mixing the two up
    // puts "July 2026" where a two-character chip belongs.
    return { m: COPY.months[dt.getMonth()] || String(dt.getMonth() + 1), day: String(dt.getDate()), year: String(dt.getFullYear()) };
  }

  function buildEntry(x) {
    const li = document.createElement('li');
    li.className = 'bl-entry';
    li.dataset.tags = (Array.isArray(x.g) ? x.g : []).join('|');
    li.dataset.ym = String(x.d || '').slice(0, 7);

    const a = document.createElement('a');
    a.className = 'bl-entry-link';
    a.href = x.u || '#';

    if (x.i) {
      const img = document.createElement('img');
      img.className = 'bl-entry-img';
      img.src = x.i;
      img.alt = '';
      img.loading = 'lazy';
      a.appendChild(img);
    }

    if (x.d) {
      if (badgeMode) {
        const b = badgeParts(x.d);
        if (b) {
          const time = document.createElement('time');
          time.className = 'bl-date bl-date-badge';
          for (const [cls, val] of [['bl-date-month', b.m], ['bl-date-day', b.day], ['bl-date-year', b.year]]) {
            const s = document.createElement('span');
            s.className = cls;
            s.textContent = val;
            time.appendChild(s);
          }
          a.appendChild(time);
        }
      } else {
        const time = document.createElement('time');
        time.className = 'bl-date';
        time.textContent = x.d;
        a.appendChild(time);
      }
    }

    const h2 = document.createElement('h2');
    h2.className = 'bl-title';
    h2.textContent = x.t || '';
    a.appendChild(h2);

    if (x.e) {
      const p = document.createElement('p');
      p.className = 'bl-desc';
      p.textContent = x.e;
      a.appendChild(p);
    }

    if (readMore) {
      const rm = document.createElement('span');
      rm.className = 'bl-read-more';
      rm.textContent = readMore;
      a.appendChild(rm);
    }

    li.appendChild(a);
    return li;
  }

  function render(hits) {
    // replace the list with the full matching set (or an honest empty state)
    list.textContent = '';
    if (hits.length === 0) {
      const li = document.createElement('li');
      li.className = 'bl-empty';
      li.textContent = COPY.noMatches;
      list.appendChild(li);
    } else {
      const frag = document.createDocumentFragment();
      for (const x of hits) frag.appendChild(buildEntry(x));
      list.appendChild(frag);
    }

    // the page-1 pager is meaningless for a filtered full-corpus view — hide it
    const pager = document.querySelector('.bl-pager');
    if (pager) pager.style.display = 'none';

    // a heading telling the visitor what they filtered to + a clear link back to the index
    const main = document.querySelector('.bl-main') || list.parentNode;
    let head = main.querySelector('.bl-filter-head');
    if (!head) {
      head = document.createElement('div');
      head.className = 'bl-filter-head';
      list.parentNode.insertBefore(head, list);
    }
    head.textContent = '';
    const label = document.createElement('span');
    label.className = 'bl-filter-label';
    // A month label is a language fact, so the server precomputed one per month in the corpus.
    // A ym outside that map (possible on a full-corpus fetch) degrades to the raw key rather than
    // to somebody's guess at how this language orders a year and a month.
    label.textContent = wantYm ? (COPY.ym[wantYm] || wantYm) : `#${wantTag}`;
    const count = document.createElement('span');
    count.className = 'bl-filter-count';
    count.textContent = `${COPY.countWrap[0]}${hits.length}${COPY.countWrap[1]}`;
    const clear = document.createElement('a');
    clear.className = 'bl-filter-clear';
    clear.href = location.pathname;
    clear.textContent = COPY.clearFilter;
    head.appendChild(label);
    head.appendChild(count);
    head.appendChild(clear);
  }
})();
