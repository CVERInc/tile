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
import { parseSite, serializeSite, renderSiteToHtml, tagcloudLinks, takeDropWarnings } from './site-core.js';

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

// ── legacy raw-whitespace addresses (read old, write current) ─────────────────────────────────────
// Old content carries `- [Label](/a b)`. The strict grammar still refuses raw whitespace; the reader
// yields the destination browsers used to build: trimmed, interior space/tab percent-encoded.
// The Astro component (Tagcloud.astro) calls this same tagcloudLinks and gates through safeHref; its
// harness needs the renderer's node_modules, so it is exercised here through the shared function.

test('legacy: a raw space inside the address is encoded as %20', () => {
  assert.deepEqual(tagcloudLinks('- [Two words](/tags/two words)'), [{ label: 'Two words', href: '/tags/two%20words' }]);
  assert.match(tagcloudHtml(page(['- [Two words](/tags/two words)'])), /<a class="st-tag" href="\/tags\/two%20words">Two words<\/a>/);
});

test('legacy: a raw tab is removed, as browsers do (not encoded)', () => {
  assert.deepEqual(tagcloudLinks('- [T](/a\tb)'), [{ label: 'T', href: '/ab' }]);
  assert.equal(new URL('/a\tb', 'http://example.com/').pathname, '/ab');
  assert.deepEqual(tagcloudLinks('- [T](/a\t b)'), [{ label: 'T', href: '/a%20b' }]);
});

test('legacy: whitespace surrounding the address inside the parentheses is trimmed', () => {
  assert.deepEqual(tagcloudLinks('- [S](  /a b \t)'), [{ label: 'S', href: '/a%20b' }]);
  assert.deepEqual(tagcloudLinks('- [S](  /a  )'), []); // no interior whitespace: not a legacy shape, stays unreadable
});

test('CONTROL: an already-encoded %20 address is unchanged', () => {
  assert.deepEqual(tagcloudLinks('- [E](/a%20b)'), [{ label: 'E', href: '/a%20b' }]);
});

test('legacy: raw whitespace with balanced parentheses keeps the parentheses', () => {
  assert.deepEqual(tagcloudLinks('- [W](https://example.com/wiki/Coral (disambiguation))'),
    [{ label: 'W', href: 'https://example.com/wiki/Coral%20(disambiguation)' }]);
  assert.deepEqual(tagcloudLinks('- [W](https://example.com/a b/Coral_(x))'),
    [{ label: 'W', href: 'https://example.com/a%20b/Coral_(x)' }]);
});

test('legacy: raw whitespace followed by a trailing unbalanced ) ends the address at that )', () => {
  assert.deepEqual(tagcloudLinks('- [U](/a b)c)'), [{ label: 'U', href: '/a%20b' }]);
});

test('🔴 legacy: javascript: with embedded whitespace is still neutralized and still recorded', () => {
  takeDropWarnings();
  const links = tagcloudLinks('- [X](javascript:alert(1) x)');
  assert.deepEqual(links, [{ label: 'X', href: 'javascript:alert(1)%20x' }]);
  const html = tagcloudHtml(page(['- [X](javascript:alert(1) x)']));
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /<span class="st-tag">X<\/span>/);
  assert.ok(takeDropWarnings().some((w) => w.scheme === 'javascript:'));
});

test('unreadable: a link-shaped line that still yields no tag is recorded, and neighbours render in order', () => {
  takeDropWarnings();
  const html = tagcloudHtml(page([
    '- [First](/one)',
    '- [Broken](/a(b(c)))',
    '- [Blank]()',
    '- [Odd](/a\u00a0b c)',
    '- [Last](/two)',
  ]));
  const hrefs = [...html.matchAll(/<a class="st-tag" href="([^"]*)">([^<]*)</g)].map((x) => x[2] + '=' + x[1]);
  assert.deepEqual(hrefs, ['First=/one', 'Last=/two']);
  const w = takeDropWarnings();
  assert.equal(w.length, 3);
  assert.ok(w.every((x) => x.scheme === '(tagcloud-unreadable)' && Object.keys(x).sort().join() === 'dest,page,scheme'));
  assert.ok(w[0].dest.includes('[Broken]') && w[1].dest.includes('[Blank]') && w[2].dest.includes('[Odd]'));
});

test('unreadable: prose and lines without link-item shape are not recorded; a readable line records nothing', () => {
  takeDropWarnings();
  tagcloudLinks('Some intro\n- plain item\n- [NoAddress]\n- [Ok](/ok)\n- [Legacy](/a b)', { report: true });
  assert.deepEqual(takeDropWarnings(), []);
});

