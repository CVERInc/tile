// The root of the Cards host: `reef.cards/` is the home deck and `reef.cards/?ref=<handle>` the
// referral deck, behind the switch CARDS_HOME_DECK (serve/home-deck.mjs, card-worker.mjs homeDeckAnswer).
//
//   1. OFF (unset, or any value but the exact string `on` — `On` and ` on ` are off): every answer is
//      the one the Worker gave before the switch existed — every path, in every stage, on every host.
//      Checked against a FIXTURE captured from the merge base (gen-home-deck-off-fixture.mjs), because
//      a comparison of this tree with and without the setting cannot see what the tree always does.
//   2. ON: `/` on reef.cards is the home deck, drawn by the same renderer and deck as any Cards:
//      200, indexable, canonical = the bare origin, one language per page, no store read.
//   3. ON: `/?ref=<handle>` is the referral deck when that handle is live and in the exchange; the
//      handle is checked against the handle grammar before it reaches the page, the store or the
//      visitor's sessionStorage, and the raw value is never written anywhere.
//   4. ON: nothing but `/` changes — unknown paths, the other hosts and the dark stage are as they were.
//
//   node --test packages/cardtile/serve/home-deck.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './card-worker.mjs';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { deckStrings } from '../w3/deck-i18n.mjs';
import { makeWindow } from '../w3/mini-dom.mjs';
import { gridCases, answerOf, answerDiff, atFixedClock, readFixture } from './gen-home-deck-off-fixture.mjs';

const DECK_JS = readFileSync(new URL('../w3/deck.js', import.meta.url), 'utf8');
const home = () => import('./home-deck.mjs');

const SWITCH = { CARDS_HOME_DECK: 'on' };
const CUTOVER = { CARD_CANONICAL_HOST: 'reef.cards' };
const OPEN = { CARDS_HOST_OPEN: 'reef.cards' };

// a referrer whose title is hostile to every sink it could reach: HTML, an attribute, Markdown
const EVIL_TITLE = 'Aster <b>&"\'</b> [x](javascript:alert(1)) **bold** <script>alert(1)</script>';
const cardsFile = (title, { avatar = true } = {}) => [
  '---', 'card-page: t', `title: ${title}`, '---', '', '## grid', '',
  `- [ ] %% card: profile w=6${avatar ? ' avatar="asset:pic"' : ''} %% A public bio`,
  ...(avatar ? ['', '## assets', '', '- [ ] %% card: asset id=pic mime=image/gif %% R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'] : []),
  '',
].join('\n');
const STOP = JSON.stringify({ stopped_at: '2026-01-01T00:00:00.000Z', reason: 'Review requested' });
// generation 0 (no `gen:` row): the body is `<handle>`, the stop `stop:<handle>`, the exchange `pool:<handle>:0`
const POOL = (h, v) => ({ [`pool:${h}:0`]: v });
const SEED = {
  aster: cardsFile(EVIL_TITLE), ...POOL('aster', 'in'),
  plain: cardsFile('Plain', { avatar: false }), ...POOL('plain', 'in'),
  out: cardsFile('Out'), ...POOL('out', 'out'),
  unsaid: cardsFile('Unsaid'),
  stopped: cardsFile('Stopped'), ...POOL('stopped', 'in'), 'stop:stopped': STOP,
};

