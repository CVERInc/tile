// The corner dock in a real browser (reef#2790): what the node tests cannot see — layout, the safe
// areas, the shadow's computed reach, two separately built bundles on one page, print, and the
// installed-app bar with sitetile's own switch and stylesheet.
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright(-core)/index.js \
//     node packages/dynamic-corals/dock/dock.smoke.mjs http://127.0.0.1:8749/packages/dynamic-corals/dock/
//
// Chromium always; WebKit too when the Playwright build can launch it (DOCK_SMOKE_ENGINES=chromium
// to narrow). The safe-area arm needs Chromium's `Emulation.setSafeAreaInsetsOverride` and throws
// rather than measure a zero inset and call it green.
//
// THE INSTALLED APP. `display-mode: standalone` is decided once, in script (shared/dock.mjs
// `dockStandalone`), and nothing reads the media query in CSS — so the bar arm forces that one
// decision with an init script that answers `matchMedia('(display-mode: standalone)')` true, in
// every engine. Where Chromium can also emulate the media feature itself it is asked first and the
// result is printed, so a run says which of the two it exercised.
//
// THE SECOND BUNDLE. inbox-bubble.js carries its own pasted copy of the base and dock.js its bundled
// one: two copies already. The skew arm adds a third, `__dock-skew.js` — dock.js with its base's gap
// changed and its version renamed, standing in for an older release of the same coral — loaded
// FIRST, so it creates the dock and the newer copy has to live inside an older dock.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;
const base = process.argv[2];
if (!base) throw new Error('usage: node dock.smoke.mjs <url of packages/dynamic-corals/dock/>');
const { readFileSync } = await import('node:fs');
const fixtureUrl = new URL('__dock-host.html', base).href;
const skewUrl = new URL('__dock-skew.js', base).href;
const dockUrl = new URL('dock.js', base).href;
const inboxUrl = new URL('../inbox-bubble/inbox-bubble.js', base).href;
const appbarUrl = new URL('../../sitetile/astro/src/packages/appbar/appbar.js', base).href;
const appbarCssUrl = new URL('../../sitetile/astro/src/lib/appbar.mjs', base).href;
const DOCK_SRC = readFileSync(new URL('./dock.js', import.meta.url), 'utf8');
// Its own selector, so it mounts only the item written for it and dock.js mounts the rest.
const SKEW_SRC = DOCK_SRC.replaceAll('--dc-dock-gap:.5rem', '--dc-dock-gap:.75rem')
  .replaceAll('[data-dynamic-coral="dock"]', '[data-dynamic-coral="dock-skew"]')
  .replace(/\['dock'\]='[^']+'/, "['dock-skew']='0.0.9'");
if (SKEW_SRC === DOCK_SRC || !SKEW_SRC.includes('--dc-dock-gap:.75rem') || !SKEW_SRC.includes('"dock-skew"')) throw new Error('the skew copy did not change — the arm would compare a bundle with itself');

const ICON = '<svg slot="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>';
const item = (attrs, body = '<div><h2>Panel</h2><p>Body</p></div>') =>
  `<div data-dynamic-coral="dock" ${attrs} hidden>${ICON}${body}</div>`;
const inbox = (origin) => `<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="dock-smoke" data-api-base="${origin}" data-site-name="Smoke"></div>`;

