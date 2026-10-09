// REEF with Repo Facts — the small decisions, on their own (plain node, zero framework).
//   run: node packages/dynamic-corals/repo-facts/repo-facts-core.test.mjs
//
// Which link is a repository link, and what a usable answer looks like. The behaviour that
// matters most — what happens to a real page — is in repo-facts-page.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { repoOf, checkResponse, SELECTOR, PATH, MAX_REPOS, TIMEOUT_MS, DIAGNOSTICS } from './repo-facts-core.mjs';
import { FIELDS } from './repo-facts-fields.mjs';
import { releaseFields, repoFields } from './repo-facts-worker.mjs';

const GH = 'github.com';

test('a repository link is exactly https://github.com/<owner>/<repo>', () => {
  assert.equal(repoOf('https://github.com/CVERInc/clikae', GH), 'CVERInc/clikae');
  assert.equal(repoOf('https://github.com/CVERInc/clikae/', GH), 'CVERInc/clikae', 'a trailing slash is typing');
  assert.equal(repoOf('https://github.com/CVERInc/clikae.git', GH), 'CVERInc/clikae');
  assert.equal(repoOf('https://github.com/CVERInc/clikae.git/', GH), 'CVERInc/clikae');
  assert.equal(repoOf('https://github.com/CVERInc/obsidian-marktile?tab=readme#install', GH), 'CVERInc/obsidian-marktile');
  assert.equal(repoOf('https://github.com/CVERInc/.github', GH), 'CVERInc/.github');
  assert.equal(repoOf('http://github.com/CVERInc/clikae', GH), 'CVERInc/clikae');
});

test('everything else is not: an owner, a deeper path, another host, a lookalike host', () => {
  for (const href of [
    'https://github.com/CVERInc',
    'https://github.com/',
    'https://github.com/CVERInc/clikae/issues/12',
    'https://github.com/CVERInc/clikae/releases/tag/v0.40.0',
    'https://github.com/CVERInc/clikae/blob/main/README.md',
    'https://gist.github.com/CVERInc/abc123',
    'https://api.github.com/repos/CVERInc',
    'https://github.com.example.net/CVERInc/clikae',
    'https://example.net/github.com/CVERInc/clikae',
    'https://notgithub.com/CVERInc/clikae',
    'https://github.com/CVERInc/cli%20kae',
    'https://github.com/CVERInc/..',
    'https://github.com/CVERInc/%2e%2e',
    'mailto:hi@example.net',
    '/oss/clikae',
    '',
  ]) {
    assert.equal(repoOf(href, GH), '', href);
  }
});

test('with no known forge, nothing is a repository link', () => {
  assert.equal(repoOf('https://github.com/CVERInc/clikae', undefined), '');
  assert.equal(repoOf('https://gitlab.com/acme/tool', GH), '');
});

test('an answer is narrowed to the repos that were asked about; absent ones read as empty', () => {
  const data = { 'a/b': { tag: 'v1.0.0', releasedAt: '2026-01-02' }, 'x/y': { tag: '<b>' } };
  assert.deepEqual(checkResponse(data, ['a/b', 'c/d']), { 'a/b': { tag: 'v1.0.0', releasedAt: '2026-01-02' }, 'c/d': {} });
});

test('null and absent both mean "none", for every field', () => {
  const none = { tag: null, releasedAt: null, pushedAt: null, license: null, archived: null, fullName: null };
  assert.deepEqual(checkResponse({ 'a/b': none }, ['a/b']), { 'a/b': none });
  assert.deepEqual(checkResponse({ 'a/b': {} }, ['a/b']), { 'a/b': {} });
});

test('the shapes that are accepted', () => {
  const kept = (f) => assert.deepEqual(checkResponse({ 'a/b': f }, ['a/b']), { 'a/b': f }, JSON.stringify(f));
  for (const tag of ['v0.40.0', '0.3.3', 'v1.2', '1.2.3.4', 'v2.0.0-rc.1', 'v1.0.0+build.5', '2026.10.07']) kept({ tag });
  for (const license of ['MIT', 'Apache-2.0', 'GPL-3.0-or-later', 'BSD-3-Clause', '0BSD', 'GPL-2.0+']) kept({ license });
  kept({ releasedAt: '2024-02-29', pushedAt: '1999-12-31', archived: true, fullName: 'A_b.c-d/e.f' });
});

test('one wrong field empties ITS repo, whole, and leaves the others as they were', () => {
  const good = { tag: 'v1.0.0', releasedAt: '2026-01-02' };
  for (const bad of [{ ...good, pushedAt: 'recently' }, { ...good, tag: '<b>' }, { ...good, archived: 'yes' }, 'v1.0.0', null, 7, true]) {
    assert.deepEqual(checkResponse({ 'a/b': good, 'c/d': bad }, ['a/b', 'c/d']), { 'a/b': good, 'c/d': {} }, JSON.stringify(bad));
  }
});

test('a repo name is looked up as an own key, never through the prototype', () => {
  const data = Object.create({ 'a/b': { tag: 'v9.9.9' } });
  assert.deepEqual(checkResponse(data, ['a/b']), { 'a/b': {} });
});

test('🔴 one field table for both halves: the edge and the browser cannot disagree about a date', () => {
  // The day the two had a validator each, the edge passed `2026-02-30` and the browser refused it.
  // Now there is one, and this asks each half about the same values through its own front door.
  const days = { '2026-10-07': true, '2024-02-29': true, '2026-02-30': false, '2026-13-01': false, '2026-10-7': false, '2025-02-29': false };
  for (const [day, valid] of Object.entries(days)) {
    assert.equal(FIELDS.releasedAt(day), valid, day);
    const browser = checkResponse({ 'a/b': { tag: 'v1.0.0', releasedAt: day } }, ['a/b'])['a/b'];
    const edge = releaseFields({ tag_name: 'v1.0.0', published_at: `${day}T12:00:00Z` });
    assert.equal('releasedAt' in browser, valid, `browser: ${day}`);
    assert.equal('releasedAt' in edge, valid, `edge: ${day}`);
    assert.equal('pushedAt' in repoFields({ pushed_at: `${day}T12:00:00Z` }), valid, `edge, pushed: ${day}`);
  }
  for (const tag of ['v1.0.0', 'nightly', '1', 'v1.2.3_beta', `v1.0.0-${'a'.repeat(40)}`]) {
    const browser = 'tag' in checkResponse({ 'a/b': { tag } }, ['a/b'])['a/b'];
    assert.equal(browser, 'tag' in releaseFields({ tag_name: tag }), tag);
    assert.equal(browser, FIELDS.tag(tag), tag);
  }
});

test('the constants a page author or a checker can rely on', () => {
  assert.equal(SELECTOR, '[data-dynamic-coral="repo-facts"]');
  assert.equal(PATH, '/v0/repo-facts');
  assert.equal(MAX_REPOS, 30);
  assert.equal(TIMEOUT_MS, 3000);
  assert.equal(DIAGNOSTICS, '__coralDiagnostics');
});
