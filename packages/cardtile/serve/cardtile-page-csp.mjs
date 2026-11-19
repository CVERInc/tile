// The Content-Security-Policy of a person's page: a second wall behind the renderer's escaping.
//
// Every person's page is served from one origin. Nothing a person writes can run script in it today
// (text and attributes are escaped, links and pictures pass an allowlist, an `embed` runs in a
// sandboxed frame with an opaque origin) — but that rests on the escaping alone, and one escaping
// bug would be script on every page. This module says which scripts a page may run, so that a
// script the renderer did not write does not run even when the escaping fails.
//
// 🔴 A HEADER, ON EVERY PERSON'S PAGE. With the setting on, every person's page and every preview
// carries the policy, whatever the page holds: nothing a person writes, and nothing in the rendered
// page, decides whether it is sent. The page's bytes are the same as with the setting off, but for
// one attribute of an embed's frame (below). Nothing here changes the renderer or the deck (the
// editor's own module carries the renderer, so a change there would change the editor's page
// whatever this setting says).
//
//   CARDS_PAGE_CSP   unset, or anything but the two values below   off: no header, every answer as before
//                    "report-only"   Content-Security-Policy-Report-Only: <the policy>
//                    "enforce"       Content-Security-Policy: <the policy>
//
// Compared with `===`: nothing is trimmed or lowercased, so a typo is off. Both stages send the SAME
// policy text — report-only is the policy enforcement will send, byte for byte. No `report-to` /
// `report-uri`: this Worker has no endpoint that takes reports, and one would be a new write door.
//
// ── what the policy allows, and where each allowance comes from ─────────────────────────────────
//
//   script-src 'self'            the deck and the corals: versioned files this Worker serves itself
//              'sha256-…'        the inline scripts the page carries, each by the hash of its exact text:
//                                  · the deck's head script                      a constant (DECK_HEAD_JS)
//                                  · the click-to-play video script               a constant of the renderer
//                                  · the deck's boot data                         per page — see bootScriptOf
//                                  · the after-paint picture switch (prototype)   per page — see pictureScript
//              'unsafe-hashes'   two inline event handlers, both constants, by hash as well:
//                                  · a brand mark's `onerror` (marks.mjs iconOnerror: next candidate, then hide)
//                                  · the deck file's `onerror` (`__deckFail()`: no deck, the page is the wall)
//                                the markup keeps them because the markup may not change (above); what
//                                the keyword grants an injected element is those two texts and no other
//   style-src 'self' 'unsafe-inline'   the page's stylesheets are inline <style> blocks whose text
//                                follows the file (accent, theme, backdrop), and the deck sets
//                                `style` on tiles; a hash per block would be a hash of what a person wrote
//   img-src 'self' data: https: http:   the relays and icon files (same origin), a file's own
//                                pictures (data:), and a picture address a person wrote
//   connect-src 'self'           the deck fetching the next window of a long file
//   frame-src 'self'             an embed's document (cardtile-embed-document.mjs)
//             https://www.youtube-nocookie.com   the player a video tile opens on a click
//   object-src, base-uri, form-action 'none'   a page has no plugin content, no <base> and no form
//   default-src 'none'           everything not named above: fonts, media, workers, manifests
//
//   frame-ancestors is NOT sent. Today any site may frame a person's page (no X-Frame-Options, no
//   policy), and this module keeps what a page does today.
//
// 🔴 AN `embed` IS ITS OWN DOCUMENT WHILE THE SETTING IS ON. An `about:srcdoc` document INHERITS its
// parent's whole policy: under the script-src above the author's own script — the one place a
// person's script is meant to run — would be refused, and a hash of it in the parent's policy would
// allow the same text in the parent. So with the setting on, the Worker writes each embed's frame
// with `src` (a same-origin address, the same sandbox) instead of `srcdoc`, and answers that address
// with the document under a policy of its own (cardtile-embed-document.mjs). The parent's policy
// does not bend for it: it allows frames of its own origin, and nothing more.
import { parseCard } from '../card-core.js';
import { renderPage } from '../card-render.mjs';
import { iconOnerror } from '../marks.mjs';
import { DECK_HEAD_JS, DECK_JS_PATH } from '../w3/deck-page.mjs';

