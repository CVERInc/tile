// The public sandbox, driven END TO END against the bytes the edge Worker actually serves.
//
// 🔴 WHY THIS EXISTS NEXT TO sandbox-mobile.mjs. That harness boots `w/index.html` off `w/serve.mjs`
// — the developer's copy — and it is the right ruler for layout. It is the wrong ruler for "does the
// thing a visitor touches work", because a visitor never loads those files: `card.feelreef.com`
// inlines a BUNDLE (serve/gen-editor-assets.mjs → editor-assets.mjs, a committed artifact) into a
// page composed by card-worker.mjs. A bundle that is one regeneration behind is green there and
// broken here. So this one wraps the WORKER'S OWN `fetch` in a local http server and drives that.
//
//   node packages/cardtile/verify/sandbox-served.mjs                 # all steps, both widths
//   CARD_VERIFY_OUT=/some/dir node packages/cardtile/verify/sandbox-served.mjs
//
// Every claim carries a control, in this directory's house style: a check that scans for the absence
// of something also proves it can see that something when it IS there.
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { join } from 'node:path';
import { PLAYWRIGHT, OUT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// ── the Worker, on a socket ──────────────────────────────────────────────────────────────────────
//
// A minimal KV double. The sandbox page itself must never touch it (card-worker.test.mjs asserts
// that with a throwing double); the DRAFT PARKING route added for the door does, so this one is a
// real Map and the harness asserts WHICH keys appear in it.
const kv = new Map();
const env = {
  PREVIEW: 'true',
  CARDS: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  // 🩸 WAS `https://card.feelreef.com${req.url}` — which reads as "more realistic" and quietly broke
  // the one same-origin check on the routes this harness exists to drive: the browser sends
  // `Origin: http://127.0.0.1:<port>` and the Worker compared it against a hostname the harness had
  // invented, so `POST /try/park` answered 403 and the door looked like it had lost the card. The
  // routes under test are host-agnostic by construction (they are matched before any handle
  // resolution), so the honest URL is the one the socket actually received.
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });
  let out;
  try {
    out = await worker.fetch(request, env);
  } catch (e) {
    out = new Response(`harness: worker threw — ${e.message}`, { status: 500 });
  }
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;
const fail = (msg) => { console.log(`   🔴 ${msg}`); bad++; };
const ok = (msg) => console.log(`   ✓ ${msg}`);

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 900 };
const shots = [];
async function shot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(`${name}.png`);
}

