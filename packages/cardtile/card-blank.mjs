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
import { SANDBOX_LOCALES } from './w/sandbox-i18n.mjs';
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
