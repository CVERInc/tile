// REEF with Repo Facts — the coral, run against a REAL page.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-page.test.mjs
//
// fixtures/collection-page.html is the `collection` section of a live sitetile page, saved
// verbatim inside a bare document: sixteen project cards, fourteen with a "View on GitHub" link of
// their own and two whose whole card is the link, plus one link to an organisation that is not a
// repo at all. No byte of that section was written for this test, which is the point — the
// coral's contract is with markup somebody else renders.
//
// Two claims carry this file, and both are about what did NOT happen:
//   · a card nobody answered for, and every byte outside the cards, is left exactly as it was;
//   · on ANY failure the whole page is byte-identical to a page this script never ran on.
// They are checked by serialising the page before and after and comparing strings. That only
// means something if the fixture DOM can round-trip the page untouched, so that is asserted first.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mountRepoFacts, fillCards, findCards, DIAGNOSTICS, MARK, PATH } from './repo-facts-core.mjs';
import { parsePage, fakeFetch } from './fake-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'fixtures/collection-page.html'), 'utf8');
const API = 'https://edge.example';
const realFetch = globalThis.fetch;

// What the edge would answer for this page. Real values for real repos, deliberately uneven —
// with and without a release, a bare tag and a v-prefixed one, a rename — because a fixture where
// every repo looks alike cannot tell "filled the right card" from "filled a card".
const FACTS = {
  'CVERInc/bleedblend': { tag: 'v2.3.0', releasedAt: '2026-06-18', pushedAt: '2026-09-28', license: 'MIT', archived: false, fullName: 'CVERInc/bleedblend' },
  'CVERInc/clikae': { tag: 'v0.40.0', releasedAt: '2026-10-07', pushedAt: '2026-10-07', license: 'MIT', archived: false, fullName: 'CVERInc/clikae' },
  'CVERInc/clioil': { tag: 'v0.1.0', releasedAt: '2026-06-16', pushedAt: '2026-06-24', license: 'MIT', archived: false, fullName: 'CVERInc/clioil' },
  // no release at all: the edge says so with nulls
  'CVERInc/demodeck': { tag: null, releasedAt: null, pushedAt: '2026-07-05', license: 'MIT', archived: false, fullName: 'CVERInc/demodeck' },
  // the edge could not read this one just now
  'CVERInc/liquidframe': {},
  // CVERInc/marktile is ABSENT: the page links a name that no longer exists
  'CVERInc/motifmint': { tag: null, releasedAt: null, pushedAt: '2026-09-28', license: 'MIT', archived: false, fullName: 'CVERInc/motifmint' },
  'CVERInc/reepub': { tag: 'v1.1.0', releasedAt: '2026-08-03', pushedAt: '2026-09-29', license: 'MIT', archived: false, fullName: 'CVERInc/reepub' },
  // 🔴 the two invented facts here: no repo on this page is archived, and this one has no release.
  // Set so the badge has a card — and so "the badge and NOTHING after it" has something to hide.
  'CVERInc/seikyusho': { tag: 'v1.4.0', releasedAt: '2026-03-02', pushedAt: '2026-07-14', license: 'MIT', archived: true, fullName: 'CVERInc/seikyusho' },
  'CVERInc/sheerstatus': { tag: 'v0.10.1', releasedAt: '2026-08-04', pushedAt: '2026-09-28', license: 'MIT', archived: false, fullName: 'CVERInc/sheerstatus' },
  'CVERInc/sheersweep': { tag: 'v0.17.0', releasedAt: '2026-08-05', pushedAt: '2026-08-15', license: 'MIT', archived: false, fullName: 'CVERInc/sheersweep' },
  'CVERInc/shelfseer': { tag: 'v0.1.0', releasedAt: '2026-06-16', pushedAt: '2026-07-14', license: 'MIT', archived: false, fullName: 'CVERInc/shelfseer' },
  'CVERInc/signet': { tag: 'v0.1.0', releasedAt: '2026-06-16', pushedAt: '2026-09-27', license: null, archived: false, fullName: 'CVERInc/signet' },
  'CVERInc/snapsift': { tag: 'v0.10.0', releasedAt: '2026-09-18', pushedAt: '2026-09-28', license: 'MIT', archived: false, fullName: 'CVERInc/snapsift' },
  'CVERInc/tile': { tag: null, releasedAt: null, pushedAt: '2026-10-05', license: 'MIT', archived: false, fullName: 'CVERInc/tile' },
  // renamed: the page still links the old name, the forge answers with the new one
  'CVERInc/tugtile': { tag: '0.3.3', releasedAt: '2026-08-09', pushedAt: '2026-08-12', license: 'MIT', archived: false, fullName: 'CVERInc/obsidian-tugtile' },
};
// The sixteen names the page links, sorted — typed out, not derived, so the test does not agree
// with the coral by running the coral's own logic a second time.
const NAMES = ['bleedblend', 'clikae', 'clioil', 'demodeck', 'liquidframe', 'marktile', 'motifmint', 'reepub',
  'seikyusho', 'sheerstatus', 'sheersweep', 'shelfseer', 'signet', 'snapsift', 'tile', 'tugtile'].map((n) => `CVERInc/${n}`);
