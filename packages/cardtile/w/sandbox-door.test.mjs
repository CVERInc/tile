// sandbox-door — pure derivation, no DOM. run: node --test sandbox-door.test.mjs
//
// Ported alongside sandbox-door.mjs from feelreef's tryToReal.test.ts (the retired route's own
// test) — same cases, adapted for an ABSOLUTE href (this sandbox lives on card.feelreef.com and
// must cross-navigate to feelreef.com, unlike the retired same-origin route).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  realCardHref, sandboxDoorFields, sandboxDoorHref, slugFromName, parkSandboxCard, PARK_PATH,
} from './sandbox-door.mjs';

test('slugFromName: lowercases and hyphenates a plain name', () => {
  assert.equal(slugFromName('Aster Studio'), 'aster-studio');
});

test('slugFromName: collapses runs of punctuation/whitespace into a single hyphen', () => {
  assert.equal(slugFromName('  Sam!!  Chen  '), 'sam-chen');
});

test('slugFromName: trims leading/trailing hyphens produced by leading/trailing punctuation', () => {
  assert.equal(slugFromName('--Sam--'), 'sam');
});

test('🔴 slugFromName: a name with no ASCII letters/digits at all → "" — the honest answer, not a guess', () => {
  // The ja-JP / zh-TW / ko-KR sandbox personas (sandbox-i18n.mjs) are exactly this shape.
  assert.equal(slugFromName('ゆい'), '');
  assert.equal(slugFromName('小美'), '');
  assert.equal(slugFromName('지우'), '');
});

test('slugFromName: caps at 39 characters and never leaves a trailing hyphen at the cut', () => {
  const long = 'a'.repeat(50) + ' b';
  const slug = slugFromName(long);
  assert.ok(slug.length <= 39);
  assert.ok(!slug.endsWith('-'));
});

test('slugFromName: never returns a slug the real form\'s own pattern would refuse', () => {
  const PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
  for (const input of ['Aster Studio', '  --  ', 'ゆい', '123', 'a', '---a---b---', '']) {
    const slug = slugFromName(input);
    if (slug) assert.match(slug, PATTERN);
  }
});

test('slugFromName: empty/whitespace-only name → ""', () => {
  assert.equal(slugFromName(''), '');
  assert.equal(slugFromName('   '), '');
});

test('realCardHref: builds handle + title + tagline from a plain name/bio, on feelreef.com', () => {
  const href = realCardHref({ name: 'Aster Studio', tagline: 'I paint small things' });
  const url = new URL(href);
  assert.equal(url.origin, 'https://feelreef.com');
  assert.equal(url.pathname, '/dashboard/cards');
  assert.equal(url.searchParams.get('handle'), 'aster-studio');
  assert.equal(url.searchParams.get('title'), 'Aster Studio');
  assert.equal(url.searchParams.get('tagline'), 'I paint small things');
});

test('realCardHref: URL-encodes special characters (spaces, &, unicode) in title/tagline', () => {
  const href = realCardHref({ name: 'Café & Co', tagline: '50% off — 走吧!' });
  const qs = href.split('?')[1] ?? '';
  assert.ok(!qs.includes(' '));
  const url = new URL(href);
  assert.equal(url.searchParams.get('title'), 'Café & Co');
  assert.equal(url.searchParams.get('tagline'), '50% off — 走吧!');
});

test('🔴 realCardHref: a non-ASCII-only name omits `handle` entirely rather than sending an invalid one', () => {
  const href = realCardHref({ name: 'ゆい', tagline: 'hello' });
  const url = new URL(href);
  assert.equal(url.searchParams.has('handle'), false);
  assert.equal(url.searchParams.get('title'), 'ゆい');
});

test('realCardHref: no tagline (null) omits the param', () => {
  const href = realCardHref({ name: 'Sam', tagline: null });
  const url = new URL(href);
  assert.equal(url.searchParams.has('tagline'), false);
});

test('realCardHref: an empty name → the bare feelreef.com/dashboard/cards, no params at all', () => {
  assert.equal(realCardHref({ name: '', tagline: '' }), 'https://feelreef.com/dashboard/cards');
  assert.equal(realCardHref({ name: '   ', tagline: undefined }), 'https://feelreef.com/dashboard/cards');
});

test('realCardHref: caps title at 120 chars and tagline at 200, matching the real form\'s maxlength', () => {
  const href = realCardHref({ name: 'A'.repeat(500), tagline: 'B'.repeat(500) });
  const url = new URL(href);
  assert.equal((url.searchParams.get('title') ?? '').length, 120);
  assert.equal((url.searchParams.get('tagline') ?? '').length, 200);
});

