// Outbound destinations of a card — REGISTERED by the renderer, never parsed back out of its output.
//
// 🔴 WHY THIS FILE HAS NO PARSER (reef#2054, tile#127). Reading destinations back out of the finished
// HTML is a second parser, and it drifts from the browser however carefully it is patched: round 1
// missed `url()`, round 2 missed CSS escapes and raw <style> text, and plain text that merely looks
// like `url(…)` counted as a destination. So `renderCardHTML` itself reports each author-given URL
// (ctx.onDestination) at the point it writes it into an href / src / url(), before escaping — what
// the author wrote is what the browser ends up with. This file only collects them.
import { renderCardHTML } from './card-worker.mjs';

// 🔴 tile#127 round 4: the registry holds what the AUTHOR wrote (or what the renderer wrote), which is
// not always what the browser requests — `https://e.example/a b` is fetched as `…/a%20b`, `a\b` as
// `a/b`, and CSS turns U+0000 into U+FFFD before it parses a url(). Web Risk must be asked about the
// URL the browser sends, so every registered value is run through the WHATWG URL parser (its serialisation)
// before it leaves here; a value the parser rejects is kept as written. De-duplication is after this.
const effective = (raw) => {
  const s = String(raw).replace(/\u0000/g, '\ufffd');
  try { return String(new URL(s)); } catch { return s; }
};

/** card markdown → the unique outbound http(s) destinations the served page contains, in render order. */
export function cardDestinations(cardMd) {
  const out = new Set();
  renderCardHTML(cardMd, { destinationBase: 'https://card.invalid/card/', onDestination: (u) => out.add(effective(u)) });
  return [...out];
}
