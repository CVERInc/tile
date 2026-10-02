// Archive month links need their own year, even when their year group is collapsed.
// Run: node packages/sitetile/archive-month-names.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Evaluate the actual anchor's two copy expressions with real sidebarCopy data. This is a
// focused template binding check, not an Astro build or a browser accessibility-tree test.
function monthCopyExpressions(component) {
  const source = readFileSync(new URL(`./astro/src/components/${component}.astro`, import.meta.url), 'utf8')
    .replace(/<!--[^]*?-->/g, '').replace(/\{\/\*[^]*?\*\/\}/g, '');
  const anchors = [...source.matchAll(/<a\b[^]*?<\/a>/g)]
    .map(([anchor]) => anchor).filter((anchor) => anchor.includes('?ym='));
  if (anchors.length !== 1) throw new Error(`${component}: expected one archive month anchor, got ${anchors.length}`);
  const anchor = anchors[0];
  const visible = />\s*\{([^{}]+)\}\s*<\/a>/.exec(anchor)?.[1];
  if (!visible) throw new Error(`${component}: cannot read the month link's visible expression`);
  const label = /\baria-label=\{([^{}]+)\}/.exec(anchor)?.[1];
  const evaluate = (expression, copy, month) => Function('sideCopy', 'm', `return (${expression});`)(copy, month);
  return (copy, month) => {
    const text = evaluate(visible, copy, month);
    return [label ? evaluate(label, copy, month) : text, text];
  };
}

let passed = 0;
for (const component of ['PostView', 'BlogIndexView', 'ArchiveView']) {
  try {
    const render = monthCopyExpressions(component);
    const actual = cases.map(([lang]) => months.map((month) => render(sidebarCopy({ lang }), month)));
    assert.deepEqual(actual, cases.map(([, expected]) => expected),
      `${component}: names include the localized year, month and count; visible copy stays unchanged`);
    passed++;
    console.log(`  PASS ${component}: archive month names and visible copy`);
  } catch (error) {
    console.error(`  FAIL ${component}: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed} passed`);
