// What the cardtile worker answered BEFORE the home deck existed, as a committed fixture — so the
// rule "with CARDS_HOME_DECK off, every answer is the one the Worker gave before" is checked against
// the Worker that did not have the feature, not against this tree with and without the setting.
//
//   node packages/cardtile/serve/gen-home-deck-off-fixture.mjs [<git ref>]
//
// 🩸 WHY A FIXTURE. The first OFF tests compared this tree with the setting to this tree without it.
// Both sides carried the same unconditional change — the home's words and a changed deck wrapper had
// entered the editor bundle — so `/try/edit` was 5 KB bigger on every host with the switch off, and
// the tests were green. A comparison of a tree with itself cannot see what the tree always does.
//
// What it does: exports the tree at <git ref> (default: the merge base of HEAD and origin/main) into a
// temporary directory, loads THAT tree's Worker, asks it every case of the grid below and writes
// status, headers, body size, body hash and the store keys read, in order, to
// home-deck-off.fixture.json. home-deck.test.mjs asks this tree's Worker the same cases.
//
// 🔴 WHEN TO RUN IT AGAIN. Only when a later change alters one of these answers ON PURPOSE (a
// stylesheet, the editor, a header). Capture from a tree that has that change and whose home-deck
// switch code is unchanged, and read the fixture's diff: it must show that change and nothing else.
// Never re-capture to make a home-deck change pass — that is the comparison this file replaced.
//
// 🔴 The clock: these pages carry the year (the footer), and the capture runs once while the test runs
// for years. Both ask under ONE fixed clock (atFixedClock, GRID_NOW) — the capture and the test must
// never ask under the real one.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(DIR, 'home-deck-off.fixture.json');

// ── the grid: 3 stages × 6 hosts × 14 paths = 252 answers ─────────────────────────────────────────
const cardsFile = (title) => `---\ncard-page: t\ntitle: ${title}\n---\n\n## grid\n\n- [ ] %% card: profile w=6 %% Public bio\n`;
export const GRID_SEED = Object.freeze({
  feelreef: cardsFile('Stored platform page'),
  aster: cardsFile('Aster'),
  'pool:aster:0': 'in',
  'vanity:own.example': 'aster',
  'vanityof:aster:0': 'own.example',
  'vanitybind:aster:0:own.example': '1',
});
export const GRID_STAGES = Object.freeze({
  dark: {},
  open: { CARDS_HOST_OPEN: 'reef.cards' },
  canonical: { CARD_CANONICAL_HOST: 'reef.cards' },
});
export const GRID_HOSTS = Object.freeze(['reef.cards', 'card.feelreef.com', 'saas.feelreef.com', 'x.workers.dev', 'own.example', 'unbound.example']);
export const GRID_PATHS = Object.freeze(['/', '/?ref=aster', '/?ref=nobody', '/?lang=ja', '/aster', '/aster.md', '/feelreef', '/feelreef.md',
  '/index.md', '/try/edit', '/edit', '/report', '/robots.txt', '/nope']);

export const caseKey = (stage, host, path) => `${stage} ${host} ${path}`;
/** every case of the grid, in a fixed order: { key, stage, host, path } */
export function gridCases() {
  const out = [];
  for (const stage of Object.keys(GRID_STAGES)) for (const host of GRID_HOSTS) for (const path of GRID_PATHS) out.push({ key: caseKey(stage, host, path), stage, host, path });
  return out;
}

/**
 * One answer, as the fixture keeps it. `flag` is the value of CARDS_HOME_DECK (undefined: not set).
 * The body is kept as its size and hash; the headers and the store reads whole, in order.
 */
export async function answerOf(worker, { stage, host, path }, flag) {
  const reads = [];
  const CARDS = {
    async get(k) { reads.push(k); return Object.hasOwn(GRID_SEED, k) ? GRID_SEED[k] : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
  };
  const env = { PREVIEW: 'false', ...GRID_STAGES[stage], ...(flag === undefined ? {} : { CARDS_HOME_DECK: flag }), CARDS };
  const res = await worker.fetch(new Request(`https://${host}${path}`), env);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: body.length, sha: createHash('sha256').update(body).digest('hex'), headers: [...res.headers], reads };
}

