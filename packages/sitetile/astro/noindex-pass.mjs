// reef#2554 — which emitted pages are noindex, decided AFTER the build, over the files it wrote.
//
// A page is noindex when its OWN source says `noindex: true`, or — by default — when an
// `action=inbox` form's `thanks=` sends a visitor to it after a successful submit. An explicit
// `noindex: false` on that source wins: some owners want their thanks page found. One decision, two
// consumers that must agree about it: the page's <meta name="robots"> and sitemap.xml.
//
// 🩸 r1–r4 decided this BEFORE the build, from a model of what Astro would write: which file a route
// lands on, which route wins a shared file, which source a form lives in. Every review found one more
// input where the model and the output disagreed (`/x//y/` and `/x/y/` are one file, rendered with
// the props of the request Astro normalised; a form on a displaced page reached no HTML but still
// took another page out of search). So this pass reads the output instead. Its inputs are ONLY:
//   • the emitted *.html files under the output dir — a page IS its file; whatever is on disk at a
//     path is the page there, however many routes asked for it (Astro resolves collisions, not us);
//   • the stamps the render put in each file's head (SiteLayout), from the source that rendered it:
//       <meta name="sitetile:noindex" content="true|false|">  its own `noindex:` ('' = not said)
//       <meta name="sitetile:sitemap" content="list[ <date>]|omit">  whether the old sitemap lists
//                                                                  this kind of page, and its lastmod
//   • the thanks manifest: one entry per inbox form Form.astro EMITTED with a `thanks=`
//     safeInternalPath accepted — `{ id, thanks }` — and the `data-sitetile-thanks="<id>"` it put on
//     that <form>. An entry counts only when its id is in an emitted file, so a form on a page
//     nobody can open (displaced, codex r4) counts for nothing;
//   • the sitemap.xml the route wrote (pages/sitemap.xml.js) — read for its ORDER, its spelling of
//     each URL and the lastmod of pages that carry no stamp (term archives), never for membership.
// Outputs: each stamp and thanks mark removed (a page's bytes are what they were before noindex
// existed), a robots meta where a stamp was on a noindex page, and sitemap.xml rewritten from the
// file list.
//
// 🩸 r5 read the targets by grepping every emitted file for `<input type="hidden" name="thanks_to"
// value=…>`. That spelling is reserved among the fields Form.astro generates, not in the HTML an
// author pastes: an embed's inert <template>, or another service's form with a field of that name,
// took a page out of search (codex r5). Only the emitter knows a form is ours, so the emitter says
// so — the pass never reads a thanks target out of markup. The random id is only how it learns the
// form reached a file; no author can spell one ahead of the build.
//
// 🩸 r5 also left a page alone when it had ANY robots meta, so `index,follow` on a public/ page
// beat the thanks default. A robots meta already there is merged, not obeyed: `noindex` goes in,
// a contradicting `index`/`all` goes out (`all` keeps its `follow`), every other directive stays,
// and there is still one tag. The only opt-out is the page's own `noindex: false`.
//
// A thanks target (and a sitemap <loc>) names a file the way a static host maps a URL: resolved
// like the browser resolves it (`new URL` — `/./x` → `/x`, query and fragment dropped), each segment
// percent-decoded on its own (a segment that decodes to `/` names no file), joined as a filesystem
// path (`x//y` is the file x/y), then `<path>` if that file exists, else `<path>/index.html`. A
// target that names no existing file matches nothing. No case folding.
//
// WHY a post-build hook, like locale-404.mjs: production runs a plain `npx astro build` and nothing
// after it, so a post-step anywhere else would be absent from every real site.
// WHY a global for the manifest, like locale-404.mjs: Form.astro runs inside Astro's bundled SSR
// build and this hook inside the config's own module graph — two copies of this file, one process.
// A `Symbol.for` key is the one slot both resolve to; `astro:build:start` resets it.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const NAV_BASE = 'http://sitetile.invalid/';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ROBOTS = '<meta name="robots" content="noindex">';
const MANIFEST = Symbol.for('sitetile.noindex.thanks-manifest');
const markOf = (id) => ` data-sitetile-thanks="${id}"`;

/** Form.astro, for an `action=inbox` form whose `thanks=` safeInternalPath accepted: record the
 *  target and return the id to put on the <form> as `data-sitetile-thanks`. Outside a build (no
 *  manifest: `astro dev`, a test render) it records nothing and returns undefined, so the form
 *  renders without the attribute. */
