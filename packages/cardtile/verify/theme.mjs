// Both themes, on the real cards, measured against the pixels the browser actually painted.
//
// colour.test.mjs sweeps 294 accents × 2 modes and proves every text/background pair in the ramp
// clears its floor. That is arithmetic. This is the other half — and it took three tries, each of
// which is a lesson worth keeping:
//
//   1. Parsing `getComputedStyle().color` broke immediately: anything out of a color-mix comes back
//      as `color(srgb 0.903 0.968 0.968)`, components 0..1. A /[\d.]+/ match read those as bytes and
//      reported 90 failures on a page that was painting perfectly. The instrument was broken.
//   2. Walking ancestors for the first opaque `background-color` broke next: a Card's page
//      background is a GRADIENT on <body> (`--cp-mist-*`), so the walk skipped it and landed on
//      <html>'s hard-coded Python-era blue. Every "failure" it found was against a colour no reader
//      ever sees.
//   3. So: hide every glyph, screenshot the page with no text on it, and sample that image at each
//      text run's own centre. Gradients, scrims, artwork and stacking all resolve themselves,
//      because the answer is read off the paint rather than reconstructed from declarations.
//
//   node packages/cardtile/verify/theme.mjs
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { contrast, toHex, BODY_FLOOR, LARGE_FLOOR } from '../colour.mjs';

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const VIEW = { width: 390, height: 844 };
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;

/** Every visible text run: its colour (via canvas, which speaks every CSS colour syntax) and box. */
const RUNS = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => {
    g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.5) continue;
    out.push({
      tag: el.className || el.tagName, fg: rgb(cs.color),
      size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
      shadow: cs.textShadow !== 'none',
      x: r.x + scrollX + r.width / 2, y: r.y + scrollY + r.height / 2,
      // the run's box, for sampling the glyphs' immediate surround (see sampleSurround)
      bx: r.x + scrollX, by: r.y + scrollY, bw: r.width, bh: r.height,
      text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 26),
    });
  }
  return out;
};

/**
 * The colour a glyph is actually READ AGAINST — its immediate surround in the rendered page.
 *
 * 🔴 This is what lets a text-shadow be measured instead of merely annotated. The old measure hid
 * every glyph and sampled what was underneath, which is the right answer for ink on a flat ground
 * and the WRONG one for ink on a photograph: what a reader's eye compares a white glyph to is not
 * the artwork two pixels away, it is the dark halo the shadow puts right next to it. Scoring
 * against the artwork made a scrim look necessary and a shadow look broken — and I let that decide
 * the design once already.
 *
 * For each run: sample a grid inside its box in the WITH-TEXT render, throw away the pixels that
 * are the ink itself, and keep the SURVIVOR WITH THE WORST CONTRAST against the ink. Conservative
 * by construction — it reports the least favourable place the glyph sits, not the average.
 */
/** WCAG 的門檻是逐 run 的（大字放寬）。抽成一支，因為取樣端和評分端都要用同一個數。 */
const FLOOR_OF = (r) => ((r.size >= 24 || (r.size >= 18.66 && r.weight >= 700)) ? LARGE_FLOOR : BODY_FLOOR);

