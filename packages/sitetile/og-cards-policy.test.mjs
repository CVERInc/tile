// Offline policy and CLI integration tests; image rasterization is replaced at the module boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { parseSite, safeSrc } from './site-core.js';
import { cardKey, stampCard } from './og/og-card.mjs';

// The stand-in renderer below returns this picture for every card, stamped with the key of the
// inputs it was asked for — a card is only ever kept for its key, so a stand-in that returned
// unstamped bytes would make every "already there" case below mean "never kept".
const STUB_RENDERER = 'ab'.repeat(32);
const TINY_PNG = (() => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
  };
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0]))), chunk('IEND', Buffer.alloc(0))]);
})();
const cardFor = (title) => stampCard(TINY_PNG, cardKey(STUB_RENDERER, { title }));

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
function run(meta, defaultOn, rendererMode = 'render', { existing = false, extraPages = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sitetile-card-policy-'));
  try {
    const { shareImage, ogCardPolicy } = resolve(meta, defaultOn);
    const broken = shareImage ? fixture(ogCardPolicy, 'Broken', shareImage) : '<head></head>';
    writeFileSync(join(dir, 'broken.html'), broken);
    writeFileSync(join(dir, 'healthy.html'), ogCardPolicy ? fixture(ogCardPolicy, 'Healthy', 'https://example.test/og/healthy.png') : '<head></head>');
    writeFileSync(join(dir, 'authored.html'), fixture('', 'Broken', 'https://example.test/cover.jpg'));
    for (let i = 1; i <= extraPages; i++) {
      writeFileSync(join(dir, `extra-${i}.html`), fixture(ogCardPolicy, 'Broken', `https://example.test/og/extra-${i}.png`));
    }
    // 'current': the card each page would get now. 'unkeyed': a file that is merely THERE.
    if (existing) {
      mkdirSync(join(dir, 'og'));
      for (const [name, title] of [['sample', 'Broken'], ['healthy', 'Healthy']]) {
        writeFileSync(join(dir, `og/${name}.png`), existing === 'unkeyed' ? 'existing card' : cardFor(title));
      }
    }
    const original = new URL('./og/og-card.mjs?original', import.meta.url).href;
    const dep = join(dir, 'dependency.cjs');
    writeFileSync(dep, rendererMode === 'import' ? "throw new Error('fixture dependency unavailable');"
      : 'module.exports = function () {}; module.exports.Resvg = class {};');
    const preload = join(dir, 'loader.mjs');
    const rendererStub = `
import { cardKey, stampCard } from '${original}';
export * from '${original}';
export function makeCardRenderer() {
  if (${JSON.stringify(rendererMode)} === 'init') throw new Error('fixture font unavailable');
  const keyFor = (raw) => cardKey(${JSON.stringify(STUB_RENDERER)}, raw);
  const render = async (raw) => {
    if (${JSON.stringify(rendererMode)} === 'mixed' && raw.title === 'Healthy') throw new Error('fixture other failure');
    if (raw.title === 'Broken' && ${JSON.stringify(rendererMode)} !== 'success') throw new Error('fixture render failure');
    return stampCard(Buffer.from(${JSON.stringify(TINY_PNG.toString('base64'))}, 'base64'), keyFor(raw));
  };
  render.keyFor = keyFor;
  return render;
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
    if (${JSON.stringify(rendererMode)} === 'missing') throw Object.assign(new Error('fixture dependency unavailable'), { code: 'MODULE_NOT_FOUND' });
    return ${JSON.stringify(dep)};
  }
  return originalResolve.call(this, s, ...args);
};
register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(hook))}, import.meta.url);`);
    const result = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./og/build-og.mjs', import.meta.url)), dir], { encoding: 'utf8' });
    return { ...result, broken: readFileSync(join(dir, 'broken.html'), 'utf8'),
      healthy: readFileSync(join(dir, 'healthy.html'), 'utf8'), authored: readFileSync(join(dir, 'authored.html'), 'utf8'),
      healthyCard: existsSync(join(dir, 'og/healthy.png')), brokenCard: existsSync(join(dir, 'og/sample.png')), before: broken };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('explicit true keeps render failures fatal', () => {
  const result = run({ 'og-cards': 'true' }, false);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /fixture render failure/);
});
for (const mode of ['render', 'init', 'import', 'missing']) {
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

for (const mode of ['init', 'import', 'missing']) {
  for (const existing of [false, 'current']) {
    test(`explicit true rejects ${mode} failure with ${existing ? 'existing' : 'missing'} cards`, () => {
      const result = run({ 'og-cards': 'true' }, false, mode, { existing });
      assert.equal(result.status, 1, 'strict setup failures remain fatal before checking cached cards');
      if (mode === 'init') {
        assert.match(result.stderr, /fixture font unavailable/, 'strict initialization exposes its original error');
      } else {
        assert.equal(result.stderr,
          `✗ og cards: 2 page(s) ask for a card but the renderer is not installed (${mode === 'missing' ? 'MODULE_NOT_FOUND' : 'import failed'}).\n`
          + '  Deploying now would ship that many meta tags pointing at 404s. Refusing.\n',
          'strict dependency failures preserve the original human-readable refusal');
      }
      assert.equal(result.broken, result.before, 'strict setup failure preserves metadata');
    });
  }
}

for (const mode of ['render', 'init', 'import']) {
  test(`optional ${mode} failures group repeated reasons and bound the page sample`, () => {
    const result = run({}, true, mode, { extraPages: 6 });
    assert.equal(result.status, 0, result.stderr);
    const count = mode === 'render' ? 7 : 8;
    const reason = { render: 'render failure', init: 'font unavailable', import: 'dependency unavailable' }[mode];
    assert.equal(result.stderr,
      `og cards: omitted ${count} page(s) [broken.html, extra-1.html, extra-2.html, extra-3.html, extra-4.html, ...]: fixture ${reason}\n`,
      'one diagnostic per reason reports the total and only the first five page paths');
  });
}

for (const existing of [false, 'current']) {
  test(`successful ${existing ? 'cached' : 'rendered'} cards preserve the summary verbatim`, () => {
    const result = run({ 'og-cards': 'true' }, false, 'success', { existing });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '', 'successful cards emit no degradation diagnostics');
    assert.equal(result.stdout.replace(/\(\d+ms\)/, '(TIMEms)'),
      `▸ og cards: ${existing ? '0 rendered, 2 unchanged' : '2 rendered'} (TIMEms) — all 2 og:image target(s) exist\n`,
      'summary bytes stay unchanged apart from elapsed time');
  });
}

test('optional cached cards survive missing dependencies without degradation', () => {
  const result = run({}, true, 'missing', { existing: 'current' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', 'cached optional cards need no renderer');
  assert.equal(result.broken, result.before, 'cached optional metadata survives');
});

// A file at the card's path is not a card for being there. These two are the controls for the two
// tests above: the same runs, with files that carry no key.
test('a file that is merely at the card path is redrawn, and the summary says so', () => {
  const result = run({ 'og-cards': 'true' }, false, 'success', { existing: 'unkeyed' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.replace(/\(\d+ms\)/, '(TIMEms)'),
    '▸ og cards: 2 rendered (2 in place of a card that no longer matches) (TIMEms) — all 2 og:image target(s) exist\n');
});
test('with no renderer, a file that is merely at the card path does not keep the page its image', () => {
  const result = run({}, true, 'missing', { existing: 'unkeyed' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /^og cards: omitted 2 page\(s\) \[broken\.html, healthy\.html\]: fixture dependency unavailable\n$/);
  assert.doesNotMatch(result.broken, /og:image|twitter:image/);
  assert.deepEqual([result.brokenCard, result.healthyCard], [false, false], 'and the unverifiable files do not ship');
});

for (const value of ['', 'null', '~', '""', "''"]) {
  for (const defaultOn of [false, true]) {
    test(`frontmatter og-cards: ${value || '(empty)'} stays explicitly off with default ${defaultOn}`, () => {
      const { meta } = parseSite(`---\nsitetile-page: sample\nog-cards: ${value}\n---\n\n## Sample\nSample content.`);
      assert.deepEqual(resolve(meta, defaultOn), { shareImage: '', ogCardPolicy: '' },
        'present empty or null-like frontmatter values never opt into the default');
    });
  }
}

test('optional failures keep different reasons in separate diagnostics', () => {
  const result = run({}, true, 'mixed', { extraPages: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr,
    'og cards: omitted 2 page(s) [broken.html, extra-1.html]: fixture render failure\n'
    + 'og cards: omitted 1 page(s) [healthy.html]: fixture other failure\n',
    'each reason has its own count and page sample');
});
