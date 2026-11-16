// One measurement of the "Every number" sample on one path of the cardtile engine, in this process.
// Prints one JSON line. run-all.sh runs each stage in its own capped child process.
//
//   node --expose-gc measure.mjs <stage> <sample.md>
//
// stages:
//   limits     the byte checks the save path makes, and how the sample compares with each
//   parse      parseCard on the whole file
//   roundtrip  parse → serialize, assembleSave, thinCard: does the file survive a save byte-exact
//   render     renderCardHTML as the page view calls it: time, bytes out, where the first tile lands
//   editor     what edit3 runs on load that is not DOM: parseCard, the layout render, the preview render
//   save-parts each step save_cards runs on the body, timed alone
//   save       save_cards end to end: PUT /_api/card/<handle> through the cardtile worker's API,
//              the real CardLifetime object, a Map for KV
//   resave     the save after that: base_version, one tile edited, the object already holding the file
//   view       GET /<handle> through the cardtile worker's fetch, KV seeded with the sample
//   view-parts the page view's own steps, one at a time, in the order card-worker.mjs runs them
//   view-md    GET /<handle>.md (the download exit) and GET /<handle> with Accept: text/markdown
//   deck-file  w3/deck.js reading the whole file in the browser-side mode, under w3/mini-dom.mjs
//   scale-<K>  the page view on the sample's first K tiles (sample.mjs, stopped early)
//
// Timing: wall = performance.now(); cpu = process.cpuUsage() (user + system, the whole process, GC
// threads included). Memory: rss before the step, peak rss of the process (resourceUsage().maxRSS),
// and heap used after the step with its result still held.
import { readFileSync, writeFileSync, createReadStream, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { SAMPLE_SHA256 } from './sample.mjs';
import { parseCard, serializeCard, CARD_MAX_BYTES, utf8Length } from '../../card-core.js';
import { assembleSave, thinCard, cardVersion } from '../../card-save.mjs';
import { cardLinkReport } from '../../serve/card-destinations.mjs';
import { handleApi, cardKey, TRY_MAX_BYTES } from '../../serve/card-api.mjs';
import worker, { renderCardHTML } from '../../serve/card-worker.mjs';
import { isTemplateOnly } from '../../card-blank.mjs';
import { resolveChannels } from '../../yt-channels.mjs';
import { envFor, fakeKv, noNetwork, sha256Hex } from './harness.mjs';

const [stage, path] = process.argv.slice(2);
if (!stage || !path) { console.error('usage: node --expose-gc measure.mjs <stage> <sample.md>'); process.exit(2); }

const HANDLE = 'every-number';
const ORIGIN = 'https://card.feelreef.com';
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const gc = () => { if (globalThis.gc) globalThis.gc(); };
const tried = noNetwork();

// which step a run is in, on stderr: a run that dies of memory leaves its last step as the answer to
// "where did it run out", which a stack trace from inside V8 does not give
const step = (name) => process.stderr.write(`bench-step ${name}\n`);

/** run fn once, return its result and the cost */
async function timed(fn, name = 'step') {
  step(name);
  gc();
  const rssBefore = process.memoryUsage().rss;
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const value = await fn();
  const wall = performance.now() - t0;
  const c = process.cpuUsage(c0);
  const heapAfter = process.memoryUsage().heapUsed;
  return { value, cost: { wallMs: Math.round(wall), cpuMs: Math.round((c.user + c.system) / 1000), rssBeforeMB: MB(rssBefore), heapUsedAfterMB: MB(heapAfter) } };
}

// a scale-<K> run builds its own smaller file and never holds the full sample
step('read the sample');
let md = stage.startsWith('scale-') ? '' : readFileSync(path, 'utf8');
const out = { stage, sample: { bytes: Buffer.byteLength(md), utf16Units: md.length, newlines: md.split('\n').length - 1 } };

if (stage === 'limits') {
  const bytes = utf8Length(md);
  const body = JSON.stringify({ markdown: md, create: true });
  out.limits = {
    CARD_MAX_BYTES, utf8Bytes: bytes, headroomBytes: CARD_MAX_BYTES - bytes,
    passesSaveCheck: !(bytes > CARD_MAX_BYTES),       // card-api.mjs refuses `bytes > KV_MAX_BYTES`
    oneMoreByteWouldBe: bytes + 1 > CARD_MAX_BYTES ? 413 : 'fits',
    TRY_MAX_BYTES, overTryParkBy: md.length - TRY_MAX_BYTES, // card-worker.mjs:1021, the sandbox park
    saveRequestJsonBytes: Buffer.byteLength(body),    // what PUT /_api/card/<handle> carries
    doChunks: Math.max(1, Math.ceil(md.length / (256 * 1024))), // keepCard, CARD_CHUNK code units
  };
} else if (stage === 'parse') {
  const { value: m, cost } = await timed(() => parseCard(md), 'parseCard');
  out.parse = { ...cost, frontTiles: m.cells.length, backs: m.drawers.length, backTiles: m.drawers.reduce((n, d) => n + d.cells.length, 0) };
} else if (stage === 'roundtrip') {
  const { value: ser, cost: c1 } = await timed(() => serializeCard(parseCard(md)), 'serializeCard(parseCard)');
  const { value: asm, cost: c2 } = await timed(() => assembleSave(md, null).md, 'assembleSave');
  const { value: thin, cost: c3 } = await timed(() => thinCard(md), 'thinCard');
  out.roundtrip = {
    serializeOfParse: { ...c1, bytes: Buffer.byteLength(ser), identical: ser === md },
    assembleSave: { ...c2, bytes: Buffer.byteLength(asm), identical: asm === md },
    thinCard: { ...c3, bytes: Buffer.byteLength(thin), identical: thin === md },
  };
} else if (stage === 'render') {
  const ctx = { handle: HANDLE, cardUrl: `${ORIGIN}/${HANDLE}`, canonicalUrl: `${ORIGIN}/${HANDLE}` };
  const { value: html, cost } = await timed(() => renderCardHTML(md, ctx), 'renderCardHTML');
  // the first tile's markup in the body (the stylesheet in <head> names the same classes)
  const body = html.indexOf('<body');
  const firstTile = html.indexOf('class="st-cell', body);
  const lastTile = html.lastIndexOf('class="st-cell');
  const bytes = Buffer.byteLength(html);
  const { value: gz, cost: gzCost } = await timed(() => gzipSync(html, { level: 6 }).length, 'gzip');
  out.render = { ...cost, htmlBytes: bytes, htmlMB: MB(bytes), gzipBytes: gz, gzipMs: gzCost.wallMs,
    bodyAtChar: body, firstTileAtChar: firstTile, lastTileAtChar: lastTile,
    tileMarkupCount: (html.match(/class="st-cell[ "]/g) || []).length,
    // the renderer returns one string: no byte of it, the first tile's included, exists before it returns
    firstTileAvailableAfterMs: cost.wallMs };
} else if (stage === 'editor') {
  const { cost: p } = await timed(() => parseCard(md), 'parseCard');
  const { value: lay, cost: l } = await timed(() => renderCardHTML(md, { editIndex: true }), 'renderCardHTML(editIndex)');
  const { value: pre, cost: v } = await timed(() => renderCardHTML(md, { deck: false }), 'renderCardHTML(deck:false)');
  out.editor = { parse: p, layoutRender: { ...l, htmlMB: MB(Buffer.byteLength(lay)) }, previewRender: { ...v, htmlMB: MB(Buffer.byteLength(pre)) } };
} else if (stage === 'save-parts') {
  const body = JSON.stringify({ markdown: md, create: true });
  const { cost: j } = await timed(() => JSON.parse(body), 'JSON.parse(body)');
  const { cost: a } = await timed(() => assembleSave(md, null), 'assembleSave');
  const { value: rep, cost: r } = await timed(() => cardLinkReport(md, { base: `${ORIGIN}/${HANDLE}/` }), 'cardLinkReport');
  const { cost: v } = await timed(() => cardVersion(md), 'cardVersion');
  const { cost: u } = await timed(() => utf8Length(md), 'utf8Length');
  out.saveParts = { jsonParse: j, assembleSave: a, cardLinkReport: { ...r, destinations: rep.destinations.length, refused: rep.refused.length }, cardVersion: v, utf8Length: u };
} else if (stage === 'save') {
  const TOKEN = 'bench-token';
  const env = envFor(await sha256Hex(TOKEN));
  const url = new URL(`${ORIGIN}/_api/card/${HANDLE}`);
  // The body arrives as a STREAM, as it does at the edge, and this process holds no copy of the file
  // while the save runs: the JSON goes to disk first and the sample string is dropped. Otherwise the
  // memory ladder would charge the save for 50 MB of the bench's own strings.
  step('write the request body');
  const bodyPath = join(process.env.TMPDIR || tmpdir(), `every-number-save-body-${process.pid}.json`);
  writeFileSync(bodyPath, JSON.stringify({ markdown: md, create: true }));
  md = null;
  const req = new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: Readable.toWeb(createReadStream(bodyPath)), duplex: 'half' });
  const { value: res, cost } = await timed(async () => { const r = await handleApi(req, env, url); return { status: r.status, body: await r.json() }; }, 'handleApi PUT (save)');
  unlinkSync(bodyPath);
  const stored = env.CARDS._m.get(cardKey(HANDLE, '0'));
  const objStore = env.CARD_LIFETIMES.storageOf(HANDLE);
  out.save = { ...cost, status: res.status, response: { ...res.body, diff: res.body.diff ? '(omitted)' : undefined },
    kvValueBytes: stored == null ? null : Buffer.byteLength(stored), kvIdentical: stored != null && createHash('sha256').update(stored).digest('hex') === SAMPLE_SHA256,
    kvPuts: env.CARDS.puts.map((p) => ({ key: p.key, MB: p.chars == null ? null : MB(p.chars) })),
    objectPuts: objStore.puts.length, objectLargestValueChars: Math.max(...objStore.puts.map((p) => p.chars || 0)) };
} else if (stage === 'view' || stage === 'view-md') {
  const env = { CARDS: fakeKv({ [cardKey(HANDLE, '0')]: md }) };
  const get = async (p, headers = {}) => {
    const { value, cost } = await timed(async () => {
      const r = await worker.fetch(new Request(`${ORIGIN}${p}`, { headers }), env, { waitUntil() {}, passThroughOnException() {} });
      const buf = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type'), bytes: buf.length };
    }, 'worker.fetch');
    return { path: p, ...value, ...cost };
  };
  if (stage === 'view') out.view = await get(`/${HANDLE}`);
  else out.viewMd = [await get(`/${HANDLE}.md`), await get(`/${HANDLE}`, { accept: 'text/markdown' })];
} else if (stage === 'view-parts') {
  // the page view's own steps, in the order card-worker.mjs runs them, each timed alone: under a small
  // memory cap the step a run dies in is the line the page view would break at
  const { value: blank, cost: b } = await timed(() => isTemplateOnly(md), 'isTemplateOnly');      // card-worker.mjs:1182
  const { cost: y } = await timed(() => resolveChannels(md, async () => null), 'resolveChannels'); // card-worker.mjs:1269
  const ctx = { handle: HANDLE, cardUrl: `${ORIGIN}/${HANDLE}`, canonicalUrl: `${ORIGIN}/${HANDLE}` };
  const { value: html, cost: r } = await timed(() => renderCardHTML(md, ctx), 'renderCardHTML');   // card-worker.mjs:1281
  out.viewParts = { isTemplateOnly: { ...b, blank }, resolveChannels: y, renderCardHTML: { ...r, htmlMB: MB(Buffer.byteLength(html)) } };
} else if (stage === 'deck-file') {
  // The on-demand half that already exists: w3/deck.js reads a whole Cards file handed to it
  // (window.__cardMd, or fetched from data-card-src) with its own line scanner, and builds a tile only
  // when it is near view. Run here under w3/mini-dom.mjs, the stand-in DOM w3/deck-views.test.mjs uses:
  // it has no layout, so this is the script's work on the file (scan, boot, the first tiles it
  // builds) and nothing a browser's layout or paint would add. The host page is a one-tile Cards file.
  const { makeWindow } = await import('../../w3/mini-dom.mjs');
  const DECK_JS = readFileSync(new URL('../../w3/deck.js', import.meta.url), 'utf8');
  const host = ['---', 'card-page: every-number', 'title: Every number', '---', '', '## cards', '', '- [ ] %% card: profile w=6 %% One file.', ''].join('\n');
  const win = makeWindow(renderCardHTML(host, { handle: HANDLE }), { scripts: true });
  const doc = win.document;
  const errors = [];
  win.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ').slice(0, 300)) };
  doc.scrollHeightOf = () => win.innerHeight * 10;
  doc.rectOf = () => ({ top: 0, left: 0, width: 342, height: 480 });
  const elementsBefore = doc.querySelectorAll('*').length;
  win.__cardMd = md;
  md = null;   // the page holds the file once, as window.__cardMd
  const { cost } = await timed(() => { win.run(DECK_JS, 'deck.js'); win.tick(3000); }, 'deck.js file mode');
  out.deckFile = { ...cost, items: win.__mdCount, boot: win.__deckBoot, view: doc.documentElement.dataset.view,
    elementsBefore, elementsAfter: doc.querySelectorAll('*').length, errors };
} else if (stage === 'resave') {
  // the save an owner makes AFTER the first: the object holds the file, so assembleSave parses both
  // the incoming file and the stored one, and base_version is checked against the held bytes.
  // One tile's text changes, same length, so the file stays at the ceiling.
  const TOKEN = 'bench-token';
  const env = envFor(await sha256Hex(TOKEN));
  const url = new URL(`${ORIGIN}/_api/card/${HANDLE}`);
  const put = (body) => handleApi(new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, url);
  const first = await (await put({ markdown: md, create: true })).json();
  const edited = md.replace('- [ ] %% card: text back=#n0 %% 0\n', '- [ ] %% card: text back=#n0 %% O\n');
  const { value: res, cost } = await timed(async () => { const r = await put({ markdown: edited, base_version: first.version }); return { status: r.status, body: await r.json() }; }, 'handleApi PUT (resave)');
  out.resave = { ...cost, status: res.status, version: res.body.version, editedBytes: Buffer.byteLength(edited), stored: env.CARDS._m.get(cardKey(HANDLE, '0')) === edited };
} else if (/^scale-\d+$/.test(stage)) {
  // the same generator, stopped after K tiles: how the page view's cost grows with the tile count
  const K = Number(stage.slice(6));
  const { pieces } = await import('./sample.mjs');
  const small = [...pieces(K - 1)].join('');
  const env = { CARDS: fakeKv({ [cardKey(HANDLE, '0')]: small }) };
  const { value, cost } = await timed(async () => {
    const r = await worker.fetch(new Request(`${ORIGIN}/${HANDLE}`), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
  }, 'worker.fetch (scale)');
  out.scale = { tiles: K, mdBytes: Buffer.byteLength(small), ...value, ...cost };
} else {
  console.error(`unknown stage ${stage}`); process.exit(2);
}

out.peakRssMB = MB(process.resourceUsage().maxRSS * 1024);
out.networkAttempts = tried.length;
console.log(JSON.stringify(out));
