// `embed` — the escape hatch: body passed through VERBATIM (no markdown processing), the one
// portability-debt seam. `wide` → `.is-wide` (full-bleed band); default hugs the theme content
// width (site.css .st-embed → --gd-max) so an embedded coral reads as page content.
import { attr } from './html.mjs';
import { cellFrame } from './cell.mjs';

// YouTube's play mark, drawn (no request): the Card video's only glyph.
const PLAY = '<svg viewBox="0 0 68 48" width="54" height="38"><path d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.3 0 34 0 34 0S12.7 0 7.5 1.6a8.6 8.6 0 0 0-6 6.1A90 90 0 0 0 0 24a90 90 0 0 0 1.5 16.3 8.6 8.6 0 0 0 6 6C12.7 48 34 48 34 48s21.3 0 26.5-1.6a8.6 8.6 0 0 0 6-6.1A90 90 0 0 0 68 24a90 90 0 0 0-1.5-16.3z" fill="#f00"/><path d="M27 34l18-10-18-10z" fill="#fff"/></svg>';

/**
 * @param {{ id: string, body?: string }} section
 * @param {{ wide?: unknown, cell?: { attrs: string },
 *           video?: { source: [string, string], poster: string, label: string } }} params
 *   `cell` + `video` → a Card `video` cell (cell.mjs): the third-party embed as click-to-load — a
 *   poster and a play button, and NO iframe until the visitor presses play (the Card's click-to-load
 *   client builds it then). `source` is the one data attribute that client reads (`data-yt` /
 *   `data-yt-channel` / `data-yt-handle`) and its value; `poster` ('' for none) is written through
 *   the Card's registry (`ctx.url`).
 * @param {{ esc?: (v: unknown) => string, url?: (raw: string) => string }} [ctx]
 */
// ── the Card's `embed`: the author's HTML in a sandboxed srcdoc frame (reef#2725) ─────────────────
// The reasons are written at card-render's renderEmbedHtml, which builds the document; this writes the
// frame. 🔴 `sandbox="allow-scripts"` and nothing else (an opaque origin: no storage, cookies or DOM of
// the card, no top navigation, no popups/forms/modals). 🔴 The srcdoc escape is its own function, `&`
// first so an author's literal `&quot;` stays literal, then `"` `<` `>` — the one value whose escaping
// is a security property, so it does not borrow `ctx.esc`. embed-html.test.mjs and
// verify/embed-sandbox.mjs hold both.
const srcdocAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// the cell is a square of its own width (no `h`, and no channel from the frame to measure it); the
// `[data-cell]` rule matches only a cell the EDITOR rendered, where a click must select the tile
const SRCDOC_CELL_CSS = '.st-card .st-embed-html{position:relative;aspect-ratio:1;min-height:0}'
  + '.st-embed-html iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0;background:transparent}'
  + '.st-embed-html[data-cell] iframe{pointer-events:none}';

/**
 * …and `cell` + `srcdoc` → a Card `embed` cell: `srcdoc` is the whole document the Card built (its
 * theme, then the author's HTML), `title` the frame's accessible name.
 */
export function emitEmbed(section, params, ctx) {
  if (params.cell && params.srcdoc != null) {
    return cellFrame(params.cell, 'st-embed st-embed-html', 'embed', `<style>${SRCDOC_CELL_CSS}</style>`
      + `<iframe sandbox="allow-scripts" srcdoc="${srcdocAttr(params.srcdoc)}" title="${ctx.esc(params.title)}" loading="lazy" referrerpolicy="no-referrer"></iframe>`);
  }
  if (params.cell) {
    const e = ctx.esc;
    const { source: [name, value], poster, label } = params.video;
    return cellFrame(params.cell, 'st-embed-video', 'video',
      `<button type="button" class="st-embed-video-btn${poster ? '' : ' st-embed-video-noposter'}" ${name}="${e(value)}" aria-label="${e(label)}">`
      + `${poster ? `<img class="st-embed-video-poster" src="${ctx.url(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}`
      + `<span class="st-embed-video-play" aria-hidden="true">${PLAY}</span>${label ? `<span class="st-embed-video-label">${e(label)}</span>` : ''}</button>`);
  }
  const cls = 'st-embed' + (params.wide ? ' is-wide' : '');
  return '<section' + attr('class', cls) + attr('id', section.id) + '>' + (section.body || '') + '</section>';
}