// Ten repos with a release, plus the archived one. Not filled: marktile (absent), liquidframe ({}),
// and demodeck, motifmint and tile — no release, so there is nothing this coral may say about them.
const RELEASED = ['bleedblend', 'clikae', 'clioil', 'reepub', 'sheerstatus', 'sheersweep', 'shelfseer', 'signet', 'snapsift', 'tugtile'];
const FILLED = 11;

/** A page with a mount point, wired up as the globals the coral reads. */
function page(opts = {}) {
  const doc = parsePage(opts.html || HTML, 'https://site.example/oss/');
  if (opts.lang !== undefined) doc.documentElement.setAttribute('lang', opts.lang);
  const root = doc.createElement('div');
  root.setAttribute('data-dynamic-coral', 'repo-facts');
  root.setAttribute('data-api-base', API);
  for (const [k, v] of Object.entries(opts.attrs || {})) {
    if (v === null) root.attributes.delete(k); else root.setAttribute(k, v);
  }
  const fetch = fakeFetch(opts.response === undefined ? { json: FACTS } : opts.response);
  const window = {};
  Object.assign(globalThis, { document: doc, window, fetch });
  return { doc, root, fetch, window, before: doc.serialize() };
}
const card = (doc, name) => doc.querySelectorAll('.st-item').find((c) => c.querySelector('h2').textContent === name);
/**
 * Is there a node, or not. 🩸 Never hand a node to assert.equal: when it FAILS, node prints both
 * sides, and a node's parentNode and ownerDocument reach the entire page — it does not finish. A
 * knife that should go red in a second instead leaves the file silent until something kills it,
 * which reads like a broken harness and not like a caught bug. So nodes are compared here, and
 * only a boolean and a sentence ever reach assert.
 */
function isNode(expected, node, label = 'a node') {
  assert.ok((node !== null && node !== undefined) === expected, `${label}: ${expected ? 'expected a node and found none' : 'found a node where there should be none'}`);
}

/**
 * Two whole pages are the same string — and when they are not, say WHERE, at once. The saved page
 * is one 38 KB line; handing two of those to assert.equal makes it compute a character diff, which
 * does not finish: a failure here used to look like a test file that printed nothing and hung.
 */
function samePage(actual, expected, label = 'the page') {
  if (actual === expected) return;
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  assert.fail(`${label} changed at offset ${at} (${actual.length} vs ${expected.length} characters):\n`
    + `  expected …${JSON.stringify(expected.slice(Math.max(0, at - 60), at + 120))}\n`
    + `  actual   …${JSON.stringify(actual.slice(Math.max(0, at - 60), at + 120))}`);
}
const fragments = (doc) => doc.querySelectorAll(`[${MARK}]`);
const withoutFragments = (html) => html.replace(new RegExp(`<span class="st-item-updated" ${MARK}="[^"]*">[^<]*<time datetime="[^"]*">[^<]*</time></span>|<span class="st-item-updated" ${MARK}="[^"]*"><span class="st-item-badge">[^<]*</span></span>`, 'g'), '');

// ── the fixture itself ─────────────────────────────────────────────────────────────────────────

test('the fixture DOM writes the real page back out byte for byte', () => {
  samePage(parsePage(HTML).serialize(), HTML);
});

test('and it sees the page a browser would: 16 cards, counted a second way from the source text', () => {
  const doc = parsePage(HTML);
  assert.equal(doc.querySelectorAll('.st-item').length, 16);
  assert.equal(HTML.split('class="st-cell st-item"').length - 1, 16);
  assert.equal(doc.documentElement.lang, 'en');
});

