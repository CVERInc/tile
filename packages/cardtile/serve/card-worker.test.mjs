// card-worker render path — pure unit tests (no edge, no browser). The fetch() shell is thin; the
// brain (resolveHandle + renderCardHTML) is what these lock down.  run: node --test card-worker.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { resolveHandle, renderCardHTML } from './card-worker.mjs';
// reef#2725's tests reach new exports through the namespace, so each goes red on its own assertion
import * as W from './card-worker.mjs';
import { BLANKS } from '../ai-ops.mjs';
import { QR_VERSION, QR_JS, DRAWER_VERSION, DRAWER_JS, CSS } from './card-assets.mjs';
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

test('🔴 resolveHandle: a path names a card on our hosts only; a creator domain without a binding names none (reef#2618 r2)', () => {
  for (const host of ['card.feelreef.com', 'saas.feelreef.com', 'cardtile-preview.acct.workers.dev', 'localhost:8787', 'x', '127.0.0.1']) {
    assert.equal(resolveHandle(host, '/inkbrush')?.handle, 'inkbrush', host);
  }
  for (const host of ['card.inkbrush.com', 'former.example', 'feelreef.com.evil.example', 'workers.dev.example']) {
    for (const path of ['/inkbrush', '/inkbrush.md', '/inkbrush/favicon.ico']) assert.equal(resolveHandle(host, path), null, host + path);
  }
});

// tile-lab#51 (product owner 2026-10-29): the bare old host is feelreef's own card too, not a directory —
// a visitor who cuts the handle off is asking "what is this?", and a Card answers by being one.
test('resolveHandle: bare canonical host (no handle) → the root card, at the bare origin', () => {
  assert.deepEqual(resolveHandle('card.feelreef.com', '/'), { handle: 'feelreef', cardUrl: 'https://card.feelreef.com', root: true });
  // CONTROL: the other path-routed hosts have no root card
  for (const host of ['saas.feelreef.com', 'x', 'cardtile-preview.acct.workers.dev']) assert.equal(resolveHandle(host, '/'), null, host);
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

test('bubbles: the narrow-screen anchor is read from `narrow=`, and from the `origin-narrow=` it was first written as', () => {
  // 🩸 reef#1915. parseParams read a hyphenated name from its last hyphen on, so
  // `origin-narrow=` set `narrow` and a card carrying the older spelling got its anchor through the
  // truncation. Names are read whole now; this holds that card where it was.
  const card = (params) => ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    `- [ ] %% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" ${params} %%`,
  ].join('\n') + '\n';
  const narrowOf = (params) => (/max-width:888px\)\{\.st-carousel figure\{transform-origin:([^}]*)\}/.exec(renderCardHTML(card(params), { handle: 'x' })) || [])[1];
  assert.equal(narrowOf(''), '53% 33%', 'CONTROL: the default, so the two below are seen to move it');
  assert.equal(narrowOf('narrow="40% 20%"'), '40% 20%');
  assert.equal(narrowOf('origin-narrow="40% 20%"'), '40% 20%');
  assert.equal(narrowOf('origin-narrow="40% 20%" narrow="10% 10%"'), '10% 10%', '`narrow=` is the name; it wins when both are written');
  // 🔴 #1929: the OTHER written order. The precedence is by NAME, never by position on the line —
  // `narrow=` wins whichever side of `origin-narrow=` it is written, and that is DELIBERATE:
  // `origin-narrow=` is the legacy spelling (read only so old cards keep their anchor), so a card
  // that carries both has been edited since, and the edit is the named one. A reader who sees the
  // anchor go from 40% 20% to 10% 10% is seeing the rule, not a bug. The test above wrote only one order.
  assert.equal(narrowOf('narrow="10% 10%" origin-narrow="40% 20%"'), '10% 10%', 'narrow= wins when it is written FIRST too (by name, not by position)');
  assert.equal(narrowOf('narrow="" origin-narrow="40% 20%"'), '40% 20%', 'an empty narrow= is not a value: the legacy spelling still answers');
  // …and `origin-narrow=` is not `origin=`: the wide-screen anchor stays the default.
  assert.match(renderCardHTML(card('origin-narrow="40% 20%"'), { handle: 'x' }), /opacity:0;transform-origin:53% 76%/);
});

test('🔴 slider is the COMMON carousel — swipeable, with prev/next, and no JS', () => {
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: embed w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png,https://i.example/3.png" %%',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.equal((html.match(/<figure id=/g) || []).length, 3);
  assert.match(html, /scroll-snap-type:x mandatory/, 'the browser does the swiping');
  assert.equal((html.match(/st-slide-nav/g) || []).length > 0, true, 'prev/next missing');
  // 🔴 NO fixed aspect: The product owner read Incrediville as 6x6(slide*5) AND 3x6(slide*4) — same widget,
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

test('🔴 a hyphenated param name is its own name — `yt-channel=` is not `channel=`', () => {
  // 🩸 This test used to lock the opposite: parseParams read `a-b=x` as the key `b`, so a
  // hyphenated param resolved to undefined, the code fell back to its default, and nothing ever
  // looked broken — "keep names hyphen-free" was the rule, and `yt-channel=` reaching `channel`
  // through the truncation was the warning. Names are read whole now (reef#1915), so the
  // trap is gone and so is the accident: a name means what it says.
  const md = ['---', 'card-page: x', 'title: X', '---', '', '## grid', '',
    '- [ ] %% card: video w=6 h=4 channel="UCabcdefghijklmnopqrstuv" %% Latest',
  ].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'x' });
  assert.match(html, /data-yt-channel="UCabcdefghijklmnopqrstuv"/, '`channel=` resolves');

  const hyphened = md.replace('channel="UC', 'yt-channel="UC');
  assert.notEqual(hyphened, md, 'the replace did not land — the assertion below would be about `channel=`');
  assert.ok(!/data-yt-channel=/.test(renderCardHTML(hyphened, { handle: 'x' })),
    '`yt-channel=` was read as `channel=` — the name is being read from its last hyphen again');
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

test('the bundled qr/drawer coral clients are the ones on disk — regenerate after editing either', () => {
  // card-assets.mjs embeds qr/qr.js and drawer/drawer.js VERBATIM plus their package.json versions
  // (see gen-assets.mjs), because the edge Worker cannot read the filesystem. That embed is
  // generated and a stale one is invisible exactly like a stale stylesheet bundle: the page
  // renders, every test that only exercises the embedded copy passes, and the change simply is not
  // there — this is the drift the serving aggregate actually ships, independent of whether the
  // intermediate coral bundle in packages/dynamic-corals/ itself is current (that question belongs
  // to generated-bundles.test.mjs).
  //
  // 🔴 Read only from COMMITTED files, like the stylesheet check above: this runs with no
  // node_modules anywhere — no esbuild, no signet — because it also runs from the private
  // incubator's composite suite and from scripts/test-clean.sh.
  const here = dirname(fileURLToPath(import.meta.url));
  const corals = join(here, '../../dynamic-corals');
  const diskQr = readFileSync(join(corals, 'qr/qr.js'), 'utf8');
  const diskDrawer = readFileSync(join(corals, 'drawer/drawer.js'), 'utf8');
  const { version: diskQrVersion } = JSON.parse(readFileSync(join(corals, 'qr/package.json'), 'utf8'));
  const { version: diskDrawerVersion } = JSON.parse(readFileSync(join(corals, 'drawer/package.json'), 'utf8'));

  // Exact bytes, including the stamp: that is literally what gen-assets.mjs embeds. Anything looser
  // (e.g. normalizing the build stamp the way the rebuild gate does) stops being the question this
  // test asks — "is the serving copy what the committed coral bundle actually is" — and starts
  // answering a different one.
  const bytesMatch = (embedded, disk) => embedded === disk;

  assert.ok(bytesMatch(QR_JS, diskQr),
    'QR_JS does not match packages/dynamic-corals/qr/qr.js — run: node packages/cardtile/serve/gen-assets.mjs');
  assert.equal(QR_VERSION, diskQrVersion,
    'QR_VERSION does not match qr/package.json — run: node packages/cardtile/serve/gen-assets.mjs');
  assert.ok(bytesMatch(DRAWER_JS, diskDrawer),
    'DRAWER_JS does not match packages/dynamic-corals/drawer/drawer.js — run: node packages/cardtile/serve/gen-assets.mjs');
  assert.equal(DRAWER_VERSION, diskDrawerVersion,
    'DRAWER_VERSION does not match drawer/package.json — run: node packages/cardtile/serve/gen-assets.mjs');
});

test('CONTROL: the qr/drawer drift comparison actually distinguishes a mismatched pair', () => {
  // The assertions above only ever compare the real embed to the real disk file, which proves
  // nothing about whether the comparison CAN go red — a check exercised only on agreeing inputs is
  // unfalsifiable. Feed the same comparator a synthetic mismatched pair and show that it does.
  const bytesMatch = (embedded, disk) => embedded === disk;
  assert.equal(bytesMatch('a', 'a'), true, 'sanity: identical bytes must compare equal');
  assert.equal(bytesMatch('a', 'b'), false, 'a one-byte difference must be caught');
  assert.equal(bytesMatch(QR_JS, QR_JS + ' '), false,
    'a trailing-byte difference on the real embedded QR_JS must be caught');
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
  const res = await worker.fetch(new Request('https://card.feelreef.com/try'), { CARDS: { get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }) } });
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
    async getWithMetadata(k) { return { value: await this.get(k), metadata: puts.findLast((p) => p.key === k)?.opts?.metadata ?? null }; },
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
  // 🩸 was `X-Frame-Options: SAMEORIGIN`; that header judges the TOP page, so under a feelreef host
  // page (/edit) the board never loaded. CSP lists every ancestor instead; the list is validHostOrigin's.
  assert.equal(doc.headers.get('x-frame-options'), null);
  assert.equal(doc.headers.get('content-security-policy'), "frame-ancestors 'self' https://feelreef.com https://staging.feelreef.com http://localhost:*");
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
  const { SOURCE_STAMP, SOURCE_FILES } = await import('./edit2-assets.mjs');
  const { sourceStamp } = await import('./edit2-sources.mjs');
  assert.ok(SOURCE_STAMP, 'the generated bundle carries no source stamp — regenerate it');
  assert.equal(SOURCE_STAMP, sourceStamp(SOURCE_FILES),
    'serve/edit2-assets.mjs is STALE — run: node packages/cardtile/serve/gen-edit2-assets.mjs');
  assert.match(SOURCE_STAMP, /^[0-9a-f]{16}$/);
  // CONTROL: a stamp that reads nothing would agree with itself forever. This one has to actually
  // open every file on the list — point it somewhere the files are not, and it must refuse rather
  // than hand back a hash of an empty set.
  assert.ok(SOURCE_FILES.length >= 10, 'the source list is suspiciously short');
  assert.throws(() => sourceStamp(SOURCE_FILES, '/tmp/there-is-no-cardtile-here'),
    /is missing/, 'the stamp does not actually read the sources it claims to hash');
});

