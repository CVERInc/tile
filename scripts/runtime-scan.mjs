#!/usr/bin/env node
// runtime-scan — fail when a BUILT script bundle can write a cookie or load code chosen by data.
//
// Why: platform scripts may one day be the only scripts allowed to run on a host whose domain is
// shared with other people's pages. A content-security policy can say where scripts come FROM; it
// cannot stop a permitted script from writing `document.cookie` for the whole domain, or from
// starting a worker / importing a module whose URL arrived as data. This scan is the tripwire for
// exactly those two things, over the files that are actually shipped — not their sources.
//
// What it refuses (rule id — construct):
//   cookie-write          `<x>.cookie` / `<x>['cookie']` as an assignment or ++/-- target, on ANY receiver
//   cookie-store          any `cookieStore`
//   document-domain       `document.domain` / `document['domain']`, read or write
//   eval                  `eval` referenced at all (`eval(`, `(0,eval)(`, `window.eval`, `const e=eval`)
//   function-constructor  `Function` constructed or aliased (`new Function`, `Function(`, `F=Function`,
//                         `Function.call/apply/bind`); `Function.prototype…` and `instanceof Function` pass
//   string-timer          `setTimeout` / `setInterval` whose first argument starts with a string or template
//   script-element        `createElement('script')` in any quote style or case; `createElementNS(ns, 'script')`
//   script-src            `.src =` / `['src'] =` on ANY element, `setAttribute('src', …)`,
//                         `setAttributeNS(ns, 'src', …)` — the scan cannot tell a script element from an image
//                         in minified code, so every one is reported (false positives by design)
//   worker                any `Worker` / `SharedWorker` reference (`new Worker(`, `new window.SharedWorker(`)
//   import-scripts        any `importScripts`
//   service-worker        `serviceWorker.register`, or `serviceWorker` held as a value (`s=navigator.serviceWorker`)
//   cache-storage         any `caches` reference (`caches.open`, `self.caches`)
//   dynamic-import        `import(…)` whose argument is anything but ONE string literal
//
// HOW: a JavaScript TOKENIZER, not a regex over text. Comments, string contents, template text and
// regex literals are skipped, so a token inside them is not code; whitespace and line breaks do not
// matter, so a minified bundle reads the same as a pretty one. `x['name']` with one string literal is
// read as `x.name`, and a unicode escape in an identifier (backslash-u-0065 for `e`) is decoded, so an
// escaped `eval` is still `eval`. Rules match global names and
// property names, never minifier-chosen local names.
//
// 🔴 A TRIPWIRE, NOT A PROOF. It reports what the tokens SAY; it does not follow values. The known
// false negatives (constructs that load code or write cookies and pass this scan) are listed in
// test/runtime-scan.test.mjs, each one as a passing assertion, so the list cannot silently go stale.
//
// Exceptions live in ONE file (scripts/runtime-scan.exceptions.json): file pattern, rule, the exact
// construct as this scan prints it, how many times it may occur, and a one-line reason. An exception
// that matches nothing is itself a failure — a dead exception is a hole waiting for a new construct.
//
// Usage:
//   node scripts/runtime-scan.mjs                       the repo's built coral bundles (corals.mjs)
//   node scripts/runtime-scan.mjs <dir|file>…           every .js/.mjs/.cjs under each target
//     --root DIR            paths are reported and matched relative to DIR (default: the repo root)
//     --exceptions FILE     the exception list (default: scripts/runtime-scan.exceptions.json;
//                           `none` for no exceptions)
//     --no-dead-check       do not fail on an exception that matched nothing (for scanning a
//                           directory the exception list was not written for, e.g. one registry version)
//     --json                print the result as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..');
export const DEFAULT_EXCEPTIONS = path.join(HERE, 'runtime-scan.exceptions.json');