test('realCardHref: the produced handle always satisfies the real form\'s own pattern', () => {
  const PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
  const href = realCardHref({ name: '  --Sam Chen 台北--  ', tagline: '' });
  const url = new URL(href);
  const handle = url.searchParams.get('handle');
  assert.ok(handle);
  assert.match(handle, PATTERN);
});

// ── sandboxDoorFields / sandboxDoorHref — reading name+tagline back out of a card's own markdown ──

const CARD = [
  '---', 'card-page: try', 'title: Sam', 'lang: en', '---', '',
  '## cards', '',
  '- [ ] %% card: profile w=6 %% Building small things and sharing them here.',
  '- [ ] %% card: link w=6 %% [Book a call](https://example.com)',
].join('\n') + '\n';

test('sandboxDoorFields: reads title from frontmatter and the profile cell\'s body as tagline', () => {
  assert.deepEqual(sandboxDoorFields(CARD), {
    name: 'Sam',
    tagline: 'Building small things and sharing them here.',
  });
});

test('sandboxDoorFields: no profile cell → empty tagline, never a crash', () => {
  const md = ['---', 'title: Sam', '---', '', '## cards', '', '- [ ] %% card: text %% hi'].join('\n') + '\n';
  assert.deepEqual(sandboxDoorFields(md), { name: 'Sam', tagline: '' });
});

test('sandboxDoorHref: derives the same href realCardHref would, straight from markdown', () => {
  assert.equal(
    sandboxDoorHref(CARD),
    realCardHref({ name: 'Sam', tagline: 'Building small things and sharing them here.' }),
  );
});

test('sandboxDoorHref: a renamed persona (edited title) changes the derived handle', () => {
  const renamed = CARD.replace('title: Sam', 'title: Aster Studio');
  const url = new URL(sandboxDoorHref(renamed));
  assert.equal(url.searchParams.get('handle'), 'aster-studio');
});

// ── the card walks through the door with them (Top-10 #2, §3.6) ──────────────────────────────────

test('realCardHref: a parked draft id rides along as `draft`', () => {
  const url = new URL(realCardHref({ name: 'Sam', tagline: 'hi', draft: 'a-b-c' }));
  assert.equal(url.searchParams.get('draft'), 'a-b-c');
  assert.equal(url.searchParams.get('title'), 'Sam');
});

test('🔴 realCardHref: no draft id ⇒ byte-for-byte the href it has always produced', () => {
  const fields = { name: 'Sam', tagline: 'hi' };
  assert.equal(realCardHref({ ...fields, draft: '' }), realCardHref(fields));
  assert.equal(realCardHref({ ...fields, draft: undefined }), realCardHref(fields));
  assert.doesNotMatch(realCardHref(fields), /draft=/);
});

test('sandboxDoorHref: passes the draft id through from the caller', () => {
  assert.match(sandboxDoorHref(CARD, { draft: 'xyz' }), /[?&]draft=xyz(&|$)/);
  assert.doesNotMatch(sandboxDoorHref(CARD), /draft=/);
});

test('parkSandboxCard: posts the WHOLE card and hands back the id', async () => {
  const seen = [];
  const id = await parkSandboxCard(CARD, {
    origin: 'https://card.feelreef.com',
    fetchImpl: async (url, init) => {
      seen.push({ url, method: init.method, body: init.body });
      return { ok: true, json: async () => ({ id: 'parked-1' }) };
    },
  });
  assert.equal(id, 'parked-1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://card.feelreef.com' + PARK_PATH);
  assert.equal(seen[0].method, 'POST');
  // 🔴 the WHOLE card, not a summary — this is the entire point of the endpoint
  assert.equal(seen[0].body, CARD);
});

test('🔴 parkSandboxCard: every way it can fail returns "" and never throws — the door still opens', async () => {
  const cases = {
    'a refusal': async () => ({ ok: false, json: async () => ({}) }),
    'a thrown network error': async () => { throw new Error('offline'); },
    'a body with no id': async () => ({ ok: true, json: async () => ({}) }),
    'unparseable json': async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
  };
  for (const [what, fetchImpl] of Object.entries(cases)) {
    assert.equal(await parkSandboxCard(CARD, { fetchImpl }), '', what);
  }
  // …and with no fetch at all
  assert.equal(await parkSandboxCard(CARD, { fetchImpl: null }), '');
  assert.equal(await parkSandboxCard('', { fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'x' }) }) }), '');
});

test('CONTROL: the failure sweep above can still see a SUCCESS', async () => {
  assert.equal(
    await parkSandboxCard(CARD, { fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'yes' }) }) }),
    'yes',
  );
});
