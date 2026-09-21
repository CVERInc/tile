#!/usr/bin/env node
// real-render matrix — where a generated site's runtime surfaces actually land in the cascade,
// measured in a real browser on a real build instead of asserted against emitted text.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/matrix.smoke.mjs --tile <checkout> --out <dir>
//        [--arms plain,tokens,custom,tokens-layered,custom-layered]
//        [--states id,id|/regex/] [--viewports desktop,narrow]
//        [--reuse-build] [--no-browser] [--extra] [--deps <checkout>] [--label <ref>]
//
// Pipeline (nothing is written inside --tile):
//   1. copy the checkout's source to <out>/engine (node_modules linked per package, see lib/sites.mjs)
//   2. build real sites per arm with the renderer's own buildSite (theme → @layer reef.theme)
//   3. emit the generated Worker per arm with the checkout's emit-shop-function.mjs
//   4. compose every state through the emitted worker's default.fetch (stubbed binding/fetch,
//      ASSETS = the built site)
//   5. serve composed HTML + built site from 127.0.0.1 and measure computed style in Chromium
//      (desktop 1280 / narrow 375), with screenshots, per-state facts JSON and verdicts
//   6. compare each declared arm against its legacy twin leaf by leaf (the no-regression pass)
//   7. write <out>/summary.json and <out>/summary.md (PASS/FAIL per state × arm × viewport)
//
// 🔴 It is NOT one of the SMOKE_GLOBS entries in scripts/test.sh, and it must not become one.
// Every entry in that list is invoked as `node <smoke> <base URL>` against a static python3
// server; this one takes no base URL — it builds its own sites and serves its own origin per arm —
// so being "covered" by that list would mean being run with an argument it ignores. scripts/test.sh
// names it in its own PLAYWRIGHT-gated block, which is what makes it both counted by the orphan
// guard and actually run.
//
// 🩸 MEASURED PLATFORM LIMITATION, so a later reader does not file it as a finding: headless
// Chromium here renders ELEMENT captures about 158 px wide whatever viewport the context is given.
// Nothing in this harness asserts on image geometry for exactly that reason — every verdict comes
// from the DOM and from getComputedStyle, and the images are full-page captures kept as context
// for a human, not as evidence. Do not add an expectation that reads a screenshot's size.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ARMS, THEME_TOKENS, THEME_SELECTOR_OVERRIDES, HEADING_OVERRIDE, prepareEngine, buildSites, siteLang, themeCss,
  armTheme, armCoralCss, isDeclared, legacyTwin, knownArm } from './lib/sites.mjs';
import { STATES, emitWorker, composeStates, islandFixture } from './lib/states.mjs';
import { startServer, CORAL_ARTIFACT_PATH } from './lib/server.mjs';
import { measure, markFocusTarget, readFocus, cascadeControls, themeOverrideControls, verdicts, modeDelta, modeDeltaVerdict } from './lib/probe.mjs';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const tile = arg('tile'); const outArg = arg('out');
if (!tile || !outArg) { console.error('usage: node matrix.smoke.mjs --tile <checkout> --out <dir> [--arms …] [--states …] [--viewports …] [--reuse-build] [--no-browser] [--extra] [--deps <checkout with installed renderer deps>] [--label <source ref>]'); process.exit(2); }
const TILE = path.resolve(tile); const OUT = path.resolve(outArg);
// --deps: where the renderer's installed node_modules come from (default: --tile). Lets --tile be a
// plain source tree (e.g. `git archive <ref>` of an older commit) that has no install of its own.
const DEPS = path.resolve(arg('deps') || tile);
if (OUT.startsWith(TILE + path.sep) || OUT === TILE) { console.error('refusing: --out must not be inside the tile checkout'); process.exit(2); }
const arms = (arg('arms') || ARMS.join(',')).split(',').filter(Boolean);
const unknown = arms.filter((a) => !knownArm(a));
if (unknown.length) { console.error(`unknown arm(s): ${unknown.join(', ')} — known: ${ARMS.join(', ')}`); process.exit(2); }
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, narrow: { width: 375, height: 812 } };
const vps = (arg('viewports') || 'desktop,narrow').split(',').filter(Boolean);
const stateArg = arg('states');
let states = STATES.filter((s) => flag('extra') || !s.extra || (stateArg && stateArg.split(',').includes(s.id)));
if (stateArg) {
  const m = stateArg.match(/^\/(.*)\/$/);
  states = m ? states.filter((s) => new RegExp(m[1]).test(s.id)) : STATES.filter((s) => stateArg.split(',').includes(s.id));
}
const log = (...a) => console.log(...a);
mkdirSync(OUT, { recursive: true });

