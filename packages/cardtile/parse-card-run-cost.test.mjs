// cardtile parse cost — parseCard and serializeCard must cost one read of their input, whatever is in it.
//   run: node parse-card-run-cost.test.mjs
//
// 🩸 Why this file exists (tile#311). A Card is parsed on a Worker for every page and every save, from
// Markdown an owner or an agent supplies, and eleven ordinary shapes of that Markdown cost the SQUARE of
// their length. One text cell holding 40,000 spaces took about three seconds; a megabyte did not finish.
// None of them needs invalid syntax. They were two habits:
//   · a regex whose tail may be absent, started anywhere — `.replace(/\s+$/, '')`, `/\s+\^id$/`,
//     `/\s*%%tg-home:.*?%%/`, `(.*?)\s*%%`, `:\s*(.*)$`, "```\s*\n([\s\S]*?)\n```" — which is retried
//     from every character of a long run when the tail is not there;
//   · `shift()` in a loop, which moves the whole array once per blank line dropped.
// Each was replaced by a reader that visits a character a bounded number of times.
//
// The same two rulers as sitetile's *-run-cost tests (tile#30, tile#40), and the same helper:
//   1. SAME ANSWER — the replaced code is kept below, verbatim, as the reference: the board parser, the
//      board serializer, the cell reader and parseCard as they stood before the change. Every generated
//      document is parsed by both and the whole results compared, and so is every piece on its own.
//   2. LINEAR COST — each fixed path is timed, in CPU time, at n, 2n and 4n beside a control: the same
//      path carrying letters. From n to 4n linear work grows 4× and quadratic work 16×, so the ruler is
//      how much a path's time grows, held against its control's growth — never a number of
//      milliseconds. The sizes keep the replaced code's slowest reading under a second or two, so
//      putting a regex back is a red line, not a run that never ends.
// Each ruler is shown to fire: the controls at the bottom time two of the replaced forms themselves,
// and hand the same-answer ruler near-miss rewrites; all must go red.

import assert from 'node:assert/strict';
import { parseFile, serializeFile, tileRenderText } from '../tugtile/board-core.js';
import * as site from '../sitetile/site-core.js';
import { parseCard, serializeCard, extractCell, kindAssigned } from './card-core.js';
import { assembleSave } from './card-save.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.CARDTILE_PARSE_SAMPLES || 24000);
let seed = 314159265;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