async function open(locale, viewport, { touch = false } = {}) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: false,                 // isMobile forces its own viewport meta handling; we want ours
    extraHTTPHeaders: { 'accept-language': locale },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/try/edit`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW && window.__cardtileW.sandbox === true);
  // a fresh visitor every time — a draft left by an earlier step is not a fresh visit
  await page.evaluate(() => { window.localStorage.removeItem('cardtile:try:draft:v1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW && window.__cardtileW.sandbox === true);
  // 🔴 let the card settle before anything is screenshotted. `card.css` fades the body in over
  // .35s, and the canvas repaints once more when fitCanvas sets its height — a shot taken in that
  // window shows a card at 30% opacity and reads as a rendering bug that is not there.
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

const cellCount = (page) => page.evaluate(() => window.__cardtileW.model.cells.length);
const md = (page) => page.evaluate(() => window.__cardtileW.md);

/** open the sheet for the palette entry `type`, i.e. what "add a tile" does */
async function addTile(page, type) {
  await page.evaluate((t) => window.__cardtileW.addCell(t), type);
  await page.waitForSelector('#modal:not([hidden])');
}

/** a genuine w×h RGB PNG — the specimen a person's photo stands in for. See the step that uses it. */
function makePng(w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      row[1 + x * 3] = (x * 4) % 256;
      row[2 + x * 3] = (y * 4) % 256;
      row[3 + x * 3] = 128;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const STEPS = [];
const step = (title, fn) => STEPS.push({ title, fn });

// ── 1. the address field ─────────────────────────────────────────────────────────────────────────
step('a bare address typed into the link form becomes a working button', async (device, tag) => {
  const { ctx, page, errors } = await open('zh-TW', device);
  await addTile(page, 'link');
  await page.fill('#f-url', 'https://instagram.com/samdoc');
  await page.fill('#f-text', '');
  await shot(page, `${tag}-01-link-form`);
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const doc = await page.frameLocator('#canvas').locator('body').innerHTML();
  if (!/href="https:\/\/instagram\.com\/samdoc"/.test(doc)) fail(`${tag}: the address did not become the href`);
  else ok(`${tag}: bare address → href`);
  if (/href="#"/.test(doc)) fail(`${tag}: href="#" is back on the canvas`);
  if (!/instagram\.com</.test(doc)) fail(`${tag}: the button is not named after the site`);
  if (errors.length) fail(`${tag}: page error — ${errors[0]}`);
  await shot(page, `${tag}-02-link-done`);
  await ctx.close();
});

step('the link form refuses to save with no address, and says so in the field', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const before = await cellCount(page);
  await addTile(page, 'link');
  await page.fill('#f-url', '');
  await page.click('#modal-save');
  const stillOpen = await page.locator('#modal').isVisible();
  const err = (await page.locator('#e-url').textContent() || '').trim();
  if (!stillOpen) fail(`${tag}: the sheet closed with no address — a dead button was saved`);
  if (!err) fail(`${tag}: no message under the address field`);
  else ok(`${tag}: refuses an empty address — 「${err}」`);
  await shot(page, `${tag}-03-link-needs-address`);
  // CONTROL: the same sheet DOES close once an address is there
  await page.fill('#f-url', 'https://example.com/x');
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  if (await cellCount(page) !== before + 1) fail(`${tag}: CONTROL — the tile was not added even with an address`);
  await ctx.close();
});

// ── 2. the picture field ─────────────────────────────────────────────────────────────────────────
step('the picture form offers a real file picker, and an empty one never renders a broken image', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await addTile(page, 'feature');
  const picker = await page.locator('#f-img-file').count();
  const type = await page.locator('#f-img-file').getAttribute('type');
  const accept = await page.locator('#f-img-file').getAttribute('accept');
  if (!picker || type !== 'file' || accept !== 'image/*') fail(`${tag}: no <input type=file accept=image/*> in the picture form`);
  else ok(`${tag}: picture field is a file picker (accept="${accept}")`);
  await shot(page, `${tag}-04-image-form`);
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const doc = await page.frameLocator('#canvas').locator('body').innerHTML();
  if (/<img[^>]*src=""/.test(doc)) fail(`${tag}: an empty <img src=""> reached the canvas`);
  else ok(`${tag}: an unfilled picture tile renders no <img> at all`);
  if (!/st-cell-unset/.test(doc)) fail(`${tag}: nothing to tap to finish the picture tile`);
  await shot(page, `${tag}-05-image-empty`);
  await ctx.close();
});

step('choosing a file puts the bytes IN THE CARD and the picture on the canvas', async (device, tag) => {
  const { ctx, page, errors } = await open('zh-TW', device);
  await addTile(page, 'feature');
  // 🔴 A REAL, DECODABLE PNG, built here rather than pasted as a base64 literal. The first version
  // of this step used a hand-typed blob that chromium refused with "the source image could not be
  // decoded" — which the picker then reported, correctly, as "that file could not be read". The
  // harness would have been measuring its own bad fixture and calling it a product defect.
  const tmp = join(OUT, 'pick-me.png');
  fs.writeFileSync(tmp, makePng(64, 64));
  await page.setInputFiles('#f-img-file', tmp);
  await page.waitForFunction(() => !!document.querySelector('.ctw-asset-shot img'));
  const value = await page.inputValue('#f-img');
  if (!/^asset:sha256-[0-9a-f]{16}$/.test(value)) fail(`${tag}: the picked file did not become an asset id (got ${JSON.stringify(value)})`);
  else ok(`${tag}: picked file → ${value}`);
  await shot(page, `${tag}-06-image-picked`);
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const assets = await page.evaluate(() => Object.keys(window.__cardtileW.model.assets || {}));
  if (assets.length !== 1) fail(`${tag}: expected 1 asset in the card, found ${assets.length}`);
  const text = await md(page);
  if (!/^## assets$/m.test(text)) fail(`${tag}: the card has no assets lane — the picture did not travel with the file`);
  else ok(`${tag}: the picture is IN the markdown (## assets)`);
  const doc = await page.frameLocator('#canvas').locator('body').innerHTML();
  if (!/src="data:image\//.test(doc)) fail(`${tag}: the picture is not on the canvas`);
  if (errors.length) fail(`${tag}: page error — ${errors[0]}`);
  await shot(page, `${tag}-07-image-on-card`);
  await ctx.close();
});

// ── 3. the name ──────────────────────────────────────────────────────────────────────────────────
step('the name is an ordinary field, and changing it changes the card', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await page.frameLocator('#canvas').locator('[data-cell="0"]').click();
  await page.waitForSelector('#modal:not([hidden])');
  const nameField = await page.locator('#f-name').count();
  if (!nameField) { fail(`${tag}: the profile form still has no name field`); await ctx.close(); return; }
  const was = await page.inputValue('#f-name');
  await shot(page, `${tag}-08-profile-form`);
  await page.fill('#f-name', '陳小明');
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const heading = await page.frameLocator('#canvas').locator('.st-hero-name').textContent();
  if ((heading || '').trim() !== '陳小明') fail(`${tag}: the card still reads ${JSON.stringify(heading)} after a rename`);
  else ok(`${tag}: renamed ${was} → 陳小明, and the card says so`);
  const text = await md(page);
  if (!/^title: 陳小明$/m.test(text)) fail(`${tag}: the rename did not reach the file`);
  await shot(page, `${tag}-09-renamed`);
  await ctx.close();
});

// ── 4. the door ──────────────────────────────────────────────────────────────────────────────────
step('the door says what happens next, and the way back does not lose the card', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await addTile(page, 'link');
  await page.fill('#f-url', 'https://example.com/mine');
  await page.fill('#f-text', '我的網站');
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const before = await md(page);

  await page.click('#publish');
  await page.waitForSelector('#doormodal:not([hidden])');
  const note = (await page.locator('#door-note').textContent() || '').trim();
  if (!note) fail(`${tag}: the door opens onto silence — no sentence before it`);
  else if (!/email/i.test(note)) fail(`${tag}: the sentence does not say what happens next — 「${note}」`);
  else ok(`${tag}: 「${note.slice(0, 30)}…」`);
  if (page.url().includes('feelreef.com')) fail(`${tag}: pressing the door navigated immediately`);
  await shot(page, `${tag}-10-door-sheet`);

  // 「再改一下」 goes back, and the card is exactly as it was
  await page.click('#door-back');
  await page.waitForSelector('#doormodal[hidden]', { state: 'attached' });
  if (await md(page) !== before) fail(`${tag}: the card changed on the way back from the door`);
  else ok(`${tag}: 再改一下 → back, card untouched`);
  await ctx.close();
});

step('🔴 walking through the door parks the WHOLE card and does not delete the draft', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await addTile(page, 'link');
  await page.fill('#f-url', 'https://example.com/mine');
  await page.fill('#f-text', '我的網站');
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const before = await md(page);
  const cells = await cellCount(page);
  kv.clear();

  // the door leads to feelreef.com, which is not this harness — catch the navigation instead
  let dest = '';
  await page.route('https://feelreef.com/**', async (route) => {
    dest = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>feelreef</p>' });
  });
  await page.click('#publish');
  await page.waitForSelector('#doormodal:not([hidden])');
  await page.click('#door-go');
  await page.waitForFunction(() => location.host === 'feelreef.com');

  const url = new URL(dest || page.url());
  const draft = url.searchParams.get('draft');
  if (!draft) fail(`${tag}: the door carried no draft id — the card was left behind`);
  else ok(`${tag}: draft=${draft}`);
  const parked = kv.get(`try:${draft}`);
  if (parked !== before) fail(`${tag}: what was parked is not the card that was on screen`);
  else ok(`${tag}: the parked bytes ARE the card (${parked.length} bytes, ${cells} tiles)`);
  if (!url.searchParams.get('title')) fail(`${tag}: the door stopped carrying the title`);
  await shot(page, `${tag}-11-door-landing`);

  // 🔴 THE ONE THAT MATTERS: come back, and the card is still there
  await page.goto(`${BASE}/try/edit`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW);
  const after = await md(page);
  if (after !== before) fail(`${tag}: coming back from the door lost the card (${await cellCount(page)} tiles, was ${cells})`);
  else ok(`${tag}: came back to the same card, ${await cellCount(page)} tiles`);
  await shot(page, `${tag}-12-back-from-door`);
  await ctx.close();
});

step('CONTROL: 「重新開始」 is still the exit that DOES empty the draft', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await addTile(page, 'link');
  await page.fill('#f-url', 'https://example.com/mine');
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });
  const grown = await cellCount(page);
  await page.click('#sandbox-reset');
  await page.goto(`${BASE}/try/edit`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW);
  const fresh = await cellCount(page);
  if (fresh !== 3) fail(`${tag}: 重新開始 left ${fresh} tiles, expected the 3-tile persona`);
  else ok(`${tag}: 重新開始 → back to ${fresh} tiles (was ${grown})`);
  await ctx.close();
});

// ── 5. one language on the screen ────────────────────────────────────────────────────────────────
step('🔴 the palette and the forms speak the visitor\'s language, not the author\'s', async (device, tag) => {
  // What a person reads on the palette, per locale — from the table, so a translation that is
  // dropped fails HERE rather than showing Chinese to a German visitor for six weeks.
  const EXPECT = {
    ja: { first: 'プロフィール', link: 'リンク', text: '文章', label: 'ボタンの文字', unit: 'タイルを追加' },
    en: { first: 'Profile', link: 'Link', text: 'Text', label: 'Button text', unit: 'Add a tile' },
    de: { first: 'Profil', link: 'Link', text: 'Text', label: 'Beschriftung', unit: 'Kachel hinzufügen' },
    'zh-TW': { first: '個人檔案', link: '連結', text: '文字', label: '按鈕上的字', unit: '加一張牌' },
  };
  for (const [locale, want] of Object.entries(EXPECT)) {
    const { ctx, page } = await open(locale, device);
    // The owner's 2026-09-06 ruling, on screen: the unit is a TILE, not a block.
    // 🩸 `innerText` here returns the RENDERED text, and `.ctw-side h2` is `text-transform:
    // uppercase` — so this read "ADD A TILE" and "KACHEL HINZUFÜGEN" and failed on a string that
    // was perfectly correct. CJK has no case, so the two locales that would have caught it are the
    // two that passed. `textContent` is the string; `innerText` is a picture of it.
    const header = (await page.locator('#add-cell-h2').textContent()).trim();
    if (header !== want.unit) fail(`${tag}/${locale}: the palette header reads ${JSON.stringify(header)}, expected ${JSON.stringify(want.unit)}`);
    const palette = (await page.locator('#palette').innerText()).trim();
    if (!palette.startsWith(want.first)) fail(`${tag}/${locale}: the palette leads with ${JSON.stringify(palette.split('\n')[0])}, expected ${want.first}`);
    for (const w of [want.link, want.text]) {
      if (!palette.includes(w)) fail(`${tag}/${locale}: the palette never says ${JSON.stringify(w)}`);
    }
    // 🔴 THE CONTROL THAT MATTERS: no OTHER locale's words are on the same screen. Chinese type
    // names under a Japanese header is exactly what the review measured.
    if (locale !== 'zh-TW' && /個人檔案|連結列|圖片格|輪播|社群列/.test(palette)) {
      fail(`${tag}/${locale}: Traditional Chinese type names are still leaking into the palette`);
    }
    await addTile(page, 'link');
    const sheet = (await page.locator('#modal-body').innerText()).trim();
    if (!sheet.includes(want.label)) fail(`${tag}/${locale}: the link form never says ${JSON.stringify(want.label)}`);
    else ok(`${tag}/${locale}: palette 「${palette.split('\n')[0]}」, form 「${want.label}」`);
    await shot(page, `${tag}-13-locale-${locale}`);
    await ctx.close();
  }
});

step('a brand-new tile is written in the visitor\'s language too', async (device, tag) => {
  const { ctx, page } = await open('de-DE', device);
  await addTile(page, 'text');
  const body = await page.inputValue('#f-__body');
  if (body !== 'Schreiben Sie etwas.') fail(`${tag}: a new text tile starts as ${JSON.stringify(body)}`);
  else ok(`${tag}: new text tile → 「${body}」`);
  await shot(page, `${tag}-14-blank-de`);
  await ctx.close();
});

// ── 6. reordering ────────────────────────────────────────────────────────────────────────────────
//
// 🔴 THE BUTTON IS THE CLAIM; THE DRAG IS A MEASUREMENT. The review could not fully separate
// "Playwright cannot do HTML5 drag-and-drop inside a srcdoc iframe" from "the product cannot be
// dragged by a real finger" — so a red drag here is REPORTED, loudly, and does not by itself fail
// the run. What DOES fail it is the buttons: those are the path that must always work.

/** the order of the tiles on the canvas, as their body text — a shape the file itself can be read for */
const tileOrder = (page) => page.evaluate(() =>
  window.__cardtileW.model.cells.map((c) => `${c.type}:${(c.body || '').slice(0, 12)}`));

