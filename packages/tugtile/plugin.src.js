/* tugtile plugin source. The build process inlines vendor/Sortable.min.js inside an isolated wrapper before this file,
   providing the global `Sortable`. The final build output is a single-file main.js. */
const { Plugin, ItemView, MarkdownRenderer, Notice, Component, Menu, WorkspaceLeaf, MarkdownView, Modal, PluginSettingTab, Setting, Platform, setIcon } = require('obsidian');

/* ===================== i18n =====================
   Externalizes user-facing strings. Defaults to English (en-US) and follows the Obsidian UI language.
   Only translate string values; do not modify any logic, formats, or kanban:settings keys.
   - LOCALE: Reads Obsidian's language setting (localStorage 'language') and maps it to one of the 4 supported locales; falls back to en-US for others (including Simplified Chinese).
   - TR: A translation table for 4 languages. Keys are semantic English; values requiring interpolation use functions.
   - t(key, ...args): Looks up the key in the current locale -> falls back to en-US -> falls back to the key itself; executes it if it is a function.
   Terminology (SSOT out/i18n-naming.md): tile=card / board=board / lane=lane / archive=archive / delete=delete / undo=undo (restore). */
const LOCALE = (() => {
  let lang = '';
  try { lang = (window.localStorage.getItem('language') || ''); } catch (e) { lang = ''; }
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'ko') return 'ko-KR';
  return 'en-US';   // Defaults to English for other settings (e.g., Simplified Chinese 'zh', 'en', unset, etc.)
})();

const TR = {};   // i18n strings are moved to i18n/*.json and injected during build by build.sh (translators only need to edit JSON)

function t(key, ...args) {
  let s = (TR[LOCALE] && TR[LOCALE][key]);
  if (s == null) s = TR['en-US'] && TR['en-US'][key];
  if (s == null) return key;
  if (typeof s === 'string' && args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? args[+i] : m));
  return s;
}
/* ===================== /i18n ===================== */

const LANE_WIDTHS = { narrow: 260, medium: 300, wide: 360 };   // Lane width presets (px)
const TABLE_PADS = { narrow: 5, medium: 9, wide: 14 };          // Table row vertical-padding presets (px) — "table density"
// Shared touch-drag tuning for EVERY draggable (lanes + tiles): long-press to start (delay), and tolerate a little
// finger tremor first (touchStartThreshold) so a tap/long-press to rename a lane isn't hijacked into a drag.
// One source → lanes and tiles always feel the same. (TOC drag in the editor core carries its own copy.)
const DRAG_TOUCH = { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4 };
// Full-screen editor toolbar buttons (order + groups). 'sep' marks a group divider. Each can be toggled in settings (default all on); settings show the glyph as the label.
// build injects packages/core/editor-core.js (the shared editor core) at the next line:
//#core-inline
const DEFAULT_SETTINGS = {
  laneWidth: 'medium',       // Lane width preset: 'narrow' | 'medium' | 'wide' (mapped to px by LANE_WIDTHS)
  tableDensity: 'medium',    // Table row spacing preset: 'narrow' | 'medium' | 'wide' (mapped to px by TABLE_PADS)
  showCheckboxes: false, hideCounts: false, showRelativeDate: true, dateDisplayFormat: 'YYYY-MM-DD',
  enterSubmits: true,        // Enter to submit (false = Enter to newline, Shift/Cmd+Enter to submit)
  prependNewCards: false,    // Add new cards to the bottom of the lane (true = add to the top)
  archiveWithDate: false,    // Append timestamp when archiving
  maxArchiveSize: -1,        // Cap on archived cards per board; oldest dropped beyond it (-1 / 0 = unlimited)
  backupRetention: 20,       // How many _tugtile-backups snapshots to keep per board (oldest pruned beyond this; -1 = keep all)
  archiveHeading: 'Archive', // Heading for newly created archive sections (uses localized strings in kanban to align when returning to kanban; can be customized to "Archive", etc.)
  responsiveBoard: false,    // When on, the board auto-reflows to a vertical stack on narrow panes
  editorTools: {},           // Per-button on/off for the editor toolbar (missing key = on); see EDITOR_TOOLS
  modes: {},                 // Per-mode on/off for the big editor's view cycle (missing key = on); see EDITOR_MODES
  seasonedColor: false,      // Seasoned highlight palette: false = single accent tint, true = per-token colours
};

const VIEW_TYPE = 'tugtile-board';

// A lightweight version of monkey-around: wraps a method and returns a restore function (verifies no other wrappers were added before restoring)
function aroundMethod(obj, method, factory) {
  const original = obj[method];
  const wrapped = factory(original);
  obj[method] = wrapped;
  return () => { if (obj[method] === wrapped) obj[method] = original; };
}

// Constants for progressive auto-scrolling (increase SCROLL_MAX for faster scrolling)
const SCROLL_EDGE = 70;   // Edge detection threshold (px): triggers scrolling when close to the boundary
const SCROLL_MAX = 22;    // Maximum scroll speed per frame (px) at the outermost edge

/* ===================== CORE: markdown board ↔ model (written from scratch, format compatible, unit testable in Node) =====================
   model = { pre, columns:[{ header, title, tiles:[{ raw, text }] }], post }
   - pre  = Original text before the first `## ` (e.g., frontmatter), preserved as-is.
   - post = Original text starting from `%% kanban:settings`, preserved as-is.
   - tile.raw = Exact markdown text of the card in the file (`- [ ]` line + tab-indented content, trailing blank lines trimmed) → used for writing back, content preserved verbatim.
   - tile.text = Card body markdown after removing `- [ ]` and one level of indentation → used for rendering. */
// Normalise a lane name into the archive home-key: strip the %% token delimiter, collapse any whitespace (incl.
// full-width 　 / NBSP, which \s matches) to a single space, trim. MUST be applied on BOTH sides (writing the token
// and matching on restore) or a full-width-space lane name won't match its own token. See archive-restore-e2e.test.
function homeKey(s) { return String(s || '').replace(/%%/g, '').replace(/\s+/g, ' ').trim(); }
function tileRenderText(tileLines) {
  const out = [];
  const m = tileLines[0].match(/^- \[.\] ?(.*)/);    // Do not use $ (remaining \r in CRLF causes (.*)$ to fail to match the end of line)
  out.push((m ? m[1] : tileLines[0]).replace(/\s*%%tg-home:.*?%%/, ''));   // hide the archive home-lane token (archived cards only; no-op on active cards)
  for (let i = 1; i < tileLines.length; i++) {
    out.push(tileLines[i].replace(/^(?:\t| {1,4})/, ''));   // Remove indentation for wrapped lines: one tab or 1-4 spaces
  }
  return out.join('\n');
}

// For table view: strip markdown formatting (headings, bold, italics, strikethrough, inline code, and links) to get plain text. Table styling is completely managed by us to ensure uniform font sizes.
function tilePlainText(s) {
  return String(s)
    .replace(/^#{1,6}\s+/, '')                                              // Heading hashes
    .replace(/(\*\*|__)(.+?)\1/g, '$2')                                     // Bold
    .replace(/(\*|_)(.+?)\1/g, '$2')                                        // Italic
    .replace(/~~(.+?)~~/g, '$1')                                            // Strikethrough
    .replace(/`([^`]+)`/g, '$1')                                            // Inline code
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)    // wikilink / embeds
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')                              // Markdown links / images
    .trim();
}

// Visual (display) width of a string in monospace "columns", counting East-Asian wide / fullwidth
// characters as 2 and everything else as 1. WHY: JavaScript's String.length counts UTF-16 code units,
// so "理牌" (2 ideographs) reports length 2 even though it occupies ~4 latin-character widths on screen.
// The long-card collapse heuristic compares against a visual budget (60), so it must reason in display
// columns, not code units — otherwise a CJK card that is already visually longer than a 60-char latin
// card would stay expanded. Pure + Obsidian-free so it can be unit-tested in Node (lives in CORE).
// Iterates by Unicode code point (for..of / the string iterator yields whole code points, correctly
// pairing surrogate halves) so astral characters are measured once, not twice.
function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    // Ranges treated as width-2 (the practical CJK set tugtile cards use). Kept as explicit, commented
    // ranges rather than a regex so each block is auditable and easy to extend.
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo (leading consonants render full-width)
      (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals, Kangxi Radicals, CJK Symbols & Punctuation (incl. U+3000 ideographic space)
      (cp >= 0x3041 && cp <= 0x33FF) ||   // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK enclosures/compat
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified Ideographs (the main block)
      (cp >= 0xA000 && cp <= 0xA4CF) ||   // Yi Syllables / Yi Radicals
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (cp >= 0xFE30 && cp <= 0xFE4F) ||   // CJK Compatibility Forms (vertical/overline punctuation)
      (cp >= 0xFF00 && cp <= 0xFF60) ||   // Fullwidth Forms (fullwidth ASCII variants + fullwidth punctuation ：，！？)
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth currency / sign forms
      (cp >= 0x20000 && cp <= 0x3FFFD)    // CJK Unified Ideographs Extensions B–F (astral plane; reached via surrogate pairs)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function parseFile(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';   // Detect the line endings of the original file to restore during serialization (prevents mixed line endings / CRLF leftovers)
  const lines = text.split(/\r\n|\r|\n/);           // Normalize line endings internally to \n
  // settings/end must be calculated first. If firstCol is not found, fallback to laneEnd (instead of lines.length); otherwise, an empty board will swallow settings into pre and corrupt the file.
  const settingsIdx = lines.findIndex((l) => l.indexOf('%% kanban:settings') === 0 || l.indexOf('%% tugtile:settings') === 0);   // Dual-read: accept legacy kanban marker and the native tugtile marker
  const end = settingsIdx === -1 ? lines.length : settingsIdx;

  // End of frontmatter (prevents frontmatter --- delimiters from being misidentified as horizontal rules)
  let fmEnd = 0;
  if (lines[0] === '---') { const c = lines.indexOf('---', 1); if (c !== -1) fmEnd = c + 1; }

  const isFence = (l) => /^(```|~~~)/.test(l);                // Top-level code fence (indented card contents are not affected)
  const isHr = (l) => /^\*\*\*+\s*$/.test(l);                 // Archive separator: only matches *** (kanban's archiveString, to avoid misidentifying lead ---/___ horizontal lines as archive markers and swallowing lanes)
  const isHeading = (l) => l.indexOf('## ') === 0;

  // Archive section start: a horizontal rule within the board area, not inside a fence, and followed by a `## ` heading (after skipping blank lines) counts as the separator.
  // The "followed by heading" condition avoids false positives from isolated horizontal rules in the lead or card text, which would otherwise silently archive active cards.
  let archiveIdx = -1;
  { let fence = false;
    for (let i = fmEnd; i < end; i++) {
      if (isFence(lines[i])) { fence = !fence; continue; }
      if (fence) continue;
      if (isHr(lines[i])) {
        let j = i + 1;
        while (j < end && lines[j].trim() === '') j++;
        if (j < end && isHeading(lines[j])) { archiveIdx = i; break; }
      }
    }
  }
  const laneEnd = archiveIdx === -1 ? end : archiveIdx;
  const archive = archiveIdx === -1 ? '' : lines.slice(archiveIdx, end).join('\n').replace(/^\s+/, '').replace(/\s+$/, '');

  // The first valid lane (inside the lanes section, not within a fence), falls back to laneEnd if not found
  let firstCol = -1;
  { let fence = false;
    for (let i = fmEnd; i < laneEnd; i++) {
      if (isFence(lines[i])) { fence = !fence; continue; }
      if (!fence && isHeading(lines[i])) { firstCol = i; break; }
    }
  }
  if (firstCol === -1) firstCol = laneEnd;

  const pre = lines.slice(0, firstCol).join('\n');
  const post = settingsIdx === -1 ? '' : lines.slice(settingsIdx).join('\n');

  const columns = [];
  let col = null, tileLines = null, fence = false;
  const flush = () => {
    if (tileLines && col) {
      const cl = tileLines.slice();
      while (cl.length && cl[cl.length - 1].trim() === '') cl.pop();
      const cm = /^- \[(.)\]/.exec(cl[0]);
      const bm = /\s+\^([A-Za-z0-9-]+)$/.exec(cl[0]);   // blockId (hidden during display but preserved verbatim in raw to prevent breaking links like [[#^id]])
      const clForText = cl.slice();
      if (bm) clForText[0] = cl[0].slice(0, bm.index);
      col.tiles.push({ raw: cl.join('\n'), text: tileRenderText(clForText), check: cm ? cm[1] : ' ', block: bm ? bm[1] : null });
    }
    tileLines = null;
  };
  for (let i = firstCol; i < laneEnd; i++) {
    const ln = lines[i];
    if (isFence(ln)) { fence = !fence; if (tileLines) tileLines.push(ln); else if (col) col.lead.push(ln); continue; }
    if (!fence && isHeading(ln)) {
      flush();
      col = { header: ln, title: ln.slice(3).trim(), tiles: [], lead: [] };
      columns.push(col);
      continue;
    }
    if (!col) continue;
    if (!fence && /^- \[.\]/.test(ln)) { flush(); tileLines = [ln]; }
    else if (tileLines) tileLines.push(ln);
    else col.lead.push(ln);             // Non-card text before the first card at the top of the lane (preserved, not discarded)
  }
  flush();
  for (const c of columns) {            // Trim leading/trailing blank lines from lead text (preserving internal lines)
    while (c.lead.length && c.lead[0].trim() === '') c.lead.shift();
    while (c.lead.length && c.lead[c.lead.length - 1].trim() === '') c.lead.pop();
  }
  // Fault-tolerant parser for settings JSON (only used for reading flags like show-checkboxes; serialization still preserves the raw post as-is without rewriting)
  let settings = {};
  const sm = /```\s*\n([\s\S]*?)\n```/.exec(post);
  if (sm) { try { settings = JSON.parse(sm[1]); } catch (e) { settings = {}; } }

  return { pre, columns, archive, post, settings, eol };
}