async function sampleSurround(shotWith, shotWithout, boxes, inks, floors) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<img id=a><img id=b>');
  await page.evaluate(async ([sa, sb]) => {
    const load = (el, s) => new Promise((ok) => { el.onload = ok; el.src = 'data:image/png;base64,' + s; });
    await Promise.all([load(document.getElementById('a'), sa), load(document.getElementById('b'), sb)]);
  }, [shotWith.toString('base64'), shotWithout.toString('base64')]);
  const out = await page.evaluate(([bs, inkList, floorList]) => {
    const grab = (id) => {
      const img = document.getElementById(id);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
      return { d: c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    };
    const A = grab('a'); const B = grab('b');
    const s = A.w / 390;
    const at = (I, x, y) => { const o = (y * I.w + x) * 4; return [I.d[o], I.d[o + 1], I.d[o + 2]]; };
    const lum = (p) => { const f = p.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
    const ratio = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return x > y ? x / y : y / x; };
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    return bs.map((box, i) => {
      if (!box) return null;
      const ink = inkList[i];
      const [bx, by, bw, bh] = box;
      const x0 = Math.max(0, Math.round(bx * s)); const x1 = Math.min(A.w - 1, Math.round((bx + bw) * s));
      const y0 = Math.max(0, Math.round(by * s)); const y1 = Math.min(A.h - 1, Math.round((by + bh) * s));
      const W = x1 - x0 + 1; const H = y1 - y0 + 1;
      if (W < 3 || H < 3) return null;
      // Pass A: mark where the GLYPH is — changed by the text, and moved TOWARD the ink.
      const isInk = new Uint8Array(W * H);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const a = at(A, x, y); const b = at(B, x, y);
          if (dist(a, b) >= 12 && ratio(ink, a) < ratio(ink, b)) isInk[(y - y0) * W + (x - x0)] = 1;
        }
      }
      // Pass A½: DILATE the ink mask by 1px, because the ring immediately around a glyph is
      // ANTI-ALIASING — a blend of ink and background. Those pixels sit arbitrarily close to the ink
      // in colour, so "the worst-contrast non-ink pixel next to ink" is almost always one of them and
      // the metric collapses toward 1.0 no matter what is actually behind the text.
      //
      // 🩸 This was invisible until the hide-glyphs style bug above was fixed: with both screenshots
      // identical there were no ink pixels at all, so there was no anti-aliased ring to trip over and
      // every reading quietly used the bare ground instead. One bug was masking the other.
      const isEdge = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isInk[y * W + x]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx; const ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < W && ny < H) isEdge[ny * W + nx] = 1;
            }
          }
        }
      }

      // Pass B: the surround is what the glyph EDGE touches — a non-ink pixel within 2px of ink.
      //
      // 🔴 Not "the worst changed pixel anywhere in the box". That version punished the correct fix:
      // enlarging a halo adds a ring of FAINT outer pixels, each barely darker than the picture, and
      // the minimum over all of them got worse the more shadow you added. Strengthening the video
      // label's scrim moved it 3.67 → 2.61 — the design improved and the number fell. A metric that
      // rewards the wrong direction is worse than no metric.
      // 🔴 `worst` 是最小值，而最小值在吵雜的藝術圖上永遠找得到一顆接近墨色的像素 ——
      // 它分不出「一顆壞像素」和「半數都壞」。所以同時數「低於門檻的比例」：
      // 1/500 是雜訊，40% 是缺陷，而只報最差一顆的輸出讓收到的人無從行動。
      const floor = floorList[i];
      let below = 0;
      let worst = null; let worstR = Infinity; let halo = 0;
      const R = 2;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i0 = (y - y0) * W + (x - x0);
          if (isEdge[i0]) continue;          // 墨 + 反鋸齒環，兩者都不是「周圍」
          const a = at(A, x, y); const b = at(B, x, y);
          if (dist(a, b) < 12) continue;                 // untouched by the text
          let touches = false;
          for (let dy = -R; dy <= R && !touches; dy++) {
            for (let dx = -R; dx <= R; dx++) {
              const nx = x - x0 + dx; const ny = y - y0 + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (isEdge[ny * W + nx]) { touches = true; break; }
            }
          }
          if (!touches) continue;                        // outer halo, not what a glyph sits against
          halo++;
          const r = ratio(ink, a);
          if (r < floor) below++;
          if (r < worstR) { worstR = r; worst = a; }
        }
      }
      return halo > 8 ? { worst, halo, below } : null;   // null = no halo worth speaking of; caller uses bare ground
    });
  }, [boxes, inks, floors]);
  await ctx.close();
  return out;
}

