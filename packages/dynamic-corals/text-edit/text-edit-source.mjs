// text-edit — the SOURCE half: where an edit the coral emitted lands in a page's Markdown, and the
// one rule for writing it back. Pure (string in, string out); the reference every host's applier
// is measured against (text-edit-parity.test.mjs renders real pages and round-trips every
// editable element through here; text-edit-review.test.mjs holds the cases that once misfired).
//
// 🔴 The anchor is a SOURCE SPAN THE RENDERER EMITTED, never a re-derivation of the renderer's
// block structure. In an editing preview the page is parsed with `parseSite(md, { sourceLines:
// true })`, and sitetile stamps every paragraph, list item (its own line) and heading it draws from
// a prose body with `data-src="<first>-<last>"` (0-based, inclusive lines of the page Markdown).
// The coral sends that span. Two earlier rounds instead looked for "the n-th fragment showing these
// words" by walking the source a second time and counting, and every walk disagreed with the
// renderer somewhere (nested lists, comment tails, fences inside fences). There is no counting here.
//
// An edit { anchor: { section, start, end }, before, after, revision } is applied when:
//   revision → equals sourceRevision() of the Markdown (else `changed`): the span was taken from a
//              render of exactly this source, or of what the coral's own acknowledged edits made it;
//   section  → is a plain `prose` section of the page (else `not-found` / `unsupported-section`);
//   span     → the page, rendered again the same way, has exactly one element the coral addresses
//              stamped with that span in that section (else `not-found`), and it shows `before`
//              (else `changed`);
//   plain    → the span is ONE source line whose words, after its own marker (indent, list marker,
//              `#`s), are plain and are exactly what the element shows, and the element holds no
//              other element (else `not-plain`);
//   after    → is plain words the renderer shows as written, with no character the HTML parser
//              drops or rewrites (else `after-not-plain`).
// Only that line's words change; its marker stays. A success returns the new revision and the
// section's id after the edit (a title edit changes it), which the host hands back to the coral.

import { parseSite, parseParams, renderSiteToHtml, bodyHtml } from '../../sitetile/site-core.js';
import { kindOf, cleanText, unsafeText } from './text-edit-core.mjs';