function serializeFile(model) {
  const pre = (model.pre || '').replace(/\s+$/, '');
  const body = model.columns
    .map((c) => {
      const lead = (c.lead && c.lead.length) ? c.lead.join('\n') + '\n\n' : '';
      return c.header + '\n\n' + lead + c.tiles.map((cd) => cd.raw).join('\n');
    })
    .join('\n\n\n');
  const archive = (model.archive || '').replace(/^\s+/, '').replace(/\s+$/, '');  // Preserve the archive section as-is
  const post = (model.post || '').replace(/^\s+/, '').replace(/\s+$/, '');  // Trim leading/trailing spaces → idempotent (preventing file from bloating on multiple saves)
  let out = (pre ? pre + '\n\n' : '') + body;
  if (archive) out += '\n\n\n' + archive;
  if (post) out += '\n\n\n' + post;
  out += '\n';
  return model.eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;   // Restore original line endings (to avoid mixing line ending styles)
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Formats date/time based on moment-style tokens (supports common tokens like YYYY/MM/DD/HH/mm/M/D to align with kanban's usage)
function formatDateTokens(p, fmt) {
  const pad = (n) => String(n).padStart(2, '0');
  return (fmt || 'YYYY-MM-DD')
    .replace(/YYYY/g, String(p.y)).replace(/MM/g, pad(p.mo)).replace(/DD/g, pad(p.d))
    .replace(/HH/g, pad(p.h || 0)).replace(/mm/g, pad(p.mi || 0))
    .replace(/\bM\b/g, String(p.mo)).replace(/\bD\b/g, String(p.d));
}
// Parses a date string based on date-format → returns {y,mo,d} or null (for invalid dates). Supports common tokens, treats others as literals.
function parseDateStr(str, fmt) {
  const toks = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'M', 'D'];
  const order = []; let re = '', i = 0; fmt = fmt || 'YYYY-MM-DD';
  while (i < fmt.length) {
    const t = toks.find((tk) => fmt.startsWith(tk, i));
    if (t) { order.push(t); re += t === 'YYYY' ? '(\\d{4})' : (t.length === 2 ? '(\\d{1,2})' : '(\\d{1,2})'); i += t.length; }
    else { re += escapeRe(fmt[i]); i++; }
  }
  const m = new RegExp('^' + re).exec(str || '');
  if (!m) return null;
  const o = {}; order.forEach((t, idx) => { o[t] = parseInt(m[idx + 1], 10); });
  const y = o.YYYY, mo = o.MM || o.M, d = o.DD || o.D;
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;   // Handle invalid dates like Month 13 or Day 45
  return { y, mo, d };
}

// Extracts kanban-formatted date `@{YYYY-MM-DD}` and time `@@{HH:mm}` from card text (trigger character is configurable).
// Match time first, then date (to prevent `@{` from matching the trailing part of `@@{`, complying with kanban's overlapping prefix rule). Returns { clean, date, time }.
function extractMeta(text, dateTrig, timeTrig) {
  dateTrig = dateTrig || '@'; timeTrig = timeTrig || '@@';
  let date = null, time = null, clean = text || '';
  const tFirst = new RegExp(escapeRe(timeTrig) + '\\{([^}]*)\\}');
  const dFirst = new RegExp(escapeRe(dateTrig) + '\\{([^}]*)\\}');
  const mt = tFirst.exec(clean); if (mt) time = mt[1];
  clean = clean.replace(new RegExp(escapeRe(timeTrig) + '\\{[^}]*\\}', 'g'), '');   // Clear all time tokens first (preventing @{ from matching the end of @@{)
  const md = dFirst.exec(clean); if (md) date = md[1];
  clean = clean.replace(new RegExp(escapeRe(dateTrig) + '\\{[^}]*\\}', 'g'), '');    // Clear all date tokens (only uses the first match, removes duplicates/residuals)
  // Recognizes daily note format like @[[YYYY-MM-DD]] (kanban link-date-to-daily-note) as a date
  if (date == null) { const dl = new RegExp(escapeRe(dateTrig) + '\\[\\[([^\\]]*)\\]\\]').exec(clean); if (dl) date = dl[1]; }
  clean = clean.replace(new RegExp(escapeRe(dateTrig) + '\\[\\[[^\\]]*\\]\\]', 'g'), '');
  clean = clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  return { clean, date, time };
}

// Extracts #tags from the card (supports CJK; stops at spaces or common punctuation). Returns an array of tag strings including the # prefix.
const TAG_RE = /#[^\s#,.;:!?，。、；：！？（）()\[\]{}"'\\]+/gu;
function extractTags(text) {
  const out = []; let m; const re = new RegExp(TAG_RE.source, 'gu');
  while ((m = re.exec(text || '')) !== null) out.push(m[0]);
  return out;
}

// Parses the WIP limit `(N)` at the end of the lane heading: returns { title: title without (N), max: number|null }.
function parseWip(title) {
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(title || '');
  return m ? { title: m[1], max: parseInt(m[2], 10) } : { title: title || '', max: null };
}

// Rewrites a specific key in the settings JSON block (preserving all other settings verbatim) or inserts it if missing. The value is JSON serialized.
function setSetting(post, key, value) {
  const kq = JSON.stringify(key);
  const kv = kq + ':' + JSON.stringify(value);
  // Create settings block if missing (otherwise view/collapse preferences cannot be saved)
  if (!post || (post.indexOf('kanban:settings') === -1 && post.indexOf('tugtile:settings') === -1)) return '%% tugtile:settings\n```\n{' + kv + '}\n```\n%%';   // No block yet → create a native tugtile one; existing kanban/tugtile blocks are edited in place (marker preserved until the user upgrades)
  const re = new RegExp(escapeRe(kq) + '\\s*:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|\\{[^}]*\\}|true|false|null|-?\\d+(?:\\.\\d+)?)');
  if (re.test(post)) return post.replace(re, () => kv);               // Use a function replacer to prevent interpreting $ as special regex characters
  if (/\{\s*\}/.test(post)) return post.replace(/\{\s*\}/, () => '{' + kv + '}');
  return post.replace(/\{/, () => '{' + kv + ',');
}
// Writes back list-collapse (an array of booleans indicating collapse states, matching lane order) using setSetting
function setListCollapse(post, arr) { return setSetting(post, 'list-collapse', arr); }

// --- Fold-all cycle (PURE, platform-free) — the 3-state decision logic, shared by the Obsidian board (BoardView
// reads the live DOM then calls these) and the web surface (board-core.js). The DOM/animation APPLY stays per-host;
// only the "which state, what it means, what icon" decisions live here. Invariant: lanes collapsed ⇒ everything shut.
const FOLD_ICONS = ['maximize-2', 'expand', 'shrink'];   // index by NEXT state — the icon hints the action the next click does
const FOLD_TARGETS = [                                    // what each state means for lanes/cards
  { lanesCollapsed: false, cardsExpanded: false },        // 0: lanes open, cards folded
  { lanesCollapsed: false, cardsExpanded: true },         // 1: all open
  { lanesCollapsed: true, cardsExpanded: false },         // 2: all collapsed
];
function foldStateFrom(allLanesCollapsed, allLongTilesOpen) { return allLanesCollapsed ? 2 : (allLongTilesOpen ? 1 : 0); }
function nextFold(state) { return (state + 1) % 3; }
function foldTargets(state) { return FOLD_TARGETS[state] || FOLD_TARGETS[0]; }
function foldIcon(state) { return FOLD_ICONS[nextFold(state)]; }   // the button shows the NEXT action

// Settings keys tugtile understands; "upgrade to tugtile format" keeps only these and drops kanban-only keys for a clean file.
const TUGTILE_SETTING_KEYS = ['show-checkboxes', 'hide-card-count', 'date-trigger', 'time-trigger', 'date-format', 'date-display-format', 'time-format', 'link-date-to-daily-note', 'show-relative-date', 'tag-colors', 'move-tags', 'tag-action', 'archive-date-format', 'archive-date-separator', 'append-archive-date', 'new-line-trigger', 'new-card-insertion-method', 'archive-with-date', 'max-archive-size', 'list-collapse', 'tugtile-view', 'tugtile-locked'];
// True if the file still carries obsidian-kanban markers (frontmatter key or settings marker).
function hasKanbanFormat(text) { return /^---[\s\S]*?\bkanban-plugin\b/.test(text || '') || (text || '').indexOf('%% kanban:settings') !== -1; }
// One-way upgrade: rename the markers to tugtile's and rebuild the settings block keeping ONLY known keys (clean). Structure (- [ ] / ## lanes / blockIds / *** / archive) is untouched. Idempotent.
function migrateToTugtile(text) {
  const model = parseFile(text);
  const pre = (model.pre || '').replace(/^kanban-plugin:/m, 'tugtile-plugin:');
  const src = model.settings || {};
  const clean = {};
  for (const k of TUGTILE_SETTING_KEYS) if (src[k] !== undefined) clean[k] = src[k];
  if (clean['move-tags'] === undefined && src['move-tags-to-card-footer'] !== undefined) clean['move-tags'] = !!src['move-tags-to-card-footer'];
  if (clean['tag-action'] === 'kanban') clean['tag-action'] = 'board';   // Rename the legacy enum value too
  const post = '%% tugtile:settings\n```\n' + JSON.stringify(clean) + '\n```\n%%';
  return serializeFile({ pre, columns: model.columns, archive: model.archive, post, eol: model.eol });
}
/* ===================== /CORE ===================== */

class BoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filePath = null;
    this._sortables = [];
    this._backedUp = false;
    this._undo = [];   // Pushes the previous file content before writing, used for undo
    this._redo = [];   // Used for redo after an undo operation
  }
  getViewType() { return VIEW_TYPE; }
  getIcon() { return 'gallery-vertical'; }
  getDisplayText() {
    // Tab title = plain file name only (no brand suffix), so narrow tabs show as much of the name as possible.
    // The brand ("· tugtile-ing") lives in the centered header title instead, applied by decorateHeaderTitle().
    return this.filePath ? this.filePath.split('/').pop().replace(/\.md$/, '') : t('appName');
  }
  async setState(state, result) {
    if (state && state.file && state.file !== this.filePath) { this.filePath = state.file; this.viewMode = null; this._undo = []; this._redo = []; this.updateUndoRedoActions(); this.leaf.updateHeader && this.leaf.updateHeader(); }   // Change file → reset view and undo/redo stacks, and refresh header (updating the header title from the fallback app name to the file name)
    this.watchHeaderTitle(); this.decorateHeaderTitle();
    await this.render();
    return super.setState(state, result);
  }
  getState() { return { file: this.filePath }; }
  // The centered header title shows "<file name> · tugtile-ing" with the brand part dimmed.
  // Obsidian rewrites this element from getDisplayText() (plain file name) on every updateHeader, so we re-append the brand span and keep it in sync via a MutationObserver.
  _headerTitleEl() { return this.containerEl ? this.containerEl.querySelector('.view-header-title') : null; }
  // The centered header is the view switcher: "<current view icon> <current view name> · tugtile-ing".
  // The file name is NOT repeated here (the tab already shows it). Obsidian rewrites this element from getDisplayText() on every updateHeader, so we rebuild via a MutationObserver.
  // Builds the centered control — [view-cycle button] · [lock button] — into a parent. The "·" is a neutral
  // separator (not a button); equal button padding + a single gap make its two sides symmetric.
  _buildHeaderCtl(parent) {
    const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
    const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });
    vc.setAttribute('role', 'button');
    vc.setAttribute('aria-label', t('viewSwitchAction'));
    vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.cycleView(); };
    this._viewCycleEl = vc;
    wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
    const lk = wrap.createSpan({ cls: 'tugtile-brand' });   // Brand suffix + lock icon = the lock toggle
    lk.setAttribute('role', 'button');
    lk.setAttribute('aria-label', t('lockToggle'));
    lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleLock(); };
    this._lockBtnEl = lk;
    this.refreshViewCycle();
    this.refreshLock();
    return wrap;
  }
  decorateHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el) return;
    // Phone: the control + brand live in the content top-bar, so keep the header title empty — otherwise the
    // view's app-name fallback ("理牌") shows there redundantly. Re-cleared by the MutationObserver.
    if (Platform.isPhone) { if (el.textContent !== '') el.textContent = ''; return; }
    if (el.querySelector('.tugtile-headerctl')) return;   // Already built; skip (also prevents MutationObserver loops). When Obsidian wipes it on updateHeader, our wrapper is gone → we rebuild.
    el.textContent = '';
    this._buildHeaderCtl(el);
  }
  viewName() { return ({ board: t('viewBoard'), table: t('viewTable') })[this.viewMode] || t('viewBoard'); }
  refreshViewCycle() {
    const btn = this._viewCycleEl; if (!btn || !btn.isConnected) return;
    btn.empty();
    setIcon(btn.createSpan({ cls: 'tugtile-viewcycle-icon' }), this.viewIcon());
    btn.createSpan({ cls: 'tugtile-viewcycle-name', text: this.viewName() });
  }
  // Brand suffix reflects lock state: unlocked = t('brandSuffix') + open padlock; locked = t('brandSuffixLocked') + closed padlock
  refreshLock() {
    const lk = this._lockBtnEl; if (!lk || !lk.isConnected) return;
    lk.empty();
    lk.createSpan({ cls: 'tugtile-brand-text', text: this._locked ? t('brandSuffixLocked') : t('brandSuffix') });
    setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), this._locked ? 'lock' : 'lock-open');
    if (this._mdActionEl) this._mdActionEl.toggleClass('tugtile-act-off', this._locked);   // Grey out raw-markdown editing while locked
  }
  // Cycle the centered control between the two resting views (markdown is no longer a view — it's the raw editor button next to this control)
  cycleView() {
    const order = ['board', 'table'];
    this.setView(order[(order.indexOf(this.viewMode) + 1) % order.length]);
  }
  // Raw markdown: open the whole-file editor in the full-screen modal (no resting view); on save it re-renders the current board/table
  openMarkdownEditor() {
    if (this._lockGuard()) return;
    new TileEditModal(this.app, this, { text: this._loadedText || '', onSave: (v) => this.applyMarkdownEdit(v) }).open();
  }
  // Per-board read-only lock: blocks all content mutation (drag, edit, type, add/delete/check/rename) while still allowing view-only actions (switch view, collapse/fold, search). Persisted in board settings.
  _lockGuard() { if (this._locked) { new Notice(t('lockedNotice')); return true; } return false; }
  toggleLock() {
    this._locked = !this._locked;
    this.model.post = setSetting(this.model.post, 'tugtile-locked', this._locked);
    this.contentEl.toggleClass('tugtile--locked', this._locked);
    this._sortables.forEach((s) => { try { s.option('disabled', this._locked); } catch (e) {} });   // Disable drag-and-drop
    this.refreshLock();
    this.persistModel();   // Settings-only write (serializes the in-sync model), safe in any view
  }
  watchHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el || this._titleObserver) return;
    this._titleObserver = new MutationObserver(() => this.decorateHeaderTitle());   // Obsidian resets textContent on updateHeader → re-apply the brand span
    this._titleObserver.observe(el, { childList: true });
    this.decorateHeaderTitle();
  }
  // Relocate Search/Undo/Redo into the header's LEFT area (the dead back/forward arrows are hidden via CSS). Defensive: if the header isn't found (a different mobile layout), the buttons simply stay in the right cluster — no breakage.
  setupLeftActions() {
    if (this._leftActs && this._leftActs.isConnected) return;
    const header = this.containerEl && this.containerEl.querySelector('.view-header');
    if (!header) return;
    // Reuse the native back/forward container (already aligned with the left-sidebar toggle): clear the dead arrows, drop our buttons in. Fall back to a new container if it's absent.
    const nav = header.querySelector('.view-header-nav-buttons');
    const left = nav || header.createDiv({ cls: '' });
    if (!nav) header.insertBefore(left, header.firstChild);
    left.empty();
    left.addClass('tugtile-leftacts');
    [this._searchActionEl, this._undoActionEl, this._redoActionEl, this._backupActionEl].forEach((el) => { if (el) left.appendChild(el); });   // L→R: search, undo, redo, backup
    this._leftActs = left;
    this._alignLeftActs();
  }
  // Pixel-align the first left button with the left-sidebar toggle above it (the tab bar and the view header have slightly different left insets, which vary by platform — so measure rather than guess).
  _alignLeftActs() {
    const left = this._leftActs, first = this._searchActionEl;
    if (!left || !first) return;
    setTimeout(() => {
      if (!first.isConnected) return;
      const fr = first.getBoundingClientRect();
      // Class-independent: the reference is the left-most clickable icon in the bar ABOVE our header (the tab/title bar) — i.e. the sidebar toggle. Measure its left and pad to match.
      let refLeft = Infinity;
      document.querySelectorAll('.clickable-icon, .sidebar-toggle-button').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.bottom <= fr.top + 1 && r.left < 140 && r.left < refLeft) refLeft = r.left;
      });
      if (refLeft === Infinity) return;   // nothing found → keep the CSS fallback nudge
      left.style.paddingLeft = '';        // reset before measuring our own position cleanly
      const d = refLeft - first.getBoundingClientRect().left;
      if (d > 0.5 && d < 48) left.style.paddingLeft = Math.round(d) + 'px';
    }, 60);
  }
  async onOpen() {
    // Right cluster, L→R (addAction renders in REVERSE of registration, so register right-to-left):
    // [undo · redo · search] [fold-all cycle] [open-in-marktile] [Archive] [Settings]. No group gaps (flush).
    this.addAction('settings', t('boardSettingsAction'), () => this.openBoardSettings());
    this.addAction('archive', t('archiveAction'), () => this.openArchiveView());
    // Raw-markdown editor button. marktile IS the extracted editor, so when it's installed it replaces the
    // built-in one (no reason to show both); otherwise fall back to the in-app TileEditModal whole-file editor.
    if (this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('marktile')) {
      this._mdActionEl = this.addAction('square-m', t('openInMarktile'), () => { if (this.filePath) this.leaf.setViewState({ type: 'marktile-editor', active: true, state: { file: this.filePath } }); });
    } else {
      this._mdActionEl = this.addAction('file-text', t('editMarkdown'), () => this.openMarkdownEditor());
    }
    // Single 3-state cycle button (no per-axis lane/tile toggles): maximize-2 (expand lanes only) → expand (expand
    // everything: lanes + tiles) → shrink (collapse everything) → loop. Icon + label track the NEXT action.
    // refreshFoldIcon() (called by setAll* AND the single-lane/tile togglers) keeps it in sync with the live DOM.
    this._foldAllEl = this.addAction('maximize-2', t('expandAllAction'), () => this.toggleFoldAll());
    this.refreshFoldIcon();
    // Search · Undo · Redo are relocated to the header LEFT (where the dead back/forward arrows were) by setupLeftActions(); created via addAction here so their styling + state refs (grey-out, filter icon) are reused.
    this._searchActionEl = this.addAction('search', t('searchAction'), () => this.openSearch());
    this._redoActionEl = this.addAction('redo', t('redoAction'), () => this.redo());
    this._undoActionEl = this.addAction('undo', t('undoAction'), () => this.undo());
    this._backupActionEl = this.addAction('history', t('backupsAction'), () => this.openBackupView());   // joins the left group (search · undo · redo · backup)
    this.updateUndoRedoActions();
    this.setupLeftActions();
    // ⌘Z undo / ⌘⇧Z (or ⌘Y) redo: only intercepted when this board is the active view and focus is not on an input field (allowing native text undo when editing a card)
    this.registerDomEvent(document, 'keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key || '').toLowerCase() !== 'z' && (e.key || '').toLowerCase() !== 'y') return;
      if (this.app.workspace.getActiveViewOfType(BoardView) !== this) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault(); e.stopPropagation();
      if ((e.key || '').toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
    });
    // External edits (iCloud sync / other editors) → trigger reload. Postponed if a drag, edit, or write operation is in progress;
    // otherwise, render() will call destroySortables and empty() which disrupts active drags/unsaved edits or writes back incomplete data (losing cards).
    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (this._writing || !file || file.path !== this.filePath) return;
      let cur; try { cur = await this.app.vault.read(file); } catch (e) { return; }
      if (cur === this._loadedText) return;
      if (this.isBusy()) { this._pendingReload = true; return; }
      this.render();
    }));
    // File renamed or moved → update the tracked path so file operations do not fail
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath === this.filePath) this.filePath = file.path;
    }));
    // External file deletion → prevent leaving a zombie board view
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file && file.path === this.filePath) { this.filePath = null; this.render(); }
    }));
    this.watchHeaderTitle();
    await this.render();
  }
  onClose() { this.stopAutoScroll(); this.destroySortables(); this.closePopup(); if (this._titleObserver) { this._titleObserver.disconnect(); this._titleObserver = null; } }

  destroySortables() {
    this._sortables.forEach((s) => { try { s.destroy(); } catch (e) {} });
    this._sortables = [];
  }

  // Progressive edge scrolling: during drag, scrolling speeds up as the pointer approaches the container boundary (idle in the center).
  startAutoScroll() {
    this._pointer = null;
    this._onPointer = (e) => {
      const t = (e.touches && e.touches[0]) || e;
      if (t && typeof t.clientX === 'number') this._pointer = { x: t.clientX, y: t.clientY };
    };
    document.addEventListener('pointermove', this._onPointer, { passive: true, capture: true });
    document.addEventListener('touchmove', this._onPointer, { passive: true, capture: true });
    const speed = (dist) => { const d = (SCROLL_EDGE - dist) / SCROLL_EDGE; return d > 0 ? Math.min(1, d) * SCROLL_MAX : 0; };
    this._scrolling = true;
    const step = () => {
      if (!this._scrolling) return;
      const p = this._pointer;
      if (p) {
        const board = this.contentEl.querySelector('.tugtile__board');
        if (board) {
          const bx = board.getBoundingClientRect();
          if (getComputedStyle(board).flexDirection === 'column') board.scrollTop += speed(bx.bottom - p.y) - speed(p.y - bx.top);   // Vertical layout (responsive board on a narrow pane) scrolls vertically
          else board.scrollLeft += speed(bx.right - p.x) - speed(p.x - bx.left);
        }
        const lanes = this.contentEl.querySelectorAll('.tugtile__lane');
        for (let i = 0; i < lanes.length; i++) {
          const lr = lanes[i].getBoundingClientRect();
          if (p.x >= lr.left && p.x <= lr.right) {
            const list = lanes[i].querySelector('.tugtile__list');
            if (list) {
              const sr = list.getBoundingClientRect();
              list.scrollTop += speed(sr.bottom - p.y) - speed(p.y - sr.top);
            }
            break;
          }
        }
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
  stopAutoScroll() {
    this._scrolling = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._onPointer) {
      document.removeEventListener('pointermove', this._onPointer, { passive: true, capture: true });
      document.removeEventListener('touchmove', this._onPointer, { passive: true, capture: true });
      this._onPointer = null;
    }
  }

  // Busy state (dragging, editing, adding, or renaming) → delays external reloads to prevent layout disruptions
  isBusy() {
    return !!(this._dragging
      || this._editModalOpen   // Editing in the card editor: block external redraws, otherwise an invalid tid saves content to the wrong card (C1)
      || this._promptBar);     // Rename / add-lane prompt bar open: a reload would empty the content and wipe it mid-edit
  }
  consumePendingReload() {
    if (!this._pendingReload || this.isBusy()) return;
    this._pendingReload = false;
    (this._persistChain || Promise.resolve()).then(() => this.render());   // Wait for write queue to clear before reloading to prevent overwrites
  }

  // Re-entrancy lock for render: modification storms, undo operations, and interleaved awaits won't trigger overlapping redraws
  async render() {
    if (this._rendering) { this._renderAgain = true; return; }
    this._rendering = true;
    try { await this._doRender(); this._playViewSwap(); }
    finally {
      this._rendering = false;
      if (this._renderAgain) { this._renderAgain = false; await this.render(); }
    }
  }
  recentlyDragged() { return Date.now() - (this._lastDragEnd || 0) < 250; }   // Guard against simulated click events emitted after dragging/dropping
  // Board⇄table swap animation: the snapshot of the old view (captured in setView) slides up and out while the freshly-rendered view rises from below — like two panels being shuffled. Only runs when setView armed it (not on ordinary redraws).
  _playViewSwap() {
    if (!this._viewSnapHTML) return;
    const root = this.contentEl;
    const snap = root.createDiv({ cls: 'tugtile-viewsnap' });
    snap.innerHTML = this._viewSnapHTML;
    this._viewSnapHTML = null;
    root.addClass('tugtile--switching');
    const cleanup = () => { if (snap.isConnected) snap.remove(); root.removeClass('tugtile--switching'); };
    snap.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 500);   // Fallback in case animationend doesn't fire
  }
  async _doRender() {
    this.closePopup();           // Dismiss date/time dropdown before redraw to prevent orphaned popups
    this._archiveBar = null;     // Dereference old bar since root.empty() destroys it (L2, not rebuilt in table view)
    this._expandedEl = null;     // Reset accordion tracker since redraw detaches old nodes (releases old DOM references)
    this.destroySortables();
    if (this._renderChild) { this.removeChild(this._renderChild); this._renderChild = null; }
    const root = this.contentEl;
    // Preserve scroll across a re-render (e.g. returning from the editor) instead of snapping back to the first tile
    const prevBoard = root.querySelector('.tugtile__board');
    const scrollSnap = prevBoard ? { left: prevBoard.scrollLeft, lanes: Array.from(prevBoard.querySelectorAll('.tugtile__list')).map((l) => l.scrollTop) } : null;
    root.empty();
    root.addClass('tugtile');
    if (!this.filePath) { root.createDiv({ cls: 'tugtile__empty', text: t('emptyNoFile') }); return; }
    this._buildSearchBar(root);   // top-of-content search strip (first child; hidden unless .tugtile--searching), rebuilt each render
    root.toggleClass('tugtile--searching', !!this._searchOpen);
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) { root.createDiv({ cls: 'tugtile__empty', text: t('fileNotFound', this.filePath) }); return; }

    const text = await this.app.vault.read(file);
    this._loadedText = text;       // Cache the loaded disk content to compare before saving, preventing accidental overwrites of external modifications
    this.model = parseFile(text);
    const S = this.plugin.settings || DEFAULT_SETTINGS;
    const bs = this.model.settings || {};
    // Show card checkboxes: follow board settings if explicitly configured; otherwise, default to false, unless a **Complete** lane is present (which indicates an active completion workflow).
    // Rationale: obsidian-kanban format marks every card with `- [ ]` (tasks), so all cards naturally have markers. Displaying checkboxes on content/sorting-only boards is visual noise and conflicts with completion workflows.
    // Global showCheckboxes can still be enabled by the user to force them. If checkboxes are hidden, markers are preserved in files, ensuring compatibility.
    const hasCompleteLane = (this.model.columns || []).some((c) => (c.lead || []).join('\n').indexOf('**Complete**') !== -1);
    this.showCheckbox = (bs['show-checkboxes'] !== undefined) ? (bs['show-checkboxes'] !== false) : (!!S.showCheckboxes || hasCompleteLane);
    // Hide card counts: board setting takes precedence, falls back to global setting
    const hideCounts = (bs['hide-card-count'] === undefined) ? !!S.hideCounts : !!bs['hide-card-count'];
    root.toggleClass('tugtile--hide-counts', hideCounts);
    // Size presets as CSS vars on the root (inherited by both board lanes and table rows, so they work in either view)
    root.style.setProperty('--tugtile-lane-width', (LANE_WIDTHS[S.laneWidth] || LANE_WIDTHS.medium) + 'px');
    root.style.setProperty('--tugtile-row-pad', (TABLE_PADS[S.tableDensity] || TABLE_PADS.medium) + 'px');
    // Date/time configurations (board settings take precedence)
    this.dateTrigger = bs['date-trigger'] || '@';
    this.timeTrigger = bs['time-trigger'] || '@@';
    this.dateFormat = bs['date-format'] || 'YYYY-MM-DD';                          // The date format stored in markdown (for insertion and parsing)
    this.dateDisplayFormat = bs['date-display-format'] || this.dateFormat;        // Date format displayed on the card UI
    this.timeFormat = bs['time-format'] || 'HH:mm';
    this.linkDateToDaily = !!bs['link-date-to-daily-note'];   // Write dates as @[[..]] to link them to daily notes
    this.showRelativeDate = (bs['show-relative-date'] === undefined) ? !!S.showRelativeDate : !!bs['show-relative-date'];
    // Tag configurations (reads color values from kanban-compatible tag-colors; can be moved to footer; click action)
    this.tagColors = {};
    if (Array.isArray(bs['tag-colors'])) bs['tag-colors'].forEach((c) => { if (c && c.tagKey) this.tagColors[c.tagKey] = c; });
    this.moveTagsToFooter = (bs['move-tags'] !== undefined) ? !!bs['move-tags'] : !!bs['move-tags-to-card-footer'];   // The kanban settings key is move-tags
    this.tagAction = bs['tag-action'] || 'board';                               // Default: click a tag to filter this board. Only 'obsidian' triggers a vault-wide search. Legacy value 'board' was 'kanban' (still accepted).
    // Archive settings
    this.archiveHeading = S.archiveHeading || 'Archive';
    this.archiveDateFormat = bs['archive-date-format'] || (this.dateFormat + ' ' + this.timeFormat);
    this.archiveDateSeparator = bs['archive-date-separator'] || '';
    this.appendArchiveDate = !!bs['append-archive-date'];
    this.viewMode = this.viewMode || bs['tugtile-view'] || 'board';
    if (this.viewMode !== 'table') this.viewMode = 'board';   // Only board/table are resting views. 'list' (→ responsive setting) and 'markdown' (→ raw editor button) are retired.
    root.toggleClass('tugtile--rwd', !!S.responsiveBoard);   // Responsive board: auto vertical stack on narrow panes (CSS container query), opt-in via settings (default off)
    this._locked = !!bs['tugtile-locked'];                    // Per-board read-only lock (persisted in board settings)
    root.toggleClass('tugtile--locked', this._locked);
    // Centered control (view-cycle · lock). Desktop/iPad: in the view header. Phone: a top-bar in the content,
    // since the narrow phone header swallows it under the action overflow.
    if (Platform.isPhone) { this._buildHeaderCtl(root.createDiv({ cls: 'tugtile__ctlbar' })); }
    else { this.decorateHeaderTitle(); this.refreshViewCycle(); this.refreshLock(); }
    // Behavior settings: each board can have a custom new-line-trigger (aligned with kanban), falls back to global setting (Enter to submit)
    this.enterSubmits = (bs['new-line-trigger'] !== undefined) ? (bs['new-line-trigger'] !== 'enter') : !!S.enterSubmits;
    const ins = bs['new-card-insertion-method'];   // Board setting takes precedence; prepend/prepend-compact = top, append = bottom
    this.prependNewCards = ins ? (ins === 'append' ? false : true) : !!S.prependNewCards;
    this.archiveWithDate = (bs['archive-with-date'] !== undefined) ? !!bs['archive-with-date'] : !!S.archiveWithDate;
    const cap = bs['max-archive-size'];   // Cap the number of archived cards; drop oldest beyond it. -1 / 0 / unset = unlimited.
    this.maxArchiveSize = (typeof cap === 'number') ? cap : (typeof S.maxArchiveSize === 'number' ? S.maxArchiveSize : -1);
    this.backupRetention = (typeof S.backupRetention === 'number') ? S.backupRetention : 20;   // global — how many backup snapshots to keep per board
    this.allTiles = [];           // Flattened array of cards, indexed by tid (stable across drags)
    this._renderChild = new Component();   // Component hosting markdown sub-resources for this render, unloads as a batch on redraw/close
    this.addChild(this._renderChild);

    // Search runs through a Modal (openSearch), not an inline bar — inline inputs misbehave on iPad. applySearch() below re-applies any active term after a redraw.
    if (this.viewMode === 'table') { this.renderTableView(root); this.applySearch(); return; }
    // Trello-style archive bar at the top: drop cards here to archive (revealed during drag)
    const bar = root.createDiv({ cls: 'tugtile__archivebar' });
    setIcon(bar.createSpan({ cls: 'tugtile__archivebar-i' }), 'archive');
    bar.createSpan({ text: t('dropToArchive') });
    this._archiveBar = bar;
    this._sortables.push(new Sortable(bar, {
      group: 'tugtile', sort: false,
      onAdd: (evt) => {
        const el = evt.item; const tile = this.allTiles[Number(el.dataset.tid)];
        if (tile) this.addToArchive(tile.raw, this._laneName(evt.from && evt.from.closest('.tugtile__lane')));   // evt.from = the lane the card was dragged out of
        el.remove();
        this.renumber();
        this.persist().then(() => this.toastUndo(t('archivedTile')));
      },
    }));
    // Board / List View (List View stacks lanes vertically via CSS, reusing all drag-and-drop and editing logic)
    const collapse = (this.model.settings && this.model.settings['list-collapse']) || [];
    const board = root.createDiv({ cls: 'tugtile__board' });
    board.addEventListener('click', (e) => { if (!e.target.closest('.tugtile__tile')) this.collapseExpanded(); });   // Click blank space to collapse expanded cards
    this.model.columns.forEach((col, i) => this.makeLane(board, col, !!collapse[i]));
    const addCol = board.createDiv({ cls: 'tugtile__addcol' });
    this.renderAddColButton(addCol);
    this.makeBoardSortable(board);
    if (scrollSnap) {   // Restore the pre-render scroll position (horizontal board + each lane's vertical)
      board.scrollLeft = scrollSnap.left;
      board.querySelectorAll('.tugtile__list').forEach((l, i) => { if (scrollSnap.lanes[i] != null) l.scrollTop = scrollSnap.lanes[i]; });
    }
    this.renumber();
    this.applySearch();   // Preserve active search terms after redraw
    if (this._reopenRaw) {   // Keep the newly saved card expanded to show changes
      const rt = this.allTiles.findIndex((t) => t && t.raw === this._reopenRaw);
      this._reopenRaw = null;
      if (rt >= 0) { const el = board.querySelector('.tugtile__tile[data-tid="' + rt + '"]'); if (el) this.expandCard(el); }
    }
    this.refreshFoldIcon();   // Re-render restores collapse from disk via makeLane (not setAll*), so sync the cycle icon to the live DOM (B1 class)
  }

  // Switch resting view (board / table) and save to settings key tugtile-view
  setView(mode) {
    if (mode === this.viewMode) return;
    this._viewSnapHTML = this.contentEl.innerHTML;   // Snapshot the outgoing view for the swap animation (_playViewSwap)
    this.viewMode = mode;
    this.refreshViewCycle();
    this.model.post = setSetting(this.model.post, 'tugtile-view', mode);
    this.persistModel().then(() => this.render());   // Save settings and reload view to keep model and disk in sync
  }
  // Whole-file save from the markdown editor modal: write the raw text, then re-render (re-parses the board model)
  async applyMarkdownEdit(text) {
    await this._write(text);
    this._loadedText = text;
    await this.render();
    new Notice(t('saved'));
  }
  // Table View: lists all cards with details (card text, lane, date, tags). Supports column sorting, row-based editing, and toggling checkboxes.
  renderTableView(root) {
    const wrap = root.createDiv({ cls: 'tugtile__table-wrap' });
    const table = wrap.createEl('table', { cls: 'tugtile__table' });
    const htr = table.createEl('thead').createEl('tr');
    [t('colTile'), t('colLane'), t('colDate'), t('colTags')].forEach((h, ci) => { const th = htr.createEl('th', { text: h }); th.onclick = () => this.sortTable(ci); });
    const tbody = table.createEl('tbody');
    this.model.columns.forEach((col, colIdx) => (col.tiles || []).forEach((tile, ti) => {
      const tid = this.allTiles.push(tile) - 1;
      const meta = extractMeta(tile.text, this.dateTrigger, this.timeTrigger);
      const tr = tbody.createEl('tr', { cls: 'tugtile__row' });
      tr.dataset.tid = String(tid); tr.dataset.col = String(colIdx); tr.dataset.ti = String(ti);
      const c1 = tr.createEl('td', { cls: 'tugtile__row-title' });
      if (this.showCheckbox) { const cb = c1.createEl('input', { type: 'checkbox' }); cb.checked = !!(tile.check && tile.check !== ' '); cb.onclick = (ev) => { ev.stopPropagation(); this.toggleCheckModel(colIdx, ti, cb); }; }
      const span = c1.createSpan({ cls: 'tugtile__row-text', text: tilePlainText(meta.clean.split('\n')[0] || '') });   // Render as plain text; styles are managed entirely by the application (prevents unparsed markdown from cluttering the table)
      c1.onclick = (ev) => { if (ev.target.closest('input, a')) return; this.editRow(tr, colIdx, ti); };
      tr.createEl('td', { cls: 'tugtile__row-lane', text: parseWip(col.title || '').title });
      const c3 = tr.createEl('td', { cls: 'tugtile__row-date' });
      if (meta.date) { const s = c3.createSpan({ text: this.formatDate(meta.date) }); const cls = this.dateClass(meta.date); if (cls) s.className = cls; }
      const c4 = tr.createEl('td', { cls: 'tugtile__row-tags' });
      extractTags(tile.text).forEach((t) => { const chip = c4.createSpan({ cls: 'tugtile__tag', text: t }); const c = this.tagColors[t]; if (c) { if (c.backgroundColor) chip.style.backgroundColor = c.backgroundColor; if (c.color) chip.style.color = c.color; } chip.onclick = (ev) => { ev.stopPropagation(); this.onTagClick(t); }; });
    }));
  }
  sortTable(ci) {
    const tbody = this.contentEl.querySelector('.tugtile__table tbody');
    if (!tbody) return;
    const dir = (this._tableSort && this._tableSort.ci === ci) ? -this._tableSort.dir : 1;
    this._tableSort = { ci, dir };
    const val = (tr) => {
      const t = this.allTiles[Number(tr.dataset.tid)] || {};
      if (ci === 1) return tr.querySelector('.tugtile__row-lane').textContent || '';
      if (ci === 2) return extractMeta(t.text || '', this.dateTrigger, this.timeTrigger).date || '￿';
      if (ci === 3) return extractTags(t.text || '')[0] || '￿';
      return (t.text || '').split('\n')[0];
    };
    Array.from(tbody.querySelectorAll('tr')).sort((a, b) => dir * val(a).localeCompare(val(b), 'zh-Hant')).forEach((tr) => tbody.appendChild(tr));
  }
  toggleCheckModel(col, ti, cb) {
    if (this._lockGuard()) { cb.checked = !cb.checked; return; }   // Revert the optimistic checkbox toggle when locked
    const tile = this.model.columns[col].tiles[ti];
    const now = /^- \[ \]/.test(tile.raw) ? 'x' : ' ';
    this.model.columns[col].tiles[ti] = { raw: tile.raw.replace(/^- \[.\]/, '- [' + now + ']'), text: tile.text, check: now, block: tile.block };
    cb.checked = (now === 'x');
    this.persistModel();
  }
  // Table row edit → the same full-screen modal as board cards (consistent, keyboard-safe, clear save/cancel). Table view has no lane DOM, so it saves via the model (persistModel), not the DOM-based persist().
  editRow(tr, col, ti) {
    if (this._lockGuard()) return;
    const tile = this.model.columns[col] && this.model.columns[col].tiles[ti];
    if (!tile) return;
    new TileEditModal(this.app, this, {
      text: tile.text,
      onSave: (v) => {
        const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
        this.model.columns[col].tiles[ti] = { raw: this.buildRaw(v, marker, tile.block), text: v, check: marker, block: tile.block };
        this.persistModel().then(() => this.render());
      },
    }).open();
  }

  // Drag-and-drop sorting for lanes (using lane header as handle, separate sortable group from cards; add lane button stays pinned to the end)
  makeBoardSortable(board) {
    this._sortables.push(new Sortable(board, {
      group: 'tugtile-lanes',
      draggable: '.tugtile__lane',
      handle: '.tugtile__lane-head',
      filter: '.tugtile__addcol',
      animation: 150,
      ...DRAG_TOUCH,   // lane drag now matches the tile: a still tap/long-press to rename isn't hijacked into a drag
      ghostClass: 'tugtile__lane--ghost',
      chosenClass: 'tugtile__lane--chosen',
      dragClass: 'tugtile__lane--drag',
      onMove: (evt) => !(evt.related && evt.related.classList.contains('tugtile__addcol')),  // Prevent lanes from being placed after the "Add Lane" button
      onStart: () => { this._dragging = true; this.closeOpenMenu(); this.startAutoScroll(); },
      onEnd: () => { this.stopAutoScroll(); this._lastDragEnd = Date.now(); this._dragging = false; this.persist(); this.consumePendingReload(); },
    }));
  }

  // Search via a Modal (iPad-safe; inline inputs misbehave there). ✓ applies, ✕ clears, and typing filters live (visible once the modal closes).
  // Search is an in-content bar (not a Modal): reveal the strip the view renders at its top, taking over the
  // control row. The bar is rebuilt every render (_buildSearchBar); here we just toggle visibility + focus.
  openSearch() {
    this._closePromptBar();   // mutual exclusion — never two text bars stacked (that re-opens the keyboard black gap)
    if (this._searchOpen) { this._focusSearch(); return; }   // already open (e.g. icon tapped again) → re-focus
    this._searchOpen = true;
    this.contentEl.addClass('tugtile--searching');
    this.freezeBoard();   // AFTER the bar takes its space, BEFORE the keyboard opens: pin the board height so the
                          // virtual keyboard can't collapse it into a black gap (same fix the old search Modal used)
    if (this._searchInp) this._searchInp.setText(this._searchTerm || '');
    this._focusSearch();
    this._armBarDismiss();
    this.refreshSearchIcon();
  }
  _focusSearch() { this._focusSelect(this._searchInp); }
  _focusSelect(inp) {
    if (!inp) return;
    setTimeout(() => {   // contenteditable has no .select(); focus then range-select its contents
      inp.focus();
      const r = document.createRange(); r.selectNodeContents(inp);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }, 0);
  }
  closeSearch(clear) {
    this._searchOpen = false;
    this.contentEl.removeClass('tugtile--searching');
    this.unfreezeBoard();   // release the pinned height so the board reflows back to normal
    const inp = this._searchInp;
    if (clear) { this._searchTerm = ''; if (inp) inp.setText(''); this.applySearch(); }   // ✕ / Escape: drop the filter
    if (inp) inp.blur();
    this.refreshSearchIcon();
  }
  // Shared row for every in-content text bar (search · rename · add-lane): the rounded field with an optional
  // leading icon, a plaintext-only contenteditable (dodges Obsidian's input chrome, CJK-safe), and ✕ / ✓ buttons.
  // The taps preventDefault to keep focus → the virtual keyboard stays open → single-tap action (editor pattern).
  // onFinish(true) = submit (✓ / Enter); onFinish(false) = cancel (✕ / Escape). Returns the input element.
  _buildPromptRow(container, opts) {
    const row = container.createDiv({ cls: 'tugtile-prompt-row' });
    const field = row.createDiv({ cls: 'tugtile-prompt-field' });
    if (opts.icon) setIcon(field.createSpan({ cls: 'tugtile-prompt-fieldicon' }), opts.icon);
    const inp = field.createDiv({ cls: 'tugtile-prompt-input', attr: { contenteditable: 'plaintext-only', role: opts.role || 'textbox', spellcheck: 'false' } });
    inp.setText(opts.value || '');
    if (opts.placeholder) inp.dataset.placeholder = opts.placeholder;
    if (opts.onInput) inp.addEventListener('input', () => opts.onInput(inp.textContent));
    const tap = (el, fn) => {
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
      el.addEventListener('click', fn);
    };
    const x = row.createEl('button', { cls: 'tugtile-iconbtn tugtile-prompt-x' }); setIcon(x.createSpan(), 'x'); x.setAttribute('aria-label', t('cancel'));
    const ok = row.createEl('button', { cls: 'tugtile-iconbtn tugtile-prompt-ok' }); setIcon(ok.createSpan(), 'check'); ok.setAttribute('aria-label', t('save'));
    tap(x, () => opts.onFinish(false));
    tap(ok, () => opts.onFinish(true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.isComposing || e.keyCode === 229)) { e.preventDefault(); opts.onFinish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); opts.onFinish(false); }
    });
    return inp;
  }
  // The in-content search bar. Rebuilt each render (root.empty destroys it), hidden until .tugtile--searching.
  _buildSearchBar(root) {
    const bar = root.createDiv({ cls: 'tugtile-searchbar' });
    this._searchInp = this._buildPromptRow(bar, {
      value: this._searchTerm || '', placeholder: t('searchPlaceholder'), icon: 'search', role: 'searchbox',
      onInput: (v) => { this._searchTerm = v; this.applySearch(); },
      onFinish: (save) => this.closeSearch(!save),   // ✓/Enter keep the filter; ✕/Escape clear it
    });
    return bar;
  }
  // Transient top prompt bar for rename / add-lane (replaces the old PromptModal). Same proven recipe as search —
  // a top strip + freezeBoard — so the iPad keyboard can't collapse the board into a black gap (the documented
  // reason these two were Modals). One-shot: built on demand, removed on finish; isBusy() blocks external reloads
  // while it's open so it can't be wiped mid-edit.
  _openPromptBar(opts) {
    if (this._searchOpen) this.closeSearch(false);   // mutual exclusion — keep any active filter, just drop the bar
    this._closePromptBar();
    const root = this.contentEl;
    const bar = root.createDiv({ cls: 'tugtile-promptbar' });
    root.prepend(bar);   // top of content (above the board / control strip)
    root.addClass('tugtile--prompting');
    this._promptBar = bar;
    const inp = this._buildPromptRow(bar, {
      value: opts.value || '', placeholder: opts.placeholder, icon: opts.icon || 'pencil',
      onFinish: (save) => { const v = inp.textContent; this._closePromptBar(); if (save && opts.onSubmit) opts.onSubmit(v); },
    });
    this.freezeBoard();
    this._focusSelect(inp);
    this._armBarDismiss();
  }
  _closePromptBar() {
    if (this._promptBar) { this._promptBar.remove(); this._promptBar = null; }
    this.contentEl.removeClass('tugtile--prompting');
    this.unfreezeBoard();
  }
  // Tap/click anywhere off an open text bar dismisses it (search keeps its filter; a rename/add-lane prompt is
  // cancelled — no submit). Registered once on first use (auto-removed on view unload). Capture phase so it runs
  // before the tapped element's own handler, which also guarantees one bar at a time (opening another closes this).
  _armBarDismiss() {
    if (this._barDismissArmed) return;
    this._barDismissArmed = true;
    this.registerDomEvent(document, 'pointerdown', (e) => this._maybeDismissBar(e), true);
  }
  _maybeDismissBar(e) {
    if (this._promptBar) { if (!this._promptBar.contains(e.target)) this._closePromptBar(); return; }
    if (this._searchOpen) {
      const bar = this.contentEl.querySelector('.tugtile-searchbar');
      if (bar && !bar.contains(e.target)) this.closeSearch(false);
    }
  }
  applySearch() {
    const term = (this._searchTerm || '').toLowerCase();
    this.contentEl.querySelectorAll('.tugtile__tile, .tugtile__row').forEach((el) => {   // Filters both cards and table rows
      const t = this.allTiles[Number(el.dataset.tid)];
      const hit = !term || (t && t.text.toLowerCase().indexOf(term) !== -1);
      el.style.display = hit ? '' : 'none';
    });
    this.refreshSearchIcon();
  }
  refreshSearchIcon() { if (this._searchActionEl) setIcon(this._searchActionEl, (this._searchTerm || '') ? 'filter' : 'search'); }   // Icon hints an active filter (no inline bar to show the term anymore)

  // Lane collapse/expand state (written back to settings key list-collapse)
  toggleCollapse(laneEl) {
    const now = laneEl.dataset.collapsed !== 'true';
    laneEl.dataset.collapsed = now ? 'true' : 'false';   // Data state is immediate (persist reads dataset.collapsed); only the visuals below are staged
    if (laneEl._collapseTimer) { clearTimeout(laneEl._collapseTimer); laneEl._collapseTimer = null; }
    const D1 = 260, D2 = 240;                            // Keep in sync with --tg-d1 / --tg-d2 in styles.css
    const reflow = () => laneEl.offsetWidth;             // Force a reflow so the next class change starts a fresh transition
    if (now) {
      // COLLAPSE — stage 1: narrow the lane and tuck the horizontal title into the chevron (head still a row)
      laneEl.classList.remove('tugtile__lane--grown');
      laneEl.classList.add('tugtile__lane--narrowing');
      laneEl._collapseTimer = setTimeout(() => {
        // stage 2: become the vertical strip, then grow the vertical title down out of the chevron
        laneEl.classList.add('tugtile__lane--collapsed');
        laneEl.classList.remove('tugtile__lane--narrowing');
        reflow();
        laneEl.classList.add('tugtile__lane--grown');
        laneEl._collapseTimer = null;
      }, D1);
    } else {
      // EXPAND — stage 1: retract the vertical title up into the chevron. A keyframe drives it (removing --grown
      // alone snaps instead of transitioning — it lacks the committed "from" state the grow path gets via reflow).
      laneEl.classList.remove('tugtile__lane--grown');
      laneEl.classList.add('tugtile__lane--retracting');
      laneEl._collapseTimer = setTimeout(() => {
        // stage 2: back to a row, widen the lane and grow the horizontal title back out
        laneEl.classList.remove('tugtile__lane--retracting');
        laneEl.classList.add('tugtile__lane--narrowing');
        laneEl.classList.remove('tugtile__lane--collapsed');
        reflow();
        laneEl.classList.remove('tugtile__lane--narrowing');
        laneEl._collapseTimer = null;
      }, D2);
    }
    this.persist();
    this.refreshFoldIcon();   // single-lane collapse changed the fold state → resync the cycle button (B1)
  }

  // Renders a lane (toggles collapse with chevron, supports clickable title renaming and deletion; renders cards via makeTileEl, appends card creator at the bottom)
  makeLane(board, col, collapsed) {
    const laneEl = board.createDiv({ cls: 'tugtile__lane' });
    laneEl.dataset.header = col.header || ('## ' + (col.title || ''));
    laneEl.dataset.lead = (col.lead || []).join('\n');   // Persist lane lead text with the lane data, preserved across file writes
    laneEl.dataset.collapsed = collapsed ? 'true' : 'false';
    if (collapsed) laneEl.addClasses(['tugtile__lane--collapsed', 'tugtile__lane--grown']);   // grown: vertical title shown at rest (no entry animation when rendering an already-collapsed lane)
    const head = laneEl.createDiv({ cls: 'tugtile__lane-head' });
    head.tabIndex = 0;   // focusable → Tab/Shift+Tab reaches the lane header (alongside cards) → keyboard lane reorder (←/→) + accessibility; mirrors the focusable card div (makeTileEl)
    head.addEventListener('keydown', (e) => {
      if (e.target !== head) return;   // only when the header bar itself is focused, not an input inside it (e.g. the inline rename field) — matches the card handler's e.target===tileEl guard
      if (e.isComposing || e.keyCode === 229) return;   // never hijack IME composition (parity with the card, editor, and card-submit guards)
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;   // only ←/→ reorder; leave Enter/etc. to fall through to any existing header behaviour. ↑/↓ are intentionally out of scope for now.
      e.preventDefault();
      if (this._lockGuard()) return;
      if (this._keyMoveLane(laneEl, e.key)) head.focus();   // keep focus on the lane header as it travels (DOM-direct move keeps this same node alive — no re-render)
    });
    const chevron = head.createSpan({ cls: 'tugtile__lane-chevron' });   // A button-sized hit target wrapping the glyph; only the inner glyph rotates on collapse (CSS), keeping the button still and easy to tap
    chevron.setAttribute('role', 'button');
    chevron.setAttribute('aria-label', t('collapseExpand'));
    setIcon(chevron.createSpan({ cls: 'tugtile__lane-chevron-glyph' }), 'chevron-down');   // Lucide icon (matches the rest of the UI); collapse rotates this glyph -90° via CSS to point right
    chevron.onclick = (e) => { if (this.recentlyDragged()) return; e.stopPropagation(); this.toggleCollapse(laneEl); };
    const wip = parseWip(col.title || '');
    laneEl.dataset.wip = wip.max == null ? '' : String(wip.max);   // Persist WIP limit with the lane data, restored during renaming
    const title = head.createSpan({ cls: 'tugtile__lane-title', text: wip.title });
    title.onclick = () => { if (this.recentlyDragged()) return; if (laneEl.dataset.collapsed === 'true') this.toggleCollapse(laneEl); else this.startRenameColumn(laneEl, title); };
    const titleV = head.createSpan({ cls: 'tugtile__lane-title-v', text: wip.title });   // Vertical clone shown only in the collapsed strip (kept in sync on rename)
    titleV.setAttribute('aria-hidden', 'true');
    titleV.onclick = () => { if (this.recentlyDragged()) return; this.toggleCollapse(laneEl); };
    head.createSpan({ cls: 'tugtile__lane-count', text: '0' });
    const more = head.createSpan({ cls: 'tugtile__lane-more' });
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', t('laneActionsAria'));
    more.onclick = (e) => { if (this.recentlyDragged()) return; e.stopPropagation(); this.openLaneMenu(e, laneEl); };
    // The lane delete button (✕) has been moved to the more actions menu (⋯)
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.openLaneMenu(e, laneEl); });
    const list = laneEl.createDiv({ cls: 'tugtile__list' });
    (col.tiles || []).forEach((tile) => this.makeTileEl(list, tile));
    this.makeSortable(list);
    const footer = laneEl.createDiv({ cls: 'tugtile__add' });
    this.renderAddButton(footer, list);
    return laneEl;
  }

  makeSortable(list) {
    this._sortables.push(new Sortable(list, {
      group: 'tugtile',
      disabled: !!this._locked,   // No drag-and-drop while the board is locked
      animation: 150,
      ...DRAG_TOUCH,   // shared touch tuning (see DRAG_TOUCH) — long-press + tremor tolerance, identical to the lanes
      scroll: false,
      ghostClass: 'tugtile__tile--ghost',
      chosenClass: 'tugtile__tile--chosen',
      dragClass: 'tugtile__tile--drag',
      onStart: () => { this._dragging = true; this.closeOpenMenu(); if (this._archiveBar) this._archiveBar.style.display = 'flex'; this.startAutoScroll(); },
      onEnd: (evt) => {
        this.stopAutoScroll(); this._lastDragEnd = Date.now(); this._dragging = false;
        if (this._archiveBar) this._archiveBar.style.display = 'none';
        if (evt && evt.to === this._archiveBar) { this.consumePendingReload(); return; }   // Card archiving is already handled by bar.onAdd, do not duplicate (L1)
        this.applyCompleteLane(evt && evt.item, evt && evt.from, evt && evt.to);   // Bi-directional completion lane logic: checking on drag-in, unchecking on drag-out
        this.persist(); this.consumePendingReload();
      },
    }));
  }
  // Header action icon reflecting the active view, so the toolbar button mirrors what is currently shown
  viewIcon() { return ({ board: 'gallery-vertical', table: 'table' })[this.viewMode] || 'gallery-vertical'; }
  // Invariant: tiles can't be expanded while lanes are collapsed — so when lanes are collapsed, everything is shut.
  _foldState() {   // read the LIVE DOM (reflects manual single-lane/tile ops), then the pure foldStateFrom decides 0/1/2
    const lanes = this.contentEl.querySelectorAll('.tugtile__lane');
    const allLanesCollapsed = lanes.length > 0 && Array.from(lanes).every((l) => l.dataset.collapsed === 'true');
    const longs = Array.from(this.contentEl.querySelectorAll('.tugtile__tile')).filter((el) => el.dataset.long === 'true');
    return foldStateFrom(allLanesCollapsed, longs.every((t) => !t.classList.contains('tugtile__tile--folded')));
  }
  refreshFoldIcon() {
    if (!this._foldAllEl) return;
    const next = nextFold(this._foldState());   // icon + label = the action the NEXT click performs (matches toggleFoldAll)
    setIcon(this._foldAllEl, FOLD_ICONS[next]);
    this._foldAllEl.setAttribute('aria-label', [t('expandLanesAction'), t('expandAllAction'), t('collapseAllAction')][next]);
  }
  // Sets every long tile's fold state (DOM + tracker + icon)
  setAllCardsExpanded(expanded) {
    this._cardsExpanded = expanded;
    this._expandedEl = null;   // Reset accordion tracker since redraw detaches old nodes (releases old DOM references)
    this.contentEl.querySelectorAll('.tugtile__tile').forEach((el) => {
      if (el.dataset.long !== 'true') return;
      el.classList.toggle('tugtile__tile--folded', !expanded);
    });
    this.refreshFoldIcon();
  }
  // Sets every lane's collapse state (DOM + tracker + icon), without persisting — callers decide when to save.
  // Snaps straight to the resting state (the lane width still transitions); the two-stage choreography is for
  // single-lane toggles, where animating 7 lanes at once would just be noisy.
  setAllLanesCollapsed(collapsed) {
    this._lanesCollapsed = collapsed;
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((el) => {
      if (el._collapseTimer) { clearTimeout(el._collapseTimer); el._collapseTimer = null; }   // Cancel any in-flight single-lane animation
      el.dataset.collapsed = collapsed ? 'true' : 'false';
      el.classList.remove('tugtile__lane--narrowing');
      el.classList.toggle('tugtile__lane--collapsed', collapsed);
      el.classList.toggle('tugtile__lane--grown', collapsed);   // grown must track collapsed, or the vertical title stays at scaleY(0) (invisible)
    });
    this.refreshFoldIcon();
  }
  // One-click: expand/collapse all long cards. Containment dependency (Lane ▷ Tile, expand half): a tile body is only visible while its lane is open, so expanding tiles first opens any collapsed lanes.
  // Animates a tile's height from a previously measured value to its current (post-swap) height
  _animateHeight(el, fromH) {
    const toH = el.getBoundingClientRect().height;
    if (Math.abs(fromH - toH) < 1) return;
    el.style.overflow = 'hidden';
    el.style.willChange = 'height';   // Hint the compositor before the animating frames start
    el.style.height = fromH + 'px';
    void el.offsetHeight;   // Force reflow so the starting height is committed before the transition runs
    el.style.transition = 'height 0.3s cubic-bezier(.4, 0, .2, 1)';
    el.style.height = toH + 'px';
    let cleaned = false;
    // Only react to THIS element's own height transition. transitionend bubbles from descendants too (tags,
    // rendered markdown), and a child firing first used to snap the height mid-animation — the "stutter" on
    // content-heavy tiles. A timeout backstops the case where transitionend never arrives.
    const done = (e) => {
      if (e && (e.target !== el || e.propertyName !== 'height')) return;
      if (cleaned) return; cleaned = true;
      el.style.height = ''; el.style.overflow = ''; el.style.transition = ''; el.style.willChange = ''; el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
    setTimeout(done, 360);
  }
  // One-click: collapse/expand all lanes. Containment dependency (collapse half): collapsing a lane hides every tile inside it, so "collapse all lanes" (><) genuinely shuts everything — it collapses all tiles too. (Expanding lanes only reveals the tiles, still collapsed; re-expand them with the tile button.)
  // Header buttons (replace the old per-axis toggles): expand EVERYTHING (lanes + tiles) / collapse EVERYTHING.
  expandAll() {
    this.setAllLanesCollapsed(false);   // unconditional — was gated behind a stale flag, so it no-op'd after manual lane collapse (B1)
    const longs = Array.from(this.contentEl.querySelectorAll('.tugtile__tile')).filter((el) => el.dataset.long === 'true' && el.offsetParent !== null);
    const before = longs.map((el) => el.getBoundingClientRect().height);   // FLIP height animation: measure → set → animate old→new
    this.setAllCardsExpanded(true);
    longs.forEach((el, i) => this._animateHeight(el, before[i]));
    this.persist();
  }
  collapseAll() {
    this.setAllLanesCollapsed(true);   // collapsing lanes hides the tiles, so no tile animation needed
    this.setAllCardsExpanded(false);
    this.persist();
  }
  toggleFoldAll() {   // 3-state cycle: lanes-only (maximize-2) → all-open (expand) → all-collapsed (shrink) → …
    this._applyFoldState(nextFold(this._foldState()));
  }
  _applyFoldState(s) {
    if (s === 1) return this.expandAll();    // all open (keeps the FLIP tile animation)
    if (s === 2) return this.collapseAll();  // all collapsed
    this.setAllLanesCollapsed(false);   // s === 0: lanes open, tiles stay folded. Unconditional — _lanesCollapsed is
    this.setAllCardsExpanded(false);    // a stale memory flag after a fresh render restores collapse from disk (B1 class)
    this.persist();
  }
  isCompleteLane(laneEl) { return !!(laneEl && (laneEl.dataset.lead || '').indexOf('**Complete**') !== -1); }
  setTileCheck(tileEl, mark) {
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    if (!tile) return;
    const cur = /^- \[(.)\]/.exec(tile.raw);
    if (cur && cur[1] === mark) return;
    this.allTiles[tid] = { raw: tile.raw.replace(/^- \[.\]/, '- [' + mark + ']'), text: tile.text, check: mark, block: tile.block };
    const cb = tileEl.querySelector('.tugtile__check'); if (cb) cb.checked = (mark !== ' ');
  }
  // Bi-directional completion lane: dragging a card into a lane containing **Complete** checks the task; dragging it out to a non-complete lane unchecks it (consistent with kanban)
  applyCompleteLane(tileEl, fromList, toList) {
    if (!tileEl) return;
    const destComplete = toList && this.isCompleteLane(toList.closest('.tugtile__lane'));
    const srcComplete = fromList && this.isCompleteLane(fromList.closest('.tugtile__lane'));
    if (destComplete && !srcComplete) this.setTileCheck(tileEl, 'x');
    else if (srcComplete && !destComplete) this.setTileCheck(tileEl, ' ');
  }

  // Prepends the sequence number (.tugtile__num) inside the first child element of the container, displaying it inline before the first line of text
  // (instead of as a floating indicator in the top-left corner). renumber() subsequently updates this element with the actual sequence number.
  prependTileNum(container) {
    if (!container) return null;
    const first = container.firstElementChild || container;
    const num = first.createSpan({ cls: 'tugtile__num', text: '0' });
    first.insertBefore(num, first.firstChild);   // Insert at the very beginning of the first line
    return num;
  }

  // Renders a card (checkbox, more menu ⋯, delete action, click-to-edit, context menu)
  makeTileEl(listEl, tile) {
    const tid = this.allTiles.push(tile) - 1;
    const tileEl = listEl.createDiv({ cls: 'tugtile__tile' });
    tileEl.dataset.tid = String(tid);
    tileEl.tabIndex = 0;   // focusable → keyboard card movement (arrows) + accessibility
    tileEl.addEventListener('keydown', (e) => {
      if (e.target !== tileEl) return;   // only when the card itself is focused, not an input/button inside it
      if (e.isComposing || e.keyCode === 229) return;   // never hijack IME composition: leave Enter/Arrows to candidate confirm/navigation (matches the same guard in the editor + card-submit handlers)
      // Bare-key card actions (full keyboard loop, no mouse). Safe to bind un-modified because the e.target===tileEl
      // check above guarantees focus is on the card div itself — never inside a textarea/input (where these letters must type normally).
      if (e.key === ' ') { e.preventDefault(); this.toggleCheck(tileEl); return; }   // Space toggles completion (same path as the checkbox onclick); preventDefault stops the page from scrolling
      if (e.key === 'a') { e.preventDefault(); this._keyActOnCard(tileEl, () => this.archiveTile(tileEl)); return; }   // 'a' = reversible Archive (the codebase deliberately prefers Archive over Delete; this is the gentler default)
      if (e.key === 'd' || e.key === 'Backspace') { e.preventDefault(); this._keyActOnCard(tileEl, () => this.deleteTile(tileEl)); return; }   // 'd'/Backspace = Delete (still reversible via the undo toast deleteTile shows)
      if (e.key === 'Enter') { e.preventDefault(); this.startEditTile(tileEl); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      if (this._lockGuard()) return;
      if (this._keyMoveCard(tileEl, e.key)) tileEl.focus();   // keep focus on the card as it travels
    });
    // Sequence numbers are no longer floating indicators in the top-left; they are now prepended inline to the card text (see prependTileNum below) to flow with the first line.
    // Controls in the top-right (checkbox/⋯) are contained within a small floating container to allow text wrap, aligning card content to the top and removing empty space.
    const ctrls = tileEl.createDiv({ cls: 'tugtile__tile-ctrls' });
    if (this.showCheckbox) {
      const cb = ctrls.createEl('input', { cls: 'tugtile__check', type: 'checkbox' });
      cb.checked = !!(tile.check && tile.check !== ' ');
      cb.onclick = (e) => { e.stopPropagation(); this.toggleCheck(tileEl); };
    }
    const more = ctrls.createSpan({ cls: 'tugtile__tile-more' });
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', t('tileActionsAria'));
    more.onclick = (e) => { e.stopPropagation(); this.openTileMenu(e, tileEl); };
    // Deletion is no longer a persistent button on the card (moved to more menu ⋯) to encourage reversible "Archiving" over permanent "Deletion"
    const meta = extractMeta(tile.text, this.dateTrigger, this.timeTrigger);
    const body = tileEl.createDiv({ cls: 'tugtile__tile-body' });
    MarkdownRenderer.render(this.app, meta.clean, body, this.filePath, this._renderChild);   // Renders full markdown body (extracted metadata has been removed from clean)
    if (this.moveTagsToFooter) this.moveTagsToFooterDom(tileEl, body);   // Extract a.tag elements from the rendered DOM (retains native links/inline code integrity)
    else this.styleTags(body);
    this.prependTileNum(body);   // Prepend sequence number inline to the first line of the body
    // Long cards: when collapsed, only display the first non-empty line as the title (processed in JS instead of CSS clipping to avoid padding issues)
    // Use displayWidth (visual columns) rather than .length (code units) so the 60-column budget is consistent
    // across scripts: 60 latin chars = width 60 (identical to the previous behaviour), while ~30 CJK chars also
    // reach width 60 — i.e. cards collapse at the same *visual* length regardless of language. Threshold stays
    // at 60 (in display-width units), NOT doubled.
    const isLong = meta.clean.indexOf('\n') !== -1 || displayWidth(meta.clean) > 60;
    tileEl.dataset.long = isLong ? 'true' : 'false';
    if (isLong) {
      const firstLine = (meta.clean.split('\n').find((l) => l.trim() !== '') || meta.clean).trim();
      const titleEl = tileEl.createDiv({ cls: 'tugtile__tile-title' });
      MarkdownRenderer.render(this.app, firstLine, titleEl, this.filePath, this._renderChild);
      this.styleTags(titleEl);
      this.prependTileNum(titleEl);   // Prepends the sequence number to the title line when collapsed
      if (!this._cardsExpanded) tileEl.addClass('tugtile__tile--folded');
    }
    if (meta.date || meta.time) this.renderDateChip(tileEl, meta);
    // Click behavior: expands collapsed long cards (accordion style); opens modal editor for short or already expanded cards
    tileEl.addEventListener('click', (e) => {
      if (Date.now() - (this._lastDragEnd || 0) < 250) return;   // Prevent click misfires immediately after dragging/dropping
      if (e.target.closest('a, input, button, .tugtile__check, .tugtile__tile-more')) return;
      if (tileEl.dataset.long === 'true' && tileEl.classList.contains('tugtile__tile--folded')) { this.expandCard(tileEl); return; }
      this.startEditTile(tileEl);
    });
    tileEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.openTileMenu(e, tileEl); });
    return tileEl;
  }

  // Applies tag colors and click handlers to rendered .tag elements
  styleTags(container) {
    container.querySelectorAll('a.tag').forEach((el) => {
      const key = el.textContent.trim();
      const c = this.tagColors[key];
      if (c) { if (c.backgroundColor) el.style.backgroundColor = c.backgroundColor; if (c.color) el.style.color = c.color; }
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onTagClick(key); });
    });
  }
  onTagClick(tag) {
    if (this.tagAction === 'obsidian') {   // 'obsidian' = search the whole vault; anything else (board / legacy kanban / default) = filter this board
      try { const gs = this.app.internalPlugins.getEnabledPluginById('global-search'); if (gs) { gs.openGlobalSearch('tag:' + tag); return; } } catch (e) {}
    }
    // 'kanban' action or if global-search is disabled: filter the current board directly (the search-action icon flips to indicate the active filter)
    this._searchTerm = tag;
    this.applySearch();
  }
  // Moves rendered a.tag elements to the card footer (extracts from Obsidian's rendering, automatically excluding hash characters inside URLs or inline code)
  moveTagsToFooterDom(tileEl, body) {
    const tagEls = Array.from(body.querySelectorAll('a.tag'));
    if (!tagEls.length) return;
    const ft = tileEl.createDiv({ cls: 'tugtile__tags' });
    tagEls.forEach((a) => {
      const t = a.textContent.trim();
      const chip = ft.createSpan({ cls: 'tugtile__tag', text: t });
      const c = this.tagColors[t];
      if (c) { if (c.backgroundColor) chip.style.backgroundColor = c.backgroundColor; if (c.color) chip.style.color = c.color; }
      chip.onclick = (e) => { e.stopPropagation(); this.onTagClick(t); };
      a.remove();
    });
  }

  // Date/time chip at the card footer (hides raw tokens, displays formatted date, relative time, and applies color based on status)
  renderDateChip(tileEl, meta) {
    const chip = tileEl.createDiv({ cls: 'tugtile__date' });
    if (meta.date) {
      const cls = this.dateClass(meta.date);
      if (cls) chip.addClass(cls);
      let label = this.formatDate(meta.date);
      if (this.showRelativeDate) { const rel = this.relativeDate(meta.date); if (rel) label += t('relDateWrap', rel); }
      const dd = chip.createSpan({ cls: 'tugtile__date-d' });
      setIcon(dd.createSpan({ cls: 'tugtile__date-i' }), 'calendar');
      dd.createSpan({ text: label });
    }
    if (meta.time) { const dt = chip.createSpan({ cls: 'tugtile__date-t' }); setIcon(dt.createSpan({ cls: 'tugtile__date-i' }), 'clock'); dt.createSpan({ text: meta.time }); }
  }
  formatDate(s) {
    const p = parseDateStr(s, this.dateFormat);   // Parse using the board's configured date-format (no longer hardcoded to ISO)
    if (!p) return s;                              // Returns original string if parsing fails
    return formatDateTokens(p, this.dateDisplayFormat);
  }
  _dayDiff(s) {
    const p = parseDateStr(s, this.dateFormat);
    if (!p) return null;
    const d = new Date(p.y, p.mo - 1, p.d); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  relativeDate(s) {
    const diff = this._dayDiff(s);
    if (diff === null) return '';
    const map = { 0: t('today'), 1: t('tomorrow'), '-1': t('yesterday'), 2: t('dayAfterTomorrow'), '-2': t('dayBeforeYesterday') };
    if (map[diff] !== undefined) return map[diff];
    return diff > 0 ? t('daysLater', diff) : t('daysAgo', -diff);
  }
  dateClass(s) {
    const diff = this._dayDiff(s);
    if (diff === null) return 'tugtile__date--unknown';   // Date present but unparseable → neutral color (L3)
    if (diff < 0) return 'tugtile__date--overdue';   // Overdue
    if (diff === 0) return 'tugtile__date--today';    // Today (accent)
    if (diff <= 7) return 'tugtile__date--soon';      // Due soon (within 7 days)
    return 'tugtile__date--safe';                     // Safe (any valid date is colored)
  }

  // Attaches datepicker/timepicker listeners triggerable by typing @ or @@ in the textarea
  attachDatePicker(ta) {
    const dt = this.dateTrigger || '@', tt = this.timeTrigger || '@@';
    // Reads cursor location on insert, finding the last trigger character backwards (avoids using stale cursor position from the input event)
    const insert = (trig, token) => {
      const cur = ta.selectionStart;
      const idx = ta.value.slice(0, cur).lastIndexOf(trig);
      const start = idx === -1 ? cur : idx;
      ta.value = ta.value.slice(0, start) + token + ta.value.slice(cur);
      const np = start + token.length;
      ta.setSelectionRange(np, np); ta.focus();
    };
    ta.addEventListener('input', () => {
      const before = ta.value.slice(0, ta.selectionStart);
      const rect = ta.getBoundingClientRect();
      if (before.endsWith(tt)) this.showTimePopup(rect.left + 8, rect.bottom + 4, (t) => insert(tt, tt + '{' + t + '}'));
      else if (before.endsWith(dt)) this.showDatePopup(rect.left + 8, rect.bottom + 4, (val) => insert(dt, this.linkDateToDaily ? dt + '[[' + val + ']]' : dt + '{' + val + '}'));
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._popup) { e.preventDefault(); e.stopPropagation(); this.closePopup(); } }, true);
  }
  closePopup() {
    this._popupClosed = true;
    if (this._popup) { this._popup.remove(); this._popup = null; }
    if (this._popupOutside) { document.removeEventListener('mousedown', this._popupOutside, true); this._popupOutside = null; }
  }
  _popupAt(x, y, cls) {
    this.closePopup();
    this._popupClosed = false;
    const pop = document.body.createDiv({ cls: 'tugtile__popup' + (cls ? ' ' + cls : '') });
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
    pop.addEventListener('mousedown', (e) => e.preventDefault());   // Prevent selecting menu items from stealing focus from the textarea (avoids triggering blur and premature saving)
    this._popup = pop;
    // Click-outside dismissal: bound to this specific pop element (L2); calls stopPropagation on dismissal to prevent click events from passing through to the modal backdrop, which would close the editor (M3)
    setTimeout(() => {
      if (this._popup !== pop) return;
      this._popupOutside = (ev) => { if (!pop.contains(ev.target)) { ev.stopPropagation(); this.closePopup(); } };
      document.addEventListener('mousedown', this._popupOutside, true);
    }, 0);
    return pop;
  }
  // Clamps the popup position within the viewport boundary (called after measuring contents)
  _clampPopup() {
    const pop = this._popup; if (!pop) return;
    const r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
  }
  showDatePopup(x, y, onPick) {
    const pop = this._popupAt(x, y);
    const view = new Date(); view.setDate(1); view.setHours(0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const render = () => {
      pop.empty();
      const head = pop.createDiv({ cls: 'tugtile__popup-head' });
      const prev = head.createSpan({ cls: 'tugtile__popup-nav' }); setIcon(prev, 'chevron-left');
      head.createSpan({ text: t('yearMonth', view.getFullYear(), view.getMonth() + 1) });
      const next = head.createSpan({ cls: 'tugtile__popup-nav' }); setIcon(next, 'chevron-right');
      prev.onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
      next.onclick = () => { view.setMonth(view.getMonth() + 1); render(); };
      const grid = pop.createDiv({ cls: 'tugtile__popup-grid' });
      t('weekdays').forEach((w) => grid.createSpan({ cls: 'tugtile__popup-w', text: w }));
      const y0 = view.getFullYear(), m0 = view.getMonth();
      const startDow = new Date(y0, m0, 1).getDay();
      const days = new Date(y0, m0 + 1, 0).getDate();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let i = 0; i < startDow; i++) grid.createSpan();
      for (let d = 1; d <= days; d++) {
        const cell = grid.createSpan({ cls: 'tugtile__popup-d', text: String(d) });
        const dd = new Date(y0, m0, d);
        if (+dd === +today) cell.addClass('tugtile__popup-d--today');
        cell.onclick = () => { onPick(formatDateTokens({ y: y0, mo: m0 + 1, d: d }, this.dateFormat)); this.closePopup(); };   // Write back using the board's configured date-format to prevent inconsistent formatting within the same board
      }
    };
    render();
    this._clampPopup();
  }
  showTimePopup(x, y, onPick) {
    const pop = this._popupAt(x, y, 'tugtile__popup--time');
    for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) {
      const t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      pop.createDiv({ cls: 'tugtile__popup-t', text: t }).onclick = () => { onPick(t); this.closePopup(); };
    }
    this._clampPopup();
  }

  // More options ⋯ / Context menu: card actions menu
  openTileMenu(e, tileEl) {
    if (this._lockGuard()) return;
    if (this._dragging || this.recentlyDragged()) { if (e.preventDefault) e.preventDefault(); return; }   // Don't let a long-press menu fire during / right after a drag
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t('edit')).setIcon('pencil').onClick(() => this.startEditTile(tileEl)));
    menu.addItem((i) => i.setTitle(t('duplicateTile')).setIcon('copy').onClick(() => this.duplicateTile(tileEl)));
    menu.addItem((i) => i.setTitle(t('insertTileAbove')).setIcon('arrow-up').onClick(() => this.insertTileRelative(tileEl, true)));
    menu.addItem((i) => i.setTitle(t('insertTileBelow')).setIcon('arrow-down').onClick(() => this.insertTileRelative(tileEl, false)));
    const tile0 = this.allTiles[Number(tileEl.dataset.tid)];
    if (tile0 && tile0.text.indexOf('\n') !== -1) {
      menu.addItem((i) => i.setTitle(t('splitTileMenu')).setIcon('split').onClick(() => this.splitTile(tileEl)));
    }
    menu.addItem((i) => i.setTitle(t('archiveTileMenu')).setIcon('archive').onClick(() => this.archiveTile(tileEl)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('moveTileTop')).setIcon('arrow-up-to-line').onClick(() => this.moveTileEdge(tileEl, true)));
    menu.addItem((i) => i.setTitle(t('moveTileBottom')).setIcon('arrow-down-to-line').onClick(() => this.moveTileEdge(tileEl, false)));
    const lanes = Array.from(this.contentEl.querySelectorAll('.tugtile__lane'));
    const curLane = tileEl.closest('.tugtile__lane');
    const laneTitle = (lane) => (lane.dataset.header || '## ').slice(3).trim() || t('untitledLane');
    lanes.filter((l) => l !== curLane).forEach((lane) =>
      menu.addItem((i) => i.setTitle(t('moveToLane', laneTitle(lane))).setIcon('corner-down-right').onClick(() => this.moveTileToLane(tileEl, lane))));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('deleteTileMenu')).setIcon('trash').onClick(() => this.deleteTile(tileEl)));
    this._trackMenu(menu, e); menu.showAtMouseEvent(e);
  }
  // Track the currently-open context menu so a drag (onStart) can dismiss it
  _trackMenu(menu, e) {
    this.closeOpenMenu();
    this._openMenu = menu;
    const p0 = (e && e.touches && e.touches[0]) || e || {};
    const ox = p0.clientX || 0, oy = p0.clientY || 0;
    const onMove = (ev) => { if (ev.pointerType === 'mouse') return; const p = (ev.touches && ev.touches[0]) || ev; if (Math.abs((p.clientX || 0) - ox) > 12 || Math.abs((p.clientY || 0) - oy) > 12) this.closeOpenMenu(); };   // touch/pen drag-to-scroll dismisses the menu; mouse is EXEMPT (otherwise moving toward the popup, always >12px, closed it before you could reach it)
    this._menuMove = onMove;
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('touchmove', onMove, { capture: true, passive: true });
    menu.onHide(() => { if (this._openMenu === menu) this._openMenu = null; this._detachMenuMove(); });
  }
  _detachMenuMove() { if (this._menuMove) { document.removeEventListener('pointermove', this._menuMove, true); document.removeEventListener('touchmove', this._menuMove, true); this._menuMove = null; } }
  closeOpenMenu() { this._detachMenuMove(); if (this._openMenu) { this._openMenu.hide(); this._openMenu = null; } }

  // Duplicates card: inserts a copy of the card directly below the original
  duplicateTile(tileEl) {
    const tile = this.allTiles[Number(tileEl.dataset.tid)];
    const listEl = tileEl.closest('.tugtile__list');
    // Exclude blockId on copy (block IDs must be unique to prevent broken references for [[#^id]])
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const raw = tile.block ? this.buildRaw(tile.text, marker, null) : tile.raw;
    const newEl = this.makeTileEl(listEl, { raw, text: tile.text, check: tile.check, block: null });
    tileEl.after(newEl);
    this.persist();
    this.renumber();
  }

  // Inserts a card above/below a reference card (creates empty card → launches editor immediately; discarded only if the editor is cancelled untouched)
  insertTileRelative(tileEl, before) {
    const listEl = tileEl.closest('.tugtile__list');
    if (!listEl) return;
    const newEl = this.makeTileEl(listEl, { raw: this.buildRaw('', ' '), text: '', check: ' ' });
    if (before) tileEl.before(newEl); else tileEl.after(newEl);
    this.renumber();
    this.startEditTile(newEl, true);   // fresh: true (discarded only if cancelled untouched; pressing Save keeps it, blank or not)
  }

  // Splits multi-line card: converts each non-empty line into a separate single-line card (retaining original checkbox markers)
  splitTile(tileEl) {
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const lines = tile.text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
    if (lines.length < 2) { new Notice(t('splitNoNeed')); return; }
    const listEl = tileEl.closest('.tugtile__list');
    // Update the first line of the original card in-place (removes raw date tokens via extractMeta, clears previous metadata chip, and redraws)
    this.allTiles[tid] = { raw: this.buildRaw(lines[0], marker, tile.block), text: lines[0], check: marker, block: tile.block };   // Preserve blockId on the first line
    const body = tileEl.querySelector('.tugtile__tile-body');
    const oldChip = tileEl.querySelector('.tugtile__date'); if (oldChip) oldChip.remove();
    if (body) {
      const meta = extractMeta(lines[0], this.dateTrigger, this.timeTrigger);
      body.empty(); MarkdownRenderer.render(this.app, meta.clean, body, this.filePath, this._renderChild);
      if (meta.date || meta.time) this.renderDateChip(tileEl, meta);
    }
    // Subsequent lines are inserted behind sequentially
    let anchor = tileEl;
    for (let i = 1; i < lines.length; i++) {
      const el = this.makeTileEl(listEl, { raw: this.buildRaw(lines[i], marker), text: lines[i], check: marker, block: null });   // Subsequent split lines do not copy blockId (prevents duplicate block IDs)
      anchor.after(el); anchor = el;
    }
    this.persist();
    this.renumber();
    new Notice(t('splitDone', lines.length));
  }

  // Read a lane's display name (the title text, WIP count lives in a separate span) — the key for "restore to home".
  _laneName(laneEl) { const t = laneEl && laneEl.querySelector('.tugtile__lane-title'); return t ? t.textContent : ''; }
  // Tag an archived card's first line with where it came from: a %%tg-home:Lane%% comment (Obsidian hides it; we strip
  // it on restore/display). Inserted before any trailing ^blockId so the blockId stays at the line end.
  _tagHome(line0, lane) {
    const safe = homeKey(lane);
    if (!safe) return line0;
    const tok = ' %%tg-home:' + safe + '%%';
    const bm = /(\s+\^[A-Za-z0-9-]+)$/.exec(line0);
    return bm ? line0.slice(0, bm.index) + tok + bm[0] : line0 + tok;
  }
  // Appends a card's raw content to the archive section: formats timestamp based on kanban settings (format, separator, position), enforces size limit, and creates section with localized header if missing
  addToArchive(raw, homeLane) {
    let entry = raw;
    if (this.archiveWithDate) {
      const lines = raw.split('\n');
      const m = /^(- \[.\] )(.*)$/.exec(lines[0]);
      if (m) {
        const now = new Date();
        const stamp = formatDateTokens({ y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() }, this.archiveDateFormat);
        const parts = [stamp];
        if (this.archiveDateSeparator) parts.push(this.archiveDateSeparator);
        parts.push(m[2]);
        if (this.appendArchiveDate) parts.reverse();   // append-archive-date: places the timestamp after the card title
        lines[0] = m[1] + parts.join(' ');
        entry = lines.join('\n');
      }
    }
    if (homeLane) { const ls = entry.split('\n'); ls[0] = this._tagHome(ls[0], homeLane); entry = ls.join('\n'); }   // remember the home lane for restore
    this.model.archive = (this.model.archive && this.model.archive.trim())
      ? this.model.archive.replace(/\s+$/, '') + '\n' + entry
      : '***\n\n## ' + (this.archiveHeading || 'Archive') + '\n\n' + entry;
    this.enforceArchiveCap();
  }
  // Drop the oldest archived cards once the count exceeds max-archive-size (cards append newest-last, so we keep the
  // last N). A cap of -1, 0, or non-positive means unlimited — no trimming.
  enforceArchiveCap() {
    const cap = this.maxArchiveSize;
    if (!(typeof cap === 'number') || cap <= 0) return;
    const { prefix, cards } = this.splitArchive();
    if (cards.length <= cap) return;
    this.model.archive = this.rebuildArchive(prefix, cards.slice(cards.length - cap));   // keep the newest `cap` cards
  }
  // Archives a card: appends to archive and removes from board
  archiveTile(tileEl) {
    this.addToArchive(this.allTiles[Number(tileEl.dataset.tid)].raw, this._laneName(tileEl.closest('.tugtile__lane')));
    tileEl.remove();
    this.renumber();
    this.persist().then(() => this.toastUndo(t('archivedTile')));
  }

  // Moves card to the top/bottom of the lane
  moveTileEdge(tileEl, toTop) {
    const listEl = tileEl.closest('.tugtile__list');
    if (!listEl) return;
    if (toTop) listEl.prepend(tileEl); else listEl.appendChild(tileEl);
    this.persist();
    this.renumber();
  }

  // Moves card to another lane (appended to the bottom)
  moveTileToLane(tileEl, laneEl) {
    if (laneEl === tileEl.closest('.tugtile__lane')) return;
    const listEl = laneEl.querySelector('.tugtile__list');
    if (!listEl) return;
    listEl.appendChild(tileEl);
    this.persist();
    this.renumber();
  }
  // Keyboard card movement: ↑/↓ reorder within the lane, ←/→ hop to the adjacent lane (appended). Returns true if it moved.
  _keyMoveCard(tileEl, key) {
    const list = tileEl.closest('.tugtile__list'); const lane = tileEl.closest('.tugtile__lane');
    if (!list || !lane) return false;
    const isTile = (el) => el && el.classList && el.classList.contains('tugtile__tile');
    if (key === 'ArrowUp') { const prev = tileEl.previousElementSibling; if (!isTile(prev)) return false; list.insertBefore(tileEl, prev); }
    else if (key === 'ArrowDown') { const next = tileEl.nextElementSibling; if (!isTile(next)) return false; list.insertBefore(next, tileEl); }
    else {
      const lanes = Array.from(this.contentEl.querySelectorAll('.tugtile__lane'));
      const target = lanes[lanes.indexOf(lane) + (key === 'ArrowLeft' ? -1 : 1)];
      const tl = target && target.querySelector('.tugtile__list');
      if (!tl) return false;
      tl.appendChild(tileEl);
    }
    this.persist(); this.renumber();
    return true;
  }

  // Keyboard lane movement: ←/→ reorder the focused lane among the other lanes. Returns true if it moved.
  // This deliberately reuses the EXACT drag-reorder path — SortableJS physically relocates the .tugtile__lane node in
  // the board and its onEnd calls this.persist(); _doPersist then derives the new column order from the live DOM
  // (querySelectorAll('.tugtile__lane')). So a keyboard move is the same two steps: relocate the lane node, then
  // persist(). No parallel persistence path, and round-trip fidelity is whatever the drag already guarantees.
  _keyMoveLane(laneEl, key) {
    const isLane = (el) => el && el.classList && el.classList.contains('tugtile__lane');
    if (key === 'ArrowLeft') {
      const prev = laneEl.previousElementSibling;
      if (!isLane(prev)) return false;   // clamp: already the leftmost lane (prev is null or some non-lane node)
      laneEl.parentElement.insertBefore(laneEl, prev);
    } else {   // ArrowRight
      const next = laneEl.nextElementSibling;
      if (!isLane(next)) return false;   // clamp: already the rightmost lane (next is the .tugtile__addcol button, not a lane) — same boundary the drag's onMove guard enforces
      laneEl.parentElement.insertBefore(next, laneEl);
    }
    this.persist();   // identical to the drag onEnd persist — derives new lane order from the DOM
    return true;
  }

  // Runs a destructive keyboard action (archive/delete) on a focused card, then keeps the keyboard loop going by
  // moving focus to a sensible neighbour — otherwise focus falls back to <body> and the user has to grab the mouse
  // to pick another card. Resolve the next target BEFORE the action runs, because the action removes the card from the DOM.
  _keyActOnCard(tileEl, action) {
    if (this._lockGuard()) return;   // archive/delete are blocked while the board is locked, same as the menu paths
    const isTile = (el) => el && el.classList && el.classList.contains('tugtile__tile');
    // Prefer the next card, then the previous card, then the lane itself (lanes aren't focusable, so fall back to its add-card button) so the user lands somewhere useful in the same lane.
    let next = tileEl.nextElementSibling;
    if (!isTile(next)) next = tileEl.previousElementSibling;
    const lane = tileEl.closest('.tugtile__lane');
    const addBtn = lane && lane.querySelector('.tugtile__add-btn');
    action();
    if (isTile(next) && next.isConnected) next.focus();
    else if (addBtn && addBtn.isConnected) addBtn.focus();   // empty lane after the action → land on its "+ Add" button so the user can immediately add the next card
  }

  // Checkbox toggle: modifies the raw checkbox marker directly (preserving all other contents)
  toggleCheck(tileEl) {
    if (this._lockGuard()) return;
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    const cur = /^- \[(.)\]/.exec(tile.raw);
    const now = (cur && cur[1] !== ' ') ? ' ' : 'x';
    const raw = tile.raw.replace(/^- \[.\]/, '- [' + now + ']');
    this.allTiles[tid] = { raw, text: tile.text, check: now, block: tile.block };   // Preserve blockId (M1)
    const cb = tileEl.querySelector('.tugtile__check');
    if (cb) cb.checked = now !== ' ';
    this.persist();
  }

  buildRaw(text, marker, block) {
    // Indentation for wrapped lines follows vault settings (useTab defaults to true → tab; otherwise 4 spaces), aligning with kanban
    const useTab = !(this.app && this.app.vault.getConfig && this.app.vault.getConfig('useTab') === false);
    const indent = useTab ? '\t' : '    ';
    const lines = String(text).split('\n');
    let raw = '- [' + (marker || ' ') + '] ' + (lines[0] || '');
    if (block) raw += ' ^' + block;   // Append blockId back to the end of the first line (hidden from display, preserved in file to prevent broken links)
    for (let i = 1; i < lines.length; i++) raw += '\n' + indent + lines[i];
    return raw;
  }

  // ---- Card Creation ----
  renderAddButton(footer, listEl) {
    footer.empty();
    const btn = footer.createEl('button', { cls: 'tugtile__add-btn', text: t('addTileBtn') });
    btn.onclick = () => this.showAddInput(footer, listEl);
  }
  showAddInput(footer, listEl) {
    if (this._lockGuard()) return;
    // Always use the tile edit modal (supports multiline, bouncy scrolling, and proper virtual keyboard handling; pressing Save keeps the card even when blank, Cancel on an untouched card removes it). footer parameter is retained for compatibility.
    const el = this.makeTileEl(listEl, { raw: this.buildRaw('', ' '), text: '', check: ' ' });
    if (this.prependNewCards && el !== listEl.firstChild) listEl.insertBefore(el, listEl.firstChild);
    this.renumber();
    this.startEditTile(el, true);   // fresh: true (discarded only if cancelled untouched; pressing Save keeps it, blank or not)
  }
  // Host callback for the editor core (editor-core.js calls host.isSubmitKey): does this keydown commit the card?
  // Mobile: Enter always inserts a newline (commit via the ✓ button); desktop honours the enter-submits setting.
  isSubmitKey(e) {
    if ((e.isComposing || e.keyCode === 229) || e.key !== 'Enter') return false;
    if (Platform.isMobile) return false;
    return this.enterSubmits ? !e.shiftKey : (e.shiftKey || e.metaKey || e.ctrlKey);
  }
  // ---- Card Editing: Modal Focus (centered large card, darkened background, virtual keyboard pushes modal viewport, saves on close) ----
  startEditTile(tileEl, fresh) {
    if (this._lockGuard()) return;
    const tid = Number(tileEl.dataset.tid);
    if (!this.allTiles[tid]) return;
    const removeFresh = () => { if (fresh && tileEl.isConnected) { tileEl.remove(); this.renumber(); this.persist(); } };   // Discard a newly inserted empty placeholder card (M1)
    new TileEditModal(this.app, this, {
      text: this.allTiles[tid].text,
      onSave: (v) => this.applyTileEdit(tid, v),   // Save (✓) always commits — even an empty fresh card becomes a blank tile (tugtile lays out blank spacer tiles on purpose); changed-your-mind discard still runs via onDiscard (Cancel/Escape on an untouched fresh card)
      onDiscard: removeFresh,
    }).open();
  }
  // Save from modal to update card (updates model, writes file, redraws view)
  applyTileEdit(tid, v) {
    const tile = this.allTiles[tid]; if (!tile) { new Notice(t('editLost')); return; }   // Card no longer exists → notify user instead of silently failing (H1)
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const newRaw = this.buildRaw(v, marker, tile.block);
    this.allTiles[tid] = { raw: newRaw, text: v, check: marker, block: tile.block };
    this._reopenRaw = newRaw;   // Reopen this edited card expanded after redraw show changes immediately
    this.persist().then(() => this.render()).then(() => {
      if (this._lastPersistError) { const e = this._lastPersistError; new Notice(t('persistFailed', (e && e.message) || String(e))); }
      else new Notice(t('saved'));   // Explicit save confirmation (previously silent, which caused confusion)
    });
  }
  // Accordion expand: only one card expanded at a time; clicking another card or clicking outside collapses it.
  // The tile height snaps (one reflow, not a per-frame layout animation — that stutters on content-heavy tiles
  // on iOS); instead the revealed body slides + fades in via GPU transform/opacity (see tugtile-body-reveal).
  expandCard(tileEl) {
    const prev = this._expandedEl;
    if (prev && prev !== tileEl && prev.isConnected && prev.dataset.long === 'true') prev.addClass('tugtile__tile--folded');
    tileEl.removeClass('tugtile__tile--folded');
    tileEl.addClass('tugtile__tile--revealing');
    if (tileEl._revealT) clearTimeout(tileEl._revealT);
    tileEl._revealT = setTimeout(() => { tileEl.removeClass('tugtile__tile--revealing'); tileEl._revealT = null; }, 240);
    this._expandedEl = tileEl;
    this.refreshFoldIcon();   // a tile expanded → resync the cycle button (B1)
  }
  collapseExpanded() {
    const el = this._expandedEl;
    if (el && el.isConnected && el.dataset.long === 'true' && !this._cardsExpanded) el.addClass('tugtile__tile--folded');
    this._expandedEl = null;
    this.refreshFoldIcon();   // a tile collapsed → resync the cycle button (B1)
  }
  // Freezes board height when editing in modal → prevents layout reflows and flickering when virtual keyboard appears
  freezeBoard() {
    const board = this.contentEl.querySelector('.tugtile__board');
    if (board && !board.dataset.frozen) { board.dataset.frozen = '1'; board.style.height = board.offsetHeight + 'px'; }
  }
  unfreezeBoard() {
    const board = this.contentEl.querySelector('.tugtile__board');
    if (board && board.dataset.frozen) { delete board.dataset.frozen; board.style.height = ''; }
  }

  // ---- Card Deletion ----
  deleteTile(tileEl) {
    tileEl.remove();
    this.persist().then(() => this.toastUndo(t('deletedTile')));   // Show toast only after successful write, ensuring undo references the correct state
  }

  // ---- Lane: Creation / Renaming / Deletion ----
  renderAddColButton(addColEl) {
    addColEl.empty();
    const btn = addColEl.createEl('button', { cls: 'tugtile__addcol-btn', text: t('addLaneBtn') });
    btn.onclick = () => this.showAddColumn(addColEl);
  }
  showAddColumn(addColEl) {
    if (this._lockGuard()) return;
    const board = addColEl.parentElement;
    this._openPromptBar({ placeholder: t('addLanePlaceholder'), icon: 'plus', onSubmit: (val) => { const name = val.trim(); if (name) this.addColumn(board, name); this.consumePendingReload(); } });
  }
  addColumn(board, name) {
    const laneEl = this.makeLane(board, { header: '## ' + name, title: name, tiles: [] });
    const addColEl = board.querySelector('.tugtile__addcol');
    if (addColEl) board.insertBefore(laneEl, addColEl);
    this.persist();
    this.renumber();
  }
  startRenameColumn(laneEl, titleEl) {
    if (this._lockGuard()) return;
    const cur = titleEl.textContent;
    this._openPromptBar({ value: cur, placeholder: t('addLanePlaceholder'), icon: 'pencil', onSubmit: (val) => {
      const newTitle = (val.trim()) || cur;
      titleEl.textContent = newTitle;
      const tv = laneEl.querySelector('.tugtile__lane-title-v'); if (tv) tv.textContent = newTitle;   // Keep the vertical clone in sync
      if (newTitle !== cur) { const max = laneEl.dataset.wip; laneEl.dataset.header = '## ' + newTitle + (max ? ' (' + max + ')' : ''); this.persist(); }   // Retain WIP limit
      this.consumePendingReload();
    } });
  }
  // ---- Keyboard-command helpers (bound from addCommand so users can assign hotkeys) ----
  // The lane to act on for command-driven create/rename: the lane of the currently focused card, else the first lane.
  // Keyboard commands have no mouse position, so anchoring on focus (with a sensible first-lane fallback) is the predictable choice.
  _activeLane() {
    const focused = this.contentEl.querySelector('.tugtile__tile:focus');
    if (focused) { const lane = focused.closest('.tugtile__lane'); if (lane) return lane; }
    return this.contentEl.querySelector('.tugtile__lane');
  }
  // Command: add a card to the active lane, opening the exact same add-card modal the "+ Add" button uses.
  cmdNewCard() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const lane = this._activeLane(); if (!lane) return;
    const list = lane.querySelector('.tugtile__list');
    const footer = lane.querySelector('.tugtile__add');
    if (list && footer) this.showAddInput(footer, list);
  }
  // Command: add a new lane — same flow as the "+ Lane" button (opens the prompt bar to name it).
  cmdNewLane() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const addColEl = this.contentEl.querySelector('.tugtile__addcol');
    if (addColEl) this.showAddColumn(addColEl);
  }
  // Command: rename the active lane — same flow as clicking the lane title (opens the prompt bar pre-filled).
  cmdRenameLane() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const lane = this._activeLane(); if (!lane) return;
    const title = lane.querySelector('.tugtile__lane-title');
    if (title) this.startRenameColumn(lane, title);
  }
  deleteColumn(laneEl) {
    const n = laneEl.querySelectorAll('.tugtile__tile').length;
    if (n > 0 && typeof confirm === 'function' && !confirm(t('confirmDeleteLane', n))) return;
    laneEl.remove();
    this.persist().then(() => this.toastUndo(t('deletedLane')));
  }
  // Archives all completed cards on the board (checked tasks + cards in a Complete lane) — matches kanban "Archive completed cards" action
  archiveCompleted() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    let n = 0;
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const complete = (laneEl.dataset.lead || '').indexOf('**Complete**') !== -1;
      Array.from(laneEl.querySelectorAll('.tugtile__tile')).forEach((tileEl) => {
        const tile = this.allTiles[Number(tileEl.dataset.tid)];
        if (tile && (complete || /^- \[x\]/i.test(tile.raw))) { this.addToArchive(tile.raw); tileEl.remove(); n++; }
      });
    });
    if (n) { this.renumber(); this.persist().then(() => this.toastUndo(t('archivedCompleted', n))); }
    else new Notice(t('noCompleted'));
  }

  // Lane ⋯ / Context menu
  openLaneMenu(e, laneEl) {
    if (this._lockGuard()) return;
    if (this._dragging || this.recentlyDragged()) { if (e.preventDefault) e.preventDefault(); return; }
    const menu = new Menu();
    const titleEl = laneEl.querySelector('.tugtile__lane-title');
    menu.addItem((i) => i.setTitle(t('rename')).setIcon('pencil').onClick(() => { if (titleEl) this.startRenameColumn(laneEl, titleEl); }));
    menu.addItem((i) => i.setTitle(t('insertLaneBefore')).setIcon('arrow-left').onClick(() => this.insertColumn(laneEl, false)));
    menu.addItem((i) => i.setTitle(t('insertLaneAfter')).setIcon('arrow-right').onClick(() => this.insertColumn(laneEl, true)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('sortTitleAsc')).setIcon('arrow-down-narrow-wide').onClick(() => this.sortColumn(laneEl, 1, 'title')));   // A→Z: down arrow (reads top-to-bottom), narrow→wide
    menu.addItem((i) => i.setTitle(t('sortTitleDesc')).setIcon('arrow-up-wide-narrow').onClick(() => this.sortColumn(laneEl, -1, 'title')));
    menu.addItem((i) => i.setTitle(t('sortDate')).setIcon('calendar').onClick(() => this.sortColumn(laneEl, 1, 'date')));
    menu.addItem((i) => i.setTitle(t('sortTag')).setIcon('tag').onClick(() => this.sortColumn(laneEl, 1, 'tag')));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('markLaneComplete')).setIcon('check-check').onClick(() => this.markColumnComplete(laneEl)));
    menu.addItem((i) => i.setTitle(t('archiveLaneMenu')).setIcon('archive').onClick(() => this.archiveColumn(laneEl)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('deleteLaneMenu')).setIcon('trash').onClick(() => this.deleteColumn(laneEl)));
    this._trackMenu(menu, e); menu.showAtMouseEvent(e);
  }
  // Marks all cards in the lane as completed (- [ ] → - [x])
  markColumnComplete(laneEl) {
    laneEl.querySelectorAll('.tugtile__tile').forEach((tileEl) => {
      const tid = Number(tileEl.dataset.tid);
      const tile = this.allTiles[tid];
      if (/^- \[ \]/.test(tile.raw)) {
        this.allTiles[tid] = { raw: tile.raw.replace(/^- \[.\]/, '- [x]'), text: tile.text, check: 'x', block: tile.block };   // Preserve blockId (M1)
        const cb = tileEl.querySelector('.tugtile__check'); if (cb) cb.checked = true;
      }
    });
    this.persist();
  }
  // Archives all cards in the lane (adds to archive, leaving the lane empty)
  archiveColumn(laneEl) {
    const tiles = Array.from(laneEl.querySelectorAll('.tugtile__tile'));
    if (!tiles.length) return;
    if (typeof confirm === 'function' && !confirm(t('confirmArchiveLane', tiles.length))) return;
    tiles.forEach((tileEl) => { this.addToArchive(this.allTiles[Number(tileEl.dataset.tid)].raw); tileEl.remove(); });
    this.renumber();
    this.persist().then(() => this.toastUndo(t('archivedLane', tiles.length)));
  }
  // Sorts cards within the lane (key: title|date|tag; dir=1 asc / -1 desc; uses localeCompare for CJK support)
  sortColumn(laneEl, dir, key) {
    const list = laneEl.querySelector('.tugtile__list');
    if (!list) return;
    const val = (el) => {
      const t = this.allTiles[Number(el.dataset.tid)] || {};
      if (key === 'date') return extractMeta(t.text || '', this.dateTrigger, this.timeTrigger).date || '￿';   // Sort cards without dates to the bottom
      if (key === 'tag') return extractTags(t.text || '')[0] || '￿';
      return t.text || '';
    };
    const tiles = Array.from(list.querySelectorAll('.tugtile__tile'));
    tiles.sort((a, b) => dir * val(a).localeCompare(val(b), 'zh-Hant'));
    tiles.forEach((t) => list.appendChild(t));
    this.persist();
    this.renumber();
  }
  insertColumn(refLaneEl, after) {
    const board = refLaneEl.parentElement;
    const newName = t('newLane');
    const laneEl = this.makeLane(board, { header: '## ' + newName, title: newName, tiles: [] });
    board.insertBefore(laneEl, after ? refLaneEl.nextSibling : refLaneEl);
    this.persist();
    this.renumber();
    const t = laneEl.querySelector('.tugtile__lane-title');
    if (t) this.startRenameColumn(laneEl, t);
  }

  // ---- Archive View (View, restore, or permanently delete archived cards) ----
  splitArchive() {
    const lines = (this.model.archive || '').split('\n');
    const prefix = []; const cards = []; let cur = null;
    for (const ln of lines) {
      if (/^- \[.\]/.test(ln)) { if (cur) cards.push(cur); cur = [ln]; }
      else if (cur) cur.push(ln);
      else prefix.push(ln);
    }
    if (cur) cards.push(cur);
    const trim = (cl) => { const c = cl.slice(); while (c.length && c[c.length - 1].trim() === '') c.pop(); return c.join('\n'); };
    return { prefix: prefix.join('\n').replace(/\s+$/, ''), cards: cards.map(trim) };
  }
  rebuildArchive(prefix, cardRaws) {
    if (!cardRaws.length) return '';                 // Archive empty → clean up the entire archive section
    return (prefix ? prefix + '\n\n' : '***\n\n## ' + (this.archiveHeading || 'Archive') + '\n\n') + cardRaws.join('\n');
  }
  restoreArchived(index) {
    const { prefix, cards } = this.splitArchive();
    if (index < 0 || index >= cards.length) return;
    let raw = cards[index];   // Restore content as-is (timestamps added during archiving remain part of the restored text)
    const hm = /\s*%%tg-home:(.*?)%%/.exec(raw);   // recorded home lane (if any) → restore there; strip the token from the card
    const home = hm ? hm[1] : null;
    if (hm) raw = raw.replace(/\s*%%tg-home:.*?%%/, '');
    const cm = /^- \[(.)\]/.exec(raw);
    let targetList = null;
    if (home) { for (const lane of this.contentEl.querySelectorAll('.tugtile__lane')) { if (homeKey(this._laneName(lane)) === home) { targetList = lane.querySelector('.tugtile__list'); break; } } }
    if (!targetList) targetList = this.contentEl.querySelector('.tugtile__list');   // home gone / renamed / not recorded → first lane
    if (!targetList) { new Notice(t('noLaneToRestore')); return; }
    this.makeTileEl(targetList, { raw, text: tileRenderText(raw.split('\n')), check: cm ? cm[1] : ' ' });
    cards.splice(index, 1);
    this.model.archive = this.rebuildArchive(prefix, cards);
    this.persist();
    this.renumber();
  }
  deleteArchived(index) {
    const { prefix, cards } = this.splitArchive();
    if (index < 0 || index >= cards.length) return;
    cards.splice(index, 1);
    this.model.archive = this.rebuildArchive(prefix, cards);
    this.persist();
  }
  openArchiveView() {
    new ArchiveModal(this.app, this).open();
  }
  // ---- Backups (surface the silent _tugtile-backups snapshots so the safety net is visible + restorable) ----
  openBackupView() { new BackupModal(this.app, this).open(); }
  listBackups() {   // this board's backup files, newest first (timestamp is in the filename → lexicographic desc)
    const base = (this.filePath || '').split('/').pop().replace(/\.md$/, '');
    const folder = this.app.vault.getAbstractFileByPath('_tugtile-backups');
    if (!base || !folder || !folder.children) return [];
    return folder.children.filter((f) => isBackupOf(f.name, base)).sort((a, b) => (a.name < b.name ? 1 : -1));
  }
  openBackup(file) { this.app.workspace.getLeaf(true).openFile(file); }
  async restoreFromBackup(file) {
    const cur = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!cur) return;
    try {
      const content = await this.app.vault.read(file);
      this._backedUp = false; await this.backupOnce(cur);   // snapshot the CURRENT state first → restoring is itself reversible
      await this.app.vault.modify(cur, content);
      await this.render();
      new Notice(t('backupRestored'));
    } catch (e) { new Notice(t('backupRestoreFailed')); }
  }
  openBoardSettings() {
    new BoardSettingsModal(this.app, this).open();
  }

  renumber() {
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const tiles = laneEl.querySelectorAll('.tugtile__tile');
      tiles.forEach((tileEl, idx) => {
        // Both card body and collapsed title contain a sequence number; update both locations
        tileEl.querySelectorAll('.tugtile__num').forEach((num) => { num.textContent = String(idx + 1); });
      });
      const count = laneEl.querySelector('.tugtile__lane-count');
      if (count) {
        const max = laneEl.dataset.wip;
        if (max) {
          count.textContent = tiles.length + ' / ' + max;
          count.classList.toggle('tugtile__lane-count--over', tiles.length > Number(max));   // Over-limit indicator
        } else {
          count.textContent = String(tiles.length);
          count.classList.remove('tugtile__lane-count--over');
        }
      }
    });
  }

  async backupOnce(file) {
    if (this._backedUp) return;
    const folder = '_tugtile-backups';
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) {}
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = file.path.split('/').pop().replace(/\.md$/, '');
    const orig = await this.app.vault.read(file);
    await this.app.vault.create(folder + '/' + base + '-' + ts + '.md', orig);  // Do not catch exceptions here
    this._backedUp = true;   // Lock backup status only after successful file creation
    await this._pruneBackups();   // honour the user's version-history limit
  }
  // Keep only the newest N backups of THIS board (backupRetention; -1/unset = keep all); delete the oldest beyond the cap.
  async _pruneBackups() {
    const keep = this.backupRetention;
    if (typeof keep !== 'number' || keep < 0) return;
    const files = this.listBackups();   // newest first
    for (let i = keep; i < files.length; i++) { try { await this.app.vault.delete(files[i]); } catch (e) {} }
  }

  // Serialization: prevents overlapping write operations (avoids false-positive external modifications and desynchronization of undo/_loadedText)
  // Board View: rebuilds model from DOM and writes back (captures drag-and-drop and insertions/deletions)
  persist() {
    this._persistChain = (this._persistChain || Promise.resolve())
      .then(() => this._doPersist())
      .then(() => { this._lastPersistError = null; })
      .catch((e) => { this._lastPersistError = e; console.error('tugtile persist failed', e); });   // Do not swallow errors; record exception for callers to handle
    return this._persistChain;
  }
  async _doPersist() {
    const columns = [];
    const collapse = [];
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const header = laneEl.dataset.header || '## ';
      const lead = laneEl.dataset.lead ? laneEl.dataset.lead.split('\n') : [];
      const tiles = [];
      laneEl.querySelectorAll('.tugtile__tile').forEach((tileEl) => {
        tiles.push(this.allTiles[Number(tileEl.dataset.tid)]);
      });
      columns.push({ header, lead, tiles });
      collapse.push(laneEl.dataset.collapsed === 'true');
    });
    this.model.columns = columns;   // Synchronize model with DOM (ensures a reliable source for table/list views)
    this.model.post = setListCollapse(this.model.post, collapse);   // Save collapse states aligned with lane order (syncs automatically across reordering/modifications)
    await this._write(serializeFile({ pre: this.model.pre, columns, archive: this.model.archive, post: this.model.post, eol: this.model.eol }));
  }
  // Table/List View: serializes this.model directly (since there are no lane DOM elements to read, _doPersist cannot be used)
  persistModel() {
    this._persistChain = (this._persistChain || Promise.resolve())
      .then(() => this._write(serializeFile(this.model))).catch(() => {});
    return this._persistChain;
  }
  // One-way "upgrade to tugtile format": rewrites the file off obsidian-kanban markers (clean). Undoable. Button lives in board settings, only when kanban markers are present.
  async migrateToTugtileFormat() {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    let text; try { text = await this.app.vault.read(file); } catch (e) { return; }
    const out = migrateToTugtile(text);
    if (out === text) return;   // Already tugtile-native
    this._undo.push(text); if (this._undo.length > 50) this._undo.shift(); this._redo = []; this.updateUndoRedoActions();   // Make the upgrade undoable (↩ restores the kanban version)
    await this._write(out);
    await this.render();
    new Notice(t('migrateDone'));
  }
  // Shared file writer: handles concurrency protection, backups, undo stack, and updates _loadedText (reused by _doPersist and persistModel)
  async _write(out) {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    let prev = null;
    try { prev = await this.app.vault.read(file); } catch (e) {}
    if (prev !== null && this._loadedText != null && prev !== this._loadedText && prev !== out) {
      new Notice(t('externalModified'));
      await this.render();
      return;
    }
    try {
      await this.backupOnce(file);
    } catch (e) {
      new Notice(t('backupFailed'));
      return;
    }
    this._writing = true;
    try {
      await this.app.vault.modify(file, out);
      if (prev !== null && prev !== out) { this._undo.push(prev); if (this._undo.length > 50) this._undo.shift(); this._redo = []; this.updateUndoRedoActions(); }   // New action pushes an undo step and clears the redo branch
      this._loadedText = out;
      this.renumber();
    } catch (e) {
      new Notice(t('writeFailed', e.message));
    } finally {
      this._writing = false;
    }
  }

  // Restores the previous state (interventions for dragging, deleting cards/lanes, edits, or additions — which kanban doesn't support)
  async undo() { return this._timeTravel(this._undo, this._redo, t('undoVerb')); }
  async redo() { return this._timeTravel(this._redo, this._undo, t('redoVerb')); }
  async _timeTravel(fromStack, toStack, label) {
    if (this._lockGuard()) return;   // Undo/redo mutate content → blocked while locked
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    if (!fromStack.length) { new Notice(t('noStep', label)); return; }
    let cur = ''; try { cur = await this.app.vault.read(file); } catch (e) {}
    const target = fromStack.pop();
    if (cur !== '') toStack.push(cur);   // Push to opposite stack to allow navigating between undo and redo
    this._writing = true;
    try { await this.app.vault.modify(file, target); this._loadedText = target; }
    finally { this._writing = false; }
    await this.render();
    this.updateUndoRedoActions();
    new Notice(t('timeTraveled', label, this._undo.length, this._redo.length));
  }
  // Undo and redo are both always present; when their stack is empty the button is greyed out (tugtile-act-off) instead of hidden — a predictable, stable toolbar on desktop and mobile alike
  updateUndoRedoActions() {
    if (this._undoActionEl) this._undoActionEl.toggleClass('tugtile-act-off', this._undo.length === 0);
    if (this._redoActionEl) this._redoActionEl.toggleClass('tugtile-act-off', this._redo.length === 0);
  }
  // Shows a "toast with undo link" after destructive actions for quick recovery (natural on mobile devices)
  toastUndo(msg) {
    const n = new Notice(msg, 8000);
    const btn = n.noticeEl.createEl('a', { cls: 'tugtile-toast-undo', text: t('toastUndoBtn') });
    btn.onclick = (e) => { e.preventDefault(); n.hide(); this.undo(); };
  }
}

