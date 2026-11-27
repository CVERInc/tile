// The "this is a preview" bar on a Cards preview (`/_preview/<id>`), from the ONE source both products'
// previews draw it from (../preview-bar.mjs).
//
// What is pinned here:
//   • a person opening a preview gets ONE bar, first thing inside <body>, in the page's language;
//   • its two buttons both open the platform's Cards editor with THIS preview's draft, and the handle in
//     that address is the one the preview was parked for (its stored record), never the request's;
//   • a tool reading the preview (the no-bar header) gets the same response minus the bar, and nothing
//     else differs; so does a frame;
//   • the expired page, the embed documents and a draft with no recorded handle get no bar;
//   • the page CSP needs nothing new for it: no script in it, and its inline <style> is already allowed;
//   • the preview stays unindexed and unstored in every variant.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';
import { previewKey, genKey } from './card-api.mjs';
import { pageCspHeaderName } from './cardtile-page-csp.mjs';
import {
  PREVIEW_BAR_ID, PREVIEW_BAR_COPY, PREVIEW_NO_BAR_HEADER, PREVIEW_NO_BAR_VALUE,
  cardsPreviewBarHtml, sitePreviewBarHtml, wantsPreviewBar, withPreviewBar, previewBarHtml,
} from '../preview-bar.mjs';

const ID = 'a'.repeat(32);
const NO_HANDLE = 'b'.repeat(32);
const STALE = 'c'.repeat(32);
const EMBEDDED = 'd'.repeat(32);
const CARD = (lang = 'ja') => [
  '---', 'card-page: t', 'title: Tester', ...(lang ? [`lang: ${lang}`] : []), '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 %% hello',
  '- [ ] %% card: link w=3 %% [Site](https://example.com)',
  '',
].join('\n');
const WITH_EMBED = [
  '---', 'card-page: t', 'title: Tester', '---', '',
  '## grid', '',
  '- [ ] %% card: embed w=6 h=4 %% <p>hi</p>',
  '',
].join('\n');

const kv = (seed, meta = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: m.has(k) ? m.get(k) : null, metadata: meta[k] ?? null }; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
  };
};
const envFor = (lang = 'ja', extra = {}) => ({
  PREVIEW: 'false',
  CARDS: kv({
    [previewKey(ID)]: CARD(lang),
    [previewKey(NO_HANDLE)]: CARD(lang),
    [previewKey(STALE)]: CARD(lang),
    [previewKey(EMBEDDED)]: WITH_EMBED,
    [genKey('t')]: '2',
  }, {
    // the handle rides in the preview's stored record (card-api's preview POST)
    [previewKey(ID)]: { handle: 'pickme', gen: 0 },
    [previewKey(STALE)]: { handle: 't', gen: 1 },
    [previewKey(EMBEDDED)]: { handle: 't', gen: 2 },
  }),
  ...extra,
});
// `pickme` has generation 0 (no gen key), so the first draft above is current.

const ask = (path, { headers = {}, env = envFor() } = {}) =>
  worker.fetch(new Request(`https://card.feelreef.com${path}`, { headers }), env);

const barOf = (html) => {
  const start = html.indexOf(`<feelreef-preview-bar id="${PREVIEW_BAR_ID}"`);
  if (start === -1) return null;
  const end = html.indexOf('</feelreef-preview-bar>', start);
  return html.slice(start, end + '</feelreef-preview-bar>'.length);
};
const countBars = (html) => html.split(`id="${PREVIEW_BAR_ID}"`).length - 1;
const TOOL = { [PREVIEW_NO_BAR_HEADER]: PREVIEW_NO_BAR_VALUE };

