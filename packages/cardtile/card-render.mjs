// cardtile production renderer (Wave ③④): card model → HTML that reuses the
// live card visual language (cp-* / sc-coral-* classes). Emits the
// SAME structure the proven live CSS expects, so a card renders pixel-faithful
// from cardtile-md — the native replacement for the Python `_build_coral_profile_html`.
//
// Schema (params carry structure + short values, body carries the prose):
//   profile : params avatar chips           · body = tagline (markdown)   · name = frontmatter title
//   feature : params img href title cta      · body = eyebrow
//   link    : params icon sub                · body = [label](url)
//   text    : body = markdown
// A block heading is a LANE (`## English`), not a cell — see card-core's parseCard.
// packGrid gives each cell its w×h → data-span="{w}x{h}". 防醜 (no overlap) is card-core's.
import { packGrid } from './card-core.js';
import { resolveBackdropDim, themeCss } from './colour.mjs';
// posterPath only — the renderer emits the path, the Worker serves it, and one definition keeps them
// from drifting apart into a 404 nobody notices until a poster silently stops appearing.
import { posterPath } from './yt.mjs';
// brand marks come from OUR origin now — see marks.mjs for why, and for the open-proxy guard
import { iconPath } from './marks.mjs';
// The drawer coral's own stylesheet. It arrives with the DOCUMENT, not from the coral's script,
// because a `:target` drawer must open for a reader whose JavaScript never runs.
import { DRAWER_CSS } from '../dynamic-corals/drawer/drawer-style.mjs';
import { escHtml } from '../cssmd/cssmd.js';

