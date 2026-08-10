// REEF with PWA — model tests (plain node, zero framework; the family discipline).
//   run: node --test packages/pwa/pwa-core.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest, manifestJson, hasPwa, PWA_ICON_FILES } from './pwa-core.mjs';

const META = {
  title: 'Lilac — The Long Way Home',
  brand: 'LILAC',
  description: 'A mafia BL romance.',
  'theme-color-dark': '#120d1c',
  'theme-color-light': '#b98fe0',
};

test('hasPwa: reads the packages list (string or array)', () => {
  assert.equal(hasPwa('lingo, pwa'), true);
  assert.equal(hasPwa(['lingo', 'pwa']), true);
  assert.equal(hasPwa('lingo'), false);
  assert.equal(hasPwa(''), false);
});

test('buildManifest: core fields from frontmatter', () => {
  const mf = buildManifest(META);
  assert.equal(mf.name, 'Lilac — The Long Way Home');
  assert.equal(mf.short_name, 'LILAC');
  assert.equal(mf.display, 'standalone');
  assert.equal(mf.start_url, '/');
  assert.equal(mf.theme_color, '#120d1c', 'prefers dark theme-color');
  assert.equal(mf.background_color, '#120d1c');
});

test('buildManifest: three icons incl. a maskable one', () => {
  const mf = buildManifest(META);
  assert.equal(mf.icons.length, 3);
  assert.ok(mf.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'), 'has maskable 512');
  assert.ok(mf.icons.every((i) => i.type === 'image/png' && i.src.startsWith('/icon-')));
});

test('buildManifest: strips quotes; falls back when theme-color absent', () => {
  assert.equal(buildManifest({ 'theme-color-dark': '"#abcdef"' }).theme_color, '#abcdef');
  assert.equal(buildManifest({}).theme_color, '#000000');
  assert.equal(buildManifest({ brand: 'X' }).name, 'X', 'name falls back to brand');
});

test('manifestJson: valid JSON, no undefined keys leak', () => {
  const obj = JSON.parse(manifestJson({ brand: 'X' }));   // no description → key omitted
  assert.equal('description' in obj, false);
  assert.equal(obj.short_name, 'X');
});

test('PWA_ICON_FILES: the convention gen-icons.sh emits', () => {
  assert.ok(PWA_ICON_FILES.includes('icon-maskable-512.png'));
  assert.ok(PWA_ICON_FILES.includes('apple-touch-icon.png'));
  assert.ok(PWA_ICON_FILES.includes('favicon.png'));
});
