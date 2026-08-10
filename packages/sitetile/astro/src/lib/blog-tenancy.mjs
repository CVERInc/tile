// blog tenancy — WHO a blog belongs to, and whether a site has one at all.
//
// Split out of blog.mjs so it can be exercised by plain `node` (blog.mjs imports the
// `@sitetile` Vite alias, which only resolves inside an Astro build). Nothing here needs
// the model layer: these are pure functions over a site's frontmatter and its post corpus.
// blog.mjs re-exports all three, so every call site still imports from blog.mjs.
//
// WHY THIS FILE EXISTS. The blog package once carried its vendor's identity as its
// DEFAULTS: an absent `blog-title` fell back to the literal 'Devlog', an absent
// `blog-tagline` to "Short build logs and hard-won tricks from the workshop.", and the RSS
// channel title was `${site title} — Devlog` with no override path at all. The blog index
// was also emitted for EVERY site, whether or not it had installed the blog. Measured that
// day: a client comic site and an illustrator's site,
// zero posts between them, neither declaring `packages: blog` — were both publishing a
// /devlog wearing the vendor's name and voice, and a 1410-post blog's feed was "Devlog — Devlog".
// A landlord's name must not be the default on a tenant's door.

// blogInstalled: does this site actually HAVE a blog? Two ways to qualify — it DECLARED the
// capability (`packages: blog`), or its store already holds posts. The second arm is not
// belt-and-braces: one site's ir/_site.md is a deliberately EMPTY placeholder (its chrome
// falls back to home.md — see the comment in that file), so it carries 632 posts while
// declaring nothing. A declaration-only gate would silently delete 632 live URLs.
export function blogInstalled(meta, posts) {
  if (Array.isArray(posts) && posts.length > 0) return true;
  return String((meta && meta.packages) || '').split(',').map((s) => s.trim()).includes('blog');
}

// feedTitle: the RSS channel title. Joins the site's title and its blog's title the same way
// the old literal did (`site — blog`), but takes BOTH from the site instead of hardcoding the
// second half. A site with no `title` key is how one ended up publishing "Devlog — Devlog";
// filtering empties first means it now publishes its blog title alone. A site that sets both
// keeps a feed titled "<site> — <blog>", byte-identical to the old literal.
export function feedTitle(meta) {
  const site = String((meta && meta.title) || '').trim();
  const blog = String((meta && meta['blog-title']) || '').trim();
  return [site, blog].filter(Boolean).join(' — ') || 'Blog';
}

// feedDescription: the blog's own tagline, else the SITE's own description, else nothing.
// Never a sentence about someone else's workshop. An explicit empty `blog-tagline` is a
// deliberate silence and is honoured (`!= null`), not treated as absence.
export function feedDescription(meta) {
  if (!meta) return '';
  if (meta['blog-tagline'] != null) return String(meta['blog-tagline']);
  return String(meta.description || '');
}
