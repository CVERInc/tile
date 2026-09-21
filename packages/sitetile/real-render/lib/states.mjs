// states — the matrix states: how each one is produced by the REAL emitted Worker (contract,
// storefront descriptors, stubbed RSP binding / provider fetch, ASSETS answered from the built
// site), and what the browser stage must do/measure for it.
//
// Worker composition is real: every state's HTML is `mod.default.fetch(Request, env)` of a worker
// emitted by this checkout's own emit-shop-function.mjs. What is stubbed:
//   - the site-runtime service binding's answers (native projection, membership/account/subscribe
//     facts);
//   - provider catalog JSON (global fetch inside the worker);
//   - client-side endpoints the page calls after load (completion outcome, native cart/checkout,
//     and the published coral's own catalog read) — answered by the harness HTTP server
//     (server.mjs);
//   - the site-runtime island (/seam/island.js) is NOT run: the harness serves an empty module and
//     injects a representative DOM fixture instead (islandFixture below). That is a recorded
//     limitation — the fixture reproduces the island's MARKUP (sections / auth-status /
//     email-change status), not its live behaviour, so nothing here is evidence about the island
//     itself, only about how the shell and the theme treat what it writes.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteIdFor, armCoralCss, CORAL_CSS_LAYERED } from './sites.mjs';

export const CONTRACT = {
  schemaVersion: 2,
  bindingName: 'RSP',
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  siteOwnedBuyerPages: [
    { path: '/membership', method: 'GET', kind: 'membership', factsPath: '/api/site-pages/membership-facts' },
    { path: '/account', method: 'GET', kind: 'account', factsPath: '/api/site-pages/account-facts' },
  ],
  subscribeResult: { path: '/subscribe/success', method: 'GET', sessionParam: 'session_id', factsPath: '/api/site-pages/subscribe-result' },
  forward: [
    { match: 'prefix', value: '/api/', methods: ['GET', 'POST'] },
    { match: 'exact', value: '/membership', methods: ['GET'] },
    { match: 'exact', value: '/account', methods: ['GET'] },
    { match: 'exact', value: '/checkout/success', methods: ['GET'] },
    { match: 'exact', value: '/subscribe/success', methods: ['GET'] },
  ],
};

// 🔴 /client-shop is NOT here on purpose. It carries the same coral mount as /provider-shop, and
// leaving it out of the storefront list is what makes the Worker pass it through to the built page
// — so the grid on it is rendered by the PUBLISHED widget in the browser, not written by the
// Worker. The two paths are the two emission points the declaration has to reach independently.
const STOREFRONTS = [
  { path: '/shop', source: 'native' },
  { path: '/provider-shop', source: 'provider', provider: 'square' },
];