// Archive Modal: lists archived cards, allowing them to be restored (to the first lane) or permanently deleted
class ArchiveModal extends Modal {
  constructor(app, view) { super(app); this.view = view; }
  onOpen() { this.render(); }
  onClose() { if (this._comp) this._comp.unload(); this.contentEl.empty(); }
  render() {
    if (this._comp) this._comp.unload();
    this._comp = new Component(); this._comp.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('archiveTitle') });
    const { cards } = this.view.splitArchive();
    if (!cards.length) { contentEl.createDiv({ cls: 'tugtile__empty', text: t('archiveEmpty') }); return; }
    const list = contentEl.createDiv({ cls: 'tugtile-archive-list' });
    cards.forEach((raw, idx) => {
      const row = list.createDiv({ cls: 'tugtile-archive-row' });
      const body = row.createDiv({ cls: 'tugtile-archive-body' });
      MarkdownRenderer.render(this.app, tileRenderText(raw.split('\n')), body, this.view.filePath, this._comp);
      const actions = row.createDiv({ cls: 'tugtile-archive-actions' });
      actions.createEl('button', { text: t('restore') }).onclick = () => { this.view.restoreArchived(idx); this.render(); };
      const del = actions.createEl('button', { cls: 'mod-warning', text: t('deleteArchived') });
      del.onclick = () => { this.view.deleteArchived(idx); this.render(); };
    });
  }
}

