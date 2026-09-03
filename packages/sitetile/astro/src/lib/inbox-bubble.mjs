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

export function inboxBubbleOn(meta = {}, pathname = '/', renderedBody = '') {
  if (renderedBody.includes('data-dynamic-coral="inbox-bubble"')) return false;
  const raw = String(meta['inbox-bubble'] ?? 'on').trim();
  if (OFF.test(raw)) return false;
  if (ON.test(raw) && Object.prototype.hasOwnProperty.call(meta, 'inbox-bubble-page-override')) return true;
  const locales = String(meta.locales || '').split(',').map((v) => v.trim()).filter(Boolean);
  const path = localeAgnosticPath(pathname, locales);
  const excluded = String(meta['inbox-bubble-except'] || '').split(',').some((p) => pathMatches(p, path));
  return !excluded;
}

