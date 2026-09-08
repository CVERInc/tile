// sitetile model tests — plain Node, zero framework (the family discipline: pure model, node-runnable).
//   run: node site-core.test.js   (or: npm test)

import assert from 'node:assert/strict';
import {
  parseSite, serializeSite, isSiteFile, renderSiteToHtml, parseParams, FRONTMATTER_KEY,
  ctaButtonsHtml, linkButtonsHtml, bodyHtml,
} from './site-core.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// Canonical fixture — written in the EXACT shape serializeSite emits, so round-trip is exact equality.
// Built from a line array (not a template literal) so the ``` code fence needs no escaping.
const F = '```';
const CANON = [
  '---',
  'sitetile-page: home',
  'title: Demo',
  '---',
  '',
  '## Welcome',
  '%% sitetile: hero bg=cover.jpg cta="Get started"→/signup %%',
  'A **bold** start.',
  '',
  '## Plain section',
  'This is default prose with *italic*.',
  '',
  '## Features',
  '%% sitetile: grid cols=3 %%',
  '### Fast',
  'Loads quick.',
  '### Cheap',
  'Costs little.',
  '### Yours',
  'You own it.',
  '',
  '## Ready?',
  '%% sitetile: cta button="Sign up"→/signup %%',
  'Join today.',
  '',
  '## Raw',
  '%% sitetile: embed %%',
  '<div class="custom">verbatim ## not a heading</div>',
  '',
  '## Fenced',
  'Code here:',
  F,
  '## not a section',
  '### not a cell',
  F,
  'done.',
].join('\n') + '\n';

// ── round-trip ────────────────────────────────────────────────────────────────────────────────
test('serialize(parse(CANON)) === CANON  (exact round-trip)', () => {
  assert.equal(serializeSite(parseSite(CANON)), CANON);
});

test('round-trip is a stable fixpoint', () => {
  const once = serializeSite(parseSite(CANON));
  const twice = serializeSite(parseSite(once));
  assert.equal(twice, once);
});

// ── model shape ───────────────────────────────────────────────────────────────────────────────
test('parses 6 sections (code-fence guard: fake ## / ### inside a fence are NOT split)', () => {
  const m = parseSite(CANON);
  assert.equal(m.sections.length, 6, 'expected 6 sections, got ' + m.sections.length);
  assert.equal(m.title, 'Demo');
});

test('section types: hero / prose(default, no type line) / grid / cta / embed / prose(fenced)', () => {
  const s = parseSite(CANON).sections;
  assert.equal(s[0].type, 'hero');
  assert.equal(s[1].type, 'prose');
  assert.equal(s[1].hasTypeLine, false, 'default prose must have no type line (so it round-trips clean)');
  assert.equal(s[2].type, 'grid');
  assert.equal(s[3].type, 'cta');
  assert.equal(s[4].type, 'embed');
  assert.equal(s[5].type, 'prose');
});

test('grid: ### subheadings become cells with bodies', () => {
  const grid = parseSite(CANON).sections[2];
  assert.equal(grid.cells.length, 3);
  assert.deepEqual(grid.cells.map((c) => c.title), ['Fast', 'Cheap', 'Yours']);
  assert.equal(grid.cells[0].body, 'Loads quick.');
});

test('embed: body preserved verbatim (incl. a literal ## that must NOT become a heading)', () => {
  const embed = parseSite(CANON).sections[4];
  assert.equal(embed.body, '<div class="custom">verbatim ## not a heading</div>');
});

test('fenced prose: the ``` block (with fake ## / ###) is kept as one section body', () => {
  const fenced = parseSite(CANON).sections[5];
  assert.equal(fenced.title, 'Fenced');
  assert.ok(fenced.body.includes('## not a section'), 'fenced ## should survive inside body');
  assert.ok(fenced.body.includes('### not a cell'), 'fenced ### should survive inside body');
});

test('parseParams: words inside a quoted label are not bare flags', () => {
  // A CTA reading "Go wide now" must not turn `wide` on; "Talk to us" must not invent `to`/`us`.
  const pm = parseParams('button="Go wide now"→/start ordered');
  assert.deepEqual(pm, { button: { label: 'Go wide now', href: '/start' }, ordered: true });
  const pm2 = parseParams('cta="Talk to us"→/contact');
  assert.deepEqual(pm2, { cta: { label: 'Talk to us', href: '/contact' } });
  // CONTROL: a real bare flag outside the quotes still works, on either side of the label.
  assert.deepEqual(parseParams('wide button="Sign up"→/signup'), { wide: true, button: { label: 'Sign up', href: '/signup' } });
});

test('parseParams: bare value + quoted-link value', () => {
  const pm = parseParams('bg=cover.jpg cta="Get started"→/signup');
  assert.equal(pm.bg, 'cover.jpg');
  assert.deepEqual(pm.cta, { label: 'Get started', href: '/signup' });
});

// ── isSiteFile ────────────────────────────────────────────────────────────────────────────────
test('isSiteFile: claim flag present → true', () => {
  assert.equal(isSiteFile(CANON), true);
});
test('isSiteFile: no frontmatter → false', () => {
  assert.equal(isSiteFile('# just markdown\n\nhello'), false);
});
test('isSiteFile: frontmatter without the claim key → false', () => {
  assert.equal(isSiteFile('---\ntitle: x\n---\n\nhi'), false);
});

// ── renderSiteToHtml ──────────────────────────────────────────────────────────────────────────
test('render: each of the 5 types emits its st- section', () => {
  const html = renderSiteToHtml(parseSite(CANON));
  assert.ok(html.includes('<section class="st-hero"'), 'hero');
  assert.ok(html.includes('<section class="st-prose"'), 'prose');
  assert.ok(/<section class="st-grid"[^>]*data-cols="3"/.test(html), 'grid + cols');
  assert.ok(html.includes('<section class="st-cta"'), 'cta');
  assert.ok(html.includes('<section class="st-embed"'), 'embed');
});

test('render: hero bg → background-image, cta param → anchor', () => {
  const html = renderSiteToHtml(parseSite(CANON));
  assert.ok(html.includes('background-image:url(cover.jpg)'), 'hero bg');
  assert.ok(html.includes('<a class="st-hero-cta" href="/signup">Get started</a>'), 'hero cta anchor');
  assert.ok(html.includes('<a class="st-cta-btn st-cta-btn-primary" href="/signup">Sign up<span class="st-cta-arrow" aria-hidden="true"><span class="signet-arrow"'), 'cta button anchor carries the interactive signet-arrow (internal → right), not a static ↗ glyph');
});

test('cta caption=before puts the caption BEFORE the button row (#68 coral expressiveness)', () => {
  // Default: buttons then caption (the buttons-first belt). #68: a marketing card that wants to LEAD
  // with a blurb had to drop to an embed hand-roll. `caption=before` flips the real DOM order (so it's
  // right for screen readers too), keeping the card born-valid inside the coral.
  const src = (pos) => '---\nsitetile-page: t\n---\n\n## Join\n%% sitetile: cta ' + pos + 'button="Sign up"→/signup %%\nA short pitch below.\n';
  const before = renderSiteToHtml(parseSite(src('caption=before ')));
  const after = renderSiteToHtml(parseSite(src('')));
  // caption=before: the caption paragraph precedes the button row in source order.
  assert.ok(before.indexOf('A short pitch below.') < before.indexOf('st-cta-btns'), 'caption leads the buttons');
  // default: the button row precedes the caption (unchanged behaviour).
  assert.ok(after.indexOf('st-cta-btns') < after.indexOf('A short pitch below.'), 'default keeps buttons-first');
});

test('button affordance: signet-arrow chosen by link kind, no heart/envelope glyphs', () => {
  // external → up-right arrow + target=_blank rel=noopener (leaves the site)
  const ext = ctaButtonsHtml({ label: 'Give once', href: 'https://pay.example.com/x' }, '').row;
  assert.ok(ext.includes('signet-arrow--up-right'), 'external cta → up-right arrow');
  assert.ok(ext.includes('target="_blank" rel="noopener"'), 'external cta opens in a new tab safely');
  assert.ok(!ext.includes('M2 9.5a5.5'), 'no heart glyph inside the button');

  // an explicit icon=heart no longer injects a glyph — the arrow still wins
  const withIcon = ctaButtonsHtml({ label: 'Give once', href: 'https://pay.example.com/x' }, '', 'heart').row;
  assert.ok(!withIcon.includes('M2 9.5a5.5'), 'icon=heart is ignored; no heart inside the button');
  assert.ok(withIcon.includes('signet-arrow--up-right'), 'icon=heart button keeps its external arrow');

  // mailto: → a right arrow (an action link, same tab), NOT the old envelope, NOT target=_blank
  const mail = ctaButtonsHtml({ label: 'Email us', href: 'mailto:hi@example.com' }, '').row;
  assert.ok(mail.includes('<span class="signet-arrow"'), 'mailto cta → right arrow');
  assert.ok(!mail.includes('signet-arrow--up-right'), 'mailto is not treated as external');
  assert.ok(!mail.includes('m22 7-8.991'), 'no envelope glyph inside the button');
  assert.ok(!mail.includes('target="_blank"'), 'mailto stays in the same tab');

  // internal → right arrow, same tab
  const int = ctaButtonsHtml({ label: 'Sign up', href: '/signup' }, '').row;
  assert.ok(int.includes('<span class="signet-arrow"') && !int.includes('signet-arrow--up-right'), 'internal cta → right arrow');
  assert.ok(!int.includes('target="_blank"'), 'internal cta stays in the same tab');

  // hero/social row: external gets up-right + target; internal gets a right arrow too (unified)
  const row = linkButtonsHtml([
    { label: 'View on GitHub', href: 'https://github.com/CVERInc/x', primary: true },
    { label: 'Learn more', href: '/about' },
  ], 'st-hero');
  assert.ok(row.includes('signet-arrow--up-right') && row.includes('target="_blank" rel="noopener"'), 'external hero button → up-right + new tab');
  assert.ok(row.includes('<a class="st-hero-btn st-hero-btn-secondary" href="/about"'), 'internal hero button present');
});

test('render: inline markdown goes through cssmd (bold → st-b span)', () => {

// 🩸 CJK soft-wrap joining. Both halves earned on a customer's site, 2026-08-18, and both were
// invisible to every other gate: the page looked fine, measured fine, and read wrong.
test('render: CJK soft-wrapped lines join with NO space, and a ・ line starts its own line', () => {
  const cjk = bodyHtml('HOSHIYAのLIVE2D制作は、\nあなたのキャラクターに命を吹き込む！');
  assert.match(cjk, /制作は、あなたの/, 'no space may appear at a CJK soft wrap');
  assert.doesNotMatch(cjk, /制作は、 あなたの/);

  const bullets = bodyHtml('・台湾台北出身\n・全てのLive2D制作\n・イラストレーター');
  assert.equal((bullets.match(/<br>/g) || []).length, 2, 'each ・ line is its own line');
  assert.doesNotMatch(bullets, /出身 ・/, 'and they are not run together with a space');

  // 🔴 CONTROLS — the three things that must NOT change.
  assert.match(bodyHtml('Hello world\ncontinued here'), /Hello world continued here/);
  assert.match(bodyHtml('日本語 and English\nmixed line'), /English mixed line/);   // Latin↔CJK keeps its gap
  assert.match(bodyHtml('first line  \nsecond line'), /first line<br>second line/);  // hard break untouched
});
  const html = renderSiteToHtml(parseSite(CANON));
  assert.ok(html.includes('class="st-b"'), 'bold should render via cssmd st-b');
});

