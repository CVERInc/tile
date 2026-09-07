// The agent-readable artifacts: what they contain, what they must never contain, and what a build
// that was told not to make them emits instead (nothing).
//   run: node --test agent-artifacts.test.mjs
//
// These files are handed to anyone who asks, with no question asked — the same posture as the feed
// and the search index, and the reason private-artifacts.test.mjs exists. What is new here is that
// one of them is a FULL-TEXT dump and another is a per-route mirror of the page body, so a privacy
// miss is not a leaked excerpt but the whole post. Every negative assertion below therefore carries
// its own positive control: the SAME fixture through the SAME builder with `visibility` flipped,
// where the sentinel MUST appear. A miss with no control is equally consistent with an artifact
// that was never built.
//
// The builders live in astro/src/lib/agent-artifacts.mjs precisely so this file can execute them.
// blog.mjs reaches the model layer through the `@sitetile` build alias, which only Vite resolves;
// the resolve hook below is what lets plain `node --test` reach the real functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const SITE_CORE = pathToFileURL(join(HERE, 'site-core.js')).href;

register(
  'data:text/javascript,' + encodeURIComponent(
    `export function resolve(spec, ctx, next) {
       if (spec === '@sitetile') return { url: ${JSON.stringify(SITE_CORE)}, shortCircuit: true };
       return next(spec, ctx);
     }`),
  import.meta.url,
);

const { parseSite, deriveDescription } = await import(SITE_CORE);
const { allPosts, postUrl } = await import(pathToFileURL(join(SRC, 'lib/blog.mjs')).href);
const { canonicalPath } = await import(pathToFileURL(join(SRC, 'lib/sitemap.mjs')).href);
const {
  GENERATED_BY,
  LLMS_FULL_MAX_BYTES,
  agentBundle,
  agentGate,
  assertNoAssetCollision,
  generatorOwnedPaths,
  markdownAsset,
  pageDoc,
  postDoc,
} = await import(pathToFileURL(join(SRC, 'lib/agent-artifacts.mjs')).href);

const ORIGIN = 'https://fixture.example';
const SENTINEL = 'QUARTZLINE-93715-PAIDWORDS';
const hits = (haystack) => String(haystack || '').split(SENTINEL).length - 1;

// ---- the fixture site ------------------------------------------------------------------------
// One content page carrying every shape the projection has to decide about: a hugging type line,
// a mid-body `%% … %%` comment, a linked grid cell, an image with alt text, and an `embed` section
// whose body is raw script.
const ABOUT = [
  '---',
  'sitetile-page: true',
  'title: About the studio',
  'description: Hand-set type, one character at a time.',
  'nav: |',
  '  - Home /',
  '---',
  '',
  '## What we do',
  '%% sitetile: grid cols=3 %%',
  'We set type by hand.',
  '%% internal note: BUILDONLYMARKER, never ships %%',
  '',
  '### Letterpress →/letterpress',
  'Deep impression on cotton paper.',
  '',
  '![a press bed](/img/press.jpg)',
  '',
  '## Measurement',
  '%% sitetile: embed %%',
  '<script>window.__leak = "EMBEDSCRIPTMARKER";</script>',
  '',
].join('\n');

const HOME = [
  '---',
  'sitetile-page: home',
  'title: Yamada Letterpress',
  '---',
  '',
  '## One character, one piece of lead',
  'The studio opens at seven.',
  '',
].join('\n');

const gatedPost = (visibility) => [
  '---',
  'title: The Gated One',
  `description: ${SENTINEL} teaser line`,
  'pubDate: 2026-08-20',
  'tags: [alpha]',
  ...(visibility ? [`visibility: ${visibility}`] : []),
  '---',
  '',
  `${SENTINEL} the paragraph marked private.`,
  '',
].join('\n');

const OPEN_POST = [
  '---',
  'title: The Open One',
  'description: open teaser line',
  'pubDate: 2026-08-19',
  'tags: [alpha]',
  '---',
  '',
  'Freely readable paragraph.',
  '',
].join('\n');

const TRANSLATED = [
  '---',
  'title: 公開的那一篇',
  'description: 中文摘要',
  'pubDate: 2026-08-19',
  '---',
  '',
  '可以自由閱讀的段落。',
  '',
].join('\n');

const META = { title: 'Fixture Site', description: 'A fixture.', 'blog-path': '/journal' };
const META_ZH = { ...META, 'blog-path': '/zh-tw/journal', 'blog-url-pattern': '/zh-tw/journal/%postname%' };