/** Read the painted colour at each point of a PNG. */
async function samplePng(png, points) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(`<img id=i src="data:image/png;base64,${png.toString('base64')}">`);
  await page.waitForFunction(() => document.getElementById('i').complete && document.getElementById('i').naturalWidth > 0);
  const out = await page.evaluate((pts) => {
    const img = document.getElementById('i');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const s = img.naturalWidth / 390;
    return pts.map(([x, y]) => {
      const px = Math.min(c.width - 1, Math.max(0, Math.round(x * s)));
      const py = Math.min(c.height - 1, Math.max(0, Math.round(y * s)));
      const d = g.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  }, points);
  await ctx.close();
  return out;
}

console.log('card        theme  runs  worst  where');
const inks = {};
let inkHandle = null;          // 哪一張卡被拿來當深/淺模式的樣本 —— 要印出來，不然讀者無從查證
for (const handle of CARDS) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
      i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
    await page.waitForTimeout(700);

    const runs = await page.evaluate(RUNS);
    // 🔴 Captured HERE, not at scoring time: by then the context is closed and `page.evaluate`
    // throws. A card with no artwork has nothing for a shadow to separate text from, so "no halo"
    // there is the correct answer rather than a defect — and this is scoped by what the page
    // CONTAINS, not by a card's name, because naming a card is how the previous version of this
    // control retired silently the day that card left the package.
    const hasArtwork = await page.evaluate(() =>
      !!document.querySelector('.st-gal-img, .st-backdrop, [class*=backdrop] img, .st-card-backdrop'));
    // 🔴 The scrollbar gutter. No text lives there, so no contrast check can ever see it — and on a
    // light card it was a black bar down the right-hand edge, left by card.css's hard-coded
    // `html{background-color:#0a1628}`. Found by looking at a screenshot, which is the only way it
    // could have been found.
    const edge = await page.evaluate(() => {
      const c = document.createElement('canvas'); const g = c.getContext('2d');
      g.fillStyle = getComputedStyle(document.documentElement).backgroundColor;
      return g.fillStyle;
    });
    if (/^#0a1628$/i.test(edge)) { console.log(`   🔴 the page edge is still the hard-coded #0a1628`); bad++; }
    await page.screenshot({ path: join(OUT, `theme-${handle}-${scheme}.png`), fullPage: true });
    // 🩸 This used to be gated on one creator's handle. That card left the package on 2026-08-12 when
    // the hand-built customer cards moved to lab/, so the branch stopped running — and because
    // the check below is `inks.dark === inks.light`, two undefineds compared EQUAL and it reported
    // "prefers-color-scheme changed nothing". A gate firing because it measured nothing at all,
    // wearing the exact wording of the defect it exists to catch. Worse than silence: silence gets
    // investigated, and this looked like an answer.
    //
    // Now it samples whichever card runs first, and says which one — so the reading is checkable.
    if (!inkHandle || inkHandle === handle) {
      inkHandle = handle;
      inks[scheme] = await page.evaluate(() => {
        const c = document.querySelector('.st-cell-tile') || document.querySelector('.st-cell');
        return c ? getComputedStyle(c).color + ' / ' + getComputedStyle(c).backgroundColor : null;
      });
    }

    // ── PASS 1: the page AS A READER SEES IT, to measure each glyph's immediate surround ─────────
    // This has to happen before the glyphs are hidden, for the obvious reason: a shadow is only in
    // the picture while the text that casts it is.
    // 🔴 The two renders must come from the SAME scroll position, or the diff compares different
    // parts of the page. So the hide-glyphs rule is a style element that is toggled in place,
    // between two screenshots taken without moving.
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.id = '__hideGlyphs';
      s.textContent = '*{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}';
      document.head.appendChild(s);
      // 🔴 AFTER appendChild, AND THIS IS THE WHOLE BUG. Setting `.disabled` on a <style> that is not
      // yet in the document does not stick — the property reads back as `false` and the sheet is
      // LIVE from the moment it is appended. Verified in this browser: text is rgba(0,0,0,0)
      // immediately, and only a second assignment after append restores it.
      //
      // Consequence: `shotWith` — the render that is supposed to HAVE text — never had any. Both
      // screenshots were identical, so Pass A found zero ink pixels, Pass B found zero halo, and
      // every single reading this file has ever printed fell through to the bare ground. The
      // shadow measurement, which is the reason the third rewrite exists, has never once run.
      //
      // Its own control says exactly this ("every ratio above is the BARE GROUND") and lived behind
      // gated on a handle — a card that left the package — so it never said it.
      s.disabled = true;
    });
    await page.waitForTimeout(120);
    const pageH0 = await page.evaluate(() => document.documentElement.scrollHeight);
    const surrounds = new Array(runs.length);
    for (let top = 0; top < pageH0; top += VIEW.height) {
      const here = runs.map((r, i) => [r, i]).filter(([r]) => r.by >= top && r.by + r.bh < top + VIEW.height);
      if (!here.length) continue;
      await page.evaluate((y) => window.scrollTo(0, y), top);
      await page.waitForTimeout(140);
      const at = await page.evaluate(() => window.scrollY);
      const vis = here.filter(([r]) => r.by - at >= 0 && r.by + r.bh - at < VIEW.height);
      if (!vis.length) continue;
      const shotWith = await page.screenshot();
      await page.evaluate(() => { document.getElementById('__hideGlyphs').disabled = false; });
      await page.waitForTimeout(90);
      const shotWithout = await page.screenshot();
      await page.evaluate(() => { document.getElementById('__hideGlyphs').disabled = true; });
      await page.waitForTimeout(60);
      const got = await sampleSurround(
        shotWith, shotWithout,
        vis.map(([r]) => [r.bx, r.by - at, r.bw, r.bh]),
        vis.map(([r]) => r.fg),
        vis.map(([r]) => FLOOR_OF(r)),
      );
      vis.forEach(([, i], k) => { surrounds[i] = got[k]; });
    }

    // Hide every glyph, keep every box: the same page with the text lifted off it.
    //
    // 🔴 `scroll-behavior:auto` is not cosmetic — it is the difference between this harness working
    // and this harness lying. card.css sets `html{scroll-behavior:smooth}`, which makes `scrollTo`
    // ANIMATED, so the `window.scrollY` read back inside the same evaluate returns the position
    // before the animation, i.e. 0 — measured: read-back 0, and 830 four hundred milliseconds later,
    // for a requested 844. Every sample below the first viewport was then computed at an absolute
    // document y, fell outside the viewport screenshot, and was CLAMPED to its bottom row by
    // samplePng. Pinned to `auto` the same call reads back 844 immediately and exactly.
    await page.addStyleTag({ content: '*{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}'
      + 'html{scroll-behavior:auto!important}' });
    await page.waitForTimeout(200);

    // 🔴 Viewport screenshots, scrolled — NOT one fullPage capture. A Card's page background is
    // `background-attachment: fixed`, and a fullPage screenshot paints a fixed background once and
    // leaves the rest on <html>'s hard-coded Python-era blue. That artifact reported the footers of
    // two live cards as failing against a colour no reader has ever seen. What a reader gets is a
    // viewport at a time, so that is what is measured.
    const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
    const bgs = new Array(runs.length);
    for (let top = 0; top < pageH; top += VIEW.height) {
      const here = runs.map((r, i) => [r, i]).filter(([r]) => r.y >= top && r.y < top + VIEW.height);
      if (!here.length) continue;
      // 🔴 Read back where we ACTUALLY landed. scrollTo clamps at the bottom of the document, so on
      // the last step the requested `top` and the real scroll position differ — and every sample
      // taken at `r.y - top` then lands somewhere else on the page entirely. That mis-sampling
      // reported cells as sitting on the page background.
      // 🔴 The read-back is a SEPARATE evaluate, after the wait. Inside the scrolling call it reports
      // where the page was, not where it is going — see the scroll-behavior note above.
      await page.evaluate((y) => window.scrollTo(0, y), top);
      await page.waitForTimeout(150);
      const at = await page.evaluate(() => window.scrollY);
      const shot = await page.screenshot();                       // viewport only
      const visible = here.filter(([r]) => r.y - at >= 0 && r.y - at < VIEW.height);
      if (!visible.length) continue;
      const got = await samplePng(shot, visible.map(([r]) => [r.x, r.y - at]));
      visible.forEach(([, i], k) => { bgs[i] = got[k]; });
    }
    // Anything the stepping missed (a run straddling a clamped step) gets its own scroll.
    // 🔴 Every sample records whether its point was actually INSIDE the viewport it was taken from.
    // samplePng clamps out-of-range coordinates to the image edge, so a mis-scroll does not throw —
    // it silently returns the colour of the bottom row and scores it as the run's background. That
    // is exactly how the smooth-scroll bug hid: the only guard was "every background is pure black",
    // which cannot fire while the first viewport still samples correctly.
    const offscreen = [];
    for (let i = 0; i < runs.length; i++) {
      if (bgs[i]) continue;
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, runs[i].y - VIEW.height / 2));
      await page.waitForTimeout(120);
      const at = await page.evaluate(() => window.scrollY);
      const shot = await page.screenshot();
      const dy = runs[i].y - at;
      if (dy < 0 || dy >= VIEW.height) offscreen.push(`${runs[i].text} (y=${Math.round(runs[i].y)}, scroll=${at})`);
      bgs[i] = (await samplePng(shot, [[runs[i].x, dy]]))[0];
    }
    if (offscreen.length) {
      console.log(`   🔴 ${offscreen.length} run(s) sampled OUTSIDE the viewport — those readings are the screenshot's edge, not the page`);
      offscreen.slice(0, 3).forEach((t) => console.log(`      ${t}`));
      bad++;
    }
    await ctx.close();
    const scored = runs.map((r, i) => {
      const bare = bgs[i];                 // what is UNDER the text — artwork, gradient, surface
      const surr = surrounds[i];           // { worst, halo, below } | null
      const near = surr && surr.worst;     // what the glyph is actually read against — includes its shadow
      // WCAG: 24px, or 18.66px bold, counts as large text and drops to 3:1.
      const floor = FLOOR_OF(r);
      // 🔴 SCORED AGAINST THE SURROUND. That is the colour a reader's eye compares the glyph to, and
      // it is the only measure under which a shadow counts for anything. `bare` is kept and printed
      // because the gap between the two IS the shadow's contribution — when they are equal there is
      // no shadow doing any work, and if the run needed one that is worth seeing.
      const bg = near || bare;
      return { ...r, bg, bare, halo: surr && surr.halo, below: surr && surr.below, shadowed: !!near && !!bare && contrast(r.fg, near) > contrast(r.fg, bare) + 0.3, ratio: contrast(r.fg, bg), floor };
    });
    const failing = scored.filter((s) => s.ratio < s.floor);
    const worst = scored.reduce((a, b) => (a && a.ratio <= b.ratio ? a : b), null);
    console.log(`${handle.padEnd(11)} ${scheme.padEnd(6)} ${String(scored.length).padEnd(5)} `
      + `${worst ? worst.ratio.toFixed(2) : '—'}   ${worst ? `"${worst.text}"` : ''}`);
    for (const f of failing) {
      console.log(`   🔴 ${f.ratio.toFixed(2)} < ${f.floor}  ${String(f.tag).slice(0, 30).padEnd(32)}`
        + ` ${toHex(f.fg)} on ${toHex(f.bg)}  "${f.text}"`
        + (f.halo ? `   [${Math.round((f.below / f.halo) * 100)}% of ${f.halo} edge px below floor]` : '')
        + (f.bare ? `   (bare ground ${toHex(f.bare)} = ${contrast(f.fg, f.bare).toFixed(2)})` : ''));
      bad++;
    }
    // 🔴 A CONTROL for the new measure: on a card with a backdrop, at least one run must be doing
    // BETTER against its surround than against the bare artwork. If none is, the shadows are not
    // reaching the pixels and this harness has quietly gone back to scoring only flat grounds.
    // 🩸 THIS CONTROL LIVED BEHIND A NAMED HANDLE UNTIL 2026-08-12, and that card left the
    // package when the hand-built cards moved to lab/. So the one check that can say "every
    // number above is just the bare ground wearing a new name" had not run since — while, as it
    // turns out, that is exactly what had happened. Third dead `if` in this file guarding a card
    // that no longer exists; this one was guarding the truth about all the others.
    //
    // It runs on EVERY card now. A control that only watches one card is a control that retires
    // with it.
    // 🔴 …but only where a halo is EXPECTED — see hasArtwork, captured while the page was alive.
    const withHalo = scored.filter((s) => s.bg !== s.bare);
    if (hasArtwork && !withHalo.length) {
      console.log(`   🔴 CONTROL: not one run scored against a halo — every ratio above is the BARE GROUND,`);
      console.log(`      so the text-shadows contributed nothing measurable and this card's numbers say`);
      console.log(`      only "ink vs artwork", which is not what a reader sees.`);
      bad++;
      for (const s of scored.slice(0, 4)) {
        console.log(`      ${String(s.tag).slice(0, 22).padEnd(24)} ink ${toHex(s.fg)}  bare ${toHex(s.bare)} ${s.ratio.toFixed(2)}`
          + `  shadow=${s.shadow ? 'yes' : 'no'}  halo px=${s.halo ?? 0}`);
      }
    }
  }
}

