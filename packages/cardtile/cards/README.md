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

    CLOUDFLARE_API_TOKEN=$(security find-generic-password -w -s cver-cf-kv) \
      npx wrangler kv key put --remote --namespace-id=<CARDS id> <handle> --path=<file>

🔴 `--remote` is not optional. Without it wrangler writes to the local miniflare simulator and
reports success, so a "deployed" change silently never leaves the machine.

## Notes

The three hand-built cards, who they belong to, which of them can be regenerated and which was
authored by hand — all of that moved to `lab/` with the cards themselves on 2026-08-12. It is a
record of our customers, so it lives in our workspace and not in a package that may be published.
