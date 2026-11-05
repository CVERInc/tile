// Front/back pairs in the editor's row (w3/edit3.mjs), as pure model edits on card-core's model.
//
// A face cell whose `back=#id` names a back lane is a pair; the lane holds the other side. The row
// shows both faces side by side, and the control between two adjacent tiles toggles the pairing:
//   pair    tile i takes tile i+1 as its back (i+1 leaves the face and becomes the lane's one cell)
//   unpair  the back comes out of its lane and sits right after its front again
// Pairing then unpairing is the identity on the file's cells — the round trip the tests pin.
import { normalizeCell, setToken, removeToken } from '../card-core.js';

export const withRaw = (cell, rawParams) => normalizeCell({ ...cell, rawParams });
export const backId = (cell) => String(((cell && cell.params) || {}).back || '').replace(/^#/, '');
export const freshBackId = (x) => { let n = 1; while (x.drawers.some((d) => d.id === 'b' + n)) n++; return 'b' + n; };
/** the lane a face cell turns over to, or null */
export const backOf = (x, cell) => (backId(cell) && x.drawers.find((d) => d.id === backId(cell))) || null;

// the face's block ranges, kept true when a cell comes or goes
export function insertCell(x, at, cell) {
  x.cells.splice(at, 0, cell);
  let bi = x.blocks.findIndex((b) => at >= b.start && at <= b.start + b.count); if (bi < 0) bi = x.blocks.length - 1;
  x.blocks = x.blocks.map((b, k) => (k === bi ? { ...b, count: b.count + 1 } : (b.start >= at && k > bi ? { ...b, start: b.start + 1 } : b)));
  return x;
}
export function removeCell(x, at) {
  x.cells.splice(at, 1);
  const bi = x.blocks.findIndex((b) => at >= b.start && at < b.start + b.count);
  x.blocks = x.blocks.map((b, k) => (k === bi ? { ...b, count: b.count - 1 } : (b.start > at ? { ...b, start: b.start - 1 } : b)));
  return x;
}

/** can tile i take tile i+1 as its back? Both must be plain faces (neither already has a back). */
export const canPair = (x, i) => i >= 0 && i + 1 < x.cells.length && !backOf(x, x.cells[i]) && !backOf(x, x.cells[i + 1]);
/** is tile i a pair whose back the row can show as one face (exactly one cell in the lane)? */
export const canUnpair = (x, i) => { const d = x.cells[i] && backOf(x, x.cells[i]); return !!d && d.cells.length >= 1; };

/** tile i takes tile i+1 as its back. Mutates and returns `x` (pass a clone). */
export function pair(x, i) {
  if (!canPair(x, i)) return x;
  const id = freshBackId(x), backCell = withRaw(x.cells[i + 1], removeToken(x.cells[i + 1].rawParams || '', 'back'));
  x.cells[i] = withRaw(x.cells[i], setToken(x.cells[i].rawParams || '', 'back', '#' + id));
  removeCell(x, i + 1);
  x.drawers.push({ id, title: '', cells: [backCell] });
  return x;
}

/** tile i's back leaves its lane and sits right after it again. Mutates and returns `x`. */
export function unpair(x, i) {
  if (!canUnpair(x, i)) return x;
  const d = backOf(x, x.cells[i]);
  x.cells[i] = withRaw(x.cells[i], removeToken(x.cells[i].rawParams || '', 'back'));
  x.drawers = x.drawers.filter((y) => y !== d);
  d.cells.forEach((c, k) => insertCell(x, i + 1 + k, c));
  return x;
}
