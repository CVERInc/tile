// Guard: the real-render matrix's expectations are PER-SITE, and both answers are correct.
//   run: node packages/sitetile/real-render/verdicts.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. The matrix itself needs a browser, a renderer install and a few minutes, so its
// rules would otherwise only ever be exercised by the one run nobody repeats. Everything below the
// "Node: verdicts" divider in lib/probe.mjs is pure — facts in, verdicts out — so the rules can be
// driven here with synthetic facts, in the ordinary suite, in milliseconds.
//
// 🔴 The rule that is easy to get backwards, and the reason this file leads with it: on a site that
// does NOT declare `dynamic-coral-css: layered`, a theme's selector override MUST NOT reach coral
// markup. That is not a gap waiting to be closed — it is what every site built before the
// declaration existed looks like, and those sites are never rewritten. So the undeclared reading is
// asserted as a locked negative control: if a change ever makes a theme selector reach coral markup
// on an undeclared site, this goes red, and it is supposed to.
import assert from 'node:assert/strict';
import { verdicts, flattenFacts, modeDelta, modeDeltaVerdict, rgbOf } from './lib/probe.mjs';
import { HEADING_OVERRIDE, THEME_TOKENS, ARMS, siteLang, expectedLang } from './lib/sites.mjs';
import { STATES } from './lib/states.mjs';
import { matchShopComplete, renderCompletion } from '../../dynamic-corals/square-shop/shop-function-template.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const OVERRIDE_RGB = rgbOf(HEADING_OVERRIDE.value);
const TOKEN_TEXT = rgbOf(THEME_TOKENS.custom.text);
const FONT = THEME_TOKENS.custom.font;
const TOKENS = {
  btnFill: rgbOf(THEME_TOKENS.custom.accent), ink: rgbOf(THEME_TOKENS.custom.accentInk), btnRadius: '6px', radius: '6px',
  border: rgbOf(THEME_TOKENS.custom.border), accent: rgbOf(THEME_TOKENS.custom.accent), muted: rgbOf(THEME_TOKENS.custom.muted),
  text: TOKEN_TEXT, font: FONT,
};

// A minimal, PASSING page: every shared check (shell, lang, inset, overflow) is satisfied, so a
// test only has to say what it is actually about.
function facts(over = {}) {
  return {
    htmlLang: 'zh-Hant',
    coralCssStamp: '',
    bodyThemeCustom: true,
    viewport: { width: 1280, scrollWidth: 1280 },
    shell: { header: true, nav: true, footer: true, mainCount: 1 },
    body: { fontFamily: FONT, fontSize: '16px', color: TOKEN_TEXT },
    tokens: TOKENS,
    refs: { h1: { fontFamily: FONT, color: OVERRIDE_RGB, fontSize: '32px', fontWeight: '700' } },
    root: { tag: 'div', classes: 'dc-pp-wrap' },
    inset: { measured: 'heading', contentLeft: 100, contentRight: 1180, maxWidth: 'none', display: 'block' },
    heading: { tag: 'h1', classes: 'dc-pp-title', fontFamily: FONT, color: TOKEN_TEXT, fontSize: '26px', fontWeight: '800', text: 'Box kite' },
    media: [], actions: [], inputs: [], status: [],
    ...over,
  };
}
const CORAL_DETAIL = { id: 'provider-detail', coral: true, root: '.dc-pp-wrap', heading: '.dc-pp-title' };
const PROSE = { id: 'membership-empty', root: '[data-ejecta-membership]', heading: '[data-ejecta-membership] h1' };

function judge({ spec = CORAL_DETAIL, theme = 'custom', declared = false, over = {} } = {}) {
  const f = facts({ coralCssStamp: declared ? 'layered' : '', ...over });
  const v = verdicts({ spec, theme, declared, vp: 'desktop', facts: f, expectedLang: 'zh-Hant',
    themeTokens: undefined, headingOverride: theme === 'custom' ? HEADING_OVERRIDE : null });
  return { v, by: Object.fromEntries(v.checks.map((c) => [c.id, c])) };
}

