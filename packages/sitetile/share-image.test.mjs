// Evaluate the production metadata resolver without an Astro build, as post-share-meta does.
// The no-card case also runs the real build-og CLI against synthetic HTML.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSite, safeSrc } from './site-core.js';

const layout = readFileSync(new URL('./astro/src/layouts/SiteLayout.astro', import.meta.url), 'utf8');
const start = layout.indexOf('const absUrl =');
const end = layout.indexOf('// `favicon:` (falling back', start);
if (start < 0 || end <= start) throw new Error('Social metadata resolver anchors are missing');
const resolve = new Function('meta', 'Astro', 'safeSrc', layout.slice(start, end) + '\nreturn shareImage;');
const site = new URL('https://example.test/base/');
const url = new URL('https://example.test/about/');

const rasterImageCases = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].flatMap(ext =>
  [ext, `${ext.toUpperCase()}?size=large&format=svg`].map(suffix => [
    `ordinary image accepts ${suffix}`,
    `image: /cover.${suffix}\nog-cards: true`,
    `https://example.test/cover.${suffix}`,
  ]));
const unsupportedImages = ['/cover.svg', '/cover.mp4', '/cover.pdf', '/cover', '/cover.svg?format=jpg'];
const unsupportedImageCases = unsupportedImages.flatMap(image =>
  ['', '\nog-cards: false', '\nog-cards: true'].map(option => [
    `ordinary image skips ${image} with ${option.trim() || 'no card option'}`,
    `image: ${image}${option}`,
    option.endsWith('true') ? 'https://example.test/og/about.png' : '',
  ]));
const explicitImageCases = ['share-image', 'og-image'].flatMap(key =>
  unsupportedImages.map(image => [
    `${key} preserves ${image}`,
    `${key}: ${image}\nimage: /cover.jpg\nog-cards: true`,
    `https://example.test${image}`,
  ]));

for (const [name, frontmatter, expected, origin = site] of [
  ...rasterImageCases,
  ...unsupportedImageCases,
  ...explicitImageCases,
  ['unsafe raster-looking image is omitted', 'image: javascript:cover.jpg', ''],
  ['unsafe raster-looking image allows generated cards', 'image: javascript:cover.jpg\nog-cards: true', 'https://example.test/og/about.png'],
  ['root-relative page image works without og-cards', 'image: /cover.jpg', 'https://example.test/cover.jpg'],
  ['relative page image resolves against Astro.site', 'image: cover.jpg', 'https://example.test/base/cover.jpg'],
  ['absolute page image keeps its origin', 'image: https://images.example.test/cover.jpg', 'https://images.example.test/cover.jpg'],
  ['page image works with og-cards explicitly disabled', 'image: /cover.jpg\nog-cards: false', 'https://example.test/cover.jpg'],
  ['page image wins over generated cards', 'image: /cover.jpg\nog-cards: true', 'https://example.test/cover.jpg'],
  ['share-image wins over og-image and image', 'share-image: /share.jpg\nog-image: /og.jpg\nimage: /cover.jpg\nog-cards: true', 'https://example.test/share.jpg'],
  ['og-image wins over image', 'og-image: /og.jpg\nimage: /cover.jpg\nog-cards: true', 'https://example.test/og.jpg'],
  ['unsafe page image is omitted', 'image: javascript:alert(1)', ''],
  ['unsafe page image can fall back to a generated card', 'image: javascript:alert(1)\nog-cards: true', 'https://example.test/og/about.png'],
  ['unsafe explicit override remains gated', 'share-image: javascript:alert(1)\nimage: /cover.jpg', ''],
  ['missing image still allows generated cards', 'og-cards: true', 'https://example.test/og/about.png'],
  ['missing image without generated cards stays empty', 'title: About', ''],
  ['without Astro.site the authored path is preserved', 'image: /cover.jpg', '/cover.jpg', null],
]) {
  test(name, () => {
    const { meta } = parseSite(`---\nsitetile-page: about\n${frontmatter}\n---\n\n## About\nA sample page.`);
    assert.equal(resolve(meta, { site: origin, url }, safeSrc), expected);
  });
}

for (const [attribute, tag] of [['property', 'og:image'], ['name', 'twitter:image']]) {
  test(`${tag} consumes the resolved image exactly once`, () => {
    const tags = layout.match(new RegExp(`<meta ${attribute}="${tag}"[^>]*>`, 'g')) || [];
    assert.deepEqual(tags, [`<meta ${attribute}="${tag}" content={shareImage} />`]);
  });
}

test('no requested cards reports no unsupported option state', () => {
  const dist = mkdtempSync(join(tmpdir(), 'sitetile-share-image-'));
  try {
    writeFileSync(join(dist, 'index.html'), '<meta property="og:image" content="https://example.test/cover.jpg">');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./og/build-og.mjs', import.meta.url)), dist], { encoding: 'utf8' });
    assert.deepEqual({ status: result.status, stdout: result.stdout, stderr: result.stderr },
      { status: 0, stdout: '▸ og cards: none requested\n', stderr: '' });
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
