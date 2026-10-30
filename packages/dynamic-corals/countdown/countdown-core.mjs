// REEF with Countdown — the page half. A root names a deadline; the elements inside it that carry
// `data-part` show how much of it is left. No network, nothing stored, no copy of its own: every
// word around the numbers is the host's markup, so a page in any language is just that page.
//
//   <div data-dynamic-coral="countdown" data-deadline="2026-12-01T23:59:59+09:00" hidden>
//     <span data-part="days" data-flip></span> d <span data-part="hours" data-flip></span> …
//   </div>
//
// `data-part` is days | hours | minutes | seconds. Without `data-flip` the element's text is the
// two-digit value; with it, the element holds one split-flap card per digit (shared/flip.mjs) and
// gains or drops a card on the left when the digit count changes (99 → 100 days), so the cards that
// keep their place keep their state. A visually hidden copy of the value stays readable to a screen
// reader; the cards themselves are aria-hidden.
//
// The root is shown after the first tick (an author who adds `hidden` never sees 00 flash). At the
// deadline the timer stops and `data-expired` decides what remains: `hide` (default) hides the root,
// `text` replaces its content with `data-expired-text`. A deadline without an explicit offset is
// refused (see shared/countdown-parts.mjs) and the root is left exactly as authored.
import { parseDeadline, remainingParts, pad2 } from '../shared/countdown-parts.mjs';
import { createFlip, setFlip, FLIP_CSS } from '../shared/flip.mjs';
import { withDynamicCoralCssLayer } from '../shared/dynamic-coral-css.mjs';

export const SELECTOR = '[data-dynamic-coral="countdown"]';
const UNITS = ['days', 'hours', 'minutes', 'seconds'];
const SR_CSS = '.dc-cd-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}';

const styled = new WeakSet();
function injectStyles(doc) {
  if (styled.has(doc) || !doc.head) return;
  styled.add(doc);
  const style = doc.createElement('style');
  style.setAttribute('data-dc', 'countdown');
  style.textContent = withDynamicCoralCssLayer(FLIP_CSS + SR_CSS, doc);
  doc.head.appendChild(style);
}

function globals() {
  const w = typeof window !== 'undefined' ? window : {};
  return {
    document: typeof document !== 'undefined' ? document : null,
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    reduced: !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches),
  };
}

function partsOf(root) {
  const parts = [];
  for (const el of root.querySelectorAll('[data-part]')) {
    const unit = el.getAttribute('data-part');
    if (!UNITS.includes(unit)) continue;
    parts.push({ el, unit, flip: el.getAttribute('data-flip') !== null, cards: [], sr: null });
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
    const card = createFlip(env.document);
    el.insertBefore(card, part.cards[0] || part.sr);
    part.cards.unshift(card);
  }
  while (part.cards.length > text.length) part.cards.shift().remove();
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
  const expiredMode = root.getAttribute('data-expired') === 'text' ? 'text' : 'hide';
  const parts = partsOf(root);
  if (parts.some((p) => p.flip)) injectStyles(env.document);

  let timer = null;
  const stop = () => { if (timer !== null) env.clearInterval(timer); timer = null; };

  function tick() {
    const left = remainingParts(deadline, env.now());
    if (left.expired) {
      stop();
      if (expiredMode === 'text') {
        root.textContent = root.getAttribute('data-expired-text') || '';
        root.hidden = false;
      } else {
        root.hidden = true;
      }
      return left;
    }
    for (const part of parts) {
      const text = pad2(left[part.unit]);
      if (part.flip) showFlip(part, text, env);
      else part.el.textContent = text;
    }
    root.hidden = false;
    return left;
  }

  if (!tick().expired) timer = env.setInterval(tick, 1000);
  return { stop, tick, get running() { return timer !== null; } };
}

export function mountAll(doc, deps = {}) {
  doc.querySelectorAll(SELECTOR).forEach((root) => {
    if (root.getAttribute('data-dynamic-coral-mounted') === '1') return;
    root.setAttribute('data-dynamic-coral-mounted', '1');
    mountCountdown(root, { document: doc, ...deps });
  });
}
