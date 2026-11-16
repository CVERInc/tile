// Where the page view's bytes go: how much of the HTML is the per-tile markup, and how much is one
// stylesheet repeated. renderGrid (card-render.mjs) opens every grid it draws with
// `<style>${NATIVE_CSS}</style>`, and renderDrawers draws one grid per back — so a file with B backs
// carries the stylesheet B + 1 times. Prints one JSON line.
//
//   node html-share.mjs <tiles>        builds the sample's first <tiles> tiles with sample.mjs
import worker from '../../serve/card-worker.mjs';
import { cardKey } from '../../serve/card-api.mjs';
import { pieces } from './sample.mjs';
import { fakeKv, noNetwork } from './harness.mjs';

const K = Number(process.argv[2] || 834151);
const tried = noNetwork();
const md = [...pieces(K - 1)].join('');
const env = { CARDS: fakeKv({ [cardKey('every-number', '0')]: md }) };
const html = await (await worker.fetch(new Request('https://card.feelreef.com/every-number'), env, { waitUntil() {} })).text();

// the stylesheet every grid opens with, read from the page itself: the first <style> inside .st-card
const at = html.indexOf('<div class="st-card');
const s0 = html.indexOf('<style>', at) + 7;
const css = html.slice(s0, html.indexOf('</style>', s0));
let copies = 0;
for (let i = html.indexOf(css); i >= 0; i = html.indexOf(css, i + css.length)) copies++;
const bytes = Buffer.byteLength(html);
const cssBytes = Buffer.byteLength(css);
const backs = (md.match(/^## back: /gm) || []).length;
console.log(JSON.stringify({
  tiles: K, backs, htmlBytes: bytes,
  gridStylesheetBytes: cssBytes, gridStylesheetCopies: copies,
  repeatedStylesheetBytes: (copies - 1) * cssBytes,
  shareOfPage: Math.round(((copies - 1) * cssBytes / bytes) * 1000) / 10,
  networkAttempts: tried.length,
}));
