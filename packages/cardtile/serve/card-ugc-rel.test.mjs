// reef#2044 ① ⑤ — outbound links carry rel=ugc nofollow; a site-wide noindex kill switch.
// run: node --test card-ugc-rel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { renderCardHTML } from './card-worker.mjs';
import { QR_VERSION, DRAWER_VERSION } from './card-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RICH = readFileSync(join(here, '..', 'cards', 'specimens', 'specimen-rich.card.md'), 'utf8');
const OWN = 'links.creator-example.test';       // made-up vanity host
const WWW = 'https://' + ['www', OWN].join('.') + '/';   // the www form of the same host

const anchors = (html) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag, n) => (new RegExp(`\\b${n}="([^"]*)"`).exec(tag) || [])[1];
const outbound = (html) => anchors(html).filter((a) => /^https?:/i.test(attr(a, 'href') || ''));
const isUgc = (a) => /\bugc\b/.test(attr(a, 'rel') || '') && /\bnofollow\b/.test(attr(a, 'rel') || '');
// the platform's own "Powered by" credit is ours, not user content
// (identified by its destination: the `st-footer-credit` class it used to carry is gone, tile-lab#55)
const userLinks = (html) => outbound(html).filter((a) => !/feelreef\.com\/signup/.test(attr(a, 'href') || ''));

const CARD = [
  '---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% a bookbinder, see [notes](https://example.com/notes)',
  '- [ ] %% card: link w=2 %% [Shop](https://example.com/shop)',
  `- [ ] %% card: link w=2 %% [My site](https://${OWN}/about)`,
  `- [ ] %% card: social w=6 %% [Home](${WWW}) [Instagram](https://instagram.com/maple)`,
].join('\n') + '\n';

test('every external <a> on a rendered card says ugc nofollow (canonical host: no exception)', () => {
  for (const md of [RICH, CARD]) {
    const html = renderCardHTML(md, { handle: 'maple', cardUrl: 'https://card.feelreef.com/maple' });
    const links = userLinks(html);
    assert.ok(links.length >= 3, `fixture too thin: ${links.length} external links`);
    const bad = links.filter((a) => !isUgc(a));
    assert.equal(bad.length, 0, `external links without ugc nofollow: ${bad.join(' ')}`);
    assert.ok(links.every((a) => /noopener/.test(attr(a, 'rel')) && /noreferrer/.test(attr(a, 'rel'))));
  }
});

test('exception: on the author\'s OWN vanity host, links to that host (www. or apex) stay plain; everything else is ugc', () => {
  const html = renderCardHTML(CARD, { handle: 'maple', cardUrl: `https://${OWN}` });
  const links = userLinks(html);
  const own = links.filter((a) => attr(a, 'href').includes(OWN));
  const rest = links.filter((a) => !attr(a, 'href').includes(OWN));
  assert.equal(own.length, 2, 'both own-site links (link cell + www social) must be found');
  assert.ok(own.every((a) => attr(a, 'rel') === 'noopener noreferrer'), own.join(' '));
  assert.ok(rest.length >= 2 && rest.every(isUgc), rest.join(' '));
});

test('the exception is not a loophole: on the canonical host a same-host link is another creator, so ugc', () => {
  const html = renderCardHTML(CARD.replace(OWN, 'card.feelreef.com'), { handle: 'maple', cardUrl: 'https://card.feelreef.com/maple' });
  const bad = userLinks(html).filter((a) => !isUgc(a));
  assert.equal(bad.length, 0, bad.join(' '));
});

// ── ⑤ ──────────────────────────────────────────────────────────────────────────────────────────
const envWith = (extra = {}) => {
  // maple has no vanityof: binding, so the canonical URL serves (a bound one 301s to its own host)
  const kv = new Map([['maple', CARD], [`vanity:${OWN}`, 'maple']]);
  return { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...extra };
};
const robots = async (url, extra, headers = {}) =>
  (await worker.fetch(new Request(url, { redirect: 'manual', headers }), envWith(extra))).headers.get('x-robots-tag');

