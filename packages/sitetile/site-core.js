// sitetile — the tile family's "whole website" content model (platform-free, no Obsidian, no DOM).
//
// The family's render-side counterpart to the editors: Card = one page (WYSIWYG), Blog = flowing
// posts, pagetile = paged books — and sitetile = a SITE PAGE: a sequence of typed SECTIONS
// (hero / grid / cta / prose / embed) authored in plain Markdown, rendered to a clean static site.
// This is the "REEF with Site" renderer's model. The Astro component wrapping is a downstream
// feelreef seam (see renderSiteToHtml TODO) — this file owns only the pure model + a zero-dep
// reference HTML renderer.
//
// Same family trick as packages/pagetile/book-core.js + tugtile board-core: ONE pure model, parsed and
// serialized here, exact round-trip (the family's "your data stays Markdown, not a database" rule),
// unit-testable in plain Node. Structure is encoded with NATIVE Markdown (headings) — the family
// never invents block syntax when CommonMark expresses it. The ONE thing Markdown can't express —
// a section's LAYOUT TYPE — rides in an Obsidian-style `%% … %%` comment (the family's sentinel of
// choice; never `:::` containers, never `<!-- -->`), namespaced `sitetile:`.
//
// ── Storage format (the on-disk truth) ───────────────────────────────────────────────────────
//   ---
//   sitetile-page: home          ← claim flag (frontmatter), like pagetile-book / tugtile-plugin
//   title: 山田珈琲
//   ---
//
//   ## 每一杯，都從產地說起        ← `## ` heading = ONE section; heading text = the section title
//   %% sitetile: hero bg=cover.jpg cta="預約"→/booking %%   ← type line: hugs the `##`, default = prose
//   自家烘焙咖啡店的日常筆記。      ← section body = raw Markdown (inline via cssmd at render)
//
//   ## 我們的豆子
//   %% sitetile: grid cols=3 %%
//   ### 單品                      ← inside a grid, `### ` heading = ONE cell (same idea, one essence down)
//   產地直送、小批烘焙⋯
//   ### 配方
//   每季調整、風味筆記⋯
//
//   ## 想喝一杯嗎？
//   %% sitetile: cta button="立即預約"→/booking %%
//
// Section TYPES (5): prose (default — no type line needed) · hero · grid · cta · embed (escape hatch:
// body passed through VERBATIM, the one portability-debt seam — grow a real marker instead when a
// shape recurs). Unknown types render as prose but round-trip their literal type token.

import { renderInlineMd, escHtml } from '../cssmd/cssmd.js';
import { highlightCode, knowsLanguage } from '../cssmd/highlight.js';

const FRONTMATTER_KEY = 'sitetile-page';
const KNOWN_TYPES = ['prose', 'hero', 'grid', 'gallery', 'carousel', 'cta', 'embed', 'collection', 'timeline', 'social', 'tagcloud', 'faq', 'form', 'people'];

// tagcloudLinks: a tagcloud section body (a markdown list of `- [Label](/href)` items) → an
// ordered [{label, href}]. General — a weighted category/tag cloud is a near-universal WP/Blogger
// widget (`#tag_cloud-N`, `.wp-tag-cloud`), a flow of inline links no vertical/card coral expresses.
// Label carries its own count baked in (e.g. "comic576"), matching how live themes print tag+count.
function tagcloudLinks(body) {
  const out = [];
  const RE = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = RE.exec(body || '')) !== null) out.push({ label: m[1], href: m[2] });
  return out;
}

// parseSidebarNav: parse `sidebar-nav:` frontmatter → [{head, items:[{label,href}]}].
// Syntax mirrors `footer-cols:`: `;;` separates groups, `;` separates items,
// `Label=url` for linked items (href omitted → plain span). General; any page can use it.
function parseSidebarNav(raw) {
  return String(raw || '').split(';;').map((c) => c.trim()).filter(Boolean).map((col) => {
    // The head:items delimiter is the first BARE colon — one NOT immediately followed by `//`,
    // so an absolute `https://…`/`http://…` URL in a headless group's first item (no `head:` given)
    // doesn't get its protocol colon mistaken for the group-head separator (this silently ate the
    // whole first item into a garbage "head" and left every item after it in one run-on string).
    const m = col.match(/:(?!\/\/)/);
    const ci = m ? m.index : -1;
    const head = ci >= 0 ? col.slice(0, ci).trim() : '';
    const itemsRaw = ci >= 0 ? col.slice(ci + 1) : col;
    const items = itemsRaw.split(';').map((s) => s.trim()).filter(Boolean).map((it) => {
      const m = it.match(/^(.*\S)\s*=\s*(\S+)$/);
      if (!m) return { label: it, href: '' };
      // optional `^weight` suffix on the href = per-item font size in px (weighted tag cloud —
      // WP tag-cloud widgets size each tag by post count; harvested from live). Purely visual,
      // omit → renders at the group's default size, so existing sidebar-navs are unaffected.
      const hw = m[2].match(/^(.*?)\^(\d+(?:\.\d+)?)$/);
      return hw ? { label: m[1].trim(), href: hw[1], weight: Number(hw[2]) } : { label: m[1].trim(), href: m[2].trim() };
    });
    return { head, items };
  });
}

