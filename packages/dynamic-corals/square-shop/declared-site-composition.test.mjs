// Guard the SEAM: on one composed page, the Worker's baked mode and the document root's stamp are
// the same answer, and the stamp survives composition.
//   run: node packages/dynamic-corals/square-shop/declared-site-composition.test.mjs
//
// WHY THIS EXISTS, and why it is not covered by the two tests either side of it. That the emitter
// bakes the mode is emit-dynamic-coral-css.test.mjs's subject; that the renderer stamps it on every
// page is the astro smoke's; that a published coral reads the stamp is
// ../dynamic-coral-css-registry.test.mjs's. What none of them looks at is the page that comes out
// of BOTH: a Worker-composed storefront, where the Worker writes CSS according to its baked config
// and, a moment later, the published widget hydrates the same markup according to the attribute on
// `<html>`.
//
// 🔴 If composition ever dropped that attribute, the two would disagree on one page — the Worker's
// first paint layered, the widget's re-injected copy unlayered on top of it — and nothing else here
// would notice, because each half would still be right about its own input. `stripDonorHead`,
// `injectHead` and `replaceMain` all rewrite parts of the donor document today; none of them
// touches the `<html>` tag, and this is what keeps it that way.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'declared-site-composition-'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS' : 'FAIL'), '-', n, d && !c ? '| ' + d : ''); };

const STOREFRONTS = JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]);
const CORAL_DIV = '<div data-dynamic-coral="square-shop" data-site-id="site-1" data-cart="1" data-detail-base="/shop"></div>';
const shell = (stamp) =>
  `<!doctype html><html lang="en-US"${stamp ? ` data-dynamic-coral-css="${stamp}"` : ''}>` +
  `<head><title>Donor</title></head><body><main>\n${CORAL_DIV}\n</main></body></html>`;
const htmlTagOf = (s) => (s.match(/<html\b[^>]*>/i) || [''])[0];

const ITEMS = [{ variation_id: 'var-kite', slug: 'kite', name: 'Box kite', image_url: '/m.svg', display_price: 24, price_minor: 2400, currency: 'USD' }];
const PRODUCT = { slug: 'kite', title: 'Box kite', description: 'Four cells.', images: ['/m.svg'],
  variants: [{ id: 'var-kite-s', title: 'Small', price_minor: 2400, currency: 'USD', available: true }] };
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let emitted = 0;
async function emitWorker(extra) {
  const out = join(workDir, `worker-${++emitted}.mjs`);
  execFileSync('node', [join(here, 'emit-shop-function.mjs'),
    '--site-id', 'site-1', '--storefronts', STOREFRONTS,
    '--api', 'https://api.example.test', '--platform-origin', 'https://platform.example.test',
    ...extra, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
  return import(pathToFileURL(out).href);
}

async function compose(mod, path, donor) {
  const env = { ASSETS: { fetch: async () => new Response(donor, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) },
    RSP: { fetch: async () => json({ ok: false }) } };
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname === '/api/v2/shop/catalog') return json({ items: ITEMS });
    if (u.pathname === '/api/v2/shop/catalog/item') return json({ item: PRODUCT });
    throw new Error(`unexpected worker fetch ${u.href}`);
  };
  try {
    const res = await mod.default.fetch(new Request(`https://s.example.test${path}`), env, { waitUntil() {} });
    return await res.text();
  } finally { globalThis.fetch = real; }
}

// A site is wholly one mode or the other, so each worker meets the shell its own renderer built.
const legacy = await emitWorker([]);
const declared = await emitWorker(['--dynamic-coral-css', 'layered']);
const legacyShell = shell('');
const declaredShell = shell('layered');

// What "this page really is the storefront" looks like for each family, so a composition that
// quietly fell back to the donor cannot make the assertions above vacuously true.
const COMPOSED_MARK = { listing: /class="dc-square-shop-grid"[^>]*data-ssr/, detail: /class="dc-pp-wrap"/ };

for (const [label, path] of [['listing', '/shop/'], ['detail', '/shop/kite']]) {
  const l = await compose(legacy, path, legacyShell);
  const d = await compose(declared, path, declaredShell);

  ok(`${label}: undeclared site emits no @layer anywhere in the composed page`,
    !l.includes('@layer'), l.slice(0, 200));
  ok(`${label}: declared site's coral <style> is wrapped in @layer reef.base`,
    /<style>@layer reef\.base \{/.test(d), d.slice(0, 200));

  // The half that composition could silently drop.
  ok(`${label}: undeclared site's <html> tag survives composition byte for byte`,
    htmlTagOf(l) === htmlTagOf(legacyShell), htmlTagOf(l));
  ok(`${label}: declared site's <html> keeps data-dynamic-coral-css="layered" after composition`,
    htmlTagOf(d) === htmlTagOf(declaredShell), htmlTagOf(d));
  ok(`${label}: both pages really are the composed storefront, not the donor served back`,
    COMPOSED_MARK[label].test(l) && COMPOSED_MARK[label].test(d), `${htmlTagOf(l)} / ${htmlTagOf(d)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
