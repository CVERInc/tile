// The card pool's render contract (reef#2913). run: node --test card-pool.test.mjs
//
// One PLATFORM switch, `ctx.pool`, decides two things the page draws: the reef.cards footer link and
// the closing reef.cards card. true → both, false → neither, absent → the page exactly as it was
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
      assert.equal(has.closingCard(html), wantCard, 'closing reef.cards card count');
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

test('pool: true changes only the footer link and the appended closing card', () => {
  // The rest of the page is untouched: strip the closing card and swap the footer back, and it is
  // the powered-by-off page byte for byte.
  const off = renderCardHTML(POWERED.off, CTX);
  const on = renderCardHTML(POWERED.on, { ...CTX, pool: true });
  const back = on.replace(POOL_SECTION, '').replace(footerOf(on), footerOf(off));
  assert.equal(back, off);
  // and pool:false is the powered-by-off page outright
  assert.equal(renderCardHTML(POWERED.on, { ...CTX, pool: false }), off);
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