test('a person opening a Cards preview gets ONE bar, as the first thing in <body>', async () => {
  const res = await ask(`/_preview/${ID}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(countBars(html), 1, 'exactly one bar');
  const body = /<body\b[^>]*>/.exec(html);
  assert.ok(body, 'control: the page has a body');
  assert.equal(html.indexOf(barOf(html)), body.index + body[0].length, 'the bar opens <body>');
  assert.match(barOf(html), /^<feelreef-preview-bar [^>]*><template shadowrootmode="closed">/, 'a closed declarative shadow root');
});

test('both buttons open the Cards editor with THIS draft, for the handle the preview was parked for', async () => {
  const bar = barOf(await (await ask(`/_preview/${ID}`)).text());
  const hrefs = [...bar.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const editor = `https://feelreef.com/dashboard/cards/pickme/edit?preview=${ID}`;
  assert.deepEqual(hrefs, [editor, editor], 'left 編輯 and right 上線 both → the editor with ?preview=<id>');
  // the handle is the stored record's: the card's own frontmatter names `t`, and the bar does not
  assert.doesNotMatch(bar, /\/cards\/t\//);
  assert.doesNotMatch(bar, /<script|<form|<button|<input|<iframe|javascript:|\son[a-z]+=/i, 'links only');
});

test('the bar speaks the page\'s language, and the right-hand button is the console\'s word for going live', async (t) => {
  for (const [lang, words] of [
    ['ja', ['これはプレビューです。まだ公開されていません', '編集', '公開']],
    ['zh-TW', ['這是預覽，還沒公開', '編輯', '上線']],
    ['en', ['This is a preview — not public yet', 'Edit', 'Publish']],
  ]) await t.test(lang, async () => {
    const html = await (await ask(`/_preview/${ID}`, { env: envFor(lang) })).text();
    const pageLang = /<html\b[^>]*?\slang="([^"]*)"/.exec(html)?.[1];
    const bar = barOf(html);
    assert.ok(bar, `${lang}: a bar (page lang ${pageLang})`);
    for (const w of words) assert.ok(bar.includes(`>${w}<`), `${lang} (page lang ${pageLang}): "${w}" in ${bar.slice(-300)}`);
  });
});

test('red line: the tools\' header gives the same response minus the bar — same status, same headers', async () => {
  const person = await ask(`/_preview/${ID}`);
  const tool = await ask(`/_preview/${ID}`, { headers: TOOL });
  const [withBar, without] = [await person.text(), await tool.text()];
  assert.equal(countBars(withBar), 1, 'control: without the header the bar is drawn');
  assert.equal(countBars(without), 0, 'with the header there is no bar');
  assert.equal(without, withBar.replace(barOf(withBar), ''), 'and nothing else in the body differs');
  assert.equal(tool.status, person.status);
  assert.deepEqual([...tool.headers.entries()], [...person.headers.entries()]);
});

test('only the exact value suppresses it; a frame gets no bar; a top-level navigation does', async (t) => {
  for (const value of ['0', '', 'true', '11']) await t.test(`header ${JSON.stringify(value)}`, async () => {
    assert.equal(countBars(await (await ask(`/_preview/${ID}`, { headers: { [PREVIEW_NO_BAR_HEADER]: value } })).text()), 1);
  });
  for (const dest of ['iframe', 'frame']) await t.test(dest, async () => {
    assert.equal(countBars(await (await ask(`/_preview/${ID}`, { headers: { 'sec-fetch-dest': dest } })).text()), 0);
  });
  await t.test('document', async () => {
    assert.equal(countBars(await (await ask(`/_preview/${ID}`, { headers: { 'sec-fetch-dest': 'document' } })).text()), 1);
  });
});

