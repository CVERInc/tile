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

`node scripts/commonmark-score.mjs` — **465/652 (71%)** of CommonMark 0.31.2, scored as *construct
recognition*, not conformance (this is not a renderer; there is no HTML to diff). `--misses` lists
what it got wrong.

`test/commonmark.test.cjs` is the gate that runs in CI: **57 claims, 2 declared gaps.** A gap is
asserted to STILL be missing, so implementing one turns the suite red with "remove it from GAPS and
add a claim()". The score can only move on purpose. It has already caught four of its own gaps
closing.

## Emphasis: nesting works, precedence does not

Emphasis used to be the one construct that rendered *wrong* rather than *missing*:
`**bold with *it* inside**` came out entirely italic with the bold lost, on every surface including
the two published Obsidian plugins. `markBoldItalic` was a single regex alternation whose bold
branch was `\*\*[^*\n]+\*\*`, and `[^*\n]+` is the whole problem — the content of a bold span could
not contain an asterisk, so a nested italic terminated the match early. No amount of regex fixes
that: emphasis nesting is not a regular language.

It is now `markEmphasis` in `packages/cssmd/cssmd.js`, CommonMark's delimiter-run stack (§6.2,
"process emphasis") in three passes — scan runs and decide flanking, match closers to openers, then
serialize. `markBoldItalic` remains as an alias for consumers outside this repo.

**Where it stands.** `node scripts/emphasis-conformance.mjs` runs the spec's own 132 Emphasis
examples through the real `highlightLineParts` and compares its output against the spec's real HTML
— actual conformance, possible here and nowhere else in this file, because `<em>`/`<strong>` are
exactly what these spans map onto. It scores the working tree against `HEAD`, so any future change
reports its own delta.

| | passing |
|---|---|
| the old regex | 50/132 |
| the tokeniser | 107/132 |
| …plus code and `<autolink>` moved ahead of emphasis | **111/132 (84.1%)**, round trip exact on all 132 |

**PRECEDENCE.** A code span's content is literal and an autolink's content is an address, so both
bind tighter than emphasis and now run first. `markEmphasis` treats a finished span as **opaque**, so
the reorder *is* the mechanism — no new code. That is also what stops an asterisk bullet
(`<span class="tg-mk">* </span>…`) pairing with real emphasis later on the line.

The link passes deliberately stay *after* emphasis even though the spec binds link brackets tighter
too: a link's TEXT is prose and routinely contains emphasis (`[*bar*](/url)`), and an opaque link
span would lose it. The price is the spec's own edge case `*[bar*](/url)`. Named, not hidden.

⚠️ When the code/autolink reorder landed, the score did not move — because this script used to run
the cssmd passes alone and could not see the core's passes at all. **A ruler that cannot see the
change you are making is not a ruler**; it now lifts the real `highlightLineParts` from both the
working tree and `HEAD`.

**The 21 that still fail, in full — 16 of them are not emphasis defects:**

| | n | what it is |
|---|---|---|
| `"` not encoded as `&quot;` | 6 | the harness. `escHtml` deliberately leaves quotes alone (content never lands in an attribute position); the emphasis in all six is correct |
| emphasis spanning a line break | 5 | architectural. One line is one `<div>`; a construct cannot cross that and stay a single-layer editor |
| a link inside the emphasis | 4 | the harness. It maps `<em>`, `<strong>`, `<code>` and autolinks, but not links proper — their spec form needs a destination it does not resolve |
| U+00A0 after a list marker | 1 | a REAL bug, and not in emphasis — see below |
| link brackets (`*[bar*](/url)`) | 2 | the deliberate trade above |
| raw HTML attributes | 3 | inside a declared gap; there is no HTML parser here to make `title="*"` opaque |

**A bug this ruler found by accident.** Example 353 looks like `* a *` and reads as an emphasis
miss. It is not: the spec's example uses U+00A0 on both sides, so CommonMark sees no list item —
a list marker must be followed by U+0020 or U+0009. `editor-core.js` matches `/^\s*[-*]\s/`, and JS
`\s` **includes U+00A0**, so it marks a bullet that is not there and Rendered then hides the
character the author typed. `markEmphasis` is already right about NBSP (`isMdSpace` uses `/\s/u`,
and treating it as whitespace is exactly what the flanking rules want); only the block-marker
regexes are wrong. Tracked separately, because it touches list parsing and deserves its own
measurement.

### Constraints any change here has to keep

- **Byte-exact round trip.** `test/edit-roundtrip.cjs`, 40 cases, plus a per-case round-trip
  assertion in `test/emphasis.test.cjs` and a round-trip line in the conformance script. Every
  delimiter either sits inside a `.tg-mk` span or stays in the text as the literal it turned out to
  be; the DOM's `textContent` must still join back to the source exactly.
- **Escapes still decline.** `\*not italic\*` must not emphasise. The scanner consumes `\x` as one
  unit, so it counts backslashes rather than peering behind one — which is why `\\*a*` (escaped
  backslash, then real emphasis) now works, a case the old regex documented as a known limit.
- **The intraword `_` rule survives.** `snake_case_name` must stay literal. This was a real bug once;
  a page rendering ordinary prose grew bare underscores wherever an identifier appeared.
- **cssmd is shared.** `packages/cssmd` is `@tile/cssmd`; feelreef vendors it (tile-lab →
  `reef-mcp/vendor/cssmd`) with a `gd`/`gp` prefix, behind two manual refresh scripts and a
  byte-exact freshness test. Nothing propagates on its own. `test/cssmd.test.cjs` (61 assertions) is
  the local gate.
- **Ordering inside `highlightLineParts`.** Block markers first, then the constructs that bind
  tighter than emphasis (`code`, `<autolink>`), then emphasis, then everything else. The cssmd passes
  are spliced into that chain rather than called as one wrapper, precisely so the order stays
  byte-identical. `test/parity-highlightLineParts.test.cjs` holds 68 golden outputs against exactly
  this, and `test/emphasis.test.cjs` asserts three cases that only pass while the order holds.

⚠️ On measuring frequency, kept because the mistake is the useful part: the first attempt said
nested emphasis appeared on **39.6%** of the owner's lines. It was **2.7%** (237 lines in 121 of
4564 documents) — the detector had counted `**a** and **b**`, two separate bolds on one line, as
nesting. The corrected one scans delimiter *runs* and was validated against twelve known-answer
cases before being pointed at the corpus. Validate the ruler first; the shape of the characters and
the order of the characters are different questions and a regex only sees one of them.

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
