// chrome-links.mjs — THE reader, and the one writer, of every link-bearing chrome key a site's
// frontmatter (`_site.md`, or a page that overrides it) carries.
//
// 🔴 PURE AND IMPORT-FREE. The renderer imports it (SiteLayout.astro, PostView.astro) and anything
// outside this repo that has to know where a chrome link's target sits — a tool that
// rewrites links when pages move — vendors this file verbatim. There is no second copy of these
// grammars anywhere in this repo, and there must not be one anywhere else: two review rounds of a
// re-implementation elsewhere found it disagreeing with the layout, and the only fix that stays
// fixed is that both sides run THIS code.
//
// Two readers of the same rules stay where they are, pinned to this file by chrome-links.test.mjs
// over the whole corpus on every run: site-core.js's parseSidebarNav (the reference renderer the
// editor previews with) and lib/announce.mjs's `announce-href` trim (that module is also bundled
// into a client script, and importing this file there adds a JS chunk to every announce page).
//
// A VALUE is what `meta[key]` holds — the frontmatter value as splitFrontmatter (site-core.js)
// returns it, block scalars already joined. Every offset below is into that string.
//
//   parseChromeLinks(key, value) → [{ label, href, start, end }]
//       Every link the layout reads from the value, in reading order, with value.slice(start, end)
//       === href exactly. A label with no href (the layout's `#` / plain-span fallback), a header
//       action that is a toggle, and the dead tail of a footer item after `>>` are not links.
//   withHref(key, value, link, newHref) → string
//       The value with that one link's href replaced. It writes the readable spelling when that
//       reads back as the same single link, else percent-encodes the characters that are syntax for
//       that key (in the path; see encodeFor for why not in a query) — whitespace, controls and
//       every URL-fragile character (derived from new URL(), see encodeTarget) are ALWAYS encoded —
//       and then checks that a browser resolves the result where it resolves encodeTarget(newHref),
//       and — by re-reading the result with the readers below — that
//       the link count, every other link, every label, heading, tree shape and weight are exactly as
//       they were and only this link's target changed. When no spelling can do that it throws an
//       Error whose message starts `withHref: `; it never returns a value the layout would read
//       differently from what was asked.
//       Law (chrome-links.test.mjs): withHref(key, v, link, link.href) === v for every link.
//
// The per-key readers (navMenuOf, footerColsOf, …) return exactly the shapes the layout renders
// from — no offsets on them, so nothing about where an href sat can leak into a template or a diff.

// `Label /href` — the href is the item's last whitespace-free run (nav, footer).
const LABEL_SPACE_HREF = /^(.*\S)\s+(\S+)$/;
// `Label=href` — the href is the run after the LAST `=` that has no whitespace after it.
const LABEL_EQ_HREF = /^(.*\S)\s*=\s*(\S+)$/;
// `aria-label = icon type target [reveal] [flags…]` (header-actions).
const LABEL_EQ_SPEC = /^(.*\S)\s*=\s*(\S.*)$/;
// sidebar-nav's optional `^weight` suffix on an href (a tag-cloud font size).
const HREF_WEIGHT = /^(.*?)\^(\d+(?:\.\d+)?)$/;

// Where each href sits: object → [start, end]. Kept off the objects themselves (see the header).
const SPANS = new WeakMap();
const at = (obj, start, len) => { SPANS.set(obj, [start, start + len]); return obj; };

/** `text.split(sep).map((s) => s.trim()).filter(Boolean)`, each piece with its offset (+ base). */
function pieces(text, sep, base) {
  const out = [];
  let i = 0;
  for (;;) {
    const j = text.indexOf(sep, i);
    const raw = j < 0 ? text.slice(i) : text.slice(i, j);
    const t = raw.trim();
    if (t) out.push({ text: t, at: base + i + (raw.length - raw.trimStart().length) });
    if (j < 0) return out;
    i = j + sep.length;
  }
}

// ── nav / footer ────────────────────────────────────────────────────────────────────────────────

// One `Label /href` item at offset `pos`. A lone word is a label with the `#` fallback (no link).
function navPart(part, pos) {
  const m = part.match(LABEL_SPACE_HREF);
  return m ? at({ label: m[1], href: m[2] }, pos + part.length - m[2].length, m[2].length) : { label: part, href: '#' };
}
const navItem = (part, pos) => { const p = navPart(part, pos); const item = { ...p, children: [] }; const s = SPANS.get(p); if (s) SPANS.set(item, s); return item; };

