// mirror-import — the Recast SKU's import path: an ejecta mirror's HTML → clean Markdown IR.
//
// 🔴 This is sitetile's IMPORT side (companion to site-core's render side). It is NOT a parallel
// "Recast transform" — Recast = feed a cleaned (連根拔起) mirror through THIS, then render via the
// sitetile/Blog Astro layer. One transform, two outlets (own dogfood + Recast SKU).
//
// Best-effort by design (dogfood phase): it extracts what it confidently can and REPORTS the rest as
// per-template manual work — it never silently fabricates structure. Per-template knowledge (which
// container holds the content, which blocks are chrome) lives in THEMES below; a new source theme =
// add an entry, not a rewrite.
//
// Output IR is plain Markdown (the family substrate). A blog POST → flowing Markdown (Blog IR). A
// structured PAGE → optionally sitetile sections (caller decides; see toSitetile()).

import { parse } from 'node-html-parser';
import TurndownService from 'turndown';

// ── per-template knowledge (one entry per source WP/Blogger theme) ────────────────────────────
const THEMES = {
  eskimo: {
    content: '.eskimo-page-content',
    title: '.eskimo-page-title',
    date: '.eskimo-date-meta',
    cats: '.eskimo-cat-meta',
    // everything below is CHROME — dropped by virtue of selecting only `content`, listed for the report
    chrome: [
      '.eskimo-share-buttons', '.eskimo-post-nav-wrapper', '#eskimo-related-posts-wrapper',
      '.eskimo-page-title-meta', '.eskimo-reading-meta', '#eskimo-sidebar', '.widget', 'aside',
    ],
    // a single content page with a date-meta = a post; without = a page (kind decided from extracted meta)
  },
};

const FALLBACK_CONTENT = ['[class*="entry-content"]', '[class*="post-content"]', 'main', 'article', 'body'];

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', hr: '---',
  });
  // Keep iframes/embeds verbatim (they become a sitetile `embed` section later).
  td.addRule('keepEmbeds', {
    filter: ['iframe', 'script', 'style'],
    replacement: (_c, node) => (node.tagName.toLowerCase() === 'iframe' ? '\n\n' + node.outerHTML + '\n\n' : ''),
  });
  return td;
}

// Prefer a real lazy-load URL over a placeholder src so images survive the conversion.
function normalizeImages(contentEl) {
  let n = 0;
  for (const img of contentEl.querySelectorAll('img')) {
    const late = img.getAttribute('data-lateloadsrc');
    if (late && /\S/.test(late)) img.setAttribute('src', late);
    img.removeAttribute('data-lateloadsrc');
    img.removeAttribute('srcset'); // drop responsive variants; keep one clean src
    n++;
  }
  return n;
}

// detectTheme: which per-template profile applies. Extend as new source themes appear.
function detectTheme(root) {
  if (root.querySelector('.eskimo-page-content')) return 'eskimo';
  return null;
}

