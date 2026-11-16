// tile#340 — the page a visitor gets where there is nothing to show (notFound in card-worker.mjs),
// and the two icon files of the reef.cards origin.
//
//   1. its words follow the visitor (`?lang=`, the older `?locale=`, Accept-Language, English) and the
//      response says so in Vary — while, for one language on one host, it stays ONE page: a stopped
//      handle, a deleted one, one that never existed and a reserved word answer byte for byte the same
//   2. it offers one view, so the deck draws no view switcher
//   3. asked on reef.cards it names and links reef.cards; on every other host of ours it is unchanged
//   4. reef.cards answers /favicon.ico, /favicon.svg and /apple-touch-icon.png with an image even
//      when the platform's own page is not there
//
// reef.cards is asked in both stages it answers in: the cutover (CARD_CANONICAL_HOST) and the open
// stage (CARDS_HOST_OPEN, tile#299), where the request is re-addressed to the old host.
//
//   node --test packages/cardtile/serve/not-found-page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, * as W from './card-worker.mjs';
import { LOCALE_KEYS, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { makeWindow } from '../w3/mini-dom.mjs';

const DECK_JS = readFileSync(new URL('../w3/deck.js', import.meta.url), 'utf8');

const CARDS_FILE = [
  '---', 'card-page: t', 'title: Test Page', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% A public bio',
  '', '## assets', '',
  '- [ ] %% card: asset id=pic mime=image/gif %% R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  '',
].join('\n');
const STOP = JSON.stringify({ stopped_at: '2026-01-01T00:00:00.000Z', reason: 'Review requested' });
const DEAD_GEN = 'a'.repeat(24), NOW_GEN = 'b'.repeat(24);
/** a handle as each "nothing here" state leaves the store */
const STATES = (h) => ({
  never: {},
  stopped: { [h]: CARDS_FILE, [`stop:${h}`]: STOP, [`vanityof:${h}`]: 'own.example' },
  deleted: {
    [`card:${h}:${DEAD_GEN}`]: CARDS_FILE, [`vanityof:${h}:${DEAD_GEN}`]: 'own.example', [`gen:${h}`]: NOW_GEN,
    [`gone:${h}`]: JSON.stringify({ deleted_at: '2026-01-01T00:00:00.000Z' }),
  },
});

function store(seed = {}) {
  const kv = new Map(Object.entries(seed));
  return {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    put: async (k, v) => { kv.set(k, v); },
  };
}

// the three places the page is served from: [name, host, settings, does it name reef.cards?]
const CUTOVER = { CARD_CANONICAL_HOST: 'reef.cards' };
const OPEN = { CARDS_HOST_OPEN: 'reef.cards' };
const FACES = [
  ['card.feelreef.com', 'card.feelreef.com', {}, false],
  ['saas.feelreef.com', 'saas.feelreef.com', {}, false],
  ['reef.cards, open stage', 'reef.cards', OPEN, true],
  ['reef.cards, cutover', 'reef.cards', CUTOVER, true],
];

const ask = async (host, path, { settings = {}, seed = {}, headers = {}, method = 'GET' } = {}) => {
  const res = await worker.fetch(new Request(`https://${host}${path}`, { method, headers }), { PREVIEW: 'false', ...settings, CARDS: store(seed) });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: [...res.headers], header: (k) => res.headers.get(k), bytes, body: bytes.toString('utf8') };
};

const htmlLang = (html) => /<html\b[^>]*\slang="([^"]*)"/.exec(html)?.[1];
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
/** what a visitor can read or follow: the markup without its stylesheets and scripts */
const visible = (html) => html.replace(/<style\b[\s\S]*?<\/style>/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '');

// The sentences, as written in card-worker.mjs. Kept here in full so a change to a visitor's words is a
// change to a test, and so every written language is checked against text nobody derived. The sentence
// names no product: "Cards" is a name, never a count, so "No Cards here." is not a sentence it can be in.
const WORDS = {
  en: 'Nothing here.',
  zh: '這裡什麼都沒有。',
  ja: 'ここには何もありません。',
  ko: '여기에는 아무것도 없습니다.',
  'zh-Hans': '这里什么都没有。',
  de: 'Hier ist nichts.',
  fr: "Il n'y a rien ici.",
  es: 'Aquí no hay nada.',
  pt: 'Não há nada aqui.',
};
const TAGS = {
  en: 'en-US', zh: 'zh-TW', ja: 'ja-JP', ko: 'ko-KR', 'zh-Hans': 'zh-CN',
  de: 'de-DE', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR',
};
const sentence = (html) => /<div class="st-cell st-prose"[^>]*><p>([^<]*)<\/p>/.exec(html)?.[1];

// ── 1. the words follow the visitor ───────────────────────────────────────────────────────────────