// ── the code that was replaced, verbatim (tile 653e4f679e) ──────────────────────────────────────
// packages/tugtile/board-core.js: tileRenderText, parseFile, serializeFile.
// packages/cardtile/card-core.js: RE_CARD_MARKER, extractCell, parseCard and the lane tests it uses.
// kindAssigned, parseParams and splitFrontmatter are the live ones: the first two did not change, and
// parseCard reads nothing of what splitFrontmatter returns (its one changed line is held to its regex
// in a test of its own below).
const { parseParams, splitFrontmatter, frontmatterLine } = site;
const REF = (() => {
// ── board-core.js ──
function tileRenderText(tileLines) {
  const out = [];
  const m = tileLines[0].match(/^- \[.\] ?(.*)/);    // Do not use $ (remaining \r in CRLF causes (.*)$ to fail to match the end of line)
  out.push((m ? m[1] : tileLines[0]).replace(/\s*%%tg-home:.*?%%/, ''));   // hide the archive home-lane token (archived cards only; no-op on active cards)
  for (let i = 1; i < tileLines.length; i++) {
    out.push(tileLines[i].replace(/^(?:\t| {1,4})/, ''));   // Remove indentation for wrapped lines: one tab or 1-4 spaces
  }
  return out.join('\n');
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
// ── card-core.js ──
const DEFAULT_COLS = 6;
const DEFAULT_LANE = 'grid';
const RE_CARD_MARKER = /^%%\s*card(tile)?:\s*(.*?)\s*%%[ \t]*([^\n]*)\n?([\s\S]*)$/;
const legacySlides = (word, rawParams) => word === 'embed' && kindAssigned(rawParams);
function extractCell(text) {
  const m = RE_CARD_MARKER.exec(text || '');
  if (!m) return { type: 'text', params: {}, rawParams: '', body: (text || '').trim() };
  const sp = /^(\S+)\s*([\s\S]*)$/.exec(m[2].trim());
  const word = sp ? sp[1] : 'text';
  const rawParams = sp ? sp[2].trim() : '';
  const params = parseParams(rawParams);
  const body = (m[3] + (m[4] ? '\n' + m[4] : '')).replace(/\s+$/, '');
  // `marker` remembers a line written `%% cardtile:`, the same way `spelled` below remembers a word
  const cell = { type: word, params, rawParams, body: body.replace(/^\n+/, ''), ...(m[1] ? { marker: 'cardtile' } : {}) };
  // `spelled` remembers the word on disk, so writing the cell back does not rewrite the file
  if (legacySlides(word, rawParams)) return { ...cell, type: 'slides', spelled: word };
  return cell;
}
const RE_ASSET_LANE = /^assets$/i;
const RE_DRAWER_LANE = /^(back|drawer)\s*:\s*(.+)$/i;
const splitDrawer = (title) => {
  const m = RE_DRAWER_LANE.exec(String(title || '').trim());
  if (!m) return null;
  const bar = m[2].indexOf('|');
  const id = (bar < 0 ? m[2] : m[2].slice(0, bar)).trim().toLowerCase().replace(/\s+/g, '-');
  return { id, title: bar < 0 ? '' : m[2].slice(bar + 1).trim(), spelled: m[1].toLowerCase() };
};
function parseCard(md) {
  const m = parseFile(md);
  const { meta } = splitFrontmatter((m.pre || '') + '\n');
  const cells = [];
  const blocks = [];
  const drawers = [];
  let faceLane = null;
  const assets = {};
  for (const col of m.columns) {
    const laneTitle = String(col.title || '').trim();
    if (RE_ASSET_LANE.test(laneTitle)) {
      for (const t of col.tiles) {
        const c = extractCell(t.text);
        const id = (c.params.id || '').trim();
        // an asset is hoisted out of its line, so the line's marker spelling rides on the entry
        if (c.type === 'asset' && id) assets[id] = { mime: c.params.mime || 'image/webp', b64: (c.body || '').trim(), ...(c.marker ? { marker: c.marker } : {}) };
      }
      continue;                                    // never a cell, never a block
    }
    const d = splitDrawer(col.title);
    const laneCells = col.tiles.map((t) => extractCell(t.text));
    if (d) { drawers.push({ id: d.id, title: d.title, cells: laneCells, ...(d.spelled === 'drawer' ? { spelled: 'drawer' } : {}) }); continue; }
    // the first face lane names itself (`grid`) and shows no label; later lanes are titled sections
    const label = faceLane == null ? '' : String(col.title || '').trim();
    if (faceLane == null) faceLane = col.title;
    blocks.push({ label, start: cells.length, count: laneCells.length });
    // one push per cell, not push(...laneCells): spreading a lane passes every cell as an argument and overflows
    // the call stack around 10^5 cells, while a card under CARD_MAX_BYTES can hold ~877k one-line text cells.
    for (const c of laneCells) cells.push(c);
  }
  if (!blocks.length) blocks.push({ label: '', start: 0, count: 0 });
  return {
    pre: m.pre || '',
    post: m.post || '',
    cols: DEFAULT_COLS,          // a Card is six columns. See the note on DEFAULT_COLS.
    lane: faceLane != null ? faceLane : DEFAULT_LANE,
    blocks,
    cells,
    drawers,
    assets,
  };
}
  return { tileRenderText, parseFile, serializeFile, extractCell, parseCard };
})();
const REF_FRONTMATTER_LINE = /^([\w-]+):\s*(.*)$/;

// ── inputs: card-shaped text, uneven on purpose ─────────────────────────────────────────────────
// `\s` is wider than space and tab, and a hand-written scan has to use the same class: NBSP, the line
// and paragraph separators, the BOM, ideographic and em spaces, VT, FF, the ogham space — next to three
// look-alikes `\s` does NOT match (U+200B, U+0085, U+180E). `.` stops at four of them (\n \r U+2028
// U+2029), which is what decides whether a `%%tg-home:…%%` token or a marker's inner closes.
const WS = [' ', ' ', ' ', '\t', ' ', ' ', ' ', '﻿', '　', ' ', '\v', '\f', ' '];
const NOT_WS = ['​', '\u0085', '᠎'];
const run = (alphabet, max) => words(alphabet, 1 + Math.floor(rnd() * max));
const ws = () => (rnd() < 0.15 ? run(WS, 40) : rnd() < 0.5 ? pick(WS) : ' ');
const TEXT = ['a', 'x y', 'hello', '中文', '😀', '\ud83d', '**b**', '[t](https://e.com/a)', '#top', '%', '%%', '^', '^id', '-', '=', '"', '|', ':',
  '`', '```', '{"a":1}', '<br>', '\\', 'kind', 'id', 'w=2', ...NOT_WS];
const text = (max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += rnd() < 0.3 ? ws() : pick(TEXT); return s; };
const ID = ['id', 'id', 'a-b', 'a-b', 'A1', 'A1', '-', '0', 'abc123', 'x_y', 'é', 'a.b', ''];
const blockId = () => pick(['', ws(), ws(), ws(), ws(), ws(), ws(), 'x', '^']) + pick(['^', '^', '^', '^', '^', '^', '^^', ' ^ ', '']) + pick(ID) +
  pick(['', '', '', '', '', '', '', '', '', ' ', ' ', '^', ' ']);
const homeToken = () => pick(['', '', ws(), ws(), 'x']) + pick(['%%tg-home:', '%%tg-home:', '%%tg-home:', '%% tg-home:', '%%tg-home', '%tg-home:', '%%TG-HOME:']) +
  pick(['Done', 'To do', '', '中', 'a%b', 'a b', 'a b', '%', ' ', text(3)]) + pick(['%%', '%%', '%%', '%', '', '%%%', ' %%']);
const PARAMS = ['w=2', 'h=1', 'kind=slider', 'kind=', 'kind', 'kind =x', 'id=sha256-ab', 'id', 'id=', 'id="a"→b', 'id="a b"', 'mime=image/png', 'mime',
  'cta="Go now"→/x', 'title="Two Words"', 'wide', 'a-b=c', '"', '→', '%', 'x'];
const TYPES = ['text', 'text', 'profile', 'button', 'link', 'embed', 'embed', 'slides', 'asset', 'asset', 'events', '', '中'];
function marker() {
  const r = rnd();
  const open = pick(['%%', '%%', '%%', '%%', '%%', '%%', '%%', '%%', '%%', '%', '%%%', ' %%']) + pick(['', ' ', ' ', ws()]) +
    pick(['card', 'card', 'card', 'card', 'card', 'card', 'cardtile', 'cardtile', 'cardtile', 'cards', 'Card', 'card-page', 'sitetile', 'cardtiles']) +
    pick([':', ':', ':', ':', ':', ':', ':', ':', ' :', '']);
  let inner = pick(['', ' ', ' ', ws()]) + pick(TYPES);
  for (let n = Math.floor(rnd() * 4); n > 0; n--) inner += pick([' ', ' ', ws(), '']) + pick(PARAMS);
  if (r < 0.08) inner += ws() + text(3);
  if (r > 0.8) inner = ' embed ' + pick(['kind=slider', 'kind=slider', 'kind=bubbles w=2', 'kind=', 'kind =x', 'w=2 kind=slider']);
  return open + inner + pick(['', ' ', ' ', ws()]) + pick(['%%', '%%', '%%', '%%', '%%', '%%', '%%', '%%', '%%', '%%', '%', '', '%%%', '% %']) + pick(['', ' ', ' ', '\t', ws()]);
}
function cardText() {
  let s = rnd() < 0.75 ? marker() : '';
  s += text(5);
  if (rnd() < 0.3) s += homeToken();
  if (rnd() < 0.15) s += text(3) + homeToken();
  if (rnd() < 0.4) s += blockId();
  else if (rnd() < 0.2) s += ws();
  return s;
}
const fenceBody = () => pick(['{"show-checkboxes":true}', '{"a":[1,2]}', '{bad', '', ' ', '{}', '\n{}', '{}\n', 'x']);
const LANES = ['## grid', '## grid', '## English', '## back: about', '## back: stockists | Where', '## drawer: old', '## Back : A B | t', '## assets', '## assets',
  '## ASSETS ', '##', '## ', '##  two', '### not a lane', '## back:', '## Archive'];
function line() {
  const r = rnd();
  if (r < 0.30) return '- [' + pick([' ', ' ', ' ', 'x', '/', '', ' ', '中']) + ']' + pick([' ', ' ', ' ', '', '  ']) + cardText();
  if (r < 0.42) return pick(['\t', '\t', '    ', '  ', ' ', '\t\t', '     ', '']) + pick([text(5), text(5), '```', '{"source":"x"}', '## x', '- [ ] y', ws(), marker()]);
  if (r < 0.55) return pick(['', '', '', ' ', '\t', ' ', '　', ws()]);
  if (r < 0.67) return pick(LANES);
  if (r < 0.72) return pick(['***', '***', '*** ', '****', '***\t', '*** x', '**', '---', '___', ' ***', '*** ']);
  if (r < 0.80) return pick(['```', '```', '```json', '~~~', '```' + ws(), 'a```', ' ```', '````', '``` x']);
  if (r < 0.85) return pick(['%% kanban:settings', '%% tugtile:settings', ' %% kanban:settings', '%% kanban:settings x', '%%']);
  if (r < 0.90) return fenceBody();
  if (r < 0.94) return pick(['title:', 'title: T', 'card-page: a', 'k' + ws() + ': v', 'k:' + ws() + text(3), 'k: |', 'k: >-', '---']);
  return text(8);
}
const EOLS = ['\n', '\n', '\n', '\n', '\r\n', '\r\n', '\r'];
function sample() {
  const r = rnd();
  if (r < 0.005) return pick(['', '\n', '## grid', '- [ ] x', '***', '---', '---\n---']);
  const eol = pick(EOLS), mixed = rnd() < 0.08;
  const lines = [];
  if (rnd() < 0.2) { lines.push('---'); for (let n = Math.floor(rnd() * 3); n > 0; n--) lines.push(pick(['title: T', 'card-page: a', 'k:' + ws() + 'v', 'x'])); if (rnd() < 0.85) lines.push('---'); }
  if (rnd() < 0.2) lines.push(text(5));
  if (rnd() < 0.85) lines.push('## grid');
  if (r < 0.12) {                                              // a lane that opens on blank lines, then maybe lead text
    for (let n = Math.floor(rnd() * 30); n > 0; n--) lines.push(pick(['', '', ' ', '\t', ' ']));
    if (rnd() < 0.5) lines.push(text(4));
    for (let n = Math.floor(rnd() * 6); n > 0; n--) lines.push(pick(['', ' ']));
  }
  for (let n = Math.floor(rnd() * 14); n > 0; n--) lines.push(line());
  if (rnd() < 0.15) {                                          // the assets lane: ids that name, and ids that do not
    lines.push(pick(['## assets', '## assets', '## Assets', '## assets ']));
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
      lines.push('- [ ] %% ' + pick(['card', 'card', 'cardtile']) + ': ' + pick(['asset', 'asset', 'asset', 'asset', 'text']) + ' ' +
        pick(['id=sha256-ab', 'id=sha256-ab', 'id=sha256-cd.png', 'id=' + ws() + 'x', 'id="a b"', 'id="a b"', 'id=__proto__', 'id=', '', 'ID=x', 'id', 'id="a"→b']) +
        pick(['', ' mime=image/png', ' mime=image/png', ' mime', ' mime="a b"']) + ' %%' + pick([' AAAA', ' AAAA', ' AA' + ws() + 'AA' + ws(), '', '\n\tAAAA']));
    }
  }
  if (rnd() < 0.2) {                                           // an archive: a rule, blank lines, a heading
    lines.push(pick(['***', '***', '****', '*** ']));
    for (let n = Math.floor(rnd() * 3); n > 0; n--) lines.push(pick(['', ' ']));
    lines.push(pick(['## Archive', '## Archive', 'x', '### no']));
    for (let n = Math.floor(rnd() * 4); n > 0; n--) lines.push(line());
  }
  if (rnd() < 0.3) {                                           // a settings block, well-formed or nearly
    lines.push(pick(['%% kanban:settings', '%% tugtile:settings']));
    for (let n = Math.floor(rnd() * 3); n > 0; n--) lines.push(pick(['', ' ', 'a```', '``` x', '```']));
    lines.push(pick(['```', '```', '```', '``` ', '```json', 'x```', '````']));
    for (let n = Math.floor(rnd() * 3); n > 0; n--) lines.push(pick(['', '', ' ', ' ']));
    if (rnd() < 0.8) lines.push(fenceBody());
    if (rnd() < 0.8) lines.push(pick(['```', '```', '```', ' ```', '```x']));
    if (rnd() < 0.5) lines.push(pick(['%%', '', '```', text(3)]));
  }
  let s = '';
  lines.forEach((l, i) => { s += (i ? (mixed ? pick(EOLS) : eol) : '') + l; });
  return s + pick(['', eol, eol, eol + eol]);
}
const corpus = Array.from({ length: SAMPLES }, sample);
const same = (got, want, what) => assert.deepStrictEqual(got, want, what);
const attempt = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };
// The reference with ONE thing lent to it: a `.trim()` on the two values an asset's `id` can hold
// besides a string (true, and a link object), answering '' — "no id". That is the whole of the change
// to what parseCard returns, so with it lent the reference must agree on those documents too.
function idless(fn) {
  const lend = { value: () => '', configurable: true, enumerable: false, writable: true };
  Object.defineProperty(Boolean.prototype, 'trim', lend);
  Object.defineProperty(Object.prototype, 'trim', lend);
  try { return fn(); } finally { delete Boolean.prototype.trim; delete Object.prototype.trim; }
}
const common = (seen) => { console.log('      ' + Object.entries(seen).map(([k, v]) => k + ' ' + v).join(' · ')); for (const [k, v] of Object.entries(seen)) assert.ok(v > SAMPLES / 100, 'the samples exercise "' + k + '" (' + v + ' of ' + SAMPLES + ')'); };

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
test('the board parser reads ' + SAMPLES.toLocaleString('en-US') + ' generated documents exactly as before', () => {
  assert.ok(SAMPLES >= 20000, 'at least 20,000 samples');
  const seen = { 'a block id': 0, 'a home token hidden': 0, 'a home token left': 0, 'lead text': 0, 'lead blank lines dropped': 0, 'an archive': 0,
    'settings read': 0, 'a settings fence that is not JSON': 0, 'CRLF': 0, 'a card with wrapped lines': 0 };
  for (const md of corpus) {
    const want = REF.parseFile(md), got = parseFile(md);
    same(got, want, 'parseFile ' + JSON.stringify(md));
    if (want.archive) seen['an archive']++;
    if (want.eol === '\r\n') seen.CRLF++;
    if (Object.keys(want.settings).length) seen['settings read']++;
    else if (/```\s*\n([\s\S]*?)\n```/.test(want.post)) seen['a settings fence that is not JSON']++;
    let block = 0, hidden = 0, left = 0, lead = 0, wrapped = 0;
    for (const c of want.columns) {
      if (c.lead.length) lead++;
      for (const t of c.tiles) {
        if (t.block !== null) block++;
        if (t.raw.includes('\n')) wrapped++;
        if (t.raw.includes('%%tg-home:')) { if (t.text.includes('%%tg-home:')) left++; else hidden++; }
      }
    }
    if (block) seen['a block id']++;
    if (hidden) seen['a home token hidden']++;
    if (left) seen['a home token left']++;
    if (lead) seen['lead text']++;
    if (wrapped) seen['a card with wrapped lines']++;
    if (/(^|\n)## [^\n]*\n[ \t ]*\n/.test(md) && lead) seen['lead blank lines dropped']++;
  }
  common(seen);
});

test('parseCard returns the same model for every one of them', () => {
  const seen = { 'a marked cell': 0, 'an unmarked cell': 0, 'a cell body': 0, 'a back lane': 0, 'an asset': 0, 'a `cardtile:` marker': 0, 'a legacy carousel': 0, 'two blocks': 0 };
  let threw = 0;
  for (const md of corpus) {
    const want = attempt(() => REF.parseCard(md)), got = attempt(() => parseCard(md));
    assert.ok(!got.error, 'parseCard threw on ' + JSON.stringify(md) + ': ' + (got.error && got.error.message));
    if (want.error) {
      // The one way the old parser threw: an asset line whose `id` is not a string (a bare flag, or a
      // quoted link). It has its own test below; here it only has to be that and nothing else.
      assert.ok(want.error instanceof TypeError && /\.trim is not a function/.test(want.error.message), 'the reference threw something else on ' + JSON.stringify(md) + ': ' + want.error.message);
      threw++;
    }
    const m = want.error ? idless(() => REF.parseCard(md)) : want.value;
    same(got.value, m, 'parseCard ' + JSON.stringify(md));
    const all = [...m.cells, ...m.drawers.flatMap((d) => d.cells)];
    if (all.some((c) => c.rawParams || c.type !== 'text')) seen['a marked cell']++;
    if (all.some((c) => c.type === 'text' && !c.rawParams && c.body)) seen['an unmarked cell']++;
    if (all.some((c) => c.body.includes('\n'))) seen['a cell body']++;
    if (all.some((c) => c.marker === 'cardtile')) seen['a `cardtile:` marker']++;
    if (all.some((c) => c.spelled === 'embed')) seen['a legacy carousel']++;
    if (m.drawers.length) seen['a back lane']++;
    if (Object.keys(m.assets).length) seen['an asset']++;
    if (m.blocks.length > 1) seen['two blocks']++;
  }
  common(seen);
  console.log('      the reference threw on ' + threw + ' (an asset line whose id is not a string)');
  assert.ok(threw > 0 && threw < SAMPLES / 20, 'the old throw is in the samples, and rare (' + threw + ')');
});

test('a cell is read from any text exactly as the marker regex read it', () => {
  // extractCell is exported and takes any string: line breaks before the closing %%, no `- [ ]` in
  // front, a marker that never closes. So it is held to the old one directly, on text no board line holds.
  let marked = 0, n = 0;
  const one = (s) => {
    const want = REF.extractCell(s);
    same(extractCell(s), want, 'extractCell ' + JSON.stringify(s));
    n++;
    if (want.rawParams || want.type !== 'text' || /^%%\s*card(tile)?:/.test(s) && want.body !== s.trim()) marked++;
  };
  for (const md of corpus) for (const col of REF.parseFile(md).columns) for (const t of col.tiles) one(t.text);
  for (let i = 0; i < SAMPLES; i++) {
    const r = rnd();
    one(r < 0.6 ? marker() + pick(['', '', text(4), '\n' + text(4), '\n\n' + text(3) + '\n', ws() + '\n' + ws()]) + pick(['', '', ws(), '\n', '\n\n\t'])
      : r < 0.8 ? '%% card:' + words([...WS, '\n', '\r', 'a', 'w=1', '%', '%%'], 12) + pick(['%%', '']) + text(3)
      : text(10));
  }
  assert.ok(marked > n / 10 && marked < n * 0.9, 'both verdicts are common (' + marked + ' of ' + n + ' are marked cells)');
});

test('a card line is rendered to its text exactly as before', () => {
  let n = 0, changed = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const tile = ['- [' + pick([' ', 'x', '']) + ']' + pick([' ', '']) + (rnd() < 0.5 ? text(4) : '') + (rnd() < 0.8 ? homeToken() : '') + (rnd() < 0.3 ? text(3) + homeToken() : '') + text(2)];
    if (rnd() < 0.1) tile[0] = text(6) + homeToken();              // no `- [ ]` at all: the whole line is the text
    for (let k = Math.floor(rnd() * 3); k > 0; k--) tile.push(pick(['\t', '    ', '     ', '']) + text(4));
    const want = REF.tileRenderText(tile);
    assert.equal(tileRenderText(tile), want, JSON.stringify(tile));
    n++;
    if (want.split('\n')[0].length < tile[0].replace(/^- \[.\] ?/, '').length) changed++;
  }
  assert.ok(changed > n / 5 && changed < n * 0.9, 'both verdicts are common (' + changed + ' of ' + n + ' lost a home token)');
});

