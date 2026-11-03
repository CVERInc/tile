// reef#2874 — generated list routes (blog index, archives, their pages, the language chooser) get a
// markdown twin, written after the build over the files it wrote.
//   run: node --test agent-list-twins.test.mjs
//
// 🔴 The defect this pins: a customer blog's `/blog/` answered `Accept: text/markdown` with HTML
// while /.well-known/ai-catalog.json said the site negotiates markdown. The worker negotiates exactly
// the routes in reef-agent-markdown.json, and that map held only content pages and posts — so every
// list page fell through to HTML. Measured on this repo's own fixture build before the fix: the map
// had `/devlog/a-signed-post/` and no `/devlog/`, `/tag/fixture/`, `/category/press/` or `/language/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const { agentListTwins, applyListTwins, recordListTwin, routeOfFile } =
  await import(pathToFileURL(join(ASTRO, 'agent-list-twins.mjs')).href);
const { listMarkdownBody } = await import(pathToFileURL(join(ASTRO, 'src/lib/agent-markdown.mjs')).href);

const MANIFEST = Symbol.for('sitetile.agent.list-twins');
const ORIGIN = 'https://fixture.example';
const page = (inner) => `<!doctype html><html><head><title>t</title></head><body><section class="bl-index">${inner}<div class="bl-main"><ul class="bl-list"></ul></div></section></body></html>`;

