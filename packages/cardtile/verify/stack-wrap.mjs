// The first card peeks under the last, and a tap on it goes back to the start (tile#345) — asked of real Chromium.
// What each arm asks, and why a browser: verify/stack-wrap-arms.mjs. The same arms in WebKit: verify/stack-wrap-webkit.mjs.
//
//   desktop-none / -deck-pool / -renderer-pool   a pile of 5–6: the three ways a page ends (no reef.cards card, the
//                                                deck's own, the renderer's tile); the walk back at 120 ms a card
//   phone-deck-pool                              the same on a 390 px phone, with touch (⚠ which card a tap on the
//                                                sliver reaches is noted, not judged)
//   reduced-desktop / reduced-phone              prefers-reduced-motion: back at once, nothing travels
//   long                                         a pile of 22: a run through every card at the riffle's pace — it
//                                                used to be a jump with no motion (the shape it was seen on)
//   whole                                        a pile of 61, past the whole pile: ⚠ noted, the tap is still a jump
//
// CONTROL: every arm first asks that the pile has the cards it was made with; `long` went red (5 problems: 0 cards
// rose, no side flight, 0 flights, no pace, no span) on deck.js before wrapBack, when the tap there was a jump; every
// other arm stayed green there.
//
// Every wait is a condition, not a sleep: run-all.mjs gives a harness 90 s.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/stack-wrap.mjs
import { runStackWrap } from './stack-wrap-arms.mjs';

await runStackWrap({
  engine: 'chromium', label: 'stack-wrap',
  devices: {
    desktop: { viewport: { width: 900, height: 800 } },
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  },
  arms: [
    ['desktop-none', { page: 'none' }],
    ['desktop-deck-pool', { page: 'deck' }],
    ['desktop-renderer-pool', { page: 'renderer' }],
    ['phone-deck-pool', { page: 'deck', device: 'phone' }],
    ['reduced-desktop', { page: 'deck', reduced: true }],
    ['reduced-phone', { page: 'deck', device: 'phone', reduced: true }],
    ['long', { page: 'long' }],
    ['whole', { page: 'whole' }],
  ],
});
