// parseBlurb — the preview landing's one line of copy, which belongs to the book.
//
// 🩸 This exists because the first version of the feature could not hold the sentence it was built
// to carry. A separate label/href pair can only put the link at the END of the line, and the line
// it replaced had words on BOTH sides of it. Nothing would have failed: the page would have
// rendered, the tests would have passed, and an author's sentence would quietly have come out
// different. So the control that matters here is not "a link renders", it is "text after the link
// survives".
import { parseBlurb } from './astro/src/lib/pagetile.mjs';

let pass = 0;
const fail = [];
const t = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass += 1;
  else fail.push(`${name}\n     got  ${g}\n     want ${w}`);
};

// The specimen: the SHAPE of the line this feature was extracted from — text, link, text.
t('words on both sides of the link',
  parseBlurb('Free preview — chapters 1–6. New chapters land on [the studio page](https://example.com/studio) first.'),
  { before: 'Free preview — chapters 1–6. New chapters land on ',
    link: { label: 'the studio page', href: 'https://example.com/studio' },
    after: ' first.' });

t('no link at all', parseBlurb('Free preview — the first chapters.'),
  { before: 'Free preview — the first chapters.', link: null, after: '' });

t('link only', parseBlurb('[Read on](/blocks)'),
  { before: '', link: { label: 'Read on', href: '/blocks' }, after: '' });

t('a fragment href is allowed', parseBlurb('Jump to [chapters](#pv-toc) now.'),
  { before: 'Jump to ', link: { label: 'chapters', href: '#pv-toc' }, after: ' now.' });

// Absent/blank must be indistinguishable — the template's `{blurb && …}` is the only gate, so a
// blank string that became `{ before: '' }` would render an empty <p> forever.
t('empty is null', parseBlurb(''), null);
t('whitespace is null', parseBlurb('   \n '), null);
t('undefined is null', parseBlurb(undefined), null);

// Only the FIRST link is special; a second one is left as literal text rather than half-parsed.
t('a second link stays literal',
  parseBlurb('See [a](/a) and [b](/b).'),
  { before: 'See ', link: { label: 'a', href: '/a' }, after: ' and [b](/b).' });

// The site owner controls this file, but the renderer emits the anchor — a javascript: URL in our
// output is our failure. Degrade to plain text, never to a live link.
for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
  t(`unsafe scheme stays text: ${bad}`,
    parseBlurb(`Go [here](${bad}) now.`),
    { before: `Go [here](${bad}) now.`, link: null, after: '' });
}

// Control: prove the safety check can distinguish, rather than rejecting everything.
t('control — https survives the same check',
  parseBlurb('Go [here](https://example.com) now.'),
  { before: 'Go ', link: { label: 'here', href: 'https://example.com' }, after: ' now.' });

if (fail.length) {
  console.error(`\n✗ pagetile blurb: ${fail.length} FAILED\n  - ${fail.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`✅ pagetile blurb all pass (${pass})`);
