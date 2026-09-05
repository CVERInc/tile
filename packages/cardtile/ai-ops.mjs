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

/**
 * Params every cell has, whatever its type. Read by `packGrid` (w) and `renderGrid` (bleed) rather
 * than by any one `case`, which is why a per-type scan alone would miss them.
 */
export const UNIVERSAL = {
  w: WIDTH,
  bleed: {
    disposition: DISPOSITION.RAW, label: '整行',
    hint: '存在就讓這格跳出 bento、自己佔滿一整行。散文(text)本來就是這樣,不必寫。',
  },
  // 🔴 There is ONE layout model: height comes from content and the renderer sets `grid-row:auto`.
  // `setSpan` wrote an `h` token as late as 2026-07-29, which made drag-to-resize the one path that
  // could put a dead parameter back into a creator's file — where it serialises cleanly, reads as
  // "just a span" in review, and does nothing. An editor is exactly where this comes back to life.
  // Declared RETIRED rather than deleted so the drift test can assert it is never offered.
  h: { disposition: DISPOSITION.RETIRED, label: 'h', hint: '已退役。renderer 不再理它。' },
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
      avatar: { disposition: DISPOSITION.FORM, label: 'type.profile.avatar.label', control: CONTROL.ASSET, hint: '' },
      chips: { disposition: DISPOSITION.FORM, label: 'type.profile.chips.label', control: CONTROL.TEXT, hint: 'type.profile.chips.hint' },
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
      iconimg: { disposition: DISPOSITION.FORM, label: 'type.link.iconimg.label', control: CONTROL.ASSET, hint: '' },
      w: WIDTH,
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
    params: {},
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
      title: { disposition: DISPOSITION.RAW, label: '標題(備援)', hint: 'body 有東西時它不會生效 — 表單用 body,這個留給既有檔案。' },
      w: WIDTH,
    },
  },

  social: {
    title: 'type.social.title',
    hint: 'type.social.hint',
    body: { label: 'type.social.body.label', control: CONTROL.AREA, hint: 'type.social.body.hint' },
    params: {},
  },

  embed: {
    title: 'type.embed.title',
    hint: 'type.embed.hint',
    body: null,
    params: {
      // 🔴 `slider` is the COMMON one and holds the common name. `bubbles` was what `slider` used to
      // mean for everybody — a bespoke pop built for one card (scale(0.001)→scale(1) about a tail
      // origin, 1:1, no controls), so every imported carousel inherited a character's mouth.
      kind: {
        disposition: DISPOSITION.FORM, label: 'type.embed.kind.label', control: CONTROL.SELECT,
        options: ['slider', 'bubbles'],
        hint: 'type.embed.kind.hint',
      },
      images: { disposition: DISPOSITION.FORM, label: 'type.embed.images.label', control: CONTROL.TEXT, hint: 'type.embed.images.hint' },
      // Positioning knobs for the slider's focal point. Real, honoured, and the kind of thing an
      // author sets once with a picture in front of them — a form field for a CSS `object-position`
      // pair would be a worse UI than the string itself.
      origin: { disposition: DISPOSITION.RAW, label: '焦點', hint: '預設 `53% 76%`。' },
      narrow: { disposition: DISPOSITION.RAW, label: '窄螢幕焦點', hint: '預設 `53% 33%`。' },
      bg: { disposition: DISPOSITION.RAW, label: '背景圖', hint: '輪播底下墊的圖。' },
      w: WIDTH,
    },
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
export const PALETTE = ['profile', 'link', 'feature', 'text', 'video', 'social', 'embed'];

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
  embed: { type: 'embed', rawParams: 'kind=slider w=6', body: '' },
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
 * `seat` uses COAM's vocabulary WITH its prefix (`reef/docs/SPEC-coam.md` §2, chodaict 2026-07-30):
 * CO / CA / CM are the CUSTOMER's Owner / Admin / Manager. fO — feelreef's own Owner — is NOT on
 * this list and that is deliberate: 「fO 不是客戶站的隱形超級帳號」.
 */
export const SEAT = { READ: 'CO|CA|CM', WRITE: 'CO|CA' };

export const OPS = {
  list_cards: { seat: SEAT.READ, params: [], returns: 'handle, title, live_url, bytes, assets, version' },
  get_card: {
    seat: SEAT.READ,
    params: ['handle', 'assets: "summary" | "inline"'],
    // 🔴 summary is the DEFAULT and inline must be asked for by name. One real card is 1,159,422
    // bytes of which 3,277 is the card; handing an agent the whole file makes "read, change, write —
    // one transaction" cost 2.3MB per edited character. And the two are not one call with a flag:
    // a BACKUP taken over the summary exit is 99.7% missing, and what is missing is the pictures.
    returns: 'the card WITHOUT the assets lane, plus an asset manifest',
  },
  save_card: {
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
  delete_asset: { seat: SEAT.WRITE, params: ['handle', 'id'], returns: 'refuses while still referenced' },
  preview_card: { seat: SEAT.READ, params: ['handle', 'markdown'], returns: 'a URL. An agent that cannot look at what it did is guessing.' },
};

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
 * Heroku predecessor is a strangler target rather than a core to reuse — ruled by chodaict
 * 2026-07-30: 「MixFairy 是 Bot」.
 */
export const DEBT = {
  gaido_card: 'GAIDO has no cardtile-Card capability. Owed from this definition, not re-derived.',
};