// 🔴 NOTHING AT THE TOP LEVEL OF THIS MODULE RUNS. The editor's own module is bundled from the Worker's
// import graph (gen-edit3-assets.mjs), and a top-level statement the bundler cannot prove free of effects
// is kept in it — which would change the editor's page whatever this setting says. So every constant here
// is a literal, a function, or a call marked pure; cardtile-page-csp.test.mjs's before-fixture test is what
// goes red when one is not (`/try/edit` is in that grid).
export const PAGE_CSP_SETTING = 'CARDS_PAGE_CSP';
export const PAGE_CSP_STAGES = /* @__PURE__ */ Object.freeze(['off', 'report-only', 'enforce']);
const HEADER_OF = /* @__PURE__ */ Object.freeze({
  'report-only': 'Content-Security-Policy-Report-Only',
  enforce: 'Content-Security-Policy',
});

/** pageCspStage: env → 'off' | 'report-only' | 'enforce'. Pure, and the ONLY reader of the setting. */
export function pageCspStage(env) {
  const v = env?.[PAGE_CSP_SETTING];
  return v === 'report-only' || v === 'enforce' ? v : 'off';
}
/** the response header a stage sends the policy in (undefined for 'off') */
export const pageCspHeaderName = (stage) => (Object.hasOwn(HEADER_OF, stage) ? HEADER_OF[stage] : undefined);

// ── the two inline handlers ─────────────────────────────────────────────────────────────────────
// The text a browser hashes is the attribute's VALUE (after entity decoding): what the code wrote.
/** the deck file's own onerror, as w3/deck-page.mjs writes it (cardtile-page-csp.test.mjs holds the two together) */
export const DECK_FILE_ONERROR = '__deckFail()';
/** a brand mark's onerror on a page (card-render IMG_ICON) */
export const ICON_ONERROR = /* @__PURE__ */ iconOnerror('hide');
export const PAGE_HANDLERS = /* @__PURE__ */ Object.freeze([ICON_ONERROR, DECK_FILE_ONERROR]);

// ── the renderer's own inline scripts ───────────────────────────────────────────────────────────
// card-render.mjs keeps them to itself, so they are read from the renderer once: one render of a
// constant file that holds nothing anyone wrote. Not a copy — a copy would be a second idea of the
// text, and a script whose hash is not the policy's does not run.
const PROBE_FILE = '## grid\n\n- [ ] %% card: video w=6 yt=vLAegkGGWrM %% A video\n';
const PROBE_PREFIX = '/0/a/';
let rendererScripts = null;
function ofRenderer() {
  if (rendererScripts) return rendererScripts;
  const page = renderPage(parseCard(PROBE_FILE), { pictures: { afterPaint: PROBE_PREFIX } });
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const video = scripts.find((s) => s.includes('st-embed-video-btn'));
  const after = scripts.find((s) => s.includes(`[src^="${PROBE_PREFIX}"]`));
  if (scripts.length !== 2 || !video || !after || video === after) throw new Error('cardtile page csp: the renderer\'s inline scripts are not the two this module knows');
  const [before, rest] = after.split(PROBE_PREFIX);
  rendererScripts = Object.freeze({ video, pictureBefore: before, pictureAfter: rest });
  return rendererScripts;
}
/** the click-to-play script a page with a video tile carries */
export const videoScript = () => ofRenderer().video;
// the path guard of the renderer's pictureTags, for the one value that goes into that script
const PICTURE_PATH = /^\/[A-Za-z0-9._\-/]*$/;
/** the after-paint script the renderer writes for this prefix, or null when it writes none */
export function pictureScript(afterPaint) {
  if (!afterPaint || !PICTURE_PATH.test(afterPaint)) return null;
  const r = ofRenderer();
  return r.pictureBefore + afterPaint + r.pictureAfter;
}

// ── the deck's boot data ────────────────────────────────────────────────────────────────────────
//
// The one inline script whose text follows the file: `window.__cardFront="…";window.__deckStrings=…;`
// (w3/deck-page.mjs withDeck; the Worker may re-address one line of it afterwards, withServiceTry).
// It is read from the finished page — by position, never by searching the page for scripts: a search
// would hash whatever script is there, the injected one included.
//
//   WHERE   withDeck writes its tail before the page's LAST `</body>`, so the page ENDS with
//           `<script>BOOT</script><script src="<deck file>" onerror="…"></script></body></html>`, and
//           BOOT holds no `<` (every value is JSON with `<` written `<`). So the opening tag is
//           the last `<script>` before that ending, whatever the page holds before it.
//   WHAT    only a run of `window.__name=<one JSON value>;` is accepted (isBootData). Data assigned to
//           a name runs nothing; a boot script that holds anything else — which would take an
//           escaping bug in the boot line itself — is not hashed, so it does not run either.
const pageEnd = () => `</script><script src="${DECK_JS_PATH}" onerror="${DECK_FILE_ONERROR}"></script></body></html>`;
const BOOT_NAME = /window\.__[A-Za-z]+=/y;