test('🔴 #1929: the stale-bundle stamp covers every file the generator READ, not a hand-kept list', async () => {
  // 🩸 The list was written by hand, so it was exactly as complete as the last person's memory:
  // editing hosts/web/tugtile/vendor/editor-core.js (and icons.js, obsidian-shim.js, host.js,
  // Sortable.min.js, i18n/*.json) left the bundle STALE and this gate green. The generator now records
  // every file it opens (its own reads, plus esbuild's metafile for the JS it bundles) and ships that
  // list inside the artifact; the stamp is over THAT list.
  const assets = await import('./edit2-assets.mjs');
  const { sourceStamp, isOwnOutput } = await import('./edit2-sources.mjs');
  const files = assets.SOURCE_FILES;
  assert.ok(Array.isArray(files) && files.length > 20, 'the bundle carries no list of the files it was built from — regenerate it');
  const has = (suffix) => files.some((f) => f.endsWith(suffix.replace(/^packages\//, '')));
  // the engine's table, file by file — every one the ticket found un-hashed
  for (const f of ['hosts/web/tugtile/vendor/editor-core.js', 'hosts/web/tugtile/icons.js', 'hosts/web/tugtile/obsidian-shim.js',
    'hosts/web/tugtile/host.js', 'hosts/web/tugtile/Sortable.min.js', 'hosts/web/tugtile/index.html', 'packages/tugtile/board-core.js',
  ]) assert.ok(has(f), `${f} is read into the bundle but is not on the stamped list`);
  assert.ok(files.filter((f) => /hosts\/web\/tugtile\/i18n\/[\w-]+\.json$/.test(f)).length >= 4, 'the engine\'s i18n/*.json are not all on the stamped list');
  // CONTROL: the stamp over the list is the committed one, and flipping ONE byte of ONE file the
  // old list never named moves it (a stamp that cannot see editor-core.js is the bug itself).
  assert.equal(sourceStamp(files), assets.SOURCE_STAMP, 'serve/edit2-assets.mjs is STALE — run: node packages/cardtile/serve/gen-edit2-assets.mjs');
  const flipped = sourceStamp(files, undefined, (p) => {
    const b = Buffer.from(readFileSync(p));
    if (p.endsWith('hosts/web/tugtile/vendor/editor-core.js')) b[0] ^= 1;
    return b;
  });
  assert.notEqual(flipped, assets.SOURCE_STAMP, 'editing vendor/editor-core.js does not move the stamp');
  // INDEPENDENT of the generator and of esbuild (CI has neither): walk the relative-import graph from
  // the bundle's entry with a plain regex. Every local module it reaches must be on the list.
  const root = new URL('../w2/edit2.mjs', import.meta.url);
  const seen = new Set(); const todo = [fileURLToPath(root)];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    if (isOwnOutput(f, dirname(fileURLToPath(import.meta.url)))) continue;   // the generator's own output (esbuild keeps none of it; the generator asserts that)
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(join(dirname(f), m[1]));
  }
  assert.ok(seen.size > 10, 'the import walk found suspiciously few modules');
  const listed = new Set(files.map((f) => join(dirname(fileURLToPath(import.meta.url)), f)));
  const missing = [...seen].filter((f) => !listed.has(f) && !isOwnOutput(f, dirname(fileURLToPath(import.meta.url))));
  assert.deepEqual(missing, [], 'modules reachable by import from w2/edit2.mjs but not on the stamped list');
});

test('🔴 #1929 r1: the generator itself is stamped — changing how the bundle is ASSEMBLED makes it stale', async () => {
  // codex review of tile#133, P1. SOURCE_FILES held what the generator READ, not the generator: change
  // FONT_BASE, the HTML slicing or the CSS order in gen-edit2-assets.mjs and the committed artifact is
  // no longer what it would emit, while every byte it reads is unchanged — stamp green, bundle stale.
  const assets = await import('./edit2-assets.mjs');
  const { sourceStamp } = await import('./edit2-sources.mjs');
  for (const f of ['gen-edit2-assets.mjs', 'edit2-sources.mjs']) {
    assert.ok(assets.SOURCE_FILES?.includes(f), `${f} decides what the bundle contains but is not on the stamped list`);
  }
  // the knife the reviewer asked for, by injection: flip one byte of the generator ⇒ the stamp moves
  const flipped = sourceStamp(assets.SOURCE_FILES, undefined, (p) => {
    const b = Buffer.from(readFileSync(p));
    if (p.endsWith('/gen-edit2-assets.mjs')) b[0] ^= 1;
    return b;
  });
  assert.notEqual(flipped, assets.SOURCE_STAMP, 'editing the generator does not move the stamp');
});

test('🔴 #1929 r1: the previous-output exclusion is an EXACT path, not a basename suffix', async () => {
  // codex review P2. `endsWith('edit2-assets.mjs')` exempted any module with that tail from the
  // stamped list and from the import walk. Only this generator's own output is circular.
  const { isOwnOutput } = await import('./edit2-sources.mjs');
  const here = dirname(fileURLToPath(import.meta.url));
  assert.equal(typeof isOwnOutput, 'function', 'isOwnOutput is missing');
  assert.equal(isOwnOutput(join(here, 'edit2-assets.mjs'), here), true, 'CONTROL: the real output is excluded');
  assert.equal(isOwnOutput(join(here, '../serve/./edit2-assets.mjs'), here), true, 'same file spelled differently is still the same file');
  assert.equal(isOwnOutput(join(here, '../w2/edit2-assets.mjs'), here), false, 'same name, other directory');
  assert.equal(isOwnOutput(join(here, 'other-edit2-assets.mjs'), here), false, 'same tail, other name');
});

test('🔴 #1929 r1: signet is bound to the LOCKFILE version; a different installed version is a version message, not "bundle stale"', async () => {
  // codex review P2. package.json says `latest`, the lockfile resolves one version, and corners.css is
  // read from whatever is installed. The bytes may only be compared when the installed version is the
  // one the bundle was generated against; otherwise the honest report is "different signet".
  const { signetVerdict, signetLockVersion } = await import('./edit2-sources.mjs');
  const assets = await import('./edit2-assets.mjs');
  assert.equal(typeof signetVerdict, 'function', 'signetVerdict is missing');
  const lock = signetLockVersion();
  assert.match(lock, /^\d+\.\d+\.\d+/, 'the lockfile names no signet version');
  assert.equal(assets.SIGNET_LOCK_VERSION, lock, `the bundle was generated against signet ${assets.SIGNET_LOCK_VERSION}, the lockfile now says ${lock} — regenerate`);
  const base = { recordedVersion: '0.6.0', lockVersion: '0.6.0', recordedStamp: 'aaaa', installed: { version: '0.6.0', stamp: 'aaaa' } };
  assert.equal(signetVerdict(base).status, 'ok');
  assert.equal(signetVerdict({ ...base, installed: null }).status, 'skipped');
  assert.equal(signetVerdict({ ...base, installed: { version: '0.6.0', stamp: 'bbbb' } }).status, 'bytes-differ', 'same version, other bytes: the one case that is the bundle\'s fault');
  const other = signetVerdict({ ...base, installed: { version: '0.7.1', stamp: 'bbbb' } });
  assert.equal(other.status, 'version-differs', 'a different installed version never reaches the bytes comparison');
  assert.match(other.message, /signet 版本不同（0\.7\.1 vs 0\.6\.0）/);
  assert.doesNotMatch(other.message, /stale|過期/);
  assert.equal(signetVerdict({ ...base, lockVersion: '0.7.0' }).status, 'lock-moved', 'lockfile moved since generation');
  // and the live check: where signet is installed at the lockfile's version, its bytes are the recorded ones
  const { signetInstalled } = await import('./edit2-sources.mjs');
  const v = signetVerdict({ recordedVersion: assets.SIGNET_LOCK_VERSION, lockVersion: lock, recordedStamp: assets.SIGNET_CORNERS_STAMP, installed: signetInstalled() });
  if (v.status === 'skipped') console.log('    (partial: @cvernet/signet not installed — corners.css stamp check skipped)');
  else if (v.status === 'version-differs') console.log('    (partial: ' + v.message + ' — corners.css bytes not compared)');
  else assert.equal(v.status, 'ok', v.message);
});

// ── HOST MODE: /edit?host=<parent origin> ───────────────────────────────────────────────────────
//
// feelreef embeds the editor on a REAL card. The page carries no card and no credential; the card
// travels over postMessage (w2/host-bridge.test.mjs covers that logic). What a fetch() test can
// promise: the route resolves only for an allowed parent, it says so in the injected opts, and it
// never touches the store — proven with a store whose EVERY method throws, bound where the Worker
// actually looks for it (`env.CARDS`), and an env that records any other binding read.

function untouchableEnv() {
  const touched = [];
  const boom = (m) => async () => { touched.push(m); throw new Error(`/edit must never ${m} the CARDS store`); };
  const CARDS = { get: boom('get'), put: boom('put'), list: boom('list'), delete: boom('delete'), getWithMetadata: boom('getWithMetadata') };
  return { env: { CARDS }, touched };
}
const optsOf = (body) => JSON.parse(/window\.__CARDTILE_W2_OPTS__ = (\{.*?\});/.exec(body)[1]);

test('host mode: /edit?host=feelreef serves the editor with host opts, noindex, framable only by that host, never touching CARDS', async () => {
  for (const host of ['https://feelreef.com', 'https://staging.feelreef.com', 'http://localhost:5173']) {
    for (const path of ['/edit', '/edit/']) {
      const { env, touched } = untouchableEnv();
      const res = await worker.fetch(new Request(`https://card.feelreef.com${path}?host=${encodeURIComponent(host)}&lang=ja`), env);
      assert.equal(res.status, 200, `${path} ${host}`);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(res.headers.get('content-security-policy'), `frame-ancestors ${host}`);
      assert.equal(res.headers.get('x-frame-options'), null, 'a page meant to be framed must not forbid it');
      const body = await res.text();
      assert.deepEqual(optsOf(body), { host, sandbox: false, locale: 'ja', tableBase: '/try/edit/t/ja/' });
      assert.ok(body.includes('id="sandbox-banner" hidden'), 'host mode ships the sandbox banner hidden');
      assert.match(body, /id="host-save"/);
      // 🔴 host mode never ships the sandbox's "Try Card · feelreef" — before the parent hands over
      // a real card there is nothing to name yet, so the tab reads the bare product name.
      assert.match(body, /<title>Card · feelreef<\/title>/, 'host mode ships the placeholder title, not the sandbox\'s');
      assert.deepEqual(touched, []);
    }
  }
});

test('host mode: a missing or disallowed ?host= is a 400, and still never touches CARDS', async () => {
  const bad = ['', '?host=', '?host=https%3A%2F%2Fevil.example', '?host=https%3A%2F%2Ffeelreef.com.evil.example',
    '?host=http%3A%2F%2Ffeelreef.com', '?host=https%3A%2F%2Ffeelreef.com%2Fdashboard', '?host=*', '?host=https%3A%2F%2Flocalhost%3A1',
    '?host=https%3A%2F%2Fuser%40feelreef.com', '?host=not%20a%20url'];
  for (const q of bad) {
    const { env, touched } = untouchableEnv();
    const res = await worker.fetch(new Request(`https://card.feelreef.com/edit${q}`), env);
    assert.equal(res.status, 400, q);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.doesNotMatch(await res.text(), /__CARDTILE_W2_OPTS__/);
    assert.deepEqual(touched, [], q);
  }
});

test('host mode: ?host= on the SANDBOX path does not leak — /try/edit stays the sandbox', async () => {
  const { env, touched } = untouchableEnv();
  const res = await worker.fetch(new Request(`https://card.feelreef.com/try/edit?host=${encodeURIComponent('https://feelreef.com')}`), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  const opts = optsOf(body);
  assert.equal(opts.sandbox, true);
  assert.equal('host' in opts, false, 'the sandbox must never carry a host');
  assert.equal(res.headers.get('content-security-policy'), null);
  assert.deepEqual(touched, []);
});

test('CONTROL: the untouchable store really does throw when the Worker reads a card', async () => {
  // without this, "touched is empty" could mean the double is never where the Worker looks
  const { env, touched } = untouchableEnv();
  await worker.fetch(new Request('https://card.feelreef.com/somebody'), env).catch(() => {});
  assert.ok(touched.length > 0, 'the store double is not bound where the Worker reads cards');
});

// ── indexing and serving stop ─────────────────────────────────────────────────────────────────────

const SERVING_CARD = [
  '---', 'card-page: t', 'title: Test Card', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% A public bio',
  '', '## assets', '',
  '- [ ] %% card: asset id=pic mime=image/gif %% R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  '',
].join('\n');

// the same handle, still only create_card's starter (reef create-card.js starterCardMarkdown, mirrored
// line for line in card-blank-noindex.test.mjs): nothing on it was written by its author
const BLANK_CARD = [
  '---', 'card-page: t', 'title: Test Card', 'theme: light', 'cols: 6', '---', '', '## grid', '',
  `- [ ] %% card: ${BLANKS.profile.type} ${BLANKS.profile.rawParams} %% ${BLANKS.profile.body}`,
  `- [ ] %% card: ${BLANKS.social.type} ${BLANKS.social.rawParams} %%`,
  ...BLANKS.social.body.split('\n').map((l) => `\t${l.trim()}`),
  '',
].join('\n');

function servingRequests(host, handle = 't', vanity = false) {
  const origin = `https://${host}`, base = vanity ? '' : `/${handle}`;
  const page = origin + (base || '/');
  return [
    [page, {}],
    [page, { headers: { accept: 'text/markdown' } }],
    [origin + (vanity ? '/index.md' : `/${handle}.md`), {}],
    ...['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'].map((file) => [`${origin}${base}/${file}`, {}]),
    ...(vanity ? [[`${origin}/${handle}.md`, {}]] : []),
  ];
}

const responseBytes = async (res) => ({
  status: res.status, headers: [...res.headers], body: Buffer.from(await res.arrayBuffer()),
});

test('production Cards on canonical and fallback hosts carry noindex on every representation; an unbound host serves none', async () => {
  for (const host of ['card.feelreef.com', 'saas.feelreef.com']) {
    const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD }) };
    for (const [url, init] of servingRequests(host)) {
      const res = await worker.fetch(new Request(url, init), env);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', url);
      const icon = /\.(ico|svg|png)$/.test(url);
      assert.equal(res.headers.get('cache-control'), icon ? 'public, max-age=3600' : 'public, max-age=60', url);
      assert.equal(res.headers.get('vary'), icon ? null : 'Accept', url);
    }
  }
  // reef#2618 r2: a creator's domain routes by its binding only, so with none it names no card on
  // any path — this used to be 200 for every representation, which is how a former domain served the
  // handle's next owner.
  const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD }) };
  for (const [url, init] of servingRequests('unbound.example')) {
    const res = await worker.fetch(new Request(url, init), env);
    assert.equal(res.status, 404, url);
    assert.doesNotMatch(await res.text(), /Test Card|Pick a card/, url);
  }
});

