// REEF with Repo Facts — the brain of the dynamic coral, in a form `node --test` can drive.
// The distributable `repo-facts.js` is BUILT from repo-facts-client.mjs, which imports this.
//
// What it does: a page already lists some repositories — written by a person, as cards, each with
// a link to the repo. This adds the facts a person should never have to retype: the latest release
// with its date, or — for an archived repo — a badge saying so and nothing else. A repo with no
// release and no badge gets nothing: an unlabelled date would be read as a release date.
//
//   <div data-dynamic-coral="repo-facts"
//        data-api-base="https://…"          REQUIRED — the origin serving /v0/repo-facts
//        data-scope=".st-collection"        where to look for repo links (default: the whole page)
//        data-forge="github"></div>         the only forge there is today (default: github)
//
// 🔴 THE LIST IS THE PAGE. It reads repo links that are ALREADY in the document and asks about
// exactly those. It never lists an owner's repositories, so nothing appears on a page that a
// person did not put there.
//
// 🔴 THE ANSWER IS UNTRUSTED. Every value is validated here again, against the same field table
// the edge used (repo-facts-fields.mjs), and written with textContent — there is no
// markup-building path in this file. A response that is late, redirected, not ok or not JSON
// changes nothing at all: the page stays what it was before this script ran. A repo whose entry
// has ONE field of the wrong shape is left alone like a repo that was never answered for, and the
// other cards are still filled. No spinner, no "loading", no error text.
//
// 🔴 THE CONTRACT WITH THE RENDERER, which nothing else writes down. A "card" is `.st-item`; its
// facts go into `.st-item-meta-left`, before `.st-item-gh` when there is one; and the fragment
// borrows two of the renderer's own classes for its looks — `st-item-updated` (the muted meta
// text) and `st-item-badge` (the pill) — so it injects no stylesheet. A link outside a card is not
// asked about. See README.md for what should replace this (a `data-repo` on the card).
import { FIELDS, REPO } from './repo-facts-fields.mjs';

export const SELECTOR = '[data-dynamic-coral="repo-facts"]';
export const PATH = '/v0/repo-facts';
export const MAX_REPOS = 30;
export const TIMEOUT_MS = 3000;
// Where a rename (and the count of filled cards) is left for whoever is checking the page. A
// sibling of window.__coralVersions and shaped like it: one key per coral.
export const DIAGNOSTICS = '__coralDiagnostics';
export const MARK = 'data-dc-repo-facts';

const HOSTS = { github: 'github.com' };
// The only words this coral ever shows, by the PRIMARY language subtag of <html lang> — the whole
// of it, so `jam` is not Japanese and `kok` is not Korean. Anything else reads the English one.
const ARCHIVED = { zh: '已封存', ja: 'アーカイブ済み', ko: '보관됨' };

/** `owner/repo` for a link straight to a repository, or '' for anything else. */
export function repoOf(href, host) {
  try {
    const u = new URL(href);
    // Deeper paths (issues, releases, a file) are not "the repo link" of a card and are not
    // guessed at. Dot segments never get this far: the URL parser has already resolved them.
    const name = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
    return u.hostname === host && REPO.test(name) ? name : '';
  } catch {
    return '';
  }
}

/** Every card in `scope` with a repo link, as a Map of card → `owner/repo`. Capped by distinct repo. */
export function findCards(scope, host) {
  const cards = new Map();
  for (const a of scope.querySelectorAll('a[href]')) {
    const name = repoOf(a.href, host), card = name && a.closest('.st-item');
    // One answer per card (its first repo link), and no more than MAX_REPOS questions per page.
    if (card && !cards.has(card) && new Set(cards.values()).add(name).size <= MAX_REPOS) cards.set(card, name);
  }
  return cards;
}

/**
 * The response, narrowed to the repos that were asked about. A repo that is absent, or whose
 * entry has any field of the wrong shape, reads as `{}` — nothing to say — so one bad entry costs
 * one card and not the page. (A body that is not an object at all throws here; the caller writes
 * nothing.)
 */
