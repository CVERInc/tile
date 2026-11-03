// REEF with Site — the markdown-document grammar every agent-readable twin shares, with no import
// that needs Vite.
//
// Split out of lib/agent-artifacts.mjs (reef#2874) because it now has TWO callers in two module
// graphs: the per-route endpoint renders content pages and posts inside Astro's bundled build, and
// agent-list-twins.mjs writes the twins of GENERATED list routes (blog index, archives, their
// pages, the language chooser) from the config's own module graph after the build — where the
// `@sitetile` alias agent-artifacts.mjs reaches through blog.mjs does not resolve. One grammar, one
// file, so a list twin and a page twin cannot disagree about what a twin's header looks like.
import { canonicalPath } from './sitemap.mjs';

/** The neutral build gate, read from the environment the build orchestration exports.
 *  This side owns NO policy vocabulary: `cite`/`train`/`search-only` are resolved once, in Reef,
 *  and arrive here as a boolean plus one collision fact. */
export function agentGate(env) {
  const e = env || {};
  const generate = String(e.SITETILE_AGENT_ARTIFACTS || '') === '1';
  return { generate, manualLlms: generate && String(e.SITETILE_AGENT_LLMS_MANUAL || '') === '1' };
}

/** A route's markdown asset path, mirroring the HTML output shape: `/about/` → `/about/index.md`,
 *  `/` → `/index.md`. Derived from the path the build actually emitted, never from a URL family. */
export function markdownAsset(path) {
  return canonicalPath(path).replace(/\/$/, '') + '/index.md';
}

// Only ever applied INSIDE a `[…]` label, where a stray bracket would break the link. A heading
// is left exactly as the author wrote it — the renderer runs `##` titles through inline markdown
// too, so escaping here would make the projection less faithful, not safer.
export const escLabel = (s) => String(s == null ? '' : s).replace(/([[\]])/g, '\\$1');

export function absoluteUrl(origin, path) {
  return String(origin || '').replace(/\/$/, '') + canonicalPath(path);
}

/** One document's markdown file: a small provenance header (title + the canonical URL this text
 *  was published at), then the content. The header is YAML so metadata and content are separated
 *  by the document's own grammar rather than by a convention a reader has to be told about. */
export function documentMarkdown(doc, origin) {
  const head = [
    '---',
    'title: ' + JSON.stringify(String(doc.title || '')),
    'source: ' + absoluteUrl(origin, doc.path),
    '---',
  ].join('\n');
  const body = String(doc.body || '').trim();
  return head + '\n' + (body ? '\n' + body + '\n' : '');
}

// A link target inside `(…)`: a space or a paren would end it early, so those (and only those) are
// percent-encoded. Anything else is the href the HTML page links to, byte for byte.
// 🔴 Spelled out, not encodeURIComponent: that leaves `(` and `)` unchanged (tile#247 review), so
// `/blog/a)b` became `[…](/blog/a)b)` — a link to /blog/a.
const HREF_ESCAPES = { ' ': '%20', '(': '%28', ')': '%29' };
const escHref = (s) => String(s == null ? '' : s).replace(/[ ()]/g, (c) => HREF_ESCAPES[c]);

/** A generated list page → its markdown body: the page's heading, then one line per item
 *  (`- [title](link) — date`, the date only when the item has one), then the neighbouring pages
 *  when the list is paginated — without them an agent reading page 1 of 12 cannot tell there is
 *  more. Items are what the HTML page lists, in its order, and nothing the HTML page does not show:
 *  a private post's card carries its title and link and so does its line, never a body. */
export function listMarkdownBody({ heading, items, prev, next } = {}) {
  const out = [];
  const h = String(heading || '').trim();
  if (h) out.push('# ' + h);
  const lines = (items || [])
    .filter((it) => it && String(it.title || '').trim() && it.href)
    .map((it) => {
      const line = `- [${escLabel(String(it.title).trim())}](${escHref(it.href)})`;
      const date = String(it.date || '').trim();
      return date ? `${line} — ${date}` : line;
    });
  if (lines.length) out.push(lines.join('\n'));
  const pager = [];
  if (prev) pager.push(`Previous page: [${escLabel(prev)}](${escHref(prev)})`);
  if (next) pager.push(`Next page: [${escLabel(next)}](${escHref(next)})`);
  if (pager.length) out.push(pager.join('\n'));
  return out.join('\n\n');
}