step('🔴 「往上移」／「往下移」 reorder the card, and the buttons never lie about the ends', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const before = await tileOrder(page);
  if (before.length < 3) { fail(`${tag}: the persona has only ${before.length} tiles — nothing to reorder`); await ctx.close(); return; }

  // open the LAST tile and walk it to the top
  await page.frameLocator('#canvas').locator(`[data-cell="${before.length - 1}"]`).click();
  await page.waitForSelector('#modal:not([hidden])');
  if (await page.locator('#modal-down').isEnabled()) fail(`${tag}: 往下移 is enabled on the last tile`);
  await shot(page, `${tag}-16-move-buttons`);
  for (let i = before.length - 1; i > 0; i--) await page.click('#modal-up');
  if (await page.locator('#modal-up').isEnabled()) fail(`${tag}: 往上移 is enabled on the first tile`);
  await page.click('#modal-save');
  await page.waitForSelector('#modal[hidden]', { state: 'attached' });

  const after = await tileOrder(page);
  const want = [before[before.length - 1], ...before.slice(0, -1)];
  if (JSON.stringify(after) !== JSON.stringify(want)) {
    fail(`${tag}: 往上移 produced ${JSON.stringify(after)}, expected ${JSON.stringify(want)}`);
  } else ok(`${tag}: last tile walked to the top — ${after[0]}`);
  // …and it reached the FILE, not just the screen
  const text = await md(page);
  const firstCellLine = text.split('\n').find((l) => l.includes('%% card:'));
  if (!firstCellLine.includes(after[0].split(':')[0])) fail(`${tag}: the order changed on screen but not in the card`);
  await shot(page, `${tag}-17-reordered`);
  await ctx.close();
});