test('the board serializer writes every model exactly as before', () => {
  const edge = () => pick(['', '', ws(), '\n', '\n\n', '\r\n', run(WS, 6), pick(NOT_WS)]);
  const block = () => edge() + pick(['', text(6), text(3) + '\n' + ws() + '\n' + text(3), ws()]) + edge();
  let trimmed = 0;
  for (let i = 0; i < corpus.length; i++) {
    const model = REF.parseFile(corpus[i]);
    same(serializeFile(model), REF.serializeFile(model), 'serializeFile of ' + JSON.stringify(corpus[i]));
    if (i % 2) continue;
    const loose = { ...model, pre: block(), archive: block(), post: block(), eol: pick(['\n', '\r\n']) };
    const want = REF.serializeFile(loose);
    assert.equal(serializeFile(loose), want, 'serializeFile with ' + JSON.stringify([loose.pre, loose.archive, loose.post]));
    if (loose.pre !== loose.pre.trimEnd() && /\S/.test(loose.pre)) trimmed++;
  }
  assert.ok(trimmed > SAMPLES / 100, 'the samples exercise text with whitespace after it (' + trimmed + ')');
});

test('a card written back is read the same by both parsers', () => {
  // serializeCard did not change; the board serializer under it did, and is held to the old one above
  // on every model and on loose text before and after the lanes. This is the two together.
  let n = 0;
  for (let i = 0; i < corpus.length; i += 3) {
    const model = attempt(() => REF.parseCard(corpus[i])).value;
    if (!model) continue;
    const out = serializeCard(model);
    same(parseFile(out), REF.parseFile(out), 'the written card: ' + JSON.stringify(corpus[i]));
    same(parseCard(out), REF.parseCard(out), 'the written card: ' + JSON.stringify(corpus[i]));
    n++;
  }
  assert.ok(n > SAMPLES / 4);
});