// ── the coral heading: one element, two correct answers ─────────────────────────────────────────
test('undeclared site: the coral heading follows --gd-text and the theme\'s h1 override does NOT reach it', () => {
  const { by } = judge();
  assert.equal(by['coral-heading:undeclared-keeps-token-colour'].result, 'PASS');
  assert.equal('heading' in by, false, 'the plain heading-vs-reference rule must not also run');
});

test('undeclared site: a theme override that DID reach coral markup is a failure, not an improvement', () => {
  const { by } = judge({ over: { heading: { ...facts().heading, color: OVERRIDE_RGB } } });
  const c = by['coral-heading:undeclared-keeps-token-colour'];
  assert.equal(c.result, 'FAIL');
  assert.match(c.detail, /reached an undeclared site/);
});

test('declared site: the same heading must match the build-time reference — the override reaches', () => {
  const { by } = judge({ declared: true, over: { heading: { ...facts().heading, color: OVERRIDE_RGB } } });
  assert.equal(by['coral-heading:declared-follows-theme'].result, 'PASS');
});

test('declared site: a coral heading still pinned to --gd-text means the declaration did not take', () => {
  const { by } = judge({ declared: true });
  assert.equal(by['coral-heading:declared-follows-theme'].result, 'FAIL');
});

test('a non-coral heading keeps the original rule and the original id, in both modes', () => {
  for (const declared of [false, true]) {
    const { by } = judge({ spec: PROSE, declared, over: { heading: { ...facts().heading, color: OVERRIDE_RGB } } });
    assert.equal(by.heading.result, 'PASS');
    assert.equal('coral-heading:undeclared-keeps-token-colour' in by, false);
  }
});

// ── the fixture cannot lie about which mode it built in ─────────────────────────────────────────
test('a declared arm whose document root carries no stamp fails as a fixture, not as a finding', () => {
  const { by } = judge({ declared: true, over: { coralCssStamp: '' } });
  assert.equal(by['coral-css-mode'].result, 'FAIL');
});
test('an undeclared arm that somehow stamped `layered` fails too', () => {
  const { by } = judge({ over: { coralCssStamp: 'layered' } });
  assert.equal(by['coral-css-mode'].result, 'FAIL');
});

// ── injected-layer cascade control (the token-theme arms) ───────────────────────────────────────
const cascade = (withTheme) => ({
  action: { element: 'button.dc-pp-add', property: 'border-top-left-radius', value: '5px', base: '999px', withPre: '999px', withTheme, after: '999px' },
  container: { element: 'section.st-embed', property: 'max-width', value: '555px', base: 'none', withPre: 'none', withTheme: '555px', after: 'none' },
});

test('undeclared site: an injected reef.theme rule must LOSE to unlayered coral CSS', () => {
  const { by } = judge({ theme: 'tokens', over: { cascade: cascade('999px') } });
  assert.equal(by['cascade:action:undeclared-coral-css-outranks-theme'].result, 'PASS');
  assert.equal(by['cascade:action:pre-layer-loses'].result, 'PASS');
});

test('undeclared site: an injected reef.theme rule that WON over coral CSS is the regression', () => {
  const { by } = judge({ theme: 'tokens', over: { cascade: cascade('5px') } });
  assert.equal(by['cascade:action:undeclared-coral-css-outranks-theme'].result, 'FAIL');
});

test('declared site: the same injected reef.theme rule must win', () => {
  const { by } = judge({ theme: 'tokens', declared: true, over: { cascade: cascade('5px') } });
  assert.equal(by['cascade:action:reef.theme-wins'].result, 'PASS');
  const { by: lost } = judge({ theme: 'tokens', declared: true, over: { cascade: cascade('999px') } });
  assert.equal(lost['cascade:action:reef.theme-wins'].result, 'FAIL');
});

