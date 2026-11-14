// reef#2044 ④ — is this card still only the blank template? Pure; the Worker asks it per request.
//
// The product owner 2026-10-13: 「只有範本內容的空白卡先不收錄，內容填好就收錄」 — judged on CONTENT, never on
// account age, and (2026-10-14 ruling) only by means that are automatic and do not misjudge.
//
// 🔴 "TEMPLATE" IS DEFINED BY THE CODE THAT WRITES BLANK CARDS, not by a guess at what thin looks like.
// Three writers, and every template string below is imported from the one that produces it:
//
//   1. create_card's starter — reef `apps/reef-mcp/src/create-card.js` `starterCardMarkdown`: a
//      profile cell and a social cell, both from `BLANKS` (ai-ops.mjs:231). The profile body is the
//      creator's tagline if they gave one, else BLANKS.profile.body — the KEY `blank.profile`, as
//      written (reef stores it unresolved).
//   2. the sandbox door — `w/sandbox-i18n.mjs` `buildSandboxCard` (:709): the locale persona's bio and
//      `[linkLabel](https://example.com)`, carried verbatim into a real card by reef's
//      `rekeyCardMarkdown` (which only rewrites `card-page` and `title`). Older sandboxes also seeded
//      the persona's `textBody` as a third tile; it is template too.
//   3. a tile added in the editor and never filled — `ai-ops.mjs` `blankCell` (:255), whose bodies are
//      KEYS resolved through `w/cell-i18n.mjs` (`blank.*`, :553) in any of the nine locales.
//
// 🔴 ONE-SIDED ON PURPOSE. A wrong "blank" hides a real creator from search; a wrong "not blank" is
// today's behaviour. So anything this file does not recognise as one of those writers' own output —
// one changed character in a body, an avatar, any param that is not layout, an image in the assets
// lane, a drawer, a section label, text after the lanes — makes the card NOT blank. Frontmatter is
// not read at all: `title` is the creator's name and is always there; the rest is styling.
import { parseCard } from './card-core.js';
import { BLANKS } from './ai-ops.mjs';
import { SANDBOX_LOCALES, buildSandboxCard } from './w/sandbox-i18n.mjs';
import { CELL_STRINGS_BY_KEY } from './w/cell-i18n.mjs';

// `blankish` is ONLY for "is there anything here at all" (a section label, text around the lanes).
// Template bodies are never normalised: see TEMPLATE_BODIES.
const blankish = (s) => !String(s ?? '').trim();
const resolved = (key) => [key, ...Object.values(CELL_STRINGS_BY_KEY[key] || {})];
const personas = Object.values(SANDBOX_LOCALES);

// the editor's link form writes the label alone, `[label]()` once an address is cleared, or the
// sandbox's `[label](https://example.com)` — all three, for every label any writer seeds
const linkForms = (labels) => labels.flatMap((l) => [l, `[${l}]()`, `[${l}](https://example.com)`]);

/** type → the bodies a blank-card writer puts in a cell of that type. '' is always one of them.
 *
 * 🩸 A MAP, not an object (tile#191 review P2). The type word is author input, and the parser accepts
 * any word: as a plain object, `TEMPLATE_BODIES['constructor']` handed back Object's constructor, the
 * `.has` call threw, and a card that had rendered 200 the day before took the request down with it.
 * A Map has no inherited keys, so an unknown type — however it is spelled — is simply not template.
 *
 * 🩸 BYTE-EXACT, no whitespace normalisation (tile#191 re-review P2). Collapsing whitespace made
 * `small town.  \n\tI write` — a Markdown hard line break, a visible <br> — compare equal to the
 * template, so an edited card stayed noindex. The value compared is `cell.body` as parseCard returns
 * it, which is exactly what the renderer is handed (renderCardHTML → parseCard → renderPage). The
 * only whitespace that may differ from the raw file is what parseCard itself drops before anything
 * renders it (card-core.js extractCell: the body's trailing whitespace, leading newlines, the
 * continuation lines' indent; CRLF line ends) — card-blank-noindex.test.mjs proves those render
 * byte-identical HTML. Anything else, a single space included, counts as authored. */