test('mixed line: a legacy leading item and a strict item on one line both render, in order', () => {
  assert.deepEqual(tagcloudLinks('- [A](/a b) [C](/c)'),
    [{ label: 'A', href: '/a%20b' }, { label: 'C', href: '/c' }]);
  assert.deepEqual(tagcloudLinks('- [A](/a b) — see [C](/c)'),
    [{ label: 'A', href: '/a%20b' }, { label: 'C', href: '/c' }]);
  const html = tagcloudHtml(page(['- [A](/a b) — see [C](/c)']));
  assert.equal((html.match(/class="st-tag"/g) || []).length, 2);
});

test('mixed line: an unreadable leading item is recorded while the strict item on the line stays', () => {
  takeDropWarnings();
  const html = tagcloudHtml(page(['- [A](/a(b(c))) [C](/c)']));
  assert.equal((html.match(/class="st-tag"/g) || []).length, 1);
  const w = takeDropWarnings();
  assert.equal(w.length, 1);
  assert.ok(w[0].dest.includes('[A]'));
});

test('a strict match nested inside a legacy item is not counted twice', () => {
  assert.deepEqual(tagcloudLinks('- [A](/a [x](/y) b)'), [{ label: 'A', href: '/a%20[x](/y)%20b' }]);
});

test('direct tagcloudLinks calls record nothing; only the render path reports', () => {
  takeDropWarnings();
  tagcloudLinks('- [Broken](/a(b(c)))\n- [Blank]()');
  assert.deepEqual(takeDropWarnings(), []);
  tagcloudHtml(page(['- [Broken](/a(b(c)))']));
  assert.equal(takeDropWarnings().length, 1);
});

test('unreadable: lost items on other shapes are each recorded; rendered items are not; direct calls record nothing', () => {
  const cases = [
    ['- [A](/a) [B](/b c)', ['A=/a'], ['[B](/b c)']],
    ['- [A](/a b) [C](/c d)', ['A=/a%20b'], ['[C](/c d)']],
    ['1. [A](/a b)', [], ['[A](/a b)']],
    ['- **[A](/a b)**', [], ['[A](/a b)**']],
    ['- [x] [A](/a b)', [], ['[A](/a b)']],
    ['[A](/a b)', [], ['[A](/a b)']],
  ];
  for (const [line, tags, lost] of cases) {
    takeDropWarnings();
    assert.deepEqual(tagcloudLinks(line).map((t) => t.label + '=' + t.href), tags, line);
    assert.deepEqual(takeDropWarnings(), [], 'direct call records nothing: ' + line);
    assert.deepEqual(tagcloudLinks(line, { report: true }).map((t) => t.label + '=' + t.href), tags, line);
    const w = takeDropWarnings();
    assert.deepEqual(w.map((x) => x.dest), lost, line);
    assert.ok(w.every((x) => x.scheme === '(tagcloud-unreadable)' && x.dest.length <= 201));
  }
});

test('old-content rebuild: a whole page with raw-space tags renders every tag and round-trips byte-for-byte', () => {
  takeDropWarnings();
  const lines = ['- [Alpha](/tags/alpha)', '- [Beta tag](/tags/beta tag)', '- [Gamma](  /tags/gamma\tx  )', '- [Delta](/tags/delta%20d)'];
  const md = page(lines);
  const site = parseSite(md);
  assert.equal(serializeSite(site), md);
  const html = tagcloudHtml(md);
  assert.equal((html.match(/class="st-tag"/g) || []).length, lines.length);
  assert.match(html, /href="\/tags\/beta%20tag"/);
  assert.match(html, /href="\/tags\/gammax"/);
  assert.deepEqual(takeDropWarnings(), []);
});

test('linear time: a long run of whitespace and of brackets stays fast', () => {
  const t = Date.now();
  tagcloudLinks('- [A](' + ' '.repeat(200000) + '/x' + ' '.repeat(200000) + 'y)');
  tagcloudLinks(('- [A](' + '('.repeat(50) + '\n').repeat(2000));
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + 'ms');
  takeDropWarnings();
});

test('linear time: a 1 MiB body of mostly legacy raw-space lines finishes under an absolute backstop', () => {
  const line = '- [a](/b c)\n';
  let body = '';
  for (let i = 0; i * line.length < 1024 * 1024; i++) body += i % 10 === 0 ? '- [s](/s' + i + ')\n' : line;
  const t0 = Date.now();
  const n = tagcloudLinks(body).length;
  const ms = Date.now() - t0;
  assert.equal(n, body.split('\n').length - 1);
  assert.ok(ms < 5000, 'took ' + ms + 'ms (a quadratic de-dup took over 120s)');
});

console.log(`\n${passed} passed`);