export function checkResponse(data, names) {
  const out = {};
  for (const n of names) {
    const f = Object.hasOwn(data, n) && data[n];
    out[n] = f && typeof f === 'object' && Object.keys(FIELDS).every((k) => f[k] == null || FIELDS[k](f[k])) ? f : {};
  }
  return out;
}

/**
 * Write the facts into the cards: one fragment per card, text nodes only, and a card with nothing
 * to say is left alone. Returns the linked names the forge now answers to differently. Never
 * rewrites a link.
 */
export function fillCards(cards, facts, lang) {
  const renamed = {};
  for (const [card, name] of cards) {
    const f = facts[name], slot = card.querySelector('.st-item-meta-left');
    // Already filled — this script ran twice, or two copies of it are on the page.
    if (!slot || card.querySelector(`[${MARK}]`)) continue;
    if (f.fullName && f.fullName.toLowerCase() !== name.toLowerCase()) renamed[name] = f.fullName;
    const el = document.createElement('span');
    el.className = 'st-item-updated';
    el.setAttribute(MARK, name);
    if (f.archived) {
      // The badge and nothing after it: a date beside "archived" reads as the day it was archived,
      // and no field here says when that was.
      const badge = document.createElement('span');
      badge.className = 'st-item-badge';
      badge.textContent = ARCHIVED[lang.split('-')[0].toLowerCase()] || 'Archived';
      el.append(badge);
    } else if (f.tag && f.releasedAt) {
      // The ONLY date this coral shows is a release date, next to its tag, and it is ABSOLUTE. A
      // relative one ("yesterday") is true for a day and then sits in a cache.
      const day = (l) => new Date(f.releasedAt).toLocaleDateString(l, { dateStyle: 'long', timeZone: 'UTC' });
      const time = document.createElement('time');
      time.dateTime = f.releasedAt;
      // A page whose <html lang> is not a language tag still gets a date, in the fallback locale.
      try { time.textContent = day(lang); } catch { time.textContent = day('en'); }
      el.append(f.tag + ' · ', time);
    } else continue;
    slot.insertBefore(el, slot.querySelector('.st-item-gh'));
  }
  return renamed;
}

/**
 * Mount one container. Resolves to the diagnostics it recorded; never rejects, and on any failure
 * resolves having touched nothing in the document.
 */
export async function mountRepoFacts(root, timeoutMs = TIMEOUT_MS) {
  const all = (window[DIAGNOSTICS] ||= {});
  const attr = (k) => root.getAttribute(k) || '';
  try {
    // No default origin, on purpose: an endpoint nobody chose is a 404 that looks like an outage.
    const base = /^https:\/\/[^/]+/.exec(attr('data-api-base'))[0];
    const scope = attr('data-scope') ? document.querySelector(attr('data-scope')) : document;
    const cards = findCards(scope, HOSTS[attr('data-forge') || 'github']);
    const names = [...new Set(cards.values())].sort();
    // A page with no repo cards asks nothing.
    if (!names.length) throw 0;
    // credentials: 'omit' — this asks a question about public repos; nobody's cookies go with it.
    // redirect: 'error' — the visitor's browser talks to the origin the page named and to no other,
    // whatever that origin (or a rule in front of it) would like to send it on to.
    const r = await fetch(`${base}${PATH}?repos=${names}`,
      { signal: AbortSignal.timeout(timeoutMs), credentials: 'omit', redirect: 'error' });
    if (!r.ok) throw 0;
    const renamed = fillCards(cards, checkResponse(await r.json(), names), document.documentElement.lang || 'en');
    // `filled` is counted off the page, not off this run: with two mounts, or the script loaded
    // twice, the last writer would otherwise report the cards it skipped as cards nobody filled.
    return (all['repo-facts'] = {
      filled: document.querySelectorAll(`[${MARK}]`).length,
      renamed: { ...all['repo-facts']?.renamed, ...renamed },
    });
  } catch {
    // Late, redirected, not ok, not JSON, or misconfigured: all one outcome. Nothing was written —
    // and nothing an earlier, successful run recorded is overwritten.
    return (all['repo-facts'] ||= { error: 1 });
  }
}