test('CONTROL: the fixture refuses markup-from-a-string, so a coral that builds any is caught', () => {
  const el = parsePage('<p>x</p>').querySelector('p');
  assert.throws(() => { el.innerHTML = '<b>y</b>'; }, /innerHTML is not available/);
  assert.throws(() => el.insertAdjacentHTML('beforeend', '<b>y</b>'), /not available/);
});

// ── what it asks ───────────────────────────────────────────────────────────────────────────────

test('one request, for exactly the repos the cards link — the organisation link is not one', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  assert.equal(p.fetch.calls.length, 1);
  assert.equal(p.fetch.calls[0].url, `${API}${PATH}?repos=${NAMES.join(',')}`);
  assert.equal(p.fetch.calls[0].init.credentials, 'omit', 'a question about public repos carries no cookies');
  assert.ok(HTML.includes('href="https://github.com/CVERInc"'), 'the page does link the organisation');
});

test('data-scope narrows where it looks; a scope that matches nothing asks nothing', async () => {
  const inScope = page({ attrs: { 'data-scope': '.st-collection' } });
  assert.equal((await mountRepoFacts(inScope.root)).filled, FILLED);
  const nowhere = page({ attrs: { 'data-scope': '.no-such-section' } });
  await mountRepoFacts(nowhere.root);
  assert.equal(nowhere.fetch.calls.length, 0);
  samePage(nowhere.doc.serialize(), nowhere.before);
  const broken = page({ attrs: { 'data-scope': 'div >> p' } });
  await mountRepoFacts(broken.root);
  assert.equal(broken.fetch.calls.length, 0);
  samePage(broken.doc.serialize(), broken.before);
});

test('no origin is assumed: without an https data-api-base it asks nobody and changes nothing', async () => {
  for (const base of [null, '', 'http://edge.example', '/relative', 'edge.example']) {
    const p = page({ attrs: { 'data-api-base': base } });
    assert.deepEqual(await mountRepoFacts(p.root), { error: 1 });
    assert.equal(p.fetch.calls.length, 0, `asked with data-api-base=${base}`);
    samePage(p.doc.serialize(), p.before);
  }
});

test('a forge it does not know is not guessed at', async () => {
  const p = page({ attrs: { 'data-forge': 'gitlab' } });
  await mountRepoFacts(p.root);
  assert.equal(p.fetch.calls.length, 0);
  samePage(p.doc.serialize(), p.before);
});

// ── what it writes ─────────────────────────────────────────────────────────────────────────────

test(`it fills ${FILLED} of the 16 cards — the number, not "some"`, async () => {
  const p = page();
  const result = await mountRepoFacts(p.root);
  assert.equal(result.filled, FILLED);
  assert.equal(fragments(p.doc).length, FILLED);
  assert.deepEqual(fragments(p.doc).map((f) => f.getAttribute(MARK)).sort(),
    [...RELEASED, 'seikyusho'].sort().map((n) => `CVERInc/${n}`));
});

test('a release reads "tag · date", absolute; a repo with no release gets nothing at all', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  assert.equal(card(p.doc, 'clikae').querySelector(`[${MARK}]`).textContent, 'v0.40.0 · October 7, 2026');
  assert.equal(card(p.doc, 'tugtile').querySelector(`[${MARK}]`).textContent, '0.3.3 · August 9, 2026');
  assert.equal(card(p.doc, 'clikae').querySelector('time').getAttribute('datetime'), '2026-10-07');
  for (const name of ['demodeck', 'motifmint', 'tile']) {
    isNode(false, card(p.doc, name).querySelector(`[${MARK}]`), `${name} has no release and was given a fragment`);
  }
  const all = fragments(p.doc).map((f) => f.textContent).join('\n');
  assert.equal(/yesterday|today|ago|days?\b/i.test(all), false, `a relative date was written:\n${all}`);
});