export function recordThanks(thanks) {
  const manifest = globalThis[MANIFEST];
  if (!manifest) return undefined;
  const id = randomUUID();
  manifest.push({ id, thanks: String(thanks) });
  return id;
}

/** Every *.html file under `dir`, as `/`-separated paths relative to it, sorted. */
export function htmlFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(relative(dir, p).split(sep).join('/'));
    }
  })(dir);
  return out.sort();
}

/** A site path (`/x/`, `/x/index.html`, `/x//y?q#f`) → the emitted file it names, relative to
 *  `dir`, or null when it names none. See the file header for the steps. */
export function fileForPath(dir, path) {
  let segs;
  try { segs = new URL(path, NAV_BASE).pathname.slice(1).split('/').map(decodeURIComponent); } catch { return null; }
  if (segs.some((s) => s.includes('/') || s.includes('\0'))) return null;
  const rel = normalize(segs.join('/')).split(sep).join('/').replace(/^\.\/?$/, '');
  if (rel.startsWith('../')) return null;
  const isFile = (r) => { try { return statSync(join(dir, r)).isFile(); } catch { return false; } };
  if (rel && !rel.endsWith('/') && isFile(rel)) return rel;
  const index = (rel.replace(/\/$/, '') ? rel.replace(/\/$/, '') + '/' : '') + 'index.html';
  return isFile(index) ? index : null;
}

/** `content` of a noindex stamp → true | false | undefined (not said). */
const flagOf = (s) => s === 'true' ? true : s === 'false' ? false : undefined;
/** `content` of a sitemap stamp → null (omit) | { lastmod } . */
const listingOf = (s) => {
  const m = /^list(?: (.*))?$/.exec(s);
  return m ? { lastmod: m[1] || '' } : null;
};

// 🩸 r6 read the head as a string: `indexOf('</head>')` and a <meta> regex over the text before it.
// A robots tag inside `<!-- -->` was taken for the page's robots meta, so the real one was never
// inserted, and `</HEAD>` (valid HTML, copied verbatim from public/) was no head at all, so nothing
// was inserted (codex r6). A public/ page is whatever HTML its author wrote, so the head is read the
// way a crawler reads it: parsed (parse5, the WHATWG algorithm). The head is the parser's head
// element, whatever its case and whether or not either of its tags is written; a robots meta is a
// <meta> ELEMENT in it — a comment, script text or a <template>'s contents are not elements of the
// head. Writing goes back through the same tree's source offsets: each edit replaces exactly the
// bytes of the tag (or attribute) it changes, so the rest of the file is byte-identical — parse5's
// serializer would normalise markup nobody asked us to touch.

/** `<meta>` elements under `node` in the parse tree, in document order. `childNodes` only, so a
 *  <template>'s contents (its own fragment) are not walked. */
function metasUnder(node, out = []) {
  for (const c of node.childNodes || []) {
    if (c.tagName === 'meta' && c.namespaceURI === HTML_NS) out.push(c);
    metasUnder(c, out);
  }
  return out;
}
const attrOf = (el, name) => el.attrs.find((a) => a.name === name);

