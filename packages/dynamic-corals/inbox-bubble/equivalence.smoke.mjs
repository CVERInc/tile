// The inbox on the dock behaves as the inbox before it (reef#2790) — the OLD coral and this one on
// the same page, in Chromium and WebKit, compared by what each one does, not by reading source.
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/playwright(-core)/index.js \
//     node packages/dynamic-corals/inbox-bubble/equivalence.smoke.mjs http://127.0.0.1:8749/packages/dynamic-corals/inbox-bubble/
//
// The old coral is `git show $INBOX_BASELINE:packages/dynamic-corals/inbox-bubble/inbox-bubble.js`
// (default: the last commit before the dock, 2223646c — inbox-bubble 0.7.17 plus its two unreleased
// fixes). A clone without that commit (a shallow CI checkout) SKIPS this file by name.
//
// 🔴 THE RULER IS VALIDATED FIRST: the old coral against itself must come out identical on every
// measure, or the run stops — a comparison that can differ for reasons of its own proves nothing.
//
// What is compared, per engine and per scenario: the closed bubble's markup; the open panel's markup
// (the ask view with KAITO, the compose view without, the ask-only view on a tenant with no Inbox);
// the markup after closing with ×; the focus after opening and the Tab order through the panel in
// both directions; Enter (sends) and Shift+Enter (a newline) in the box, and the conversation drawn
// after a send; `#inbox` with data-open-on-hash="1" (opens, focuses the box) and without it (does
// not); and the phone keyboard — a 390×664 viewport shrunk to 390×364 with the panel open, where the
// panel, the box and Send must stay fully on screen. And the knobs set on a WRAPPER around the container
// rather than on :root (`--reef-inbox-accent`, `--reef-inbox-offset-y`): the bubble's colour and its
// distance from the bottom must be what the old coral, which lived inside the container, drew.
//
// THE DIFFERENCES THE DOCK MADE ON PURPOSE are removed by name before comparing, each one asserted
// to be present in the new coral (so a removal that silently stopped matching would be red):
//   · the bubble's aria-expanded/aria-controls and the panel's id;
//   · open, the bubble is the panel's close control: × in place of the glyph, named「Close」(owner
//     ruling 2026-11-01; the panel keeps its own × too);
//   · the bubble stays under the open panel (the panel sits directly above its own item) — one more
//     Tab stop after Send, and one more node in the open markup;
//   · Esc closes the panel and returns focus to the bubble (the old coral had no Esc), and × returns
//     focus to the bubble too (it used to drop to <body>);
//   · the panel's box is 64px higher (above the bubble), the shadow is the dock's budget;
//   · the bubble lives in the corner dock at the end of <body>, so in the PAGE's tab order it comes
//     after the page's own content rather than where its container was written (inside the panel
//     the order is compared exactly).
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;
const base = process.argv[2];
if (!base) throw new Error('usage: node equivalence.smoke.mjs <url of packages/dynamic-corals/inbox-bubble/>');
const { execFileSync } = await import('node:child_process');
const { readFileSync } = await import('node:fs');
const BASELINE = process.env.INBOX_BASELINE || '2223646c';
let OLD;
try {
  OLD = execFileSync('git', ['show', `${BASELINE}:packages/dynamic-corals/inbox-bubble/inbox-bubble.js`],
    { cwd: new URL('.', import.meta.url).pathname, maxBuffer: 8e6, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
} catch {
  console.log(`  · inbox equivalence SKIPPED — ${BASELINE} is not in this clone (shallow checkout?)`);
  process.exit(0);
}
const NEW = readFileSync(new URL('./inbox-bubble.js', import.meta.url), 'utf8');
const MUTATE = process.env.EQUIV_MUTATE || '';   // for the mutation run: a JS replace applied to NEW
const NEW_SRC = MUTATE ? NEW.replace(...JSON.parse(MUTATE)) : NEW;
const fixtureUrl = new URL('__equiv.html', base).href;
const coralUrl = (arm) => new URL(`__equiv-${arm}.js`, base).href;

/** The named differences, removed. Each returns [text, didMatch]. */
const legacy = (html) => html
  .replace(/ aria-expanded="(?:true|false)" aria-controls="dc-inbox-panel"/g, '')
  .replace(' id="dc-inbox-panel"', '')
  .replace(/<\/div><button type="button" class="dc-inbox-open" aria-label="[^"]*">[\s\S]*?<\/button>$/, '</div>');

const page = (attrs, origin, wrap = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;font:16px Georgia,serif}</style></head>
<body><a id="before" href="#x">before</a>
${wrap ? `<div style="${wrap}">` : ''}<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="equiv" data-api-base="${origin}" data-site-name="Equiv Shop" ${attrs}></div>${wrap ? '</div>' : ''}
<a id="after" href="#y">after</a>
<script type="module" src="${coralUrl('X')}"></script></body></html>`;

const SCENARIOS = {
  kaito: { attrs: 'data-kaito="1"', claimed: true },
  compose: { attrs: '', claimed: true },
  askOnly: { attrs: 'data-kaito="1"', claimed: false },
  hash: { attrs: 'data-open-on-hash="1"', claimed: true, hash: '#inbox' },
  hashOff: { attrs: '', claimed: true, hash: '#inbox' },
  // Review of tile#233, finding 3: the knobs on a wrapper (and inline on the container), not on :root.
  wrapped: { attrs: '', claimed: true, wrap: '--reef-inbox-accent:rgb(200,0,0);--reef-inbox-offset-y:80px' },
  inline: { attrs: 'style="--reef-inbox-accent:rgb(0,120,0);--reef-inbox-offset-x:24px;--reef-inbox-on-accent:rgb(255,255,0)"', claimed: true },
};

async function measure(browser, src, name) {
  const sc = SCENARIOS[name];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const origin = new URL(fixtureUrl).origin;
  await p.route(fixtureUrl, (r) => r.fulfill({ contentType: 'text/html', body: page(sc.attrs, origin, sc.wrap) }));
  await p.route(coralUrl('X'), (r) => r.fulfill({ contentType: 'text/javascript', body: src }));
  await p.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/inbox/session') && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, claimed: sc.claimed }) });
    if (u.includes('/api/kaito')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'grounded', text: 'We ship worldwide.', source_url: 'https://example.com/shipping' }) });
    if (u.includes('/api/inbox/assistant')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, name: '', resolved: false }) });
    if (u.includes('/api/inbox') && r.request().method() === 'POST') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'c_equiv' }) });
    if (u.includes('/api/inbox')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [{ role: 'visitor', text: 'hello', at: '2026-11-01T00:00:00Z' }], status: 'open' }) });
    return r.fulfill({ status: 404, body: '{}' });
  });
  await p.goto(fixtureUrl + (sc.hash || ''));
  await p.waitForFunction(() => { const h = document.querySelector('.dc-inbox-host'); return h && h.shadowRoot.querySelector('.dc-inbox-root').innerHTML; }, null, { timeout: 10000 });
  await p.waitForTimeout(300);
  const markup = () => p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-root').innerHTML.replace(/\s+/g, ' '));
  const focus = () => p.evaluate(() => {
    let a = document.activeElement;
    const inside = !!(a && a.classList && a.classList.contains('dc-inbox-host'));
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a ? `${inside ? 'in:' : ''}${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : ''}${a.name ? '[' + a.name + ']' : ''}` : 'none';
  });
  const out = { scenario: name };
  if (name === 'wrapped' || name === 'inline') {
    const look = () => p.evaluate(() => {
      const b = document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-open');
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return { background: cs.backgroundColor, ink: cs.color, fromBottom: Math.round(document.documentElement.clientHeight - r.bottom), fromRight: Math.round(document.documentElement.clientWidth - r.right) };
    });
    out.closedLook = await look();
    await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-open').click());
    await p.waitForTimeout(300);
    out.openPanelBg = await p.evaluate(() => getComputedStyle(document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-form button[type="submit"]')).backgroundColor);
    await ctx.close();
    out.errs = errs;
    return out;
  }
  if (name === 'hash' || name === 'hashOff') {
    out.openAtLoad = await p.evaluate(() => !!document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-panel'));
    out.focusAtLoad = await focus();
    await ctx.close();
    out.errs = errs;
    return out;
  }
  out.closed = await markup();
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-open').click());
  await p.waitForTimeout(300);
  out.open = await markup();
  out.focusOnOpen = await focus();
  const tabs = async (key, n) => { const seq = []; for (let i = 0; i < n; i++) { await p.keyboard.press(key); seq.push(await focus()); } return seq; };
  out.tabForward = await tabs('Tab', 4);
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('textarea').focus());
  out.tabBack = await tabs('Shift+Tab', 3);
  // Keyboard in the box: Shift+Enter is a newline, Enter sends.
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('textarea').focus());
  await p.keyboard.type('do you ship');
  await p.keyboard.press('Shift+Enter');
  await p.keyboard.type('abroad');
  out.shiftEnter = await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('textarea').value);
  // The phone keyboard: the visual viewport shrinks under an open panel.
  await p.setViewportSize({ width: 390, height: 364 });
  await p.waitForTimeout(250);
  out.keyboardUp = await p.evaluate(() => {
    const sr = document.querySelector('.dc-inbox-host').shadowRoot;
    const vh = (window.visualViewport ? visualViewport.height : innerHeight);
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; };
    const inside = (b) => b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= innerWidth;
    const panel = box(sr.querySelector('.dc-inbox-panel'));
    const ta = box(sr.querySelector('textarea'));
    const send = box(sr.querySelector('.dc-inbox-form button[type="submit"]'));
    return { allInside: inside(panel) && inside(ta) && inside(send), textareaH: ta.h, sendH: send.h, composerOk: ta.h > 30 };
  });
  await p.setViewportSize({ width: 390, height: 664 });
  await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('textarea').focus());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  out.afterSend = (await markup()).replace(/<textarea[^>]*>[^<]*<\/textarea>/, '<textarea/>');
  // Close with ×: the closed markup again, and where the focus went.
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-close').click());
  await p.waitForTimeout(100);
  out.afterClose = await markup();
  out.focusAfterClose = await focus();
  // Esc on a reopened panel.
  await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-open').click());
  await p.waitForTimeout(200);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  out.escCloses = await p.evaluate(() => !document.querySelector('.dc-inbox-host').shadowRoot.querySelector('.dc-inbox-panel'));
  out.focusAfterEsc = await focus();
  out.errs = errs;
  await ctx.close();
  return out;
}

/** The new coral's report with the named differences taken away (each asserted present first). */
function normalise(r, isNew, problems, label, buttonsTab = true) {
  const n = { ...r };
  for (const k of ['closed', 'open', 'afterClose', 'afterSend']) if (typeof n[k] === 'string') n[k] = legacy(n[k]);
  if (isNew && n.open !== undefined) {
    if (!/aria-expanded="true" aria-controls="dc-inbox-panel"/.test(r.open)) problems.push(`${label}: expected the open bubble's aria-expanded/controls`);
    if (!/<button type="button" class="dc-inbox-open" aria-label="Close" aria-expanded="true" aria-controls="dc-inbox-panel"><svg class="dc-inbox-icon" [^>]*><path [^>]*d="M6 6l12 12M18 6 6 18"/.test(r.open)) problems.push(`${label}: expected the open bubble to be the close control (× and Close)`);
    // WebKit (as Safari by default) does not Tab to buttons at all — not to Send, not to the bubble.
    if (buttonsTab && r.tabForward[1] !== 'in:button.dc-inbox-open') problems.push(`${label}: expected the bubble as the Tab stop after Send, got ${r.tabForward[1]}`);
    n.tabForward = r.tabForward.filter((f) => f !== 'in:button.dc-inbox-open');
    if (!(r.escCloses && r.focusAfterEsc === 'in:button.dc-inbox-open')) problems.push(`${label}: expected Esc to close and focus the bubble`);
    if (r.focusAfterClose !== 'in:button.dc-inbox-open') problems.push(`${label}: expected × to return focus to the bubble`);
    delete n.escCloses; delete n.focusAfterEsc; delete n.focusAfterClose;
  } else if (n.open !== undefined) {
    n.tabForward = n.tabForward.filter((f) => f !== 'in:button.dc-inbox-open');
    delete n.escCloses; delete n.focusAfterEsc; delete n.focusAfterClose;
  }
  // Where the panel sits in the PAGE's tab order is a named difference too: the host lives in the
  // dock at the end of <body> now, not inside its container, so the page's own links before and after
  // the container are reached in a different order. Inside the panel the order is compared exactly.
  if (n.tabForward) n.tabForward = n.tabForward.filter((f) => f.startsWith('in:'));
  if (n.tabBack) n.tabBack = n.tabBack.filter((f) => f.startsWith('in:'));
  return n;
}

