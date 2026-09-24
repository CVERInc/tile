// HOST MODE — the Card editor embedded by feelreef to edit a REAL card. Pure: no DOM, no window;
// the caller hands in `post` (a postMessage bound to the parent + opts.host) and timers.
//
// 🔴 THE EDITOR HOLDS NO CREDENTIAL. Owner architecture: reef decides who may edit (seats in its
// registry), the cardtile Worker owns storage/assembly, and the browser never holds a bearer. So in
// host mode this document speaks ONLY to its parent window, and only to the one origin the Worker
// wrote into `opts.host` — every message it sends names that origin (never `*`), and every message
// it accepts must come from it.
//
// Message schema (v: 1), fixed with the reef side:
//   iframe → parent  { type:'card:ready', v }
//   parent → iframe  { type:'card:load', v, md, handle, cardUrl, locale?, version? }
//   iframe → parent  { type:'card:load-failed', v, message }
//   iframe → parent  { type:'card:change', v, md, dirty:true }     (debounced 150ms)
//   iframe → parent  { type:'card:save', v, md }
//   parent → iframe  { type:'card:saved', v, version } | { type:'card:save-failed', v, message }
//
// 🔴 `md` IS THE FAT CARD — exactly the editor's S.md, `## assets` lane included, byte-for-byte what
// the sandbox parks. A picture chosen in a sheet is encoded into that lane by edit2.mjs's
// encodeImage() → saveCell() (`m.assets = { ...m.assets, ...staged }` → serializeCard). NOTE for the
// parent: save_card's assembleSave() (card-save.mjs) DISCARDS an incoming lane and re-attaches only
// the stored one, so the parent splits: put_asset for new ids, then save_card the thin card.
// `splitCard()` below is that split, exported for whoever wants it; the bridge does not apply it.
import { parseCard, serializeCard } from '../card-core.js';
import { referencedAssets } from '../card-save.mjs';

export const HOST_V = 1;
export const CHANGE_DEBOUNCE_MS = 150;
/** `card:ready` is re-announced this often until the first `card:load` … */
export const READY_EVERY_MS = 500;
/** … for at most this long. After that the status stays 'waiting' — visible, never silent. */
export const READY_GIVE_UP_MS = 60000;

/**
 * The parent origins the Worker will serve host mode for, or null. Exact origins only: production,
 * staging, and any localhost port over http for development.
 */
export function validHostOrigin(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  // an ORIGIN, not a URL: nothing after the port, no credentials
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  if (raw.replace(/\/$/, '') !== u.origin) return null;
  if (u.origin === 'https://feelreef.com' || u.origin === 'https://staging.feelreef.com') return u.origin;
  if (u.protocol === 'http:' && u.hostname === 'localhost') return u.origin;
  return null;
}

/** a fat card → { md: thin, assets: referenced lane entries }. Also accepts an already-thin card. */
export function splitCard(md) {
  const model = parseCard(String(md ?? ''));
  const thin = serializeCard({ ...model, assets: {} });
  const refs = referencedAssets(thin);
  const assets = {};
  for (const [id, a] of Object.entries(model.assets || {})) if (refs.has(id)) assets[id] = { mime: a.mime, b64: a.b64 };
  return { md: thin, assets };
}

/** does this text read as a card? The same test /try/park applies: it parses, and it has cells. */
export function readsAsCard(md) {
  if (typeof md !== 'string' || !md) return false;
  try { return parseCard(md).cells.length > 0; } catch { return false; }
}

/**
 * The bridge's state machine. `status` is one of:
 *   'waiting' — announcing card:ready, no card:load yet (and, after READY_GIVE_UP_MS, given up)
 *   'idle'    — loaded and untouched
 *   'unsaved' — a committed change the parent has not saved
 *   'saving'  — a card:save is out, waiting for card:saved / card:save-failed
 *   'saved'   — the parent said it is stored, and nothing has changed since
 *   'failed'  — the parent refused; `message` is its words, shown verbatim
 */