const contentDoc = (raw) => {
  const site = parseSite(raw);
  return {
    title: String(site.meta.title || '').trim(),
    summary: String(site.meta.description || '').trim() || deriveDescription(site.sections),
    sections: site.sections,
  };
};

/** The corpus lib/agent-corpus.mjs assembles from the globs, built here from the same builders. */
const corpusFor = (visibility) => {
  const posts = allPosts({
    '../../blog/gated-one.md': gatedPost(visibility),
    '../../blog/open-one.md': OPEN_POST,
  });
  const translated = allPosts({ '../../blog/zh-tw/open-one.md': TRANSLATED });
  return {
    site: { name: META.title, description: META.description, origin: ORIGIN },
    docs: [
      pageDoc({ path: '/', ...contentDoc(HOME) }),
      pageDoc({ path: '/about', ...contentDoc(ABOUT) }),
      ...posts.map((post) => postDoc({ path: canonicalPath(postUrl(post, META)), post })),
      ...translated.map((post) => postDoc({ path: canonicalPath(postUrl(post, META_ZH)), post })),
    ],
  };
};

const ON = { generate: true, manualLlms: false };
const bundleFor = (visibility, gate = ON, assetExists = () => false) =>
  agentBundle(corpusFor(visibility), { gate, origin: ORIGIN, assetExists });

// ---- the gate --------------------------------------------------------------------------------

test('the build gate is one neutral flag, and no policy vocabulary crosses into this renderer', () => {
  assert.deepEqual(agentGate({}), { generate: false, manualLlms: false });
  assert.deepEqual(agentGate({ SITETILE_AGENT_ARTIFACTS: '1' }), { generate: true, manualLlms: false });
  assert.deepEqual(
    agentGate({ SITETILE_AGENT_ARTIFACTS: '1', SITETILE_AGENT_LLMS_MANUAL: '1' }),
    { generate: true, manualLlms: true },
  );
  // A manual-llms flag on its own never turns generation on.
  assert.deepEqual(agentGate({ SITETILE_AGENT_LLMS_MANUAL: '1' }), { generate: false, manualLlms: false });

  const src = ['agent-artifacts.mjs', 'agent-corpus.mjs']
    .map((f) => readFileSync(join(SRC, 'lib', f), 'utf8')).join('\n');
  for (const level of ['cite', 'train', 'search-only']) {
    assert.equal(src.includes(`'${level}'`), false, `the renderer must not carry the ${level} level name`);
  }
});

test('gate off emits nothing at all', () => {
  const off = bundleFor('private', { generate: false, manualLlms: false });
  assert.equal(off.llms, null);
  assert.equal(off.llmsFull, null);
  assert.equal(off.catalog, null);
  assert.equal(off.mapping, null);
  assert.equal(off.markdown.size, 0);
});

test('a hand-written llms.txt suppresses ours and nothing else', () => {
  const manual = bundleFor('private', { generate: true, manualLlms: true });
  assert.equal(manual.llms, null, 'the generator must not write over the owner\'s own llms.txt');
  assert.ok(manual.llmsFull, 'the rest of the artifacts still generate');
  assert.ok(manual.catalog);
  assert.ok(manual.mapping.routes.length);
  assert.ok(manual.markdown.size);
  // The path is served either way, so the catalog keeps naming it.
  assert.equal(manual.catalog.llms, '/llms.txt');
  assert.equal(generatorOwnedPaths(corpusFor('private')).includes('/llms.txt'), false,
    'llms.txt is the one path the owner may claim; it must not be in the fail-closed set');
});

// ---- llms.txt ---------------------------------------------------------------------------------

test('llms.txt opens with the site name, lists every public route, and names its own producer', () => {
  const { llms } = bundleFor('private');
  const lines = llms.split('\n');
  assert.equal(lines[0], '# Fixture Site');
  assert.ok(llms.includes('> A fixture.'));
  assert.ok(llms.includes('## Pages'));
  assert.ok(llms.includes('## Posts'));
  assert.ok(llms.includes('- [About the studio](/about/): Hand-set type, one character at a time.'));
  assert.ok(llms.includes('- [Yamada Letterpress](/): The studio opens at seven.'),
    'a page with no description falls back to the renderer\'s own derived one');
  assert.ok(llms.includes('- [The Open One](/journal/open-one/): open teaser line'));
  assert.ok(llms.includes('- [公開的那一篇](/zh-tw/journal/open-one/): 中文摘要'),
    'each public locale route may appear');
  assert.equal(lines.filter((l) => l.startsWith(GENERATED_BY)).length, 1);
  assert.equal(lines[lines.length - 2], GENERATED_BY, 'the producer line is the footer');
});

