// tile#339 measurement — the cardtile worker, in-process, behind a local HTTP/2 + TLS front.
//
// One origin (port) per picture strategy, each with the worker's local switch set (`CARDTILE_PICTURES`),
// a stub store holding the specimen files, and nothing else. Why each piece:
//   · the REAL worker, so headers (`Cache-Control: public, max-age=60` on the page, `immutable` +
//     `nosniff` on a picture) and markup are what the worker writes, not an imitation of them;
//   · HTTP/2 over TLS, because that is how a visitor reaches the cardtile worker, and Chromium speaks
//     HTTP/2 only over TLS. Over HTTP/1.1 Chromium opens six connections per origin, and 36 picture
//     requests would queue in six lanes behind the emulated round trip: a cost production does not have;
//   · every response memoised after its first answer (an edge that has it at hand), so what the browser
//     measures is the page, not this machine rendering 10 MB while the browser is being timed. What
//     the worker itself costs per request is measured separately (server-cost.mjs);
//   · `elementtiming="pic"` added to every picture `<img>` of every strategy alike (about 20 bytes
//     each), so the browser reports when each picture was painted;
//   · `/_icon/*` (favicon relays for the made-up links) answered 404 here, so no run touches the internet.
//
//   node serve.mjs <fixtures dir> <cert.pem> <key.pem> [port base=9400]   — serve until killed
import http2 from 'node:http2';
import fs from 'node:fs';
import { join } from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import worker from '../../../packages/cardtile/serve/card-worker.mjs';
import { PICTURE_STRATEGIES } from '../../../packages/cardtile/serve/asset-urls.mjs';

export const CANON = 'card.feelreef.com';

/** the store the worker reads: every `<handle>.card.md` in `dir` */
export function loadCards(dir) {
  const cards = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = /^(.+)\.card\.md$/.exec(f);
    if (m) cards.set(m[1], fs.readFileSync(join(dir, f), 'utf8'));
  }
  return cards;
}
export const envFor = (cards, strategy) => ({
  PREVIEW: 'false',
  CARDTILE_PICTURES: strategy,
  CARDS: {
    get: async (k) => cards.get(k) ?? null,
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
  },
});
/** the SPKI pin Chromium is told to trust (`--ignore-certificate-errors-spki-list`) */
export const spkiOf = (certPem) => createHash('sha256')
  .update(new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');

const markPictures = (html) => html.replace(/<img class="(st-gal-img|cp-icon)"/g, '<img elementtiming="pic" class="$1"');

export async function startServers({ fixtures, cert, key, portBase = 9400, strategies = PICTURE_STRATEGIES }) {
  const cards = loadCards(fixtures);
  const out = [];
  for (const [i, strategy] of strategies.entries()) {
    const env = envFor(cards, strategy);
    const memo = new Map();
    const answer = async (path, headers) => {
      if (memo.has(path)) return memo.get(path);
      let r;
      if (path.startsWith('/_icon/')) {
        r = { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=86400' }, body: Buffer.alloc(0) };
      } else {
        const res = await worker.fetch(new Request(`https://${CANON}${path}`, { headers: { accept: headers.accept || '*/*' } }), env, { waitUntil() {} });
        const h = {};
        res.headers.forEach((v, k) => { if (!['connection', 'transfer-encoding', 'keep-alive'].includes(k)) h[k] = v; });
        let body = Buffer.from(await res.arrayBuffer());
        if ((h['content-type'] || '').startsWith('text/html')) body = Buffer.from(markPictures(body.toString('utf8')));
        r = { status: res.status, headers: h, body };
      }
      memo.set(path, r);
      return r;
    };
    const server = http2.createSecureServer({ cert, key }, async (req, res) => {
      try {
        const r = await answer(req.url, req.headers);
        res.writeHead(r.status, { ...r.headers, 'content-length': String(r.body.length) });
        res.end(r.body);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(e && e.stack));
      }
    });
    await new Promise((ok) => server.listen(portBase + i, '127.0.0.1', ok));
    out.push({ strategy, origin: `https://localhost:${portBase + i}`, server, memo });
  }
  return { servers: out, close: () => Promise.all(out.map((s) => new Promise((ok) => s.server.close(ok)))) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [fixtures, certFile, keyFile, base] = process.argv.slice(2);
  const { servers } = await startServers({ fixtures, cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), portBase: Number(base || 9400) });
  for (const s of servers) console.log(s.strategy.padEnd(28), s.origin);
}
