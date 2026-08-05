// tile-cssmd/highlight — code highlighting for the INSIDE of a fenced code block.
//
// A SIBLING module, not part of cssmd.js, on purpose: cssmd.js is inlined verbatim into the
// tugtile and marktile plugin bundles, and neither of them highlights code. Living here costs
// those two artifacts nothing (146 lines each, measured) while a renderer that does want it
// imports one more file. Same doctrine as its sibling — wrap meaning in semantic spans, escape
// everything, ship no colour.

import { escHtml } from './cssmd.js';

// `line`: line-comment opener. `block`: [open, close]. `strings`: quote chars. `kw`: keywords.
// `mode`: 'markup' and 'diff' are scanned differently; everything else shares one scanner.
const CODE_LANGS = [
  { names: ['js', 'javascript', 'mjs', 'cjs', 'jsx', 'ts', 'typescript', 'tsx'],
    line: '//', block: ['/*', '*/'], strings: '\'"`', numbers: true,
    kw: 'const let var function return if else for while do break continue new class extends import export from default await async try catch finally throw typeof instanceof of in delete void yield static get set super this null true false undefined' },
  { names: ['json'], strings: '"', numbers: true, kw: 'true false null' },
  { names: ['sh', 'bash', 'zsh', 'shell', 'console', 'terminal'],
    line: '#', strings: '\'"', numbers: false,
    kw: 'if then else elif fi for while until do done case esac function return local export readonly declare shift trap set source unset' },
  { names: ['py', 'python'],
    line: '#', strings: '\'"', numbers: true,
    kw: 'def class return if elif else for while in is not and or import from as pass break continue with try except finally raise lambda None True False self yield global nonlocal assert del async await' },
  { names: ['css', 'scss', 'less'], block: ['/*', '*/'], strings: '\'"', numbers: true, kw: '' },
  { names: ['yaml', 'yml', 'toml', 'ini'], line: '#', strings: '\'"', numbers: true, kw: 'true false null yes no on off' },
  { names: ['html', 'xml', 'svg', 'vue', 'astro'], mode: 'markup' },
  { names: ['diff', 'patch'], mode: 'diff' },
];

const langFor = (lang) => {
  const want = String(lang == null ? '' : lang).trim().toLowerCase().split(/[\s,:]/)[0];
  if (!want) return null;
  return CODE_LANGS.find((l) => l.names.indexOf(want) !== -1) || null;
};

/** True when this language is highlighted at all — so a caller can skip the wrapper span. */
function knowsLanguage(lang) { return !!langFor(lang); }

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$]/;

// One line of a diff → its class, or '' for context. `---`/`+++` are FILE headers and must be
// tested before the single-character `-`/`+`, or every diff would open with a deleted line.
function diffLineClass(line) {
  if (/^(@@|diff |index |--- |\+\+\+ )/.test(line)) return 'hunk';
  if (line[0] === '+') return 'ins';
  if (line[0] === '-') return 'del';
  return '';
}

function highlightDiff(source, prefix) {
  return String(source).split('\n').map((line) => {
    const cls = diffLineClass(line);
    return cls ? '<span class="' + prefix + '-' + cls + '">' + escHtml(line) + '</span>' : escHtml(line);
  }).join('\n');
}

// Markup: comments, tag names, and quoted attribute values. Attributes are only recognised INSIDE
// a tag, so a quote in ordinary text is text.
function highlightMarkup(source, prefix) {
  const s = String(source);
  let out = '', i = 0, inTag = false;
  const push = (cls, text) => { out += '<span class="' + prefix + '-' + cls + '">' + escHtml(text) + '</span>'; };
  while (i < s.length) {
    if (!inTag && s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      const stop = end === -1 ? s.length : end + 3;
      push('com', s.slice(i, stop)); i = stop; continue;
    }
    if (!inTag && s[i] === '<') {
      const m = /^<\/?([A-Za-z][\w:.-]*)/.exec(s.slice(i));
      if (m) { out += escHtml(m[0].slice(0, m[0].length - m[1].length)); push('kw', m[1]); i += m[0].length; inTag = true; continue; }
    }
    if (inTag && (s[i] === '"' || s[i] === '\'')) {
      const q = s[i]; const end = s.indexOf(q, i + 1);
      const stop = end === -1 ? s.length : end + 1;
      push('str', s.slice(i, stop)); i = stop; continue;
    }
    if (inTag && s[i] === '>') inTag = false;
    out += escHtml(s[i]); i++;
  }
  return out;
}

/**
 * Highlight the body of a fenced code block.
 * @param {string} source raw code (NOT pre-escaped — this escapes, like renderInlineMd)
 * @param {string} lang the fence's info string (`js`, `bash`, `diff`, …)
 * @param {{prefix?: string}} [opts] class namespace, default `tg`
 * @returns {string} HTML; escaped text with no spans when the language is unknown or absent.
 */
function highlightCode(source, lang, opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  const def = langFor(lang);
  const s = String(source == null ? '' : source);
  if (!def) return escHtml(s);
  if (def.mode === 'diff') return highlightDiff(s, prefix);
  if (def.mode === 'markup') return highlightMarkup(s, prefix);

  const kw = new Set(String(def.kw || '').split(' ').filter(Boolean));
  const quotes = def.strings || '';
  let out = '', plain = '', i = 0;
  const flush = () => { if (plain) { out += escHtml(plain); plain = ''; } };
  const push = (cls, text) => { flush(); out += '<span class="' + prefix + '-' + cls + '">' + escHtml(text) + '</span>'; };

  while (i < s.length) {
    if (def.block && s.startsWith(def.block[0], i)) {
      const end = s.indexOf(def.block[1], i + def.block[0].length);
      const stop = end === -1 ? s.length : end + def.block[1].length;
      push('com', s.slice(i, stop)); i = stop; continue;
    }
    if (def.line && s.startsWith(def.line, i)) {
      let end = s.indexOf('\n', i); if (end === -1) end = s.length;
      push('com', s.slice(i, end)); i = end; continue;
    }
    if (quotes.indexOf(s[i]) !== -1) {
      const q = s[i]; let j = i + 1;
      // a string runs to its closing quote or the end of its LINE — an unterminated quote must not
      // swallow the rest of the block (shell one-liners and prose-y console output do this often).
      while (j < s.length && s[j] !== q && s[j] !== '\n') { if (s[j] === '\\') j++; j++; }
      const closed = s[j] === q;
      push('str', s.slice(i, closed ? j + 1 : j)); i = closed ? j + 1 : j; continue;
    }
    if (def.numbers && /[0-9]/.test(s[i]) && !(i > 0 && IDENT_CHAR.test(s[i - 1]))) {
      const m = /^[0-9][0-9a-fA-FxX_.]*/.exec(s.slice(i));
      push('num', m[0]); i += m[0].length; continue;
    }
    if (IDENT_START.test(s[i])) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
      if (kw.has(m[0])) push('kw', m[0]); else plain += m[0];
      i += m[0].length; continue;
    }
    plain += s[i]; i++;
  }
  flush();
  return out;
}

export { highlightCode, knowsLanguage, CODE_LANGS };