test('🔴 the only date on the page is a release date beside its tag — the last push is never shown', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  const times = p.doc.querySelectorAll('time');
  assert.equal(times.length, RELEASED.length, 'one <time> per release, and no other');
  for (const t of times) {
    const name = t.closest(`[${MARK}]`).getAttribute(MARK);
    assert.equal(t.getAttribute('datetime'), FACTS[name].releasedAt, name);
    assert.match(t.parentNode.textContent, /^v?\d[^ ]* · /, `${name}: a date with no tag in front of it`);
  }
  // Every pushedAt in the answer that is not also a release date, in the form it would be shown.
  const pushes = Object.values(FACTS).filter((f) => f.pushedAt && f.pushedAt !== f.releasedAt)
    .map((f) => new Date(f.pushedAt).toLocaleDateString('en', { dateStyle: 'long', timeZone: 'UTC' }));
  assert.ok(pushes.includes('September 28, 2026') && pushes.length >= 10, 'the ruler has something to measure');
  const text = fragments(p.doc).map((f) => f.textContent).join('\n');
  for (const day of pushes) assert.equal(text.includes(day), false, `a last-push date is on the page: ${day}`);
});

test('the fragment sits in the card\'s meta row, before its GitHub link', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  for (const name of ['clikae', 'clioil']) {    // one card with its own GitHub <a>, one that is itself the link
    const slot = card(p.doc, name).querySelector('.st-item-meta-left');
    const kids = slot.children;
    const at = kids.findIndex((k) => k.getAttribute(MARK));
    assert.ok(at >= 0, `${name}: no fragment in .st-item-meta-left`);
    assert.ok(kids[at + 1].className.split(' ').includes('st-item-gh'), `${name}: the fragment is not directly before .st-item-gh`);
  }
});

test('a card whose repo is absent from the answer, unread, or without a release is untouched', async () => {
  const p = page();
  const names = ['marktile', 'liquidframe', 'demodeck'];
  const before = names.map((n) => card(p.doc, n).serialize());
  await mountRepoFacts(p.root);
  assert.deepEqual(names.map((n) => card(p.doc, n).serialize()), before);
});

test('🔴 nothing but the fragments changed: take them out and the page is the original, byte for byte', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  const after = p.doc.serialize();
  assert.notEqual(after, p.before);
  assert.equal(withoutFragments(after), p.before);
});

test('🔴 an archived repo gets the badge and NOTHING else — no tag, no date that would read as "archived on"', async () => {
  for (const [lang, word] of [['en', 'Archived'], ['zh-Hant', '已封存'], ['zh-TW', '已封存'], ['ja', 'アーカイブ済み'], ['JA-jp', 'アーカイブ済み'], ['ko', '보관됨'], ['fr', 'Archived']]) {
    const p = page({ lang });
    await mountRepoFacts(p.root);
    const badges = p.doc.querySelectorAll(`[${MARK}] .st-item-badge`);
    assert.equal(badges.length, 1, 'one archived repo in the answer, one badge on the page');
    assert.ok(badges[0].closest('.st-item') === card(p.doc, 'seikyusho'), 'the badge is on another card');
    const fragment = badges[0].closest(`[${MARK}]`);
    assert.equal(fragment.textContent, word, `${lang}: the answer had a release (v1.4.0, 2026-03-02) and it must not be beside the badge`);
    isNode(false, fragment.querySelector('time'), lang);
  }
});

test('the badge\'s language is the PRIMARY subtag, whole — `jam` is not Japanese and `kok` is not Korean', async () => {
  for (const lang of ['jam', 'kok', 'zhx', 'jav', 'kor-x', 'j', 'zh2']) {
    const p = page({ lang });
    await mountRepoFacts(p.root);
    assert.equal(p.doc.querySelector(`[${MARK}] .st-item-badge`).textContent, 'Archived', lang);
  }
});

test('dates follow <html lang>: en, zh-Hant, ja, ko', async () => {
  const want = { en: 'v0.40.0 · October 7, 2026', 'zh-Hant': 'v0.40.0 · 2026年10月7日', ja: 'v0.40.0 · 2026年10月7日', ko: 'v0.40.0 · 2026년 10월 7일' };
  for (const [lang, text] of Object.entries(want)) {
    const p = page({ lang });
    await mountRepoFacts(p.root);
    assert.equal(card(p.doc, 'clikae').querySelector(`[${MARK}]`).textContent, text, lang);
  }
});

test('a page whose lang is missing or not a language tag still gets dates, in English', async () => {
  for (const lang of ['', 'not a tag!']) {
    const p = page({ lang });
    assert.equal((await mountRepoFacts(p.root)).filled, FILLED);
    assert.equal(card(p.doc, 'clikae').querySelector(`[${MARK}]`).textContent, 'v0.40.0 · October 7, 2026');
  }
});