const RE_FENCE = /^\s*(```|~~~)/;
// `## Title` = a section; bare `##` (no title) = a headingless section (e.g. a
// lead/tagline band). The optional group keeps `### cell` headings from matching.
const RE_H2 = /^##(?:\s+(.*))?$/;
// `### ` = grid cell OR collection group; `#### ` = collection item (one level deeper).
// RE_H3 must NOT match `#### ` (negative lookahead on the 4th #).
const RE_H3 = /^###(?!#)\s+(.*)$/;
const RE_H4 = /^####\s+(.*)$/;
// The type line: `%% sitetile: <type> [params] %%`. Inner is `<type>` then a raw param string.
const RE_TYPELINE = /^%%\s*sitetile:\s*(.*?)\s*%%\s*$/;

function slugify(s, fallback) {
  const out = String(s == null ? '' : s).toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}

// Minimal frontmatter reader — key: value pairs only, NO YAML dependency (family rule; copied from
// book-core.js splitFrontmatter). Preserves source key order (object insertion order).
function splitFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1];
    const marker = kv[2].trim();
    // YAML block scalar: `key: |` (literal — keep newlines) or `key: >` (folded — newlines→spaces).
    // Collect the more-indented block beneath, stripping its common indent — so nav / footer / any
    // key can be an indented tree instead of one cramped line. Any other value stays single-line.
    if (marker === '|' || marker === '>') {
      const block = [];
      let base = null;
      while (i + 1 < lines.length) {
        const nxt = lines[i + 1];
        if (nxt.trim() === '') { block.push(''); i++; continue; }
        const ind = (nxt.match(/^[ \t]*/)[0] || '').length;
        if (base === null) base = ind;
        if (ind < base) break;
        block.push(nxt.slice(base));
        i++;
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      meta[key] = marker === '>' ? block.join(' ') : block.join('\n');
    } else {
      meta[key] = marker;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

// Trim leading/trailing blank lines off a buffer, join to a raw block (matches book-core caption).
function blockOf(lines) {
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// Split a grid cell heading (`### Products →/products "See products"`) into { emoji, title, href, cta, badge }.
// `→<href>` makes the whole cell a link; an optional trailing "<label>" is the CTA text rendered next
// to the directional arrow (absent → a bare chevron). Absent `→` → a plain cell.
// EXTENSIONS (general, opt-in, round-trip): a leading Lucide ICON shortcode (`### :book-open: The
// Comic`) → a line icon (the house style — no colour emoji); a leading EMOJI (`### 📖 The Comic`)
// still parses for back-compat; a trailing `[Badge]` (`### The Comic [Soon]`) → a status pill
// (theme colours it by `data-badge`). All absent on a plain grid → untouched.
function splitCellHeading(raw) {
  let s = String(raw || '').trim();
  let icon = '';
  const ic = /^:([a-z0-9-]+):\s+/.exec(s);
  if (ic) { icon = ic[1]; s = s.slice(ic[0].length).trim(); }
  let emoji = '';
  const em = /^(\p{Extended_Pictographic}️?)\s+/u.exec(s);
  if (em) { emoji = em[1]; s = s.slice(em[0].length).trim(); }
  let badge = '', badgeHref = '';
  const bm = /\s*\[([^\]]+)\]\s*$/.exec(s);
  if (bm) {
    let b = bm[1].trim();
    // `[Label →href]` makes the badge its OWN link — a secondary card action rendered above the
    // whole-card overlay link (a card whose whole surface opens one link). Plain `[Label]` (no `→`)
    // stays a static status pill. General/opt-in: cells without the arrow are byte-unchanged.
    const bh = /^(.*?)\s*→\s*(\S+)\s*$/.exec(b);
    if (bh) { badge = bh[1].trim(); badgeHref = bh[2]; } else { badge = b; }
    s = s.slice(0, bm.index).trim();
  }
  const m = /^(.*?)\s*→\s*(\S+?)(?:\s+"([^"]*)")?\s*$/.exec(s);
  return m ? { icon, emoji, title: m[1].trim(), href: m[2], cta: m[3] || '', badge, badgeHref }
           : { icon, emoji, title: s, href: '', cta: '', badge, badgeHref };
}

// Split the inner of a type line (`hero bg=x cta="y"→/z`) into { type, params } where params is the
// raw remainder string (preserved verbatim for exact round-trip; parsed lazily by parseParams).
function splitTypeInner(inner) {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(inner.trim());
  if (!m) return { type: 'prose', params: '' };
  return { type: m[1], params: m[2].trim() };
}

// parseSite: raw Markdown → Site model. Pure. Code fences are respected so a `##`/`###` inside a
// fenced block is NOT mistaken for a section/cell (same guard as book-core / the editor's tocHeadings).
//
//   Site    = { title, meta, sections: [Section] }
//   Section = { id, title, type, params, hasTypeLine, body, cells: [Cell] }   // body = lead text; cells only for grid
//   Cell    = { title, body }                                                 // a grid cell (### heading + body)
//   Group   = { title, lead, items|people }                                   // a `collection`/`people` category
//
// 🩸 `Group` was missing from this sketch, and so was `lead` from collection's group builder — the
// model's own documentation named neither, which is part of why a dropped field stayed invisible.
// Anything the parser collects has to have a home here AND a line in serializeSite, or it is
// deleted on the next save. site-core-roundtrip.test.mjs is the ruler that says so.
function parseSite(text) {
  const { meta, body } = splitFrontmatter(String(text || ''));
  const lines = body.split('\n');

  // Pass 1 — fence-aware split into sections by `## ` headings. Preamble (before the first `##`) is
  // dropped on re-serialize, same as book-core (authoring keeps everything under a section).
  const rawSections = [];
  let cur = null, fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RE_FENCE.test(line)) { fence = !fence; if (cur) cur.lines.push(line); continue; }
    if (!fence) {
      const h2 = RE_H2.exec(line);
      if (h2) { cur = { title: (h2[1] || '').trim(), lines: [] }; rawSections.push(cur); continue; }
    }
    if (cur) cur.lines.push(line);
  }

  // Pass 2 — per section: consume an optional hugging type line, then body (or, for grid, ### cells).
  const sections = rawSections.map((rs, si) => {
    let type = 'prose', params = '', hasTypeLine = false;
    let rest = rs.lines;
    const t = rest.length ? RE_TYPELINE.exec(rest[0]) : null;
    if (t) { const st = splitTypeInner(t[1]); type = st.type; params = st.params; hasTypeLine = true; rest = rest.slice(1); }

    let body = '', cells = [], groups = [], entries = [], faqs = [], fields = [];
    if (type === 'faq') {
      // `faq` — a Q&A accordion: an optional lead (intro/subtitle), then `### <question>` +
      // answer body per item. Structurally the same walk as `timeline` (a `### head` + prose
      // pair), but the essence is a QUESTION not a year. Renders to native <details>/<summary>
      // (zero-JS, accessible). A near-universal WP/Blogger "FAQ accordion" widget (SiteOrigin
      // `.mp-accordion`, Yoast/Rank-Math FAQ block) no other coral expresses. Block carries the
      // Q/A structure; the THEME paints the disclosure chrome. An answer body may lead with a
      // `###### <bold summary>` (h6) — the exact shape live FAQs use for the one-line answer.
      const lead = [];
      let item = null, f2 = false;
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; (item ? item.lines : lead).push(ln); continue; }
        const h3 = !f2 && RE_H3.exec(ln);   // RE_H3 rejects `#### `+ so a `###### ` answer-lead stays body
        if (h3) { item = { q: h3[1].trim(), lines: [] }; faqs.push(item); continue; }
        (item ? item.lines : lead).push(ln);
      }
      body = blockOf(lead);
      faqs = faqs.map((e) => ({ q: e.q, body: blockOf(e.lines) }));
    } else if (type === 'form') {
      // `form` — a contact/inquiry form: an optional lead, then `### <label>` per field. A trailing
      // `{kind}` on the label sets the input type (`{email}` `{tel}` `{textarea}`; default text);
      // `- option` lines in a field's body become <select> options (and imply a select). This coral
      // carries only STRUCTURE (labels + field kinds + options + submit text) — the THEME paints the
      // inputs and submission wiring (action/backend) is a deploy concern, per cutover-structure-
      // before-data. General: any recast contact/inquiry page (no other coral expresses a form).
      const lead = [];
      let field = null, f2 = false;
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; (field ? field.lines : lead).push(ln); continue; }
        const h3 = !f2 && RE_H3.exec(ln);
        if (h3) { field = { label: h3[1].trim(), lines: [] }; fields.push(field); continue; }
        (field ? field.lines : lead).push(ln);
      }
      body = blockOf(lead);
      fields = fields.map((f) => {
        let label = f.label, kind = 'text';
        const km = /\{(\w+)\}\s*$/.exec(label);
        if (km) { kind = km[1].toLowerCase(); label = label.replace(/\s*\{\w+\}\s*$/, '').trim(); }
        const options = [];
        for (const ln of f.lines) { const mo = /^-\s+(.+)$/.exec(ln.trim()); if (mo) options.push(mo[1].trim()); }
        if (options.length && kind === 'text') kind = 'select';
        return { label, kind, options };
      });
    } else if (type === 'timeline') {
      // `timeline` — a chronological list: lead intro, then `### <year>` + body per entry.
      // The THEME decides treatment (e.g. year in a left gutter, text in the right column).
      // Block carries structure (year + prose); theme carries the grid/gutter look.
      const lead = [];
      let entry = null, f2 = false;
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; (entry ? entry.lines : lead).push(ln); continue; }
        const h3 = !f2 && RE_H3.exec(ln);
        if (h3) { entry = { year: h3[1].trim(), title: '', lines: [] }; entries.push(entry); continue; }
        // A `#### <title>` hugging the year line = the entry's TITLE → renders as an <h3> in the
        // prose column while the number stays in the gutter (a numbered step list). OPT-IN:
        // entries without it (the plain year+prose timelines) are byte-unchanged; only settable as the entry's
        // leading line, before any body content.
        const h4 = !f2 && entry && !entry.title && !entry.lines.some((l) => l.trim()) && RE_H4.exec(ln);
        if (h4) { entry.title = h4[1].trim(); continue; }
        (entry ? entry.lines : lead).push(ln);
      }
      body = blockOf(lead);
      entries = entries.map((e) => ({ year: e.year, title: e.title || '', body: blockOf(e.lines) }));
    } else if (type === 'grid' || type === 'gallery' || type === 'carousel') {
      // `gallery` shares grid's cell walk (### title →href [badge] + body). The difference is
      // render-only: a gallery cell is IMAGE-first (the leading `![](src)` in the body floats to
      // the top as a figure, title + caption below). General for cast / archive / portfolio / shop.
      // `carousel` is the SINGLE-ROW sibling of gallery: identical cell walk + image-first cards, but
      // rendered as a horizontal scroll track (slidesToShow via `cols=`) with prev/next arrows —
      // for casts/archives too long for a static grid (the slick-carousel shape).
      const lead = [];
      let cell = null, f2 = false;
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; (cell ? cell.lines : lead).push(ln); continue; }
        const h3 = !f2 && RE_H3.exec(ln);
        if (h3) { const ch = splitCellHeading(h3[1]); cell = { icon: ch.icon, emoji: ch.emoji, title: ch.title, href: ch.href, cta: ch.cta, badge: ch.badge, badgeHref: ch.badgeHref, lines: [] }; cells.push(cell); continue; }
        (cell ? cell.lines : lead).push(ln);
      }
      body = blockOf(lead);
      cells = cells.map((c) => ({ icon: c.icon || '', emoji: c.emoji || '', title: c.title, href: c.href || '', cta: c.cta || '', badge: c.badge || '', badgeHref: c.badgeHref || '', body: blockOf(c.lines) }));
    } else if (type === 'people') {
      // `people` — a roster of humans (or the companies they stand for): portrait, name, the roles
      // they hold, what they do, where to find them. The shape five different pages of one client
      // site were each hand-rolling out of `gallery` + bespoke CSS: collaborating artists by
      // discipline, teaching staff by class, recommended graduates by cohort, talents with their
      // own channels, partner companies as a logo wall. What made it its own coral rather than a
      // gallery variant: a person carries SEVERAL roles at once (a graduate lists four cohorts),
      // and their links are a row of named destinations, not one card-wide href.
      //
      // Depth is INFERRED, not declared, because most rosters are flat and only some are grouped:
      // a section containing any `####` reads `###` as a group heading and `####` as a person;
      // with no `####` anywhere, `###` IS the person. One rule, both shapes read naturally, and
      // an author never has to know which mode they are in.
      const hasSub = rest.some((ln) => !RE_FENCE.test(ln) && RE_H4.test(ln));
      const lead = [];
      let group = null, person = null, f2 = false;
      const pushLine = (ln) => (person ? person.lines : (group ? group.lead : lead)).push(ln);
      const startGroup = (title) => { group = { title, people: [], lead: [] }; groups.push(group); person = null; };
      const startPerson = (raw) => {
        if (!group) startGroup('');           // flat mode / people before the first `###`
        const ch = splitCellHeading(raw);
        person = { title: ch.title, href: ch.href, badge: ch.badge, badgeHref: ch.badgeHref, lines: [] };
        group.people.push(person);
      };
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; pushLine(ln); continue; }
        if (!f2) {
          const h3 = RE_H3.exec(ln);
          if (h3) { hasSub ? startGroup(h3[1].trim()) : startPerson(h3[1]); continue; }
          const h4 = RE_H4.exec(ln);
          if (h4) { startPerson(h4[1]); continue; }
        }
        pushLine(ln);
      }
      body = blockOf(lead);
      groups = groups.map((g) => ({
        title: g.title,
        lead: blockOf(g.lead),
        people: g.people.map((p) => {
          // Two order-free per-person seams, one each, pulled out of the body lines:
          //   `links: Label=https://…, Label=/…`  → the row of named destinations
          //   `tone: dark`                        → this tile carries a light-on-dark mark
          // `tone` exists because a logo wall is not uniform: on the wall this coral was grown
          // for, 3 of 13 marks are white and vanish on the default tile. Luminance is not
          // knowable from CSS, so it is authored — per person, not per section.
          let links = [], tone = '';
          const kept = [];
          for (const ln of p.lines) {
            const ml = /^links:\s*(.+)$/i.exec(ln.trim());
            if (ml) {
              links = ml[1].split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
                const eq = pair.indexOf('=');
                return eq === -1 ? { label: pair, href: pair } : { label: pair.slice(0, eq).trim(), href: pair.slice(eq + 1).trim() };
              }).filter((l) => l.href);
              continue;
            }
            const mt = /^tone:\s*(\S+)$/i.exec(ln.trim());
            if (mt) { tone = mt[1].toLowerCase(); continue; }
            kept.push(ln);
          }
          return { title: p.title, href: p.href || '', badge: p.badge || '', badgeHref: p.badgeHref || '', links, tone, body: blockOf(kept) };
        }),
      }));
    } else if (type === 'collection') {
      // Two levels: `### Group` → a category, `#### name →href "badge"` → an item card.
      // Lead (before the first `###`) is the section intro. Mirrors grid's cell walk one essence deeper.
      const lead = [];
      let group = null, item = null, f2 = false;
      for (let j = 0; j < rest.length; j++) {
        const ln = rest[j];
        if (RE_FENCE.test(ln)) { f2 = !f2; (item ? item.lines : (group ? group.lead : lead)).push(ln); continue; }
        if (!f2) {
          const h3 = RE_H3.exec(ln);
          if (h3) { group = { title: h3[1].trim(), items: [], lead: [] }; groups.push(group); item = null; continue; }
          const h4 = RE_H4.exec(ln);
          if (h4 && group) { const ch = splitCellHeading(h4[1]); item = { title: ch.title, href: ch.href, badge: ch.cta, lines: [] }; group.items.push(item); continue; }
        }
        (item ? item.lines : (group ? group.lead : lead)).push(ln);
      }
      body = blockOf(lead);
      groups = groups.map((g) => ({
        title: g.title,
        // 🩸 `lead` was collected by the walk above and dropped right here, and serializeSite had
        // nothing to write back — so every save through every door deleted a category's intro
        // paragraph. `people`, the other two-level coral, kept its group lead from the day it was
        // written; collection walked the same shape and only ever built half the model.
        lead: blockOf(g.lead),
        items: g.items.map((it) => {
          // pull three optional per-item seams out of the body lines (order-free, one each):
          //   `tags: a, b, c`     → topic pills (mirrors live /oss GitHub topics)
          //   `learn: /href`      → a secondary "Learn more →" link in the meta row
          //   `updated: <text>`   → the "Updated <text>" freshness stamp (mirrors live's repo activity text)
          let tags = [], learn = '', updated = '';
          const kept = [];
          for (const ln of it.lines) {
            const mt = /^tags:\s*(.+)$/i.exec(ln.trim());
            if (mt) { tags = mt[1].split(',').map((s) => s.trim()).filter(Boolean); continue; }
            const ml = /^learn:\s*(\S+)$/i.exec(ln.trim());
            if (ml) { learn = ml[1]; continue; }
            const mu = /^updated:\s*(.+)$/i.exec(ln.trim());
            if (mu) { updated = mu[1].trim(); continue; }
            kept.push(ln);
          }
          return { title: it.title, href: it.href || '', badge: it.badge || '', tags, learn, updated, body: blockOf(kept) };
        }),
      }));
    } else {
      body = blockOf(rest);
    }

    return {
      id: 's' + (si + 1) + (rs.title ? '-' + slugify(rs.title, '') : ''),
      title: rs.title, type, params, hasTypeLine, body, cells, groups, entries, faqs, fields,
    };
  });

  return { title: meta.title || '', meta, sections };
}

