// build.mjs — the ARTIFACT it publishes must be importable wherever its SOURCE is.
//   run: node packages/dynamic-corals/build-stamp.test.mjs
//
// 🩸 Why this file exists. square-shop.js guards its self-mount tail with
// `typeof document !== 'undefined'` for exactly one reason: so node can import the module and
// unit-test the ref/price/message logic instead of only reaching it through a real page. build.mjs
// then appended an UNGUARDED `(window.__coralVersions=…)['square-shop']='…'` after that guard — so
// every published artifact threw `ReferenceError: window is not defined` on a node import while the
// source it was built from did not. Nothing in this repo noticed, because nothing here had ever
// imported an artifact; it was found downstream in reef, by a test that read like the ARTIFACT was
// broken rather than like the builder was.
//
// 🔴 So the assertion is made on a file this test BUILT, not on one already in registry/versions.
// Published versions are immutable and every one of them carries the unguarded trailer; asserting
// against them would either be asserting the bug or demanding history be rewritten. build.mjs
// derives every path from its own location, so a copy of it in a scratch directory publishes into
// a scratch registry and the real one is never touched.
//
// 🔴 And the browser half is not asserted by matching text. The claim being made about the guard is
// that it changes NOTHING in a browser — same key, same value, same object — so the line is
// actually EXECUTED, in a context that has a window and in one that does not.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const CORAL = 'square-shop';
const SRC = join(HERE, CORAL, 'square-shop.js');
// A version no coral will ever carry, so nothing here can collide with a real one even by accident.
const VERSION = '0.0.0-build-stamp-test';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

// out/ is gitignored, and it is INSIDE the repo on purpose: build.mjs runs `git rev-parse` from its
// own directory to stamp the commit, which has no answer from a scratch dir in /tmp.
mkdirSync(join(REPO, 'out'), { recursive: true });
const sandbox = mkdtempSync(join(REPO, 'out', 'build-stamp-'));

