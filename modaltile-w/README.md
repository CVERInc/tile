# modaltile-w — the full-screen single-post editor

One post at a time. It covers the page you were already on, and saves back over six JSON routes.
`pagetile-w` owns "turning pages", `tugtile-w` owns "the board", modaltile owns "one post".

## Why it only just got a name

It lived at `ejecta/core/editor/editor-modal.js` and answered to no family name at all. So looking
for it by name never found it — which made "just hand-roll another editor" look reasonable every
single time, and that is exactly what a family name exists to prevent.

It was never ejecta's, either: `API_BASE` has already pointed at two different back ends, and not
one line here assumes a filesystem. The surface belongs to the family; ejecta was only its first
host.

🔴 **Moving it changed no behaviour.** Not one byte, including the things below that look like they
ought to be tidied on the way past. "Port" and "recreate" are the verbs that turn a move into a
rewrite — this was a move.

## Running it

```bash
./build.sh
(cd .. && python3 -m http.server 8731)   # ESM imports are blocked by CORS on file://
open http://localhost:8731/modaltile-w/
```

`index.html` is a **backend-free** test bench: it injects a fake `fetch` as the host. That it works
at all is the proof that this surface really is host-agnostic — any host that can answer those six
routes can mount it.

## The host contract (this is all of it)

| route | purpose |
|---|---|
| `GET  {base}/api/post/:slug` | read a post → `{ok,title,status,body_format,body}` |
| `POST {base}/api/field` | change a single field (the title saves as you type) |
| `POST {base}/api/save` | save the whole markdown body |
| `POST {base}/api/publish` / `unpublish` | publish / retract |
| `POST {base}/api/delete` | delete |
| `GET  {base}/_ejecta/livepage?slug=` | optional. Present → smart preview; absent → fall back to `/api/preview` |

`{base}` comes from `window.__EJECTA_API_BASE`; empty string means same-origin.

🔴 And one nobody had ever written down: **`editabilize.js` runs itself the moment it is imported**,
unless the host sets `window.__EJECTA_NO_AUTORUN = true` first. On a host page with no
`.entry-content` it fails to find a content region and prints an error that has nothing to do with
the modal. The first host had always set that flag — but only inside one line of its HTML, so the
requirement existed and was documented nowhere. The first smoke run walked straight into it, which
is why it is part of the contract now.

## Smoke

```bash
(cd .. && python3 -m http.server 8731 &)
# 🔴 COPY it next to a playwright install first. Node resolves an ESM import from the FILE's
# location, not the working directory, so running this file in place fails no matter where you cd
# to. An earlier version of this README said "run it from a dir that has playwright", which reads
# perfectly and does not work.
cp smoke.mjs <somewhere-with-playwright>/_modaltile-smoke.mjs
(cd <somewhere-with-playwright> && node _modaltile-smoke.mjs http://localhost:8731/modaltile-w/)
```

⚠️ **This has not been run since the surface moved here** (2026-08-11). The machine it was written
on has playwright but its downloaded browser is a version behind what playwright now asks for, so
the run ends at `npx playwright install` rather than at an assertion. The harness is unchanged and
nothing about the move should affect it — but "should" is the word, and nobody has seen it pass in
this repo.

What it checks is not "it renders" but that it **works**: the modal opens, the editor mounts, the
title comes from the host, all six action buttons are present, `GET /api/post` is reached, the view
cycle really swaps classes, typing really sends `POST /api/save`, and there are zero JS errors.

## Still host-specific (do not mistake these for family code)

- **The `__EJECTA_*` globals** (`__EJECTA_API_BASE` / `__EJECTA_SLUG` / `__EJECTA_SEED` /
  `__EJECTA_NO_AUTORUN`) are **historic names, not dependencies.** Renaming them means changing
  every host at once, which is its own piece of work and not something to smuggle into a move.
- **The smart-preview selectors in `modaltile-core.js`** — `article.ast-article-single` /
  `.entry-content` — are Astra's, a WordPress theme, because the first host was a mirrored
  WordPress site. They belong in an option. They are left exactly as they were and written down
  here instead, so the next reader does not mistake them for family selectors.
- **`editabilize.js`** solves "a frozen mirrored page" — turning a page of static HTML editable in
  place — which comes from a capture context, not from this family. It is here because modaltile
  depends on it directly, not because anyone has decided it belongs.

## Two things measured during the move and deliberately not touched

1. **`obsidian-shim.js` exists three times over, byte-for-byte identical.** `build.sh` copies
   `styles.css` and `i18n/` from a single source, but the shim is hand-maintained copies with no
   generator behind them. Fixing it means moving two working surfaces at once, so it is left for a
   round of its own.
2. **The vendored `tile-core.js` copies did not all agree** — three surfaces, two engine builds,
   every one of them nominally "latest". This surface takes the family's current build, matching
   its two siblings. Why the third drifted was never established.
