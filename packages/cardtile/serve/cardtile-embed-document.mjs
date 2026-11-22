// An `embed` tile as a document of its own: what keeps the page's policy on every page.
//
// An embed is the author's own HTML and script, in `<iframe sandbox="allow-scripts">` (an opaque
// origin: no storage, cookie or DOM of the page). Written as `srcdoc`, the frame's document INHERITS
// the parent's Content-Security-Policy, and the parent's script-src (cardtile-page-csp.mjs) refuses the
// author's script. So while the page's policy is ENFORCED (CARDS_PAGE_CSP exactly "enforce"), every
// embed frame of a page is written with `src` instead: a same-origin address that answers with the
// document the srcdoc held plus, at most, one `<base href>` (embedDocumentBody, below), under a policy of its own.
// The page's policy is then the same on every page, whatever the page holds, and nothing a person
// writes decides whether it is sent.
//
// Report-only (the default) and "off" keep the frame srcdoc: a report-only policy refuses nothing, so the
// author's script runs there as it always did (the browser reports it in its console, as it would refuse it
// under "enforce" — which is why "enforce" serves it as its own document).
//
// 🔴 THE ADDRESS ANSWERS IN EVERY STAGE (tile#372, the default's review). A page is cached for 60 s and a tab
// stays open for as long as its visitor likes; its lazy frames ask their address when they are scrolled to.
// So a page loaded under "enforce" asks its embeds' addresses after the setting went back to report-only or
// "off" — they answer as they did. And a page loaded before its owner edited an embed (or the theme or the
// accent, which every embed document carries) asks an address the file no longer has: that answers an empty
// document (embedMissResponse, below), never the "no card" page, which would be drawn inside the embed's box.
// The old document is not kept: an edit replaces the file, and keeping the previous documents answerable would
// need a store write per edit (a new write door, on a shared Worker) and would still not cover a tab open longer
// than the window it kept them for.
//
//   ADDRESS   <base>_embed/<sha256 of the document, 64 hex>[?w=<n>]
//             base is where the page's own pictures live (`/<handle>/`, `/` on a person's own domain,
//             `/_preview/<id>/` for a preview); `?w=<n>` names the window of a file served in windows.
//   WHICH     The address names a document; the Worker answers it only when the stored file (that window
//             of it) has an `embed` tile whose document has that hash, and with the empty document otherwise
//             (on a person's own domain whose file is gone, the small 404 every address there answers). The documents are made from the
//             parsed file — tiles whose type is `embed`, front and backs — by the renderer's own function,
//             never read out of the rendered page: an address cannot be made to answer with another
//             person's embed (their file is not read) or with any HTML that is not an embed of this file.
//   BODY      that document with, at most, one `<base href>`, so it resolves as in the srcdoc: embedDocumentBody, below.
//   HEADERS   embedDocumentHeaders, below.
import { renderEmbedHtml } from '../card-render.mjs';

// 🔴 NOTHING AT THE TOP LEVEL OF THIS MODULE RUNS (the editor's bundle is made from the Worker's import
// graph — see cardtile-page-csp.mjs): literals and functions only.
export const EMBED_SEGMENT = '_embed';
/** the tail of an embed document's address, after the base */
export const EMBED_TAIL_RE = /^\/_embed\/([0-9a-f]{64})$/;
// what packages/emit/embed.mjs writes, and the one value its srcdoc escape lets through unchanged
const FRAME_SRCDOC = '<iframe sandbox="allow-scripts" srcdoc="';
const FRAME_SRC = '<iframe sandbox="allow-scripts" src="';
const SRCDOC_ATTR = / srcdoc="([^"]*)"/;
// the inverse of embed.mjs srcdocAttr (`&` first there, so last here)
const fromSrcdoc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const hex = async (text) => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
};

/**
 * embedDocuments: (model, fm) → [{ attr, doc, hex }], one per distinct embed document of the model.
 * model: a parsed file or one window of one (card-core parseCard, size-tier windowOf); fm: key → the
 * file's frontmatter value. `attr` is the srcdoc attribute the page carries, `doc` the document.
 * Only tiles whose type is `embed` count: an `embed kind=slider` (slides), the word in text or an address
 * is none. An embed the renderer refuses (empty, over the ceiling) writes no frame and has no document.
 */
export async function embedDocuments(model, fm) {
  const cells = [...((model && model.cells) || []), ...((model && model.drawers) || []).flatMap((d) => d.cells || [])];
  const ctx = { accent: fm('accent'), theme: fm('theme') };
  const out = [];
  const seen = new Set();
  for (const c of cells) {
    if (!c || c.type !== 'embed') continue;
    const m = SRCDOC_ATTR.exec(renderEmbedHtml(c.body, '', ctx));
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const doc = fromSrcdoc(m[1]);
    out.push({ attr: m[1], doc, hex: await hex(doc) });
  }
  return out;
}

