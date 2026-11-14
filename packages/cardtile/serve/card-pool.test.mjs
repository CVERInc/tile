// The card pool's render contract (reef#2913). run: node --test card-pool.test.mjs
//
// One PLATFORM switch, `ctx.pool`, decides two things the page draws: the reef.cards footer link and
// the closing reef.cards tile. true → both, false → neither, absent → the page exactly as it was
// before the pool existed (`powered-by: on` drives the old "Powered by feelreef" footer). And the
// switch has ONE writer — the Worker's own call site — so nothing in card.md, the query or the
// headers can reach it.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { renderCardHTML } from './card-worker.mjs';
import { renderPage, POOL_URL, poolOf } from '../card-render.mjs';
import { parseCard } from '../card-core.js';

const CARD = [
  '---', 'card-page: inkbrush', 'title: INKB', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 h=2 avatar="https://x/a.jpg" %% indie comic artist',
  '- [ ] %% card: link w=6 h=1 %% [Shop](https://shop.example)',
].join('\n') + '\n';
const withFm = (md, line) => md.replace('title: INKB', `title: INKB\n${line}`);
const POWERED = { on: withFm(CARD, 'powered-by: on'), off: CARD };
const CTX = { handle: 'inkbrush', cardUrl: 'https://card.feelreef.com/inkbrush' };

const footerOf = (html) => /<footer class="st-footer">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
const has = {
  poolFooter: (h) => footerOf(h).includes(`<a href="${POOL_URL}" target="_blank" rel="noopener noreferrer">reef.cards</a>`),
  poweredFooter: (h) => /Powered by <a href="https:\/\/feelreef\.com\/signup\?ref=inkbrush">feelreef<\/a>/.test(footerOf(h)),
  closingCard: (h) => (h.match(/data-pool="card"/g) || []).length,
  owner: (h) => footerOf(h).includes(`<span>INKB &copy; ${new Date().getFullYear()}</span>`),
};
const POOL_SECTION = /<section class="st-grid st-pool" data-pool="card">[\s\S]*?<\/section>/;

// ── the 3 × 2 matrix ──────────────────────────────────────────────────────────────────────────
const EXPECT = {
  // pool       powered-by  poolFooter poweredFooter closingCard
  'true|on': [true, false, 1],
  'true|off': [true, false, 1],
  'false|on': [false, false, 0],
  'false|off': [false, false, 0],
  'absent|on': [false, true, 0],
  'absent|off': [false, false, 0],
};
for (const pool of [true, false, undefined]) {
  for (const pb of ['on', 'off']) {
    const key = `${pool === undefined ? 'absent' : pool}|${pb}`;
    test(`matrix: pool ${pool === undefined ? 'absent' : pool} × powered-by ${pb}`, () => {
      const ctx = pool === undefined ? { ...CTX } : { ...CTX, pool };
      const html = renderCardHTML(POWERED[pb], ctx);
      const [wantPool, wantPowered, wantCard] = EXPECT[key];
      assert.equal(has.poolFooter(html), wantPool, 'reef.cards footer link');
      assert.equal(has.poweredFooter(html), wantPowered, 'Powered by feelreef footer');
      assert.equal(has.closingCard(html), wantCard, 'closing reef.cards tile count');
      assert.ok(has.owner(html), "the owner's copyright line always stays");
      // the pool's link never carries a referral, anywhere on the page
      assert.ok(!/reef\.cards\/?\?ref=/.test(html), 'no ?ref= on reef.cards');
    });
  }
}

test('matrix control: the two powered-by fixtures really differ when pool is absent', () => {
  // without this, "absent|on shows the old footer" and "the fixture never set powered-by" look alike
  assert.notEqual(renderCardHTML(POWERED.on, CTX), renderCardHTML(POWERED.off, CTX));
});

