// The first card peeks under the last, and a tap on it goes back to the start (tile#345) — asked of WebKit, the engine
// of Safari. What each arm asks: verify/stack-wrap-arms.mjs; the Chromium arms: verify/stack-wrap.mjs.
//
// WebKit has no Element.moveBefore, so its pile draws through shadow slots (deck.js pileOrder): a path Chromium never
// takes. And the report this answers came from Safari: on a pile of 22 a tap on the first card under the last put it up
// with no motion. That was not WebKit — Chromium did the same (sync() read the 21-card scroll as a JUMP); the arms here
// are the ones that went red on it in WebKit, against a short pile that never did.
//
//   desktop-deck-pool   a pile of 6 at 1280×800: the walk back at 120 ms a card, through the slots
//   desktop-long        a pile of 22 at 1280×800: a run through every card at the riffle's pace, not a jump
//   phone-long          the same on a 390×844 phone, with touch (⚠ which card a tap on the sliver reaches is noted)
//   desktop-long-enter  a pile of 22, Enter while the run back is under way: the first card opens, and stays open
//   desktop-long-list   a pile of 22, the list button while the run back is under way: the list and the current card
//                       stay together (both went red on b13e032)
//
// CONTROL: every arm first asks that the pile has the cards it was made with; desktop-long and phone-long went red
// (10 problems: 5 each) on deck.js before wrapBack, while desktop-deck-pool stayed green.
//
// A WebKit build is not always there to launch: without one this prints a usage line and run-all.mjs reads it SKIPPED.
//
//   PLAYWRIGHT=/path/to/playwright node packages/cardtile/verify/stack-wrap-webkit.mjs
import { runStackWrap } from './stack-wrap-arms.mjs';

await runStackWrap({
  engine: 'webkit', label: 'stack-wrap-webkit',
  devices: {
    desktop: { viewport: { width: 1280, height: 800 } },
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  },
  arms: [
    ['desktop-deck-pool', { page: 'deck' }],
    ['desktop-long', { page: 'long' }],
    ['phone-long', { page: 'long', device: 'phone' }],
    ['desktop-long-enter', { page: 'long', interrupt: 'open' }],
    ['desktop-long-list', { page: 'long', interrupt: 'list' }],
  ],
});
