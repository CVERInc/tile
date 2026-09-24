// The porch tokens (w2/porch-tokens.css) are a MIRROR of reef's feelreef app.css — tile never imports
// reef code. Two checks, of two different strengths:
//
//   1. HARD: the values that carry the look are pinned to an inline table copied from reef
//      (2026-09-24). A drift in THIS repo goes red with both values side by side.
//   2. SOFT: if the reef checkout is on this machine, every mirrored `--carrier-*` / `--console-*` /
//      `--btn-*` literal is diffed against reef's live app.css and any difference is PRINTED, not
//      failed — reef moving is news, not our breakage (and CI has no reef checkout).
//
// "Dark counterparts": reef has NONE for the porch — app.css 「There is no second skin」, one look,
// enforced by reef's own one-look.test.ts. So the dark half of this test asserts the mirror did not
// invent one: no `prefers-color-scheme` block, and `color-scheme: light`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(join(DIR, 'porch-tokens.css'), 'utf8');
const REEF_APP_CSS = '/Users/chodaict/Developer/reef/apps/feelreef/src/app.css';

/** `--name: value;` pairs from every `:root {…}` (and Tailwind `@theme {…}`) block, comments stripped. FIRST declaration wins,
 *  so a later override (reef's prefers-contrast block, say) never masks the base value. */
function rootTokens(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const hit of bare.matchAll(/(?:@theme|:root)\s*\{/g)) {
    const i = hit.index + hit[0].length - 1;
    let depth = 0, end = i;
    for (; end < bare.length; end++) {
      if (bare[end] === '{') depth++;
      else if (bare[end] === '}' && --depth === 0) break;
    }
    for (const m of bare.slice(i + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (!(m[1] in out)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

// copied from reef/apps/feelreef/src/app.css, 2026-09-24
const REEF_LIGHT = {
  '--carrier-accent': '#0f7c89',
  '--carrier-accent-ink': '#ffffff',
  '--carrier-text': '#0c3a44',
  '--carrier-text-muted': '#557077',
  '--carrier-bg-solid': '#f4f6f6',
  '--carrier-heading': '#0c3a44',
  '--carrier-outline-border': '#0f7c89',
  '--console-radius': '18px',
  '--console-radius-sm': '12px',
};

test('porch tokens: the look-carrying light values match reef', () => {
  const mine = rootTokens(CSS);
  const drift = Object.entries(REEF_LIGHT)
    .filter(([k, v]) => (mine[k] || '').toLowerCase() !== v)
    .map(([k, v]) => `${k}: porch-tokens.css=${mine[k] ?? '(missing)'}  reef=${v}`);
  assert.deepEqual(drift, [], 'porch tokens drifted from reef:\n' + drift.join('\n'));
});

test('porch tokens: dark scheme is the SAME look (reef ships one skin — no invented dark copy)', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/prefers-color-scheme/.test(bare), false, 'reef has no dark porch skin to mirror; a dark block here would be invented');
  assert.match(bare, /color-scheme:\s*light/);
});

test('porch tokens: soft live diff against the reef checkout (prints, never fails)', (t) => {
  if (!fs.existsSync(REEF_APP_CSS)) { t.skip('no reef checkout on this machine'); return; }
  const reef = rootTokens(fs.readFileSync(REEF_APP_CSS, 'utf8'));
  const mine = rootTokens(CSS);
  const diffs = [];
  for (const [k, v] of Object.entries(mine)) {
    if (!/^--(carrier|console|btn|font)-/.test(k)) continue;
    if (!(k in reef)) { diffs.push(`${k}: not in reef :root`); continue; }
    if (reef[k].toLowerCase() !== v.toLowerCase()) diffs.push(`${k}: porch=${v}  reef=${reef[k]}`);
  }
  for (const d of diffs) t.diagnostic(`porch-tokens.css vs live reef app.css — ${d}`);
  if (diffs.length) return;
  t.diagnostic(`porch-tokens.css matches live reef app.css (${Object.keys(mine).length} tokens checked)`);
});
