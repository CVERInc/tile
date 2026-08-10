// The Vite plugin that puts every imported .css into the site's theme layer.
//
// 🩸 Its own file, with ZERO imports, so a test can exercise it in a BARE checkout. It used to live
// in astro.config.mjs, and the test imported that — which pulls in `astro/config` and dies with
// ERR_MODULE_NOT_FOUND wherever node_modules is absent. CI runs against a bare checkout on purpose
// (see .github/workflows/ci.yml), so that was three red pushes in a row while the local suite
// stayed green. Same shape as the five-in-a-row on 2026-07-29.
//
// Why `reef.theme` and not a layer of its own: package CSS and the site theme share one layer so
// that SPECIFICITY still decides between them, exactly as it did before layers existed. A separate
// lower layer was tried and overshot — it handed the theme every contest it used to lose, and
// a theme's `html a { color: inherit }` (0,0,2) started beating `.locale-banner__continue`
// (0,1,0), putting 2.66:1 ink on the banner's purple button. See SiteLayout's cascade note.
//
// Without this wrap the sheet is UNLAYERED, and unlayered beats every layer — so the theme could
// not touch it at any specificity. Measured on a live build: a theme hid eight `.signet-arrow`
// glyphs and they came back, because `@cvernet/signet/arrow.css` arrives through this path rather
// than through SiteLayout. Doing it in the build is the difference between a rule and a habit: the
// next `import './something.css'` anyone adds is covered without them knowing this note exists.
//
// Skipped deliberately:
//   • a sheet that already names a reef layer (site.css opens with `@layer reef.base`) — wrapping it
//     would nest, producing `reef.theme.reef.base`, which is a different layer than either.
//   • Astro's own scoped <style> blocks (`?astro&type=style`), which are not package CSS.
export function reefComponentsLayer() {
  return {
    name: 'reef-components-layer',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id)) return null;
      if (/[?&]astro/.test(id) || /[?&]raw/.test(id)) return null;
      if (/@layer\s+reef\./.test(code)) return null;
      // @import and @charset must precede every other rule and are invalid inside a layer block.
      // None of our imported sheets use them; if one ever does, fail loudly rather than emit CSS
      // the browser will silently drop from the top.
      if (/@(import|charset)\b/.test(code)) {
        throw new Error(`[reef-components-layer] ${id} uses @import/@charset and cannot be wrapped in a layer — hoist it or layer the file by hand.`);
      }
      return { code: `@layer reef.theme {\n${code}\n}`, map: null };
    },
  };
}
