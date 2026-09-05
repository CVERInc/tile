# The iPhone Home Screen, measured — 2026-07-29

We had been reaching for the iPhone Launcher as an analogy all day: the grid guarantees the layout,
the accent is the creator's colour, *and then what locks a background?* Analogies are cheap. This is
the analogy actually measured, from screenshots the maintainer took on his own phone.

It settled three things and refuted one — including one of mine.

> **Method note, and the reason this directory exists.** The first version of this investigation was
> me reasoning from a verbal description of the behaviour. I wrote a whole spec proposal on top of
> it, *flagged that I had not verified it*, and carried on. Flagging is not verifying. The
> measurement refuted the model. `measure.py` re-derives every number below from `shots/`.

## 1. Turning labels off is a SIZE control, not a label control

There is no "show app names" switch. The Customize sheet carries a **small / large** toggle, drawn
as two rounded squares with the active size solid (`shots/05-size-glyph-zoom.png`). The label
vanishing is a *consequence* of choosing large.

Measured, not read — mean brightness of each square in each state:

| sheet state | small square | large square | solid one |
|---|---|---|---|
| large icons | 134.6 | 167.5 | **large** |
| small icons | 200.0 | 142.3 | **small** |

For an authoring surface that is a better shape than a captions checkbox: one control, two presets,
no orphan knob. The author is asked *"big picture, or smaller picture with a word under it"* — not
*"do you want captions"*.

## 2. 🔴 The cell is NOT a fixed budget the label eats into

The proposed model was: the cell stays one square, the label takes a slice, the picture gives it
back when you turn the label off. It would have been very convenient — it preserves yesterday's
result that a square picture at `w=N` is exactly N units.

Three pure-icon rows per screenshot, identical values on every row:

| | labels ON | labels OFF | change |
|---|---|---|---|
| icon side | 99.5 | 116.5 | **+17.1%** |
| horizontal pitch | 142.5 | 151.2 | **+6.1%** |
| **vertical pitch** | **154.8** | **146.0** | **−5.7%** |
| label height | 15.0 | — | |
| left margin | x=173 | x=153 | −20px |

**The test was stated before the measurement: fixed budget ⇒ pitch does not move.** Vertical pitch
moved −5.7%. Rows get *tighter* while icons get *bigger*, columns spread, margins shrink. iOS does
not reallocate inside a cell — **large-icon mode has its own grid metric entirely.**

(One irregularity worth recording: row-to-row gaps alternate 152/140 around a mean of 146.0,
identically in both sampled columns, so it is not detector noise — probably the mockup was rescaled.
The figure used is the total span ÷ 5, which is stable.)

### What we take, and what we cannot afford

iOS can re-derive its whole grid because it owns the screen, the icon count is fixed and every icon
is the same size. A Card has arbitrary content, mixed widths and a `minmax` growth rule; re-deriving
the grid metric per card destroys the arithmetic that `w=N ⇒ N units` rests on.

So we take iOS's **effect on the picture** (it really does shrink, by 17%) without iOS's grid
re-derivation. The label lives inside the cell's square; the picture shrinks and stays square,
gaining side inset — which is also how iOS does it locally, since an icon is only 70% of its column
pitch and the slack is already there.

## 3. Where the freedom sits: ground open, derived layer locked

The claim under test was "Apple ships presets, not a colour picker". **False, and instructively so.**

`shots/08-choose-color.png` and `09-colors-hex.png`: eighteen curated swatches, a colour wheel, then
Grid / Spectrum / **Sliders**, RGB, an **sRGB hex field** and an eyedropper. Total freedom.

But look at *which layer* is free:

| layer | freedom |
|---|---|
| **wallpaper (the ground)** | **total** — colour, gradient, photo, any hex |
| icon style (derived) | four presets: Default / Dark / Clear / Tinted |
| legibility compensation | automatic label shadows, plus **one offered knob: Blur** |

> **The ground is wide open. Everything derived from the ground is locked.**

That is the answer to "how do we lock each DOM's background-color" — you don't. You lock what is
derived from it. Which is the corrected wallpaper analogy: iOS does not say *your wallpaper made the
labels unreadable, not our problem*; it compensates, and it **offers** the compensation (Blur, right
next to Photo) rather than imposing it.

And even the free picker is **curated first**: eighteen checked colours on top, the hex field one tap
deeper. People who type hex know what they are doing.

## 4. A wild sighting for the frame rule

`shots/06-edit-menu.png`: the **Siri Suggestions** widget — a group of icons inside one rounded
container with a single label under the group. Frame on the group, not on each cell. The rule locked
earlier the same day, shipping on the same phone.

(Theirs sits *below* the group and reads as a caption; our lane headings sit above and read as
titles. Same structure, different rhetorical job.)

## Reproduce

    python3 docs/experiments/ios-launcher-2026-07/measure.py

## 🔴 What is not here, and why

`shots/` stayed in the private incubator when this moved to the public engine on 2026-09-07. They
are the maintainer's own phone, cropped to the home screen — which is to say they are a picture of
one person's apps, and that is not de-identifiable by renaming a file. So `measure.py` cannot run
from this repo, and it says so when it cannot find them rather than reporting a clean zero.

Every number below the fold was re-derived by that script from those shots, and every number is
still here. The measurement moved; the phone did not.
