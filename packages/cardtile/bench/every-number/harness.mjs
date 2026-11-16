// The stand-ins the measurements run the real cardtile worker against, in Node, with no network.
//
// Same shapes as serve/card-api.test.mjs (fakeKv, doStorage, objectNs): a Map-backed KV, and a
// Durable Object namespace holding the REAL CardLifetime class with a Map behind `state.storage`.
// 🔴 What they cannot model, and what therefore no number in README.md says anything about: KV's
// value-size refusal (the Map takes any size), the Durable Object storage's per-value limit, the
// runtime's CPU and memory limits, and the time a real KV read of 25 MiB takes over the network.
// Those are named as limits in README.md, not measured.
import { CardLifetime, HostBindings } from '../../serve/card-api.mjs';

export const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  const meta = new Map();
  return {
    _m: m,
    puts: [],
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: meta.has(k) ? meta.get(k) : null }; },
    async put(k, v, opts) {
      this.puts.push({ key: k, chars: typeof v === 'string' ? v.length : null });
      m.set(k, v);
      if (opts?.metadata !== undefined) meta.set(k, opts.metadata); else meta.delete(k);
    },
    async delete(k) { m.delete(k); meta.delete(k); },
    async list({ prefix = '' } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { keys: names.map((name) => ({ name })), list_complete: true };
    },
  };
};

export const doStorage = () => {
  const m = new Map();
  return {
    _m: m,
    puts: [],
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) {
      this.puts.push({ key: k, chars: typeof v === 'string' ? v.length : null });
      m.set(k, structuredClone(v));
    },
    async delete(k) { return m.delete(k); },
    async list({ prefix = '' } = {}) { return new Map([...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k, structuredClone(m.get(k))])); },
    _alarm: null,
    async setAlarm(t) { this._alarm = t; },
    async getAlarm() { return this._alarm; },
  };
};

const objectNs = (Class, env) => {
  const objects = new Map(), storages = new Map();
  const storageOf = (name) => { if (!storages.has(name)) storages.set(name, doStorage()); return storages.get(name); };
  return {
    storageOf,
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({
      async fetch(url, init) {
        if (!objects.has(name)) objects.set(name, new Class({ storage: storageOf(name) }, env));
        return objects.get(name).fetch(new Request(url, init));
      },
    }),
  };
};

/** an env for the cardtile worker: empty KV, both Durable Object namespaces, the bearer's hash */
export const envFor = (tokenHash, seed = {}) => {
  const env = { CARDS: fakeKv(seed), MCP_TOKEN_HASH: tokenHash };
  env.HOST_BINDINGS = objectNs(HostBindings, env);
  env.CARD_LIFETIMES = objectNs(CardLifetime, env);
  return env;
};

/** every outbound fetch is refused and counted: a measurement must never reach the network */
export const noNetwork = () => {
  const tried = [];
  globalThis.fetch = async (u) => { tried.push(String(u)); throw new Error('bench: no network'); };
  return tried;
};

export const sha256Hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