test('a frontmatter line is split into key and value exactly as its regex did', () => {
  assert.equal(typeof frontmatterLine, 'function', 'site-core.js exports frontmatterLine');
  const KEY = ['title', 'card-page', 'k', 'a_b', 'a-b', '-', '0', '', 'é', 'a b', ' k', 'k '];
  let yes = 0, broken = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const line = pick(KEY) + pick([':', ':', ':', ':', '', '::', ' :']) + pick(['', ' ', ' ', ws(), run(WS, 5)]) + pick(['', 'v', text(4), '|', '>-', '|2+', 'a: b']) + pick(['', '', '', ws(), '\r', ' x', ' ', 'x\ry']);
    const want = REF_FRONTMATTER_LINE.exec(line), got = frontmatterLine(line);
    assert.deepEqual(got && [...got], want && [...want], JSON.stringify(line));
    if (want) yes++; else if (/^[\w-]+:/.test(line)) broken++;
  }
  assert.ok(yes > SAMPLES / 5 && broken > SAMPLES / 50, 'both verdicts are common (' + yes + ' key lines, ' + broken + ' refused for a line break in the value)');
  // and through the reader itself: a value with a separator in it is not a key
  assert.deepEqual(splitFrontmatter('---\ntitle: T\nsub:  a b\nlast:  v \n---\n').meta, { title: 'T', last: 'v' });
});

