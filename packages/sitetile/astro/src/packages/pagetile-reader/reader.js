// REEF with Pagetile — the reader controller (client-side, progressive enhancement).
// One chapter's page images live in the DOM (rendered by /preview/[chapter].astro); this
// module switches paged⇄scroll, drives page-turns, the thumbnail scrubber, resume, immersive
// mode, and the progress readout. No framework — same posture as theme-toggle/locale-banner.
// Without JS the page still shows all pages in a readable vertical stack (the <noscript> path).
//
// Mirrors the Amazon Manga (Kindle web) reader the maintainer studied 2026-07-07:
//   • paged (single / wide-screen 2-up spread) ⇄ vertical continuous scroll toggle
//   • ltr / rtl reading direction (book frontmatter)
//   • bottom thumbnail scrubber, chapter progress "page N / chapter-total · X%"
//   • resume last-read position, immersive (chrome-hiding) mode
//   • a page turn that turns: tapped, keyed and button turns play as a leaf turning on the spine
const root = document.querySelector('.ptr');
if (root) initReader(root);

function initReader(root) {
  const track = root.querySelector('.ptr-track');
  const pages = Array.from(root.querySelectorAll('.ptr-page'));
  const endcap = root.querySelector('.ptr-endcap');   // trailing "next chapter" panel (optional)
  const book = root.dataset.book || 'book';
  const chapterId = root.dataset.chapter || '';
  const direction = root.dataset.direction === 'rtl' ? 'rtl' : 'ltr';
  const rtl = direction === 'rtl';
  const prevChapterUrl = root.dataset.prevChapter || '';   // '' at the first chapter
  const END_HASH = '__end';   // sentinel: open the target chapter on its LAST page (Prev-into-chapter)

  const K = {
    mode: 'ptr-mode:' + book,
    spread: 'ptr-spread:' + book,
    pos: 'ptr-pos:' + book,
    turn: 'ptr-turn:' + book,
  };
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  let mode = get(K.mode, root.dataset.mode || 'paged');   // 'paged' | 'scroll'
  let spread = get(K.spread, 'auto');                     // 'on' | 'off' | 'auto'
  let cur = 0;                                            // current page index within chapter

  // ── mode + spread application ──────────────────────────────────────────────
  const wideEnough = () => window.innerWidth >= 900;
  const spreadOn = () => mode === 'paged' && (spread === 'on' || (spread === 'auto' && wideEnough()));
  function applyLayout() {
    root.dataset.mode = mode;
    root.dataset.spread = spreadOn() ? 'on' : 'off';
    const mb = root.querySelector('[data-act="mode"]');
    if (mb) mb.setAttribute('aria-pressed', mode === 'scroll' ? 'true' : 'false');
    // keep the current page in view across a layout change
    requestAnimationFrame(() => goToIndex(cur, 'auto'));
  }

  // ── navigation ─────────────────────────────────────────────────────────────
  // Spread pairing models a real book: page 0 is a LONE cover, then pages pair up
  // (1,2)(3,4)… — so `pairLeft(i)` is the left (binding-start) page of i's pair.
  const pairLeft = (i) => (i <= 0 ? 0 : i - ((i + 1) % 2));   // 1→1,2→1,3→3,4→3
  // Programmatic moves are AUTHORITATIVE: they set `cur` and suppress the observer for a
  // beat so the reflow/scroll they trigger can't clobber the position (the bug that reset
  // resume to page 1 on every mode toggle). Free user-scrolling still updates via the observer.
  let suppress = false, suppressT = null;
  let atEndcap = false;   // showing the trailing next-chapter panel (past the last page)
  function suppressBriefly(ms) { suppress = true; clearTimeout(suppressT); suppressT = setTimeout(() => { suppress = false; }, ms || 700); }
  function goToIndex(i, behavior) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    const el = pages[i];
    if (!el) return;
    cur = i;
    atEndcap = false;     // moved back onto a real page
    suppressBriefly();
    onPageChange();
    if (mode === 'scroll') {
      el.scrollIntoView({ behavior: behavior || 'smooth', block: 'start' });
    } else if (spreadOn() && i > 0) {
      // spread: align the LEFT page of the pair to the reading edge → clean two-up, no slivers.
      // (`inline:start` is direction-aware, so under CSS direction:rtl it aligns to the right.)
      pages[pairLeft(i)].scrollIntoView({ behavior: behavior || 'smooth', inline: 'start', block: 'nearest' });
    } else {
      // lone cover (spread) or single paged: center it. inline:center is direction-aware.
      el.scrollIntoView({ behavior: behavior || 'smooth', inline: 'center', block: 'nearest' });
    }
  }
  // advance = move forward in READING order (spread steps a whole pair; lone cover steps 1).
  // Book boundaries: at the FIRST page, Prev crosses into the previous chapter's LAST page
  // (disabled at the very first chapter); at the LAST page, Next reveals the next-chapter endcap
  // then crosses into it (disabled at the very last chapter, where no endcap exists).
  function step(forward) {
    if (forward && atEndcap) { goToNextChapter(); return; }
    if (!forward && atEndcap) { goToIndex(cur, 'smooth'); return; }
    if (forward && cur >= pages.length - 1) {
      if (endcap) revealEndcap();                     // next chapter exists → transition panel
      return;                                         // last chapter → no-op (Next is disabled)
    }
    if (!forward && cur === 0) {
      if (prevChapterUrl) location.href = prevChapterUrl + '#' + END_HASH;   // → prev chapter, last page
      return;                                         // first chapter → no-op (Prev is disabled)
    }
    let target;
    if (spreadOn()) {
      if (forward) target = cur === 0 ? 1 : pairLeft(cur) + 2;
      else { const pl = pairLeft(cur); target = pl <= 1 ? 0 : pl - 2; }
    } else {
      target = cur + (forward ? 1 : -1);
    }
    if (!turnLeaf(target, forward)) goToIndex(target, 'smooth');
  }

  // ── the page turn ──────────────────────────────────────────────────────────
  // A turn the reader ASKED for (edge tap, arrow key, the Prev/Next buttons) plays as a leaf
  // turning on the spine: the page on the turning side swings over in 3D, and in a spread its back
  // is the next pair's facing page — the one it lands on, as in a real book. It is drawn over the
  // stage while the track underneath has already jumped to the destination, so the reader's own
  // state (cur, progress, resume, the observer) moves exactly as it did before and nothing about
  // paging depends on the animation having run.
  //
  // A SWIPE is not this. A finger dragging the track is the native scroll-snap slide, which follows
  // the finger and never makes someone who is flicking through twenty pages wait for a show.
  //
  // Ours, not a library: the corner-peel kind (a curl that tracks the finger) is ~125 KB of geometry
  // in the one maintained-looking open-source option, last released 2022. A hinge turn is a
  // rotateY, two faces and two shades; owning it costs less than depending on it.
  //
  // It stands down — and the old slide plays — whenever the turn has no honest shape: scroll mode,
  // the reader's own "slide" choice, the system's Reduce Motion, a cover or a lone last page in a
  // spread (no facing pair to turn), crossing a chapter, or an image that has not loaded yet.
  const TURN_MS = 620;
  let turnStyle = get(K.turn, root.dataset.turn === 'slide' ? 'slide' : 'flip');   // 'flip' | 'slide'
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const stage = root.querySelector('.ptr-stage');
  let turning = null;   // { anims, layer } while a leaf is in the air

  // Land the leaf in flight at once. A second tap mid-turn means "and the next one" — it must not
  // wait, and it must not start from a page the reader has already left.
  function landTurn() {
    if (!turning) return;
    turning.anims.forEach((a) => { try { a.cancel(); } catch (e) {} });
    turning.layer.remove();
    turning = null;
  }
  const loadedImg = (i) => {
    const im = pages[i] && pages[i].querySelector('img');
    return im && im.complete && im.naturalWidth > 0 ? im : null;
  };
  // The drawn box of an <img> with object-fit: contain — the picture, not the letterboxed element —
  // in stage coordinates, so the leaf hinges on the page's real edge rather than the stage's.
  function pictureBox(im, stageRect) {
    const r = im.getBoundingClientRect();
    const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    return { left: r.left - stageRect.left + (r.width - w) / 2, top: r.top - stageRect.top + (r.height - h) / 2, width: w, height: h };
  }
  // The two visible pages of a spread, sorted by where they are DRAWN (direction: rtl swaps them).
  function facing(i) {
    const pl = pairLeft(i);
    if (pl < 1 || pl + 1 >= pages.length) return null;   // the lone cover, or an odd last page
    const a = loadedImg(pl), b = loadedImg(pl + 1);
    if (!a || !b) return null;
    return a.getBoundingClientRect().left <= b.getBoundingClientRect().left ? { left: a, right: b } : { left: b, right: a };
  }
  function face(cls, im) {
    const f = document.createElement('div');
    f.className = 'ptr-leaf-face ' + cls;
    if (im) { const c = new Image(); c.src = im.currentSrc || im.src; c.alt = ''; f.append(c); }
    const shade = document.createElement('div');
    shade.className = 'ptr-leaf-shade';
    f.append(shade);
    return f;
  }
  function place(el, b) {
    el.style.left = b.left + 'px'; el.style.top = b.top + 'px';
    el.style.width = b.width + 'px'; el.style.height = b.height + 'px';
  }

  function turnLeaf(target, forward) {
    landTurn();
    if (mode !== 'paged' || turnStyle !== 'flip' || !stage) return false;
    if (reduceMotion && reduceMotion.matches) return false;
    if (typeof Element.prototype.animate !== 'function') return false;
    if (target < 0 || target >= pages.length || target === cur) return false;
    const towardRight = forward !== rtl;   // the turning page sits on this side of the spine
    const sr = stage.getBoundingClientRect();
    let leafImg, stayImg = null, backImg = null;
    if (spreadOn()) {
      const now = facing(cur), next = facing(target);
      if (!now || !next) return false;
      leafImg = towardRight ? now.right : now.left;     // the page that turns over…
      stayImg = towardRight ? now.left : now.right;     // …the one it lands on, until it lands…
      backImg = towardRight ? next.left : next.right;   // …and what is printed on its back
    } else {
      leafImg = loadedImg(cur);
      if (!leafImg || !loadedImg(target)) return false;
    }
    const leafBox = pictureBox(leafImg, sr);

    const layer = document.createElement('div');
    layer.className = 'ptr-turn';
    if (stayImg) {
      const stay = face('ptr-leaf-stay', stayImg);
      place(stay, pictureBox(stayImg, sr));
      layer.append(stay);
    }
    const leaf = document.createElement('div');
    leaf.className = 'ptr-leaf ' + (towardRight ? 'ptr-hinge-left' : 'ptr-hinge-right');
    place(leaf, leafBox);
    leaf.style.transformOrigin = towardRight ? 'left center' : 'right center';   // the spine
    const front = face('ptr-leaf-front', leafImg);
    const back = face('ptr-leaf-back' + (backImg ? '' : ' ptr-leaf-paper'), backImg);
    leaf.append(front, back);
    layer.append(leaf);
    stage.append(layer);

    // The layer now covers what the reader is looking at, so the track can jump under it in the
    // same frame: nothing flashes, and from here on the reader's state is the destination's.
    goToIndex(target, 'instant');

    const end = towardRight ? -180 : 180;
    const timing = { duration: TURN_MS, easing: 'cubic-bezier(.3,.05,.25,1)', fill: 'forwards' };
    const anims = [
      // perspective() INSIDE the transform, not `perspective` on the layer: WebKit (Safari, every
      // iOS browser) drew the parent-perspective version flat — a page squashing sideways instead of
      // turning. Measured in Playwright WebKit 26.5 on 2026-10-20; Chromium drew both the same.
      leaf.animate([{ transform: 'perspective(2400px) rotateY(0deg)' }, { transform: 'perspective(2400px) rotateY(' + end + 'deg)' }], timing),
      // light: the front darkens as it lifts away from the light, the back brightens as it lands
      front.querySelector('.ptr-leaf-shade').animate([{ opacity: 0 }, { opacity: 0.45 }], { ...timing, duration: TURN_MS / 2 }),
      back.querySelector('.ptr-leaf-shade').animate([{ opacity: 0.45 }, { opacity: 0 }], { ...timing, delay: TURN_MS / 2, duration: TURN_MS / 2 }),
    ];
    turning = { anims, layer };
    anims[0].finished.then(() => { if (turning && turning.layer === layer) landTurn(); }, () => {});
    return true;
  }
  // A finger on the track takes over: whatever is mid-air lands now.
  track.addEventListener('pointerdown', landTurn, { passive: true });
  if (reduceMotion && reduceMotion.addEventListener) reduceMotion.addEventListener('change', landTurn);
  function applyTurnStyle() {
    root.dataset.turn = turnStyle;
    const b = root.querySelector('[data-act="turn"]');
    if (b) b.setAttribute('aria-pressed', turnStyle === 'flip' ? 'true' : 'false');
  }
  applyTurnStyle();
  // follow the endcap's own link (the whole panel is the <a> to the next chapter)
  function goToNextChapter() {
    if (!endcap) return;
    const link = endcap.matches('a') ? endcap : endcap.querySelector('a');
    if (link && link.href) location.href = link.href;
  }
  // grey out Prev/Next at the book's two absolute ends (start of ch.1, end of last ch.)
  function updateNavButtons() {
    const prevBtn = root.querySelector('[data-act="prev"]');
    const nextBtn = root.querySelector('[data-act="next"]');
    const atBookStart = !atEndcap && cur === 0 && !prevChapterUrl;
    const atBookEnd = !atEndcap && cur >= pages.length - 1 && !endcap;
    if (prevBtn) prevBtn.disabled = atBookStart;
    if (nextBtn) nextBtn.disabled = atBookEnd;
  }

  // ── current-page tracking (drives progress, scrubber, resume) ──────────────
  // Detect the page crossing the viewport CENTER via a thin center-band rootMargin — robust for
  // manga pages taller than the viewport (which never reach a high intersectionRatio) and for
  // both the vertical (scroll) and horizontal (paged) axes.
  let io = null;
  function makeObserver() {
    if (io) io.disconnect();
    const band = mode === 'scroll' ? '-45% 0px -45% 0px' : '0px -45% 0px -45%';
    io = new IntersectionObserver((entries) => {
      if (suppress) return;
      const hit = entries.find((e) => e.isIntersecting);
      if (!hit) return;
      const i = pages.indexOf(hit.target);
      if (i < 0 || i === cur) return;
      cur = i;
      onPageChange();
    }, { root: mode === 'scroll' ? null : track, rootMargin: band, threshold: 0 });
    pages.forEach((p) => io.observe(p));
  }
  makeObserver();

  function onPageChange() {
    // progress is CHAPTER-scoped (matches the scrubber, which only holds this chapter's pages,
    // and the one-route-per-chapter model) — not book-wide. `pages` is this chapter's pages.
    const chapTotal = pages.length;
    const pct = chapTotal > 1 ? Math.round(cur / (chapTotal - 1) * 100) : 100;
    const prog = root.querySelector('.ptr-progress');
    if (prog) prog.textContent = (cur + 1) + ' / ' + chapTotal + ' · ' + pct + '%';
    updateNavButtons();
    // scrubber highlight + keep active thumb in view. Centre the thumb by scrolling ONLY the
    // horizontal scrubber container — NOT via scrollIntoView, whose block:nearest would drag the
    // whole (very tall, in scroll mode) document down to the footer-anchored scrubber. That was
    // the "can't scroll after switching to scroll view" bug: every observer tick yanked us to the
    // bottom. Scoping the move to .ptr-scrub.scrollTo keeps the document scroll untouched.
    const thumbs = root.querySelectorAll('.ptr-thumb');
    thumbs.forEach((t, ti) => t.setAttribute('aria-current', ti === cur ? 'true' : 'false'));
    const activeThumb = thumbs[cur];
    if (activeThumb) {
      const scrub = activeThumb.parentElement;
      if (scrub) scrub.scrollTo({ left: activeThumb.offsetLeft - (scrub.clientWidth - activeThumb.clientWidth) / 2, behavior: 'smooth' });
    }
    // resume: remember chapter + page id
    const pid = pages[cur] && pages[cur].dataset.page;
    if (pid) set(K.pos, JSON.stringify({ chapter: chapterId, page: pid }));
    // reflect page in the URL hash without a history entry (deep-linkable)
    if (pid && ('replaceState' in history)) history.replaceState(null, '', '#' + pid);
  }

  // ── controls wiring ────────────────────────────────────────────────────────
  root.querySelector('[data-act="next"]')?.addEventListener('click', () => step(true));
  root.querySelector('[data-act="prev"]')?.addEventListener('click', () => step(false));
  // tap zones: edge = page turn (CSS positions fwd/back per direction), center = toggle chrome
  root.querySelector('.ptr-tap-fwd')?.addEventListener('click', () => step(true));
  root.querySelector('.ptr-tap-back')?.addEventListener('click', () => step(false));
  root.querySelector('.ptr-tap-center')?.addEventListener('click', () => toggleImmersive());

  root.querySelector('[data-act="mode"]')?.addEventListener('click', () => {
    landTurn();
    mode = mode === 'scroll' ? 'paged' : 'scroll';
    set(K.mode, mode);
    suppressBriefly(900);       // hold position across the reflow the mode switch triggers
    makeObserver();             // observer root + axis differ per mode → rebuild
    applyLayout();              // re-asserts `cur` into view via goToIndex
  });
  root.querySelector('[data-act="spread"]')?.addEventListener('click', () => {
    spread = spreadOn() ? 'off' : 'on';
    set(K.spread, spread);
    applyLayout();
  });
  root.querySelector('[data-act="turn"]')?.addEventListener('click', () => {
    turnStyle = turnStyle === 'flip' ? 'slide' : 'flip';
    set(K.turn, turnStyle);
    landTurn();
    applyTurnStyle();
  });
  root.querySelector('[data-act="immersive"]')?.addEventListener('click', toggleImmersive);
  // immersive close button (top-left, only shown in immersive) — exits full screen
  root.querySelector('[data-act="close"]')?.addEventListener('click', () => {
    if (document.body.classList.contains('ptr-immersive')) toggleImmersive();
  });
  function toggleImmersive() {
    const on = document.body.classList.toggle('ptr-immersive');
    const b = root.querySelector('[data-act="immersive"]');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // reveal the trailing next-chapter endcap (swipe/arrow past the last page in paged mode)
  function revealEndcap() {
    if (!endcap) return;
    atEndcap = true;
    updateNavButtons();
    suppressBriefly();
    endcap.scrollIntoView({ behavior: 'smooth', inline: 'center', block: mode === 'scroll' ? 'start' : 'nearest' });
  }

  // scrubber thumbnails: click to jump (goToIndex is authoritative — sets cur + saves)
  root.querySelectorAll('.ptr-thumb').forEach((t, ti) => {
    t.addEventListener('click', () => goToIndex(ti, 'smooth'));
  });

  // keyboard: ←/→ page (rtl-aware), space = forward, v = toggle view, f = immersive
  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(!rtl); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(rtl); }
    else if (e.key === ' ') { e.preventDefault(); step(true); }
    else if (e.key.toLowerCase() === 'v') { root.querySelector('[data-act="mode"]')?.click(); }
    else if (e.key.toLowerCase() === 'f') { toggleImmersive(); }
    else if (e.key === 'Escape' && document.body.classList.contains('ptr-immersive')) { toggleImmersive(); }
  });

  // ── initial position: end-sentinel > hash > resume(this chapter) > first page ─────────────
  function initialIndex() {
    const h = location.hash.replace(/^#/, '');
    if (h === END_HASH) return pages.length - 1;   // arrived via Prev from the next chapter → last page
    if (h) { const i = pages.findIndex((p) => p.dataset.page === h); if (i >= 0) return i; }
    try {
      const saved = JSON.parse(get(K.pos, 'null'));
      if (saved && saved.chapter === chapterId) {
        const i = pages.findIndex((p) => p.dataset.page === saved.page);
        if (i >= 0) return i;
      }
    } catch (e) {}
    return 0;
  }

  applyLayout();
  cur = initialIndex();
  onPageChange();
  // jump without animation on first paint (after layout settles)
  requestAnimationFrame(() => requestAnimationFrame(() => goToIndex(cur, 'auto')));
  window.addEventListener('resize', () => { if (spread === 'auto') applyLayout(); });
}
