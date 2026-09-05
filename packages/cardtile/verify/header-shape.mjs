// The header's SHAPE — the last place the layout still contradicts its own evidence.
//
// The survey (10 pages, 3 platforms) found **10/10 centre the avatar**, with a median header height
// ÷ card width of **0.977** — near square. Ours is avatar-left / text-right and about half as tall.
// The avatar's SIZE was already corrected to a ratio (23.6cqw); its POSITION never was.
//
// Two claims:
//
//   1. the avatar is CENTRED — its midpoint sits on the card's midpoint, within a pixel or two
//   2. the header is roughly SQUARE — height ÷ card width lands near the surveyed 0.977, not the
//      ~0.45 it measures today
//
// and a third that keeps the change honest:
//
//   3. nothing below the header moves relative to it — the cells keep their order, their widths and
//      their row structure. A header rebuild that quietly reflowed the grid would be a different
//      change wearing this one's name.
//
// 🔴 CONTROLS on 1 and 2: with the old rule pinned back, the avatar must actually be off-centre and
// the header must actually be short. Otherwise this passes on a page where the header never rendered
// at all — every ratio would be null and every comparison vacuously fine.
//
//   node packages/cardtile/verify/header-shape.mjs
import http from 'node:http';
import fs from 'node:fs';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// 🔴 Cards WITH AN AVATAR only. specimen-plain states none, and since 2026-08-12 a profile with no
// `avatar=` correctly emits no avatar element at all (it used to emit <img src="">, which fetches
// the page as an image). Everything this harness measures hangs off the avatar, so a card without
// one is not a failing case here — it is not a case at all. Read from the cards, not assumed.
const ALL_SPECIMENS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const CARDS = ALL_SPECIMENS.filter((h) => /%% card: profile[^%]*\bavatar=/.test(readCard(h)));
if (!CARDS.length) throw new Error('no specimen states an avatar — this harness has nothing to measure');
const VIEWS = [{ width: 390, height: 844 }, { width: 1200, height: 900 }];
const SURVEYED = 0.977;
// 🔴 Centred is the DEFAULT, not the only arrangement. `header: left` is a supported choice and
// some cards use it. So the claim is no longer "every card is centred" — it is "every card matches
// what it ASKED FOR", which is a stronger statement and the only one that can catch a switch that
// silently does nothing. Read from the card file rather than hardcoded here, or this drifts the
// first time a card changes its mind.
const declared = (handle) => (/^header:\s*left\s*$/m.test(readCard(handle)) ? 'left' : 'centred');
// 🔴 !important: addStyleTag appends to <head>, NATIVE_CSS is printed in the <body>.
const OLD = `.st-card .st-hero{flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;text-align:left!important;gap:18px!important}
.st-card .st-hero-text{text-align:left!important}`;

// 🔴 The surveyed 0.977 is a MEDIAN over pages that mostly carry a multi-line bio AND a social row —
// the spec's "6×6" shape. All three of our cards are the other one, "6×2": a single tagline. So a
// ratio short of 0.977 on them could mean either "the layout cannot express it" or "these cards do
// not have that much content", and those need telling apart before any number is called a pass.
// This synthetic card is the discriminator: same renderer, 6×6 content. If it reaches the surveyed
// ratio, the shortfall on the real cards is content and not layout — demonstrated, not argued.
const SIXBYSIX = ['---', 'card-page: sixbysix', 'title: Six', 'accent: #0556ff', '---', '',
  '## grid', '',
  // 🩸 The avatar was fetched from a creator's own web server, and the avatar IS the subject here —
  // claim 1 measures where its midpoint sits. A harness whose subject lives on somebody else's
  // machine measures something different the day they move that file, and says nothing about it.
  // A 1×1 data URI instead: the size is CSS (23.6cqw), so the geometry is unchanged and the
  // measurement no longer leaves this process. The copy is a generic 6×6 persona for the same
  // reason it was a real one — the LENGTH is what makes this card 6×6 — but nobody's now.
  '- [ ] %% card: profile w=6 avatar="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" ' +
    // 🔴 THIS COPY IS TUNED, NOT CHOSEN. What makes this card 6×6 is that the tagline wraps to FIVE
    // lines at 390px — heroH 306 — and that height is the measurement claim 2b is about. The persona
    // it replaced was a real creator's, and three different rewrites of the same LENGTH came out at
    // six lines: same character count, different word boundaries. So if you reword this, re-measure:
    // a nicer sentence that wraps to six lines makes the claim easier to pass and says nothing about
    // it. De-identify the label; the measurement stays where it was.
    'chips="Furniture | Commissions | Workshops | est. 2019" %% ' +
    'Furniture maker working mainly in oak and reclaimed pine. Chairs, low tables and the odd ' +
    'staircase, all cut and joined by hand in a small yard. Commissions open and short workshops ' +
    'run twice a month.',
  '- [ ] %% card: link w=6 icon=shop %% [Shop](https://example.com)',
].join('\n');