export const RULES = {
  'cookie-write': 'a cookie written from script (`.cookie` as an assignment target)',
  'cookie-store': 'the Cookie Store API',
  'document-domain': '`document.domain`',
  'eval': '`eval`',
  'function-constructor': 'the `Function` constructor',
  'string-timer': '`setTimeout`/`setInterval` handed a string of code',
  'script-element': 'a script element created from script',
  'script-src': 'a `src` set from script (script elements cannot be told apart from others)',
  'worker': 'a dedicated or shared worker',
  'import-scripts': '`importScripts`',
  'service-worker': 'a service worker registration',
  'cache-storage': 'the Cache Storage API',
  'dynamic-import': '`import()` of anything but one string literal',
};

// ── Tokenizer ────────────────────────────────────────────────────────────────────────────────────
// Token: { type, value, raw, start, end, line, col }. type ∈ name | num | string | template |
// template-head | template-middle | template-tail | regex | private | punct. For strings and complete
// templates `value` is the cooked text; for names it is the identifier with escapes decoded.

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~',
  '?', ':', '=', '.', '@',
];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
// After these names a `/` starts a regular expression; after any other name it divides.
const REGEX_AFTER_NAME = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$\u200c\u200d]/u;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y;
const isNewline = (c) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
const isSpace = (c) => c === ' ' || c === '\t' || c === '\v' || c === '\f' || c === '\u00a0' || c === '\ufeff'
  || (c > '\u007f' && /\s/u.test(c));

