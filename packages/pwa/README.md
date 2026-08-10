# REEF with PWA

Make any REEF site an installable **Progressive Web App** — a name on the home screen, a
standalone window, a branded splash — by opting in. One capability, opt-in, grown on real need
(the `berth` / `dynamic-corals` discipline), heading toward [whatpwacando.today](https://whatpwacando.today/)
one profile at a time.

## What it is

A small, framework-agnostic module shared by the renderers (sitetile today; cardtile next):

- **`pwa-core.mjs`** — the pure manifest model. `buildManifest(meta)` turns a site's frontmatter
  (brand / title / description / theme colour) into a valid web app manifest. Node-testable, zero I/O.
- **`gen-icons.sh`** — one source PNG → the whole icon set. Trims excess transparency so the mark
  fills the frame, then composites the opaque icons on a brand colour.

## v1 scope — INSTALLABLE

Manifest + icons + theme. That is the MVP of a PWA and all v1 does. Deliberately **not** here yet
(the roadmap, added later as opt-in profiles, never bundled up front):

- offline / service worker (a static site can add a simple cache SW when it wants one)
- push notifications (needs a backend + permission UX — `berth`-adjacent)
- share target · file handling · badging · … (add on real need)

## Use it (sitetile)

1. **Generate the icons** from a square-ish source (a logo or mascot, transparent bg preferred):

   ```sh
   packages/pwa/gen-icons.sh <source.png> <site>/assets '#120d1c'
   # → favicon.png · apple-touch-icon.png · icon-192.png · icon-512.png · icon-maskable-512.png
   ```

2. **Opt in** in the page frontmatter, and point the favicon at the trimmed one:

   ```yaml
   packages: lingo, pwa
   favicon: /favicon.png
   theme-color-light: "#fdfcff"
   theme-color-dark: "#120d1c"
   ```

The layout then links `/manifest.webmanifest` (built from the frontmatter via `@pwa`) + the opaque
`apple-touch-icon.png`; the manifest route ships the 192 / 512 / maskable icons. iOS gets a proper
opaque touch icon (transparency would black out), Android/desktop get an installable manifest.

## Icon file convention

`buildManifest` and the layout reference these fixed site-root names (what `gen-icons.sh` emits):
`favicon.png · apple-touch-icon.png · icon-192.png · icon-512.png · icon-maskable-512.png`.

## Consumers

- **sitetile** — `@pwa` alias (astro.config) → this module; `manifest.webmanifest.js` route +
  `packages: pwa` in `SiteLayout`.
- **cardtile** — same `@pwa` model when a card site wants to be installable (YAGNI until then).