test('a bound vanity Card stays indexable, while preview and demo Cards include noindex on icons too', async () => {
  for (const [handle, preview, robots] of [
    ['t', 'false', null], ['demo-t', 'false', 'noindex, nofollow'],
    ['t', 'true', 'noindex, nofollow'], ['t', undefined, 'noindex, nofollow'],
  ]) {
    const env = { PREVIEW: preview, CARDS: recordingStore({ [handle]: SERVING_CARD, 'vanity:card.example': handle }) };
    for (const [url, init] of servingRequests('card.example', handle, true)) {
      const res = await worker.fetch(new Request(url, init), env);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get('x-robots-tag'), robots, `${handle} ${preview} ${url}`);
      const icon = /\.(ico|svg|png)$/.test(url);
      assert.equal(res.headers.get('cache-control'), icon ? 'public, max-age=3600' : 'public, max-age=60', url);
      assert.equal(res.headers.get('vary'), icon ? null : 'Accept', url);
    }
  }
});

test('Card not-found pages and missing icons carry the same host-aware noindex rule', async () => {
  for (const host of ['card.feelreef.com', 'saas.feelreef.com', 'unbound.example']) {
    const env = { PREVIEW: 'false', CARDS: recordingStore() };
    for (const [url, init] of [...servingRequests(host, 'missing'), [`https://${host}/t/nothing`, {}], [`https://${host}/`, {}]]) {
      const res = await worker.fetch(new Request(url, init), env);
      assert.equal(res.status, 404, url);
      // tile-lab#51: card.feelreef.com's bare root is the root card's (indexable) address, even when
      // that card is missing; the 404 status already keeps it out of an index
      const rootOfCardHost = host === 'card.feelreef.com' && url === `https://${host}/`;
      assert.equal(res.headers.get('x-robots-tag'), rootOfCardHost ? null : 'noindex, nofollow', url);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=60', url);
    }
  }
  for (const handle of ['missing', 'demo-missing']) {
    const env = { PREVIEW: 'false', CARDS: recordingStore({ 'vanity:card.example': handle }) };
    for (const [url, init] of [...servingRequests('card.example', handle, true), ['https://card.example/nothing', {}]]) {
      const res = await worker.fetch(new Request(url, init), env);
      assert.equal(res.status, 404, url);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', url);
    }
  }
});