// One source line's own marker and its words: a list item, an ATX heading, or a paragraph line.
const RE_LIST_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const RE_HEADING_LINE = /^(\s*#{1,6}[ \t]+)(.*)$/;
const RE_PARA_LINE = /^(\s*)(.*)$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
// Characters that are (or can become) inline markup or HTML in the renderer: emphasis, code,
// links/images, raw HTML, escapes, strikethrough, table cells, brace params.
const RE_MARKUP = /[*_`[\]<>\\~|{}]|https?:\/\/|&[#a-z0-9]+;/i;
// A line that opens some other block than a paragraph.
const RE_BLOCK = /^\s*(#|>|\||<!--|%%|!\[|```|~~~|-{3,}\s*$|={3,}\s*$)/;

export const REASONS = Object.freeze(['malformed', 'changed', 'unsupported-section', 'not-found', 'not-plain', 'after-not-plain']);

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** The page's source revision: what the frame was rendered from travels with every edit, and an
 *  edit made against any other revision is refused. A content hash (64 bits, cyrb53-style, plus the
 *  length), so any host can compute it from the Markdown alone — at build, to stamp the frame's
 *  `data-revision`, and here, before every edit. */
export function sourceRevision(markdown) {
  const s = String(markdown == null ? '' : markdown);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return 'r' + s.length.toString(36) + '-' + hex(h2) + hex(h1);
}

// ── The renderer's output as elements ────────────────────────────────────────────────────────────
// sitetile's HTML is well-formed and escapes text (&amp; &lt; &gt;) and attribute values (&quot;
// too), so a tag tokenizer is enough to give core's kindOf the same tree a browser would build.
// Script/style bodies and comments are skipped whole: they are not text, and a `<` inside one must
// not open an element. Text follows the HTML parser on the characters it changes: input CR and
// CRLF become LF (input stream preprocessing), and U+0000 in body text is dropped (the "in body"
// insertion mode ignores it) — so a word with NUL in it reads here as it reads in the frame.
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export class El {
  constructor(tag, attrs, parent) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent; this.nodes = [];
    this.classList = { contains: (c) => (attrs.class || '').split(/\s+/).includes(c) };
  }
  get id() { return this.attrs.id || ''; }
  get children() { return this.nodes.filter((n) => n instanceof El); }
  hasAttribute(n) { return n in this.attrs; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  get textContent() { return this.nodes.map((n) => (n instanceof El ? n.textContent : n)).join(''); }
  set textContent(v) { this.nodes = [String(v)]; }
  *all() { for (const c of this.children) { yield c; yield* c.all(); } }
}
export function htmlTree(html, Make = El) {
  const root = new Make('body', {}, null);
  let cur = root;
  for (const m of String(html).replace(/\r\n?/g, '\n').matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/gi)) {
    if (m[1] || m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { cur.nodes.push(decode(m[5].replace(/\u0000/g, ''))); continue; }
    const tag = m[3].toLowerCase();
    if (m[2]) { while (cur !== root && cur.tagName !== tag.toUpperCase()) cur = cur.parentElement; if (cur !== root) cur = cur.parentElement; continue; }
    const attrs = {};
    for (const a of m[4].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
    const el = new Make(tag, attrs, cur);
    cur.nodes.push(el);
    if (!VOID.has(tag) && !m[4].endsWith('/')) cur = el;
  }
  return root;
}

/** The elements the coral would address in `html` rendered as a prose section's body, in order. */
function addressed(html) {
  const sec = htmlTree('<section class="st-prose" id="x">' + html + '</section>').children[0];
  const out = [];
  for (const el of sec.all()) { const kind = kindOf(el, sec); if (kind) out.push({ el, kind }); }
  return out;
}
const renderBlock = (src) => addressed(bodyHtml(src, { linkRows: 'st-prose' }));

/** Is `after` something the coral may write as plain words? No character the HTML parser drops or
 *  rewrites (core's unsafeText), plain by the source rule, and shown by the renderer exactly as
 *  written (no placeholder, entity or markup it would turn into something else). */
export function plainAfter(after) {
  if (typeof after !== 'string' || unsafeText(after)) return false;
  const t = clean(after);
  if (!t || t.length > 4000 || RE_MARKUP.test(t) || RE_BLOCK.test(t) || RE_LIST.test(t)) return false;
  const found = renderBlock(t);
  return found.length === 1 && found[0].kind === 'p' && found[0].el.children.length === 0 && cleanText(found[0].el.textContent) === t;
}

/**
 * Apply one text-only edit. `edit` = { anchor: { section, start, end }, before, after, revision }.
 * → { ok: true, markdown, line, revision, section } | { ok: false, reason } (reason ∈ REASONS)
 *   revision — sourceRevision of the new Markdown: the coral's next edit is made against it;
 *   section  — the edited section's id in the new Markdown (a title edit changes it).
 */
export function applyTextEdit(markdown, edit) {
  const a = edit && edit.anchor;
  if (!a || typeof a.section !== 'string' || !Number.isInteger(a.start) || !Number.isInteger(a.end)
    || a.start < 0 || a.end < a.start
    || typeof edit.before !== 'string' || typeof edit.after !== 'string'
    || typeof edit.revision !== 'string') return { ok: false, reason: 'malformed' };
  const md = String(markdown == null ? '' : markdown);
  if (edit.revision !== sourceRevision(md)) return { ok: false, reason: 'changed' };
  const site = parseSite(md, { sourceLines: true });
  const si = site.sections.findIndex((s) => s.id === a.section);
  if (si < 0) return { ok: false, reason: 'not-found' };
  const sec = site.sections[si];
  if (sec.type !== 'prose' || parseParams(sec.params || '').ordered) return { ok: false, reason: 'unsupported-section' };
  // The element the frame showed for that span: the same render, read back.
  let secEl = null;
  for (const el of htmlTree(renderSiteToHtml(site)).all()) if (el.tagName === 'SECTION' && el.id === a.section) { secEl = el; break; }
  const span = a.start + '-' + a.end;
  const hits = secEl ? [...secEl.all()].filter((el) => el.getAttribute('data-src') === span && kindOf(el, secEl)) : [];
  if (hits.length !== 1) return { ok: false, reason: 'not-found' };
  const el = hits[0];
  const before = clean(edit.before);
  if (cleanText(el.textContent) !== before) return { ok: false, reason: 'changed' };
  if (a.start !== a.end || el.children.length) return { ok: false, reason: 'not-plain' };
  const lines = md.split('\n');
  const shape = el.tagName === 'LI' ? RE_LIST_LINE : /^H[1-6]$/.test(el.tagName) ? RE_HEADING_LINE : RE_PARA_LINE;
  const m = shape.exec(lines[a.start]);
  if (!m || RE_MARKUP.test(m[2]) || unsafeText(m[2]) || clean(m[2]) !== before) return { ok: false, reason: 'not-plain' };
  if (!plainAfter(edit.after)) return { ok: false, reason: 'after-not-plain' };
  lines[a.start] = m[1] + clean(edit.after);
  const next = lines.join('\n');
  const moved = parseSite(next).sections[si];
  return { ok: true, markdown: next, line: a.start, revision: sourceRevision(next), section: moved ? moved.id : a.section };
}