// 🩸 r7 read each file with readFileSync(…, 'utf8') and wrote the string back, so a windows-1252
// public/ page came out with ef bf bd where every é had been — the body too (codex r7). A page is
// BYTES, in whatever encoding its author saved, and the pass never decodes it. It parses a
// byte-transparent VIEW: the bytes as latin1, one byte ⇔ one code unit, lossless both ways. Every
// offset parse5 reports in that view IS a byte offset, and the edits are spliced into the Buffer. In
// every ASCII-compatible encoding (UTF-8, windows-1252, ISO-8859-x, Shift_JIS, Big5, GBK, EUC-*) the
// bytes of `<`, `>`, `=`, quotes and ASCII letters mean those characters and no trail byte of a
// multi-byte character is one of `<>"'=/` — so the tags parse5 finds are the tags a browser finds,
// and the robots meta written (pure ASCII) is the same bytes in all of them.
// The one family that is not ASCII-compatible is UTF-16, and a browser recognises it only by its BOM
// (FF FE / FE FF): WHATWG's prescan maps a <meta charset="utf-16"> it can read to UTF-8, since it
// read it as ASCII. So for a UTF-16 BOM the view is the code units (Buffer's utf16le, also lossless;
// big-endian swapped) — an offset is half a byte offset — and the edit is written in UTF-16 of the
// same order. A UTF-32 BOM (00 00 FE FF, FF FE 00 00), which no browser decodes as UTF-32, is not
// edited at all: the file stays as it is, a noindex decision on it keeps it out of the sitemap, and
// the build prints one warning naming it.
//
// 🩸 r8 took "no BOM" to mean "ASCII-compatible". In ISO-2022-JP, 、紹 is 21 22 3e 52 — a quote and
// a `>` to a byte reader — so the robots meta went in between the two bytes of 紹, inside the
// description (codex r8). The byte view is valid only once the encoding is KNOWN to be
// ASCII-compatible, so the pass first sniffs it the way a browser does (sniffEncoding): the BOM;
// else a <meta charset> / <meta http-equiv=content-type> in the first 1024 bytes, found by the
// WHATWG prescan (ASCII-only and safe: a declaration precedes any shift sequence); else UTF-8. The
// label is resolved by the WHATWG label table (Node's TextDecoder). A page whose encoding is not
// ASCII-compatible — UTF-16 named by a meta or betrayed by NUL bytes, ISO-2022-JP, x-user-defined,
// the `replacement` labels — or whose label resolves to nothing is not edited at all, exactly like
// UTF-32: Node writes no such encoding, and a guess is how r8 broke the description.
// (Stricter than a browser on purpose: the prescan of a browser reads a meta `utf-16` as UTF-8 and
// skips a label it cannot resolve. The pass cannot know which the author meant, so it refuses.)
// Measured, not assumed (noindex.test.mjs): every multi-byte character of Shift_JIS, Big5, GBK,
// GB18030, EUC-KR and EUC-JP has its ASCII-range bytes at ≥ 0x40 (GB18030's four-byte form: digits),
// never a byte the HTML tokenizer acts on — so for those the byte view is the browser's tokens.
const BOMS = [
  [[0x00, 0x00, 0xfe, 0xff], null], [[0xff, 0xfe, 0x00, 0x00], null],
  [[0xef, 0xbb, 0xbf], 'bytes'], [[0xff, 0xfe], 'utf16le'], [[0xfe, 0xff], 'utf16be'],
];
/** Encodings whose bytes do not mean ASCII where they look like it, by the name the pass reports. */
const NOT_ASCII = { 'utf-16le': 'UTF-16LE', 'utf-16be': 'UTF-16BE', 'iso-2022-jp': 'ISO-2022-JP' };

/** The page's encoding, sniffed like a browser (see above): `{ bom, kind }` with kind 'bytes' /
 *  'utf16le' / 'utf16be' for a view the pass can edit, or `{ refused: <name for the warning> }`. */
export function sniffEncoding(bytes) {
  const hit = BOMS.find(([s]) => s.every((x, i) => bytes[i] === x));
  if (hit) return hit[1] ? { bom: hit[0].length, kind: hit[1] } : { refused: 'UTF-32' };
  const head = bytes.subarray(0, 1024);
  if (head.includes(0)) return { refused: 'UTF-16 without a byte-order mark' };
  const label = prescan(head);
  if (label === null) return { bom: 0, kind: 'bytes' };
  const l = asciiLower(asciiTrim(label));
  if (l === 'x-user-defined') return { refused: 'x-user-defined' };
  let enc;
  try { enc = new TextDecoder(l).encoding; } catch { return { refused: `${asciiTrim(label)} (not an encoding this pass can read)` }; }
  return NOT_ASCII[enc] ? { refused: NOT_ASCII[enc] } : { bom: 0, kind: 'bytes' };
}

