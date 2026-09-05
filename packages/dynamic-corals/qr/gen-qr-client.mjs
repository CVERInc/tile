// Generate qr-client.mjs by lifting the QR 表演 VERBATIM out of the live qr-anim.js and applying
// ONLY surgical, auditable transforms (config injection + 2 fish guards + cutting the dead owner
// edit-mode picker, which was the coral's last call back into the Heroku Python app). This keeps
// chodaict's labour-of-love animation byte-for-byte; the diff is exactly the coupling removal.
import fs from 'node:fs';

const SRC = new URL('./qr-anim.legacy.js', import.meta.url).pathname;
const OUT = new URL('./qr-client.mjs', import.meta.url).pathname;

const src = fs.readFileSync(SRC, 'utf8');

const EDIT_MARK = 'if(window._coralEditMode)';

/** String-aware brace matcher: index of the `}` closing the `{` at `open`. Boundaries get measured. */
function matchBrace(s, open) {
  let depth = 0, quote = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces from ' + open);
}

// 1. cut the QR block: from the avatar handler to the end of the IIFE body.
const startMark = "var icon=document.querySelector('.cp-icon');if(icon){";
const si = src.indexOf(startMark);
if (si < 0) throw new Error('start marker not found');
let block = src.slice(si + startMark.length, src.length - 6); // drop trailing `}})();` (if-icon + IIFE close)

// 2. strip the hardcoded config run (name/url/matrix/n) — we inject these from data-* + the encoder.
const cfgStart = src.indexOf('var _qrCoralName=');
const cfgEnd = src.indexOf('var _qrN=33;') + 'var _qrN=33;'.length;
const cfgRun = src.slice(cfgStart, cfgEnd);
if (!block.includes(cfgRun)) throw new Error('config run not inside block');
block = block.replace(cfgRun, '');

// 3. guard the two ambient-fish touch points so the coral works with NO #cp-midwater (portable).
//    Both are `return`s from the enclosing callback where the fish move is the last effect.
const g1 = 'function attract(){_attracting=true;';
if (!block.includes(g1)) throw new Error('attract anchor not found');
block = block.replace(g1, 'function attract(){if(!mw)return;_attracting=true;');

const g2 = 'var vCX=window.innerWidth/2;var vCY=window.innerHeight/2;var mr2=mw.getBoundingClientRect();';
if (!block.includes(g2)) throw new Error('open-swarm anchor not found');
block = block.replace(g2, 'if(!mw)return;' + g2);

// 4. CUT the owner edit-mode picker. It renders a mode-picker toolbar when window._coralEditMode is
//    set, and each button POSTs to `/api/update-settings` — a HEROKU PYTHON endpoint. No native card
//    ever sets _coralEditMode, so the whole branch is dead code that also happens to be the coral's
//    last umbilical to the backend we're switching off (see legacy-retirement doctrine: the test is
//    "can the old backend be switched off for this capability?" — with the picker in, the answer is no).
//
//    🔴 Nothing else goes. The 表演 — 11 modes, the morph, backCircle, overlay, focus trap — is
//    chodaict's and stays byte-for-byte. The boundary is MEASURED by brace-matching, never eyeballed
//    (a hand-guessed "the previous closing brace" has eaten the function above it before).
const editStart = block.indexOf(EDIT_MARK);
if (editStart < 0) throw new Error('edit-mode branch not found');
const editEnd = matchBrace(block, block.indexOf('{', editStart + EDIT_MARK.length - 1));
const picker = block.slice(editStart, editEnd + 1);
// the whole point of the cut: prove the Python calls were all inside it, and none survive
const posted = (picker.match(/update-settings/g) || []).length;
if (posted === 0) throw new Error('picker has no /api/update-settings — wrong boundary?');
block = block.slice(0, editStart) + block.slice(editEnd + 1);
if (block.includes('update-settings')) throw new Error('a Heroku POST survived the cut');
if (block.includes('site_01KWXZGR6MAMH6ZD149FQSQ4GP')) throw new Error('baked guild_id survived the cut');

