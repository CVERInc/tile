// tile#339 step 1 measurement — what one picture request, and one cold visit's worth of them, costs the
// cardtile worker with and without the picture route's own cache (packages/cardtile/serve/picture-cache.mjs).
//
//   node picture-cost.mjs <fixtures dir> [runs=15] [out.json] [repo root=this checkout] [strategy=hybrid-preload-lazy]
//
// `repo root` lets the same script time another checkout of the cardtile worker (the commit before the
// cache), so "before" and "after" are measured by one harness in one sitting.
//
// In-process (worker.fetch, no network), host CPU unthrottled. Per request it records wall time
// (performance.now) and process CPU (process.cpuUsage, user + system); background work the worker hands
// to ctx.waitUntil is awaited INSIDE the timed span, so a page view is charged for keeping its pictures.
// Arms, each on an empty cache per run:
//   no-cache      caches.default absent: every picture found in the whole file (the route before the cache)
//   cold-direct   the pictures asked for with no page view first: each is a miss, found in the file, kept
//   cold-visit    one page view (which keeps the pictures it names), then the pictures: the visitor's order
//   warm          the pictures again
//
// 🔴 What these numbers are not. The store and the cache are in-memory stand-ins that answer at once:
// the time a real store takes to return a ~10 MB body, and a real cache takes to return a picture, are
// not here. The stand-in cache also never evicts and has one "data center". So this measures the CPU
// the worker itself spends, and counts the store reads it makes — the two things the cache changes.
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const [fixtures, runsArg, jsonOut, rootArg, strategyArg] = process.argv.slice(2);
const RUNS = Number(runsArg || 15);
const ROOT = resolve(rootArg || join(here, '../../..'));
const STRATEGY = strategyArg || 'hybrid-preload-lazy';
const CANON = 'card.feelreef.com';
const worker = (await import(pathToFileURL(join(ROOT, 'packages/cardtile/serve/card-worker.mjs')).href)).default;