// A nav is a TREE, spelled by its shape:
//  • one line, FLAT: `nav: A /a | B /b` — the common top-bar case (`|` separates items).
//  • indented markdown list, ANY depth (dropdowns / mega-menus): a `nav: |` block scalar, one
//    `- Label /href` per line, indentation = depth. Whitespace is the tree; it reads at a glance.
// There is exactly ONE way to nest (the indented list). An earlier inline ` >> `/` ; ` submenu
// spelling was removed once its last user migrated — two spellings for one thing is a tax. (In
// `footer:` a `>>` still collapses an item to its parent link; see footerLinksOf.)
function navIndented(text) {
  const root = { children: [] };
  const stack = [{ node: root, indent: -1 }];
  let lineAt = 0;
  for (const raw of text.split('\n')) {
    const here = lineAt;
    lineAt += raw.length + 1;
    if (!raw.trim()) continue;
    const indent = (raw.match(/^[ \t]*/)[0] || '').replace(/\t/g, '  ').length;
    const bullet = raw.match(/^[ \t]*-?[ \t]*/)[0].length;
    const rest = raw.slice(bullet);
    const item = navItem(rest.trim(), here + bullet + (rest.length - rest.trimStart().length));
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(item);
    stack.push({ node: item, indent });
  }
  return root.children;
}
const navFlat = (text) => pieces(text, '|', 0).map((p) => navItem(p.text, p.at));

/** `nav:` → the menu tree [{ label, href, children }]. One line is flat; any newline makes it a list. */
export function navMenuOf(value) {
  const navRaw = String(value || '');
  return navRaw.includes('\n') ? navIndented(navRaw) : navFlat(navRaw);
}
// The three names a vendored nav reader has always imported, same shapes.
export const parseNavPart = (part) => { const p = navPart(part, 0); return { label: p.label, href: p.href }; };
export const parseNavIndented = (text) => navIndented(text);
export const parseNavFlat = (text) => navFlat(text);

/** `footer: Label /href | …` → [{ label, href }]. Flat: an item's `>>` tail (a header-only dropdown
 *  spelling) collapses it to its parent link here. */
export function footerLinksOf(value) {
  return pieces(String(value || ''), '|', 0).map((p) => {
    const di = p.text.indexOf('>>');
    return navPart(di >= 0 ? p.text.slice(0, di).trim() : p.text, p.at);
  });
}

// ── `label=href` lists ──────────────────────────────────────────────────────────────────────────

// One `Label=href` item at `pos`, or null when it has no `=href`.
function eqItem(text, pos) {
  const m = text.match(LABEL_EQ_HREF);
  return m ? at({ label: m[1].trim(), href: m[2].trim() }, pos + text.length - m[2].length, m[2].length) : null;
}

/** `footer-social` / `sidebar-social` / `breadcrumb-trail` / `age-gate-note-links`:
 *  `Label=href ; Label2=href2` → [{ label, href }]; an item without `=href` is dropped. */
export function labelHrefListOf(value) {
  return pieces(String(value || ''), ';', 0).map((p) => eqItem(p.text, p.at)).filter(Boolean);
}

/** `footer-cols: Heading: Label=href ; Label2 ; … ;; Heading2: …` → [{ head, items: [{ label, href }] }].
 *  `;;` separates columns, `;` items; the heading is everything before the column's first `:`,
 *  unless an `=` comes before that colon (then the column is headless). No `=href` → href ''. */
export function footerColsOf(value) {
  return pieces(String(value || ''), ';;', 0).map((col) => {
    const firstColon = col.text.indexOf(':');
    const ci = firstColon >= 0 && !col.text.slice(0, firstColon).includes('=') ? firstColon : -1;
    return groupOf(col, ci, (it) => eqItem(it.text, it.at) || { label: it.text, href: '' });
  });
}

function groupOf(col, ci, item) {
  const head = ci >= 0 ? col.text.slice(0, ci).trim() : '';
  const items = ci >= 0 ? pieces(col.text.slice(ci + 1), ';', col.at + ci + 1) : pieces(col.text, ';', col.at);
  return { head, items: items.map(item) };
}

