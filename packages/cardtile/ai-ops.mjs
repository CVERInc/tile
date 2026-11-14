// REEF with Card — the shared ai_ops definition.
//
// `reef/docs/SPEC-ai-door-capability-parity.md` is 🔒 LOCKED, and §4.3 is the rule this file exists
// to obey: 「任何新能力**先進共享 ai_ops 定義**,兩軌由此繼承;**禁止只長在一軌**」. So the Card's
// capability surface is written HERE, once, and every door consumes it:
//
//   · cardtile-w   (the human editor) — builds its forms from CELL_TYPES
//   · MCP          (the ownership track) — the tool contract in OPS
//   · GAIDO        (the convenience track) — owes this and does not have it yet; see DEBT below
//
// 🔴 HONEST SCOPE, so nobody reads more into the drift test than it proves. Today this definition
// has ONE consumer. `ai-ops.test.mjs` therefore asserts that the definition tracks THE RENDERER —
// it cannot yet assert that two doors agree, because the second door does not exist. That is a
// weaker claim than parity and it is labelled as one. When GAIDO grows a Card capability, the same
// test gains its second half.
//
// 🔴 EVERY param the renderer reads is listed, with a DISPOSITION. That is the invariant: the union
// of what is declared here must equal what card-render.mjs actually reads, in both directions. A
// param the renderer honours and this file has never heard of is a silent capability — the author
// can write it, one door can edit it, and another door will drop it on save.

/** how a param reaches an author */
export const DISPOSITION = {
  /** has a control in the editor's form, and a named field in the tool contract */
  FORM: 'form',
  /** real and honoured, but edited through the raw param string only — see each one's reason */
  RAW: 'raw',
  /** the renderer no longer honours it. Never written; never offered. Left in files that have it. */
  RETIRED: 'retired',
};

export const CONTROL = { TEXT: 'text', AREA: 'area', URL: 'url', SWITCH: 'switch', ASSET: 'asset', SELECT: 'select' };

/**
 * 🔴 WHERE A FORM ROW GETS ITS VALUE. `params` above declares the CAPABILITY surface (what the
 * renderer honours — that is what ai-ops.test.mjs guards, in both directions). `form` below declares
 * the HUMAN surface: which rows a person sees, in what order, and where each row's value lives.
 * They are not the same list and must not be conflated — the review's headline finding was a form
 * that asked a stranger to type `[顯示文字](網址)` because "the body" was a form field.
 *
 *   PARAM    the row IS a declared param; label/control/hint come from `params[name]`
 *   BODY     the row is the cell's body, verbatim
 *   DERIVED  the row is one PART of something the editor composes (a link's text and its address
 *            are two fields and one body; a profile's name is not on the cell at all — it is the
 *            file's frontmatter `title:`). w/editor.mjs owns the codec; this file owns the shape.
 */
export const SOURCE = { PARAM: 'param', BODY: 'body', DERIVED: 'derived' };

const WIDTH = {
  disposition: DISPOSITION.FORM, label: 'width.label', control: CONTROL.SELECT,
  options: ['1', '2', '3', '4', '5', '6'], hint: 'width.hint',
  // the two widths worth naming in words. Everything else is just its number — see w/cell-i18n.mjs.
  optionLabels: { 6: 'width.6', 3: 'width.3' },
};

// `back=#id` opens one of the card's `## back:` lanes as this tile's other side (reef#2725). RAW: the
// editor sets it by picking a back, not by typing an id, and that picker is a separate change.
// Honoured by the four types card-render gives a door or a back anchor (DOOR_TYPES + link/feature).
const BACK = { disposition: DISPOSITION.RAW, label: 'back.label', hint: 'back.hint' };

/**
 * Params every cell has, whatever its type. Read by `packGrid` (w) and `renderGrid` (bleed) rather
 * than by any one `case`, which is why a per-type scan alone would miss them.
 */
export const UNIVERSAL = {
  w: WIDTH,
  bleed: {
    // 🩸 RAW params have no form field, but they are not unseen: reef-mcp's describe_card_grammar
    // hands every param's label/hint to an agent in English. These were Chinese literals (reef#1081).
    disposition: DISPOSITION.RAW, label: 'bleed.label', hint: 'bleed.hint',
  },
  // 🔴 There is ONE layout model: height comes from content and the renderer sets `grid-row:auto`.
  // `setSpan` wrote an `h` token as late as 2026-07-29, which made drag-to-resize the one path that
  // could put a dead parameter back into a creator's file — where it serialises cleanly, reads as
  // "just a span" in review, and does nothing. An editor is exactly where this comes back to life.
  // Declared RETIRED rather than deleted so the drift test can assert it is never offered.
  h: { disposition: DISPOSITION.RETIRED, label: 'h', hint: '已退役。renderer 不再理它。' },
};

