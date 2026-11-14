// Test support for tile#304 (a Card in several languages): the fixtures, the store and object doubles,
// and the calls that languages-api.test.mjs and languages-serve.test.mjs share. Not a test file itself,
// and nothing outside the tests imports it.
//
// The doubles are card-api.test.mjs's, cut to what these files need: a Map-backed KV (which records
// every key it is asked for, so a test can say "no language key was read"), a Map-backed Durable Object
// storage, and a namespace that holds the REAL HostBindings and CardLifetime classes.
import assert from 'node:assert/strict';
import { handleApi as handleApiAsWritten, liveCard, CardLifetime, HostBindings, _internal } from './card-api.mjs';
import worker from './card-worker.mjs';
import { thinCard } from '../card-save.mjs';
import { languagesOf } from '../languages.mjs';
import { parseCard, serializeCard } from '../card-core.js';
import { twinned } from './api-prefix-twin.mjs';

// every `/_api/card/…` request goes to `/_api/cards/…` instead when card-api-cards-twin.test.mjs runs a file
const handleApi = twinned(handleApiAsWritten);

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

export const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** a main file listing three languages: its own (en-US), Japanese and Traditional Chinese */
export const MAIN = serializeCard(parseCard([
  '---', 'card-page: t', 'title: Aster', 'lang: en-US', 'locales: [en-US, ja-JP, zh-TW]', 'accent: #c0392b', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% Illustrator.',
  '- [ ] %% card: link w=6 %% [Shop](https://example.com/shop)', '',
  '## assets', '', `- [ ] %% card: asset id=pic mime=image/gif %% ${GIF}`, '',
].join('\n')));
/** the same Card in one language: no `locales:` line */
export const PLAIN = MAIN.replace(/^locales:.*\n/m, '');
/** its Japanese file: the same tiles, the owner's words in Japanese, only title and lang in the frontmatter */
export const JA = [
  '---', 'title: アスター', 'lang: ja-JP', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% イラストレーター。',
  '- [ ] %% card: link w=6 %% [ショップ](https://example.com/shop)', '',
].join('\n');

const TOKEN = 'super-secret-bearer';
const TOKEN_HASH = await _internal.sha256Hex(TOKEN);

// ── the store and the objects ────────────────────────────────────────────────────────────────────

export const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  const meta = new Map();
  // tile#304 r2: individual writes and deletes can be made to fail or to wait (kvFails, kvHolds)
  const faults = [];
  const before = async (op, k) => {
    for (const f of faults) {
      if (!f.on || f.op !== op || !f.match(k)) continue;
      f.hits.push(k);
      if (f.fail) throw new Error(`simulated KV ${op} failure on ${k}`);
      f.arrived(k);
      await f.gate;
    }
  };
  return {
    _m: m,
    _meta: meta,
    faults,
    reads: [],
    /** every put as it was called: [key, whether an options argument was passed at all] */
    puts: [],
    async get(k) { this.reads.push(k); return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { this.reads.push(k); return { value: m.has(k) ? m.get(k) : null, metadata: meta.get(k) ?? null }; },
    // a KV put replaces the whole entry: a put without metadata leaves none (as Workers KV does)
    async put(k, v, opts) { await before('put', k); this.puts.push([k, opts !== undefined]); m.set(k, v); if (opts?.metadata !== undefined) meta.set(k, opts.metadata); else meta.delete(k); },
    async delete(k) { await before('delete', k); m.delete(k); meta.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: true };
    },
  };
};
/** tile#304 r3: what an object meets once it has been stopped (evicted, crashed): every operation fails */
export class Crash extends Error {}
/**
 * a Durable Object's storage. tile#304 r3: it can STOP the object between any two of its mutating
 * operations — its own puts, deletes and alarm, and its KV puts and deletes (objectNs routes those
 * through `_op`). `cut = { after, count, log, when? }`: the first `after` operations happen, and the next
 * one (and every operation after it, reads included) throws Crash, as an evicted object's would; or,
 * with `when`, the object stops right after the first operation that makes `when()` true. `log` lists
 * the operations that happened, in order. A put of several keys at once (`put({ k: v, … })`) is one
 * operation, as it is one atomic write in a Durable Object.
 */
