// card-worker render path — pure unit tests (no edge, no browser). The fetch() shell is thin; the
// brain (resolveHandle + renderCardHTML) is what these lock down.  run: node --test card-worker.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { resolveHandle, renderCardHTML } from './card-worker.mjs';
import { QR_VERSION, CSS } from './card-assets.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARD = [
  '---', 'card-page: inkbrush', 'title: INKB', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 h=2 avatar="https://x/a.jpg" chips="she / they" %% indie comic artist',
  '- [ ] %% card: link w=2 h=2 icon=instagram sub="Sketches" %% [Instagram](https://instagram.com/ink.brush)',
].join('\n') + '\n';

test('resolveHandle: canonical path → handle + canonical cardUrl', () => {
  assert.deepEqual(resolveHandle('card.feelreef.com', '/inkbrush'),
    { handle: 'inkbrush', cardUrl: 'https://card.feelreef.com/inkbrush' });
});

test('resolveHandle: vanity host → mapped handle + that host as cardUrl', () => {
  // 🩸 This used to name a real customer's domain, and it passed for THAT reason rather than for
  // the mechanism's — the binding was a literal in card-worker.mjs, so the test was asserting a
  // fact about our customer list. Remove that customer and it goes red while the code is still
  // perfectly correct. The bindings now live in the store and the map is a parameter, so the test
  // supplies its own and asserts the lookup, which is the thing this function actually promises.
  assert.deepEqual(resolveHandle('card.inkbrush.com', '/', { 'card.inkbrush.com': 'inkbrush' }),
    { handle: 'inkbrush', cardUrl: 'https://card.inkbrush.com' });
});

test('resolveHandle: an unbound host is NOT a card — the control for the test above', () => {
  // Without this, "the lookup works" and "resolveHandle says yes to any bare host" look identical.
  assert.equal(resolveHandle('card.inkbrush.com', '/'), null);
  // 🔴 And the default must be EMPTY, not absent: a caller that forgets the third argument has to
  // fall through to canonical-path routing, never to a stale map or a crash.
  assert.equal(resolveHandle('card.inkbrush.com', '/', undefined), null);
});

test('resolveHandle: a path segment still wins on a host with no binding', () => {
  // The vanity lookup must not have eaten the ordinary case on its way past.
  assert.deepEqual(resolveHandle('card.feelreef.com', '/inkbrush', {}),
    { handle: 'inkbrush', cardUrl: 'https://card.feelreef.com/inkbrush' });
});

test('resolveHandle: bare canonical host (no handle) → null (a directory, not a card)', () => {
  assert.equal(resolveHandle('card.feelreef.com', '/'), null);
});

test('resolveHandle: handle is lowercased; port stripped from host', () => {
  assert.deepEqual(resolveHandle('card.feelreef.com:8787', '/INKB'),
    { handle: 'inkb', cardUrl: 'https://card.feelreef.com/inkb' });
});

test('renderCardHTML: title from frontmatter, QR mount points at the external coral, icons resolve', () => {
  const html = renderCardHTML(CARD, { handle: 'inkbrush', cardUrl: 'https://card.inkbrush.com' });
  assert.match(html, /<title>INKB<\/title>/);
  assert.match(html, /data-dynamic-coral="qr"[^>]*data-url="https:\/\/card\.inkbrush\.com"/);
  // consumes the coral as an external, VERSIONED asset — the version in the path is what makes the
  // year-long immutable cache safe (an unversioned immutable URL can never ship a coral fix)
  assert.match(html, new RegExp(`src="/_coral/qr-${QR_VERSION.replace(/\./g, '\\.')}\\.js"`));
  assert.ok(!html.includes('/_coral/qr.js'), 'the unversioned path must not come back');
  assert.ok(html.includes('st-cell-head'), 'link tile rendered');
  assert.ok(/<svg/.test(html), 'an icon SVG made it into the output (icon keys resolve)');
});

test('renderCardHTML: name falls back to handle when frontmatter has no title', () => {
  const html = renderCardHTML('---\ncard-page: x\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n', { handle: 'zed' });
  assert.match(html, /<title>zed<\/title>/);
});

test('footer: the creator\'s own line always; the feelreef credit is DEFAULT OFF', () => {
  const html = renderCardHTML(CARD, { handle: 'inkbrush' });
  const year = new Date().getFullYear();
  assert.match(html, new RegExp(`INKB &copy; ${year}</span>`), 'name © current year, no start year');
  // 🔴 not a platform watermark — a free card must not be taxed with our advertising by default
  assert.ok(!/Powered by/.test(html), 'no feelreef credit unless the creator opts in');
  assert.ok(!/signup\?ref=/.test(html), 'and no referral link either');
});

test('generator: every card declares what built it, and it is NOT the powered-by switch', () => {
  // 🔴 These are different things and the distinction is the whole reason this is unconditional.
  // `Powered by feelreef` is PROMOTION — a visible badge carrying a ?ref= referral, which is the
  // creator's to refuse. `<meta name="generator">` is PROVENANCE, the same field WordPress, Hugo and
  // Astro all emit regardless of any badge setting. Refusing our advertising is not refusing to say
  // what rendered the page.
  //
  // It is also how a tool gets found at all: without it nobody can ask "what is this built with",
  // and a card is otherwise only identifiable by undeclared traces (st- class prefixes, /_coral/,
  // /_yt/, /_icon/). A declared marker is more honest than a page full of fingerprints and no name.
  const off = renderCardHTML(CARD, { handle: 'x' });
  const on = renderCardHTML(CARD.replace('title: INKB', 'title: INKB\npowered-by: on'), { handle: 'x' });
  for (const [name, html] of [['powered-by off', off], ['powered-by on', on]]) {
    assert.match(html, /<meta name="generator" content="feelreef">/, `${name}: no generator`);
  }
  // CONTROL: the two really do differ on the badge, or this proves nothing about independence
  assert.ok(!/Powered by/.test(off) && /Powered by/.test(on), 'setup: the badge must differ between them');
  // 🔴 no version. A version string is the part that turns provenance into an attack-surface signal
  // — it tells a scanner which known holes to try — and it is one more thing to keep in step.
  assert.ok(!/content="feelreef[^"]/.test(off), 'the generator must carry no version');

  // 🔴 The SAME semantics sitetile's SiteLayout already shipped, because two halves of one product
  // must not answer "what made this" two different ways. off/false/no/none removes it entirely, and
  // any other value REPLACES it — so an exported, re-hosted card can say whatever is then true.
  const gen = (v) => {
    const md = CARD.replace('title: INKB', `title: INKB\ngenerator: ${v}`);
    const m = /<meta name="generator" content="([^"]*)">/.exec(renderCardHTML(md, { handle: 'x' }));
    return m ? m[1] : null;
  };
  for (const off of ['off', 'false', 'no', 'none', 'OFF']) {
    assert.equal(gen(off), null, `generator: ${off} should remove the tag`);
  }
  assert.equal(gen('clayfern hand-built'), 'clayfern hand-built', 'any other value replaces it');
  // and it is ESCAPED — this lands inside an attribute and the frontmatter is creator-authored
  assert.equal(gen('"><script>x</script>'), '&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
});

test('footer: `powered-by: on` opts into the referral credit (?ref=<handle>)', () => {
  const html = renderCardHTML(CARD.replace('title: INKB', 'title: INKB\npowered-by: on'), { handle: 'inkbrush' });
  assert.match(html, /\|&nbsp;&nbsp;Powered by/, 'single line, pipe-separated');
  assert.match(html, /feelreef\.com\/signup\?ref=inkbrush/, 'carries the creator\'s ref so a signup rewards them');
});

