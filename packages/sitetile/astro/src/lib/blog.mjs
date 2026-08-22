// REEF with Blog — the sitetile-side render helpers for the `blog` package.
// Blog posts are per-site IR markdown (frontmatter title/description/pubDate/tags
// + body) living in the build's `blog/` dir (the reef `blog_posts` store shape).
// The blog pages wear the SAME SiteLayout shell as the rest of the site, so the
// site's theme + packages (bleedblend band, lingo head) apply to /devlog too.
import { splitFrontmatter, bodyHtml, inlineHtml, parseSite } from '@sitetile';
// Chrome copy lives in a module that imports NO build alias, so a plain `node` test can reach
// it. Re-exported here because every component already imports these from blog.mjs — the seam
// moved, the call sites did not.
export { sidebarCopy, unquote, archivePrefixes, dateBadgeParts } from './chrome-copy.mjs';

const FM_LIST_RE = /^\[(.*)\]$/;
const PRIVACY_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const PRIVACY_KEY = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z][\w-]*))\s*:\s*(.*)\s*$/;

// frontmatter value → string (strips surrounding quotes).
function fmStr(v) {
  return String(v == null ? '' : v).trim().replace(/^["']|["']$/g, '');
}
// frontmatter value → array (JSON-ish `["a","b"]` or bare CSV).
function fmList(v) {
  const s = String(v == null ? '' : v).trim();
  const m = FM_LIST_RE.exec(s);
  const inner = m ? m[1] : s;
  return inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function fmScalar(v) {
  const value = String(v || '').trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

// The general sitetile frontmatter reader intentionally stays minimal. Privacy is a security
// boundary, so it gets a dedicated top-level scan that matches reef's accepted bare/quoted key
// grammar and treats any valid private marker as authoritative over a later duplicate.
function privacyVerdict(raw) {
  const match = PRIVACY_FRONTMATTER.exec(String(raw || ''));
  if (!match) return { values: [], value: '', isPrivate: false };
  const values = match[1].split(/\r?\n/)
    .map((line) => PRIVACY_KEY.exec(line))
    .filter((entry) => entry && (entry[1] ?? entry[2] ?? entry[3]) === 'visibility')
    .map((entry) => fmScalar(entry[4]));
  return {
    values,
    value: values.includes('private') ? 'private' : (values[0] || ''),
    isPrivate: values.includes('private'),
  };
}

// blogCategories: the blog's category menu — a list of { label, count, href } for a
// left-rail category sidebar matching a Wix/Blogger blog's category list (`All Posts（n）/
// ☆ STAFF（n）/ …` linking to /blog/categories/<x>). Read from a single `blog-categories` meta
// line, NOT grouped from the post corpus: a Wix capture carries no per-post category in its IR
// (the capture grabs title/date/hero/body, and Wix post pages expose no category data-hook), so grouping
// would UNDERCOUNT / invent category counts. Instead the site authors the real published counts
// verbatim from live's own category menu — same "authored-from-live, never fabricated"
// discipline as footerWidgets. Format: `label|count|href` entries joined by ` || `; count
// AND href both optional. An entry with an EMPTY href (`STAFF|211|`) renders as a plain,
// NON-CLICKABLE label — deliberate: when per-post category data isn't recoverable from the
// snapshot, linking those categories would dangle (a broken /category/<x> page).
// Doctrine forbids shipping dead links, so the count+name still show (real, harvested) but
// without an anchor until a re-harvest supplies real category pages. Returns
// [{ label, count, href }] (href '' → non-clickable), or [] when unset.
// `listed` (optional) is the site's LISTED corpus — pass it whenever unlisting may be in play.
export function blogCategories(meta, listed) {
  const raw = fmStr(meta['blog-categories']);
  if (!raw) return [];
  const entries = raw.split('||').map((entry) => {
    const [label, count, href] = entry.split('|').map((s) => s.trim());
    return label ? { label, count: count || '', href: href || '' } : null;
  }).filter(Boolean);
  const hidden = unlistedCategories(meta);
  if (!hidden.size) return entries;   // every site that unlists nothing leaves here, untouched.
  // 🔴 These counts are AUTHORED (see above) — harvested from live so they match what a reader saw
  // there. Unlisting falsifies them all at once, and not just the hidden rows: sodaart's
  // `☆ STAFF|224` would keep promising 224 posts while 14 of them are no longer reachable. An
  // authored number that has stopped measuring what it names is precisely what this site's own
  // _site.md already ruled on (「兩個數字對不上比顯示過期的舊承諾更誠實」). So the moment a site
  // unlists anything, this rail counts the corpus instead of quoting the harvest.
  const kept = [];
  for (const e of entries) {
    const slug = categoryHrefSlug(e.href, meta);
    if (hidden.has(slug)) continue;
    if (!Array.isArray(listed)) { kept.push(e); continue; }
    if (slug == null) { kept.push({ ...e, count: e.count === '' ? '' : String(listed.length) }); continue; }
    const n = listed.filter((p) => (p.categories || []).includes(slug)).length;
    // A category every one of whose posts is unlisted gets no archive route (routedCategories
    // reads the LISTED corpus), so keeping its row would ship exactly the dangling category link
    // this function's header says doctrine forbids.
    if (n === 0) continue;
    kept.push({ ...e, count: e.count === '' ? '' : String(n) });
  }
  return kept;
}

// capExcerpt: truncate joined body text to a char budget, appending live's "[…]" overflow
// marker. Default budget 180 (~measured on live WP/Blogger excerpt lengths); a site can
// shorten it via the home `blog-excerpt-chars` meta (applied in buildIndexView). BYTE-IDENTICAL
// to the old inline `.slice(0, 180)` logic when max is the default, so existing excerpts
// never move — the per-site cap is purely additive.
function capExcerpt(text, max) {
  const n = Number(max) > 0 ? Number(max) : 180;
  return text.length > n ? text.slice(0, n).trim() + ' […]' : text;
}

// Parse one post's raw markdown → { slug, title, description, date, tags, body, author, excerptText }.
// excerptMax caps the derived excerpt (default 180 = historic behavior); callers that want a
// per-site cap pass it, but the effective index cap is normally applied later in buildIndexView.
export function parsePost(slug, raw, excerptMax = 180) {
  const source = String(raw || '');
  const { meta, body } = splitFrontmatter(source);
  const privacy = privacyVerdict(source);
  const b = body || '';
  // featured image (first markdown image) + a text excerpt — for archive-grid blog indexes
  // (WP/Blogger/Wix layouts) that show an image card + excerpt, unlike a text-only blog.
  // Additive: a text-only site ignores them (uses description); themes opt in via CSS.
  // featured image = first markdown image that is NOT a video file — a `![](clip.mp4)` in-body video
  // (a showcase post) renders as <video> in the body, but must never become the archive-card
  // thumbnail (a .mp4 in <img src> is a broken image). Falls through to '' when the post has only video.
  const imgM = [...b.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]).find((s) => !/\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(s));
  // 🩸 corrected 2026-07-07 (devlog excerpt chase): the old logic took only the FIRST
  // surviving line (.find()), then sliced it at 140 chars. Fine for a normal single-line
  // markdown paragraph, but real WP/Blogger posts are often written as many short
  // newline-separated lines/paragraphs (poem-style line breaks, no blank line between
  // sentences) — .find() grabbed just the opening fragment (often <20 chars), nowhere near
  // live's real excerpt (WP's get_the_excerpt(): plain text of the post's first ~55 words/
  // several paragraphs, cut with a "…" marker). Fixed to JOIN every surviving line/paragraph
  // (still skipping headings/list-link-only lines exactly as before) until the char budget
  // is hit, matching live's multi-paragraph excerpts instead of a single opening fragment.
  // ~measured on live excerpt lengths (100–150+ CJK chars before their own truncation
  // marker); English word-count excerpts (~55 words) land in the same ballpark of characters. Now
  // capped via capExcerpt(excerptMax) — excerptMax defaults to 180 so this is unchanged, and the
  // full un-truncated join is kept as excerptText so buildIndexView can re-cap per-site (e.g.
  // a site with shorter cards) without re-parsing the body.
  const fullText = b.replace(/!\[[^\]]*\]\([^)]*\)/g, '').split('\n')
    .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('[') && !s.startsWith('>'))
    .join(' ');
  const excerpt = capExcerpt(fullText, excerptMax);
  // `slug:` in frontmatter OVERRIDES the one derived from the filename. Normally the filename IS
  // the slug (and stays the single source of truth for every site that doesn't set this), but a
  // filename can't always hold one:
  //   • ext4 caps a filename at 255 BYTES. A CJK slug is 3 bytes/char, so ~85 characters — a real
  //     Wix import produced a 303-byte post filename that git can't even check out on Linux
  //     ("File name too long"), which builds fine on macOS/APFS and then dies in the cloud runner.
  //   • the live URL is the recast's contract: that post really is served at the long slug, so
  //     shortening the filename without this override would silently move a live URL.
  // Filename remains the default, so no existing site's output moves.
  // 🔴 …but only when the filesystem can actually hold it. A static build does
  // `mkdir(dist/post/<slug>)`, and ext4 caps a single NAME at 255 bytes — the very limit that
  // forced the filename to be shortened in the first place. Honouring an over-long slug doesn't
  // produce a long URL, it produces ENAMETOOLONG and NO BUILD AT ALL (measured on the cloud
  // runner, 2026-07-23: the first version of this override turned a wrong-URL build into a failed
  // one). macOS/APFS counts 255 CHARACTERS, so this never trips locally — the check has to be
  // explicit, not left to the platform.
  const fmSlug = fmStr(meta.slug);
  const fits = fmSlug && new TextEncoder().encode(fmSlug).length <= 255;
  const effectiveSlug = fits ? fmSlug : slug;
  return {
    slug: effectiveSlug,
    title: fmStr(meta.title) || effectiveSlug,
    description: fmStr(meta.description),
    date: fmStr(meta.pubDate || meta.date),
    // access marker, read by isPrivatePost() below. A dedicated verdict covers quoted keys and
    // raw-repo duplicate edits that the general metadata object would otherwise overwrite.
    visibility: privacy.value || fmStr(meta.visibility),
    tags: fmList(meta.tags || meta.categories),
    // WP category slugs as a DISTINCT axis from tags (a post lives in categories AND carries tags).
    // Powers /category/<slug>/ archives without polluting the tag cloud. Empty on sites that don't
    // enrich per-post category (a plain devlog, or an authored-count model) → no category archive.
    categories: fmList(meta.categories),
    body: b,
    image: imgM || '',
    author: fmStr(meta.author), // '' when absent → byline stays hidden; a site with authors enriches it
    excerpt,
    excerptText: fullText, // full join for per-site excerpt re-capping in buildIndexView
  };
}

