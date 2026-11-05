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
function loadRoute(route) {
  const source = readFileSync(new URL(`./astro/src/pages/${route}`, import.meta.url), 'utf8');
  const imports = source.match(/import \{ ([^}]+) \} from '[^']+\/lib\/blog\.mjs';/);
  const generator = source.match(/export (function getStaticPaths\(\) \{[\s\S]*?\n\})\n\nconst /);
  assert.ok(imports && generator, `cannot extract path generator: ${route}`);
  const run = new Function('blog', 'glob',
    `const { ${imports[1]} } = blog; return (${generator[1].replaceAll('import.meta.glob', 'glob')})();`);
  const frontmatter = source.match(/\n(const \{[^\n]+ = Astro.props;[\s\S]*?)\n---/);
  assert.ok(frontmatter, `cannot extract archive view: ${route}`);
  const view = new Function('blog', 'Astro',
    `const { ${imports[1]} } = blog; ${frontmatter[1]}; return { heading, subhead };`);
  return { route, run, view };
}
const generators = routes.map(loadRoute);

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


for (const name of names) {
  for (const surface of ['index', 'post']) {
    test(`${name}: ${surface} tag cloud matches ordinary sizes`, () => {
      const cloud = (tag) => {
        const posts = blog.allPosts(Object.fromEntries(['alpha', 'alpha', 'beta', tag].map((t, i) =>
          [`/s/blog/${i}.md`, `---\ntitle: Post ${i}\npubDate: 2024-01-01\ntags: [${t}]\n---\nBody.`])));
        const meta = { 'blog-sidebar': true, 'blog-post-sidebar': 'right' };
        const view = surface === 'index' ? blog.buildIndexView(posts, meta) : blog.buildPostSidebar(posts, meta);
        assert.equal(view.archiveSidebar, true);
        return { counts: view.tagCounts,
          sizes: ['alpha', 'beta', tag].map((t) => blog.tagFontSize(view.tagCounts[t], view.tagCounts)) };
      };
      const ordinary = cloud('ordinary');
      assert.deepEqual(ordinary.sizes, ['1.500em', '0.800em', '0.800em']);
      const actual = cloud(name);
      assert.deepEqual(actual.sizes, ordinary.sizes, `${name}: tag cloud sizes must match ordinary`);
      assert.equal(Object.hasOwn(actual.counts, name), true);
      assert.equal(actual.counts[name], 1);
    });
  }

  test(`${name}: archive display-name map treats prototype names as data`, () => {
    assert.equal(blog.kvMap('')[name], undefined);
    const map = blog.kvMap(`${name}=Display name`);
    assert.equal(Object.getPrototypeOf(map), null);
    assert.equal(Object.hasOwn(map, name), true);
    assert.equal(map[name], 'Display name');
  });
}

test('parsing __proto__ leaves Object.prototype unchanged', () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const keys = Reflect.ownKeys(Object.prototype);
  const x = ({}).x;
  blog.tagSlugMap({ 'blog-tag-slugs': '__proto__=x' });
  blog.kvMap('__proto__=x');
  assert.deepEqual(Reflect.ownKeys(Object.prototype), keys, 'parsing must not add Object.prototype keys');
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  assert.equal(({}).x, x);
});

const archiveRoutes = [
  'category/[slug]/index.astro',
  'category/[slug]/page/[n].astro',
  '[...loc]/category/[slug]/index.astro',
  '[...loc]/category/[slug]/page/[n].astro',
  'author/[slug]/index.astro',
  'author/[slug]/page/[n].astro',
];
for (const route of archiveRoutes) {
  const { run, view } = loadRoute(route);
  for (const name of names) {
    for (const mapped of [false, true]) {
      test(`${name} ${mapped ? 'mapped' : 'unmapped'}: archive heading in ${route}`, () => {
        const meta = {
          lang: 'en-US', locales: 'en-US, fr-FR',
          'blog-category-routes': 'true', 'blog-author-routes': 'true', 'blog-page-size': '1',
          ...(mapped ? { 'blog-category-names': `${name}=Category name`,
            'blog-author-names': `${name}=Author name` } : {}),
        };
        const markdown = `---\ntitle: Categorized post\npubDate: 2024-01-01\ncategories: [${name}]\nauthor: ${name}\n---\nBody.`;
        const site = `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
        const glob = (pattern) => {
          if (pattern.endsWith('blog/*/*.md')) return { '/s/blog/fr-fr/one.md': markdown, '/s/blog/fr-fr/two.md': markdown };
          if (pattern.endsWith('blog/*.md')) return { '/s/blog/one.md': markdown, '/s/blog/two.md': markdown };
          if (/content\/\*\*?\/?\*?\.md$/.test(pattern)) return { '/s/content/_site.md': site };
          throw new Error(`unexpected glob: ${pattern}`);
        };
        const paths = run(blog, glob);
        assert.deepEqual(paths.map((p) => p.params), [{
          ...(route.startsWith('[...loc]') ? { loc: 'fr-fr' } : {}), slug: name,
          ...(route.includes('/page/') ? { n: '2' } : {}),
        }]);
        assert.deepEqual(paths[0].props.posts[0].categories, [name]);
        assert.deepEqual(paths[0].props.posts[0].tags, [name]);
        const expected = mapped ? (route.startsWith('author/') ? 'Author name' : 'Category name') : name;
        const result = view(blog, { props: paths[0].props });
        assert.equal(result.heading, expected, 'archive heading must be the authored label or literal slug');
        assert.ok(result.subhead.endsWith(expected));
      });
    }
    test(`${name}: archive heading ignores inherited display names: ${route}`, () => {
      const inherited = Object.create({ [name]: 'Inherited name' });
      const result = view({ ...blog, kvMap: () => inherited }, {
        props: { posts: [], meta: {}, slug: name, urlLoc: 'fr-fr', pageNum: 2 },
      });
      assert.equal(result.heading, name);
    });
  }
}
