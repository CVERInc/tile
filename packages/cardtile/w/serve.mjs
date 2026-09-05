// Static server rooted at the REPO, because cardtile-w imports across packages (card-core reaches
// tugtile-w/board-core and sitetile/site-core, card-render reaches cssmd). Serving the w/ directory
// alone would 404 every one of those and the editor would look broken for a reason that is not.
//
//   node packages/cardtile/w/serve.mjs [port]     → http://127.0.0.1:8787/packages/cardtile/w/
import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { parseCard, serializeCard } from '../card-core.js';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../..'));
const PORT = Number(process.argv[2]) || 8787;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

// 🔴 The canvas is the SERVED document, so it asks for the things a served card asks for: the QR
// coral at /_coral/…, brand marks at /_icon/…, video posters at /_yt/…. An srcdoc iframe resolves
// those against THIS origin. Without them the editor shows a card with no QR behaviour and no brand
// marks — a preview that is missing exactly the parts hardest to picture from markdown, while
// looking like it rendered fine. So those paths go to the Worker's own handler; it is the same code
// the edge runs, and this is the one place in the editor where a network fetch happens.
// 🔴 …and `/try/*`, which is how the PUBLIC sandbox is reachable locally at all. `/try/edit` is
// composed by the Worker out of a bundled asset (gen-edit2-assets.mjs), so serving this repo's
// files cannot produce it — its editing table is the ENGINE's web tugtile, which the Worker serves
// from that bundle because the engine's own copy is missing its generated `board-core.js`. The
// retired `/try/edit2` path answers here too (as the same 301 the edge gives), for the same reason.
// Without this line the only way to look at the sandbox is to deploy it, which is the shape of
// every bug that gets found by a customer.
const worker = (await import('../serve/card-worker.mjs')).default;
const EDGE = /^\/(_coral|_icon|_yt|try)\//;

// 🔴 …and the card exits themselves (`/<handle>.md`, and Accept: text/markdown), backed by the repo
// fixtures. Without this the editor's `?handle=` 404s in local dev, which is how the ORIGINAL bug
// went unnoticed: it was only ever exercised against a live host that answered 200 with HTML.
// A dev server that cannot reproduce the production request is a dev server that hides bugs.
// 🩸 Was a literal Set of three creators' handles. Two problems in one line: the dev server carried
// a list of whose cards we have, and when those cards left the package on 2026-08-12 every fixture
// route started throwing ENOENT — which is how the editor harness came to be BROKEN rather than red.
// Ask the directory instead. It cannot go stale, and it names nobody.
const CARD_FIXTURES = new Set(
  (await import('node:fs')).readdirSync(new URL('../cards/specimens/', import.meta.url))
    .filter((f) => f.endsWith('.card.md')).map((f) => f.replace(/\.card\.md$/, '')),
);
if (!CARD_FIXTURES.size) throw new Error('no specimens in cards/specimens — the dev server has nothing to serve');
const FIXTURE_STORE = {
  get: async (h) => {
    if (!CARD_FIXTURES.has(h)) return null;
    const { readCard } = await import('../verify/paths.mjs');
    return readCard(h);
  },
};
const isCardPath = (p) => {
  const seg = p.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  return CARD_FIXTURES.has(seg.replace(/\.md$/, ''));
};

// ── the authenticated bridge ─────────────────────────────────────────────────────────────────────
//
// 🔴 THE CREDENTIAL NEVER REACHES THE BROWSER. The editor is a page; a page that held an
// infrastructure bearer would leak it to every extension, every devtools screenshot and every
// copy-pasted URL. So the browser talks to THIS process on 127.0.0.1, and this process — which
// already runs on the machine that has the Keychain — is the only thing that ever sees the token.
//
// 🔴 It is also why the assembly happens here rather than in the page. Deciding which images are new
// needs the parser, and the parser is already imported at the top of this file for the fixtures.
const CARD_API = process.env.CARD_API_BASE || 'https://card.feelreef.com';

let cachedToken;
function cardToken() {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = process.env.CARD_API_TOKEN || null;
  if (!cachedToken) {
    try {
      cachedToken = execFileSync('security', ['find-generic-password', '-s', 'cardtile-mcp-token', '-w'], { encoding: 'utf8' }).trim() || null;
    } catch {
      // 🔴 The caught error is discarded, not logged. `security`'s output on failure is not sensitive
      // today, but this is the one code path whose job is handling a secret, and a habit of printing
      // what went wrong here is the habit that eventually prints the secret.
      cachedToken = null;
    }
  }
  return cachedToken;
}

async function api(method, path, body) {
  const token = cardToken();
  const r = await fetch(CARD_API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), 'cache-control': 'no-cache' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the raw body is the finding */ }
  return { status: r.status, json };
}

