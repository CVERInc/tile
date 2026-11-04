// Prototype property names must remain ordinary tag names in links and archive routes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: new URL('./site-core.js', import.meta.url).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const blog = await import('./astro/src/lib/blog.mjs');
const { tagUrls } = await import('./astro/src/lib/sitemap.mjs');
const names = ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'];
const routes = [
  'tag/[slug]/index.astro',
  'tag/[slug]/page/[n].astro',
  '[...loc]/tag/[slug]/index.astro',
  '[...loc]/tag/[slug]/page/[n].astro',
];

// Execute each route's actual path generator, replacing only Astro's build-time glob input.
// Parsing posts, site metadata, locale corpora, slug maps and pagination all stay real.
const generators = routes.map((route) => {
  const source = readFileSync(new URL(`./astro/src/pages/${route}`, import.meta.url), 'utf8');
  const imports = source.match(/import \{ ([^}]+) \} from '[^']+\/lib\/blog\.mjs';/);
  const generator = source.match(/export (function getStaticPaths\(\) \{[\s\S]*?\n\})\n\nconst /);
  assert.ok(imports && generator, `cannot extract path generator: ${route}`);
  const run = new Function('blog', 'glob',
    `const { ${imports[1]} } = blog; return (${generator[1].replaceAll('import.meta.glob', 'glob')})();`);
  return { route, run };
});

for (const name of names) {
  for (const mapped of [false, true]) {
    const slug = mapped ? (name === 'toString' ? 'ts' : 'mapped-tag') : name;
    const meta = {
      lang: 'en-US', locales: 'en-US, fr-FR',
      'blog-tag-routes': 'true', 'blog-page-size': '1',
      ...(mapped ? { 'blog-tag-slugs': `${name}=${slug}` } : {}),
    };
    const markdown = `---\ntitle: Tagged post\npubDate: 2024-01-01\ntags: [${name}]\n---\n\nBody.\n`;
    const files = { '/s/blog/one.md': markdown, '/s/blog/two.md': markdown };
    const posts = blog.allPosts(files);
    const label = `${name} ${mapped ? 'mapped' : 'unmapped'}`;

    test(`${label}: tag links`, () => {
      assert.equal(blog.tagHref(meta, posts[0].tags[0]), `/tag/${slug}/`);
      assert.equal(blog.tagHref({ ...meta, lang: 'fr-FR' }, name), `/fr-fr/tag/${slug}/`);
    });
    test(`${label}: routed tag set`, () => {
      assert.deepEqual([...blog.routedTags(posts, meta)], [slug]);
    });
    test(`${label}: sitemap`, () => {
      assert.deepEqual(tagUrls(posts, meta, blog.tagSlugMap(meta)), [`/tag/${slug}/`]);
    });

    const site = `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
    const glob = (pattern) => {
      if (pattern.endsWith('blog/*/*.md')) {
        return { '/s/blog/fr-fr/one.md': markdown, '/s/blog/fr-fr/two.md': markdown };
      }
      if (pattern.endsWith('blog/*.md')) return files;
      if (/content\/\*\*?\/?\*?\.md$/.test(pattern)) return { '/s/content/_site.md': site };
      throw new Error(`unexpected glob: ${pattern}`);
    };
    for (const { route, run } of generators) {
      test(`${label}: ${route}`, () => {
        const paths = run(blog, glob);
        const params = { ...(route.startsWith('[...loc]') ? { loc: 'fr-fr' } : {}), slug,
          ...(route.includes('/page/') ? { n: '2' } : {}) };
        assert.deepEqual(paths.map((p) => p.params), [params]);
        assert.equal(paths[0].props.tag, name);
        assert.equal(paths[0].props.slug, slug);
      });
    }
  }

  test(`${name}: caller-supplied maps ignore inherited slugs`, () => {
    const meta = { 'blog-tag-routes': true };
    for (const map of [{}, Object.create({ [name]: 'inherited-slug' })]) {
      assert.equal(blog.tagHref(meta, name, map), `/tag/${name}/`);
      assert.deepEqual(tagUrls([{ tags: [name] }], meta, map), [`/tag/${name}/`]);
    }
    assert.deepEqual(tagUrls([{ tags: [name] }], meta), [`/tag/${name}/`]);
    const own = { [name]: 'own-slug' };
    assert.equal(blog.tagHref(meta, name, own), '/tag/own-slug/');
    assert.deepEqual(tagUrls([{ tags: [name] }], meta, own), ['/tag/own-slug/']);
  });
}

test('__proto__ configuration is ordinary data and cannot change the map prototype', () => {
  const map = blog.tagSlugMap({ 'blog-tag-slugs': '__proto__=proto-tag | ordinary=ok' });
  assert.equal(Object.getPrototypeOf(map), null);
  assert.equal(Object.hasOwn(map, '__proto__'), true);
  assert.equal(map.__proto__, 'proto-tag');
  assert.equal(map.ordinary, 'ok');
  assert.equal(map.toString, undefined);
});
