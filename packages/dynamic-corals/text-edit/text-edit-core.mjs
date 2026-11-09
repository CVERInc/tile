// text-edit — "only change the words" inside a rendered sitetile page. The node-tested core; the
// distributable `text-edit.js` is BUILT from text-edit-client.mjs (`node ../build.mjs text-edit`).
//
// The owner taps a heading, paragraph or list item in a preview and types. They never see HTML or
// Markdown: the coral edits the words of ONE element whose text is plain (no bold, no link, no code
// inside it) and hands the host a text-only edit. Anything structural — splitting a paragraph,
// changing a link, adding a block — belongs to the host's own editor, and the coral says so.
//
// ── The anchor (the contract with whoever applies the edit) ─────────────────────────────────────
// The renderer already stamps every section with a stable id computed from the source
// (`s<n>-<slug>`, parseSite; pinned by sitetile/section-anchor.test.mjs). Inside a section the
// coral names an element by:
//   { section: '<section id>', kind: 'title' | 'p' | 'li', occurrence: k, before: '<its text>' }
// `occurrence` counts only elements of the same kind in that section whose text is EXACTLY
// `before`, in document order — so the applier looks for the k-th fragment of that kind whose
// RENDERED words equal `before` (text-edit-source.mjs renders the source to count). A layout detail
// of the renderer (an eyebrow, a button row, a figure) can therefore never shift which source line
// an edit lands on: if the words are not there, or the two counts disagree, the edit is refused,
// never written somewhere else.
//
// Freshness is the REVISION, not `before`: duplicates renumber when somebody else edits one of
// them, and the words alone cannot tell. The host stamps the frame with `data-revision` (the
// source revision it was rendered from); every edit carries the revision it was computed against,
// and the applier refuses any other one. A success answers with the new revision (and the section's
// new id — a title edit changes it), which the next edit is made against.
//
// Edits go ONE AT A TIME. The owner can keep typing, but the next edit is only computed and sent
// once the previous one is answered, and always against acknowledged words: a pending edit shows in
// the preview, yet never counts as an occurrence, and a refusal only puts the old words back when
// nothing newer was typed over them.
//
// The edit the host receives (postMessage to the parent window, at the configured origin only):
//   { type: 'reef-text-edit', id, page, revision, anchor: { section, kind, occurrence }, before, after }
// and the answer the coral listens for (from that origin AND from the parent window itself):
//   { type: 'reef-text-edit-result', id, ok, hint?, revision?, section? }
// A refused edit puts the old words back and shows the host's hint (or the coral's own default).
// A success without a revision ends editing in this frame: nothing after it could prove freshness.

export const EDIT_MESSAGE = 'reef-text-edit';
export const RESULT_MESSAGE = 'reef-text-edit-result';
export const DEFAULT_HINT = 'This text has formatting or structure. Change it in the editor.';
export const DEFAULT_REFUSED = 'That change could not be saved here. Open the editor to change it.';

// Sections the coral takes text from. Only `prose` in this slice: every other section type renders
// its words through a component (a hero, a grid cell, a form label), and those stay untouchable —
// no cursor, no hover, no explanation — until a component field can be mapped back to its source.
const SECTION_CLASS = 'st-prose';
// Inside a prose section, text that is not a body paragraph/item of its own source line.
const SKIP_TAGS = new Set(['BLOCKQUOTE', 'FIGURE', 'TABLE', 'PRE', 'NAV', 'FORM', 'DETAILS']);
const SKIP_CLASSES = ['st-prose-eyebrow', 'st-prose-btns', 'st-dialogue'];

const hasClass = (el, c) => !!(el && el.classList && el.classList.contains(c));

/** The prose section an element sits in, or null. Ordered prose (`data-ordered`, clause headings
 *  built from `###`) is a component layout and is not offered. */
export function sectionOf(el) {
  for (let n = el; n; n = n.parentElement) {
    if (n.tagName === 'SECTION') {
      if (!hasClass(n, SECTION_CLASS) || !n.id) return null;
      if (n.hasAttribute('data-ordered')) return null;
      return n;
    }
  }
  return null;
}

/** 'title' | 'p' | 'li' for an element the coral can address, or null. */
export function kindOf(el, section) {
  if (!el || !section) return null;
  for (let n = el; n && n !== section; n = n.parentElement) {
    if (SKIP_TAGS.has(n.tagName)) return null;
    if (SKIP_CLASSES.some((c) => hasClass(n, c))) return null;
  }
  if ((el.tagName === 'H1' || el.tagName === 'H2') && el.parentElement === section) return 'title';
  if (el.tagName === 'P') return 'p';
  if (el.tagName === 'LI') return 'li';
  return null;
}

/** Plain = no element inside it. A bold word, a link, an inline image or code makes the element a
 *  structural one, which the coral does not edit. */
export const isPlain = (el) => !el.children || el.children.length === 0;

/** The words as the owner sees them, on one line. */
export const cleanText = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function* descendants(node) {
  for (const child of Array.from(node.children || [])) {
    yield child;
    yield* descendants(child);
  }
}