// `visibility: private` is the ONE value that marks a post private. Every other value --
// absent, empty, or a key an imported corpus arrived carrying from its old platform -- reads as
// public, because gating on an unrecognised value would change what those sites already serve.
export function isPrivatePost(post) {
  return !!post && String(post.visibility || '').trim() === 'private';
}

// A translated file is the same logical post as its default-locale file. Privacy can tighten in a
// locale, but a translated public/omitted marker cannot relax a private base post.
export function inheritLocalePrivacy(post, basePost) {
  if (!isPrivatePost(basePost) || isPrivatePost(post)) return post;
  return { ...post, visibility: 'private' };
}

// The same post with its non-public parts removed: body, description, excerpt.
// Title, date, slug, tags and featured image stay, so a listing still shows the post exists.
// A public post comes back as the SAME object, so a corpus with no private post keeps its
// object identity and not just its values.
export function publicFacing(post) {
  if (!isPrivatePost(post)) return post;
  return { ...post, body: '', description: '', excerpt: '', excerptText: '' };
}

export function publicFacingPosts(posts) {
  return (posts || []).map((p) => publicFacing(p));
}

export function postCards(posts, meta) {
  return publicFacingPosts(posts).map((p) => ({
    title: p.title,
    href: postUrl(p, meta),
    date: p.date,
    image: p.image,
    description: p.description,
  }));
}

