// The specimens on disk are what gen-specimens.mjs produces — checked, not assumed.
//
// 🩸 WHY. Every browser harness in verify/ measures against these files, so a specimen is the ruler
// behind a dozen other rulers. Nothing checked them. Two ways that goes wrong, and I hit the second
// one on 2026-08-12 within a minute of writing this file's subject:
//
//   1. somebody hand-edits a specimen. The generator is then a lie, and the next person to run it
//      silently reverts the edit — including whatever a harness was relying on.
//   2. the GENERATOR breaks, the run fails, and the specimens simply stay as they were. I did this:
//      an unescaped backtick inside a template literal, run with the output piped to /dev/null. The
//      files were untouched, every test stayed green, and the change I thought I had made was not
//      there. A green that comes from never doing the thing looks exactly like a pass.
//
// So this both RUNS the generator (catching 2) and DIFFS its output against the repo (catching 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, 'specimens');

test('the specimens on disk are exactly what the generator emits', () => {
  const out = mkdtempSync(join(tmpdir(), 'ct-spec-'));
  try {
    // stderr is inherited on failure, because a generator that cannot run is the finding
    execFileSync(process.execPath, [join(HERE, 'gen-specimens.mjs')],
      { env: { ...process.env, CARDTILE_SPECIMEN_OUT: out }, stdio: ['ignore', 'ignore', 'inherit'] });

    const emitted = readdirSync(out).filter((f) => f.endsWith('.card.md')).sort();
    const onDisk = readdirSync(REPO).filter((f) => f.endsWith('.card.md')).sort();
    // 🔴 CONTROL for the control: if the generator emitted nothing, every comparison below is vacuous
    // and the set comparison would pass on two empty lists only if the repo were empty too.
    assert.ok(emitted.length >= 3, `the generator emitted ${emitted.length} specimen(s) — it did not run`);
    assert.deepEqual(onDisk, emitted, 'the specimen directory and the generator disagree about WHICH cards exist');

    for (const f of emitted) {
      const want = readFileSync(join(out, f), 'utf8');
      const got = readFileSync(join(REPO, f), 'utf8');
      if (want === got) continue;
      // 🩸 `[...want].findIndex((c, i) => c !== got[i])` walks CODE POINTS on the left and UTF-16
      // UNITS on the right. On CJK content the two desync and it reports a position in neither: an
      // append at the end of specimen-plain came back as "byte 2". Two rulers, one number.
      let at = 0;
      while (at < want.length && at < got.length && want[at] === got[at]) at++;
      const byteAt = Buffer.byteLength(got.slice(0, at), 'utf8');
      assert.fail(`${f} differs from the generator at byte ${byteAt} (${Buffer.byteLength(got)}B on disk, ${Buffer.byteLength(want)}B emitted)\n`
        + `  on disk:  ${JSON.stringify(got.slice(Math.max(0, at - 30), at + 50))}\n`
        + `  emitted:  ${JSON.stringify(want.slice(Math.max(0, at - 30), at + 50))}\n`
        + '  → run `node packages/cardtile/cards/gen-specimens.mjs`, or move the edit into the generator');
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
