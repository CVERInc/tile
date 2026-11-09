// text-edit — "only change the words" inside a rendered sitetile page. The node-tested core; the
// distributable `text-edit.js` is BUILT from text-edit-client.mjs (`node ../build.mjs text-edit`).
//
// The owner taps a heading, paragraph or list item in a preview and types. They never see HTML or
// Markdown: the coral edits the words of ONE element whose text is plain (no bold, no link, no code
// inside it) and hands the host a text-only edit. Anything structural — splitting a paragraph,
// changing a link, adding a block — belongs to the host's own editor, and the coral says so.
//
// ── The anchor (the contract with whoever applies the edit) ─────────────────────────────────────
// The coral only offers elements the renderer itself has mapped to their source: in an editing
// preview (`parseSite(md, { sourceLines: true })`) sitetile stamps each paragraph, list item and
// heading it draws from a prose body with `data-src="<first>-<last>"`, the 0-based inclusive lines
// of the page Markdown it came from. An edit names
//   { section: '<section id>', start, end }   plus `before` (the words it replaces)
// and the applier (text-edit-source.mjs) re-renders the same source, finds the one element stamped
// with that span, checks it shows `before`, and rewrites only that line. Nothing is counted, so no
// second reading of the source can disagree with the renderer about which line an element is.
// A page rendered without spans (any production build) offers nothing.
//
// Freshness is the REVISION, not `before`: duplicates renumber when somebody else edits one of
// them, and the words alone cannot tell. The host stamps the frame with `data-revision` (the
// source revision it was rendered from); every edit carries the revision it was computed against,
// and the applier refuses any other one. A success answers with the new revision (and the section's
// new id — a title edit changes it), which the next edit is made against.
//
// Edits go ONE AT A TIME. The owner can keep typing, but the next edit is only sent once the
// previous one is answered, with acknowledged words as its `before` and the revision the last
// answer returned. An element with an edit outstanding stays `pending` until the host answers it:
// words typed meanwhile are a draft, sent after a success against the new revision. A refusal
// always puts the acknowledged words back, focused or not, unless newer words were typed over the
// refused ones; and a refused edit is never sent again without a new keystroke (see STATES and the
// transition table in createEditor).
// (An edit replaces one line with one line, so a span stays valid after its neighbours change.)
//
// The edit the host receives (postMessage to the parent window, at the configured origin only):
//   { type: 'reef-text-edit', id, page, revision, anchor: { section, start, end }, before, after }
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

/** The source span the renderer stamped on an element, or null. */
const RE_SPAN = /^(\d+)-(\d+)$/;
export function spanOf(el) {
  const m = RE_SPAN.exec((el && el.getAttribute && el.getAttribute('data-src')) || '');
  if (!m) return null;
  const start = Number(m[1]), end = Number(m[2]);
  return end >= start ? { start, end } : null;
}

/** Plain = one source line, and no element inside it. A bold word, a link, an inline image or code
 *  makes the element a structural one, and a soft-wrapped paragraph is several lines: the coral
 *  edits neither. */
export const isPlain = (el) => (!el.children || el.children.length === 0) && (() => { const s = spanOf(el); return !!s && s.start === s.end; })();

/** True when `s` holds a character the HTML parser drops or rewrites, or that cannot be stored as
 *  text: C0 controls other than tab, LF and FF (U+0000 is dropped, CR becomes LF), DEL and the C1
 *  controls, U+FFFE/U+FFFF, and a lone surrogate. Words with one are never sent or written. */
export function unsafeText(s) {
  const t = String(s == null ? '' : s);
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { i++; continue; }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
    if (c < 0x20 ? c !== 0x09 && c !== 0x0a && c !== 0x0c : (c >= 0x7f && c <= 0x9f) || c === 0xfffe || c === 0xffff) return true;
  }
  return false;
}

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
    if (kind) return spanOf(n) ? { el: n, section, kind, plain: isPlain(n) } : null; // no span → not mapped
  }
  return null;
}

/** The anchor for an element: its section's id and the source span the renderer stamped on it. */
export function anchorFor(el, section, before = cleanText(el.textContent)) {
  const span = spanOf(el);
  return span && section ? { section: section.id, start: span.start, end: span.end, before } : null;
}