/**
 * Save the editor's card.
 *
 * The page hands over the WHOLE markdown it is holding — the fat card, pictures and all, because
 * that is what the editor edits. Three steps here, in this order:
 *
 *   1. read the stored card, for its version and its asset manifest;
 *   2. upload any image the editor has that the store does not (put_asset), so an image dragged in
 *      locally survives — without this the save silently drops it, since save_card takes its assets
 *      from the STORE by design;
 *   3. save the THIN card, guarded by the version read in step 1.
 *
 * 🔴 Step 2 before step 3, not after. A save that referenced an image not yet uploaded would render
 * as a blank box on a live page for as long as the gap lasted.
 */
async function saveCard(handle, fatMd, baseVersion) {
  const model = parseCard(fatMd);
  const current = await api('GET', `/_api/card/${encodeURIComponent(handle)}`);
  if (current.status !== 200) return current;

  // 🔴 The lock is checked HERE, before anything is written. The first version of this function
  // checked it after the upload loop and skipped the check entirely when an upload had happened —
  // which is exactly backwards: an upload is a WRITE, so a stale editor would have modified the
  // card before discovering it was not allowed to. Nothing is written until this passes.
  if (baseVersion && current.json.version !== baseVersion) {
    return { status: 409, json: { conflict: true, expected: baseVersion, current: current.json.version, why: 'This card changed after you opened it. Re-open it, redo your change, and save again.' } };
  }

  const have = new Set((current.json.assets || []).map((a) => a.id));
  const uploaded = [];
  for (const [id, a] of Object.entries(model.assets || {})) {
    if (have.has(id)) continue;
    const up = await api('PUT', `/_api/card/${encodeURIComponent(handle)}/asset/${encodeURIComponent(id)}`, { base64: a.b64, mime: a.mime });
    if (up.status !== 200) return up;
    uploaded.push(id);
  }

  const thin = serializeCard({ ...model, assets: {} });
  // 🔴 The version passed to save_card is the one read AFTER the uploads, not the page's. An upload
  // changes the card, so the page's version is stale by construction the moment step 2 does
  // anything — passing it would make every save-with-a-new-image a conflict with ourselves. The
  // page's version was already honoured, above, before a single byte was written.
  const after = uploaded.length ? await api('GET', `/_api/card/${encodeURIComponent(handle)}`) : current;
  const res = await api('PUT', `/_api/card/${encodeURIComponent(handle)}`, { markdown: thin, base_version: after.json.version });
  if (res.status === 200) res.json.uploaded = uploaded;
  return res;
}

/** The `/_w/` bridge. Returns true when it handled the request. */
async function bridge(req, res, path) {
  if (!path.startsWith('/_w/')) return false;
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  // Can this machine save at all? The editor asks BEFORE showing a save button, because a button
  // that appears and then fails is worse than one that explains why it is not there.
  if (path === '/_w/can-save') return send(200, { canSave: !!cardToken(), api: CARD_API }), true;

  if (!cardToken()) return send(503, { error: '這台機器沒有 cardtile-mcp-token,存不到線上。' }), true;

  const m = /^\/_w\/card\/([a-z0-9][a-z0-9-]{0,62})$/.exec(path);
  if (m && req.method === 'GET') {
    // version + manifest from the API; the FAT bytes from the public exit, because an editor needs
    // the pictures and that exit needs no credential.
    const meta = await api('GET', `/_api/card/${m[1]}`);
    if (meta.status !== 200) return send(meta.status, meta.json || { error: 'not found' }), true;
    const fat = await fetch(`${CARD_API}/${m[1]}.md`, { headers: { 'cache-control': 'no-cache' } });
    if (!fat.ok) return send(502, { error: 'the card exists but its .md exit did not answer' }), true;
    return send(200, { handle: m[1], version: meta.json.version, md: await fat.text() }), true;
  }
  if (m && req.method === 'PUT') {
    const body = await new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
    });
    if (typeof body.md !== 'string' || !body.md) return send(400, { error: 'no markdown' }), true;
    const out = await saveCard(m[1], body.md, body.base_version);
    return send(out.status, out.json || { error: 'the card service gave no answer' }), true;
  }
  return send(404, { error: 'no such bridge route' }), true;
}

export function createServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    try {
      if (await bridge(req, res, path)) return;
    } catch (e) {
      // 🔴 `e.message` is NOT forwarded. A fetch failure's message can embed the request, and the
      // request carries the bearer. The operation is what the page needs to know.
      res.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"the card service could not be reached"}');
      return;
    }
    if (EDGE.test(path) || isCardPath(path)) {
      try {
        const r = await worker.fetch(
          new Request('https://card.feelreef.com' + req.url, { headers: req.headers }),
          { CARDS: FIXTURE_STORE, PREVIEW: 'true' });
        const body = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(body);
      } catch (e) { res.writeHead(502).end('edge: ' + e.message); }
      return;
    }
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    // 🔴 Resolve, then check the result is still under the root. A `..` check on the raw string is
    // the version that misses `%2e%2e` — and this serves a whole repo.
    const full = normalize(join(root, p));
    if (!full.startsWith(root)) { res.writeHead(403).end('no'); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`cardtile-w → http://127.0.0.1:${PORT}/packages/cardtile/w/`);
  });
}