// Read every post from a glob of raw markdown (`import.meta.glob('../../blog/*.md',
// {query:'?raw', import:'default', eager:true})`), newest-first by date string.
export function allPosts(glob, excerptMax) {
  const posts = [];
  for (const [path, raw] of Object.entries(glob)) {
    const slug = path.split('/').pop().replace(/\.md$/, '');
    posts.push(parsePost(slug, raw, excerptMax)); // undefined → parsePost default 180 (unchanged)
  }
  return posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// ── Unlisting: a post that keeps its URL but leaves every list ───────────────────────────────
//
// `blog-unlisted-categories: <slug>, <slug>` — the category slugs this site keeps OUT of every
// list it GENERATES: the blog index and its pager, the term/date/author archives, RSS, the
// sitemap, the search index, the category rail, and every corpus-derived sidebar (recent posts /
// tag cloud / year archive / related).
//
// 🔴 IT IS NOT A DRAFT STATE, and that difference is the whole reason it exists. sodaart asked to
// take eight VTubers' 291 posts out of NEWS (chodaict, 2026-08-19). Every one of them has been
// published for years and carries a live, indexed URL from the Wix era, so a draft flag would 404
// all 291 — the exact cost retirePage's header already names ("removing a live, indexed URL makes
// a 404 and burns its search weight"). Here the post PAGE still renders and its URL still answers
// 200: a reader holding a link keeps it, search engines fade it out on their own, and deleting the
// config line brings every post back because no post file was ever touched. A real draft state —
// for a post that never had a URL — is a different feature and stays unbuilt.
//
// 🔴 A post is unlisted when ANY of its categories is unlisted, not only when all of them are.
// 14 of sodaart's 291 also carry `staff`, a category being KEPT, and "hide this person's posts" is
// not satisfied by a rule that leaks them out through the company archive. The per-post escape
// hatch is the one that already exists: take that category off that post's frontmatter.
export function unlistedCategories(meta) {
  return new Set(fmList((meta || {})['blog-unlisted-categories']));
}

// The listed corpus: `posts` minus anything unlisted. Idempotent, so a surface that filters and
// then hands the result to a helper that filters again is unharmed — which is deliberate, because
// the alternative is fourteen call sites each of which is silently wrong if it forgets.
//
// 🔴 TWO CALLERS MUST NEVER USE THIS, and both would turn "unlisted" into "deleted":
//   · the post's own route in pages/[...path].astro — filtering it 404s the very URL this feature
//     exists to keep alive.
//   · pages/reef-posts.json.js — that file tells the NEXT incremental build which pages the last
//     deployment still holds. A page missing from it is neither fetched nor re-rendered, so an
//     unlisted post would vanish from the deployment entirely, one build later, with nothing red.
export function listedPosts(posts, meta) {
  const hidden = unlistedCategories(meta);
  if (!hidden.size) return posts || [];
  return (posts || []).filter((p) => !(p.categories || []).some((c) => hidden.has(c)));
}

// The category slug a rail entry's href points at — `/category/深空眠/` → `深空眠` — or null when
// the href is not a category archive at all (the rail's own `All Posts|585|/diary` row). Keyed off
// the site's own `blog-category-base`, so a site publishing archives elsewhere still matches.
function categoryHrefSlug(href, meta) {
  const base = String((meta || {})['blog-category-base'] || '/category').replace(/\/+$/, '');
  const path = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (!path.startsWith(base + '/')) return null;
  const seg = path.slice(base.length + 1);
  if (!seg || seg.includes('/')) return null;
  try { return decodeURIComponent(seg); } catch { return seg; }
}

// loadSite: the OPT-IN site-config layer (SPEC-site-data-model.md). A `content/_site.md`
// holds the site-level chrome (theme/nav/footer/logo/packages/blog-* …) ONCE, so every page
// inherits it instead of each page duplicating it (a header-search setting that was on some pages
// and not others was exactly this gap). Returns the `_site` frontmatter, or null when absent → callers fall back to the
// legacy per-page / home behavior (a site is unaffected until it adopts `_site`).
// locale-aware: `content/_site.md` is the base; `content/<locale>/_site.md` overrides it for that
// locale (a Lingo site translates footer/copyright-href/blog-label per locale). Pass the
// page's rel path (e.g. "ja-jp/about") to pick its locale override. Resolution order:
// { ...base, ...<pageLocale>/_site }. Returns null when NO _site exists anywhere (legacy fallback).
export function loadSite(contentGlob, pagePath) {
  let base = null; const locales = {};
  for (const [path, raw] of Object.entries(contentGlob || {})) {
    const rel = (path.split('/content/')[1] || '');
    if (rel === '_site.md') {
      const { meta } = splitFrontmatter(String(raw || ''));
      if (meta && Object.keys(meta).length) base = meta;
    } else {
      const m = rel.match(/^([^/]+)\/_site\.md$/);
      if (m) { const { meta } = splitFrontmatter(String(raw || '')); if (meta && Object.keys(meta).length) locales[m[1]] = meta; }
    }
  }
  if (!base && !Object.keys(locales).length) return null;
  const seg = pagePath ? String(pagePath).split('/')[0] : null;
  const loc = seg && locales[seg] ? locales[seg] : null;
  return { ...(base || {}), ...(loc || {}) };
}

// The site-level frontmatter (theme/packages/locales/footer/…) the blog pages must
// pass to SiteLayout so they share the site's skin + capabilities. Prefers `_site` (the
// site-config layer); else the sitetile home page in content/ (legacy single-source).
export function siteMeta(contentGlob) {
  // Prefer the first-class `_site` config layer when present (SPEC-site-data-model).
  const site = loadSite(contentGlob);
  if (site) return site;
  // Legacy: the site-wide meta = the HOME page (NOT the first alphabetical content file,
  // which would give the wrong "— About <page>" title suffix). Prefer `content/home.md`.
  let fallback = {};
  for (const [path, raw] of Object.entries(contentGlob)) {
    const { meta } = splitFrontmatter(String(raw || ''));
    if (!meta || !(meta['sitetile-page'] || meta.theme)) continue;
    if (/(^|\/)home\.md$/.test(path)) return meta;
    if (!Object.keys(fallback).length) fallback = meta;
  }
  return fallback;
}

// Render a flowing post body to HTML. site-core's bodyHtml owns blocks
// (paragraphs/lists/code/quotes/tables) but NOT `#`-headings (sitetile reserves
// `## ` for sections); blog prose uses them, so we split headings out here and
// hand the rest to bodyHtml — one inline-markdown source, headings layered on top.
// opts.br → wpautop mode: WordPress turns a single newline INSIDE a paragraph into <br>, but
// CommonMark (bodyHtml's default) folds it to a space. WP-sourced recasts need the breaks
// back. bodyHtml already renders a line ending in two trailing spaces as <br> (its markdown
// hard-break) — so in br mode we inject that hard-break between CONSECUTIVE PLAIN-TEXT lines only
// (guarded against list/image/quote/heading/code/html/table lines so those block constructs still
// parse). Opt-in per site (blog-post-linebreaks: br) → every other site keeps the CommonMark join.
export function flowingHtml(body, opts) {
  const br = !!(opts && opts.br);
  const isText = (ln) => ln != null && ln.trim() !== '' && !/^\s*([-*+>#|]|\d+[.)]\s|!\[|```|~~~|<|\[.*\]:)/.test(ln);
  const lines = String(body || '').split('\n');
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    let block = buf;
    if (br) block = buf.map((ln, i) => (isText(ln) && isText(buf[i + 1]) && !/\s\s$/.test(ln) ? ln + '  ' : ln));
    out.push(bodyHtml(block.join('\n'))); buf = [];
  };
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; buf.push(line); continue; }
    const h = !inFence && /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      // 🩸 corrected 2026-07-05 (dead-rule triage): verified against live's real devlog
      // post body — `## ` maps directly to <h2> (12 h2s counted on a real post), not
      // shifted to h3. Live's own post <h1> title lives outside this body entirely.
      const level = Math.min(h[1].length, 6);
      out.push('<h' + level + '>' + inlineHtml(h[2].trim()) + '</h' + level + '>');
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join('');
}

// groupByArchive: posts (already newest-first from allPosts()) → a year→month tree for a
// Blogger/WP-style "Archive" sidebar widget (`2026 (2)` → `2026 年 5 月 (2)` → post titles).
// General for any site whose real sidebar carries this pattern — any Blogger-descended or
// WP-with-archive-widget site needs it.
// Requires `date` to be an ISO-ish `YYYY-MM-DD` string (pubDate frontmatter) — posts missing a
// parseable date are dropped from the tree (they still appear in the flat /devlog list).
// The archive is a public-facing view-model. Keep an explicit metadata allowlist here so a
// future archive component cannot accidentally serialize private content carried by a raw post.
function archivePostView(post) {
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    tags: post.tags,
    image: post.image,
    author: post.author,
    permalink: post.permalink,
  };
}

