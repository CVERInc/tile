// Guard: a route's page title names the site through site-core, never by reading `meta.title`.
//   run: node packages/sitetile/route-title-site-name.test.mjs   (wired into scripts/test.sh by its glob)
//
// 🩸 reef#3040 (measured on a staging build): tile#277/#279 made a seeded placeholder site title
// count as unset for og:site_name, JSON-LD, llms.txt and the inbox bubble, but about fifteen routes
// (blog index, post, 404, tag / category / author / date archives, search, preview) still built
// their <title> as `${heading} — ${meta.title}`. A site still carrying the placeholder printed it in
// <title>, og:title, twitter:title and the footer line on every one of those routes.
//
// The rule, one helper for every route: site-core `titleSiteName(meta)` (the routeSiteNameSource
// chain — real title → brand → footer-brand — with a placeholder treated as no name at all) and
// `siteTitleSuffix(meta, sep)` (that name after `sep`, or '' so the suffix is omitted). The real
// builds are measured in the astro smoke ("title suffix (reef#3040)"); this file holds the chain's
// rows and the CENSUS: no route may compose the suffix from `meta.title` itself again.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { titleSiteName, siteTitleSuffix, PLACEHOLDER_SITE_TITLES } from './site-core.js';
import { feedTitle } from './astro/src/lib/blog-tenancy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');

test('titleSiteName / siteTitleSuffix: the site-name chain, with a placeholder never printed', () => {
  const rows = [
    // [meta, name] — a site config with the `site-title` stash (every route of a site with a _site.md)
    [{ title: 'Atlas Observatory', 'site-title': 'Atlas Observatory' }, 'Atlas Observatory'],
    [{ title: 'Atlas Observatory', 'site-title': 'Atlas Observatory', brand: 'Atlas' }, 'Atlas Observatory'],
    [{ title: 'Untitled site', 'site-title': 'Untitled site' }, ''],
    [{ title: 'Untitled site', 'site-title': 'Untitled site', brand: 'Atlas' }, 'Atlas'],
    [{ title: 'Untitled site', 'site-title': 'Untitled site', 'footer-brand': 'Atlas Footer' }, 'Atlas Footer'],
    [{ 'site-title': '' }, ''],
    [{ 'site-title': '', brand: 'Atlas' }, 'Atlas'],
    // a meta without the stash (a site with no _site.md: the home page stands in): `title` names it
    [{ title: 'Legacy Home' }, 'Legacy Home'],
    [{ title: 'Untitled site' }, ''],
    [{}, ''],
    [null, ''],
  ];
  for (const [meta, name] of rows) {
    assert.equal(titleSiteName(meta), name, JSON.stringify(meta));
    assert.equal(siteTitleSuffix(meta), name ? ` — ${name}` : '', JSON.stringify(meta));
    assert.equal(siteTitleSuffix(meta, '— '), name ? `— ${name}` : '', JSON.stringify(meta));
  }
  // every seeded placeholder, in every locale, trimmed or not
  for (const p of Object.values(PLACEHOLDER_SITE_TITLES)) {
    assert.equal(titleSiteName({ title: p, 'site-title': p }), '', p);
    assert.equal(titleSiteName({ title: ` ${p} ` }), '', p);
    assert.equal(siteTitleSuffix({ title: p, 'site-title': p }), '', p);
  }
});

test('the RSS channel title (feedTitle) takes the same name: no placeholder, nothing dangling', () => {
  assert.equal(feedTitle({ title: 'Atlas Observatory', 'site-title': 'Atlas Observatory', 'blog-title': 'Notes' }), 'Atlas Observatory — Notes');
  assert.equal(feedTitle({ title: 'Untitled site', 'site-title': 'Untitled site', 'blog-title': 'Notes' }), 'Notes');
  assert.equal(feedTitle({ title: 'Untitled site', 'site-title': 'Untitled site', brand: 'Atlas', 'blog-title': 'Notes' }), 'Atlas — Notes');
  assert.equal(feedTitle({ title: 'Untitled site' }), 'Blog');
});

