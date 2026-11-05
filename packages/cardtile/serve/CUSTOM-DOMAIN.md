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
3. 🔴 **Bind the host to the card without the redirect:** `PUT /_api/vanity/<handle>`
   `{"host": "<their-domain>", "redirect": false}`. The domain then serves the card (answering
   `X-Card-Handle: <handle>`), and `card.feelreef.com/<handle>` keeps answering. See below.
4. The creator points their apex at `saas.feelreef.com`, **proxied** — the same shape as whatever
   CNAME they had before.
5. Once a request to the domain answers with that `X-Card-Handle`, turn the redirect on:
   `PUT … {"host": "<their-domain>", "redirect": true}`. The canonical address now 301s there.

reef's `connect_card_domain` runs these steps; by hand, use the same calls (the bearer of `/_api/`).

## The binding: `/_api/vanity/<handle>`

Behind the same bearer as the rest of `/_api/`. Errors are codes (`{"error": "<code>"}`).

| call | success | refusals |
|---|---|---|
| `GET` | `{handle, host\|null, redirect, invalid_host?, inconsistent?}` | 404 `card_not_found` |
| `PUT {host, redirect?=true, expect?}` | `{handle, host, redirect, changed}` | 400 `vanity_host_invalid` / `vanity_redirect_invalid` / `vanity_expect_invalid` · 404 `card_not_found` · 409 `vanity_state_inconsistent` / `vanity_state_changed` / `{vanity_taken, held_by}` · 503 `vanity_unconfirmed` |
| `DELETE {expect?, host?}` | `{handle, host:null, changed}`; with `host`: `{handle, host\|null, changed, orphan_removed}` | 400 `vanity_expect_invalid` / `vanity_host_invalid` · 409 `vanity_state_changed` / `{vanity_taken, held_by}` · 503 `vanity_unconfirmed` |

All three: 400 `handle_invalid`, 405 `method_not_allowed`, 503 `vanity_unavailable` (the Durable
Objects are not bound).

- **Every write goes through the card's lifetime** (`../cards/README.md`, "who writes each key"):
  `bindVanity` to bind, `releaseVanity` to unbind. The route writes no key itself.
- **PUT is declarative.** The body is what the binding should be. A different host: the old one is
  released first (its redirect before it), then the new one is bound. `redirect` alone: the same host
  is bound again with or without the redirect. The same state: `changed: false`, nothing written.
- **`vanity_taken`** (`held_by` = the card holding the host): the host's Durable Object refuses to
  give it to another card, in its own turn. A host that was bound by hand before the objects is held
  by its pointer's handle. The holder frees it with `DELETE {host}`.
- **`expect`** (`{host, redirect}`, as GET returned it): 409 `vanity_state_changed` when the binding
  moved. It narrows a lost update and does not prevent one; the caller serialises. A call carrying
  `expect` that died halfway is refused on resend: re-read GET and decide again.
- **409 `vanity_state_changed` also means** a newer bind or release of the same card won, the card
  was deleted while the call ran, or a bind outlived its 60 s ticket. Nothing this call wanted landed.
- **503 `vanity_unconfirmed`:** an object did not answer partway. What landed is safe (the redirect is
  withdrawn before a host lets go, and published only after a host is bound). Send the same call again.
- **`inconsistent`:** the card holds two hosts (unserialised PUTs), or its redirect names a host it
  does not hold. PUT refuses; `DELETE` releases everything and is the repair.
- **`invalid_host`:** a host bound by hand that the route would refuse. DELETE, or a PUT to a valid
  host, releases it. The worker never 301s to such a host.
- **A card's DELETE** ends its binding with its lifetime. The next card under the handle starts unbound.

## 🔴 Three things that went wrong the first time

**The apex 404'd on a working path.** Everything above was correct and `<their-domain>/<handle>`
returned 200 — but `<their-domain>/` returned the *directory* page, because `resolveHandle` found no
entry and no path segment. The plumbing was perfect and nothing pointed her home page at her card.
**Binding the host is a step, not an afterthought.** (Then it was a hand-edited `VANITY` table; now it
is step 3.)

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
