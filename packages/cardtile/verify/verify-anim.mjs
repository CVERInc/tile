import { readCard, PLAYWRIGHT } from './paths.mjs';
import http from 'node:http';
import fs from 'node:fs';
import worker from '../serve/card-worker.mjs';
const pw = (await import(PLAYWRIGHT)).default;
const { chromium } = pw;
// 🩸 Read specimen-assets and looked for `.st-carousel figure`, which NO specimen produced —
// the bubbles embed had zero specimen coverage, exactly as the drawer coral did. This harness
// measures the pop (scale 0.001 → 1 about the bubble's tail), so it needs a card that HAS one, and
// it says so rather than dying on `samples[0].s[0]` being undefined.
const SPECIMEN = 'specimen-rich';
const cardMd = readCard(SPECIMEN);
if (!/%% card: embed[^%]*kind=bubbles/.test(cardMd)) {
  throw new Error(`${SPECIMEN} carries no \`kind=bubbles\` embed, so there is no pop to measure — add one to cards/gen-specimens.mjs`);
}
const env = { CARDS: { get: async () => cardMd } };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://localhost' + req.url, { headers: req.headers }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(ok => server.listen(0, ok));
const base = 'http://localhost:' + server.address().port;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
await pg.goto(base + '/' + SPECIMEN, { waitUntil: 'networkidle' });

// sample each figure's computed transform + opacity over one full cycle (15s)
const samples = [];
for (const t of [0.5, 2, 4.5, 6, 9, 11, 14]) {
  await pg.evaluate((sec) => {
    document.querySelectorAll('.st-carousel figure').forEach(f => {
      f.getAnimations().forEach(a => { a.pause(); a.currentTime = sec * 1000; });
    });
  }, t);
  const s = await pg.evaluate(() => Array.from(document.querySelectorAll('.st-carousel figure')).map(f => {
    const cs = getComputedStyle(f);
    const m = new DOMMatrix(cs.transform);
    return { scale: +m.a.toFixed(3), opacity: +(+cs.opacity).toFixed(2), origin: cs.transformOrigin };
  }));
  samples.push({ t, s });
}
console.log('=== animation samples (t sec → per-figure scale/opacity) ===');
for (const { t, s } of samples) console.log(`t=${String(t).padStart(4)}s  ` + s.map((f,i)=>`f${i+1}:sc${f.scale} op${f.opacity}`).join('  '));
// 🔴 Say what is missing instead of throwing on `[0]` of an empty list. An animation harness that
// found no figures has measured nothing, and "Cannot read properties of undefined" is not that
// sentence.
if (!samples.length || !samples[0].s.length) {
  throw new Error('no `.st-carousel figure` on the page — the embed did not render, so nothing about the pop was measured');
}
console.log('origin:', samples[0].s[0].origin);
const scales = samples.flatMap(x => x.s.map(f => f.scale));
console.log('scale range:', Math.min(...scales), '→', Math.max(...scales), '(must reach ~0 AND 1 = the pop)');
await b.close(); server.close();