step('the tiles carry a drag affordance, and dragging one no longer selects text', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const cell = page.frameLocator('#canvas').locator('[data-cell="1"]');
  const style = await cell.evaluate((n) => {
    const cs = getComputedStyle(n);
    const grip = getComputedStyle(n, '::after');
    return { select: cs.userSelect || cs.webkitUserSelect, cursor: cs.cursor, grip: grip.backgroundImage };
  });
  if (style.select !== 'none') fail(`${tag}: user-select is ${style.select} — a drag still highlights text`);
  if (!/svg/.test(style.grip)) fail(`${tag}: no grip drawn on a tile (background-image ${style.grip})`);
  else ok(`${tag}: grip drawn, user-select:${style.select}, cursor:${style.cursor}`);
  await ctx.close();
});

step('MEASUREMENT: one Sortable per innermost container, and a pointer drag on the served page', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  // 🔴 THE NESTED-INSTANCE BUG, MEASURED. `.st-run` sits INSIDE `.st-cells`, and both used to get a
  // Sortable claiming the same children. `dragContainers` is what the editor actually handed to the
  // library, so this reads the fix rather than inferring it — and a tile owned by two of them is the
  // exact defect, counted.
  const nest = await page.evaluate(() => window.__cardtileW.dragContainers);
  console.log(`   · Sortable containers: ${nest.count} (${nest.classes.join(', ') || 'none'}),`
    + ` tiles claimed by more than one: ${nest.doubleClaimed}`);
  if (nest.doubleClaimed > 0) fail(`${tag}: ${nest.doubleClaimed} tile(s) are inside two Sortable containers`);
  if (!nest.count) fail(`${tag}: no Sortable container at all — drag is simply absent`);

  const before = await tileOrder(page);
  const frame = page.frameLocator('#canvas');
  // 🩸 WAS `off.x + a.x`, adding the iframe's own offset by hand. Playwright already returns a
  // frame element's box RELATIVE TO THE MAIN FRAME VIEWPORT, so that pushed every synthetic drag
  // hundreds of pixels below the card and onto nothing — and the harness read the resulting
  // no-op as "the product cannot be dragged". The probe was the defect.
  const a = await frame.locator('[data-cell="1"]').boundingBox();
  const b = await frame.locator('[data-cell="2"]').boundingBox();
  if (a && b) {
    const [x0, y0] = [a.x + a.width / 2, a.y + a.height / 2];
    const [x1, y1] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 16, y0 + ((y1 - y0) * i) / 16, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  } else {
    fail(`${tag}: could not find two tiles to drag between`);
  }
  const after = await tileOrder(page);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log(`   ⚠️  ${tag}: a synthetic pointer drag did NOT reorder. Reported, not failed — this harness`);
    console.log('       cannot separate "the product cannot be dragged" from "Playwright cannot drag');
    console.log('       inside a srcdoc iframe". The buttons above are the claim; see step 6.');
  } else {
    ok(`${tag}: a pointer drag reordered — ${before[1]} ⇄ ${before[2]}`);
  }
  await shot(page, `${tag}-18-drag`);
  await ctx.close();
});

