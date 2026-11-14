// Card link destinations accept only safe URL schemes.  run: node --test card-url-scheme.test.mjs
//
// Every Card branch that writes an author URL into href / src / data-back-url / url() is fed the same
// set of disallowed destinations, and the rendered page is read with an HTML parser that is not the
// renderer's own (parse5, from packages/sitetile/astro's deps): no attribute the browser would follow
// may carry a scheme outside the allowlist, however the scheme is spelled. Allowed schemes still link,
// and a save naming a refused destination is refused by name instead of stored.
// The payloads are inert (`void(0)`, a data: document that only says "hi").
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderCardHTML } from './card-worker.mjs';
import { cardLinkReport } from './card-destinations.mjs';
import { handleApi as handleApiAsWritten, CardLifetime, _internal } from './card-api.mjs';
import { twinned } from './api-prefix-twin.mjs';
// every `/_api/card/…` request below goes to `/_api/cards/…` instead when card-api-cards-twin.test.mjs runs this file
const handleApi = twinned(handleApiAsWritten);

const require5 = createRequire(new URL('../../sitetile/astro/package.json', import.meta.url));
let parseHtml = null;
try { ({ parse: parseHtml } = require5('parse5')); } catch { /* no node_modules: skipped below, by name */ }
const needsParse5 = parseHtml ? {} : { skip: 'SKIPPED — needs packages/sitetile/astro/node_modules (parse5)' };

// Each spelling resolves (WHATWG URL parser, as a browser reads an attribute) to a refused scheme.
const BAD = [
  'javascript:void(0)',
  'JaVaScRiPt:void(0)',
  'java&#x09;script:void(0)',          // an entity-encoded tab inside the scheme
  'java&#9;script:void(0)',
  '&#x6a;avascript:void(0)',           // an entity-encoded first letter
  '\u0001javascript:void(0)',          // a leading control character
  'data:text/html;base64,PGI+aGk8L2I+',
  'vbscript:void(0)',
];
const HREF_OK = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'ftp:', 'ftps:']);
const RASTER = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,/i;

/** a card that writes `u` through every Card branch with an author URL */
const everyBranch = (u) => [
  '---', 'card-page: t', 'title: T', `backdrop: ${u}`, '---', '',
  '## grid', '',
  `- [ ] %% card: profile w=6 avatar=${u} %% hello`,
  `- [ ] %% card: link w=3 %% [LinkCell](${u})`,
  `- [ ] %% card: link w=3 back=#about %% [BackCell](${u})`,
  `- [ ] %% card: link w=3 iconimg=${u} %% [IconCell](https://ok.example/icon)`,
  `- [ ] %% card: feature w=3 href=${u} title=FeatureCell %% eyebrow`,
  `- [ ] %% card: feature w=3 href=${u} img=https://cdn.example/f.png %%`,
  `- [ ] %% card: feature w=3 img=${u} href=https://ok.example/f title=FeatureImg %% eyebrow`,
  `- [ ] %% card: social w=6 %% [IG](${u})\n\t[Site](https://ok.example/social)`,
  `- [ ] %% card: embed kind=slider images="${u},https://cdn.example/s.png" %%`,
  `- [ ] %% card: embed kind=bubbles images="${u}" bg=${u} %%`,
  `- [ ] %% card: video w=6 yt=abcdefghijk poster=${u} %% clip`,
  '',
  '## back: about | About', '',
  `- [ ] %% card: link w=3 %% [Inner](${u})`,
  '',
].join('\n');

/** every element attribute a browser would navigate to or fetch, as the browser sees it (entity-decoded by the parser) */
function urlAttrs(html) {
  const out = [];
  const styles = [];
  (function walk(n) {
    for (const a of n.attrs || []) {
      if (['href', 'src', 'poster', 'data-back-url', 'action', 'formaction', 'srcset', 'xlink:href'].includes(a.name)) out.push({ tag: n.tagName, name: a.name, value: a.value });
      if (a.name === 'style') styles.push(a.value);
    }
    if (n.nodeName === 'style') for (const c of n.childNodes || []) styles.push(c.value || '');
    for (const c of n.childNodes || []) walk(c);
    if (n.content) walk(n.content);   // <template>
  })(parseHtml(html));
  return { out, styles };
}
const schemeOf = (v) => { try { return new URL(v, 'https://card.invalid/t/').protocol; } catch { return '(unparseable)'; } };
const allowed = ({ tag, name, value }) => (tag === 'img' && name === 'src' && /^\s*data:/i.test(value) ? RASTER.test(value.trim()) : HREF_OK.has(schemeOf(value)));

for (const bad of BAD) {
  test(`every branch refuses ${JSON.stringify(bad)}: no href/src/data-back-url with a disallowed scheme`, needsParse5, () => {
    const html = renderCardHTML(everyBranch(bad), { handle: 't', cardUrl: 'https://card.example/t' });
    const { out, styles } = urlAttrs(html);
    const wrong = out.filter((a) => !allowed(a));
    assert.deepEqual(wrong, [], 'a disallowed scheme reached an attribute');
    for (const css of styles) assert.doesNotMatch(css.replace(/[\t\n\r]/g, ''), /url\(\s*["']?\s*(?:javascript|vbscript|data:text)/i, 'a disallowed scheme reached a CSS url()');
    // the labels stay, as plain text: a refused link cell is a cell without an <a>
    for (const label of ['LinkCell', 'BackCell', 'FeatureCell']) assert.match(html, new RegExp(`>${label}<`), `${label} still renders`);
    assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>)[\s\S])*>LinkCell</, 'LinkCell is not inside an <a>');
    // the safe neighbours on the same rows still link
    for (const ok of ['https://ok.example/icon', 'https://ok.example/f', 'https://ok.example/social']) {
      assert.ok(out.some((a) => a.name === 'href' && a.value === ok), `${ok} still links`);
    }
  });
}