// The WHATWG "prescan a byte stream to determine its encoding", over the first 1024 bytes as ASCII
// (latin1 string, one byte per character): the label of the first <meta> that declares one, or null.
const WS = '\t\n\f\r ';
const isWs = (c) => WS.includes(c) && c !== '';
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const asciiTrim = (s) => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
function prescan(buf) {
  const s = buf.toString('latin1');
  const n = s.length;
  let p = 0;
  /** "get an attribute": [name, value] at p (advancing it), or null at `>` / the end. */
  const attr = () => {
    while (p < n && (isWs(s[p]) || s[p] === '/')) p++;
    if (p >= n || s[p] === '>') return null;
    let name = '';
    let value = '';
    for (;; p++) {
      if (p >= n) return null;
      const c = s[p];
      if (c === '=' && name) { p++; break; }
      if (isWs(c)) {
        while (p < n && isWs(s[p])) p++;
        if (s[p] !== '=') return [name, ''];
        p++; break;
      }
      if (c === '/' || c === '>') return [name, ''];
      name += asciiLower(c);
    }
    while (p < n && isWs(s[p])) p++;
    if (p >= n) return null;
    const q = s[p];
    if (q === '"' || q === "'") {
      const e = s.indexOf(q, p + 1);
      if (e === -1) return null;
      value = s.slice(p + 1, e); p = e + 1;
      return [name, value];
    }
    if (q === '>') return [name, ''];
    for (; p < n && !isWs(s[p]) && s[p] !== '>'; p++) value += asciiLower(s[p]);
    return [name, value];
  };
  const at = (lit) => asciiLower(s.slice(p, p + lit.length)) === lit;
  for (; p < n; p++) {
    if (at('<!--')) { const e = s.indexOf('-->', p + 2); if (e === -1) return null; p = e + 2; continue; }
    if (at('<meta') && (isWs(s[p + 5] || '') || s[p + 5] === '/')) {
      p += 6;
      const names = new Set();
      let pragma = false;
      let need = null;
      let charset = null;
      for (let a; (a = attr());) {
        const [k, v] = a;
        if (names.has(k)) continue;
        names.add(k);
        if (k === 'http-equiv' && asciiLower(v) === 'content-type') pragma = true;
        else if (k === 'content' && charset === null) { const c = charsetFromContent(v); if (c !== null) { charset = c; need = true; } }
        else if (k === 'charset') { charset = v; need = false; }
      }
      if (need === null || (need && !pragma) || charset === null) continue;
      return charset;
    }
    if (/^<\/?[A-Za-z]/.test(s.slice(p, p + 3))) {
      p += s[p + 1] === '/' ? 2 : 1;
      while (p < n && !isWs(s[p]) && s[p] !== '>') p++;
      while (attr());
      continue;
    }
    if (at('<!') || at('</') || at('<?')) { const e = s.indexOf('>', p); if (e === -1) return null; p = e; }
  }
  return null;
}
/** WHATWG "extract a character encoding from a meta element", on a `content` value. */
function charsetFromContent(v) {
  let i = 0;
  for (;;) {
    const j = asciiLower(v).indexOf('charset', i);
    if (j === -1) return null;
    i = j + 7;
    while (i < v.length && isWs(v[i])) i++;
    if (v[i] !== '=') continue;
    i++;
    while (i < v.length && isWs(v[i])) i++;
    const q = v[i];
    if (q === '"' || q === "'") { const e = v.indexOf(q, i + 1); return e === -1 ? null : v.slice(i + 1, e); }
    if (i >= v.length) return null;
    let e = i;
    while (e < v.length && !isWs(v[e]) && v[e] !== ';') e++;
    return v.slice(i, e);
  }
}

/** The view of a page's bytes: { bom (bytes), unit (bytes per code unit), text (from after the
 *  BOM), encode (text → bytes) }, or { refused } for a file not edited (sniffEncoding). */
export function viewOf(bytes) {
  const sniffed = sniffEncoding(bytes);
  if (sniffed.refused) return sniffed;
  const { bom, kind } = sniffed;
  const body = bytes.subarray(bom);
  if (kind === 'bytes') return { bom, unit: 1, text: body.toString('latin1'), encode: latin1Bytes };
  const le = kind === 'utf16le' ? body : Buffer.from(body.subarray(0, body.length & ~1)).swap16();
  const encode = (s) => kind === 'utf16le' ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf16le').swap16();
  return { bom, unit: 2, text: le.toString('utf16le'), encode };
}
/** Text for the byte view → its bytes. Every edit is ASCII or a slice of the view itself, so a
 *  character above U+00FF here is a bug, not a page to write. */
const latin1Bytes = (s) => {
  if (/[^\0-\xff]/.test(s)) throw new Error('noindex-pass: a byte-view edit is not latin1');
  return Buffer.from(s, 'latin1');
};

/** The parsed head of a page: its <meta> elements, and the offset a new head element goes at —
 *  before </head> when written; else after the head's last child, or after <head>; for a head
 *  neither of whose tags is written, before the first thing the parser put after it. Offsets index
 *  `html`, the view's text (the BOM, which the HTML decoder strips, is not in it). */
