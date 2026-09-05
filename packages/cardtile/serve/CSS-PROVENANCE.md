# card.css — where it came from, and why nothing generates it

The 🔴 short version is in `card.css`'s own header. This is the evidence behind it, kept out of the
stylesheet because that file is **served to every visitor of every card** and a page of reasoning is
not their download.

## Provenance

`card.legacy.css` is the Python era's stylesheet: 105KB written for a whole application —
navigation, drawers, toasts, cookie banners, a PWA install modal, a feed reader. A Card uses a
sliver of it, and the Python server is off, but its stylesheet was still the load-bearing wall under
every native card. That is the façade trap in CSS form: the old thing is "gone" while everything
leans on it.

`card.css` is the sliver — the rules the three live cards actually match, kept **byte-identical** to
their legacy originals so "did it change?" had the answer "it cannot have", then renamed into
sitetile's vocabulary by de0c32b (`packages/cardtile/vocabulary.mjs`). `card.legacy.css` stays as the
REFERENCE it was cut from. It is never served.

## Why there is no generator any more

`gen-card-css.mjs` extracted that sliver by rendering the three cards and asking which legacy
selectors matched. It was **retired on 2026-07-30**, and the reason is not that it was old.

de0c32b applied the vocabulary rename to the renderer and to the GENERATED `card.css` and not to the
generator. So it went on rendering `.st-*` markup and asking which legacy `.cp-*` selectors matched
— almost none. Running it dropped **15,876 → 8,761 bytes**, every `.st-*` rule gone, while printing
`kept 53 rules, dropped 843` like a normal run. It was run on 2026-07-30 and caught on the byte
count, not on the message.

Teaching it the rename got much closer and still does not land:

| | rules kept | `@media(prefers-color-scheme:light)` blocks |
|---|---|---|
| shipped `card.css` | 113 | **0** |
| generator + rename | 127 | 4 |
| generator, no rename | 53 | 4 |

Those 4 blocks are real rules in the legacy sheet that genuinely match a card, and they fight the
renderer's own light theme. Measured with `verify/css-equivalence.mjs`, shipped against
generator-plus-rename, animations frozen, against a 0% noise floor:

| card | theme | geometry | links | text | colours | pixels differ |
|---|---|---|---|---|---|---|
| card A | dark | same | same | same | same | 0.098% |
| card A | light | same | same | same | **DIFF** | **73.5%** |
| card B | dark | same | same | same | same | 0.918% |
| card B | light | same | same | same | **DIFF** | **48.7%** |
| card C | dark | same | same | same | same | 0% |
| card C | light | same | same | same | **DIFF** | **35.5%** |

🔴 The light blocks come back **with or without** the rename, so this is not a bug in the rename fix
— the shipped file cannot be produced from the inputs that still exist, in any configuration. Both
files were claiming authority and only one of them was real.

A retired thing that still runs is the façade trap, so the generator is deleted rather than left
behind a warning comment. Git history has it if anyone wants to read it.

## How to change the stylesheet

Mechanically, and with the diff read back:

1. Count the occurrences of what you are changing, before and after. Assert both counts.
2. Read the **character-level** diff, not the line diff — this file is minified onto few lines, so a
   line diff says "1 line changed" for anything from a colour to a catastrophe.
3. Run the gate:

       node packages/cardtile/verify/css-equivalence.mjs <the previous card.css>

   Geometry, links, text, every computed colour and a full-page pixel diff, three cards × two
   themes, with a noise floor and a control. It cannot rebuild the sheet; it answers the question
   the generator was only ever a proxy for — **did this change a card?**

Two traps that harness has already fallen into, so do not re-cut them:

- **Animations.** one card's carousel and another's fish sim put the noise floor at ~0.9% before
  animations were frozen, which is the same order as a real difference. Frozen, the floor is 0%.
- **A control that blunts outranked rules.** The first control edited `grid-column:span N` inside
  `card.css` and changed nothing, because the spans come from the renderer's inline `<style>`, which
  is later in the document and wins. It reported "the probe is not reading layout" when the truth was
  "there was nothing there to break". `card.css` contributes **no geometry** to a card.

## The deliberate departures from the legacy original

Both are one kind of thing: a colour belonging to somebody other than the card.

- **Four uses of ONE creator's accent `#b890e8` on `.cp-icon`** → `var(--cp-accent)`. Measured: all
  four were **outranked and never in effect** (`animation-name` computes to `none`; the hover ring
  resolves from the later `.st-card` rule). Housekeeping, so the literal cannot come back to life
  later wearing someone else's colour — not a visible change.
- **`[tabindex]:focus-visible`'s `--carrier-accent`** (REEF's platform teal `#7fdbca`) →
  `var(--cp-accent)`. This one **was** live, on all three cards including the one it came from: the platform's
  colour on pages that carry no platform chrome.

The `:root` defaults keep their literals. Those are the tokens' definitions, not uses of them, and
the renderer's per-card `#cp-accent` block replaces the whole family anyway.

`verify/tenant-colour.mjs` holds both claims, with the previous bytes served in place as its control.