test('footer: `since:` frontmatter adds the founding year → "© 2013–2026"', () => {
  const html = renderCardHTML(CARD.replace('title: INKB', 'title: INKB\nsince: 2013'), { handle: 'inkbrush' });
  assert.match(html, new RegExp(`INKB &copy; 2013–${new Date().getFullYear()}`));
});

test('accent: one frontmatter hex derives the whole --cp-accent-* family; absent → no override', () => {
  const html = renderCardHTML(CARD.replace('title: INKB', 'title: INKB\naccent: #31bbbb'), { handle: 'x' });
  assert.match(html, /<style id="cp-accent">:root\{--cp-accent:#31bbbb/);
  for (const v of ['bg', 'border', 'glow', 'bright']) {
    assert.match(html, new RegExp(`--cp-accent-${v}:color-mix\\(in srgb,#31bbbb`), `derives --cp-accent-${v}`);
  }
  // NB: assert on the id'd override block, not on "--cp-accent" or even ":root{--cp-accent" anywhere
  // — the bundled stylesheet ships its own `:root{--cp-accent:#0a8c8e}` default, so looser checks
  // pass even with no override at all ([[validate-the-ruler-before-blaming-the-worker]]).
  assert.ok(!/id="cp-accent"/.test(renderCardHTML(CARD, { handle: 'x' })), 'no accent override when unset');
});

test('bento: a titled LANE opens its own block; the face lane is the unlabelled one', () => {
  // The block heading used to be a `section` CELL taking w=6 h=1 of a grid it was not part of.
  // It is a lane now — the same machine that already carried drawers.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: link w=2 h=2 %% [A](https://a.example)', '',
    '## English', '',
    '- [ ] %% card: link w=2 h=2 %% [B](https://b.example)', '',
    '## 日本語', '',
    '- [ ] %% card: link w=2 h=2 %% [C](https://c.example)',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.equal((html.match(/class="st-grid"/g) || []).length, 3, '3 blocks: face + 2 labelled');
  assert.equal((html.match(/class="st-grid-label"/g) || []).length, 2, 'only the 2 titled lanes carry labels');
  assert.ok(!/card: section/.test(html) && !/cp-section /.test(html), 'there is no section cell any more');
});

test('bleed: a `bleed` cell renders full-width OUTSIDE the bento blocks', () => {
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: embed bleed kind=slider images="https://i.example/1.png" %%',
    '- [ ] %% card: link w=2 h=2 %% [A](https://a.example)',
  ].join('\n') + '\n';
  // measure MARKUP only — the stylesheets mention every class name, so raw indexOf on the whole
  // document finds a CSS rule, not the element ([[validate-the-ruler-before-blaming-the-worker]]).
  const markup = renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(markup, /<div class="st-bleed">/);
  assert.ok(markup.indexOf('<div class="st-bleed">') < markup.indexOf('<section class="st-grid"'),
    'the bleed block leads, before any bento');
});

test('bubbles: the ancestor 表演 is carried verbatim — pops from the tail origin, not a crossfade', () => {
  // 🔴 This used to say `kind=slider`, and that WAS the bug: a bespoke pop built for one card held
  // the generic name, so every imported carousel inherited a character's mouth. Renamed to
  // `bubbles`; the animation below is unchanged, which is the point of keeping this assertion.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png,https://i.example/3.png" %%',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.match(html, /transform-origin:53% 76%/, "the bubble's tail anchor");
  assert.match(html, /transform:scale\(0\.001\)/, 'pops from nothing — NOT an opacity-only crossfade');
  assert.match(html, /animation:st-carousel-slide 15s infinite/, '3 images × 5s hold = the ancestor cycle');
  assert.match(html, /max-width:888px\).*transform-origin:53% 33%/, 'the narrow-screen retarget');
});

test('🔴 slider is the COMMON carousel — swipeable, with prev/next, and no JS', () => {
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: embed w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png,https://i.example/3.png" %%',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.equal((html.match(/<figure id=/g) || []).length, 3);
  assert.match(html, /scroll-snap-type:x mandatory/, 'the browser does the swiping');
  assert.equal((html.match(/st-slide-nav/g) || []).length > 0, true, 'prev/next missing');
  // 🔴 NO fixed aspect: chodaict read Incrediville as 6x6(slide*5) AND 3x6(slide*4) — same widget,
  // two heights, because the pictures differ. A pinned ratio here is 「width decides shape」 again.
  assert.ok(!/\.st-slider\{[^}]*aspect-ratio/.test(html), 'the slider pinned an aspect ratio');
  // 🔴 the controls are ANCHORS, so they work before any script and survive a dead one
  assert.match(html, /<a class="st-slide-nav st-slide-prev" href="#/);
  assert.ok(!/<script/.test(html.split('st-slider')[1] || ''), 'the slider must need no JS');
  // CONTROL: the pop must NOT appear here — that is the whole point of the split
  assert.ok(!html.includes('st-carousel-slide'), 'the bubble animation leaked into the plain slider');
});

test('CONTROL: a ONE-image slider hides its controls', () => {
  // Controls on a single slide read as broken, and 「next」 pointing at itself is worse than absent.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: embed w=6 kind=slider images="https://i.example/1.png" %%',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.match(html, /\.st-slide-nav,\.st-slider-dots\{display:none\}/);
});

const WITH_DRAWER = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
  '- [ ] %% card: link w=2 h=2 %% [About](#about)',
  '- [ ] %% card: feature w=6 h=3 img="https://i/x.png" href="#about" %%',
  '', '## drawer: about | 關於', '',
  '- [ ] %% card: text %% some **prose** and a [link](https://a.example)',
  '- [ ] %% card: link w=2 h=2 %% [Deeper](#other)',
  '', '## drawer: other', '', '- [ ] %% card: text %% x',
].join('\n') + '\n';

test('drawers: a #id target becomes an overlay trigger on BOTH link and feature cells', () => {
  const html = renderCardHTML(WITH_DRAWER, { handle: 'x' });
  assert.equal((html.match(/data-drawer="about"/g) || []).length, 2, 'the link tile and the feature both open it');
  assert.ok(!/href="#about"[^>]*target="_blank"/.test(html), 'a drawer trigger never navigates away');
  assert.match(html, /data-drawer-panel="about"[^>]*role="dialog"[^>]*aria-modal="true"/);
});

test('🔴 drawers are LEAVES: a drawer cannot open another drawer (depth 1 is structural)', () => {
  const html = renderCardHTML(WITH_DRAWER, { handle: 'x' });
  const panel = /<div class="dc-drawer" id="about"[\s\S]*?(?=<div class="dc-drawer" id="other")/.exec(html)[0];
  assert.ok(!/data-drawer="other"/.test(panel), 'the nested drawer link is dropped, not rendered');
  assert.ok(panel.includes('st-prose'), 'the rest of the drawer still renders');
});

test('drawer prose renders block markdown (paragraphs, bold, links) — not escaped source', () => {
  const html = renderCardHTML(WITH_DRAWER, { handle: 'x' });
  assert.match(html, /<strong>prose<\/strong>/);
  assert.match(html, /<a href="https:\/\/a\.example"[^>]*>link<\/a>/);
});

test('a card with no drawers ships no overlay markup or client', () => {
  const html = renderCardHTML(CARD, { handle: 'x' });
  assert.ok(!html.includes('dc-drawer-layer'), 'zero cost when unused');
});

