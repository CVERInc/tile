# text-edit

Click-to-edit words inside a rendered sitetile page. The owner taps a heading, paragraph or list
item in a framed preview and types; they never see HTML or Markdown. Bold stays bold and a link stays
a link because the coral only offers elements whose text is plain: an element with formatting inside
it shows a short "change it in the editor" hint instead, and links keep working as links.

- **Anchor.** The anchor is a source span that the renderer emits. The applier never re-derives it.
  The host renders the preview from `parseSite(md, { sourceLines: true })` (Astro:
  `SITETILE_SOURCE_SPANS=1`). Sitetile then stamps every paragraph, list item (its own line, without
  its child list) and heading that it draws from a prose body with `data-src="<first>-<last>"`. These
  are 0-based, inclusive lines of the page Markdown. Without the option, output is byte-identical
  to a production build. An edit names `{ section, start, end }` from the clicked element's
  `data-src`, plus the words that it replaces (`before`). The applier renders the same source the
  same way. It needs exactly one addressed element with that span in that section (else
  `not-found`) and needs it to show `before` (else `changed`). It also needs the span to be one
  line whose own words are `before`, written plainly (else `not-plain`). The applier never counts
  occurrences. An element without a span is not offered.
- **Revision.** The host stamps `data-revision` (`sourceRevision` of the Markdown it rendered). Every
  edit carries the revision it was computed against; any other one is refused (`changed`), so a
  stale preview or a concurrent edit never lands on a renumbered duplicate. A successful answer
  carries the next revision, and the section's new id (a title edit changes it).
- **One at a time.** The owner can keep typing; the next edit is computed and sent only after the
  previous one is answered, against acknowledged words (`before` is what the host last saved). An
  edit rewrites one line into one line, so the spans in the frame stay true after a save. A
  refusal puts the saved words back, even while the owner has the element focused again, unless
  newer words were typed over the refused ones; those stay and are sent next. A refused edit is
  never sent again without a new keystroke: focusing and leaving the element sends nothing. Each
  element is `idle`, `editing`, `pending`, `unknown`, `changed` or `refused` (`STATES` in
  text-edit-core.mjs). Only the
  host's answer ends `pending`: words typed while an edit of that element is outstanding are a
  draft, sent after a success against the new revision (Escape drops the draft, not the edit), so
  the preview never shows words as saved that the host did not save.
- **Unconfirmed words are marked.** The element carries its state in `data-text-edit` (absent
  when idle); the coral's stylesheet marks `pending`, and `unknown`/`changed`, with a dotted or wavy underline
  and lower opacity, without changing size or position.
- **Bounded wait.** An edit not answered within `PENDING_TIMEOUT_MS` (10 s) makes its element
  `unknown`: it shows the saved words, keeps anything being typed aside as a draft, takes no
  clicks, and the coral asks the host to read the span back. A late answer to the edit is still
  taken if it comes before the readback's answer; after that it is ignored. A readback that is not
  answered in time either leaves the element `unknown` and ends editing in that frame. Nothing else
  is sent while a readback is outstanding.
- **A readback settles an edit only at the sent revision.** If the revision read back is the one
  the edit was sent against, the page is exactly as it was: the span is the same paragraph, it
  shows `before`, and the edit did not land (`refused`; a kept draft is sent next). Any other
  revision means the page moved, by this frame's lost edit or by somebody else, so the frame's
  spans may now name other paragraphs: the element becomes `changed` (marked like `unknown`, shows
  the words it had, takes no clicks; only a fresh preview edits it). The revision and words read
  back are never adopted, and later edits keep the frame's own revision, which the host refuses
  if the page moved. Words equal to `before` at a moved revision do not settle it either: a
  duplicate paragraph inserted above can show them while the edited one holds the new words.
- **Document.** On mount the coral mints a random per-document nonce, `doc` (128 bits, 32 lowercase
  hex digits), and posts `{ type: 'reef-text-edit-ready', doc }` once, after its listeners are
  installed. Every message it posts carries the same `doc`, and an answer is taken only if it
  carries that `doc` back: an answer with another `doc`, or with none, is ignored. Ids (`e1`, `b1`)
  restart in every document, so a host addresses its answers by `doc`, not by id or by window: the
  frame's window is the same object across a navigation.
- **Probe (1.1.0).** A host can ask which document the frame shows now: it posts
  `{ type: 'reef-text-edit-probe', nonce }` (`nonce`: 1–64 characters of `A–Z a–z 0–9 _ -`) to the
  frame, and the coral answers `{ type: 'reef-text-edit-ready', doc, probe: nonce }` with the same
  `doc` as its first ready. Probes are taken only from the parent window at `data-parent-origin`,
  like every answer; anything else is ignored. A document without the coral (or with 1.0.0) answers
  nothing, which is how a host tells that the frame has moved somewhere it cannot edit. Additive:
  same channel `v1`.
- **1.0.0 is breaking for hosts: echo `doc`.** A host written for 0.1.0 answers without `doc`, and
  1.0.0 ignores every such answer, so an edit that host saved is shown as unconfirmed (`unknown`,
  with the old words) and its readback is ignored too. Accepting a missing `doc` would bring back the
  stale-answer bug, so it is not accepted. 1.0.0 is served on the registry channel **`v1`**; `v0`
  keeps 0.1.0 and is never repointed to 1.x. A host moves to `v1` in the same change that makes it
  echo `doc` on every `reef-text-edit-result` and `reef-text-edit-readback-result`.
