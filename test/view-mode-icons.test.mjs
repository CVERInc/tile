// The three view modes wear one icon family: square-m (Seasoned), square-pilcrow (Rendered),
// square-code (Plain). tile#292.
//
// Two halves, because the name and the drawing live in different places:
//   · the NAME is in EDITOR_MODES (packages/core/editor-core.js, emitted to dist/editor-core.js);
//   · the DRAWING is in whichever icon set the host hands the core as `setIcon`. Obsidian ships
//     lucide itself; every other host (the web hosts, marktile for macOS via sync-engine.sh, the Card
//     editor's bundle) draws from an obsidian-shim.js ICONS map that is a hand-kept subset of lucide.
//     A name missing from that map is not an error anywhere: `setIcon` writes an empty span and the
//     view-cycle button goes blank.
//
// So this pins the names on the real exported array, and runs each shim's own `setIcon` on each
// name — the question is "does it draw", not "does the file mention it".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED = { seasoned: 'square-m', rendered: 'square-pilcrow', plain: 'square-code' };

// Every icon set a non-Obsidian host draws the view-cycle button from. packages/core is the one
// marktile for macOS copies in (hosts/mac/scripts/sync-engine.sh) and the Card editor serves.
const SHIMS = [
  'packages/core/obsidian-shim.js',
  'hosts/web/tugtile/obsidian-shim.js',
  'hosts/web/pagetile/obsidian-shim.js',
  'hosts/web/modaltile/obsidian-shim.js',
];

// lucide's square-pilcrow, path data as published (lucide-static 1.23.0, icons/square-pilcrow.svg).
// Held here, independent of any shim, so a shim that drew SOMETHING under the name still has to
// draw this.
const PILCROW_PATHS = ['M12 12H9.5a2.5 2.5 0 0 1 0-5H17', 'M12 7v10', 'M16 7v10'];

function loadShim(rel) {
  const ctx = { HTMLElement: class {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return ctx;
}

function draw(shim, name) {
  const attrs = {};
  const el = { innerHTML: '', setAttribute: (k, v) => { attrs[k] = v; } };
  shim.setIcon(el, name);
  return el.innerHTML;
}

test('EDITOR_MODES: Seasoned, Rendered, Plain wear square-m, square-pilcrow, square-code', async () => {
  // dist/editor-core.js is the exported emit of packages/core/editor-core.js; scripts/test.sh
  // rebuilds it and fails on drift before any test runs. It needs these two globals to evaluate.
  globalThis.Modal ??= class {};
  globalThis.Menu ??= class {};
  const { EDITOR_MODES } = await import(join(ROOT, 'dist/editor-core.js'));
  assert.deepEqual(Object.fromEntries(EDITOR_MODES.map((m) => [m.key, m.icon])), EXPECTED);
});

for (const rel of SHIMS) {
  test(`${rel}: setIcon draws all three view-mode icons`, () => {
    const shim = loadShim(rel);
    for (const name of Object.values(EXPECTED)) {
      const svg = draw(shim, name);
      assert.match(svg, /^<svg[^>]*>.*<\/svg>$/s, `${name} draws nothing in ${rel}`);
      assert.match(svg, /<(path|rect|polyline|line|circle)\b/, `${name} draws an empty <svg> in ${rel}`);
    }
    const pilcrow = draw(shim, 'square-pilcrow');
    for (const d of PILCROW_PATHS) assert.ok(pilcrow.includes(`d="${d}"`), `square-pilcrow in ${rel} is not lucide's (missing ${d})`);
  });
}

test('CONTROL: an icon name no shim carries draws nothing, so the checks above can fail', () => {
  const shim = loadShim(SHIMS[0]);
  assert.equal(draw(shim, 'no-such-icon'), '');
});