export function groupByArchive(posts) {
  const years = new Map();
  for (const p of posts) {
    const m = /^(\d{4})-(\d{2})/.exec(String(p.date || ''));
    if (!m) continue;
    const [, y, mo] = m;
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(mo)) months.set(mo, []);
    months.get(mo).push(archivePostView(p));
  }
  return [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => ({
    year,
    count: [...months.values()].reduce((n, ps) => n + ps.length, 0),
    months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, ps]) => ({
      year, month, count: ps.length, posts: ps,
    })),
  }));
}

// fmtDate: format a pubDate string per the `blog-date-format` meta key (home.md
// frontmatter). Default (format is undefined/unrecognized) = the historic
// en-US "June 25, 2026" — kept byte-identical to the original inline arrow fn so
// existing output never changes when the meta key is absent.
export function fmtDate(s, format) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  switch (format) {
    case 'ymd-slash': // 2026/05/20
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    case 'cjk-full': // 2025 年 11 月 11 日
    case 'cjk-badge': // an index badge uses dateBadgeParts() instead; post detail falls back to cjk-full here
      return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    case 'cjk-md': // 4月8日
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    default:
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}

// footerWidgets: the repeating "popular posts + category cloud" widgets a WP/Blogger footer
// (the stock `#top-posts-N` + `#tag_cloud-N` widgets) shows above the footer nav on EVERY page.
// Recast authors these ONCE in the home IR's body — a prose section that is a pure link-list
// (a heading followed by `- [title](/href)` × N) and a `tagcloud` section. SiteLayout
// renders them in the home BODY there, but non-home pages (posts/about/…) never carried them,
// so their footer was missing content live has on every page. This lifts the SAME home-IR data
// (single source, no duplication) so SiteLayout can also render it in the footer of non-home
// pages. Returns { popular, categories } of { heading, items:[{label,href}] } — or null when the
// home page has neither (a site whose home has no such sections is unaffected).
// General: any site whose real footer repeats a popular-posts list + a tag cloud.
export function footerWidgets(contentGlob) {
  let homeRaw = null;
  for (const [path, raw] of Object.entries(contentGlob || {})) {
    if (/(^|\/)home\.md$/.test(path)) { homeRaw = String(raw || ''); break; }
  }
  if (!homeRaw) return null;
  let sections = [];
  try { sections = parseSite(homeRaw).sections || []; } catch { return null; }
  // Parse one `- [label](href)` list line. GREEDY label so a title carrying its own brackets
  // (a title like "[Series] How to …" — an inner `[…]` that is literal link text)
  // is captured whole rather than truncated at the first `]`.
  const parseLine = (line) => {
    const m = String(line).trim().match(/^-\s*\[(.+)\]\(([^)]+)\)\s*$/);
    return m ? { label: m[1], href: m[2] } : null;
  };
  const listItems = (body) => String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).map(parseLine);
  const asWidget = (s) => {
    const items = listItems(s.body);
    return items.length && items.every(Boolean) ? { heading: s.title || '', items } : null;
  };
  // popular = the prose section whose body is a pure link-list (a list widget, not real prose);
  // categories = the tagcloud section. Both matched structurally (no language hardcoded).
  const popular = (() => {
    const s = sections.find((x) => x.type === 'prose' && x.title && asWidget(x));
    return s ? asWidget(s) : null;
  })();
  const categories = (() => {
    const s = sections.find((x) => x.type === 'tagcloud');
    return s ? asWidget(s) : null;
  })();
  return (popular || categories) ? { popular, categories } : null;
}

