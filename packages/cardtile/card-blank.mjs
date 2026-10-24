// reef#2044 ④ — is this card still only the blank template? Pure; the Worker asks it per request.
//
// chodaict 2026-10-13: 「只有範本內容的空白卡先不收錄，內容填好就收錄」 — judged on CONTENT, never on
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

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const resolved = (key) => [key, ...Object.values(CELL_STRINGS_BY_KEY[key] || {})];
const personas = Object.values(SANDBOX_LOCALES);

// the editor's link form writes the label alone, `[label]()` once an address is cleared, or the
// sandbox's `[label](https://example.com)` — all three, for every label any writer seeds
const linkForms = (labels) => labels.flatMap((l) => [l, `[${l}]()`, `[${l}](https://example.com)`]);

/** type → the bodies a blank-card writer puts in a cell of that type. '' is always one of them. */
export const TEMPLATE_BODIES = Object.fromEntries(Object.entries({
  profile: [...resolved('blank.profile'), ...personas.map((p) => p.bio)],
  link: linkForms([...resolved('blank.link.text'), ...personas.map((p) => p.linkLabel)]),
  text: [...resolved('blank.text'), ...personas.map((p) => p.textBody)],
  social: [BLANKS.social.body],
}).map(([type, bodies]) => [type, new Set(['', BLANKS[type]?.body, ...bodies].filter((b) => b != null).map(norm))]));
for (const type of Object.keys(BLANKS)) TEMPLATE_BODIES[type] ||= new Set(['', norm(BLANKS[type].body)]);

// Params that only arrange a tile (ai-ops.mjs UNIVERSAL: width, bleed, the retired h). Any other
// param — avatar, chips, sub, icon, src, … — is something the author set.
const LAYOUT = new Set(['w', 'bleed', 'h']);
const paramsOf = (raw) => Object.fromEntries(String(raw || '').split(/\s+/).filter(Boolean)
  .map((t) => { const i = t.indexOf('='); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; }));
const TEMPLATE_PARAMS = Object.fromEntries(Object.entries(BLANKS).map(([t, b]) => [t, paramsOf(b.rawParams)]));

const isTemplateCell = (cell) => {
  const bodies = TEMPLATE_BODIES[cell.type];
  if (!bodies || !bodies.has(norm(cell.body))) return false;
  const own = TEMPLATE_PARAMS[cell.type] || {};
  return Object.entries(cell.params || {}).every(([k, v]) => LAYOUT.has(k) || own[k] === v);
};

/** isTemplateOnly: card markdown → true only when nothing on it was written by its author. */
export function isTemplateOnly(cardMd) {
  if (typeof cardMd !== 'string') return false;   // no card is not a blank card
  let m;
  try { m = parseCard(cardMd); } catch { return false; }
  if (Object.keys(m.assets || {}).length) return false;
  if ((m.drawers || []).length) return false;
  if (norm(m.post)) return false;
  if (norm(String(m.pre || '').replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, ''))) return false;   // prose before the first lane
  if ((m.blocks || []).some((b) => norm(b.label))) return false;
  return (m.cells || []).every(isTemplateCell);
}
