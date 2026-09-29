// `links` coral (blogroll, tile#76) — plain Node, zero framework, same shape as the sibling suites.
//   run: node packages/sitetile/links-coral.test.mjs
//
// What is pinned here: registration + byte-identical round-trip, the card shape, what ZERO items
// renders, hostile text/URLs (a `javascript:` destination never becomes a link; HTML in a name or
// recommendation is escaped), the rel policy for external cards, the degradation contract (nothing
// is fetched, so a dead linked site cannot change the card), and that Links.astro consumes the SAME
// linksParts the reference renderer does.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, serializeSite, renderSiteToHtml, linksParts, KNOWN_TYPES, takeDropWarnings } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = join(HERE, 'astro', 'src', 'components', 'sections');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const page = (typeline, body, title = 'Friends') =>
  '---\nsitetile-page: home\ntitle: T\n---\n\n' + (title ? '## ' + title : '##') + '\n%% sitetile: ' + typeline + ' %%\n' + body.join('\n') + '\n';
// The coral's own <section>, cut out of the full page render.
function linksHtml(md) {
  const html = renderSiteToHtml(parseSite(md));
  const m = /<section class="st-links"[^>]*>[\s\S]*?<\/section>/.exec(html);
  assert.ok(m, 'no st-links section rendered:\n' + html);
  return m[0];
}

const BASIC = page('links', [
  'Sites I read every week.',
  '- [Example Journal](https://www.example.com/essays) — Long-form essays on slow software.',
  '- [Example Notes](https://notes.example.org): A tidy garden of short notes.',
  '- [Our about page](/about)',
]);

test('links is a known coral and round-trips byte-identical', () => {
  assert.ok(KNOWN_TYPES.includes('links'));
  assert.equal(parseSite(BASIC).sections[0].type, 'links');
  assert.equal(serializeSite(parseSite(BASIC)), BASIC);
});

test('each list item becomes a static card: name link, host, recommendation; other lines are the caption', () => {
  const html = linksHtml(BASIC);
  assert.match(html, /<h2>Friends<\/h2>/);
  assert.match(html, /<p>Sites I read every week\.<\/p>/);
  assert.equal((html.match(/<li class="st-link">/g) || []).length, 3);
  assert.match(html, /<a class="st-link-name" href="https:\/\/www\.example\.com\/essays"[^>]*>Example Journal<\/a><span class="st-link-host">example\.com<\/span><p class="st-link-note">Long-form essays on slow software\.<\/p>/);
  // `:` separator works too, and the host keeps a non-www subdomain.
  assert.match(html, /<span class="st-link-host">notes\.example\.org<\/span><p class="st-link-note">A tidy garden of short notes\.<\/p>/);
  // An internal link has no host line and no note when none was written.
  assert.match(html, /<li class="st-link"><a class="st-link-name" href="\/about">Our about page<\/a><\/li>/);
});

test('zero items: heading + caption still render, and there is no empty <ul>', () => {
  const html = linksHtml(page('links', ['Nothing here yet.']));
  assert.match(html, /<h2>Friends<\/h2><p>Nothing here yet\.<\/p><\/section>$/);
  assert.doesNotMatch(html, /st-links-list/);
  // Entirely empty body: a bare heading, still no list.
  const bare = linksHtml(page('links', []));
  assert.equal(bare.replace(/ id="[^"]*"/, ''), '<section class="st-links"><h2>Friends</h2></section>');
  assert.deepEqual(linksParts(''), { caption: '', items: [] });
});

test('🔴 a javascript: destination never becomes a link — the name degrades to plain text', () => {
  takeDropWarnings();
  const html = linksHtml(page('links', [
    '- [Parens](javascript:alert(1)) — split at the first ) would leave a dangling note',
    '- [Upper](JAVASCRIPT:alert(1))',
    '- [Encoded](javascript&#58;alert(1))',
    '- [Data](data:text/html;base64,PHNjcmlwdD4=)',
    '- [Vb](vbscript:msgbox(1))',
  ]));
  assert.doesNotMatch(html, /<a\b/, 'no anchor at all:\n' + html);
  assert.doesNotMatch(html, /javascript|vbscript|data:/i, 'the destination text is not echoed either');
  assert.equal((html.match(/<span class="st-link-name">/g) || []).length, 5);
  assert.doesNotMatch(html, /st-link-host/, 'no host is derived from a rejected destination');
  // The balanced-paren destination was consumed whole, so the note is the author's text only.
  assert.match(html, /<p class="st-link-note">split at the first \) would leave a dangling note<\/p>/);
  assert.ok(takeDropWarnings().length >= 5, 'each rejected destination is reported to the author');
});

