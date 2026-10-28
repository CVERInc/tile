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
write `gen:<handle>` by hand either. It is a cache of the handle's `CardLifetime` object, which
writes it at the end of each DELETE. A hand value there takes the card down and disagrees with
the object, which then refuses every bind until the next DELETE rewrites it.

A domain binding lives under the same generation's keys (reef#2618 r5 — see `vanityKey`). Two
Durable Objects hold the facts KV cannot be trusted with (r8):

| key | value | meaning | who writes it |
|---|---|---|---|
| object storage `life` (inside `CardLifetime`, one per handle) | `{ gen, hosts, pending, seq, inverse, lost, cache, adopted, legacy, dropLegacy }` | the truth for `<handle>`: its generation, the hosts bound in it, the ends still owed, (r9) which accepted host is its address, and (r10) what the bare legacy inverse named when it adopted it | only that object |
| `gen:<handle>` | generation | the cache of `life.gen` that readers and saves use | **only `CardLifetime`**, at the end of each DELETE |
| `vanitybind:<handle>:<gen>:<host>` | handle | in this lifetime, `<host>` serves `<handle>` | `bindVanity`, in the caller, after it registered |
| `vanityof:<handle>:<gen>` | host, or (generation 0) empty | in this lifetime, the canonical address 301s to `<host>`; empty = no address. Once present it is the reader's whole answer (r10) | **only `CardLifetime`** (r9), the cache of `life.inverse`, written only after `HostBindings` accepted (not for `redirect: false`); since r10 also when the object adopts, and on a loss |
| `vanityof:<handle>` (bare, legacy) | host | a pre-generation inverse: generation 0's, read only while `vanityof:<handle>:0` is absent | nobody writes it any more. **Owned by `CardLifetime`** (r10): adopted (read once) the first time the object needs the inverse in generation 0, deleted when that host is lost, and by DELETE |
| object storage `host` (inside `HostBindings`, one per host) | `{ seq, landed, owner, ended, cache, losers, adopted }` | the truth for `<host>`: who owns it, which lifetimes ended, and (r10) whether its legacy pointer was adopted | only that object |
| `vanity:<host>` | handle | a pointer only: which handle to look at. Shared, never generation-scoped | **only `HostBindings`**, the cache of `host.owner` |

The renderer follows the pointer, reads that handle's `gen:`, and serves the host only if the
`vanitybind:` key of that generation exists. If KV and an object's storage disagree, the object is
right (rule B below).

**A reader that misses** `vanity:<host>` on a creator's domain (r9) asks `HostBindings(host)` once
(`/owner`, via `hostOwner`) and routes by its answer. That call also makes the object reconcile KV,
so the next read hits. A hit is never re-checked against the object: the cache can be behind only
by a pending retry, and a pointer to an ended lifetime is inert anyway. Our own hosts (`routesByPath`)
never ask. Any failure reads as unbound, which is what a miss meant before. Cost: one object call per
request to an unbound creator domain.