/**
 * 🔴 ONE STORED WORD, TWO CELLS. Before `slides` had a name, the carousel was spelled `embed`, and
 * cards saved then still say `- [ ] %% card: embed kind=slider images=… %%`. card-core.js reads such
 * a line as `slides` (`legacySlides`: the word `embed` plus a `kind=` token) and writes it back as
 * `embed` for as long as the `kind=` token is there. The editor opens it as a slideshow, so no person
 * needs telling; an agent reads the stored markdown, sees `embed`, and — told only that `embed` is
 * pasted HTML — rewrites the line with embed's fields and the slideshow is gone.
 *
 * `spelling` is that rule in words, for the agent door (reef-mcp's describe_card_grammar). It is
 * English and deliberately not a key in w/cell-i18n.mjs: no form shows it, like OPS's contract text.
 * ai-ops.test.mjs checks the params it names against what the renderer reads (`origin-narrow` is read
 * by bracket and is not in `slides.params`); embed-html.test.mjs checks its claims against the
 * parser and the renderer.
 */
const LEGACY_SLIDES = {
  fromEmbed:
    'A line spelled `embed` that carries a `kind=` token is not an HTML embed: it is the legacy spelling of `slides`, and saving it keeps the word `embed`. ' +
    'It draws a slideshow only when `kind` is `slider` or `bubbles`; with an empty value (`kind=""`), no value (`kind=`) or any other value it draws nothing. ' +
    'Instead of an HTML body it carries the slides params: kind, images, origin, narrow, origin-narrow, bg, w, bleed (`origin-narrow` is the older name of `narrow`; when both are present, a nonempty `narrow` wins, and an empty `narrow=""` falls back to `origin-narrow`). ' +
    'The same params under the word `slides` draw the same thing, except that `slides` draws a slider when `kind` has no value (`kind=` or no `kind` at all), so rewriting a legacy line whose `kind=` has no value as `slides` makes its images visible. ' +
    'Removing `kind=` from a line spelled `embed` makes it an HTML embed, and the slideshow is gone.',
  fromSlides:
    'Cards saved before this cell had its own name use a legacy spelling for it: `embed` with a `kind=` token, e.g. `- [ ] %% card: embed kind=slider images=… %%`. ' +
    'That line is this cell, not an HTML embed, and saving it keeps the word `embed`. ' +
    'It carries the same params: kind, images, origin, narrow, origin-narrow, bg, w, bleed (`origin-narrow` is the older name of `narrow`, read under either spelling; when both are present, a nonempty `narrow` wins, and an empty `narrow=""` falls back to `origin-narrow`). ' +
    'A legacy line draws a slideshow only when `kind` is `slider` or `bubbles`; with an empty value (`kind=""`), no value (`kind=`) or any other value it draws nothing. ' +
    'This cell draws a slider when `kind` has no value (`kind=` or no `kind` at all), so rewriting a legacy line whose `kind=` has no value as `slides` makes its images visible; otherwise the same params under either word draw the same thing. ' +
    'Removing `kind=` from a line spelled `embed` makes it an HTML embed, and the slideshow is gone.',
};

/**
 * type → what it is, what its body means, and every param it honours.
 *
 * `body` is the one field that is not a param, and what it MEANS differs per type — a tagline, an
 * eyebrow, a link's `[label](url)`, prose. So each type says what its body is rather than every form
 * showing a box called "body".
 */
