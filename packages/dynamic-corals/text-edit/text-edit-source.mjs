// text-edit — the SOURCE half: where an edit the coral emitted lands in a page's Markdown, and the
// one rule for writing it back. Pure (string in, string out); the reference every host's applier
// is measured against (text-edit-parity.test.mjs renders real pages and round-trips every
// editable element through here; text-edit-review.test.mjs holds the cases that once misfired).
//
// The anchor is described in text-edit-core.mjs. Here it is resolved against the source:
//   revision → sourceRevision() of the Markdown the frame was rendered from (or of what the last
//              acknowledged edit produced). Any other revision is refused as `changed`: a stale
//              preview's occurrence count means nothing once somebody else has renumbered it;
//   section  → the n-th `## ` section of the page (the same fence-aware split parseSite does,
//              whose `id` the renderer stamps on the <section>), which must be plain `prose`;
//   kind     → 'title' (the `## ` line), 'p' (a paragraph), 'li' (a list item);
//   before + occurrence → the occurrence-th fragment of that kind whose RENDERED words equal
//              `before`.
// 🔴 The population the occurrence counts in is the renderer's, not the source's: every source
// block is rendered on its own with sitetile's renderer, and every element the coral would address
// in that render (core's own kindOf) is one fragment with the words it shows. A comment that
// vanishes, a soft-wrapped CJK line that joins without a space: those fragments stay in the
// population, with the words the owner sees, and are refused as not plain. And because a block
// rendered alone can still differ from the page rendered whole, the applier renders the whole page
// too and counts the coral's elements with those words: when the two counts differ, the edit is
// refused as `ambiguous` instead of landing on whichever line the source walk happened to find.
// Only a fragment written as plain words on ONE source line, whose rendered words are exactly its
// source words, is editable: no inline markup, no soft-wrapped paragraph, no item with a
// continuation line. Everything else is refused with a reason, and the host tells the owner to use
// the editor. The replacement keeps the line's own structure (indent, list marker, `## `) and swaps
// only the words. A successful edit returns the new revision and the section's id after the edit
// (a title edit changes it), which the host hands back to the coral in its answer.

import { parseSite, parseParams, splitFrontmatter, renderSiteToHtml, bodyHtml, inlineHtml } from '../../sitetile/site-core.js';
import { kindOf, cleanText } from './text-edit-core.mjs';