test('the renderer reports each refused value (what a save refuses), and only those', () => {
  const r = cardLinkReport(everyBranch('javascript:void(0)'));
  // `[x](javascript:void(0))` is the link `javascript:void(0` by the format's own grammar (no `)` in a URL)
  assert.deepEqual(r.refused.sort(), ['javascript:void(0', 'javascript:void(0)']);
  assert.ok(!r.destinations.some((d) => /^javascript:/i.test(d)));
  assert.deepEqual(cardLinkReport(everyBranch('https://fine.example/x')).refused, []);
});

test('allowed schemes still render as links: https, mailto, tel, a drawer #id, a relative path, a raster data: picture', needsParse5, () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const md = [
    '---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=3 %% [Web](https://ok.example/web)',
    '- [ ] %% card: link w=3 %% [Mail](mailto:hello@example.com)',
    '- [ ] %% card: link w=3 %% [Call](tel:+15550100)',
    '- [ ] %% card: link w=3 %% [Rel](/other-card)',
    '- [ ] %% card: link w=3 back=#about %% [Back](https://ok.example/back)',
    `- [ ] %% card: feature w=3 href=#about img=${png} %%`,
    '- [ ] %% card: social w=6 %% [Mail](mailto:hello@example.com)\n\t[Web](https://ok.example/s)',
    '',
    '## back: about | About', '', '- [ ] %% card: link w=3 %% [Inner](https://ok.example/in)', '',
  ].join('\n');
  const html = renderCardHTML(md, { handle: 't', cardUrl: 'https://card.example/t' });
  const { out } = urlAttrs(html);
  const hrefs = out.filter((a) => a.tag === 'a' && a.name === 'href').map((a) => a.value);
  for (const h of ['https://ok.example/web', 'mailto:hello@example.com', 'tel:+15550100', '/other-card', '#about', 'https://ok.example/s', 'https://ok.example/in']) {
    assert.ok(hrefs.includes(h), `${h} renders as a link`);
  }
  assert.ok(out.some((a) => a.name === 'data-back-url' && a.value === 'https://ok.example/back'), 'the back keeps its way out');
  assert.ok(out.some((a) => a.tag === 'img' && a.value === png), 'a raster data: picture renders');
  assert.deepEqual(cardLinkReport(md).refused, []);
});

// ── the save refuses by name ─────────────────────────────────────────────────────────────────────
const TOKEN = 'url-scheme-test-bearer';
let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });
const fakeKv = () => {
  const m = new Map(); const meta = new Map();
  return {
    puts: 0,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: meta.get(k) ?? null }; },
    async put(k, v, opts) { this.puts++; m.set(k, v); if (opts?.metadata !== undefined) meta.set(k, opts.metadata); else meta.delete(k); },
  };
};
const lifetimes = (env) => {
  const objects = new Map();
  const storage = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async put(k, v) { m.set(k, v); }, async delete(k) { return m.delete(k); }, async list({ prefix = '' } = {}) { return new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))); } }; };
  return { idFromName: (name) => ({ name }), get: ({ name }) => ({ fetch(url, init) {
    if (!objects.has(name)) objects.set(name, new CardLifetime({ storage: storage() }, env));
    return objects.get(name).fetch(new Request(url, init));
  } }) };
};
async function save(md, extra = {}) {
  const store = fakeKv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected fetch'); };
  try {
    const url = new URL('https://card.example/_api/card/t');
    const req = new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ markdown: md, create: true, ...extra }) });
    const env = { CARDS: store, MCP_TOKEN_HASH: TOKEN_HASH };
    env.CARD_LIFETIMES = lifetimes(env);
    const res = await handleApi(req, env, url);
    return { res, body: await res.json(), store };
  } finally { globalThis.fetch = realFetch; }
}
const mk = (...cells) => ['---', 'card-page: t', 'title: T', '---', '', '## grid', '', ...cells, ''].join('\n');

test('a save naming a disallowed scheme is refused (422 card_url_scheme) and nothing is written', async () => {
  for (const cell of ['- [ ] %% card: link w=3 %% [x](JaVaScRiPt:void(0))', '- [ ] %% card: feature w=3 img=data:text/html;base64,PGI+aGk8L2I+ title=x %%']) {
    const r = await save(mk(cell));
    assert.equal(r.res.status, 422, cell);
    assert.equal(r.body.error, 'card_url_scheme');
    assert.equal(r.body.refused.length, 1);
    assert.match(r.body.message, /accept only safe URL schemes/);
    assert.equal(r.store.puts, 0, 'nothing written');
  }
  const dry = await save(mk('- [ ] %% card: social w=6 %% [x](javascript:void(0))'), { dry_run: true });
  assert.equal(dry.res.status, 422, 'a dry run is refused the same way');
  const ok = await save(mk('- [ ] %% card: link w=3 %% [x](mailto:hello@example.com)'));
  assert.equal(ok.res.status, 200, JSON.stringify(ok.body));
});
