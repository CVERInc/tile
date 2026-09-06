// cli.mjs under a real signal — the 130/143, and the renderer coming back with it.
//
// 🩸 THIS FILE EXISTS BECAUSE THE OLD ONE MEASURED THE EASY CASE. The signal test used to live in
// stage.test.mjs, where a child called `stageSite` and then sat in a `setInterval`: no `astro
// build` running, no second restore in flight, and a fixture site with no `assets/` at all — the
// cleanest of the four windows a signal can land in. Against the real CLI with a site that has
// media, 3 of 5 samples left the renderer's `blog/` in the stash, kept `.tile-build-lock`, printed
// a bare `ENOENT`, and exited 2 rather than 130. Measured 2026-09-07.
//
// So the subject here is the PROGRAM: a real `cli.mjs` in its own process group, signalled the way
// a terminal signals it, with a site whose media makes the staging window wide enough to aim at.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from './index.mjs';
import { listStaged, STASH_PREFIX, LOCK_NAME } from './stage.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

// The renderer's own material, each file with a distinct body so "identical" is read, not counted.
const DEMO = {
  'content/demo.md': "---\nsitetile-page: demo\n---\nthe renderer's own example page\n",
  'blog/a-demo-post.md': '---\ntitle: "A demo post"\n---\nthe renderer\'s own post\n',
  'pagetile/a-demo.book.md': '---\ntitle: "A demo book"\n---\nthe renderer\'s own book\n',
  'public/_redirects': '/feed /rss.xml 301\n',
  'public/img/mark.svg': '<svg/>\n',
};

// 🔴 THE WINDOW IS THE SITE'S MEDIA. The staging window is proportional to how much there is to
// copy, and a site with no assets closes it before a person's finger leaves the key — which is
// exactly why the old case never saw the defect. 1,500 files is the size the failure was measured
// at; built once and shared, because building it is the slow part of this file.
const ASSETS = mkdtempSync(join(tmpdir(), 'tile-build-cli-assets-'));
mkdirSync(join(ASSETS, 'img'), { recursive: true });
for (let i = 0; i < 1500; i++) writeFileSync(join(ASSETS, `img/photo-${i}.bin`), `pretend this is a photo ${i}\n`);
writeFileSync(join(ASSETS, '_redirects'), '/old /new 301\n');

// One site to rebuild. No `theme:`, so the recipe's --theme is not part of what is being measured.
const IR = mkdtempSync(join(tmpdir(), 'tile-build-cli-ir-'));
writeFileSync(join(IR, 'home.md'), '---\ntitle: Home\n---\n# the owner\'s home page\n');
writeFileSync(join(IR, 'about.md'), '---\ntitle: About\n---\n# the owner\'s about page\n');
mkdirSync(join(IR, 'legal'), { recursive: true });
writeFileSync(join(IR, 'legal/terms.md'), '---\ntitle: Terms\n---\n# the owner\'s terms\n');

after(() => {
  rmSync(ASSETS, { recursive: true, force: true });
  rmSync(IR, { recursive: true, force: true });
});

/** An engine checkout whose renderer is a stub, plus a `bin/` holding the `npx` the CLI will find. */
function fakeEngine(t, npxBody) {
  const root = mkdtempSync(join(tmpdir(), 'tile-build-cli-engine-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const astroDir = join(root, RENDERER_SUBPATH);
  // `node_modules` is what buildSite checks for before it will build at all.
  mkdirSync(join(astroDir, 'node_modules'), { recursive: true });
  writeFileSync(join(astroDir, 'package.json'), '{ "name": "@tile/sitetile-astro-stub", "type": "module" }\n');
  for (const [rel, body] of Object.entries(DEMO)) {
    mkdirSync(join(astroDir, rel, '..'), { recursive: true });
    writeFileSync(join(astroDir, rel), body);
  }
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'npx'), npxBody, { mode: 0o755 });
  return { root, astroDir, binDir };
}

const snapshot = async (dir) => {
  const files = (await listStaged(dir)).filter((f) => !f.startsWith('node_modules/'));
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
};
const leftovers = (dir) =>
  readdirSync(dir).filter((n) => n.startsWith(STASH_PREFIX) || n === LOCK_NAME).sort();

/**
 * Run the real CLI in its OWN PROCESS GROUP, so a signal can be delivered to the group the way a
 * terminal delivers Ctrl-C — `kill -INT <pid>` reaches one process and proves less.
 */
function runCli(t, { root, binDir, outDir, args = [] }) {
  const child = spawn(process.execPath, [CLI, IR, outDir, '--engine', root, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });
  const ended = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  t.after(async () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } await ended; });
  return {
    child,
    ended: ended.then((e) => ({ ...e, get stdout() { return stdout; }, get stderr() { return stderr; } })),
    ctrlC: (sig) => process.kill(-child.pid, sig),
  };
}

