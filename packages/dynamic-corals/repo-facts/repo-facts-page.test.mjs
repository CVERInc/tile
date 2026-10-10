// REEF with Repo Facts — the coral, run against a REAL page.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-page.test.mjs
//
// fixtures/collection-page.html is the `collection` section of the live /oss/ page, saved verbatim
// inside a bare document: sixteen cards, each with an "Updated …" line somebody typed once and a
// GitHub link (fourteen as their own anchor, two as the card-wide link). The coral's contract is
// with markup somebody else renders, so no byte of that section was written for this test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountRepoFacts, DIAGNOSTICS, MARK, PATH } from './repo-facts-core.mjs';
import { parsePage, fakeFetch } from './fake-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'fixtures/collection-page.html'), 'utf8');
const API = 'https://edge.example';
const NOW = Date.parse('2026-10-10T12:00:00Z');
const f = (pushed_at, archived = false, name) => ({ name, pushed_at, archived, stars: 1 });
// What the edge would answer. `marktile` and `tugtile` are absent, as they are for real: the page
// links names the owner no longer has. `liquidframe` carries a malformed day.
const FACTS = {
  clikae: f('2026-10-07'), bleedblend: f('2026-10-09'), tile: f('2026-10-10'), sheerstatus: f('2026-10-08'),
  demodeck: f('2026-07-05'), seikyusho: f('2026-07-14', true), sheersweep: f('2026-08-15'),
  clioil: f('2026-09-28'), motifmint: f('2026-09-28'), reepub: f('2026-09-28'), shelfseer: f('2026-09-28'),
  signet: f('2026-09-28'), snapsift: f('2026-09-28'), liquidframe: f('yesterday'),
};
const FILLED = 13;

function page(opts = {}) {
  const doc = parsePage(opts.html || HTML, 'https://site.example/oss/');
  if (opts.lang !== undefined) doc.documentElement.setAttribute('lang', opts.lang);
  const root = doc.createElement('div');
  const attrs = { 'data-dynamic-coral': 'repo-facts', 'data-owner': 'CVERInc', 'data-api-base': API, ...opts.attrs };
  for (const [k, v] of Object.entries(attrs)) if (v !== null) root.setAttribute(k, v);
  const fetch = fakeFetch(opts.response === undefined ? { json: FACTS } : opts.response);
  Object.assign(globalThis, { document: doc, window: {}, fetch });
  return { doc, root, fetch, before: doc.serialize(), run: () => mountRepoFacts(root, { now: NOW, timeoutMs: opts.timeoutMs }) };
}
const card = (doc, name) => doc.querySelectorAll('.st-item').find((c) => c.querySelector('h2').textContent === name);
const updated = (doc, name) => card(doc, name).querySelector('.st-item-updated').textContent;
const badges = (doc, name) => card(doc, name).querySelectorAll('.st-item-badge').map((b) => b.textContent);

test('the fixture DOM writes the real page back out byte for byte, and sees 16 cards', () => {
  const doc = parsePage(HTML);
  assert.ok(doc.serialize() === HTML);
  assert.equal(doc.querySelectorAll('.st-item').length, 16);
  assert.equal(doc.querySelectorAll('.st-item-updated').length, 16);
});

test('one request, for the owner, with no cookies and no redirect', async () => {
  const p = page();
  await p.run();
  assert.equal(p.fetch.calls.length, 1);
  assert.equal(p.fetch.calls[0].url, `${API}${PATH}?owner=CVERInc`);
  assert.equal(p.fetch.calls[0].init.credentials, 'omit');
  assert.equal(p.fetch.calls[0].init.redirect, 'error');
});

test(`it fills ${FILLED} of the 16 cards — the number, not "some"`, async () => {
  const p = page();
  assert.deepEqual(await p.run(), { filled: FILLED, skipped: 0 });
  assert.deepEqual(globalThis.window[DIAGNOSTICS]['repo-facts'], { filled: FILLED, skipped: 0 });
});

test('en: the "Updated …" line is recomputed from the last push, in the words the page already uses', async () => {
  const p = page();
  await p.run();
  assert.equal(updated(p.doc, 'tile'), 'Updated today');
  assert.equal(updated(p.doc, 'bleedblend'), 'Updated yesterday');
  assert.equal(updated(p.doc, 'sheerstatus'), 'Updated 2 days ago');
  assert.equal(updated(p.doc, 'clikae'), 'Updated 3 days ago');
  assert.equal(updated(p.doc, 'signet'), 'Updated 12 days ago');
  assert.equal(updated(p.doc, 'sheersweep'), 'Updated last month');
  assert.equal(updated(p.doc, 'demodeck'), 'Updated 3 months ago');
});