/** The nearest addressable element at or above `target`, with its section and kind. */
export function editableAt(target) {
  for (let n = target; n; n = n.parentElement) {
    if (n.tagName === 'A' || n.tagName === 'BUTTON' || n.tagName === 'INPUT') return null; // links work as links
    if (n.tagName === 'SECTION' || n.tagName === 'BODY') return null;
    const section = sectionOf(n);
    const kind = section && kindOf(n, section);
    if (kind) return { el: n, section, kind, plain: isPlain(n) };
  }
  return null;
}

/** The anchor for an element. `before` defaults to the element's current words; `textOf` gives
 *  every element's words for counting (the editor passes acknowledged words, never pending ones). */
export function anchorFor(el, section, kind, before = cleanText(el.textContent), textOf = (n) => cleanText(n.textContent)) {
  let occurrence = 0;
  for (const other of descendants(section)) {
    if (other === el) return { section: section.id, kind, occurrence, before };
    if (kindOf(other, section) === kind && textOf(other) === before) occurrence++;
  }
  return null;
}

/**
 * The editing session. DOM-free apart from the elements it is handed, so node can drive it:
 *   page           — the page path the host saves to
 *   revision       — the source revision the frame was rendered from (data-revision)
 *   post(message)  — send an edit to the host
 *   hint(text, el) — show a short hint next to an element
 */
export function createEditor({ page, revision, post, hint, words = {} }) {
  let active = null;            // the element being typed into
  let seq = 0;
  let rev = typeof revision === 'string' && revision ? revision : null;
  const known = new Map();      // element → { section, kind, ack (saved words), want (latest words) }
  const queue = [];             // elements whose latest words are not acknowledged yet, oldest first
  let inflight = null;          // { id, el, after } — the one edit the host has not answered
  const sectionIds = new Map(); // section element → its id in the source since a title edit
  const ackText = (n) => (known.has(n) ? known.get(n).ack : cleanText(n.textContent));
  const refusedHint = (text) => (typeof text === 'string' && text ? text : (words.refused || DEFAULT_REFUSED));

  function begin(found) {
    if (!found) return false;
    if (!found.plain) { hint(words.useEditor || DEFAULT_HINT, found.el); return false; }
    if (active === found.el) return true;
    if (active) commit();
    if (!anchorFor(found.el, found.section, found.kind)) return false;
    if (!known.has(found.el)) {
      const now = cleanText(found.el.textContent);
      known.set(found.el, { section: found.section, kind: found.kind, ack: now, want: now });
    }
    active = found.el;
    return true;
  }

  function cancel() {
    if (!active) return;
    active.textContent = known.get(active).want;
    active = null;
  }

  // A refused edit: its words go back, unless the owner has typed newer ones since.
  function refuse(el, k, sentAfter, text) {
    if (k.want === sentAfter) {
      k.want = k.ack;
      if (active !== el) el.textContent = k.ack;
    }
    hint(refusedHint(text), el);
  }

  // Send the next unacknowledged edit, computed against acknowledged words. Returns what it posted.
  function pump() {
    while (!inflight && queue.length) {
      const el = queue.shift();
      const k = known.get(el);
      if (k.want === k.ack) continue;
      const anchor = rev && anchorFor(el, k.section, k.kind, k.ack, ackText);
      if (!anchor) { refuse(el, k, k.want, null); continue; }
      const id = 'e' + (++seq);
      const message = {
        type: EDIT_MESSAGE, id, page, revision: rev,
        anchor: { section: sectionIds.get(k.section) || anchor.section, kind: k.kind, occurrence: anchor.occurrence },
        before: k.ack, after: k.want,
      };
      inflight = { id, el, after: k.want };
      try { post(message); } catch { inflight = null; refuse(el, k, message.after, null); continue; }
      return message;
    }
    return null;
  }

  /** Ends the session. Returns the message posted now, or null (nothing changed, or it waits its turn). */
  function commit() {
    if (!active) return null;
    const el = active;
    active = null;
    const k = known.get(el);
    const after = cleanText(el.textContent);
    if (after === k.want) { el.textContent = after; return null; }
    if (!after) { el.textContent = k.want; hint(words.useEditor || DEFAULT_HINT, el); return null; }
    el.textContent = after;
    k.want = after;
    if (!queue.includes(el)) queue.push(el);
    return pump();
  }

  /** The host's answer to the edit in flight; anything else is nobody's answer. */
  function onResult(msg) {
    if (!msg || msg.type !== RESULT_MESSAGE || !inflight || msg.id !== inflight.id) return false;
    const { el, after } = inflight;
    inflight = null;
    const k = known.get(el);
    if (msg.ok === true) {
      k.ack = after;
      rev = typeof msg.revision === 'string' && msg.revision ? msg.revision : null;
      if (typeof msg.section === 'string' && msg.section) sectionIds.set(k.section, msg.section);
    } else refuse(el, k, after, msg.hint);
    pump();
    return true;
  }

  return { begin, commit, cancel, onResult, get active() { return active ? { el: active } : null; } };
}