function parseHead(html) {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const root = doc.childNodes.find((n) => n.tagName === 'html');
  const head = root.childNodes.find((n) => n.tagName === 'head');
  const loc = head.sourceCodeLocation;
  const last = [...head.childNodes].reverse().find((c) => c.sourceCodeLocation);
  let at = loc?.endTag?.startOffset ?? last?.sourceCodeLocation.endOffset ?? loc?.startTag?.endOffset;
  if (at === undefined) {
    const after = root.childNodes.slice(root.childNodes.indexOf(head) + 1);
    const first = (function find(ns) {
      for (const n of ns) {
        const o = n.sourceCodeLocation?.startTag?.startOffset ?? (n.nodeName === '#text' || n.nodeName === '#comment' ? n.sourceCodeLocation?.startOffset : undefined);
        if (o !== undefined) return o;
        const d = find(n.childNodes || []);
        if (d !== undefined) return d;
      }
    })(after);
    at = first ?? root.sourceCodeLocation?.endTag?.startOffset ?? root.sourceCodeLocation?.startTag?.endOffset
      ?? doc.childNodes.find((n) => n.nodeName === '#documentType')?.sourceCodeLocation?.endOffset ?? html.length;
  }
  const span = (el) => [el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset];
  return { metas: metasUnder(head).filter((m) => m.sourceCodeLocation), insertAt: at, span };
}

/** Read every emitted page: its bytes, its view (viewOf), and — from the view's head only, a body
 *  can quote anything — its stamps and robots metas. A page with no view is `untouchable`. */
export function readPages(dir) {
  const pages = new Map();
  for (const rel of htmlFiles(dir)) {
    const bytes = readFileSync(join(dir, rel));
    const view = viewOf(bytes);
    if (view.refused) { pages.set(rel, { bytes, html: '', untouchable: view.refused, robots: [] }); continue; }
    const html = view.text;
    const { metas, insertAt, span } = parseHead(html);
    // ASCII trim and case only: in the byte view a byte ≥ 0x80 is a character trim() and
    // toLowerCase() have opinions about (U+00A0 is whitespace to trim(), not to HTML)
    const named = (n) => metas.filter((m) => asciiLower(asciiTrim(attrOf(m, 'name')?.value || '')) === n);
    const stamp = (n) => {
      const m = metas.find((e) => attrOf(e, 'name')?.value === n);
      return m ? { span: span(m), content: attrOf(m, 'content')?.value ?? '' } : null;
    };
    const n = stamp('sitetile:noindex');
    const s = stamp('sitetile:sitemap');
    pages.set(rel, {
      bytes, view, html, insertAt,
      noindexStamp: n?.span || null, flag: n ? flagOf(n.content) : undefined,
      sitemapStamp: s?.span || null, listing: s ? listingOf(s.content) : undefined,
      robots: named('robots').map((m) => robotsMeta(m, html)),
    });
  }
  return pages;
}

/** The manifest entries whose form reached an emitted file. Sets each page's `marks` (the ids it
 *  carries, removed by rewritePage). */
export function emittedThanks(pages, manifest) {
  const out = [];
  for (const p of pages.values()) p.marks = [];
  for (const e of manifest || []) {
    let seen = false;
    for (const p of pages.values()) if (p.html.includes(markOf(e.id))) { p.marks.push(e.id); seen = true; }
    if (seen) out.push(e);
  }
  return out;
}

/** The files decided noindex: own flag true, or — not said — the target of an inbox form that
 *  reached an emitted file. */
export function noindexFiles(dir, pages, thanks) {
  const targets = new Set();
  for (const { thanks: t } of thanks) {
    const f = fileForPath(dir, t);
    if (f) targets.add(f);
  }
  const out = new Set();
  for (const [rel, p] of pages) if (p.flag === true || (p.flag === undefined && targets.has(rel))) out.add(rel);
  return out;
}