**Rule A — publish only what was accepted (r9, codex r8 #1).** Nothing public is written between
`/register` and `HostBindings` accepting the bind. The binding key is not public (it is honoured only
behind a pointer naming the handle). The inverse is: canonical `/<handle>` 301s to it. So after
`/point` answers `accepted`, `bindVanity` asks `CardLifetime(handle)` to `/confirm`, and the object
publishes the inverse only if
- it is still that lifetime,
- no bind registered after this one has already been published for another host (`order`, from `/register`),
- the host was not taken from this handle after this bind's ticket (`lost`, below), and
- (r12) for the host it already names, the inverse's ticket only goes up: an older acceptance never overwrites a newer one, and a same-owner no-op at `/point` answers with the owner's ticket, not its own.
- (r13) that newest ticket is kept per host for the lifetime (`highWater`), so an older acceptance of a host stays unpublished even after the inverse moved to another host.

A refused bind (`expired`, `superseded`, `stale_generation`) never reaches `/confirm`, so the
previous redirect stands. A late confirm never clobbers a newer accepted host. r8 wrote the inverse
before `/point`: a refused bind 301'd `/a` to another card's domain, or to a 404.

**Rule B — the durable owner is the truth; KV is a cache the object reconciles (r9, codex r8 #2).**
- `HostBindings`' storage write of the new `owner` IS the acceptance. The KV pointer put after it is write-through.
- If that put fails, the object still answers `accepted`, with `cache: 'pending'`, and keeps `pending` in its storage.
- It retries by its alarm (`CACHE_RETRY_MS`, 5 s; the runtime calls `alarm()`), and sooner on ANY request it gets: every `/admit`, `/point`, `/end` and `/owner` first re-puts a pending pointer from `owner`.
- The object knows that KV differs because it recorded the failure, not by reading KV (r6: an object reading KV reads a cache).
- `CardLifetime` does the same for `vanityof:`.

So when a's bind is accepted on a host b held, b's binding WAS superseded. A DELETE of a then
clearing the pointer is correct, and `bindVanity` reports success, not 500. r8 answered 500 here
while the owner already named a; DELETE of a then removed the pointer b was still served under.

**Losing a host.** When `/point` replaces an owner, the previous owner goes into `losers`, and the
object tells that handle's `CardLifetime` (`/lost`, retried like the pointer). If that host is the
card's inverse, the object clears it, and canonical `/<loser>` serves its own page again, never a
301 into another card's domain or into a 404. `HostBindings` calls `CardLifetime`, never the other
way, so the two queues cannot wait on each other.

**A legacy inverse is part of the lifetime (r10, codex r9).** r9 cleared only `vanityof:<loser>:0`;
the reader then fell back to the bare `vanityof:<loser>`, and `/<loser>` 301'd to the other card's
domain, and to a 404 once that card was deleted. Three rules, each inside an authority that already
existed:
1. **Losing a host clears every inverse that names it.** `CardLifetime`'s `/lost` clears its own
   inverse and, when the bare legacy key named that host, deletes the bare key too (after writing the
   tombstone below, so no reader sees the bare key alone).
   (r11) A `/lost` carries the ticket of the acceptance that displaced the handle (retries keep it), and the inverse keeps the ticket of the acceptance that wrote it.
   It is cleared only if `inverse.ticket < loss ticket`: a retried notice about an older take never clears a newer rebind of the same host.
2. **An authoritative "none" is not a missing key.** In generation 0 the object writes "no address"
   as an EMPTY `vanityof:<handle>:0` instead of deleting it. The reader (`boundHostOf`) asks the bare
   key only when the generation-0 key is ABSENT, i.e. no lifetime has ever spoken for the handle.
   Present means it is the whole answer; empty means none. A failed bare delete is therefore harmless
   until the object's retry removes it.
3. **A legacy owner is adopted before it is replaced.** A host bound before generations has a KV
   pointer and no durable owner. Its first accepted `/point` reads that pointer once and makes the
   handle the owner at generation 0, so the ordinary loser notice reaches it. Likewise
   `CardLifetime` reads the bare inverse once, the first time it needs the inverse in generation 0
   (`/register`, `/confirm`, `/lost`), adopts its host as its own and writes the generation-0 key.
   Both reads are of keys nothing writes any more, and both are flagged `adopted` so the object never
   reads the cache it writes. Readers never adopt: `/owner` does not, and the renderer reads KV only.

The protocol (r8, codex r7). No lifetime fact is read from KV on a write path:

1. `bindVanity` takes a ticket from `HostBindings(host)` (`/admit`).
   - It then registers with `CardLifetime(handle)` (`/register`), naming the generation it means.
   - The object refuses a generation that is not the current one (`stale_generation`). Otherwise it records the host under that generation.
   - Only then does the bind write its `vanitybind:` key and ask `HostBindings` to point (`/point`).
   - Only once that is accepted does it ask `CardLifetime` to publish the inverse (`/confirm`, rule A).
2. `HostBindings` refuses three kinds of `/point`:
   - a ticket older than `TICKET_TTL_MS` (60 s; `expired`);
   - a lifetime it was told ended (`stale_generation`);
   - a ticket older than the last one it wrote (`superseded`).

   Otherwise it records the owner (the acceptance) and the loser, then writes `vanity:<host>` (rule B).
3. DELETE asks `CardLifetime` to end (`/end`).
   - The object rotates the generation in its own storage FIRST. It then answers with every host registered under the ended generation, plus any end an earlier DELETE still owes.
   - DELETE sends `/end` to each of those `HostBindings`. Each records the lifetime as ended, and clears the pointer if its owner is that lifetime.
   - Only when every end has answered does DELETE call `/settle`. The object drops what was delivered and writes the `gen:` cache; then DELETE removes the lifetime's KV keys.
   - No KV listing is used to find a host.
4. `ended` entries are kept exactly `TICKET_TTL_MS`, with no count cap. A bind that can still land took its ticket less than that long ago. Its end was recorded after its ticket, so that entry is still there.

Why this is airtight (the four lines):
- A bind registers its host before it checks anything; the check is the registration itself, one turn of the handle's object.
- DELETE reads the host list after it rotates, in that same object, so every registration that passed is on the list.
- Every bind on the list gets an end before DELETE touches KV. One that reaches its host after the end is refused; one that reached it before is cleared.
- Any bind that checks after the rotation is refused, and a bind that outlives its ticket is refused whatever the `ended` set still holds.

🔴 Why (codex r5, r6, r7):
- r5 and r6 asked KV whether `gen:` was current. A cached view let a's held bind point the domain back at a after b had bound it.
- r7 told each host when a lifetime ended, but it found the hosts by listing `vanitybind:a:` / `vanityof:a:`. A listing that had not caught up ended no host. A bind of a admitted after b's then took the domain: 200 → 404 → 404 after convergence, while `card.feelreef.com/b` kept 301ing into it.

With `HOST_BINDINGS` or `CARD_LIFETIMES` unbound, `bindVanity` refuses and writes nothing.

If a host does not acknowledge its end, DELETE answers 503.
- The lifetime has already ended in `CardLifetime`, so no bind of it can register.
- KV is untouched: `gen:` still names the old generation, and the card still serves.
- The host stays in `pending`, and a retry of the DELETE delivers its end. The retry rotates once more, which ends nothing anyone can see.

A DELETE names the lifetime it is about (reef#2618 r4). The caller reads `GET /_api/card/<handle>/lifetime` (`{ handle, gen }`, from `CardLifetime`) in the same step as its ownership check, and sends that value as `If-Generation`. When it is not the current generation, DELETE answers 412 `stale_generation` and writes nothing. It is checked once, by `/end` in the object's own turn, and DELETE writes no key before that answer: the `gone:` marker comes right after it (still before `gen:` moves and before any body goes). `/lifetime` only reads: it never reconciles a pending inverse (that waits for the object's alarm or its next write), and neither does a refused `/end` (r15). A retry reads the generation again (after a 503 the object has already rotated, so the new value is the one to send).

By hand, the same order, pointer LAST (and the inverse after it, rule A).
A hand `vanityof:` is unknown to `CardLifetime`: its next accepted bind overwrites it, and a lost host does not clear it. This is allowed only while no deployed route calls
`bindVanity`, because then the person typing is the host's only writer. A hand binding is outside
both objects. `CardLifetime` never registered its host, so a DELETE never sends it an end, and its
pointer stays behind. It is inert: the renderer needs a `vanitybind:` key of the current
generation, and the DELETE rotated it. Once tile#122's PUT is live, a hand `put vanity:<host>` is a
second writer. Bind through the API instead.

    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanitybind:<handle>:<gen>:<host> <handle>
    npx wrangler kv key get --remote --namespace-id=<CARDS id> gen:<handle>   # still <gen>? if not, stop: the card was deleted
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanity:<host> <handle>
    npx wrangler kv key put --remote --namespace-id=<CARDS id> vanityof:<handle>:<gen> <host>   # omit for no redirect

A binding made before generations (`vanity:<host>` plus a bare `vanityof:<handle>`) belongs to
generation 0. In generation 0 the pointer alone binds. After the handle's first DELETE it never
does again. No object knows that host until someone binds it (then it is adopted, rule 3 above), so
a DELETE of a legacy owner that never rebound sends no end, and a bind that still means generation 0
is refused by `CardLifetime`. Never copy an old binding into a later generation's keys: that hands
the former owner's domain to the next owner.

What this does not close:
- A fresh bind of a deleted handle (its next, empty lifetime) is an ordinary bind and takes the host. Whether it may is the caller's authorisation question, not either object's.
- A bind of the live card is refused (`stale_generation`) in two windows: between a DELETE's rotation and its `/settle`, and wherever a location still caches the old `gen:`. It stays refused until the cache catches up. That is the safe direction, and a retry succeeds.
- A hung storage or KV call inside an object stalls that handle's or host's queue. There is no timeout. Since r9 a `HostBindings` turn that replaces an owner also waits on the loser's `CardLifetime`.
- While a write-through is pending, a KV HIT can be behind the object for up to one retry: the domain may serve the previous owner for that long (a miss asks the object and is right).
- A bare `vanityof:<handle>` whose handle never meets a `CardLifetime` (never binds, never loses a host) is read as before. Whether it is still true is the legacy data's question: nothing that happens through the objects can make it stale without clearing it.
- An empty generation-0 tombstone outlives the handle's first DELETE when no host was registered (DELETE's listing of `vanityof:<handle>:` normally removes it). It is never read again: later generations do not fall back.

None of this has been measured live.

**Deploying (the ship step: the release owner).** The next production deploy of cardtile carries
two Durable Object migrations (see `serve/wrangler.example.toml`):
- `v1-host-bindings`: `new_sqlite_classes = ["HostBindings"]`, unchanged since r6;
- then `v2-card-lifetime`: `new_sqlite_classes = ["CardLifetime"]`, new in r8.

CardLifetime gets its own tag instead of joining v1, because Cloudflare applies a tag once and
never again. A tag that might already be deployed must not change, and whether v1 has gone out
cannot be known from this repository. A new tag is right either way: if v1 is deployed, only v2
runs; if not, both run in order.

Copy into the real config:

1. Under `[env.production]`: both bindings (`HOST_BINDINGS`, `CARD_LIFETIMES`) and both migrations, exactly as in the example. Do not edit or reuse a tag after it has been deployed.
2. At the top level (the preview Worker): both bindings, with `script_name = "cardtile"`.
   - Both Workers write one CARDS store, so they must share production's objects.
   - A namespace of their own would give each host two writers and each handle two lifetimes.
3. Before the first deploy, check that `npx wrangler kv key list --remote --namespace-id=<CARDS id> --prefix gen:` is empty.
   - An object with empty storage is generation 0, which is right only if nothing ever wrote a `gen:` key.
   - If the list is not empty, stop and ask: each such handle needs its object seeded first.
4. Deploy production first (`npx wrangler deploy --env production`), then preview. Preview's bindings name classes that exist only after production's migrations.
5. Rollback: redeploying the previous code without the bindings is safe for reads, because readers read KV only.
   - Never deploy a `deleted_classes` migration for either class while any route calls `bindVanity` or DELETE.
   - It erases every handle's lifetime, or every host's owner, tickets and ended lifetimes. A bind in flight across that can roll a domain back.
6. r9 needs no new binding or migration. Both classes now have an `alarm()` handler (SQLite-backed objects support alarms), and `HostBindings` calls `CardLifetime` through the same `CARD_LIFETIMES` binding the Worker has.
   - So both Workers need both bindings (step 1 and 2), as before.
   - Rolling back to r8 code leaves a pending cache unretried until the next bind or end on that object; storage written by r9 (`cache`, `losers`, `inverse`, `lost`, `seq`) is ignored by r8.
   - r10 needs no binding or migration either. Its new storage fields (`adopted`, `legacy`, `dropLegacy`) are ignored by r9 code, and an empty `vanityof:<handle>:0` reads as "no redirect" there too (r9's reader returns a present empty value without asking the bare key, and the renderer treats it as no host). Rolled back, the objects delete that key on the next change instead of writing it empty, so the r9 finding returns for any legacy owner that loses a host afterwards.
7. From r8 on, EVERY DELETE needs `CARD_LIFETIMES`. A DELETE whose lifetime has a registered host needs `HOST_BINDINGS` as well.
   - Without them DELETE answers 503 and deletes nothing.
   - The gone marker may already be written, but it is invisible while the body exists.

No route calls `bindVanity` in this repo today, so before tile#122 the deploy changes nothing a
visitor sees. The one exception: every DELETE now calls `CardLifetime`.

**tile#122's PUT `/_api/vanity/<handle>`** must call `bindVanity(env, handle, host, { gen })` and
nothing else: no direct `vanity:`/`vanityof:`/`gen:` writes.
- `gen` is the generation of the card the request checked exists (`liveCard(...).gen`), so the binding is of that lifetime or of none.
- Answer 409 when it returns `stale_generation`, `superseded` or `expired`.
- An accepted answer may carry `cache: 'pending'` or `redirect_cache: 'pending'`: that is success (the object retries the KV write). `redirect: 'not_published'` means a newer bind holds the card's address, or the host was taken meanwhile.

Its unbind deletes the current generation's `vanitybind:` key itself. The inverse is `CardLifetime`'s since r9: clearing it goes through that object (the same path as `/lost`), never a direct `vanityof:` delete. It leaves the
`CardLifetime` registration alone: an extra host on DELETE's list costs one end, which clears
nothing it does not own. If the unbind also removes the pointer, it does so through a new
`HostBindings` operation (`/unbind`, next to `point`):
- Take a ticket like a bind.
- Clear the owner and the KV pointer only if three things hold: the owner is exactly `{ handle, gen }`, the ticket is not older than `landed`, and the ticket has not expired.
- Record nothing in `ended`: the lifetime goes on, and it may bind the host again.

It must never be a check-then-delete in the caller. That operation is not written yet.

🔴 `--remote` is not optional. Without it wrangler writes to the local miniflare simulator and
reports success, so a "deployed" change silently never leaves the machine.

## Notes

The three hand-built cards, who they belong to, which of them can be regenerated and which was
authored by hand — all of that moved to `lab/` with the cards themselves on 2026-08-12. It is a
record of our customers, so it lives in our workspace and not in a package that may be published.
