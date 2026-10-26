// REEF with PWA — the pure model (zero I/O, node-runnable), same posture as site-core / card-core.
// A REEF site becomes an installable Progressive Web App by opting in (`packages: pwa`): the layout
// links a manifest + icons, and this module builds the manifest from the site's own frontmatter.
//
// v1 scope = INSTALLABLE (manifest + icons + theme). Offline/service-worker, push, share-target,
// file-handling etc. are the whatpwacando.today roadmap — added later as opt-in profiles, never
// bundled up front (the berth/dynamic-corals discipline: one capability, grow on real need).
//
// Icon file CONVENTION (produced by gen-icons.sh, placed at the site root):
//   favicon.png · apple-touch-icon.png · icon-192.png · icon-512.png · icon-maskable-512.png

/** The site-root icon files the manifest + head tags reference (what gen-icons.sh emits). */
export const PWA_ICON_FILES = ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

/** true when a site opted into PWA via its `packages:` frontmatter list. */
export function hasPwa(packages) {
  return (Array.isArray(packages) ? packages : String(packages || '').split(',').map((s) => s.trim()))
    .includes('pwa');
}

/** The manifest entries for gen-icons.sh's output, in the order the manifest lists them. */
export const MANIFEST_ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * The icons a manifest may list: only files this build ships.
 *
 * 🩸 The manifest used to list MANIFEST_ICONS unconditionally. Those files exist only where
 * someone ran gen-icons.sh (ImageMagick) and placed its output in public/. Nothing in a
 * normal build does that, so a built site served a manifest whose three icons all answered 404.
 *
 *   `present`: the PWA_ICON_FILES names found in public/ (a Set or an array).
 *   `owner`:   the owner's favicon as a shipped PNG, `{ href, width, height }`, or null.
 * gen-icons.sh output wins wherever it exists, even when `favicon:` names a newer PNG: a file placed in
 * public/ is the owner's explicit choice, the same precedence Astro gives it at /apple-touch-icon.png
 * (sitetile icon-core's PRECEDENCE note). Without any of it, the owner's PNG is listed at its
 * real size. Without that either, the list is empty: a manifest with no icons is valid, and a
 * manifest that names missing files is not.
 */
export function manifestIcons(present, owner) {
  const have = new Set(present || []);
  const generated = MANIFEST_ICONS.filter((i) => have.has(i.src.slice(1)));
  if (generated.length) return generated;
  if (owner && owner.href && owner.width && owner.height) {
    return [{ src: owner.href, sizes: `${owner.width}x${owner.height}`, type: 'image/png', purpose: 'any' }];
  }
  return [];
}

/**
 * Build the web app manifest object from site frontmatter.
 * `meta` = the site's frontmatter (brand / title / theme-color-dark …). Missing values fall back
 * to safe defaults so a half-configured site still produces a valid manifest.
 */
export function buildManifest(meta = {}, opts) {
  const m = meta || {};
  const name = String(m.title || m.brand || 'App').trim();
  const short = String(m.brand || m.title || name).trim().slice(0, 12) || name;
  // the app's toolbar + splash colour: prefer the dark theme-color (installs default to a dark
  // chrome), then light, then a neutral black. Strip any stray quotes from the frontmatter value.
  const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');
  const theme = clean(m['theme-color-dark']) || clean(m['theme-color-light']) || '#000000';
  return {
    name,
    short_name: short,
    description: String(m.description || '').trim() || undefined,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: theme,
    background_color: theme,
    // `opts.icons` is what the build ships (manifestIcons). A caller with no filesystem gets
    // the gen-icons.sh convention, which is what this function always returned.
    icons: (opts && Array.isArray(opts.icons) ? opts.icons : MANIFEST_ICONS).map((i) => ({ ...i })),
  };
}

/** Serialize the manifest (drops undefined keys). */
export function manifestJson(meta, opts) {
  return JSON.stringify(buildManifest(meta, opts), (_k, v) => (v === undefined ? undefined : v), 2);
}
