// tile#372 — the `.md` exits hand over what a person wrote, as `text/markdown`. They say
// `X-Content-Type-Options: nosniff`, like every other answer of the cardtile worker whose body someone
// else wrote (the relays, the pictures): a browser must take the file for what it is said to be and
// never for something it guessed. Unconditional: no setting turns it off.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';

const FILE = '---\ntitle: <script>alert(1)</script>\n---\n\n## grid\n\n- [ ] %% card: text %% <html><body><script>alert(2)</script>\n';
const store = { get: async (k) => (k === 'someone' ? FILE : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };
const ask = (url, init) => worker.fetch(new Request(url, init), { CARDS: store });

test('the whole file (/<handle>.md) says nosniff, and is the file as it was written', async () => {
  const r = await ask('http://localhost/someone.md');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await r.text(), FILE);
});

test('the thin file (Accept: text/markdown) says nosniff', async () => {
  const r = await ask('http://localhost/someone', { headers: { accept: 'text/markdown' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('on the people\'s host of a split deployment too, and for HEAD', async () => {
  const env = { CARDS: store, CARD_CANONICAL_HOST: 'reef.cards', PREVIEW: 'false' };
  for (const method of ['GET', 'HEAD']) {
    const r = await worker.fetch(new Request('https://reef.cards/someone.md', { method }), env);
    assert.equal(r.status, 200, method);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', method);
  }
});
