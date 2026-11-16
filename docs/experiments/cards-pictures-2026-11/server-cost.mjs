// tile#339 measurement — what each picture strategy costs the cardtile worker, and what it writes.
//
//   node server-cost.mjs <fixtures dir> [runs=15] [out.json]
//
// Calls worker.fetch in-process (no network, the host's CPU unthrottled) for each specimen page and,
// for the by-URL strategies, for every picture the page names. Reports the page's bytes, how many
// pictures it carries inline and by URL, and the worker's median wall time per page and per picture.
// The store stub answers instantly; a real store read of the whole file (the picture route reads the
// file on every picture request) is NOT in these numbers and is called out in the report.
import { performance } from 'node:perf_hooks';
import { loadCards, envFor, CANON } from './serve.mjs';
import worker from '../../../packages/cardtile/serve/card-worker.mjs';
import { PICTURE_STRATEGIES } from '../../../packages/cardtile/serve/asset-urls.mjs';

const [fixtures, runsArg, jsonOut] = process.argv.slice(2);
const RUNS = Number(runsArg || 15);
const cards = loadCards(fixtures);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const get = async (env, path) => {
  const t = performance.now();
  const res = await worker.fetch(new Request(`https://${CANON}${path}`), env, { waitUntil() {} });
  const body = Buffer.from(await res.arrayBuffer());
  return { ms: performance.now() - t, res, body };
};

const rows = [];
for (const handle of [...cards.keys()].sort()) {
  for (const strategy of PICTURE_STRATEGIES) {
    const env = envFor(cards, strategy);
    const first = await get(env, `/${handle}`);
    const html = first.body.toString('utf8');
    const urls = [...new Set([...html.matchAll(/src="(\/[^"]+\/a\/[0-9a-f]{64}\.[a-z]+)"/g)].map((m) => m[1]))];
    const pageMs = [];
    for (let i = 0; i < RUNS; i++) pageMs.push((await get(env, `/${handle}`)).ms);
    const picMs = [];
    let picHeaders = null;
    for (const u of urls) {
      const r = await get(env, u);
      picHeaders = picHeaders || Object.fromEntries(r.res.headers);
      if (r.res.status !== 200) throw new Error(`${strategy} ${u} → ${r.res.status}`);
      picMs.push(r.ms);
    }
    rows.push({
      handle, strategy, status: first.res.status, htmlBytes: first.body.length,
      inline: (html.match(/src="data:image\//g) || []).length, byUrl: urls.length,
      preloads: (html.match(/rel="preload" as="image"/g) || []).length,
      pageMsMedian: +median(pageMs).toFixed(1), pictureMsMedian: picMs.length ? +median(picMs).toFixed(1) : null,
      pictureMsTotal: picMs.length ? +picMs.reduce((a, b) => a + b, 0).toFixed(1) : null,
      pageCacheControl: first.res.headers.get('cache-control'), pictureHeaders: picHeaders,
    });
    const r = rows.at(-1);
    console.log(`${handle.padEnd(16)} ${strategy.padEnd(27)} ${r.status} html=${String(r.htmlBytes).padStart(9)} inline=${r.inline} byUrl=${r.byUrl} preload=${r.preloads} page=${r.pageMsMedian}ms picture=${r.pictureMsMedian}ms (sum ${r.pictureMsTotal})`);
  }
}
if (jsonOut) (await import('node:fs')).writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