// Human-readable timestamp from a backup filename (<board>-2026-06-14T02-30-00-000Z.md → 2026-06-14 02:30:00)
function backupWhen(name) {
  const m = /-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name || '');
  return m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6]) : name;
}
// True when `name` is a backup snapshot of the board whose file base-name is `base`. Anchors the ISO timestamp
// suffix (`-YYYY-MM-DDTHH-mm-ss-SSSZ.md`) so board "Plan" does NOT also match board "Plan-2"'s backups — a plain
// startsWith(base+'-') collision would let one board's prune/restore touch another board's snapshots (data loss).
function isBackupOf(name, base) {
  if (!name || !base) return false;
  if (!name.startsWith(base + '-')) return false;
  return /^-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/.test(name.slice(base.length));
}
// Backups Modal: lists this board's _tugtile-backups snapshots (newest first), with restore + open. Makes the
// silent safety net visible — and one tap reversible (restore backs up the current state before overwriting).
class BackupModal extends Modal {
  constructor(app, view) { super(app); this.view = view; }
  onOpen() { this.render(); }
  onClose() { this.contentEl.empty(); }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('backupTitle') });
    contentEl.createEl('p', { cls: 'setting-item-description', text: t('backupDesc') });
    const files = this.view.listBackups();
    if (!files.length) { contentEl.createDiv({ cls: 'tugtile__empty', text: t('backupEmpty') }); return; }
    const list = contentEl.createDiv({ cls: 'tugtile-archive-list' });
    files.forEach((f) => {
      const row = list.createDiv({ cls: 'tugtile-archive-row' });
      row.createDiv({ cls: 'tugtile-archive-body', text: backupWhen(f.name) });
      const actions = row.createDiv({ cls: 'tugtile-archive-actions' });
      actions.createEl('button', { text: t('backupOpen') }).onclick = () => { this.view.openBackup(f); this.close(); };
      actions.createEl('button', { cls: 'mod-warning', text: t('restore') }).onclick = () => {
        new ConfirmModal(this.app, { title: t('backupTitle'), message: t('backupRestoreConfirm'), confirmText: t('restore'), onConfirm: async () => { await this.view.restoreFromBackup(f); this.close(); } }).open();
      };
    });
  }
}

