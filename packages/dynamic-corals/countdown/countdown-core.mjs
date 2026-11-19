// REEF with Countdown — the page half. A root names a deadline; the elements inside it that carry
// `data-part` show how much of it is left. Nothing stored, no copy of its own: every word around the
// numbers is the host's markup, so a page in any language is just that page. No network either,
// unless the root asks for it with `data-src` (below).
//
//   <div data-dynamic-coral="countdown" data-deadline="2026-12-01T23:59:59+09:00" hidden>
//     <span data-part="days" data-flip></span> d <span data-part="hours" data-flip></span> …
//   </div>
//
// `data-part` is days | hours | minutes | seconds. The LARGEST unit present takes everything above
// it too: a root with only hours/minutes/seconds shows 53:12:30 for 2 d 5 h 12 m 30 s, never a
// silently dropped two days. Without `data-flip` (or with `data-flip="false"`) the element's text is
// the value, two digits minimum; with it, the element holds one split-flap card per digit (shared/flip.mjs) and
// gains or drops a card on the left when the digit count changes (99 → 100 days), so the cards that
// keep their place keep their state. A visually hidden copy of the value stays readable to a screen
// reader; the cards themselves are aria-hidden.
//
// The root is shown after the first tick (an author who adds `hidden` never sees 00 flash). The
// coral's own `[hidden]{display:none!important}` makes that true even when a site rule gives the
// root a display — the same guard the sibling corals carry. Ticks land on whole-second boundaries of
// the deadline, so a flip never skips or repeats a second. The final second reads 00:00:00; AT the
// deadline the timer stops and `data-expired` decides what remains: `hide` (default) hides the root,
// `text` replaces its content with `data-expired-text` (with no text, it hides instead). A deadline
// without an explicit offset, or one that does not exist, is refused (see shared/countdown-parts.mjs)
// and the root is left exactly as authored.
//
// `data-src` — the countdown comes from a calendar instead of being typed. It names an events feed
// (the events coral's: `{ calendar, events }`); the root makes ONE GET to it on load and shows the
// events still to come in what's-next order (countdown-feed.mjs): each counts to its start while
// that is ahead and to its end once it is under way. At zero nothing reloads — an event that has
// started goes on to count to its end, one that has ended gives way to the next, and when none is
// left the root expires as a typed deadline does. What the host's markup may ask for, all optional:
//   data-event="title|location|description|when|calendar|position"   that text (emptied when the
//                                                         event has none: the calendar is the source)
//   data-event-href="location|url|add"                    a link's href (removed when there is none)
//   data-event-if="title|location|description|url|place|several"   shown only when that holds
//   data-event-nav="prev|next"                            a control that pages through the events
//   data-unit="days|hours|minutes|seconds"                the page-language word for that unit
//   data-event-fit                                        an element kept as tall as the tallest
//                                                         event needs, so paging moves nothing
//   data-event-more                                       an element whose text the host's CSS
//                                                         clips (a two-line description): when
//                                                         it really is clipped it becomes a
//                                                         control that opens it in place
// and the root says where it is: `data-event-state` (before | during), `data-event-location`
// (url | place | none), `data-event-index`, `data-event-count`. A feed that fails, is slow, or holds
// no event to show falls back to `data-deadline` when the root has one and otherwise leaves the
// root exactly as authored. A root WITHOUT `data-src` never touches the network.
//
// One calendar is in one language, so a root may name a feed per language: `data-src-<language>`
// (`data-src-zh-tw`, `data-src-en`) is used on a page in that language (`<html lang>`, spelled as
// the tag or as the site's locale code — `zh-Hant` reads `data-src-zh-tw` too; see feedSource),
// `data-src` on every other. A root that names feeds only for some languages is not fed on the rest.
//
// Every root, typed or fed, carries `data-under-a-day` while less than a day is left — the hook a
// host uses to trade its days for its seconds.
//
// `data-flip-mode="drum"` turns each card into a mechanical counter wheel (shared/flip.mjs): every
// place carries the same 0–9 wheel, turning DOWNWARD (9, 8, … 0, then 9 again), because a countdown
// only counts down. Every ordinary decrement is then exactly one step, and a place that wraps folds
// through every digit in between: the tens of the seconds going 0→5 at the minute is five steps
// (9, 8, 7, 6, 5), the hours going 00→23 at the day is 8 and 7. That run at each boundary — and the
// cards stopping one by one — is the wheel, not an animation choice. (A 6-face 5…0 tens wheel would
// make 0→5 a single step: no less true, but it is a different machine and loses the run.) The wheel
// is ALWAYS 9…0: `data-flip-faces` only sizes the cards, in drum mode as without it, so writing the
// documented default `0,…,9` is the same as leaving it out (an ascending wheel would turn every
// one-second decrement into a nine-step run longer than the tick).
//
// Reduced motion is read live (a `change` listener on the media query), so switching it on settles
// every card mid-fold at once (a turning wheel jumps to its target). `stop()` — and expiry, which
// calls it — settles every card at once and unsubscribes; a dropped card is settled before it is
// removed, so no card keeps stepping behind the timer. `tick()` after `stop()` resumes and
// subscribes again.
//
import { parseDeadline, remainingParts, pad2 } from '../shared/countdown-parts.mjs';
import { upcoming, nextMoment, phaseOf, locationKind, eventText, eventHref, eventFile, unitText, feedSource } from './countdown-feed.mjs';
import { createFlip, setFlip, settleFlip, parseFaces, FLIP_CSS } from '../shared/flip.mjs';
import { withDynamicCoralCssLayer } from '../shared/dynamic-coral-css.mjs';
import { wireAddMenu, ADD_FILE_ATTR } from '../shared/add-menu.mjs';