/** does the rendered page hold a srcdoc frame at all? (only whether there is anything to rewrite) */
export const hasSrcdocFrame = (page) => String(page).includes(FRAME_SRCDOC);

/**
 * framesAsDocuments: (page, documents, base, query) → the page with each embed frame of `documents`
 * written `src="<base>_embed/<hex><query>"` instead of `srcdoc="…"`. Every other byte is unchanged, the
 * frame's other attributes (sandbox, title, loading, referrerpolicy) included.
 */
export function framesAsDocuments(page, documents, base, query = '') {
  let out = String(page);
  for (const d of documents) out = out.split(`${FRAME_SRCDOC}${d.attr}"`).join(`${FRAME_SRC}${base}${EMBED_SEGMENT}/${d.hex}${query}"`);
  return out;
}

/** the document `documents` holds under this hash, or null */
export const embedDocumentOf = (documents, h) => (documents.find((d) => d.hex === h) || {}).doc ?? null;

/**
 * 🔴 WHERE ITS RELATIVE ADDRESSES POINT (tile#372 r2, r3). A srcdoc document's base is its parent's: an
 * author's `<img src="aster/favicon.ico">` on `/aster` meant `/aster/favicon.ico`. Served at
 * `/aster/_embed/<hash>` with nothing added, the same markup would mean `/aster/_embed/aster/favicon.ico`.
 * So the served document is the srcdoc's document with at most ONE element added: `<base href="…">`,
 * right after the head every embed document starts with (EMBED_DOC_HEAD, card-render.mjs renderEmbedHtml),
 * before the theme and before a byte the author wrote. The author's bytes are unchanged; the hash in the
 * address is still the srcdoc document's (it names WHICH embed; the base follows from the address).
 *
 *   <page>  the Cards' own address on the host serving it, root-relative (so the document's own origin):
 *           `/<handle>` on a shared host, `/` on a one-card host (a person's domain, the root card),
 *           `/_preview/<id>` for a preview. Path-, dot-, root-, scheme-relative and absolute addresses,
 *           `?q` and `#x` then resolve exactly as in the srcdoc on that page (cardtile-page-csp.test.mjs).
 *           Not carried: the query of the visitor's own address (`?lang=`, a window's `?w=&r=`), which
 *           only an empty, `?…` or `#…` address could see — those resolve against the bare page address.
 *   href only, never `target`: an author's own `<base target>` and every link's target act as before.
 *
 *   🔴 AN AUTHOR'S OWN `<base href>` (r3). In the srcdoc it was honoured: the document's base is its FIRST
 *   base element that has an href, in tree order, parsed against the parent page's address. A base added
 *   in front of it would be that first one, and the author's would be ignored (a widget that finds its
 *   script by its base stopped loading). So the author's base is found by reading the document the way the
 *   browser's parser does (authorBaseHref, below), and:
 *     · none                                  → `<base href="<page>">`, as above;
 *     · one that means the same on the page and at the embed's address (absolute, `//host/…`, `/…`)
 *                                             → nothing is added: the author's base is the first, as it was;
 *     · one relative to the page (`app/`, `../x/`, ``, `?q`, `#x`) → `<base href="<it, resolved against the
 *       page>">`: what the srcdoc resolved it to (the author's own, now second, is the same address);
 *     · one that is not an address at all     → `<base href="<page>">` (a browser ignores it, as in the srcdoc);
 *     · one this module cannot read exactly (a character reference other than the five below and numeric ones)
 *                                             → nothing is added: the author's base, as written, is the first.
 *   NOT counted, as the browser does not count them: `<base` in a comment, in a script, style, textarea,
 *   title or noscript (raw text; scripting is on in the sandbox), in a template, in svg or math, a tag
 *   named `baseline`, `basefont` or `base-x`, and a base with no href (target only).
 */
export const EMBED_DOC_HEAD = '<!doctype html><meta charset="utf-8">';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// the HTML tokenizer's own classes (HTML Living Standard §13.2.5), only as far as finding a base needs
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
// an HTML start tag that ends svg/math content (the tree builder's "in foreign content" breakout list)
const BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small',
  'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var']);
const SPACE = /[\t\n\f\r ]/;

/**
 * readTag: (html, at) → { name, end, attrs: Map, selfClosing, next } for the tag whose `<` is at `at`, or
 * null when the input ends inside it (the tokenizer then emits nothing). Attribute names are lower-cased;
 * a repeated attribute keeps its first value; values are raw (character references not decoded).
 */
