// Offline policy and CLI integration tests; image rasterization is replaced at the module boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { safeSrc } from './site-core.js';

const layout = readFileSync(new URL('./astro/src/layouts/SiteLayout.astro', import.meta.url), 'utf8');
const start = layout.indexOf('const absUrl =');
const end = layout.indexOf('// `favicon:` (falling back', start);
assert.ok(start >= 0 && end > start, 'production resolver anchors exist');
function resolve(meta, defaultOn = false) {
  let source = layout.slice(start, end);
  if (defaultOn) {
    assert.ok(source.includes('const OG_CARDS_DEFAULT = false;'), 'single rollout switch exists');
    source = source.replace('const OG_CARDS_DEFAULT = false;', 'const OG_CARDS_DEFAULT = true;');
  }
  return new Function('meta', 'Astro', 'safeSrc', source + '\nreturn { shareImage, ogCardPolicy };')(
    meta, { site: new URL('https://example.test/'), url: new URL('https://example.test/sample/') }, safeSrc);
}
for (const defaultOn of [false, true]) {
  for (const [label, option, policy] of [
    ['absent', undefined, defaultOn ? 'optional' : ''], ['true', 'true', 'strict'], ['false', 'false', ''],
  ]) test(`${label}, default ${defaultOn}: policy and generated image`, () => {
    assert.deepEqual(resolve(option === undefined ? {} : { 'og-cards': option }, defaultOn), {
      shareImage: policy ? 'https://example.test/og/sample.png' : '', ogCardPolicy: policy,
    });
  });
}
test('authored images never opt into generated-card policy', () => {
  for (const key of ['image', 'share-image', 'og-image']) {
    assert.deepEqual(resolve({ [key]: '/cover.jpg' }, true), {
      shareImage: 'https://example.test/cover.jpg', ogCardPolicy: '',
    });
  }
});
test('layout publishes the resolved policy exactly once', () => {
  assert.deepEqual(layout.match(/<meta name="sitetile:og-card"[^>]*>/g), [
    '<meta name="sitetile:og-card" content={ogCardPolicy} />',
  ]);
  assert.ok(layout.includes('{ogCardPolicy && <meta name="sitetile:og-card"'));
});

function fixture(policy, title, image = 'https://example.test/og/sample.png') {
  return `<head><meta name="sitetile:og-card" content="${policy}"><meta property="og:image" content="${image}"><meta name="twitter:image" content="${image}"><meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="${title}"><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Article', image }, { '@type': 'Organization', image: 'https://example.test/logo.png' }] })}</script></head>`;
}
function run(meta, defaultOn, rendererMode = 'render') {
  const dir = mkdtempSync(join(tmpdir(), 'sitetile-card-policy-'));
  try {
    const { shareImage, ogCardPolicy } = resolve(meta, defaultOn);
    const broken = shareImage ? fixture(ogCardPolicy, 'Broken', shareImage) : '<head></head>';
    writeFileSync(join(dir, 'broken.html'), broken);
    writeFileSync(join(dir, 'healthy.html'), ogCardPolicy ? fixture(ogCardPolicy, 'Healthy', 'https://example.test/og/healthy.png') : '<head></head>');
    writeFileSync(join(dir, 'authored.html'), fixture('', 'Broken', 'https://example.test/cover.jpg'));
    const original = new URL('./og/og-card.mjs?original', import.meta.url).href;
    const dep = join(dir, 'dependency.cjs');
    writeFileSync(dep, 'module.exports = function () {}; module.exports.Resvg = class {};');
    const preload = join(dir, 'loader.mjs');
    const rendererStub = `
export { ourCardPath, deadCards } from '${original}';
export function makeCardRenderer() {
  if (${JSON.stringify(rendererMode)} === 'init') throw new Error('fixture font unavailable');
  return async ({ title }) => {
    if (title === 'Broken') throw new Error('fixture render failure');
    return Buffer.from('fixture image');
  };
}`;
    const hook = `export async function load(url, context, next) {
  if (url.endsWith('/og/og-card.mjs')) return {
    format: 'module', shortCircuit: true, source: ${JSON.stringify(rendererStub)}
  };
  return next(url, context);
}`;
    writeFileSync(preload, `import Module, { register } from 'node:module';
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (s, ...args) {
  if (s === 'satori' || s === '@resvg/resvg-js') {
    if (${JSON.stringify(rendererMode)} === 'import') throw new Error('fixture dependency unavailable');
    return ${JSON.stringify(dep)};
  }
  return originalResolve.call(this, s, ...args);
};
register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(hook))}, import.meta.url);`);
    const result = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./og/build-og.mjs', import.meta.url)), dir], { encoding: 'utf8' });
    return { ...result, broken: readFileSync(join(dir, 'broken.html'), 'utf8'),
      healthy: readFileSync(join(dir, 'healthy.html'), 'utf8'), authored: readFileSync(join(dir, 'authored.html'), 'utf8'),
      healthyCard: existsSync(join(dir, 'og/healthy.png')), before: broken };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('explicit true keeps render failures fatal', () => {
  const result = run({ 'og-cards': 'true' }, false);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /fixture render failure/);
});
for (const mode of ['render', 'init', 'import']) {
  test(`absent with default on degrades ${mode} failures`, () => {
    const result = run({}, true, mode);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.broken, /(?:property="og:image"|name="twitter:image")/);
    assert.doesNotMatch(result.broken, /https:\/\/example.test\/og\/sample.png/);
    assert.match(result.broken, /name="twitter:card" content="summary"/);
    assert.match(result.broken, /https:\/\/example.test\/logo.png/);
    assert.match(result.stderr, new RegExp('broken\\.html.*fixture '));
    assert.match(result.authored, /https:\/\/example.test\/cover.jpg/);
    if (mode === 'render') {
      assert.equal(result.healthyCard, true);
      assert.match(result.healthy, /property="og:image"/);
    }
  });
}

for (const [name, meta, defaultOn] of [
  ['absent with default off', {}, false], ['false with default off', { 'og-cards': 'false' }, false],
  ['false with default on', { 'og-cards': 'false' }, true],
]) test(`${name} never starts rendering`, () => {
  const result = run(meta, defaultOn);
  assert.deepEqual({ status: result.status, stdout: result.stdout, stderr: result.stderr, healthyCard: result.healthyCard },
    { status: 0, stdout: '▸ og cards: none requested\n', stderr: '', healthyCard: false });
});