test('a private post is named in llms.txt and described nowhere', () => {
  const { llms } = bundleFor('private');
  assert.equal(hits(llms), 0, `llms.txt leaked the gated description:\n${llms}`);
  assert.ok(llms.includes('- [The Gated One](/journal/gated-one/)'), 'the gated post keeps title and path');
  assert.equal(llms.includes('- [The Gated One](/journal/gated-one/):'), false,
    'a private line must carry no summary at all');

  // positive control — same post, same builder, visibility flipped.
  const asPublic = bundleFor('public').llms;
  assert.ok(hits(asPublic) > 0, 'control failed: the public build carries no sentinel either');
  assert.ok(asPublic.includes('- [The Gated One](/journal/gated-one/): ' + SENTINEL + ' teaser line'));
});

// ---- llms-full.txt and the size guard ---------------------------------------------------------

test('llms-full.txt carries the public corpus whole, each document behind its own provenance', () => {
  const { llmsFull } = bundleFor('private');
  assert.ok(llmsFull.startsWith('# Fixture Site'));
  assert.ok(llmsFull.includes('source: https://fixture.example/about/'));
  assert.ok(llmsFull.includes('title: "About the studio"'));
  assert.ok(llmsFull.includes('Deep impression on cotton paper.'));
  assert.ok(llmsFull.includes('Freely readable paragraph.'));
  assert.ok(llmsFull.trimEnd().endsWith(GENERATED_BY));
});

test('llms-full.txt has no private body, description or excerpt in it', () => {
  const { llmsFull } = bundleFor('private');
  assert.equal(hits(llmsFull), 0, `llms-full leaked the gated post:\n${llmsFull}`);
  assert.equal(llmsFull.includes('The Gated One'), false,
    'a private post has no document in the full dump at all');

  const asPublic = bundleFor('public').llmsFull;
  assert.ok(hits(asPublic) > 0, 'control failed: the public full dump carries no sentinel either');
  assert.ok(asPublic.includes(`${SENTINEL} the paragraph marked private.`),
    'control failed: the public document does not carry the post body either');
  assert.ok(asPublic.includes('title: "The Gated One"'), 'control failed: the document never appears');
});

test('over the size guard the full dump is absent, not truncated, and the catalog says so', () => {
  const corpus = corpusFor('public');
  const huge = { ...corpus, docs: [...corpus.docs, pageDoc({ path: '/long', title: 'Long', summary: '', sections: [{ title: 'Body', type: 'prose', body: 'x'.repeat(LLMS_FULL_MAX_BYTES + 1) }] })] };
  const over = agentBundle(huge, { gate: ON, origin: ORIGIN });
  assert.equal(over.llmsFull, null, 'a corpus past the guard must produce no file');
  assert.equal(over.catalog.llms_full, null, 'the catalog must not name a file this build did not write');
  // …and the page markdown for that route still exists, so the guard bounds ONE artifact.
  assert.ok(over.markdown.get('/long/'));

  const under = bundleFor('public');
  assert.ok(new TextEncoder().encode(under.llmsFull).length <= LLMS_FULL_MAX_BYTES);
  assert.equal(under.catalog.llms_full, '/llms-full.txt');
});

// ---- the catalog ------------------------------------------------------------------------------

test('the catalog states version, producer and only targets this build produced', () => {
  const withRobots = bundleFor('private', ON, (rel) => rel === 'robots.txt');
  assert.deepEqual(withRobots.catalog, {
    version: 1,
    generator: 'feelreef',
    site: ORIGIN,
    robots: '/robots.txt',
    llms: '/llms.txt',
    llms_full: '/llms-full.txt',
    markdown: { negotiation: true },
    sitemap: '/sitemap.xml',
    mcp: null,
  });
  // No robots.txt in this site's assets → the catalog does not claim one.
  assert.equal(bundleFor('private').catalog.robots, null);
});

test('every non-null catalog target exists in the same build output', () => {
  const bundle = bundleFor('private', ON, (rel) => rel === 'robots.txt');
  const emitted = new Set([
    ...(bundle.llms ? ['/llms.txt'] : []),
    ...(bundle.llmsFull ? ['/llms-full.txt'] : []),
    ...(bundle.catalog ? ['/.well-known/ai-catalog.json'] : []),
    ...(bundle.mapping ? ['/reef-agent-markdown.json'] : []),
    ...bundle.mapping.routes.map((r) => r.asset),
    '/robots.txt',      // the site's own assets, seen by the assetExists probe above
    '/sitemap.xml',     // pages/sitemap.xml.js, emitted on every build
  ]);
  for (const [key, value] of Object.entries(bundle.catalog)) {
    if (typeof value !== 'string' || !value.startsWith('/')) continue;
    assert.ok(emitted.has(value), `catalog.${key} points at ${value}, which this build did not emit`);
  }
  // the control: a target the build did NOT produce must be caught by that same loop.
  assert.equal(emitted.has('/llms-nope.txt'), false);
});

