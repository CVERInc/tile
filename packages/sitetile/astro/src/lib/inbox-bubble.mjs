import { parseLocales, localesSourceOf } from '../packages/lingo/locale.mjs';

const OFF = /^(off|false|no|0)$/i;
const ON = /^(on|true|yes|1)$/i;

export function localeAgnosticPath(pathname, locales = []) {
  const path = `/${String(pathname || '/').split(/[?#]/)[0].replace(/^\/+|\/+$/g, '')}`;
  const first = path.split('/')[1].toLowerCase();
  const localeSet = new Set(locales.map((v) => String(v).trim().toLowerCase()));
  return localeSet.has(first) ? (path.slice(first.length + 1) || '/') : path;
}

export function pathMatches(pattern, pathname) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  return p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p;
}

// bubbleSearchOn: may the inbox bubble search this site's posts from inside the visitor's browser?
// reef#2160 (product owner 2026-10-18: default on, live sites too, OTA). Site-level, not per page — it
// decides whether /search-index.json carries rows, and that file is one per site. Off by either
// switch: the bubble itself (`inbox-bubble: off`) or the one-line owner opt-out
// (`inbox-bubble-search: off`). The page exclusion list is a per-page matter and is not read here.
// 🔴 Whether the index is PRIVATE enough is not this function's question: public-artifacts.mjs
// builds it from the same listedPosts/publicFacing path RSS uses, whichever switch turned it on.
export function bubbleSearchOn(meta = {}) {
  if (OFF.test(String(meta['inbox-bubble'] ?? 'on').trim())) return false;
  return !OFF.test(String(meta['inbox-bubble-search'] ?? 'on').trim());
}

// inboxBubbleStyle: the mount's inline style for `inbox-bubble-color` (opt-in, site-level).
// `accent` points the coral's two public colour knobs at the theme's accent and its ink; the coral reads
// them from its container (an open shadow root, so custom properties inherit; inbox-bubble.js `carry`).
// Any other value — no key, `default`, empty, a typo — returns undefined, so Astro emits NO style
// attribute and the mount stays byte-identical to a site that never heard of the key.
export function inboxBubbleStyle(meta = {}) {
  if (String(meta?.['inbox-bubble-color'] ?? '').trim().toLowerCase() !== 'accent') return undefined;
  return '--reef-inbox-accent:var(--gd-accent);--reef-inbox-on-accent:var(--gd-accent-ink,#fff)';
}

export function inboxBubbleOn(meta = {}, pathname = '/', renderedBody = '') {
  if (renderedBody.includes('data-dynamic-coral="inbox-bubble"')) return false;
  const raw = String(meta['inbox-bubble'] ?? 'on').trim();
  if (OFF.test(raw)) return false;
  if (ON.test(raw) && Object.prototype.hasOwnProperty.call(meta, 'inbox-bubble-page-override')) return true;
  const locales = parseLocales(meta.locales, localesSourceOf(meta));
  const path = localeAgnosticPath(pathname, locales);
  const excluded = String(meta['inbox-bubble-except'] || '').split(',').some((p) => pathMatches(p, path));
  return !excluded;
}

