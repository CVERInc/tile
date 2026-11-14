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
import * as blank from '../card-blank.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

// ── tile#296 round 3: the one older generation, recognised by digest ─────────────────────────────
// The previous editor also stored the 9 starters `buildSandboxCard` wrote at 89a5b04 (replaced at
// 22f9636). Their text is deliberately NOT in this repo any more; card-blank.mjs carries only three
// numbers per text (length, FNV-1a, Murmur3). Nothing below needs that text except the last test,
// which renders it from git history in memory and is skipped when the history is not in the checkout.
const norm = (md) => md.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
const triple = (s) => [s.length, blank.fnv1a32(s), blank.murmur3_32(s, blank.STARTER_DIGEST_SEED)];
const ALL_STARTERS = LOCALES.flatMap((k) => STARTERS(k).map(([shape, md]) => [`${k} ${shape}`, md]));

test('digests: FNV-1a and Murmur3 (32-bit, over UTF-8) match their published vectors', () => {
  assert.equal(typeof blank.fnv1a32, 'function');
  assert.equal(typeof blank.murmur3_32, 'function');
  for (const [s, h] of [['', 0x811c9dc5], ['a', 0xe40c292c], ['foobar', 0xbf9cf968]]) assert.equal(blank.fnv1a32(s), h, `fnv ${JSON.stringify(s)}`);
  for (const [s, seed, h] of [['', 0, 0], ['', 1, 0x514e28b7], ['', 0xffffffff, 0x81f16f39], ['\0\0\0\0', 0, 0x2362f9de],
    ['aaaa', 0x9747b28c, 0x5a97808a], ['Hello, world!', 0x9747b28c, 0x24884cba],
    ['The quick brown fox jumps over the lazy dog', 0x9747b28c, 0x2fa826cd]]) {
    assert.equal(blank.murmur3_32(s, seed), h, `murmur ${JSON.stringify(s)} seed ${seed}`);
  }
  // non-ASCII is hashed as its UTF-8 bytes, and both stay unsigned 32-bit
  for (const s of ['é', '日本語', '😀', 'Ünïcödé — ✓']) for (const h of [blank.fnv1a32(s), blank.murmur3_32(s, 7)]) {
    assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32, s);
  }
  assert.notEqual(blank.fnv1a32('é'), blank.fnv1a32('e'));
});

test('digest table: 9 rows of three unsigned 32-bit numbers, all distinct', () => {
  const rows = blank.OLDER_STARTER_DIGESTS;
  assert.equal(rows?.length, 9);
  for (const r of rows) {
    assert.equal(r.length, 3);
    for (const n of r) assert.ok(Number.isInteger(n) && n >= 0 && n < 2 ** 32, String(r));
  }
  assert.equal(new Set(rows.map((r) => r[1])).size, 9);
  assert.equal(new Set(rows.map((r) => r[2])).size, 9);
});

test('the 18 current starters are recognised by string equality, not by the digest table', () => {
  const rows = blank.OLDER_STARTER_DIGESTS;
  assert.equal(rows?.length, 9);
  for (const [at, md] of ALL_STARTERS) {
    assert.equal(isSandboxSample(md), true, at);
    const [, a, b] = triple(norm(md));
    assert.ok(!rows.some((r) => r[1] === a || r[2] === b), `${at} must not share a digest with a row`);
  }
});

// a deterministic stream of single-character edits: delete, replace or insert one UTF-16 unit
const POOL = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-—_%=[]()/\'"#\n\téüßñçøåœ日本語한국어中文'];
function* oneCharEdits(s, count, seed) {
  let x = seed >>> 0;
  const rnd = (n) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
  for (let i = 0; i < count; i++) {
    const kind = i % 3; const p = rnd(s.length + (kind === 2 ? 1 : 0)); const c = POOL[rnd(POOL.length)];
    if (kind === 0) yield s.slice(0, p) + s.slice(p + 1);
    else if (kind === 1) yield s.slice(0, p) + (c === s[p] ? (c === 'a' ? 'b' : 'a') : c) + s.slice(p + 1);
    else yield s.slice(0, p) + c + s.slice(p);
  }
}
const EDITS_PER_STARTER = 400;

test(`near misses: ${EDITS_PER_STARTER} single-character edits of each of the 18 starters share no digest with any row`, (t) => {
  const rows = blank.OLDER_STARTER_DIGESTS;
  assert.equal(rows?.length, 9);
  let tried = 0;
  ALL_STARTERS.forEach(([at, md], n) => {
    for (const e of oneCharEdits(norm(md), EDITS_PER_STARTER, 0x296 + n)) {
      const s = norm(e);
      if (s === norm(md)) continue;   // the edit only touched what normalisation forgives
      tried++;
      const [, a, b] = triple(s);
      assert.ok(!rows.some((r) => r[1] === a || r[2] === b), `${at}: ${JSON.stringify(s.slice(0, 40))}`);
      assert.equal(isSandboxSample(e), false, `${at} edited`);
    }
  });
  assert.ok(tried > 18 * EDITS_PER_STARTER * 0.95, `tried ${tried}`);
  t.diagnostic(`near misses: ${tried} edits of 18 starters, 0 share a digest with any row`);
});

// The one check that needs history. Skipped — visibly — when 89a5b04 is not in this checkout.
const HIST = '89a5b04:packages/cardtile/w/sandbox-i18n.mjs';
const historySource = () => {
  try {
    return execFileSync('git', ['-C', dirname(fileURLToPath(import.meta.url)), 'show', HIST], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString();
  } catch { return null; }
};

test('history: the 9 starters of 89a5b04 are recognised, and no one-character edit of them is', async (t) => {
  const src = historySource();
  if (src == null) { t.skip(`SKIPPED: \`git show ${HIST}\` is not available in this checkout`); return; }
  const old = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const texts = Object.keys(old.SANDBOX_LOCALES).map((k) => [k, old.buildSandboxCard(k)]);
  assert.equal(texts.length, 9);
  let edits = 0;
  for (const [k, md] of texts) {
    assert.ok(!ALL_STARTERS.some(([, cur]) => norm(cur) === norm(md)), `${k}: must reach the digest path`);
    assert.equal(isSandboxSample(md), true, `${k} as stored`);
    assert.equal(isSandboxSample(md.replace(/\n/g, '\r\n') + '\r\n'), true, `${k} crlf, trailing`);
    const s = norm(md);
    for (let p = 0; p <= s.length; p++) {
      for (const e of [s.slice(0, p) + s.slice(p + 1), s.slice(0, p) + (s[p] === 'x' ? 'y' : 'x') + s.slice(p + 1), s.slice(0, p) + 'x' + s.slice(p)]) {
        if (norm(e) === s) continue;
        edits++;
        assert.equal(isSandboxSample(e), false, `${k} edit at ${p}`);
      }
    }
  }
  t.diagnostic(`history: 9 texts recognised; ${edits} one-character edits rejected`);
});
