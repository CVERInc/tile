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

(function () {
  var roots = document.querySelectorAll('[data-dynamic-coral="events"]');
  if (!roots.length) return;

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-dc', 'events');
    style.textContent = [
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
      '.dc-ev--empty{padding:24px;text-align:center;color:var(--gd-muted,rgba(0,0,0,.55));font-style:italic}',
    ].join('');
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

  injectStyles();
  roots.forEach(function (root) {
    var src = root.getAttribute('data-src') || '/events.json';
    var empty = root.getAttribute('data-empty') || 'No upcoming events.';
    root.classList.add('dc-ev');
    fetch(src, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        root.innerHTML = (data && data.html) || '<div class="dc-ev--empty">' + empty + '</div>';
        localizeMaps(root);
        tick(root);
        // tick every second — the countdown should visibly move; only touches .dc-ev-cd text
        setInterval(function () { tick(root); }, 1000);
      })
      .catch(function () { root.innerHTML = '<div class="dc-ev--empty">' + empty + '</div>'; });
  });
})();
