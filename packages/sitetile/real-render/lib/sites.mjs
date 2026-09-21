// sites — produce real generated-site shells from this checkout's renderer, without writing into
// the checkout.
//
// The renderer's normal build path (packages/build buildSite → stageSite) stages IR/theme INTO the
// renderer tree (content/, src/themes/, a lock dir). The checkout under test may be shared with
// other work, so this harness never builds there: it copies the checkout (source only) to
// <out>/engine and builds that copy. node_modules is NOT copied (hundreds of MB): <out>/engine's
// renderer gets a REAL node_modules directory whose entries are symlinks to the checkout's
// installed packages. A real directory (rather than one symlink to the whole node_modules) matters:
// Astro/Vite write caches under node_modules/.astro and node_modules/.vite, and those must land in
// the harness copy, not in the checkout's shared install.
//
// Five site arms, all using the renderer's normal theme path (SiteLayout.astro wraps the staged
// theme in `@layer reef.theme { … }`):
//
//   arm              theme treatment                                          dynamic-coral CSS
//   plain            themeless baseline (en-US)                               legacy (undeclared)
//   tokens           a COMPILED token-only theme (compiler header → not       legacy (undeclared)
//                    data-theme-custom; born paint on)
//   custom           a hand-rolled theme (data-theme-custom) with tokens      legacy (undeclared)
//                    AND selector overrides of runtime presentation
//                    properties, declared language zh-Hant
//   tokens-layered   the SAME token-only theme                                declared: layered
//   custom-layered   the SAME hand-rolled theme                               declared: layered
//
// 🔴 The two `*-layered` arms differ from their legacy twin by exactly one line of `_site.md` and
// one emitter flag. Everything else — IR, theme text, contract, fixtures, states — is character for
// character the same, which is what makes a computed-style difference between the pair attributable
// to the declaration and to nothing else. Keep it that way: a fixture that drifts between the twins
// turns the whole mode comparison into a guess.
//
// There is deliberately no `plain-layered`. What a third pair would add over `tokens-layered` is
// "coral CSS in reef.corals meeting site.css with no theme selectors in the way", and the
// token-only theme declares no selectors at all — so its pair already measures exactly that, at
// one renderer build per run instead of two.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARMS = ['plain', 'tokens', 'custom', 'tokens-layered', 'custom-layered'];

/** The site-config key and value a declaring site writes, and the attribute the renderer stamps on
 *  the document root for it. Mirrored from packages/sitetile/astro/src/lib/dynamic-coral-css.mjs
 *  rather than imported, because that module lives inside the copied engine tree the harness
 *  builds, not next to this file — and the harness must be able to state what it EXPECTS
 *  independently of the code under test, or the build sanity check below would only be asking the
 *  implementation whether it agrees with itself. */
export const CORAL_CSS_KEY = 'dynamic-coral-css';
export const CORAL_CSS_LAYERED = 'layered';
export const CORAL_CSS_ATTR = 'data-dynamic-coral-css';

/** The layer-order statement each mode's pages carry, stated here independently of the renderer
 *  for the same reason as the three constants above. Two spellings per mode: the renderer writes
 *  the spaced form and a minifier may strip the spaces, and the sanity check below only asks
 *  whether the page says the right thing, not how it is whitespaced. */
export const LAYER_ORDER_STATEMENTS = {
  legacy: ['@layer reef.base, reef.theme, reef.responsive', '@layer reef.base,reef.theme,reef.responsive'],
  declared: ['@layer reef.base, reef.corals, reef.theme, reef.responsive', '@layer reef.base,reef.corals,reef.theme,reef.responsive'],
};

// Literal token values the theme arms set, so token inheritance can be checked against a known
// literal and not only against a same-page probe. Keyed by THEME, not by arm: a legacy arm and its
// declared twin wear the same theme.
export const THEME_TOKENS = {
  tokens: { accent: '#0b6e4f', accentInk: '#fffbe6', text: '#1d2433', muted: '#55606e', border: '#c9d3cc', radius: '14px', font: 'Georgia, "Times New Roman", serif', bg: '#fbfaf6', surface: '#eef3ef' },
  custom: { accent: '#7b2d26', accentInk: '#fff7e8', text: '#2a2320', muted: '#6d625c', border: '#d8cbbf', radius: '6px', font: '"Palatino Linotype", Palatino, serif', bg: '#fffaf3', surface: '#f4ebe1' },
};