// ---- the per-route markdown -------------------------------------------------------------------

test('page markdown keeps what a reader sees and drops what only the build reads', () => {
  const md = bundleFor('private').markdown.get('/about/');
  assert.ok(md.startsWith('---\ntitle: "About the studio"\nsource: https://fixture.example/about/\n---\n'),
    `provenance header missing or reshaped:\n${md}`);
  assert.ok(md.includes('# About the studio'));
  assert.ok(md.includes('## What we do'));
  assert.ok(md.includes('We set type by hand.'));
  assert.ok(md.includes('### [Letterpress](/letterpress)'), 'a linked cell keeps its link');
  assert.ok(md.includes('![a press bed](/img/press.jpg)'), 'image alt text survives');

  for (const internal of ['%%', 'sitetile: grid', 'cols=3', 'BUILDONLYMARKER', 'sitetile-page', 'nav:']) {
    assert.equal(md.includes(internal), false, `page markdown carried build-only content: ${internal}`);
  }
  // `embed` is raw HTML/JS, not prose: the heading stays, the script does not.
  assert.ok(md.includes('## Measurement'));
  assert.equal(md.includes('EMBEDSCRIPTMARKER'), false);
  assert.equal(md.includes('<script'), false);
});

test('a private post has no markdown twin, and the public control does', () => {
  const gated = bundleFor('private');
  assert.equal(gated.markdown.has('/journal/gated-one/'), false,
    'a gated URL must have no guessable markdown body asset');
  assert.equal(hits([...gated.markdown.values()].join('\n')), 0);

  const open = bundleFor('public');
  assert.ok(open.markdown.has('/journal/gated-one/'), 'control failed: no markdown twin is written at all');
  assert.ok(hits(open.markdown.get('/journal/gated-one/')) > 0, 'control failed: the twin carries no sentinel');
});

test('the markdown asset path mirrors the HTML output shape', () => {
  assert.equal(markdownAsset('/'), '/index.md');
  assert.equal(markdownAsset('/about/'), '/about/index.md');
  assert.equal(markdownAsset('/about'), '/about/index.md');
  assert.equal(markdownAsset('/zh-tw/journal/open-one/'), '/zh-tw/journal/open-one/index.md');
});

// ---- the worker mapping -----------------------------------------------------------------------

test('the mapping holds exactly the public static routes of this build', () => {
  const { mapping } = bundleFor('private');
  assert.equal(mapping.schemaVersion, 1);
  assert.deepEqual(mapping.routes, [
    { path: '/', asset: '/index.md' },
    { path: '/about/', asset: '/about/index.md' },
    { path: '/journal/open-one/', asset: '/journal/open-one/index.md' },
    { path: '/zh-tw/journal/open-one/', asset: '/zh-tw/journal/open-one/index.md' },
  ]);
  assert.equal(mapping.routes.some((r) => r.path.includes('gated-one')), false,
    'a private gated path must never enter the mapping');
  // every mapped asset is a file this build actually wrote
  const written = bundleFor('private').markdown;
  for (const route of mapping.routes) assert.ok(written.has(route.path), `no markdown for ${route.path}`);

  const asPublic = bundleFor('public').mapping;
  assert.ok(asPublic.routes.some((r) => r.path === '/journal/gated-one/'),
    'control failed: the post never enters the mapping even when public');
});

// ---- collisions -------------------------------------------------------------------------------

test('a generator-owned path already in the site\'s assets fails the build by name', () => {
  const corpus = corpusFor('private');
  for (const owned of ['llms-full.txt', '.well-known/ai-catalog.json', 'reef-agent-markdown.json', 'about/index.md']) {
    assert.throws(
      () => assertNoAssetCollision(corpus, (rel) => rel === owned),
      (err) => err instanceof Error && err.message.includes('/' + owned),
      `a collision on ${owned} must fail the build and name the path`,
    );
  }
  // the control: nothing in the assets → nothing thrown.
  assert.doesNotThrow(() => assertNoAssetCollision(corpus, () => false));
  // and the owner's own llms.txt is not a collision — it is the answer.
  assert.doesNotThrow(() => assertNoAssetCollision(corpus, (rel) => rel === 'llms.txt'));
});
