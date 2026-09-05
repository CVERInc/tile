#!/usr/bin/env node
// Coral build — the single producer of every distributable coral client.
//   node packages/dynamic-corals/build.mjs            build all corals
//   node packages/dynamic-corals/build.mjs events     build one
//
//   --registry <dir>   the registry ROOT — the directory holding manifest.json and versions/
//                      (default: ./registry, which in this repo is scratch; see .gitignore)
//   --defaults <file>  a deployment's own values for the `coral-default:` markers (see below)
//
// 🔴 WHY THOSE TWO FLAGS EXIST. The corals' SOURCE is public and generic and lives here; the
// registry it publishes into, and the hostnames a particular deployment's embeds fall back to,
// are that deployment's — private data and private config, in the repo that owns the deploy.
// Both used to be baked in: the registry as a relative path, the hostname as a literal in
// square-shop.js. Neither can be committed to a public MIT repo, and neither is a fact about
// the coral. So they arrive from the caller, and this file stays the single producer.
//
// Produces, per coral:
//   1. <coral>/<coral>.js                      — the bundled artifact at its historical path
//      (kept as the build output landing spot; nothing serves it — distribution is the registry)
//   2. <registry>/versions/<coral>/<version>/<coral>.js — the IMMUTABLE registry artifact.
//      🔴 Refuses to overwrite an existing version dir: a published version never changes,
//      that is the whole point. Ship a fix = bump package.json and build again.
//   3. (RETIRED 2026-07-17) the astro public/dynamic-corals sync. A fleet-wide audit found ZERO
//      sites referencing the same-origin /dynamic-corals/ path — two customer sites ride the
//      registry, the rest embed no corals at all. An unreferenced serving path is the
//      "de-facto unnamed version" problem wearing a new hat, so the registry is now the ONLY
//      distribution channel. A future site wanting same-origin vendoring should copy a PINNED
//      registry artifact into its own assets (the freeze-tier recipe), not lean on a shared dir.
//
// Every artifact is stamped with `/*! coral <name>@<version> +<commit> */` and registers
// itself on window.__coralVersions — "which version is this site running" becomes one look
// at the console or the file header instead of an md5 hunt across three copies (2026-07-16).
// That registration is GUARDED by `typeof window !== 'undefined'` (2026-08-29), so an artifact
// stays importable wherever its source is — see the 🩸 on `reg` below and build-stamp.test.mjs.
//
// events is BUNDLED from events-client.mjs (imports the node-tested core; esbuild IIFE,
// tree-shakes the render half). square-shop is hand-written self-contained — stamp only.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCoralManifest } from './manifest-schema.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// 🩸 Was a single hardcoded `../sitetile/astro/node_modules/.bin/esbuild`. That resolved when this
// repo still held the astro install; after the graduation it lives in CVERInc/tile, and build.mjs
// has been unable to run here since — `spawnSync … ENOENT`, on the only path that can publish a fix
// to a coral. Nothing said so, because nothing runs this in the suite.
//
// 🔴 It THROWS when it finds none rather than falling back to whatever `esbuild` is on PATH: a
// bundler you did not choose is how two machines start shipping different bytes for the same coral.
const ESBUILD = (() => {
  // 🩸 This list was written when these corals lived in the private incubator, and every entry in it
  // was a walk out of that repo into a neighbour — which is why it broke the day sitetile graduated
  // and stayed broken, silently, on the only path that can publish a fix to a coral.
  //
  // 🔴 The first candidate is now a SIBLING PACKAGE in this same repo, so the common case needs no
  // neighbour on disk at all. The rest are kept for the layouts that really exist: an incubator
  // checkout with this repo as a submodule, and a plain `npm install` at either root.
  const tried = [
    process.env.ESBUILD,
    join(ROOT, '../sitetile/astro/node_modules/.bin/esbuild'),   // this repo, after `npm i` there
    join(ROOT, '../../node_modules/.bin/esbuild'),               // this repo's own root install
    join(ROOT, '../../../node_modules/.bin/esbuild'),            // the parent checkout's, when this repo is a submodule
  ].filter(Boolean);
  const hit = tried.find((p) => existsSync(p));
  if (!hit) {
    throw new Error('no esbuild found. Tried:\n  ' + tried.join('\n  ')
      + '\nSet ESBUILD=<path> — the corals must be bundled by a known one, not by whatever is on PATH.');
  }
  return hit;
})();
// ── the caller's two inputs ──────────────────────────────────────────────────────────────────
// 🔴 Parsed by NAME, not by position: `only` used to be `process.argv[2]`, which with a flag in
// front of it would have read "--defaults" as a coral name and silently built nothing at all.
const flag = (name) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return '';
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) {
    throw new Error(`--${name} needs a value`);
  }
  return v;
};
const positional = (() => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { i++; continue; }   // skip the flag AND its value
    return args[i];
  }
  return '';
})();

