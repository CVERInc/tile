// tile#372 — the policy of a person's page (serve/cardtile-page-csp.mjs), in a real browser, ENFORCED.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/page-csp.mjs
//   PAGE_CSP_ENGINES=chromium,webkit   which engines (default chromium); one that does not launch is named SKIPPED
//   PAGE_CSP_CHROMIUM=/path/to/chrome    a Chromium binary, when the borrowed Playwright's own revision is not installed
//
// cardtile-page-csp.test.mjs proves the header's TEXT fits the page's markup. This asks the browser what
// that text MEANS: a page holding every tile type, in all three views, is loaded from the real cardtile
// worker with `CARDS_PAGE_CSP=enforce` (and "report-only"), and the browser must report no
// `securitypolicyviolation`, no page error and no console error — in the page and in every frame — while
// the deck comes up, a brand mark's fallback handler runs, a video opens its player, a back opens, the QR
// opens, and a long file's next window is fetched. A page with an embed carries the same policy, and the
// embed's own script runs: the embed is its own document (serve/cardtile-embed-document.mjs).
//
// 🔴 CONSOLE ERRORS ARE NOT IGNORED, they are SORTED. Each engine has a short list of exact texts it prints
// at error level that are not a policy violation (KNOWN, below), each with its reason and a condition:
//   · configuration — WebKit says a report-only policy without `report-to` "will have no effect". This
//     Worker sends report-only without an endpoint on purpose (the policy module says why); the text must
//     name the exact policy the page was served with, and only on a report-only page.
//   · baseline — a text the same page prints with the setting OFF as well (it is the fixture's, not the
//     policy's): accepted on a page only after that page's off twin has been seen printing it.
// Anything else at error level fails the check. Accepted texts are counted and printed.
//
// 🔴 CONTROLS, because a browser that reports nothing proves nothing until it has been seen reporting:
//   · a script, a handler, a script file and a frame the renderer did not write, added to the page: each
//     is refused and reported, and the page's own scripts still run; with the setting off the same three run;
//   · the policy without the two handler hashes: the brand mark's fallback does NOT run;
//   · an embed left as srcdoc under the page's policy: its script does NOT run (why it is its own document);
//   · a script added to the PARENT of a page with an embed, and of a long file whose text says "embed"
//     (the r1 review's escaping-failure model): refused under the policy, and runs with the setting off;
//   · an embed's document framed by another site: refused (frame-ancestors).
//
// Every step has a deadline (STEP_MS): an engine that stops answering fails the step, it does not stall
// the run. Nothing here reaches the network: every other host is answered in this process.
import http from 'node:http';
import { PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { pageCspHeaders, pagePolicy, hashSource, bootScriptOf, videoScript, PAGE_HANDLERS } from '../serve/cardtile-page-csp.mjs';
import { DECK_HEAD_JS } from '../w3/deck-page.mjs';
import { ON_DEMAND_TILES, WINDOW_TILES } from '../serve/size-tier.mjs';
import { PNG, EVERY_TILE, PLAIN, WITH_EMBED, HOSTILE_FRONT, long, proseNamingEmbed, EMBED_ON_BACK } from '../serve/cardtile-page-csp-fixtures.mjs';

const pw = (await import(PLAYWRIGHT)).default;
const ENGINES = (process.env.PAGE_CSP_ENGINES || 'chromium').split(',').filter(Boolean);
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');
const STEP_MS = 30000;

// ── what each engine prints at error level that is not a violation (exact texts) ───────────────────
const KNOWN = {
  chromium: { reportOnly: null, baseline: [] },
  webkit: {
    // configuration: report-only without an endpoint (WebKit 27.2; the policy module sends no report-to on purpose)
    reportOnly: (policy) => `The Content Security Policy '${policy}' was delivered in report-only mode, but does not specify a 'report-to'; the policy will have no effect. Please either add a 'report-to' directive, or deliver the policy via the 'Content-Security-Policy' header.`,
    // baseline: the deck reads a picture's pixels, and the fixture's pictures come from other hosts
    baseline: ['Unable to get image data from canvas because the canvas has been tainted by cross-origin data.'],
  },
};

// ── the store ──────────────────────────────────────────────────────────────────────────────────
const inView = (md, view) => md.replace('---\n', `---\nview: ${view}\n`);
const VIEWS = ['stack', 'list', 'wall'];
const BROKEN_MARK = '---\ntitle: A mark that does not load\nview: wall\n---\n\n## grid\n\n- [ ] %% card: link w=6 %% [Broken](https://broken.example/)\n';
// the embed says it ran, and tries the page it is framed in (which must throw: an opaque origin)
const PROBE = 'parent.postMessage({ embed: "ran" }, "*"); try { parent.document.title = "escaped"; parent.postMessage({ escaped: true }, "*") } catch (e) { parent.postMessage({ blocked: e.name }, "*") }';
const EMBED = WITH_EMBED.replace('t.textContent = "ran"', `t.textContent = "ran"; ${PROBE}`);
const ON_BACK = EMBED_ON_BACK.replace('b.textContent = "ran on the back"', `b.textContent = "ran on the back"; ${PROBE}`);
// a long file whose embed is in its SECOND window: it arrives by the deck's fetch, in the first window's document
const AT = WINDOW_TILES + 200;
const LONG_EMBED = inView(long(ON_DEMAND_TILES + 40), 'list').replace(`%% card: text %% Tile ${AT}.`, `%% card: embed w=6 %% <b id="t">x</b><script>t.textContent = "ran"; ${PROBE}</script>`);
const cards = { plain: PLAIN, hostile: HOSTILE_FRONT, broken: BROKEN_MARK, embedded: EMBED, onback: ON_BACK,
  long: inView(long(ON_DEMAND_TILES + 40), 'list'), longembed: LONG_EMBED, prose: inView(proseNamingEmbed(ON_DEMAND_TILES + 1), 'list'),
  [`_preview:${'c'.repeat(32)}`]: EVERY_TILE };
for (const v of VIEWS) { cards[`every-${v}`] = inView(EVERY_TILE, v); cards[`embedded-${v}`] = inView(EMBED, v); }
if (!EMBED.includes('postMessage') || !LONG_EMBED.includes('postMessage') || !ON_BACK.includes('postMessage')) throw new Error('an embed fixture lost its probe');
const store = { get: async (k) => cards[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };

// no network: the relays' upstream fetches are answered here (a brand mark for every host but broken.example)
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  if (/broken\.example/.test(u)) return new Response('', { status: 404 });
  return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
};

// ── the server: the real Worker, plus the control arms (`?arm=`) ────────────────────────────────
const INJECTED = '<script>window.__ran = (window.__ran || []).concat("inline script")</script>'
  + '<img src="/_icon/example.com.ico" alt="" onload="window.__ran = (window.__ran || []).concat(\'handler\')">'
  + '<script src="https://scripts.example/x.js"></script>'
  + '<iframe src="https://frames.example/" title="x"></iframe>';
// the r1 review's model of an escaping failure in the parent: a script in the page origin
const PARENT_SCRIPT = '<script>window.__parentPwn = location.origin</script>';
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // the framing control's other site: asked as 127.0.0.1, a different origin from localhost (both loopback,
    // so no browser refuses it for reaching a private address)
    if (url.pathname === '/__framer') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><iframe id="f" src="${String(url.searchParams.get('src')).replace(/[<>"&]/g, '')}"></iframe>`);
      return;
    }
    const arm = url.searchParams.get('arm') || '';
    const stage = url.searchParams.get('stage') || 'enforce';
    url.searchParams.delete('arm'); url.searchParams.delete('stage');
    const envOf = (s) => ({ CARDS: store, ...(s === 'off' ? {} : { CARDS_PAGE_CSP: s }) });
    const ask = (s) => worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { headers: { accept: req.headers.accept || '*/*', 'accept-language': 'en' } }), envOf(s));
    // 'srcdoc': the page as it is with the setting off (its embed a srcdoc frame), served under the policy
    const r = await ask(arm === 'srcdoc' ? 'off' : stage);
    const headers = Object.fromEntries(r.headers);
    // whether the Worker sent a policy at all is the Worker's decision, and an arm keeps it (it re-makes the hashes only)
    const sent = !!(headers['content-security-policy'] || headers['content-security-policy-report-only']);
    let body = Buffer.from(await r.arrayBuffer());
    if (arm === 'no-ancestors') {
      // an embed's document with frame-ancestors taken out: the twin of the framing control
      if (headers['content-security-policy'] !== "sandbox allow-scripts; frame-ancestors 'self'") throw new Error('arm no-ancestors: not an embed document');
      headers['content-security-policy'] = 'sandbox allow-scripts';
    } else if (arm) {
      let page = body.toString('utf8');
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      if (arm === 'injected' || arm === 'parent') {
        // what an escaping bug would put in the page: the policy is made from the page that holds it
        page = page.replace('<main', `${arm === 'injected' ? INJECTED : PARENT_SCRIPT}<main`);
        if (!page.includes(arm === 'injected' ? INJECTED : PARENT_SCRIPT)) throw new Error(`arm ${arm}: nothing injected`);
        if (sent) Object.assign(headers, await pageCspHeaders({ CARDS_PAGE_CSP: stage }, page));
      } else if (arm === 'srcdoc') {
        if (!/<iframe sandbox="allow-scripts" srcdoc="/.test(page)) throw new Error('arm srcdoc: no srcdoc frame');
        Object.assign(headers, await pageCspHeaders({ CARDS_PAGE_CSP: 'enforce' }, page));
      } else if (arm === 'no-handlers') {
        const scripts = [await hashSource(DECK_HEAD_JS), await hashSource(videoScript()), await hashSource(bootScriptOf(page))];
        headers['content-security-policy'] = pagePolicy({ scripts, handlers: [] });
      } else throw new Error(`unknown arm ${arm}`);
      body = Buffer.from(page, 'utf8');
    }
    res.writeHead(r.status, headers);
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://localhost:${server.address().port}`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) failures.push(what); };
/** a step with a deadline: an engine that stops answering fails here instead of stalling the run */
const step = (p, what, ms = STEP_MS) => {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
};

let engine = '';
const accepted = { configuration: 0, baseline: 0, where: new Map() };   // where: '<kind> <path>' → how many
const baselines = new Map();   // path → the error texts its off twin printed

/** a page with its ears on: violations (every frame), console errors, page errors; `policy` is the header it was served with */
async function open(context, path, { expect404 = [] } = {}) {
  const page = await step(context.newPage(), `new page for ${path}`);
  const heard = { console: [], errors: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error' && !expect404.some((u) => m.location().url.includes(u))) heard.console.push(m.text()); });
  page.on('pageerror', (e) => heard.errors.push(String(e).slice(0, 200)));
  page.on('request', (q) => heard.requests.push(q.url()));
  const p = { page, heard, path, policy: null, stage: null };
  await visit(p, path);
  return p;
}
/** (re)load a path in an open page, keeping track of the policy it was served with */
async function visit(p, path) {
  const resp = await step(p.page.goto(base + path, { waitUntil: 'load', timeout: STEP_MS }), `load ${path}`);
  const h = resp ? resp.headers() : {};
  p.path = path;
  p.stage = h['content-security-policy'] ? 'enforce' : h['content-security-policy-report-only'] ? 'report-only' : 'off';
  p.policy = h['content-security-policy'] || h['content-security-policy-report-only'] || null;
}
const close = (p) => step(p.page.close(), `close ${p.path}`).catch((e) => check(false, String(e.message)));
const violations = async (page) => {
  const out = [];
  for (const f of page.frames()) { try { out.push(...await step(f.evaluate(() => window.__cspv || []), 'read violations', 5000)); } catch { /* a frame that went away */ } }
  return out;
};
/** the error texts a path prints with the setting off (its baseline), loaded once per path */
async function baselineOf(context, path) {
  const offPath = path.replace(/stage=[^&]*/, 'stage=off') + (/stage=/.test(path) ? '' : `${path.includes('?') ? '&' : '?'}stage=off`);
  if (!baselines.has(offPath)) {
    const p = await open(context, offPath);
    await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
    await p.page.waitForTimeout(600);
    baselines.set(offPath, [...p.heard.console]);
    await close(p);
  }
  return baselines.get(offPath);
}
const tally = (k) => accepted.where.set(k, (accepted.where.get(k) || 0) + 1);
/** sort what a page printed at error level: accepted by an exact known text and its condition, or a failure */
async function sorted(context, p) {
  const known = KNOWN[engine] || { reportOnly: null, baseline: [] };
  const left = [];
  for (const text of p.heard.console) {
    if (known.reportOnly && p.stage === 'report-only' && p.policy && text === known.reportOnly(p.policy)) { accepted.configuration += 1; tally(`configuration ${p.path}`); continue; }
    if (known.baseline.includes(text) && (await baselineOf(context, p.path)).includes(text)) { accepted.baseline += 1; tally(`baseline ${p.path}`); continue; }
    left.push(text);
  }
  return left;
}
const quiet = async (name, p, context) => {
  const v = await violations(p.page);
  check(v.length === 0, `${name}: no securitypolicyviolation in any frame${v.length ? ' — ' + JSON.stringify(v.slice(0, 4)) : ''}`);
  const left = await sorted(context, p);
  check(left.length === 0, `${name}: no console error${left.length ? ' — ' + JSON.stringify(left.slice(0, 3).map((t) => t.slice(0, 200))) : ''}`);
  check(p.heard.errors.length === 0, `${name}: no page error${p.heard.errors.length ? ' — ' + JSON.stringify(p.heard.errors.slice(0, 3)) : ''}`);
  p.heard.console.length = 0; p.heard.errors.length = 0;
  await step(p.page.evaluate(() => { window.__cspv = []; }), 'clear violations', 5000).catch(() => {});
};
const msgs = (p) => step(p.page.evaluate(() => window.__msgs), 'read messages', 5000);
const eagerFrames = (p) => step(p.page.evaluate(() => document.querySelectorAll('iframe[loading]').forEach((f) => { f.removeAttribute('loading'); f.scrollIntoView(); })), 'eager frames', 5000);
const embedRan = async (p, ms = 8000) => {
  await p.page.waitForFunction(() => window.__msgs.some((m) => m.data && m.data.embed === 'ran'), null, { timeout: ms }).catch(() => {});
  await p.page.waitForTimeout(200);
  const m = await msgs(p);
  return { ran: m.some((x) => x.data && x.data.embed === 'ran'), opaque: m.filter((x) => x.data && x.data.embed).every((x) => x.origin === 'null'),
    blocked: m.some((x) => x.data && x.data.blocked === 'SecurityError'), escaped: m.some((x) => x.data && x.data.escaped) };
};

let ran = 0;
try {
  for (const name of ENGINES) {
    let browser;
    try { browser = await pw[name].launch(name === 'chromium' && process.env.PAGE_CSP_CHROMIUM ? { executablePath: process.env.PAGE_CSP_CHROMIUM } : {}); } catch (e) { console.log(`SKIPPED ${name}: it does not launch here — ${String(e.message).split('\n')[0]}`); continue; }
    ran += 1; engine = name; baselines.clear(); accepted.configuration = 0; accepted.baseline = 0; accepted.where.clear();
    console.log(`\n── ${name} ${browser.version()} ──`);
    const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await context.addInitScript(() => {
      window.__cspv = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.effectiveDirective} ${e.blockedURI} ${e.disposition}`));
      window.__msgs = [];
      addEventListener('message', (e) => window.__msgs.push({ origin: e.origin, data: e.data }));
    });
    // every other host a fixture or a click names is answered here
    const other = `http://127.0.0.1:${server.address().port}`;
    await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith(other), (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'www.youtube-nocookie.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title><p>player</p>' });
      if (u.hostname === 'scripts.example') return route.fulfill({ contentType: 'text/javascript', body: 'window.__ran = (window.__ran || []).concat("script file")' });
      if (u.hostname === 'frames.example') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>framed</p>' });
      return route.fulfill({ contentType: 'image/png', body: PNG_BYTES });
    });

    const section = async (label, fn) => { try { await fn(); } catch (e) { check(false, `${label}: ${String(e.message).split('\n')[0]}`); } };

    // 1. every tile type, in the three views, enforced and report-only
    await section('every tile', async () => {
      for (const stage of ['enforce', 'report-only']) for (const view of VIEWS) {
        const p = await open(context, `/every-${view}?stage=${stage}`);
        check(p.stage === stage, `every tile, ${view}, ${stage}: the page was served with the policy`);
        await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
        const state = await step(p.page.evaluate(() => ({ boot: window.__deckBoot, view: document.documentElement.dataset.view, off: document.documentElement.hasAttribute('data-deck-off'),
          strings: !!window.__deckStrings, qr: !!document.querySelector('[data-dynamic-coral="qr"]'), sheets: document.styleSheets.length })), 'read state');
        check(state.boot === 'ready' && !state.off && state.view === view && state.strings, `every tile, ${view}, ${stage}: the deck came up in its view (${JSON.stringify(state)})`);
        await p.page.waitForTimeout(600);
        await quiet(`every tile, ${view}, ${stage}`, p, context);
        await close(p);
      }
    });

    // 🔴 CONTROL — the sorter accepts only what it names: another text, the configuration text naming
    // another policy or on an enforced page, and a baseline text the page's off twin never printed all fail
    await section('sorter', async () => {
      const known = KNOWN[engine] || { reportOnly: null, baseline: [] };
      const fake = (path, stage, policy, text) => ({ path, stage, policy, heard: { console: [text] } });
      const cases = [['another error text', fake('/every-stack?stage=report-only', 'report-only', 'P', 'Something else went wrong.')]];
      if (known.reportOnly) {
        cases.push(['the configuration text, another policy', fake('/every-stack?stage=report-only', 'report-only', 'P', known.reportOnly('Q'))]);
        cases.push(['the configuration text, enforced page', fake('/every-stack?stage=enforce', 'enforce', 'P', known.reportOnly('P'))]);
      }
      for (const t of known.baseline) cases.push(['a baseline text the off twin never printed', fake('/plain', 'enforce', 'P', t)]);
      const before = accepted.configuration + accepted.baseline;
      const kept = [];
      for (const [, p] of cases) kept.push((await sorted(context, p)).length);
      check(kept.every((n) => n === 1) && accepted.configuration + accepted.baseline === before, `CONTROL: the console sorter refuses ${cases.map(([w]) => w).join(', ')} (${JSON.stringify(kept)})`);
    });

    // 2. what a visitor does, on the wall: the video's player, a back, the QR
    await section('wall', async () => {
      const p = await open(context, '/every-wall');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await step(p.page.locator('.st-embed-video-btn').first().click(), 'press play');
      await p.page.waitForSelector('iframe[src^="https://www.youtube-nocookie.com/embed/vLAegkGGWrM"]', { timeout: 5000 }).catch(() => {});
      // the player frame is `loading=lazy`: wait for it to navigate rather than reading it at once
      let player = null;
      for (let i = 0; i < 50 && !player; i += 1) {
        player = p.page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/'));
        if (!player) await p.page.waitForTimeout(100);
      }
      if (player) await player.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      check(!!player && (await step(player.title(), 'player title')) === 'player', 'wall: pressing play loads the player frame');
      // the back door: an element click (at this width the QR figure lies over the door, and a pointer
      // click would land on the figure). The back opens by :target; that drawer.js ran is read off the panel:
      // its click listener (launch) writes --dc-fx into the panel's inline style, which nothing else writes
      await step(p.page.evaluate(() => document.querySelector('a.st-back-door[href="#about"]').click()), 'open the back');
      await p.page.waitForTimeout(500);
      const back = await step(p.page.evaluate(() => ({ hash: location.hash, target: !!document.querySelector('.dc-drawer:target'),
        launched: (document.querySelector('[data-drawer-panel="about"]')?.style.getPropertyValue('--dc-fx') || '') !== '' })), 'read the back');
      check(back.hash === '#about' && back.target && back.launched, `wall: a back opens, and the drawer's own script ran on the click (${JSON.stringify(back)})`);
      await step(p.page.evaluate(() => history.back()), 'history back');
      await p.page.waitForTimeout(300);
      // r1 (third review): heard BEFORE the reload — a reload clears what the page collected
      await quiet('wall, after play and back', p, context);
      await visit(p, '/every-wall');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await step(p.page.locator('.cp-icon').first().click(), 'open the QR');
      await p.page.waitForSelector('.qr-grid', { timeout: 5000 }).catch(() => {});
      check(await step(p.page.evaluate(() => !!document.querySelector('.qr-grid')), 'read QR'), 'wall: the QR opens');
      await p.page.waitForTimeout(400);
      await quiet('wall, after QR', p, context);
      await close(p);
    });
    // …and in the stack: the deck's own player
    await section('stack player', async () => {
      const p = await open(context, '/every-stack');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await step(p.page.evaluate(() => { const b = document.querySelector('.st-embed-video-btn'); b && b.click(); }), 'press play');
      await p.page.waitForSelector('.deck-player iframe', { timeout: 5000 }).catch(() => {});
      check(await step(p.page.evaluate(() => !!document.querySelector('.deck-player iframe')), 'read player'), 'stack: pressing play opens the deck\'s player');
      await p.page.waitForTimeout(400);
      await quiet('stack, after play', p, context);
      await close(p);
    });

    // 3. the other shapes
    await section('other shapes', async () => {
      for (const [label, path] of [['a plain page', '/plain'], ['a page whose frontmatter aims at the boot line', '/hostile'], ['a preview', `/_preview/${'c'.repeat(32)}`],
        ['the second window of a long file', '/long?w=2'], ['a long file whose title says "embed" (r1)', '/prose'], ['its second window', '/prose?w=2']]) {
        const p = await open(context, path);
        check(p.stage === 'enforce', `${label}: served with the policy`);
        await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
        check(await step(p.page.evaluate(() => window.__deckBoot === 'ready'), 'read boot'), `${label}: the deck came up`);
        await p.page.waitForTimeout(300);
        await quiet(label, p, context);
        await close(p);
      }
    });
    // a long file: the deck fetches the next window (connect-src)
    await section('long file', async () => {
      const p = await open(context, '/long');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      for (let i = 0; i < 40 && !p.heard.requests.some((u) => /[?&]w=2&r=/.test(u)); i += 1) {
        await step(p.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)), 'scroll');
        await p.page.waitForTimeout(150);
      }
      check(p.heard.requests.some((u) => /[?&]w=2&r=/.test(u)), 'a long file: the deck asked for the next window');
      await p.page.waitForTimeout(800);
      const tiles = await step(p.page.evaluate(() => document.querySelectorAll('.deck-card, .st-cell').length), 'count tiles');
      check(tiles > 0, `a long file: tiles on the page after the fetch (${tiles})`);
      await quiet('a long file, after the next window arrived', p, context);
      await close(p);
    });
    // a brand mark that does not load: its handler (by hash) walks the candidates and hides it
    await section('broken mark', async () => {
      const p = await open(context, '/broken', { expect404: ['/_icon/'] });
      await p.page.waitForTimeout(800);
      const mark = await step(p.page.evaluate(() => { const i = document.querySelector('.st-cell-icon-img'); return i ? { display: i.style.display, left: i.dataset.iconfallback } : null; }), 'read mark');
      check(!!mark && mark.display === 'none', `a mark that does not load is hidden by its own handler (${JSON.stringify(mark)})`);
      await quiet('a mark that does not load', p, context);
      await close(p);
      // 🔴 CONTROL: without the two handler hashes the handler is refused and the mark is not hidden
      const c = await open(context, '/broken?arm=no-handlers', { expect404: ['/_icon/'] });
      await c.page.waitForTimeout(800);
      const left = await step(c.page.evaluate(() => { const i = document.querySelector('.st-cell-icon-img'); return i ? i.style.display : null; }), 'read mark');
      const v = await violations(c.page);
      check(left !== 'none' && v.some((x) => /^script-src-attr/.test(x)), `CONTROL: without the handler hashes the handler does NOT run, and the browser says so (${JSON.stringify(v.slice(0, 2))})`);
      await close(c);
    });

    // 4. the embed: served WITH the policy, as its own document — and its own script runs
    await section('embed', async () => {
      for (const view of VIEWS) for (const stage of ['enforce', 'report-only']) {
        const p = await open(context, `/embedded-${view}?stage=${stage}`);
        check(p.stage === stage, `an embed, ${view}, ${stage}: served with the policy`);
        const src = await step(p.page.evaluate(() => [...document.querySelectorAll('iframe[sandbox]')].map((f) => `${f.getAttribute('sandbox')} ${f.getAttribute('src')} ${f.hasAttribute('srcdoc')}`)), 'read frames');
        check(src.length === 1 && new RegExp(`^allow-scripts /embedded-${view}/_embed/[0-9a-f]{64} false$`).test(src[0]), `an embed, ${view}, ${stage}: its frame is its own document, same sandbox (${JSON.stringify(src)})`);
        await eagerFrames(p);
        const e = await embedRan(p);
        check(e.ran && e.opaque, `an embed, ${view}, ${stage}: the embed's own script ran, in an opaque origin (${JSON.stringify(e)})`);
        check(e.blocked && !e.escaped, `an embed, ${view}, ${stage}: reaching into the page throws SecurityError`);
        await quiet(`an embed, ${view}, ${stage}`, p, context);
        await close(p);
      }
      // on a back
      {
        const p = await open(context, '/onback');
        await step(p.page.evaluate(() => { location.hash = '#more'; }), 'open the back');
        await eagerFrames(p);
        const e = await embedRan(p);
        check(e.ran && e.blocked && !e.escaped, `an embed on a back: its own script ran (${JSON.stringify(e)})`);
        await quiet('an embed on a back', p, context);
        await close(p);
      }
      // in the SECOND window of a long file: it arrives by the deck's fetch, into the first window's document
      {
        const p = await open(context, '/longembed');
        await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
        for (let i = 0; i < 60 && !(await step(p.page.evaluate(() => !!document.querySelector('iframe[src*="/_embed/"]')), 'look for the frame')); i += 1) {
          await step(p.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)), 'scroll');
          await p.page.waitForTimeout(150);
        }
        const frame = await step(p.page.evaluate(() => (document.querySelector('iframe[src*="/_embed/"]') || {}).src || ''), 'read frame');
        check(/\/longembed\/_embed\/[0-9a-f]{64}\?w=2$/.test(frame), `a long file: the second window's embed names its own document (${frame})`);
        await eagerFrames(p);
        const e = await embedRan(p, 10000);
        check(e.ran && e.blocked && !e.escaped, `a long file: the second window's embed ran (${JSON.stringify(e)})`);
        await quiet('a long file with an embed in its second window', p, context);
        await close(p);
      }
      // the embed's document opened as a page of its own: still an opaque origin (the document's own policy)
      {
        const p = await open(context, '/embedded-wall');
        const src = await step(p.page.evaluate(() => document.querySelector('iframe[sandbox]').getAttribute('src')), 'read frame');
        await visit(p, src);
        await p.page.waitForTimeout(300);
        const top = await step(p.page.evaluate(() => {
          let cookie = 'readable';
          try { void document.cookie; } catch (e) { cookie = e.name; }
          return { origin: self.origin, text: (document.getElementById('t') || {}).textContent, cookie };
        }), 'read the document');
        check(top.origin === 'null' && top.text === 'ran' && top.cookie === 'SecurityError', `an embed's document opened directly: its script runs in an opaque origin, no cookie (${JSON.stringify(top)})`);
        await close(p);
        // 🔴 CONTROL: another site framing it is refused (frame-ancestors 'self')
        // The other site is this server asked as 127.0.0.1 (http like the page: an https framer would be refused
        // as mixed content, and a public one for reaching a private address — neither proves anything).
        // The twin is the same document with frame-ancestors taken out: it must load in the same framer.
        const framed = async (address) => {
          const f = await step(context.newPage(), 'new page');
          await step(f.goto(`http://127.0.0.1:${server.address().port}/__framer?src=${encodeURIComponent(address)}`, { waitUntil: 'load', timeout: STEP_MS }), 'load the framer');
          await f.waitForTimeout(1000);
          const child = f.frames().find((x) => x !== f.mainFrame());
          let inside = null;
          try { inside = child ? await step(child.evaluate(() => (document.getElementById('t') || {}).textContent || null), 'read the framed document', 5000) : null; } catch { inside = null; }
          const out = { url: child ? child.url().slice(0, 60) : null, inside };
          await step(f.close(), 'close');
          return out;
        };
        const refused = await framed(base + src);
        const twin = await framed(`${base}${src}?arm=no-ancestors`);
        check(refused.inside !== 'ran' && twin.inside === 'ran', `CONTROL: another site framing an embed's document is refused, and loads once frame-ancestors is taken out (${JSON.stringify({ refused, twin })})`);
      }
      // 🔴 CONTROL: the same embed left as srcdoc under the page's policy — its script is refused
      {
        const c = await open(context, '/embedded-wall?arm=srcdoc');
        await eagerFrames(c);
        // the frame reports when it has loaded: wait for the report (at most 6 s), not for a fixed time
        let v = [];
        for (let i = 0; i < 30 && !v.some((x) => /^script-src/.test(x)); i += 1) { await c.page.waitForTimeout(200); v = await violations(c.page); }
        const m = await msgs(c);
        const frames = await step(c.page.evaluate(() => [...document.querySelectorAll('iframe[sandbox]')].map((f) => (f.hasAttribute('srcdoc') ? 'srcdoc' : f.getAttribute('src')))), 'read frames');
        // the frame's document is there (its markup parsed) and its script did not change it
        let inside = null;
        for (const f of c.page.frames()) { if (f === c.page.mainFrame()) continue; try { inside = await step(f.evaluate(() => (document.getElementById('t') || {}).textContent ?? null), 'read the frame', 5000); } catch { /* gone */ } }
        // the refusal, as the event or as the engine's own console line (an event in a srcdoc frame can come before the listener)
        const said = c.heard.console.filter((t) => /Content Security Policy|script-src/.test(t)).length;
        check(frames.length === 1 && frames[0] === 'srcdoc' && inside === 'x' && !m.some((x) => x.data && x.data.embed === 'ran') && (v.some((x) => /^script-src/.test(x)) || said > 0),
          `CONTROL: as srcdoc under the page's policy the embed's script does NOT run (${JSON.stringify({ v: v.slice(0, 2), said, inside, frames, policy: c.stage, messages: m.slice(0, 3) })}) — why it is its own document`);
        await close(c);
      }
    });

    // 5. 🔴 CONTROL — the wall itself: what the renderer did not write does not run
    await section('controls', async () => {
      const c = await open(context, '/every-wall?arm=injected');
      await c.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
      await c.page.waitForTimeout(800);
      const state = await step(c.page.evaluate(() => ({ ran: window.__ran || [], boot: window.__deckBoot, frames: [...document.querySelectorAll('iframe')].map((f) => f.src) })), 'read state');
      const v = await violations(c.page);
      const framed = c.page.frames().some((f) => f.url().startsWith('https://frames.example/'));
      check(state.ran.length === 0, `CONTROL: an added inline script, handler and script file did not run (${JSON.stringify(state.ran)})`);
      check(!framed, 'CONTROL: an added frame did not load');
      for (const d of ['script-src-elem inline', 'script-src-attr inline', 'script-src-elem https://scripts.example/x.js', 'frame-src https://frames.example']) {
        check(v.some((x) => x.startsWith(d)), `CONTROL: the browser reported ${d} (${JSON.stringify(v.filter((x) => x.startsWith(d.split(' ')[0])).slice(0, 2))})`);
      }
      check(state.boot === 'ready', 'CONTROL: the page\'s own scripts still ran beside them (the deck came up)');
      await close(c);
      // …and with the setting off the same additions DO run: the refusals above are the policy's
      const off = await open(context, '/every-wall?stage=off');
      await step(off.page.evaluate((html) => { const t = document.createElement('template'); t.innerHTML = html; for (const n of [...t.content.childNodes]) {
        if (n.tagName === 'SCRIPT') { const s = document.createElement('script'); if (n.src) s.src = n.src; else s.textContent = n.textContent; document.body.appendChild(s); } else document.body.appendChild(n); } }, INJECTED), 'inject with the setting off');
      await off.page.waitForFunction(() => (window.__ran || []).length >= 3, null, { timeout: 5000 }).catch(() => {});
      const ranOff = await step(off.page.evaluate(() => window.__ran || []), 'read');
      check(ranOff.length === 3, `CONTROL: with the setting off the same three DO run (${JSON.stringify(ranOff)})`);
      await close(off);
      // r1: a script added to the PARENT — on a page with an embed, and on a long file whose text says "embed"
      for (const [label, path] of [['a page with an embed', '/embedded-wall'], ['a long file whose title says "embed"', '/prose']]) {
        for (const stage of ['enforce', 'off']) {
          const p = await open(context, `${path}?arm=parent&stage=${stage}`);
          await p.page.waitForTimeout(500);
          const pwn = await step(p.page.evaluate(() => window.__parentPwn || null), 'read');
          const v2 = await violations(p.page);
          if (stage === 'enforce') check(pwn === null && v2.some((x) => x.startsWith('script-src-elem inline enforce')), `CONTROL (r1): ${label}: a script added to the page does NOT run in the page origin, and is reported (${JSON.stringify({ pwn, v: v2.slice(0, 2) })})`);
          else check(pwn === base, `CONTROL (r1): ${label}: with the setting off the same script DOES run (${JSON.stringify(pwn)})`);
          await close(p);
        }
      }
    });
    console.log(`  · accepted console texts: ${accepted.configuration} configuration (report-only without report-to), ${accepted.baseline} baseline (also printed with the setting off)`);
    for (const [k, n] of accepted.where) console.log(`      ${n} × ${k}`);
    await step(browser.close(), `close ${name}`).catch((e) => check(false, String(e.message)));
  }
} finally {
  server.close();
  globalThis.fetch = realFetch;
}
if (!ran) { console.log('\nSKIPPED: no browser launched here'); process.exit(0); }
if (failures.length) { console.log(`\n🔴 ${failures.length} failed`); for (const f of failures) console.log(`   ${f}`); process.exit(1); }
console.log(`\n✅ the page's policy, enforced, breaks nothing a page does and refuses what the renderer did not write (${ran} engine${ran > 1 ? 's' : ''})`);
process.exit(0);
