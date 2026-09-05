// No card wears another creator's brand colour.
//
// chodaict, looking at a creator's live card: 「qr 裡沒有完全照 accent 顏色,其中幾個混到紫色(顯然是
// 另一位創作者的殘留)」. He was right, and it was bigger than the QR. `#b890e8` is ANOTHER creator's
// accent — the card it was tuned on — and it was
// baked as a bare literal into two places that run on EVERY card:
//
//   · the QR coral — six `cl.style.background='#b890e8'` in the cell-painting paths of modes I and K
//   · card.css — the avatar's hover ring, focus outline, and BOTH stops of `cpRerollHint`, the pulse
//     that plays three times on load without the visitor touching anything
//
// Neither is a data leak. On a multi-tenant platform it is still one creator's identity turning up
// on another creator's page, which is its own kind of wrong — and the pulse made it the first thing
// the page did.
//
// 🔴 This measures COMPUTED STYLE, not source text. A grep proves the literal left the files; it
// cannot prove the pixels changed, and those are two different claims. Here the browser resolves
// `var(--cp-accent)` against each card's own token and we read what it actually painted.
//
// 🔴 CONTROL: the same probe, run against the PREVIOUS artifacts (HEAD's qr.js and HEAD's card.css,
// served in place), must FAIL — loudly, on the same cards. Without that, "no purple found" and "the
// probe never looked at a painted cell" are the same output. This is the before-column that a
// before/after has to have, and it is a real one: the bytes that were live an hour ago.
//
//   node packages/cardtile/verify/tenant-colour.mjs
import http from 'node:http';
import { execSync } from 'node:child_process';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { CSS, QR_JS } from '../serve/card-assets.mjs';

// 🔴 Cards WITH AN AVATAR. Every probe here goes through `.st-hero .cp-icon` — the hover ring, the
// focus outline, and the QR itself, which OPENS by clicking the avatar. Since 2026-08-12 a profile
// with no `avatar=` emits no such element, so a card without one cannot be probed at all; before
// this filter it crashed on getComputedStyle(null) and then hung 30s on a click into nothing.
//
// 🔴 Not a loss for the isolation claim: that claim needs TWO NAMED tenants (see
// n-equals-one-multi-tenant-is-unverified) and two specimens still carry avatars. The assertion
// below keeps it honest if that ever stops being true.
const ALL_SPECIMENS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const CARDS = ALL_SPECIMENS.filter((h) => /%% card: profile[^%]*\bavatar=/.test(readCard(h)));
if (CARDS.length < 2) {
  throw new Error(`cross-tenant colour needs at least TWO cards with avatars to compare; ${CARDS.length} available`);
}
// The colour this gate hunts: ONE creator's accent, which used to be baked in where every card
// resolves its own. It is also what the control injects — the leak and the counterexample are
// the same literal, which is the only way the two halves can be talking about one thing.
//
// 🔴 The VALUE is the measurement and must not move; only the label was de-identified (it used to
// carry the creator's name). A rename that also "tidied" the number would have left this gate
// hunting a colour that leaked from nowhere — still green, and about nothing.
const LEAKED_ACCENT = [184, 144, 232];        // #b890e8
const REPO = new URL('../../..', import.meta.url).pathname;