test('stopping a Card blocks every representation on both hosts; resume restores bytes without Worker writes', async () => {
  // (an unbound creator's host serves no card at all — reef#2618 r2 — so it has nothing to stop)
  for (const host of ['card.feelreef.com', 'saas.feelreef.com', 'card.example']) {
    const vanity = host === 'card.example';
    const seed = { t: SERVING_CARD, ...(vanity ? { 'vanity:card.example': 't' } : {}) };
    const store = recordingStore(seed), deletes = [];
    store.delete = async (k) => { deletes.push(k); store.kv.delete(k); };
    const env = { PREVIEW: 'false', CARDS: store };
    const requests = servingRequests(host, 't', vanity), before = [];
    for (const [url, init] of requests) {
      const res = await worker.fetch(new Request(url, init), env);
      assert.equal(res.status, 200, url);
      before.push(await responseBytes(res));
    }
    assert.notDeepEqual(before[1].body, before[2].body, 'thin and fat fixtures must differ');
    const marker = JSON.stringify({ stopped_at: '2026-01-01T00:00:00.000Z', reason: 'Review requested' });
    store.kv.set('stop:t', marker);
    // tile-lab#51: stopped = exactly what the same address answers when there is no card at all
    const { t: _body, ...withoutCard } = seed;
    for (const [url, init] of requests) {
      const res = await responseBytes(await worker.fetch(new Request(url, init), env));
      assert.equal(res.status, 404, url);
      assert.doesNotMatch(res.body.toString(), /Test Card|A public bio|Review requested|R0lGODlh|unavailable/i, url);
      const none = await responseBytes(await worker.fetch(new Request(url, init), { PREVIEW: 'false', CARDS: recordingStore(withoutCard) }));
      assert.deepEqual(res, none, `${url}: a stopped Card answers differently from no card`);
    }
    assert.equal(store.kv.get('stop:t'), marker, 'the Worker changed the serving marker');
    store.kv.delete('stop:t');
    for (let i = 0; i < requests.length; i++) {
      const [url, init] = requests[i];
      assert.deepEqual(await responseBytes(await worker.fetch(new Request(url, init), env)), before[i], url);
    }
    assert.deepEqual(store.puts, [], 'the Worker wrote to the store');
    assert.deepEqual(deletes, [], 'the Worker deleted from the store');
    assert.deepEqual([...store.kv], Object.entries(seed));
  }
});

test('the card body and stop marker reads start in parallel for pages, markdown and icons', async () => {
  for (const host of ['card.feelreef.com', 'card.example']) {
    for (const [url, init] of servingRequests(host, 't', host === 'card.example')) {
      const reads = [];
      let releaseCard, releaseStop;
      const cardRead = new Promise((resolve) => { releaseCard = resolve; });
      const stopRead = new Promise((resolve) => { releaseStop = resolve; });
      const store = { get: async (k) => {
        reads.push(k);
        if (k === 't') return cardRead;
        if (k === 'stop:t') return stopRead;
        return k === 'vanity:card.example' ? 't' : null;
      }, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };
      const pending = worker.fetch(new Request(url, init), { PREVIEW: 'false', CARDS: store });
      await new Promise((resolve) => setImmediate(resolve));
      const started = [...reads];
      releaseCard(SERVING_CARD);
      releaseStop(null);
      assert.equal((await pending).status, 200, url);
      assert.ok(started.includes('t'), `${url}: the body read waited for the marker`);
      assert.ok(started.includes('stop:t'), `${url}: the marker read waited for the body`);
      assert.equal(reads.filter((k) => k === 't').length, 1, url);
      assert.equal(reads.filter((k) => k === 'stop:t').length, 1, url);
    }
  }
});

test('an unknown path under a stopped handle returns the no-card page without any store read', async () => {
  const store = recordingStore({ t: SERVING_CARD, 'stop:t': '' }), reads = [];
  const get = store.get;
  store.get = async (k) => { reads.push(k); return get(k); };
  const res = await worker.fetch(new Request('https://card.feelreef.com/t/nothing'), { PREVIEW: 'false', CARDS: store });
  assert.deepEqual(reads, []);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('vary'), 'Accept');
  assert.match(await res.text(), NO_CARD);
});

test('stop takes precedence over redirects and missing cards, and resume preserves their responses', async () => {
  const store = recordingStore({
    t: SERVING_CARD, 'vanity:card.example': 't', 'vanityof:t': 'card.example',
    'vanity:missing.example': 'missing',
  });
  const env = { PREVIEW: 'false', CARDS: store };
  for (const [url, handle, status] of [
    ['https://card.feelreef.com/t?lang=en', 't', 301],
    ['https://card.example/t?lang=en', 't', 301],
    ['https://missing.example/', 'missing', 404],
    ['https://card.feelreef.com/missing', 'missing', 404],
    ['https://card.feelreef.com/missing/favicon.ico', 'missing', 404],
  ]) {
    const before = await responseBytes(await worker.fetch(new Request(url), env));
    assert.equal(before.status, status, url);
    if (status === 301) assert.equal(new Map(before.headers).get('location'), 'https://card.example/?lang=en');
    store.kv.set(`stop:${handle}`, '');
    const res = await worker.fetch(new Request(url), env);
    assert.equal(res.status, 404, url);
    // tile-lab#51: no redirect to the card's own domain (it would name the binding), and the one
    // no-card page or the bare icon 404 — the same a missing card gets, never an "unavailable" one
    assert.equal(res.headers.get('location'), null, url);
    const body = await res.text();
    assert.doesNotMatch(body, /unavailable|Test Card/i, url);
    if (new URL(url).hostname.endsWith('.example')) assert.match(body, /<p>Nothing here\.<\/p>/, url);
    else if (!url.endsWith('.ico')) assert.match(body, NO_CARD, url);
    store.kv.delete(`stop:${handle}`);
    assert.deepEqual(await responseBytes(await worker.fetch(new Request(url), env)), before, url);
  }
  assert.deepEqual(store.puts, []);
});

test('🔴 /_yt/ and /_icon/ cache on origin + path: a query string does not make a second entry or a second upstream fetch (tile#150 L3)', async () => {
  const seen = [], stored = new Map();
  const real = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async (r) => stored.get(r.url)?.clone(), put: async (r, v) => { stored.set(r.url, v); } } };
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };
  try {
    const env = { PREVIEW: 'false', CARDS: { get: async () => null } };
    for (const q of ['', '?1', '?2', '?cache=bust']) {
      const res = await worker.fetch(new Request('https://card.feelreef.com/_yt/dQw4w9WgXcQ.jpg' + q), env);
      assert.equal(res.status, 200, q);
    }
    assert.deepEqual(seen, ['https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'], 'a query string went upstream again');
    assert.deepEqual([...stored.keys()], ['https://card.feelreef.com/_yt/dQw4w9WgXcQ.jpg']);
  } finally { globalThis.fetch = real; globalThis.caches = realCaches; }
});

// ── reef#2725: reef.cards, the Card's own registrable domain ─────────────────────────────────────
//
// One switch, CARD_CANONICAL_HOST. Unset (production today) = `card.feelreef.com`, and nothing about
// the old host changes. `reef.cards` = the move: Cards answer there, the old addresses 301 to it,
// and the root card (`feelreef`) is the one Card that may be indexed.

const ON = { CARD_CANONICAL_HOST: 'reef.cards' };
const ROOT_CARD = SERVING_CARD.replace('title: Test Card', 'title: feelreef');

test('reef#2725 ①: reef.cards routes by path exactly like the old host, and its root IS the feelreef card', async () => {
  assert.deepEqual(resolveHandle('reef.cards', '/inkbrush'), { handle: 'inkbrush', cardUrl: 'https://reef.cards/inkbrush' });
  assert.deepEqual(resolveHandle('reef.cards:443', '/INKB'), { handle: 'inkb', cardUrl: 'https://reef.cards/inkb' });
  // the root, under every name it answers to — always the reserved handle, always the bare origin
  for (const path of ['/', '', '/feelreef', '/FeelReef/', '/favicon.ico', '/apple-touch-icon.png']) {
    assert.deepEqual(resolveHandle('reef.cards', path), { handle: 'feelreef', cardUrl: 'https://reef.cards', root: true }, path);
  }
  // tile-lab#51: the old host's bare root is the feelreef card as well (it used to be the directory)
  for (const path of ['/', '/feelreef', '/favicon.ico']) {
    assert.deepEqual(resolveHandle('card.feelreef.com', path), { handle: 'feelreef', cardUrl: 'https://card.feelreef.com', root: true }, path);
  }

  // With the switch off, a route placed on the new host must expose no Cards or root assets.
  for (const off of [{}, { CARD_CANONICAL_HOST: 'evil.example' }]) {
    const store = recordingStore({ t: SERVING_CARD, feelreef: ROOT_CARD });
    const reads = [];
    const get = store.get;
    store.get = async (key) => { reads.push(key); return get(key); };
    const env = { PREVIEW: 'false', CARDS: store, ...off };
    for (const path of ['/t', '/', '/feelreef', '/favicon.ico', '/apple-touch-icon.png', '/_api/card/t']) {
      const res = await worker.fetch(new Request(`https://reef.cards${path}`), env);
      assert.equal(res.status, 404, `switch off: ${path}`);
    }
    assert.deepEqual(reads, [], 'switch off must not read card data');
    const old = await worker.fetch(new Request('https://card.feelreef.com/t'), env);
    assert.equal(old.status, 200);
    assert.ok((await old.text()).includes('<link rel="canonical" href="https://card.feelreef.com/t"'));
  }

  // With the switch on, the new host serves paths and its root Card.
  {
    const store = recordingStore({ t: SERVING_CARD, feelreef: ROOT_CARD });
    const env = { PREVIEW: 'false', CARDS: store, ...ON };
    const card = await worker.fetch(new Request('https://reef.cards/t'), env);
    assert.equal(card.status, 200);
    const body = await card.text();
    assert.match(body, /Test Card/);
    assert.ok(body.includes('<link rel="canonical" href="https://reef.cards/t"'));
    const root = await worker.fetch(new Request('https://reef.cards/'), env);
    assert.equal(root.status, 200);
    const rootBody = await root.text();
    assert.match(rootBody, /<title>feelreef/);
    assert.ok(rootBody.includes('<link rel="canonical" href="https://reef.cards"'), 'the root card names the bare origin');
    // the root's icons sit at the origin, where its <link rel=icon> points
    assert.equal((await worker.fetch(new Request('https://reef.cards/favicon.ico'), env)).status, 200);
    // one card, one address: /feelreef on reef.cards is the root under another name
    const alias = await worker.fetch(new Request('https://reef.cards/feelreef?lang=ja'), env);
    assert.equal(alias.status, 301);
    assert.equal(alias.headers.get('location'), 'https://reef.cards/?lang=ja');
    // the download keeps the canonical form, and is advertised that way
    const fat = await worker.fetch(new Request('https://reef.cards/feelreef.md'), env);
    assert.equal(fat.status, 200);
    assert.equal(await fat.text(), ROOT_CARD);
    const thin = await worker.fetch(new Request('https://reef.cards/', { headers: { accept: 'text/markdown' } }), env);
    assert.match(thin.headers.get('link') || '', /^<https:\/\/reef\.cards\/feelreef\.md>; rel="alternate"/);
  }
});