function readTag(html, at) {
  const end = html[at + 1] === '/';
  let i = at + (end ? 2 : 1);
  const n = html.length;
  const from = i;
  while (i < n && !SPACE.test(html[i]) && html[i] !== '/' && html[i] !== '>') i += 1;
  const name = html.slice(from, i).toLowerCase();
  const attrs = new Map();
  let selfClosing = false;
  while (i < n) {
    const c = html[i];
    if (SPACE.test(c)) { i += 1; continue; }
    if (c === '>') return { name, end, attrs, selfClosing, next: i + 1 };
    if (c === '/') { i += 1; selfClosing = html[i] === '>'; continue; }
    const a = i;
    i += 1;   // a name may begin with `=`
    while (i < n && !SPACE.test(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i += 1;
    const key = html.slice(a, i).toLowerCase();
    while (i < n && SPACE.test(html[i])) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < n && SPACE.test(html[i])) i += 1;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const v = i;
        while (i < n && !SPACE.test(html[i]) && html[i] !== '>') i += 1;
        value = html.slice(v, i);
      }
    }
    if (!attrs.has(key)) attrs.set(key, value);
    selfClosing = false;
  }
  return null;
}

/**
 * authorBaseHref: (html) → the raw href of the first base element that has one — the one a browser takes as
 * the document's base — or null. A reading of the markup in the tokenizer's terms (comments, bogus comments,
 * raw text, CDATA in svg/math), plus the tree builder's three places where a base is not the document's:
 * a template's content, svg/math content, and — scripting being on — a noscript (raw text, above).
 */
export function authorBaseHref(html) {
  const s = String(html);
  const n = s.length;
  let i = 0;
  let template = 0;
  let foreign = 0;
  // 🔴 EVERY SEARCH BELOW STARTS AT THE CURSOR AND THE CURSOR MOVES PAST WHAT IT READ, or the input ends:
  // the whole reading is one pass over the document (an embed is up to CARD_MAX_BYTES, read on every
  // request). Never search for two endings separately — the one that is not there is looked for to the
  // end of the document, once per comment (tile#372 r4).
  const commentEnd = /--!?>/g;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return null;
    const c = s[lt + 1];
    if (s.startsWith('<!--', lt)) {
      // a comment ends at `-->` or `--!>`; `<!-->` and `<!--->` are empty ones
      if (s.startsWith('<!-->', lt)) { i = lt + 5; continue; }
      if (s.startsWith('<!--->', lt)) { i = lt + 6; continue; }
      commentEnd.lastIndex = lt + 4;
      const m = commentEnd.exec(s);   // the first of `-->` and `--!>`, in one forward scan
      if (!m) return null;
      i = m.index + m[0].length;
      continue;
    }
    if (foreign > 0 && s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      if (e < 0) return null;
      i = e + 3;
      continue;
    }
    if (c === '!' || c === '?' || (c === '/' && !/[A-Za-z>]/.test(s[lt + 2] || ''))) {
      // a doctype, a bogus comment (`<!x>`, `<?x>`, `</ x>`): up to the next `>`
      const e = s.indexOf('>', lt + 2);
      if (e < 0) return null;
      i = e + 1;
      continue;
    }
    if (c === '/' && s[lt + 2] === '>') { i = lt + 3; continue; }
    if (!/[A-Za-z]/.test(c === '/' ? s[lt + 2] || '' : c || '')) { i = lt + 1; continue; }   // `<` as text
    const tag = readTag(s, lt);
    if (!tag) return null;
    i = tag.next;
    const { name } = tag;
    if (tag.end) {
      if (name === 'template' && template > 0) template -= 1;
      else if (foreign > 0 && (name === 'svg' || name === 'math')) foreign -= 1;
      continue;
    }
    if (foreign > 0 && (BREAKOUT.has(name) || (name === 'font' && ['color', 'face', 'size'].some((k) => tag.attrs.has(k))))) foreign = 0;
    if (foreign > 0) {
      if ((name === 'svg' || name === 'math') && !tag.selfClosing) foreign += 1;
      continue;
    }
    if (name === 'svg' || name === 'math') { if (!tag.selfClosing) foreign = 1; continue; }
    if (name === 'template') { template += 1; continue; }
    if (name === 'base' && template === 0 && tag.attrs.has('href')) return tag.attrs.get('href');
    if (name === 'plaintext') return null;
    if (RAW_TEXT.has(name)) {
      // raw text up to `</name` followed by a space, `/` or `>` (any case)
      const re = new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi');
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) return null;
      i = m.index;
    }
  }
  return null;
}

