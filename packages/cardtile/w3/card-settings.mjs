// Cards settings — what belongs to the whole card, not to one tile — as pure frontmatter edits.
//
// 🔴 EVERY CHANGE APPLIES AT ONCE. The settings sheet has no Done: each control writes its key into
// the DRAFT the moment it changes (nothing is live until Save, so there is nothing to confirm), and
// closing the sheet keeps everything. One rule for every row, instead of some rows applying at once
// and others waiting for a button at the bottom of a long sheet.
//
// The keys are the ones the renderer (backdrop, backdrop-dim, accent, theme, header, icons) and the
// deck (views, view) read. A value that is the default is written as no line at all.
export const VIEW_IDS = ['stack', 'list', 'wall'];

export function fmRead(pre) {
  const o = {}, f = /^---\n([\s\S]*?)\n---/.exec(pre || '');
  if (f) for (const l of f[1].split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) o[k[1]] = k[2].trim(); }
  return o;
}

/** one `key: value` line inside the frontmatter fence; null or '' removes it */
export function fmWrite(pre, key, value) {
  const f = /^---\n([\s\S]*?)\n---/.exec(pre || '');
  const lines = f ? f[1].split('\n') : [];
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (value == null || value === '') { if (at >= 0) lines.splice(at, 1); }
  else if (at >= 0) lines[at] = `${key}: ${value}`; else lines.push(`${key}: ${value}`);
  if (!f && !lines.length) return pre || '';
  const fence = `---\n${lines.join('\n')}\n---`;
  return f ? pre.replace(f[0], () => fence) : `${fence}\n${pre || ''}`;
}

/** the views a card offers, and the one it opens on, as the settings sheet shows them */
export function readViews(pre) {
  const fm = fmRead(pre);
  const on = String(fm.views || VIEW_IDS.join(' ')).split(/[\s,]+/).filter((v) => VIEW_IDS.includes(v));
  const list = on.length ? VIEW_IDS.filter((v) => on.includes(v)) : [...VIEW_IDS];
  return { on: list, open: list.includes(fm.view) ? fm.view : list[0] };
}

/**
 * Turn one view on or off. The last one on stays on; turning off the one that opens moves the opening
 * to the first one left. Returns the new { on, open }.
 */
export function toggleView({ on, open }, v, want) {
  const set = new Set(on);
  if (want) set.add(v); else if (set.size > 1) set.delete(v);
  const list = VIEW_IDS.filter((x) => set.has(x));
  return { on: list, open: list.includes(open) ? open : list[0] };
}

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * One setting → the frontmatter it becomes. `name` is the control's name; `value` what it now says.
 * Unknown names are refused (an error), so a typo in the sheet cannot write a key nothing reads.
 */
export function applySetting(pre, name, value) {
  switch (name) {
    case 'title': return fmWrite(pre, 'title', String(value || '').trim() || null);
    case 'backdrop': return fmWrite(pre, 'backdrop', String(value || '').trim() || null);
    case 'backdrop-dim': return fmWrite(pre, 'backdrop-dim', value ? String(value) : null);
    case 'header': return fmWrite(pre, 'header', value === 'left' ? 'left' : null);
    case 'icons': return fmWrite(pre, 'icons', value === 'mono' ? 'mono' : null);
    case 'accent': return fmWrite(pre, 'accent', HEX.test(String(value || '')) ? String(value).toLowerCase() : null);
    case 'theme': return fmWrite(pre, 'theme', value === 'light' || value === 'dark' ? value : null);
    case 'views': {
      const on = VIEW_IDS.filter((v) => (value.on || []).includes(v));
      const list = on.length ? on : [...VIEW_IDS];
      const open = list.includes(value.open) ? value.open : list[0];
      // all three on says nothing; the first one on opens anyway, so it says nothing either
      const p = fmWrite(pre, 'views', list.length === VIEW_IDS.length ? null : list.join(' '));
      return fmWrite(p, 'view', open === list[0] ? null : open);
    }
    default: throw new Error(`card-settings: no setting called ${name}`);
  }
}