function cook(raw) {
  // Decode the escapes of a string literal body. Enough to read `'scr\x69pt'` as `script`; it is
  // never used to build anything, only to compare.
  return raw.replace(/\\(?:x([\da-fA-F]{2})|u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|(\r\n|[\r\n\u2028\u2029])|([0-7]{1,3})|(.))/gsu,
    (_, x, uc, u, nl, oct, ch) => {
      if (x) return String.fromCharCode(parseInt(x, 16));
      if (uc) { const n = parseInt(uc, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
      if (u) return String.fromCharCode(parseInt(u, 16));
      if (nl) return '';
      if (oct) return String.fromCharCode(parseInt(oct, 8));
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[ch] ?? ch;
    });
}

export function tokenize(src) {
  const tokens = [];
  const braces = []; // 'brace' | 'template' — which kind of `{` each open `}` closes
  let i = 0, line = 1, lineStart = 0;
  const n = src.length;
  const newlineAt = (k) => { // count the line break at k; returns its length
    if (src[k] === '\r' && src[k + 1] === '\n') { line++; lineStart = k + 2; return 2; }
    line++; lineStart = k + 1; return 1;
  };
  const push = (type, value, start, end, sl, sc) => {
    tokens.push({ type, value, raw: src.slice(start, end), start, end, line: sl, col: sc });
  };
  const prevAllowsRegex = () => {
    const t = tokens[tokens.length - 1];
    if (!t) return true;
    if (t.type === 'name') return REGEX_AFTER_NAME.has(t.value);
    // After `)` and `]` a slash divides. After `}` it is taken as a regex: a block ends there far more
    // often than an object literal that is then divided by something.
    if (t.type === 'punct') return !(t.value === ')' || t.value === ']');
    if (t.type === 'template-head' || t.type === 'template-middle') return true;
    return false;
  };
  // Reads template characters from i (just past ` or }) to the closing ` or ${.
  const readTemplate = (start, sl, sc, opening) => {
    let k = i;
    while (k < n) {
      const c = src[k];
      if (c === '\\') { if (isNewline(src[k + 1])) { k += 1 + newlineAt(k + 1); continue; } k += 2; continue; }
      if (c === '`') {
        const body = src.slice(i, k);
        i = k + 1;
        push(opening ? 'template' : 'template-tail', cook(body), start, i, sl, sc);
        return;
      }
      if (c === '$' && src[k + 1] === '{') {
        const body = src.slice(i, k);
        i = k + 2;
        braces.push('template');
        push(opening ? 'template-head' : 'template-middle', cook(body), start, i, sl, sc);
        return;
      }
      if (isNewline(c)) { k += newlineAt(k); continue; }
      k++;
    }
    i = n; // unterminated: the rest of the file is template text
    push(opening ? 'template' : 'template-tail', cook(src.slice(start + 1)), start, n, sl, sc);
  };

  if (src.startsWith('#!')) { while (i < n && !isNewline(src[i])) i++; }
  while (i < n) {
    const c = src[i];
    if (isNewline(c)) { i += newlineAt(i); continue; }
    if (isSpace(c)) { i++; continue; }
    const start = i, sl = line, sc = i - lineStart + 1;
    // comments
    if (c === '/' && src[i + 1] === '/') { while (i < n && !isNewline(src[i])) i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? n : close + 2;
      for (let k = i + 2; k < stop; k++) if (isNewline(src[k])) { const w = newlineAt(k); k += w - 1; }
      i = stop;
      continue;
    }
    // strings
    if (c === '"' || c === "'") {
      let k = i + 1, ok = false;
      while (k < n) {
        const d = src[k];
        if (d === '\\') {
          if (isNewline(src[k + 1])) { k += 1 + newlineAt(k + 1); continue; }
          k += 2; continue;
        }
        if (d === c) { ok = true; break; }
        if (d === '\n' || d === '\r') break;
        if (isNewline(d)) { k += newlineAt(k); continue; } // U+2028/2029 are legal inside a string
        k++;
      }
      if (ok) {
        i = k + 1;
        push('string', cook(src.slice(start + 1, k)), start, i, sl, sc);
      } else { // not a string after all (or a broken one): treat the quote as a lone character
        i = start + 1;
        push('punct', c, start, i, sl, sc);
      }
      continue;
    }
    if (c === '`') { i++; readTemplate(start, sl, sc, true); continue; }
    if (c === '}' && braces[braces.length - 1] === 'template') {
      braces.pop(); i++; readTemplate(start, sl, sc, false); continue;
    }
    // regular expression literal
    if (c === '/' && prevAllowsRegex()) {
      let k = i + 1, inClass = false, ok = false;
      while (k < n) {
        const d = src[k];
        if (isNewline(d)) break;
        if (d === '\\') { k += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        k++;
      }
      if (ok) {
        k++;
        while (k < n && ID_CONTINUE.test(src[k])) k++;
        i = k;
        push('regex', src.slice(start, k), start, k, sl, sc);
        continue;
      } // no closing slash on this line: it was a division after all
    }
    // numbers
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      i += m ? m[0].length : 1;
      push('num', src.slice(start, i), start, i, sl, sc);
      continue;
    }
    // names (with unicode escapes decoded, so an escaped `eval` is `eval`) and #private names
    const first = c === '#' ? i + 1 : i;
    const ch0 = first < n ? String.fromCodePoint(src.codePointAt(first)) : '';
    if (ID_START.test(ch0) || (src[first] === '\\' && src[first + 1] === 'u')) {
      let k = first, name = '';
      while (k < n) {
        if (src[k] === '\\' && src[k + 1] === 'u') {
          const m = /^\\u(?:\{([\da-fA-F]+)\}|([\da-fA-F]{4}))/.exec(src.slice(k, k + 12));
          if (!m) break;
          name += String.fromCodePoint(parseInt(m[1] || m[2], 16));
          k += m[0].length;
          continue;
        }
        const ch = String.fromCodePoint(src.codePointAt(k));
        if (!(k === first ? ID_START : ID_CONTINUE).test(ch)) break;
        name += ch;
        k += ch.length;
      }
      if (k > first) {
        i = k;
        push(c === '#' ? 'private' : 'name', name, start, i, sl, sc);
        continue;
      }
    }
    // punctuators
    let p = null;
    for (const q of PUNCTUATORS) if (src.startsWith(q, i)) { p = q; break; }
    if (p === '?.' && src[i + 2] >= '0' && src[i + 2] <= '9') p = '?'; // `a?.5:b` is a conditional
    if (!p) p = c; // anything unknown is one character
    if (p === '{') braces.push('brace');
    else if (p === '}') braces.pop();
    i += p.length;
    push('punct', p, start, i, sl, sc);
  }
  return tokens;
}

// `x['name']` and `x?.['name']` with ONE string literal (or a template with no substitution) become
// `x.name`. Only after something that ends an expression — after `=`, `(` or `,` a `[` is an array.
function normalizeMembers(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k], s = tokens[k + 1], e = tokens[k + 2];
    const prev = out[out.length - 1];
    const endsExpr = prev && (prev.type === 'name' && !REGEX_AFTER_NAME.has(prev.value)
      || prev.type === 'string' || prev.type === 'template' || prev.type === 'template-tail' || prev.type === 'num'
      || prev.type === 'private' || (prev.type === 'punct' && (prev.value === ')' || prev.value === ']')));
    const optional = prev && prev.type === 'punct' && prev.value === '?.';
    if (t.type === 'punct' && t.value === '[' && s && (s.type === 'string' || s.type === 'template')
      && e && e.type === 'punct' && e.value === ']' && (endsExpr || optional)) {
      if (!optional) out.push({ ...t, type: 'punct', value: '.', raw: '.', synthetic: true });
      out.push({ ...s, type: 'name', value: s.value, synthetic: true });
      k += 2;
      continue;
    }
    out.push(t);
  }
  return out;
}

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────

const GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames']);
const isP = (t, v) => t && t.type === 'punct' && t.value === v;
const isDot = (t) => t && t.type === 'punct' && (t.value === '.' || t.value === '?.');
const isName = (t, v) => t && t.type === 'name' && (v === undefined || t.value === v);
const isStringish = (t) => t && (t.type === 'string' || t.type === 'template');

// An object-literal key (`{eval:1}`, `,eval:`). Not a reference to anything.
const isKey = (T, k) => isP(T[k + 1], ':') && (isP(T[k - 1], '{') || isP(T[k - 1], ','));
// The token AT k is a reference to the global binding of its name: not a property of something
// other than the global object, and not an object-literal key.
function globalRef(T, k) {
  const prev = T[k - 1];
  if (isDot(prev)) {
    const recv = T[k - 2];
    return isName(recv) && GLOBALS.has(recv.value) && !isDot(T[k - 3]);
  }
  return !isKey(T, k);
}
const isProperty = (T, k) => isDot(T[k - 1]);

// Index of the `)` closing the `(` at k (or the last token).
function closeParen(T, k) {
  let depth = 0;
  for (let j = k; j < T.length; j++) {
    const t = T[j];
    if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) depth++;
    else if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) { depth--; if (depth === 0) return j; }
    else if (t.type === 'template-head') depth++;
    else if (t.type === 'template-tail') depth--;
  }
  return T.length - 1;
}
// The token index where argument `index` (0-based) of the call whose `(` is at k begins, or -1.
function argStart(T, k, index) {
  if (index === 0) return isP(T[k + 1], ')') ? -1 : k + 1;
  let depth = 0, seen = 0;
  for (let j = k + 1; j < T.length; j++) {
    const t = T[j];
    if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{') || t.type === 'template-head') depth++;
    else if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}') || t.type === 'template-tail') {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0 && isP(t, ',')) { seen++; if (seen === index) return j + 1; }
  }
  return -1;
}
// A whole argument that is ONE string literal: the literal, then `,` or `)`.
const literalArg = (T, j) => j >= 0 && isStringish(T[j]) && (isP(T[j + 1], ',') || isP(T[j + 1], ')'));

// The start of the receiver chain ending just before the dot at k-1: `a.b.c` → index of `a`.
function chainStart(T, k) {
  let j = k;
  while (isDot(T[j - 1]) && (isName(T[j - 2]) || T[j - 2]?.type === 'private')) j -= 2;
  if (isDot(T[j - 1]) && isP(T[j - 2], ')')) { // `f().cookie` — include the call
    let depth = 0;
    for (let m = j - 2; m >= 0; m--) {
      if (isP(T[m], ')')) depth++;
      else if (isP(T[m], '(')) { depth--; if (depth === 0) { j = isName(T[m - 1]) ? m - 1 : m; break; } }
    }
  }
  return j;
}

