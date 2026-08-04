# What this editor knows about markdown

The engine is a **single-layer** editor: the styled text you see IS the text you edit. Markers are
kept in the DOM inside `.tg-mk` spans and hidden by CSS, never removed — which is why the round trip
is byte-exact and why "render it properly" is a harder problem here than in a renderer that is free
to emit `<strong>` and throw the asterisks away.

Two things follow, and they explain most of the design:

- **A line is not enough.** A fence's extent, a frontmatter block, and a setext underline are facts
  about the *sequence* of lines. `blockScan(lines)` runs first and labels each line; only then does
  `highlightLineParts(line, label)` mark it.
- **Nothing can be dropped or added.** Every construct is a marker–content–marker sandwich. If a
  construct cannot be expressed that way, it does not get implemented — that is the wall, not a
  todo.

## Where it stands

`node scripts/commonmark-score.mjs` — **420/652 (64%)** of CommonMark 0.31.2, scored as *construct
recognition*, not conformance (this is not a renderer; there is no HTML to diff). `--misses` lists
what it got wrong.

`test/commonmark.test.cjs` is the gate that runs in CI: **57 claims, 2 declared gaps.** A gap is
asserted to STILL be missing, so implementing one turns the suite red with "remove it from GAPS and
add a claim()". The score can only move on purpose. It has already caught four of its own gaps
closing.

## The one real defect left: emphasis does not nest

This is the next piece of work and the only remaining category of *wrong* rather than *missing*.

| input | today | should be |
|---|---|---|
| `**bold with *it* inside**` | whole thing italic, **bold lost** | bold, with italic inside |
| `*it with **bold** inside*` | two separate italics | italic, with bold inside |
| `***both***` | bold only | bold + italic |
| `*a**b**c*` | three italics | italic containing bold |

Frequency, measured over 4564 of the owner's own documents with a hand-verified detector: **237
lines in 121 documents (2.7%)**. Not common — but where it happens it is in the most deliberate
prose (`**The trust sentence got *stronger*, not weaker**` renders entirely italic today), and the
current output is actively wrong rather than merely plain.

⚠️ The first attempt to measure this said **39.6%**, because the regex counted `**a** and **b**` —
two separate bolds on one line — as nesting. The corrected detector scans delimiter *runs* and was
validated against twelve known-answer cases before being pointed at the corpus. If you re-measure,
validate the ruler first; the shape of the characters and the order of the characters are different
questions and a regex only sees one of them.

### Why it needs a tokeniser

`markBoldItalic` in `packages/cssmd/cssmd.js` is one regex alternation:

```js
/((?<!\\)\*\*[^*\n]+\*\*|(?<!\\)\*[^*\s][^*\n]*?\*|…)/g
```

`[^*\n]+` is the whole problem: the content of a bold span may not contain an asterisk, so a nested
italic terminates the match early. No amount of regex fixes this — emphasis nesting is not a regular
language. CommonMark specifies it as a **delimiter-run stack**:

1. Scan the line into runs of `*` and `_` plus the text between them.
2. For each run decide whether it can open, can close, or both, from the characters on either side
   (left-flanking / right-flanking, plus the intraword rule for `_`).
3. Walk the stack matching closers to the nearest compatible opener, longest first, so `***x***`
   resolves as `**` around `*`.

Spec: <https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis> — the "process emphasis"
algorithm. Section score today: **77/132**.

### Constraints any implementation has to keep

- **Byte-exact round trip.** `test/edit-roundtrip.cjs`, 40 cases. Every delimiter stays in the text
  inside a `.tg-mk` span; the DOM's `textContent` must still join back to the source exactly.
- **Escapes still decline.** `\*not italic\*` must not emphasise, and the backslash hides via
  `markEscapes`, which runs LAST — every earlier pass has to still see the backslash in order to
  refuse.
- **The intraword `_` rule survives.** `snake_case_name` must stay literal. This was a real bug once;
  a page rendering ordinary prose grew bare underscores wherever an identifier appeared.
- **cssmd is shared.** `packages/cssmd` is `@tile/cssmd`, and feelreef's `renderInlineMd` is built on
  the same primitive with a `gd`/`gp` prefix — a change here changes already-published pages. See the
  open task about that handoff. `test/cssmd.test.cjs` (60 assertions) is the local gate.
- **Ordering inside `highlightLineParts`.** Block markers are wrapped before inline ones, and the
  strike pass runs BETWEEN bold and code. The cssmd passes are spliced into that chain rather than
  called as one wrapper, precisely so the order stays byte-identical.

### Suggested order

1. Write the delimiter-run tokeniser as a pure function beside `markBoldItalic`, exported but unused.
2. Test it against the spec's Emphasis section directly — 132 examples, a far better ruler than
   anything hand-written.
3. Swap `markBoldItalic` to call it. Watch `test/cssmd.test.cjs`, `test/edit-roundtrip.cjs` and
   `test/commonmark.test.cjs` — if any goes red, the tokeniser is wrong, not the test.
4. Re-run the score. The Emphasis section is 132 of 652 examples, so this is the largest single
   movement available.

## The two declared gaps, and why

**HTML blocks** (44 spec examples). Deliberately not implemented. In a *source* editor there is
nothing to render — `<div>` should look like `<div>`. Implementing it would move the score and change
nothing a person sees, which is the moment a ruler becomes a target.

**Reference link resolution.** `[a][r]` and `[^1]` are recognised and styled; nothing looks up what
`[r]` points at. That is the same job as resolving a `[[wikilink]]`, and in this family that job
belongs to the retrieval side (`ff`), not to the editor — the editor holds one document and has no
business keeping an index of the others.

## Everything that IS supported

Headings (ATX and setext) · bold · italic · strikethrough · inline code · fenced code blocks
(``` and ~~~) · indented code blocks · frontmatter · bullet, ordered and task lists · blockquotes ·
tables (gridded in place by `decorateTables`) · `[text](url)` · `![alt](url)` · `[[wikilink]]` ·
`<autolink>` · `[a][r]` · `[^1]` · reference definitions · thematic breaks · hard line breaks ·
backslash escapes · tags · `@{date}`.

Inside a fence or the frontmatter, **none** of it applies — those lines are text, which is the whole
point of `blockScan`.
