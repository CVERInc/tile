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
//   cookie-write          `<x>.cookie` / `<x>['cookie']` as an assignment, ++/-- or for-in/of target, on ANY receiver
//   cookie-store          any `cookieStore`
//   document-domain       `.domain` / `['domain']` of `document`, `ownerDocument` or `contentDocument`, read or write
//   eval                  `eval` referenced at all (`eval(`, `(0,eval)(`, `window.eval`, `x.self.eval`, `const e=eval`)
//   function-constructor  `Function` constructed or aliased (`new Function`, `Function(`, `Function?.(`, `F=Function`,
//                         `Function.call/apply/bind/constructor`, `Function.prototype.constructor`); the rest of
//                         `Function.prototype…` and `instanceof Function` pass
//   string-timer          `setTimeout` / `setInterval` (also called as `(0,setTimeout)(…)`) whose first argument
//                         can evaluate to a string literal as a whole: `"code"`, `("code")`, `f?"a()":"b()"`,
//                         `"a("+n+")"` — not one inside a call or a function (`()=>f("a")`)
//   script-element        `createElement('script')` in any quote style or case; `createElementNS(ns, 'script')`;
//                         a conditional with a `'script'` arm (`createElement(f?'script':'div')`)
//   script-src            `.src =` / `['src'] =` on ANY element, `setAttribute('src', …)` (or a `'src'` arm),
//                         `setAttributeNS(ns, 'src', …)` — the scan cannot tell a script element from an image
//                         in minified code, so every one is reported (false positives by design)
//   worker                any `Worker` / `SharedWorker` reference (`new Worker(`, `new window.SharedWorker(`)
//   import-scripts        any `importScripts`
//   service-worker        `serviceWorker.register`, or `serviceWorker` held as a value (`s=navigator.serviceWorker`)
//   cache-storage         any `caches` reference (`caches.open`, `self.caches`)
//   dynamic-import        `import(…)` whose argument is anything but ONE string literal
//   unscannable           what the scan cannot read: an unterminated comment, string, template or regex, or
//                         an HTML-like comment (`<!--`, or `-->` first on a line), which a classic script
//                         reads as a comment and a module as operators. FAIL CLOSED: never a silent stop.
//
// `eval`, `Function`, `Worker`, `SharedWorker`, `importScripts`, `caches` and `cookieStore` are also
// reported as the KEY of a destructuring pattern (`const{eval:e}=globalThis`, `({Worker:W})=>…`), and
// as a property of a global object wherever that object came from (`el.ownerDocument.defaultView.eval`).
// This scan prefers a false positive to a false negative.
//
// HOW: a JavaScript TOKENIZER, not a regex over text. Comments, string contents, template text and
// regex literals are skipped, so a token inside them is not code; whitespace and line breaks do not
// matter, so a minified bundle reads the same as a pretty one. `x['name']` with one string literal is
// read as `x.name`, and a unicode escape in an identifier (backslash-u-0065 for `e`) is decoded, so an
// escaped `eval` is still `eval`. Rules match global names and
// property names, never minifier-chosen local names; a method DEFINED under a global's name
// (`class A{eval(x){…}}`) is not a reference to it. A `/` is a regex after `(`, an operator, a
// keyword (not a property NAMED like one: `o.in/2`; `of` only in a for head), `}`, a prefix `++`/`--`,
// or the `)` of `if`/`for`/`while`/`with`; after a name, a number, `]`, a postfix `++`/`--` or any
// other `)` it divides. The one known misreading is a `/` dividing an
// object literal (`{a:1}/2`), read as a regex start: telling it from a block needs a parser.
//
// 🔴 A TRIPWIRE, NOT A PROOF. It reports what the tokens SAY; it does not follow values. The known
// false negatives (constructs that load code or write cookies and pass this scan) are listed in
// test/runtime-scan.test.mjs, each one as a passing assertion, so the list cannot silently go stale.
//
// Exceptions live in ONE file (scripts/runtime-scan.exceptions.json): file pattern, rule, the exact
// construct as this scan prints it (whole: an assignment includes its value), how many times it may
// occur IN EACH FILE the pattern matches, and a one-line reason. An exception that matches nothing is
// itself a failure — a dead exception is a hole waiting for a new construct.
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
  'unscannable': 'source the scan cannot read (an unterminated comment, string, template or regex, or an HTML-like comment)',
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
// `of` is a keyword only in a for head (`var of = 4; of / 2` divides), and none of these is one when it
// is a property name (`o.in / 2`, `e.default / 2`).
const REGEX_AFTER_NAME = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'extends', 'default']);
// A `(` opened right after one of these keywords closes on a `)` after which a statement starts.
const CONTROL = new Set(['if', 'for', 'while', 'with']);
const controlParen = (tokens) => {
  let k = tokens.length - 1;
  if (tokens[k]?.type === 'name' && tokens[k].value === 'await' && tokens[k - 1]?.type === 'name' && tokens[k - 1].value === 'for') k--; // for await (
  const t = tokens[k], before = tokens[k - 1];
  return t?.type === 'name' && CONTROL.has(t.value) && !(before?.type === 'punct' && (before.value === '.' || before.value === '?.'))
    ? t.value : null;
};
const IDENT_ESCAPE = /\\u(?:\{([\da-fA-F]+)\}|([\da-fA-F]{4}))/y;
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
  const lineEnd = (k) => { while (k < n && !isNewline(src[k])) k++; return k; };
  // FAIL CLOSED: what the scan cannot read is itself a finding (rule `unscannable`), never a silent
  // stop. The token covers the rest of its line; reading resumes on the next one.
  const unscannable = (what, start, sl, sc) => { const end = lineEnd(start); push('unscannable', what, start, end, sl, sc); return end; };
  const parens = []; // for each open `(`: the `if`/`for`/`while`/`with` it belongs to, or null
  // Would a `/` right after token k start a regex (rather than divide)?
  const regexAfter = (k) => {
    const t = tokens[k];
    if (!t) return true;
    if (t.type === 'name') {
      const before = tokens[k - 1];
      if (before?.type === 'punct' && (before.value === '.' || before.value === '?.')) return false; // a property
      if (t.value === 'of') { // the keyword only after the binding of a for head: `for (x of /re/…)`
        return parens[parens.length - 1] === 'for' && !!before && (before.type === 'name' || (before.type === 'punct' && (before.value === ']' || before.value === '}')));
      }
      return REGEX_AFTER_NAME.has(t.value);
    }
    if (t.type === 'punct') {
      // After the `)` of `if (…)` / `for (…)` / `while (…)` / `with (…)` a statement starts; after any
      // other `)`, and after `]`, a slash divides.
      if (t.value === ')') return !!t.control;
      if (t.value === ']') return false;
      // `a++ / 2` divides; `++/re/.x` is a prefix `++` on a regex. `++` is postfix when a slash in its
      // place would have divided, and no line break comes before it (one may not come before a postfix).
      if (t.value === '++' || t.value === '--') {
        const before = tokens[k - 1];
        if (!before || before.line !== t.line) return true;
        if (before.type === 'punct' && (before.value === '++' || before.value === '--')) return true; // no recursion on `++++…`
        return regexAfter(k - 1);
      }
      // After `}` it is taken as a regex: a block ends there far more often than an object literal
      // that is then divided by something.
      return true;
    }
    if (t.type === 'template-head' || t.type === 'template-middle') return true;
    return false;
  };
  const prevAllowsRegex = () => regexAfter(tokens.length - 1);
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
    // unterminated: the rest of the file would be template text
    unscannable('an unterminated template literal', start, sl, sc);
    i = n;
  };

  if (src.startsWith('#!')) { while (i < n && !isNewline(src[i])) i++; }
  while (i < n) {
    const c = src[i];
    if (isNewline(c)) { i += newlineAt(i); continue; }
    if (isSpace(c)) { i++; continue; }
    const start = i, sl = line, sc = i - lineStart + 1;
    // comments
    if (c === '/' && src[i + 1] === '/') { i = lineEnd(i); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close < 0) { i = unscannable('an unterminated block comment', start, sl, sc); i = n; continue; }
      for (let k = i + 2; k < close + 2; k++) if (isNewline(src[k])) { const w = newlineAt(k); k += w - 1; }
      i = close + 2;
      continue;
    }
    // Annex B HTML-like comments: `<!--` anywhere, `-->` first on its line. A line comment in a classic
    // script, operators in a module (`a<!--b`, `a\n-->b`): which one runs is not in the file, so it is
    // reported, and read as the comment a browser running it as a classic script would see.
    if (c === '<' && src.startsWith('<!--', i)) { i = unscannable('an HTML-like comment `<!--`', start, sl, sc); continue; }
    if (c === '-' && src.startsWith('-->', i)) {
      const last = tokens[tokens.length - 1];
      if (!last || /[\n\r\u2028\u2029]/.test(src.slice(last.end, i))) { i = unscannable('an HTML-like comment `-->`', start, sl, sc); continue; }
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
      } else { // a quote that never closes: a broken file, or a `/` read the wrong way before it
        i = unscannable('an unterminated string literal', start, sl, sc);
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
      }
      // no closing slash on this line: a broken regex, or a division read as one
      i = unscannable('an unterminated regular expression literal', start, sl, sc);
      continue;
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
          IDENT_ESCAPE.lastIndex = k; // `\u{0000000065}`: any number of leading zeros is legal
          const m = IDENT_ESCAPE.exec(src);
          if (!m || parseInt(m[1] || m[2], 16) > 0x10ffff) break;
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
    else if (p === '(') parens.push(controlParen(tokens));
    i += p.length;
    push('punct', p, start, i, sl, sc);
    if (p === ')' && parens.length && parens.pop()) tokens[tokens.length - 1].control = true;
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
    const before = out[out.length - 2];
    const endsExpr = prev && (prev.type === 'name' && (!REGEX_AFTER_NAME.has(prev.value) || prev.value === 'of'
        || (before?.type === 'punct' && (before.value === '.' || before.value === '?.')))
      || prev.type === 'string' || prev.type === 'template' || prev.type === 'template-tail' || prev.type === 'num'
      || prev.type === 'private' || (prev.type === 'punct' && (prev.value === ')' || prev.value === ']')));
    const optional = prev && prev.type === 'punct' && prev.value === '?.';
    if (t.type === 'punct' && t.value === '[' && s && (s.type === 'string' || s.type === 'template')
      && e && e.type === 'punct' && e.value === ']' && (endsExpr || optional)) {
      if (!optional) out.push({ ...t, type: 'punct', value: '.', raw: '.', synthetic: true });
      out.push({ ...s, type: 'name', value: s.value, end: e.end, synthetic: true });
      k += 2;
      continue;
    }
    out.push(t);
  }
  return out;
}

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────

const GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames']);
// A property of one of these is a property of a global object, whatever comes before it
// (`window.self.eval`, `el.ownerDocument.defaultView.eval`, `frame.contentWindow.Function`).
const GLOBAL_RECEIVERS = new Set([...GLOBALS, 'defaultView', 'contentWindow']);
const DOCUMENTS = new Set(['document', 'ownerDocument', 'contentDocument']);
const isP = (t, v) => t && t.type === 'punct' && t.value === v;
const isDot = (t) => t && t.type === 'punct' && (t.value === '.' || t.value === '?.');
const isName = (t, v) => t && t.type === 'name' && (v === undefined || t.value === v);
const isStringish = (t) => t && (t.type === 'string' || t.type === 'template');
const OPEN = new Set(['(', '[', '{']), CLOSE = new Set([')', ']', '}']);

// An object-literal key (`{eval:1}`, `,eval:`), or the key of a destructuring pattern.
const isKey = (T, k) => isP(T[k + 1], ':') && (isP(T[k - 1], '{') || isP(T[k - 1], ','));
// The index of the bracket that encloses token k, or -1.
function enclosingOpen(T, k) {
  let depth = 0;
  for (let j = k - 1; j >= 0; j--) {
    const t = T[j];
    if (t.type === 'punct' && CLOSE.has(t.value)) depth++;
    else if (t.type === 'punct' && OPEN.has(t.value)) { if (depth === 0) return j; depth--; }
  }
  return -1;
}
const DECLARE = new Set(['var', 'let', 'const']);
const NOT_PARAMS = new Set(['if', 'for', 'while', 'with', 'switch', 'return', 'typeof', 'void', 'delete', 'new', 'in', 'of', 'instanceof', 'await', 'yield']);
// Is the key at k inside a destructuring pattern — `const{eval:e}=…`, `({eval:e}=…)`,
// `for(const{eval:e}of…)`, `function f({eval:e}){`, `({Worker:W})=>` — rather than an object
// literal? Some enclosing `{`/`[` is declared or assigned to, or some enclosing `(` is a parameter list.
// It errs towards "pattern": a literal used as a default inside a pattern is reported too.
function inPattern(T, k) {
  for (let o = enclosingOpen(T, k); o >= 0; o = enclosingOpen(T, o)) {
    const c = closeParen(T, o), before = T[o - 1], after = T[c + 1];
    if (T[o].value === '(') {
      const params = isP(after, '=>') || (isP(after, '{') && after.line === T[c].line
        && !(isName(before) && NOT_PARAMS.has(before.value)) && (isName(before) || isP(before, '*')));
      if (params) return true;
    } else if ((isName(before) && DECLARE.has(before.value)) || isP(after, '=') || isName(after, 'of') || isName(after, 'in')) {
      return true;
    }
  }
  return false;
}
// A method or accessor DEFINED under this name (`class A{eval(x){…}}`, `{get caches(){…}}`): after a
// member boundary or a modifier, `name(…) {` with the `{` on the `)`'s line. A call cannot be followed
// by `{` without a line break between them; `extends eval(x) {` is a call and is not after a boundary.
const METHOD_BEFORE = new Set(['{', '}', ';', ',', '*']);
const METHOD_MODIFIERS = new Set(['static', 'async', 'get', 'set']);
function methodDefinition(T, k) {
  const prev = T[k - 1];
  if (!isP(T[k + 1], '(')) return false;
  if (!(prev && (prev.type === 'punct' ? METHOD_BEFORE.has(prev.value) : isName(prev) && METHOD_MODIFIERS.has(prev.value)))) return false;
  const close = closeParen(T, k + 1), body = T[close + 1];
  return isP(T[close], ')') && isP(body, '{') && body.line === T[close].line;
}
// The token AT k is a reference to the global binding of its name — or names it as the key of a
// destructuring pattern (`const{eval:e}=globalThis`): not a property of something other than a
// global object, not an object-literal key, and not a method defined under that name.
function globalRef(T, k) {
  const prev = T[k - 1];
  if (isDot(prev)) {
    const recv = T[k - 2];
    return isName(recv) && GLOBAL_RECEIVERS.has(recv.value);
  }
  if (isKey(T, k)) return inPattern(T, k);
  return !methodDefinition(T, k);
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
// Index of the `(` opening the `)` at k, or -1.
function openParen(T, k) {
  let depth = 0;
  for (let j = k; j >= 0; j--) {
    const t = T[j];
    if (t.type === 'punct' && CLOSE.has(t.value)) depth++;
    else if (t.type === 'punct' && OPEN.has(t.value)) { depth--; if (depth === 0) return j; }
  }
  return -1;
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
// The string literals the argument starting at j can EVALUATE to as a whole: those not inside a call,
// an array, an object, a function or a template substitution — only inside grouping parentheses and
// operators. `"a"`, `("a")`, `f ? "a" : "b"`, `"a(" + n + ")"`, `` `a${n}` `` all have some;
// `f("a")`, `() => g("a")`, `function(){ h("a") }` have none.
function wholeArgStrings(T, j) {
  const out = [], stack = [];
  for (let m = j; m < T.length; m++) {
    const t = T[m];
    if (t.type === 'punct' && OPEN.has(t.value)) {
      const p = T[m - 1];
      const call = t.value === '(' && p && (isName(p) && !NOT_PARAMS.has(p.value) || isP(p, ')') || isP(p, ']') || p.type === 'template' || p.type === 'template-tail');
      stack.push(t.value === '(' && !call ? 'group' : 'other');
    } else if (t.type === 'punct' && CLOSE.has(t.value)) {
      if (!stack.length) break;
      stack.pop();
    } else if (t.type === 'template-head') {
      if (stack.every((x) => x === 'group')) out.push(t);
      stack.push('other');
    } else if (t.type === 'template-tail') {
      stack.pop();
    } else if (!stack.length && isP(t, ',')) break;
    else if ((t.type === 'string' || t.type === 'template') && stack.every((x) => x === 'group')) out.push(t);
  }
  return out;
}
// Index of the last token of the expression that starts at j: up to a `,` / `;` / closing bracket at
// its own depth, a `:` that closes no `?`, or a line break where a statement plainly ends.
const ENDS_VALUE = (t) => t && (t.type === 'num' || t.type === 'string' || t.type === 'template' || t.type === 'template-tail'
  || t.type === 'regex' || t.type === 'private' || (isName(t) && !NOT_PARAMS.has(t.value)) || isP(t, ')') || isP(t, ']') || isP(t, '}'));
const STARTS_STATEMENT = (t) => t && (t.type === 'num' || t.type === 'string' || t.type === 'template' || t.type === 'template-head'
  || t.type === 'private' || (isName(t) && !['in', 'of', 'instanceof'].includes(t.value)));
function exprEnd(T, j) {
  let depth = 0, conditional = 0, m = j;
  for (; m < T.length; m++) {
    const t = T[m];
    if (t.type === 'punct' && OPEN.has(t.value) || t.type === 'template-head') depth++;
    else if (t.type === 'punct' && CLOSE.has(t.value) || t.type === 'template-tail') { if (depth === 0) return m - 1; depth--; }
    else if (depth === 0 && (isP(t, ',') || isP(t, ';') || t.type === 'template-middle')) return m - 1;
    else if (depth === 0 && isP(t, '?')) conditional++;
    else if (depth === 0 && isP(t, ':')) { if (conditional === 0) return m - 1; conditional--; }
    const next = T[m + 1];
    if (depth === 0 && next && next.line > t.line && ENDS_VALUE(t) && STARTS_STATEMENT(next)) return m;
  }
  return T.length - 1;
}

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
// build chose. It is never shortened: an exception must name all of it (the report shortens).
function constructText(T, a, b) {
  let out = '';
  for (let j = a; j <= b && j < T.length; j++) {
    const t = T[j];
    const word = t.type === 'name' || t.type === 'num' || t.type === 'private';
    const prev = T[j - 1];
    if (j > a && word && prev && (prev.type === 'name' || prev.type === 'num' || prev.type === 'private') && !prev.synthetic) out += ' ';
    if (t.type === 'string') out += JSON.stringify(t.value);
    else if (t.type === 'unscannable') out += t.raw.trim();
    else if (t.synthetic && t.type === 'name') out += t.value;
    else out += t.type === 'private' ? '#' + t.value : t.type === 'name' ? t.value : t.raw;
  }
  return out;
}
// A piece of source as the scan spells a construct (what a finding's span reads as).
export const spell = (src) => { const T = normalizeMembers(tokenize(src)); return constructText(T, 0, T.length - 1); };

export function scanSource(src) {
  const T = normalizeMembers(tokenize(src));
  const found = [];
  const add = (rule, at, a, b) => found.push({
    rule, line: T[at].line, col: T[at].col, construct: constructText(T, a, b), start: T[a].start, end: T[Math.min(b, T.length - 1)].end,
  });
  // the `(` of a call of the name at k — `f(`, the optional `f?.(`, or the grouped `(0,f)(` — or -1
  const grouped = (k) => isP(T[k + 1], ')') && isP(T[k + 2], '(');
  const callOpen = (k) => (isP(T[k + 1], '(') ? k + 1 : (isP(T[k + 1], '?.') && isP(T[k + 2], '(') ? k + 2 : (grouped(k) ? k + 2 : -1)));
  // the end of a reference: through the call's `)` when it is called, through the bound name of a
  // pattern key (`eval:e`), else the name itself
  const refEnd = (k) => (callOpen(k) >= 0 ? closeParen(T, callOpen(k)) : (isKey(T, k) ? k + 2 : k));
  // the start of a reference: its receiver chain, a `new` before it, the group it is called through
  const refStart = (k) => {
    let s = isDot(T[k - 1]) ? chainStart(T, k) : k;
    if (grouped(k)) { const o = openParen(T, k + 1); if (o >= 0 && o < s) s = o; }
    return isName(T[s - 1], 'new') ? s - 1 : s;
  };

  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t.type === 'unscannable') { add('unscannable', k, k, k); continue; }
    if (t.type !== 'name') continue;
    const v = t.value, next = T[k + 1];
    switch (v) {
      case 'cookie': {
        if (!isProperty(T, k)) break;
        const cs = chainStart(T, k), after = T[k + 1], before = T[cs - 1];
        if (after && after.type === 'punct' && ASSIGN.has(after.value)) {
          add('cookie-write', k, cs, exprEnd(T, k + 2));
        } else if (isP(after, '++') || isP(after, '--')) {
          add('cookie-write', k, cs, k + 1);
        } else if (isP(before, '++') || isP(before, '--')) {
          add('cookie-write', k, cs - 1, k);
        } else if ((isName(after, 'of') || isName(after, 'in')) && isP(before, '(') && (isName(T[cs - 2], 'for') || isName(T[cs - 2], 'await'))) {
          add('cookie-write', k, cs, k + 1); // `for (document.cookie of values)`
        }
        break;
      }
      case 'cookieStore':
        if (isKey(T, k) ? inPattern(T, k) : !methodDefinition(T, k)) add('cookie-store', k, chainStart(T, k), isKey(T, k) ? k + 2 : k);
        break;
      case 'domain':
        if (isProperty(T, k) && isName(T[k - 2]) && DOCUMENTS.has(T[k - 2].value)) {
          const assigned = next && next.type === 'punct' && ASSIGN.has(next.value);
          add('document-domain', k, chainStart(T, k), assigned ? exprEnd(T, k + 2) : k);
        }
        break;
      case 'eval':
        if (globalRef(T, k)) add('eval', k, refStart(k), refEnd(k));
        break;
      case 'Function': {
        if (!globalRef(T, k) || isName(T[k - 1], 'instanceof')) break;
        let end = refEnd(k);
        if (isP(next, '.') || (isP(next, '?.') && isName(T[k + 2]))) { // a member of Function
          let m = k + 2;
          if (isName(T[m], 'prototype') && isDot(T[m + 1]) && isName(T[m + 2], 'constructor')) m += 2; // Function.prototype.constructor
          else if (!['call', 'apply', 'bind', 'constructor'].includes(T[m]?.value)) break; // Function.prototype…, Function.name
          end = refEnd(m);
        }
        add('function-constructor', k, refStart(k), end);
        break;
      }
      case 'setTimeout': case 'setInterval':
        // whatever the first argument can evaluate to as a whole: a string literal there is code
        if (globalRef(T, k) && callOpen(k) >= 0 && argStart(T, callOpen(k), 0) >= 0 && wholeArgStrings(T, callOpen(k) + 1).length) {
          add('string-timer', k, refStart(k), closeParen(T, callOpen(k)));
        }
        break;
      case 'createElement': case 'createElementNS':
        if (callOpen(k) >= 0) {
          const j = argStart(T, callOpen(k), v === 'createElement' ? 0 : 1);
          if (j >= 0 && wholeArgStrings(T, j).some((s) => s.type !== 'template-head' && s.value.toLowerCase() === 'script')) {
            add('script-element', k, chainStart(T, k), closeParen(T, callOpen(k)));
          }
        }
        break;
      case 'src':
        if (isProperty(T, k) && next && next.type === 'punct' && ASSIGN.has(next.value)) {
          add('script-src', k, chainStart(T, k), exprEnd(T, k + 2));
        }
        break;
      case 'setAttribute': case 'setAttributeNS':
        if (callOpen(k) >= 0) {
          const j = argStart(T, callOpen(k), v === 'setAttribute' ? 0 : 1);
          if (j >= 0 && wholeArgStrings(T, j).some((s) => s.type !== 'template-head' && s.value.toLowerCase() === 'src')) {
            add('script-src', k, chainStart(T, k), closeParen(T, callOpen(k)));
          }
        }
        break;
      case 'Worker': case 'SharedWorker':
        if (globalRef(T, k)) add('worker', k, refStart(k), refEnd(k));
        break;
      case 'importScripts':
        if (globalRef(T, k)) add('import-scripts', k, refStart(k), refEnd(k));
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
        if (globalRef(T, k)) add('cache-storage', k, refStart(k), isDot(next) && isName(T[k + 2]) ? k + 2 : (isKey(T, k) ? k + 2 : k));
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
    else if (!x.file.split('/').pop() || /[*?]/.test(x.file.split('/').pop())) problems.push(`${at}: the file pattern's last segment must be a literal file name, not ${JSON.stringify(x.file.split('/').pop())}`);
    if (!Object.hasOwn(RULES, x.rule)) problems.push(`${at}: unknown rule ${JSON.stringify(x.rule)}`);
    if (typeof x.construct !== 'string' || !x.construct.trim()) problems.push(`${at}: no construct`);
    if (x.count !== undefined && !(Number.isInteger(x.count) && x.count >= 1)) problems.push(`${at}: count must be a whole number ≥ 1`);
    if (typeof x.reason !== 'string' || !x.reason.trim() || /[\r\n]/.test(x.reason) || x.reason.length > 200) {
      problems.push(`${at}: the reason must be one line of at most 200 characters`);
    }
  });
  return problems;
}

