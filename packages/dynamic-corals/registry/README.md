# Coral registry — the worker

npm's pin-vs-OTA answer transplanted to the web platform: **immutable versions + mutable
channels**, and which one a site consumes is a one-line per-site policy.

```
/corals/<coral>/<x.y.z>/<file>     exact   → cache immutable 1y   (the per-site PIN)
/corals/<coral>/<channel>/<file>   channel → max-age 300, stale-while-revalidate 3600 + X-Coral-Resolved   (the OTA ride)
/corals/manifest.json              the channel table (public index)
```

## What is here, and what is not

This directory holds the registry's **logic** — `registry-worker.mjs` and its tests. Three things it
deliberately does not hold, because they are a *deployment's* and not the coral's:

| not here | why |
|---|---|
| `versions/` — the published artifacts | serving data. Immutable, written only by `../build.mjs`, and a record of what one deployment has shipped. |
| `manifest.json` — the channel table | live operating state. Repointing a channel *is* the fleet-wide rollback lever; it changes several times a week and belongs with the deploy that performs it. |
| `wrangler.toml`, the deploy script | names an account, a zone and a route. |

## 🔴 The seam: `coral-manifest`

`registry-worker.mjs` imports the channel table from the bare specifier `coral-manifest`, which
**nothing in this repo resolves**. A deployment supplies it at bundle time from its own config:

```toml
# in the deployment's registry directory, beside its manifest.json and versions/
main = "<path to this repo>/packages/dynamic-corals/registry/registry-worker.mjs"

[alias]
"coral-manifest" = "./manifest.json"

[assets]
directory = "versions"
run_worker_first = true          # the worker owns cache headers, channel resolution and CORS
```

**Why a bare specifier and not an empty `manifest.json` shipped here as a fallback.** Because the
fallback is the dangerous option. A build that could not find the deployment's table would succeed,
and deploy a registry whose every channel URL answers `unknown coral` — which looks exactly like an
outage nobody caused, on every customer site at once. An unresolvable import is loud at build time.
Resolving to the wrong data is not loud at all.

The channel table is imported rather than fetched so a deploy stays **atomic**: pointers, artifacts
and logic ship together, and provenance is the git log of the repo that owns the pointers.

## No redirects, and no names nobody published

The worker never answers a 3xx: a module's `import.meta.url` is the URL the browser ended on, so a
redirect would let whoever chose its `Location` choose where a coral thinks it lives. A store answer
that is not a 2xx (a static asset platform's trailing-slash or `.html` redirect included) becomes a 404.
The page routes are handed to the origin and relayed as they come back; only the page shapes get there.

A path segment outside `[A-Za-z0-9._-]`, or one made only of dots, is a 404 before the asset store
is asked — every coral id, version, channel and published file name is made of those characters, so
such a segment (`sample%2ejs`, `..%2F..%2Fx.js`, `...`) could not have named a published file, and a
store that decoded it first might find one anyway. Empty segments (`//`) are collapsed, as before.
`registry-no-redirect.test.mjs` crosses every route shape with odd spellings of it to hold both.

## Running the tests

`registry-worker.test.mjs` stubs the import with a fixture table and asserts it did — a test that
needed the real table would be a test that went red every time somebody shipped a coral.
