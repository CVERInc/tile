# platform-dispatch

Dispatch Worker for Workers for Platforms Sites. **Inert by construction:** no
package imports it, no build includes it, and `wrangler.example.jsonc` names no
real zone or account. It changes nothing until someone deploys it.

Entry: `entry.mjs` (`default.fetch`, `Connector` and `RouteDispatch` WorkerEntrypoints). Testable core: `index.mjs`.

## Bindings
| Name | Kind | Use |
|---|---|---|
| `HOST_ROUTES` | KV | `get(<lowercase host>, 'json')` -> `{ worker, generation, runWorkerFirst? }` |
| `DISPATCHER` | dispatch namespace | `get(worker, { props })` |
| `RSP` | service binding | `/api/` and `DIRECT_FORWARD_RULES` forward, stub reads |
| `DISPATCH_BYPASS` | var | `1`/`true`/`on` serves the generated Worker's missing-binding 503 |

## Behavior
- Order: bypass, `cf-worker` rule, host lookup, then `/api/` or direct forward, or dispatch.
- Unknown host: 404, RSP never called. Malformed mapping: 502.
- `/api/` (trailing slash included, so `/apix` is not matched) is forwarded to `RSP` unmodified; `Host` and `Origin` survive. `X-Forwarded-Host` is never set. Other prefixes (`/apix`, ...) go to the Site Worker.
- Direct forward: `GET`/`HEAD` on `DIRECT_FORWARD_RULES` (the transport contract's rsp `direct` rules outside `/api/`: `/seam/island.js`, `/seam/checkout-unavailable`, `/seam/listing-filter.js`, `/seam/wix-sidecart.css`, `/billing/success`, `/billing/cancel`, the `/asset/` prefix) is forwarded to `RSP` the same way, because a Site Worker here has no RSP binding. Other methods, other `/seam/` paths (the verdict path included) and the Site-composed pages (`/membership`, `/account`, `/checkout/success`, `/subscribe/success`) go to the Site Worker.
- `cf-worker` present: only `GET` on `PUBLIC_CATALOG_PATHS` (`/api/v2/shop/catalog`, `/api/v2/shop/catalog/item`, the template's self-origin reads) and on `SITE_SHELL_PATH` (`/`, the home page shell RSP reads for the Site's `<html lang>`, dispatched to the Site Worker); anything else 403.
- Capability stub: `ctx.exports.Connector({props:{host,worker,generation}})`, built per request and passed as `props.CONNECTOR`; absent when `ctx.exports` is unavailable (token tier). It allows GET on `STUB_READ_PATHS` only (the catalog paths are not among them: they are rate-limited per visitor and reach RSP over the own host via the `cf-worker` rule) and always targets the mapped host.
- `runWorkerFirst` (data from the mapping; wrangler glob and `!` semantics): paths outside it are static assets and get no stub. No list means every path gets one.
- `DISPATCHER.get` or the fetch failing with "not found": 502 `site_worker_not_found`; any other failure: 502 `site_worker_error`.

## Exports and route-key entry
- `lookup(env, key)` -> `{ entry: { worker, generation, runWorkerFirst?, boundDomain? } }` or `{ error: Response }` (503 binding/KV failure, 404 `unknown_host`, 502 `host_mapping_invalid`). `boundDomain` is passed through and changes no serving behavior.
- `fetchRoute(request, env, ctx, { routeKey, host })`: `routeKey` must start with `preview:` (else 400 `route_key_invalid`); the mapping is read from `HOST_ROUTES[routeKey]` and served exactly like a Host lookup (`/api/` and direct forward to `RSP` verbatim, else the Site Worker with the capability stub pinned to `host`). Unknown key: 404, RSP never called. `DISPATCH_BYPASS` and the `cf-worker` rule apply as for hosts. A hostname never contains `:`, so the Host path cannot reach a `preview:` key.
- `RouteDispatch` (`entry.mjs`): `fetchRoute(request, { routeKey, host })` over a service binding with `entrypoint: "RouteDispatch"`.

Run the tests with node's test runner (`index.test.mjs`, `direct-forward.test.mjs`). `entry.mjs` needs workerd and is exercised by the local harness.
