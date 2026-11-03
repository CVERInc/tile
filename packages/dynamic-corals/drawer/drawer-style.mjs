// The drawer coral's stylesheet — the coral's, not the host's.
//
// 🔴 It is a separate module because it must reach the page WITHOUT the script. A drawer opens by
// being the URL's `:target`, which is pure CSS; if these rules only arrived when drawer.js ran, a
// reader with JavaScript off would click a link and get nothing. The renderer emits this as a
// <style> next to the panels, and only when the card actually has drawers.
//
// sitetile would import the same module at build time. One source, two delivery mechanisms — which
// is exactly the line the convergence draws: share CSS and contract, not markup emitters.
import { CLOSE_BUTTON_CSS, closeButtonStates } from '../shared/close-button.mjs';

export const DRAWER_CSS = [
    // the layer is inert until a panel is targeted, so it never swallows clicks on the card
    '.dc-drawer-layer{position:fixed;inset:0;z-index:600;pointer-events:none}',
    '.dc-drawer-layer:has(.dc-drawer:target){pointer-events:auto}',
    'body:has(.dc-drawer:target){overflow:hidden}',
    // the scrim
    '.dc-drawer-scrim{position:absolute;inset:0;display:block;opacity:0;visibility:hidden;cursor:pointer;',
    'background:color-mix(in srgb,var(--cp-ground,#0a1628) 66%,transparent);',
    '-webkit-backdrop-filter:blur(16px) saturate(140%);backdrop-filter:blur(16px) saturate(140%);',
    'transition:opacity .3s,visibility 0s .3s}',
    '.dc-drawer-layer:has(.dc-drawer:target) .dc-drawer-scrim{opacity:1;visibility:visible;transition:opacity .3s,visibility 0s 0s}',
    // the panel IS THE CARD'S OTHER SIDE (reef#2725, 2026-11-02). It used to be a bottom sheet on a phone and a
    // centred dialog on a desk; in the deck views a card flips, so a back that slid up from the floor was a
    // second idea of what "the other side" is. One card now, the deck card's size, at every width: it turns
    // into view (edge-on to face-on), and the coral may add WHERE it turns from — the tile that was tapped —
    // by setting --dc-fx/--dc-fy/--dc-fs. Without the script the turn happens in place, centred, and the
    // back still opens, closes and deep-links, because opening it is still the URL's :target.
    '.dc-drawer{position:absolute;left:50%;top:50%;width:min(440px,calc(100vw - 32px));',
    'max-height:min(88vh,760px);max-height:min(88svh,760px);overflow-y:auto;overscroll-behavior:contain;',
    'box-sizing:border-box;background:var(--cp-surface,var(--cp-ground,#0a1628));color:var(--cp-ink,inherit);',
    'border:1px solid var(--cp-accent-border,rgba(184,144,232,.25));border-radius:var(--r-xl,22px);',
    'box-shadow:0 24px 60px rgba(0,0,0,.28);',
    'padding:var(--s-6,1.5rem) var(--s-5,1.25rem) var(--s-6,1.5rem);',
    'transform:translate(-50%,-50%) translate(var(--dc-fx,0px),var(--dc-fy,0px)) perspective(1400px) rotateY(90deg) scale(var(--dc-fs,.92));',
    'opacity:0;visibility:hidden;',
    'transition:transform .5s cubic-bezier(.3,.7,.2,1),opacity .2s .25s,visibility 0s .5s}',
    '.dc-drawer:target{transform:translate(-50%,-50%) perspective(1400px) rotateY(0deg) scale(1);opacity:1;visibility:visible;',
    'transition:transform .5s cubic-bezier(.3,.7,.2,1),opacity .15s,visibility 0s 0s}',
    // the way out of a link's back: the coral adds it when the back was opened by a link that also goes somewhere
    '.dc-back-go{display:inline-flex;align-items:center;gap:.4rem;margin-top:var(--s-4,1rem);padding:.6rem 1.1rem;',
    'border-radius:999px;background:var(--cp-accent,#0556ff);color:var(--cp-on-accent,#fff);text-decoration:none;font-weight:600;',
    'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // the close control — the QR popup's identity, this host's placement. It is a LINK, because
    // what it does is navigate back out of the fragment, and a link does that without script.
    //
    // 🔴 TOP-LEFT, matching the QR popup. The product owner: 「我覺得該全部放左上角,行為就是跟qr一樣關閉可關、
    // modal外也可關」. It used to float RIGHT, so a reader who learned where ✕ lives from one overlay
    // had to hunt for it in the other — and every overlay on a Card is the same promise, so it should
    // be the same gesture. The dismiss half already matched: the scrim is a clickable link, and the
    // QR overlay closes on a click that lands on itself.
    // 🔴 It sits in the LAYER now, not in the panel, so it can be genuinely fixed to the viewport
    // corner exactly like the QR's. Inside `.dc-drawer` it could not: that element carries a
    // `transform`, which creates a containing block for fixed descendants, so `position:fixed` there
    // still resolved against the panel and still scrolled away with the content.
    //
    // Same coordinates as the QR popup's — `top:1rem;left:1rem` — because they are the same promise.
    // Hidden and inert until something is actually open, or it would sit over the card.
    '.dc-drawer-close{position:fixed;top:1rem;left:1rem;z-index:602;text-decoration:none;',
    'opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s;' + CLOSE_BUTTON_CSS + '}',
    '.dc-drawer-layer:has(.dc-drawer:target) .dc-drawer-close{opacity:1;visibility:visible;transition:opacity .3s,visibility 0s 0s}',
    closeButtonStates('.dc-drawer-close'),
    // the title no longer has to clear a button that is no longer beside it
    '.dc-drawer-title{margin:0 0 var(--s-4,1rem);font-size:1.05rem;font-weight:700;',
    'color:var(--cp-accent-bright,#d9c9f3);line-height:1.35}',
    '@media(prefers-reduced-motion:reduce){.dc-drawer,.dc-drawer-scrim{transition:none}.dc-drawer{transform:translate(-50%,-50%)}}',
].join('');