export const SELECTOR = '[data-dynamic-coral="countdown"]';
const UNITS = ['days', 'hours', 'minutes', 'seconds'];
// Every digit card is as wide as the widest digit, so a proportional font cannot make 1 and 8 differ.
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const UNIT_SECONDS = { days: 86400, hours: 3600, minutes: 60, seconds: 1 };
const WHEEL_DOWN = [...DIGITS].reverse();   // 9,8,…,0 — the order a counting-down wheel turns
const SR_CSS = '.dc-cd-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}';
// Wins over a site rule that gives the root a display (and, inside @layer reef.corals on a layered
// site, still wins: an !important declaration in a layer outranks unlayered ones).
const HIDDEN_CSS = '[data-dynamic-coral="countdown"][hidden]{display:none!important}';

const styled = new WeakSet();
function injectStyles(doc) {
  if (styled.has(doc) || !doc.head) return;
  styled.add(doc);
  const style = doc.createElement('style');
  style.setAttribute('data-dc', 'countdown');
  style.textContent = withDynamicCoralCssLayer(HIDDEN_CSS + FLIP_CSS + SR_CSS, doc);
  doc.head.appendChild(style);
}

function globals() {
  const w = typeof window !== 'undefined' ? window : {};
  return {
    document: typeof document !== 'undefined' ? document : null,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    fetch: typeof fetch === 'function' ? (url, init) => fetch(url, init) : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    ResizeObserver: w.ResizeObserver || null,
    motion: w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)') : null,
  };
}

function partsOf(root) {
  const parts = [];
  for (const el of root.querySelectorAll('[data-part]')) {
    const unit = el.getAttribute('data-part');
    if (!UNITS.includes(unit)) continue;
    const faces = parseFaces(el.getAttribute('data-flip-faces'));
    const flip = el.getAttribute('data-flip');
    parts.push({ el, unit, flip: flip !== null && flip !== 'false', faces: faces.length ? faces : DIGITS,
      drum: el.getAttribute('data-flip-mode') === 'drum', cards: [], sr: null });
  }
  return parts;
}

function showFlip(part, text, env) {
  const { el } = part;
  if (!part.sr) {
    while (el.firstChild) el.removeChild(el.firstChild);
    part.sr = env.document.createElement('span');
    part.sr.className = 'dc-cd-sr';
    el.appendChild(part.sr);
  }
  part.sr.textContent = text;
  // Cards are matched from the RIGHT: the ones digit is always the same card.
  while (part.cards.length < text.length) {
    const card = createFlip(env.document, part.faces, { drum: part.drum ? WHEEL_DOWN : null });
    el.insertBefore(card, part.cards[0] || part.sr);
    part.cards.unshift(card);
  }
  while (part.cards.length > text.length) {
    const card = part.cards.shift();
    settleFlip(card, env);
    card.remove();
  }
  part.cards.forEach((card, i) => setFlip(card, text[i], env));
}