const store = { get: async (h) => (h === 'sixbysix' ? SIXBYSIX : CARDS.includes(h) ? readCard(h) : null) };
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

async function probe(handle, view, pinOld) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await page.waitForTimeout(700);
  if (pinOld) { await page.addStyleTag({ content: OLD }); await page.waitForTimeout(250); }
  const m = await page.evaluate(() => {
    const hero = document.querySelector('.st-hero');
    const av = document.querySelector('.st-hero .cp-icon');
    const wrap = document.querySelector('.st-cells-wrap');
    if (!hero || !wrap) return null;
    const h = hero.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const a = av && av.getBoundingClientRect();
    // every cell AFTER the header, so claim 3 can see any reflow
    // 🩸 THE FINGERPRINT USED TO CARRY HEIGHT, and height is not a layout fact — it is a text fact.
    // On 2026-08-13 this went red in CI and green on this Mac, three runs, two of them red: three
    // 105px-wide cells all gained exactly 22px, which is the shape of one extra wrapped line. The
    // claim is "nothing below the header REFLOWS" — a statement about arrangement — and it was being
    // decided by whichever font the runner had. A layout claim must not be settled by font metrics.
    //
    // 🔴 So the gate is what arrangement controls: the span, the rendered width, the x position, and
    // the order. Height is still measured and still PRINTED (see the caller) — a cell that genuinely
    // grew because the header pushed it is worth seeing — but it does not fail the run, because
    // nothing here can tell that apart from a wrap. Report what you cannot attribute.
    const els = Array.from(document.querySelectorAll('.st-cells > *')).slice(1);
    const cells = els.map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.getAttribute('data-w')}:${Math.round(r.width)}@${Math.round(r.x)}`;
    });
    const heights = els.map((el) => Math.round(el.getBoundingClientRect().height));
    return {
      cardW: Math.round(w.width),
      heroH: Math.round(h.height),
      ratio: +(h.height / w.width).toFixed(3),
      // how far the avatar's midpoint is from the card's midpoint
      avOffset: a ? Math.round((a.left + a.width / 2) - (w.left + w.width / 2)) : null,
      avW: a ? Math.round(a.width) : null,
      cells: cells.join(' '),
      heights: heights.join(' '),
      cellCount: cells.length,
    };
  });
  await ctx.close();
  return m;
}

// The control for a `header: left` card: force the centred composition back on and check the probe
// reports it as centred. Without this, "the avatar is left of centre" is also what you would measure
// on a page where the header never rendered, or where every measurement is nonsense.
const CENTRED = `.st-card.st-card-head-left .st-hero{flex-direction:column!important;align-items:center!important;justify-content:center!important;text-align:center!important}
.st-card.st-card-head-left .st-hero-text{text-align:center!important;align-items:center!important}`;
async function probeCentred(handle, view) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: CENTRED });
  await page.waitForTimeout(200);
  const off = await page.evaluate(() => {
    const av = document.querySelector('.st-hero .cp-icon');
    const wrap = document.querySelector('.st-cells-wrap');
    if (!av || !wrap) return null;
    const a = av.getBoundingClientRect(); const w = wrap.getBoundingClientRect();
    return Math.round((a.left + a.width / 2) - (w.left + w.width / 2));
  });
  await ctx.close();
  return off;
}

console.log('CLAIM 1 & 2 — each card gets the arrangement it asked for, and a centred header is roughly square\n');
console.log('card        view   cardW  heroH  ratio   avatar off-centre     was (avatar-left)');
for (const handle of CARDS) {
  for (const view of VIEWS) {
    const now = await probe(handle, view, false);
    const then = await probe(handle, view, true);
    if (!now || !then) { console.log(`${handle} @${view.width}: 🔴 no header rendered — nothing was measured`); bad++; continue; }
    console.log(`${handle.padEnd(11)} ${String(view.width).padEnd(6)} ${String(now.cardW).padEnd(6)} ${String(now.heroH).padEnd(6)} ${String(now.ratio).padEnd(7)} ${String(now.avOffset + 'px').padEnd(21)} ratio ${then.ratio} off ${then.avOffset}px`);

    if (now.avOffset == null) { console.log('   🔴 no avatar'); bad++; continue; }
    const want = declared(handle);
    // Claim 1 holds at EVERY width: an arrangement is a composition, not a measurement, so nothing
    // about it is specific to the viewport the survey was taken at.
    if (want === 'centred' && Math.abs(now.avOffset) > 2) {
      console.log(`   🔴 declares centred, but the avatar is ${now.avOffset}px off the card's centre`); bad++;
    }
    // 🔴 `header: left` must actually move it. A switch that renders identically to the default is
    // indistinguishable from a switch that is not wired up at all, which is exactly the failure a
    // one-word frontmatter flag invites.
    if (want === 'left' && now.avOffset > -40) {
      console.log(`   🔴 declares left, but the avatar sits ${now.avOffset}px from centre — the switch did nothing`); bad++;
    }
    if (now.ratio > 1.35) { console.log(`   🔴 header ratio ${now.ratio} is taller than a 6×6 hero — it has stopped being a header`); bad++; }

    // 🔴 Claim 2 is asserted ONLY at 390px, and that is a restriction on the EVIDENCE, not a
    // threshold moved to make this pass. Every number in the survey — 10/10 centred, the 0.977
    // median, and the avatar ratios (Linktree 24.6%, Portaly 30.3%, lit.link 20.5%) — was read off a
    // 390px viewport. A 646px desktop card is outside the domain those figures were measured in, and
    // scoring it against 0.977 would be inventing evidence rather than using it. Desktop gets the one
    // claim that does survive the move: it must not fall back to the wide-short bar this replaces.
    if (want === 'left') {
      // A left header is the SHORT arrangement by construction — the survey's 0.977 describes the
      // centred stack, and scoring the deliberate alternative against it would be scoring it for not
      // being the default.
    } else if (view.width === 390) {
      if (now.ratio < 0.6) { console.log(`   🔴 header ratio ${now.ratio} has not moved meaningfully toward the surveyed ${SURVEYED}`); bad++; }
    } else if (now.ratio <= then.ratio) {
      console.log(`   🔴 at ${view.width}px the header is no taller than the bar it replaces (${now.ratio} vs ${then.ratio})`);
      bad++;
    }

    // 🔴 CONTROLS. For a centred card: the pinned left rule must actually be off-centre and short,
    // or the claims above are vacuous. For a LEFT card the same pin reproduces what it already is —
    // so the control inverts, and the probe must show it can see centring when centring is applied.
    if (want === 'centred') {
      if (Math.abs(then.avOffset) <= 2) { console.log(`   🔴 CONTROL: the left rule already centred the avatar (${then.avOffset}px) — nothing is being measured`); bad++; }
      if (then.ratio >= 0.6) { console.log(`   🔴 CONTROL: the left header was already ${then.ratio} tall — it was not short, so nothing was fixed`); bad++; }
    } else {
      const centred = await probeCentred(handle, view);
      if (centred == null || Math.abs(centred) > 2) {
        console.log(`   🔴 CONTROL: forcing the centred rule left the avatar at ${centred}px — this probe cannot detect centring, so "it is left" proves nothing`);
        bad++;
      } else {
        console.log(`         control: forcing centred → ${centred}px, so the probe can tell the two apart`);
      }
    }
  }
}