export const CELL_TYPES = {
  profile: {
    title: 'type.profile.title',
    hint: 'type.profile.hint',
    body: { label: 'type.profile.body.label', control: CONTROL.AREA, hint: '', rows: 2 },
    params: {
      avatar: { disposition: DISPOSITION.FORM, label: 'type.profile.avatar.label', control: CONTROL.ASSET, hint: 'type.profile.avatar.hint' },
      chips: { disposition: DISPOSITION.FORM, label: 'type.profile.chips.label', control: CONTROL.TEXT, hint: 'type.profile.chips.hint' },
      back: BACK,
    },
    // 🔴 `name` is DERIVED and it is the reason this whole mechanism exists. The name a visitor sees
    // is the FILE's frontmatter `title:`, not anything on this cell — so "改名字" had no field at
    // all, and the old hint told a stranger to go and edit frontmatter they could not see.
    form: [
      { source: SOURCE.DERIVED, name: 'name', label: 'type.profile.name.label', control: CONTROL.TEXT, hint: '', required: true },
      { source: SOURCE.PARAM, name: 'avatar' },
      { source: SOURCE.BODY },
      { source: SOURCE.PARAM, name: 'chips' },
    ],
  },

  link: {
    title: 'type.link.title',
    hint: 'type.link.hint',
    body: { label: 'type.link.text.label', control: CONTROL.TEXT, hint: '' },
    params: {
      sub: { disposition: DISPOSITION.FORM, label: 'type.link.sub.label', control: CONTROL.TEXT, hint: '' },
      icon: { disposition: DISPOSITION.FORM, label: 'type.link.icon.label', control: CONTROL.TEXT, hint: 'type.link.icon.hint' },
      iconhost: { disposition: DISPOSITION.FORM, label: 'type.link.iconhost.label', control: CONTROL.URL, hint: '' },
      iconimg: { disposition: DISPOSITION.FORM, label: 'type.link.iconimg.label', control: CONTROL.ASSET, hint: 'type.link.iconimg.hint' },
      w: WIDTH,
      back: BACK,
    },
    // text + address are TWO fields and ONE body (`[text](url)`). The editor composes them; nobody
    // is ever shown, or asked to type, the square brackets.
    form: [
      { source: SOURCE.DERIVED, name: 'text', label: 'type.link.text.label', control: CONTROL.TEXT, hint: '' },
      { source: SOURCE.DERIVED, name: 'target', label: 'type.link.target.label', control: CONTROL.SELECT, hint: '', drawers: true },
      {
        source: SOURCE.DERIVED, name: 'url', label: 'type.link.url.label', control: CONTROL.URL, required: true,
        hint: 'type.link.url.hint', showWhen: { target: '' },
      },
      { source: SOURCE.PARAM, name: 'sub' },
      { source: SOURCE.PARAM, name: 'w' },
      { group: 'type.link.advanced', rows: [
        { source: SOURCE.PARAM, name: 'icon' },
        { source: SOURCE.PARAM, name: 'iconhost' },
        { source: SOURCE.PARAM, name: 'iconimg' },
      ] },
    ],
  },

  feature: {
    title: 'type.feature.title',
    hint: 'type.feature.hint',
    body: { label: 'type.feature.body.label', control: CONTROL.TEXT, hint: '' },
    params: {
      img: { disposition: DISPOSITION.FORM, label: 'type.feature.img.label', control: CONTROL.ASSET, hint: '' },
      href: { disposition: DISPOSITION.FORM, label: 'type.feature.href.label', control: CONTROL.URL, hint: '' },
      alt: { disposition: DISPOSITION.FORM, label: 'type.feature.alt.label', control: CONTROL.TEXT, hint: 'type.feature.alt.hint' },
      label: { disposition: DISPOSITION.FORM, label: 'type.feature.label.label', control: CONTROL.SWITCH, hint: '' },
      title: { disposition: DISPOSITION.FORM, label: 'type.feature.title.label', control: CONTROL.TEXT, hint: '' },
      cta: { disposition: DISPOSITION.FORM, label: 'type.feature.cta.label', control: CONTROL.TEXT, hint: 'type.feature.cta.hint' },
      w: WIDTH,
      back: BACK,
    },
    form: [
      { source: SOURCE.PARAM, name: 'img' },
      { source: SOURCE.PARAM, name: 'alt' },
      { source: SOURCE.PARAM, name: 'label' },
      { source: SOURCE.DERIVED, name: 'target', label: 'type.feature.target.label', control: CONTROL.SELECT, hint: '', drawers: true, optional: true },
      { source: SOURCE.PARAM, name: 'href', showWhen: { target: '' } },
      { source: SOURCE.PARAM, name: 'w' },
      { group: 'type.feature.advanced', rows: [
        { source: SOURCE.PARAM, name: 'title' },
        { source: SOURCE.BODY },
        { source: SOURCE.PARAM, name: 'cta' },
      ] },
    ],
  },

  text: {
    title: 'type.text.title',
    hint: 'type.text.hint',
    body: { label: 'type.text.body.label', control: CONTROL.AREA, hint: 'type.text.body.hint', rows: 6 },
    params: { back: BACK },
    form: [{ source: SOURCE.BODY }],
  },

  video: {
    title: 'type.video.title',
    hint: 'type.video.hint',
    body: { label: 'type.video.body.label', control: CONTROL.TEXT, hint: 'type.video.body.hint' },
    params: {
      yt: { disposition: DISPOSITION.FORM, label: 'type.video.yt.label', control: CONTROL.TEXT, hint: 'type.video.yt.hint' },
      channel: { disposition: DISPOSITION.FORM, label: 'type.video.channel.label', control: CONTROL.TEXT, hint: 'type.video.channel.hint' },
      poster: { disposition: DISPOSITION.FORM, label: 'type.video.poster.label', control: CONTROL.ASSET, hint: 'type.video.poster.hint' },
      // 🔴 The renderer reads this as a FALLBACK behind the body: `b || p.title || hit.title`. Two
      // form fields that both mean "the label" and silently outrank each other is a worse editor
      // than one. Honoured, editable in the raw string, not offered twice.
      title: { disposition: DISPOSITION.RAW, label: 'type.video.title.label', hint: 'type.video.title.hint' },
      w: WIDTH,
    },
  },

  social: {
    title: 'type.social.title',
    hint: 'type.social.hint',
    body: { label: 'type.social.body.label', control: CONTROL.AREA, hint: 'type.social.body.hint' },
    params: {},
  },

  slides: {
    title: 'type.slides.title',
    hint: 'type.slides.hint',
    body: null,
    params: {
      // 🔴 `slider` is the COMMON one and holds the common name. `bubbles` was what `slider` used to
      // mean for everybody — a bespoke pop built for one card (scale(0.001)→scale(1) about a tail
      // origin, 1:1, no controls), so every imported carousel inherited a character's mouth.
      kind: {
        disposition: DISPOSITION.FORM, label: 'type.slides.kind.label', control: CONTROL.SELECT,
        options: ['slider', 'bubbles'],
        // what a person reads: the style's name, never the stored word
        optionLabels: { slider: 'type.slides.kind.slider', bubbles: 'type.slides.kind.bubbles' },
        hint: 'type.slides.kind.hint',
      },
      images: { disposition: DISPOSITION.FORM, label: 'type.slides.images.label', control: CONTROL.TEXT, hint: 'type.slides.images.hint' },
      // Positioning knobs for the slider's focal point. Real, honoured, and the kind of thing an
      // author sets once with a picture in front of them — a form field for a CSS `object-position`
      // pair would be a worse UI than the string itself.
      origin: { disposition: DISPOSITION.RAW, label: 'type.slides.origin.label', hint: 'type.slides.origin.hint' },
      narrow: { disposition: DISPOSITION.RAW, label: 'type.slides.narrow.label', hint: 'type.slides.narrow.hint' },
      bg: { disposition: DISPOSITION.RAW, label: 'type.slides.bg.label', hint: 'type.slides.bg.hint' },
      w: WIDTH,
    },
    spelling: LEGACY_SLIDES.fromSlides,
  },

  // 🔴 HTML, scripts included (reef#2725). Rendered in `<iframe sandbox="allow-scripts" srcdoc>` —
  // an opaque origin that cannot reach the card's storage or navigate the page (card-render.mjs,
  // renderEmbedHtml). No params of its own: it is as wide as `w` and as tall as it is wide.
  embed: {
    title: 'type.embed.title',
    hint: 'type.embed.hint',
    body: { label: 'type.embed.body.label', control: CONTROL.AREA, hint: 'type.embed.body.hint', rows: 10 },
    params: { w: WIDTH },
    form: [{ source: SOURCE.BODY }, { source: SOURCE.PARAM, name: 'w' }],
    spelling: LEGACY_SLIDES.fromEmbed,
  },
};

