# Vendored: reepub book-md fixtures

The `.md` files here are copied byte for byte from another repository, so that
`test/book-overlap.test.mjs` can run without the network.

- Source: https://github.com/CVERInc/reepub, directory `fixtures/book-md/`
- Pinned at commit `888f49395a6322ad7d953de5e564c1eff819eeab`
- Licence: MIT. The source's `LICENSE` is copied here beside the fixtures.

`expected.json` is the answer key. It holds what reepub's own parser
(`scripts/check-book-format.mjs#parseBookJS`, at the same commit) reports about
the part both formats share: chapters, their order, reading direction, and
the plate pages of `kind: fixed` books. It also holds each fixture's SHA-256,
so an edit to a vendored file fails the test instead of quietly changing what
it checks.

Do not edit these files by hand. To move the pin, check out the new commit and
run:

    node test/fixtures/reepub-book-md/capture.mjs <path to the reepub checkout>

The script refuses a checkout with local changes in the files it reads, writes
the fixtures, `LICENSE` and `expected.json` again, and records the commit it
read. Update the commit named above to match.