// Selector overrides written into the custom theme (→ @layer reef.theme). Values are chosen so
// they cannot coincide with any renderer default. `probe` names which measured element each one
// is checked against (see probe.mjs). Edit here if the surface vocabulary lands under other names.
export const THEME_SELECTOR_OVERRIDES = [
  // Deliberately LOW specificity (a bare element selector): inside reef.theme it must still beat the
  // renderer's higher-specificity reef.base action rules (e.g. `.st-runtime :where(.dc-native-buy)`,
  // `.st-runtime-action`) — layer order, not specificity, decides. `.st-runtime-action` is listed for
  // <a> actions.
  //
  // 🔴 `button` is also what reaches a dynamic coral's own buttons (`.dc-square-shop-buy`,
  // `.dc-pp-add`) once a site declares the layered mode, and it reaches NOTHING of theirs while the
  // site is undeclared — at (0,0,1) it cannot beat an unlayered class rule at any specificity. That
  // one selector is therefore the whole per-site question, measured on real markup.
  { id: 'action-radius', selector: 'button, .st-runtime-action', property: 'border-radius', value: '3px', computed: 'borderTopLeftRadius', expect: '3px', probe: 'action' },
  { id: 'container-max-width', selector: '.st-runtime', property: 'max-width', value: '777px', computed: 'maxWidth', expect: '777px', probe: 'container' },
];
export const HEADING_OVERRIDE = { selector: 'h1, h2', property: 'color', value: '#3b1f4a' };

function tokenBlock(t) {
  return `html:root {
  --gd-accent: ${t.accent};
  --gd-accent-ink: ${t.accentInk};
  --gd-text: ${t.text};
  --gd-muted: ${t.muted};
  --gd-border: ${t.border};
  --gd-radius: ${t.radius};
  --gd-font: ${t.font};
  --gd-bg: ${t.bg};
  --gd-surface: ${t.surface};
}
`;
}

const SITE = {
  plain: { theme: 'plain', coralCss: '', brand: 'Harness Plain Atelier', lang: 'en-US', coralLocale: 'en-US', themeName: '' },
  tokens: { theme: 'tokens', coralCss: '', brand: 'Harness Token Atelier', lang: 'en-US', coralLocale: 'en-US', themeName: 'harnesstokens' },
  custom: { theme: 'custom', coralCss: '', brand: '測試燈塔工坊', lang: 'zh-Hant', coralLocale: 'zh-TW', themeName: 'harnessharbor' },
  'tokens-layered': { theme: 'tokens', coralCss: CORAL_CSS_LAYERED, brand: 'Harness Token Atelier', lang: 'en-US', coralLocale: 'en-US', themeName: 'harnesstokens' },
  'custom-layered': { theme: 'custom', coralCss: CORAL_CSS_LAYERED, brand: '測試燈塔工坊', lang: 'zh-Hant', coralLocale: 'zh-TW', themeName: 'harnessharbor' },
};

export const siteIdFor = (arm) => `site-${arm}`;
export const siteLang = (arm) => SITE[arm].lang;
/** Which theme treatment this arm wears: 'plain' | 'tokens' | 'custom'. */
export const armTheme = (arm) => SITE[arm].theme;
/** The arm's declaration: '' for a legacy (undeclared) site, 'layered' for a declaring one. */
export const armCoralCss = (arm) => SITE[arm].coralCss;
/** True when this arm's site declares the layered mode. */
export const isDeclared = (arm) => SITE[arm].coralCss === CORAL_CSS_LAYERED;
/** The legacy twin of a declared arm (and itself for a legacy arm) — the pair the mode-delta pass
 *  compares. Returns null when this arm has no twin in the requested set. */
export function legacyTwin(arm) {
  if (!isDeclared(arm)) return arm;
  const theme = armTheme(arm);
  return ARMS.find((a) => !isDeclared(a) && armTheme(a) === theme) || null;
}
export const knownArm = (arm) => Object.prototype.hasOwnProperty.call(SITE, arm);

