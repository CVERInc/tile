// The "this is a preview, not public yet" bar — ONE source for both products' previews.
//
//   a Site preview    the platform's preview host draws it at the top of every page it proxies
//   a Cards preview   card-worker.mjs draws it at the top of `/_preview/<id>`
//
// Both read this file (the platform vendors it verbatim, the way it vendors colour.mjs and claim.mjs),
// so the markup, the stylesheet, the three locales' words and the rule for when it is drawn exist once.
// PURE and import-free on purpose: that is what lets a copy of it be byte-checked against this commit.
//
// What the bar is, and why each property is there:
//
//   NO SCRIPT; ISOLATED FROM THE PAGE'S CSS. A CLOSED declarative shadow root: a page whose CSP forbids
//   inline script still gets the bar, the page's stylesheet cannot restyle what is inside it, and the
//   bar's styles cannot leak out. The host box is restated inside `:host` with `!important` (an
//   important declaration from the shadow tree outranks the page's), so whatever the page says about
//   the element it is an ordinary block at the top of `<body>`. Custom properties DO cross a shadow
//   boundary, so the stylesheet reads none: every colour is a literal.
//
//   NOT A SECURITY BOUNDARY. Nothing in the same document is one against the page's own script, which
//   could restyle this bar or draw a look-alike. What protects publishing is where the two links go:
//   the platform's dashboard, which requires the owner's sign-in and her seat before anything happens.
//   So the buttons are LINKS, never an action this origin can run.
//
//   IN THE FLOW, NOT STICKY. It scrolls away with the page: a sticky bar would fight a page's own
//   `sticky; top:0` banner for the same strip.
//
//   THE TOOLS NEVER SEE IT (`wantsPreviewBar`). An agent reading a preview must read the page, not the
//   bar: its words would count as the page's, and its row would push every screenshot down.

/** The host element's id — one per page. Also what tests look for. */
export const PREVIEW_BAR_ID = 'feelreef-preview-bar';

/** Where the two buttons go when the caller names no other platform origin. Absolute and fixed. */
export const PREVIEW_BAR_PLATFORM = 'https://feelreef.com';

export const PREVIEW_BAR_LOCALES = Object.freeze(['zh-TW', 'ja', 'en']);

/**
 * Who may frame a preview: the preview itself and the platform (the dashboard). The policy the Site
 * preview's Worker sends (with its default platform origin), sent by the Cards preview as a policy of
 * its own, so a framing page cannot aim a click at the bar's buttons.
 */
export const PREVIEW_FRAME_ANCESTORS = `frame-ancestors 'self' ${PREVIEW_BAR_PLATFORM}`;

/**
 * Written for the person looking at her own link: what visitors can see (nothing yet) and the two next
 * steps. The right-hand button is the platform console's own word for going live, in each locale.
 */
export const PREVIEW_BAR_COPY = Object.freeze({
  'zh-TW': Object.freeze({ label: '預覽提示', message: '這是預覽，還沒公開', edit: '編輯', publish: '上線' }),
  ja: Object.freeze({ label: 'プレビューのお知らせ', message: 'これはプレビューです。まだ公開されていません', edit: '編集', publish: '公開' }),
  en: Object.freeze({ label: 'Preview notice', message: 'This is a preview — not public yet', edit: 'Edit', publish: 'Publish' }),
});

/**
 * The page's own language → the bar's, matched by primary subtag (`zh` → zh-TW, `ja`, `en`).
 * Anything else, or no `lang` at all, reads English.
 */
export function previewBarLocale(pageLang) {
  const primary = String(pageLang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'zh') return 'zh-TW';
  if (primary === 'ja') return 'ja';
  return 'en';
}

export const PREVIEW_BAR_CSS = [
  // The host box: an ordinary block in the flow, whatever the page's stylesheet says (see the header above).
  ':host{all:initial!important;display:block!important;position:static!important;' +
    'width:100%!important;min-height:auto!important;margin:0!important;box-sizing:border-box!important;' +
    'padding:calc(8px + env(safe-area-inset-top, 0px)) 0 0!important;' +
    '-webkit-backdrop-filter:none!important;backdrop-filter:none!important;' +
    'background:#1d1d1f!important;color:#f5f5f7!important;border-bottom:1px solid rgba(245,245,247,.16)!important;' +
    'font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang TC","Hiragino Sans","Noto Sans TC","Noto Sans JP",system-ui,sans-serif!important;' +
    '-webkit-text-size-adjust:100%}',
  '@media print{:host{display:none!important}}',
  '.bar{max-width:1152px;margin:0 auto;padding:4px 12px 8px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px 12px}',
  '.msg{margin:0;min-width:0;text-align:center}',
  'a{font:inherit;color:inherit;text-decoration:none;white-space:nowrap;border-radius:9999px;padding:5px 14px}',
  'a:focus-visible{outline:2px solid #64b5ff;outline-offset:2px}',
  '.edit{justify-self:start;box-shadow:inset 0 0 0 1px rgba(245,245,247,.45)}',
  '.edit:hover{background:rgba(245,245,247,.12)}',
  '.publish{justify-self:end;background:#f5f5f7;color:#1d1d1f;font-weight:600}',
  '.publish:hover{background:#ffffff}',
].join('');

