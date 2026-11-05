// Cards settings: the panel's shape, as pure data (w3/edit3.mjs draws it).
//
// 🔴 iOS SETTINGS IS THE RULER. One panel, two shapes, picked by the width it is drawn at:
//   narrow (< WIDE_MIN)  iOS Settings — grouped inset lists; a row that has a page of its own pushes
//                        that page in from the right, and the page's top-left goes back.
//   wide   (≥ WIDE_MIN)  iPadOS Settings — a sidebar of the groups, the chosen group's rows on the
//                        right; a 2–3-option choice is an inline dropdown or switch there.
// The panel is at most PANEL_MAX wide, centred; beyond that, the glass shows on both sides.
//
// The panel lives on the ONE glass layer every opened thing shares: the whole screen, the editor's top
// bar included, goes under frosted glass, and only the glass's ✕ (top-left, where the logo is) floats
// above it. ✕ and Escape close the top-most thing first (topLayer below).
export const WIDE_MIN = 700;
export const PANEL_MAX = 1000;

/** the panel's shape at a viewport width */
export const layoutFor = (width) => (Number(width) >= WIDE_MIN ? 'wide' : 'narrow');

/**
 * The groups, in order, and each group's rows. `sandbox` is the public sandbox (no account): it has the
 * sign-in entry and Start over. 🔴 The address, the domain, the pool and the transfer are the
 * PLATFORM's, not the file's; in host mode (a real Card) this editor cannot change them yet, so the
 * address is read-only and the rest are not offered.
 *
 * `danger` is the red group at the bottom (destructive, each confirmed first). On the narrow shape
 * "Replace with a file" lives on the Backup page's own red group, so the root's red group holds only
 * Start over; on the wide shape the More group shows both together.
 */
export function settingsPlan({ sandbox, layout = 'narrow' }) {
  const wide = layout === 'wide';
  const groups = [
    sandbox && !wide && { id: 'account', rows: ['signin'] },
    { id: 'name', rows: ['title', 'address', ...(sandbox ? ['domain'] : [])] },
    { id: 'look', rows: ['theme', 'accent', 'backdrop', 'header', 'icons'] },
    { id: 'views', rows: ['views', 'back'] },
    sandbox && { id: 'found', rows: ['pool'] },
    { id: 'more', rows: ['raw', 'backup', ...(sandbox ? ['transfer'] : [])] },
  ].filter(Boolean);
  const danger = wide ? ['replace', ...(sandbox ? ['reset'] : [])] : (sandbox ? ['reset'] : []);
  if (wide) groups.find((g) => g.id === 'more').danger = danger;
  else if (danger.length) groups.push({ id: 'danger', rows: danger });
  return groups;
}

/** the wide shape's sidebar: every group but the sign-in one (the sidebar draws that above the list) */
export const sidebarGroups = (opts) => settingsPlan({ ...opts, layout: 'wide' }).map((g) => g.id);

/**
 * The rows that open a page of their own, by shape. Narrow: every row with more than a switch or a
 * field. Wide: only what does not fit inline (changing the address asks for the old one first).
 */
const PAGED = {
  narrow: new Set(['address', 'domain', 'theme', 'accent', 'backdrop', 'header', 'icons', 'views', 'back', 'backup']),
  wide: new Set(['address']),
};
export const opensPage = (row, layout) => PAGED[layout === 'wide' ? 'wide' : 'narrow'].has(row);

/** a 2–3-option setting: a checkmark page on the narrow shape, an inline dropdown on the wide one */
export const CHOICES = {
  theme: ['auto', 'light', 'dark'],
  header: ['centre', 'left'],
  icons: ['colour', 'mono'],
  dim: ['', '0', '25', '45', '65'],
};

/**
 * The page stack of the narrow shape (and of a pushed page inside the wide shape's right side). The
 * bottom is the root ('root' narrow, a group id wide); `back` is what the top page's back control
 * returns to, or null on the root.
 */
export function createPageStack(root = 'root') {
  let stack = [root];
  return {
    get top() { return stack[stack.length - 1]; },
    get depth() { return stack.length; },
    get back() { return stack.length > 1 ? stack[stack.length - 2] : null; },
    get pages() { return [...stack]; },
    push(page) { if (page && page !== this.top) stack.push(page); return this.top; },
    pop() { if (stack.length > 1) stack.pop(); return this.top; },
    reset(to = root) { stack = [to]; root = to; return this.top; },
  };
}

/** a destructive confirmation's shape: an action sheet from the bottom (narrow), a centred alert (wide) */
export const confirmShape = (layout) => (layout === 'wide' ? 'alert' : 'sheet');

/**
 * Which layer ✕ (and Escape) closes, given what is open. Top-most first: the leave dialog (Escape there
 * is Keep editing; it has no ✕), a tile up close, a tile's sheet, the kind picker, the sign-in door, a
 * settings confirmation, then settings itself. Settings sits UNDER the sheets it opens (the picker for
 * the default back, the default back's own sheet, raw content, the door), so closing one of those
 * returns to it. null: nothing is open.
 */
export const LAYER_TOP_FIRST = ['leavemodal', 'zoom', 'modal', 'picker', 'doormodal', 'set-confirm', 'settings'];
export function topLayer(open) {
  for (const id of LAYER_TOP_FIRST) if (open[id]) return id;
  return null;
}

/** does the glass's ✕ show? Whenever a layer is open, except the leave dialog (its three answers are the way out) */
export const closeShows = (open) => { const t = topLayer(open); return !!t && t !== 'leavemodal'; };

/**
 * A downward swipe on the panel's header closes it (the same as ✕). True when the finger travelled
 * down far enough, and more down than sideways.
 */
export const SWIPE_CLOSE_PX = 80;
export const swipeCloses = (dx, dy) => dy >= SWIPE_CLOSE_PX && Math.abs(dy) > Math.abs(dx) * 1.5;