// Since tile#125 a card on the canonical host is `noindex, nofollow` on its own (ROBOTS_HEADERS: only a
// vanity host is indexable) — the switch never weakens that; it is the vanity host the switch reaches.
test('CARD_NOINDEX_ALL on: every card response (html, markdown, vanity host) is noindex', async () => {
  for (const flag of ['1', 'true']) {
    const e = { CARD_NOINDEX_ALL: flag };
    assert.equal(await robots('https://card.feelreef.com/maple', e), 'noindex, nofollow');
    assert.equal(await robots(`https://${OWN}/`, e), 'noindex');
    assert.equal(await robots(`https://${OWN}/`, e, { accept: 'text/markdown' }), 'noindex');
    assert.equal(await robots('https://card.feelreef.com/maple.md', e), 'noindex, nofollow');
  }
});

test('CARD_NOINDEX_ALL off / unset / "0" / "false": a vanity card carries no X-Robots-Tag; the canonical host keeps its own rule', async () => {
  for (const e of [{}, { CARD_NOINDEX_ALL: '0' }, { CARD_NOINDEX_ALL: 'false' }, { CARD_NOINDEX_ALL: '' }]) {
    assert.equal(await robots('https://card.feelreef.com/maple', e), 'noindex, nofollow');
    assert.equal(await robots(`https://${OWN}/`, e), null);
  }
});

test('the switch does not weaken an existing stricter rule (preview stays "noindex, nofollow")', async () => {
  assert.equal(await robots('https://card.feelreef.com/maple', { PREVIEW: 'true', CARD_NOINDEX_ALL: '1' }), 'noindex, nofollow');
});

// ── round 2 (tile#126 review) ───────────────────────────────────────────────────────────────────
// ① inline Markdown links go through the SAME relFor decision as every other authored anchor.
const BIO = (host) => [
  '---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
  `- [ ] %% card: profile w=6 %% hello [home](https://${host}/about) and [away](https://example.com/x)`,
  `- [ ] %% card: text w=6 %% prose [home](https://${host}/p) - and a list:\n\n  - [li](https://${host}/l)`,
].join('\n') + '\n';
const relOf = (html, href) => attr(anchors(html).find((a) => attr(a, 'href') === href), 'rel');

test('inline markdown link to the vanity host is own on the vanity cardUrl, ugc on the canonical one (bio, prose, list)', () => {
  const v = renderCardHTML(BIO(OWN), { handle: 'maple', cardUrl: `https://${OWN}` });
  for (const p of ['about', 'p', 'l']) assert.equal(relOf(v, `https://${OWN}/${p}`), 'noopener noreferrer', p);
  assert.match(relOf(v, 'https://example.com/x'), /\bugc\b/, 'other hosts stay ugc on the vanity card');
  const c = renderCardHTML(BIO(OWN), { handle: 'maple', cardUrl: 'https://card.feelreef.com/maple' });
  for (const p of ['about', 'p', 'l']) assert.match(relOf(c, `https://${OWN}/${p}`), /\bugc nofollow\b/, p);
});

test('inline markdown in a lane label (st-grid-label) uses the same host decision', () => {
  const md = ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
    '- [ ] %% card: link w=2 %% [Shop](https://example.com/shop)', '', `## Second [lane](https://${OWN}/lane)`, '',
    '- [ ] %% card: link w=2 %% [Other](https://example.com/o)'].join('\n') + '\n';
  const v = renderCardHTML(md, { handle: 'maple', cardUrl: `https://${OWN}` });
  const c = renderCardHTML(md, { handle: 'maple', cardUrl: 'https://card.feelreef.com/maple' });
  assert.match(v, /class="st-grid-label">[^<]*<a /, 'fixture: the second lane must render a label with the link');
  assert.equal(relOf(v, `https://${OWN}/lane`), 'noopener noreferrer');
  assert.match(relOf(c, `https://${OWN}/lane`), /\bugc\b/);
});