/** the index after the JSON value that starts at s[i], or -1 */
function jsonEnd(s, i) {
  const c = s[i];
  if (c === '"') {
    for (let j = i + 1; j < s.length; j += 1) {
      if (s[j] === '\\') j += 1;
      else if (s[j] === '"') return j + 1;
    }
    return -1;
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let j = i; j < s.length; j += 1) {
      const d = s[j];
      if (d === '"') { j = jsonEnd(s, j) - 1; if (j < 0) return -1; }
      else if (d === '{' || d === '[') depth += 1;
      else if (d === '}' || d === ']') { depth -= 1; if (depth === 0) return j + 1; }
    }
    return -1;
  }
  const lit = /(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  lit.lastIndex = i;
  return lit.test(s) ? lit.lastIndex : -1;
}
/** is this script text nothing but `window.__name=<JSON>;` statements? */
export function isBootData(script) {
  const s = String(script);
  if (!s || s.includes('<')) return false;
  let i = 0;
  while (i < s.length) {
    BOOT_NAME.lastIndex = i;
    if (!BOOT_NAME.test(s)) return false;
    const end = jsonEnd(s, BOOT_NAME.lastIndex);
    if (end < 0 || s[end] !== ';') return false;
    try { JSON.parse(s.slice(BOOT_NAME.lastIndex, end)); } catch { return false; }
    i = end + 1;
  }
  return true;
}
/** the boot script of a finished page, or null when the page does not end the way withDeck ends one */
export function bootScriptOf(page) {
  const p = String(page);
  const end = pageEnd();
  if (!p.endsWith(end)) return null;
  const close = p.length - end.length;
  const open = p.lastIndexOf('<script>', close);
  if (open < 0) return null;
  const boot = p.slice(open + '<script>'.length, close);
  return isBootData(boot) ? boot : null;
}

// ── the policy ──────────────────────────────────────────────────────────────────────────────────
const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const hashed = /* @__PURE__ */ new Map();   // the constants only; a page's own boot script is hashed per answer
/** `'sha256-<base64>'` of a script's or a handler's exact text */
export async function hashSource(text, keep = false) {
  const kept = hashed.get(text);
  if (kept) return kept;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const src = `'sha256-${b64(new Uint8Array(digest))}'`;
  if (keep) hashed.set(text, src);
  return src;
}

/**
 * pagePolicy: ({ scripts, handlers }) → the policy text. Pure; the ONE place the policy is written.
 * `scripts` and `handlers` are hash sources (hashSource), in the order they are to be listed.
 */
export function pagePolicy({ scripts = [], handlers = [] } = {}) {
  return [
    "default-src 'none'",
    ['script-src', "'self'", ...scripts, ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : [])].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * pageCspHeaders: (env, the finished page, facts) → the header to add to a person's page, or {}.
 *
 *   facts.afterPaint     the prefix the after-paint picture script was written with, when the caller
 *                        handed the renderer one (the local picture switch)
 *
 * {} when the setting is off, and ONLY then. The page is read for the hashes it needs (the boot line),
 * never for whether to send the policy.
 */
export async function pageCspHeaders(env, page, { afterPaint = '' } = {}) {
  const stage = pageCspStage(env);
  if (stage === 'off') return {};
  const boot = bootScriptOf(page);
  const picture = pictureScript(afterPaint);
  const scripts = [
    await hashSource(DECK_HEAD_JS, true),
    await hashSource(videoScript(), true),
    ...(boot ? [await hashSource(boot)] : []),
    ...(picture ? [await hashSource(picture)] : []),
  ];
  const handlers = [];
  for (const h of PAGE_HANDLERS) handlers.push(await hashSource(h, true));
  return { [pageCspHeaderName(stage)]: pagePolicy({ scripts, handlers }) };
}