// 🩸 r8 merged the parser's DECODED value — trim(), toLowerCase(), split(',') — and wrote it back
// through the byte view. There a byte ≥ 0x80 is a character of its own: U+00A0 after `nofollow` is
// c2 a0 in UTF-8, trim() took the a0 and left a lone c2 (codex r8); and a value parse5 decoded from
// `&nbsp;` has no byte at all in a UTF-8 page. So the merge reads the value's SOURCE text (the raw
// bytes between its quotes, character references still written out) and does only what the robots
// grammar does: split on ASCII whitespace and commas, compare tokens ASCII-case-insensitively. A
// byte ≥ 0x80 is part of the token beside it. Kept tokens keep their bytes and the separators
// before them; `noindex` goes after the last one with `, `. A directive spelled with a character
// reference (`no&#105;ndex`) is not recognised and is kept as written — at worst the value says
// noindex twice, never not at all.
const ATTR = /^[^\t\n\f\r =\/>][^\t\n\f\r =\/>]*[\t\n\f\r ]*(?:=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?$/d;
/** A robots <meta> element, located in the view: the span of its tag, and of its (first) `content`
 *  attribute — the whole attribute, and the raw value's span and text inside it (`quoted`: whether
 *  that span sits between quotes) — any order, any case, quoted either way or not at all. */
function robotsMeta(el, html) {
  const loc = el.sourceCodeLocation;
  const c = loc.attrs?.content;
  let content = null;
  if (c) {
    const m = ATTR.exec(html.slice(c.startOffset, c.endOffset));
    const g = m && [1, 2, 3].find((k) => m[k] !== undefined);
    const [a, z] = g ? m.indices[g].map((o) => c.startOffset + o) : [c.endOffset, c.endOffset];
    content = { span: [c.startOffset, c.endOffset], raw: g ? m[g] : '', value: [a, z], quoted: g === 1 || g === 2 };
  }
  return { tag: [loc.startOffset, loc.endOffset], content };
}
/** A robots `content`, as written in the source, made to say noindex: returned as is when it
 *  already does and nothing contradicts it; otherwise `index` dropped, `all` → `follow`, `noindex`
 *  appended once, every other directive kept in its place, byte for byte. */
export function mergeRobots(raw) {
  const toks = [...String(raw).matchAll(/[^\t\n\f\r ,]+/g)].map((m) => ({ t: m[0], a: m.index, z: m.index + m[0].length }));
  const l = (d) => asciiLower(d.t);
  const says = toks.some((d) => l(d) === 'noindex' || l(d) === 'none');
  if (says && !toks.some((d) => l(d) === 'index' || l(d) === 'all')) return raw;
  if (!toks.length) return 'noindex';
  const kept = toks.flatMap((d, i) => l(d) === 'index' ? [] : [{ i, t: l(d) === 'all' ? 'follow' : d.t }]);
  const lead = raw.slice(0, toks[0].a);
  const trail = raw.slice(toks[toks.length - 1].z);
  const body = kept.map(({ i, t }, j) => (j ? raw.slice(toks[i - 1].z, toks[i].a) : '') + t).join('');
  return lead + (says ? body : body ? body + ', noindex' : 'noindex') + trail;
}

/** The page's bytes with its stamps and thanks marks removed and, when decided noindex: each robots
 *  meta it already has merged to say noindex (mergeRobots) — never a second tag — or, with none,
 *  the robots meta in the noindex stamp's place (where the head ends, for a page that has no
 *  stamp). Every edit is a splice into the page's BYTES at the parser's offsets in the view
 *  (byte = BOM + offset × unit), its text encoded the way the view was decoded; the bytes between
 *  edits are copied, never decoded. A page with no view is returned as it is. */
export function rewritePage(p, noindex) {
  if (p.untouchable) return p.bytes;
  const html = p.html;
  const robots = p.robots || [];
  const edits = [];   // [start, end, text], non-overlapping
  if (p.noindexStamp) edits.push([...p.noindexStamp, noindex && !robots.length ? ROBOTS : '']);
  else if (noindex && !robots.length) edits.push([p.insertAt, p.insertAt, ROBOTS]);
  if (noindex) for (const r of robots) {
    const c = r.content;
    const merged = mergeRobots(c ? c.raw : '');
    if (c && merged === c.raw) continue;
    if (c?.quoted) edits.push([...c.value, merged]);
    // unquoted or bare: the attribute is rewritten double-quoted (", " would end an unquoted value)
    else if (c) edits.push([...c.span, `${html.slice(c.span[0], c.span[0] + 7)}="${merged.replace(/"/g, '&quot;')}"`]);
    else {
      const end = r.tag[0] + /[\t\n\f\r ]*\/?>$/.exec(html.slice(...r.tag)).index;
      edits.push([end, end, ' content="noindex"']);
    }
  }
  if (p.sitemapStamp) edits.push([...p.sitemapStamp, '']);
  for (const id of p.marks || []) {
    const mark = markOf(id);
    for (let i = html.indexOf(mark); i !== -1; i = html.indexOf(mark, i + mark.length)) edits.push([i, i + mark.length, '']);
  }
  const { bytes, view: { bom, unit, encode } } = p;
  const parts = [];
  let at = 0;
  for (const [a, b, text] of edits.sort((x, y) => x[0] - y[0])) {
    parts.push(bytes.subarray(at, bom + a * unit), encode(text));
    at = bom + b * unit;
  }
  parts.push(bytes.subarray(at));
  return Buffer.concat(parts);
}

const SITEMAP_URL = /  <url>\n    <loc>([^<]*)<\/loc>(?:\n    <lastmod>([^<]*)<\/lastmod>)?\n  <\/url>/g;
const xmlUnesc = (s) => s.replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }[e]));
const xmlEsc = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** The sitemap, from the emitted files: one <url> per page that is listed — its stamp says `list`,
 *  or it has no stamp and the route's sitemap names it — and not noindex. In the route sitemap's
 *  order and spelling (the first <loc> that names the file); a listed file it never names is
 *  appended, spelled from its path. The lastmod is the stamp's (the source that rendered the file),
 *  else the route's. Same format as pages/sitemap.xml.js. */