export const TEMPLATE_BODIES = new Map(Object.entries({
  profile: [...resolved('blank.profile'), ...personas.map((p) => p.bio)],
  link: linkForms([...resolved('blank.link.text'), ...personas.map((p) => p.linkLabel)]),
  text: [...resolved('blank.text'), ...personas.map((p) => p.textBody)],
  social: [BLANKS.social.body],
}).map(([type, bodies]) => [type, new Set(['', BLANKS[type]?.body, ...bodies].filter((b) => b != null).map(String))]));
for (const type of Object.keys(BLANKS)) if (!TEMPLATE_BODIES.has(type)) TEMPLATE_BODIES.set(type, new Set(['', String(BLANKS[type].body)]));

// Params that only arrange a tile (ai-ops.mjs UNIVERSAL: width, bleed, the retired h). Any other
// param — avatar, chips, sub, icon, src, … — is something the author set.
const LAYOUT = new Set(['w', 'bleed', 'h']);
const paramsOf = (raw) => new Map(String(raw || '').split(/\s+/).filter(Boolean)
  .map((t) => { const i = t.indexOf('='); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; }));
const TEMPLATE_PARAMS = new Map(Object.entries(BLANKS).map(([t, b]) => [t, paramsOf(b.rawParams)]));   // Map: same reason

const isTemplateCell = (cell) => {
  const bodies = TEMPLATE_BODIES.get(cell.type);
  if (!bodies || !bodies.has(String(cell.body ?? ''))) return false;
  const own = TEMPLATE_PARAMS.get(cell.type) || new Map();
  return Object.entries(cell.params || {}).every(([k, v]) => LAYOUT.has(k) || (own.has(k) && own.get(k) === v));
};

/** isTemplateOnly: card markdown → true only when nothing on it was written by its author. */
export function isTemplateOnly(cardMd) {
  if (typeof cardMd !== 'string') return false;   // no card is not a blank card
  // 🔴 The WHOLE judgement is inside the try, not only the parse: anything unexpected answers "not
  // blank" (today's behaviour, indexable) — never a thrown request on a card that renders.
  try { return judge(parseCard(cardMd)); } catch { return false; }
}

function judge(m) {
  if (Object.keys(m.assets || {}).length) return false;
  if ((m.drawers || []).length) return false;
  if (!blankish(m.post)) return false;
  if (!blankish(String(m.pre || '').replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, ''))) return false;   // prose before the first lane
  if ((m.blocks || []).some((b) => !blankish(b.label))) return false;
  return (m.cells || []).every(isTemplateCell);
}

/** isSandboxSample: card markdown → true only when it is the sandbox's own sample starter, untouched.
 *
 * tile#296. The sandbox once seeded a persona card (`w/sandbox-i18n.mjs` `buildSandboxCard`, in each
 * of its locales) and two editors stored it unasked: w2 wrote it under its draft key on load, and the
 * first-day w3 wrote it under its saved key on Save. A browser holding only that still opened on
 * somebody else's sample after the sandbox started from an empty card.
 *
 * 🔴 EXACT, NOT isTemplateOnly (tile#300 review). The caller DELETES the key this answers yes for,
 * and a deletion cannot be taken back. isTemplateOnly's rule is broad on purpose — any number and
 * order of template tiles, any width, a cleared link — because for noindex a wrong "not blank" is
 * harmless; here every one of those is something the visitor did in the editor (delete, reorder,
 * resize, clear an address, add a tile, edit the raw Markdown), and round 1 erased it. So this is a
 * string comparison against the finite set of texts the old editors actually stored: SANDBOX_STARTERS,
 * below. The only differences forgiven are line ends (CRLF) and how the file ends (trailing blank
 * lines, a missing final newline) — nothing inside the card. Anything else is the visitor's, kept. */
export function isSandboxSample(cardMd) {
  if (typeof cardMd !== 'string') return false;
  const md = starterForm(cardMd);
  if (SANDBOX_STARTERS.has(md)) return true;
  // the common path ends here: no hashing unless the length is one of the nine below
  const rows = OLDER_BY_LENGTH.get(md.length);
  if (!rows) return false;
  const a = fnv1a32(md);
  const b = murmur3_32(md, STARTER_DIGEST_SEED);
  return rows.some(([, fa, mb]) => fa === a && mb === b);
}