// 5. the picker was the only reader of these three; a declaration nobody reads is the next
//    generation's puzzle. Each is dropped only after proving zero remaining references.
for (const decl of ["var _qrSetting='G';", 'var _qrLabelOff="\\u95dc\\u9589";', 'var _qrLabelRandom="\\u96a8\\u6a5f";']) {
  if (!block.includes(decl)) throw new Error('dead decl not found: ' + decl);
  const name = /var (\w+)/.exec(decl)[1];
  const uses = (block.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
  if (uses !== 1) throw new Error(name + ' still has ' + (uses - 1) + ' reader(s) — not dead');
  block = block.replace(decl, '');
}

// 6. the OPENING KEYFRAME reads the avatar instead of a baked-in 80px.
//
//    chodaict: 「qr動畫因為大頭貼換大顆了,所以qr動畫的起始關鍵影格的大頭貼尺寸也應該跟大頭貼一樣?」
//    Yes. The animation grows OUT of the avatar, so its first frame encodes the avatar's size — and
//    that size was written when the avatar was a hard-coded 78px. It is `23.6cqw` now (7865fd9): still
//    78px on a phone, 152px on a desktop card. So on anything wider than a phone the avatar visibly
//    SNAPPED to 80px the instant you tapped it, before the morph even started.
//
//    🔴 This is geometry, not choreography. The 11 modes, the morph, the timings, the easing — none of
//    it is touched. `iconRect` is already measured two statements above for the group's own box, so
//    this reads a value the code had in hand and threw away. Fixing it by pinning a second constant
//    (80 → 152) would just move the bug to the next viewport; the point is that there is no constant.
const K_ICON = "icon.style.width='80px';icon.style.height='80px';";
if ((block.match(new RegExp(K_ICON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) {
  throw new Error('opening-keyframe icon size: expected exactly one anchor');
}
block = block.replace(K_ICON, "icon.style.width=iconRect.width+'px';icon.style.height=iconRect.height+'px';");

//    The circle behind it kept the ratio it always had: 100px around an 80px avatar = 1.25.
const K_CIRCLE = "_backCircle.style.cssText='position:absolute;top:50%;left:50%;width:100px;height:100px;";
if (!block.includes(K_CIRCLE)) throw new Error('backCircle anchor not found');
block = block.replace(K_CIRCLE,
  "var _bcD=Math.round(iconRect.width*1.25);_backCircle.style.cssText='position:absolute;top:50%;left:50%;width:'+_bcD+'px;height:'+_bcD+'px;");
if (/width:100px;height:100px/.test(block)) throw new Error('a baked 100px circle survived');
if (/icon\.style\.width='80px'/.test(block)) throw new Error('a baked 80px avatar survived');

// 7. the DAMAGE RATIO over the QR is locked, because a QR code is not a picture.
//
//    chodaict: 「大頭貼飛出來遮住QR的『比例』必須鎖定,外面大沒關係,飛出來後要不是讓QR更大
//    (桌機/平板還有空間),不然就是在手機上要讓大頭貼變小以符合破壞比例」.
//
//    A QR's error correction recovers a bounded fraction of its codewords — L 7%, M 15%, Q 25%,
//    H 30% — and anything sitting on the code is deliberate damage. 🔴 qr-core.mjs encodes at **M**,
//    so the ceiling is 15%, not the 30% that H would give. We spend 10% of it: the occlusion is one
//    CONTIGUOUS block, which is harder on the decoder than the same number of scattered errors.
//
//    🔴 Transform 6 caused this. Making the opening frame read the real avatar was right, but the
//    icon then KEPT that size for the whole flight — so on a desktop card a 152px avatar landed on a
//    280px QR and covered 23.3%, against a 15% budget. On a phone it was 6.5% and fine, which is why
//    only the wide case was broken. Measured before and after.
//
//    🔴 And the thing that actually covers the code is the BACK CIRCLE, not the avatar: it is an
//    opaque `--cp-ground` disc at z-index 1 with the QR card behind it at -1, and it is 1.25× the
//    avatar. Capping the avatar and leaving the disc alone would have measured "fixed" while the
//    real occluder stayed oversized.
//
//    Both of chodaict's branches, in his order: grow the QR where there is room (desktop and tablet
//    have it), and only shrink the avatar when there is not (a phone).
const K_RECT = "var iconRect=icon.getBoundingClientRect();";
if ((block.match(/var iconRect=icon\.getBoundingClientRect\(\);/g) || []).length !== 1) {
  throw new Error('iconRect anchor: expected exactly one');
}
// 🔴 THE MODE THAT OPENS MUST SCAN. Was 'G' (matrix rain) — every visitor got it on the first
// open, and chodaict measured real phones failing on it. The eleven modes are NOT equal:
//
//   I, K  `_hideAll()` then reveal — most of the cycle is not a QR at all
//   A, J  dim EVERY (or every other) cell to 20% opacity — a contrast collapse, worst for a weak lens
//   F     removes cells and restores after 5s — damage accumulates along the path
//   G     whole columns with tails (the old default)
//   B,C,H one row / ring / column, restored in ~100ms
//   D     one cell plus its neighbours, restored in ~2s
//
// 🔴 C — SONAR. chodaict's own original default, and he said why: 「它最搭彈跳出來的動畫」. The card
// pops open from the avatar's centre and the sonar ring expands from the same point, so the QR
// finishes the gesture the overlay started. I had picked D on damage alone and would have thrown
// that away; C is in the same light band (one ring, 0.85 mask, restored in 80ms) — so his design
// reason costs nothing and there was never a trade to make.
//
// Every other mode is one tap away on reroll. Nobody's animation is changed, removed, or slowed —
// only which one greets you.
{
  const K_MODE = "var _activeMode='G';";
  const n = (block.match(/var _activeMode='G';/g) || []).length;
  if (n !== 1) throw new Error(`default mode anchor: expected exactly one, found ${n}`);
  block = block.replace(K_MODE, "var _activeMode='C';");
  if (block.includes("var _activeMode='G';")) throw new Error("the old default survived");
}

block = block.replace(K_RECT, K_RECT
  // 🩸 WAS 0.10, and that was the whole error-correction budget minus a rounding error.
  //
  // EC level M recovers 15% of the code's area. The disc took 10 of that 15 — leaving 5 points for
  // ELEVEN animations that also remove cells, from the same budget. The constant was computed as if
  // the occluder were the only damage, and the animations spend from the same pool.
  //
  // Measured by chodaict on the live card 2026-07-30: the 190px disc fails to scan under some of the
  // modes; 160px reads. Area scales with d², so 0.10 × (160/190)² = 0.0709 — and 0.07 leaves the
  // animations 8 points of headroom instead of 5, a 60% larger margin for the thing that was
  // actually breaking it.
  //
  // 🔴 NOT ONE CHARACTER OF THE ELEVEN ANIMATIONS IS TOUCHED. This is the sizing constant only.
  + 'var _QR_DAMAGE=0.05;'                                        // of the code's area (EC M gives 15% — the animations spend from it too)
  + 'var _QR_RATIO=Math.sqrt(_QR_DAMAGE*4/Math.PI);'              // occluder DIAMETER ÷ QR side ≈ .357
  + 'var _qrOcclWant=iconRect.width*1.25;'                        // the back circle is the occluder
  + 'var _qrRoom=Math.min(window.innerWidth,window.innerHeight)-160;'   // leave the name/url labels room
  + 'var _qrSide=Math.max(280,Math.min(Math.ceil(_qrOcclWant/_QR_RATIO),_qrRoom));'
  + 'var _qrOccl=Math.min(_qrOcclWant,Math.floor(_qrSide*_QR_RATIO));'
  + 'var _qrIcon=Math.round(_qrOccl/1.25);');

const K_SZ = 'var sz=312;';
if (!block.includes(K_SZ)) throw new Error('sz anchor not found');
block = block.replace(K_SZ,
  'var sz=_qrSide+32;'
  + 'var _qrGrid=qrCard.querySelector(".qr-grid");'
  + 'if(_qrGrid){_qrGrid.style.width=_qrSide+"px";_qrGrid.style.height=_qrSide+"px"}'
  // the avatar and its disc settle to the safe size on the way in, on the card's own timing
  + 'icon.style.transition="width .4s ease,height .4s ease";'
  + 'icon.style.width=_qrIcon+"px";icon.style.height=_qrIcon+"px";'
  + 'if(_backCircle){_backCircle.style.width=_qrOccl+"px";_backCircle.style.height=_qrOccl+"px"}');
if (block.includes('var sz=312')) throw new Error('the fixed 312 survived');

// 8. the ACCENT is the host card's, never the one it was lifted from.
//
//    chodaict, looking at another creator's card: 「qr 裡沒有完全照 accent 顏色,其中幾個混到紫色(顯然是
//    〔那張卡〕的殘留)」. Correct. `#b890e8` is that card's accent, and in the source it WAS the
//    right answer — the file only ever ran on one card. Transforms 1–2 parameterised the matrix and
//    the URL and left the colour behind, so every card's QR painted some cells in another tenant's
//    brand colour. Not a data leak; on a multi-tenant platform it is still one creator's identity
//    turning up on another's page.
//
//    🔴 Only the `cl.style.background=` assignments, and only the ones that survive the picker cut.
//    The legacy file has 20 mentions of the literal; 14 of them are inside the edit-mode toolbar
//    (button chrome), which transform 4 already removed. Asserting the count BEFORE and the absence
//    AFTER is what distinguishes "I replaced the six that matter" from "I replaced whatever matched".
//
//    The replacement is a var(), not a re-baked hex, and it is the same expression `_unmask` already
//    uses two lines away — so this makes the two paths agree rather than inventing a mechanism.
//
//    🔴 Colour only. The 11 modes, the morph and every timing are untouched — same category as the
//    geometry in 6 and 7, both of which chodaict also asked for by name.
const K_HEX = "cl.style.background='#b890e8'";
const hexUses = (block.match(/cl\.style\.background='#b890e8'/g) || []).length;
if (hexUses !== 6) throw new Error('accent literal: expected 6 assignments, found ' + hexUses);
if ((block.match(/#b890e8/g) || []).length !== 6) throw new Error('a non-assignment #b890e8 survived the picker cut — look at it before replacing');
block = block.split(K_HEX).join("cl.style.background='var(--cp-accent)'");
if (block.includes('b890e8')) throw new Error("the lifted card's accent survived");

const out = `// REEF with Card — QR dynamic coral, CLIENT (built by build.mjs into qr.js; do not edit qr.js).
//
// 🔴 The avatar-morph QR popup is chodaict's 心血 — it was born in Python, carried to Svelte, and
// was about to be re-hand-carried into cardtile (每搬一次就可能壞). Making it a coral gives it ONE
// home: the popup 表演 below is lifted VERBATIM from the live qr-anim.js; the only edits are (a) the
// _qrMatrix is now COMPUTED (qr-core, so any URL works) instead of a server-baked literal, (b) the
// two ambient-fish (#cp-midwater) touch points are guarded so the coral runs on ANY host — a bare
// Site keeps the full popup, a card that has swimmers still gets the fish swarm, nothing lost,
// and (c) the owner edit-mode picker is gone: dead on every native card, and every one of its
// buttons POSTed to the Heroku Python app we are switching off.
// See dynamic-corals/qr/GEN.md for the exact transform. Regenerate: node packages/dynamic-corals/qr/gen-qr-client.mjs
//
// Mount: <div data-dynamic-coral="qr" data-url="…" data-name="…" [data-version]> with
// a <img class="cp-icon"> inside. Framework-agnostic (sitetile embed OR cardtile Svelte wrapper).
import { qrMatrix } from './qr-core.mjs';

(function () {
  var roots = document.querySelectorAll('[data-dynamic-coral="qr"]');
  if (!roots.length) return;

  Array.prototype.forEach.call(roots, function (root) {
    var icon = root.querySelector('.cp-icon');
    if (!icon) return;

    // config from the mount (was baked into the page by the Python server)
    var _qrCoralName = root.getAttribute('data-name') || '';
    var _qrCoralUrl = root.getAttribute('data-url') || '';
    var _qrVersion = parseInt(root.getAttribute('data-version') || '0', 10) || 0;

    // the matrix — COMPUTED, not shipped (this is the re-break fix)
    //
    // EC level H (30%) — M(15%) → Q(25%) → H, each step taken because real phones still failed. Measured 2026-07-30 after chodaict reported a real-device
    // failure: some weaker phones could not scan DURING the animations. A signal from actual
    // hardware beats the arithmetic that said 0.07 was enough.
    //
    // Q is free where it matters. A creator's own short domain is 25x25 modules at BOTH M and Q, so
    // it pays nothing in density and gains 10 points of recovery. H would be 29x29 — a 16% density
    // hit on exactly the cards people actually scan. Only long demo URLs grow (33 to 37).
    //
    // What it buys: the occluding disc takes 7 points; the ELEVEN animations remove cells from the
    // same pool and now have 18 points instead of 8. 2.25x the headroom, and not one character of
    // the animations is touched.
    var _q = qrMatrix(_qrCoralUrl, _qrVersion, 'H');
    var _qrMatrix = _q.matrix, _qrN = _q.n;

    // optional ambient fish: present on cards that carry #cp-midwater .swimmer, absent elsewhere.
    // Guarded below so an empty swarm is a no-op and the QR popup runs regardless.
    var mw = document.getElementById('cp-midwater');
    var all = mw ? Array.prototype.slice.call(mw.querySelectorAll('.swimmer')) : [];

    // ===== BEGIN verbatim QR 表演 (from qr-anim.js; fish guarded, matrix injected) =====
    ${block}
    // ===== END verbatim QR 表演 =====
  });
})();
`;

fs.writeFileSync(OUT, out);
console.log('wrote', OUT, '(', out.length, 'bytes; edit-mode picker cut:', picker.length,
            'bytes containing', posted, 'Heroku POST(s) )');
