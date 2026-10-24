// The site-wide announcement (reef#2301): `announce` (the text), `announce-href` (optional link),
// `announce-until` (optional deadline, ISO 8601 with an offset). Zero I/O and no build alias, so a
// plain node test reaches it — the same posture as events-core, and like events-core `now` is
// always handed in, never read here, so "is it over yet" is deterministic under test.
//
//   no until      → the band, exactly as it always was (its text a link when announce-href is set)
//   future until  → a corner card: link, countdown, × — and the page takes it down itself at the
//                   deadline, because a static page is not rebuilt at that moment
//   past until    → nothing at all
//   unparseable   → nothing at all. A deadline we cannot read is not "no deadline": showing the
//                   band forever is the one reading the owner certainly did not mean.
import { countdownText } from '../../../../dynamic-corals/events/events-core.mjs';

/** @returns {{ mode: ''|'band'|'card', text: string, href: string, until: string }} */
export function announceModel(meta = {}, { now = Date.now(), safeHref = () => '' } = {}) {
  const none = { mode: '', text: '', href: '', until: '' };
  const text = String(meta.announce || '').trim();
  if (!text) return none;
  const rawHref = String(meta['announce-href'] || '').trim();
  const href = rawHref ? (safeHref(rawHref) || '') : '';
  const rawUntil = String(meta['announce-until'] || '').trim();
  if (!rawUntil) return { mode: 'band', text, href, until: '' };
  const untilMs = Date.parse(rawUntil);
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return none;
  return { mode: 'card', text, href, until: new Date(untilMs).toISOString() };
}

/** localStorage key for a visitor's ×. Keyed by text + until, so next period's card (a new date,
 *  usually new words) shows again without the owner doing anything. */
export function announceDismissKey(text, until) {
  return 'rf-announce-x:' + until + ':' + text;
}

/** The card's client half, after the guard below has let it stand: re-tick the countdown, take
 *  the card down at the deadline, wire the ×. `env` is the test seam (clock, timers, storage) —
 *  the browser passes nothing. The countdown words come from events-core's countdownText itself,
 *  bundled, not copied: events-client.mjs records what a hand-copied countdown cost there. */
export function mountAnnounceCard(card, env = {}) {
  const now = env.now || (() => Date.now());
  const setTimer = env.setTimeout || ((f, ms) => setTimeout(f, ms));
  const storage = env.storage !== undefined ? env.storage : (() => { try { return localStorage; } catch (e) { return null; } })();
  const until = card.getAttribute('data-until');
  const untilMs = Date.parse(until);
  const cd = card.querySelector('.rf-announce-cd');
  const t = card.querySelector('.rf-announce-t');
  const x = card.querySelector('.rf-announce-x');
  const prefix = cd ? (cd.getAttribute('data-prefix') || '') : '';
  let live = true;
  const takeDown = () => { live = false; card.remove(); };
  if (x && t) {
    x.hidden = false; // the × is only drawn for a visitor whose browser can act on it
    x.addEventListener('click', () => {
      try { if (storage) storage.setItem(announceDismissKey(t.textContent, until), '1'); } catch (e) {}
      takeDown();
    });
  }
  const tick = () => {
    if (!live) return;
    const n = now();
    if (!(untilMs > n)) { takeDown(); return; }
    if (cd) cd.textContent = countdownText({ start: until, end: until }, n, { inPrefix: prefix }, true);
    // Seconds only show in the final day; further out a half-minute cadence keeps the text right
    // and the deadline at most that late — and never a timer longer than the time that is left.
    const left = untilMs - n;
    setTimer(tick, Math.min(left < 864e5 ? 1000 : 30000, left));
  };
  tick();
  return { takeDown };
}

// The guard that runs the moment the card is parsed, before first paint: a page built before the
// deadline and opened after it must never show the card, not even until a deferred module loads.
// Inline because it must be synchronous; it reads nothing but the card's own attributes (no
// interpolated values, so its text is the same on every site and page — one hash for a CSP that
// pins scripts). The dismiss key is spelled out once more here, against announceDismissKey above;
// announce.test.mjs runs both and asserts they agree.
export const ANNOUNCE_GUARD_SCRIPT = "(function(){var s=document.currentScript,c=s&&s.previousElementSibling;if(!c||c.className!=='rf-announce-card')return;var u=c.getAttribute('data-until'),t=c.querySelector('.rf-announce-t');var gone=!(Date.parse(u)>Date.now());if(!gone&&t){try{gone=localStorage.getItem('rf-announce-x:'+u+':'+t.textContent)==='1'}catch(e){}}if(gone)c.remove();})();";
