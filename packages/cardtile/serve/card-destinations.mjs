// Outbound destinations of a card, read off the RENDERER's output — never parsed from markdown.
//
// 🔴 WHY THERE IS NO MARKDOWN PARSER HERE (reef#2054). A guard that writes its own link extractor
// checks the URL it THINKS the card links to; the visitor clicks the URL the renderer ACTUALLY
// emitted. Three review rounds found four places those two differ (a bare `…/path!`, a balanced
// `a(b)c`, a feature `href=//host`, an unlinked `a b`), and every fix to the extractor was another
// copy of the grammar waiting to drift. So the set of destinations is produced by the same
// `renderCardHTML` the worker serves, and the only parsing done here is of HTML attributes.
import { renderCardHTML } from './card-worker.mjs';

const ATTR_RE = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// CSS `url(…)` anywhere in the render — `style="…"` attributes and `<style>` blocks. The quote around
// the target may be a raw ' or ", an HTML-escaped one inside an attribute (&#39; / &quot;), or absent.
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;|&#39;(.*?)&#39;|([^)\s'"]*))\s*\)/gi;

/** one pass of HTML entity unescaping — the renderer escapes attribute values exactly once. */
function unescapeOnce(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

/** HTML string → unique outbound http(s) URLs, in document order. data:, relative and in-page are skipped. */
export function outboundFromHtml(html) {
  const out = new Set();
  const add = (raw) => {
    let u = unescapeOnce(raw ?? '').trim();
    if (u.startsWith('//')) u = 'https:' + u;          // what a browser on the https card resolves
    if (!/^https?:\/\//i.test(u)) return;
    out.add(u);
  };
  for (const m of html.matchAll(ATTR_RE)) add(m[1] ?? m[2]);
  for (const m of html.matchAll(CSS_URL_RE)) add(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
  return [...out];
}

/** card markdown → the outbound destinations the served page would contain. */
export function cardDestinations(cardMd) {
  return outboundFromHtml(renderCardHTML(cardMd, {}));
}