// Escaping is the family's — `escHtml` from tile's cssmd, vendored here — plus `"`. The extra quote
// is not a dialect difference: cssmd escapes text CONTENT, while this renderer also splices values
// into ATTRIBUTES (`src="…"`), where an unescaped quote is an injection, not a typo. Same function
// underneath, one documented addition, no second implementation of the escape table.
const esc = (s) => escHtml(s == null ? '' : s).replace(/"/g, '&quot;');

// ── the card's inline markdown, and why it is NOT cssmd's ──────────────────────────────────────
// tile's `renderInlineMd` is the EDITOR dialect: it keeps the raw markers in the DOM inside hidden
// `<prefix>-mk` spans so an editor's getText() round-trips exactly, and it wraps content in
// `<prefix>-b` / `<prefix>-i` rather than <strong> / <em>. That is right for a text box and wrong
// for a published page — a reader's screen reader hears emphasis from <strong>, not from a class.
// cssmd also has no links at all, and links are most of what a card's prose is for.
//
// So the grammar is shared and the OUTPUT is not: the same three marks mean the same three things
// in a Card as in tugtile (`**b**`, `*i*`, `` `code` ``), and the Card adds links on top. That is a
// SUPERSET, and md-dialect-conformance.test.mjs pins it — if tile's grammar ever changes which
// spans count as bold, the test fails here rather than the two quietly drifting apart.
//
// ⬆ UPSTREAM ASK (not a private extension): links belong in cssmd, so every host renders
// `[label](url)` the same way. Until that lands in CVERInc/tile, the Card's superset is documented
// and tested rather than silent.
const mdInline = (s) => esc(s)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  // 🔴 A newline in an INLINE context is a line break the author typed on purpose — HTML collapses
  // it, so a three-line tagline rendered as one run. There is nowhere else a newline can reach
  // mdInline (a link label, a chip and a cell title are all single-line by the format's grammar), so
  // this means exactly one thing wherever it fires.
  .replace(/\n/g, '<br>');

// Block markdown for prose cells: paragraphs, list items, inline links/bold/italic. Deliberately
// small — a Card carries a creator's words, not a document format. HTML in the source is escaped by
// mdInline, so imported rich text must arrive as markdown (the substrate stays markdown, always).
// ── the handful of strings the RENDERER contributes ──────────────────────────────────────────────
//
// 🩸 These five were hardcoded in Chinese and shipped to every card in every language. A creator
// writing an English card had a screen reader announce 「顯示 QR code」 to their readers; found on a
// live customer's page on 2026-08-13 by chodaict reading the source. Everything else on a card is
// the author's own words — these are the only strings we put in their mouth, which is exactly why
// they must follow the card rather than the person who wrote the renderer.
//
// 🔴 NOT "translate them to English". That would move the problem to the Chinese cards instead of
// solving it. The card already declares `lang:` and the renderer already validates it; these follow
// it, and fall back to English for anything the table has not got — an unlabelled control is worse
// than one labelled in the wrong language, so the fallback is never empty.
//
// The four locales are the ones the family's i18n already ships (i18n/{en-US,ja-JP,ko-KR,zh-TW}).
// Keyed by PRIMARY SUBTAG, so zh-TW and zh-Hant both land on zh.
// `linkUnset`/`imgUnset` are EDIT-MODE ONLY (see `ctx.editIndex`): the words on the outline that
// stands in for a tile whose address or picture is not filled in yet. They never reach a live card —
// a live card renders nothing at all in that case — which is why they live here, in this file's own
// four-language table, rather than growing the rendered-card vocabulary.
const LABELS = {
  en: { prev: 'Previous', next: 'Next', slide: (n) => `Slide ${n}`, close: 'Close', qr: 'Show QR code', linkUnset: 'No address yet', imgUnset: '+ Add a picture' },
  zh: { prev: '上一張', next: '下一張', slide: (n) => `第 ${n} 張`, close: '關閉', qr: '顯示 QR code', linkUnset: '還沒填網址', imgUnset: '＋ 加一張圖片' },
  ja: { prev: '前へ', next: '次へ', slide: (n) => `${n} 枚目`, close: '閉じる', qr: 'QR コードを表示', linkUnset: 'URL がまだです', imgUnset: '＋ 画像を追加' },
  ko: { prev: '이전', next: '다음', slide: (n) => `${n}번째`, close: '닫기', qr: 'QR 코드 보기', linkUnset: '주소가 아직 없어요', imgUnset: '＋ 사진 추가' },
};

/**
 * label(ctx, key, …args) → the string in the CARD's language, English when we have nothing.
 *
 * 🔴 `ctx.editStrings` wins when present, and only cardtile-w sets it. This table speaks four
 * languages on purpose (rendered-card chrome); the editor speaks the console's nine. Rather than
 * widening a table whose scope is deliberately narrow — or letting a German visitor read English
 * placeholders on their own card — the caller that HAS the nine hands its own two strings in.
 */
function label(ctx, key, ...args) {
  const override = ctx && ctx.editStrings && ctx.editStrings[key];
  if (typeof override === 'string' && override) return override;
  const primary = String((ctx && ctx.lang) || '').trim().toLowerCase().split(/[-_]/)[0];
  const table = LABELS[primary] || LABELS.en;
  const v = table[key] !== undefined ? table[key] : LABELS.en[key];
  return typeof v === 'function' ? v(...args) : v;
}

const mdBlock = (s) => String(s || '').split(/\n{2,}/).map((para) => {
  const lines = para.split('\n').filter((l) => l.trim());
  if (!lines.length) return '';
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return '<ul>' + lines.map((l) => `<li>${mdInline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
  }
  // a rule: `---`/`***`/`___` on its own line. Without this the ingest carried a creator's section
  // break across as four literal hyphens sitting in the middle of their About text.
  if (lines.length === 1 && /^\s*([-*_])\1{2,}\s*$/.test(lines[0])) return '<hr>';
  const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) return `<h${h[1].length + 2}>${mdInline(h[2])}</h${h[1].length + 2}>`;
  return `<p>${lines.map(mdInline).join('<br>')}</p>`;
}).join('');
// A cell body → the label and the address of one link.
//
// 🩸 The `else` used to be `{ label: body, url: '#' }`, and that single `'#'` was the most expensive
// character in the file. The most natural thing a first-time visitor does — paste a bare URL into a
// field called 「連結」 — produced a full-width button whose text was the raw address and whose
// href was `#`: it opened a new tab onto the same page. Six locales, six times, every time.
//
// Two changes, and neither of them guesses. A body that IS an address is read as one (the label
// falls back to the host, which is what a person would have typed anyway); a body that is neither a
// markdown link nor an address yields url `''`, and the caller declines to draw a button rather than
// drawing a dead one. `'#'` is a MEANINGFUL value elsewhere in this file (a drawer target), which is
// precisely why it must never also be the value for "there was nothing here".
const BARE_URL_RE = /^(?:https?:\/\/|mailto:|tel:)\S+$/i;
const hostLabel = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
};
const linkOf = (body) => {
  const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(body || '');
  if (m) return { label: m[1], url: m[2] };
  const bare = (body || '').trim();
  if (BARE_URL_RE.test(bare)) return { label: hostLabel(bare), url: bare };
  return { label: bare, url: '' };
};

// 🔴 A url going into a <style> BLOCK needs CSS escaping, not HTML escaping. `esc()` turns `&` into
// `&amp;`, which an HTML *attribute* decodes back but a <style> element does NOT — it is raw text.
// That silently broke every backdrop whose url carried a query string (`?alt=media&token=…`), which
// is every Firebase-hosted image. Also refuses quotes/parens/backslashes and anything that could
// close the style element early, so a url can never break out into markup.
const cssUrl = (u) => String(u == null ? '' : u).replace(/[\\'"()\s]/g, encodeURIComponent).replace(/<\/?/g, '');

// `fallbacks` are tried in order if the first icon fails to load — a 404 otherwise leaves a broken
// image slot on a creator's card, which is worse than no icon at all. Inline onerror rather than a
// script: it has to work on the very first paint, and it is three tokens of behaviour, not a client.
// `asset:<id>` → the bytes that live in the card's own `## assets` lane, as a data: URI. A card that
// carries its images is a card a creator can take with them; resolving happens here, at render, so
// nothing upstream ever has to think about storage. An unresolvable reference yields '' rather than
// a broken URL — a missing picture beats a request to somewhere that does not exist.
const ASSET_RE = /^asset:(.+)$/;
function resolveAsset(url, ctx) {
  const m = ASSET_RE.exec(String(url || '').trim());
  if (!m) return url;
  const a = ctx.assets && ctx.assets[m[1].trim()];
  return a ? `data:${a.mime};base64,${a.b64}` : '';
}

/**
 * 🔴 The SOCIAL row needs a different ending than a link row.
 *
 * `IMG_ICON`'s last resort is `display:none` on the IMG — correct inside a link row, where the label
 * sits beside it and losing the mark costs nothing. In the social row the mark IS the whole button,
 * and `.st-social-btn` is a 40px circle with a border and a background: hiding the img leaves a
 * hollow ring. Measured on a real card (PeachyBoys, 2026-07-30, shope.ee): one empty circle in the
 * middle of the row, which reads as broken in a way a missing icon never does.
 *
 * Hiding the whole button is not the answer either — the creator put that link there. So the chain
 * ends in a DRAWN glyph: the button keeps its shape, the link keeps working, and nothing on the card
 * is a hole. It ships in the markup and stays hidden until the img gives up, so it costs no request
 * and needs no JS beyond the one line already in `onerror`.
 */
const SOCIAL_FALLBACK = '<svg class="st-social-bare" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>';

const IMG_ICON = (src, fallbacks = [], extraClass = '') => {
  // The remaining candidates ride on the element, so the handler can be walked N times rather than
  // once — a two-step chain that silently stops after one step is the same shape of "gate you never
  // saw fail" as everything else here. When they run out, the icon hides: a broken image slot on a
  // creator's card is worse than no icon.
  const rest = fallbacks.map((d) => iconPath(d));
  const attr = rest.length ? ` data-iconfallback="${esc(rest.join(' '))}"` : '';
  const onerr = 'var f=(this.dataset.iconfallback||"").split(" ").filter(Boolean);'
    + 'if(f.length){this.dataset.iconfallback=f.slice(1).join(" ");this.src=f[0]}'
    + 'else{this.onerror=null;this.style.display="none"}';
  return `<img class="st-cell-icon-img${extraClass ? ' ' + extraClass : ''}" src="${esc(src)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer"${attr} onerror='${esc(onerr)}'>`;
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Which domain owns the mark a favicon service will have. Two rules, both fixing a whole CLASS of
// missing icon rather than one card's link — `iconhost=` stays for an author pointing DELIBERATELY
// somewhere else (a bit.ly whose real destination is webtoons.com), not for patching our lookup:
//   1. renamed sites keep their old domain in a creator's links long after the mark moved
//   2. a subdomain rarely has its own favicon; the site's does
const ICON_ALIAS = { 'twitter.com': 'x.com', 'fb.com': 'facebook.com', 'goo.gl': 'google.com', 'youtu.be': 'youtube.com' };
/** host → the domains worth trying, best first. */
function iconDomains(host) {
  if (!host) return [];
  const out = [ICON_ALIAS[host] || host];
  const parts = host.split('.');
  // sub.example.com → example.com. Two labels is already the registrable name for the common
  // cases here; a longer public suffix (co.uk) would just mean one wasted fallback, never a wrong icon.
  if (parts.length > 2) out.push(parts.slice(-2).join('.'));
  return [...new Set(out)];
}

// link icon priority: explicit image (iconimg=) → named SVG (icon=) → a favicon AUTO-DERIVED from the
// link's domain (or iconhost=). The derive is the fix for a ported link-in-bio: never carry a stale
// hand-saved favicon URL again — DuckDuckGo resolves the site's CURRENT mark (privacy-respecting, no
// Google). For shortened links (bit.ly/goo.gl) point iconhost= at the real destination domain.
function linkIcon(p, url, ctx) {
  // 🔴 An AUTHOR'S picture is not a favicon, and must not be sized like one.
  //
  // Both used to render as `.st-cell-icon-img` at 22×22 — a size chosen for a mark that has to be
  // recognisable next to a browser tab. HTL's rows carry his own artwork (a wallpaper, a LINE sticker
  // set) and it came out as a 22px speck. Measured on his live page 2026-07-30: those thumbnails are
  // **64×64**. `ai-ops.mjs` already treats the two as different params (`icon` 內建圖示 vs `iconimg`
  // 圖示用圖片); the stylesheet did not.
  // 🩸 `resolveAsset`, and it was MISSING. `iconimg` went straight into the <img> src, so a card-local
  // reference shipped as `src="asset:sha256-a8f4…"` — not a URL. The image failed, IMG_ICON's onerror
  // hid it, and the row rendered as text with no picture: a defect that looks exactly like "the
  // author didn't set one".
  //
  // It survived because until today NO card pointed `iconimg` at its own assets — every one was an
  // external URL, which happens to work. The importer started emitting `asset:` refs this afternoon
  // and the gap became visible the same hour.
  if (p.iconimg) return IMG_ICON(resolveAsset(p.iconimg, ctx), [], 'st-cell-icon-art');
  if (p.icon && ctx.icons && ctx.icons[p.icon]) return ctx.icons[p.icon];
  const chain = p.iconhost ? [p.iconhost] : iconDomains(hostOf(url));
  if (chain.length) return IMG_ICON(iconPath(chain[0]), chain.slice(1));
  return (ctx.icons && ctx.icons._default) || '';
}

// The signet arrow comes from @cvernet/signet via ctx.arrow — a template lifted from the package's
// own Arrow.astro at build time (see serve/gen-assets.mjs), never re-drawn here. This used to be a
// hand-written span+svg: byte-identical markup, but the card never loaded signet's stylesheet, so
// the arrow's whole point — the tail retracting into the chevron on hover — simply did not happen.
// A seal with two impressions is not a seal, and the second impression is where behaviour goes to
// die. Fallback is empty rather than a local copy: no arrow beats a divergent arrow.
// dir: '' = right (onward, a CTA) · '--up-right' = outbound (a link that leaves the card).
// 🔴 OFF BY DEFAULT since 2026-07-30 (chodaict). Every Portaly page we imported has NO arrow on its
// rows or its CTAs, and ours had one on both — a mark of ours, added to somebody else's page as if
// it were theirs. A card that opts in writes `arrows: on` in its frontmatter.
//
// Reversible in one line, and it changes the three live cards too — that was the ruling, not an
// oversight: 「三張活卡也都直接關掉吧」.
const arrowOf = (ctx, px, cls = 'st-cell-arrow', dir = '--up-right') => (ctx.arrows === 'on' ? (ctx.arrow || '') : '')
  .replace(/__SIZE__/g, String(px)).replace('__CLASS__', cls).replace('__DIR__', dir ? ' signet-arrow' + dir : '');

// The embed escape hatch: a self-contained block that isn't a native widget.
//
// 🔴 kind=slider carries a SPEECH-BUBBLE ROTATION 表演 — and表演 is lifted VERBATIM, never
// re-implemented. The first pass here re-wrote it as an opacity crossfade with scale(.98) and
// silently destroyed the whole point: the ancestor pops each bubble OUT OF THE CHARACTER'S MOUTH
// via `transform-origin:53% 76%` + `scale(0.001)→scale(1)`. Same failure mode the QR coral exists
// to prevent (Python→Svelte→here, re-cut each hop). The keyframes/origin/scale below are the
// ancestor's, parameterised only for N images and an author-set origin.
//   origin=  the bubble's tail anchor, % of the frame (default 53% 76% = the ancestor's)
//   narrow=  the same anchor for narrow screens (the ancestor retargets to 53% 33%)
//
// 🔴 PARAM NAMES MUST NOT CONTAIN HYPHENS. parseParams truncates `a-b=x` to the key `b`, silently.
// This was written as `origin-narrow=` and read as `p['origin-narrow']` — always undefined, always
// falling back to the default, which happened to be the right value, so nothing ever looked wrong.
// A default that masks a broken lookup is a gate you never see fail ([[a-gate-you-never-saw-fail]]).
//   bg=      static backdrop the bubbles rotate over (the characters the tails point at)
function renderEmbed(p, body, size, ctx = {}) {
  // 🔴 `slider` is the COMMON one — a horizontal carousel you swipe, with prev/next. `bubbles` is
  // the speech-bubble pop, which is what `slider` used to mean for everybody.
  //
  // 🩸 That was the bug, and it is a naming bug rather than a rendering one: a bespoke effect built
  // for ONE card (scale(0.001)→scale(1) about a tail origin, 1:1, `contain` over a background image,
  // auto-cycling, no controls) held the generic name, so every imported carousel inherited a
  // character's mouth. chodaict, 2026-07-30: 「你用到〔那張卡〕的版本了,它只需要很常見的 slide,
  // 附上左右按鈕即可」.
  //
  // The pop animation below is preserved verbatim under its own name; that one stored card is
  // migrated to `kind=bubbles` so nothing about it changes.
  if (p.kind === 'slider') {
    const imgs = (p.images ? String(p.images).split(/\s*,\s*/) : []).filter(Boolean).map((u) => resolveAsset(u, ctx));
    if (!imgs.length) return `<div class="st-cell st-embed" ${size} data-coral-type="embed"></div>`;
    // 🔴 CSS scroll-snap + anchor links. No JS: the prev/next are <a href="#…"> into the track, so
    // they work on the first paint, survive a dead script, and the browser's own swipe/keyboard/
    // scrollbar all come free. `scroll-behavior:smooth` is what makes an anchor jump read as a slide.
    const uid = 'sl' + Math.abs([...String(p.images || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    const n = imgs.length;
    const slides = imgs.map((src, i) => {
      const prev = `#${uid}-${(i - 1 + n) % n}`;
      const next = `#${uid}-${(i + 1) % n}`;
      return `<figure id="${uid}-${i}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        + `<a class="st-slide-nav st-slide-prev" href="${prev}" aria-label="${esc(label(ctx, 'prev'))}">‹</a>`
        + `<a class="st-slide-nav st-slide-next" href="${next}" aria-label="${esc(label(ctx, 'next'))}">›</a></figure>`;
    }).join('');
    const dots = imgs.map((_, i) => `<a class="st-slide-dot" href="#${uid}-${i}" aria-label="${esc(label(ctx, 'slide', i + 1))}"></a>`).join('');
    const css = [
      // 🔴 NO fixed aspect. chodaict read Incrediville's live page as `6x6(slide*5)` AND
      // `3x6(slide*4)` — the same widget, two different heights, because the PICTURES differ. Pinning
      // 2/1 here would be 「width decides shape」 all over again, four hours after I removed exactly
      // that rule from features. The first slide's natural height sets the track; the rest are
      // covered into it, so a set of squares is square and a set of banners is a banner.
      `.st-slider{position:relative;width:100%;overflow:hidden;border-radius:inherit}`,
      `.st-slider-track{display:flex;width:100%;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none}`,
      `.st-slider-track::-webkit-scrollbar{display:none}`,
      `.st-slider figure{position:relative;flex:0 0 100%;margin:0;scroll-snap-align:center}`,
      `.st-slider figure:first-child img{height:auto}`,
      `.st-slider figure img{width:100%;height:100%;object-fit:cover;display:block}`,
      `.st-slide-nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;text-decoration:none;color:#fff;background:rgba(0,0,0,.42);backdrop-filter:blur(2px);opacity:.85;transition:opacity .2s,background .2s}`,
      `.st-slide-nav:hover{opacity:1;background:rgba(0,0,0,.6)}`,
      `.st-slide-prev{left:10px}.st-slide-next{right:10px}`,
      `.st-slider-dots{position:absolute;left:0;right:0;bottom:9px;display:flex;gap:6px;justify-content:center}`,
      `.st-slide-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 0 1px rgba(0,0,0,.18)}`,
      // one image needs no controls, and controls on a single slide read as broken
      n < 2 ? `.st-slide-nav,.st-slider-dots{display:none}` : '',
    ].join('');
    return `<div class="st-cell st-embed" ${size} data-coral-type="embed"><style>${css}</style>`
      + `<div class="st-slider"><div class="st-slider-track">${slides}</div>`
      + (n > 1 ? `<div class="st-slider-dots">${dots}</div>` : '') + '</div></div>';
  }
  if (p.kind === 'bubbles') {
    const imgs = (p.images ? String(p.images).split(/\s*,\s*/) : []).filter(Boolean).map((u) => resolveAsset(u, ctx));
    if (!imgs.length) return `<div class="st-cell st-embed" ${size} data-coral-type="embed"></div>`;
    const n = imgs.length;
    const hold = 5;                                   // seconds each bubble is on screen (ancestor's)
    const cycle = n * hold;
    const origin = p.origin || '53% 76%';
    const originNarrow = p.narrow || '53% 33%';
    // the ancestor's stops for n=3 were 0%,33.3%,100% hidden / 3%,30% visible — i.e. hidden outside
    // this figure's slot, popped in 3% after the slot opens until 3% before it closes.
    const slot = 100 / n;
    const inAt = 3;
    const outAt = (slot - 3).toFixed(1);
    const figures = imgs.map((src) => `<figure><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>`).join('');
    const bgStyle = p.bg ? ` style="background-image:url('${esc(resolveAsset(p.bg, ctx))}')"` : '';
    const css = [
      `.st-carousel{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background-size:contain;background-position:center;background-repeat:no-repeat}`,
      `.st-carousel figure{position:absolute;inset:0;margin:0;padding:0;display:flex;align-items:center;justify-content:center;opacity:0;transform-origin:${origin};animation:st-carousel-slide ${cycle}s infinite;animation-fill-mode:both}`,
      `.st-carousel figure img{max-width:100%;max-height:100%;object-fit:contain;display:block;margin:0}`,
      imgs.map((_, i) => `.st-carousel figure:nth-child(${i + 1}){animation-delay:${i * hold}s}`).join(''),
      // 🔴 verbatim: scale(0.001) → scale(1) about the tail origin = "pops out of the mouth"
      `@keyframes st-carousel-slide{0%,${slot.toFixed(1)}%,100%{opacity:0;transform:scale(0.001)}${inAt}%,${outAt}%{opacity:1;transform:scale(1)}}`,
      `@media screen and (max-width:888px){.st-carousel figure{transform-origin:${originNarrow}}}`,
      `@media(prefers-reduced-motion:reduce){.st-carousel figure{animation:none}.st-carousel figure:nth-child(1){opacity:1;transform:scale(1)}}`,
    ].join('');
    return `<div class="st-cell st-embed" ${size} data-coral-type="embed"><style>${css}</style><div class="st-carousel"${bgStyle}>${figures}</div></div>`;
  }
  // 🔴 There is no generic embed. It had zero uses and spliced its body into the page UNESCAPED —
  // on a renderer whose input can arrive from parsing a third party's page. A hatch nobody climbed
  // through, opening onto a drop. `kind=slider` is the only embed, and it builds its own markup.
  return '';
}

// How a cell's target becomes anchor attributes. A `#id` target opens a DRAWER (an overlay on this
// same card) rather than navigating; everything else leaves in a new tab.
// 🔴 Depth 1: inside a drawer a `#id` target is REFUSED (returns null, the cell is dropped) — a
// drawer cannot open another drawer, so a card has no navigation graph and structurally cannot
// become a site. Enforced here rather than left to convention.
function anchorFor(url, ctx) {
  const d = /^#(.+)$/.exec(String(url || ''));
  if (d) {
    if (ctx.inDrawer) return null;
    const id = esc(d[1]);
    return `href="#${id}" data-drawer="${id}" aria-haspopup="dialog"`;
  }
  return `href="${esc(url)}" target="_blank" rel="noopener noreferrer"`;
}

function renderCell(cell, place, ctx) {
  const p = cell.params || {};
  // `data-span` stays: card.css uses it for CONTENT decisions (a 2×2 tile hides its sub-label), and
  // it is what a reader of the markup expects to see. `data-w` is what LAYOUT reads — the width is
  // authored, the height is not. Two attributes because they answer two different questions, and
  // conflating them is what made `h` load-bearing in the first place.
  // `data-span` stays as it was: card.css uses it for CONTENT decisions (a 2×2 tile hides its
  // sub-label) and a reader of the markup expects it. `data-w` is what LAYOUT reads.
  //
  // `data-cell` is the cell's index in model.cells, and it is OPT-IN (ctx.editIndex) because a live
  // card has no use for it. cardtile-w does: a cell can render to the empty string (a link with no
  // url, a video with neither yt nor channel), so the editor cannot map "the 4th box on screen" back
  // to "the 4th cell in the file" by counting. Guessing that mapping would put an edit on the wrong
  // cell of somebody's only copy. The editor asserts that stripping this attribute reproduces the
  // production bytes exactly, so the thing being dragged is still the thing being served.
  const idx = ctx.editIndex && place.abs != null ? ` data-cell="${place.abs}"` : '';
  const size = `data-span="${place.w}x${place.h}" data-w="${place.w}"${idx}`;
  const b = (cell.body || '').trim();
  switch (cell.type) {
    case 'profile': {
      const chips = (p.chips ? String(p.chips).split(/\s*,\s*/) : []).map((c) => `<span class="st-chip">${esc(c)}</span>`).join('');
      // 🔴 May be ''. A profile with no `avatar=` used to still emit <img class="cp-icon" src="">,
      // and an empty src is not "no image" — per HTML it resolves to the CURRENT DOCUMENT URL, so
      // the browser fetches the whole page as an image and fails. It also carried role="button"
      // tabindex="0", announcing a focusable button for a picture that does not exist, and it laid
      // out at 147.6px instead of the 23.6cqw every real avatar holds (measured by avatar-ratio.mjs,
      // which reported it as a ratio bug — it was an existence bug).
      //
      // Same shape as the feature-with-no-picture fixed the same day: emit nothing when there is
      // nothing. The .st-figure mount stays, so the QR coral still has its anchor.
      const avatar = resolveAsset(p.avatar, ctx);
      // 🔴 QR dynamic coral mount: the avatar-morph popup installs here unmodified (same widget a
      // Site would use). data-url is the card's public URL; data-version=4 pins the live 33×33 density.
      const qrUrl = ctx.cardUrl || '';
      return `<div class="st-cell st-hero" ${size} data-coral-type="profile"><div class="st-figure" data-dynamic-coral="qr" data-url="${esc(qrUrl)}" data-name="${esc(ctx.name)}" data-version="4">${avatar ? `<img class="cp-icon" src="${esc(avatar)}" alt="${esc(ctx.name)}" width="80" height="80" fetchpriority="high" role="button" tabindex="0" aria-label="${esc(label(ctx, 'qr'))}">` : ''}</div><div class="st-hero-text"><h1 class="st-hero-name">${esc(ctx.name)}</h1><p class="st-hero-tagline">${mdInline(b)}</p><div class="st-hero-meta">${chips}</div></div></div>`;
    }
    case 'feature': {
      // 🩸 A PICTURE DOES NOT HAVE TO GO ANYWHERE. `anchorFor(p.href)` was called unconditionally,
      // so a cell with no `href=` still got `href="" target="_blank"` — and per HTML an empty href
      // resolves to the CURRENT DOCUMENT, i.e. tapping the photo opened this same page in a new tab.
      // The old form's hint said 「每張圖都要有去處」 to paper over it, which made a renderer
      // limitation into a rule for the author. It is not one: the destination is optional, and when
      // there is none the picture is simply not wrapped in a link.
      const hasHref = !!String(p.href == null ? '' : p.href).trim();
      const fa = hasHref ? anchorFor(p.href, ctx) : '';
      if (hasHref && !fa) return '';                 // a drawer target inside a drawer — refused, as before
      const linkOpen = hasHref ? `<a class="st-gal-link" ${fa}>` : '<div class="st-gal-link">';
      const linkClose = hasHref ? '</a>' : '</div>';
      // 🔴 An empty `img=` is not "a small picture", it is NO picture — and `<img src="">` is the
      // same current-document trap as the href above, drawn as a broken-image glyph on a stranger's
      // first card. Live: nothing. Editing: a tappable outline that says what is missing.
      const featureImg = resolveAsset(p.img, ctx);
      if (!featureImg && !p.title && !p.cta && !b) {
        if (!ctx.editIndex) return '';
        return `<div class="st-cell st-gal-cell st-gal-cell-bare st-cell-unset" ${size} data-coral-type="feature"><span class="st-gal-label">${esc(label(ctx, 'imgUnset'))}</span></div>`;
      }
      // 🔴 An image tile with nothing to say stays an IMAGE. The scrim + eyebrow + title + CTA arrow
      // are chrome for a tile that carries copy — painted over a creator's artwork they darken the
      // very thing people came to see and make every tile look like a button. With no title, eyebrow
      // or cta, render the artwork and nothing else. That includes drawer triggers: I removed the
      // darkening scrim and then stuck a small expand glyph back onto the artwork — the same mistake
      // at a smaller size. Clicking a tile shows you what it does; the drawer opening IS the feedback.
      if (!p.title && !p.cta && !b) {
        // ── the label under a picture ────────────────────────────────────────────────────────────
        // ONE field. A visible label and `alt` normally diverge — `alt` is for someone who cannot
        // see the picture — but they converge here BECAUSE every picture cell must have a
        // destination: W3C's rule for an image inside a link is to describe where it goes, which is
        // the same sentence you would show. Writing it stops being a compliance chore the moment it
        // is visible, which is the nicest part of the arrangement.
        //
        // `label` is the switch, off by default, and it is a SIZE control in disguise: on means a
        // smaller picture with a word under it, off means the picture fills the cell. That is how
        // iOS frames it — there is no "show app names" toggle on the Home Screen, there is small
        // and large — and it leaves the author one decision instead of an orphan checkbox.
        // 🔴 truthiness, not `!= null`. An absent param comes back as '' from the parser, and
        // '' != null is TRUE — so the first version labelled every picture that merely had alt
        // text, including the one written specifically to prove the switch was off.
        const on = String(p.label == null ? '' : p.label).trim().toLowerCase();
        const labelled = !!p.alt && on !== '' && on !== 'off' && on !== 'false' && on !== 'no';
        const cls = 'st-cell st-gal-cell st-gal-cell-bare' + (labelled ? ' st-gal-labelled' : '');
        const capt = labelled ? `<span class="st-gal-label">${esc(p.alt)}</span>` : '';
        return `<div class="${cls}" ${size} data-coral-type="feature">${linkOpen}<img class="st-gal-img" src="${esc(featureImg)}" alt="${esc(p.alt || '')}" loading="lazy" referrerpolicy="no-referrer">${capt}${linkClose}</div>`;
      }
      // 🩸 A FEATURE WITH COPY BUT NO PICTURE. Everything below — the scrim, the near-white eyebrow,
      // the white title, their shadows — is chrome designed to sit ON artwork. With no `img=`, the
      // <img> resolved to an empty src, painted nothing, the scrim darkened nothing, and the card's
      // own ground showed through: measured at 1.12:1 in light mode. The eyebrow was not faint, it
      // was gone, and gone in the way that looks like the author simply did not write one.
      //
      // So the picture-ness becomes a class instead of an assumption. No img ⇒ no <img>, no scrim,
      // and `st-gal-cell-flat`, which the stylesheet themes against the ground like any other text.
      // (Not `st-gal-cell-bare` — that one already means "picture only, no copy", the opposite case.)
      const hasImg = !!featureImg;
      return `<div class="st-cell st-gal-cell${hasImg ? '' : ' st-gal-cell-flat'}" ${size} data-coral-type="feature">${linkOpen}${hasImg ? `<img class="st-gal-img" src="${esc(featureImg)}" alt="" loading="lazy"><div class="st-gal-scrim"></div>` : ''}<div class="st-gal-body">${b ? `<span class="st-gal-eyebrow">${esc(b)}</span>` : ''}${p.title ? `<span class="st-gal-title">${esc(p.title)}</span>` : ''}${(() => {
        // 🔴 No text and no arrow ⇒ NO PILL. Turning arrows off left an empty grey capsule under
        // every feature title — the arrow had been the span's only content, and the container
        // outlived it. Exactly the hollow-social-circle shape from earlier today: remove the thing
        // inside and the box it lived in is still styled, still painted, still meaningless.
        const arrow = arrowOf(ctx, 15, 'st-gal-arrow', '');
        if (!p.cta && !arrow) return '';
        return `<span class="st-gal-cta">${esc(p.cta)}${arrow}</span>`;
      })()}</div>${linkClose}</div>`;
    }
    case 'link': {
      const { label: linkText, url } = linkOf(b);
      // 🔴 No address ⇒ no button. On a LIVE card that is silence, which is the right answer: a
      // button that goes nowhere is worse than a gap. In the editor it is an outline you can tap —
      // an invisible cell would be a cell somebody cannot reach to finish.
      if (!url) {
        if (!ctx.editIndex) return '';
        const unset = label(ctx, 'linkUnset');
        return `<div class="st-cell st-cell-tile st-cell-unset" ${size} data-coral-type="linktile"><div class="st-cell-body"><div class="st-cell-title">${esc(linkText || unset)}</div><div class="st-cell-sub">${esc(unset)}</div></div></div>`;
      }
      const a = anchorFor(url, ctx);
      if (!a) return '';
      const icon = linkIcon(p, url, ctx);
      const sub = p.sub ? `<div class="st-cell-sub">${esc(p.sub)}</div>` : '';
      return `<div class="st-cell st-cell-tile" ${size} data-coral-type="linktile"><a class="st-cell-link" ${a}><div class="st-cell-head">${icon}${arrowOf(ctx, 17)}</div><div class="st-cell-body"><div class="st-cell-title">${esc(linkText)}</div>${sub}</div></a></div>`;
    }
    case 'embed':
      return renderEmbed(p, b, size, ctx);
    case 'text':
      return `<div class="st-cell st-prose" ${size} data-coral-type="text">${mdBlock(b)}</div>`;
    case 'video': {
      // Click-to-load YouTube. The platforms we take refugees from drop a live iframe on page load,
      // which means YouTube is watching every visitor before anyone presses play, and the player's
      // ~1MB lands on the critical path. We ship a poster + a play button and only create the
      // iframe on click, via youtube-nocookie. Faster AND doesn't sell the visitor out by default.
      // yt= a single video id, OR channel= a channel id (UC…) whose UPLOADS playlist is embedded
      // so the card always shows that creator's latest video — no API key, nothing to go stale.
      const id = String(p.yt || '').trim();
      const chan = String(p.channel || '').trim();   // NB: no hyphen — see the parseParams note above
      if (!id && !chan) return '';
      // 🔴 The channel's latest video, resolved by the WORKER before this ran (serve/yt.mjs). This
      // function stays pure and synchronous: it receives an answer, it does not go and get one.
      // Absent — no backdrop of a network, YouTube down, a channel with no uploads — `hit` is
      // undefined and everything below falls through to the degraded state, by design.
      const hit = chan && ctx.videos ? ctx.videos[chan] : null;
      // Poster and playback name the SAME video. The alternative was to keep playing the uploads
      // playlist (always truly newest) under a poster from our cache, which shows one video and
      // plays another whenever the cache is a few minutes behind. Consistency wins; the cache TTL
      // is what bounds how old "latest" can be.
      const vid = id || (hit ? hit.id : '');
      // 🔴 Our own path, never i.ytimg.com. A Google-hosted poster in the markup means the visitor's
      // browser reports to Google on page load — which is the exact thing the click-to-load design
      // exists to prevent, reintroduced through an <img>. The Worker proxies it (see /_yt/ there).
      const poster = p.poster || (vid ? posterPath(vid) : '');
      const label = b || p.title || (hit && hit.title) || 'YouTube';
      const attrs = vid ? `data-yt="${esc(vid)}"` : `data-yt-channel="${esc(chan)}"`;
      return `<div class="st-cell st-embed-video" ${size} data-coral-type="video"><button type="button" class="st-embed-video-btn${poster ? '' : ' st-embed-video-noposter'}" ${attrs} aria-label="${esc(label)}">${poster ? `<img class="st-embed-video-poster" src="${esc(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="st-embed-video-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="54" height="38"><path d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.3 0 34 0 34 0S12.7 0 7.5 1.6a8.6 8.6 0 0 0-6 6.1A90 90 0 0 0 0 24a90 90 0 0 0 1.5 16.3 8.6 8.6 0 0 0 6 6C12.7 48 34 48 34 48s21.3 0 26.5-1.6a8.6 8.6 0 0 0 6-6.1A90 90 0 0 0 68 24a90 90 0 0 0-1.5-16.3z" fill="#f00"/><path d="M27 34l18-10-18-10z" fill="#fff"/></svg></span>${label ? `<span class="st-embed-video-label">${esc(label)}</span>` : ''}</button></div>`;
    }
    case 'social': {
      // The compact icon row every link-in-bio has: 40px marks, no labels, sitting with the profile
      // rather than competing with the creator's own tiles for space.
      const items = (b || '').split('\n').map((l) => linkOf(l.trim())).filter((x) => x.url && x.url !== '#');
      if (!items.length) return '';
      // 🔴 A link to the creator's OWN site gets a drawn mark, not a favicon.
      //
      // Three reasons, and the first is the one that matters: the card IS her apex now, and her site
      // is on www — so without this there is no route from the card to the rest of her work at all.
      // Second, the favicon path is a request to icons.duckduckgo.com, and the one third party a
      // Card still contacts should not be for the creator's own domain. Third, a site's favicon is
      // usually a 16px mark designed to be recognised in a tab strip, next to real brand glyphs.
      //
      // It is automatic rather than a new parameter: any social link whose registrable host matches
      // the card's own is her site, by definition. `www.` is stripped from both — that is exactly
      // the pair this exists for (card on the apex, site on www).
      const bare = (h) => String(h || '').replace(/^www\./, '');
      const selfHost = bare(hostOf(ctx.cardUrl || ''));
      const isSelf = (u) => selfHost && !u.startsWith('mailto:') && bare(hostOf(u)) === selfHost;
      const marks = items.map(({ label, url }) => {
        const host = url.startsWith('mailto:') ? 'mail' : hostOf(url);
        const icon = url.startsWith('mailto:')
          ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>'
          : isSelf(url)
            ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.6V19a1.6 1.6 0 0 0 1.6 1.6h9.6a1.6 1.6 0 0 0 1.6-1.6V9.6"/></svg>'
            : (() => { const c = iconDomains(host); return IMG_ICON(iconPath(c[0]), c.slice(1)); })();
        // the drawn glyph rides along ONLY when the icon is a fetched favicon — our own SVGs (mail,
        // the self-site house) cannot fail, so giving them a fallback would be dead markup.
        const bare = /^<img/.test(icon) ? SOCIAL_FALLBACK : '';
        return `<a class="st-social-btn" href="${esc(url)}"${url.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener noreferrer"'} aria-label="${esc(label)}" title="${esc(label)}">${icon}${bare}</a>`;
      }).join('');
      return `<div class="st-cell st-social" ${size} data-coral-type="social">${marks}</div>`;
    }
    default:
      return `<div class="st-cell" ${size} data-coral-type="${esc(cell.type)}">${mdInline(b)}</div>`;
  }
}

// cardtile-native widget styling — carried WITH the renderer so a card needs no CSS beyond the
// shared card stylesheet. Themed off the same --cp-* tokens.
const NATIVE_CSS = [
  `.st-cell-icon-img{width:22px;height:22px;object-fit:contain;border-radius:5px;background:rgba(255,255,255,.06)}`,
  // an author's own artwork on a row — 64px, `cover`, because it is a picture and not a mark.
  `.st-cell-icon-art{width:64px;height:64px;object-fit:cover;border-radius:10px;background:none}`,
  // 🩸 …and that single-class rule LOSES. `.st-card [data-w="6"].st-cell-tile .st-cell-icon-img` is
  // three selectors deep and was written to pin a FAVICON at 22px on exactly this cell — a
  // full-width link row. Measured, not read: the source said 64px and getComputedStyle said 22px.
  // An outranked rule and a live one look identical in the file, which is why this needs a probe on
  // the computed value and not a second reading of the stylesheet.
  `.st-card .st-cell-icon-art{width:64px;height:64px}`,
  `.st-embed{overflow:hidden;padding:0}`,
  // a bento BLOCK: one section of the card, its own grid. Multiple blocks per card.
  `.st-grid{margin:0 0 var(--s-6,1.5rem)}`,
  // 🔴 accent-BRIGHT, not the raw accent. A lane label floats on the page ground with nothing behind
  // it, and the raw accent is a brand colour chosen to sit on a creator's artwork — measured at
  // 2.17:1 on a light ground. accent-bright is the same hue moved just far enough to clear 4.5:1,
  // in whichever direction that ground requires.
  `.st-grid-label{font-weight:700;font-size:.9rem;letter-spacing:.03em;text-transform:uppercase;color:var(--cp-accent-bright,#0a8c8e);opacity:.9;margin:0 0 var(--s-3,.75rem);padding:0 var(--s-1,.25rem)}`,
  // full-bleed: escapes the card's frame + padding, spans the whole card width
  `.st-bleed{margin:0 0 var(--s-6,1.5rem);width:100%}`,
  `.st-bleed .st-cell{background:none;border:none;box-shadow:none;padding:0;border-radius:0}`,
  // prose cells (long-form text carried in from a migration, or written by hand)
  `.st-prose{display:block;font-size:.86rem;line-height:1.7;color:var(--carrier-text,#e0f0ff)}`,
  `.st-prose p{margin:0 0 .7em}.st-prose ul{margin:0 0 .7em;padding-left:1.1em}.st-prose li{margin:0 0 .3em}`,
  `.st-prose h3,.st-prose h4,.st-prose h5{margin:.2em 0 .5em;font-size:.95rem;color:var(--cp-accent-bright,#239899)}`,
  `.st-prose hr{border:0;height:1px;background:var(--cp-accent-border,rgba(10,140,142,.28));margin:1.2em 0}`,
  // 🔴 NOT the raw accent. A creator's brand colour is chosen to sit on their artwork, not on a
  // dark panel. Measured on a live card: #0556ff scored 3.45:1 against the drawer's ground,
  // under the 4.5:1 body-text floor. --cp-accent-bright — the 72%-white mix the family already
  // derives for exactly this — scores 5.57:1. The underline is not decoration either: colour alone
  // must never be the only signal that something is a link.
  `.st-prose a{color:var(--cp-accent-bright,#239899);text-decoration:underline;text-underline-offset:2px}`,
  // ── text ON a picture is not themed ────────────────────────────────────────────────────────────
  // 🔴 A caption over a creator's artwork was wearing --cp-ink and --cp-accent-bright, which are
  // derived against the card's GROUND. The picture is not the ground. Measured on a live
  // cover: the title scored 1.76:1 in dark (already broken, today) and the CTA 1.51:1 in light.
  //
  // A picture can be any colour, so the answer is the one every platform reaches for and the same
  // one the backdrop uses: put a scrim under the caption and paint on THAT. Fixed light ink, not a
  // token — the caption's context is the scrim, and the scrim is always dark whichever theme the
  // reader is in. Specificity matches card.css's `.st-card .st-gal-*` and wins on order, because
  // NATIVE_CSS is printed in the body.
  // 🔴 ONE gradient, not two. `.st-gal-scrim` already paints one over the whole tile; this element
  // painted a SECOND on top of it, so every title sat under two stacked scrims and the picture went
  // muddy. chodaict: 「漸層下手太重,我看到你疊了好幾層漸層」. The scrim owns the darkening; the body
  // owns the text.
  // 🔴 THE SCRIM LIVES HERE, not only in card.css. Removing the caption's own gradient exposed that
  // the only bottom-heavy scrim was in the committed stylesheet — so a render without it (the colour
  // suite's `renderWith`, and anything that ever forgets `css:`) had text on a photograph with no
  // backing at all. A legibility guarantee must not depend on an artifact this file does not own.
  `.st-gal-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.92) 6%,rgba(0,0,0,.5) 34%,rgba(0,0,0,0) 64%);pointer-events:none}`,
  // ONE gradient, not two: the scrim above darkens, the caption only holds text. Stacked, the two
  // took the bottom of every tile to ~0.99 opaque — 「漸層下手太重」.
  `.st-gal-body{background:none;padding-top:var(--s-6,1.5rem)}`,
  `.st-card .st-gal-eyebrow{color:#f2f2f2;text-shadow:0 1px 6px rgba(0,0,0,.7)}`,
  // …and the same three lines again for a feature that has no picture to sit on. Ground-derived
  // ink, no shadow — a shadow exists to separate text from artwork, and there is no artwork here.
  // palette() has already pushed --cp-muted and --cp-ink past the body floor for every accent in
  // the space, so this is legible by construction rather than by a hardcoded pale grey.
  `.st-card .st-gal-cell-flat .st-gal-eyebrow{color:var(--cp-muted);text-shadow:none}`,
  `.st-card .st-gal-cell-flat .st-gal-title{color:var(--cp-ink);text-shadow:none}`,
  `.st-card .st-gal-cell-flat .st-gal-body{background:none}`,
  // 🔴 14px. card.css sets 26px on `.st-card .st-gal-title` — same specificity as this rule, so this
  // one wins only because it comes later. Measured, not assumed: see the .st-cell-icon-art incident
  // earlier today, where an identical-specificity override placed too early lost silently.
  `.st-card .st-gal-title{font-size:14px;color:#fff;text-shadow:0 2px 20px rgba(0,0,0,.75)}`,
  `.st-card .st-gal-title{font-size:14px}`,
  // 🔴 The card itself: no border, and PURE WHITE in light mode.
  //
  // `--cp-ground` is `color-mix(accent 6%, #f2f2f2)` — a lavender off-white carrying 6% of the
  // creator's colour. On Incrediville that computes to srgb(0.936 0.916 0.937), which is what
  // chodaict was looking at when he asked for 「純白」. The token stays as it is (the page backdrop
  // and the QR overlay both want the tint); only the CARD goes white.
  //
  // 🔴 Scoped to light. `data-theme="dark"` and a reader-preferred dark card must NOT turn white, so
  // this rides the same two selectors the palette does rather than a blanket rule.
  `.st-card{border:none}`,
  `:root[data-theme="light"] .st-card{background:#fff}`,
  `@media(prefers-color-scheme:light){:root:not([data-theme="dark"]) .st-card{background:#fff}}`,
  // 🔴 The avatar wears NO frame. Measured before changing anything (2026-07-30): the decoration is
  // not spread over many elements — it is `img.cp-icon` carrying exactly two properties, a 2px
  // accent border and a 4px accent ring, plus `.st-figure`'s own. Two places, not a stack, which is
  // why this is two lines and not a new `avatar:` switch: 「三人要→變開關,一人要→那是 Site」, and
  // there is no stacking bug here for a switch to paper over.
  //
  // (My first probe reported NINE framed elements. It read `outline-width` without reading
  // `outline-style` — every element inherits a 3px width for a style of `none`, so nothing was drawn.
  // The ruler, again.)
  `.st-card .st-figure{border:none;box-shadow:none}`,
  `.st-card .st-hero .cp-icon{border:none;box-shadow:none}`,
  // 🔴 The social row is a CELL, so if it shows a box the box is rounded like every other one.
  // Its own rule says `background:none;border:none` — but that is a single class (0,1,0) and
  // card.css's `.st-card .st-cell{background:…;border:…}` is (0,2,0), so on some cards it loses and
  // the row becomes a visible box with square corners. Found on PeachyBoys: 648×96, and nothing
  // above it clips. 「要圓角就是全圓角、直角就得全直角不然會醜」.
  `.st-card .st-cell.st-social{border-radius:18px}`,
  // 🔴 ZERO, not 16. The card's own 16px padding already holds every side; a margin here ADDS to it,
  // so the bottom read 32 against 16 on the other three. My first attempt set 16 「to match the
  // sides」 and measured 32 — matching a number is not matching a GAP when the two stack.
  //
  // Measured on three cards after the change: 上16 右16 下16 左16.
  `.st-card .st-grid{margin:0}`,
  // 🔴 every cell rounded, including the ones that clip their own picture. `.st-gal-img` inherits
  // the cell's radius only if the cell actually clips — hence overflow:hidden alongside it.
  `.st-card .st-cell,.st-card .st-embed,.st-card .st-embed-video{border-radius:18px;overflow:hidden}`,
  `.st-card .st-gal-img,.st-card .st-slider{border-radius:inherit}`,
  `.st-card .st-gal-cta{color:#fff;background:color-mix(in srgb,var(--cp-accent,#0a8c8e) 26%,rgba(0,0,0,.62));border-color:rgba(255,255,255,.38)}`,
  // the video's caption sits on a poster frame — same reasoning, same treatment
  // 🔴 The label sits on a POSTER — a photograph we did not choose — so its scrim runs to the top of
  // its own box and each glyph carries a black halo as well. The gradient alone measured 3.67:1
  // against a 4.5 floor once the harness started scoring the pixels ADJACENT to the glyphs instead
  // of the one underneath their centre: the scrim's own fade meant the upper line of a two-line
  // label sat on the picture. Not a regression — a thing the previous measure structurally could
  // not see, because it sampled the background with the text lifted off.
  `.st-embed-video-label{background:linear-gradient(0deg,rgba(0,0,0,.92),rgba(0,0,0,.82) 55%,rgba(0,0,0,.6) 85%,rgba(0,0,0,.35));text-shadow:0 0 4px rgba(0,0,0,.95),0 1px 6px rgba(0,0,0,.9),0 0 14px rgba(0,0,0,.8)}`,
  // card.css carries `.st-footer a{color:var(--cp-accent)!important}` — the raw brand colour, which
  // measured 2.17:1 on a light ground. Same specificity, later in the document, and the !important
  // has to come along because the rule being corrected has one.
  `.st-footer a{color:var(--cp-accent-bright,#0a8c8e)!important}`,
  // a bare image tile: the artwork IS the tile. No scrim, no CTA, no card chrome behind it.
  // 🔴 `.st-card .st-cell.st-gal-cell-bare`, not `.st-gal-cell-bare`. card.css declares
  // `.st-card .st-cell{border:1px solid var(--cp-line)}` at (0,2,0) and this was written at (0,1,0),
  // so the `border:none` here NEVER APPLIED — every bare picture carried a 1px line and sat inset by
  // exactly 1px inside its own cell, which is the frame table's "picture" row quietly not holding.
  // Same shape of bug as `.st-embed-video-noposter`: a rule that reads like the fix, outranked by the
  // thing it was written to correct, therefore never once in effect. verify/frame-table.mjs found it.
  `.st-card .st-cell.st-gal-cell-bare{background:none;border:none;box-shadow:none;padding:0;overflow:hidden}`,
  `.st-gal-cell-bare .st-gal-link{display:block;width:100%;height:100%;position:relative}`,
  `.st-gal-cell-bare .st-gal-img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s ease}`,
  `.st-gal-cell-bare:hover .st-gal-img{transform:scale(1.02)}`,
  // click-to-load video
  `.st-embed-video{padding:0;overflow:hidden}`,
  `.st-embed-video-btn{display:block;position:relative;width:100%;height:100%;padding:0;border:0;background:#000;cursor:pointer;overflow:hidden}`,
  // ── the cell layer: width is authored, height is discovered ────────────────────────────────────
  // The old model: the author writes w AND h, packGrid computes an (x, y), the grid hands each cell
  // a fixed box, and `overflow:hidden` cuts off anything that did not fit. `h` was a knob every card
  // had to guess at.
  //
  // 🔴 One model, no opt-in. This shipped for one commit scoped to cells that authored no `h`, so
  // three existing cards could keep their old path byte for byte. Nothing has been published, so
  // carrying two layout models to protect an unpublished look was cost with no payer — the CARDS
  // moved instead (`h` removed from all three) and the compatibility path came out. Which also
  // removes the question every future rule would otherwise have to answer: which path does this
  // belong to?
  //
  // The new model: CSS packs (`row dense`), a
  // row is `minmax(one unit, auto)` — at least a square, taller if what is in it needs more — and a
  // picture carries its own `aspect-ratio` instead of being stretched into a box the grid supplied.
  // A square picture at w=N then lands on exactly N units by arithmetic, so the old rhythm survives
  // without `h` existing.
  //
  // 🔴 Two things this cost, both found by measuring rather than by reasoning:
  //
  // 1. `!important` on the track sizing. card.css declares `grid-auto-rows:calc(…)!important`, so
  //    nothing without it can replace the tracks. Without it the tracks stayed a flat 43.5px while
  //    cells carried a 158px minimum — 15 overlapping cells and a card collapsed to under one
  //    screen. The computed style said 43.5px where the source said minmax.
  // 2. It is NOT a free change for cards that stated a height. Applied to all cells it made
  //    one live card’s hero 9px shorter and its cover 8px taller — because a 6×3 span is 331×158.5,
  //    which is 2.09:1 and not the 2:1 an `aspect-ratio` would give. Close enough to look like
  //    nothing and far enough to be a change nobody asked for on a live customer's card.
  `.st-card .st-cells{--cp-unit:calc((100cqw - 5 * 14px) / 6);grid-auto-flow:row dense!important;grid-auto-rows:minmax(var(--cp-unit),auto)!important}`,
  ...[1, 2, 3, 4, 5, 6].map((w) => `.st-card [data-w="${w}"]{grid-column:span ${w}}`),
  `.st-card .st-cell{grid-row:auto;align-self:start;overflow:visible;min-height:var(--cp-unit)}`,
  `.st-card .st-gal-cell,.st-card .st-embed,.st-card .st-embed-video{overflow:hidden}`,
  `.st-card .st-gal-link{height:auto;display:block;position:relative}`,
  `.st-card .st-gal-img{position:static;inset:auto;width:100%;height:auto;aspect-ratio:1;object-fit:cover;display:block}`,
  // 🩸 WAS: `[data-w="6"] .st-gal-img{aspect-ratio:2/1}` — 「a full-width picture is a banner, not a
  // 390×390 header photo」. True for the card that rule was written on, and WRONG as a general law:
  // it made WIDTH decide SHAPE, so every full-width picture became a banner whether or not it was
  // one, and `object-fit:cover` then threw away the other half.
  //
  // Measured 2026-07-30 on HTL. chodaict read his own live page off the screen as 方(6x6)、方(6x6)、
  // 細(1x6)、長方(3x6)、長方(3x6)、細(1x6) and said we had it wrong. The source images say the same
  // thing: 1200×1200, 1280×1280, then 562×281 and 1000×500. Two of his pictures are SQUARE and were
  // being cropped in half; the two that looked right were 2:1 already — correct by coincidence.
  //
  // The rule that actually holds: a tile SHARING a row needs a common height so its neighbours line
  // up; a tile that OWNS its row has nothing to line up with, so the picture carries its own ratio.
  // That is 「高度由內容決定」 applied where it was not applied before, not a new idea.
  `.st-card [data-w="6"] .st-gal-img{aspect-ratio:auto}`,
  // 🔴 A video and a slider have no in-flow content to be measured — the play mark is
  // `position:absolute;inset:0`, and the slider's frames are stacked. Under the old model the grid
  // handed them a height from `h`; with `h` gone they collapsed to one unit and rendered as an
  // empty rounded box. A video is 16:9 because a video is 16:9, so it says so itself.
  // 🔴 The ratio belongs to the CELL, not to the button. The button is `replaceWith`n by the iframe
  // on click, so an `aspect-ratio` living on it leaves with it — and the cell, whose `min-height:0`
  // removes the one-unit floor, collapsed to the iframe's own tiny intrinsic height. The video
  // played, at about 1×6. Whatever holds the shape has to be the thing that survives the swap.
  `.st-card .st-embed-video{aspect-ratio:16/9;min-height:0}`,
  `.st-card .st-embed-video .st-embed-video-btn{width:100%;height:100%}`,
  `.st-card .st-embed-video iframe{display:block;width:100%;height:100%;border:0}`,
  // 🔴 …but the slider is NOT in that situation, and pinning it to 2/1 squashed it flat.
  // `kind=slider` is the only embed there is, and it builds `.st-carousel`, which declares
  // `aspect-ratio:1/1` on ITSELF — the frames stack inside a box that already knows it is square.
  // The cell asking for 2:1 on top of that crops a square into a letterbox. Its content does know
  // its own height, so the cell takes it: `min-height:0` undoes the one-unit floor `.st-cell` sets,
  // and nothing dictates a ratio from outside.
  `.st-card .st-embed:not(.st-embed-video){min-height:0}`,
  // ── a picture that carries its name ────────────────────────────────────────────────────────────
  // 🔴 The cell's budget does not change. The picture shrinks, stays SQUARE, and gains side inset;
  // the label takes the rest. That is what iOS does to the icon — measured, it loses 17.1% of its
  // side when labels are on — without iOS's other half, which re-derives the whole grid metric
  // (turning labels off there moves vertical pitch −5.7% and horizontal +6.1%). We cannot afford
  // that: a Card has arbitrary content and mixed widths, and re-deriving per card destroys the
  // arithmetic that `w=N ⇒ N units` rests on.
  //
  // The label sits OUTSIDE the picture's frame, plain, which is both the launcher's shape and the
  // rule locked earlier: the frame marks what is pressable, and here that is the picture.
  // 🔴 The BUDGET is on the link, and the picture takes what the label leaves. The first version
  // put `aspect-ratio:1` on the picture and let the cell size itself: labelled cells came out 150px
  // where unlabelled ones were 159, so turning the label on quietly shrank the tile and broke the
  // rhythm the whole grid rests on. `aspect-ratio` belongs to the SPACE, not to the picture.
  // 🔴 The picture's width is a fixed share of the cell — 70%, which is what iOS gives an icon when
  // its label is showing (99.5 of a 142.5 column pitch, measured). It has to be a share and not
  // `flex:1 1 auto`: left to grow, the picture took the whole box and pushed the label out the
  // bottom, so a labelled tile came out 178px where an unlabelled one was 159. The budget is the
  // link's `aspect-ratio`; the picture takes its share of it and the label takes the rest.
  `.st-card .st-gal-labelled .st-gal-link{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;aspect-ratio:1;height:auto;padding:0}`,
  `.st-card .st-gal-labelled .st-gal-img{flex:0 0 auto;width:70%;height:auto;aspect-ratio:1;border-radius:16px}`,
  // 🔴 fixed small type, never scaled to the cell — a w=6 banner would otherwise grow a giant
  // caption. One line, truncated in the paint; the full string stays in `alt` for assistive tech.
  `.st-gal-label{font-size:.72rem;line-height:1.25;font-weight:600;color:var(--cp-ink,#fff);max-width:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;flex:0 0 auto}`,
  // A full-width picture is a banner, and a banner with a caption under it is just that — no square
  // budget to divide, so the link takes its natural height instead of an aspect-ratio.
  `.st-card [data-w="6"].st-gal-labelled .st-gal-link{aspect-ratio:auto;padding:0}`,
  `.st-card [data-w="6"].st-gal-labelled .st-gal-img{width:100%;aspect-ratio:2/1}`,
  // ── a full-width link is a ROW ─────────────────────────────────────────────────────────────────
  // "A row is what a link is. A tile is what a link becomes when it has a picture worth looking at."
  // Five independent sources, four methods: `list` on 84% of 38 Portaly pages; Linktree 93.6% rows
  // with 109/109 links full-width and zero grids; 6 Carrd sites pure rows; and the ancestor —
  // hand-written, no platform palette, no paywall — 27 rows to 1 tile.
  //
  // A `w=6` link stops stacking icon-above-label and lays out横 like a Settings row: mark, text,
  // chevron. Nothing below applies at w<6, so a tile stays a tile and no existing card moves.
  `.st-card [data-w="6"].st-cell-tile{padding:0}`,
  // 🔴 `flex-direction:row` explicitly. card.css sets `column` on `.st-cell-tile .st-cell-link` —
  // that is what stacks icon above label in a TILE — and setting only `display:flex` here inherited
  // it, so the first version of this "row" was 124px tall with everything still stacked. It looked
  // like a padding bug; it was a direction bug.
  `.st-card [data-w="6"].st-cell-tile .st-cell-link{display:flex;flex-direction:row;align-items:center;gap:var(--s-3,.75rem);min-height:44px;padding:var(--s-3,.75rem) var(--s-4,1rem);height:auto;justify-content:flex-start}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-head{flex:0 0 auto;display:contents}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-body{flex:1 1 auto;margin-top:0;min-width:0}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-icon,.st-card [data-w="6"].st-cell-tile .st-cell-icon-img{order:0;width:22px;height:22px}`,
  // 🩸 IMMEDIATELY AFTER the rule above, and that placement IS the fix. Both selectors are (0,3,1) —
  // identical specificity — so SOURCE ORDER decides, and the art rule sitting earlier in the array
  // lost silently. Two failed attempts before this one: a single-class rule (obviously outranked),
  // then a matching-specificity rule in the wrong position (looks right, still loses).
  //
  // 🔴 The answer did not come from reading the stylesheet a third time. It came from asking the
  // BROWSER which rules match — `el.matches(r.selectorText)` over document.styleSheets — which
  // printed both rules at 64px and 22px side by side and made the tie obvious in one shot.
  `.st-card [data-w="6"].st-cell-tile .st-cell-icon-art{order:0;width:64px;height:64px}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-body{order:1}`,
  // 🔴 the chevron is the affordance, not the border — so it goes last and it stays.
  `.st-card [data-w="6"].st-cell-tile .st-cell-arrow{order:2;margin-left:auto;flex:0 0 auto}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-title{font-size:.95rem;white-space:normal}`,
  `.st-card [data-w="6"].st-cell-tile .st-cell-sub{display:block;font-size:.75rem}`,
  // ── and a RUN of them is one surface, not a stack of buttons ───────────────────────────────────
  // The frame belongs to the LANE. iOS Settings is the proof it works: plain rows in one rounded
  // card, a hairline between each, and nobody has ever been confused about whether a row is
  // tappable. The ancestor did the same by hand — which is how 27 links fit in a 1945px page.
  //
  // 🔴 The run is a real element (`.st-run`, see renderGrid), so the surface, the border and the
  // radius belong to IT and the rows inside are plain. This replaces closing the grid's row gap with
  // `margin-top:-14px` on every adjacent row — which restated the gap as a magic number in a second
  // place and then lost to subpixel rounding: measured on a live card, row tops were 488, 549, 611,
  // 672, so row 2 ended at 610 and row 3 began at 611 and a 1px sliver of page showed through. The
  // divider read as DOUBLED from the third row on while the first two looked perfect, which is a very
  // good disguise for "this mechanism does not actually work".
  //
  // 「除非必要不然 CSS 別寫負數」 — chodaict, and the bug is the argument. A negative offset that has
  // to equal another value is a constraint the layout is not expressing.
  `.st-card .st-run{grid-column:1 / -1;display:flex;flex-direction:column;background:var(--cp-surface);border:1px solid var(--cp-line);border-radius:18px;overflow:hidden}`,
  // 🔴 `align-self:stretch` undoes `.st-card .st-cell{align-self:start}`, which is right for a GRID
  // item (a short cell must not stretch to its track) and means "shrink to content width" for a flex
  // column child. Without it every row is only as wide as its own text: the divider stops mid-card at
  // a different x per row, and the chevron's `margin-left:auto` has no space left to push into, so it
  // sits against the label instead of at the right edge.
  `.st-card .st-run > .st-cell-tile{align-self:stretch;width:100%;background:none;border:0;border-radius:0;box-shadow:none;border-top:1px solid var(--cp-line)}`,
  `.st-card .st-run > .st-cell-tile:first-child{border-top:0}`,
  `.st-card .st-run > .st-cell-tile:hover{background:var(--cp-surface-2)}`,
  // a row lifting on hover would break the run apart; the surface change is the feedback instead
  `.st-card [data-w="6"].st-cell-tile:hover{transform:none;background:var(--cp-surface-2)}`,
  // ── 不能按的不准長得像按鈕 ───────────────────────────────────────────────────────────────────────
  // The frame marks a region of PRESSABLE things, in both directions: what cannot be pressed must
  // not look like a button, and what can must look like one. Prose is the only cell that is neither
  // a link nor a picture, and it was wearing the identical surface, border and radius as a link —
  // a paragraph shaped like something you tap.
  //
  // This is what iOS does with a grouped table's footer text: it sits OUTSIDE the rounded card,
  // plain on the background. Removing the frame here also removes a double frame inside a drawer,
  // where the panel is already the surface.
  //
  // Kept: the padding, so the text still has a margin; and `min-height:0`, or the flex centring the
  // .st-cell rule applies would vertically centre a long passage.
  `.st-card .st-cell.st-prose{background:none;border:none;box-shadow:none;backdrop-filter:none;display:block;padding:var(--s-2,.5rem) var(--s-1,.25rem)}`,
  // ── the avatar is a RATIO, never a pixel count ─────────────────────────────────────────────────
  // Measured across 10 pages and 3 platforms: every platform picks one ratio of the card's width and
  // holds it — Linktree 96px = 24.6% on 14 of 16 pages identically, Portaly 118px = 30.3%, lit.link
  // 80px = 20.5%. There is no universal figure, only a range and a choice inside it.
  //
  // Ours was `width:78px`, and on the 390px viewport all of that evidence was gathered at, 78px IS
  // 23.6% of the card — the choice was already right and only the UNIT was wrong. So this is the
  // same number in a unit that travels: identical to the pixel on a phone, and it stops collapsing
  // on a desktop card, which is the whole defect. (23.6% also lands between lit.link's 20.5% and
  // Linktree's 24.6%, so it is inside the band rather than at its edge.)
  //
  // 🔴 The ratio is of `.st-cells-wrap` — 331px inside a 390px viewport, not 358 and not 390. The
  // first attempt used 21.8, computed against the wrong box, and shrank every avatar by 6px.
  //
  // cqw resolves against `.st-cells-wrap`, the container-query context the grid already establishes
  // for its square base unit — the hero is a cell inside it, so this is the card's own width and not
  // the viewport's. min-width keeps a face on the avatar if a card is ever rendered very narrow.
  `.st-card .st-hero .cp-icon{width:23.6cqw;height:23.6cqw;min-width:56px;min-height:56px}`,
  // ── and the avatar's POSITION, which the ratio fix left alone ────────────────────────────────────
  // The survey is not ambiguous: 10 pages across 3 platforms, **10/10 centre the avatar**, median
  // header height ÷ card width **0.977** — near square. Ours was avatar-left / text-right, measuring
  // 0.453 on a phone and 0.288 on a desktop card, with the avatar 109–230px off the centreline. The
  // SIZE was corrected to a ratio and the POSITION was simply never revisited.
  //
  // A column, centred, is the whole change — there is no new box and no new element. Everything here
  // overrides card.css at equal specificity by being printed in the <body>, which is also why none of
  // it carries !important.
  //
  // 🔴 `.st-figure` is untouched on purpose. It carries `data-dynamic-coral="qr"` and the coral
  // positions its panel against that box; restyling it to help the layout would reach into the one
  // component that is explicitly not ours to move.
  // Symmetric padding again. The extra 28px at the bottom existed to give the veil's gradient a fade
  // zone to land in; with the veil gone it is a number with nothing behind it.
  `.st-card .st-hero{flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:16px;padding:24px 16px}`,
  // ── and the header wears NO FRAME, which the frame table decided and nothing implemented ────────
  // `header / avatar / tagline → none`. Prose was stripped to text on the ground (88c07c0); the
  // header never was, and kept `.st-cell`'s surface, border and radius plus its own gradient. It is
  // the same defect prose had — a thing you cannot tap, shaped like a thing you can — and it survived
  // because no check encodes that table. verify/frame-table.mjs is that check, added with this.
  //
  // A name and a face do not need a container to read as a heading; every platform in the survey puts
  // them straight on the page. Padding is kept, exactly as prose kept its own, so the text keeps a
  // margin instead of colliding with the first cell.
  // 🔴 `var(--cp-hero-veil, none)` rather than a plain `none`, and the indirection is load-bearing.
  // BACKDROP_CSS is emitted BEFORE this block and at lower specificity, so a rule it writes for
  // `.st-hero` loses twice over and silently does nothing — the first attempt at the veil measured
  // 1.89:1 unchanged, because it never applied. A custom property does not care about either: the
  // page declares the veil only when it has a backdrop, and this stays the single place the header's
  // frame is decided. Cards with no backdrop resolve the fallback and are frameless, full stop.
  // 🔴 `border-radius:0` is not redundant. `.st-cell` sets 18px, and with no background and no border
  // a radius is invisible — on a card with a BACKDROP it is not, because it rounds the veil's corners
  // and the veil becomes a panel. verify/frame-table.mjs caught this on its first run, which is the
  // argument for the file: three of us had looked at this header and none of us saw the radius.
  // 🔴 `background:none`, full stop — no veil, no `var()` hatch for one. card.css puts a
  // `linear-gradient(120deg, surface-2, surface)` here and this is what removes it, on every card.
  // A backdrop card no longer gets a slab of ground colour over the artwork either; its text carries
  // its own legibility instead (FLOATING_INK, in BACKDROP_CSS).
  `.st-card .st-cell.st-hero{background:none;border:none;border-radius:0;box-shadow:none;backdrop-filter:none}`,
  `.st-card .st-hero-text{text-align:center;display:flex;flex-direction:column;align-items:center}`,
  `.st-card .st-hero-meta{justify-content:center}`,
  // ── `header: left` — the other arrangement, kept because a card may want it ─────────────────────
  // Not a second header: the same element, the same avatar ratio (23.6cqw applies either way — that
  // was a separate fix about the UNIT, not about the composition), only the axis and the alignment
  // change back. Written as overrides of the centred default so the default needs no class at all.
  `.st-card.st-card-head-left .st-hero{flex-direction:row;align-items:center;justify-content:flex-start;text-align:left;gap:18px;padding:16px}`,
  `.st-card.st-card-head-left .st-hero-text{text-align:left;align-items:flex-start}`,
  `.st-card.st-card-head-left .st-hero-meta{justify-content:flex-start}`,
  `.st-card.st-card-head-left .st-hero-tagline{margin-left:0;margin-right:0}`,
  // ── `icons: mono` — the fetched brand marks go grey ────────────────────────────────────────────
  // 🔴 Scoped to IMG marks only. Our own drawn glyphs (the envelope, the house) are already themed;
  // greying them would desaturate a colour we chose. This is why the row reads as mixed today — not
  // because the brands have colour, but because ours are accent-blue while theirs are their own. In
  // mono both halves finally answer to the same rule.
  `.st-card.st-card-marks-mono .st-cell-icon-img,.st-card.st-card-marks-mono .st-social img{filter:grayscale(1)}`,
  // hover restores the brand, so the colour is one gesture away rather than gone
  `.st-card.st-card-marks-mono .st-cell-link:hover .st-cell-icon-img,.st-card.st-card-marks-mono .st-social-btn:hover img{filter:none}`,
  `@media(prefers-reduced-motion:no-preference){.st-card.st-card-marks-mono .st-cell-icon-img,.st-card.st-card-marks-mono .st-social img{transition:filter .25s}}`,
  // The tagline is the one run that must not stretch to the card's full width when centred: a
  // centred paragraph running the whole 646px of a desktop card reads as a banner, not a bio.
  // 🔴 `word-break:keep-all` is the whole fix, and it is about CJK rather than about any one card. A
  // Chinese or Japanese line breaks between ANY two characters by default, so a centred tagline
  // splits 「插畫合作」 down the middle — a word cut in half, which in Latin script nobody would ship.
  // keep-all confines breaks to spaces, and a tagline written as 「A · B · C」 already puts its
  // spaces exactly where the meaning divides. `overflow-wrap:break-word` stays as the escape hatch
  // for a single run genuinely longer than the line, or keep-all would overflow instead of wrapping.
  // `text-wrap:balance` then evens the remaining lines instead of leaving one orphan.
  `.st-card .st-hero-tagline{max-width:34ch;margin-left:auto;margin-right:auto;word-break:keep-all;overflow-wrap:break-word;text-wrap:balance}`,
  // ── a video with no poster ──────────────────────────────────────────────────────────────────────
  // 🔴 There was already a rule for this — `.st-embed-video-noposter{background:linear-gradient(...)}`
  // declared one line ABOVE `.st-embed-video-btn{background:#000}`, same specificity, so the black
  // won every time. It had never once had an effect, which is why a channel-mode video rendered as a
  // black rectangle with a play button in it: not "loading", not "unavailable", just broken-looking.
  // The two-class selector below outranks the button rather than relying on source order.
  //
  // A live block "degrades to a static state that does not look broken" — the admissibility rule.
  // So the degraded state is designed rather than absent: the card's own surface, its own line, the
  // mark, and the title read as ordinary text. It looks like a video you have not opened yet, which
  // is exactly what it is.
  `.st-embed-video-btn.st-embed-video-noposter{background:linear-gradient(160deg,var(--cp-surface-2,#1a1a1a),var(--cp-surface,#161616));border:1px solid var(--cp-line,rgba(10,140,142,.28))}`,
  `.st-embed-video-noposter .st-embed-video-play{filter:none;opacity:.94}`,
  // the label's dark scrim exists to sit on a photograph. With no photograph it is a smudge, and the
  // ink can simply be the card's ink on the card's surface — which the colour sweep already covers.
  `.st-embed-video-noposter .st-embed-video-label{background:none;color:var(--cp-ink,#fff);text-shadow:none;padding:12px}`,
  `.st-embed-video-poster{width:100%;height:100%;object-fit:cover;display:block;opacity:.82;transition:opacity .25s,transform .3s}`,
  `.st-embed-video-btn:hover .st-embed-video-poster{opacity:1;transform:scale(1.02)}`,
  `.st-embed-video-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 10px rgba(0,0,0,.5));transition:transform .2s}`,
  `.st-embed-video-btn:hover .st-embed-video-play{transform:scale(1.08)}`,
  `.st-embed-video-label{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 10px;font-size:.78rem;font-weight:600;color:#fff;text-align:left;background:linear-gradient(0deg,rgba(0,0,0,.72),transparent)}`,
  `.st-embed-video iframe{width:100%;height:100%;border:0;display:block}`,
  // social mark row
  `.st-social{display:flex;flex-wrap:wrap;gap:var(--s-2,.5rem);align-items:center;justify-content:center;background:none;border:none;box-shadow:none;padding:0;min-height:0}`,
  `.st-social-btn{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid var(--cp-accent-border,rgba(10,140,142,.28));background:color-mix(in srgb,var(--cp-accent,#0a8c8e) 8%,transparent);color:var(--cp-accent,#0a8c8e);transition:background .2s,transform .2s}`,
  `.st-social-btn:hover{background:color-mix(in srgb,var(--cp-accent,#0a8c8e) 20%,transparent);transform:translateY(-2px)}`,
  `.st-social-btn .st-cell-icon-img{width:20px;height:20px;background:none}`,
  // the drawn last resort — revealed by the sibling combinator the instant onerror hides the img,
  // so it needs no class toggle and works with JS already done running.
  `.st-social-bare{display:none}`,
  `.st-social-btn .st-cell-icon-img[style*="none"] + .st-social-bare{display:block}`,
  // square-corner skin (a creator whose platform set square corners keeps them)
  `.st-card.st-card-square .st-cell,.st-card.st-card-square .st-gal-img,.st-card.st-card-square .st-embed-video-btn{border-radius:0}`,
].join('');

// The card's page backdrop: a fixed image behind everything, dimmed so the card stays readable.
// Fixed (not scrolling) is the point — the art stays put while the card moves over it.
// 🔴 z-index 0, NOT negative. A negative-z backdrop computes as perfectly visible (opacity 1, real
// box, image loaded) and still paints under the page's own opaque background — proven by painting it
// solid red and seeing nothing. So the backdrop sits at 0 and the content is lifted above it.
//
// 🔴 `dim` arrives from resolveBackdropDim(), never raw from the card. The scrim is the only thing
// between a creator's photograph and their reader, and it used to be a number that went straight
// into the stylesheet: `backdrop-dim: 0` removed it outright, and `backdrop-dim: 48%` — writing the
// unit — made Number() return NaN, which invalidated the color-mix, which dropped the whole
// declaration. A typo silently deleted the legibility protection, with no signal anywhere.
//
// 🔴 `html{scrollbar-gutter:auto}` is here, and it looks like it belongs somewhere else. It does not.
// card.css declares `scrollbar-gutter:stable` on html, which reserves an 11px strip (the scrollbar is
// `thin`) and shrinks html's border box to 1189 of a 1200px window. `.st-backdrop` is fixed with
// `inset:0`, so it lays out against THAT — the artwork stops 11px short and a flat band of
// `--cp-ground` runs the full height of the page, right beside the photograph it is meant to be
// showing. Same family as the `html{background-color:#0a1628}` black bar: a gutter is a place no
// contrast check ever looks, because there is no text in it.
//
// Measured, not reasoned, because the obvious fixes both fail:
//   `.st-backdrop{width:100vw}` — the box becomes 1200, and the PIXELS do not change. Root
//     `overflow-x:hidden` clips it back to 1189.
//   the artwork on `html` — computed style confirms it applied (`cover`, `fixed`, the whole data
//     URI), and the strip still shows 227,228,247. Chromium paints the reserved gutter with the
//     canvas BASE COLOUR only; a background-image never reaches it. `html{background:lime}` turns
//     the strip lime, which is what proved the strip is the canvas and closed off this route.
// So the reserved strip itself has to go, and only on cards that have a backdrop — non-backdrop
// cards keep `stable` and do not move by a pixel. See verify/backdrop-gutter.mjs.
//
// 🔴 THE VEIL IS GONE (2026-07-30). chodaict, on a card with a backdrop: 「st-cell st-hero 目前疊超多
// 層顏色,有沒有可能弄出『沒有背景色也好看的版本』?」and the same for the footer. He is right, and the
// veil was mine: a slab of `--cp-ground` laid over her artwork so the ink underneath had something
// tame to sit on. It read as exactly what it was — a rectangle of interface colour on a painting.
//
// 🔴 More to the point, I chose it for a bad reason. The note it replaces said a scrim was preferable
// to a shadow because "theme.mjs scores ink against painted pixels and can only ANNOTATE [shadowed]",
// i.e. I let what my instrument could measure decide what the card looks like. That is backwards. The
// fix is to make the instrument able to see a shadow — verify/theme.mjs now measures the pixels
// ADJACENT to the glyphs in the rendered page, so a shadow is part of the measurement rather than a
// footnote to it.
//
// So the floating text does what iOS home-screen labels do over an arbitrary wallpaper: fixed light
// ink and its own shadow, carried by the glyphs instead of by a box behind them. Theme-independent
// on purpose — a picture is not the ground, and can be brighter or darker than any ink derived from
// one.
// 🔴 The halo is the GROUND, and the ink stays THEMED. Fixed white ink was my first answer and it is
// measurably wrong: in light mode the backdrop's scrim mixes her artwork toward a near-white
// `--cp-ground`, so the picture gets BRIGHTER, and white text cannot win over it at any shadow
// strength. Measured on her card, white against the median surround: hairline 1.50, dense halo 1.97,
// a five-layer very-dense halo 2.18 — against a 4.5 floor. It was never the shadow's strength.
//
// Giving each glyph a halo of `--cp-ground` makes the effective background the GROUND, in both
// themes, whatever the artwork is doing — and ink-on-ground is the one contrast `colour.mjs` already
// derives and sweeps 294 accents against. So this is not a new colour decision; it routes the
// floating text back through the guarantee that already exists.
//
// Which is also why "text on a picture is not themed" does not apply here: it governs text on a RAW
// picture. A haloed glyph is not on the picture, it is on its own ground.
const HALO = 'text-shadow:0 0 4px var(--cp-ground),0 0 9px var(--cp-ground),0 1px 14px var(--cp-ground)';
const FLOATING_INK = [
  `.st-card .st-hero-name,.st-card .st-hero-tagline{color:var(--cp-ink);${HALO}}`,
  `.st-card .st-hero-tagline em{color:var(--cp-accent-bright);${HALO}}`,
  `.st-card .st-chip{color:var(--cp-accent-bright);${HALO}}`,
  // 🔴 `--cp-ink`, not `--cp-page-ink`. The page-ink is derived for text on the page MIST; over a
  // backdrop the footer is on artwork, and it measured 2.86 there against a 4.5 floor. Same mistake
  // the tagline had with `--cp-muted`: a colour derived for one surface, used on another.
  `.st-footer,.st-footer>div{color:var(--cp-ink)!important;${HALO}}`,
  `.st-footer a{color:var(--cp-accent-bright)!important;${HALO}}`,
].join('');

// 🔴 The header joins the floating-text set (2026-07-29), and it had to. Once the frame table was
// actually implemented and `.st-hero` lost its surface, a backdrop card's name and tagline landed
// straight on artwork: a tagline measured **1.89:1** in dark and 4.29 in light, `--cp-muted`
// over a photograph. It had been 4.81/6.37 while it still had a box under it.
//
// The answer is `.st-footer`'s, mirrored — a local gradient of `--cp-ground` fading to transparent —
// and NOT `.st-grid-label`'s shadow, for a reason that is about the instrument as much as the design:
// theme.mjs scores ink against the painted background and can only ANNOTATE `[shadowed]`. A
// shadow-based fix would leave the harness red and me explaining why red is fine, which is how a gate
// stops being a gate. A scrim is painted, so it is measured.
//
// A scrim is not a frame: no border, no radius, and it fades out rather than ending at an edge. And
// because it is `--cp-ground` fading to nothing, it is INVISIBLE on a desktop card, where `.st-card`
// is already `--cp-ground` — so no media query is needed to scope it to the phone, where the card is
// transparent and the header actually floats.
//
// The two floating text runs (.st-grid-label, .st-footer) carry their own shadow rather than
// driving the scrim floor up: they are mid-lightness colours, and a photograph can be brighter or
// darker than a mid-lightness colour, so NO scrim opacity below 100 makes them safe. Giving them a
// local shadow is what iOS does for home-screen labels under an arbitrary wallpaper, and it leaves
// the global scrim answering only for body ink.
const BACKDROP_CSS = (img, dim) => `.st-backdrop{position:fixed;inset:0;z-index:0;background-image:url("${cssUrl(img)}");background-size:cover;background-position:center;background-attachment:fixed}
html{scrollbar-gutter:auto}
.st-wrap,.st-footer{position:relative;z-index:1}
.st-backdrop::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--cp-ground,#0a1628) ${dim}%,transparent),color-mix(in srgb,var(--cp-ground,#0a1628) ${Math.min(96, dim + 18)}%,transparent))}
.st-grid-label{text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 12px rgba(0,0,0,.6)}
${FLOATING_INK}
@media(max-width:720px){.st-backdrop{background-attachment:scroll}}`;

/** renderCard: model → the card's inner HTML (no page chrome).
 *
 * The card is a SEQUENCE OF BENTO BLOCKS, not one grid: a `section` cell opens a new block (its body
 * is the block's label), and cells with `bleed` render full-width OUTSIDE any block. Each block packs
 * independently, so a section can't be pulled out of place by the packing of the section above it —
 * which is also why `section` is no longer a w=6 filler cell pretending to be content.
 */
// exported for md-dialect-conformance.test.mjs only — the dialect is the thing under test, so it
// has to be reachable without rendering a whole card around it.
export { mdInline as __mdInline, esc as __esc };
// 🔴 cardtile-w's link form READS a body with these and WRITES it back — so it must be the same
// parse, not a second one that agrees today. A form that read `[a](b)` slightly differently from the
// renderer would show one thing and publish another, on somebody's only copy.
// 🔴 …and the editing table shows the SAME favicon the card will. `/try/edit2`'s tiles are a
// mini-render of the finished element, so the domain a tile's mark is derived from has to be
// derived the one way — a second `hostOf` would put a different icon on the table than on the card
// for exactly the links these two rules exist for (twitter.com → x.com, sub.example.com).
export { linkOf, hostLabel, hostOf, iconDomains };

export function renderGrid(model, ctx = {}) {
  ctx = { name: '', icons: {}, ...ctx };
  const cols = model.cols;
  const parts = [];

  // A block's label comes from its LANE (`## English`), not from a cell. A run of cells packs as one
  // bento; a `bleed` cell interrupts it, renders full-width, and the rest of the lane resumes after.
  // 🔴 A run of full-width rows is ONE ELEMENT, not N elements pulled together.
  //
  // It used to be N: each row kept its own surface and border, and consecutive rows were joined by
  // `margin-top:-14px` — the grid's `gap`, cancelled by hand. That hard-codes the gap in a second
  // place and fights the layout instead of expressing it, and it does not survive contact with
  // fractional track heights: measured on a live card, row tops came out 488, 549, **611**, 672, so
  // row 2 ended at 610 and row 3 began at 611. A 1px sliver of page showed between them and the
  // divider read as DOUBLED from the third row on, while the first two looked perfect.
  //
  // Wrapping the run makes the join a property of the layout: one box, one border, one radius, and
  // dividers that are ordinary child rules. No negative margin, no `:has()`, and nothing that has to
  // equal the gap. It is also what the frame table actually says — "the **lane** surface".
  const isRow = (pl) => pl.cell.type === 'link' && pl.w === cols;
  const groupRuns = (placements) => {
    const out = [];
    for (const pl of placements) {
      const last = out[out.length - 1];
      if (isRow(pl) && last && last.run) last.items.push(pl);
      else out.push(isRow(pl) ? { run: true, items: [pl] } : { run: false, items: [pl] });
    }
    return out;
  };

  // `run` carries {cell, abs} pairs — abs is the index in model.cells. packGrid works on a SLICE
  // (per block, and split again at every bleed), so its own `index` is local to that slice and is
  // not the number the editor needs. Threading the absolute one costs a pair per cell and removes
  // the arithmetic that would otherwise have to be re-derived, correctly, in a second place.
  const emit = (label, run) => {
    if (!run.length) return;
    const g = packGrid({ cells: run.map((x) => x.cell), cols });
    const inner = groupRuns(g.placements).map((grp) => {
      const html = grp.items.map((pl) => renderCell(pl.cell, { ...pl, abs: run[pl.index].abs }, ctx)).join('');
      return grp.run ? `<div class="st-run">${html}</div>` : html;
    }).join('');
    const head = label ? `<div class="st-grid-label">${mdInline(label)}</div>` : '';
    // .st-cells-wrap establishes the container-query context (container-type:inline-size) that
    // grid-auto-rows:calc((100cqw − gaps)/6) needs, so the base unit = one column width = a SQUARE.
    parts.push(`<section class="st-grid">${head}<div class="st-cells-wrap"><div class="st-cells">${inner}</div></div></section>`);
  };

  const cells = model.cells || [];
  const blocks = model.blocks && model.blocks.length
    ? model.blocks
    : [{ label: '', start: 0, count: cells.length }];

  for (const blk of blocks) {
    let run = [];
    let label = blk.label || '';
    for (let abs = blk.start; abs < blk.start + blk.count; abs++) {
      const cell = cells[abs];
      if (!cell) continue;
      // Full-width rows that step OUT of the packed bento: an explicit `bleed`, and any prose.
      // Prose is not a square tile — it is text, and text takes the height it takes. Packing it
      // into grid rows is what forced a guessed row count and a scrollbox nested inside a drawer
      // that already scrolls.
      if ((cell.params && cell.params.bleed != null) || cell.type === 'text') {
        emit(label, run); run = []; label = '';               // the heading belongs to the first run only
        parts.push(`<div class="st-bleed">${renderCell(cell, { w: cols, h: 1, abs }, ctx)}</div>`);
        continue;
      }
      run.push({ cell, abs });
    }
    emit(label, run);
  }

  const skin = ctx.radius === 'square' ? ' st-card-square' : '';
  // `header: left` — the avatar beside the text instead of above it. Centred stays the default on the
  // survey's evidence (10/10 centre it), but that evidence justifies a DEFAULT and not the removal of
  // the arrangement one live card already had. A class on the card, so the choice is one word in the file
  // and one selector here rather than a second header implementation.
  const head = String(ctx.header || '').trim().toLowerCase() === 'left' ? ' st-card-head-left' : '';
  // `icons: mono` — grey the fetched brand marks. Colour is the default (see card-worker).
  const marks = /^(mono|grey|gray|monochrome)$/.test(String(ctx.iconStyle || '').trim().toLowerCase())
    ? ' st-card-marks-mono' : '';
  return `<div class="st-card${skin}${head}${marks}"><style>${NATIVE_CSS}</style>${parts.join('')}</div>`;
}

/** renderDrawers: model.drawers → the overlay markup. Behaviour comes from the `drawer` coral.
 *
 * The renderer's job stops at STRUCTURE: one panel per drawer, whose id IS the drawer id, inside a
 * layer the coral mounts on. That id is the whole mechanism — a drawer is open when it is the URL's
 * `:target`, so `[label](#stockists)` opens it, the close link closes it, Back closes it, and all
 * of that happens with JavaScript off. The coral adds the focus trap, Escape and focus restore.
 *
 * This used to be ~60 lines of inlined CSS plus a whole client stapled into every card that had a
 * drawer. As a coral it has one home, and a Site can install it too.
 */
export function renderDrawers(model, ctx = {}) {
  const drawers = model.drawers || [];
  if (!drawers.length) return '';
  const dctx = { ...ctx, inDrawer: true };            // 🔴 depth 1: #links are dropped inside a drawer
  const panels = drawers.map((d) => {
    const inner = renderGrid({ cells: d.cells, cols: model.cols, drawers: [] }, dctx);
    const id = esc(d.id);
    // The drawer's own title is its heading AND its accessible name. Without one, a role="dialog"
    // is announced as an unnamed dialog — the overlay opens and a screen reader says nothing about
    // what opened. aria-labelledby only when there IS a title: pointing at an absent id is worse
    // than pointing at nothing.
    const tid = `drawer-${id}-title`;
    const head = d.title ? `<h2 class="dc-drawer-title" id="${tid}">${esc(d.title)}</h2>` : '';
    const named = d.title ? ` aria-labelledby="${tid}"` : '';
    return `<div class="dc-drawer" id="${id}" data-drawer-panel="${id}" role="dialog" aria-modal="true"${named}>`
      + `<div class="dc-drawer-body">${head}${inner}</div></div>`;
  }).join('');
  // 🔴 The close control lives in the LAYER, not in the panel — 「modal的close目前沒有搬到最外面」.
  //
  // It cannot simply be `position:fixed` where it was: `.dc-drawer` carries a `transform`, and a
  // transform creates a containing block for fixed descendants, so a "fixed" button inside the panel
  // is still positioned against the panel and still scrolls with its content. Moving the element is
  // the fix; no amount of CSS on it was going to be.
  //
  // ONE button for the whole layer, because only one drawer can be `:target` at a time. It stays a
  // LINK: what it does is leave the fragment, which is navigation, and navigation is the one thing
  // that still works when the script never arrives.
  const close = `<a href="#" class="dc-drawer-close" role="button" aria-label="${esc(label(ctx, 'close'))}">✕</a>`;
  return `<style>${DRAWER_CSS}</style><div class="dc-drawer-layer" data-dynamic-coral="drawer"><a href="#" class="dc-drawer-scrim" aria-hidden="true" tabindex="-1"></a>${panels}${close}</div>`;
}

/** renderPage: full standalone HTML (reuses the live CSS + QR-on-avatar-click). */
export function renderPage(model, ctx = {}) {
  // 🔴 The backdrop belongs to the PAGE, and it is emitted here exactly once. It used to come out
  // of renderGrid — which also renders every drawer's contents, so each drawer carried its own copy
  // of the creator's artwork, painted OVER the drawer's own background. The panel measured opaque
  // and looked transparent, and I twice talked myself out of it ("the screenshot caught the
  // fade-in") before sampling the pixels: painting the panel red changed nothing, and the paint
  // stack showed .st-backdrop sitting above the drawer body. Computed style cannot see this.
  const backdropUrl = resolveAsset(ctx.backdrop, ctx);
  const backdrop = backdropUrl
    ? `<div class="st-backdrop" aria-hidden="true"></div><style>${BACKDROP_CSS(backdropUrl, resolveBackdropDim(ctx.backdropDim, ctx.accent))}</style>`
    : '';
  const grid = backdrop + renderGrid(model, ctx) + renderDrawers(model, ctx);
  const css = ctx.css || '';
  // The avatar-morph QR popup is the `qr` dynamic coral (packages/dynamic-corals/qr). It mounts on
  // the [data-dynamic-coral="qr"] wrapper the profile cell emits — no page-baked matrix, no re-break.
  // ctx.qrScriptSrc → external <script src> (production, registry URL); ctx.qrScriptInline → inlined
  // bundle (self-contained pages / tests). One of them wires the coral; neither = no QR (graceful).
  const qr = ctx.qrScriptInline ? `<script>${ctx.qrScriptInline}</script>`
    : ctx.qrScriptSrc ? `<script src="${esc(ctx.qrScriptSrc)}"></script>` : '';
  // the click-to-load video swap — only shipped when the card actually has a video cell
  const video = grid.includes('st-embed-video-btn') ? `<script>${VIDEO_JS}</script>` : '';
  // the drawer coral, only when the card has drawers. Its absence costs a card nothing, and its
  // absence on a card that HAS drawers still leaves them openable — the CSS carries that.
  const drawer = grid.includes('data-dynamic-coral="drawer"')
    ? (ctx.drawerScriptInline ? `<script>${ctx.drawerScriptInline}</script>`
      : ctx.drawerScriptSrc ? `<script src="${esc(ctx.drawerScriptSrc)}"></script>` : '')
    : '';
  // Footer. The creator's own line always: `<name> © [<since>–]<year>`.
  //
  // 🔴 "Powered by feelreef" is DEFAULT OFF, opt-in per card (`powered-by: on`). It is not a
  // platform watermark — it is a REFERRAL the creator chooses to run: the link carries
  // `?ref=<handle>`.
  //
  // ⚠️ What that currently BUYS them, precisely (checked 2026-07-28, don't overstate it): the
  // signup page auto-captures `?ref` (→ utm_source → referrer host → "direct") and forwards it to
  // Heroku `POST /apply`, which appends it as the Source column of a Google Sheet waitlist row.
  // That is attribution and nothing more. `increment_referral()` — which bumps card_referral_count
  // and carries the "every 10 referrals = 1 month REEF Pro" milestone — exists in
  // guild_setting_store.py with ZERO callers. No counter moves; no reward is computed. Say
  // "we can see you sent them", not "you earn from this", until that is wired.
  //
  // Most free tiers tax you with branding;
  // charging a creator's own card for our advertising would contradict everything else here (the
  // card is theirs, the markdown is theirs, they can leave with all of it). Off by default also
  // makes the opt-in mean something — it is chosen, not tolerated.
  const year = new Date().getFullYear();
  const since = ctx.since && String(ctx.since).trim() ? `${esc(ctx.since)}–` : '';
  const owner = `<span>${esc(ctx.name)} &copy; ${since}${year}</span>`;
  const ref = ctx.handle ? `?ref=${encodeURIComponent(ctx.handle)}` : '';
  const powered = ctx.poweredBy
    ? `&nbsp;&nbsp;|&nbsp;&nbsp;Powered by <a href="https://feelreef.com/signup${ref}" class="st-footer-credit">feelreef</a>`
    : '';
  const footer = `<footer class="st-footer"><div>${owner}${powered}</div></footer>`;
  // accent: ONE author-set hex derives the whole --cp-accent-* family (the same 12/25/35/72% ramp
  // the Python renderer derives per guild), so a card is themed by a single frontmatter field.
  const accent = ctx.accent ? `<style id="cp-accent">:root{--cp-accent:${esc(ctx.accent)};--cp-accent-bg:color-mix(in srgb,${esc(ctx.accent)} 12%,transparent);--cp-accent-border:color-mix(in srgb,${esc(ctx.accent)} 25%,transparent);--cp-accent-glow:color-mix(in srgb,${esc(ctx.accent)} 35%,transparent);--cp-accent-bright:color-mix(in srgb,${esc(ctx.accent)} 72%,#fff)}.st-footer-credit{color:var(--cp-accent-bright,#0a8c8e);text-decoration:none;font-weight:600}</style>` : `<style>.st-footer-credit{color:var(--cp-accent-bright,#0a8c8e);text-decoration:none;font-weight:600}</style>`;
  // 🔴 The theme block comes LAST in the head, and that placement is the whole mechanism: card.css
  // declares the --cp-* ramp in :root, so an override at equal specificity has to arrive later to
  // win. It also has to sit after the accent block, which still carries --cp-accent itself.
  //
  // `theme: light|dark` pins. Nothing given follows the READER — `prefers-color-scheme`, with dark
  // as the fallback, so a browser that reports no preference sees exactly what it saw before. That
  // default is why the light ramp had to be built rather than deferred: half the readers ask for it.
  // 🔴 The document's language was hard-coded to `en` on every card. Two of the three live ones are
  // written in Chinese, so the page has been telling screen readers, translation prompts and search
  // engines the wrong thing since the first card shipped — quietly, because nothing renders it.
  //
  // A BCP-47 tag, and validated rather than interpolated: this lands inside an attribute, and the
  // frontmatter is creator-authored. Anything that is not a plausible tag falls back to `en` instead
  // of escaping into the markup.
  // `generator` — machine-readable provenance, DEFAULT ON, and deliberately the opposite default to
  // the visible `Powered by feelreef` footer. That one is an ad slot on someone else's page and is
  // correctly opt-in; this one says what rendered the document, the same field WordPress, Hugo and
  // Astro all emit. Without it a card is identifiable only by UNDECLARED traces — `st-` prefixes,
  // /_coral/, /_yt/, /_icon/ — which is not more private, only less honest. And chodaict's reason,
  // which outranks both: without it we cannot get cold traffic at all.
  //
  // 🔴 Semantics copied EXACTLY from sitetile's SiteLayout, which shipped this first (I designed a
  // bare unconditional tag before reading the sibling). `generator: off` / false / no / none opts out
  // entirely, and ANY OTHER VALUE REPLACES THE STRING — so a card that is exported and re-hosted can
  // say whatever is then true. Two halves of one product must not answer "what made this" differently.
  const generatorTag = (() => {
    const raw = ctx.generator;
    if (raw === undefined || raw === null || raw === '') return 'feelreef';
    const g = String(raw).trim();
    if (!g || /^(off|false|no|none)$/i.test(g)) return '';
    return g;
  })();
  const langRaw = String(ctx.lang || '').trim();
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(langRaw) ? langRaw : 'en';
  const mode = ctx.theme === 'light' || ctx.theme === 'dark' ? ctx.theme : null;
  const theme = `<style id="cp-theme">${themeCss(mode, ctx.accent)}</style>`;
  return `<!doctype html><html lang="${lang}"${mode ? ` data-theme="${mode}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${generatorTag ? `<meta name="generator" content="${esc(generatorTag)}">` : ''}<title>${esc(ctx.name)}</title><style>${css}</style>${accent}${theme}</head><body><main class="st-wrap">${grid}</main>${footer}${qr}${video}${drawer}</body></html>`;
}

// Swap the poster for the real player only once someone presses play — youtube-nocookie, and not a
// single byte or cookie from YouTube before the click.
const VIDEO_JS = `(function(){document.addEventListener('click',function(e){
var b=e.target.closest&&e.target.closest('.st-embed-video-btn');if(!b)return;
var id=b.getAttribute('data-yt');var ch=b.getAttribute('data-yt-channel');if(!id&&!ch)return;
var f=document.createElement('iframe');
f.src=id?('https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&modestbranding=1&rel=0')
        :('https://www.youtube-nocookie.com/embed/videoseries?list=UU'+encodeURIComponent(ch.replace(/^UC/,''))+'&autoplay=1&modestbranding=1&rel=0');
f.title=b.getAttribute('aria-label')||'YouTube';f.allow='accelerometer;autoplay;encrypted-media;picture-in-picture';f.allowFullscreen=true;
f.setAttribute('loading','lazy');b.replaceWith(f);});})();`;