const page = ({ head = '', body = '', scripts = [], lang = 'en' }) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>body{margin:0;font:16px/1.4 Georgia,serif;min-height:200vh} div{display:block;padding:3px} *{margin:1px}</style>${head}</head><body>
${body}
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join('\n')}
</body></html>`;

const failures = [];
const results = [];
function check(engine, name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} [${engine}] ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures.push(`[${engine}] ${name}: ${detail}`);
}

const engines = (process.env.DOCK_SMOKE_ENGINES || 'chromium,webkit').split(',');
for (const engine of engines) {
  let browser;
  try { browser = await lib[engine].launch(); } catch (e) {
    if (engine === 'chromium') throw e;
    console.log(`  · ${engine} not launchable here (${String(e.message).split('\n')[0]}) — SKIPPED`);
    continue;
  }
  async function open(html, { viewport = { width: 390, height: 664 }, standalone = false, init = null, hash = '' } = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: false });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    if (standalone) {
      await p.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
          ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
          : real(q));
      });
    }
    if (init) await p.addInitScript(init);
    await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await p.route(skewUrl, (r) => r.fulfill({ contentType: 'text/javascript', body: SKEW_SRC }));
    await p.route('**/api/**', (r) => {
      const u = r.request().url();
      if (u.includes('/api/inbox/session')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, claimed: true }) });
      return r.fulfill({ contentType: 'application/json', body: '{}' });
    });
    await p.goto(fixtureUrl + hash);
    await p.waitForTimeout(400);
    return { ctx, p, errs };
  }
  const origin = new URL(fixtureUrl).origin;
  // Every dock and its items, as boxes, in dock order.
  const snapshot = (p) => p.evaluate(() => [...document.querySelectorAll('dc-dock')].map((d) => ({
    name: d.getAttribute('name'), hidden: d.hidden, display: getComputedStyle(d).display,
    gap: getComputedStyle(d).rowGap,
    items: [...d.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { id: c.id || c.className || c.tagName, hidden: c.hidden, slot: c.getAttribute('slot'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    }),
  })));
  const bubbleOf = (sel) => `(() => { const h = document.querySelector(${JSON.stringify(sel)}); const sr = h.shadowRoot; return sr.querySelector('.b, .dc-inbox-open'); })()`;

  // ── 1. document order, across bundles, and an async mount ───────────────────────────────────
  {
    // The inbox is written FIRST but mounts LAST (it asks the network first); the skewed copy loads
    // first and creates the dock; dock.js's items mount in between.
    const html = page({
      body: `${inbox(origin)}