/** Where one element's words stand. Every element the owner has touched is in exactly one:
 *   idle     — it shows its saved words, and nothing about it is outstanding;
 *   editing  — the owner is typing in it, and nothing about it is outstanding;
 *   pending  — one edit of it waits for the host (sent, or queued behind another element's edit);
 *   refused  — its last edit was refused and its saved words are back.
 * `pending` has exactly two exits and both are the host's reply: a success (→ idle, the saved words
 * as base) and a refusal (→ the rollback below). No click, blur, Enter, Escape or typing leaves it.
 * Typing into a pending element edits a DRAFT, kept until the reply: a success then sends the draft
 * against the new revision, a refusal keeps it as newer words. Escape during pending drops the
 * draft only. So a draft is never shown as saved, and the frame never forgets an answer it is owed.
 * Nothing leaves `refused` or `idle` by itself: only the owner typing again makes a new edit, so a
 * refused edit is never retried behind their back. */
export const STATES = Object.freeze({ IDLE: 'idle', EDITING: 'editing', PENDING: 'pending', REFUSED: 'refused' });
const { IDLE, EDITING, PENDING, REFUSED } = STATES;

/**
 * The editing session. DOM-free apart from the elements it is handed, so node can drive it:
 *   page           — the page path the host saves to
 *   revision       — the source revision the frame was rendered from (data-revision)
 *   post(message)  — send an edit to the host
 *   hint(text, el) — show a short hint next to an element
 */