test('render: _italic_ / __bold__ underscores emphasise (#69); snake_case stays literal', () => {
  const src = '---\nsitetile-page: home\ntitle: T\n---\n\n## H\n%% sitetile: prose %%\nFresh _flavor_ and __weight__, but keep my_file_name intact.\n';
  const html = renderSiteToHtml(parseSite(src));
  assert.ok(html.includes('class="st-i"'), '_italic_ should render italic via cssmd st-i (#69 was raw underscores)');
  assert.ok(html.includes('class="st-b"'), '__bold__ should render bold via cssmd st-b');
  assert.ok(!/my<span class="st-i">/.test(html) && html.includes('my_file_name'), 'intraword underscores (snake_case) stay literal');
});

test('render: grid cells become st-cell with h3', () => {
  const html = renderSiteToHtml(parseSite(CANON));
  assert.ok(html.includes('<div class="st-cell"><h3>'), 'grid cell + h3');
});

test('render: embed body passed through VERBATIM (no markdown processing)', () => {
  const html = renderSiteToHtml(parseSite(CANON));
  // The claim is that the BODY is untouched, not that the tag serialises a
  // particular way — `id` was added to every section on 2026-08-18 and an
  // order-sensitive match would have read that as "the embed body changed".
  assert.ok(/<section class="st-embed"[^>]*><div class="custom">verbatim ## not a heading<\/div><\/section>/.test(html), 'embed verbatim');
});

test('embed wide: `embed wide` modifier → .is-wide (full-bleed band); plain embed unchanged', () => {
  const wide = parseSite('## R\n%% sitetile: embed wide %%\n<div>x</div>').sections[0];
  assert.equal(wide.type, 'embed');
  assert.ok(/<section class="st-embed is-wide"[^>]*><div>x<\/div><\/section>/
    .test(renderSiteToHtml(parseSite('## R\n%% sitetile: embed wide %%\n<div>x</div>'))), 'wide → is-wide');
  assert.ok(/<section class="st-embed"[^>]*><div>x<\/div><\/section>/
    .test(renderSiteToHtml(parseSite('## R\n%% sitetile: embed %%\n<div>x</div>'))), 'plain unchanged');
});

// ── block-image render (hero portraits / in-body figures / wikilink embeds) ─────────────────────
const IMG = [
  '---', 'sitetile-page: t', '---', '',
  '## Hero', '%% sitetile: hero %%', '![Avatar](/assets/avatar.jpg)', '',   // image-only block → figure
  '## Body', 'Text with ![inline](/i.png) here.', '',                   // inline image → inside <p>
  '## Wiki', '![[photos/cover.jpg]]', '',                               // Obsidian embed → figure
].join('\n') + '\n';

test('render: image-only block → <figure> with <img> (hero avatar shows, not literal ![..])', () => {
  const html = renderSiteToHtml(parseSite(IMG));
  assert.ok(html.includes('<figure class="st-figure"><img class="st-img" src="/assets/avatar.jpg" alt="Avatar" loading="lazy" decoding="async"></figure>'), 'block image as figure');
  assert.ok(!html.includes('![Avatar]'), 'raw image markdown must NOT leak as text');
});

test('render: inline image stays inside the <p> (not a figure)', () => {
  const html = renderSiteToHtml(parseSite(IMG));
  assert.ok(html.includes('<p>Text with <img class="st-img" src="/i.png" alt="inline" loading="lazy" decoding="async"> here.</p>'), 'inline image in paragraph');
});

test('render: ![[wikilink]] embed → <img> (alt = basename)', () => {
  const html = renderSiteToHtml(parseSite(IMG));
  assert.ok(html.includes('<img class="st-img" src="photos/cover.jpg" alt="cover.jpg"'), 'wikilink embed image');
});

test('round-trip unaffected: image markdown survives serialize(parse) verbatim', () => {
  const out = serializeSite(parseSite(IMG));
  assert.ok(out.includes('![Avatar](/assets/avatar.jpg)'), 'markdown image round-trips');
  assert.ok(out.includes('![[photos/cover.jpg]]'), 'wikilink embed round-trips');
});

// ── graduated markers (2026-06-24, 3rd-page earned): grid cell CTA/link + hero media variant ────
const GRAD = [
  '---', 'sitetile-page: t', '---', '',
  '## Picks', '%% sitetile: grid cols=2 %%',
  '### Linked →/go', 'has a link.',
  '### Plain', 'no link.', '',
  '## Brand', '%% sitetile: hero media=logo %%', '![L](/logo.png)', '',
].join('\n') + '\n';

test('grid cell: `### Title →/href` parses href; plain cell has none', () => {
  const g = parseSite(GRAD).sections[0];
  assert.equal(g.cells[0].title, 'Linked');
  assert.equal(g.cells[0].href, '/go');
  assert.equal(g.cells[1].title, 'Plain');
  assert.equal(g.cells[1].href, '');
});

test('grid cell href round-trips (`### Title →/href` verbatim; plain unchanged)', () => {
  const out = serializeSite(parseSite(GRAD));
  assert.ok(out.includes('### Linked →/go'), 'linked cell heading round-trips');
  assert.ok(out.includes('### Plain\n'), 'plain cell heading unchanged');
});

test('render: cell with href → <a class="st-cell st-cell-link"> + chevron; plain → <div>', () => {
  const html = renderSiteToHtml(parseSite(GRAD));
  assert.ok(html.includes('<a class="st-cell st-cell-link group" href="/go"><h3>Linked</h3>'), 'link cell anchor');
  assert.ok(html.includes('<span class="st-cell-cta" aria-hidden="true">›</span></a>'), 'chevron CTA');
  assert.ok(html.includes('<div class="st-cell"><h3>Plain</h3>'), 'plain cell stays a div');
});

test('render: hero media=logo → data-media="logo"; default → avatar', () => {
  assert.ok(/<section class="st-hero"[^>]*data-media="logo"/.test(renderSiteToHtml(parseSite(GRAD))), 'logo variant');
  const def = renderSiteToHtml(parseSite('---\nsitetile-page: t\n---\n\n## H\n%% sitetile: hero %%\nhi\n'));
  assert.ok(/<section class="st-hero"[^>]*data-media="avatar"/.test(def), 'default avatar');
});

// ── base-content block rendering (2026-06-24): lists / blockquote / fenced code / GFM table ──────
const BLOCKS = [
  '---', 'sitetile-page: t', '---', '',
  '## Body', '',
  'Lead para.', '',
  '- one', '- two', '* three', '',
  '1. first', '2. second', '',
  '> a quote line', '> continued', '',
  '| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |', '',
  '```js', 'const x = 1; // ## not a heading, > not quote, | not table, - not list', '```', '',
].join('\n') + '\n';

test('render: unordered list (mixed -/* markers, consecutive) → one <ul class="st-list">', () => {
  const html = renderSiteToHtml(parseSite(BLOCKS));
  assert.ok(html.includes('<ul class="st-list"><li>one</li><li>two</li><li>three</li></ul>'), 'ul');
  assert.equal((html.match(/<ul/g) || []).length, 1, 'exactly one ul (the `-` inside code must NOT make a 2nd)');
});

test('render: ordered list → <ol class="st-list">', () => {
  const html = renderSiteToHtml(parseSite(BLOCKS));
  assert.ok(html.includes('<ol class="st-list"><li>first</li><li>second</li></ol>'), 'ol');
});

test('render: blockquote (continued lines joined) → <blockquote class="st-quote">', () => {
  const html = renderSiteToHtml(parseSite(BLOCKS));
  assert.ok(html.includes('<blockquote class="st-quote"><p>a quote line continued</p></blockquote>'), 'blockquote');
});

test('render: GFM table → <table class="st-table"> thead+tbody', () => {
  const html = renderSiteToHtml(parseSite(BLOCKS));
  assert.ok(html.includes('<table class="st-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>'), 'table');
});

test('render: fenced code is verbatim — its # > | - do NOT spawn blocks', () => {
  const html = renderSiteToHtml(parseSite(BLOCKS));
  // The fence is `js`, so its body now carries highlight spans. What must stay true is what this
  // test was always about: the TEXT is verbatim and escaped. So strip the spans and compare that —
  // a literal-match on the painted markup would have to be rewritten every time a keyword list
  // changes, and would stop measuring the thing it was written to measure.
  const code = /<pre class="st-code"><code class="language-js">([\s\S]*?)<\/code><\/pre>/.exec(html);
  assert.ok(code, 'a js fence renders as pre>code.language-js');
  assert.equal(code[1].replace(/<\/?span[^>]*>/g, ''),
    'const x = 1; // ## not a heading, &gt; not quote, | not table, - not list', 'code verbatim+escaped');
  assert.ok(code[1].includes('<span class="st-kw">const</span>'), 'and highlighted, since the fence declares js');
  assert.equal((html.match(/<blockquote/g) || []).length, 1, 'code `>` must not make a 2nd blockquote');
  assert.equal((html.match(/<table/g) || []).length, 1, 'code `|` must not make a 2nd table');
});

test('round-trip: list/quote/table/fence survive serialize(parse) verbatim', () => {
  const out = serializeSite(parseSite(BLOCKS));
  ['- one', '* three', '1. first', '> a quote line', '| A | B |', '| --- | --- |', '```js'].forEach((frag) =>
    assert.ok(out.includes(frag), 'round-trips: ' + frag));
});

// ── body block degradation fill (2026-06-24): nested lists / multi-para quote / single-col table ─
const NEST = [
  '---', 'sitetile-page: t', '---', '',
  '## Body', '',
  '- a', '  - a1', '  - a2', '- b', '',
  '- top', '  1. one', '  2. two', '',
  '> q1', '>', '> q2', '',
  '| H |', '| --- |', '| r1 |', '| r2 |', '',
  'rule below', '', '---', '', 'after', '',
].join('\n') + '\n';

test('render: nested list (indented children) → <ul> inside <li>', () => {
  const html = renderSiteToHtml(parseSite(NEST));
  assert.ok(html.includes('<ul class="st-list"><li>a<ul class="st-list"><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'), 'nested ul');
});

test('render: nested ordered-in-unordered → <ol> inside <li>', () => {
  const html = renderSiteToHtml(parseSite(NEST));
  assert.ok(html.includes('<li>top<ol class="st-list"><li>one</li><li>two</li></ol></li>'), 'ul > ol nesting');
});

test('render: multi-paragraph blockquote (blank `>` line splits paras)', () => {
  const html = renderSiteToHtml(parseSite(NEST));
  assert.ok(html.includes('<blockquote class="st-quote"><p>q1</p><p>q2</p></blockquote>'), 'two quote paras');
});

test('render: single-column GFM table', () => {
  const html = renderSiteToHtml(parseSite(NEST));
  assert.ok(html.includes('<table class="st-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>r1</td></tr><tr><td>r2</td></tr></tbody></table>'), 'single-col table');
});

test('render: a bare `---` is NOT a table separator (no leading pipe → stays a paragraph)', () => {
  const html = renderSiteToHtml(parseSite(NEST));
  assert.equal((html.match(/<table/g) || []).length, 1, 'only the real single-col table; `---` makes none');
});

// ── headerless def-list table + list-in-cell: a company-profile label|value table ──────────────
// 株式会社HOSHIYA is a fictional wordmark. What is under test is the SHAPE — 2 columns × 3 rows,
// no separator row, a CJK label cell against a value cell that mixes 株式会社 with ASCII, and one
// cell holding a `<br>`-joined list — not whose company profile it was copied from.
const HEADLESS = [
  '---', 'sitetile-page: t', '---', '',
  '## Co', '',
  '| 法人名 | 株式会社HOSHIYA |',
  '| 資本金 | 500万円 |',
  '| 事業内容 | - イラスト<br>- ゲーム<br>- 動画 |', '',
  'A paragraph with a | pipe | inside stays prose.', '',
].join('\n') + '\n';

test('render: headerless table → <table data-headless> all-<td>, no <thead>', () => {
  const html = renderSiteToHtml(parseSite(HEADLESS));
  assert.ok(html.includes('<table class="st-table" data-headless><tbody><tr><td>法人名</td><td>株式会社HOSHIYA</td></tr><tr><td>資本金</td><td>500万円</td></tr>'), 'headerless rows');
  assert.equal((html.match(/<thead/g) || []).length, 0, 'no thead in a headerless table');
});

test('render: bulleted list inside a table cell → <ul class="st-cell-list">', () => {
  const html = renderSiteToHtml(parseSite(HEADLESS));
  assert.ok(html.includes('<td><ul class="st-cell-list"><li>イラスト</li><li>ゲーム</li><li>動画</li></ul></td>'), 'list-in-cell');
});

test('render: a prose sentence containing a mid-line `|` is NOT a table', () => {
  const html = renderSiteToHtml(parseSite(HEADLESS));
  assert.ok(html.includes('<p>A paragraph with a | pipe | inside stays prose.</p>'), 'pipe-in-prose stays a paragraph');
});

test('round-trip: headerless table + in-cell list survive serialize(parse) verbatim', () => {
  const out = serializeSite(parseSite(HEADLESS));
  ['| 法人名 | 株式会社HOSHIYA |', '| 事業内容 | - イラスト<br>- ゲーム<br>- 動画 |'].forEach((frag) =>
    assert.ok(out.includes(frag), 'round-trips: ' + frag));
});

test('round-trip: nested-list indentation + multi-para quote survive serialize(parse)', () => {
  const out = serializeSite(parseSite(NEST));
  ['  - a1', '  1. one', '> q1', '>', '| H |'].forEach((frag) =>
    assert.ok(out.includes(frag), 'round-trips: ' + JSON.stringify(frag)));
});


test('round-trip: 3-deep block-scalar nav is idempotent (serialize emits `key: |`, parse reads it back)', () => {
  // Regression for the arbitrary-depth nav bug: splitFrontmatter READ block scalars but serializeSite
  // WROTE them inline, so serialize(parse(md)) truncated a multi-line nav to its first line and the
  // round-trip guard rejected any page carrying a nested nav once its body grew.
  const md = [
    '---', 'sitetile-page: t', 'nav: |',
    '  - A /a', '    - B /b', '      - C /c', '  - D /d', '---', '',
  ].join('\n');
  const parsed = parseSite(md);
  assert.equal(parsed.meta.nav, '- A /a\n  - B /b\n    - C /c\n- D /d', 'parsed nav keeps depth');
  const once = serializeSite(parsed);
  assert.ok(once.includes('nav: |'), 'serialize emits a block scalar, not inline');
  assert.equal(serializeSite(parseSite(once)), once, 'serialize∘parse is idempotent (round-trips)');
  assert.equal(parseSite(once).meta.nav, parsed.meta.nav, 'nav survives the round-trip verbatim');
});

// ── dialogue (`> **NAME**` + speech) ──────────────────────────────────────────────────────────
// The trigger has to be narrow enough that an ordinary quotation never trips it, so the
// NEGATIVE cases below matter more than the positive one: each is a quote deliberately written
// to look like a turn without being one.
const dlg = (body) => renderSiteToHtml(parseSite('---\nsitetile-page: t\n---\n\n## R\n%% sitetile: prose %%\n' + body));

test('dialogue: a bold-name-only quote line becomes a turn', () => {
  const html = dlg('> **CHOD**\n> Aligned keyboards are hard to type on.');
  assert.ok(html.includes('<div class="st-dialogue">'), 'wraps in st-dialogue');
  assert.ok(html.includes('data-side="left"'), 'first speaker sits left');
  assert.ok(html.includes('<div class="st-turn-who" aria-hidden="true">C</div>'), 'initial stands in for an avatar');
  assert.ok(html.includes('>CHOD</p>') || /st-turn-name">CHOD/.test(html), 'name is in text, not only in the initial');
  assert.ok(html.includes('Aligned keyboards are hard to type on.'), 'speech survives');
  assert.ok(!html.includes('st-quote'), 'a turn is not also a quotation');
});

test('dialogue: an ordinary quotation is untouched', () => {
  const html = dlg('> Just an ordinary quotation.\n> Second line.');
  assert.ok(html.includes('<blockquote class="st-quote">'), 'still a blockquote');
  assert.ok(!html.includes('st-dialogue'), 'not a dialogue');
});

test('dialogue: bold text with anything else on the line is NOT a turn', () => {
  const html = dlg('> **Two rounds of reasoning** produced nothing.\n> One line of print produced the answer.');
  assert.ok(html.includes('<blockquote class="st-quote">'), 'leading bold in a sentence stays a quotation');
  assert.ok(!html.includes('st-dialogue'), 'not a dialogue');
});

test('dialogue: a bold name with nothing under it is NOT a turn', () => {
  const html = dlg('> **CHOD**');
  assert.ok(html.includes('<blockquote class="st-quote">'), 'a name alone is a quotation, not speech');
  assert.ok(!html.includes('st-dialogue'), 'not a dialogue');
});

test('dialogue: second speaker sits on the other side, and a run groups into one block', () => {
  const html = dlg('> **CHOD**\n> Really? Esc in the bottom-left corner?\n\n> **KITT**\n> No. I moved it back.');
  assert.equal((html.match(/st-dialogue/g) || []).length, 1, 'one group, not two');
  assert.equal((html.match(/data-side="left"/g) || []).length, 1, 'first speaker left');
  assert.equal((html.match(/data-side="right"/g) || []).length, 1, 'second speaker right');
});

test('dialogue: the same speaker twice drops the repeated label', () => {
  const html = dlg('> **KITT**\n> First.\n\n> **KITT**\n> Still me.');
  assert.equal((html.match(/data-cont="1"/g) || []).length, 1, 'only the second turn is a continuation');
  assert.equal((html.match(/data-side="right"/g) || []).length, 0, 'one voice never crosses to the right');
});

test('dialogue: `· suffix` after the name carries a date', () => {
  const html = dlg('> **GOGO** · 2026-04-10\n> Day one.');
  assert.ok(html.includes('<span class="st-turn-meta">2026-04-10</span>'), 'suffix becomes meta');
  assert.ok(/st-turn-name">GOGO</.test(html), 'name is not swallowed by the suffix');
});

test('dialogue: two adjacent ordinary quotes still render as two blockquotes', () => {
  // regression guard: collecting the whole quote RUN to group turns must not merge plain quotes.
  const html = dlg('> First quote.\n\n> Second quote.');
  assert.equal((html.match(/<blockquote class="st-quote">/g) || []).length, 2, 'two quotes stay two');
});

test('dialogue: a turn and a quotation in the same run keep their own shapes and order', () => {
  const html = dlg('> **KITT**\n> Mine.\n\n> Not mine — someone else wrote this.');
  assert.ok(html.indexOf('st-dialogue') < html.indexOf('st-quote'), 'the turn comes first, the quote after');
  assert.ok(html.includes('st-dialogue') && html.includes('st-quote'), 'both shapes present');
});

test('dialogue: a bold line at the 24-char cap followed by prose is still a turn', () => {
  const html = dlg('> **' + 'A'.repeat(24) + '**\n> Right at the limit, and still speech.');
  assert.ok(html.includes('<div class="st-dialogue">'), 'still trips the dialogue shape');
  assert.ok(!html.includes('st-quote'), 'not a plain quotation');
});

test('dialogue: a series-nav block (bold line + numbered link list) is never a turn, at or over the cap', () => {
  // reef#434: "Series: The PineNote pen" is exactly 24 chars, "...microphone array" is 37 — a
  // series-nav block must stay a plain quotation regardless of which side of the cap it lands on,
  // because the list under the bold line is never speech.
  const atCap = dlg('> **Series: The PineNote pen**\n> 1. [Part 1](/a) *(Current)*\n> 2. [Part 2](/b)');
  assert.ok(atCap.includes('<blockquote class="st-quote">'), '24-char bold line over a list stays a quote');
  assert.ok(!atCap.includes('st-dialogue'), 'not a dialogue');

  const overCap = dlg('> **Series: The PineNote microphone array**\n> 1. [Part 1](/a) *(Current)*\n> 2. [Part 2](/b)');
  assert.ok(overCap.includes('<blockquote class="st-quote">'), '37-char bold line over a list stays a quote');
  assert.ok(!overCap.includes('st-dialogue'), 'not a dialogue');
});

test('dialogue: a ・ or • bulleted nav block under a bold line is not a turn either', () => {
  // `・` (U+30FB) and `•` (U+2022) are the everyday bullets in a CJK locale, and the renderer
  // already treats them as markers inside a table cell — so they are items here too, written
  // tight against the text as they usually are.
  for (const [what, item] of [['tight ・', '・'], ['spaced ・', '・ '], ['•', '• ']]) {
    const html = dlg('> **Series: The PineNote pen**\n> ' + item + '[Part 1](/a) *(Current)*\n> ' + item + '[Part 2](/b)');
    assert.ok(html.includes('<blockquote class="st-quote">'), what + ' bullets stay a quote');
    assert.ok(!html.includes('st-dialogue'), what + ' is not a dialogue');
  }
  // …but the marker still has to lead the line: `*emphasis*` opens speech, not a list.
  const emph = dlg('> **CHOD**\n> *sighs* I do not know what to tell you.');
  assert.ok(emph.includes('<div class="st-dialogue">'), 'italics at the start are still speech');
});

test('dialogue: speech that merely OPENS with a number is still speech, not a list', () => {
  // A `1.` / `1)` marker alone cannot tell a numbered list from a sentence that starts with a
  // number, so it only makes a list with corroboration: a link, or a second item under it.
  const year = dlg('> **CHOD**\n> 2026. That was the year we finally shipped it.');
  assert.ok(year.includes('<div class="st-dialogue">'), 'a year + period opens prose, not a list');
  assert.ok(!year.includes('st-quote'), 'not demoted to a plain quotation');

  const paren = dlg('> **CHOD**\n> 1) it was late, and 2) nobody was looking.');
  assert.ok(paren.includes('<div class="st-dialogue">'), 'an inline enumeration is still one sentence');

  const link = dlg('> **CHOD**\n> 1. [Part 1](/a)');
  assert.ok(link.includes('<blockquote class="st-quote">'), 'a numbered LINK is an item, not speech');
  assert.ok(!link.includes('st-dialogue'), 'not a dialogue');

  const two = dlg('> **CHOD**\n> 1. first thing\n> 2. second thing');
  assert.ok(two.includes('<blockquote class="st-quote">'), 'a second item corroborates the first');
  assert.ok(!two.includes('st-dialogue'), 'not a dialogue');
});


// ── fenced code highlighting (cssmd/highlight.js) ────────────────────────────────────────────
// The renderer's job here is narrow: pass a KNOWN language through the highlighter, and leave
// everything else exactly as it was. An unlabelled fence is the common case on a devlog — terminal
// output, checksums, boot logs — and those must come out byte-identical to before.
const fence = (info, body) =>
  renderSiteToHtml(parseSite('---\nsitetile-page: t\n---\n\n## R\n%% sitetile: prose %%\n```' + info + '\n' + body + '\n```'));

test('code: a known language is highlighted with st-* tokens', () => {
  const html = fence('js', 'const x = 1; // note');
  assert.ok(html.includes('<span class="st-kw">const</span>'), 'keyword');
  assert.ok(html.includes('<span class="st-num">1</span>'), 'number');
  assert.ok(html.includes('<span class="st-com">// note</span>'), 'comment');
  assert.ok(html.includes('<code class="language-js">'), 'language class kept');
});

test('code: an UNLABELLED fence is untouched (the common case on a devlog)', () => {
  const html = fence('', '$ gdbus call --dest org.gnome.Shell\nError: AccessDenied');
  assert.ok(html.includes('<pre class="st-code"><code>'), 'no language class');
  assert.ok(!/st-(kw|str|num|com)/.test(html), 'and no tokens invented for it');
});

test('code: an UNKNOWN language keeps its class but gets no tokens', () => {
  const html = fence('brainfuck', '+++ hello');
  assert.ok(html.includes('<code class="language-brainfuck">'), 'class still records what was declared');
  assert.ok(!/st-(kw|str|num|com|ins)/.test(html), 'nothing painted on a guess');
});

test('code: a multi-token info string names the language with its FIRST token', () => {
  const html = fence('js title="a.js"', 'const x');
  assert.ok(html.includes('<code class="language-js">'), 'class is the language, not the whole info string');
  assert.ok(html.includes('<span class="st-kw">const</span>'), 'and it still highlights');
});

test('code: a diff paints whole lines, and `---` stays a file header', () => {
  const html = fence('diff', '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-was\n+is');
  assert.ok(html.includes('<span class="st-hunk">--- a/f</span>'), '--- is a header, not a deletion');
  assert.ok(html.includes('<span class="st-del">-was</span>') && html.includes('<span class="st-ins">+is</span>'), 'ins/del');
});

test('code: the fence body is still verbatim — markdown inside it is not rendered', () => {
  const html = fence('js', "const s = '**not bold**';");
  assert.ok(!html.includes('st-b"'), 'no bold span from inside a fence');
  assert.ok(html.includes('**not bold**'), 'the asterisks survive as text');
});

test('links: a URL with a matched pair of underscores stays a link (emphasis must not eat it)', () => {
  // 🩸 Real case: a partner page linking https://twitter.com/_Malachite_ rendered the LITERAL text
  // `[X](https://twitter.com/…)` — the emphasis pass ran before the link pass and turned the `_…_`
  // inside the URL into <span class="st-i">, so the link regex no longer matched. Destinations are
  // now stashed across that pass.
  const src = '---\nsitetile-page: home\ntitle: T\n---\n\n## H\n%% sitetile: prose %%\nFollow [X](https://twitter.com/_Malachite_) today.\n';
  const html = renderSiteToHtml(parseSite(src));
  assert.ok(html.includes('href="https://twitter.com/_Malachite_"'), 'the href survives intact');
  assert.ok(!/https:\/\/twitter\.com\/<span/.test(html), 'no emphasis span leaked into the URL');
  assert.ok(!html.includes(']\(http'), 'no literal markdown link syntax left on the page');
});


// ── people coral ───────────────────────────────────────────────────────────────────────────────
// Grown for a client whose ONE roster shape was hand-rolled on five different pages (collaborating
// artists by discipline, teaching staff by class, graduates by cohort, talents with channels,
// partner companies as a logo wall) — each out of `gallery` plus its own CSS, each drifted.
const people = (bodyLines) => '---\nsitetile-page: home\ntitle: T\n---\n\n## Roster\n%% sitetile: people %%\n' + bodyLines.join('\n') + '\n';

test('people: a roster with no ####: `###` IS the person, and it renders without a group wrapper', () => {
  const site = parseSite(people(['### Ake Fumi', '![Ake Fumi](/media/a.jpg)', 'Illustrator.']));
  const s = site.sections[0];
  assert.equal(s.type, 'people');
  assert.equal(s.groups.length, 1, 'one implicit group');
  assert.equal(s.groups[0].title, '', 'and it is untitled');
  assert.equal(s.groups[0].people.length, 1);
  assert.equal(s.groups[0].people[0].title, 'Ake Fumi');
  const html = renderSiteToHtml(site);
  assert.ok(html.includes('class="st-people-cells"'), 'cells are rendered');
  assert.ok(!html.includes('st-people-group'), 'a flat roster grows no group wrapper');
  assert.ok(html.includes('src="/media/a.jpg"'), 'the leading image becomes the portrait');
});

test('people: one `####` anywhere flips the whole section to grouped — `###` becomes the heading', () => {
  const site = parseSite(people(['### 繪師', 'Illustrators we work with.', '#### 白露', '#### 鴉參', '### 背景', '#### 游象宜']));
  const gs = site.sections[0].groups;
  assert.equal(gs.length, 2, 'two groups');
  assert.deepEqual(gs.map((g) => g.title), ['繪師', '背景']);
  assert.deepEqual(gs[0].people.map((p) => p.title), ['白露', '鴉參']);
  assert.equal(gs[0].lead, 'Illustrators we work with.', 'prose under the group heading is the group lead');
  const html = renderSiteToHtml(site);
  assert.ok(html.includes('class="st-people-group"'), 'grouped rosters get the wrapper');
  assert.ok(html.includes('id="people-'), 'each group head is addressable');
});

test('people: a person holds SEVERAL roles at once — the reason this is not a gallery cell', () => {
  // A recommended graduate really does list four cohorts; a `gallery` badge is one string.
  const site = parseSite(people(['### 朔光 [建模班第二期 · 建模班第三期 · 動畫班第三期 · 延伸班第一期]']));
  const html = renderSiteToHtml(site);
  const roles = html.match(/class="st-person-role"/g) || [];
  assert.equal(roles.length, 4, 'four separate role pills, not one run-on string');
  assert.ok(html.includes('>建模班第二期<') && html.includes('>延伸班第一期<'), 'first and last survive');
});

test('people: `links:` is a row of named destinations, and external ones get rel=noopener', () => {
  const site = parseSite(people(['### 莉芙', 'links: YouTube=https://youtube.com/@liv, プロフィール=/vtuber/liv']));
  const p = site.sections[0].groups[0].people[0];
  assert.deepEqual(p.links, [
    { label: 'YouTube', href: 'https://youtube.com/@liv' },
    { label: 'プロフィール', href: '/vtuber/liv' },
  ]);
  const html = renderSiteToHtml(site);
  assert.ok(/href="https:\/\/youtube\.com\/@liv"[^>]*rel="noopener"/.test(html), 'external link is safe');
  assert.ok(!/href="\/vtuber\/liv"[^>]*target=/.test(html), 'an internal link does not open a new tab');
  assert.ok(!html.includes('links:'), 'the seam is consumed, never left as body text');
});

test('people: `tone: dark` is per-person, because a logo wall is not uniform', () => {
  // 3 of 13 marks on the wall this was grown for are white and vanish on a light tile. CSS cannot
  // read a PNG's luminance, so it is authored — and authored per person, not per section.
  const site = parseSite(people(['### Work to Night', '![w](/media/w.png)', 'tone: dark', '### Krosa', '![k](/media/k.png)']));
  const ps = site.sections[0].groups[0].people;
  assert.equal(ps[0].tone, 'dark');
  assert.equal(ps[1].tone, '', 'its neighbour is untouched');
  const html = renderSiteToHtml(site);
  assert.equal((html.match(/data-tone="dark"/g) || []).length, 1, 'exactly one dark tile');
  assert.ok(!html.includes('tone: dark'), 'the seam is consumed');
});

test('people: `shape=logo` contains the mark instead of cropping it to a square', () => {
  const src = '---\nsitetile-page: home\ntitle: T\n---\n\n## Partners\n%% sitetile: people shape=logo %%\n### ACME\n';
  assert.ok(renderSiteToHtml(parseSite(src)).includes('data-shape="logo"'), 'the section declares its shape');
  assert.ok(renderSiteToHtml(parseSite(people(['### ACME']))).includes('data-shape="avatar"'), 'default is a portrait');
});

test('people: round-trip preserves the INFERRED depth — a flat roster must not become grouped', () => {
  // 🩸 The failure this guards: serializing a flat roster's one untitled group as `### ` + `#### `
  // re-parses as GROUPED, so the document silently changes shape on every save.
  const flat = people(['### Ake Fumi', 'Illustrator.', 'links: X=https://x.com/a', 'tone: dark']);
  const once = serializeSite(parseSite(flat));
  assert.ok(/^### Ake Fumi$/m.test(once), 'still a `###` person');
  assert.ok(!/^#### /m.test(once), 'no phantom sub-level');
  assert.equal(serializeSite(parseSite(once)), once, 'and it is idempotent');
  const grouped = people(['### 繪師', '#### 白露', 'links: pixiv=https://pixiv.net/u/1']);
  const g1 = serializeSite(parseSite(grouped));
  assert.ok(/^### 繪師$/m.test(g1) && /^#### 白露$/m.test(g1), 'grouped stays grouped');
  assert.equal(serializeSite(parseSite(g1)), g1, 'idempotent too');
  assert.equal(parseSite(g1).sections[0].groups[0].people[0].links.length, 1, 'and the link row survives a round-trip');
});

// ── collection coral ───────────────────────────────────────────────────────────────────────────
// 🩸 A category's lead paragraph was parsed into `group.lead` by the collection walk, dropped by the
// model builder, and had nowhere to go in serializeSite — so `serialize(parse(page)) !== page` for
// every collection whose categories carry an intro, and EVERY save through EVERY door (MCP
// `save_page`, the console editor, batch `save_pages`) silently deleted those paragraphs. Found by
// reef W88 against a real 制作実績 page (two categories, each with a lead). `people` — the other
// two-level coral — had it right all along; collection just never grew the matching emit.
const collection = (bodyLines) => '---\nsitetile-page: home\ntitle: T\n---\n\n## 制作実績\n%% sitetile: collection %%\n' + bodyLines.join('\n') + '\n';

test('collection: a category lead survives the round trip — two categories, each with one', () => {
  const src = collection([
    'What we have shipped.',
    '### Web',
    '受託開発とサイト制作。',
    '#### Alpha →/a',
    'Body a.',
    '### Print',
    '書籍と図録の装丁。',
    '#### Beta →/b',
  ]);
  const site = parseSite(src);
  const gs = site.sections[0].groups;
  assert.equal(gs.length, 2);
  assert.equal(gs[0].lead, '受託開発とサイト制作。', 'the parser keeps the first category lead ON the model');
  assert.equal(gs[1].lead, '書籍と図録の装丁。', 'and the second');
  assert.equal(serializeSite(site), src, 'and both survive serialize verbatim');
});

test('collection: a category lead sits between its `###` heading and its first `####` item', () => {
  // Position matters as much as survival: emitted after the items it would re-parse as the LAST
  // item's body, and the paragraph would change owner on every save instead of vanishing.
  const src = collection(['### Web', 'Sites we built.', '#### Alpha →/a', 'Body a.']);
  const once = serializeSite(parseSite(src));
  assert.equal(once, src, 'byte-identical');
  const i = once.indexOf('Sites we built.');
  assert.ok(i > once.indexOf('### Web') && i < once.indexOf('#### Alpha'), 'between the heading and the first item');
  assert.equal(parseSite(once).sections[0].groups[0].items[0].body, 'Body a.', 'the item body stays the ITEM\'s');
});

test('collection: a category with NO lead gains nothing — not even a blank line', () => {
  const src = collection(['### Web', '#### Alpha →/a', '### Print', '#### Beta →/b']);
  assert.equal(serializeSite(parseSite(src)), src, 'leadless categories are byte-unchanged');
  assert.equal(parseSite(src).sections[0].groups[0].lead, '', 'and the model says empty, not undefined');
});

test('collection: the SECTION lead and a CATEGORY lead are different paragraphs', () => {
  // Control for the fix: it would be possible to "preserve" the category lead by folding it into
  // the section body, which round-trips as bytes while moving the text to another owner.
  const site = parseSite(collection(['Section intro.', '### Web', 'Category intro.', '#### Alpha →/a']));
  const s = site.sections[0];
  assert.equal(s.body, 'Section intro.', 'the section keeps its own');
  assert.equal(s.groups[0].lead, 'Category intro.', 'the category keeps its own');
});

test('people: an unknown type still falls back to prose — `people` had to be REGISTERED to work', () => {
  // Control: proves the tests above are reading a real registration, not a coincidence of the
  // prose fallback. `peopl` is not in KNOWN_TYPES.
  const src = '---\nsitetile-page: home\ntitle: T\n---\n\n## Roster\n%% sitetile: peopl %%\n### Ake Fumi\n';
  const html = renderSiteToHtml(parseSite(src));
  assert.ok(!html.includes('st-people'), 'a near-miss type does NOT render the coral');
});


test('video: a postered clip preloads NOTHING, an unpostered one still preloads metadata', () => {
  // 🩸 A 198-video portfolio issued 202 metadata requests and took ~11s to settle, for a duration
  // the markup never displays — the poster was already the visual. Without a poster, `metadata` is
  // what gives the player a first frame instead of a black rectangle, so it stays.
  const page = (alt, src) => '---\nsitetile-page: home\ntitle: T\n---\n\n## V\n%% sitetile: prose %%\n![' + alt + '](' + src + ')\n';
  const withPoster = renderSiteToHtml(parseSite(page('https://cdn/p.avif', 'https://cdn/v.mp4')));
  assert.ok(withPoster.includes('poster="https://cdn/p.avif"'), 'the alt slot became the poster');
  assert.ok(withPoster.includes('preload="none"'), 'and nothing is fetched before a click');
  const noPoster = renderSiteToHtml(parseSite(page('just alt text', 'https://cdn/v.mp4')));
  assert.ok(!noPoster.includes('poster='), 'plain alt text is not a poster URL');
  assert.ok(noPoster.includes('preload="metadata"'), 'so it still needs a first frame');
});


// ── form field `required` grammar (2026-09-03, cold-read findings #9/#10) ──────────────────────
const form = (bodyLines) => '---\nsitetile-page: home\ntitle: T\n---\n\n## Contact\n%% sitetile: form %%\n' + bodyLines.join('\n') + '\n';

test('form field: no brace at all → kind text, required left unstated (undefined)', () => {
  const f = parseSite(form(['### Name'])).sections[0].fields[0];
  assert.equal(f.kind, 'text');
  assert.equal(f.required, undefined);
});

test('form field: a bare kind brace is unaffected by the new grammar (backwards compatible)', () => {
  const f = parseSite(form(['### Email {email}'])).sections[0].fields[0];
  assert.equal(f.label, 'Email');
  assert.equal(f.kind, 'email');
  assert.equal(f.required, undefined);
});

test('form field: bare `{required}` sets required=true and leaves kind at its default', () => {
  const f = parseSite(form(['### Company {required}'])).sections[0].fields[0];
  assert.equal(f.label, 'Company');
  assert.equal(f.kind, 'text');
  assert.equal(f.required, true);
});

test('form field: `{kind required}` sets both, either space- or comma-separated', () => {
  const a = parseSite(form(['### Phone {tel required}'])).sections[0].fields[0];
  assert.equal(a.kind, 'tel');
  assert.equal(a.required, true);
  const b = parseSite(form(['### Message {textarea, required}'])).sections[0].fields[0];
  assert.equal(b.kind, 'textarea');
  assert.equal(b.required, true);
});

test('form field: `required: false` is an explicit, distinguishable opt-out', () => {
  const f = parseSite(form(['### Newsletter {required: false}'])).sections[0].fields[0];
  assert.equal(f.required, false);
  assert.notEqual(f.required, undefined, 'explicit false must not collapse into "unstated"');
});

test('form field: `{email, required: false}` — comma + spaced colon, still parses cleanly', () => {
  const f = parseSite(form(['### Newsletter email {email, required: false}'])).sections[0].fields[0];
  assert.equal(f.kind, 'email');
  assert.equal(f.required, false);
});

test('form field: an inferred `select` never gets a `{select}` brace, but keeps its own required', () => {
  const src = form(['### Topic {required}', '- Sales', '- Support']);
  const f = parseSite(src).sections[0].fields[0];
  assert.equal(f.kind, 'select');
  assert.equal(f.required, true);
  assert.equal(serializeSite(parseSite(src)), src, 'round-trips byte-identical');
});

test('form field: required round-trips through serializeSite for every stated value', () => {
  const cases = [
    ['### Name', '### Name'],
    ['### Email {email}', '### Email {email}'],
    ['### Company {required}', '### Company {required}'],
    ['### Phone {tel required}', '### Phone {tel required}'],
    ['### Newsletter {required: false}', '### Newsletter {required: false}'],
    ['### Newsletter email {email, required: false}', '### Newsletter email {email required: false}'],
  ];
  for (const [input, canonical] of cases) {
    const src = form([input]);
    const expected = form([canonical]);
    assert.equal(serializeSite(parseSite(src)), expected, `round-trip of "${input}"`);
  }
});

// ── HTML comment stripping (issue #496) ─────────────────────────────────────────────────────────
// A page owner or agent writing `<!-- QA note -->` in page markdown is normal practice; the bug was
// that bodyHtml() had no concept of a comment token, so it fell through the generic escaper and
// came out as VISIBLE text (`&lt;!-- QA note --&gt;`) on the public site AND the console preview
// iframe (same renderer, vendored byte-for-byte into reef/apps/reef-mcp/vendor/sitetile). The fix
// must keep escaping every OTHER raw tag exactly as before — only the comment token is dropped.

test('🔴 #496: an HTML comment is gone from the rendered output, not shown as text', () => {
  const html = bodyHtml('Welcome text.\n\n<!-- w54 human-editor recon 2026-08-26T15:45:56.218Z -->\n\nAfter.');
  assert.doesNotMatch(html, /w54 human-editor recon/, 'the comment body must not reach the page at all');
  assert.doesNotMatch(html, /&lt;!--/, 'nor its escaped form — that IS the bug (visible as literal text)');
  assert.match(html, /Welcome text\./);
  assert.match(html, /After\./);
});

test('🔴 #496: <script> (and other raw HTML) keeps being escaped — comments are the ONLY exception', () => {
  const html = bodyHtml('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/, 'a real tag must never reach the page unescaped');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'it still renders as inert, visible escaped text');
});

test('🔴 #496: a multi-line comment is stripped in full', () => {
  const html = bodyHtml('before\n\n<!-- line one\nline two\nline three -->\n\nafter');
  assert.doesNotMatch(html, /line one|line two|line three/);
  assert.match(html, /<p>before<\/p>/);
  assert.match(html, /<p>after<\/p>/);
});

test('🔴 #496: a comment inside a list item or a blockquote is stripped too', () => {
  const list = bodyHtml('- one <!-- hidden --> two\n- three');
  assert.doesNotMatch(list, /hidden/);
  assert.match(list, /<li>one\s*two<\/li>/);

  const quote = bodyHtml('> quoted <!-- note --> text');
  assert.doesNotMatch(quote, /note/);
  assert.match(quote, /quoted\s*text/);
});

test('🔴 #496: a comment INSIDE a fenced code block is preserved verbatim — it is code, not a comment', () => {
  const html = bodyHtml('```\n<!-- keep me -->\n```');
  assert.match(html, /&lt;!-- keep me --&gt;/, 'the fence content is code and must survive, escaped like any code');
});

test('🔴 #496: the degenerate `<!-->` does not swallow everything until a LATER -->', () => {
  // `<!-->` (and any run of extra dashes before the `>`: `<!--->`, `<!---->`, …) closes IMMEDIATELY —
  // the HTML spec's "abrupt closing of an empty comment" — and must not fall through to the
  // unterminated-runs-to-EOF rule the next test exercises.
  const degenerate = bodyHtml('before <!--> after');
  assert.match(degenerate, /before/);
  assert.match(degenerate, /after/, '`<!-->` must not open a comment that swallows everything until a LATER -->');
});

// 🩸 round 3 (point 3 of the design, closing R3-P3-04): this used to assert that the unterminated
// comment and everything after it in the DOCUMENT were gone — round 2's policy, and exactly the
// complaint R3-P3-04 raised against it: an author's typo (an unclosed `<!--`) silently deleting the
// rest of a public page, unrelated later sections included, is hostile to ordinary site ownership.
// Round 3 flips the policy: an unterminated `<!--` is left as literal, VISIBLE, escaped text — nothing
// disappears silently, and the author sees exactly what to fix. `<!-- oops, no closer` opened no block
// (bodyHtml's line-initial block-comment check also requires a closer to exist; see commentBlockEnd)
// and has none within its own paragraph either, so escapeInline renders it literally; the blank-line
// boundary right after it still ends that paragraph normally, and "STILL HERE" is its own paragraph.
test('🔴 #496 round 3 — an unterminated `<!--` with no later closer is left literal, not deleted', () => {
  const html = bodyHtml('before\n\n<!-- oops, no closer\n\nSTILL HERE');
  assert.equal(html, '<p>before</p>\n<p>&lt;!-- oops, no closer</p>\n<p>STILL HERE</p>', 'nothing disappears silently');
  assert.match(html, /STILL HERE/, 'a later, unrelated block must survive an earlier unterminated opener');
});

// ── round 2 — REVIEW-tile28-r1-2026-09-09.md, P1-01 / P2-02 / P2-03 / P2-04 / P3-05 / P3-06 ────────
// Round 1 found that stripHtmlComments(), run as a textual pre-pass over the WHOLE document ahead of
// bodyHtml's block/inline passes, (a) was a regex quadratic on an unterminated `<!--` (P1-01), and
// (b) deleted content it should not have: an inline code span's literal text (P2-02), an escaping
// invariant — a comment must never help splice two dead half-tags into a live `<small>`/`<br>`
// (P2-03) — and a 4-space-indented paragraph (P2-04). The fix moves comment removal INSIDE
// escapeInline(), the same left-to-right pass that decides what a bare `<` becomes (see that
// function's own comment in site-core.js for the full reasoning). Each of the five inputs below is
// reproduced from the review with the BEFORE (pre-#496, no comment logic at all) output asserted as
// the expected value for P2-02/P2-03/P2-04 — the round-1 verdict ("先修 P1-01, P2-02, P2-03, P2-04")
// requires the fix to behave as if comment-stripping never touched these specific inputs at all.

test('🔴 #496 round 2 — P2-02: an inline code span keeps a literal comment verbatim, escaped', () => {
  const html = bodyHtml('`<!-- x -->`');
  assert.equal(html, '<p><span class="st-code"><span class="st-mk">`</span>&lt;!-- x --&gt;<span class="st-mk">`</span></span></p>');
});

test('🔴 #496 round 2 — P2-03: a comment must not splice a broken tag into a live <small>/<br>', () => {
  // Before #496 existed, `<sm<!-- -->all>` was never a comment at all — it was just unescaped-`<`
  // soup, and the ENTIRE thing (comment markers included) rendered as visible, inert, escaped text.
  // That must still be true: the fix's job is to make comment-stripping never able to CREATE a
  // `<small>`/`<br>` spelling the author didn't write, not to teach it to recognize this one shape.
  const small = bodyHtml('<sm<!-- -->all>visible</sm<!-- -->all>');
  assert.equal(small, '<p>&lt;sm&lt;!-- --&gt;all&gt;visible&lt;/sm&lt;!-- --&gt;all&gt;</p>');
  assert.doesNotMatch(small, /<small>/, 'no live <small> may ever be synthesized from a split spelling');

  const br = bodyHtml('<br<!-- -->>after');
  assert.equal(br, '<p>&lt;br&lt;!-- --&gt;&gt;after</p>');
  assert.doesNotMatch(br, /<br>/, 'no live <br> may ever be synthesized from a split spelling');

  // The review's own negative control: a split `<script>` must stay escaped either way — this was
  // never broken, and the fix must not break it either.
  const script = bodyHtml('<scr<!-- -->ipt>alert(1)</script>');
  assert.doesNotMatch(script, /<script>/);
  assert.match(script, /&lt;scr&lt;!-- --&gt;ipt&gt;alert\(1\)&lt;\/script&gt;/);
});

test('🔴 #496 round 2 — P2-04: a 4-space-indented paragraph keeps a literal comment, escaped', () => {
  const html = bodyHtml('    <!-- literal indented code -->');
  assert.equal(html, '<p>&lt;!-- literal indented code --&gt;</p>');
});

test('🔴 #496 round 2 — a comment is still removed from ordinary (non-indented, non-code) prose', () => {
  // The behaviour P2-02/P2-03/P2-04 above carve OUT of — issue #496's actual, common case.
  const html = bodyHtml('Hello <!-- editor note --> world.');
  assert.equal(html, '<p>Hello  world.</p>');
});

test('🔴 #496 round 2 — P3-05: the HTML spec\'s alternative comment closer `--!>` is recognized', () => {
  const html = bodyHtml('before <!-- note --!> after');
  assert.equal(html, '<p>before  after</p>');
  assert.doesNotMatch(html, /note/);
});

test('🔴 #496 round 3 — an unterminated `<!--` is left literal, whatever comes after it on the same line', () => {
  // Rounds 1-2 made an unterminated comment consume to EOF (round 1: its own fragment; round 2:
  // the whole document). Round 3 (point 3 of the design, R3-P3-04) leaves it literal instead — see
  // the sibling test above for the full reasoning. "MORE TEXT that must not survive" now MUST survive,
  // visibly, escaped, because nothing about an unclosed `<!--` should make later text disappear.
  const html = bodyHtml('before <!-- oops, no closer, and MORE TEXT that must not survive');
  assert.equal(html, '<p>before &lt;!-- oops, no closer, and MORE TEXT that must not survive</p>');
});

test('🔴 #496 round 3 — P1-01: linear on 1 MiB of unterminated comment openers (no longer quadratic to escape literally, either)', () => {
  const input = '<!--'.repeat(262144);                       // exactly 1 MiB, no closer anywhere
  const html = bodyHtml(input);
  // The whole document is ONE unterminated `<!--` (a single line — this input has no `\n`), so it is
  // left as literal, visible, escaped text (R3 point 3) rather than deleted: one `<p>` of `&lt;!--`
  // repeated 262,144 times. The escapeInline `noCloser` cache (see that function's own comment) is
  // what keeps this linear despite every one of those 262,144 opens being individually attempted.
  assert.equal(html, '<p>' + '&lt;!--'.repeat(262144) + '</p>', 'nothing disappears silently, even at this size');
  // 🔴 round 5 (R4-P3-07): this used to assert an ABSOLUTE `ms < 200`, which the review caught going red
  // (360-500ms) under an unrelated parallel lane's CPU load with NO change to the tree — the assertion
  // was tracking a neighbour's business, not this code. A ratio between two sizes of the SAME shape is
  // immune to a busy neighbour the way one wall-clock number never is (same form as the 256KiB→1MiB
  // ratio test above); one generous absolute bound stays, so a genuine quadratic blow-up (minutes, not
  // milliseconds) still fails even when measured under load.
  const unit = '<!--';
  const at = (bytes) => unit.repeat(Math.floor(bytes / unit.length));
  const time = (inp) => { const t0 = process.hrtime.bigint(); bodyHtml(inp); return Number(process.hrtime.bigint() - t0) / 1e6; };
  time(at(262144));                                            // warm up (JIT)
  const t256 = Math.max(time(at(262144)), 0.001);              // 256 KiB
  const t1m = time(at(1048576));                                // 1 MiB
  const ratio = t1m / t256;
  assert.ok(ratio <= 6, `expected ~4× (linear), got ${ratio.toFixed(1)}× (256KiB=${t256.toFixed(2)}ms, 1MiB=${t1m.toFixed(2)}ms)`);
  assert.ok(t1m < 5000, `expected well under 5s even under load, got ${t1m.toFixed(1)}ms — a true blow-up`);
});

// ── round 3 — REVIEW-tile28-r2-2026-09-09.md, R2-P1-01 / R2-P1-02 / R2-P2-03 / R2-P2-04 ────────────
// Round 2 found the round-1 fix itself had two bugs. R2-P1-01: escapeInline's terminator search ran
// TWO full-suffix `indexOf` calls per comment ('-->' and '--!>'), each bounded by the REST OF THE
// STRING rather than the comment — quadratic on any real document (1 MiB of 131,072 well-formed
// `<!--a-->` comments: 5m53s). R2-P1-02: comment removal ran per-fragment, AFTER block-splitting, so
// a comment spanning a blank line / list-item run / heading→paragraph boundary was cut in half by the
// splitter before removal ever saw it whole — the opening half vanished, the closing half rendered as
// visible prose. The fix: commentTerminatorEnd() replaces both terminator searches with one linear
// scan (used by escapeInline, removeHtmlComments, AND the new removeDocumentComments), and comment
// removal now runs document-wide, BEFORE block-splitting, in removeDocumentComments() — fence-aware,
// code-span-aware, and dead-tag(`inTag`)-aware, so it can't repeat round 1's P2-03 mistake. That same
// move is also what makes R2-P2-03 (an empty block for a comment-only line) and R2-P2-04 (an
// unterminated comment's true extent) fall out for free: block-splitting never sees a line that
// removal already emptied.

test('🔴 #496 round 3 — R2-P1-01: linear on 1 MiB of WELL-FORMED comments (the quadratic shape)', () => {
  // The exact failing input from the review: not the one shape (all-`<!--`, no closer) the round-2
  // perf test covered, but 131,072 separate, individually well-formed `<!--a-->` comments — the shape
  // that was 352,756.7ms (5m53s) before this fix, because `indexOf('--!>', …)` alone paid a
  // full-suffix scan at every one of them (no `--!>` anywhere in the document to find it early).
  const input = '<!--a-->'.repeat(131072);                    // exactly 1 MiB
  const t0 = process.hrtime.bigint();
  const html = bodyHtml(input);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(html, '', 'every comment is well-formed and empty; nothing is left to render');
  assert.ok(ms < 200, `expected < 200ms, got ${ms.toFixed(1)}ms`);
});

test('🔴 #496 round 3 — R2-P1-01: linear on 1 MiB of ordinary one-comment-per-line prose', () => {
  const input = '<!-- x -->\n'.repeat(95325);                 // ~1 MiB, one comment per line
  const t0 = process.hrtime.bigint();
  bodyHtml(input);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, `expected < 200ms, got ${ms.toFixed(1)}ms`);
});

test('🔴 #496 round 3 — R2-P1-01: linear on 1 MiB of `<!--` and of `<` (no comment ever closes)', () => {
  // 🔴 round 5 (R4-P3-07): ratio form, not an absolute `ms < 200` — see the sibling test above for why.
  for (const unit of ['<!--', '<']) {
    const at = (bytes) => unit.repeat(Math.floor(bytes / unit.length));
    const time = (inp) => { const t0 = process.hrtime.bigint(); bodyHtml(inp); return Number(process.hrtime.bigint() - t0) / 1e6; };
    time(at(262144));
    const t256 = Math.max(time(at(262144)), 0.001);
    const t1m = time(at(1048576));
    const ratio = t1m / t256;
    assert.ok(ratio <= 6, `${JSON.stringify(unit)}: expected ~4× (linear), got ${ratio.toFixed(1)}× (256KiB=${t256.toFixed(2)}ms, 1MiB=${t1m.toFixed(2)}ms)`);
    assert.ok(t1m < 5000, `${JSON.stringify(unit)}: expected well under 5s, got ${t1m.toFixed(1)}ms — a true blow-up`);
  }
});

test('🔴 #496 round 3 — R2-P1-01: linear on 1 MiB of backticks (codeSpanRanges must not blow up)', () => {
  const input = '`'.repeat(1048576);
  const t0 = process.hrtime.bigint();
  bodyHtml(input);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 200, `expected < 200ms, got ${ms.toFixed(1)}ms`);
});

test('🔴 #496 round 3 — R2-P1-01: 256 KiB→1 MiB scales ~linearly (ratio ≤ ~5×, not 16×)', () => {
  // 🩸 round 6 (R5-P3-05 / task item 3): this is the RATIO form of the ONE input shape — 131,072
  // separate, individually well-formed `<!--a-->` comments, all on ONE line — that reproduces round
  // 2's real quadratic (5m53s at 1 MiB; see the sibling ABSOLUTE test right above this one, "linear on
  // 1 MiB of WELL-FORMED comments"). The round-5 review measured this exact shape against a scratch
  // copy with round-2's pre-fix scanner (two independent full-suffix `indexOf` calls) put back:
  // ratio 16.19× (this assertion's `<= 6` catches it) and 295,013 ms at 1 MiB (the sibling absolute
  // test's `< 200` catches it too) — so BOTH forms already guard this shape, and round 6 keeps both:
  // the review's own note is "do not convert [the absolute one] to ratio-only, do not raise its bound".
  // The `t1m < 5000` companion below matches every OTHER ratio-form test in this file (round 4/5) —
  // this was the one ratio test missing it, and a bare `ratio <= 6` alone is not itself a defence
  // against a true multi-second blow-up if warm-up ever let `t256` land anomalously large.
  const unit = '<!--a-->';
  const at = (bytes) => unit.repeat(Math.floor(bytes / unit.length));
  const time = (input) => {
    const t0 = process.hrtime.bigint();
    bodyHtml(input);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  time(at(262144));                                            // warm up (JIT)
  const t256 = Math.max(time(at(262144)), 0.001);
  const t1m = time(at(1048576));
  const ratio = t1m / t256;
  assert.ok(ratio <= 6, `expected ~4× (linear), got ${ratio.toFixed(1)}× (256KiB=${t256.toFixed(2)}ms, 1MiB=${t1m.toFixed(2)}ms)`);
  assert.ok(t1m < 5000, `expected well under 5s even under load, got ${t1m.toFixed(1)}ms — a true blow-up`);
});

test('🔴 #496 round 4 — linear on 1 MiB of `<!--` followed by many dashes, and of a mixed corpus', () => {
  // Two more adversarial shapes from the round-3 review's own probe list, now exercised post-round-4:
  // an opener immediately followed by a long dash run (the abrupt-close scan's `while (s[j]==='-')`
  // must not itself be quadratic), and a corpus mixing well-formed comments, prose, fences and stray
  // `<`/`>` (nothing here should make escapeInline's or bodyHtml's line loop re-scan the same ground).
  // 🔴 round 5 (R4-P3-07): ratio form, not an absolute `ms < 200` — see the sibling tests above.
  const shapes = [
    { name: 'dash-run', at: (bytes) => '<!--' + '-'.repeat(Math.max(0, bytes - 4)) },   // never closes
    { name: 'mixed corpus', at: (bytes) => {
        const unit = 'Hello <!-- a --> world.\n```\n<!-- code, not a comment -->\n```\n<x <!-- -->y>\n';
        return unit.repeat(Math.max(1, Math.round(bytes / unit.length)));
      } },
  ];
  for (const { name, at } of shapes) {
    const time = (inp) => { const t0 = process.hrtime.bigint(); bodyHtml(inp); return Number(process.hrtime.bigint() - t0) / 1e6; };
    time(at(262144));
    const t256 = Math.max(time(at(262144)), 0.001);
    const t1m = time(at(1048576));
    const ratio = t1m / t256;
    assert.ok(ratio <= 6, `${name}: expected ~4× (linear), got ${ratio.toFixed(1)}× (256KiB=${t256.toFixed(2)}ms, 1MiB=${t1m.toFixed(2)}ms)`);
    assert.ok(t1m < 5000, `${name}: expected well under 5s even under load, got ${t1m.toFixed(1)}ms — a true blow-up`);
  }
});

test('🔴 #496 round 3 — R2-P1-02: a comment spanning a BLANK LINE is removed whole, not leaked in half', () => {
  // The review's own failing input. Round 2 (pre-fix): '<p>Hello.</p>\n<p></p>\n<p>more notes --&gt;</p>\n<p>Bye.</p>'
  // — the opening half silently deleted, "more notes" leaked onto the page. Fixed: byte-identical to
  // round 1's (correct) answer.
  const html = bodyHtml('Hello.\n\n<!-- TODO:\nstill thinking\n\nmore notes -->\n\nBye.');
  assert.equal(html, '<p>Hello.</p>\n<p>Bye.</p>');
});

// 🩸 round 4 (PR #28 review round 3's design, eliminating the class rather than patching it): this
// used to assert that a comment splicing TWO SEPARATE LIST ITEMS together across a source newline —
// "- one <!-- note" is item 1, "- two --> tail" is item 2 — was removed as one span, merging the two
// items' surviving text into a single `<li>`. That relied on the now-deleted document-wide textual
// pre-pass: it is exactly the kind of cross-block splicing round 3 eliminates, because it is what let
// a document-wide deletion disagree with the block parser about where one list item ends and the next
// begins (the same family of disagreement as R3-P2-01/02/03). Under the round-3 model, `<!--` here is
// NOT a block-level open (it doesn't start item 1's text — "one " precedes it), so it is scoped to
// item 1's OWN text, unterminated THERE (item 1 has no `-->` of its own) — literal, per point 3. Item
// 2's text has no `<!--` of its own either, so its own stray `-->` is just an ordinary `>` to escape.
// Three independent items, none of them merged.
test('🔴 #496 round 4 — a comment opening mid-item does not span into the NEXT list item', () => {
  const html = bodyHtml('- one <!-- note\n- two --> tail\n- three');
  assert.equal(html, '<ul class="st-list"><li>one &lt;!-- note</li><li>two --&gt; tail</li><li>three</li></ul>');
});

test('🔴 #496 round 4 — a block comment that DOES open at a list item\'s own front still spans items', () => {
  // Contrast with the test above: here `<!--` IS the first thing after the marker on item 1's own
  // line, so this genuinely is a round-3 block-level HTML-comment block (case 1 of the design) — it
  // consumes whole lines, list markers and all, through the line that closes it, same as it would at
  // the top level. Only "three" survives as an item.
  const html = bodyHtml('- <!-- hidden\n- still hidden -->\n- three');
  assert.equal(html, '<ul class="st-list"><li>three</li></ul>');
});

// 🩸 round 4: this used to assert a comment merging a HEADING and the paragraph after it into one
// `<h1>` — again the deleted document-wide pre-pass splicing across a block boundary the block parser
// itself would never have joined. `<!--` here does not start the heading's own body (h[2] is
// "H <!-- note", not "<!-- note"), so it is scoped to the heading's OWN inline text: unterminated
// there (no `-->` in "H <!-- note"), left literal (point 3). The heading still emits (its inline
// result isn't empty — R3-P2-02 only drops a heading whose ENTIRE body was the comment, see the
// R3-P2-02 test elsewhere in this file), and the paragraph after the blank line is unrelated and
// unaffected — its own stray `-->` is just an ordinary `>` to escape.
test('🔴 #496 round 4 — a comment opening mid-heading does not span into the paragraph after it', () => {
  const html = bodyHtml('# H <!-- note\n\nvisible --> leak');
  assert.equal(html, '<h1>H &lt;!-- note</h1>\n<p>visible --&gt; leak</p>');
});

test('🔴 #496 round 3 — R2-P2-03: a comment-only PARAGRAPH leaves no empty <p></p>', () => {
  assert.equal(bodyHtml('Hello.\n\n<!-- note -->\n\nBye.'), '<p>Hello.</p>\n<p>Bye.</p>');
  assert.equal(bodyHtml('A\n\n<!-- n1 -->\n\n<!-- n2 -->\n\nB'), '<p>A</p>\n<p>B</p>');
});

test('🔴 #496 round 3 — R2-P2-03: a comment-only HEADING never becomes an empty <h1></h1>', () => {
  const html = bodyHtml('# <!-- note -->');
  assert.doesNotMatch(html, /<h1>\s*<\/h1>/);
});

test('🔴 #496 round 3 — R2-P2-03: a comment-only LIST ITEM never becomes an empty <li></li>', () => {
  const html = bodyHtml('- <!-- note -->\n- real');
  assert.equal(html, '<ul class="st-list"><li>real</li></ul>');
  assert.doesNotMatch(html, /<li>\s*<\/li>/);
});

test('🔴 #496 round 3 — R2-P2-03: a comment-only QUOTE LINE never becomes an empty blockquote', () => {
  const html = bodyHtml('> <!-- note -->');
  assert.equal(html, '');
});

test('🔴 #496 round 4 — a block comment opened inside a blockquote spans quote lines, like at top level', () => {
  const html = bodyHtml('> quoted\n> <!-- hidden\n> still hidden -->\n> more quote');
  assert.equal(html, '<blockquote class="st-quote"><p>quoted more quote</p></blockquote>');
});

test('🔴 #496 round 4 — a fence-looking line INSIDE a comment block is not a fence', () => {
  // Design point 1's own invariant: once a comment block is open, its lines are never examined for a
  // fence start — only for the terminator. A ``` line here must not open a <pre>/<code>; the whole
  // span (openers, alert(1), all of it) is swallowed by the comment, emitting nothing.
  const html = bodyHtml('<!--\n```js\nalert(1)\n-->\nafter');
  assert.doesNotMatch(html, /<pre|<code/);
  assert.equal(html, '<p>after</p>');
});

// ── round 4 — REVIEW-tile28-r3-2026-09-09.md, R3-P2-01 / R3-P2-02 / R3-P2-03 ────────────────────────
// Round 3 found all three of its own P2 findings were ONE bug wearing three faces: the document-wide
// textual pre-pass (removeDocumentComments) and the later block parser held two independent opinions
// about where a code span / heading / fence started and ended, and a comment deletion made by the
// first opinion could silently change what the second one saw. The fix (this round) doesn't patch any
// of the three individually — it deletes the first opinion. There is no longer a document-wide pass;
// see the "HTML-comment blocks" section in site-core.js and escapeInline's own comment.

test('🔴 #496 round 4 — R3-P2-01: a code span keeps a comment straddling a soft line break opaque', () => {
  // The review's exact failing input. Fixed for free by removing the pre-pass: bodyHtml already joins
  // a paragraph's source lines into one fragment BEFORE inlineHtml() ever runs, so the code span's
  // delimiters (one backtick on each line) meet on the SAME string codeSpanRanges scans, exactly as
  // they always did for any other multi-line code span (this is not comment-specific machinery).
  const html = bodyHtml('`open <!-- x -->\nclose` after');
  assert.equal(html,
    '<p><span class="st-code"><span class="st-mk">`</span>open &lt;!-- x --&gt; close<span class="st-mk">`</span></span> after</p>');
});

test('🔴 #496 round 4 — R3-P2-02: a comment-only heading emits nothing, and a FOLLOWING paragraph is untouched', () => {
  assert.equal(bodyHtml('# <!-- title -->'), '', 'no <h1></h1>, no bare <p>#</p>');
  // The structural regression the review called "worse": `next` used to get merged INTO the heading's
  // paragraph fallback (`<p>#  next</p>`). Now the heading consumes only its own line (dropped
  // entirely) and `next` is exactly its own paragraph — no cross-block anything.
  assert.equal(bodyHtml('# <!-- title -->\nnext'), '<p>next</p>');
});

test('🔴 #496 round 4 — R3-P2-03: comment removal can no longer resurrect a live tag via changed fence recognition', () => {
  // The review's exact minimized failing input. Before round 4: '<p><small></p>' — via the pre-#496,
  // comment-UNRELATED `<small>`/`<br>` allowlist (see inlineHtml's own comment: a legacy IR convention,
  // re-emitting `&lt;small&gt;` back to a bare `<small>` after escapeInline has run) — created here
  // because the document-wide pre-pass deleted text up through an embedded `-->` and left a same-line
  // REMAINDER (" <small>") for the block parser to re-interpret ON ITS OWN, as if it were ordinary text
  // that had always stood alone. Round 4 removed the document-wide pre-pass and, with it, ALSO
  // discarded that remainder outright (R4-P2-01) — so this test used to assert `''`, nothing surviving.
  //
  // 🩸 round 5 (R4-P2-01): discarding the remainder was itself a separate bug — it deletes authored
  // text with no trace, on a well-formed comment where the author did nothing wrong. The fix keeps the
  // remainder and re-attaches it as an ordinary line (commentBlockRemainder / reattachCommentRemainder),
  // which then falls into the SAME per-line + inline dispatch any real line already goes through — here,
  // a bare paragraph whose only content is the literal text " <small>". `<small>` reaches inlineHtml
  // exactly as it would if the comment above it had never existed at all (bodyHtml('plain <small>') →
  // '<p>plain <small></p>' — same allowlist, same result, no comment anywhere), which is BACK to the
  // pre-round-4 shape and is the CORRECT one: `<small>` here is written CONTIGUOUSLY by the author, on
  // ONE physical line, entirely OUTSIDE the comment span that closed just before it — it was never split
  // across the deletion boundary the way R1-P2-03's actual attack shape (`<sm<!-- -->all>`, see the round
  // 2 test elsewhere in this file, still fully escaped) splices two dead half-tags into one live spelling.
  // The safety property R3-P2-03 actually cared about — comment removal may never SYNTHESIZE a tag
  // spelling from fragments that were never adjacent in the source — still holds and is asserted below
  // directly, rather than by the now-wrong proxy "no live <small> at all".
  const html = bodyHtml('<!--\n````> <!--> <small>');
  assert.equal(html, '<p><small></p>');
  assert.equal(html, bodyHtml('plain <small>').replace('plain ', ''),
    'the allowlisted tag here behaves identically to the SAME contiguous text with no comment nearby at all');
  // The actual R1-P2-03 attack shape (a tag SPLIT by a comment) must still never produce a live tag —
  // reconfirmed here rather than assumed; the round-2 test elsewhere in this file covers it in full.
  assert.doesNotMatch(bodyHtml('<sm<!-- -->all>'), /<small>/, 'a comment-SPLIT spelling must never become live');
});

test('🔴 #496 round 3 — differential: byte-identical to pre-#496 `main` on the round-1 attack corpus', () => {
  // Reproduces the review's three-build harness inline: a hand-maintained "BEFORE" reference — the
  // literal output this renderer gave every one of these inputs before issue #496's comment logic
  // existed at all (no comment recognized as a comment; every `<`/`>` just escaped as encountered) —
  // asserted against the CURRENT bodyHtml(). These are exactly round 1's "holds up under attack" list
  // plus the round-2 P2-02/03/04 review inputs; every one must still be byte-identical to BEFORE.
  const cases = [
    ['`<!-- x -->`', '<p><span class="st-code"><span class="st-mk">`</span>&lt;!-- x --&gt;<span class="st-mk">`</span></span></p>'],
    ['<sm<!-- -->all>visible</sm<!-- -->all>', '<p>&lt;sm&lt;!-- --&gt;all&gt;visible&lt;/sm&lt;!-- --&gt;all&gt;</p>'],
    ['<br<!-- -->>after', '<p>&lt;br&lt;!-- --&gt;&gt;after</p>'],
    ['    <!-- literal indented code -->', '<p>&lt;!-- literal indented code --&gt;</p>'],
    ['<scr<!-- -->ipt>alert(1)</script>', '<p>&lt;scr&lt;!-- --&gt;ipt&gt;alert(1)&lt;/script&gt;</p>'],
  ];
  for (const [input, expected] of cases) assert.equal(bodyHtml(input), expected, JSON.stringify(input));
});

// ── round 5 — REVIEW-tile28-r4-2026-09-09.md, R4-P2-01 / R4-P2-02 ──────────────────────────────────
// R4-P2-01: an HTML-comment block still swallows every line it spans whole, but text AFTER the
// terminator on its CLOSING line is not comment text — it is the surviving content of whichever
// construct (bare line / list item / quoted line) the block opened inside, and round 4 discarded it
// silently (19.7% content loss on a generated well-formed-comments corpus, per the round-4 review's
// fuzz). The fix re-attaches it — see commentBlockRemainder / reattachCommentRemainder in site-core.js.

test('🔴 #496 round 5 — R4-P2-01: a bare comment-block line keeps the text after its own terminator', () => {
  assert.equal(bodyHtml('<!-- note --> Visible text'), '<p>Visible text</p>');
});

test('🔴 #496 round 5 — R4-P2-01: a list item opened by a comment keeps its own remaining text, and the list stays one list', () => {
  const html = bodyHtml('- <!-- note --> real item\n- second');
  assert.equal(html, '<ul class="st-list"><li>real item</li><li>second</li></ul>');
});

test('🔴 #496 round 5 — R4-P2-01: a quote line opened by a comment keeps its own remaining text', () => {
  assert.equal(bodyHtml('> <!-- n --> quoted'), '<blockquote class="st-quote"><p>quoted</p></blockquote>');
});

test('🔴 #496 round 5 — R4-P2-01: a multi-line block comment keeps the tail of its closing line', () => {
  // The review's own exact failing input (`'<!-- a\\n\\n\\n\\n--> tail'` → main gave `''`).
  assert.equal(bodyHtml('<!-- a\n\n\n\n--> tail'), '<p>tail</p>');
});

test('🔴 #496 round 5 — R4-P2-01: a comment interrupting a paragraph leaves its own tail as a fresh, separate paragraph', () => {
  // The comment-open line is a genuine block start (isBlockStart), so it always ends whatever
  // paragraph was in progress first — "<div" and its own remainder ("after") are two separate <p>s,
  // never spliced into one another (that splicing is exactly what R3-P2-01/02/03 forbid).
  assert.equal(bodyHtml('<div\n<!-- x --> after'), '<p>&lt;div</p>\n<p>after</p>');
});

test('🔴 #496 round 5 — R4-P2-01: a block comment closing on a line that also opens a fence — the fence must still open', () => {
  const html = bodyHtml('<!-- note -->```\ncode\n```');
  assert.equal(html, '<pre class="st-code"><code>code</code></pre>');
});

test('🔴 #496 round 5 — R4-P2-01: the block detector only fires on `<!--` as the line\'s own first content — mid-line stays inline and keeps its tail', () => {
  // Contrast case the round-4 review named explicitly (R4-P3-10): a heading is never block-level (its
  // `#` marker is not one of the stripped prefixes commentBlockCandidate recognises), so `<!--` here
  // starts mid-line by construction and is handled entirely by escapeInline's own inline comment
  // consumption — which already kept its tail, verbatim, since round 3. This is the behaviour the
  // block-level fix (above) had to match, not invent.
  assert.equal(bodyHtml('# <!-- n --> Heading text'), '<h1> Heading text</h1>');
});

test('🔴 #496 round 5 — R4-P2-01: representative tightened-fuzz shape — every word outside a comment span survives, whatever the prefix', () => {
  const html = bodyHtml('alpha\n\n<!-- bravo --> charlie\n\n- <!-- delta --> echo\n- foxtrot\n\n> <!-- golf --> hotel');
  for (const word of ['alpha', 'charlie', 'echo', 'foxtrot', 'hotel']) assert.match(html, new RegExp(word), word);
  assert.doesNotMatch(html, /bravo|delta|golf/, 'comment TEXT itself must never survive, only what came after it');
});

test('🔴 #496 round 5 — R4-P2-01: a fully-consumed comment (no remainder) still leaks nothing — the R2-P2-03 guards are unaffected', () => {
  // Regression guard: remainder-reattachment must never fire when there IS no remainder (an empty or
  // all-whitespace tail), or the empty-block fix from round 3 (R2-P2-03) would quietly regress.
  assert.equal(bodyHtml('- <!-- note -->\n- real'), '<ul class="st-list"><li>real</li></ul>');
  assert.equal(bodyHtml('> <!-- note -->'), '');
  assert.doesNotMatch(bodyHtml('- <!-- note -->\n- real'), /<li>\s*<\/li>/);
});

// R4-P2-02: both comment-block guards now treat a TAB as CommonMark does — up to 4 columns, always
// reaching column ≥4 from any start column 0-3 — instead of counting spaces only, which let a tab fall
// through both the "≤3 columns → comment block" and the "4+ columns → literal indented" paths and
// land on neither, producing a bare `<p></p>` (a real, visible artifact on a public page).

test('🔴 #496 round 5 — R4-P2-02: a TAB-indented comment-only line is literal, escaped — never an empty <p></p>', () => {
  for (const input of ['\t<!-- note -->', ' \t<!-- note -->', '\t <!-- note -->']) {
    assert.equal(bodyHtml(input), '<p>&lt;!-- note --&gt;</p>', JSON.stringify(input));
    assert.doesNotMatch(bodyHtml(input), /^<p>\s*<\/p>$/, JSON.stringify(input));
  }
});

test('🔴 #496 round 5 — R4-P2-02: a plain 4-space indent still takes the same literal path as a tab', () => {
  // Reconfirms the pre-existing space-only carve-out (P2-04) is unchanged now that isCommentBlockOpen
  // and the paragraph `indented` check both route through the shared leadingIndentCols column-counter.
  assert.equal(bodyHtml('    <!-- literal indented code -->'), '<p>&lt;!-- literal indented code --&gt;</p>');
});

// ── round 6 — REVIEW-tile28-r5-2026-09-09.md, R5-P2-01 / R5-P2-02 ──────────────────────────────────
// R5-P2-01: `nextCloser` is computed ONCE, over the lines as they were BEFORE round 5's own
// `reattachCommentRemainder` ever mutates one of them. If a reattached remainder itself opens a fresh,
// unterminated `<!--` (the second half of `'<!-- a --> <!-- b'`), the stale `nextCloser[closeIdx]`
// still says the (now-rewritten) line has a closer, so the caller treats the remainder as a TERMINATED
// comment block on its own — one that yields no further remainder — and it vanishes with no trace: the
// exact silent-deletion family round 4 was fixed to close, on a shape an author reaches by an ordinary
// typo (forgetting to close a second, later comment). Fixed by recomputing `nextCloser[closeIdx]` for
// the one index the mutation touched, immediately after the mutation — see reattachCommentRemainder
// and its four call sites in site-core.js.

test('🔴 #496 round 6 — R5-P2-01: a bare remainder that itself opens an unterminated `<!--` stays literal, never vanishes', () => {
  assert.equal(bodyHtml('<!-- a --> <!-- b'), '<p>&lt;!-- b</p>');
});

test('🔴 #496 round 6 — R5-P2-01: the same shape inside a list item — only the malformed opener is literal, the list survives', () => {
  assert.equal(bodyHtml('- <!-- a --> <!-- b\n- second'), '<ul class="st-list"><li>&lt;!-- b</li><li>second</li></ul>');
});

test('🔴 #496 round 6 — R5-P2-01: the same shape inside a quote — only the malformed opener is literal, the quote survives', () => {
  assert.equal(bodyHtml('> <!-- a --> <!-- b\n> second'), '<blockquote class="st-quote"><p>&lt;!-- b second</p></blockquote>');
});

test('🔴 #496 round 6 — R5-P2-01: the alternative closer `--!>` hits the same stale-index bug and is fixed the same way', () => {
  assert.equal(bodyHtml('<!-- a --!> <!-- b'), '<p>&lt;!-- b</p>');
});

test('🔴 #496 round 6 — R5-P2-01: the abrupt-empty-comment form (`<!-->`) also leaves its own unterminated remainder literal', () => {
  assert.equal(bodyHtml('<!--> <!--'), '<p>&lt;!--</p>');
});

test('🔴 #496 round 6 — R5-P2-01: an ordered-list item hits the same bug and is fixed the same way', () => {
  assert.equal(bodyHtml('1. <!-- alpha --><!-- delta'), '<ol class="st-list"><li>&lt;!-- delta</li></ol>');
});

test('🔴 #496 round 6 — R5-P2-01: the control — text BEFORE the second opener already survived, and still does', () => {
  // The review's own proof that this is a mechanism bug, not a policy question: move one word in front
  // of the second opener and the same text always survived, on both `cur` and round 6. This test is the
  // one guard in the whole suite that puts two comments on one line (R5-P3-08 named that gap directly).
  assert.equal(bodyHtml('<!-- a --> b <!-- c'), '<p>b &lt;!-- c</p>');
});

test('🔴 #496 round 6 — R5-P2-01: targeted corpus — a document whose LAST opener has no closer never loses that opener', () => {
  // A small deterministic slice of the review's 120,000-input "unterminated-opener" corpus (which
  // measured badCur: 84,138 / 120,000 = 70.1% before this fix, badMain: 0, badR4: 120,000): every one
  // of these has a well-formed comment followed by an opener with no closer anywhere in the document.
  // The fixed behaviour must match `main`'s own invariant — the unterminated opener's own text is never
  // silently deleted — on every shape a container can start with.
  const shapes = [
    '<!-- a --> <!-- b',
    '<!-- a -->\n\n<!-- b',
    '- <!-- a --> <!-- b\n- x',
    '> <!-- a --> <!-- b',
    '1) <!-- a --> <!-- b',
    '  - <!-- a --> <!-- b',
    '<!-- a\nb --> <!-- c',
  ];
  for (const s of shapes) {
    const html = bodyHtml(s);
    assert.match(html, /&lt;!--/, `the unterminated opener must render literal, escaped, somewhere: ${JSON.stringify(s)} -> ${JSON.stringify(html)}`);
  }
});

// R5-P2-02: `leadingIndentCols` only widened the TAB case in round 5 — every OTHER `\s` character
// (NBSP U+00A0, the ideographic space U+3000, em space U+2003, VT, FF) still counted as zero columns,
// so a comment-only line indented with one of those fell into neither the comment-block path (which
// wants `<4` columns) nor the literal-4-space carve-out (which wants `>=4`), and its content trimmed
// away to a bare, visible `<p></p>`. U+3000 is not exotic here: two full-width spaces are the ordinary
// Chinese/Japanese paragraph indent, so a `\u3000\u3000<!-- note -->` line is unremarkable prose.
// Exotic whitespace below is written as its escape, not the literal byte, so every failing input here
// can be read and copied without ambiguity (the review's own convention).

test('\ud83d\udd34 #496 round 6 \u2014 R5-P2-02: a comment-only line indented with NBSP, U+3000, em space, VT or FF consumes clean \u2014 no empty <p></p>', () => {
  const cases = [
    ['\u00A0<!-- n -->', 'NBSP'],
    ['\u3000<!-- n -->', 'ideographic space (CJK paragraph indent)'],
    ['\u2003<!-- n -->', 'em space'],
    ['\u000B<!-- n -->', 'VT'],
    ['\u000C<!-- n -->', 'FF'],
  ];
  for (const [input, label] of cases) {
    assert.equal(bodyHtml(input), '', label);
    assert.doesNotMatch(bodyHtml(input), /^<p>\s*<\/p>$/, label);
  }
});

test('\ud83d\udd34 #496 round 6 \u2014 R5-P2-02: four columns of that same whitespace is literal, escaped \u2014 consistent with the space rule', () => {
  // Mirrors the pre-existing space/tab carve-out at P2-04: FOUR ideographic spaces reach column 4
  // (1 column each, per this rule) and take the SAME literal-indented path a 4-space line already does.
  assert.equal(bodyHtml('\u3000\u3000\u3000\u3000<!-- n -->'), '<p>&lt;!-- n --&gt;</p>');
});

test('\ud83d\udd34 #496 round 6 \u2014 R5-P2-02: mixed NBSP+tab reaches column 4 the same way a mixed space+tab already did', () => {
  assert.equal(bodyHtml('\u00A0\t<!-- n -->'), '<p>&lt;!-- n --&gt;</p>');
  assert.equal(bodyHtml('\t\u00A0<!-- n -->'), '<p>&lt;!-- n --&gt;</p>');
});

test('\ud83d\udd34 #496 round 6 \u2014 R5-P2-02: an ordinary CJK-indented paragraph with no comment at all is unaffected', () => {
  assert.equal(bodyHtml('\u3000\u3000plain text'), '<p>plain text</p>');
});

console.log('\nsitetile: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