// ── the throw (tile#311) ───────────────────────────────────────────────────────────────────────
test('an asset line whose id has no value is passed over, not thrown on', () => {
  // `id` alone is a bare flag (params.id === true) and `id="a"→b` a link object. parseCard called
  // .trim() on both. assembleSave parses whatever a save sends before anything checks it, so a save
  // carrying this line was an exception, not an answer. An asset with no id was already skipped — an
  // id that is not a name is the same case, and gets the same result.
  const EMPTY = { pre: '', post: '', cols: 6, lane: 'grid', blocks: [{ label: '', start: 0, count: 0 }], cells: [], drawers: [], assets: {} };
  for (const id of ['id', 'id="a"→b', 'id=', 'id=" "', '']) {
    const md = '## assets\n- [ ] %% card: asset ' + id + ' %% AAAA';
    assert.deepEqual(parseCard(md), EMPTY, md);
  }
  assert.throws(() => REF.parseCard('## assets\n- [ ] %% card: asset id %% AAAA'), TypeError, 'the reference still throws: this is the one place the two differ');
  // the lines around it are untouched
  const mixed = parseCard('## grid\n- [ ] %% card: text %% hi\n\n## assets\n- [ ] %% card: asset id %% AAAA\n- [ ] %% card: asset id=sha256-ab mime %% BBBB\n- [ ] %% card: asset id=sha256-cd mime=image/png %% CCCC');
  assert.deepEqual(mixed.cells, [{ type: 'text', params: {}, rawParams: '', body: 'hi' }]);
  assert.deepEqual(mixed.assets, { 'sha256-ab': { mime: true, b64: 'BBBB' }, 'sha256-cd': { mime: 'image/png', b64: 'CCCC' } });
  // and the save path answers
  const saved = assembleSave('## grid\n- [ ] %% card: text %% hi\n\n## assets\n- [ ] %% card: asset id %% AAAA\n', null);
  assert.equal(saved.md, '## grid\n\n- [ ] %% card: text %% hi\n');
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
// The helper is sitetile's (bracket-run-cost.test.mjs, tile#40), copied whole: this file runs alone.
// CPU milliseconds this process has used, not the wall clock. On a busy machine a process waits its
// turn, and a wall-clock reading counts the wait.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
// CPU milliseconds per call: calls repeated until 20 ms have been spent, so a fast one is not read off
// the clock's resolution, and the best of three such readings, so a garbage collection landing in one
// of them does not count. A call slow enough to fill 100 ms alone is read once.
function perCall(fn) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = cpuMs();
    let reps = 0, ms;
    do { fn(); reps++; ms = cpuMs() - t; } while (ms < 20);
    best = Math.min(best, ms / reps);
    if (ms > 100) break;
  }
  return best;
}
// How much a path's time grows from n to 4n, and its control's: the best reading per size over two
// rounds, and up to two more while the path is over its limit. Load only ever slows a reading down,
// so more rounds can only bring a linear path back under; a quadratic one stays over however many.
const show = (a) => a.map((v) => v.toFixed(3)).join(' / ');
function growth(runIt, unit, wrap, n) {
  const sizes = [n, 2 * n, 4 * n];
  const subject = sizes.map((k) => wrap(unit.repeat(k)));
  const control = sizes.map((k) => wrap('x'.repeat(unit.length * k)));
  const s = [Infinity, Infinity, Infinity], c = [Infinity, Infinity, Infinity];
  let grew = Infinity, controlGrew = 1, rounds = 0;
  while (rounds < 2 || (rounds < 4 && grew > limitFor(controlGrew))) {
    for (let i = 0; i < 3; i++) {
      c[i] = Math.min(c[i], perCall(() => runIt(control[i])));
      s[i] = Math.min(s[i], perCall(() => runIt(subject[i])));
    }
    rounds++;
    grew = s[2] / s[0]; controlGrew = c[2] / c[0];
  }
  const said = 'grew ' + grew.toFixed(1) + '× from n to 4n, its control ' + controlGrew.toFixed(1) + '×, limit ' + limitFor(controlGrew).toFixed(1) +
    '× after ' + rounds + ' rounds (CPU ms per call at n / 2n / 4n: ' + show(s) + ', control ' + show(c) + ')';
  if (process.env.CARDTILE_PARSE_VERBOSE) console.log('    ' + said);
  return { grew, controlGrew, said };
}
// From n to 4n linear work grows 4× and quadratic work 16×. A path may grow 8× — the geometric middle —
// or twice what its control grew, whichever is more: a machine busy enough to bend a linear control
// past 4× bends the limit with it, and never below 8.
const limitFor = (controlGrew) => Math.max(8, 2 * controlGrew);