/**
 * The palette's order.
 *
 * 🩸 Was most-used-first (`link` … `profile` sixth, `embed` last), which is true of LIVE cards and
 * false of a first visit: the first thing anybody wants to do is put their own name and face on it,
 * and that meant scrolling past five things they do not recognise to reach the one they came for.
 * `profile` leads now — and it only became worth reaching once its name field existed at all.
 */
export const PALETTE = ['profile', 'link', 'feature', 'text', 'video', 'social', 'slides', 'embed'];

/**
 * What a new cell starts as. Deliberately NOT empty: an empty cell renders to nothing (a link with
 * no url, a video with neither id), which drops the author onto a card where the thing they just
 * added is invisible. These render as visibly unfinished instead.
 */
export const BLANKS = {
  profile: { type: 'profile', rawParams: 'w=6', body: 'blank.profile' },
  // 🩸 was `[新的連結](https://example.com)`. Two things wrong with it, and the second is the worse
  // one: the words were Chinese in all nine locales, and `example.com` is a REAL address — so a
  // brand-new tile rendered as a FINISHED-looking button that went somewhere nobody meant. Words
  // and no address renders as the 「還沒填網址」 outline, which is what it honestly is.
  link: { type: 'link', rawParams: 'w=6', body: 'blank.link.text' },
  feature: { type: 'feature', rawParams: 'w=3', body: '' },
  text: { type: 'text', rawParams: '', body: 'blank.text' },
  video: { type: 'video', rawParams: 'w=6', body: '' },
  // 🔴 NOT a key, and deliberately not translated: this one is a brand name, identical in all nine,
  // and it has to stay a whole `[name](url)` line because that is the grammar a social row reads.
  social: { type: 'social', rawParams: 'w=6', body: '[Instagram](https://instagram.com/)' },
  slides: { type: 'slides', rawParams: 'kind=slider w=6', body: '' },
  // 🔴 NOT a key, and not translated — like `social`'s, it is code, and identical in all nine. It
  // shows the one thing worth knowing on first sight: the card's own colours reach inside.
  embed: { type: 'embed', rawParams: 'w=3', body: '<div style="display:grid;place-items:center;height:100vh;font:600 2rem system-ui;color:var(--cp-accent-bright)">&lt;/&gt;</div>' },
};

/**
 * A new tile of `type`, in `locale`'s own words.
 *
 * 🔴 `BLANKS` above holds KEYS, not sentences — the bodies used to be Chinese literals, so an
 * English visitor pressing "Add a tile → Text" watched 「寫點什麼。」 appear on their own card. This
 * is the one place that resolves them, and it takes the table as an argument rather than importing
 * w/cell-i18n.mjs: this file is the SHARED definition and must stay free of the editor's surfaces.
 */
export function blankCell(type, strings = {}) {
  const blank = BLANKS[type];
  if (!blank) return null;
  const body = Object.prototype.hasOwnProperty.call(strings, blank.body) ? strings[blank.body] : blank.body;
  return { ...blank, body };
}

/**
 * The OPERATIONS a door offers on a Card. Shaped after reef-MCP's `get_page` / `save_page` on
 * purpose — a second grammar for the same job is drift.
 *
 * `seat` uses COAM's vocabulary WITH its prefix (`reef/docs/SPEC-coam.md` §2, the product owner 2026-07-30):
 * CO / CA / CM are the CUSTOMER's Owner / Admin / Manager. fO — feelreef's own Owner — is NOT on
 * this list and that is deliberate: 「fO 不是客戶站的隱形超級帳號」.
 */
