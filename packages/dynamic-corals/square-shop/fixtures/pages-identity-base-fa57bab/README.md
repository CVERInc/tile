# Pages behaviour-identity base (CVERInc/tile fa57bab)

Frozen copies of the four sources that produced the Pages `_worker.js` at tile commit
`fa57bab`, kept so `../../pages-behaviour-identity.test.mjs` can emit the pre-change worker in
a shallow CI checkout. The tree mirrors the repository layout so the emitter's relative reads and
imports resolve unchanged.

| File | sha256 at fa57bab |
|---|---|
| `packages/dynamic-corals/square-shop/emit-shop-function.mjs` | `d74f9bb5a3ebfa38d76d072adc55c484ddb89657aff506b1c5dcfa3e02f25290` |
| `packages/dynamic-corals/square-shop/product-page-core.js` | `f4c12fc24586608969a93b63be4b7780013a66ad8ce136ace19854ccb0c07ad6` |
| `packages/dynamic-corals/square-shop/shop-function-template.js` | `6dcb0b0039868a543972cfc3fd350a5882b3313ef19f7a71033d0ad0d3b9247a` |
| `packages/sitetile/query-redirects.mjs` | `77cfd06276fd626c266930649813e383729f90cbd8505a14021a7cb9cc73aa64` |

`product-page-core.js` and `query-redirects.mjs` are byte-exact. The emitter and the template
differ in one way only: the platform-origin default literal (the live platform origin) is replaced by
the RFC 2606 name `https://platform.invalid`, the same substitution as
`fixtures/emit-shop-function.reference.mjs` (emitter lines 38, 413, 439; template lines 1235,
1441). The test always passes `--platform-origin`, so neither default is reached.
`package.json` here only declares the tree as ES modules.

Do not edit these files to make a test pass: a difference between them and the current sources
is what the test exists to measure.