test('🔴 param names must not contain hyphens — parseParams truncates `a-b=x` to the key `b`', () => {
  // This is a trap for the whole cell vocabulary, not one widget: a hyphenated param silently
  // resolves to undefined, the code falls back to its default, and nothing ever looks broken.
  // Locked here so the next cell type that wants `foo-bar=` finds out at test time.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: video w=6 h=4 channel="UCabcdefghijklmnopqrstuv" %% Latest',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.match(html, /data-yt-channel="UCabcdefghijklmnopqrstuv"/, 'hyphen-free `channel=` resolves');

  const hyphened = md.replace('channel="UC', 'yt-channel="UC');
  assert.match(renderCardHTML(hyphened, { handle: 'x' }), /data-yt-channel="UCabcdefghijklmnopqrstuv"/,
    'and `yt-channel=` happens to truncate to the same key — but never rely on that: keep names hyphen-free');
});

test('video: click-to-load — the poster ships, the YouTube iframe does NOT until someone presses play', () => {
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: video w=6 h=4 yt="dQw4w9WgXcQ" %% Latest',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.ok(!/<iframe/.test(html), 'no iframe in the delivered HTML — YouTube sees nobody until they click');
  // 🔴 This used to assert `i.ytimg.com`, and asserting it was asserting the leak. The poster is a
  // Google-hosted image, so shipping that URL had every visitor's browser announce itself to Google
  // on page load — precisely what click-to-load exists to prevent, coming back in through an <img>.
  // The Worker proxies it now (`/_yt/<id>.jpg`), so the visitor talks only to us until they press
  // play. See yt.test.mjs, "condition 4".
  assert.match(html, /\/_yt\/dQw4w9WgXcQ\.jpg/, 'a poster stands in for it, served from our origin');
  assert.ok(!/i\.ytimg\.com/.test(html), 'the poster must not be fetched from Google by the visitor');
  assert.match(html, /youtube-nocookie\.com/, 'and the player, when built, is the nocookie one');
});

test('backdrop: a card with `backdrop:` gets a fixed dimmed layer; without it, nothing is emitted', () => {
  const base = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '', '- [ ] %% card: text %% hi'].join('\n') + '\n';
  const withBg = base.replace('title: X', 'title: X\nbackdrop: https://cdn/bg.jpg');
  assert.notEqual(withBg, base, 'the fixture must actually differ — a no-op replace would test nothing');
  const html = renderCardHTML(withBg, { handle: 'x' });
  assert.match(html, /class="st-backdrop"/);
  assert.match(html, /background-attachment:fixed/);
  assert.ok(!renderCardHTML(base, { handle: 'x' }).includes('st-backdrop'), 'no backdrop markup when unset');
});

test('a drawer\'s title is its heading AND its accessible name', () => {
  // role="dialog" with no accessible name is announced as an unnamed dialog: the overlay opens and
  // a screen reader says nothing about what opened. The title used to be a `section` cell sitting
  // inside the drawer, which looked right and named nothing.
  const html = renderCardHTML(WITH_DRAWER, { handle: 'x' });
  assert.match(html, /<div class="dc-drawer" id="about"[^>]*aria-labelledby="drawer-about-title"/);
  // 🔴 the panel's id IS the drawer id — that is what makes `:target` (and therefore no-JS opening)
  // work, and what keeps the shareable URL `…#about` rather than `…#drawer-about`.
  assert.match(html, /<h2 class="dc-drawer-title" id="drawer-about-title">關於<\/h2>/);
  // and a drawer with no title points at nothing rather than at a missing id
  assert.ok(!/<div class="dc-drawer" id="other"[^>]*aria-labelledby/.test(html), 'no dangling aria-labelledby');
});

test('prose steps out of the packed grid — no guessed row count, no scrollbox in a scrolling drawer', () => {
  const markup = renderCardHTML(WITH_DRAWER, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  const panel = /<div class="dc-drawer" id="about"[\s\S]*?(?=<div class="dc-drawer" id="other")/.exec(markup)[0];
  assert.match(panel, /<div class="st-bleed"><div class="st-cell st-prose/, 'prose renders full-width, at its own height');
  assert.ok(!/st-prose cp-size-\d+x[2-9]/.test(panel), 'no row-span guessed from character count');
});

test('🔴 the page backdrop is emitted ONCE, and never inside a drawer', () => {
  // renderGrid also renders every drawer's contents, so emitting the backdrop there gave each
  // drawer its own copy of the creator's artwork — painted OVER the drawer's own background. The
  // panel measured opaque (getComputedStyle said so) and looked transparent, which is a shape of
  // bug only sampled pixels can settle: painting the panel red changed nothing, and the paint
  // stack showed .st-backdrop sitting above the drawer body.
  const md = WITH_DRAWER.replace('title: X', 'title: X\nbackdrop: https://cdn/bg.jpg');
  const markup = renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.equal((markup.match(/class="st-backdrop"/g) || []).length, 1, 'exactly one backdrop element');
  const layer = /<div class="dc-drawer-layer"[\s\S]*$/.exec(markup)[0];
  assert.ok(!layer.includes('st-backdrop'), 'and not one of them is inside the drawer layer');
});

test('the bundled stylesheet is the one on disk — regenerate after editing either', () => {
  // card-assets.mjs is generated, and a stale bundle is invisible: the page renders, the tests pass,
  // and the change simply is not there. Concatenation order matters too — signet's arrow.css goes
  // last so it wins over the copy minified into the card stylesheet.
  //
  // 🔴 The parts that always hold are checked from COMMITTED files only. CI runs scripts/test.sh
  // against a bare checkout with no `npm install` anywhere, so a test that reads node_modules passes
  // on my machine and fails on every push — which is exactly what it did, five pushes in a row,
  // while I never looked at the light. The sibling guard (no-second-copy.test.mjs) had already
  // solved this with an explicit existsSync skip; I just didn't follow the house rule.
  const here = dirname(fileURLToPath(import.meta.url));
  const disk = readFileSync(join(here, 'card.css'), 'utf8');
  assert.ok(CSS.startsWith(disk + '\n'), 'the bundle must lead with card.css — run: node packages/cardtile/serve/gen-assets.mjs');
  const tail = CSS.slice(disk.length + 1);
  assert.match(tail, /\.signet-arrow__tail\s*\{/, 'and signet\'s arrow must follow it, so its rules win');

  // When the package IS installed, hold the stronger claim: the tail is its arrow.css byte for byte.
  // 🩸 Was `../../sitetile/astro/node_modules/@cvernet/signet` — a reach into a sibling repo's
  // install, written when sitetile lived here. After it graduated the path resolved to nothing, so
  // the STRONGER half of this test (byte-for-byte against the package) silently stopped running and
  // only the weak regex claim was left. It said "(partial: … skipped)" every run and nobody read it.
  // This repo declares @cvernet/signet itself now; the fallback keeps working for a bare checkout.
  const arrowPath = [
    join(here, '../../../node_modules/@cvernet/signet/src/arrow.css'),
    join(here, '../../sitetile/astro/node_modules/@cvernet/signet/src/arrow.css'),
  ].find((p) => existsSync(p)) || '';
  if (!arrowPath) { console.log('    (partial: @cvernet/signet not installed — byte check skipped)'); return; }
  assert.equal(tail, readFileSync(arrowPath, 'utf8'), 'regenerate: node packages/cardtile/serve/gen-assets.mjs');
});

test('the stylesheet is the card\'s own, not the Python era\'s 105KB', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const disk = readFileSync(join(here, 'card.css'), 'utf8');
  const legacy = readFileSync(join(here, 'card.legacy.css'), 'utf8');
  // 🔴 This used to assert the header said "GENERATED by gen-card-css.mjs … never hand-edited". That
  // stopped being true at de0c32b, which renamed the class vocabulary in card.css and not in the
  // generator; re-running it dropped every .st-* rule. The generator is RETIRED (2026-07-30) rather
  // than warned about, because no configuration of it reproduces this file — it reintroduces the
  // legacy light theme either way. A retired thing that still runs is the façade trap, so the test
  // is that it is GONE and that the harness which replaced it is present.
  assert.match(disk, /HAND-MAINTAINED/, 'card.css must say what it actually is');
  // 🔴 …in three lines. The full reasoning lives in CSS-PROVENANCE.md because this file is SERVED to
  // every visitor of every card: the first version of that header was 1.9KB of prose shipped on
  // every page load. Provenance belongs next to the artifact, not inside the download.
  assert.ok(disk.indexOf('*/') < 400, 'card.css\'s header must stay short — it ships to every visitor');
  assert.ok(existsSync(join(here, 'CSS-PROVENANCE.md')), 'the reasoning must exist somewhere');
  assert.ok(!existsSync(join(here, 'gen-card-css.mjs')),
    'gen-card-css.mjs is back — it cannot produce this file and running it damages three live cards');
  assert.ok(existsSync(join(here, '../verify/css-equivalence.mjs')),
    'the equivalence harness is the replacement for the generator; without it a stylesheet edit has no gate');
  assert.ok(disk.length < legacy.length * 0.25,
    `card.css should be a small fraction of the legacy sheet (is ${disk.length} vs ${legacy.length})`);
  // 🔴 the legacy sheet is a REFERENCE to diff against, never a dependency. If it is ever served
  // again the card is leaning on the retired backend's stylesheet, which is the façade trap.
  assert.ok(!CSS.includes('cp-feed-reader'), 'the app-sized stylesheet is not what a card downloads');
});

test('favicons resolve at the vocabulary layer: renamed domains and subdomains', () => {
  // Fixed where the CLASS of problem lives, not per card. `iconhost=` stays for an author pointing
  // deliberately elsewhere (a bit.ly whose real destination is webtoons.com) — it is not for
  // patching our own lookup, which is how one card's fix becomes every future card's puzzle.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: link %% [X](https://twitter.com/someone)',
    '- [ ] %% card: link %% [Sub](https://vip.paperloom.com/thing)',
    '- [ ] %% card: link %% [Short](https://goo.gl/maps/abc)',
    '- [ ] %% card: link iconhost=webtoons.com %% [Comic](https://bit.ly/xyz)',
  ].join('\n') + '\n';
  const markup = renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(markup, /_icon\/x\.com\.ico/, 'twitter.com → x.com (the mark moved with the name)');
  assert.match(markup, /_icon\/vip\.paperloom\.com\.ico[^>]*data-iconfallback="[^"]*_icon\/paperloom\.com\.ico/,
    'a subdomain falls back to the site');
  assert.match(markup, /_icon\/google\.com\.ico/, 'goo.gl → google.com');
  assert.match(markup, /_icon\/webtoons\.com\.ico/, 'an explicit iconhost is obeyed and not second-guessed');
  assert.ok(!/iconhost=webtoons[^>]*data-iconfallback/.test(markup), 'and gets no fallback chain of ours');
});