step('🔴 the case that measurably failed: two full-width links, which share one .st-run', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  // 🔴 THE SPECIMEN IS THE POINT. The persona card has one link, so it can never exercise this —
  // and the review's measurement (「連結→連結（同一個 .st-run）❌」) needs two full-width ones, which
  // the renderer merges into a single run INSIDE the cells grid. That nesting is the whole defect.
  await page.evaluate(() => window.__cardtileW.load([
    '---', 'card-page: try', 'title: 小美', 'lang: zh-TW', '---', '', '## cards', '',
    '- [ ] %% card: link w=6 %% [AAA](https://a.example.com/)',
    '- [ ] %% card: link w=6 %% [BBB](https://b.example.com/)',
    '- [ ] %% card: link w=6 %% [CCC](https://c.example.com/)',
  ].join('\n') + '\n', 'try'));
  await page.waitForTimeout(150);
  const runs = await page.frameLocator('#canvas').locator('.st-run').count();
  const nest = await page.evaluate(() => window.__cardtileW.dragContainers);
  console.log(`   · .st-run wrappers on the canvas: ${runs}; Sortable containers: ${nest.count}`
    + ` (${nest.classes.join(', ')}); double-claimed tiles: ${nest.doubleClaimed}`);
  if (!runs) fail(`${tag}: the specimen produced no .st-run — this step is measuring the wrong shape`);
  if (nest.doubleClaimed > 0) fail(`${tag}: ${nest.doubleClaimed} tile(s) still owned by two Sortables`);

  const before = await tileOrder(page);
  const frame = page.frameLocator('#canvas');
  const a = await frame.locator('[data-cell="0"]').boundingBox();
  const b = await frame.locator('[data-cell="1"]').boundingBox();
  if (a && b) {
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y - a.y) * i) / 16, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  const after = await tileOrder(page);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    fail(`${tag}: link→link inside one .st-run STILL does not reorder — ${JSON.stringify(after)}`);
  } else ok(`${tag}: link→link inside one .st-run reorders — ${after.map((x) => x.slice(5, 12)).join(' ')}`);
  await shot(page, `${tag}-19-drag-run`);
  await ctx.close();
});

