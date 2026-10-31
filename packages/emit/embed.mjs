// `embed` — the escape hatch: body passed through VERBATIM (no markdown processing), the one
// portability-debt seam. `wide` → `.is-wide` (full-bleed band); default hugs the theme content
// width (site.css .st-embed → --gd-max) so an embedded coral reads as page content.
import { attr } from './html.mjs';

/** @param {{ id: string, body?: string }} section  @param {{ wide?: unknown }} params */
export function emitEmbed(section, params) {
  const cls = 'st-embed' + (params.wide ? ' is-wide' : '');
  return '<section' + attr('class', cls) + attr('id', section.id) + '>' + (section.body || '') + '</section>';
}
