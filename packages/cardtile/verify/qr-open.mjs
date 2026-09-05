// The QR grows OUT of the avatar, so its first frame must BE the avatar.
//
// chodaict: 「qr動畫因為大頭貼換大顆了,所以qr動畫的起始關鍵影格的大頭貼尺寸也應該跟大頭貼一樣?」
//
// The opening frame used to set `icon.style.width='80px'`, written when the avatar was a hard-coded
// 78px. The avatar is `23.6cqw` now — still 78px on a phone, 152px on a desktop card — so anything
// wider than a phone made the avatar SNAP to 80px the instant you tapped it, before the morph began.
//
// Two claims:
//   1. at the opening frame the avatar is exactly the size it was at rest, at every viewport
//   2. the circle behind it keeps its 1.25 ratio to the avatar rather than a baked 100px
//
// 🔴 CONTROL: with the old constants pinned back, claim 1 must FAIL at a desktop width and PASS at
// 390. That is the shape of the actual bug — invisible on a phone, wrong everywhere else — and a
// harness that cannot reproduce it is not testing anything.
//
// 🔴 This measures GEOMETRY only. The 11 modes, the morph, the timings are chodaict's and are not
// touched, here or in the coral.
//
//   node packages/cardtile/verify/qr-open.mjs
import http from 'node:http';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// 🔴 Cards WITH AN AVATAR only. specimen-plain states none, and since 2026-08-12 a profile with no
// `avatar=` correctly emits no avatar element at all (it used to emit <img src="">, which fetches
// the page as an image). Everything this harness measures hangs off the avatar, so a card without
// one is not a failing case here — it is not a case at all. Read from the cards, not assumed.
const ALL_SPECIMENS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const CARDS = ALL_SPECIMENS.filter((h) => /%% card: profile[^%]*\bavatar=/.test(readCard(h)));
if (!CARDS.length) throw new Error('no specimen states an avatar — this harness has nothing to measure');
const VIEWS = [{ width: 390, height: 844 }, { width: 1200, height: 900 }];
const OLD = 'window.__qrPinOld = true;';

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