export const SEAT = { READ: 'CO|CA|CM', WRITE: 'CO|CA' };

export const OPS = {
  list_cards: { seat: SEAT.READ, params: [], returns: 'handle, title, live_url, bytes, assets, version' },
  get_cards: {
    seat: SEAT.READ,
    params: ['handle', 'assets: "summary" | "inline"'],
    // 🔴 summary is the DEFAULT and inline must be asked for by name. One real card is 1,159,422
    // bytes of which 3,277 is the card; handing an agent the whole file makes "read, change, write —
    // one transaction" cost 2.3MB per edited character. And the two are not one call with a flag:
    // a BACKUP taken over the summary exit is 99.7% missing, and what is missing is the pictures.
    returns: 'the card WITHOUT the assets lane, plus an asset manifest',
  },
  save_cards: {
    // 🔴 WRITE, not READ, and specifically not `save_page`'s grade — which is ungated in reef-MCP
    // today. A Site edit does not go live until someone publishes; a Card has no publish step, so
    // the save IS the deploy. Copying save_page's gate would let a CM — someone explicitly not
    // allowed to publish a Site — push straight onto a creator's own apex domain. The parity spec's
    // Tier-1 floor lists 「publish 人類閘」 as a universal hard gate.
    seat: SEAT.WRITE,
    params: ['handle', 'markdown (thin)', 'base_version', 'prompt', 'dry_run', 'message'],
    returns: 'structural diff, new version, and ORPHANED assets — reported, never collected',
  },
  put_asset: { seat: SEAT.WRITE, params: ['handle', 'id', 'base64', 'mime'], returns: 'id, bytes' },
  delete_asset: { seat: SEAT.WRITE, params: ['handle', 'id', 'expected_version'], returns: 'refuses while still referenced; with expected_version (tile#209), also if the card moved since that read' },
  preview_cards: { seat: SEAT.READ, params: ['handle', 'markdown'], returns: 'a URL. An agent that cannot look at what it did is guessing.' },
};

/**
 * The names three ops had before they took the product's noun (docs/VOCABULARY.md): former → current.
 *
 * OPS holds only the current names. A consumer that exposes these ops as tools keeps each former
 * name callable, as an alias of the op it maps to, for a short window, so a caller that still says
 * the old name is not broken by the rename itself. This map is the one list of what that window
 * covers, and it is deleted when the window closes: once it is gone, the former names are gone.
 * Nothing here is a second definition; an alias has no seat, params or returns of its own.
 */
export const OPS_FORMER_NAMES = Object.freeze({
  get_card: 'get_cards',
  save_card: 'save_cards',
  preview_card: 'preview_cards',
});

/**
 * 🔴 THE DEBT, written down rather than discovered.
 *
 * SPEC-ai-door-capability-parity §0: 「一個能力只長在一條軌上,是**對 canon 的違規**」. The moment MCP
 * can edit a cardtile Card, cardtile is an X on one track. GAIDO owes the same, from this file.
 *
 * ⚠️ That spec warns about this by name: 投資流向 MCP(JS) 側,新能力容易先落 MCP、GAIDO 落後。
 * 「別讓『暫時只能長一邊』變成『永久只長一邊』。」
 *
 * NB the canon's "Card" is the block-JSON one (`catalog.snapshot.json`: sizes 1x1…3x3, types
 * alliance / announcements / button / cover / divider). cardtile is a different artifact, and its
 * Heroku predecessor is a strangler target rather than a core to reuse — ruled by the product owner
 * 2026-07-30: 「MixFairy 是 Bot」.
 */
export const DEBT = {
  gaido_card: 'GAIDO has no cardtile-Card capability. Owed from this definition, not re-derived.',
};

// ── THE WHOLE CARD ───────────────────────────────────────────────────────────────────────────────
//
// Everything above is one CELL. What follows belongs to the whole card: its frontmatter keys, its
// backs, the geometry rules, and the host ↔ editor contract. Same style and the same rule: it is
// written down HERE, once, for every door, and ai-ops.test.mjs holds it equal to the code that reads
// it. Plain data, English, no imports — this file is vendored as-is by consumers that have no access
// to the rest of the package.

/**
 * Frontmatter: the `---` fence at the top of the file, one `key: value` per line.
 *
 * 🔴 A key at its default is written as NO LINE AT ALL — never `theme: auto`, never `views: stack list
 * wall`. The editor removes a line when its control goes back to the default (w3/card-settings.mjs
 * fmWrite), so a file that spells a default out is a file the editor will rewrite on its next save.
 */
export const FRONTMATTER = {
  fence: 'The file starts with `---`, then one `key: value` per line, then `---`. Values are one line each.',
  defaultIsNoLine: 'A key at its default is written as no line at all. Remove the line to go back to the default.',
  quoting: 'Values are written unquoted, except `back`, which is written in double quotes because a bare `#` starts a YAML comment.',
  unknown: 'Keys not listed in CARD_SETTINGS are kept in the file and do nothing.',
};