export function createEditor({ page, revision, post, hint, words = {} }) {
  let active = null;            // the element the owner is typing in (editing, or a pending draft)
  let seq = 0;
  let rev = typeof revision === 'string' && revision ? revision : null;
  // element → { section, kind, state,
  //             ack   — the saved words;
  //             sent  — the words of its one outstanding edit (pending only), else null;
  //             draft — words committed while pending, for after the reply, else null;
  //             base  — the words it showed when the owner focused it, or the coral last wrote }
  const known = new Map();
  const queue = [];             // pending elements whose edit is not sent yet, oldest first
  let inflight = null;          // { id, el, after } — the one edit the host has not answered
  const sectionIds = new Map(); // section element → its id in the source since a title edit
  const refusedHint = (text) => (typeof text === 'string' && text ? text : (words.refused || DEFAULT_REFUSED));
  const editorHint = () => words.useEditor || DEFAULT_HINT;

  const show = (el, k, text) => { el.textContent = text; k.base = text; };
  const send = (el, k, text) => { k.sent = text; queue.push(el); return PENDING; };
  const pendingWords = (k) => (k.draft !== null ? k.draft : k.sent);

  // ── The transitions. state → event → handler(el, k, arg) returning the next state. An event a
  // state has no row for changes nothing. User events: focus (click), commit (Enter or blur),
  // cancel (Escape). Host events: ok and refuse, with { after: the words that edit sent, text }.
  // Every row of PENDING except ok and refuse returns PENDING.
  const TRANSITIONS = {
    [IDLE]: { focus: startTyping },
    [REFUSED]: { focus: startTyping },
    [EDITING]: { commit: commitEdit, cancel: cancelEdit },
    [PENDING]: { focus: watchDraft, commit: commitDraft, cancel: dropDraft, ok: saved, refuse: refused },
  };

  function startTyping(el, k) { k.base = cleanText(el.textContent); return EDITING; }

  function commitEdit(el, k) {
    if (unsafeText(el.textContent)) { show(el, k, k.ack); hint(refusedHint(null), el); return IDLE; }
    const after = cleanText(el.textContent);
    if (!after) { show(el, k, k.ack); hint(editorHint(), el); return IDLE; }
    show(el, k, after);
    return after === k.ack ? IDLE : send(el, k, after);
  }

  function cancelEdit(el, k) { show(el, k, k.ack); return IDLE; }

  function watchDraft(el, k) { k.base = cleanText(el.textContent); return PENDING; }

  function commitDraft(el, k) {
    if (unsafeText(el.textContent)) { show(el, k, pendingWords(k)); hint(refusedHint(null), el); return PENDING; }
    const after = cleanText(el.textContent);
    if (!after) { show(el, k, pendingWords(k)); hint(editorHint(), el); return PENDING; }
    k.draft = after === k.sent ? null : after;
    show(el, k, after);
    return PENDING;
  }

  function dropDraft(el, k) { k.draft = null; show(el, k, k.sent); return PENDING; }

  function saved(el, k, { after }) { k.ack = after; k.sent = null; return settle(el, k, false); }

  function refused(el, k, { text }) { hint(refusedHint(text), el); k.sent = null; return settle(el, k, true); }

  // After the reply. While the owner is typing in it, what it shows is their draft against the
  // saved words: it stays, unless the edit was refused and nothing was typed or drafted since the
  // element was focused (it still shows the refused words) — then the saved words come back.
  // Otherwise a draft different from the saved words is the next edit; without one, the element
  // shows its saved words.
  function settle(el, k, wasRefused) {
    const draft = k.draft;
    k.draft = null;
    if (active === el) {
      if (wasRefused && draft === null && cleanText(el.textContent) === k.base) show(el, k, k.ack);
      return EDITING;
    }
    if (draft !== null && draft !== k.ack) { show(el, k, draft); return send(el, k, draft); }
    show(el, k, k.ack);
    return wasRefused ? REFUSED : IDLE;
  }

  function step(el, event, arg) {
    const k = known.get(el);
    const handler = k && TRANSITIONS[k.state][event];
    if (handler) k.state = handler(el, k, arg || {});
    return k ? k.state : IDLE;
  }

  function begin(found) {
    if (!found) return false;
    if (!found.plain) { hint(editorHint(), found.el); return false; }
    if (active === found.el) return true;
    if (active) commit();
    if (!anchorFor(found.el, found.section)) return false;
    if (!known.has(found.el)) {
      const now = cleanText(found.el.textContent);
      known.set(found.el, { section: found.section, kind: found.kind, state: IDLE, ack: now, sent: null, draft: null, base: now });
    }
    step(found.el, 'focus');
    active = found.el;
    return true;
  }

  function cancel() {
    if (!active) return;
    const el = active;
    active = null;
    step(el, 'cancel');
  }

  // Send the next queued edit, with the saved words as `before`. Returns what it posted.
  function pump() {
    while (!inflight && queue.length) {
      const el = queue.shift();
      const k = known.get(el);
      if (k.state !== PENDING || k.sent === null) continue;
      const anchor = rev && anchorFor(el, k.section, k.ack);
      if (!anchor) { step(el, 'refuse', { after: k.sent, text: null }); continue; }
      const id = 'e' + (++seq);
      const message = {
        type: EDIT_MESSAGE, id, page, revision: rev,
        anchor: { section: sectionIds.get(k.section) || anchor.section, start: anchor.start, end: anchor.end },
        before: k.ack, after: k.sent,
      };
      inflight = { id, el, after: k.sent };
      try { post(message); } catch { inflight = null; step(el, 'refuse', { after: message.after, text: null }); continue; }
      return message;
    }
    return null;
  }

  /** Ends the session. Returns the message posted now, or null (nothing changed, or it waits its turn). */
  function commit() {
    if (!active) return null;
    const el = active;
    active = null;
    step(el, 'commit');
    return pump();
  }

  /** The host's answer to the edit in flight; anything else is nobody's answer. */
  function onResult(msg) {
    if (!msg || msg.type !== RESULT_MESSAGE || !inflight || msg.id !== inflight.id) return false;
    const { el, after } = inflight;
    inflight = null;
    const k = known.get(el);
    if (msg.ok === true) {
      rev = typeof msg.revision === 'string' && msg.revision ? msg.revision : null;
      if (typeof msg.section === 'string' && msg.section) sectionIds.set(k.section, msg.section);
      step(el, 'ok', { after });
    } else step(el, 'refuse', { after, text: msg.hint });
    pump();
    return true;
  }

  /** The state of an element (see STATES); `idle` for one the owner never touched. */
  const stateOf = (el) => (known.has(el) ? known.get(el).state : IDLE);

  return { begin, commit, cancel, onResult, stateOf, get active() { return active ? { el: active } : null; } };
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