// homeSections: the parsed sections of the site's home IR body. Used ONLY by the root-mounted
// blog index (BlogIndexView's isHome path) to render the home's curated widgets — a featured
// carousel + a popular list + a tag cloud — BELOW the post grid, exactly as
// live's root-mounted blog home does (grid → carousel → popular → categories → footer). When the
// blog owns `/`, the root catch-all router deliberately DROPS home.md's body as a page (the post
// list owns `/`), so these curated sections — which the theme already styles via
// `body[data-page="home"] .st-prose`/`.st-sidebar-main > .st-tagcloud`/`.st-carousel` — would
// otherwise never render on the home (they only survive as the FOOTER widgets on non-home pages
// via footerWidgets). This lifts the SAME home IR the footer widgets read, so the home shows its
// widgets in its own body while non-home pages mirror them in the footer — no duplication (footer
// widgets stay suppressed on the home path in SiteLayout). Returns [] when there's no home.md or it
// has no sections (every non-root-mount site never calls this: isHome is false unless blog-path is
// the site root, so this is inert on every site that mounts its blog elsewhere).
export function homeSections(contentGlob) {
  let homeRaw = null;
  for (const [path, raw] of Object.entries(contentGlob || {})) {
    if (/(^|\/)home\.md$/.test(path)) { homeRaw = String(raw || ''); break; }
  }
  if (!homeRaw) return [];
  try { return parseSite(homeRaw).sections || []; } catch { return []; }
}


// paginate: split newest-first posts into pages of `size` (blog-page-size meta).
// size <= 0/missing → a single page holding every post, i.e. today's unpaginated behavior.
export function paginate(posts, size) {
  const n = Number(size);
  if (!n || n <= 0) return [posts];
  const out = [];
  for (let i = 0; i < posts.length; i += n) out.push(posts.slice(i, i + n));
  return out.length ? out : [[]];
}

// pagerItems: numbered pager entries for `current` of `total` pages — first, last,
// current ± 1, with `{ellipsis:true}` markers filling the gaps (the standard
// "1 2 … 6 7 8 … 140 141" pattern, so a real 141-page archive doesn't render 141 links).
export function pagerItems(current, total) {
  if (total <= 1) return [];
  const nums = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push({ ellipsis: true });
    out.push({ page: n });
    prev = n;
  }
  return out;
}