/**
 * tile#304 — which file of a Card in several languages decides a key (see LANGUAGE_FILES):
 *   LANGUAGE  each language file may carry its own (only `title` and `lang`)
 *   CARD      the main file decides it for the whole Card; a language file that carries it is refused
 *             on write, and the key is ignored on read
 */
export const SCOPE = { LANGUAGE: 'language', CARD: 'card' };

/**
 * Every frontmatter key real code reads, and what it accepts. `disposition` as for cell params:
 * FORM = the editor's Cards settings sheet writes it; RAW = honoured, written by hand only.
 * `scope` = which file decides it when the Card has several languages (SCOPE).
 * `setting` = the name w3/card-settings.mjs applySetting takes for it (absent: applySetting does not
 * write it). `values` = the exact words when the set is closed, else a description of the shape.
 * `default` = what happens when the line is absent.
 *
 * Readers (cited per key below):
 *   renderer   serve/card-worker.mjs renderFlat — `fm('<key>')` / cardName, then card-render.mjs
 *   deck       w3/deck-page.mjs DECK_KEYS → w3/deck.js (`views`, `view`, `back`)
 *   editor     w3/card-settings.mjs applySetting, w3/edit3.mjs (the default back)
 *   languages  languages.mjs (`locales`, and `title` / `lang` of a language file)
 * The claim (`card-page:` / `cardtile:`, claim.mjs) is not a setting and is not listed here; it is
 * SCOPE.CARD like every key below but `title` and `lang`.
 */
export const CARD_SETTINGS = {
  // serve/card-worker.mjs cardName → <title>, the footer's owner name, share tags; the profile cell's name
  title: {
    disposition: DISPOSITION.FORM, scope: SCOPE.LANGUAGE, setting: 'title',
    values: 'One line of text, unquoted (the renderer does not strip quotes from `title`).',
    default: "The card's handle.",
  },
  // card-worker fm('accent') → card-render cssColor
  accent: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'accent',
    values: 'A CSS colour. The editor writes `#rrggbb` in lowercase; the renderer also accepts #rgb, #rgba, #rrggbbaa, rgb()/rgba()/hsl()/hsla() and CSS colour names. Anything else falls back to the default.',
    default: 'The platform accent, #0a8c8e.',
  },
  // card-worker fm('theme') → card-render: only `light` / `dark` pin it
  theme: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'theme',
    values: ['light', 'dark'],
    default: "Follows the visitor's system setting.",
  },
  // card-worker fm('header') → card-render: `left` (case-insensitive) adds st-card-head-left
  header: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'header',
    values: ['left'],
    default: 'The avatar is centred above the name.',
  },
  // card-worker fm('icons') → card-render: mono|grey|gray|monochrome greys fetched marks
  icons: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'icons',
    values: ['mono'],
    default: 'Fetched brand marks keep their colours.',
    note: 'The renderer also reads `grey`, `gray` and `monochrome` as `mono`; the editor writes `mono`.',
  },
  // card-worker fm('backdrop') → card-render resolveAsset
  backdrop: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'backdrop',
    values: 'A fixed image behind the whole card: `asset:<id>` (an id in the `## assets` lane) or an image URL.',
    default: 'No backdrop.',
  },
  // card-worker fm('backdrop-dim') → colour.mjs resolveBackdropDim
  'backdrop-dim': {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'backdrop-dim',
    values: 'A number from 0 to 100: how much of a scrim covers the backdrop. No `%`. The editor offers 0, 25, 45 and 65.',
    default: "Derived from the accent. A value that is not a number also means the default, not 0. Only matters with `backdrop`.",
  },
  // w3/deck.js FM.views; w3/card-settings.mjs VIEW_IDS / readViews
  views: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD, setting: 'views',
    values: ['stack', 'list', 'wall'],
    shape: 'The views a visitor may switch between, separated by spaces, written in the order stack list wall. One view hides the switcher.',
    default: 'All three.',
  },
  // w3/deck.js FM.view; written by applySetting('views', { on, open })
  view: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD,
    values: ['stack', 'list', 'wall'],
    shape: 'The view the card opens on. Must be one of `views`. Written by the `views` setting, not on its own.',
    default: 'The first view in `views`. A visitor who switched views gets their own last pick, when it is still offered.',
  },
  // w3/deck.js FM.back; w3/edit3.mjs defId / addDefault
  back: {
    disposition: DISPOSITION.FORM, scope: SCOPE.CARD,
    values: 'A double-quoted pointer to a back lane: `back: "#about"` names `## back: about`. Same pointer as a tile\'s `back=#about`. See BACKS.',
    default: "The printed business card: the card's name, a QR code and its address.",
  },
  // card-worker fm('arrows') → card-render arrowOf: only `on`
  arrows: {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: ['on'],
    default: 'No arrow on link rows and calls to action.',
  },
  // card-worker fm('since') → the footer's `© <since>–<this year>`
  since: {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: 'A year, shown as the start of the footer copyright range.',
    default: 'The footer shows this year only.',
  },
  // card-worker fm('radius') → card-render: only `square`
  radius: {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: ['square'],
    default: 'Rounded tiles.',
  },
  // card-worker fm('lang') → card-render <html lang>, and the deck's own words (w3/deck-i18n.mjs)
  lang: {
    disposition: DISPOSITION.RAW, scope: SCOPE.LANGUAGE,
    values: 'A BCP 47 language tag, e.g. `zh-TW`. Anything that does not look like one is `en`.',
    default: 'en',
  },
  // card-worker fm('generator') → card-render generatorTag
  generator: {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: '`off` (also false/no/none) removes the generator meta tag; any other value replaces its text.',
    default: '`<meta name="generator" content="feelreef">`.',
  },
  // card-worker fm('powered-by') === 'on' → card-render footer
  'powered-by': {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: ['on'],
    default: 'No credit link in the footer.',
    note: 'Ignored whenever the platform states whether the card is in the card pool; that switch then decides the footer link.',
  },
  // languages.mjs readLocales / languagesOf (tile#304) → card-worker's language choice and the language-file API
  locales: {
    disposition: DISPOSITION.RAW, scope: SCOPE.CARD,
    values: 'The languages the Card exists in: BCP 47 tags as a list, e.g. `[en-US, ja-JP]`, at most 12, including the main file\'s own `lang`. Each other listed tag may have a language file (see LANGUAGE_FILES).',
    default: 'One language: the main file only.',
  },
};

