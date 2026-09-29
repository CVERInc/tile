// `tagcloud` coral link parsing (tile#78) — plain Node, zero framework, same shape as the sibling
// `links` blogroll suite (links-coral.test.mjs, tile#77).
//   run: node packages/sitetile/tagcloud-coral.test.mjs
//
// 🩸 tagcloudLinks used to cut a markdown link destination at its first `)` (`/\[([^\]]+)\]\(([^)]+)\)/g`),
// so a Wikipedia-style URL with a balanced parenthetical (`…/wiki/Coral_(disambiguation)`) was
// truncated one character short of its real destination, and — the case that actually matters — a
// `javascript:alert(1)` destination was split at its own `)` into a dangling fragment instead of
// reaching the scheme gate whole. PR #77 fixed the same defect in `linksParts` (RE_LINK_ITEM: one
// level of balanced parentheses); this pins the mirrored fix in `tagcloudLinks`, sharing the same
// `RE_URL_BALANCED_PARENS_SRC` fragment rather than a second, independently-drifting regex.

import assert from 'node:assert/strict';
import { parseSite, renderSiteToHtml, tagcloudLinks, takeDropWarnings } from './site-core.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const page = (body) =>
  '---\nsitetile-page: home\ntitle: T\n---\n\n## Tags\n%% sitetile: tagcloud %%\n' + body.join('\n') + '\n';
function tagcloudHtml(md) {
  const html = renderSiteToHtml(parseSite(md));
  const m = /<section class="st-tagcloud"[^>]*>[\s\S]*?<\/section>/.exec(html);
  assert.ok(m, 'no st-tagcloud section rendered:\n' + html);
  return m[0];
}

test('🔴 a balanced-paren URL (Wikipedia style) is kept WHOLE, not cut at its first )', () => {
  const links = tagcloudLinks('- [Coral](https://en.wikipedia.org/wiki/Coral_(disambiguation))');
  assert.deepEqual(links, [{ label: 'Coral', href: 'https://en.wikipedia.org/wiki/Coral_(disambiguation)' }]);
  const html = tagcloudHtml(page(['- [Coral](https://en.wikipedia.org/wiki/Coral_(disambiguation))']));
  assert.match(html, /<a class="st-tag" href="https:\/\/en\.wikipedia\.org\/wiki\/Coral_\(disambiguation\)">Coral<\/a>/);
});

test('an UNBALANCED trailing ) still ends the URL (only one level of balance is admitted)', () => {
  // `[^()\s]|\([^()\s]*\))+` matches "https://example.com/a" then the destination-closing `)`,
  // leaving the stray `)b)` outside the link entirely — same behavior as linksParts.
  const links = tagcloudLinks('- [Bad](https://example.com/a)b)');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com/a');
});

test('🔴 a javascript:alert(1)-wrapped URL is still neutralized — not split at the first ) into something that passes the scheme check', () => {
  takeDropWarnings();
  // Before the fix, tagcloudLinks captured "javascript:alert(1" (missing its closing paren) for
  // this one, cut at the FIRST `)` inside the destination. That truncated string still happened to
  // keep a `javascript:` prefix (so isSafeHref still rejected it here) — but the split itself is the
  // defect PR #77 closed for linksParts: the destination handed to the scheme gate must be the
  // author's whole string, not whatever a naive `)`-terminated regex left over. Assert on the
  // COMPLETE, un-mangled destination and that it is still refused.
  const links = tagcloudLinks('- [XSS](javascript:alert(1))');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'javascript:alert(1)', 'the destination must reach the scheme gate whole');
  const html = tagcloudHtml(page(['- [XSS](javascript:alert(1))']));
  assert.doesNotMatch(html, /<a\b/, 'no anchor at all:\n' + html);
  assert.match(html, /<span class="st-tag">XSS<\/span>/);
  assert.ok(takeDropWarnings().length >= 1, 'the rejected destination is reported to the author');
});

test('CONTROL: multiple tags in one list still parse in order, each getting its own href', () => {
  const html = tagcloudHtml(page([
    '- [Bad tag](javascript:void(0))',
    '- [Good tag](/safe-tag)',
    '- [Protocol-relative tag](//example.test/x)',
  ]));
  assert.match(html, /<span class="st-tag">Bad tag<\/span>/);
  assert.match(html, /<a class="st-tag" href="\/safe-tag">Good tag<\/a>/);
  assert.match(html, /<a class="st-tag" href="\/\/example\.test\/x">Protocol-relative tag<\/a>/);
});

console.log(`\n${passed} passed`);