test('reef#2725 ②: with the switch on, the old card addresses 301 to reef.cards, path and query intact, cacheable', async () => {
  const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD, 'some-handle': SERVING_CARD }), ...ON };
  for (const [from, to] of [
    ['https://card.feelreef.com/t', 'https://reef.cards/t'],
    ['https://card.feelreef.com/T?utm_source=qr', 'https://reef.cards/T?utm_source=qr'],
    ['https://card.feelreef.com/t.md', 'https://reef.cards/t.md'],
    ['https://card.feelreef.com/t/favicon.ico', 'https://reef.cards/t/favicon.ico'],
    ['https://card.feelreef.com/try/edit?lang=ja', 'https://reef.cards/try/edit?lang=ja'],
    ['https://card.feelreef.com/', 'https://reef.cards/'],
    ['https://card.feelreef.com/.well-known/security.txt', 'https://reef.cards/.well-known/security.txt'],
    ['https://feelreef.com/t', 'https://reef.cards/t'],
    ['https://feelreef.com/Some-Handle?x=1', 'https://reef.cards/Some-Handle?x=1'],
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const res = await worker.fetch(new Request(from, { method }), env);
      assert.equal(res.status, 301, `${method} ${from}`);
      assert.equal(res.headers.get('location'), to, from);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=86400', from);
    }
  }
  // NOT moved: the write API (reef-MCP calls it by host), a POST (a 301 would turn it into a GET),
  // host-mode /edit (its parent pins this origin for postMessage), and anything on feelreef.com that
  // is not a single handle-shaped segment — the marketing site's own paths are never a Card.
  for (const [url, init] of [
    ['https://card.feelreef.com/_api/card/t', {}],
    ['https://card.feelreef.com/_api', {}],
    ['https://card.feelreef.com/try/park', { method: 'POST', body: 'x' }],
    ['https://card.feelreef.com/edit?host=https%3A%2F%2Ffeelreef.com', {}],
    ['https://feelreef.com/', {}],
    ['https://feelreef.com/dashboard/sites', {}],
    ['https://feelreef.com/report.html', {}],
  ]) {
    const res = await worker.fetch(new Request(url, init), env);
    assert.notEqual(res.status, 301, url);
    if (url === 'https://card.feelreef.com/_api') {
      assert.equal(res.status, 404, url);
      assert.match(await res.text(), /<!doctype html>/, 'bare /_api keeps its HTML 404');
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(res.headers.get('vary'), 'Accept');
    }
  }
  const newHostApi = await worker.fetch(new Request('https://reef.cards/_api'), env);
  assert.equal(newHostApi.status, 404);
  assert.match(await newHostApi.text(), /<!doctype html>/, 'bare /_api on reef.cards keeps its HTML 404');
  assert.equal(newHostApi.headers.get('x-robots-tag'), null, 'reef.cards is indexable; a 404 needs no header');
  assert.equal(newHostApi.headers.get('vary'), 'Accept');
  // switch OFF (unset, or anything that is not exactly reef.cards): the old host serves, as today
  for (const off of [{}, { CARD_CANONICAL_HOST: 'card.feelreef.com' }, { CARD_CANONICAL_HOST: 'evil.example' }, { CARD_CANONICAL_HOST: '' }]) {
    const e = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD }), ...off };
    assert.equal((await worker.fetch(new Request('https://card.feelreef.com/t'), e)).status, 200, JSON.stringify(off));
    assert.equal((await worker.fetch(new Request('https://card.feelreef.com/.well-known/security.txt'), e)).status, 200, JSON.stringify(off));
  }
  // after the switch, security.txt answers on the new host and names it as canonical
  const sec = await worker.fetch(new Request('https://reef.cards/.well-known/security.txt'), env);
  assert.equal(sec.status, 200);
  assert.match(await sec.text(), /^Canonical: https:\/\/reef\.cards\/\.well-known\/security\.txt$/m);
});

test('reef#2725: reserved apex paths stay on the site rather than redirect to Cards', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push(request.url);
    return new Response('site origin', { status: 200 });
  };
  try {
    for (const path of ['/report', '/pricing', '/login', '/edit', '/try']) {
      for (const variant of [path, `${path}/`, path.toUpperCase()]) {
        const url = `https://feelreef.com${variant}`;
        const moved = W.movedTo('feelreef.com', new URL(url), 'GET', ON);
        assert.equal(moved, null, `reserved apex path ${variant} must stay on the site`);
        const res = await worker.fetch(new Request(url), ON);
        assert.equal(res.status, 200, url);
        assert.equal(await res.text(), 'site origin', url);
      }
    }
    assert.equal(forwarded.length, 15);
  } finally { globalThis.fetch = originalFetch; }
});

test('tile#214: a live reserved Card stays on the apex site', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push(request.url);
    return new Response('site origin');
  };
  try {
    const env = { ...ON, CARDS: recordingStore({ 'card:report:0': SERVING_CARD, 'card:t:0': SERVING_CARD }) };
    const site = await worker.fetch(new Request('https://feelreef.com/report'), env);
    assert.equal(site.status, 200, 'live reserved report must reach site origin');
    assert.equal(await site.text(), 'site origin');
    const card = await worker.fetch(new Request('https://feelreef.com/t'), env);
    assert.equal(card.status, 301, 'non-reserved live Card still redirects');
    assert.equal(card.headers.get('location'), 'https://reef.cards/t');
    assert.deepEqual(forwarded, ['https://feelreef.com/report']);
  } finally { globalThis.fetch = originalFetch; }
});

test('tile#214: apex lookup errors fall through to the site origin', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push(request);
    return new Response(request.method === 'HEAD' ? null : 'site origin');
  };
  try {
    for (const failingKey of ['gen:t', 'card:t:0']) {
      for (const method of ['GET', 'HEAD']) {
        const store = recordingStore({ 'card:t:0': SERVING_CARD });
        const get = store.get;
        store.get = async (key) => {
          if (key === failingKey) throw new Error(`KV unavailable: ${key}`);
          return get(key);
        };
        const request = new Request('https://feelreef.com/t?from=qr', { method });
        const res = await worker.fetch(request, { ...ON, CARDS: store });
        assert.equal(res.status, 200, `${method} ${failingKey} failure must reach site origin`);
        assert.equal(res.headers.get('location'), null);
        assert.equal(await res.text(), method === 'HEAD' ? '' : 'site origin');
        assert.equal(forwarded.at(-1), request, 'forward the original request');
      }
    }
    assert.equal(forwarded.length, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test('tile#219: an apex store failure leaves exactly one warn line; a working store leaves none', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warned = [];
  globalThis.fetch = async () => new Response('site origin');
  console.warn = (...args) => { warned.push(args); };
  try {
    // Success: a live Card redirects and a missing one reaches the site — neither is a failure.
    const ok = { ...ON, CARDS: recordingStore({ 'card:t:0': SERVING_CARD }) };
    assert.equal((await worker.fetch(new Request('https://feelreef.com/t'), ok)).status, 301);
    assert.equal((await worker.fetch(new Request('https://feelreef.com/nobody'), ok)).status, 200);
    assert.deepEqual(warned, [], 'a working store must not warn');

    // Failure: the request is still forwarded, and the operator gets one structured line.
    // The store's error names the key it failed on (so the handle) and, here, a credential:
    // neither may reach the log. Only an allowlisted classification of the error does.
    const store = recordingStore({ 'card:privatehandle:0': SERVING_CARD });
    store.get = async (key) => { throw new TypeError(`KV unavailable for ${key}; token=supersecret`); };
    const res = await worker.fetch(new Request('https://feelreef.com/privatehandle'), { ...ON, CARDS: store });
    assert.equal(res.status, 200, 'the failure still reaches the site origin');
    assert.equal(warned.length, 1, 'exactly one line per failed lookup');
    assert.equal(warned[0].length, 1, 'one JSON string argument');
    const line = warned[0][0];
    assert.ok(!line.includes('privatehandle'), `the handle must not be logged: ${line}`);
    assert.ok(!line.includes('token='), `error text must not be logged: ${line}`);
    assert.ok(!line.includes('supersecret'), `error text must not be logged: ${line}`);
    assert.deepEqual(JSON.parse(line), {
      event: 'apex_card_lookup_failed', host: 'feelreef.com', op: 'liveCard', error: 'TypeError',
    });

    // A name outside the allowlist is error text too (a custom class, or a store that sets
    // `name` from its input): it is classified, never echoed.
    warned.length = 0;
    store.get = async () => { const e = new Error('x'); e.name = 'privatehandle token=supersecret'; throw e; };
    await worker.fetch(new Request('https://feelreef.com/privatehandle'), { ...ON, CARDS: store });
    assert.equal(warned.length, 1);
    assert.deepEqual(JSON.parse(warned[0][0]), {
      event: 'apex_card_lookup_failed', host: 'feelreef.com', op: 'liveCard', error: 'unknown',
    });

    // A thrown value whose `name` answers differently on each read: the allowlist check and the
    // logged value must be the same single read, so the second answer never reaches the log.
    warned.length = 0;
    store.get = async () => {
      let reads = 0;
      throw { get name() { reads += 1; return reads === 1 ? 'TypeError' : 'privatehandle token=supersecret'; } };
    };
    const twoFaced = await worker.fetch(new Request('https://feelreef.com/privatehandle'), { ...ON, CARDS: store });
    assert.equal(twoFaced.status, 200, 'a two-faced name still reaches the site origin');
    assert.equal(warned.length, 1);
    assert.ok(!warned[0][0].includes('privatehandle') && !warned[0][0].includes('token='),
      `the second read of name must not be logged: ${warned[0][0]}`);
    assert.deepEqual(JSON.parse(warned[0][0]), {
      event: 'apex_card_lookup_failed', host: 'feelreef.com', op: 'liveCard', error: 'TypeError',
    });

    // A thrown value whose `name` getter throws: classifying it must not cost the visitor the site.
    warned.length = 0;
    store.get = async () => { throw { get name() { throw new Error('privatehandle token=supersecret'); } }; };
    const hostile = await worker.fetch(new Request('https://feelreef.com/privatehandle'), { ...ON, CARDS: store });
    assert.equal(hostile.status, 200, 'a throwing name getter still reaches the site origin');
    assert.equal(await hostile.text(), 'site origin');
    assert.equal(warned.length, 1);
    assert.deepEqual(JSON.parse(warned[0][0]), {
      event: 'apex_card_lookup_failed', host: 'feelreef.com', op: 'liveCard', error: 'unknown',
    });

    // Logging itself failing (a console that throws) is no reason to drop the visitor either.
    console.warn = () => { throw new Error('console unavailable'); };
    const noConsole = await worker.fetch(new Request('https://feelreef.com/privatehandle'), { ...ON, CARDS: store });
    assert.equal(noConsole.status, 200, 'a throwing console still reaches the site origin');
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});

test('reef#2725 r3: apex redirects only a live Card; unknown site routes reach origin', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push(request.url);
    return new Response('site origin', { status: 200 });
  };
  try {
    const store = recordingStore({ 'card:t:0': SERVING_CARD,
      'gen:retired': 'aaaaaaaaaaaaaaaaaaaaaaaa', 'card:retired:0': SERVING_CARD });
    const reads = [];
    const get = store.get;
    store.get = async (key) => { reads.push(key); return get(key); };
    const env = { CARDS: store, ...ON };
    for (const path of ['/signup', '/dashboard', '/card', '/absent', '/retired']) {
      const res = await worker.fetch(new Request(`https://feelreef.com${path}`), env);
      assert.equal(res.status, 200, `${path} must reach site origin when no Card exists`);
      assert.equal(await res.text(), 'site origin');
    }
    const card = await worker.fetch(new Request('https://feelreef.com/t?from=qr'), env);
    assert.equal(card.status, 301);
    assert.equal(card.headers.get('location'), 'https://reef.cards/t?from=qr');
    assert.deepEqual(forwarded, ['/signup', '/dashboard', '/card', '/absent', '/retired'].map((p) => `https://feelreef.com${p}`));
    assert.ok(reads.includes('gen:t') && reads.includes('card:t:0'), 'redirect checks the current Card body');
    assert.equal(reads.filter((key) => key === 'gen:t').length, 1, 'one generation read per candidate');
  } finally { globalThis.fetch = originalFetch; }
});