/**
 * tile#304 — a Card in several languages: one file per language, never several languages in one file,
 * and never a language in the address. Plain data for every door, like the rest of this file;
 * languages.mjs is the code, and ai-ops-card.test.mjs holds the two equal.
 */
export const LANGUAGE_FILES = {
  model: 'The main file is the Card. Its `locales:` lists the languages; every listed tag other than the main file\'s own `lang` may have a language file: a complete card file in the same grammar, holding the owner\'s words in that language. Keeping its tiles in step with the main file is the writer\'s job; the engine does not compare them.',
  keys: 'A language file\'s frontmatter may carry only `title` and `lang` (SCOPE.LANGUAGE). Every other key, the claim and `locales` included, is the main file\'s (SCOPE.CARD): refused on write (`cards_language_key_refused`), ignored on read.',
  lang: 'A language file\'s `lang` must be the tag it is stored under (`cards_language_lang_mismatch`); without it, the tag is its `lang`.',
  assets: 'One assets lane per Card: the main file\'s. A language file refers to the same `asset:<id>`s; an assets lane sent with a language file is dropped, as a save drops the caller\'s.',
  served: 'A visitor gets a listed language\'s file by `?lang=<tag>` or by Accept-Language; the file served is the language file\'s title and tiles over the main file\'s other keys and assets. An unlisted or unknown language, or a listed one with no file, gets the main file.',
  limits: 'At most 12 tags in `locales:`; each file obeys the per-file byte ceiling.',
  routes: {
    read: 'GET /_api/cards/<handle>/lang/<tag> → { handle, lang, version, markdown (thin), assets (the main file\'s, referenced by this file), total_bytes }',
    read_full: 'GET /_api/cards/<handle>/lang/<tag>/full → the file with the main file\'s assets lane',
    save: 'PUT /_api/cards/<handle>/lang/<tag> { markdown, base_version (this file\'s version), dry_run }',
    delete: 'DELETE /_api/cards/<handle>/lang/<tag> (If-Version: <this file\'s version>, optional)',
    main: 'The main file\'s routes take no `?lang=` (`cards_language_use_path`). Its GET adds `locales` and `languages` (tag → version, or null) when it lists any; a save that drops a tag from `locales:` removes that file (`languages_removed`).',
  },
  refusals: {
    cards_language_tag_invalid: 'The tag is not a language tag.',
    cards_language_not_listed: 'The main file does not list the tag in `locales:`.',
    cards_language_is_main: 'The tag is the main file\'s own `lang`: save the main file instead.',
    cards_language_key_refused: 'The language file carries a key that is the main file\'s (`key` names it).',
    cards_language_lang_mismatch: 'The language file\'s `lang` is not the tag.',
    cards_language_no_card: 'There is no main file.',
    cards_language_missing: 'The tag is listed, and has no file.',
    cards_language_use_path: '`?lang=` was sent to a main-file route.',
    cards_locales_invalid: 'A main save lists something in `locales:` that is not a language tag.',
    cards_locales_too_many: 'A main save lists more than 12 tags in `locales:`.',
  },
};

/**
 * Backs: what a tile shows when it turns over. One level deep: a back cannot open another back.
 * Verified against card-core.js (RE_DRAWER_LANE / splitDrawer), card-render.mjs (backTarget,
 * DOOR_TYPES), w3/deck.js (DEFB / defBack) and w3/edit3.mjs (defId / addDefault).
 */