async function openQR(handle, view, pinOld) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const rest = await page.evaluate(() => {
    const av = document.querySelector('.st-hero .cp-icon');
    return av ? Math.round(av.getBoundingClientRect().width) : null;
  });
  if (rest == null) { await ctx.close(); return null; }
  // Reproduce the old opening frame by re-applying its constants the moment the group appears.
  if (pinOld) {
    await page.evaluate(() => {
      const obs = new MutationObserver(() => {
        const g = document.getElementById('qr-group');
        if (!g) return;
        const icon = g.querySelector('.cp-icon');
        if (icon) { icon.style.width = '80px'; icon.style.height = '80px'; }
        const circle = g.querySelector('div');
        if (circle && circle !== icon) { circle.style.width = '100px'; circle.style.height = '100px'; }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }
  await page.click('.st-hero .cp-icon');

  // 🩸 TWO CLAIMS, TWO INSTANTS — and reading them at one instant is what made this harness wrong.
  //
  // Claim 1 ("the first frame IS the avatar") is about t≈0: the group is created with the avatar's
  // own box and the icon is set to `iconRect.width`. Claim 2 (the 1.25 ratio) is about the settled
  // frame, AFTER `transition: all .4s` has run — because on a narrow viewport the avatar is
  // deliberately shrunk (see the occlusion cap below) and the ratio only means anything once both
  // have arrived. Read at +120ms the circle is already at its final size while the avatar is still
  // in flight, and the ratio comes out ~1.0 for a coral that is behaving exactly as designed.
  const snap = () => page.evaluate(() => {
    const g = document.getElementById('qr-group');
    if (!g) return { opened: false };
    const icon = g.querySelector('.cp-icon');
    const el = [...g.children].find((c) => c !== icon && c.tagName === 'DIV'
      && getComputedStyle(c).borderRadius.startsWith('50%'));
    // 🔴 offsetWidth for BOTH, for the reason the circle already used it: a transitioning box has a
    // rendered rect that is neither where it started nor where it is going. offsetWidth is the size
    // the CSS declares, which is what each claim is actually about. Measuring one with offsetWidth
    // and the other with getBoundingClientRect compared two different instants and called it a ratio.
    return {
      opened: true,
      icon: icon ? icon.offsetWidth : null,
      circle: el ? el.offsetWidth : null,
    };
  });

  await page.waitForTimeout(16);               // claim 1: the first frame
  const first = await snap();
  await page.waitForTimeout(700);              // claim 2: settled, well past the .4s transition
  const m = await page.evaluate(() => {
    const g = document.getElementById('qr-group');
    if (!g) return { opened: false };
    const icon = g.querySelector('.cp-icon');
    // 🔴 Identify the back-circle by what it IS — a round, filled direct child — not by being the
    // biggest box in the group. The first version took the largest DIV and got the invisible
    // full-size wrapper that holds the QR card, so it reported a 2.2× ratio for a circle it was
    // never looking at.
    // 🔴 offsetWidth, NOT getBoundingClientRect: the circle opens at `transform:scale(0)` by design,
    // so its rendered box is 0×0 at the very frame being measured. A rect-based probe read 0, and
    // because 0 is falsy the ratio assertion below silently skipped — a passing harness that had
    // stopped checking. Layout size ignores the transform and is what the CSS actually declares.
    const el = [...g.children].find((c) => c !== icon && c.tagName === 'DIV'
      && getComputedStyle(c).borderRadius.startsWith('50%'));
    const circle = el ? { width: el.offsetWidth } : null;
    return {
      opened: true,
      icon: icon ? Math.round(icon.getBoundingClientRect().width) : null,
      circle: circle ? Math.round(circle.width) : null,
    };
  });
  await ctx.close();
  return { rest, first, ...m };
}

console.log('card        view   at rest   first frame   settled avatar   circle   ratio');
for (const handle of CARDS) {
  for (const view of VIEWS) {
    const now = await openQR(handle, view, false);
    if (!now) { console.log(`${handle} @${view.width}: 🔴 no avatar`); bad++; continue; }
    if (!now.opened) { console.log(`${handle} @${view.width}: 🔴 the QR did not open — nothing was measured`); bad++; continue; }
    const ratio = now.circle && now.icon ? (now.circle / now.icon).toFixed(2) : '—';
    const ff = now.first && now.first.opened ? now.first.icon : '—';
    console.log(`${handle.padEnd(11)} ${String(view.width).padEnd(6)} ${String(now.rest).padEnd(9)} ${String(ff).padEnd(13)} ${String(now.icon).padEnd(16)} ${String(now.circle).padEnd(8)} ${ratio}`);

    // Claim 1 — THE FIRST FRAME. Measured at t≈0, where the group is created with the avatar's own
    // box. This is the claim that broke when the opening frame baked '80px'.
    if (!now.first || !now.first.opened) { console.log('   🔴 the group was not there at the first frame — claim 1 was not tested'); bad++; }
    else if (Math.abs(now.first.icon - now.rest) > 1) {
      console.log(`   🔴 the avatar jumps ${now.first.icon - now.rest}px the moment it is tapped (${now.rest} → ${now.first.icon})`);
      bad++;
    }

    // Claim 2 — THE SETTLED FRAME, and the ratio is between the circle and the avatar AS IT THEN IS.
    //
    // 🩸 On a narrow viewport the avatar is deliberately SMALLER than it was at rest, and that is
    // not drift — it is the occlusion cap. The disc may never eat more than _QR_DAMAGE of the
    // code's area, so on a phone the whole pair is scaled down together:
    //
    //     _qrOcclWant = rest × 1.25                     390px: 80.7 × 1.25 = 100.9
    //     _qrRoom     = min(innerW, innerH) − 160              min(390,900) − 160 = 230
    //     _qrSide     = max(280, min(⌈want/RATIO⌉, room))      max(280, min(400,230)) = 280
    //     _qrOccl     = min(want, ⌊side × RATIO⌋)              min(100.9, 70) = 70   ← the circle
    //     _qrIcon     = round(occl / 1.25)                     56                    ← the avatar
    //
    // 70 / 56 is exactly 1.25. Comparing the settled circle against the AT-REST avatar reports 1.03
    // and accuses a coral that is doing precisely what it was designed to do. The ratio is what is
    // locked (「大頭貼飛出來遮住QR的『比例』必須鎖定,外面大沒關係」), not the absolute size.
    if (!now.circle) { console.log('   🔴 no back-circle found — claim 2 was not tested'); bad++; }
    else if (!now.icon) { console.log('   🔴 no avatar at the settled frame — the ratio has no denominator'); bad++; }
    else if (Math.abs(now.circle / now.icon - 1.25) > 0.06) {
      console.log(`   🔴 the circle is ${(now.circle / now.icon).toFixed(2)}× the avatar (${now.circle}/${now.icon}), not the 1.25 that is locked`);
      bad++;
    }
  }
}

// 🔴 THE CONTROL — the old constants must reproduce the bug, and reproduce it ONLY off-phone.
console.log('\nCONTROL — pin the old 80px/100px back and the harness must see the jump');
for (const view of VIEWS) {
  const then = await openQR(CARDS[0], view, true);
  if (!then || !then.opened) { console.log(`  @${view.width}: 🔴 could not reproduce the old frame`); bad++; continue; }
  // 🔴 THE FIRST FRAME, not the settled one. This control is about claim 1 — the opening frame used
  // to bake `icon.style.width='80px'` — and the settled frame is governed by the occlusion cap
  // instead, which overwrites the pin and hides the very thing being reproduced.
  if (!then.first || !then.first.opened) { console.log(`  @${view.width}: 🔴 no first frame to inspect`); bad++; continue; }
  const jump = then.first.icon - then.rest;
  console.log(`  @${String(view.width).padEnd(5)} rest ${then.rest} → opening ${then.first.icon}  (jump ${jump}px)`);
  if (view.width === 390 && Math.abs(jump) > 3) {
    console.log(`   🔴 CONTROL: the old frame should have been fine on a phone (78≈80) — ${jump}px says this harness is measuring something else`);
    bad++;
  }
  if (view.width === 1200 && Math.abs(jump) < 20) {
    console.log(`   🔴 CONTROL: the old frame did NOT jump on a desktop card, so the bug was never reproduced and the pass above proves nothing`);
    bad++;
  }
}

// ── CLAIM 3 — what sits ON the code stays inside the error-correction budget ─────────────────────
//
// A QR is not a picture: error correction recovers a bounded fraction of the codewords — L 7%,
// M 15%, Q 25%, H 30% — and anything covering the code is deliberate damage. 🔴 qr-core.mjs encodes
// at **M**, so the ceiling here is 15%, not the 30% that H would allow.
//
// 🔴 The occluder is the BACK CIRCLE, not the avatar: an opaque --cp-ground disc at z-index 1 with
// the QR card behind it at -1, and 1.25× the avatar. Measuring the avatar alone would report a pass
// while the thing actually covering the code stayed oversized.
const BUDGET = 15;      // what EC 'M' can recover
const SPEND = 10.5;     // what we allow — one contiguous block is harder than scattered errors
const VIEWS3 = [{ width: 390, height: 844 }, { width: 834, height: 1112 }, { width: 1200, height: 900 }];

async function covered(view, pinOld) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${CARDS[0]}`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  if (pinOld) await page.evaluate(() => { window.__pinOldQr = true; });
  await page.click('.st-hero .cp-icon');
  await page.waitForTimeout(400);
  if (pinOld) {
    // the geometry as it was: a fixed 280px code, and an occluder sized only from the avatar
    await page.evaluate(() => {
      const g = document.querySelector('.qr-grid');
      if (g) { g.style.width = '280px'; g.style.height = '280px'; }
      const icon = document.querySelector('#qr-group .cp-icon');
      const grp = document.getElementById('qr-group');
      const circle = grp && [...grp.children].find((c) => c !== icon && c.tagName === 'DIV'
        && getComputedStyle(c).borderRadius.startsWith('50%'));
      if (icon) { const d = parseFloat(icon.dataset.rest || 0) || icon.offsetWidth; icon.style.width = d + 'px'; icon.style.height = d + 'px'; }
      if (circle && icon) { const d = icon.offsetWidth * 1.25; circle.style.width = d + 'px'; circle.style.height = d + 'px'; }
    });
  }
  await page.waitForTimeout(2600);            // the RESTING state — what a phone camera is pointed at
  const m = await page.evaluate(() => {
    const grid = document.querySelector('.qr-grid');
    const icon = document.querySelector('#qr-group .cp-icon');
    const grp = document.getElementById('qr-group');
    if (!grid || !icon || !grp) return null;
    const circle = [...grp.children].find((c) => c !== icon && c.tagName === 'DIV'
      && getComputedStyle(c).borderRadius.startsWith('50%'));
    const side = grid.offsetWidth;
    const occl = circle ? circle.offsetWidth : icon.offsetWidth;
    const g = grid.getBoundingClientRect(); const i = icon.getBoundingClientRect();
    return {
      side,
      occl,
      pct: +((Math.PI * (occl / 2) ** 2) / (side * side) * 100).toFixed(1),
      inside: i.left >= g.left - 1 && i.right <= g.right + 1 && i.top >= g.top - 1 && i.bottom <= g.bottom + 1,
    };
  });
  await ctx.close();
  return m;
}

console.log(`\nCLAIM 3 — the occluder stays inside EC 'M' (recovers ${BUDGET}%, we spend ≤ ${SPEND}%)\n`);
console.log('view   QR side   occluder   covered');
for (const view of VIEWS3) {
  const now = await covered(view, false);
  if (!now) { console.log(`${view.width}: 🔴 could not measure the open QR`); bad++; continue; }
  console.log(`${String(view.width).padEnd(6)} ${String(now.side).padEnd(9)} ${String(now.occl).padEnd(10)} ${now.pct}%`);
  if (now.pct > SPEND) { console.log(`   🔴 ${now.pct}% of the code is covered — over our ${SPEND}% allowance`); bad++; }
  if (now.pct > BUDGET) { console.log(`   🔴 …and over EC 'M''s ${BUDGET}% recovery ceiling: this code may not scan`); bad++; }
  if (!now.inside) { console.log('   🔴 the avatar is not inside the code — the measurement is not of what it claims'); bad++; }
}
// 🔴 CONTROL: the old geometry must actually exceed the allowance, and only on the wide viewports.
// That is the exact shape of the bug — 6.5% on a phone, 23.3% on a desktop card — and a harness that
// cannot reproduce it would pass just as happily on a page where the QR never opened.
console.log('\nCONTROL — the old geometry (fixed 280px code, uncapped disc)');
for (const view of [VIEWS3[0], VIEWS3[2]]) {
  const then = await covered(view, true);
  if (!then) { console.log(`  @${view.width}: 🔴 could not reproduce`); bad++; continue; }
  console.log(`  @${String(view.width).padEnd(5)} side ${then.side}  occluder ${then.occl}  covered ${then.pct}%`);
  if (view.width === 1200 && then.pct <= SPEND) {
    console.log(`   🔴 CONTROL: the old geometry was already within budget at 1200 — nothing was reproduced, so the pass above proves nothing`);
    bad++;
  }
  if (view.width === 390 && then.pct > BUDGET) {
    console.log(`   🔴 CONTROL: the old geometry should have been SAFE on a phone — ${then.pct}% says this is measuring something else`);
    bad++;
  }
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the morph starts from the avatar, and what lands on the code stays scannable');
process.exitCode = bad ? 1 : 0;