export function themeCss(arm) {
  const theme = armTheme(arm);
  if (theme === 'tokens') {
    // Compiler header (SiteLayout.astro tests the RAW text for it): a compiled token-only theme.
    return `/* Compiled from ir/_theme.md — harness token-only arm */\n${tokenBlock(THEME_TOKENS.tokens)}`;
  }
  if (theme === 'custom') {
    return `/* harness hand-rolled theme: tokens + runtime-surface selector overrides */
${tokenBlock(THEME_TOKENS.custom)}
${HEADING_OVERRIDE.selector} { ${HEADING_OVERRIDE.property}: ${HEADING_OVERRIDE.value}; }
${THEME_SELECTOR_OVERRIDES.map((o) => `${o.selector} { ${o.property}: ${o.value}; }`).join('\n')}
`;
  }
  return '';
}

function irFor(arm) {
  const s = SITE[arm];
  const fm = (page, title) => `---\nsitetile-page: ${page}\ntitle: ${title}\nlang: ${s.lang}\n---\n`;
  return {
    // 🔴 The declaration is ONE line in the base _site.md and nothing else. It is written last in
    // the frontmatter so a diff of the two twins' IR is exactly this line.
    '_site.md': `---\nbrand: ${s.brand}\nlang: ${s.lang}\n${s.themeName ? `theme: ${s.themeName}\n` : ''}` +
      // /client-shop is deliberately NOT in the nav: it is reached by URL, and a sixth nav item
      // would change the header's own layout on every arm for a page no measurement looks at.
      `nav: Home / | Shop /shop | Provider /provider-shop | Membership /membership | Account /account\n` +
      `footer: Membership /membership | Account /account | Shop /shop\ncopyright: Harness fixture site\n` +
      `${s.coralCss ? `${CORAL_CSS_KEY}: ${s.coralCss}\n` : ''}---\n`,
    'home.md': fm('home', `${s.brand} home`) +
      `\n## A harness site for runtime presentation\n%% sitetile: hero %%\n\nDonor shell for membership, account and subscribe results.\n\n` +
      `## What this page is\n\nA plain prose section so the root page has ordinary build-time content.\n`,
    'shop.md': fm('shop', `${s.brand} shop`) +
      `\n## Shop\n\nNative storefront donor page. The Worker replaces this main content at runtime.\n`,
    'provider-shop.md': fm('provider-shop', `${s.brand} provider shop`) +
      `\n## Provider shop\n\nAuthor intro above the provider coral.\n\n## Catalog\n%% sitetile: embed %%\n` +
      `<div data-dynamic-coral="square-shop" data-site-id="${siteIdFor(arm)}" data-cart="1" data-detail-base="/provider-shop" data-locale="${s.coralLocale}"></div>\n`,
    // The same coral mount on a page the generated Worker does NOT claim as a storefront, so the
    // grid on it is rendered CLIENT-side by the published widget with no server-rendered cards to
    // hydrate from. That is the third emission point the declaration has to reach, and the only one
    // whose CSS is injected by the coral artifact itself rather than written by the Worker.
    'client-shop.md': fm('client-shop', `${s.brand} widget shop`) +
      `\n## Widget shop\n\nThe same coral, mounted client-side.\n\n## Catalog\n%% sitetile: embed %%\n` +
      `<div data-dynamic-coral="square-shop" data-site-id="${siteIdFor(arm)}" data-cart="1" data-detail-base="/provider-shop" data-locale="${s.coralLocale}"></div>\n`,
  };
}

function linkNodeModules(srcNm, dstNm) {
  mkdirSync(dstNm, { recursive: true });
  for (const name of readdirSync(srcNm)) {
    // .astro / .vite caches must be ours, never links into the shared install
    if (name === '.astro' || name === '.vite' || name === '.cache') continue;
    const dst = path.join(dstNm, name);
    if (!existsSync(dst)) symlinkSync(path.join(srcNm, name), dst);
  }
}

