// What the sandbox (`/try/edit`) opens on, read from this browser's storage. Pure: edit3.mjs hands
// it a getter over localStorage, removes the keys it is told to clear, and opens what it is given.
//
// tile#296. The sandbox starts from an empty card, but a browser that used it before that kept the
// old sample persona under one of two keys — the previous editor's draft key (w2 wrote the sample
// there on load) or the saved key (the first-day w3 wrote it there on Save). Either one opened the
// sample again.
//
// 🔴 ONE-SIDED. Only what card-blank.mjs `isSandboxSample` recognises — the starter exactly as it was
// seeded, in any locale — counts as nothing saved, and only a key holding THAT is cleared. Anything
// the visitor changed is their work: it opens, byte for byte, and its key is never touched.
import { readsAsCard } from './host-bridge.mjs';
import { isSandboxSample } from '../card-blank.mjs';

export const SAVED_KEY = 'cardtile:w3:saved';
export const DRAFT_KEY = 'cardtile:w3:draft';
export const W2_DRAFT_KEY = 'cardtile:try:draft:v1';   // the previous sandbox kept every edit here, unasked

/** get: key → string | null. → { saved, draft, clear } — saved/draft null mean "nothing stored";
 *  clear lists the keys that held only the untouched sample, for the caller to remove. */
export function sandboxStart(get) {
  const clear = [];
  const stale = (key, v) => { if (v != null && isSandboxSample(v)) { clear.push(key); return true; } return false; };
  let saved = get(SAVED_KEY);
  if (stale(SAVED_KEY, saved)) saved = null;
  if (saved == null) {
    // a visitor who used the previous sandbox finds their card again, as the thing they last kept
    const w2 = get(W2_DRAFT_KEY);
    if (w2 && readsAsCard(w2) && !stale(W2_DRAFT_KEY, w2)) saved = w2;
  }
  let draft = get(DRAFT_KEY);
  if (stale(DRAFT_KEY, draft)) draft = null;
  return { saved, draft, clear };
}
