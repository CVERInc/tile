// Where a `Label=href` item splits — label-eq.mjs states the rule in one sentence. tile-lab#69.
// Before the fix every `Label=href` reader split at the LAST `=`, so a link with a query string was
// cut in two: `Shop=https://x.example/p?id=1#f` rendered as <a href="1#f">Shop=https://x.example/p?id</a>.
//
// Every reader of the syntax goes through one helper (label-eq.mjs, splitLabelEq); this file pins
// each key — and site-core.js's parseSidebarNav, the reference renderer's copy — to it, and holds
// the rule to the old reading wherever the old reading was not a cut link.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  footerColsOf, labelHrefListOf, headerCtaOf, headerActionsOf, sidebarNavOf, parseChromeLinks, withHref,
} from './chrome-links.mjs';
import * as chromeLinks from './chrome-links.mjs';
import * as labelEq from './label-eq.mjs';
import { parseSidebarNav } from './site-core.js';

const Q1 = 'https://shop.example/p?id=1';
const QN = 'https://shop.example/s?a=1&b=2&c=3';
const FRAG = 'https://shop.example/p?id=1#f';
const MAIL = 'mailto:hello@x.example?subject=Hi%20there&body=a=b';
const REL = 'page.html?x=1';

// [item text, expected { label, href }] — the cases the ticket asks for.
const CASES = [
  [`Shop=${Q1}`, { label: 'Shop', href: Q1 }],
  [`Shop=${QN}`, { label: 'Shop', href: QN }],
  [`Shop = ${FRAG}`, { label: 'Shop', href: FRAG }],
  [`Write to us=${MAIL}`, { label: 'Write to us', href: MAIL }],
  [`Call=tel:+1-555-0100`, { label: 'Call', href: 'tel:+1-555-0100' }],
  [`Search=/search?q=a=b`, { label: 'Search', href: '/search?q=a=b' }],
  [`Top=#a=b`, { label: 'Top', href: '#a=b' }],
  [`Net=//cdn.example/x?y=1`, { label: 'Net', href: '//cdn.example/x?y=1' }],
  [`Q=?page=2`, { label: 'Q', href: '?page=2' }],
  [`Rel=${REL}`, { label: 'Rel', href: REL }],
  // a label may still hold `=` where what follows it is not a link target
  ['1+1=2 is math=/math', { label: '1+1=2 is math', href: '/math' }],
  ['a=b=/c', { label: 'a=b', href: '/c' }],
  ['x=y=z', { label: 'x=y', href: 'z' }],
  // a `key=` inside a query stays in the target, even when its value is itself a link
  ['In=/login?next=/home', { label: 'In', href: '/login?next=/home' }],
  ['Share=https://x.example/i?url=https://y.example/a', { label: 'Share', href: 'https://x.example/i?url=https://y.example/a' }],
  ['Rel=page.html?next=/home', { label: 'Rel', href: 'page.html?next=/home' }],
];

// [item, the old (last `=`) reading, the new reading] — each value a review found the first cut of
// this fix reading differently from main, and the shapes around them. A label that held `=` keeps
// it; only a link that was cut changes. (`Label==` stays a link to `=`, as it always was: a relative
// href with no scheme, so nothing a browser could run.)
const ADVERSARIAL = [
  ['C#=F#=/langs', ['C#=F#', '/langs'], ['C#=F#', '/langs']],
  ['Q=A?=/faq', ['Q=A?', '/faq'], ['Q=A?', '/faq']],
  ['2+2=4?=/quiz', ['2+2=4?', '/quiz'], ['2+2=4?', '/quiz']],
  ['Rating=#1=/top', ['Rating=#1', '/top'], ['Rating=#1', '/top']],
  ['x=/y=/z', ['x=/y', '/z'], ['x=/y', '/z']],
  ['Path=/=/root', ['Path=/', '/root'], ['Path=/', '/root']],
  ['Label==', ['Label', '='], ['Label', '=']],
  ['a=b==', ['a=b', '='], ['a=b', '=']],
  ['A=b=', ['A', 'b='], ['A', 'b=']],
  ['Q=?=/faq', ['Q=?', '/faq'], ['Q=?', '/faq']],
  ['Go=/s?a=1&=/x', ['Go=/s?a=1&', '/x'], ['Go=/s?a=1&', '/x']],
  ['a=/b=/c?d=/e', ['a=/b=/c?d', '/e'], ['a=/b', '/c?d=/e']],
  ['Go=/s?next=/a=/b', ['Go=/s?next=/a', '/b'], ['Go', '/s?next=/a=/b']],
  ['Rel=page.html?x=1', ['Rel=page.html?x', '1'], ['Rel', 'page.html?x=1']],
  ['Top=#a=b', ['Top=#a', 'b'], ['Top', '#a=b']],
  ['Q=?page=2', ['Q=?page', '2'], ['Q', '?page=2']],
  ['In=/login?next=/home', ['In=/login?next', '/home'], ['In', '/login?next=/home']],
  ['Mail=mailto:m@x.example?subject=/x', ['Mail=mailto:m@x.example?subject', '/x'], ['Mail', 'mailto:m@x.example?subject=/x']],
];