const starterForm = (md) => md.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');

// Every text an old editor stored unasked, 9 locales × 2 shapes, built once:
//   - the current starter, `buildSandboxCard(locale)` (unchanged in output since fe6b0d5; the first-day
//     w3, d671762, seeded it and stored it verbatim on Save; w2 stored it on load);
//   - the older starter, the same card plus the persona's `textBody` as a third tile — byte for byte
//     what `buildSandboxCard` wrote at 22f9636, the last version before fe6b0d5 dropped the tile (w2
//     stored it on load). sandbox-start.test.mjs pins it against that version's text.
const SANDBOX_STARTERS = new Set(Object.keys(SANDBOX_LOCALES).flatMap((k) => {
  const current = buildSandboxCard(k);
  return [current, `${current}- [ ] %% card: text w=3 %% ${SANDBOX_LOCALES[k].textBody}\n`];
}));

// The oldest generation, known by numbers only. At 89a5b04 `buildSandboxCard` wrote 9 different
// starters (one per locale) and the previous editor (w/editor.mjs) stored them on load; 22f9636
// replaced that wording on purpose, so it must not come back into this source. Each row is
//   [length in UTF-16 code units, FNV-1a 32, Murmur3 32 with STARTER_DIGEST_SEED]
// of the text after starterForm. A stored text counts as that starter only when ALL THREE match.
// 🔴 Why three independent checks: a match DELETES the visitor's card. One 32-bit digest alone leaves
// a 1-in-4-billion chance per text that edited work collides; FNV-1a and Murmur3 are structurally
// different (xor-then-multiply per byte vs. block mix with rotations and a final avalanche, different
// constants and seed), so a collision would have to hit both at the same exact length.
// Computed from `git show 89a5b04:packages/cardtile/w/sandbox-i18n.mjs`; sandbox-start.test.mjs
// re-derives them from history when it is available.
export const STARTER_DIGEST_SEED = 0x9747b28c;
export const OLDER_STARTER_DIGESTS = Object.freeze([
  [357, 0x59639d28, 0x8278f7ef],   // en
  [232, 0xb52368fa, 0xd5a46d83],   // zh
  [260, 0x359d73bd, 0xf4c0e2d7],   // ja
  [276, 0xd1f41ec5, 0x363a053c],   // ko
  [235, 0xea1fd1dd, 0x936d5acd],   // zh-Hans
  [384, 0x7e2ea507, 0x77aa865c],   // de
  [393, 0xa370463d, 0x1e923b21],   // fr
  [387, 0xf4efc17f, 0x9b2ac02b],   // es
  [386, 0xf4170089, 0x793c9b3e],   // pt
].map((r) => Object.freeze(r)));
const OLDER_BY_LENGTH = OLDER_STARTER_DIGESTS.reduce((m, r) => m.set(r[0], [...(m.get(r[0]) || []), r]), new Map());

const utf8 = (s) => new TextEncoder().encode(s);

/** FNV-1a, 32-bit, over the UTF-8 bytes of `s`. Unsigned. */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (const byte of utf8(s)) h = Math.imul(h ^ byte, 0x01000193);
  return h >>> 0;
}

/** MurmurHash3 x86_32 over the UTF-8 bytes of `s`, with `seed`. Unsigned. */
export function murmur3_32(s, seed) {
  const bytes = utf8(s);
  const n = bytes.length;
  const tail = n & ~3;
  const mixK = (k) => Math.imul(rotl(Math.imul(k, 0xcc9e2d51), 15), 0x1b873593);
  let h = seed | 0;
  for (let i = 0; i < tail; i += 4) {
    const k = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    h = (Math.imul(rotl(h ^ mixK(k), 13), 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  switch (n & 3) {
    case 3: k ^= bytes[tail + 2] << 16; // falls through
    case 2: k ^= bytes[tail + 1] << 8; // falls through
    case 1: k ^= bytes[tail]; h ^= mixK(k);
  }
  h ^= n;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const rotl = (x, r) => (x << r) | (x >>> (32 - r));