<section>${item('id="a" data-label="A" data-open-on-hash="a"')}</section>
${item('id="b" data-label="B"', '<div id="b-content"><h2>B</h2></div>')}
<div id="skew-host"></div>`,
      scripts: [skewUrl, dockUrl, inboxUrl],
    });
    // The skewed copy needs an item of its own: dock.js would mount every item first otherwise.
    const { ctx, p, errs } = await open(html.replace('<div id="skew-host"></div>', item('id="c" data-label="C"', '<div><h2>C</h2></div>').replace('data-dynamic-coral="dock"', 'data-dynamic-coral="dock-skew"')));
    const snap = await snapshot(p);
    const right = snap.find((d) => d.name === 'right');
    check(engine, 'one right dock, created once', snap.filter((d) => d.name === 'right').length === 1, JSON.stringify(snap.map((d) => d.name)));
    const order = right ? right.items.map((i) => i.id) : [];
    check(engine, 'document order: inbox (written first, mounted last) nearest the corner, then a, b, c', JSON.stringify(order) === JSON.stringify(['dc-inbox-host', 'a', 'b', 'c']), JSON.stringify(order));
    const ys = right ? right.items.map((i) => i.bottom) : [];
    check(engine, 'stacked upward, nearest the corner lowest', ys.every((y, i) => i === 0 || y < ys[i - 1]), JSON.stringify(ys));
    check(engine, 'the first copy to arrive styled the dock (skew gap .75rem = 12px)', right && right.gap === '12px', right && right.gap);
    // Same size everywhere: the shape is the dock's.
    const sizes = await p.evaluate(() => [...document.querySelector('dc-dock[name="right"]').children].map((h) => {
      const b = h.shadowRoot.querySelector('.b, .dc-inbox-open').getBoundingClientRect();
      return [Math.round(b.width), Math.round(b.height)];
    }));
    check(engine, 'every bubble is the same 56×56, whichever bundle drew it', sizes.every(([w, h]) => w === 56 && h === 56), JSON.stringify(sizes));
    // Margin + shadow reach, computed.
    const geo = await p.evaluate(() => {
      const h = document.querySelector('dc-dock[name="right"]').firstElementChild;
      const b = h.shadowRoot.querySelector('.dc-inbox-open');
      const r = b.getBoundingClientRect();
      return { right: innerWidth - r.right, bottom: document.documentElement.clientHeight - r.bottom, shadow: getComputedStyle(b).boxShadow };
    });
    check(engine, 'the corner bubble sits 16px from the right and bottom edges', Math.round(geo.right) === 16 && Math.round(geo.bottom) === 16, JSON.stringify(geo));
    const layers = geo.shadow.split(/,(?![^(]*\))/).map((l) => (l.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat));
    const reachDown = Math.max(...layers.map(([, y = 0, blur = 0, spread = 0]) => y + blur + spread));
    const reachSide = Math.max(...layers.map(([x = 0, , blur = 0, spread = 0]) => Math.abs(x) + blur + spread));
    check(engine, `computed shadow reach (down ${reachDown}px, side ${reachSide}px) ≤ the 16px margin`, reachDown <= 16 && reachSide <= 16 && layers.length >= 1, geo.shadow);

    // ── 2. panel above its own item; items above pushed up and back ──
    const before = await snapshot(p);
    await p.evaluate(`${bubbleOf('#a')}.click()`);
    await p.waitForTimeout(100);
    const during = await snapshot(p);
    const pr = await p.evaluate(() => {
      const h = document.getElementById('a');
      const panel = h.shadowRoot.querySelector('.p').getBoundingClientRect();
      const b = h.shadowRoot.querySelector('.b').getBoundingClientRect();
      return { panelBottom: panel.bottom, panelTop: panel.top, bubbleTop: b.top, expanded: h.shadowRoot.querySelector('.b').getAttribute('aria-expanded') };
    });
    check(engine, 'the panel opens directly above its own bubble', pr.panelBottom <= pr.bubbleTop && pr.bubbleTop - pr.panelBottom <= 12, JSON.stringify(pr));
    check(engine, 'aria-expanded follows', pr.expanded === 'true', pr.expanded);
    const itemB = (s) => s.find((d) => d.name === 'right').items.find((i) => i.id === 'b');
    check(engine, 'the item above is pushed up by the panel', itemB(during).bottom < itemB(before).bottom - 50, `${itemB(before).bottom} → ${itemB(during).bottom}`);
    check(engine, 'the panel stays inside the visible viewport', pr.panelTop >= 0, JSON.stringify(pr));
    // Esc closes and focus returns to the bubble.
    await p.evaluate(() => document.getElementById('a').shadowRoot.querySelector('.p').focus());
    await p.keyboard.press('Escape');
    await p.waitForTimeout(50);
    const afterEsc = await p.evaluate(() => {
      const h = document.getElementById('a');
      return { hidden: h.shadowRoot.querySelector('.p').hidden, focus: h.shadowRoot.activeElement && h.shadowRoot.activeElement.className };
    });
    check(engine, 'Esc closes the panel and returns focus to the bubble', afterEsc.hidden && afterEsc.focus === 'b', JSON.stringify(afterEsc));
    check(engine, 'the item above comes back down when the panel closes', Math.abs(itemB(await snapshot(p)).bottom - itemB(before).bottom) < 1, '');

    // ── 3. one open at a time, across three copies of the base ──
    await p.evaluate(`${bubbleOf('dc-dock[name=right] .dc-inbox-host')}.click()`);
    await p.waitForTimeout(150);
    const inboxOpen = () => p.evaluate(() => !!document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-panel'));
    check(engine, 'the inbox opens (its own pasted base)', await inboxOpen(), '');
    await p.evaluate(`${bubbleOf('#b')}.click()`);
    await p.waitForTimeout(100);
    check(engine, 'opening a dock.js item closes the inbox (inbox-bubble.js copy ↔ dock.js copy)', !(await inboxOpen()), 'the inbox panel is still open');
    await p.evaluate(`${bubbleOf('#c')}.click()`);
    await p.waitForTimeout(100);
    const bc = await p.evaluate(() => ['b', 'c'].map((id) => !document.getElementById(id).shadowRoot.querySelector('.p').hidden));
    check(engine, 'opening the skewed copy\'s item closes dock.js\'s (version skew)', bc[0] === false && bc[1] === true, JSON.stringify(bc));
    await p.evaluate(`${bubbleOf('dc-dock[name=right] .dc-inbox-host')}.click()`);
    await p.waitForTimeout(150);
    const c2 = await p.evaluate(() => !document.getElementById('c').shadowRoot.querySelector('.p').hidden);
    check(engine, 'and opening the inbox closes the skewed copy\'s item', c2 === false && (await inboxOpen()), String(c2));

    // ── 4. removal backfills ──
    await p.evaluate(`${bubbleOf('dc-dock[name=right] .dc-inbox-host')}.click()`);
    await p.waitForTimeout(100);
    const s1 = await snapshot(p);
    await p.evaluate(() => { document.getElementById('b-content').hidden = true; });
    await p.waitForTimeout(100);
    const s2 = await snapshot(p);
    const pos = (s, id) => s.find((d) => d.name === 'right').items.find((i) => i.id === id);
    check(engine, 'content hiding itself retires the whole item', pos(s2, 'b').hidden === true, JSON.stringify(pos(s2, 'b')));
    check(engine, 'and the item above drops into its place', Math.abs(pos(s2, 'c').bottom - pos(s1, 'b').bottom) < 1, `${pos(s1, 'b').bottom} vs ${pos(s2, 'c').bottom}`);
    await p.evaluate(() => { document.getElementById('b-content').hidden = false; });
    await p.waitForTimeout(100);
    check(engine, 'and comes back when its content shows again', pos(await snapshot(p), 'b').hidden === false, '');

    // ── 5. print ──
    await p.emulateMedia({ media: 'print' });
    const printed = await p.evaluate(() => [...document.querySelectorAll('dc-dock')].map((d) => getComputedStyle(d).display));
    check(engine, 'hidden in print', printed.every((d) => d === 'none'), JSON.stringify(printed));
    await p.emulateMedia({ media: 'screen' });
    check(engine, 'no page errors (order/skew page)', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ── 6. lazy content, auto-open (first wins), remembered collapse, #name, ink ──
  {
    const html = page({
      body: `${item('id="first" data-label="First" data-open-on-hash="first" data-auto-open="1" data-color="#ffd400"', '<div id="lazy"><img id="img" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10"><h2>First</h2></div>')}
