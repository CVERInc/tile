// The legibility arithmetic, and what the renderer is allowed to do with it.
//
// 🩸 SOME GOLDENS BELOW MOVED ON 2026-08-12, AND NOT BY DRIFT. The RAMP's "neutral base" column was
// not neutral: every base carried a 250-320 degree purple cast, and the ONE accent that produced
// zero hue drift against it was one creator's — because the ramp had been tuned on their card. Every
// other creator's ground was pulled 13-40 degrees away from their own accent. The bases are true
// greys now, at the SAME lightness (lightness is the skeleton, hue is only the flavour), so hue
// comes from the accent alone — which is what the mix percentage always claimed.
//
// Re-derived, not re-baselined-away: 3.45 to 3.37, backdropDimDefault(#0556ff) 62 to 63, scrimFloor
// 89 to 90, and the dark ground base neutralised. What did NOT move is the part that was never ours
// to move — contrast(#000,#fff) is still 21.00, and backdropDimDefault('#31bbbb') is still 62,
// because that accent's drift was never the purple's doing. Anyone updating a golden here owes the
// same check: recompute it, and name the external fact that still pins the test around it.
//   run: node colour.test.mjs
//
// Every gate here is paired with a CONTROL that must fail — a floor you have never watched reject
// something is a floor you only know is quiet. `scrimFloor` returning a big number would look
// identical to `scrimFloor` returning the right number; the control is the assertion that one step
// BELOW the floor genuinely breaks.
import assert from 'node:assert/strict';
import {
  parseColour, toHex, luminance, contrast, mix, composite, inkFor, isDarkGround,
  scrimFloor, readableAccent, groundFrom, inkFrom, backdropDimDefault, resolveBackdropDim,
  palette, tokens, themeCss, BODY_FLOOR, LARGE_FLOOR, DEFAULT_ACCENT,
} from './colour.mjs';
import { renderPage } from './card-render.mjs';
import { parseCard } from './card-core.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const P = parseColour;
const ACCENT_BLUE = '#0556ff';

// ── the arithmetic ────────────────────────────────────────────────────────────────────────────
test('parses #rgb, #rrggbb and rgb(), and refuses anything else', () => {
  assert.deepEqual(P('#fff'), [255, 255, 255]);
  assert.deepEqual(P('#0556FF'), [5, 86, 255]);
  assert.deepEqual(P('rgb(5, 86, 255)'), [5, 86, 255]);
  assert.equal(P('cornflowerblue'), null, 'named colours are not claimed to be understood');
  assert.equal(P(''), null);
  assert.equal(P(undefined), null);
});

test('contrast matches the WCAG anchors', () => {
  assert.equal(contrast(P('#000'), P('#fff')).toFixed(2), '21.00');
  assert.equal(contrast(P('#fff'), P('#fff')).toFixed(2), '1.00');
  // the number that started all of this: one card's accent on its own ground
  assert.equal(contrast(P(ACCENT_BLUE), groundFrom(ACCENT_BLUE)).toFixed(2), '3.37');
});

test('luminance is monotonic and mix is the color-mix ramp', () => {
  assert.ok(luminance(P('#fff')) > luminance(P('#808080')));
  assert.ok(luminance(P('#808080')) > luminance(P('#000')));
  assert.deepEqual(mix(P('#fff'), P('#000'), 100).map(Math.round), [255, 255, 255]);
  assert.deepEqual(mix(P('#fff'), P('#000'), 0).map(Math.round), [0, 0, 0]);
  assert.deepEqual(mix(P('#fff'), P('#000'), 50).map(Math.round), [128, 128, 128]);
});