// buildIndexView: shared view-model for /devlog (page 1) and /devlog/page/<n> (page 2+)
// so both routes — and a single unpaginated page — stay in lockstep instead of
// two copies of pagination/sidebar/tag logic drifting apart. `pageNum` is 1-based;
// out-of-range values clamp into range.
// `corpusIn` (optional) is the WHOLE site's posts when `allPostsIn` is only a slice of them — an
// archive route lists one term but its rail still describes the site. Defaults to the same corpus,
// so the blog index (where the two ARE the same) is unchanged.
export function buildIndexView(allPostsIn, meta, pageNum = 1, corpusIn) {
  // Filter HERE, not only at the route: every number this function returns (page count, pager,
  // recent posts, tag cloud, year archive) is derived from the corpus it is handed, so a caller
  // that forgets would produce a correct-looking page whose pager runs off the end.
  const posts = listedPosts(allPostsIn, meta);
  const corpus = corpusIn === undefined ? posts : listedPosts(corpusIn, meta);
  const pageSize = Number(meta['blog-page-size']) || 0;
  const pages = pageSize > 0 ? paginate(posts, pageSize) : [posts];
  const totalPages = pages.length;
  const currentPage = Math.min(Math.max(pageNum, 1), totalPages);
  // Per-site excerpt cap (home `blog-excerpt-chars`): re-truncate each card's excerpt from its
  // full excerptText. OPT-IN — absent/0 → capPost is identity, so the excerpt stays exactly what
  // parsePost produced (default 180) and existing cards are byte-for-byte unchanged.
  const excerptChars = Number(meta['blog-excerpt-chars']) || 0;
  // publicFacing first: a private post reaches a card with no excerpt left to cap.
  const capPost = (post) => {
    const p = publicFacing(post);
    return (excerptChars > 0 && p.excerptText != null)
      ? { ...p, excerpt: capExcerpt(p.excerptText, excerptChars) } : p;
  };
  const pagePosts = (pages[currentPage - 1] || []).map(capPost);
  const tags = [];
  for (const p of pagePosts) for (const t of p.tags) if (!tags.includes(t)) tags.push(t);
  // archiveSidebar = the WP/Blogger-style widgets (search + recent + tagcloud + year archive),
  // i.e. `blog-sidebar`. categorySidebar = the Wix category-menu rail, opt-in and INDEPENDENT so a
  // site can show ONLY the category list — a real Wix blog sidebar is exactly that, with no
  // recent/tagcloud/archive. Either turns the sidebar column on.
  const archiveSidebar = meta['blog-sidebar'] != null && String(meta['blog-sidebar']) !== 'false';
  // 🔴 `corpus`, not `posts`. The rail answers "what does this site hold", the list answers "what
  // is on this page" — and on an archive route those are different questions with different sizes.
  const categories = (meta['blog-category-sidebar'] != null && String(meta['blog-category-sidebar']) !== 'false')
    ? blogCategories(meta, corpus) : [];
  const showSidebar = archiveSidebar || categories.length > 0;
  const recentPosts = posts.slice(0, 5).map(capPost);
  const archive = archiveSidebar ? groupByArchive(posts) : [];
  return {
    pagePosts, tags, tagCounts: corpusTagCounts(posts), totalPages, currentPage, pager: pagerItems(currentPage, totalPages),
    showSidebar, archiveSidebar, categories, recentPosts, archive,
    dateFormat: meta['blog-date-format'],
    readMore: meta['blog-read-more'],
  };
}

// corpusTagCounts: { tagName → how many posts carry it } over the WHOLE corpus (not one page).
// Powers the tag-cloud weighting so a popular tag renders bigger — a real, harvested signal, not
// an invented weight (the count is the number of posts carrying the tag).
export function corpusTagCounts(posts) {
  const c = {};
  for (const p of posts) for (const t of p.tags) c[t] = (c[t] || 0) + 1;
  return c;
}

// tagFontSize: map a tag's post-count to a cloud font-size (em). Sqrt-scaled so an 83-post tag
// doesn't dwarf a 1-post tag; clamped to a tasteful 0.8em–1.5em. Returns '' if counts are flat
// (nothing to weight) so the cloud stays uniform rather than all-max.
export function tagFontSize(count, counts) {
  const vals = Object.values(counts || {});
  if (!vals.length) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max <= min) return '';
  const t = (Math.sqrt(count) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return (0.8 + t * 0.7).toFixed(3) + 'em';
}

// buildPostSidebar: the sidebar view-model for a POST detail page (opt-in `blog-post-sidebar:
// left | right`), REUSING the same corpus-derived widgets buildIndexView computes for the blog
// INDEX (recent posts / tag cloud / year archive / authored category rail) so a post page and its
// index share ONE sidebar language instead of a second, drifting implementation. Returns null when
// the site hasn't opted in — PostView then renders EXACTLY as before (including a site using the
// site-level `layout: sidebar` shell: byte-identical, no wrapper, no
// aside, single column). The widget SET is governed by the SAME sub-flags the index already reads,
// so a site that has an index sidebar gets the matching post sidebar for free:
//   • blog-sidebar          → the WP-archive rail: search shell + recent posts + tag cloud +
//                             all posts (for a site whose post sidebar mirrors its index)
//   • blog-category-sidebar → the authored category rail
// Plus an OPT-IN related-posts widget (`blog-sidebar-related: true`, off by default) derived from
// shared tags — off because a faithful recast shows only what the source sidebar carries, and a
// real WP post sidebar often has NO related list. ALL content is corpus-derived (never fabricated).
// 🩸 corrected 2026-07-13: the search box is REAL now, not a structural shell — BlogIndexView/
// PostView render `.bl-side-search` as a working `action="/search" method="get"` form (wired to
// the SAME blog-search coral — search-index.json.js + blog-search.js — the header overlay uses)
// whenever the site opts into `blog-search: true` (blogSearchOn()); absent, the box doesn't
// render at all rather than sitting there non-functional (no-phantom-features). `side` (left|right)
// only picks which grid column the aside occupies (theme CSS).
export function buildPostSidebar(allPostsIn, meta, current) {
  // 🔑 This sidebar renders on an UNLISTED post's own page too — that page stays alive on purpose.
  // What it must not do is hand the reader a way back into the unlisted set, so its recent list,
  // tag cloud, archive and related links are all built from the listed corpus.
  const posts = listedPosts(allPostsIn, meta);
  const side = String((meta && meta['blog-post-sidebar']) || '').trim().toLowerCase();
  if (side !== 'left' && side !== 'right') return null; // opt-in gate → PostView unchanged
  const archiveSidebar = meta['blog-sidebar'] != null && String(meta['blog-sidebar']) !== 'false';
  const categories = (meta['blog-category-sidebar'] != null && String(meta['blog-category-sidebar']) !== 'false')
    ? blogCategories(meta, posts) : [];
  const sidebarPost = (p) => ({ title: p.title, href: postUrl(p, meta) });
  const recentPosts = posts.slice(0, 5).map(sidebarPost);
  // corpus-wide tag cloud (capped so a large blog's cloud stays a cloud, not a wall). First-seen
  // order over the newest-first corpus — real tags, no invented weights.
  const tags = [];
  for (const p of posts) { for (const t of p.tags) if (!tags.includes(t)) tags.push(t); if (tags.length >= 80) break; }
  const wantRelated = String(meta['blog-sidebar-related'] || '').trim() === 'true';
  const relatedN = Number(meta['blog-related']) || 5;
  const cur = current || {};
  const relatedPosts = (wantRelated && cur.tags && cur.tags.length)
    ? posts.filter((p) => p.slug !== cur.slug && p.tags.some((t) => cur.tags.includes(t))).slice(0, relatedN)
    : [];
  const related = relatedPosts.map(sidebarPost);
  const archive = archiveSidebar ? groupByArchive(posts) : [];
  return { side, archiveSidebar, categories, recentPosts, tags, tagCounts: corpusTagCounts(posts), related, archive };
}