test('four languages, by <html lang> as the live pages set it — or by data-locale', async () => {
  const want = {
    'zh-Hant': ['今天 更新', '前天 更新', '3 天前 更新', '上個月 更新', '已封存'],
    ja: ['今日 更新', '一昨日 更新', '3 日前 更新', '先月 更新', 'アーカイブ済み'],
    ko: ['업데이트 날짜: 오늘', '업데이트 날짜: 그저께', '업데이트 날짜: 3일 전', '업데이트 날짜: 지난달', '보관됨'],
    en: ['Updated today', 'Updated 2 days ago', 'Updated 3 days ago', 'Updated last month', 'Archived'],
  };
  for (const [lang, [today, two, three, month, archived]] of Object.entries(want)) {
    for (const opts of [{ lang }, { lang: 'en', attrs: { 'data-locale': lang } }]) {
      const p = page(opts);
      await p.run();
      assert.deepEqual(['tile', 'sheerstatus', 'clikae', 'sheersweep'].map((n) => updated(p.doc, n)), [today, two, three, month], JSON.stringify(opts));
      assert.equal(badges(p.doc, 'seikyusho').at(-1), archived);
    }
  }
});

test('a language it has no words for reads English, like the renderer; `jam` is not Japanese', async () => {
  for (const lang of ['fr', 'jam', '', 'not a tag!']) {
    const p = page({ lang });
    await p.run();
    assert.equal(updated(p.doc, 'clikae'), 'Updated 3 days ago', lang);
  }
});

test('🔴 an archived repo gets ONE archived pill after its own badges — also when the script runs twice', async () => {
  const p = page();
  const before = badges(p.doc, 'seikyusho');
  await p.run();
  await p.run();
  assert.deepEqual(badges(p.doc, 'seikyusho'), [...before, 'Archived']);
  assert.equal(card(p.doc, 'seikyusho').querySelector('.st-item-badge[data-dc-repo-facts="seikyusho"]') !== null, true);
  for (const n of ['clikae', 'demodeck']) assert.equal(badges(p.doc, n).includes('Archived'), false);
});

test('a pill the author already typed, in any of the four languages, is not doubled', async () => {
  const html = HTML.replace(/(<h2>seikyusho<\/h2> <span class="st-item-badges">)/, '$1<span class="st-item-badge">已封存</span>');
  const p = page({ html });
  await p.run();
  assert.deepEqual(badges(p.doc, 'seikyusho').filter((b) => b === '已封存' || b === 'Archived'), ['已封存']);
});

test('🔴 a card the answer does not cover is left byte for byte as it was', async () => {
  const p = page();
  const keep = ['marktile', 'tugtile', 'liquidframe'].map((n) => card(p.doc, n).serialize());
  await p.run();
  assert.deepEqual(['marktile', 'tugtile', 'liquidframe'].map((n) => card(p.doc, n).serialize()), keep);
});

test('🔴 nothing but the updated line and the pill changed: undo those two and the page is the original', async () => {
  const p = page();
  await p.run();
  const out = p.doc.serialize()
    .replace(new RegExp(` ${MARK}="[^"]*"`, 'g'), '')
    .replace(/<span class="st-item-badge">Archived<\/span>/, '')
    .replace(/<span class="st-item-updated">[^<]*<\/span>/g, '<span class="st-item-updated"></span>');
  assert.ok(out === p.before.replace(/(<span class="st-item-updated">)[^<]*(<\/span>)/g, '$1$2'));
});

test('🔴 only links to THE owner count: a card linking another owner\'s repo of the same name is untouched', async () => {
  const p = page({ html: HTML.replace('https://github.com/CVERInc/clikae', 'https://github.com/someone/clikae') });
  const keep = card(p.doc, 'clikae').serialize();
  await p.run();
  assert.ok(card(p.doc, 'clikae').serialize() === keep);
});

test('🔴 not ok, not JSON, an array, unreachable, or late ⇒ the page is byte-identical', async () => {
  for (const response of [{ status: 500, json: FACTS }, { text: '<html>' }, { json: [] }, { json: null }, new Error('offline'), 'hang']) {
    const p = page({ response, timeoutMs: 50 });
    assert.deepEqual(await p.run(), { error: 1 });
    assert.ok(p.doc.serialize() === p.before, String(response));
  }
});

test('no https data-api-base, or no owner ⇒ nobody is asked and nothing changes', async () => {
  for (const attrs of [{ 'data-api-base': null }, { 'data-api-base': 'http://edge.example' }, { 'data-owner': null }, { 'data-owner': 'a/b' }]) {
    const p = page({ attrs });
    await p.run();
    assert.equal(p.fetch.calls.length, 0, JSON.stringify(attrs));
    assert.ok(p.doc.serialize() === p.before);
  }
});

