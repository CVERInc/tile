# sponsor — the amount block

A visitor picks or types an amount and presses one button. That is the whole surface.

## Why it is not the `cta` section

Owner ruling, feelreef 金流表面主線 **D6a**. A generic action button has a destination and no
state; a sponsor block has an **amount** — a field somebody types into, a few suggested values, a
default the owner picked, and bounds. None of those grow out of a link, and the amount is the whole
shape of the thing, so it is its own coral rather than a `cta` wearing a costume.

## What it sends

It collects an amount. It does not implement a payment anything. On the press it POSTs to the
feelreef backend and follows the link the backend hands back:

```
POST <data-api-base>/api/v2/shop/sponsor
Content-Type: application/json

{
  "guild_id":           "site_…",                      // data-guild-id — who receives it
  "amount":             "500",                          // canonical decimal string, MAJOR units
  "currency":           "TWD",                          // ISO 4217, data-currency
  "redirect_url":       "https://site/page?dc_sponsor=done",   // omitted if the page has no location
  "client_request_ref": "0f1e…"                         // idempotency token, stable per amount
}

→ 200 { "url": "https://…" }   the coral navigates there
→ 403 { "error": "checkout_module_not_activated" }
                               the button comes back and the block says payments are not on yet
→ anything else                the button comes back with the generic error; nobody is sent anywhere
```

When the site's free `checkout` module is not active, the backend returns the specific 403 above.
The coral then says **“This site hasn't turned on payments yet.”** rather than presenting that
expected setup state as a generic failure. A site can localise or replace the sentence with
`data-not-activated-label`, following the same pattern as `data-error-label`:

```html
<div data-dynamic-coral="sponsor" data-not-activated-label="這個網站還沒開通收款"></div>
<div data-dynamic-coral="sponsor" data-not-activated-label="このサイトはまだ決済を有効にしていません"></div>
```

Only the exact `403` plus `checkout_module_not_activated` response selects this sentence. Every
other unsuccessful response continues to use `data-error-label` (or its existing default).

🔴 **`data-api-base` is required, and there is no default.** It used to fall back to
`https://feelreef.com`, and that address answers this route on no deployment that exists: the front
door there is a Pages app naming no `/api/v2/shop/*` route of its own, a path it does not name falls
through to the legacy Python backend, and that backend carries `catalog`, `catalog/item` and `cart`
under this prefix and no `sponsor`. The serving plane that does answer it sits on its own hostname,
a different one per environment — a fact about where the *site* was deployed, which a coral cannot
know and must not guess. So the attribute is the only source of the origin, and a trailing slash on
it is treated as typing.

A mount that does not name one therefore does not render a button. It says the block is not set up
and marks its container `data-dc-sponsor-unmounted="data-api-base"` — the same honest degrade a
mount with no `data-guild-id` gets, and each names which attribute it refused over, because the two
send whoever built the page to different places. The alternative was a button that collects an
amount, posts it to a 404, and reads as a backend outage to the visitor while reading as a working
block to everyone else.

🔴 **`amount` is major units as a string, deliberately.** TWD and JPY have no minor unit, so a
browser that "helpfully" multiplied by 100 would ask for a hundred times the money the first time a
zero-decimal currency showed up. The coral does not know the rail or its exponent; the backend does,
and converts there.

🔴 **Which rail the money lands on is not decided here.** The backend routes it to whatever the site
owner connected. Adding a rail must never mean editing this coral.

## The deep link

`?amount=500` on the page URL starts the field at 500 — that is how "sponsor me NT$500" travels as a
link (feelreef 金流表面主線 **D23**). `data-amount-param` renames the parameter.

🔴 **The URL prefills the field, and that is the entire extent of its authority.** Anyone can write
that URL. The amount that is actually charged is read back out of the field at the moment of the
press and re-validated there, so a visitor who types over the prefill overrides the link completely,
and a link carrying nonsense simply does not prefill. All of that happens in a browser the sender of
the link may control, so it is honesty about which value is the real one, not a security property:
the server re-validates the amount it receives before minting anything.

`sponsor-mount.test.mjs` presses the button with a link saying 500 and a field edited to 120, and
asserts on what left over the wire. It also runs a deliberately wrong mount through the same fixture
and requires it to be caught — a harness that cannot fail would not be evidence.

## Shape

`sponsor-core.mjs` is the brain: amounts, config, markup, the mount, the request. `sponsor-client.mjs`
is the few lines that find `[data-dynamic-coral="sponsor"]` and hand each one over. `sponsor.js` is
BUILT from those two — do not edit it. `fake-dom.mjs` is a test fixture and never ships.

Publishing is the registry chain, not a copy: bump `package.json` → `node ../build.mjs sponsor` →
repoint `../registry/manifest.json` → `../registry/deploy.sh`. Reaching a live site also needs the
runner image rebuilt (`runner-deploy.yml` takes a `tile_lab_ref`); a reef deploy does not carry it.
