# cards/ — the live cards' source markdown

These are the cards we AUTHORED — every one of them predates a customer being able to make their
own. That is the whole of what this directory is, and it is smaller than it used to claim.

🔴 **It said "the only way back is from here", and that is no longer true.** A card's source is a
public URL — a live card's `/index.md` served 200 `text/markdown` on 2026-08-11, byte-identical
to the file here. Recovery is the owner's, unauthenticated, always on: no login, no export button,
no waiting for a zip. That is deliberate (the Blogger-export shape, without the export step), and
it means these files are provenance, not a backup system.

Still treat a change to one as a change to production data — a `wrangler kv put` from here does
overwrite a live row. Just do not treat the FILES as load-bearing.

## specimens/ — what the harnesses read now

Every harness in `verify/` used to read these three. They do not any more: `verify/paths.mjs`
resolves `specimens/`, built by `gen-specimens.mjs` and shaped off the three real cards it replaces
(a small assetless card, a many-celled one carrying images, one using every coral the corpus
reached for). `CARD_VERIFY_REAL=1` points them back here for the rare check that is genuinely about
a live card.

🔴 The generator refuses to emit a specimen too light to test what it is for: `negotiation.mjs`
fails when fat/thin is under 50x, so a tidy little specimen would have turned that harness into a
no-op while it kept printing green. The first draft did exactly that at 2.5x. It is 154x and 263x
now, and the generator asserts it.

**No harness keeps a real handle any more.** `card-api-live.mjs` was the last one, and the plan for
it was a permanent `specimen` row in the live store — a write to production, parked. That turned out
to be unnecessary, twice over: the door checks need no row at all (a valid token on a handle nobody
owns answers 404, a bad one 401, and that difference is the whole signal), and the shape checks need
a row that CARRIES ASSETS, which is a requirement for a row and not for a customer — so they run on
the scratch row the lifecycle already creates and deletes.

🔴 The part that mattered was never the reading. Its guard section fired AUTHENTICATED PUTs at a
creator's live card, held off by a `dry_run` flag. One regressed flag from editing somebody's page.
Verified against the live deployment on 2026-08-12: 401 / 401 / 404, refusals byte-identical, and
`no-store` present on the 404 too.

🔴 **The three real cards left this directory on 2026-08-12.** They are in `../../../lab/`.

chodaict's ruling, and it is the right shape: *if a Card owner could make this themselves without
us, we do not need to keep it — and if we do keep it, it goes in our own workspace, not interwoven
with the product.* Those three exist because REEF with Card's first customers were ones we built
for BY HAND and then gave away. The free product is heading somewhere anyone makes their own. So
they are a record of a phase, not an asset of the thing.

Recoverable, checked before they moved: all three answer 200 on their public URL, byte-for-byte.

## Deploying a change

Prefer the write API (`PUT /_api/card/<handle>`): it checks the version, carries the stored
assets and runs Web Risk. A direct KV write skips all three. When it has to be direct, the body
goes under the handle's CURRENT generation (reef#2618 r3 — see `genKey` in `serve/card-api.mjs`):

    export CLOUDFLARE_API_TOKEN=$(security find-generic-password -w -s cver-cf-kv)
    npx wrangler kv key get --remote --namespace-id=<CARDS id> gen:<handle>   # no value ⇒ the generation is 0
    npx wrangler kv key put --remote --namespace-id=<CARDS id> card:<handle>:<gen> --path=<file>

🔴 Not the bare `<handle>` key. That is the pre-generation shape, read only while a handle has
never been deleted; on any handle that has, the write lands and nothing ever serves it. Never
write `gen:<handle>` by hand either — only DELETE does, and a new value there takes the card down.

A domain binding lives under the same generation's keys (reef#2618 r5 — see `vanityKey`):

| key | value | meaning | who writes it |
|---|---|---|---|
| `vanitybind:<handle>:<gen>:<host>` | handle | in this lifetime, `<host>` serves `<handle>` | `bindVanity`, in the caller |
| `vanityof:<handle>:<gen>` | host | in this lifetime, the canonical address 301s to `<host>` | `bindVanity`, in the caller (not for `redirect: false`) |
| `vanity:<host>` | handle | a pointer only: which handle to look at. Shared, never generation-scoped | **only `HostBindings`**, the Durable Object named `<host>` (r6) |