${item('id="second" data-label="Second" data-auto-open="1" data-dock="left"')}
${item('id="hashed" data-label="Hashed" data-open-on-hash="hashed" data-dock="left"')}
${item('id="link" data-label="Top" data-href="#top"', '')}`,
      scripts: [dockUrl],
    });
    const { ctx, p, errs } = await open(html);
    const state = () => p.evaluate(() => Object.fromEntries(['first', 'second', 'hashed'].map((id) => [id, !document.getElementById(id).shadowRoot.querySelector('.p').hidden])));
    let st = await state();
    check(engine, 'two items set to open once: the first in the document opens, the other stays shut', st.first && !st.second, JSON.stringify(st));
    const ink = await p.evaluate(() => getComputedStyle(document.getElementById('first').shadowRoot.querySelector('.b')).color);
    check(engine, 'a light bubble (#ffd400) gets black ink by luminance', ink === 'rgb(0, 0, 0)', ink);
    const ink2 = await p.evaluate(() => getComputedStyle(document.getElementById('second').shadowRoot.querySelector('.b')).color);
    check(engine, 'the default dark bubble gets white ink', ink2 === 'rgb(255, 255, 255)', ink2);
    const link = await p.evaluate(() => { const a = document.getElementById('link').shadowRoot.querySelector('a.b'); return a && a.getAttribute('href'); });
    check(engine, 'a link item is a link, with no panel', link === '#top', String(link));
    // Collapse it, reload: stays collapsed for this tab.
    await p.evaluate(`${bubbleOf('#first')}.click()`);
    await p.reload();
    await p.waitForTimeout(300);
    st = await state();
    check(engine, 'a visitor\'s collapse is remembered for the tab (sessionStorage)', !st.first, JSON.stringify(st));
    const lazy = await p.evaluate(() => ({ slot: !!document.getElementById('first').shadowRoot.querySelector('.p slot'), rects: document.getElementById('lazy').getClientRects().length }));
    check(engine, 'panel content is not laid out before the first open', !lazy.slot && lazy.rects === 0, JSON.stringify(lazy));
    await p.evaluate(`${bubbleOf('#first')}.click()`);
    await p.waitForTimeout(50);
    const lazy2 = await p.evaluate(() => document.getElementById('lazy').getClientRects().length);
    check(engine, 'and is laid out on the first open', lazy2 > 0, String(lazy2));
    await p.evaluate(() => { location.hash = '#hashed'; });
    await p.waitForTimeout(100);
    st = await state();
    check(engine, '#name opens its own panel (and closes the open one)', st.hashed && !st.first, JSON.stringify(st));
    check(engine, 'no page errors (behaviour page)', errs.length === 0, errs.join(' | '));
    await ctx.close();
    const fresh = await open(html, { hash: '#hashed' });
    st = await fresh.p.evaluate(() => Object.fromEntries(['first', 'hashed'].map((id) => [id, !document.getElementById(id).shadowRoot.querySelector('.p').hidden])));
    check(engine, '#name at load opens that panel and takes the place of the auto-open', st.hashed && !st.first, JSON.stringify(st));
    await fresh.ctx.close();
  }

  // ── 7. no script ⇒ no item ──
  {
    // On a page whose CSS leaves `hidden` alone (a site rule like `div{display:block}` outranks the
    // browser's own [hidden] rule, and without the script there is no coral CSS to restore it).
    const { ctx, p } = await open(page({ body: item('id="x" data-label="X"') }).replace(/<style>body[^<]*<\/style>/, ''));
    const vis = await p.evaluate(() => document.getElementById('x').getClientRects().length);
    check(engine, 'without the script the hidden item shows nothing', vis === 0, String(vis));
    await ctx.close();
  }

  // ── 8. safe areas (Chromium) ──
  if (engine === 'chromium') {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 664 } });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 21 } });
    await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: page({ body: item('id="s" data-label="S"') + item('id="l" data-label="L" data-dock="left"'), scripts: [dockUrl] }) }));
    await p.goto(fixtureUrl);
    await p.waitForTimeout(300);
    const g = await p.evaluate(() => ['s', 'l'].map((id) => {
      const r = document.getElementById(id).shadowRoot.querySelector('.b').getBoundingClientRect();
      return { right: innerWidth - r.right, left: r.left, bottom: document.documentElement.clientHeight - r.bottom };
    }));
    check(engine, 'safe areas: right inset 21 + 16, bottom inset 34 + 16; left corner 16 (no left inset)',
      Math.round(g[0].right) === 37 && Math.round(g[0].bottom) === 50 && Math.round(g[1].left) === 16 && Math.round(g[1].bottom) === 50, JSON.stringify(g));
    // The site-wide bottom reserve lifts both corners together; a typo counts as 0.
    await p.addStyleTag({ content: ':root{--dc-dock-reserve:40px}' });
    await p.evaluate(() => dispatchEvent(new Event('resize')));
    await p.waitForTimeout(100);
    const r2 = await p.evaluate(() => ['s', 'l'].map((id) => document.documentElement.clientHeight - document.getElementById(id).shadowRoot.querySelector('.b').getBoundingClientRect().bottom));
    check(engine, 'the bottom reserve (40px) lifts both corners together', r2.every((b) => Math.round(b) === 90), JSON.stringify(r2));
    await p.addStyleTag({ content: ':root{--dc-dock-reserve:banana}' });
    await p.evaluate(() => dispatchEvent(new Event('resize')));
    await p.waitForTimeout(100);
    const r3 = await p.evaluate(() => document.documentElement.clientHeight - document.getElementById('s').shadowRoot.querySelector('.b').getBoundingClientRect().bottom);
    check(engine, 'a reserve that is not a length counts as 0', Math.round(r3) === 50, String(r3));
    await ctx.close();
  }

  // ── 9. the installed-app bar, with sitetile's own markup, stylesheet and switch ──
  {
    const navTabs = ['Home /', 'Comics /comics', 'Shop /shop', 'About /about'].map((s) => {
      const [label, href] = s.split(' ');
      return `<a class="rf-tab" href="${href}"${href === '/shop' ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('') + '<div class="rf-tab rf-tab-group"><details><summary>More links</summary><div class="rf-tab-list"><a href="/a">A</a><a href="/b">B</a></div></details></div>';
    const html = (withBar) => page({
      head: `<script type="module">import { APPBAR_CSS } from ${JSON.stringify(appbarCssUrl)}; const s = document.createElement('style'); s.textContent = APPBAR_CSS; document.head.append(s);</script>`,
      body: `<header class="rf-header"><a class="rf-logo" href="/">Logo</a><nav class="rf-nav" id="rf-nav"><a class="rf-nav-link" href="/">Home</a><a class="rf-nav-link" href="/shop">Shop</a><button class="rf-search-toggle">S</button></nav><label class="rf-nav-hamburger" for="rf-nav-toggle">≡</label><div class="rf-header-actions"><a class="rf-ha-btn" href="/cart">Cart</a></div></header>
${withBar ? `<dc-dock name="bar" data-st-appbar="" data-more-label="More" hidden="">${navTabs}</dc-dock>` : ''}
${inbox(origin)}
${item('id="t1" data-label="T1"')}
${item('id="t2" data-label="T2" data-dock="left"')}`,
      scripts: [appbarUrl, dockUrl, inboxUrl],
    });
    // Normal browser: nothing moves.
    {
      const { ctx, p, errs } = await open(html(true));
      const n = await p.evaluate(() => ({
        barHidden: document.querySelector('dc-dock[name="bar"]').hidden,
        barShown: document.querySelector('dc-dock[name="bar"]').getClientRects().length,
        nav: getComputedStyle(document.querySelector('.rf-nav-link')).display,
        flag: document.documentElement.hasAttribute('data-st-appbar'),
        corners: [...document.querySelectorAll('dc-dock')].map((d) => d.getAttribute('name')).sort(),
      }));
      check(engine, 'browser mode: the bar stays hidden, the header keeps its nav, items go to the corners',
        n.barHidden && n.barShown === 0 && n.nav !== 'none' && !n.flag && JSON.stringify(n.corners) === '["bar","left","right"]', JSON.stringify(n));
      check(engine, 'no page errors (browser-mode bar page)', errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
    // Chromium: can the media feature itself be emulated? (Reported; the arm below forces the switch.)
    if (engine === 'chromium') {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      let emulated = false;
      try {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
        await p.goto('about:blank');
        emulated = await p.evaluate(() => matchMedia('(display-mode: standalone)').matches);
      } catch { /* not supported */ }
      console.log(`  · chromium CDP display-mode emulation: ${emulated ? 'SUPPORTED (matchMedia true)' : 'not supported — the forced switch is what is exercised'}`);
      await ctx.close();
    }
    const { ctx, p, errs } = await open(html(true), { standalone: true });
    await p.waitForTimeout(300);
    const s = await p.evaluate(() => {
      const bar = document.querySelector('dc-dock[name="bar"]');
      const kids = [...bar.children].filter((k) => !k.hidden);
      const more = bar.shadowRoot.querySelector('.more');
      const vr = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      return {
        docks: [...document.querySelectorAll('dc-dock')].map((d) => d.getAttribute('name')),
        flag: document.documentElement.hasAttribute('data-st-appbar'),
        navLinkDisplay: getComputedStyle(document.querySelector('.rf-nav-link')).display,
        hamburger: getComputedStyle(document.querySelector('.rf-nav-hamburger')).display,
        logo: getComputedStyle(document.querySelector('.rf-logo')).display,
        cart: getComputedStyle(document.querySelector('.rf-ha-btn')).display,
        search: getComputedStyle(document.querySelector('.rf-search-toggle')).display,
        order: kids.map((k) => k.id || k.textContent.trim().slice(0, 10) || k.className),
        tabs: kids.filter((k) => !k.getAttribute('slot')).map((k) => k.id || k.textContent.trim().slice(0, 10) || k.className),
        inMore: kids.filter((k) => k.getAttribute('slot') === 'more').map((k) => k.id || k.textContent.trim().slice(0, 10) || k.className),
        moreShown: !more.hidden && more.getClientRects().length > 0,
        barBox: vr(bar), tabBoxes: kids.filter((k) => !k.getAttribute('slot')).map(vr), moreBox: vr(more),
        vh: document.documentElement.clientHeight, vw: innerWidth,
        current: (() => { const a = bar.querySelector('[aria-current="page"]'); return a ? [getComputedStyle(a).fontWeight, getComputedStyle(a).boxShadow] : null; })(),
        radius: getComputedStyle(document.getElementById('t1').shadowRoot.querySelector('.b')).borderTopLeftRadius,
        navCopies: document.querySelectorAll('a[href="/shop"]').length,
      };
    });
    check(engine, 'standalone: one dock, the bar — no corner docks', JSON.stringify(s.docks) === '["bar"]', JSON.stringify(s.docks));
    check(engine, 'standalone: the header keeps the logo and its action buttons; nav links and hamburger leave it',
      s.flag && s.navLinkDisplay === 'none' && s.hamburger === 'none' && s.logo !== 'none' && s.cart !== 'none' && s.search !== 'none', JSON.stringify(s));
    check(engine, 'standalone: nav first, tools after (document order)', JSON.stringify(s.order.slice(0, 5)) === JSON.stringify(['Home', 'Comics', 'Shop', 'About', 'More links']) && JSON.stringify(s.order.slice(5)) === JSON.stringify(['dc-inbox-host', 't1', 't2']), JSON.stringify(s.order));
    check(engine, 'standalone: 8 entries > 5 ⇒ four tabs and More, the rest in the More sheet',
      s.tabs.length === 4 && s.moreShown && s.inMore.length === 4, JSON.stringify({ tabs: s.tabs, inMore: s.inMore }));
    const bottomEdge = s.barBox[1] + s.barBox[3];
    check(engine, 'standalone: the bar runs along the bottom edge, full width', bottomEdge === s.vh && s.barBox[0] === 0 && s.barBox[2] === s.vw, JSON.stringify({ bar: s.barBox, vh: s.vh, vw: s.vw }));
    const w = s.tabBoxes.map((b) => b[2]).concat(s.moreBox[2]);
    check(engine, 'standalone: five equal tabs, More last', w.length === 5 && Math.max(...w) - Math.min(...w) <= 1 && s.moreBox[0] > Math.max(...s.tabBoxes.map((b) => b[0])), JSON.stringify({ tabs: s.tabBoxes, more: s.moreBox }));
    check(engine, 'standalone: the current page\'s tab is marked', s.current && s.current[0] === '700' && s.current[1] !== 'none', JSON.stringify(s.current));
    check(engine, 'standalone: a tool in the bar is square (the dock\'s shape)', s.radius === '0px', s.radius);
    check(engine, 'standalone: the nav was moved, not copied (one /shop link in the bar, one in the hidden header)', s.navCopies === 2, String(s.navCopies));
    // More opens the sheet; the sheet holds the rest; opening a tool from it closes the sheet.
    await p.evaluate(() => document.querySelector('dc-dock[name="bar"]').shadowRoot.querySelector('.more').click());
    await p.waitForTimeout(100);
    const sheet = await p.evaluate(() => {
      const bar = document.querySelector('dc-dock[name="bar"]');
      const sh = bar.shadowRoot.querySelector('.sheet');
      const t2 = document.getElementById('t2').getBoundingClientRect();
      const sr = sh.getBoundingClientRect();
      return { open: sh.hasAttribute('data-open'), vis: getComputedStyle(sh).visibility, t2InSheet: t2.top >= sr.top - 1 && t2.bottom <= sr.bottom + 1 && t2.height > 0, label: getComputedStyle(document.getElementById('t2').shadowRoot.querySelector('.b'), '::after').content };
    });
    check(engine, 'More opens a list holding the rest (a tool shown as a labelled row)', sheet.open && sheet.vis === 'visible' && sheet.t2InSheet && /T2/.test(sheet.label), JSON.stringify(sheet));
    await p.evaluate(() => document.getElementById('t2').shadowRoot.querySelector('.b').click());
    await p.waitForTimeout(100);
    const after = await p.evaluate(() => {
      const sh = document.querySelector('dc-dock[name="bar"]').shadowRoot.querySelector('.sheet');
      const panel = document.getElementById('t2').shadowRoot.querySelector('.p');
      const r = panel.getBoundingClientRect();
      return { sheetOpen: sh.hasAttribute('data-open'), panelShown: !panel.hidden && r.height > 0 && getComputedStyle(panel).visibility === 'visible', panelBottom: Math.round(r.bottom), barTop: Math.round(document.querySelector('dc-dock[name="bar"]').getBoundingClientRect().top) };
    });
    check(engine, 'a tool opened from More shows its panel as a sheet above the bar, and More closes', !after.sheetOpen && after.panelShown && Math.abs(after.panelBottom - after.barTop) <= 1, JSON.stringify(after));
    // A nav group is a list, and joins one-open-at-a-time.
    await p.evaluate(() => document.querySelector('.rf-tab-group summary').click());
    await p.waitForTimeout(100);
    const grp = await p.evaluate(() => ({ open: document.querySelector('.rf-tab-group details').open, t2: !document.getElementById('t2').shadowRoot.querySelector('.p').hidden }));
    check(engine, 'a nav item with children opens a list and closes the open panel', grp.open && !grp.t2, JSON.stringify(grp));
    check(engine, 'no page errors (standalone bar page)', errs.length === 0, errs.join(' | '));
    await ctx.close();
    // Five or fewer: no More.
    const few = await open(page({ body: `<dc-dock name="bar" data-st-appbar="" hidden=""><a class="rf-tab" href="/">Home</a><a class="rf-tab" href="/x">X</a></dc-dock>${inbox(origin)}${item('id="f1" data-label="F1"')}`, scripts: [appbarUrl, dockUrl, inboxUrl] }), { standalone: true });
    await few.p.waitForTimeout(300);
    const f = await few.p.evaluate(() => { const bar = document.querySelector('dc-dock[name="bar"]'); return { n: [...bar.children].filter((k) => !k.hidden && !k.getAttribute('slot')).length, more: bar.shadowRoot.querySelector('.more').hidden }; });
    check(engine, 'standalone: four entries ⇒ four tabs, no More', f.n === 4 && f.more === true, JSON.stringify(f));
    await few.ctx.close();
  }
  await browser.close();
}

console.log(results.join('\n'));
if (failures.length) {
  console.error(`\n✗ dock.smoke: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ dock.smoke: ${results.length} checks`);