test('an icon that 404s walks its fallbacks, then hides — never a broken image slot', () => {
  const md = '---\ncard-page: x\ntitle: X\n---\n\n## grid\n\n- [ ] %% card: link %% [S](https://a.b.example/x)\n';
  const markup = renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  // the handler must consume the list one at a time, not fire once and give up
  // the attribute is HTML-escaped inside the attribute value, so match on the escaped form
  assert.match(markup, /dataset\.iconfallback=f\.slice\(1\)\.join/, 'chains through every candidate');
  assert.match(markup, /this\.style\.display=&quot;none&quot;/, 'and hides once they are exhausted');
});

test('🔴 a Card speaks sitetile\'s vocabulary — no cp-/sc-/lt- survives except the coral\'s', () => {
  // Three dialects for the same concepts, from the order things were built in: cp-* from the Python
  // card, sc-coral-* from the Svelte one, lt-* from the link tile. A Card's markup and a Site's
  // markup mean the same thing now, so a stylesheet written for one describes the other.
  // 🩸 These were three real creators' cards until 2026-08-12. The classes this test looks for are
  // emitted by the RENDERER, not carried by the card, so the input was interchangeable all along —
  // measured: the specimens produce byte-identical `stale` output. And the assertion is live:
  // renaming one emitted class (st-backdrop → sc-coral-backdrop) turns it red.
  const cards = ['specimen-rich', 'specimen-assets', 'specimen-plain'].map((h) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../cards/specimens/${h}.card.md`), 'utf8'));
  for (const md of cards) {
    const markup = renderCardHTML(md, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
    const classes = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
    const stale = [...classes].filter((c) => /^(cp-|sc-|lt-)/.test(c));
    // `cp-icon` is the QR coral's MOUNT CONTRACT: its verbatim code does querySelector('.cp-icon'),
    // and that code is the one thing nothing may edit. An API is allowed to keep its own name.
    // 🔴 `cp-icon` is CONDITIONAL, and that is the point of asserting it this way. It rides on the
    // avatar <img>, and a profile that states no `avatar=` emits no <img> at all — it used to emit
    // `src=""`, which per HTML resolves to the current document URL, so the browser fetched the page
    // as an image, failed, and left a focusable role="button" sized 147.6px instead of 23.6cqw.
    // Removing it is safe for the coral's mount contract because the coral guards it:
    // `var icon=document.querySelector('.cp-icon');if(icon){…}`. A card with no avatar has nothing
    // for the QR to grow out of, which is why that guard exists.
    //
    // Pinning `['cp-icon']` for every specimen only worked while every specimen emitted a BROKEN
    // one — an assertion satisfied by the defect it should have caught.
    const wantsIcon = /%% card: profile[^%]*\bavatar=/.test(md);
    assert.deepEqual(stale, wantsIcon ? ['cp-icon'] : [],
      `old vocabulary leaked (card ${wantsIcon ? 'states' : 'states no'} avatar): ${stale.join(', ')}`);
  }
});

test("the renderer's own strings follow the CARD's language, and default to English", () => {
  // 🩸 Five aria-labels were hardcoded in Chinese and shipped to every card in every language —
  // 「顯示 QR code」 announced by a screen reader on an English creator's page. Everything else on a
  // card is the author's own words; these five are the only ones we put in their mouth.
  const card = (lang) => ['---', 'card-page: t', 'title: T', ...(lang ? [`lang: ${lang}`] : []), '---',
    '', '## grid', '', '- [ ] %% card: profile w=6 avatar="https://a.example/x.png" %% hi'].join('\n');
  const qrLabel = (lang) => (renderCardHTML(card(lang), { handle: 't' })
    .match(/aria-label="([^"]*(?:QR|코드)[^"]*)"/) || [])[1];

  assert.equal(qrLabel(''), 'Show QR code', 'no lang must be English');
  assert.equal(qrLabel('zh-TW'), '顯示 QR code');
  assert.equal(qrLabel('zh-Hant'), '顯示 QR code', 'keyed on the PRIMARY subtag, not the exact tag');
  assert.equal(qrLabel('de'), 'Show QR code', 'a language we do not have falls back rather than going blank');

  // 🔴 CONTROL. Every assertion above would also pass if the label were a constant that happened to
  // read "Show QR code" — three of them expect the same string. The claim is that it CHANGES.
  assert.notEqual(qrLabel('zh-TW'), qrLabel(''), 'the label does not vary with lang at all');
  assert.notEqual(qrLabel('ja-JP'), qrLabel('ko-KR'), 'two different languages produced the same label');

  // and it is never empty — an unlabelled control is worse than one in the wrong language
  for (const l of ['', 'zh-TW', 'ja-JP', 'ko-KR', 'de', 'xx-YY']) {
    assert.ok(qrLabel(l), `lang=${l} produced no label at all`);
  }
});

test('a quoted frontmatter value is the value, not the quotes', () => {
  // 🩸 A live creator's card carried `accent: '#b890e8'` — the natural thing to write in something
  // that looks like YAML. It arrived with the quotes attached, was spliced into
  // `--cp-accent:'#b890e8'`, and the browser threw the declaration away. The card wore the platform
  // default and every layer reported success: the markdown was valid, the CSS parsed, the page
  // rendered. Only the colour was wrong, and only the creator would have noticed.
  const card = (accent) => ['---', 'card-page: q', 'title: Q', `accent: ${accent}`, '---', '',
    '## grid', '', '- [ ] %% card: link w=6 %% [L](https://example.com)'].join('\n');
  // 🔴 NOT `match(...)[1]`. Two `--cp-accent:` declarations are emitted — the platform default
  // first, the card's own after it — and taking the first match reads the default every time. I
  // made exactly that mistake reading the live page an hour before writing this, and concluded the
  // accent was broken for every card when it was broken for one. Assert the CLAIM instead: the
  // unquoted value is present and the quoted form is not.
  for (const written of ["'#b890e8'", '"#b890e8"', '#b890e8', "  '#b890e8'  "]) {
    const html = renderCardHTML(card(written), { handle: 'q' });
    assert.ok(html.includes('--cp-accent:#b890e8'), `accent: ${written} did not reach the page unquoted`);
    assert.ok(!/--cp-accent:\s*['"]/.test(html), `accent: ${written} left its quotes in the CSS`);
  }

  // 🔴 CONTROL, and it is the half that keeps this from being a blunt strip: an APOSTROPHE that is
  // part of the text must survive. A title that begins with a quotation mark is a title.
  const t = renderCardHTML(['---', 'card-page: q', "title: 'Tis the season", '---', '', '## grid', '',
    '- [ ] %% card: link w=6 %% [L](https://example.com)'].join('\n'), { handle: 'q' });
  assert.ok(t.includes("'Tis the season"), 'an unmatched leading quote was eaten — the strip is too eager');
});

test('a cell\'s span is a data attribute, because sitetile has no class for one', () => {
  // Checked rather than assumed: GridCell carries no size field and site.css has no grid-column or
  // grid-row for cells anywhere. Inventing `st-size-2x2` would claim a canon that does not exist, so
  // the Card-only concept is expressed the way sitetile expresses every variant — a data attribute.
  const markup = renderCardHTML(CARD, { handle: 'x' }).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(markup, /data-span="6x2"/);
  assert.ok(!/class="[^"]*st-size-/.test(markup), 'no invented size class');
  assert.ok(!/class="[^"]*cp-size-/.test(markup), 'and the old one is gone');
});

test('the card defines sitetile\'s --gd-* tokens, so a Site\'s stylesheet finds what it expects', () => {
  for (const t of ['--gd-accent', '--gd-bg', '--gd-text', '--gd-border', '--gd-radius', '--gd-gap']) {
    assert.ok(CSS.includes(t), `missing ${t}`);
  }
  // and the --cp-* originals stay, because the QR coral reads them verbatim
  assert.ok(CSS.includes('--cp-accent'), 'the coral\'s tokens must survive');
});

test('🔴 no `asset:` reference ever survives into the rendered HTML', () => {
  // 🩸 `linkIcon` handed `iconimg` straight to the <img> src, so a card-local reference shipped as
  // `src="asset:sha256-a8f4…"`. Not a URL — the image failed, IMG_ICON's onerror hid it, and the row
  // rendered as text with no picture. That is indistinguishable from "the author set no icon", which
  // is why it survived: until the importer started emitting asset: refs, every iconimg in existence
  // was an external URL and happened to work.
  //
  // This asserts the CLASS, not the one param: any place that forgets resolveAsset shows up here.
  const CARD = [
    '---', 'card-page: t', 'title: T', 'backdrop: asset:pic', '---', '',
    '## grid', '',
    '- [ ] %% card: profile w=6 avatar="asset:pic" %% hi',
    '- [ ] %% card: link w=6 iconimg="asset:pic" %% [Wallpapers](https://example.com)',
    '- [ ] %% card: feature w=6 img="asset:pic" href="https://example.com" %%',
    '',
    '## assets', '',
    '- [ ] %% card: asset id=pic mime=image/gif %% R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    '',
  ].join('\n');
  const html = renderCardHTML(CARD, { handle: 't', cardUrl: 'https://t.example' });
  const leaks = html.match(/(?:src|url\()["']?asset:[^"')]*/g) || [];
  assert.deepEqual(leaks, [], `unresolved asset: reference(s) reached the HTML: ${leaks.join(', ')}`);
  // CONTROL: the picture really is in there, so the assertion above is not passing on an empty card.
  assert.ok(html.includes('data:image/gif;base64,'), 'the asset never resolved at all');
  assert.ok(html.split('data:image/gif;base64,').length - 1 >= 3, 'not every reference resolved');
});

test('🔴 no DECORATED span is ever rendered empty', () => {
  // 🩸 Found twice in one hour, the second time four hours after the first.
  //
  //   · the social row: a dead favicon hid the <img> and left a 40px bordered circle
  //   · a feature: turning arrows off emptied the CTA pill, and — after I "fixed" that — the
  //     EYEBROW span was still rendering empty and painting the same grey capsule
  //
  // One shape: remove the content, and the container it lived in is still styled and still painted.
  // Fixing one instance is not fixing the class, which is exactly what I did the first time. So the
  // assertion is over the CLASS: any span whose styling makes it visible must have something in it.
  const CARD = [
    '---', 'card-page: t', 'title: T', '---', '',
    '## grid', '',
    '- [ ] %% card: feature w=6 img="https://x/a.png" title="Has a title, no eyebrow, no cta" %%',
    '- [ ] %% card: feature w=3 img="https://x/b.png" %%',
    '- [ ] %% card: link w=6 %% [Plain](https://example.com)',
    '',
  ].join('\n');
  const html = renderCardHTML(CARD, { handle: 't', cardUrl: 'https://t.example' });
  const empties = html.match(/<span class="st-[a-z-]+"><\/span>/g) || [];
  assert.deepEqual(empties, [], `empty decorated span(s) rendered: ${empties.join(' ')}`);

  // CONTROL: the same spans DO appear when they have content — otherwise this passes on a renderer
  // that emits no spans at all.
  const full = renderCardHTML(CARD.replace('%%\n- [ ] %% card: feature w=3', '%% 眉標\n- [ ] %% card: feature w=3'), { handle: 't' });
  assert.match(full, /<span class="st-gal-eyebrow">眉標<\/span>/);
  assert.match(html, /<span class="st-gal-title">Has a title/);
});

// ── the public sandbox: /try/edit ───────────────────────────────────────────────────────────────
//
// Rebuilt after the legacy `feelreef.com/card/try` route was retired (3fcfb09ff, 2026-08-28). These
// lock down the two things a Worker-served page can honestly promise from a fetch() test — the
// route resolves, and it never touches the store — while sandbox-door.test.mjs / sandbox-i18n.test.mjs
// (w/) cover the pure logic (door href, persona copy) unit-tested in isolation.

const NEVER_TOUCHED = {
  get: async () => { throw new Error('the sandbox must never read the CARDS store'); },
  put: async () => { throw new Error('the sandbox must never write the CARDS store'); },
};

test('sandbox: /try/edit is 200, HTML, never indexed, and never touches the CARDS store', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit'), NEVER_TOUCHED);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('sandbox: a trailing slash answers the same as the bare path', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit/'), NEVER_TOUCHED);
  assert.equal(res.status, 200);
});

test('sandbox: the banner text is IN THE MARKUP (not only wired up by client JS) — curl must see it too', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit'), NEVER_TOUCHED);
  const body = await res.text();
  assert.ok(!body.includes('id="sandbox-banner" hidden'), 'the banner must not ship hidden');
  assert.match(body, /id="sandbox-banner-text">[^<]+</, 'the banner span must already have text in it');
});

test('sandbox: locale comes from Accept-Language, one of the nine console locales the editor speaks', async () => {
  // 🩸 The third column used to be a word from the BANNER — 「サンドボックス」, 「sable」, 「pruebas」 —
  // and every one of those still appears in `bannerText`, so this test would have stayed green
  // through the whole of Top-10 #5 without ever looking at the thing #5 changes. It reads the
  // <title> now, which is what a tab, a bookmark and a shared link actually show.
  const cases = [
    ['ja,en;q=0.8', 'lang="ja-JP"', '<title>Card を試す · feelreef</title>'],
    ['zh-TW,zh;q=0.9', 'lang="zh-TW"', '<title>試玩 Card · feelreef</title>'],
    ['zh-CN,zh;q=0.9', 'lang="zh-CN"', '<title>试玩 Card · feelreef</title>'],  // Simplified — a different locale
    ['ko-KR', 'lang="ko-KR"', '<title>Card 체험 · feelreef</title>'],
    ['de-DE,fr-FR;q=0.9', 'lang="de-DE"', '<title>Card ausprobieren · feelreef</title>'],
    ['fr-FR', 'lang="fr-FR"', '<title>Essayer Card · feelreef</title>'],
    ['es-ES', 'lang="es-ES"', '<title>Probar Card · feelreef</title>'],
    ['pt-BR', 'lang="pt-BR"', '<title>Experimentar Card · feelreef</title>'],
    ['it-IT,ru-RU', 'lang="en-US"', '<title>Try Card · feelreef</title>'],      // unrecognised → English
  ];
  for (const [al, wantLang, wantWord] of cases) {
    const res = await worker.fetch(
      new Request('https://card.feelreef.com/try/edit', { headers: { 'accept-language': al } }),
      NEVER_TOUCHED,
    );
    const body = await res.text();
    assert.ok(body.includes(wantLang), `${al}: expected ${wantLang}`);
    assert.ok(body.toLowerCase().includes(wantWord.toLowerCase()), `${al}: expected to find "${wantWord}"`);
  }
});

test('sandbox: `?locale=` overrides Accept-Language, for manual testing/linking', async () => {
  const res = await worker.fetch(
    new Request('https://card.feelreef.com/try/edit?locale=ko', { headers: { 'accept-language': 'en-US' } }),
    NEVER_TOUCHED,
  );
  const body = await res.text();
  assert.ok(body.includes('lang="ko-KR"'));
});

test('sandbox: `?lang=` overrides both `?locale=` and Accept-Language — the brief\'s own resolution order', async () => {
  const res = await worker.fetch(
    new Request('https://card.feelreef.com/try/edit?lang=de&locale=ko', { headers: { 'accept-language': 'en-US' } }),
    NEVER_TOUCHED,
  );
  const body = await res.text();
  assert.ok(body.includes('lang="de-DE"'));
});

test('sandbox: `?lang=` accepts a full BCP-47 tag, not just the bare locale key (Traditional vs Simplified Chinese)', async () => {
  const traditional = await worker.fetch(new Request('https://card.feelreef.com/try/edit?lang=zh-TW'), NEVER_TOUCHED);
  assert.ok((await traditional.text()).includes('lang="zh-TW"'));
  const simplified = await worker.fetch(new Request('https://card.feelreef.com/try/edit?lang=zh-CN'), NEVER_TOUCHED);
  assert.ok((await simplified.text()).includes('lang="zh-CN"'));
});

test('🔴 sandbox: a bare /try (no /edit) is NOT special-cased — same 404 as any unregistered handle', async () => {
  // RSP reserves the handle `try`; this Worker's own CARDS store is a separate namespace where
  // "try" must never be a real key. get() returning null here is what proves that: the route falls
  // through to ordinary handle resolution instead of being caught by the sandbox branch.
  const res = await worker.fetch(new Request('https://card.feelreef.com/try'), { CARDS: { get: async () => null } });
  assert.equal(res.status, 404);
});

// ── the door's luggage: POST /try/park (Top-10 #2, §3.6) ────────────────────────────────────────
//
// 🔴 `/try/edit` still touches nothing — the tests above prove it with a KV double that throws, and
// they still pass. This is the ONE route where the string "try" reaches the store, and it reaches it
// as `try:<uuid>`, which the handle grammar can never produce.

const TRY_CARD = ['---', 'card-page: try', 'title: 小美', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% a bio',
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/x)'].join('\n') + '\n';

/** a KV double that RECORDS, so a test can assert which keys were written and with what TTL */
function recordingStore(seed = {}) {
  const kv = new Map(Object.entries(seed));
  const puts = [];
  return {
    kv,
    puts,
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v, opts) => { kv.set(k, v); puts.push({ key: k, bytes: v.length, opts }); },
  };
}

const park = (body, init = {}) => new Request('https://card.feelreef.com/try/park', {
  method: 'POST', headers: { 'content-type': 'text/markdown' }, body, ...init,
});

test('🔴 park: the WHOLE card is stored, under try:<uuid>, with an hour to live', async () => {
  const store = recordingStore();
  const res = await worker.fetch(park(TRY_CARD), { CARDS: store });
  assert.equal(res.status, 200);
  const { id, expires_in_seconds: ttl } = await res.json();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'the id is not a uuid');
  assert.equal(ttl, 3600);
  assert.equal(store.puts.length, 1);
  assert.equal(store.puts[0].key, `try:${id}`);
  assert.equal(store.puts[0].opts.expirationTtl, 3600);
  // the whole card, byte for byte — not a title and a tagline
  assert.equal(store.kv.get(`try:${id}`), TRY_CARD);
});

test('🔴 park: a parked key can never collide with a handle', async () => {
  const store = recordingStore();
  await worker.fetch(park(TRY_CARD), { CARDS: store });
  const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
  for (const key of store.kv.keys()) {
    assert.ok(key.includes(':'), `${key} has no namespace separator`);
    assert.doesNotMatch(key, HANDLE, `${key} is a shape the handle grammar can produce`);
  }
  // CONTROL: the handle pattern DOES match a real handle, so the assertion above is not vacuous
  assert.match('try', HANDLE);
});

test('park: two posts get two different ids and two different rows', async () => {
  const store = recordingStore();
  const a = await (await worker.fetch(park(TRY_CARD), { CARDS: store })).json();
  const b = await (await worker.fetch(park(TRY_CARD), { CARDS: store })).json();
  assert.notEqual(a.id, b.id);
  assert.equal(store.kv.size, 2);
});

test('🔴 park: a body that is not a card is refused — this is not a free key/value store', async () => {
  const store = recordingStore();
  for (const body of ['', 'hello world', '<html>not a card</html>', '---\ntitle: x\n---\n']) {
    const res = await worker.fetch(park(body), { CARDS: store });
    assert.equal(res.status, 400, `parked ${JSON.stringify(body.slice(0, 20))}`);
  }
  assert.equal(store.puts.length, 0, 'something was written despite every body being refused');
  // CONTROL: the same store DOES accept a real card
  assert.equal((await worker.fetch(park(TRY_CARD), { CARDS: store })).status, 200);
  assert.equal(store.puts.length, 1);
});

test('park: a card over the ingest budget is refused, and nothing is written', async () => {
  const store = recordingStore();
  const huge = TRY_CARD + '\n## assets\n\n- [ ] %% card: asset id=sha256-a mime=image/webp %% ' + 'A'.repeat(1600 * 1024);
  const res = await worker.fetch(park(huge), { CARDS: store });
  assert.equal(res.status, 413);
  assert.equal(store.puts.length, 0);
});

test('park: only POST, and only from our own origin when a browser says which', async () => {
  const store = recordingStore();
  const get = await worker.fetch(new Request('https://card.feelreef.com/try/park'), { CARDS: store });
  assert.equal(get.status, 405);
  const cross = await worker.fetch(
    park(TRY_CARD, { headers: { 'content-type': 'text/markdown', origin: 'https://somewhere.example' } }),
    { CARDS: store },
  );
  assert.equal(cross.status, 403);
  // CONTROL: our own origin is accepted
  const same = await worker.fetch(
    park(TRY_CARD, { headers: { 'content-type': 'text/markdown', origin: 'https://card.feelreef.com' } }),
    { CARDS: store },
  );
  assert.equal(same.status, 200);
});

test('🔴 the parked draft is read back over the GUARDED api, and only with the bearer', async () => {
  const store = recordingStore();
  const { id } = await (await worker.fetch(park(TRY_CARD), { CARDS: store })).json();
  const url = `https://card.feelreef.com/_api/try/${id}`;
  // sha256 of "s3cret" — the same shape card-api's `authorize` compares against
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('s3cret')))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const env = { CARDS: store, MCP_TOKEN_HASH: hash };

  const naked = await worker.fetch(new Request(url), env);
  assert.equal(naked.status, 401, 'a parked draft was readable with no bearer at all');

  const authed = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer s3cret' } }), env);
  assert.equal(authed.status, 200);
  assert.match(authed.headers.get('content-type') || '', /text\/markdown/);
  assert.equal(await authed.text(), TRY_CARD);

  // …and it is NOT deleted on read: a retry after a failed signup must still find it
  const again = await worker.fetch(new Request(url, { headers: { authorization: 'Bearer s3cret' } }), env);
  assert.equal(again.status, 200);
});