test('reef#2725 r4: every other apex path reaches the site origin on GET and HEAD', async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (request) => {
    forwarded.push([request.method, request.url]);
    return new Response(request.method === 'HEAD' ? null : 'site origin', { status: 200 });
  };
  try {
    const env = { CARDS: recordingStore({ 'card:t:0': SERVING_CARD }), ...ON };
    const paths = ['/', '/dashboard/sites', '/report.html', '/t.md', '/.well-known/security.txt', '/absent'];
    for (const method of ['GET', 'HEAD']) {
      for (const path of paths) {
        const url = `https://feelreef.com${path}`;
        const res = await worker.fetch(new Request(url, { method }), env);
        assert.equal(res.status, 200, `${method} ${path} must reach site origin`);
        if (method === 'GET') assert.equal(await res.text(), 'site origin', path);
      }
    }
    assert.deepEqual(forwarded, ['GET', 'HEAD'].flatMap((method) =>
      paths.map((path) => [method, `https://feelreef.com${path}`])));
  } finally { globalThis.fetch = originalFetch; }
});

test('reef#2725 r3: switch off keeps apex routing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('switch-off request unexpectedly forwarded to origin'); };
  try {
    const store = recordingStore({ report: SERVING_CARD });
    const apex = await worker.fetch(new Request('https://feelreef.com/report'), { CARDS: store });
    assert.equal(apex.status, 404, 'switch off retains the old apex route result');
  } finally { globalThis.fetch = originalFetch; }
});

test('reef#2725 r3: switch off keeps the old bare /_api response', async () => {
  const api = await worker.fetch(new Request('https://card.feelreef.com/_api'), { CARDS: recordingStore() });
  assert.equal(api.status, 404);
  assert.match(await api.text(), /<!doctype html>/, 'bare /_api keeps its HTML 404');
  assert.equal(api.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(api.headers.get('vary'), 'Accept');
});

test('reef#2725 ③: ONE noindex predicate — host × handle × switch', () => {
  assert.equal(typeof W.robotsTag, 'function', 'card-worker.mjs exports no robotsTag predicate');
  const NNF = 'noindex, nofollow';
  for (const [host, handle, sw, want] of [
    // the move: reef.cards is the user-content domain — a customer Card is indexable there like the root
    // (reef#2044: Cards stay searchable; only a blank-template Card is noindex, see below)
    ['reef.cards', 'feelreef', 'on', null],
    ['reef.cards', 't', 'on', null],
    ['reef.cards', 'demo-t', 'on', NNF],
    // The pure predicate still describes the root, though the switch gates off-host requests first.
    ['reef.cards', 'feelreef', 'off', null],
    ['reef.cards', 't', 'off', NNF],
    // the old host keeps today's rule in both positions, for every customer Card
    ['card.feelreef.com', 'feelreef', 'off', null],
    ['card.feelreef.com', 't', 'off', NNF],
    ['card.feelreef.com', 'feelreef', 'on', null],
    ['card.feelreef.com', 't', 'on', NNF],
    // the root card is a Card host's root, and saas.feelreef.com has none
    ['saas.feelreef.com', 'feelreef', 'on', NNF],
    ['saas.feelreef.com', 'feelreef', 'off', NNF],
  ]) {
    const env = { PREVIEW: 'false', ...(sw === 'on' ? ON : {}) };
    assert.equal(W.robotsTag({ env, host, handle, vanity: false }), want, `${host} ${handle} ${sw}`);
    // a preview deployment never indexes, root or not
    assert.equal(W.robotsTag({ env: { ...env, PREVIEW: 'true' }, host, handle, vanity: false }), NNF, `preview ${host} ${handle} ${sw}`);
  }
  // a creator's bound domain is untouched by the switch; blank still adds noindex
  for (const sw of [{}, ON]) {
    assert.equal(W.robotsTag({ env: { PREVIEW: 'false', ...sw }, host: 'card.example', handle: 't', vanity: true }), null);
    assert.equal(W.robotsTag({ env: { PREVIEW: 'false', ...sw }, host: 'card.example', handle: 't', vanity: true, blank: true }), 'noindex');
  }
  // the root card still waits for content like any other — and so does a customer Card on reef.cards
  assert.equal(W.robotsTag({ env: { PREVIEW: 'false', ...ON }, host: 'reef.cards', handle: 'feelreef', vanity: false, blank: true }), 'noindex');
  assert.equal(W.robotsTag({ env: { PREVIEW: 'false', ...ON }, host: 'reef.cards', handle: 't', vanity: false, blank: true }), 'noindex');
});

test('reef#2725 ③: the predicate is what the Worker sends, on every representation', async () => {
  const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD, feelreef: ROOT_CARD }), ...ON };
  for (const [url, init] of servingRequests('reef.cards', 't')) {
    const res = await worker.fetch(new Request(url, init), env);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('x-robots-tag'), null, url);
  }
  // a Card nobody has written on yet is the one exception (reef#2044 ④)
  const blankEnv = { PREVIEW: 'false', CARDS: recordingStore({ t: BLANK_CARD, feelreef: ROOT_CARD }), ...ON };
  for (const [url, init] of servingRequests('reef.cards', 't')) {
    const res = await worker.fetch(new Request(url, init), blankEnv);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', url);
  }
  // a page with no Card on it: the 404 status alone keeps it out of an index, no header
  const missing = await worker.fetch(new Request('https://reef.cards/nobody'), env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-robots-tag'), null);
  // the root, as a one-card host: page, thin markdown, its icons, and its download
  for (const url of ['https://reef.cards/', 'https://reef.cards/feelreef.md', 'https://reef.cards/favicon.ico',
    'https://reef.cards/favicon.svg', 'https://reef.cards/apple-touch-icon.png']) {
    const res = await worker.fetch(new Request(url), env);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('x-robots-tag'), null, url);
  }
  // the kill switch still wins over the root's indexability
  const killed = await worker.fetch(new Request('https://reef.cards/'), { ...env, CARD_NOINDEX_ALL: '1' });
  assert.equal(killed.headers.get('x-robots-tag'), 'noindex');
});