// Board-specific settings Modal: writes the board's %% tugtile:settings (and edits a legacy %% kanban:settings in place when present)
// Minimal confirm dialog (Obsidian has no built-in confirm). Runs onConfirm only when the user taps the confirm button.
class ConfirmModal extends Modal {
  constructor(app, opts) { super(app); this._opts = opts || {}; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('tugtile-prompt');
    if (this._opts.title) contentEl.createEl('h3', { text: this._opts.title });
    contentEl.createEl('p', { cls: 'setting-item-description', text: this._opts.message || '' });
    const row = contentEl.createDiv({ cls: 'tugtile-prompt-row' });
    row.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    row.createEl('button', { cls: 'mod-warning', text: this._opts.confirmText || t('confirm') }).onclick = () => { this._ok = true; this.close(); };
  }
  onClose() { this.contentEl.empty(); if (this._ok && this._opts.onConfirm) this._opts.onConfirm(); }
}

class BoardSettingsModal extends Modal {
  constructor(app, view) { super(app); this.view = view; this._dirty = false; }
  onOpen() { this.render(); }
  onClose() { this.contentEl.empty(); if (this._dirty) this.view.render(); }
  set(key, value) {
    this.view.model.post = setSetting(this.view.model.post, key, value);
    this.view.persistModel();
    this._dirty = true;
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('boardSettingsTitle') });
    contentEl.createEl('p', { cls: 'setting-item-description', text: t('boardSettingsDesc') });
    // "Upgrade to tugtile format" — shown only while the file still carries obsidian-kanban markers; one-way, clean (drops kanban-only settings)
    if (/kanban-plugin/.test(this.view.model.pre || '') || (this.view.model.post || '').indexOf('kanban:settings') !== -1) {
      new Setting(contentEl).setName(t('migrateBtn')).setDesc(t('migrateBtnDesc'))
        .addButton((b) => b.setButtonText(t('migrateBtn')).setCta().onClick(() => {
          new ConfirmModal(this.app, { title: t('migrateBtn'), message: t('migrateConfirm'), confirmText: t('migrateBtn'), onConfirm: () => { this.close(); this.view.migrateToTugtileFormat(); } }).open();
        }));
    }
    const bs = this.view.model.settings || {};
    const S = this.view.plugin.settings || DEFAULT_SETTINGS;
    const tog = (name, desc, key, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(bs[key] !== undefined ? !!bs[key] : !!dflt).onChange((v) => this.set(key, v)));
    const txt = (name, desc, key, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addText((tx) => { tx.setPlaceholder(String(dflt)); if (bs[key] !== undefined) tx.setValue(String(bs[key])); tx.onChange((v) => this.set(key, v)); });
    const dd = (name, desc, key, opts, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addDropdown((d) => { opts.forEach(([val, label]) => d.addOption(val, label)); d.setValue(bs[key] !== undefined ? String(bs[key]) : dflt); d.onChange((v) => this.set(key, v)); });

    tog(t('setShowCheckboxes'), '', 'show-checkboxes', S.showCheckboxes);
    tog(t('setHideCount'), '', 'hide-card-count', S.hideCounts);
    dd(t('setEnterBehavior'), t('setEnterBehaviorDesc'), 'new-line-trigger', [['shift-enter', t('optEnterSubmit')], ['enter', t('optEnterNewline')]], S.enterSubmits ? 'shift-enter' : 'enter');
    dd(t('setNewCardPos'), '', 'new-card-insertion-method', [['append', t('optAppend')], ['prepend', t('optPrepend')], ['prepend-compact', t('optPrependCompact')]], S.prependNewCards ? 'prepend' : 'append');
    tog(t('setRelativeDate'), t('setRelativeDateDesc'), 'show-relative-date', S.showRelativeDate);
    txt(t('setDateFormat'), t('setDateFormatDesc'), 'date-format', 'YYYY-MM-DD');
    txt(t('setDateDisplay'), t('setDateDisplayDesc'), 'date-display-format', bs['date-format'] || 'YYYY-MM-DD');
    txt(t('setDateTrigger'), t('setDateTriggerDesc'), 'date-trigger', '@');
    txt(t('setTimeTrigger'), t('setTimeTriggerDesc'), 'time-trigger', '@@');
    tog(t('setLinkDaily'), t('setLinkDailyDesc'), 'link-date-to-daily-note', false);
    dd(t('setTagAction'), t('setTagActionDesc'), 'tag-action', [['board', t('optFilterBoard')], ['obsidian', t('optSearchVault')]], 'board');   // Default 'board' = filter this board (matches runtime default)
    tog(t('setMoveTags'), '', 'move-tags', false);
    tog(t('setArchiveWithDate'), '', 'archive-with-date', S.archiveWithDate);
  }
}
module.exports = class TugtilePlugin extends Plugin {
  // Mobile: the bottom navbar's back/forward are dead inside a board (no in-board history), and its search is
  // vault-wide. While a tugtile board is the active view, take them over — back→undo, forward→redo,
  // search→in-board tile filter. Event-delegated in the capture phase so it survives the navbar being rebuilt,
  // identifies buttons by class/icon (not localized labels), and only fires inside a board (native elsewhere).
  patchMobileNav() {
    if (!Platform.isMobile) return;
    const handler = (e) => {
      const view = this.app.workspace.getActiveViewOfType(BoardView);
      if (!view) return;   // not in a board → leave the native navbar untouched
      const tgt = e.target;
      const action = (tgt && tgt.closest) ? tgt.closest('.mobile-navbar-action') : null;
      if (!action || !action.closest('.mobile-navbar')) return;
      let fn = null;
      // Identify by the navbar's chevron icons (not the desktop titlebar's mod-back/forward) OR our own marker
      // (once the icon is swapped to undo/redo the chevron class is gone, so the data-attr is the stable key).
      if (action.dataset.tugtileNav === 'undo' || action.classList.contains('mod-back') || action.querySelector('.lucide-chevron-left')) fn = () => view.undo();
      else if (action.dataset.tugtileNav === 'redo' || action.classList.contains('mod-forward') || action.querySelector('.lucide-chevron-right')) fn = () => view.redo();
      else if (action.querySelector('.lucide-search')) fn = () => view.openSearch();
      if (!fn) return;
      e.preventDefault(); e.stopImmediatePropagation();
      fn();
    };
    // Cover both: whichever event the native button fires on, a document-level capture listener runs first
    this.registerDomEvent(document, 'click', handler, true);
    this.registerDomEvent(document, 'touchend', handler, true);
    // Swap the chevron icons for undo/redo icons while a board is active, restore them when it isn't
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this._syncMobileNavIcons()));
    this.app.workspace.onLayoutReady(() => this._syncMobileNavIcons());
  }
  _navActions() {
    const navbar = document.querySelector('.mobile-navbar');
    if (!navbar) return null;
    let back = null, fwd = null;
    navbar.querySelectorAll('.mobile-navbar-action').forEach((a) => {
      if (a.dataset.tugtileNav === 'undo' || a.querySelector('.lucide-chevron-left')) back = a;
      else if (a.dataset.tugtileNav === 'redo' || a.querySelector('.lucide-chevron-right')) fwd = a;
    });
    return { back, fwd };
  }
  // Swap ONLY the svg's inner paths + viewBox, keeping the navbar's own <svg> element (its classes + sizing) —
  // replacing the whole svg via setIcon shifted the buttons out of position.
  _swapNavIcon(actionEl, name) {
    const old = actionEl.querySelector('svg');
    if (!old) { setIcon(actionEl, name); return; }
    const tmp = document.createElement('div'); setIcon(tmp, name);
    const neu = tmp.querySelector('svg');
    if (!neu) return;
    old.innerHTML = neu.innerHTML;
    const vb = neu.getAttribute('viewBox'); if (vb) old.setAttribute('viewBox', vb);
  }
  _syncMobileNavIcons() {
    if (!Platform.isMobile) return;
    const a = this._navActions(); if (!a) return;
    const inBoard = !!this.app.workspace.getActiveViewOfType(BoardView);
    const set = (el, onIcon, offIcon, marker) => {
      if (!el) return;
      if (inBoard) { if (el.dataset.tugtileNav !== marker) { this._swapNavIcon(el, onIcon); el.dataset.tugtileNav = marker; } }
      else if (el.dataset.tugtileNav === marker) { this._swapNavIcon(el, offIcon); delete el.dataset.tugtileNav; }
    };
    set(a.back, 'undo', 'chevron-left', 'undo');
    set(a.fwd, 'redo', 'chevron-right', 'redo');
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new TugtileSettingTab(this.app, this));
    // _mdOverride: maps "file path" to boolean, recording board files explicitly requested by the user to open in markdown view (stores overrides only, not VIEW_TYPE).
    // Uses file path as consistent key for setting (setMarkdownView), reading (patch), and clearing (setBoardView, detach) to prevent setting leakage across files.
    this._mdOverride = {};
    this.registerView(VIEW_TYPE, (leaf) => new BoardView(leaf, this));

    // Hook: monkeypatches setViewState to automatically open markdown files containing kanban-plugin frontmatter in the tugtile board view.
    // Safe unregistration: onunload sets _unloaded flag to bypass wrapper logic; wrapper transparently delegates execution, avoiding calls to unloaded plugin instances even if wrapped by other plugins.
    const self = this;
    this.register(aroundMethod(WorkspaceLeaf.prototype, 'setViewState', (next) => function (state, ...rest) {
      if (!self._unloaded && self._ready && state && state.type === 'markdown' && state.state && state.state.file &&
          self._mdOverride[state.state.file] !== true && self.isBoardFile(state.state.file)) {
        return next.apply(this, [{ ...state, type: VIEW_TYPE }, ...rest]);
      }
      return next.apply(this, [state, ...rest]);
    }));
    this.register(aroundMethod(WorkspaceLeaf.prototype, 'detach', (next) => function () {
      if (!self._unloaded) {
        const st = this.view && this.view.getState && this.view.getState();
        if (st && st.file) delete self._mdOverride[st.file];
      }
      return next.apply(this);
    }));
    // Markdown files already open at startup (which bypasses monkeypatch interception) → migrate to board view
    this.app.workspace.onLayoutReady(() => { this._ready = true; this.sweepBoardLeaves(); });
    // Override kanban: retrieves board files if hijacked by markdown view or obsidian-kanban (no ping-ponging: kanban only intercept markdown types, letting tugtile types pass through)
    this.registerEvent(this.app.workspace.on('layout-change', () => { if (this._ready) this.sweepBoardLeaves(); }));
    this.patchMobileNav();

    this.addCommand({
      id: 'toggle-view',
      name: t('cmdToggleView'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isBoardFile(file.path)) return false;
        if (!checking) {
          const bv = this.app.workspace.getActiveViewOfType(BoardView);
          if (bv) this.setMarkdownView(bv.leaf);
          else { const mv = this.app.workspace.getActiveViewOfType(MarkdownView); if (mv) this.setBoardView(mv.leaf); }
        }
        return true;
      },
    });
    this.addCommand({
      id: 'open-as-board',
      name: t('cmdOpenAsBoard'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openBoard(file.path);
        return true;
      },
    });
    this.addCommand({
      id: 'undo',
      name: t('cmdUndo'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.undo();
        return true;
      },
    });
    this.addCommand({
      id: 'redo',
      name: t('cmdRedo'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.redo();
        return true;
      },
    });
    this.addCommand({
      id: 'create-board',
      name: t('cmdCreateBoard'),
      callback: () => this.createBoard(),
    });
    this.addCommand({
      id: 'search',
      name: t('cmdSearch'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.openSearch();
        return true;
      },
    });
    this.addCommand({
      id: 'new-card',
      name: t('cmdNewCard'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdNewCard();
        return true;
      },
    });
    this.addCommand({
      id: 'new-lane',
      name: t('cmdNewLane'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdNewLane();
        return true;
      },
    });
    this.addCommand({
      id: 'rename-lane',
      name: t('cmdRenameLane'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdRenameLane();
        return true;
      },
    });
    this.addCommand({
      id: 'archive-completed',
      name: t('cmdArchiveCompleted'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.archiveCompleted();
        return true;
      },
    });
    this.addCommand({
      id: 'convert-to-board',
      name: t('cmdConvertToBoard'),
      checkCallback: (checking) => {
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mv || !mv.file) return false;
        if (!checking) this.convertToBoard(mv);
        return true;
      },
    });
    // File Explorer / Tab context menu: appends "Open as tugtile Board" / "Open as Markdown" options for board files (matches standard kanban entry points)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!file) return;
      if (file.children !== undefined) {   // Folder → Create board in folder
        menu.addItem((i) => i.setTitle(t('createBoardHere')).setIcon('gallery-vertical').onClick(() => this.createBoard(file)));
        return;
      }
      if (file.extension !== 'md' || !leaf) return;
      if (leaf.view instanceof BoardView) {
        menu.addItem((i) => i.setTitle(t('openAsMarkdownAction')).setIcon('file-text').onClick(() => this.setMarkdownView(leaf)));
      } else if (leaf.view instanceof MarkdownView && this.isBoardFile(file.path)) {
        menu.addItem((i) => i.setTitle(t('openAsBoard')).setIcon('gallery-vertical').onClick(() => this.setBoardView(leaf)));
      }
    }));
    this.addRibbonIcon('gallery-vertical', t('ribbonTitle'), () => {
      const file = this.app.workspace.getActiveFile();
      if (file && file.extension === 'md') this.openBoard(file.path);
      else new Notice(t('ribbonNoFile'));
    });
  }
  // Converts active markdown note to board in-place (adds frontmatter and settings, then opens as board)
  async convertToBoard(mv) {
    try {
      const cur = await this.app.vault.read(mv.file);
      if (!this.isBoardFile(mv.file.path) && !/^---[\s\S]*(kanban-plugin|tugtile-plugin)/.test(cur)) {
        const fm = '---\n\ntugtile-plugin: board\n\n---\n\n';   // New boards are born tugtile-native
        const tail = (cur.indexOf('%% kanban:settings') === -1 && cur.indexOf('%% tugtile:settings') === -1) ? '\n\n%% tugtile:settings\n```\n{}\n```\n%%\n' : '';
        await this.app.vault.modify(mv.file, fm + cur + tail);
      }
      await this.setBoardView(mv.leaf);
    } catch (e) { new Notice(t('convertFailed', e.message)); }
  }
  async createBoard(folder) {
    // Create in the specified folder or the folder containing the active file (matches kanban behavior, does not default to vault root)
    let dir = '';
    try {
      const active = this.app.workspace.getActiveFile();
      const parent = folder || (this.app.fileManager.getNewFileParent ? this.app.fileManager.getNewFileParent(active ? active.path : '') : null);
      if (parent && parent.path && parent.path !== '/') dir = parent.path + '/';
    } catch (e) {}
    const base = t('newBoardName');
    let name = base, n = 2;
    while (this.app.vault.getAbstractFileByPath(dir + name + '.md')) { name = base + ' ' + n; n++; }
    const path = dir + name + '.md';
    const tmpl = '---\ntugtile-plugin: board\n---\n\n\n\n%% tugtile:settings\n```\n{}\n```\n%%\n';
    try {
      await this.app.vault.create(path, tmpl);
      await this.openBoard(path);
      new Notice(t('boardCreated', name));
    } catch (e) {
      new Notice(t('createBoardFailed', e.message));
    }
  }
  isBoardFile(path) {
    if (!path || !path.endsWith('.md')) return false;
    const cache = this.app.metadataCache.getCache(path);
    return !!(cache && cache.frontmatter && (cache.frontmatter['tugtile-plugin'] || cache.frontmatter['kanban-plugin']));   // Dual-read: native tugtile key + legacy obsidian-kanban key
  }
  async setBoardView(leaf) {
    const st = (leaf.view && leaf.view.getState && leaf.view.getState()) || {};
    if (st.file) delete this._mdOverride[st.file];   // Clear markdown view override
    await leaf.setViewState({ type: VIEW_TYPE, state: st, popstate: true });
  }
  // Scan all leaves: boards hijacked by markdown or obsidian-kanban → reclaim as tugtile
  sweepBoardLeaves() {   // Debounce: coalesces rapid layout-change events into a single scan (replaces broken synchronization flag, M3)
    if (this._unloaded) return;
    clearTimeout(this._sweepT);
    this._sweepT = setTimeout(() => { if (!this._unloaded) this._sweepBoardLeaves(); }, 60);
  }
  _sweepBoardLeaves() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view; if (!v || !v.getViewType) return;
      const vt = v.getViewType();
      if (vt !== 'markdown' && vt !== 'kanban') return;        // Only reclaim markdown and kanban views
      const f = v.file || (v.getState && v.getState().file);
      const path = f && (f.path || f);
      if (path && this.isBoardFile(path) && this._mdOverride[path] !== true) this.setBoardView(leaf);
    });
  }
  async setMarkdownView(leaf) {
    const st = (leaf.view && leaf.view.getState && leaf.view.getState()) || {};
    if (st.file) this._mdOverride[st.file] = true;   // Mark file to open in markdown view (prevents setViewState redirection)
    await leaf.setViewState({ type: 'markdown', state: st, popstate: true });
  }
  // Public API for the tile family (marktile calls this). tugtile globally hooks setViewState to reclaim board
  // files as boards, so a sibling plugin can't open one in Obsidian's native editor on its own — this is the
  // sanctioned escape hatch (sets the override, then switches). Named "Obsidian" not "Markdown" on purpose: in
  // the family, *the* Markdown editor is marktile; this one means Obsidian's built-in editor.
  openAsObsidian(leaf) { return this.setMarkdownView(leaf || this.app.workspace.getMostRecentLeaf()); }
  async openBoard(path) {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: path } });
    this.app.workspace.revealLeaf(leaf);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    // Redraw active board views after configuration changes to apply settings instantly
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view && l.view.render) l.view.render(); });
  }
  onunload() {
    // Per Obsidian plugin guidelines: do NOT detachLeavesOfType here — Obsidian reinitializes
    // open leaves at their original position on update; detaching ourselves causes problems.
    this._unloaded = true; clearTimeout(this._sweepT);
    const a = this._navActions();   // Restore the native chevron icons if we'd swapped them for undo/redo
    if (a) { if (a.back && a.back.dataset.tugtileNav) { this._swapNavIcon(a.back, 'chevron-left'); delete a.back.dataset.tugtileNav; } if (a.fwd && a.fwd.dataset.tugtileNav) { this._swapNavIcon(a.fwd, 'chevron-right'); delete a.fwd.dataset.tugtileNav; } }
  }
};