const doStorage = () => {
  const m = new Map();
  const faults = [];
  const s = {
    _m: m,
    faults,
    cut: null,
    dead: false,
    _read() { if (s.dead) throw new Crash('the object was stopped'); },
    _op(op, key) {
      s._read();
      const c = s.cut;
      if (!c) return;
      if (c.count === c.after) { s.dead = true; throw new Crash(`stopped before: ${op} ${key}`); }
      c.count++;
      c.log.push(`${op} ${key}`.trim());
    },
    _done() { if (s.cut && s.cut.when && !s.dead && s.cut.when()) s.dead = true; },
    async get(k) { s._read(); return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) {
      const entries = typeof k === 'string' ? [[k, v]] : Object.entries(k);
      for (const [key] of entries) for (const f of faults) if (f.on && f.op === 'put' && f.match(key)) { f.hits.push(key); f.arrived(key); await f.gate; }
      s._op('put', entries.map(([key]) => key).join(' + '));
      for (const [key, value] of entries) m.set(key, structuredClone(value));
      s._done();
    },
    async delete(k) { s._op('delete', k); const had = m.delete(k); s._done(); return had; },
    async list({ prefix = '' } = {}) { s._read(); return new Map([...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k, structuredClone(m.get(k))])); },
    _alarm: null,
    async setAlarm(t) { s._op('setAlarm', ''); s._alarm = t; s._done(); },
    async getAlarm() { s._read(); return s._alarm; },
    async deleteAlarm() { s._op('deleteAlarm', ''); s._alarm = null; s._done(); },
  };
  return s;
};
/** the KV an object writes through: the shared store, but its writes are the object's operations (see doStorage) */
const objectKv = (kv, storage) => new Proxy(kv, {
  get(target, p) {
    const v = target[p];
    if (p === 'put' || p === 'delete') {
      return async (key, ...rest) => { storage._op(`kv.${p}`, key); const r = await v.call(target, key, ...rest); storage._done(); return r; };
    }
    if (p === 'get' || p === 'getWithMetadata' || p === 'list') return async (...a) => { storage._read(); return v.apply(target, a); };
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
const objectNs = (Class, objectEnv) => {
  const objects = new Map(), storages = new Map();
  let Live = Class;
  const storageOf = (name) => { if (!storages.has(name)) storages.set(name, doStorage()); return storages.get(name); };
  const envOf = (name) => new Proxy(objectEnv, { get: (t, p) => (p === 'CARDS' ? objectKv(t.CARDS, storageOf(name)) : t[p]) });
  const instance = (name) => {
    if (!objects.has(name)) objects.set(name, new Live({ storage: storageOf(name) }, envOf(name)));
    return objects.get(name);
  };
  return {
    storageOf,
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({ async fetch(url, init) { return instance(name).fetch(new Request(url, init)); } }),
    alarm: (name) => { storageOf(name)._alarm = null; return objects.get(name).alarm(); },
    /** tile#304 r3: the object is gone (evicted, crashed); its storage stays, and the next call constructs a new one */
    restart(name) { objects.delete(name); const s = storageOf(name); s.dead = false; s.cut = null; },
    /** the runtime's alarm, if one is set: true when it fired. A restarted object is constructed for it. */
    async tick(name) {
      const s = storageOf(name);
      if (s._alarm == null) return false;
      s._alarm = null;
      await instance(name).alarm();
      return true;
    },
    /** a deploy of `Next` (another version of the class): every object restarts as one of those */
    deploy(Next) { Live = Next; for (const name of [...objects.keys()]) this.restart(name); },
  };
};
/** an env with nothing stored: every card in these tests is made through the API (a create), so the
 *  object holds it from its first write and no first-contact adoption is involved */
export const envWith = (extra = {}) => {
  const env = { CARDS: fakeKv(), MCP_TOKEN_HASH: TOKEN_HASH, PREVIEW: 'false', ...extra };
  env.HOST_BINDINGS = objectNs(HostBindings, env);
  env.CARD_LIFETIMES = objectNs(CardLifetime, env);
  return env;
};

// ── the calls ────────────────────────────────────────────────────────────────────────────────────

/** one API call with the bearer → { status, json (null for markdown), text, headers } */
export const call = async (env, method, path, body, headers = {}) => {
  const url = new URL('https://card.feelreef.com' + path);
  const req = new Request(url, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const res = await handleApi(req, env, url);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* markdown */ }
  return { status: res.status, json, text, headers: res.headers };
};
export const save = (env, md, extra = {}) => call(env, 'PUT', '/_api/card/t', { markdown: md, ...extra });
export const saveLang = (env, tag, md, extra = {}) => call(env, 'PUT', `/_api/card/t/lang/${tag}`, { markdown: md, ...extra });
/** a visitor's request through the Worker's fetch handler → { status, headers, body } */
export const visit = async (env, path = '/t', headers = {}, host = 'card.feelreef.com') => {
  const res = await worker.fetch(new Request(`https://${host}${path}`, { headers }), env, {});
  return { status: res.status, headers: res.headers, body: await res.text() };
};
export const htmlLang = (html) => (/<html lang="([^"]*)"/.exec(html) || [])[1];
export const hreflangs = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
export const canonicalOf = (html) => (/<link rel="canonical" href="([^"]*)">/.exec(html) || [])[1];
/** every language-file key of handle `t` in KV */
export const langKeys = (env) => [...env.CARDS._m.keys()].filter((k) => /^card:t:[^:]+:/.test(k));

// ── faults (tile#304 r2): one KV write or delete, or one object-storage put, that fails or waits ──

const fault = (list, op, re, extra) => {
  const f = { op, match: (k) => re.test(k), on: true, hits: [], arrived: () => {}, ...extra };
  list.push(f);
  return f;
};
/** every KV `op` ('put' | 'delete') on a key matching `re` throws until `heal()`; `hits` = the keys it refused */
export function kvFails(env, op, re) {
  const f = fault(env.CARDS.faults, op, re, { fail: true });
  return { hits: f.hits, heal() { f.on = false; } };
}
/** the first KV `op` on a key matching `re` waits until `release()`; `reached` resolves with the key once it waits */
export function kvHolds(env, op, re) {
  return hold(env.CARDS.faults, op, re);
}
/** the first put to the handle's object storage on a key matching `re` waits until `release()` */
export function storageHolds(env, re, name = 't') {
  return hold(env.CARD_LIFETIMES.storageOf(name).faults, 'put', re);
}
function hold(list, op, re) {
  let release, arrived;
  const gate = new Promise((r) => { release = r; });
  const reached = new Promise((r) => { arrived = r; });
  const f = fault(list, op, re, { gate, arrived: (k) => { f.on = false; arrived(k); } });
  return { reached, hits: f.hits, release() { f.on = false; release(); } };
}
/** `p`, or a rejection naming `what` after `ms` — so a hold that is never reached fails the test, not the run */
export const within = (p, what, ms = 2000) => {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`never happened: ${what}`)), ms); })])
    .finally(() => clearTimeout(timer));
};
/** has `p` settled yet? (after letting every queued step run) */
export async function settled(p) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  return done;
}
/** the main file's KV key for handle `t`, in the generation KV names now */
export const mainKey = async (env) => `card:t:${(await liveCard(env.CARDS, 't')).gen}`;
/** the KV metadata on the main file's key: the record of which language files visitors may be served */
export const mainMetadata = async (env) => env.CARDS._meta.get(await mainKey(env)) ?? null;