const FACE = '## grid\n- [ ] %% card: profile %% hello\n';
const model = (over) => ({ pre: '', post: '', cells: [], blocks: [], drawers: [], assets: {}, ...over });
const PATHS = [
  // [name, n, repeated unit, (run of units) → input, what consumes it]
  // the ticket's own input: x, N spaces, x in a text cell — the block id, the home token and the body
  ['spaces inside a text cell', 5000, ' ', (f) => FACE + '- [ ] %% card: text %% x' + f + 'x\n', parseCard],
  ['no-break spaces inside a text cell', 5000, ' ', (f) => FACE + '- [ ] %% card: text %% x' + f + 'x\n', parseCard],
  ['spaces inside a wrapped body line', 5000, ' ', (f) => FACE + '- [ ] %% card: text %%\n\tx' + f + 'x\n', parseCard],
  ['blank lines inside a cell body', 5000, '\n', (f) => FACE + '- [ ] %% card: text %%\n\tx' + f + '\tx\n', parseCard],
  ['spaces inside a marker', 5000, ' ', (f) => FACE + '- [ ] %% card: text a' + f + 'b %% hi\n', parseCard],
  ['blank lines at the top of a lane', 50000, '\n', (f) => '## grid\n' + f + '- [ ] %% card: text %% x\n', parseCard],
  ['spaces inside an archived card', 5000, ' ', (f) => FACE + '\n***\n\n## Archive\n- [ ] x' + f + 'x\n', parseCard],
  ['fences that open and never close, after the settings marker', 2500, 'a```\n', (f) => FACE + '\n%% kanban:settings\n' + f, parseCard],
  ['spaces before a frontmatter value holding U+2028', 5000, ' ', (f) => '---\ntitle:' + f + 'x y\n---\n' + FACE, parseCard],
  ['spaces inside the text before the first lane, written back', 5000, ' ', (f) => model({ pre: 'x' + f + 'x' }), serializeCard],
  ['spaces inside the text after the last lane, written back', 5000, ' ', (f) => model({ post: 'x' + f + 'x' }), serializeCard],
  // read and written back, whole: the ticket's input through both directions
  ['spaces inside a text cell, read and written back', 5000, ' ', (f) => FACE + '- [ ] %% card: text %% x' + f + 'x\n', (md) => serializeCard(parseCard(md))],
];
for (const [name, n, unit, wrap, runIt] of PATHS) {
  test(name + ' grow like the same card carrying letters (n = ' + n.toLocaleString('en-US') + ')', () => {
    const { grew, controlGrew, said } = growth(runIt, unit, wrap, n);
    assert.ok(grew <= limitFor(controlGrew), said);
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the two forms it was written for', () => {
  const strip = growth((t) => t.replace(/\s+$/, ''), ' ', (f) => 'x' + f + 'x', 2500);
  assert.ok(strip.grew > limitFor(strip.controlGrew), 'the replaced trailing-whitespace regex ' + strip.said);
  const shift = growth((lead) => { const a = lead.slice(); while (a.length && a[0].trim() === '') a.shift(); return a; }, ' ', (f) => f.split('').map((ch) => ch.trim()), 50000);
  assert.ok(shift.grew > limitFor(shift.controlGrew), 'shift() in a loop ' + shift.said);
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  // Each rewrite is the kind a hand scan gets wrong: ASCII whitespace for `\s`, a token that may hold a
  // line break, a block id that needs no space before it, a marker whose inner may span lines.
  const asciiTrim = (s) => s.replace(/[ \t\r\n]+$/, '');
  const anyHome = (s) => s.replace(/\s*%%tg-home:[\s\S]*?%%/, '');
  const looseId = (s) => { const m = /\s*\^([A-Za-z0-9-]+)$/.exec(s); return m ? m[1] : null; };
  const looseMarker = (s) => /^%%\s*card(tile)?:\s*([\s\S]*?)\s*%%/.test(s);
  let trim = 0, home = 0, id = 0, mark = 0, lead = 0;
  for (const md of corpus) {
    const board = REF.parseFile(md);
    for (const col of board.columns) {
      for (const t of col.tiles) {
        const first = t.raw.split('\n')[0];
        if (asciiTrim(t.text) !== t.text.replace(/\s+$/, '')) trim++;
        if (anyHome(first) !== first.replace(/\s*%%tg-home:.*?%%/, '')) home++;
        if (looseId(first) !== t.block) id++;
        if (looseMarker(t.text) !== /^%%\s*card(tile)?:\s*(.*?)\s*%%/.test(t.text)) mark++;
      }
    }
    // dropping every blank lead line, not only the ones at the two ends
    if (board.columns.some((c) => c.lead.some((l) => l.trim() === ''))) lead++;
  }
  assert.ok(trim && home && id && mark && lead, 'each near-miss is caught (' + [trim, home, id, mark, lead] + ')');
});

console.log('\ncardtile parse cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