test('the api refuses a made-up draft id, and refuses to write through this route', async () => {
  const store = recordingStore();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('s3cret')))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const env = { CARDS: store, MCP_TOKEN_HASH: hash };
  const auth = { authorization: 'Bearer s3cret' };
  const bad = await worker.fetch(new Request('https://card.feelreef.com/_api/try/not-a-uuid', { headers: auth }), env);
  assert.equal(bad.status, 400);
  const missing = await worker.fetch(
    new Request('https://card.feelreef.com/_api/try/00000000-0000-0000-0000-000000000000', { headers: auth }), env);
  assert.equal(missing.status, 404);
  const written = await worker.fetch(
    new Request('https://card.feelreef.com/_api/try/00000000-0000-0000-0000-000000000000',
      { method: 'PUT', headers: auth, body: 'x' }), env);
  assert.equal(written.status, 405);
});

// ── the masthead (Top-10 #5, §3.2) ──────────────────────────────────────────────────────────────

test('🔴 the served sandbox never shows a visitor the internal codename', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit'), NEVER_TOUCHED);
  const body = await res.text();
  // the codename appears in exactly one place a person can read: nowhere.
  const visible = body
    .replace(/<script[\s\S]*?<\/script>/g, '')        // the bundle carries its own module names
    .replace(/<style[\s\S]*?<\/style>/g, '');         // …and the stylesheet its class names
  assert.doesNotMatch(visible, /cardtile/i, 'the internal name is in the markup a visitor reads');
  assert.doesNotMatch(body, /<title>[^<]*cardtile/i, 'the tab still says cardtile');
  // CONTROL: the strip above did not simply remove the whole page
  assert.ok(visible.length > 1500, `only ${visible.length} bytes of markup left to scan`);
  assert.match(visible, /id="table"/, 'the strip removed the page itself');
});