test('tile#340 ①: the page speaks the visitor’s language, and says in Vary that it does', async () => {
  for (const [name, host, settings] of FACES) {
    for (const [key, tag] of Object.entries(TAGS)) {
      const viaHeader = await ask(host, '/nobody', { settings, headers: { 'accept-language': `${tag},en;q=0.5` } });
      const viaQuery = await ask(host, `/nobody?lang=${tag}`, { settings, headers: { 'accept-language': 'de' } });
      const viaOldQuery = await ask(host, `/nobody?locale=${tag}`, { settings });
      for (const [how, r] of [['Accept-Language', viaHeader], ['?lang=', viaQuery], ['?locale=', viaOldQuery]]) {
        const where = `${name} · ${tag} by ${how}`;
        assert.equal(r.status, 404, where);
        assert.equal(sentence(r.body), WORDS[key], where);
        assert.equal(htmlLang(r.body), tag, `${where}: <html lang>`);
        assert.equal(r.header('vary'), 'Accept, Accept-Language', `${where}: a cache must key this page by language`);
        assert.equal(r.body, viaHeader.body, `${where}: one language, one page, however it was asked for`);
      }
    }
    const plain = await ask(host, '/nobody', { settings });
    assert.equal(sentence(plain.body), WORDS.en, `${name}: no language named → English`);
    assert.equal(plain.header('vary'), 'Accept, Accept-Language', `${name}: the English answer varies too — it is what the next visitor would be handed`);
  }
});

test('tile#340 ①: the nine written languages are nine different pages', async () => {
  const bodies = new Set();
  for (const tag of Object.values(TAGS)) bodies.add((await ask('card.feelreef.com', '/nobody', { headers: { 'accept-language': tag } })).body);
  assert.equal(bodies.size, 9);
});

test('tile#340 ①: every locale has its sentence; a language outside them gets the English page whole', async () => {
  assert.equal(typeof W.NOT_FOUND_WORDS, 'object', 'card-worker.mjs exports no NOT_FOUND_WORDS');
  assert.deepEqual(W.NOT_FOUND_WORDS, WORDS, 'the sentences are the ones this file spells out');
  assert.deepEqual(Object.keys(TAGS).sort(), [...LOCALE_KEYS].sort(), 'this file asks in every locale');
  for (const key of LOCALE_KEYS) assert.equal(SANDBOX_LOCALES[key].lang, TAGS[key], `${key}: the tag this file asks with`);
  const missing = LOCALE_KEYS.filter((k) => !W.NOT_FOUND_WORDS[k]);
  assert.deepEqual(missing, [], 'a locale with no sentence of its own');
  const english = await ask('card.feelreef.com', '/nobody');
  for (const tag of ['it-IT', 'nl', 'xx']) {
    const r = await ask('card.feelreef.com', '/nobody', { headers: { 'accept-language': tag } });
    assert.equal(r.body, english.body, `${tag}: not the English page byte for byte (a page in two languages)`);
    assert.deepEqual(r.headers, english.headers, tag);
  }
});

// ── …and it is still ONE page per language ────────────────────────────────────────────────────────

test('tile#340 ①: for one language on one host, every "nothing here" answer is the same page — no byte depends on the handle or on why', async () => {
  for (const [name, host, settings] of FACES) {
    for (const tag of [null, ...Object.values(TAGS)]) {
      const headers = tag ? { 'accept-language': tag } : {};
      const bodies = new Map();
      const add = (why, r) => { assert.equal(r.status, 404, `${name} ${tag} ${why}`); bodies.set(why, r.body); };
      for (const h of ['t', 'zlingart', 'a-much-longer-handle-nobody-registered', 'demo-someone']) {
        const answers = {};
        for (const [state, seed] of Object.entries(STATES(h))) {
          answers[state] = await ask(host, `/${h}`, { settings, seed, headers });
          add(`/${h} ${state}`, answers[state]);
        }
        // the same address, whatever happened to it: status, every header and every byte
        for (const state of ['stopped', 'deleted']) {
          assert.deepEqual({ ...answers[state], header: null }, { ...answers.never, header: null }, `${name} ${tag} /${h}: ${state} is distinguishable from never-existed`);
        }
        if (h.length > 4) assert.ok(!answers.never.body.includes(h), `${name} ${tag}: the page echoes the handle ${h}`);
      }
      add('a reserved word', await ask(host, '/admin', { settings, headers }));
      // `/try` is the editor's own path: in the open stage reef.cards does not answer it at all
      // (tile#299, the dark 404 — a route's answer, the same for everyone, not a handle's)
      if (settings !== OPEN) add('the editor’s bare path', await ask(host, '/try', { settings, headers }));
      add('a sub-path', await ask(host, '/t/nothing', { settings, headers }));
      add('a sub-path of a live handle', await ask(host, '/t/nothing', { settings, seed: { t: CARDS_FILE }, headers }));
      add('the bare origin', await ask(host, '/', { settings, headers }));
      add('the bare origin, the platform’s own page stopped', await ask(host, '/', { settings, seed: STATES('feelreef').stopped, headers }));
      add('upper case and a query', await ask(host, '/T/?utm_source=qr', { settings, headers }));
      const distinct = new Set(bodies.values());
      assert.equal(distinct.size, 1, `${name} ${tag}: ${distinct.size} different pages among ${[...bodies.keys()].join(' · ')}`);
    }
  }
});

