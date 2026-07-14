# CJK support in tugtile

tugtile is built to be a first-class kanban for Chinese, Japanese, and Korean boards — not
latin-first with CJK bolted on. This document turns that claim into something you can check:
every guarantee below states **what it promises** and **how it is verified** — an automated test
where the logic is pure, a short manual repro where a live browser / IME is required.

The pure logic lives in the engine block (`plugin.src.js`, the `CORE` region: `homeKey`,
`displayWidth`, `parseFile`, `serializeFile`, …). It has no Obsidian dependency, so it runs in
plain Node and is unit-tested in `test/cjk.test.cjs`.

## The 6 guarantees

### 1. Round-trip fidelity for CJK content
**Promise:** A card whose body is Chinese / Japanese / Korean text survives `parse → serialize`
byte-for-byte. We never re-encode, normalise, or "clean up" your characters — `tile.raw` is the
exact markdown from your file and is what we write back.

**Verified by:** automated — `test/cjk.test.cjs` (`raw line preserved verbatim`,
`parse→serialize keeps the fullwidth checkbox line`, `round-trip idempotent`) and the broader
round-trip suites in `test/core.test.cjs` / `test/archive-home.test.cjs`, which exercise CJK
boards (`## 進行中`, `卡片內容`, `%%tg-home:進行中%%`).

### 2. Fullwidth / non-ASCII checkbox tolerance
**Promise:** The board parser does not assume the checkbox mark is ASCII. A card written
`- [Ｘ] …` (fullwidth Ｘ) — or any single non-ASCII mark inside the `- [ ]` brackets — parses
without crashing, and the mark is captured and preserved verbatim.

**Verified by:** automated — `test/cjk.test.cjs`
(`parseFile tolerates fullwidth checkbox mark (no crash)`,
`fullwidth checkbox mark captured verbatim`). The parser's matcher is `/^- \[(.)\]/`, capturing
any single code point rather than a fixed `[ xX]` set.

### 3. Display-width awareness (long-card collapse)
**Promise:** The "this card is long, collapse it to its title" decision reasons in **visual
columns**, not UTF-16 code units. A CJK character occupies ~2 columns, so a 30-character Chinese
title (~60 columns wide) collapses at the same *visual* length as a 60-character latin title —
neither language is treated as "shorter" than it looks.

**How it works:** `displayWidth(str)` counts East-Asian wide / fullwidth code points as 2 and
everything else as 1, iterating by Unicode code point (so surrogate-pair / astral CJK characters
are measured once). The host collapse check is `displayWidth(meta.clean) > 60` — the threshold is
**60 columns**, deliberately *not* doubled: 60 latin chars = width 60 (identical to the previous
`.length > 60` behaviour), while ~30 CJK chars = width 60.

**Verified by:** automated — `test/cjk.test.cjs`. `displayWidth` cases: latin-only (`"hello"→5`),
CJK (`"理牌"→4`), mixed (`"a理b"→4`), fullwidth punctuation (`"：，"→4`), empty (`→0`), kana /
hangul / ideographic-space, and a surrogate-pair char (`"𠀀"→2`, not 4). Boundary cases assert
latin behaviour is unchanged (60→not long, 61→long) and the CJK collapse point
(29 CJK = width 58 → not long; 31 CJK = width 62 → collapses).

### 4. Fullwidth-space tolerant lane matching
**Promise:** A lane named with a fullwidth ideographic space (U+3000, common when typing with an
IME) still matches its own archive-restore token. `homeKey()` collapses all whitespace — including
U+3000 — to a single ASCII space, on both the writing and the matching side, so an archived card
restores to the right lane.

**Verified by:** automated — `test/cjk.test.cjs` (`homeKey collapses fullwidth space U+3000`,
`homeKey fullwidth-space == ascii-space twin`) and the end-to-end archive restore in
`test/archive-restore-e2e.test.cjs`.

### 5. IME composition guard (keyboard surfaces)
**Promise:** While you are mid-composition with an IME — picking among Chinese/Japanese candidate
characters — pressing Enter or an arrow key confirms / navigates candidates and **never** fires a
tugtile shortcut. This is guarded consistently in **all three** keyboard surfaces:
- the full-screen **editor** (`editor-core.js` — `compositionstart`/`compositionend` gate the
  re-highlight, and `Enter`/`Tab` check `!e.isComposing` / `keyCode !== 229`),
- **card submit** (`plugin.src.js` — the inline-editor Enter handler checks
  `!(e.isComposing || e.keyCode === 229)`),
- the **board card keydown / arrow handler** (`plugin.src.js` — bails on
  `e.isComposing || e.keyCode === 229` before any bare-key card action).

Because composition state is browser/IME-driven, this guarantee is verified by hand, not in Node.

**Manual repro:**
1. Open a board, focus a card's inline editor (or the full-screen editor), and switch your OS to a
   Chinese or Japanese IME.
2. Type a syllable so candidate characters appear (composition is active), then press **Enter** to
   confirm a candidate — the candidate is inserted; the card must **not** submit/close.
3. With a card focused on the board (not its input), start composing and press the **arrow keys** —
   candidate navigation should work and the card must **not** move between lanes. Releasing the IME
   and pressing the same keys then behaves normally.

### 6. CJK line-wrap inside cards
**Promise:** A long Chinese / Japanese / Korean title wraps onto multiple lines *inside* the card
rather than overflowing or being clipped, so the full title stays readable on the board.

Wrapping is layout behaviour in a live browser, so it is verified by hand.

**Manual repro:**
1. Create a card with a long single-line CJK title (e.g. 40+ Han characters, no spaces).
2. On the board, confirm the title wraps within the card's width and every character is visible
   (the card grows in height; text is not cut off horizontally).
3. Collapse/expand the card (guarantee 3) and confirm the collapsed title line behaves the same.

## Known limitation (honest disclosure)

**Table / row view truncates CJK at ~30 visible characters.** The compact row view caps each row's
text at `max-width: 60ch` (`styles.css`, the `.tugtile__row-text` rule) with an ellipsis. Because
`ch` is the width of the `0` glyph, a CJK character (~2× that width) consumes roughly two `ch`, so
CJK row text is visually truncated at about **30 characters** where latin truncates at ~60. This is
a **cosmetic** limit of the dense table view only — the full title is always intact in the card
view and on disk (round-trip fidelity, guarantee 1, is unaffected). It is documented here rather
than hidden; a future fix would switch that cap to a display-width-aware measure.

## Running the tests

```
node test/cjk.test.cjs        # the CJK-specific engine tests
bash scripts/test.sh          # full suite: syntax + i18n + builds + every test/*.cjs
```