/** A fake build output: the given files, plus the route map the build writes when the gate is on. */
function outDir(files, routes = [{ path: '/devlog/a-post/', asset: '/devlog/a-post/index.md' }]) {
  const dir = mkdtempSync(join(tmpdir(), 'list-twins-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  if (routes) writeFileSync(join(dir, 'reef-agent-markdown.json'), JSON.stringify({ schemaVersion: 1, routes }));
  return dir;
}
const mapping = (dir) => JSON.parse(readFileSync(join(dir, 'reef-agent-markdown.json'), 'utf8')).routes;

/** Record lists as the views do inside a gated build; returns the marks they would render. */
function record(lists) {
  globalThis[MANIFEST] = new Map();
  const marks = lists.map((l) => recordListTwin(l));
  const manifest = globalThis[MANIFEST];
  delete globalThis[MANIFEST];
  return { marks, manifest };
}

const BLOG = {
  heading: 'Blog',
  items: [
    { title: 'Newest [draft] notes', href: '/devlog/newest', date: '2026-08-05' },
    { title: 'Older', href: '/devlog/older', date: '2026-08-04' },
    { title: 'Undated', href: '/devlog/undated' },
  ],
  prev: '',
  next: '/devlog/page/2',
};

test('a list twin is the page title, one line per item (title, date, link), then the pager', () => {
  assert.equal(listMarkdownBody(BLOG), [
    '# Blog',
    '',
    '- [Newest \\[draft\\] notes](/devlog/newest) — 2026-08-05',
    '- [Older](/devlog/older) — 2026-08-04',
    '- [Undated](/devlog/undated)',
    '',
    'Next page: [/devlog/page/2](/devlog/page/2)',
  ].join('\n'));
  // a middle page names both neighbours; a link with a space cannot end the `(…)` early
  assert.match(listMarkdownBody({ heading: 'x', items: [{ title: 'a', href: '/t/a b' }], prev: '/t/x', next: '/t/x/page/3' }),
    /- \[a\]\(\/t\/a%20b\)\n\nPrevious page: \[\/t\/x\]\(\/t\/x\)\nNext page: /);
});

test('outside a gated build a view records nothing and renders no mark', () => {
  delete globalThis[MANIFEST];
  assert.equal(recordListTwin(BLOG), '');
});

test('🔴 a generated list page gets a twin beside its file and an entry in the worker route map', () => {
  const { marks: [mark], manifest } = record([BLOG]);
  assert.match(mark, /^<!--sitetile:md-twin:[0-9a-f-]{36}-->$/);
  const dir = outDir({ 'devlog/index.html': page(mark) });
  try {
    const { written } = applyListTwins(dir, manifest, { origin: ORIGIN });
    assert.deepEqual(written, [{ path: '/devlog/', asset: '/devlog/index.md' }]);
    const md = readFileSync(join(dir, 'devlog/index.md'), 'utf8');
    assert.equal(md, '---\ntitle: "Blog"\nsource: https://fixture.example/devlog/\n---\n\n' + listMarkdownBody(BLOG) + '\n');
    assert.deepEqual(mapping(dir).map((r) => r.path), ['/devlog/a-post/', '/devlog/']);
    // the page's bytes are what they were before the mark existed
    assert.equal(readFileSync(join(dir, 'devlog/index.html'), 'utf8'), page(''));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a record whose render lost its file (displaced route) writes nothing; the file on disk is the page', () => {
  const { marks: [, onDisk], manifest } = record([{ ...BLOG, heading: 'Displaced' }, { ...BLOG, heading: 'Winner' }]);
  const dir = outDir({ 'tag/x/index.html': page(onDisk) });
  try {
    const { written } = applyListTwins(dir, manifest, { origin: ORIGIN });
    assert.deepEqual(written.map((w) => w.path), ['/tag/x/']);
    assert.match(readFileSync(join(dir, 'tag/x/index.md'), 'utf8'), /^title: "Winner"$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a route an IR document already twins keeps that twin; a mark from no record is not ours', () => {
  const { marks: [mark], manifest } = record([BLOG]);
  const foreign = '<!--sitetile:md-twin:00000000-0000-0000-0000-000000000000-->';
  const dir = outDir({ 'devlog/a-post/index.html': page(mark), 'other/index.html': page(foreign) });
  try {
    assert.deepEqual(applyListTwins(dir, manifest, { origin: ORIGIN }).written, []);
    assert.equal(existsSync(join(dir, 'devlog/a-post/index.md')), false, 'the content twin route is never overwritten');
    assert.equal(readFileSync(join(dir, 'other/index.html'), 'utf8'), page(foreign), 'an unknown id is left alone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file already at the twin path fails the build by name rather than being clobbered', () => {
  const { marks: [mark], manifest } = record([BLOG]);
  const dir = outDir({ 'devlog/index.html': page(mark), 'devlog/index.md': 'the owner wrote this' });
  try {
    assert.throws(() => applyListTwins(dir, manifest, { origin: ORIGIN }), /\/devlog\/index\.md is already in this build's output/);
    assert.equal(readFileSync(join(dir, 'devlog/index.md'), 'utf8'), 'the owner wrote this');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no route map (nothing negotiates) ⇒ no twin, and the mark is still removed', () => {
  const { marks: [mark], manifest } = record([BLOG]);
  const dir = outDir({ 'devlog/index.html': page(mark) }, null);
  try {
    assert.deepEqual(applyListTwins(dir, manifest, { origin: ORIGIN }).written, []);
    assert.equal(existsSync(join(dir, 'devlog/index.md')), false);
    assert.equal(readFileSync(join(dir, 'devlog/index.html'), 'utf8'), page(''));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an emitted file names its route the way a static host serves it', () => {
  assert.equal(routeOfFile('index.html'), '/');
  assert.equal(routeOfFile('devlog/page/2/index.html'), '/devlog/page/2/');
  assert.equal(routeOfFile('zh-tw/language/index.html'), '/zh-tw/language/');
  assert.equal(routeOfFile('foo.html'), '/foo');
});

test('the integration opens a manifest only for a gated build and hands build:done the output dir', () => {
  const integration = agentListTwins();
  integration.hooks['astro:config:done']({ config: { site: ORIGIN + '/' } });
  const saved = process.env.SITETILE_AGENT_ARTIFACTS;
  try {
    delete process.env.SITETILE_AGENT_ARTIFACTS;
    integration.hooks['astro:build:start']();
    assert.equal(recordListTwin(BLOG), '', 'gate off: no manifest, no mark');
    process.env.SITETILE_AGENT_ARTIFACTS = '1';
    integration.hooks['astro:build:start']();
    const mark = recordListTwin(BLOG);
    assert.ok(mark, 'gate on: the view gets a mark');
    const dir = outDir({ 'devlog/index.html': page(mark) });
    try {
      integration.hooks['astro:build:done']({ dir: pathToFileURL(dir + '/') });
      assert.match(readFileSync(join(dir, 'devlog/index.md'), 'utf8'), /^source: https:\/\/fixture\.example\/devlog\/$/m);
      assert.equal(globalThis[MANIFEST], undefined, 'build:done releases the manifest');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally {
    if (saved === undefined) delete process.env.SITETILE_AGENT_ARTIFACTS; else process.env.SITETILE_AGENT_ARTIFACTS = saved;
    delete globalThis[MANIFEST];
  }
});

test('the renderer is wired: astro.config registers the pass and every list view records its list', () => {
  const config = readFileSync(join(ASTRO, 'astro.config.mjs'), 'utf8');
  assert.match(config, /integrations: \[[^\]]*agentListTwins\(\)[^\]]*\]/);
  for (const view of ['src/components/ArchiveView.astro', 'src/components/BlogIndexView.astro', 'src/pages/[...loc]/language.astro']) {
    const src = readFileSync(join(ASTRO, view), 'utf8');
    assert.match(src, /const twinMark = recordListTwin\(\{/, `${view} records its list`);
    assert.match(src, /\{twinMark && <Fragment set:html=\{twinMark\} \/>\}/, `${view} renders the mark`);
  }
});