test('the masthead names feelreef and Card, and the name is the way back', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit'), NEVER_TOUCHED);
  const body = await res.text();
  assert.match(body, /<h1 class="ctw-brand"><a href="https:\/\/feelreef\.com\/">feelreef<\/a><span>Card<\/span><\/h1>/);
});

test('🔴 the internal editor\'s OWN markup keeps its own name — the swap is a sandbox composition, not a file edit', () => {
  // w/index.html has no route of its own any more (the sandbox it used to compose into was
  // deleted with editor-assets.mjs), but it is still real, imported code — cell-form-core.mjs and
  // md-guard.mjs were lifted out of the editor.mjs this markup belongs to, and sandbox-i18n.test.mjs
  // still gates this exact file's translation coverage. Its own identity string is part of that.
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, '../w/index.html'), 'utf8');
  assert.match(html, /<h1>cardtile-w<\/h1>/, 'w/index.html was edited to say something it never should on its own');
});

test('🔴 the tugtile-table editor\'s OWN markup, same rule: w2/index.html says cardtile-w2, the sandbox says feelreef', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, '../w2/index.html'), 'utf8');
  assert.match(html, /<h1>cardtile-w2<\/h1>/, 'w2/index.html was edited instead of the sandbox composition');
});

// ── the tugtile-table editor, now on the OFFICIAL path (/try/edit) ─────────────────────────────────
//
// Owner ruling 2026-09-06 (#32), re-reviewed and ruled "換上正式路徑" on 2026-09-06
// (REVIEW-card-edit2-rereview-2026-09-06.md): the rebuild that was staged beside the original
// `/try/edit` as `/try/edit2` replaces it at `/try/edit`. Same promises as before — resolves, never
// indexed, never touches the store — plus the one this route added while it was still `/try/edit2`:
// it also serves the ENGINE's browser tugtile as its editing table, and that table has to arrive
// complete and in the visitor's language. `/try/edit2` itself is now a 301, tested below.

