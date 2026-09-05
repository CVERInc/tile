# @tile/dynamic-corals

The tile family has two kinds of coral (static / dynamic):

- **Static coral** — content decided at authoring time, baked into the Markdown SSOT
  (sitetile's `hero`/`grid`/`prose`/`cta`, feelreef's `text`/`image`/`button`…). No
  live fetch; render is a pure projection of the stored Markdown.
- **Dynamic coral** — a single portable, framework-agnostic widget (one `<script>` +
  a container element) that fetches LIVE data from a feelreef backend API **at view
  time, in the visitor's browser**, and renders + handles interaction itself. The
  same widget file installs unmodified into either substrate:
  - **sitetile** (static Astro build) — via the `embed` section type's escape hatch
    (`Embed.astro` does `set:html`, so the container + script tag just go straight
    into the Markdown body).
  - **cardtile / coral** (feelreef's Svelte block registry) — a thin `Render.svelte`
    wrapper mounts the container in `onMount()` and loads the same widget script.

**Why this split matters:** sitetile ships `output: 'static'` — the HTML shell is
built once and has no server. That does NOT mean a sitetile page can't show live
data — a static page can still run JS that fetches at view time (standard JAMstack
"static shell + dynamic island"). Dynamic corals are exactly that island, kept as
its own reusable category instead of a one-off hack per integration.

## Mount contract (locked)

A dynamic coral is ONE zero-dependency ES module file. It auto-mounts on load —
no host-side wiring beyond dropping the container + script tag:

```html
<div data-dynamic-coral="square-shop" data-guild-id="1090971660791861331"></div>
<script type="module" src="https://cdn.example/dynamic-corals/square-shop.js"></script>
```

- **Selector**: `[data-dynamic-coral="<type>"]`. The widget scans the DOM for every
  matching element on load (supports multiple instances on one page) and mounts
  into each independently.
- **Config**: read entirely from `data-*` attributes on the container — no globals,
  no build-time config. `data-guild-id` is the one attribute every dynamic coral
  needs (it's how the backend resolves which seller's data to fetch). Widget-specific
  config (if any) is its own `data-*` attribute, documented in that widget's header
  comment.
- **API base**: `data-api-base` names the feelreef backend the widget talks to. A
  widget never talks to any OTHER backend — it's a feelreef-data widget, not a
  generic plugin host. A widget whose routes are served on a per-environment
  hostname has **no** default and requires the attribute — `sponsor` is the one, and
  it refuses to mount rather than post to an origin nobody chose. Inventing a
  plausible-looking default is the failure this rule exists to prevent: it turns a
  misconfigured page into a 404 that looks like an outage.
- **No hostname is committed here.** This repo is public and generic; which origin a
  particular deployment's embeds fall back to is that deployment's business, and it
  would be a fact about somebody's infrastructure published under an MIT licence.
  Where a widget has a fallback at all, its source carries a NEUTRAL empty value
  marked `/*coral-default:<key>*/`, and the real value arrives at build time from
  `build.mjs --defaults <file>` — a file the deployment owns, next to the registry it
  publishes into. `square-shop` is the one with such a marker (`apiBase`).
  🔴 `build.mjs` refuses to publish a new registry version with a marker still
  unanswered: shipping the neutral value would break every embed that relies on the
  fallback, and it would look exactly like a successful build.
- **Non-custodial / aggregator-only**: a dynamic coral NEVER caches or stores the
  third-party data anywhere — no localStorage, no service worker cache of API
  responses. Every page view re-fetches live. feelreef is a pass-through, never
  the source of truth for the connected seller's own data (Stripe/Square/etc).
- **Honest degrade**: no connection / empty catalog / network failure → an honest
  empty or error state in the widget's own UI. Never fabricated placeholder data.
- **Styling**: scoped CSS injected once via a `<style>` tag keyed by a namespaced
  class prefix (`dc-<type>-*`), matching the family convention (sitetile `st-*`,
  cssmd's per-host prefix). No external stylesheet dependency.
- **Zero framework dependency**: vanilla JS + the native `fetch`/DOM APIs only, so
  the same file drops into a static Astro page or a Svelte `onMount` unmodified.

## Adding a new dynamic coral

1. New file `packages/dynamic-corals/<name>/<name>.js`, same auto-mount pattern
   (`document.querySelectorAll('[data-dynamic-coral="<name>"]')` + `DOMContentLoaded`
   guard for scripts loaded before the DOM is ready).
2. Document its `data-*` config surface in the file's header comment.
3. Wire the feelreef backend API route(s) it needs (public, CORS-open, read-only
   unless the widget explicitly needs a write action like "create a checkout link").
4. On the feelreef side, add a thin coral `module.ts` + `Render.svelte` that mounts
   the container and loads the widget (see `square-shop/README.md` once the first
   feelreef-side wrapper lands, for the exact pattern to copy).
5. On the sitetile side, no code changes needed — authors drop the `embed` section
   with the container + script tag directly in their page's Markdown.

## Packages here

- `square-shop/` — REEF with Checkout's live Square Catalog widget (first dynamic
  coral, ships the pattern).
