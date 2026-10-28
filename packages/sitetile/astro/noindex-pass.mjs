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
//   • the hidden `thanks_to` field of every inbox form in the emitted HTML — the path the forwarder
//     redirects to (Form.astro writes it only for `action=inbox` with a `thanks=` safeInternalPath
//     accepted), read from the markup the visitor gets, so a form on a page nobody can open counts
//     for nothing;
//   • the sitemap.xml the route wrote (pages/sitemap.xml.js) — read for its ORDER, its spelling of
//     each URL and the lastmod of pages that carry no stamp (term archives), never for membership.
// Outputs: each stamp removed (a page's bytes are what they were before noindex existed), a robots
// meta where a stamp was on a noindex page, and sitemap.xml rewritten from the file list.
//
// A thanks target (and a sitemap <loc>) names a file the way a static host maps a URL: resolved
// like the browser resolves it (`new URL` — `/./x` → `/x`, query and fragment dropped), each segment
// percent-decoded on its own (a segment that decodes to `/` names no file), joined as a filesystem
// path (`x//y` is the file x/y), then `<path>` if that file exists, else `<path>/index.html`. A
// target that names no existing file matches nothing. No case folding.
//
// WHY a post-build hook, like locale-404.mjs: production runs a plain `npx astro build` and nothing
// after it, so a post-step anywhere else would be absent from every real site.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAV_BASE = 'http://sitetile.invalid/';
const ROBOTS = '<meta name="robots" content="noindex">';
// An empty attribute is written bare (`content`), so the value is optional.
const NOINDEX_STAMP = /<meta name="sitetile:noindex" content(?:="([^"]*)")?>/;
const SITEMAP_STAMP = /<meta name="sitetile:sitemap" content(?:="([^"]*)")?>/;
// Form.astro: `<input type="hidden" name="thanks_to" value={thanksPath} />`. `thanks_to` is a
// reserved inbox field name (RESERVED_INBOX_NAMES), so no author field can carry it.
const THANKS_FIELD = /<input type="hidden" name="thanks_to" value="([^"]*)">/g;

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

/** Read every emitted page: its stamps (head only — a body can quote anything) and the thanks
 *  targets of its forms. */
export function readPages(dir) {
  const pages = new Map();
  for (const rel of htmlFiles(dir)) {
    const html = readFileSync(join(dir, rel), 'utf8');
    const headEnd = html.indexOf('</head>');
    const head = headEnd < 0 ? html : html.slice(0, headEnd);
    const n = NOINDEX_STAMP.exec(head);
    const s = SITEMAP_STAMP.exec(head);
    const thanks = [...html.matchAll(THANKS_FIELD)].map((m) => unescAttr(m[1]));
    pages.set(rel, {
      html, headEnd,
      noindexStamp: n ? n[0] : null, flag: n ? flagOf(n[1]) : undefined,
      sitemapStamp: s ? s[0] : null, listing: s ? listingOf(unescAttr(s[1] || '')) : undefined,
      robots: /<meta name="robots"/.test(head),
      thanks,
    });
  }
  return pages;
}

/** The files decided noindex: own flag true, or — not said — some emitted form's thanks target. */
export function noindexFiles(dir, pages) {
  const targets = new Set();
  for (const p of pages.values()) for (const t of p.thanks) {
    const f = fileForPath(dir, t);
    if (f) targets.add(f);
  }
  const out = new Set();
  for (const [rel, p] of pages) if (p.flag === true || (p.flag === undefined && targets.has(rel))) out.add(rel);
  return out;
}

/** The page's bytes with its stamps removed and, when decided noindex, the robots meta in the
 *  noindex stamp's place (or before </head> for a page that has no stamp and no robots meta). */
export function rewritePage(p, noindex) {
  let html = p.html;
  if (p.noindexStamp) html = html.replace(p.noindexStamp, noindex && !p.robots ? ROBOTS : '');
  else if (noindex && !p.robots && p.headEnd >= 0) html = html.replace('</head>', ROBOTS + '</head>');
  if (p.sitemapStamp) html = html.replace(p.sitemapStamp, '');
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

/** The whole pass over an output dir. Returns what it decided, for tests and the build log. */
export function applyNoindex(dir) {
  const pages = readPages(dir);
  const noindex = noindexFiles(dir, pages);
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
    hooks: { 'astro:build:done': ({ dir }) => { applyNoindex(fileURLToPath(dir)); } },
  };
}
