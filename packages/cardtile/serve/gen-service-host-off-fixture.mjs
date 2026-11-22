// What the cardtile worker answered BEFORE the service had a host of its own, as a committed fixture —
// so the rule "with CARDS_SERVICE_HOST and CARDS_HOST_STANDINS unset, every answer is the one the
// Worker gave before" is checked against the Worker that did not have them, not against this tree
// with and without the settings. (A tree compared with itself cannot see what it always does: the
// editor's inline module carries the renderer, so a change to the renderer changes `/try/edit` on
// every host whatever a setting says.)
//
//   node packages/cardtile/serve/gen-service-host-off-fixture.mjs [<git ref>]
//
// What it does: exports the tree at <git ref> (default: the merge base of HEAD and origin/main) into a
// temporary directory, loads THAT tree's Worker, asks it every case of the grid below and writes
// status, headers, body size, body hash and the store keys read, in order, to
// service-host-off.fixture.json. service-host-off.test.mjs asks this tree's Worker the same cases.
//
// 🔴 WHEN TO RUN IT AGAIN. Only when a later change alters one of these answers ON PURPOSE (a
// stylesheet, the editor, a header). Capture from a tree that has that change and whose host-role
// code is unchanged, and read the fixture's diff: it must show that change and nothing else. Never
// re-capture to make a host-role change pass.
//
// 🔴 The clock: these pages carry the year (the footer), and the capture runs once while the test runs
// for years. Both ask under ONE fixed clock (atFixedClock, GRID_NOW).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(DIR, 'service-host-off.fixture.json');

// ── the grid: 3 stages × 7 hosts × 34 requests = 714 answers (and the wide grid, further down) ──────────────────────────────────────
const cardsFile = (title, more = '') => `---\ncard-page: t\ntitle: ${title}\n---\n\n## grid\n\n- [ ] %% card: profile w=6 %% Public bio\n${more}`;
// tile#372: a person's page and the preview hold an `embed` (the one tile whose frame a stage of the page's
// policy can write differently), so the grid compares those pages' bodies with an embed on them
export const GRID_EMBED = '- [ ] %% card: embed w=6 %% <b id="t">x</b><script>t.textContent = "ran"</script>\n';
export const GRID_PREVIEW = 'b'.repeat(32);
export const GRID_SEED = Object.freeze({
  feelreef: cardsFile('Stored platform page'),
  aster: cardsFile('Aster', GRID_EMBED),
  'pool:aster:0': 'in',
  'vanity:own.example': 'aster',
  'vanityof:aster:0': 'own.example',
  'vanitybind:aster:0:own.example': '1',
  [`_preview:${GRID_PREVIEW}`]: cardsFile('A parked draft', GRID_EMBED),
});
export const GRID_TOKEN = 'service-host-off-grid-token';
const TOKEN_HASH = createHash('sha256').update(GRID_TOKEN).digest('hex');
export const GRID_STAGES = Object.freeze({
  dark: {},
  open: { CARDS_HOST_OPEN: 'reef.cards' },
  canonical: { CARD_CANONICAL_HOST: 'reef.cards' },
});
export const GRID_HOSTS = Object.freeze(['reef.cards', 'card.feelreef.com', 'cards.feelreef.com', 'saas.feelreef.com', 'x.workers.dev', 'own.example', 'unbound.example']);
const AUTH = Object.freeze({ authorization: `Bearer ${GRID_TOKEN}` });
/** [name, path, init] — the name is the case's key; a body is always one the route refuses or only reads */
export const GRID_REQUESTS = Object.freeze([
  ...['/', '/?lang=ja', '/?ref=aster', '/aster', '/aster?utm=qr', '/aster.md', '/aster/avatar', '/feelreef', '/feelreef.md', '/index.md',
    '/favicon.ico', '/try/edit', '/try/edit?stay=1', '/try/edit?lang=ja', '/try/edit/', '/try/edit2?lang=ja', '/try/park', '/try', '/edit',
    '/edit?host=https://feelreef.com', '/report', '/.well-known/security.txt', '/robots.txt', '/nope', `/_preview/${GRID_PREVIEW}`,
    '/_api/card/aster'].map((p) => [`GET ${p}`, p, {}]),
  ['GET /_api/card/aster (bearer)', '/_api/card/aster', { headers: AUTH }],
  ['HEAD /', '/', { method: 'HEAD' }],
  ['HEAD /aster', '/aster', { method: 'HEAD' }],
  ['HEAD /try/edit', '/try/edit', { method: 'HEAD' }],
  ['POST /aster', '/aster', { method: 'POST', body: 'x' }],
  ['POST /try/park (not a Cards file)', '/try/park', { method: 'POST', body: 'x' }],
  ['POST /report (text/plain)', '/report', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }],
  ['POST /_api/cards (bearer)', '/_api/cards', { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"handles":["aster","nobody"]}' }],
]);

