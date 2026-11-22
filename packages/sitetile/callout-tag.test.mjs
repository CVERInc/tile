// An Obsidian callout tag line is never printed as text.
//   run: node --test packages/sitetile/callout-tag.test.mjs   (globbed by scripts/test.sh)
//
// Obsidian (and GitHub, for its five alert types) reads a quote block whose FIRST line opens with
// `[!type]` as a callout:
//
//     > [!note]
//     > The body.
//
// The renderer has no callout design, and this does not add one. What it must not do is print the
// tag: `[!note]` used to land in the paragraph as literal text, joined onto the body. The block now
// renders as the same plain `st-quote` blockquote, with the tag line removed and the type kept as a
// class (`st-callout-<type>`) so a stylesheet can pick it up later. A title written after the tag
// (`> [!note] Title`) is the author's own text and stays, as its own paragraph. A fold marker
// (`[!note]-` / `[!note]+`) is an interaction this renderer does not have, and is dropped with the tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyHtml } from './site-core.js';

test('callout: the tag line is removed and the type becomes a class', () => {
  assert.equal(bodyHtml('> [!vertical]\n> A line set apart.'),
    '<blockquote class="st-quote st-callout-vertical"><p>A line set apart.</p></blockquote>');
});

test('callout: GitHub-style upper-case type is read the same way, class lower-cased', () => {
  assert.equal(bodyHtml('> [!NOTE]\n> body'),
    '<blockquote class="st-quote st-callout-note"><p>body</p></blockquote>');
});

test('callout: a title after the tag stays, as its own paragraph', () => {
  assert.equal(bodyHtml('> [!tip] Before you start\n> body one\n>\n> body two'),
    '<blockquote class="st-quote st-callout-tip"><p>Before you start</p><p>body one</p><p>body two</p></blockquote>');
});

test('callout: a fold marker is dropped with the tag', () => {
  assert.equal(bodyHtml('> [!faq]-\n> hidden'),
    '<blockquote class="st-quote st-callout-faq"><p>hidden</p></blockquote>');
  assert.equal(bodyHtml('> [!faq]+ Open title\n> shown'),
    '<blockquote class="st-quote st-callout-faq"><p>Open title</p><p>shown</p></blockquote>');
});

test('callout: a tag with nothing under it emits no empty shell (as an empty quote does not)', () => {
  assert.equal(bodyHtml('> [!note]'), '');
});

test('callout: only the FIRST line is a tag; anywhere else it is text', () => {
  assert.equal(bodyHtml('> first\n> [!note] later'),
    '<blockquote class="st-quote"><p>first [!note] later</p></blockquote>');
});

test('callout: shapes that are not a callout tag render exactly as before', () => {
  for (const [md, html] of [
    ['> [!] x', '<blockquote class="st-quote"><p>[!] x</p></blockquote>'],
    ['> [!1abc] x', '<blockquote class="st-quote"><p>[!1abc] x</p></blockquote>'],
    ['> [!note]x', '<blockquote class="st-quote"><p>[!note]x</p></blockquote>'],
    ['> [note] x', '<blockquote class="st-quote"><p>[note] x</p></blockquote>'],
    ['> a quote', '<blockquote class="st-quote"><p>a quote</p></blockquote>'],
  ]) assert.equal(bodyHtml(md), html, md);
});

test('callout: each block in a run is judged on its own; a dialogue beside it is untouched', () => {
  const html = bodyHtml('> [!warning]\n> careful\n\n> plain');
  assert.equal(html,
    '<blockquote class="st-quote st-callout-warning"><p>careful</p></blockquote>\n' +
    '<blockquote class="st-quote"><p>plain</p></blockquote>');
  const talk = bodyHtml('> **ANA**\n> hello\n\n> [!note]\n> aside');
  assert.ok(talk.includes('st-dialogue'), 'the turn is still a turn');
  assert.ok(talk.includes('<blockquote class="st-quote st-callout-note"><p>aside</p></blockquote>'), talk);
  assert.ok(!talk.includes('[!note]'), 'no literal tag');
});