- **Message.** `{ type: 'reef-text-edit', doc, id, page, revision, anchor, before, after }` to the parent
  window at `data-parent-origin` only; the answer is
  `{ type: 'reef-text-edit-result', doc, id, ok, hint?, revision?, section? }`, accepted only from that
  origin AND from the parent window itself. The origin must be one explicit http(s) origin (a
  trailing `/` is dropped); `*`, `null` and other spellings do not mount. A refusal puts the old
  words back and shows the hint. A success without `revision` ends editing in that frame.
- **Readback.** `{ type: 'reef-text-edit-readback', doc, id, page, revision, anchor }`, sent only when an
  edit's answer did not come in time (`revision` is the one that edit was made against). The host
  answers `{ type: 'reef-text-edit-readback-result', doc, id, ok, words?, revision?, section? }`, same
  origin and window rules: `words` is what the element stamped with the span `anchor.start`–
  `anchor.end` shows in the page as saved now, `revision` that page's `sourceRevision`, `section`
  the id of the section holding the span now (find the span by its lines: a title edit that landed
  changed the section's id). `text-edit-source.mjs` `readTextAt` is the reference. Anything but
  `ok: true` with words and a revision counts as no answer. The host answers for the span as the
  page is now and need not check that it is the same paragraph; the coral does that by revision.
- **Host contract.** The host processes the frame's messages in the order it receives them, one
  at a time: an edit is applied or refused before a later readback is read, and an edit it has not
  answered is never applied after it has answered a later readback. (Answers may be lost or late;
  the coral copes with that. Reordered processing would let a readback report words a later
  save then changes.)
- **Source rule.** `text-edit-source.mjs` resolves an edit against the page Markdown and rewrites
  exactly one line, keeping its indent, list marker or `## `. Only `prose` sections; only fragments
  written as plain words on one line that render exactly as written; `after` must be plain words
  the renderer shows as written, too, with no character the HTML parser drops or rewrites (C0/C1
  controls other than tab/LF/FF, CR, U+0000, U+FFFE/U+FFFF, lone surrogates): such words are
  refused (`after-not-plain`), and the coral does not send them in the first place.
- **Gestures.** Enter or leaving the element saves; Escape puts the words back; paste is plain text,
  one line. While an IME is composing, Enter and Escape belong to the IME.

Served by the coral registry like every dynamic coral (`/corals/text-edit/v1/text-edit.js`; `v0` stays on 0.1.0), but not
listed in the public coral catalog (`listed: false` in metadata.json): a host that embeds pages in a
frame adds the container and the script to its own framed page; a site owner never installs it.

<!-- coral metadata: start (generated by catalog-readme.mjs) -->
## text-edit metadata

Lets an owner change the words of a plain heading, paragraph or list item in a framed preview; posts a text-only edit to the host.

Author: `official`.

Host: `sitetile`. Renderer output inside a frame, rendered with source spans (`parseSite(md, { sourceLines: true })`, or `SITETILE_SOURCE_SPANS=1` for the Astro build) so editable elements carry `data-src`; elements without it are not offered. Only `prose` sections (the renderer's `section.st-prose[id]`) are offered; every other section's text is component text and stays untouchable. The host stamps `data-revision` from the Markdown it rendered, applies edits with text-edit-source.mjs (or a port measured against it), and answers with `reef-text-edit-result`, echoing the message's `doc` (the coral ignores an answer with any other `doc`, or none) and relaying `revision` and `section` from a successful apply. It processes the frame's messages in the order received, one at a time, and answers a `reef-text-edit-readback` with `reef-text-edit-readback-result` (same `doc`) (text-edit-source.mjs `readTextAt`). It answers a host's `reef-text-edit-probe` (`nonce`) from the parent origin with its ready, `{ type: 'reef-text-edit-ready', doc, probe: nonce }` (1.1.0). Served by the coral registry on channel `v1` (`/corals/text-edit/v1/text-edit.js`; 1.0.0 needs the host to echo `doc`, and `v0` stays on 0.1.0): the host adds the mount and the script to its own framed preview.

Not listed in the public coral catalog.

### Embed

```html
<div hidden data-dynamic-coral="text-edit" data-parent-origin="https://editor.example" data-revision="r1k-0123456789abcdef"></div>
<script src="https://feelreef.com/corals/text-edit/v1/text-edit.js"></script>
```

### Attributes

| Attribute | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `data-dynamic-coral` | enum | yes | — | Selects the text-edit coral. One per page. Values: `text-edit`. |
| `data-parent-origin` | string | yes | — | The only origin edits are posted to and answers are accepted from (answers must also come from the parent window itself). One http(s) origin written as the origin, a trailing slash allowed; `*`, `null`, paths and other spellings are refused. No default: the coral does not mount without it. |
| `data-revision` | string | yes | — | The source revision the page was rendered from (text-edit-source.mjs `sourceRevision`). Every edit carries it and the applier refuses any other; a successful answer carries the next one. No default: the coral does not mount without it. |
| `data-page` | string | no | — | The page path the host saves to. Absent: the frame's location.pathname. |
| `data-hint-editor` | string | no | — | The host's sentence for text that has formatting or structure (use the editor). |
| `data-hint-refused` | string | no | — | The host's sentence for a refused edit, when its answer carries none. |
| `data-hint-unknown` | string | no | — | The host's sentence for an edit whose answer did not come in time (its words are not confirmed, and the coral is reading them back). |

<!-- coral metadata: end -->