// ── ink direction is DERIVED, never assumed ───────────────────────────────────────────────────
test('ink flips with the ground, in both directions', () => {
  assert.deepEqual(inkFor(P('#0c0c0c')), [255, 255, 255], 'dark ground wants light ink');
  assert.deepEqual(inkFor(P('#fffaf0')), [17, 17, 17], 'light ground wants dark ink');
  assert.equal(isDarkGround(P('#0c0c0c')), true);
  assert.equal(isDarkGround(P('#fffaf0')), false, 'CONTROL: a light ground must NOT read as dark');
});

test('readableAccent moves the right way on each ground — the old bug, both sides', () => {
  const dark = groundFrom(ACCENT_BLUE);
  const onDark = readableAccent(P(ACCENT_BLUE), dark);
  assert.ok(contrast(onDark, dark) >= BODY_FLOOR, 'clears the floor on a dark ground');
  assert.ok(luminance(onDark) > luminance(P(ACCENT_BLUE)), 'goes LIGHTER against a dark ground');

  // A deep blue already clears 4.5:1 on a near-white ground, so it proves nothing about direction.
  // The mirror case is a BRIGHT accent on a light ground — the one the old fix cannot serve.
  const light = P('#fffaf0'), yellow = P('#ffd400');
  assert.ok(contrast(yellow, light) < BODY_FLOOR, 'setup: this accent really does fail on this ground');
  const onLight = readableAccent(yellow, light);
  assert.ok(contrast(onLight, light) >= BODY_FLOOR, 'clears the floor on a light ground');
  assert.ok(luminance(onLight) < luminance(yellow), 'goes DARKER against a light ground');
  // 🔴 THE CONTROL. --cp-accent-bright mixed 72% white unconditionally and rescued that card only
  // because her ground happened to be dark. Run the same move here and it makes things worse.
  const oldFix = mix(P('#fff'), yellow, 72);
  assert.ok(contrast(oldFix, light) < contrast(yellow, light),
    'CONTROL: the unconditional 72%-white fix makes a bright accent WORSE on a light ground — '
    + 'which is why the direction has to be derived from the ground');
});

test('an accent that already passes is left completely alone', () => {
  const g = groundFrom('#31bbbb');
  assert.ok(contrast(P('#31bbbb'), g) >= BODY_FLOOR);
  assert.deepEqual(readableAccent(P('#31bbbb'), g), P('#31bbbb'), 'taste is not adjusted when it is not failing');
});

// ── the scrim floor, and proof it is tight ────────────────────────────────────────────────────
test('the scrim floor delivers 4.5:1 against ANY image, and one step below does not', () => {
  for (const accent of [ACCENT_BLUE, '#31bbbb', '#0a8c8e']) {
    const g = groundFrom(accent), ink = inkFrom(accent);
    const floor = scrimFloor(g, ink);
    for (const photo of [[0, 0, 0], [255, 255, 255], [128, 128, 128], [255, 0, 0]]) {
      assert.ok(contrast(composite(g, photo, floor / 100), ink) >= BODY_FLOOR,
        `${accent}: floor ${floor} must hold over ${toHex(photo)}`);
    }
    // 🔴 CONTROL: the floor is the SMALLEST value that works. If this never fires, the "floor"
    // could be 100 and every assertion above would still pass.
    const below = composite(g, [255, 255, 255], (floor - 1) / 100);
    assert.ok(contrast(below, ink) < BODY_FLOOR,
      `${accent}: one below the floor (${floor - 1}) must FAIL over white — otherwise the floor is not tight`);
  }
});

test('the historical default 62 turns out to BE the floor', () => {
  assert.equal(backdropDimDefault(ACCENT_BLUE), 63);
  assert.equal(backdropDimDefault('#31bbbb'), 62);
  // 🔴 Assert the CLAIM, not a snapshot of it. This used to pin the literal 62, so it went red
  // every time DEFAULT_ACCENT moved — red for a reason that had nothing to do with what it is
  // guarding. What it actually promises is a FALLBACK TARGET: no accent behaves as the default
  // accent does, and specifically not as zero would.
  assert.equal(backdropDimDefault(undefined), backdropDimDefault(DEFAULT_ACCENT),
    'no accent falls back to the default accent');
  assert.notEqual(backdropDimDefault(undefined), 0, 'and specifically not to zero — the control');
});