test('the container cascade target is renderer markup, so a coral state leaves it NA in both modes', () => {
  for (const declared of [false, true]) {
    const { by } = judge({ theme: 'tokens', declared, over: { cascade: cascade(declared ? '5px' : '999px') } });
    assert.equal(by['cascade:container'].result, 'NA');
  }
});

// ── build-time theme selector overrides (the custom-theme arms) ─────────────────────────────────
const overrideFacts = ({ withTheme, afterRemoval, matches = true }) => ([
  { id: 'action-radius', selector: 'button, .st-runtime-action', property: 'border-radius', expect: '3px', probeTarget: 'action',
    elementFound: true, themeRulesFound: 1, items: [{ element: 'button.dc-pp-add', matchesSelector: matches, withTheme, afterRemoval }] },
  { id: 'container-max-width', selector: '.st-runtime', property: 'max-width', expect: '777px', probeTarget: 'container',
    elementFound: false, themeRulesFound: 1, items: [] },
]);

test('undeclared site: the theme rule matches the coral button as a selector and still must not win', () => {
  const { by } = judge({ over: { themeOverrides: overrideFacts({ withTheme: '999px', afterRemoval: '999px' }) } });
  assert.equal(by['reef.theme-selector:action-radius:undeclared-does-not-reach'].result, 'PASS');
});

test('undeclared site: a theme rule that reached the coral button fails the negative control', () => {
  const { by } = judge({ over: { themeOverrides: overrideFacts({ withTheme: '3px', afterRemoval: '999px' }) } });
  const c = by['reef.theme-selector:action-radius:undeclared-does-not-reach'];
  assert.equal(c.result, 'FAIL');
  assert.match(c.detail, /override reached an undeclared site/);
});

test('undeclared site: a theme rule that does not even MATCH the element proves nothing and fails', () => {
  const { by } = judge({ over: { themeOverrides: overrideFacts({ withTheme: '999px', afterRemoval: '999px', matches: false }) } });
  assert.equal(by['reef.theme-selector:action-radius:undeclared-does-not-reach'].result, 'FAIL');
});

test('declared site: the theme rule wins on coral markup and reverts to the coral\'s own value', () => {
  const { by } = judge({ declared: true, over: { themeOverrides: overrideFacts({ withTheme: '3px', afterRemoval: '999px' }) } });
  assert.equal(by['reef.theme-selector:action-radius:declared-reaches-coral-markup'].result, 'PASS');
});

test('declared site: a theme rule that still loses on coral markup is the declaration not working', () => {
  const { by } = judge({ declared: true, over: { themeOverrides: overrideFacts({ withTheme: '999px', afterRemoval: '999px' }) } });
  assert.equal(by['reef.theme-selector:action-radius:declared-reaches-coral-markup'].result, 'FAIL');
});

test('the container override probe is renderer markup, so a coral state leaves it NA rather than failing for a missing .st-runtime', () => {
  const { by } = judge({ over: { themeOverrides: overrideFacts({ withTheme: '999px', afterRemoval: '999px' }) } });
  assert.equal(by['reef.theme-selector:container-max-width'].result, 'NA');
});

// ── the pair comparison ─────────────────────────────────────────────────────────────────────────
test('flattenFacts drops the harness\'s own instrumentation, so it cannot manufacture a delta', () => {
  const keys = [...flattenFacts(facts({ focus: { target: 'x' }, cascade: cascade('5px'), themeOverrides: [], consoleErrors: ['boom'] })).keys()];
  for (const k of keys) assert.ok(!/^(focus|cascade|themeOverrides|consoleErrors)\b/.test(k), `leaked ${k}`);
  assert.ok(keys.includes('heading.color'));
});

test('an identical pair has no delta, and the stamp that differs BY DESIGN is not counted as one', () => {
  assert.deepEqual(modeDelta(facts(), facts({ coralCssStamp: 'layered' })), []);
});