/** Wait for a condition that a wall-clock delay would only guess at. */
async function until(what, pred, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// An `npx` that behaves like `astro build`: it takes a while and it writes into --outDir. It also
// leaves a mark the moment it starts, so a test can tell which window a signal actually landed in
// rather than believing a comment about it.
const SLOW_NPX = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--outDir" ]; then out="$2"; fi
  shift
done
mkdir -p "$out"
: > "$out/../npx-started"
sleep 3
echo built > "$out/index.html"
`;

// ── the promise the README makes ────────────────────────────────────────────────────────────────
// 🔴 The 130 is the CLI's, not the library's. stage.test.mjs proves nothing on `process` is touched
// by an import; this proves the program still does the thing a person pressing Ctrl-C expects.
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`${signal} inside the staging window: the renderer comes back and the CLI exits ${code}`, async (t) => {
    const { root, astroDir, binDir } = fakeEngine(t, SLOW_NPX);
    const before = await snapshot(astroDir);
    const outDir = join(root, 'out');

    const run = runCli(t, { root, binDir, outDir, args: ['--assets', ASSETS] });
    // The lock appearing IS the staging window opening — deterministic, where a timer is a race.
    await until('the staging window to open', () => existsSync(join(astroDir, LOCK_NAME)));
    run.ctrlC(signal);

    const { code: exit, sig, stderr } = await run.ended;
    assert.equal(sig, null, `the CLI was killed by ${sig} rather than leaving on its own terms`);
    assert.equal(exit, code, `${signal} must leave ${code}; stderr was:\n${stderr}`);
    assert.match(stderr, new RegExp(`${signal} — the build was stopped and the renderer put back`),
      'the CLI printed something other than a sentence about what just happened');

    assert.deepEqual(await snapshot(astroDir), before,
      `after ${signal} the renderer is still wearing the other site — the next build would ship it`);
    assert.deepEqual(leftovers(astroDir), [], 'a stash or a lock survived the signal');
  });
}

// ── the whole window, not one point in it ───────────────────────────────────────────────────────
// 🩸 THE REVIEW'S TIMING PAYLOAD, and the reason a single sample proves nothing here. Ctrl-C at
// t=600ms, 900ms and 1200ms against a site with media each left a DIFFERENT wreck — 600ms lost both
// `blog/` and `pagetile/`, 900ms and 1200ms lost only `blog/` — because two restores were in flight
// at once and which one won the rename depended on where the signal landed. All three exited 2 with
// a bare ENOENT. The invariant is not "one moment is safe": it is that EVERY moment is, so this
// walks the delay across staging and across the build and asserts the same three things each time.
//
// The signal goes to the whole process group, which is what a terminal's Ctrl-C is. `kill -INT
// <pid>` and `docker stop` reach ONE process and are a different question — that one is below.
test('Ctrl-C anywhere across the staging and build windows: 130, and a byte-identical renderer', async (t) => {
  const landedInBuild = [];
  for (const delayMs of [100, 300, 600, 1000, 1500, 2200]) {
    const { root, astroDir, binDir } = fakeEngine(t, SLOW_NPX);
    const before = await snapshot(astroDir);
    const outDir = join(root, 'out');

    const run = runCli(t, { root, binDir, outDir, args: ['--assets', ASSETS] });
    await new Promise((r) => setTimeout(r, delayMs));
    run.ctrlC('SIGINT');

    const { code, sig, stderr } = await run.ended;
    assert.equal(sig, null, `t=${delayMs}ms: the CLI was killed rather than leaving on its own terms`);
    assert.equal(code, 130, `t=${delayMs}ms: exit ${code}, not 130. stderr was:\n${stderr}`);
    assert.doesNotMatch(stderr, /ENOENT|ENOTEMPTY|EEXIST/,
      `t=${delayMs}ms: an errno reached the user where a sentence belongs:\n${stderr}`);
    assert.deepEqual(await snapshot(astroDir), before,
      `t=${delayMs}ms: the renderer did not come back — the next build here would ship this site`);
    assert.deepEqual(leftovers(astroDir), [], `t=${delayMs}ms: a stash or a lock survived`);
    landedInBuild.push(existsSync(join(root, 'npx-started')));
  }

  // 🔴 …and the sweep says out loud that it covered both windows. The case this replaces looked
  // like it was testing a signal mid-build and was testing a signal against a `setInterval`.
  assert.ok(landedInBuild.includes(false), 'no sample landed in the staging window — widen the assets');
  assert.ok(landedInBuild.includes(true), 'no sample reached the build at all — the sleep is too short');
});

// ── the child, and the order it goes in ─────────────────────────────────────────────────────────
// 🩸 SIGNALLED ONE PROCESS, NOT A GROUP — which is `docker stop` (SIGTERM to PID 1) and `kill -INT
// <pid>`, the two ways this actually gets stopped outside a terminal. Measured 2026-09-07: the CLI
// restored, printed its exit and left, while `astro build` was still running. Three seconds later
// the orphan wrote into the site owner's --outDir, and what it had by then was the RENDERER's own
// demo content, because restore had already put that back underneath it. `stage.mjs`'s opening
// line is that the renderer's demo posts must not build into your site under your domain with
// nothing saying so; this is that, produced by the signal path meant to prevent it.
//
// The lock is the second half. restore() removes `.tile-build-lock`, so those seconds were a build
// running with no lock held — "one build at a time" broken by its own unwind.
const REPORTING_NPX = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--outDir" ]; then out="$2"; fi
  shift
done
mkdir -p "$out"
echo $$ > "$out/../npx-pid"
: > "$out/../npx-started"
trap 'if [ -d "$PWD/${LOCK_NAME}" ]; then echo held > "$out/../lock-at-sigterm"; else echo released > "$out/../lock-at-sigterm"; fi; exit 143' TERM
i=0
while [ $i -lt 40 ]; do sleep 0.1; i=$((i+1)); done
ls "$PWD/content" > "$out/what-astro-saw.txt"
`;

test('an aborted build takes its astro with it — no orphan writes into the owner\'s --outDir', async (t) => {
  const { root, astroDir, binDir } = fakeEngine(t, REPORTING_NPX);
  const before = await snapshot(astroDir);
  const outDir = join(root, 'out');

  const run = runCli(t, { root, binDir, outDir, args: ['--assets', ASSETS] });
  await until('astro build to start', () => existsSync(join(root, 'npx-started')));
  const npxPid = Number(readFileSync(join(root, 'npx-pid'), 'utf8').trim());
  assert.ok(npxPid > 0, 'the build never recorded a pid — this case would prove nothing');

  // ONE process, the way `docker stop` and `kill -INT <pid>` do it. No minus sign, no group.
  process.kill(run.child.pid, 'SIGINT');

  const { code, stderr } = await run.ended;
  assert.equal(code, 130, `exit ${code}, not 130. stderr was:\n${stderr}`);

  // 🔴 The child is gone BEFORE the CLI is, not merely asked to go.
  assert.throws(() => process.kill(npxPid, 0), /ESRCH/,
    'astro build outlived the CLI that said it had stopped — it is still writing somewhere');

  // Past the point that build would have written, so "it did not" is measured and not assumed.
  await new Promise((r) => setTimeout(r, 4500));
  assert.equal(existsSync(join(outDir, 'what-astro-saw.txt')), false,
    "a build the CLI reported as stopped still wrote into the owner's --outDir");
  assert.deepEqual(await snapshot(astroDir), before);
  assert.deepEqual(leftovers(astroDir), [], 'a stash or a lock survived');

  // 🔴 …and the lock was still held at the moment it was told to stop. The other order is the one
  // where a second build takes the renderer while the first is still writing in it.
  assert.ok(existsSync(join(root, 'lock-at-sigterm')),
    'the build was never sent SIGTERM at all — nothing asked it to stop');
  assert.equal(readFileSync(join(root, 'lock-at-sigterm'), 'utf8').trim(), 'held',
    'the lock was released before the build it was holding the renderer for had gone');
});

// 🔴 …and a build that IGNORES SIGTERM does not get to stay. The grace is a grace, not a request.
const STUBBORN_NPX = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--outDir" ]; then out="$2"; fi
  shift
done
mkdir -p "$out"
echo $$ > "$out/../npx-pid"
: > "$out/../npx-started"
trap '' TERM
i=0
while [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done
ls "$PWD/content" > "$out/what-astro-saw.txt"
`;

test('a build that ignores SIGTERM is SIGKILLed after the grace, and the restore waits for it', async (t) => {
  const { root, astroDir, binDir } = fakeEngine(t, STUBBORN_NPX);
  const before = await snapshot(astroDir);
  const outDir = join(root, 'out');

  const stopping = new AbortController();
  const started = Date.now();
  const pending = buildSite({
    irDir: IR, engineDir: root, outDir, npxBin: join(binDir, 'npx'),
    signal: stopping.signal, killGraceMs: 400,
  });
  await until('astro build to start', () => existsSync(join(root, 'npx-started')));
  const npxPid = Number(readFileSync(join(root, 'npx-pid'), 'utf8').trim());
  stopping.abort();

  await assert.rejects(() => pending, (err) => { assert.equal(err.name, 'AbortError'); return true; });
  // 30 seconds is what that script would have taken. Returning at all means it did not wait for it.
  assert.ok(Date.now() - started < 15_000, 'the abort waited for a build that was ignoring it');
  assert.throws(() => process.kill(npxPid, 0), /ESRCH/, 'the build ignored SIGTERM and was allowed to');
  assert.equal(existsSync(join(outDir, 'what-astro-saw.txt')), false);
  assert.deepEqual(await snapshot(astroDir), before);
  assert.deepEqual(leftovers(astroDir), [], 'a stash or a lock survived');
});