// blogSearchOn: is the pure-front-end blog search capability turned on for this site?
// Opt-in via the home meta `blog-search: true` (any value that isn't null / "false").
// Absent → SiteLayout renders no toggle/overlay/script AND search-index.json emits [] —
// so a site that never opts in is byte-for-byte unaffected. Free for any --blog site.
export function blogSearchOn(meta) {
  return meta != null && meta['blog-search'] != null && String(meta['blog-search']).trim() !== 'false';
}

// ── source-faithful blog URLs ────────────────────────────────────────────────
// blogBase / postUrl / indexUrl centralise EVERY blog URL so a recast can honour the
// source site's REAL permalink shape (WP `/YYYY/MM/slug/`, per-post overrides, a root
// mount) instead of the hardcoded `/devlog/<slug>`. The DEFAULTS are chosen so a site
// with no `blog-path` / `blog-url-pattern` set expands to EXACTLY the old strings —
// existing output stays byte-for-byte identical (Phase 1 is a pure refactor).

// blogBase: the blog's mount base. `blog-path` absent → historic `/devlog`. An explicit
// empty / "/" mounts the blog at the site root (''); any other value is trailing-slash
// normalised so callers can always append `/…` without doubling the slash.
export function blogBase(meta) {
  if (!meta || meta['blog-path'] == null) return '/devlog';
  const raw = String(meta['blog-path']).trim();
  if (raw === '' || raw === '/') return '';
  return raw.replace(/\/+$/, '');
}

// blog tenancy — whether a site HAS a blog, and whose name is on it. Lives in its own module
// (blog-tenancy.mjs) with no `@sitetile` import so plain `node` can test it; re-exported here
// so every call site keeps importing from blog.mjs. See that file for why it exists: the blog's
// defaults were once the vendor's own identity, and tenants inherited it.
export { blogInstalled, feedTitle, feedDescription } from './blog-tenancy.mjs';

// tagSlugMap: parse the `blog-tag-slugs: Name=slug | Name2=slug2` config into { name → slug }.
// A tag's DISPLAY name lives on the post; its URL uses WP's slug (English-slug tags like
// a CJK display name with an English slug needs an entry; a tag whose slug equals its name does
// not). The WP `/tag/`
// archive route uses this to emit source-faithful `/tag/<slug>/` URLs. Exported (not a route-local
// helper) because Astro's getStaticPaths runs in an isolated scope that only sees imports.
export function tagSlugMap(meta) {
  const raw = String((meta && meta['blog-tag-slugs']) || '').trim();
  const out = {};
  if (!raw) return out;
  for (const part of raw.split('|')) {
    const i = part.lastIndexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim(), slug = part.slice(i + 1).trim();
    if (name && slug) out[name] = slug;
  }
  return out;
}

