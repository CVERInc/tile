# square-shop — provenance

**The canonical source is the engine** — `packages/dynamic-corals/square-shop/square-shop.js` in
THIS repo, the public `CVERInc/tile`. It moved here from the private incubator on 2026-09-07, when
the ruling landed that the incubator keeps data and deploy config and every piece of code lives in
the engine. A pointer that still sends you to the incubator for this file is stale; there is nothing
there to find. Every other copy is downstream of this one:

| Copy | What it is |
|---|---|
| `<deployment>/registry/versions/square-shop/<x.y.z>/square-shop.js` | the immutable published artifact, written only by `build.mjs`. It lives with the deploy config, not here: a published artifact is serving data. |
| `apps/feelreef/src/lib/dynamic-corals/square-shop/square-shop.js` (repo `reef`) | a **fork**, pinned by sha256 in `vendor-pristine.test.ts` |

---

## 0.11.6 — 2026-08-29 — two of three calls move to the processor-neutral surface

This version publishes drift that had been sitting on `main` unpublished since `012c2d7`
(2026-08-26, from the payment-surface lane, by the collaborating agent). **It is not a wording change** — two of the
coral's three backend calls now address a different API surface:

| # | call | 0.11.5 | **0.11.6** |
|---|---|---|---|
| 1 | catalog read (`fetchCatalog`) | `GET {apiBase}/api/v2/**square**/catalog?guild_id=…` | `GET {apiBase}/api/v2/**shop**/catalog?guild_id=…` |
| 2 | cart checkout (`startCartCheckout`) | `POST {apiBase}/api/v2/**square/catalog/cart**` | `POST {apiBase}/api/v2/**shop/cart**` |
| 3 | instant Buy (`startCheckout`) | `POST {apiBase}/api/v2/square/catalog/checkout` | **unchanged** — still the Square-specific route |

Nothing else in the versioned contract moved, and this was checked rather than assumed: all 34
`data-*` attribute reads/writes are byte-identical to 0.11.5, no default label string moved, the
`export { … }` block is untouched, and no hunk reaches the style block or the `--gd-*` tokens.

### Why the routes are safe to address — verified against production, not inferred

The neutral surface is served *everywhere a site can point `data-api-base`*, which is the whole
question a coral version has to answer. Both backends were probed:

| host | request | result |
|---|---|---|
| the legacy Python backend (the deployment's `apiBase` default) | `GET /api/v2/shop/catalog?guild_id=0` | 200 `{"connected": false, "items": []}` |
| " | `GET /api/v2/shop/cart` | 405 — route exists, POST-only |
| " | control `GET /api/v2/shop/nonsense` | 404 HTML SPA fallback |
| `rsp.feelreef.com` (production RSP) | `GET /api/v2/shop/catalog?guild_id=<a live JP seller>` | **200, connected, 81 items** — the same 81 as `/api/v2/square/catalog`, plus `processor` and `catalog_read` keys |
| " | `POST /api/v2/shop/cart` with `{}` | **400 `lines is required`** — the route exists and validates |
| " | control — a nonsense path | 404 |

The controls are the load-bearing part: an unregistered path answers 404, so the 200/400/405 above
are registered routes and not a catch-all. RSP additionally distinguishes *route* from *tenant* —
`GET /api/v2/shop/catalog?guild_id=0` answers 404 `{"error":"site not found"}` while
`GET /api/v2/shop/banana` answers 404 `{"error":"not found"}`, which is the route existing and
failing to resolve a site, not the route being absent.

### 🔴 Known limitation — Stripe sellers in the default mode

Call #1 moved and call #3 did not, and that produces a state 0.11.5 could not: a seller on **Stripe**
now gets a catalog that renders, with a Buy button that reaches the honest-failure path. On 0.11.5
they got no catalog at all. Instant mode is the **default** (`data-cart` absent), so this is the
out-of-the-box shape for that class of seller.

This is deliberate and the source says so at `square-shop.js:531-545`: the neutral surface registers
exactly `catalog`, `catalog/item` and `cart`. There is no `shop/catalog/checkout`, because RSP's
site routes are `square/catalog-checkout`, `square/catalog-cart-checkout` and
`stripe/catalog-cart-checkout` — single-item cardinality exists for Square and for nothing else.
Closing it is a **backend** change (a `/api/v2/shop/catalog/checkout` route plus a Stripe
single-item sale), or a deliberate decision to fall instant mode through to the cart path. Naming it
here rather than letting a future reader discover it from a support ticket.

### One field grew, and the widget still does not read it

The neutral surface answers `{connected, processor, items}`; `processor` is new. The widget ignores
it — asserted, not assumed, in `stripe-catalog.test.mjs`. It is recorded anyway because this
package's own `description` scopes the version to "the feelreef catalog API shape it consumes".

### The sibling SSR template moved too, and this bump does not cover it

`shop-function-template.js:157` — the `_worker.js` grid emitter, same package directory — made the
same move in the same commit:

```js
-	const path = `/api/v2/square/catalog?guild_id=…`
+	const path = `/api/v2/shop/catalog?guild_id=…`
```

(Its *item* fetch at line 66 was already neutral at 0.11.5; only the list fetch moved.) It is **left
exactly as `main` has it — no source change, and none is wanted.** What is worth writing down is that
it is *not covered by this version*: `build.mjs` publishes only `square-shop.js` into
`registry/versions/square-shop/<v>/`, so the template carries no version stamp, is not gated by the
registry's immutability check, and ships whenever a site's worker is re-emitted by
`emit-shop-function.mjs`. Bumping the coral is therefore not the whole story for this endpoint move,
and no site's worker was re-emitted in the course of publishing 0.11.6.

### What this release does *not* change

`v0` — the channel every site rides by default — stays **0.10.11**, which is on the Square-only
surface for all three calls. No channel was repointed and no site was repinned, so publishing 0.11.6
changes nothing live by itself; it only matters at the moment someone pins a site or moves a
channel, which is exactly when the Stripe-instant gap above bites.

---

## 0.11.5 — 2026-08-29 — two bytes that made this file invisible to grep

`cartRefKey()` joined its parts with **literal** U+0000 and U+0001 control bytes:

```js
.map(([variationId, qty]) => `${variationId}<the raw byte>${qty}`)
.sort()
.join('<the raw byte>');
```

Two bytes, in the largest file in this package. What they cost is not runtime behaviour — it is
every grep-shaped answer *about* this file. `file(1)` classified 53KB of JavaScript as `data`, and
grep, seeing binary input, stops reporting matches: BSD grep prints `Binary file … matches` with no
lines, and ugrep (this machine's grep) returns **nothing at all**, exit 1, no message.

🔴 That is not a hypothetical. It happened while preparing this very change: `grep -n 'mountAll'
square-shop.js` — asked in order to find out whether the mount exports existed — answered `Binary
file matches` for a file that exports them on a line it could have named. Every "is X in here?"
question about this file had been coming back confidently wrong for as long as the bytes were there,
and this file's own §"grep 税込 answers differently depending on who feeds it" is an earlier person
hitting the same wall and writing down the symptom rather than the cause.

The fix is the escape — `\u0000`, `\u0001`. **Identical value at runtime**, so no cart key, no
`client_request_ref` and no stored basket changes; the file simply stays text. `file(1)` now reports
`Unicode text, UTF-8 text`.

### Why it is a published version and not just a source tidy

`square-shop.js` is vendored byte-for-byte into feelreef, and feelreef's `qa-lint` has carried a
`raw-nul-byte` rule since 2026-08-20 — from its own version of this bruise, in `$lib/inbox/store.ts`,
found the same way. Vendoring 0.11.4 tripped that rule immediately. The alternatives there were to
baseline the violation (recording a defect as accepted, in a file that repo is forbidden to edit) or
to fix it where the code actually lives. It lives here.

### Tests

`checkout-ref.test.mjs`, +2 assertions (66 → 68):

- the **value** is unchanged, asserted against explicitly-written escapes rather than by comparing
  `cartRefKey` to itself — a self-comparison is green whatever the function emits, which is exactly
  the check that would let a silent separator change through;
- the **distribution**: the shipped bytes contain no raw U+0000/U+0001. That test file states the
  escapes and never the bytes, so it cannot satisfy its own check.

---

## 0.11.4 — 2026-08-29 — a checkout button that says where it is taking you

Both checkout paths — `startCheckout` (per-item Buy) and `startCartCheckout` (whole-cart Checkout) —
set `btn.textContent = '…'` for the length of the request. That is not a loading state, it is the
button **vanishing**: on a live shop the Checkout button collapsed to three dots and stayed there while
the request ran (measured at up to 36s), and the buyer's honest reading of that is "it broke, do I
press it again?" — on a payment button, at the moment a second press is most tempting.

🔴 The recheck behind this item **overturned its assumed cause**. The theory was a Heroku cold start;
three measurements put the backend at <1.1s. So nothing here tries to make the request faster — the
defect being fixed is that a button said nothing for as long as it took, whatever that turns out to
be. A fast backend does not repair a control that goes blank.

Both paths now go through one `beginPending(btn, label)`, which sets a real sentence, keeps
`disabled`, adds `aria-busy="true"` so a screen reader hears the wait rather than watching a control
go quiet, and adds a `dc-square-shop-pending` class. It returns `settle(label)`, which puts the
original label back and clears all three. The label comes from the new **`data-checkout-pending-label`**
(default `"Taking you to payment…"`), the same `data-*` contract every other string in `readLabels`
uses, so a zh-TW page passes its own and a bare embed stays self-contained in English.

The new CSS rule is one line: `.dc-square-shop-pending { white-space: nowrap; overflow: hidden;
text-overflow: ellipsis; }`. Both buttons are stretched by their container, so a longer label cannot
change their **width** — only wrapping to a second line could change the height. One clipped line
keeps the button exactly the size it was, and hiding the overflow also stops the longer text raising
the card's min-content width.

**The failure path is unchanged.** This file answers a refused checkout in the `role="alert"`
`.dc-square-shop-msg` node (0.11.0's per-status mapping), so both call sites here call a bare
`settle()` and the button simply gets its own label back. `settle(label)` still accepts the optional
override because the **feelreef fork's** copy writes `checkoutError` into the button instead — the
fork has no `-msg` node. Keeping the helper byte-identical across the two files leaves only the call
sites diverging, and they diverge for that real reason. The override is asserted directly on the
exported `beginPending` so it is a pinned contract rather than an untested parameter.

### Where this came from, and what it does NOT reach

Ported from the feelreef fork (reef PR #171, gap sweep 2026-08-28 #22), where it shipped first.
This is the canonical repaying half of the back-port debt that fork's `PROVENANCE.md` records.

🔴 The shop this item was raised about is a **sitetile static embed** of this
widget, and it does **not** get the fix by publishing 0.11.4. It gets it when that embed is
re-vendored to a version that carries this, and it gets the fix in **zh-TW** only when that embed
also passes `data-checkout-pending-label`. Until then its buyers would read the English default.
Neither was done here: no site IR was touched.

### Tests

Extended `checkout-ref.test.mjs`, the file that already drives the real `startCheckout` /
`startCartCheckout`, rather than adding a parallel suite. 36 → **66** assertions.

🔴 Every arm that file already had stubs an **instant** response, which is exactly the shape that
cannot see this: the pending state exists and is over before anything can look at it. That is why the
bare `'…'` sat unmeasured through five versions with the suite green. The new arms hold the response
open and assert **mid-flight** — and assert `sent.length === 1` first, so "pending" means "the POST is
out", not "we got there before it started".

Control runs, each measured before commit, each restored afterwards (`cmp` against the saved copy →
identical):

| arm | reddened |
|---|---|
| `btn.textContent = '…'` restored inside `beginPending` | the 5 label assertions, nothing else |
| `classList.add` dropped | the 2 `-pending`-class assertions |
| `setAttribute('aria-busy')` dropped | the 2 aria-busy assertions |
| the CSS rule deleted from the stylesheet | the 1 distribution check |

The `classList` shim in that test is backed by `el.className` rather than a separate Set, because in
a real DOM they are two views of one string; two stores would let an assertion pass where a browser
diverges.

🔴 There is **no size assertion**, deliberately. The fork's version of this test runs in jsdom and
compares `getBoundingClientRect()` before and during. This file has a hand-rolled fake DOM with no
layout engine at all, so an assertion here that the button "keeps its size" would be measuring
nothing and would read like proof. The size guarantee lives in the CSS rule; what is proved here is
that the rule ships (a **distribution** check, labelled as one in the test) and that the class
reaches the button (driven, mid-flight).

### Channels

🔴 `manifest.json` is **untouched**. `v0` and `latest` still point at `0.10.11`; only a site pinning
`/corals/square-shop/0.11.4/square-shop.js` reaches this version.

## 0.11.3 — 2026-08-29 — the basket says it too:「合計（税込）」

0.11.2 closed the gap between the SSR card and the hydrated card and left one surface open, which
it recorded below as a deliberate omission: the cart panel. A JPY shopper therefore read `¥1,400税込`
on the card and, one click later, a bare `¥2,800` for two of them in the basket beside it — two
different claims about the same money on the same screen. chodaict's tax decision (2026-08-28) is
one tax-inclusive price shown **everywhere** for JPY, so the omission is now closed rather than
flagged.

**Line prices** take the card's markup verbatim — `cartLinePriceHtml()` is
`escHtml(formatPrice(…)) + taxInclusiveSuffix(…)`, the same pair `itemCard()` builds, so a line reads
`¥2,800<small class="dc-tax-inclusive">税込</small>` in the same class the card and the SSR grid use.
That is an assignment to `innerHTML` where 0.11.2 assigned `textContent`, and `escHtml` is load-bearing
in that switch, not decoration: `formatPrice`'s Intl-throws fallback interpolates `currency` — a
catalog-controlled string — into its return value.

**The total** does NOT take the suffix. Japanese EC states a total's tax status in the label,
「合計（税込）」, so hanging 税込 off the amount as well would say it twice in one row. The label is a
new `<p class="dc-square-shop-cart-subtotal">` sitting immediately above the amount, and it is
**not** overridable by `data-subtotal-label` — unlike every other string in `readLabels`, because
whether a price is tax-inclusive follows the merchant's currency (「稅的定案」), not a per-site wording
preference, and an override is a way to quietly un-say it. (Separately: `data-subtotal-label` has
been read-but-never-rendered since 0.9.0. 0.11.3 does not wire it — that would change how a USD
panel renders — but the header comment now says so instead of implying a label nobody prints.)

`renderPanel` grew one structural change to make this possible: the hint/lines tail is now **built**
before it is appended, because the lines loop is what settles which currency the cart is in and the
label is a function of that currency. Page order is unchanged.

**Non-JPY is unchanged node-for-node**, and the test says it that way rather than as "no 税込": a USD
panel is asserted to be exactly `cart-h · cart-total · cart-lines · checkout`, which is what it was
before this version. `subtotalLabel()` returns `''` and no label node is created at all.

### Parity, when one side renders nothing

「extend the parity test」 cannot mean 'render the cart on both sides' — the SSR core still emits an
empty `<div class="dc-square-shop-cart">`, which is the same reason 0.11.2 gave for leaving the cart
alone. The parity that does exist is **cart line ↔ card**: the panel is driven for a JPY basket and
its first line is compared byte-for-byte against what `renderShopGrid` prints for that same ¥2,800.
Three surfaces, one price display.

🔴 And it is driven through the **real `renderCart`**, which is why that function is now exported. A
helper that is exported, correct and covered while `renderPanel` quietly keeps assigning
`textContent` is a green light over an unchanged bug — the exact shape of the 0.11.1 defect. Control
runs, both measured: reverting the line to `textContent` reddens the three line-price assertions
(plus the USD line-markup one); forcing `subtotalLabel` to `''` reddens the three label assertions
and nothing else.

🔴 The source-text checks (`合計（税込）` is in the file, `-cart-subtotal {` is in the stylesheet) are
**distribution** checks only and are labelled as such in the test. This file and that one both
contain those strings in prose, so they stay green against a fully reverted `renderPanel` — the same
trap 0.11.2 documented for a bare `税込` grep. The driven assertions are what carry the weight.

The new CSS rule lives only in `square-shop.js`'s injected stylesheet, not in `product-page-core.js`'s
`gridCss`. `gridCss` exists so an edge-SSR'd page is styled on first paint, and at first paint the
cart panel is empty — there is no label to style until the client has built one.

### Channels

🔴 `manifest.json` is **untouched**. `v0` and `latest` still point at `0.10.11`; only a site pinning
`/corals/square-shop/0.11.3/square-shop.js` reaches this version.

## 0.11.2 — 2026-08-29 — the 税込 label, on the side that is actually published

0.11.1 put the JPY rule in `product-page-core.js` and nowhere else. `square-shop` is a
`bundle: false` coral — `build.mjs` **stamps** `square-shop.js` and serves that, so
`registry/versions/square-shop/0.11.1/square-shop.js` came out **byte-identical to 0.11.0** and a
site pinning `0.11.1` got the same client bytes as one pinning `0.11.0` (PR #10 measured
this; PR #6 never ran the build at all). The rule had shipped into a file the registry does not
serve.

The 404 mattered less than the second half, which PR #10 flagged and did not fix:

🔴 **hydration was erasing the label the edge had just painted.** `renderInstant` and `renderCart`
both open with `root.innerHTML = ''` and rebuild every card from the SSR card's own `data-*`
attributes via `itemCard()`. So on an edge-SSR'd JPY page the label appeared and then vanished a
moment later, and on a client-only mount — a static build, or `data-api-base` pointed straight at
RSP, which is what that seller runs — it was never there at all. The only surface where 0.11.1's label
survived was a page with JavaScript off.

So `taxInclusiveSuffix()` now lives in `square-shop.js` too, byte-for-byte the same helper, applied
at `itemCard()`'s two price paragraphs (single price and multi-variant range), plus the
`.dc-tax-inclusive` CSS rule in the injected stylesheet. That class is deliberately **not**
`${PREFIX}`-prefixed: it is the same literal class `product-page-core.js` emits and styles, because
the SSR grid and the hydrated grid are the same pixels a moment apart and must not have two looks.
`formatPrice` is unchanged — still plain text — so the cart panel, which assigns to `textContent`,
is untouched and USD renders byte-for-byte as before.

**Not changed, deliberately:** the cart panel's line prices and subtotal carry no label. The SSR
core renders no cart at all (`renderShopGrid` emits an empty `<div class="dc-square-shop-cart">`),
so there is nothing there to agree *with*, and 「稅的定案」 recorded the rule for the catalog price
display, not for a basket line. Widening it is a pricing-display decision, not a parity fix — it is
flagged here rather than made here. **(Superseded: that decision was taken and shipped in 0.11.3,
above. This paragraph is the record of 0.11.2, not current behaviour.)**

`shop-grid-client-parity.test.mjs` is the new gate, and it is a **parity** test, not an existence
test: it renders one fixture through `renderShopGrid` and through `itemCard` and compares the price
paragraphs byte-for-byte, so a client that emits the label with a different tag, class or position
is red. Control run (client suffix reverted): the two JPY assertions fail, the USD one stays green.
It also holds the published artifact for whatever version `package.json` names to the same bar —
against the 0.11.1 artifact that check is **red**, which is the shape of the whole defect. 🔴 Note
that a plain "the source contains 税込" check stays GREEN with the client suffix reverted, because
the helper's own source string satisfies it; that is why the byte-comparison carries the weight.

### 🔴 `grep 税込` on this file answers differently depending on who feeds it

`square-shop.js` has contained literal `\x00` / `\x01` bytes since 0.11.0 — `cartRefKey()`'s field
separators, deliberate, and they never leave the page. macOS's BSD grep (2.6.0-FreeBSD) decides
text-vs-binary from its **first read buffer**, and a multibyte pattern silently matches **nothing**
in input it has classified as binary — no warning, count 0, exit 1, and `-a` does not help.

Whether that first buffer contains the NUL (at byte 23304, *after* all three 税込 at 8925 / 17095 /
18320) depends on the writer's chunk size, not on the file. Measured 2026-08-29, one identical
46178-byte artifact:

| how the same bytes reach grep | `grep -c 税込` |
|---|---|
| `grep -c 税込 square-shop.js` (direct) | **0** (exit 1) |
| `cat square-shop.js \| grep -c 税込` | **0** — macOS `cat` hands over one big block |
| `head -c 46178 square-shop.js \| grep -c 税込` | 3 — same bytes, small chunks |
| `curl -s <url> \| grep -c 税込` | 3, stable over 8 runs |
| `tr -d '\000\001' \| grep -c 税込` | 3 |
| Python `.count()` | 3 |

So `curl … | grep -c 税込` happens to answer correctly — for a reason that has nothing to do with
the deploy being good, and the same pattern against a **saved** copy of the very same bytes answers
0. Do not read either number as evidence. Use a ruler that cannot be confused:

```
curl -s <url> | tr -d '\000\001' | grep -c 税込     # → 3
```

(`grep -c 税込 product-page-core.js` → 6 with no trouble at all: no NUL bytes. That is why this had
never been noticed.)

### Channels

🔴 `manifest.json` is **untouched** again. `v0` and `latest` still point at `0.10.11`; only a site
pinning `/corals/square-shop/0.11.2/square-shop.js` reaches this version.

## 0.11.1 — 2026-08-28 — JPY tax-inclusive price label

Japanese sellers show ONE tax-inclusive price (税込) with no per-site setting — the rule follows the
merchant's currency, not a toggle (RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md,
「稅的定案」). When `currency === 'JPY'`, every server-rendered price (the product-detail page and
the shop-grid card, including the multi-variant min~max range, where the label is appended once at
the end rather than after both bounds) and the client-side variant-switch price update now append a
small, muted `<small class="dc-tax-inclusive">税込</small>` after the formatted amount. `fmtPrice`
itself is unchanged — still plain text — so every other caller keeps its existing contract; USD and
other non-JPY currencies render byte-for-byte as before.

## 0.11.0 — 2026-08-28 — the RSP cutover

The version a live site loads today (`0.10.11`) **physically cannot drive RSP's checkout**. This
release is what makes `data-api-base="https://rsp.feelreef.com"` a working switch instead of a shop
that lists products and silently fails every Buy click. Context and measurements:
`reef/docs/RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md` (§4.1, §5.2, §7) and reef PR #107.

### 1. `client_request_ref`, on BOTH paths

RSP's durable checkout hard-requires a non-empty `client_request_ref` and answers
`400 {"error":"client_request_ref is required","code":"client_request_ref_required"}` without it —
on the instant route **and** on the cart route (`reef/apps/rsp/src/site-do/site-durable-object.ts`,
`handleSquareCatalogSaleCheckout` / `handleSquareCatalogCartSaleCheckout`).

It does **not** mint one server-side, deliberately: a double-click is two separate HTTP requests
with no shared server-side state, so a server-minted ref would give each of them its own and create
**two** payment links. Minting it in the browser is what makes the boundary idempotent. So:

- **instant** — a per-mount `Map` keyed on `variation_id`. A re-click or a lost-response retry of
  the same variation replays the same ref (RSP returns the SAME link); a different variation gets a
  different ref, so separate purchases never collide into RSP's `409 client_request_ref already in
  use`.
- **cart** — the same map, keyed on the cart's own contents: the sorted `variation×quantity` join.
  A double-click on Checkout replays one link; a basket the shopper edited in between is a new
  intent and mints a fresh ref. That key is a **join, not a hash** — it never leaves the page, so a
  hash would buy nothing and would introduce the one failure that matters here, two different
  baskets colliding onto one ref.
- Both maps are per-mount, so a reload (coming back from a completed hosted checkout) starts clean
  and the same item can be bought again.
- A `409` **drops** the cached ref, so the next click mints a fresh one instead of replaying a ref
  that can only ever fail again. That cannot duplicate a paid order: a 409 means the ref is bound to
  *different* contents.

mixfairy ignores the field, so sending it is safe against both backends.

### 2. The item-detail shape

`product-page-core.js#renderProductPage` reads `title`, `images[]`, `variants[]` — the shape
mixfairy answers and the one RSP gained in reef PR #107. An RSP older than that PR answers only the
flat fields (`name`, `variation_id`, `price_minor`, `display_price`, `currency`, `image_url`), and
read literally that is a product with **zero variants**: `buyDisabled` is true, so `/shop/<slug>`
renders a blank title, an empty gallery and a disabled **"Sold out"** button on a page every grid
card links to (RUNBOOK §7 #2).

`normalizeProduct()` now reads the flat fields as a **one-variant floor** — never an override. A
backend that sends `variants[]` is believed about every one of them. Also:

- `available` **absent** now means buyable. It is not in the flat shape at all, and reading a missing
  field as `false` is how a whole catalog renders sold out. An explicit `false` is still honoured.
- `display_price` and `price_minor` are each other's fallback, so one missing field never reaches
  the page as an empty price span or a `NaN`.
- The grid (`renderShopGrid`, and `itemCard` in the client) reads `name || title`, so a card cannot
  render blank against either shape.

### 3. Buyer-facing failures

`0.10.11` failed **silently**: the instant path restored the button label and rendered nothing, and
the cart path overwrote the button's own label with an error sentence. Both are gone.

A refusal is now mapped — on the machine-readable `code` first and the HTTP status second, never by
parsing a message string — to a plain-language line rendered in a `role="alert"` node beside the
button. RSP's own `error` sentence ("client_request_ref is required", "square not connected", "rate
limited") **never reaches a shopper**; `checkout-ref.test.mjs` asserts that by word list.

Every message is overridable per site, so a zh-TW page is not answered in English:
`data-checkout-error-label`, `data-checkout-busy-label` (429), `data-checkout-closed-label` (404),
`data-checkout-again-label` (409), `data-checkout-unavailable-label` (5xx).

### 4. Additive named exports

`mount` / `mountAll` plus the pure helpers are now exported, and the self-mount tail is guarded on
`typeof document !== 'undefined'`. A browser sees no change — a sitetile `<script type="module" src>`
embed still auto-mounts with no caller. What the guard buys is that Node can **import** this file, so
the ref and error logic is unit-tested instead of only being reachable through a real page.

### Channels

🔴 `manifest.json` is **untouched**. `v0` and `latest` both still point at `0.10.11`, so the whole
fleet stays on mixfairy and only a site that pins `/corals/square-shop/0.11.0/square-shop.js`
reaches this version. That pin is the per-site flag; leaving the channels alone is what keeps the
blast radius at one site.

---

## Back-port debt

### Repaid here

The fork's `PROVENANCE.md` § "Back-port debt" asked for two things at the canonical source. Item 1 —
`client_request_ref` minting **and** the additive `mount`/`mountAll` exports — is done, and the cart
path is covered too, which the fork's version is not.

### 🔴 A false premise in the fork's note, corrected

`reef/apps/feelreef/src/lib/dynamic-corals/square-shop/PROVENANCE.md` says:

> The cart path (`startCartCheckout` → `POST .../square/catalog/cart`) is **UNCHANGED**: RSP
> (ejecta) exposes no `/api/v2/square/catalog/cart` route […]

**That is no longer true.** RSP registers `POST /api/v2/square/catalog/cart` at
`reef/apps/rsp/src/index.ts:1641` → `handleSquareCartCheckout`, and the DO behind it refuses a
missing `client_request_ref` with the same 400 as the instant route. The premise that justified
leaving the cart path alone is gone — and the cart path is the one a live seller with
`data-cart="header"` actually uses, so it was the half that mattered.

That note lives in the `reef` repo and is **not corrected by this PR**; it needs its own change
there. Until then, treat the fork as a tracked divergence that is now BEHIND this source on the cart
path.

### The mount contract is now under test (2026-08-29)

`mount` / `mountAll` have been exported since **0.11.0** — and until now **nothing in this repo drove
either of them**: `grep mountAll packages/dynamic-corals/square-shop/*.test.mjs` returned zero hits.
The exports existed to repay item 1 above, so the assertion that they *work* lived only in the
downstream fork, in a file that was about to be replaced by this one. That is the wrong place for it.

`mount-idempotency.test.mjs` now drives both, through the real exports:

- `mountAll()` mounts a host that is on the page, and stamps it `data-dynamic-coral-mounted="1"`;
- calling it again re-mounts **nothing** — the property feelreef's `Render.svelte` leans on, since it
  re-runs `mountAll()` on every client-navigation `onMount` and therefore re-scans every card that is
  already mounted;
- **idempotent is not inert**: a host that appeared since the last scan *is* mounted, while the
  already-mounted one is skipped in that same pass. Both halves are asserted in one arm, because a
  test that checks only one of them stays green on either bug;
- the control: clearing the stamp makes the host mountable again, which is what proves the stamp is
  the mechanism rather than a cached node list or an "already ran" flag.

Mounts are counted at the **catalog fetch**, not at a DOM side effect — a second mount of the same
host writes the same nodes over the first, so the host itself cannot tell one mount from two.

🔴 Recorded because it is the opposite of what "idempotent mount" invites you to assume: the guard is
in `mountAll`, **not** in `mount`. `mount(el)` re-fetches and re-renders whatever it is handed — that
is what makes it the imperative entry point the tests (and feelreef's
`cart-client-request-ref.svelte.test.ts`) drive directly. Asserted as-is, so that if it ever does
become a no-op, that contract change is caught here rather than as a card silently failing to redraw.

Control arms, both measured before commit and both restored (`cmp` against the saved copy →
identical):

| arm | reddened |
|---|---|
| the `data-dynamic-coral-mounted` check dropped from `mountAll` | 5 assertions — the idempotency one plus the stamp control |
| `mountAll` made inert after its first call | 5 assertions — the "a new host still mounts" ones |

Note the two sets are **not** the same five. Over-mounting and inertness are opposite bugs, and
neither hides behind the other here.

**No version bump for this.** `square-shop.js` is unchanged — this is a test and this note. A new
registry version would publish an artifact byte-identical to 0.11.4 apart from its stamp, and a
version number in this registry means the client contract moved.

### Still open

2. **Re-vendor** this file into the feelreef fork (and re-pin its sha256 in `vendor-pristine.test.ts`)
   so both substrates carry the same ref contract on both paths.

   **In progress 2026-08-29** on reef branch `chore/square-shop-vendor-0.11.5`, vendoring **0.11.5**.

   🔴 Read the version numbers here carefully, because they moved for two different reasons. The
   reconcile was scoped as "publish 0.11.5, adding the `mount`/`mountAll` exports". Those exports had
   been here since **0.11.0** — the fork's `PROVENANCE.md` listed them as its one un-repaid
   feelreef-only feature right up to the day of the reconcile, and the "Repaid here" paragraph above
   had already contradicted it. Measured on the trees rather than read off either note: zero
   fork-only functions, the same three RSP endpoints, all 18 of the fork's `data-*` attributes
   present here. **0.11.4 was already a superset of the fork**, so there was nothing to port and no
   reason to publish.

   0.11.5 exists anyway, for a reason found by doing the vendor rather than by planning it: the
   vendored file tripped feelreef's `raw-nul-byte` lint, and the two literal control bytes behind
   that are a real defect in this file (see the 0.11.5 entry). So the branch name turned out right,
   and the version it names is not the one it was named for.