export function emitWorker(engine, out, arm) {
  const contractPath = path.join(out, 'contract.json');
  writeFileSync(contractPath, JSON.stringify(CONTRACT, null, 2));
  const file = path.join(out, 'workers', `${arm}.mjs`);
  mkdirSync(path.dirname(file), { recursive: true });
  // The declaration reaches the Worker as the emitter flag, exactly as the shared build script
  // passes it — an undeclared arm passes NO flag rather than an empty one, because "absent" is the
  // legacy mode and a flag with an empty value is a different input.
  const coralCss = armCoralCss(arm);
  execFileSync('node', [path.join(engine, 'packages/dynamic-corals/square-shop/emit-shop-function.mjs'),
    '--site-id', siteIdFor(arm), '--api-contract', contractPath,
    '--storefronts', JSON.stringify(STOREFRONTS),
    '--api', 'https://api.example.test', '--platform-origin', 'https://platform.example.test',
    ...(coralCss ? ['--dynamic-coral-css', coralCss] : []),
    '--emitter-commit', 'harness-copy', '--out', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  // Cheap fail-closed control on the same question buildSites asks of the renderer: the baked
  // config must carry the mode this arm declared, and must carry nothing at all when it did not.
  const baked = readFileSync(file, 'utf8');
  const hasMode = /dynamicCoralCss"?\s*:\s*"layered"/.test(baked);
  if (hasMode !== (coralCss === CORAL_CSS_LAYERED)) {
    throw new Error(`${arm}: emitted worker ${hasMode ? 'bakes' : 'does not bake'} dynamicCoralCss: "layered", ` +
      `but the arm declares ${JSON.stringify(coralCss)}`);
  }
  return file;
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
const WIDE = '/harness-media/wide.svg';   // 2400×1600 intrinsic — media-escape probe
const nativeItem = (slug, name, status, available) => ({
  slug,
  copy: { name, description_html: `<p>${name} description text for the harness fixture.</p>`, image_ref: WIDE, media: [{ url: WIDE }] },
  commerce: { sku: `${slug}-sku`, product_id: `p-${slug}`, variant_id: `v-${slug}`, currency: 'USD', unit_price: 1900, tracked: true, available, reserved: 0, status },
});
const NATIVE = { tee: nativeItem('reef-tee', 'Reef Tee', 'IN_STOCK', 4), mug: nativeItem('sold-mug', 'Sold Mug', 'OUT_OF_STOCK', 0) };
const PLANS = { state: 'available', plans: [
  { plan_id: 'plan_gold', display_name: 'Gold member', amount: 1200, currency: 'USD', interval: 'month' },
  { plan_id: 'plan_silver', display_name: 'Silver member', amount: 600, currency: 'USD', interval: 'month' },
] };
export const PROVIDER_ITEMS = [
  { variation_id: 'var-kite', slug: 'kite', name: 'Box kite', image_url: WIDE, display_price: 24, price_minor: 2400, currency: 'USD' },
  { variation_id: 'var-spool', slug: 'spool', name: 'Line spool', image_url: WIDE, display_price: 9, price_minor: 900, currency: 'USD' },
];
const PROVIDER_PRODUCT = { slug: 'kite', title: 'Box kite', description: 'Four cells of paper and bamboo.', images: [WIDE],
  variants: [
    { id: 'var-kite-s', title: 'Small', price_minor: 2400, currency: 'USD', available: true },
    { id: 'var-kite-l', title: 'Large', price_minor: 3600, currency: 'USD', available: true },
  ] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const nativeRsp = (mode) => async (req) => {
  const u = new URL(req.url);
  if (u.pathname !== '/api/v2/storefront/native') return json({ ok: false }, 404);
  if (mode === 'unavailable') return json({ ok: false, error: 'native_storefront_unavailable' }, 503);
  const slug = u.searchParams.get('slug');
  if (!slug) return json({ ok: true, source: 'native', items: mode === 'empty' ? [] : [NATIVE.tee, NATIVE.mug] });
  const item = Object.values(NATIVE).find((i) => i.slug === slug);
  return item ? json({ ok: true, source: 'native', item }) : json({ ok: false }, 404);
};
const factsRsp = (factsPath, answer) => async (req) => {
  const u = new URL(req.url);
  if (u.pathname !== factsPath) return json({ ok: false }, 404);
  return typeof answer === 'number' ? json({ ok: false }, answer) : json(answer);
};

// ── island DOM fixtures (markup only; see file header) ──────────────────────────────────────────
// Executed in the page. `kind` selects the fixture.
export function islandFixture(kind) {
  const q = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  if (kind === 'membership-auth') {
    const s = q('[data-ejecta-slot="auth-state"]'); if (s) s.textContent = 'You are signed out.';
  }
  if (kind === 'account-signed-out') {
    const s = q('[data-ejecta-auth-status]'); if (s) s.textContent = 'Check your inbox for a sign-in link.';
  }
  if (kind === 'account-signed-in') {
    const sec = (t) => q(`[data-ejecta-account-section="${t}"]`);
    // orders section: textContent lines joined with \n
    if (sec('orders')) sec('orders').textContent = 'ord_1001 · paid · $19.00\nord_1002 · fulfilled · $42.00';
    // active membership summary: div > p + button[data-ejecta-account-manage-subscription] + p[status]
    if (sec('membership')) {
      const c = el('div');
      c.append(el('p', {}, 'Membership: gold · entitlements: members-area'));
      c.append(el('button', { type: 'button', 'data-ejecta-account-manage-subscription': '' }, 'Manage subscription'));
      c.append(el('p', { 'data-ejecta-account-manage-status': '', 'aria-live': 'polite' }, 'Could not open the billing portal.'));
      sec('membership').replaceChildren(c);
    }
    // profile section: plain text
    if (sec('profile')) sec('profile').textContent = 'Display name: Harness Member · likes kites';
    // contact form: form > label(text + input) ×3 + p[status] + button[submit]
    if (sec('contact')) {
      const f = el('form', { 'data-ejecta-account-contact-form': '' });
      for (const [k, label, v] of [['name', 'Name', 'Harness Member'], ['phone', 'Phone', '555-0100'], ['address', 'Address', '1 Example Road']]) {
        const w = el('label', {}, label); const i = el('input', { type: 'text', name: k }); i.value = v; w.append(i); f.append(w);
      }
      f.append(el('p', { 'data-ejecta-account-contact-status': '', 'aria-live': 'polite' }, 'Saved.'));
      f.append(el('button', { type: 'submit' }, 'Save contact'));
      f.addEventListener('submit', (e) => e.preventDefault());
      sec('contact').replaceChildren(f);
    }
    // discord section: div > p + button(connect) + a(join)
    if (sec('discord')) {
      const c = el('div');
      c.append(el('p', {}, 'Discord: not connected'));
      c.append(el('button', { type: 'button' }, 'Connect Discord'));
      c.append(el('a', { href: 'https://discord.example.test/invite', target: '_blank', rel: 'noopener noreferrer' }, 'Join the server'));
      sec('discord').replaceChildren(c);
    }
    const s = q('[data-ejecta-email-change-status]'); if (s) s.textContent = 'Verification email sent.';
  }
  return true;
}

// ── state table ──────────────────────────────────────────────────────────────────────────────────
// Measurement spec fields (all selectors are BEHAVIORAL hooks, so they survive presentation fixes):
//   root      runtime root element (inset / container / language checks)
//   heading   runtime heading compared to a build-time heading
//   cards     card elements (card/list treatment; container = cards[0].parentElement)
//   actions   [{sel, kind: button|link, expect: enabled|disabled}]
//   inputs    form inputs
//   status    status nodes that must be filled at measure time
//   coral     true → what this state measures is painted by a dynamic coral's OWN package CSS, so
//             where that CSS sits in the cascade is the site's declaration to make. The
//             selector-override and cascade checks become mode-aware here (probe.mjs): on an
//             undeclared site the theme must NOT reach it (locked negative control), on a declaring
//             site it must.
//             🔴 The completion/checkout-result states are deliberately NOT marked: that page's
//             presentation lives in site.css's reef.base "runtime: results" block, not in coral
//             package CSS, so a theme selector already reaches it on every site and the
//             declaration changes nothing there. Marking them would invent a flip that does not
//             exist and then fail looking for it.
//   client    browser step before measuring: {wait?, fixture?, conflictClick?, mountCoral?}
const A = (sel, kind = 'button', expect = 'enabled') => ({ sel, kind, expect });
export const STATES = [
  { id: 'native-listing', family: 'native shop', path: '/shop/', rsp: nativeRsp('ok'),
    root: '[data-storefront-source="native"]', cards: '[data-storefront-source="native"] article',
    actions: [A('.dc-native-buy[data-native-sku]'), A('.dc-native-buy:not([data-native-sku])', 'button', 'disabled')] },
  { id: 'native-listing-empty', family: 'native shop', path: '/shop/', rsp: nativeRsp('empty'), root: '[data-storefront-source="native"]', extra: true },
  { id: 'native-unavailable', family: 'native shop', path: '/shop/', rsp: nativeRsp('unavailable'),
    root: '[data-storefront-source="native"]', heading: '[data-storefront-source="native"] h1', extra: true },
  { id: 'native-detail', family: 'native shop', path: '/shop/reef-tee', rsp: nativeRsp('ok'),
    root: '[data-storefront-source="native"]', heading: '[data-storefront-source="native"] h1',
    actions: [A('.dc-native-buy[data-native-sku]')] },
  { id: 'native-detail-soldout', family: 'native shop', path: '/shop/sold-mug', rsp: nativeRsp('ok'),
    root: '[data-storefront-source="native"]', heading: '[data-storefront-source="native"] h1',
    actions: [A('.dc-native-buy', 'button', 'disabled')] },
  { id: 'native-detail-conflict', family: 'native shop', path: '/shop/reef-tee', rsp: nativeRsp('ok'),
    root: '[data-storefront-source="native"]', heading: '[data-storefront-source="native"] h1',
    actions: [A('.dc-native-buy[data-native-sku]', 'button', 'disabled')], status: ['[data-native-status]'],
    client: { conflictClick: '.dc-native-buy[data-native-sku]' } },

  { id: 'provider-listing', family: 'provider shop', path: '/provider-shop/', coral: true, providerFetch: 'catalog',
    root: '[data-dynamic-coral="square-shop"]', cards: '.dc-square-shop-card, [data-dynamic-coral="square-shop"] [data-variation-id]',
    actions: [A('[data-dynamic-coral="square-shop"] button')] },
  { id: 'provider-detail', family: 'provider shop', path: '/provider-shop/kite', coral: true, providerFetch: 'item',
    root: '.dc-pp-wrap', heading: '.dc-pp-title', actions: [A('[data-dc-add]')], inputs: ['select[data-dc-variant]'] },
  // The published widget's own copy of that CSS, injected by the artifact in the browser.
  { id: 'client-listing', family: 'provider shop', path: '/client-shop/', coral: true,
    root: '[data-dynamic-coral="square-shop"]', cards: '.dc-square-shop-card',
    actions: [A('[data-dynamic-coral="square-shop"] button')],
    client: { mountCoral: true, wait: 'client-grid' } },

  { id: 'membership-plans', family: 'membership', path: '/membership', rsp: factsRsp('/api/site-pages/membership-facts', PLANS),
    root: '[data-ejecta-membership]', heading: '[data-ejecta-membership] h1', cards: '[data-ejecta-membership] li',
    actions: [A('[data-ejecta-slot="subscribe"]')], status: ['[data-ejecta-membership-auth-state]'],
    client: { fixture: 'membership-auth' } },
  { id: 'membership-empty', family: 'membership', path: '/membership', rsp: factsRsp('/api/site-pages/membership-facts', { state: 'empty' }),
    root: '[data-ejecta-membership]', heading: '[data-ejecta-membership] h1', status: ['[data-ejecta-membership-empty]'] },
  { id: 'membership-unavailable', family: 'membership', path: '/membership', rsp: factsRsp('/api/site-pages/membership-facts', 503),
    root: '[data-ejecta-membership]', heading: '[data-ejecta-membership] h1', status: ['[data-ejecta-membership-unavailable]'] },

  { id: 'account-signed-out', family: 'account', path: '/account', rsp: factsRsp('/api/site-pages/account-facts', { signed_in: false }),
    root: '[data-ejecta-account]', heading: '[data-ejecta-account] h1',
    actions: [A('[data-ejecta-account-login-form] button[type="submit"]')], inputs: ['#ejecta-account-email'],
    status: ['[data-ejecta-auth-status]'], client: { fixture: 'account-signed-out' } },
  { id: 'account-signed-in', family: 'account', path: '/account',
    rsp: factsRsp('/api/site-pages/account-facts', { signed_in: true, sections: ['orders', 'membership', 'profile', 'contact', 'discord'] }),
    root: '[data-ejecta-account]', heading: '[data-ejecta-account] h1',
    actions: [A('[data-ejecta-account-email-change-form] button[type="submit"]'), A('[data-ejecta-account-manage-subscription]'), A('[data-ejecta-account-contact-form] button[type="submit"]')],
    inputs: ['#ejecta-account-new-email', '[data-ejecta-account-contact-form] input[name="name"]'],
    status: ['[data-ejecta-email-change-status]', '[data-ejecta-account-manage-status]', '[data-ejecta-account-contact-status]'],
    ordersSection: '[data-ejecta-account-section="orders"]', client: { fixture: 'account-signed-in' } },

  { id: 'shop-complete-pending', family: 'shop completion', path: '/shop/complete?ref=pending',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', client: { wait: 'outcome' } },
  { id: 'shop-complete-paid', family: 'shop completion', path: '/shop/complete?ref=paid',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', client: { wait: 'paid' } },
  { id: 'shop-complete-locale-paid', family: 'shop completion', path: '/zh-tw/shop/complete?ref=paid',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', client: { wait: 'paid' } },
  { id: 'shop-complete-canceled', family: 'shop completion', path: '/shop/complete?ref=canceled',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', actions: [A('#dc-shop-outcome a', 'link')], client: { wait: 'back' }, extra: true },
  { id: 'shop-complete-unknown', family: 'shop completion', path: '/shop/complete',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', actions: [A('#dc-shop-outcome a', 'link')] },

  { id: 'checkout-success-paid', family: 'checkout result', path: '/checkout/success?order_id=paid',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', client: { wait: 'paid' } },
  { id: 'checkout-success-unknown', family: 'checkout result', path: '/checkout/success?order_id=missing-order',
    root: '#dc-shop-outcome', heading: '#dc-shop-heading', actions: [A('#dc-shop-outcome a', 'link')], client: { wait: 'back' } },

  { id: 'subscribe-active', family: 'subscription result', path: '/subscribe/success?session_id=cs_active',
    rsp: factsRsp('/api/site-pages/subscribe-result', { state: 'active', plan: PLANS.plans[0] }),
    root: '[data-ejecta-subscribe-result]', heading: '[data-ejecta-subscribe-result] h1', status: ['[data-ejecta-subscribe-message]'] },
  { id: 'subscribe-unknown', family: 'subscription result', path: '/subscribe/success',
    root: '[data-ejecta-subscribe-result]', heading: '[data-ejecta-subscribe-result] h1', actions: [A('[data-ejecta-subscribe-result] a[href="/"]', 'link')] },
  { id: 'subscribe-unavailable', family: 'subscription result', path: '/subscribe/success?session_id=cs_down',
    rsp: factsRsp('/api/site-pages/subscribe-result', 503),
    root: '[data-ejecta-subscribe-result]', heading: '[data-ejecta-subscribe-result] h1', status: ['[data-ejecta-subscribe-unavailable]'] },
];

// ── compose: drive the emitted worker ────────────────────────────────────────────────────────────
function assetsFrom(dist) {
  return {
    fetch: async (req) => {
      const u = new URL(typeof req === 'string' ? req : req.url);
      let p = decodeURIComponent(u.pathname);
      const candidates = p.endsWith('/') ? [p + 'index.html'] : [p, p + '/index.html'];
      for (const c of candidates) {
        const f = path.join(dist, c);
        if (f.startsWith(dist) && existsSync(f) && statSync(f).isFile()) {
          return new Response(readFileSync(f), { status: 200, headers: { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
        }
      }
      return new Response('not found', { status: 404 });
    },
  };
}

export async function composeStates(workerFile, dist, arm, states, outDir) {
  const mod = await import(pathToFileURL(workerFile).href + `?t=${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  const results = {};
  const realFetch = globalThis.fetch;
  for (const st of states) {
    const env = { ASSETS: assetsFrom(dist), RSP: { fetch: st.rsp || (async () => json({ ok: false }, 404)) } };
    globalThis.fetch = async (input) => {
      const u = new URL(typeof input === 'string' ? input : input.url);
      if (st.providerFetch === 'catalog' && u.pathname === '/api/v2/shop/catalog') return json({ items: PROVIDER_ITEMS });
      if (st.providerFetch === 'item' && u.pathname === '/api/v2/shop/catalog/item') return json({ item: PROVIDER_PRODUCT });
      throw new Error(`harness: unexpected worker fetch ${u.href}`);
    };
    let res;
    try {
      res = await mod.default.fetch(new Request(`https://${arm}.example.test${st.path}`), env, { waitUntil() {} });
    } finally {
      globalThis.fetch = realFetch;
    }
    const html = await res.text();
    const file = path.join(outDir, `${st.id}.html`);
    writeFileSync(file, html);
    results[st.id] = { status: res.status, contentType: res.headers.get('content-type'), file, bytes: html.length };
  }
  writeFileSync(path.join(outDir, 'compose.json'), JSON.stringify(results, null, 2));
  return results;
}
