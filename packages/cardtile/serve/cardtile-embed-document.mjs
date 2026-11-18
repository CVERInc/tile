// An `embed` tile as a document of its own: what keeps the page's policy on every page.
//
// An embed is the author's own HTML and script, in `<iframe sandbox="allow-scripts">` (an opaque
// origin: no storage, cookie or DOM of the page). Written as `srcdoc`, the frame's document INHERITS
// the parent's Content-Security-Policy, and the parent's script-src (cardtile-page-csp.mjs) refuses the
// author's script. So while the page's policy is on (CARDS_PAGE_CSP "report-only" or "enforce"), every
// embed frame of a page is written with `src` instead: a same-origin address that answers with the
// document the srcdoc held plus one `<base href>` (embedDocumentBody, below), under a policy of its own.
// The page's policy is then the same on every page, whatever the page holds, and nothing a person
// writes decides whether it is sent.
//
// With the setting off none of this runs: the frame stays srcdoc and the address is an unknown path.
//
//   ADDRESS   <base>_embed/<sha256 of the document, 64 hex>[?w=<n>]
//             base is where the page's own pictures live (`/<handle>/`, `/` on a person's own domain,
//             `/_preview/<id>/` for a preview); `?w=<n>` names the window of a file served in windows.
//   WHICH     The address names a document; the Worker answers it only when the stored file (that window
//             of it) has an `embed` tile whose document has that hash. The documents are made from the
//             parsed file — tiles whose type is `embed`, front and backs — by the renderer's own function,
//             never read out of the rendered page: an address cannot be made to answer with another
//             person's embed (their file is not read) or with any HTML that is not an embed of this file.
//   BODY      that document with one `<base href>` naming the page's address: embedDocumentBody, below.
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
 * 🔴 WHERE ITS RELATIVE ADDRESSES POINT (tile#372 r2). A srcdoc document's base is its parent's: an
 * author's `<img src="aster/favicon.ico">` on `/aster` meant `/aster/favicon.ico`. Served at
 * `/aster/_embed/<hash>` with nothing added, the same markup would mean `/aster/_embed/aster/favicon.ico`.
 * So the served document is the srcdoc's document with exactly ONE element added: `<base href="<page>">`,
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
 *   🔴 The one known difference: an author's OWN `<base href>` is now the second one in the document,
 *           and the first one wins, so it is ignored (in the srcdoc it was the first, and was honoured).
 *           Telling a real one from the text `<base href` in a comment or a script means parsing the
 *           author's HTML, which this module does not do.
 */
export const EMBED_DOC_HEAD = '<!doctype html><meta charset="utf-8">';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** embedDocumentBody: (doc, page) → what the embed address answers: `doc` with `<base href="<page>">` after its head */
export function embedDocumentBody(doc, page) {
  const d = String(doc);
  if (!d.startsWith(EMBED_DOC_HEAD)) throw new Error('an embed document that does not start with the renderer\'s head');
  return `${EMBED_DOC_HEAD}<base href="${attr(page)}">${d.slice(EMBED_DOC_HEAD.length)}`;
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
