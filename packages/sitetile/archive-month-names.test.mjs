// Archive month links need their own year, even when their year group is collapsed.
// Run: node packages/sitetile/archive-month-names.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { sidebarCopy } from './astro/src/lib/chrome-copy.mjs';

const months = [
  { year: '2023', month: '02', count: 7 },
  { year: '2024', month: '02', count: 7 },
  { year: '2024', month: '11', count: 3 },
];
const english = [
  ['February 2023 (7)', 'February (7)'],
  ['February 2024 (7)', 'February (7)'],
  ['November 2024 (3)', 'November (3)'],
];
const chinese = [
  ['2023 年 2 月（7）', '2月（7）'],
  ['2024 年 2 月（7）', '2月（7）'],
  ['2024 年 11 月（3）', '11月（3）'],
];
const cases = [
  ['en-US', english],
  ['ja-JP', [['2023年2月（7）', '2月（7）'], ['2024年2月（7）', '2月（7）'], ['2024年11月（3）', '11月（3）']]],
  ['zh-TW', chinese],
  ['ko-KR', [['2023년 2월 (7)', '2월 (7)'], ['2024년 2월 (7)', '2월 (7)'], ['2024년 11월 (3)', '11월 (3)']]],
  ['zh-Hant', chinese],
  [undefined, english],
];

// Discover every Astro template containing month links, including nested routes.
function monthTemplates(directory = new URL('./astro/src/', import.meta.url), prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(entry.name, directory);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return monthTemplates(new URL(`${entry.name}/`, directory), `${name}/`);
    if (!entry.name.endsWith('.astro')) return [];
    const source = readFileSync(file, 'utf8')
      .replace(/<!--[^]*?-->/g, '').replace(/\{\/\*[^]*?\*\/\}/g, '');
    const anchors = [...source.matchAll(/<a\b[^>]*\?ym=[^]*?<\/a>/g)]
      .map(([anchor]) => anchor);
    return anchors.length ? [{ name, anchors }] : [];
  });
}

// Evaluate each actual anchor's copy expressions with real sidebarCopy data. This is a
// focused template binding check, not an Astro build or a browser accessibility-tree test.
function monthCopyExpressions(anchor, name) {
  const visible = />\s*\{([^{}]+)\}\s*<\/a>/.exec(anchor)?.[1];
  if (!visible) throw new Error(`${name}: cannot read the month link's visible expression`);
  const label = /\baria-label=\{([^{}]+)\}/.exec(anchor)?.[1];
  assert.ok(label, `${name}: every month link has an explicit aria-label`);
  assert.ok(anchor.includes('href={`${blogBase(meta)}?ym=${m.year}-${m.month}`}'),
    `${name}: month links retain their year-month destination`);
  const evaluate = (expression, copy, month) => Function('sideCopy', 'm', `return (${expression});`)(copy, month);
  return (copy, month) => [evaluate(label, copy, month), evaluate(visible, copy, month)];
}

let passed = 0;
const templates = monthTemplates();
console.log(`Discovered ${templates.length} Astro files with archive month links`);
try {
  assert.ok(templates.length >= 5, `expected at least 5 archive month templates, got ${templates.length}`);
  passed++;
  console.log('  PASS archive month template coverage');
} catch (error) {
  console.error(`  FAIL archive month template coverage: ${error.message}`);
  process.exitCode = 1;
}
for (const { name, anchors } of templates) {
  for (const [index, anchor] of anchors.entries()) {
    const link = `${name} link ${index + 1}`;
    try {
      const render = monthCopyExpressions(anchor, link);
      const actual = cases.map(([lang]) => months.map((month) => render(sidebarCopy({ lang }), month)));
      assert.deepEqual(actual, cases.map(([, expected]) => expected),
        `${link}: names include the localized year, month and count; visible copy stays unchanged`);
      passed++;
      console.log(`  PASS ${link}: archive month names, visible copy and destination`);
    } catch (error) {
      console.error(`  FAIL ${link}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
console.log(`\n${passed} passed`);
