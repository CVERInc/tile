// tile#296 — the sandbox opens blank for a returning browser whose storage only holds the old sample
// starter, and keeps anything the visitor actually changed, byte for byte.
//
//   node --test packages/cardtile/w3/sandbox-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxStart, SAVED_KEY, DRAFT_KEY, W2_DRAFT_KEY } from './sandbox-start.mjs';
import { isSandboxSample } from '../card-blank.mjs';
import { buildSandboxCard, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';

const LOCALES = Object.keys(SANDBOX_LOCALES);

// The starter as the sandbox seeded it before the text tile was dropped (w/sandbox-i18n.mjs at
// 89a5b04): the same card plus the persona's "tap to edit" text tile. w2 (w/editor.mjs) wrote either
// shape verbatim under W2_DRAFT_KEY on load; the first-day w3 Save wrote it verbatim under SAVED_KEY.
const OLD_STARTER = (k) => buildSandboxCard(k) + `- [ ] %% card: text w=3 %% ${SANDBOX_LOCALES[k].textBody}\n`;
const STARTERS = (k) => [['current', buildSandboxCard(k)], ['with text tile', OLD_STARTER(k)]];

const store = (entries) => {
  const s = new Map(Object.entries(entries));
  return (k) => (s.has(k) ? s.get(k) : null);
};

// ── the recogniser ──────────────────────────────────────────────────────────────────────────────
test('isSandboxSample: every locale\'s starter, both shapes the sandbox ever seeded', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) assert.equal(isSandboxSample(md), true, `${k} ${shape}`);
});

test('isSandboxSample: what parseCard drops before anything renders is not a change (CRLF, trailing blank lines)', () => {
  for (const k of LOCALES) {
    assert.equal(isSandboxSample(buildSandboxCard(k).replace(/\n/g, '\r\n')), true, `${k} crlf`);
    assert.equal(isSandboxSample(buildSandboxCard(k) + '\n\n'), true, `${k} trailing`);
    assert.equal(isSandboxSample(buildSandboxCard(k).replace(/\n$/, '')), true, `${k} no final newline`);
  }
});

// one realistic change per kind, each made the way a visitor could make it in w2 or w3
const EDITS = {
  'bio, one character': (md, p) => md.replace(p.bio, p.bio.replace(/.$/u, '!')),
  'link address': (md) => md.replace('https://example.com', 'https://example.org/me'),
  'link label': (md, p) => md.replace(`[${p.linkLabel}]`, '[Hi]'),
  'title renamed': (md, p) => md.replace(`title: ${p.name}`, 'title: Robin'),
  'a setting in frontmatter': (md) => md.replace('card-page: try\n', 'card-page: try\ntheme: dark\n'),
  'lang removed': (md) => md.replace(/^lang: .*\n/m, ''),
  'a tile written': (md) => `${md}- [ ] %% card: text w=3 %% my own words\n`,
  'prose before the lanes': (md) => md.replace('## cards', 'hello\n\n## cards'),
};

test('isSandboxSample: a sample the visitor changed is not the sample', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) for (const [name, f] of Object.entries(EDITS)) {
    const edited = f(md, SANDBOX_LOCALES[k]);
    assert.notEqual(edited, md, `${k} ${shape} ${name}: the fixture must change something`);
    assert.equal(isSandboxSample(edited), false, `${k} ${shape} ${name}`);
  }
});

test('isSandboxSample: title and lang must come from the same persona', () => {
  assert.equal(isSandboxSample(buildSandboxCard('en').replace('lang: en-US', 'lang: ja-JP')), false);
});

test('isSandboxSample: not a card, an empty card, garbage', () => {
  for (const x of [null, undefined, 42, '', '## cards\n\n', '---\ncard-page: try\n---\n\n## cards\n\n']) assert.equal(isSandboxSample(x), false, JSON.stringify(x));
});

// ── what the sandbox opens on ───────────────────────────────────────────────────────────────────
test('opens blank: the untouched sample under the saved key, every locale, and that key is cleared', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) {
    const r = sandboxStart(store({ [SAVED_KEY]: md }));
    assert.deepEqual(r, { saved: null, draft: null, clear: [SAVED_KEY] }, `${k} ${shape}`);
  }
});

test('opens blank: the untouched sample under the previous editor\'s draft key, every locale, and that key is cleared', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) {
    const r = sandboxStart(store({ [W2_DRAFT_KEY]: md }));
    assert.deepEqual(r, { saved: null, draft: null, clear: [W2_DRAFT_KEY] }, `${k} ${shape}`);
  }
});

test('opens blank: the untouched sample under both keys and the draft key — all three cleared', () => {
  for (const k of LOCALES) {
    const md = buildSandboxCard(k);
    const r = sandboxStart(store({ [SAVED_KEY]: md, [W2_DRAFT_KEY]: OLD_STARTER(k), [DRAFT_KEY]: md }));
    assert.deepEqual(r, { saved: null, draft: null, clear: [SAVED_KEY, W2_DRAFT_KEY, DRAFT_KEY] }, k);
  }
});

test('kept byte-for-byte: an edited sample under either key, never cleared', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) for (const [name, f] of Object.entries(EDITS)) {
    const edited = f(md, SANDBOX_LOCALES[k]);
    assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: edited })), { saved: edited, draft: null, clear: [] }, `saved ${k} ${shape} ${name}`);
    assert.deepEqual(sandboxStart(store({ [W2_DRAFT_KEY]: edited })), { saved: edited, draft: null, clear: [] }, `w2 ${k} ${shape} ${name}`);
    assert.deepEqual(sandboxStart(store({ [DRAFT_KEY]: edited })), { saved: null, draft: edited, clear: [] }, `draft ${k} ${shape} ${name}`);
  }
});

test('the saved key holding the sample does not hide edited work under the previous editor\'s key', () => {
  const edited = EDITS['bio, one character'](buildSandboxCard('de'), SANDBOX_LOCALES.de);
  assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: buildSandboxCard('de'), [W2_DRAFT_KEY]: edited })),
    { saved: edited, draft: null, clear: [SAVED_KEY] });
});

test('an edited saved card still wins over the previous editor\'s key, which is left alone', () => {
  const mine = EDITS['title renamed'](buildSandboxCard('ko'), SANDBOX_LOCALES.ko);
  assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: mine, [W2_DRAFT_KEY]: buildSandboxCard('ko') })),
    { saved: mine, draft: null, clear: [] });
});

test('a sample draft over edited saved work: the work opens, the sample draft is dropped', () => {
  const mine = EDITS['a tile written'](buildSandboxCard('fr'), SANDBOX_LOCALES.fr);
  assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: mine, [DRAFT_KEY]: buildSandboxCard('fr') })),
    { saved: mine, draft: null, clear: [DRAFT_KEY] });
});

test('unchanged: nothing stored, an empty saved card, and a previous draft that is not a card', () => {
  assert.deepEqual(sandboxStart(store({})), { saved: null, draft: null, clear: [] });
  assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: '## cards\n\n' })), { saved: '## cards\n\n', draft: null, clear: [] });
  assert.deepEqual(sandboxStart(store({ [W2_DRAFT_KEY]: 'not a card' })), { saved: null, draft: null, clear: [] });
});
