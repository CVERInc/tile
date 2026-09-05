// REEF with Events — build-side generator. Fetch iCal source(s), normalize + render (via the
// node-tested core), write a small `events.json` the client widget injects. Runs at deploy time
// (build-time v1): the events are baked; adding a con to the calendar shows on the next deploy.
// A later live-edge variant would move this fetch into the CF worker; the core stays identical.
//
//   usage: node gen-events.mjs --out <dir>/events.json [--ical <url|file> ...] [--show 5] [--locale en-US]
//          (a source may be an http(s) URL or a local .ics path — the latter for tests/offline)
import { readFile, writeFile } from 'node:fs/promises';
import { parseICal } from './ical.mjs';
import { mergeEvents, renderEvents } from './events-core.mjs';

function argVals(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}
function argVal(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

async function loadSource(src) {
  if (/^https?:\/\//i.test(src)) {
    const r = await fetch(src, { headers: { Accept: 'text/calendar,text/plain' } });
    if (!r.ok) throw new Error(`fetch ${src} → ${r.status}`);
    return await r.text();
  }
  return await readFile(src, 'utf8');   // local .ics (tests / offline)
}

export async function generate({ sources = [], show = 5, locale = 'en-US', labels = {}, now = Date.now() }) {
  const perSource = [];
  for (const src of sources) {
    try {
      const label = /^https?:/i.test(src) ? new URL(src).hostname : 'ical';
      perSource.push(parseICal(await loadSource(src), label));
    } catch (e) {
      // one bad source never sinks the rest — log + continue (fail-soft, like the parser)
      console.error(`  ⚠ events source failed: ${src} — ${e.message}`);
    }
  }
  const events = mergeEvents(perSource);
  const html = renderEvents(events, { showCount: show, now, locale, labels });
  return { html, count: events.length, sources: sources.length, generatedAt: new Date(now).toISOString() };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const out = argVal(argv, '--out');
  if (!out) { console.error('need --out <path>/events.json'); process.exit(1); }
  const sources = argVals(argv, '--ical');
  // Baked labels: only `add` (the add-to-calendar link) is rendered at build and not overwritten by
  // the client, so it needs per-locale localization here. countdown/live labels are client-side
  // (data-in-prefix / data-live-label), and the date itself is localized via --locale.
  const labels = {};
  const add = argVal(argv, '--add'); if (add) labels.add = add;
  const payload = await generate({
    sources,
    show: Number(argVal(argv, '--show', '5')) || 5,
    locale: argVal(argv, '--locale', 'en-US'),
    labels,
    now: Date.now(),
  });
  await writeFile(out, JSON.stringify(payload));
  console.log(`✓ events.json → ${out} (${payload.count} event(s) from ${payload.sources} source(s))`);
}
