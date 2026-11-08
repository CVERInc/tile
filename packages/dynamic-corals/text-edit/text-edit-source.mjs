// text-edit — the SOURCE half: where an edit the coral emitted lands in a page's Markdown, and the
// one rule for writing it back. Pure (string in, string out); the reference every host's applier
// is measured against (text-edit-parity.test.mjs renders real pages and round-trips every
// editable element through here).
//
// The anchor is described in text-edit-core.mjs. Here it is resolved against the source:
//   section  → the n-th `## ` section of the page (the same fence-aware split parseSite does,
//              whose `id` the renderer stamps on the <section>), which must be plain `prose`;
//   kind     → 'title' (the `## ` line), 'p' (a paragraph), 'li' (a list item);
//   before + occurrence → the occurrence-th fragment of that kind whose words equal `before`.
// Only a fragment written as plain words on ONE source line is editable: no inline markup, no
// soft-wrapped paragraph, no item with a continuation line. Everything else is refused with a
// reason, and the host tells the owner to use the editor. The replacement keeps the line's own
// structure (indent, list marker, `## `) and swaps only the words.

import { parseSite, parseParams, splitFrontmatter } from '../../sitetile/site-core.js';

const RE_FENCE = /^\s*(```|~~~)/;
const RE_H2 = /^##(?:\s+(.*))?$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
// Characters that are (or can become) inline markup or HTML in the renderer: emphasis, code,
// links/images, raw HTML, escapes, strikethrough, table cells, brace params.
const RE_MARKUP = /[*_`[\]<>\\~|{}]|https?:\/\/|&[#a-z0-9]+;/i;
// A line that opens some other block than a paragraph.
const RE_BLOCK = /^\s*(#|>|\||<!--|%%|!\[|```|~~~|-{3,}\s*$|={3,}\s*$)/;

export const REASONS = Object.freeze(['malformed', 'unsupported-section', 'not-found', 'not-plain', 'after-not-plain']);

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Every addressable fragment of a page, in source order:
 *  { section, kind, line (0-based, whole file), text, plain } — plus `supported` per section. */
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
    if (sec.title) fragments.push({ section: sec.id, kind: 'title', line: sec.head, text: sec.title, plain: !RE_MARKUP.test(sec.title) });
    let inFence = false, inComment = false, para = null, item = null;
    const endPara = () => {
      if (para) fragments.push({ section: sec.id, kind: 'p', line: para[0], text: clean(para.map((k) => lines[k]).join(' ')),
        plain: para.length === 1 && !RE_MARKUP.test(lines[para[0]]) });
      para = null;
    };
    const endItem = () => { if (item) fragments.push(item); item = null; };
    for (const k of sec.lines) {
      const ln = lines[k];
      if (inComment) { if (ln.includes('-->')) inComment = false; continue; }
      if (RE_FENCE.test(ln)) { endPara(); endItem(); inFence = !inFence; continue; }
      if (inFence) continue;
      if (!ln.trim()) { endPara(); endItem(); continue; }
      if (/^\s*<!--/.test(ln)) { endPara(); endItem(); if (!ln.includes('-->')) inComment = true; continue; }
      const li = RE_LIST.exec(ln);
      if (li) {
        endPara(); endItem();
        item = { section: sec.id, kind: 'li', line: k, text: clean(li[3]), plain: !RE_MARKUP.test(li[3]) && !!clean(li[3]) };
        continue;
      }
      if (item) { item.plain = false; item.text = clean(item.text + ' ' + ln); continue; } // continuation line
      if (!para && RE_BLOCK.test(ln)) continue;  // heading, quote, table, type line, image block…
      (para || (para = [])).push(k);
    }
    endPara(); endItem();
  });
  return { fragments, sections };
}

/** Is `after` something the coral may write as plain words? */
export function plainAfter(after) {
  const t = clean(after);
  return !!t && t.length <= 4000 && !RE_MARKUP.test(t) && !RE_BLOCK.test(t) && !RE_LIST.test(t);
}

/**
 * Apply one text-only edit. `edit` = { anchor: { section, kind, occurrence }, before, after }.
 * → { ok: true, markdown, line } | { ok: false, reason } (reason ∈ REASONS)
 */
export function applyTextEdit(markdown, edit) {
  const a = edit && edit.anchor;
  if (!a || typeof a.section !== 'string' || !['title', 'p', 'li'].includes(a.kind)
    || !Number.isInteger(a.occurrence) || a.occurrence < 0
    || typeof edit.before !== 'string' || typeof edit.after !== 'string') return { ok: false, reason: 'malformed' };
  const before = clean(edit.before), after = clean(edit.after);
  const { fragments, sections } = textFragments(markdown);
  const sec = sections.find((s) => s.id === a.section);
  if (!sec) return { ok: false, reason: 'not-found' };
  if (!sec.supported) return { ok: false, reason: 'unsupported-section' };
  const same = fragments.filter((f) => f.section === a.section && f.kind === a.kind && f.text === before);
  const hit = same[a.occurrence];
  if (!hit) return { ok: false, reason: 'not-found' };
  if (!hit.plain) return { ok: false, reason: 'not-plain' };
  if (!plainAfter(after)) return { ok: false, reason: 'after-not-plain' };
  const lines = String(markdown).split('\n');
  const ln = lines[hit.line];
  if (a.kind === 'title') lines[hit.line] = '## ' + after;
  else if (a.kind === 'li') { const m = RE_LIST.exec(ln); lines[hit.line] = m[1] + m[2] + ' ' + after; }
  else lines[hit.line] = /^\s*/.exec(ln)[0] + after;
  return { ok: true, markdown: lines.join('\n'), line: hit.line };
}