// The construct's text as this scan prints it and as an exception names it: the tokens from `a` to
// `b` inclusive, with a space only where two words would otherwise run together, and every string
// spelled with double quotes. The same construct reads the same minified or not, whatever quotes the
// build chose.
function constructText(T, a, b) {
  let out = '';
  for (let j = a; j <= b && j < T.length; j++) {
    const t = T[j];
    const word = t.type === 'name' || t.type === 'num' || t.type === 'private';
    const prev = T[j - 1];
    if (j > a && word && prev && (prev.type === 'name' || prev.type === 'num' || prev.type === 'private') && !prev.synthetic) out += ' ';
    if (t.type === 'string') out += JSON.stringify(t.value);
    else if (t.synthetic && t.type === 'name') out += t.value;
    else out += t.type === 'private' ? '#' + t.value : t.type === 'name' ? t.value : t.raw;
    if (out.length > 240) return out.slice(0, 240) + '…';
  }
  return out;
}

export function scanSource(src) {
  const T = normalizeMembers(tokenize(src));
  const found = [];
  const add = (rule, at, a, b) => found.push({ rule, line: T[at].line, col: T[at].col, construct: constructText(T, a, b) });
  // the `(` of a call of the name at k — `f(` or the optional `f?.(` — or -1
  const callOpen = (k) => (isP(T[k + 1], '(') ? k + 1 : (isP(T[k + 1], '?.') && isP(T[k + 2], '(') ? k + 2 : -1));
  // the end of a reference: through the call's `)` when it is called, else the name itself
  const refEnd = (k) => (callOpen(k) >= 0 ? closeParen(T, callOpen(k)) : k);
  const refStart = (k) => (isDot(T[k - 1]) ? k - 2 : (isName(T[k - 1], 'new') ? k - 1 : k));

  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t.type !== 'name') continue;
    const v = t.value, next = T[k + 1];
    switch (v) {
      case 'cookie': {
        if (!isProperty(T, k)) break;
        const after = T[k + 1], before = T[chainStart(T, k) - 1];
        if (after && after.type === 'punct' && (ASSIGN.has(after.value) || after.value === '++' || after.value === '--')) {
          add('cookie-write', k, chainStart(T, k), k + 1);
        } else if (isP(before, '++') || isP(before, '--')) {
          add('cookie-write', k, chainStart(T, k) - 1, k);
        }
        break;
      }
      case 'cookieStore':
        if (!isKey(T, k)) add('cookie-store', k, chainStart(T, k), k);
        break;
      case 'domain':
        if (isProperty(T, k) && isName(T[k - 2], 'document') && !isDot(T[k - 3])) add('document-domain', k, k - 2, k);
        else if (isProperty(T, k) && isName(T[k - 2], 'document') && isDot(T[k - 3]) && isName(T[k - 4]) && GLOBALS.has(T[k - 4].value)) {
          add('document-domain', k, k - 4, k);
        }
        break;
      case 'eval':
        if (globalRef(T, k)) add('eval', k, refStart(T, k), refEnd(k));
        break;
      case 'Function': {
        if (!globalRef(T, k) || isName(T[k - 1], 'instanceof')) break;
        if (isDot(next) && !['call', 'apply', 'bind'].includes(T[k + 2]?.value)) break; // Function.prototype…
        add('function-constructor', k, refStart(T, k), refEnd(k));
        break;
      }
      case 'setTimeout': case 'setInterval':
        if (globalRef(T, k) && callOpen(k) >= 0) {
          const a = T[callOpen(k) + 1];
          if (a && (a.type === 'string' || a.type === 'template' || a.type === 'template-head')) {
            add('string-timer', k, refStart(T, k), closeParen(T, callOpen(k)));
          }
        }
        break;
      case 'createElement': case 'createElementNS':
        if (callOpen(k) >= 0) {
          const j = argStart(T, callOpen(k), v === 'createElement' ? 0 : 1);
          if (j >= 0 && isStringish(T[j]) && T[j].value.toLowerCase() === 'script') {
            add('script-element', k, chainStart(T, k), closeParen(T, callOpen(k)));
          }
        }
        break;
      case 'src':
        if (isProperty(T, k) && next && next.type === 'punct' && ASSIGN.has(next.value)) {
          add('script-src', k, chainStart(T, k), k + 1);
        }
        break;
      case 'setAttribute': case 'setAttributeNS':
        if (callOpen(k) >= 0) {
          const j = argStart(T, callOpen(k), v === 'setAttribute' ? 0 : 1);
          if (j >= 0 && isStringish(T[j]) && T[j].value.toLowerCase() === 'src') {
            add('script-src', k, chainStart(T, k), closeParen(T, callOpen(k)));
          }
        }
        break;
      case 'Worker': case 'SharedWorker':
        if (globalRef(T, k)) add('worker', k, isName(T[refStart(T, k) - 1], 'new') ? refStart(T, k) - 1 : refStart(T, k), refEnd(k));
        break;
      case 'importScripts':
        if (globalRef(T, k)) add('import-scripts', k, refStart(T, k), refEnd(k));
        break;
      case 'serviceWorker': {
        // Reported unless it is plainly used for something other than registering: `.serviceWorker.<x>`
        // with <x> not `register`. A bare `serviceWorker` held as a value may be registered later.
        const member = isDot(next) && isName(T[k + 2]) ? T[k + 2].value : null;
        if (member && member !== 'register') break;
        const end = member === 'register' && isP(T[k + 3], '(') ? closeParen(T, k + 3) : (member ? k + 2 : k);
        add('service-worker', k, chainStart(T, k), end);
        break;
      }
      case 'caches':
        if (globalRef(T, k)) add('cache-storage', k, refStart(T, k), isDot(next) && isName(T[k + 2]) ? k + 2 : k);
        break;
      case 'import':
        if (!isDot(T[k - 1]) && isP(next, '(') && !literalArg(T, k + 2)) {
          add('dynamic-import', k, k, closeParen(T, k + 1));
        }
        break;
      default:
    }
  }
  return found;
}