test('nothing in the answer but the six fields is ever shown — a star count least of all', async () => {
  const starred = Object.fromEntries(Object.entries(FACTS).map(([k, v]) => [k, { ...v, stars: 48213, stargazers_count: 48213, description: 'UNREVIEWED-TEXT', topics: ['UNREVIEWED-TOPIC'] }]));
  const p = page({ response: { json: starred } });
  assert.equal((await mountRepoFacts(p.root)).filled, FILLED);
  const added = fragments(p.doc).map((f) => f.serialize()).join('\n');
  assert.equal(/48213|48,213|★|star|UNREVIEWED/i.test(added), false, added);
  samePage(withoutFragments(p.doc.serialize()), p.before);
});

// ── a renamed repo ─────────────────────────────────────────────────────────────────────────────

test('a renamed repo: the link is NOT rewritten, and the rename is left where a checker can read it', async () => {
  const p = page();
  const link = () => card(p.doc, 'tugtile').querySelector('a.st-item-gh');
  const before = link().serialize();
  const result = await mountRepoFacts(p.root);
  assert.equal(link().serialize(), before);
  assert.equal(link().getAttribute('href'), 'https://github.com/CVERInc/tugtile');
  assert.deepEqual(result.renamed, { 'CVERInc/tugtile': 'CVERInc/obsidian-tugtile' });
  assert.deepEqual(p.window[DIAGNOSTICS]['repo-facts'], { filled: FILLED, renamed: { 'CVERInc/tugtile': 'CVERInc/obsidian-tugtile' } });
  assert.equal(result.filled, fragments(p.doc).length, '`filled` is the number of fragments on the page');
});

test('letter case alone is not a rename', async () => {
  const p = page({ response: { json: { ...FACTS, 'CVERInc/clikae': { ...FACTS['CVERInc/clikae'], fullName: 'cverinc/CLIKAE' } } } });
  assert.deepEqual((await mountRepoFacts(p.root)).renamed, { 'CVERInc/tugtile': 'CVERInc/obsidian-tugtile' });
});

// ── running twice ──────────────────────────────────────────────────────────────────────────────

test('running twice — one after the other, or both at once — writes each fragment once', async () => {
  const p = page();
  await mountRepoFacts(p.root);
  const once = p.doc.serialize();
  await mountRepoFacts(p.root);
  samePage(p.doc.serialize(), once);

  const q = page();
  await Promise.all([mountRepoFacts(q.root), mountRepoFacts(q.root)]);
  assert.equal(fragments(q.doc).length, FILLED);
  samePage(q.doc.serialize(), once);
});

test('🔴 the diagnostic stays true when the script runs more than once: the last run does not report 0', async () => {
  const RENAMED = { 'CVERInc/tugtile': 'CVERInc/obsidian-tugtile' };
  // Two mounts, each run twice — what two copies of the script on a page with two containers do.
  const p = page();
  const other = p.doc.createElement('div');
  other.setAttribute('data-api-base', API);
  other.setAttribute('data-scope', '.st-collection');
  await Promise.all([mountRepoFacts(p.root), mountRepoFacts(other), mountRepoFacts(p.root), mountRepoFacts(other)]);
  assert.equal(p.fetch.calls.length, 4);
  assert.equal(fragments(p.doc).length, FILLED);
  assert.deepEqual(p.window[DIAGNOSTICS]['repo-facts'], { filled: FILLED, renamed: RENAMED });
  // A run that wrote nothing — because everything was already written — says so truthfully too.
  assert.deepEqual(await mountRepoFacts(p.root), { filled: FILLED, renamed: RENAMED });
  // …and a later run that FAILS does not erase what an earlier one recorded.
  globalThis.fetch = fakeFetch({ status: 500, json: {} });
  await mountRepoFacts(p.root);
  assert.deepEqual(p.window[DIAGNOSTICS]['repo-facts'], { filled: FILLED, renamed: RENAMED });
});

// ── every failure is the same failure: nothing happened ────────────────────────────────────────

const untouched = async (name, response, timeoutMs) => {
  const p = page({ response });
  const result = await mountRepoFacts(p.root, timeoutMs);
  assert.deepEqual(result, { error: 1 }, name);
  assert.equal(p.fetch.calls.length, 1, `${name}: the request was never made, so this proves nothing`);
  samePage(p.doc.serialize(), p.before, `${name}: the page changed`);
  assert.equal(fragments(p.doc).length, 0, name);
};