try {
	cpSync(join(HERE, 'build.mjs'), join(sandbox, 'build.mjs'));
	// The real packages/dynamic-corals/package.json, verbatim — it is what makes a `.js` artifact
	// resolve as ESM, so the sandbox has to mirror it or this test measures a different module system
	// than the registry does.
	cpSync(join(HERE, 'package.json'), join(sandbox, 'package.json'));
	mkdirSync(join(sandbox, CORAL), { recursive: true });
	cpSync(SRC, join(sandbox, CORAL, 'square-shop.js'));
	cpSync(join(HERE, CORAL, 'manifest.json'), join(sandbox, CORAL, 'manifest.json'));
	cpSync(join(HERE, 'manifest-schema.mjs'), join(sandbox, 'manifest-schema.mjs'));
	writeFileSync(join(sandbox, CORAL, 'package.json'), JSON.stringify(
		{ name: '@cver/coral-square-shop', version: VERSION, private: true, type: 'module' }, null, 2) + '\n');

	// The deployment's own values for the `coral-default:` markers. A synthetic origin, because the
	// point being tested is that the substitution HAPPENS and is exact — not what any real
	// deployment's backend is called. That value does not live in this repo at all (see build.mjs).
	const DEFAULT_API_BASE = 'https://api.example';
	const defaultsPath = join(sandbox, 'coral-defaults.json');
	writeFileSync(defaultsPath, JSON.stringify({ [CORAL]: { apiBase: DEFAULT_API_BASE } }, null, 2) + '\n');

	// build.mjs resolves a bundler at LOAD time and throws when it finds none — deliberately, so two
	// machines cannot ship different bytes for one coral. square-shop is `bundle: false` (the build
	// only stamps it), so nothing here ever executes what this points at; it only has to exist.
	// Pointing it at node itself is what keeps this file green on a bare checkout with no
	// node_modules anywhere — see scripts/test-clean.sh.
	// 🩸 --registry EXPLICITLY, and CORAL_REGISTRY stripped from the child's environment. This test
	// used to rely on build.mjs deriving the registry from its own location, which is true and was
	// enough right up until a caller exported CORAL_REGISTRY — and then this test PUBLISHED
	// 0.0.0-build-stamp-test into a live registry directory. Measured 2026-09-07, on the first run
	// after the incubator's suite started handing the engine its real registry: the version landed
	// on disk beside twenty-four real ones, and the test then died looking for it in the sandbox.
	//
	// 🔴 A probe must not be able to write outside its own sandbox, and "it derives a safe default"
	// is not that guarantee — it is a default, and a default is the thing an environment overrides.
	// Both belts: the flag says where, and the env cannot say otherwise.
	const BUILD_ENV = { ...process.env, ESBUILD: process.execPath, CORAL_REGISTRY: '' };
	delete BUILD_ENV.CORAL_REGISTRY;
	const sandboxRegistry = join(sandbox, 'registry');
	execFileSync('node', [join(sandbox, 'build.mjs'), CORAL, '--registry', sandboxRegistry, '--defaults', defaultsPath],
		{ stdio: 'inherit', env: BUILD_ENV });

	// 🔴 And say so if it ever escapes anyway. The failure above was silent in the only way that
	// matters — the write succeeded somewhere else — so assert the artifact is where we told it to go
	// before reading it, rather than discovering the absence as an ENOENT three lines later.
	if (!existsSync(join(sandboxRegistry, 'versions', CORAL, VERSION, `${CORAL}.js`))) {
		throw new Error('build.mjs did not publish into the sandbox registry it was given: ' + sandboxRegistry
			+ '\n  — it wrote somewhere else, and that somewhere else may be a live registry.');
	}

	const artifactPath = join(sandboxRegistry, 'versions', CORAL, VERSION, `${CORAL}.js`);
	const artifact = readFileSync(artifactPath, 'utf8');

	const sourceManifest = JSON.parse(readFileSync(join(sandbox, CORAL, 'manifest.json'), 'utf8'));
	const emitted = JSON.parse(readFileSync(join(dirname(artifactPath), 'manifest.json'), 'utf8'));
	ok('the emitted manifest carries the package version', emitted.version === VERSION);
	ok('the emitted manifest carries the exact rewritten source',
		emitted.source === sourceManifest.source.split(`/${sourceManifest.version}/`).join(`/${VERSION}/`),
		String(emitted.source));

	// Separate registries keep these fixtures independent of immutable published copies.
	for (const middle of ['corals/square-shop/', '']) {
		const fixture = { ...sourceManifest,
			source: `https://example.test/${sourceManifest.version}/${middle}${sourceManifest.version}/square-shop.js` };
		writeFileSync(join(sandbox, CORAL, 'manifest.json'), JSON.stringify(fixture));
		const registry = join(sandbox, middle ? 'double-version-registry' : 'adjacent-version-registry');
		execFileSync('node', [join(sandbox, 'build.mjs'), CORAL, '--registry', registry, '--defaults', defaultsPath],
			{ stdio: 'inherit', env: BUILD_ENV });
		const manifest = JSON.parse(readFileSync(join(registry, 'versions', CORAL, VERSION, 'manifest.json'), 'utf8'));
		ok(`the double-version manifest carries the package version (${middle || 'adjacent'})`, manifest.version === VERSION);
		ok(`the double-version source is rewritten exactly (${middle || 'adjacent'})`,
			manifest.source === `https://example.test/${VERSION}/${middle}${VERSION}/square-shop.js`, String(manifest.source));
	}
	writeFileSync(join(sandbox, CORAL, 'manifest.json'), JSON.stringify(sourceManifest));


	// ── the stamp is there, and it is guarded ──────────────────────────────────────────────────
	// Counted, not merely looked for: `includes` stops at the first hit, and a SECOND unguarded
	// registration appended somewhere would satisfy an existence check while still throwing.
	const regLines = artifact.split('\n').filter((l) => l.includes('(window.__coralVersions='));
	ok('the artifact registers its version on window.__coralVersions exactly once',
		regLines.length === 1, `found ${regLines.length}`);
	ok('and that registration is guarded by typeof window',
		regLines.length > 0 && regLines.every((l) => l.startsWith("if (typeof window !== 'undefined') ")),
		JSON.stringify(regLines[0] ?? null));
	ok('the guarded stamp names this coral and this version',
		regLines.length > 0 && regLines[0].includes(`['${CORAL}']='${VERSION}'`), JSON.stringify(regLines[0] ?? null));
	ok('the header stamp still names the coral and version it was built at',
		new RegExp(`^/\\*! coral ${CORAL}@${VERSION.replace(/\./g, '\\.')} \\+`).test(artifact.split('\n')[0]),
		artifact.split('\n')[0]);

	// ── the deployment's defaults really were substituted in ───────────────────────────────────
	// 🔴 Three assertions, not one, because "the value is present" and "the placeholder is gone" and
	// "the line reads like a hand-written literal" are three different ways this can be wrong, and
	// only the third one keeps the registry's immutability check working: it compares a rebuild
	// against the published artifact as an EQUALITY, so a marker comment left trailing on the line
	// would demand a version bump for a coral nobody edited.
	ok('the artifact carries the deployment default, not the neutral one',
		artifact.includes(`const DEFAULT_API_BASE = '${DEFAULT_API_BASE}';`),
		artifact.split('\n').find((l) => l.includes('DEFAULT_API_BASE =')) ?? '<no such line>');
	ok('and the coral-default marker is gone from the published bytes',
		!artifact.includes('coral-default:'));
	ok('and the source it was built from still carries the NEUTRAL value',
		readFileSync(SRC, 'utf8').includes("const DEFAULT_API_BASE = ''; /*coral-default:apiBase*/"));

	// 🔴 CONTROL for the guard, not for the substitution. A build with no --defaults must REFUSE to
	// publish rather than shipping the empty origin to every site that rides the channel — and it
	// has to be shown refusing, or "the artifact has the right value" is equally consistent with a
	// builder that would happily have published the wrong one.
	//
	// 🩸 Into an EMPTY registry, and the first draft of this was not. Re-running into the one the
	// build above already wrote made the control go red on the IMMUTABILITY check ("already
	// published and the content differs") — which is a refusal, and a completely different one. A
	// control that passes on the wrong reason is not a control; it is a second assertion about
	// something nobody asked about. `--registry` exists precisely so this can ask its own question.
	{
		let refused = null;
		try {
			execFileSync('node', [join(sandbox, 'build.mjs'), CORAL, '--registry', join(sandbox, 'control-registry')],
				{ stdio: 'pipe', env: BUILD_ENV });
		} catch (e) { refused = e; }
		const stderr = String(refused?.stderr ?? '');
		ok('CONTROL: publishing with an unsubstituted marker is refused, not shipped',
			refused !== null && refused.status === 1 && /unsubstituted/.test(stderr),
			refused === null ? 'the build SUCCEEDED' : stderr.trim() || refused.message);
	}

	// ── the artifact imports under node, and is the same module its source is ─────────────────
	let mod = null, thrown = null;
	try { mod = await import(pathToFileURL(artifactPath).href); }
	catch (e) { thrown = e; }
	ok('the freshly built artifact imports under node without throwing',
		thrown === null, thrown && `${thrown.constructor.name}: ${thrown.message}`);

	const srcMod = await import(pathToFileURL(join(sandbox, CORAL, 'square-shop.js')).href);
	const srcNames = Object.keys(srcMod).sort();
	// Without this the comparison below is green when BOTH sides export nothing, which is exactly
	// what a build that silently emitted an empty file would look like.
	ok('the source exports something to compare against, including the mount entry points',
		srcNames.length > 0 && srcNames.includes('mount') && srcNames.includes('mountAll'),
		`${srcNames.length} exports`);
	const artNames = mod ? Object.keys(mod).sort() : [];
	ok('the artifact exports exactly what its source exports',
		JSON.stringify(artNames) === JSON.stringify(srcNames),
		`source ${srcNames.length}: ${srcNames.join(',')} | artifact ${artNames.length}: ${artNames.join(',')}`);

	// ── CONTROL: the old trailer really is what threw ──────────────────────────────────────────
	// An artifact that imports cleanly says nothing on its own — node might simply tolerate the
	// line. This is the SAME source with the pre-2026-08-29 trailer, synthesised here rather than
	// fetched out of git (a reference to a commit rots; this one cannot). If this stops throwing,
	// the guard above is no longer the reason anything works and these assertions are decoration.
	const unguardedPath = join(dirname(artifactPath), 'unguarded-control.js');
	writeFileSync(unguardedPath, readFileSync(SRC, 'utf8')
		+ `\n(window.__coralVersions=window.__coralVersions||{})['${CORAL}']='${VERSION}';\n`);
	let ctl = null;
	try { await import(pathToFileURL(unguardedPath).href); } catch (e) { ctl = e; }
	ok('CONTROL: the same source with the OLD unguarded trailer throws ReferenceError',
		ctl instanceof ReferenceError && /window is not defined/.test(ctl.message), String(ctl));

	// ── the browser behaviour is unchanged, by execution ───────────────────────────────────────
	const line = regLines[0] ?? '';
	{
		const ctx = createContext({ window: {} });
		runInContext(line, ctx);
		ok('with a window, the guarded stamp sets the same key to the same value',
			ctx.window.__coralVersions?.[CORAL] === VERSION, JSON.stringify(ctx.window.__coralVersions ?? null));
	}
	{
		// The `||{}` half: a page carrying two corals must end up with BOTH, not with whichever
		// artifact the browser evaluated last. The guard must not have cost that.
		const registry = { 'inbox-bubble': '9.9.9' };
		const ctx = createContext({ window: { __coralVersions: registry } });
		runInContext(line, ctx);
		ok('and it merges into an existing registry rather than replacing it',
			ctx.window.__coralVersions === registry && registry['inbox-bubble'] === '9.9.9'
			&& registry[CORAL] === VERSION, JSON.stringify(registry));
	}
	{
		const ctx = createContext({});
		let vmThrew = null;
		try { runInContext(line, ctx); } catch (e) { vmThrew = e; }
		ok('and with no window in scope at all it is a no-op instead of a throw',
			vmThrew === null, String(vmThrew));
	}
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