// A problem with what the scan was ASKED to do (an unreadable or invalid exception list, a target
// that is not there), as opposed to a finding. The CLI prints its one-line message and exits 2.
export class UsageError extends Error {}

export function loadExceptions(file) {
  if (!file || file === 'none') return [];
  let text, data;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`cannot read the exception list ${file} (${e.code || e.message})`); }
  try { data = JSON.parse(text); } catch (e) { throw new UsageError(`the exception list ${file} is not valid JSON (${e.message.split('\n')[0]})`); }
  const list = data && typeof data === 'object' ? data.exceptions : undefined;
  const problems = validateExceptions(list);
  if (problems.length) throw new UsageError(`invalid exception list ${file}: ${problems.join('; ')}`);
  return list;
}

// findings: [{ file, rule, line, col, construct }] → which are excepted, which fail, which
// exceptions matched nothing, and in which file an exception matched fewer times than its count.
// The count is PER MATCHED FILE: a `**/loader.js` pattern may match several files, and each of them
// gets its own count — one file's allowance is never spent, or inherited, by another.
export function applyExceptions(findings, exceptions) {
  const used = exceptions.map(() => new Map()); // file → occurrences excused there
  const matchers = exceptions.map((x) => globToRegExp(x.file));
  const failures = [], excepted = [];
  for (const f of findings) {
    const k = exceptions.findIndex((x, j) => x.rule === f.rule && x.construct === f.construct
      && matchers[j].test(f.file) && (used[j].get(f.file) ?? 0) < (x.count ?? 1));
    if (k >= 0) { used[k].set(f.file, (used[k].get(f.file) ?? 0) + 1); excepted.push({ ...f, exception: k }); } else failures.push(f);
  }
  const dead = exceptions.map((x, k) => ({ ...x, index: k, matched: 0 })).filter((x) => used[x.index].size === 0);
  const short = exceptions.flatMap((x, k) => [...used[k]].filter(([, n]) => n < (x.count ?? 1))
    .map(([file, matched]) => ({ ...x, pattern: x.file, file, index: k, matched })));
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
  for (const t of targets) if (!fs.existsSync(t)) throw new UsageError(`no such file or directory: ${t}`);
  const files = targets.length ? targets.flatMap((t) => listFiles(path.resolve(t))) : await coralBundles();
  return scanFiles(files, { root, exceptions: loadExceptions(exceptionsFile) });
}