// ── the discriminator ───────────────────────────────────────────────────────────────────────────
// Our three cards land near 0.7, not 0.977. Is that the layout failing, or is it that all three are
// the "6×2" shape — one tagline — where the surveyed median is mostly "6×6", a bio plus a social row?
console.log(`\nCLAIM 2b — given 6×6 CONTENT, the same layout reaches the surveyed ${SURVEYED}`);
const six = await probe('sixbysix', VIEWS[0], false);
const sixOld = await probe('sixbysix', VIEWS[0], true);
console.log(`  6×6 content @390   cardW ${six.cardW}  heroH ${six.heroH}  ratio ${six.ratio}   (avatar-left would be ${sixOld.ratio})`);
if (six.ratio < 0.85 || six.ratio > 1.15) {
  console.log(`   🔴 ${six.ratio} is not near ${SURVEYED} — so the shortfall on the real cards is the LAYOUT, not their content`);
  bad++;
} else {
  console.log(`   ✅ the layout expresses ${SURVEYED} when the content is there; the real cards are short because they are 6×2`);
}

// ── CLAIM 2c — a tagline breaks between words, not through them ──────────────────────────────────
// CJK has no spaces, so a browser will break a line between ANY two characters unless told otherwise
// — and 「插畫合作｜商品業配」 came out as 「…插畫合作｜商」 / 「品業配…」, a word cut in half. Nobody
// would ship that in Latin script. `word-break:keep-all` confines breaks to spaces, and a tagline
// written as 「A · B · C」 already puts its spaces exactly where the meaning divides.
console.log('\nCLAIM 2c — the tagline breaks at its separators, not mid-word');
async function taglineLines(handle, pinOld) {
  const ctx = await browser.newContext({ viewport: VIEWS[0], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  if (pinOld) {
    await page.addStyleTag({ content: '.st-card .st-hero-tagline{word-break:normal!important;text-wrap:wrap!important}' });
    await page.waitForTimeout(200);
  }
  const lines = await page.evaluate(() => {
    const el = document.querySelector('.st-hero-tagline');
    const t = el && el.firstChild;
    if (!t || t.nodeType !== 3) return null;
    // Real line boxes: the y of each individual character's own rect.
    const r = document.createRange(); const out = []; let cur = null;
    for (let i = 0; i < t.textContent.length; i++) {
      r.setStart(t, i); r.setEnd(t, i + 1);
      const b = r.getBoundingClientRect();
      if (!b.height) continue;
      const y = Math.round(b.top);
      if (!cur || Math.abs(cur.y - y) > 3) { cur = { y, s: '' }; out.push(cur); }
      cur.s += t.textContent[i];
    }
    return out.map((l) => l.s);
  });
  await ctx.close();
  return lines;
}
// A break is clean when the line it ends does not end mid-word — i.e. it ends on whitespace or a
// separator the author wrote.
const cleanBreaks = (lines) => lines.slice(0, -1).every((l) => /[\s·|｜]$/.test(l));
for (const handle of CARDS) {
  const now = await taglineLines(handle, false);
  if (!now) { console.log(`  ${handle.padEnd(10)} no tagline text node`); continue; }
  const ok = cleanBreaks(now);
  console.log(`  ${handle.padEnd(10)} ${now.length} line(s) ${ok ? '✓' : '🔴 breaks mid-word'}  ${JSON.stringify(now)}`);
  if (!ok) bad++;
  // 🔴 CONTROL, and only where the defect can EXIST. Latin text already breaks at spaces, so
  // break-anywhere and keep-all agree on it — demanding the old rule misbehave on a Latin tagline
  // like "comic creator · registered nurse" is demanding a bug that script cannot have. A control
  // that fires where nothing was ever broken is not rigour, it is noise. CJK is the case.
  const isCjk = /[㐀-鿿぀-ヿ]/.test(now.join(''));
  if (now.length > 1 && isCjk) {
    const then = await taglineLines(handle, true);
    if (then && cleanBreaks(then)) {
      console.log(`     🔴 CONTROL: break-anywhere ALSO broke cleanly here (${JSON.stringify(then)}) — nothing was fixed on this card`);
      bad++;
    } else if (then) {
      console.log(`     control: break-anywhere gave ${JSON.stringify(then)}`);
    }
  }
}

console.log('\nCLAIM 3 — nothing below the header reflows');
for (const handle of CARDS) {
  for (const view of VIEWS) {
    const now = await probe(handle, view, false);
    const then = await probe(handle, view, true);
    const same = now.cells === then.cells;
    console.log(`  ${handle.padEnd(10)} ${String(view.width).padEnd(5)} ${now.cellCount} cells below the header   ${same ? 'unchanged' : '🔴 REFLOWED'}`);
    if (!same) {
      bad++;
      const a = now.cells.split(' '), b = then.cells.split(' ');
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`     cell ${i}: ${b[i]} → ${a[i]}`);
    }
    // ⚠️ REPORTED, NOT GATED — a height change is a wrap as often as it is a reflow, and this probe
    // cannot tell them apart. Printing it keeps the signal; failing on it would make the run depend
    // on the runner's fonts.
    if (now.heights !== then.heights) {
      const ha = now.heights.split(' '), hb = then.heights.split(' ');
      const moved = ha.map((h, i) => (h !== hb[i] ? `${i}:${hb[i]}→${h}` : null)).filter(Boolean);
      console.log(`     ⚠️ heights differ (not gated — could be a wrap): ${moved.join(' ')}`);
    }
  }
}

// 🔴 CONTROL for the narrowed gate. Dropping height from the fingerprint made this check WEAKER,
// and a check that was just made weaker has to show it can still fail. Three perturbations, each
// the shape of a real reflow: a cell changes width, a cell moves along x, a cell disappears. If any
// of them compares EQUAL, the fingerprint has stopped distinguishing arrangement and the "unchanged"
// above means nothing.
{
  const base = (await probe(CARDS[CARDS.length - 1], VIEWS[0], false)).cells;
  const parts = base.split(' ');
  const perturbed = {
    'a cell changes width': parts.map((c, i) => (i === 1 ? c.replace(/:(\d+)@/, (m, w) => `:${+w + 40}@`) : c)).join(' '),
    'a cell moves along x': parts.map((c, i) => (i === 1 ? c.replace(/@(\d+)$/, (m, x) => `@${+x + 40}`) : c)).join(' '),
    'a cell disappears':    parts.filter((_, i) => i !== 1).join(' '),
    '🔴 the control itself':  base,   // MUST compare equal — if this one 'passes', the test above is inverted
  };
  for (const [what, p] of Object.entries(perturbed)) {
    const want = !what.startsWith('🔴');          // the last entry is the negative control: it MUST match
    if ((p === base) !== !want) { console.log(`   🔴 CONTROL: "${what}" — expected ${want ? 'a difference' : 'a match'}, got the other`); bad++; }
  }
  const n = Object.keys(perturbed).filter((k) => !k.startsWith('🔴')).length;
  console.log(`\n   control: the fingerprint separates ${n} kinds of real reflow, and matches an untouched copy`);
}

for (const handle of CARDS) {
  const ctx = await browser.newContext({ viewport: VIEWS[0], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  fs.writeFileSync(join(OUT, `header-${handle}.png`), await page.screenshot({ fullPage: true }));
  await ctx.close();
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : `\n✅ centred, near the surveyed ${SURVEYED}, and the grid below is untouched`);
process.exitCode = bad ? 1 : 0;
