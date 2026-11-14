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
  return {
    _m: m,
    reads: [],
    async get(k) { this.reads.push(k); return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: m.has(k) ? m.get(k) : null, metadata: meta.get(k) ?? null }; },
    async put(k, v, opts) { m.set(k, v); if (opts?.metadata !== undefined) meta.set(k, opts.metadata); },
    async delete(k) { m.delete(k); meta.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: true };
    },
  };
};
const doStorage = () => {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list({ prefix = '' } = {}) { return new Map([...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k, structuredClone(m.get(k))])); },
    _alarm: null,
    async setAlarm(t) { this._alarm = t; },
    async getAlarm() { return this._alarm; },
  };
};
const objectNs = (Class, objectEnv) => {
  const objects = new Map(), storages = new Map();
  const storageOf = (name) => { if (!storages.has(name)) storages.set(name, doStorage()); return storages.get(name); };
  return {
    storageOf,
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({
      async fetch(url, init) {
        if (!objects.has(name)) objects.set(name, new Class({ storage: storageOf(name) }, objectEnv));
        return objects.get(name).fetch(new Request(url, init));
      },
    }),
    alarm: (name) => { storageOf(name)._alarm = null; return objects.get(name).alarm(); },
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