// tile-lab#51 ③ (product owner 2026-10-30): 「根頁那張 feelreef 自己的卡開索引；客戶的卡維持整主機 noindex」—
// the host-wide noindex was 「直到…搬去獨立 usercontent 網域那天」, and reef.cards is that domain (reef#2725,
// 2026-10-31: 「reef.cards 上的免費 Card 預設可索引」). The root response carries no X-Robots-Tag on BOTH
// hosts; a customer Card keeps its header on the old host and loses it on reef.cards.
test('tile-lab#51 ③: the root card is indexable on active hosts; customer Cards keep the old host\'s header', async () => {
  for (const [sw, host, cust] of [[{}, 'card.feelreef.com', 'noindex, nofollow'], [ON, 'reef.cards', null]]) {
    const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD, feelreef: ROOT_CARD }), ...sw };
    const root = await worker.fetch(new Request(`https://${host}/`), env);
    assert.equal(root.status, 200, `${host} / ${JSON.stringify(sw)}`);
    assert.match(await root.text(), /<title>feelreef<\/title>|feelreef/, host);
    assert.equal(root.headers.get('x-robots-tag'), null, `${host} / ${JSON.stringify(sw)}`);
    const t = await worker.fetch(new Request(`https://${host}/t`), env);
    assert.equal(t.status, 200);
    assert.equal(t.headers.get('x-robots-tag'), cust, `${host}/t ${JSON.stringify(sw)}`);
  }
  // one card, one address: `/feelreef` on the old host is the root card's alias
  const env = { PREVIEW: 'false', CARDS: recordingStore({ feelreef: ROOT_CARD }) };
  const alias = await worker.fetch(new Request('https://card.feelreef.com/feelreef?x=1'), env);
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), 'https://card.feelreef.com/?x=1');
});

// ── reef#2725 r2: the inverse follows the switch ────────────────────────────────────────────────
// cardUrlFor is resolveHandle read backwards, and the editor's "is this link the author's own site"
// rides on it. With the switch on, resolveHandle answers on reef.cards, so its inverse must too —
// otherwise the editor computes card.feelreef.com/<h> for a card whose address is reef.cards/<h>.
test('reef#2725 r2 ①: cardUrlFor names the configured card host — unset is today, byte for byte', () => {
  // PIN: no env, an empty env and every value that is not exactly reef.cards = today's string
  for (const env of [undefined, {}, { CARD_CANONICAL_HOST: '' }, { CARD_CANONICAL_HOST: 'card.feelreef.com' }, { CARD_CANONICAL_HOST: 'evil.example' }]) {
    assert.equal(W.cardUrlFor('inkbrush', {}, env), 'https://card.feelreef.com/inkbrush', JSON.stringify(env));
    // tile-lab#51: the root card lives at the bare origin on the old host too (`/feelreef` 301s there)
    assert.equal(W.cardUrlFor('feelreef', {}, env), 'https://card.feelreef.com', JSON.stringify(env));
    assert.equal(W.cardUrlFor('feelreef', {}, env), resolveHandle('card.feelreef.com', '/feelreef').cardUrl);
  }
  assert.equal(W.cardUrlFor('inkbrush'), 'https://card.feelreef.com/inkbrush');
  // ON: the same URL resolveHandle hands out for that handle on that host — the root card is the bare origin
  assert.equal(W.cardUrlFor('inkbrush', {}, ON), 'https://reef.cards/inkbrush');
  assert.equal(W.cardUrlFor('inkbrush', {}, ON), resolveHandle('reef.cards', '/inkbrush').cardUrl);
  assert.equal(W.cardUrlFor('feelreef', {}, ON), 'https://reef.cards');
  assert.equal(W.cardUrlFor('feelreef', {}, ON), resolveHandle('reef.cards', '/feelreef').cardUrl);
  // a vanity binding still wins in both positions: one domain = one card
  for (const env of [{}, ON]) assert.equal(W.cardUrlFor('maple', { 'maple.example': 'maple' }, env), 'https://maple.example');
});

// reef#2725 r2 ③ — host-mode `/edit` answers on reef.cards after the switch, with the same page
// and parent pins; before the switch main's host gate keeps reef.cards dark. The old host keeps serving it (never
// 301'd — an iframe that followed a redirect would change origin under the parent's
// `event.origin` check). So feelreef can move its framing page whenever it likes, before or after
// the switch, and the old one keeps working until it does. The checklist is in the lane report.
test('reef#2725 r2 ③: host-mode /edit serves on the old host in both positions and reef.cards after cutover', async () => {
  const host = 'https://feelreef.com';
  let oldHostPage;
  for (const sw of [{}, ON]) {
    for (const origin of ['https://reef.cards', 'https://card.feelreef.com']) {
      const { env, touched } = untouchableEnv();
      const res = await worker.fetch(new Request(`${origin}/edit?host=${encodeURIComponent(host)}&lang=ja`), { ...env, ...sw });
      if (origin === 'https://reef.cards' && !sw.CARD_CANONICAL_HOST) {
        assert.equal(res.status, 404, 'reef.cards stays dark until cutover');
        assert.deepEqual(touched, []);
        continue;
      }
      assert.equal(res.status, 200, `${origin} ${JSON.stringify(sw)}`);
      assert.equal(res.headers.get('content-security-policy'), `frame-ancestors ${host}`);
      assert.equal(res.headers.get('location'), null);
      const body = await res.text();
      assert.deepEqual(optsOf(body), { host, sandbox: false, locale: 'ja', tableBase: '/try/edit/t/ja/' });
      assert.deepEqual(touched, []);
      if (origin === 'https://card.feelreef.com') oldHostPage ??= body;
      assert.equal(body, oldHostPage, 'the page does not depend on host or switch position');
    }
  }
  // the table it loads is same-origin (`'self'`), so it moves with the page; the parent is named
  const t = await worker.fetch(new Request('https://reef.cards/try/edit/t/ja/'), { ...untouchableEnv().env, ...ON });
  assert.equal(t.status, 200);
  assert.match(t.headers.get('content-security-policy'), /^frame-ancestors 'self' https:\/\/feelreef\.com /);
});

// ── reef#2725 r3: what a link preview names follows the switch ──────────────────────────────────
// og:url and <link rel=canonical> (card-share.mjs) used to be the REQUEST's host. So a card served on
// the SaaS fallback or a workers.dev URL claimed that (saas stands for both below: the address does not
// depend on the host). The address a preview names is the card's
// canonical one — cardUrlFor(handle, {}, env), the same inverse the editor reads — whatever host
// answered. A vanity card's address is its own domain, in both positions (card-share.test.mjs).
const shareOf = (html) => ({
  canonical: /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1],
  ogUrl: /<meta property="og:url" content="([^"]*)">/.exec(html)?.[1],
});
test('reef#2725 r3 ①: og:url and canonical name the configured card host, whatever host served the page', async () => {
  const cases = [
    // [switch, request URL, the address the preview must name]
    [{}, 'https://card.feelreef.com/t', 'https://card.feelreef.com/t'],
    // tile-lab#51: the root card is the bare origin of the old host too
    [{}, 'https://card.feelreef.com/', 'https://card.feelreef.com'],
    [{}, 'https://saas.feelreef.com/t', 'https://card.feelreef.com/t'],
    [ON, 'https://reef.cards/t', 'https://reef.cards/t'],
    [ON, 'https://reef.cards/', 'https://reef.cards'],
    [ON, 'https://saas.feelreef.com/t', 'https://reef.cards/t'],
  ];
  for (const [sw, req, want] of cases) {
    const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD, feelreef: ROOT_CARD }), ...sw };
    const res = await worker.fetch(new Request(req), env);
    assert.equal(res.status, 200, req);
    assert.deepEqual(shareOf(await res.text()), { canonical: want, ogUrl: want }, `${req} ${JSON.stringify(sw)}`);
  }
});

// PIN: the switch unset (or any value but reef.cards) on the old host is the page today's Worker
// sent — the same bytes renderCardHTML gives for the request-derived cardUrl it was always handed.
test('reef#2725 r3 ②: switch unset, card.feelreef.com serves today\'s page byte for byte', async () => {
  const today = renderCardHTML(SERVING_CARD, { handle: 't', cardUrl: 'https://card.feelreef.com/t', videos: {} });
  for (const sw of [{}, { CARD_CANONICAL_HOST: '' }, { CARD_CANONICAL_HOST: 'card.feelreef.com' }, { CARD_CANONICAL_HOST: 'reef.card' }]) {
    const env = { PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD }), ...sw };
    const res = await worker.fetch(new Request('https://card.feelreef.com/t'), env);
    assert.equal(await res.text(), today, JSON.stringify(sw));
  }
});

// ── tile-lab#51 ②: "no card here" is a Card, and it is ONE page ────────────────────────────────────
//
// The product owner 2026-10-30: 「退役（`stop:` 標記）與不存在的公開頁一字不差，退役的人要的是消失」. The
// comparison is the same handle in two stores — retired, and never there — on every exit a visitor
// or a crawler can reach, headers included. A retired Card that also has its own domain is in the
// retired store: the old 301 to that domain would have named the binding.
const NO_CARD = /<div class="st-card">[\s\S]*<p>There's no card here\.<\/p>[\s\S]*href="https:\/\/feelreef\.com\/"/;
const STOP = JSON.stringify({ stopped_at: '2026-01-01T00:00:00.000Z', reason: 'Review requested' });
// tile-lab#51 r2: a DELETED Card (reef#2618) as deleteCard leaves the store — the lifetime rotated
// (`gen:`), a body and a domain binding stranded under the ended generation (a delete that died
// before its sweep), and the content-free `gone:` marker the registration flow still writes and clears.
const DEAD_GEN = 'a'.repeat(24), NOW_GEN = 'b'.repeat(24);
const DELETED = () => ({
  [`card:t:${DEAD_GEN}`]: SERVING_CARD, [`vanityof:t:${DEAD_GEN}`]: 'card.example', 'gen:t': NOW_GEN,
  'gone:t': JSON.stringify({ deleted_at: '2026-01-01T00:00:00.000Z' }),
});

