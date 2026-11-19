// REEF with Events — the dynamic-coral client, SOURCE form. The distributable `events.js` is
// BUILT from this file (`node packages/dynamic-corals/build.mjs`) — do not edit events.js by hand.
//
// Why a build at all: this client used to hand-copy the core's countdown logic under a
// "MUST mirror events-core.countdownText" comment, and the two implementations were one missed
// edit away from disagreeing (the worker bakes the first paint, this re-ticks it every second —
// skew shows up as the badge text changing the moment the first tick lands). A differential test
// guarded the source for one day, 2026-07-16, before this build step made the drift impossible:
// the client now IMPORTS the same node-tested countdownText the worker renders with, and esbuild
// tree-shakes the render half of the core away (the client never renders — HTML arrives from the
// worker/JSON). One brain, two runtimes.
//
// Everything else is the original client verbatim: self-injected styles themed off the host's
// --gd-* tokens, platform-branched map links, fetch + mount. Framework-agnostic: drop
// `<div data-dynamic-coral="events" data-src="…">` on any host page, sitetile or not.
import { countdownText } from './events-core.mjs';
import { listRows, renderRows, rowsShape, showCount, farBadges } from './events-list.mjs';
import { withDynamicCoralCssLayer } from '../shared/dynamic-coral-css.mjs';