test('tile#340 ①: CONTROL — the comparison above can tell two pages apart', async () => {
  const a = await ask('card.feelreef.com', '/t', { headers: { 'accept-language': 'ja' } });
  const b = await ask('card.feelreef.com', '/t', { headers: { 'accept-language': 'zh-TW' } });
  const live = await ask('card.feelreef.com', '/t', { seed: { t: CARDS_FILE } });
  assert.notEqual(a.body, b.body);
  assert.equal(live.status, 200);
  assert.ok(live.body.includes('A public bio'));
});

test('tile#340 ①: a creator’s own domain keeps its small 404 in every language', async () => {
  for (const tag of [null, 'ja', 'zh-TW']) {
    const r = await ask('unbound.example', '/', { headers: tag ? { 'accept-language': tag } : {} });
    assert.equal(r.status, 404);
    assert.equal(r.body, '<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>');
    assert.equal(r.header('vary'), 'Accept');
  }
});

// ── 2. no view switcher ───────────────────────────────────────────────────────────────────────────

test('tile#340 ②: the page offers one view, so the deck shows no view switcher', async () => {
  for (const [name, host, settings] of FACES) {
    const { body } = await ask(host, '/nobody', { settings });
    assert.match(body, /<html data-view="stack" data-views="stack"/, `${name}: the markup offers more than the one view`);
    // the real deck script over the real page
    for (const stored of [null, 'spread', 'list']) {
      const win = makeWindow(body, { scripts: true, storage: stored ? { 'reef-card-layout': stored } : undefined });
      const doc = win.document, root = doc.documentElement;
      doc.scrollHeightOf = (el) => (el !== root ? 0 : win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length));
      doc.rectOf = () => ({ width: 342, height: 480 });
      win.run(DECK_JS, 'deck.js'); win.tick(3000);
      const seg = doc.querySelector('.deck-seg');
      assert.ok(seg, `${name}: the deck did not come up (the check below would pass on an empty page)`);
      assert.equal(seg.style.display, 'none', `${name} (stored pick ${stored}): the switcher is shown`);
      assert.equal(seg.querySelectorAll('button').length, 1, `${name}: buttons for views the page does not offer`);
      assert.equal(root.dataset.view, 'stack', `${name} (stored pick ${stored}): a view the page does not offer was opened`);
    }
  }
});

test('tile#340 ②: CONTROL — an ordinary page still gets its switcher from the same script', async () => {
  const { body } = await ask('card.feelreef.com', '/t', { seed: { t: CARDS_FILE } });
  const win = makeWindow(body, { scripts: true });
  const doc = win.document, root = doc.documentElement;
  doc.scrollHeightOf = (el) => (el !== root ? 0 : win.innerHeight);
  doc.rectOf = () => ({ width: 342, height: 480 });
  win.run(DECK_JS, 'deck.js'); win.tick(3000);
  const seg = doc.querySelector('.deck-seg');
  assert.notEqual(seg.style.display, 'none');
  assert.equal(seg.querySelectorAll('button').length, 3);
});

// ── 3. the name on the page ───────────────────────────────────────────────────────────────────────

test('tile#340 ③: asked on reef.cards the page names and links reef.cards, never feelreef; elsewhere it is as it was', async () => {
  for (const [name, host, settings, named] of FACES) {
    for (const tag of [null, 'zh-TW', 'ja']) {
      const { body } = await ask(host, '/nobody', { settings, headers: tag ? { 'accept-language': tag } : {} });
      const seen = visible(body);
      const where = `${name} ${tag}`;
      if (named) {
        assert.equal(titleOf(body), 'reef.cards', where);
        assert.match(seen, /<a class="st-cell-link" href="https:\/\/reef\.cards\/"/, `${where}: the link`);
        assert.match(seen, /<div class="st-cell-title">reef\.cards<\/div>/, `${where}: the link’s name`);
        assert.match(seen, /<footer class="st-footer"><div><span>reef\.cards &copy; \d{4}<\/span><\/div><\/footer>/, `${where}: the footer`);
        assert.doesNotMatch(seen, /feelreef/i, `${where}: feelreef is named or linked on reef.cards`);
      } else {
        assert.equal(titleOf(body), 'feelreef', where);
        assert.match(seen, /<a class="st-cell-link" href="https:\/\/feelreef\.com\/"/, `${where}: the link`);
        assert.match(seen, /<div class="st-cell-title">feelreef<\/div>/, `${where}: the link’s name`);
        assert.match(seen, /<footer class="st-footer"><div><span>feelreef &copy; \d{4}<\/span><\/div><\/footer>/, `${where}: the footer`);
        assert.doesNotMatch(seen, /reef\.cards/i, `${where}: reef.cards is named on a host that is not reef.cards`);
      }
      assert.doesNotMatch(seen, /signup|register|make a card|create a card|\?handle=|\?ref=/i, `${where}: a registration button or a referral`);
    }
  }
});

