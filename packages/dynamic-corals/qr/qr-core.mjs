// QR encoder core — URL → module matrix. The ONE place a QR is computed, so every surface
// (Card cardtile, Site sitetile) renders the SAME animated popup from the same matrix instead
// of a server baking a `_qrMatrix` literal that gets re-broken each time it's carried across
// runtimes (Python → Svelte → cardtile). qrcode-generator (Kazuhiko Arase, MIT) is vendored as
// ./qrcode.js so the coral stays zero-dependency; esbuild inlines it into the bundle.
//
// version 0 = auto-fit (smallest QR that holds the URL) — robust for any length. Pass a fixed
// typeNumber (e.g. 4 → 33×33) to pin density to a known card. EC 'M' matches the live card.
// The animation reads n dynamically (_qrN = getModuleCount), so any version animates correctly.
import qrcode from './qrcode.cjs';

export function qrMatrix(url, typeNumber, ec) {
  // 🩸 THE PIN IS A PREFERENCE; CAPACITY IS A CONSTRAINT.
  //
  // `data-version=4` pins the live card's 33×33 density, and that was fine at EC M. Raising the
  // level to H (2026-07-30, for scannability) cut version 4's capacity to 288 bits — and the demo
  // card's longer URL is 412. The coral threw `code length overflow. (412>288)` on click, so the
  // avatar simply stopped opening. A pinned density silently became a hard ceiling on the URL.
  //
  // So: try the pin, and if the data does not fit, let the encoder pick the smallest version that
  // does. The preference is honoured wherever it can be, and a longer address can never again turn
  // into a dead button.
  var qr;
  try {
    qr = qrcode(typeNumber || 0, ec || 'M');
    qr.addData(String(url || ''));
    qr.make();
  } catch (e) {
    qr = qrcode(0, ec || 'M');
    qr.addData(String(url || ''));
    qr.make();
  }
  var n = qr.getModuleCount();
  var matrix = [];
  for (var r = 0; r < n; r++) {
    var row = [];
    for (var c = 0; c < n; c++) row.push(qr.isDark(r, c) ? 1 : 0);
    matrix.push(row);
  }
  return { matrix: matrix, n: n };
}
