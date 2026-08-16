// sitetile model tests — plain Node, zero framework (the family discipline: pure model, node-runnable).
//   run: node site-core.test.js   (or: npm test)

import assert from 'node:assert/strict';
import {
  parseSite, serializeSite, isSiteFile, renderSiteToHtml, parseParams, FRONTMATTER_KEY,
  ctaButtonsHtml, linkButtonsHtml,
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
  assert.ok(html.includes('<section class="st-grid" data-cols="3"'), 'grid + cols');
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
  assert.ok(html.includes('<section class="st-embed"><div class="custom">verbatim ## not a heading</div></section>'), 'embed verbatim');
});

test('embed wide: `embed wide` modifier → .is-wide (full-bleed band); plain embed unchanged', () => {
  const wide = parseSite('## R\n%% sitetile: embed wide %%\n<div>x</div>').sections[0];
  assert.equal(wide.type, 'embed');
  assert.ok(renderSiteToHtml(parseSite('## R\n%% sitetile: embed wide %%\n<div>x</div>'))
    .includes('<section class="st-embed is-wide"><div>x</div></section>'), 'wide → is-wide');
  assert.ok(renderSiteToHtml(parseSite('## R\n%% sitetile: embed %%\n<div>x</div>'))
    .includes('<section class="st-embed"><div>x</div></section>'), 'plain unchanged');
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
  assert.ok(renderSiteToHtml(parseSite(GRAD)).includes('<section class="st-hero" data-media="logo"'), 'logo variant');
  const def = renderSiteToHtml(parseSite('---\nsitetile-page: t\n---\n\n## H\n%% sitetile: hero %%\nhi\n'));
  assert.ok(def.includes('<section class="st-hero" data-media="avatar"'), 'default avatar');
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
const HEADLESS = [
  '---', 'sitetile-page: t', '---', '',
  '## Co', '',
  '| 法人名 | 株式会社SODAART |',
  '| 資本金 | 500万円 |',
  '| 事業内容 | - イラスト<br>- ゲーム<br>- 動画 |', '',
  'A paragraph with a | pipe | inside stays prose.', '',
].join('\n') + '\n';

test('render: headerless table → <table data-headless> all-<td>, no <thead>', () => {
  const html = renderSiteToHtml(parseSite(HEADLESS));
  assert.ok(html.includes('<table class="st-table" data-headless><tbody><tr><td>法人名</td><td>株式会社SODAART</td></tr><tr><td>資本金</td><td>500万円</td></tr>'), 'headerless rows');
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
  ['| 法人名 | 株式会社SODAART |', '| 事業内容 | - イラスト<br>- ゲーム<br>- 動画 |'].forEach((frag) =>
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


console.log('\nsitetile: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
