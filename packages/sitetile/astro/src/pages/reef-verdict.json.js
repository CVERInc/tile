// The exact site-owned paths whose static bytes need the RSP membership verdict.
//
// This route deliberately reuses the renderer's already-authoritative post parser and URL
// builder. It is not a permalink implementation: the same postUrl() call that getStaticPaths
// uses for the page is the value written here. The build runner moves this file under _reef/ and
// hands it to the site worker emitter; an empty result is removed so a site with no private post
// keeps its existing output unchanged.
import {
  allPosts,
  blogBase,
  gatedPostPaths,
  inheritLocalePrivacy,
  siteMeta,
} from '../lib/blog.mjs';
import { toUrlLocale } from '../packages/lingo/locale.mjs';

export function getGatedPaths() {
  const meta = siteMeta(
    import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }),
  );
  const posts = allPosts(
    import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }),
  );
  const paths = gatedPostPaths(posts, meta);

  const localeBlogFiles = import.meta.glob('../../blog/*/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const locales = String(meta.locales || '').split(',').map((s) => s.trim()).filter(Boolean);
  const defaultLocale = locales[0] || '';
  const baseBySlug = new Map(posts.map((post) => [post.slug, post]));

  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    const urlLocale = toUrlLocale(locale);
    const sub = {};
    for (const [path, raw] of Object.entries(localeBlogFiles)) {
      const match = path.match(/\/blog\/([^/]+)\/([^/]+)\.md$/);
      if (match && match[1] === urlLocale) sub[path] = raw;
    }
    if (!Object.keys(sub).length) continue;

    const postsL = allPosts(sub).map((post) => inheritLocalePrivacy(post, baseBySlug.get(post.slug)));
    const base = blogBase(meta);
    const pattern = (meta['blog-url-pattern'] != null && String(meta['blog-url-pattern']).trim())
      || `${base}/%postname%`;
    const metaL = {
      ...meta,
      lang: locale,
      'blog-path': `/${urlLocale}${base}`,
      'blog-url-pattern': `/${urlLocale}${pattern}`,
    };
    paths.push(...gatedPostPaths(postsL, metaL));
  }

  return [...new Set(paths)];
}

export function GET() {
  return new Response(JSON.stringify({ schemaVersion: 1, paths: getGatedPaths() }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