// ── the clamp ─────────────────────────────────────────────────────────────────────────────────
test('an invalid backdrop-dim can never silently delete the scrim', () => {
  const d = backdropDimDefault(ACCENT_BLUE);
  const at = (v) => resolveBackdropDim(v, ACCENT_BLUE);
  assert.equal(at(undefined), d, 'absent → the default');
  // 🩸 THE ONE THAT WAS ACTUALLY LIVE. The card-worker reads frontmatter with a trailing `|| ''`, so
  // a card that never mentions backdrop-dim hands this function an EMPTY STRING, not undefined. And
  // `Number('')` is 0 — finite, in range, straight through both guards — so every backdrop card
  // without an explicit dim shipped with NO scrim at all. `at(undefined)` passed the whole time.
  // 🔴 The absent case must be tested in the SHAPE THE CALLER ACTUALLY SENDS.
  assert.equal(at(''), d, "the frontmatter reader's empty string is absence, not zero");
  assert.equal(at('  '), d, 'whitespace too — it is still nothing written');
  // and the control: an author who deliberately writes 0 still gets 0
  assert.equal(at('0'), 0, 'a written zero is a choice and survives');
  assert.equal(at(0), 0, 'including as a number');
  assert.equal(at(null), d);
  assert.equal(at('48%'), d, '🔴 the unit slip that used to yield NaN → a dropped declaration');
  assert.equal(at('nope'), d);
  assert.equal(at(NaN), d);
  assert.equal(at(140), 100, 'clamped to a real percentage');
  assert.equal(at(-20), 0);
  // 🔴 CONTROL — the thing a floor WOULD have broken. A number the author wrote is theirs: the
  // scrim decides how much of their painting shows, and nothing legibility-critical floats on it.
  // A real live card carries 48, and it survives.
  assert.equal(at(48), 48, "CONTROL: an author's own value is not overridden");
  assert.equal(at(0), 0, 'CONTROL: an explicit 0 means what it says');
});

test('the scrim cannot be the legibility mechanism — which is why there is no floor', () => {
  const g = groundFrom(ACCENT_BLUE);
  // body ink would be safe at 62 …
  assert.equal(backdropDimDefault(ACCENT_BLUE), 63);
  // … but body ink never floats: every cell paints an opaque surface. What DOES float is mid-tone,
  // and a photograph can be brighter or darker than a mid-tone colour, so no scrim below 100 works.
  assert.equal(scrimFloor(g, P('#5a9aaa')), 90, 'the footer teal');
  assert.ok(scrimFloor(g, readableAccent(P(ACCENT_BLUE), g)) >= 87, 'a lane label in the accent');
  // 🔴 So a clamp would have been a gate that never fires. The shadow is the mechanism.
});


// ── the whole (mode × accent) space, not the three cards we happen to own ──────────────────────
// 🔴 This is the test the 3.45:1 link needed and did not have. Three cards is a SAMPLE, and a
// sample ruler cannot see "this would fail for somebody else's colour". Every failure listed in
// the comments below was found by this sweep and by nothing else.
const ACCENTS = (() => {
  const out = ['#000000', '#ffffff', '#808080', '#ffff00', '#00ff00', '#ff0000'];
  for (let h = 0; h < 360; h += 10) {
    for (const [s, l] of [[100, 50], [60, 45], [90, 70], [40, 30], [100, 25], [20, 60], [100, 90], [100, 10]]) {
      const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
      const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))))); };
      out.push('#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join(''));
    }
  }
  return out;
})();