/** `sidebar-nav:` → [{ head, items: [{ label, href, weight? }] }]. footer-cols' syntax, except the
 *  heading ends at the first colon NOT followed by `//` (so a headless group may open with an
 *  absolute URL), and an href may end in `^<px>` — a weight, which is not part of the href.
 *  🔴 site-core.js's parseSidebarNav is the reference renderer's copy of this reader;
 *  chrome-links.test.mjs pins the two equal over the whole corpus on every run. */
export function sidebarNavOf(value) {
  return pieces(String(value || ''), ';;', 0).map((col) => {
    const m = col.text.match(/:(?!\/\/)/);
    return groupOf(col, m ? m.index : -1, (it) => {
      const m2 = it.text.match(LABEL_EQ_HREF);
      if (!m2) return { label: it.text, href: '' };
      const hrefAt = it.at + it.text.length - m2[2].length;
      const hw = m2[2].match(HREF_WEIGHT);
      return hw ? at({ label: m2[1].trim(), href: hw[1], weight: Number(hw[2]) }, hrefAt, hw[1].length)
        : at({ label: m2[1].trim(), href: m2[2].trim() }, hrefAt, m2[2].length);
    });
  });
}

// ── single links ────────────────────────────────────────────────────────────────────────────────

/** `header-cta: Label=href` → { label, href } | null. */
export function headerCtaOf(value) {
  const v = String(value || '');
  return eqItem(v, 0);
}

/** `blog-post-cta: Label=href` → { label, href } | null. Unlike the lists, the split is at the FIRST
 *  `=` and the href is the whole (trimmed) rest — so it may hold `=`, `;` or a space. */
export function postCtaOf(value) {
  const v = String(value || '');
  const ctaRaw = v.trim();
  const lead = v.length - v.trimStart().length;
  const ctaEq = ctaRaw.indexOf('=');
  if (!ctaRaw || ctaEq <= 0) return null;
  const rest = ctaRaw.slice(ctaEq + 1);
  const href = rest.trim();
  return at({ label: ctaRaw.slice(0, ctaEq).trim(), href }, lead + ctaEq + 1 + (rest.length - rest.trimStart().length), href.length);
}

/** The whole-value href keys (`copyright-href`, `language-href`, `header-actions-cart-href`,
 *  `age-gate-back-url`, `announce-href`): the value, trimmed. */
export function hrefValueOf(value) {
  return String(value || '').trim();
}
const WHOLE_HREF_KEYS = ['copyright-href', 'language-href', 'header-actions-cart-href', 'age-gate-back-url', 'announce-href'];

/** `header-actions: <aria-label> = <icon> <type> [target] [reveal] [flags…] ; …` → each action's
 *  words, interpreted (SiteLayout adds the icon SVG and element ids). `type` is `link` unless the
 *  second word is `toggle`; a link's target — its third word — is an href. */
export function headerActionsOf(value) {
  return pieces(String(value || ''), ';', 0).map((p) => {
    const m = p.text.match(LABEL_EQ_SPEC);
    if (!m) return null;
    const spec = m[2].trim();
    const specAt = p.at + p.text.length - m[2].length;
    const words = [...spec.matchAll(/\S+/g)];
    const t = words.map((w) => w[0]);
    const iconName = t[0] || '';
    const type = (t[1] === 'toggle') ? 'toggle' : 'link';
    const target = t[2] || '';
    let reveal = '', badge = null, mobile = false;
    for (const tok of t.slice(3)) {
      if (tok === 'mobile') mobile = true;
      else if (tok === 'dropdown' || tok === 'drawer' || tok.startsWith('drawer:')) reveal = tok;
      else if (tok === 'badge' || tok.startsWith('badge:')) badge = tok.indexOf(':') >= 0 ? tok.slice(tok.indexOf(':') + 1) : '';
    }
    const side = reveal.startsWith('drawer:') ? reveal.slice(7) : 'right';
    const action = { label: m[1].trim(), iconName, type, target, reveal, side, badge, mobile, key: target || iconName };
    return type === 'link' && target ? at(action, specAt + words[2].index, target.length) : action;
  }).filter(Boolean);
}

// ── links, by key ───────────────────────────────────────────────────────────────────────────────