// ── CENSUS ───────────────────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(astro|mjs|js)$/.test(ent.name)) out.push(p);
  }
  return out;
}
// Code only: a comment that EXPLAINS the old shape must not trip the census, and must not satisfy it.
// A block comment is one that opens a line or a `{` (`/** … */`, `{/* … */}`): a `/*` inside a string
// (an import.meta.glob pattern, '../../blog/*.md') opens nothing.
function codeOf(src) {
  return src
    .replace(/(^[ \t]*|\{[ \t]*)\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}
/**
 * The census rules, over one file's code:
 *   · an .astro route/component/layout reads no `meta.title` at all — the site's name comes from
 *     titleSiteName / siteTitleSuffix, a page's own title from `site.title` / `post.title`;
 *   · no file, .astro or library, has a line that reads `meta.title` and joins with an em dash
 *     (`— ${meta.title}`, `' — ' + meta.title`, `[meta.title, …].join(' — ')`).
 * → the offending lines, as `line: text`.
 */
function offences(file, src) {
  const lines = codeOf(src).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!/\bmeta\.title\b/.test(line)) return;
    if (file.endsWith('.astro') || /—/.test(line)) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

test('census: no route composes its title from meta.title (every route goes through siteTitleSuffix / titleSiteName)', () => {
  const files = walk(SRC);
  const astro = files.filter((f) => f.endsWith('.astro'));
  // the ruler measures something: the routes reef#3040 named are in the scan, and use the helper
  const named = ['pages/404.astro', 'pages/[...loc]/404.astro', 'components/BlogIndexView.astro', 'components/PostView.astro',
    'components/DateArchiveView.astro', 'pages/search/[...rest].astro', 'pages/search/label/[tag]/index.astro',
    'pages/tag/[slug]/index.astro', 'pages/category/[slug]/index.astro', 'pages/author/[slug]/index.astro'];
  for (const rel of named) {
    const f = join(SRC, rel);
    assert.ok(astro.includes(f), `scanned: ${rel}`);
    assert.match(codeOf(readFileSync(f, 'utf8')), /\bsiteTitleSuffix\(meta\b/, `${rel} appends the site name through siteTitleSuffix`);
  }
  assert.ok(astro.length >= 40, `astro files scanned: ${astro.length}`);
  const bad = files.flatMap((f) => offences(f, readFileSync(f, 'utf8')).map((l) => `${relative(SRC, f)}:${l}`));
  assert.deepEqual(bad, [], `compose the site name through site-core siteTitleSuffix/titleSiteName:\n  ${bad.join('\n  ')}`);
});

test('census control: the rule fires on each shape the routes used before reef#3040, and not on comments', () => {
  const shapes = [
    ['a.astro', "<SiteLayout title={`${copy.notFoundTitle} — ${meta.title || ''}`} meta={meta}>"],
    ['a.astro', "const title = heading + ' — ' + (meta.title || '');"],
    ['a.astro', "<ArchiveView title={`${tag}${uiCopy(meta.lang).pageSuffix(pageNum)}— ${meta.title || ''}`} />"],
    ['a.astro', "  ? (meta.title || meta['blog-title'] || 'Blog')"],
    ['a.astro', "const pageTitle = site.title || site.meta.title || '';"],
    ['a.mjs', "  return [String(meta.title || ''), blog].filter(Boolean).join(' — ');"],
  ];
  for (const [file, src] of shapes) assert.equal(offences(file, src).length, 1, `fires: ${src}`);
  assert.deepEqual(offences('a.astro', "// was: `${post.title} — ${meta.title}`\n{/* meta.title — gone */}\n<!-- meta.title -->"), []);
  assert.deepEqual(offences('a.mjs', "title: String(site.meta.title || '').trim(),"), [], 'a library reading a page title is not a suffix');
});
