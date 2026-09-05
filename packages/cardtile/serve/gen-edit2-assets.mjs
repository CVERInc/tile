// Bundle cardtile-w2 — the Card sandbox with the tugtile board as its editing table — into an
// importable ES module, so the edge Worker can serve `card.feelreef.com/try/edit` (the official
// path since the 2026-09-06 "換上正式路徑" ruling; the module and this generator kept the `edit2`
// name they were built under) without touching a filesystem (Workers can't).
//
//   node packages/cardtile/serve/gen-edit2-assets.mjs
//
// Read the real files, bundle what needs bundling, write ONE generated module the Worker imports.
// The generated file is committed — Workers deploy from source, not from a build step.
//
// ── WHAT IT CARRIES, AND WHERE FROM ─────────────────────────────────────────────────────────────
//
// Half of what `/try/edit` serves is not ours. The ENGINE's browser tugtile (a git submodule at
// engine/, pinned by commit) is copied in here VERBATIM and served unmodified, because the whole
// point of the surface is that the editing table is the engine's, not an imitation of it:
//
//   engine/hosts/web/tugtile/index.html         the board host — its own DOM, its own handlers
//   engine/hosts/web/tugtile/tugtile.css        the real stylesheet (that host's build.sh copies it
//                                               from the engine's own styles.css, verbatim)
//   engine/hosts/web/tugtile/icons.js           authentic Lucide bodies
//   engine/hosts/web/tugtile/obsidian-shim.js   lets the Obsidian-flavoured editor engine run
//   engine/hosts/web/tugtile/host.js            the web host adapter
//   engine/hosts/web/tugtile/vendor/editor-core.js   the shared tile-family editor (modaltile)
//   engine/hosts/web/tugtile/Sortable.min.js    the same drag engine
//   engine/hosts/web/tugtile/i18n/*.json        the same locale JSON (FOUR locales — see below)
//
// 🔴 AND ONE FILE THE ENGINE'S HOST DOES NOT SHIP. `hosts/web/tugtile/index.html` imports
// `./board-core.js`, and there is no such file in that directory — `scripts/build-board-core.sh`
// writes the model to `packages/tugtile/board-core.js`, and `hosts/web/tugtile/build.sh` copies
// tugtile.css, Sortable, the i18n JSON and editor-core across but never that one. So the engine's
// own web host cannot run from a clean checkout of the engine. We take it from the one place it
// does exist (packages/tugtile/board-core.js — the same module cardtile's own card-core imports)
// and serve it at the path the host asks for. The fix belongs upstream; see
// ~/Developer/reef-lanes/card-tugtile-engine.patch.
import esbuild from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sourceStamp } from './edit2-sources.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const W2 = join(DIR, '../w2');
// 🔴 This repo's own root. Until 2026-09-07 cardtile lived in the private incubator and this
// walked INTO the engine submodule; the two are the same tree now, so the reach is one level
// shorter and — more to the point — can no longer be broken by how somebody checked us out.
const ENGINE = join(DIR, '../../..');
const TUG = join(ENGINE, 'hosts/web/tugtile');

const readEngine = (rel, from = TUG) => {
  const p = join(from, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`gen-edit2-assets: the engine submodule is missing ${p.replace(process.env.HOME, '~')} — run: git submodule update --init`);
  }
  return fs.readFileSync(p, 'utf8');
};