// Every (text, background) pair the stylesheet actually creates, with the floor that applies.
// `faint` is the cell ARROW — a graphic, so WCAG's 3:1, not 4.5:1. `surface-hi` is absent on
// purpose: it is declared and never used, and constraining against a background nobody sees would
// push a creator's colour further from their own for nothing.
const PAIRS = [
  ['ink', 'ground', BODY_FLOOR], ['ink', 'surface', BODY_FLOOR], ['ink', 'surface-2', BODY_FLOOR],
  ['accent-bright', 'ground', BODY_FLOOR], ['accent-bright', 'surface', BODY_FLOOR], ['accent-bright', 'surface-2', BODY_FLOOR],
  ['muted', 'ground', BODY_FLOOR], ['muted', 'surface', BODY_FLOOR], ['muted', 'surface-2', BODY_FLOOR],
  ['page-ink', 'ground', BODY_FLOOR],
  ['faint', 'surface', LARGE_FLOOR], ['faint', 'surface-2', LARGE_FLOOR],
];

test(`every text/background pair clears its floor, both modes, ${ACCENTS.length} accents`, () => {
  const worst = {};
  for (const mode of ['dark', 'light']) {
    for (const accent of ACCENTS) {
      const p = palette(mode, accent);
      for (const [fg, bg, floor] of PAIRS) {
        const r = contrast(p[fg], p[bg]);
        const k = `${mode} ${fg} on ${bg}`;
        if (!worst[k] || r < worst[k].r) worst[k] = { r, accent, floor };
        assert.ok(r >= floor, `${k} = ${r.toFixed(2)} (< ${floor}) for accent ${accent}`);
      }
    }
  }
  // CONTROL: the sweep must actually be tight against something, or it is testing a constant.
  const tightest = Math.min(...Object.values(worst).map((w) => w.r / w.floor));
  assert.ok(tightest < 1.25, `CONTROL: nothing came close to its floor (tightest ${tightest.toFixed(2)}×) — the sweep is not probing the edge`);
});

test('a creator whose colour already works is not repainted', () => {
  // 🔴 The cost of a floor is that it moves someone's brand colour. It must move it as little as
  // possible, and not at all when it does not have to.
  let untouched = 0;
  for (const accent of ACCENTS) {
    const p = palette('dark', accent);
    if (toHex(p['accent-bright']) === toHex(p.accent)) untouched++;
  }
  assert.ok(untouched > 0, 'CONTROL: some accents must survive completely untouched');
  assert.ok(untouched < ACCENTS.length, 'CONTROL: and some must be adjusted, or nothing is being enforced');
});

test('the dark ramp still emits the expressions three live cards are wearing', () => {
  const t = tokens('dark', '#0556ff');
  for (const expr of [
    '--cp-ground:color-mix(in srgb,var(--cp-accent) 8%,#0c0c0c)',
    '--cp-surface:color-mix(in srgb,var(--cp-accent) 10%,#161616)',
    '--cp-ink:color-mix(in srgb,var(--cp-accent) 12%,#ffffff)',
  ]) assert.ok(t.includes(expr), `the dark ramp changed: ${expr} is gone`);
});

test('no theme given follows the reader; a theme pins', () => {
  const auto = themeCss(null, '#0556ff');
  assert.ok(auto.includes('color-scheme:light dark'));
  assert.ok(auto.includes('@media(prefers-color-scheme:light)'), 'the reader decides');
  assert.ok(auto.indexOf('#0c0c0c') < auto.indexOf('prefers-color-scheme'),
    'dark is the fallback, so a browser reporting nothing sees exactly what it saw before');

  const pinned = themeCss('light', '#0556ff');
  assert.ok(!pinned.includes('prefers-color-scheme'), 'a stated ground is stated');
  assert.ok(pinned.includes('color-scheme:light'));
});