// ── Files, exceptions, verdict ───────────────────────────────────────────────────────────────────

const JS_FILE = /\.(?:m|c)?js$/;
export function listFiles(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  const out = [];
  for (const e of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(target, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile() && JS_FILE.test(e.name)) out.push(p);
  }
  return out;
}

// The repo's built coral bundles: <coral>/<coral>.js for every entry of corals.mjs.
export async function coralBundles() {
  const { CORALS } = await import(pathToFileURL(path.join(REPO, 'packages/dynamic-corals/corals.mjs')).href);
  return Object.keys(CORALS).map((name) => path.join(REPO, 'packages/dynamic-corals', name, `${name}.js`));
}

// `**` any number of segments, `*` and `?` within one.
export function globToRegExp(glob) {
  let re = '';
  for (let k = 0; k < glob.length; k++) {
    const c = glob[k];
    if (c === '*' && glob[k + 1] === '*') { re += glob[k + 2] === '/' ? '(?:.*/)?' : '.*'; k += glob[k + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// An exception is valid only if it is narrow: a known rule, a non-empty construct, a file pattern
// whose last segment is a literal file name, a count ≥ 1, and a reason that fits on one line.
export function validateExceptions(list) {
  const problems = [];
  if (!Array.isArray(list)) return ['`exceptions` is not an array'];
  list.forEach((x, k) => {
    const at = `exception #${k + 1}`;
    if (!x || typeof x !== 'object') { problems.push(`${at}: not an object`); return; }
    const keys = Object.keys(x).filter((key) => !['file', 'rule', 'construct', 'count', 'reason'].includes(key));
    if (keys.length) problems.push(`${at}: unknown key(s) ${keys.join(', ')}`);
    if (typeof x.file !== 'string' || !x.file) problems.push(`${at}: no file pattern`);
    else if (/[*?]/.test(x.file.split('/').pop())) problems.push(`${at}: the file pattern's last segment must be a literal file name, not ${JSON.stringify(x.file.split('/').pop())}`);
    if (!Object.hasOwn(RULES, x.rule)) problems.push(`${at}: unknown rule ${JSON.stringify(x.rule)}`);
    if (typeof x.construct !== 'string' || !x.construct.trim()) problems.push(`${at}: no construct`);
    if (x.count !== undefined && !(Number.isInteger(x.count) && x.count >= 1)) problems.push(`${at}: count must be a whole number ≥ 1`);
    if (typeof x.reason !== 'string' || !x.reason.trim() || /[\r\n]/.test(x.reason) || x.reason.length > 200) {
      problems.push(`${at}: the reason must be one line of at most 200 characters`);
    }
  });
  return problems;
}

export function loadExceptions(file) {
  if (!file || file === 'none') return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = data.exceptions;
  const problems = validateExceptions(list);
  if (problems.length) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
  return list;
}

// findings: [{ file, rule, line, col, construct }] → which are excepted, which fail, which
// exceptions matched nothing, and which matched more often than their count allows.
export function applyExceptions(findings, exceptions) {
  const used = exceptions.map(() => 0);
  const matchers = exceptions.map((x) => globToRegExp(x.file));
  const failures = [], excepted = [];
  for (const f of findings) {
    const k = exceptions.findIndex((x, j) => x.rule === f.rule && x.construct === f.construct
      && matchers[j].test(f.file) && used[j] < (x.count ?? 1));
    if (k >= 0) { used[k]++; excepted.push({ ...f, exception: k }); } else failures.push(f);
  }
  const dead = exceptions.map((x, k) => ({ ...x, index: k, matched: used[k] })).filter((x) => x.matched === 0);
  const short = exceptions.map((x, k) => ({ ...x, index: k, matched: used[k] }))
    .filter((x) => x.matched > 0 && x.matched < (x.count ?? 1));
  return { failures, excepted, dead, short };
}

export function scanFiles(files, { root = REPO, exceptions = [] } = {}) {
  const findings = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const f of scanSource(fs.readFileSync(file, 'utf8'))) findings.push({ file: rel, ...f });
  }
  return { files: files.length, findings, ...applyExceptions(findings, exceptions) };
}

export async function scan({ targets = [], root = REPO, exceptionsFile = DEFAULT_EXCEPTIONS } = {}) {
  const files = targets.length ? targets.flatMap((t) => listFiles(path.resolve(t))) : await coralBundles();
  return scanFiles(files, { root, exceptions: loadExceptions(exceptionsFile) });
}

const where = (f) => `${f.file}:${f.line}:${f.col}`;
export function report(result, { deadCheck = true } = {}) {
  const lines = [];
  for (const f of result.failures) lines.push(`✗ ${where(f)}  ${f.rule} — ${RULES[f.rule]}\n    ${f.construct}`);
  if (deadCheck) {
    for (const x of result.dead) lines.push(`✗ dead exception #${x.index + 1} (${x.file}, ${x.rule}) matches nothing — remove it\n    ${x.construct}`);
    for (const x of result.short) lines.push(`✗ exception #${x.index + 1} (${x.file}, ${x.rule}) allows ${x.count} but matched ${x.matched} — lower its count\n    ${x.construct}`);
  }
  const ok = lines.length === 0;
  lines.push(`${ok ? '✓' : '✗'} runtime scan: ${result.files} file(s), ${result.findings.length} construct(s) found, `
    + `${result.excepted.length} excepted, ${result.failures.length} refused`);
  return { ok, text: lines.join('\n') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const k = argv.indexOf(name); if (k < 0) return undefined; const v = argv[k + 1]; argv.splice(k, 2); return v; };
  const flag = (name) => { const k = argv.indexOf(name); if (k < 0) return false; argv.splice(k, 1); return true; };
  const root = path.resolve(opt('--root') ?? REPO);
  const exceptionsFile = opt('--exceptions') ?? DEFAULT_EXCEPTIONS;
  const deadCheck = !flag('--no-dead-check');
  const json = flag('--json');
  const unknown = argv.filter((a) => a.startsWith('--'));
  if (unknown.length) { console.error(`runtime-scan: unknown option ${unknown.join(' ')}`); process.exit(2); }
  const result = await scan({ targets: argv, root, exceptionsFile });
  if (result.files === 0) { console.error('✗ runtime scan: no JavaScript files under the given target(s) — nothing was checked'); process.exit(1); }
  const { ok, text } = report(result, { deadCheck });
  if (json) console.log(JSON.stringify({ ok, ...result }, null, 2));
  else console.log(text);
  process.exit(ok ? 0 : 1);
}