// ── Mounting (the browser half; text-edit-client.mjs calls this) ─────────────────────────────────

const STYLE_ID = 'dc-text-edit-style';
const CSS = '.st-prose[id] :is(h1,h2,p,li).dc-text-edit-ok{cursor:text}'
  + '.st-prose[id] :is(h1,h2,p,li).dc-text-edit-ok:hover{outline:1px dashed currentColor;outline-offset:2px}'
  + '.dc-text-edit-on{outline:2px solid currentColor;outline-offset:2px}'
  + '.dc-text-edit-hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:90vw;'
  + 'padding:8px 12px;border-radius:8px;background:#222;color:#fff;font:14px/1.4 system-ui,sans-serif;z-index:2147483647}';

/** The configured parent origin, normalized, or null. One explicit http(s) origin, written as the
 *  origin itself (a trailing `/` is allowed and dropped). `*`, `null`, a path, a query, credentials,
 *  upper case or a default port are refused: a wildcard would hand page text to whoever framed the
 *  page, and no real reply ever carries a spelling other than the canonical one. */
export function parentOriginOf(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return value === url.origin || value === url.origin + '/' ? url.origin : null;
}

/**
 * Mount on a document. Config from the container's data-* attributes:
 *   data-parent-origin  REQUIRED — the only origin edits are posted to and answers accepted from.
 *                       No default: an editor that posts page text to an origin nobody chose is
 *                       the failure this refuses. See parentOriginOf for what counts.
 *   data-revision       REQUIRED — the source revision the page was rendered from
 *                       (text-edit-source.mjs sourceRevision); without it no edit can prove it is fresh.
 *   data-page           the page path the host saves to (default: location.pathname)
 *   data-hint-editor    the "change it in the editor" sentence, in the host's language
 *   data-hint-refused   the sentence for a refused edit, when the host's answer carries none
 * Only runs inside a frame: the coral is an editing aid for a host that embeds the page.
 */
export function mountAll(doc) {
  const win = doc.defaultView;
  if (!win || win.top === win) return null;
  const box = doc.querySelector('[data-dynamic-coral="text-edit"]');
  if (!box || box.__dcTextEdit) return null;
  const parentOrigin = parentOriginOf(box.getAttribute('data-parent-origin'));
  const revision = box.getAttribute('data-revision');
  if (!parentOrigin || !revision) return null;
  box.__dcTextEdit = true;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID; style.textContent = CSS;
    doc.head.appendChild(style);
  }
  let toast = null, toastTimer = 0;
  const hint = (text) => {
    if (!toast) { toast = doc.createElement('div'); toast.className = 'dc-text-edit-hint'; toast.setAttribute('role', 'status'); doc.body.appendChild(toast); }
    toast.textContent = text; toast.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { toast.hidden = true; }, 4000);
  };
  const editor = createEditor({
    page: box.getAttribute('data-page') || win.location.pathname,
    revision,
    post: (m) => win.parent.postMessage(m, parentOrigin),
    hint,
    words: { useEditor: box.getAttribute('data-hint-editor') || '', refused: box.getAttribute('data-hint-refused') || '' },
  });

  // Mark what is editable, so hover shows it and nothing else changes cursor.
  for (const s of doc.querySelectorAll('section.st-prose[id]')) {
    for (const el of s.querySelectorAll('h1,h2,p,li')) {
      const found = editableAt(el);
      if (found && found.el === el && found.plain) el.classList.add('dc-text-edit-ok');
    }
  }

  const stop = (el) => { el.removeAttribute('contenteditable'); el.classList.remove('dc-text-edit-on'); };
  doc.addEventListener('click', (e) => {
    const found = editableAt(e.target);
    if (!found) return;               // links, buttons and component text behave as they always do
    if (!editor.begin(found)) return;
    const el = found.el;
    if (el.getAttribute('contenteditable')) return;
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.classList.add('dc-text-edit-on');
    el.focus();
  });
  doc.addEventListener('keydown', (e) => {
    const el = editor.active && editor.active.el;
    if (!el || e.target !== el) return;
    if (e.isComposing || e.keyCode === 229) return; // the IME owns these keys while it composes
    if (e.key === 'Enter') { e.preventDefault(); stop(el); editor.commit(); el.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); stop(el); editor.cancel(); el.blur(); }
  });
  doc.addEventListener('paste', (e) => {
    const el = editor.active && editor.active.el;
    if (!el || e.target !== el && !el.contains(e.target)) return;
    e.preventDefault();
    const text = cleanText(e.clipboardData && e.clipboardData.getData('text/plain'));
    if (text) doc.execCommand('insertText', false, text);
  });
  doc.addEventListener('focusout', (e) => {
    const el = editor.active && editor.active.el;
    if (el && e.target === el) { stop(el); editor.commit(); }
  });
  win.addEventListener('message', (e) => {
    if (e.source !== win.parent || e.origin !== parentOrigin) return; // the parent itself, nobody else
    editor.onResult(e.data);
  });
  return editor;
}
