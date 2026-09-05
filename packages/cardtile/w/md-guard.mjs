// "Is this text still a card?" — the gate on leaving Markdown mode.
//
// Lifted out of w/editor.mjs (2026-09-06) unchanged, because `/try/edit2` offers the same whole-page
// Markdown mode over the same file and the guard is the reason that mode can be shown to a stranger
// at all. Two copies of a validator is two ideas of what a broken card is.
import { parseCard } from '../card-core.js';

/**
 * Is this text still a card, and if not, WHICH LINE stopped being one?
 *
 * 🩸 §3.4 of the review specifies 「錯誤來自 parseCard 的 throw」. There is no such throw: measured
 * against a broken frontmatter fence, a missing lane heading, a mangled cell marker and an empty
 * string, `parseCard` returns a model every time — 0 cells, or a cell in the wrong shape. A guard
 * written against an exception would have been a red line that could never appear.
 *
 * So the gate is what actually goes wrong, and each arm is something a person really types:
 *   · no `## <lane>` heading at all — the file has stopped being a card
 *   · a `- [ ]` line with no `%% card: … %%` marker — THAT TILE would be silently dropped
 * Anything else parses, and leaving is allowed. `null` means "fine".
 */
export function whatIsWrong(md) {
  const lines = String(md).split('\n');
  const orphan = lines.findIndex((l) => /^\s*-\s*\[/.test(l) && !/%%\s*card\s*:/.test(l));
  if (orphan >= 0) return { line: orphan + 1 };
  if (!lines.some((l) => /^##\s+\S/.test(l))) return { line: 1 };
  try {
    parseCard(md);
  } catch {
    return { line: 1 };
  }
  return null;
}
