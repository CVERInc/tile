// Step 3 of the "Every number" work: the page view past the size tier, served in windows (serve/size-tier.mjs).
// One request per process; prints one JSON line. Uses the step-1 harness (harness.mjs, sample.mjs).
//
//   node --expose-gc step3.mjs plan <source>                 the revision and the number of windows (not timed)
//   node --expose-gc step3.mjs window <source> <n> <rev>     GET /<handle>?w=<n>&r=<rev> (n = 1: GET /<handle>)
//   node --expose-gc step3.mjs md <source>                   GET /<handle>.md
//   node --expose-gc step3.mjs icon <source>                 GET /<handle>/favicon.svg
//
// <source>: a file path (the 25 MiB sample), `page-<K>` (the sample's first K tiles), or `links-<K>` (K link
// tiles, w=2, the costliest tile measured per tile in step 2).
// "first byte" is the time until worker.fetch resolves with a Response: every exit answers with a body that is
// already whole, so no byte can leave before that.
import { readFileSync } from 'node:fs';
import { cardKey } from '../../serve/card-api.mjs';
import worker from '../../serve/card-worker.mjs';
import { scanCard, windowsOf, deckFront, revisionOf } from '../../serve/size-tier.mjs';
import { fakeKv, noNetwork } from './harness.mjs';

const [stage, source, nArg, revArg] = process.argv.slice(2);
const HANDLE = 'every-number';
const ORIGIN = 'https://card.feelreef.com';
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const tried = noNetwork();

let md;
if (/^page-\d+$/.test(source)) {
  const { pieces } = await import('./sample.mjs');
  md = [...pieces(Number(source.slice(5)) - 1)].join('');
} else if (/^links-\d+$/.test(source)) {
  const K = Number(source.slice(6));
  md = ['---', 'title: Links', '---', '', '## grid', '', '- [ ] %% card: profile %% Links.',
    ...Array.from({ length: K - 1 }, (_, i) => `- [ ] %% card: link w=2 %% [Link ${i}](https://example${i % 50}.com/p/${i})`), ''].join('\n');
} else md = readFileSync(source, 'utf8');
const out = { stage, source: /^(page|links)-/.test(source) ? source : 'sample', mdBytes: Buffer.byteLength(md), mdUnits: md.length };

if (stage === 'plan') {
  const idx = scanCard(md);
  const plan = windowsOf(md, idx, { front: deckFront(md) });
  console.log(JSON.stringify({ ...out, rev: await revisionOf(md), windows: plan.count, face: idx.face, back: idx.back }));
  process.exit(0);
}

const env = { CARDS: fakeKv({ [cardKey(HANDLE, '0')]: md }), PREVIEW: 'false' };
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function get(p) {
  if (globalThis.gc) globalThis.gc();
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const r = await worker.fetch(new Request(`${ORIGIN}${p}`), env, ctx);
  const firstByteMs = performance.now() - t0;
  const text = await r.text();
  const c = process.cpuUsage(c0);
  return { path: p, status: r.status, location: r.headers.get('location'), robots: r.headers.get('x-robots-tag'), bytes: Buffer.byteLength(text),
    firstByteMs: Math.round(firstByteMs), cpuMs: Math.round((c.user + c.system) / 1000),
    tiles: (text.match(/class="st-cell[ "]/g) || []).length, rev: /<html[^>]* data-card-rev="([^"]*)"/.exec(text)?.[1] ?? null };
}

if (stage === 'window') {
  const n = Number(nArg);
  out.window = n;
  out.res = await get(n === 1 ? `/${HANDLE}` : `/${HANDLE}?w=${n}&r=${revArg}`);
} else if (stage === 'md') out.res = await get(`/${HANDLE}.md`);
else if (stage === 'icon') out.res = await get(`/${HANDLE}/favicon.svg`);
else { console.error(`unknown stage ${stage}`); process.exit(2); }

out.peakRssMB = MB(process.resourceUsage().maxRSS * 1024);
out.networkAttempts = tried.length;
console.log(JSON.stringify(out));
