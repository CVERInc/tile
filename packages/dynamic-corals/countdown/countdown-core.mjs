// REEF with Countdown — the page half. A root names a deadline; the elements inside it that carry
// `data-part` show how much of it is left. No network, nothing stored, no copy of its own: every
// word around the numbers is the host's markup, so a page in any language is just that page.
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
import { createFlip, setFlip, settleFlip, parseFaces, FLIP_CSS } from '../shared/flip.mjs';
import { withDynamicCoralCssLayer } from '../shared/dynamic-coral-css.mjs';

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
  const env = { ...globals(), ...deps };
  const deadline = parseDeadline(root.getAttribute('data-deadline'));
  if (Number.isNaN(deadline)) return null;
  const expiredText = root.getAttribute('data-expired-text') || '';
  const expiredMode = root.getAttribute('data-expired') === 'text' && expiredText ? 'text' : 'hide';
  const parts = partsOf(root);
  injectStyles(env.document);
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
    root.hidden = false;
    schedule();
    return left;
  }

  tick();
  return { stop, tick, get running() { return timer !== null; } };
}

export function mountAll(doc, deps = {}) {
  doc.querySelectorAll(SELECTOR).forEach((root) => {
    if (root.getAttribute('data-dynamic-coral-mounted') === '1') return;
    root.setAttribute('data-dynamic-coral-mounted', '1');
    mountCountdown(root, { document: doc, ...deps });
  });
}