// serializeSite: Site model → raw Markdown. Round-trips parseSite (modulo whitespace normalization,
// the family standard). The claim flag is always present; source key order is preserved.
function serializeSite(site) {
  const meta = Object.assign({}, site.meta);
  if (!(FRONTMATTER_KEY in meta)) meta[FRONTMATTER_KEY] = 'true';
  if (site.title) meta.title = site.title;

  const out = ['---'];
  Object.keys(meta).forEach((k) => {
    const v = meta[k];
    // A multi-line value (nav / footer / announce, held as a "\n"-joined string) must serialize as a
    // YAML literal block scalar — `key: |` + each line re-indented by 2 — or splitFrontmatter reads
    // back only the first line and the structure drifts (round-trip fails, esp. a 3-deep nav). The
    // 2-space re-indent is exactly the common indent splitFrontmatter strips, so parse→serialize is
    // idempotent for any nesting depth.
    if (typeof v === 'string' && v.indexOf('\n') !== -1) {
      out.push(k + ': |');
      v.split('\n').forEach((ln) => out.push(ln === '' ? '' : '  ' + ln));
    } else {
      out.push(k + ': ' + v);
    }
  });
  out.push('---', '');

  (site.sections || []).forEach((s) => {
    out.push('## ' + (s.title || ''));
    if (s.hasTypeLine) out.push('%% sitetile: ' + s.type + (s.params ? ' ' + s.params : '') + ' %%');
    if (s.type === 'grid' || s.type === 'gallery' || s.type === 'carousel') {
      if (s.body) out.push(s.body);
      // 🩸 `c.icon` was parsed by splitCellHeading, RENDERED (astro GridCell.astro → lucideSvg) and
      // then not emitted here — so a cell's Lucide shortcode survived until the first save and the
      // icon disappeared off the built page. Icon before emoji, the order splitCellHeading reads them.
      (s.cells || []).forEach((c) => { out.push('### ' + (c.icon ? ':' + c.icon + ': ' : '') + (c.emoji ? c.emoji + ' ' : '') + (c.title || '') + (c.href ? ' →' + c.href : '') + (c.cta ? ' "' + c.cta + '"' : '') + (c.badge ? ' [' + c.badge + (c.badgeHref ? ' →' + c.badgeHref : '') + ']' : '')); if (c.body) out.push(c.body); });
    } else if (s.type === 'people') {
      if (s.body) out.push(s.body);
      // Round-trips the inferred depth: a roster parsed flat has exactly one untitled group, and
      // must serialize back to `###` people — not to a `###`-with-empty-title plus `####` people,
      // which would re-parse as GROUPED and silently change the document's shape on every save.
      const gs = s.groups || [];
      const flat = gs.length === 1 && !gs[0].title;
      gs.forEach((g) => {
        if (!flat) out.push('### ' + (g.title || ''));
        if (g.lead) out.push(g.lead);
        (g.people || []).forEach((p) => {
          out.push((flat ? '### ' : '#### ') + (p.title || '') + (p.href ? ' →' + p.href : '') +
            (p.badge ? ' [' + p.badge + (p.badgeHref ? ' →' + p.badgeHref : '') + ']' : ''));
          if (p.body) out.push(p.body);
          if (p.links && p.links.length) out.push('links: ' + p.links.map((l) => l.label + '=' + l.href).join(', '));
          if (p.tone) out.push('tone: ' + p.tone);
        });
      });
    } else if (s.type === 'collection') {
      if (s.body) out.push(s.body);
      (s.groups || []).forEach((g) => {
        out.push('### ' + (g.title || ''));
        // Between the `###` heading and the first `####` item — the exact position the parser reads
        // it from. Emitted after the items it would re-parse as the LAST item's body, which would
        // change the paragraph's owner on every save instead of deleting it. Mirrors the people arm.
        if (g.lead) out.push(g.lead);
        (g.items || []).forEach((it) => { out.push('#### ' + (it.title || '') + (it.href ? ' →' + it.href : '') + (it.badge ? ' "' + it.badge + '"' : '')); if (it.body) out.push(it.body); if (it.tags && it.tags.length) out.push('tags: ' + it.tags.join(', ')); if (it.learn) out.push('learn: ' + it.learn); if (it.updated) out.push('updated: ' + it.updated); });
      });
    } else if (s.type === 'faq') {
      if (s.body) out.push(s.body);
      (s.faqs || []).forEach((e) => { out.push('### ' + (e.q || '')); if (e.body) out.push(e.body); });
    } else if (s.type === 'form') {
      if (s.body) out.push(s.body);
      (s.fields || []).forEach((f) => {
        const marker = (f.kind && f.kind !== 'text' && f.kind !== 'select') ? ' {' + f.kind + '}' : '';
        out.push('### ' + (f.label || '') + marker);
        (f.options || []).forEach((o) => out.push('- ' + o));
      });
    } else if (s.type === 'timeline') {
      if (s.body) out.push(s.body);
      (s.entries || []).forEach((e) => { out.push('### ' + (e.year || '')); if (e.title) out.push('#### ' + e.title); if (e.body) out.push(e.body); });
    } else if (s.body) {
      out.push(s.body);
    }
    out.push('');
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

// isSiteFile: cheap "is this Markdown a sitetile page?" detector via the frontmatter claim flag, so a
// host can route a file (the way tugtile/pagetile claim theirs). Any non-empty value counts.
function isSiteFile(text) {
  const { meta } = splitFrontmatter(String(text || ''));
  return FRONTMATTER_KEY in meta && String(meta[FRONTMATTER_KEY]).trim() !== '';
}

// parseParams: raw param string → map. Bare `cols=3` → {cols:'3'}. Link form `cta="Label"→/href` →
// {cta:{label:'Label', href:'/href'}}. Plain quoted `x="Label"` → {x:'Label'}. Best-effort, for the
// renderer only — round-trip fidelity rides on the raw `params` string, never on this map.
function parseParams(raw) {
  const map = {};
  if (!raw) return map;
  const re = /(\w+)=("[^"]*"(?:→\S+)?|\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1]; const val = m[2];
    if (val.charAt(0) === '"') {
      const lm = /^"([^"]*)"(?:→(\S+))?$/.exec(val);
      if (lm) map[key] = lm[2] !== undefined ? { label: lm[1], href: lm[2] } : lm[1];
      else map[key] = val;
    } else map[key] = val;
  }
  // bare boolean flags (a word NOT used as a `key=…`): `ordered`, `wide`, … → true.
  // 🩸 Scan with the quoted values BLANKED OUT: a label such as `button="Go wide now"` used to read
  // `wide` (and `now`, `Go`) out of the quotes and set them as flags — a CTA's wording could switch a
  // layout on. The `key=` re-check below reads the same blanked string, so `wide="…"` still counts.
  const bare = raw.replace(/"[^"]*"(?:→\S+)?/g, (q) => ' '.repeat(q.length));
  let bm; const bre = /(?:^|\s)([a-zA-Z]\w*)(?=\s|$)/g;
  while ((bm = bre.exec(bare))) {
    const w = bm[1];
    if (!(w in map) && !new RegExp('\\b' + w + '\\s*=').test(bare)) map[w] = true;
  }
  return map;
}

// ── Reference HTML renderer (zero-dep, pure) ──────────────────────────────────────────────────
// TODO(feelreef seam): the production path wraps each section in an Astro component (per-type layout
// + design tokens + View Transitions). This function is the framework-free reference render — proves
// the model is complete and is the fallback/SSR-of-record. Inline markdown goes through cssmd.

function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

// Attribute-safe a value that cssmd ALREADY entity-escaped (&<> done) — only quotes remain.
function attrq(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

// A markdown image whose src is a VIDEO file (`![](…/clip.mp4)`) renders a real <video>, not a broken
// <img>. Markdown has no video literal, and sitetile refuses raw-HTML islands (bodyHtml escapes them),
// so this IS the platform's video primitive — the src extension is the signal. Needed by Wix/Blogger
// recasts whose showcase posts embed an in-body <video> (a portfolio post where the clip IS the content).
const RE_VIDEO_SRC = /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i;
// One <img> — zero-JS, lazy, responsive (sized by .st-img CSS + reef tokens). alt/src are already
// cssmd-escaped (&<> done) by the time we build this, so only quote-escape. A video src yields
// <video controls> instead (poster carried via the alt slot: `![poster-url](clip.mp4)` if present).
function imgTag(alt, src) {
  if (RE_VIDEO_SRC.test(String(src || ''))) {
    const hasPoster = alt && /^https?:\/\/|^\//.test(alt);
    const poster = hasPoster ? ' poster="' + attrq(alt) + '"' : '';
    // A video that HAS a poster needs nothing from the network until someone presses play: the
    // poster already carries the visual, and `metadata` only buys a duration this markup never
    // shows. Measured on a 198-video portfolio: `metadata` cost 202 extra requests and ~11s to
    // settle, for nothing a reader could see. Without a poster, `metadata` still earns its keep —
    // it is what gives the player a first frame instead of a black rectangle.
    const preload = hasPoster ? 'none' : 'metadata';
    return '<video class="st-video" src="' + attrq(src) + '"' + poster + ' controls playsinline preload="' + preload + '"></video>';
  }
  return '<img class="st-img" src="' + attrq(src) + '" alt="' + attrq(alt) + '" loading="lazy" decoding="async">';
}

// One inline-markdown fragment → HTML. Order is load-bearing: cssmd FIRST (escapes &<>, leaves
// brackets/parens/!/[[ ]]), then IMAGES (before links — `![a](b)` contains `[a](b)`), then links.
// `![alt](src)` and Obsidian `![[wikilink]]` embeds both become <img>. A `[![img](s)](href)` linked
// image works too (image resolves first, then the surrounding link).
function inlineHtml(text) {
  // 🔴 A link/image DESTINATION must not go through the emphasis pass. renderInlineMd runs first,
  // so a URL that happens to contain a matched pair of `_` — a twitter handle like /_Malachite_,
  // any snake_case path — is shredded into <span class="st-i"> before the link regex below ever
  // sees it, and the whole link then renders as literal `[X](https://…)` text on the page.
  // Stash destinations, run the inline pass on everything else, restore. (\u0001 cannot appear in
  // authored markdown and renderInlineMd leaves it alone, so it is a safe placeholder.)
  const hrefs = [];
  const stashed = String(text == null ? '' : text)
    .replace(/\]\(([^)\s]+)\)/g, (m, href) => { hrefs.push(href); return '](\u0001' + (hrefs.length - 1) + '\u0001)'; });
  let s = renderInlineMd(stashed, { prefix: 'st' });
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => hrefs[+i]);
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (mm, inner) => imgTag(inner.split('/').pop(), inner));     // wikilink embed
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (mm, alt, src) => imgTag(alt, src));               // markdown image
  // External inline links open in a new tab too (design 2026-07-13, extended from affordances to
  // prose at the maintainer's call): an external link is external wherever it appears.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (mm, lab, href) => {
    const tgt = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : '';
    return '<a href="' + attrq(href) + '"' + tgt + '>' + lab + '</a>';
  });
  // Allowlisted inline <small> (no attributes) — the one raw tag legacy IRs use for muted fine
  // print (e.g. an "updated on …" stamp). renderInlineMd escaped it to `&lt;small&gt;`; re-emit
  // the bare tag so it renders small instead of showing literally. XSS-safe: no attrs, no other tag.
  s = s.replace(/&lt;(\/?)small&gt;/g, '<$1small>');
  // Allowlisted <br> (no attributes, self-closing or not) — a heading/lead authored with a forced
  // line break (e.g. a hero title that's "Line one,<br>Line two,<br>Line three!" on live). Same
  // escape→re-emit trick as <small>. General: any inlineHtml call site (h1, eyebrow, prose spans)
  // gets real line breaks for free. XSS-safe: no attrs, no other tag.
  s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>');
  return s;
}

// True if a block is ONLY image(s) (markdown or wikilink) + whitespace — a block-level figure, not a
// text paragraph. Used to render standalone images (hero avatar, in-body figures) outside a <p>.
function isImageOnly(t) {
  const stripped = t.replace(/!\[\[([^\]]+)\]\]/g, '').replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '').trim();
  return t.trim() !== '' && stripped === '';
}

// Pull the FIRST image (markdown `![alt](src)` or wikilink `![[…]]`) out of a body block → the
// gallery cell's top figure. Returns { img:{alt,src}|null, rest } where `rest` is the body with that
// one image line removed. General (any image-first card). Used by the `gallery` coral.
function firstImage(body) {
  const text = String(body || '');
  let img = null;
  const md = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(text);
  const wk = /!\[\[([^\]]+)\]\]/.exec(text);
  let matchStr = null;
  if (md && (!wk || md.index <= wk.index)) { img = { alt: md[1], src: md[2] }; matchStr = md[0]; }
  else if (wk) { const inner = wk[1]; img = { alt: inner.split('/').pop(), src: inner }; matchStr = wk[0]; }
  if (!matchStr) return { img: null, rest: text };
  const rest = text.replace(matchStr, '').replace(/^\s*\n/, '').replace(/\n\s*\n\s*$/, '\n').trim();
  return { img, rest };
}

