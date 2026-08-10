// Render a site's OG/share card to PNG — the picture that appears when someone posts a link.
//
// WHERE THIS RUNS. In the build container, after Astro has produced dist/ and before deploy —
// NOT at the edge, and not inside the Astro build. The reasoning, because it reverses twice:
//
//   • Not at the edge. An image that only exists because our worker renders it does not travel
//     with the site. Export the site, self-host it, and every share card dies. Portability is the
//     product here, so a feature that quietly un-ports the site is the wrong trade at any price.
//   • Not inside the Astro build. Rendering every page every time is the thing that walks a big
//     blog into the build-timeout wall (see the build-wall note); this runs once per page whose
//     title/description actually changed.
//   • So: a container, at publish. Which is also what makes satori the right tool rather than the
//     wrong one — the objection to satori was never the library, it was that a CJK font is ~16MB
//     and a Worker bundle has a hard limit. A container does not.
//
// 🔴 THE TRAP THIS FILE EXISTS TO CONTAIN. satori does NOT do per-glyph fallback between fonts
// that share a `name`. Hand it six chunks all called "OG" and it uses the first one; every glyph
// the others carried renders as a NO GLYPH box, with no error and exit code 0. CJK forces chunked
// fonts on you (one weight of Noto Sans TC is 106 unicode-range chunks), so this is not an exotic
// case — it is the default case, failing silently. Distinct names + a fontFamily cascade is the
// whole fix, and `familyList()` below is the only place allowed to build that list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CARD_W = 1200;
export const CARD_H = 630;

/** Parse one fontsource package's per-weight CSS into [{pkg,file,ranges}] — the unicode-range map
 *  that says which chunk carries which codepoints. Built once per process, not per card. */
export function indexFontPackage(nodeModulesDir, pkg, weight) {
  const css = readFileSync(join(nodeModulesDir, '@fontsource', pkg, `${weight}.css`), 'utf8');
  const out = [];
  for (const block of css.split('@font-face').slice(1)) {
    // woff, deliberately not woff2: satori reads woff directly and fontsource ships both.
    const file = /url\(\.\/files\/([^)]+\.woff)\)/.exec(block);
    if (!file) continue;
    const decl = /unicode-range:\s*([^;]+);/.exec(block);
    const ranges = (decl ? decl[1] : 'U+0-10FFFF').split(',').map((s) => {
      const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(s.trim());
      return m ? [parseInt(m[1], 16), parseInt(m[2] || m[1], 16)] : null;
    }).filter(Boolean);
    out.push({ pkg, file: file[1], ranges });
  }
  return out;
}

/** The chunks needed to draw `text`, in first-use order. Order matters: it becomes the cascade. */
export function chunksFor(text, index) {
  const picks = [];
  for (const ch of new Set([...String(text)])) {
    const cp = ch.codePointAt(0);
    const hit = index.find((e) => e.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (hit && !picks.includes(hit)) picks.push(hit);
  }
  return picks;
}

/** 🔴 Distinct names, always. See the trap note at the top of this file. */
export function familyList(picks) {
  return picks.map((_, i) => `OGF${i}`);
}

export function fontsFor(nodeModulesDir, picks, weight) {
  const names = familyList(picks);
  return picks.map((p, i) => ({
    name: names[i],
    weight,
    style: 'normal',
    data: readFileSync(join(nodeModulesDir, '@fontsource', p.pkg, 'files', p.file)),
  }));
}

/** The card's markup. Kept as a plain object (satori's JSX-free form) so this file needs no
 *  transform step and can be unit-tested without a renderer. */
export function cardTree({ title, brand, bg, fg, family }) {
  const box = (children, style) => ({ type: 'div', props: { style: { display: 'flex', fontFamily: family, ...style }, children } });
  return box([
    box(title, { fontSize: 64, lineHeight: 1.25, maxHeight: 330, overflow: 'hidden' }),
    box(brand, { fontSize: 30, opacity: 0.75 }),
  ], {
    width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'space-between',
    padding: '70px', background: bg, color: fg,
  });
}

/** Build a renderer bound to one font set. `satori` and `Resvg` are injected so this module stays
 *  importable (and testable) on a machine that has not installed them. */
export function makeCardRenderer({ satori, Resvg, nodeModulesDir, packages, weight = 700 }) {
  const index = packages.flatMap((pkg) => indexFontPackage(nodeModulesDir, pkg, weight));
  if (!index.length) throw new Error('og-card: no font chunks indexed — check the fontsource packages');
  return async function renderCard({ title, brand = '', bg = '#111111', fg = '#ffffff' }) {
    const text = `${title}${brand}`;
    const picks = chunksFor(text, index);
    if (!picks.length) throw new Error(`og-card: no font covers any glyph of ${JSON.stringify(text.slice(0, 40))}`);
    const fonts = fontsFor(nodeModulesDir, picks, weight);
    const family = familyList(picks).join(', ');
    const svg = await satori(cardTree({ title, brand, bg, fg, family }), { width: CARD_W, height: CARD_H, fonts });
    return new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng();
  };
}

// ── the gate's own predicates, extracted so they have a permanent control group ──────────────────
// SiteLayout emits og:image before this build step creates the file. If a render silently fails the
// page ships a tag aimed at a 404, and a dead share card looks exactly like no share card to
// everyone except the person who clicked. These two are what the build step refuses on.

/** absolute-or-relative og:image → the site-root-relative path, or '' if it is somebody else's. */
export function ourCardPath(ogImage) {
  const path = String(ogImage || '').replace(/^https?:\/\/[^/]+/, '');
  return path.startsWith('/og/') && path.endsWith('.png') ? path : '';
}

/** the cards a page claims but disk does not have. `exists` is injected so this is testable. */
export function deadCards(pages, exists) {
  return pages.filter((p) => {
    const rel = ourCardPath(p.img);
    return rel && !exists(rel);
  });
}