export function rebuildSitemap(dir, routeXml, pages, noindex) {
  const origin = (/<loc>(https?:\/\/[^/<]+)/.exec(routeXml) || [])[1] || '';
  const named = new Map();     // file → { loc, lastmod } of the first route <loc> naming it
  const order = [];
  for (const m of routeXml.matchAll(SITEMAP_URL)) {
    const loc = xmlUnesc(m[1]);
    const f = fileForPath(dir, loc.slice(origin.length) || '/');
    if (!f || named.has(f)) continue;
    named.set(f, { loc, lastmod: m[2] || '' });
    order.push(f);
  }
  for (const rel of pages.keys()) if (!named.has(rel)) order.push(rel);
  const body = [];
  for (const f of order) {
    const p = pages.get(f);
    if (!p || noindex.has(f)) continue;
    const route = named.get(f);
    let lastmod;
    if (p.listing === undefined) { if (!route) continue; lastmod = route.lastmod; }
    else if (p.listing === null) continue;
    else lastmod = p.listing.lastmod ? new Date(p.listing.lastmod).toISOString().slice(0, 10) : '';
    const loc = route ? route.loc : origin + '/' + f.replace(/(^|\/)index\.html$/, '$1').split('/').map(encodeURIComponent).join('/');
    body.push(`  <url>\n    <loc>${xmlEsc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body.join('\n')}
</urlset>\n`;
}

/** The whole pass over an output dir, with the thanks manifest this build's forms recorded.
 *  Returns what it decided, for tests and the build log. */
export function applyNoindex(dir, manifest = []) {
  const pages = readPages(dir);
  const noindex = noindexFiles(dir, pages, emittedThanks(pages, manifest));
  for (const [rel, p] of pages) {
    const bytes = rewritePage(p, noindex.has(rel));
    if (!bytes.equals(p.bytes)) writeFileSync(join(dir, rel), bytes);
  }
  const sitemap = join(dir, 'sitemap.xml');
  if (existsSync(sitemap)) writeFileSync(sitemap, rebuildSitemap(dir, readFileSync(sitemap, 'utf8'), pages, noindex));
  return { noindex: [...noindex].sort(), untouched: [...noindex].sort().filter((rel) => pages.get(rel).untouchable).map((file) => ({ file, encoding: pages.get(file).untouchable })) };
}

/** Astro integration: runs after the static output is written (after locale-404's renames). */
export function noindexPass() {
  return {
    name: 'sitetile-noindex',
    hooks: {
      'astro:build:start': () => { globalThis[MANIFEST] = []; },
      'astro:build:done': ({ dir, logger }) => {
        const manifest = globalThis[MANIFEST] || [];
        delete globalThis[MANIFEST];
        const { untouched } = applyNoindex(fileURLToPath(dir), manifest);
        for (const { file, encoding } of untouched) {
          const msg = `${file} is noindex but saved as ${encoding}, which this build cannot edit without corrupting it: left unchanged with no robots meta, and out of sitemap.xml. Set noindex in the page itself (<meta name="robots" content="noindex">), or save it as UTF-8 to have one written.`;
          logger ? logger.warn(msg) : console.warn(msg);
        }
      },
    },
  };
}