// ── the rendered page ─────────────────────────────────────────────────────────────────────────
// 🔴 The first lane names itself `grid` and shows no label; only a SECOND lane is titled. A card
// with one lane therefore floats nothing, which is the shape of all three live cards.
const CARD = (lanes) => [
  '---', 'card-page: t', 'title: T', 'accent: ' + ACCENT_BLUE, '---', '',
  ...lanes.flatMap((l) => ['## ' + l, '', '- [ ] %% card: link w=6 %% [Hi](https://example.com)', '']),
].join('\n');

const renderWith = (dim, lanes = ['grid']) => renderPage(parseCard(CARD(lanes)), {
  name: 'T', accent: ACCENT_BLUE, backdrop: 'https://example.com/bg.jpg', backdropDim: dim,
});

test('no NaN, no empty percentage, ever reaches the stylesheet', () => {
  for (const lane of [['grid'], ['grid', 'Shop']]) {
    for (const dim of [undefined, null, 0, 48, '48%', 'nope', NaN, 90, 140]) {
      const tag = `${lane.join('+')}/${String(dim)}`;
      const html = renderWith(dim, lane);
      assert.ok(html.includes('.st-backdrop'), `${tag}: the backdrop must still render`);
      assert.ok(!/NaN/.test(html), `${tag}: NaN reached the CSS`);
      assert.ok(!/--cp-ground,#[0-9a-f]+\)\s+%/.test(html), `${tag}: empty percentage`);
      const pct = [...html.matchAll(/--cp-ground,#[0-9a-f]+\)\s+([\d.]+)%/g)].map((m) => Number(m[1]));
      assert.ok(pct.length >= 2, `${tag}: both scrim stops must be present`);
      assert.ok(pct.every((p) => p >= 0 && p <= 100), `${tag}: a stop is not a real percentage (${pct})`);
      // An explicit 0 is allowed when nothing floats — the author meant it, and it costs no reader
      // anything. What must never happen is a value the author did NOT write producing no scrim.
      if (dim == null || !Number.isFinite(Number(dim))) {
        assert.ok(pct[0] >= backdropDimDefault(ACCENT_BLUE),
          `${tag}: an absent or unparseable value must fall back to the default, got ${pct[0]}`);
      }
    }
  }
});

test('a labelled lane floats text, and the author\'s dim survives it', () => {
  const stops = (html) => [...html.matchAll(/--cp-ground,#[0-9a-f]+\)\s+([\d.]+)%/g)].map((m) => Number(m[1]));

  const labelled = renderWith(10, ['grid', 'Shop']);
  assert.ok(labelled.includes('class="st-grid-label"'), 'a second, named lane emits a floating label');
  assert.ok(/\.st-grid-label\{text-shadow:/.test(labelled), 'and it is carried by a shadow');
  assert.equal(stops(labelled)[0], 10, "the author's 10 is not overridden — the scrim is not what makes it readable");

  // 🔴 CONTROL, and it has already fired once. The renderer briefly probed for the bare class NAME
  // to decide whether text floats; NATIVE_CSS declares that rule inside the body, so the probe was
  // reading the stylesheet and calling every card "floating". This is the assertion that caught it.
  const bare = renderWith(10, ['grid']);
  assert.ok(!bare.includes('class="st-grid-label"'), 'CONTROL: a single lane emits no label');
  assert.ok(bare.includes('st-grid-label{'), 'CONTROL: …while the CSS RULE is present on both — the difference the probe missed');
});

test('floating text over a photograph carries its own shadow', () => {
  // mid-lightness colours have NO safe scrim opacity below 100, so they cannot be the scrim's job
  const g = groundFrom(ACCENT_BLUE);
  assert.equal(scrimFloor(g, P('#5a9aaa')), 90, 'the footer teal needs 90 — proof the global scrim cannot carry it');
  const withBackdrop = renderWith(70);
  assert.ok(/\.st-grid-label\{text-shadow:/.test(withBackdrop), 'a lane label gets a local shadow');
  // 🔴 REVERSED 2026-07-30. This required the footer to get a ground-coloured PLATE. chodaict asked
  // for the backgrounds to go — 「st-footer 也是,不要背景色」— and the plate's job is now done without
  // one: THEMED ink (`--cp-ink`, not the page-mist `--cp-page-ink` that measured 2.86:1 on her
  // artwork) plus a `--cp-ground` halo carried by the glyphs themselves. 6.39 dark / 12.96 light.
  //
  // The rule that survives both designs, and the one actually worth asserting: the ink is DERIVED,
  // never forced to a literal. Forced #fff is what scored 1.12:1 in light mode, and I shipped it
  // twice — once as the original bug, once as my "fix" for the veil.
  assert.ok(/\.st-footer,\.st-footer>div\{color:var\(--cp-ink\)!important/.test(withBackdrop),
    'the footer over artwork uses derived ink');
  assert.ok(!/\.st-footer[^{]*\{[^}]*color:\s*#(fff|ffffff)\b/i.test(withBackdrop),
    'and never a forced literal — that is the 1.12:1 mistake');
  assert.ok(!/\.st-footer\{background:linear-gradient\(0deg,var\(--cp-ground/.test(withBackdrop),
    'and carries no plate');
  // CONTROL: a card with no backdrop must not pay for either
  const plain = renderPage(parseCard(CARD(['grid'])), { name: 'T', accent: ACCENT_BLUE });
  assert.ok(!/\.st-grid-label\{text-shadow:/.test(plain), 'CONTROL: no backdrop, no shadow');
});


test('nothing that floats or sits on artwork is left wearing a ground-derived colour', () => {
  const html = renderWith(70, ['grid', 'Shop']);
  // a lane label floats on the page ground → the DERIVED accent, not the raw brand colour (2.17:1)
  assert.ok(html.includes('.st-grid-label{font-weight:700') && /st-grid-label\{[^}]*--cp-accent-bright/.test(html),
    'the lane label must use --cp-accent-bright');
  assert.ok(!/st-grid-label\{[^}]*color:var\(--cp-accent,/.test(html), 'and not the raw accent');
  // card.css carries `.st-footer a{color:var(--cp-accent)!important}` — it has to be beaten
  assert.ok(html.includes('.st-footer a{color:var(--cp-accent-bright,#0a8c8e)!important}'),
    'the footer link needs the !important back, because the rule it corrects has one');
  // text on a picture is not themed: it gets a scrim and fixed light ink
  // 🩸 This used to assert `.st-gal-body{background:linear-gradient(` — the ELEMENT, by source
  // string. The intent (text on a picture must have a dark backing, whatever the photo is) is right;
  // the assertion had picked one of the two elements that were both painting one, and stacking them
  // took the bottom of every tile to ~0.99 opaque. chodaict: 「漸層下手太重,我看到你疊了好幾層」.
  //
  // Now it asserts the INTENT: a scrim exists, it is bottom-heavy where the caption sits, and the
  // caption is NOT painting a second one on top of it.
  // 🔴 the rule carries `position:absolute;inset:0;` before the background — a regex that demanded
  // `{background:` matched nothing and reported a missing scrim that was right there.
  const scrim = /\.st-gal-scrim\{[^}]*background:linear-gradient\(to top,[^}]*\}/.exec(html);
  assert.ok(scrim, 'the caption band needs a scrim behind it');
  const firstStop = /,\s*rgba\([^)]*,\s*\.?(\d*\.?\d+)\)\s*\d+%/.exec(scrim[0]);
  assert.ok(firstStop && Number(firstStop[1]) >= 0.85,
    `the scrim must be near-opaque where the caption sits (got ${firstStop && firstStop[1]})`);
  assert.ok(/\.st-gal-body\{background:none/.test(html),
    'the caption must not paint a SECOND gradient over the scrim');
  // 🔴 property ORDER must not decide whether this passes — the rule grew a font-size and the
  // assertion stopped matching a colour that was still right there.
  assert.ok(/st-gal-title\{[^}]*color:#fff/.test(html), 'and fixed light ink, not --cp-ink');
  assert.ok(/st-embed-video-label\{background:linear-gradient/.test(html), 'the video caption too');
});

test('the page edge follows the theme — the scrollbar gutter no text can report', () => {
  for (const mode of [null, 'light', 'dark']) {
    const css = themeCss(mode, '#31bbbb');
    assert.ok(css.includes('background-color:var(--cp-ground)'),
      `mode=${mode}: card.css hard-codes html{background-color:#0a1628}, which shows in the gutter`);
    // 🔴 and the IMAGE, not only the colour. card.css puts a five-stop deep-ocean gradient on the
    // same element — the Python era's REEF palette, unrelated to anyone's accent. It is covered by
    // the body's derived radial everywhere the body reaches, which is exactly why it survived
    // unnoticed; leaving a second, contradictory answer painted underneath is how the same
    // stylesheet's #0a1628 became a black bar in the gutter of every light card.
    assert.ok(/html\{[^}]*background-image:none/.test(css),
      `mode=${mode}: the page still carries card.css's hard-coded blue gradient`);
  }
});

test('a video with no poster degrades to something designed, not a black rectangle', () => {
  const md = ['---', 'card-page: t', 'title: T', 'accent: ' + ACCENT_BLUE, '---', '',
    '## grid', '', '- [ ] %% card: embed kind=video channel=UCabc w=6 %% Latest'].join('\n');
  const html = renderPage(parseCard(md), { name: 'T', accent: ACCENT_BLUE });
  assert.ok(html.includes('st-embed-video-noposter'), 'setup: a channel embed with no poster');

  // 🔴 The rule for this state already existed and had NEVER fired: it was declared one line above
  // `.st-embed-video-btn{background:#000}` at the same specificity, so black won every time. That is
  // why a channel video rendered as a black rectangle. The fix is the two-class selector, which
  // outranks the button instead of depending on source order.
  const i = html.indexOf('.st-embed-video-btn.st-embed-video-noposter{');
  assert.ok(i > 0, 'the placeholder must be scoped by TWO classes, not one');
  assert.ok(html.includes('var(--cp-surface'), 'and painted in the card\'s own surface');
  assert.ok(/st-embed-video-noposter \.st-embed-video-label\{background:none/.test(html),
    "the label's photo scrim is a smudge when there is no photo");

  // CONTROL: the single-class rule that lost — if it comes back, this fires.
  const single = /(^|\})\.st-embed-video-noposter\{/.test(html);
  assert.ok(!single, 'CONTROL: a bare .st-embed-video-noposter rule cannot outrank .st-embed-video-btn');
});

test('prose carries no frame — 不能按的不准長得像按鈕', () => {
  const md = ['---', 'card-page: t', 'title: T', 'accent: ' + ACCENT_BLUE, '---', '',
    '## grid', '',
    '- [ ] %% card: link w=6 %% [Press me](https://example.com)', '',
    '- [ ] %% card: text w=6 %% Just some words.'].join('\n');
  const html = renderPage(parseCard(md), { name: 'T', accent: ACCENT_BLUE });
  assert.ok(html.includes('class="st-cell st-prose"'), 'setup: a prose cell renders');
  assert.ok(/\.st-card \.st-cell\.st-prose\{background:none;border:none/.test(html),
    'a paragraph must not wear a link\'s surface, border and radius');
  // 🔴 CONTROL, and it is the whole point of the rule being two-directional: the pressable thing
  // must keep its frame. If this ever passes vacuously the rule has become "nothing has a frame".
  assert.ok(html.includes('st-cell-tile'), 'CONTROL: a link cell still exists to be framed');
  assert.ok(!/\.st-card \.st-cell\.st-cell-tile\{background:none/.test(html),
    'CONTROL: and nothing has stripped ITS frame');
});

console.log('\ncolour: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
