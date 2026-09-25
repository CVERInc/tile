// The avatar's RASTER COPY, made with sharp (reef#1092). INGEST AND SCRIPTS ONLY — never the Worker:
// card-share.test.mjs walks the Worker's import graph and fails if this file, or sharp, is in it.
//
// What it is and where it lives is card-core's rasterCopyId: a PNG stored beside the avatar as
// `<avatar id>.png`, which the Worker serves as both og:image and apple-touch-icon without touching
// a pixel. This file only makes the bytes.
//
// 256×256 PNG, palette-quantized. Every number here was measured, not picked (2026-09-25, two real
// avatars read-only + two specimens):
//   · PNG, not JPEG. JPEG is 20–60% smaller, but Apple documents the home-screen icon as "an icon
//     file in PNG format" and nothing first-hand says a JPEG is accepted there. og:image takes PNG
//     everywhere, so one PNG serves both.
//   · 256, not 180. 180 is iOS's own size, but Facebook refuses a share image under 200×200.
//   · palette (libimagequant, q80): 2,589 B and 9,210 B at 256 on the two real avatars, against
//     8,715 B and 34,151 B for a full-colour PNG. A photographic worst case (noise) is ~67 KB.
//   · flattened on white, centre-cropped square: iOS paints a transparent icon's background black,
//     and the avatar is shown round, cropped the same way.
//   · first frame only — sharp's default — for an animated avatar: a share image is a still.
export const RASTER_COPY_EDGE = 256;

/** bytes of any image sharp reads → PNG bytes of the copy. `sharp` is passed in (see sharp.mjs). */
export async function rasterCopy(sharp, buf) {
  return sharp(buf)
    .rotate()
    .resize(RASTER_COPY_EDGE, RASTER_COPY_EDGE, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .png({ palette: true, quality: 80, compressionLevel: 9, effort: 10 })
    .toBuffer();
}

/** The profile cell's avatar asset id, when it is one of the card's own assets; else null. */
export function avatarAssetId(model) {
  const cell = ((model && model.cells) || []).find((c) => c && c.type === 'profile');
  const m = /^asset:(.+)$/.exec(String((cell && cell.params && cell.params.avatar) || '').trim());
  return m && model.assets && model.assets[m[1].trim()] ? m[1].trim() : null;
}