export const caseKey = (stage, host, name) => `${stage} ${host} ${name}`;
/** every case of the grid, in a fixed order: { key, stage, host, name, path, init } */
export function gridCases() {
  const out = [];
  for (const stage of Object.keys(GRID_STAGES)) for (const host of GRID_HOSTS) for (const [name, path, init] of GRID_REQUESTS) out.push({ key: caseKey(stage, host, name), stage, host, name, path, init });
  return out;
}

/**
 * One answer, as the fixture keeps it. `extra` is merged over the stage's settings (the new settings,
 * in the values under test; {} for the capture). The body is kept as its size and hash; the headers
 * and the store reads whole, in order. `{ text: true }` keeps the body's text as well (a test's, never the fixture's).
 */
export async function answerOf(worker, { stage, host, path, init }, extra = {}, { text = false } = {}) {
  const reads = [];
  const CARDS = {
    async get(k) { reads.push(k); return Object.hasOwn(GRID_SEED, k) ? GRID_SEED[k] : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
  };
  const env = { PREVIEW: 'false', MCP_TOKEN_HASH: TOKEN_HASH, ...GRID_STAGES[stage], ...extra, CARDS };
  const res = await worker.fetch(new Request(`https://${host}${path}`, init), env);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: body.length, sha: createHash('sha256').update(body).digest('hex'), headers: [...res.headers], reads, ...(text ? { text: body.toString('utf8') } : {}) };
}

/** the one clock every answer of the grid is asked under */
export const GRID_NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
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
  if (JSON.stringify(got.headers) !== JSON.stringify(want.headers)) d.push(`the headers differ: ${JSON.stringify(got.headers)}, were ${JSON.stringify(want.headers)}`);
  if (JSON.stringify(got.reads) !== JSON.stringify(want.reads)) d.push(`store reads ${JSON.stringify(got.reads)}, were ${JSON.stringify(want.reads)}`);
  return d.join('; ');
}

// ── the wide grid: 2 deployments × 3 stages × 18 hosts × 18 paths × 6 methods = 11,664 answers ────
//
// The grid above asks the hosts by their plain names, mostly with GET, in a production deployment.
// This one adds what it lacked (each of these moved an answer once, with the switch "off"):
//
//   · the stand-ins' OWN hostnames, and a host named in CARD_PATH_HOSTS — a stand-in list re-addresses
//     only requests to the names in it, so a grid that never asks them cannot see it run;
//   · a host as a URL may spell it: another case, a port, a trailing dot;
//   · every path under GET, HEAD, POST, PUT, OPTIONS and a method no route knows;
//   · `Host` and `X-Forwarded-Host` headers that contradict the URL (the URL's host is the one read);
//   · paths that try to name another authority;
//   · a deployment that is not production (PREVIEW "true"), where the stand-ins are allowed to run.
//
// It is kept apart from the 714 so their keys and rows stay as they were captured. Its answers repeat
// heavily (most are one of a few refusals), so the fixture keeps each distinct answer once and one
// index per case, in wideCases() order.
export const WIDE_STANDINS = 'service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com';
export const WIDE_PATH_HOST = 'cards-alt.feelreef.com';
export const WIDE_HOSTS = Object.freeze(['reef.cards', 'REEF.CARDS', 'reef.cards.', 'reef.cards:8443', 'card.feelreef.com', 'CARD.FEELREEF.COM:443', 'card.feelreef.com.',
  'cards.feelreef.com', 'cards.feelreef.com.', 'cards.feelreef.com:8443', 'saas.feelreef.com', 'x.workers.dev', WIDE_PATH_HOST,
  'cards-staging.feelreef.com', 'card-staging.feelreef.com', 'staging.reef.cards', 'own.example', 'unbound.example']);
export const WIDE_PATHS = Object.freeze(['/', '/?lang=ja&ref=aster', '/aster', '/aster.md', '/aster/avatar', '/feelreef', '/try/edit', '/try/edit?stay=1', '/try/edit2?lang=ja',
  '/try/park', '/edit?host=https://feelreef.com', '/_api/card/aster', '/_api', `/_preview/${GRID_PREVIEW}`, '/report', '/robots.txt', '//evil.example', '/%2f%2fevil.example']);
export const WIDE_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS', 'PROPFIND']);
export const WIDE_DEPLOYMENTS = Object.freeze({ production: { PREVIEW: 'false' }, preview: { PREVIEW: 'true' } });
const WIDE_HEADERS = Object.freeze({ host: 'attacker.example', 'x-forwarded-host': 'evil.example' });

