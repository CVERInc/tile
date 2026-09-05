// A card's three exits, and the header that keeps the edge from mixing them up.
//
//   /<handle>.md · /index.md   → the WHOLE file, assets included   (a person clicking download)
//   Accept: text/markdown      → the THIN card, assets stripped    (an agent reading a card)
//   anything else              → HTML                              (people)
//
// 🔴 The claim that needs a real edge is `Vary: Accept`. One URL now answers with two bodies and the
// edge caches for 60s; without Vary the first response wins for everyone, at random, for a minute.
// That failure is INVISIBLE locally — there is no cache in front of a local server — so the second
// half of this file runs against the deployed Worker.
//
//   node packages/cardtile/verify/negotiation.mjs                    # structure, local
//   node packages/cardtile/verify/negotiation.mjs https://host       # + the live crossover
//   node packages/cardtile/verify/negotiation.mjs https://host --expect-crossover
//        ^ THE CONTROL: point it at a deployment with Vary removed. It must FAIL to find isolation.
import { readCard } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { parseCard, serializeCard } from '../card-core.js';

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const LIVE = process.argv.find((a) => a.startsWith('http'));
const EXPECT_CROSSOVER = process.argv.includes('--expect-crossover');
const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const env = { CARDS: store, PREVIEW: 'false' };

let bad = 0;
const fail = (m) => { console.log(`   🔴 ${m}`); bad++; };

const hit = async (url, accept) => {
  const r = await worker.fetch(new Request(url, accept ? { headers: { accept } } : {}), env);
  return { r, body: await r.text() };
};

// ── 1. the three exits ──────────────────────────────────────────────────────────────────────────
console.log('1. THE THREE EXITS (local)\n');
console.log('card         exit   status  content-type      Vary     bytes      tokens');
for (const handle of CARDS) {
  const file = readCard(handle);
  const thinExpected = serializeCard({ ...parseCard(file), assets: {} });
  const rows = [
    ['html', await hit(`https://card.feelreef.com/${handle}`)],
    ['thin', await hit(`https://card.feelreef.com/${handle}`, 'text/markdown')],
    ['fat ', await hit(`https://card.feelreef.com/${handle}.md`)],
  ];
  for (const [name, { r, body }] of rows) {
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    console.log(`${handle.padEnd(12)} ${name}   ${r.status}     ${ct.padEnd(17)} ${String(r.headers.get('vary')).padEnd(8)} `
      + `${String(body.length).padStart(9)}  ${r.headers.get('x-markdown-tokens') || '—'}`);
    // 🔴 EVERY exit carries Vary, including HTML. Putting it only on the markdown response is the
    // version that looks right and still breaks: HTML is what gets cached first, because that is
    // what people request.
    if (r.headers.get('vary') !== 'Accept') fail(`${handle} ${name}: no Vary: Accept`);
  }
  const [, htmlRow] = rows[0]; const [, thinRow] = rows[1]; const [, fatRow] = rows[2];
  if (!htmlRow.body.startsWith('<!doctype html')) fail(`${handle}: the default exit is not HTML`);
  if (thinRow.body !== thinExpected) fail(`${handle}: the thin body is not card-core's assetless serialization`);
  if (fatRow.body !== file) fail(`${handle}: the fat exit is not the stored file, byte for byte`);
  if (/^- \[ \] %% card: asset/m.test(thinRow.body)) fail(`${handle}: an asset line survived into the thin card`);
  // the download link must be reachable FROM the thin card, or the complete file is only findable
  // by someone who already knows the convention
  if (!/rel="alternate"/.test(rows[1][1].r.headers.get('link') || '')) fail(`${handle}: thin carries no Link to the full file`);
}

// 🔴 CONTROL for the exits: the thin and fat bodies must actually DIFFER on a card that has assets,
// or every assertion above passes on a pair of identical strings.
{
  const file = readCard('specimen-rich');
  const thin = serializeCard({ ...parseCard(file), assets: {} });
  const ratio = (1 - thin.length / file.length) * 100;
  console.log(`\nCONTROL      thin is ${ratio.toFixed(1)}% smaller than fat on specimen-rich (${thin.length} vs ${file.length})`);
  if (ratio < 50) fail('CONTROL: thin and fat are nearly the same size — the exits are not distinguishable, so the checks above compare a string with itself');
  // …and a card with NO assets must give the same bytes both ways, which is the other half of "the
  // difference is the assets and nothing else"
  const noAssets = readCard('specimen-plain');
  if (serializeCard({ ...parseCard(noAssets), assets: {} }) !== noAssets) {
    fail('CONTROL: a card with no assets changed when its (empty) asset lane was stripped — the strip is doing more than it claims');
  }
}

// 🔴 explicit beats negotiation: a `.md` URL is a person clicking download. It must give the whole
// file no matter what the browser puts in Accept.
{
  const { body } = await hit('https://card.feelreef.com/specimen-rich.md', 'text/markdown');
  if (body !== readCard('specimen-rich')) fail('a .md URL with Accept: text/markdown gave the thin card — the download link is lossy');
}