// Global settings panel (individual board settings in kanban:settings override these defaults)
class TugtileSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: t('settingsTitle') });
    containerEl.createEl('p', { cls: 'setting-item-description', text: t('settingsDesc') });

    new Setting(containerEl).setName(t('safetyHeading')).setDesc(t('backupDesc'));   // make the (already-built) safety net legible

    new Setting(containerEl)
      .setName(t('gShowCheckboxes'))
      .setDesc(t('gShowCheckboxesDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.showCheckboxes).onChange(async (v) => { this.plugin.settings.showCheckboxes = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gHideCount'))
      .setDesc(t('gHideCountDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.hideCounts).onChange(async (v) => { this.plugin.settings.hideCounts = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gResponsiveBoard'))
      .setDesc(t('gResponsiveBoardDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.responsiveBoard).onChange(async (v) => { this.plugin.settings.responsiveBoard = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gLaneWidth'))
      .setDesc(t('gLaneWidthDesc'))
      .then((s) => {   // Three side-by-side buttons (segmented), active one highlighted
        const btns = {};
        [['narrow', t('optDenseTight')], ['medium', t('optDenseMid')], ['wide', t('optDenseLoose')]].forEach(([val, label]) => {
          s.addButton((b) => { btns[val] = b; b.setButtonText(label).onClick(async () => {
            this.plugin.settings.laneWidth = val; await this.plugin.saveSettings();
            Object.keys(btns).forEach((v) => (v === val ? btns[v].setCta() : btns[v].removeCta()));
          }); });
        });
        const cur = LANE_WIDTHS[this.plugin.settings.laneWidth] ? this.plugin.settings.laneWidth : 'medium';
        Object.keys(btns).forEach((v) => { if (v === cur) btns[v].setCta(); });
      });

    new Setting(containerEl)
      .setName(t('gTableDensity'))
      .setDesc(t('gTableDensityDesc'))
      .then((s) => {   // Table row spacing — same narrow/medium/wide segmented style as lane width
        const btns = {};
        [['narrow', t('optDenseTight')], ['medium', t('optDenseMid')], ['wide', t('optDenseLoose')]].forEach(([val, label]) => {
          s.addButton((b) => { btns[val] = b; b.setButtonText(label).onClick(async () => {
            this.plugin.settings.tableDensity = val; await this.plugin.saveSettings();
            Object.keys(btns).forEach((v) => (v === val ? btns[v].setCta() : btns[v].removeCta()));
          }); });
        });
        const cur = TABLE_PADS[this.plugin.settings.tableDensity] ? this.plugin.settings.tableDensity : 'medium';
        Object.keys(btns).forEach((v) => { if (v === cur) btns[v].setCta(); });
      });

    // Two separate pickers: text-formatting buttons vs insert/special buttons (search/undo/redo are always on, not listed)
    const toolPicker = (name, desc, cat) => new Setting(containerEl).setName(name).setDesc(desc).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const et = this.plugin.settings.editorTools || (this.plugin.settings.editorTools = {});
      EDITOR_TOOLS.forEach((tk) => {
        if (tk === 'sep' || tk === 'rowbreak' || tk.fixed || tk.cat !== cat) return;
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = et[tk.key] !== false;
        const glyph = lbl.createSpan({ cls: 'tugtile-tool-chk-i' });
        if (tk.icon) setIcon(glyph, tk.icon); else glyph.textContent = tk.g;   // Show the same icon the toolbar uses
        cb.onchange = async () => { et[tk.key] = cb.checked; await this.plugin.saveSettings(); };
      });
    });
    toolPicker(t('gFormatTools'), t('gFormatToolsDesc'), 'format');
    toolPicker(t('gBlockTools'), t('gBlockToolsDesc'), 'block');
    toolPicker(t('gInsertTools'), t('gInsertToolsDesc'), 'insert');
    // Which view modes the big editor's cycle rotates through — same picker marktile has. The modal
    // reads this at open, so a change takes effect on the next card open (no reload needed).
    new Setting(containerEl).setName(t('mtModesPick')).setDesc(t('mtModesPickDesc')).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const md = this.plugin.settings.modes || (this.plugin.settings.modes = {});
      EDITOR_MODES.forEach((m) => {
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = md[m.key] !== false;
        setIcon(lbl.createSpan({ cls: 'tugtile-tool-chk-i' }), m.icon);
        lbl.createSpan({ text: t(m.name) });
        cb.onchange = async () => {
          const willOn = EDITOR_MODES.filter((x) => (x.key === m.key ? cb.checked : md[x.key] !== false));
          if (!willOn.length) { cb.checked = true; new Notice(t('mtModesMinOne')); return; }   // keep at least one mode
          md[m.key] = cb.checked; await this.plugin.saveSettings();
        };
      });
    });

    new Setting(containerEl)
      .setName(t('mtSeasonedColor'))
      .setDesc(t('mtSeasonedColorDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.seasonedColor).onChange(async (v) => { this.plugin.settings.seasonedColor = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gEnterSubmit'))
      .setDesc(t('gEnterSubmitDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.enterSubmits).onChange(async (v) => { this.plugin.settings.enterSubmits = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gPrepend'))
      .setDesc(t('gPrependDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.prependNewCards).onChange(async (v) => { this.plugin.settings.prependNewCards = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gRelativeDate'))
      .setDesc(t('gRelativeDateDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.showRelativeDate).onChange(async (v) => { this.plugin.settings.showRelativeDate = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gDateDisplay'))
      .setDesc(t('gDateDisplayDesc'))
      .addText((tx) => tx.setValue(this.plugin.settings.dateDisplayFormat || 'YYYY-MM-DD').onChange(async (v) => { this.plugin.settings.dateDisplayFormat = v.trim() || 'YYYY-MM-DD'; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gArchiveWithDate'))
      .setDesc(t('gArchiveWithDateDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.archiveWithDate).onChange(async (v) => { this.plugin.settings.archiveWithDate = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('backupRetentionName'))
      .setDesc(t('backupRetentionDesc'))
      .addText((tx) => tx.setValue(String(this.plugin.settings.backupRetention)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= -1) { this.plugin.settings.backupRetention = n; await this.plugin.saveSettings(); }
      }));

    new Setting(containerEl)
      .setName(t('gArchiveHeading'))
      .setDesc(t('gArchiveHeadingDesc'))
      .addText((tx) => tx.setValue(this.plugin.settings.archiveHeading || 'Archive').onChange(async (v) => { this.plugin.settings.archiveHeading = v.trim() || 'Archive'; await this.plugin.saveSettings(); }));

    containerEl.createEl('h4', { text: t('gDanger') });
    new Setting(containerEl).setName(t('keyboardHintName')).setDesc(t('keyboardHint'));   // make the keyboard card-move discoverable

    // tile family cross-discovery: tell tugtile users marktile exists (even if not installed)
    const hasMt = !!(this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('marktile'));
    const fam = new Setting(containerEl).setName(t('familyMarktile')).setDesc(hasMt ? t('familyHave') : t('familyMarktileDesc'));
    if (!hasMt) fam.addButton((b) => b.setButtonText(t('familyGet')).onClick(() => window.open('obsidian://show-plugin?id=marktile')));

    new Setting(containerEl)
      .setName(t('gReset'))
      .setDesc(t('gResetDesc'))
      .addButton((b) => b.setButtonText(t('gResetBtn')).setWarning().onClick(async () => { this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS); await this.plugin.saveSettings(); this.display(); }));
  }
}