/**
 * Mount one root. `deps` overrides the browser globals (tests pass a fake clock and document).
 * Returns { stop, tick } or null when the root is not configured.
 */
export function mountCountdown(root, deps = {}) {
  return mountAt(root, parseDeadline(root.getAttribute('data-deadline')), { ...globals(), ...deps });
}

function mountAt(root, deadline, env, hooks = {}) {
  if (Number.isNaN(deadline)) return null;
  const expiredText = root.getAttribute('data-expired-text') || '';
  const expiredMode = root.getAttribute('data-expired') === 'text' && expiredText ? 'text' : 'hide';
  const parts = partsOf(root);
  injectStyles(env.document);
  wireAddMenu(env.document);
  // The largest unit present absorbs every unit above it (see the header).
  const largest = UNITS.find((u) => parts.some((p) => p.unit === u));

  // Reduced motion, live: `env.reduced` is what every card reads, at every change and every drum step.
  // Subscribed while the countdown runs: from mount (or a tick() after stop()) until stop(). Switching
  // it on also settles any fold in flight, so no card sits half-turned under the reduce-motion CSS.
  if (env.reduced === undefined) env.reduced = !!(env.motion && env.motion.matches);
  const settleAll = () => { for (const part of parts) for (const card of part.cards) settleFlip(card, env); };
  const onMotion = (e) => { env.reduced = !!e.matches; if (env.reduced) settleAll(); };
  let listening = false;
  const listen = (on) => {
    if (on === listening || !env.motion) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    if (!env.motion[method]) return;
    env.motion[method]('change', onMotion);
    listening = on;
  };
  listen(true);

  let timer = null;
  const stop = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    listen(false);
    settleAll();
  };
  // The display (whole seconds left, floored) changes the moment the time left drops below the next
  // whole second — `(deadline - now) % 1000` ms from now, which is 0 when sitting exactly on one. The
  // next tick goes exactly there, plus a few ms so it lands after the boundary, not before it.
  const schedule = () => {
    if (timer !== null) env.clearTimeout(timer);
    listen(true);   // a tick() after stop() resumes, and must follow reduced motion again
    timer = env.setTimeout(tick, ((deadline - env.now()) % 1000) + 5);
  };

  function tick() {
    const left = remainingParts(deadline, env.now());
    if (left.expired) {
      stop();
      // A fed root may have somewhere to go from here (the event's end, or the next event).
      if (hooks.onExpired && hooks.onExpired()) return left;
      root.removeAttribute('data-under-a-day');
      if (expiredMode === 'text') {
        root.textContent = expiredText;
        root.hidden = false;
      } else {
        root.hidden = true;
      }
      return left;
    }
    for (const part of parts) {
      const value = part.unit === largest
        ? Math.floor(left.total / UNIT_SECONDS[part.unit])
        : left[part.unit];
      const text = pad2(value);
      if (part.flip) showFlip(part, text, env);
      else part.el.textContent = text;
    }
    if (left.days === 0) root.setAttribute('data-under-a-day', '');
    else root.removeAttribute('data-under-a-day');
    root.hidden = false;
    schedule();
    return left;
  }

  tick();
  return { stop, tick, get running() { return timer !== null; } };
}

const CONDITIONS = {
  title: (event) => !!eventText(event, 'title'),
  description: (event) => !!eventText(event, 'description'),
  location: (event) => locationKind(event) !== 'none',
  url: (event) => locationKind(event) === 'url',
  place: (event) => locationKind(event) === 'place',
  several: (event, ctx) => ctx.count > 1,
};

/**
 * Write one event into the host's markup. Digits are not touched: that is mountAt's. `measuring`
 * is the fit pass laying every event out in turn: it leaves the paging controls alone, because
 * disabling a focused button — even for an instant — drops the visitor's focus to the page.
 */