// key → its reader, and how to walk that reader's result for the objects that may carry a span.
const tree = (nodes) => nodes.flatMap((n) => [n, ...tree(n.children)]);
const groups = (gs) => gs.flatMap((g) => g.items);
const one = (x) => (x ? [x] : []);
const READERS = {
  nav: [navMenuOf, tree],
  footer: [footerLinksOf, (xs) => xs],
  'footer-cols': [footerColsOf, groups],
  'sidebar-nav': [sidebarNavOf, groups],
  'footer-social': [labelHrefListOf, (xs) => xs],
  'sidebar-social': [labelHrefListOf, (xs) => xs],
  'breadcrumb-trail': [labelHrefListOf, (xs) => xs],
  'age-gate-note-links': [labelHrefListOf, (xs) => xs],
  'header-cta': [headerCtaOf, one],
  'header-actions': [headerActionsOf, (xs) => xs],
  'blog-post-cta': [postCtaOf, one],
};

/** Every key whose value holds a link target the layout renders. */
export const CHROME_LINK_KEYS = Object.freeze([...Object.keys(READERS), ...WHOLE_HREF_KEYS]);

// [model, links] for key/value; links are { obj, label, href, start, end }.
function read(key, value) {
  if (WHOLE_HREF_KEYS.includes(key)) {
    const v = String(value || '');
    const href = v.trim();
    const start = v.length - v.trimStart().length;
    return [href, href ? [{ obj: null, label: '', href, start, end: start + href.length }] : []];
  }
  const r = READERS[key];
  if (!r) return [null, []];
  const model = r[0](value);
  const links = [];
  for (const obj of r[1](model)) {
    const s = SPANS.get(obj);
    if (!s || s[1] === s[0]) continue;
    links.push({ obj, label: obj.label, href: key === 'header-actions' ? obj.target : obj.href, start: s[0], end: s[1] });
  }
  return [model, links];
}

/** See the header. A key that is not in CHROME_LINK_KEYS has no links. */
export function parseChromeLinks(key, value) {
  return read(key, value)[1].map(({ label, href, start, end }) => ({ label, href, start, end }));
}

// The characters that are syntax in each key's grammar, beyond whitespace (always syntax: every
// grammar trims, splits or ends an href on it, and a line break would also end the frontmatter line).
const SYNTAX = {
  nav: '|',
  footer: '|>',
  'footer-cols': ';=',
  'sidebar-nav': ';=:^',
  'footer-social': ';=',
  'sidebar-social': ';=',
  'breadcrumb-trail': ';=',
  'age-gate-note-links': ';=',
  'header-cta': '=',
  'header-actions': ';=',
  'blog-post-cta': '',
};
// 🩸 round 2 (review of #278). Whitespace used to be encoded only when the raw spelling failed to
// read back, and in a whole-value key (or blog-post-cta) an internal tab DOES read back: the reader
// only trims the ends. So `/a\tb` was written raw — and a browser's URL parser deletes a tab, LF or
// CR wherever it stands, so the link went to `/ab`. Re-reading with these readers cannot see that,
// because the damage happens in the URL parser, not in the grammar.
//
// So the always-encoded set is not a hand list: it is the tokenizers' own whitespace class. Every
// reader in this file cuts on `\s`, `\S`, trim() or split(/\s+/), and in ECMAScript those are ONE
// set (WhiteSpace ∪ LineTerminator — chrome-links.test.mjs derives it from trim() over the whole BMP
// and checks the writer encodes every member). Plus the C0 controls and DEL, which a URL parser
// either deletes (tab, LF, CR) or percent-encodes itself, so writing them encoded changes nothing
// a browser resolves and keeps every byte of the frontmatter line printable.
const TOKEN_SPACE = /\s/;
const tokenOrControl = (ch) => TOKEN_SPACE.test(ch) || ch <= '\u001f' || ch === '\u007f';