/** the one clock every answer of the grid is asked under */
export const GRID_NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
/** run `fn` with `Date` reading GRID_NOW (and `new Date()` with it); the real clock is put back whatever happens */
export async function atFixedClock(fn) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(GRID_NOW); }
    static now() { return GRID_NOW; }
  };
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}

/** what differs between two answers ('' when nothing does) */
export function answerDiff(got, want) {
  const d = [];
  if (got.status !== want.status) d.push(`status ${got.status}, was ${want.status}`);
  if (got.bytes !== want.bytes) d.push(`${got.bytes} bytes, was ${want.bytes}`);
  else if (got.sha !== want.sha) d.push('the body differs (same size)');
  if (JSON.stringify(got.headers) !== JSON.stringify(want.headers)) d.push('the headers differ');
  if (JSON.stringify(got.reads) !== JSON.stringify(want.reads)) d.push(`store reads ${JSON.stringify(got.reads)}, were ${JSON.stringify(want.reads)}`);
  return d.join('; ');
}

// ── the capture (only when this file is run, never when it is imported) ───────────────────────────
const git = (args, opts = {}) => execFileSync('git', args, { cwd: DIR, timeout: 120000, maxBuffer: 1 << 20, ...opts });

async function capture(ref) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const tmp = fs.mkdtempSync(join(os.tmpdir(), 'home-deck-off-'));
  try {
    const top = git(['rev-parse', '--show-toplevel']).toString().trim();
    git(['archive', '--format=tar', '-o', join(tmp, 'tree.tar'), sha, 'packages'], { cwd: top });
    execFileSync('tar', ['-xf', join(tmp, 'tree.tar'), '-C', tmp], { timeout: 120000 });
    const worker = (await import(pathToFileURL(join(tmp, 'packages/cardtile/serve/card-worker.mjs')).href)).default;
    const cases = gridCases();
    const answers = {};
    await atFixedClock(async () => { for (const c of cases) answers[c.key] = await answerOf(worker, c, undefined); });
    // headers repeat across cases: each distinct list is written once
    const headerSets = []; const at = new Map();
    const rows = {};
    for (const c of cases) {
      const a = answers[c.key];
      const h = JSON.stringify(a.headers);
      if (!at.has(h)) { at.set(h, headerSets.length); headerSets.push(a.headers); }
      rows[c.key] = [a.status, a.bytes, a.sha, at.get(h), a.reads];
    }
    const lines = [
      '{',
      `"about": ${JSON.stringify('GENERATED by gen-home-deck-off-fixture.mjs — do not edit. What the cardtile worker answered before the home deck existed. Regenerate: node packages/cardtile/serve/gen-home-deck-off-fixture.mjs <git ref>')},`,
      `"base": ${JSON.stringify(sha)},`,
      '"row": ["status", "body bytes", "body sha256", "index into headerSets", "store keys read, in order"],',
      '"headerSets": [',
      headerSets.map((h) => JSON.stringify(h)).join(',\n'),
      '],',
      '"answers": {',
      cases.map((c) => `${JSON.stringify(c.key)}: ${JSON.stringify(rows[c.key])}`).join(',\n'),
      '}',
      '}',
      '',
    ];
    fs.writeFileSync(FIXTURE_PATH, lines.join('\n'));
    console.log(`home-deck-off.fixture.json: ${cases.length} answers of ${sha}, ${headerSets.length} distinct header lists`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** the committed fixture: { base, answers: key → { status, bytes, sha, headers, reads } } */
export function readFixture(path = FIXTURE_PATH) {
  const f = JSON.parse(fs.readFileSync(path, 'utf8'));
  const answers = Object.fromEntries(Object.entries(f.answers).map(([k, [status, bytes, sha, h, reads]]) => [k, { status, bytes, sha, headers: f.headerSets[h], reads }]));
  return { base: f.base, answers };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const ref = process.argv[2] || git(['merge-base', 'HEAD', 'origin/main']).toString().trim();
  await capture(ref);
}