// Block-markdown regexes for the body pass (lists / blockquote / fenced code / GFM table).
const RE_FENCE_OPEN = /^(\s*)(```|~~~)(.*)$/;
const RE_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;   // [1]=indent (for nesting) [2]=marker [3]=text
const RE_LIST_ORDERED = /^\s*\d+[.)]\s+/;
const RE_QUOTE_LINE = /^\s*>\s?(.*)$/;
const RE_TABLE_ROW = /^\s*\|.*\|\s*$/;
// table separator: a LEADING `|` is required (so a bare `---` horizontal rule is NOT a separator);
// `*` allows a single-column table (`| --- |`) as well as multi-column.
const RE_TABLE_SEP = /^\s*\|\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// A GFM table row → trimmed cell strings (leading/trailing pipe stripped).
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
const isTableStart = (lines, i) => RE_TABLE_ROW.test(lines[i]) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]);
// A HEADERLESS table (2026-07-10): a run of `| a | b |` rows with NO `|---|` separator — the
// label/value definition-list shape real sites author (a JP corporate profile: 法人名|…, 資本金|…),
// which GFM's header-mandatory grammar can't express. Trigger is deliberately tight to stay clear of
// prose that merely contains `|`: the line must both START and END with a pipe AND have ≥2 cells (an
// internal pipe), a shape ordinary sentences never take. A header table (row + separator) is handled
// by the branch above and consumed first, so this only fires on genuinely headerless runs → renders
// an all-`<td>` `<table class="st-table" data-headless>`. Themes distinguish via the attribute.
const isHeadlessTableStart = (lines, i) =>
  RE_TABLE_ROW.test(lines[i]) && !RE_TABLE_SEP.test(lines[i]) && splitTableRow(lines[i]).length >= 2
  && !(i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]));
// One table CELL → HTML. Runs the inline pass (bold/italic/links/images) per fragment; additionally
// supports (a) `<br>` in-cell line breaks (the GFM-in-cell convention) and (b) a BULLETED LIST inside
// a cell — a `<br>`-joined run where EVERY segment leads with a list marker (`-`/`*`/`・`) becomes a
// real `<ul class="st-cell-list">` (a corporate profile's 事業内容 value is such a list). Non-list cells just
// inline each `<br>`-segment. XSS-safe: fragments go through inlineHtml (escapes &<>); the only raw
// tags emitted are our own <br>/<ul>/<li>.
const RE_CELL_BR = /<br\s*\/?>/i;
const RE_CELL_BULLET = /^\s*[-*・]\s+/;
function cellHtml(cell) {
  const parts = String(cell == null ? '' : cell).split(RE_CELL_BR);
  if (parts.length > 1 && parts.every((p) => RE_CELL_BULLET.test(p))) {
    return '<ul class="st-cell-list">' + parts.map((p) => '<li>' + inlineHtml(p.replace(RE_CELL_BULLET, '')) + '</li>').join('') + '</ul>';
  }
  return parts.map((p) => inlineHtml(p)).join('<br>');
}
const isBlockStart = (lines, i) =>
  RE_FENCE_OPEN.test(lines[i]) || RE_QUOTE_LINE.test(lines[i]) || RE_LIST_ITEM.test(lines[i])
  || isTableStart(lines, i) || isHeadlessTableStart(lines, i);

// Render a collected list block (items = [{indent, ordered, text}]) into nested <ul>/<ol>. A deeper
// indent than the current item nests as that item's children (recursive); the list/sublist tag comes
// from its first item's ordered flag.
function renderList(items) {
  if (!items.length) return '';
  const tag = items[0].ordered ? 'ol' : 'ul';
  let html = '<' + tag + ' class="st-list">';
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    let j = i + 1;
    while (j < items.length && items[j].indent > it.indent) j++;   // gather deeper-indented children
    html += '<li>' + inlineHtml(it.text) + renderList(items.slice(i + 1, j)) + '</li>';
    i = j;
  }
  return html + '</' + tag + '>';
}

// ── dialogue ────────────────────────────────────────────────────────────────────────────────
// A blockquote whose FIRST line is nothing but a bold name is a spoken turn, not a quotation:
//
//     > **CHOD**
//     > Everyone who types already knows an aligned keyboard is hard to type on.
//
// An optional `· suffix` after the name carries a date (`> **GOGO** · 2026-04-10`).
//
// Why a markdown convention and not a coral: posts (`ir/posts/*.md`) are plain markdown — the
// `%% sitetile: %%` grammar is for page bodies only — so a coral could not reach the one place
// this is for. This shape already renders sanely everywhere else (GitHub, Obsidian, an exported
// .md): a quote block with a bold name above it. Nothing breaks where the renderer is absent,
// which is the whole point of keeping the substrate portable.
//
// The trigger is deliberately narrow — the line must be ONLY the bold span, the name is capped,
// and a name with nothing under it is not a turn — because an ordinary quotation that happens to
// open with a bold word must keep rendering as a quotation.
const RE_TURN_HEAD = /^\*\*([^*\n]{1,24}?)\*\*(?:\s*[·:]\s*(.+?))?\s*$/;

// Quote lines → paragraphs (a blank `>` line separates them; soft newlines fold to spaces).
const quoteParas = (buf) =>
  buf.join('\n').split(/\n\s*\n/).map((p) => p.trim().replace(/\n/g, ' ')).filter(Boolean);

function dialogueTurn(buf) {
  const m = RE_TURN_HEAD.exec((buf[0] || '').trim());
  if (!m) return null;
  const body = buf.slice(1);
  if (!body.some((l) => l.trim())) return null;      // a name with no speech under it is not a turn
  return { name: m[1].trim(), meta: (m[2] || '').trim(), body };
}

// A run of consecutive turns → one `<div class="st-dialogue">`. The first speaker to appear sits
// on the left and everyone else on the right, so a two-party exchange reads as two sides without
// the author having to say which is which. A speaker's initial stands in for an avatar: agents do
// not have faces, and drawing one would be a costume.
function renderDialogue(turns) {
  const order = [];
  const body = turns.map((t, idx) => {
    if (!order.includes(t.name)) order.push(t.name);
    const side = order.indexOf(t.name) === 0 ? 'left' : 'right';
    const cont = idx > 0 && turns[idx - 1].name === t.name;   // same speaker again → drop the label
    return '<div class="st-turn" data-side="' + side + '"' + (cont ? ' data-cont="1"' : '') + '>'
      + '<div class="st-turn-who" aria-hidden="true">' + escHtml(t.name.slice(0, 1).toUpperCase()) + '</div>'
      // The speaker label sits OUTSIDE the bubble, above it — a chat app puts the name over the
      // message, not inside the box with the words. Laid out by grid (see site.css) so the bubble
      // is pushed down by the label's own height rather than by a magic offset.
      + '<p class="st-turn-name">' + inlineHtml(t.name)
      + (t.meta ? '<span class="st-turn-meta">' + inlineHtml(t.meta) + '</span>' : '') + '</p>'
      + '<div class="st-bubble">'
      + quoteParas(t.body).map((p) => '<p>' + inlineHtml(p) + '</p>').join('')
      + '</div></div>';
  }).join('');
  return '<div class="st-dialogue">' + body + '</div>';
}

// A raw markdown body → HTML. A line-walking block parser: fenced code (verbatim, the `#`/`>`/`|`/`-`
// inside it are NOT parsed as blocks), blockquote, lists (ul/ol), GFM tables, plus paragraphs and
// pure-image figures. Inline marks + inline images via inlineHtml. Zero JS; reef-token styled (st-*).
// 🔴 RENDER-only: parse/serialize store the body verbatim, so the round-trip invariant is untouched.
function bodyHtml(body) {
  if (!body) return '';
  const lines = String(body).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }                                  // blank → block boundary

    const f = RE_FENCE_OPEN.exec(lines[i]);                                    // fenced code (verbatim)
    if (f) {
      const marker = f[2], lang = f[3].trim(), buf = [];
      const close = new RegExp('^\\s*' + marker);
      i++;
      while (i < lines.length && !close.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;                                                                     // skip closing fence
      // The info string may carry more than a language (` ```js title="a.js" `), so the class takes
      // its FIRST token — the whole string used to land in the attribute, which for a multi-token
      // fence produced a class nobody could select on.
      const langName = lang.split(/\s+/)[0];
      // Highlighted only when the language is one highlight.js actually knows; otherwise the body is
      // escaped text exactly as before. An unlabelled fence is the common case on a devlog — terminal
      // output, checksums, boot logs — and painting those would be inventing structure that is not there.
      const codeHtml = knowsLanguage(langName)
        ? highlightCode(buf.join('\n'), langName, { prefix: 'st' })
        : escHtml(buf.join('\n'));
      out.push('<pre class="st-code"><code' + (langName ? ' class="language-' + escAttr(langName) + '"' : '') + '>' + codeHtml + '</code></pre>');
      continue;
    }

    if (RE_QUOTE_LINE.test(lines[i])) {                                        // blockquote / dialogue
      // Collect the whole RUN of quote blocks (blank-line separated) in one go, because a dialogue
      // is a sequence of them and has to be grouped. Blocks that are not turns are emitted as the
      // same `<blockquote class="st-quote">` as before, one per block — byte-identical output for
      // every body that contains no dialogue.
      const blocks = [];
      while (i < lines.length) {
        if (!RE_QUOTE_LINE.test(lines[i])) {
          if (!lines[i].trim() && i + 1 < lines.length && RE_QUOTE_LINE.test(lines[i + 1])) { i++; continue; }
          break;
        }
        const buf = [];
        while (i < lines.length && RE_QUOTE_LINE.test(lines[i])) { buf.push(RE_QUOTE_LINE.exec(lines[i])[1]); i++; }
        blocks.push(buf);
      }
      let run = [];
      const flushRun = () => { if (run.length) { out.push(renderDialogue(run)); run = []; } };
      for (const buf of blocks) {
        const turn = dialogueTurn(buf);
        if (turn) { run.push(turn); continue; }
        flushRun();
        // a blank quote line (`>` with no text) separates paragraphs inside the quote.
        const paras = quoteParas(buf);
        out.push('<blockquote class="st-quote">' + paras.map((p) => '<p>' + inlineHtml(p) + '</p>').join('') + '</blockquote>');
      }
      flushRun();
      continue;
    }

    if (RE_LIST_ITEM.test(lines[i])) {                                         // list (ul/ol, nestable)
      const items = [];
      while (i < lines.length && RE_LIST_ITEM.test(lines[i])) {
        const m = RE_LIST_ITEM.exec(lines[i]);
        items.push({ indent: m[1].length, ordered: /^\d+[.)]/.test(m[2]), text: m[3] });
        i++;
      }
      out.push(renderList(items));
      continue;
    }

    if (isTableStart(lines, i)) {                                             // GFM table (headered)
      const header = splitTableRow(lines[i]); i += 2;                          // header + separator
      const rows = [];
      while (i < lines.length && RE_TABLE_ROW.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      const thead = '<thead><tr>' + header.map((c) => '<th>' + cellHtml(c) + '</th>').join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + cellHtml(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
      out.push('<table class="st-table">' + thead + tbody + '</table>');
      continue;
    }

    if (isHeadlessTableStart(lines, i)) {                                     // headerless def-list table
      const rows = [];
      while (i < lines.length && RE_TABLE_ROW.test(lines[i]) && !RE_TABLE_SEP.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      const tbody = '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + cellHtml(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
      out.push('<table class="st-table" data-headless>' + tbody + '</table>');
      continue;
    }

    const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(lines[i]);                        // ATX heading (### Section)
    if (h) { const lv = Math.min(h[1].length, 6); out.push('<h' + lv + '>' + inlineHtml(h[2]) + '</h' + lv + '>'); i++; continue; }

    const para = [];                                                          // paragraph / figure
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) { para.push(lines[i]); i++; }
    // a line ending in "  " (two trailing spaces, standard markdown hard-break convention) forces
    // a <br> at that point instead of the default soft-wrap-to-space join. General — opt-in per
    // line, so ordinary multi-line source paragraphs (the vast majority) are unaffected. First
    // needed for a Wix-sourced rich-text hero whose copy hard-breaks mid-sentence. Uses a private
    // placeholder (not literal `<br>`) because inlineHtml escapes the whole string before marking
    // bold/italic — a literal tag here would render as visible text, not a real line break.
    const BR = 'ST-BR-TOKEN';
    // 🩸 Soft-wrapped lines were joined with a plain space, which is wrong twice over for CJK copy.
    // (a) CJK has no inter-word space, so `…制作は、\nあなたの…` came out as `…制作は、 あなたの…`
    //     — a visible gap after the comma that no Japanese typesetter would put there.
    // (b) A line starting with `・` is a BULLET in Japanese/Chinese prose, and the author means one
    //     per line. Joining them produced `<p>・A ・B ・C ・D</p>` — a run-on where the source (and
    //     the site being recast) shows a list. sodaart alone has 530 such lines; rewriting them by
    //     hand is not the fix, joining them correctly is.
    // Latin↔CJK boundaries KEEP the space: that is a real word gap, and removing it would glue
    // `SODAART` onto the kana beside it.
    const CJK = /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
    const marked = para.map((ln, idx) => (idx < para.length - 1 && /  $/.test(ln) ? ln.replace(/\s+$/, '') + BR : ln));
    let joined = marked.length ? marked[0] : '';
    for (let k = 1; k < marked.length; k++) {
      const next = marked[k];
      const gap = joined.endsWith(BR) ? ''
        : /^[・※]/.test(next.trim()) ? BR
        : (CJK.test(joined.slice(-1)) && CJK.test(next.trim().slice(0, 1))) ? ''
        : ' ';
      joined += gap + next;
    }
    const t = joined.split(BR + ' ').join(BR).trim();
    const html = inlineHtml(t).split(BR).join('<br>');
    out.push(isImageOnly(t) ? '<figure class="st-figure">' + html + '</figure>' : '<p>' + html + '</p>');
  }
  return out.join('\n');
}

// A `cta`/`button` param value → an anchor, or '' if absent. Accepts {label,href} or a bare string.
function ctaHtml(val, cls) {
  if (!val) return '';
  // The single filled hero CTA carries no arrow by design (it's the headline action, not a link
  // in a row); it still follows the shared new-tab rule for external destinations (2026-07-13).
  if (typeof val === 'object') return '<a class="' + cls + '" href="' + escAttr(val.href || '#') + '"' + targetAttrs(linkKind(val.href, val.label)) + '>' + escHtml(val.label || '') + '</a>';
  return '<span class="' + cls + '">' + escHtml(val) + '</span>';
}

// cta body → { buttons:[{label,href}], caption }. A paragraph that is ONLY markdown
// links (separated by `·`/whitespace) becomes BUTTONS (a cta can have N buttons, e.g.
// donate's Give once + Monthly); everything else stays caption prose.
const RE_CTA_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
function splitCtaBody(body) {
  const buttons = [], caption = [];
  String(body || '').split(/\n\s*\n/).forEach((para) => {
    const p = para.trim(); if (!p) return;
    const onlyLinks = p.match(RE_CTA_LINK) && p.replace(RE_CTA_LINK, '').replace(/[·,\s]+/g, '') === '';
    if (onlyLinks) { let m; RE_CTA_LINK.lastIndex = 0; while ((m = RE_CTA_LINK.exec(p))) buttons.push({ label: m[1].trim(), href: m[2].trim() }); }
    else caption.push(p);
  });
  return { buttons, caption: caption.join('\n\n') };
}

// Render a cta's full button row: primary (from the `button=` param, filled) + any body
// link-buttons (secondary, outline). Every button's affordance is the signet-arrow picked by
// linkKind — see ctaButtonsHtml. (Decorative Lucide glyphs like heart/envelope were removed as
// button icons on 2026-07-13: a mark inside a button contradicts its arrow. If a site wants a
// heart/envelope it belongs OUTSIDE the button.)
function ctaButtonsHtml(pmButton, body, pmIcon) {
  const { buttons, caption } = splitCtaBody(body);
  const primary = pmButton ? [typeof pmButton === 'object' ? pmButton : { label: String(pmButton), href: '#' }] : [];
  const all = primary.concat(buttons);
  // Affordance = a signet-arrow chosen by link kind — see linkKind (design 2026-07-13). The old
  // icon=heart / mailto→envelope glyph rules are gone: decorative marks never sit inside a button.
  // `pmIcon` is intentionally ignored now (kept in the signature for Cta.astro call-site compat).
  const row = all.length ? '<div class="st-cta-btns">' + all.map((b, idx) => {
    const kind = linkKind(b.href, b.label);
    return '<a class="st-cta-btn ' + (idx === 0 ? 'st-cta-btn-primary' : 'st-cta-btn-secondary') + '" href="' + escAttr(b.href || '#') + '"' + targetAttrs(kind) + '>' +
      escHtml(b.label) + '<span class="st-cta-arrow" aria-hidden="true">' + affordanceArrow(kind, 16) + '</span></a>';
  }).join('') + '</div>' : '';
  return { row, caption };
}

// cta caption position. Default: caption renders AFTER the buttons (the "buttons-first belt"). A
// `caption=before` param flips to caption→buttons — the same reading order `social` uses — so a
// marketing card can LEAD with its blurb without dropping to an `embed` hand-roll (dogfood #68: the
// coral couldn't express caption-first, which pushed agents off the born-valid path). This reorders
// the real DOM, so the reading order is correct for screen readers too — not a CSS `order` illusion.
//
// 🩸 2026-08-28. This took the whole `pm` bag and reached inside for `pm.caption`. It works, and it
// is invisible: the table of "which params each coral reads" is DERIVED by scanning a section
// component for `pm.<name>`, so a param read inside a helper that was handed the bag appears in no
// component and the write-time checker reported `caption= … read by nothing` on a param that
// reorders the DOM. A checker that is wrong is worse than no checker — an author who trusts it
// deletes working markup. So the READ happens at the call site, in the component, where the thing
// deriving the table can see it; the helper takes the VALUE. Guarded by coral-params.test.mjs.
function ctaCaptionFirst(caption) {
  const v = caption && typeof caption === 'object' ? caption.label : caption;
  return v === 'before';
}

// heroParts: a hero body → { text, buttons:[{label,href,primary}], image:{alt,src}|null }. Lets a hero
// carry (in plain Markdown, in any order): lead prose paragraphs, ONE links-only paragraph that becomes
// the CTA button row (first link = primary/filled, rest = secondary/outline), and ONE standalone image
// that becomes the side art (for a `layout=split` two-column hero). General — any landing hero.
function heroParts(body) {
  const text = [], buttons = [], images = [];
  String(body || '').split(/\n\s*\n/).forEach((para) => {
    const p = para.trim(); if (!p) return;
    if (isImageOnly(p)) {
      // 🩸 fixed 2026-07-05: was a single `.exec` (no /g), so a paragraph with several images
      // written back-to-back on one line (e.g. a row of team avatars) only ever kept the
      // FIRST — the other 3 silently vanished. Loop both the markdown and wikilink forms.
      const reMd = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
      let m;
      while ((m = reMd.exec(p))) images.push({ alt: m[1], src: m[2] });
      const reWiki = /!\[\[([^\]]+)\]\]/g;
      while ((m = reWiki.exec(p))) images.push({ alt: (m[1] || '').split('/').pop(), src: m[1] });
      return;
    }
    const onlyLinks = p.match(RE_CTA_LINK) && p.replace(RE_CTA_LINK, '').replace(/[·,\s]+/g, '') === '';
    // 🩸 general (2026-07-05, round 2): a lone "Back to X" link is return-to-listing navigation,
    // not a CTA — rendering it as a filled/outlined button adds real height nothing on live has.
    // Originally pulled it into `text` instead of `buttons`, but `text`/`buttons` render as two
    // separate groups (all text first, then all buttons) regardless of source order — when a
    // real button paragraph (e.g. "Interactive Demo") comes BEFORE the back-link in the markdown,
    // pulling the back-link into `text` reversed their visual order vs live (found on a live
    // /oss/liquidframe|demodeck|motifmint — DOM order was literally swapped). Keep it IN
    // `buttons` (preserves source order) but flag `plain:true` so the renderer draws it as a
    // plain link instead of button chrome.
    const singleBackLink = onlyLinks && /^\[Back to /i.test(p) && (p.match(RE_CTA_LINK) || []).length === 1;
    if (onlyLinks) {
      let m; RE_CTA_LINK.lastIndex = 0;
      while ((m = RE_CTA_LINK.exec(p))) buttons.push({ label: m[1].trim(), href: m[2].trim(), primary: buttons.length === 0 && !singleBackLink, plain: singleBackLink });
    } else text.push(p);
  });
  // `image` = first (backward-compatible single-image heroes); `images` = ALL (multi-image side, e.g.
  // an ABOUT band with a cluster of character illustrations). Renderers that want the cluster read images.
  return { text: text.join('\n\n'), buttons, image: images[0] || null, images };
}

// socialParts: a `social` body → { caption, links:[{label,href,primary}] }. A "follow/social" band:
// caption prose + a row of social links (first = primary/filled, rest = outline). General — any
// follow / contact-links / "find us on" band. The button ROW renders AFTER the caption (heading →
// blurb → buttons), unlike `cta` (buttons-first belt).
function socialParts(body) {
  const { buttons, caption } = splitCtaBody(body);
  return { caption, links: buttons.map((b, i) => ({ ...b, primary: i === 0 })) };
}

// One row of hero/social buttons → HTML (first = primary filled, rest = secondary outline).
function linkButtonsHtml(buttons, cls) {
  if (!buttons.length) return '';
  // Every button carries a signet-arrow chosen by link kind — see linkKind (design 2026-07-13):
  // external → up-right + target=_blank, mailto/internal → right, all in the same tab family as
  // their destination. github.com links additionally keep the octocat mark before the label.
  const isGithub = (href) => !!href && /^https?:\/\/(www\.)?github\.com\//i.test(href);
  // `plain:true` entries (e.g. a trailing "Back to X" nav link) render as a bare text link in
  // their natural source position, not button chrome — see heroParts' `singleBackLink` comment.
  return '<div class="' + cls + '-btns">' + buttons.map((b) => {
    if (b.plain) return '<a class="' + cls + '-plain" href="' + escAttr(b.href || '#') + '">' + arrowSvg('left', 14) + escHtml(b.label) + '</a>';
    const kind = linkKind(b.href, b.label);
    return '<a class="' + cls + '-btn ' + cls + '-btn-' + (b.primary ? 'primary' : 'secondary') + '" href="' + escAttr(b.href || '#') + '"' + targetAttrs(kind) + '>' +
      (isGithub(b.href) ? githubSvg(16) : '') + escHtml(b.label) + affordanceArrow(kind, 16) + '</a>';
  }).join('') + '</div>';
}

// The signet directional arrow markup (mirrors @cvernet/signet Arrow.astro; arrow.css does the
// tail-retract hover morph). Used by the JS reference renderer so the editor live-preview matches the
// Astro build's labeled CTAs.
function arrowSvg(direction, size) {
  const px = size || 18;
  const dir = direction === 'up-right' ? ' signet-arrow--up-right' : direction === 'left' ? ' signet-arrow--left' : '';
  return '<span class="signet-arrow' + dir + '" style="width:' + px + 'px;height:' + px + 'px;--signet-arrow-w:' + px + 'px" aria-hidden="true">' +
    '<span class="signet-arrow__tail"></span>' +
    '<svg class="signet-arrow__head" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 6 16 12 10 18"/></svg></span>';
}

// A button's affordance is a signet-arrow chosen by where the link goes (design 2026-07-13).
// One rule for every button surface (cta / hero-social / grid-cell) so the glyph never
// contradicts the destination:
//   back ("Back to …")    → left arrow, same tab
//   external (http[s]://) → up-right arrow + target=_blank rel=noopener (leaves the site)
//   mailto:               → right arrow, same tab (an action link, not a new window)
//   internal (/… or #…)   → right arrow, same tab
// Decorative marks (heart/envelope) are NEVER the affordance; if a site wants one it lives
// OUTSIDE the button. This supersedes the old icon=/mailto→envelope glyph rules.
function linkKind(href, label) {
  const h = String(href || '');
  if (/^back to /i.test(String(label || '').trim())) return 'back';
  if (/^mailto:/i.test(h)) return 'mailto';
  if (h && !h.startsWith('/') && !h.startsWith('#')) return 'external';
  return 'internal';
}
function affordanceArrow(kind, size) {
  return arrowSvg(kind === 'back' ? 'left' : kind === 'external' ? 'up-right' : 'right', size);
}
function targetAttrs(kind) {
  return kind === 'external' ? ' target="_blank" rel="noopener"' : '';
}

// GitHub octocat mark — general (2026-07-05), any CTA button linking to github.com carries this,
// mirroring a real "View on GitHub" hero button. Standard octicon path.
function githubSvg(size) {
  const px = size || 16;
  return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
}

// `prose ordered` (legal/policy) → live's numbered ordered-list shape: split the body into a lead
// intro + one clause per `### <heading>`, each rendered as a gutter number + an <h2> clause title +
// prose. Mirrors a live legal page. The number is REAL DOM text (not a CSS counter) so it stays
// visible with JS off and reads correctly to assistive tech. Used only by `prose ordered` sections.
function orderedProseHtml(body) {
  const lines = String(body || '').split('\n');
  const lead = [];
  const items = [];
  let cur = null;
  for (const ln of lines) {
    const m = RE_H3.exec(ln);
    if (m) { cur = { title: m[1].trim(), lines: [] }; items.push(cur); continue; }
    (cur ? cur.lines : lead).push(ln);
  }
  const leadHtml = bodyHtml(lead.join('\n'));
  const lis = items.map((it, i) =>
    '<li class="st-ord-item"><span class="st-ord-num" aria-hidden="true">' + (i + 1) + '.</span>' +
    '<div class="st-ord-body"><h2>' + inlineHtml(it.title) + '</h2>' + bodyHtml(it.lines.join('\n')) + '</div></li>'
  ).join('');
  return leadHtml + (lis ? '<ol class="st-ordered">' + lis + '</ol>' : '');
}

function renderSection(s) {
  const pm = parseParams(s.params);
  const type = KNOWN_TYPES.indexOf(s.type) >= 0 ? s.type : 'prose';
  switch (type) {
    case 'hero': {
      const style = pm.bg ? ' style="background-image:url(' + escAttr(pm.bg) + ')"' : '';
      // media variant for a foreground image: avatar (round, default) vs logo (uncropped, not round).
      const media = pm.media === 'logo' ? 'logo' : 'avatar';
      // LEGACY (default) hero — unchanged: h1 + body + single `cta=` param. Live sites rely on this exact
      // DOM (the logo image stays a `.st-figure` via bodyHtml). New columned hero is OPT-IN via `layout`.
      if (!pm.layout) {
        return '<section class="st-hero" data-media="' + media + '"' + style + '><h1>' + inlineHtml(s.title) + '</h1>' +
          bodyHtml(s.body) + ctaHtml(pm.cta, 'st-hero-cta') + '</section>';
      }
      const layout = ' data-layout="' + escAttr(typeof pm.layout === 'object' ? pm.layout.label : pm.layout) + '"';
      const hp = heroParts(s.body);
      const eyebrow = pm.eyebrow ? '<p class="st-hero-eyebrow">' + inlineHtml(typeof pm.eyebrow === 'object' ? pm.eyebrow.label : pm.eyebrow) + '</p>' : '';
      // text column: eyebrow + h1 + lead prose + button row (or the legacy single `cta=` param).
      const txt = '<div class="st-hero-text">' + eyebrow + '<h1>' + inlineHtml(s.title) + '</h1>' +
        bodyHtml(hp.text) + (hp.buttons.length ? linkButtonsHtml(hp.buttons, 'st-hero') : ctaHtml(pm.cta, 'st-hero-cta')) + '</div>';
      const art = hp.images.length ? '<div class="st-hero-art"' + (hp.images.length > 1 ? ' data-imgs="' + hp.images.length + '"' : '') + '>' +
        hp.images.map((im) => imgTag(im.alt, im.src)).join('') + '</div>' : '';
      // `marquee="A|B|C"` — animated background word-marquee (one scrolling row per pipe-word);
      // mirrors Hero.astro. Faint decorative band behind the hero content, alternating direction.
      const marqueeRaw = pm.marquee ? (typeof pm.marquee === 'object' ? pm.marquee.label : pm.marquee) : null;
      const mWords = marqueeRaw ? String(marqueeRaw).split('|').map((w) => w.trim()).filter(Boolean) : [];
      const marquee = mWords.length ? '<div class="st-hero-marquee" aria-hidden="true">' + mWords.map((w, i) =>
        '<div class="st-hero-marquee-row" data-dir="' + (i % 2 ? 'rev' : 'fwd') + '"><div class="st-hero-marquee-track">' +
        new Array(12).fill('<span>' + escHtml(w) + '</span>').join('') + '</div></div>').join('') + '</div>' : '';
      return '<section class="st-hero" data-media="' + media + '"' + layout + style + '>' + marquee + txt + art + '</section>';
    }
    case 'grid': {
      // `cards=image` — cells become image-first cards (leading image floats to a top figure,
      // title + caption below), reusing gallery's exact cell markup/CSS (.st-gal-cell/.st-gal-fig)
      // inside the grid's own column layout. General — character/team cards, blog post cards.
      const imageCards = pm.cards === 'image' || (pm.cards && typeof pm.cards === 'object' && pm.cards.label === 'image');
      // `pack=masonry` — opt-in fixed-split column packing. Measured against a real live
      // JS-labeled "masonry" grid (a live WP blog, 2026-07, via playwright rects scoped to the
      // actual grid container — a naive raw-HTML string search is fooled by the post IDs
      // recurring in an unrelated sidebar widget earlier in the DOM): it's server-rendered as two
      // static `<div>` columns, DOM-first-half → col 1, DOM-second-half → col 2 (ceil(n/cols) per
      // column) — NOT true shortest-column masonry, NOT round-robin/alternating, and NOT CSS
      // multicol's default `column-fill:balance` (which computes its own split point from
      // estimated content height and silently moves items across the column boundary as card
      // heights vary — the exact drift this mode exists to kill). Reproducing the fixed n/cols
      // chunk split at render time (deterministic, no client JS, no column-fill heuristic)
      // matches live's split exactly and is stable regardless of card height variance.
      const packMasonry = pm.pack === 'masonry' || (pm.pack && typeof pm.pack === 'object' && pm.pack.label === 'masonry');
      const packCols = Math.max(2, parseInt(pm.cols, 10) || 2);
      const cellsArr = (s.cells || []);
      const cells = cellsArr.map((c) => {
        if (imageCards) {
          const fi = firstImage(c.body);
          const fig = fi.img ? '<figure class="st-gal-fig">' + imgTag(fi.img.alt, fi.img.src) + '</figure>' : '';
          const badge = c.badge ? '<span class="st-cell-badge" data-badge="' + escAttr(c.badge.toLowerCase()) + '">' + inlineHtml(c.badge) + '</span>' : '';
          const inner = fig + badge + '<h3>' + inlineHtml(c.title) + '</h3>' + bodyHtml(fi.rest);
          return c.href
            ? '<a class="st-cell st-gal-cell st-cell-link group" href="' + escAttr(c.href) + '">' + inner + '</a>'
            : '<div class="st-cell st-gal-cell">' + inner + '</div>';
        }
        // optional status badge (`[Soon]`) — a pill the theme colours by data-badge; optional leading
        // emoji glyph. Both absent on plain cells, so a plain grid is untouched.
        const badge = c.badge ? '<span class="st-cell-badge" data-badge="' + escAttr(c.badge.toLowerCase()) + '">' + inlineHtml(c.badge) + '</span>' : '';
        const emoji = c.emoji ? '<span class="st-cell-emoji" aria-hidden="true">' + inlineHtml(c.emoji) + '</span>' : '';
        // A cell carrying BOTH a badge AND a labeled CTA pairs them in a footer row (badge = a
        // left action-tag, CTA = the right affordance — e.g. an "OPEN ON DISCORD" tag +
        // "Learn more"). A badge alone stays a top status pill ([Soon]); a CTA alone stays as-is.
        const footTag = c.badge && c.cta;
        // `[Label →href]` badge = a SECONDARY card link (its own action). It can't nest inside the
        // whole-cell <a>, so such a cell uses the OVERLAY pattern: a relative container, an absolute
        // full-cell overlay <a> (the primary link), and the action + "Learn more" stacked above it.
        const hasAction = !!(c.href && c.badgeHref);
        const inner = ((footTag || hasAction) ? '' : badge) + emoji + '<h3>' + inlineHtml(c.title) + '</h3>' + bodyHtml(c.body);
        // labeled CTA ("<cta>" on the heading) renders the directional arrow; bare href → a chevron.
        // Cells that carry an emoji/badge (status cards) get NO chevron — the badge is the affordance.
        const cta = c.cta
          ? '<span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + inlineHtml(c.cta) + '</span>' + arrowSvg(/^https?:\/\//.test(c.href) ? 'up-right' : 'right') + '</span>'
          : (c.badge || c.emoji) ? '' : '<span class="st-cell-cta" aria-hidden="true">›</span>';
        if (hasAction) {
          const action = '<a class="st-cell-action" href="' + escAttr(c.badgeHref) + '"' + (/^https?:\/\//.test(c.badgeHref) ? ' target="_blank" rel="noopener"' : '') + '>'
            + '<span class="st-cta-label">' + inlineHtml(c.badge) + '</span>' + arrowSvg(/^https?:\/\//.test(c.badgeHref) ? 'up-right' : 'right') + '</a>';
          return '<div class="st-cell st-cell-link st-cell-overlaid group">'
            + '<a class="st-cell-overlay" href="' + escAttr(c.href) + '"' + (/^https?:\/\//.test(c.href) ? ' target="_blank" rel="noopener"' : '') + ' aria-label="' + escAttr(c.title) + '"></a>'
            + inner + '<div class="st-cell-foot">' + action + cta + '</div></div>';
        }
        const tail = footTag ? '<div class="st-cell-foot">' + badge + cta + '</div>' : cta;
        // a cell with a href is a whole-cell link; the `group` class drives the arrow's hover morph.
        return c.href
          ? '<a class="st-cell st-cell-link group" href="' + escAttr(c.href) + '"' + (/^https?:\/\//.test(c.href) ? ' target="_blank" rel="noopener"' : '') + '>' + inner + tail + '</a>'
          : '<div class="st-cell">' + inner + tail + '</div>';
      });
      let cellsHtml;
      let cellsAttr = '';
      if (packMasonry) {
        const chunk = Math.ceil(cells.length / packCols);
        const cols = Array.from({ length: packCols }, (_, j) => cells.slice(j * chunk, (j + 1) * chunk));
        cellsHtml = cols.map((col) => '<div class="st-col">' + col.join('') + '</div>').join('');
        cellsAttr = ' data-pack="masonry"';
      } else {
        cellsHtml = cells.join('');
      }
      // `surface=<token>` — opt-in per-section background belt (see Grid.astro). Round-trips via
      // the raw params; here it just emits `data-surface` for the theme to paint.
      const surface = pm.surface ? ' data-surface="' + escAttr(typeof pm.surface === 'object' ? pm.surface.label : pm.surface) + '"' : '';
      return '<section class="st-grid" data-cols="' + escAttr(pm.cols || '') + '"' + (imageCards ? ' data-cards="image"' : '') + surface + '><h2>' + inlineHtml(s.title) + '</h2>' +
        bodyHtml(s.body) + '<div class="st-cells"' + cellsAttr + '>' + cellsHtml + '</div></section>';
    }
    case 'gallery': {
      // Image-first cards: the leading image in each cell body floats to a top figure; title +
      // caption below. Whole card is a link when the cell has an href. Cols via `cols=` like grid.
      const cells = (s.cells || []).map((c) => {
        const fi = firstImage(c.body);
        const fig = fi.img ? '<figure class="st-gal-fig">' + imgTag(fi.img.alt, fi.img.src) + '</figure>' : '';
        const badge = c.badge ? '<span class="st-cell-badge" data-badge="' + escAttr(c.badge.toLowerCase()) + '">' + inlineHtml(c.badge) + '</span>' : '';
        const cta = c.cta ? '<span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + inlineHtml(c.cta) + '</span></span>' : '';
        const inner = fig + '<h3>' + inlineHtml(c.title) + '</h3>' + bodyHtml(fi.rest) + cta;
        return c.href
          ? '<a class="st-gal-cell st-cell-link group" href="' + escAttr(c.href) + '">' + badge + inner + '</a>'
          : '<div class="st-gal-cell">' + badge + inner + '</div>';
      }).join('');
      return '<section class="st-gallery" data-cols="' + escAttr(pm.cols || '') + '">' +
        (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') + bodyHtml(s.body) +
        '<div class="st-gal-cells">' + cells + '</div></section>';
    }
    case 'carousel': {
      // Single-row sibling of gallery: same image-first cards, but laid in a horizontal scroll
      // track with prev/next arrows (slidesToShow via `cols=`). For casts/archives too long for a
      // static grid. The JS runtime (carousel.js) wires the arrows; CSS-only it degrades to a
      // scrollable track. Theme paints `.st-carousel` / `.st-car-track` / `.st-car-cell`.
      const cells = (s.cells || []).map((c) => {
        const fi = firstImage(c.body);
        const fig = fi.img ? '<figure class="st-gal-fig">' + imgTag(fi.img.alt, fi.img.src) + '</figure>' : '';
        const badge = c.badge ? '<span class="st-cell-badge" data-badge="' + escAttr(c.badge.toLowerCase()) + '">' + inlineHtml(c.badge) + '</span>' : '';
        const cta = c.cta ? '<span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + inlineHtml(c.cta) + '</span></span>' : '';
        const inner = fig + '<h3>' + inlineHtml(c.title) + '</h3>' + bodyHtml(fi.rest) + cta;
        return c.href
          ? '<a class="st-car-cell st-gal-cell st-cell-link group" href="' + escAttr(c.href) + '">' + badge + inner + '</a>'
          : '<div class="st-car-cell st-gal-cell">' + badge + inner + '</div>';
      }).join('');
      // `more="LABEL=/href"` — optional "view all" link top-right of the heading row (mirrors Carousel.astro).
      const moreRaw = pm.more ? (typeof pm.more === 'object' ? pm.more.label : pm.more) : null;
      const more = moreRaw && String(moreRaw).includes('=')
        ? { label: String(moreRaw).split('=')[0].trim(), href: String(moreRaw).split('=').slice(1).join('=').trim() }
        : null;
      const head = (s.title || more)
        ? '<div class="st-car-head">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') +
          (more ? '<a class="st-car-more" href="' + escAttr(more.href) + '">' + inlineHtml(more.label) + '</a>' : '') + '</div>'
        : '';
      return '<section class="st-carousel" data-cols="' + escAttr(pm.cols || '') + '">' +
        head + bodyHtml(s.body) +
        '<div class="st-car-viewport">' +
        '<button class="st-car-nav st-car-prev" type="button" aria-label="Previous"><span class="st-sr-only">Previous</span>' + arrowSvg('left') + '</button>' +
        // `start=N` — opt-in initial resting card index (0-based), mirrors Carousel.astro's
        // `data-start`; the shared runtime script reads it to scroll the track on load.
        '<div class="st-car-track" data-start="' + escAttr(pm.start || '') + '">' + cells + '</div>' +
        '<button class="st-car-nav st-car-next" type="button" aria-label="Next"><span class="st-sr-only">Next</span>' + arrowSvg() + '</button>' +
        '</div></section>';
    }
    case 'cta': {
      const cb = ctaButtonsHtml(pm.button, s.body);
      const cap = cb.caption ? bodyHtml(cb.caption) : '';
      // `caption=before` → caption leads (see ctaCaptionFirst); default keeps the buttons-first belt.
      const inner = ctaCaptionFirst(pm.caption) ? cap + cb.row : cb.row + cap;
      return '<section class="st-cta">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') +
        inner + '</section>';
    }
    case 'embed': {
      // Escape hatch: body passed through VERBATIM (no markdown processing). The portability-debt seam.
      // `wide` modifier → `.is-wide` full-bleed band; default hugs the theme content width (--gd-max).
      const wide = parseParams(s.params).wide ? ' is-wide' : '';
      return '<section class="st-embed' + wide + '">' + (s.body || '') + '</section>';
    }
    case 'people': {
      // Roster of people/companies: portrait, name, roles, blurb, link row. Mirrors People.astro.
      // A flat roster (one untitled group) renders WITHOUT the group wrapper, so its cells sit
      // directly in the section — the markup an ungrouped page would have had if the coral had no
      // grouping at all. `shape=logo` swaps the portrait for a contain-fit mark on a tile.
      const shape = pm.shape === 'logo' ? 'logo' : 'avatar';
      const gs = s.groups || [];
      const flat = gs.length === 1 && !gs[0].title;
      const gid = (t) => 'people-' + slugify(t, 'g');
      const roles = (b) => String(b || '').split('·').map((x) => x.trim()).filter(Boolean);
      const cellsOf = (g) => (g.people || []).map((p) => {
        const fi = firstImage(p.body);
        const fig = fi.img
          ? '<figure class="st-person-fig">' + imgTag(fi.img.alt, fi.img.src) + '</figure>'
          : '';
        // The name is the link when the person has one href and no named link row; with a link
        // row the name stays text and every destination is reachable from the row, so a card
        // never has two competing "the" links.
        const nm = inlineHtml(p.title);
        const name = p.href
          ? '<h3 class="st-person-name"><a href="' + escAttr(p.href) + '"' + (/^https?:\/\//.test(p.href) ? ' target="_blank" rel="noopener"' : '') + '>' + nm + '</a></h3>'
          : '<h3 class="st-person-name">' + nm + '</h3>';
        const rl = p.badge
          ? '<span class="st-person-roles">' + roles(p.badge).map((x) => '<span class="st-person-role">' + escHtml(x) + '</span>').join('') + '</span>'
          : '';
        const lk = (p.links && p.links.length)
          ? '<div class="st-person-links">' + p.links.map((l) => '<a class="st-person-link" href="' + escAttr(l.href) + '"' + (/^https?:\/\//.test(l.href) ? ' target="_blank" rel="noopener"' : '') + '>' + escHtml(l.label) + '</a>').join('') + '</div>'
          : '';
        return '<div class="st-person"' + (p.tone ? ' data-tone="' + escAttr(p.tone) + '"' : '') + '>' +
          fig + name + rl + '<div class="st-person-body">' + bodyHtml(fi.rest) + '</div>' + lk + '</div>';
      }).join('');
      const inner = flat
        ? '<div class="st-people-cells">' + cellsOf(gs[0]) + '</div>'
        : gs.map((g) => '<div class="st-people-group">' +
            '<p class="st-people-group-head" id="' + gid(g.title) + '">' + inlineHtml(g.title) + '</p>' +
            bodyHtml(g.lead) + '<div class="st-people-cells">' + cellsOf(g) + '</div></div>').join('');
      return '<section class="st-people" data-cols="' + escAttr(pm.cols || '') + '" data-shape="' + shape + '">' +
        (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') + bodyHtml(s.body) + inner + '</section>';
    }
    case 'collection': {
      // A list of items, optionally grouped (### category / #### item), with category jump-pills.
      // HEAD (title+intro+link) on the page field; BELT (eyebrow+pills+grouped cards). Mirrors
      // Collection.astro so the editor preview matches the Astro build.
      const groups = s.groups || [];
      const multi = groups.length > 1;
      const gid = (t) => 'group-' + slugify(t, 'g');
      const badges = (b) => String(b || '').split('·').map((x) => x.trim()).filter(Boolean);
      const linkIsGh = pm.link && typeof pm.link === 'object' && /github\.com/.test(pm.link.href);
      const link = pm.link && typeof pm.link === 'object'
        ? '<a class="st-collection-link' + (linkIsGh ? ' st-collection-link-gh' : '') + '" href="' + escAttr(pm.link.href) + '"' + (/^https?:\/\//.test(pm.link.href) ? ' target="_blank" rel="noopener"' : '') + '><span>' + escHtml(pm.link.label) + '</span>' + arrowSvg(/^https?:\/\//.test(pm.link.href) ? 'up-right' : 'right', 16) + '</a>' : '';
      const head = '<div class="st-collection-head">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') + bodyHtml(s.body) + link + '</div>';
      const eyebrow = pm.eyebrow ? '<p class="st-collection-eyebrow">' + escHtml(typeof pm.eyebrow === 'object' ? pm.eyebrow.label : pm.eyebrow) + '</p>' : '';
      const pills = multi ? '<nav class="st-collection-pills" aria-label="Categories">' +
        groups.map((g) => '<a class="st-collection-pill" href="#' + gid(g.title) + '">' + inlineHtml(g.title) + '</a>').join('') + '</nav>' : '';
      const groupsHtml = groups.map((g) => {
        const cards = (g.items || []).map((it) => {
          const bdg = it.badge ? '<span class="st-item-badges">' + badges(it.badge).map((x) => '<span class="st-item-badge">' + escHtml(x) + '</span>').join('') + '</span>' : '';
          const tags = (it.tags && it.tags.length) ? '<div class="st-item-tags">' + it.tags.map((x) => '<span class="st-item-tag">' + escHtml(x) + '</span>').join('') + '</div>' : '';
          // flat row (mirrors Collection.astro): heading + desc + tags + optional meta row
          // (updated seam + "View on GitHub" + optional "Learn more" homepage link)
          // 🩸 corrected 2026-07-05: live only wraps "View on GitHub" as an <a> when there's ALSO a
          // learn page (the card-wide link then targets learn, so GH needs its own anchor); without
          // one, the whole card already links to GitHub and live renders it as plain text.
          const ghTag = it.learn ? 'a' : 'span';
          const meta = (it.href || it.learn) ? '<div class="st-item-meta">' + (it.updated ? '<span class="st-item-updated">Updated ' + escHtml(it.updated) + '</span>' : '') +
            (it.href ? '<' + ghTag + ' class="st-item-gh"' + (it.learn ? ' href="' + escAttr(it.href) + '" target="_blank" rel="noopener"' : '') + '>View on GitHub ' + arrowSvg('up-right', 12) + '</' + ghTag + '>' : '') +
            (it.learn ? '<a class="st-item-learn" href="' + escAttr(it.learn) + '">Learn more ' + arrowSvg('right', 12) + '</a>' : '') + '</div>' : '';
          return '<div class="st-cell st-item"><div class="st-item-head"><h4>' + inlineHtml(it.title) + '</h4>' + bdg + '</div>' + bodyHtml(it.body) + tags + meta + '</div>';
        }).join('');
        return '<div class="st-collection-group"><p class="st-collection-group-head" id="' + gid(g.title) + '">' + inlineHtml(g.title) + '</p><div class="st-cells">' + cards + '</div></div>';
      }).join('');
      return '<section class="st-collection">' + head +
        '<div class="st-collection-belt"><div class="st-collection-belt-inner">' + eyebrow + pills + groupsHtml + '</div></div></section>';
    }
    case 'faq': {
      // Q&A accordion → native <details>/<summary> (zero-JS, a11y, progressive-enhancement —
      // the family posture). `open` (bare flag) expands every item on load (a live all-expanded
      // FAQ, e.g. a WP SiteOrigin accordion's default state); absent → collapsed. The lead
      // (intro/subtitle) + title live in `.st-faq-head`; the THEME paints the disclosure chrome.
      // Mirrors Faq.astro for editor-preview parity.
      const openAll = pm.open != null;
      const items = (s.faqs || []).map((e) =>
        '<details class="st-faq-item"' + (openAll ? ' open' : '') + '>' +
        '<summary class="st-faq-q">' + inlineHtml(e.q) + '</summary>' +
        '<div class="st-faq-a">' + bodyHtml(e.body) + '</div></details>').join('');
      return '<section class="st-faq">' +
        '<div class="st-faq-head">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') + bodyHtml(s.body) + '</div>' +
        '<div class="st-faq-list">' + items + '</div></section>';
    }
    case 'timeline': {
      // Chronological list: lead intro, then per `### <year>` a gutter-year row. The theme
      // lays year + prose as a two-column grid. Mirrors Timeline.astro for editor-preview parity.
      // `style=zigzag` (opt-in, e.g. a WP Cool-Timeline-Pro source) alternates each entry
      // left/right of a center dot-spine instead of the default single left-gutter column.
      const zigzag = pm.style === 'zigzag';
      const rows = (s.entries || []).map((e, i) =>
        '<div class="st-tl-row"' + (zigzag ? ' data-side="' + (i % 2 === 0 ? 'left' : 'right') + '"' : '') + '>' +
        (zigzag ? '<span class="st-tl-dot" aria-hidden="true"></span>' : '') +
        '<p class="st-tl-year">' + inlineHtml(e.year) + '</p>' +
        '<div class="st-tl-body">' + (e.title ? '<h3>' + inlineHtml(e.title) + '</h3>' : '') + bodyHtml(e.body) + '</div></div>').join('');
      const tlSurface = pm.surface ? ' data-surface="' + escAttr(typeof pm.surface === 'object' ? pm.surface.label : pm.surface) + '"' : '';
      return '<section class="st-timeline"' + (zigzag ? ' data-style="zigzag"' : '') + tlSurface + '>' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') +
        bodyHtml(s.body) + '<div class="st-tl-rows">' + rows + '</div></section>';
    }
    case 'social': {
      // A "follow / find us on" band: heading + caption blurb + a row of social link buttons
      // (first = primary filled, rest = outline). Buttons render AFTER the caption. General — any
      // creator/landing follow band. Mirrors Social.astro for editor-preview parity.
      const sp = socialParts(s.body);
      return '<section class="st-social">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') +
        (sp.caption ? bodyHtml(sp.caption) : '') + linkButtonsHtml(sp.links, 'st-social') + '</section>';
    }
    case 'tagcloud': {
      // A weighted category/tag cloud (WP/Blogger `#tag_cloud-N` widget): heading + a flow of
      // inline links. Body is a markdown list of `- [Label](/href)`; each becomes an `.st-tag`
      // anchor laid out inline-wrapping. General — any site with a tag/category cloud module.
      const links = tagcloudLinks(s.body);
      const tags = links.map((l) => '<a class="st-tag" href="' + escAttr(l.href) + '">' + inlineHtml(l.label) + '</a>').join('');
      return '<section class="st-tagcloud">' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') +
        '<div class="st-tag-flow">' + tags + '</div></section>';
    }
    default: { // prose — omit the heading when headingless; `align=left` opts out of centering.
      const align = pm.align ? ' data-align="' + escAttr(typeof pm.align === 'object' ? pm.align.label : pm.align) + '"' : '';
      const prSurface = pm.surface ? ' data-surface="' + escAttr(typeof pm.surface === 'object' ? pm.surface.label : pm.surface) + '"' : '';
      // `ordered` (bare flag) — a numbered-sections prose (legal/policy): the `### ` clauses render as
      // an <ol> of gutter-numbered <h2> clauses (orderedProseHtml). Absent → plain prose body.
      const ordered = pm.ordered != null;
      const bodyOut = ordered ? orderedProseHtml(s.body) : bodyHtml(s.body);
      return '<section class="st-prose"' + align + prSurface + (ordered ? ' data-ordered=""' : '') + '>' + (s.title ? '<h2>' + inlineHtml(s.title) + '</h2>' : '') + bodyOut + '</section>';
    }
  }
}

/**
 * Stamp a section's `id` onto the `<section>` tag renderSection just produced.
 *
 * 🔴 Done HERE, at the one seam, and not inside each branch of renderSection.
 * There are fifteen-plus hand-written `<section ...>` strings in that function;
 * editing each one is how three of them silently never get an id, and a missing
 * anchor does not look broken — the link simply lands at the top of the page,
 * which reads as "the citation is a bit vague" rather than as a defect.
 *
 * 🩸 The id itself has been computed since the parser was written
 * (`id: 's' + (si+1) + …`, above) and NOTHING has ever read it: measured
 * 2026-08-18 across this file — zero `.id` reads, zero destructures — and
 * confirmed against live cver.net, whose entire homepage carried one `id`
 * attribute, belonging to a locale banner. A value computed on every parse and
 * thrown away every time.
 *
 * What it buys: deep links to a section, a table of contents that can point at
 * one, and — the reason it is being done now — KAITO citing the PASSAGE it
 * quoted instead of the page containing it. A reader who is handed an article
 * and told the answer is in there somewhere has been given a worse version of
 * the promise "verbatim, and cited".
 */
function withSectionId(html, id) {
  if (!id) return html;
  // 🔴 AFTER the class attribute, never before it, and this is measured rather
  // than stylistic. `reef-mcp/src/inspect.js` reads a page's structure with
  //     [...html.matchAll(/<section class="st-([a-z-]+)/g)]
  // — a literal, position-dependent match. Putting `id` first turns that into
  // zero matches on every page, so `inspect_page` would report a site as having
  // no sections at all, silently, and inspect_page is the tool an agent uses to
  // check its own work. Appended, this change is additive to every string
  // matcher downstream: the existing render assertions in this file's own test
  // suite pass untouched, which is the proof.
  //
  // Only the OPENING tag, only when it has no id already, and anchored to the
  // very start so a nested `<section>` inside an embed body is never rewritten.
  if (!/^<section\b/.test(html) || /^<section\b[^>]*\sid=/.test(html)) return html;
  return html.replace(/^(<section class="[^"]*")/, '$1 id="' + escAttr(id) + '"');
}

function renderSiteToHtml(site) {
  const sectionsHtml = (site.sections || []).map((s) => withSectionId(renderSection(s), s.id)).join('\n');
  // `layout: sidebar` — two-column shell: fixed sidebar + main content column.
  // All other values (or absent) fall through to the current single-column output.
  if (String((site.meta || {}).layout || '').trim() === 'sidebar') {
    const navGroups = parseSidebarNav((site.meta || {})['sidebar-nav']);
    const navHtml = navGroups.map((g) =>
      '<div class="st-sidebar-group">' +
      (g.head ? '<p class="st-sidebar-group-head">' + escHtml(g.head) + '</p>' : '') +
      '<ul class="st-sidebar-list">' +
      g.items.map((it) => '<li>' + (it.href
        ? '<a href="' + escAttr(it.href) + '">' + escHtml(it.label) + '</a>'
        : '<span>' + escHtml(it.label) + '</span>') + '</li>').join('') +
      '</ul></div>'
    ).join('');
    // The site logo lives at the TOP of the sidebar (WP/Blogger sidebar-theme convention:
    // brand wordmark above the nav), not in a top header band. General for any sidebar site.
    const sbLogo = (site.meta || {})['site-logo']
      ? '<a class="st-sidebar-logo" href="/"><img src="' + escAttr(String((site.meta || {})['site-logo']).trim()) + '" alt="' + escAttr((site.meta || {}).title || '') + '" /></a>'
      : '';
    return '<div class="st-sidebar-layout">' +
      '<aside class="st-sidebar">' + sbLogo + '<nav class="st-sidebar-nav" aria-label="Sidebar">' + navHtml + '</nav></aside>' +
      '<div class="st-sidebar-main">' + sectionsHtml + '</div>' +
      '</div>';
  }
  return sectionsHtml;
}

// ── derived page description ─────────────────────────────────────────────────────────────────────
// A page with no `description:` in its frontmatter used to emit no <meta description>, no
// og:description and no twitter:description at all — so its search snippet and every share card
// were blank. Measured on a live site: 96 pages, not one of them carried the key.
//
// Asking 96 pages × 4 locales of marketing copy to be written before a share card works is the
// wrong bar. This is the ordinary static-site-generator answer: when the author said nothing, say
// what the page opens with. It is never worse than blank, and any page can still override it by
// writing the key — an authored description always wins.
//
// Deliberately NOT clever: first section that has prose, strip the inline markdown a reader would
// not want read aloud, collapse whitespace, cut on a word/sentence boundary near the budget. No
// summarisation, no LLM, no per-site config. A description that sometimes reads a little flat is a
// far cheaper failure than one that quietly invents a claim the page does not make.
const DESC_MAX = 160;
function deriveDescription(sections, max = DESC_MAX) {
  for (const s of sections || []) {
    // `embed` is raw HTML/JS and `gallery`/`social` are link furniture — none of them is prose a
    // human wrote to be read as a summary.
    if (s && (s.type === 'embed' || s.type === 'gallery' || s.type === 'social')) continue;
    const raw = String((s && s.body) || '').trim();
    if (!raw) continue;
    const text = raw
      .replace(/```[\s\S]*?```/g, ' ')            // fenced code
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links → their text
      .replace(/[*_`>#|]/g, ' ')                    // inline emphasis / quote / heading marks
      .replace(/\s+/g, ' ')
      // stripping `**bold**` leaves a gap before the punctuation that followed it
      .replace(/\s+([,.;:!?)\]}，。；：！？」』）】])/g, '$1')
      .trim();
    if (!text) continue;
    if (text.length <= max) return text;
    // Prefer a sentence end, then a word gap; CJK has neither, so fall through to a hard cut —
    // which is correct for CJK, where every character is a legal break.
    const window = text.slice(0, max + 1);
    const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'));
    if (stop > max * 0.5) return window.slice(0, stop + 1).trim();
    const gap = window.lastIndexOf(' ');
    return (gap > max * 0.5 ? window.slice(0, gap) : text.slice(0, max)).trim() + '…';
  }
  return '';
}

export {
  parseSite, serializeSite, isSiteFile, renderSiteToHtml,
  parseParams, splitFrontmatter, slugify,
  // inline/body render helpers — exported so the Astro layer (the production seam) shares ONE
  // inline-markdown source with the reference renderer (structure lives in .astro components,
  // inline text rendering stays here via cssmd). Additive; behavior unchanged.
  inlineHtml, bodyHtml, orderedProseHtml, ctaHtml, ctaButtonsHtml, ctaCaptionFirst, escAttr,
  heroParts, socialParts, linkButtonsHtml, firstImage, imgTag, tagcloudLinks,
  // sidebar layout helpers — exported so the Astro layer can reuse the same parser.
  parseSidebarNav,
  FRONTMATTER_KEY, KNOWN_TYPES,
  deriveDescription, DESC_MAX,
};