test('sandbox: the banner ships IN THE MARKUP and the masthead is feelreef, not a codename', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit'), NEVER_TOUCHED);
  const body = await res.text();
  assert.ok(!body.includes('id="sandbox-banner" hidden'), 'the banner must not ship hidden');
  assert.match(body, /id="sandbox-banner-text">[^<]+</, 'the banner span must already have text in it');
  assert.match(body, /id="sandbox-banner-status">[^<]+</, "the phone's one-line banner must ship too");
  assert.ok(!body.includes('<h1>cardtile-w2</h1>'), 'the internal codename reached a visitor');
  assert.match(body, /ctw-brand[^>]*><a href="https:\/\/feelreef\.com\/">feelreef<\/a>/, 'no way back to feelreef');
});

test('sandbox: the door is wired — the sheet, /try/park, and /dashboard/cards', async () => {
  // 🔴 The CTA's own words are NOT asserted here, and that is deliberate. esbuild's default charset
  // is ascii, so every CJK string in the bundle arrives as `\uXXXX` escapes — a `/把這張變成真的/`
  // match would be red for a page that renders the button perfectly, and the one place it WOULD
  // pass is a comment in the markup. The words are sandbox-i18n.test.mjs's subject, in all nine.
  // What belongs here is the wiring: the sheet ships, and both halves of the walk are reachable.
  const body = await (await worker.fetch(new Request('https://card.feelreef.com/try/edit?lang=zh-TW'), NEVER_TOUCHED)).text();
  for (const id of ['doormodal', 'door-title', 'door-note', 'door-go', 'door-back']) {
    assert.match(body, new RegExp(`id="${id}"`), `the sentence-before-the-door sheet is missing #${id}`);
  }
  assert.match(body, /\/try\/park/, 'the door does not park the card — the whole card would not travel');
  // 🔴 The origin and the path are two literals in the bundle (`REAL_CARD_ORIGIN` + the path it is
  // concatenated with), so they are asserted as two — a single joined pattern would be red for a
  // page whose door works, which is the same mistake as matching the CTA above.
  assert.ok(body.includes('https://feelreef.com') && body.includes('/dashboard/cards'), 'the door leads nowhere');
});