test('🔴 not ok, not JSON, not an object, unreachable, or late ⇒ the page is byte-identical', async () => {
  await untouched('500', { status: 500, json: FACTS });
  await untouched('404', { status: 404, json: { error: 'not_found' } });
  await untouched('429', { status: 429, json: FACTS });
  await untouched('not JSON', { text: '<!doctype html><title>502</title>' });
  await untouched('truncated JSON', { text: JSON.stringify(FACTS).slice(0, 400) });
  await untouched('null', { json: null });
  await untouched('network error', new TypeError('Failed to fetch'));
  await untouched('never answers', 'hang', 30);
});

test('a JSON body of the wrong kind fills nothing', async () => {
  for (const json of ['a string', 42, [FACTS], true]) {
    const p = page({ response: { json } });
    await mountRepoFacts(p.root);
    samePage(p.doc.serialize(), p.before, JSON.stringify(json));
  }
});

test('CONTROL: the timeout is the coral\'s own — the same silent endpoint, given time, is still pending', async () => {
  const p = page({ response: 'hang' });
  const pending = Symbol('pending');
  const mounted = mountRepoFacts(p.root, 5000);
  const first = await Promise.race([mounted, new Promise((r) => setTimeout(() => r(pending), 60))]);
  assert.equal(first, pending, 'it gave up before its own deadline');
  p.fetch.calls[0].init.signal.dispatchEvent(new Event('abort'));   // let the test end
  await mounted;
});

const HOSTILE = '<img src=x onerror=alert(1)>';
const BAD_FIELDS = {
  tag: [HOSTILE, 'v1.0.0<script>', 'latest', '1', 'v1.2.3_beta', 'release-1.2.3', 'v1.0.0 ', 'v' + '1.'.repeat(30) + '1', 1.2, ['v1.0.0']],
  releasedAt: [HOSTILE, '2026-10-07T00:00:00Z', 'yesterday', '2026-02-30', '2026-13-01', '07/10/2026', 20261007],
  pushedAt: [HOSTILE, '2 days ago', '2026-10-7', '"><svg onload=alert(1)>'],
  license: [HOSTILE, 'MIT License', 'MIT"onmouseover="alert(1)', 'x'.repeat(41), { spdx_id: 'MIT' }],
  archived: ['true', 1, HOSTILE],
  fullName: [HOSTILE, 'CVERInc', 'CVERInc/clikae/extra', 'CVERInc/cli kae', 'javascript:alert(1)//x'],
};

test('🔴 one field of the wrong shape, in ANY of the six, costs that card and no other', async () => {
  for (const [field, values] of Object.entries(BAD_FIELDS)) {
    for (const value of values) {
      // The bad field is on ONE repo, and not the first: the other answers are perfect.
      const label = `${field}=${JSON.stringify(value)}`;
      const p = page({ response: { json: { ...FACTS, 'CVERInc/reepub': { ...FACTS['CVERInc/reepub'], [field]: value } } } });
      const before = card(p.doc, 'reepub').serialize();
      const result = await mountRepoFacts(p.root);
      assert.equal(result.filled, FILLED - 1, label);
      assert.equal(card(p.doc, 'reepub').serialize(), before, `${label}: the card with the bad entry was written to`);
      assert.equal(card(p.doc, 'clikae').querySelector(`[${MARK}]`).textContent, 'v0.40.0 · October 7, 2026', label);
      samePage(withoutFragments(p.doc.serialize()), p.before, label);
      assert.equal(p.doc.serialize().includes('onerror'), false, label);
    }
  }
});

test('CONTROL: the same answers with the field put right DO fill that card', async () => {
  const p = page({ response: { json: { ...FACTS, 'CVERInc/reepub': { ...FACTS['CVERInc/reepub'] } } } });
  assert.equal((await mountRepoFacts(p.root)).filled, FILLED);
  assert.equal(card(p.doc, 'reepub').querySelector(`[${MARK}]`).textContent, 'v1.1.0 · August 3, 2026');
});

test('a repo the page never asked about is never read, whatever it carries', async () => {
  const p = page({ response: { json: { ...FACTS, 'someone/else': { tag: HOSTILE }, __proto__: { tag: HOSTILE } } } });
  assert.equal((await mountRepoFacts(p.root)).filled, FILLED);
  assert.equal(p.doc.serialize().includes('onerror'), false);
});

