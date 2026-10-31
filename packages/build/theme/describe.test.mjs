// describeTheme — the vocabulary as data, for someone holding THIS package: it must name only what
// this package provides (the CLI, the library), and agree with the schema it describes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeTheme } from './index.js';
import { TOKENS, TREATMENTS, META_KEYS, describeThemeGrammar, parseThemeDoc, structuralIssues, sanitizeThemeMeta } from './theme-schema.js';

const HOSTED_ONLY = /set_theme|custom_css_edit|verifyTheme|describe_page_grammar|describe_theme_grammar|get_tool_docs|edit_appearance|GAIDO|feelreef|ejecta|embed coral|`embed`/i;

test('🔴 the public description names no tool this package does not ship', () => {
  const text = JSON.stringify(describeTheme());
  const hit = HOSTED_ONLY.exec(text);
  assert.equal(hit, null, `describeTheme() mentions ${hit && hit[0]}`);
  // control: the hosted editor's own description DOES carry them, so the regex can see them
  assert.match(JSON.stringify(describeThemeGrammar()), HOSTED_ONLY);
});

test("it points at this package's own doors", () => {
  const d = describeTheme();
  assert.match(d.compile.cli, /packages\/build\/theme\/cli\.mjs/);
  assert.match(d.compile.library, /compileTheme/);
});

test('it describes every key the schema accepts, and nothing else', () => {
  const d = describeTheme();
  assert.deepEqual(d.tokens.map((t) => t.key), TOKENS.map((t) => t.stem));
  assert.deepEqual(d.treatments.map((t) => t.key), TREATMENTS.map((t) => t.key));
  for (const t of d.treatments) assert.deepEqual(t.values, TREATMENTS.find((x) => x.key === t.key).values);
  assert.deepEqual(Object.keys(d.meta).sort(), [...META_KEYS].sort());
});

test('its worked example is a clean theme: no issue, nothing dropped', () => {
  const { meta } = parseThemeDoc(describeTheme().example);
  assert.deepEqual(structuralIssues(meta), []);
  assert.deepEqual(sanitizeThemeMeta(meta).dropped, []);
});

test('the hosted description is untouched (an editor serves it verbatim)', () => {
  const g = describeThemeGrammar();
  assert.match(g.purpose, /^A site's visual identity as a structured, born-valid, portable document\. Use set_theme to write it/);
});
