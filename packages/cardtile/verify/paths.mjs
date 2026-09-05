// Where the verify harnesses find their inputs and drop their artifacts.
//
// 🔴 Why this file exists: every harness here used to hard-code one session's scratchpad directory
// as BOTH its input source and its output sink. The originals were rescued into the repo
// (`packages/cardtile/cards/`), but the harnesses kept reading the copies in /tmp — so the whole
// verification suite was one reboot away from failing on "file not found" while looking like it
// had simply never been run. Inputs now come from the repo (durable, versioned); outputs go to a
// throwaway dir (screenshots are regenerable — they are the one thing that SHOULD be disposable).
//
// Override the output dir with CARD_VERIFY_OUT=/some/path if you want the images somewhere else.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG = join(HERE, '..');            // packages/cardtile
export const REPO = join(PKG, '../..');         // the engine's root

/** Specimen cards — built by cards/gen-specimens.mjs, shaped to land on what these harnesses
 *  check. NOT the live cards: every harness here used to read three real people's pages, which
 *  works (they are real, so they hit real shapes) and means every check was also a description of
 *  somebody's page. See cards/specimens/ and the generator's header.
 *
 *  There is no longer an escape hatch back to a real card — see the note below.
 *  about a live card rather than about a shape. It is opt-in because the default should be the one
 *  that is safe to publish, not the one that happens to be handy. */
// 🩸 CARD_VERIFY_REAL used to swap these to the real creators' cards in `cards/`. Those left the
// package on 2026-08-12 — they were artifacts of the phase where we built each customer's Card BY
// HAND, and once anyone can make their own, our copies are a business record and not a product
// asset. They are in ../../lab/ now. The flag is gone rather than repointed: a verify harness
// whose default is a specimen and whose escape hatch is somebody's live page is one typo from
// being aimed at them.
export const CARDS = join(PKG, 'cards/specimens');
export const readCard = (handle) => fs.readFileSync(join(CARDS, `${handle}.card.md`), 'utf8');

// The stylesheet, icons and signet arrow come from the GENERATED bundle, not from their sources —
// card-assets.mjs is literally the bytes production serves, and reading the sources instead would
// verify a page nobody visits (card.css alone is missing signet's arrow.css, for one).
const assets = await import(join(PKG, 'serve/card-assets.mjs'));
export const CSS = () => assets.CSS;
export const ICONS = () => assets.ICONS;
export const ARROW = () => assets.ARROW;

/** The built QR coral client. */
export const QR_JS = () => fs.readFileSync(join(REPO, 'packages/dynamic-corals/qr/qr.js'), 'utf8');

/** Disposable artifacts (screenshots, rendered HTML). Gitignored via `out/`. */
export const OUT = process.env.CARD_VERIFY_OUT || join(REPO, 'out/card-verify');
fs.mkdirSync(OUT, { recursive: true });

/**
 * Playwright. This repo has no browser deps of its own, so it borrows one.
 *
 * 🩸 Was a single absolute path into another repo's node_modules on ONE developer's machine. That is
 * why every harness in this directory could only ever run here — and a gate that can only run on one
 * laptop is a gate nothing automatic will ever run. Seven of them were found dead on 2026-08-12,
 * having rotted for weeks with nothing looking. So: an env override first, then the places it is
 * actually installed, then the bare specifier for anywhere it is on the module path.
 *
 * If none resolve, this is the bare specifier and the import fails with ERR_MODULE_NOT_FOUND —
 * which run-all.mjs reads as SKIPPED (no browser here), not as a broken harness. "I could not look"
 * and "I looked and it is broken" must never print the same thing.
 */
// 🔴 An explicit override WINS, even if it does not exist. Falling through to a path that happens to
// work would mean the run silently used a browser the operator did not ask for — and "I set the env
// var and nothing changed" is the shape of a rule that was never in effect.
// 🔴 The candidate list moved with the package (2026-09-07). This repo declares no browser
// dependency and neither did the one before it, so the list is where playwright is actually
// INSTALLED on a machine that has one — and the first entry is now the parent checkout, because
// when this repo is a submodule of the incubator that is the checkout with the pinned install.
export const PLAYWRIGHT = process.env.PLAYWRIGHT
  || [join(REPO, 'node_modules/playwright/index.js'),
      join(REPO, '../node_modules/playwright/index.js'),          // the incubator, when we are its submodule
      join(REPO, '../../reef/apps/feelreef/node_modules/playwright/index.js')].find((c) => fs.existsSync(c))
  || 'playwright';
