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

1. **Create the custom hostname** with `ssl.method = txt`, and give the creator the two TXT records:
   `_cf-custom-hostname` (ownership) and `_acme-challenge` (certificate).
2. **Wait for `ssl.status: active`.** This is the gate. The certificate issues *before* any traffic
   moves, so the switch has no TLS gap.
   🔴 `status` stays `pending` with *"custom hostname does not CNAME to this zone"* the whole time.
   That is not a failure — the hostname only goes `active` once DNS actually points here.
3. 🔴 **Add the host to `VANITY` in card-worker.mjs, and deploy.** See below.
4. The creator points their apex at `saas.feelreef.com`, **proxied** — the same shape as whatever
   CNAME they had before.

## 🔴 Three things that went wrong the first time

**The apex 404'd on a working path.** Everything above was correct and `<their-domain>/<handle>`
returned 200 — but `<their-domain>/` returned the *directory* page, because `resolveHandle` found no
entry and no path segment. The plumbing was perfect and nothing pointed her home page at her card.
**Adding the host to `VANITY` is a step, not an afterthought.**

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
