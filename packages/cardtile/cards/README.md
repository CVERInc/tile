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
| `vanity:<host>` | handle | a pointer only: which handle to look at. Shared, never generation-scoped | **only `HostBindings`**, the Durable Object named `<host>` |
| object storage `host` (inside `HostBindings`) | `{ seq, landed, owner, ended }` | the truth for `<host>`: who owns it, which lifetimes ended | only that object |

The renderer follows the pointer, reads that handle's `gen:`, and serves the host only if the
`vanitybind:` key of that generation exists. Readers read KV only and never call the object; if
KV and the object's storage disagree, the object is right and the next bind or end rewrites KV.

The protocol (r7, codex r6). The object is TOLD when a lifetime ends; it never reads KV:

1. `bindVanity` takes a ticket from the object (`/admit`), reads `gen:`, writes the two lifetime keys, then asks the object to point (`/point`).
2. The object refuses a lifetime it was told ended (`stale_generation`) and a ticket older than the last one it wrote (`superseded`); otherwise it records the owner, then writes `vanity:<host>`.
3. DELETE sends `/end` (every generation it saw) to every host its `vanitybind:`/`vanityof:` keys name; each object records them and clears the pointer if its owner is one. DELETE rotates `gen:` only after every end answered, and otherwise answers 503 and rotates nothing.
4. So a bind admitted in an ended lifetime never overwrites a later binding: the ticket stops one that started before the replacement, and the end stops one admitted later where `gen:` was still cached.

🔴 Why (codex r5, r6): r5 re-read `gen:` beside the put in the caller; r6 moved that re-read into the
object's queue. Both asked KV, which answers each location from a cache. A bind of `a`, held while
`a` was deleted and `b` bound the host, landed after `b` and pointed the domain back at `a`. The
domain went 404 for good, and `card.feelreef.com/b` kept 301ing into it. With `HOST_BINDINGS`
unbound, `bindVanity` refuses and writes nothing. The object's `ended` set keeps a day of
entries, at most 512 per host, and only for handles bound to that host.

By hand, the same order, pointer LAST. This is allowed only while no deployed route calls
`bindVanity`, because then the person typing is the host's only writer. A hand pointer is outside
the object: it never learns the owner, so a DELETE's end will not clear that pointer. The pointer
stays inert, because DELETE removes the `vanitybind:` key. Once tile#122's PUT is live, a hand
`put vanity:<host>` is a second writer. Bind through the API instead.

    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanitybind:<handle>:<gen>:<host> <handle>
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanityof:<handle>:<gen> <host>   # omit for no redirect
    npx wrangler kv key get --remote --namespace-id=<CARDS id> gen:<handle>   # still <gen>? if not, stop: the card was deleted
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanity:<host> <handle>

A binding made before generations (`vanity:<host>` plus a bare `vanityof:<handle>`) belongs to
generation 0. In generation 0 the pointer alone binds. After the handle's first DELETE it never
does again, and that DELETE ends generation 0 on the host the bare `vanityof:` names. Never copy
an old binding into a later generation's keys: if a DELETE missed it, that hands the former owner's
domain to the next owner.

What this does not close:
- A bind admitted after the DELETE, from a location still caching the old `gen:`, for a host the DELETE's listings did not show. No end reached that host, and its ticket is the newest, so it can point the domain at the deleted handle. The domain then 404s until it is bound again; it never serves the wrong card.
- A fresh bind of a deleted handle (its next, empty lifetime) is an ordinary bind and takes the host. Whether it may is the caller's authorisation question, not this object's.

Neither has been measured live.

**Deploying (the ship step: the release owner).** The next production deploy of cardtile carries a
Durable Object migration (`[[env.production.migrations]]`, tag `v1-host-bindings`,
`new_sqlite_classes = ["HostBindings"]`; see `serve/wrangler.example.toml`). The class keeps the
r6 name and tag. If r6's migration was already deployed, there is nothing new to migrate, and its
objects start from empty storage. Copy into the real config:

1. Under `[env.production]`: the `HOST_BINDINGS` binding and the migration, exactly as in the
   example. Do not edit or reuse the tag after it has been deployed.
2. At the top level (the preview Worker): `HOST_BINDINGS` with `script_name = "cardtile"`. Both
   Workers write one CARDS store, so they must share production's objects. A namespace of their
   own would give each host two writers.
3. Deploy production first (`npx wrangler deploy --env production`), then preview. Preview's
   binding names a class that exists only after production's migration.
4. Rollback: redeploying the previous code without the binding is safe for reads, because readers
   read KV only. Never deploy a `deleted_classes` migration while any route calls `bindVanity`.
   It erases every host's owner, tickets and ended lifetimes, and a bind in flight across that can
   roll a domain back.
5. From r7 on, DELETE of a card with a domain binding needs the object. If it cannot reach the
   object, it answers 503 and deletes nothing.

No route calls `bindVanity` in this repo today, so before tile#122 the deploy changes nothing a
visitor sees. The only exception is that DELETE of a card with a hand-made binding now calls the
object.

**tile#122's PUT `/_api/vanity/<handle>`** must call `bindVanity(env, handle, host)` and nothing
else: no direct `vanity:`/`vanityof:` writes. Answer 409 when it returns `stale_generation` or
`superseded`.

Its unbind deletes the current generation's `vanitybind:`/`vanityof:` keys itself. If it also
removes the pointer, it does so through a new object operation (`/unbind`, next to `point`):
- Take a ticket like a bind.
- Clear the owner and the KV pointer only if the owner is exactly `{ handle, gen }` and the ticket is not older than `landed`.
- Record nothing in `ended`: the lifetime goes on, and it may bind the host again.

It must never be a check-then-delete in the caller. That operation is not written yet.

🔴 `--remote` is not optional. Without it wrangler writes to the local miniflare simulator and
reports success, so a "deployed" change silently never leaves the machine.

## Notes

The three hand-built cards, who they belong to, which of them can be regenerated and which was
authored by hand — all of that moved to `lab/` with the cards themselves on 2026-08-12. It is a
record of our customers, so it lives in our workspace and not in a package that may be published.
