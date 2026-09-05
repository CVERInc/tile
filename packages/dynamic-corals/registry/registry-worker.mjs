// Coral registry — feelreef.com/corals/*. The distribution layer of the coral strategy: the same
// URL a sitetile site references is the one a third-party host will someday paste into their HTML.
//
//   /corals/<coral>/<x.y.z>/<file>   exact  → immutable (cache 1y); the per-site PIN
//   /corals/<coral>/<channel>/<file> alias  → short TTL + X-Coral-Resolved; the OTA ride
//   /corals/manifest.json                   → the channel table (public index)
//
// npm's answer to "pin vs OTA" transplanted to the web platform: immutable versions + mutable
// dist-tags, and which one a site consumes is a one-line per-site policy. Channels resolve through
// manifest.json, IMPORTED at build so a deploy is atomic (pointers + artifacts + logic ship
// together, provenance = git log): repointing a channel is an edit + `wrangler deploy`, seconds —
// that repoint is the fleet-wide rollback lever, no site rebuilds.
//
// 🔴 CORS is load-bearing, not hygiene: corals are embedded as `<script type="module">` from OTHER
// origins (a creator's own domain pulling from feelreef.com), and cross-origin module scripts are CORS-
// gated — classic scripts aren't, so a missing header here fails in a way that looks like the
// coral silently not mounting. Immutable responses also carry ACAO so both script flavours work.
// 🔴 THE CHANNEL TABLE IS DATA, AND IT IS NOT IN THIS REPO. Which version each channel points at
// is a deployment's live operating state — the mutable half of the registry, edited and deployed
// as the fleet-wide rollback lever. This repo holds the LOGIC. The table arrives at bundle time
// from the deployment, aliased onto this specifier by its own wrangler config:
//
//     [alias]
//     "coral-manifest" = "./manifest.json"        # in the deployment's registry directory
//
// 🔴 A BARE SPECIFIER WITH NO FALLBACK, deliberately. The tempting alternative was to ship an empty
// `./manifest.json` here so the import always resolves — and that is the worst available outcome:
// an unaliased build would succeed and deploy a registry whose every channel URL answers
// "unknown coral", which is indistinguishable from an outage nobody caused. Unresolvable is loud;
// resolving to the wrong data is not. See ../README.md and the deployment's own registry README.
import manifest from 'coral-manifest';

const EXACT = /^\d+\.\d+\.\d+$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/corals\/?/, '').split('/').filter(Boolean);

    if (parts.length === 1 && parts[0] === 'manifest.json') {
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }
    if (parts.length !== 3) return new Response('not found', { status: 404, headers: CORS });

    const [coral, ref, file] = parts;
    const channels = manifest[coral];
    if (!channels) return new Response(`unknown coral: ${coral}`, { status: 404, headers: CORS });

    const exact = EXACT.test(ref);
    const version = exact ? ref : channels[ref];
    if (!version) return new Response(`unknown channel: ${coral}@${ref}`, { status: 404, headers: CORS });

    const asset = await env.ASSETS.fetch(new URL(`/${coral}/${version}/${file}`, url.origin));
    if (!asset.ok) {
      if (file === 'manifest.json') {
        return Response.json({ error: 'no manifest for this version' }, { status: 404, headers: CORS });
      }
      return new Response(`no such artifact: ${coral}@${version}/${file}`, { status: 404, headers: CORS });
    }

    return new Response(asset.body, {
      headers: {
        ...CORS,
        'Content-Type': file === 'manifest.json'
          ? 'application/json; charset=utf-8'
          : 'application/javascript; charset=utf-8',
        'X-Coral-Version': version,
        ...(exact
          ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
          : { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600', 'X-Coral-Resolved': version }),
      },
    });
  },
};
