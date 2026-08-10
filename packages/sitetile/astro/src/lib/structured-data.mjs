// JSON-LD — the machine-readable summary of what a page IS.
//
// 🩸 A live site emitted none, on any page. Every WordPress site with Yoast or Jetpack
// ships this, and it is what a search engine reads to decide that a URL is an article with an
// author and a date rather than an anonymous blob of HTML. og: tags cover sharing; JSON-LD covers
// understanding, and we had the second half of a pair.
//
// The same round found every post declaring `og:type: website`, because nothing set it to
// `article` — so the platform was actively telling crawlers a post is not a post.
//
// RULES THIS FILE KEEPS:
//   • Never invent a field. No `dateModified` (this platform does not track one), no `wordCount`
//     estimate, no rating. A structured-data block is a set of CLAIMS, and an unverifiable claim in
//     a machine-readable channel is worse than a missing one — a human at least discounts prose.
//   • Omit rather than empty. An absent key and a key holding '' are different statements.
//   • Pure: everything comes in as arguments, so a plain `node` test can read the output.

const clean = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};

/** The publisher block, shared by every graph node that needs one. */
export function organization({ siteName, siteUrl, logo } = {}) {
  return clean({
    '@type': 'Organization',
    name: siteName,
    url: siteUrl,
    logo: logo ? clean({ '@type': 'ImageObject', url: logo }) : null,
  });
}

/**
 * The graph for one page. Returns null when there is not enough to say anything true — a site with
 * no name and no URL gets no block rather than an empty one.
 *
 * @param {object} o
 * @param {'article'|'website'} o.kind
 * @param {string} o.url          absolute URL of this page
 * @param {string} o.siteName
 * @param {string} o.siteUrl      absolute site root
 * @param {string} [o.logo]       absolute URL
 * @param {string} [o.title]
 * @param {string} [o.description]
 * @param {string} [o.image]      absolute URL of the share image
 * @param {string} [o.datePublished]
 * @param {string} [o.author]     a display name; emitted as a Person
 * @param {string} [o.searchUrl]  absolute /search URL — only pass it when the site HAS search on,
 *                                or the SearchAction advertises a page that does not exist
 * @param {string} [o.inLanguage] BCP-47
 */
export function pageGraph({
  kind = 'website', url = '', siteName = '', siteUrl = '', logo = '',
  title = '', description = '', image = '', datePublished = '', author = '',
  searchUrl = '', inLanguage = '',
} = {}) {
  if (!siteName && !siteUrl) return null;
  const publisher = organization({ siteName, siteUrl, logo });

  if (kind === 'article') {
    const node = clean({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      description,
      url,
      mainEntityOfPage: url ? clean({ '@type': 'WebPage', '@id': url }) : null,
      datePublished: datePublished || null,
      author: author ? clean({ '@type': 'Person', name: author }) : null,
      image: image || null,
      publisher,
      inLanguage: inLanguage || null,
    });
    return node;
  }

  return clean({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
    description,
    inLanguage: inLanguage || null,
    publisher,
    // SearchAction tells Google a site has its own search. Advertising one on a site whose search
    // is off would be the /search defect wearing a different hat, so the caller has to prove it.
    potentialAction: searchUrl ? clean({
      '@type': 'SearchAction',
      target: clean({ '@type': 'EntryPoint', urlTemplate: `${searchUrl}?q={search_term_string}` }),
      'query-input': 'required name=search_term_string',
    }) : null,
  });
}

/** Serialise for a <script type="application/ld+json">. `<` is escaped so the block can never end
 *  the script element early — the one way a data island becomes an injection. */
export function jsonLdScript(graph) {
  if (!graph) return '';
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