// ② every exit of the worker carries the header when the switch is on.
const ALT = { PREVIEW: 'false', CARD_NOINDEX_ALL: '1' };
const kvWith = (extra = {}) => {
  const kv = new Map([
    ['maple', CARD], [`vanity:${OWN}`, 'maple'],
    ['bound', CARD], ['vanityof:bound', OWN],
    ...Object.entries(extra),
  ]);
  return { ...ALT, CARDS: { get: async (k) => kv.get(k) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; }, put: async (k, v) => { kv.set(k, v); } } };
};
const hit = async (url, { headers = {}, method = 'GET', body, env = kvWith(), upstream = 'miss' } = {}) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => (upstream === 'miss' ? new Response('', { status: 404 }) : new Response('x', { status: 200, headers: { 'content-type': 'image/x-icon' } }));
  try { return await worker.fetch(new Request(url, { redirect: 'manual', method, headers, body }), env); }
  finally { globalThis.fetch = real; }
};
const C = 'https://card.feelreef.com';
const EXITS = [
  ['canonical html', `${C}/maple`],
  ['canonical .md (fat)', `${C}/maple.md`],
  ['markdown accept (thin)', `${C}/maple`, { headers: { accept: 'text/markdown' } }],
  ['vanity html', `https://${OWN}/`],
  ['vanity /index.md', `https://${OWN}/index.md`],
  ['301 canonical -> vanity', `${C}/bound`, { expect: 301 }],
  ['301 vanity alias /maple -> /', `https://${OWN}/maple`, { expect: 301 }],
  ['icon 200', `${C}/maple/favicon.ico`],
  ['icon 404 (no such card)', `${C}/absent/favicon.ico`, { expect: 404 }],
  ['root pick-a-card 404', `${C}/`, { expect: 404 }],
  ['nothing-here 404', `${C}/maple/nope/deeper`, { expect: 404 }],
  ['no such card 404', `${C}/absent`, { expect: 404 }],
  ['/_icon 400 bad domain', `${C}/_icon/..%2f.ico`, { expect: 400 }],
  ['/_icon 404 upstream miss', `${C}/_icon/example.com.ico`, { expect: 404 }],
  ['/_icon 200', `${C}/_icon/example.com.ico`, { upstream: 'hit' }],
  ['/_yt 400 bad id', `${C}/_yt/short.jpg`, { expect: 400 }],
  ['/_yt 404 upstream miss', `${C}/_yt/abcdefghijk.jpg`, { expect: 404 }],
  ['/_coral/qr', `${C}/_coral/qr-__QR__.js`],
  ['/_coral/drawer', `${C}/_coral/drawer-__DRAWER__.js`],
  ['/try/edit', `${C}/try/edit`],
  ['/try/edit/t asset 404', `${C}/try/edit/t/en/nope.nope`, { expect: 404 }],
  ['301 /try/edit2 -> /try/edit', `${C}/try/edit2`, { expect: 301 }],
  ['/edit without host 400', `${C}/edit`, { expect: 400 }],
  ['/_preview expired', `${C}/_preview/${'0'.repeat(32)}`],
  ['/_api unauthenticated', `${C}/_api/card/maple`, { method: 'POST', body: '{}' }],
];
test('CARD_NOINDEX_ALL on: EVERY exit of the worker carries X-Robots-Tag (enumerated, incl. 301s and icon/asset 404s)', async () => {
  const missing = [];
  for (const [name, rawUrl, o = {}] of EXITS) {
    const url = rawUrl.replace('__QR__', QR_VERSION).replace('__DRAWER__', DRAWER_VERSION);
    const res = await hit(url, o);
    if (o.expect) assert.equal(res.status, o.expect, `${name}: expected ${o.expect}, got ${res.status} (fixture drifted)`);
    if (!/^noindex/.test(res.headers.get('x-robots-tag') || '')) missing.push(`${name} [${res.status}]`);
  }
  assert.deepEqual(missing, [], 'exits without X-Robots-Tag: ' + missing.join('; '));
});

test('CARD_NOINDEX_ALL off: the wrapper adds nothing to any exit', async () => {
  const env = { ...kvWith(), CARD_NOINDEX_ALL: '0' };
  for (const [name, url, o = {}] of EXITS.filter((e) => /301|icon 404|root/.test(e[0]))) {
    const res = await hit(url, { ...o, env });
    // the wrapper's signature is the bare `noindex`; a route's own `noindex, nofollow` (canonical host) is not it
    assert.notEqual(res.headers.get('x-robots-tag'), 'noindex', name);
    if (/^https:\/\/card\.feelreef\.com/.test(url) === false) assert.equal(res.headers.get('x-robots-tag'), null, name);
  }
});
