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
export function emitEmbed(section, params, ctx) {
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
