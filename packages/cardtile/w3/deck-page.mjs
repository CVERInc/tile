// The ONE place a rendered card page becomes a deck. card-worker.mjs's renderCardHTML calls it for
// every public Card page, and the editor's preview (w3/edit3.mjs) gets its page from that same
// renderCardHTML — so what the editor shows in a view and what a visitor gets cannot drift apart.
//
// What it adds, and nothing else:
//   <html>  data-view (the view the page opens on) and data-views (the views the file offers), read
//           from the file's `view:` / `views:` — so the opening view is in the markup, not decided
//           after load. data-view-pin as well when the caller names the view (the editor).
//   <head>  the deck's stylesheet (a versioned, immutable same-origin file — see DECK_CSS_PATH)
//           and one small inline script (DECK_HEAD_JS) that runs before the first paint: it applies
//           a visitor's own last pick when the file offers it, and turns data-view into the classes
//           the stylesheet keys on (html.deck, html.list). 🔴 The classes are the script's and not
//           the markup's on purpose: a page whose scripts never run has no deck to draw the pile,
//           so without them it stays the wall — the engine's page, readable as it is.
//   </body> one small inline script that hands deck.js what it reads from the page:
//             window.__cardFront    a frontmatter fence holding ONLY the keys deck.js reads (views /
//                                   view / back) — never the whole file (given a whole file, deck.js
//                                   builds its items from Markdown), and never the rest of the
//                                   frontmatter: an author's other values have no business in a script
//             window.__deckStrings  the visitor's words, in the card's own `lang:` (w3/deck-i18n.mjs)
//             window.__deckRef      the handle, for the reef.cards link's ?ref= (absent: no ref)
//             window.__pool         only when the caller says so. The card pool is a PLATFORM switch,
//                                   never a file key (reef#2913). To deck.js, only true means "in the
//                                   pool: draw your reef.cards card and footer link"; absent, false or
//                                   anything else means out — "draw no reef.cards card or footer link":
//                                   renderCardHTML also passes false when the PLATFORM's ctx.pool is
//                                   set, because the renderer has then drawn them itself (or not).
//           then deck.js itself (versioned, immutable — see DECK_JS_PATH). If it fails to load,
//           throws, or has said nothing by the time the page is parsed, the head script's
//           __deckFail takes the deck's classes off again, for the same reason as above (deck.js
//           does the same itself when it throws half-way, after sending every tile home).
//
// `view` is the editor's: it names the view it is showing, so the page opens on that one and the
// deck's own switcher stays out of the way (the editor's header is the switcher). To show another
// view of the same document the editor calls the page's own window.__deckView(name) — the switch a
// visitor's tap makes, in place — instead of asking for the page again.
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

/**
 * The views a card file offers and the one it opens on — the file's own rule, read here so the
 * markup can carry it: `views:` lists what a visitor may switch between (all three when absent; the
 * order written is kept), `view:` names the one that opens when it is offered, else the first offered.
 * 🔴 deck.js keeps the same rule for a page that was not made here (it has no markup to read);
 * w3/deck-views.test.mjs runs both over one matrix so they cannot drift apart.
 */
export function openingView(md) {
  const fm = {};
  for (const l of frontOf(md).split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) fm[k[1]] = k[2].trim(); }
  const views = String(fm.views || DECK_VIEWS.join(' ')).split(/[\s,]+/).filter((v) => DECK_VIEWS.includes(v));
  if (!views.length) views.push(DECK_VIEWS[0]);
  return { view: views.includes(fm.view) ? fm.view : views[0], views };
}

/**
 * The head script: before the first paint, the root gets the classes of the view the page opens on.
 * A visitor's last pick (localStorage `reef-card-layout`, in the deck's inner names) wins when the
 * file offers it and the view was not named for the page (data-view-pin). Storage that throws is
 * storage that says nothing.
 */
export const DECK_HEAD_JS = "(function(d){var v=d.getAttribute('data-view');try{if(!d.hasAttribute('data-view-pin')){var s={deck:'stack',list:'list',spread:'wall'}[localStorage.getItem('reef-card-layout')];if(s&&(' '+d.getAttribute('data-views')+' ').indexOf(' '+s+' ')>=0){v=s;d.setAttribute('data-view',v);}}}catch(e){}if(v!=='wall')d.classList.add('deck');if(v==='list')d.classList.add('list');"
  // …and the way back. Under html.deck the stylesheet does not draw the engine's grid, so a deck that never comes up
  // would leave an empty table. window.__deckBoot is deck.js's word ('ready', or 'pending' while it fetches a card
  // file): no word once the page is parsed (the script threw, or was never run) is a failure, and so is the script's
  // own onerror. No word after DECK_WAIT_MS is only a slow script: the wall is shown meanwhile, the root keeps the
  // view it opens on, and deck.js puts the pile's classes back when it arrives.
  + "window.__deckFail=function(){d.classList.remove('deck','list');d.setAttribute('data-view','wall');d.setAttribute('data-deck-off','');};document.addEventListener('DOMContentLoaded',function(){if(!window.__deckBoot)window.__deckFail();});setTimeout(function(){if(!window.__deckBoot)d.classList.remove('deck','list');},3000);"
  + "})(document.documentElement);";
/** how long a page that opens on a pile waits for deck.js before it shows the wall instead (the number in DECK_HEAD_JS) */
export const DECK_WAIT_MS = 3000;
/** deck.js did not load: there is no deck, so the page is the wall */
const DECK_ONERROR = "__deckFail()";

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
  const head = `<link rel="stylesheet" href="${DECK_CSS_PATH}">${v ? '<style id="deck-view">.deck-seg{display:none!important}</style>' : ''}<script>${DECK_HEAD_JS}</script>`;
  const tail = `<script>${boot}</script><script src="${DECK_JS_PATH}" onerror="${DECK_ONERROR}"></script>`;
  // <html is the renderer's own first tag; </head> is its own too and comes before any card content;
  // </body> is taken from the END, so nothing a card carries in its body can be mistaken for it
  const r = html.indexOf('<html');
  const h = html.indexOf('</head>');
  const b = html.lastIndexOf('</body>');
  if (r < 0 || h < r || b < h) return html;
  const o = openingView(front);
  const root = ` data-view="${o.view}" data-views="${o.views.join(' ')}"${v ? ' data-view-pin' : ''}`;
  return html.slice(0, r + 5) + root + html.slice(r + 5, h) + head + html.slice(h, b) + tail + html.slice(b);
}
