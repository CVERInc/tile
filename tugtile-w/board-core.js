// AUTO-GENERATED from CVERInc/tile packages/tugtile/plugin.src.js CORE — board model, platform-free. DO NOT EDIT.
const t=(k)=>k;
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
    .replace(/^#{1,6}[ \t]+/, '')                                           // Heading hashes ([ \t], not \s — see the structural-whitespace note in editor-core.js)
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
  const isHr = (l) => /^\*\*\*+[ \t]*$/.test(l);              // Archive separator: only matches *** (kanban's archiveString, to avoid misidentifying lead ---/___ horizontal lines as archive markers and swallowing lanes). [ \t], not \s — see the structural-whitespace note in editor-core.js
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

export { parseFile, serializeFile, parseWip, tileRenderText, foldStateFrom, nextFold, foldTargets, foldIcon, FOLD_ICONS, extractMeta, extractTags, tilePlainText, parseDateStr, formatDateTokens };