/** a Card made as an owner makes one: the main file (a save never takes the caller's assets lane), then
 *  its picture through put_asset — so the stored main file is `md`, byte for byte */
export async function withMain(extra, md = MAIN) {
  const env = envWith(extra);
  assert.equal((await save(env, thinCard(md), { create: true })).status, 200);
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/pic', { base64: GIF, mime: 'image/gif' })).status, 200);
  assert.equal((await liveCard(env.CARDS, 't')).md, md, 'the fixture is stored as written');
  return env;
}
/** …listing three languages, with a Japanese file */
export async function withJapanese(extra) {
  const env = await withMain(extra);
  const put = await saveLang(env, 'ja-JP', JA);
  assert.equal(put.status, 200, JSON.stringify(put.json));
  return env;
}

// ── tile#304 r3: an object stopped partway through a commit ───────────────────────────────────────

/** let every alarm the setup left fire, so what a later test sees armed was armed by what it tested */
export async function quiet(env, name = 't') {
  for (let i = 0; i < 5; i++) if (!(await env.CARD_LIFETIMES.tick(name))) return;
  throw new Error('the object keeps re-arming its alarm');
}
/**
 * `act(env)` on a fresh `await setup()`, with the object of `t` stopped after `after` of its mutating
 * operations (Infinity: never), then restarted (a new instance over the same storage) →
 * { env, log: the operations that happened, died, result: act's value or what it threw }
 */