// ── absent is today's page ────────────────────────────────────────────────────────────────────
// Byte-for-byte against main's output is a lane receipt (the renderer has no golden file — the CSS
// it inlines moves under every style change). In-suite: absent, and every value that is not a
// boolean, render the same bytes; and with pool absent nothing pool-shaped appears.
test('absent: undefined, null, "on", "true", 1 and {} all render the same bytes as no key at all', () => {
  for (const md of [POWERED.on, POWERED.off]) {
    const base = renderCardHTML(md, CTX);
    for (const v of [undefined, null, 'on', 'true', 'false', 1, 0, {}]) {
      assert.equal(renderCardHTML(md, { ...CTX, pool: v }), base, `pool: ${JSON.stringify(v)}`);
    }
    assert.ok(!/reef\.cards|st-pool|data-pool/.test(base), 'nothing pool-shaped when absent');
  }
  assert.equal(poolOf({ pool: 'on' }), undefined);
  assert.equal(poolOf({}), undefined);
  assert.equal(poolOf(undefined), undefined);
});

// a set pool also tells the deck to draw none of its own (see the deck tests below)
const DECK_OFF = 'window.__pool=false;';
const dropDeckOff = (h) => h.replace(DECK_OFF, '');

test('pool: true changes only the footer link, the appended closing card and the deck switch', () => {
  // The rest of the page is untouched: strip the closing card and the deck's switch and swap the
  // footer back, and it is the powered-by-off page byte for byte.
  const off = renderCardHTML(POWERED.off, CTX);
  const on = renderCardHTML(POWERED.on, { ...CTX, pool: true });
  assert.ok(!off.includes('window.__pool'), 'setup: absent says nothing to the deck');
  const back = dropDeckOff(on).replace(POOL_SECTION, '').replace(footerOf(on), footerOf(off));
  assert.equal(back, off);
  // and pool:false is the powered-by-off page plus the deck's switch
  assert.equal(dropDeckOff(renderCardHTML(POWERED.on, { ...CTX, pool: false })), off);
});