// ── 7. one scroll on the phone ───────────────────────────────────────────────────────────────────
step('🔴 the LAST tile in the palette is reachable — the measurement that started this', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const box = await page.evaluate(() => {
    const adds = [...document.querySelectorAll('.ctw-add')];
    const last = adds[adds.length - 1];
    const door = document.getElementById('publish');
    return {
      tiles: adds.length,
      doc: document.documentElement.scrollHeight,
      view: document.documentElement.clientHeight,
      doorTop: door && !door.hidden ? door.getBoundingClientRect().top + window.scrollY : Infinity,
      lastBottom: last.getBoundingClientRect().bottom + window.scrollY,
    };
  });
  // The page must be able to scroll far enough to bring the last button clear of the fixed door.
  const reachable = box.doc >= box.lastBottom && box.lastBottom <= box.doc;
  console.log(`   · ${tag}: ${box.tiles} palette tiles, page ${box.doc}px in a ${box.view}px viewport,`
    + ` last button ends at ${Math.round(box.lastBottom)}px`);
  if (!reachable) fail(`${tag}: the page is ${box.doc}px but the last button ends at ${Math.round(box.lastBottom)}px — it is off the end`);

  // …and then actually scroll to it and press it. Geometry can be right while nothing is clickable.
  const last = page.locator('.ctw-add').last();
  const name = (await last.innerText()).split('\n')[0];
  await last.scrollIntoViewIfNeeded();
  await shot(page, `${tag}-20-palette-end`);
  const after = await last.boundingBox();
  const vp = device.height;
  if (!after || after.y < 0 || after.y + after.height > vp) {
    fail(`${tag}: after scrolling, the last palette button is at ${JSON.stringify(after)} in a ${vp}px viewport`);
  }
  await last.click();
  await page.waitForSelector('#modal:not([hidden])');
  ok(`${tag}: scrolled to and pressed the last palette entry — 「${name}」`);
  await page.click('#modal-close');
  await ctx.close();
});

step('the phone gets ONE scroll, not three nested ones', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const m = await page.evaluate(() => {
    const scrolls = (n) => n.scrollHeight > n.clientHeight + 1;
    return {
      page: scrollsCheck(document.documentElement),
      side: scrolls(document.querySelector('.ctw-side')),
      main: scrolls(document.querySelector('.ctw-main')),
      canvasWrap: scrolls(document.querySelector('.ctw-canvas-wrap')),
      bannerH: Math.round(document.getElementById('sandbox-banner').getBoundingClientRect().height),
      shortLine: (document.getElementById('sandbox-banner-status').textContent || '').trim(),
      longVisible: getComputedStyle(document.getElementById('sandbox-banner-text')).display !== 'none',
    };
    function scrollsCheck(n) { return n.scrollHeight > n.clientHeight + 1; }
  });
  const stacked = device.width <= 768;
  console.log(`   · ${tag}: page scrolls=${m.page} side=${m.side} main=${m.main} canvas=${m.canvasWrap}; banner ${m.bannerH}px`);
  if (stacked) {
    if (m.side || m.main || m.canvasWrap) fail(`${tag}: an inner scroller survived (side=${m.side} main=${m.main} canvas=${m.canvasWrap})`);
    if (!m.page) fail(`${tag}: the page itself does not scroll — everything must fit, which it does not`);
    if (m.bannerH > 60) fail(`${tag}: the banner is ${m.bannerH}px tall, not one line`);
    if (m.longVisible) fail(`${tag}: the long banner sentence is still shown at phone width`);
    if (!m.shortLine) fail(`${tag}: the one-line banner has no text — a no-JS visitor reads nothing`);
    else ok(`${tag}: one scroll, banner ${m.bannerH}px — 「${m.shortLine}」`);
  } else {
    // CONTROL: the desktop layout is deliberately NOT this. The side panel is its own scroller there.
    if (m.page) fail(`${tag}: the desktop page itself scrolls — the two-column layout was flattened`);
    else ok(`${tag}: desktop unchanged — the panel scrolls, the page does not`);
  }
  await shot(page, `${tag}-21-first-screen`);
  await ctx.close();
});