test('an entry of the wrong shape costs its card and no other; values are written as text', async () => {
  const p = page({ response: { json: { ...FACTS, clikae: '<b>x</b>', tile: { pushed_at: '<img src=x>', archived: 'yes' } } } });
  const keep = ['clikae', 'tile'].map((n) => card(p.doc, n).serialize());
  assert.deepEqual(await p.run(), { filled: FILLED - 2, skipped: 0 });
  assert.deepEqual(['clikae', 'tile'].map((n) => card(p.doc, n).serialize()), keep);
  assert.equal(updated(p.doc, 'bleedblend'), 'Updated yesterday');
});

// ── 0.1.1: a page that typed no date ─────────────────────────────────────────────────────────────
// fixtures/collection-page-no-updated.html is the same section as cver.net builds it now, with the
// typed `updated:` lines removed from the page: saved verbatim from the preview of /oss/ on
// 2026-10-11. The renderer writes no `.st-item-updated` at all, and the two renamed links are fixed
// (`obsidian-marktile`, `obsidian-tugtile`), so an answer that covers all sixteen fills sixteen.
const BARE = readFileSync(join(HERE, 'fixtures/collection-page-no-updated.html'), 'utf8');
const ALL = { ...FACTS, liquidframe: f('2026-10-09'), 'obsidian-marktile': f('2026-10-09'), 'obsidian-tugtile': f('2026-10-07') };

test('the dateless fixture is the page as built now: 16 cards, not one "Updated" line', () => {
  const doc = parsePage(BARE);
  assert.ok(doc.serialize() === BARE);
  assert.equal(doc.querySelectorAll('.st-item').length, 16);
  assert.equal(doc.querySelectorAll('.st-item-updated').length, 0);
  assert.equal(doc.querySelectorAll('.st-item-meta-left').length, 16);
});

test('🔴 no line on the card ⇒ the coral writes one, first in the meta row: filled is 16, and twice is still once', async () => {
  const p = page({ html: BARE, response: { json: ALL } });
  assert.deepEqual(await p.run(), { filled: 16, skipped: 0 });
  for (const c of p.doc.querySelectorAll('.st-item')) {
    const left = c.querySelector('.st-item-meta-left'), spans = c.querySelectorAll('.st-item-updated');
    assert.equal(spans.length, 1);
    assert.ok(left.children[0] === spans[0], 'the line is the first thing in .st-item-meta-left');
    // the renderer's own `|` exactly where Collection.astro puts one: before a separate GitHub link
    const own = c.querySelector('a.st-item-gh') !== null;
    assert.deepEqual(left.children.map((e) => e.className), own ? ['st-item-updated', 'st-item-sep', 'st-item-gh'] : ['st-item-updated', 'st-item-gh']);
  }
  assert.equal(updated(p.doc, 'clikae'), 'Updated 3 days ago');
  assert.equal(updated(p.doc, 'marktile'), 'Updated yesterday');
  const once = p.doc.serialize();
  assert.deepEqual(await p.run(), { filled: 16, skipped: 0 });
  assert.ok(p.doc.serialize() === once, 'a second run builds nothing new');
  assert.equal(p.doc.querySelectorAll('.st-item-updated').length, 16);
  assert.equal(p.doc.querySelectorAll('.st-item-sep').length, 14);
});

test('🔴 the built line is the renderer\'s markup: undo what the coral added and the page is the original', async () => {
  const p = page({ html: BARE, response: { json: ALL } });
  await p.run();
  const out = p.doc.serialize()
    .replace(/<span class="st-item-updated" data-dc-repo-facts="[^"]*">[^<]*<\/span>/g, '')
    .replace(/<span class="st-item-sep" aria-hidden="true" data-dc-repo-facts="[^"]*">\|<\/span>/g, '')
    .replace(/<span class="st-item-badge" data-dc-repo-facts="seikyusho">Archived<\/span>/, '');
  assert.ok(out === p.before);
});

test('a card the answer does not cover, or whose day is malformed, gets no line built', async () => {
  const p = page({ html: BARE, response: { json: { ...ALL, liquidframe: f('yesterday'), 'obsidian-tugtile': undefined } } });
  const keep = ['liquidframe', 'tugtile'].map((n) => card(p.doc, n).serialize());
  assert.deepEqual(await p.run(), { filled: 14, skipped: 0 });
  assert.deepEqual(['liquidframe', 'tugtile'].map((n) => card(p.doc, n).serialize()), keep);
});

test('a card with a fact but no meta row at all is skipped, and counted', async () => {
  // `tile` links GitHub with the card-wide link, so it still has a fact once its meta row is gone.
  const doc = parsePage(BARE);
  doc.createElement('div').appendChild(card(doc, 'tile').querySelector('.st-item-meta'));
  const p = page({ html: doc.serialize(), response: { json: ALL } });
  const keep = card(p.doc, 'tile').serialize();
  assert.deepEqual(await p.run(), { filled: 15, skipped: 1 });
  assert.ok(card(p.doc, 'tile').serialize() === keep);
});
