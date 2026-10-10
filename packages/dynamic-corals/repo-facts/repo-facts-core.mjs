// REEF with Repo Facts — the page half, in a form `node --test` can drive. The distributable
// `repo-facts.js` is BUILT from repo-facts-client.mjs, which imports this.
//
// One embed per page:
//
//   <div data-dynamic-coral="repo-facts" data-owner="CVERInc" data-api-base="https://feelreef.com"></div>
//
// It asks the edge once for the owner's facts, then walks the page's sitetile `collection` cards
// (`.st-item`). A card whose GitHub link names a repo of that owner gets its "Updated …" text
// (`.st-item-updated`, which the renderer wrote from a phrase somebody typed once) recomputed from
// the last push, and — when the repo is archived — an archived pill among its badges. A page that
// typed no date has no such line, so the coral writes one where Collection.astro would have (first
// in `.st-item-meta-left`; any separator is the theme's business), and a page without JS shows no
// date at all. A card the answer does not cover is left exactly as it was. On
// any failure nothing is written at all. Text only: the few elements created carry fixed class
// names, and everything from the answer goes in through textContent.
export const SELECTOR = '[data-dynamic-coral="repo-facts"]';
export const PATH = '/v0/repo-facts';
export const TIMEOUT_MS = 3000;
export const DIAGNOSTICS = '__coralDiagnostics';
export const MARK = 'data-dc-repo-facts';
const DAY = 864e5;

// The card's own wording, as sitetile's Collection.astro writes it per language (a test holds the
// two together). The phrase itself comes from the browser's Intl, which is what the live pages
// already read like: "yesterday", "前天", "先月", "지난달".
export const UPDATED = { en: (x) => `Updated ${x}`, zh: (x) => `${x} 更新`, ja: (x) => `${x} 更新`, ko: (x) => `업데이트 날짜: ${x}` };
export const ARCHIVED = { en: 'Archived', zh: '已封存', ja: 'アーカイブ済み', ko: '보관됨' };

/** The language to write in, by the PRIMARY subtag (whole: `jam` is not `ja`). Anything else: en. */
export const langOf = (tag) => { const p = String(tag || '').split('-')[0].toLowerCase(); return UPDATED[p] ? p : 'en'; };

/** "3 days ago" in the page's language, from a UTC day `YYYY-MM-DD`; '' when the day is not one. */
export function relative(day, now, tag) {
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || Number.isNaN(Date.parse(day))) return '';
  // Whole UTC days between that day and today; a push "tomorrow" (a skewed clock) reads as today.
  const days = Math.max(0, Math.round((Math.floor(now / DAY) * DAY - Date.parse(day)) / DAY));
  const [n, unit] = days < 30 ? [days, 'day'] : days < 365 ? [Math.floor(days / 30), 'month'] : [Math.floor(days / 365), 'year'];
  const lang = langOf(tag);
  let fmt;
  try { fmt = new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : tag, { numeric: 'auto' }); } catch { fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }); }
  return fmt.format(-n, unit);
}

/** The lower-case repo name of a link straight to a repository of `owner`, or ''. */
export function repoOf(href, owner) {
  try {
    const u = new URL(href), m = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
    return u.hostname === 'github.com' && m && m[1].toLowerCase() === owner.toLowerCase() ? m[2].toLowerCase() : '';
  } catch { return ''; }
}

/** Write the facts into the cards. Returns how many cards on the page now carry a fact, and how
 *  many it had a fact for but no meta row to write the line into. */
export function fillCards(doc, data, owner, tag, now) {
  const lang = langOf(tag);
  let skipped = 0;
  for (const card of doc.querySelectorAll('.st-item')) {
    const name = [...card.querySelectorAll('a[href]')].map((a) => repoOf(a.href, owner)).find(Boolean);
    const f = name && Object.hasOwn(data, name) && data[name];
    if (!f || typeof f !== 'object') continue;
    let span = card.querySelector('.st-item-updated');
    const phrase = relative(f.pushed_at, now, tag);
    if (!span && phrase) {
      // The renderer writes the line only when the page typed a date. Same element, same place,
      // so the theme's own `.st-item-updated` rule applies. Found next time ⇒ never built twice.
      const box = card.querySelector('.st-item-meta-left') || card.querySelector('.st-item-meta');
      if (!box) { skipped++; continue; }
      span = doc.createElement('span');
      span.className = 'st-item-updated';
      box.insertBefore(span, box.firstChild);
    }
    if (span && phrase) {
      span.textContent = UPDATED[lang](phrase);
      span.setAttribute(MARK, name);
    }
    const head = card.querySelector('.st-item-head');
    // Already there — this ran twice, or the author typed the pill — in any of the four languages.
    const has = [...card.querySelectorAll('.st-item-badge')].some((b) => Object.values(ARCHIVED).includes(b.textContent.trim()));
    if (f.archived === true && head && !has) {
      let box = card.querySelector('.st-item-badges');
      if (!box) { box = doc.createElement('span'); box.className = 'st-item-badges'; head.appendChild(box); }
      const badge = doc.createElement('span');
      badge.className = 'st-item-badge';
      badge.setAttribute(MARK, name);
      badge.textContent = ARCHIVED[lang];
      box.appendChild(badge);
    }
  }
  return { filled: [...doc.querySelectorAll('.st-item')].filter((c) => c.querySelector(`[${MARK}]`)).length, skipped };
}

/** Mount one embed. Never rejects; on any failure the document is untouched. */
export async function mountRepoFacts(root, opts = {}) {
  const all = (window[DIAGNOSTICS] ||= {});
  try {
    // No default origin: an endpoint nobody chose is a 404 that looks like an outage.
    const base = /^https:\/\/[^/]+/.exec(root.getAttribute('data-api-base') || '')[0];
    const owner = root.getAttribute('data-owner') || '';
    if (!/^[\w.-]{1,100}$/.test(owner)) throw 0;
    // No cookies, and no second origin: a redirect is a failure.
    const r = await fetch(`${base}${PATH}?owner=${owner}`,
      { signal: AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS), credentials: 'omit', redirect: 'error' });
    if (!r.ok) throw 0;
    const data = await r.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0;
    const tag = root.getAttribute('data-locale') || document.documentElement.lang || 'en';
    return (all['repo-facts'] = fillCards(document, data, owner, tag, opts.now || Date.now()));
  } catch {
    return (all['repo-facts'] ||= { error: 1 });
  }
}