test('tile#340 ③: the open stage and the cutover hand a reef.cards visitor the same page', async () => {
  for (const tag of [null, 'zh-TW', 'ja']) {
    const headers = tag ? { 'accept-language': tag } : {};
    const open = await ask('reef.cards', '/nobody', { settings: OPEN, headers });
    const cut = await ask('reef.cards', '/nobody', { settings: CUTOVER, headers });
    assert.equal(open.body, cut.body, String(tag));
    // the open stage's own rule (tile#299) still holds: nothing it answers is indexed
    assert.equal(open.header('x-robots-tag'), 'noindex, nofollow');
  }
});

// ── 4. the origin's icon files ────────────────────────────────────────────────────────────────────

const ICONS = [
  ['/favicon.ico', 'image/x-icon', (b) => b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) >= 1],
  ['/favicon.svg', 'image/svg+xml', (b) => b.toString('utf8').startsWith('<svg xmlns="http://www.w3.org/2000/svg"')],
  ['/apple-touch-icon.png', 'image/png', (b) => b.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n' && b.readUInt32BE(16) === 180 && b.readUInt32BE(20) === 180],
];

test('tile#340 ④: reef.cards answers its icon files with real images when the platform’s own page is not there', async () => {
  for (const [name, settings] of [['open stage', OPEN], ['cutover', CUTOVER]]) {
    for (const [path, type, isImage] of ICONS) {
      const answers = {};
      for (const [state, seed] of Object.entries(STATES('feelreef'))) {
        const r = await ask('reef.cards', path, { settings, seed });
        const where = `reef.cards${path} [${name}, ${state}]`;
        assert.equal(r.status, 200, where);
        assert.equal(r.header('content-type'), type, where);
        assert.ok(isImage(r.bytes), `${where}: the bytes are not that kind of image`);
        assert.equal(r.header('x-content-type-options'), 'nosniff', where);
        assert.equal(r.header('cache-control'), 'public, max-age=3600', where);
        answers[state] = r;
      }
      for (const state of ['stopped', 'deleted']) {
        assert.deepEqual({ ...answers[state], header: null }, { ...answers.never, header: null }, `${path} [${name}]: ${state} is distinguishable from never-existed`);
      }
      const head = await ask('reef.cards', path, { settings, method: 'HEAD' });
      assert.equal(head.status, 200, `HEAD ${path} [${name}]`);
      assert.equal(head.header('content-type'), type, `HEAD ${path} [${name}]`);
    }
    // the mark is the origin's own name, not a guest's: the letter in the SVG is reef.cards' initial
    const svg = await ask('reef.cards', '/favicon.svg', { settings, seed: { t: CARDS_FILE } });
    assert.match(svg.body, />R<\/text>/, `[${name}] the badge does not carry reef.cards' initial`);
  }
});

test('tile#340 ④: the platform’s own page, when it is there, still answers with its own picture', async () => {
  for (const settings of [OPEN, CUTOVER]) {
    const r = await ask('reef.cards', '/favicon.ico', { settings, seed: { feelreef: CARDS_FILE } });
    assert.equal(r.status, 200);
    assert.equal(r.header('content-type'), 'image/gif', 'the avatar, in its own type');
  }
});

test('tile#340 ④: only the reef.cards origin gets the mark — a handle’s icon path and the other hosts answer as before', async () => {
  for (const [host, path, settings] of [
    ['reef.cards', '/nobody/favicon.ico', CUTOVER], ['reef.cards', '/nobody/favicon.ico', OPEN],
    ['reef.cards', '/nobody/apple-touch-icon.png', CUTOVER],
    ['card.feelreef.com', '/favicon.ico', {}], ['card.feelreef.com', '/favicon.ico', OPEN], ['card.feelreef.com', '/apple-touch-icon.png', {}],
    ['card.feelreef.com', '/nobody/favicon.ico', {}],
    ['saas.feelreef.com', '/favicon.ico', {}], ['unbound.example', '/favicon.ico', {}],
  ]) {
    const r = await ask(host, path, { settings });
    assert.equal(r.status, 404, `${host}${path} ${JSON.stringify(settings)}`);
    assert.doesNotMatch(String(r.header('content-type')), /^image\//, `${host}${path}`);
  }
});