// importMirror: one mirror HTML string → { kind, title, meta, markdown, report }.
function importMirror(html, opts = {}) {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const report = { warnings: [], droppedChrome: [], images: 0, blockImages: 0, lists: 0, iframes: 0 };

  const themeName = opts.theme || detectTheme(root);
  const theme = THEMES[themeName];
  report.theme = themeName || '(none — fell back)';

  // 1. locate content container
  let contentEl = theme ? root.querySelector(theme.content) : null;
  let contentSelector = theme ? theme.content : null;
  if (!contentEl) {
    for (const sel of FALLBACK_CONTENT) {
      contentEl = root.querySelector(sel);
      if (contentEl) { contentSelector = sel; break; }
    }
    report.warnings.push(`content container fell back to "${contentSelector}" — PER-TEMPLATE MANUAL: confirm the real content selector`);
  }
  report.contentSelector = contentSelector;
  if (!contentEl) {
    report.warnings.push('NO content container found — cannot convert');
    return { kind: 'unknown', title: '', meta: {}, markdown: '', report };
  }

  // 2. meta first (date/cats), THEN title — the eskimo title wrapper NESTS the meta divs, so strip
  // them out of the title element before reading its text (else author/date/reading-time leak in).
  const meta = {};
  if (theme) {
    const d = root.querySelector(theme.date); if (d) meta.date = d.text.trim();
    const c = root.querySelector(theme.cats); if (c) meta.cats = c.text.trim().replace(/^In\s+/, '').replace(/\s+/g, ' '); // drop "In " prefix
  }
  const titleEl = theme && root.querySelector(theme.title);
  if (titleEl) for (const m of titleEl.querySelectorAll('.eskimo-page-title-meta, .eskimo-author-meta, .eskimo-cat-meta, .eskimo-date-meta, .eskimo-reading-meta')) m.remove();
  const title = (titleEl ? titleEl.text : (root.querySelector('h1') ? root.querySelector('h1').text : '')).replace(/\s+/g, ' ').trim();
  // kind from extracted meta (NOT a live DOM query — we just stripped the meta nodes off the title).
  const kind = theme ? (meta.date ? 'post' : 'page') : 'page';

  // 3. record dropped chrome (present-but-excluded) for the report
  if (theme) for (const sel of theme.chrome) if (root.querySelector(sel)) report.droppedChrome.push(sel);

  // 4. normalize + measure content
  report.images = normalizeImages(contentEl);
  report.blockImages = contentEl.querySelectorAll('p > img, img').length;
  report.lists = contentEl.querySelectorAll('ul, ol').length;
  report.iframes = contentEl.querySelectorAll('iframe').length;

  // 5. HTML → Markdown
  const td = makeTurndown();
  let markdown = td.turndown(contentEl.innerHTML).replace(/\n{3,}/g, '\n\n').trim();

  // 6. honest gap flags (drive marker-growth / renderer decisions)
  if (report.images > 0) report.warnings.push(`${report.images} image(s): need a BLOCK-markdown renderer (sitetile prose is inline-only) → route to Blog renderer or add block-prose`);
  if (report.lists > 0) report.warnings.push(`${report.lists} list(s): block markdown — same as above`);
  if (report.iframes > 0) report.warnings.push(`${report.iframes} iframe(s): map to a sitetile embed section (verbatim)`);

  return { kind, title, meta, markdown, report };
}

// toBlogMd: a POST → flowing Blog Markdown IR (frontmatter + body). Posts are flowing content, NOT
// sitetile sections — this is the Blog content type (marktile/flowtile family), substrate = markdown.
function toBlogMd({ title, meta, markdown }) {
  const fm = ['---', 'blog-post: true'];
  if (title) fm.push('title: ' + title);
  if (meta.date) fm.push('date: ' + meta.date);
  if (meta.cats) fm.push('cats: ' + meta.cats);
  fm.push('---', '');
  return fm.join('\n') + markdown + '\n';
}

// toSitetile: a structured PAGE → sitetile .md. Best-effort: in-content `## ` headings become
// sections; lead content goes under a section titled with the page title. Inline-only body is a known
// limit (block images/lists won't render) — flagged by the importer for prose-heavy pages.
function toSitetile({ title, meta, markdown }) {
  const fm = ['---', 'sitetile-page: ' + (meta.slug || 'page')];
  if (title) fm.push('title: ' + title);
  fm.push('---', '');
  // Split body on H2; everything before the first H2 is the lead under the title.
  const parts = markdown.split(/\n(?=##\s)/);
  const lead = parts[0].startsWith('##') ? '' : parts.shift();
  const out = [fm.join('\n')];
  out.push('## ' + (title || 'Untitled'));
  if (lead && lead.trim()) out.push(lead.trim());
  for (const p of parts) out.push(p.trim());
  return out.join('\n\n') + '\n';
}

export { importMirror, toBlogMd, toSitetile, THEMES };

// ── CLI: node mirror-import.js <file.html> [more.html ...] ────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node mirror-import.js <mirror-page.html> ...'); process.exit(2); }
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const r = importMirror(html);
    console.log('\n══════ ' + f + ' ══════');
    console.log('  kind:', r.kind, '| theme:', r.report.theme, '| content:', r.report.contentSelector);
    console.log('  title:', JSON.stringify(r.title));
    console.log('  meta:', JSON.stringify(r.meta));
    console.log('  images:', r.report.images, '| lists:', r.report.lists, '| iframes:', r.report.iframes);
    console.log('  dropped chrome:', r.report.droppedChrome.join(', ') || '(none)');
    console.log('  markdown bytes:', r.markdown.length, '(first 220):');
    console.log('    ' + r.markdown.slice(0, 220).replace(/\n/g, '\n    '));
    if (r.report.warnings.length) {
      console.log('  ⚠ per-template / gap flags:');
      r.report.warnings.forEach((w) => console.log('     - ' + w));
    }
  }
}
