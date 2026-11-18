// tile#372 — the policy of a person's page (serve/cardtile-page-csp.mjs), in a real browser, ENFORCED.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/page-csp.mjs
//   PAGE_CSP_ENGINES=chromium,webkit   which engines (default chromium); one that does not launch is named SKIPPED
//   PAGE_CSP_CHROMIUM=/path/to/chrome    a Chromium binary, when the borrowed Playwright's own revision is not installed
//
// cardtile-page-csp.test.mjs proves the header's TEXT fits the page's markup. This asks the browser what
// that text MEANS: a page holding every tile type, in all three views, is loaded from the real Worker
// with `CARDS_PAGE_CSP=enforce`, and the browser must report no `securitypolicyviolation`, no console
// error and no page error — in the page and in every frame — while the deck comes up, a brand mark's
// fallback handler runs, a video opens its player, a back opens, the QR opens, and a long file's next
// window is fetched. A page with an embed must still run the embed's own script.
//
// 🔴 CONTROLS, because a browser that reports nothing proves nothing until it has been seen reporting:
//   · a script, a handler, a script file and a frame the renderer did not write, added to the page: each is refused;
//   · the policy without the two handler hashes: the brand mark's fallback does NOT run;
//   · the policy forced onto a page with an embed: the embed's own script does NOT run — which is why
//     such a page gets no policy.
//
// Nothing here reaches the network: the relays' upstreams and every host a fixture names are answered
// in this process (a one-pixel PNG, an empty player page).
import http from 'node:http';
import { PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { pageCspHeaders, pagePolicy, hashSource, bootScriptOf, videoScript, PAGE_HANDLERS } from '../serve/cardtile-page-csp.mjs';
import { DECK_HEAD_JS } from '../w3/deck-page.mjs';
import { ON_DEMAND_TILES } from '../serve/size-tier.mjs';
import { PNG, EVERY_TILE, PLAIN, WITH_EMBED, HOSTILE_FRONT, long } from '../serve/cardtile-page-csp-fixtures.mjs';

const pw = (await import(PLAYWRIGHT)).default;
const ENGINES = (process.env.PAGE_CSP_ENGINES || 'chromium').split(',').filter(Boolean);
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');

// ── the store ──────────────────────────────────────────────────────────────────────────────────
const inView = (md, view) => md.replace('---\n', `---\nview: ${view}\n`);
const VIEWS = ['stack', 'list', 'wall'];
const BROKEN_MARK = '---\ntitle: A mark that does not load\nview: wall\n---\n\n## grid\n\n- [ ] %% card: link w=6 %% [Broken](https://broken.example/)\n';
const EMBED = WITH_EMBED.replace('t.textContent = "ran"', 't.textContent = "ran"; parent.postMessage({ embed: "ran" }, "*")');
const cards = { plain: PLAIN, hostile: HOSTILE_FRONT, broken: BROKEN_MARK, embedded: EMBED,
  long: inView(long(ON_DEMAND_TILES + 40), 'list'),
  [`_preview:${'c'.repeat(32)}`]: EVERY_TILE };
for (const v of VIEWS) { cards[`every-${v}`] = inView(EVERY_TILE, v); cards[`embedded-${v}`] = inView(EMBED, v); }
if (!EMBED.includes('postMessage')) throw new Error('the embed fixture lost its probe');
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
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const arm = url.searchParams.get('arm') || '';
    const stage = url.searchParams.get('stage') || 'enforce';
    url.searchParams.delete('arm'); url.searchParams.delete('stage');
    const env = { CARDS: store, ...(stage === 'off' ? {} : { CARDS_PAGE_CSP: stage }) };
    const r = await worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { headers: { accept: req.headers.accept || '*/*', 'accept-language': 'en' } }), env);
    const headers = Object.fromEntries(r.headers);
    let body = Buffer.from(await r.arrayBuffer());
    if (arm) {
      let page = body.toString('utf8');
      delete headers['content-security-policy'];
      if (arm === 'injected') {
        // what an escaping bug would put in the page: the policy is made from the page that holds it
        page = page.replace('<main', `${INJECTED}<main`);
        Object.assign(headers, await pageCspHeaders({ CARDS_PAGE_CSP: 'enforce' }, page));
      } else {
        const scripts = [await hashSource(DECK_HEAD_JS), await hashSource(videoScript()), await hashSource(bootScriptOf(page))];
        const handlers = arm === 'no-handlers' ? [] : await Promise.all(PAGE_HANDLERS.map((h) => hashSource(h)));
        if (arm !== 'no-handlers' && arm !== 'forced') throw new Error(`unknown arm ${arm}`);
        headers['content-security-policy'] = pagePolicy({ scripts, handlers });
      }
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

/** a page with its three ears on: violations (every frame), console errors, page errors */
async function open(context, path, { expect404 = [] } = {}) {
  const page = await context.newPage();
  const heard = { console: [], errors: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error' && !expect404.some((u) => m.location().url.includes(u))) heard.console.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => heard.errors.push(String(e).slice(0, 200)));
  page.on('request', (q) => heard.requests.push(q.url()));
  await page.goto(base + path, { waitUntil: 'load', timeout: 20000 });
  return { page, heard };
}
const violations = async (page) => {
  const out = [];
  for (const f of page.frames()) { try { out.push(...await f.evaluate(() => window.__cspv || [])); } catch { /* a frame that went away */ } }
  return out;
};
const quiet = async (name, { page, heard }) => {
  const v = await violations(page);
  check(v.length === 0, `${name}: no securitypolicyviolation in any frame${v.length ? ' — ' + JSON.stringify(v.slice(0, 4)) : ''}`);
  check(heard.console.length === 0, `${name}: no console error${heard.console.length ? ' — ' + JSON.stringify(heard.console.slice(0, 3)) : ''}`);
  check(heard.errors.length === 0, `${name}: no page error${heard.errors.length ? ' — ' + JSON.stringify(heard.errors.slice(0, 3)) : ''}`);
};

let ran = 0;
try {
  for (const name of ENGINES) {
    let browser;
    try { browser = await pw[name].launch(name === 'chromium' && process.env.PAGE_CSP_CHROMIUM ? { executablePath: process.env.PAGE_CSP_CHROMIUM } : {}); } catch (e) { console.log(`SKIPPED ${name}: it does not launch here — ${String(e.message).split('\n')[0]}`); continue; }
    ran += 1;
    console.log(`\n── ${name} ${browser.version()} ──`);
    const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await context.addInitScript(() => {
      window.__cspv = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.effectiveDirective} ${e.blockedURI} ${e.disposition}`));
      window.__msgs = [];
      addEventListener('message', (e) => window.__msgs.push(e.data));
    });
    // every other host a fixture or a click names is answered here
    await context.route((u) => !u.href.startsWith(base), (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'www.youtube-nocookie.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title><p>player</p>' });
      if (u.hostname === 'scripts.example') return route.fulfill({ contentType: 'text/javascript', body: 'window.__ran = (window.__ran || []).concat("script file")' });
      if (u.hostname === 'frames.example') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>framed</p>' });
      return route.fulfill({ contentType: 'image/png', body: PNG_BYTES });
    });

    // 1. every tile type, in the three views, enforced and report-only
    for (const stage of ['enforce', 'report-only']) for (const view of VIEWS) {
      const p = await open(context, `/every-${view}?stage=${stage}`);
      const header = (await p.page.request.get(`${base}/every-${view}?stage=${stage}`)).headers();
      check(!!header[stage === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only'], `every tile, ${view}, ${stage}: the page was served with the policy`);
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
      const state = await p.page.evaluate(() => ({ boot: window.__deckBoot, view: document.documentElement.dataset.view, off: document.documentElement.hasAttribute('data-deck-off'),
        strings: !!window.__deckStrings, qr: !!document.querySelector('[data-dynamic-coral="qr"]'), sheets: document.styleSheets.length }));
      check(state.boot === 'ready' && !state.off && state.view === view && state.strings, `every tile, ${view}, ${stage}: the deck came up in its view (${JSON.stringify(state)})`);
      await p.page.waitForTimeout(600);
      await quiet(`every tile, ${view}, ${stage}`, p);
      await p.page.close();
    }

    // 2. what a visitor does, on the wall: the video's player, a back, the QR
    {
      const p = await open(context, '/every-wall');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await p.page.locator('.st-embed-video-btn').first().click();
      await p.page.waitForSelector('iframe[src^="https://www.youtube-nocookie.com/embed/vLAegkGGWrM"]', { timeout: 5000 }).catch(() => {});
      // the player frame is `loading=lazy`: wait for it to navigate rather than reading it at once
      let player = null;
      for (let i = 0; i < 50 && !player; i += 1) {
        player = p.page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/'));
        if (!player) await p.page.waitForTimeout(100);
      }
      if (player) await player.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      check(!!player && (await player.title()) === 'player', 'wall: pressing play loads the player frame');
      // the back door: an element click (at this width the QR figure lies over the door, and a pointer
      // click would land on the figure). The back opens by :target; that drawer.js ran is read off the panel:
      // its click listener (launch) writes --dc-fx into the panel's inline style, which nothing else writes
      await p.page.evaluate(() => document.querySelector('a.st-back-door[href="#about"]').click());
      await p.page.waitForTimeout(500);
      const back = await p.page.evaluate(() => ({ hash: location.hash, target: !!document.querySelector('.dc-drawer:target'),
        launched: (document.querySelector('[data-drawer-panel="about"]')?.style.getPropertyValue('--dc-fx') || '') !== '' }));
      check(back.hash === '#about' && back.target && back.launched, `wall: a back opens, and the drawer's own script ran on the click (${JSON.stringify(back)})`);
      await p.page.evaluate(() => history.back());
      await p.page.waitForTimeout(300);
      await p.page.goto(base + '/every-wall', { waitUntil: 'load' });
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await p.page.locator('.cp-icon').first().click();
      await p.page.waitForSelector('.qr-grid', { timeout: 5000 }).catch(() => {});
      check(await p.page.evaluate(() => !!document.querySelector('.qr-grid')), 'wall: the QR opens');
      await p.page.waitForTimeout(400);
      await quiet('wall, after play / back / QR', p);
      await p.page.close();
    }
    // …and in the stack: the deck's own player
    {
      const p = await open(context, '/every-stack');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      await p.page.evaluate(() => { const b = document.querySelector('.st-embed-video-btn'); b && b.click(); });
      await p.page.waitForSelector('.deck-player iframe', { timeout: 5000 }).catch(() => {});
      check(await p.page.evaluate(() => !!document.querySelector('.deck-player iframe')), 'stack: pressing play opens the deck\'s player');
      await p.page.waitForTimeout(400);
      await quiet('stack, after play', p);
      await p.page.close();
    }

    // 3. the other shapes
    for (const [label, path] of [['a plain page', '/plain'], ['a page whose frontmatter aims at the boot line', '/hostile'], ['a preview', `/_preview/${'c'.repeat(32)}`], ['the second window of a long file', '/long?w=2']]) {
      const p = await open(context, path);
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
      check(await p.page.evaluate(() => window.__deckBoot === 'ready'), `${label}: the deck came up`);
      await p.page.waitForTimeout(300);
      await quiet(label, p);
      await p.page.close();
    }
    // a long file: the deck fetches the next window (connect-src)
    {
      const p = await open(context, '/long');
      await p.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 });
      for (let i = 0; i < 40 && !p.heard.requests.some((u) => /[?&]w=2&r=/.test(u)); i += 1) {
        await p.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await p.page.waitForTimeout(150);
      }
      check(p.heard.requests.some((u) => /[?&]w=2&r=/.test(u)), 'a long file: the deck asked for the next window');
      await p.page.waitForTimeout(800);
      const tiles = await p.page.evaluate(() => document.querySelectorAll('.deck-card, .st-cell').length);
      check(tiles > 0, `a long file: tiles on the page after the fetch (${tiles})`);
      await quiet('a long file, after the next window arrived', p);
      await p.page.close();
    }
    // a brand mark that does not load: its handler (by hash) walks the candidates and hides it
    {
      const p = await open(context, '/broken', { expect404: ['/_icon/'] });
      await p.page.waitForTimeout(800);
      const mark = await p.page.evaluate(() => { const i = document.querySelector('.st-cell-icon-img'); return i ? { display: i.style.display, left: i.dataset.iconfallback } : null; });
      check(!!mark && mark.display === 'none', `a mark that does not load is hidden by its own handler (${JSON.stringify(mark)})`);
      await quiet('a mark that does not load', p);
      await p.page.close();
      // 🔴 CONTROL: without the two handler hashes the handler is refused and the mark is not hidden
      const c = await open(context, '/broken?arm=no-handlers', { expect404: ['/_icon/'] });
      await c.page.waitForTimeout(800);
      const left = await c.page.evaluate(() => { const i = document.querySelector('.st-cell-icon-img'); return i ? i.style.display : null; });
      const v = await violations(c.page);
      check(left !== 'none' && v.some((x) => /^script-src-attr/.test(x)), `CONTROL: without the handler hashes the handler does NOT run, and the browser says so (${JSON.stringify(v.slice(0, 2))})`);
      await c.page.close();
    }

    // 4. the embed: served without a policy, and its own script runs
    for (const view of VIEWS) for (const stage of ['enforce', 'report-only']) {
      const p = await open(context, `/embedded-${view}?stage=${stage}`);
      const h = (await p.page.request.get(`${base}/embedded-${view}?stage=${stage}`)).headers();
      check(!h['content-security-policy'] && !h['content-security-policy-report-only'], `an embed, ${view}, ${stage}: served with no policy`);
      await p.page.evaluate(() => document.querySelectorAll('iframe[loading]').forEach((f) => { f.removeAttribute('loading'); f.scrollIntoView(); }));
      await p.page.waitForFunction(() => window.__msgs.some((m) => m && m.embed === 'ran'), null, { timeout: 8000 }).catch(() => {});
      check(await p.page.evaluate(() => window.__msgs.some((m) => m && m.embed === 'ran')), `an embed, ${view}, ${stage}: the embed's own script ran`);
      await quiet(`an embed, ${view}, ${stage}`, p);
      await p.page.close();
    }
    // 🔴 CONTROL: the page's policy forced onto the page with an embed — the embed's script is refused
    {
      const c = await open(context, '/embedded-wall?arm=forced');
      await c.page.evaluate(() => document.querySelectorAll('iframe[loading]').forEach((f) => { f.removeAttribute('loading'); f.scrollIntoView(); }));
      await c.page.waitForTimeout(1500);
      const ranIn = await c.page.evaluate(() => window.__msgs.some((m) => m && m.embed === 'ran'));
      const v = await violations(c.page);
      check(!ranIn && (v.some((x) => /^script-src/.test(x)) || c.heard.console.some((t) => /Content Security Policy/i.test(t))),
        `CONTROL: under the page's policy the embed's own script does NOT run (${JSON.stringify(v.slice(0, 2))}) — a srcdoc frame inherits it`);
      await c.page.close();
    }

    // 5. 🔴 CONTROL — the wall itself: what the renderer did not write does not run
    {
      const c = await open(context, '/every-wall?arm=injected');
      await c.page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }).catch(() => {});
      await c.page.waitForTimeout(800);
      const state = await c.page.evaluate(() => ({ ran: window.__ran || [], boot: window.__deckBoot, frames: [...document.querySelectorAll('iframe')].map((f) => f.src) }));
      const v = await violations(c.page);
      const framed = c.page.frames().some((f) => f.url().startsWith('https://frames.example/'));
      check(state.ran.length === 0, `CONTROL: an added inline script, handler and script file did not run (${JSON.stringify(state.ran)})`);
      check(!framed, 'CONTROL: an added frame did not load');
      for (const d of ['script-src-elem inline', 'script-src-attr inline', 'script-src-elem https://scripts.example/x.js', 'frame-src https://frames.example']) {
        check(v.some((x) => x.startsWith(d)), `CONTROL: the browser reported ${d} (${JSON.stringify(v.filter((x) => x.startsWith(d.split(' ')[0])).slice(0, 2))})`);
      }
      check(state.boot === 'ready', 'CONTROL: the page\'s own scripts still ran beside them (the deck came up)');
      await c.page.close();
      // …and with the setting off the same additions DO run: the refusals above are the policy's
      const off = await open(context, '/every-wall?stage=off');
      await off.page.evaluate((html) => { const t = document.createElement('template'); t.innerHTML = html; for (const n of [...t.content.childNodes]) {
        if (n.tagName === 'SCRIPT') { const s = document.createElement('script'); if (n.src) s.src = n.src; else s.textContent = n.textContent; document.body.appendChild(s); } else document.body.appendChild(n); } }, INJECTED);
      await off.page.waitForFunction(() => (window.__ran || []).length >= 3, null, { timeout: 5000 }).catch(() => {});
      const ranOff = await off.page.evaluate(() => window.__ran || []);
      check(ranOff.length === 3, `CONTROL: with the setting off the same three DO run (${JSON.stringify(ranOff)})`);
      await off.page.close();
    }
    await browser.close();
  }
} finally {
  server.close();
  globalThis.fetch = realFetch;
}
if (!ran) { console.log('\nSKIPPED: no browser launched here'); process.exit(0); }
if (failures.length) { console.log(`\n🔴 ${failures.length} failed`); for (const f of failures) console.log(`   ${f}`); process.exit(1); }
console.log(`\n✅ the page's policy, enforced, breaks nothing a page does and refuses what the renderer did not write (${ran} engine${ran > 1 ? 's' : ''})`);