// 🔴 The registry ROOT, not its versions/ subdirectory — ONE name for one thing. The tests that
// read the channel table (sponsor/sponsor-registry.test.mjs) need manifest.json AND versions/,
// and two env vars a letter apart, one meaning the root and one meaning a child of it, is a
// configuration mistake nobody would ever see: both resolve, and only one is right.
const REGISTRY_ROOT = flag('registry') || process.env.CORAL_REGISTRY || join(ROOT, 'registry');
const REGISTRY = join(REGISTRY_ROOT, 'versions');

/**
 * A deployment's own values for the placeholders a coral's source deliberately does not name.
 *
 * Shape: `{ "<coral>": { "<marker key>": "<value>" } }`. A source line carrying
 * `/*coral-default:<key>* /` has its empty string literal replaced by the value, and the marker
 * comment removed — so the substituted line is byte-identical to the hand-written literal it
 * replaced. That identity is not decoration: the immutability check further down compares a
 * rebuild against the published artifact, so a substitution that produced different bytes would
 * demand a version bump for a coral nobody edited, on the very first build after this landed.
 */
const DEFAULTS = (() => {
  const path = flag('defaults');
  if (!path) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--defaults ${path} must be an object of { coral: { key: value } }`);
  }
  return parsed;
})();

const MARKER = /\/\*coral-default:([A-Za-z0-9_]+)\*\//;

/**
 * Substitute `DEFAULTS` into `text`, and report every marker left unanswered.
 *
 * 🔴 Unanswered is REPORTED, not thrown, because the two callers want different things from it.
 * Building the engine on its own with no deployment in sight is legitimate and should leave the
 * neutral value in place; WRITING A NEW REGISTRY VERSION with one still empty is not, and is
 * refused at the write site below. A publish that shipped the neutral default would break every
 * embed that relies on the fallback and would look exactly like a successful build.
 */
function applyDefaults(text, coral) {
  const unfilled = [];
  const lines = text.split('\n').map((line) => {
    const m = MARKER.exec(line);
    if (!m) return line;
    const key = m[1];
    const value = DEFAULTS && DEFAULTS[coral] ? DEFAULTS[coral][key] : undefined;
    if (value === undefined) { unfilled.push(key); return line; }
    if (typeof value !== 'string' || value.includes("'") || value.includes('\\')) {
      throw new Error(`--defaults ${coral}.${key} must be a plain string with no quote or backslash, got ${JSON.stringify(value)}`);
    }
    // 🔴 The marker comment goes with it. What is left has to be the literal a human would have
    // typed, or the rebuild-vs-published comparison stops being an equality.
    const filled = line.replace(/''/, `'${value}'`).replace(MARKER, '').replace(/\s+$/, '');
    if (filled === line) throw new Error(`${coral}: the ${key} marker's line has no '' to fill: ${line.trim()}`);
    return filled;
  });
  return { text: lines.join('\n'), unfilled };
}

