// tile#296 — the sandbox opens blank for a returning browser whose storage only holds the old sample
// starter, and keeps anything the visitor actually changed, byte for byte.
//
//   node --test packages/cardtile/w3/sandbox-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxStart, SAVED_KEY, DRAFT_KEY, W2_DRAFT_KEY } from './sandbox-start.mjs';
import { isSandboxSample } from '../card-blank.mjs';
import { readsAsCard } from './host-bridge.mjs';
import { buildSandboxCard, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';

const LOCALES = Object.keys(SANDBOX_LOCALES);

// The starter as the sandbox seeded it before the text tile was dropped (`buildSandboxCard` in
// w/sandbox-i18n.mjs at 22f9636, the last version before fe6b0d5 removed the tile): the same card plus
// the persona's "tap to edit" text tile. w2 (w/editor.mjs) wrote either shape verbatim under
// W2_DRAFT_KEY on load; the first-day w3 Save wrote the current one verbatim under SAVED_KEY.
const OLD_STARTER = (k) => buildSandboxCard(k) + `- [ ] %% card: text w=3 %% ${SANDBOX_LOCALES[k].textBody}\n`;
const STARTERS = (k) => [['current', buildSandboxCard(k)], ['with text tile', OLD_STARTER(k)]];

// `git show 22f9636:packages/cardtile/w/sandbox-i18n.mjs` → buildSandboxCard('en'), byte for byte. Pins
// OLD_STARTER (and the recogniser's copy of it) to what the old sandbox actually wrote.
const OLD_EN_FROM_HISTORY = [
  '---', 'card-page: try', 'title: Sam', 'lang: en-US', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% Family doctor in a small town. I write about rest, worry, and the small things that help — appointments and notes below.',
  '- [ ] %% card: link w=3 %% [Book an appointment](https://example.com)',
  '- [ ] %% card: text w=3 %% Tap any tile to edit it — everything here is just a demo.',
].join('\n') + '\n';

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

// tile#300 review finding 3: the previous editor's key is inspected on its own, whichever card opens.
test('an edited saved card wins, and an untouched sample under the previous editor\'s key is still removed', () => {
  for (const k of LOCALES) for (const [shape, sample] of STARTERS(k)) {
    const mine = EDITS['link address'](buildSandboxCard(k), SANDBOX_LOCALES[k]);
    assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: mine, [W2_DRAFT_KEY]: sample })),
      { saved: mine, draft: null, clear: [W2_DRAFT_KEY] }, `${k} ${shape}`);
    assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: mine, [W2_DRAFT_KEY]: sample, [DRAFT_KEY]: sample })),
      { saved: mine, draft: null, clear: [W2_DRAFT_KEY, DRAFT_KEY] }, `${k} ${shape} + draft`);
  }
});

test('an edited saved card wins, and edited work under the previous editor\'s key is left alone', () => {
  const mine = EDITS['title renamed'](buildSandboxCard('ko'), SANDBOX_LOCALES.ko);
  const old = EDITS['link label'](buildSandboxCard('ko'), SANDBOX_LOCALES.ko);
  assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: mine, [W2_DRAFT_KEY]: old })), { saved: mine, draft: null, clear: [] });
});

// ── tile#300 review: the recogniser is EXACT ─────────────────────────────────────────────────────
// Each is something the editor lets a visitor do (delete, reorder, resize, edit a link, add a tile,
// edit the raw Markdown). Every one of them was accepted as "the sample" in round 1 and its key was
// deleted on load. Now: kept byte for byte, under every key, and nothing is cleared.
const swapLines = (md, a, b) => {
  const ls = md.split('\n'); const i = ls.findIndex((x) => x.includes(a)); const j = ls.findIndex((x) => x.includes(b));
  [ls[i], ls[j]] = [ls[j], ls[i]]; return ls.join('\n');
};
const dropLines = (md, ...needles) => md.split('\n').filter((x) => !needles.some((n) => x.includes(n))).join('\n');
const REVIEW_CASES = {
  profile_deleted: (md) => dropLines(md, 'card: profile'),
  link_deleted: (md) => dropLines(md, 'card: link'),
  both_deleted: (md) => dropLines(md, 'card: profile', 'card: link'),
  reordered: (md) => swapLines(md, 'card: profile', 'card: link'),
  resized: (md) => md.replace('profile w=6', 'profile w=3'),
  link_cleared: (md) => md.replace('https://example.com', ''),
  extra_blank_tile: (md) => `${md}- [ ] %% card: text w=3 %% blank.text\n`,
  title_line_tab: (md) => md.replace('title: ', 'title:\t'),
  frontmatter_reordered: (md) => md.replace(/^---\n(card-page: .*)\n(title: .*)\n(lang: .*)\n---/, '---\n$3\n$2\n$1\n---'),
};

