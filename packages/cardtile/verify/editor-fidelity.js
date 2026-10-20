// Normalize only the editor additions; served styles and content remain comparable.
import { EDIT_ONLY_CSS } from '../card-render.mjs';

export function stripEditorHTML(html) {
  return html
    .replaceAll(`<style>${EDIT_ONLY_CSS}</style>`, '')
    .replace(/<script src="[^"]*Sortable[^"]*"><\/script>/, '')
    .replace(/ data-cell="\d+"/g, '');
}
