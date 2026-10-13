// reef#2044 ① ⑤ — outbound links carry rel=ugc nofollow; a site-wide noindex kill switch.
// run: node --test card-ugc-rel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { renderCardHTML } from './card-worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RICH = readFileSync(join(here, '..', 'cards', 'specimens', 'specimen-rich.card.md'), 'utf8');
const OWN = 'links.creator-example.test';       // made-up vanity host

const anchors = (html) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag, n) => (new RegExp(`\\b${n}="([^"]*)"`).exec(tag) || [])[1];
const outbound = (html) => anchors(html).filter((a) => /^https?:/i.test(attr(a, 'href') || ''));
const isUgc = (a) => /\bugc\b/.test(attr(a, 'rel') || '') && /\bnofollow\b/.test(attr(a, 'rel') || '');
// the platform's own "Powered by" credit is ours, not user content
const userLinks = (html) => outbound(html).filter((a) => !/st-footer-credit/.test(a));

const CARD = [
  '---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% a bookbinder, see [notes](https://example.com/notes)',
  '- [ ] %% card: link w=2 %% [Shop](https://example.com/shop)',
  `- [ ] %% card: link w=2 %% [My site](https://${OWN}/about)`,
  `- [ ] %% card: social w=6 %% [Home](https://www.${OWN}/) [Instagram](https://instagram.com/maple)`,
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
  return { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null }, ...extra };
};
const robots = async (url, extra, headers = {}) =>
  (await worker.fetch(new Request(url, { redirect: 'manual', headers }), envWith(extra))).headers.get('x-robots-tag');

test('CARD_NOINDEX_ALL on: every card response (html, markdown, vanity host) is noindex', async () => {
  for (const flag of ['1', 'true']) {
    const e = { CARD_NOINDEX_ALL: flag };
    assert.equal(await robots('https://card.feelreef.com/maple', e), 'noindex');
    assert.equal(await robots(`https://${OWN}/`, e), 'noindex');
    assert.equal(await robots(`https://${OWN}/`, e, { accept: 'text/markdown' }), 'noindex');
    assert.equal(await robots('https://card.feelreef.com/maple.md', e), 'noindex');
  }
});

test('CARD_NOINDEX_ALL off / unset / "0" / "false": production cards carry no X-Robots-Tag', async () => {
  for (const e of [{}, { CARD_NOINDEX_ALL: '0' }, { CARD_NOINDEX_ALL: 'false' }, { CARD_NOINDEX_ALL: '' }]) {
    assert.equal(await robots('https://card.feelreef.com/maple', e), null);
    assert.equal(await robots(`https://${OWN}/`, e), null);
  }
});

test('the switch does not weaken an existing stricter rule (preview stays "noindex, nofollow")', async () => {
  assert.equal(await robots('https://card.feelreef.com/maple', { PREVIEW: 'true', CARD_NOINDEX_ALL: '1' }), 'noindex, nofollow');
});