console.log(`\n${inkHandle || '(no card)'} cell ink / background`);
console.log(`  dark   ${inks.dark}`);
console.log(`  light  ${inks.light}`);
// 🔴 CONTROL FIRST, and it is the whole lesson of this file's own header applied to itself:
// "a probe that finds nothing reports a perfect page" — except here it reported a BROKEN one.
// Two undefineds are equal, so a missing sample produced the exact sentence the check exists to
// print. Say "I measured nothing" before ever saying "nothing changed".
if (inks.dark == null || inks.light == null) {
  console.log(`🔴 CONTROL: no ink sample (dark=${inks.dark}, light=${inks.light}) — this check measured NO page at all, so it can say nothing about the theme`);
  bad++;
} else if (inks.dark === inks.light) { console.log('🔴 prefers-color-scheme changed nothing'); bad++; }

await browser.close();
server.close();
// 🔴 NAME THE LEVER, NOT JUST THE NUMBER. A row saying "2.14 < 4.5" is a fact nobody can act on;
// the reader has to go and find out what makes it 2.14. Measured on 2026-08-12: every failure was on
// a card that sets `backdrop:` and NO `backdrop-dim:`, and the card that sets `backdrop-dim: 41`
// clears the floor at 4.97 in the same themes with the same renderer. That is one knob, and it is
// the difference between text on artwork being readable and not. Say so where the red is.
{
  const noDim = CARDS.filter((h) => {
    const md = readCard(h);
    return /^backdrop:/m.test(md) && !/^backdrop-dim:/m.test(md);
  });
  const withDim = CARDS.filter((h) => /^backdrop-dim:\s*\d/m.test(readCard(h)));
  if (bad && noDim.length) {
    console.log(`\n   ⚠️ ${noDim.join(', ')} set a backdrop with NO backdrop-dim — text lands straight on the`);
    console.log('      artwork and the halo alone does not carry it. ' + (withDim.length
      ? `${withDim.join(', ')} set one and clear the floor.`
      : 'No card here sets one, so nothing shows what it is worth.'));
    console.log('      🔴 Whether the DEFAULT should guarantee a floor is a look decision, not a bug fix:');
    console.log('         changing it repaints every published card that has a backdrop and no dim.');
  }
}
console.log(`\n${OUT}\n${bad ? '🔴 ' + bad + ' problem(s)' : '✅ both themes paint, and every text run clears its floor against the pixels behind it'}`);
process.exitCode = bad ? 1 : 0;