test('every variant stays unindexed and unstored', async () => {
  for (const headers of [{}, TOOL, { 'sec-fetch-dest': 'iframe' }]) {
    const res = await ask(`/_preview/${ID}`, { headers });
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('no bar where there is nothing to act on: expired, stale, no recorded handle', async (t) => {
  await t.test('unknown id (expired)', async () => {
    const res = await ask(`/_preview/${'9'.repeat(32)}`);
    assert.equal(res.status, 404);
    assert.equal(countBars(await res.text()), 0);
  });
  await t.test('a draft of an ended lifetime (expired)', async () => {
    const res = await ask(`/_preview/${STALE}`);
    assert.equal(res.status, 404);
    assert.equal(countBars(await res.text()), 0);
  });
  await t.test('a draft parked with no handle: rendered as before, no bar (no editor to point at)', async () => {
    const res = await ask(`/_preview/${NO_HANDLE}`);
    assert.equal(res.status, 200);
    assert.equal(countBars(await res.text()), 0);
  });
});

test('the page CSP needs nothing for the bar: the policy is the same with and without it, and allows inline style', async () => {
  const env = envFor('ja', { CARDS_PAGE_CSP: 'enforce' });
  const person = await ask(`/_preview/${ID}`, { env });
  const tool = await ask(`/_preview/${ID}`, { env, headers: TOOL });
  const name = pageCspHeaderName('enforce');
  const policy = person.headers.get(name);
  assert.ok(policy, 'control: the policy is enforced on this preview');
  assert.equal(policy, tool.headers.get(name), 'the bar changes no hash in the policy');
  assert.match(policy, /style-src 'self' 'unsafe-inline'/, 'its <style> is inline style, which the policy allows');
  assert.doesNotMatch(barOf(await person.text()), /<script/i, 'and it carries nothing script-src would have to allow');
});

test('an embed of a preview, as its own document, never carries the bar', async () => {
  const env = envFor('ja', { CARDS_PAGE_CSP: 'enforce' });
  const page = await (await ask(`/_preview/${EMBEDDED}`, { env })).text();
  assert.equal(countBars(page), 1, 'control: the preview page itself has it');
  const src = /<iframe\b[^>]*\ssrc="([^"]+)"/.exec(page)?.[1];
  assert.ok(src, 'control: under enforce the embed is a document of its own');
  const doc = await ask(src.replace(/&amp;/g, '&'), { env, headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(doc.status, 200);
  assert.equal(countBars(await doc.text()), 0);
});

// ── the one source, on its own ──────────────────────────────────────────────────────────────────────

test('the one source: the Site and Cards bars are the same markup but for their two addresses', () => {
  for (const lang of ['zh-TW', 'ja', 'en', null]) {
    const site = sitePreviewBarHtml('somesite', lang);
    const cards = cardsPreviewBarHtml('somecard', ID, lang);
    const strip = (s) => s.replace(/href="[^"]*"/g, 'href=""');
    assert.equal(strip(site), strip(cards), String(lang));
    assert.notEqual(site, cards, 'control: the addresses really differ');
  }
  assert.deepEqual([...sitePreviewBarHtml('a b', 'en').matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
    ['https://feelreef.com/dashboard/sites/a%20b', 'https://feelreef.com/dashboard/sites/a%20b/publish']);
  assert.deepEqual([...cardsPreviewBarHtml('h', ID, 'en', 'https://staging.example').matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
    [`https://staging.example/dashboard/cards/h/edit?preview=${ID}`, `https://staging.example/dashboard/cards/h/edit?preview=${ID}`]);
});

test('the right-hand button reads the console\'s go-live word in all three locales', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(PREVIEW_BAR_COPY).map(([k, v]) => [k, v.publish])),
    { 'zh-TW': '上線', ja: '公開', en: 'Publish' });
  assert.deepEqual(Object.fromEntries(Object.entries(PREVIEW_BAR_COPY).map(([k, v]) => [k, v.edit])),
    { 'zh-TW': '編輯', ja: '編集', en: 'Edit' }, 'the left button is unchanged');
});

test('wantsPreviewBar keys on the tools\' header and the frame destination, nothing else', () => {
  const h = (o) => new Headers(o);
  assert.equal(wantsPreviewBar(h({})), true);
  assert.equal(wantsPreviewBar(null), true, 'no headers at all: the safe side');
  assert.equal(wantsPreviewBar(h(TOOL)), false);
  assert.equal(wantsPreviewBar(h({ 'sec-fetch-dest': 'IFrame' })), false);
  assert.equal(wantsPreviewBar(h({ 'sec-fetch-dest': 'frame' })), false);
  assert.equal(wantsPreviewBar(h({ 'sec-fetch-dest': 'document', 'user-agent': 'SomeBot/1.0' })), true);
});

test('withPreviewBar: after the first <body>, in the first <html lang>; nothing without a body', () => {
  const bar = (lang) => `[${lang}]`;
  assert.equal(withPreviewBar('<html lang="ja"><head></head><body class="x"><p>a</p><body></body></html>', bar),
    '<html lang="ja"><head></head><body class="x">[ja]<p>a</p><body></body></html>');
  assert.equal(withPreviewBar('<html><body>a</body></html>', bar), '<html><body>[null]a</body></html>');
  assert.equal(withPreviewBar('<p>no body</p>', bar), '<p>no body</p>');
  // an attribute value is escaped (the addresses this module builds never need it)
  assert.match(previewBarHtml({ editHref: 'a"b', publishHref: '<x>' }), /href="a&quot;b".*href="&lt;x&gt;"/);
});
