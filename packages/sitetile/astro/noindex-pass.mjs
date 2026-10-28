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

const NAV_BASE = 'http://sitetile.invalid/';
const ROBOTS = '<meta name="robots" content="noindex">';
// An empty attribute is written bare (`content`), so the value is optional.
const NOINDEX_STAMP = /<meta name="sitetile:noindex" content(?:="([^"]*)")?>/;
const SITEMAP_STAMP = /<meta name="sitetile:sitemap" content(?:="([^"]*)")?>/;
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

const unescAttr = (s) => s.replace(/&(amp|quot|#39|#x27|apos|lt|gt);/g, (_, e) =>
  ({ amp: '&', quot: '"', '#39': "'", '#x27': "'", apos: "'", lt: '<', gt: '>' }[e]));

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

/** Read every emitted page: its stamps and robots metas (head only — a body can quote anything). */
export function readPages(dir) {
  const pages = new Map();
  for (const rel of htmlFiles(dir)) {
    const html = readFileSync(join(dir, rel), 'utf8');
    const headEnd = html.indexOf('</head>');
    const head = headEnd < 0 ? html : html.slice(0, headEnd);
    const n = NOINDEX_STAMP.exec(head);
    const s = SITEMAP_STAMP.exec(head);
    pages.set(rel, {
      html, headEnd,
      noindexStamp: n ? n[0] : null, flag: n ? flagOf(n[1]) : undefined,
      sitemapStamp: s ? s[0] : null, listing: s ? listingOf(unescAttr(s[1] || '')) : undefined,
      robots: robotsMetas(head),
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

// A <meta> tag and its attributes as an author may write them in a public/ page: any order, any
// case, quoted either way or not at all.
const META_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function attrsOf(tag) {
  const out = new Map();
  for (const m of tag.slice(5, -1).matchAll(ATTR)) {
    const k = m[1].toLowerCase();
    if (!out.has(k)) out.set(k, { raw: m[0], value: unescAttr(m[2] ?? m[3] ?? m[4] ?? '') });
  }
  return out;
}
/** Every `<meta name="robots">` in a head: the tag as written and its attributes. */
function robotsMetas(head) {
  return [...head.matchAll(META_TAG)].map((m) => ({ tag: m[0], attrs: attrsOf(m[0]) }))
    .filter((r) => (r.attrs.get('name')?.value || '').trim().toLowerCase() === 'robots');
}
/** A robots `content` made to say noindex: returned as is when it already does and nothing
 *  contradicts it; otherwise `index` dropped, `all` → `follow`, `noindex` appended once, every
 *  other directive kept in its place. */
export function mergeRobots(content) {
  const ds = String(content).split(',').map((d) => d.trim()).filter(Boolean);
  const l = (d) => d.toLowerCase();
  const says = ds.some((d) => l(d) === 'noindex' || l(d) === 'none');
  if (says && !ds.some((d) => l(d) === 'index' || l(d) === 'all')) return content;
  const out = ds.flatMap((d) => l(d) === 'index' ? [] : l(d) === 'all' ? ['follow'] : [d]);
  if (!says) out.push('noindex');
  return out.join(',');
}
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The page's bytes with its stamps and thanks marks removed and, when decided noindex: each robots
 *  meta it already has merged to say noindex (mergeRobots) — never a second tag — or, with none,
 *  the robots meta in the noindex stamp's place (before </head> for a page that has no stamp). */
export function rewritePage(p, noindex) {
  let html = p.html;
  const robots = p.robots || [];
  if (p.noindexStamp) html = html.replace(p.noindexStamp, noindex && !robots.length ? ROBOTS : '');
  else if (noindex && !robots.length && p.headEnd >= 0) html = html.replace('</head>', ROBOTS + '</head>');
  if (noindex) for (const r of robots) {
    const c = r.attrs.get('content');
    const merged = mergeRobots(c ? c.value : '');
    if (c && merged === c.value) continue;
    const tag = c ? r.tag.replace(c.raw, `content="${escAttr(merged)}"`)
      : r.tag.replace(/\s*\/?>$/, (end) => ` content="${escAttr(merged)}"${end}`);
    html = html.replace(r.tag, tag);
  }
  if (p.sitemapStamp) html = html.replace(p.sitemapStamp, '');
  for (const id of p.marks || []) html = html.replaceAll(markOf(id), '');
  return html;
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
    const html = rewritePage(p, noindex.has(rel));
    if (html !== p.html) writeFileSync(join(dir, rel), html);
  }
  const sitemap = join(dir, 'sitemap.xml');
  if (existsSync(sitemap)) writeFileSync(sitemap, rebuildSitemap(dir, readFileSync(sitemap, 'utf8'), pages, noindex));
  return { noindex: [...noindex].sort() };
}

/** Astro integration: runs after the static output is written (after locale-404's renames). */
export function noindexPass() {
  return {
    name: 'sitetile-noindex',
    hooks: {
      'astro:build:start': () => { globalThis[MANIFEST] = []; },
      'astro:build:done': ({ dir }) => {
        const manifest = globalThis[MANIFEST] || [];
        delete globalThis[MANIFEST];
        applyNoindex(fileURLToPath(dir), manifest);
      },
    },
  };
}