// ── 8. the CTA under a hover ─────────────────────────────────────────────────────────────────────
step('🔴 the main call to action stays readable while hovered', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const read = async () => page.locator('#publish').evaluate((n) => {
    const cs = getComputedStyle(n);
    return { bg: cs.backgroundColor, fg: cs.color, filter: cs.filter };
  });
  const rest = await read();
  await page.locator('#publish').hover();
  await page.waitForTimeout(80);
  const hot = await read();

  // 🔴 CONTRAST, not "the colour changed". The defect WAS a colour change, so a check that only
  // asked whether the colour changed would have signed it off. Alpha-composite and compare.
  //
  // 🩸 …AND THE GROUND MUST BE READ, NOT ASSUMED. The first version of this helper hardcoded the
  // dark panel (#1a1f27). The defect is LIGHT-MODE ONLY — `rgba(17,24,32,.08)` over white is a
  // near-white fill under white text — so compositing it over a dark ground would have produced a
  // comfortable ratio and passed the very thing it was written to catch. The page says what it is
  // sitting on; ask it.
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgba = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
  const lum = (c) => {
    const s = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4));
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  const contrast = (bg, fg) => {
    const [r, g, b, a = 1] = rgba(bg);
    const under = rgba(ground).slice(0, 3);
    const over = [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const l1 = lum(over); const l2 = lum(rgba(fg).slice(0, 3));
    return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  };
  const cRest = contrast(rest.bg, rest.fg);
  const cHot = contrast(hot.bg, hot.fg);
  console.log(`   · ${tag}: ground ${ground}; rest bg=${rest.bg} fg=${rest.fg} (${cRest}:1)`
    + ` → hover bg=${hot.bg} filter=${hot.filter} (${cHot}:1)`);
  if (Number(cHot) < 4.5) fail(`${tag}: hovered contrast is ${cHot}:1 — the CTA's words disappear into it`);
  else ok(`${tag}: ${cRest}:1 at rest, ${cHot}:1 hovered (ground ${ground})`);

  // CONTROL A: a PLAIN button still takes the neutral hover. Without this, "the CTA no longer goes
  // transparent" is equally satisfied by having removed hover from every button on the page.
  const plainRest = await page.locator('#sandbox-reset').evaluate((n) => getComputedStyle(n).backgroundColor);
  await page.locator('#sandbox-reset').hover();
  await page.waitForTimeout(80);
  const plainHot = await page.locator('#sandbox-reset').evaluate((n) => getComputedStyle(n).backgroundColor);
  if (plainRest === plainHot) fail(`${tag}: CONTROL — an ordinary button no longer changes on hover either (${plainHot})`);
  else console.log(`   · CONTROL a plain button still reacts: ${plainRest} → ${plainHot}`);

  // 🔴 THE SCREENSHOT COMES BEFORE THE SABOTAGE. Control B below injects the ORIGINAL broken rule
  // into this very page, so anything captured after it is a picture of the defect filed under a
  // name that says "fixed".
  await page.mouse.move(0, 0);
  await page.locator('#publish').hover();
  await page.waitForTimeout(80);
  await shot(page, `${tag}-22-cta-hover`);

  // 🔴 CONTROL B: put the OLD rule back, in this page, and prove the ruler goes red on it. Without
  // it, "4.5:1 or better" is a threshold that has never once been seen to fail — and this one very
  // nearly could not have failed: the first draft of `contrast()` composited against a hardcoded
  // DARK panel, while the defect is light-mode only.
  await page.addStyleTag({ content: '.ctw-btn:hover{background:color-mix(in srgb, var(--ctw-ink) 8%, transparent) !important;filter:none !important}' });
  await page.mouse.move(0, 0);
  await page.locator('#publish').hover();
  await page.waitForTimeout(80);
  const regressed = await read();
  const cBad = contrast(regressed.bg, regressed.fg);
  console.log(`   · CONTROL the old rule reinstated → ${cBad}:1 (the ruler must call this a failure)`);
  if (Number(cBad) >= 4.5) fail(`${tag}: CONTROL — the ruler reads ${cBad}:1 on the ORIGINAL defect, so it proves nothing`);
  await ctx.close();
});

// ── 10. Markdown mode ────────────────────────────────────────────────────────────────────────────
const inMd = (page) => page.evaluate(() => document.body.dataset.md === '1');