test('🔴 CONTROL: the same shape with an https: destination IS a live link', () => {
  const html = linksHtml(page('links', ['- [Parens](https://example.com/wiki/Foo_(bar)) — ok']));
  assert.match(html, /<a class="st-link-name" href="https:\/\/example\.com\/wiki\/Foo_\(bar\)"/);
});

test('🔴 HTML in a name or recommendation is escaped, never live', () => {
  const html = linksHtml(page('links', [
    '- [<img src=x onerror=alert(1)>](https://example.com) — <script>alert(1)</script> and <b>bold</b>',
  ]));
  assert.doesNotMatch(html, /<script|<img|<b>/i, html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('🔴 a quote in the destination cannot break out of the href attribute', () => {
  const html = linksHtml(page('links', ['- [Q](https://example.com/"onmouseover="alert(1)) — x']));
  assert.doesNotMatch(html, /<a\b[^>]*\sonmouseover=/i, html);
  assert.match(html, /href="https:\/\/example\.com\/&quot;onmouseover=&quot;alert\(1\)"/);
});

test('rel: external cards get target=_blank rel="noopener" — no nofollow/ugc/noreferrer; internal get neither', () => {
  const html = linksHtml(BASIC);
  const ext = /<a class="st-link-name" href="https:\/\/www\.example\.com\/essays"([^>]*)>/.exec(html)[1];
  assert.equal(ext, ' target="_blank" rel="noopener"');
  assert.doesNotMatch(html, /nofollow|ugc|noreferrer/);
  const internal = /<a class="st-link-name" href="\/about"([^>]*)>/.exec(html)[1];
  assert.equal(internal, '');
  // Protocol-relative is external too (same `linkKind` rule as every button surface).
  const pr = linksParts('- [PR](//example.net/x)').items[0];
  assert.equal(pr.external, true);
  assert.equal(pr.host, 'example.net');
});

test('degradation contract: rendering never touches the network, so a dead linked site cannot change the card', () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('the links coral must not fetch'); };
  try {
    // `.invalid` can never resolve (RFC 2606) — the stand-in for "the linked site is down".
    const md = page('links', ['- [Gone](https://gone.example.invalid/) — still recommended']);
    const a = linksHtml(md);
    const b = linksHtml(md);
    assert.equal(a, b, 'deterministic: same input → same card');
    assert.match(a, /<a class="st-link-name" href="https:\/\/gone\.example\.invalid\/"[^>]*>Gone<\/a><span class="st-link-host">gone\.example\.invalid<\/span><p class="st-link-note">still recommended<\/p>/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test('Links.astro consumes the same linksParts, and is wired, styled and headed like its siblings', () => {
  const src = readFileSync(join(SECTIONS, 'Links.astro'), 'utf8');
  const code = src.replace(/^\/\/.*$/gm, '');
  assert.match(code, /import \{[^}]*\blinksParts\b[^}]*\} from '@sitetile'/);
  assert.match(code, /linksParts\(section\.body\)/);
  assert.doesNotMatch(code, /safeHref|https\?:/, 'the component must not re-decide safety/externality — linksParts already did');
  assert.match(code, /<section class="st-links" id=\{section\.id\}>/);
  assert.match(code, /class="st-links-list"/);
  assert.match(code, /class="st-link-name"/);
  assert.match(code, /rel=\{it\.external \? 'noopener' : undefined\}/);
  assert.doesNotMatch(code, /nofollow|ugc|noreferrer|fetch\(/);
  const sec = readFileSync(join(HERE, 'astro', 'src', 'components', 'Section.astro'), 'utf8');
  assert.match(sec, /links: Links/);
  const css = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');
  for (const cls of ['st-links-list', 'st-link', 'st-link-name', 'st-link-host', 'st-link-note']) {
    assert.match(css, new RegExp('\\.' + cls + '\\s*\\{'), `.${cls} has no base paint in site.css`);
  }
});

console.log(`\n${passed} passed`);