// 🩸 THE CONTROL USED TO READ `git show HEAD:…`, AND THAT HAS A SHELF LIFE OF ONE COMMIT. The
// moment the fix lands, HEAD IS the fixed version, so the "previous bytes" are the current bytes
// and the control can never reproduce the bug again. Measured 2026-08-12: all four control checks
// failed with "the bug was not reproduced" — not because the probe went blind, but because there
// was nothing left in HEAD to reproduce.
//
// So the defect is SYNTHESISED instead of fetched. The historical bug was one literal — a
// creator's accent baked in where `var(--cp-accent)` belongs — and injecting it into the CURRENT
// artifacts reproduces it exactly, deterministically, and for as long as this file exists. A
// control that depends on git history is a control that expires; one that manufactures its own
// counterexample does not.
const LEAK = '#b890e8';                       // the literal the fix removed; the control puts it back
const OLD_CSS = (() => {
  const s = String(CSS).replace(/^\/\*[\s\S]*?\*\/\s*/, '');
  // Put the literal back exactly where it used to sit: the avatar's ring and outline, which are
  // painted on EVERY card regardless of whose accent it carries. That is what made it a leak.
  const out = s.replace(/var\(--cp-accent[^)]*\)/g, LEAK);
  if (out === s) throw new Error('the control injected nothing — card.css no longer resolves its accent through var(--cp-accent), so this counterexample is stale');
  return out;
})();
const OLD_QR = (() => {
  const s = String(QR_JS);
  // The QR coral painted its cells from the same literal. Re-inject wherever it now asks the card.
  const out = s.replace(/var\(--cp-accent[^)]*\)/g, LEAK).replace(/getPropertyValue\(['"]--cp-accent['"]\)/g, `'${LEAK}'`);
  if (out === s) throw new Error('the control injected nothing into the QR coral — its accent plumbing changed, so this counterexample is stale');
  return out;
})();

let PIN_OLD = false;
const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  let body = Buffer.from(await r.arrayBuffer());
  if (PIN_OLD) {
    // Serve the previous bytes at the current paths: the page asks for qr-0.11.1.js and gets 0.11.0,
    // which is the point — the URL is not the thing under test, the code behind it is.
    if (/^\/_coral\/qr-/.test(req.url)) body = Buffer.from(OLD_QR);
    else if (r.headers.get('content-type')?.startsWith('text/html')) {
      const html = body.toString();
      if (!html.includes(CSS)) throw new Error('the bundled stylesheet is not in the page — the control would swap nothing');
      body = Buffer.from(html.replace(CSS, OLD_CSS));
    }
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(body);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();

/**
 * Every colour in a computed-style string, whatever notation the engine chose.
 *
 * 🔴 Chrome serialises a `color-mix()` result as `color(srgb 0.019 0.337 1 / 0.16)` — FLOATS, and no
 * `rgb(` anywhere. The first version of this only matched `rgba?(`, so it read three chrome probes,
 * found zero parseable colours in two of them, and reported "0 purple" — a pass that meant "I could
 * not see". It took a diagnostic dump to notice, because a probe that sees nothing and a probe that
 * sees nothing wrong print the same number.
 */
const triples = (s) => {
  const out = [];
  for (const m of String(s).matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) out.push([+m[1], +m[2], +m[3]]);
  for (const m of String(s).matchAll(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)) {
    out.push([1, 2, 3].map((i) => Math.round(+m[i] * 255)));
  }
  for (const m of String(s).matchAll(/#([0-9a-f]{6})\b/gi)) {
    out.push([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
  }
  return out;
};
const isLeakedAccent = (t) => Math.abs(t[0] - LEAKED_ACCENT[0]) + Math.abs(t[1] - LEAKED_ACCENT[1]) + Math.abs(t[2] - LEAKED_ACCENT[2]) <= 6;

/**
 * Open the QR and sample what is painted. `_qrReroll` is how a visitor changes mode, and the modes
 * carrying the literal (I and K) are 2 of 11 picked at random — so this rerolls until every mode has
 * had a turn rather than hoping. The mode name is read from the coral's own state, not inferred.
 */
async function sample(handle) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--cp-accent').trim());

  // ── the avatar's own chrome, which runs whether or not the QR is ever opened ──────────────────
  //
  // 🔴 Three of the four accent literals in card.css turned out to be OUTRANKED — measured, after I
  // had already written prose saying the reroll pulse "plays three times on load". It does not:
  // `animation-name` computes to `none`, and the hover ring resolves from the later
  // `.st-card .st-hero .cp-icon:hover` rule, which already used var(--cp-accent). Rules that were
  // written and never once in effect. Re-tokening them was housekeeping, not a visible fix; the
  // visible fix is the QR coral above.
  //
  // What the measurement DID find is a different colour in the same family: the focus ring on every
  // card resolved to #7fdbca — `--carrier-accent`, REEF's platform teal — on a page that carries no
  // REEF chrome at all. Neither the creator's own nor the one it leaked from. That is the claim below.
  const chrome = { hits: [], seen: 0, focus: null, hover: null, anim: null };
  const probeChrome = async (label, fn) => {
    const v = await fn();
    for (const t of triples(v)) { chrome.seen++; if (isLeakedAccent(t)) chrome.hits.push(`${label}: ${v}`); }
    return v;
  };
  // 🔴 The chrome probes below all hang off the avatar, and since 2026-08-12 a profile with no
  // `avatar=` correctly emits no `.cp-icon` at all. Skipping them is not a coverage loss for the
  // isolation claim — that claim needs TWO NAMED tenants and two specimens still have avatars —
  // but a card without one must not crash the run, and must not be silently counted as "clean"
  // either. It is reported as not-probed, which is a third state and the honest one.
  // Fail in one sentence rather than in a 30-second click timeout.
  const hasIcon = await page.evaluate(() => !!document.querySelector('.st-hero .cp-icon'));
  if (!hasIcon) throw new Error(`${handle} renders no .st-hero .cp-icon — every probe in this harness goes through the avatar`);
  {
  chrome.anim = await page.evaluate(() => getComputedStyle(document.querySelector('.st-hero .cp-icon')).animationName);
  await page.hover('.st-hero .cp-icon');
  await page.waitForTimeout(350);
  chrome.hover = await probeChrome('hover ring', () => page.evaluate(() => getComputedStyle(document.querySelector('.st-hero .cp-icon')).boxShadow));
  chrome.focus = await probeChrome('focus outline', () => page.evaluate(() => {
    const el = document.querySelector('.st-hero .cp-icon');
    el.focus();
    return getComputedStyle(el).outlineColor;
  }));
  }

  // ── the QR's painted cells, across every mode ────────────────────────────────────────────────
  await page.click('.st-hero .cp-icon');
  await page.waitForTimeout(1400);
  const cells = { hits: [], seen: 0, modes: new Set() };
  for (let i = 0; i < 60 && cells.modes.size < 11; i++) {
    const r = await page.evaluate(() => {
      const grid = document.querySelector('.qr-grid');
      if (!grid) return null;
      // read the resolved paint of every cell that is not fully transparent
      const out = [];
      for (const cl of grid.children) {
        const bg = getComputedStyle(cl).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') out.push(bg);
      }
      return out;
    });
    if (r === null) { await ctx.close(); return { accent, opened: false }; }
    for (const bg of r) { cells.seen++; if (triples(bg).some(isLeakedAccent)) cells.hits.push(bg); }
    const mode = await page.evaluate(() => {
      if (window._qrReroll) window._qrReroll();
      return window.__qrMode || null;
    });
    cells.modes.add(mode || 'reroll-' + i);
    await page.waitForTimeout(220);
  }
  await ctx.close();
  return { accent, opened: true, chrome, cells };
}

const uniq = (a) => [...new Set(a)];
const near = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 8;
const TEAL = [127, 219, 202];                 // #7fdbca — --carrier-accent, REEF's platform chrome
let bad = 0;

const run = async (label) => {
  console.log(`\n${label}`);
  console.log('card         accent      cells   purple cells   focus ring');
  const rows = [];
  for (const handle of CARDS) {
    const r = await sample(handle);
    if (!r.opened) { console.log(`${handle}: 🔴 the QR never opened — nothing was sampled`); bad++; continue; }
    const own = isLeakedAccent(triples(r.accent)[0] || [0, 0, 0]);
    console.log(`${handle.padEnd(12)} ${r.accent.padEnd(11)} ${String(r.cells.seen).padEnd(7)} `
      + `${String(r.cells.hits.length).padEnd(14)} ${r.chrome.focus}`);
    if (r.cells.seen === 0) { console.log('   🔴 zero cells sampled — this row is not evidence of anything'); bad++; }
    if (!triples(r.chrome.focus).length) { console.log('   🔴 the focus ring parsed to no colour — the probe is not reading it'); bad++; }
    uniq(r.chrome.hits).forEach((h) => console.log(`   ↳ ${h}`));
    rows.push({ handle, own, ...r });
  }
  return rows;
};

const now = await run('AFTER — the shipped coral and stylesheet');
for (const r of now) {
  const accent = triples(r.accent)[0];
  // CLAIM 1 — the QR paints the host's accent. The card `#b890e8` belongs to is ALLOWED to be purple.
  if (r.own) {
    if (r.cells.hits.length === 0) { console.log(`🔴 ${r.handle}: its OWN accent never appeared in the QR — the probe is not reading painted cells`); bad++; }
  } else if (r.cells.hits.length) {
    console.log(`🔴 ${r.handle}: ${r.cells.hits.length} QR cells painted in another creator's accent`); bad++;
  }
  // CLAIM 2 — the focus ring is the card's own colour, not the platform's teal.
  if (!near(triples(r.chrome.focus)[0], accent)) {
    console.log(`🔴 ${r.handle}: the focus ring is ${r.chrome.focus}, not the card's ${r.accent}`); bad++;
  }
  // and the thing measurement corrected: these two were never in effect, so say so out loud rather
  // than let a future reader assume the re-tokening fixed something visible.
  if (r.chrome.anim !== 'none') {
    console.log(`   ℹ ${r.handle}: cpRerollHint is live after all (${r.chrome.anim}) — the note in this file is now wrong`);
  }
}

// 🔴 THE CONTROL. Same probe, the bytes that were live before this change.
//
// It must find purple QR cells on the two cards that do not own that purple, and a teal focus ring on
// ALL THREE. Both halves matter: without the first, the clean run above could mean the probe never
// looked at a cell; without the second, the focus-ring claim could be passing on a page where the
// ring was already the accent and nothing was fixed.
PIN_OLD = true;
const then = await run("CONTROL — HEAD's qr.js and card.css, served in place");
for (const r of then) {
  if (!r.own && !r.cells.hits.length) {
    console.log(`🔴 CONTROL: ${r.handle} showed no purple cells on the OLD coral — the bug was not reproduced, so the clean run proves nothing`);
    bad++;
  }
  // 🔴 What this half proves is that the probe can TELL — that a focus ring which is not the card's
  // own accent is visible to it. It used to assert the specific historical value (REEF's platform
  // teal, the literal the fix removed from that rule), which only worked while the control replayed
  // git history. The control synthesises its counterexample now, so the claim is stated directly:
  // under the injected defect the ring must NOT be the card's accent. A probe that cannot see that
  // difference cannot be trusted when it reports the clean run above.
  const ownAccent = triples(r.accent || '')[0];
  const ringIsOwn = ownAccent && near(triples(r.chrome.focus)[0], ownAccent);
  if (ringIsOwn) {
    console.log(`🔴 CONTROL: ${r.handle}'s focus ring under the injected defect was still its own accent (${r.chrome.focus}) — the probe cannot see a foreign ring, so the clean run above proves nothing`);
    bad++;
  }
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : "\n✅ every card paints its own accent — and the control proves the probe can see one that is not its own");
process.exitCode = bad ? 1 : 0;