export function prepareEngine(tile, out, log, deps = tile) {
  const engine = path.join(out, 'engine');
  const srcNm = path.join(deps, 'packages/sitetile/astro/node_modules');
  if (!existsSync(srcNm)) throw new Error(`renderer dependencies missing: ${srcNm} (run npm ci there first)`);
  // rsync is the copy, so say so before it fails as a spawn error two frames down.
  try { execFileSync('rsync', ['--version'], { stdio: 'ignore' }); }
  catch { throw new Error('rsync not found — this harness copies the checkout with it before building'); }
  mkdirSync(engine, { recursive: true });
  log(`▸ copying tile source → ${engine} (no .git / node_modules / renderer dist*)`);
  execFileSync('rsync', ['-a', '--delete',
    '--exclude', '.git', '--exclude', 'node_modules', '--exclude', '/packages/sitetile/astro/dist*',
    '--exclude', '.tile-build-*', '--exclude', '/packages/sitetile/astro/.astro',
    tile.replace(/\/?$/, '/'), engine + '/'], { stdio: 'inherit' });
  linkNodeModules(srcNm, path.join(engine, 'packages/sitetile/astro/node_modules'));
  return engine;
}

export async function buildSites(engine, out, arms, log) {
  const { buildSite } = await import(pathToFileURL(path.join(engine, 'packages/build/index.mjs')).href);
  // PLATFORM_ORIGIN / SITE_URL are build-wide env; keep them on RFC 2606 names.
  process.env.PLATFORM_ORIGIN = 'https://platform.example.test';
  const built = {};
  for (const arm of arms) {
    const irDir = path.join(out, 'ir', arm);
    rmSync(irDir, { recursive: true, force: true });
    mkdirSync(irDir, { recursive: true });
    for (const [f, body] of Object.entries(irFor(arm))) writeFileSync(path.join(irDir, f), body);
    let themeFile;
    const css = themeCss(arm);
    if (css) {
      mkdirSync(path.join(out, 'themes'), { recursive: true });
      // Per ARM, not per theme: two arms share one theme's TEXT and must not share one file that a
      // parallel build could be rewriting.
      themeFile = path.join(out, 'themes', `${arm}.css`);
      writeFileSync(themeFile, css);
    }
    const outDir = path.join(out, 'sites', arm);
    rmSync(outDir, { recursive: true, force: true });
    log(`▸ astro build (${arm}${isDeclared(arm) ? `, ${CORAL_CSS_KEY}: ${CORAL_CSS_LAYERED}` : ''}) → ${outDir}`);
    const t0 = Date.now();
    const r = await buildSite({ irDir, engineDir: engine, outDir, siteUrl: `https://${arm}.example.test`, themeFile });
    if (r.code !== 0) throw new Error(`buildSite(${arm}) exited ${r.code}`);
    built[arm] = { outDir, ms: Date.now() - t0, theme: SITE[arm].themeName || null, themeCss: css, coralCss: armCoralCss(arm) };
    // Sanity: the theme really went through the renderer's reef.theme path.
    const home = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    built[arm].themeInReefThemeLayer = css ? /@layer reef\.theme\s*\{[\s\S]*--gd-accent:\s*#/.test(home) : null;
    built[arm].dataThemeCustom = /<body[^>]*\sdata-theme-custom/.test(home);
    // Per ARM: the coral layer is named in the statement only on a site that declared, so the
    // legacy arms are checked against the three-name statement they have always emitted.
    built[arm].layerOrderDeclared = LAYER_ORDER_STATEMENTS[isDeclared(arm) ? 'declared' : 'legacy']
      .some((stmt) => home.includes(stmt));
    // 🔴 And the declaration really reached the document root. Without this the whole declared half
    // of the matrix could be measuring a site that silently built in legacy mode, and every
    // "the override did not reach" reading would look like a renderer finding instead of a fixture
    // that never declared. Fail the build, not the verdicts.
    built[arm].coralCssStamp = (home.match(new RegExp(`<html[^>]*\\s${CORAL_CSS_ATTR}="([^"]*)"`)) || [])[1] || '';
    if (built[arm].coralCssStamp !== armCoralCss(arm)) {
      throw new Error(`${arm}: built site stamps ${CORAL_CSS_ATTR}=${JSON.stringify(built[arm].coralCssStamp)}, ` +
        `expected ${JSON.stringify(armCoralCss(arm))} — the fixture's declaration did not reach the document root`);
    }
  }
  return built;
}
