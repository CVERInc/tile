// Outbound destinations of a card — REGISTERED by the renderer, never parsed back out of its output.
//
// 🔴 WHY THIS FILE HAS NO PARSER (reef#2054, tile#127). Reading destinations back out of the finished
// HTML is a second parser, and it drifts from the browser however carefully it is patched: round 1
// missed `url()`, round 2 missed CSS escapes and raw <style> text, and plain text that merely looks
// like `url(…)` counted as a destination. So `renderCardHTML` itself reports each author-given URL
// (ctx.onDestination) at the point it writes it into an href / src / url(), before escaping — what
// the author wrote is what the browser ends up with. This file only collects them.
import { renderCardHTML } from './card-worker.mjs';

/** card markdown → the unique outbound http(s) destinations the served page contains, in render order. */
export function cardDestinations(cardMd) {
  const out = new Set();
  renderCardHTML(cardMd, { onDestination: (u) => out.add(u) });
  return [...out];
}