const where = (f) => `${f.file}:${f.line}:${f.col}`;
export function report(result, { deadCheck = true } = {}) {
  const lines = [];
  // a long construct is shortened on screen only; it is matched, and printed by --json, whole
  const shown = (c) => (c.length > 240 ? `${c.slice(0, 240)}… (${c.length} characters)` : c);
  for (const f of result.failures) lines.push(`✗ ${where(f)}  ${f.rule} — ${RULES[f.rule]}\n    ${shown(f.construct)}`);
  if (deadCheck) {
    for (const x of result.dead) lines.push(`✗ dead exception #${x.index + 1} (${x.file}, ${x.rule}) matches nothing — remove it\n    ${shown(x.construct)}`);
    for (const x of result.short) lines.push(`✗ exception #${x.index + 1} (${x.pattern}, ${x.rule}) allows ${x.count} per file but matched ${x.matched} in ${x.file} — lower its count\n    ${shown(x.construct)}`);
  }
  const ok = lines.length === 0;
  lines.push(`${ok ? '✓' : '✗'} runtime scan: ${result.files} file(s), ${result.findings.length} construct(s) found, `
    + `${result.excepted.length} excepted, ${result.failures.length} refused`);
  return { ok, text: lines.join('\n') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const k = argv.indexOf(name);
    if (k < 0) return undefined;
    const v = argv[k + 1];
    if (v === undefined || v.startsWith('--')) { console.error(`runtime-scan: ${name} needs a value`); process.exit(2); }
    argv.splice(k, 2);
    return v;
  };
  const flag = (name) => { const k = argv.indexOf(name); if (k < 0) return false; argv.splice(k, 1); return true; };
  const root = path.resolve(opt('--root') ?? REPO);
  const exceptionsFile = opt('--exceptions') ?? DEFAULT_EXCEPTIONS;
  const deadCheck = !flag('--no-dead-check');
  const json = flag('--json');
  const unknown = argv.filter((a) => a.startsWith('--'));
  if (unknown.length) { console.error(`runtime-scan: unknown option ${unknown.join(' ')}`); process.exit(2); }
  let result;
  try {
    result = await scan({ targets: argv, root, exceptionsFile });
  } catch (e) {
    if (!(e instanceof UsageError)) throw e; // a bug in the scan itself keeps its stack trace
    console.error(`runtime-scan: ${e.message.replace(/[\r\n\u2028\u2029]+/g, ' ')}`);
    process.exit(2);
  }
  if (result.files === 0) { console.error('✗ runtime scan: no JavaScript files under the given target(s) — nothing was checked'); process.exit(1); }
  const { ok, text } = report(result, { deadCheck });
  if (json) console.log(JSON.stringify({ ok, ...result }, null, 2));
  else console.log(text);
  process.exit(ok ? 0 : 1);
}