/** An attribute value, escaped. The addresses built below never contain these characters; this is the floor. */
const attr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * previewBarHtml: ({ pageLang, editHref, publishHref }) → the bar's markup, in the page's language.
 * Inserted as the FIRST child of `<body>`.
 */
export function previewBarHtml({ pageLang = null, editHref, publishHref }) {
  const locale = previewBarLocale(pageLang);
  const copy = PREVIEW_BAR_COPY[locale];
  return `<feelreef-preview-bar id="${PREVIEW_BAR_ID}" role="region" aria-label="${copy.label}" lang="${locale}">` +
    `<template shadowrootmode="closed"><style>${PREVIEW_BAR_CSS}</style>` +
    `<div class="bar"><a class="edit" href="${attr(editHref)}">${copy.edit}</a><p class="msg">${copy.message}</p><a class="publish" href="${attr(publishHref)}">${copy.publish}</a></div>` +
    `</template></feelreef-preview-bar>`;
}

/** A Site preview's bar: 編輯 → the site's dashboard, 上線 → its publish confirmation page. */
export function sitePreviewBarHtml(siteKey, pageLang, platform = PREVIEW_BAR_PLATFORM) {
  const dashboard = `${platform}/dashboard/sites/${encodeURIComponent(siteKey)}`;
  return previewBarHtml({ pageLang, editHref: dashboard, publishHref: `${dashboard}/publish` });
}

/**
 * A Cards preview's bar. Both buttons open the Cards editor with this preview's draft: a Card has no
 * publish step, so the editor's own save IS going live. `handle` must come from the preview's stored
 * record, never from the request.
 */
export function cardsPreviewBarHtml(handle, previewId, pageLang, platform = PREVIEW_BAR_PLATFORM) {
  const editor = `${platform}/dashboard/cards/${encodeURIComponent(handle)}/edit?preview=${encodeURIComponent(previewId)}`;
  return previewBarHtml({ pageLang, editHref: editor, publishHref: editor });
}

// ── when it is drawn ────────────────────────────────────────────────────────────────────────────────

/**
 * The header a tool sends to read a preview without the bar. Lowercase: `Headers` normalises.
 * 🔴 IT IS NOT A CREDENTIAL AND IT OPENS NOTHING. Anyone can send it, so the one thing it may change is
 * whether the bar is drawn — never what is served, to whom, or under which status.
 */
export const PREVIEW_NO_BAR_HEADER = 'x-feelreef-no-preview-bar';
/** The only value that counts (exact string — a stray `0` or `""` must still mean "draw it"). */
export const PREVIEW_NO_BAR_VALUE = '1';

/**
 * wantsPreviewBar: (request headers) → draw the bar on this response?
 *
 *   the tools' header, exactly `1`          no
 *   `Sec-Fetch-Dest: iframe` / `frame`      no — a preview shown in a frame beside the dashboard's own
 *                                           controls; a link pressed inside a sandboxed frame would
 *                                           open the dashboard inside it
 *   `Sec-Fetch-Dest: object` / `embed`      no — the same, drawn by <object> / <embed>: a page inside
 *                                           another one is never where the bar's buttons belong
 *   anything else                           yes — a browser that sends no fetch metadata gets the bar,
 *                                           the safe side
 */
const FRAMED_DESTS = new Set(['iframe', 'frame', 'object', 'embed']);
export function wantsPreviewBar(headers) {
  const get = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  if (get(PREVIEW_NO_BAR_HEADER) === PREVIEW_NO_BAR_VALUE) return false;
  const dest = String(get('sec-fetch-dest') ?? '').toLowerCase();
  return !FRAMED_DESTS.has(dest);
}

/**
 * withPreviewBar: (a whole HTML document THIS process rendered, barFor) → the same document with the bar
 * as the first child of its first `<body>`, in the language of its first `<html lang>`. A document with
 * no `<body>` start tag is returned unchanged. For a string the caller produced itself: a proxied page
 * goes through a streaming rewriter instead.
 */
export function withPreviewBar(html, barFor) {
  const text = String(html);
  const body = /<body\b[^>]*>/i.exec(text);
  if (!body) return text;
  const lang = /<html\b[^>]*?\slang="([^"]*)"/i.exec(text.slice(0, body.index))?.[1] ?? null;
  const at = body.index + body[0].length;
  return text.slice(0, at) + barFor(lang) + text.slice(at);
}