test('a moved computed value shows up as one delta, with both readings', () => {
  const d = modeDelta(facts(), facts({ coralCssStamp: 'layered', heading: { ...facts().heading, color: OVERRIDE_RGB } }));
  assert.deepEqual(d, [{ path: 'heading.color', legacy: TOKEN_TEXT, declared: OVERRIDE_RGB }]);
});

test('a non-coral state must measure identically in both modes — any delta at all is the finding', () => {
  const v = modeDeltaVerdict({ coral: false, overrides: true, deltas: [{ path: 'heading.color', legacy: 'a', declared: 'b' }] });
  assert.equal(v.result, 'FAIL');
  assert.match(v.detail, /paints no coral package CSS/);
});

test('on coral markup an intended override delta passes, and anything else does not', () => {
  const ok = modeDeltaVerdict({ coral: true, overrides: true, deltas: [{ path: 'actions[0].borderTopLeftRadius', legacy: '999px', declared: '3px' }] });
  assert.equal(ok.result, 'PASS');
  const bad = modeDeltaVerdict({ coral: true, overrides: true, deltas: [{ path: 'cards.items[0].boxShadow', legacy: 'none', declared: '0 6px 18px' }] });
  assert.equal(bad.result, 'FAIL');
});

test('the no-regression arm: a theme with no selector overrides must move NOTHING, even on coral markup', () => {
  const v = modeDeltaVerdict({ coral: true, overrides: false, deltas: [{ path: 'actions[0].borderTopLeftRadius', legacy: '999px', declared: '3px' }] });
  assert.equal(v.result, 'FAIL');
  assert.equal(modeDeltaVerdict({ coral: true, overrides: false, deltas: [] }).result, 'PASS');
});

// ── the language each state's page must declare ──────────────────────────────────────────────
// 🩸 The matrix expected the SITE's language on every state until 2026-10-31, and the one state
// whose path names a locale (/zh-tw/shop/complete) went red on the three en-US arms the day the
// completion page started declaring the language of its copy (square-shop 0e68a34). The page was
// right; the expectation was a sync claim nothing checked. So the expectation is now checked
// against the Worker's own completion renderer, with each arm's real declared language on the
// donor shell, in the ordinary suite — the next change to either side shows up here, not only in
// the browser matrix nobody runs by default.
const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);
const htmlLangOf = (html) => (html.match(/<html\b[^>]*\blang="([^"]*)"/i) || [])[1];
for (const st of STATES.filter((x) => x.family === 'shop completion')) {
  for (const arm of ARMS) {
    atest(`${st.id} on ${arm}: the matrix expects the <html lang> the Worker's completion page declares`, async () => {
      const u = new URL(st.path, 'https://shop.example.test');
      const shell = `<!doctype html><html lang="${siteLang(arm)}"><head><title>Shop</title></head><body><header>N</header><main>G</main><footer>F</footer></body></html>`;
      const env = { ASSETS: { fetch: async (r) => (new URL(r.url).pathname === '/shop/' ? new Response(shell) : new Response('nf', { status: 404 })) } };
      const shop = matchShopComplete(u.pathname, [{ shopPath: '/shop', source: 'native' }]);
      assert.ok(shop, `${st.path} matches a completion route`);
      const html = await (await renderCompletion(new Request(u.href), env, { siteId: 'site-key' }, shop)).text();
      assert.equal(expectedLang(arm, st), htmlLangOf(html));
    });
  }
}
atest('CONTROL: the locale-path state really does expect something other than the site language on an en-US arm', async () => {
  const st = STATES.find((x) => x.id === 'shop-complete-locale-paid');
  assert.equal(siteLang('plain'), 'en-US');
  assert.equal(expectedLang('plain', st), 'zh-TW');
  assert.equal(expectedLang('custom', st), 'zh-Hant', 'a shell already declaring the same language keeps its spelling');
  assert.equal(expectedLang('plain', STATES.find((x) => x.id === 'shop-complete-paid')), 'en-US');
});
for (const [name, fn] of asyncTests) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

console.log(`\nreal-render verdicts: ${passed} passed`);