// ── 2. the crossover, in a cache that actually exists ───────────────────────────────────────────
//
// 🔴 MEASURED FIRST, then designed around: `cf-cache-status: DYNAMIC` on a creator's own apex —
// **Cloudflare's edge is not caching these responses at all** (it does not cache HTML by default).
// So the crossover cannot be reproduced there, and a "live edge" test would have been a test that
// can never fail. My first control DID fire, for the wrong reason: it ran five seconds after a
// deploy, hit the un-propagated previous version which had no markdown exit at all, and reported
// two crossovers. A control that fires on the wrong cause is worth less than none, because it
// certifies the probe.
//
// The cache that does exist, and where `Cache-Control: public, max-age=60` is honoured, is the
// BROWSER's. So the probe is a browser: fetch the same URL twice, different Accept, inside the
// window. With Vary the two are separate variants; without it the second gets the first's body.
if (!LIVE) {
  console.log('\n(no live host given — the Vary claim is UNTESTED here. Pass a URL.)');
} else {
  console.log(`\n2. THE CROSSOVER, IN A REAL BROWSER CACHE — ${LIVE}\n`);
  const { PLAYWRIGHT } = await import('./paths.mjs');
  const pw = (await import(PLAYWRIGHT)).default;
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(LIVE, { waitUntil: 'domcontentloaded' });

  // 🔴 Prove the exit EXISTS before testing whether the cache confuses it. Skipping this is exactly
  // how the first control passed on "there is no markdown exit" instead of "Vary is missing".
  const cold = await page.evaluate(async (u) => {
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'cold=' + performance.now(),
      { headers: { accept: 'text/markdown' }, cache: 'no-store' });
    return { ct: r.headers.get('content-type') || '' };
  }, LIVE);
  const negotiates = /markdown/.test(cold.ct);
  console.log(`   cold request with Accept: text/markdown → ${cold.ct}`);
  if (!negotiates) {
    fail('this deployment has no markdown exit at all — nothing below is a test of Vary');
  }

  // 🔴 IS THIS OUR FILE, OR A RECONSTRUCTION OF OUR PAGE?
  //
  // Cloudflare's `content_converter` (per-zone: PATCH /zones/{id}/settings/content_converter) turns
  // `Accept: text/markdown` into "fetch the HTML from origin and convert it". For a Card that is
  // backwards — the markdown is the ORIGINAL — so if it ever switches on we would serve a lossy
  // round-trip of a file we could hand over, and it would look plausible.
  //
  // Measured: off on all three zones we own. But a creator's own apex is NOT in our account — it is the
  // creator's zone, arriving through Cloudflare for SaaS, and Cloudflare's own documentation does
  // NOT say whose setting applies in that arrangement. So instead of an assumption, an invariant
  // that holds whoever flipped it: what comes back must be A CARD, not prose about a card. A
  // converter's output cannot have our frontmatter.
  const shape = await page.evaluate(async (u) => {
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'shape=' + Math.trunc(performance.now()),
      { headers: { accept: 'text/markdown' }, cache: 'no-store' });
    const t = await r.text();
    return { head: t.slice(0, 24), isCard: /^---\r?\ncard-page:/.test(t) };
  }, LIVE);
  console.log(`   the markdown is our own file: ${shape.isCard ? 'yes' : 'NO'}  (starts ${JSON.stringify(shape.head)})`);
  if (negotiates && !shape.isCard) {
    fail('the markdown exit is not returning a card — something is CONVERTING our HTML instead of serving the source');
  }

  let crossovers = 0;
  if (negotiates) {
    for (const order of [['html', 'md'], ['md', 'html']]) {
      const res = await page.evaluate(async ([u, ord]) => {
        const url = u + (u.includes('?') ? '&' : '?') + 'probe=' + ord.join('') + '-' + Math.trunc(performance.now());
        const out = [];
        for (const want of ord) {
          const r = await fetch(url, { headers: { accept: want === 'md' ? 'text/markdown' : 'text/html' } });
          out.push({ want, ct: (r.headers.get('content-type') || '').split(';')[0], n: (await r.text()).length });
        }
        return out;
      }, [LIVE, order]);
      console.log(`   order ${order.join(' → ')}`);
      for (const g of res) {
        const expect = g.want === 'md' ? 'text/markdown' : 'text/html';
        const ok = g.ct === expect;
        console.log(`     asked ${g.want.padEnd(4)} → ${g.ct.padEnd(14)} ${String(g.n).padStart(8)} bytes${ok ? '' : '   ← CROSSOVER'}`);
        if (!ok) crossovers++;
      }
    }
  }
  await browser.close();

  if (EXPECT_CROSSOVER) {
    console.log(`\n   CONTROL MODE: expected a crossover, saw ${crossovers}`);
    if (!negotiates) fail('CONTROL: the deployment under test does not negotiate — this proves nothing about Vary');
    else if (crossovers === 0) fail('CONTROL: no crossover on a deployment with Vary REMOVED — this probe cannot detect the bug it exists for');
  } else if (crossovers) {
    fail(`${crossovers} crossover(s): a cache served one Accept's body to the other`);
  }
}

console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ three exits, and the edge keeps them apart');
process.exitCode = bad ? 1 : 0;