/** every case of the wide grid, in a fixed order: { key, deployment, stage, host, path, method, init, settings } */
export function wideCases() {
  const out = [];
  for (const deployment of Object.keys(WIDE_DEPLOYMENTS)) for (const stage of Object.keys(GRID_STAGES)) for (const host of WIDE_HOSTS) for (const path of WIDE_PATHS) for (const method of WIDE_METHODS) {
    out.push({
      key: `${deployment} ${stage} ${host} ${method} ${path}`, deployment, stage, host, path, method,
      init: { method, headers: WIDE_HEADERS, ...(method === 'GET' || method === 'HEAD' ? {} : { body: 'x' }) },
      settings: { ...WIDE_DEPLOYMENTS[deployment], CARD_PATH_HOSTS: WIDE_PATH_HOST },
    });
  }
  return out;
}
/** one wide answer: answerOf under the case's deployment settings, with `extra` (the settings under test) over them */
export const wideAnswerOf = (worker, c, extra = {}) => answerOf(worker, c, { ...c.settings, ...extra });

// ── the capture (only when this file is run, never when it is imported) ───────────────────────────
const git = (args, opts = {}) => execFileSync('git', args, { cwd: DIR, timeout: 120000, maxBuffer: 1 << 20, ...opts });

async function capture(ref) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const tmp = fs.mkdtempSync(join(os.tmpdir(), 'service-host-off-'));
  try {
    const top = git(['rev-parse', '--show-toplevel']).toString().trim();
    git(['archive', '--format=tar', '-o', join(tmp, 'tree.tar'), sha, 'packages'], { cwd: top });
    execFileSync('tar', ['-xf', join(tmp, 'tree.tar'), '-C', tmp], { timeout: 120000 });
    const worker = (await import(pathToFileURL(join(tmp, 'packages/cardtile/serve/card-worker.mjs')).href)).default;
    const cases = gridCases();
    const answers = {};
    await atFixedClock(async () => { for (const c of cases) answers[c.key] = await answerOf(worker, c); });
    // headers repeat across cases: each distinct list is written once
    const headerSets = []; const at = new Map();
    const rows = {};
    for (const c of cases) {
      const a = answers[c.key];
      const h = JSON.stringify(a.headers);
      if (!at.has(h)) { at.set(h, headerSets.length); headerSets.push(a.headers); }
      rows[c.key] = [a.status, a.bytes, a.sha, at.get(h), a.reads];
    }
    // the wide grid: each distinct answer once, then one index per case
    const wide = wideCases();
    const wideAnswers = []; const wideAt = new Map(); const wideRows = [];
    await atFixedClock(async () => {
      for (const c of wide) {
        const a = await wideAnswerOf(worker, c);
        const k = JSON.stringify(a);
        if (!wideAt.has(k)) { wideAt.set(k, wideAnswers.length); wideAnswers.push([a.status, a.bytes, a.sha, a.headers, a.reads]); }
        wideRows.push(wideAt.get(k));
      }
    });
    const lines = [
      '{',
      `"about": ${JSON.stringify('GENERATED by gen-service-host-off-fixture.mjs — do not edit. What the cardtile worker answered before the service had a host of its own. Regenerate: node packages/cardtile/serve/gen-service-host-off-fixture.mjs <git ref>')},`,
      `"base": ${JSON.stringify(sha)},`,
      '"row": ["status", "body bytes", "body sha256", "index into headerSets", "store keys read, in order"],',
      '"headerSets": [',
      headerSets.map((h) => JSON.stringify(h)).join(',\n'),
      '],',
      '"answers": {',
      cases.map((c) => `${JSON.stringify(c.key)}: ${JSON.stringify(rows[c.key])}`).join(',\n'),
      '},',
      `"wide": ${JSON.stringify('the wide grid (wideCases(), in order): "wideAnswers" holds each distinct answer once as [status, body bytes, body sha256, headers, store keys read]; "wideRows" holds one index into it per case')},`,
      '"wideAnswers": [',
      wideAnswers.map((a) => JSON.stringify(a)).join(',\n'),
      '],',
      `"wideRows": ${JSON.stringify(wideRows)}`,
      '}',
      '',
    ];
    fs.writeFileSync(FIXTURE_PATH, lines.join('\n'));
    console.log(`service-host-off.fixture.json: ${cases.length} answers of ${sha}, ${headerSets.length} distinct header lists; wide grid ${wideRows.length} answers, ${wideAnswers.length} distinct`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** the committed fixture: { base, answers: key → { status, bytes, sha, headers, reads }, wide: [answer per wideCases() case] } */
export function readFixture(path = FIXTURE_PATH) {
  const f = JSON.parse(fs.readFileSync(path, 'utf8'));
  const answers = Object.fromEntries(Object.entries(f.answers).map(([k, [status, bytes, sha, h, reads]]) => [k, { status, bytes, sha, headers: f.headerSets[h], reads }]));
  const distinct = (f.wideAnswers || []).map(([status, bytes, sha, headers, reads]) => ({ status, bytes, sha, headers, reads }));
  return { base: f.base, answers, wide: (f.wideRows || []).map((i) => distinct[i]) };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const ref = process.argv[2] || git(['merge-base', 'HEAD', 'origin/main']).toString().trim();
  await capture(ref);
}