test('tile-lab#51 ②: a retired Card, a deleted Card and a never-existed handle answer byte for byte the same, on every exit', async () => {
  for (const [sw, host] of [[{}, 'card.feelreef.com'], [{}, 'saas.feelreef.com'], [ON, 'reef.cards']]) {
    const requests = [...servingRequests(host, 't'), [`https://${host}/t/avatar`, {}], [`https://${host}/t/nothing`, {}],
      [`https://${host}/T/`, {}], [`https://${host}/t?utm_source=qr`, {}]];
    for (const [url, init] of requests) {
      const retired = { PREVIEW: 'false', ...sw, CARDS: recordingStore({ t: SERVING_CARD, 'stop:t': STOP, 'vanityof:t': 'card.example' }) };
      const deleted = { PREVIEW: 'false', ...sw, CARDS: recordingStore(DELETED()) };
      const never = { PREVIEW: 'false', ...sw, CARDS: recordingStore() };
      const a = await responseBytes(await worker.fetch(new Request(url, init), retired));
      const d = await responseBytes(await worker.fetch(new Request(url, init), deleted));
      const b = await responseBytes(await worker.fetch(new Request(url, init), never));
      assert.equal(b.status, 404, url);
      assert.deepEqual(a, b, `${url}: a retired Card is distinguishable from a handle that never existed`);
      assert.deepEqual(d, b, `${url}: a deleted Card is distinguishable from a handle that never existed`);
      for (const r of [a, d]) assert.doesNotMatch(r.body.toString(), /unavailable|deleted|Gone|Test Card|A public bio|Review requested/i, url);
    }
  }
});

test('Refs #218: custom-domain absent states share the small 404 on every card exit', async () => {
  for (const [url, init] of [...servingRequests('card.example', 't', true),
    ['https://card.example/', {}], ['https://card.example/avatar', {}], ['https://card.example/nothing', {}]]) {
    const missing = await responseBytes(await worker.fetch(new Request(url, init), { PREVIEW: 'false', CARDS: recordingStore() }));
    assert.equal(missing.status, 404, url);
    assert.equal(Object.fromEntries(missing.headers)['x-robots-tag'], 'noindex, nofollow', url);
    for (const seed of [
      { t: SERVING_CARD, 'stop:t': STOP, 'vanity:card.example': 't', 'vanityof:t': 'card.example' },
      { ...DELETED(), 'vanity:card.example': 't' },
      { 'vanity:card.example': 't', 'vanityof:t': 'card.example' },
    ]) {
      const absent = await responseBytes(await worker.fetch(new Request(url, init), { PREVIEW: 'false', CARDS: recordingStore(seed) }));
      assert.deepEqual(absent, missing, `${url}: custom-domain absence reveals the binding`);
    }
  }
});

test('Refs #218: an inverse binding without a card body cannot redirect an absent handle', async () => {
  for (const [sw, host] of [[{}, 'card.feelreef.com'], [{}, 'saas.feelreef.com'], [ON, 'reef.cards']]) {
    for (const [url, init] of servingRequests(host, 't')) {
      const env = { PREVIEW: 'false', ...sw };
      const missing = await responseBytes(await worker.fetch(new Request(url, init), { ...env, CARDS: recordingStore() }));
      const orphan = await responseBytes(await worker.fetch(new Request(url, init), { ...env, CARDS: recordingStore({ 'vanityof:t': 'card.example' }) }));
      assert.deepEqual(orphan, missing, `${url}: inverse binding without a body redirects an absent handle`);
    }
  }
});

test('Refs #218: both root aliases share the absent-state policy', async () => {
  for (const [sw, host] of [[{}, 'card.feelreef.com'], [ON, 'card.feelreef.com'], [{}, 'reef.cards'], [ON, 'reef.cards']]) {
    for (const path of ['/feelreef', '/feelreef/']) {
      const url = `https://${host}${path}?lang=ja`;
      const env = { PREVIEW: 'false', ...sw };
      const missing = await responseBytes(await worker.fetch(new Request(url), { ...env, CARDS: recordingStore() }));
      assert.equal(missing.status, host === 'card.feelreef.com' && sw === ON ? 301 : 404, `${url}: root alias route with switch ${sw === ON ? 'on' : 'off'}`);
      for (const seed of [{ feelreef: ROOT_CARD, 'stop:feelreef': STOP }, { 'gone:feelreef': '{}' }]) {
        const absent = await responseBytes(await worker.fetch(new Request(url), { ...env, CARDS: recordingStore(seed) }));
        assert.deepEqual(absent, missing, `${url}: root alias reveals absent state`);
      }
    }
  }
});

// The table the ticket asks for: existing / retired / deleted / never-existed / reserved × the button.
// 🔴 The button column is "no" in every row, and that is a finding, not an omission: whether a name
// can be registered is RSP's to say (reserved words + the ledger, where a retired name stays its
// owner's), and RSP's own rule is that nobody keeps a second copy of that list. See notFound.
test('tile-lab#51 ②: existing / retired / deleted / never-existed / reserved — the page each gets, and no button', async () => {
  const BUTTON = /signup|register|make a card|create a card|\?handle=/i;
  const rows = [
    // [row, store, path, status]
    ['existing', { t: SERVING_CARD }, '/t', 200],
    ['retired', { t: SERVING_CARD, 'stop:t': STOP }, '/t', 404],
    ['deleted (reef#2618)', DELETED(), '/t', 404],
    ['never-existed', {}, '/t', 404],
    ['never-existed, grammar-valid and unreserved', {}, '/zlingart', 404],
    ['reserved (RSP: try)', {}, '/try', 404],
    ['reserved (RSP: admin)', {}, '/admin', 404],
  ];
  const notFoundBodies = new Set();
  for (const [row, seed, path, status] of rows) {
    const res = await worker.fetch(new Request(`https://card.feelreef.com${path}`), { PREVIEW: 'false', CARDS: recordingStore(seed) });
    const body = await res.text();
    assert.equal(res.status, status, row);
    assert.doesNotMatch(body, BUTTON, `${row}: a registration button`);
    if (status === 404) {
      assert.match(body, NO_CARD, `${row}: not the shaped page`);
      // (a one-letter handle is in every page; the one-page Set below covers it)
      if (path.length > 4) assert.ok(!body.includes(path.slice(1)), `${row}: the page echoes the handle`);
      notFoundBodies.add(body);
    }
  }
  assert.equal(notFoundBodies.size, 1, 'the "no card" rows did not all get the one page');
});

test('tile-lab#51 ②: every other "no card" door is the same shaped page — no bare HTML left', async () => {
  const env = { PREVIEW: 'false', CARDS: recordingStore() };
  for (const url of [
    'https://saas.feelreef.com/',          // a path-routed host with no root card (was "Pick a card")
    'https://card.feelreef.com/',          // the root card itself, not yet saved
    'https://card.feelreef.com/t/nothing', // a sub-path under a handle (was "Nothing here")
  ]) {
    const res = await worker.fetch(new Request(url), env);
    assert.equal(res.status, 404, url);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', url);
    assert.match(await res.text(), NO_CARD, url);
  }
  // CONTROL, by design: a creator's own domain keeps the small 404 (reef#1090) — bound or not
  for (const [url, seed] of [['https://unbound.example/', {}], ['https://card.example/wp-login.php', { t: SERVING_CARD, 'vanity:card.example': 't' }]]) {
    const res = await worker.fetch(new Request(url), { PREVIEW: 'false', CARDS: recordingStore(seed) });
    assert.equal(res.status, 404, url);
    assert.equal(await res.text(), '<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>', url);
  }
});


test('tile#217 P1: stopped own-domain card exits match an unbound host including headers', async () => {
  for (const [url, init] of [...servingRequests('card.example', 't', true), ['https://card.example/t', {}],
    ...['/t/nothing', '/wp-login.php', '/robots.txt'].flatMap((path) =>
      [{}, { method: 'HEAD' }, { headers: { accept: 'text/markdown' } }].map((init) => [`https://card.example${path}`, init]))]) {
    const absent = await responseBytes(await worker.fetch(new Request(url, init), { PREVIEW: 'false', CARDS: recordingStore() }));
    for (const marker of [STOP, '']) {
      const stopped = await responseBytes(await worker.fetch(new Request(url, init), {
        PREVIEW: 'false', CARDS: recordingStore({ t: SERVING_CARD, 'vanity:card.example': 't', 'stop:t': marker }),
      }));
      assert.deepEqual(stopped, absent, `${url}: stopped own-domain response discloses its binding`);
      assert.equal(stopped.body.length, 79, `${url}: own-domain small-404 size pin`);
    }
  }
});

test('tile#217 P2: stopped and missing identities perform the same ordered key reads', async () => {
  for (const [sw, host] of [[{}, 'card.feelreef.com'], [{}, 'saas.feelreef.com'], [ON, 'reef.cards']]) {
    for (const gen of ['0', '7']) {
      for (const [url, init] of [...servingRequests(host, 't'), [`https://${host}/t/avatar`, {}]]) {
        const readsFor = async (stopped) => {
          const seed = { 'gen:t': gen };
          if (stopped) Object.assign(seed, gen === '0'
            ? { t: SERVING_CARD, 'stop:t': STOP, 'vanityof:t': 'card.example', 'gone:t': 'old deletion' }
            : { 'card:t:7': SERVING_CARD, 'stop:t:7': STOP, 'vanityof:t:7': 'card.example', 'gone:t': 'old deletion' });
          const store = recordingStore(seed), reads = [];
          const get = store.get;
          store.get = async (key) => { reads.push(key); return get(key); };
          const response = await worker.fetch(new Request(url, init), { PREVIEW: 'false', ...sw, CARDS: store });
          assert.equal(response.status, 404, `${url}: stop must win over stale gone/domain markers`);
          return reads;
        };
        assert.deepEqual(await readsFor(true), await readsFor(false), `${url} gen=${gen}: stopped/missing lookup schedules differ`);
      }
    }
  }
});