test('🔴 second lock: a value that got past validation is still written as TEXT, never as markup', () => {
  // fillCards is handed facts directly — validation is not in the path at all. What is left is
  // the write itself, and it must not be able to make an element out of a string.
  const p = page();
  const images = p.doc.querySelectorAll('img').length;
  const scripts = p.doc.querySelectorAll('script').length;
  const cards = findCards(p.doc, 'github.com');
  const facts = Object.fromEntries(NAMES.map((n) => [n, {}]));
  facts['CVERInc/clikae'] = { tag: HOSTILE, releasedAt: '2026-10-07', fullName: '<script>alert(1)</script>' };
  fillCards(cards, facts, 'en');
  const frag = card(p.doc, 'clikae').querySelector(`[${MARK}]`);
  assert.equal(frag.textContent, `${HOSTILE} · October 7, 2026`, 'the text is on the page, as text');
  assert.equal(p.doc.querySelectorAll('img').length, images, 'an <img> element was created from an answer');
  assert.equal(p.doc.querySelectorAll('script').length, scripts);
  assert.ok(frag.serialize().includes('&lt;img src=x onerror=alert(1)&gt;'), frag.serialize());
  assert.equal(frag.serialize().includes('<img'), false);
});

// ── the cap ────────────────────────────────────────────────────────────────────────────────────

test('at most 30 repos are asked about, however many cards the page has', async () => {
  // 34 cards for 33 distinct repos (one repeated), uneven on purpose: `.git`, a trailing slash,
  // a deeper path that is not a repo link, and a card with no repo link at all.
  const cardHtml = (i, href) => `<div class="st-item"><h2>p${i}</h2><div class="st-item-meta-left"><a class="st-item-gh" href="${href}">gh</a></div></div>`;
  const cards = [];
  for (let i = 0; i < 33; i++) cards.push(cardHtml(i, `https://github.com/acme/tool-${String(i).padStart(2, '0')}${i === 3 ? '.git' : i === 4 ? '/' : ''}`));
  cards.push(cardHtml(33, 'https://github.com/acme/tool-00'));                 // a second card for repo 00
  cards.push(cardHtml(34, 'https://github.com/acme/tool-00/issues/12'));       // deeper path: not a repo link
  cards.push(cardHtml(35, 'https://example.com/acme/tool-99'));                // another host
  const p = page({ html: `<!doctype html><html lang="en"><body>${cards.join('')}</body></html>`, response: { json: {} } });
  await mountRepoFacts(p.root);
  const asked = new URL(p.fetch.calls[0].url).searchParams.get('repos').split(',');
  assert.equal(asked.length, 30);
  assert.deepEqual(asked, Array.from({ length: 30 }, (_, i) => `acme/tool-${String(i).padStart(2, '0')}`));
  assert.equal(new Set(asked).size, 30, 'a repeated repo is asked about once');
});

test('both cards for one repo are filled from the one answer', async () => {
  const cardHtml = (i) => `<div class="st-item"><h2>p${i}</h2><div class="st-item-meta-left"><a class="st-item-gh" href="https://github.com/acme/tool">gh</a></div></div>`;
  const p = page({
    html: `<!doctype html><html lang="en"><body>${cardHtml(1)}${cardHtml(2)}</body></html>`,
    response: { json: { 'acme/tool': { tag: 'v1.2.0', releasedAt: '2026-01-05' } } },
  });
  assert.equal((await mountRepoFacts(p.root)).filled, 2);
  assert.equal(new URL(p.fetch.calls[0].url).searchParams.get('repos'), 'acme/tool');
});

test('a repository link that is not inside a card is not asked about, and nothing is written beside it', async () => {
  // Prose mentions a repo, the footer links another, and only one of the three is a card.
  const html = '<!doctype html><html lang="en"><body>'
    + '<p class="lede">Built on <a href="https://github.com/acme/loose">loose</a>.</p>'
    + '<div class="st-item"><h2>tool</h2><div class="st-item-meta-left"><a class="st-item-gh" href="https://github.com/acme/tool">gh</a></div></div>'
    + '<footer><div class="st-item-meta-left"><a href="https://github.com/acme/footer">source</a></div></footer>'
    // …and a card that links a host which merely ENDS like the forge's is not a repo card.
    + '<div class="st-item"><h2>lookalike</h2><div class="st-item-meta-left"><a class="st-item-gh" href="https://notgithub.com/acme/lookalike">gh</a></div></div>'
    + '</body></html>';
  const answer = { tag: 'v1.0.0', releasedAt: '2026-03-04' };
  const p = page({ html, response: { json: { 'acme/loose': answer, 'acme/tool': answer, 'acme/footer': answer, 'acme/lookalike': answer } } });
  assert.equal((await mountRepoFacts(p.root)).filled, 1);
  assert.equal(new URL(p.fetch.calls[0].url).searchParams.get('repos'), 'acme/tool');
  assert.equal(p.doc.querySelector('.lede').serialize(), '<p class="lede">Built on <a href="https://github.com/acme/loose">loose</a>.</p>');
  isNode(false, p.doc.querySelector('footer').querySelector(`[${MARK}]`));
});

