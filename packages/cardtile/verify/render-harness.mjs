import { OUT, readCard, CSS, ICONS, QR_JS, ARROW } from './paths.mjs';
// End-to-end: a specimen → cardtile renderPage (live CSS + inlined qr.js coral) → one HTML file,
// which is what verify-qr.mjs then drives.
//
// 🩸 This rendered `specimen-plain` until 2026-08-12, and specimen-plain states NO avatar. On the
// day a profile with no `avatar=` correctly stopped emitting `<img class="cp-icon">`, this file
// began writing a page the QR coral cannot mount on — its installer is
// `querySelector('.cp-icon'); if(icon){…}` — and verify-qr timed out clicking something that was
// no longer there. The producer was green the whole time: it wrote a valid page, just not one its
// only consumer can use.
import fs from 'node:fs';
import { parseCard } from '../card-core.js';
import { renderPage } from '../card-render.mjs';

// 🔴 A specimen WITH an avatar, because the QR grows out of one. Asserted rather than assumed:
// the failure this replaces was a 30-second timeout with nothing to read.
const SPECIMEN = 'specimen-rich';
const md = readCard(SPECIMEN);
if (!/%% card: profile[^%]*\bavatar=/.test(md)) {
  throw new Error(`${SPECIMEN} states no avatar, so the page this writes has no .cp-icon for the QR coral to mount on — verify-qr.mjs would time out with nothing to read`);
}
const css = CSS();
const icons = ICONS();
const qrScriptInline = QR_JS();

const model = parseCard(md);
const name = /^title:\s*(.+)$/m.exec(md)?.[1]?.trim() || '';

const html = renderPage(model, {
  name,
  // 🩸 NEVER PASSED UNTIL 2026-08-12, and the omission was invisible for as long as a broken image
  // counted as an avatar. resolveAsset() turns `asset:sha256-…` into a data: URI by looking it up
  // in ctx.assets; with no assets it returned '' and the renderer emitted `<img class="cp-icon"
  // src="">`. verify-qr.mjs then clicked that, animated it, and passed — driving a picture that had
  // never loaded. The day a missing avatar correctly stopped emitting an <img> at all, the harness
  // finally had nothing to click, and this line is what had been missing the whole time.
  assets: model.assets,
  icons,
  css,
  arrow: ARROW(),
  cardUrl: 'https://card.example.com',
  qrScriptInline,
});

fs.writeFileSync(OUT + '/card-native-qr.html', html);
console.log('wrote card-native-qr.html', html.length, 'bytes; name=', name, '; cells=', model.cells.length);