(function () {
  var roots = document.querySelectorAll('[data-dynamic-coral="events"]');
  if (!roots.length) return;

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-dc', 'events');
    var css = [
      '.dc-ev{display:block}',
      '.dc-ev-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}',
      // Each item is [ square date tile | body ], side by side. The tile's size comes from the
      // COLUMN (a flex-basis, clamped), not the row's content height — aspect-ratio:1 turns that
      // width into a matching height, so one event with a long address can no longer blow the tile
      // up or overflow it (the earlier align-self:stretch version sized the tile off the row, so a
      // 2-line address inflated it into an oversized, sometimes overflowing square). align-items:
      // flex-start keeps both children pinned to the top instead of stretching to match heights.
      '.dc-ev-item{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;border-radius:var(--gd-radius,14px);background:var(--gd-soft,rgba(0,0,0,.04));border:1px solid var(--gd-border,rgba(0,0,0,.08))}',
      // the calendar tile — radius rides var(--gd-radius) (some hosts square it to 0; other sites keep
      // their own). flex-basis is a clamp: shrinks on narrow viewports, caps at 92px on wide ones.
      '.dc-ev-cal{flex:0 0 clamp(60px,20%,92px);aspect-ratio:1;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px;border:1.5px solid var(--gd-accent-deep,var(--gd-accent,#875fb6));border-radius:var(--gd-radius,12px);background:var(--gd-surface,transparent)}',
      '.dc-ev-cal-mo{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;line-height:1;color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)))}',
      '.dc-ev-cal-day{font-size:1.6rem;font-weight:800;line-height:1;color:var(--gd-text,inherit);font-variant-numeric:tabular-nums}',
      '.dc-ev-body{flex:1 1 0%;min-width:0;display:grid;gap:6px}',
      // Narrow: flip to the "日" layout — tile shrinks to a small fixed square top-left, body drops
      // below at full width (was cramped into a slim remaining column beside a still-sizeable tile,
      // wrapping every line). Just a flex-direction flip + two size overrides, no grid-template
      // juggling per breakpoint.
      '@media (max-width:560px){.dc-ev-item{flex-direction:column}.dc-ev-cal{flex:0 0 64px}.dc-ev-body{width:100%}}',
      '.dc-ev-main{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
      '.dc-ev-title{font-weight:700;font-size:1.05rem;color:var(--gd-text,inherit);text-decoration:none}',
      'a.dc-ev-title:hover{color:var(--gd-accent,currentColor);text-decoration:underline}',
      // --gd-pill: a theme that has squared its language sets this once (see the sitetile theme
      // contract) instead of naming every pill the corals ship. Defaults to a pill, so a theme
      // that never sets it is unchanged.
      '.dc-ev-cd{flex:0 0 auto;font-size:.78rem;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--gd-accent-ink,#fff);background:var(--gd-accent-deep,var(--gd-accent,#875fb6));padding:3px 10px;border-radius:var(--gd-pill,999px);letter-spacing:.01em}',
      '.dc-ev-cd:empty{display:none}',
      // Each info line = a leading icon + text, aligned into a column: same left edge (grid rows),
      // same 1em icon at the same .9rem, so the icons line up. Muted like the old .dc-ev-meta was;
      // the title stays the one un-iconed line (the header).
      '.dc-ev-when,.dc-ev-loc{display:inline-flex;align-items:center;gap:6px;justify-self:start;font-size:.9rem;color:var(--gd-muted,rgba(0,0,0,.6));text-decoration:none}',
      '.dc-ev-when{font-variant-numeric:tabular-nums}',
      'a.dc-ev-loc:hover{color:var(--gd-accent,currentColor)}',
      '.dc-ev-desc{display:flex;align-items:flex-start;gap:6px;justify-self:start;margin:0;font-size:.9rem;line-height:1.5;color:var(--gd-text,inherit);opacity:.85}',
      '.dc-ev-desc .dc-ev-ic{margin-top:.12em}',
      '.dc-ev-ic{width:1em;height:1em;flex:0 0 auto;opacity:.85}',
      '.dc-ev-add{justify-self:start;margin-top:4px;font-size:.82rem;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:5px;color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)))}',
      '.dc-ev-add:hover{text-decoration:underline}',
      // ── the live list (events-list.mjs): drawn here from the feed's `events` ──────────────────
      // Colour says "this does something": the accent is on the tile and the badge (both doors to
      // add-to-calendar) and on the ICON of a line that is a link. Text stays ink and muted.
      '.dc-ev-list--live .dc-ev-main{align-items:flex-start}',
      '.dc-ev-list--live .dc-ev-title{line-height:1.35;min-width:0;overflow-wrap:anywhere;hyphens:auto}',
      // The tile is a link now: without `color:inherit` its day number would take the browser's
      // link blue on a host that sets no --gd-text.
      'a.dc-ev-cal{color:inherit;text-decoration:none;transition:background .15s}',
      // The tile: still a square. The month is a bar across its top; weekday and day sit centred
      // in the rest (a flex child that takes what the bar leaves).
      // Its face is the page's background where the host names one, so the tile reads as a leaf on a
      // tinted card; where it names none the tile stays as it was (the card's own surface), because a
      // white guessed here would sit under whatever colour the page's text is.
      // The tile is a size container: its type is sized from the TILE (cqw), not from the viewport —
      // the same tile is 92px in a wide column and 60px in a sidebar on the same screen.
      '.dc-ev-list--live .dc-ev-cal{position:relative;border:0;padding:0;gap:0;justify-content:flex-start;overflow:hidden;container-type:inline-size;background:var(--gd-bg,var(--gd-surface,transparent))}',
      // The tile's outline is a ring painted OVER its contents, not a border around them. With a real border the bar is
      // clipped to the curve just inside it, and two anti-aliased curves a hair apart let a sliver of the face show
      // between bar and border on high-density screens. Under a ring the bar simply runs to the tile's edge.
      '.dc-ev-list--live .dc-ev-cal::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1.5px var(--gd-accent-deep,var(--gd-accent,#875fb6));pointer-events:none}',
      // Type is sized from the tile's width, which no longer loses 3px to a border: the factors are the old ones x 89/92.
      '.dc-ev-list--live .dc-ev-cal-mo{align-self:stretch;flex:none;padding:calc(.3em + 1.5px) 0 .3em;font-size:max(8.5px,10.06cqw);font-weight:800;letter-spacing:.06em;line-height:1.1;text-align:center;background:var(--gd-accent-deep,var(--gd-accent,#875fb6));color:var(--gd-accent-ink,#fff)}',
      // 0.95, not 1: the bar above is heavy, so the pair sits a hair above the true middle of the face.
      '.dc-ev-cal-face{align-self:stretch;flex:.95 1 0%;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
      '.dc-ev-cal-wd{font-size:max(9px,12.09cqw);font-weight:700;text-transform:uppercase;letter-spacing:.03em;line-height:1;color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)))}',
      '.dc-ev-list--live .dc-ev-cal-day{font-size:33.67cqw}',
      // the same faint tint the badge takes: the whole tile is the door
      // (inside @supports: with a var() in it, an unsupported color-mix() is not dropped but computes
      // to nothing, and the tile would lose its background on hover)
      '@supports (background:color-mix(in srgb,red 10%,white)){.dc-ev-list--live a.dc-ev-cal:hover{background:color-mix(in srgb,var(--gd-accent,#875fb6) 12%,var(--gd-bg,var(--gd-surface,transparent)))}}',
      // the badge: an outline while the event is ahead, filled once it is under way
      '.dc-ev-list--live .dc-ev-cd{margin-top:.15em;text-decoration:none;background:transparent;border:1.5px solid var(--gd-accent-deep,var(--gd-accent,#875fb6));color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)));padding:2px 9px}',
      '.dc-ev-list--live a.dc-ev-cd:hover{background:color-mix(in srgb,var(--gd-accent,#875fb6) 12%,transparent)}',
      '.dc-ev-list--live .dc-ev-item[data-state="during"] .dc-ev-cd{background:var(--gd-accent-deep,var(--gd-accent,#875fb6));color:var(--gd-accent-ink,#fff)}',
      '.dc-ev-list--live .dc-ev-line{display:flex;align-items:flex-start;gap:6px;justify-self:start;min-width:0;margin:0;font-size:.9rem;line-height:1.5;opacity:1;color:var(--gd-muted,rgba(0,0,0,.6));text-decoration:none}',
      '.dc-ev-list--live .dc-ev-line>span{min-width:0;overflow-wrap:anywhere}',
      '.dc-ev-list--live .dc-ev-line .dc-ev-ic{margin-top:.25em;opacity:.7}',
      '.dc-ev-list--live a.dc-ev-line .dc-ev-ic{opacity:1;color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)))}',
      '.dc-ev-list--live a.dc-ev-line:hover{color:var(--gd-muted,rgba(0,0,0,.6))}',
      '.dc-ev-list--live a.dc-ev-line:hover>span{text-decoration:underline}',
      '.dc-ev-list--live .dc-ev-desc>span{white-space:pre-line}',
      '.dc-ev-list--live a:focus-visible{outline:2px solid var(--gd-accent-deep,var(--gd-accent,#875fb6));outline-offset:2px}',
      '.dc-ev--empty{padding:24px;text-align:center;color:var(--gd-muted,rgba(0,0,0,.55));font-style:italic}',
    ].join('');
    // Layered only for a site whose document root declares it (absent = legacy, unchanged);
    // see ../shared/dynamic-coral-css.mjs.
    style.textContent = withDynamicCoralCssLayer(css);
    document.head.appendChild(style);
  }

  // Thin adapter over the core's countdownText: the DOM hands us ISO strings + label attributes,
  // the core wants an Event shape + labels object. The isNaN guard stays HERE (not in core):
  // core only ever sees parser-validated events, but a data-start attribute is runtime input.
  function countdown(startIso, endIso, prefix, liveWord, always) {
    if (isNaN(Date.parse(startIso))) return '';
    return countdownText({ start: startIso, end: endIso || null }, Date.now(), { inPrefix: prefix, live: liveWord }, always);
  }

  // Location taps → the best map link each PLATFORM actually honours. Static href is Google Maps web
  // (universal fallback, kept for desktop + no-JS). We only rewrite where the platform offers better:
  //   Apple (iOS/iPadOS/macOS) → maps.apple.com — Apple never registers geo:, and there's no OS
  //                              "default map" setting, so maps.apple.com is the native path.
  //   Android                  → geo: — the one platform where geo: is live; fires the system's
  //                              own map chooser / default map app. (verified 2026: dead on Apple.)
  // FUTURE-PROOF: the day Apple honours geo:, widen the Android branch to include Apple and delete
  // the Apple branch — one edit here, no runtime detection hack needed.
  var ua = navigator.userAgent || '';
  var IS_APPLE = /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(ua) && !/Android/.test(ua);
  var IS_ANDROID = /Android/.test(ua);
  function localizeMaps(root) {
    if (!IS_APPLE && !IS_ANDROID) return; // desktop non-Apple → keep Google web
    root.querySelectorAll('.dc-ev-loc[data-loc]').forEach(function (a) {
      var q = encodeURIComponent(a.getAttribute('data-loc'));
      a.setAttribute('href', IS_APPLE ? 'https://maps.apple.com/?q=' + q : 'geo:0,0?q=' + q);
    });
  }

  function tick(root) {
    var prefix = root.getAttribute('data-in-prefix') || 'in ';
    var live = root.getAttribute('data-live-label') || 'Now';
    var always = root.getAttribute('data-countdown') === 'always';
    root.querySelectorAll('.dc-ev-cd').forEach(function (el) {
      var s = el.getAttribute('data-start');
      if (!s) return;
      el.textContent = countdown(s, el.getAttribute('data-end') || '', prefix, live, always);
    });
  }

  // The live list: the feed's `events`, drawn here (events-list.mjs). Repainted when WHICH rows are
  // shown or their state changes; between those, only a badge's words are rewritten in place, so a
  // link the visitor has focused is not replaced under them every half minute.
  function live(root, feed, src, empty) {
    var feedSrc = '';
    try { feedSrc = new URL(src, document.baseURI).href; } catch (e) { feedSrc = ''; }
    var shape = null;
    function paint() {
      var rows = listRows(feed, {
        now: Date.now(),
        locale: document.documentElement.getAttribute('lang') || navigator.language || '',
        userAgent: ua,
        feedSrc: feedSrc,
        show: showCount(root.getAttribute('data-show'), src),
        far: farBadges(root.getAttribute('data-countdown'), src),
      });
      var next = rowsShape(rows);
      if (next !== shape) { shape = next; root.innerHTML = renderRows(rows, { empty: empty }); return; }
      var badges = root.querySelectorAll('.dc-ev-cd');
      var at = 0;
      rows.forEach(function (row) {
        if (!row.badge) return;
        var el = badges[at++];
        if (el && el.textContent !== row.badge) el.textContent = row.badge;
      });
    }
    paint();
    setInterval(paint, 30000);
  }

  injectStyles();
  roots.forEach(function (root) {
    var src = root.getAttribute('data-src') || '/events.json';
    var empty = root.getAttribute('data-empty') || 'No upcoming events.';
    root.classList.add('dc-ev');
    fetch(src, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        // A feed that carries the calendar as data is drawn here. One that carries only `html`
        // (a static feed generated ahead of time) is shown as it came, as before.
        if (data && Array.isArray(data.events)) { live(root, data, src, empty); return; }
        root.innerHTML = (data && data.html) || '<div class="dc-ev--empty">' + empty + '</div>';
        localizeMaps(root);
        tick(root);
        // tick every second — the countdown should visibly move; only touches .dc-ev-cd text
        setInterval(function () { tick(root); }, 1000);
      })
      .catch(function () { root.innerHTML = '<div class="dc-ev--empty">' + empty + '</div>'; });
  });
})();
