// Saving a Card — the assembly, the version, and the orphan report. Pure, node-testable, no KV.
//
// This is the half of `save_card` that is not HTTP. It lives HERE, in cardtile, because assembling a
// save needs the PARSER: the caller sends a thin card (no `## assets` lane — one real card is 1,159,422
// bytes of which 3,277 is the card) and the stored bytes have to be put back around it. Only
// card-core knows where that lane begins and ends, so this is where the join belongs. See
// docs/SPEC-card-mcp.md §7 and reef/docs/SPEC-ai-door-capability-parity.md §4.3.
//
// 🔴 ONE implementation of a Card's version, and it is this one. reef-MCP hands `base_version`
// through as an OPAQUE string — it never computes one — precisely so there cannot be two hash
// functions that have to agree. The algorithm is deliberately identical to reef's page-version.js
// (SHA-256, first 16 hex, `v1:` prefix) so a Card version and a Page version read alike in a
// transcript, but that is a shared CONVENTION, not a shared code path across two repos.
import { parseCard, serializeCard } from './card-core.js';

/** Bytes → lowercase hex. */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The version token for a card's exact bytes. Content-derived, so it stays meaningful across a store
 * swap and needs no extra KV read. 64 bits: a change detector, not a security boundary.
 */
export async function cardVersion(markdown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(markdown ?? '')));
  return `v1:${hex(digest).slice(0, 16)}`;
}

/**
 * Compare a caller-supplied base version against the stored bytes. Returns null when the write may
 * proceed, or a conflict in the SAME shape save_page's does — an agent that has learned to read one
 * conflict should not have to learn a second dialect for the other.
 */
export async function checkBaseVersion(base, currentMarkdown) {
  if (base === undefined || base === null || base === '') return null;
  const current = await cardVersion(currentMarkdown);
  const want = String(base).trim();
  if (want === current) return null;
  return {
    conflict: true,
    expected: want,
    current,
    why: 'This card changed after you read it, so writing your version would erase whatever that change was.',
  };
}

/** the ONE reference form the renderer honours — card-render.mjs's ASSET_RE, same string. */
const ASSET_REF_RE = /asset:([A-Za-z0-9_.\-]+)/g;

/**
 * Which asset ids does this card text refer to?
 *
 * 🔴 A TEXT SCAN over the whole thin card, deliberately, rather than a list of the params that may
 * hold an asset (`avatar` `img` `iconimg` `poster` `images` `bg`, plus frontmatter `backdrop`). That
 * list is a second idea of what the renderer reads, and it goes stale the moment a cell type grows
 * an eighth image param — at which point a live picture starts being reported as an orphan. The same
 * skew `ai-ops.test.mjs` exists to catch, one layer down.
 *
 * The scan OVER-counts on purpose: the literal text `asset:foo` in someone's prose registers as a
 * reference. That error runs in the safe direction — a referenced asset is never called an orphan —
 * and since orphans are reported rather than collected, the cost of over-counting is a missing line
 * in a report, while the cost of under-counting would be a creator told to delete their own picture.
 *
 * Base64 has no colon in its alphabet, so a blob can never spell `asset:` and be mistaken for one.
 */
export function referencedAssets(cardText) {
  const out = new Set();
  for (const m of String(cardText || '').matchAll(ASSET_REF_RE)) out.add(m[1]);
  return out;
}

/** cells grouped by type, for the structural diff. */
const byType = (cells) => {
  const t = {};
  for (const c of cells || []) t[c.type || 'unknown'] = (t[c.type || 'unknown'] || 0) + 1;
  return t;
};

const laneLabels = (model) => (model.blocks || []).map((b) => b.label || '(face)');
const multisetMinus = (a, b) => {
  const pool = [...b];
  return a.filter((x) => {
    const i = pool.indexOf(x);
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
};

/**
 * What this write actually changed, in the shape the writer can act on. Same job as save_page's
 * `pageStructureDiff` — a Card has cells and lanes where a Page has sections, so the nouns differ
 * and the question does not: an agent that asked to change one link and is shown three has the
 * evidence that it drifted, in the same result that told it the save succeeded.
 */
export function cardStructureDiff(prev, next) {
  const before = laneLabels(prev);
  const after = laneLabels(next);
  const tb = byType(prev.cells);
  const ta = byType(next.cells);
  return {
    cells: { before: (prev.cells || []).length, after: (next.cells || []).length },
    types: Object.fromEntries(
      [...new Set([...Object.keys(tb), ...Object.keys(ta)])]
        .filter((k) => (tb[k] || 0) !== (ta[k] || 0))
        .map((k) => [k, { before: tb[k] || 0, after: ta[k] || 0 }]),
    ),
    lanes: { added: multisetMinus(after, before), removed: multisetMinus(before, after) },
    drawers: { before: (prev.drawers || []).length, after: (next.drawers || []).length },
  };
}

/**
 * Assemble the bytes a save would write.
 *
 * @param {string} incomingMd  the THIN card the caller sent (no `## assets` lane)
 * @param {string|null} storedMd  what is in the store now, or null for a new card
 * @returns {{ md, orphans, diff, carried }}
 *
 * 🔴 Assets come from the STORE, not from the caller. The whole point of the thin exit is that an
 * agent never carries 1.1MB of base64 through its context to change one word; the corollary is that
 * a save which took the caller's word for the assets lane would blank every picture on the card the
 * first time an agent did the obvious thing. So: parse the incoming card, throw away whatever assets
 * lane it happens to carry, and re-attach the stored one.
 *
 * A caller that genuinely has new bytes uses `put_asset`. There is no path where the save endpoint is
 * also the upload endpoint — one door, so nobody has to remember which shape of save keeps pictures.
 */
export function assembleSave(incomingMd, storedMd) {
  const incoming = parseCard(String(incomingMd ?? ''));
  const stored = storedMd ? parseCard(storedMd) : null;
  const assets = stored ? stored.assets : {};

  // 🔴 Serialize the THIN form first and scan THAT. Scanning `incomingMd` would work today and would
  // stop working the moment a caller posts a fat card: the base64 would be in the haystack, which is
  // harmless, but the real reason is that this is the text a reader sees. Measure the artifact.
  const thin = serializeCard({ ...incoming, assets: {} });
  const referenced = referencedAssets(thin);
  const orphans = Object.keys(assets).filter((id) => !referenced.has(id)).sort();

  return {
    md: serializeCard({ ...incoming, assets }),
    orphans,
    carried: Object.keys(assets).length,
    diff: cardStructureDiff(stored || { cells: [], blocks: [], drawers: [] }, incoming),
  };
}

/**
 * The bytes a save would write, WITHOUT the assets lane — i.e. what `get_card` hands back and what
 * `save_card` expects to receive. One function so the two exits cannot drift apart; the Worker's
 * `Accept: text/markdown` path is the same operation over the wire.
 */
export function thinCard(md) {
  return serializeCard({ ...parseCard(String(md ?? '')), assets: {} });
}

/** The asset manifest `get_card` returns instead of the bytes: id → mime + size. */
export function assetManifest(md) {
  const { assets } = parseCard(String(md ?? ''));
  const referenced = referencedAssets(thinCard(md));
  return Object.keys(assets).sort().map((id) => ({
    id,
    mime: assets[id].mime,
    // the DECODED size, because that is the number a creator recognises as "how big is this picture".
    bytes: Math.floor((assets[id].b64 || '').replace(/=+$/, '').length * 3 / 4),
    referenced: referenced.has(id),
  }));
}
