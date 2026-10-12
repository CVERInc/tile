// Which mark a link carries — ONE table and ONE rule, for the card and for the table it is edited on
// (CVERInc/reef#2015).
//
// 🩸 tile#123 (reef#2011) taught the RENDERER to draw Instagram and Threads (the favicon service has
// nothing for them) and to honour `icon=` / `iconhost=` on a social line. The editing table's tiles
// are a mini-render of the finished element, but they derived their mark from a copy of the old
// rule — so the same card showed a broken favicon while being edited and the drawn mark once
// published, and an override did nothing on the table at all. Two copies that agree today are two
// copies; this file is the one, and both sides import it.
//
// Pure data: no markup here. card-render turns a mark into the card's <svg>/<img>, edit2 into the
// tile's — each side owns its own drawing, neither owns the decision.
import { ICON_DOMAIN_RE } from './marks.mjs';

// A cell body → the label and the address of one link.
//
// 🩸 The `else` used to be `{ label: body, url: '#' }`, and that single `'#'` was the most expensive
// character in the file. The most natural thing a first-time visitor does — paste a bare URL into a
// field called 「連結」 — produced a full-width button whose text was the raw address and whose
// href was `#`: it opened a new tab onto the same page. Six locales, six times, every time.
//
// Two changes, and neither of them guesses. A body that IS an address is read as one (the label
// falls back to the host, which is what a person would have typed anyway); a body that is neither a
// markdown link nor an address yields url `''`, and the caller declines to draw a button rather than
// drawing a dead one. `'#'` is a MEANINGFUL value elsewhere in this file (a drawer target), which is
// precisely why it must never also be the value for "there was nothing here".
const BARE_URL_RE = /^(?:https?:\/\/|mailto:|tel:)\S+$/i;
const hostLabel = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
};
const linkOf = (body) => {
  const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(body || '');
  if (m) return { label: m[1], url: m[2] };
  const bare = (body || '').trim();
  if (BARE_URL_RE.test(bare)) return { label: hostLabel(bare), url: bare };
  // a bare address followed ONLY by override tokens (`icon=` / `iconhost=`, reef#2011) is still an
  // address: the tokens are read by the caller, never part of the url. 🔴 The WHOLE tail must be
  // legal tokens (icon=[a-z0-9-]+, iconhost=<ICON_DOMAIN_RE host>, space-separated, nothing else);
  // `?q=one icon=shop&x=2` has a tail with `&x=2` in it, so it is not an override and the whole line
  // stays the URL. A space inside a URL is written %20.
  const t = /^((?:https?:\/\/|mailto:|tel:)\S+)((?:\s+\S+)+)$/i.exec(bare);
  if (t) {
    const over = {};
    const ok = t[2].trim().split(/\s+/).every((tok) => {
      const m = /^(icon|iconhost)=(.+)$/i.exec(tok);
      if (!m) return false;
      const k = m[1].toLowerCase();
      if (k === 'icon' ? !/^[a-z0-9-]+$/.test(m[2]) : !ICON_DOMAIN_RE.test(m[2])) return false;
      over[k] = m[2];
      return true;
    });
    if (ok) return { label: hostLabel(t[1]), url: t[1], over };
  }
  if (/^(?:https?:\/\/|mailto:|tel:)\S/i.test(bare)) return { label: hostLabel(bare), url: bare };
  return { label: bare, url: '' };
};

// 🔴 The host AS WRITTEN, `www.` included (reef#2011). This used to strip it, and DuckDuckGo has a
// mark for `www.instagram.com` and none for `instagram.com` — so the one name with a picture was the
// one name the card could never ask for. Anything that wants the bare name strips it itself.
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