const RE_FENCE = /^\s*(```|~~~)/;
const RE_H2 = /^##(?:\s+(.*))?$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
// Characters that are (or can become) inline markup or HTML in the renderer: emphasis, code,
// links/images, raw HTML, escapes, strikethrough, table cells, brace params.
const RE_MARKUP = /[*_`[\]<>\\~|{}]|https?:\/\/|&[#a-z0-9]+;/i;
// A line that opens some other block than a paragraph.
const RE_BLOCK = /^\s*(#|>|\||<!--|%%|!\[|```|~~~|-{3,}\s*$|={3,}\s*$)/;

export const REASONS = Object.freeze(['malformed', 'changed', 'unsupported-section', 'not-found', 'ambiguous', 'not-plain', 'after-not-plain']);

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
// not open an element.
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
  for (const m of String(html).matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/gi)) {
    if (m[1] || m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { cur.nodes.push(decode(m[5])); continue; }
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

/** How many elements the coral addresses in that section of the WHOLE rendered page, of that kind,
 *  showing exactly those words. */
function renderedCount(markdown, sectionId, kind, words) {
  const root = htmlTree(renderSiteToHtml(parseSite(markdown)));
  let sec = null;
  for (const el of root.all()) if (el.tagName === 'SECTION' && el.id === sectionId) { sec = el; break; }
  if (!sec) return -1;
  let n = 0;
  for (const el of sec.all()) if (kindOf(el, sec) === kind && cleanText(el.textContent) === words) n++;
  return n;
}

/** Every addressable fragment of a page, in source order:
 *  { section, kind, line (0-based, whole file), text (the words the renderer shows), plain }
 *  — plus `supported` per section. */
export function textFragments(markdown) {
  const text = String(markdown == null ? '' : markdown);
  const { body } = splitFrontmatter(text);
  if (!text.endsWith(body)) return { fragments: [], sections: [] };
  const lines = text.split('\n');
  const first = lines.length - body.split('\n').length;
  const parsed = parseSite(text).sections;

  const sections = [];
  let cur = null, fence = false;
  for (let i = first; i < lines.length; i++) {
    if (RE_FENCE.test(lines[i])) { fence = !fence; if (cur) cur.lines.push(i); continue; }
    const h2 = !fence && RE_H2.exec(lines[i]);
    if (h2) { cur = { head: i, title: (h2[1] || '').trim(), lines: [] }; sections.push(cur); continue; }
    if (cur) cur.lines.push(i);
  }

  const fragments = [];
  sections.forEach((sec, si) => {
    const p = parsed[si];
    sec.id = p ? p.id : null;
    sec.supported = !!p && p.type === 'prose' && !parseParams(p.params || '').ordered;
    if (!sec.id) return;
    if (sec.title) {
      const shown = cleanText(htmlTree(inlineHtml(p.title)).textContent);
      fragments.push({ section: sec.id, kind: 'title', line: sec.head, text: shown, plain: !RE_MARKUP.test(sec.title) && shown === clean(sec.title) && !!shown });
    }
    // Source blocks first ('p' = paragraph lines, 'li' = an item and its continuation lines,
    // 'h' = a `#` heading line, which renders as an element the coral counts as a title)…
    const blocks = [];
    let inFence = false, inComment = false, block = null;
    const end = () => { if (block) blocks.push(block); block = null; };
    for (const k of sec.lines) {
      const ln = lines[k];
      if (inComment) { if (ln.includes('-->')) inComment = false; continue; }
      if (RE_FENCE.test(ln)) { end(); inFence = !inFence; continue; }
      if (inFence) continue;
      if (!ln.trim()) { end(); continue; }
      if (/^\s*<!--/.test(ln)) { end(); if (!ln.includes('-->')) inComment = true; continue; }
      if (RE_LIST.test(ln)) { end(); block = { kind: 'li', lines: [k] }; continue; }
      if (block && block.kind === 'li') { block.lines.push(k); continue; } // continuation line
      if (!block && /^\s*#/.test(ln)) { blocks.push({ kind: 'h', lines: [k] }); continue; }
      if (!block && RE_BLOCK.test(ln)) continue;  // quote, table, type line, image block…
      (block || (block = { kind: 'p', lines: [] })).lines.push(k);
    }
    end();
    // …then each block rendered on its own: every element the coral would address in it is a
    // fragment, with the words it shows. Plain only when the block is one source line rendering as
    // exactly one element of its own kind, with no element inside, showing its source words as written.
    for (const b of blocks) {
      const found = renderBlock(b.lines.map((k) => lines[k]).join('\n'));
      const raw = b.kind === 'li' ? RE_LIST.exec(lines[b.lines[0]])[3] : lines[b.lines[0]];
      const single = b.kind !== 'h' && b.lines.length === 1 && found.length === 1 && found[0].kind === b.kind;
      for (const { el, kind } of found) {
        const shown = cleanText(el.textContent);
        fragments.push({ section: sec.id, kind, line: b.lines[0], text: shown,
          plain: single && el.children.length === 0 && !RE_MARKUP.test(raw) && shown === clean(raw) && !!shown });
      }
    }
  });
  return { fragments, sections };
}

/** Is `after` something the coral may write as plain words? Plain by the source rule, and shown by
 *  the renderer exactly as written (no placeholder, entity or markup it would turn into something else). */
export function plainAfter(after) {
  const t = clean(after);
  if (!t || t.length > 4000 || RE_MARKUP.test(t) || RE_BLOCK.test(t) || RE_LIST.test(t)) return false;
  const found = renderBlock(t);
  return found.length === 1 && found[0].kind === 'p' && found[0].el.children.length === 0 && cleanText(found[0].el.textContent) === t;
}

/**
 * Apply one text-only edit. `edit` = { anchor: { section, kind, occurrence }, before, after, revision }.
 * → { ok: true, markdown, line, revision, section } | { ok: false, reason } (reason ∈ REASONS)
 *   revision — sourceRevision of the new Markdown: the coral's next edit is made against it;
 *   section  — the edited section's id in the new Markdown (a title edit changes it).
 */
export function applyTextEdit(markdown, edit) {
  const a = edit && edit.anchor;
  if (!a || typeof a.section !== 'string' || !['title', 'p', 'li'].includes(a.kind)
    || !Number.isInteger(a.occurrence) || a.occurrence < 0
    || typeof edit.before !== 'string' || typeof edit.after !== 'string'
    || typeof edit.revision !== 'string') return { ok: false, reason: 'malformed' };
  if (edit.revision !== sourceRevision(markdown)) return { ok: false, reason: 'changed' };
  const before = clean(edit.before), after = clean(edit.after);
  const { fragments, sections } = textFragments(markdown);
  const sec = sections.find((s) => s.id === a.section);
  if (!sec) return { ok: false, reason: 'not-found' };
  if (!sec.supported) return { ok: false, reason: 'unsupported-section' };
  const same = fragments.filter((f) => f.section === a.section && f.kind === a.kind && f.text === before);
  if (renderedCount(markdown, a.section, a.kind, before) !== same.length) return { ok: false, reason: 'ambiguous' };
  const hit = same[a.occurrence];
  if (!hit) return { ok: false, reason: 'not-found' };
  if (!hit.plain) return { ok: false, reason: 'not-plain' };
  if (!plainAfter(after)) return { ok: false, reason: 'after-not-plain' };
  const lines = String(markdown).split('\n');
  const ln = lines[hit.line];
  if (a.kind === 'title') lines[hit.line] = '## ' + after;
  else if (a.kind === 'li') { const m = RE_LIST.exec(ln); lines[hit.line] = m[1] + m[2] + ' ' + after; }
  else lines[hit.line] = /^\s*/.exec(ln)[0] + after;
  const next = lines.join('\n');
  const moved = parseSite(next).sections[sections.indexOf(sec)];
  return { ok: true, markdown: next, line: hit.line, revision: sourceRevision(next), section: moved ? moved.id : a.section };
}