test('review cases: the reviewer\'s probe, verbatim, on the en starter', () => {
  const sample = buildSandboxCard('en');
  assert.equal(REVIEW_CASES.frontmatter_reordered(sample),
    sample.replace('card-page: try\ntitle: Sam\nlang: en-US', 'lang: en-US\ntitle: Sam\ncard-page: try'));
});

test('review cases: an edited sample is not the sample, every locale, both shapes', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) for (const [name, f] of Object.entries(REVIEW_CASES)) {
    const edited = f(md);
    assert.notEqual(edited, md, `${k} ${shape} ${name}: the fixture must change something`);
    assert.equal(isSandboxSample(edited), false, `${k} ${shape} ${name}`);
  }
});

test('review cases: kept byte for byte under each of the three keys, nothing cleared', () => {
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) for (const [name, f] of Object.entries(REVIEW_CASES)) {
    const edited = f(md);
    const at = `${k} ${shape} ${name}`;
    assert.deepEqual(sandboxStart(store({ [SAVED_KEY]: edited })), { saved: edited, draft: null, clear: [] }, `saved ${at}`);
    // the previous editor's key is only adopted when it reads as a card (both tiles deleted leaves no
    // cell) — unchanged from before; either way it is never cleared
    assert.deepEqual(sandboxStart(store({ [W2_DRAFT_KEY]: edited })), { saved: readsAsCard(edited) ? edited : null, draft: null, clear: [] }, `w2 ${at}`);
    assert.deepEqual(sandboxStart(store({ [DRAFT_KEY]: edited })), { saved: null, draft: edited, clear: [] }, `draft ${at}`);
  }
});

test('the exact set: 18 starters, each with CRLF, trailing blank lines and no final newline → blank, key cleared', () => {
  assert.equal(OLD_STARTER('en'), OLD_EN_FROM_HISTORY);
  const forms = {
    as: (s) => s, crlf: (s) => s.replace(/\n/g, '\r\n'), trailing: (s) => `${s}\n\n`,
    'crlf trailing': (s) => `${s}\n\n`.replace(/\n/g, '\r\n'), 'no final newline': (s) => s.replace(/\n$/, ''),
  };
  let n = 0;
  for (const k of LOCALES) for (const [shape, md] of STARTERS(k)) {
    n++;
    for (const [form, f] of Object.entries(forms)) {
      const v = f(md);
      assert.equal(isSandboxSample(v), true, `${k} ${shape} ${form}`);
      for (const key of [SAVED_KEY, W2_DRAFT_KEY, DRAFT_KEY]) {
        assert.deepEqual(sandboxStart(store({ [key]: v })), { saved: null, draft: null, clear: [key] }, `${key} ${k} ${shape} ${form}`);
      }
    }
  }
  assert.equal(n, 18);
});

test('the exact set: whitespace the normalisation does not cover is the visitor\'s', () => {
  const md = buildSandboxCard('en');
  for (const v of [md + ' ', md + '\n \n', ' ' + md, md.replace('title: Sam', 'title: Sam '), md.replace(/\n/g, '\r'),
    md.replace('## cards', '##  cards'), md.replace('\n\n## cards', '\n\n\n## cards')]) {
    assert.equal(isSandboxSample(v), false, JSON.stringify(v.slice(0, 60)));
  }
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