// Which domain owns the mark a favicon service will have. Two rules, both fixing a whole CLASS of
// missing icon rather than one card's link — `iconhost=` stays for an author pointing DELIBERATELY
// somewhere else (a bit.ly whose real destination is webtoons.com), not for patching our lookup:
//   1. renamed sites keep their old domain in a creator's links long after the mark moved
//   2. a subdomain rarely has its own favicon; the site's does
const ICON_ALIAS = { 'twitter.com': 'x.com', 'fb.com': 'facebook.com', 'goo.gl': 'google.com', 'youtu.be': 'youtube.com' };
// The second-level labels a country code sells names UNDER: books.com.tw's site is books.com.tw,
// not com.tw. Not the public-suffix list — just enough that the common ones (.com.tw .co.uk .co.jp
// .com.au) stop costing every visitor a request for a suffix that has no mark (reef#2011).
const CC_SECOND_LEVEL = new Set(['com', 'net', 'org', 'edu', 'gov', 'co', 'ac', 'or', 'ne', 'go', 'idv']);
/** sub.example.com → example.com; shop.example.co.uk → example.co.uk */
function siteOf(host) {
  const parts = host.split('.');
  const n = parts.length > 2 && parts[parts.length - 1].length === 2 && CC_SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}
/** host → the domains worth trying, best first. */
function iconDomains(host) {
  if (!host) return [];
  const bare = host.replace(/^www\./, '');
  const base = ICON_ALIAS[bare] || bare;
  // As written first — unless the mark moved with the name (twitter.com → x.com) — then the site
  // (a subdomain rarely has its own favicon; the site's does), then the site's www. twin: a service
  // can hold a mark for one spelling and not the other, and which one is not ours to predict.
  const site = siteOf(base);
  return [...new Set([ICON_ALIAS[bare] ? base : host, site, `www.${site}`])];
}

// 🔴 Brands whose mark we DRAW, by site → the `ICONS` name (reef#2011). The favicon service answers
// 404 for instagram.com and threads.* — measured 2026-10-12 — so for these a fetched mark is a mark
// that is not there; one we ship cannot 404. Deliberately short: everything not in it keeps the
// brand's CURRENT favicon, which is the whole reason marks are fetched (see marks.mjs). A brand goes
// in here when the service has nothing for it, not because we would like to draw it.
// 🔴 EXACT hosts, not sites: `siteOf()` would hand foo.instagram.com the Instagram mark, and a host
// we did not list is a host we did not measure — it keeps its own favicon chain.
const BRAND_ICON = {
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
  'threads.net': 'threads', 'www.threads.net': 'threads', 'threads.com': 'threads', 'www.threads.com': 'threads',
};

/** `host`'s drawn brand → its `ICONS` name, or '' — exact hosts only (see above) */
function brandOf(host) {
  const h = String(host || '').toLowerCase();
  return Object.hasOwn(BRAND_ICON, h) ? BRAND_ICON[h] : '';
}

/**
 * One line of a social row → `{ label, url, icon?, iconhost? }`. A line may carry `icon=<name>` or
 * `iconhost=<domain>` after its address — the same two words a link cell takes as params (reef#2011):
 * after a bare address only as a fully-legal tail (`linkOf`'s rule), after `[name](url)` as any
 * `icon=`/`iconhost=` word in what follows it.
 */
function socialLineOf(l) {
  const line = String(l || '').trim();
  const x = linkOf(line);
  if (x.over) { Object.assign(x, x.over); return x; }
  if (/^\[/.test(line)) for (const [, k, v] of line.replace(/^\[[^\]]*\]\([^)\s]+\)/, '').matchAll(/(?:^|\s)(icon|iconhost)=([^\s"'<>]+)/g)) x[k] = v;
  return x;
}

// A mark is `{ icon: <ICONS name> }` (drawn — cannot 404) or `{ hosts: [domain, …] }` (a favicon
// chain, best first; may be empty). `has(name)` says whether a drawn mark of that name ships — an
// `icon=` naming one that does not falls through to the default, never to nothing.
/** the AUTHOR'S mark, or null: `icon=` (if it ships) → `iconhost=`. Wins over every default. */
function overrideMark({ icon, iconhost } = {}, has = () => false) {
  if (icon && has(icon)) return { icon };
  if (iconhost) return { hosts: [iconhost] };
  return null;
}
/** the mark a host gets when the author named none: the drawn brand (if it ships) → its favicon chain */
function defaultMark(host, has = () => false) {
  const brand = brandOf(host);
  if (brand && has(brand)) return { icon: brand };
  return { hosts: iconDomains(host) };
}

export { linkOf, hostLabel, hostOf, siteOf, iconDomains, brandOf, socialLineOf, overrideMark, defaultMark };