function store(seed = {}, reads = []) {
  const kv = new Map(Object.entries(seed));
  return {
    get: async (k) => { reads.push(k); return kv.has(k) ? kv.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    put: async (k, v) => { kv.set(k, v); },
  };
}
const ask = async (host, path, { settings = {}, seed = SEED, headers = {}, method = 'GET', reads = [], cards } = {}) => {
  const env = { PREVIEW: 'false', ...settings, CARDS: cards === undefined ? store(seed, reads) : cards };
  const res = await worker.fetch(new Request(`https://${host}${path}`, { method, headers }), env);
  const body = method === 'HEAD' ? '' : await res.text();
  return { status: res.status, headers: [...res.headers].sort(), header: (k) => res.headers.get(k), body, reads };
};
const on = (path, o = {}) => ask('reef.cards', path, { ...o, settings: { ...CUTOVER, ...SWITCH, ...(o.settings || {}) } });
const sameAnswer = (a, b, why) => {
  assert.equal(a.status, b.status, `${why}: status`);
  assert.deepEqual(a.headers, b.headers, `${why}: headers`);
  assert.ok(a.body === b.body, `${why}: the bodies differ`);
};
const rootTag = (body) => /<html[^>]*>/.exec(body)[0];
const bodyOf = (html) => html.slice(html.indexOf('<body'));
const textOf = (html) => bodyOf(html).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n');

// ── the sentences a ruling gives, word for word (zh-TW is the source) ─────────────────────────────
const RULED_HOME = [
  '認識一個人，不必先加入同一個平台。', '地址不會過期。',
  '三種看法', '一句話就能改', '貼進來的時鐘',
  '檔案屬於你', '你做的，都在一個檔案裡，隨時帶得走。', '搬家、換平台，帶著它走就好。',
  'REEF with Domain 有賣，也能免費接你已經有的網域。',
  '真的，這些免費。', '一個地址、兩種語言、各種玩法。',
  '你的 Cards，比想像中能裝。', '共 25 MB', '約 870 萬字', '約 60 張圖',
];
const RULED_FIRST_BACK = [
  '這是什麼？', '一個網站、一疊名片、一副卡牌、一份簡報⋯⋯', '怎麼用，都可以；有深度，可把玩。',
  '免費註冊，不插廣告，不綁住你。', 'REEF — Rise, Emerge, Evolve, Flourish, with Cards.',
];
const RULED_REF = [
  'REEF with Cards', '的那一頁，就是用這個做的。', '免費，不用註冊就能試。',
  '歡迎試玩，免註冊，滿意再存起來。', '改字、換圖、拖拉排序；存的時候留 email、不用密碼，改的跟著走',
  '說得好聽不夠，還要說得好看。', '接上慣用的 AI，用說的改；免費網頁版 ChatGPT、Claude 都可以',
  '看看別人做了什麼。', '隨機探索，遇見沒想過的人。',
];

// ── 1. OFF ───────────────────────────────────────────────────────────────────────────────────────
const NOT_ON = [undefined, '', '0', 'off', 'true', '1', 'reef.cards', 'onn', 'home', 'On', 'ON', ' ON ', ' on', 'on ', 'on\n'];
for (const [stage, settings] of [['dark', {}], ['open stage', OPEN], ['cutover', CUTOVER]]) {
  test(`OFF, ${stage}: reef.cards/ and /?ref= answer exactly as without the setting, whatever it says short of "on"`, async () => {
    for (const path of ['/', '/?ref=aster', '/?ref=nobody']) {
      const before = await ask('reef.cards', path, { settings });
      for (const v of NOT_ON) {
        const after = await ask('reef.cards', path, { settings: { ...settings, ...(v === undefined ? {} : { CARDS_HOME_DECK: v }) } });
        sameAnswer(after, before, `${stage} ${path} CARDS_HOME_DECK=${JSON.stringify(v)}`);
        assert.ok(!/data-reef-(home|ref)/.test(after.body), `${stage} ${path}: a home deck with the switch off`);
      }
    }
  });
}
test('OFF, cutover: the root is still the stored root page when there is one, and the nothing-here page when not', async () => {
  const withRoot = await ask('reef.cards', '/', { settings: CUTOVER, seed: { feelreef: cardsFile('Root Page') } });
  assert.equal(withRoot.status, 200);
  assert.match(withRoot.body, /<title>Root Page<\/title>/);
  const without = await ask('reef.cards', '/', { settings: CUTOVER });
  assert.equal(without.status, 404, 'CONTROL: this is the 404 the home deck replaces');
});


// The grid a review of this switch drew: 3 stages × 6 hosts × 14 paths, each asked with the setting
// unset and with three values that are not `on`. The expected answer is NOT this tree's: it is the
// fixture, captured from the tree before the home deck existed.
const FIXTURE = readFixture();
const OFF_FLAGS = [undefined, 'off', 'On', ' ON '];
const shown = (list) => `${list.length} answers differ from the merge base's:\n  ${list.slice(0, 12).join('\n  ')}${list.length > 12 ? '\n  …' : ''}`;
test('the fixture is the whole grid, captured from one commit', () => {
  assert.match(FIXTURE.base, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FIXTURE.answers), gridCases().map((c) => c.key));
  assert.equal(gridCases().length, 252);
  // CONTROL: the fixture is of real answers — the sandbox is a page of hundreds of KB, the dark host an empty 404
  assert.ok(FIXTURE.answers['dark card.feelreef.com /try/edit'].bytes > 100000);
  assert.deepEqual([FIXTURE.answers['dark reef.cards /'].status, FIXTURE.answers['dark reef.cards /'].bytes], [404, 0]);
});
test('OFF: every answer of the grid — every path, host and stage, the sandbox included — is byte for byte the one the Worker gave before the home deck existed', async () => {
  const differ = [];
  let asked = 0;
  await atFixedClock(async () => {
    for (const c of gridCases()) {
      for (const flag of OFF_FLAGS) {
        asked++;
        const d = answerDiff(await answerOf(worker, c, flag), FIXTURE.answers[c.key]);
        if (d) differ.push(`${c.key} CARDS_HOME_DECK=${JSON.stringify(flag)}: ${d}`);
      }
    }
  });
  assert.equal(asked, 1008);
  assert.equal(differ.length, 0, shown(differ));
});
test('ON: everything in the grid but the root of the Cards host is still byte for byte the merge base\'s answer', async () => {
  const isRoot = (c) => c.host === 'reef.cards' && c.stage !== 'dark' && (c.path === '/' || c.path.startsWith('/?'));
  const differ = [];
  let asked = 0; let roots = 0;
  await atFixedClock(async () => {
    for (const c of gridCases()) {
      const got = await answerOf(worker, c, 'on');
      const d = answerDiff(got, FIXTURE.answers[c.key]);
      if (isRoot(c)) { roots++; assert.ok(d, `CONTROL: ${c.key} is the home deck with the switch on, so it must differ from the fixture`); continue; }
      asked++;
      if (d) differ.push(`${c.key}: ${d}`);
    }
  });
  assert.deepEqual([asked, roots], [244, 8]);
  assert.equal(differ.length, 0, shown(differ));
});
test('OFF: a value that is "on" only after trimming or lower-casing does not open the home deck', async () => {
  for (const v of ['On', 'ON', ' ON ', ' on', 'on ', 'on\n']) {
    const settings = { ...CUTOVER, CARDS_HOME_DECK: v };
    const stored = await ask('reef.cards', '/', { settings, seed: { feelreef: cardsFile('Root Page') } });
    assert.equal(stored.status, 200);
    assert.match(stored.body, /<title>Root Page<\/title>/, `${JSON.stringify(v)}: the stored root page is still the root`);
    assert.ok(!/data-reef-(home|ref)/.test(stored.body), `${JSON.stringify(v)}: a home deck`);
    assert.equal((await ask('reef.cards', '/', { settings })).status, 404, `${JSON.stringify(v)}: with no stored root page the root is still the nothing-here page`);
  }
});

