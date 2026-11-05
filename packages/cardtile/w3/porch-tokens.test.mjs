// The porch tokens (w3/porch-tokens.css) are a MIRROR of reef's feelreef app.css — tile never imports
// reef code. Two checks, of two different strengths:
//
//   1. HARD: the values that carry the look are pinned to an inline table copied from reef
//      (2026-09-24). A drift in THIS repo goes red with both values side by side.
//   2. SOFT: if the reef checkout is on this machine, every mirrored `--carrier-*` / `--console-*` /
//      `--btn-*` literal is diffed against reef's live app.css and any difference is PRINTED, not
//      failed — reef moving is news, not our breakage (and CI has no reef checkout).
//
// "Dark counterparts": reef has NONE for the porch — app.css 「There is no second skin」. The editor's
// shell got its OWN dark theme on 2026-11-05 (owner ruling, review P12: the dark card preview met a
// pale shell at an 18:1 seam). So the dark half of this test no longer asserts "no dark block"; it
// asserts the dark block is the editor's own and keeps its contrast pairs — it can never be read as a
// reef mirror (the soft live diff below compares the FIRST, light, declaration of each token only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(join(DIR, 'porch-tokens.css'), 'utf8');
const REEF_APP_CSS = join(process.env.DEV_ROOT || join(homedir(), 'Developer'), 'reef/apps/feelreef/src/app.css');

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

// WCAG relative luminance / contrast, for the pairs the dark shell must keep
const lum = (hex) => { const n = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function darkTokens(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.indexOf('prefers-color-scheme: dark');
  assert.ok(at > 0, 'the editor shell has a dark block');
  return rootTokens(bare.slice(at));
}

test('porch tokens: the dark shell is the editor\'s own, and every pair keeps its contrast', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /color-scheme:\s*light dark/, 'native controls follow the scheme too');
  const d = darkTokens(CSS);
  const pairs = [
    ['--carrier-text', '--carrier-bg-solid', 4.5], ['--carrier-text-muted', '--carrier-bg-solid', 4.5],
    ['--carrier-heading', '--btn-surface', 4.5], ['--carrier-text-muted', '--btn-surface', 4.5],
    ['--carrier-link', '--btn-surface', 4.5], ['--btn-danger-ink', '--carrier-bg-solid', 4.5],
    ['--carrier-accent-ink', '--carrier-accent', 4.5], ['--notice-ink', '--notice-bg', 4.5], ['--notice-error-ink', '--notice-error-bg', 4.5],
    ['--btn-border', '--carrier-bg-solid', 3], ['--carrier-accent', '--carrier-bg-solid', 3],
  ];
  const weak = pairs.filter(([a, b, min]) => contrast(d[a], d[b]) < min).map(([a, b, min]) => `${a} on ${b}: ${contrast(d[a], d[b]).toFixed(2)} < ${min}`);
  assert.deepEqual(weak, []);
  // the light shell's own additions keep theirs too (the error ink is the danger ink, ≥ 4.5:1 on the panel)
  const l = rootTokens(CSS);
  assert.ok(contrast(l['--btn-danger-ink'], l['--carrier-bg-solid']) >= 4.5);
  assert.ok(contrast(l['--btn-border'], l['--porch-field-bg']) >= 3, 'a field\'s edge is visible');
  assert.ok(contrast(l['--notice-ink'], l['--notice-error-bg']) >= 4.5);
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

// Ruler #6 (2026-09-24): a press answers. Every sheet button the editor's markup ships carries a class
// that the press rule (`:active` → --porch-press) names.
test('every sheet button has the :active press transform', () => {
  const W3 = new URL('.', import.meta.url);
  const css = fs.readFileSync(new URL('porch.css', W3), 'utf8');
  const html = fs.readFileSync(new URL('index.html', W3), 'utf8');
  const press = css.match(/^(.*):active[^{]*\{ transform: var\(--porch-press\)/m);
  assert.ok(press, 'the press rule exists');
  const pressed = new Set([...press[0].matchAll(/\.(ctw-[\w-]+):active/g)].map((m) => m[1]));
  const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1].split(/\s+/)).filter((cls) => cls.some((c) => c.startsWith('ctw-')));
  assert.ok(buttons.length >= 5, 'sanity: the sheets have their buttons');
  for (const cls of buttons) assert.ok(cls.some((c) => pressed.has(c)), `no press on <button class="${cls.join(' ')}">`);
  // control: a button class nobody presses is caught
  assert.ok(!['ctw-unpressed'].some((c) => pressed.has(c)));
});