const git = (...a) => { try { return execFileSync('git', ['-C', TILE, ...a], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const run = { tile: TILE, deps: DEPS, head: arg('label') || git('rev-parse', 'HEAD'), dirty: arg('label') ? null : git('status', '--porcelain') !== '', startedAt: new Date().toISOString(), arms, viewports: vps, states: states.map((s) => s.id), node: process.version };
log(`▸ tile ${run.head}${run.dirty ? ' (DIRTY)' : ''}; arms=${arms.join(',')} viewports=${vps.join(',')} states=${states.length}`);

// 1–2 build
const engine = path.join(OUT, 'engine');
let built;
const prior = existsSync(path.join(OUT, 'build.json')) ? JSON.parse(readFileSync(path.join(OUT, 'build.json'), 'utf8')) : null;
if (flag('reuse-build') && prior && arms.every((a) => prior[a] && prior[a].themeCss === themeCss(a) && prior[a].coralCss === armCoralCss(a) && existsSync(path.join(OUT, 'sites', a, 'index.html')))) {
  built = prior;
  for (const a of arms) {
    log(`▸ reusing ${a} engine copy + site build (built from tile ${built[a].tileHead})`);
    if (built[a].tileHead !== run.head) log(`  ⚠ checkout HEAD is now ${run.head}; drop --reuse-build to measure it`);
  }
} else {
  // Rebuilds ALL requested arms from one fresh engine copy; other arms' older builds are dropped
  // from build.json so a later --reuse-build cannot mix sources.
  prepareEngine(TILE, OUT, log, DEPS);
  built = await buildSites(engine, OUT, arms, log);
  for (const a of arms) Object.assign(built[a], { tileHead: run.head, tileDirty: run.dirty });
  writeFileSync(path.join(OUT, 'build.json'), JSON.stringify(built, null, 2));
}
run.build = built;

// 3–4 emit + compose
const composed = {};
for (const arm of arms) {
  const worker = emitWorker(engine, OUT, arm);
  composed[arm] = await composeStates(worker, path.join(OUT, 'sites', arm), arm, states, path.join(OUT, 'composed', arm));
}
if (flag('no-browser')) { writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2)); log('▸ --no-browser: composed only'); process.exit(0); }

// 5 browser
// This repo ships no Playwright and should not (a browser is 300 MB and nothing else here needs
// one). Point PLAYWRIGHT at whichever install you already have — the same input the other browser
// smokes take, resolved the same way. `?? .default` because playwright is CommonJS: importing the
// package by NAME gets you named exports, importing its index.js by PATH gets you `{ default: … }`.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const coralArtifact = path.join(engine, 'packages/dynamic-corals/square-shop/square-shop.js');
const browser = await chromium.launch();
const results = [];
// arm → viewport → state → facts, for the no-regression pass in step 6.
const factsByArm = {};
try {
  for (const arm of arms) {
    const theme = armTheme(arm);
    const declared = isDeclared(arm);
    factsByArm[arm] = {};
    const { server, origin } = await startServer({ dist: path.join(OUT, 'sites', arm), composedDir: path.join(OUT, 'composed', arm), composed: composed[arm], coralArtifact });
    try {
      for (const vp of vps) {
        factsByArm[arm][vp] = {};
        const context = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 1 });
        for (const st of states) {
          const page = await context.newPage();
          const spec = JSON.parse(JSON.stringify(st, (k, v) => (typeof v === 'function' ? undefined : v)));
          const consoleErrors = [];
          page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
          const url = origin + st.path + (st.path.includes('?') ? '&' : '?') + `__state=${st.id}`;
          const record = { arm, theme, declared, viewport: vp, state: st.id, family: st.family, url: st.path, workerStatus: composed[arm][st.id].status };
          try {
            await page.goto(url, { waitUntil: 'load' });
            await page.evaluate(() => document.fonts && document.fonts.ready);
            const c = st.client || {};
            // The published coral artifact, loaded the way a site loads it: over HTTP, as a module,
            // after the document is there. Its self-mount tail runs immediately on a document that
            // has already finished loading, so nothing else has to be triggered.
            if (c.mountCoral) await page.addScriptTag({ url: CORAL_ARTIFACT_PATH, type: 'module' });
            if (c.wait === 'client-grid') await page.waitForSelector('[data-dynamic-coral="square-shop"] .dc-square-shop-card', { timeout: 8000 });
            if (c.wait === 'paid') await page.waitForSelector('#dc-shop-outcome .dc-shop-total', { timeout: 8000 });
            if (c.wait === 'back') await page.waitForSelector('#dc-shop-outcome a', { timeout: 8000 });
            if (c.wait === 'outcome') await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/checkout/outcome')), null, { timeout: 8000 });
            if (c.fixture) await page.evaluate(islandFixture, c.fixture);
            if (c.conflictClick) {
              await page.click(c.conflictClick);
              await page.waitForFunction(() => { const s = document.querySelector('[data-native-status]'); return s && s.textContent.trim(); }, null, { timeout: 8000 });
            }
            await page.mouse.move(0, 0);
            await page.waitForTimeout(150);
            const shotDir = path.join(OUT, 'shots', arm, vp); mkdirSync(shotDir, { recursive: true });
            await page.screenshot({ path: path.join(shotDir, `${st.id}.png`), fullPage: true });
            const facts = await page.evaluate(measure, spec);
            // keyboard focus walk
            const target = await page.evaluate(markFocusTarget, spec);
            if (target) {
              let f = { onTarget: false }; let method = 'tab';
              for (let i = 0; i < 120 && !f.onTarget; i++) { await page.keyboard.press('Tab'); f = await page.evaluate(readFocus); }
              if (!f.onTarget) { method = 'programmatic-after-keypress'; await page.keyboard.press('Shift'); await page.focus('[data-harness-focus]'); f = await page.evaluate(readFocus); }
              facts.focus = { target, method, ...f };
              await page.screenshot({ path: path.join(shotDir, `${st.id}.focus.png`), fullPage: true });
              await page.evaluate(() => document.activeElement && document.activeElement.blur());
            } else facts.focus = { target: null };
            facts.cascade = await page.evaluate(cascadeControls, spec);
            if (theme === 'custom') facts.themeOverrides = await page.evaluate(themeOverrideControls, { spec, overrides: THEME_SELECTOR_OVERRIDES });
            facts.consoleErrors = consoleErrors;
            const v = verdicts({ spec: st, theme, declared, vp, facts, expectedLang: siteLang(arm), themeTokens: THEME_TOKENS[theme], headingOverride: theme === 'custom' ? HEADING_OVERRIDE : null });
            Object.assign(record, v);
            factsByArm[arm][vp][st.id] = facts;
            const factsDir = path.join(OUT, 'facts', arm, vp); mkdirSync(factsDir, { recursive: true });
            writeFileSync(path.join(factsDir, `${st.id}.json`), JSON.stringify({ ...record, facts }, null, 2));
          } catch (e) {
            Object.assign(record, { overall: 'ERROR', checks: [{ id: 'harness', result: 'ERROR', detail: String(e.message || e).split('\n')[0] }] });
          }
          results.push(record);
          log(`  ${record.overall.padEnd(5)} ${arm}/${vp}/${st.id}${record.overall !== 'PASS' ? ' — ' + record.checks.filter((c) => c.result !== 'PASS' && c.result !== 'NA').map((c) => c.id).join(', ') : ''}`);
          await page.close();
        }
        await context.close();
      }
    } finally { server.close(); }
  }
} finally { await browser.close(); }