// ── 2. ON: the home deck ─────────────────────────────────────────────────────────────────────────
test('ON, cutover: reef.cards/ is the home deck — 200, HTML, the deck every Cards page carries', async () => {
  const r = await on('/', { headers: { 'accept-language': 'zh-TW' } });
  assert.equal(r.status, 200);
  assert.equal(r.header('content-type'), 'text/html; charset=utf-8');
  assert.match(rootTag(r.body), / data-reef-home[ >]/, 'the root says this is the home deck');
  assert.ok(!/data-reef-ref/.test(rootTag(r.body)));
  assert.match(rootTag(r.body), / lang="zh-TW"/);
  assert.match(rootTag(r.body), / data-view="stack"/, 'it opens as a pile');
  assert.match(r.body, /<link rel="stylesheet" href="\/_deck\/deck-[0-9a-f]+\.css">/);
  assert.match(r.body, /<script src="\/_deck\/deck-[0-9a-f]+\.js"/);
  assert.match(r.body, /<title>REEF with Cards<\/title>/);
});
test('ON: the home deck says the ruled sentences word for word, and the first tile turns over to the shared back', async () => {
  const r = await on('/');
  const text = textOf(r.body);
  // (the clock's name is inside its own sandboxed frame: it is in the page's bytes, not in its text)
  for (const s of [...RULED_HOME, ...RULED_FIRST_BACK]) assert.ok((s === '貼進來的時鐘' ? r.body : text).includes(s), `missing: ${s}`);
  assert.match(r.body, /<iframe[^>]*sandbox="allow-scripts"[^>]*srcdoc="[^"]*貼進來的時鐘/, 'the clock is an embed tile: pasted HTML in a sandboxed frame');
  assert.match(bodyOf(r.body), /data-coral-type="profile"[\s\S]*?data-drawer="what"/, 'the first tile names the back `what`');
});
test('ON: the home is indexable, and its canonical and og:url are the bare origin whatever the query', async () => {
  for (const path of ['/', '/?lang=ja', '/?ref=nobody', '/?utm_source=x']) {
    const r = await on(path);
    assert.equal(r.header('x-robots-tag'), null, `${path}: a robots header on the home`);
    assert.match(r.body, /<link rel="canonical" href="https:\/\/reef\.cards">/, `${path}: canonical`);
    assert.match(r.body, /<meta property="og:url" content="https:\/\/reef\.cards">/, `${path}: og:url`);
    assert.ok(!/<meta name="robots"/.test(r.body), `${path}: a robots meta`);
  }
});
test('ON: a preview deployment keeps the home out of an index, and the kill switch still wins', async () => {
  assert.equal((await on('/', { settings: { PREVIEW: 'true' } })).header('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await on('/?ref=aster', { settings: { PREVIEW: 'true' } })).header('x-robots-tag'), 'noindex, nofollow', 'the referral deck must not weaken it');
  assert.equal((await on('/', { settings: { CARD_NOINDEX_ALL: '1' } })).header('x-robots-tag'), 'noindex');
});
test('ON: the footer is the home\'s own — the one place that says "Powered by feelreef"', async () => {
  const r = await on('/');
  const year = new Date().getFullYear();
  const footer = /<footer class="st-footer">[\s\S]*?<\/footer>/.exec(r.body)[0];
  assert.equal(footer, `<footer class="st-footer"><div><a href="/">&copy; ${year} CVER Inc.</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://feelreef.com/?ref=reef.cards">Powered by feelreef</a></div></footer>`);
});
test('ON: the home deck reads nothing from the store, and answers without one', async () => {
  const r = await on('/');
  assert.deepEqual(r.reads, [], 'the home deck read the store');
  const none = await on('/', { cards: null });
  assert.equal(none.status, 200, 'no store bound: the home deck is a constant');
  const throwing = { get: async () => { throw new Error('store down'); }, getWithMetadata: async () => { throw new Error('store down'); } };
  const down = await on('/?ref=aster', { cards: throwing });
  assert.equal(down.status, 200, 'a store that throws: the home deck, not a 500');
  assert.match(rootTag(down.body), / data-reef-home[ >]/);
});
test('ON: one language per page, said in Vary; a locale with no words of its own gets the source page whole', async () => {
  const { HOME_DECK_WORDS } = await home();
  const zh = await on('/', { headers: { 'accept-language': 'zh-TW' } });
  for (const k of LOCALE_KEYS) {
    const tag = { zh: 'zh-TW', 'zh-Hans': 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR' }[k];
    const r = await on('/', { headers: { 'accept-language': tag } });
    assert.equal(r.header('vary'), 'Accept, Accept-Language', `${k}: Vary`);
    if (!Object.hasOwn(HOME_DECK_WORDS, k)) sameAnswer(r, zh, `${k} has no words yet: the zh-TW page, whole`);
    const q = await on(`/?lang=${tag}`);
    assert.ok(q.body === r.body, `${k}: ?lang= and Accept-Language choose the same page`);
  }
});
test('ON: HEAD answers like GET, POST and a markdown request are not the home deck', async () => {
  const get = await on('/');
  const head = await on('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.deepEqual(head.headers, get.headers);
  for (const o of [{ method: 'POST' }, { headers: { accept: 'text/markdown' } }]) {
    const off = await ask('reef.cards', '/', { ...o, settings: CUTOVER });
    sameAnswer(await on('/', o), off, JSON.stringify(o));
  }
});
test('ON: deck.js comes up on the home deck, and its last card offers the sandbox on the Cards host', async () => {
  const r = await on('/', { headers: { 'accept-language': 'zh-TW' } });
  const session = new Map();
  const win = makeWindow(r.body, { scripts: true, session });
  const doc = win.document, root = doc.documentElement;
  doc.scrollHeightOf = (el) => (el !== root ? 0 : win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length));
  doc.rectOf = () => ({ width: 342, height: 480 });
  win.run(DECK_JS, 'deck.js'); win.tick(3000);
  assert.equal(win.__deckBoot, 'ready', 'the deck did not come up');
  assert.ok(root.classList.contains('deck'));
  const S = deckStrings('zh-TW');
  assert.deepEqual(doc.querySelectorAll('.deck-ours-cta h2').map((e) => e.textContent.trim()), [S.homeCtaTitle], 'the closing card');
  const tryLinks = doc.querySelectorAll('a.try');
  assert.equal(tryLinks.length, 1);
  assert.equal(tryLinks[0].getAttribute('href'), 'https://reef.cards/try/edit');
  assert.equal(doc.querySelectorAll('footer.st-footer a').length, 2, 'the deck left the home\'s footer as served');
  assert.equal(session.size, 0, 'no ref: nothing is kept');
});

// ── 3. ON: the referral deck ─────────────────────────────────────────────────────────────────────
test('ON: /?ref=<a live handle in the exchange> is the referral deck — its four tiles, the ruled words, no closing card', async () => {
  const r = await on('/?ref=aster');
  assert.equal(r.status, 200);
  assert.match(rootTag(r.body), / data-reef-ref[ >]/);
  assert.ok(!/data-reef-home/.test(rootTag(r.body)));
  const text = textOf(r.body);
  for (const s of [...RULED_REF, ...RULED_FIRST_BACK]) assert.ok(text.includes(s), `missing: ${s}`);
  const tiles = bodyOf(r.body).split('<div class="dc-drawer-layer"')[0].match(/<div class="st-cell[ "]/g) || [];
  assert.equal(tiles.length, 4, 'four tiles on the referral deck');
  assert.match(bodyOf(r.body), /data-drawer="try"[^>]* data-back-url="https:\/\/reef\.cards\/try\/edit"/, 'the second tile turns over to its back and carries the sandbox address');
});
test('ON: the referral deck names the referrer as text — nothing in their title becomes markup, a link or emphasis', async () => {
  const r = await on('/?ref=aster');
  const esc = EVIL_TITLE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.ok(r.body.includes(`>${esc}</span>的那一頁，就是用這個做的。`), 'the title, escaped, in the ruled sentence');
  assert.ok(!r.body.includes('<script>alert(1)</script>'));
  assert.ok(!/<b>&/.test(r.body) && !/<strong>bold<\/strong>/.test(r.body), 'the title was read as HTML or Markdown');
  assert.ok(!/href="javascript:/i.test(r.body));
  const headPart = r.body.slice(0, r.body.indexOf('<body'));
  assert.ok(!headPart.includes('Aster'), 'the referrer is not in the head: the page is ours');
  assert.match(headPart, /<title>REEF with Cards<\/title>/);
  assert.ok(!/CARDTILEREF/.test(r.body), 'a placeholder was left in the page');
});
test('ON: the referrer\'s picture is their own avatar address, and is absent when they have none', async () => {
  const withAv = await on('/?ref=aster');
  assert.equal((withAv.body.match(/<img class="ref-av"/g) || []).length, 1);
  assert.match(withAv.body, /<img class="ref-av" src="\/aster\/avatar" alt=""/);
  const without = await on('/?ref=plain');
  assert.match(rootTag(without.body), / data-reef-ref[ >]/, 'CONTROL: this is the referral deck');
  assert.ok(!/<img class="ref-av"/.test(without.body));
  assert.ok(without.body.includes('>Plain</span>的那一頁，就是用這個做的。'));
});
// Seen in a real browser (Chromium, 390 and 1280 wide): a name that is one unbroken word ran past the
// tile's edge and was cut there, in the pile, the row and the wall; with scripts off the page scrolled
// sideways. The longest such word needs nobody's bad will: a 63-character handle whose file has no title.
test('ON: a referrer\'s name that is one unbroken word can break inside its tile — the name sits in an element that lets it', async () => {
  const MAX = `m${'abcdefghij'.repeat(6)}xy`;
  assert.equal(MAX.length, 63, 'CONTROL: the longest handle the grammar allows');
  const WORD = 'Supercalifragilisticexpialidocious'.repeat(2);   // under the name's 80 code points: not shortened
  const untitled = cardsFile('x').replace('title: x\n', '');
  assert.ok(!/^title:/m.test(untitled), 'CONTROL: this file has no title');
  const seed = { [MAX]: untitled, ...POOL(MAX, 'in'), oneword: cardsFile(WORD), ...POOL('oneword', 'in'), aster: SEED.aster, ...POOL('aster', 'in') };
  const WRAPS = '<span class="ref-name" style="overflow-wrap:anywhere">';
  for (const [handle, name] of [[MAX, MAX], ['oneword', WORD]]) {
    const r = await on(`/?ref=${handle}`, { seed });
    assert.match(rootTag(r.body), / data-reef-ref[ >]/, `CONTROL: ${handle} gets the referral deck`);
    assert.ok(bodyOf(r.body).includes(`${WRAPS}${name}</span>的那一頁，就是用這個做的。`), `${handle}: the name is not in an element that may break anywhere`);
    assert.equal(bodyOf(r.body).split(WRAPS).length - 1, 1, `${handle}: the name is drawn once`);
  }
  // what is inside is still the escaped title and nothing else
  const evil = await on('/?ref=aster', { seed });
  const inside = new RegExp(`${WRAPS}([^<]*)</span>`).exec(bodyOf(evil.body));
  assert.ok(inside && inside[1].startsWith('Aster &lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;'), 'the element holds the escaped title as text');
  // the home deck names nobody
  assert.ok(!(await on('/')).body.includes('ref-name'));
});
test('ON: the referral deck is not indexed, names the home as canonical, and links back to the referrer', async () => {
  const r = await on('/?ref=aster');
  assert.equal(r.header('x-robots-tag'), 'noindex');
  assert.match(r.body, /<link rel="canonical" href="https:\/\/reef\.cards">/);
  assert.match(rootTag(r.body), / data-back-href="\/aster"/);
  assert.equal(r.header('vary'), 'Accept, Accept-Language');
  assert.match(r.body, /<a href="https:\/\/feelreef\.com\/\?ref=aster">Powered by feelreef<\/a>/, 'the footer carries the referrer on');
});
test('ON: the ref is kept in sessionStorage — by the page itself, before the deck, and only in the handle grammar', async () => {
  const { REF_STORAGE_KEY } = await home();
  for (const [path, want] of [['/?ref=aster', 'aster'], ['/?ref=ASTER', 'aster'], ['/?ref=nobody', 'nobody'], ['/?ref=out', 'out'], ['/', null], ['/?ref=', null], ['/?ref=feelreef', null]]) {
    const r = await on(path);
    const session = new Map();
    const win = makeWindow(r.body, { scripts: true, session });
    assert.deepEqual([...session], want ? [[REF_STORAGE_KEY, want]] : [], `${path}: sessionStorage after the page's own scripts`);
    const doc = win.document, root = doc.documentElement;
    doc.scrollHeightOf = (el) => (el !== root ? 0 : win.innerHeight * Math.max(1, doc.querySelectorAll('.deck-snap').length));
    doc.rectOf = () => ({ width: 342, height: 480 });
    win.run(DECK_JS, 'deck.js'); win.tick(3000);
    assert.equal(win.__deckBoot, 'ready', `${path}: the deck did not come up`);
    if (root.hasAttribute('data-reef-ref')) {
      assert.equal(doc.querySelectorAll('.deck-ours-cta').length, 0, 'the referral deck has no closing card');
      assert.deepEqual(doc.querySelectorAll('a.deck-home').map((a) => a.getAttribute('href')), [`/${want}`], 'the way back');
    }
  }
});
test('ON: a ref outside the handle grammar is no ref — the home deck, byte for byte, and the raw value nowhere', async () => {
  const plain = await on('/');
  const RAW = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', 'a b', '-lead', 'x.y', 'a/b', 'a'.repeat(64), '%00', 'ａｓｔｅｒ', "';alert(1)//", '../aster', 'aster%0a'];
  for (const raw of RAW) {
    const r = await on(`/?ref=${encodeURIComponent(raw)}`);
    sameAnswer(r, plain, `ref=${JSON.stringify(raw)}`);
    assert.deepEqual(r.reads, [], `ref=${JSON.stringify(raw)}: the store was read`);
  }
});
test('ON: a handle-shaped ref that is missing, stopped, out of the exchange or of unknown exchange state gets one and the same page', async () => {
  const pages = {};
  for (const h of ['nobody', 'stopped', 'out', 'unsaid']) {
    const r = await on(`/?ref=${h}`);
    assert.equal(r.status, 200);
    assert.match(rootTag(r.body), / data-reef-home[ >]/, `${h}: not the home deck`);
    assert.equal(r.header('x-robots-tag'), null);
    for (const t of ['Stopped', 'Out', 'Unsaid']) assert.ok(!r.body.includes(t), `${h}: a title leaked`);
    assert.ok(!r.body.includes(`/${h}/avatar`) && !/data-back-href/.test(r.body));
    // the kept ref is the only thing that may differ: in the script that keeps it and on the footer's link
    const kept = r.body.split(`"cards-ref","${h}"`).join('KEPT').split(`feelreef.com/?ref=${h}"`).join('CARRIED');
    assert.equal(kept.split('KEPT').length, 2, `${h}: kept once`);
    assert.equal(kept.split('CARRIED').length, 2, `${h}: carried once`);
    pages[h] = { ...r, body: kept };
  }
  for (const h of ['stopped', 'out', 'unsaid']) sameAnswer(pages[h], pages.nobody, `${h} vs a handle that never was`);
});

// ── 4. ON: nothing else moves ────────────────────────────────────────────────────────────────────
test('ON: every path but the bare root answers as with the switch off', async () => {
  const seed = { ...SEED, feelreef: cardsFile('Root Page') };
  for (const path of ['/nope', '/aster', '/aster.md', '/feelreef', '/feelreef.md', '/favicon.ico', '/apple-touch-icon.png', '/draw', '/index.md', '/index.html',
    '//', '/report', '/try/edit', '/.well-known/security.txt', '/robots.txt', '/aster/avatar', '/_api/cards/aster']) {
    for (const s of [CUTOVER, OPEN]) {
      sameAnswer(await ask('reef.cards', path, { seed, settings: { ...s, ...SWITCH } }), await ask('reef.cards', path, { seed, settings: s }), `${path} ${JSON.stringify(s)}`);
    }
  }
});
test('ON: the other hosts and the dark stage answer as with the switch off', async () => {
  const seed = { ...SEED, feelreef: cardsFile('Root Page'), 'vanity:own.example': 'aster', 'vanitybind:aster:0:own.example': '1', 'vanityof:aster': 'own.example' };
  for (const host of ['card.feelreef.com', 'saas.feelreef.com', 'x.workers.dev', 'own.example', 'unbound.example', 'feelreef.com']) {
    for (const path of ['/', '/?ref=aster']) {
      for (const s of [{}, OPEN, ...(host === 'feelreef.com' ? [] : [CUTOVER])]) {
        sameAnswer(await ask(host, path, { seed, settings: { ...s, ...SWITCH } }), await ask(host, path, { seed, settings: s }), `${host}${path} ${JSON.stringify(s)}`);
      }
    }
  }
  for (const path of ['/', '/?ref=aster']) {
    const dark = await ask('reef.cards', path, { settings: SWITCH });
    assert.equal(dark.status, 404);
    assert.equal(dark.body, '', 'reef.cards is dark until a stage opens it, switch or no switch');
  }
});
test('ON, open stage: reef.cards/ is the home deck too, kept out of every index like the rest of that stage', async () => {
  const r = await ask('reef.cards', '/', { settings: { ...OPEN, ...SWITCH } });
  assert.equal(r.status, 200);
  assert.match(rootTag(r.body), / data-reef-home[ >]/);
  assert.equal(r.header('x-robots-tag'), 'noindex, nofollow');
  const ref = await ask('reef.cards', '/?ref=aster', { settings: { ...OPEN, ...SWITCH } });
  assert.match(rootTag(ref.body), / data-reef-ref[ >]/);
  assert.equal(ref.header('x-robots-tag'), 'noindex, nofollow');
  // the sandbox is not served on reef.cards in this stage: the links go where it is
  assert.match(ref.body, / data-back-url="https:\/\/card\.feelreef\.com\/try\/edit"/);
});

// ── the words: one table, the source language written, the rest listed for a translator ─────────
test('the words: zh is the source and complete; every other locale is listed as missing, key by key, until it is supplied', async () => {
  const { HOME_DECK_WORDS, HOME_DECK_KEYS, HOME_DECK_MISSING, HOME_DECK_SOURCE } = await home();
  assert.equal(HOME_DECK_SOURCE, 'zh');
  for (const k of HOME_DECK_KEYS) assert.ok(typeof HOME_DECK_WORDS.zh[k] === 'string' && HOME_DECK_WORDS.zh[k].trim(), `zh · ${k}`);
  for (const l of LOCALE_KEYS.filter((x) => x !== 'zh')) {
    const own = HOME_DECK_WORDS[l] || {};
    assert.deepEqual(HOME_DECK_MISSING[l] || [], HOME_DECK_KEYS.filter((k) => !(k in own)), `the missing list of ${l}`);
  }
  assert.deepEqual(Object.keys(HOME_DECK_MISSING).sort(), LOCALE_KEYS.filter((x) => x !== 'zh').sort(), 'today nothing is translated: all eight are listed');
});
test('the open points: every draft sentence is named as a draft, and is in the table and nowhere else', async () => {
  const { HOME_DECK_WORDS, HOME_DECK_KEYS, HOME_DECK_DRAFTS } = await home();
  assert.ok(HOME_DECK_DRAFTS.length > 0);
  for (const k of HOME_DECK_DRAFTS) assert.ok(HOME_DECK_KEYS.includes(k), `${k} is not a key`);
  const ruled = HOME_DECK_KEYS.filter((k) => !HOME_DECK_DRAFTS.includes(k)).map((k) => HOME_DECK_WORDS.zh[k]);
  for (const s of [...RULED_HOME, ...RULED_FIRST_BACK, ...RULED_REF.filter((x) => x !== 'REEF with Cards' && !x.startsWith('的那一頁'))]) {
    assert.ok(ruled.includes(s), `a ruled sentence is missing from the table, or is marked as a draft: ${s}`);
  }
  assert.ok(ruled.includes('{name}的那一頁，就是用這個做的。'));
  assert.ok(HOME_DECK_DRAFTS.includes('freeSmall'), 'the small print about "free" is an open point');
});
test('the switch: the exact string "on", and nothing else', async () => {
  const { homeDeckOn } = await import('./card-worker.mjs');
  assert.equal(homeDeckOn({ CARDS_HOME_DECK: 'on' }), true);
  for (const v of NOT_ON) assert.equal(homeDeckOn(v === undefined ? {} : { CARDS_HOME_DECK: v }), false, JSON.stringify(v));
  for (const v of [true, 1, ['on'], { toString: () => 'on' }]) assert.equal(homeDeckOn({ CARDS_HOME_DECK: v }), false, 'only a string is a setting');
  assert.equal(homeDeckOn(null), false);
  assert.equal(homeDeckOn(undefined), false);
});