export const BACKS = {
  lane: '`## back: <id>` starts a back lane; `## back: <id> | <Title>` gives it a title. The id is lower-cased and spaces become hyphens. The lane holds the cells of that back (the editor writes one). The older spelling `## drawer: <id>` is still read and kept as written.',
  tile: 'A tile points at a back with the param `back=#<id>`. It counts only when a lane with that id exists, and never inside a back.',
  tileTypes: 'Honoured on `profile` and `text` (a layer over the whole tile opens the back) and on `link` and `feature` (their own link opens it). `video`, `slides`, `social` and `embed` ignore `back=`.',
  cardDefault: 'The frontmatter line `back: "#<id>"` names the default back: every tile without a back of its own, and that is not a link or a video, turns over to a copy of it. Write it in double quotes: a bare `#` starts a YAML comment.',
  none: "With no default back, such tiles turn over to the printed business card (the card's name, a QR code, its address). In the stack and list views a link without a back turns over to its address, and a video to its YouTube page.",
  inLinks: 'A `link` whose address is `#<id>` (`[About](#about)`) or a `feature` with `href=#<id>` opens that back too. Inside a back, such a cell is dropped.',
  example:
    '---\ntitle: Aster\nback: "#about"\n---\n\n## grid\n\n' +
    '- [ ] %% card: profile w=6 back=#about %% Illustrator.\n' +
    '- [ ] %% card: link w=3 %% [Shop](https://example.org/shop)\n\n\n' +
    '## back: about | About me\n\n' +
    '- [ ] %% card: text %% I draw things.\n',
};

/**
 * The geometry rules agents get wrong. Verified against card-core.js (DEFAULT_COLS, clampSpan,
 * packGrid, setSpan) and card-render.mjs (renderGrid; `.st-cells` / `[data-w]` CSS).
 */
export const GEOMETRY = {
  columns: 'A card is six columns. There is no `cols:` key; it is ignored.',
  width: '`w=1`…`w=6` is the only size. Values are clamped to 1–6; a cell with no `w` is one column wide.',
  height: 'There is no height param. Height comes from content: a row is at least one column-width square and grows to fit. `h=` is retired: it is ignored, never offered, and the editor never writes it.',
  fullWidth: '`text` cells and any cell with `bleed` always span all six columns and break the grid into separate runs; their `w` does nothing.',
  pictures: 'A picture keeps its own aspect ratio instead of filling a box. An `embed` is as tall as it is wide.',
  order: 'Cells pack in file order, but a later narrow cell may fill a gap left earlier in the row.',
  views: 'Width only matters on the wall view. Stack and list show every tile as a card of its own, full width, so in the editor width is set on the wall only.',
};

/**
 * The host ↔ editor contract: a page embeds `/edit?host=<its own origin>` in an iframe and talks to
 * it with postMessage. Exactly what w3/host-bridge.mjs (and its route in serve/card-worker.mjs) does.
 * Every message carries `v` (EDITOR_PROTOCOL.v) and a `type`; messages without both are ignored.
 */
export const EDITOR_PROTOCOL = {
  v: 1,
  path: '/edit?host=<parent origin>',
  origins: {
    allowed: 'https://feelreef.com, https://staging.feelreef.com, or http://localhost on any port. An exact origin: no path, query, hash or credentials. Anything else is a 400.',
    rules: 'The editor sends only to that origin (never `*`) and ignores every message from any other origin. The page may be framed only by that origin (CSP frame-ancestors).',
  },
  credentials: 'The editor holds no credential. The parent stores the card; the editor only hands it markdown.',
  /** editor → parent */
  toParent: {
    'card:ready': { fields: [], when: 'On start, repeated every 500 ms until the first card:load, for at most 60 s.' },
    'card:load-failed': { fields: ['message'], when: 'card:load had no `md` string, or `md` does not read as a card (no cells).' },
    'card:change': { fields: ['md', 'dirty'], when: 'After every edit, debounced 150 ms. `dirty` = differs from what the parent last loaded or confirmed saved.' },
    'card:save': { fields: ['md'], when: 'The person pressed Save (or Cmd/Ctrl+S). Answer with card:saved or card:save-failed.' },
    'card:draft': { fields: ['md', 'dirty'], when: 'The answer to card:get-draft. `md` is null and `dirty` false before card:load.' },
    'card:propose-failed': { fields: ['message'], when: 'card:propose before card:load, or its `md` does not read as a card.' },
  },
  /** parent → editor */
  toEditor: {
    'card:load': { fields: ['md', 'handle', 'cardUrl', 'locale?', 'version?'], when: 'Loads a card. Answer any card:ready; a second load reloads.' },
    'card:saved': { fields: ['version'], when: 'The card:save was stored. Ignored unless a save is out.' },
    'card:save-failed': { fields: ['message'], when: 'The card:save was refused; `message` is shown to the person as written. Ignored unless a save is out.' },
    'card:get-draft': { fields: [], when: 'Asks for the current draft; answered with card:draft.' },
    'card:propose': { fields: ['md'], when: 'Puts `md` in the editor as an unsaved draft. It is never saved by itself: the person presses Save. Announced as card:change.' },
  },
  md: 'Every `md` is the whole card file, `## assets` lane included. A parent that saves through save_cards (which keeps only the stored assets lane) uploads new assets with put_asset first; host-bridge.mjs exports splitCard() for that split.',
};
