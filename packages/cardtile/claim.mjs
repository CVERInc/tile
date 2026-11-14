// The frontmatter claim: the one line in a Cards file that says which handle the file is.
//
//   ---
//   card-page: aster        ← what every writer writes today
//   title: Aster
//   ---
//
//   ---
//   cardtile: aster         ← the spelling it is moving to, accepted here from now on
//   title: Aster
//   ---
//
// What is written inside the file is in the cardtile namespace (docs/VOCABULARY.md, "The frontmatter
// claim"): the line marker is going from `%% card:` to `%% cardtile:`, and the claim goes the same
// way, by the same four steps. This is step one. READING accepts both keys; nothing WRITES the new
// one yet (`CLAIM_KEY_WRITTEN`), and nothing rewrites a file from one to the other.
//
// 🔴 WHY THIS FILE EXISTS AT ALL. Before it, nothing in this repository read the claim: the parser
// keeps the frontmatter as text, the renderer and the API take the handle from the address they
// were called on, and the editor's settings write only the keys they own. The claim was read and
// re-keyed outside this repository, by a pattern over `card-page:` (card-blank.mjs names that
// re-keyer; card-blank-noindex.test.mjs mirrors it). A second spelling with no shared reader would
// be decided once per consumer, and "which key wins" would have as many answers as there are
// copies. So the rule is here, once, pure and import-free, for every consumer to call.
//
// Pure. No imports: a consumer that vendors this file needs nothing else from the package.

/**
 * The keys that claim a handle, in the order they are read. Exactly these two words: the key is
 * the whole of what stands before the colon, at the start of a line, so `cardtiles:`, `card:` and
 * `card-pages:` are not claims.
 */
export const CLAIM_KEYS = Object.freeze(['cardtile', 'card-page']);

/** The key a writer in this repository puts in a new file. Not `cardtile` until the writers switch. */
export const CLAIM_KEY_WRITTEN = 'card-page';

// the same grammar the API holds a handle to (serve/card-api.mjs VALID_HANDLE); repeated, not
// imported, because this file has no imports — claim.test.mjs holds the two equal
const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// The frontmatter fence: `---` on the very first line, up to the next line that is `---`. Only
// lines inside it are ever a claim; a `cardtile: x` further down the file is the author's text.
const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const claimLine = (key) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`);

/** every claim line in the fence: { key, value, index (of the line within the fence) } */
function claimLines(md) {
  const fence = FENCE.exec(String(md ?? ''));
  if (!fence) return [];
  const found = [];
  fence[1].split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    for (const key of CLAIM_KEYS) {
      const m = claimLine(key).exec(line);
      if (m) found.push({ key, value: m[1], index });
    }
  });
  return found;
}

/**
 * readClaim: the file's markdown → { key, handle } or null. Pure.
 *
 * `handle` is the value as written, trimmed; whether it is a handle that exists, or the one the
 * file is stored under, is the caller's question. A claim line with nothing after the colon is not
 * a claim.
 *
 * 🔴 A FILE WITH BOTH KEYS: `cardtile:` WINS, wherever the two lines stand. Three reasons, and the
 * third is the one that decides it:
 *   1. No writer of the old key has ever written the new one. A file that carries both was last
 *      touched by something that knows the new name, so the new line is the later statement.
 *   2. Line order cannot decide it: a tool that adds a key appends it or puts it first, and neither
 *      habit says anything about which line its author meant.
 *   3. It is the only answer that does not change when the old key stops being read. If
 *      `card-page:` won today, the same file would change which handle it claims on the day the
 *      readers drop it, with no edit to the file.
 * Within one key, the first line wins.
 */
export function readClaim(md) {
  const lines = claimLines(md).filter((l) => l.value !== '');
  for (const key of CLAIM_KEYS) {
    const hit = lines.find((l) => l.key === key);
    if (hit) return { key, handle: hit.value };
  }
  return null;
}

/**
 * rekeyClaim: (markdown, handle) → the same file claiming `handle`. Pure.
 *
 * Every claim line in the fence is given the new handle and KEEPS ITS KEY: a file written
 * `card-page:` stays `card-page:`, a file written `cardtile:` stays `cardtile:`, and a file with
 * both keeps both, now agreeing. Spelling moves only by the one deliberate migration, never as a
 * side effect of handing a file to a new handle. Every other byte of the file is returned as it
 * came, line endings included.
 *
 * A file with no claim line is returned unchanged: this does not add one (the re-keyer it replaces
 * did not either), so `readClaim` still answers null for it.
 *
 * Throws a TypeError for a handle that is not one. The value is written into the frontmatter of
 * somebody's file, and a value carrying a newline would be writing other keys.
 */
export function rekeyClaim(md, handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) throw new TypeError('rekeyClaim: not a handle');
  const text = String(md ?? '');
  const fence = FENCE.exec(text);
  if (!fence) return text;
  const at = new Set(claimLines(text).map((l) => l.index));
  if (!at.size) return text;
  const body = fence[1].split('\n').map((raw, index) => {
    if (!at.has(index)) return raw;
    const cr = raw.endsWith('\r') ? '\r' : '';
    const key = CLAIM_KEYS.find((k) => claimLine(k).test(raw.replace(/\r$/, '')));
    return `${key}: ${handle}${cr}`;
  }).join('\n');
  const start = fence[0].indexOf(fence[1]);
  return text.slice(0, start) + body + text.slice(start + fence[1].length);
}

export const _internal = { HANDLE };