// edit2.mjs exports `boot`, not a global — bundle to an IIFE that hangs it off `window`, so the
// served page can call it with a plain <script> (no module resolution on an edge Worker's response).
const bundled = await esbuild.build({
  stdin: {
    contents: `import { boot } from '../w2/edit2.mjs'; window.__cardtileW2Boot = boot;`,
    resolveDir: DIR,
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
if (bundled.errors?.length) {
  throw new Error('gen-edit2-assets: bundle failed:\n' + bundled.errors.map((e) => e.text).join('\n'));
}
const EDIT2_JS = bundled.outputFiles[0].text;

// the two stylesheets this page links: the shared cardtile-w chrome, then w2's own layer
const EDIT2_CSS = fs.readFileSync(join(DIR, '../w/editor.css'), 'utf8')
  + '\n' + fs.readFileSync(join(W2, 'edit2.css'), 'utf8');

// The served page's markup, MINUS the two things that only make sense loaded from disk: the two
// stylesheet <link>s (inlined instead) and the `<script type="module">` tail (replaced with a plain
// <script>, since EDIT2_JS is already an IIFE). Everything else — every id the JS wires up to — is
// index.html's own markup, unedited, so the sandbox and a locally-served copy can never drift.
const RAW_HTML = fs.readFileSync(join(W2, 'index.html'), 'utf8');
const bodyStart = RAW_HTML.indexOf('<body>');
const scriptStart = RAW_HTML.indexOf('<script type="module">');
if (bodyStart < 0 || scriptStart < 0) {
  throw new Error('gen-edit2-assets: w2/index.html shape changed — <body> or the module <script> not found');
}
const BODY = RAW_HTML.slice(bodyStart + '<body>'.length, scriptStart);

// ── the engine's own table, verbatim ─────────────────────────────────────────────────────────────
const TABLE = {
  'index.html': readEngine('index.html'),
  'tugtile.css': readEngine('tugtile.css'),
  'icons.js': readEngine('icons.js'),
  'obsidian-shim.js': readEngine('obsidian-shim.js'),
  'host.js': readEngine('host.js'),
  'vendor/editor-core.js': readEngine('vendor/editor-core.js'),
  'Sortable.min.js': readEngine('Sortable.min.js'),
  // 🔴 from packages/, not from hosts/web/tugtile/ — see the header note.
  'board-core.js': readEngine('packages/tugtile/board-core.js', ENGINE),
};
// 🔴 A GUARD, not a comment. If a future engine bump changes the host's entry point or drops one of
// these imports, `/try/edit` would serve a board that silently never loads — the parent would wait
// out its ten-second poll and show a sheet with no table behind it. Assert the contract here, where
// it is cheap, rather than discovering it in a browser.
for (const [needle, why] of [
  ['window.__load', 'the host no longer publishes __load — the table cannot be handed a card'],
  ['window.__ready', 'the host no longer publishes __ready — the parent cannot tell when to load'],
  ["from './board-core.js'", 'the host no longer imports ./board-core.js — check what replaced it'],
  ['tugtile__add-btn', 'the add-tile button changed class — 「＋加一張牌」 would stop being reachable'],
  ['data-tid', 'the host no longer stamps data-tid — the order could not be read back'],
]) {
  if (!TABLE['index.html'].includes(needle)) throw new Error(`gen-edit2-assets: ${why} (looked for ${needle})`);
}

const ENGINE_I18N = Object.fromEntries(
  fs.readdirSync(join(TUG, 'i18n')).filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readEngine(`i18n/${f}`))]),
);
if (!Object.keys(ENGINE_I18N).length) throw new Error('gen-edit2-assets: the engine ships no i18n JSON');

const out = `// GENERATED by gen-edit2-assets.mjs — do not edit. cardtile-w2 bundled for the edge Worker's
// public sandbox (card.feelreef.com/try/edit), together with the ENGINE's browser tugtile served
// verbatim as its editing table. See that file for what is and is not committed here.
export const EDIT2_BODY_HTML = ${JSON.stringify(BODY)};
export const EDIT2_CSS = ${JSON.stringify(EDIT2_CSS)};
export const EDIT2_JS = ${JSON.stringify(EDIT2_JS)};
/** the engine's web tugtile, file by file, exactly as the submodule ships it */
export const TABLE_FILES = ${JSON.stringify(TABLE)};
/** the engine's own locale JSON, parsed — four locales; board-i18n.mjs maps our nine onto them */
export const TABLE_I18N = ${JSON.stringify(ENGINE_I18N)};
/** a hash of the SOURCES this was built from — see edit2-sources.mjs, and the test that recomputes it */
export const SOURCE_STAMP = ${JSON.stringify(sourceStamp())};
`;
fs.writeFileSync(join(DIR, 'edit2-assets.mjs'), out);
console.log('wrote edit2-assets.mjs — body', BODY.length, '| css', EDIT2_CSS.length,
            '| edit2.js bundle', EDIT2_JS.length, '| table files',
            Object.entries(TABLE).map(([k, v]) => `${k}:${v.length}`).join(' '),
            '| i18n', Object.keys(ENGINE_I18N).join(','));