function fillSlots(root, event, ctx, env, measuring = false) {
  for (const el of root.querySelectorAll('[data-event]')) {
    el.textContent = eventText(event, el.getAttribute('data-event'), ctx);
  }
  for (const el of root.querySelectorAll('[data-event-href]')) {
    const which = el.getAttribute('data-event-href');
    const href = eventHref(event, which, env.userAgent);
    if (href) el.setAttribute('href', href);
    else el.removeAttribute('href');
    // an add-to-calendar link that also knows the event as a file opens the shared two-row menu
    const file = which === 'add' && href ? eventFile(event, ctx.src) : '';
    if (file) el.setAttribute(ADD_FILE_ATTR, file);
    else el.removeAttribute(ADD_FILE_ATTR);
  }
  for (const el of root.querySelectorAll('[data-event-if]')) {
    const holds = CONDITIONS[el.getAttribute('data-event-if')];
    el.hidden = !(holds && holds(event, ctx));
  }
  root.setAttribute('data-event-location', locationKind(event));
  if (measuring) return;
  for (const el of root.querySelectorAll('[data-event-nav]')) {
    const dir = el.getAttribute('data-event-nav');
    el.disabled = dir === 'prev' ? ctx.index === 0 : dir === 'next' ? ctx.index === ctx.count - 1 : true;
  }
  root.setAttribute('data-event-index', String(ctx.index + 1));
  root.setAttribute('data-event-count', String(ctx.count));
}

/** The language the PAGE declares (`<html lang>`), and only that: which calendar a page shows is the
 *  page's business, not the visitor's browser's. */
function documentLanguage(env) {
  const html = env.document && env.document.documentElement;
  return (html && html.getAttribute('lang')) || '';
}

function pageLanguage(env) {
  const html = env.document && env.document.documentElement;
  return (html && html.getAttribute('lang')) || env.language || '';
}

/**
 * Mount a root whose countdown comes from its `data-src` feed. Resolves to a controller —
 * { stop, next, prev, index, count, running } — once it is showing an event, to what mountCountdown
 * returns when it fell back to a typed `data-deadline`, or to null when the root was left as
 * authored. Never rejects — a feed is a third party, and its failure is the fallback's business,
 * not the page's.
 */