export async function stoppedAfter(setup, act, after) {
  const env = await setup();
  await quiet(env);
  const storage = env.CARD_LIFETIMES.storageOf('t');
  storage.cut = { after, count: 0, log: [] };
  let result;
  try { result = await act(env); } catch (e) { result = e; }
  const { log } = storage.cut, died = storage.dead;
  env.CARD_LIFETIMES.restart('t');
  return { env, log, died, result };
}
/** the object's own state for `t`: its generation, main file, and live language map (wherever it is kept) */
export function heldState(env) {
  const m = env.CARD_LIFETIMES.storageOf('t')._m;
  const gen = (m.get('life') || {}).gen || '0';
  const body = (slot) => {
    const r = m.get(`card:${slot}`);
    if (!r) return null;
    const parts = [];
    for (let i = 0; i < r.n; i++) parts.push(m.get(`card:${slot}:${r.serial}:${i}`));
    return parts.join('');
  };
  const record = m.get(`card:${gen}`) || {};
  const lang = m.get(`languages:${gen}`) || record; // r3 keeps the map in its own key; r2 kept it in the record
  const languages = { ...(lang.languages || {}) };
  return { gen, main: body(gen), languages, owed: lang.owed || [], file: (tag) => body(`${gen}@${tag}@${languages[tag]}`) };
}
/**
 * where the object's truth and what visitors are served disagree ([] when they agree): KV's main body
 * and the language map in its metadata are the object's; each named key holds the object's file; no
 * other language key of the generation is left in KV; nothing is owed; and on the visitor's own exit,
 * each listed language is served from the object's file or, with none, is the main file.
 */
export async function disagreements(env) {
  const held = heldState(env);
  const out = [];
  const kv = await liveCard(env.CARDS, 't');
  if (kv.md !== held.main) out.push('the main body in KV is not the object\'s');
  if (JSON.stringify(Object.entries(kv.languages).sort()) !== JSON.stringify(Object.entries(held.languages).sort())) {
    out.push(`KV names ${JSON.stringify(kv.languages)}, the object ${JSON.stringify(held.languages)}`);
  }
  const named = new Set();
  for (const [tag, rev] of Object.entries(held.languages)) {
    const k = `card:t:${held.gen}:${tag}:${rev}`;
    named.add(k);
    if (env.CARDS._m.get(k) !== held.file(tag)) out.push(`${k} is not the object's ${tag} file`);
  }
  for (const k of langKeys(env)) if (k.startsWith(`card:t:${held.gen}:`) && !named.has(k)) out.push(`${k} is still in KV, named by nothing`);
  if (held.owed.length) out.push(`still owed: ${JSON.stringify(held.owed)}`);
  const { listed, main, files } = languagesOf(held.main);
  for (const tag of files) {
    const v = await visit(env, `/t?lang=${tag}`);
    const lang = held.languages[tag] && listed.includes(tag) ? tag : main;
    if (v.headers.get('content-language') !== lang) out.push(`a visitor asking for ${tag} is served ${v.headers.get('content-language')}, the object says ${lang}`);
    const words = held.languages[tag] ? /%% ([^\n]*)/.exec(held.file(tag))[1] : null;
    if (words && !v.body.includes(words.replace(/^.*?%% /, ''))) out.push(`a visitor asking for ${tag} is not served the object's ${tag} words`);
  }
  return out;
}