test('the rule keeps every old reading that was not a cut link, and reads cut links whole', () => {
  const pair = (m) => (m ? [m.label, m.rest] : null);
  for (const [text, was, now] of ADVERSARIAL) {
    assert.deepEqual(pair(labelEq.legacySplitLabelEq(text)), was, `old: ${text}`);
    assert.deepEqual(pair(labelEq.splitLabelEq(text)), now, `new: ${text}`);
    // and every reader agrees, in a list and as a column
    assert.deepEqual(labelHrefListOf(text), [{ label: now[0], href: now[1] }], `list: ${text}`);
    assert.deepEqual(footerColsOf(`H: ${text}`)[0].items, [{ label: now[0], href: now[1] }], `footer-cols: ${text}`);
    assert.deepEqual(parseSidebarNav(`H: ${text}`)[0].items, [{ label: now[0], href: now[1] }], `site-core: ${text}`);
  }
});

test('footer-cols: an item splits at the first `=` that starts a link', () => {
  for (const [text, want] of CASES) {
    assert.deepEqual(footerColsOf(`Links: ${text} ; Plain`)[0].items, [want, { label: 'Plain', href: '' }], text);
    assert.deepEqual(footerColsOf(text)[0].items, [want], `headless: ${text}`);
  }
});

test('footer-social / sidebar-social / breadcrumb-trail / age-gate-note-links: the same split', () => {
  for (const [text, want] of CASES) assert.deepEqual(labelHrefListOf(`${text} ; B=/b`), [want, { label: 'B', href: '/b' }], text);
});

test('header-cta: the same split', () => {
  for (const [text, want] of CASES) assert.deepEqual(headerCtaOf(text), want, text);
});

test('sidebar-nav: the same split, in the module and in site-core.js, and a `^weight` still comes off', () => {
  for (const [text, want] of CASES) {
    const v = `Group: ${text}`;
    assert.deepEqual(sidebarNavOf(v)[0].items, [want], text);
    assert.deepEqual(parseSidebarNav(v)[0].items, [want], `site-core: ${text}`);
  }
  const w = `Tags: Sale=/tag?id=7^14`;
  assert.deepEqual(sidebarNavOf(w)[0].items, [{ label: 'Sale', href: '/tag?id=7', weight: 14 }]);
  assert.deepEqual(parseSidebarNav(w)[0].items, [{ label: 'Sale', href: '/tag?id=7', weight: 14 }]);
});

test('header-actions: a target with a query stays whole; an aria-label may hold `=` before the spec', () => {
  const [a] = headerActionsOf(`Search = magnifier link /search?q=x&l=en mobile`);
  assert.equal(a.label, 'Search');
  assert.equal(a.iconName, 'magnifier');
  assert.equal(a.target, '/search?q=x&l=en');
  assert.equal(a.mobile, true);
  const [b] = headerActionsOf('1+1=2 = cart link /cart');
  assert.deepEqual([b.label, b.iconName, b.type, b.target], ['1+1=2', 'cart', 'link', '/cart']);
});

test('spans: the reported href is the whole link, so a rewrite replaces all of it', () => {
  const v = `Shop: Item=${FRAG} ; B=/b`;
  const [l] = parseChromeLinks('footer-cols', v);
  assert.equal(l.href, FRAG);
  assert.equal(v.slice(l.start, l.end), FRAG);
  assert.equal(withHref('footer-cols', v, l, '/moved/'), 'Shop: Item=/moved/ ; B=/b');
});

test('the writer can now write a query string into a `Label=href` list', () => {
  const v = 'A=/old ; B=/b';
  const out = withHref('footer-social', v, parseChromeLinks('footer-social', v)[0], '/new?x=1&y=2');
  assert.equal(out, 'A=/new?x=1&y=2 ; B=/b');
  assert.deepEqual(labelHrefListOf(out), [{ label: 'A', href: '/new?x=1&y=2' }, { label: 'B', href: '/b' }]);
});

test('splitLabelEq is exported (and re-exported by chrome-links.mjs) and is what decides a link target', () => {
  assert.equal(typeof chromeLinks.splitLabelEq, 'function');
  assert.equal(chromeLinks.splitLabelEq, labelEq.splitLabelEq);
  assert.equal(chromeLinks.isLinkTarget, labelEq.isLinkTarget);
  for (const t of ['/a', '#f', '?q=1', '//h/x', 'https://h/x?a=b', 'HTTP://H/', 'mailto:a@b?subject=x', 'tel:+1', 'page', 'p.html?a=b', 'javascript:void(0)']) {
    assert.equal(chromeLinks.isLinkTarget(t), true, t);
  }
  for (const t of ['', 'a b', 'b=/c', 'k=v', '=x', 'https://h/a b']) assert.equal(chromeLinks.isLinkTarget(t), false, t);
});
