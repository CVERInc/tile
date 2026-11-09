// Source spans for an editing preview: `parseSite(md, { sourceLines: true })` makes both renderers
// stamp what they draw from a prose body with `data-src="<first>-<last>"` (0-based, inclusive lines
// of the page Markdown). The text-edit coral anchors on them (dynamic-corals/text-edit).
//   run: node --test packages/sitetile/source-spans.test.mjs
//
// 🔴 Without the option every output is byte-identical to before; the goldens and the Astro smoke
// pin the production path, and the first test here pins the switch itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from './site-core.js';
import { emitProse } from '../emit/prose.mjs';

const PAGE = [
  '---', 'title: T', '---', '',              // 0-3
  '## About', '',                            // 4-5
  'Same<!-- note -->', '',                   // 6-7
  '- Same', '  - Extra', '- Same', '',       // 8-11
  '# Big', '',                               // 12-13
  'Soft', 'wrapped', '',                     // 14-16
  '> quote', 'after quote', '',              // 17-19
  '## Grid', '%% sitetile: grid %%', '',     // 20-22
  '### C', 'x', '',                          // 23-25
  '## Typed', '%% sitetile: prose align=left %%', '', '', // 26-29
  'After type', '',                          // 30-31
  // last: a `~~~` inside a backtick fence does not close it (parseSite's own section split does
  // toggle on it, so anything after this would stay in this section — that is the parser's rule)
  '```', '~~~', 'Same', '```', '',           // 32-36
  'after fence',                             // 37
].join('\n');
const spans = (html) => [...html.matchAll(/<(\w+)[^>]*\sdata-src="(\d+-\d+)"[^>]*>([^<]*)/g)].map((m) => m[1] + ' ' + m[2] + ' ' + m[3]);

test('without the option nothing changes: no field, no attribute, identical HTML', () => {
  assert.ok(parseSite(PAGE).sections.every((s) => !('srcLines' in s)));
  const plain = renderSiteToHtml(parseSite(PAGE));
  assert.doesNotMatch(plain, /data-src/);
  assert.equal(renderSiteToHtml(parseSite(PAGE, {})), plain);
  assert.equal(renderSiteToHtml(parseSite(PAGE, { sourceLines: false })), plain);
  // with the option, removing the stamps gives back exactly the production HTML
  assert.equal(renderSiteToHtml(parseSite(PAGE, { sourceLines: true })).replace(/ data-src="\d+-\d+"/g, ''), plain);
});

test('every prose block carries the page lines it was drawn from', () => {
  const site = parseSite(PAGE, { sourceLines: true });
  assert.deepEqual(site.sections.map((s) => s.srcLines), [{ head: 4, body: 6 }, { head: 20, body: 23 }, { head: 26, body: 30 }]);
  const lines = PAGE.split('\n');
  assert.deepEqual(spans(renderSiteToHtml(site)), [
    'h1 4-4 About',
    'p 6-6 Same',              // the comment vanished from the words, not from the span
    'li 8-8 Same',             // a parent item: its own line only, the child list is separate
    'li 9-9 Extra',
    'li 10-10 Same',
    'h1 12-12 Big',
    'p 14-15 Soft wrapped',    // a soft-wrapped paragraph spans both lines
    'p 18-18 after quote',     // the quote's own text is unstamped
    'h2 26-26 Typed',
    'p 30-30 After type',      // past the type line and two blank lines
    'p 37-37 after fence',     // the fence's `Same` is code: no stamp
  ]);
  for (const s of spans(renderSiteToHtml(site))) {
    const [, span] = s.split(' ');
    const [a] = span.split('-').map(Number);
    assert.ok(lines[a].trim(), 'a span starts on a written line: ' + s);
  }
});

test('the Astro emitter stamps the same spans, and nothing without them', () => {
  const plainSite = parseSite(PAGE), site = parseSite(PAGE, { sourceLines: true });
  const plain = emitProse(plainSite.sections[0], {}, { hero: true });
  assert.doesNotMatch(plain, /data-src/);
  const stamped = emitProse(site.sections[0], {}, { hero: true });
  assert.equal(stamped.replace(/ data-src="\d+-\d+"/g, ''), plain);
  assert.deepEqual(spans(stamped), spans(renderSiteToHtml(site)).filter((s) => +s.split(' ')[1].split('-')[0] < 20));
});
