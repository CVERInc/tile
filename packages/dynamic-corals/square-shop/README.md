# square-shop — a SITE coral, and the reason a backend grep used to land here

**No Card can embed this.** If you arrived because you grepped for a shop-backend hostname while
working on REEF with Card, the grep was right and the inference is wrong. This note exists to answer
that where the grep lands, because it has cost at least one full audit round.

## Measured, 2026-08-13

- The legacy shop backend's hostname appeared in **square-shop** — this coral, its `_worker.js`
  emitter, and twelve frozen registry versions — and **nowhere else** in the repo.
  `packages/cardtile/` was **0 hits**; the engine's own packages were **0 hits**.
- `card-render.mjs` can emit exactly two corals: `qr` (on a profile cell) and `drawer` (when the
  card has a drawer lane). There is no path by which a Card's markdown mounts this one.
- All six live cards were fetched from their public URLs: **0** occurrences of the hostname, **0**
  of `fetch(`, **0** of `XMLHttpRequest`.

So: REEF with Card has no dependency on that backend, and this constant is not evidence that it does.

## What the constant actually is

```js
const DEFAULT_API_BASE = ''; /*coral-default:apiBase*/
```

A **default**, and as of the move to the public engine, an *empty* one. Every real caller passes
`--api` / configures its own base. It points at whatever legacy backend a deployment is still
running while its strangler replaces it route by route — someone else's migration, on their
timeline, and not ours to change unilaterally.

🔴 **The hostname is no longer here at all.** It arrives at build time from
`build.mjs --defaults <file>`, a file the deployment owns beside its own registry. Two reasons, and
only one of them is privacy: this repo is public and MIT, so a hostname committed here would be a
fact about somebody's infrastructure shipped under our licence — and a default that is a *literal*
is a default nobody can change without editing the coral. The substitution is byte-exact: the filled
line is character-for-character the literal it replaced, which is what lets the registry's
immutability check keep working as a rebuild-vs-published equality. See `../README.md` and
`../build.mjs`.

## Why the two live here at all

`packages/dynamic-corals/` is where every coral lives — the ones a Card mounts and the ones a Site
mounts, side by side. That is a **neighbourhood, not a dependency**, and it is the whole reason the
grep misled: `square-shop` sits two directories from `qr` and `drawer`, which a Card really does
ship.

🔴 The lesson is not "rename the constant". It is that a search result tells you where a string is,
never what depends on it — and the cheap fix for that gap is to answer the question at the place
the search lands. (The grep that started this can no longer land here, because the string is gone.
The lesson outlives its example, which is why this page kept it.)
