// The ONE place a rendered card page becomes a deck. card-worker.mjs's renderCardHTML calls it for
// every public Card page, and the editor's preview (w3/edit3.mjs) gets its page from that same
// renderCardHTML — so what the editor shows in a view and what a visitor gets cannot drift apart.
//
// What it adds, and nothing else:
//   <head>  the deck's stylesheet (a versioned, immutable same-origin file — see DECK_CSS_PATH)
//   </body> one small inline script that hands deck.js what it reads from the page:
//             window.__cardFront    a frontmatter fence holding ONLY the keys deck.js reads (views /
//                                   view / back) — never the whole file (given a whole file, deck.js
//                                   builds its items from Markdown), and never the rest of the
//                                   frontmatter: an author's other values have no business in a script
//             window.__deckStrings  the visitor's words, in the card's own `lang:` (w3/deck-i18n.mjs)
//             window.__deckRef      the handle, for the reef.cards link's ?ref= (absent: no ref)
//             window.__pool         only when the caller says so. The card pool is a PLATFORM switch,
//                                   never a file key (reef#2913); absent = in the pool. To deck.js,
//                                   false means "draw no reef.cards card or footer link of your own":
//                                   renderCardHTML also passes false when the PLATFORM's ctx.pool is
//                                   set, because the renderer has then drawn them itself (or not).
//           then deck.js itself (versioned, immutable — see DECK_JS_PATH)
//
// `view` is the editor's: it names the view it is showing, so the page opens on that one and the
// deck's own switcher stays out of the way (the editor's header is the switcher).
//
// 🔴 Pure string work, no DOM: it runs in the Worker and in the browser alike.
import { DECK_VERSION } from '../serve/deck-assets.mjs';
import { deckStrings } from './deck-i18n.mjs';

export const DECK_CSS_PATH = `/_deck/deck-${DECK_VERSION}.css`;
export const DECK_JS_PATH = `/_deck/deck-${DECK_VERSION}.js`;
export const DECK_VIEWS = ['stack', 'list', 'wall'];

export const DECK_KEYS = ['views', 'view', 'back'];

/** the frontmatter fence of a card file, cut down to the keys the deck reads, or '' when none is set */
export function frontOf(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(String(md || '').replace(/\r\n/g, '\n'));
  if (!m) return '';
  const lines = m[1].split('\n').filter((l) => DECK_KEYS.some((k) => l.startsWith(`${k}:`)));
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

/** the fence with its `view:` line replaced by `view` (a fence is made when there is none) */
export function frontWithView(front, view) {
  const lines = front ? front.slice(4, -5).split('\n').filter((l) => !/^view:/.test(l)) : [];
  lines.push(`view: ${view}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

// JSON that is safe inside an inline <script>: no `</script>`, no `<!--`
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * html (renderCardHTML's page) + the card file it was made from → the same page as a deck.
 * opts: { view?: 'stack'|'list'|'wall', pool?: boolean, handle?: string, lang?: string }
 */
export function withDeck(html, md, { view = '', pool, handle = '', lang = '' } = {}) {
  const v = DECK_VIEWS.includes(view) ? view : '';
  let front = frontOf(md);
  if (v) front = frontWithView(front, v);
  const cfg = { __cardFront: front, __deckStrings: deckStrings(lang) };
  if (handle) cfg.__deckRef = String(handle);
  if (typeof pool === 'boolean') cfg.__pool = pool;
  const boot = Object.entries(cfg).map(([k, val]) => `window.${k}=${scriptJson(val)};`).join('');
  const head = `<link rel="stylesheet" href="${DECK_CSS_PATH}">${v ? '<style id="deck-view">.deck-seg{display:none!important}</style>' : ''}`;
  const tail = `<script>${boot}</script><script src="${DECK_JS_PATH}"></script>`;
  // </head> is the renderer's own and comes before any card content; </body> is taken from the END,
  // so nothing a card carries in its body can be mistaken for it
  const h = html.indexOf('</head>');
  const b = html.lastIndexOf('</body>');
  if (h < 0 || b < 0 || b < h) return html;
  return html.slice(0, h) + head + html.slice(h, b) + tail + html.slice(b);
}
