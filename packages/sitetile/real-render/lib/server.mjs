// server — one 127.0.0.1 HTTP server per site arm. Serves:
//   <real state path>?…&__state=<id>  → that state's Worker-composed HTML (status preserved)
//   /api/v2/shop/checkout/outcome     → deterministic completion outcome keyed by ref
//                                        (paid | pending | canceled; anything else → 404 unknown)
//   /api/v2/shop/catalog              → the provider catalog the PUBLISHED widget reads when it
//                                        mounts with no server-rendered grid to hydrate
//   POST /api/cart/items → 200; POST /api/checkout → 409 checkout_attempt_conflict (native conflict)
//   /seam/island.js                   → empty module (the site-runtime island is NOT run; fixtures
//                                        instead)
//   /dc/square-shop.js                → this checkout's published coral artifact, byte for byte
//   /harness-media/wide.svg           → 2400×1600 SVG (media-escape probe)
//   anything else                     → the built site's static files (real site.css / theme)
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PROVIDER_ITEMS } from './states.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml' };
const WIDE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600" viewBox="0 0 2400 1600"><rect width="2400" height="1600" fill="#9ab"/><text x="60" y="200" font-size="160">2400×1600</text></svg>';

/** Where the published coral artifact is served from. The widget is fetched over HTTP in
 *  production too (the registry channel), so serving it rather than inlining it keeps the one
 *  thing being measured — the CSS text the artifact injects — coming out of the real file. */
export const CORAL_ARTIFACT_PATH = '/dc/square-shop.js';

export const OUTCOMES = {
  paid: { ok: true, state: 'paid', currency: 'USD', total_minor: 6100, order_ref: 'ORD-HARNESS-1', lines: [{ name: 'Reef Tee', qty: 1, amount_minor: 1900 }, { name: 'Box kite', qty: 1, amount_minor: 4200 }] },
  pending: { ok: true, state: 'pending' },
  canceled: { ok: true, state: 'canceled' },
};

export function startServer({ dist, composedDir, composed, coralArtifact }) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
    const stateId = u.searchParams.get('__state');
    if (stateId && composed[stateId]) {
      return send(composed[stateId].status, 'text/html; charset=utf-8', readFileSync(path.join(composedDir, `${stateId}.html`)));
    }
    if (u.pathname === '/api/v2/shop/checkout/outcome') {
      const o = OUTCOMES[u.searchParams.get('ref')];
      return o ? send(200, 'application/json', JSON.stringify(o)) : send(404, 'application/json', JSON.stringify({ ok: false, error: 'not_found' }));
    }
    // `connected: true` is required, not decoration: the widget treats anything else as "no shop
    // connected yet" and renders a one-line notice instead of a grid.
    if (u.pathname === '/api/v2/shop/catalog') return send(200, 'application/json', JSON.stringify({ connected: true, items: PROVIDER_ITEMS }));
    if (u.pathname === '/api/cart/items' && req.method === 'POST') return send(200, 'application/json', '{"ok":true}');
    if (u.pathname === '/api/checkout' && req.method === 'POST') return send(409, 'application/json', '{"error":"checkout_attempt_conflict"}');
    if (u.pathname === '/seam/island.js') return send(200, 'text/javascript', 'export {};');
    if (u.pathname === CORAL_ARTIFACT_PATH) {
      if (!coralArtifact || !existsSync(coralArtifact)) return send(404, 'text/plain', 'coral artifact not found');
      return send(200, 'text/javascript', readFileSync(coralArtifact));
    }
    if (u.pathname === '/harness-media/wide.svg') return send(200, 'image/svg+xml', WIDE_SVG);
    let p = decodeURIComponent(u.pathname);
    const candidates = p.endsWith('/') ? [p + 'index.html'] : [p, p + '/index.html'];
    for (const c of candidates) {
      const f = path.join(dist, c);
      if (f.startsWith(dist) && existsSync(f) && statSync(f).isFile()) return send(200, TYPES[path.extname(f)] || 'application/octet-stream', readFileSync(f));
    }
    return send(404, 'text/plain', 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}
