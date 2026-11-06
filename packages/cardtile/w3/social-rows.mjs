// The social-icons tile as a FORM: one row per account — pick the network, paste a link or a handle.
// Nobody types Markdown, %20, icon= or iconhost= on a phone keyboard to fill it in.
//
// The tile's body stays what the renderer reads (card-render.mjs `social`, via link-marks.mjs
// socialLineOf): one `[Name](address)` line per account, optionally followed by `icon=` / `iconhost=`
// overrides. Those overrides, and any line this form cannot show as a row, are kept exactly as
// written — the form edits what it understands and never drops what it does not.
export const NETWORKS = [
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'], from: (h) => `https://instagram.com/${h}` },
  { id: 'threads', label: 'Threads', hosts: ['threads.net', 'threads.com'], from: (h) => `https://www.threads.net/@${h}` },
  { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com'], from: (h) => `https://facebook.com/${h}` },
  { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], from: (h) => `https://youtube.com/@${h}` },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'], from: (h) => `https://tiktok.com/@${h}` },
  { id: 'x', label: 'X', hosts: ['x.com', 'twitter.com'], from: (h) => `https://x.com/${h}` },
  { id: 'line', label: 'LINE', hosts: ['line.me', 'lin.ee'], from: (h) => `https://line.me/ti/p/~${h}` },
  { id: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'], from: (h) => `https://linkedin.com/in/${h}` },
  { id: 'github', label: 'GitHub', hosts: ['github.com'], from: (h) => `https://github.com/${h}` },
  { id: 'email', label: 'Email', hosts: [], from: (h) => `mailto:${h}` },
  { id: 'web', label: '', hosts: [], from: (h) => `https://${h}` },
];
const byId = Object.fromEntries(NETWORKS.map((n) => [n.id, n]));
const LINE = /^\[([^\]]*)\]\(([^)\s]+)\)(.*)$/;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\.|^m\./, '').toLowerCase(); } catch { return ''; } };

/** an address → the network it belongs to ('web' when none matches) */
export function networkOf(url) {
  const u = String(url || '');
  if (/^mailto:/i.test(u)) return 'email';
  const h = hostOf(u);
  const n = NETWORKS.find((x) => x.hosts.some((d) => h === d || h.endsWith('.' + d)));
  return n ? n.id : 'web';
}

/** the tile's body → rows. A row is { net, label, url, extra } or { raw } for a line kept as written. */
export function parseSocial(body) {
  return String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = LINE.exec(line);
    if (!m) return { raw: line };
    return { net: networkOf(m[2]), label: m[1], url: m[2], extra: m[3].trim() };
  });
}

/**
 * What a person typed in a row → the address stored. A full address is kept (spaces encoded); a bare
 * handle (`name`, `@name`) is made into the network's address; for Email, an address becomes mailto:.
 */
export function addressFor(net, input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const enc = (x) => x.replace(/\s/g, '%20');
  if (/^(https?:\/\/|mailto:)/i.test(s)) return enc(s);
  if (net === 'email') return `mailto:${enc(s.replace(/^mailto:/i, ''))}`;
  const n = byId[net] || byId.web;
  // something that already names a host (`instagram.com/me`, `example.com`) is an address without its scheme
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return enc(`https://${s}`);
  if (net === 'web') return enc(`https://${s}`);
  return n.from(enc(s.replace(/^@/, '')));
}

/** rows → the tile's body. Empty rows are dropped; kept lines come back exactly as they were. */
export function composeSocial(rows) {
  return rows.map((r) => {
    if (r.raw != null) return r.raw;
    const url = addressFor(r.net, r.url);
    if (!url) return '';
    const n = byId[r.net] || byId.web;
    const label = n.label || r.label || hostOf(url) || url;
    return `[${label.replace(/[[\]]/g, '')}](${url})${r.extra ? ' ' + r.extra : ''}`;
  }).filter(Boolean).join('\n');
}