// an attribute value's character references: the five a person writes in an address, and numeric ones that
// name a printable character; anything else is null (not read here, so nothing is decided from it)
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeAttr(v) {
  let unread = false;
  const out = v.replace(/&(?:#[xX]([0-9a-fA-F]{1,6});|#([0-9]{1,7});|(amp|lt|gt|quot|apos);|(?=[A-Za-z0-9#]))/g, (m, hx, dec, name) => {
    if (name) return NAMED[name];
    const cp = hx != null ? parseInt(hx, 16) : dec != null ? Number(dec) : -1;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) { unread = true; return m; }
    return String.fromCodePoint(cp);
  });
  return unread ? null : out;
}

/**
 * embedDocumentBody: (doc, page, at) → what the embed address answers: `doc` with, at most, one
 * `<base href>` after its head (above). `page`: the Cards' address (root-relative); `at`: the address the
 * document is served at (the request's URL), against which an author's base is otherwise resolved.
 */
export function embedDocumentBody(doc, page, at = `https://cards.invalid${page === '/' ? '' : page}/_embed/`) {
  const d = String(doc);
  if (!d.startsWith(EMBED_DOC_HEAD)) throw new Error('an embed document that does not start with the renderer\'s head');
  const with1 = (href) => `${EMBED_DOC_HEAD}<base href="${attr(href)}">${d.slice(EMBED_DOC_HEAD.length)}`;
  const raw = authorBaseHref(d.slice(EMBED_DOC_HEAD.length));
  if (raw == null) return with1(page);
  const href = decodeAttr(raw);
  if (href == null) return d;
  const pageUrl = new URL(page, at);
  let onPage;
  let here;
  try { onPage = new URL(href, pageUrl); here = new URL(href, at); } catch { return with1(page); }
  if (onPage.href === here.href) return d;
  // relative to the page: its path, query and fragment on the page's own origin (a relative address keeps it)
  return with1(onPage.origin === pageUrl.origin ? `${onPage.pathname}${onPage.search}${onPage.hash}` : onPage.href);
}

/**
 * The headers of an embed document, and what each buys:
 *
 *   Content-Security-Policy: sandbox allow-scripts
 *     the document is in an opaque origin wherever it is opened, as a top-level page or framed by any
 *     site: the same one token the frame's own attribute carries, so opening the address directly gives
 *     its script no more than the frame does (no cookie, storage or DOM of the page origin, no top
 *     navigation, popups, forms or dialogs). Nothing else is restricted: an embed loads what it loads today.
 *     🔴 NO frame-ancestors (r2): it is checked against EVERY ancestor, not the frame's parent alone, so
 *     `'self'` refused the embeds of a Cards page that another site frames — and a person's page may be
 *     framed by any site (cardtile-page-csp.mjs sends no frame-ancestors). The embed restricts its
 *     ancestors exactly as its page does: not at all. Another site framing the address directly gets a
 *     sandboxed, opaque-origin document whose HTML is already public in the page it belongs to.
 *   X-Content-Type-Options: nosniff        it is HTML because the Worker says so, never by sniffing
 *   Cross-Origin-Resource-Policy: same-origin   another site cannot load it as a subresource (a frame's
 *                                          navigation is not a subresource load: the policy is not
 *                                          consulted for it unless the framer opts into COEP)
 *   X-Robots-Tag: noindex                 a part of a page, not a page to be found on its own
 *   Cache-Control                          the page's own (60 s), or no-store for a preview
 *
 * No Referrer-Policy: the srcdoc document's requests went out under the page's default policy, and so
 * do these (some players an author embeds refuse to play without a referrer).
 */
export const EMBED_DOCUMENT_POLICY = 'sandbox allow-scripts';
export const embedDocumentHeaders = ({ preview = false } = {}) => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': EMBED_DOCUMENT_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': preview ? 'no-store' : 'public, max-age=60',
  'X-Robots-Tag': preview ? 'noindex, nofollow' : 'noindex',
});

/**
 * embedMissResponse: () → what an embed address answers when the file (that window of it, that preview) has
 * no embed with its hash: the renderer's own empty head and nothing else, 404, under the embed document's
 * headers, never cached (an owner who undoes the edit is answered at once) and never indexed.
 *   · empty, not the "no card" page: this address is only ever asked by an embed's frame, and that page drawn
 *     in the frame's box is a second page inside the first (the review saw it);
 *   · the renderer's head rather than no body: a document with a doctype and a charset, the head every embed
 *     document starts with (no quirks mode, nothing for an engine to guess).
 * It names nothing, so it says nothing about the file: a hash that never was and one edited away answer alike.
 */
export const embedMissResponse = () => new Response(EMBED_DOC_HEAD, { status: 404, headers: embedDocumentHeaders({ preview: true }) });