const files = new Map();
for (const f of fs.readdirSync(fixtures)) {
  const m = /^(.+)\.card\.md$/.exec(f);
  if (m) files.set(m[1], fs.readFileSync(join(fixtures, f), 'utf8'));
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r1 = (x) => +x.toFixed(2);

/** a store that answers at once and counts what was read */
const storeOf = () => {
  const read = { keys: 0, bodies: 0, bodyBytes: 0 };
  return {
    read,
    async get(k) { read.keys++; const v = files.get(k) ?? null; if (v != null) { read.bodies++; read.bodyBytes += v.length; } return v; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
  };
};
/** a cache that keeps bytes under the key's URL: no expiry, no eviction, one data center */
const cacheOf = () => {
  const kept = new Map();
  const n = { match: 0, hit: 0, put: 0 };
  return {
    n, kept,
    async match(req) { n.match++; const e = kept.get(req.url); if (!e) return undefined; n.hit++; return new Response(e.body, { headers: e.headers }); },
    async put(req, res) { n.put++; kept.set(req.url, { body: new Uint8Array(await res.arrayBuffer()), headers: [...res.headers] }); },
  };
};
async function timed(env, path) {
  const waiting = [];
  const c0 = process.cpuUsage(), t0 = performance.now();
  const res = await worker.fetch(new Request(`https://${CANON}${path}`), env, { waitUntil: (p) => waiting.push(p) });
  const body = Buffer.from(await res.arrayBuffer());
  await Promise.all(waiting);
  const ms = performance.now() - t0, c = process.cpuUsage(c0);
  return { ms, cpu: (c.user + c.system) / 1000, status: res.status, body };
}

const rows = [];
for (const handle of [...files.keys()].sort()) {
  const arms = { 'no-cache': [], 'cold-direct': [], 'cold-visit': [], warm: [] };
  let urls = null;
  for (let run = 0; run < RUNS; run++) {
    for (const arm of ['no-cache', 'cold-direct', 'cold-visit']) {
      const store = storeOf();
      const cache = arm === 'no-cache' ? null : cacheOf();
      globalThis.caches = cache ? { default: cache } : undefined;
      const env = { PREVIEW: 'false', CARDTILE_PICTURES: STRATEGY, CARDS: store };
      if (!urls) {
        const html = (await timed(env, `/${handle}`)).body.toString('utf8');
        urls = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+\/a\/[0-9a-f]{64}\.[a-z]+)"/g)].map((m) => m[1]))];
        if (cache) { cache.kept.clear(); cache.n.match = cache.n.hit = cache.n.put = 0; }
        store.read.keys = store.read.bodies = store.read.bodyBytes = 0;
      }
      const page = arm === 'cold-direct' ? null : await timed(env, `/${handle}`);
      const afterPage = { ...store.read };
      const pics = [];
      for (const u of urls) {
        const r = await timed(env, u);
        if (r.status !== 200) throw new Error(`${arm} ${u} → ${r.status}`);
        pics.push(r);
      }
      arms[arm].push({ page, pics, bodies: store.read.bodies - (page ? afterPage.bodies : 0), bodyBytes: store.read.bodyBytes - (page ? afterPage.bodyBytes : 0), keys: store.read.keys - (page ? afterPage.keys : 0), cache: cache ? { ...cache.n } : null });
      if (arm === 'cold-visit') {
        const before = { ...store.read }, n0 = { ...cache.n };
        const again = [];
        for (const u of urls) again.push(await timed(env, u));
        arms.warm.push({ page: null, pics: again, bodies: store.read.bodies - before.bodies, bodyBytes: store.read.bodyBytes - before.bodyBytes, keys: store.read.keys - before.keys, cache: { match: cache.n.match - n0.match, hit: cache.n.hit - n0.hit, put: cache.n.put - n0.put } });
      }
    }
  }
  globalThis.caches = undefined;
  for (const [arm, runs] of Object.entries(arms)) {
    const per = runs.flatMap((r) => r.pics);
    const row = {
      handle, strategy: STRATEGY, arm, runs: runs.length, pictures: urls.length,
      pictureCpuMsMedian: r1(median(per.map((p) => p.cpu))), pictureWallMsMedian: r1(median(per.map((p) => p.ms))),
      pictureCpuMsMax: r1(Math.max(...per.map((p) => p.cpu))),
      visitPicturesCpuMsMedian: r1(median(runs.map((r) => sum(r.pics.map((p) => p.cpu))))),
      visitPicturesWallMsMedian: r1(median(runs.map((r) => sum(r.pics.map((p) => p.ms))))),
      pageCpuMsMedian: runs[0].page ? r1(median(runs.map((r) => r.page.cpu))) : null,
      pageWallMsMedian: runs[0].page ? r1(median(runs.map((r) => r.page.ms))) : null,
      storeBodyReadsForPictures: runs[0].bodies, storeBodyBytesForPictures: runs[0].bodyBytes, storeKeyReadsForPictures: runs[0].keys,
      cacheCalls: runs[0].cache,
    };
    rows.push(row);
    console.log(`${handle.padEnd(16)} ${arm.padEnd(12)} pics=${row.pictures} picture cpu=${row.pictureCpuMsMedian}ms wall=${row.pictureWallMsMedian}ms (max cpu ${row.pictureCpuMsMax}) | visit pictures cpu=${row.visitPicturesCpuMsMedian}ms wall=${row.visitPicturesWallMsMedian}ms | page cpu=${row.pageCpuMsMedian} | body reads=${row.storeBodyReadsForPictures} (${row.storeBodyBytesForPictures} chars) cache=${JSON.stringify(row.cacheCalls)}`);
  }
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    node: process.version, runs: RUNS, strategy: STRATEGY, load1AtEnd: os.loadavg()[0], rows,
  }, null, 1));
}