test('closing card: last block inside the card, a reef.cards link tile, self-contained', () => {
  const html = renderCardHTML(CARD, { ...CTX, pool: true });
  const card = POOL_SECTION.exec(html)?.[0];
  assert.ok(card, 'closing card present');
  // last thing in .st-card: right after it the card closes and <main> ends (no drawers on this card)
  assert.ok(html.includes(`${card}</div></main>`), 'appended after everything the author wrote');
  assert.match(card, /<a class="st-cell-link" href="https:\/\/reef\.cards\/" target="_blank" rel="noopener noreferrer">/);
  assert.match(card, /<div class="st-cell-title">reef\.cards<\/div>/);
  // the card's own tile classes, so it wears the card's surface, line, radius and hover
  assert.match(card, /class="st-cell st-cell-tile st-pool-card" data-span="6x1" data-w="6"/);
  // not part of the file: the editor's index and the coral types must not see it
  assert.ok(!/data-cell=|data-coral-type=/.test(card));
  // no fetch: no src=, no url(), no script, no external host other than the link itself
  assert.ok(!/src=|url\(|<script|<img|<style/.test(card));
  assert.deepEqual([...card.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg'),
    ['https://reef.cards/']);
});

test('closing card: once per page — not repeated inside drawers, and absent from renderPage without pool', () => {
  const md = CARD + '\n## drawer: stockists\n\n- [ ] %% card: link w=6 h=1 %% [A shop](https://a.example)\n';
  const html = renderCardHTML(md, { ...CTX, pool: true });
  assert.ok(/id="stockists"/.test(html), 'setup: the drawer rendered');
  assert.equal(has.closingCard(html), 1);
  // renderPage directly (the cardtile-w / lab path) honours the same contract
  const model = parseCard(CARD);
  assert.equal(has.closingCard(renderPage(model, { name: 'INKB', pool: true })), 1);
  assert.equal(has.closingCard(renderPage(model, { name: 'INKB', pool: false })), 0);
  assert.equal(has.closingCard(renderPage(model, { name: 'INKB' })), 0);
  // pool:true ignores powered-by on the direct path too
  const direct = renderPage(model, { name: 'INKB', handle: 'inkbrush', poweredBy: true, pool: true });
  assert.ok(!/Powered by/.test(direct) && has.poolFooter(direct));
  assert.ok(!/Powered by/.test(renderPage(model, { name: 'INKB', handle: 'inkbrush', poweredBy: true, pool: false })));
});

// ── the deck (w3/deck-page.mjs + w3/deck.js) on every Card page ───────────────────────────────
// deck.js draws its OWN reef.cards closing card (stack / list) and footer link only when the page says
// `window.__pool=true` (absent, false or anything else: out). So when the platform's ctx.pool is set, the renderer is the one writer and
// the deck is told to draw nothing: in stack and list deck.js deals every `.st-cell` in <main> as a
// card in document order, so the renderer's closing tile — the last one — is the deck's last card;
// in wall the page is shown as it is and the tile is its last block. One closing card, one footer
// link, per view. (A real-browser count of all nine pool × view cells is a lane receipt: the suite
// has no DOM.)
const BACKS = CARD.replace('[Shop](https://shop.example)', '[Shop](https://shop.example)\n- [ ] %% card: link w=2 h=2 back=#more %% [IG](https://instagram.com/x)')
  + '\n## back: more\n\n- [ ] %% card: link w=6 h=1 %% [Inside](https://inside.example)\n';
const bootOf = (h) => /<script>(window\.__cardFront=[\s\S]*?)<\/script>/.exec(h)?.[1] ?? '';
const mainOf = (h) => /<main[\s\S]*?<\/main>/.exec(h)?.[0] ?? '';
// the drawers' layer sits inside <main>, after the card; deck.js skips anything in a .dc-drawer
const DRAWERS = '<div class="dc-drawer-layer"';
const faceOf = (h) => mainOf(h).split(DRAWERS)[0];
const drawersOf = (h) => mainOf(h).split(DRAWERS).slice(1).join(DRAWERS);
const cellsInMain = (h) => [...faceOf(h).matchAll(/class="(st-cell(?: [^"]*)?)"/g)].map((m) => m[1]);
const VIEWS = [['live page', {}], ['stack', { deck: { view: 'stack' } }], ['list', { deck: { view: 'list' } }], ['wall', { deck: { view: 'wall' } }]];

for (const [name, extra] of VIEWS) {
  test(`deck (${name}): pool true → one closing tile, last cell in <main>, one footer link, deck draws none`, () => {
    for (const md of [BACKS, withFm(BACKS, 'powered-by: on')]) {
      const html = renderCardHTML(md, { ...CTX, ...extra, pool: true });
      assert.ok(/class="dc-drawer/.test(html) && /<script src="\/_deck\//.test(html), 'setup: a drawer and the deck are on the page');
      assert.equal(has.closingCard(html), 1, 'exactly one closing tile');
      assert.equal(has.closingCard(faceOf(html)), 1, 'and it is on the card face in <main>');
      assert.ok(drawersOf(html).includes('Inside') && has.closingCard(drawersOf(html)) === 0, 'never inside a drawer');
      const cells = cellsInMain(html);
      assert.ok(cells.length > 2, 'setup: the author has cells');
      assert.equal(cells.at(-1), 'st-cell st-cell-tile st-pool-card', 'the last cell deck.js deals is the closing tile');
      assert.equal(cells.filter((c) => c.includes('st-pool-card')).length, 1);
      assert.equal((footerOf(html).match(/href="https:\/\/reef\.cards\//g) || []).length, 1, 'one footer link');
      assert.ok(bootOf(html).includes(DECK_OFF), 'deck.js is told to draw no closing card or footer link of its own');
      assert.ok(!/window\.__pool=true/.test(html));
    }
  });

  test(`deck (${name}): pool false → no closing tile, no footer link, deck draws none`, () => {
    const html = renderCardHTML(withFm(BACKS, 'powered-by: on'), { ...CTX, ...extra, pool: false });
    assert.equal(has.closingCard(html), 0);
    assert.ok(!/reef\.cards/.test(footerOf(html)) && !/Powered by/.test(footerOf(html)));
    assert.ok(bootOf(html).includes(DECK_OFF));
  });

  test(`deck (${name}): pool absent → no renderer pool, the deck's own switch untouched`, () => {
    const html = renderCardHTML(BACKS, { ...CTX, ...extra });
    assert.equal(has.closingCard(html), 0);
    assert.ok(!bootOf(html).includes('__pool'), 'absent says nothing to the deck (deck.js: absent = out of the pool)');
    // the editor's sandbox stand-in (deck.pool) still reaches the deck exactly as before
    if (extra.deck) {
      for (const p of [true, false]) {
        const ed = renderCardHTML(BACKS, { ...CTX, deck: { ...extra.deck, pool: p } });
        assert.ok(bootOf(ed).includes(`window.__pool=${p};`));
        assert.equal(has.closingCard(ed), 0, 'deck.pool alone never draws the renderer tile');
        assert.equal(ed.replace(`window.__pool=${p};`, ''), html);
      }
    }
  });
}

test('deck: a set ctx.pool wins over the deck switch, so nothing is drawn twice', () => {
  for (const p of [true, false]) {
    const html = renderCardHTML(BACKS, { ...CTX, pool: true, deck: { view: 'stack', pool: p } });
    assert.ok(bootOf(html).includes(DECK_OFF) && !/window\.__pool=true/.test(html));
    assert.equal(has.closingCard(html), 1);
  }
});

test('editor: the w3 renders that map boxes to cells never carry the closing tile', () => {
  // editIndex (the layout wall) drops a ctx.pool outright: its page is the author's boxes only
  const plain = renderCardHTML(BACKS, { ...CTX, editIndex: true });
  for (const p of [true, false]) assert.equal(renderCardHTML(BACKS, { ...CTX, editIndex: true, pool: p }), plain);
  assert.equal(has.closingCard(plain), 0);
  // and where the tile does appear, nothing w3 reads to find a tile (data-cell, data-coral-type,
  // [data-drawer-panel]) is on it or around it
  const card = POOL_SECTION.exec(renderCardHTML(BACKS, { ...CTX, pool: true }))?.[0] ?? '';
  assert.ok(card && !/data-cell|data-coral-type|data-drawer|data-noback/.test(card));
});

// ── one writer: the Worker's call site ────────────────────────────────────────────────────────
test('injection: `pool:` in card.md frontmatter does nothing', () => {
  for (const pb of ['on', 'off']) {
    const base = renderCardHTML(POWERED[pb], CTX);
    for (const v of ['on', 'true', 'yes', '1', 'off', 'false']) {
      assert.equal(renderCardHTML(withFm(POWERED[pb], `pool: ${v}`), CTX), base, `pool: ${v} (powered-by ${pb})`);
    }
  }
  // …nor does it override a caller's value
  const callerFalse = renderCardHTML(POWERED.on, { ...CTX, pool: false });
  assert.equal(renderCardHTML(withFm(POWERED.on, 'pool: on'), { ...CTX, pool: false }), callerFalse);
});

test('injection: ?pool= and pool headers on a served card do nothing', async () => {
  const store = (md) => ({ get: async (k) => (k === 'inkbrush' ? md : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } });
  for (const md of [POWERED.on, POWERED.off]) {
    const env = { PREVIEW: 'false', CARDS: store(md) };
    const plain = await (await worker.fetch(new Request('https://card.feelreef.com/inkbrush'), env)).text();
    assert.ok(/st-hero/.test(plain), 'setup: the card was served');
    assert.ok(!/data-pool|reef\.cards\/"/.test(plain), 'setup: no pool today');
    const urls = ['?pool=1', '?pool=true', '?pool=on', '?pool=0', '?pool=false'].map((q) => `https://card.feelreef.com/inkbrush${q}`);
    for (const u of urls) {
      assert.equal(await (await worker.fetch(new Request(u), env)).text(), plain, u);
    }
    for (const [k, v] of [['pool', 'true'], ['x-pool', '1'], ['x-card-pool', 'on'], ['pool', 'false']]) {
      const res = await worker.fetch(new Request('https://card.feelreef.com/inkbrush', { headers: { [k]: v } }), env);
      assert.equal(await res.text(), plain, `${k}: ${v}`);
    }
  }
});

// ── the deck's own decision (deck.js), on the boot config each view's page hands it ──────────
// deck.js is a browser script and this suite has no DOM, so the deck's ONE pool decision is run here as
// the committed deck states it: its single `const POOL=` statement, evaluated against the `window` the
// page's boot script builds. The census around it pins that POOL is the only thing that reads
// `__pool` and that both of the deck's reef.cards draws (footer link, closing card) are gated on it.
// (The same nine cells counted in real Chromium are a lane receipt.)
const { DECK_JS } = await import('./deck-assets.mjs');
const deckCode = DECK_JS.split('\n').filter((l) => !/^\s*\/\//.test(l));
const poolLines = deckCode.filter((l) => /^\s*const POOL=/.test(l));
const deckInPool = (win) => new Function('window', `return ${/^\s*const POOL=(.*);\s*$/.exec(poolLines[0])[1]};`)(win);

test('deck.js: one pool decision, the only reader of __pool, gating both of its reef.cards draws', () => {
  assert.equal(poolLines.length, 1, 'exactly one `const POOL=` statement');
  assert.deepEqual(deckCode.filter((l) => l.includes('__pool')), poolLines, 'nothing else in deck.js reads __pool');
  const code = deckCode.join('\n');
  assert.match(code, /if\(POOL\) fd\.insertAdjacentHTML\('beforeend','[^']*<a href="https:\/\/reef\.cards\/'\+REFQ\+'"/, 'the footer link is drawn only when POOL');
  assert.match(code, /if\(!REF&&\(OURS\|\|POOL\)\) addCard\(reefFront,/, 'the closing card is drawn only when POOL (on a Card page, OURS is false)');
});

test('🔴 deck.js: only window.__pool === true is in the pool — absent, false and anything else are out', () => {
  assert.equal(deckInPool({}), false, '🔴 a page that says nothing about the pool is OUT of it');
  assert.equal(deckInPool({ __pool: true }), true);
  for (const v of [false, undefined, null, 'true', 1, 'on', {}]) assert.equal(deckInPool({ __pool: v }), false, `__pool=${JSON.stringify(v)}`);
});

for (const view of ['stack', 'list', 'wall']) {
  for (const [name, deck, inPool] of [['no __pool', { view }, false], ['__pool=true', { view, pool: true }, true], ['__pool=false', { view, pool: false }, false]]) {
    test(`deck (${view}, ${name}): the deck ${inPool ? 'draws' : 'draws no'} closing card and footer link`, () => {
      const html = renderCardHTML(BACKS, { ...CTX, deck });
      const win = {}; new Function('window', bootOf(html))(win);
      assert.equal('__pool' in win, 'pool' in deck, 'the boot config carries __pool only when the caller set it');
      assert.equal(has.closingCard(html), 0, 'no renderer pool: ctx.pool is unset');
      assert.equal(deckInPool(win), inPool);
    });
  }
}

test('🔴 the live page (no ctx.pool, no deck switch) is out of the pool: the deck draws nothing', () => {
  const html = renderCardHTML(BACKS, CTX);
  const win = {}; new Function('window', bootOf(html))(win);
  assert.equal('__pool' in win, false);
  assert.equal(deckInPool(win), false);
  assert.equal(has.closingCard(html), 0);
  assert.ok(!/reef\.cards/.test(footerOf(html)));
});
