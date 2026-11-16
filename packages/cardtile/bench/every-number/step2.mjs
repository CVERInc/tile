// Step 2 of the "Every number" work: the page view's exits measured before and after the size tier.
// One request per process; prints one JSON line. Uses the step-1 harness (harness.mjs, sample.mjs).
//
//   node --expose-gc step2.mjs page <sample.md>     GET /<handle>
//   node --expose-gc step2.mjs page-<K>             GET /<handle> on the sample's first K tiles
//   node --expose-gc step2.mjs md <sample.md>       GET /<handle>.md
//   node --expose-gc step2.mjs accept-md <sample.md> GET /<handle> with Accept: text/markdown
//   node --expose-gc step2.mjs deck <sample.md>     the page the worker serves, then w3/deck.js over it
//                                                   in w3/mini-dom.mjs with the file it names (data-card-src)
//
// "first byte" is the time until worker.fetch resolves with a Response: every exit here answers with
// a body that is already whole (a string), so no byte can leave before that. "body" is the time until
// the body is read to the end.
import { readFileSync } from 'node:fs';
import { cardKey } from '../../serve/card-api.mjs';
import worker from '../../serve/card-worker.mjs';
import { fakeKv, noNetwork } from './harness.mjs';

const [stage, path] = process.argv.slice(2);
const HANDLE = 'every-number';
const ORIGIN = 'https://card.feelreef.com';
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const tried = noNetwork();

let md;
if (/^page-\d+$/.test(stage)) {
  const { pieces } = await import('./sample.mjs');
  md = [...pieces(Number(stage.slice(5)) - 1)].join('');
} else if (/^links-\d+$/.test(stage)) {
  // K link tiles on a profile, three to a row: a costlier tile than the sample's one-line text
  // (a link resolves its mark, its address is checked, it is drawn in a run or a grid)
  const K = Number(stage.slice(6));
  md = ['---', 'title: Links', '---', '', '## grid', '', '- [ ] %% card: profile %% Links.',
    ...Array.from({ length: K - 1 }, (_, i) => `- [ ] %% card: link w=2 %% [Link ${i}](https://example${i % 50}.com/p/${i})`), ''].join('\n');
} else md = readFileSync(path, 'utf8');
const env = { CARDS: fakeKv({ [cardKey(HANDLE, '0')]: md }), PREVIEW: 'false' };
const out = { stage, mdBytes: Buffer.byteLength(md), mdUnits: md.length };
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function get(p, headers = {}) {
  if (globalThis.gc) globalThis.gc();
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const r = await worker.fetch(new Request(`${ORIGIN}${p}`, { headers }), env, ctx);
  const firstByteMs = performance.now() - t0;
  const text = await r.text();
  const bodyMs = performance.now() - t0;
  const c = process.cpuUsage(c0);
  return {
    res: { path: p, status: r.status, type: r.headers.get('content-type'), robots: r.headers.get('x-robots-tag'),
      bytes: Buffer.byteLength(text), firstByteMs: Math.round(firstByteMs), bodyMs: Math.round(bodyMs),
      cpuMs: Math.round((c.user + c.system) / 1000), cardSrc: /<html[^>]* data-card-src="([^"]*)"/.exec(text)?.[1] ?? null },
    text,
  };
}

if (stage === 'page' || stage.startsWith('page-') || stage.startsWith('links-')) {
  out.page = (await get(`/${HANDLE}`)).res;
} else if (stage === 'md') {
  out.md = (await get(`/${HANDLE}.md`)).res;
} else if (stage === 'accept-md') {
  out.acceptMd = (await get(`/${HANDLE}`, { accept: 'text/markdown' })).res;
} else if (stage === 'deck') {
  const { res, text } = await get(`/${HANDLE}`);
  out.page = res;
  const { makeWindow } = await import('../../w3/mini-dom.mjs');
  const DECK_JS = readFileSync(new URL('../../w3/deck.js', import.meta.url), 'utf8');
  const win = makeWindow(text, { scripts: true });
  const doc = win.document;
  const errors = [];
  win.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ').slice(0, 300)) };
  doc.scrollHeightOf = () => win.innerHeight * 10;
  doc.rectOf = () => ({ top: 0, left: 0, width: 342, height: 480 });
  // the browser's fetch of data-card-src, answered by the same worker (the file as it is served)
  win.fetch = async (u) => { const r = await worker.fetch(new Request(new URL(u, `${ORIGIN}/${HANDLE}`)), env, ctx); return { ok: r.ok, status: r.status, text: () => r.text() }; };
  const elementsBefore = doc.querySelectorAll('*').length;
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  win.run(DECK_JS, 'deck.js');
  for (let i = 0; i < 50 && win.__deckBoot === 'pending'; i++) await new Promise((r) => setImmediate(r));
  win.tick(3000);
  const c = process.cpuUsage(c0);
  out.deck = { wallMs: Math.round(performance.now() - t0), cpuMs: Math.round((c.user + c.system) / 1000), boot: win.__deckBoot,
    items: win.__mdCount ?? null, view: doc.documentElement.dataset.view, elementsBefore, elementsAfter: doc.querySelectorAll('*').length, errors };
} else { console.error(`unknown stage ${stage}`); process.exit(2); }

out.peakRssMB = MB(process.resourceUsage().maxRSS * 1024);
out.networkAttempts = tried.length;
console.log(JSON.stringify(out));
