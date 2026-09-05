// Brand marks come from our origin, and the route is not an open proxy.
//
//   node --test packages/cardtile/marks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_DOMAIN_RE, iconPath, iconUpstream } from './marks.mjs';
import { renderCardHTML } from './serve/card-worker.mjs';

const CARDS = join(dirname(fileURLToPath(import.meta.url)), 'cards/specimens');
const read = (h) => fs.readFileSync(join(CARDS, `${h}.card.md`), 'utf8');
const markup = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '');

test('🔴 the renderer sends no visitor to a third party for a brand mark', () => {
  // 🩸 This read three real creators' cards until 2026-08-12, and it was two claims wearing one
  // assertion: (a) the RENDERER routes every brand mark through our own origin — a product claim —
  // and (b) those three particular live pages carry no absolute third-party image — an audit of
  // three customers' pages. Only (a) belongs in the package. (b) moved to lab/marks-live.test.mjs
  // with the cards, because a Card owner will soon be making their own and our copies of theirs are
  // a record of the phase where we built them by hand.
  //
  // The specimens turned out to be STRICTER, which is why the split cost nothing: they carry zero
  // absolute images, so the exception the old test had to carve out — a creator's avatar on her own
  // domain is not a third party — is not needed here, and the assertion is simply "none".
  let seen = 0;
  for (const handle of ['specimen-rich', 'specimen-assets', 'specimen-plain']) {
    const body = markup(renderCardHTML(read(handle), { handle, cardUrl: `https://${handle}.test` }));
    assert.ok(!/icons\.duckduckgo\.com/.test(body), `${handle} still points at the favicon service`);
    for (const m of body.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)) {
      assert.fail(`${handle} loads an absolute image on page load: ${m[1].slice(0, 60)}`);
    }
    seen += (body.match(/\/_icon\//g) || []).length;
  }
  // 🔴 CONTROL: if the specimens had no marks at all, the assertions above would pass on nothing.
  assert.ok(seen > 20, `only ${seen} proxied marks across three specimens — the probe is not seeing them`);
});

test('🔴 the route is not an open proxy', () => {
  for (const bad of [
    'evil.example.com/../../secret', 'localhost', '127.0.0.1', 'a', 'no-dot',
    'user@evil.com', 'evil.com:8080', 'http://evil.com', 'EVIL.COM', '-lead.com',
    'trail-.com', '.com', 'x'.repeat(300) + '.com', '169.254.169.254',
  ]) {
    assert.equal(ICON_DOMAIN_RE.test(bad), false, `accepted ${bad}`);
  }
  // 🔴 A three-label host is in here on purpose — the regex has to accept `sub.domain.tld`, and the
  // case that made this test exist was a creator's own subdomain. It is a made-up one now: a
  // customer's host sitting in a public test reads as an example, and it is not ours to publish.
  for (const ok of ['instagram.com', 'www.facebook.com', 'shop.example.co.uk', 'store.line.me', 'x.com']) {
    assert.equal(ICON_DOMAIN_RE.test(ok), true, `rejected ${ok}`);
  }
});

test('the mark still comes from the brand, so it cannot go stale', () => {
  // The point of proxying rather than bundling: an icon set has to be re-packaged when someone
  // rebrands and covers only the brands it happens to include. This still resolves the brand's
  // CURRENT favicon — we only changed who makes the request.
  assert.equal(iconUpstream('x.com'), 'https://icons.duckduckgo.com/ip3/x.com.ico');
  assert.equal(iconPath('x.com'), '/_icon/x.com.ico');
});

test('a fallback candidate is proxied too — the chain must not leak on its second step', () => {
  // 🔴 The failure this exists for: the primary URL gets fixed, the `data-iconfallback` list keeps
  // absolute third-party URLs, and the leak simply moves one step later where nobody looks.
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    '- [ ] %% card: link w=6 %% [Sub](https://shop.example.co.uk/x)'].join('\n');
  const body = markup(renderCardHTML(md, { handle: 't' }));
  const fb = /data-iconfallback="([^"]*)"/.exec(body);
  assert.ok(fb, 'setup: this link should produce a fallback candidate');
  assert.ok(!/https?:\/\//.test(fb[1]), `fallback chain still absolute: ${fb[1]}`);
  assert.match(fb[1], /^\/_icon\//);
});
