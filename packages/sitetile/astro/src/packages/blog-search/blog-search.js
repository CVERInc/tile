// REEF with Blog — the blog-search island. Pure front-end, zero backend: fetches the
// build-time /search-index.json ONCE (lazily, only when a visitor actually opens search),
// then substring-filters it in the browser. Self-gating: if the page carries neither the
// header search toggle's overlay input nor the /search page's own input, it no-ops — every
// non-search site/page pays nothing. Bundled like theme-toggle.js / header-overlay.js.
//
// CJK-safe by design: a substring match over NFC-folded, lowercased, diacritic-stripped
// text needs no tokenizer — Chinese/Japanese/Korean queries match naturally (no word
// boundaries to guess) and Latin accents fold (café == cafe). Honest scope: substring,
// not fuzzy / stemming / pinyin — enough for a blog, on par with live Blogger's own search.
//
// XSS-safe by construction: results are built with createElement + textContent ONLY —
// never innerHTML / set:html — so a post title carrying markup renders as literal text
// (the same discipline as the age-gate island).
(function () {
  const toggle = document.querySelector('[data-search-toggle]');
  const overlayInput = document.querySelector('[data-search-input]');
  const pageInput = document.querySelector('[data-search-page-input]');
  if (!overlayInput && !pageInput) return; // nothing to wire — no-op

  const MAX = 30;
  const DEBOUNCE = 120;

  let INDEX = null;
  let loading = null;
  function ensureIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (loading) return loading;
    loading = fetch('/search-index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { INDEX = Array.isArray(d) ? d : []; return INDEX; })
      .catch(() => { INDEX = []; return INDEX; });
    return loading;
  }

  // fold: NFC → lowercase → strip combining diacritics. CJK passes through untouched;
  // Latin accents collapse so "café" matches "cafe".
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFC').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // substring filter over the folded corpus; title hits sort before body/tag-only hits.
  function run(q) {
    const nq = fold(q).trim();
    if (!nq || !INDEX) return [];
    const titleHits = [];
    const rest = [];
    for (const row of INDEX) {
      if (fold(row.t).indexOf(nq) !== -1) { titleHits.push(row); continue; }
      const g = fold(Array.isArray(row.g) ? row.g.join(' ') : (row.g || ''));
      const e = fold(row.e || '');
      if (g.indexOf(nq) !== -1 || e.indexOf(nq) !== -1) rest.push(row);
    }
    return titleHits.concat(rest).slice(0, MAX);
  }

  // Bind one search UI (the header overlay OR the /search page) to the shared index.
  function bind(input, results, countEl, emptyEl, opts) {
    opts = opts || {};
    let timer = null;
    function paint(q) {
      const rows = run(q);
      results.textContent = ''; // clear — no innerHTML anywhere
      for (const row of rows) {
        const li = document.createElement('li');
        li.className = 'st-search-result';
        const a = document.createElement('a');
        a.href = row.u;
        a.className = 'st-search-result-link';
        a.textContent = row.t; // escaped by textContent — never set:html
        li.appendChild(a);
        results.appendChild(li);
      }
      const hasQuery = fold(q).trim().length > 0;
      if (countEl) {
        if (hasQuery && rows.length) { countEl.dataset.count = String(rows.length); countEl.hidden = false; }
        else countEl.hidden = true;
      }
      if (emptyEl) emptyEl.hidden = !(hasQuery && rows.length === 0);
    }
    input.addEventListener('input', () => {
      const q = input.value;
      clearTimeout(timer);
      timer = setTimeout(() => ensureIndex().then(() => paint(q)), DEBOUNCE);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && opts.navigate) {
        e.preventDefault();
        const q = input.value.trim();
        if (q) window.location.href = '/search?q=' + encodeURIComponent(q);
      }
    });
    return { paint: (q) => ensureIndex().then(() => paint(q)) };
  }

  // ── header overlay ──────────────────────────────────────────────────────────
  // Wrapped so a fault here can never pre-empt the /search page wiring/seeding below.
  let overlayUi = null;
  if (overlayInput) {
    try {
      const results = document.querySelector('[data-search-results]');
      const countEl = document.querySelector('[data-search-count]');
      const emptyEl = document.querySelector('[data-search-empty]');
      overlayUi = bind(overlayInput, results, countEl, emptyEl, { navigate: true });
      const root = document.documentElement;
      const open = () => {
        root.setAttribute('data-search-open', '');
        ensureIndex();
        requestAnimationFrame(() => overlayInput.focus());
      };
      const close = () => root.removeAttribute('data-search-open');
      if (toggle) toggle.addEventListener('click', open);
      for (const el of document.querySelectorAll('[data-search-close]')) el.addEventListener('click', close);
      document.addEventListener('keydown', (e) => {
        const openNow = root.hasAttribute('data-search-open');
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (e.key === 'Escape' && openNow) { close(); return; }
        if (e.key === '/' && !openNow && !typing) { e.preventDefault(); open(); }
      });
    } catch (e) { /* overlay is enhancement-only; the /search page must still wire */ }
  }

  // ── /search page (shareable, ?q= seeded) ────────────────────────────────────
  let pageUi = null;
  if (pageInput) {
    const results = document.querySelector('[data-search-page-results]');
    const countEl = document.querySelector('[data-search-page-count]');
    const emptyEl = document.querySelector('[data-search-page-empty]');
    pageUi = bind(pageInput, results, countEl, emptyEl, { navigate: false });
    // keep the address bar shareable as the query changes (no reload)
    pageInput.addEventListener('input', () => {
      const q = pageInput.value.trim();
      window.history.replaceState(null, '', q ? '/search?q=' + encodeURIComponent(q) : '/search');
    });
  }

  // ── seed from the shareable ?q= URL ─────────────────────────────────────────
  // Only fires on the /search page (where a page input exists). Prefills EVERY search input
  // on the document — the inline page form AND the header overlay — from ?q=, then runs the
  // filter once so results are on screen at load and the overlay isn't confusingly blank if
  // opened. Scoped to /search (pageInput present) so a stray ?q= on any other page is ignored.
  if (pageInput) {
    const seed = new URLSearchParams(window.location.search).get('q') || '';
    pageInput.value = seed;
    if (overlayInput) overlayInput.value = seed;
    if (pageUi) pageUi.paint(seed);
    if (overlayUi) overlayUi.paint(seed);
  }
})();