test('sandbox: locale reaches BOTH the page and the table it mounts', async () => {
  // 🔴 The expected words are the OWNER'S RULING (CARD-VOCAB-ADDENDUM-2026-09-06), written out here
  // rather than computed from the table this test is checking — a test that asks the code what it
  // says and then agrees is a test that can only ever pass.
  for (const [al, lang, addTile] of [
    ['ja,en;q=0.8', 'lang="ja-JP"', '＋タイルを追加'],
    ['de-DE,de;q=0.9', 'lang="de-DE"', '+ Kachel hinzufügen'],
    ['zh-TW', 'lang="zh-TW"', '＋加一張牌'],
  ]) {
    const page = await worker.fetch(
      new Request('https://card.feelreef.com/try/edit', { headers: { 'accept-language': al } }), NEVER_TOUCHED);
    const html = await page.text();
    assert.ok(html.includes(lang), `${al}: the page is not ${lang}`);
    const locale = /"locale":"([^"]+)"/.exec(html)?.[1];
    assert.ok(locale, `${al}: the page did not tell its own script which locale it is`);
    assert.match(html, new RegExp(`/try/edit/t/${locale.replace('-', '-')}/`), `${al}: the table base does not carry the locale`);
    // …and every one of the engine's four filenames answers in THAT locale, because the engine's
    // host picks the filename from navigator.language and we have already decided the language.
    for (const file of ['en-US', 'ja-JP', 'ko-KR', 'zh-TW']) {
      const r = await worker.fetch(new Request(`https://card.feelreef.com/try/edit/t/${locale}/i18n/${file}.json`), NEVER_TOUCHED);
      assert.equal(r.status, 200, `${al}: ${file}.json did not answer — the board would print raw i18n KEYS`);
      const j = JSON.parse(await r.text());
      assert.equal(j.addTileBtn, addTile, `${al}: the add-tile button is not in the visitor's language`);
      // CONTROL: this is a MERGE, not a replacement — the engine's own strings are still in there
      assert.ok(j.expandAllAction, `${al}: the engine's own strings were dropped from the merged JSON`);
    }
  }
});

test('sandbox: the engine table arrives COMPLETE — including the file the engine host does not ship', async () => {
  // 🔴 `hosts/web/tugtile/index.html` imports `./board-core.js` and the engine's own directory has
  // no such file (its build.sh copies tugtile.css, Sortable, i18n and editor-core, but the board
  // model is generated into packages/tugtile/). A missing import here is a table that never loads,
  // and the page above it would look merely slow.
  const need = ['', 'board-core.js', 'icons.js', 'host.js', 'obsidian-shim.js', 'tugtile.css',
    'Sortable.min.js', 'vendor/editor-core.js'];
  for (const rel of need) {
    const r = await worker.fetch(new Request(`https://card.feelreef.com/try/edit/t/ja/${rel}`), NEVER_TOUCHED);
    assert.equal(r.status, 200, `the table is missing ${rel || 'index.html'}`);
    const body = await r.text();
    assert.ok(body.length > 200, `${rel || 'index.html'} came back empty`);
  }
  const host = await (await worker.fetch(new Request('https://card.feelreef.com/try/edit/t/ja/'), NEVER_TOUCHED)).text();
  // the contract the parent page drives the table through
  assert.match(host, /window\.__load/, 'the host no longer publishes __load');
  assert.match(host, /window\.__ready/, 'the host no longer publishes __ready');
  assert.match(host, /data-tid/, 'the host no longer stamps data-tid — the order could not be read back');
  const core = await (await worker.fetch(new Request('https://card.feelreef.com/try/edit/t/ja/board-core.js'), NEVER_TOUCHED)).text();
  assert.match(core, /export \{[^}]*parseFile/, 'board-core.js is not the board model');
  // CONTROL: a path the table does not have is a 404, not an empty 200
  const miss = await worker.fetch(new Request('https://card.feelreef.com/try/edit/t/ja/nope.js'), NEVER_TOUCHED);
  assert.equal(miss.status, 404);
});

test('sandbox: the table is same-origin-framed only, and its assets are immutable except the document', async () => {
  const doc = await worker.fetch(new Request('https://card.feelreef.com/try/edit/t/ja/'), NEVER_TOUCHED);
  assert.equal(doc.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(doc.headers.get('cache-control') || '', /no-store/, 'the table document is cached for a year — it could never be fixed');
  const css = await worker.fetch(new Request('https://card.feelreef.com/try/edit/t/ja/tugtile.css'), NEVER_TOUCHED);
  assert.match(css.headers.get('cache-control') || '', /immutable/);
});

// ── the retired path: /try/edit2 ─────────────────────────────────────────────────────────────────
//
// It used to be where this experience was staged; it is now nothing but a signpost.

test('🔴 /try/edit2 is a permanent redirect to /try/edit — nothing that already links to it breaks', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit2'), NEVER_TOUCHED);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://card.feelreef.com/try/edit');
  const trailing = await worker.fetch(new Request('https://card.feelreef.com/try/edit2/'), NEVER_TOUCHED);
  assert.equal(trailing.status, 301);
  assert.equal(trailing.headers.get('location'), 'https://card.feelreef.com/try/edit');
});

test('🔴 /try/edit2 redirects WITH the query string — a `?lang=` link still resolves the same locale', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit2?lang=ja'), NEVER_TOUCHED);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://card.feelreef.com/try/edit?lang=ja');
});

test('🔴 CONTROL: /try/edit2 never touches the CARDS store, and never serves a body — it only redirects', async () => {
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit2'), NEVER_TOUCHED);
  assert.equal((await res.text()).length < 200, true, 'a 301 should carry no real body');
});

test('🔴 the retired table path is gone too — /try/edit2/t/… is not specially handled any more', async () => {
  // It falls through to ordinary handle resolution, the same as any other unregistered path under
  // `/try` — see the bare-`/try` test above. Proves the OLD table route was actually removed, not
  // just shadowed by the new one still matching it.
  const res = await worker.fetch(new Request('https://card.feelreef.com/try/edit2/t/ja/'), { CARDS: { get: async () => null } });
  assert.equal(res.status, 404);
});

test('🔴 the committed /try/edit bundle is the one its sources produce', async () => {
  // 🩸 THE GREEN THAT MEASURED A STALE ARTIFACT. `edit2-assets.mjs` is committed, so an edit to
  // w2/ does nothing until the generator runs — and on 2026-09-06 the generator FAILED (a stray
  // backtick closed a CSS template literal) inside a `&&` chain whose output was being tailed. The
  // browser harness then drove the previous bundle and reported 315/315. Every check was honest and
  // every one of them was about code that was no longer there.
  //
  // 🔴 It hashes the INPUTS, not the output. A hash of the artifact only ever says "the file I
  // wrote is the file I wrote"; this asks the question a drift gate has — is the committed bundle
  // still what these sources make?
  const { SOURCE_STAMP } = await import('./edit2-assets.mjs');
  const { sourceStamp, EDIT2_SOURCES } = await import('./edit2-sources.mjs');
  assert.ok(SOURCE_STAMP, 'the generated bundle carries no source stamp — regenerate it');
  assert.equal(SOURCE_STAMP, sourceStamp(),
    'serve/edit2-assets.mjs is STALE — run: node packages/cardtile/serve/gen-edit2-assets.mjs');
  assert.match(SOURCE_STAMP, /^[0-9a-f]{16}$/);
  // CONTROL: a stamp that reads nothing would agree with itself forever. This one has to actually
  // open every file on the list — point it somewhere the files are not, and it must refuse rather
  // than hand back a hash of an empty set.
  assert.ok(EDIT2_SOURCES.length >= 10, 'the source list is suspiciously short');
  assert.throws(() => sourceStamp('/tmp/there-is-no-cardtile-here'),
    /is missing/, 'the stamp does not actually read the sources it claims to hash');
});