const CORALS = {
  'events': { src: 'events-client.mjs', bundle: true },
  'square-shop': { src: 'square-shop.js', bundle: false },
  // Self-contained by design, not by accident: a dynamic coral must install
  // byte-for-byte into feelreef's own pages or a sitetile static build, so it
  // has no imports to bundle. Stamp only.
  'inbox-bubble': { src: 'inbox-bubble.js', bundle: false },
  'qr': { src: 'qr-client.mjs', bundle: true },
  'drawer': { src: 'drawer-client.mjs', bundle: true },
  // Same split as events: the client is four lines of mounting and imports the node-tested core,
  // so the logic that decides what an amount is has exactly one home.
  'sponsor': { src: 'sponsor-client.mjs', bundle: true },
};

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
const only = positional;

for (const [name, cfg] of Object.entries(CORALS)) {
  if (only && only !== name) continue;
  const dir = join(ROOT, name);
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const outName = `${name === 'events' ? 'events' : name}.js`;

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`✗ ${name}@${version} has no manifest.json — every published version requires one.`);
    process.exit(1);
  }
  let sourceManifest;
  try {
    sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`✗ ${name}@${version} manifest.json is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  // package.json owns the release version; the immutable registry copy records that version.
  const coralManifest = { ...sourceManifest, version };
  const manifestResult = validateCoralManifest(coralManifest, { name, version });
  if (!manifestResult.ok) {
    if (manifestResult.missing.length) {
      console.error(`✗ ${name}@${version} manifest.json is missing: ${manifestResult.missing.join(', ')}`);
    }
    if (manifestResult.mismatches.length) {
      console.error(`✗ ${name}@${version} manifest identity mismatch: ${manifestResult.mismatches.join('; ')}`);
    }
    process.exit(1);
  }

  let body;
  if (cfg.bundle) {
    // 🔴 RUN IT FROM THE CORAL'S OWN DIRECTORY, with a bare filename. esbuild writes the input path
    // into the bundle as a comment, RELATIVE TO CWD — so the same source built from here and from
    // one directory up produced different bytes, and the published artifacts turn out to have been
    // built from inside the coral dir. A build whose output depends on where you were standing is a
    // build two people cannot agree on, and the registry's immutability check would call that a
    // content change and demand a version bump for a file nobody edited.
    body = execFileSync(ESBUILD, [cfg.src, '--bundle', '--format=iife'],
      { cwd: dir, maxBuffer: 8e6 }).toString();
  } else {
    body = readFileSync(join(dir, cfg.src), 'utf8');
  }

  // The deployment's own values, after bundling so a marker inside an imported module is reached
  // too. `unfilled` is carried to the registry write, which is the only place it is fatal.
  const substituted = applyDefaults(body, name);
  body = substituted.text;
  const unfilled = substituted.unfilled;
  if (unfilled.length && !DEFAULTS) {
    console.log(`  ℹ ${name}: ${unfilled.join(', ')} left at the neutral default (no --defaults given)`);
  }

  const stamp = `/*! coral ${name}@${version} +${commit} — generated by dynamic-corals/build.mjs, do not edit */\n`;
  // 🩸 UNGUARDED until 2026-08-29, and being unguarded it quietly UNDID the coral's own guard.
  // square-shop.js wraps its self-mount tail in `typeof document !== 'undefined'` for exactly one
  // reason: so node can IMPORT the file and unit-test the ref/price/message logic instead of only
  // reaching it through a real page. This line then appended a bare `window.` reference AFTER that
  // guard — so every published artifact threw `ReferenceError: window is not defined` on a node
  // import while the source it was built from did not. Measured downstream, in reef: a test that
  // tried to probe the artifact failed, and it read like the ARTIFACT was broken.
  //
  // 🔴 The guard changes NOTHING in a browser: same key, same value, same object (`||{}` still
  // merges into an existing registry), and still the last statement in the file — so
  // `window.__coralVersions['<coral>']` is set at the same moment it always was. `typeof window`
  // rather than `window` because the whole point is a scope where the identifier does not exist.
  const reg = `\nif (typeof window !== 'undefined') (window.__coralVersions=window.__coralVersions||{})['${name}']='${version}';\n`;
  const artifact = stamp + body + reg;

  // 1. legacy-path distributable (events.js is now generated; square-shop.js stays its own source,
  //    so its stamped artifact must NOT overwrite the source file — registry + astro copies only)
  if (cfg.bundle) writeFileSync(join(dir, outName), artifact);

  // 2. immutable registry artifact
  const verDir = join(REGISTRY, name, version);
  const verFile = join(verDir, outName);
  if (existsSync(verFile)) {
    const prev = readFileSync(verFile, 'utf8');
    // 🩸 COMPARE THE CODE, NOT THE STAMP. The stamp carries `+<commit>`, so `prev !== artifact` was
    // true after ANY commit — it was reporting "you have committed since this was published", in the
    // words of "a published version is immutable, bump the version". Every coral tripped it on every
    // build, which is not a guard, it is a wall. Measured 2026-08-12: square-shop@0.10.9 was stamped
    // +bb9411c and qr@0.14.7 +c6ddabb against a HEAD of 04b82df, with identical code underneath.
    //
    // 🔴 And when the code DOES match, the stored file is left exactly as it is. A published artifact
    // must not change — not even its stamp. Rewriting it to say it was built somewhere else would be
    // editing history to record a build nobody consumed.
    //
    // 🔴 …AND NOT THE VERSION TRAILER EITHER — same wall, one line further down. `reg` above is
    // build.mjs's own stamp, not the coral: it is a pure function of the coral's NAME and the
    // VERSION this directory is named after, both already fixed by where the file sits. So the
    // moment build.mjs changes how it writes that line — as it did on 2026-08-29, wrapping it in
    // the `typeof window` guard — every published coral reports "the content differs" and demands
    // a version bump for a coral nobody edited. Measured: with the trailer inside the comparison,
    // all five corals that had been printing `= unchanged (already published)` flipped to exit 1.
    //
    // The pattern matches BOTH spellings on purpose. The artifacts already on disk carry the
    // unguarded one and they are immutable — none of them is rewritten, here or anywhere — so the
    // ruler has to read them as unchanged. The version inside it is pinned to THIS version rather
    // than `[^']*`: a stored trailer naming some other version is a real defect and must still
    // fall through to the error below.
    const v = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trailer = new RegExp(
      "\\n(?:if \\(typeof window !== 'undefined'\\) )?"
      + '\\(window\\.__coralVersions=window\\.__coralVersions\\|\\|\\{\\}\\)'
      + `\\['${name}'\\]='${v}';\\n$`);
    const code = (t) => t.split('\n').slice(1).join('\n').replace(trailer, '');
    if (code(prev) !== code(artifact)) {
      console.error(`✗ ${name}@${version} already published and the content differs — a published`);
      console.error(`  version is immutable. Bump the version in ${name}/package.json.`);
      process.exit(1);
    }
    console.log(`= ${name}@${version} unchanged (already published)`);
  } else {
    // 🔴 The one place an unanswered marker is fatal. Everything above tolerates it so the engine
    // builds on its own; a NEW published version carrying the neutral default would ship an artifact
    // whose fallback origin is the empty string, to every site that rides the channel, and the build
    // would print a cheerful `+`. Refuse here, where the damage would become immutable.
    if (unfilled.length) {
      console.error(`✗ ${name}@${version} would be published with ${unfilled.join(', ')} unsubstituted.`);
      console.error(`  Pass --defaults <file> with { "${name}": { "${unfilled[0]}": "…" } } — see this file's header.`);
      process.exit(1);
    }
    mkdirSync(verDir, { recursive: true });
    writeFileSync(verFile, artifact);
    console.log(`+ ${name}@${version} → ${join(REGISTRY, name, version, outName)}`);
  }

  // The manifest is part of the immutable version, whether the bundle was just created or was
  // already present from a build predating manifests.
  const versionManifestPath = join(verDir, 'manifest.json');
  const manifestBody = JSON.stringify(coralManifest, null, 2) + '\n';
  if (existsSync(versionManifestPath)) {
    if (readFileSync(versionManifestPath, 'utf8') !== manifestBody) {
      console.error(`✗ ${name}@${version} manifest differs from the immutable registry copy — bump the version.`);
      process.exit(1);
    }
  } else {
    writeFileSync(versionManifestPath, manifestBody);
    console.log(`+ ${name}@${version} manifest.json`);
  }

}
console.log('done.');