step('🔴 Markdown mode is a WHOLE-PAGE either/or, and it round-trips', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  const before = await md(page);

  await page.click('#md-toggle');
  await page.waitForSelector('#md-block:not([hidden])');
  const on = await page.evaluate(() => ({
    md: document.body.dataset.md === '1',
    label: document.getElementById('md-toggle-label').textContent.trim(),
    text: document.getElementById('md').value,
    // 🔴 the either/or: nothing from the card view may be on screen at the same time
    canvas: getComputedStyle(document.querySelector('.ctw-canvas-wrap')).display,
    palette: getComputedStyle(document.querySelector('.ctw-palette')).display,
    lanes: getComputedStyle(document.querySelector('.ctw-lanes')).display,
  }));
  if (!on.md) fail(`${tag}: the toggle did not enter the mode`);
  if (on.text !== before) fail(`${tag}: the box does not hold the card (${on.text.length} vs ${before.length} bytes)`);
  if (on.label !== '回到卡片') fail(`${tag}: the toggle reads ${JSON.stringify(on.label)} while on`);
  for (const [what, d] of [['canvas', on.canvas], ['palette', on.palette], ['lanes', on.lanes]])
    if (d !== 'none') fail(`${tag}: the ${what} is still showing (${d}) — the two views are on screen at once`);
  await shot(page, `${tag}-23-md-mode`);

  // change one line, come back, and the card has that change and no other
  await page.fill('#md', before.replace('點一下任何一張牌就能編輯。', '我自己寫的一句話。'));
  await page.click('#md-toggle');
  await page.waitForSelector('#md-block[hidden]', { state: 'attached' });
  if (await inMd(page)) fail(`${tag}: still in the mode after pressing 回到卡片`);
  const after = await md(page);
  if (!/我自己寫的一句話。/.test(after)) fail(`${tag}: the edit did not reach the card`);
  if (!/title: 小美/.test(after)) fail(`${tag}: something else changed — the frontmatter is gone`);
  // 🩸 A RACE, NOT A DEFECT — and it failed roughly one run in four, which is worse than failing
  // every time. `paint()` reassigns the iframe's `srcdoc`, and the frame reloads asynchronously, so
  // reading its body the instant the sheet closes can return the PREVIOUS document. Three repeat
  // runs were clean, which is what told the difference; the fix is to wait for the frame instead of
  // assuming it has caught up. A flaky gate is one people learn to re-run.
  const landed = await page.waitForFunction((t) => {
    const d = document.getElementById('canvas').contentDocument;
    return !!(d && d.body && d.body.innerHTML.includes(t));
  }, '我自己寫的一句話。', { timeout: 5000 }).then(() => true).catch(() => false);
  if (!landed) fail(`${tag}: the card on screen did not follow the text`);
  else ok(`${tag}: text → card, one line changed, ${after.length} bytes`);
  await shot(page, `${tag}-24-md-applied`);
  await ctx.close();
});

step('🔴 a broken card cannot be left behind — the mode holds you, and says which line', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await page.click('#md-toggle');
  await page.waitForSelector('#md-block:not([hidden])');
  const good = await page.inputValue('#md');
  const safe = await md(page);

  // break it the way a person does: the lane heading deleted
  await page.fill('#md', good.replace(/^## .*$/m, 'cards'));
  await page.click('#md-toggle');
  await page.waitForTimeout(120);
  const held = await inMd(page);
  const err = (await page.locator('#md-error').textContent() || '').trim();
  const errShown = await page.locator('#md-error').isVisible();
  if (!held) fail(`${tag}: the mode let go of a card that had stopped being one`);
  if (!errShown || !err) fail(`${tag}: no message — it just refused, silently`);
  else if (!/\d/.test(err)) fail(`${tag}: the message names no line — 「${err}」`);
  else ok(`${tag}: held, and said 「${err}」`);
  if (await md(page) !== safe) fail(`${tag}: THE CARD WAS CHANGED by a refused exit`);
  await shot(page, `${tag}-25-md-broken`);

  // …and fixing it lets go
  await page.fill('#md', good);
  await page.click('#md-toggle');
  await page.waitForSelector('#md-block[hidden]', { state: 'attached' });
  if (await inMd(page)) fail(`${tag}: fixed, and it still will not let go`);
  else ok(`${tag}: fixed → back to the card`);
  await ctx.close();
});

step('the raw text is drafted while typing, and survives a reload', async (device, tag) => {
  const { ctx, page } = await open('zh-TW', device);
  await page.click('#md-toggle');
  await page.waitForSelector('#md-block:not([hidden])');
  const good = await page.inputValue('#md');
  await page.fill('#md', good.replace('title: 小美', 'title: 林小明'));
  await page.waitForTimeout(450);                    // past the 300ms debounce
  const stored = await page.evaluate(() => window.localStorage.getItem('cardtile:try:draft:v1'));
  if (!/title: 林小明/.test(stored || '')) fail(`${tag}: typing in the raw box did not reach the draft`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW);
  if (!/title: 林小明/.test(await md(page))) fail(`${tag}: the draft did not survive a reload`);
  else ok(`${tag}: draft saved while typing and survived a reload`);
  await ctx.close();
});

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
for (const [device, tag] of [[PHONE, 'phone'], [LAPTOP, 'laptop']]) {
  console.log(`\n── ${tag} ${device.width}×${device.height} ${'─'.repeat(40)}`);
  for (const s of STEPS) {
    console.log(`\n${s.title}`);
    await s.fn(device, tag);
  }
}

await browser.close();
server.close();
console.log(`\nscreenshots → ${OUT}`);
console.log(shots.join('\n'));
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ served sandbox: address, picture and name are all ordinary form fields');
process.exitCode = bad ? 1 : 0;
