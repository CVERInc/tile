// build.mjs must refuse to publish square-shop when its --defaults apiBase names the legacy
// Heroku backend being retired — square-shop@0.11.16 shipped exactly that, silently, and every
// embed with no data-api-base of its own inherited it. This is the guard, tested both ways: red
// on the mistake (in three spellings), green on the RSP surface it should have named all along,
// and a control that a host merely CONTAINING "herokuapp.com" is not mistaken for the guarded one.
//   run: node packages/dynamic-corals/legacy-api-base-guard.test.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, 'build.mjs');
const CORAL = 'square-shop';
const RSP_SURFACE = 'https://rsp.feelreef.com';
const { version: VERSION } = JSON.parse(readFileSync(join(HERE, CORAL, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

// 🩸 --registry EXPLICITLY, and CORAL_REGISTRY stripped from the child's environment — the same
// belt build-stamp.test.mjs wears, for the same reason: a probe must not be able to write outside
// its own sandbox even when the caller's environment happens to name a real registry.
const BUILD_ENV = { ...process.env, ESBUILD: process.execPath, CORAL_REGISTRY: '' };
delete BUILD_ENV.CORAL_REGISTRY;

const sandbox = mkdtempSync(join(tmpdir(), 'coral-legacy-api-base-'));
try {
	const defaultsPath = (apiBase) => {
		const p = join(sandbox, `defaults-${short(apiBase)}.json`);
		writeFileSync(p, JSON.stringify({ [CORAL]: { apiBase } }, null, 2) + '\n');
		return p;
	};

	// ── RED: the exact class of mistake 0.11.16 shipped, in three spellings ─────────────────────
	for (const legacy of [
		'https://legacy-bot.herokuapp.com',
		'https://legacy-bot.herokuapp.com/',
		'http://Legacy-Bot.HerokuApp.Com',
	]) {
		const registry = join(sandbox, 'red-registry-' + short(legacy));
		let refused = null;
		try {
			execFileSync('node', [BUILD, CORAL, '--registry', registry, '--defaults', defaultsPath(legacy)],
				{ stdio: 'pipe', env: BUILD_ENV });
		} catch (e) { refused = e; }
		const stderr = String(refused?.stderr ?? '');
		ok(`refuses a herokuapp apiBase (${legacy})`,
			refused !== null && refused.status === 1 && /herokuapp/i.test(stderr) && stderr.includes(RSP_SURFACE),
			refused === null ? 'the build SUCCEEDED' : stderr.trim());
		ok(`and nothing was published to ${registry}`, !existsSync(registry));
	}

	// CONTROL: a host that only CONTAINS "herokuapp.com" in its path must not trip the guard — the
	// check has to read the hostname, not do a substring match over the whole string.
	{
		const registry = join(sandbox, 'control-substring-registry');
		let thrown = null;
		try {
			execFileSync('node', [BUILD, CORAL, '--registry', registry, '--defaults',
				defaultsPath('https://example.com/herokuapp.com')], { stdio: 'pipe', env: BUILD_ENV });
		} catch (e) { thrown = e; }
		const stderr = String(thrown?.stderr ?? '');
		ok('CONTROL: a host that only CONTAINS "herokuapp.com" in its path is not the guarded host',
			thrown === null || !/herokuapp/i.test(stderr), thrown ? stderr.trim() : '(built)');
	}

	// ── GREEN: the RSP surface, built for real into a mktemp registry ───────────────────────────
	const greenRegistry = join(sandbox, 'green-registry');
	execFileSync('node', [BUILD, CORAL, '--registry', greenRegistry, '--defaults', defaultsPath(RSP_SURFACE)],
		{ stdio: 'inherit', env: BUILD_ENV });
	const artifactPath = join(greenRegistry, 'versions', CORAL, VERSION, `${CORAL}.js`);
	ok(`the RSP default builds ${CORAL}@${VERSION} into the given registry`, existsSync(artifactPath));
	const artifact = existsSync(artifactPath) ? readFileSync(artifactPath, 'utf8') : '';
	ok('and the published artifact carries DEFAULT_API_BASE = the RSP surface',
		artifact.includes(`const DEFAULT_API_BASE = '${RSP_SURFACE}';`),
		artifact.split('\n').find((l) => l.includes('DEFAULT_API_BASE =')) ?? '<no such line>');
	ok('and the coral-default marker is gone from the published bytes',
		!artifact.includes('coral-default:'));
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
