// The Card cell FORM, live half — what happens inside an open sheet once it is on the page.
//
// 🔴 WHY THIS FILE EXISTS (2026-11-04). `w/editor.mjs` and `w2/edit2.mjs` each carried their own copy
// of the picture pickers (encodeImage, the avatar's rasterCopy, and the wiring that puts a chosen file
// into the field), line for line the same apart from comments. A third surface was about to need them.
// `cell-form-core.mjs` is the DOM-free half (the rows, composeCell); this is the half that touches the
// page. What differs between callers arrives as arguments:
//
//   root        the element the form was rendered into (formBodyHtml's output)
//   T           the editor CHROME strings (asset pick / replace / too big / unreadable)
//   previewSrc  (value) → what a picture field's thumbnail shows, for a stored or a just-chosen asset
//   stage       (id, {mime, b64}) → keep a chosen picture until the sheet is saved (or dropped)
import { esc, flatRows } from './cell-form-core.mjs';
import { rasterCopyId } from '../card-core.js';

/** live wiring inside the open sheet: picture pickers, and rows that depend on another row's value */
export function wireForm(root, def, { T, previewSrc, stage }) {
  const byId = (id) => root.ownerDocument.getElementById(id);
  for (const box of root.querySelectorAll('.ctw-asset')) {
    const id = box.dataset.for;               // "f-<name>" — the hidden input holding the saved value
    const store = byId(id);
    const file = byId(`${id}-file`);
    const urlIn = byId(`${id}-url`);
    const err = byId(`${id}-err`);
    const shot = box.querySelector('.ctw-asset-shot');
    const pickLabel = box.querySelector('.ctw-asset-pick');
    const show = (value) => {
      store.value = value;
      const src = previewSrc(value);
      shot.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
      pickLabel.firstChild.nodeValue = value ? T.assetReplace : T.assetPick;
    };
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      err.textContent = '';
      try {
        const asset = await encodeImage(f);
        if (!asset) { err.textContent = T.assetTooBig; return; }
        stage(asset.id, { mime: asset.mime, b64: asset.b64 });
        // the avatar's PNG copy for link previews and the home screen (reef#1092) — not needed when
        // the avatar already IS a PNG, and a copy that fails to draw only costs the preview its face
        if (id === 'f-avatar' && asset.mime !== 'image/png') {
          const copy = await rasterCopy(f).catch(() => null);
          if (copy) stage(rasterCopyId(asset.id), copy);
        }
        urlIn.value = '';
        show(`asset:${asset.id}`);
      } catch (e) {
        // 🔴 SAY SO, in the field, and in the console for whoever is looking. A picture that silently
        // does nothing is the same shape as the bug this whole picker replaces.
        console.warn('[cardtile] that picture could not be read —', e && e.message);
        err.textContent = T.assetUnreadable;
      } finally {
        file.value = '';
      }
    });
    urlIn.addEventListener('input', () => { if (urlIn.value.trim()) show(urlIn.value.trim()); else show(''); });
    // the two tabs: which source is on screen. Never touches the value (see controlHtml).
    for (const t of box.querySelectorAll('.ctw-asset-tab')) {
      t.addEventListener('click', () => {
        const src = t.dataset.src;
        box.dataset.src = src;
        for (const x of box.querySelectorAll('.ctw-asset-tab')) x.setAttribute('aria-selected', String(x === t));
        for (const pane of box.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== src;
        if (src === 'url') urlIn.focus();
      });
    }
  }

  // `showWhen: {target: ''}` — the address row exists only while "this opens: an address" is chosen
  for (const row of flatRows(def)) {
    if (!row.showWhen) continue;
    const [dep, want] = Object.entries(row.showWhen)[0];
    const depNode = byId(`f-${dep}`);
    const target = root.querySelector(`[data-field="${row.name}"]`);
    if (!target) continue;
    const sync = () => { target.hidden = !!depNode && String(depNode.value) !== String(want); };
    if (depNode) depNode.addEventListener('change', sync);
    sync();
  }
}

// ── pictures ─────────────────────────────────────────────────────────────────────────────────────
//
// A chosen file becomes bytes IN THE CARD (`## assets`), not an upload: that is what makes a Card one
// portable file. Downscaled and re-encoded in the browser first — a phone camera's 4 MB original
// would blow the 1.5 MB ingest budget on its own, and nobody needs 4032px on a 6-column grid.
export const ASSET_MAX_EDGE = 1600;
export const ASSET_MAX_BYTES = 1500 * 1024;
export const ASSET_QUALITIES = [0.82, 0.7, 0.55];

export async function encodeImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, ASSET_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  for (const q of ASSET_QUALITIES) {
    // 🔴 `toBlob('image/webp')` does NOT fail on a browser without webp — it quietly hands back a
    // PNG, which is several times larger and would fail the budget for the wrong reason. Read the
    // type back and fall to jpeg deliberately rather than discovering it as a size problem.
    let blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (!blob) continue;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > ASSET_MAX_BYTES) continue;
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    // content-addressed, same 16-hex shape every asset in a card already carries
    return { id: `sha256-${hex.slice(0, 16)}`, mime: blob.type, b64: btoa(bin) };
  }
  return null;
}

// The avatar's RASTER COPY (reef#1092): a 256×256 PNG of the picture the person just chose, stored
// beside the avatar as `<avatar id>.png` (card-core's rasterCopyId). It is what a link preview shows
// (og:image) and what iOS puts on a home screen (apple-touch-icon) — both want a PNG, the avatar is
// webp, and the Worker does not transcode. Drawn from the ORIGINAL file, not from the webp we just
// made, so the copy is not a second generation of lossy compression.
// Centre-cropped square (the avatar shows round, cropped the same way) on white: iOS fills a
// transparent home-screen icon with black.
// 🔴 A PNG straight off the canvas has no palette quantization, unlike the sharp path's: measured in
// Chromium on two real avatars, 15,039 B and 40,942 B where sharp's is 2,589 B and 9,210 B. Still
// 1–3% of ASSET_MAX_BYTES.
export const RASTER_COPY_EDGE = 256;

export async function rasterCopy(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RASTER_COPY_EDGE;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, RASTER_COPY_EDGE, RASTER_COPY_EDGE);
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, RASTER_COPY_EDGE, RASTER_COPY_EDGE);
  if (bmp.close) bmp.close();
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob || blob.type !== 'image/png') return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { mime: 'image/png', b64: btoa(bin) };
}
