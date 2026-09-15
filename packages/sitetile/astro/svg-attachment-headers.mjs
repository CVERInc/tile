// The platform's one `_headers` rule: every `*.svg` a site serves is delivered as an attachment.
//
// WHY: an SVG is a document format, not only a picture. Opened directly (a link, a new tab, a
// pasted URL) it runs as a page on the site's own origin — scripts and all. An uploaded vector file
// is an image, not a page, so the site says so: `Content-Disposition: attachment`. `<img src>` and
// CSS `url()` ignore that header and keep working; embedding an SVG with `<object>`/`<iframe>` stops
// rendering it, and that loss is accepted (CVERInc/reef#596).
//
// WHERE THE MERGE LIVES, and why here: a site's own assets are copied OVER the renderer's `public/`
// before `astro build` runs, as a file-level REPLACE. So an owner's `_headers` does not add to one we
// ship in `public/` — it replaces it, and a platform rule kept there would vanish on exactly the sites
// that write their own. By `astro:build:done` the file in the output directory is whatever the owner
// supplied (or nothing), and this hook appends the platform rule to it. The build owns `_headers`;
// the owner's rules are kept first, byte for byte.
//
// 🔴 Cloudflare Pages matching, from its `_headers` docs: 「a splat pattern — signified by an asterisk
// (`*`) — will greedily match all characters」, so `/*.svg` also matches `/a/b/logo.svg`. The docs use
// the same shape themselves (`/*.jpg`). Placeholders stop at `/`; splats do not.
//
// No `/*.svgz`: nothing in this build emits one, and a site's upload door does not accept the
// extension. Add it here if either of those changes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SVG_PATH = '/*.svg';
export const SVG_HEADER = 'Content-Disposition: attachment';
export const PLATFORM_RULE = `# Platform rule (sitetile): uploaded vector files are images, not pages.\n${SVG_PATH}\n  ${SVG_HEADER}\n`;
/** Cloudflare Pages: 「You may define up to 100 header rules.」 */
export const MAX_RULES = 100;

const isIndented = (line) => /^[ \t]/.test(line);
const isSkippable = (line) => line.trim() === '' || line.trim().startsWith('#');

/** Split a `_headers` text into rules: `{ path, headers: [trimmed header lines] }`. */
export function parseRules(text) {
  const rules = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (isSkippable(line)) continue;
    if (isIndented(line)) {
      if (rules.length) rules[rules.length - 1].headers.push(line.trim());
    } else {
      rules.push({ path: line.trim(), headers: [] });
    }
  }
  return rules;
}

/** Does this `_headers` text already carry the platform rule (as its own `/*.svg` block)? */
export function hasPlatformRule(text) {
  return parseRules(text).some((r) => r.path === SVG_PATH
    && r.headers.some((h) => /^content-disposition:\s*attachment\s*$/i.test(h)));
}

/**
 * The owner's `_headers` (or null/'' for none) with the platform rule appended once.
 * Owner text is kept verbatim; a text that already carries the rule is returned unchanged, which
 * is what makes this idempotent.
 */
export function mergeHeaders(ownerText) {
  const owner = ownerText == null ? '' : String(ownerText);
  if (hasPlatformRule(owner)) return owner;
  const count = parseRules(owner).length;
  if (count + 1 > MAX_RULES) {
    // Past the limit Pages would not apply the file as written — refuse loudly rather than ship a
    // site whose SVGs quietly run as pages again.
    throw new Error(`_headers: the site's own file has ${count} rules; adding the platform's ${SVG_PATH} rule would exceed Cloudflare Pages' limit of ${MAX_RULES}`);
  }
  if (owner.trim() === '') return PLATFORM_RULE;
  const eol = owner.includes('\r\n') ? '\r\n' : '\n';
  const sep = owner.endsWith('\n') ? eol : eol + eol;
  return owner + sep + PLATFORM_RULE.replace(/\n/g, eol);
}

/** Merge the platform rule into `<dir>/_headers` in place. Returns the text written. */
export function writeMergedHeaders(dir) {
  const file = join(dir, '_headers');
  const owner = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const merged = mergeHeaders(owner);
  if (merged !== owner) writeFileSync(file, merged, 'utf8');
  return merged;
}

/** Astro integration: runs after the static output (including the copied `public/`) is written. */
export function svgAttachmentHeaders() {
  return {
    name: 'sitetile-svg-attachment-headers',
    hooks: {
      'astro:build:done': ({ dir }) => { writeMergedHeaders(fileURLToPath(dir)); },
    },
  };
}
