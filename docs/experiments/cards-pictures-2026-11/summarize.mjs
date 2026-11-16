// tile#339 measurement — runs.json → markdown tables: median and spread (min–max) of each number,
// per page × visit × strategy.   node summarize.mjs <runs.json> > summary.md
import fs from 'node:fs';

const { conditions, runs } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ok = runs.filter((r) => !r.error);
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const range = (xs) => { const s = xs.filter((x) => x != null); return s.length ? [Math.min(...s), Math.max(...s)] : null; };
const ms = (x) => (x == null ? '—' : x >= 10000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)}`);
const kb = (x) => (x == null ? '—' : x >= 1e6 ? `${(x / 1e6).toFixed(2)} MB` : `${Math.round(x / 1000)} kB`);
const cell = (xs, f) => { const m = med(xs), r = range(xs); return m == null ? '—' : `${f(m)} <sub>${f(r[0])}–${f(r[1])}</sub>`; };
const STRATS = [...new Set(runs.map((r) => r.strategy))];
const ORDER = ['inline', 'url', 'hybrid-inline-lazy', 'hybrid-inline-after-paint', 'hybrid-preload-lazy', 'hybrid-preload-after-paint'];
STRATS.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

const out = [];
out.push(`Chromium ${conditions.chromium}; CPU ×${conditions.CPU_RATE}; network ${conditions.NETWORK.downloadThroughput * 8 / 1e6} Mbit/s down, ${conditions.NETWORK.uploadThroughput * 8 / 1e6} up, +${conditions.NETWORK.latency} ms per request; ${conditions.DEVICE.viewport.width}×${conditions.DEVICE.viewport.height} @${conditions.DEVICE.deviceScaleFactor}x; repeat visit ${conditions.repeatAfterS} s after the cold one. ${ok.length} runs (${runs.length - ok.length} errors). Host load (1-min avg) during runs: ${range(ok.map((r) => r.load1)).map((x) => x.toFixed(1)).join('–')}.`);
out.push('', 'Times in ms from navigation start: median <sub>min–max</sub> of the repetitions. "first screen" = first contentful paint and every picture on screen painted; "DOM parsed" = DOMContentLoaded, the earliest the deck (stack and list views) can deal its pile; "all pictures" = the last picture loaded, with the visitor scrolling a viewport every 0.7 s from the first screen on; "blank" = pictures that were on screen before they had loaded (count, total ms).');
for (const handle of [...new Set(runs.map((r) => r.handle))]) {
  for (const visit of ['cold', 'repeat']) {
    out.push('', `### ${handle} — ${visit}`, '');
    out.push('| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of STRATS) {
      const rs = ok.filter((r) => r.handle === handle && r.visit === visit && r.strategy === s);
      if (!rs.length) continue;
      const col = (k, f = ms) => cell(rs.map((r) => r[k]), f);
      out.push(`| ${s} | ${rs.length}${rs.some((r) => r.timedOut) ? ' ⚠cap' : ''} | ${col('fcp')} | ${col('firstScreen')} | ${col('dcl')} | ${col('lcp')} | ${col('allPictures')} | ${cell(rs.map((r) => r.cls), (x) => x.toFixed(3))} | ${med(rs.map((r) => r.blankSeen))} / ${ms(med(rs.map((r) => r.blankMs)))} | ${med(rs.map((r) => r.requests))} | ${col('bytes', kb)} | ${med(rs.map((r) => r.fromCache))} |`);
    }
  }
}
console.log(out.join('\n'));
