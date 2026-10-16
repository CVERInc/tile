// A heading line in a text cell is its own block, wherever it sits in the paragraph.
//
//   node --test packages/cardtile/card-prose-heading.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCardHTML } from './serve/card-worker.mjs';

// The cell body is tab-indented under its `- [ ]` item, exactly as a saved card carries it.
const cell = (body) => {
  const md = '---\ncard-page: t\ntitle: T\n---\n\n## grid\n\n- [ ] %% card: text %%\n' +
    body.split('\n').map((l) => '\t' + l).join('\n') + '\n';
  const m = /data-coral-type="text">(.*?)<\/div>/s.exec(renderCardHTML(md, { handle: 't', cardUrl: 'https://t.example/' }));
  assert.ok(m, 'the text cell rendered');
  return m[1];
};

test('a heading followed by a line is <h5> then <p>, not a literal ### in a <p>', () => {
  assert.equal(cell('### Hotel One\n200 Example Road'), '<h5>Hotel One</h5><p>200 Example Road</p>');
});

test('several heading + line pairs in one paragraph each get their own block', () => {
  assert.equal(
    cell('### A\nline a1\nline a2\n## B\nline b'),
    '<h5>A</h5><p>line a1<br>line a2</p><h4>B</h4><p>line b</p>',
  );
});

test('a single-line heading is unchanged', () => {
  assert.equal(cell('# Only'), '<h3>Only</h3>');
});

test('a plain multi-line paragraph still joins with <br>', () => {
  assert.equal(cell('one\ntwo\nthree'), '<p>one<br>two<br>three</p>');
});

test('text before a heading in the same paragraph stays a <p>', () => {
  assert.equal(cell('intro\n### H\nafter'), '<p>intro</p><h5>H</h5><p>after</p>');
});