The renderer follows the pointer, reads that handle's `gen:`, and serves the host only if the
`vanitybind:` key of that generation exists. Readers read KV only; the object stores nothing.
DELETE deletes the `vanitybind:`/`vanityof:` keys it listed before rotating, and nothing else of
the binding. Those keys belong to one lifetime, so they have one writer already and DELETE does
not go through the object. It leaves the pointer, which is inert without them.

`bindVanity(env, handle, host)` writes the two lifetime keys, then asks `HostBindings` for
`<host>` to write the pointer. The object re-reads `gen:<handle>` and puts the pointer only if it
still equals the generation the bind was admitted in, and it does that for one request at a time
per host. 🔴 Why (codex r5): with the re-read and the put in the caller, a bind of `a` held
between them landed after `a` was deleted and `b` was bound to the same host. The pointer went
back to `a`, the domain went 404 for good, and `card.feelreef.com/b` kept 301ing into it. KV has
no compare-and-swap, so only "nobody else writes this key meanwhile" closes that. With
`HOST_BINDINGS` unbound, `bindVanity` refuses and writes nothing.

By hand, the same order, pointer LAST. This is allowed only while no deployed route calls
`bindVanity`, because then the person typing is the host's only writer. Once tile#122's PUT is
live, a hand `put vanity:<host>` is a second writer, and that is exactly the r5 race. Bind through
the API instead.

    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanitybind:<handle>:<gen>:<host> <handle>
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanityof:<handle>:<gen> <host>   # omit for no redirect
    npx wrangler kv key get --remote --namespace-id=<CARDS id> gen:<handle>   # still <gen>? if not, stop: the card was deleted
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanity:<host> <handle>

A binding made before generations (`vanity:<host>` plus a bare `vanityof:<handle>`) is generation
0's: in generation 0 the pointer alone binds, and after the handle's first DELETE it never does
again. Never copy an old binding into a later generation's keys: if a DELETE missed it, that hands
the former owner's domain to the next owner.

What the object does not close: its `gen:` re-read is a KV read at the object's location, and KV
may serve that location a cached value for up to about 60 s. A bind of a deleted handle that
reaches the object after a later bind, while that location still caches the old `gen:`, can still
put the old pointer. The domain then 404s until it is bound again; it can never serve the wrong
card. Closing that needs `gen:` itself to have a strongly consistent home. That has not been
measured live.

**Deploying r6 (the ship step: release owner).** The next production deploy of cardtile carries a
Durable Object migration (`[[env.production.migrations]]`, tag `v1-host-bindings`,
`new_sqlite_classes = ["HostBindings"]`; see `serve/wrangler.example.toml`). Copy into the real
config:

1. Under `[env.production]`: the `HOST_BINDINGS` binding and the migration, exactly as in the
   example. Do not edit or reuse the tag after it has been deployed.
2. At the top level (the preview Worker): `HOST_BINDINGS` with `script_name = "cardtile"`. Both
   Workers write one CARDS store, so they must share production's objects. A namespace of their
   own would give each host two writers.
3. Deploy production first (`npx wrangler deploy --env production`), then preview. Preview's
   binding names a class that exists only after production's migration.
4. Rollback: redeploying the previous code without the binding is safe for reads, because nothing
   is stored in the object. Never deploy a `deleted_classes` migration for it while any route
   calls `bindVanity`.

No route calls `bindVanity` in this repo today, so before tile#122 the deploy changes nothing a
visitor sees.

**tile#122's PUT `/_api/vanity/<handle>`** must call `bindVanity(env, handle, host)` and nothing
else: no direct `vanity:`/`vanityof:` writes, and no metadata stamp (r4's shape is gone). Answer 409
when it returns `stale_generation`. Its unbind deletes the current generation's
`vanitybind:`/`vanityof:` keys itself. If it also deletes the pointer, that delete must be a
second operation on `HostBindings`, run in the object's queue: "delete `vanity:<host>` if it still
names this handle AND that handle's `gen:` is still the one the unbind was admitted in". The pointer
names only a handle, so without the second check a late unbind deletes the next lifetime's pointer. It must never be a check-then-delete in the caller, which has the same window r5
had. That operation is not written yet; tile#122 adds it next to `pointHost`.

🔴 `--remote` is not optional. Without it wrangler writes to the local miniflare simulator and
reports success, so a "deployed" change silently never leaves the machine.

## Notes

The three hand-built cards, who they belong to, which of them can be regenerated and which was
authored by hand — all of that moved to `lab/` with the cards themselves on 2026-08-12. It is a
record of our customers, so it lives in our workspace and not in a package that may be published.
