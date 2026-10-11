# Putting a creator's own domain on their Card

First done 2026-07-29 for a creator's own domain, which is where every 🔴 below comes from.

## Why it is not a Custom Domain

Cloudflare Workers Custom Domains are explicit:

> You cannot create a Custom Domain on a hostname with an existing CNAME DNS record **or on a zone
> you do not own**.

A creator's zone lives in **their** Cloudflare account. Ours is `8af2`. So the mechanism is
**Cloudflare for SaaS** (custom hostnames), enabled on `feelreef.com`.

🔴 The alternative — asking a creator to move their DNS to us — is rejected on principle, not on
difficulty. Portaly asks them for one CNAME. A platform that demands custody of their domain (and
with it their MX records) is worse than the one they are leaving. **Their domain stays theirs.**

## Our side (once per platform, already done)

| | |
|---|---|
| entitlement | Cloudflare for SaaS on `feelreef.com`. Free/Pro/Business include **100 custom hostnames**; $0.10 each beyond. Self-serve, but it **requires payment information** — the API returns `1404 No quota has been allocated` until someone clicks Enable. |
| fallback origin | `saas.feelreef.com` — an **originless** `AAAA 100::`, proxied |
| route | `saas.feelreef.com/*` → `cardtile`. A plain Worker **route**, NOT a custom_domain. |

Both are routes on the Worker — see `wrangler.example.toml` for the shape; the real one lives in
the private workspace. The fallback origin is independently testable —
`https://saas.feelreef.com/<handle>` serves any card without a creator's domain being involved,
which is how the whole path was proven before anyone's DNS moved.

## Per creator

**Certificate active ⇒ bind (no redirect) ⇒ the creator points DNS ⇒ hostname active ⇒ redirect on.**

1. **Create the custom hostname** with `ssl.method = txt`, and give the creator the two TXT records:
   `_cf-custom-hostname` (ownership) and `_acme-challenge` (certificate).
2. **Wait for `ssl.status: active`.** This is the gate. The certificate issues *before* any traffic
   moves, so the switch has no TLS gap.
   🔴 `status` stays `pending` with *"custom hostname does not CNAME to this zone"* the whole time.
   That is not a failure — the hostname only goes `active` once DNS actually points here.
3. 🔴 **Bind the host to the card, WITHOUT the redirect:** `PUT /_api/vanity/<handle>` with
   `{"host": "<their-domain>", "redirect": false}` (or the reef tool that calls it). Same bearer as
   the rest of `/_api/`; no deploy. From here their domain *is* the card the moment DNS reaches us,
   so the apex never shows the directory page (see below), and `card.feelreef.com/<handle>` keeps
   answering, because nothing points it at a domain that does not reach us yet.
4. The creator points their apex at `saas.feelreef.com`, **proxied**: the same shape as whatever
   CNAME they had before.
5. **Wait for the hostname's `status: active`.** That is Cloudflare saying their DNS now reaches us.
   **`X-Card-Handle: <handle>` on `GET /` of their domain is what reef's tool takes as "connected".**
   The worker sends it only on a card served through that domain's binding, with or without the
   redirect, and never on the canonical host, the directory or a 404. Public DNS can't show it: their
   apex is a proxied CNAME, so resolvers see Cloudflare addresses either way.
6. **Turn the redirect on:** the same call with `"redirect": true`. It writes only the redirect, and
   from now on `card.feelreef.com/<handle>` 301s to their domain, which gives the card one address.

The API, for reference:

- `PUT {host, redirect?, expect?}`: `redirect` defaults to `true`. The body says what the binding should be,
  so `false` on a redirecting binding turns the redirect off again. Sending the same body twice is
  `changed: false`. Binding a card to a new host releases its old one (one card, one domain), and
  its old redirect too.
  - `200 {handle, host, redirect, changed}`
  - `409 {"error": "vanity_taken"}`: that host already belongs to another card; nothing was written.
  - `400 {"error": "vanity_host_invalid"}`: lowercase hostname only. No port, path or scheme,
    punycode for non-ASCII names, nothing under `feelreef.com`.
  - `400 {"error": "vanity_redirect_invalid"}`: `redirect` must be `true` or `false`.
  - `404 {"error": "card_not_found"}`: bind after the card exists.
  - `409 {"error": "vanity_state_changed"}`: see `expect`; nothing was written.
- `GET` → `{handle, host, redirect}`. `host` is `null` unless a visitor *at the location that
  answered* would get this card.
- `DELETE {expect?}` → removes the binding in either mode.
- `expect: {host: string|null, redirect: boolean}` (optional, on PUT and DELETE) is the state the
  caller last read from GET. If the binding no longer looks like that, the call writes nothing and
  answers `409 vanity_state_changed`. A malformed `expect` is `400 vanity_expect_invalid`.

🔴 **The caller must serialise changes to one host and to one handle.** Cloudflare KV has no atomic
operation, and a write can take 60 seconds or more to reach other locations. So this API cannot
decide who owns a domain, and two un-serialised calls can silently take a domain from its card or
leave a card on two domains. reef's `connect_card_domain` serialises against its own authoritative
record and sends `expect`; this API is the store-side projection of that decision. GET reflects only
the reads of the location that answered it, and none of this says whether the domain's DNS reaches us.
- The store keys and the write order, including why there are three keys, are in `card-vanity.mjs`.

⚠️ **Superseded:** step 3 used to be "add the host to `VANITY` in card-worker.mjs and deploy". That
map left the code on 2026-08-12 for store keys (`vanity:<host>`, `vanityof:<handle>`), which were
then written by hand until this API existed. Neither is needed now. A binding written that way still
works, and gets the API's record key the next time the API changes it, but **only in the two-key
shape** (`vanity:<host>` + `vanityof:<handle>`). A hand-written forward key with no reverse key
cannot be found from the handle: GET reports the card unbound, DELETE cannot remove it, and binding
the card elsewhere leaves it serving too. Remove such keys by hand before using the API on that card.

## 🔴 Three things that went wrong the first time

**The apex 404'd on a working path.** Everything above was correct and `<their-domain>/<handle>`
returned 200 — but `<their-domain>/` returned the *directory* page, because `resolveHandle` found no
entry and no path segment. The plumbing was perfect and nothing pointed her home page at her card.
**Binding the host (step 3) is a step, not an afterthought.** At the time it was a code change; now
it is one API call, made *before* DNS moves, and skipping it still produces exactly this.

**`www` proxied to `pages.dev` is banned.** A creator's `www` pointing at one of our Pages projects
must be **DNS only**. Orange-cloud CNAME across accounts returns **error 1014, CNAME Cross-User
Banned**. The apex is fine proxied because Cloudflare for SaaS is the sanctioned cross-account path;
`pages.dev` is not.

**Cloudflare's DNS import cannot overwrite.** It is additive only — there is no "overwrite existing
records" option. An import that restates existing records fails every line with *"An identical record
already exists"* and changes nothing. The two CNAMEs must be **edited by hand**.

## What is never touched

The creator's mail. For the first one we did that was seven records — MX ×2, SPF, `apple-domain`,
`sig1._domainkey`, `*._domainkey`, `_dmarc` — and the entire cutover is **two CNAME edits**. Verify
all of them after, from public DNS, not from the dashboard.

## Rollback

Point the CNAMEs back. The certificate stays issued, so it can be redone at any time.