const failures = [];
const lines = [];
for (const engine of (process.env.EQUIV_ENGINES || 'chromium,webkit').split(',')) {
  let browser;
  try { browser = await lib[engine].launch(); } catch (e) {
    if (engine === 'chromium') throw e;
    console.log(`  · ${engine} not launchable — SKIPPED`);
    continue;
  }
  for (const [armName, A, B] of [['ruler: old vs old', OLD, OLD], ['old vs new', OLD, NEW_SRC]]) {
    let diffs = 0;
    for (const name of Object.keys(SCENARIOS)) {
      const problems = [];
      const ra = await measure(browser, A, name);
      const a = normalise(ra, false, problems, name);
      const b = normalise(await measure(browser, B, name), B !== OLD, problems, name, (ra.tabForward || []).includes('in:button'));
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(`${name}.${k}: old ${JSON.stringify(a[k]).slice(0, 400)} ≠ new ${JSON.stringify(b[k]).slice(0, 400)}`);
      }
      if (a.errs && a.errs.length) problems.push(`${name}: page errors (A) ${a.errs.join(' | ')}`);
      diffs += problems.length;
      lines.push(`${problems.length ? 'FAIL' : 'PASS'} [${engine}] ${armName} — ${name}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`);
      if (armName.startsWith('old vs new') && name === 'kaito') lines.push(`      keyboard-up: old ${JSON.stringify(a.keyboardUp)} new ${JSON.stringify(b.keyboardUp)}`);
    }
    if (diffs) failures.push(`[${engine}] ${armName}: ${diffs} difference(s)`);
    if (armName.startsWith('ruler') && diffs) { console.log(lines.join('\n')); console.error('✗ the ruler differs from itself — nothing below would mean anything'); process.exit(2); }
  }
  await browser.close();
}
console.log(lines.join('\n'));
if (failures.length) { console.error(`✗ inbox equivalence: ${failures.join('; ')}`); process.exit(1); }
console.log(`✓ inbox equivalence: old (${BASELINE}) and new behave the same, named differences aside`);