export const FEED_TIMEOUT_MS = 8000;
export async function mountFromFeed(root, deps = {}) {
  const env = { ...globals(), ...deps };
  let feed = null;
  let timer = null;
  const src = feedSource(root, documentLanguage(env));
  try {
    // A feed that never answers is a feed that failed: without this a `hidden` root would wait on
    // it forever and its typed `data-deadline` would never get its turn.
    const late = new Promise((resolve) => { timer = env.setTimeout(() => resolve(null), FEED_TIMEOUT_MS); });
    const read = async () => {
      const res = env.fetch && src ? await env.fetch(src, { headers: { Accept: 'application/json' } }) : null;
      return res && res.ok ? res.json() : null;
    };
    feed = await Promise.race([read(), late]);
  } catch {
    feed = null;
  }
  if (timer !== null) env.clearTimeout(timer);

  let items = upcoming(feed, env.now());
  if (!items.length) return mountAt(root, parseDeadline(root.getAttribute('data-deadline')), env);

  const calendar = feed && feed.calendar && typeof feed.calendar === 'object' ? feed.calendar : null;
  const locale = pageLanguage(env);
  let current = items[0];
  let counting = null;
  let stopped = false;
  // The feed's address is handed to the links only when the feed says it serves an event as a file.
  const fileSrc = feed && feed.ics === true ? src : '';
  const ctxOf = (item) => ({ calendar, locale, src: fileSrc, index: items.indexOf(item), count: items.length });

  // The unit words are the page's, not the event's: once.
  for (const el of root.querySelectorAll('[data-unit]')) {
    const word = unitText(el.getAttribute('data-unit'), locale);
    if (word) el.textContent = word;
  }

  // ── data-event-fit: as tall as the tallest event needs ────────────────────────────────────────
  // Every event is laid out once and measured, so paging never moves the controls or the edges.
  // It can only be measured while it has a box (a root inside a closed panel has none), so it is
  // measured again whenever the element's width changes — which is also what "became visible" is.
  const fitEl = root.getAttribute('data-event-fit') !== null ? root : root.querySelector('[data-event-fit]');
  // The host's own min-height, if it wrote one, is the floor this never goes below or erases.
  const authoredMinHeight = fitEl && fitEl.style ? fitEl.style.minHeight || '' : '';
  let fitWidth = -1, fitHeight = 0;
  function fit() {
    if (!fitEl || typeof fitEl.getBoundingClientRect !== 'function') return;
    const width = fitEl.getBoundingClientRect().width;
    if (!(width > 0)) return;
    if (width !== fitWidth) fitHeight = 0;      // a new width is a new layout; the same one never shrinks
    fitWidth = width;
    closeMore();                                // the height kept is the height with everything closed
    fitEl.style.minHeight = authoredMinHeight;
    if (items.length > 1) {
      for (const item of items) {
        fillSlots(root, item.event, ctxOf(item), env, true);
        fitHeight = Math.max(fitHeight, fitEl.getBoundingClientRect().height);
      }
      fillSlots(root, current.event, ctxOf(current), env, true);
    }
    if (fitHeight > 0) fitEl.style.minHeight = Math.ceil(fitHeight) + 'px';
    measureMore();
  }
  // ── data-event-more: text the host clips, opened in place ─────────────────────────────────────
  // Whether a line is clipped is only known once it is laid out, so it is measured — after every
  // fill, and again with the fit. A clipped one gets `data-event-clipped` and becomes a control
  // (role, tabindex, aria-expanded; click, Enter and Space) that sets `data-event-open`; the host's
  // CSS shows the whole text for that attribute. One that fits is left exactly as authored: no
  // role, not focusable, nothing to press. Showing another event closes it.
  const moreEls = root.querySelectorAll('[data-event-more]');
  // 🔴 Either box may be the one that clips: the element itself (`<p data-event-more>` with a
  // line clamp, an inline <span> inside it — whose own heights are 0) or the text inside it (a
  // clamped <span> in a flex row). Measuring only one of them means the other markup never opens.
  const overflows = (box) => !!box && typeof box.scrollHeight === 'number' && typeof box.clientHeight === 'number'
    && box.scrollHeight > box.clientHeight + 1;
  const clippedText = (el) => overflows(el) || overflows(el.getAttribute('data-event') !== null ? null : el.querySelector('[data-event]'));
  // An element with no box (inside a closed panel) cannot be measured; what was known stays known.
  const laidOut = (el) => typeof el.getBoundingClientRect !== 'function' || el.getBoundingClientRect().width > 0;
  const CONTROL = ['data-event-clipped', 'role', 'tabindex', 'aria-expanded'];
  function closeMore() {
    for (const el of moreEls) {
      el.removeAttribute('data-event-open');
      if (el.getAttribute('data-event-clipped') !== null) el.setAttribute('aria-expanded', 'false');
    }
  }
  function measureMore() {
    for (const el of moreEls) {
      if (el.getAttribute('data-event-open') !== null) continue;   // open: it is clipped by definition
      if (!laidOut(el)) continue;
      if (clippedText(el)) {
        el.setAttribute('data-event-clipped', '');
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-expanded', 'false');
      } else {
        for (const name of CONTROL) el.removeAttribute(name);
      }
    }
  }
  const toggleMore = (el) => {
    if (stopped || el.getAttribute('data-event-clipped') === null) return;
    const open = el.getAttribute('data-event-open') === null;
    if (open) el.setAttribute('data-event-open', '');
    else el.removeAttribute('data-event-open');
    el.setAttribute('aria-expanded', String(open));
  };
  for (const el of moreEls) {
    if (typeof el.addEventListener !== 'function') continue;
    el.addEventListener('click', () => toggleMore(el));
    el.addEventListener('keydown', (e) => {
      if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
      if (el.getAttribute('data-event-clipped') === null) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();   // Space would scroll the page
      toggleMore(el);
    });
  }

  let observer = null;
  if (fitEl && env.ResizeObserver) {
    // A box that went away and came back at the SAME width (a panel closed and reopened) needs no
    // new fit, but what was filled while it was away could not be measured for clipping.
    let away = false;
    observer = new env.ResizeObserver(() => {
      const width = fitEl.getBoundingClientRect().width;
      if (!(width > 0)) { away = true; return; }
      if (width !== fitWidth) fit();
      else if (away) measureMore();
      away = false;
    });
    observer.observe(fitEl);
  } else if (moreEls.length && env.ResizeObserver) {
    // No fit element to tell us the layout changed: watch the root for the same reason (it also
    // fires when a closed panel opens, which is when clipping first becomes knowable).
    let seen = -1, away = false;
    observer = new env.ResizeObserver(() => {
      const width = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect().width : 0;
      if (!(width > 0)) { away = true; return; }
      if (width !== seen || away) { seen = width; measureMore(); }
      away = false;
    });
    observer.observe(root);
  }
  const fonts = env.document && env.document.fonts;
  if (fitEl && fonts && fonts.ready && typeof fonts.ready.then === 'function') {
    fonts.ready.then(() => { if (!stopped) { fitWidth = -1; fit(); } }).catch(() => {});
  }

  // 🔴 `show` can be re-entered: mounting ticks at once, and a tick that finds its moment already
  // past calls onExpired, which shows something else. Only the LATEST call may keep its countdown —
  // an outer call that overwrote `counting` with its own dead one would orphan the live timer, and
  // stop() could then never reach it.
  let shows = 0;
  function show(item) {
    const mine = ++shows;
    current = item;
    if (counting) counting.stop();
    closeMore();
    fillSlots(root, item.event, ctxOf(item), env);
    measureMore();
    root.setAttribute('data-event-state', phaseOf(item, env.now()));
    const mounted = mountAt(root, nextMoment(item, env.now()), env, { onExpired });
    if (mine === shows) counting = mounted;
  }

  // At zero: what is still to come is worked out afresh (an event that has started now counts to
  // its end and may have moved down the order; one that has ended is gone). The visitor keeps the
  // event they were looking at while it lasts, and gets the one that took its place when it is over.
  function onExpired() {
    if (stopped) return true;
    const was = current.event, at = items.indexOf(current);
    items = upcoming(feed, env.now());
    if (!items.length) return false;            // nothing left: expire as a typed deadline does
    show(items.find((item) => item.event === was) || items[Math.min(at, items.length - 1)]);
    return true;
  }

  // Paging first lets go of what has ended since the list was last worked out (only the event
  // being viewed has a timer; the others end unwatched). The order is NOT re-sorted here — that
  // happens at zero — so nothing but the ended ones moves.
  const go = (step) => {
    if (stopped) return;
    const now = env.now();
    const at = items.indexOf(current);
    const live = items.filter((item) => item.endsAt > now);
    if (live.length !== items.length) {
      const before = items.slice(0, at).filter((item) => item.endsAt > now).length;
      items = live;
      if (!items.length) { onExpired(); return; }
      if (!items.includes(current)) { show(items[Math.min(Math.max(before + (step > 0 ? 0 : -1), 0), items.length - 1)]); return; }
    }
    const to = items.indexOf(current) + step;
    if (to < 0 || to >= items.length) { fillSlots(root, current.event, ctxOf(current), env); return; }   // it stops at the ends; it does not wrap
    show(items[to]);
  };
  for (const el of root.querySelectorAll('[data-event-nav]')) {
    const dir = el.getAttribute('data-event-nav');
    if (typeof el.addEventListener === 'function') el.addEventListener('click', () => go(dir === 'prev' ? -1 : dir === 'next' ? 1 : 0));
  }

  show(current);
  fit();
  return {
    stop() {
      stopped = true;
      if (counting) counting.stop();
      if (observer) observer.disconnect();
      // Nothing answers a press any more, so nothing may still look or focus like a control.
      for (const el of moreEls) for (const name of CONTROL) el.removeAttribute(name);
    },
    next: () => go(1),
    prev: () => go(-1),
    get index() { return items.indexOf(current); },
    get count() { return items.length; },
    get running() { return !stopped && !!counting && counting.running; },
  };
}

export function mountAll(doc, deps = {}) {
  doc.querySelectorAll(SELECTOR).forEach((root) => {
    if (root.getAttribute('data-dynamic-coral-mounted') === '1') return;
    root.setAttribute('data-dynamic-coral-mounted', '1');
    // A feed for THIS page's language (data-src-<language>, else data-src); a root with none is typed.
    const env = { ...globals(), document: doc, ...deps };
    if (feedSource(root, documentLanguage(env))) mountFromFeed(root, { document: doc, ...deps });
    else mountCountdown(root, { document: doc, ...deps });
  });
}