// 🩸 round 3 (review of #278, P1). Round 2's set was still a LIST, and it missed `\`: a URL parser
// turns a path backslash into `/`, so `/a\b` written raw went to `/a/b` (and `/\host/p` to another
// host). No list of characters is the fix, because the question is not "which characters are odd"
// but "where does a browser go". So the browser's own resolution — `new URL()` — is the oracle, and
// the always-encoded URL set is DERIVED from it:
//
//   encodeTarget(href) is the one canonical spelling of a target. Its path is data: a valid `%XX`
//   stays an escape, a bare `%` becomes `%25`, and every other character the URL parser does not
//   leave literal in a path (measured per character, below) is percent-encoded. Its query and
//   fragment are the caller's, kept as written except whitespace and controls. Its scheme and
//   authority are kept.
//   A character is URL-FRAGILE when a target holding it raw (`/a<c>b`) resolves to a different URL
//   than its canonical spelling does. Those are always encoded in a path, wherever they stand.
//   chrome-links.test.mjs recomputes the set over every BMP code point and astral samples and
//   requires urlFragileChars() to be exactly it.
//
// `?` and `#` are not path data here: withHref takes an HREF, whose path ends at the first of them
// (a move keeps a link's `?query#fragment`). A page whose own name holds one is passed encoded
// (`%3F`, `%23`), and a valid escape passes through untouched.
const PROBE_BASE = 'https://site.example/dir/page';
const resolveHref = (h) => { try { return new URL(h, PROBE_BASE).href; } catch { return null; } };
const memo = (fn) => { const m = new Map(); return (c) => { if (!m.has(c)) m.set(c, fn(c)); return m.get(c); }; };
// Does the URL parser leave `c` literal inside a path? Measured in context, so `.` (a dot segment
// alone) and `/` read as what they are inside a name.
const parserKeepsLiteral = memo((c) => { try { return new URL(`/a${c}b`, PROBE_BASE).pathname === `/a${c}b`; } catch { return false; } });
const HEX2 = /^[0-9A-Fa-f]{2}$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// A scheme and authority (`https://host:port`, `//host`, `mailto:`) keep their own colons.
const SCHEME_AUTHORITY = /^(?:[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/[^/?#\s]*)?|\/\/[^/?#\s]*)/;
function partsOf(href) {
  const m = href.match(SCHEME_AUTHORITY);
  const head = m ? m[0] : '';
  const rest = href.slice(head.length);
  const cut = rest.search(/[?#]/);
  return { head, path: cut < 0 ? rest : rest.slice(0, cut), tail: cut < 0 ? '' : rest.slice(cut) };
}
// `path` with each character for which `encode(c)` holds percent-encoded, valid `%XX` escapes kept.
function encodePath(path, encode) {
  let out = '';
  const cs = [...path];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === '%' && HEX2.test(cs.slice(i + 1, i + 3).join(''))) { out += c + cs[i + 1] + cs[i + 2]; i += 2; continue; }
    out += encode(c) ? encodeURIComponent(c) : c;
  }
  return out;
}
const encodeEach = (s, encode) => [...s].map((c) => (encode(c) ? encodeURIComponent(c) : c)).join('');

/** The canonical spelling of a target href (see above). Throws on a lone surrogate, which has none. */
export function encodeTarget(href) {
  const h = String(href);
  if (LONE_SURROGATE.test(h)) throw new TypeError('encodeTarget: a lone surrogate has no URL spelling');
  const { head, path, tail } = partsOf(h);
  return encodeEach(head, tokenOrControl)
    + encodePath(path, (c) => c === '%' || !parserKeepsLiteral(c))
    + encodeEach(tail, tokenOrControl);
}

// Is `c` URL-fragile (see above)? Asked of the oracle, one character at a time, and remembered.
const urlFragile = memo((c) => resolveHref(`/a${c}b`) !== resolveHref(encodeTarget(`/a${c}b`)));
/** Every BMP character that is URL-fragile — what chrome-links.test.mjs holds the oracle to. */
export function urlFragileChars() {
  const out = new Set();
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCharCode(cp);
    if (urlFragile(c)) out.add(c);
  }
  return out;
}
// Always encoded in a path: the tokenizers' whitespace, controls, and every URL-fragile character.
const alwaysInPath = (c) => tokenOrControl(c) || urlFragile(c);

// 🔴 Encoding is only safe where the encoded character MEANS the same thing. In a path it does
// (`/Jane%3BDoe/` is the page `/Jane;Doe/`). In a query or fragment `=`, `;` and `:` are delimiters
// to whoever reads them — `?b%3Dc` is a different query from `?b=c` — so there only whitespace and
// characters that are never valid unencoded in a URL (`|`, `>`, `^`) are encoded; a grammar that
// cannot hold the rest raw makes withHref refuse rather than retarget the link.
const QUERY_DELIMS = ';=:';

function encodeFor(key, href) {
  const syntax = SYNTAX[key] || '';
  const minus = (chars) => [...syntax].filter((c) => !chars.includes(c)).join('');
  const { head, path, tail } = partsOf(href);
  const headSyntax = minus(':');
  const tailSyntax = minus(QUERY_DELIMS);
  return encodeEach(head, (c) => tokenOrControl(c) || headSyntax.includes(c))
    + encodePath(path, (c) => alwaysInPath(c) || syntax.includes(c))
    + encodeEach(tail, (c) => tokenOrControl(c) || tailSyntax.includes(c));
}

// The path-syntax escapes this writer introduces are equivalences the design accepts (round 1), so
// a destination is compared with them decoded; everything else must resolve identically.
const ALL_SYNTAX_ESC = new RegExp(`%(${[...new Set(Object.values(SYNTAX).join(''))].map((c) => c.charCodeAt(0).toString(16).toUpperCase()).join('|')})`, 'gi');
const destinationOf = (h) => { const r = resolveHref(h); return r == null ? null : r.replace(ALL_SYNTAX_ESC, (m) => decodeURIComponent(m)); };

/** See the header. */
export function withHref(key, value, link, newHref) {
  if (!CHROME_LINK_KEYS.includes(key)) throw new Error(`withHref: \`${key}\` is not a chrome link key`);
  const v = String(value || '');
  const [, links] = read(key, v);
  const idx = link ? links.findIndex((l) => l.start === link.start && l.end === link.end && l.href === link.href) : -1;
  if (idx < 0) throw new Error(`withHref: no link ${JSON.stringify(link && link.href)} at ${link && link.start} in this \`${key}\` value — re-read it with parseChromeLinks`);
  const want = String(newHref ?? '');
  if (!want) throw new Error('withHref: an empty href is not a link');
  const from = links[idx];
  // Writing a link's own href back is no edit: the bytes stay, whatever they hold (the law).
  if (want === from.href) return v;
  // Every reader trims an href's ends and a URL parser strips leading/trailing C0 and space, so a
  // target that begins or ends in either has no spelling that means it — refuse, never guess.
  if (want !== want.trim() || /^[\u0000-\u0020]|[\u0000-\u0020]$/.test(want)) {
    throw new Error(`withHref: ${JSON.stringify(want)} begins or ends in whitespace, which no \`${key}\` link can hold`);
  }
  if (LONE_SURROGATE.test(want)) throw new Error(`withHref: ${JSON.stringify(want)} holds a lone surrogate, which no URL can`);
  // Where a browser must end up: the canonical spelling's destination. No destination, no write.
  const goal = destinationOf(encodeTarget(want));
  if (goal == null) throw new Error(`withHref: ${JSON.stringify(want)} is not a URL a browser can follow`);
  // The readable spelling is a candidate only when its path holds nothing from the always-encoded
  // set (and its scheme, authority, query and fragment no whitespace or control).
  const p = partsOf(want);
  const readable = ![...p.path].some(alwaysInPath) && ![...p.head + p.tail].some(tokenOrControl);
  const candidates = readable ? [want, encodeFor(key, want)] : [encodeFor(key, want)];
  for (const href of candidates) {
    const out = v.slice(0, from.start) + href + v.slice(from.end);
    // Both oracles: the grammar reads it back as exactly this one change, AND the browser goes there.
    if (readsAs(key, v, idx, href, out) && destinationOf(href) === goal) return out;
  }
  throw new Error(`withHref: \`${key}\` cannot hold ${JSON.stringify(want)} as this one link without changing how the rest of the value reads`);
}

// Does `out` read exactly as `v` does, except that link `idx` now targets `href`?
function readsAs(key, v, idx, href, out) {
  const [model, links] = read(key, v);
  const [model2, links2] = read(key, out);
  if (links2.length !== links.length) return false;
  const l = links2[idx];
  if (l.start !== links[idx].start || l.href !== href) return false;
  // Write the expected href into the first reading (a fresh object), then compare whole readings.
  if (links[idx].obj) {
    if (key === 'header-actions') { links[idx].obj.target = href; links[idx].obj.key = href; } else links[idx].obj.href = href;
    return JSON.stringify(model) === JSON.stringify(model2);
  }
  return model2 === href;
}