// kvMap: parse a `key=value | key2=value2` meta line into { key: value }. Used by the category /
// author archives to map a WP slug → its display name (blog-category-names / blog-author-names),
// so /category/<wp-slug>/ can show its real display heading. lastIndexOf('=') so values may contain '='.
export function kvMap(val) {
  const out = {};
  for (const part of String(val || '').split('|')) {
    const i = part.lastIndexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

// tagHref: where a tag name links. When the WP-style archives are on (`blog-tag-routes`), tag
// clouds/chips link to the real `/tag/<slug>/` server page (source-faithful, and consistent with
// links elsewhere); otherwise they fall back to the `?tag=` client-side filter on the blog index
// (the pre-archive behaviour — a site with no /tag/ pages is unchanged).
export function tagHref(meta, tag, slugMap, catSet) {
  // A tag that IS a real category slug goes to its category archive. On sites where per-post
  // `categories:` is the only axis (tags fall back to it — see parsePost), the /category/<slug>/
  // page is the destination the source itself published; sending those chips to the ?tag= filter
  // instead would be a worse answer than the one already on disk. Gated on catSet so it can only
  // fire for slugs that really got a route emitted — same "never link a page that isn't there"
  // rule blogCategories() follows with its empty hrefs.
  if (catSet && catSet.has(tag)) {
    const base = String((meta && meta['blog-category-base']) || '/category').replace(/\/$/, '');
    return `${base}/${tag}/`;
  }
  const on = meta && meta['blog-tag-routes'] != null && String(meta['blog-tag-routes']) !== 'false';
  if (on) {
    const base = String((meta && meta['blog-tag-base']) || '/tag').replace(/\/$/, '');
    const slug = (slugMap || tagSlugMap(meta))[tag] || tag;
    return `${base}/${slug}/`;
  }
  const label = meta && meta['blog-label-routes'] != null && String(meta['blog-label-routes']) !== 'false';
  if (label) return `/search/label/${tag}/`;
  return `${blogBase(meta)}?tag=${encodeURIComponent(tag)}`;
}

// routedCategories: the set of category slugs that /category/<slug>/ really emitted a page for —
// i.e. `blog-category-routes` is on AND the slug occurs in the corpus. Exactly the condition
// category/[slug]/index.astro's getStaticPaths uses, kept in one place so a chip can't link to a
// category page that route decided not to build. Empty Set when the routes are off.
export function routedCategories(posts, meta) {
  const on = meta && meta['blog-category-routes'] != null && String(meta['blog-category-routes']) !== 'false';
  if (!on) return new Set();
  // Belt and braces: the callers pass the listed corpus, but this is the function that decides
  // whether a tag chip becomes an <a>, and a chip pointing at a route getStaticPaths never emitted
  // is a dead link on a live page. Re-checking here costs nothing and cannot be forgotten.
  const hidden = unlistedCategories(meta);
  const out = new Set();
  for (const p of posts || []) for (const c of (p.categories || [])) if (c && !hidden.has(c)) out.add(c);
  return out;
}

// postUrl: the source-faithful URL for one post. Priority:
//   ① post.permalink — a frontmatter per-post override (safety net for odd source URLs)
//   ② the `blog-url-pattern` expanded from the post's date/slug/id/category/author
// The DEFAULT pattern is `${blogBase(meta)}/%postname%`, so with no meta configured it
// expands to `/devlog/<slug>` — byte-identical to the old hardcoded template literal.
// WP permalink tags: %year% %monthnum% %day% %hour% %postname% %post_id% %category%
// %author%. month/day/hour zero-pad to 2 digits; %post_id% falls back to the numeric part
// of a `p-<n>` slug else the slug; %category% to the first tag else ''. Empty tokens
// collapse their path segment (no `//`); a literal trailing slash in the pattern survives.
export function toPath(u) {
  // URL string ('/devlog/slug', '/devlog', '/') → the [...path] rest-param: same path with
  // leading/trailing slashes stripped, '' → undefined (site root → index.html). Exported (not a
  // frontmatter const) so it's reliably in getStaticPaths scope. CJK + multi-segment pass verbatim.
  const s = String(u == null ? '' : u).replace(/^\/+/, '').replace(/\/+$/, '');
  return s === '' ? undefined : s;
}

export function postUrl(post, meta) {
  const p = post || {};
  if (p.permalink) return String(p.permalink);
  const pattern = (meta && meta['blog-url-pattern'] != null && String(meta['blog-url-pattern']).trim())
    || `${blogBase(meta)}/%postname%`;
  const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(p.date || ''));
  const hm = /[T ](\d{1,2}):/.exec(String(p.date || ''));
  const year = dm ? dm[1] : '';
  const month = dm ? dm[2].padStart(2, '0') : '';
  const day = dm ? dm[3].padStart(2, '0') : '';
  const hour = hm ? hm[1].padStart(2, '0') : '';
  const slug = p.slug || '';
  const idM = /^p-(\d+)$/.exec(slug);
  const postId = idM ? idM[1] : slug;
  const category = (p.tags && p.tags[0]) || '';
  const author = p.author || '';
  const url = pattern
    .replace(/%year%/g, year)
    .replace(/%monthnum%/g, month)
    .replace(/%day%/g, day)
    .replace(/%hour%/g, hour)
    .replace(/%postname%/g, slug)
    .replace(/%post_id%/g, postId)
    .replace(/%category%/g, category)
    .replace(/%author%/g, author);
  // collapse any `//` left by an empty token; a real trailing slash survives (single /).
  return url.replace(/\/{2,}/g, '/');
}

// indexUrl: the blog index URL for page `n`. Page 1 = the base itself (root '' → '/');
// page 2+ = `${base}/page/<n>`. With the default base this yields `/devlog` and
// `/devlog/page/<n>` — byte-identical to the old inline pageHref.
export function indexUrl(meta, n = 1) {
  const base = blogBase(meta);
  return Number(n) <= 1 ? (base || '/') : `${base}/page/${n}`;
}

// searchIndex: the lean, all-in-one JSON payload the blog-search AND blog-archive islands
// fetch ONCE (lazily). One post → { t:title, u:url, g:tags, d:date, i:image } — short keys
// keep the corpus small over the wire. `i` (the featured-image URL, '' when none) lets the
// blog-archive island's ?tag=/?ym= filtered listing render the SAME image-card the server
// renders for the recent set (the archive spans the FULL corpus, not the ~10 posts in the
// page DOM, so it can't reuse those nodes — it rebuilds from this index). When
// `blog-search-body: true` is set, each entry also carries `e` = an excerpt slice (the parsed
// excerptText capped to `blog-search-excerpt-chars`, default 80) so the body is searchable AND
// the archive cards can show an excerpt — a bigger payload, hence opt-in. `u` is built from the
// site's `blog-path` base (default /devlog), matching how the index/label pages link a post, so
// a hit navigates to the real post URL. Single source: the search-index.json endpoint, the
// /search page, and the archive island all call this — they can't drift.
export function searchIndex(posts, meta) {
  const withBody = meta != null && meta['blog-search-body'] != null && String(meta['blog-search-body']).trim() === 'true';
  const bodyChars = Number(meta && meta['blog-search-excerpt-chars']) > 0 ? Number(meta['blog-search-excerpt-chars']) : 80;
  return (posts || []).map((post) => {
    // This file is served to anyone who asks for it, so `e` is built from the public-facing post.
    const p = publicFacing(post);
    const row = { t: p.title, u: postUrl(p, meta), g: p.tags || [], d: p.date || '', i: p.image || '' };
    if (withBody) row.e = String(p.excerptText || '').slice(0, bodyChars);
    return row;
  });
}

export { fmStr };