// 6 no-regression pass: each declared arm against its legacy twin, leaf by leaf.
// Skipped with a named reason rather than silently when the twin was not in this run — a pair
// comparison that quietly did not happen is the failure mode this whole file is trying to avoid.
for (const arm of arms.filter(isDeclared)) {
  const twin = legacyTwin(arm);
  const haveTwin = twin && arms.includes(twin);
  for (const vp of vps) {
    for (const st of states) {
      const rec = results.find((r) => r.arm === arm && r.viewport === vp && r.state === st.id);
      if (!rec || rec.overall === 'ERROR') continue;
      if (!haveTwin) { rec.checks.push({ id: 'mode-delta', result: 'NA', detail: `legacy twin ${twin || '(none)'} not in --arms; run both to compare` }); continue; }
      const a = (factsByArm[twin][vp] || {})[st.id];
      const b = (factsByArm[arm][vp] || {})[st.id];
      if (!a || !b) { rec.checks.push({ id: 'mode-delta', result: 'NA', detail: 'one side of the pair produced no facts' }); continue; }
      const deltas = modeDelta(a, b);
      const v = modeDeltaVerdict({ coral: !!st.coral, overrides: armTheme(arm) === 'custom', deltas });
      rec.checks.push({ id: `mode-delta(vs ${twin})`, ...v });
      rec.deltas = deltas;
      rec.overall = rec.checks.some((c) => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    }
  }
}

// 7 summary
run.finishedAt = new Date().toISOString();
writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2));
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ run, results }, null, 2));
const cols = arms.flatMap((a) => vps.map((v) => `${a}/${v}`));
let md = `# real-render matrix\n\ntile ${run.head}${run.dirty ? ' (dirty)' : ''} · ${run.finishedAt}\n\n`;
md += `Arms: ${arms.map((a) => `\`${a}\`${isDeclared(a) ? ' (site declares dynamic-coral-css: layered)' : ' (undeclared — legacy unlayered coral CSS)'}`).join(', ')}.\n\n`;
md += `🩸 Headless Chromium on this host renders ELEMENT captures ~158 px wide whatever viewport is\n` +
      `set, so no verdict here reads image geometry. Every result below comes from the DOM and from\n` +
      `getComputedStyle; the PNGs are full-page captures kept as human context, not as evidence.\n\n`;
md += `| state | family | ${cols.join(' | ')} |\n|---|---|${cols.map(() => '---').join('|')}|\n`;
for (const st of states) {
  md += `| ${st.id} | ${st.family} | ${cols.map((c) => { const [a, v] = c.split('/'); const r = results.find((x) => x.arm === a && x.viewport === v && x.state === st.id); if (!r) return '—'; const fails = r.checks.filter((k) => k.result === 'FAIL' || k.result === 'ERROR').map((k) => k.id.replace(/\|/g, '/')); return r.overall === 'PASS' ? 'PASS' : `**${r.overall}**: ${fails.join(', ')}`; }).join(' | ')} |\n`;
}
md += `\n## Failing checks (detail)\n\n`;
for (const r of results) for (const k of r.checks.filter((c) => c.result === 'FAIL' || c.result === 'ERROR')) md += `- ${r.arm}/${r.viewport}/${r.state} · \`${k.id}\` — ${k.detail.replace(/\|/g, '/')}\n`;
md += `\n## Declared vs legacy: every measured value that moved\n\n`;
for (const r of results.filter((x) => x.deltas && x.deltas.length)) {
  md += `- ${r.arm}/${r.viewport}/${r.state}: ` + r.deltas.map((d) => `\`${d.path}\` ${d.legacy} → ${d.declared}`).join('; ') + '\n';
}
if (!results.some((r) => r.deltas && r.deltas.length)) md += `(none — every declared arm measured identically to its legacy twin)\n`;
writeFileSync(path.join(OUT, 'summary.md'), md);
const counts = results.reduce((a, r) => (a[r.overall] = (a[r.overall] || 0) + 1, a), {});
log(`▸ done: ${JSON.stringify(counts)} → ${path.join(OUT, 'summary.md')}`);
// A smoke that cannot fail the suite is a smoke nobody has to keep green.
if (counts.FAIL || counts.ERROR) process.exit(1);
