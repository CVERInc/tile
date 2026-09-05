// The avatar is a ratio of the card, not a pixel count — and the claim that makes the change safe
// is a strong one, so it gets measured rather than argued:
//
//   at 390px (the width every platform measurement was taken at) the rendering must be UNCHANGED,
//   because 78px was already 21.8% of the card there. Only the unit was wrong.
//
//   at wider viewports the avatar must hold that ratio, instead of collapsing to 12% of the card.
//
//   node packages/cardtile/verify/avatar-ratio.mjs
import { readCard, PLAYWRIGHT } from './paths.mjs';
import http from 'node:http';
import worker from '../serve/card-worker.mjs';

// 🔴 Which specimens HAVE an avatar is read from the cards, not assumed. specimen-plain has none —
// it is the "no assets at all" specimen — and this harness used to count that as five failures
// ("no avatar found"), because it took "every specimen has an avatar" for granted. The card with
// none is not noise here: it is the only place the OTHER claim can be checked, namely that a
// profile with no avatar emits no avatar element rather than an <img src="">.
const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const HAS_AVATAR = (h) => /%% card: profile[^%]*\bavatar=/.test(readCard(h));
const WIDTHS = [320, 390, 430, 768, 1200];
// What it used to be. 🔴 !important, because addStyleTag appends to <head> and NATIVE_CSS is printed
// in the <body> — without it the "before" column silently measures the AFTER behaviour, and the two
// columns come out identical no matter what changed. The control below is what caught that.
const OLD = '.st-card .st-hero .cp-icon{width:78px!important;height:78px!important}';

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

async function measure(handle, width, pinOld) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  if (pinOld) { await page.addStyleTag({ content: OLD }); await page.waitForTimeout(120); }
  const m = await page.evaluate(() => {
    const av = document.querySelector('.st-hero .cp-icon');
    const card = document.querySelector('.st-cells-wrap');
    if (!av || !card) return null;
    return { d: av.getBoundingClientRect().width, card: card.getBoundingClientRect().width };
  });
  await ctx.close();
  return m;
}

console.log('card         width   avatar   % of card    was (78px fixed)');
for (const handle of CARDS) {
  // A profile with no `avatar=` must render NO avatar element. An <img src=""> is not "no image":
  // per HTML an empty src resolves to the current document URL, so the browser fetches the page
  // itself as an image and fails — and the element still took focus and still had a size.
  if (!HAS_AVATAR(handle)) {
    const el = await measure(handle, 390, false);
    console.log(`${handle.padEnd(12)} (states no avatar)  ${el ? '🔴 renders one anyway' : '✓ renders none'}`);
    if (el) bad++;
    continue;
  }
  for (const w of WIDTHS) {
    const now = await measure(handle, w, false);
    const then = await measure(handle, w, true);
    if (!now || !then) { console.log(`${handle} @${w}: 🔴 no avatar found`); bad++; continue; }
    const pct = (now.d / now.card) * 100;
    const wasPct = (then.d / then.card) * 100;
    console.log(`${handle.padEnd(12)} ${String(w).padEnd(7)} ${now.d.toFixed(1).padEnd(8)} ${pct.toFixed(1).padEnd(12)} ${then.d.toFixed(1)} = ${wasPct.toFixed(1)}%`);

    // 🔴 THE CLAIM: identical at 390, the width every platform measurement was taken at.
    //
    // 🔴 …but only while the CARD is the same width, and since the backdrop-gutter fix it is not on
    // every card. Dropping `scrollbar-gutter: stable` on backdrop cards gives them back the 11px the
    // strip was reserving, so its card is 342 where the others are 331, and 23.6% of 342 is 80.7px,
    // not 78. That is the ratio behaving exactly as intended — the pixel count was only ever a PROXY
    // for "nothing moved", and the proxy is what expired, not the claim.
    //
    // So the claim is stated directly instead: the avatar is 23.6% of the card, whatever the card is.
    // The original pixel-identity assertion is KEPT wherever it still applies (same card width as the
    // fixed-78px era), rather than deleted — a check that stops applying to one card should not stop
    // applying to the other two.
    const expected = now.card * 0.236;
    if (w === 390 && Math.abs(now.d - expected) > 1) {
      console.log(`   🔴 at 390px the avatar is ${now.d.toFixed(1)}px, not 23.6% of a ${now.card.toFixed(0)}px card (${expected.toFixed(1)}px)`);
      bad++;
    }
    // The historical claim was specifically "78px IS 23.6% of the 331px card a 390px viewport gives",
    // so it is pinned to 331 — NOT to `then.card`, which reflects the gutter fix in both columns
    // because OLD here only pins the avatar rule. Comparing the two columns would have compared a
    // 342px card against a 342px card and reported the ratio doing its job as a regression.
    const ERA_CARD = 331;
    if (w === 390 && Math.abs(now.card - ERA_CARD) <= 1 && Math.abs(now.d - 78) > 1) {
      console.log(`   🔴 changed at 390px: ${now.d.toFixed(1)}px on the ${ERA_CARD}px card that used to render exactly 78px`);
      bad++;
    }
    // and the ratio holds everywhere, inside the measured 20.5–30.3% band
    if (pct < 20 || pct > 31) { console.log(`   🔴 ${pct.toFixed(1)}% is outside the band every platform sits in`); bad++; }
    // CONTROL: the old rule must actually FAIL that band somewhere, or this test proves nothing.
    if (w === 1200 && wasPct >= 20) { console.log(`   🔴 CONTROL: the old fixed value was ${wasPct.toFixed(1)}% at 1200px — it was not broken, so nothing was fixed`); bad++; }
  }
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ identical on a phone, and it holds its ratio everywhere else');
process.exitCode = bad ? 1 : 0;