// ── the network, for real ──────────────────────────────────────────────────────────────────────

/** A real HTTP server on a free local port. `hits` counts what reached it. */
async function serve(handler) {
  const server = createServer((req, res) => { server.hits.push(req.url); handler(req, res); });
  server.hits = [];
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.origin = `http://127.0.0.1:${server.address().port}`;
  return server;
}
const answerJson = (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(FACTS)); };
/** The page's https endpoint, played by a local server — through the REAL fetch, with the coral's own init. */
const through = (origin) => { globalThis.fetch = (url, init) => realFetch(String(url).replace(API, origin), init); };

test('🔴 a redirect to another origin is not followed: the browser talks to the endpoint the page named and to no other', async () => {
  const elsewhere = await serve((req, res) => answerJson(res));
  const endpoint = await serve((req, res) => { res.writeHead(302, { Location: `${elsewhere.origin}${req.url}` }); res.end(); });
  try {
    const p = page();
    through(endpoint.origin);
    assert.deepEqual(await mountRepoFacts(p.root), { error: 1 });
    assert.equal(endpoint.hits.length, 1, 'the request never reached the endpoint, so this proves nothing');
    assert.equal(elsewhere.hits.length, 0, 'the visitor was sent on to another origin, and went');
    samePage(p.doc.serialize(), p.before);
  } finally {
    endpoint.close();
    elsewhere.close();
  }
});

test('CONTROL: the same real fetch against a server that simply answers DOES fill the page', async () => {
  const endpoint = await serve((req, res) => answerJson(res));
  try {
    const p = page();
    through(endpoint.origin);
    assert.equal((await mountRepoFacts(p.root)).filled, FILLED);
    assert.equal(endpoint.hits.length, 1);
    assert.equal(new URL(endpoint.hits[0], endpoint.origin).searchParams.get('repos'), NAMES.join(','));
  } finally {
    endpoint.close();
  }
});

// ── the calendar day does not depend on where the visitor is ───────────────────────────────────

test('🔴 a release dated the 7th reads the 7th west of Greenwich too', () => {
  // A child process, because the zone is read once when a process starts. Los Angeles is behind
  // UTC all year, so a date formatted in the visitor's own zone lands on the day before.
  const here = (file) => pathToFileURL(join(HERE, file)).href;
  const code = `
    import { mountRepoFacts, MARK } from ${JSON.stringify(here('repo-facts-core.mjs'))};
    import { parsePage, fakeFetch } from ${JSON.stringify(here('fake-page.mjs'))};
    const doc = parsePage('<!doctype html><html lang="en"><body><div class="st-item"><div class="st-item-meta-left"><a class="st-item-gh" href="https://github.com/acme/tool">gh</a></div></div></body></html>');
    const root = doc.createElement('div');
    root.setAttribute('data-api-base', 'https://edge.example');
    Object.assign(globalThis, { document: doc, window: {}, fetch: fakeFetch({ json: { 'acme/tool': { tag: 'v1.0.0', releasedAt: '2026-10-07' } } }) });
    await mountRepoFacts(root);
    console.log(JSON.stringify({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      shown: doc.querySelector('[' + MARK + ']').textContent,
      unpinned: new Date('2026-10-07').toLocaleDateString('en', { dateStyle: 'long' }),
    }));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout);
  assert.equal(out.zone, 'America/Los_Angeles', 'the child did not take the zone, so this proves nothing');
  assert.equal(out.unpinned, 'October 6, 2026', 'CONTROL: in this zone an unpinned format IS a day early');
  assert.equal(out.shown, 'v1.0.0 · October 7, 2026');
});