export function createHostBridge({
  host, post, onLoad, onStatus = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, debounceMs = CHANGE_DEBOUNCE_MS,
  readyEveryMs = READY_EVERY_MS, readyGiveUpMs = READY_GIVE_UP_MS,
}) {
  if (!validHostOrigin(host)) throw new Error('host-bridge: host must be an allowed origin');
  const st = { status: 'idle', message: '', loaded: false, savedMd: null, pendingMd: null, current: null, timer: null, readyTimer: null, readyStarted: 0, gaveUp: false };
  const send = (msg) => post({ v: HOST_V, ...msg }, host);
  const setStatus = (status, message = '') => { st.status = status; st.message = message; onStatus(status, message); };
  const dirty = () => st.loaded && st.current !== st.savedMd;

  function flushChange() {
    st.timer = null;
    if (st.current == null) return;
    send({ type: 'card:change', md: st.current, dirty: true });
  }

  return {
    get status() { return st.status; },
    get message() { return st.message; },
    get loaded() { return st.loaded; },
    get dirty() { return dirty(); },

    get gaveUp() { return st.gaveUp; },

    /**
     * Announce `card:ready`, and KEEP announcing every readyEveryMs until the first card:load.
     * 🩸 A one-shot ready was lost in production: the parent (a SvelteKit page) attaches its message
     * listener after hydration, and with a large inline payload the iframe was ready first — the
     * announcement went to nobody, no load was ever sent, and the editor sat there. The message is
     * identical every time, so the parent may answer any one of them (a second load just reloads).
     */
    ready() {
      if (st.loaded) return;
      st.readyStarted = 0;
      st.gaveUp = false;
      setStatus('waiting');
      const tick = (elapsed) => {
        st.readyTimer = null;
        if (st.loaded) return;
        send({ type: 'card:ready' });
        if (elapsed + readyEveryMs >= readyGiveUpMs) { st.gaveUp = true; setStatus('waiting'); return; }
        st.readyTimer = setTimer(() => tick(elapsed + readyEveryMs), readyEveryMs);
      };
      tick(0);
    },

    /** a MessageEvent (or anything shaped like one). Returns true when it was ours and handled. */
    receive(event) {
      if (!event || event.origin !== host) return false;
      const d = event.data;
      if (!d || typeof d !== 'object' || d.v !== HOST_V || typeof d.type !== 'string') return false;
      if (d.type === 'card:load') {
        if (!readsAsCard(d.md)) {
          send({ type: 'card:load-failed', message: typeof d.md === 'string' ? 'That does not read as a card.' : 'card:load needs `md` as a string.' });
          return true;
        }
        if (st.timer) { clearTimer(st.timer); st.timer = null; }
        if (st.readyTimer) { clearTimer(st.readyTimer); st.readyTimer = null; }
        st.loaded = true;
        st.current = d.md;
        st.savedMd = d.md;
        onLoad({ md: d.md, handle: typeof d.handle === 'string' ? d.handle : '', cardUrl: typeof d.cardUrl === 'string' ? d.cardUrl : '', locale: d.locale, version: d.version });
        setStatus('idle');
        return true;
      }
      if (d.type === 'card:saved' || d.type === 'card:save-failed') {
        if (st.status !== 'saving') return true;           // a stale answer to nothing we asked
        if (d.type === 'card:saved') {
          st.savedMd = st.pendingMd;
          st.pendingMd = null;
          setStatus(dirty() ? 'unsaved' : 'saved');
        } else {
          st.pendingMd = null;
          setStatus('failed', typeof d.message === 'string' ? d.message : '');
        }
        return true;
      }
      return false;
    },

    /** every committed change from the editor. Ignored until the parent has loaded a card. */
    changed(md) {
      if (!st.loaded || md === st.current) return;
      st.current = md;
      if (st.status !== 'saving') setStatus(dirty() ? 'unsaved' : 'saved');
      if (st.timer) clearTimer(st.timer);
      st.timer = setTimer(flushChange, debounceMs);
    },

    /** Save pressed (or Cmd/Ctrl+S). Returns false when there is nothing to do. */
    save() {
      if (!st.loaded || st.status === 'saving') return false;
      if (st.timer) { clearTimer(st.timer); flushChange(); }
      st.pendingMd = st.current;
      setStatus('saving');
      send({ type: 'card:save', md: st.current });
      return true;
    },
  };
}
